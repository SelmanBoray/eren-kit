"""Başlatma çakışması: kilit/port başka süreçteyse servis gözetmen bayrağıyla 0 ile çıkar
(macOS launchd sonsuza dek yeniden denemesin); bayraksız (Windows Görev Zamanlayıcı, elle)
her başlatma hatası eskisi gibi 1 ile biter. Gerçek çökmeler her durumda sıfır olmayan çıkıştır."""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

from bellek.beyin import db, servis
from tests._surec import YENI_OTURUM, agaci_oldur

SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "src"))


def _ortam(tmp_path) -> dict:
    yol = str(tmp_path / "beyin.db")
    db.baglan(yol).close()
    yerel = tmp_path / "yerel"  # sahte %LOCALAPPDATA%: gerçek Bellek klasörüne dokunulmaz
    yerel.mkdir(exist_ok=True)
    return dict(
        LOCALAPPDATA=str(yerel),
        BELLEK_BEYIN_DB=yol,
        BELLEK_BEYIN_KUYRUK=str(tmp_path / "kuyruk.jsonl"),
        BELLEK_BEYIN_LOG=str(tmp_path / "servis.log"),
        BELLEK_BEYIN_TOKEN_DOSYA=str(tmp_path / "token"),
        BELLEK_BEYIN_ARAYUZ_TOKEN_DOSYA=str(tmp_path / "arayuz_token"),
    )


@pytest.fixture()
def ortam(tmp_path, monkeypatch):
    e = _ortam(tmp_path)
    for k, v in e.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv(servis.CAKISMADA_TEMIZ_CIK, raising=False)
    return e


# ------------------------------------------------------------------ sınıflandırma

def test_kilit_cakismasi_zaten_calisiyor_olarak_siniflanir(tmp_path):
    k = servis.TekSurecKilidi(tmp_path)
    try:
        with pytest.raises(servis.ServisZatenCalisiyor) as e:
            servis.TekSurecKilidi(tmp_path)
        assert isinstance(e.value, servis.ServisBaslatilamadi)  # eski yakalayıcılar bozulmaz
    finally:
        k.birak()


def test_dolu_port_port_kullanimda_olarak_siniflanir(ortam):
    tutan = socket.socket()
    tutan.bind(("127.0.0.1", 0))
    tutan.listen(1)
    try:
        with pytest.raises(servis.PortKullanimda) as e:
            servis.Sunucu("127.0.0.1", tutan.getsockname()[1])
        assert isinstance(e.value, servis.ServisBaslatilamadi)
    finally:
        tutan.close()
    # Hata sonrası kilit bırakılmış olmalı: ikinci deneme açılabilir.
    s = servis.Sunucu("127.0.0.1", 0)
    s.kapat()


# ------------------------------------------------------------------ çıkış kodları (calistir)

class _SahteSunucu:
    server_address = ("127.0.0.1", 1)

    def __init__(self):
        self.kapandi = False

    def serve_forever(self):
        pass

    def kapat(self):
        self.kapandi = True


def _sirali(monkeypatch, *sonuclar):
    """sunucu_olustur sırayla verilen hataları fırlatır; sonra sahte sunucu döndürür."""
    kalan = list(sonuclar)
    cagri = []

    def sahte(host="127.0.0.1", port=None):
        cagri.append(port)
        if kalan:
            raise kalan.pop(0)
        return _SahteSunucu(), None

    monkeypatch.setattr(servis, "sunucu_olustur", sahte)
    return cagri


def _cikis_kodu(**kw) -> int:
    with pytest.raises(SystemExit) as e:
        servis.calistir(**kw)
    return e.value.code


@pytest.mark.parametrize("hata", [servis.ServisZatenCalisiyor("x"), servis.PortKullanimda("x"),
                                  servis.ServisBaslatilamadi("x")])
def test_bayraksiz_her_baslatma_hatasi_1(ortam, monkeypatch, hata):
    cagri = _sirali(monkeypatch, hata)
    assert _cikis_kodu() == 1
    assert len(cagri) == 1  # bayraksız port beklenmez


def test_bayrakla_kilit_cakismasi_0_ve_beklemez(ortam, monkeypatch):
    monkeypatch.setenv(servis.CAKISMADA_TEMIZ_CIK, "1")
    monkeypatch.setattr(servis.time, "sleep", lambda *_: pytest.fail("kilit çakışmasında beklendi"))
    cagri = _sirali(monkeypatch, servis.ServisZatenCalisiyor("x"))
    assert _cikis_kodu() == 0
    assert len(cagri) == 1


def test_bayrakla_diger_baslatma_hatasi_yine_1(ortam, monkeypatch):
    monkeypatch.setenv(servis.CAKISMADA_TEMIZ_CIK, "1")
    _sirali(monkeypatch, servis.ServisBaslatilamadi("belirteç okunamadı"))
    assert _cikis_kodu() == 1


def test_bayrakla_port_bosalinca_servis_acilir(ortam, monkeypatch):
    monkeypatch.setenv(servis.CAKISMADA_TEMIZ_CIK, "1")
    uykular = []
    monkeypatch.setattr(servis.time, "sleep", uykular.append)
    cagri = _sirali(monkeypatch, servis.PortKullanimda("x"), servis.PortKullanimda("x"))
    servis.calistir()  # çıkış yok: üçüncü denemede açıldı
    assert len(cagri) == 3 and len(uykular) == 2


def test_bayrakla_port_hep_doluysa_sure_sonunda_0(ortam, monkeypatch):
    monkeypatch.setenv(servis.CAKISMADA_TEMIZ_CIK, "1")
    saat = [1000.0]
    monkeypatch.setattr(servis.time, "monotonic", lambda: saat[0])
    monkeypatch.setattr(servis.time, "sleep", lambda s: saat.__setitem__(0, saat[0] + s))
    cagri = _sirali(monkeypatch, *[servis.PortKullanimda("x") for _ in range(1000)])
    assert _cikis_kodu() == 0
    beklenen = int(servis.PORT_BEKLEME / servis.PORT_BEKLEME_ARALIK) + 1
    assert len(cagri) == beklenen


def test_calisirken_istisna_disari_tasar_sifir_olmayan_cikis(ortam, monkeypatch):
    """Gerçek çökme (serve_forever'da yakalanmamış istisna) yutulmaz: süreç sıfır olmayan kodla biter."""
    monkeypatch.setenv(servis.CAKISMADA_TEMIZ_CIK, "1")
    s = _SahteSunucu()

    def patla():
        raise RuntimeError("çöktü")

    s.serve_forever = patla
    monkeypatch.setattr(servis, "sunucu_olustur", lambda host="127.0.0.1", port=None: (s, None))
    with pytest.raises(RuntimeError):
        servis.calistir()
    assert s.kapandi


# ------------------------------------------------------------------ uçtan uca: iki gerçek servis

def _bos_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def test_ikinci_servis_bayrakla_0_bayraksiz_1(tmp_path):
    port = _bos_port()
    env = dict(os.environ)
    env.pop(servis.CAKISMADA_TEMIZ_CIK, None)
    env.update(_ortam(tmp_path), BELLEK_BEYIN_PORT=str(port), PYTHONIOENCODING="utf-8",
               PYTHONPATH=SRC + os.pathsep + env.get("PYTHONPATH", ""))
    ilk = subprocess.Popen([sys.executable, "-m", "bellek.beyin", "servis"], env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **YENI_OTURUM)
    try:
        son = time.monotonic() + 30
        while True:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/saglik", timeout=2) as r:
                    if r.status == 200:
                        break
            except OSError:
                pass
            assert ilk.poll() is None, "ilk servis açılamadı"
            assert time.monotonic() < son, "ilk servis 30 sn'de hazır olmadı"
            time.sleep(0.2)
        komut = [sys.executable, "-m", "bellek.beyin", "servis"]
        bayraksiz = subprocess.run(komut, env=env, capture_output=True, text=True, encoding="utf-8", timeout=60)
        assert bayraksiz.returncode == 1, bayraksiz.stderr
        assert "zaten çalışıyor" in bayraksiz.stderr
        bayrakli = subprocess.run(komut, env={**env, servis.CAKISMADA_TEMIZ_CIK: "1"},
                                  capture_output=True, text=True, encoding="utf-8", timeout=60)
        assert bayrakli.returncode == 0, bayrakli.stderr
        assert "zaten çalışıyor" in bayrakli.stderr
        assert ilk.poll() is None  # ilk servis etkilenmedi
    finally:
        agaci_oldur(ilk)
        try:
            ilk.wait(timeout=5)
        except subprocess.TimeoutExpired:
            ilk.kill()
