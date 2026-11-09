"""Eval sorgu seti için tabakalı dev / held-out bölme ve dondurma aracı.

Bölme PROTOCOL.md §8'e göre yapılır: hücre = (stratum, kind), held-out toplamı
en büyük kalan yöntemiyle dağıtılır, hücre içinde seed'li karıştırma uygulanır.
Manifest yalnız id'leri ve digest'leri içerir; sorgu metni, proje ya da not yolu
yazılmaz. Var olan manifest asla ezilmez.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_SEED = 20261024
DEFAULT_HELDOUT_RATIO = 0.4

_REPO_ROOT = Path(__file__).resolve().parent.parent


def load_queries(path: Path) -> list[dict]:
    """JSONL dosyasını okur; boş satırları atlar, bozuk satırda ValueError."""
    queries: list[dict] = []
    with path.open("r", encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, start=1):
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}: satır {lineno} geçerli JSON değil: {exc.msg}") from exc
            if not isinstance(obj, dict):
                raise ValueError(f"{path}: satır {lineno} bir JSON nesnesi değil")
            queries.append(obj)
    return queries


def _cell_of(query: dict) -> tuple[str, str]:
    return (str(query["stratum"]), str(query["kind"]))


def split_queries(
    queries: list[dict],
    heldout_ratio: float = DEFAULT_HELDOUT_RATIO,
    seed: int = DEFAULT_SEED,
) -> tuple[list[str], list[str]]:
    """(dev_ids, heldout_ids) döndürür; ikisi de id'ye göre sıralıdır."""
    if not 0.0 <= heldout_ratio <= 1.0:
        raise ValueError(f"held-out oranı 0 ile 1 arasında olmalı: {heldout_ratio}")
    cells: dict[tuple[str, str], list[str]] = defaultdict(list)
    seen: set[str] = set()
    for query in queries:
        qid = str(query["id"])
        if qid in seen:
            raise ValueError(f"yinelenen sorgu id'si: {qid}")
        seen.add(qid)
        cells[_cell_of(query)].append(qid)

    total = len(seen)
    target = math.floor(heldout_ratio * total + 0.5)
    keys = sorted(cells)
    exact = {key: heldout_ratio * len(cells[key]) for key in keys}
    quota = {key: min(math.floor(exact[key]), len(cells[key])) for key in keys}
    remaining = target - sum(quota.values())
    order = sorted(keys, key=lambda key: (-(exact[key] - math.floor(exact[key])), key))
    for key in order:
        if remaining <= 0:
            break
        if quota[key] < len(cells[key]):
            quota[key] += 1
            remaining -= 1

    rng = random.Random(f"{seed}-split")
    heldout: list[str] = []
    for key in keys:
        ids = sorted(cells[key])
        rng.shuffle(ids)
        heldout.extend(ids[: quota[key]])
    heldout_set = set(heldout)
    dev = sorted(qid for qid in seen if qid not in heldout_set)
    return dev, sorted(heldout)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def split_digest(dev_ids: list[str], heldout_ids: list[str]) -> str:
    payload = json.dumps(
        {"dev_ids": dev_ids, "heldout_ids": heldout_ids},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _bellek_version() -> str:
    try:
        from bellek import __version__
        return str(__version__)
    except ImportError:
        pass
    src = str(_REPO_ROOT / "src")
    added = src not in sys.path
    if added:
        sys.path.insert(0, src)
    try:
        from bellek import __version__
        return str(__version__)
    except ImportError:
        return "bilinmiyor"
    finally:
        if added and src in sys.path:
            sys.path.remove(src)


def build_manifest(
    version: str,
    queries: list[dict],
    queries_path: Path,
    corpus_manifest_path: Path,
    dev_ids: list[str],
    heldout_ids: list[str],
    seed: int,
    heldout_ratio: float,
) -> dict:
    heldout_set = set(heldout_ids)
    by_cell: dict[str, dict[str, int]] = {}
    for query in sorted(queries, key=lambda q: _cell_of(q)):
        stratum, kind = _cell_of(query)
        entry = by_cell.setdefault(f"{stratum}/{kind}", {"dev": 0, "heldout": 0})
        entry["heldout" if str(query["id"]) in heldout_set else "dev"] += 1
    created = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return {
        "version": version,
        "created_at": created,
        "seed": seed,
        "corpus_digest": sha256_file(corpus_manifest_path),
        "queries_digest": sha256_file(queries_path),
        "split": {
            "heldout_ratio": heldout_ratio,
            "dev_ids": list(dev_ids),
            "heldout_ids": list(heldout_ids),
            "split_digest": split_digest(dev_ids, heldout_ids),
        },
        "counts": {
            "total": len(dev_ids) + len(heldout_ids),
            "dev": len(dev_ids),
            "heldout": len(heldout_ids),
            "by_cell": by_cell,
        },
        "tools": {"bellek": _bellek_version()},
    }


def write_manifest(manifest: dict, out: Path) -> None:
    """Manifesti yazar; dosya varsa FileExistsError (dondurulmuş, ezilmez)."""
    if out.exists():
        raise FileExistsError(str(out))
    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    with out.open("x", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


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
        prog="python -m eval.split",
        description="Sorgu setini tabakalı biçimde dev / held-out olarak böler ve dondurur.",
        add_help=False,
    )
    parser.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    parser.add_argument("--version", default="v1", metavar="SÜRÜM", help="sürüm kimliği (varsayılan: v1)")
    parser.add_argument("--queries", type=Path, default=None, metavar="YOL",
                        help="sorgu JSONL yolu (varsayılan: eval/data/queries-<sürüm>.jsonl)")
    parser.add_argument("--corpus-manifest", type=Path, default=None, metavar="YOL",
                        help="korpus manifest yolu (varsayılan: eval/data/corpus/<sürüm>/manifest.json)")
    parser.add_argument("--out", type=Path, default=None, metavar="YOL",
                        help="çıktı manifest yolu (varsayılan: eval/manifests/<sürüm>.json)")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help=f"RNG tohumu (varsayılan: {DEFAULT_SEED})")
    parser.add_argument("--ratio", type=float, default=DEFAULT_HELDOUT_RATIO,
                        help=f"held-out oranı (varsayılan: {DEFAULT_HELDOUT_RATIO})")
    return parser


def _print_summary(manifest: dict, out: Path) -> None:
    counts = manifest["counts"]
    print(f"Sürüm: {manifest['version']}  seed: {manifest['seed']}  oran: {manifest['split']['heldout_ratio']}")
    print(f"Toplam: {counts['total']}  dev: {counts['dev']}  held-out: {counts['heldout']}")
    print("\nHücre (stratum/kind)            dev  held-out")
    for cell, entry in counts["by_cell"].items():
        print(f"  {cell:<28} {entry['dev']:>4}  {entry['heldout']:>8}")
    print(f"\ncorpus_digest : {manifest['corpus_digest']}")
    print(f"queries_digest: {manifest['queries_digest']}")
    print(f"split_digest  : {manifest['split']['split_digest']}")
    print(f"\nYazıldı: {out}")


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
    except SystemExit as exc:  # -h
        return exc.code if isinstance(exc.code, int) else 0

    version: str = args.version
    data = _REPO_ROOT / "eval" / "data"
    queries_path: Path = args.queries or data / f"queries-{version}.jsonl"
    corpus_path: Path = args.corpus_manifest or data / "corpus" / version / "manifest.json"
    out: Path = args.out or _REPO_ROOT / "eval" / "manifests" / f"{version}.json"

    for label, path in (("sorgu dosyası", queries_path), ("korpus manifesti", corpus_path)):
        if not path.is_file():
            print(f"hata: {label} bulunamadı: {path}", file=sys.stderr)
            return 1
    if out.exists():
        print(f"hata: manifest zaten var, dondurulmuş dosya ezilmez: {out}", file=sys.stderr)
        return 1
    try:
        queries = load_queries(queries_path)
        dev_ids, heldout_ids = split_queries(queries, args.ratio, args.seed)
        manifest = build_manifest(version, queries, queries_path, corpus_path,
                                  dev_ids, heldout_ids, args.seed, args.ratio)
        write_manifest(manifest, out)
    except FileExistsError:
        print(f"hata: manifest zaten var, dondurulmuş dosya ezilmez: {out}", file=sys.stderr)
        return 1
    except (ValueError, KeyError) as exc:
        print(f"hata: sorgu seti geçersiz: {exc}", file=sys.stderr)
        return 1
    _print_summary(manifest, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
