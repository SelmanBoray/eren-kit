"""Statik dosyalar için koşullu istek (ETag + If-None-Match -> 304), sözleşmeden.

Sözleşme:
- Statik yanıtlar içeriğe bağlı güçlü ETag (çift tırnaklı, W/ öneksiz) ve `Cache-Control: no-cache` taşır.
- Geçerli `If-None-Match` (tek değer, liste, `*`) gövdesiz 304 verir; aynı ETag/Cache-Control döner.
- İçerik değişince ETag değişir. /api/* yanıtları no-store kalır, ETag taşımaz, 304 olmaz.
- Güvenlik denetimleri (Host vb.) 304 yolundan ÖNCE çalışır; var olmayan dosya 404 kalır.
"""
from __future__ import annotations

import http.client
import shutil
import threading

import pytest

from bellek.beyin import servis

JS = "/static/app.js"
CSS = "/static/stil.css"
PNG = "/static/ikon-180.png"


def _sunucu_ac(kok, mp):
    yerel = kok / "yerel"  # sahte %LOCALAPPDATA%: gerçek Bellek klasörüne dokunulmaz
    yerel.mkdir()
    mp.setenv("LOCALAPPDATA", str(yerel))
    mp.setenv("BELLEK_BEYIN_DB", str(kok / "beyin.db"))
    mp.setenv("BELLEK_BEYIN_KUYRUK", str(kok / "kuyruk.jsonl"))
    mp.setenv("BELLEK_BEYIN_LOG", str(kok / "servis.log"))
    mp.setenv("BELLEK_BEYIN_TOKEN_DOSYA", str(kok / "token"))
    mp.setenv("BELLEK_BEYIN_ARAYUZ_TOKEN_DOSYA", str(kok / "arayuz_token"))
    mp.delenv("BELLEK_BEYIN_IZINLI_HOST", raising=False)
    s, _ = servis.sunucu_olustur("127.0.0.1", 0)  # geçici port
    t = threading.Thread(target=s.serve_forever, daemon=True)
    t.start()
    return s, t


def _kapat(s, t):
    s.shutdown()
    s.kapat()
    t.join(timeout=5)


@pytest.fixture(scope="module")
def port(tmp_path_factory):
    kok = tmp_path_factory.mktemp("statik_onbellek")
    with pytest.MonkeyPatch.context() as mp:
        s, t = _sunucu_ac(kok, mp)
        try:
            yield s.server_address[1]
        finally:
            _kapat(s, t)


@pytest.fixture
def kopya_port(tmp_path, monkeypatch):
    """Statik kökü tmp_path'teki bir kopyaya yönlendirilmiş sunucu (gerçek dosyalar değişmez)."""
    web = tmp_path / "web"
    shutil.copytree(servis.WEB_KOK, web)
    monkeypatch.setattr(servis, "WEB_KOK", web)
    s, t = _sunucu_ac(tmp_path, monkeypatch)
    try:
        yield s.server_address[1], web
    finally:
        _kapat(s, t)


def _al(port: int, yol: str, basliklar: dict | None = None, host: str | None = None):
    """Her istekte yeni bağlantı; (durum, başlıklar sözlüğü küçük harfli, gövde baytı)."""
    b = {"Host": host if host is not None else f"127.0.0.1:{port}"}
    b.update(basliklar or {})
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        c.request("GET", yol, headers=b)
        r = c.getresponse()
        govde = r.read()
        return r.status, {k.lower(): v for k, v in r.getheaders()}, govde
    finally:
        c.close()


def _etag(port: int, yol: str) -> str:
    kod, b, _ = _al(port, yol)
    assert kod == 200, (yol, kod)
    assert "etag" in b, f"{yol} yanıtında ETag başlığı yok"
    return b["etag"]


def test_statik_js_etag_ve_cache_control(port):
    kod, b, govde = _al(port, JS)
    assert kod == 200 and govde
    assert "etag" in b, "ETag başlığı yok"
    e = b["etag"]
    assert len(e) >= 2 and e.startswith('"') and e.endswith('"'), e
    assert not e.startswith("W/"), e
    cc = b.get("cache-control", "")
    assert "no-cache" in cc and "no-store" not in cc, cc


def test_ayni_dosya_ayni_etag(port):
    assert _etag(port, JS) == _etag(port, JS)


def test_farkli_dosyalar_farkli_etag(port):
    assert _etag(port, JS) != _etag(port, CSS)


def test_if_none_match_eslesince_304(port):
    e = _etag(port, JS)
    kod, b, govde = _al(port, JS, {"If-None-Match": e})
    assert kod == 304, kod
    assert govde == b""
    assert b.get("etag") == e
    assert "no-cache" in b.get("cache-control", "")


def test_if_none_match_eslesmezse_200(port):
    _etag(port, JS)  # ETag desteği olmadan "eşleşmeme" anlamsız
    _, _, tam = _al(port, JS)
    kod, _, govde = _al(port, JS, {"If-None-Match": '"baska-deger"'})
    assert kod == 200
    assert govde == tam and len(govde) > 0


def test_if_none_match_liste_304(port):
    e = _etag(port, JS)
    kod, b, govde = _al(port, JS, {"If-None-Match": f'"x", {e}, "y"'})
    assert kod == 304, kod
    assert govde == b""
    assert b.get("etag") == e


def test_if_none_match_yildiz_304(port):
    _etag(port, JS)  # ETag desteğinin varlığı
    kod, _, govde = _al(port, JS, {"If-None-Match": "*"})
    assert kod == 304, kod
    assert govde == b""


def test_icerik_degisince_etag_degisir(kopya_port):
    port, web = kopya_port
    kod, b, eski_govde = _al(port, JS)
    assert kod == 200
    assert "etag" in b, "ETag başlığı yok"
    eski = b["etag"]
    yeni_icerik = b"// degisti-icerik-12345\n" + eski_govde
    (web / "app.js").write_bytes(yeni_icerik)
    kod, b2, govde = _al(port, JS, {"If-None-Match": eski})
    assert kod == 200, kod
    assert govde == yeni_icerik
    assert b2.get("etag") and b2["etag"] != eski


def test_ikili_png_etag_ve_304(port):
    e = _etag(port, PNG)
    assert e.startswith('"') and not e.startswith("W/")
    kod, b, govde = _al(port, PNG, {"If-None-Match": e})
    assert kod == 304, kod
    assert govde == b""
    assert b.get("etag") == e


def test_api_etag_yok_no_store_ve_304_yok(port):
    kod, b, _ = _al(port, "/api/saglik")
    assert kod == 200
    assert "etag" not in b
    assert "no-store" in b.get("cache-control", "")
    kod, b, _ = _al(port, "/api/saglik", {"If-None-Match": "*"})
    assert kod != 304
    assert kod == 200
    assert "etag" not in b


@pytest.mark.parametrize("host", ["evil.example", "127.0.0.1"])
def test_kotu_host_304_degil_ayni_red(port, host):
    _, _, _ = _al(port, JS)
    kod_referans, _, _ = _al(port, JS, host=host)
    assert kod_referans == 403, kod_referans
    kod, _, govde = _al(port, JS, {"If-None-Match": "*"}, host=host)
    assert kod == kod_referans
    assert kod != 304


def test_var_olmayan_statik_dosya_404(port):
    kod, _, _ = _al(port, "/static/yok-boyle-bir-dosya.js", {"If-None-Match": "*"})
    assert kod == 404, kod
