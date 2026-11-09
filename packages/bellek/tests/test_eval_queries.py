"""eval.queries testleri (sözleşmeden)."""

from __future__ import annotations

import dataclasses
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from eval.queries import (
    DEFAULT_QUOTAS,
    DEFAULT_SEED,
    DEFAULT_SHORT_QUOTA,
    Prompt,
    Query,
    classify,
    dedupe,
    extract,
    load_history,
    main,
    normalize_for_dedupe,
    sample,
    stratum_for,
)

MARKER = "ZXQMARKERKELIME"


def _row(display, ts=1_700_000_000_000, project="C:\\n8n", sid="s1", pasted=None):
    return {
        "display": display,
        "timestamp": ts,
        "project": project,
        "sessionId": sid,
        "pastedContents": pasted if pasted is not None else {},
    }


def _write_lines(path: Path, lines: list[str]) -> Path:
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _write_rows(path: Path, rows: list[dict]) -> Path:
    return _write_lines(path, [json.dumps(r, ensure_ascii=False) for r in rows])


def _p(text, project="C:\\n8n", ts=1000, sid="s"):
    return Prompt(text=text, project=project, timestamp_ms=ts, session_id=sid)


# --- dataclass'lar ---------------------------------------------------------


def test_dataclasses_frozen():
    p = _p("bir iki üç dört")
    with pytest.raises(dataclasses.FrozenInstanceError):
        p.text = "x"  # type: ignore[misc]
    q = Query(
        id="q001", text="t", project="C:\\n8n", stratum="n8n",
        kind="normal", timestamp="2024-01-01T00:00:00Z", session_id="s",
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        q.id = "q002"  # type: ignore[misc]


def test_query_timestamp_utc_iso_z():
    ms = 1_700_000_000_000
    qs, _ = sample([_p("bir iki üç dört beş", ts=ms)], {"n8n": 1}, 0, 1)
    assert len(qs) == 1
    ts = qs[0].timestamp
    assert ts.endswith("Z")
    parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    assert parsed == datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


# --- load_history ----------------------------------------------------------


def test_load_history_valid_in_order(tmp_path):
    f = _write_rows(
        tmp_path / "h.jsonl",
        [_row("ilk satır burada var", ts=5), _row("ikinci satır burada var", ts=1)],
    )
    prompts, skipped = load_history(f)
    assert skipped == 0
    assert [p.text for p in prompts] == ["ilk satır burada var", "ikinci satır burada var"]
    assert prompts[0].timestamp_ms == 5
    assert prompts[0].project == "C:\\n8n"
    assert prompts[0].session_id == "s1"


def test_load_history_skips_malformed(tmp_path):
    good = _row("geçerli satır bir iki üç")
    no_field = {k: v for k, v in _row("alan eksik burada").items() if k != "project"}
    bad_ts = _row("zaman damgası yanlış tip")
    bad_ts["timestamp"] = "1700000000000"
    bad_display = _row("x")
    bad_display["display"] = 123
    lines = [
        json.dumps(good, ensure_ascii=False),
        "bu json değil {{{",
        json.dumps(no_field, ensure_ascii=False),
        json.dumps(bad_ts, ensure_ascii=False),
        json.dumps(bad_display, ensure_ascii=False),
        json.dumps(_row("ikinci geçerli satır dört"), ensure_ascii=False),
    ]
    f = _write_lines(tmp_path / "h.jsonl", lines)
    prompts, skipped = load_history(f)
    assert skipped == 4
    assert [p.text for p in prompts] == ["geçerli satır bir iki üç", "ikinci geçerli satır dört"]


# --- classify --------------------------------------------------------------


@pytest.mark.parametrize(
    "text,expected",
    [
        ("/model opus", "slash"),
        ("   /clear", "slash"),
        ("/model opus bir iki üç dört", "slash"),
        ("!dir C:\\", "shell"),
        ("  !git status şimdi bak", "shell"),
        ("bak bu [Pasted text #1 +10 lines] ne", "pasted"),
        ("bak [Image #1]", "pasted"),
        ("evet", "short"),
        ("bir iki üç", "short"),
        ("", "short"),
        ("   ", "short"),
        ("bir iki üç dört", "normal"),
        ("  n8n akışını nasıl düzeltirim", "normal"),
    ],
)
def test_classify(text, expected):
    assert classify(text) == expected


# --- stratum_for -----------------------------------------------------------


@pytest.mark.parametrize(
    "project,expected",
    [
        ("C:\\", "root"),
        ("C:\\proje_a", "proje_a"),
        ("C:\\proje_a_asama2\\proje_a", "proje_a"),
        ("C:\\proje_a_asama2\\proje_aprototipv2\\aura\\pipeline", "proje_a"),
        ("C:\\Proje_B", "proje_b"),
        ("C:\\PROJE_C", "proje_c"),
        ("C:\\n8n", "n8n"),
        ("C:\\Proje_D", "proje_d"),
        ("C:\\ödev", "odev"),
        ("C:\\prog1odev", "odev"),
        ("C:\\analiz", "odev"),
        ("C:\\unity ödev", "odev"),
        ("C:\\java\\javaVİze", "odev"),
        ("C:\\prog", "odev"),
        ("C:\\Users\\Değerlendirici\\Desktop", "other"),
        ("C:\\Bellek", "other"),
        ("C:\\n8nx", "other"),
        ("C:\\proje_aX", "other"),
        ("c:/n8n/", "n8n"),
    ],
)
def test_stratum_for(project, expected):
    assert stratum_for(project) == expected


def test_stratum_for_case_slash_trailing():
    assert stratum_for("c:/PROJE_B") == "proje_b"
    assert stratum_for("C:\\n8n\\") == "n8n"
    assert stratum_for("C:/n8n/alt/klasor") == "n8n"
    assert stratum_for("c:\\") == "root"


# --- normalize / dedupe ----------------------------------------------------


def test_normalize_for_dedupe():
    assert normalize_for_dedupe("  Merhaba   DÜNYA \n ne  var ") == "merhaba dünya ne var"
    assert normalize_for_dedupe("ABC") == normalize_for_dedupe(" abc  ")


def test_dedupe_keeps_latest_and_sorts():
    ps = [
        _p("Aynı  metin burada var", ts=100, sid="a"),
        _p("başka bir metin burada", ts=50, sid="b"),
        _p("aynı metin BURADA var", ts=300, sid="c"),
        _p("aynı metin burada var ", ts=200, sid="d"),
    ]
    out = dedupe(ps)
    assert [(p.timestamp_ms, p.text) for p in out] == [
        (50, "başka bir metin burada"),
        (300, "aynı metin BURADA var"),
    ]
    assert out[1].session_id == "c"


# --- sabitler --------------------------------------------------------------


def test_defaults():
    assert DEFAULT_QUOTAS == {
        "root": 50, "proje_a": 30, "proje_b": 20, "proje_c": 20,
        "n8n": 20, "proje_d": 15, "odev": 10, "other": 5,
    }
    assert DEFAULT_SHORT_QUOTA == 30
    assert DEFAULT_SEED == 20261024


# --- sample ----------------------------------------------------------------


def _pool():
    ps = []
    for i in range(10):
        ps.append(_p(f"n8n akış sorusu numara {i} burada", "C:\\n8n", 1000 + i))
    for i in range(6):
        ps.append(_p(f"kök dizin sorusu numara {i} burada", "C:\\", 2000 + i))
    for i in range(8):
        ps.append(_p(f"kısa{i}", "C:\\Bellek", 3000 + i))
        ps.append(_p(f"evet {i}", "C:\\n8n", 3500 + i))
    return ps


def test_sample_quota_and_order_and_ids():
    qs, short = sample(_pool(), {"n8n": 2, "root": 1}, 3, 7)
    assert short == {}
    strata_kinds = [(q.stratum, q.kind) for q in qs]
    assert strata_kinds[:3] == [("n8n", "normal"), ("n8n", "normal"), ("root", "normal")]
    assert all(k == "short" for _, k in strata_kinds[3:])
    assert len(qs) == 6
    assert [q.id for q in qs] == [f"q{i:03d}" for i in range(1, 7)]
    n8n = [q for q in qs if q.stratum == "n8n" and q.kind == "normal"]
    assert [q.timestamp for q in n8n] == sorted(q.timestamp for q in n8n)
    shorts = [q for q in qs if q.kind == "short"]
    assert shorts == sorted(shorts, key=lambda q: q.timestamp)
    for q in shorts:
        assert q.stratum == stratum_for(q.project)


def test_sample_alphabetical_strata_order():
    ps = [
        _p("kök dizin sorusu bir iki", "C:\\", 5),
        _p("n8n akış sorusu bir iki", "C:\\n8n", 1),
        _p("proje b sorusu bir iki", "C:\\Proje_B", 9),
    ]
    qs, _ = sample(ps, {"root": 1, "n8n": 1, "proje_b": 1}, 0, 1)
    assert [q.stratum for q in qs] == ["n8n", "proje_b", "root"]


def test_sample_shortfall_normal_and_short():
    ps = [
        _p("n8n akış sorusu bir iki", "C:\\n8n", 1),
        _p("evet", "C:\\n8n", 2),
    ]
    qs, short = sample(ps, {"n8n": 3, "root": 0}, 4, 1)
    assert short == {"n8n": 2, "short": 3}
    assert [q.kind for q in qs] == ["normal", "short"]


def test_sample_no_shortfall_key_when_met():
    qs, short = sample(_pool(), {"n8n": 10}, 0, 1)
    assert "n8n" not in short
    assert len(qs) == 10


def test_sample_excludes_slash_shell_pasted():
    ps = [
        _p("/model opus bir iki üç dört", "C:\\n8n", 1),
        _p("!git status bir iki üç dört", "C:\\n8n", 2),
        _p("bak [Image #1] bir iki üç dört", "C:\\n8n", 3),
        _p("/clear", "C:\\n8n", 4),
        _p("gerçek normal bir soru burada", "C:\\n8n", 5),
    ]
    qs, short = sample(ps, {"n8n": 10}, 10, 1)
    assert [q.text for q in qs] == ["gerçek normal bir soru burada"]
    assert short == {"n8n": 9, "short": 10}


def test_sample_no_duplicate_selection():
    qs, _ = sample(_pool(), {"n8n": 100, "root": 100, "other": 100}, 100, 3)
    keys = [(q.text, q.timestamp, q.project) for q in qs]
    assert len(keys) == len(set(keys))
    assert len(qs) == 10 + 6 + 16


def test_sample_deterministic_and_seed_sensitive():
    pool = [_p(f"soru numara {i} için bir iki", "C:\\n8n", i) for i in range(60)]
    a, _ = sample(pool, {"n8n": 5}, 0, 11)
    b, _ = sample(pool, {"n8n": 5}, 0, 11)
    assert a == b
    seeds = {tuple(q.text for q in sample(pool, {"n8n": 5}, 0, s)[0]) for s in range(1, 8)}
    assert len(seeds) > 1


# --- extract ---------------------------------------------------------------


def _history(tmp_path: Path) -> Path:
    rows = [
        _row(f"n8n akış sorusu {i} {MARKER} burada", ts=1_700_000_000_000 + i, project="C:\\n8n")
        for i in range(4)
    ]
    rows += [
        _row("ödev için türev hesabı nasıl yapılır", ts=1_700_000_100_000, project="C:\\analiz"),
        _row("kök dizinde şunu yapalım şimdi", ts=1_700_000_200_000, project="C:\\"),
        _row("kök dizinde ŞUNU yapalım  şimdi", ts=1_700_000_300_000, project="C:\\"),
        _row("/model opus", project="C:\\"),
        _row("!dir", project="C:\\"),
        _row("bak [Pasted text #1 +3 lines] şuna", project="C:\\"),
        _row("tamam", ts=1_700_000_400_000, project="C:\\n8n"),
    ]
    lines = [json.dumps(r, ensure_ascii=False) for r in rows]
    lines.insert(2, "bozuk satır")
    return _write_lines(tmp_path / "history.jsonl", lines)


def test_extract_writes_jsonl_and_stats(tmp_path):
    h = _history(tmp_path)
    out = tmp_path / "q.jsonl"
    stats = extract(h, out, {"n8n": 2, "root": 1}, 1, 5)
    for key in (
        "total_lines", "skipped_malformed", "by_class", "after_dedupe",
        "available_normal_by_stratum", "available_short", "selected_by_stratum",
        "selected_short", "shortfall",
    ):
        assert key in stats
    assert stats["skipped_malformed"] == 1
    assert stats["total_lines"] >= 11
    assert stats["by_class"]["slash"] == 1
    assert stats["by_class"]["shell"] == 1
    assert stats["by_class"]["pasted"] == 1
    assert stats["available_normal_by_stratum"]["n8n"] == 4
    assert stats["available_normal_by_stratum"]["root"] == 1  # dedupe sonrası
    assert stats["available_short"] == 1
    assert stats["selected_by_stratum"]["n8n"] == 2
    assert stats["selected_short"] == 1
    assert stats["shortfall"] == {}

    raw = out.read_text(encoding="utf-8")
    lines = raw.splitlines()
    assert len(lines) == 4
    objs = [json.loads(x) for x in lines]
    fields = {f.name for f in dataclasses.fields(Query)}
    for o in objs:
        assert set(o) == fields
    assert [o["id"] for o in objs] == ["q001", "q002", "q003", "q004"]
    assert "\\u" not in raw
    assert "şunu yapalım" in raw.lower()
    # slash/shell/pasted asla çıktıda değil
    assert "/model" not in raw and "!dir" not in raw and "Pasted text" not in raw


def test_extract_unicode_raw(tmp_path):
    h = _write_rows(
        tmp_path / "h.jsonl",
        [_row("öğrenci için çözümü göster şimdi", project="C:\\ödev")],
    )
    out = tmp_path / "q.jsonl"
    extract(h, out, {"odev": 1}, 0, 1)
    raw = out.read_text(encoding="utf-8")
    assert "öğrenci için çözümü" in raw
    assert "ödev" in raw
    assert "\\u" not in raw


def test_extract_existing_out_raises(tmp_path):
    h = _history(tmp_path)
    out = tmp_path / "q.jsonl"
    out.write_text("eski", encoding="utf-8")
    with pytest.raises(FileExistsError):
        extract(h, out, {"n8n": 1}, 0, 1)
    assert out.read_text(encoding="utf-8") == "eski"


def test_extract_shortfall_reported(tmp_path):
    h = _history(tmp_path)
    out = tmp_path / "q.jsonl"
    stats = extract(h, out, {"n8n": 10}, 5, 1)
    assert stats["shortfall"]["n8n"] == 6
    assert stats["shortfall"]["short"] == 4


# --- CLI -------------------------------------------------------------------


def test_cli_extract_ok_then_exists(tmp_path, capsys):
    h = _history(tmp_path)
    out = tmp_path / "q.jsonl"
    argv = ["extract", "--history", str(h), "--out", str(out), "--seed", "1"]
    assert main(argv) == 0
    assert out.exists()
    assert main(argv) == 1
    printed = capsys.readouterr()
    assert MARKER not in printed.out
    assert MARKER not in printed.err


def test_cli_stdout_hides_prompt_text(tmp_path, capsys):
    h = _history(tmp_path)
    out = tmp_path / "q.jsonl"
    assert main(["extract", "--history", str(h), "--out", str(out), "--seed", "1"]) == 0
    printed = capsys.readouterr()
    assert MARKER not in printed.out
    assert "akış sorusu" not in printed.out


def test_cli_stats_only_writes_nothing(tmp_path, capsys):
    h = _history(tmp_path)
    out = tmp_path / "q.jsonl"
    rc = main(["extract", "--history", str(h), "--out", str(out), "--stats-only"])
    assert rc == 0
    assert not out.exists()
    assert MARKER not in capsys.readouterr().out


def test_cli_missing_history(tmp_path):
    rc = main(["extract", "--history", str(tmp_path / "yok.jsonl"),
               "--out", str(tmp_path / "q.jsonl")])
    assert rc == 1
    assert not (tmp_path / "q.jsonl").exists()


def test_cli_unknown_subcommand_returns_2():
    assert main(["bilinmeyen"]) == 2
