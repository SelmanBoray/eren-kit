"""kapi.harita testleri (sözleşmeden yazıldı; gerçek vault kullanılmaz, tüm metinler bellekte)."""
import dataclasses

import pytest

from bellek.kapi.harita import Baslik, basliklari_cikar, harita_metni


def _h(metin):
    """(seviye, metin, bas, son) üçlüleri."""
    return [(b.seviye, b.metin, b.bas, b.son) for b in basliklari_cikar(metin)]


def _satirlar(metin):
    p = metin.split("\n")
    if metin.endswith("\n"):
        p = p[:-1]
    return [s[:-1] if s.endswith("\r") else s for s in p]


def _harita_satirlari(mesaj):
    return [s for s in mesaj.split("\n") if "— satır " in s]


# ---------- Baslik / son hesabı ----------

def test_baslik_donmus_dataclass():
    b = Baslik(seviye=1, metin="x", bas=1, son=2, karakter=5)
    assert b == Baslik(1, "x", 1, 2, 5)
    with pytest.raises(dataclasses.FrozenInstanceError):
        b.bas = 3  # type: ignore[misc]


def test_ic_ice_bolumler_son_hesabi():
    metin = "# A\nmetin\n## B\nx\n## C\ny\n# D\nz\n"
    assert _h(metin) == [
        (1, "A", 1, 6),
        (2, "B", 3, 4),
        (2, "C", 5, 6),
        (1, "D", 7, 8),
    ]


def test_alt_bolum_ustun_icinde_kalir():
    metin = "# A\n## B\n### C\nx\n## D\ny\n"
    sonuc = {m: (b, s) for _, m, b, s in _h(metin)}
    assert sonuc["A"] == (1, 6)
    assert sonuc["B"] == (2, 4)
    assert sonuc["C"] == (3, 4)
    assert sonuc["D"] == (5, 6)


def test_seviye_atlayan_baslik_ve_ust_baslikta_biter():
    metin = "# A\n### B\nx\n## C\ny\n"
    sonuc = {m: (b, s) for _, m, b, s in _h(metin)}
    assert sonuc["B"] == (2, 3)  # seviye 2 <= 3 olan C'den önce biter
    assert sonuc["C"] == (4, 5)
    assert sonuc["A"] == (1, 5)


def test_derin_baslik_ustteki_dusuk_seviyeli_baslikta_biter():
    metin = "## A\nx\n# B\ny\n"
    assert _h(metin) == [(2, "A", 1, 2), (1, "B", 3, 4)]


def test_son_baslik_dosya_sonuna_gider():
    metin = "# A\n# B\n\n\nson satır\n"
    assert _h(metin) == [(1, "A", 1, 1), (1, "B", 2, 5)]


def test_baslik_yoksa_bos_liste():
    assert basliklari_cikar("") == []
    assert basliklari_cikar("düz metin\nbaşka satır\n") == []


# ---------- karakter ----------

def test_karakter_tanimi_literal():
    # "# A"=3+1, "x"=1+1 -> 6
    b = basliklari_cikar("# A\nx\n")[0]
    assert b.karakter == 6
    assert (b.bas, b.son) == (1, 2)


def test_karakter_bas_son_satirlari_toplami():
    metin = "# Çöp ğüş\nıöşç İİ\n## Alt\nabc\n# Son\n"
    satirlar = _satirlar(metin)
    for b in basliklari_cikar(metin):
        beklenen = sum(len(s) + 1 for s in satirlar[b.bas - 1 : b.son])
        assert b.karakter == beklenen


def test_karakter_crlf_sondaki_cr_sayilmaz():
    lf = "# Ab\ncd\n## Ef\ngh\n"
    crlf = lf.replace("\n", "\r\n")
    assert [b.karakter for b in basliklari_cikar(crlf)] == [b.karakter for b in basliklari_cikar(lf)]


# ---------- satır sonları ----------

def test_crlf_lf_ile_ayni_satir_numaralari():
    lf = "# A\nx\n## B\ny\n# C\nz\n"
    assert basliklari_cikar(lf.replace("\n", "\r\n")) == basliklari_cikar(lf)


def test_crlf_baslik_metninde_cr_kalmaz():
    sonuc = basliklari_cikar("# Başlık\r\nx\r\n")
    assert sonuc[0].metin == "Başlık"


def test_lf_ile_biten_ve_bitmeyen_ayni():
    a = basliklari_cikar("# A\nx\n## B\ny\n")
    b = basliklari_cikar("# A\nx\n## B\ny")
    assert a == b
    assert a[0].son == 4 and a[1].son == 4


def test_sondaki_bos_satir_sayilir_ama_son_parca_sayilmaz():
    # satırlar: "# A", "x", "" -> 3
    assert basliklari_cikar("# A\nx\n\n")[0].son == 3
    assert basliklari_cikar("# A\nx\n")[0].son == 2
    assert basliklari_cikar("# A\nx\n\n")[0].karakter == 4 + 2 + 1


# ---------- başlık sözdizimi ----------

def test_kapanis_diyezleri_atilir():
    metin = "# Başlık #\n## Çift ##\n### Üç ###   \n"
    assert [m for _, m, _, _ in _h(metin)] == ["Başlık", "Çift", "Üç"]


def test_metin_kirpilir():
    assert _h("#    Boşluklu başlık   \n")[0][1] == "Boşluklu başlık"


def test_sekme_ayirici():
    assert _h("#\tŞekil\n") == [(1, "Şekil", 1, 1)]


def test_etiket_baslik_degil():
    assert _h("#etiket\n##başka\n# Gerçek\n") == [(1, "Gerçek", 3, 3)]


def test_bos_baslik_atlanir():
    metin = "#\n# \n## ##\n# Dolu\n"
    assert _h(metin) == [(1, "Dolu", 4, 4)]


def test_yedi_diyez_baslik_degil():
    assert _h("####### yedi\n###### altı\n") == [(6, "altı", 2, 2)]


def test_girinti_0_3_bosluk_basliktir_4_degil():
    metin = "# a\n # b\n  ## c\n   ### d\n    # e\n\t# f\n"
    sonuc = _h(metin)
    assert [(s, m, b) for s, m, b, _ in sonuc] == [(1, "a", 1), (1, "b", 2), (2, "c", 3), (3, "d", 4)]


def test_setext_desteklenmez():
    assert basliklari_cikar("Başlık\n======\nAlt\n------\n") == []


# ---------- kod çiti ----------

@pytest.mark.parametrize("cit", ["```", "~~~"])
def test_cit_ici_yorum_basliklar_yok_sayilir(cit):
    metin = f"# A\n{cit}\n# yorum\n## bir\n{cit}\n## B\n"
    assert _h(metin) == [(1, "A", 1, 6), (2, "B", 6, 6)]


def test_cit_ici_satirlar_bolume_dahil():
    metin = "# A\n```\n# yorum\n```\n## B\n"
    sonuc = _h(metin)
    assert sonuc[0] == (1, "A", 1, 5)
    assert sonuc[1] == (2, "B", 5, 5)


def test_uzun_cit_kisa_citle_kapanmaz():
    metin = "# A\n````\n```\n# yorum\n```\n````\n# B\n"
    assert _h(metin) == [(1, "A", 1, 6), (1, "B", 7, 7)]


def test_uzun_kapanis_citi_kapatir():
    metin = "# A\n```\n# yorum\n`````\n# B\n"
    assert _h(metin) == [(1, "A", 1, 4), (1, "B", 5, 5)]


def test_farkli_karakterli_cit_kapatmaz():
    metin = "# A\n```\n# yorum\n~~~\n# yorum2\n```\n# B\n"
    assert _h(metin) == [(1, "A", 1, 6), (1, "B", 7, 7)]


def test_kapanmayan_cit_dosya_sonuna_kadar():
    metin = "# A\nx\n```\n# yorum\n## bir\nson\n"
    assert _h(metin) == [(1, "A", 1, 6)]


def test_cit_girintili_3_bosluk_ve_dil_etiketi():
    metin = "# A\n   ```python\n# yorum\n   ```\n## B\n"
    assert _h(metin) == [(1, "A", 1, 5), (2, "B", 5, 5)]


def test_iki_cit_blogu_arasindaki_baslik_gecerli():
    metin = "```\n# a\n```\n# Gerçek\n~~~\n# b\n~~~\n"
    assert _h(metin) == [(1, "Gerçek", 4, 7)]


# ---------- YAML ön bilgisi ----------

def test_yaml_on_bilgisi_yok_sayilir_numaralar_mutlak():
    metin = "---\ntitle: x\n# yorum\n---\n# Başlık\nx\n"
    assert _h(metin) == [(1, "Başlık", 5, 6)]


def test_yaml_nokta_nokta_nokta_ile_kapanir():
    metin = "---\n# yorum\n...\n# Başlık\n"
    assert _h(metin) == [(1, "Başlık", 4, 4)]


def test_yaml_yalniz_ilk_satirdaysa():
    metin = "# İlk\n---\n# İkinci\n---\n"
    assert [(m, b) for _, m, b, _ in _h(metin)] == [("İlk", 1), ("İkinci", 3)]


def test_yaml_ilk_satir_bos_ise_on_bilgi_degil():
    # ilk satır '---' değil -> ön bilgi yok; '# x' başlıktır
    metin = "\n---\n# x\n---\n"
    assert _h(metin) == [(1, "x", 3, 4)]


def test_yaml_crlf():
    metin = "---\r\na: 1\r\n# y\r\n---\r\n# Başlık\r\n"
    assert _h(metin) == [(1, "Başlık", 5, 5)]


# ---------- harita_metni ----------

def _metin_uc_baslik():
    return "# Giriş\nabc\n## Çalışma Düzeni\nx\n## Öğrenme Ğ\ny\n"


def test_harita_baslik_sayisi_3ten_azsa_none():
    assert harita_metni("a.md", "") is None
    assert harita_metni("a.md", "düz metin\n") is None
    assert harita_metni("a.md", "# A\n## B\n") is None


def test_harita_uc_baslikta_metin_doner():
    assert isinstance(harita_metni("a.md", _metin_uc_baslik()), str)


def test_harita_kodcitindeki_basliklar_sayilmaz():
    metin = "# A\n## B\n```\n# x\n# y\n```\n"
    assert harita_metni("a.md", metin) is None


def test_harita_mesaj_icerigi():
    metin = _metin_uc_baslik()
    m = harita_metni("C:\\Proje\\Plan Belgesi.md", metin)
    assert "Plan Belgesi.md" in m
    assert str(len(metin)) in m
    assert "6" in m  # toplam satır
    assert "offset" in m and "limit" in m
    assert "Harita:" in m
    assert "satır 1-6" in m
    assert "satır 3-4" in m
    assert "satır 5-6" in m
    for ad in ("Giriş", "Çalışma Düzeni", "Öğrenme Ğ"):
        assert ad in m


def test_harita_dosya_adi_son_parca_slash():
    m = harita_metni("/home/x/proje/NOTLAR.md", _metin_uc_baslik())
    assert "NOTLAR.md" in m
    assert "/home/x/proje/" not in m


def test_harita_toplam_satir_sayisi_gecer():
    govde = "\n".join(f"satır{i}" for i in range(34))
    metin = "# A\n## B\n## C\n" + govde + "\n"  # 3 + 34 = 37 satır
    m = harita_metni("a.md", metin)
    assert "37" in m


def test_harita_satir_yapisi_ve_girinti():
    metin = "# Üst\nx\n## Alt\ny\n### Derin\nz\n# Öteki\n"
    m = harita_metni("a.md", metin)
    satirlar = _harita_satirlari(m)
    assert len(satirlar) == 4
    assert satirlar[0].startswith("- Üst — satır 1-6 (~")
    assert satirlar[1].startswith("  - Alt — satır 3-6 (~")
    assert satirlar[2].startswith("    - Derin — satır 5-6 (~")
    assert satirlar[3].startswith("- Öteki — satır 7-7 (~")
    for s in satirlar:
        assert s.endswith(")")


def test_harita_girinti_en_kucuk_seviyeye_gore():
    metin = "## A\n### B\n## C\n"
    satirlar = _harita_satirlari(harita_metni("a.md", metin))
    assert satirlar[0].startswith("- A — satır 1-2")
    assert satirlar[1].startswith("  - B — satır 2-2")
    assert satirlar[2].startswith("- C — satır 3-3")


def test_harita_boyut_850_kr():
    metin = "# A\n" + "x" * 845 + "\n# B\ny\n# C\nz\n"
    ilk = basliklari_cikar(metin)[0]
    assert ilk.karakter == 850
    satirlar = _harita_satirlari(harita_metni("a.md", metin))
    assert "(~850 kr)" in satirlar[0]


def test_harita_boyut_kucuk_kr():
    satirlar = _harita_satirlari(harita_metni("a.md", "# A\n# B\n# C\n"))
    assert satirlar[0].endswith("(~4 kr)")


def test_harita_boyut_999_kr():
    metin = "# A\n" + "x" * 994 + "\n# B\ny\n# C\nz\n"
    assert basliklari_cikar(metin)[0].karakter == 999
    assert "(~999 kr)" in _harita_satirlari(harita_metni("a.md", metin))[0]


def test_harita_boyut_bin_turkce_virgul():
    metin = "# A\n" + "x" * 4095 + "\n# B\ny\n# C\nz\n"
    assert basliklari_cikar(metin)[0].karakter == 4100
    satirlar = _harita_satirlari(harita_metni("a.md", metin))
    assert "(~4,1 bin kr)" in satirlar[0]
    assert "4.1" not in satirlar[0]


def test_harita_boyut_tam_bin():
    metin = "# A\n" + "x" * 995 + "\n# B\ny\n# C\nz\n"
    assert basliklari_cikar(metin)[0].karakter == 1000
    assert "(~1,0 bin kr)" in _harita_satirlari(harita_metni("a.md", metin))[0]


def test_harita_crlf_ayni_satirlar():
    lf = "# A\nx\n## B\ny\n# C\nz\n"
    a = _harita_satirlari(harita_metni("a.md", lf))
    b = _harita_satirlari(harita_metni("a.md", lf.replace("\n", "\r\n")))
    assert a == b


# ---------- kırpma ----------

def test_kirpma_duz_basliklar_ilk_n_ve_ek_satir():
    metin = "".join(f"# Başlık{i:02d}\nx\n" for i in range(10))
    m = harita_metni("a.md", metin, en_cok_satir=4)
    assert len(_harita_satirlari(m)) == 4
    for i in range(4):
        assert f"Başlık{i:02d}" in m
    assert "Başlık04" not in m
    assert "… (+6 başlık daha)" in m


def test_kirpma_tam_sinirda_kirpilmaz():
    metin = "".join(f"# B{i}\nx\n" for i in range(5))
    m = harita_metni("a.md", metin, en_cok_satir=5)
    assert len(_harita_satirlari(m)) == 5
    assert "başlık daha" not in m


def test_kirpma_derin_seviyeler_once_duser():
    parcalar = []
    for i in range(3):
        parcalar.append(f"## Orta{i}\nx\n")
        for j in range(3):
            parcalar.append(f"### Derin{i}{j}\ny\n")
    metin = "# Kök\n" + "".join(parcalar)  # 1 + 3 + 9 = 13 başlık
    m = harita_metni("a.md", metin, en_cok_satir=5)
    satirlar = _harita_satirlari(m)
    assert len(satirlar) <= 5
    assert "Derin" not in m
    assert "Kök" in m and "Orta0" in m


def test_kirpma_sinir_hicbir_zaman_asilmaz():
    metin = "# Kök\n" + "".join(f"## K{i}\nx\n" for i in range(11))
    for sinir in (3, 5, 7):
        m = harita_metni("a.md", metin, en_cok_satir=sinir)
        assert len(_harita_satirlari(m)) <= sinir
    m = harita_metni("a.md", metin, en_cok_satir=5)
    assert "Kök" in m


def test_kirpma_varsayilan_80():
    metin = "".join(f"# B{i:03d}\nx\n" for i in range(100))
    m = harita_metni("a.md", metin)
    assert len(_harita_satirlari(m)) == 80
    assert "… (+20 başlık daha)" in m


# ---------- yol: yalnız son parça ----------

def test_harita_tam_yol_gecmez_ters_bolu():
    m = harita_metni(r"C:\a\b\X.md", _metin_uc_baslik())
    assert "X.md" in m
    assert r"C:\a\b" not in m
    assert r"a\b" not in m


def test_harita_tam_yol_gecmez_duz_bolu():
    m = harita_metni("C:/a/b/X.md", _metin_uc_baslik())
    assert "X.md" in m
    assert "C:/a/b" not in m
    assert "a/b" not in m


# ---------- uzun başlık kısaltma ----------

def _uc_baslik_ilki(uzunluk):
    return "# " + "u" * uzunluk + "\nx\n## B\ny\n## C\nz\n"


def test_harita_baslik_120_kisaltilmaz():
    m = harita_metni("a.md", _uc_baslik_ilki(120))
    satir = _harita_satirlari(m)[0]
    assert "u" * 120 in satir
    assert "…" not in satir


def test_harita_baslik_121_kisaltilir():
    m = harita_metni("a.md", _uc_baslik_ilki(121))
    satir = _harita_satirlari(m)[0]
    assert satir.startswith("- " + "u" * 119 + "… — satır ")
    assert "u" * 120 not in satir


def test_basliklari_cikar_metni_tam_kalir():
    assert basliklari_cikar(_uc_baslik_ilki(500))[0].metin == "u" * 500


def test_harita_cok_uzun_baslik_satiri_makul():
    metin = ("# " + "u" * 4000 + "\nx\n") * 3
    m = harita_metni("a.md", metin)
    assert m is not None
    assert max(len(s) for s in m.split("\n") if "— satır " in s) < 200
