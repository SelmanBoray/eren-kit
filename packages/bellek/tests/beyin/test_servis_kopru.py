"""Servis + MCP köprüsü uçtan uca testleri (sözleşmeden)."""

from __future__ import annotations

import json
import os
import queue
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

import pytest

from bellek.beyin import db

SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "src"))


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
        dal2 = db.dugum_ekle(con, "Spor", ozet="spor", ebeveyn=kok)
        dugum = db.dugum_ekle(con, "Zeybekoloji", ozet="zeybek dansı üzerine", ebeveyn=dal)
        db.olgu_ekle(con, dugum, "Kullanıcı zeybekoloji dersini sever")
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
                dugum=dugum, dal=dal, dal2=dal2, kok=kok, kok_dizin=tmp_path,
                token=str(tmp_path / "token"))


_surecler: list = []


@pytest.fixture(autouse=True)
def _temizle():
    yield
    for p in _surecler:
        # venv başlatıcısı + asıl python: tüm süreç ağacını kesin kapat
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    _surecler.append(p)
    return p


def belirtec(ortam) -> str:
    try:
        with open(ortam["token"], encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def http(ortam, yontem, yol, govde=None, ham=None, token=True, baslik=None):
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
        with urllib.request.urlopen(istek, timeout=5) as r:
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
        son = time.time() + 15
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
        return [r[0] for r in con.execute("SELECT metin FROM olgu")]
    finally:
        con.close()


# ------------------------------------------------------------ servis


def test_saglik_ve_gez(ortam):
    servis_baslat(ortam)
    kod, g = jhttp(ortam, "GET", "/api/saglik")
    assert kod == 200 and g["durum"] == "ok"
    kod, metin = http(ortam, "GET", f"/api/gez?id={ortam['dal']}")
    assert kod == 200 and "Zeybekoloji" in metin


def test_ara_ve_oku(ortam):
    servis_baslat(ortam)
    kod, metin = http(ortam, "GET", "/api/ara?q=zeybek&k=5")
    assert kod == 200 and ortam["dugum"] in metin
    kod, o = jhttp(ortam, "GET", f"/api/oku?id={ortam['dugum']}")
    assert kod == 200 and isinstance(o, dict) and "metin" in o
    assert "Zeybekoloji" in o["metin"]


def test_yaz_olgu_olusur(ortam):
    servis_baslat(ortam)
    kod, y = jhttp(ortam, "POST", "/api/yaz", {"metin": "Kullanıcı halay çekmeyi sever",
                                               "dugum_id": ortam["dugum"], "kaynak": "claude"})
    assert kod == 200
    assert {"sonuc", "dugum_id", "yol", "mesaj"} <= set(y)
    assert any("halay" in m for m in olgular(ortam["db"]))


def test_gelen_kutusu(ortam):
    servis_baslat(ortam)
    kod, g = jhttp(ortam, "GET", "/api/gelen")
    assert kod == 200 and isinstance(g["gelen"], list)
    kod, _ = http(ortam, "POST", "/api/gelen/yok-boyle-id", {"karar": "red"})
    assert kod in (400, 404)
    kod, _ = http(ortam, "POST", "/api/gelen/yok-boyle-id", {"karar": "belki"})
    assert kod in (400, 404)


def test_disa_aktar_md(ortam):
    servis_baslat(ortam)
    kod, metin = http(ortam, "GET", "/api/disa-aktar?bicim=md")
    assert kod == 200 and "Kullanıcı" in metin and "Müzik" in metin


def test_hatali_istekler(ortam):
    servis_baslat(ortam)
    assert http(ortam, "GET", "/api/yok-boyle-yol")[0] == 404
    assert http(ortam, "GET", "/api/oku")[0] == 400  # id yok
    assert http(ortam, "GET", "/api/ara")[0] == 400  # q yok
    assert http(ortam, "POST", "/api/yaz", ham=b"{bozuk json")[0] == 400


def test_static_dizin_disi_reddedilir(ortam):
    servis_baslat(ortam)
    for yol in ("/static/../../pyproject.toml", "/static/..%2f..%2fpyproject.toml",
                "/static/..%5c..%5cpyproject.toml"):
        s = socket.create_connection(("127.0.0.1", ortam["port"]), timeout=5)
        try:
            s.sendall(f"GET {yol} HTTP/1.0\r\nHost: x\r\n\r\n".encode())
            tampon = b""
            while True:
                parca = s.recv(65536)
                if not parca:
                    break
                tampon += parca
        finally:
            s.close()
        ilk = tampon.split(b"\r\n", 1)[0].decode()
        assert " 200 " not in ilk, ilk
        assert b"[project]" not in tampon


def test_baslangicta_kuyruk_islenir(ortam):
    with open(ortam["kuyruk"], "w", encoding="utf-8") as f:
        f.write(json.dumps({"metin": "kuyruktan gelen bilgi zurna", "dugum_id": ortam["dugum"]},
                           ensure_ascii=False) + "\n")
    servis_baslat(ortam)
    assert any("zurna" in m for m in olgular(ortam["db"]))
    assert (not os.path.exists(ortam["kuyruk"])) or os.path.getsize(ortam["kuyruk"]) == 0


def test_belirtec_gerekli(ortam):
    servis_baslat(ortam)
    t = belirtec(ortam)
    assert len(t) == 64 and all(c in "0123456789abcdef" for c in t)
    assert http(ortam, "GET", "/api/saglik", token=None)[0] == 200  # sağlık muaf
    assert http(ortam, "GET", "/api/gelen", token=None)[0] == 401
    assert http(ortam, "GET", "/api/gelen", token="0" * 64)[0] == 401
    assert http(ortam, "POST", "/api/yaz", {"metin": "x", "dugum_id": ortam["dugum"]}, token=None)[0] == 401
    assert http(ortam, "GET", "/api/gelen")[0] == 200
    assert not any("x" == m for m in olgular(ortam["db"]))


def test_origin_host_icerik_turu_reddedilir(ortam):
    servis_baslat(ortam)
    onceki = olgular(ortam["db"])
    assert http(ortam, "GET", "/api/gelen", baslik={"Origin": "http://evil.example"})[0] == 403
    kod = http(ortam, "GET", "/api/gelen", baslik={"Host": "evil.example"})[0]
    assert kod in (400, 403)
    govde = {"metin": "Kullanıcı saldırı olgusu", "dugum_id": ortam["dugum"]}
    kod = http(ortam, "POST", "/api/yaz", govde, baslik={"Origin": "http://evil.example"})[0]
    assert kod == 403
    kod = http(ortam, "POST", "/api/yaz", govde, baslik={"Content-Type": "text/plain"})[0]
    assert kod in (400, 415)
    assert olgular(ortam["db"]) == onceki


def test_static_unc_yolu_hizli_reddedilir(ortam):
    servis_baslat(ortam)
    bas = time.time()
    kod = http(ortam, "GET", "/static/%2F%2Fhost%2Fshare%2Fx", token=None)[0]
    assert 400 <= kod < 500
    assert time.time() - bas < 2


def test_kuyruk_servis_calisirken_islenir(ortam):
    ortam["env"]["BELLEK_BEYIN_KUYRUK_ARALIK"] = "1"
    servis_baslat(ortam)
    with open(ortam["kuyruk"], "a", encoding="utf-8") as f:
        f.write(json.dumps({"metin": "canlı kuyruk bilgisi kemençe", "dugum_id": ortam["dugum"]},
                           ensure_ascii=False) + "\n")
    son = time.time() + 90
    while time.time() < son and not any("kemençe" in m for m in olgular(ortam["db"])):
        time.sleep(1)
    assert any("kemençe" in m for m in olgular(ortam["db"]))


def test_istek_id_tekillestirir(ortam):
    servis_baslat(ortam)
    govde = {"metin": "Kullanıcı bağlama dinlemeyi sever", "dugum_id": ortam["dugum"],
             "istek_id": "abc-123"}
    assert http(ortam, "POST", "/api/yaz", govde)[0] == 200
    assert http(ortam, "POST", "/api/yaz", govde)[0] == 200
    assert sum("bağlama" in m for m in olgular(ortam["db"])) == 1


def test_port_kilidi_ikinci_servis_acilmaz(ortam):
    ilk = servis_baslat(ortam)
    ikinci = _baslat(ortam, "servis", "--port", str(ortam["port"]))
    try:
        ikinci.wait(timeout=10)
    except subprocess.TimeoutExpired:
        raise AssertionError("ikinci servis kapanmadı")
    assert ikinci.returncode != 0
    assert ilk.poll() is None
    assert http(ortam, "GET", "/api/saglik")[0] == 200


# ------------------------------------------------------------ köprü


def test_kopru_protokol(ortam):
    k = Kopru(ortam)
    r = k.baslat()["result"]
    assert r["serverInfo"]["name"] == "beyin"
    assert "tools" in r["capabilities"]
    assert isinstance(r["instructions"], str) and len(r["instructions"]) <= 900
    assert "beyin_yaz" in r["instructions"]
    araclar = k.gonder("tools/list")["result"]["tools"]
    assert sorted(a["name"] for a in araclar) == [
        "beyin_ara", "beyin_duzelt", "beyin_gelen", "beyin_gez", "beyin_oku", "beyin_yaz"]
    assert all("inputSchema" in a for a in araclar)
    assert k.gonder("yok/boyle")["error"]["code"] == -32601
    assert k.ham and all(json.loads(s)["jsonrpc"] == "2.0" for s in k.ham if s.strip())


def test_kopru_servis_acik(ortam):
    servis_baslat(ortam)
    k = Kopru(ortam)
    k.baslat()
    s = k.arac("beyin_ara", sorgu="zeybek")
    assert not s.get("isError") and s["content"][0]["type"] == "text"
    assert "Zeybekoloji" in metin_of(s) or ortam["dugum"] in metin_of(s)
    s = k.arac("beyin_yaz", metin="Kullanıcı kaval dinlemeyi sever", dugum_id=ortam["dugum"])
    assert not s.get("isError")
    assert any("kaval" in m for m in olgular(ortam["db"]))


def test_kopru_servis_kapali_salt_okunur_ve_kuyruk(ortam):
    k = Kopru(ortam)  # portta kimse yok
    k.baslat()
    s = k.arac("beyin_gez", id=ortam["dal"])
    assert not s.get("isError") and "Zeybekoloji" in metin_of(s)
    s = k.arac("beyin_ara", sorgu="zeybek")
    assert not s.get("isError")
    assert "Zeybekoloji" in metin_of(s) or ortam["dugum"] in metin_of(s)
    s = k.arac("beyin_oku", id=ortam["dugum"])
    assert not s.get("isError") and "Zeybekoloji" in metin_of(s)

    s = k.arac("beyin_yaz", metin="Kullanıcı davul çalmayı sever", dugum_id=ortam["dugum"])
    assert "kuyru" in metin_of(s).lower()  # "kuyruğa" (ğ) biçimi
    assert os.path.exists(ortam["kuyruk"])
    with open(ortam["kuyruk"], encoding="utf-8") as f:
        satirlar = [ln for ln in f if ln.strip()]
    assert len(satirlar) == 1 and "davul" in satirlar[0]
    assert not any("davul" in m for m in olgular(ortam["db"]))

    servis_baslat(ortam)
    assert any("davul" in m for m in olgular(ortam["db"]))


def test_kopru_hata_iserror(ortam):
    servis_baslat(ortam)
    k = Kopru(ortam)
    k.baslat()
    s = k.arac("beyin_oku", id="olmayan-dugum-id")
    assert s.get("isError") is True and s["content"][0]["type"] == "text"


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


def test_kopru_sir_kuyruga_ve_izlere_girmez(ortam):
    k = Kopru(ortam)  # servis kapalı
    k.baslat()
    s = k.arac("beyin_yaz", metin="DB_PASSWORD=supersecret1", dugum_id=ortam["dugum"])
    assert s.get("isError") is True or "reddedil" in metin_of(s).lower()
    if os.path.exists(ortam["kuyruk"]):
        with open(ortam["kuyruk"], encoding="utf-8") as f:
            assert "supersecret1" not in f.read()
    servis_baslat(ortam)
    time.sleep(1)
    assert _tum_dosyalar_sizinti(ortam["kok_dizin"], "supersecret1") == []


def test_kopru_yaz_reddedilince_iserror(ortam):
    servis_baslat(ortam)
    k = Kopru(ortam)
    k.baslat()
    s = k.arac("beyin_yaz", metin="DB_PASSWORD=supersecret1", dugum_id=ortam["dugum"])
    assert s.get("isError") is True
    assert not any("supersecret1" in m for m in olgular(ortam["db"]))


def gelen_satirlari(yol):
    con = sqlite3.connect(yol)
    try:
        return con.execute("SELECT id, durum FROM gelen").fetchall()
    finally:
        con.close()


def test_kopru_beyin_gelen_liste_ve_karar(ortam):
    servis_baslat(ortam)
    k = Kopru(ortam)
    k.baslat()
    s = k.arac("beyin_yaz", metin="Kullanıcı kemane çalmayı öğrenmek istiyor",
               ebeveyn="olmayan-ebeveyn-xyz")
    assert s["content"][0]["type"] == "text"
    satirlar = gelen_satirlari(ortam["db"])
    assert len(satirlar) == 1, (satirlar, metin_of(s))
    gid, durum = satirlar[0]
    assert durum == "bekliyor"
    s = k.arac("beyin_gelen", islem="liste")
    assert not s.get("isError") and str(gid) in metin_of(s)
    s = k.arac("beyin_gelen", islem="karar", gelen_id=gid, karar="kabul", dugum_id=ortam["dugum"])
    assert not s.get("isError"), metin_of(s)
    assert any("kemane" in m for m in olgular(ortam["db"]))
    assert gelen_satirlari(ortam["db"])[0][1] == "kabul"


def test_kuyruk_db_kilitliyken_bekler_sonra_islenir(ortam):
    ortam["env"]["BELLEK_BEYIN_KUYRUK_ARALIK"] = "0.5"
    servis_baslat(ortam)
    kilit = sqlite3.connect(ortam["db"], timeout=0, isolation_level=None)
    try:
        kilit.execute("BEGIN IMMEDIATE")
        with open(ortam["kuyruk"], "a", encoding="utf-8") as f:
            f.write(json.dumps({"metin": "kilitli dönemde gelen bilgi tulum",
                                "dugum_id": ortam["dugum"]}, ensure_ascii=False) + chr(10))
        time.sleep(4)  # birkaç tur
        assert not any("tulum" in m for m in olgular(ortam["db"]))
        bekleyen = [p for p in ortam["kok_dizin"].glob("kuyruk.jsonl*") if p.is_file() and p.stat().st_size > 0]
        assert bekleyen, "satır kuyrukta ya da .isleniyor dosyasında durmalıydı"
        assert any("tulum" in p.read_text(encoding="utf-8") for p in bekleyen)
    finally:
        kilit.rollback()
        kilit.close()
    son = time.time() + 15
    while time.time() < son and not any("tulum" in m for m in olgular(ortam["db"])):
        time.sleep(0.5)
    assert any("tulum" in m for m in olgular(ortam["db"]))
