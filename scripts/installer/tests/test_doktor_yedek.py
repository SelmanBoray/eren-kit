"""doktor.py beyin:yedek denetimi: beyin yedeği hiç yoksa, eskiyse ya da son otomatik deneme
başarısızsa uyarı verir.

Hesabı bellek yapar (`python -I -B -m bellek.beyin yedek-durum --json`); burada doktorun alt
süreci doğru çağırdığı ve sonucu doğru eşlediği sahte `_run` ile, uçtan uca davranış ise (depo
venv'i varsa) geçici bir veritabanıyla sınanır. Gerçek ~/.claude ve gerçek beyin.db kullanılmaz.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

INSTALLER = Path(__file__).resolve().parents[1]
REAL_REPO = INSTALLER.parents[1]
DOKTOR = INSTALLER / "doktor.py"
VENV_PY = REAL_REPO / "packages" / "bellek" / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def doktor():
    return _load("_eren_doktor_yedek_under_test", DOKTOR)


@pytest.fixture(autouse=True)
def _isolated_home(tmp_path, monkeypatch):
    home = tmp_path / "fake-home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "yerel"))
    for k in ("BELLEK_BEYIN_DB", "BELLEK_CONFIG"):
        monkeypatch.delenv(k, raising=False)


def _ctx(doktor, tmp_path, monkeypatch, network=True, installed=True):
    entry = {"command": "beyin-sahte", "args": []} if installed else None
    monkeypatch.setattr(doktor.Ctx, "mcp_entry", lambda self, name: entry if name == "beyin" else None)
    return doktor.Ctx(tmp_path / "claude", REAL_REPO, network)


def _sahte_run(doktor, monkeypatch, stdout: bytes = b"", rc: int = 0, stderr: bytes = b"", exc=None):
    cagrilar = []

    def run(args, timeout, env=None):
        cagrilar.append((list(args), env))
        if exc is not None:
            raise exc
        return subprocess.CompletedProcess(args, rc, stdout=stdout, stderr=stderr)

    monkeypatch.setattr(doktor, "_run", run)
    monkeypatch.setattr(doktor, "_bellek_python", lambda ctx: ("bellek-python", {"BELLEK_BEYIN_DB": "db-yolu"}))
    return cagrilar


def _json(durum: str, mesaj: str) -> bytes:
    return json.dumps({"durum": durum, "mesaj": mesaj, "sayi": 0}, ensure_ascii=False).encode("utf-8")


def test_ag_kapaliyken_atlanir(doktor, tmp_path, monkeypatch):
    cagrilar = _sahte_run(doktor, monkeypatch)
    c = doktor.check_backup(_ctx(doktor, tmp_path, monkeypatch, network=False))
    assert c.status == doktor.OK and "atlandı" in c.detail
    assert cagrilar == []


def test_beyin_kurulu_degilse_ok(doktor, tmp_path, monkeypatch):
    cagrilar = _sahte_run(doktor, monkeypatch)
    c = doktor.check_backup(_ctx(doktor, tmp_path, monkeypatch, installed=False))
    assert c.status == doktor.OK and c.detail.startswith("kurulu değil")
    assert cagrilar == []


def test_bellek_ortami_yoksa_atlanir(doktor, tmp_path, monkeypatch):
    ctx = _ctx(doktor, tmp_path, monkeypatch)
    monkeypatch.setattr(doktor, "_bellek_python", lambda ctx: (None, {}))
    c = doktor.check_backup(ctx)
    assert c.status == doktor.OK and "atlandı" in c.detail


def test_alt_surec_dogru_cagrilir_ok_eslenir(doktor, tmp_path, monkeypatch):
    cagrilar = _sahte_run(doktor, monkeypatch, _json("ok", "Son beyin yedeği 3 saat önce alındı (x.db; 5 yedek saklanıyor)."))
    c = doktor.check_backup(_ctx(doktor, tmp_path, monkeypatch))
    assert c.status == doktor.OK and "3 saat önce" in c.detail
    args, env = cagrilar[0]
    assert args == ["bellek-python", "-I", "-B", "-m", "bellek.beyin", "yedek-durum", "--json"]
    assert env["BELLEK_BEYIN_DB"] == "db-yolu" and env["PYTHONDONTWRITEBYTECODE"] == "1"


@pytest.mark.parametrize("mesaj", [
    "Hiç beyin yedeği yok (dizin).",
    "Son beyin yedeği 4 gün önce alınmış (x.db).",
    "Son otomatik yedek denemesi başarısız (2026-01-01 10:00): diskte yer kalmadı.",
])
def test_uyari_eslenir(doktor, tmp_path, monkeypatch, mesaj):
    _sahte_run(doktor, monkeypatch, _json("uyari", mesaj), rc=1)
    c = doktor.check_backup(_ctx(doktor, tmp_path, monkeypatch))
    assert c.status == doktor.WARN and c.detail == mesaj


def test_okunamayan_cikti_uyari(doktor, tmp_path, monkeypatch):
    _sahte_run(doktor, monkeypatch, b"bozuk", rc=2, stderr=b"usage: invalid choice: 'yedek-durum'\n")
    c = doktor.check_backup(_ctx(doktor, tmp_path, monkeypatch))
    assert c.status == doktor.WARN and "okunamadı" in c.detail and "invalid choice" in c.detail


@pytest.mark.parametrize("exc", [subprocess.TimeoutExpired("x", 1), OSError("yok")])
def test_alt_surec_hatasi_uyari(doktor, tmp_path, monkeypatch, exc):
    _sahte_run(doktor, monkeypatch, exc=exc)
    c = doktor.check_backup(_ctx(doktor, tmp_path, monkeypatch))
    assert c.status == doktor.WARN


def test_run_checks_icinde_ve_bos_kurulumda_ok(doktor, tmp_path):
    res = doktor.run_checks(tmp_path / "claude", REAL_REPO, network=True)
    c = {x["name"]: x for x in res["checks"]}["beyin:yedek"]
    assert c["status"] == "ok" and c["detail"].startswith("kurulu değil")


# ---------------------------------------------------------------- uçtan uca (depo venv'i)


@pytest.mark.skipif(not VENV_PY.is_file(), reason="packages/bellek/.venv yok")
def test_uctan_uca_yedek_yokken_uyari_yedekten_sonra_ok(doktor, tmp_path, monkeypatch):
    db_yol = tmp_path / "veri" / "beyin.db"
    db_yol.parent.mkdir()
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(db_yol))
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")

    def bellek(*argv):
        r = subprocess.run([str(VENV_PY), "-I", "-B", *argv], env=env, capture_output=True, timeout=60)
        assert r.returncode == 0, r.stderr.decode("utf-8", "replace")

    bellek("-c", f"from bellek.beyin import db; db.baglan({str(db_yol)!r}).close()")
    ctx = _ctx(doktor, tmp_path, monkeypatch)  # kayıt Python değil: depo venv'i kullanılır
    c = doktor.check_backup(ctx)
    assert c.status == doktor.WARN and "Hiç beyin yedeği yok" in c.detail, c
    assert not (db_yol.parent / "beyin_yedek").exists()  # salt okunur

    bellek("-m", "bellek.beyin", "yedekle")
    c = doktor.check_backup(ctx)
    assert c.status == doktor.OK and "Son beyin yedeği" in c.detail, c
