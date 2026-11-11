"""yedek.py sözleşme testleri (beyin veritabanının yedeklenmesi ve geri yüklenmesi).

Testler üretim kodunun iç yapısına değil, modülün yazılı sözleşmesine bağlıdır. Hepsi
`tmp_path` altında sentetik veritabanı kullanır. Windows'ta açık SQLite bağlantısı dosya
taşımayı engellediğinden `geri_yukle` öncesinde testin kendi bağlantıları kapatılır
(gerçek kullanımdaki "servis kapalı" önkoşulu).
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import sqlite3
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from bellek.beyin import db, yedek
from bellek.beyin.yedek import YedekHatasi

AD_KALIBI = re.compile(r"^beyin-(\d{8})-(\d{6})")
KAPALI = lambda: False  # noqa: E731  (servis kapalı)


# ---------------------------------------------------------------- yardımcılar


def ozet(yol: Path) -> str:
    return hashlib.sha256(Path(yol).read_bytes()).hexdigest()


def kur(yol: Path, olgu: str = "eski olgu") -> sqlite3.Connection:
    """Şemalı beyin veritabanı kurar; içinde 'Okul' düğümü ve bir olgu olur. Açık bağlantı döner."""
    con = db.baglan(yol)
    kok = db.kok_id(con)
    with con:
        okul = db.dugum_ekle(con, "Okul", ozet="okul işleri", ebeveyn=kok)
        db.olgu_ekle(con, okul, olgu)
    return con


def ekle(con: sqlite3.Connection, baslik: str) -> None:
    with con:
        db.dugum_ekle(con, baslik, ozet="test", ebeveyn=db.kok_id(con))


def icerik(con: sqlite3.Connection) -> dict:
    """Mantıksal içerik: düğüm başlıkları, olgu metinleri, geçmiş sayısı."""
    return {
        "dugum": sorted(r[0] for r in con.execute("SELECT baslik FROM dugum")),
        "olgu": sorted(r[0] for r in con.execute("SELECT metin FROM olgu")),
        "gecmis": con.execute("SELECT COUNT(*) FROM gecmis").fetchone()[0],
    }


def oku(yol: Path, tmp_path: Path) -> dict:
    """Bir dosyanın YALNIZ ana dosyasını ayrı bir klasöre kopyalayıp okur.

    Yan dosya (-wal) taşınmadığı için kopyanın kendi kendine yeterli olduğunu da sınar,
    asıl dosyaya ve yanına hiçbir şey yazılmaz.
    """
    klasor = tmp_path / "okuma" / uuid.uuid4().hex
    klasor.mkdir(parents=True)
    kopya = klasor / "k.db"
    shutil.copyfile(yol, kopya)
    con = sqlite3.connect(str(kopya))
    try:
        return icerik(con)
    finally:
        con.close()


def dosyalar(klasor: Path) -> dict[str, str]:
    return {p.name: ozet(p) for p in sorted(Path(klasor).iterdir()) if p.is_file()}


def yan(yol: Path, ek: str) -> Path:
    return Path(str(yol) + ek)


@pytest.fixture
def ortam(tmp_path):
    kaynak_klasor = tmp_path / "kaynak"
    kaynak_klasor.mkdir()
    hedef = tmp_path / "yedekler"
    hedef.mkdir()
    return {"db": kaynak_klasor / "beyin.db", "hedef": hedef, "tmp": tmp_path}


@pytest.fixture
def kapali_db(ortam):
    """Kurulmuş ve bağlantısı kapatılmış kaynak veritabanı."""
    kur(ortam["db"]).close()
    return ortam


# ---------------------------------------------------------------- varsayilan_yedek_dizini


def test_varsayilan_yedek_dizini_yol_dondurur(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "yerel"))
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(tmp_path / "yerel" / "Bellek" / "beyin.db"))
    yol = yedek.varsayilan_yedek_dizini()
    assert isinstance(yol, Path)
    assert yol.is_absolute()
    assert "yedek" in yol.name.lower()


# ---------------------------------------------------------------- yedekle: ad ve simdi


def test_yedek_adi_kalibi_ve_simdi(kapali_db):
    an = datetime(2026, 1, 2, 3, 4, 5)
    yol = yedek.yedekle(kapali_db["db"], kapali_db["hedef"], simdi=an)
    assert yol == kapali_db["hedef"] / "beyin-20260102-030405.db"
    assert yol.is_file()


def test_simdi_verilmezse_yerel_saat_kullanilir(kapali_db):
    once = datetime.now().replace(microsecond=0)
    yol = yedek.yedekle(kapali_db["db"], kapali_db["hedef"])
    sonra = datetime.now()
    m = AD_KALIBI.match(yol.name)
    assert m, yol.name
    assert yol.suffix == ".db"
    an = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S")
    assert once <= an <= sonra


def test_yedek_icerigi_kaynakla_ayni(kapali_db):
    beklenen = oku(kapali_db["db"], kapali_db["tmp"])
    yol = yedek.yedekle(kapali_db["db"], kapali_db["hedef"])
    assert oku(yol, kapali_db["tmp"]) == beklenen
    assert "eski olgu" in beklenen["olgu"]


def test_ayni_saniyede_iki_yedek_ayri_dosya(kapali_db):
    an = datetime(2026, 3, 4, 5, 6, 7)
    ilk = yedek.yedekle(kapali_db["db"], kapali_db["hedef"], simdi=an)
    ilk_ozet = ozet(ilk)
    ikinci = yedek.yedekle(kapali_db["db"], kapali_db["hedef"], simdi=an)
    assert ikinci != ilk
    assert ilk.is_file() and ikinci.is_file()
    assert ozet(ilk) == ilk_ozet
    assert ikinci.name.startswith("beyin-20260304-050607")
    assert ikinci.suffix == ".db"


def test_ayni_saniyedeki_ikinci_yedek_de_listelenir(kapali_db):
    an = datetime(2026, 3, 4, 5, 6, 7)
    ilk = yedek.yedekle(kapali_db["db"], kapali_db["hedef"], simdi=an)
    ikinci = yedek.yedekle(kapali_db["db"], kapali_db["hedef"], simdi=an)
    assert set(yedek.yedekleri_listele(kapali_db["hedef"])) == {ilk, ikinci}


# ---------------------------------------------------------------- yedekle: WAL tutarlılığı


def test_wal_commit_edilmis_veri_yedekte_commitlenmemis_yok(ortam):
    con = kur(ortam["db"])
    con.execute("PRAGMA wal_autocheckpoint = 0")
    ekle(con, "WAL verisi")
    # commit edildi ama ana dosyaya taşınmadı: WAL dolu olmalı
    assert yan(ortam["db"], "-wal").stat().st_size > 0
    assert b"WAL verisi" not in ortam["db"].read_bytes()

    yazan = db.baglan(ortam["db"])
    try:
        yazan.execute("BEGIN IMMEDIATE")
        db.dugum_ekle(yazan, "Commitlenmemis", ozet="x", ebeveyn=db.kok_id(yazan))
        assert yazan.in_transaction

        yol = yedek.yedekle(ortam["db"], ortam["hedef"])
        alinan = oku(yol, ortam["tmp"])
        assert "WAL verisi" in alinan["dugum"]
        assert "Okul" in alinan["dugum"]
        assert "Commitlenmemis" not in alinan["dugum"]
    finally:
        yazan.rollback()
        yazan.close()
        con.close()


# ---------------------------------------------------------------- yedekle: kaynak değişmez


def test_kaynak_degismez_baglanti_acikken(ortam):
    con = kur(ortam["db"])
    con.execute("PRAGMA wal_autocheckpoint = 0")
    ekle(con, "WAL verisi")
    ana_once = ozet(ortam["db"])
    wal_once = ozet(yan(ortam["db"], "-wal"))
    mantik_once = icerik(con)
    try:
        yedek.yedekle(ortam["db"], ortam["hedef"])
        # Ana dosya değişmedi: checkpoint tetiklenmedi, veri yazılmadı.
        assert ozet(ortam["db"]) == ana_once
        assert ozet(yan(ortam["db"], "-wal")) == wal_once
        assert icerik(con) == mantik_once
    finally:
        con.close()


def test_kaynak_degismez_baglanti_kapaliyken(kapali_db):
    klasor = kapali_db["db"].parent
    ana_once = ozet(kapali_db["db"])
    mantik_once = oku(kapali_db["db"], kapali_db["tmp"])
    yedek.yedekle(kapali_db["db"], kapali_db["hedef"])
    assert ozet(kapali_db["db"]) == ana_once
    assert oku(kapali_db["db"], kapali_db["tmp"]) == mantik_once


def test_kaynak_yaninda_yan_dosya_birakmaz(kapali_db):
    """Kapalı kaynağın klasörü yedekten sonra aynı kalır (artık -wal/-shm bırakılmaz)."""
    klasor = kapali_db["db"].parent
    once = dosyalar(klasor)
    yedek.yedekle(kapali_db["db"], kapali_db["hedef"])
    assert dosyalar(klasor) == once


# ---------------------------------------------------------------- yedekle: hatalar


def test_kaynak_yoksa_yedek_hatasi(ortam):
    with pytest.raises(YedekHatasi):
        yedek.yedekle(ortam["db"], ortam["hedef"])
    assert yedek.yedekleri_listele(ortam["hedef"]) == []
    assert not ortam["db"].exists()


@pytest.mark.parametrize("sakla", [0, -1])
def test_sakla_birden_kucukse_value_error(kapali_db, sakla):
    with pytest.raises(ValueError):
        yedek.yedekle(kapali_db["db"], kapali_db["hedef"], sakla=sakla)
    assert yedek.yedekleri_listele(kapali_db["hedef"]) == []


def test_dogrulamadan_gecmeyen_kopya_silinir(kapali_db, monkeypatch):
    onceki = yedek.yedekle(kapali_db["db"], kapali_db["hedef"], simdi=datetime(2026, 1, 1))
    once = dosyalar(kapali_db["hedef"])

    def reddet(yol):
        raise YedekHatasi("test: doğrulama başarısız")

    monkeypatch.setattr(yedek, "dogrula", reddet)
    with pytest.raises(YedekHatasi):
        yedek.yedekle(kapali_db["db"], kapali_db["hedef"], sakla=1,
                      simdi=datetime(2026, 2, 1))
    # Yeni kopya silindi; budama da çalışmadı (eski yedek duruyor).
    assert dosyalar(kapali_db["hedef"]) == once
    assert onceki.is_file()


# ---------------------------------------------------------------- yedekle: sakla budaması


def test_sakla_en_yeni_n_kalir_kalip_disi_dosyalar_durur(kapali_db):
    hedef = kapali_db["hedef"]
    (hedef / "notlarim.txt").write_text("kişisel not", encoding="utf-8")
    (hedef / "beyin-eski.db").write_bytes(b"kalip disi")
    n = 3
    bas = datetime(2026, 5, 1, 12, 0, 0)
    yollar = [
        yedek.yedekle(kapali_db["db"], hedef, sakla=n, simdi=bas + timedelta(days=i))
        for i in range(n + 3)
    ]
    kalan = yedek.yedekleri_listele(hedef)
    assert kalan == list(reversed(yollar[-n:]))
    for eski in yollar[:-n]:
        assert not eski.exists()
    assert (hedef / "notlarim.txt").read_text(encoding="utf-8") == "kişisel not"
    assert (hedef / "beyin-eski.db").read_bytes() == b"kalip disi"


def test_sakla_varsayilani_14(kapali_db):
    hedef = kapali_db["hedef"]
    bas = datetime(2026, 1, 1)
    for i in range(16):
        yedek.yedekle(kapali_db["db"], hedef, simdi=bas + timedelta(hours=i))
    assert len(yedek.yedekleri_listele(hedef)) == 14


# ---------------------------------------------------------------- yedekleri_listele


def test_listele_en_yeni_basta_kalip_disini_almaz(kapali_db):
    hedef = kapali_db["hedef"]
    (hedef / "notlarim.txt").write_text("x", encoding="utf-8")
    (hedef / "beyin-eski.db").write_bytes(b"x")
    eski = yedek.yedekle(kapali_db["db"], hedef, simdi=datetime(2025, 12, 31, 23, 59, 59))
    yeni = yedek.yedekle(kapali_db["db"], hedef, simdi=datetime(2026, 1, 1, 0, 0, 0))
    assert yedek.yedekleri_listele(hedef) == [yeni, eski]


def test_listele_dizin_yoksa_bos(tmp_path):
    assert yedek.yedekleri_listele(tmp_path / "yok") == []


# ---------------------------------------------------------------- dogrula


@pytest.fixture
def gecerli_yedek(kapali_db):
    return yedek.yedekle(kapali_db["db"], kapali_db["hedef"], simdi=datetime(2026, 6, 1))


def test_dogrula_gecerli_yedek_sessiz_ve_dosyayi_degistirmez(gecerli_yedek):
    once = ozet(gecerli_yedek)
    klasor_once = dosyalar(gecerli_yedek.parent)
    assert yedek.dogrula(gecerli_yedek) is None
    assert ozet(gecerli_yedek) == once
    assert dosyalar(gecerli_yedek.parent) == klasor_once


def test_dogrula_rastgele_bayt(tmp_path):
    yol = tmp_path / "rastgele.db"
    yol.write_bytes(os.urandom(8192))
    once = ozet(yol)
    with pytest.raises(YedekHatasi):
        yedek.dogrula(yol)
    assert ozet(yol) == once


def test_dogrula_bos_dosya(tmp_path):
    yol = tmp_path / "bos.db"
    yol.write_bytes(b"")
    with pytest.raises(YedekHatasi):
        yedek.dogrula(yol)
    assert yol.read_bytes() == b""


def test_dogrula_olmayan_dosya(tmp_path):
    with pytest.raises(YedekHatasi):
        yedek.dogrula(tmp_path / "yok.db")
    assert not (tmp_path / "yok.db").exists()


def test_dogrula_baska_semali_sqlite(tmp_path):
    yol = tmp_path / "baska.db"
    con = sqlite3.connect(str(yol))
    con.execute("CREATE TABLE foo (a INTEGER)")
    con.execute("INSERT INTO foo VALUES (1)")
    con.commit()
    con.close()
    once = ozet(yol)
    with pytest.raises(YedekHatasi):
        yedek.dogrula(yol)
    assert ozet(yol) == once


def test_dogrula_baska_sema_ama_beyin_surumu(tmp_path):
    yol = tmp_path / "sahte.db"
    con = sqlite3.connect(str(yol))
    con.execute("CREATE TABLE foo (a INTEGER)")
    con.execute(f"PRAGMA user_version = {db.SEMA_SURUMU}")
    con.commit()
    con.close()
    with pytest.raises(YedekHatasi):
        yedek.dogrula(yol)


def test_dogrula_yeni_sema_surumu(gecerli_yedek, tmp_path):
    yol = tmp_path / "gelecek.db"
    shutil.copyfile(gecerli_yedek, yol)
    con = sqlite3.connect(str(yol))
    con.execute(f"PRAGMA user_version = {db.SEMA_SURUMU + 1}")
    con.commit()
    con.close()
    once = ozet(yol)
    with pytest.raises(YedekHatasi):
        yedek.dogrula(yol)
    assert ozet(yol) == once


def test_dogrula_butunluk_bozuk(gecerli_yedek, tmp_path):
    yol = tmp_path / "bozuk.db"
    shutil.copyfile(gecerli_yedek, yol)
    veri = bytearray(yol.read_bytes())
    sayfa = int.from_bytes(veri[16:18], "big") or 65536
    assert len(veri) >= 3 * sayfa
    # 2. sayfadan itibaren her sayfanın başlığını çöple doldur (1. sayfa = başlık sağlam kalır).
    for bas in range(sayfa, len(veri), sayfa):
        veri[bas:bas + 64] = b"\xa5" * 64
    yol.write_bytes(bytes(veri))
    with pytest.raises(YedekHatasi):
        yedek.dogrula(yol)


# ---------------------------------------------------------------- geri_yukle


def test_geri_yukle_gidis_donus(kapali_db):
    kaynak = kapali_db["db"]
    yol = yedek.yedekle(kaynak, kapali_db["hedef"])
    yedek_ozet = ozet(yol)
    con = db.baglan(kaynak)
    ekle(con, "Yeni veri")
    con.close()

    kenar = yedek.geri_yukle(yol, kaynak, servis_calisiyor=KAPALI)

    con = db.baglan(kaynak)
    try:
        geri = icerik(con)
    finally:
        con.close()
    assert "Yeni veri" not in geri["dugum"]
    assert "Okul" in geri["dugum"]
    assert "eski olgu" in geri["olgu"]
    assert ozet(yol) == yedek_ozet  # yedek dosyası değişmedi

    # Kenara alınan dosya var, zaman damgalı ve eski (yeni veriyi içeren) içeriği taşıyor.
    assert kenar is not None
    kenar = Path(kenar)
    assert kenar.is_file()
    assert kenar != kaynak
    assert re.search(r"\d{6}", kenar.name)
    assert "Yeni veri" in oku(kenar, kapali_db["tmp"])["dugum"]


def test_geri_yukle_eski_yan_dosyalar_uygulanmaz_ve_kalmaz(ortam):
    kaynak = ortam["db"]
    kur(kaynak).close()
    yol = yedek.yedekle(kaynak, ortam["hedef"])

    # Çökmüş servis durumu üret: ana dosya + checkpoint edilmemiş veri taşıyan -wal/-shm.
    con = db.baglan(kaynak)
    con.execute("PRAGMA wal_autocheckpoint = 0")
    ekle(con, "Yalniz WAL'da")
    anlik = ortam["tmp"] / "anlik"
    anlik.mkdir()
    for ek in ("", "-wal", "-shm"):
        shutil.copyfile(yan(kaynak, ek), anlik / ("beyin.db" + ek))
    con.close()
    for ek in ("", "-wal", "-shm"):
        shutil.copyfile(anlik / ("beyin.db" + ek), yan(kaynak, ek))
    assert yan(kaynak, "-wal").stat().st_size > 0

    kenar = yedek.geri_yukle(yol, kaynak, servis_calisiyor=KAPALI)

    assert not yan(kaynak, "-wal").exists()
    assert not yan(kaynak, "-shm").exists()
    geri = oku(kaynak, ortam["tmp"])
    assert "Yalniz WAL'da" not in geri["dugum"]
    assert "Okul" in geri["dugum"]

    # Eski veritabanı yan dosyalarıyla birlikte kenara alındı: WAL'daki veri kurtarılabilir.
    assert kenar is not None
    kenar = Path(kenar)
    kenar_klasor = ortam["tmp"] / "kenar_okuma"
    kenar_klasor.mkdir()
    for ek in ("", "-wal", "-shm"):
        assert yan(kenar, ek).is_file(), f"kenara alınmamış: {ek or 'ana dosya'}"
        shutil.copyfile(yan(kenar, ek), kenar_klasor / ("k.db" + ek))
    con = sqlite3.connect(str(kenar_klasor / "k.db"))
    try:
        assert "Yalniz WAL'da" in icerik(con)["dugum"]
    finally:
        con.close()


def test_geri_yukle_servis_calisiyorsa_reddeder(kapali_db):
    kaynak = kapali_db["db"]
    yol = yedek.yedekle(kaynak, kapali_db["hedef"])
    con = db.baglan(kaynak)
    ekle(con, "Yeni veri")
    con.close()
    once = dosyalar(kaynak.parent)
    yedek_ozet = ozet(yol)

    with pytest.raises(YedekHatasi):
        yedek.geri_yukle(yol, kaynak, servis_calisiyor=lambda: True)

    assert dosyalar(kaynak.parent) == once  # kenara alma da yapılmadı
    assert ozet(yol) == yedek_ozet


def test_geri_yukle_bozuk_yedek_reddedilir(kapali_db, tmp_path):
    kaynak = kapali_db["db"]
    bozuk = kapali_db["hedef"] / "beyin-20260101-000000.db"
    bozuk.write_bytes(os.urandom(4096))
    bozuk_ozet = ozet(bozuk)
    once = dosyalar(kaynak.parent)

    with pytest.raises(YedekHatasi):
        yedek.geri_yukle(bozuk, kaynak, servis_calisiyor=KAPALI)

    assert dosyalar(kaynak.parent) == once
    assert ozet(bozuk) == bozuk_ozet


def test_geri_yukle_yeni_semali_yedek_reddedilir(kapali_db, tmp_path):
    kaynak = kapali_db["db"]
    yol = tmp_path / "gelecek.db"
    shutil.copyfile(yedek.yedekle(kaynak, kapali_db["hedef"]), yol)
    con = sqlite3.connect(str(yol))
    con.execute(f"PRAGMA user_version = {db.SEMA_SURUMU + 1}")
    con.commit()
    con.close()
    once = dosyalar(kaynak.parent)
    with pytest.raises(YedekHatasi):
        yedek.geri_yukle(yol, kaynak, servis_calisiyor=KAPALI)
    assert dosyalar(kaynak.parent) == once


def test_geri_yukle_mevcut_db_yoksa_none_ve_olusur(kapali_db, tmp_path):
    yol = yedek.yedekle(kapali_db["db"], kapali_db["hedef"])
    yedek_ozet = ozet(yol)
    beklenen = oku(yol, tmp_path)
    hedef_db = tmp_path / "yeni_yer" / "beyin.db"
    hedef_db.parent.mkdir()

    sonuc = yedek.geri_yukle(yol, hedef_db, servis_calisiyor=KAPALI)

    assert sonuc is None
    assert hedef_db.is_file()
    assert oku(hedef_db, tmp_path) == beklenen
    assert ozet(yol) == yedek_ozet
    con = db.baglan(hedef_db)  # geri yüklenen veritabanı normal yoldan açılabilir
    try:
        assert icerik(con) == beklenen
    finally:
        con.close()


def test_geri_yukle_yarida_hata_mevcut_db_yerinde_kalir(kapali_db, monkeypatch):
    """Yerleştirme sırasında dosya kopyalama başarısız olursa eski veritabanı yerinde kalır.

    Hata, shutil kopyalama işlevleri bozularak üretilir. Uygulama bunları kullanmıyorsa
    hata enjekte edilemez ve test atlanır.
    """
    kaynak = kapali_db["db"]
    yol = yedek.yedekle(kaynak, kapali_db["hedef"])
    con = db.baglan(kaynak)
    ekle(con, "Yeni veri")
    con.close()
    kaynak_ozet = ozet(kaynak)
    cagrildi = []

    def boz(*a, **k):
        cagrildi.append(a)
        raise OSError("test: disk dolu")

    for ad in ("copyfile", "copy2", "copy", "copyfileobj"):
        monkeypatch.setattr(shutil, ad, boz)

    try:
        yedek.geri_yukle(yol, kaynak, servis_calisiyor=KAPALI)
    except Exception:
        pass
    else:
        if not cagrildi:
            pytest.skip("geri_yukle shutil kopyalaması kullanmıyor; hata enjekte edilemedi")
        pytest.fail("kopyalama başarısız olduğu halde geri_yukle hata vermedi")
    monkeypatch.undo()

    assert kaynak.is_file()
    assert ozet(kaynak) == kaynak_ozet
    assert "Yeni veri" in oku(kaynak, kapali_db["tmp"])["dugum"]
