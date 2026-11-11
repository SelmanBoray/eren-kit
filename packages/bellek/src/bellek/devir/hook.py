"""Claude Code hook giriş noktası: devir (oturum devri) ve pahalı an uyarıları.

Çağrılış (payload stdin'den)::

    python -I -S "<paket>/src/bellek/devir/hook.py" || true

(<paket>: bu paketin mutlak yolu, düz bölüyle yazılmış; kurulum betiği doldurur.)

Neden bu biçim: Claude Code hook komutlarını Windows'ta Git Bash ile çalıştırır.
Tırnaksız ters bölülü yolda (sürücü harfi, iki nokta, ters bölü...) kabuk ters
bölüleri yutar, Python dosyayı bulamaz ve exit 2 döner. Claude Code exit 2'yi
UserPromptSubmit'te "istemi engelle", Stop'ta "durma, devam et" sayar. Düz bölü
ve tırnak yolu korur; ``|| true`` Python hiç başlayamasa bile çıkış kodunu 0
yapar (fail-open).

Olaylar:
- SessionStart: oturum kimliği + devir dizini (additionalContext).
- Stop: otomatik devir notu yazar; karar vermez, stdout boş.
- UserPromptSubmit: cache süresi dolmuşken büyük bağlam (boşluk) ve büyüyen
  bağlam (eşik) uyarıları. Bağlama asla metin eklemez.

Fail-open: her hatada exit 0 ve boş stdout; hata durum klasöründeki
``hook.log`` dosyasına yazılır. Çıktı şeması:
https://code.claude.com/docs/en/hooks (JSON output, UserPromptSubmit/SessionStart
decision control).
"""
from __future__ import annotations

import json
import os
import sys
import time
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Hız: hook her istemde, her Stop'ta ve her SessionStart'ta ayrı süreç olarak açılır.
# traceback yalnız hata yolunda yüklenir; bellek.config yalnız devir klasörü önbelleği
# (durum klasöründe devir_kok.json) geçersizse yüklenir; typing hiç yüklenmez.

# ---- Ayarlar -----------------------------------------------------------------

BOSLUK_DK = 60
BOSLUK_MIN_BAGLAM = 150_000
BUYUKLUK_ILK_ESIK = 300_000
BUYUKLUK_ADIM = 100_000
SESSION_START_SINIR = 2000
DIZIN_SINIR = 1500
LOG_MAX_BAYT = 1_000_000
LOG_KIRP_BAYT = 256_000
DURUM_MAX_GUN = 30

# USD / 1M token. Önek eşleşmesi: "claude-opus-5-5-2026..." ya da "...[1m]" de eşleşir.
CACHE_YAZMA_1S: dict[str, float] = {
    "claude-opus-5-5": 8.0,
    "claude-sonnet-5-5": 4.0,
    "claude-fable-5-1": 20.0,
    "claude-opus-4-8": 10.0,
    "claude-haiku-5-5": 0.2,
}
CACHE_OKUMA: dict[str, float] = {
    "claude-opus-5-5": 0.20,
    "claude-sonnet-5-5": 0.10,
    "claude-fable-5-1": 0.25,
    "claude-opus-4-8": 0.50,
    "claude-haiku-5-5": 0.01,
}
VARSAYILAN_YAZMA = 8.0
VARSAYILAN_OKUMA = 0.20  # varsayılan yazma fiyatıyla aynı model (opus-5-5)

MODLAR = ("durdur", "uyar", "kapali")


# ---- Yardımcılar ---------------------------------------------------------------

def state_dir(env: Mapping[str, str] | None = None) -> Path:
    env = os.environ if env is None else env
    ozel = env.get("BELLEK_DEVIR_STATE")
    if ozel:
        return Path(ozel)
    from bellek.platform_dirs import data_dir

    return data_dir(env) / "devir"


def log_error(mesaj: str, env: Mapping[str, str] | None = None) -> None:
    """Hata günlüğü; kendisi de asla istisna fırlatmaz."""
    try:
        klasor = state_dir(env)
        klasor.mkdir(parents=True, exist_ok=True)
        yol = klasor / "hook.log"
        try:
            if yol.stat().st_size > LOG_MAX_BAYT:
                with open(yol, "rb") as f:
                    f.seek(-LOG_KIRP_BAYT, os.SEEK_END)
                    kuyruk = f.read()
                kes = kuyruk.find(b"\n")
                yol.write_bytes(kuyruk[kes + 1:] if kes >= 0 else kuyruk)
        except FileNotFoundError:
            pass
        zaman = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with open(yol, "a", encoding="utf-8", newline="\n") as f:
            f.write(f"[{zaman}] {mesaj.rstrip()}\n")
    except Exception:
        pass


def parse_time(deger: object) -> datetime | None:
    """ISO zaman metnini (Z sonekli olabilir) UTC'li datetime'a çevirir."""
    if not isinstance(deger, str) or not deger.strip():
        return None
    s = deger.strip()
    if s[-1] in "Zz":
        s = s[:-1] + "+00:00"
    try:
        t = datetime.fromisoformat(s)
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t.astimezone(timezone.utc)


def _fiyat(tablo: dict[str, float], model: object, varsayilan: float) -> float:
    if isinstance(model, str):
        m = model.strip().lower()
        for anahtar in sorted(tablo, key=len, reverse=True):
            if m.startswith(anahtar):
                return tablo[anahtar]
    return varsayilan


def write_price(model: object) -> float:
    return _fiyat(CACHE_YAZMA_1S, model, VARSAYILAN_YAZMA)


def read_price(model: object) -> float:
    return _fiyat(CACHE_OKUMA, model, VARSAYILAN_OKUMA)


def _usd(x: float) -> str:
    return f"{x:.2f}".replace(".", ",") + " $"


def _k(n: int) -> str:
    return f"{round(n / 1000)}K"


def _safe_name(oturum: str) -> str:
    ad = "".join(c if (c.isalnum() or c in "-_.") else "_" for c in oturum)[:120]
    return ad or "_"


def _durum_yolu(oturum: str, env: Mapping[str, str] | None) -> Path:
    return state_dir(env) / "oturumlar" / f"{_safe_name(oturum)}.json"


def load_state(oturum: str, env: Mapping[str, str] | None = None) -> dict:
    try:
        veri = json.loads(_durum_yolu(oturum, env).read_text(encoding="utf-8"))
        return veri if isinstance(veri, dict) else {}
    except Exception:
        return {}


def save_state(oturum: str, veri: dict, env: Mapping[str, str] | None = None) -> None:
    yol = _durum_yolu(oturum, env)
    yol.parent.mkdir(parents=True, exist_ok=True)
    tmp = yol.with_name(f".{yol.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(veri, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, yol)


def prune_states(env: Mapping[str, str] | None = None) -> None:
    """DURUM_MAX_GUN'den eski oturum durum dosyalarını siler."""
    try:
        sinir = time.time() - DURUM_MAX_GUN * 86400
        with os.scandir(state_dir(env) / "oturumlar") as it:
            for e in it:
                try:
                    if e.is_file() and e.stat().st_mtime < sinir:
                        os.unlink(e.path)
                except OSError:
                    pass
    except OSError:
        pass


def _mode(env: Mapping[str, str]) -> str:
    m = (env.get("BELLEK_DEVIR_UYARI") or "durdur").strip().lower()
    return m if m in MODLAR else "durdur"


def _devir_kok(notlar, env: Mapping[str, str]) -> Path:
    """Devir klasörü; çözülen yol durum klasöründe önbelleklenir (bellek.config'siz açılış)."""
    try:
        onbellek = state_dir(env)
    except Exception:  # noqa: BLE001 - önbelleksiz devam
        onbellek = None
    return notlar.devir_kok(env, onbellek=onbellek)


def _devir_istemi_mi(payload: dict) -> bool:
    """İstem /devir ile mi başlıyor (baştaki boşluklar atılarak)."""
    istem = payload.get("prompt")
    return isinstance(istem, str) and istem.lstrip().startswith("/devir")


# ---- Olaylar -------------------------------------------------------------------

def handle_session_start(payload: dict, now: datetime,
                         env: Mapping[str, str]) -> dict | None:
    oturum = str(payload.get("session_id") or "bilinmiyor")
    kaynak = payload.get("source")
    metin = f"Oturum kimliği: {oturum}."
    if kaynak in ("startup", "clear", "compact"):
        prune_states(env)
        from bellek.devir import notlar
        kok = _devir_kok(notlar, env)
        notlar.oto_notlari_buda(kok, now)
        if notlar.DEVIR_KOK_UYARI:
            # Kırpmada kaybolmasın diye dizinden önce; ayrıca hook.log'a.
            log_error(notlar.DEVIR_KOK_UYARI, env)
            metin += f" Uyarı (Bellek ayarı): {notlar.DEVIR_KOK_UYARI}."
        dizin = notlar.dizin_metni(kok, now, oturum, DIZIN_SINIR)
        if dizin:
            metin += (" Devir: kullanıcı önceki bir işe devam etmek isterse "
                      "aşağıdaki dizinden ilgili notu oku; oturumu bırakmadan "
                      "önce kullanıcı isterse /devir ile zengin not yaz."
                      f"\n\n{dizin}")
        else:
            metin += (" Devir: oturumu bırakmadan önce kullanıcı isterse /devir "
                      "ile zengin not yazılabilir.")
    # resume/fork ve diğerleri: bağlam zaten taşındı, yalnız kimlik.
    if len(metin) > SESSION_START_SINIR:
        metin = metin[: SESSION_START_SINIR - 1].rstrip() + "…"
    return {"hookSpecificOutput": {"hookEventName": "SessionStart",
                                   "additionalContext": metin}}


def handle_stop(payload: dict, now: datetime, env: Mapping[str, str]) -> None:
    yol = payload.get("transcript_path")
    if not yol:
        return None
    from bellek.devir import notlar, transcript
    kok = _devir_kok(notlar, env)
    if notlar.DEVIR_KOK_UYARI:
        log_error(notlar.DEVIR_KOK_UYARI, env)
    ozet = transcript.oturum_ozeti(yol)
    if isinstance(ozet, dict):
        if not ozet.get("oturum") and payload.get("session_id"):
            ozet = {**ozet, "oturum": payload["session_id"]}
        notlar.oto_not_yaz(kok, ozet)
    return None


def _mark_thresholds(durum: dict, baglam: int) -> bool:
    """Bağlamın geçtiği tüm eşikleri görüldü işaretler; en yüksek eşik yeniyse True."""
    if baglam < BUYUKLUK_ILK_ESIK:
        return False
    esik = (baglam // BUYUKLUK_ADIM) * BUYUKLUK_ADIM
    gorulen = {x for x in durum.get("esikler", [])
               if isinstance(x, int) and not isinstance(x, bool)}
    if esik in gorulen:
        return False
    durum["esikler"] = sorted(gorulen | set(range(BUYUKLUK_ILK_ESIK, esik + 1, BUYUKLUK_ADIM)))
    return True


def _sure(dakika: int) -> tuple[str, str]:
    """(uzun, kısa) süre metni: '75 dakikadır'/'75 dk', '5 saattir'/'5 sa', '3 gündür'/'3 gün'."""
    if dakika < 120:
        return f"{dakika} dakikadır", f"{dakika} dk"
    if dakika < 48 * 60:
        return f"{dakika // 60} saattir", f"{dakika // 60} sa"
    return f"{dakika // 1440} gündür", f"{dakika // 1440} gün"


def gap_texts(dakika: int, baglam: int, model: object) -> tuple[str, str]:
    """(engelleme metni, kısa sistem mesajı)."""
    maliyet = _usd(baglam * write_price(model) / 1_000_000)
    sure_uzun, sure_kisa = _sure(dakika)
    uzun = (f"Oturum {sure_uzun} boşta; önbellek (cache) süresi doldu. "
            f"Bu mesaj yaklaşık {_k(baglam)} token bağlamı önbelleğe yeniden "
            f"yazdıracak: tahmini {maliyet} (API liste fiyatı karşılığı; "
            f"abonelikte bu kadar limit harcar). Bu işe yeni oturumda devam "
            f"etmek daha ucuz: çık ve yeni oturum aç, devir dizini otomatik "
            f"gelir. Burada devam etmek için mesajı tekrar gönder.")
    kisa = (f"{sure_kisa} boşta, önbellek süresi doldu: bu mesaj ~{_k(baglam)} "
            f"token'ı yeniden yazdırıyor, tahmini {maliyet} (API liste fiyatı). "
            f"Yeni oturum daha ucuz olabilir.")
    return uzun, kisa


def handle_user_prompt(payload: dict, now: datetime,
                       env: Mapping[str, str]) -> dict | None:
    mod = _mode(env)
    if mod == "kapali":
        return None
    if _devir_istemi_mi(payload):
        # Kullanıcı tam da önerilen şeyi yapıyor (devir notu yazıp çıkmak): boşluk
        # engeli ve "/devir yazın" uyarısı burada yalnız işi engeller.
        return None
    oturum = payload.get("session_id")
    yol = payload.get("transcript_path")
    if not oturum or not yol:
        return None
    from bellek.devir import transcript
    bilgi = transcript.son_istek_bilgisi(yol) or {}
    baglam = bilgi.get("son_baglam")
    if not isinstance(baglam, int) or isinstance(baglam, bool) or baglam <= 0:
        return None
    model = bilgi.get("son_model")
    son_zaman_ham = bilgi.get("son_zaman")
    son = parse_time(son_zaman_ham)
    oturum = str(oturum)

    # a. Boşluk uyarısı
    if son is not None and baglam >= BOSLUK_MIN_BAGLAM:
        bos = now - son
        if bos >= timedelta(minutes=BOSLUK_DK):
            dakika = int(bos.total_seconds() // 60)
            uzun, kisa = gap_texts(dakika, baglam, model)
            durum = load_state(oturum, env)
            # Boşluk bildirimi büyüklüğü de söyler: bu boyutun eşik uyarısı ayrıca gelmesin.
            _mark_thresholds(durum, baglam)
            if mod == "uyar":
                save_state(oturum, durum, env)
                return {"systemMessage": kisa}
            if durum.get("engellenen_bosluk") != son_zaman_ham:
                durum["engellenen_bosluk"] = son_zaman_ham
                save_state(oturum, durum, env)  # yazılamazsa engelleme (fail-open)
                return {"decision": "block", "reason": uzun}
            # Aynı boşlukta ikinci gönderim: sessizce geçer.
            save_state(oturum, durum, env)
            return None

    # b. Büyüklük uyarısı
    if baglam >= BUYUKLUK_ILK_ESIK:
        durum = load_state(oturum, env)
        if _mark_thresholds(durum, baglam):
            save_state(oturum, durum, env)
            maliyet = _usd(baglam * read_price(model) / 1_000_000)
            return {"systemMessage": (
                f"Bağlam {_k(baglam)} token; her istek yaklaşık {maliyet} cache "
                f"okuma. Uygun bir yerde /devir yazıp yeni oturum açmak limit "
                f"tasarrufu sağlar.")}
    return None


HANDLERS = {
    "SessionStart": handle_session_start,
    "Stop": handle_stop,
    "UserPromptSubmit": handle_user_prompt,
}


def run(payload: dict, now: datetime | None = None,
        env: Mapping[str, str] | None = None) -> dict | None:
    """Olayı işler ve stdout'a yazılacak JSON nesnesini (ya da None) döndürür."""
    env = os.environ if env is None else env
    now = now or datetime.now(timezone.utc)
    if not isinstance(payload, dict):
        return None
    handler = HANDLERS.get(str(payload.get("hook_event_name")))
    if handler is None:
        return None
    return handler(payload, now, env)


def main() -> int:
    olay = "?"
    try:
        ham = sys.stdin.buffer.read().decode("utf-8", errors="replace").lstrip("\ufeff")
        payload = json.loads(ham)
        if isinstance(payload, dict):
            olay = str(payload.get("hook_event_name"))
        cikti = run(payload)
        if cikti:
            # ensure_ascii: konsol/ara katman kodlamasından bağımsız, saf ASCII JSON.
            sys.stdout.buffer.write(json.dumps(cikti, ensure_ascii=True).encode("ascii"))
            sys.stdout.buffer.flush()
    except BaseException as e:  # noqa: BLE001 — fail-open
        if isinstance(e, KeyboardInterrupt):
            return 0
        try:
            import traceback  # yalnız hata yolunda (açılış süresi)

            ayrinti = traceback.format_exc()
        except BaseException:  # noqa: BLE001
            ayrinti = f"{type(e).__name__}: {e}"
        log_error(f"{olay}: {ayrinti}")
    return 0


if __name__ == "__main__":
    _src = str(Path(__file__).resolve().parents[2])
    if _src not in sys.path:
        sys.path.insert(0, _src)
    try:
        _kod = main()
    except BaseException:
        _kod = 0
    sys.exit(_kod)
