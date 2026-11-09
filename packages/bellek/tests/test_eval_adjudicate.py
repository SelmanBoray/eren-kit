"""eval/adjudicate.py testleri: yalniz sozlesmeden yazildi, yalniz tmp_path."""
import json
from pathlib import Path

import pytest

from eval import adjudicate

MARK = "ZZQMARKERZZ"


def jur(qid, juror, labels=None, contentless=False, whys=None):
    whys = whys or {}
    return {
        "qid": qid,
        "juror": juror,
        "contentless": contentless,
        "labels": [
            {"note": n, "grade": g, "why": whys.get(n, f"w{juror}-{n}")}
            for n, g in (labels or {}).items()
        ],
        "read": list((labels or {}).keys()),
    }


def A(qid, labels=None, contentless=False):
    return jur(qid, "a", labels, contentless)


def B(qid, labels=None, contentless=False):
    return jur(qid, "b", labels, contentless)


def queries(*qids):
    return {q: {"id": q, "text": f"{MARK} metin {q}", "project": f"proj-{q}"} for q in qids}


def hk(qid, note, grades, final, why="hakem-why", model="m"):
    return {"qid": qid, "note": note, "grades": list(grades), "final": final,
            "why": why, "model": model}


def hk_cl(qid, value):
    return {"qid": qid, "note": None, "contentless": value, "grades": [0, 0],
            "final": 0, "why": "cl", "model": "m"}


def write_jsonl(path, rows):
    Path(path).write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")


def read_jsonl(path):
    return [json.loads(x) for x in Path(path).read_text(encoding="utf-8").splitlines() if x.strip()]


# ---------------------------------------------------------------- load_jsonl
def test_load_jsonl_skips_blank_lines(tmp_path):
    p = tmp_path / "x.jsonl"
    p.write_text('{"a": 1}\n\n   \n{"a": 2}\n', encoding="utf-8")
    assert adjudicate.load_jsonl(p) == [{"a": 1}, {"a": 2}]


def test_load_jsonl_bad_line_raises_valueerror(tmp_path):
    p = tmp_path / "x.jsonl"
    p.write_text('{"a": 1}\n{bozuk\n', encoding="utf-8")
    with pytest.raises(ValueError):
        adjudicate.load_jsonl(p)


# -------------------------------------------------------------- juror_grades
def test_juror_grades_structure():
    rows = [
        jur("q1", "a", {"n1": 2, "n2": 1}, whys={"n1": "neden1", "n2": "neden2"}),
        jur("q2", "a", {}, contentless=True),
    ]
    out = adjudicate.juror_grades(rows)
    assert out["q1"]["contentless"] is False
    assert out["q1"]["grades"] == {"n1": 2, "n2": 1}
    assert out["q1"]["whys"] == {"n1": "neden1", "n2": "neden2"}
    assert out["q2"]["contentless"] is True
    assert out["q2"]["grades"] == {}


# ------------------------------------------------------------------- prepare
def test_prepare_pair_item_fields_and_equal_excluded():
    a = [A("q1", {"n1": 2, "n2": 1, "n3": 1})]
    b = [B("q1", {"n1": 2, "n2": 2})]  # n1 ayni, n2 farkli, n3 B'de yok (1 vs 0)
    batches = adjudicate.prepare(a, b, queries("q1"))
    items = [i for bt in batches for i in bt]
    assert [i["item"] for i in items] == ["q1|n2", "q1|n3"]
    it = items[0]
    assert it["qid"] == "q1" and it["note"] == "n2"
    assert it["text"] == f"{MARK} metin q1" and it["project"] == "proj-q1"
    assert sorted(it["grades"]) == [1, 2]


def test_prepare_unlisted_is_grade_zero_with_empty_why():
    a = [A("q1", {"n3": 1})]
    b = [B("q1", {})]
    items = adjudicate.prepare(a, b, queries("q1"))[0]
    it = items[0]
    assert it["item"] == "q1|n3"
    assert sorted(it["grades"]) == [0, 1]
    i0 = it["grades"].index(0)
    assert it["whys"][i0] == ""
    assert it["whys"][1 - i0] == "wa-n3"


def test_prepare_whys_aligned_with_grades_and_no_juror_identity():
    qids = ["q%02d" % i for i in range(60)]
    a = [A(q, {"n": 2}) for q in qids]
    b = [B(q, {"n": 1}) for q in qids]
    items = [i for bt in adjudicate.prepare(a, b, queries(*qids)) for i in bt]
    assert len(items) == 60
    a_first = b_first = 0
    for it in items:
        for k in ("a", "b", "juror"):
            assert k not in it
        if it["grades"] == [2, 1]:
            assert it["whys"] == ["wa-n", "wb-n"]
            a_first += 1
        else:
            assert it["grades"] == [1, 2]
            assert it["whys"] == ["wb-n", "wa-n"]
            b_first += 1
    assert a_first > 0 and b_first > 0


def test_prepare_only_common_qids():
    a = [A("q1", {"n": 1}), A("q2", {"n": 1})]
    b = [B("q1", {"n": 2}), B("q3", {"n": 2})]
    items = [i for bt in adjudicate.prepare(a, b, queries("q1", "q2", "q3")) for i in bt]
    assert [i["qid"] for i in items] == ["q1"]


def test_prepare_contentless_item():
    a = [A("q1", {}, contentless=True), A("q2", {}, contentless=True)]
    b = [B("q1", {}, contentless=False), B("q2", {}, contentless=True)]
    items = [i for bt in adjudicate.prepare(a, b, queries("q1", "q2")) for i in bt]
    assert len(items) == 1
    it = items[0]
    assert it["item"] == "q1|contentless"
    assert it["qid"] == "q1" and it["note"] is None
    assert sorted(it["contentless"]) == [False, True]
    assert it["text"] == f"{MARK} metin q1" and it["project"] == "proj-q1"
    for k in ("a", "b", "juror"):
        assert k not in it


def test_prepare_sorted_qid_note_none_last():
    a = [A("q2", {"nb": 1, "na": 1}), A("q1", {"z": 1}, contentless=True)]
    b = [B("q2", {"nb": 2, "na": 2}), B("q1", {"z": 2}, contentless=False)]
    items = [i for bt in adjudicate.prepare(a, b, queries("q1", "q2")) for i in bt]
    assert [i["item"] for i in items] == ["q1|z", "q1|contentless", "q2|na", "q2|nb"]


def test_prepare_batching_45_items():
    a = [A("q1", {f"n{i:02d}": 1 for i in range(45)})]
    b = [B("q1", {f"n{i:02d}": 2 for i in range(45)})]
    batches = adjudicate.prepare(a, b, queries("q1"), batch_size=40)
    assert [len(x) for x in batches] == [40, 5]
    batches2 = adjudicate.prepare(a, b, queries("q1"), batch_size=10)
    assert [len(x) for x in batches2] == [10, 10, 10, 10, 5]


def test_prepare_deterministic_same_seed():
    a = [A("q1", {f"n{i:02d}": 1 for i in range(30)})]
    b = [B("q1", {f"n{i:02d}": 2 for i in range(30)})]
    assert adjudicate.prepare(a, b, queries("q1"), seed=7) == adjudicate.prepare(a, b, queries("q1"), seed=7)
    assert adjudicate.prepare(a, b, queries("q1")) == adjudicate.prepare(a, b, queries("q1"))


def test_prepare_no_diffs_gives_no_batches():
    a = [A("q1", {"n": 1})]
    b = [B("q1", {"n": 1})]
    assert adjudicate.prepare(a, b, queries("q1")) == []


# ------------------------------------------------------------- write_prepare
def test_write_prepare_files_and_existing_dir(tmp_path):
    batch1 = [{"item": "q1|a"}, {"item": "q1|b"}]
    batch2 = [{"item": "q1|c"}]
    out = tmp_path / "adj"
    paths = adjudicate.write_prepare([batch1, batch2], out)
    assert [Path(p).name for p in paths] == ["adj-01.jsonl", "adj-02.jsonl"]
    assert len(read_jsonl(paths[0])) == 2 and len(read_jsonl(paths[1])) == 1
    with pytest.raises(FileExistsError):
        adjudicate.write_prepare([batch1], out)


def test_write_prepare_empty_existing_dir_ok(tmp_path):
    out = tmp_path / "empty"
    out.mkdir()
    paths = adjudicate.write_prepare([[{"item": "x"}]], out)
    assert len(paths) == 1 and Path(paths[0]).exists()


# --------------------------------------------------------------------- merge
def test_merge_agree_uses_a_why():
    a = [jur("q1", "a", {"n1": 2}, whys={"n1": "A-why"})]
    b = [jur("q1", "b", {"n1": 2}, whys={"n1": "B-why"})]
    qrels, gt, problems = adjudicate.merge(a, b, [])
    assert qrels == [{"qid": "q1", "note": "n1", "grade": 2, "source": "agree", "why": "A-why"}]
    assert problems == []


def test_merge_agree_why_from_b_when_a_lacks_it():
    # n1'i yalniz B listeler; A'da yok (0) -> farkli olur. Burada ikisi de 1 ama A'nin why'i bos.
    a = [jur("q1", "a", {"n1": 1}, whys={"n1": ""})]
    b = [jur("q1", "b", {"n1": 1}, whys={"n1": "B-why"})]
    qrels, _, _ = adjudicate.merge(a, b, [])
    assert qrels[0]["why"] == "B-why"


def test_merge_disagree_uses_adjudicator():
    a = [A("q1", {"n1": 2})]
    b = [B("q1", {"n1": 1})]
    qrels, gt, problems = adjudicate.merge(a, b, [hk("q1", "n1", [2, 1], 1, why="HW")])
    assert qrels == [{"qid": "q1", "note": "n1", "grade": 1, "source": "hakem", "why": "HW"}]
    assert problems == []


def test_merge_adjudicator_grades_order_irrelevant():
    a = [A("q1", {"n1": 2})]
    b = [B("q1", {"n1": 1})]
    q1, _, p1 = adjudicate.merge(a, b, [hk("q1", "n1", [1, 2], 2)])
    assert q1[0]["grade"] == 2 and p1 == []


def test_merge_missing_adjudicator_row_is_problem_and_pair_excluded():
    a = [A("q1", {"n1": 2, "n2": 1})]
    b = [B("q1", {"n1": 1, "n2": 1})]
    qrels, gt, problems = adjudicate.merge(a, b, [])
    assert [r["note"] for r in qrels] == ["n2"]
    assert len(problems) == 1
    assert "q1" in problems[0] and "n1" in problems[0]


def test_merge_adjudicator_final_zero_excluded():
    a = [A("q1", {"n1": 1})]
    b = [B("q1", {"n1": 2})]
    qrels, gt, problems = adjudicate.merge(a, b, [hk("q1", "n1", [1, 2], 0)])
    assert qrels == [] and problems == []
    assert gt[0]["negative"] is True


def test_merge_degerlendirici_override_on_agree_pair():
    a = [A("q1", {"n1": 1})]
    b = [B("q1", {"n1": 1})]
    s = [{"qid": "q1", "note": "n1", "old": 1, "new": 2, "why": "S"}]
    qrels, gt, problems = adjudicate.merge(a, b, [], s)
    assert qrels[0]["grade"] == 2 and qrels[0]["source"] == "degerlendirici"
    assert gt[0]["degerlendirici_checked"] is True


def test_merge_degerlendirici_override_on_adjudicated_pair():
    a = [A("q1", {"n1": 1})]
    b = [B("q1", {"n1": 2})]
    s = [{"qid": "q1", "note": "n1", "old": 2, "new": 1, "why": "S"}]
    qrels, _, _ = adjudicate.merge(a, b, [hk("q1", "n1", [1, 2], 2)], s)
    assert qrels[0]["grade"] == 1 and qrels[0]["source"] == "degerlendirici"


def test_merge_degerlendirici_zero_excludes():
    a = [A("q1", {"n1": 2})]
    b = [B("q1", {"n1": 2})]
    s = [{"qid": "q1", "note": "n1", "old": 2, "new": 0, "why": "S"}]
    qrels, gt, _ = adjudicate.merge(a, b, [], s)
    assert qrels == [] and gt[0]["negative"] is True


def test_merge_degerlendirici_raises_zero_pair_to_two():
    a = [A("q1", {"n1": 1})]
    b = [B("q1", {})]
    adj = [hk("q1", "n1", [1, 0], 0)]
    s = [{"qid": "q1", "note": "n1", "old": 0, "new": 2, "why": "S"}]
    qrels, gt, _ = adjudicate.merge(a, b, adj, s)
    assert len(qrels) == 1 and qrels[0]["grade"] == 2 and qrels[0]["source"] == "degerlendirici"
    assert gt[0]["negative"] is False


def test_merge_contentless_agree_differ_missing():
    a = [A("q1", {}, True), A("q2", {}, True), A("q3", {}, False)]
    b = [B("q1", {}, True), B("q2", {}, False), B("q3", {}, True)]
    adj = [hk_cl("q2", True)]
    _, gt, problems = adjudicate.merge(a, b, adj)
    d = {g["qid"]: g for g in gt}
    assert d["q1"]["contentless"] is True      # ayni
    assert d["q2"]["contentless"] is True      # hakem
    assert len(problems) == 1 and "q3" in problems[0]  # hakem yok


def test_merge_contentless_adjudicator_false():
    a = [A("q1", {}, True)]
    b = [B("q1", {}, False)]
    _, gt, problems = adjudicate.merge(a, b, [hk_cl("q1", False)])
    assert gt[0]["contentless"] is False and problems == []


def test_merge_qrels_only_positive_sorted_and_gt_queries():
    a = [A("q2", {"nb": 1, "na": 2}), A("q1", {"z": 2}), A("q3", {})]
    b = [B("q2", {"nb": 1, "na": 2}), B("q1", {"z": 2}), B("q3", {})]
    qrels, gt, problems = adjudicate.merge(a, b, [])
    assert [(r["qid"], r["note"]) for r in qrels] == [("q1", "z"), ("q2", "na"), ("q2", "nb")]
    for r in qrels:
        assert set(r) == {"qid", "note", "grade", "source", "why"} and r["grade"] >= 1
    assert [g["qid"] for g in gt] == ["q1", "q2", "q3"]
    for g in gt:
        assert set(g) == {"qid", "negative", "contentless", "degerlendirici_checked"}
    d = {g["qid"]: g for g in gt}
    assert d["q3"]["negative"] is True and d["q1"]["negative"] is False
    assert all(g["degerlendirici_checked"] is False for g in gt)
    assert problems == []


def test_merge_single_juror_qid_is_problem():
    a = [A("q1", {"n": 1}), A("q2", {"n": 1})]
    b = [B("q1", {"n": 1})]
    qrels, gt, problems = adjudicate.merge(a, b, [])
    assert [g["qid"] for g in gt] == ["q1"]
    assert any("q2" in p for p in problems)
    assert all(r["qid"] == "q1" for r in qrels)


# --------------------------------------------------------------- write_merge
def test_write_merge_writes_both_files(tmp_path):
    qrels = [{"qid": "q1", "note": "n", "grade": 1, "source": "agree", "why": "w"}]
    gt = [{"qid": "q1", "negative": False, "contentless": False, "degerlendirici_checked": False}]
    adjudicate.write_merge(qrels, gt, tmp_path)
    assert read_jsonl(tmp_path / "qrels.jsonl") == qrels
    assert read_jsonl(tmp_path / "gt-queries.jsonl") == gt


@pytest.mark.parametrize("existing", ["qrels.jsonl", "gt-queries.jsonl"])
def test_write_merge_existing_file_blocks_all(tmp_path, existing):
    (tmp_path / existing).write_text("eski\n", encoding="utf-8")
    with pytest.raises(FileExistsError):
        adjudicate.write_merge([], [], tmp_path)
    other = "gt-queries.jsonl" if existing == "qrels.jsonl" else "qrels.jsonl"
    assert not (tmp_path / other).exists()
    assert (tmp_path / existing).read_text(encoding="utf-8") == "eski\n"


# ----------------------------------------------------------------------- CLI
def _setup_inputs(tmp_path, with_diff=True):
    a = [A("q1", {"n1": 2, "n2": 1})]
    b = [B("q1", {"n1": 1 if with_diff else 2, "n2": 1})]
    q = [{"id": "q1", "text": f"{MARK} sorgu", "project": "p"}]
    write_jsonl(tmp_path / "a.jsonl", a)
    write_jsonl(tmp_path / "b.jsonl", b)
    write_jsonl(tmp_path / "q.jsonl", q)
    return tmp_path / "a.jsonl", tmp_path / "b.jsonl", tmp_path / "q.jsonl"


def test_cli_prepare_ok_then_exists(tmp_path, capsys):
    a, b, q = _setup_inputs(tmp_path)
    out = tmp_path / "adj"
    argv = ["prepare", "--a", str(a), "--b", str(b), "--queries", str(q), "--out", str(out)]
    assert adjudicate.main(argv) == 0
    assert (out / "adj-01.jsonl").exists()
    assert MARK not in capsys.readouterr().out
    assert adjudicate.main(argv) == 1  # out dolu
    assert MARK not in capsys.readouterr().out


def test_cli_merge_ok(tmp_path, capsys):
    a, b, _ = _setup_inputs(tmp_path)
    h = tmp_path / "h.jsonl"
    write_jsonl(h, [hk("q1", "n1", [2, 1], 2)])
    out = tmp_path / "gt"
    rc = adjudicate.main(["merge", "--a", str(a), "--b", str(b),
                          "--adjudication", str(h), "--out", str(out)])
    assert rc == 0
    assert (out / "qrels.jsonl").exists() and (out / "gt-queries.jsonl").exists()
    assert MARK not in capsys.readouterr().out


def test_cli_merge_with_degerlendirici(tmp_path):
    a, b, _ = _setup_inputs(tmp_path, with_diff=False)
    h = tmp_path / "h.jsonl"
    h.write_text("", encoding="utf-8")
    s = tmp_path / "s.jsonl"
    write_jsonl(s, [{"qid": "q1", "note": "n1", "old": 2, "new": 0, "why": "S"}])
    out = tmp_path / "gt"
    rc = adjudicate.main(["merge", "--a", str(a), "--b", str(b), "--adjudication", str(h),
                          "--degerlendirici", str(s), "--out", str(out)])
    assert rc == 0
    assert [r["note"] for r in read_jsonl(out / "qrels.jsonl")] == ["n2"]


def test_cli_merge_missing_adjudication_writes_nothing(tmp_path):
    a, b, _ = _setup_inputs(tmp_path)
    h = tmp_path / "h.jsonl"
    h.write_text("", encoding="utf-8")
    out = tmp_path / "gt"
    rc = adjudicate.main(["merge", "--a", str(a), "--b", str(b),
                          "--adjudication", str(h), "--out", str(out)])
    assert rc == 1
    assert not (out / "qrels.jsonl").exists()
    assert not (out / "gt-queries.jsonl").exists()


def test_cli_unknown_subcommand_returns_2():
    assert adjudicate.main(["bilinmeyen"]) == 2
