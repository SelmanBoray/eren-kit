"""Arayüz uçları (/api/ui/*) güvenlik modeli ve `ac` CLI: gerçek alt süreç servisle uçtan uca (sözleşmeden).

Sözleşme: arayüz ayrı ad alanında (`/api/ui/*`), ayrı belirteçle (`X-Beyin-Arayuz`) çalışır;
ana belirteç (`X-Beyin-Token`) orada geçmez, arayüz belirteci ui dışı uçlarda geçmez.
Tarayıcı başlıkları (Origin, Sec-Fetch-Site, Host) ham `http.client` ile elle taklit edilir.
"""

from __future__ import annotations

import http.client
import json
import os
import socket
import sqlite3
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote

import pytest

from bellek.beyin import db
from tests._surec import YENI_OTURUM, agaci_oldur

SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "src"))

# Gövde işaretleri: ham yanıt baytlarında aranır (ASCII, FTS/normalize'dan etkilenmez).
OZEL_ISARET = "ozelgovdeisareti7731"
OZEL_COCUK_ISARET = "ozelcocukisareti4410"
OZEL_GELEN_ISARET = "ozelgelenisareti5520"
SIR_ISARET = "sirgovdeisareti9917"

GUVENLIK_BASLIKLARI = {
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
}
CSP_ZORUNLU = ("default-src 'none'", "frame-ancestors 'none'", "connect-src 'self'")


def bos_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


# ------------------------------------------------------------------ ortam / tohum


def _tohumla(yol: str) -> dict:
    con = db.baglan(yol)
    with con:
        kok = db.kok_id(con)
        muzik = db.dugum_ekle(con, "Müzik", ozet="müzik zevkleri", ebeveyn=kok)
        spor = db.dugum_ekle(con, "Spor", ozet="spor", ebeveyn=kok)
        zeybek = db.dugum_ekle(con, "Zeybekoloji", ozet="zeybek dansı üzerine", ebeveyn=muzik)
        db.olgu_ekle(con, zeybek, "Kullanıcı zeybekoloji dersini sever")
        db.kenar_ekle(con, spor, zeybek, "ilgili")
        ozel = db.dugum_ekle(con, "Özel", ozet=f"özel dal {OZEL_ISARET}",
                             ayrinti=f"ayrıntı {OZEL_ISARET}", ebeveyn=kok, gizlilik="ozel")
        db.olgu_ekle(con, ozel, f"özel olgu {OZEL_ISARET}")
        # kendisi normal ama atası ozel -> etkin gizlilik ozel
        gunluk = db.dugum_ekle(con, "Günlük", ozet=f"günlük {OZEL_COCUK_ISARET}", ebeveyn=ozel)
        kasa = db.dugum_ekle(con, "Kasa", ozet=f"kasa {SIR_ISARET}",
                             ayrinti=f"ayrıntı {SIR_ISARET}", ebeveyn=kok, gizlilik="sir_icerir")
        db.olgu_ekle(con, kasa, f"sır olgu {SIR_ISARET}")
        # kendisi normal ama atası sir -> etkin gizlilik sir
        altkasa = db.dugum_ekle(con, "Altkasa", ozet=f"alt {SIR_ISARET}", ebeveyn=kasa)
        db.olgu_ekle(con, altkasa, f"alt olgu {SIR_ISARET}")
        gelen_normal = db.gelen_ekle(con, "yeni_dugum", {
            "metin": "Kullanıcı ney üflemeyi öğrenmek istiyor", "baslik": "Ney",
            "ebeveyn": muzik, "adaylar": []})
        gelen_ozel = db.gelen_ekle(con, "olgu", {
            "metin": f"özel öneri {OZEL_GELEN_ISARET}", "baslik": None, "ebeveyn": ozel,
            "gizlilik": "ozel", "adaylar": []})
        gelen_sir = db.gelen_ekle(con, "olgu", {
            "metin": f"sır öneri {SIR_ISARET}", "baslik": None, "ebeveyn": kasa,
            "gizlilik": "sir_icerir", "adaylar": []})
    con.close()
    return dict(kok=kok, muzik=muzik, spor=spor, zeybek=zeybek, ozel=ozel, gunluk=gunluk,
                kasa=kasa, altkasa=altkasa, gelen_normal=gelen_normal, gelen_ozel=gelen_ozel,
                gelen_sir=gelen_sir)


def _ortam_kur(kok_dizin: Path) -> dict:
    yol = str(kok_dizin / "beyin.db")
    ids = _tohumla(yol)
    port = bos_port()
    yerel = kok_dizin / "yerel"  # sahte %LOCALAPPDATA%: gerçek Bellek klasörüne dokunulmaz
    yerel.mkdir()
    env = dict(os.environ)
    env.update(
        LOCALAPPDATA=str(yerel),
        BELLEK_BEYIN_DB=yol,
        BELLEK_BEYIN_PORT=str(port),
        BELLEK_BEYIN_KUYRUK=str(kok_dizin / "kuyruk.jsonl"),
        BELLEK_BEYIN_LOG=str(kok_dizin / "servis.log"),
        BELLEK_BEYIN_KOPRU_LOG=str(kok_dizin / "kopru.log"),
        BELLEK_BEYIN_TOKEN_DOSYA=str(kok_dizin / "token"),
        BELLEK_BEYIN_ARAYUZ_TOKEN_DOSYA=str(kok_dizin / "arayuz_token"),
        PYTHONPATH=SRC + os.pathsep + os.environ.get("PYTHONPATH", ""),
        PYTHONIOENCODING="utf-8",
    )
    return dict(ids, db=yol, port=port, env=env, kok_dizin=kok_dizin,
                token=str(kok_dizin / "token"), arayuz_token=str(kok_dizin / "arayuz_token"),
                surecler=[])


def _kapat(surecler: list) -> None:
    for p in surecler:
        agaci_oldur(p)
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill()
        for f in (p.stdin, p.stdout, p.stderr):
            try:
                if f:
                    f.close()
            except Exception:
                pass
    surecler.clear()


def _oku(yol: str) -> str:
    try:
        with open(yol, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def _servis_baslat(o: dict) -> dict:
    p = subprocess.Popen(
        [sys.executable, "-m", "bellek.beyin", "servis", "--port", str(o["port"])],
        env=o["env"], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **YENI_OTURUM,
    )
    o["surecler"].append(p)
    son = time.time() + 15
    while time.time() < son:
        if p.poll() is not None:
            raise AssertionError("servis erken çıktı: " + p.stderr.read().decode("utf-8", "replace"))
        try:
            if istek(o, "GET", "/api/saglik").kod == 200:
                break
        except Exception:
            pass
        time.sleep(0.2)
    else:
        raise AssertionError("servis 15 sn'de hazır olmadı")
    o["ana"] = _oku(o["token"])
    o["ui"] = _oku(o["arayuz_token"])
    return o


@pytest.fixture(scope="module")
def paylasilan(tmp_path_factory):
    """Yalnız okuma yapan testler için tek servis (hızlı)."""
    o = _ortam_kur(tmp_path_factory.mktemp("arayuz_paylasilan"))
    try:
        _servis_baslat(o)
        yield o
    finally:
        _kapat(o["surecler"])


@pytest.fixture()
def taze(tmp_path):
    """Yazma yapan / veritabanını denetleyen testler için kendi servisi."""
    o = _ortam_kur(tmp_path)
    try:
        _servis_baslat(o)
        yield o
    finally:
        _kapat(o["surecler"])


@pytest.fixture()
def kapali(tmp_path):
    """Servis başlatılmamış ortam."""
    o = _ortam_kur(tmp_path)
    try:
        yield o
    finally:
        _kapat(o["surecler"])


# ------------------------------------------------------------------ ham HTTP


@dataclass
class Yanit:
    kod: int
    basliklar: dict
    ham: bytes
    tum_basliklar: list = field(default_factory=list)

    def json(self):
        return json.loads(self.ham.decode("utf-8"))


_VARSAYILAN = object()


def istek(o: dict, yontem: str, yol: str, *, govde=None, ham: bytes | None = None,
          ui=_VARSAYILAN, ana=None, host=_VARSAYILAN, basliklar: dict | None = None) -> Yanit:
    """Başlıkları tam denetlenen istek.

    ui: arayüz belirteci (_VARSAYILAN = ortamdaki; None = gönderme; dize = o değer).
    ana: ana belirteç (None = gönderme; True = ortamdaki; dize = o değer).
    host: Host başlığı (_VARSAYILAN = 127.0.0.1:<port>; None = gönderme).
    basliklar: ek başlıklar (değer None ise o başlık gönderilmez).
    """
    b: dict = {}
    if host is _VARSAYILAN:
        b["Host"] = f"127.0.0.1:{o['port']}"
    elif host is not None:
        b["Host"] = host
    if ui is _VARSAYILAN:
        if o.get("ui"):
            b["X-Beyin-Arayuz"] = o["ui"]
    elif ui is not None:
        b["X-Beyin-Arayuz"] = ui
    if ana is True:
        b["X-Beyin-Token"] = o.get("ana", "")
    elif ana:
        b["X-Beyin-Token"] = ana
    veri = ham if ham is not None else (
        json.dumps(govde, ensure_ascii=False).encode("utf-8") if govde is not None else None)
    if veri is not None:
        b["Content-Type"] = "application/json"
        b["Content-Length"] = str(len(veri))
    for k, v in (basliklar or {}).items():
        b.pop(k, None)
        if v is not None:
            b[k] = v
    if not yol.isascii():
        yol = quote(yol, safe="/?&=%:;+")
    con = http.client.HTTPConnection("127.0.0.1", o["port"], timeout=10)
    try:
        con.putrequest(yontem, yol, skip_host=True, skip_accept_encoding=True)
        for k, v in b.items():
            con.putheader(k, v)
        con.endheaders(veri)
        r = con.getresponse()
        govde_ham = r.read()
        tum = r.getheaders()
        return Yanit(r.status, {k.lower(): v for k, v in tum}, govde_ham, tum)
    finally:
        con.close()


def ui_get(o: dict, yol: str, **kw) -> Yanit:
    return istek(o, "GET", yol, **kw)


def db_ozeti(yol: str) -> tuple:
    """Veritabanının yazma izleri: değişmediğini kanıtlamak için."""
    con = sqlite3.connect(yol)
    try:
        return (
            con.execute("SELECT coalesce(max(id),0), count(*) FROM gecmis").fetchone(),
            con.execute("SELECT count(*) FROM dugum").fetchone()[0],
            con.execute("SELECT count(*) FROM olgu").fetchone()[0],
            sorted(con.execute("SELECT id, durum FROM gelen").fetchall()),
            sorted(con.execute("SELECT id, surum, ozet, ayrinti FROM dugum").fetchall()),
        )
    finally:
        con.close()


def gecmis_imlec(yol: str) -> int:
    con = sqlite3.connect(yol)
    try:
        return con.execute("SELECT coalesce(max(id),0) FROM gecmis").fetchone()[0]
    finally:
        con.close()


def gelen_durumu(yol: str, gid: str) -> str:
    con = sqlite3.connect(yol)
    try:
        return con.execute("SELECT durum FROM gelen WHERE id = ?", (gid,)).fetchone()[0]
    finally:
        con.close()


# ------------------------------------------------------------------ 1. belirteç ve graf şekli


DUGUM_ALANLARI = {"id", "baslik", "tur", "durum", "gizlilik", "ozet", "tarih", "olusturma",
                  "guncelleme", "olgu_aktif", "olgu_eski", "ebeveyn", "derinlik", "kok_dal"}
KENAR_ALANLARI = {"ebeveyn", "cocuk", "tur", "birincil"}


def test_graf_arayuz_belirteciyle_ve_sozlesme_sekli(paylasilan):
    o = paylasilan
    r = ui_get(o, "/api/ui/graf")
    assert r.kod == 200, r.ham
    assert r.basliklar.get("content-type", "").startswith("application/json")
    g = r.json()
    assert {"imlec", "gelen_bekleyen", "kok", "dugumler", "kenarlar"} <= set(g)
    assert isinstance(g["imlec"], int) and g["imlec"] == gecmis_imlec(o["db"])
    assert g["gelen_bekleyen"] == 3
    assert g["kok"] == o["kok"]
    d = {x["id"]: x for x in g["dugumler"]}
    for x in g["dugumler"]:
        assert DUGUM_ALANLARI <= set(x), set(x)
        assert x["gizlilik"] in ("normal", "ozel", "sir_icerir")
    for k in ("kok", "muzik", "spor", "zeybek", "ozel", "gunluk", "kasa", "altkasa"):
        assert o[k] in d, k
    kok = d[o["kok"]]
    assert kok["derinlik"] == 0 and kok["ebeveyn"] is None and kok["kok_dal"] is None
    m = d[o["muzik"]]
    assert m["derinlik"] == 1 and m["ebeveyn"] == o["kok"] and m["kok_dal"] == o["muzik"]
    z = d[o["zeybek"]]
    assert z["derinlik"] == 2 and z["ebeveyn"] == o["muzik"] and z["kok_dal"] == o["muzik"]
    assert z["gizlilik"] == "normal" and z["ozet"] == "zeybek dansı üzerine"
    assert z["olgu_aktif"] == 1 and z["olgu_eski"] == 0
    # ozel: toplu uçta gövde yok
    assert d[o["ozel"]]["gizlilik"] == "ozel" and d[o["ozel"]]["ozet"] is None
    assert d[o["gunluk"]]["ozet"] is None  # etkin gizlilik ata zincirinden
    assert d[o["gunluk"]]["kok_dal"] == o["ozel"]
    # sir: gövde ve olgu sayısı yok
    for k in ("kasa", "altkasa"):
        x = d[o[k]]
        assert x["ozet"] is None and x["olgu_aktif"] is None and x["olgu_eski"] is None, k
    assert d[o["kasa"]]["gizlilik"] == "sir_icerir"
    kenarlar = g["kenarlar"]
    for k in kenarlar:
        assert KENAR_ALANLARI <= set(k) and k["tur"] in ("alt", "ilgili")
        assert isinstance(k["birincil"], bool)
    assert {"ebeveyn": o["muzik"], "cocuk": o["zeybek"], "tur": "alt", "birincil": True} in [
        {a: k[a] for a in KENAR_ALANLARI} for k in kenarlar]
    assert {"ebeveyn": o["spor"], "cocuk": o["zeybek"], "tur": "ilgili", "birincil": False} in [
        {a: k[a] for a in KENAR_ALANLARI} for k in kenarlar]


def test_graf_belirtecsiz_yanlis_ve_ana_belirtecle_401(paylasilan):
    o = paylasilan
    assert ui_get(o, "/api/ui/graf", ui=None).kod == 401
    assert ui_get(o, "/api/ui/graf", ui="0" * 64).kod == 401
    assert ui_get(o, "/api/ui/graf", ui="").kod == 401
    # ana belirteç ui ad alanında geçmez (ne tek başına ne de X-Beyin-Arayuz yerine)
    assert ui_get(o, "/api/ui/graf", ui=None, ana=True).kod == 401
    assert ui_get(o, "/api/ui/graf", ui=o["ana"]).kod == 401
    for yol in ("/api/ui/dugum?id=" + o["zeybek"], "/api/ui/ara?q=zeybek", "/api/ui/gecmis",
                "/api/ui/degisim?imlec=0", "/api/ui/gelen"):
        assert ui_get(o, yol, ui=None).kod == 401, yol
        assert ui_get(o, yol, ui=None, ana=True).kod == 401, yol


def test_belirtecler_farkli_ve_bicimli(paylasilan):
    o = paylasilan
    assert len(o["ui"]) >= 32 and all(c in "0123456789abcdef" for c in o["ui"])
    assert len(o["ana"]) >= 32
    assert o["ui"] != o["ana"]


# ------------------------------------------------------------------ 2. arayüz belirteci ui dışında geçmez


def test_arayuz_belirteci_ana_uclarda_reddedilir_ve_db_degismez(taze):
    o = taze
    once = db_ozeti(o["db"])
    yazlar = [
        ("POST", "/api/yaz", {"metin": "Kullanıcı saz çalmayı sever", "dugum_id": o["zeybek"]}),
        ("POST", "/api/duzelt", {"dugum_id": o["zeybek"], "ozet": "değiştirilmiş özet"}),
        ("POST", f"/api/gelen/{o['gelen_normal']}", {"karar": "red"}),
    ]
    for yontem, yol, govde in yazlar:
        r = istek(o, yontem, yol, govde=govde)  # yalnız X-Beyin-Arayuz
        assert r.kod in (401, 403), (yol, r.kod)
        # X-Beyin-Token yerine arayüz belirteci konursa da geçmez
        r = istek(o, yontem, yol, govde=govde, ui=None, ana=o["ui"])
        assert r.kod in (401, 403), (yol, r.kod)
    for yol in (f"/api/oku?id={o['zeybek']}", "/api/gelen", "/api/ara?q=zeybek",
                "/api/gez", "/api/disa-aktar?bicim=md"):
        assert istek(o, "GET", yol).kod in (401, 403), yol
        assert istek(o, "GET", yol, ui=None, ana=o["ui"]).kod in (401, 403), yol
    assert db_ozeti(o["db"]) == once
    # ana belirteç ui dışı uçlarda hâlâ çalışır (eski davranış)
    assert istek(o, "GET", f"/api/oku?id={o['zeybek']}", ui=None, ana=True).kod == 200


# ------------------------------------------------------------------ 3. Origin


def test_origin_kurallari_get(paylasilan):
    o = paylasilan
    p = o["port"]
    assert ui_get(o, "/api/ui/graf").kod == 200  # Origin yok
    assert ui_get(o, "/api/ui/graf", basliklar={"Origin": f"http://127.0.0.1:{p}"}).kod == 200
    # localhost Host'u: Origin tam "http://" + Host olmalı
    assert ui_get(o, "/api/ui/graf", host=f"localhost:{p}",
                  basliklar={"Origin": f"http://localhost:{p}"}).kod == 200
    assert ui_get(o, "/api/ui/graf", host=f"localhost:{p}",
                  basliklar={"Origin": f"http://127.0.0.1:{p}"}).kod == 403
    for kotu in (f"http://127.0.0.1:{p + 1}", f"https://127.0.0.1:{p}", "null",
                 "http://evil.example", f"http://127.0.0.1:{p}/", f"http://127.0.0.1",
                 f"http://localhost:{p}", ""):
        r = ui_get(o, "/api/ui/graf", basliklar={"Origin": kotu})
        assert r.kod == 403, (kotu, r.kod)
        assert b'"dugumler"' not in r.ham


def test_origin_kurallari_post(taze):
    o = taze
    p = o["port"]
    karar = {"id": o["gelen_normal"], "karar": "red"}
    for kotu in (f"http://127.0.0.1:{p + 1}", f"https://127.0.0.1:{p}", "null",
                 "http://evil.example"):
        r = istek(o, "POST", "/api/ui/gelen/karar", govde=karar, basliklar={"Origin": kotu})
        assert r.kod == 403, (kotu, r.kod)
    assert gelen_durumu(o["db"], o["gelen_normal"]) == "bekliyor"
    r = istek(o, "POST", "/api/ui/gelen/karar", govde=karar,
              basliklar={"Origin": f"http://127.0.0.1:{p}"})
    assert r.kod == 200, r.ham
    assert gelen_durumu(o["db"], o["gelen_normal"]) == "red"


def test_ui_disi_api_origin_hala_403(taze):
    o = taze
    p = o["port"]
    once = db_ozeti(o["db"])
    ayni = {"Origin": f"http://127.0.0.1:{p}"}
    assert istek(o, "GET", "/api/gelen", ui=None, ana=True, basliklar=ayni).kod == 403
    r = istek(o, "POST", "/api/yaz", ui=None, ana=True, basliklar=ayni,
              govde={"metin": "Kullanıcı origin olgusu sever", "dugum_id": o["zeybek"]})
    assert r.kod == 403
    assert db_ozeti(o["db"]) == once
    assert istek(o, "GET", "/api/gelen", ui=None, ana=True).kod == 200


# ------------------------------------------------------------------ 4. Sec-Fetch-Site


def test_sec_fetch_site(taze):
    o = taze
    for deger in ("cross-site", "same-site", "none"):
        assert ui_get(o, "/api/ui/graf", basliklar={"Sec-Fetch-Site": deger}).kod == 403, deger
        r = istek(o, "POST", "/api/ui/gelen/karar", basliklar={"Sec-Fetch-Site": deger},
                  govde={"id": o["gelen_normal"], "karar": "red"})
        assert r.kod == 403, deger
    assert gelen_durumu(o["db"], o["gelen_normal"]) == "bekliyor"
    r = ui_get(o, "/api/ui/graf", basliklar={"Sec-Fetch-Site": "same-origin",
                                            "Origin": f"http://127.0.0.1:{o['port']}"})
    assert r.kod == 200
    assert ui_get(o, "/api/ui/graf", basliklar={"Sec-Fetch-Site": "same-origin"}).kod == 200


# ------------------------------------------------------------------ 5. Host (DNS rebinding)


def test_host_rebinding_reddedilir(paylasilan):
    o = paylasilan
    p = o["port"]
    for host in ("evil.example", f"evil.example:{p}", f"127.0.0.1:{p + 1}", "127.0.0.1"):
        for yol in ("/", "/static/x", "/static/app.js", "/api/ui/graf", "/api/saglik"):
            r = istek(o, "GET", yol, host=host)
            if yol == "/api/saglik":
                assert r.kod != 200 or b"dugumler" not in r.ham
                continue
            assert r.kod == 403, (host, yol, r.kod)
    assert istek(o, "GET", "/api/ui/graf", host=None).kod in (400, 403)


# ------------------------------------------------------------------ 6. yol karışıklığı


def test_ui_ad_alani_yol_varyantlari_asla_200(paylasilan):
    o = paylasilan
    assert istek(o, "GET", "/api/ui").kod != 200
    for yol in ("/api/ui/yok", "/api/ui/", "/api/ui/graf/", "/api/ui//graf",
                "/api/ui/../yaz", "/api/ui/..%2fyaz", "/api/ui/..%2Fyaz", "/api/ui/%2e%2e/yaz",
                "/api/ui/%67raf", "/api/ui/graf%2f", "/api/ui/graf%00", "/api/ui/GRAF",
                "/API/UI/graf", "/api/ui/graf/..", "/api/ui/./graf", "/api/ui/%2e/graf",
                "/api/ui/gelen/karar/", "/api/ui/..%5cyaz"):
        for ana in (None, True):
            r = istek(o, "GET", yol, ana=ana)
            assert r.kod in (403, 404), (yol, ana, r.kod)
    # rota tablosunda olmayan yol yetkili istekte bile 404
    assert ui_get(o, "/api/ui/yok").kod == 404


def test_ui_yol_kacisi_yazmaz(taze):
    o = taze
    once = db_ozeti(o["db"])
    govde = {"metin": "Kullanıcı yol kaçışı olgusu kemençe", "dugum_id": o["zeybek"]}
    for yol in ("/api/ui/..%2fyaz", "/api/ui/../yaz", "/api/ui/%2e%2e/yaz", "/api/ui/..%2Fyaz",
                "/api/ui/..%5cyaz", "/api/ui/..%2fduzelt", "/api/ui/../duzelt",
                f"/api/ui/..%2fgelen%2f{o['gelen_normal']}", f"/api/ui/../gelen/{o['gelen_normal']}"):
        r = istek(o, "POST", yol, govde=dict(govde, ozet="kaçış özeti", karar="red"))
        assert r.kod in (403, 404), (yol, r.kod)
    assert db_ozeti(o["db"]) == once


# ------------------------------------------------------------------ 7. OPTIONS, CORS, güvenlik başlıkları


def _guvenlik_basliklari_var(r: Yanit, ne: str) -> None:
    csp = r.basliklar.get("content-security-policy", "")
    for parca in CSP_ZORUNLU:
        assert parca in csp, (ne, csp)
    for k, v in GUVENLIK_BASLIKLARI.items():
        assert r.basliklar.get(k, "").strip().lower() == v.lower(), (ne, k, r.basliklar.get(k))


def test_options_403_ve_cors_basligi_yok(paylasilan):
    o = paylasilan
    p = o["port"]
    for yol in ("/", "/api/ui/graf", "/api/ui/gelen/karar", "/api/yaz", "/api/saglik",
                "/static/app.js"):
        r = istek(o, "OPTIONS", yol, basliklar={
            "Origin": f"http://127.0.0.1:{p}", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-beyin-arayuz, content-type"})
        assert r.kod == 403, (yol, r.kod)
        assert not any(k.startswith("access-control-allow") for k in r.basliklar), yol
    yanitlar = [
        ui_get(o, "/api/ui/graf"),
        ui_get(o, "/api/ui/graf", basliklar={"Origin": f"http://127.0.0.1:{p}"}),
        ui_get(o, "/api/ui/graf", basliklar={"Origin": "http://evil.example"}),
        ui_get(o, "/api/ui/graf", ui=None),
        ui_get(o, "/api/ui/yok"),
        ui_get(o, "/"),
        ui_get(o, "/static/olmayan.js"),
        ui_get(o, "/api/saglik"),
        ui_get(o, "/api/ui/gelen"),
    ]
    for r in yanitlar:
        assert not any(k.startswith("access-control-") for k in r.basliklar), r.basliklar
        assert "set-cookie" not in r.basliklar


def test_guvenlik_basliklari(paylasilan):
    o = paylasilan
    _guvenlik_basliklari_var(ui_get(o, "/"), "/")
    _guvenlik_basliklari_var(ui_get(o, "/api/ui/graf"), "/api/ui/graf")
    # sözleşme: tüm yanıtlara (hata yanıtları dahil)
    _guvenlik_basliklari_var(ui_get(o, "/api/ui/graf", ui=None), "401")
    _guvenlik_basliklari_var(ui_get(o, "/api/ui/yok"), "404")
    _guvenlik_basliklari_var(ui_get(o, "/static/olmayan.js"), "statik 404")
    _guvenlik_basliklari_var(ui_get(o, "/api/ui/graf", basliklar={"Origin": "null"}), "403")
    _guvenlik_basliklari_var(ui_get(o, "/api/saglik"), "/api/saglik")
    r = ui_get(o, "/")
    assert r.basliklar.get("cross-origin-resource-policy", "").lower() == "same-origin"
    csp = r.basliklar.get("content-security-policy", "")
    assert "unsafe-inline" not in csp and "unsafe-eval" not in csp


# ------------------------------------------------------------------ 8. belirteç sızıntısı


def test_belirtecler_yanit_govdelerinde_yok(paylasilan):
    o = paylasilan
    yollar = ["/", "/api/saglik", "/api/ui/graf", f"/api/ui/dugum?id={o['zeybek']}&ac=1",
              f"/api/ui/dugum?id={o['ozel']}&ac=1", "/api/ui/ara?q=zeybek", "/api/ui/gecmis",
              "/api/ui/degisim?imlec=0", "/api/ui/gelen", f"/api/ui/gelen?ac={o['gelen_ozel']}",
              "/api/ui/yok", "/static/app.js", "/static/index.html"]
    for yol in yollar:
        for ui in (_VARSAYILAN, None):
            r = istek(o, "GET", yol, ui=ui)
            for t in (o["ui"], o["ana"]):
                assert t.encode() not in r.ham, yol
                assert not any(t in str(v) for _, v in r.tum_basliklar), yol


# ------------------------------------------------------------------ 9. gelen kararı


def test_gelen_karar(taze):
    o = taze
    yol = "/api/ui/gelen/karar"
    govde = {"id": o["gelen_normal"], "karar": "kabul", "duzeltme": {"dugum_id": o["zeybek"]}}
    for tur in ("text/plain", "application/x-www-form-urlencoded", "multipart/form-data", None):
        r = istek(o, "POST", yol, govde=govde, basliklar={"Content-Type": tur})
        assert r.kod == 415, (tur, r.kod)
    assert gelen_durumu(o["db"], o["gelen_normal"]) == "bekliyor"

    once = ui_get(o, "/api/ui/graf").json()["gelen_bekleyen"]
    assert once == 3
    r = istek(o, "POST", yol, govde=govde)
    assert r.kod == 200, r.ham
    g = r.json()
    assert "sonuc" in g and g["gelen_bekleyen"] == once - 1
    assert gelen_durumu(o["db"], o["gelen_normal"]) == "kabul"
    assert ui_get(o, "/api/ui/graf").json()["gelen_bekleyen"] == once - 1
    con = sqlite3.connect(o["db"])
    try:
        assert con.execute("SELECT count(*) FROM olgu WHERE dugum = ? AND metin LIKE '%ney%'",
                           (o["zeybek"],)).fetchone()[0] == 1
    finally:
        con.close()
    gid = {x["id"] for x in ui_get(o, "/api/ui/gelen").json()["gelen"]}
    assert o["gelen_normal"] not in gid

    r = istek(o, "POST", yol, govde=govde)  # aynı karar ikinci kez
    assert r.kod == 400, r.kod
    r = istek(o, "POST", yol, govde={"id": "olmayan-gelen-id", "karar": "red"})
    assert r.kod == 404, r.kod
    r = istek(o, "POST", yol, govde={"id": o["gelen_ozel"], "karar": "belki"})
    assert r.kod == 400, r.kod
    r = istek(o, "POST", yol, ham=b"{bozuk json")
    assert r.kod == 400
    assert gelen_durumu(o["db"], o["gelen_ozel"]) == "bekliyor"
    r = istek(o, "POST", yol, govde={"id": o["gelen_ozel"], "karar": "red"})
    assert r.kod == 200 and r.json()["gelen_bekleyen"] == once - 2
    # karar ucu GET'le çalışmaz, ana belirteçle de çalışmaz
    assert ui_get(o, yol).kod in (404, 405)
    r = istek(o, "POST", yol, ui=None, ana=True, govde={"id": o["gelen_sir"], "karar": "red"})
    assert r.kod == 401
    assert gelen_durumu(o["db"], o["gelen_sir"]) == "bekliyor"


# ------------------------------------------------------------------ 10. gizlilik


def test_dugum_ozel_kilitli_ve_acilir(paylasilan):
    o = paylasilan
    r = ui_get(o, f"/api/ui/dugum?id={o['ozel']}")
    assert r.kod == 200
    d = r.json()
    assert d["kilitli"] is True and d["ozet"] is None and d["ayrinti"] is None and d["olgular"] == []
    assert OZEL_ISARET.encode() not in r.ham
    assert ui_get(o, f"/api/ui/dugum?id={o['ozel']}&ac=0").json()["kilitli"] is True
    r = ui_get(o, f"/api/ui/dugum?id={o['ozel']}&ac=1")
    assert r.kod == 200
    d = r.json()
    assert d["kilitli"] is False and OZEL_ISARET in d["ozet"] and OZEL_ISARET in d["ayrinti"]
    assert any(OZEL_ISARET in x["metin"] for x in d["olgular"])
    assert [y["id"] for y in d["yol"]] == [o["kok"], o["ozel"]]
    # etkin gizlilik: atası ozel olan normal düğüm de kilitli
    r = ui_get(o, f"/api/ui/dugum?id={o['gunluk']}")
    assert r.json()["kilitli"] is True and OZEL_COCUK_ISARET.encode() not in r.ham
    r = ui_get(o, f"/api/ui/dugum?id={o['gunluk']}&ac=1")
    assert r.json()["kilitli"] is False and OZEL_COCUK_ISARET.encode() in r.ham


def test_dugum_normal_sekli(paylasilan):
    o = paylasilan
    d = ui_get(o, f"/api/ui/dugum?id={o['zeybek']}").json()
    assert {"id", "baslik", "tur", "durum", "gizlilik", "tarih", "olusturma", "guncelleme", "yol",
            "ozet", "ayrinti", "olgular", "cocuklar", "ilgili", "kilitli"} <= set(d)
    assert d["kilitli"] is False and d["ozet"] == "zeybek dansı üzerine"
    assert [y["id"] for y in d["yol"]] == [o["kok"], o["muzik"], o["zeybek"]]
    assert len(d["olgular"]) == 1 and d["olgular"][0]["durum"] == "aktif"
    assert "zeybekoloji" in d["olgular"][0]["metin"]


def test_sir_govdesi_hicbir_ui_yanitinda_yok(paylasilan):
    o = paylasilan
    yollar = ["/api/ui/graf", "/api/ui/gecmis", "/api/ui/gecmis?limit=1000",
              "/api/ui/degisim?imlec=0", "/api/ui/gelen",
              f"/api/ui/gelen?ac={o['gelen_sir']}", "/api/ui/ara?q=kasa", "/api/ui/ara?q=alt",
              f"/api/ui/ara?q={SIR_ISARET}", "/api/ui/ara?q=olgu"]
    for k in ("kasa", "altkasa"):
        for ac in ("", "&ac=0", "&ac=1"):
            yollar.append(f"/api/ui/dugum?id={o[k]}{ac}")
    for yol in yollar:
        r = ui_get(o, yol)
        assert r.kod == 200, (yol, r.kod)
        assert SIR_ISARET.encode() not in r.ham, yol
    for k in ("kasa", "altkasa"):
        d = ui_get(o, f"/api/ui/dugum?id={o[k]}&ac=1").json()
        assert d["kilitli"] is True and d["ozet"] is None and d["ayrinti"] is None
        assert d["olgular"] == []
    g = ui_get(o, f"/api/ui/gelen?ac={o['gelen_sir']}").json()["gelen"]
    s = [x for x in g if x["id"] == o["gelen_sir"]]
    assert s and s[0]["kilitli"] is True and s[0]["metin"] is None


def test_ozel_govdesi_toplu_uclarda_yok(paylasilan):
    o = paylasilan
    for yol in ("/api/ui/graf", "/api/ui/gecmis", "/api/ui/degisim?imlec=0", "/api/ui/gelen",
                "/api/ui/ara?q=özel", "/api/ui/ara?q=günlük", f"/api/ui/ara?q={OZEL_ISARET}"):
        r = ui_get(o, yol)
        assert r.kod == 200, (yol, r.kod)
        for isaret in (OZEL_ISARET, OZEL_COCUK_ISARET, OZEL_GELEN_ISARET):
            assert isaret.encode() not in r.ham, (yol, isaret)
    for x in ui_get(o, "/api/ui/gecmis").json()["olaylar"]:
        if x.get("gizlilik") != "normal":
            assert x["ozet"] is None
    g = {x["id"]: x for x in ui_get(o, "/api/ui/gelen").json()["gelen"]}
    assert g[o["gelen_ozel"]]["kilitli"] is True and g[o["gelen_ozel"]]["metin"] is None
    assert g[o["gelen_normal"]]["kilitli"] is False
    assert "ney" in (g[o["gelen_normal"]]["metin"] or "")
    r = ui_get(o, f"/api/ui/gelen?ac={o['gelen_ozel']}")
    g = {x["id"]: x for x in r.json()["gelen"]}
    assert g[o["gelen_ozel"]]["kilitli"] is False
    assert OZEL_GELEN_ISARET in (g[o["gelen_ozel"]]["metin"] or "")
    assert b"oneri_json" not in r.ham


def test_hatali_parametreler(paylasilan):
    o = paylasilan
    assert ui_get(o, "/api/ui/dugum?id=yok-boyle-dugum").kod == 404
    assert ui_get(o, "/api/ui/gecmis?limit=abc").kod == 400
    assert ui_get(o, "/api/ui/gecmis?sonra=abc").kod == 400
    assert ui_get(o, "/api/ui/degisim?imlec=abc").kod == 400
    assert ui_get(o, "/api/ui/ara?q=zeybek&k=abc").kod == 400
    r = ui_get(o, "/api/ui/gecmis?limit=abc")
    assert "hata" in r.json()


def test_gecmis_sayfalama(paylasilan):
    o = paylasilan
    g = ui_get(o, "/api/ui/gecmis?limit=3").json()
    assert len(g["olaylar"]) == 3 and isinstance(g["sonraki"], int)
    ids = [x["id"] for x in g["olaylar"]]
    assert ids == sorted(ids)
    g2 = ui_get(o, f"/api/ui/gecmis?sonra={g['sonraki']}&limit=1000").json()
    assert g2["sonraki"] is None
    assert all(x["id"] > ids[-1] for x in g2["olaylar"])
    assert len(g["olaylar"]) + len(g2["olaylar"]) == gecmis_imlec(o["db"])
    for x in g["olaylar"] + g2["olaylar"]:
        assert {"id", "zaman", "islem", "tablo", "hedef_id", "dugum_id", "baslik", "gizlilik",
                "ozet"} <= set(x)
        assert x["ozet"] is None or (isinstance(x["ozet"], str) and len(x["ozet"]) <= 160)
        assert "eski_json" not in x and "yeni_json" not in x


# ------------------------------------------------------------------ 11. degisim


def test_degisim_yazinca_olay_gelir(taze):
    o = taze
    graf = ui_get(o, "/api/ui/graf").json()
    imlec = graf["imlec"]
    d = ui_get(o, f"/api/ui/degisim?imlec={imlec}").json()
    assert d["olaylar"] == [] and d["imlec"] == imlec and d["yeniden_yukle"] is False
    assert d["gelen_bekleyen"] == 3
    r = istek(o, "POST", "/api/yaz", ui=None, ana=True,
              govde={"metin": "Kullanıcı kaval çalmayı sever", "dugum_id": o["zeybek"]})
    assert r.kod == 200, r.ham
    d = ui_get(o, f"/api/ui/degisim?imlec={imlec}").json()
    assert d["imlec"] > imlec and d["yeniden_yukle"] is False
    assert d["olaylar"], d
    assert all(x["id"] > imlec for x in d["olaylar"])
    olgu_olaylari = [x for x in d["olaylar"] if x["tablo"] == "olgu"]
    assert olgu_olaylari and olgu_olaylari[0]["dugum_id"] == o["zeybek"]
    assert olgu_olaylari[0]["gizlilik"] == "normal"
    assert isinstance(olgu_olaylari[0]["ozet"], str) and olgu_olaylari[0]["ozet"]
    assert len(olgu_olaylari[0]["ozet"]) <= 160
    # yeni imleçten sonra yine boş
    d2 = ui_get(o, f"/api/ui/degisim?imlec={d['imlec']}").json()
    assert d2["olaylar"] == [] and d2["imlec"] == d["imlec"]


# ------------------------------------------------------------------ 12. CLI `ac`


def _ac(o: dict, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-m", "bellek.beyin", "ac", *args], env=o["env"],
                          stdin=subprocess.DEVNULL, capture_output=True, timeout=30)


def test_cli_ac_yazdir(paylasilan):
    o = paylasilan
    p = _ac(o, "--port", str(o["port"]), "--yazdir")
    assert p.returncode == 0, p.stderr.decode("utf-8", "replace")
    assert p.stdout.decode("utf-8").strip() == f"http://127.0.0.1:{o['port']}/#t={o['ui']}"
    assert o["ana"] not in p.stdout.decode("utf-8")
    # port BELLEK_BEYIN_PORT'tan
    p = _ac(o, "--yazdir")
    assert p.returncode == 0
    assert p.stdout.decode("utf-8").strip() == f"http://127.0.0.1:{o['port']}/#t={o['ui']}"
    # belirteç değişmedi (CLI mevcut dosyayı okur)
    assert _oku(o["arayuz_token"]) == o["ui"]


def test_cli_ac_kapali_port_cikis_1(kapali):
    o = kapali
    port = bos_port()
    p = _ac(o, "--port", str(port), "--yazdir")
    assert p.returncode == 1
    assert "#t=" not in p.stdout.decode("utf-8", "replace")
    assert p.stderr.decode("utf-8", "replace").strip()


# ------------------------------------------------------------------ 13. statik


def test_statik(paylasilan):
    o = paylasilan
    r = ui_get(o, "/static/olmayan.js")
    assert r.kod == 404
    r = ui_get(o, "/", ui=None)
    assert r.kod == 200
    assert r.basliklar.get("content-type", "").startswith("text/html")
    assert b"<" in r.ham and b"html" in r.ham.lower()
    for yol in ("/static/../../pyproject.toml", "/static/..%2f..%2fpyproject.toml"):
        r = ui_get(o, yol, ui=None)
        assert r.kod != 200 and b"[project]" not in r.ham


def test_pwa_manifest_ve_ikon(paylasilan):
    """iPhone/iPad ana ekranına eklenebilmesi için manifest + apple-touch-icon sunulur ve CSP izin verir."""
    import json as _json
    o = paylasilan
    r = ui_get(o, "/static/manifest.webmanifest", ui=None)
    assert r.kod == 200
    assert r.basliklar.get("content-type", "").startswith("application/manifest+json")
    m = _json.loads(r.ham.decode("utf-8"))
    assert m["display"] == "standalone" and m["start_url"] == "/"
    for ikon in m["icons"]:
        ri = ui_get(o, ikon["src"], ui=None)
        assert ri.kod == 200 and ri.basliklar.get("content-type") == "image/png"
        assert ri.ham[:8] == b"\x89PNG\r\n\x1a\n"
    sayfa = ui_get(o, "/", ui=None)
    assert b'rel="manifest"' in sayfa.ham and b'rel="apple-touch-icon"' in sayfa.ham
    assert "manifest-src 'self'" in sayfa.basliklar.get("content-security-policy", "")


# ------------------------------------------------------------------ 9b. gelen kararı: duzeltme biçimi (regresyon)
# Sözleşme: duzeltme ya null, ya tam {"dugum_id": str}, ya tam {"ebeveyn": str, "baslik": str};
# başka anahtar, yanlış tür ya da boş değer -> 400 ve veritabanı değişmez.

KARAR_YOLU = "/api/ui/gelen/karar"


def _db_dokumu(yol: str) -> str:
    con = sqlite3.connect(yol)
    try:
        return "\n".join(con.iterdump())
    finally:
        con.close()


def _ham_db_baytlari(yol: str) -> bytes:
    ham = b""
    for ek in ("", "-wal", "-journal"):
        try:
            with open(yol + ek, "rb") as f:
                ham += f.read()
        except OSError:
            pass
    return ham


def test_gelen_karar_duzeltme_fazla_anahtar_metin_enjekte_edemez(taze):
    o = taze
    once = db_ozeti(o["db"])
    isaret = "ENJEKTE_x"
    r = istek(o, "POST", KARAR_YOLU, govde={
        "id": o["gelen_normal"], "karar": "kabul",
        "duzeltme": {"dugum_id": o["zeybek"], "metin": isaret}})
    assert r.kod == 400, (r.kod, r.ham)
    assert db_ozeti(o["db"]) == once
    assert gelen_durumu(o["db"], o["gelen_normal"]) == "bekliyor"
    assert isaret not in _db_dokumu(o["db"])
    assert isaret.encode() not in _ham_db_baytlari(o["db"])
    for ac in ("", "&ac=1"):
        d = ui_get(o, f"/api/ui/dugum?id={o['zeybek']}{ac}")
        assert d.kod == 200 and isaret.encode() not in d.ham


def test_gelen_karar_duzeltme_gizlilik_yukseltilemez(taze):
    o = taze
    once = db_ozeti(o["db"])
    r = istek(o, "POST", KARAR_YOLU, govde={
        "id": o["gelen_ozel"], "karar": "kabul",
        "duzeltme": {"ebeveyn": o["muzik"], "baslik": "Sızıntı", "gizlilik": "normal"}})
    assert r.kod == 400, (r.kod, r.ham)
    assert db_ozeti(o["db"]) == once
    assert gelen_durumu(o["db"], o["gelen_ozel"]) == "bekliyor"
    g = {x["id"]: x for x in ui_get(o, "/api/ui/gelen").json()["gelen"]}
    assert g[o["gelen_ozel"]]["gizlilik"] == "ozel" and g[o["gelen_ozel"]]["kilitli"] is True
    for yol in ("/api/ui/graf", "/api/ui/gelen", "/api/ui/gecmis"):
        assert OZEL_GELEN_ISARET.encode() not in ui_get(o, yol).ham, yol


def test_ana_api_gelen_karar_ayni_duzeltme_suzgeci(taze):
    """Güvenlik denetimi B7: /api/gelen/<id> (ana belirteç) arayüz yoluyla aynı süzgeçten geçer;
    düzeltme önerinin metnini ya da gizliliğini değiştiremez, geçerli düzeltme çalışır."""
    o = taze
    once = db_ozeti(o["db"])
    isaret = "ENJEKTE_ana"
    for duz in ({"dugum_id": o["zeybek"], "metin": isaret},
                {"ebeveyn": o["muzik"], "baslik": "Sızıntı", "gizlilik": "normal"},
                {"metin": isaret}, [], {"dugum_id": ""}):
        r = istek(o, "POST", f"/api/gelen/{o['gelen_normal']}", ui=None, ana=True,
                  govde={"karar": "kabul", "duzeltme": duz})
        assert r.kod == 400, (duz, r.kod, r.ham)
    assert db_ozeti(o["db"]) == once
    assert gelen_durumu(o["db"], o["gelen_normal"]) == "bekliyor"
    assert isaret not in _db_dokumu(o["db"])
    r = istek(o, "POST", f"/api/gelen/{o['gelen_normal']}", ui=None, ana=True,
              govde={"karar": "kabul", "duzeltme": {"dugum_id": o["zeybek"]}})
    assert r.kod == 200, (r.kod, r.ham)
    assert gelen_durumu(o["db"], o["gelen_normal"]) == "kabul"


def test_gelen_karar_duzeltme_bicimsiz_400(taze):
    o = taze
    once = db_ozeti(o["db"])
    kotuler = [
        [], [o["zeybek"]], 5, 0, 1.5, True, False, "dugum_id", {},
        {"dugum_id": 5}, {"dugum_id": ""}, {"dugum_id": None}, {"dugum_id": [o["zeybek"]]},
        {"ebeveyn": o["muzik"]}, {"baslik": "Ney"},
        {"ebeveyn": "", "baslik": "Ney"}, {"ebeveyn": o["muzik"], "baslik": ""},
        {"ebeveyn": o["muzik"], "baslik": 5}, {"ebeveyn": 5, "baslik": "Ney"},
        {"ebeveyn": None, "baslik": "Ney"},
        {"dugum_id": o["zeybek"], "ebeveyn": o["muzik"], "baslik": "Ney"},
        {"dugum_id": o["zeybek"], "baslik": "Ney"},
        {"ebeveyn": o["muzik"], "baslik": "Ney", "dugum_id": o["zeybek"]},
        {"ebeveyn": o["muzik"], "baslik": "Ney", "metin": "ENJEKTE_y"},
        {"dugum_id": o["zeybek"], "gizlilik": "normal"},
    ]
    for d in kotuler:
        for karar in ("kabul", "red"):
            r = istek(o, "POST", KARAR_YOLU,
                      govde={"id": o["gelen_normal"], "karar": karar, "duzeltme": d})
            assert r.kod == 400, (d, karar, r.kod, r.ham)
    assert db_ozeti(o["db"]) == once
    assert gelen_durumu(o["db"], o["gelen_normal"]) == "bekliyor"
    assert "ENJEKTE_y" not in _db_dokumu(o["db"])


def test_gelen_karar_cozulemeyen_ebeveyn_400_olmayan_id_404(taze):
    o = taze
    once = db_ozeti(o["db"])
    duz = {"ebeveyn": "Hobi yok", "baslik": "Ney"}
    r = istek(o, "POST", KARAR_YOLU,
              govde={"id": o["gelen_normal"], "karar": "kabul", "duzeltme": duz})
    assert r.kod == 400, (r.kod, r.ham)
    assert "hata" in r.json()
    assert gelen_durumu(o["db"], o["gelen_normal"]) == "bekliyor"
    assert db_ozeti(o["db"]) == once
    for govde in ({"id": "olmayan-gelen-id", "karar": "kabul", "duzeltme": duz},
                  {"id": "olmayan-gelen-id", "karar": "kabul", "duzeltme": {"dugum_id": o["zeybek"]}},
                  {"id": "olmayan-gelen-id", "karar": "red", "duzeltme": None}):
        r = istek(o, "POST", KARAR_YOLU, govde=govde)
        assert r.kod == 404, (govde, r.kod, r.ham)
    assert db_ozeti(o["db"]) == once
    # geçerli biçimler hâlâ çalışır: null ve tam {"dugum_id"}
    r = istek(o, "POST", KARAR_YOLU,
              govde={"id": o["gelen_normal"], "karar": "kabul", "duzeltme": {"dugum_id": o["zeybek"]}})
    assert r.kod == 200, r.ham
    r = istek(o, "POST", KARAR_YOLU, govde={"id": o["gelen_ozel"], "karar": "red", "duzeltme": None})
    assert r.kod == 200, r.ham


# ------------------------------------------------------------------ asistan adı


@pytest.mark.parametrize("ad, beklenen", [
    (None, "Claude"),
    ("Nova", "Nova"),
    ("<b>Nova</b> & Co", "&lt;b&gt;Nova&lt;/b&gt; &amp; Co"),
])
def test_sayfa_asistan_adini_ortamdan_alir(kapali, ad, beklenen):
    """Başlıktaki asistan adı EREN_KIT_ASSISTANT_NAME'den gelir (yoksa Claude), HTML-kaçışlı."""
    o = kapali
    o["env"].pop("EREN_KIT_ASSISTANT_NAME", None)
    if ad is not None:
        o["env"]["EREN_KIT_ASSISTANT_NAME"] = ad
    _servis_baslat(o)
    for yol in ("/", "/static/index.html"):
        r = istek(o, "GET", yol, ui=None)
        assert r.kod == 200, yol
        metin = r.ham.decode("utf-8")
        assert "{{ASISTAN_ADI}}" not in metin
        assert f"<title>Beyin · {beklenen}</title>" in metin
        assert f"{beklenen} ile paylaşılan" in metin
        if ad is not None and "<b>" in ad:
            assert "<b>Nova" not in metin
