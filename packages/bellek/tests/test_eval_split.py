"""eval.split testleri (sözleşmeden)."""

from __future__ import annotations

import hashlib
import json
import random
from collections import Counter
from pathlib import Path

import pytest

from eval import split

TEXT_MARKER = "ZXQSPLITMETINIŞARET"
PROJECT_MARKER = "C:\\gizli\\PROJEYOLUZXQ"


def _make(cells: dict[tuple[str, str], int]) -> list[dict]:
    out: list[dict] = []
    for (stratum, kind), n in sorted(cells.items()):
        for i in range(n):
            qid = f"{stratum}-{kind}-{i:03d}"
            out.append(
                {
                    "id": qid,
                    "text": f"{TEXT_MARKER} {qid}",
                    "project": PROJECT_MARKER,
                    "stratum": stratum,
                    "kind": kind,
                }
            )
    return out


def _write_jsonl(path: Path, rows: list[dict]) -> Path:
    path.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
        encoding="utf-8",
    )
    return path


def _cell_of(queries: list[dict]) -> dict[str, tuple[str, str]]:
    return {q["id"]: (q["stratum"], q["kind"]) for q in queries}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# --- sabitler --------------------------------------------------------------


def test_defaults():
    assert split.DEFAULT_SEED == 20261024
    assert split.DEFAULT_HELDOUT_RATIO == 0.4


# --- load_queries ----------------------------------------------------------


def test_load_queries_skips_blank_lines(tmp_path):
    p = tmp_path / "q.jsonl"
    p.write_text(
        '{"id": "a"}\n\n   \n{"id": "b"}\n', encoding="utf-8"
    )
    assert split.load_queries(p) == [{"id": "a"}, {"id": "b"}]


def test_load_queries_bad_line_raises(tmp_path):
    p = tmp_path / "q.jsonl"
    p.write_text('{"id": "a"}\n{bozuk\n', encoding="utf-8")
    with pytest.raises(ValueError):
        split.load_queries(p)


def test_load_queries_roundtrip_unicode(tmp_path):
    rows = _make({("n8n", "normal"): 3})
    p = _write_jsonl(tmp_path / "q.jsonl", rows)
    assert split.load_queries(p) == rows


# --- split_queries ---------------------------------------------------------


def test_split_basic_properties():
    qs = _make({("a", "normal"): 30, ("b", "short"): 20})
    dev, held = split.split_queries(qs)
    assert dev == sorted(dev)
    assert held == sorted(held)
    assert set(dev).isdisjoint(held)
    assert set(dev) | set(held) == {q["id"] for q in qs}
    assert len(dev) + len(held) == len(qs)


def test_split_total_heldout_count_200():
    qs = _make({("a", "normal"): 100, ("b", "normal"): 60, ("c", "short"): 40})
    assert len(qs) == 200
    _, held = split.split_queries(qs, heldout_ratio=0.4)
    assert len(held) == 80


def test_split_rounding_small_n():
    five = _make({("a", "normal"): 5})
    assert len(split.split_queries(five)[1]) == 2
    one = _make({("a", "normal"): 1})
    dev, held = split.split_queries(one)
    assert held == []
    assert dev == [one[0]["id"]]


def test_split_empty_input():
    assert split.split_queries([]) == ([], [])


def test_split_quota_example():
    qs = _make({("a", "normal"): 10, ("b", "normal"): 5, ("c", "short"): 1})
    _, held = split.split_queries(qs)
    cell = _cell_of(qs)
    counts = Counter(cell[i] for i in held)
    assert counts[("a", "normal")] == 4
    assert counts[("b", "normal")] == 2
    assert counts[("c", "short")] == 0
    assert len(held) == 6


def test_split_largest_remainder_tie_break_lexicographic():
    # ratio 0.5, üç hücre n=3: floor(1.5)=1 her biri -> 3; N=9, T=floor(5.0)=5
    # kalan 2 birim, kesirler eşit (0.5) -> (stratum, kind) sözlük sırasıyla ilk iki hücre
    qs = _make({("a", "normal"): 3, ("b", "normal"): 3, ("c", "normal"): 3})
    _, held = split.split_queries(qs, heldout_ratio=0.5)
    cell = _cell_of(qs)
    counts = Counter(cell[i] for i in held)
    assert len(held) == 5
    assert counts[("a", "normal")] == 2
    assert counts[("b", "normal")] == 2
    assert counts[("c", "normal")] == 1


def test_split_largest_remainder_prefers_larger_fraction():
    # ratio 0.4: n=4 -> 1.6 (kesir .6), n=3 -> 1.2 (kesir .2), n=3 -> 1.2
    # N=10, T=4; floor'lar 1,1,1 = 3 -> kalan 1, en büyük kesir x/normal (n=4) hücresinde
    qs = _make({("a", "normal"): 3, ("b", "normal"): 3, ("z", "normal"): 4})
    _, held = split.split_queries(qs, heldout_ratio=0.4)
    cell = _cell_of(qs)
    counts = Counter(cell[i] for i in held)
    assert counts[("z", "normal")] == 2
    assert counts[("a", "normal")] == 1
    assert counts[("b", "normal")] == 1


def test_split_cell_uses_stratum_and_kind():
    qs = _make({("a", "normal"): 10, ("a", "short"): 10})
    _, held = split.split_queries(qs)
    cell = _cell_of(qs)
    counts = Counter(cell[i] for i in held)
    assert counts[("a", "normal")] == 4
    assert counts[("a", "short")] == 4


def test_split_deterministic():
    qs = _make({("a", "normal"): 40, ("b", "short"): 30})
    assert split.split_queries(qs) == split.split_queries(qs)
    assert split.split_queries(qs, 0.4, 7) == split.split_queries(qs, 0.4, 7)


def test_split_order_independent():
    qs = _make({("a", "normal"): 40, ("b", "short"): 30, ("c", "normal"): 12})
    base = split.split_queries(qs)
    shuffled = list(qs)
    random.Random(1).shuffle(shuffled)
    assert split.split_queries(shuffled) == base
    assert split.split_queries(list(reversed(qs))) == base


def test_split_different_seed_changes_selection():
    qs = _make({("a", "normal"): 100, ("b", "short"): 100})
    h1 = split.split_queries(qs, 0.4, 1)[1]
    h2 = split.split_queries(qs, 0.4, 2)[1]
    assert h1 != h2
    assert len(h1) == len(h2)


def test_split_matches_reference_selection():
    # Sözleşmedeki seçim kuralı: sıralı id, Random(f"{seed}-split").shuffle, ilk q_c held-out.
    qs = _make({("a", "normal"): 10})
    seed = 123
    ids = sorted(q["id"] for q in qs)
    rng = random.Random(f"{seed}-split")
    rng.shuffle(ids)
    expected = sorted(ids[:4])
    _, held = split.split_queries(qs, 0.4, seed)
    assert held == expected


def test_split_duplicate_id_raises():
    qs = _make({("a", "normal"): 5})
    qs.append(dict(qs[0]))
    with pytest.raises(ValueError):
        split.split_queries(qs)


# --- sha256_file / split_digest -------------------------------------------


def test_sha256_file(tmp_path):
    p = tmp_path / "x.bin"
    p.write_bytes(b"merhaba \xc3\xbc")
    assert split.sha256_file(p) == hashlib.sha256(b"merhaba \xc3\xbc").hexdigest()


def test_split_digest_independent():
    dev = ["q1", "q3", "üç"]
    held = ["q2", "q4"]
    payload = json.dumps(
        {"dev_ids": dev, "heldout_ids": held},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    assert split.split_digest(dev, held) == hashlib.sha256(payload).hexdigest()


def test_split_digest_changes_with_content():
    assert split.split_digest(["a"], ["b"]) != split.split_digest(["b"], ["a"])


# --- build_manifest / write_manifest --------------------------------------


def _manifest_inputs(tmp_path):
    qs = _make({("a", "normal"): 10, ("b", "normal"): 5, ("c", "short"): 1})
    qpath = _write_jsonl(tmp_path / "queries.jsonl", qs)
    cpath = tmp_path / "corpus.json"
    cpath.write_text('{"corpus": "sahte"}', encoding="utf-8")
    dev, held = split.split_queries(qs)
    return qs, qpath, cpath, dev, held


def test_build_manifest_structure(tmp_path):
    qs, qpath, cpath, dev, held = _manifest_inputs(tmp_path)
    m = split.build_manifest(
        "v1", qs, qpath, cpath, dev, held,
        split.DEFAULT_SEED, split.DEFAULT_HELDOUT_RATIO,
    )
    assert m["version"] == "v1"
    assert m["created_at"].endswith("Z")
    assert m["seed"] == split.DEFAULT_SEED
    assert m["corpus_digest"] == _sha(cpath)
    assert m["queries_digest"] == _sha(qpath)
    assert m["split"]["heldout_ratio"] == 0.4
    assert m["split"]["dev_ids"] == dev
    assert m["split"]["heldout_ids"] == held
    assert m["split"]["split_digest"] == split.split_digest(dev, held)
    assert m["counts"]["total"] == 16
    assert m["counts"]["dev"] == len(dev)
    assert m["counts"]["heldout"] == len(held)
    assert "bellek" in m["tools"]


def test_build_manifest_by_cell(tmp_path):
    qs, qpath, cpath, dev, held = _manifest_inputs(tmp_path)
    m = split.build_manifest("v1", qs, qpath, cpath, dev, held, 20261024, 0.4)
    by_cell = m["counts"]["by_cell"]
    assert by_cell == {
        "a/normal": {"dev": 6, "heldout": 4},
        "b/normal": {"dev": 3, "heldout": 2},
        "c/short": {"dev": 1, "heldout": 0},
    }


def test_manifest_has_no_text_or_project(tmp_path):
    qs, qpath, cpath, dev, held = _manifest_inputs(tmp_path)
    m = split.build_manifest("v1", qs, qpath, cpath, dev, held, 20261024, 0.4)
    blob = json.dumps(m, ensure_ascii=False)
    assert TEXT_MARKER not in blob
    assert PROJECT_MARKER not in blob
    assert "ZXQSPLITMETIN" not in blob


def test_write_manifest_roundtrip_and_parent_dirs(tmp_path):
    qs, qpath, cpath, dev, held = _manifest_inputs(tmp_path)
    m = split.build_manifest("v1", qs, qpath, cpath, dev, held, 20261024, 0.4)
    out = tmp_path / "alt" / "klasor" / "m.json"
    split.write_manifest(m, out)
    assert out.exists()
    assert json.loads(out.read_text(encoding="utf-8")) == m


def test_write_manifest_existing_raises(tmp_path):
    out = tmp_path / "m.json"
    out.write_text("{}", encoding="utf-8")
    with pytest.raises(FileExistsError):
        split.write_manifest({"a": 1}, out)
    assert out.read_text(encoding="utf-8") == "{}"


# --- CLI -------------------------------------------------------------------


def _cli_args(qpath, cpath, out, version="v1"):
    return [
        "--version", version,
        "--queries", str(qpath),
        "--corpus-manifest", str(cpath),
        "--out", str(out),
    ]


def test_cli_success_then_refuses_overwrite(tmp_path, capsys):
    qs, qpath, cpath, _, _ = _manifest_inputs(tmp_path)
    out = tmp_path / "man" / "split_v1.json"
    assert split.main(_cli_args(qpath, cpath, out)) == 0
    assert out.exists()
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["version"] == "v1"
    assert data["counts"]["total"] == 16
    captured = capsys.readouterr()
    assert TEXT_MARKER not in captured.out
    assert TEXT_MARKER not in captured.err
    # ikinci çalıştırma: dosya var -> 1
    before = out.read_bytes()
    assert split.main(_cli_args(qpath, cpath, out)) == 1
    assert out.read_bytes() == before


def test_cli_missing_queries_returns_1(tmp_path):
    _, _, cpath, _, _ = _manifest_inputs(tmp_path)
    out = tmp_path / "m.json"
    rc = split.main(_cli_args(tmp_path / "yok.jsonl", cpath, out))
    assert rc == 1
    assert not out.exists()


def test_cli_unknown_argument_returns_2(tmp_path):
    _, qpath, cpath, _, _ = _manifest_inputs(tmp_path)
    out = tmp_path / "m.json"
    rc = split.main(_cli_args(qpath, cpath, out) + ["--bilinmeyen", "x"])
    assert rc == 2
    assert not out.exists()
