"""Beyin veritabanı: şema, bağlantı, kimlik, normalleştirme, yazma ilkelleri, FTS araması.

Hiyerarşik bilgi grafı: kök (kullanıcı) → dallar → düğümler. `alt` kenarları DAG'dir; kök
dışındaki her düğümün tam bir birincil `alt` ebeveyni olur. Yalnız stdlib.

Kurallar:
- Yazma fonksiyonları commit ETMEZ; çağıran `with con:` kullanır.
- Her yazma `gecmis` tablosuna eski/yeni JSON ile kayıt düşer ve FTS'yi günceller.
- Hiçbir fonksiyon sessizce veri silmez. `olgu` ve `gecmis` satırları tetikleyicilerle korunur.
- Doğrulama hataları (alan sınırı, geçersiz değer, bulunamayan kimlik, döngü) ValueError'dır.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import sqlite3
import threading
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SEMA_SURUMU = 2

DUGUM_TURLERI = ("kok", "dal", "proje", "kisi", "olay", "tercih", "kural", "arac", "bilgi")
DUGUM_DURUMLARI = ("aktif", "bitti", "duraklatildi", "bekliyor", "bilinmiyor", "arsiv")
GIZLILIKLER = ("normal", "ozel", "sir_icerir")
KENAR_TURLERI = ("alt", "ilgili")
GUVENLER = ("yuksek", "orta", "dusuk")
OLGU_DURUMLARI = ("aktif", "eskidi", "celisik", "reddedildi")
KAYNAK_TURLERI = ("tohum", "oturum", "memory", "devir", "elle")
GELEN_TURLERI = ("yeni_dugum", "olgu", "celiski", "tasima")
GELEN_DURUMLARI = ("bekliyor", "kabul", "red")

BASLIK_SINIR = 120
OZET_SINIR = 200
AYRINTI_SINIR = 1500
OLGU_SINIR = 300

# Yeni veritabanında kök düğüm bu anahtar ve başlıkla açılır. Başlık sonradan
# değiştirilebilir; eski veritabanlarındaki kök, anahtarı farklı olsa da türünden
# (tur = 'kok') bulunur.
KOK_ANAHTAR = "kok"
KOK_BASLIK = "Kullanıcı"

# dugum_guncelle ile değiştirilebilen alanlar
GUNCELLENEBILIR = ("anahtar", "baslik", "ozet", "ayrinti", "tur", "durum", "gizlilik", "tarih")

# BM25 sütun ağırlıkları: id (UNINDEXED), baslik, ozet, ayrinti, olgular
_BM25_AGIRLIK = (0.0, 10.0, 4.0, 1.0, 2.0)
_SORGU_TOKEN_SINIR = 32
_ONEK_MIN = 3  # bu uzunluktan kısa sorgu kelimeleri önek (*) araması yapmaz


def _enum(degerler: Iterable[str]) -> str:
    return ", ".join(f"'{d}'" for d in degerler)


_SEMA = f"""
CREATE TABLE IF NOT EXISTS dugum (
    id          TEXT PRIMARY KEY,
    anahtar     TEXT UNIQUE,
    baslik      TEXT NOT NULL CHECK (length(trim(baslik)) > 0),
    ozet        TEXT NOT NULL DEFAULT '' CHECK (length(ozet) <= {OZET_SINIR}),
    ayrinti     TEXT NOT NULL DEFAULT '' CHECK (length(ayrinti) <= {AYRINTI_SINIR}),
    tur         TEXT NOT NULL DEFAULT 'bilgi' CHECK (tur IN ({_enum(DUGUM_TURLERI)})),
    durum       TEXT NOT NULL DEFAULT 'aktif' CHECK (durum IN ({_enum(DUGUM_DURUMLARI)})),
    gizlilik    TEXT NOT NULL DEFAULT 'normal' CHECK (gizlilik IN ({_enum(GIZLILIKLER)})),
    tarih       TEXT,
    olusturma   TEXT NOT NULL,
    guncelleme  TEXT NOT NULL,
    surum       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS dugum_tur ON dugum(tur);

CREATE TABLE IF NOT EXISTS kenar (
    ebeveyn   TEXT NOT NULL REFERENCES dugum(id),
    cocuk     TEXT NOT NULL REFERENCES dugum(id),
    tur       TEXT NOT NULL CHECK (tur IN ({_enum(KENAR_TURLERI)})),
    birincil  INTEGER NOT NULL DEFAULT 0 CHECK (birincil IN (0, 1) AND (birincil = 0 OR tur = 'alt')),
    sira      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (ebeveyn, cocuk, tur),
    CHECK (ebeveyn <> cocuk)
);
CREATE INDEX IF NOT EXISTS kenar_cocuk ON kenar(cocuk, tur);
CREATE UNIQUE INDEX IF NOT EXISTS kenar_tek_birincil ON kenar(cocuk) WHERE birincil = 1;

CREATE TABLE IF NOT EXISTS kaynak (
    id        TEXT PRIMARY KEY,
    tur       TEXT NOT NULL CHECK (tur IN ({_enum(KAYNAK_TURLERI)})),
    ref       TEXT,
    istemci   TEXT,
    tarih     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS olgu (
    id            TEXT PRIMARY KEY,
    dugum         TEXT NOT NULL REFERENCES dugum(id),
    metin         TEXT NOT NULL CHECK (length(trim(metin)) > 0 AND length(metin) <= {OLGU_SINIR}),
    gecerli_bas   TEXT,
    gecerli_bit   TEXT,
    yerine_gecen  TEXT REFERENCES olgu(id),
    kaynak_id     TEXT REFERENCES kaynak(id),
    guven         TEXT NOT NULL DEFAULT 'orta' CHECK (guven IN ({_enum(GUVENLER)})),
    durum         TEXT NOT NULL DEFAULT 'aktif' CHECK (durum IN ({_enum(OLGU_DURUMLARI)})),
    olusturma     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS olgu_dugum ON olgu(dugum, durum);
CREATE TRIGGER IF NOT EXISTS olgu_silinmez BEFORE DELETE ON olgu
BEGIN SELECT RAISE(ABORT, 'olgu silinmez; olgu_eskit kullan'); END;

CREATE TABLE IF NOT EXISTS ek (
    id             TEXT PRIMARY KEY,
    dugum          TEXT NOT NULL REFERENCES dugum(id),
    drive_file_id  TEXT,
    ad             TEXT,
    mime           TEXT,
    boyut          INTEGER,
    sha256         TEXT,
    ozet           TEXT
);
CREATE INDEX IF NOT EXISTS ek_dugum ON ek(dugum);

CREATE TABLE IF NOT EXISTS gelen (
    id          TEXT PRIMARY KEY,
    zaman       TEXT NOT NULL,
    tur         TEXT NOT NULL CHECK (tur IN ({_enum(GELEN_TURLERI)})),
    oneri_json  TEXT NOT NULL,
    kaynak_id   TEXT REFERENCES kaynak(id),
    durum       TEXT NOT NULL DEFAULT 'bekliyor' CHECK (durum IN ({_enum(GELEN_DURUMLARI)}))
);
CREATE INDEX IF NOT EXISTS gelen_durum ON gelen(durum, zaman);

CREATE TABLE IF NOT EXISTS gecmis (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    zaman      TEXT NOT NULL,
    islem      TEXT NOT NULL,
    tablo      TEXT NOT NULL,
    hedef_id   TEXT,
    eski_json  TEXT,
    yeni_json  TEXT,
    kaynak_id  TEXT REFERENCES kaynak(id)
);
CREATE INDEX IF NOT EXISTS gecmis_hedef ON gecmis(hedef_id);
CREATE TRIGGER IF NOT EXISTS gecmis_degismez BEFORE UPDATE ON gecmis
BEGIN SELECT RAISE(ABORT, 'gecmis ekleme-yalniz'); END;
CREATE TRIGGER IF NOT EXISTS gecmis_silinmez BEFORE DELETE ON gecmis
BEGIN SELECT RAISE(ABORT, 'gecmis ekleme-yalniz'); END;

CREATE VIRTUAL TABLE IF NOT EXISTS dugum_fts USING fts5(
    id UNINDEXED, baslik, ozet, ayrinti, olgular,
    tokenize = 'unicode61 remove_diacritics 2'
);
"""

# Sürüm 2: olgu metni değişmez, başlık ≤120. Tetikleyiciyle (tablo yeniden kurulmadan) uygulanır;
# böylece taze ve göç edilmiş veritabanı aynı kuralları taşır. gecmis UPDATE/DELETE'e v1'den beri kapalı.
_GOC_2 = f"""
CREATE TRIGGER IF NOT EXISTS olgu_degismez BEFORE UPDATE ON olgu
WHEN NEW.id IS NOT OLD.id OR NEW.dugum IS NOT OLD.dugum OR NEW.metin IS NOT OLD.metin
  OR NEW.gecerli_bas IS NOT OLD.gecerli_bas OR NEW.kaynak_id IS NOT OLD.kaynak_id
  OR NEW.guven IS NOT OLD.guven OR NEW.olusturma IS NOT OLD.olusturma
BEGIN SELECT RAISE(ABORT, 'olguda yalniz durum, gecerli_bit, yerine_gecen degisebilir'); END;
CREATE TRIGGER IF NOT EXISTS dugum_baslik_ekle BEFORE INSERT ON dugum
WHEN length(NEW.baslik) > {BASLIK_SINIR}
BEGIN SELECT RAISE(ABORT, 'baslik {BASLIK_SINIR} karakteri asamaz'); END;
CREATE TRIGGER IF NOT EXISTS dugum_baslik_guncelle BEFORE UPDATE OF baslik ON dugum
WHEN length(NEW.baslik) > {BASLIK_SINIR} AND NEW.baslik IS NOT OLD.baslik
BEGIN SELECT RAISE(ABORT, 'baslik {BASLIK_SINIR} karakteri asamaz'); END;
"""

# FTS satırını düğümden üretir. sir_icerir düğümde yalnız başlık indekslenir (gövde aramayla
# sınanamasın diye). Sorgu bağlantıda kayıtlı `bellek_normalize` fonksiyonunu kullanır.
_FTS_SECIM = """
SELECT d.id,
       bellek_normalize(d.baslik),
       CASE WHEN d.gizlilik = 'sir_icerir' THEN '' ELSE bellek_normalize(d.ozet) END,
       CASE WHEN d.gizlilik = 'sir_icerir' THEN '' ELSE bellek_normalize(d.ayrinti) END,
       CASE WHEN d.gizlilik = 'sir_icerir' THEN '' ELSE bellek_normalize(
           (SELECT group_concat(metin, ' ') FROM
               (SELECT metin FROM olgu WHERE dugum = d.id AND durum = 'aktif' ORDER BY id)))
       END
FROM dugum d
"""
_FTS_EKLE = "INSERT INTO dugum_fts (id, baslik, ozet, ayrinti, olgular)" + _FTS_SECIM
_FTS_HEPSI = "DELETE FROM dugum_fts;\n" + _FTS_EKLE + ";\n"


# ---------------------------------------------------------------- bağlantı


def varsayilan_yol() -> Path:
    """`BELLEK_BEYIN_DB` varsa o, yoksa `%LOCALAPPDATA%\\Bellek\\beyin.db`."""
    ortam = os.environ.get("BELLEK_BEYIN_DB")
    if ortam:
        return Path(ortam)
    yerel = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(yerel) / "Bellek" / "beyin.db"


def baglan(yol: str | os.PathLike[str] | None = None, salt_okunur: bool = False) -> sqlite3.Connection:
    """Veritabanına bağlanır. Yazılabilir modda şema yoksa kurar; salt okunurda kurmaz."""
    hedef = Path(yol) if yol is not None else varsayilan_yol()
    if salt_okunur:
        uri = hedef.resolve().as_uri() + "?mode=ro"
        con = sqlite3.connect(uri, uri=True, timeout=5.0)
    else:
        hedef.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(str(hedef), timeout=5.0)
    con.row_factory = sqlite3.Row
    _normalize_kaydet(con)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA busy_timeout = 5000")
    surum = con.execute("PRAGMA user_version").fetchone()[0]
    if surum > SEMA_SURUMU:
        con.close()
        raise RuntimeError(
            f"beyin.db şema sürümü {surum}, bu kod en çok {SEMA_SURUMU} biliyor; kodu güncelle"
        )
    if not salt_okunur:
        con.execute("PRAGMA journal_mode = WAL")
        if surum < SEMA_SURUMU:
            _sema_kur(con)
    return con


def _sema_kur(con: sqlite3.Connection) -> None:
    """Şemayı kurar ya da eski sürümden göç eder; tek işlemde, veri silmeden.

    Tüm adımlar tekrar çalıştırılabilir (IF NOT EXISTS), bu yüzden v0 (boş) ve v1 aynı betikten
    geçer. Göç FTS'yi baştan üretir (v2: sir_icerir düğümlerin gövdesi indeksten çıkar).
    """
    betik = (
        "BEGIN IMMEDIATE;\n" + _SEMA + _GOC_2 + _FTS_HEPSI
        + f"PRAGMA user_version = {SEMA_SURUMU};\nCOMMIT;"
    )
    # executescript önce bekleyen işlemi commit eder; baglan() içinde bekleyen işlem yok.
    try:
        con.executescript(betik)
    except BaseException:
        if con.in_transaction:
            con.rollback()
        raise


# ---------------------------------------------------------------- kimlik ve zaman

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_ulid_kilit = threading.Lock()
_ulid_son_ms = -1
_ulid_son_rastgele = 0


def yeni_id() -> str:
    """ULID: 48 bit ms zaman + 80 bit rastgele, Crockford base32, 26 karakter.

    Aynı milisaniyede üretilenler rastgele kısmı bir artırarak sıralı kalır (monoton ULID).
    """
    global _ulid_son_ms, _ulid_son_rastgele
    with _ulid_kilit:
        ms = time.time_ns() // 1_000_000
        if ms <= _ulid_son_ms:
            ms = _ulid_son_ms
            rastgele = _ulid_son_rastgele + 1
            if rastgele >= 1 << 80:  # taşma: bir sonraki milisaniyeye geç
                ms += 1
                rastgele = secrets.randbits(80)
        else:
            rastgele = secrets.randbits(80)
        _ulid_son_ms, _ulid_son_rastgele = ms, rastgele
    sayi = (ms << 80) | rastgele
    karakterler = []
    for _ in range(26):
        karakterler.append(_CROCKFORD[sayi & 31])
        sayi >>= 5
    return "".join(reversed(karakterler))


def _simdi() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ---------------------------------------------------------------- normalleştirme

_TR_BUYUK = str.maketrans({"I": "ı", "İ": "i"})
_AYIRICI = re.compile(r"[\W_]+", re.UNICODE)


def normalize(metin: str | None) -> str:
    """Arama için Türkçe duyarlı katlanmış biçim (DESIGN.md §8.2 adım 1-3 + noktalama).

    1. Türkçe küçük harf: I→ı, İ→i, sonra lower()   (KIRMIZI → kırmızı)
    2. ı → i                                        (kırmızı → kirmizi)
    3. ASCII katlama: NFKD + birleşik işaretleri at (şöyle → soyle, ç/ğ/ö/ş/ü ve diğer aksanlar)
    4. Harf/rakam dışı her şey (kesme işareti, alt çizgi dahil) boşluk; boşluklar teke iner.

    §8.2 adım 4 (5 harf önek kesme) uygulanmaz; açık (M3). Bunun yerine fts_ara sorgu
    kelimelerinde önek araması yapar. Hem indeks hem sorgu bu fonksiyondan geçer.
    """
    if not metin:
        return ""
    s = metin.translate(_TR_BUYUK).lower().replace("ı", "i")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("ß", "ss")
    return " ".join(_AYIRICI.sub(" ", s).split())


# ---------------------------------------------------------------- iç yardımcılar


def _satir_dict(satir: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(satir) if satir is not None else None


def _json(veri: Any) -> str | None:
    if veri is None:
        return None
    return json.dumps(veri, ensure_ascii=False, sort_keys=True)


def _gecmis_yaz(
    con: sqlite3.Connection,
    islem: str,
    tablo: str,
    hedef_id: str | None,
    eski: Any,
    yeni: Any,
    kaynak_id: str | None,
) -> None:
    con.execute(
        "INSERT INTO gecmis (zaman, islem, tablo, hedef_id, eski_json, yeni_json, kaynak_id)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (_simdi(), islem, tablo, hedef_id, _json(eski), _json(yeni), kaynak_id),
    )


def _secim(ad: str, deger: str, izinli: tuple[str, ...]) -> None:
    if deger not in izinli:
        raise ValueError(f"geçersiz {ad}: {deger!r}; izinli: {', '.join(izinli)}")


def _sinir(ad: str, metin: str | None, sinir: int) -> None:
    if metin is not None and len(metin) > sinir:
        raise ValueError(f"{ad} {len(metin)} karakter; sınır {sinir}")


def _dugum_satiri(con: sqlite3.Connection, id: str) -> sqlite3.Row:
    satir = con.execute("SELECT * FROM dugum WHERE id = ?", (id,)).fetchone()
    if satir is None:
        raise ValueError(f"düğüm yok: {id!r}")
    return satir


def _kaynak_dogrula(con: sqlite3.Connection, kaynak_id: str | None) -> None:
    if kaynak_id is None:
        return
    if con.execute("SELECT 1 FROM kaynak WHERE id = ?", (kaynak_id,)).fetchone() is None:
        raise ValueError(f"kaynak yok: {kaynak_id!r}")


def _normalize_kaydet(con: sqlite3.Connection) -> None:
    con.create_function("bellek_normalize", 1, normalize, deterministic=True)


def _normalize_ile(con: sqlite3.Connection, sql: str, parametre: tuple[Any, ...] = ()) -> None:
    """`bellek_normalize` kullanan deyimi çalıştırır. baglan() kaydeder; dışarıda açılmış bir
    bağlantıda fonksiyon yoksa kaydedip bir kez yeniden dener (hazırlık hatası işlemi bozmaz)."""
    try:
        con.execute(sql, parametre)
    except sqlite3.OperationalError as e:
        if "bellek_normalize" not in str(e):
            raise
        _normalize_kaydet(con)
        con.execute(sql, parametre)


def _fts_yenile(con: sqlite3.Connection, dugum_id: str) -> None:
    """Düğümün FTS satırını yeniden yazar (_FTS_SECIM kuralıyla: sir_icerir'de yalnız başlık)."""
    con.execute("DELETE FROM dugum_fts WHERE id = ?", (dugum_id,))
    _normalize_ile(con, _FTS_EKLE + " WHERE d.id = ?", (dugum_id,))


def fts_yeniden_kur(con: sqlite3.Connection) -> int:
    """Tüm FTS indeksini düğümlerden yeniden kurar (normalleştirme değişirse). Düğüm sayısını döner.

    Göçle aynı kuralı (_FTS_SECIM) kullanır. FTS türetilmiş veridir; gecmis'e yazılmaz. Commit etmez.
    """
    con.execute("DELETE FROM dugum_fts")
    _normalize_ile(con, _FTS_EKLE)
    return con.execute("SELECT count(*) FROM dugum_fts").fetchone()[0]


# ---------------------------------------------------------------- kaynak


def kaynak_ekle(
    con: sqlite3.Connection,
    tur: str,
    ref: str | None,
    istemci: str | None = None,
    tarih: str | None = None,
) -> str:
    _secim("kaynak türü", tur, KAYNAK_TURLERI)
    yeni = {"id": yeni_id(), "tur": tur, "ref": ref, "istemci": istemci, "tarih": tarih or _simdi()}
    con.execute(
        "INSERT INTO kaynak (id, tur, ref, istemci, tarih) VALUES (:id, :tur, :ref, :istemci, :tarih)",
        yeni,
    )
    _gecmis_yaz(con, "ekle", "kaynak", yeni["id"], None, yeni, yeni["id"])
    return yeni["id"]


# ---------------------------------------------------------------- düğüm


def _dugum_alanlari_dogrula(alanlar: dict[str, Any]) -> None:
    if "baslik" in alanlar:
        b = alanlar["baslik"]
        if not isinstance(b, str) or not b.strip():
            raise ValueError("baslik boş olamaz")
        _sinir("baslik", b, BASLIK_SINIR)
    for ad in ("ozet", "ayrinti"):
        if ad in alanlar and alanlar[ad] is None:
            raise ValueError(f"{ad} None olamaz; boş için '' ver")
    _sinir("ozet", alanlar.get("ozet"), OZET_SINIR)
    _sinir("ayrinti", alanlar.get("ayrinti"), AYRINTI_SINIR)
    if "tur" in alanlar:
        _secim("düğüm türü", alanlar["tur"], DUGUM_TURLERI)
    if "durum" in alanlar:
        _secim("düğüm durumu", alanlar["durum"], DUGUM_DURUMLARI)
    if "gizlilik" in alanlar:
        _secim("gizlilik", alanlar["gizlilik"], GIZLILIKLER)
    if "anahtar" in alanlar:
        a = alanlar["anahtar"]
        if a is not None and (not isinstance(a, str) or not a.strip()):
            raise ValueError("anahtar boş dize olamaz; anahtarsız için None ver")


def _anahtar_bos_mu(con: sqlite3.Connection, anahtar: str | None, haric: str | None = None) -> None:
    if anahtar is None:
        return
    satir = con.execute("SELECT id FROM dugum WHERE anahtar = ?", (anahtar,)).fetchone()
    if satir is not None and satir[0] != haric:
        raise ValueError(f"anahtar kullanımda: {anahtar!r} ({satir[0]})")


def dugum_ekle(
    con: sqlite3.Connection,
    baslik: str,
    ozet: str = "",
    ayrinti: str = "",
    tur: str = "bilgi",
    durum: str = "aktif",
    gizlilik: str = "normal",
    tarih: str | None = None,
    ebeveyn: str | None = None,
    anahtar: str | None = None,
    kaynak_id: str | None = None,
) -> str:
    """Düğüm ekler; ebeveyn verilirse birincil `alt` kenarını da kurar."""
    alanlar = {
        "baslik": baslik, "ozet": ozet, "ayrinti": ayrinti, "tur": tur,
        "durum": durum, "gizlilik": gizlilik, "anahtar": anahtar,
    }
    _dugum_alanlari_dogrula(alanlar)
    _kaynak_dogrula(con, kaynak_id)
    _anahtar_bos_mu(con, anahtar)
    if ebeveyn is not None:
        _dugum_satiri(con, ebeveyn)
        if tur == "kok":
            raise ValueError("kök türündeki düğümün ebeveyni olamaz")
    simdi = _simdi()
    yeni = dict(
        alanlar, id=yeni_id(), tarih=tarih, olusturma=simdi, guncelleme=simdi, surum=1
    )
    con.execute(
        "INSERT INTO dugum (id, anahtar, baslik, ozet, ayrinti, tur, durum, gizlilik, tarih,"
        " olusturma, guncelleme, surum) VALUES (:id, :anahtar, :baslik, :ozet, :ayrinti, :tur,"
        " :durum, :gizlilik, :tarih, :olusturma, :guncelleme, :surum)",
        yeni,
    )
    _gecmis_yaz(con, "ekle", "dugum", yeni["id"], None, yeni, kaynak_id)
    _fts_yenile(con, yeni["id"])
    if ebeveyn is not None:
        kenar_ekle(con, ebeveyn, yeni["id"], "alt", birincil=True, kaynak_id=kaynak_id)
    return yeni["id"]


def dugum_guncelle(con: sqlite3.Connection, id: str, kaynak_id: str | None = None, **alanlar: Any) -> None:
    """Verilen alanları değiştirir; değişiklik varsa surum+1 ve guncelleme yenilenir."""
    if not alanlar:
        raise ValueError("güncellenecek alan verilmedi")
    bilinmeyen = set(alanlar) - set(GUNCELLENEBILIR)
    if bilinmeyen:
        raise ValueError(
            f"güncellenemeyen alan: {', '.join(sorted(bilinmeyen))}; izinli: {', '.join(GUNCELLENEBILIR)}"
        )
    _dugum_alanlari_dogrula(alanlar)
    _kaynak_dogrula(con, kaynak_id)
    eski = dict(_dugum_satiri(con, id))
    degisen = {k: v for k, v in alanlar.items() if eski[k] != v}
    if not degisen:
        return
    if "anahtar" in degisen:
        _anahtar_bos_mu(con, degisen["anahtar"], haric=id)
    if degisen.get("tur") == "kok" and con.execute(
        "SELECT 1 FROM kenar WHERE cocuk = ? AND tur = 'alt'", (id,)
    ).fetchone():
        raise ValueError("ebeveyni olan düğüm kök türüne çevrilemez")
    degisen["guncelleme"] = _simdi()
    degisen["surum"] = eski["surum"] + 1
    atama = ", ".join(f"{k} = :{k}" for k in degisen)
    con.execute(f"UPDATE dugum SET {atama} WHERE id = :_id", dict(degisen, _id=id))
    yeni = dict(eski, **degisen)
    _gecmis_yaz(con, "guncelle", "dugum", id, eski, yeni, kaynak_id)
    if {"baslik", "ozet", "ayrinti", "gizlilik"} & set(degisen):
        _fts_yenile(con, id)


# ---------------------------------------------------------------- kenar


def torunlar(con: sqlite3.Connection, id: str) -> set[str]:
    """`alt` kenarlarla ulaşılan tüm torunlar (düğümün kendisi hariç)."""
    satirlar = con.execute(
        "WITH RECURSIVE t(id) AS ("
        "  SELECT cocuk FROM kenar WHERE ebeveyn = ? AND tur = 'alt'"
        "  UNION SELECT k.cocuk FROM kenar k JOIN t ON k.ebeveyn = t.id WHERE k.tur = 'alt'"
        ") SELECT id FROM t",
        (id,),
    )
    sonuc = {r[0] for r in satirlar}
    sonuc.discard(id)
    return sonuc


def _kenar_satiri(con: sqlite3.Connection, ebeveyn: str, cocuk: str, tur: str) -> sqlite3.Row | None:
    return con.execute(
        "SELECT * FROM kenar WHERE ebeveyn = ? AND cocuk = ? AND tur = ?", (ebeveyn, cocuk, tur)
    ).fetchone()


def _birincil_devret(con: sqlite3.Connection, cocuk: str, haric_ebeveyn: str, kaynak_id: str | None) -> None:
    for eski in con.execute(
        "SELECT * FROM kenar WHERE cocuk = ? AND tur = 'alt' AND birincil = 1 AND ebeveyn <> ?",
        (cocuk, haric_ebeveyn),
    ).fetchall():
        con.execute(
            "UPDATE kenar SET birincil = 0 WHERE ebeveyn = ? AND cocuk = ? AND tur = 'alt'",
            (eski["ebeveyn"], cocuk),
        )
        _gecmis_yaz(con, "guncelle", "kenar", cocuk, dict(eski), dict(eski, birincil=0), kaynak_id)


def kenar_ekle(
    con: sqlite3.Connection,
    ebeveyn: str,
    cocuk: str,
    tur: str = "alt",
    birincil: bool = False,
    kaynak_id: str | None = None,
) -> None:
    """Kenar ekler.

    - `alt` kenarında döngü (ve kendine kenar) ValueError.
    - birincil=True: önceki birincil 0 olur; kenar zaten varsa birincil yapılır.
    - Çocuğun henüz birincil ebeveyni yoksa yeni `alt` kenarı kendiliğinden birincil olur.
    - Kenar zaten varsa ve değişecek bir şey yoksa hiçbir şey yapmaz (birincil düşürülmez).
    """
    _secim("kenar türü", tur, KENAR_TURLERI)
    if birincil and tur != "alt":
        raise ValueError("birincil yalnız 'alt' kenarında olur")
    if ebeveyn == cocuk:
        raise ValueError("düğüm kendine kenar alamaz")
    _dugum_satiri(con, ebeveyn)
    cocuk_satir = _dugum_satiri(con, cocuk)
    _kaynak_dogrula(con, kaynak_id)

    if tur == "alt":
        if cocuk_satir["tur"] == "kok":
            raise ValueError("kök bir 'alt' kenarının çocuğu olamaz")
        if ebeveyn in torunlar(con, cocuk):
            raise ValueError(f"döngü: {ebeveyn!r} zaten {cocuk!r} düğümünün torunu")
        birincil_var = con.execute(
            "SELECT 1 FROM kenar WHERE cocuk = ? AND tur = 'alt' AND birincil = 1", (cocuk,)
        ).fetchone()
        if not birincil_var:
            birincil = True

    mevcut = _kenar_satiri(con, ebeveyn, cocuk, tur)
    if mevcut is not None:
        if birincil and not mevcut["birincil"]:
            _birincil_devret(con, cocuk, ebeveyn, kaynak_id)
            con.execute(
                "UPDATE kenar SET birincil = 1 WHERE ebeveyn = ? AND cocuk = ? AND tur = ?",
                (ebeveyn, cocuk, tur),
            )
            _gecmis_yaz(con, "guncelle", "kenar", cocuk, dict(mevcut), dict(mevcut, birincil=1), kaynak_id)
        return

    if birincil:
        _birincil_devret(con, cocuk, ebeveyn, kaynak_id)
    sira = con.execute(
        "SELECT COALESCE(MAX(sira), -1) + 1 FROM kenar WHERE ebeveyn = ? AND tur = ?", (ebeveyn, tur)
    ).fetchone()[0]
    yeni = {"ebeveyn": ebeveyn, "cocuk": cocuk, "tur": tur, "birincil": int(birincil), "sira": sira}
    con.execute(
        "INSERT INTO kenar (ebeveyn, cocuk, tur, birincil, sira) VALUES (:ebeveyn, :cocuk, :tur, :birincil, :sira)",
        yeni,
    )
    _gecmis_yaz(con, "ekle", "kenar", cocuk, None, yeni, kaynak_id)


def kenar_sil(
    con: sqlite3.Connection,
    ebeveyn: str,
    cocuk: str,
    tur: str = "alt",
    kaynak_id: str | None = None,
) -> None:
    """Kenarı siler (gecmis'e eski hali yazılır). Birincil kenar, başka birincil atanmadan silinemez."""
    _secim("kenar türü", tur, KENAR_TURLERI)
    _kaynak_dogrula(con, kaynak_id)
    mevcut = _kenar_satiri(con, ebeveyn, cocuk, tur)
    if mevcut is None:
        raise ValueError(f"kenar yok: {ebeveyn!r} -> {cocuk!r} ({tur})")
    if mevcut["birincil"]:
        raise ValueError(
            "birincil ebeveyn kenarı silinemez; önce kenar_ekle(..., birincil=True) ile başka ebeveyn ata"
        )
    con.execute(
        "DELETE FROM kenar WHERE ebeveyn = ? AND cocuk = ? AND tur = ?", (ebeveyn, cocuk, tur)
    )
    _gecmis_yaz(con, "sil", "kenar", cocuk, dict(mevcut), None, kaynak_id)


# ---------------------------------------------------------------- olgu


def olgu_ekle(
    con: sqlite3.Connection,
    dugum: str,
    metin: str,
    kaynak_id: str | None = None,
    guven: str = "orta",
    gecerli_bas: str | None = None,
) -> str:
    if not isinstance(metin, str) or not metin.strip():
        raise ValueError("olgu metni boş olamaz")
    _sinir("olgu metni", metin, OLGU_SINIR)
    _secim("güven", guven, GUVENLER)
    _dugum_satiri(con, dugum)
    _kaynak_dogrula(con, kaynak_id)
    simdi = _simdi()
    yeni = {
        "id": yeni_id(), "dugum": dugum, "metin": metin, "gecerli_bas": gecerli_bas or simdi,
        "gecerli_bit": None, "yerine_gecen": None, "kaynak_id": kaynak_id, "guven": guven,
        "durum": "aktif", "olusturma": simdi,
    }
    con.execute(
        "INSERT INTO olgu (id, dugum, metin, gecerli_bas, gecerli_bit, yerine_gecen, kaynak_id,"
        " guven, durum, olusturma) VALUES (:id, :dugum, :metin, :gecerli_bas, :gecerli_bit,"
        " :yerine_gecen, :kaynak_id, :guven, :durum, :olusturma)",
        yeni,
    )
    _gecmis_yaz(con, "ekle", "olgu", yeni["id"], None, yeni, kaynak_id)
    _fts_yenile(con, dugum)
    return yeni["id"]


def olgu_eskit(
    con: sqlite3.Connection,
    olgu_id: str,
    yerine_gecen: str | None = None,
    kaynak_id: str | None = None,
) -> None:
    """Olguyu `eskidi` yapar, gecerli_bit'i şimdiye çeker; satır silinmez."""
    eski = con.execute("SELECT * FROM olgu WHERE id = ?", (olgu_id,)).fetchone()
    if eski is None:
        raise ValueError(f"olgu yok: {olgu_id!r}")
    if eski["durum"] == "eskidi":
        raise ValueError(f"olgu zaten eskimiş: {olgu_id!r}")
    if yerine_gecen is not None:
        if yerine_gecen == olgu_id:
            raise ValueError("olgu kendi yerine geçemez")
        if con.execute("SELECT 1 FROM olgu WHERE id = ?", (yerine_gecen,)).fetchone() is None:
            raise ValueError(f"yerine geçen olgu yok: {yerine_gecen!r}")
    _kaynak_dogrula(con, kaynak_id)
    degisen = {"durum": "eskidi", "gecerli_bit": _simdi(), "yerine_gecen": yerine_gecen}
    con.execute(
        "UPDATE olgu SET durum = :durum, gecerli_bit = :gecerli_bit, yerine_gecen = :yerine_gecen"
        " WHERE id = :_id",
        dict(degisen, _id=olgu_id),
    )
    _gecmis_yaz(con, "guncelle", "olgu", olgu_id, dict(eski), dict(dict(eski), **degisen), kaynak_id)
    _fts_yenile(con, eski["dugum"])


# ---------------------------------------------------------------- gelen kutusu


def gelen_ekle(con: sqlite3.Connection, tur: str, oneri: dict, kaynak_id: str | None = None) -> str:
    _secim("gelen türü", tur, GELEN_TURLERI)
    if not isinstance(oneri, dict):
        raise ValueError("oneri dict olmalı")
    _kaynak_dogrula(con, kaynak_id)
    yeni = {
        "id": yeni_id(), "zaman": _simdi(), "tur": tur,
        "oneri_json": json.dumps(oneri, ensure_ascii=False, sort_keys=True),
        "kaynak_id": kaynak_id, "durum": "bekliyor",
    }
    con.execute(
        "INSERT INTO gelen (id, zaman, tur, oneri_json, kaynak_id, durum)"
        " VALUES (:id, :zaman, :tur, :oneri_json, :kaynak_id, :durum)",
        yeni,
    )
    _gecmis_yaz(con, "ekle", "gelen", yeni["id"], None, yeni, kaynak_id)
    return yeni["id"]


# ---------------------------------------------------------------- okuma


def anahtardan_id(con: sqlite3.Connection, anahtar: str) -> str | None:
    satir = con.execute("SELECT id FROM dugum WHERE anahtar = ?", (anahtar,)).fetchone()
    return satir[0] if satir else None


def kok_id(con: sqlite3.Connection) -> str:
    """Kök düğümün kimliği. Yoksa oluşturur; commit etmez.

    Önce KOK_ANAHTAR ile, bulunamazsa kök türündeki düğümle bakar: anahtarı farklı
    olan eski bir veritabanında ikinci bir kök açılmaz.
    """
    mevcut = kok_bul(con)
    if mevcut is not None:
        return mevcut
    return dugum_ekle(con, KOK_BASLIK, tur="kok", anahtar=KOK_ANAHTAR)


def kok_bul(con: sqlite3.Connection) -> str | None:
    """Kök kimliği ya da None; okuma yolunda kullanılır, kök oluşturmaz."""
    mevcut = anahtardan_id(con, KOK_ANAHTAR)
    if mevcut is not None:
        return mevcut
    satir = con.execute(
        "SELECT d.id FROM dugum d WHERE d.tur = 'kok' AND NOT EXISTS"
        " (SELECT 1 FROM kenar k WHERE k.cocuk = d.id AND k.tur = 'alt')"
        " ORDER BY d.olusturma, d.id LIMIT 1"
    ).fetchone()
    return satir[0] if satir else None


def _fts_sorgusu(sorgu: str) -> str:
    kelimeler: list[str] = []
    for k in normalize(sorgu).split():
        if k not in kelimeler:
            kelimeler.append(k)
        if len(kelimeler) >= _SORGU_TOKEN_SINIR:
            break
    # normalize çıktısı yalnız harf/rakamdır; tırnak içinde FTS5 sözdizimine karışmaz.
    return " OR ".join(f'"{k}"*' if len(k) >= _ONEK_MIN else f'"{k}"' for k in kelimeler)


def fts_ara(
    con: sqlite3.Connection,
    sorgu: str,
    k: int = 20,
    alt_agac: str | None = None,
) -> list[tuple[str, float]]:
    """BM25 araması; (düğüm id, skor) listesi, skor büyük = daha iyi.

    Sorgu kelimeleri OR ile bağlanır; 3+ harfli kelimeler önek araması yapar ("sınav" →
    "sinavlar" eşleşir). alt_agac verilirse yalnız o düğüm ve torunları döner.
    Boş ya da normalleştirmeden sonra boş kalan sorguda [].
    """
    if not sorgu or k <= 0:
        return []
    ifade = _fts_sorgusu(sorgu)
    if not ifade:
        return []
    agirlik = ", ".join(str(a) for a in _BM25_AGIRLIK)
    sql = (
        f"SELECT id, bm25(dugum_fts, {agirlik}) AS s FROM dugum_fts"
        " WHERE dugum_fts MATCH ? ORDER BY s"
    )
    if alt_agac is None:
        return [(r[0], -float(r[1])) for r in con.execute(sql + " LIMIT ?", (ifade, k))]
    # Özyinelemeli CTE'yi doğrudan FTS sorgusuna bağlamak 2000 düğümde 40-800 ms sürdü;
    # alt ağacı önce çıkarıp json_each ile tek seferlik küme olarak vermek birkaç ms.
    kume = torunlar(con, alt_agac)
    kume.add(alt_agac)
    if len(kume) >= con.execute("SELECT count(*) FROM dugum").fetchone()[0]:
        return fts_ara(con, sorgu, k)  # alt ağaç tüm düğümleri kapsıyor (ör. kök)
    sql = (
        f"SELECT id, bm25(dugum_fts, {agirlik}) AS s FROM dugum_fts"
        " WHERE dugum_fts MATCH ? AND id IN (SELECT value FROM json_each(?)) ORDER BY s LIMIT ?"
    )
    return [(r[0], -float(r[1])) for r in con.execute(sql, (ifade, json.dumps(list(kume)), k))]
