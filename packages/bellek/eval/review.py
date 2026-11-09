"""Değerlendirici örneklem kontrolü: dosya üretimi ve uyum hesabı (PROTOCOL.md §7).

`make`: 30 sorgulduk örneklemi seçer (20 rastgele + 10 hedefli), kör tur ve açık
tur Markdown dosyalarını ve örneklem kaydını yazar. `score`: Değerlendiricinin doldurduğu
kör dosyayı ayrıştırır, final GT ile κ_w, PSA ve negatiflik uyumunu hesaplar.

Kullanım:
    python -m eval.review make  [--version v1] [--gt-dir DIR] [--manifest PATH] [--queries PATH] [--notes PATH] [--seed N]
    python -m eval.review score [--version v1] [--gt-dir DIR] [--notes PATH]

Çıkış kodları: 0 başarı / GT kabul; 1 girdi-çıktı ya da biçim hatası; 2 argüman hatası;
3 uyum eşiği geçilmedi. Ekrana sorgu metni basılmaz (yalnız qid ve sayılar).
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path
from typing import Any

from eval.adjudicate import load_jsonl
from eval.agreement import cohen_kappa, weighted_kappa

MASK = "[GİZLİ DEĞER MASKELENDİ]"
THRESHOLD_PSA = 0.70
DEFAULT_SEED = 20261024

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_USAGE = 2
EXIT_BELOW_THRESHOLD = 3

_REPO_ROOT = Path(__file__).resolve().parent.parent

_KEY_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"sk-[A-Za-z0-9_-]{16,}"),
    re.compile(r"AIza[0-9A-Za-z_-]{30,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),
    re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"),
)
_LONG_RUN = re.compile(r"[A-Za-z0-9_-]{32,}")
_SECTION = re.compile(r"^##\s+(q\d+)\s*$")
_GRADE_LINE = re.compile(r"^-\s*([12])\s*:(.*)$")


# --------------------------------------------------------------------------- maskeleme


def _mask_long_run(match: re.Match[str]) -> str:
    run = match.group(0)
    if any(ch.isalpha() for ch in run) and any(ch.isdigit() for ch in run):
        return MASK
    return run


def mask_secrets(text: str) -> str:
    """Anahtar benzeri değerleri MASK ile değiştirir."""
    for pattern in _KEY_PATTERNS:
        text = pattern.sub(MASK, text)
    return _LONG_RUN.sub(_mask_long_run, text)


def _one_line(text: str) -> str:
    return " ".join(mask_secrets(str(text)).split())


def _cell(text: str) -> str:
    return _one_line(text).replace("|", "\\|")


# --------------------------------------------------------------------------- örneklem


def _positive_notes(rows: list[dict]) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for row in rows:
        qid = row.get("qid")
        if not isinstance(qid, str):
            continue
        bucket = result.setdefault(qid, set())
        for label in row.get("labels") or []:
            grade = label.get("grade")
            if isinstance(grade, int) and grade >= 1:
                bucket.add(label.get("note"))
    return result


def select_sample(
    dev_ids: list[str],
    heldout_ids: list[str],
    qrels: list[dict],
    gt_queries: list[dict],
    adjudication: list[dict],
    a_rows: list[dict],
    b_rows: list[dict],
    seed: int = DEFAULT_SEED,
    n_dev: int = 12,
    n_heldout: int = 8,
    n_targeted: int = 10,
) -> tuple[list[str], list[str]]:
    """(rastgele qid'ler, hedefli qid'ler); ikisi de sıralı ve ayrık."""
    rng = random.Random(f"{seed}-degerlendirici")
    dev_sorted = sorted(dev_ids)
    held_sorted = sorted(heldout_ids)
    random_ids = rng.sample(dev_sorted, min(n_dev, len(dev_sorted)))
    random_ids += rng.sample(held_sorted, min(n_heldout, len(held_sorted)))
    random_set = set(random_ids)
    universe = (set(dev_ids) | set(heldout_ids)) - random_set

    class1 = {r["qid"] for r in adjudication if isinstance(r.get("qid"), str)}

    pos_a = _positive_notes(a_rows)
    pos_b = _positive_notes(b_rows)
    both = {r["qid"] for r in a_rows if "qid" in r} & {r["qid"] for r in b_rows if "qid" in r}
    class2 = {q for q in both if bool(pos_a.get(q)) != bool(pos_b.get(q))}

    final: dict[str, dict[str, int]] = {}
    for row in qrels:
        grade = row.get("grade")
        if isinstance(grade, int) and grade >= 1:
            final.setdefault(row["qid"], {})[row["note"]] = grade
    class3 = {q for q, notes in final.items() if len(notes) == 1 and 1 in notes.values()}

    targeted: list[str] = []
    for group in (class1, class2, class3):
        for qid in sorted(group & universe):
            if len(targeted) >= n_targeted:
                break
            if qid not in targeted:
                targeted.append(qid)
    return sorted(random_ids), sorted(targeted)


# --------------------------------------------------------------------------- Markdown


def render_blind(random_ids: list[str], queries: dict[str, dict], notes: list[dict]) -> str:
    """Kör tur dosyası: sorgu + cwd + boş işaret satırları, sonda not tablosu."""
    lines = [
        "# Değerlendirici kontrolü — 1. tur (kör)",
        "",
        "Yönerge: Her sorgu için, o prompt bu cwd'de yazılsaydı ajanın doğru iş yapması için "
        "**gerekli** (2) ve **yararlı** (1) notların note_id'lerini ilgili satıra virgülle yaz. "
        "Hiç yoksa \"yok\" yaz. Rubrik özeti için PROTOCOL §5'e bak. "
        "2. tur dosyasını bu tur bitmeden AÇMA.",
        "",
    ]
    for qid in random_ids:
        query = queries[qid]
        lines += [
            f"## {qid}",
            f"- cwd: `{query.get('project', '')}`",
            f"- prompt: {_one_line(query.get('text', ''))}",
            "- 2: ",
            "- 1: ",
            "- not: ",
            "",
        ]
    lines += [
        "## Ek: not tablosu",
        "",
        "| note_id | type | name | description |",
        "|---|---|---|---|",
    ]
    for note in sorted(notes, key=lambda n: n["note_id"]):
        lines.append(
            f"| {str(note['note_id']).replace('|', chr(92) + '|')} | {_cell(note.get('type', ''))} | "
            f"{_cell(note.get('name', ''))} | {_cell(note.get('description', ''))} |"
        )
    return "\n".join(lines) + "\n"


def _open_section(
    qid: str, queries: dict[str, dict], labels: list[dict], flags: dict[str, Any]
) -> list[str]:
    query = queries[qid]
    negative = bool(flags.get("negative", not labels))
    contentless = bool(flags.get("contentless", False))
    lines = [
        f"## {qid}",
        f"- cwd: `{query.get('project', '')}`",
        f"- prompt: {_one_line(query.get('text', ''))}",
        f"- GT: negatif: {'evet' if negative else 'hayır'}; "
        f"contentless: {'evet' if contentless else 'hayır'}",
    ]
    if labels:
        for row in sorted(labels, key=lambda r: (-int(r["grade"]), r["note"])):
            lines.append(
                f"- {row['grade']} · {row['note']} — {_one_line(row.get('why', ''))} "
                f"(kaynak: {row.get('source', '')})"
            )
    else:
        lines.append("- GT etiketi yok (tüm notlar 0)")
    lines += ["- Karar: GT doğru / ben haklıyım / ikisi de olur", "- Düzeltme: ", ""]
    return lines


def render_open(
    random_ids: list[str],
    targeted_ids: list[str],
    queries: dict[str, dict],
    qrels: list[dict],
    gt_queries: list[dict],
    notes: list[dict],
) -> str:
    """Açık tur dosyası: GT etiketleri ve gerekçeleriyle."""
    by_qid: dict[str, list[dict]] = {}
    for row in qrels:
        by_qid.setdefault(row["qid"], []).append(row)
    flags = {row["qid"]: row for row in gt_queries if "qid" in row}
    lines = ["# Değerlendirici kontrolü — 2. tur (açık)", ""]
    for title, ids in (("Rastgele 20", random_ids), ("Hedefli 10", targeted_ids)):
        lines += [f"# {title}", ""]
        for qid in ids:
            lines += _open_section(qid, queries, by_qid.get(qid, []), flags.get(qid, {}))
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- ayrıştırma ve skor


def parse_blind(md_text: str, note_ids: set[str]) -> tuple[dict[str, dict[str, int]], list[str]]:
    """Doldurulmuş kör dosyadan qid → {note: grade} ve hata listesi."""
    result: dict[str, dict[str, int]] = {}
    errors: list[str] = []
    current: str | None = None
    filled: dict[str, bool] = {}
    seen: set[str] = set()

    for line in md_text.splitlines():
        if line.startswith("## "):
            match = _SECTION.match(line.strip())
            current = match.group(1) if match else None
            if current is not None:
                if current in seen:
                    errors.append(f"{current}: bölüm birden fazla kez var")
                seen.add(current)
                result.setdefault(current, {})
                filled.setdefault(current, False)
            continue
        if current is None:
            continue
        match = _GRADE_LINE.match(line.strip())
        if not match:
            continue
        grade = int(match.group(1))
        tokens = [t.strip("`") for t in re.split(r"[,\s]+", match.group(2).strip())]
        tokens = [t for t in tokens if t]
        if tokens:
            filled[current] = True
        for token in tokens:
            if token.lower() == "yok" or token == "-":
                continue
            if token not in note_ids:
                errors.append(f"{current}: bilinmeyen note_id: {token}")
                continue
            previous = result[current].get(token)
            if previous is not None and previous != grade:
                errors.append(f"{current}: {token} iki satırda da var")
                continue
            result[current][token] = grade

    for qid in sorted(filled):
        if not filled[qid]:
            errors.append(f"{qid}: doldurulmamış (iki satır da boş; yoksa \"yok\" yaz)")
    return result, errors


def score(
    degerlendirici: dict[str, dict[str, int]],
    qrels: list[dict],
    gt_queries: list[dict],
    note_ids: set[str],
) -> dict:
    """Değerlendirici etiketleri × final GT uyumu (yalnız `degerlendirici`'daki sorgular)."""
    final: dict[tuple[str, str], int] = {}
    for row in qrels:
        grade = row.get("grade")
        if isinstance(grade, int):
            final[(row["qid"], row["note"])] = grade

    pairs: list[tuple[int, int]] = []
    both = s_pos = g_pos = 0
    neg_pairs: list[tuple[bool, bool]] = []
    for qid in sorted(degerlendirici):
        s_any = g_any = False
        for note in sorted(note_ids):
            s_grade = degerlendirici[qid].get(note, 0)
            g_grade = final.get((qid, note), 0)
            pairs.append((s_grade, g_grade))
            s_pos += s_grade >= 1
            g_pos += g_grade >= 1
            both += s_grade >= 1 and g_grade >= 1
            s_any = s_any or s_grade >= 1
            g_any = g_any or g_grade >= 1
        neg_pairs.append((not s_any, not g_any))

    denominator = s_pos + g_pos
    psa = None if denominator == 0 else 2 * both / denominator
    return {
        "n_queries": len(degerlendirici),
        "kappa_w": weighted_kappa(pairs),
        "psa": psa,
        "neg_raw": (sum(1 for s, g in neg_pairs if s == g) / len(neg_pairs)) if neg_pairs else None,
        "neg_kappa": cohen_kappa(neg_pairs),
        "threshold_psa": THRESHOLD_PSA,
        "accepted": psa is not None and psa >= THRESHOLD_PSA,
    }


# --------------------------------------------------------------------------- CLI


class _ArgumentError(Exception):
    def __init__(self, message: str, usage: str) -> None:
        super().__init__(message)
        self.message = message
        self.usage = usage


class _ParserExit(Exception):
    def __init__(self, status: int) -> None:
        super().__init__(status)
        self.status = status


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> Any:  # type: ignore[override]
        raise _ArgumentError(message, self.format_usage())

    def exit(self, status: int = 0, message: str | None = None) -> Any:  # type: ignore[override]
        if message:
            print(message, end="", file=sys.stderr)
        raise _ParserExit(status)


def _build_parser() -> _Parser:
    parser = _Parser(prog="python -m eval.review",
                     description="Değerlendirici örneklem kontrolü (PROTOCOL.md §7).")
    sub = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)
    make = sub.add_parser("make", help="kontrol dosyalarını üret")
    score_p = sub.add_parser("score", help="doldurulmuş kör dosyadan uyumu hesapla")
    for p in (make, score_p):
        p.add_argument("--version", default="v1")
        p.add_argument("--gt-dir", type=Path, default=None)
        p.add_argument("--notes", type=Path, default=None)
    make.add_argument("--manifest", type=Path, default=None)
    make.add_argument("--queries", type=Path, default=None)
    make.add_argument("--seed", type=int, default=DEFAULT_SEED)
    return parser


def _setup_streams() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8")
            except (OSError, ValueError):
                pass


def _fmt(value: float | None) -> str:
    return "tanımsız" if value is None else f"{value:.3f}".replace(".", ",")


def _load_required(path: Path) -> list[dict]:
    if not path.is_file():
        raise FileNotFoundError(f"girdi yok: {path}")
    return load_jsonl(path)


def _run_make(args: argparse.Namespace) -> int:
    version: str = args.version
    gt_dir: Path = args.gt_dir or _REPO_ROOT / "eval" / "data" / "gt" / version
    manifest_path: Path = args.manifest or _REPO_ROOT / "eval" / "manifests" / f"{version}.json"
    queries_path: Path = args.queries or _REPO_ROOT / "eval" / "data" / f"queries-{version}.jsonl"
    notes_path: Path = args.notes or _REPO_ROOT / "eval" / "data" / "corpus" / version / "notes.jsonl"

    outputs = [gt_dir / "degerlendirici-kontrol-1-kor.md", gt_dir / "degerlendirici-kontrol-2-acik.md",
               gt_dir / "degerlendirici-sample.json"]
    existing = [p for p in outputs if p.exists()]
    if existing:
        for p in existing:
            print(f"hata: çıktı zaten var, ezilmez: {p}", file=sys.stderr)
        return EXIT_ERROR

    try:
        if not manifest_path.is_file():
            raise FileNotFoundError(f"girdi yok: {manifest_path}")
        split = json.loads(manifest_path.read_text(encoding="utf-8"))["split"]
        dev_ids = list(split["dev_ids"])
        heldout_ids = list(split["heldout_ids"])
        queries = {row["id"]: row for row in _load_required(queries_path)}
        notes = _load_required(notes_path)
        a_rows = _load_required(gt_dir / "juror-a.jsonl")
        b_rows = _load_required(gt_dir / "juror-b.jsonl")
        qrels = _load_required(gt_dir / "qrels.jsonl")
        gt_queries = _load_required(gt_dir / "gt-queries.jsonl")
        adj_path = gt_dir / "adjudication.jsonl"
        adjudication = load_jsonl(adj_path) if adj_path.is_file() else []
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"hata: girdi okunamadı: {exc}", file=sys.stderr)
        return EXIT_ERROR

    random_ids, targeted_ids = select_sample(
        dev_ids, heldout_ids, qrels, gt_queries, adjudication, a_rows, b_rows, seed=args.seed
    )
    missing = [q for q in random_ids + targeted_ids if q not in queries]
    if missing:
        print(f"hata: sorgu dosyasında olmayan qid'ler: {', '.join(missing)}", file=sys.stderr)
        return EXIT_ERROR

    try:
        gt_dir.mkdir(parents=True, exist_ok=True)
        contents = [
            render_blind(random_ids, queries, notes),
            render_open(random_ids, targeted_ids, queries, qrels, gt_queries, notes),
            json.dumps({"seed": args.seed, "random": random_ids, "targeted": targeted_ids},
                       ensure_ascii=False, indent=2) + "\n",
        ]
        for path, content in zip(outputs, contents):
            with path.open("x", encoding="utf-8", newline="\n") as handle:
                handle.write(content)
    except OSError as exc:
        print(f"hata: yazılamadı: {exc}", file=sys.stderr)
        return EXIT_ERROR

    print(f"Rastgele: {len(random_ids)} sorgu, hedefli: {len(targeted_ids)} sorgu")
    for path in outputs:
        print(f"Yazıldı: {path}")
    return EXIT_OK


def _run_score(args: argparse.Namespace) -> int:
    version: str = args.version
    gt_dir: Path = args.gt_dir or _REPO_ROOT / "eval" / "data" / "gt" / version
    notes_path: Path = args.notes or _REPO_ROOT / "eval" / "data" / "corpus" / version / "notes.jsonl"
    out_path = gt_dir / "degerlendirici-agreement.json"
    if out_path.exists():
        print(f"hata: çıktı zaten var, ezilmez: {out_path}", file=sys.stderr)
        return EXIT_ERROR
    try:
        blind_path = gt_dir / "degerlendirici-kontrol-1-kor.md"
        if not blind_path.is_file():
            raise FileNotFoundError(f"girdi yok: {blind_path}")
        md_text = blind_path.read_text(encoding="utf-8")
        note_ids = {row["note_id"] for row in _load_required(notes_path)}
        qrels = _load_required(gt_dir / "qrels.jsonl")
        gt_queries = _load_required(gt_dir / "gt-queries.jsonl")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"hata: girdi okunamadı: {exc}", file=sys.stderr)
        return EXIT_ERROR

    degerlendirici, errors = parse_blind(md_text, note_ids)
    if errors:
        print(f"Ayrıştırma hataları ({len(errors)}):")
        for error in errors:
            print(f"  - {error}")
        return EXIT_ERROR

    result = score(degerlendirici, qrels, gt_queries, note_ids)
    print("Değerlendirici × final GT uyumu (kaba tahmin)")
    print("| ölçü | değer |")
    print("|---|---|")
    print(f"| sorgu sayısı | {result['n_queries']} |")
    print(f"| κ_w | {_fmt(result['kappa_w'])} |")
    print(f"| PSA | {_fmt(result['psa'])} (eşik {_fmt(THRESHOLD_PSA)}) |")
    print(f"| negatiflik ham uyum | {_fmt(result['neg_raw'])} |")
    print(f"| negatiflik κ | {_fmt(result['neg_kappa'])} |")
    try:
        with out_path.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    except OSError as exc:
        print(f"hata: yazılamadı: {out_path} ({exc})", file=sys.stderr)
        return EXIT_ERROR
    print(f"Yazıldı: {out_path}")
    if result["accepted"]:
        print("Sonuç: kabul (PSA eşiği geçti).")
        return EXIT_OK
    print("Sonuç: kabul değil (PSA eşiğin altında); neden yazılır, kararı Değerlendirici verir.")
    return EXIT_BELOW_THRESHOLD


def main(argv: list[str] | None = None) -> int:
    _setup_streams()
    parser = _build_parser()
    try:
        args = parser.parse_args(argv)
    except _ArgumentError as exc:
        print(exc.usage, end="", file=sys.stderr)
        print(f"hata: {exc.message}", file=sys.stderr)
        return EXIT_USAGE
    except _ParserExit as exc:
        return exc.status
    if args.command == "make":
        return _run_make(args)
    return _run_score(args)


if __name__ == "__main__":
    sys.exit(main())
