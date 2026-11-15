"""Durum dosya/klasör izinleri (güvenlik denetimi B2).

POSIX'te gerçek izin bitleri sınanır (macOS CI); Windows'ta modülün izin değiştirmediği
ve davranışın eskisiyle aynı kaldığı sınanır.
"""
from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from bellek import izin

posix = pytest.mark.skipif(os.name == "nt", reason="POSIX izin bitleri")
windows = pytest.mark.skipif(os.name != "nt", reason="Windows davranışı")


def _mod(yol) -> int:
    return stat.S_IMODE(os.stat(yol).st_mode)


@pytest.fixture()
def genis_umask():
    """Testi 022 umask'la çalıştırır (çoğu Linux varsayılanı); sonra eskisine döner."""
    eski = os.umask(0o022)
    try:
        yield
    finally:
        os.umask(eski)


# ---------------------------------------------------------------- yardımcılar
@posix
def test_ozel_klasor_eksik_ustlerle_0700(tmp_path, genis_umask):
    hedef = tmp_path / "a" / "b" / "c"
    izin.ozel_klasor(hedef)
    for d in (tmp_path / "a", tmp_path / "a" / "b", hedef):
        assert _mod(d) == 0o700, d


@posix
def test_ozel_klasor_var_olani_duzeltir(tmp_path, genis_umask):
    d = tmp_path / "eski"
    d.mkdir(mode=0o755)
    os.chmod(d, 0o755)
    izin.ozel_klasor(d)
    assert _mod(d) == 0o700


@posix
def test_ozel_klasor_duzelt_false_var_olana_dokunmaz(tmp_path, genis_umask):
    d = tmp_path / "kullanici_klasoru"
    d.mkdir()
    os.chmod(d, 0o755)
    izin.ozel_klasor(d, duzelt=False)
    assert _mod(d) == 0o755


@posix
def test_kisitla_dosya_0644_den_0600(tmp_path):
    f = tmp_path / "x"
    f.write_text("a")
    os.chmod(f, 0o644)
    izin.kisitla(f)
    assert _mod(f) == 0o600


@posix
def test_ozel_acici_yeni_dosya_0600(tmp_path, genis_umask):
    f = tmp_path / "log"
    with open(f, "a", encoding="utf-8", opener=izin.ozel_acici) as h:
        h.write("x")
    assert _mod(f) == 0o600


def test_kisitla_olmayan_yol_sessiz(tmp_path):
    izin.kisitla(tmp_path / "yok")  # istisna yok


@windows
def test_windows_izin_degistirmez(tmp_path, monkeypatch):
    cagri = []
    monkeypatch.setattr(os, "chmod", lambda *a, **k: cagri.append(a))
    f = tmp_path / "x"
    f.write_text("a")
    izin.kisitla(f)
    izin.ozel_dosya_olustur(tmp_path / "yeni")
    izin.ozel_klasor(tmp_path / "k" / "l")
    assert cagri == []
    assert not (tmp_path / "yeni").exists()  # Windows'ta dosya önceden oluşturulmaz
    assert (tmp_path / "k" / "l").is_dir()


# ------------------------------------------------------------- servis dosyaları
def _servis_ortami(mp: pytest.MonkeyPatch, kok: Path) -> Path:
    """Varsayılan düzen: her şey sahte LOCALAPPDATA/Bellek altında (tekil yol değişkeni yok)."""
    yerel = kok / "yerel"
    yerel.mkdir()
    mp.setenv("LOCALAPPDATA", str(yerel))
    for ad in ("BELLEK_BEYIN_DB", "BELLEK_BEYIN_KUYRUK", "BELLEK_BEYIN_LOG",
               "BELLEK_BEYIN_TOKEN_DOSYA", "BELLEK_BEYIN_ARAYUZ_TOKEN_DOSYA",
               "BELLEK_BEYIN_KOPRU_LOG"):
        mp.delenv(ad, raising=False)
    return yerel / "Bellek"


@posix
def test_servis_veri_klasoru_ve_dosyalari_yalniz_sahibine(tmp_path, genis_umask):
    from bellek.beyin import servis

    with pytest.MonkeyPatch.context() as mp:
        veri = _servis_ortami(mp, tmp_path)
        s, _ = servis.sunucu_olustur("127.0.0.1", 0)
        try:
            servis.gunluk("deneme")
        finally:
            s.kapat()
        assert _mod(veri) == 0o700
        for ad in ("beyin.db", "beyin_token", "beyin_arayuz_token", "beyin_servis.log"):
            assert _mod(veri / ad) == 0o600, ad


@posix
def test_servis_var_olan_kurulumu_duzeltir(tmp_path, genis_umask):
    """Eski sürümün 0755/0644 bıraktığı kurulum servis açılışında kısıtlanır."""
    from bellek.beyin import servis

    with pytest.MonkeyPatch.context() as mp:
        veri = _servis_ortami(mp, tmp_path)
        veri.mkdir(mode=0o755)
        os.chmod(veri, 0o755)
        (veri / "beyin_token").write_text("a" * 64)
        (veri / "beyin_kuyruk.jsonl").write_text("")
        (veri / "beyin_servis.log").write_text("eski\n")
        for ad in ("beyin_token", "beyin_kuyruk.jsonl", "beyin_servis.log"):
            os.chmod(veri / ad, 0o644)
        s, _ = servis.sunucu_olustur("127.0.0.1", 0)
        s.kapat()
        assert _mod(veri) == 0o700
        for ad in ("beyin_token", "beyin.db", "beyin_servis.log", "beyin_kuyruk.jsonl"):
            assert _mod(veri / ad) == 0o600, ad


@posix
def test_db_baglan_yeni_veritabani_0600(tmp_path, genis_umask):
    from bellek.beyin import db

    yol = tmp_path / "yeni" / "beyin.db"
    con = db.baglan(yol)
    con.close()
    assert _mod(yol) == 0o600
    assert _mod(yol.parent) == 0o700


@posix
def test_kopru_kuyruk_ve_gunluk_0600(tmp_path, genis_umask):
    from bellek.beyin import mcp_kopru

    with pytest.MonkeyPatch.context() as mp:
        veri = _servis_ortami(mp, tmp_path)
        yol = mcp_kopru.kuyruga_ekle({"metin": "x"}, "deneme")
        mcp_kopru.gunluk("deneme")
        assert _mod(veri) == 0o700
        assert _mod(yol) == 0o600
        assert _mod(veri / "beyin_kopru.log") == 0o600


@posix
def test_kapi_durum_dosyalari_0600(tmp_path, genis_umask):
    from bellek.kapi import hook

    durum = tmp_path / "kapi"
    env = {"BELLEK_KAPI_STATE": str(durum)}
    onad = hook._state_base(str(durum), "oturum1", "ana", "x")
    hook._prepare_agent_dir(onad)
    hook._create_marker(onad + ".harita")
    hook._append_line(onad + ".jsonl", {"a": 1})
    hook._log_decision(str(durum), {"karar": "izin"}, env)
    hook.log_error("deneme", env)
    assert _mod(durum) == 0o700
    for d in (durum / "oturumlar", durum / "oturumlar" / "oturum1"):
        assert _mod(d) == 0o700, d
    for f in (onad + ".harita", onad + ".jsonl", durum / "kapi.jsonl", durum / "hook.log"):
        assert _mod(f) == 0o600, f


@posix
def test_devir_durum_dosyalari_0600(tmp_path, genis_umask):
    from bellek.devir import hook

    durum = tmp_path / "devir"
    env = {"BELLEK_DEVIR_STATE": str(durum)}
    hook.save_state("oturum1", {"a": 1}, env)
    hook.log_error("deneme", env)
    assert _mod(durum) == 0o700
    assert _mod(durum / "oturumlar" / "oturum1.json") == 0o600
    assert _mod(durum / "hook.log") == 0o600
