"""ice_al regresyon testleri: tohumdaki sır ve tohum dışı düzeltmelerin korunması.

Sözleşme (sabit):
* ``ice_al(con, jsonl_yol, uzerine_yaz=False) -> dict``; mevcut anahtarlar korunur,
  yeni ``"korunan"`` (list[str]) anahtarı her zaman vardır.
* Normal yazma yolunun reddedeceği sırrı taşıyan tohum satırı atlanır, "hatalar"a
  sırsız bir kayıt düşer, satırın hiçbir metni tablolara ya da FTS'ye girmez.
* Tohumla içe alındıktan sonra tohum dışı bir kaynakla değiştirilen düğüm,
  ``uzerine_yaz=False`` iken yeniden içe alımda değişmez ve anahtarı "korunan"a
  eklenir; ``uzerine_yaz=True`` iken tohum kazanır.

Tohum dışı değişiklik gerçek yazma yolu ile üretilir: özet/ayrıntı ``yaz.duzelt``
ile; ``duzelt`` durum alanını değiştirmediği için "bitti" durumu, dış yazmaların
kullandığı biçimde (``elle`` kaynak kaydı + ``db.dugum_guncelle``) yazılır.
"""

import json

import pytest

from bellek.beyin import db, ice_al, yaz
from bellek.devir.transcript import maskele

# Depodaki yazma/düzeltme testlerinin kullandığı sahte sırlar (test_yaz.py, test_duzelt.py).
SIR_ANTHROPIC = "API anahtarım sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456"
SIR_ENV = "DB_PASSWORD=supersecret1"
# Sızıntı taraması için sırların ayırt edici parçaları (küçük harf).
SIR_IZLERI = ("abcdefghijklmnopqrstuvwxyz123456", "sk-ant-api03", "supersecret1")

# Sırlı satırın sır dışı metinleri: bunlar da hiçbir yere girmemeli.
GIZLI_BASLIK = "Kapalıkutubaşlığı"
GIZLI_OZET_KELIME = "kapalıkutuözetkelimesi"
GIZLI_OLGU_KELIME = "kapalıkutuolgukelimesi"


# ---------------------------------------------------------------- yardımcılar

def _t(anahtar, baslik, ebeveyn="kok", tur="dal", **kw):
    d = {
        "anahtar": anahtar, "baslik": baslik, "ozet": f"ozet {baslik}", "ayrinti": "",
        "tur": tur, "durum": "aktif", "gizlilik": "normal", "tarih": "2026-01-01",
        "birincil_ebeveyn": ebeveyn, "ek_ebeveynler": [], "ilgili": [],
        "olgular": [], "kaynaklar": [],
    }
    d.update(kw)
    return d


def _kok():
    return _t("kok", "Kullanıcı", ebeveyn=None, tur="kok")


def _yaz(yol, satirlar):
    if not any(x.get("tur") == "kok" for x in satirlar):
        satirlar = [_kok()] + list(satirlar)
    yol.write_text("\n".join(json.dumps(s, ensure_ascii=False) for s in satirlar) + "\n",
                   encoding="utf-8")
    return yol


def _al(con, yol, **kw):
    return ice_al.ice_al(con, yol, **kw)


@pytest.fixture
def con(tmp_path):
    c = db.baglan(tmp_path / "b.db")
    yield c
    c.close()


def _id(con, anahtar):
    return db.anahtardan_id(con, anahtar)


def _alanlar(con, anahtar):
    r = con.execute("SELECT baslik, ozet, ayrinti, tur, durum FROM dugum WHERE anahtar=?",
                    (anahtar,)).fetchone()
    return None if r is None else dict(zip(("baslik", "ozet", "ayrinti", "tur", "durum"), r))


def _say(con, tablo):
    return con.execute(f"SELECT COUNT(*) FROM {tablo}").fetchone()[0]


def _tum_tablolar_metni(con) -> str:
    """Tüm tabloların (FTS ve gölge tabloları dahil) satırları, küçük harfle tek metin."""
    adlar = [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    parcalar = []
    for ad in adlar:
        for satir in con.execute(f'SELECT * FROM "{ad}"'):
            parcalar.append(repr(tuple(satir)))
    return "\n".join(parcalar).casefold()


def _fts_metni(con) -> str:
    return "\n".join(repr(tuple(r)) for r in con.execute("SELECT * FROM dugum_fts")).casefold()


def _sir_izi_yok(metin: str):
    m = metin.casefold()
    for iz in SIR_IZLERI:
        assert iz not in m, iz


def _dis_duzelt(con, anahtar, ozet):
    """Gerçek düzeltme yolu (yaz.duzelt) ile özeti değiştirir."""
    r = yaz.duzelt(con, _id(con, anahtar), ozet=ozet)
    assert r["sonuc"] == "guncellendi", r
    return r


def _dis_durum(con, anahtar, durum):
    """Durumu dış (elle) kaynakla değiştirir; duzelt durum alanını yazmaz."""
    with con:
        kid = db.kaynak_ekle(con, "elle", "test: kullanıcı durumu değiştirdi")
        db.dugum_guncelle(con, _id(con, anahtar), kaynak_id=kid, durum=durum)


# ---------------------------------------------------------------- ön koşul

@pytest.mark.parametrize("sir", [SIR_ANTHROPIC, SIR_ENV])
def test_sahte_sirlar_normal_yazma_yolunda_reddedilir(con, sir):
    """Ön koşul: kullanılan sahte sırları normal yazma yolu gerçekten reddediyor."""
    assert maskele(sir) != sir
    r = yaz.yaz(con, sir, dugum_id=db.kok_id(con))
    assert r["sonuc"] == "reddedildi"


# ---------------------------------------------------------------- sır

def _sirli_satir(nerede, sir):
    ozet = f"{GIZLI_OZET_KELIME} {sir}" if nerede == "ozet" else f"{GIZLI_OZET_KELIME} temiz"
    olgular = [f"{GIZLI_OLGU_KELIME} {sir}" if nerede == "olgu" else f"{GIZLI_OLGU_KELIME} temiz"]
    return _t("sirli", GIZLI_BASLIK, ozet=ozet, olgular=olgular)


@pytest.mark.parametrize("sir", [SIR_ANTHROPIC, SIR_ENV])
@pytest.mark.parametrize("nerede", ["olgu", "ozet"])
def test_sirli_satir_ortada_atlanir_oncesi_sonrasi_alinir(con, tmp_path, nerede, sir):
    satirlar = [
        _kok(),
        _t("once", "Önce", olgular=["önce olgusu"]),
        _sirli_satir(nerede, sir),
        _t("sonra", "Sonra", olgular=["sonra olgusu"]),
    ]
    s = _al(con, _yaz(tmp_path / "t.jsonl", satirlar))

    # dosyanın geri kalanı içe alındı
    assert _id(con, "once") is not None
    assert _id(con, "sonra") is not None
    for a, o in (("once", "önce olgusu"), ("sonra", "sonra olgusu")):
        assert con.execute("SELECT COUNT(*) FROM olgu WHERE dugum=? AND metin=?",
                           (_id(con, a), o)).fetchone()[0] == 1
    # sırlı satır atlandı ve hata listesine kayıt düştü
    assert _id(con, "sirli") is None
    assert s["hatalar"], s
    assert not any(h.startswith("KRITIK") for h in s["hatalar"]), s["hatalar"]


@pytest.mark.parametrize("sir", [SIR_ANTHROPIC, SIR_ENV])
@pytest.mark.parametrize("nerede", ["olgu", "ozet"])
def test_sirli_satirin_hicbir_metni_tablolara_ve_ftse_girmez(con, tmp_path, nerede, sir):
    satirlar = [_kok(), _t("once", "Önce"), _sirli_satir(nerede, sir), _t("sonra", "Sonra")]
    _al(con, _yaz(tmp_path / "t.jsonl", satirlar))
    hepsi = _tum_tablolar_metni(con)
    _sir_izi_yok(hepsi)
    for kelime in (GIZLI_BASLIK, GIZLI_OZET_KELIME, GIZLI_OLGU_KELIME):
        assert kelime.casefold() not in hepsi, kelime
    fts = _fts_metni(con)
    _sir_izi_yok(fts)
    for kelime in (GIZLI_BASLIK, GIZLI_OZET_KELIME, GIZLI_OLGU_KELIME):
        assert kelime.casefold() not in fts, kelime
    # FTS aramasıyla da bulunmaz
    assert not db.fts_ara(con, "supersecret1")
    assert not db.fts_ara(con, GIZLI_OZET_KELIME)


@pytest.mark.parametrize("sir", [SIR_ANTHROPIC, SIR_ENV])
@pytest.mark.parametrize("nerede", ["olgu", "ozet"])
def test_sir_hata_kaydinda_yer_almaz(con, tmp_path, nerede, sir):
    satirlar = [_kok(), _t("once", "Önce"), _sirli_satir(nerede, sir), _t("sonra", "Sonra")]
    s = _al(con, _yaz(tmp_path / "t.jsonl", satirlar))
    assert s["hatalar"], s
    _sir_izi_yok(repr(s))


def test_sir_varken_mevcut_anahtarlar_ve_korunan_var(con, tmp_path):
    satirlar = [_kok(), _sirli_satir("olgu", SIR_ANTHROPIC), _t("iyi", "İyi")]
    s = _al(con, _yaz(tmp_path / "t.jsonl", satirlar))
    assert set(s) >= {"dugum_eklendi", "dugum_guncellendi", "kenar", "olgu", "atlanan",
                      "hatalar", "korunan"}
    assert s["korunan"] == []
    assert s["atlanan"] >= 1


def test_sirli_satir_var_olan_dugumu_degistirmez(con, tmp_path):
    """Önce temiz içe alınmış düğüm, sonraki tohumda sır taşırsa eski hâli kalır."""
    _al(con, _yaz(tmp_path / "t1.jsonl", [_t("dugum", "Düğüm", ozet="temiz özet")]))
    s = _al(con, _yaz(tmp_path / "t2.jsonl",
                      [_t("dugum", "Düğüm", ozet=f"yeni {SIR_ENV}")]))
    assert s["hatalar"]
    assert _alanlar(con, "dugum")["ozet"] == "temiz özet"
    _sir_izi_yok(_tum_tablolar_metni(con))


# ---------------------------------------------------------------- korunan anahtarı

def test_korunan_ilk_icealimda_bos_liste(con, tmp_path):
    s = _al(con, _yaz(tmp_path / "t.jsonl", [_t("a", "A"), _t("b", "B")]))
    assert s["korunan"] == []
    assert isinstance(s["korunan"], list)


def test_korunan_kritik_hatada_da_var(con, tmp_path):
    s = _al(con, tmp_path / "yok.jsonl")
    assert s["hatalar"]
    assert s["korunan"] == []


def test_imza_uzerine_yaz_varsayilan_false(con, tmp_path):
    yol = _yaz(tmp_path / "t.jsonl", [_t("a", "A")])
    s = ice_al.ice_al(con, yol, uzerine_yaz=False)
    assert s["korunan"] == []
    s = ice_al.ice_al(con, yol, uzerine_yaz=True)
    assert s["korunan"] == []


# ---------------------------------------------------------------- koruma

def _tohum_v1():
    return [
        _kok(),
        _t("proje-a", "ProjeA", tur="proje", ozet="ilk özet A", ayrinti="ilk ayrıntı A"),
        _t("proje-b", "ProjeB", tur="proje", ozet="ilk özet B", ayrinti="ilk ayrıntı B"),
    ]


def _tohum_v2():
    """v1'in her alanı değişmiş hâli (başlık/özet/ayrıntı/tür/durum)."""
    return [
        _kok(),
        _t("proje-a", "ProjeA-v2", tur="bilgi", ozet="tohum özet A v2",
           ayrinti="tohum ayrıntı A v2", durum="duraklatildi"),
        _t("proje-b", "ProjeB-v2", tur="bilgi", ozet="tohum özet B v2",
           ayrinti="tohum ayrıntı B v2", durum="duraklatildi"),
    ]


def _a_disaridan_degisti(con):
    _dis_duzelt(con, "proje-a", "kullanıcının düzelttiği özet")
    _dis_durum(con, "proje-a", "bitti")
    return _alanlar(con, "proje-a")


def test_duzeltilen_dugum_korunur_ve_korunana_eklenir(con, tmp_path):
    _al(con, _yaz(tmp_path / "t1.jsonl", _tohum_v1()))
    once = _a_disaridan_degisti(con)
    s = _al(con, _yaz(tmp_path / "t2.jsonl", _tohum_v2()))
    assert _alanlar(con, "proje-a") == once
    assert s["korunan"] == ["proje-a"]


def test_korunan_dugumde_dis_degisiklik_aynen_durur(con, tmp_path):
    _al(con, _yaz(tmp_path / "t1.jsonl", _tohum_v1()))
    _a_disaridan_degisti(con)
    _al(con, _yaz(tmp_path / "t2.jsonl", _tohum_v2()))
    a = _alanlar(con, "proje-a")
    assert a["durum"] == "bitti"
    assert a["ozet"] == "kullanıcının düzelttiği özet"
    assert a["baslik"] == "ProjeA"
    assert a["ayrinti"] == "ilk ayrıntı A"
    assert a["tur"] == "proje"


def test_ayni_tohum_yeniden_alininca_duzeltme_ezilmez(con, tmp_path):
    """Asıl hata: aynı tohum tekrar içe alınınca 'bitti' sessizce 'aktif' oluyordu."""
    yol = _yaz(tmp_path / "t.jsonl", _tohum_v1())
    _al(con, yol)
    once = _a_disaridan_degisti(con)
    s = _al(con, yol)
    assert _alanlar(con, "proje-a") == once
    assert s["korunan"] == ["proje-a"]


def test_duzeltilen_korunurken_duzeltilmemis_kardes_guncellenir(con, tmp_path):
    _al(con, _yaz(tmp_path / "t1.jsonl", _tohum_v1()))
    once = _a_disaridan_degisti(con)
    s = _al(con, _yaz(tmp_path / "t2.jsonl", _tohum_v2()))
    assert _alanlar(con, "proje-a") == once
    assert _alanlar(con, "proje-b") == {
        "baslik": "ProjeB-v2", "ozet": "tohum özet B v2", "ayrinti": "tohum ayrıntı B v2",
        "tur": "bilgi", "durum": "duraklatildi"}
    assert s["korunan"] == ["proje-a"]
    assert "proje-b" not in s["korunan"]


def test_yalniz_ozet_duzeltmesi_de_korur(con, tmp_path):
    _al(con, _yaz(tmp_path / "t1.jsonl", _tohum_v1()))
    _dis_duzelt(con, "proje-a", "yalnız özet düzeltildi")
    s = _al(con, _yaz(tmp_path / "t2.jsonl", _tohum_v2()))
    a = _alanlar(con, "proje-a")
    assert a["ozet"] == "yalnız özet düzeltildi"
    assert a["durum"] == "aktif" and a["baslik"] == "ProjeA" and a["tur"] == "proje"
    assert s["korunan"] == ["proje-a"]


def test_koruma_sonraki_icealimlarda_da_surer(con, tmp_path):
    _al(con, _yaz(tmp_path / "t1.jsonl", _tohum_v1()))
    once = _a_disaridan_degisti(con)
    yol2 = _yaz(tmp_path / "t2.jsonl", _tohum_v2())
    _al(con, yol2)
    s = _al(con, yol2)
    assert _alanlar(con, "proje-a") == once
    assert s["korunan"] == ["proje-a"]


def test_uzerine_yaz_true_tohum_kazanir(con, tmp_path):
    _al(con, _yaz(tmp_path / "t1.jsonl", _tohum_v1()))
    _a_disaridan_degisti(con)
    s = _al(con, _yaz(tmp_path / "t2.jsonl", _tohum_v2()), uzerine_yaz=True)
    assert _alanlar(con, "proje-a") == {
        "baslik": "ProjeA-v2", "ozet": "tohum özet A v2", "ayrinti": "tohum ayrıntı A v2",
        "tur": "bilgi", "durum": "duraklatildi"}
    assert _alanlar(con, "proje-b")["ozet"] == "tohum özet B v2"
    assert s["korunan"] == []
    assert not s["hatalar"], s["hatalar"]


# ---------------------------------------------------------------- değişmeyen davranış
# (Bu testler özgün kodda da geçmelidir; "korunan" yoksa boş sayılır.)

def test_duzeltilmemis_dugum_degisen_tohumla_guncellenir(con, tmp_path):
    _al(con, _yaz(tmp_path / "t1.jsonl", _tohum_v1()))
    s = _al(con, _yaz(tmp_path / "t2.jsonl", _tohum_v2()))
    assert not s["hatalar"], s["hatalar"]
    assert s["dugum_guncellendi"] >= 2
    for a in ("proje-a", "proje-b"):
        r = _alanlar(con, a)
        assert r["baslik"] == ("ProjeA-v2" if a == "proje-a" else "ProjeB-v2")
        assert r["ozet"].startswith("tohum özet") and r["ayrinti"].startswith("tohum ayrıntı")
        assert r["tur"] == "bilgi" and r["durum"] == "duraklatildi"
    assert s.get("korunan", []) == []


def test_duzeltilmemis_kardes_guncellenir(con, tmp_path):
    """Başka bir düğümün düzeltilmesi, düzeltilmemiş kardeşin güncellenmesini engellemez."""
    _al(con, _yaz(tmp_path / "t1.jsonl", _tohum_v1()))
    _dis_duzelt(con, "proje-a", "kullanıcının düzelttiği özet")
    _al(con, _yaz(tmp_path / "t2.jsonl", _tohum_v2()))
    assert _alanlar(con, "proje-b") == {
        "baslik": "ProjeB-v2", "ozet": "tohum özet B v2", "ayrinti": "tohum ayrıntı B v2",
        "tur": "bilgi", "durum": "duraklatildi"}


def test_kaynakli_tohum_satiri_dis_degisiklik_sayilmaz(con, tmp_path):
    """Tohum satırının 'kaynaklar' alanı (memory kaynağı) tohum dışı değişiklik değildir."""
    v1 = [_kok(), _t("k", "K", ozet="ilk", kaynaklar=["notlar/k.md"])]
    v2 = [_kok(), _t("k", "K", ozet="ikinci", kaynaklar=["notlar/k.md"])]
    _al(con, _yaz(tmp_path / "t1.jsonl", v1))
    s = _al(con, _yaz(tmp_path / "t2.jsonl", v2))
    assert _alanlar(con, "k")["ozet"] == "ikinci"
    assert s.get("korunan", []) == []


def test_ayni_tohum_iki_kez_degisiklik_yapmaz(con, tmp_path):
    satirlar = _tohum_v1() + [
        _t("alt", "Alt", ebeveyn="proje-a", olgular=["bir olgu"], kaynaklar=["notlar/alt.md"]),
    ]
    yol = _yaz(tmp_path / "t.jsonl", satirlar)
    _al(con, yol)
    tablolar = ("dugum", "kenar", "olgu", "kaynak", "gecmis")
    sayilar = {t: _say(con, t) for t in tablolar}
    alanlar = {a: _alanlar(con, a) for a in ("proje-a", "proje-b", "alt")}
    s2 = _al(con, yol)
    assert {t: _say(con, t) for t in tablolar} == sayilar
    assert {a: _alanlar(con, a) for a in ("proje-a", "proje-b", "alt")} == alanlar
    assert s2["dugum_eklendi"] == 0 and s2["kenar"] == 0 and s2["olgu"] == 0
    assert not s2["hatalar"], s2["hatalar"]
    assert s2.get("korunan", []) == []
