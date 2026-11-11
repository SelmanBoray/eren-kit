"""Beyin veritabanının yedeklenmesi ve geri yüklenmesi (yalnız stdlib).

Yedek veritabanı düzeyinde alınır: `disa-aktar --bicim jsonl` dökümü yalnız aktif olguları
içerir; geçmiş, kaynak, gelen kutusu tabloları ve sır gövdeleri orada yoktur, `ice-al`
biçiminde de değildir. Bu yüzden geri yükleme dökümden değil, buradaki yedekten yapılır.

Yedekleme çevrimiçidir: kaynak yazmasız bir bağlantıyla açılır (bkz. `_okuma_baglantisi`) ve
`sqlite3.Connection.backup()` tek adımda (tek okuma işlemi içinde) kopyalar. Servis o sırada
yazıyor olsa da kopya, alındığı anda commit edilmiş verinin tamamını içerir (WAL'daki commit
edilmiş sayfalar dahil); yarım işlem kopyaya girmez. Kaynak dosyanın baytları değişmez ve
kapalı bir kaynağın yanında yan dosya bırakılmaz.

Yedek dosyası kendi başına tam bir veritabanıdır (`journal_mode=DELETE`; yan dosya gerekmez).
Adı `beyin-YYYYAAGG-SSDDSS.db` (yerel saat); aynı saniyedeki sonraki yedekler `-2`, `-3` ... eki
alır. Varsayılan dizin makineye yerel durum dizinidir (Windows: `%LOCALAPPDATA%\\Bellek\\beyin_yedek`);
kasaya (vault) ya da bulutla eşitlenen bir klasöre konmaz.

ŞİFRELEME YOK: yedek, veritabanının birebir kopyasıdır; sır gövdeleri dahil her şey düz metin
olarak içindedir. Yerel dizinin erişimi kullanıcıyla sınırlı olmalıdır (Windows'ta
%LOCALAPPDATA% varsayılan olarak öyledir; POSIX'te yedek dosyaları 0600 yazılır). Makine dışına
(bulut, Drive, USB) çıkarılacak bir yedek önce şifrelenmelidir (DESIGN.md §16.5).

Geri yükleme servis kapalıyken yapılır. Gerçek saptama, servisin tek süreç kilidini
(`beyin_servis.lock`, veritabanının bulunduğu klasörde; bkz. servis.TekSurecKilidi) denemektir;
kilit geri yükleme boyunca tutulur ki arada servis açılamasın. Mevcut veritabanı silinmez:
yan dosyalarıyla (`-wal`, `-shm`, `-journal`) birlikte `<ad>-eski-YYYYAAGG-SSDDSS<uzantı>` adına
taşınır; yan dosyalar adlarıyla birlikte taşındığı için kenardaki kopya kendi WAL'ıyla tam
açılır ve eski yan dosyalar geri yüklenen veritabanına asla uygulanmaz. Herhangi bir adım
başarısız olursa yapılan taşımalar geri alınır.
"""

from __future__ import annotations

import errno
import os
import re
import secrets
import sqlite3
import stat
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import BinaryIO, Callable

from .db import SEMA_SURUMU

YEDEK_DIZIN_ADI = "beyin_yedek"
KILIT_ADI = "beyin_servis.lock"  # servis.TekSurecKilidi ile aynı ad
YAN_EKLER = ("-wal", "-shm", "-journal")
_SQLITE_BASLIK = b"SQLite format 3\x00"
_YEDEK_KALIBI = re.compile(r"beyin-(\d{8})-(\d{6})(?:-([1-9][0-9]{0,5}))?\.db")
# Beyin şemasını tanıtan tablolar (v1'den beri var; ek ve FTS göçte yeniden kurulabilir).
_ZORUNLU_TABLOLAR = ("dugum", "kenar", "kaynak", "olgu", "gelen", "gecmis")
_TASIMA_DENEME = 5  # Windows'ta virüs tarayıcı/dizinleyici dosyayı kısa süre tutabilir
_TASIMA_ARALIK = 0.2
# Bu kadar saniyeden eski 0 baytlık yer tutucu, ölmüş bir yedeklemeden kalmıştır (canlıda ms sürer).
_YER_TUTUCU_BAYAT = 600.0
_SERVIS_MESAJI = (
    "Beyin servisi çalışıyor; çalışan servisin veritabanı geri yüklenemez. "
    "Önce servisi durdur, sonra yeniden dene."
)


class YedekHatasi(Exception):
    """Yedekleme ya da geri yükleme hatası; mesajı kullanıcıya gösterilebilir (Türkçe)."""


# ---------------------------------------------------------------- yollar


def varsayilan_yedek_dizini() -> Path:
    """Yerel durum dizinindeki yedek klasörü.

    `BELLEK_BEYIN_DB` verilmişse onun klasöründe (servisin kilit/durum klasörüyle aynı kural),
    yoksa platform veri kökünde (Windows: `%LOCALAPPDATA%\\Bellek`) `beyin_yedek`. Kasa ya da
    bulut eşitleme klasörü değildir.
    """
    ortam = os.environ.get("BELLEK_BEYIN_DB")
    if ortam:
        return Path(ortam).resolve().parent / YEDEK_DIZIN_ADI
    from bellek.platform_dirs import data_dir

    return data_dir() / YEDEK_DIZIN_ADI


def _okuma_baglantisi(yol: Path, timeout: float) -> sqlite3.Connection:
    """Dosyayı değiştirmeden okumak için bağlantı.

    Yanında hiç yan dosya yoksa (başka bağlantı yok, sıcak günlük yok) `mode=rw` +
    `query_only` ile açılır: veri yazılmaz, son bağlantı kapanınca SQLite WAL kipinin geçici
    `-wal`/`-shm` dosyalarını kendisi siler (ölçüldü: ana dosyanın baytları ve değişiklik zamanı
    aynı kalır). Yan dosya varsa `mode=ro`: yeni dosya oluşmaz, sıcak günlük geri sarılmaz,
    son kapanışta denetim noktası (checkpoint) yapılmaz. `mode=rw` dosya yoksa oluşturmaz.
    """
    tam = yol.resolve()
    yan_var = any(os.path.lexists(_yan(tam, e)) for e in YAN_EKLER)
    kip = "ro" if yan_var else "rw"
    con = sqlite3.connect(tam.as_uri() + f"?mode={kip}", uri=True, timeout=timeout)
    try:
        con.execute("PRAGMA query_only = ON")
    except BaseException:
        con.close()
        raise
    return con


def _yan(yol: Path, ek: str) -> Path:
    return yol.with_name(yol.name + ek)


def _ayni_dosya(a: Path, b: Path) -> bool:
    try:
        if a.exists() and b.exists():
            return os.path.samefile(a, b)
        return os.path.normcase(a.resolve()) == os.path.normcase(b.resolve())
    except OSError:
        return False


def _neden(e: BaseException) -> str:
    """İşletim sistemi / SQLite hatasının kısa Türkçe açıklaması."""
    if isinstance(e, OSError):
        kod = getattr(e, "winerror", None)
        if e.errno == errno.ENOSPC or kod in (39, 112):
            return "diskte yer kalmadı"
        if kod in (32, 33):
            return "dosya başka bir süreç tarafından kullanılıyor"
        if isinstance(e, PermissionError):
            return "erişim reddedildi ya da dosya başka bir süreç tarafından kullanılıyor"
        return f"{type(e).__name__}: {e.strerror or e}"
    if isinstance(e, sqlite3.Error):
        if getattr(e, "sqlite_errorcode", None) == 13 or "full" in str(e).lower():
            return "diskte yer kalmadı"
        if "locked" in str(e).lower() or "busy" in str(e).lower():
            return "veritabanı kilitli (başka bir süreç uzun bir işlem yapıyor olabilir)"
        return f"SQLite hatası: {e}"
    return f"{type(e).__name__}: {e}"


def _sil(yol: Path) -> None:
    for ek in ("",) + YAN_EKLER:
        try:
            _yan(yol, ek).unlink()
        except FileNotFoundError:
            pass
        except OSError:
            pass


def _fsync(yol: Path) -> None:
    with open(yol, "rb+") as f:
        os.fsync(f.fileno())


# ---------------------------------------------------------------- kopya ve doğrulama


def _sqlite_kopyala(kaynak: Path, hedef: Path) -> None:
    """`kaynak`ı salt okunur açıp `hedef`e (yeni dosya) tutarlı biçimde kopyalar.

    backup() varsayılan pages=-1 ile tek adımda, tek okuma işlemi içinde kopyalar; bu yüzden
    eşzamanlı yazma kopyayı yarım bırakmaz ya da yeniden başlatmaz. Hedef DELETE günlük kipine
    çevrilir: yedek tek dosyadır, yanında -wal/-shm gerekmez.
    """
    src = _okuma_baglantisi(kaynak, 30.0)
    try:
        dst = sqlite3.connect(str(hedef), timeout=30.0)
        try:
            src.backup(dst)
            dst.execute("PRAGMA journal_mode = DELETE").fetchone()
        finally:
            dst.close()
    finally:
        src.close()
    if os.name != "nt":
        os.chmod(hedef, 0o600)
    _fsync(hedef)


def dogrula(yol: Path) -> None:
    """Dosyanın sağlam bir beyin veritabanı olduğunu denetler; değilse YedekHatasi.

    Sırayla: dosya var mı, SQLite başlığı, `PRAGMA integrity_check`, beyin tabloları ve şema
    sürümü (1..SEMA_SURUMU; daha eski sürüm kabul edilir, açılışta göç eder). Dosya salt okunur
    açılır, değiştirilmez.
    """
    yol = Path(yol)
    if not yol.is_file():
        raise YedekHatasi(f"Dosya bulunamadı: {yol}")
    try:
        with open(yol, "rb") as f:
            bas = f.read(len(_SQLITE_BASLIK))
    except OSError as e:
        raise YedekHatasi(f"{yol} okunamadı ({_neden(e)}).") from e
    if bas != _SQLITE_BASLIK:
        raise YedekHatasi(f"{yol} bir SQLite veritabanı değil.")
    try:
        con = _okuma_baglantisi(yol, 10.0)
    except sqlite3.Error as e:
        raise YedekHatasi(f"{yol} açılamadı ({_neden(e)}).") from e
    try:
        sonuc = [str(r[0]) for r in con.execute("PRAGMA integrity_check")]
        if sonuc != ["ok"]:
            raise YedekHatasi(
                f"{yol} bütünlük denetiminden geçmedi: {sonuc[0] if sonuc else 'sonuç yok'}"
            )
        surum = con.execute("PRAGMA user_version").fetchone()[0]
        tablolar = {
            r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
    except sqlite3.Error as e:
        raise YedekHatasi(f"{yol} bozuk ya da okunamıyor ({_neden(e)}).") from e
    finally:
        con.close()
    if "dugum" not in tablolar:
        raise YedekHatasi(f"{yol} bir beyin veritabanı değil (düğüm tablosu yok).")
    if surum > SEMA_SURUMU:
        raise YedekHatasi(
            f"{yol} şema sürümü {surum}; bu kod en çok {SEMA_SURUMU} sürümünü biliyor. "
            "Önce kodu güncelle."
        )
    eksik = [t for t in _ZORUNLU_TABLOLAR if t not in tablolar]
    if surum < 1 or eksik:
        ayrinti = f"eksik tablolar: {', '.join(eksik)}" if eksik else "şema sürümü yok"
        raise YedekHatasi(f"{yol} bir beyin veritabanı değil ({ayrinti}).")


# ---------------------------------------------------------------- yedekleme


def _kalip_dosyalari(dizin: Path) -> list[tuple[tuple[str, str, int], Path, os.stat_result]]:
    """Kalıba uyan düzenli dosyalar (yer tutucular dahil): (sıralama anahtarı, yol, stat), en yeni başta."""
    try:
        girdiler = list(Path(dizin).iterdir())
    except (FileNotFoundError, NotADirectoryError):
        return []
    bulunan: list[tuple[tuple[str, str, int], Path, os.stat_result]] = []
    for p in girdiler:
        m = _YEDEK_KALIBI.fullmatch(p.name)
        if m is None:
            continue
        try:
            st = p.stat()
        except OSError:
            continue
        if not stat.S_ISREG(st.st_mode):
            continue
        bulunan.append(((m.group(1), m.group(2), int(m.group(3) or 1)), p, st))
    bulunan.sort(key=lambda x: x[0], reverse=True)
    return bulunan


def yedekleri_listele(hedef_dizin: Path) -> list[Path]:
    """`beyin-YYYYAAGG-SSDDSS[-N].db` kalıbına uyan yedekler, en yeni başta (addaki zamana göre).

    0 baytlık dosyalar yedek sayılmaz: bunlar `_yerlestir`'in ad ayırma yer tutucularıdır (ya da
    yarıda kalmış bir yedeklemenin artığıdır); listelemede görünmez, budama hesabına girmez.
    Geçerli bir SQLite yedeği hiçbir zaman boş değildir.
    """
    return [p for _, p, st in _kalip_dosyalari(hedef_dizin) if st.st_size > 0]


def _bayat_yer_tutuculari_sil(dizin: Path) -> None:
    """Kalıba uyan, 0 baytlık ve `_YER_TUTUCU_BAYAT` saniyeden eski dosyaları siler.

    Bir yer tutucu, canlı bir yedeklemede ad ayrılmasıyla taşıma arasındaki milisaniyeler
    boyunca vardır; bu kadar eski olanı ancak ölmüş bir süreçten kalmıştır. Eşzamanlı çalışan
    bir yedeklemenin taze yer tutucusuna dokunulmaz.
    """
    simdi = time.time()
    for _, p, st in _kalip_dosyalari(dizin):
        if st.st_size == 0 and simdi - st.st_mtime > _YER_TUTUCU_BAYAT:
            try:
                p.unlink()
            except OSError:
                pass


def _yerlestir(gecici: Path, dizin: Path, damga: str) -> Path:
    """Geçici dosyayı var olan hiçbir dosyanın üstüne yazmadan kalıba uyan bir ada taşır.

    Ad önce O_EXCL ile 0 baytlık bir yer tutucuyla ayrılır (eşzamanlı iki yedekleme aynı adı
    alamaz), sonra geçici dosya atomik olarak o adın yerine konur; taşıma başarısız olursa yer
    tutucu silinir. Yer tutucu hiçbir zaman yedek sayılmaz (bkz. `yedekleri_listele`). Ek, o
    saniyedeki en büyük mevcut ekten (yer tutucular dahil) başlar: budamayla boşalan küçük bir
    ad yeniden kullanılmaz, böylece yeni yedek aynı saniyedeki her yedekten yeni sıralanır.
    """
    mevcut_ekler = [0]
    for (tarih, saat, ek), _, _ in _kalip_dosyalari(dizin):
        if f"{tarih}-{saat}" == damga:
            mevcut_ekler.append(ek)
    for n in range(max(mevcut_ekler) + 1, max(mevcut_ekler) + 1000):
        ad = f"beyin-{damga}.db" if n == 1 else f"beyin-{damga}-{n}.db"
        hedef = dizin / ad
        try:
            fd = os.open(hedef, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0))
        except FileExistsError:
            continue
        os.close(fd)
        try:
            os.replace(gecici, hedef)
        except BaseException:
            try:
                hedef.unlink()
            except OSError:
                pass
            raise
        return hedef
    raise YedekHatasi(f"{dizin} içinde {damga} için boş yedek adı bulunamadı.")


def _buda(dizin: Path, sakla: int, korunan: list[Path]) -> None:
    """En yeni `sakla` yedek dışındakileri siler; korunanlara (yeni yedek, kaynak) dokunmaz.

    Silinemeyen (açık ya da başka bir yedeklemenin o an sildiği) dosya atlanır: yedek zaten
    alınmıştır, budama bir sonraki çalıştırmada tekrar denenir. Önce ölmüş süreçlerden kalan
    bayat yer tutucular temizlenir.
    """
    _bayat_yer_tutuculari_sil(dizin)
    for p in yedekleri_listele(dizin)[sakla:]:
        if any(_ayni_dosya(p, k) for k in korunan):
            continue
        try:
            p.unlink()
        except OSError:
            pass


def yedekle(
    db_yol: Path,
    hedef_dizin: Path,
    sakla: int = 14,
    simdi: datetime | None = None,
) -> Path:
    """`db_yol`'un tutarlı bir kopyasını `hedef_dizin/beyin-YYYYAAGG-SSDDSS.db` olarak yazar.

    Kopya `dogrula`'dan geçmezse silinir ve YedekHatasi fırlar. Başarıdan sonra kalıba uyan en
    yeni `sakla` yedek kalır; yeni alınan yedek (addaki zaman daha eski olsa bile) ve kaynak
    dosya hiçbir zaman silinmez. `simdi` verilirse addaki zaman olarak alanları olduğu gibi
    kullanılır (saat dilimi dönüşümü yapılmaz); verilmezse yerel saat.
    """
    if sakla < 1:
        raise ValueError("sakla en az 1 olmalı")
    db_yol = Path(db_yol)
    dizin = Path(hedef_dizin)
    if not db_yol.is_file():
        raise YedekHatasi(f"Yedeklenecek veritabanı bulunamadı: {db_yol}")
    if dizin.exists() and not dizin.is_dir():
        raise YedekHatasi(f"Yedek dizini bir klasör değil: {dizin}")
    try:
        dizin.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise YedekHatasi(f"Yedek dizini oluşturulamadı: {dizin} ({_neden(e)}).") from e
    damga = (simdi or datetime.now()).strftime("%Y%m%d-%H%M%S")
    gecici = dizin / f".beyin-yedek-{secrets.token_hex(6)}.tmp"
    try:
        _sqlite_kopyala(db_yol, gecici)
        try:
            dogrula(gecici)
        except YedekHatasi as e:
            raise YedekHatasi(f"Alınan yedek doğrulanamadı, silindi: {e}") from e
        yeni = _yerlestir(gecici, dizin, damga)
    except YedekHatasi:
        _sil(gecici)
        raise
    except (sqlite3.Error, OSError) as e:
        _sil(gecici)
        raise YedekHatasi(f"Yedek alınamadı ({_neden(e)}); yarım kopya silindi.") from e
    except BaseException:
        _sil(gecici)
        raise
    _buda(dizin, sakla, [yeni, db_yol])
    return yeni


# ---------------------------------------------------------------- servis saptama


def _kilit_dene(yol: Path) -> BinaryIO | None:
    """Servis kilidini tutmayı dener; tutarsa açık dosyayı, servis tutuyorsa None döndürür."""
    f = open(yol, "a+b")
    try:
        if sys.platform == "win32":
            import msvcrt

            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        return None
    return f


def _kilit_birak(f: BinaryIO) -> None:
    try:
        if sys.platform == "win32":
            import msvcrt

            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
    except OSError:
        pass
    try:
        f.close()
    except OSError:
        pass


def servis_calisiyor_mu(db_yol: Path | None = None) -> bool:
    """`db_yol`'u (verilmezse varsayılan veritabanını) kullanan bir servis çalışıyor mu?

    Servis kilidini veritabanının klasöründe tutar (servis._durum_klasoru). Kilit dosyası yoksa
    servis hiç açılmamıştır; varsa kilit kısa süre denenip bırakılır. Ağ isteği yapılmaz.
    """
    if db_yol is None:
        from .db import varsayilan_yol

        db_yol = varsayilan_yol()
    kilit = Path(db_yol).resolve().parent / KILIT_ADI
    if not kilit.exists():
        return False
    try:
        f = _kilit_dene(kilit)
    except OSError:
        return True  # açılamıyorsa güvenli taraf: çalışıyor say
    if f is None:
        return True
    _kilit_birak(f)
    return False


# ---------------------------------------------------------------- geri yükleme


def _tasi(kaynak: Path, hedef: Path) -> None:
    """Üstüne yazmadan taşır (aynı klasör). Windows'ta kısa süreli paylaşım ihlali yeniden denenir."""
    if os.path.lexists(hedef):
        raise FileExistsError(errno.EEXIST, "hedef zaten var", str(hedef))
    for deneme in range(_TASIMA_DENEME):
        try:
            os.rename(kaynak, hedef)  # Windows: hedef varsa FileExistsError
            return
        except PermissionError:
            if sys.platform != "win32" or deneme == _TASIMA_DENEME - 1:
                raise
            time.sleep(_TASIMA_ARALIK)


def _eski_ad(db: Path, damga: str) -> Path:
    """Kenara alınacak ad: `<ad>-eski-<damga>[-N]<uzantı>`; ana dosya ve yan dosyaları boş olmalı."""
    for n in range(1, 1000):
        ek = "" if n == 1 else f"-{n}"
        aday = db.with_name(f"{db.stem}-eski-{damga}{ek}{db.suffix}")
        if not any(os.path.lexists(_yan(aday, e)) for e in ("",) + YAN_EKLER):
            return aday
    raise YedekHatasi(f"{db.parent} içinde eski veritabanı için boş ad bulunamadı.")


def _geri_al(tasinanlar: list[tuple[Path, Path]]) -> list[str]:
    """Taşımaları ters sırayla geri alır; geri alınamayanların açıklamasını döndürür."""
    hatalar: list[str] = []
    for kaynak, hedef in reversed(tasinanlar):
        try:
            _tasi(hedef, kaynak)
        except OSError as e:
            hatalar.append(f"{hedef} -> {kaynak} ({_neden(e)})")
    return hatalar


def _yerine_koy(yedek: Path, db: Path) -> Path | None:
    damga = datetime.now().strftime("%Y%m%d-%H%M%S")
    gecici = db.with_name(f".{db.name}.geri-{secrets.token_hex(6)}.tmp")
    try:
        _sqlite_kopyala(yedek, gecici)
        dogrula(gecici)
    except YedekHatasi as e:
        _sil(gecici)
        raise YedekHatasi(f"Yedeğin kopyası doğrulanamadı; mevcut veritabanı değişmedi: {e}") from e
    except (sqlite3.Error, OSError) as e:
        _sil(gecici)
        raise YedekHatasi(
            f"Yedek kopyalanamadı ({_neden(e)}); mevcut veritabanı değişmedi."
        ) from e
    except BaseException:
        _sil(gecici)
        raise

    ana_var = db.exists()
    tasinanlar: list[tuple[Path, Path]] = []
    eski: Path | None = None
    try:
        mevcut = [e for e in ("",) + YAN_EKLER if os.path.lexists(_yan(db, e))]
        if mevcut:
            eski = _eski_ad(db, damga)
            # Ana dosya önce: Windows'ta açık bir bağlantı varsa burada, hiçbir şey taşınmadan durur.
            for e in mevcut:
                _tasi(_yan(db, e), _yan(eski, e))
                tasinanlar.append((_yan(db, e), _yan(eski, e)))
        artan = [e for e in YAN_EKLER if os.path.lexists(_yan(db, e))]
        if artan:
            raise YedekHatasi(
                "Geri yükleme sırasında veritabanının yan dosyaları yeniden oluştu "
                f"({', '.join(artan)}); veritabanını kullanan bir süreç var. Kapatıp yeniden dene."
            )
        _tasi(gecici, db)
    except BaseException as e:
        geri_alinamayan = _geri_al(tasinanlar)
        _sil(gecici)
        if geri_alinamayan:
            raise YedekHatasi(
                "Geri yükleme yarıda kaldı ve eski durum tam geri getirilemedi; el ile düzeltin: "
                + "; ".join(geri_alinamayan)
            ) from e
        if isinstance(e, YedekHatasi):
            raise
        if isinstance(e, OSError):
            ipucu = (
                " Veritabanını kullanan süreçleri (servis, MCP köprüsü, açık komutlar) kapatıp yeniden dene."
                if isinstance(e, PermissionError) or getattr(e, "winerror", None) in (32, 33)
                else ""
            )
            raise YedekHatasi(
                f"Geri yükleme yapılamadı ({_neden(e)}); mevcut veritabanı değişmedi.{ipucu}"
            ) from e
        raise
    return eski if ana_var else None


def geri_yukle(
    yedek_yol: Path,
    db_yol: Path,
    servis_calisiyor: Callable[[], bool] | None = None,
) -> Path | None:
    """Yedeği `db_yol`'a geri yükler; kenara alınan eski veritabanının yolunu (yoksa None) döndürür.

    Sıra: yedek `dogrula`; servis çalışıyorsa red (`servis_calisiyor` verilmişse o, verilmezse
    servis kilidi denenir ve işlem boyunca tutulur); yedek, hedefin klasöründe geçici bir dosyaya
    kopyalanıp yeniden doğrulanır; mevcut veritabanı yan dosyalarıyla kenara taşınır; geçici
    kopya `db_yol` adına taşınır. Herhangi bir adımda hata olursa taşımalar geri alınır ve
    mevcut veritabanı yerinde kalır. Yedek dosyası salt okunur açılır, değişmez.
    """
    yedek = Path(yedek_yol)
    db = Path(db_yol)
    dogrula(yedek)
    if _ayni_dosya(yedek, db):
        raise YedekHatasi("Yedek dosyası ile geri yüklenecek veritabanı aynı dosya.")
    if db.exists() and not db.is_file():
        raise YedekHatasi(f"Hedef bir dosya değil: {db}")
    try:
        db.parent.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise YedekHatasi(f"Hedef klasör oluşturulamadı: {db.parent} ({_neden(e)}).") from e

    kilit: BinaryIO | None = None
    if servis_calisiyor is not None:
        if servis_calisiyor():
            raise YedekHatasi(_SERVIS_MESAJI)
    else:
        try:
            kilit = _kilit_dene(db.resolve().parent / KILIT_ADI)
        except OSError as e:
            raise YedekHatasi(f"Servis kilidi denetlenemedi ({_neden(e)}).") from e
        if kilit is None:
            raise YedekHatasi(_SERVIS_MESAJI)
    try:
        return _yerine_koy(yedek, db)
    finally:
        if kilit is not None:
            _kilit_birak(kilit)
