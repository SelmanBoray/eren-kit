"""Hakemlik hazırlama ve final GT birleştirme aracı.

İki jürinin (A, B) ayrıştığı (sorgu, not) çiftlerini jüri kimliği gizli,
sırası rastgele batch dosyalarına dökmek (`prepare`) ve uyuşan çiftler +
hakem kararları (+ Değerlendirici düzeltmeleri) ile final `qrels.jsonl` ve
`gt-queries.jsonl` üretmek (`merge`). Sorgu metinleri yalnız çıktı
dosyalarına yazılır; ekrana yalnız sayılar basılır.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path
from typing import Any

DEFAULT_SEED = 20261024
DEFAULT_BATCH_SIZE = 40


def load_jsonl(path: Path) -> list[dict]:
    """JSONL dosyasını okur; boş satırlar atlanır, bozuk satır ValueError."""
    rows: list[dict] = []
    with Path(path).open(encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}: satır {line_no}: bozuk JSON ({exc.msg})") from exc
            if not isinstance(value, dict):
                raise ValueError(f"{path}: satır {line_no}: nesne bekleniyordu")
            rows.append(value)
    return rows


def juror_grades(rows: list[dict]) -> dict[str, dict]:
    """qid -> {"contentless", "grades": {note: grade}, "whys": {note: why}}."""
    result: dict[str, dict] = {}
    for row in rows:
        grades: dict[str, int] = {}
        whys: dict[str, str] = {}
        for label in row.get("labels") or []:
            note = label["note"]
            grades[note] = int(label["grade"])
            whys[note] = str(label.get("why", ""))
        result[row["qid"]] = {
            "contentless": bool(row.get("contentless", False)),
            "grades": grades,
            "whys": whys,
        }
    return result


def _sort_key(item: tuple[str, str | None]) -> tuple[str, bool, str]:
    return (item[0], item[1] is None, item[1] or "")


def prepare(
    a_rows: list[dict],
    b_rows: list[dict],
    queries: dict[str, dict],
    seed: int = DEFAULT_SEED,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> list[list[dict]]:
    """Ayrışan çiftlerden hakem batch'leri üretir (jüri kimliği öğede yok)."""
    if batch_size < 1:
        raise ValueError("batch_size en az 1 olmalı")
    a = juror_grades(a_rows)
    b = juror_grades(b_rows)
    pending: list[tuple[tuple[str, str | None], dict]] = []
    for qid in sorted(set(a) & set(b)):
        if qid not in queries:
            raise ValueError(f"sorgu dosyasında yok: {qid}")
        query = queries[qid]
        text = query.get("text", "")
        project = query.get("project")
        ja, jb = a[qid], b[qid]
        if ja["contentless"] != jb["contentless"]:
            pending.append(((qid, None), {
                "item": f"{qid}|contentless", "qid": qid, "text": text,
                "project": project, "note": None,
                "contentless": [ja["contentless"], jb["contentless"]],
            }))
        for note in sorted(set(ja["grades"]) | set(jb["grades"])):
            ga, gb = ja["grades"].get(note, 0), jb["grades"].get(note, 0)
            if ga == gb:
                continue
            pending.append(((qid, note), {
                "item": f"{qid}|{note}", "qid": qid, "text": text,
                "project": project, "note": note,
                "grades": [ga, gb],
                "whys": [ja["whys"].get(note, ""), jb["whys"].get(note, "")],
            }))
    pending.sort(key=lambda entry: _sort_key(entry[0]))
    rng = random.Random(f"{seed}-adjudicate")
    items: list[dict] = []
    for _, item in pending:
        if rng.random() < 0.5:
            for field in ("grades", "whys", "contentless"):
                if field in item:
                    item[field] = [item[field][1], item[field][0]]
        items.append(item)
    return [items[i:i + batch_size] for i in range(0, len(items), batch_size)]


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_prepare(batches: list[list[dict]], out_dir: Path) -> list[Path]:
    """adj-01.jsonl, adj-02.jsonl... yazar; dolu klasörü ezmez."""
    out_dir = Path(out_dir)
    if out_dir.exists() and any(out_dir.iterdir()):
        raise FileExistsError(str(out_dir))
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for index, batch in enumerate(batches, start=1):
        path = out_dir / f"adj-{index:02d}.jsonl"
        _write_jsonl(path, batch)
        paths.append(path)
    return paths


def merge(
    a_rows: list[dict],
    b_rows: list[dict],
    adjudication: list[dict],
    degerlendirici: list[dict] | None = None,
) -> tuple[list[dict], list[dict], list[str]]:
    """(qrels, gt_queries, problems) üretir."""
    a = juror_grades(a_rows)
    b = juror_grades(b_rows)
    problems: list[str] = []
    for qid in sorted(set(a) ^ set(b)):
        problems.append(f"sorgu yalnız bir jüride var: {qid}")
    both = sorted(set(a) & set(b))

    hakem_notes: dict[tuple[str, str], dict] = {}
    hakem_contentless: dict[str, dict] = {}
    for row in adjudication:
        if row.get("note") is None:
            hakem_contentless[row["qid"]] = row
        else:
            hakem_notes[(row["qid"], row["note"])] = row

    degerlendirici_rows: dict[tuple[str, str], dict] = {}
    degerlendirici_qids: set[str] = set()
    for row in degerlendirici or []:
        degerlendirici_rows[(row["qid"], row["note"])] = row
        degerlendirici_qids.add(row["qid"])
    for qid in sorted(degerlendirici_qids - set(both)):
        problems.append(f"Değerlendirici satırı iki jüride olmayan sorguya ait: {qid}")

    finals: dict[tuple[str, str], dict] = {}
    contentless: dict[str, bool] = {}
    for qid in both:
        ja, jb = a[qid], b[qid]
        if ja["contentless"] == jb["contentless"]:
            contentless[qid] = ja["contentless"]
        elif qid in hakem_contentless and "contentless" in hakem_contentless[qid]:
            contentless[qid] = bool(hakem_contentless[qid]["contentless"])
        else:
            contentless[qid] = False
            problems.append(f"hakem kararı eksik: {qid} contentless")
        for note in sorted(set(ja["grades"]) | set(jb["grades"])):
            ga, gb = ja["grades"].get(note, 0), jb["grades"].get(note, 0)
            if ga == gb:
                why = ja["whys"].get(note) or jb["whys"].get(note) or ""
                finals[(qid, note)] = {"grade": ga, "source": "agree", "why": why}
                continue
            row = hakem_notes.get((qid, note))
            if row is None or row.get("final") not in (0, 1, 2):
                problems.append(f"hakem kararı eksik: {qid} {note}")
                continue
            finals[(qid, note)] = {
                "grade": int(row["final"]), "source": "hakem", "why": str(row.get("why", "")),
            }
    for (qid, note), row in degerlendirici_rows.items():
        if qid in both:
            finals[(qid, note)] = {
                "grade": int(row["new"]), "source": "degerlendirici", "why": str(row.get("why", "")),
            }

    qrels = [
        {"qid": qid, "note": note, "grade": info["grade"],
         "source": info["source"], "why": info["why"]}
        for (qid, note), info in sorted(finals.items())
        if info["grade"] >= 1
    ]
    positive = {row["qid"] for row in qrels}
    gt_queries = [
        {"qid": qid, "negative": qid not in positive,
         "contentless": contentless[qid], "degerlendirici_checked": qid in degerlendirici_qids}
        for qid in both
    ]
    return qrels, gt_queries, problems


def write_merge(qrels: list[dict], gt_queries: list[dict], out_dir: Path) -> None:
    """qrels.jsonl + gt-queries.jsonl yazar; biri varsa hiçbirini yazmaz."""
    out_dir = Path(out_dir)
    targets = (out_dir / "qrels.jsonl", out_dir / "gt-queries.jsonl")
    for target in targets:
        if target.exists():
            raise FileExistsError(str(target))
    out_dir.mkdir(parents=True, exist_ok=True)
    _write_jsonl(targets[0], qrels)
    _write_jsonl(targets[1], gt_queries)


class _ArgumentError(Exception):
    def __init__(self, message: str, usage: str) -> None:
        super().__init__(message)
        self.message = message
        self.usage = usage


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> Any:  # type: ignore[override]
        raise _ArgumentError(message, self.format_usage())


def _build_parser() -> _Parser:
    parser = _Parser(
        prog="python -m eval.adjudicate",
        description="Hakemlik batch'lerini hazırlar ve final GT'yi birleştirir.",
        add_help=False,
    )
    parser.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    sub = parser.add_subparsers(dest="command", metavar="KOMUT", parser_class=_Parser)
    prep = sub.add_parser("prepare", help="hakem batch'lerini hazırla", add_help=False)
    prep.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    prep.add_argument("--a", type=Path, required=True, help="A jüri dosyası")
    prep.add_argument("--b", type=Path, required=True, help="B jüri dosyası")
    prep.add_argument("--queries", type=Path, required=True, help="sorgular JSONL")
    prep.add_argument("--out", type=Path, required=True, help="çıktı klasörü (boş olmalı)")
    prep.add_argument("--seed", type=int, default=DEFAULT_SEED, help="sıra tohumu")
    prep.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="batch boyutu")
    mrg = sub.add_parser("merge", help="final GT'yi birleştir", add_help=False)
    mrg.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    mrg.add_argument("--a", type=Path, required=True, help="A jüri dosyası")
    mrg.add_argument("--b", type=Path, required=True, help="B jüri dosyası")
    mrg.add_argument("--adjudication", type=Path, required=True, help="adjudication.jsonl")
    mrg.add_argument("--degerlendirici", type=Path, default=None, help="degerlendirici.jsonl (opsiyonel)")
    mrg.add_argument("--out", type=Path, required=True, help="çıktı klasörü")
    return parser


def _run_prepare(args: argparse.Namespace) -> int:
    queries = {row["id"]: row for row in load_jsonl(args.queries)}
    batches = prepare(load_jsonl(args.a), load_jsonl(args.b), queries,
                      seed=args.seed, batch_size=args.batch_size)
    try:
        paths = write_prepare(batches, args.out)
    except FileExistsError:
        print(f"hata: çıktı klasörü dolu, ezilmez: {args.out}", file=sys.stderr)
        return 1
    total = sum(len(batch) for batch in batches)
    print(f"Hakem öğesi: {total}")
    print(f"Batch dosyası: {len(paths)}")
    print(f"Yazıldı: {args.out}")
    return 0


def _run_merge(args: argparse.Namespace) -> int:
    degerlendirici = load_jsonl(args.degerlendirici) if args.degerlendirici else None
    qrels, gt_queries, problems = merge(
        load_jsonl(args.a), load_jsonl(args.b), load_jsonl(args.adjudication), degerlendirici)
    if problems:
        print(f"hata: {len(problems)} sorun var, hiçbir şey yazılmadı:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    try:
        write_merge(qrels, gt_queries, args.out)
    except FileExistsError as exc:
        print(f"hata: çıktı dosyası zaten var, ezilmez: {exc}", file=sys.stderr)
        return 1
    sources: dict[str, int] = {}
    for row in qrels:
        sources[row["source"]] = sources.get(row["source"], 0) + 1
    print(f"qrels satırı: {len(qrels)}")
    for name in sorted(sources):
        print(f"  {name}: {sources[name]}")
    negatives = sum(1 for row in gt_queries if row["negative"])
    print(f"Sorgu: {len(gt_queries)} (negatif: {negatives})")
    print(f"Yazıldı: {args.out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8")
            except (OSError, ValueError):
                pass
    parser = _build_parser()
    try:
        args = parser.parse_args(argv)
    except _ArgumentError as exc:
        print(exc.usage, end="", file=sys.stderr)
        print(f"hata: {exc.message}", file=sys.stderr)
        return 2
    if args.command not in ("prepare", "merge"):
        parser.print_help()
        return 2
    try:
        return _run_prepare(args) if args.command == "prepare" else _run_merge(args)
    except (ValueError, OSError, KeyError) as exc:
        print(f"hata: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
