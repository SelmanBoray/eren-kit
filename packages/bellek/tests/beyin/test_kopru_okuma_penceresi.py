"""Köprünün okuma yolu ve bekleme penceresi (süreç içi, sahte servislerle).

Regresyon: servis ayaktayken tek bir okuma zaman aşımına uğrayınca köprü sonraki okumaları
15 sn boyunca servise hiç sormadan salt-okunur yedeğe düşürüyor ve yanıtı "servis kapalı"
önekiyle veriyordu. Servis gerçekten kapalıyken (bağlantı reddi) ise okumalar her seferinde
bağlantı bedeli ödememeli; bu koruma da burada sınanır.
"""

from __future__ import annotations

import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from bellek.beyin import db

KAPALI_ONEKI = "[servis kapalı; salt-okunur yedekten]"
YANITSIZ_ONEKI = "[servis yanıt vermedi; salt-okunur yedekten]"
SERVISTEN = "servisten:"


def _bos_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


@pytest.fixture()
def kopru(tmp_path, monkeypatch):
    """Süreç içi mcp_kopru: yollar tmp'ye, port boş bir yerel port, modül durumu sıfır."""
    from bellek.beyin import mcp_kopru

    yol = tmp_path / "beyin.db"
    con = db.baglan(str(yol))
    with con:
        kok = db.kok_id(con)
        dal = db.dugum_ekle(con, "Müzik", ozet="müzik zevkleri", ebeveyn=kok)
        dugum = db.dugum_ekle(con, "Zeybekoloji", ozet="zeybek dansı üzerine", ebeveyn=dal)
        db.olgu_ekle(con, dugum, "Kullanıcı zeybekoloji dersini sever")
    con.close()
    port = _bos_port()
    assert port != mcp_kopru.VARSAYILAN_PORT
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(yol))
    monkeypatch.setenv("BELLEK_BEYIN_PORT", str(port))
    monkeypatch.setenv("BELLEK_BEYIN_KUYRUK", str(tmp_path / "kuyruk.jsonl"))
    monkeypatch.setenv("BELLEK_BEYIN_KOPRU_LOG", str(tmp_path / "kopru.log"))
    monkeypatch.setenv("BELLEK_BEYIN_TOKEN_DOSYA", str(tmp_path / "token"))
    monkeypatch.setattr(mcp_kopru, "_kapali_bitis", 0.0)
    monkeypatch.setattr(mcp_kopru, "_belirtec_imza", None)
    monkeypatch.setattr(mcp_kopru, "_belirtec_deger", None)
    # Bağlantı denemelerini say: penceredeyken servise hiç sorulmadığını göstermek için.
    gercek = mcp_kopru._ACICI
    sayac = {"open": 0}

    class _SayanAcici:
        def open(self, *a, **kw):
            sayac["open"] += 1
            return gercek.open(*a, **kw)

    monkeypatch.setattr(mcp_kopru, "_ACICI", _SayanAcici())
    # Test bilgisi modüle iliştirilir; monkeypatch test sonunda kaldırır.
    for ad, deger in (("test_port", port), ("test_dugum", dugum), ("test_sayac", sayac)):
        monkeypatch.setattr(mcp_kopru, ad, deger, raising=False)
    return mcp_kopru


class _SahteServis:
    """Sağlığa her zaman 'ok' der; diğer GET'lerden ilk `yavas` tanesini `gecikme` sn bekletir."""

    def __init__(self, port: int, yavas: int, gecikme: float) -> None:
        self.yollar: list[str] = []
        self.yavas_kalan = yavas
        kendi = self

        class Isleyici(BaseHTTPRequestHandler):
            def log_message(self, *a, **k):
                pass

            def do_GET(self):
                if self.path.startswith("/api/saglik"):
                    nesne = {"durum": "ok"}
                else:
                    kendi.yollar.append(self.path)
                    if kendi.yavas_kalan > 0:
                        kendi.yavas_kalan -= 1
                        time.sleep(gecikme)
                    yol = self.path.split("?", 1)[0]
                    nesne = {"gelen": []} if yol == "/api/gelen" else {"metin": f"{SERVISTEN} {yol}"}
                govde = json.dumps(nesne, ensure_ascii=False).encode("utf-8")
                try:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(govde)))
                    self.end_headers()
                    self.wfile.write(govde)
                except OSError:
                    pass  # istemci zaman aşımında bağlantıyı bırakmış olabilir

        self.sunucu = ThreadingHTTPServer(("127.0.0.1", port), Isleyici)
        self.sunucu.daemon_threads = True
        threading.Thread(target=self.sunucu.serve_forever, daemon=True).start()

    def kapat(self) -> None:
        self.sunucu.shutdown()
        self.sunucu.server_close()


def test_tek_zaman_asimi_sonraki_okumalari_yedege_dusurmez(kopru, monkeypatch):
    """Gözlenen olay: servis ayakta, ilk okuma zaman aşımı; hemen ardından gelen okumalar
    (ara, oku, oku, ara, gelen liste) servisten gelmeli, hiçbiri 'servis kapalı' dememeli."""
    monkeypatch.setattr(kopru, "HTTP_ZAMAN_ASIMI", 0.5)
    sahte = _SahteServis(kopru.test_port, yavas=1, gecikme=1.5)
    try:
        ilk = kopru.arac_ara({"sorgu": "zeybek"})
        sonra = [
            kopru.arac_ara({"sorgu": "zeybek"}),
            kopru.arac_oku({"id": kopru.test_dugum}),
            kopru.arac_oku({"id": kopru.test_dugum}),
            kopru.arac_ara({"sorgu": "zeybek"}),
            kopru.arac_gez({}),
        ]
        gelen = kopru.arac_gelen({"islem": "liste"})
    finally:
        sahte.kapat()
    for metin in sonra:
        assert metin.startswith(SERVISTEN), metin
    assert gelen == "Gelen kutusu boş.", gelen
    assert len(sahte.yollar) == 7, sahte.yollar
    # İlk (yavaş) okuma yedekten döner ama servisin kapalı olduğunu iddia etmez.
    assert "Zeybekoloji" in ilk or kopru.test_dugum in ilk, ilk
    assert "servis kapalı" not in ilk, ilk
    assert ilk.startswith(YANITSIZ_ONEKI), ilk


def test_servis_kapaliyken_okumalar_baglanti_bedeli_odemez(kopru):
    """Bağlantı reddi: ilk okuma bağlanmayı dener, pencere içindeki okumalar servise hiç
    sormadan, hızla ve 'servis kapalı' önekiyle yedekten döner."""
    ilk = kopru.arac_ara({"sorgu": "zeybek"})  # portta kimse yok
    assert ilk.startswith(KAPALI_ONEKI), ilk
    assert kopru.test_sayac["open"] == 1
    bas = time.monotonic()
    metinler = [kopru.arac_oku({"id": kopru.test_dugum}), kopru.arac_ara({"sorgu": "zeybek"}),
                kopru.arac_gez({}), kopru.arac_oku({"id": kopru.test_dugum})]
    gelen = kopru.arac_gelen({"islem": "liste"})
    sure = time.monotonic() - bas
    assert kopru.test_sayac["open"] == 1, "pencere içinde bağlantı denendi"
    assert sure < 1.0, sure
    for metin in metinler:
        assert metin.startswith(KAPALI_ONEKI), metin
    assert gelen.startswith(KAPALI_ONEKI), gelen


def test_yanitsiz_servis_her_okumada_beklenmez(kopru, monkeypatch):
    """Port dinliyor ama hiç yanıt yok (askıda servis): ilk okuma zaman aşımı, ikincisi kısa
    sağlık yoklaması yapar ve o da yanıtsız kalınca pencere kesinleşir; sonrakiler servise
    sormadan, hızla ve 'yanıt vermedi' önekiyle döner."""
    monkeypatch.setattr(kopru, "HTTP_ZAMAN_ASIMI", 0.5)
    monkeypatch.setattr(kopru, "SAGLIK_ZAMAN_ASIMI", 0.5)
    dinle = socket.socket()
    dinle.bind(("127.0.0.1", kopru.test_port))
    dinle.listen(16)  # accept() yok: çekirdek bağlantıyı alır, kimse yanıt vermez
    try:
        ilk = kopru.arac_ara({"sorgu": "zeybek"})
        ikinci = kopru.arac_oku({"id": kopru.test_dugum})
        acilan = kopru.test_sayac["open"]
        bas = time.monotonic()
        sonra = [kopru.arac_ara({"sorgu": "zeybek"}), kopru.arac_oku({"id": kopru.test_dugum}),
                 kopru.arac_gez({})]
        sure = time.monotonic() - bas
    finally:
        dinle.close()
    assert acilan == 2, acilan  # ilk okuma + bir sağlık yoklaması; ikinci okumanın kendisi gitmedi
    assert kopru.test_sayac["open"] == acilan, "kesin pencere içinde bağlantı denendi"
    assert sure < 1.0, sure
    for metin in [ilk, ikinci, *sonra]:
        assert metin.startswith(YANITSIZ_ONEKI), metin
        assert "servis kapalı" not in metin, metin


def test_saglik_ok_ama_okumalar_hep_yavas_ikinci_zaman_asiminda_pencere(kopru, monkeypatch):
    """Sağlık yanıt veriyor ama her okuma zaman aşımına uğruyor: yoklamadan sonraki ikinci
    zaman aşımı pencereyi kesinleştirir; sonraki okumalar her seferinde beklemez."""
    monkeypatch.setattr(kopru, "HTTP_ZAMAN_ASIMI", 0.3)
    sahte = _SahteServis(kopru.test_port, yavas=100, gecikme=1.0)
    try:
        ilk = kopru.arac_ara({"sorgu": "zeybek"})
        ikinci = kopru.arac_ara({"sorgu": "zeybek"})
        acilan = kopru.test_sayac["open"]
        bas = time.monotonic()
        sonra = [kopru.arac_oku({"id": kopru.test_dugum}), kopru.arac_ara({"sorgu": "zeybek"})]
        sure = time.monotonic() - bas
    finally:
        sahte.kapat()
    assert acilan == 3, acilan  # okuma, yoklama + okuma
    assert len(sahte.yollar) == 2, sahte.yollar
    assert kopru.test_sayac["open"] == acilan
    assert sure < 1.0, sure
    for metin in [ilk, ikinci, *sonra]:
        assert metin.startswith(YANITSIZ_ONEKI), metin


def test_kapali_portta_yazma_yoklamasi_pencereyi_yanitsiza_cevirmez(kopru):
    """Regresyon: servis kapalıyken (port dinlemiyor) beyin_yaz'ın sağlık yoklaması, Windows'ta
    ~2 sn'de gelen reddi 2 sn'lik zaman aşımı olarak görüp 15 sn'lik 'yanıt vermedi' penceresi
    açıyordu. Gerçek zamanlamayla (zaman aşımları küçültülmeden): okumalar 'servis kapalı'
    demeli, pencere içinde bağlanmamalı, ret penceresi bitince servis yeniden sorulmalı."""
    ara1 = kopru.arac_ara({"sorgu": "zeybek"})  # portta kimse yok
    assert ara1.startswith(KAPALI_ONEKI), ara1
    yaz = kopru.arac_yaz({"metin": "Kullanıcı ney dinlemeyi sever", "dugum_id": kopru.test_dugum})
    assert "kuyru" in yaz.lower(), yaz
    acilan = kopru.test_sayac["open"]
    ara2 = kopru.arac_ara({"sorgu": "zeybek"})
    assert ara2.startswith(KAPALI_ONEKI), ara2
    assert kopru.test_sayac["open"] == acilan, "ret penceresi içinde bağlantı denendi"
    time.sleep(kopru.REDDEDILDI_BEKLEME + 0.5)  # 15 sn'lik pencere kalsaydı servis hâlâ atlanırdı
    sahte = _SahteServis(kopru.test_port, yavas=0, gecikme=0)
    try:
        ara3 = kopru.arac_ara({"sorgu": "zeybek"})
    finally:
        sahte.kapat()
    assert ara3.startswith(SERVISTEN), ara3


def test_pencere_bitince_servis_yeniden_denenir(kopru, monkeypatch):
    """Ret penceresi kısa sürer: süre dolunca okuma yeniden servise gider."""
    monkeypatch.setattr(kopru, "REDDEDILDI_BEKLEME", 0.2)
    ilk = kopru.arac_ara({"sorgu": "zeybek"})
    assert ilk.startswith(KAPALI_ONEKI), ilk
    time.sleep(0.3)
    sahte = _SahteServis(kopru.test_port, yavas=0, gecikme=0)
    try:
        sonra = kopru.arac_oku({"id": kopru.test_dugum})
    finally:
        sahte.kapat()
    assert sonra.startswith(SERVISTEN), sonra
