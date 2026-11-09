"""Bellek komut satırı arayüzü."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from bellek import __version__


class _ArgumentError(Exception):
    """argparse kullanım hatası (SystemExit yerine)."""

    def __init__(self, message: str, usage: str) -> None:
        super().__init__(message)
        self.message = message
        self.usage = usage


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> Any:  # type: ignore[override]
        raise _ArgumentError(message, self.format_usage())


def _build_parser() -> _Parser:
    parser = _Parser(
        prog="bellek",
        description="Bellek: Claude Code için yerel, oturumlar arası hafıza.",
        add_help=False,
    )
    parser.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    parser.add_argument("--version", action="store_true", help="sürümü göster")
    parser.add_argument("--config", metavar="YOL", default=None, help="ayar dosyasının yolu")
    sub = parser.add_subparsers(dest="command", metavar="KOMUT", parser_class=_Parser)

    paths = sub.add_parser("yollar", help="çözülmüş ayarları ve yolları göster", add_help=False)
    paths.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    paths.add_argument("--json", action="store_true", help="çıktıyı JSON olarak ver")

    doctor = sub.add_parser("doktor", help="kurulum sağlık kontrolü yap", add_help=False)
    doctor.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    doctor.add_argument("--json", action="store_true", help="çıktıyı JSON olarak ver")
    return parser


def _setup_streams() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8")
            except (OSError, ValueError):
                pass


def _dump(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def _cmd_paths(config: Any, as_json: bool) -> int:
    sources = [
        {"name": s.name, "path": str(s.path), "exists": Path(s.path).is_dir()}
        for s in config.sources
    ]
    if as_json:
        _dump(
            {
                "config_path": str(config.config_path),
                "vault": str(config.vault),
                "state_dir": str(config.state_dir),
                "server": {"host": config.server_host, "port": config.server_port},
                "sources": sources,
                "projects": {str(k): v for k, v in config.projects.items()},
            }
        )
        return 0
    sablon = " (şablon; bellek.toml yok)" if getattr(config, "template", False) else ""
    print(f"Ayar dosyası : {config.config_path}{sablon}")
    print(f"Kasa (vault) : {config.vault}")
    print(f"Durum klasörü: {config.state_dir}")
    print(f"Sunucu       : {config.server_host}:{config.server_port}")
    print("Kaynaklar:")
    if not sources:
        print("  (tanımlı kaynak yok)")
    for s in sources:
        mark = "[var]" if s["exists"] else "[yok]"
        print(f"  {mark} {s['name']}: {s['path']}")
    print("Projeler:")
    if not config.projects:
        print("  (tanımlı proje yok)")
    for path, name in config.projects.items():
        print(f"  {name}: {path}")
    return 0


_MARKS = {"ok": "[tamam]", "warn": "[uyarı]", "error": "[hata] "}
_OVERALL = {"ok": "tamam", "warn": "uyarı", "error": "hata"}


def _cmd_doctor(config: Any, as_json: bool) -> int:
    from bellek.doctor import run_checks

    report = run_checks(config)
    status = report.status
    if as_json:
        _dump(
            {
                "status": status,
                "checks": [
                    {"name": c.name, "status": c.status, "detail": c.detail}
                    for c in report.checks
                ],
            }
        )
    else:
        for c in report.checks:
            print(f"{_MARKS.get(c.status, c.status)} {c.name}: {c.detail}")
        print(f"Genel durum: {_OVERALL.get(status, status)}")
    return 1 if status == "error" else 0


def main(argv: list[str] | None = None) -> int:
    _setup_streams()
    parser = _build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:  # yardım (0) veya --version dışı çıkışlar
        return exc.code if isinstance(exc.code, int) else 0
    except _ArgumentError as exc:
        sys.stderr.write(exc.usage)
        sys.stderr.write(f"bellek: hata: {exc.message}\n")
        return 2

    if args.version:
        print(f"bellek {__version__}")
        return 0
    if args.command is None:
        parser.print_help()
        return 0

    from bellek.config import ConfigError, load_config

    try:
        config = load_config(Path(args.config) if args.config else None)
        if args.command == "yollar":
            return _cmd_paths(config, args.json)
        return _cmd_doctor(config, args.json)
    except ConfigError as exc:
        print(f"Ayar hatası: {exc}", file=sys.stderr)
        return 2
