"""Servis bağlanırken ters DNS (socket.getfqdn) çağırmamalı: macOS'ta (ör. GitHub runner)
127.0.0.1 için ters sorgu dakikalarca takılabilir ve servis hiç açılmaz."""
import socket
from http.server import BaseHTTPRequestHandler

from bellek.beyin import servis


def test_server_bind_getfqdn_cagirmaz(monkeypatch):
    def yasak(*a, **k):
        raise AssertionError("server_bind ters DNS sorgusu yaptı (socket.getfqdn)")

    monkeypatch.setattr(socket, "getfqdn", yasak)
    s = servis._Sunucu(("127.0.0.1", 0), BaseHTTPRequestHandler)
    try:
        host, port = s.server_address[:2]
        assert host == "127.0.0.1" and port > 0
        assert s.server_name == "127.0.0.1" and s.server_port == port
    finally:
        s.server_close()
