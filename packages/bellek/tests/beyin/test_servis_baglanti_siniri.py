"""Eşzamanlı bağlantı sınırı (güvenlik denetimi B8).

Her bağlantı bir iş parçacığı tutar (SOKET_ZAMAN_ASIMI boyunca). Sınır yokken yerel bir süreç
binlerce boş bağlantı açıp binlerce iş parçacığı yaratabilirdi. Sınır dolunca yeni bağlantı
hemen kapatılır; boşalınca servis normal yanıt verir.
"""
from __future__ import annotations

import json
import socket
import threading
import time
import urllib.request

import pytest

from bellek.beyin import servis


@pytest.fixture()
def sunucu(tmp_path, monkeypatch):
    monkeypatch.setattr(servis, "AZAMI_BAGLANTI", 3)
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(tmp_path / "beyin.db"))
    monkeypatch.setenv("BELLEK_BEYIN_KUYRUK", str(tmp_path / "kuyruk.jsonl"))
    monkeypatch.setenv("BELLEK_BEYIN_LOG", str(tmp_path / "servis.log"))
    monkeypatch.setenv("BELLEK_BEYIN_TOKEN_DOSYA", str(tmp_path / "token"))
    monkeypatch.setenv("BELLEK_BEYIN_ARAYUZ_TOKEN_DOSYA", str(tmp_path / "arayuz_token"))
    monkeypatch.delenv("BELLEK_BEYIN_IZINLI_HOST", raising=False)
    s, _ = servis.sunucu_olustur("127.0.0.1", 0)
    is_ = threading.Thread(target=s.serve_forever, daemon=True)
    is_.start()
    try:
        yield s.server_address[1]
    finally:
        s.shutdown()
        s.kapat()
        is_.join(timeout=5)


def _saglik(port: int) -> dict:
    istek = urllib.request.Request(f"http://127.0.0.1:{port}/api/saglik")
    acici = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with acici.open(istek, timeout=5) as y:
        return json.loads(y.read())


def _kapandi_mi(k: socket.socket, sure: float = 3.0) -> bool:
    k.settimeout(sure)
    try:
        return k.recv(1) == b""
    except (ConnectionResetError, ConnectionAbortedError):
        return True
    except socket.timeout:
        return False


def test_sinir_dolunca_yeni_baglanti_kapatilir_bosalinca_hizmet_surer(sunucu):
    port = sunucu
    bos = [socket.create_connection(("127.0.0.1", port), timeout=5) for _ in range(3)]
    try:
        time.sleep(0.3)  # sunucu üçünü de kabul edip iş parçacığına versin
        fazla = socket.create_connection(("127.0.0.1", port), timeout=5)
        try:
            assert _kapandi_mi(fazla), "sınır aşan bağlantı açık kaldı"
        finally:
            fazla.close()
    finally:
        for k in bos:
            k.close()
    son = time.monotonic() + 8
    while True:
        try:
            yanit = _saglik(port)
            break
        except Exception:
            if time.monotonic() > son:
                raise
            time.sleep(0.1)
    assert isinstance(yanit, dict)


def test_sinir_altinda_bosta_baglanti_hemen_kapatilmaz(sunucu):
    port = sunucu
    k = socket.create_connection(("127.0.0.1", port), timeout=5)
    try:
        assert not _kapandi_mi(k, 0.5)
    finally:
        k.close()
