"""eval/agreement.py testleri -- yalnizca sozlesmeden yazildi (tmp_path disinda dosya yok)."""
from __future__ import annotations

import copy
import dataclasses
import json

import pytest

from eval import agreement
from eval.agreement import JurorRow

NOTES = ["n1", "n2", "n3", "n4"]
QIDS = ["q1", "q2", "q3", "q4"]


# ---------------------------------------------------------------- yardimcilar
def row(qid, labels=(), contentless=False, juror="a", extra_read=(), **over):
    """labels: [(note, grade, why)]; read etiketli notlari + extra_read'i icerir."""
    d = {
        "qid": qid, "juror": juror, "model": "m", "rubric": "r1", "batch": 1,
        "contentless": contentless,
        "labels": [{"note": n, "grade": g, "why": w} for n, g, w in labels],
        "read": [n for n, _, _ in labels] + list(extra_read),
        "comment": "",
    }
    d.update(over)
    return d


def write_jsonl(path, rows):
    path.write_text("\n".join(r if isinstance(r, str) else json.dumps(r) for r in rows) + "\n",
                    encoding="utf-8")
    return path


def jr(qid, grades=None, whys=None, contentless=False, juror="a"):
    grades = dict(grades or {})
    whys = whys if whys is not None else {n: f"why {n}" for n, g in grades.items() if g}
    return JurorRow(qid, juror, contentless, grades, whys, tuple(grades))


# Senaryo 1: A ve B sorgu duzeyinde negatiflikte tam uyumlu
def scen1():
    a = {
        "q1": jr("q1", {"n1": 2, "n2": 1}, {"n1": "A n1", "n2": "A n2"}),
        "q2": jr("q2", {"n3": 1}, {"n3": "A n3"}),
        "q3": jr("q3"),
        "q4": jr("q4", contentless=True),
    }
    b = {
        "q1": jr("q1", {"n1": 2}, {"n1": "B n1"}, juror="b"),
        "q2": jr("q2", {"n3": 1}, {"n3": "B n3"}, juror="b"),
        "q3": jr("q3", juror="b"),
        "q4": jr("q4", juror="b"),
    }
    return a, b


# Senaryo 2: B q2'yi bos birakir (negatiflik ayrisir)
def scen2():
    a, b = scen1()
    b["q2"] = jr("q2", juror="b")
    return a, b


# ---------------------------------------------------------------- JurorRow
def test_juror_row_is_frozen_dataclass():
    r = jr("q1", {"n1": 1})
    assert dataclasses.is_dataclass(r)
    with pytest.raises(dataclasses.FrozenInstanceError):
        r.qid = "x"


# ---------------------------------------------------------------- load_juror
def test_load_valid_file(tmp_path):
    p = write_jsonl(tmp_path / "a.jsonl", [
        row("q1", [("n1", 2, "cunku"), ("n2", 1, "yararli")], extra_read=["n3"]),
        row("q2"),
        row("q3", contentless=True),
        row("q4"),
    ])
    rows, errors = agreement.load_juror(p, set(QIDS), set(NOTES))
    assert errors == []
    assert set(rows) == set(QIDS)
    r = rows["q1"]
    assert r.qid == "q1" and r.juror == "a" and r.contentless is False
    assert dict(r.grades) == {"n1": 2, "n2": 1}
    assert dict(r.whys) == {"n1": "cunku", "n2": "yararli"}
    assert tuple(r.read) == ("n1", "n2", "n3")
    assert rows["q3"].contentless is True
    assert dict(rows["q2"].grades) == {}


def test_optional_fields_not_required(tmp_path):
    rec = row("q1", [("n1", 1, "w")])
    for k in ("model", "rubric", "batch", "comment"):
        del rec[k]
    p = write_jsonl(tmp_path / "a.jsonl", [rec])
    rows, errors = agreement.load_juror(p, {"q1"}, set(NOTES))
    assert errors == []
    assert "q1" in rows


def _mut_del(key):
    def f(d):
        del d[key]
    return f


def _set(key, val):
    def f(d):
        d[key] = val
    return f


def _label(i, key, val):
    def f(d):
        d["labels"][i][key] = val
    return f


def _append_label(note, grade=1, why="w"):
    def f(d):
        d["labels"].append({"note": note, "grade": grade, "why": why})
        d["read"].append(note)
    return f


def _drop_read(note):
    def f(d):
        d["read"].remove(note)
    return f


BAD_MUTATIONS = {
    "qid_missing": _mut_del("qid"),
    "qid_wrong_type": _set("qid", 7),
    "juror_missing": _mut_del("juror"),
    "juror_wrong_type": _set("juror", 1),
    "contentless_missing": _mut_del("contentless"),
    "contentless_str": _set("contentless", "false"),
    "labels_missing": _mut_del("labels"),
    "labels_wrong_type": _set("labels", "n1"),
    "read_missing": _mut_del("read"),
    "read_wrong_type": _set("read", "n1"),
    "grade_0": _label(0, "grade", 0),
    "grade_3": _label(0, "grade", 3),
    "why_empty": _label(0, "why", ""),
    "note_unknown": _label(0, "note", "zzz"),
    "note_twice": _append_label("n1"),
    "label_not_read": _drop_read("n1"),
    "contentless_with_labels": _set("contentless", True),
}


@pytest.mark.parametrize("name", sorted(BAD_MUTATIONS))
def test_invalid_row_rejected(tmp_path, name):
    bad = row("q1", [("n1", 2, "w")])
    BAD_MUTATIONS[name](bad)
    good = row("q2", [("n2", 1, "w")])
    p = write_jsonl(tmp_path / "a.jsonl", [bad, good])
    rows, errors = agreement.load_juror(p, {"q1", "q2"}, set(NOTES))
    assert errors, name
    assert "q1" not in rows
    assert "q2" in rows          # gecerli satir korunur


def test_not_json_line(tmp_path):
    p = write_jsonl(tmp_path / "a.jsonl", ["{bu json degil", row("q2", [("n2", 1, "w")])])
    rows, errors = agreement.load_juror(p, {"q2"}, set(NOTES))
    assert errors
    assert "q2" in rows


def test_missing_qids_reported_but_valid_rows_kept(tmp_path):
    p = write_jsonl(tmp_path / "a.jsonl", [row("q1", [("n1", 1, "w")])])
    rows, errors = agreement.load_juror(p, {"q1", "q2"}, set(NOTES))
    assert "q1" in rows and "q2" not in rows
    assert any("q2" in e for e in errors)


def test_duplicate_qid_is_error(tmp_path):
    p = write_jsonl(tmp_path / "a.jsonl", [row("q1", [("n1", 1, "w")]), row("q1", [("n2", 1, "w")])])
    rows, errors = agreement.load_juror(p, {"q1"}, set(NOTES))
    assert errors
    # ikinci satir (n2) rows'a girmemeli
    if "q1" in rows:
        assert "n2" not in rows["q1"].grades


def test_unexpected_qid_rejected(tmp_path):
    p = write_jsonl(tmp_path / "a.jsonl", [row("q1", [("n1", 1, "w")]), row("q99", [("n1", 1, "w")])])
    rows, errors = agreement.load_juror(p, {"q1"}, set(NOTES))
    assert errors
    assert "q99" not in rows and "q1" in rows


# ---------------------------------------------------------------- pair_grades
def test_pair_grades_common_qids_times_all_notes():
    a = {"q1": jr("q1", {"n1": 2}), "q2": jr("q2", {"n2": 1})}
    b = {"q1": jr("q1", {"n1": 1}, juror="b"), "q3": jr("q3", {"n3": 1}, juror="b")}
    out = agreement.pair_grades(a, b, NOTES)
    assert len(out) == 1 * len(NOTES)          # yalniz q1 ortak
    assert {t[0] for t in out} == {"q1"}
    assert {t[1] for t in out} == set(NOTES)
    d = {(q, n): (ga, gb) for q, n, ga, gb in out}
    assert d[("q1", "n1")] == (2, 1)
    assert d[("q1", "n2")] == (0, 0)           # listelenmeyen 0


def test_pair_grades_unlisted_zero_each_side():
    a = {"q1": jr("q1", {"n1": 1})}
    b = {"q1": jr("q1", {"n2": 2}, juror="b")}
    d = {(q, n): (ga, gb) for q, n, ga, gb in agreement.pair_grades(a, b, NOTES)}
    assert d[("q1", "n1")] == (1, 0)
    assert d[("q1", "n2")] == (0, 2)


# ---------------------------------------------------------------- weighted_kappa
def test_weighted_kappa_hand_computed_asymmetric():
    # Karisiklik (A satir, B sutun): 00:4 01:1 10:1 11:1 12:1 22:2  (n=10)
    # a=(.5,.3,.2) b=(.5,.2,.3)
    # p_o = .7 + .5*.3 = .85 ; p_e = .37 + .5*.38 = .56 ; k = .29/.44
    pairs = ([(0, 0)] * 4 + [(0, 1)] + [(1, 0)] + [(1, 1)] + [(1, 2)] + [(2, 2)] * 2)
    assert agreement.weighted_kappa(pairs) == pytest.approx(0.29 / 0.44)
    swapped = [(y, x) for x, y in pairs]
    assert agreement.weighted_kappa(swapped) == pytest.approx(0.29 / 0.44)


def test_weighted_kappa_complete_disagreement_distance_two():
    # (0,2),(2,0): p_o=0, p_e=.5 -> -1
    assert agreement.weighted_kappa([(0, 2), (2, 0)]) == pytest.approx(-1.0)


def test_weighted_kappa_perfect():
    pairs = [(0, 0), (1, 1), (2, 2), (0, 0)]
    assert agreement.weighted_kappa(pairs) == pytest.approx(1.0)


def test_weighted_kappa_single_category_none():
    assert agreement.weighted_kappa([(0, 0)] * 10) is None


def test_weighted_kappa_two_categories_perfect():
    assert agreement.weighted_kappa([(0, 0), (1, 1), (0, 0)]) == pytest.approx(1.0)


# ---------------------------------------------------------------- cohen_kappa
def test_cohen_kappa_hand_computed():
    # TT:3 TF:1 FT:2 FF:4 (n=10): p_o=.7, a_T=.4 b_T=.5, p_e=.5 -> .4
    pairs = [(True, True)] * 3 + [(True, False)] + [(False, True)] * 2 + [(False, False)] * 4
    assert agreement.cohen_kappa(pairs) == pytest.approx(0.4)


def test_cohen_kappa_perfect_and_degenerate():
    assert agreement.cohen_kappa([(True, True), (False, False)]) == pytest.approx(1.0)
    assert agreement.cohen_kappa([(True, True)] * 5) is None       # p_e == 1
    assert agreement.cohen_kappa([(False, False)] * 5) is None


# ---------------------------------------------------------------- agreement
def test_agreement_scenario1_values():
    a, b = scen1()
    r = agreement.agreement(a, b, NOTES)
    assert r["n_queries"] == 4
    assert r["n_pairs"] == 16
    # Karisiklik: 00:13 10:1 11:1 22:1 ; a=(13,2,1) b=(14,1,1) /16
    # p_o = 15.5/16 ; p_e = (185 + .5*44)/256 = 207/256 ; kappa_w = 41/49
    assert r["kappa_w"] == pytest.approx(41 / 49)
    assert r["raw_all"] == pytest.approx(15 / 16)
    assert r["raw_pos"] == pytest.approx(2 / 3)       # 3 pozitif cift, 2 ayni
    assert r["psa"] == pytest.approx(2 * 2 / (3 + 2))
    assert r["a_pos_pairs"] == 3
    assert r["b_pos_pairs"] == 2
    assert r["neg_kappa"] == pytest.approx(1.0)       # negatiflik her sorguda ayni
    assert r["neg_raw"] == pytest.approx(1.0)
    assert r["contentless_agree"] == pytest.approx(3 / 4)
    assert r["threshold"] == {"kappa_w": 0.60, "neg_kappa": 0.60}
    assert r["passed"] is True


def test_agreement_scenario2_negativity_disagreement_fails():
    a, b = scen2()
    r = agreement.agreement(a, b, NOTES)
    # Karisiklik: 00:13 10:2 22:1 ; a=(13,2,1) b=(15,0,1)
    # p_o = (14 + .5*2)/16 = .9375 ; p_e = (195+1 + .5*32)/256 = 212/256
    assert r["kappa_w"] == pytest.approx(7 / 11)
    # Negatiflik: A=(P,P,N,N) B=(P,N,N,N): p_o=.75, p_e=.5*.75+.5*.25=.5 -> .5
    assert r["neg_kappa"] == pytest.approx(0.5)
    assert r["neg_raw"] == pytest.approx(0.75)
    assert r["kappa_w"] >= 0.60
    assert r["passed"] is False


def test_agreement_no_positive_pairs():
    a = {"q1": jr("q1"), "q2": jr("q2")}
    b = {"q1": jr("q1", juror="b"), "q2": jr("q2", juror="b")}
    r = agreement.agreement(a, b, NOTES)
    assert r["raw_pos"] is None
    assert r["psa"] is None
    assert r["kappa_w"] is None
    assert r["raw_all"] == pytest.approx(1.0)
    assert r["passed"] is False                 # None -> gecmez


def test_agreement_only_common_qids_counted():
    a, b = scen1()
    del b["q4"]
    r = agreement.agreement(a, b, NOTES)
    assert r["n_queries"] == 3
    assert r["n_pairs"] == 12


# ---------------------------------------------------------------- disagreements
def test_disagreements_scenario1():
    a, b = scen1()
    out = agreement.disagreements(a, b, NOTES)
    assert out == [
        {"qid": "q1", "note": "n2", "grades": [1, 0], "whys": ["A n2", ""]},
        {"qid": "q4", "note": None, "contentless": [True, False]},
    ]


def test_disagreements_sorted_and_both_whys():
    a = {"q2": jr("q2", {"n1": 1, "n3": 2}, {"n1": "a1", "n3": "a3"}),
         "q1": jr("q1", {"n4": 1}, {"n4": "a4"})}
    b = {"q2": jr("q2", {"n1": 2, "n3": 2}, {"n1": "b1", "n3": "b3"}, juror="b"),
         "q1": jr("q1", juror="b")}
    out = agreement.disagreements(a, b, NOTES)
    assert [(d["qid"], d["note"]) for d in out] == [("q1", "n4"), ("q2", "n1")]
    assert out[1] == {"qid": "q2", "note": "n1", "grades": [1, 2], "whys": ["a1", "b1"]}


def test_disagreements_identical_is_empty():
    a, _ = scen1()
    b = copy.deepcopy(a)
    assert agreement.disagreements(a, b, NOTES) == []


# ---------------------------------------------------------------- CLI
def _cli_setup(tmp_path, a_rows, b_rows):
    notes = write_jsonl(tmp_path / "notes.jsonl", [{"note_id": n} for n in NOTES])
    bdir = tmp_path / "batches"
    bdir.mkdir()
    write_jsonl(bdir / "batch-1.jsonl", [{"qid": q, "text": "t", "project": "p"} for q in QIDS[:2]])
    write_jsonl(bdir / "batch-2.jsonl", [{"qid": q, "text": "t", "project": "p"} for q in QIDS[2:]])
    pa = write_jsonl(tmp_path / "a.jsonl", a_rows)
    pb = write_jsonl(tmp_path / "b.jsonl", b_rows)
    out = tmp_path / "out.json"
    argv = ["--a", str(pa), "--b", str(pb), "--notes", str(notes),
            "--batches", str(bdir), "--out", str(out)]
    return argv, out


A_FILE = [
    row("q1", [("n1", 2, "w"), ("n2", 1, "w")]),
    row("q2", [("n3", 1, "w")]),
    row("q3"),
    row("q4", contentless=True),
]
B_FILE = [
    row("q1", [("n1", 2, "w")], juror="b"),
    row("q2", [("n3", 1, "w")], juror="b"),
    row("q3", juror="b"),
    row("q4", juror="b"),
]


def test_cli_pass_exit_0(tmp_path):
    argv, out = _cli_setup(tmp_path, A_FILE, B_FILE)
    assert agreement.main(argv) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    for k in ("n_queries", "n_pairs", "kappa_w", "raw_all", "raw_pos", "psa", "neg_kappa",
              "neg_raw", "a_pos_pairs", "b_pos_pairs", "contentless_agree", "threshold", "passed"):
        assert k in data
    assert data["errors"] == {"a": [], "b": []}
    assert data["kappa_w"] == pytest.approx(41 / 49)
    assert data["passed"] is True


def test_cli_below_threshold_exit_3(tmp_path):
    b_rows = [B_FILE[0], row("q2", juror="b"), B_FILE[2], B_FILE[3]]
    argv, out = _cli_setup(tmp_path, A_FILE, b_rows)
    assert agreement.main(argv) == 3
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["passed"] is False
    assert data["neg_kappa"] == pytest.approx(0.5)


def test_cli_validation_error_exit_1(tmp_path):
    bad = copy.deepcopy(A_FILE)
    bad[0]["labels"][0]["grade"] = 3
    argv, _ = _cli_setup(tmp_path, bad, B_FILE)
    assert agreement.main(argv) == 1


def test_cli_missing_qid_exit_1(tmp_path):
    argv, _ = _cli_setup(tmp_path, A_FILE[:3], B_FILE)
    assert agreement.main(argv) == 1


def test_cli_out_exists_exit_1(tmp_path):
    argv, out = _cli_setup(tmp_path, A_FILE, B_FILE)
    out.write_text("{}", encoding="utf-8")
    assert agreement.main(argv) == 1
    assert out.read_text(encoding="utf-8") == "{}"      # ustune yazilmadi


def test_cli_unknown_argument_exit_2(tmp_path):
    argv, _ = _cli_setup(tmp_path, A_FILE, B_FILE)
    assert agreement.main(argv + ["--bilinmeyen", "x"]) == 2
