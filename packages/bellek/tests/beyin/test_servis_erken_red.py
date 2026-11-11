"""Gövdeli istek erken reddedilince istemci yanıtı eksiksiz okuyabilmeli (regresyon, sözleşmeden).

Sorun: servis gövdeyi okumadan reddedip bağlantıyı kapatıyordu. İstemci başlıkları ve gövdeyi
ayrı send() ile yolladığında, gövde kapanmış sokete düşer; karşı uç RST gönderir ve Windows
istemcide henüz okunmamış yanıtı silip ConnectionAborted/ConnectionReset fırlatır.

Yarışı belirleyici kılmak için testler ham soket kullanır: başlıklar gönderilir, ~300 ms
beklenir (sunucu bu arada reddetmiş olur), gövde ayrı send() ile gider, sonra yanıt okunur.

Sözleşme:
1. Content-Length > 0 bildiren istek erken reddedildiğinde (403/415/401/413/404) istemci
   durum satırını ve gövdeyi eksiksiz okur; bağlantı hatası görmez.
2. Gövdeli GET'ten sonra aynı bağlantıdaki ikinci istek ya doğru yanıtlanır ya da bağlantı
   temiz kapanır; gövde baytları istek gibi yorumlanmaz.
3. Boşaltma sınırlıdır: bildirdiği gövdeyi hiç göndermeyen istemci yanıtı alır ve sunucu
   bağlantıyı birkaç saniye içinde kapatır.
"""
from __future__ import annotations

import json
import socket
import threading
import time

import pytest

from bellek.beyin import servis

GOVDE_GECIKME = 0.3  # başlık -> gövde arası (sunucunun reddetmesine zaman tanır)
SOKET_ZAMAN = 10.0
KAPANIS_UST_SINIR = 10.0


@pytest.fixture(scope="module")
def sunucu(tmp_path_factory):
    kok = tmp_path_factory.mktemp("erken_red")
    yerel = kok / "yerel"  # sahte %LOCALAPPDATA%: gerçek Bellek klasörüne dokunulmaz
    yerel.mkdir()
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("LOCALAPPDATA", str(yerel))
        mp.setenv("BELLEK_BEYIN_DB", str(kok / "beyin.db"))
        mp.setenv("BELLEK_BEYIN_KUYRUK", str(kok / "kuyruk.jsonl"))
        mp.setenv("BELLEK_BEYIN_LOG", str(kok / "servis.log"))
        mp.setenv("BELLEK_BEYIN_TOKEN_DOSYA", str(kok / "token"))
        mp.setenv("BELLEK_BEYIN_ARAYUZ_TOKEN_DOSYA", str(kok / "arayuz_token"))
        mp.delenv("BELLEK_BEYIN_IZINLI_HOST", raising=False)
        s, _ = servis.sunucu_olustur("127.0.0.1", 0)  # geçici port
        is_ = threading.Thread(target=s.serve_forever, daemon=True)
        is_.start()
        try:
            yield {"port": s.server_address[1], "belirtec": s.belirtec}
        finally:
            s.shutdown()
            s.kapat()
            is_.join(timeout=5)


# ------------------------------------------------------------------ ham HTTP yardımcıları
def _baglan(port: int) -> socket.socket:
    k = socket.create_connection(("127.0.0.1", port), timeout=SOKET_ZAMAN)
    k.settimeout(SOKET_ZAMAN)
    return k


def _basliklar(sunucu: dict, yontem: str, yol: str, *, uzunluk: int, ek: dict | None = None,
               belirtec: bool = True, tur: str | None = "application/json") -> bytes:
    satirlar = [f"{yontem} {yol} HTTP/1.1", f"Host: 127.0.0.1:{sunucu['port']}"]
    if tur is not None:
        satirlar.append(f"Content-Type: {tur}")
    if belirtec:
        satirlar.append(f"{servis.BELIRTEC_BASLIGI}: {sunucu['belirtec']}")
    for ad, deger in (ek or {}).items():
        satirlar.append(f"{ad}: {deger}")
    satirlar.append(f"Content-Length: {uzunluk}")
    return ("\r\n".join(satirlar) + "\r\n\r\n").encode("ascii")


class _Okuyucu:
    """Bir bağlantıdan art arda HTTP/1.1 yanıtı okur (Content-Length ile çerçeveli)."""

    def __init__(self, k: socket.socket) -> None:
        self.k = k
        self.tampon = b""
        self.eof = False

    def _doldur(self) -> bool:
        parca = self.k.recv(65536)
        if not parca:
            self.eof = True
            return False
        self.tampon += parca
        return True

    def yanit(self) -> tuple[int, dict, bytes] | None:
        """Bir yanıt döndürür; bağlantı yanıt başlamadan temiz kapandıysa None."""
        while b"\r\n\r\n" not in self.tampon:
            if not self._doldur():
                # Başlıksız ham veri: ör. gövde baytları HTTP/0.9 isteği sanılıp yanıtlanmış.
                assert not self.tampon, f"HTTP yanıtı olmayan veri ya da yarım başlık: {self.tampon[:200]!r}"
                return None
        bas, self.tampon = self.tampon.split(b"\r\n\r\n", 1)
        satirlar = bas.decode("iso-8859-1").split("\r\n")
        kod = int(satirlar[0].split(" ", 2)[1])
        basliklar = {}
        for s in satirlar[1:]:
            ad, _, deger = s.partition(":")
            basliklar[ad.strip().lower()] = deger.strip()
        n = int(basliklar.get("content-length", "0"))
        while len(self.tampon) < n:
            assert self._doldur(), f"yanıt gövdesi yarım kaldı ({len(self.tampon)}/{n} bayt)"
        govde, self.tampon = self.tampon[:n], self.tampon[n:]
        return kod, basliklar, govde

    def eof_bekle(self, ust_sinir: float) -> float:
        """Karşı uç bağlantıyı kapatana dek okur; geçen süreyi döndürür. Ek veri gelmemeli."""
        bas = time.monotonic()
        self.k.settimeout(ust_sinir)
        while not self.eof:
            self._doldur()
        assert not self.tampon, f"kapanıştan önce beklenmeyen veri: {self.tampon[:200]!r}"
        return time.monotonic() - bas


def _gecikmeli_istek(sunucu: dict, basliklar: bytes, govde: bytes) -> tuple[int, dict, bytes]:
    """Başlıklar -> GOVDE_GECIKME -> gövde (ayrı send) -> yanıtı oku."""
    k = _baglan(sunucu["port"])
    try:
        k.sendall(basliklar)
        time.sleep(GOVDE_GECIKME)
        k.sendall(govde)
        y = _Okuyucu(k).yanit()
        assert y is not None, "sunucu yanıt vermeden bağlantıyı kapattı"
        return y
    finally:
        k.close()


# ------------------------------------------------------------------ 1. erken red + gecikmeli gövde
GOVDE = json.dumps({"metin": "erken red sınaması " + "x" * 2000}).encode("utf-8")

DURUMLAR = {
    "kotu_origin_403": dict(yol="/api/yaz", kod=403, ek={"Origin": "http://kotu.example"}),
    "yanlis_tur_415": dict(yol="/api/yaz", kod=415, tur="text/plain"),
    "belirtecsiz_401": dict(yol="/api/yaz", kod=401, belirtec=False),
    "bilinmeyen_rota_404": dict(yol="/api/yok-boyle-bir-rota", kod=404),
}


@pytest.mark.parametrize("ad", list(DURUMLAR))
def test_erken_red_gecikmeli_govde_yanit_okunur(sunucu, ad):
    d = DURUMLAR[ad]
    bas = _basliklar(sunucu, "POST", d["yol"], uzunluk=len(GOVDE), ek=d.get("ek"),
                     belirtec=d.get("belirtec", True), tur=d.get("tur", "application/json"))
    kod, basliklar, govde = _gecikmeli_istek(sunucu, bas, GOVDE)
    assert kod == d["kod"]
    assert int(basliklar["content-length"]) == len(govde) > 0
    assert "hata" in json.loads(govde.decode("utf-8"))


def test_erken_red_413_kismi_govde_yanit_okunur(sunucu):
    bildirilen = servis.MAX_GOVDE + 1024 * 1024  # 1 MB sınırının üstü
    bas = _basliklar(sunucu, "POST", "/api/yaz", uzunluk=bildirilen)
    kod, basliklar, govde = _gecikmeli_istek(sunucu, bas, b"{" + b"x" * 8191)  # yalnız 8 KB
    assert kod == 413
    assert int(basliklar["content-length"]) == len(govde) > 0
    assert "hata" in json.loads(govde.decode("utf-8"))


# ------------------------------------------------------------------ 2. gövdeli GET
def test_govdeli_get_govdesi_istek_olarak_yorumlanmaz(sunucu):
    # Gövde, kendi başına ayrıştırılırsa "bozuk istek" (400) üretecek baytlardır.
    govde = b"bozukgovde\r\n\r\n"
    bas = _basliklar(sunucu, "GET", "/api/saglik", uzunluk=len(govde), tur=None)
    k = _baglan(sunucu["port"])
    try:
        k.sendall(bas + govde)
        ok = _Okuyucu(k)
        ilk = ok.yanit()
        assert ilk is not None and ilk[0] == 200, ilk
        if ilk[1].get("connection", "").lower() == "close":
            ok.eof_bekle(KAPANIS_UST_SINIR)  # temiz kapanış: başka yanıt yok
            return
        ikinci_istek = (f"GET /api/saglik HTTP/1.1\r\nHost: 127.0.0.1:{sunucu['port']}\r\n"
                        "Connection: close\r\n\r\n").encode("ascii")
        k.sendall(ikinci_istek)
        ikinci = ok.yanit()
        if ikinci is not None:
            assert ikinci[0] == 200, f"gövde baytları istek gibi yorumlandı: {ikinci[0]} {ikinci[2]!r}"
            assert json.loads(ikinci[2].decode("utf-8")).get("durum") == "ok"
            ok.eof_bekle(KAPANIS_UST_SINIR)
    finally:
        k.close()


# ------------------------------------------------------------------ 3. sınırlı boşaltma
def test_govde_hic_gelmezse_yanit_alinir_ve_baglanti_kapanir(sunucu):
    bas = _basliklar(sunucu, "POST", "/api/yaz", uzunluk=4096, ek={"Origin": "http://kotu.example"})
    k = _baglan(sunucu["port"])
    try:
        k.sendall(bas)  # gövde hiç gönderilmez
        bas_zaman = time.monotonic()
        ok = _Okuyucu(k)
        y = ok.yanit()
        assert y is not None and y[0] == 403, y
        ok.eof_bekle(KAPANIS_UST_SINIR)
        assert time.monotonic() - bas_zaman < KAPANIS_UST_SINIR
    finally:
        k.close()
