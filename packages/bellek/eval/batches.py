"""Jüri batch'lerini ve pilot örneklemini üretir.

Eval sorgularından jüri agent'larına verilecek 20'lik batch dosyalarını yazar.
Batch dosyaları yalnız `qid`, `text`, `project` taşır; tarih, oturum ve tabaka
bilgisi jüriye sızmasın diye bilerek çıkarılır. Ekrana sorgu metni basılmaz.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path
from typing import Any

STRATUM_ORDER: tuple[str, ...] = (
    "root", "proje_a", "proje_b", "proje_c", "n8n", "proje_d", "odev", "other",
)
DEFAULT_SEED = 20261024

_REPO_ROOT = Path(__file__).resolve().parent.parent
_KIND_ORDER = {"normal": 0, "short": 1}


def _stratum_key(stratum: str) -> tuple[int, str]:
    if stratum in STRATUM_ORDER:
        return (STRATUM_ORDER.index(stratum), "")
    return (len(STRATUM_ORDER), stratum)


def load_queries(path: Path) -> dict[str, dict]:
    """JSONL sorgu dosyasını id → kayıt sözlüğü olarak okur; yinelenen id ValueError."""
    queries: dict[str, dict] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_no}: bozuk JSON satırı") from exc
            if not isinstance(record, dict) or "id" not in record:
                raise ValueError(f"{path}:{line_no}: 'id' alanı olmayan kayıt")
            qid = record["id"]
            if qid in queries:
                raise ValueError(f"yinelenen sorgu id'si: {qid}")
            queries[qid] = record
    return queries


def pilot_ids(
    dev_ids: list[str],
    queries: dict[str, dict],
    n: int = 20,
    seed: int = DEFAULT_SEED,
    salt: str = "pilot-1",
) -> list[str]:
    """Dev kümesinden tabakaya orantılı, deterministik pilot örneği seçer."""
    unique = list(dict.fromkeys(dev_ids))
    for qid in unique:
        if qid not in queries:
            raise KeyError(qid)
    total = len(unique)
    n = min(n, total)
    if n <= 0:
        return []
    by_stratum: dict[str, list[str]] = {}
    for qid in unique:
        by_stratum.setdefault(queries[qid]["stratum"], []).append(qid)
    strata = sorted(by_stratum, key=_stratum_key)
    floors: dict[str, int] = {}
    remainders: dict[str, int] = {}
    for name in strata:
        exact = n * len(by_stratum[name])
        floors[name] = exact // total
        remainders[name] = exact % total
    leftover = n - sum(floors.values())
    # sorted kararlıdır: eşit kalanda strata (STRATUM_ORDER) sırası korunur.
    for name in sorted(strata, key=lambda s: -remainders[s])[:leftover]:
        floors[name] += 1
    rng = random.Random(f"{seed}-{salt}")
    chosen: list[str] = []
    for name in strata:
        pool = sorted(by_stratum[name])
        rng.shuffle(pool)
        chosen.extend(pool[: floors[name]])
    return sorted(chosen)


def make_batches(
    qids: list[str], queries: dict[str, dict], size: int = 20
) -> list[list[str]]:
    """Sorguları (tabaka, tür, id) sırasıyla dizip ardışık `size`'lık parçalara böler."""
    if size < 1:
        raise ValueError("batch boyutu en az 1 olmalı")

    def key(qid: str) -> tuple[tuple[int, str], int, str]:
        record = queries[qid]
        return (
            _stratum_key(record["stratum"]),
            _KIND_ORDER.get(record.get("kind", "normal"), len(_KIND_ORDER)),
            qid,
        )

    ordered = sorted(qids, key=key)
    return [ordered[i : i + size] for i in range(0, len(ordered), size)]


def write_batches(
    batches: list[list[str]], queries: dict[str, dict], out_dir: Path
) -> list[Path]:
    """Batch dosyalarını ve index.json'u yazar; out_dir dolu ise FileExistsError."""
    if out_dir.exists() and any(out_dir.iterdir()):
        raise FileExistsError(str(out_dir))
    out_dir.mkdir(parents=True, exist_ok=True)
    width = 3 if len(batches) > 99 else 2
    paths: list[Path] = []
    index: list[dict[str, Any]] = []
    for number, qids in enumerate(batches, start=1):
        name = f"batch-{number:0{width}d}.jsonl"
        path = out_dir / name
        with path.open("w", encoding="utf-8", newline="\n") as handle:
            for qid in qids:
                record = queries[qid]
                row = {"qid": qid, "text": record["text"], "project": record["project"]}
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        paths.append(path)
        index.append({"file": name, "qids": list(qids)})
    total = sum(len(qids) for qids in batches)
    with (out_dir / "index.json").open("w", encoding="utf-8", newline="\n") as handle:
        json.dump({"batches": index, "total": total}, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return paths


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
        prog="python -m eval.batches",
        description="Jüri batch dosyalarını ve pilot örneklemini üretir.",
        add_help=False,
    )
    parser.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    sub = parser.add_subparsers(dest="command", metavar="KOMUT", parser_class=_Parser)

    pilot = sub.add_parser("pilot", help="dev'den tabakalı pilot batch'i yaz", add_help=False)
    pilot.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    pilot.add_argument("--version", default="v1", help="veri sürümü (varsayılan: v1)")
    pilot.add_argument("--manifest", metavar="YOL", type=Path, default=None,
                       help="bölme manifest'i (varsayılan: eval/manifests/<sürüm>.json)")
    pilot.add_argument("--queries", metavar="YOL", type=Path, default=None,
                       help="sorgu JSONL (varsayılan: eval/data/queries-<sürüm>.jsonl)")
    pilot.add_argument("--out", metavar="DİZİN", type=Path, default=None,
                       help="çıktı dizini (varsayılan: eval/data/gt/<sürüm>/<salt>)")
    pilot.add_argument("--n", type=int, default=20, help="pilot sorgu sayısı")
    pilot.add_argument("--salt", default="pilot-1", help="örnekleme tuzu")

    full = sub.add_parser("main", help="tüm sorguları batch'le", add_help=False)
    full.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    full.add_argument("--version", default="v1", help="veri sürümü (varsayılan: v1)")
    full.add_argument("--queries", metavar="YOL", type=Path, default=None,
                      help="sorgu JSONL (varsayılan: eval/data/queries-<sürüm>.jsonl)")
    full.add_argument("--out", metavar="DİZİN", type=Path, default=None,
                      help="çıktı dizini (varsayılan: eval/data/gt/<sürüm>/batches)")
    full.add_argument("--size", type=int, default=20, help="batch boyutu")
    return parser


def _print_summary(batches: list[list[str]], queries: dict[str, dict], out: Path) -> None:
    total = sum(len(b) for b in batches)
    print(f"{len(batches)} batch yazıldı ({total} sorgu): {out}")
    for number, qids in enumerate(batches, start=1):
        counts = Counter(queries[q]["stratum"] for q in qids)
        parts = ", ".join(
            f"{name}={counts[name]}" for name in sorted(counts, key=_stratum_key)
        )
        print(f"  batch-{number:02d}: {len(qids)} sorgu ({parts})")


def _read_manifest(path: Path) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    dev_ids = data["split"]["dev_ids"]
    if not isinstance(dev_ids, list):
        raise ValueError("dev_ids bir liste olmalı")
    return [str(x) for x in dev_ids]


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
    if args.command not in ("pilot", "main"):
        parser.print_help()
        return 2
    version: str = args.version
    queries_path: Path = args.queries or (_REPO_ROOT / "eval" / "data" / f"queries-{version}.jsonl")
    if not queries_path.is_file():
        print(f"hata: sorgu dosyası bulunamadı: {queries_path}", file=sys.stderr)
        return 1
    try:
        queries = load_queries(queries_path)
    except (ValueError, OSError) as exc:
        print(f"hata: sorgular okunamadı: {exc}", file=sys.stderr)
        return 1

    if args.command == "pilot":
        manifest: Path = args.manifest or (_REPO_ROOT / "eval" / "manifests" / f"{version}.json")
        if not manifest.is_file():
            print(f"hata: manifest bulunamadı: {manifest}", file=sys.stderr)
            return 1
        out: Path = args.out or (_REPO_ROOT / "eval" / "data" / "gt" / version / args.salt)
        try:
            dev_ids = _read_manifest(manifest)
            chosen = pilot_ids(dev_ids, queries, n=args.n, salt=args.salt)
        except (ValueError, KeyError, OSError) as exc:
            print(f"hata: manifest/pilot hatası: {exc!r}", file=sys.stderr)
            return 1
        batches = [chosen] if chosen else []
    else:
        out = args.out or (_REPO_ROOT / "eval" / "data" / "gt" / version / "batches")
        try:
            batches = make_batches(list(queries), queries, size=args.size)
        except (ValueError, KeyError) as exc:
            print(f"hata: batch'leme hatası: {exc!r}", file=sys.stderr)
            return 1

    try:
        write_batches(batches, queries, out)
    except FileExistsError:
        print(f"hata: çıktı dizini dolu: {out}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"hata: yazılamadı: {exc}", file=sys.stderr)
        return 1
    _print_summary(batches, queries, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
