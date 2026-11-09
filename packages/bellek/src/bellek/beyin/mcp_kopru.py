"""Beyin MCP köprüsü: Claude Code oturumlarını PC'deki tek beyin servisine bağlar.

stdio üzerinden MCP (satır başına bir JSON-RPC 2.0 mesajı), yalnız stdlib.
Her oturum bu süreci başlatır; okuma/yazma 127.0.0.1'deki servise HTTP ile gider.
Servis kapalıysa okuma doğrudan salt-okunur veritabanından, yazma kuyruk dosyasına.

Çalıştırma: python -m bellek.beyin.mcp_kopru
"""
from __future__ import annotations

import importlib
import inspect
import json
import os
import socket
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

SURUM = "0.1.0"
VARSAYILAN_PORT = 47321
HTTP_ZAMAN_ASIMI = 5.0
KAPALI_BEKLEME = 15.0  # zaman aşımından sonra okumalar bu kadar saniye doğrudan yedek yola
# Windows'ta kapalı yerel porta bağlanmak ~2 sn sürer (SYN yeniden denemeleri);
# okumalar bunu her seferinde ödemesin diye ret sonrası kısa süre doğrudan yedek yol.
# Yazmalar pencereye güvenmez: kuyruğa almadan önce sağlığı yeniden dener.
REDDEDILDI_BEKLEME = 5.0
MAKS_CIKTI = 8000  # modele giden metnin güvenlik tavanı (karakter)
MAKS_YAZ_METIN = 4000

# Desteklenen eski (initialize el sıkışmalı) MCP revizyonları, yeniden eskiye.
DESTEKLENEN_SURUMLER = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")

TALIMAT = (
    "Beyin: kullanıcı hakkında TEK bilgi kaynağı (kimlik, projeler, tercihler, kurallar, kişiler, "
    "kararlar). Bunlar için hafıza dosyası, eski not, oturum kaydı, proje klasörü taranmaz (kod için "
    "repo dosyası okunur; beyin onun yerine geçmez). Önce beyin_ara (tek çağrı); yoksa beyin_gez ile "
    "kökten in (id'siz beyin_gez üst dalları listeler), sonra beyin_oku; hepsini okuma. "
    "KURAL: kullanıcıyla doğrudan konuşurken ona dair kalıcı yeni bilgi öğrenirsen (olay, karar, "
    "tercih, kişi, proje durumu, olgu düzeltmesi) aynı turda beyin_yaz: önce beyin_ara ile düğümü bul, "
    "dugum_id ver; yeni konuysa ebeveyn (ör. 'Okul/Dersler') ve baslik ver. "
    "Geçici görev ayrıntısı, araç/web iddiası ve sır yazma. "
    "Eskiyen özet, ayrıntı ya da olgu: beyin_duzelt. "
    "Alt agent isen ikisini de kullanma. "
    "beyin_gelen kararını yalnız kullanıcı açıkça onaylarsa ver. "
    "Kök altında yeni üst dal yalnız kullanıcı onayıyla açılır."
)

_OKUMA = {"readOnlyHint": True, "openWorldHint": False}

ARACLAR = [
    {
        "name": "beyin_gez",
        "description": "Beyin haritasında bir düğümü ve çocuklarını gösterir; id yoksa kök dallar.",
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "string", "description": "Düğüm id'si"}},
        },
        "annotations": _OKUMA,
    },
    {
        "name": "beyin_ara",
        "description": "Beyinde kısa yoldan arar; en uygun düğümleri yolu ve id'siyle döndürür. "
        "alt_agac verilirse yalnız o dalın altında arar.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "sorgu": {"type": "string"},
                "alt_agac": {"type": "string", "description": "Dal düğümünün id'si"},
                "k": {"type": "integer", "minimum": 1, "maximum": 20},
            },
            "required": ["sorgu"],
        },
        "annotations": _OKUMA,
    },
    {
        "name": "beyin_oku",
        "description": "Bir düğümün ayrıntısını ve olgularını gösterir.",
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "string", "description": "Düğüm id'si"}},
            "required": ["id"],
        },
        "annotations": _OKUMA,
    },
    {
        "name": "beyin_yaz",
        "description": "Kullanıcı hakkında kalıcı yeni bilgiyi doğru düğüme yazar: dugum_id (beyin_ara'dan) "
        "ya da yeni konu için ebeveyn+baslik ver. Sır yazma.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "metin": {"type": "string", "description": "Tek olgu, kısa ve kendi başına anlaşılır"},
                "dugum_id": {"type": "string"},
                "ebeveyn": {"type": "string", "description": "Yeni düğümün üst yolu, ör. 'Okul/Dersler'"},
                "baslik": {"type": "string"},
                "gizlilik": {"type": "string", "enum": ["normal", "ozel"]},
            },
            "required": ["metin"],
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False},
    },
    {
        "name": "beyin_duzelt",
        "description": "Düğümün özetini ve/veya ayrıntısını tam metin olarak değiştirir; eskisi geçmişte "
        "kalır. eskit ile bir olguyu eskitir: olgu silinmez, \"eskidi\" olur. Önce beyin_oku ile mevcut "
        "hali oku. Olgu eklemek için beyin_yaz.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dugum_id": {"type": "string"},
                "ozet": {"type": "string", "description": "Yeni özet (en çok 200 karakter)"},
                "ayrinti": {"type": "string", "description": "Yeni ayrıntı (en çok 1500 karakter)"},
                "eskit": {"type": "string", "description": "Eskitilecek olgunun metni: beyin_oku olgu "
                          "satırından tarih/kaynak önekinden sonrası, birebir"},
            },
            "required": ["dugum_id"],
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False},
    },
    {
        "name": "beyin_gelen",
        "description": "Gelen kutusu (yeri belirsiz öneriler): islem='liste' bekleyenleri gösterir; "
        "islem='karar' gelen_id'yi kabul/red eder, istersen dugum_id ya da ebeveyn+baslik ile düzeltir.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "islem": {"type": "string", "enum": ["liste", "karar"]},
                "gelen_id": {"type": "string"},
                "karar": {"type": "string", "enum": ["kabul", "red"]},
                "dugum_id": {"type": "string"},
                "ebeveyn": {"type": "string"},
                "baslik": {"type": "string"},
            },
            "required": ["islem"],
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False},
    },
]
_ARAC_ADLARI = {a["name"] for a in ARACLAR}

_BASLANGIC = datetime.now()


# --------------------------------------------------------------------------- yollar, günlük

def _veri_klasoru() -> Path:
    taban = os.environ.get("LOCALAPPDATA")
    return (Path(taban) if taban else Path.home() / "AppData" / "Local") / "Bellek"


def _kuyruk_yolu() -> Path:
    v = os.environ.get("BELLEK_BEYIN_KUYRUK")
    return Path(v) if v else _veri_klasoru() / "beyin_kuyruk.jsonl"


def _log_yolu() -> Path:
    v = os.environ.get("BELLEK_BEYIN_KOPRU_LOG")
    return Path(v) if v else _veri_klasoru() / "beyin_kopru.log"


def gunluk(mesaj: str) -> None:
    """Günlük yalnız dosyaya (yazılamazsa stderr'e); stdout protokole ayrılmıştır."""
    satir = f"{datetime.now().isoformat(timespec='seconds')} [{os.getpid()}] {mesaj}\n"
    try:
        yol = _log_yolu()
        yol.parent.mkdir(parents=True, exist_ok=True)
        with open(yol, "a", encoding="utf-8") as f:
            f.write(satir)
    except Exception:
        try:
            sys.stderr.write(satir)
            sys.stderr.flush()
        except Exception:
            pass


def _port() -> int:
    try:
        p = int(os.environ.get("BELLEK_BEYIN_PORT") or VARSAYILAN_PORT)
        return p if 0 < p < 65536 else VARSAYILAN_PORT
    except ValueError:
        return VARSAYILAN_PORT


def oturum_ref() -> str:
    for ad in ("CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"):
        v = (os.environ.get(ad) or "").strip()
        if v:
            return v
    return "mcp-" + _BASLANGIC.strftime("%Y%m%dT%H%M%S.%f")[:-3]


# --------------------------------------------------------------------------- servis istemcisi

class ServisYok(Exception):
    """Servise ulaşılamadı; yedek yola geçilmeli."""

    def __init__(self, neden: str, gitmis_olabilir: bool = False):
        super().__init__(neden)
        self.neden = neden
        # True: bağlantı kurulduktan sonra koptu/zaman aşımı; istek servise ulaşmış olabilir.
        self.gitmis_olabilir = gitmis_olabilir


class ServisHatasi(Exception):
    """Servis yanıt verdi ama isteği reddetti (4xx/5xx)."""

    def __init__(self, mesaj: str, kod: int | None = None):
        super().__init__(mesaj)
        self.kod = kod


_kapali_bitis = 0.0
_ACICI = urllib.request.build_opener(urllib.request.ProxyHandler({}))

# Belirteç önbelleği: (yol, mtime_ns, boyut) değişmedikçe dosya yeniden okunmaz.
_belirtec_imza: tuple | None = None
_belirtec_deger: str | None = None


def _belirtec_yolu() -> Path:
    v = os.environ.get("BELLEK_BEYIN_TOKEN_DOSYA")
    return Path(v) if v else _veri_klasoru() / "beyin_token"


def _belirtec(zorla: bool = False) -> str | None:
    """Servisin yazdığı belirteci döndürür; dosya değişmediyse önbellekten."""
    global _belirtec_imza, _belirtec_deger
    yol = _belirtec_yolu()
    try:
        st = yol.stat()
        imza = (str(yol), st.st_mtime_ns, st.st_size)
    except OSError:
        _belirtec_imza, _belirtec_deger = None, None
        return None
    if zorla or imza != _belirtec_imza:
        try:
            _belirtec_deger = yol.read_text(encoding="utf-8").strip() or None
            _belirtec_imza = imza
        except OSError:
            _belirtec_imza, _belirtec_deger = None, None
    return _belirtec_deger


def _http(yol: str, govde: dict | None = None, *, pencereyi_yok_say: bool = False,
          zaman_asimi: float = HTTP_ZAMAN_ASIMI, _yeniden: bool = False) -> dict:
    global _kapali_bitis
    if not pencereyi_yok_say and time.monotonic() < _kapali_bitis:
        raise ServisYok("yakın zamanda yanıt vermedi")
    url = f"http://127.0.0.1:{_port()}{yol}"
    veri = None
    basliklar = {"Accept": "application/json"}
    if not yol.startswith("/api/saglik"):
        tok = _belirtec(zorla=_yeniden)
        if tok:
            basliklar["X-Beyin-Token"] = tok
    if govde is not None:
        veri = json.dumps(govde, ensure_ascii=False).encode("utf-8")
        basliklar["Content-Type"] = "application/json"
    istek = urllib.request.Request(url, data=veri, headers=basliklar, method="POST" if veri else "GET")
    try:
        with _ACICI.open(istek, timeout=zaman_asimi) as y:
            ham = y.read()
    except urllib.error.HTTPError as e:
        try:
            ham = e.read()
        except Exception:
            ham = b""
        if e.code in (401, 403) and not _yeniden:
            # Servis yeniden başlayıp belirteci yenilemiş olabilir: dosyayı zorla oku, bir kez dene.
            return _http(yol, govde, pencereyi_yok_say=pencereyi_yok_say, zaman_asimi=zaman_asimi, _yeniden=True)
        mesaj = _hata_metni(ham) or f"HTTP {e.code}"
        raise ServisHatasi(f"servis reddetti ({e.code}): {mesaj}", e.code)
    except (socket.timeout, TimeoutError) as e:
        _kapali_bitis = time.monotonic() + KAPALI_BEKLEME
        raise ServisYok("zaman aşımı", gitmis_olabilir=True) from e
    except urllib.error.URLError as e:
        if isinstance(e.reason, (socket.timeout, TimeoutError)):
            _kapali_bitis = time.monotonic() + KAPALI_BEKLEME
            raise ServisYok("zaman aşımı", gitmis_olabilir=True) from e
        _kapali_bitis = time.monotonic() + REDDEDILDI_BEKLEME
        # Reddedilen/ulaşılamayan bağlantı: gitmedi. Kurulduktan sonra kopan (reset/abort): gitmiş olabilir.
        gitmis = isinstance(e.reason, ConnectionError) and not isinstance(e.reason, ConnectionRefusedError)
        raise ServisYok(f"bağlanılamadı: {e.reason}", gitmis_olabilir=gitmis) from e
    except (ConnectionError, OSError) as e:
        _kapali_bitis = time.monotonic() + REDDEDILDI_BEKLEME
        # Yanıt okunurken kopma: gitmiş olabilir; bağlantı reddi: gitmedi.
        raise ServisYok(f"bağlantı hatası: {e}",
                        gitmis_olabilir=not isinstance(e, ConnectionRefusedError)) from e
    try:
        sonuc = json.loads(ham.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as e:
        raise ServisHatasi("servis geçersiz JSON döndürdü") from e
    if not isinstance(sonuc, dict):
        raise ServisHatasi("servis beklenmeyen yanıt döndürdü")
    _kapali_bitis = 0.0
    return sonuc


def _servis_ayakta() -> bool:
    """Bekleme penceresini yok sayarak kısa bir sağlık denemesi."""
    try:
        return _http("/api/saglik", pencereyi_yok_say=True, zaman_asimi=2.0).get("durum") == "ok"
    except (ServisYok, ServisHatasi):
        return False


def _hata_metni(ham: bytes) -> str:
    try:
        d = json.loads(ham.decode("utf-8"))
        if isinstance(d, dict):
            return str(d.get("hata") or d.get("mesaj") or d.get("metin") or d.get("error") or "")[:300]
    except Exception:
        pass
    return ham.decode("utf-8", "replace")[:200]


# --------------------------------------------------------------------------- yedek yol

def _mod(ad: str):
    return importlib.import_module(f"bellek.beyin.{ad}")


def _yedek_cagir(modul: str, islev: str, *a, **kw):
    """Salt-okunur bağlantıyla bir modül işlevini çağırır (yalnız okuma işlevleri)."""
    db = _mod("db")
    fn = getattr(_mod(modul), islev)
    con = db.baglan(salt_okunur=True)
    try:
        return fn(con, *a, **kw)
    finally:
        try:
            con.close()
        except Exception:
            pass


def _yedek_oku(islev: str, *a, onek_uzunlugu: int = 0, **kw) -> dict:
    db = _mod("db")
    sorgu = _mod("sorgu")
    fn = getattr(sorgu, islev)
    if onek_uzunlugu and "butce" not in kw:
        # Önek de bütçeye dahil: sorgunun varsayılan bütçesinden önek kadar düş.
        try:
            p = inspect.signature(fn).parameters.get("butce")
            if p is not None and isinstance(p.default, int):
                kw["butce"] = max(p.default - onek_uzunlugu, 0)
        except (TypeError, ValueError):
            pass
    con = db.baglan(salt_okunur=True)
    try:
        return fn(con, *a, **kw)
    finally:
        try:
            con.close()
        except Exception:
            pass


def kuyruga_ekle(govde: dict, neden: str) -> Path:
    yol = _kuyruk_yolu()
    yol.parent.mkdir(parents=True, exist_ok=True)
    satir = dict(govde)
    satir["kuyruk_zamani"] = datetime.now().isoformat(timespec="seconds")
    satir["kuyruk_nedeni"] = neden
    ham = (json.dumps(satir, ensure_ascii=False, default=str) + "\n").encode("utf-8")
    # Tek write() ile ekle; satır yarım kalmasın diye kısa bir kilit dosyası kullan.
    kilit = yol.with_name(yol.name + ".kilit")
    with _dosya_kilidi(kilit):
        with open(yol, "ab") as f:
            f.write(ham)
            f.flush()
    return yol


class _dosya_kilidi:
    def __init__(self, yol: Path, sure: float = 3.0):
        self.yol, self.sure, self.f = yol, sure, None

    def __enter__(self):
        try:
            self.f = open(self.yol, "a+b")
        except OSError:
            return self
        bitis = time.monotonic() + self.sure
        while True:
            try:
                if os.name == "nt":
                    import msvcrt
                    self.f.seek(0)
                    msvcrt.locking(self.f.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self.f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except OSError:
                if time.monotonic() > bitis:
                    gunluk("kuyruk kilidi alınamadı, kilitsiz yazılıyor")
                    return self
                time.sleep(0.05)

    def __exit__(self, *a):
        if self.f is None:
            return False
        try:
            if os.name == "nt":
                import msvcrt
                self.f.seek(0)
                msvcrt.locking(self.f.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.f.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        finally:
            self.f.close()
        return False


# --------------------------------------------------------------------------- araçlar

class AracHatasi(Exception):
    """Modele isError ile dönecek kısa hata."""


def _metin_al(d, alan: str = "metin") -> str:
    if isinstance(d, dict):
        v = d.get(alan)
        if v is None:
            v = d.get("mesaj") if alan == "metin" else d.get("metin")
        if v is None:
            v = json.dumps(d, ensure_ascii=False, default=str)
        return str(v)
    return str(d)


def _str_arg(arg: dict, ad: str, zorunlu: bool = False) -> str | None:
    v = arg.get(ad)
    if v is None or (isinstance(v, str) and not v.strip()):
        if zorunlu:
            raise AracHatasi(f"'{ad}' gerekli")
        return None
    if isinstance(v, bool) or not isinstance(v, (str, int)):
        raise AracHatasi(f"'{ad}' metin olmalı")
    return str(v).strip()


def _sonuc_metni(d, alan: str = "metin", onek: str = "") -> str:
    """Servis/sorgu sonucunu metne çevirir; `hata` ya da `reddedildi` ise isError'lı döner."""
    metin = onek + _metin_al(d, alan)
    if isinstance(d, dict) and (d.get("hata") or d.get("sonuc") == "reddedildi"):
        raise AracHatasi(_kirp(metin))
    return metin


YEDEK_ONEK = "[servis kapalı; salt-okunur yedekten]\n"


def _oku_yolu(http_yol: str, params: dict, yedek_islev: str, yedek_a: tuple, yedek_kw: dict) -> str:
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    try:
        return _sonuc_metni(_http(http_yol + (f"?{q}" if q else "")))
    except ServisHatasi as e:
        raise AracHatasi(str(e))
    except ServisYok as e:
        gunluk(f"servis yok ({e.neden}), yedek okuma: {yedek_islev}")
    try:
        sonuc = _yedek_oku(yedek_islev, *yedek_a, onek_uzunlugu=len(YEDEK_ONEK), **yedek_kw)
    except Exception as e:
        gunluk(f"yedek okuma başarısız\n{traceback.format_exc()}")
        raise AracHatasi(f"servis kapalı ve yedek okuma başarısız: {type(e).__name__}")
    return _sonuc_metni(sonuc, onek=YEDEK_ONEK)


def arac_gez(arg: dict) -> str:
    id_ = _str_arg(arg, "id")
    kw = {"id": id_} if id_ is not None else {}
    return _oku_yolu("/api/gez", {"id": id_}, "gez", (), kw)


def arac_ara(arg: dict) -> str:
    sorgu = _str_arg(arg, "sorgu", zorunlu=True)
    alt = _str_arg(arg, "alt_agac")
    k = arg.get("k")
    if k is not None:
        if isinstance(k, bool):
            raise AracHatasi("'k' tam sayı olmalı")
        try:
            k = max(1, min(20, int(k)))
        except (TypeError, ValueError):
            raise AracHatasi("'k' tam sayı olmalı")
    kw: dict = {}
    if k is not None:
        kw["k"] = k
    if alt is not None:
        kw["alt_agac"] = alt
    return _oku_yolu("/api/ara", {"q": sorgu, "alt": alt, "k": k}, "ara", (sorgu,), kw)


def arac_oku(arg: dict) -> str:
    id_ = _str_arg(arg, "id", zorunlu=True)
    return _oku_yolu("/api/oku", {"id": id_}, "oku", (id_,), {})


def arac_yaz(arg: dict) -> str:
    metin = _str_arg(arg, "metin", zorunlu=True)
    if len(metin) > MAKS_YAZ_METIN:
        raise AracHatasi(f"metin çok uzun ({len(metin)} karakter); tek olguya indir")
    govde: dict = {"metin": metin}
    for ad in ("dugum_id", "ebeveyn", "baslik"):
        v = _str_arg(arg, ad)
        if v is not None:
            govde[ad] = v
    giz = _str_arg(arg, "gizlilik")
    if giz is not None:
        if giz not in ("normal", "ozel"):
            raise AracHatasi("'gizlilik' 'normal' ya da 'ozel' olmalı")
        govde["gizlilik"] = giz
    sir_var = _sir_iceriyor(govde)  # None: denetim yapılamadı
    if sir_var:
        gunluk("beyin_yaz reddedildi: sır içeriyor")
        raise AracHatasi("Sır içeriyor, yazılmadı.")
    govde["kaynak"] = {"tur": "oturum", "ref": oturum_ref(), "istemci": "claude-code"}
    govde["istek_id"] = uuid.uuid4().hex
    gecici_kilit = False
    try:
        return _sonuc_metni(_http("/api/yaz", govde), "mesaj")
    except ServisHatasi as e:
        if e.kod != 503:
            raise AracHatasi(str(e))
        neden, gecici_kilit = "servis geçici olarak meşgul (503)", True
    except ServisYok as e:
        neden = e.neden
    # Pencere ya da tek bir aksama yüzünden ayaktaki servisi atlama: sağlığı dene, ayaktaysa bir kez daha gönder.
    if not gecici_kilit and _servis_ayakta():
        try:
            return _sonuc_metni(_http("/api/yaz", govde, pencereyi_yok_say=True), "mesaj")
        except ServisHatasi as e:
            if e.kod != 503:
                raise AracHatasi(str(e))
            neden = "servis geçici olarak meşgul (503)"
        except ServisYok as e:
            neden = e.neden
    if sir_var is None:
        raise AracHatasi("Servis kapalı ve sır denetimi yapılamadı; kuyruğa alınmadı.")
    try:
        kuyruga_ekle(govde, neden)
    except Exception as e:
        gunluk(f"kuyruğa yazılamadı\n{traceback.format_exc()}")
        raise AracHatasi(f"servis kapalı ve kuyruğa yazılamadı: {type(e).__name__}")
    gunluk(f"yazma kuyruğa alındı ({neden}) istek_id={govde['istek_id']}")
    durum = "Servis meşgul" if "503" in neden else "Servis yanıt vermedi"
    return f"{durum}; kuyruğa alındı, servis birkaç dakika içinde işler."


MAKS_DUZELT_OZET = 200
MAKS_DUZELT_AYRINTI = 1500
DUZELT_ZAMAN_ASIMI = 12.0  # servis db kilit beklemesi (5 sn) + payı


def _duzelt_alan(arg: dict, ad: str) -> str | None:
    """Anahtar yoksa ya da None ise None; verilmişse (boş dahil) kırpılmış str."""
    v = arg.get(ad)
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, (str, int)):
        raise AracHatasi(f"'{ad}' metin olmalı")
    return str(v).strip()


def arac_duzelt(arg: dict) -> str:
    dugum_id = _str_arg(arg, "dugum_id", zorunlu=True)
    ozet = _duzelt_alan(arg, "ozet")
    ayrinti = _duzelt_alan(arg, "ayrinti")
    eskit = arg.get("eskit")
    if eskit is not None:
        if not isinstance(eskit, str):
            raise AracHatasi("'eskit' metin olmalı")
        eskit = eskit.strip()
        if not eskit:
            raise AracHatasi("'eskit' boş olamaz")
    if ozet is None and ayrinti is None and eskit is None:
        raise AracHatasi("'ozet', 'ayrinti' ya da 'eskit' gerekli")
    if ozet is not None and not ozet:
        raise AracHatasi("'ozet' boş olamaz")
    if ozet is not None and len(ozet) > MAKS_DUZELT_OZET:
        raise AracHatasi(f"özet çok uzun ({len(ozet)} karakter; en çok {MAKS_DUZELT_OZET})")
    if ayrinti is not None and len(ayrinti) > MAKS_DUZELT_AYRINTI:
        raise AracHatasi(f"ayrıntı çok uzun ({len(ayrinti)} karakter; en çok {MAKS_DUZELT_AYRINTI})")
    govde: dict = {"dugum_id": dugum_id}
    if ozet is not None:
        govde["ozet"] = ozet
    if ayrinti is not None:
        govde["ayrinti"] = ayrinti
    if eskit is not None:
        govde["eskit"] = eskit
    sir_var = _sir_iceriyor(govde)
    if sir_var:
        gunluk("beyin_duzelt reddedildi: sır içeriyor")
        raise AracHatasi("Sır içeriyor, yazılmadı.")
    if sir_var is None:
        raise AracHatasi("Sır denetimi yapılamadı; düzeltme yapılmadı.")
    govde["kaynak"] = {"tur": "oturum", "ref": oturum_ref(), "istemci": "claude-code"}
    govde["istek_id"] = uuid.uuid4().hex
    kapali = "Servis kapalı; düzeltme yapılmadı (kuyruğa alınmaz)."
    mesgul = "Servis meşgul; düzeltme yapılmadı, biraz sonra yeniden dene."
    belirsiz = ("Servis yanıt vermedi; düzeltmenin yapılıp yapılmadığı belirsiz. "
                "{ne_zaman}beyin_oku ile düğümü kontrol et; yapılmadıysa yeniden dene.")
    # Servis kilit beklemesi (~5 sn) + işlem süresini karşılamak için bu uçta bekleme uzun.
    gitmis = False  # herhangi bir deneme servise ulaşmış olabilir mi
    try:
        return _sonuc_metni(_http("/api/duzelt", govde, zaman_asimi=DUZELT_ZAMAN_ASIMI), "mesaj")
    except ServisHatasi as e:
        if e.kod != 503:
            raise AracHatasi(str(e))
        raise AracHatasi(mesgul)
    except ServisYok as e:
        gitmis = e.gitmis_olabilir
    ayakta = _servis_ayakta()
    if ayakta:
        # Aynı istek_id ile bir kez daha dene (servis tekilleştirir).
        try:
            return _sonuc_metni(_http("/api/duzelt", govde, pencereyi_yok_say=True,
                                      zaman_asimi=DUZELT_ZAMAN_ASIMI), "mesaj")
        except ServisHatasi as e:
            if e.kod != 503:
                raise AracHatasi(str(e))
        except ServisYok as e:
            gitmis = gitmis or e.gitmis_olabilir
    if gitmis:
        raise AracHatasi(belirsiz.format(ne_zaman="" if ayakta else "Servis açılınca "))
    raise AracHatasi(mesgul if ayakta else kapali)


def _sir_iceriyor(govde: dict) -> bool | None:
    """Metin alanlarından biri maskelemeyle değişiyorsa True; denetim yapılamazsa None."""
    try:
        maskele = importlib.import_module("bellek.devir.transcript").maskele
    except Exception:
        gunluk(f"sır denetimi yüklenemedi\n{traceback.format_exc()}")
        return None
    for ad in ("metin", "baslik", "ebeveyn", "ozet", "ayrinti", "eskit"):
        v = govde.get(ad)
        if isinstance(v, str) and v and maskele(v) != v:
            return True
    return False


GELEN_MAKS_OGE = 15
GELEN_BUTCE = 1500
GELEN_METIN = 120


def _gelen_metni(ogeler) -> str:
    """Gelen kutusu listesini kısa metne çevirir (≤15 öğe, ≤1500 karakter)."""
    if not isinstance(ogeler, list):
        ogeler = []
    ogeler = [o for o in ogeler if isinstance(o, dict) and o.get("durum", "bekliyor") == "bekliyor"]
    if not ogeler:
        return "Gelen kutusu boş."
    satirlar = [f"Gelen kutusu: {len(ogeler)} bekleyen öneri"]
    uzunluk = len(satirlar[0])
    gosterilen = 0
    for o in ogeler[:GELEN_MAKS_OGE]:
        oneri = o.get("oneri") if isinstance(o.get("oneri"), dict) else {}
        if oneri.get("gizlilik") == "ozel":
            metin = "(özel içerik; arayüzden bak)"
        else:
            metin = " ".join(str(oneri.get("metin") or "").split())
            if len(metin) > GELEN_METIN:
                metin = metin[:GELEN_METIN - 1] + "…"
        adaylar = o.get("adaylar") or oneri.get("adaylar") or []
        aday = "aday yok"
        if adaylar and isinstance(adaylar[0], dict):
            a = adaylar[0]
            yol = a.get("yol")
            yol_metni = " › ".join(map(str, yol)) if isinstance(yol, list) and yol else f"#{a.get('id')}"
            aday = f"aday: {yol_metni} [{a.get('id')}]"
        satir = f"- [{o.get('id')}] {o.get('tur')}: {metin} → {aday}"
        if uzunluk + 1 + len(satir) > GELEN_BUTCE - 40:
            break
        satirlar.append(satir)
        uzunluk += 1 + len(satir)
        gosterilen += 1
    if gosterilen < len(ogeler):
        satirlar.append(f"… (+{len(ogeler) - gosterilen} daha)")
    return "\n".join(satirlar)


def arac_gelen(arg: dict) -> str:
    islem = _str_arg(arg, "islem", zorunlu=True)
    if islem == "liste":
        try:
            return _gelen_metni(_http("/api/gelen").get("gelen"))
        except ServisHatasi as e:
            raise AracHatasi(str(e))
        except ServisYok as e:
            gunluk(f"servis yok ({e.neden}), yedek gelen listesi")
        try:
            ogeler = _yedek_cagir("yaz", "gelen_listele")
        except Exception as e:
            gunluk(f"yedek gelen listesi başarısız\n{traceback.format_exc()}")
            raise AracHatasi(f"servis kapalı ve yedek okuma başarısız: {type(e).__name__}")
        return YEDEK_ONEK + _gelen_metni(ogeler)
    if islem != "karar":
        raise AracHatasi("'islem' 'liste' ya da 'karar' olmalı")
    gid = _str_arg(arg, "gelen_id", zorunlu=True)
    karar = _str_arg(arg, "karar", zorunlu=True)
    if karar not in ("kabul", "red"):
        raise AracHatasi("'karar' 'kabul' ya da 'red' olmalı")
    govde: dict = {"karar": karar}
    dugum_id = _str_arg(arg, "dugum_id")
    ebeveyn, baslik = _str_arg(arg, "ebeveyn"), _str_arg(arg, "baslik")
    if dugum_id is not None:
        govde["duzeltme"] = {"dugum_id": dugum_id}
    elif ebeveyn is not None or baslik is not None:
        if ebeveyn is None or baslik is None:
            raise AracHatasi("düzeltme için dugum_id ya da ebeveyn ile baslik birlikte verilmeli")
        if _sir_iceriyor({"ebeveyn": ebeveyn, "baslik": baslik}):
            raise AracHatasi("Sır içeriyor, yazılmadı.")
        govde["duzeltme"] = {"ebeveyn": ebeveyn, "baslik": baslik}
    try:
        return _sonuc_metni(_http("/api/gelen/" + urllib.parse.quote(gid, safe=""), govde), "mesaj")
    except ServisHatasi as e:
        raise AracHatasi(str(e))
    except ServisYok:
        pass
    if _servis_ayakta():
        try:
            return _sonuc_metni(_http("/api/gelen/" + urllib.parse.quote(gid, safe=""), govde,
                                      pencereyi_yok_say=True), "mesaj")
        except ServisHatasi as e:
            raise AracHatasi(str(e))
        except ServisYok:
            pass
    raise AracHatasi("Servis kapalı; gelen kutusu kararı verilemedi (kuyruğa alınmaz). Servis açılınca tekrar dene.")


ISLEYICILER = {"beyin_gez": arac_gez, "beyin_ara": arac_ara, "beyin_oku": arac_oku, "beyin_yaz": arac_yaz,
               "beyin_duzelt": arac_duzelt, "beyin_gelen": arac_gelen}


def _kirp(metin: str) -> str:
    if len(metin) <= MAKS_CIKTI:
        return metin
    return metin[:MAKS_CIKTI] + "\n…(kırpıldı)"


def arac_cagir(ad: str, arg) -> dict:
    if not isinstance(arg, dict):
        arg = {}
    try:
        metin = ISLEYICILER[ad](arg)
        return {"content": [{"type": "text", "text": _kirp(metin)}]}
    except AracHatasi as e:
        return {"content": [{"type": "text", "text": str(e)[:500]}], "isError": True}
    except ValueError as e:
        return {"content": [{"type": "text", "text": str(e)[:500]}], "isError": True}
    except Exception as e:
        gunluk(f"{ad} beklenmeyen hata\n{traceback.format_exc()}")
        return {"content": [{"type": "text", "text": f"iç hata: {type(e).__name__}"}], "isError": True}


# --------------------------------------------------------------------------- JSON-RPC / MCP

class RpcHatasi(Exception):
    def __init__(self, kod: int, mesaj: str, veri=None):
        super().__init__(mesaj)
        self.kod, self.mesaj, self.veri = kod, mesaj, veri


def _initialize(params: dict) -> dict:
    istenen = params.get("protocolVersion") if isinstance(params, dict) else None
    surum = istenen if istenen in DESTEKLENEN_SURUMLER else DESTEKLENEN_SURUMLER[0]
    istemci = (params.get("clientInfo") or {}) if isinstance(params, dict) else {}
    gunluk(f"initialize istemci={istemci.get('name')}/{istemci.get('version')} istenen={istenen} secilen={surum}")
    return {
        "protocolVersion": surum,
        "capabilities": {"tools": {}},
        "serverInfo": {"name": "beyin", "version": SURUM},
        "instructions": TALIMAT,
    }


def _tools_call(params: dict) -> dict:
    if not isinstance(params, dict):
        raise RpcHatasi(-32602, "params bir nesne olmalı")
    ad = params.get("name")
    if ad not in _ARAC_ADLARI:
        raise RpcHatasi(-32602, f"Unknown tool: {ad}")
    return arac_cagir(ad, params.get("arguments") or {})


YONTEMLER = {
    "initialize": _initialize,
    "ping": lambda p: {},
    "tools/list": lambda p: {"tools": ARACLAR},
    "tools/call": _tools_call,
}


def mesaj_isle(m) -> dict | None:
    """Tek bir JSON-RPC mesajını işler; yanıt (dict) ya da None (bildirim/yanıt) döndürür."""
    if not isinstance(m, dict) or m.get("jsonrpc") != "2.0":
        return {"jsonrpc": "2.0", "id": m.get("id") if isinstance(m, dict) else None,
                "error": {"code": -32600, "message": "Invalid Request"}}
    if "method" not in m:
        return None  # istemciden gelen yanıt; sunucu istek göndermediği için yok say
    yontem = m.get("method")
    bildirim = "id" not in m
    if bildirim:
        if yontem not in ("notifications/initialized", "notifications/cancelled"):
            gunluk(f"yok sayılan bildirim: {yontem}")
        return None
    mid = m.get("id")
    try:
        if not isinstance(yontem, str) or yontem not in YONTEMLER:
            raise RpcHatasi(-32601, f"Method not found: {yontem}")
        sonuc = YONTEMLER[yontem](m.get("params") or {})
        return {"jsonrpc": "2.0", "id": mid, "result": sonuc}
    except RpcHatasi as e:
        hata = {"code": e.kod, "message": e.mesaj}
        if e.veri is not None:
            hata["data"] = e.veri
        return {"jsonrpc": "2.0", "id": mid, "error": hata}
    except Exception as e:
        gunluk(f"{yontem} iç hata\n{traceback.format_exc()}")
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32603, "message": f"Internal error: {type(e).__name__}"}}


def satir_isle(satir: bytes):
    """Ham satırı çözer; yazılacak yanıt nesnesini (dict/list) ya da None döndürür."""
    metin = satir.decode("utf-8", "replace").strip().lstrip("﻿")
    if not metin:
        return None
    try:
        m = json.loads(metin)
    except ValueError:
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
    if isinstance(m, list):  # eski revizyonlardaki toplu istek
        if not m:
            return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid Request"}}
        yanitlar = [y for y in (mesaj_isle(x) for x in m) if y is not None]
        return yanitlar or None
    return mesaj_isle(m)


def main() -> int:
    giris = sys.stdin.buffer
    cikis = sys.stdout.buffer
    # Protokol dışında stdout'a hiçbir şey gitmesin: print() vb. stderr'e yönlensin.
    sys.stdout = sys.stderr
    gunluk(f"köprü başladı sürüm={SURUM} port={_port()} ref={oturum_ref()}")
    try:
        while True:
            try:
                satir = giris.readline()
            except (OSError, ValueError):
                break
            if not satir:
                break
            try:
                yanit = satir_isle(satir)
            except Exception:
                gunluk(f"satır işlenemedi\n{traceback.format_exc()}")
                continue
            if yanit is None:
                continue
            try:
                ham = json.dumps(yanit, ensure_ascii=False, separators=(",", ":"), default=str)
                cikis.write(ham.encode("utf-8") + b"\n")
                cikis.flush()
            except (BrokenPipeError, OSError, ValueError):
                break
            except Exception:
                gunluk(f"yanıt yazılamadı\n{traceback.format_exc()}")
    except KeyboardInterrupt:
        pass
    gunluk("köprü kapandı")
    return 0


if __name__ == "__main__":
    sys.exit(main())
