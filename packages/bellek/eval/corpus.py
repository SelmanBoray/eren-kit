"""Eval korpusu: dondurulmuş anlık görüntü alır ve doğrular.

Hafıza sürekli büyür; eval doğru cevapları (GT) canlı notlara değil, burada
alınan değişmez anlık görüntüye bağlanır.

Kullanım:
    python -m eval.corpus snapshot --version v1 [--out DIR] [--config YOL]
    python -m eval.corpus verify --version v1 [--out DIR]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bellek.config import Config, ConfigError, load_config

VAULT_SOURCE_NAME = "vault"
DEFAULT_OUT_DIR = Path(__file__).resolve().parent / "data" / "corpus"

_VERSION_RE = re.compile(r"[A-Za-z0-9._-]+")
_INDEX_NAME = "MEMORY.md"
_CHUNK = 1024 * 1024
_WHITESPACE = bytes([9, 10, 11, 12, 13, 32])  # ASCII bosluk karakterleri
_BOM = bytes([0xEF, 0xBB, 0xBF])


def _is_link(entry: os.DirEntry[str]) -> bool:
    """Sembolik bağ veya junction mu?"""
    try:
        return entry.is_symlink() or os.path.isjunction(entry.path)
    except OSError:
        return True


def _is_blank(path: Path) -> bool:
    """Dosya 0 bayt, yalnız ASCII boşluk ya da tek başına UTF-8 BOM mu? (okunamazsa False)"""
    try:
        with open(path, "rb") as fh:
            first = True
            while chunk := fh.read(_CHUNK):
                if first:
                    first = False
                    if chunk.startswith(_BOM):
                        chunk = chunk[len(_BOM):]
                if chunk.strip(_WHITESPACE):
                    return False
    except OSError:
        return False
    return True


def _scan(root: Path, prefix: str, out: list[tuple[str, Path]]) -> None:
    try:
        entries = list(os.scandir(root))
    except OSError:
        return
    for entry in entries:
        if entry.name.startswith(".") or _is_link(entry):
            continue
        rel = f"{prefix}{entry.name}"
        try:
            if entry.is_dir(follow_symlinks=False):
                _scan(Path(entry.path), rel + "/", out)
            elif entry.is_file(follow_symlinks=False):
                if entry.name.lower().endswith(".md") and rel != _INDEX_NAME:
                    if not _is_blank(Path(entry.path)):
                        out.append((rel, Path(entry.path)))
        except OSError:
            continue


def iter_corpus_files(config: Config) -> list[tuple[str, Path, str]]:
    """Korpusa girecek dosyalar: (kaynak_adı, mutlak_yol, göreli_yol_posix)."""
    roots: list[tuple[str, Path]] = [(VAULT_SOURCE_NAME, Path(config.vault))]
    roots.extend((s.name, Path(s.path)) for s in config.sources)
    result: list[tuple[str, Path, str]] = []
    for name, root in roots:
        if not root.is_dir():
            continue
        found: list[tuple[str, Path]] = []
        _scan(root, "", found)
        found.sort(key=lambda item: item[0])
        result.extend((name, path, rel) for rel, path in found)
    return result


def iter_index_files(config: Config) -> list[tuple[str, Path]]:
    """Kaynak köklerindeki MEMORY.md dosyaları (S0 için): (kaynak_adı, mutlak_yol)."""
    roots: list[tuple[str, Path]] = [(VAULT_SOURCE_NAME, Path(config.vault))]
    roots.extend((s.name, Path(s.path)) for s in config.sources)
    result: list[tuple[str, Path]] = []
    for name, root in roots:
        if not root.is_dir():
            continue
        path = root / _INDEX_NAME
        try:
            if path.is_symlink() or os.path.isjunction(path) or not path.is_file():
                continue
        except OSError:
            continue
        result.append((name, path))
    return result


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        while chunk := fh.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def _check_version(version: str) -> None:
    if not _VERSION_RE.fullmatch(version):
        raise ValueError(
            f"Geçersiz sürüm adı: {version!r} (yalnız harf, rakam, '.', '_' ve '-' olabilir)"
        )


def snapshot(config: Config, version: str, out_dir: Path) -> dict[str, Any]:
    """Anlık görüntü alır; sürüm zaten varsa FileExistsError."""
    _check_version(version)
    out_dir = Path(out_dir)
    final_dir = out_dir / version
    if final_dir.exists():
        raise FileExistsError(f"Sürüm zaten var, dondurulmuş sürüm ezilmez: {final_dir}")

    roots: list[tuple[str, Path]] = [(VAULT_SOURCE_NAME, Path(config.vault))]
    roots.extend((s.name, Path(s.path)) for s in config.sources)
    names = [n for n, _ in roots]
    if len(set(names)) != len(names):
        raise ValueError("Kaynak adları benzersiz olmalı ('vault' adı ayrılmıştır)")
    for n in names:
        if "/" in n or "\\" in n or n in (".", ".."):
            raise ValueError(f"Geçersiz kaynak adı: {n!r}")

    files = iter_corpus_files(config)
    index_files = iter_index_files(config)

    # Yarım kalmış bir sürüm bırakmamak için önce geçici klasöre yazılır.
    tmp_dir = out_dir / f".{version}.tmp"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    files_root = tmp_dir / "files"
    files_root.mkdir(parents=True)
    index_root = tmp_dir / "index"
    try:
        entries: list[dict[str, Any]] = []
        counts: dict[str, int] = {n: 0 for n in names}
        total_bytes = 0
        for source, abs_path, rel in files:
            dest = files_root / source / Path(*rel.split("/"))
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(abs_path, dest)
            size = dest.stat().st_size
            entries.append(
                {"source": source, "rel_path": rel, "sha256": _sha256(dest), "size": size}
            )
            counts[source] += 1
            total_bytes += size

        index_entries: list[dict[str, Any]] = []
        for source, abs_path in index_files:
            dest = index_root / source / _INDEX_NAME
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(abs_path, dest)
            index_entries.append(
                {
                    "source": source,
                    "rel_path": _INDEX_NAME,
                    "sha256": _sha256(dest),
                    "size": dest.stat().st_size,
                }
            )
        indexed = {e["source"] for e in index_entries}

        manifest: dict[str, Any] = {
            "version": version,
            "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sources": [
                {
                    "name": n,
                    "path": str(p),
                    "exists": Path(p).is_dir(),
                    "files": counts[n],
                    "index": n in indexed,
                }
                for n, p in roots
            ],
            "files": entries,
            "index_files": index_entries,
            "total_files": len(entries),
            "total_bytes": total_bytes,
        }
        (tmp_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        if final_dir.exists():
            raise FileExistsError(f"Sürüm zaten var, dondurulmuş sürüm ezilmez: {final_dir}")
        tmp_dir.rename(final_dir)
    except BaseException:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
    return manifest


def verify(version: str, out_dir: Path) -> list[str]:
    """Anlık görüntüyü doğrular; sorunları Türkçe satırlar olarak döner."""
    _check_version(version)
    version_dir = Path(out_dir) / version
    manifest_path = version_dir / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Manifest bulunamadı: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    problems: list[str] = []
    files_root = version_dir / "files"
    expected: set[str] = set()
    for item in manifest.get("files", []):
        key = f"{item['source']}/{item['rel_path']}"
        expected.add(key)
        path = files_root / item["source"] / Path(*item["rel_path"].split("/"))
        if not path.is_file():
            problems.append(f"Eksik dosya: {key}")
            continue
        actual = _sha256(path)
        if actual != item["sha256"]:
            problems.append(
                f"Hash uyuşmazlığı: {key} (beklenen {item['sha256'][:12]}…, bulunan {actual[:12]}…)"
            )

    if files_root.is_dir():
        for dirpath, _dirs, filenames in os.walk(files_root):
            for fname in filenames:
                rel = Path(dirpath, fname).relative_to(files_root).as_posix()
                if rel not in expected:
                    problems.append(f"Manifest'te olmayan fazla dosya: {rel}")

    index_root = version_dir / "index"
    expected_index: set[str] = set()
    for item in manifest.get("index_files", []):
        key = f"{item['source']}/{item['rel_path']}"
        expected_index.add(key)
        path = index_root / item["source"] / Path(*item["rel_path"].split("/"))
        if not path.is_file():
            problems.append(f"Eksik indeks dosyası: {key}")
            continue
        actual = _sha256(path)
        if actual != item["sha256"]:
            problems.append(
                f"İndeks hash uyuşmazlığı: {key} (beklenen {item['sha256'][:12]}…, bulunan {actual[:12]}…)"
            )
    if index_root.is_dir():
        for dirpath, _dirs, filenames in os.walk(index_root):
            for fname in filenames:
                rel = Path(dirpath, fname).relative_to(index_root).as_posix()
                if rel not in expected_index:
                    problems.append(f"Manifest'te olmayan fazla indeks dosyası: {rel}")
    return problems


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
        prog="python -m eval.corpus",
        description="Eval korpusu: dondurulmuş anlık görüntü al ve doğrula.",
        add_help=False,
    )
    parser.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    sub = parser.add_subparsers(dest="command", metavar="KOMUT", parser_class=_Parser)

    snap = sub.add_parser("snapshot", help="anlık görüntü al", add_help=False)
    snap.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    snap.add_argument("--version", required=True, metavar="V", help="sürüm adı")
    snap.add_argument("--out", metavar="DIR", default=None, help="çıktı klasörü")
    snap.add_argument("--config", metavar="YOL", default=None, help="ayar dosyasının yolu")

    ver = sub.add_parser("verify", help="anlık görüntüyü doğrula", add_help=False)
    ver.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    ver.add_argument("--version", required=True, metavar="V", help="sürüm adı")
    ver.add_argument("--out", metavar="DIR", default=None, help="çıktı klasörü")
    return parser


def _setup_streams() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8")
            except (OSError, ValueError):
                pass


def _err(text: str) -> None:
    print(text, file=sys.stderr)


def _cmd_snapshot(args: argparse.Namespace) -> int:
    out_dir = Path(args.out) if args.out else DEFAULT_OUT_DIR
    try:
        config = load_config(Path(args.config) if args.config else None)
    except ConfigError as exc:
        _err(f"Ayar hatası: {exc}")
        return 2
    try:
        manifest = snapshot(config, args.version, out_dir)
    except FileExistsError as exc:
        _err(f"Hata: {exc}")
        return 1
    except ValueError as exc:
        _err(f"Hata: {exc}")
        return 1
    print(f"Anlık görüntü alındı: sürüm {manifest['version']}")
    for src in manifest["sources"]:
        note = "" if src["exists"] else " (klasör yok, atlandı)"
        idx = ", indeks var" if src.get("index") else ""
        print(f"  {src['name']:<12}: {src['files']} dosya{idx}{note}")
    print(f"Toplam       : {manifest['total_files']} dosya, {manifest['total_bytes']} bayt")
    print(f"Çıktı        : {out_dir / args.version}")
    return 0


def _cmd_verify(args: argparse.Namespace) -> int:
    out_dir = Path(args.out) if args.out else DEFAULT_OUT_DIR
    try:
        problems = verify(args.version, out_dir)
    except FileNotFoundError as exc:
        _err(f"Hata: {exc}")
        return 1
    except ValueError as exc:
        _err(f"Hata: {exc}")
        return 1
    if problems:
        for line in problems:
            print(line)
        return 1
    manifest = json.loads((out_dir / args.version / "manifest.json").read_text(encoding="utf-8"))
    print(f"Doğrulandı: sürüm {args.version}, {manifest['total_files']} dosya, sorun yok.")
    return 0


def main(argv: list[str] | None = None) -> int:
    _setup_streams()
    parser = _build_parser()
    try:
        args = parser.parse_args(argv)
    except _ArgumentError as exc:
        _err(exc.usage.rstrip())
        _err(f"Kullanım hatası: {exc.message}")
        return 2
    except SystemExit as exc:  # --help
        return exc.code if isinstance(exc.code, int) else 0
    if args.command == "snapshot":
        return _cmd_snapshot(args)
    if args.command == "verify":
        return _cmd_verify(args)
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
