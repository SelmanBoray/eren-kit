"""eval/review.py testleri: yalniz sozlesmeden yazildi, yalniz tmp_path."""
import json
import random
import re
from pathlib import Path

import pytest

from eval import review
from eval.agreement import cohen_kappa, weighted_kappa

MARK = "ZZQMARKERZZ"
WHY_MARK = "WHYMARKERQQ"
FAKE_KEY = "sk-" + "A1b2C3d4E5f6G7h8I9j0"
SEED = 20261024


# ------------------------------------------------------------------ yardimcilar
def write_jsonl(path, rows):
    Path(path).write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")


def mk_notes(n=12):
    return [
        {"note_id": f"n{i:02d}", "source": "src", "name": f"not-{i}",
         "description": f"aciklama {i}", "type": "t", "chars": 100 + i}
        for i in range(n)
    ]


def mk_queries(qids, text=None):
    return {q: {"id": q, "text": text or f"{MARK} metin {q}", "project": f"proj-{q}",
                "stratum": "s", "kind": "k"} for q in qids}


def qr(qid, note, grade, why=None):
    return {"qid": qid, "note": note, "grade": grade, "source": "adj",
            "why": why or f"{WHY_MARK}-{qid}-{note}"}


def jur(qid, juror, labels=None, contentless=False):
    return {"qid": qid, "juror": juror, "contentless": contentless,
            "labels": [{"note": n, "grade": g, "why": "w"} for n, g in (labels or {}).items()],
            "read": list((labels or {}).keys())}


def hk(qid, note, final=1):
    return {"qid": qid, "note": note, "grades": [final, final], "final": final, "why": "h"}


def hk_cl(qid):
    return {"qid": qid, "note": None, "contentless": True, "grades": [0, 0], "final": 0, "why": "h"}


def fill(md, mapping):
    """Kor dosyada qid bolumlerinin '- 2:' / '- 1:' satirlarini doldurur.
    mapping: qid -> (two_text, one_text)."""
    parts = re.split(r"(?m)^(?=## )", md)
    out = []
    for part in parts:
        m = re.match(r"## (\S+)", part)
        if m and m.group(1) in mapping:
            two, one = mapping[m.group(1)]
            part = re.sub(r"(?m)^- 2:.*$", lambda _: f"- 2: {two}", part, count=1)
            part = re.sub(r"(?m)^- 1:.*$", lambda _: f"- 1: {one}", part, count=1)
        out.append(part)
    return "".join(out)


# ------------------------------------------------------------------ mask_secrets
def test_mask_constant():
    assert review.MASK == "[GİZLİ DEĞER MASKELENDİ]"


@pytest.mark.parametrize("secret", [
    "sk-" + "a" * 16,
    "sk-ant-api03_" + "Zz9" * 8,
    "AIza" + "B" * 30,
    "ghp_" + "a1" * 15,
    "gho_" + "Q" * 30,
    "ghu_" + "7" * 30,
    "ghs_" + "x" * 30,
    "ghr_" + "y" * 30,
    "xoxb-" + "1234567890",
    "xoxa-" + "abcdefghij",
    "xoxp-" + "a1b2c3d4e5f6",
    "xoxr-" + "1234567890",
    "xoxs-" + "1234567890",
    "abcd1234" * 4,
    "Ab1_-" + "Cd2" * 10,
])
def test_mask_secret_patterns(secret):
    out = review.mask_secrets(f"anahtar su: {secret} bitti")
    assert secret not in out
    assert review.MASK in out
    assert out.startswith("anahtar su: ") and out.endswith(" bitti")


def test_mask_multiple_secrets():
    out = review.mask_secrets(f"{FAKE_KEY} ve {'AIza' + 'k' * 30}")
    assert out == f"{review.MASK} ve {review.MASK}"


@pytest.mark.parametrize("text", [
    "Bugun hava cok guzel, yarin toplanti var.",
    "Şu işi yarın öğleden sonra bitirelim mi?",
    r"D:\calisma\notlar\hafiza",
    "a" * 40,
    "1" * 40,
    "sk-kisa",
    "AIza" + "b" * 10,
    "xoxb-123",
    "",
])
def test_mask_leaves_innocent_text(text):
    assert review.mask_secrets(text) == text


# ------------------------------------------------------------------ select_sample
def sample_world():
    dev = [f"d{i:02d}" for i in range(30)]
    held = [f"h{i:02d}" for i in range(15)]
    allq = dev + held
    # Varsayilan: herkesin iki pozitifi (grade 2) var -> sinif 3'e girmez
    qrels = []
    for q in allq:
        qrels += [qr(q, "n00", 2), qr(q, "n01", 2)]
    return dev, held, allq, qrels


def expected_random(dev, held, n_dev=12, n_held=8, seed=SEED):
    rng = random.Random(f"{seed}-degerlendirici")
    d = rng.sample(sorted(dev), min(n_dev, len(dev)))
    h = rng.sample(sorted(held), min(n_held, len(held)))
    return sorted(d + h)


def gtq(qids):
    return [{"qid": q, "negative": False, "contentless": False, "degerlendirici_checked": False}
            for q in qids]


def test_select_random_matches_rng_and_split():
    dev, held, allq, qrels = sample_world()
    rnd, tgt = review.select_sample(dev, held, qrels, gtq(allq), [], [], [])
    assert rnd == expected_random(dev, held)
    assert rnd == sorted(rnd)
    assert len([q for q in rnd if q in set(dev)]) == 12
    assert len([q for q in rnd if q in set(held)]) == 8
    assert tgt == []


def test_select_random_deterministic_and_input_order_independent():
    dev, held, allq, qrels = sample_world()
    r1, _ = review.select_sample(dev, held, qrels, gtq(allq), [], [], [])
    r2, _ = review.select_sample(list(reversed(dev)), list(reversed(held)), qrels,
                                 gtq(allq), [], [], [])
    assert r1 == r2


def test_select_seed_changes_sample():
    dev, held, allq, qrels = sample_world()
    r1, _ = review.select_sample(dev, held, qrels, gtq(allq), [], [], [], seed=1)
    assert r1 == expected_random(dev, held, seed=1)
    assert r1 != expected_random(dev, held, seed=SEED)


def test_select_custom_counts():
    dev, held, allq, qrels = sample_world()
    rnd, _ = review.select_sample(dev, held, qrels, gtq(allq), [], [], [], n_dev=3, n_heldout=2)
    assert rnd == expected_random(dev, held, 3, 2)
    assert len(rnd) == 5


def test_select_small_pools_take_all():
    dev = [f"d{i}" for i in range(5)]
    held = [f"h{i}" for i in range(3)]
    qrels = [qr(q, "n00", 2) for q in dev + held] + [qr(q, "n01", 2) for q in dev + held]
    rnd, tgt = review.select_sample(dev, held, qrels, gtq(dev + held), [], [], [])
    assert rnd == sorted(dev + held)
    assert tgt == []


def test_select_targeted_priority_order_and_limit():
    dev, held, allq, qrels = sample_world()
    rnd = set(expected_random(dev, held))
    rest = [q for q in allq if q not in rnd]
    assert len(rest) >= 24
    adj_q = rest[0:6]
    div_q = rest[6:12]
    single_q = rest[12:18]
    # sinif 1: hakem satiri (biri contentless)
    adjudication = [hk(q, "n00") for q in adj_q[:-1]] + [hk_cl(adj_q[-1])]
    # sinif 2: A'da etiket var, B'de yok (ve tersi)
    a_rows, b_rows = [], []
    for i, q in enumerate(div_q):
        if i % 2 == 0:
            a_rows.append(jur(q, "a", {"n00": 2}))
            b_rows.append(jur(q, "b", {}))
        else:
            a_rows.append(jur(q, "a", {}))
            b_rows.append(jur(q, "b", {"n01": 1}))
    # uyumlu satirlar ayrisma sayilmamali
    agree_q = rest[18]
    a_rows.append(jur(agree_q, "a", {"n00": 2}))
    b_rows.append(jur(agree_q, "b", {"n00": 1}))
    both_empty = rest[19]
    a_rows.append(jur(both_empty, "a", {}))
    b_rows.append(jur(both_empty, "b", {}))
    # sinif 3: tek pozitif ve grade 1
    qrels = [r for r in qrels if r["qid"] not in single_q]
    qrels += [qr(q, "n02", 1) for q in single_q]
    # tek pozitif ama grade 2 -> aday degil
    solo2 = rest[20]
    qrels = [r for r in qrels if r["qid"] != solo2] + [qr(solo2, "n02", 2)]

    n = 10
    r, t = review.select_sample(dev, held, qrels, gtq(allq), adjudication, a_rows, b_rows,
                                n_targeted=n)
    assert r == sorted(rnd)
    expected_order = sorted(adj_q) + sorted(div_q) + sorted(single_q)
    assert t == sorted(expected_order[:n])
    assert t == sorted(t)
    assert not set(t) & set(r)
    for bad in (agree_q, both_empty, solo2):
        assert bad not in t


def test_select_targeted_fewer_candidates_and_all_classes():
    dev, held, allq, qrels = sample_world()
    rnd = set(expected_random(dev, held))
    rest = [q for q in allq if q not in rnd]
    adj_q, div_q, single_q = rest[0], rest[1], rest[2]
    qrels = [r for r in qrels if r["qid"] != single_q] + [qr(single_q, "n02", 1)]
    a_rows = [jur(div_q, "a", {"n00": 2})]
    b_rows = [jur(div_q, "b", {})]
    _, t = review.select_sample(dev, held, qrels, gtq(allq), [hk(adj_q, "n01")], a_rows, b_rows)
    assert t == sorted([adj_q, div_q, single_q])


def test_select_targeted_deduplicated_and_random_excluded():
    dev, held, allq, qrels = sample_world()
    rnd = expected_random(dev, held)
    rest = [q for q in allq if q not in set(rnd)]
    q = rest[0]
    qrels = [r for r in qrels if r["qid"] != q] + [qr(q, "n02", 1)]
    a_rows = [jur(q, "a", {"n00": 1}), jur(rnd[0], "a", {"n00": 1})]
    b_rows = [jur(q, "b", {}), jur(rnd[0], "b", {})]
    adjudication = [hk(q, "n00"), hk(q, "n01"), hk(rnd[0], "n00")]
    _, t = review.select_sample(dev, held, qrels, gtq(allq), adjudication, a_rows, b_rows)
    assert t == [q]


def test_select_targeted_is_disjoint_from_random_always():
    dev, held, allq, qrels = sample_world()
    adjudication = [hk(q, "n00") for q in allq]
    r, t = review.select_sample(dev, held, qrels, gtq(allq), adjudication, [], [])
    assert not set(r) & set(t)
    assert len(t) == 10
    assert t == sorted(t)
    # sinif 1 icinde qid sirasi: ilk 10 rastgele olmayan qid
    rest = sorted(q for q in allq if q not in set(r))
    assert t == rest[:10]


# ------------------------------------------------------------------ render_blind
def test_render_blind_structure():
    notes = mk_notes(5)
    qids = ["q01", "q02", "q03"]
    queries = mk_queries(qids)
    md = review.render_blind(qids, queries, notes)
    assert "1. tur (kör)" in md
    for q in qids:
        assert f"## {q}" in md
    assert md.count("- cwd:") == 3
    assert md.count("- prompt:") == 3
    assert len(re.findall(r"(?m)^- 2:\s*$", md)) == 3
    assert len(re.findall(r"(?m)^- 1:\s*$", md)) == 3
    assert len(re.findall(r"(?m)^- not:\s*$", md)) == 3
    assert MARK in md
    for n in notes:
        assert md.count(n["note_id"]) == 1


def test_render_blind_masks_prompt_and_hides_gt():
    notes = mk_notes(3)
    queries = mk_queries(["q01"], text=f"deploy icin {FAKE_KEY} kullan {MARK}")
    md = review.render_blind(["q01"], queries, notes)
    assert FAKE_KEY not in md
    assert review.MASK in md
    assert WHY_MARK not in md


def test_render_blind_only_requested_qids():
    queries = mk_queries(["q01", "q02", "q03"])
    md = review.render_blind(["q02"], queries, mk_notes(2))
    assert "## q02" in md
    assert "## q01" not in md and "## q03" not in md


# ------------------------------------------------------------------ render_open
def test_render_open_content():
    notes = mk_notes(6)
    queries = mk_queries(["q01", "q02", "q03"], text=f"anahtar {FAKE_KEY} {MARK}")
    qrels = [qr("q01", "n00", 2), qr("q01", "n03", 1), qr("q02", "n05", 2)]
    gt = [
        {"qid": "q01", "negative": False, "contentless": False, "degerlendirici_checked": False},
        {"qid": "q02", "negative": False, "contentless": False, "degerlendirici_checked": False},
        {"qid": "q03", "negative": True, "contentless": False, "degerlendirici_checked": False},
    ]
    md = review.render_open(["q01", "q03"], ["q02"], queries, qrels, gt, notes)
    assert "2. tur (açık)" in md
    for q in ("q01", "q02", "q03"):
        assert f"## {q}" in md
    assert md.count("- Karar:") == 3
    for r in qrels:
        assert r["note"] in md
        assert r["why"] in md
    assert FAKE_KEY not in md
    assert review.MASK in md


def test_render_open_per_qid_qrels_in_own_section():
    queries = mk_queries(["q01", "q02"])
    qrels = [qr("q01", "n00", 2, why="ILKGEREKCEZZ"), qr("q02", "n01", 1, why="IKINCIGEREKCEZZ")]
    gt = [{"qid": q, "negative": False, "contentless": False, "degerlendirici_checked": False}
          for q in ("q01", "q02")]
    md = review.render_open(["q01", "q02"], [], queries, qrels, gt, mk_notes(3))
    s1 = md.split("## q01")[1].split("## q02")[0]
    s2 = md.split("## q02")[1]
    assert "ILKGEREKCEZZ" in s1 and "IKINCIGEREKCEZZ" not in s1
    assert "IKINCIGEREKCEZZ" in s2 and "ILKGEREKCEZZ" not in s2


# ------------------------------------------------------------------ parse_blind
NOTE_IDS = [f"n{i:02d}" for i in range(8)]


def blind_md(mapping, qids=None):
    qids = qids or list(mapping)
    md = review.render_blind(qids, mk_queries(qids), mk_notes(8))
    return fill(md, mapping)


def test_parse_blind_separators():
    md = blind_md({"q1": ("n00,n01", "n02 n03"), "q2": ("n04, n05", "n06,n07 n00")})
    labels, errors = review.parse_blind(md, NOTE_IDS)
    assert errors == []
    assert labels["q1"] == {"n00": 2, "n01": 2, "n02": 1, "n03": 1}
    assert labels["q2"] == {"n04": 2, "n05": 2, "n06": 1, "n07": 1, "n00": 1}


def test_parse_blind_none_markers_count_as_filled():
    md = blind_md({"q1": ("yok", "-"), "q2": ("n00", "yok"), "q3": ("-", "n01")})
    labels, errors = review.parse_blind(md, NOTE_IDS)
    assert errors == []
    assert labels.get("q1", {}) == {}
    assert labels["q2"] == {"n00": 2}
    assert labels["q3"] == {"n01": 1}


def test_parse_blind_unfilled_section_is_error():
    md = blind_md({"q1": ("n00", "yok"), "q2": ("", "")})
    labels, errors = review.parse_blind(md, NOTE_IDS)
    assert errors
    assert any("q2" in e and "oldurulmam" in e for e in errors)
    assert not any("q1" in e for e in errors)


def test_parse_blind_one_line_filled_other_blank_is_ok():
    md = blind_md({"q1": ("n00", ""), "q2": ("", "n01")})
    labels, errors = review.parse_blind(md, NOTE_IDS)
    assert errors == []
    assert labels["q1"] == {"n00": 2}
    assert labels["q2"] == {"n01": 1}


def test_parse_blind_unknown_note_is_error():
    md = blind_md({"q1": ("n00 n99", "yok")})
    labels, errors = review.parse_blind(md, NOTE_IDS)
    assert any("n99" in e for e in errors)


def test_parse_blind_note_in_both_lines_is_error():
    md = blind_md({"q1": ("n00 n01", "n01")})
    labels, errors = review.parse_blind(md, NOTE_IDS)
    assert any("n01" in e for e in errors)


def test_parse_blind_note_table_is_not_label():
    qids = ["q1"]
    md = review.render_blind(qids, mk_queries(qids), mk_notes(8))
    md = fill(md, {"q1": ("n00", "yok")})
    # tablo ekinde tum note_id'ler var; etiket sayilmamali
    assert all(n in md for n in NOTE_IDS)
    labels, errors = review.parse_blind(md, NOTE_IDS)
    assert errors == []
    assert labels["q1"] == {"n00": 2}
    assert set(labels) == {"q1"}


def test_parse_blind_roundtrip_many_queries():
    qids = [f"q{i}" for i in range(6)]
    mapping = {q: (f"n0{i}", f"n0{(i + 1) % 8}") for i, q in enumerate(qids)}
    labels, errors = review.parse_blind(blind_md(mapping), NOTE_IDS)
    assert errors == []
    for i, q in enumerate(qids):
        assert labels[q] == {f"n0{i}": 2, f"n0{(i + 1) % 8}": 1}


# ------------------------------------------------------------------ score
SC_NOTES = [f"n{i:02d}" for i in range(10)]
SC_QIDS = [f"q{i:02d}" for i in range(20)]


def sc_world():
    """14 pozitif sorgu (karisik grade), 6 negatif."""
    qrels, gt = [], []
    for i, q in enumerate(SC_QIDS):
        if i < 14:
            qrels.append(qr(q, SC_NOTES[i % 10], 2))
            if i % 3 == 0:
                qrels.append(qr(q, SC_NOTES[(i + 3) % 10], 1))
        gt.append({"qid": q, "negative": i >= 14, "contentless": False,
                   "degerlendirici_checked": False})
    return qrels, gt


def labels_from(qrels, qids):
    out = {q: {} for q in qids}
    for r in qrels:
        if r["qid"] in out:
            out[r["qid"]][r["note"]] = r["grade"]
    return out


def grade_map(qrels):
    return {(r["qid"], r["note"]): r["grade"] for r in qrels}


def test_score_perfect_agreement():
    qrels, gt = sc_world()
    res = review.score(labels_from(qrels, SC_QIDS), qrels, gt, SC_NOTES)
    assert res["n_queries"] == 20
    assert res["psa"] == pytest.approx(1.0)
    assert res["kappa_w"] == pytest.approx(1.0)
    assert res["neg_raw"] == pytest.approx(1.0)
    assert res["neg_kappa"] == pytest.approx(1.0)
    assert res["threshold_psa"] == 0.70
    assert res["accepted"] is True
    for k in ("n_queries", "kappa_w", "psa", "neg_raw", "neg_kappa", "threshold_psa", "accepted"):
        assert k in res


def test_score_opposite_is_rejected():
    qrels, gt = sc_world()
    sel = {}
    gm = grade_map(qrels)
    for q in SC_QIDS:
        # GT'de pozitif olan notlari yok say, GT'de 0 olanlara 2 ver
        sel[q] = {n: 2 for n in SC_NOTES if gm.get((q, n), 0) == 0 and n in ("n08", "n09")}
    res = review.score(sel, qrels, gt, SC_NOTES)
    assert res["accepted"] is False
    assert res["psa"] < 0.70
    pairs = [(sel[q].get(n, 0), gm.get((q, n), 0)) for q in SC_QIDS for n in SC_NOTES]
    assert res["kappa_w"] == pytest.approx(weighted_kappa(pairs))
    assert res["kappa_w"] < 0.60


def test_score_kappa_matches_independent_computation_partial():
    qrels, gt = sc_world()
    sel = labels_from(qrels, SC_QIDS)
    # birkac farkli etiket
    sel["q00"] = {"n00": 1}
    sel["q01"] = {}
    sel["q16"] = {"n05": 1}
    gm = grade_map(qrels)
    pairs = [(sel[q].get(n, 0), gm.get((q, n), 0)) for q in SC_QIDS for n in SC_NOTES]
    res = review.score(sel, qrels, gt, SC_NOTES)
    assert res["kappa_w"] == pytest.approx(weighted_kappa(pairs))
    assert 0.0 < res["psa"] < 1.0
    sel_neg = [not any(v >= 1 for v in sel[q].values()) for q in SC_QIDS]
    gt_neg = [g["negative"] for g in gt]
    assert res["neg_kappa"] == pytest.approx(cohen_kappa(list(zip(sel_neg, gt_neg))))
    agree = sum(a == b for a, b in zip(sel_neg, gt_neg)) / len(SC_QIDS)
    assert res["neg_raw"] == pytest.approx(agree)


def test_score_only_queries_in_degerlendirici_count():
    qrels, gt = sc_world()
    subset = SC_QIDS[:8] + SC_QIDS[15:18]
    sel = labels_from(qrels, subset)
    res = review.score(sel, qrels, gt, SC_NOTES)
    assert res["n_queries"] == len(subset)
    assert res["psa"] == pytest.approx(1.0)
    assert res["accepted"] is True
    # bir etiket bozulursa yalniz alt kumedeki sorgulara bakilir
    sel2 = dict(sel)
    sel2["q00"] = {}
    gm = grade_map(qrels)
    pairs = [(sel2[q].get(n, 0), gm.get((q, n), 0)) for q in subset for n in SC_NOTES]
    res2 = review.score(sel2, qrels, gt, SC_NOTES)
    assert res2["kappa_w"] == pytest.approx(weighted_kappa(pairs))


# ------------------------------------------------------------------ CLI
def cli_world(tmp_path, with_adjudication=False, with_qrels=True):
    g = tmp_path / "gt"
    g.mkdir()
    # qid bicimi q<rakam> (uretim bolum ayristiricisi bunu bekler)
    dev = [f"q{i:03d}" for i in range(20)]
    held = [f"q{i:03d}" for i in range(20, 30)]
    allq = dev + held
    notes = mk_notes(12)
    qrels, gt = [], []
    for i, q in enumerate(allq):
        neg = i % 5 == 4
        if not neg:
            qrels.append(qr(q, f"n{i % 12:02d}", 2))
            if i % 2 == 0:
                qrels.append(qr(q, f"n{(i + 5) % 12:02d}", 1))
        gt.append({"qid": q, "negative": neg, "contentless": False, "degerlendirici_checked": False})
    if with_qrels:
        write_jsonl(g / "qrels.jsonl", qrels)
    write_jsonl(g / "gt-queries.jsonl", gt)
    # Varsayim: CLI juri dosyalarini gt-dir icinde juror-a/b.jsonl adiyla bekler.
    write_jsonl(g / "juror-a.jsonl", [jur(q, "a", {f"n{i % 12:02d}": 2} if i % 7 else {})
                                      for i, q in enumerate(allq)])
    write_jsonl(g / "juror-b.jsonl", [jur(q, "b", {f"n{i % 12:02d}": 2}) for i, q in enumerate(allq)])
    if with_adjudication:
        write_jsonl(g / "adjudication.jsonl", [hk(allq[0], "n00"), hk_cl(allq[1])])
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"split": {"dev_ids": dev, "heldout_ids": held}}),
                        encoding="utf-8")
    queries = tmp_path / "queries.jsonl"
    write_jsonl(queries, list(mk_queries(allq).values()))
    notes_p = tmp_path / "notes.jsonl"
    write_jsonl(notes_p, notes)
    return {"g": g, "m": manifest, "q": queries, "n": notes_p, "qrels": qrels,
            "gt": gt, "all": allq, "dev": dev, "held": held}


def make_argv(w):
    return ["make", "--gt-dir", str(w["g"]), "--manifest", str(w["m"]),
            "--queries", str(w["q"]), "--notes", str(w["n"])]


def score_argv(w):
    return ["score", "--gt-dir", str(w["g"]), "--notes", str(w["n"])]


def test_cli_make_creates_files(tmp_path, capsys):
    w = cli_world(tmp_path)
    assert review.main(make_argv(w)) == 0
    g = w["g"]
    blind = g / "degerlendirici-kontrol-1-kor.md"
    opn = g / "degerlendirici-kontrol-2-acik.md"
    samp = g / "degerlendirici-sample.json"
    assert blind.exists() and opn.exists() and samp.exists()
    s = json.loads(samp.read_text(encoding="utf-8"))
    assert s["seed"] == SEED
    assert s["random"] == expected_random(w["dev"], w["held"])
    assert not set(s["random"]) & set(s["targeted"])
    assert s["targeted"] == sorted(s["targeted"])
    md = blind.read_text(encoding="utf-8")
    for q in s["random"]:
        assert f"## {q}" in md
    assert WHY_MARK not in md
    od = opn.read_text(encoding="utf-8")
    assert WHY_MARK in od
    out = capsys.readouterr()
    assert MARK not in out.out and MARK not in out.err


def test_cli_make_with_adjudication_targets_it(tmp_path):
    w = cli_world(tmp_path, with_adjudication=True)
    assert review.main(make_argv(w)) == 0
    s = json.loads((w["g"] / "degerlendirici-sample.json").read_text(encoding="utf-8"))
    for q in (w["all"][0], w["all"][1]):
        assert q in s["random"] or q in s["targeted"]
    assert len(s["targeted"]) <= 10


def test_cli_make_twice_fails_and_keeps_files(tmp_path):
    w = cli_world(tmp_path)
    assert review.main(make_argv(w)) == 0
    names = ("degerlendirici-kontrol-1-kor.md", "degerlendirici-kontrol-2-acik.md", "degerlendirici-sample.json")
    before = {n: (w["g"] / n).read_bytes() for n in names}
    assert review.main(make_argv(w)) == 1
    assert before == {n: (w["g"] / n).read_bytes() for n in names}


def test_cli_make_missing_required_input_fails(tmp_path):
    w = cli_world(tmp_path, with_qrels=False)
    assert review.main(make_argv(w)) == 1


def test_cli_unknown_subcommand_returns_2():
    assert review.main(["bilinmeyen"]) == 2


def fill_from_gt(w, reverse=False):
    s = json.loads((w["g"] / "degerlendirici-sample.json").read_text(encoding="utf-8"))
    by_q = {}
    for r in w["qrels"]:
        by_q.setdefault(r["qid"], {})[r["note"]] = r["grade"]
    mapping = {}
    for q in s["random"]:
        gm = by_q.get(q, {})
        if not reverse:
            two = " ".join(n for n, g in gm.items() if g == 2) or "yok"
            one = " ".join(n for n, g in gm.items() if g == 1) or "yok"
        elif gm:
            two, one = "yok", "yok"
        else:
            two, one = "n11", "yok"
        mapping[q] = (two, one)
    blind = w["g"] / "degerlendirici-kontrol-1-kor.md"
    blind.write_text(fill(blind.read_text(encoding="utf-8"), mapping), encoding="utf-8")


def test_cli_score_unfilled_returns_1(tmp_path):
    w = cli_world(tmp_path)
    assert review.main(make_argv(w)) == 0
    assert review.main(score_argv(w)) == 1
    assert not (w["g"] / "degerlendirici-agreement.json").exists()


def test_cli_score_matching_returns_0(tmp_path, capsys):
    w = cli_world(tmp_path)
    assert review.main(make_argv(w)) == 0
    fill_from_gt(w)
    capsys.readouterr()
    assert review.main(score_argv(w)) == 0
    out = capsys.readouterr()
    assert MARK not in out.out and MARK not in out.err
    res = json.loads((w["g"] / "degerlendirici-agreement.json").read_text(encoding="utf-8"))
    assert res["accepted"] is True
    assert res["psa"] == pytest.approx(1.0)
    assert res["n_queries"] == 20


def test_cli_score_opposite_returns_3(tmp_path):
    w = cli_world(tmp_path)
    assert review.main(make_argv(w)) == 0
    fill_from_gt(w, reverse=True)
    assert review.main(score_argv(w)) == 3
    res = json.loads((w["g"] / "degerlendirici-agreement.json").read_text(encoding="utf-8"))
    assert res["accepted"] is False


def test_cli_score_bad_note_id_returns_1(tmp_path):
    w = cli_world(tmp_path)
    assert review.main(make_argv(w)) == 0
    fill_from_gt(w)
    blind = w["g"] / "degerlendirici-kontrol-1-kor.md"
    s = json.loads((w["g"] / "degerlendirici-sample.json").read_text(encoding="utf-8"))
    q = s["random"][0]
    blind.write_text(fill(blind.read_text(encoding="utf-8"), {q: ("n99", "yok")}),
                     encoding="utf-8")
    assert review.main(score_argv(w)) == 1


# ------------------------------------------------------------------ regresyon: note_id maskelenmez
LONG_ID = "claude-memory/project_disk_temizligi_2026_10_18.md"


def long_notes():
    notes = mk_notes(3)
    notes.append({"note_id": LONG_ID, "source": "src", "name": "disk temizligi",
                  "description": "aciklama", "type": "project", "chars": 500})
    return notes


def test_mask_still_masks_long_dated_snake_case_directly():
    # mask_secrets degismez: ayni dizi dogrudan verilince maskelenir
    run = "project_disk_temizligi_2026_10_18"
    assert review.MASK in review.mask_secrets(run)


def test_render_blind_keeps_long_note_id_verbatim():
    md = review.render_blind(["q01"], mk_queries(["q01"]), long_notes())
    assert LONG_ID in md
    lines = [ln for ln in md.splitlines() if LONG_ID in ln]
    assert len(lines) == 1
    assert review.MASK not in lines[0]


def test_render_open_keeps_long_note_id_in_qrels_line():
    qrels = [qr("q01", LONG_ID, 2, why="gerekce-ZZ")]
    gt = [{"qid": "q01", "negative": False, "contentless": False, "degerlendirici_checked": False}]
    md = review.render_open(["q01"], [], mk_queries(["q01"]), qrels, gt, long_notes())
    lines = [ln for ln in md.splitlines() if LONG_ID in ln]
    assert lines
    assert any("gerekce-ZZ" in ln for ln in lines) or LONG_ID in md
    assert all(review.MASK not in ln for ln in lines)


def test_description_masked_but_note_id_not():
    notes = long_notes()
    notes[-1]["description"] = f"gizli anahtar {FAKE_KEY} burada"
    md = review.render_blind(["q01"], mk_queries(["q01"]), notes)
    assert FAKE_KEY not in md
    assert review.MASK in md
    assert LONG_ID in md
    row = [ln for ln in md.splitlines() if LONG_ID in ln][0]
    assert review.MASK in row  # aciklama maskelendi
    assert row.count(LONG_ID) == 1


def test_render_open_description_masked_note_id_kept():
    notes = long_notes()
    notes[-1]["description"] = f"anahtar {FAKE_KEY}"
    qrels = [qr("q01", LONG_ID, 1)]
    gt = [{"qid": "q01", "negative": False, "contentless": False, "degerlendirici_checked": False}]
    md = review.render_open(["q01"], [], mk_queries(["q01"]), qrels, gt, notes)
    assert FAKE_KEY not in md
    assert LONG_ID in md


def test_parse_blind_accepts_long_note_id():
    md = review.render_blind(["q1"], mk_queries(["q1"]), long_notes())
    md = fill(md, {"q1": (LONG_ID, "yok")})
    ids = [n["note_id"] for n in long_notes()]
    labels, errors = review.parse_blind(md, ids)
    assert errors == []
    assert labels["q1"] == {LONG_ID: 2}


def test_cli_make_score_roundtrip_with_long_note_id(tmp_path, capsys):
    w = cli_world(tmp_path)
    write_jsonl(w["n"], mk_notes(12) + [long_notes()[-1]])
    assert review.main(make_argv(w)) == 0
    blind = w["g"] / "degerlendirici-kontrol-1-kor.md"
    assert LONG_ID in blind.read_text(encoding="utf-8")
    fill_from_gt(w)
    s = json.loads((w["g"] / "degerlendirici-sample.json").read_text(encoding="utf-8"))
    q = s["random"][0]
    blind.write_text(fill(blind.read_text(encoding="utf-8"), {q: (LONG_ID, "yok")}),
                     encoding="utf-8")
    capsys.readouterr()
    code = review.main(score_argv(w))
    out = capsys.readouterr()
    assert code in (0, 3)  # ayristirma hatasi (1) olmamali
    assert "bilinmeyen" not in out.out
    assert (w["g"] / "degerlendirici-agreement.json").exists()
