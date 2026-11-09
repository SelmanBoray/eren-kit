"""devir.notlar testleri (sözleşmeden yazıldı)."""
import importlib
import random
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from bellek.devir.notlar import DEVIR_KOK, oto_not_yaz, notlari_listele, dizin_metni

SIMDI = datetime(2026, 11, 8, 12, 0, 0, tzinfo=timezone.utc)


def _iso(gun_once=0.0):
    return (SIMDI - timedelta(days=gun_once)).isoformat()


def _not_yaz(yol: Path, tur, oturum, konu, gun_once=0.0, durum="devam", proje="C:\\X", govde="govde", private=None):
    yol.parent.mkdir(parents=True, exist_ok=True)
    ek = f"private: {private}\n" if private is not None else ""
    yol.write_text(
        f"---\ntur: {tur}\noturum: {oturum}\nkonu: {konu}\nproje: {proje}\n"
        f"tarih: {_iso(gun_once)}\ndurum: {durum}\n{ek}---\n{govde}\n",
        encoding="utf-8",
    )
    return yol


def _devir(kok, oturum, konu, gun_once=0.0, durum="devam"):
    return _not_yaz(kok / f"{oturum}.md", "devir", oturum, konu, gun_once, durum)


def _oto(kok, oturum, konu, gun_once=0.0):
    return _not_yaz(kok / "oto" / f"{oturum}.md", "otomatik", oturum, konu, gun_once, "bilinmiyor")


def _ozet(**kw):
    o = dict(
        oturum="abc123", cwd="C:\\Proje", baslik="Devir sistemi", ilk_istem="ilk",
        son_istem="son", duzenlenen=["a.py", "b.py"], son_baglam=1234,
        son_model="opus", son_zaman=_iso(0.5), istek_sayisi=7,
    )
    o.update(kw)
    return o


def _ayir(metin):
    satirlar = metin.split("\n")
    girisler = [s for s in satirlar if "[devir]" in s or "[oto]" in s]
    return satirlar, girisler


# ---------- DEVIR_KOK ----------

def test_devir_kok_ortam_degiskeni(monkeypatch, tmp_path):
    import bellek.devir.notlar as m
    monkeypatch.setenv("BELLEK_DEVIR_DIR", str(tmp_path / "ozel"))
    try:
        importlib.reload(m)
        assert Path(m.DEVIR_KOK) == tmp_path / "ozel"
    finally:
        monkeypatch.delenv("BELLEK_DEVIR_DIR", raising=False)
        importlib.reload(m)


def test_devir_kok_varsayilan_ayardaki_vault(monkeypatch, tmp_path):
    """BELLEK_DEVIR_DIR yoksa devir klasörü ayardaki vault'un altındaki devir/."""
    import bellek.devir.notlar as m
    ayar = tmp_path / "ayar.toml"
    ayar.write_text("[bellek]\nvault = 'kasa'\n", encoding="utf-8")
    monkeypatch.delenv("BELLEK_DEVIR_DIR", raising=False)
    monkeypatch.setenv("BELLEK_CONFIG", str(ayar))
    try:
        importlib.reload(m)
        assert Path(m.DEVIR_KOK) == tmp_path.resolve() / "kasa" / "devir"
    finally:
        monkeypatch.undo()
        importlib.reload(m)


def test_devir_kok_ortam_ayardan_once_gelir(tmp_path):
    from bellek.devir.notlar import devir_kok
    ayar = tmp_path / "ayar.toml"
    ayar.write_text("[bellek]\nvault = 'kasa'\n", encoding="utf-8")
    env = {"BELLEK_DEVIR_DIR": str(tmp_path / "ozel"), "BELLEK_CONFIG": str(ayar)}
    assert devir_kok(env) == tmp_path / "ozel"


@pytest.mark.parametrize("icerik", [None, "bozuk = [", "[bellek]\n"])
def test_devir_kok_ayar_yok_ya_da_bozuksa_paket_vault(monkeypatch, tmp_path, icerik):
    """Ayar okunamazsa istisna yok: paket kökündeki vault/devir."""
    import bellek.devir.notlar as m
    ayar = tmp_path / "ayar.toml"
    if icerik is not None:
        ayar.write_text(icerik, encoding="utf-8")
    monkeypatch.setenv("BELLEK_CONFIG", str(ayar))
    paket = Path(m.__file__).resolve().parents[3]
    assert (paket / "pyproject.toml").is_file()
    assert m.devir_kok({}) == paket / "vault" / "devir"


# ---------- oto_not_yaz ----------

def test_oto_yazar_ve_listelenir(tmp_path):
    yol = oto_not_yaz(tmp_path, _ozet())
    assert Path(yol) == tmp_path / "oto" / "abc123.md"
    assert Path(yol).is_file()
    [n] = notlari_listele(tmp_path)
    assert n["tur"] == "otomatik"
    assert n["oturum"] == "abc123"
    assert n["konu"] == "Devir sistemi"
    assert n["proje"] == "C:\\Proje"
    assert n["durum"] == "bilinmiyor"
    assert isinstance(n["tarih"], datetime) and n["tarih"].tzinfo is not None
    assert n["tarih"] == datetime.fromisoformat(_iso(0.5))


def test_oto_on_bilgi_bicimi(tmp_path):
    yol = oto_not_yaz(tmp_path, _ozet())
    satirlar = Path(yol).read_text(encoding="utf-8").split("\n")
    assert satirlar[0] == "---"
    kapanis = satirlar.index("---", 1)
    for s in satirlar[1:kapanis]:
        assert re.match(r"^\w+: ", s), s
    assert "tur: otomatik" in satirlar[1:kapanis]


def test_oto_klasoru_olusturur(tmp_path):
    kok = tmp_path / "yok" / "daha" / "yok"
    yol = oto_not_yaz(kok, _ozet())
    assert yol is not None and Path(yol).is_file()


def test_oto_ustune_yazar(tmp_path):
    oto_not_yaz(tmp_path, _ozet(baslik="Eski"))
    oto_not_yaz(tmp_path, _ozet(baslik="Yeni"))
    dosyalar = list((tmp_path / "oto").iterdir())
    assert [d.name for d in dosyalar] == ["abc123.md"]  # artık/geçici dosya kalmaz
    [n] = notlari_listele(tmp_path)
    assert n["konu"] == "Yeni"


def test_oto_oturum_yoksa_yazmaz(tmp_path):
    assert oto_not_yaz(tmp_path, _ozet(oturum=None)) is None
    assert oto_not_yaz(tmp_path, _ozet(oturum="")) is None
    assert not (tmp_path / "oto").exists() or not list((tmp_path / "oto").iterdir())
    assert notlari_listele(tmp_path) == []


def test_oto_baslik_yoksa_adsiz(tmp_path):
    oto_not_yaz(tmp_path, _ozet(baslik=None))
    [n] = notlari_listele(tmp_path)
    assert n["konu"] == "adsız oturum"


def test_oto_son_zaman_yoksa_simdi(tmp_path):
    once = datetime.now(timezone.utc)
    oto_not_yaz(tmp_path, _ozet(son_zaman=None))
    sonra = datetime.now(timezone.utc)
    [n] = notlari_listele(tmp_path)
    assert n["tarih"] is not None
    assert once - timedelta(seconds=5) <= n["tarih"] <= sonra + timedelta(seconds=5)


def test_oto_tum_alanlar_none(tmp_path):
    ozet = dict.fromkeys(
        ["cwd", "baslik", "ilk_istem", "son_istem", "duzenlenen", "son_baglam",
         "son_model", "son_zaman", "istek_sayisi"])
    ozet["oturum"] = "s1"
    yol = oto_not_yaz(tmp_path, ozet)
    assert yol is not None
    [n] = notlari_listele(tmp_path)
    assert n["oturum"] == "s1" and n["durum"] == "bilinmiyor"


def test_oto_yeni_satirli_konu_on_bilgiyi_bozmaz(tmp_path):
    kotu = "birinci\nikinci: x\n---\ntur: devir\ndurum: bitti"
    yol = oto_not_yaz(tmp_path, _ozet(baslik=kotu, cwd="C:\\a\nb", son_istem="x\n---\ny"))
    satirlar = Path(yol).read_text(encoding="utf-8").split("\n")
    assert satirlar[0] == "---"
    kapanis = satirlar.index("---", 1)
    on = satirlar[1:kapanis]
    assert len(on) == len([s for s in on if re.match(r"^\w+: ", s)])
    assert "tur: devir" not in on and "durum: bitti" not in on
    [n] = notlari_listele(tmp_path)
    assert n["tur"] == "otomatik" and n["durum"] == "bilinmiyor"
    assert "\n" not in n["konu"] and "birinci" in n["konu"]
    assert "\n" not in n["proje"]


def test_oto_iki_nokta_iceren_degerler(tmp_path):
    oto_not_yaz(tmp_path, _ozet(baslik="Hata: foo: bar", cwd="C:\\Proje\\src"))
    [n] = notlari_listele(tmp_path)
    assert n["konu"] == "Hata: foo: bar"
    assert n["proje"] == "C:\\Proje\\src"


def test_oto_boyut_siniri(tmp_path):
    dev = "x" * 20000
    yol = oto_not_yaz(tmp_path, _ozet(
        baslik=dev, cwd=dev, ilk_istem=dev, son_istem=dev,
        duzenlenen=[f"dosya_{i}_{dev[:50]}.py" for i in range(500)]))
    assert len(Path(yol).read_text(encoding="utf-8")) <= 1600  # ~1500, küçük pay
    [n] = notlari_listele(tmp_path)  # hâlâ ayrıştırılabilir
    assert n["oturum"] == "abc123"


# ---------- notlari_listele ----------

def test_listele_zengin_ve_otomatik(tmp_path):
    _devir(tmp_path, "d1", "Zengin konu: ayrıntı", gun_once=2, durum="bitti")
    _oto(tmp_path, "o1", "Oto konu")
    sonuc = {n["oturum"]: n for n in notlari_listele(tmp_path)}
    assert set(sonuc) == {"d1", "o1"}
    assert sonuc["d1"]["tur"] == "devir"
    assert sonuc["d1"]["konu"] == "Zengin konu: ayrıntı"
    assert sonuc["d1"]["durum"] == "bitti"
    assert Path(sonuc["d1"]["yol"]) == tmp_path / "d1.md"
    assert sonuc["o1"]["tur"] == "otomatik"
    assert set(sonuc["d1"]) >= {"yol", "tur", "oturum", "konu", "proje", "tarih", "durum"}


def test_listele_bozuk_on_bilgi_atlanir(tmp_path):
    _devir(tmp_path, "iyi", "iyi not")
    (tmp_path / "onbilgisiz.md").write_text("sadece metin\n", encoding="utf-8")
    (tmp_path / "kapanmayan.md").write_text("---\ntur: devir\noturum: k\nkonu: x\n", encoding="utf-8")
    (tmp_path / "bos.md").write_text("", encoding="utf-8")
    (tmp_path / "oto").mkdir()
    (tmp_path / "oto" / "bozuk.md").write_text("tur: otomatik\noturum: z\n---\ngovde\n", encoding="utf-8")
    sonuc = notlari_listele(tmp_path)
    assert [n["oturum"] for n in sonuc] == ["iyi"]


def test_listele_md_disi_dosyalar_yok_sayilir(tmp_path):
    _devir(tmp_path, "a", "a")
    (tmp_path / "not.txt").write_text("---\ntur: devir\noturum: z\nkonu: z\n---\n", encoding="utf-8")
    assert [n["oturum"] for n in notlari_listele(tmp_path)] == ["a"]


def test_listele_bos_klasor(tmp_path):
    assert notlari_listele(tmp_path) == []


def test_listele_olmayan_klasor(tmp_path):
    assert notlari_listele(tmp_path / "yok") == []


# ---------- dizin_metni ----------

def test_dizin_bos_ve_olmayan(tmp_path):
    assert dizin_metni(tmp_path, SIMDI) == ""
    assert dizin_metni(tmp_path / "yok", SIMDI) == ""
    assert dizin_metni(tmp_path / "yok", SIMDI, oturum="x") == ""


def test_dizin_yalniz_mevcut_oturum_ise_bos(tmp_path):
    _devir(tmp_path, "ben", "benim")
    _oto(tmp_path, "ben2", "benim oto")
    assert dizin_metni(tmp_path, SIMDI, oturum="ben") != ""  # ben2 görünür
    (tmp_path / "oto" / "ben2.md").unlink()
    assert dizin_metni(tmp_path, SIMDI, oturum="ben") == ""


def test_dizin_mevcut_oturum_haric(tmp_path):
    _devir(tmp_path, "ben", "BENIM_ZENGIN")
    _oto(tmp_path, "ben", "BENIM_OTO")
    _devir(tmp_path, "baska", "BASKA_KONU")
    m = dizin_metni(tmp_path, SIMDI, oturum="ben")
    assert "BASKA_KONU" in m
    assert "BENIM_ZENGIN" not in m and "BENIM_OTO" not in m
    assert "BENIM_ZENGIN" in dizin_metni(tmp_path, SIMDI)


def test_dizin_oturum_none_hicbirini_haric_tutmaz(tmp_path):
    _devir(tmp_path, "a", "KONU_A")
    _oto(tmp_path, "b", "KONU_B")
    m = dizin_metni(tmp_path, SIMDI, oturum=None)
    assert "KONU_A" in m and "KONU_B" in m


def test_dizin_etiketler_ve_baslik(tmp_path):
    _devir(tmp_path, "a", "KONU_A", gun_once=1)
    _oto(tmp_path, "b", "KONU_B", gun_once=2)
    m = dizin_metni(tmp_path, SIMDI)
    satirlar, girisler = _ayir(m)
    assert len(girisler) == 2
    [sa] = [s for s in girisler if "KONU_A" in s]
    [sb] = [s for s in girisler if "KONU_B" in s]
    assert "[devir]" in sa and "[oto]" not in sa
    assert "[oto]" in sb and "[devir]" not in sb
    basliklar = [s for s in satirlar if s.strip() and s not in girisler]
    assert len(basliklar) == 1  # tek başlık satırı
    assert satirlar[0] == basliklar[0]  # başta


def test_dizin_zengin_varsa_ayni_oturumun_otomatigi_gizlenir(tmp_path):
    _devir(tmp_path, "s1", "ZENGIN_S1", gun_once=1)
    _oto(tmp_path, "s1", "OTO_S1", gun_once=0.5)
    _oto(tmp_path, "s2", "OTO_S2", gun_once=1)
    m = dizin_metni(tmp_path, SIMDI)
    assert "ZENGIN_S1" in m
    assert "OTO_S1" not in m
    assert "OTO_S2" in m


def test_dizin_zengin_filtreyle_dusse_de_otomatik_gizli(tmp_path):
    # Sözleşme "zengin not varsa" der (varlık); görünürlük değil. Belirsiz nokta, bkz. rapor.
    _devir(tmp_path, "s1", "ZENGIN_S1", gun_once=40, durum="bitti")
    _oto(tmp_path, "s1", "OTO_S1", gun_once=1)
    m = dizin_metni(tmp_path, SIMDI)
    assert "OTO_S1" not in m and "ZENGIN_S1" not in m


@pytest.mark.parametrize("gun,gorunur", [(13, True), (13.9, True), (15, False), (60, False)])
def test_dizin_otomatik_14_gun(tmp_path, gun, gorunur):
    _oto(tmp_path, "o", "OTO_KONU", gun_once=gun)
    assert ("OTO_KONU" in dizin_metni(tmp_path, SIMDI)) is gorunur


@pytest.mark.parametrize("gun,gorunur", [(29, True), (29.9, True), (31, False), (200, False)])
def test_dizin_bitti_30_gun(tmp_path, gun, gorunur):
    _devir(tmp_path, "d", "BITTI_KONU", gun_once=gun, durum="bitti")
    assert ("BITTI_KONU" in dizin_metni(tmp_path, SIMDI)) is gorunur


@pytest.mark.parametrize("durum", ["devam", "beklemede", "bilinmiyor"])
def test_dizin_bitti_disindaki_zengin_notlar_eski_olsa_da_kalir(tmp_path, durum):
    _devir(tmp_path, "d", "ESKI_ZENGIN", gun_once=100, durum=durum)
    assert "ESKI_ZENGIN" in dizin_metni(tmp_path, SIMDI)


def test_dizin_bitti_zengin_14_gunden_eski_ama_30dan_yeni_kalir(tmp_path):
    _devir(tmp_path, "d", "BITTI_20", gun_once=20, durum="bitti")
    assert "BITTI_20" in dizin_metni(tmp_path, SIMDI)


def test_dizin_once_zengin_sonra_otomatik_her_grup_yeniden_eskiye(tmp_path):
    _devir(tmp_path, "a", "NOT_Z_ORTA", gun_once=5)
    _oto(tmp_path, "b", "NOT_O_YENI", gun_once=1)
    _devir(tmp_path, "c", "NOT_Z_ESKI", gun_once=9)
    _oto(tmp_path, "d", "NOT_O_EN_YENI", gun_once=0.1)
    _devir(tmp_path, "e", "NOT_Z_YENI", gun_once=2)
    _oto(tmp_path, "f", "NOT_O_ESKI", gun_once=6)
    m = dizin_metni(tmp_path, SIMDI)
    sira = [m.index(k) for k in ("NOT_Z_YENI", "NOT_Z_ORTA", "NOT_Z_ESKI",
                                 "NOT_O_EN_YENI", "NOT_O_YENI", "NOT_O_ESKI")]
    assert sira == sorted(sira)


def test_dizin_eski_devam_zengin_yeni_otomatiklerden_once(tmp_path):
    _devir(tmp_path, "z", "ESKI_DEVAM", gun_once=25, durum="devam")
    _oto(tmp_path, "o1", "YENI_OTO_1", gun_once=0.1)
    _oto(tmp_path, "o2", "YENI_OTO_2", gun_once=0.2)
    m = dizin_metni(tmp_path, SIMDI)
    _, girisler = _ayir(m)
    assert "ESKI_DEVAM" in girisler[0]
    assert m.index("ESKI_DEVAM") < m.index("YENI_OTO_1") < m.index("YENI_OTO_2")


def test_dizin_satirda_dosya_adi_tam_yol_yok_baslikta_klasor(tmp_path):
    _devir(tmp_path, "zeng", "KONU_Z")
    _oto(tmp_path, "otoo", "KONU_O")
    m = dizin_metni(tmp_path, SIMDI)
    satirlar, girisler = _ayir(m)
    assert str(tmp_path) in satirlar[0]
    [sz] = [s for s in girisler if "KONU_Z" in s]
    [so] = [s for s in girisler if "KONU_O" in s]
    assert "zeng.md" in sz and "oto/zeng.md" not in sz
    assert "oto/otoo.md" in so
    for s in girisler:
        assert str(tmp_path) not in s


def test_dizin_tarih_yerel_saatle(tmp_path):
    t = datetime(2026, 11, 7, 15, 56, tzinfo=timezone.utc)
    (tmp_path / "z.md").write_text(
        "---\ntur: devir\noturum: z\nkonu: KONU_T\nproje: x\n"
        "tarih: 2026-11-07T15:56:00Z\ndurum: devam\n---\ng\n", encoding="utf-8")
    [satir] = _ayir(dizin_metni(tmp_path, SIMDI))[1]
    assert t.astimezone().strftime("%Y-%m-%d %H:%M") in satir


@pytest.mark.parametrize("deger,gizli", [
    ("true", True), ("True", True), ("TRUE", True), ("evet", True), ("Evet", True),
    ("false", False), ("hayır", False)])
def test_private_listele_ve_dizin(tmp_path, deger, gizli):
    _devir(tmp_path, "p", "KONU_P")
    _not_yaz(tmp_path / "p.md", "devir", "p", "KONU_P", private=deger)
    _oto(tmp_path, "q", "KONU_Q")
    notlar = {n["oturum"]: n for n in notlari_listele(tmp_path)}
    assert notlar["p"]["private"] is gizli
    assert notlar["q"]["private"] is False
    m = dizin_metni(tmp_path, SIMDI)
    assert ("KONU_P" not in m) is gizli
    assert "KONU_Q" in m


def test_private_otomatik_not_da_gizli(tmp_path):
    _not_yaz(tmp_path / "oto" / "x.md", "otomatik", "x", "OTO_PRIV", 1, "bilinmiyor", private="true")
    assert dizin_metni(tmp_path, SIMDI) == ""


def test_dizin_iki_nokta_ve_yeni_satirli_konu(tmp_path):
    _devir(tmp_path, "a", "Hata: foo: bar", gun_once=1)
    oto_not_yaz(tmp_path, _ozet(oturum="o", baslik="satir1\nsatir2", son_zaman=_iso(2)))
    m = dizin_metni(tmp_path, SIMDI)
    assert "Hata: foo: bar" in m
    _, girisler = _ayir(m)
    assert len(girisler) == 2  # yeni satır girişi bölmez
    assert "satir1" in m


def test_dizin_bozuk_not_dizini_bozmaz(tmp_path):
    _devir(tmp_path, "iyi", "IYI_KONU")
    (tmp_path / "bozuk.md").write_text("---\nrastgele\n", encoding="utf-8")
    assert "IYI_KONU" in dizin_metni(tmp_path, SIMDI)


def test_dizin_sinir_kesme_ve_kalan_sayisi(tmp_path):
    n = 40
    for i in range(n):
        _devir(tmp_path, f"s{i:02d}", f"KONU_{i:02d} " + "uzun " * 10, gun_once=i * 0.1)
    tam = dizin_metni(tmp_path, SIMDI, sinir=100000)
    assert len(_ayir(tam)[1]) == n
    sinir = 700
    m = dizin_metni(tmp_path, SIMDI, sinir=sinir)
    assert len(m) <= sinir
    satirlar, girisler = _ayir(m)
    assert 0 < len(girisler) < n
    tam_satirlar = tam.split("\n")
    for g in girisler:
        assert g in tam_satirlar  # satır sınırında kesilir, yarım satır yok
    assert girisler == [s for s in tam_satirlar if s in girisler]  # en yeniler, sırayla
    assert "KONU_00" in m
    son = satirlar[-1]
    assert son not in girisler
    kalan = int(re.search(r"\d+", son).group())
    assert len(girisler) + kalan == n


def test_dizin_sigiyorsa_kalan_satiri_yok(tmp_path):
    for i in range(5):
        _devir(tmp_path, f"s{i}", f"K{i}", gun_once=i)
    m = dizin_metni(tmp_path, SIMDI, sinir=100000)
    satirlar, girisler = _ayir(m)
    assert len(girisler) == 5
    assert all(("[devir]" in s) for s in satirlar[1:] if s)


def test_dizin_sinir_degismezi_rastgele(tmp_path):
    rng = random.Random(20261108)
    for tur_no in range(40):
        kok = tmp_path / f"k{tur_no}"
        kok.mkdir()
        for i in range(rng.randint(0, 60)):
            konu = "".join(rng.choice("abcçğıöşü :-.") for _ in range(rng.randint(1, 300))).strip() or "k"
            gun = rng.uniform(0, 80)
            if rng.random() < 0.5:
                _devir(kok, f"d{i}", konu, gun, rng.choice(["devam", "bitti", "beklemede", "bilinmiyor"]))
            else:
                _oto(kok, f"o{i}", konu, gun)
        for _ in range(5):
            sinir = rng.randint(200, 1500)
            oturum = rng.choice([None, "d1", "o2", "yok"])
            m = dizin_metni(kok, SIMDI, oturum=oturum, sinir=sinir)
            assert len(m) <= sinir, (tur_no, sinir, len(m))


def test_dizin_varsayilan_sinir_1500(tmp_path):
    for i in range(80):
        _devir(tmp_path, f"s{i}", "konu " * 30, gun_once=i * 0.1)
    assert len(dizin_metni(tmp_path, SIMDI)) <= 1500


@pytest.mark.parametrize("ilgisiz", [
    "[[source]]\nname = 'a'\npath = '%BELLEK_TEST_TANIMSIZ_DEGISKEN%/x'\n",
    "[[source]]\nname = 'a'\npath = 'x'\n[[source]]\nname = 'a'\npath = 'y'\n",
    "[server]\nport = 'sayi-degil'\n",
    "[bilinmeyen]\nx = 1\n",
])
def test_devir_kok_ilgisiz_ayar_hatasi_vault_yolunu_degistirmez(monkeypatch, tmp_path, ilgisiz):
    """Vault dışındaki ayar hatası devir klasörünü paket varsayılanına kaydırmaz."""
    import bellek.devir.notlar as m
    monkeypatch.delenv("BELLEK_TEST_TANIMSIZ_DEGISKEN", raising=False)
    ayar = tmp_path / "ayar.toml"
    ayar.write_text(f"[bellek]\nvault = 'kasa'\n{ilgisiz}", encoding="utf-8")
    monkeypatch.setenv("BELLEK_CONFIG", str(ayar))
    from bellek.config import ConfigError, load_config
    with pytest.raises(ConfigError):
        load_config()  # ayar gerçekten bozuk
    assert m.devir_kok({}) == tmp_path.resolve() / "kasa" / "devir"
    assert m.DEVIR_KOK_UYARI is None


def test_devir_kok_vault_cozulemezse_uyari_gorunur(monkeypatch, tmp_path, capsys):
    import bellek.devir.notlar as m
    monkeypatch.delenv("BELLEK_TEST_TANIMSIZ_DEGISKEN", raising=False)
    ayar = tmp_path / "ayar.toml"
    ayar.write_text("[bellek]\nvault = '%BELLEK_TEST_TANIMSIZ_DEGISKEN%/kasa'\n", encoding="utf-8")
    monkeypatch.setenv("BELLEK_CONFIG", str(ayar))
    try:
        paket = Path(m.__file__).resolve().parents[3]
        assert m.devir_kok({}) == paket / "vault" / "devir"
        assert m.DEVIR_KOK_UYARI and "BELLEK_TEST_TANIMSIZ_DEGISKEN" in m.DEVIR_KOK_UYARI
        assert "BELLEK_TEST_TANIMSIZ_DEGISKEN" in capsys.readouterr().err
        assert m.devir_kok({"BELLEK_DEVIR_DIR": str(tmp_path / "o")}) == tmp_path / "o"
        assert m.DEVIR_KOK_UYARI is None  # her çağrıda sıfırlanır
    finally:
        m.DEVIR_KOK_UYARI = None


@pytest.fixture(autouse=True)
def _devir_uyarisini_sifirla():
    import bellek.devir.notlar as m
    yield
    m.DEVIR_KOK_UYARI = None
