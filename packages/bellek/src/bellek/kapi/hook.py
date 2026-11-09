"""Claude Code PreToolUse hook'u: önce harita kapısı.

Bir ajan (ya da ana oturum) büyük bir Markdown belgesine Read ile İLK kez
dokunduğunda okuma reddedilir ve gerekçe olarak belgenin başlık haritası
(bölümlerin satır aralıkları ve boyutları) döndürülür; ajan sonra yalnız
gereken bölümü offset/limit ile okur. Aynı (oturum, ajan, dosya) için sonraki
istekler geçer. Tekrar okumalar bu sürümde engellenmez, yalnız ölçülür.

Neden: alt agent'lar büyük proje belgelerini 275-280 satırlık parçalarla ve
çoğu kez aynı yerleri yeniden okuyarak çok token harcıyor (büyük bir proje belgesi üzerinde ölçüm,
2026-11-09). "İlk adımı geçmeden sonraki adımı görmesin."

Çağrılış (payload stdin'den)::

    python -I -S "<depo kökü>/packages/bellek/src/bellek/kapi/hook.py" || true

Neden bu biçim: Claude Code hook komutlarını Windows'ta Git Bash ile çalıştırır;
tırnaksız ters bölülü yolda kabuk ters bölüleri yutar ve Python dosyayı
bulamaz. Düz bölü ve tırnak yolu korur; ``|| true`` Python hiç başlayamasa bile
çıkış kodunu 0 yapar (fail-open). ``-I`` kullanıcı ortamını (PYTHONPATH, kullanıcı
site'ı) yok sayar; ``-S`` site'ı atlayıp başlangıcı hızlandırır. Hook yalnız
standart kütüphaneyi ve kendi paketini kullanır; paket kökü (``src``) aşağıda
``sys.path``'e eklenir. Her Read'de çalıştığı için büyük olmayan okumalarda iş
en azdır: dosya okunmaz, yalnız uzantı ve ``os.stat``.

Karar sırası:
1. ``BELLEK_KAPI=kapali`` → izin.  2. Araç Read değil → izin.
3. Uzantı .md/.markdown değil → izin.  4. Dosya yok ya da ESIK bayttan küçük → izin.
5. Dosya TAVAN bayttan büyük → izin ("cok_buyuk"; ayrıştırma yok).
6. ``limit`` ≤ HEDEFLI → izin ("hedefli"; haritayı görülmüş saymaz).
7. Harita işareti zaten var → izin ("izin"; ayrıştırma yok, satır sayısı bayttan).
8. Belgede 3'ten az başlık → izin ("az_baslik").
9. İşaret dosyası O_EXCL ile oluşturulursa → RET + harita ("harita"); başka bir
   paralel istek önce oluşturduysa → izin ("izin"); başka hata → izin.

Ortam değişkenleri: ``BELLEK_KAPI`` ("kapali": her şeye izin),
``BELLEK_KAPI_ESIK`` (bayt, varsayılan 16384), ``BELLEK_KAPI_HEDEFLI`` (satır,
varsayılan 80), ``BELLEK_KAPI_TAVAN`` (bayt, varsayılan 5000000),
``BELLEK_KAPI_STATE`` (durum klasörü; varsayılan ``%LOCALAPPDATA%\\Bellek\\kapi``).
Geçersiz sayı varsayılana döner.

Durum: ``<state>/oturumlar/<oturum>/<ajan>/<anahtar>.harita`` (harita verildi
işareti; atomik oluşturma paralel isteklerde tek ret sağlar) ve
``<anahtar>.jsonl`` (aralık olayları, tekrar ölçümü için); ölçüm günlüğü
``<state>/kapi.jsonl`` (5 MB'ı aşınca ``kapi.jsonl.1``'e döner); hatalar
``<state>/hook.log``.

Fail-open: her hatada exit 0 ve boş stdout (= izin). Ret, ancak işaret dosyası
oluşturulabildiyse döner; yoksa ajan sonsuza dek reddedilirdi. Çıktı şeması:
https://code.claude.com/docs/en/hooks (PreToolUse decision control).
"""
from __future__ import annotations

# Yalnız os/sys modül düzeyinde: json (re/enum zinciriyle ~13-30 ms) ve diğerleri
# işlev içinde tembel yüklenir; main()'deki ön eleme çoğu Read'de json'u hiç açmaz.
import os
import sys

TYPE_CHECKING = False
if TYPE_CHECKING:
    from collections.abc import Mapping
    from typing import Any

# ---- Ayarlar -----------------------------------------------------------------

ESIK_VARSAYILAN = 16_384
HEDEFLI_VARSAYILAN = 80
TAVAN_VARSAYILAN = 5_000_000
# Claude Code hook stdout'unu 10.000 karakterde kesip dosyaya atar; JSON bozulmasın.
CIKTI_SINIR = 9000
HARITA_SATIRLARI = (80, 40, 20)
READ_VARSAYILAN_LIMIT = 2000  # Claude Code Read'in limit verilmezse okuduğu satır
OTURUM_MAX_GUN = 7
LOG_MAX_BAYT = 1_000_000
LOG_KIRP_BAYT = 256_000
GUNLUK_MAX_BAYT = 5_000_000
MD_UZANTILARI = (".md", ".markdown")
KAPALI_DEGERLERI = ("kapali", "kapalı")
AD_MAX = 64
ANA_AJAN = "ana"
BILINMEYEN_OTURUM = "bilinmiyor"
ARALIKLI_KARARLAR = ("hedefli", "izin")
# Win32 CreateFile sabitleri (_winapi hepsini dışa açmıyor).
_FILE_APPEND_DATA = 0x0004
_FILE_SHARE_ALL = 0x0001 | 0x0002 | 0x0004  # okuma | yazma | silme/yeniden adlandırma
_OPEN_ALWAYS = 4
_FILE_ATTRIBUTE_NORMAL = 0x80
_GUVENLI_KARAKTER = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")


# ---- Yardımcılar ---------------------------------------------------------------

def state_dir(env: Mapping[str, str] | None = None) -> str:
    env = os.environ if env is None else env
    ozel = env.get("BELLEK_KAPI_STATE")
    if ozel:
        return ozel
    yerel = env.get("LOCALAPPDATA") or os.path.join(
        os.path.expanduser("~"), "AppData", "Local")
    return os.path.join(yerel, "Bellek", "kapi")


def _now_iso() -> str:
    from datetime import datetime
    return datetime.now().astimezone().isoformat(timespec="seconds")


def log_error(mesaj: str, env: Mapping[str, str] | None = None) -> None:
    """Hata günlüğü (boyut sınırlı); kendisi de asla istisna fırlatmaz."""
    try:
        klasor = state_dir(env)
        os.makedirs(klasor, exist_ok=True)
        yol = os.path.join(klasor, "hook.log")
        try:
            if os.stat(yol).st_size > LOG_MAX_BAYT:
                with open(yol, "rb") as f:
                    f.seek(-LOG_KIRP_BAYT, os.SEEK_END)
                    kuyruk = f.read()
                kes = kuyruk.find(b"\n")
                with open(yol, "wb") as f:
                    f.write(kuyruk[kes + 1:] if kes >= 0 else kuyruk)
        except FileNotFoundError:
            pass
        with open(yol, "a", encoding="utf-8", newline="\n") as f:
            f.write(f"[{_now_iso()}] {mesaj.rstrip()}\n")
    except Exception:
        pass


def _log_exception(baglam: str, env: Mapping[str, str] | None) -> None:
    try:
        import traceback
        log_error(f"{baglam}: {traceback.format_exc()}", env)
    except Exception:
        pass


def _env_int(env: Mapping[str, str], ad: str, varsayilan: int) -> int:
    ham = env.get(ad)
    if ham is None:
        return varsayilan
    try:
        deger = int(str(ham).strip())
    except ValueError:
        return varsayilan
    return deger if deger >= 0 else varsayilan


def _pos_int(deger: Any) -> int | None:
    """Pozitif tam sayı ise kendisi, değilse (None, bool, float, metin, ≤0) None."""
    return deger if type(deger) is int and deger > 0 else None


def _sha1_16(metin: str) -> str:
    import hashlib
    return hashlib.sha1(metin.encode("utf-8", "surrogatepass")).hexdigest()[:16]


def _safe_name(ad: str) -> str:
    """Dosya sistemi için güvenli klasör adı; [A-Za-z0-9_-] dışı varsa kısa hash."""
    if ad and len(ad) <= AD_MAX and all(c in _GUVENLI_KARAKTER for c in ad):
        return ad
    return "h" + _sha1_16(ad)


def _state_base(durum: str, oturum: str, ajan: str, normal_yol: str) -> str:
    """Ajan klasöründeki dosya önadı: ``<önad>.jsonl`` olaylar, ``<önad>.harita`` işaret."""
    return os.path.join(durum, "oturumlar", _safe_name(oturum), _safe_name(ajan),
                        _sha1_16(normal_yol))


def _line_count(veri: bytes) -> int:
    """Read aracıyla (ve harita modülüyle) uyumlu satır sayısı: yalnız b'\\n' sayılır."""
    if not veri:
        return 0
    n = veri.count(b"\n")
    return n if veri.endswith(b"\n") else n + 1


def _read_bytes(yol: str) -> bytes:
    with open(yol, "rb") as f:
        return f.read()


def _decode(veri: bytes) -> str:
    return veri.decode("utf-8", errors="replace").removeprefix("\ufeff")


def _map_text(yol: str, metin: str, en_cok_satir: int) -> str | None:
    # Tembel import: harita modülü yalnız ayrıştırma gerektiğinde yüklenir.
    from bellek.kapi.harita import harita_metni
    return harita_metni(yol, metin, en_cok_satir=en_cok_satir)


def _serialize(cikti: dict) -> str:
    # ensure_ascii: konsol/ara katman kodlamasından bağımsız, saf ASCII JSON.
    import json
    return json.dumps(cikti, ensure_ascii=True)


def _deny_output(yol: str, metin: str, ilk_harita: str) -> dict | None:
    """Sınırı aşmayan ret çıktısı; haritayı gittikçe kısaltır, sığmazsa None."""
    for i, satir in enumerate(HARITA_SATIRLARI):
        harita = ilk_harita if i == 0 else _map_text(yol, metin, satir)
        if not harita:
            return None
        cikti = {"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": harita,
        }}
        if len(_serialize(cikti)) <= CIKTI_SINIR:
            return cikti
    return None


def _covered(bas: int, son: int, onceki: list[tuple[int, int]]) -> bool:
    """[bas, son] aralığı önceki aralıkların birleşimince tümüyle kapsanıyor mu?"""
    sonraki = bas
    for a, b in sorted(onceki):
        if a > sonraki:
            break
        if b >= sonraki:
            sonraki = b + 1
            if sonraki > son:
                return True
    return sonraki > son


# ---- Durum ---------------------------------------------------------------------

def _read_events(yol: str) -> list[dict]:
    """Olay satırları; dosya yoksa boş, bozuk satırlar atlanır. Okuma hatası fırlar."""
    import json
    try:
        with open(yol, "rb") as f:
            veri = f.read()
    except FileNotFoundError:
        return []
    olaylar: list[dict] = []
    for satir in veri.splitlines():
        try:
            olay = json.loads(satir)
        except Exception:
            continue
        if isinstance(olay, dict):
            olaylar.append(olay)
    return olaylar


def _append_line(yol: str, kayit: dict) -> None:
    """Bir JSON satırını tek yazımla, paralel süreçlere karşı atomik ekler.

    Windows'ta open("a") (CRT O_APPEND) önce sona gidip sonra yazar; aynı anda
    yazan iki süreç birbirinin satırını ezer (6 paralel istekte ölçüldü). Yalnız
    FILE_APPEND_DATA haklı tutamaçta dosya sistemi her yazımı sona atomik ekler.
    """
    import json
    veri = (json.dumps(kayit, ensure_ascii=False) + "\n").encode("utf-8")
    if os.name == "nt":
        import _winapi
        tutamac = _winapi.CreateFile(yol, _FILE_APPEND_DATA, _FILE_SHARE_ALL, 0,
                                     _OPEN_ALWAYS, _FILE_ATTRIBUTE_NORMAL, 0)
        try:
            _winapi.WriteFile(tutamac, veri)
        finally:
            _winapi.CloseHandle(tutamac)
    else:
        fd = os.open(yol, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o666)
        try:
            os.write(fd, veri)
        finally:
            os.close(fd)


def _prune_sessions(kok: str, haric: str) -> None:
    """OTURUM_MAX_GUN'den eski kardeş oturum klasörlerini siler (en iyi çaba)."""
    try:
        import shutil
        import time
        sinir = time.time() - OTURUM_MAX_GUN * 86400
        with os.scandir(kok) as it:
            for e in it:
                try:
                    if (e.name != haric and e.is_dir(follow_symlinks=False)
                            and e.stat(follow_symlinks=False).st_mtime < sinir):
                        shutil.rmtree(e.path, ignore_errors=True)
                except OSError:
                    pass
    except Exception:
        pass


def _prepare_agent_dir(onad: str) -> None:
    """Ajan klasörünü kurar; yeni oturumda eski kardeşleri budar. Hata fırlatabilir."""
    ajan_klasor = os.path.dirname(onad)
    oturum_klasor = os.path.dirname(ajan_klasor)
    yeni_oturum = not os.path.isdir(oturum_klasor)
    os.makedirs(ajan_klasor, exist_ok=True)
    if yeni_oturum:
        _prune_sessions(os.path.dirname(oturum_klasor), os.path.basename(oturum_klasor))
    else:
        try:
            os.utime(oturum_klasor)  # budama için "son etkinlik" zamanı
        except OSError:
            pass


def _create_marker(yol: str) -> None:
    """Harita işaretini atomik oluşturur; zaten varsa FileExistsError fırlatır."""
    fd = os.open(yol, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    try:
        os.close(fd)
    except OSError:
        pass


def _log_decision(durum: str, kayit: dict, env: Mapping[str, str]) -> None:
    yol = os.path.join(durum, "kapi.jsonl")
    try:
        if os.stat(yol).st_size > GUNLUK_MAX_BAYT:
            os.replace(yol, yol + ".1")
    except Exception:
        pass  # yoksa ya da taşınamazsa (ör. başka süreç açık tutuyor) eklemeye devam
    try:
        os.makedirs(durum, exist_ok=True)
        _append_line(yol, kayit)
    except Exception:
        _log_exception("kapi.jsonl yazılamadı", env)


def _record_range(durum: str, onad: str, temel: dict, karar: str, bas: int,
                  son: int, mtime: int, env: Mapping[str, str]) -> None:
    """hedefli/izin: tekrarı ölçer, durum dosyasına ve ölçüm günlüğüne yazar."""
    tekrar = False
    try:
        olay_yolu = onad + ".jsonl"
        onceki: list[tuple[int, int]] = []
        for o in _read_events(olay_yolu):
            aralik = o.get("aralik")
            if (o.get("karar") in ARALIKLI_KARARLAR and o.get("mtime") == mtime
                    and isinstance(aralik, list) and len(aralik) == 2
                    and all(type(x) is int for x in aralik)):
                onceki.append((aralik[0], aralik[1]))
        tekrar = _covered(bas, son, onceki)
        _prepare_agent_dir(onad)
        _append_line(olay_yolu, {"karar": karar, "aralik": [bas, son],
                                 "mtime": mtime, "ts": temel["ts"]})
    except Exception:
        _log_exception(f"{karar} durumu yazılamadı", env)
    _log_decision(durum, {**temel, "karar": karar, "aralik": [bas, son],
                          "tekrar": tekrar}, env)


def _record_full_read(durum: str, onad: str, temel: dict, bas: int,
                      limit: int | None, veri: bytes, mtime: int,
                      env: Mapping[str, str]) -> None:
    """Harita görülmüş dosyada izin: aralık Read'in döndüreceği satırlara kırpılır."""
    son = max(bas, min(bas + (limit or READ_VARSAYILAN_LIMIT) - 1, _line_count(veri)))
    _record_range(durum, onad, temel, "izin", bas, son, mtime, env)


# ---- Karar ---------------------------------------------------------------------

def _decide(payload: Mapping[str, Any], env: Mapping[str, str]) -> dict | None:
    from collections.abc import Mapping
    # 1-3: ucuz elemeler (dosya sistemi yok)
    if (env.get("BELLEK_KAPI") or "").strip().casefold() in KAPALI_DEGERLERI:
        return None
    if payload.get("tool_name") != "Read":
        return None
    girdi = payload.get("tool_input")
    if not isinstance(girdi, Mapping):
        return None
    yol = girdi.get("file_path")
    if not isinstance(yol, str) or not yol.lower().endswith(MD_UZANTILARI):
        return None
    if not os.path.isabs(yol):
        cwd = payload.get("cwd")
        if isinstance(cwd, str) and cwd:
            yol = os.path.join(cwd, yol)

    # 4: boyut (yalnız stat)
    try:
        st = os.stat(yol)
    except (OSError, ValueError):
        return None
    import stat
    if (not stat.S_ISREG(st.st_mode)
            or st.st_size < _env_int(env, "BELLEK_KAPI_ESIK", ESIK_VARSAYILAN)):
        return None

    mutlak = os.path.abspath(yol)
    normal = os.path.normcase(mutlak)
    oturum = payload.get("session_id")
    oturum = str(oturum) if oturum not in (None, "") else BILINMEYEN_OTURUM
    ajan = payload.get("agent_id")
    ajan = str(ajan) if ajan not in (None, "") else ANA_AJAN
    durum = state_dir(env)
    onad = _state_base(durum, oturum, ajan, normal)
    isaret = onad + ".harita"
    temel = {"ts": _now_iso(), "oturum": oturum, "ajan": ajan, "yol": normal,
             "bayt": st.st_size}
    mtime = st.st_mtime_ns
    bas = _pos_int(girdi.get("offset")) or 1
    limit = _pos_int(girdi.get("limit"))

    # 5: tavan (ayrıştırma yok)
    if st.st_size > _env_int(env, "BELLEK_KAPI_TAVAN", TAVAN_VARSAYILAN):
        _log_decision(durum, {**temel, "karar": "cok_buyuk"}, env)
        return None

    # 6: hedefli okuma
    if limit is not None and limit <= _env_int(env, "BELLEK_KAPI_HEDEFLI",
                                               HEDEFLI_VARSAYILAN):
        _record_range(durum, onad, temel, "hedefli", bas, bas + limit - 1, mtime, env)
        return None

    # 7: harita görülmüş → izin (ayrıştırma ve harita importu yok)
    if os.path.exists(isaret):
        _record_full_read(durum, onad, temel, bas, limit, _read_bytes(mutlak), mtime, env)
        return None

    # 8: ayrıştır; başlık sayısı
    veri = _read_bytes(mutlak)
    metin = _decode(veri)
    harita = _map_text(mutlak, metin, HARITA_SATIRLARI[0])
    if harita is None:
        _log_decision(durum, {**temel, "karar": "az_baslik"}, env)
        return None
    cikti = _deny_output(mutlak, metin, harita)
    if cikti is None:
        _log_decision(durum, {**temel, "karar": "cok_uzun"}, env)
        return None

    # 9: işareti atomik oluşturan tek istek reddedilir; ret yalnız işaret varken döner.
    try:
        _prepare_agent_dir(onad)
        _create_marker(isaret)
    except FileExistsError:
        if os.path.isfile(isaret):  # makedirs'in FileExistsError'u değil
            # Paralel bir istek haritayı az önce verdi.
            _record_full_read(durum, onad, temel, bas, limit, veri, mtime, env)
        return None
    except Exception:
        _log_exception("harita işareti oluşturulamadı", env)
        return None
    _log_decision(durum, {**temel, "karar": "harita"}, env)
    return cikti


def run(payload: Mapping[str, Any],
        env: Mapping[str, str] | None = None) -> dict | None:
    """Reddederken stdout'a yazılacak çıktı sözlüğünü, izin verirken None döndürür."""
    from collections.abc import Mapping
    env = os.environ if env is None else env
    if not isinstance(payload, Mapping):
        return None
    try:
        return _decide(payload, env)
    except Exception:
        _log_exception(f"karar: {payload.get('tool_name')!r}", env)
        return None


def _may_concern(ham: bytes) -> bool:
    """Ucuz ön eleme (json yüklemeden): Read ve .md/.markdown izi yoksa kapı ilgisizdir.

    Claude Code payload'ı JSON.stringify ile yazar; ASCII harfler kaçışlanmaz, bu
    yüzden "Read" ve uzantı ham baytta aynen görünür. Yanılırsa sonuç yalnız izin
    olur (fail-open yönü).
    """
    if b'"Read"' not in ham:
        return False
    kucuk = ham.lower()
    return b".md" in kucuk or b".markdown" in kucuk


def main() -> int:
    try:
        ham_bayt = sys.stdin.buffer.read()
        if not _may_concern(ham_bayt):
            return 0
        import json
        ham = ham_bayt.decode("utf-8", errors="replace").lstrip("\ufeff")
        cikti = run(json.loads(ham))
        if cikti:
            sys.stdout.buffer.write(_serialize(cikti).encode("ascii"))
            sys.stdout.buffer.flush()
    except BaseException as e:  # noqa: BLE001 — fail-open
        if isinstance(e, KeyboardInterrupt):
            return 0
        _log_exception("PreToolUse", None)
    return 0


if __name__ == "__main__":
    try:
        _src = os.path.dirname(os.path.dirname(os.path.dirname(
            os.path.realpath(__file__))))
        if _src not in sys.path:
            sys.path.insert(0, _src)
        _kod = main()
    except BaseException:
        _kod = 0
    sys.exit(_kod)
