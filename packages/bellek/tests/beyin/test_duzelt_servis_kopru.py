"""POST /api/duzelt ve beyin_duzelt MCP aracı: uçtan uca testler (sözleşmeden).

Kalıp tests/beyin/test_servis_kopru.py ile aynıdır (geçici veritabanı, rastgele port, sahte
%LOCALAPPDATA%); o dosya paralel düzenlendiği için fikstürler buraya kopyalanmıştır.
"""

from __future__ import annotations

import json
import os
import queue
import re
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from bellek.beyin import db
from tests._surec import YENI_OTURUM, agaci_oldur

SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "src"))

KAPALI_METNI = "Servis kapalı; düzeltme yapılmadı (kuyruğa alınmaz)."
SIR_METNI = "Sır içeriyor, yazılmadı."
SIR = "DB_PASSWORD=supersecret1"


def bos_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


@pytest.fixture()
def ortam(tmp_path):
    yol = str(tmp_path / "beyin.db")
    con = db.baglan(yol)
    with con:
        kok = db.kok_id(con)
        dal = db.dugum_ekle(con, "Müzik", ozet="müzik zevkleri", ebeveyn=kok)
        dugum = db.dugum_ekle(con, "Zeybekoloji", ozet="zeybek dansı üzerine",
                              ayrinti="eski ayrıntı metni", ebeveyn=dal)
        db.olgu_ekle(con, dugum, "Kullanıcı zeybekoloji dersini sever")
        db.olgu_ekle(con, dugum, "Kullanıcı ege türkülerini dinler")
    con.close()
    port = bos_port()
    yerel = tmp_path / "yerel"  # sahte %LOCALAPPDATA%: gerçek Bellek klasörüne dokunulmaz
    yerel.mkdir()
    env = dict(os.environ)
    env.update(
        LOCALAPPDATA=str(yerel),
        BELLEK_BEYIN_DB=yol,
        BELLEK_BEYIN_PORT=str(port),
        BELLEK_BEYIN_KUYRUK=str(tmp_path / "kuyruk.jsonl"),
        BELLEK_BEYIN_LOG=str(tmp_path / "servis.log"),
        BELLEK_BEYIN_KOPRU_LOG=str(tmp_path / "kopru.log"),
        BELLEK_BEYIN_TOKEN_DOSYA=str(tmp_path / "token"),
        PYTHONPATH=SRC + os.pathsep + env.get("PYTHONPATH", ""),
        PYTHONIOENCODING="utf-8",
    )
    return dict(db=yol, port=port, env=env, kuyruk=str(tmp_path / "kuyruk.jsonl"),
                dugum=dugum, dal=dal, kok=kok, kok_dizin=tmp_path,
                token=str(tmp_path / "token"))


_surecler: list = []


@pytest.fixture(autouse=True)
def _temizle():
    yield
    for p in _surecler:
        # venv başlatıcısı + asıl python: tüm süreç ağacını kesin kapat
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
    _surecler.clear()


def _baslat(ortam, *args, stdin=False):
    p = subprocess.Popen(
        [sys.executable, "-m", "bellek.beyin", *args],
        env=ortam["env"],
        stdin=subprocess.PIPE if stdin else subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, **YENI_OTURUM,
    )
    _surecler.append(p)
    return p


def belirtec(ortam) -> str:
    try:
        with open(ortam["token"], encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def http(ortam, yontem, yol, govde=None, ham=None, token=True, baslik=None, zaman_asimi=5):
    """token=True: dosyadaki belirteç; None: başlıksız; dize: o değer."""
    url = f"http://127.0.0.1:{ortam['port']}{yol}"
    veri = ham if ham is not None else (json.dumps(govde).encode() if govde is not None else None)
    basliklar = {"Content-Type": "application/json"}
    if token is True:
        t = belirtec(ortam)
        if t:
            basliklar["X-Beyin-Token"] = t
    elif token:
        basliklar["X-Beyin-Token"] = token
    basliklar.update(baslik or {})
    istek = urllib.request.Request(url, data=veri, method=yontem, headers=basliklar)
    try:
        with urllib.request.urlopen(istek, timeout=zaman_asimi) as r:
            return r.status, r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def jhttp(ortam, yontem, yol, govde=None, **kw):
    kod, metin = http(ortam, yontem, yol, govde, **kw)
    return kod, json.loads(metin)


def servis_baslat(ortam):
    p = _baslat(ortam, "servis", "--port", str(ortam["port"]))
    son = time.time() + 10
    while time.time() < son:
        if p.poll() is not None:
            raise AssertionError("servis erken çıktı: " + p.stderr.read().decode("utf-8", "replace"))
        try:
            if http(ortam, "GET", "/api/saglik")[0] == 200:
                return p
        except Exception:
            pass
        time.sleep(0.2)
    raise AssertionError("servis 10 sn'de hazır olmadı")


class Kopru:
    def __init__(self, ortam):
        self.p = _baslat(ortam, "mcp", stdin=True)
        self.q: queue.Queue = queue.Queue()
        self.ham: list = []
        threading.Thread(target=self._oku, daemon=True).start()
        self._id = 0

    def _oku(self):
        for satir in iter(self.p.stdout.readline, b""):
            self.q.put(satir.decode("utf-8").rstrip("\r\n"))

    def gonder(self, metot, params=None):
        self._id += 1
        m = {"jsonrpc": "2.0", "id": self._id, "method": metot}
        if params is not None:
            m["params"] = params
        self.p.stdin.write((json.dumps(m) + "\n").encode("utf-8"))
        self.p.stdin.flush()
        son = time.time() + 30
        while time.time() < son:
            try:
                satir = self.q.get(timeout=max(0.1, son - time.time()))
            except queue.Empty:
                break
            self.ham.append(satir)
            if not satir.strip():
                continue
            yanit = json.loads(satir)  # JSON olmayan satır -> hata
            assert yanit.get("jsonrpc") == "2.0"
            if yanit.get("id") == self._id:
                return yanit
        raise AssertionError(f"{metot} yanıtı zamanında gelmedi")

    def baslat(self):
        return self.gonder("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                                          "clientInfo": {"name": "test", "version": "0"}})

    def arac(self, ad, **arg):
        return self.gonder("tools/call", {"name": ad, "arguments": arg})["result"]


def metin_of(sonuc) -> str:
    return sonuc["content"][0]["text"]


def olgular(yol):
    con = sqlite3.connect(yol)
    try:
        return sorted(r[0] for r in con.execute("SELECT metin FROM olgu"))
    finally:
        con.close()


def dugum_alanlari(yol, dugum_id):
    """(ozet, ayrinti) — doğrudan veritabanından."""
    con = sqlite3.connect(yol)
    try:
        return tuple(con.execute("SELECT ozet, ayrinti FROM dugum WHERE id = ?",
                                 (dugum_id,)).fetchone())
    finally:
        con.close()


def gecmis_sayisi(yol) -> int:
    con = sqlite3.connect(yol)
    try:
        return con.execute("SELECT COUNT(*) FROM gecmis").fetchone()[0]
    finally:
        con.close()


def anlik(ortam):
    """Veritabanının düzeltmeyle değişebilecek kısmının anlık görüntüsü."""
    return (dugum_alanlari(ortam["db"], ortam["dugum"]), olgular(ortam["db"]),
            gecmis_sayisi(ortam["db"]))


def beklenen_mesaj(ortam, **kw) -> str:
    """Aynı düzeltmeyi veritabanının bir kopyasında yaz.duzelt ile yapıp `mesaj`ı döndürür."""
    from bellek.beyin import yaz

    kopya = os.path.join(str(ortam["kok_dizin"]), "kopya.db")
    if os.path.exists(kopya):
        os.remove(kopya)
    kaynak = sqlite3.connect(ortam["db"])
    hedef = sqlite3.connect(kopya)
    try:
        kaynak.backup(hedef)
    finally:
        hedef.close()
        kaynak.close()
    con = db.baglan(kopya)
    try:
        return yaz.duzelt(con, ortam["dugum"], **kw)["mesaj"]
    finally:
        con.close()


def _tum_dosyalar_sizinti(kok, sir):
    bulunan = []
    for dizin, _, dosyalar in os.walk(kok):
        if "__pycache__" in dizin:
            continue
        for ad in dosyalar:
            yol = os.path.join(dizin, ad)
            try:
                with open(yol, "rb") as f:
                    if sir.encode() in f.read():
                        bulunan.append(yol)
            except OSError:
                pass
    return bulunan


# ------------------------------------------------------------ servis: POST /api/duzelt


def test_duzelt_basarili_oku_yeni_ozeti_gosterir_olgular_korunur(ortam):
    servis_baslat(ortam)
    onceki_olgular = olgular(ortam["db"])
    kod, s = jhttp(ortam, "POST", "/api/duzelt",
                   {"dugum_id": ortam["dugum"], "ozet": "ege zeybeği ve figürleri",
                    "ayrinti": "yeni ayrıntı: harmandalı ve kerimoğlu",
                    "kaynak": {"tur": "oturum", "ref": "test-oturumu"}})
    assert kod == 200, s
    assert {"sonuc", "mesaj", "dugum_id"} <= set(s)
    assert s["sonuc"] == "guncellendi", s
    assert s["dugum_id"] == ortam["dugum"]
    assert isinstance(s["mesaj"], str) and s["mesaj"]
    assert dugum_alanlari(ortam["db"], ortam["dugum"]) == (
        "ege zeybeği ve figürleri", "yeni ayrıntı: harmandalı ve kerimoğlu")
    kod, o = jhttp(ortam, "GET", f"/api/oku?id={ortam['dugum']}")
    assert kod == 200
    assert "ege zeybeği ve figürleri" in o["metin"]
    assert "zeybek dansı üzerine" not in o["metin"]
    assert olgular(ortam["db"]) == onceki_olgular


def test_duzelt_yalniz_ayrinti_ozete_dokunmaz(ortam):
    servis_baslat(ortam)
    kod, s = jhttp(ortam, "POST", "/api/duzelt",
                   {"dugum_id": ortam["dugum"], "ayrinti": "yalnız ayrıntı değişti"})
    assert kod == 200 and s["sonuc"] == "guncellendi", s
    assert dugum_alanlari(ortam["db"], ortam["dugum"]) == (
        "zeybek dansı üzerine", "yalnız ayrıntı değişti")


def test_duzelt_ayni_deger_degismedi(ortam):
    servis_baslat(ortam)
    govde = {"dugum_id": ortam["dugum"], "ozet": "zeybek dansı üzerine"}
    gecmis = gecmis_sayisi(ortam["db"])
    kod, s = jhttp(ortam, "POST", "/api/duzelt", govde)
    assert kod == 200 and s["sonuc"] == "degismedi", s
    assert s["dugum_id"] == ortam["dugum"] and s["mesaj"]
    assert gecmis_sayisi(ortam["db"]) == gecmis


def test_duzelt_reddedildi_200(ortam):
    servis_baslat(ortam)
    onceki = anlik(ortam)
    kod, s = jhttp(ortam, "POST", "/api/duzelt",
                   {"dugum_id": "olmayan-dugum-xyz", "ozet": "yeni özet"})
    assert kod == 200 and s["sonuc"] == "reddedildi", s
    assert isinstance(s["mesaj"], str) and s["mesaj"]
    kod, s = jhttp(ortam, "POST", "/api/duzelt", {"dugum_id": ortam["dugum"], "ozet": "   "})
    assert kod == 200 and s["sonuc"] == "reddedildi", s  # özet boş olamaz
    assert anlik(ortam) == onceki


def test_duzelt_gecersiz_govde_400(ortam):
    servis_baslat(ortam)
    d = ortam["dugum"]
    onceki = anlik(ortam)
    gecersizler = [
        {},
        {"ozet": "x"},                                  # dugum_id yok
        {"dugum_id": "", "ozet": "x"},                  # boş
        {"dugum_id": "   ", "ozet": "x"},               # yalnız boşluk
        {"dugum_id": 5, "ozet": "x"},                   # str değil
        {"dugum_id": [d], "ozet": "x"},
        {"dugum_id": d},                                # ozet de ayrinti de yok
        {"dugum_id": d, "ozet": 5},                     # ozet str değil
        {"dugum_id": d, "ozet": None},
        {"dugum_id": d, "ayrinti": ["x"]},              # ayrinti str değil
        {"dugum_id": d, "ozet": "x", "ayrinti": {"a": 1}},
        {"dugum_id": d, "ozet": "x", "istek_id": ""},   # geçersiz istek_id
        {"dugum_id": d, "ozet": "x", "istek_id": 123},
        {"dugum_id": d, "ozet": "x", "istek_id": ["a"]},
    ]
    for govde in gecersizler:
        kod, metin = http(ortam, "POST", "/api/duzelt", govde)
        assert kod == 400, (govde, kod, metin)
    assert http(ortam, "POST", "/api/duzelt", ham=b"{bozuk json")[0] == 400
    assert http(ortam, "POST", "/api/duzelt", ham=b"[1, 2]")[0] == 400
    assert anlik(ortam) == onceki


def test_duzelt_guvenlik_denetimi(ortam):
    servis_baslat(ortam)
    onceki = anlik(ortam)
    govde = {"dugum_id": ortam["dugum"], "ozet": "saldırgan özeti"}
    assert http(ortam, "POST", "/api/duzelt", govde, token=None)[0] == 401
    assert http(ortam, "POST", "/api/duzelt", govde, token="0" * 64)[0] == 401
    assert http(ortam, "POST", "/api/duzelt", govde,
                baslik={"Origin": "http://evil.example"})[0] == 403
    assert http(ortam, "POST", "/api/duzelt", govde, baslik={"Host": "evil.example"})[0] in (400, 403)
    assert http(ortam, "POST", "/api/duzelt", govde,
                baslik={"Content-Type": "text/plain"})[0] in (400, 415)
    assert anlik(ortam) == onceki


def test_duzelt_istek_id_tekillestirir(ortam):
    servis_baslat(ortam)
    d = ortam["dugum"]
    govde = {"dugum_id": d, "ozet": "birinci özet", "istek_id": "duzelt-abc-1"}
    kod, ilk = jhttp(ortam, "POST", "/api/duzelt", govde)
    assert kod == 200 and ilk["sonuc"] == "guncellendi", ilk
    # araya başka bir düzeltme girer
    kod, ara = jhttp(ortam, "POST", "/api/duzelt", {"dugum_id": d, "ozet": "ikinci özet"})
    assert kod == 200 and ara["sonuc"] == "guncellendi", ara
    gecmis = gecmis_sayisi(ortam["db"])
    # aynı istek_id: yeniden yazılmaz, ilk sonuç döner (yazılsaydı özet "birinci" olurdu)
    kod, tekrar = jhttp(ortam, "POST", "/api/duzelt", govde)
    assert kod == 200
    for alan in ("sonuc", "mesaj", "dugum_id"):
        assert tekrar[alan] == ilk[alan], (alan, ilk, tekrar)
    assert dugum_alanlari(ortam["db"], d)[0] == "ikinci özet"
    assert gecmis_sayisi(ortam["db"]) == gecmis


def test_duzelt_db_kilitliyken_503_sonra_basarili(ortam):
    servis_baslat(ortam)
    govde = {"dugum_id": ortam["dugum"], "ozet": "kilit sonrası özet", "istek_id": "kilit-1"}
    kilit = sqlite3.connect(ortam["db"], timeout=0, isolation_level=None)
    try:
        kilit.execute("BEGIN IMMEDIATE")
        kod, metin = http(ortam, "POST", "/api/duzelt", govde, zaman_asimi=30)
        assert kod == 503, (kod, metin)
    finally:
        kilit.rollback()
        kilit.close()
    assert dugum_alanlari(ortam["db"], ortam["dugum"])[0] == "zeybek dansı üzerine"
    # geçici hata kaydedilmez: aynı istek_id yeniden denenebilir
    kod, s = jhttp(ortam, "POST", "/api/duzelt", govde)
    assert kod == 200 and s["sonuc"] == "guncellendi", s
    assert dugum_alanlari(ortam["db"], ortam["dugum"])[0] == "kilit sonrası özet"


# ------------------------------------------------------------ köprü: beyin_duzelt


def test_kopru_duzelt_tools_list(ortam):
    k = Kopru(ortam)
    k.baslat()
    araclar = {a["name"]: a for a in k.gonder("tools/list")["result"]["tools"]}
    assert "beyin_duzelt" in araclar
    sema = araclar["beyin_duzelt"]["inputSchema"]
    assert sema["type"] == "object"
    assert {"dugum_id", "ozet", "ayrinti"} <= set(sema["properties"])
    assert sema.get("required") == ["dugum_id"]


def test_kopru_duzelt_servis_acik_mesaj_doner(ortam):
    servis_baslat(ortam)
    k = Kopru(ortam)
    k.baslat()
    onceki_olgular = olgular(ortam["db"])
    beklenen = beklenen_mesaj(ortam, ozet="köprüden gelen özet")
    s = k.arac("beyin_duzelt", dugum_id=ortam["dugum"], ozet="köprüden gelen özet")
    assert not s.get("isError"), metin_of(s)
    assert s["content"][0]["type"] == "text"
    assert metin_of(s) == beklenen
    assert dugum_alanlari(ortam["db"], ortam["dugum"]) == ("köprüden gelen özet", "eski ayrıntı metni")
    assert olgular(ortam["db"]) == onceki_olgular

    beklenen = beklenen_mesaj(ortam, ayrinti="köprüden gelen ayrıntı")
    s = k.arac("beyin_duzelt", dugum_id=ortam["dugum"], ayrinti="köprüden gelen ayrıntı")
    assert not s.get("isError"), metin_of(s)
    assert metin_of(s) == beklenen
    assert dugum_alanlari(ortam["db"], ortam["dugum"]) == ("köprüden gelen özet", "köprüden gelen ayrıntı")

    tam_200 = "zeybek " * 28 + "dans"  # tam 200 karakter: sınırda kabul
    assert len(tam_200) == 200
    s = k.arac("beyin_duzelt", dugum_id=ortam["dugum"], ozet=tam_200)
    assert not s.get("isError"), metin_of(s)
    assert dugum_alanlari(ortam["db"], ortam["dugum"])[0] == tam_200
    assert not os.path.exists(ortam["kuyruk"])


def test_kopru_duzelt_reddedilince_iserror(ortam):
    servis_baslat(ortam)
    k = Kopru(ortam)
    k.baslat()
    s = k.arac("beyin_duzelt", dugum_id="olmayan-dugum-xyz", ozet="yeni özet")
    assert s.get("isError") is True and s["content"][0]["type"] == "text"


def test_kopru_duzelt_dogrulama_hatalari(ortam):
    servis_baslat(ortam)
    k = Kopru(ortam)
    k.baslat()
    onceki = anlik(ortam)
    d = ortam["dugum"]
    for arg in (
        {"dugum_id": d},                                   # ikisi de yok
        {"dugum_id": d, "ozet": "zeybek " * 30},           # 210 > 200
        {"dugum_id": d, "ayrinti": "halay dansı " * 130},  # 1560 > 1500
    ):
        s = k.arac("beyin_duzelt", **arg)
        assert s.get("isError") is True, (arg, metin_of(s))
        assert s["content"][0]["type"] == "text" and metin_of(s)
    assert anlik(ortam) == onceki
    assert not os.path.exists(ortam["kuyruk"])


@pytest.mark.parametrize("alan", ["ozet", "ayrinti"])
def test_kopru_duzelt_sir_servise_gitmez(ortam, alan):
    servis_baslat(ortam)
    k = Kopru(ortam)
    k.baslat()
    onceki = anlik(ortam)
    s = k.arac("beyin_duzelt", dugum_id=ortam["dugum"], **{alan: SIR})
    assert s.get("isError") is True
    assert metin_of(s) == SIR_METNI
    assert anlik(ortam) == onceki
    time.sleep(0.5)
    # ne veritabanında ne servis/köprü günlüğünde ne kuyrukta
    assert _tum_dosyalar_sizinti(ortam["kok_dizin"], "supersecret1") == []


def test_kopru_duzelt_sir_servis_kapaliyken_de_sir_hatasi(ortam):
    k = Kopru(ortam)  # portta kimse yok: sır denetimi ağdan önce
    k.baslat()
    s = k.arac("beyin_duzelt", dugum_id=ortam["dugum"], ozet=SIR)
    assert s.get("isError") is True
    assert metin_of(s) == SIR_METNI
    assert not os.path.exists(ortam["kuyruk"])
    assert _tum_dosyalar_sizinti(ortam["kok_dizin"], "supersecret1") == []


def test_kopru_duzelt_bos_ayrinti_iletilir_ve_temizler(ortam):
    """Regresyon: _str_arg boş metni None yapıyordu; ayrinti='' hiç servise gitmiyordu."""
    servis_baslat(ortam)
    k = Kopru(ortam)
    k.baslat()
    d = ortam["dugum"]
    assert dugum_alanlari(ortam["db"], d) == ("zeybek dansı üzerine", "eski ayrıntı metni")
    onceki_olgular = olgular(ortam["db"])

    # yalnız ayrinti="": "'ozet' ya da 'ayrinti' gerekli" değil, temizleme
    s = k.arac("beyin_duzelt", dugum_id=d, ayrinti="")
    assert not s.get("isError"), metin_of(s)
    assert dugum_alanlari(ortam["db"], d) == ("zeybek dansı üzerine", "")
    kod, o = jhttp(ortam, "GET", f"/api/oku?id={d}")
    assert kod == 200 and "eski ayrıntı metni" not in o["metin"]

    # ozet + ayrinti="": ikisi birlikte gider, eski ayrıntı kalmaz
    kod, r = jhttp(ortam, "POST", "/api/duzelt", {"dugum_id": d, "ayrinti": "tekrar ayrıntı"})
    assert kod == 200 and r["sonuc"] == "guncellendi", r
    s = k.arac("beyin_duzelt", dugum_id=d, ozet="yeni özet", ayrinti="")
    assert not s.get("isError"), metin_of(s)
    assert dugum_alanlari(ortam["db"], d) == ("yeni özet", "")
    kod, o = jhttp(ortam, "GET", f"/api/oku?id={d}")
    assert kod == 200 and "tekrar ayrıntı" not in o["metin"]
    assert olgular(ortam["db"]) == onceki_olgular


@pytest.mark.parametrize("arg", [
    {"ozet": "   ", "ayrinti": "yeni ayrıntı"},
    {"ozet": "", "ayrinti": "yeni ayrıntı"},
    {"ozet": "   "},
    {"ozet": ""},
], ids=["bosluk+ayrinti", "bos+ayrinti", "yalniz-bosluk", "yalniz-bos"])
def test_kopru_duzelt_bos_ozet_sessizce_dusmez(ortam, arg):
    """Regresyon: boşluk özet yok sayılıp yalnız ayrıntı yazılıyordu. Araç hatası ya da
    sunucudan 'reddedildi' (o da isError) kabul; veritabanı hiçbir durumda değişmez."""
    servis_baslat(ortam)
    k = Kopru(ortam)
    k.baslat()
    onceki = anlik(ortam)
    s = k.arac("beyin_duzelt", dugum_id=ortam["dugum"], **arg)
    assert s.get("isError") is True, metin_of(s)
    assert s["content"][0]["type"] == "text" and metin_of(s)
    assert anlik(ortam) == onceki
    assert not os.path.exists(ortam["kuyruk"])


def _sahte_mesgul_servis(port: int) -> ThreadingHTTPServer:
    """Sağlığa 'ok', /api/duzelt'e 503 (gerçek servisin geçici-hata gövdesiyle) dönen sahte servis."""

    class Isleyici(BaseHTTPRequestHandler):
        def log_message(self, *a, **k):
            pass

        def _yanit(self, kod: int, nesne: dict) -> None:
            govde = json.dumps(nesne, ensure_ascii=False).encode("utf-8")
            self.send_response(kod)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(govde)))
            self.end_headers()
            self.wfile.write(govde)

        def do_GET(self):
            if self.path.startswith("/api/saglik"):
                return self._yanit(200, {"durum": "ok"})
            self._yanit(404, {"hata": "bulunamadı"})

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            self.rfile.read(n)
            sunucu.duzelt_sayisi += self.path == "/api/duzelt"
            self._yanit(503, {"sonuc": "reddedildi", "dugum_id": None, "yol": None,
                              "mesaj": "Reddedildi: veritabanı meşgul (database is locked); "
                                       "geçici, yeniden denenecek.",
                              "gecici_hata": True})

    sunucu = ThreadingHTTPServer(("127.0.0.1", port), Isleyici)
    sunucu.daemon_threads = True
    sunucu.duzelt_sayisi = 0
    threading.Thread(target=sunucu.serve_forever, daemon=True).start()
    return sunucu


def test_kopru_duzelt_servis_503_mesgul_der(ortam):
    """Regresyon (b): servis ayaktayken 503 'Servis kapalı' diye raporlanıyordu."""
    onceki = anlik(ortam)
    sahte = _sahte_mesgul_servis(ortam["port"])
    try:
        k = Kopru(ortam)
        k.baslat()
        s = k.arac("beyin_duzelt", dugum_id=ortam["dugum"], ozet="meşgulken özet")
        assert sahte.duzelt_sayisi >= 1, "istek servise hiç ulaşmadı"
    finally:
        sahte.shutdown()
        sahte.server_close()
    assert s.get("isError") is True
    assert "meşgul" in metin_of(s), metin_of(s)
    assert "Servis kapalı" not in metin_of(s), metin_of(s)
    assert not list(ortam["kok_dizin"].glob("kuyruk.jsonl*"))
    assert anlik(ortam) == onceki


def test_kopru_duzelt_db_kilitliyken_mesgul_der(ortam):
    """Regresyon (b), gerçek servisle: veritabanı kilitliyken araç 'meşgul' der."""
    servis_baslat(ortam)
    k = Kopru(ortam)
    k.baslat()
    onceki = anlik(ortam)
    kilit = sqlite3.connect(ortam["db"], timeout=0, isolation_level=None)
    try:
        kilit.execute("BEGIN IMMEDIATE")
        s = k.arac("beyin_duzelt", dugum_id=ortam["dugum"], ozet="kilitliyken özet")
    finally:
        kilit.rollback()
        kilit.close()
    assert s.get("isError") is True
    assert "meşgul" in metin_of(s), metin_of(s)
    assert "Servis kapalı" not in metin_of(s), metin_of(s)
    assert not list(ortam["kok_dizin"].glob("kuyruk.jsonl*"))
    assert anlik(ortam) == onceki


def test_kopru_duzelt_servis_kapali_kuyruga_alinmaz(ortam):
    onceki = anlik(ortam)
    k = Kopru(ortam)  # portta kimse yok
    k.baslat()
    s = k.arac("beyin_duzelt", dugum_id=ortam["dugum"], ozet="kapalıyken özet")
    assert s.get("isError") is True
    assert metin_of(s) == KAPALI_METNI
    assert not os.path.exists(ortam["kuyruk"])
    assert not list(ortam["kok_dizin"].glob("kuyruk.jsonl*"))
    assert anlik(ortam) == onceki
    # servis sonradan açılınca da ertelenmiş bir düzeltme işlenmez
    servis_baslat(ortam)
    time.sleep(1)
    assert anlik(ortam) == onceki
    assert "kapalıyken özet" not in http(ortam, "GET", f"/api/oku?id={ortam['dugum']}")[1]


# ------------------------------------------------------------ köprü: süreç içi (arac_duzelt)
# Zaman aşımı ve sağlık denetimi süreç içinde monkeypatch edilebilsin diye arac_duzelt doğrudan
# çağrılır; ortam değişkenleri yine tmp_path'e yönlendirilir.


class _YanitsizServis:
    """Ham soket sunucusu: isteği sonuna kadar okur, kaydeder, YANIT VERMEZ.

    kip='kapat': hemen bağlantıyı kapatır (yanıt göndermeden kopan bağlantı).
    kip='bekle': bağlantıyı açık tutar (istemci tarafında zaman aşımı).
    Sağlık ucu da dahil her istek yanıtsızdır.
    """

    def __init__(self, port: int, kip: str) -> None:
        self.kip = kip
        self.istekler: list[tuple[str, str, bytes]] = []
        self._dur = threading.Event()
        self._baglantilar: list[socket.socket] = []
        self._dinle = socket.socket()
        self._dinle.bind(("127.0.0.1", port))
        self._dinle.listen(16)
        self._dinle.settimeout(0.2)
        threading.Thread(target=self._dongu, daemon=True).start()

    def _dongu(self) -> None:
        while not self._dur.is_set():
            try:
                b, _ = self._dinle.accept()
            except (socket.timeout, OSError):
                continue
            threading.Thread(target=self._isle, args=(b,), daemon=True).start()

    def _isle(self, b: socket.socket) -> None:
        b.settimeout(5)
        tampon = b""
        try:
            while b"\r\n\r\n" not in tampon:
                parca = b.recv(65536)
                if not parca:
                    break
                tampon += parca
            bas, _, govde = tampon.partition(b"\r\n\r\n")
            satirlar = bas.decode("latin-1").split("\r\n")
            yontem, yol = (satirlar[0].split(" ") + ["", ""])[:2]
            uzunluk = 0
            for s in satirlar[1:]:
                ad, _, deger = s.partition(":")
                if ad.strip().lower() == "content-length":
                    uzunluk = int(deger.strip() or 0)
            while len(govde) < uzunluk:
                parca = b.recv(65536)
                if not parca:
                    break
                govde += parca
            self.istekler.append((yontem, yol, govde))
        except OSError:
            pass
        if self.kip == "bekle":
            self._baglantilar.append(b)
            self._dur.wait(30)
        try:
            b.close()
        except OSError:
            pass

    def duzelt_postlari(self) -> list[dict]:
        return [json.loads(g.decode("utf-8")) for y, p, g in self.istekler
                if y == "POST" and p == "/api/duzelt"]

    def kapat(self) -> None:
        self._dur.set()
        for b in self._baglantilar:
            try:
                b.close()
            except OSError:
                pass
        self._dinle.close()


@pytest.fixture()
def kopru_mod(ortam, monkeypatch):
    """Süreç içi mcp_kopru: ortam değişkenleri tmp'ye, modül durumu sıfır."""
    from bellek.beyin import mcp_kopru

    for ad in ("LOCALAPPDATA", "BELLEK_BEYIN_DB", "BELLEK_BEYIN_PORT", "BELLEK_BEYIN_KUYRUK",
               "BELLEK_BEYIN_LOG", "BELLEK_BEYIN_KOPRU_LOG", "BELLEK_BEYIN_TOKEN_DOSYA"):
        monkeypatch.setenv(ad, ortam["env"][ad])
    monkeypatch.setattr(mcp_kopru, "_kapali_bitis", 0.0, raising=False)
    monkeypatch.setattr(mcp_kopru, "_belirtec_imza", None, raising=False)
    monkeypatch.setattr(mcp_kopru, "_belirtec_deger", None, raising=False)
    return mcp_kopru


# Kelime olarak "yapılmadı"; "yapılmadığı" / "yapılmadıysa" gibi ekli biçimler sayılmaz.
_YAPILMADI = re.compile(r"(?<!\w)yapılmadı(?!\w)")


def _duzelt_hatasi(mcp_kopru, **arg) -> str:
    with pytest.raises(mcp_kopru.AracHatasi) as e:
        mcp_kopru.arac_duzelt(arg)
    return str(e.value)


@pytest.mark.parametrize("kip", ["kapat", "bekle"])
def test_kopru_duzelt_gitti_yanit_yok_saglik_yok_belirsiz(ortam, kopru_mod, monkeypatch, kip):
    """(a) İstek servise ulaşıyor, yanıt gelmiyor, sağlık da yanıtsız: sonuç belirsizdir
    (servis yeniden başlarken iş yazılmış olabilir); 'yapılmadı' denmez, beyin_oku önerilir."""
    monkeypatch.setattr(kopru_mod, "DUZELT_ZAMAN_ASIMI", 1.0)
    onceki = anlik(ortam)
    sahte = _YanitsizServis(ortam["port"], kip)
    try:
        mesaj = _duzelt_hatasi(kopru_mod, dugum_id=ortam["dugum"], ozet="yanıtsız servis özeti")
    finally:
        sahte.kapat()
    postlar = sahte.duzelt_postlari()
    assert 1 <= len(postlar) <= 2, postlar  # en az biri ulaştı; körlemesine yeniden deneme yok
    assert len({p.get("istek_id") for p in postlar}) == 1  # yeniden deneme aynı istek_id ile
    assert all(p["dugum_id"] == ortam["dugum"] and p["ozet"] == "yanıtsız servis özeti"
               for p in postlar)
    assert "belirsiz" in mesaj, mesaj
    assert "beyin_oku" in mesaj, mesaj
    assert not _YAPILMADI.search(mesaj), mesaj  # "yapılmadı" hükmü yok ("yapılmadığı" serbest)
    assert "Servis kapalı; düzeltme yapılmadı" not in mesaj, mesaj
    assert not list(ortam["kok_dizin"].glob("kuyruk.jsonl*"))
    assert anlik(ortam) == onceki


def test_kopru_duzelt_saglik_ok_ama_gonderilemedi_yapilmadi(ortam, kopru_mod, monkeypatch):
    """(c) Sağlık 'ok' ama iki deneme de gönderilemiyor (port reddediyor): hiçbir istek
    servise ulaşmadığı için sonuç belirsiz değildir, 'yapılmadı' denir."""
    saglik_cagrilari: list[int] = []

    def sahte_saglik() -> bool:
        saglik_cagrilari.append(1)
        return True

    monkeypatch.setattr(kopru_mod, "_servis_ayakta", sahte_saglik)
    monkeypatch.setattr(kopru_mod, "DUZELT_ZAMAN_ASIMI", 3.0)
    onceki = anlik(ortam)
    mesaj = _duzelt_hatasi(kopru_mod, dugum_id=ortam["dugum"], ozet="gönderilemeyen özet")
    assert "belirsiz" not in mesaj, mesaj
    assert _YAPILMADI.search(mesaj), mesaj
    assert not list(ortam["kok_dizin"].glob("kuyruk.jsonl*"))
    assert anlik(ortam) == onceki


def test_kopru_talimat_icerigi(ortam, kopru_mod):
    """(d) TALIMAT 'Okul/Dersler' ve beyin_duzelt içerir, ≤900 karakter; initialize'da aynısı."""
    talimat = kopru_mod.TALIMAT
    assert "'Okul/Dersler'" in talimat
    assert "beyin_duzelt" in talimat
    assert len(talimat) <= 900, len(talimat)
    k = Kopru(ortam)
    assert k.baslat()["result"]["instructions"] == talimat


# ------------------------------------------------------------ olgu eskitme (eskit)

ESKIT_OLGU = "Kullanıcı ege türkülerini dinler"
KALAN_OLGU = "Kullanıcı zeybekoloji dersini sever"


def olgu_durumlari(yol) -> dict:
    con = sqlite3.connect(yol)
    try:
        return dict(con.execute("SELECT metin, durum FROM olgu").fetchall())
    finally:
        con.close()


def test_duzelt_eskit_basarili_olgu_oku_gostermez_satir_kalir(ortam):
    servis_baslat(ortam)
    d = ortam["dugum"]
    kod, o = jhttp(ortam, "GET", f"/api/oku?id={d}")
    assert ESKIT_OLGU in o["metin"]
    kod, s = jhttp(ortam, "POST", "/api/duzelt", {"dugum_id": d, "eskit": ESKIT_OLGU})
    assert kod == 200 and s["sonuc"] == "guncellendi", s
    assert isinstance(s["mesaj"], str) and s["mesaj"]
    kod, o = jhttp(ortam, "GET", f"/api/oku?id={d}")
    assert ESKIT_OLGU not in o["metin"]
    assert KALAN_OLGU in o["metin"]
    assert olgu_durumlari(ortam["db"]) == {ESKIT_OLGU: "eskidi", KALAN_OLGU: "aktif"}
    assert dugum_alanlari(ortam["db"], d) == ("zeybek dansı üzerine", "eski ayrıntı metni")


def test_duzelt_eskit_ozet_ile_birlikte(ortam):
    servis_baslat(ortam)
    d = ortam["dugum"]
    kod, s = jhttp(ortam, "POST", "/api/duzelt",
                   {"dugum_id": d, "ozet": "eskitmeyle gelen özet", "eskit": ESKIT_OLGU})
    assert kod == 200 and s["sonuc"] == "guncellendi", s
    assert dugum_alanlari(ortam["db"], d)[0] == "eskitmeyle gelen özet"
    assert olgu_durumlari(ortam["db"])[ESKIT_OLGU] == "eskidi"


def test_duzelt_eskit_eslesme_yok_reddedildi_db_degismez(ortam):
    servis_baslat(ortam)
    onceki = anlik(ortam)
    durumlar = olgu_durumlari(ortam["db"])
    kod, s = jhttp(ortam, "POST", "/api/duzelt",
                   {"dugum_id": ortam["dugum"], "eskit": "böyle bir olgu hiç yok"})
    assert kod == 200 and s["sonuc"] == "reddedildi", s
    assert isinstance(s["mesaj"], str) and s["mesaj"]
    assert anlik(ortam) == onceki
    assert olgu_durumlari(ortam["db"]) == durumlar


def test_duzelt_ozet_ve_eslesmeyen_eskit_ikisi_de_yazilmaz(ortam):
    servis_baslat(ortam)
    onceki = anlik(ortam)
    durumlar = olgu_durumlari(ortam["db"])
    kod, s = jhttp(ortam, "POST", "/api/duzelt",
                   {"dugum_id": ortam["dugum"], "ozet": "yazılmaması gereken özet",
                    "ayrinti": "yazılmaması gereken ayrıntı", "eskit": "eşleşmeyen olgu metni"})
    assert kod == 200 and s["sonuc"] == "reddedildi", s
    assert anlik(ortam) == onceki
    assert olgu_durumlari(ortam["db"]) == durumlar


def test_duzelt_eskit_gecersiz_govde_400(ortam):
    servis_baslat(ortam)
    d = ortam["dugum"]
    onceki = anlik(ortam)
    gecersizler = [
        {"dugum_id": d, "eskit": 5},
        {"dugum_id": d, "eskit": None},
        {"dugum_id": d, "eskit": ["x"]},
        {"dugum_id": d, "eskit": {"a": 1}},
        {"dugum_id": d, "ozet": "x", "eskit": None},
        {"dugum_id": d, "ozet": "x", "eskit": 7},
    ]
    for govde in gecersizler:
        kod, metin = http(ortam, "POST", "/api/duzelt", govde)
        assert kod == 400, (govde, kod, metin)
    # üçü de yok: 400 (mevcut sözleşme eskit eklenince de geçerli)
    assert http(ortam, "POST", "/api/duzelt", {"dugum_id": d})[0] == 400
    assert anlik(ortam) == onceki
    assert olgu_durumlari(ortam["db"]) == {ESKIT_OLGU: "aktif", KALAN_OLGU: "aktif"}


def test_kopru_eskit_tools_list(ortam):
    k = Kopru(ortam)
    k.baslat()
    araclar = {a["name"]: a for a in k.gonder("tools/list")["result"]["tools"]}
    sema = araclar["beyin_duzelt"]["inputSchema"]
    assert {"dugum_id", "ozet", "ayrinti", "eskit"} <= set(sema["properties"])
    assert sema.get("required") == ["dugum_id"]


def test_kopru_eskit_yalniz_eskit_mesaj_doner(ortam):
    servis_baslat(ortam)
    k = Kopru(ortam)
    k.baslat()
    beklenen = beklenen_mesaj(ortam, eskit=ESKIT_OLGU)
    s = k.arac("beyin_duzelt", dugum_id=ortam["dugum"], eskit=ESKIT_OLGU)
    assert not s.get("isError"), metin_of(s)
    assert s["content"][0]["type"] == "text"
    assert metin_of(s) == beklenen
    assert olgu_durumlari(ortam["db"])[ESKIT_OLGU] == "eskidi"
    assert not os.path.exists(ortam["kuyruk"])


def test_kopru_eskit_bos_arac_hatasi(ortam):
    servis_baslat(ortam)
    k = Kopru(ortam)
    k.baslat()
    onceki = anlik(ortam)
    for deger in ("", "   "):
        s = k.arac("beyin_duzelt", dugum_id=ortam["dugum"], eskit=deger)
        assert s.get("isError") is True, (deger, metin_of(s))
        assert s["content"][0]["type"] == "text" and metin_of(s)
    assert anlik(ortam) == onceki
    assert olgu_durumlari(ortam["db"]) == {ESKIT_OLGU: "aktif", KALAN_OLGU: "aktif"}


def test_kopru_eskit_sir_servise_gitmez(ortam):
    servis_baslat(ortam)
    k = Kopru(ortam)
    k.baslat()
    onceki = anlik(ortam)
    s = k.arac("beyin_duzelt", dugum_id=ortam["dugum"], eskit=SIR)
    assert s.get("isError") is True
    assert metin_of(s) == SIR_METNI
    assert anlik(ortam) == onceki
    time.sleep(0.5)
    assert _tum_dosyalar_sizinti(ortam["kok_dizin"], "supersecret1") == []


def test_kopru_eskit_sir_servis_kapaliyken_de_sir_hatasi(ortam):
    k = Kopru(ortam)
    k.baslat()
    s = k.arac("beyin_duzelt", dugum_id=ortam["dugum"], eskit=SIR)
    assert s.get("isError") is True
    assert metin_of(s) == SIR_METNI
    assert not os.path.exists(ortam["kuyruk"])
    assert _tum_dosyalar_sizinti(ortam["kok_dizin"], "supersecret1") == []
