"""Kapi hook'unun SessionStart/compact davranisi testleri (yalniz sozlesmeden; surec ici run)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
S = "oturum-S"
T = "oturum-T"


# --------------------------------------------------------------------------- yardimcilar
def uret_md(yol: Path, *, baslik: int = 6, govde: int = 60) -> None:
    satirlar: list[str] = []
    for i in range(baslik):
        satirlar.append(f"## Bölüm {i + 1}")
        for j in range(govde):
            satirlar.append(f"Bu, {i + 1}. bölümün {j + 1}. satırı; dolgu metni dolgu metni dolgu.")
    yol.write_bytes(("\n".join(satirlar) + "\n").encode("utf-8"))


def payload(yol, *, sid=S, agent=None):
    p = {"session_id": sid, "transcript_path": "C:\\x\\t.jsonl", "cwd": "C:\\proje",
         "permission_mode": "bypassPermissions", "hook_event_name": "PreToolUse",
         "tool_name": "Read", "tool_input": {"file_path": str(yol), "offset": None, "limit": None},
         "tool_use_id": "toolu_1"}
    if agent is not None:
        p["agent_id"] = agent
        p["agent_type"] = "general-purpose"
    return p


def baslat(sid=S, source="compact"):
    p = {"hook_event_name": "SessionStart", "source": source}
    if sid is not None:
        p["session_id"] = sid
    return p


@pytest.fixture
def env(tmp_path):
    d = tmp_path / "durum"
    d.mkdir()
    e = dict(os.environ)
    for k in list(e):
        if k.startswith("BELLEK_KAPI"):
            del e[k]
    e["BELLEK_KAPI_STATE"] = str(d)
    return e


@pytest.fixture
def run_fn():
    src = str(REPO / "src")
    eklendi = src not in sys.path
    if eklendi:
        sys.path.insert(0, src)
    try:
        from bellek.kapi.hook import run
        yield run
    finally:
        if eklendi:
            sys.path.remove(src)


@pytest.fixture
def md(tmp_path):
    y = tmp_path / "d1.md"
    uret_md(y)
    assert y.stat().st_size > 16384
    return y


def harita(d):
    assert d is not None, "harita (red) bekleniyordu, izin geldi"
    h = d["hookSpecificOutput"]
    assert h["hookEventName"] == "PreToolUse" and h["permissionDecision"] == "deny"
    assert "offset" in h["permissionDecisionReason"]


def gecer(d):
    assert d is None, "izin bekleniyordu, harita dondu"


# --------------------------------------------------------------------------- testler
def test_taban_ilk_harita_ikinci_gecer(run_fn, env, md):
    harita(run_fn(payload(md), env=env))
    gecer(run_fn(payload(md), env=env))


def test_compact_sifirlar(run_fn, env, md):
    harita(run_fn(payload(md), env=env))
    gecer(run_fn(payload(md), env=env))
    run_fn(baslat(S, "compact"), env=env)
    harita(run_fn(payload(md), env=env))
    gecer(run_fn(payload(md), env=env))


@pytest.mark.parametrize("source", ["startup", "resume", "clear"])
def test_diger_kaynaklar_sifirlamaz(run_fn, env, md, source):
    harita(run_fn(payload(md), env=env))
    gecer(run_fn(payload(md), env=env))
    run_fn(baslat(S, source), env=env)
    gecer(run_fn(payload(md), env=env))


def test_baska_oturum_etkilenmez(run_fn, env, md):
    harita(run_fn(payload(md, sid=S), env=env))
    harita(run_fn(payload(md, sid=T), env=env))
    run_fn(baslat(S, "compact"), env=env)
    gecer(run_fn(payload(md, sid=T), env=env))
    harita(run_fn(payload(md, sid=S), env=env))


def test_alt_agent_isareti_korunur(run_fn, env, md):
    harita(run_fn(payload(md, agent="ajan-A"), env=env))
    harita(run_fn(payload(md), env=env))
    run_fn(baslat(S, "compact"), env=env)
    gecer(run_fn(payload(md, agent="ajan-A"), env=env))
    harita(run_fn(payload(md), env=env))


@pytest.mark.parametrize("p", [baslat(S, "compact"), baslat(None, "compact")])
def test_sessionstart_ciktisi_bos(run_fn, env, md, p):
    harita(run_fn(payload(md), env=env))
    assert run_fn(p, env=env) is None


def test_birden_cok_dosya(run_fn, env, md, tmp_path):
    d2 = tmp_path / "d2.md"
    uret_md(d2)
    harita(run_fn(payload(md), env=env))
    harita(run_fn(payload(d2), env=env))
    gecer(run_fn(payload(md), env=env))
    gecer(run_fn(payload(d2), env=env))
    run_fn(baslat(S, "compact"), env=env)
    harita(run_fn(payload(md), env=env))
    harita(run_fn(payload(d2), env=env))
