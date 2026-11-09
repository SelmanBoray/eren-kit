"""Ek Host izni (BELLEK_BEYIN_IZINLI_HOST): gerçek alt süreç servisle uçtan uca (sözleşmeden).

Sözleşme: değişken virgülle ayrılmış Host değerleri taşır (kırpılır, küçük harfe çevrilir,
boş öğeler atlanır, tam eşleşme, joker yok). İzinli küme = 127.0.0.1:<port>, localhost:<port>
+ değişkendeki öğeler. Origin kuralı değişmez: yok ya da tam `http://` + Host.
"""

from __future__ import annotations

import http.client
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

from bellek.beyin import db
from tests._surec import YENI_OTURUM, agaci_oldur

SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "src"))
DIS_HOST = "desktop-test.example.ts.net"


def _bos_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def _oku(yol: Path) -> str:
    try:
        return yol.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _istek(port: int, yol: str, *, host: str | None, origin: str | None = None,
           ui: str | None = None) -> int:
    b: dict = {}
    if host is not None:
        b["Host"] = host
    if origin is not None:
        b["Origin"] = origin
    if ui is not None:
        b["X-Beyin-Arayuz"] = ui
    con = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        con.putrequest("GET", yol, skip_host=True, skip_accept_encoding=True)
        for k, v in b.items():
            con.putheader(k, v)
        con.endheaders()
        r = con.getresponse()
        r.read()
        return r.status
    finally:
        con.close()


class Servis:
    def __init__(self, kok: Path, izinli: str | None):
        self.kok = kok
        kok.mkdir(parents=True)
        self.port = _bos_port()
        self.proc: subprocess.Popen | None = None
        yol = str(kok / "beyin.db")
        db.baglan(yol).close()
        yerel = kok / "yerel"
        yerel.mkdir()
        env = dict(os.environ)
        env.pop("BELLEK_BEYIN_IZINLI_HOST", None)
        env.update(
            LOCALAPPDATA=str(yerel),
            BELLEK_BEYIN_DB=yol,
            BELLEK_BEYIN_PORT=str(self.port),
            BELLEK_BEYIN_KUYRUK=str(kok / "kuyruk.jsonl"),
            BELLEK_BEYIN_LOG=str(kok / "servis.log"),
            BELLEK_BEYIN_KOPRU_LOG=str(kok / "kopru.log"),
            BELLEK_BEYIN_TOKEN_DOSYA=str(kok / "token"),
            BELLEK_BEYIN_ARAYUZ_TOKEN_DOSYA=str(kok / "arayuz_token"),
            PYTHONPATH=SRC + os.pathsep + os.environ.get("PYTHONPATH", ""),
            PYTHONIOENCODING="utf-8",
        )
        if izinli is not None:
            env["BELLEK_BEYIN_IZINLI_HOST"] = izinli
        self.env = env

    def baslat(self) -> "Servis":
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "bellek.beyin", "servis", "--port", str(self.port)],
            env=self.env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, **YENI_OTURUM)
        son = time.time() + 15
        while time.time() < son:
            if self.proc.poll() is not None:
                raise AssertionError("servis erken çıktı: "
                                     + self.proc.stderr.read().decode("utf-8", "replace"))
            try:
                if self.get("/api/saglik", host=f"127.0.0.1:{self.port}") == 200:
                    return self
            except Exception:
                pass
            time.sleep(0.2)
        raise AssertionError("servis 15 sn'de hazır olmadı")

    @property
    def ui_token(self) -> str:
        return _oku(self.kok / "arayuz_token")

    def get(self, yol: str, **kw) -> int:
        return _istek(self.port, yol, **kw)

    def kapat(self) -> None:
        p = self.proc
        if p is None:
            return
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


@pytest.fixture()
def servis_fabrikasi(tmp_path):
    olusan: list[Servis] = []

    def yap(izinli: str | None) -> Servis:
        s = Servis(tmp_path / f"s{len(olusan)}", izinli)
        olusan.append(s)
        return s.baslat()

    try:
        yield yap
    finally:
        for s in olusan:
            s.kapat()


def test_izinli_host_saglik_200_digeri_403(servis_fabrikasi):
    s = servis_fabrikasi(DIS_HOST)
    assert s.get("/api/saglik", host=DIS_HOST) == 200
    assert s.get("/api/saglik", host="kotu.example") == 403
    # yerel Host'lar değişkenle birlikte de çalışmaya devam eder
    assert s.get("/api/saglik", host=f"127.0.0.1:{s.port}") == 200
    assert s.get("/api/saglik", host=f"localhost:{s.port}") == 200
    # tam eşleşme: joker / alt alan adı / önek kabul edilmez
    assert s.get("/api/saglik", host="x." + DIS_HOST) == 403
    assert s.get("/api/saglik", host=DIS_HOST + ":1234") == 403


def test_buyuk_harf_bosluk_ve_bos_ogeler(servis_fabrikasi):
    s = servis_fabrikasi(" Desktop-X.TS.net , ,ikinci:8080 ")
    assert s.get("/api/saglik", host="desktop-x.ts.net") == 200
    assert s.get("/api/saglik", host="ikinci:8080") == 200
    assert s.get("/api/saglik", host="baska.example") == 403


def test_izinli_host_ile_arayuz_ucu_origin_ve_belirtec(servis_fabrikasi):
    s = servis_fabrikasi(DIS_HOST)
    ui = s.ui_token
    assert ui
    assert s.get("/api/ui/graf", host=DIS_HOST, ui=ui, origin=f"http://{DIS_HOST}") == 200
    # Origin kuralı değişmez: Host ile eşleşmeyen Origin reddedilir
    assert s.get("/api/ui/graf", host=DIS_HOST, ui=ui,
                 origin=f"http://127.0.0.1:{s.port}") == 403
    # belirteçsiz 401
    assert s.get("/api/ui/graf", host=DIS_HOST, origin=f"http://{DIS_HOST}") == 401


def test_degisken_yokken_dis_host_403(servis_fabrikasi):
    s = servis_fabrikasi(None)
    assert s.get("/api/saglik", host=DIS_HOST) == 403
    assert s.get("/api/saglik", host=f"127.0.0.1:{s.port}") == 200
    assert s.get("/api/saglik", host=f"localhost:{s.port}") == 200


# ---------------------------------------------------------------- izinli dış Host: sayfa ve POST

def _tam_istek(s: "Servis", yontem: str, yol: str, *, host: str, ui: str | None = None,
               origin: str | None = None, sec_fetch: str | None = None,
               govde: dict | None = None, ana: str | None = None) -> tuple[int, bytes]:
    import json

    b: dict = {"Host": host}
    if ui is not None:
        b["X-Beyin-Arayuz"] = ui
    if ana is not None:
        b["X-Beyin-Token"] = ana
    if origin is not None:
        b["Origin"] = origin
    if sec_fetch is not None:
        b["Sec-Fetch-Site"] = sec_fetch
    veri = None
    if govde is not None:
        veri = json.dumps(govde).encode("utf-8")
        b["Content-Type"] = "application/json"
        b["Content-Length"] = str(len(veri))
    con = http.client.HTTPConnection("127.0.0.1", s.port, timeout=10)
    try:
        con.putrequest(yontem, yol, skip_host=True, skip_accept_encoding=True)
        for k, v in b.items():
            con.putheader(k, v)
        con.endheaders(veri)
        r = con.getresponse()
        return r.status, r.read()
    finally:
        con.close()


def _gelen_tohumla(s: "Servis") -> str:
    con = db.baglan(str(s.kok / "beyin.db"))
    try:
        with con:
            return db.gelen_ekle(con, "yeni_dugum", {
                "metin": "dış host testi", "baslik": "DisHost",
                "ebeveyn": db.kok_id(con), "adaylar": []})
    finally:
        con.close()


def test_izinli_host_ile_sayfa_ve_statik_dosya_200(servis_fabrikasi):
    s = servis_fabrikasi(DIS_HOST)
    assert s.get("/", host=DIS_HOST) == 200
    assert s.get("/static/app.js", host=DIS_HOST) == 200
    # tarayıcı aynı kökenli yüklemede Origin gönderebilir
    assert s.get("/", host=DIS_HOST, origin=f"http://{DIS_HOST}") == 200


def test_izinli_host_ile_arayuz_post_denetimden_gecer(servis_fabrikasi):
    s = servis_fabrikasi(DIS_HOST)
    gid = _gelen_tohumla(s)
    kod, ham = _tam_istek(s, "POST", "/api/ui/gelen/karar", host=DIS_HOST, ui=s.ui_token,
                          origin=f"http://{DIS_HOST}", sec_fetch="same-origin",
                          govde={"id": gid, "karar": "red"})
    assert kod not in (401, 403), (kod, ham)
    assert kod == 200, (kod, ham)


def test_izinli_host_https_origin_post_403(servis_fabrikasi):
    s = servis_fabrikasi(DIS_HOST)
    gid = _gelen_tohumla(s)
    kod, _ = _tam_istek(s, "POST", "/api/ui/gelen/karar", host=DIS_HOST, ui=s.ui_token,
                        origin=f"https://{DIS_HOST}", govde={"id": gid, "karar": "red"})
    assert kod == 403
    # reddedilen istek durumu değiştirmemeli
    con = db.baglan(str(s.kok / "beyin.db"))
    try:
        assert con.execute("SELECT durum FROM gelen WHERE id = ?", (gid,)).fetchone()[0] == "bekliyor"
    finally:
        con.close()


def test_izinli_host_cross_site_arayuz_istegi_403(servis_fabrikasi):
    s = servis_fabrikasi(DIS_HOST)
    ui = s.ui_token
    kod, _ = _tam_istek(s, "GET", "/api/ui/graf", host=DIS_HOST, ui=ui, sec_fetch="cross-site")
    assert kod == 403
    kod, _ = _tam_istek(s, "GET", "/api/ui/graf", host=DIS_HOST, ui=ui, sec_fetch="same-origin")
    assert kod == 200


def test_izinli_host_ana_api_belirtecsiz_401_origin_403(servis_fabrikasi):
    s = servis_fabrikasi(DIS_HOST)
    ana = (s.kok / "token").read_text(encoding="utf-8").strip()
    assert ana
    assert _tam_istek(s, "GET", "/api/gez", host=DIS_HOST)[0] == 401
    assert _tam_istek(s, "GET", "/api/gez", host=DIS_HOST, ana=ana,
                      origin=f"http://{DIS_HOST}")[0] == 403
    assert _tam_istek(s, "GET", "/api/gez", host=DIS_HOST, ana=ana)[0] == 200
