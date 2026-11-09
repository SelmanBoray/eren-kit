"""devir.transcript testleri; JSONL fikstürleri Claude Code kayıt şemasını taklit eder."""
import json
import time

import pytest

from bellek.devir.transcript import maskele, oturum_ozeti, son_istek_bilgisi

SID = "11111111-2222-3333-4444-555555555555"
CWD = "C:\\proje"


def _ts(i):
    return f"2026-11-08T10:{(i // 60) % 60:02d}:{i % 60:02d}.123Z"


def kullanici(metin, i=0, meta=False):
    d = {"parentUuid": None, "isSidechain": False, "type": "user",
         "message": {"role": "user", "content": metin},
         "uuid": f"u{i}", "timestamp": _ts(i), "cwd": CWD, "sessionId": SID}
    if meta:
        d["isMeta"] = True
    return d


def tool_result(i=0, metin="cikti"):
    return {"parentUuid": "x", "isSidechain": False, "type": "user",
            "message": {"role": "user", "content": [
                {"tool_use_id": "toolu_1", "type": "tool_result", "content": metin, "is_error": False}]},
            "uuid": f"tr{i}", "timestamp": _ts(i), "cwd": CWD, "sessionId": SID}


def asistan(i=0, mid=None, rid=None, model="claude-opus-x", inp=2, okuma=100, olus=10,
            araclar=(), ts=None):
    icerik = [{"type": "text", "text": "tamam"}]
    for ad, girdi in araclar:
        icerik.append({"type": "tool_use", "id": f"toolu_{i}_{ad}", "name": ad, "input": girdi,
                       "caller": {"type": "direct"}})
    return {"parentUuid": "p", "isSidechain": False, "type": "assistant",
            "message": {"model": model, "id": mid or f"msg_{i}", "type": "message", "role": "assistant",
                        "content": icerik, "stop_reason": None,
                        "usage": {"input_tokens": inp, "cache_creation_input_tokens": olus,
                                  "cache_read_input_tokens": okuma, "output_tokens": 5}},
            "requestId": rid or f"req_{i}", "uuid": f"a{i}", "timestamp": ts or _ts(i),
            "cwd": CWD, "sessionId": SID}


def yaz(yol, satirlar):
    with open(yol, "w", encoding="utf-8") as f:
        for s in satirlar:
            f.write((s if isinstance(s, str) else json.dumps(s, ensure_ascii=False)) + "\n")
    return yol


@pytest.fixture
def tp(tmp_path):
    return tmp_path / "oturum.jsonl"


# ---- temel alanlar ----

def test_temel_alanlar(tp):
    yaz(tp, [kullanici("ilk istek", 1), asistan(2, inp=3, okuma=100, olus=20, ts="2026-11-08T10:00:02.123Z"),
             kullanici("son istek", 3), asistan(4, inp=5, okuma=1000, olus=50, model="claude-sonnet-y",
                                                ts="2026-11-08T10:00:04.999Z")])
    o = oturum_ozeti(tp)
    assert o["oturum"] == SID
    assert o["cwd"] == CWD
    assert o["ilk_istem"] == "ilk istek"
    assert o["son_istem"] == "son istek"
    assert o["son_baglam"] == 5 + 1000 + 50
    assert o["son_model"] == "claude-sonnet-y"
    assert o["son_zaman"] == "2026-11-08T10:00:04.999Z"
    assert o["istek_sayisi"] == 2


def test_str_yolu_kabul(tp):
    yaz(tp, [kullanici("merhaba", 1)])
    assert oturum_ozeti(str(tp))["ilk_istem"] == "merhaba"


# ---- başlık önceliği ----

def _baslikli(*ekstra):
    return [kullanici("ilk gercek istem", 1), *ekstra, asistan(2)]


def test_baslik_custom_en_oncelikli(tp):
    yaz(tp, _baslikli({"type": "summary", "summary": "ozet", "leafUuid": "l"},
                      {"type": "ai-title", "aiTitle": "ai baslik", "sessionId": SID},
                      {"type": "custom-title", "customTitle": "ozel baslik", "sessionId": SID}))
    assert oturum_ozeti(tp)["baslik"] == "ozel baslik"


def test_baslik_ai_summary_ustunde(tp):
    yaz(tp, _baslikli({"type": "summary", "summary": "ozet", "leafUuid": "l"},
                      {"type": "ai-title", "aiTitle": "ai baslik", "sessionId": SID}))
    assert oturum_ozeti(tp)["baslik"] == "ai baslik"


def test_baslik_summary(tp):
    yaz(tp, _baslikli({"type": "summary", "summary": "ozet", "leafUuid": "l"}))
    assert oturum_ozeti(tp)["baslik"] == "ozet"


def test_baslik_ilk_istem_80_karakter(tp):
    uzun = "a" * 300
    yaz(tp, [kullanici(uzun, 1), asistan(2)])
    b = oturum_ozeti(tp)["baslik"]
    assert b and len(b) <= 80 and b.startswith("aaaa")


def test_baslik_kisa_istem_aynen(tp):
    yaz(tp, [kullanici("kisa istem", 1)])
    assert oturum_ozeti(tp)["baslik"] == "kisa istem"


# ---- istem ayıklama ----

def test_tool_result_ve_meta_istem_sayilmaz(tp):
    yaz(tp, [kullanici("<command-name>/x</command-name>", 1, meta=True),
             kullanici("gercek bir", 2), asistan(3), tool_result(4, "arac ciktisi"),
             kullanici("meta sonrasi", 5, meta=True), tool_result(6, "bir daha")])
    o = oturum_ozeti(tp)
    assert o["ilk_istem"] == "gercek bir"
    assert o["son_istem"] == "gercek bir"
    assert "arac" not in (o["baslik"] or "")


def test_istem_liste_icerik_text_blogu(tp):
    satir = kullanici("x", 1)
    satir["message"]["content"] = [{"type": "text", "text": "blok istem"}]
    yaz(tp, [satir])
    assert oturum_ozeti(tp)["ilk_istem"] == "blok istem"


def test_istem_200_karaktere_kisalir(tp):
    yaz(tp, [kullanici("b" * 500, 1), asistan(2), kullanici("c" * 500, 3)])
    o = oturum_ozeti(tp)
    assert 0 < len(o["ilk_istem"]) <= 200
    assert 0 < len(o["son_istem"]) <= 200
    assert o["son_istem"].startswith("ccc")


def test_istemde_anahtar_maskelenir(tp):
    gizli = "sk-ant-api03-" + "AbCd1234" * 5
    yaz(tp, [kullanici(f"anahtarim {gizli} bu", 1), asistan(2)])
    o = oturum_ozeti(tp)
    assert gizli not in o["ilk_istem"] and "[gizli]" in o["ilk_istem"]
    assert gizli not in o["son_istem"]
    assert gizli not in (o["baslik"] or "")


# ---- istek sayısı / model / bağlam ----

def test_ayni_message_id_tek_sayilir(tp):
    # aynı yanıtın akış parçaları: aynı message.id + requestId birden çok satırda
    yaz(tp, [kullanici("s", 1),
             asistan(2, mid="msg_A", rid="req_A"), asistan(3, mid="msg_A", rid="req_A"),
             asistan(4, mid="msg_A", rid="req_A"), asistan(5, mid="msg_B", rid="req_B")])
    assert oturum_ozeti(tp)["istek_sayisi"] == 2


def test_synthetic_model_atlanir(tp):
    yaz(tp, [kullanici("s", 1), asistan(2, model="claude-opus-x", ts="2026-11-08T10:00:02.000Z"),
             asistan(3, model="<synthetic>", ts="2026-11-08T10:00:03.000Z")])
    o = oturum_ozeti(tp)
    assert o["son_model"] == "claude-opus-x"
    s = son_istek_bilgisi(tp)
    assert s["son_model"] == "claude-opus-x"


def test_son_baglam_son_assistant_mesajindan(tp):
    yaz(tp, [asistan(1, inp=1, okuma=10, olus=1), asistan(2, inp=7, okuma=700, olus=70), tool_result(3)])
    assert oturum_ozeti(tp)["son_baglam"] == 777
    assert son_istek_bilgisi(tp)["son_baglam"] == 777


def test_son_istek_bilgisi_anahtarlari(tp):
    yaz(tp, [kullanici("s", 1), asistan(2, ts="2026-11-08T10:00:02.000Z")])
    s = son_istek_bilgisi(tp)
    assert set(s) == {"son_baglam", "son_model", "son_zaman"}
    assert s["son_zaman"] == "2026-11-08T10:00:02.000Z"


# ---- düzenlenen dosyalar ----

def _duzen(i, yol, ad="Edit"):
    anahtar = "notebook_path" if ad == "NotebookEdit" else "file_path"
    girdi = {anahtar: yol, "content": "x"} if ad == "Write" else {anahtar: yol, "old_string": "a", "new_string": "b"}
    return asistan(i, araclar=[(ad, girdi)])


def test_duzenlenen_arac_turleri(tp):
    yaz(tp, [_duzen(1, "C:\\a.py", "Edit"), _duzen(2, "C:\\b.py", "Write"),
             _duzen(3, "C:\\c.py", "MultiEdit"), _duzen(4, "C:\\d.ipynb", "NotebookEdit"),
             asistan(5, araclar=[("Read", {"file_path": "C:\\okunan.py"}),
                                 ("Bash", {"command": "ls"})])])
    d = oturum_ozeti(tp)["duzenlenen"]
    assert d == ["C:\\a.py", "C:\\b.py", "C:\\c.py", "C:\\d.ipynb"]


def test_duzenlenen_tekil_en_yeni_sonda(tp):
    yaz(tp, [_duzen(1, "a"), _duzen(2, "b"), _duzen(3, "c"), _duzen(4, "a")])
    d = oturum_ozeti(tp)["duzenlenen"]
    assert sorted(d) == ["a", "b", "c"]
    assert len(d) == 3
    assert d[-1] == "a"


def test_duzenlenen_en_son_15(tp):
    yaz(tp, [_duzen(i, f"dosya{i:02d}.py") for i in range(1, 25)])
    d = oturum_ozeti(tp)["duzenlenen"]
    assert len(d) == 15
    assert d[0] == "dosya10.py" and d[-1] == "dosya24.py"


def test_duzenlenen_yoksa_bos_liste(tp):
    yaz(tp, [kullanici("s", 1), asistan(2)])
    assert oturum_ozeti(tp)["duzenlenen"] == []


# ---- dayanıklılık ----

def test_bozuk_satir_atlanir(tp):
    yaz(tp, ["{bozuk json", kullanici("saglam", 1), "", "[1,2", asistan(2, inp=1, okuma=2, olus=3),
             '{"type": "assistant", "message": '])
    o = oturum_ozeti(tp)
    assert o["ilk_istem"] == "saglam"
    assert o["son_baglam"] == 6
    assert son_istek_bilgisi(tp)["son_baglam"] == 6


def test_olmayan_dosya(tmp_path):
    yol = tmp_path / "yok.jsonl"
    o = oturum_ozeti(yol)
    assert isinstance(o, dict)
    assert o["oturum"] is None and o["baslik"] is None
    assert o["son_baglam"] is None and o["son_model"] is None
    assert not o["duzenlenen"]
    s = son_istek_bilgisi(yol)
    assert s["son_baglam"] is None and s["son_model"] is None and s["son_zaman"] is None


def test_bos_dosya(tp):
    tp.write_text("", encoding="utf-8")
    o = oturum_ozeti(tp)
    assert o["oturum"] is None and o["ilk_istem"] is None and o["son_istem"] is None
    assert not o["duzenlenen"]
    assert son_istek_bilgisi(tp)["son_model"] is None


def test_yalniz_bozuk_icerik(tp):
    tp.write_bytes(b"\xff\xfe\x00garbage\n\x80\x81\n")
    assert isinstance(oturum_ozeti(tp), dict)
    assert isinstance(son_istek_bilgisi(tp), dict)


# ---- büyük dosya ----

def test_buyuk_dosyada_son_istek_bilgisi(tp):
    dolgu_s = json.dumps(kullanici("d" * 2000, 1))
    with open(tp, "w", encoding="utf-8") as f:
        f.write(json.dumps(asistan(2, inp=1, okuma=1, olus=1)) + "\n")
        yazilan = 0
        while yazilan < 20 * 1024 * 1024:
            f.write(dolgu_s + "\n")
            yazilan += len(dolgu_s) + 1
        f.write(json.dumps(asistan(3, inp=9, okuma=900, olus=90, model="claude-son",
                                   ts="2026-11-08T23:59:59.000Z")) + "\n")
        f.write(json.dumps(tool_result(4)) + "\n")
    assert tp.stat().st_size >= 20 * 1024 * 1024
    t0 = time.perf_counter()
    s = son_istek_bilgisi(tp)
    gecen = time.perf_counter() - t0
    assert s == {"son_baglam": 999, "son_model": "claude-son", "son_zaman": "2026-11-08T23:59:59.000Z"}
    assert gecen < 1.0


# ---- maskele ----

@pytest.mark.parametrize("gizli", [
    "sk-ant-api03-" + "Ab12Cd34" * 6,
    "sk-" + "a1B2c3D4" * 6,
    "ghp_" + "A1b2C3d4E5" * 4,
    "github_pat_" + "11ABCDEFG0" + "x" * 40,
    "AIza" + "SyD-" + "abcdEFGH12" * 3 + "xy",
    "xoxb-1234567890-0987654321-" + "AbCdEfGhIjKl",
    "0123456789abcdef" * 3,
    "QWxhZGRpbjpvcGVuIHNlc2FtZQ" * 2 + "AAAA",
])
def test_maskele_anahtarlar(gizli):
    cikti = maskele(f"basla {gizli} bitir")
    assert gizli not in cikti
    assert "[gizli]" in cikti
    assert cikti.startswith("basla ") and cikti.endswith(" bitir")


@pytest.mark.parametrize("metin,deger", [
    ("password=hunter2xyz", "hunter2xyz"),
    ("password: hunter2xyz", "hunter2xyz"),
    ("şifre: gizliKelime99", "gizliKelime99"),
    ("Şifre=gizliKelime99", "gizliKelime99"),
])
def test_maskele_parola_degerleri(metin, deger):
    cikti = maskele(metin)
    assert deger not in cikti
    assert "[gizli]" in cikti


def test_maskele_normal_turkce_degismez():
    for m in ["Bugün hava çok güzel, şifreleme konusunu yarın konuşalım.",
              "C:\\Proje\\src\\uygulama\\devir\\transcript.py dosyasını düzenle",
              "Ağaç, ığdır, öğrenci, ÜŞİĞÇÖ. 12 Kasım 2026'da toplantı var.",
              "", "kısa"]:
        assert maskele(m) == m


def test_maskele_birden_cok_ve_str_dondurur():
    c = maskele("a ghp_" + "Z9y8X7w6V5" * 4 + " b AIza" + "Sy" + "q" * 33 + " c")
    assert isinstance(c, str)
    assert c.count("[gizli]") == 2
    assert c.startswith("a ") and c.endswith(" c")


# ---- regresyon: sıkıştırma sınırı ----

def sinir_sistem(i):
    return {"parentUuid": None, "logicalParentUuid": "p", "isSidechain": False, "type": "system",
            "subtype": "compact_boundary", "content": "Conversation compacted", "isMeta": False,
            "timestamp": _ts(i), "uuid": f"cb{i}", "level": "info",
            "compactMetadata": {"trigger": "auto", "preTokens": 150000, "postTokens": 9000},
            "cwd": CWD, "sessionId": SID}


def sinir_ozet(i):
    d = kullanici("Bu oturum sıkıştırıldı; özet metni.", i)
    d["isCompactSummary"] = True
    d["isVisibleInTranscriptOnly"] = True
    return d


@pytest.mark.parametrize("sinir", [sinir_sistem, sinir_ozet])
def test_sikistirma_sonrasi_baglam_none(tp, sinir):
    yaz(tp, [kullanici("s", 1), asistan(2, inp=5, okuma=500, olus=50), sinir(3)])
    assert son_istek_bilgisi(tp) == {"son_baglam": None, "son_model": None, "son_zaman": None}
    assert oturum_ozeti(tp)["son_baglam"] is None


def test_sikistirma_iki_satir_birlikte(tp):
    yaz(tp, [kullanici("s", 1), asistan(2), sinir_sistem(3), sinir_ozet(4)])
    assert son_istek_bilgisi(tp)["son_baglam"] is None


@pytest.mark.parametrize("sinir", [sinir_sistem, sinir_ozet])
def test_sikistirma_sonrasi_yeni_assistant(tp, sinir):
    yaz(tp, [kullanici("s", 1), asistan(2, inp=5, okuma=500, olus=50), sinir(3),
             asistan(4, inp=1, okuma=20, olus=3, model="claude-yeni", ts="2026-11-08T11:00:00.000Z")])
    assert son_istek_bilgisi(tp) == {"son_baglam": 24, "son_model": "claude-yeni",
                                     "son_zaman": "2026-11-08T11:00:00.000Z"}
    assert oturum_ozeti(tp)["son_baglam"] == 24


def test_sikistirma_assistant_oncesindeyse_etkisiz(tp):
    yaz(tp, [kullanici("s", 1), sinir_sistem(2), asistan(3, inp=1, okuma=2, olus=3)])
    assert son_istek_bilgisi(tp)["son_baglam"] == 6


# ---- regresyon: maskele ek kalıplar ----

@pytest.mark.parametrize("metin,deger", [
    ("DB_PASSWORD=supersecret1", "supersecret1"),
    ("MY_SECRET=hunter2", "hunter2"),
    ("export GITHUB_TOKEN=abc123xyz", "abc123xyz"),
    ("postgres://admin:Hunter2pass@db.local/x", "Hunter2pass"),
    ("password is hunter2", "hunter2"),
    ("parolam 1234", "1234"),
    ("şifrem: xyz", "xyz"),
    ("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123 bitti", "eyJhbGciOiJIUzI1NiJ9"),
])
def test_maskele_ek_kaliplar(metin, deger):
    c = maskele(metin)
    assert deger not in c
    assert "[gizli]" in c


def test_maskele_baglanti_yapisi_korunur():
    c = maskele("postgres://admin:Hunter2pass@db.local/x")
    assert c.startswith("postgres://admin:") and c.endswith("@db.local/x")


@pytest.mark.parametrize("m", [
    r"C:\Proje\src\uygulama\devir\hook.py",
    "oturum_ozeti_icin_cok_uzun_snake_case_ad_ve_daha_fazlasi_burada",
    "son_istek_bilgisi fonksiyonu hook.py içinde çağrılır",
    "Parolayı sormadan önce şifre politikasını gözden geçirelim, yarın konuşuruz.",
    "Token sayısı bağlamın %80'ini geçti; secret sınıfı ayrı dosyada.",
])
def test_maskele_ek_kaliplar_degismez(m):
    assert maskele(m) == m


# ---- regresyon: IBAN / TCKN / kart / PIN ----

def _tckn_uret(taban="123456789"):
    d = [int(c) for c in taban]
    d10 = ((sum(d[0:9:2]) * 7) - sum(d[1:8:2])) % 10
    d.append(d10)
    d.append(sum(d) % 10)
    return "".join(map(str, d))


def _luhn_uret(govde):
    toplam = 0
    for i, c in enumerate(reversed(govde)):
        n = int(c)
        if i % 2 == 0:
            n *= 2
            if n > 9:
                n -= 9
        toplam += n
    return govde + str((10 - toplam % 10) % 10)


def _bozuk(sayi):
    return sayi[:-1] + str((int(sayi[-1]) + 1) % 10)


def test_yardimcilar_kendi_icinde_tutarli():
    t = _tckn_uret()
    assert len(t) == 11 and t[0] != "0"
    k = _luhn_uret("453201511283036")
    assert len(k) == 16 and k == "4532015112830366"  # bilinen Luhn test numarası


@pytest.mark.parametrize("iban", [
    "TR330006100519786457841326",
    "TR33 0006 1005 1978 6457 8413 26",
    "DE89370400440532013000",
    "DE89 3704 0044 0532 0130 00",
    "GB29NWBK60161331926819",
])
def test_maskele_iban(iban):
    c = maskele(f"hesap {iban} yatır")
    assert "[gizli]" in c
    assert iban.replace(" ", "")[4:] not in c.replace(" ", "")
    assert c.startswith("hesap ") and c.endswith(" yatır")


@pytest.mark.parametrize("tc", [_tckn_uret("123456789"), _tckn_uret("987654321"), _tckn_uret("100000001")])
def test_maskele_tckn_gecerli(tc):
    c = maskele(f"TC no {tc} dir")
    assert tc not in c
    assert "[gizli]" in c


@pytest.mark.parametrize("ayrac", ["", " ", "-"])
@pytest.mark.parametrize("govde", ["453201511283036", "411111111111111", "55555555555544"])
def test_maskele_luhn_kart(govde, ayrac):
    kart = _luhn_uret(govde)
    gosterim = ayrac.join(kart[i:i + 4] for i in range(0, len(kart), 4))
    c = maskele(f"kart {gosterim} son")
    assert kart not in c.replace(" ", "").replace("-", "")
    assert "[gizli]" in c
    assert c.startswith("kart ") and c.endswith(" son")


def test_maskele_15_haneli_luhn_kart():
    kart = _luhn_uret("37828224631000")  # 15 haneli (Amex biçimi)
    assert len(kart) == 15
    assert kart not in maskele(f"amex {kart}")


@pytest.mark.parametrize("metin,deger", [
    ("PIN 1234", "1234"),
    ("pin: 4821", "4821"),
    ("CVV 123", "123"),
    ("cvv=987", "987"),
    ("CVC: 123456", "123456"),
    ("PIN kodu 5678".replace("kodu ", ""), "5678"),
])
def test_maskele_pin_cvv(metin, deger):
    c = maskele(metin)
    assert deger not in c
    assert "[gizli]" in c


def test_maskele_pin_etiketi_korunur():
    assert maskele("CVV 123").lower().startswith("cvv")


@pytest.mark.parametrize("m", [
    _bozuk(_tckn_uret("123456789")),
    "12345678901",
    "11111111112",
    _bozuk(_luhn_uret("453201511283036")),
    "1234567890123456",
    "tarih 2026-11-08 tamam",
    "2026-11-08",
    "token sayısı 300K",
    "v3.12.0",
    "sürüm v3.12.0 yayında",
    "commit a7ce749",
    "a7ce749",
    "12 dosya, 3 hata, 4096 bayt, 80 karakter",
    "5 saat 30 dakika",
])
def test_maskele_yanlis_pozitif_yok(m):
    assert maskele(m) == m


# ---- regresyon: Türkçe PIN/CVV ifadeleri ve tarih çiftleri ----

@pytest.mark.parametrize("metin,deger", [
    ("Ziraat kartının PIN kodu 4821", "4821"),
    ("PIN kodum 4821", "4821"),
    ("PIN numaram 4821", "4821"),
    ("CVV'si 123", "123"),
    ("güvenlik kodu (CVV) 123", "123"),
    ("kartın şifresi 4821", "4821"),
])
def test_maskele_turkce_pin_cvv_ifadeleri(metin, deger):
    c = maskele(metin)
    assert deger not in c
    assert "[gizli]" in c


@pytest.mark.parametrize("m", [
    "2025-01-02 2025-01-09 arası staj",
    "2023 2024 2025 2026 yıllarında",
])
def test_maskele_tarih_ve_yil_dizileri_degismez(m):
    assert maskele(m) == m


def test_maskele_2025_hafta_basi_tarih_ciftleri_degismez():
    import datetime
    gun = datetime.date(2025, 1, 1)
    ciftler = []
    while gun.year == 2025:
        sonraki = gun + datetime.timedelta(days=7)
        ciftler.append(f"{gun.isoformat()} {sonraki.isoformat()}")
        gun = sonraki
    assert len(ciftler) >= 52
    bozulan = [c for c in ciftler if maskele(c) != c]
    assert bozulan == []


def test_maskele_luhn_kart_4_4_4_4_hala_maskelenir():
    for govde in ["453201511283036", "411111111111111"]:
        kart = _luhn_uret(govde)
        g = " ".join(kart[i:i + 4] for i in range(0, 16, 4))
        c = maskele(f"kart {g}")
        assert kart not in c.replace(" ", "")
        assert "[gizli]" in c
