"""Onceki-harita-kapisi hook'unun testleri (yalniz sozlesmeden; gercek surec olarak)."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
HOOK = str(REPO / "src" / "bellek" / "kapi" / "hook.py")
SID = "oturum-1"


# --------------------------------------------------------------------------- yardimcilar
@pytest.fixture
def durum(tmp_path):
    d = tmp_path / "durum"
    d.mkdir()
    return d


def uret_md(yol: Path, *, baslik: int = 6, govde: int = 60, crlf: bool = False,
            ad: str = "Bölüm", bom: bool = False) -> list[int]:
    """Buyuk bir md yazar; baslik satir numaralarini (1 tabanli) dondurur."""
    satirlar: list[str] = []
    basliklar: list[int] = []
    for i in range(baslik):
        satirlar.append(f"## {ad} {i + 1}")
        basliklar.append(len(satirlar))
        for j in range(govde):
            satirlar.append(f"Bu, {i + 1}. bölümün {j + 1}. satırı; dolgu metni dolgu metni dolgu.")
    ayrac = "\r\n" if crlf else "\n"
    yol.write_bytes((ayrac.join(satirlar) + ayrac).encode("utf-8-sig" if bom else "utf-8"))
    return basliklar


def toplam_satir(yol: Path) -> int:
    return len(yol.read_bytes().decode("utf-8-sig").splitlines())


def payload(yol, *, sid=SID, agent=None, offset=None, limit=None, tool="Read", ekle_sinirlar=True,
            cwd="C:\\proje"):
    ti: dict = {"file_path": str(yol)}
    if ekle_sinirlar:
        ti["offset"] = offset
        ti["limit"] = limit
    p = {"session_id": sid, "transcript_path": "C:\\x\\t.jsonl", "cwd": str(cwd),
         "permission_mode": "bypassPermissions", "hook_event_name": "PreToolUse",
         "tool_name": tool, "tool_input": ti, "tool_use_id": "toolu_1"}
    if agent is not None:
        p["agent_id"] = agent
        p["agent_type"] = "general-purpose"
    return p


def ortam(durum, **ek):
    env = dict(os.environ)
    for k in list(env):
        if k.startswith("BELLEK_KAPI"):
            del env[k]
    env["BELLEK_KAPI_STATE"] = str(durum)
    env.update({k: str(v) for k, v in ek.items()})
    return env


def calistir(durum, p=None, *, ham=None, **ek):
    girdi = ham if ham is not None else json.dumps(p).encode("utf-8")
    return subprocess.run([sys.executable, "-I", "-S", HOOK], input=girdi,
                          env=ortam(durum, **ek), capture_output=True, timeout=15)


def karar(r):
    """Cikis kodu 0'i dogrular; ret ise sozlugu, izin ise None dondurur."""
    assert r.returncode == 0, r.stderr.decode("utf-8", "replace")
    out = r.stdout.decode("utf-8")
    if not out.strip():
        return None
    assert len(out) <= 9000
    d = json.loads(out)
    h = d["hookSpecificOutput"]
    assert h["hookEventName"] == "PreToolUse"
    assert h["permissionDecision"] == "deny"
    assert isinstance(h["permissionDecisionReason"], str) and h["permissionDecisionReason"]
    return d


def ilet(durum, yol, **kw):
    ek = {k: kw.pop(k) for k in list(kw) if k.startswith("BELLEK_")}
    return karar(calistir(durum, payload(yol, **kw), **ek))


def sebep(d):
    return d["hookSpecificOutput"]["permissionDecisionReason"]


def kayitlar(durum):
    y = durum / "kapi.jsonl"
    if not y.exists():
        return []
    return [json.loads(s) for s in y.read_text(encoding="utf-8").splitlines() if s.strip()]


@pytest.fixture
def buyuk(tmp_path):
    y = tmp_path / "buyuk.md"
    uret_md(y)
    assert y.stat().st_size > 16384
    return y


# --------------------------------------------------------------------------- 1-4: izin yollari
def test_kapali_modu_her_seye_izin(durum, buyuk):
    for deger in ("kapali", "KAPALI"):
        assert ilet(durum, buyuk, BELLEK_KAPI=deger) is None
    assert kayitlar(durum) == []


def test_read_disi_arac_izin(durum, buyuk):
    for arac in ("Grep", "Write", "Bash", "Edit"):
        assert ilet(durum, buyuk, tool=arac) is None
    assert kayitlar(durum) == []


def test_md_olmayan_uzanti_izin(durum, tmp_path):
    y = tmp_path / "buyuk.txt"
    uret_md(y)
    assert ilet(durum, y) is None
    z = tmp_path / "buyuk.py"
    uret_md(z)
    assert ilet(durum, z) is None
    assert kayitlar(durum) == []


def test_dosya_yok_izin(durum, tmp_path):
    assert ilet(durum, tmp_path / "yok.md") is None
    assert kayitlar(durum) == []


def test_esik_alti_izin(durum, tmp_path):
    y = tmp_path / "kucuk.md"
    uret_md(y, baslik=5, govde=2)
    assert y.stat().st_size < 16384
    assert ilet(durum, y) is None
    assert kayitlar(durum) == []


def test_esik_ortam_degiskeni_kucuk_dosyayi_kapiya_sokar(durum, tmp_path):
    y = tmp_path / "kucuk.md"
    uret_md(y, baslik=5, govde=2)
    d = ilet(durum, y, BELLEK_KAPI_ESIK=100)
    assert d is not None
    assert [k["karar"] for k in kayitlar(durum)] == ["harita"]


def test_esik_tam_sinirda(durum, tmp_path):
    y = tmp_path / "s.md"
    uret_md(y, baslik=4, govde=3)
    b = y.stat().st_size
    assert ilet(durum, y, BELLEK_KAPI_ESIK=b + 1) is None  # boyut < ESIK degil -> kapi disi? (b < b+1)
    assert kayitlar(durum) == []
    assert ilet(durum, y, BELLEK_KAPI_ESIK=b) is not None  # b < b yanlis -> kapiya girer


@pytest.mark.parametrize("deger", ["abc", "", "-5", "1.5"])
def test_gecersiz_esik_varsayilana_doner(durum, buyuk, deger):
    assert ilet(durum, buyuk, BELLEK_KAPI_ESIK=deger) is not None  # 16384 varsayilan, dosya buyuk


def test_gecersiz_hedefli_varsayilana_doner(durum, buyuk):
    # varsayilan 80: limit=50 hedefli izin
    assert ilet(durum, buyuk, limit=50, offset=1, BELLEK_KAPI_HEDEFLI="xyz") is None
    assert kayitlar(durum)[-1]["karar"] == "hedefli"


# --------------------------------------------------------------------------- 5: hedefli
def test_hedefli_okuma_izin_ve_kayit(durum, buyuk):
    assert ilet(durum, buyuk, offset=10, limit=40) is None
    k = kayitlar(durum)
    assert len(k) == 1
    assert k[0]["karar"] == "hedefli"
    assert k[0]["aralik"] == [10, 49]
    assert k[0]["tekrar"] is False
    for alan in ("ts", "oturum", "ajan", "yol", "bayt"):
        assert alan in k[0]
    assert k[0]["oturum"] == SID
    assert k[0]["bayt"] == buyuk.stat().st_size


def test_hedefli_sinir_degerleri(durum, buyuk):
    assert ilet(durum, buyuk, offset=None, limit=80) is None
    assert kayitlar(durum)[-1]["karar"] == "hedefli"
    assert kayitlar(durum)[-1]["aralik"] == [1, 80]
    # 81 > varsayilan esik -> harita
    assert ilet(durum, buyuk, offset=None, limit=81) is not None


def test_hedefli_ortam_esigi(durum, buyuk):
    assert ilet(durum, buyuk, offset=1, limit=150, BELLEK_KAPI_HEDEFLI=150) is None
    assert kayitlar(durum)[-1]["karar"] == "hedefli"


@pytest.mark.parametrize("limit", [0, -3, "50", 2.5, True])
def test_gecersiz_limit_hedefli_sayilmaz(durum, buyuk, limit):
    # pozitif tam sayi degil -> kapi calisir (ilk istek ret)
    assert ilet(durum, buyuk, limit=limit) is not None


def test_hedefli_okuma_haritayi_gorulmus_saymaz(durum, buyuk):
    assert ilet(durum, buyuk, offset=1, limit=30) is None
    assert ilet(durum, buyuk) is not None  # ilk buyuk okuma yine ret
    assert [k["karar"] for k in kayitlar(durum)] == ["hedefli", "harita"]


# --------------------------------------------------------------------------- 6: az baslik
def test_az_baslik_izin(durum, tmp_path):
    y = tmp_path / "az.md"
    uret_md(y, baslik=2, govde=400)
    assert y.stat().st_size > 16384
    assert ilet(durum, y) is None
    k = kayitlar(durum)
    assert [x["karar"] for x in k] == ["az_baslik"]
    assert ilet(durum, y) is None  # hep izin


def test_ucuncu_baslik_kapiyi_acar(durum, tmp_path):
    y = tmp_path / "uc.md"
    uret_md(y, baslik=3, govde=200)
    assert ilet(durum, y) is not None


# --------------------------------------------------------------------------- 7-8: ret sonra izin
def test_ilk_istek_ret_ikinci_istek_izin(durum, buyuk):
    d = ilet(durum, buyuk)
    assert d is not None
    assert ilet(durum, buyuk) is None
    k = kayitlar(durum)
    assert [x["karar"] for x in k] == ["harita", "izin"]
    assert k[1]["aralik"] == [1, min(2000, toplam_satir(buyuk))]
    assert k[1]["tekrar"] is False
    for x in k:
        assert x["yol"] and x["bayt"] == buyuk.stat().st_size and x["ts"]


def test_izin_araligi_offset_limit_ve_toplam(durum, buyuk):
    ilet(durum, buyuk)  # harita
    top = toplam_satir(buyuk)
    assert ilet(durum, buyuk, offset=100, limit=200) is None
    assert kayitlar(durum)[-1]["aralik"] == [100, min(299, top)]
    assert ilet(durum, buyuk, offset=top - 10, limit=500) is None
    assert kayitlar(durum)[-1]["aralik"] == [top - 10, top]


def test_offset_limit_kapiyi_atlatmaz(durum, buyuk):
    d = ilet(durum, buyuk, offset=1, limit=200)
    assert d is not None
    assert kayitlar(durum)[-1]["karar"] == "harita"
    assert ilet(durum, buyuk, offset=1, limit=200) is None


def test_hedefli_sonrasi_buyuk_okuma_ret(durum, buyuk):
    assert ilet(durum, buyuk, offset=5, limit=20) is None
    assert ilet(durum, buyuk, offset=1, limit=500) is not None


def test_null_offset_limit_ve_anahtarsiz(durum, buyuk, tmp_path):
    assert ilet(durum, buyuk, offset=None, limit=None) is not None
    assert ilet(durum, buyuk, offset=None, limit=None) is None
    y2 = tmp_path / "b2.md"
    uret_md(y2)
    # offset/limit anahtarlari hic yok
    assert ilet(durum, y2, ekle_sinirlar=False) is not None
    assert ilet(durum, y2, ekle_sinirlar=False) is None


def test_dosya_basina_ayri_harita(durum, buyuk, tmp_path):
    y2 = tmp_path / "ikinci.md"
    uret_md(y2)
    assert ilet(durum, buyuk) is not None
    assert ilet(durum, y2) is not None
    assert ilet(durum, buyuk) is None
    assert ilet(durum, y2) is None


# --------------------------------------------------------------------------- ajan / oturum ayrimi
def test_ana_oturum_ve_iki_ajan_ayri_harita_alir(durum, buyuk):
    assert ilet(durum, buyuk) is not None                       # ana
    assert ilet(durum, buyuk, agent="ajan-A") is not None       # A
    assert ilet(durum, buyuk, agent="ajan-B") is not None       # B
    assert ilet(durum, buyuk) is None
    assert ilet(durum, buyuk, agent="ajan-A") is None
    assert ilet(durum, buyuk, agent="ajan-B") is None
    k = kayitlar(durum)
    assert [x["karar"] for x in k] == ["harita"] * 3 + ["izin"] * 3
    assert len({x["ajan"] for x in k}) == 3


def test_farkli_session_id_yeniden_harita_alir(durum, buyuk):
    assert ilet(durum, buyuk, sid="s-1") is not None
    assert ilet(durum, buyuk, sid="s-1") is None
    assert ilet(durum, buyuk, sid="s-2") is not None
    assert ilet(durum, buyuk, sid="s-2") is None


def test_durum_surecler_arasi_kalicidir(durum, buyuk):
    # her calistirma ayri surec; ikinci istek ancak diskteki durumdan gecebilir
    assert ilet(durum, buyuk) is not None
    assert ilet(durum, buyuk) is None


# --------------------------------------------------------------------------- tekrar / mtime
def test_tekrar_kapsanan_aralik(durum, buyuk):
    ilet(durum, buyuk)  # harita
    assert ilet(durum, buyuk, offset=1, limit=100) is None
    assert ilet(durum, buyuk, offset=10, limit=41) is None  # hedefli, kapsanmis
    k = kayitlar(durum)
    assert [x["karar"] for x in k] == ["harita", "izin", "hedefli"]
    assert k[1]["aralik"] == [1, 100] and k[1]["tekrar"] is False
    assert k[2]["aralik"] == [10, 50] and k[2]["tekrar"] is True


def test_tekrar_izin_kaydinda(durum, buyuk):
    ilet(durum, buyuk)
    assert ilet(durum, buyuk, offset=1, limit=90) is None
    assert ilet(durum, buyuk, offset=10, limit=81) is None  # 81 > 80 -> izin
    k = kayitlar(durum)
    assert [x["karar"] for x in k] == ["harita", "izin", "izin"]
    assert k[2]["aralik"] == [10, 90] and k[2]["tekrar"] is True


def test_kismen_ortusen_aralik_tekrar_degil(durum, buyuk):
    ilet(durum, buyuk)
    ilet(durum, buyuk, offset=1, limit=90)
    ilet(durum, buyuk, offset=50, limit=100)  # [50,149], 91..149 yeni
    assert kayitlar(durum)[-1]["tekrar"] is False


def test_tekrar_birlesim_kapsar(durum, buyuk):
    ilet(durum, buyuk)
    ilet(durum, buyuk, offset=1, limit=60)      # hedefli [1,60]
    ilet(durum, buyuk, offset=61, limit=60)     # hedefli [61,120]
    ilet(durum, buyuk, offset=40, limit=60)     # [40,99] birlesimde
    assert kayitlar(durum)[-1]["aralik"] == [40, 99]
    assert kayitlar(durum)[-1]["tekrar"] is True


def test_tekrar_ajan_bazli(durum, buyuk):
    ilet(durum, buyuk)
    ilet(durum, buyuk, offset=1, limit=60)
    ilet(durum, buyuk, agent="A")  # A'nin haritasi
    ilet(durum, buyuk, agent="A", offset=1, limit=60)
    assert kayitlar(durum)[-1]["tekrar"] is False  # ana'nin aralik gecmisi A'ya sayilmaz


def test_mtime_degisince_tekrar_false(durum, buyuk):
    ilet(durum, buyuk)
    ilet(durum, buyuk, offset=1, limit=60)
    ilet(durum, buyuk, offset=1, limit=60)
    assert kayitlar(durum)[-1]["tekrar"] is True
    st = buyuk.stat()
    os.utime(buyuk, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    ilet(durum, buyuk, offset=1, limit=60)
    assert kayitlar(durum)[-1]["tekrar"] is False


# --------------------------------------------------------------------------- .MD / .markdown
@pytest.mark.parametrize("ad", ["BUYUK.MD", "Not.Markdown", "x.markdown", "y.Md"])
def test_uzanti_buyuk_kucuk_harf_duyarsiz(durum, tmp_path, ad):
    y = tmp_path / ad
    uret_md(y)
    assert ilet(durum, y) is not None
    assert ilet(durum, y) is None


# --------------------------------------------------------------------------- harita icerigi
def _haritadan_basliklar(metin: str) -> list[tuple[int, int]]:
    return [(int(a), int(b)) for a, b in re.findall(r"satır (\d+)-(\d+)", metin)]


def test_ret_mesaji_turkce_harita_ve_offset(durum, buyuk):
    m = sebep(ilet(durum, buyuk))
    assert "offset" in m
    assert _haritadan_basliklar(m)
    assert "Ã" not in m and "\ufffd" not in m


@pytest.mark.parametrize("crlf", [False, True])
def test_satir_numaralari_gercek_basliklarla_eslesir(durum, tmp_path, crlf):
    y = tmp_path / "h.md"
    basliklar = uret_md(y, baslik=6, govde=60, crlf=crlf)
    assert y.stat().st_size > 16384
    top = toplam_satir(y)
    m = sebep(ilet(durum, y))
    aralik = _haritadan_basliklar(m)
    baslar = {a for a, _ in aralik}
    assert set(basliklar) <= baslar <= set(basliklar) | {1}
    for a, b in aralik:
        assert 1 <= a <= b <= top
    # her baslik kendi bolumunun basinda: [bas, sonraki_baslik-1] ya da dosya sonu
    sonlar = dict(aralik)
    for i, b in enumerate(basliklar):
        beklenen = (basliklar[i + 1] - 1) if i + 1 < len(basliklar) else top
        if b in sonlar:
            assert sonlar[b] == beklenen
    # harita satirlarinin hicbiri baslik olmayan bir satiri isaret etmez
    satirlar = y.read_bytes().decode("utf-8").splitlines()
    for a in baslar - {1}:
        assert satirlar[a - 1].startswith("## ")


def test_crlf_dosyada_ret_ve_izin_akisi(durum, tmp_path):
    y = tmp_path / "crlf.md"
    uret_md(y, crlf=True)
    assert ilet(durum, y) is not None
    assert ilet(durum, y) is None
    assert kayitlar(durum)[-1]["aralik"][1] == toplam_satir(y)


def test_turkce_karakterler_json_sonrasi_dogru(durum, tmp_path):
    y = tmp_path / "tr.md"
    uret_md(y, baslik=5, govde=60, ad="çğıöşü ÇĞİÖŞÜ Başlık")
    r = calistir(durum, payload(y))
    assert r.returncode == 0
    m = sebep(json.loads(r.stdout.decode("utf-8")))
    assert "çğıöşü ÇĞİÖŞÜ Başlık 1" in m
    assert "\\u" not in m and "Ã" not in m and "\ufffd" not in m


def test_500_uzun_baslikta_cikti_siniri(durum, tmp_path):
    y = tmp_path / "uzun.md"
    uret_md(y, baslik=500, govde=2, ad="Çok uzun Türkçe başlık ğüşiöç " * 3)
    r = calistir(durum, payload(y))
    assert r.returncode == 0
    out = r.stdout.decode("utf-8")
    assert 0 < len(out) <= 9000
    d = json.loads(out)
    m = sebep(d)
    assert "offset" in m
    assert "Çok uzun T" in m  # ilk basligin basi (cok uzun basliklar kisaltilabilir)
    assert _haritadan_basliklar(m)
    # sonraki istek yine izin
    assert ilet(durum, y) is None


def test_500_baslikta_satir_numaralari_gecerli(durum, tmp_path):
    y = tmp_path / "uzun2.md"
    basliklar = uret_md(y, baslik=500, govde=2, ad="Ğüşiöç başlık uzun uzun uzun uzun uzun")
    top = toplam_satir(y)
    m = sebep(ilet(durum, y))
    for a, b in _haritadan_basliklar(m):
        assert a in set(basliklar) | {1}
        assert a <= b <= top


# --------------------------------------------------------------------------- fail-open
BOZUK_GIRDILER = [
    b"", b"   ", b"not json at all", b"{bozuk", b"[1,2,3]", b"null", b"\xff\xfe\x00bozuk",
    b'{"tool_name": "Read"}',
    b'{"tool_name": "Read", "tool_input": "x"}',
    b'{"tool_name": "Read", "tool_input": {"file_path": 5}}',
    b'{"tool_name": "Read", "tool_input": {}}',
    # "Read" ve ".md" iceren ama bozuk / yanlis tipli girdiler (on elemeyi gecip korumalara ulasir)
    b'{"tool_name": "Read", "tool_input": ["a.md"]}',
    b'{"tool_name": "Read", "tool_input": {"file_path": ["a.md"]}}',
    b'{"tool_name": "Read", "tool_input": {"file_path": null}}',
    b'{"tool_name": "Read", "tool_input": {"file_path": 5, "x": ".md"}}',
    b'{"tool_name": "Read", "tool_input": {"file_path": ".md"}',  # kesik JSON
    b'{"tool_name": "Read", "tool_input": {"file_path": "C:\\\\x\\\\a.md", "limit": "Read"',
    b'["Read", "a.md"]',
    b'"Read a.md"',
    b'{"tool_name": ["Read"], "tool_input": {"file_path": "a.md"}}',
    b'{"tool_name": "Read", "tool_input": {"file_path": "a\\u0000b.md"}}',
    b'{"tool_name": "Read", "tool_input": {"file_path": "' + b"x" * 5000 + b'.md"}}',
]


@pytest.mark.parametrize("ham", BOZUK_GIRDILER)
def test_bozuk_girdi_fail_open(durum, ham):
    r = calistir(durum, ham=ham)
    assert r.returncode == 0
    assert r.stdout.strip() == b""
    assert kayitlar(durum) == []


@pytest.mark.parametrize("alan,deger", [
    ("offset", "x"), ("offset", [1]), ("offset", -5), ("offset", 1.5), ("offset", {"a": 1}),
    ("limit", "x"), ("limit", [1]), ("limit", {"a": 1}), ("limit", 10 ** 30),
])
def test_yanlis_tipli_offset_limit_oturumu_bozmaz(durum, buyuk, alan, deger):
    p = payload(buyuk)
    p["tool_input"][alan] = deger
    karar(calistir(durum, p))  # cikis 0; bos ya da gecerli ret


@pytest.mark.parametrize("alan,deger", [
    ("session_id", None), ("session_id", 5), ("session_id", ["a"]), ("agent_id", 5),
    ("agent_id", ["a"]), ("agent_id", {"a": 1}), ("cwd", 5), ("cwd", None),
])
def test_yanlis_tipli_ust_alanlar_oturumu_bozmaz(durum, buyuk, alan, deger):
    p = payload(buyuk)
    p[alan] = deger
    karar(calistir(durum, p))


def test_session_id_eksik_oturumu_bozmaz(durum, buyuk):
    p = payload(buyuk)
    del p["session_id"]
    karar(calistir(durum, p))


def test_md_adli_klasor_oturumu_bozmaz(durum, tmp_path):
    d = tmp_path / "klasor.md"
    d.mkdir()
    karar(calistir(durum, payload(d)))


def test_durum_yazilamazsa_asla_ret_yok(tmp_path, buyuk):
    dosya = tmp_path / "dosya_klasor_degil"
    dosya.write_text("x")
    p = payload(buyuk)
    for _ in range(2):  # yoksa her istek ret olur: sonsuz ret
        r = calistir(dosya / "alt", p)
        assert r.returncode == 0
        assert r.stdout == b""


def test_bozuk_durum_dosyalari_fail_open(durum, buyuk):
    assert ilet(durum, buyuk) is not None  # harita; olay dosyalari olustu
    olay = [f for f in (durum / "oturumlar").rglob("*") if f.is_file()]
    assert olay, "olay dosyalari <durum>/oturumlar/<sid>/<ajan>/ altinda bekleniyordu"
    for f in olay:
        f.write_bytes(b"\x00\xffbozuk{{{\n")
    (durum / "kapi.jsonl").write_bytes(b"bozuk satir\n{\n")
    for _ in range(2):
        karar(calistir(durum, payload(buyuk)))  # bos ya da gecerli ret, ama cokmez
    assert ilet(durum, buyuk, sid="taze") is not None  # baska oturum normal calisir


# --------------------------------------------------------------------------- temizlik / guvenlik / gunluk
def _disarisi(tmp_path: Path, durum: Path) -> set[str]:
    """tmp_path altinda durum kokunun DISINDA kalan her sey."""
    return {str(p.relative_to(tmp_path)) for p in tmp_path.rglob("*")
            if durum != p and durum not in p.parents}


def test_eski_oturum_klasoru_temizlenir(tmp_path, durum, buyuk):
    import time
    dis = tmp_path / "dokunma.txt"
    dis.write_text("x")
    kardes = tmp_path / "kardes"
    kardes.mkdir()
    (kardes / "a.txt").write_text("x")
    (durum / "baska_dosya.txt").write_text("koru")
    assert ilet(durum, buyuk, sid="eski") is not None
    eski = durum / "oturumlar" / "eski"
    assert eski.is_dir()
    eskitme = time.time() - 10 * 86400
    for p in [*eski.rglob("*"), eski]:
        os.utime(p, (eskitme, eskitme))
    assert ilet(durum, buyuk, sid="yeni") is not None  # temizligi tetikler
    assert not eski.exists()
    assert (durum / "oturumlar" / "yeni").is_dir()
    assert (durum / "baska_dosya.txt").read_text() == "koru"
    assert dis.exists() and (kardes / "a.txt").exists() and buyuk.exists()
    assert ilet(durum, buyuk, sid="eski") is not None  # silindi: yeniden harita


def test_yeni_oturum_klasoru_silinmez(durum, buyuk):
    assert ilet(durum, buyuk, sid="s1") is not None
    assert ilet(durum, buyuk, sid="s2") is not None
    assert (durum / "oturumlar" / "s1").is_dir()
    assert ilet(durum, buyuk, sid="s1") is None  # hala hatirlaniyor


@pytest.mark.parametrize("ajan", ["../x", "..\\..\\x", ":", "a/b", "C:\\evil", "..", ".", "a:b*?",
                                  "x" * 400])
def test_guvensiz_agent_id_durum_kokunun_disina_yazmaz(tmp_path, durum, buyuk, ajan):
    once = _disarisi(tmp_path, durum)
    karar(calistir(durum, payload(buyuk, agent=ajan)))
    assert _disarisi(tmp_path, durum) == once, "durum kokunun disinda yeni dosya olustu"


@pytest.mark.parametrize("sid", ["../x", "..\\..\\y", ":", "a/b"])
def test_guvensiz_session_id_durum_kokunun_disina_yazmaz(tmp_path, durum, buyuk, sid):
    once = _disarisi(tmp_path, durum)
    karar(calistir(durum, payload(buyuk, sid=sid)))
    assert _disarisi(tmp_path, durum) == once


def test_bom_li_dosyada_satir_numaralari(durum, tmp_path):
    y = tmp_path / "bom.md"
    basliklar = uret_md(y, bom=True)
    assert y.read_bytes().startswith(b"\xef\xbb\xbf")
    top = toplam_satir(y)
    m = sebep(ilet(durum, y))
    aralik = _haritadan_basliklar(m)
    assert {a for a, _ in aralik} == set(basliklar)  # 1. satirdaki BOM'lu baslik kacmaz
    assert dict(aralik)[basliklar[-1]] == top
    assert ilet(durum, y) is None
    assert kayitlar(durum)[-1]["aralik"] == [1, top]


def test_goreli_file_path_cwd_ile_cozulur(durum, tmp_path, buyuk):
    p = payload("buyuk.md", cwd=tmp_path)
    assert karar(calistir(durum, p)) is not None
    assert karar(calistir(durum, p)) is None
    k = kayitlar(durum)
    assert [x["karar"] for x in k] == ["harita", "izin"]
    assert ilet(durum, buyuk) is None  # mutlak yolla ayni dosya


def test_gunluk_yol_normcase_abspath(durum, buyuk):
    ilet(durum, buyuk)
    assert kayitlar(durum)[0]["yol"] == os.path.normcase(os.path.abspath(str(buyuk)))


def test_goreli_yol_gunlukte_mutlak(durum, tmp_path, buyuk):
    karar(calistir(durum, payload("buyuk.md", cwd=tmp_path)))
    assert kayitlar(durum)[0]["yol"] == os.path.normcase(os.path.abspath(str(buyuk)))


def test_harita_yalniz_dosya_adini_icerir(durum, buyuk):
    m = sebep(ilet(durum, buyuk))
    assert buyuk.name in m
    assert str(buyuk) not in m
    assert str(buyuk.parent) not in m


def test_tavan_ustu_dosya_izin_cok_buyuk(durum, buyuk):
    boyut = buyuk.stat().st_size
    assert ilet(durum, buyuk, BELLEK_KAPI_TAVAN=boyut - 1) is None
    assert ilet(durum, buyuk, BELLEK_KAPI_TAVAN=boyut - 1) is None
    k = kayitlar(durum)
    assert [x["karar"] for x in k] == ["cok_buyuk", "cok_buyuk"]
    assert k[0]["bayt"] == boyut
    assert ilet(durum, buyuk, BELLEK_KAPI_TAVAN=boyut) is not None  # tavan kapsiyorsa normal kapi


def test_gecersiz_tavan_varsayilana_doner(durum, buyuk):
    assert ilet(durum, buyuk, BELLEK_KAPI_TAVAN="abc") is not None  # 5_000_000 varsayilan


def test_gunluk_5mb_asilinca_doner(durum, buyuk):
    g = durum / "kapi.jsonl"
    satir = json.dumps({"ts": "x", "karar": "izin", "dolgu": "a" * 900}) + "\n"
    g.write_text(satir * (5_000_000 // len(satir) + 5), encoding="utf-8")
    eski_boyut = g.stat().st_size
    assert eski_boyut > 5_000_000
    assert ilet(durum, buyuk) is not None
    yedek = durum / "kapi.jsonl.1"
    assert yedek.exists() and yedek.stat().st_size == eski_boyut
    yeni = kayitlar(durum)
    assert len(yeni) == 1 and yeni[0]["karar"] == "harita"


def test_paralel_istekler_tam_bir_ret_subprocess(durum, buyuk):
    from concurrent.futures import ThreadPoolExecutor
    p = payload(buyuk)
    with ThreadPoolExecutor(6) as ex:
        sonuc = list(ex.map(lambda _: karar(calistir(durum, p)), range(6)))
    assert sum(1 for s in sonuc if s is not None) == 1
    _paralel_gunluk_dogrula(durum)


def _izin_olay_sayisi(durum, sid=SID, ajan="ana"):
    n = 0
    for f in (durum / "oturumlar" / sid / ajan).glob("*.jsonl"):
        for s in f.read_text(encoding="utf-8").splitlines():
            if s.strip() and json.loads(s).get("karar") == "izin":
                n += 1
    return n


def _paralel_gunluk_dogrula(durum):
    k = kayitlar(durum)
    assert len(k) == 6, "paralel isteklerden bazilarinin gunluk kaydi kayip"
    assert [x["karar"] for x in k].count("harita") == 1
    assert [x["karar"] for x in k].count("izin") == 5
    assert _izin_olay_sayisi(durum) == 5, "ajanin olay dosyasinda 5 izin satiri olmali"


def test_isaret_varsa_yeniden_ayristirilmaz(durum, buyuk):
    assert ilet(durum, buyuk) is not None
    # esigin ustunde kalir ama yalniz 2 baslik: ayristirilsaydi "az_baslik" olurdu
    uret_md(buyuk, baslik=2, govde=400)
    assert buyuk.stat().st_size > 16384
    assert ilet(durum, buyuk) is None
    assert kayitlar(durum)[-1]["karar"] == "izin"


# --------------------------------------------------------------------------- in-process
@pytest.fixture
def run_fn():
    src = str(REPO / "src")
    eklendi = src not in sys.path
    if eklendi:
        sys.path.insert(0, src)
    try:
        from bellek.kapi.hook import run
        yield run
    finally:
        if eklendi:
            sys.path.remove(src)


def test_run_ret_sozlugu_ve_none(run_fn, durum, buyuk):
    env = ortam(durum)
    d = run_fn(payload(buyuk), env=env)
    assert d is not None
    h = d["hookSpecificOutput"]
    assert h["hookEventName"] == "PreToolUse" and h["permissionDecision"] == "deny"
    assert "offset" in h["permissionDecisionReason"]
    assert run_fn(payload(buyuk), env=env) is None


def test_run_kapali_ve_diger_arac(run_fn, durum, buyuk):
    assert run_fn(payload(buyuk), env=ortam(durum, BELLEK_KAPI="kapali")) is None
    assert run_fn(payload(buyuk, tool="Bash"), env=ortam(durum)) is None


def test_run_paralel_tam_bir_ret(run_fn, durum, buyuk):
    from concurrent.futures import ThreadPoolExecutor
    env = ortam(durum)
    p = payload(buyuk)
    with ThreadPoolExecutor(6) as ex:
        sonuc = list(ex.map(lambda _: run_fn(p, env=env), range(6)))
    assert sum(1 for s in sonuc if s is not None) == 1
    _paralel_gunluk_dogrula(durum)
