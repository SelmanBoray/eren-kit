"""`ac --taban` sözleşme testleri.

Sözleşme:
- `--taban <adres>` verilirse adres `<taban, sondaki / kırpılmış>/#t=<belirteç>`.
- Verilmezse `http://127.0.0.1:<port>/#t=<belirteç>`.
- Taban http:// / https:// ile başlamıyorsa ya da `#` / `?` içeriyorsa çıkış kodu 2.
- Sağlık yoklaması her zaman 127.0.0.1:<port>'tan; servis kapalıysa çıkış 1.
- `--yazdir` ile adres stdout'a yazılır, tarayıcı açılmaz (her testte kullanılır).
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


def _bos_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def _ortam(kok: Path) -> dict:
    yol = str(kok / "beyin.db")
    con = db.baglan(yol)
    con.close()
    port = _bos_port()
    yerel = kok / "yerel"  # sahte %LOCALAPPDATA%
    yerel.mkdir()
    env = dict(os.environ)
    env.update(
        LOCALAPPDATA=str(yerel),
        BELLEK_BEYIN_DB=yol,
        BELLEK_BEYIN_PORT=str(port),
        BELLEK_BEYIN_KUYRUK=str(kok / "kuyruk.jsonl"),
        BELLEK_BEYIN_LOG=str(kok / "servis.log"),
        BELLEK_BEYIN_KOPRU_LOG=str(kok / "kopru.log"),
        BELLEK_BEYIN_TOKEN_DOSYA=str(kok / "token"),
        BELLEK_BEYIN_ARAYUZ_TOKEN_DOSYA=str(kok / "arayuz_token"),
        PYTHONPATH=SRC + os.pathsep + os.environ.get("PYTHONPATH", ""),
        PYTHONIOENCODING="utf-8",
    )
    return dict(port=port, env=env, surecler=[])


def _saglik_tamam(port: int) -> bool:
    try:
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
        c.request("GET", "/api/saglik")
        r = c.getresponse()
        r.read()
        c.close()
        return r.status == 200
    except Exception:
        return False


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


def _servis_baslat(o: dict) -> None:
    p = subprocess.Popen(
        [sys.executable, "-m", "bellek.beyin", "servis", "--port", str(o["port"])],
        env=o["env"], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **YENI_OTURUM,
    )
    o["surecler"].append(p)
    son = time.time() + 15
    while time.time() < son:
        if p.poll() is not None:
            raise AssertionError("servis erken çıktı: " + p.stderr.read().decode("utf-8", "replace"))
        if _saglik_tamam(o["port"]):
            return
        time.sleep(0.2)
    raise AssertionError("servis 15 sn'de hazır olmadı")


@pytest.fixture(scope="module")
def canli(tmp_path_factory):
    o = _ortam(tmp_path_factory.mktemp("ac_taban_canli"))
    try:
        _servis_baslat(o)
        yield o
    finally:
        _kapat(o["surecler"])


@pytest.fixture()
def kapali(tmp_path):
    """Servis başlatılmamış ortam."""
    o = _ortam(tmp_path)
    try:
        yield o
    finally:
        _kapat(o["surecler"])


def _ac(o: dict, *args: str) -> subprocess.CompletedProcess:
    # Her çağrıda --yazdir verilmeli: tarayıcı asla açılmaz.
    assert "--yazdir" in args
    return subprocess.run(
        [sys.executable, "-m", "bellek.beyin", "ac", "--port", str(o["port"]), *args],
        env=o["env"], stdin=subprocess.DEVNULL, capture_output=True, timeout=30)


def _cikti(p: subprocess.CompletedProcess) -> str:
    return p.stdout.decode("utf-8", "replace").strip()


def _hata(p: subprocess.CompletedProcess) -> str:
    return p.stderr.decode("utf-8", "replace")


def test_taban_adresi_ve_belirteci_tabansizla_ayni(canli):
    o = canli
    tabansiz = _ac(o, "--yazdir")
    assert tabansiz.returncode == 0, _hata(tabansiz)
    onek = f"http://127.0.0.1:{o['port']}/#t="
    assert _cikti(tabansiz).startswith(onek)
    belirtec = _cikti(tabansiz)[len(onek):]
    assert belirtec

    p = _ac(o, "--taban", "http://ornek.ts.net", "--yazdir")
    assert p.returncode == 0, _hata(p)
    cikti = _cikti(p)
    assert cikti.startswith("http://ornek.ts.net/#t=")
    assert cikti == f"http://ornek.ts.net/#t={belirtec}"
    assert "127.0.0.1" not in cikti


def test_taban_sondaki_egik_cizgi_kirpilir(canli):
    o = canli
    a = _ac(o, "--taban", "http://ornek.ts.net", "--yazdir")
    b = _ac(o, "--taban", "http://ornek.ts.net/", "--yazdir")
    assert a.returncode == 0, _hata(a)
    assert b.returncode == 0, _hata(b)
    assert _cikti(b) == _cikti(a)
    assert "//#" not in _cikti(b)
    assert _cikti(b).startswith("http://ornek.ts.net/#t=")


def test_taban_sunum_ve_yol_korunur_https_kabul(canli):
    o = canli
    p = _ac(o, "--taban", "https://ornek.ts.net:8443/", "--yazdir")
    assert p.returncode == 0, _hata(p)
    assert _cikti(p).startswith("https://ornek.ts.net:8443/#t=")


@pytest.mark.parametrize("taban", ["ornek.ts.net", "http://a/#x", "http://a/?x=1", "ftp://a"])
def test_gecersiz_taban_cikis_2(canli, taban):
    p = _ac(canli, "--taban", taban, "--yazdir")
    assert p.returncode == 2, (p.returncode, _hata(p))
    assert "#t=" not in _cikti(p)


def test_gecersiz_taban_servis_kapaliyken_de_cikis_2(kapali):
    # Doğrulama sağlık yoklamasından önce gelir: kapalı serviste de 2.
    p = _ac(kapali, "--taban", "ornek.ts.net", "--yazdir")
    assert p.returncode == 2, (p.returncode, _hata(p))


def test_servis_kapaliyken_taban_ile_cikis_1(kapali):
    p = _ac(kapali, "--taban", "http://ornek.ts.net", "--yazdir")
    assert p.returncode == 1, (p.returncode, _hata(p))
    assert "#t=" not in _cikti(p)
    assert _hata(p).strip()


def test_tabansiz_cikti_eskisi_gibi(canli):
    o = canli
    p = _ac(o, "--yazdir")
    assert p.returncode == 0, _hata(p)
    cikti = _cikti(p)
    assert cikti.startswith(f"http://127.0.0.1:{o['port']}/#t=")
    assert len(cikti) > len(f"http://127.0.0.1:{o['port']}/#t=")
