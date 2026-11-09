"""Jüri not listesi: dondurulmuş korpustaki notlardan aday listesi üretir.

Jüri agent'ları bu listeyi aday bulmak için kullanır; etiket notun tamamı
okunarak verilir (bkz. PROTOCOL.md §6).

Kullanım:
    python -m eval.notelist [--version v1] [--corpus-dir DIR]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path

DEFAULT_CORPUS_ROOT = Path(__file__).resolve().parent / "data" / "corpus"

_KEY_RE = re.compile(r"^([A-Za-z0-9_.-]+)[ \t]*:(?:[ \t]+(.*))?$")
_SUBKEY_RE = re.compile(r"^[ \t]+([A-Za-z0-9_.-]+)[ \t]*:(?:[ \t]+(.*))?$")
_HEADING_RE = re.compile(r"^\s{0,3}#+[ \t]*(.*?)[ \t#]*$")
_BLOCK_SCALARS = {"|", ">", "|-", ">-", "|+", ">+"}
_MD_INTRO = (
    "Jüri not listesi — ad ve açıklama yalnız aday bulmak içindir; "
    "etiketi notun tamamını okuyarak ver."
)


@dataclass(frozen=True)
class NoteEntry:
    note_id: str
    source: str
    name: str
    description: str
    type: str
    chars: int


def _clean_value(raw: str | None) -> str:
    value = (raw or "").strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1].strip()
    return value


def _is_scalar(raw: str | None) -> bool:
    """Liste / çok satırlı gösterim değilse True."""
    value = (raw or "").strip()
    if value in _BLOCK_SCALARS:
        return False
    if value.startswith("[") and value.endswith("]"):
        return False
    if value.startswith("{") and value.endswith("}"):
        return False
    return True


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """YAML frontmatter'ı (alt küme) ayrıştırır; (alanlar, gövde) döner."""
    if text.startswith("﻿"):
        text = text[1:]
    lines = text.split("\n")
    if not lines or lines[0].rstrip() != "---":
        return {}, text
    end = None
    for i in range(1, len(lines)):
        if lines[i].rstrip() == "---":
            end = i
            break
    if end is None:
        return {}, text

    fields: dict[str, str] = {}
    parent: str | None = None
    for raw_line in lines[1:end]:
        line = raw_line.rstrip("\r").rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line[0] in " \t":
            m = _SUBKEY_RE.match(line)
            if m and parent is not None and _is_scalar(m.group(2)):
                value = _clean_value(m.group(2))
                if value:
                    fields[f"{parent}.{m.group(1)}"] = value
            continue
        m = _KEY_RE.match(line)
        if not m:
            parent = None
            continue
        key, raw = m.group(1), m.group(2)
        if raw is None or not raw.strip():
            parent = key
            continue
        parent = None
        if not _is_scalar(raw):
            continue
        value = _clean_value(raw)
        if value:
            fields[key] = value
    body = "\n".join(lines[end + 1:])
    return fields, body


def _squash(text: str) -> str:
    return " ".join(text.split())


def describe(fields: dict[str, str], body: str, max_chars: int = 150) -> str:
    """Tek satırlık açıklama: description alanı, yoksa başlık + gövde başı."""
    desc = fields.get("description", "")
    if desc.strip():
        return _squash(desc)
    heading = ""
    rest: list[str] = []
    found = False
    for line in body.split("\n"):
        if not found:
            m = _HEADING_RE.match(line.rstrip("\r"))
            if m and line.lstrip().startswith("#") and m.group(1).strip():
                heading = m.group(1).strip()
                found = True
                continue
        rest.append(line)
    snippet = _squash(" ".join(rest))[:max_chars].strip()
    if heading:
        heading = _squash(heading)
        return f"{heading} — {snippet}" if snippet else heading
    return snippet


def note_type(fields: dict[str, str]) -> str:
    return fields.get("type") or fields.get("metadata.type") or ""


def build_note_list(corpus_dir: Path) -> list[NoteEntry]:
    manifest_path = corpus_dir / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Manifest bulunamadı: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries: list[NoteEntry] = []
    for item in manifest["files"]:
        source, rel_path = item["source"], item["rel_path"]
        path = corpus_dir / "files" / source / rel_path
        if not path.is_file():
            raise FileNotFoundError(f"Korpus dosyası bulunamadı: {path}")
        text = path.read_text(encoding="utf-8", errors="replace")
        fields, body = parse_frontmatter(text)
        name = fields.get("name") or Path(rel_path).stem
        entries.append(
            NoteEntry(
                note_id=f"{source}/{rel_path}",
                source=source,
                name=name,
                description=describe(fields, body),
                type=note_type(fields),
                chars=len(text),
            )
        )
    entries.sort(key=lambda e: e.note_id)
    return entries


def _cell(value: str) -> str:
    return _squash(value).replace("|", "\\|")


def write_note_list(entries: list[NoteEntry], out_jsonl: Path, out_md: Path) -> None:
    for path in (out_jsonl, out_md):
        if path.exists():
            raise FileExistsError(f"Çıktı zaten var: {path}")
    jsonl = "".join(json.dumps(asdict(e), ensure_ascii=False) + "\n" for e in entries)
    md_lines = [
        "# Jüri not listesi",
        "",
        _MD_INTRO,
        "",
        "| note_id | type | name | description | chars |",
        "| --- | --- | --- | --- | ---: |",
    ]
    for e in entries:
        md_lines.append(
            f"| {_cell(e.note_id)} | {_cell(e.type)} | {_cell(e.name)} "
            f"| {_cell(e.description)} | {e.chars} |"
        )
    md = "\n".join(md_lines) + "\n"
    with open(out_jsonl, "x", encoding="utf-8", newline="\n") as fh:
        fh.write(jsonl)
    try:
        with open(out_md, "x", encoding="utf-8", newline="\n") as fh:
            fh.write(md)
    except FileExistsError:
        out_jsonl.unlink(missing_ok=True)
        raise


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m eval.notelist",
        description="Dondurulmuş korpustan jüri not listesi üretir.",
    )
    parser.add_argument("--version", default="v1", help="korpus sürümü (varsayılan: v1)")
    parser.add_argument("--corpus-dir", type=Path, default=None,
                        help="korpus dizini (varsayılan: eval/data/corpus/<version>)")
    return parser


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass
    parser = _build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return int(exc.code) if isinstance(exc.code, int) else 2
    corpus_dir: Path = args.corpus_dir or (DEFAULT_CORPUS_ROOT / args.version)
    out_jsonl = corpus_dir / "notes.jsonl"
    out_md = corpus_dir / "notes.md"
    try:
        if out_jsonl.exists() or out_md.exists():
            existing = out_jsonl if out_jsonl.exists() else out_md
            raise FileExistsError(f"Çıktı zaten var: {existing}")
        entries = build_note_list(corpus_dir)
        write_note_list(entries, out_jsonl, out_md)
    except (FileNotFoundError, FileExistsError) as exc:
        print(f"Hata: {exc}", file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"Hata: {exc}", file=sys.stderr)
        return 1

    by_source = Counter(e.source for e in entries)
    by_type = Counter(e.type or "(türsüz)" for e in entries)
    print(f"{len(entries)} not listelendi.")
    print("Kaynak başına:")
    for key, count in sorted(by_source.items()):
        print(f"  {key}: {count}")
    print("Tür dağılımı:")
    for key, count in sorted(by_type.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"  {key}: {count}")
    print(f"Yazıldı: {out_jsonl}")
    print(f"Yazıldı: {out_md}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
