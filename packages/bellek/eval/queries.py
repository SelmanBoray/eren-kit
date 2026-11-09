"""Eval sorgu çıkarma ve tabakalı örnekleme aracı.

Kullanıcının Claude Code geçmişinden (history.jsonl) gerçek prompt'ları okur,
slash/shell/yapıştırma girdilerini ayıklar, tekilleştirir ve proje
tabakalarına göre deterministik biçimde örnekler. Prompt metinleri yalnız
çıktı dosyasına yazılır; ekrana yalnız sayılar basılır.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

DEFAULT_QUOTAS: dict[str, int] = {
    "root": 50,
    "proje_a": 30,
    "proje_b": 20,
    "proje_c": 20,
    "n8n": 20,
    "proje_d": 15,
    "odev": 10,
    "other": 5,
}
DEFAULT_SHORT_QUOTA = 30
DEFAULT_SEED = 20261024

_REPO_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_OUT = _REPO_ROOT / "eval" / "data" / "queries-v1.jsonl"
_DEFAULT_HISTORY = Path.home() / ".claude" / "history.jsonl"

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

_STRATUM_PREFIXES: list[tuple[tuple[str, ...], str]] = [
    (("c:", "proje_a"), "proje_a"),
    (("c:", "proje_a_asama2"), "proje_a"),
    (("c:", "proje_b"), "proje_b"),
    (("c:", "proje_c"), "proje_c"),
    (("c:", "n8n"), "n8n"),
    (("c:", "proje_d"), "proje_d"),
    (("c:", "ödev"), "odev"),
    (("c:", "prog1odev"), "odev"),
    (("c:", "analiz"), "odev"),
    (("c:", "unity ödev"), "odev"),
    (("c:", "java"), "odev"),
    (("c:", "prog"), "odev"),
]


@dataclass(frozen=True)
class Prompt:
    text: str
    project: str
    timestamp_ms: int
    session_id: str


@dataclass(frozen=True)
class Query:
    id: str
    text: str
    project: str
    stratum: str
    kind: str
    timestamp: str
    session_id: str


def load_history(path: Path) -> tuple[list[Prompt], int]:
    """history.jsonl'u okur; (geçerli prompt'lar, atlanan bozuk satır sayısı) döner.

    Tamamen boş satırlar ne prompt ne bozuk sayılır (yok sayılır).
    """
    prompts: list[Prompt] = []
    skipped = 0
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            line = raw.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue
            if not isinstance(obj, dict):
                skipped += 1
                continue
            text = obj.get("display")
            ts = obj.get("timestamp")
            project = obj.get("project")
            session = obj.get("sessionId")
            if (
                not isinstance(text, str)
                or not isinstance(project, str)
                or not isinstance(session, str)
                or isinstance(ts, bool)
                or not isinstance(ts, int)
            ):
                skipped += 1
                continue
            prompts.append(Prompt(text, project, ts, session))
    return prompts, skipped


def classify(text: str) -> str:
    stripped = text.lstrip()
    if stripped.startswith("/"):
        return "slash"
    if stripped.startswith("!"):
        return "shell"
    if "[Pasted text" in text or "[Image #" in text:
        return "pasted"
    if len(text.split()) <= 3:
        return "short"
    return "normal"


def _components(project: str) -> tuple[str, ...]:
    norm = project.replace("/", "\\").casefold()
    return tuple(part for part in norm.split("\\") if part)


def stratum_for(project: str) -> str:
    parts = _components(project)
    if parts == ("c:",):
        return "root"
    for prefix, name in _STRATUM_PREFIXES:
        if parts[: len(prefix)] == prefix:
            return name
    return "other"


def normalize_for_dedupe(text: str) -> str:
    return " ".join(text.casefold().split())


def dedupe(prompts: list[Prompt]) -> list[Prompt]:
    latest: dict[str, Prompt] = {}
    for prompt in prompts:
        key = normalize_for_dedupe(prompt.text)
        current = latest.get(key)
        if current is None or prompt.timestamp_ms > current.timestamp_ms:
            latest[key] = prompt
    return sorted(latest.values(), key=lambda p: (p.timestamp_ms, p.text))


def _iso(timestamp_ms: int) -> str:
    moment = _EPOCH + timedelta(milliseconds=timestamp_ms)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _pick(rng: random.Random, pool: list[Prompt], quota: int) -> tuple[list[Prompt], int]:
    """Havuzdan quota kadar rastgele seçer; (seçilenler zaman sırasında, eksik sayı)."""
    quota = max(quota, 0)
    if len(pool) <= quota:
        return list(pool), quota - len(pool)
    chosen = rng.sample(pool, quota)
    chosen.sort(key=lambda p: (p.timestamp_ms, p.text))
    return chosen, 0


def sample(
    prompts: list[Prompt],
    quotas: Mapping[str, int],
    short_quota: int,
    seed: int,
) -> tuple[list[Query], dict[str, int]]:
    rng = random.Random(seed)
    normal_pools: dict[str, list[Prompt]] = {}
    short_pool: list[Prompt] = []
    for prompt in sorted(prompts, key=lambda p: (p.timestamp_ms, p.text)):
        kind = classify(prompt.text)
        if kind == "normal":
            normal_pools.setdefault(stratum_for(prompt.project), []).append(prompt)
        elif kind == "short":
            short_pool.append(prompt)

    shortfall: dict[str, int] = {}
    picked: list[tuple[Prompt, str, str]] = []
    for stratum in sorted(quotas):
        chosen, missing = _pick(rng, normal_pools.get(stratum, []), quotas[stratum])
        if missing:
            shortfall[stratum] = missing
        picked.extend((p, stratum, "normal") for p in chosen)
    chosen_short, missing = _pick(rng, short_pool, short_quota)
    if missing:
        shortfall["short"] = missing
    picked.extend((p, stratum_for(p.project), "short") for p in chosen_short)

    width = max(3, len(str(len(picked))))
    queries = [
        Query(
            id=f"q{index:0{width}d}",
            text=p.text,
            project=p.project,
            stratum=stratum,
            kind=kind,
            timestamp=_iso(p.timestamp_ms),
            session_id=p.session_id,
        )
        for index, (p, stratum, kind) in enumerate(picked, start=1)
    ]
    return queries, shortfall


def _run(
    history: Path,
    quotas: Mapping[str, int],
    short_quota: int,
    seed: int,
) -> tuple[list[Query], dict[str, Any]]:
    prompts, skipped = load_history(history)
    by_class = Counter(classify(p.text) for p in prompts)
    unique = dedupe([p for p in prompts if classify(p.text) in ("normal", "short")])
    available_normal: Counter[str] = Counter()
    available_short = 0
    for prompt in unique:
        kind = classify(prompt.text)
        if kind == "normal":
            available_normal[stratum_for(prompt.project)] += 1
        else:
            available_short += 1
    queries, shortfall = sample(unique, quotas, short_quota, seed)
    selected_by_stratum = Counter(q.stratum for q in queries if q.kind == "normal")
    stats: dict[str, Any] = {
        "total_lines": len(prompts) + skipped,
        "skipped_malformed": skipped,
        "by_class": dict(by_class),
        "after_dedupe": len(unique),
        "available_normal_by_stratum": dict(available_normal),
        "available_short": available_short,
        "selected_by_stratum": dict(selected_by_stratum),
        "selected_short": sum(1 for q in queries if q.kind == "short"),
        "shortfall": shortfall,
    }
    return queries, stats


def extract(
    history: Path,
    out: Path,
    quotas: Mapping[str, int],
    short_quota: int,
    seed: int,
) -> dict[str, Any]:
    if out.exists():
        raise FileExistsError(str(out))
    queries, stats = _run(history, quotas, short_quota, seed)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("x", encoding="utf-8", newline="\n") as handle:
        for query in queries:
            handle.write(json.dumps(asdict(query), ensure_ascii=False) + "\n")
    return stats


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
        prog="python -m eval.queries",
        description="Eval sorgularını gerçek prompt geçmişinden çıkarır.",
        add_help=False,
    )
    parser.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    sub = parser.add_subparsers(dest="command", metavar="KOMUT", parser_class=_Parser)
    ext = sub.add_parser("extract", help="sorguları çıkar ve örnekle", add_help=False)
    ext.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    ext.add_argument("--history", metavar="YOL", type=Path, default=_DEFAULT_HISTORY,
                     help="history.jsonl yolu (varsayılan: ~/.claude/history.jsonl)")
    ext.add_argument("--out", metavar="YOL", type=Path, default=_DEFAULT_OUT,
                     help="çıktı JSONL yolu (varsayılan: eval/data/queries-v1.jsonl)")
    ext.add_argument("--seed", metavar="N", type=int, default=DEFAULT_SEED,
                     help="rastgelelik tohumu")
    ext.add_argument("--stats-only", action="store_true",
                     help="dosya yazmadan yalnız istatistikleri göster")
    return parser


def _print_stats(stats: dict[str, Any]) -> None:
    print(f"Toplam satır          : {stats['total_lines']}")
    print(f"Bozuk (atlanan) satır : {stats['skipped_malformed']}")
    print("Sınıf dağılımı (tekilleştirme öncesi):")
    for name in ("normal", "short", "slash", "shell", "pasted"):
        print(f"  {name:<10} {stats['by_class'].get(name, 0):>6}")
    print(f"Tekilleştirme sonrası (normal+short): {stats['after_dedupe']}")
    print()
    print(f"{'tabaka':<12}{'uygun':>8}{'kota':>7}{'seçilen':>9}{'açık':>7}")
    available = stats["available_normal_by_stratum"]
    selected = stats["selected_by_stratum"]
    gaps = stats["shortfall"]
    for name in sorted(DEFAULT_QUOTAS):
        print(f"{name:<12}{available.get(name, 0):>8}{DEFAULT_QUOTAS[name]:>7}"
              f"{selected.get(name, 0):>9}{gaps.get(name, 0):>7}")
    print(f"{'short':<12}{stats['available_short']:>8}{DEFAULT_SHORT_QUOTA:>7}"
          f"{stats['selected_short']:>9}{gaps.get('short', 0):>7}")


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
    if args.command != "extract":
        parser.print_help()
        return 2
    history: Path = args.history
    out: Path = args.out
    if not history.is_file():
        print(f"hata: geçmiş dosyası bulunamadı: {history}", file=sys.stderr)
        return 1
    if args.stats_only:
        _, stats = _run(history, DEFAULT_QUOTAS, DEFAULT_SHORT_QUOTA, args.seed)
        _print_stats(stats)
        return 0
    try:
        stats = extract(history, out, DEFAULT_QUOTAS, DEFAULT_SHORT_QUOTA, args.seed)
    except FileExistsError:
        print(f"hata: çıktı dosyası zaten var, ezilmez: {out}", file=sys.stderr)
        return 1
    _print_stats(stats)
    print(f"\nYazıldı: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
