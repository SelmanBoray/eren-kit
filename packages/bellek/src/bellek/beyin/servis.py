"""Beyin servisi: veritabanının tek yazarı, 127.0.0.1 üzerinde JSON HTTP API."""
from __future__ import annotations

import errno
import hashlib
import hmac
import html
import importlib
import json
import mimetypes
import os
import queue
import re
import secrets
import socket
import socketserver
import sqlite3
import sys
import tempfile
import threading
import time
import traceback
from collections import OrderedDict
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

SURUM = 1
VARSAYILAN_PORT = 47321
WEB_KOK = Path(__file__).resolve().parent / "web"
MAX_GOVDE = 1024 * 1024  # 1 MB
SOKET_ZAMAN_ASIMI = 10.0
# Bağlantı kapanırken istemcinin hâlâ gönderdiği (okunmamış) baytlar en çok bu kadar süre ve
# bayt boyunca okunup atılır; sonra soket kapatılır (bkz. Isleyici.finish).
BOSALTMA_SURESI = 2.0
BOSALTMA_SINIRI = 4 * MAX_GOVDE
KUYRUK_ARALIK = 60.0
ISTEK_ID_SINIRI = 10_000
YAZ_ALANLARI = ("metin", "dugum_id", "ebeveyn", "baslik", "gizlilik", "kaynak")
DUZELT_ALANLARI = ("dugum_id", "ozet", "ayrinti", "eskit", "kaynak")
# duzelt istek_id'leri yaz ile aynı kalıcı depoyu paylaşır; anahtar önekiyle ayrılır ki
# aynı istek_id iki uçta kullanılırsa biri ötekinin sonucunu döndürmesin.
DUZELT_ISTEK_ONEKI = "duzelt:"
BELIRTEC_BASLIGI = "X-Beyin-Token"
ARAYUZ_BASLIGI = "X-Beyin-Arayuz"
_GUVENLI_STATIK = re.compile(r"^[\w.\- /]+$")
UI_ONEK = "/api/ui/"
# Tüm yanıtlara eklenir (statik dahil). CORS başlığı bilinçli olarak YOK.
GUVENLIK_BASLIKLARI = (
    ("Content-Security-Policy",
     "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
     "connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"),
    ("Referrer-Policy", "no-referrer"),
    ("X-Frame-Options", "DENY"),
    ("Cross-Origin-Resource-Policy", "same-origin"),
    ("X-Content-Type-Options", "nosniff"),
)
# Windows kayıt defteri mimetypes'ı bozabilir (ör. .js -> text/plain): temel türler sabit.
STATIK_TURLER = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
}
_UI_SAYI = re.compile(r"[0-9]{1,18}")


# --------------------------------------------------------------------- yollar
def _veri_klasoru() -> Path:
    from bellek.platform_dirs import data_dir

    return data_dir()


def _durum_klasoru() -> Path:
    """Kilit ve istek_id deposu: veritabanının yanında (varsayılanda %LOCALAPPDATA%\\Bellek)."""
    v = os.environ.get("BELLEK_BEYIN_DB")
    return Path(v).resolve().parent if v else _veri_klasoru()


def _kuyruk_yolu() -> Path:
    v = os.environ.get("BELLEK_BEYIN_KUYRUK")
    return Path(v) if v else _veri_klasoru() / "beyin_kuyruk.jsonl"


def _log_yolu() -> Path:
    v = os.environ.get("BELLEK_BEYIN_LOG")
    return Path(v) if v else _veri_klasoru() / "beyin_servis.log"


def _token_yolu() -> Path:
    v = os.environ.get("BELLEK_BEYIN_TOKEN_DOSYA")
    return Path(v) if v else _veri_klasoru() / "beyin_token"


def _kuyruk_araligi() -> float:
    try:
        return max(0.05, float(os.environ.get("BELLEK_BEYIN_KUYRUK_ARALIK") or KUYRUK_ARALIK))
    except ValueError:
        return KUYRUK_ARALIK


_log_kilit = threading.Lock()


def gunluk(mesaj: str) -> None:
    try:
        yol = _log_yolu()
        yol.parent.mkdir(parents=True, exist_ok=True)
        with _log_kilit, open(yol, "a", encoding="utf-8") as f:
            f.write(f"{datetime.now().isoformat(timespec='seconds')} {mesaj}\n")
    except Exception:
        pass


def _mod(ad: str):
    """Kardeş modülü tembel yükle (paket içi ya da düz içe aktarma)."""
    if __package__:
        return importlib.import_module(f".{ad}", __package__)
    return importlib.import_module(ad)


ASISTAN_YER_TUTUCU = "{{ASISTAN_ADI}}"


def _asistan_adi() -> str:
    """Arayüzde gösterilen asistan adı (EREN_KIT_ASSISTANT_NAME, yoksa "Claude")."""
    try:
        from bellek.asistan import asistan_adi
    except ImportError:  # düz içe aktarma: paket yoksa aynı kural
        return " ".join((os.environ.get("EREN_KIT_ASSISTANT_NAME") or "").split())[:40] or "Claude"
    return asistan_adi()


def _sayfa_doldur(ham: bytes) -> bytes:
    """index.html'deki asistan adı yer tutucusunu HTML-kaçışlı adla doldurur."""
    ad = html.escape(_asistan_adi(), quote=True)
    return ham.decode("utf-8").replace(ASISTAN_YER_TUTUCU, ad).encode("utf-8")


class GecersizIstek(Exception):
    pass


class Reddedildi(Exception):
    def __init__(self, kod: int, mesaj: str) -> None:
        super().__init__(mesaj)
        self.kod = kod


class ServisBaslatilamadi(RuntimeError):
    pass


class ServisCakismasi(ServisBaslatilamadi):
    """Kilit ya da port başka bir süreçte: yeniden başlatmak durumu düzeltmez."""


class ServisZatenCalisiyor(ServisCakismasi):
    pass


class PortKullanimda(ServisCakismasi):
    pass


# Gözetmen (macOS launchd, KeepAlive SuccessfulExit=false) bu değişkeni "1" verir: çakışmada
# 0 ile çıkılır ki launchd sonsuza dek yeniden denemesin. Port önce bir süre beklenir (çökmeden
# hemen sonra eski bağlantıların TIME_WAIT'i portu kısa süre tutabilir). Verilmezse (Windows
# Görev Zamanlayıcı, elle başlatma) davranış aynıdır: her başlatma hatası çıkış kodu 1.
CAKISMADA_TEMIZ_CIK = "BELLEK_BEYIN_CAKISMADA_TEMIZ_CIK"
PORT_BEKLEME = 60.0
PORT_BEKLEME_ARALIK = 2.0
_PORT_DOLU = {errno.EADDRINUSE, 10048}  # 10048: WSAEADDRINUSE


# ------------------------------------------------------------ belirteç, kilit
def _belirtec_dosyasi_hazirla(yol: Path, yasak: str | None = None) -> str:
    """Dosya yoksa 32 bayt rastgele hex üretip yazar; değeri döndürür.
    `yasak` verilirse o değere eşit (ya da boş/kısa) dosyanın üzerine yeni değer yazılır."""
    yol.parent.mkdir(parents=True, exist_ok=True)

    def gecersiz(d: str) -> bool:
        return len(d) < 32 or (yasak is not None and hmac.compare_digest(d.encode("utf-8"), yasak.encode("utf-8")))

    for _ in range(3):
        try:
            deger = yol.read_text(encoding="utf-8").strip()
            if not gecersiz(deger):
                return deger
        except FileNotFoundError:
            pass
        except OSError as e:
            raise ServisBaslatilamadi(f"Belirteç dosyası okunamadı ({yol}): {type(e).__name__}")
        yeni = secrets.token_hex(32)
        while yasak is not None and yeni == yasak:
            yeni = secrets.token_hex(32)
        try:
            with open(yol, "x", encoding="utf-8") as f:  # yarış olursa kazananın değeri okunur
                f.write(yeni)
            return yeni
        except FileExistsError:
            # boş/kısa (ya da yasak değerli) dosya: üzerine yaz
            try:
                if gecersiz(yol.read_text(encoding="utf-8").strip()):
                    yol.write_text(yeni, encoding="utf-8")
                    return yeni
            except OSError:
                pass
    raise ServisBaslatilamadi(f"Belirteç dosyası hazırlanamadı: {yol}")


def belirtec_hazirla() -> str:
    """beyin_token yoksa 32 bayt rastgele hex üretip yazar; değeri döndürür."""
    return _belirtec_dosyasi_hazirla(_token_yolu())


def arayuz_belirtec_yolu() -> Path:
    """Arayüz kapsamlı belirtecin dosyası: BELLEK_BEYIN_ARAYUZ_TOKEN_DOSYA ya da veri klasöründe beyin_arayuz_token."""
    v = os.environ.get("BELLEK_BEYIN_ARAYUZ_TOKEN_DOSYA")
    return Path(v) if v else _veri_klasoru() / "beyin_arayuz_token"


def _belirtec_oku(yol: Path) -> str | None:
    try:
        d = yol.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return d if len(d) >= 32 else None


def arayuz_belirtec_hazirla() -> str:
    """beyin_arayuz_token yoksa üretip yazar; değeri döndürür. Ana belirteçle aynı değer
    asla kullanılmaz (öyleyse yeniden üretilir). Ana belirteç dosyası burada oluşturulmaz."""
    return _belirtec_dosyasi_hazirla(arayuz_belirtec_yolu(), yasak=_belirtec_oku(_token_yolu()))


class TekSurecKilidi:
    """Durum klasöründe kilit dosyası; ikinci servis açılmaz."""

    def __init__(self, klasor: Path) -> None:
        klasor.mkdir(parents=True, exist_ok=True)
        self.yol = klasor / "beyin_servis.lock"
        self.f = open(self.yol, "a+b")
        try:
            if sys.platform == "win32":
                import msvcrt
                self.f.seek(0)
                msvcrt.locking(self.f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.f.close()
            raise ServisZatenCalisiyor(
                f"Başka bir beyin servisi zaten çalışıyor (kilit dosyası: {self.yol}). "
                "Tek yazar kuralı gereği ikinci servis açılmaz."
            )

    def birak(self) -> None:
        try:
            if sys.platform == "win32":
                import msvcrt
                self.f.seek(0)
                msvcrt.locking(self.f.fileno(), msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
        try:
            self.f.close()
        except OSError:
            pass


# ------------------------------------------------------------- istek_id deposu
class IstekDeposu:
    """İşlenmiş istek_id -> sonuç; kalıcı (jsonl), son ISTEK_ID_SINIRI kayıt. Yalnız yazar iş parçacığında."""

    def __init__(self, yol: Path) -> None:
        self.yol = yol
        self.kayitlar: OrderedDict[str, dict] = OrderedDict()
        self.satir = 0
        try:
            with open(yol, encoding="utf-8", errors="replace") as f:
                for s in f:
                    self.satir += 1
                    try:
                        k = json.loads(s)
                        self.kayitlar[str(k["istek_id"])] = k["sonuc"]
                        self.kayitlar.move_to_end(str(k["istek_id"]))
                    except Exception:
                        continue
        except FileNotFoundError:
            pass
        except OSError as e:
            gunluk(f"istek deposu okunamadı: {type(e).__name__}")
        self._kirp()
        if self.satir > len(self.kayitlar):
            self._yeniden_yaz()

    def _kirp(self) -> None:
        while len(self.kayitlar) > ISTEK_ID_SINIRI:
            self.kayitlar.popitem(last=False)

    def _yeniden_yaz(self) -> None:
        try:
            gecici = self.yol.with_name(self.yol.name + ".tmp")
            with open(gecici, "w", encoding="utf-8") as f:
                for i, s in self.kayitlar.items():
                    f.write(json.dumps({"istek_id": i, "sonuc": s}, ensure_ascii=False, default=str) + "\n")
            os.replace(gecici, self.yol)
            self.satir = len(self.kayitlar)
        except OSError as e:
            gunluk(f"istek deposu yeniden yazılamadı: {type(e).__name__}")

    def al(self, istek_id: str):
        return self.kayitlar.get(istek_id)

    def ekle(self, istek_id: str, sonuc) -> None:
        self.kayitlar[istek_id] = sonuc
        self.kayitlar.move_to_end(istek_id)
        self._kirp()
        try:
            with open(self.yol, "a", encoding="utf-8") as f:
                f.write(json.dumps({"istek_id": istek_id, "sonuc": sonuc}, ensure_ascii=False, default=str) + "\n")
            self.satir += 1
        except OSError as e:
            gunluk(f"istek deposu yazılamadı: {type(e).__name__}")
        if self.satir > 2 * ISTEK_ID_SINIRI:
            self._yeniden_yaz()


# ---------------------------------------------------------------------- durum
class Durum:
    """Tek yazar: bağlantı özel bir iş parçacığında açılıp yalnız orada kullanılır
    (sqlite3 iş parçacığı kuralı); yazmalar bir kuyruk üzerinden sıraya girer.
    Okumalar her çağrıda kısa ömürlü, ayrı salt okunur bağlantıyla yapılır (yazara düşmez)."""

    def __init__(self) -> None:
        self.db = _mod("db")
        self.is_kuyrugu: queue.Queue = queue.Queue()
        self.hazir = threading.Event()
        self.acilis_hatasi: BaseException | None = None
        self.yazar = threading.Thread(target=self._yazar_dongusu, name="beyin-yazar", daemon=True)
        self.yazar.start()
        self.hazir.wait()
        if self.acilis_hatasi is not None:
            raise self.acilis_hatasi

    def _yazar_dongusu(self) -> None:
        try:
            con = self.db.baglan()
            # Kök düğüm okuma bağlantılarından önce var olsun; commit edilmemiş işlem kalmasın.
            try:
                self.db.kok_id(con)
                con.commit()
            except Exception:
                try:
                    con.rollback()
                except Exception:
                    pass
                gunluk("kök düğüm hazırlanamadı: " + traceback.format_exc().splitlines()[-1])
            self.istekler = IstekDeposu(_durum_klasoru() / "beyin_istekler.jsonl")
        except BaseException as e:  # noqa: BLE001
            self.acilis_hatasi = e
            self.hazir.set()
            return
        self.hazir.set()
        while True:
            is_ = self.is_kuyrugu.get()
            if is_ is None:
                break
            fn, a, kw, sonuc = is_
            try:
                sonuc.put((True, fn(con, *a, **kw)))
            except BaseException as e:  # noqa: BLE001
                try:
                    con.rollback()
                except Exception:
                    pass
                sonuc.put((False, e))
        try:
            con.close()
        except Exception:
            pass

    def yaz_cagir(self, fn, *a, **kw):
        sonuc: queue.Queue = queue.Queue(1)
        self.is_kuyrugu.put((fn, a, kw, sonuc))
        tamam, deger = sonuc.get()
        if tamam:
            return deger
        raise deger

    def _tekil(self, con, islev: str, kw: dict, anahtar: str | None):
        """Yazar iş parçacığında: anahtar daha önce işlendiyse önceki sonuç, yoksa yaz.<islev>.
        Geçici hata ve red kaydedilmez (yeniden denenebilsin)."""
        if anahtar is not None:
            onceki = self.istekler.al(anahtar)
            if onceki is not None:
                return onceki
        sonuc = getattr(_mod("yaz"), islev)(con, **kw)
        if (anahtar is not None and not _gecici(sonuc)
                and not (isinstance(sonuc, dict) and sonuc.get("sonuc") == "reddedildi")):
            self.istekler.ekle(anahtar, sonuc)
        return sonuc

    def _yaz_tekil(self, con, kw: dict, istek_id: str | None):
        return self._tekil(con, "yaz", kw, istek_id)

    def yaz_tekil(self, kw: dict, istek_id: str | None = None):
        """yaz() çağrısı; aynı istek_id ikinci kez yazılmaz, önceki sonuç döner."""
        return self.yaz_cagir(self._yaz_tekil, kw, istek_id)

    def duzelt_tekil(self, kw: dict, istek_id: str | None = None):
        """duzelt() çağrısı; aynı istek_id ikinci kez yazılmaz, önceki sonuç döner.
        Anahtar DUZELT_ISTEK_ONEKI ile yaz istek_id'lerinden ayrılır."""
        anahtar = None if istek_id is None else DUZELT_ISTEK_ONEKI + istek_id
        return self.yaz_cagir(self._tekil, "duzelt", kw, anahtar)

    def oku_cagir(self, fn, *a, **kw):
        con = self.db.baglan(salt_okunur=True)
        try:
            return fn(con, *a, **kw)
        finally:
            try:
                con.close()
            except Exception:
                pass

    def kapat(self) -> None:
        self.is_kuyrugu.put(None)
        self.yazar.join(timeout=5)


# --------------------------------------------------------------------- kuyruk
_kuyruk_kilit = threading.Lock()
_gecici_sayac: dict[int, int] = {}  # satır özeti -> art arda geçici hata sayısı (içerik tutulmaz)
GECICI_UYARI_ESIGI = 10


def _gecici(sonuc) -> bool:
    return isinstance(sonuc, dict) and bool(sonuc.get("gecici_hata"))


def _kuyruk_dosyasi_isle(durum: Durum, dosya: Path, islenmis: Path) -> int:
    """Bir .isleniyor dosyasını işler. Geçici hata alan satırlar dosyada kalır; yoksa dosya silinir."""
    try:
        satirlar = dosya.read_bytes().decode("utf-8", errors="replace").splitlines()
    except OSError as e:
        gunluk(f"kuyruk dosyası okunamadı: {type(e).__name__}")
        return 0
    sayi = 0
    kalan: list[str] = []
    for no, satir in enumerate(satirlar, 1):
        if not satir.strip():
            continue
        try:
            veri = json.loads(satir)
            if not isinstance(veri, dict) or not isinstance(veri.get("metin"), str):
                raise ValueError("biçim")
            istek_id = veri.get("istek_id")
            if istek_id is not None and (not isinstance(istek_id, str) or not istek_id):
                raise ValueError("istek_id")
            kw = {k: veri[k] for k in YAZ_ALANLARI if k in veri}
            sonuc = durum.yaz_tekil(kw, istek_id)
        except sqlite3.OperationalError as e:
            kalan.append(satir)
            gunluk(f"kuyruk satır {no} sonraya bırakıldı: {type(e).__name__}")
            continue
        except Exception as e:
            gunluk(f"kuyruk satır {no} atlandı: {type(e).__name__}")
            continue
        ozet = hash(satir)
        if _gecici(sonuc):
            kalan.append(satir)  # silinmez; sonraki turda yeniden denenir
            n = _gecici_sayac[ozet] = _gecici_sayac.get(ozet, 0) + 1
            if n > GECICI_UYARI_ESIGI and (n - 1) % GECICI_UYARI_ESIGI == 0:
                gunluk(f"UYARI: kuyruk satır {no} {n} turdur geçici hata alıyor (silinmedi)")
            continue
        _gecici_sayac.pop(ozet, None)
        sayi += 1
        d = sonuc if isinstance(sonuc, dict) else {}
        kayit = {
            "istek_id": istek_id,
            "zaman": datetime.now().isoformat(timespec="seconds"),
            "sonuc": d.get("sonuc"),
            "dugum_id": d.get("dugum_id"),
        }
        try:
            with open(islenmis, "a", encoding="utf-8") as f:
                f.write(json.dumps(kayit, ensure_ascii=False, default=str) + "\n")
        except OSError as e:
            gunluk(f"islenmiş kuyruk yazılamadı: {type(e).__name__}")
    try:
        if kalan:
            gecici = dosya.with_name(dosya.name + ".tmp")
            gecici.write_text("\n".join(kalan) + "\n", encoding="utf-8")
            os.replace(gecici, dosya)
        else:
            dosya.unlink()
    except OSError as e:
        gunluk(f"kuyruk dosyası temizlenemedi: {type(e).__name__}")
    return sayi


def kuyruk_bosalt(durum: Durum) -> int:
    """Köprünün çevrimdışı biriktirdiği yazmaları işle; işlenen sayıyı döndürür.

    Güvenli sıra: önce önceki turdan kalan `*.isleniyor` dosyaları, sonra kuyruk benzersiz bir
    adla yeniden adlandırılıp işlenir. Dosyalar hiçbir zaman birleştirilmez (ekle-sonra-sil yok);
    çökme sonrası yeniden işleme istek_id ile tekilleşir."""
    with _kuyruk_kilit:
        kuyruk = _kuyruk_yolu()
        islenmis = kuyruk.with_name("beyin_kuyruk.islenmis.jsonl")
        sayi = 0
        try:
            if kuyruk.exists() and kuyruk.stat().st_size > 0:
                hedef = kuyruk.with_name(f"{kuyruk.name}.{secrets.token_hex(4)}.isleniyor")
                for deneme in range(4):
                    try:
                        os.replace(kuyruk, hedef)
                        break
                    except FileNotFoundError:
                        break
                    except OSError as e:
                        if deneme == 3:
                            gunluk(f"kuyruk yeniden adlandırılamadı, sonraki turda denenecek: {type(e).__name__}")
                        else:
                            threading.Event().wait(0.2)
            bekleyenler = sorted(kuyruk.parent.glob(glob_kacis(kuyruk.name) + ".*.isleniyor"))
        except OSError as e:
            gunluk(f"kuyruk taranamadı: {type(e).__name__}")
            return 0
        for b in bekleyenler:
            sayi += _kuyruk_dosyasi_isle(durum, b, islenmis)
        if sayi:
            gunluk(f"kuyruktan {sayi} yazma işlendi")
        return sayi


def glob_kacis(ad: str) -> str:
    return re.sub(r"([\[\]*?])", r"[\1]", ad)


# --------------------------------------------------------------- yardımcılar
def _tam_sayi(q: dict, ad: str, varsayilan=None, *, zorunlu=False):
    v = q.get(ad, [None])[0]
    if v is None or v == "":
        if zorunlu:
            raise GecersizIstek(f"'{ad}' gerekli")
        return varsayilan
    try:
        return int(v)
    except ValueError:
        raise GecersizIstek(f"'{ad}' tam sayı olmalı")


def _metin(q: dict, ad: str, *, zorunlu=False):
    v = q.get(ad, [None])[0]
    if v is None or v == "":
        if zorunlu:
            raise GecersizIstek(f"'{ad}' gerekli")
        return None
    return v


def _istek_id(g: dict) -> str | None:
    """POST gövdesindeki isteğe bağlı istek_id: boş olmayan, ≤200 karakterlik metin."""
    istek_id = g.get("istek_id")
    if istek_id is not None and (not isinstance(istek_id, str) or not istek_id or len(istek_id) > 200):
        raise GecersizIstek("'istek_id' boş olmayan kısa bir metin olmalı")
    return istek_id


def _ui_sayi(q: dict, ad: str, varsayilan: int | None = None, *, en_az: int = 0,
             en_cok: int | None = None) -> int:
    """/api/ui/* sayısal parametresi: yalnız ASCII rakam; aralık dışı ya da sayı değilse GecersizIstek (400)."""
    v = q.get(ad, [None])[0]
    if v is None or v == "":
        if varsayilan is None:
            raise GecersizIstek(f"'{ad}' gerekli")
        return varsayilan
    if not _UI_SAYI.fullmatch(v):
        raise GecersizIstek(f"'{ad}' negatif olmayan tam sayı olmalı")
    n = int(v)
    if n < en_az or (en_cok is not None and n > en_cok):
        aralik = f"{en_az}..{en_cok}" if en_cok is not None else f"≥{en_az}"
        raise GecersizIstek(f"'{ad}' {aralik} aralığında olmalı")
    return n


def _ui_bayrak(q: dict, ad: str) -> bool:
    v = q.get(ad, [""])[0].strip().lower()
    if v in ("", "0", "false"):
        return False
    if v in ("1", "true"):
        return True
    raise GecersizIstek(f"'{ad}' 0 ya da 1 olmalı")


def _ui_yolu(yol: str) -> bool:
    return yol == UI_ONEK[:-1] or yol.startswith(UI_ONEK)


def _statik_istek_yolu(yol: str) -> bool:
    return yol == "/" or yol.startswith("/static/")


def _ui_gelen_karar_yaz(con, gid: str, karar: str, duzeltme):
    """Yazar iş parçacığında: gelen kaydı yoksa None (-> 404), varsa yaz.gelen_karar.
    Varlık denetimi ile karar aynı kuyruk işinde: arada başka yazma giremez."""
    if con.execute("SELECT 1 FROM gelen WHERE id = ?", (gid,)).fetchone() is None:
        return None
    return _mod("yaz").gelen_karar(con, gid, karar, duzeltme=duzeltme)


def _gelen_karar_uygula(durum: "Durum", gid: str, karar: str, duzeltme, *,
                        ui: bool = False) -> tuple[int, dict]:
    """yaz.gelen_karar'ı yazar kuyruğunda çağırır; (HTTP kodu, gövde) döndürür.
    gelen_karar hata durumunu (yok / zaten karara bağlı / geçersiz karar) reddedildi diye döndürür;
    başarılı 'red' kararında gelen_id vardır.
    - ui=False (/api/gelen/<id>, eski davranış): mesajda ' yok.' -> 404, diğer red -> 400.
    - ui=True (/api/ui/gelen/karar): 404 yalnız gelen kaydı veritabanında yoksa; diğer her red 400."""
    if ui:
        sonuc = durum.yaz_cagir(_ui_gelen_karar_yaz, gid, karar, duzeltme)
        if sonuc is None:
            return 404, {"hata": f"gelen #{gid} yok."[:300]}
    else:
        sonuc = durum.yaz_cagir(_mod("yaz").gelen_karar, gid, karar, duzeltme=duzeltme)
    if (isinstance(sonuc, dict) and sonuc.get("sonuc") == "reddedildi"
            and "gelen_id" not in sonuc):
        mesaj = str(sonuc.get("mesaj", ""))
        kod = 400 if ui else (404 if " yok." in mesaj else 400)
        return kod, {"hata": mesaj[:300], **sonuc}
    return 200, sonuc


def _ui_duzeltme(d) -> dict | None:
    """/api/ui/gelen/karar düzeltmesi (sözleşme §3): null, tam {"dugum_id"} ya da tam
    {"ebeveyn", "baslik"}; değerler boş olmayan metin. Başka anahtar (metin, gizlilik, ...)
    önerinin içeriğini/gizliliğini değiştirebileceği için reddedilir."""
    if d is None:
        return None
    if not isinstance(d, dict):
        raise GecersizIstek("'duzeltme' bir nesne ya da null olmalı")
    if set(d) not in ({"dugum_id"}, {"ebeveyn", "baslik"}):
        raise GecersizIstek("'duzeltme' yalnız {dugum_id} ya da {ebeveyn, baslik} olabilir")
    for k, v in d.items():
        if not isinstance(v, str) or not v.strip():
            raise GecersizIstek(f"'duzeltme.{k}' boş olmayan metin olmalı")
    return {k: d[k] for k in d}


BOS_SAYFA = (
    "<!doctype html><meta charset=utf-8><title>Beyin</title>"
    "<body><h1>Beyin</h1>"
    "<p>Arayüz henüz yok. API: <a href='/api/saglik'>/api/saglik</a></p></body>"
)
_BOS_SAYFA_HAM = BOS_SAYFA.encode("utf-8")


# Statik dosya önbelleği: yol -> (imza, asistan adı ya da None, gövde, ETag). İmza (mtime_ns,
# boyut, inode); dosya değişince (yerinde yazma ya da yeniden adlandırarak değiştirme) imza
# değişir ve dosya yeniden okunur. Böylece her istekte yalnız stat yapılır, okuma + özet yalnız
# değişimde. web/ klasörü küçük ve sabittir; yine de sınır aşılırsa önbellek boşaltılır.
_STATIK_ONBELLEK: dict[str, tuple] = {}
_STATIK_ONBELLEK_SINIRI = 256
_statik_kilit = threading.Lock()
_ETAG_OGESI = re.compile(r'(?:W/)?"([^"]*)"')


def _etag(govde: bytes) -> str:
    """İçeriğe bağlı güçlü ETag (SHA-256'nın ilk 128 biti)."""
    return '"' + hashlib.sha256(govde).hexdigest()[:32] + '"'


_BOS_SAYFA_ETAG = _etag(_BOS_SAYFA_HAM)


def _statik_icerik(hedef: Path, sayfa: bool) -> tuple[bytes, str]:
    """(gövde, ETag). sayfa=True: index.html, asistan adı yer tutucusu doldurulmuş olarak."""
    st = hedef.stat()
    imza = (st.st_mtime_ns, st.st_size, st.st_ino)
    ad = _asistan_adi() if sayfa else None
    anahtar = str(hedef)
    with _statik_kilit:
        kayit = _STATIK_ONBELLEK.get(anahtar)
    if kayit is not None and kayit[0] == imza and kayit[1] == ad:
        return kayit[2], kayit[3]
    ham = hedef.read_bytes()
    govde = _sayfa_doldur(ham) if sayfa else ham
    etag = _etag(govde)
    with _statik_kilit:
        if len(_STATIK_ONBELLEK) >= _STATIK_ONBELLEK_SINIRI:
            _STATIK_ONBELLEK.clear()
        _STATIK_ONBELLEK[anahtar] = (imza, ad, govde, etag)
    return govde, etag


def _etag_eslesir(basliklar: list[str], etag: str) -> bool:
    """If-None-Match (RFC 9110 §13.1.2): '*' ya da virgüllü listede zayıf karşılaştırmayla eşleşme."""
    if not basliklar:
        return False
    beklenen = etag.strip('"')
    for b in basliklar:
        if b.strip() == "*":
            return True
        if any(o == beklenen for o in _ETAG_OGESI.findall(b)):
            return True
    return False


def _statik_yol_guvenli(rel: str) -> bool:
    """resolve()'dan önce: yalnız web/ altındaki düz göreli yollar."""
    if not rel or not _GUVENLI_STATIK.match(rel):
        return False
    if ".." in rel or ":" in rel or "\\" in rel or "//" in rel or rel.startswith("/"):
        return False
    return all(p and not p.endswith((".", " ")) for p in rel.split("/"))


# ------------------------------------------------------------------ işleyici
def _izinli_hostlar_oku() -> frozenset[str]:
    """BELLEK_BEYIN_IZINLI_HOST: virgülle ayrılmış ek Host değerleri (tam eşleşme, küçük harf)."""
    ham = os.environ.get("BELLEK_BEYIN_IZINLI_HOST") or ""
    return frozenset(o.strip().lower() for o in ham.split(",") if o.strip())


def _yapilandir(durum: Durum, belirtec: str, sunucu_ref: list, arayuz_belirtec: str | None = None):
    ek_hostlar = _izinli_hostlar_oku()  # sunucu kurulurken bir kez okunur
    if arayuz_belirtec is not None and (
            len(arayuz_belirtec) < 32
            or hmac.compare_digest(arayuz_belirtec.encode("utf-8"), belirtec.encode("utf-8"))):
        arayuz_belirtec = None  # güvensiz: arayüz uçları tümüyle kapalı (401)

    class Isleyici(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "BeyinServis/1"
        timeout = SOKET_ZAMAN_ASIMI

        def log_message(self, *a, **k):  # sessiz (başlıklar, dolayısıyla belirteçler, günlüğe girmez)
            pass

        def finish(self):
            """Nazik kapanış (lingering close). Erken reddedilen bir isteğin gövdesi (ya da
            send_error yollarında isteğin kalanı) okunmadan soket kapatılırsa işletim sistemi
            FIN yerine RST gönderir; Windows istemcisi tamponundaki yanıtı atıp bağlantı hatası
            görür. Önce yanıt boşaltılır ve yazma yönü kapatılır (FIN), sonra istemcinin
            gönderdikleri sınırlı süre/bayt boyunca okunup işlenmeden atılır."""
            try:
                super().finish()
            finally:
                self._kalan_bosalt()

        def _kalan_bosalt(self) -> None:
            s = self.connection
            try:
                s.shutdown(socket.SHUT_WR)
            except OSError:
                return
            son = time.monotonic() + BOSALTMA_SURESI
            okunan = 0
            try:
                while okunan < BOSALTMA_SINIRI:
                    kalan = son - time.monotonic()
                    if kalan <= 0:
                        break
                    s.settimeout(kalan)
                    parca = s.recv(65536)
                    if not parca:
                        break
                    okunan += len(parca)
            except OSError:  # zaman aşımı ya da istemci bağlantıyı kesti
                pass

        def _govde_bildirildi(self) -> bool:
            """İstek bir gövde bildiriyor mu (Content-Length > 0, geçersiz ya da yinelenmiş
            Content-Length, ya da Transfer-Encoding)?"""
            if self.headers.get("Transfer-Encoding") is not None:
                return True
            uzunluklar = self.headers.get_all("Content-Length") or []
            return len(uzunluklar) > 1 or any(u.strip() != "0" for u in uzunluklar)

        def _yol(self) -> str:
            return urlsplit(self.path).path

        def _gonder(self, kod, govde: bytes, tur: str, etag: str | None = None):
            """etag verilirse (yalnız statik dosyalar) yanıt saklanabilir ama her kullanımda
            doğrulanır (no-cache + ETag); verilmezse no-store (API ve hata yanıtları)."""
            self.send_response(kod)
            self.send_header("Content-Type", tur)
            self.send_header("Content-Length", str(len(govde)))
            self._onbellek_basliklari(etag)
            for ad, deger in GUVENLIK_BASLIKLARI:
                self.send_header(ad, deger)
            if self.close_connection:
                self.send_header("Connection", "close")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(govde)

        def _onbellek_basliklari(self, etag: str | None) -> None:
            if etag is None:
                self.send_header("Cache-Control", "no-store")
            else:
                self.send_header("Cache-Control", "no-cache")
                self.send_header("ETag", etag)

        def _statik_gonder(self, govde: bytes, tur: str, etag: str) -> None:
            """Statik yanıt: If-None-Match geçerli ETag'le eşleşirse gövdesiz 304, yoksa 200.
            Yalnız güvenlik denetimlerinden (_denetle) ve yol doğrulamasından sonra çağrılır."""
            if not _etag_eslesir(self.headers.get_all("If-None-Match") or [], etag):
                return self._gonder(200, govde, tur, etag)
            self.send_response(304)
            self._onbellek_basliklari(etag)
            for ad, deger in GUVENLIK_BASLIKLARI:
                self.send_header(ad, deger)
            if self.close_connection:
                self.send_header("Connection", "close")
            self.end_headers()

        def send_error(self, code, message=None, explain=None):
            """http.server'ın kendi hata yanıtları (bozuk istek satırı, tanımsız yöntem) da
            güvenlik başlıklarıyla ve JSON gövdeyle gider; istek metni yansıtılmaz.
            Tanımsız yöntemler (PUT, DELETE, PATCH, ...) 501 yerine 403 alır."""
            self.close_connection = True
            if code == 501:
                code, mesaj = 403, "bu yöntem kabul edilmez"
            else:
                mesaj = {400: "istek geçersiz", 408: "istek zaman aşımına uğradı",
                         414: "adres çok uzun", 431: "başlıklar çok büyük"}.get(code, "istek reddedildi")
            try:
                self._hata(code, mesaj)
            except Exception:
                pass

        def do_OPTIONS(self):
            # Ön uçuş (CORS) her yolda reddedilir; Access-Control-Allow-* hiçbir zaman gönderilmez.
            self.close_connection = True
            self._hata(403, "OPTIONS kabul edilmez")

        def _json(self, kod, nesne):
            b = json.dumps(nesne, ensure_ascii=False, default=str).encode("utf-8")
            self._gonder(kod, b, "application/json; charset=utf-8")

        def _hata(self, kod, mesaj):
            self._json(kod, {"hata": str(mesaj)[:300]})

        def _govde_json(self) -> dict:
            # Parçalı (chunked) gövde okunmaz; Content-Length ile birlikte gelirse gövdenin sınırı
            # belirsizdir (istek kaçakçılığı). Yinelenmiş Content-Length de aynı nedenle reddedilir.
            if self.headers.get("Transfer-Encoding") is not None:
                raise GecersizIstek("Transfer-Encoding desteklenmez; Content-Length kullanın")
            if len(self.headers.get_all("Content-Length") or []) > 1:
                raise GecersizIstek("Content-Length geçersiz")
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                raise GecersizIstek("Content-Length geçersiz")
            if n < 0:
                raise GecersizIstek("Content-Length geçersiz")
            if n > MAX_GOVDE:
                raise Reddedildi(413, "gövde çok büyük")
            if n == 0:
                return {}
            ham = self.rfile.read(n)
            self._govde_okundu = True
            if len(ham) < n:
                self.close_connection = True
                raise GecersizIstek("gövde eksik")
            try:
                v = json.loads(ham.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                raise GecersizIstek("gövde geçerli UTF-8 JSON değil")
            if not isinstance(v, dict):
                raise GecersizIstek("gövde bir JSON nesnesi olmalı")
            return v

        # -- güvenlik denetimleri (Host, Origin, Content-Type, belirteç)
        def _icerik_turu_denetle(self) -> None:
            tur = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if tur != "application/json":
                raise Reddedildi(415, "Content-Type application/json olmalı")

        def _ayni_koken_denetle(self, host: str) -> None:
            """Origin ya yok ya da tam olarak http://<Host>."""
            koken = self.headers.get("Origin")
            if koken is not None and koken.strip().lower() != "http://" + host:
                raise Reddedildi(403, "Origin kabul edilmez")

        def _ui_denetle(self, host: str, post: bool) -> None:
            """/api/ui/* kolu. Sıra: kökence (Origin, Sec-Fetch-Site) -> Content-Type -> arayüz belirteci.
            Rota eşleşmesi (404) yetkiden SONRA yapılır: yetkisiz istemci her yolda aynı 401'i
            alır, rota tablosunu yoklayamaz (mevcut /api/* ile aynı sıra)."""
            self._ayni_koken_denetle(host)
            site = self.headers.get("Sec-Fetch-Site")
            if site is not None and site.strip().lower() != "same-origin":
                raise Reddedildi(403, "Sec-Fetch-Site kabul edilmez")
            if post:
                self._icerik_turu_denetle()
            verilen = self.headers.get(ARAYUZ_BASLIGI) or ""
            beklenen = arayuz_belirtec or ""
            # compare_digest her durumda çalışır (beklenen boşsa da); boş beklenen asla kabul edilmez.
            esit = hmac.compare_digest(verilen.encode("utf-8"), beklenen.encode("utf-8"))
            if not (esit and beklenen):
                raise Reddedildi(401, "arayüz belirteci gerekli")

        def _denetle(self, yol: str, post: bool) -> None:
            port = sunucu_ref[0].server_address[1]
            host = (self.headers.get("Host") or "").strip().lower()
            if host not in (f"127.0.0.1:{port}", f"localhost:{port}") and host not in ek_hostlar:
                raise Reddedildi(403, "Host geçersiz")
            if _ui_yolu(yol):
                return self._ui_denetle(host, post)
            if _statik_istek_yolu(yol) and not post:
                # Sayfa ve dosyaları: aynı kökenden (Origin yok ya da tam http://<Host>) yüklenebilir.
                return self._ayni_koken_denetle(host)
            if self.headers.get("Origin") is not None:
                raise Reddedildi(403, "Origin başlığı olan istekler kabul edilmez")
            if post:
                self._icerik_turu_denetle()
            if yol.startswith("/api/") and yol != "/api/saglik":
                verilen = self.headers.get(BELIRTEC_BASLIGI) or ""
                if not hmac.compare_digest(verilen.encode("utf-8"), belirtec.encode("utf-8")):
                    raise Reddedildi(401, "belirteç gerekli")

        def _sar(self, fn, post: bool):
            self._govde_okundu = False
            if not post and self._govde_bildirildi():
                # GET/HEAD gövdesi okunmaz: aynı bağlantıda kalırsa baytları sonraki istek gibi
                # ayrıştırılırdı. Yanıttan sonra bağlantı kapanır, kalan baytlar finish'te atılır.
                self.close_connection = True
            try:
                if self.path.startswith("//"):
                    raise GecersizIstek("geçersiz yol")
                self._denetle(self._yol(), post)
                fn()
            except Reddedildi as e:
                self.close_connection = True  # okunmamış gövde olabilir
                self._hata(e.kod, e)
            except GecersizIstek as e:
                self._hata(400, e)
            except TimeoutError:
                self.close_connection = True
                try:
                    self._hata(408, "istek zaman aşımına uğradı")
                except Exception:
                    pass
            except ConnectionError:
                self.close_connection = True
            except (ValueError, KeyError, TypeError) as e:
                # alt modüllerin girdi doğrulaması genelde bunları fırlatır
                gunluk(f"400 {self.command} {self._yol()}: {type(e).__name__}")
                self._hata(400, e)
            except Exception as e:
                gunluk(f"500 {self.command} {self._yol()}\n" + traceback.format_exc())
                try:
                    self._hata(500, f"iç hata: {type(e).__name__}")
                except Exception:
                    pass
            finally:
                if post and not self._govde_okundu:
                    self.close_connection = True

        def do_GET(self):
            self._sar(self._get, False)

        do_HEAD = do_GET

        def do_POST(self):
            self._sar(self._post, True)

        def _get(self):
            u = urlsplit(self.path)
            yol = u.path
            q = parse_qs(u.query, keep_blank_values=True)
            if _ui_yolu(yol):
                return self._ui("GET", yol, q)
            if yol.startswith("/api/"):
                return self._api_get(yol, q)
            if _statik_istek_yolu(yol):
                return self._statik(yol)
            self._hata(404, "bulunamadı")

        # -- /api/ui/* (yetki _ui_denetle'de doğrulandı; burada yalnız tam eşleşen rotalar)
        def _ui(self, yontem: str, yol: str, q: dict | None):
            ad = UI_ROTALAR.get((yontem, yol))
            if ad is None:
                return self._hata(404, "bulunamadı")
            return getattr(self, ad)(q)

        def _ui_graf(self, q):
            return self._json(200, durum.oku_cagir(_mod("arayuz").graf))

        def _ui_dugum(self, q):
            did = _metin(q, "id", zorunlu=True)
            ac = _ui_bayrak(q, "ac")
            sonuc = durum.oku_cagir(_mod("arayuz").dugum, did, ac=ac)
            if sonuc is None:
                return self._hata(404, "düğüm bulunamadı")
            return self._json(200, sonuc)

        def _ui_ara(self, q):
            sq = q.get("q", [""])[0].strip()
            k = _ui_sayi(q, "k", 20, en_az=1, en_cok=50)
            return self._json(200, durum.oku_cagir(_mod("arayuz").ara, sq, k=k))

        def _ui_gecmis(self, q):
            sonra = _ui_sayi(q, "sonra", 0)
            limit = _ui_sayi(q, "limit", 500, en_az=1, en_cok=1000)
            return self._json(200, durum.oku_cagir(_mod("arayuz_zaman").gecmis, sonra=sonra, limit=limit))

        def _ui_degisim(self, q):
            imlec = _ui_sayi(q, "imlec")
            return self._json(200, durum.oku_cagir(_mod("arayuz_zaman").degisim, imlec))

        def _ui_gelen(self, q):
            return self._json(200, durum.oku_cagir(_mod("arayuz").gelen, ac=_metin(q, "ac")))

        def _ui_gelen_karar(self, q):
            g = self._govde_json()
            gid = g.get("id")
            if not isinstance(gid, str) or not gid.strip():
                raise GecersizIstek("'id' gerekli (boş olmayan metin)")
            karar = g.get("karar")
            if karar not in ("kabul", "red"):
                raise GecersizIstek("'karar' 'kabul' ya da 'red' olmalı")
            duzeltme = _ui_duzeltme(g.get("duzeltme"))
            kod, govde = _gelen_karar_uygula(durum, gid.strip(), karar, duzeltme, ui=True)
            if kod != 200:
                return self._json(kod, govde)
            bekleyen = durum.oku_cagir(_mod("arayuz").gelen_bekleyen)
            return self._json(200, {"sonuc": govde, "gelen_bekleyen": bekleyen})

        def _api_get(self, yol, q):
            if yol == "/api/saglik":
                return self._json(200, {"durum": "ok", "surum": SURUM})
            if yol == "/api/gez":
                sorgu = _mod("sorgu")
                return self._json(200, durum.oku_cagir(sorgu.gez, id=_metin(q, "id")))
            if yol == "/api/ara":
                sorgu = _mod("sorgu")
                sq = q.get("q", [""])[0].strip()
                if not sq:
                    raise GecersizIstek("'q' gerekli")
                kw = {"k": _tam_sayi(q, "k", 5)}
                if q.get("alt", [""])[0]:
                    kw["alt_agac"] = q["alt"][0]
                return self._json(200, durum.oku_cagir(sorgu.ara, sq, **kw))
            if yol == "/api/oku":
                sorgu = _mod("sorgu")
                return self._json(200, durum.oku_cagir(sorgu.oku, _metin(q, "id", zorunlu=True)))
            if yol == "/api/gelen":
                yz = _mod("yaz")
                return self._json(200, {"gelen": durum.oku_cagir(yz.gelen_listele)})
            if yol == "/api/disa-aktar":
                da = _mod("disa_aktar")
                bicim = q.get("bicim", ["md"])[0]
                if bicim == "md":
                    metin = durum.oku_cagir(da.markdown_agac)
                    return self._gonder(200, metin.encode("utf-8"), "text/markdown; charset=utf-8")
                if bicim == "jsonl":
                    fd, gecici = tempfile.mkstemp(suffix=".jsonl")
                    os.close(fd)
                    try:
                        durum.oku_cagir(da.jsonl_dok, gecici)
                        ham = Path(gecici).read_bytes()
                    finally:
                        try:
                            os.unlink(gecici)
                        except OSError:
                            pass
                    return self._gonder(200, ham, "application/x-ndjson; charset=utf-8")
                raise GecersizIstek("bicim 'md' ya da 'jsonl' olmalı")
            self._hata(404, "bulunamadı")

        def _statik(self, yol):
            rel = "index.html" if yol == "/" else unquote(yol[len("/static/"):])
            if not _statik_yol_guvenli(rel):
                return self._hata(403, "yasak")
            kok = WEB_KOK.resolve()
            try:
                hedef = (kok / rel).resolve()
            except (OSError, ValueError):
                return self._hata(403, "yasak")
            if kok not in hedef.parents:
                return self._hata(403, "yasak")
            if not hedef.is_file():
                if yol == "/":
                    return self._statik_gonder(_BOS_SAYFA_HAM, "text/html; charset=utf-8",
                                               _BOS_SAYFA_ETAG)
                return self._hata(404, "bulunamadı")
            tur = STATIK_TURLER.get(hedef.suffix.lower())
            if tur is None:
                tur = mimetypes.guess_type(hedef.name)[0] or "application/octet-stream"
                if tur.startswith("text/") or tur in ("application/javascript", "application/json"):
                    tur += "; charset=utf-8"
            # index.html yalnız süreç geneli asistan adını gömer (belirteç/oturum içeriği yok;
            # belirteç istemcide URL parçasından okunur): diğer statik dosyalarla aynı kural.
            try:
                govde, etag = _statik_icerik(hedef, hedef == kok / "index.html")
            except FileNotFoundError:  # is_file ile okuma arasında silindi
                return self._hata(404, "bulunamadı")
            self._statik_gonder(govde, tur, etag)

        def _post(self):
            yol = self._yol()
            if _ui_yolu(yol):
                return self._ui("POST", yol, None)
            if yol == "/api/yaz":
                g = self._govde_json()
                if not isinstance(g.get("metin"), str) or not g["metin"].strip():
                    raise GecersizIstek("'metin' gerekli (boş olmayan metin)")
                istek_id = _istek_id(g)
                kw = {k: g[k] for k in YAZ_ALANLARI if k in g}
                sonuc = durum.yaz_tekil(kw, istek_id)
                return self._json(503 if _gecici(sonuc) else 200, sonuc)
            if yol == "/api/duzelt":
                g = self._govde_json()
                if not isinstance(g.get("dugum_id"), str) or not g["dugum_id"].strip():
                    raise GecersizIstek("'dugum_id' gerekli (boş olmayan metin)")
                for alan in ("ozet", "ayrinti", "eskit"):
                    if alan in g and not isinstance(g[alan], str):
                        raise GecersizIstek(f"'{alan}' metin olmalı")
                if "ozet" not in g and "ayrinti" not in g and "eskit" not in g:
                    raise GecersizIstek("'ozet', 'ayrinti' ya da 'eskit' alanlarından en az biri gerekli")
                istek_id = _istek_id(g)
                kw = {k: g[k] for k in DUZELT_ALANLARI if k in g}
                sonuc = durum.duzelt_tekil(kw, istek_id)
                return self._json(503 if _gecici(sonuc) else 200, sonuc)
            if yol.startswith("/api/gelen/"):
                gid = unquote(yol[len("/api/gelen/"):])
                if not gid or "/" in gid:
                    raise GecersizIstek("gelen kimliği geçersiz")
                g = self._govde_json()
                if not isinstance(g.get("karar"), str) or not g["karar"]:
                    raise GecersizIstek("'karar' gerekli")
                kod, govde = _gelen_karar_uygula(durum, gid, g["karar"], g.get("duzeltme"))
                return self._json(kod, govde)
            self._hata(404, "bulunamadı")

    return Isleyici


# (yöntem, tam yol) -> işleyici yöntemi. HEAD, GET gibi işlenir (gövdesiz).
UI_ROTALAR = {
    ("GET", "/api/ui/graf"): "_ui_graf",
    ("GET", "/api/ui/dugum"): "_ui_dugum",
    ("GET", "/api/ui/ara"): "_ui_ara",
    ("GET", "/api/ui/gecmis"): "_ui_gecmis",
    ("GET", "/api/ui/degisim"): "_ui_degisim",
    ("GET", "/api/ui/gelen"): "_ui_gelen",
    ("POST", "/api/ui/gelen/karar"): "_ui_gelen_karar",
}


class _Sunucu(ThreadingHTTPServer):
    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self) -> None:
        if sys.platform == "win32":
            # Aynı porta ikinci sürecin bağlanmasını engelle (port gaspı / çift servis).
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        # HTTPServer.server_bind, server_name için socket.getfqdn(host) çağırır: ters DNS sorgusu.
        # macOS'ta (ör. GitHub runner) bu 127.0.0.1 için dakikalarca takılabilir ve servis açılmaz.
        # Servis yalnız yerel adrese bağlanır; ad olarak adresin kendisi yeterlidir.
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = host
        self.server_port = port


class Sunucu:
    """Sunucu + durum + arka plan kuyruk döngüsü + kilit; testlerde ve calistir'da ortak."""

    def __init__(self, host: str, port: int) -> None:
        self.kilit = TekSurecKilidi(_durum_klasoru())
        self.durum = None
        self.http = None
        self.durdur = threading.Event()
        self.kuyruk_is_parcacigi = None
        try:
            self.belirtec = belirtec_hazirla()
            self.arayuz_belirtec = arayuz_belirtec_hazirla()
            self.durum = Durum()
            ref: list = [None]
            try:
                self.http = _Sunucu((host, port),
                                    _yapilandir(self.durum, self.belirtec, ref, self.arayuz_belirtec))
            except OSError as e:
                tur = PortKullanimda if e.errno in _PORT_DOLU else ServisBaslatilamadi
                raise tur(f"{host}:{port} dinlenemedi ({e.strerror or type(e).__name__}); port kullanımda olabilir.")
            ref[0] = self.http
            kuyruk_bosalt(self.durum)
            self.kuyruk_is_parcacigi = threading.Thread(target=self._kuyruk_dongusu, name="beyin-kuyruk", daemon=True)
            self.kuyruk_is_parcacigi.start()
        except BaseException:
            self.kapat()
            raise

    @property
    def server_address(self):
        return self.http.server_address

    def _kuyruk_dongusu(self) -> None:
        aralik = _kuyruk_araligi()
        while not self.durdur.wait(aralik):
            try:
                kuyruk_bosalt(self.durum)
            except Exception:
                gunluk("kuyruk döngüsü hatası\n" + traceback.format_exc())

    def serve_forever(self) -> None:
        self.http.serve_forever()

    def shutdown(self) -> None:
        self.http.shutdown()

    def kapat(self) -> None:
        self.durdur.set()
        if self.http is not None:
            try:
                self.http.server_close()
            except Exception:
                pass
        if self.durum is not None:
            self.durum.kapat()
        self.kilit.birak()


def sunucu_olustur(host: str = "127.0.0.1", port: int | None = None):
    """(sunucu, durum) döndürür; sunucu .serve_forever/.shutdown/.kapat/.server_address sağlar."""
    if port is None:
        port = int(os.environ.get("BELLEK_BEYIN_PORT") or VARSAYILAN_PORT)
    s = Sunucu(host, port)
    return s, s.durum


def calistir(host: str = "127.0.0.1", port: int | None = None) -> None:
    if host not in ("127.0.0.1", "localhost"):
        host = "127.0.0.1"  # dış erişim sonraki aşama
    temiz = os.environ.get(CAKISMADA_TEMIZ_CIK) == "1"
    son = time.monotonic() + PORT_BEKLEME
    while True:
        try:
            srv, _ = sunucu_olustur(host, port)
            break
        except PortKullanimda as e:
            if temiz and time.monotonic() < son:
                time.sleep(PORT_BEKLEME_ARALIK)
                continue
            hata = e
        except ServisBaslatilamadi as e:
            hata = e
        gunluk(f"başlatılamadı: {hata}")
        print(f"Beyin servisi başlatılamadı: {hata}", file=sys.stderr)
        if temiz and isinstance(hata, ServisCakismasi):
            gunluk("çakışma: yeniden denenmesin diye 0 ile çıkılıyor")
            sys.exit(0)
        sys.exit(1)
    gunluk(f"servis başladı {srv.server_address}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.kapat()
        gunluk("servis kapandı")


if __name__ == "__main__":
    calistir()
