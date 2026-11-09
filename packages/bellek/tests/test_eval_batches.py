"""eval.batches testleri (yalnız sözleşmeden)."""
import json
from collections import Counter

import pytest

from eval import batches

MARK = "ZZMARKERXQ"


def _q(i, stratum="root", kind="normal", text=None):
    return {
        "id": f"q{i:04d}",
        "text": text if text is not None else f"sorgu {i} {MARK} şğüıöç",
        "project": f"proj-{stratum}",
        "stratum": stratum,
        "kind": kind,
        "timestamp": "2026-01-01T00:00:00Z",
        "session_id": f"s{i}",
    }


def _make(spec, start=0):
    """spec: [(stratum, count)] -> kayıt listesi."""
    out, i = [], start
    for stratum, count in spec:
        for _ in range(count):
            out.append(_q(i, stratum))
            i += 1
    return out


def _by_id(recs):
    return {r["id"]: r for r in recs}


def _write_jsonl(path, recs):
    path.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in recs) + "\n",
        encoding="utf-8",
    )


def _read_jsonl(path):
    lines = path.read_text(encoding="utf-8").splitlines()
    return [json.loads(ln) for ln in lines if ln.strip()]


# ---------------------------------------------------------------- sabitler
def test_constants():
    assert batches.STRATUM_ORDER == (
        "root", "proje_a", "proje_b", "proje_c", "n8n", "proje_d", "odev", "other",
    )
    assert batches.DEFAULT_SEED == 20261024


# ------------------------------------------------------------ load_queries
def test_load_queries_returns_dict_by_id(tmp_path):
    recs = _make([("root", 3), ("n8n", 2)])
    p = tmp_path / "q.jsonl"
    _write_jsonl(p, recs)
    got = batches.load_queries(p)
    assert isinstance(got, dict)
    assert set(got) == {r["id"] for r in recs}
    assert got["q0000"]["text"] == recs[0]["text"]


def test_load_queries_duplicate_id_raises(tmp_path):
    recs = _make([("root", 3)])
    recs.append(dict(recs[0]))
    p = tmp_path / "q.jsonl"
    _write_jsonl(p, recs)
    with pytest.raises(ValueError):
        batches.load_queries(p)


# --------------------------------------------------------------- pilot_ids
def test_pilot_proportional_example():
    recs = _make([("root", 60), ("n8n", 30), ("odev", 10)])
    qs = _by_id(recs)
    dev = [r["id"] for r in recs]
    got = batches.pilot_ids(dev, qs, n=20)
    c = Counter(qs[i]["stratum"] for i in got)
    assert c == {"root": 12, "n8n": 6, "odev": 2}
    assert len(got) == 20 and len(set(got)) == 20


def test_pilot_sorted_and_subset_of_dev():
    recs = _make([("root", 40), ("proje_a", 20), ("other", 10)])
    qs = _by_id(recs)
    dev = [r["id"] for r in recs]
    got = batches.pilot_ids(dev, qs, n=15)
    assert got == sorted(got)
    assert set(got) <= set(dev)


def test_pilot_length_is_min_n_len_dev():
    recs = _make([("root", 5), ("n8n", 3)])
    qs = _by_id(recs)
    dev = [r["id"] for r in recs]
    got = batches.pilot_ids(dev, qs, n=20)
    assert sorted(got) == sorted(dev)
    assert len(batches.pilot_ids(dev, qs, n=4)) == 4


def test_pilot_remainder_tie_broken_by_stratum_order():
    recs = _make([("n8n", 5), ("root", 5)])
    qs = _by_id(recs)
    dev = [r["id"] for r in recs]
    got = batches.pilot_ids(dev, qs, n=1)
    assert len(got) == 1
    assert qs[got[0]]["stratum"] == "root"


def test_pilot_deterministic_and_salt_changes():
    recs = _make([("root", 150), ("n8n", 50)])
    qs = _by_id(recs)
    dev = [r["id"] for r in recs]
    a = batches.pilot_ids(dev, qs, n=20)
    b = batches.pilot_ids(dev, qs, n=20)
    assert a == b
    assert batches.pilot_ids(dev, qs, n=20, seed=20261024, salt="pilot-1") == a
    other = batches.pilot_ids(dev, qs, n=20, salt="pilot-2")
    assert other != a
    assert len(other) == 20


def test_pilot_never_picks_heldout():
    recs = _make([("root", 100), ("n8n", 100)])
    qs = _by_id(recs)
    dev = [r["id"] for r in recs[::2]]
    held = {r["id"] for r in recs[1::2]}
    for salt in ("pilot-1", "pilot-2", "x"):
        got = batches.pilot_ids(dev, qs, n=20, salt=salt)
        assert not (set(got) & held)
        assert set(got) <= set(dev)


def test_pilot_unknown_id_keyerror():
    recs = _make([("root", 10)])
    qs = _by_id(recs)
    with pytest.raises(KeyError):
        batches.pilot_ids([r["id"] for r in recs] + ["yok-id"], qs, n=5)


# ------------------------------------------------------------ make_batches
def test_make_batches_chunking_and_exactly_once():
    recs = _make([("root", 30), ("n8n", 25)])
    qs = _by_id(recs)
    ids = [r["id"] for r in recs]
    out = batches.make_batches(ids, qs, size=20)
    assert [len(b) for b in out] == [20, 20, 15]
    flat = [i for b in out for i in b]
    assert sorted(flat) == sorted(ids)
    assert len(flat) == len(set(flat))


def test_make_batches_sort_key_order():
    recs = [
        _q(1, "n8n", "short"),
        _q(2, "n8n", "normal"),
        _q(3, "root", "short"),
        _q(4, "root", "normal"),
        _q(5, "root", "normal"),
        _q(6, "odev", "normal"),
        _q(7, "proje_a", "normal"),
    ]
    qs = _by_id(recs)
    ids = [r["id"] for r in reversed(recs)]
    out = batches.make_batches(ids, qs, size=100)
    assert out == [["q0004", "q0005", "q0003", "q0007", "q0002", "q0001", "q0006"]]


def test_make_batches_unknown_stratum_last_sorted_by_name():
    recs = [_q(1, "zzz"), _q(2, "aaa"), _q(3, "other"), _q(4, "root")]
    qs = _by_id(recs)
    out = batches.make_batches([r["id"] for r in recs], qs, size=10)
    assert out == [["q0004", "q0003", "q0002", "q0001"]]


def test_make_batches_same_stratum_adjacent_and_deterministic():
    recs = _make([("odev", 7), ("root", 9), ("n8n", 5), ("proje_a", 3)])
    qs = _by_id(recs)
    ids = [r["id"] for r in recs]
    out = batches.make_batches(ids, qs, size=6)
    flat = [i for b in out for i in b]
    seq = [qs[i]["stratum"] for i in flat]
    seen, prev = set(), None
    for s in seq:
        if s != prev:
            assert s not in seen
            seen.add(s)
            prev = s
    assert batches.make_batches(list(reversed(ids)), qs, size=6) == out


# ----------------------------------------------------------- write_batches
def test_write_batches_files_and_keys(tmp_path):
    recs = _make([("root", 25)])
    qs = _by_id(recs)
    bs = batches.make_batches([r["id"] for r in recs], qs, size=20)
    out = tmp_path / "out"
    paths = batches.write_batches(bs, qs, out)
    assert [p.name for p in paths] == ["batch-01.jsonl", "batch-02.jsonl"]
    assert all(p.exists() for p in paths)
    rows1 = _read_jsonl(paths[0])
    rows2 = _read_jsonl(paths[1])
    assert len(rows1) == 20 and len(rows2) == 5
    for row in rows1 + rows2:
        assert set(row) == {"qid", "text", "project"}
    assert [r["qid"] for r in rows1] == bs[0]
    assert rows1[0]["text"] == qs[bs[0][0]]["text"]
    assert rows1[0]["project"] == qs[bs[0][0]]["project"]


def test_write_batches_turkish_not_escaped(tmp_path):
    recs = [_q(0, text="şğüıöç İstanbul çalışıyor")]
    qs = _by_id(recs)
    paths = batches.write_batches([["q0000"]], qs, tmp_path / "o")
    raw = paths[0].read_text(encoding="utf-8")
    assert "şğüıöç İstanbul çalışıyor" in raw
    assert "\\u" not in raw


def test_write_batches_index_json(tmp_path):
    recs = _make([("root", 25)])
    qs = _by_id(recs)
    bs = batches.make_batches([r["id"] for r in recs], qs, size=20)
    out = tmp_path / "out"
    batches.write_batches(bs, qs, out)
    idx = json.loads((out / "index.json").read_text(encoding="utf-8"))
    assert idx["total"] == 25
    assert idx["batches"] == [
        {"file": "batch-01.jsonl", "qids": bs[0]},
        {"file": "batch-02.jsonl", "qids": bs[1]},
    ]


def test_write_batches_nonempty_dir_raises(tmp_path):
    recs = _make([("root", 3)])
    qs = _by_id(recs)
    out = tmp_path / "out"
    out.mkdir()
    (out / "x.txt").write_text("var", encoding="utf-8")
    with pytest.raises(FileExistsError):
        batches.write_batches([["q0000"]], qs, out)
    assert not (out / "batch-01.jsonl").exists()


def test_write_batches_empty_existing_dir_ok(tmp_path):
    recs = _make([("root", 3)])
    qs = _by_id(recs)
    out = tmp_path / "out"
    out.mkdir()
    paths = batches.write_batches([["q0000", "q0001", "q0002"]], qs, out)
    assert len(paths) == 1 and paths[0].parent == out


def test_write_batches_twice_raises(tmp_path):
    recs = _make([("root", 3)])
    qs = _by_id(recs)
    out = tmp_path / "out"
    batches.write_batches([["q0000"]], qs, out)
    with pytest.raises(FileExistsError):
        batches.write_batches([["q0001"]], qs, out)


# --------------------------------------------------------------------- CLI
@pytest.fixture
def cli_env(tmp_path):
    recs = _make([("root", 120), ("n8n", 50), ("odev", 30)])
    dev = [r["id"] for r in recs if int(r["id"][1:]) % 2 == 0]
    held = [r["id"] for r in recs if int(r["id"][1:]) % 2 == 1]
    q = tmp_path / "queries.jsonl"
    m = tmp_path / "manifest.json"
    _write_jsonl(q, recs)
    m.write_text(
        json.dumps({"split": {"dev_ids": dev, "heldout_ids": held}}), encoding="utf-8"
    )
    return {"q": q, "m": m, "dev": set(dev), "tmp": tmp_path, "recs": recs}


def test_cli_pilot_ok_and_rerun_fails(cli_env, capsys):
    out = cli_env["tmp"] / "pilot"
    argv = ["pilot", "--manifest", str(cli_env["m"]), "--queries", str(cli_env["q"]),
            "--out", str(out), "--n", "20"]
    assert batches.main(argv) == 0
    rows = _read_jsonl(out / "batch-01.jsonl")
    assert len(rows) == 20
    assert {r["qid"] for r in rows} <= cli_env["dev"]
    captured = capsys.readouterr()
    assert MARK not in captured.out
    assert batches.main(argv) == 1


def test_cli_main_ten_batches(tmp_path, capsys):
    recs = _make([("root", 100), ("proje_a", 60), ("other", 40)])
    q = tmp_path / "q200.jsonl"
    _write_jsonl(q, recs)
    out = tmp_path / "main_out"
    rc = batches.main(["main", "--queries", str(q), "--out", str(out), "--size", "20"])
    assert rc == 0
    files = sorted(out.glob("batch-*.jsonl"))
    assert len(files) == 10
    total = sum(len(_read_jsonl(f)) for f in files)
    assert total == 200
    idx = json.loads((out / "index.json").read_text(encoding="utf-8"))
    assert idx["total"] == 200 and len(idx["batches"]) == 10
    assert MARK not in capsys.readouterr().out


def test_cli_missing_manifest_returns_1(cli_env):
    out = cli_env["tmp"] / "o"
    rc = batches.main(["pilot", "--manifest", str(cli_env["tmp"] / "yok.json"),
                       "--queries", str(cli_env["q"]), "--out", str(out), "--n", "20"])
    assert rc == 1


def test_cli_unknown_subcommand_returns_2():
    assert batches.main(["bilinmeyen"]) == 2
