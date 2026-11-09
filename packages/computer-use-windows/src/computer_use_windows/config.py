"""Runtime configuration: CLI flags > environment variables > defaults.

Range and format errors always raise ``ValueError`` (naming the flag or env var), whatever the
source. Malformed CLI syntax (unknown flag, missing argument) is argparse's own exit.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass

_TRUE = frozenset({"1", "true", "yes", "on"})
_FALSE = frozenset({"0", "false", "no", "off"})
_FORMATS = ("png", "jpeg")


@dataclass(frozen=True)
class Config:
    max_size: int = 1280  # long-edge cap for screenshot/zoom images, px; valid 256..4096
    max_image_tokens: int = 1568  # visual-token cap per image; valid 100..4784
    image_format: str = "png"  # "png" | "jpeg"
    jpeg_quality: int = 80  # 1..95
    monitor: int | None = None  # default monitor for screenshot; None = primary; 1-based
    max_elements: int = 80  # cap for elements listing; valid 1..500
    blocked_processes: tuple[str, ...] = ()  # e.g. ("keepass.exe", "1password")
    failsafe: bool = True
    allow_terminal_input: bool = False  # allow type_text/key when a terminal window is in front


def _parse_int(raw: str, label: str, lo: int, hi: int | None) -> int:
    rng = f"{lo}..{hi}" if hi is not None else f">= {lo}"
    try:
        value = int(raw.strip())
    except (TypeError, ValueError, AttributeError):
        raise ValueError(f"{label}: {raw!r} is not an integer (allowed: {rng})") from None
    if value < lo or (hi is not None and value > hi):
        raise ValueError(f"{label}: {value} is out of range (allowed: {rng})")
    return value


def _parse_format(raw: str, label: str) -> str:
    value = raw.strip().lower()
    if value not in _FORMATS:
        raise ValueError(f"{label}: {raw!r} is not valid (allowed: png, jpeg)")
    return value


def _parse_bool(raw: str, label: str) -> bool:
    value = raw.strip().lower()
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    raise ValueError(f"{label}: {raw!r} is not a boolean (allowed: 1/true/yes/on, 0/false/no/off)")


def _normalize_blocks(values: list[str]) -> tuple[str, ...]:
    seen: dict[str, None] = {}
    for item in values:
        for part in item.split(","):
            name = part.strip().lower()
            if name:
                seen.setdefault(name, None)
    return tuple(seen)


def _version() -> str:
    from . import __version__

    return __version__


class _VersionAction(argparse.Action):
    """Like argparse's version action, but imports the version only when --version is used."""

    def __init__(self, option_strings: list[str], dest: str, **kwargs: object) -> None:
        super().__init__(option_strings, dest, nargs=0, help="show version and exit")

    def __call__(
        self,
        parser: argparse.ArgumentParser,
        namespace: argparse.Namespace,
        values: object,
        option_string: str | None = None,
    ) -> None:
        sys.stdout.write(f"{parser.prog} {_version()}\n")
        parser.exit()


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="computer-use-windows",
        description="MCP server (stdio) giving terminal coding agents computer use on Windows.",
        allow_abbrev=False,
    )
    parser.add_argument("--version", action=_VersionAction)
    parser.add_argument("--max-size", metavar="N", help="long-edge cap for images, 256..4096")
    parser.add_argument("--max-image-tokens", metavar="N", help="image token cap, 100..4784")
    parser.add_argument("--format", dest="image_format", metavar="FMT", help="png or jpeg")
    parser.add_argument("--jpeg-quality", metavar="N", help="JPEG quality, 1..95")
    parser.add_argument("--monitor", metavar="N", help="default monitor for screenshot (1-based)")
    parser.add_argument("--max-elements", metavar="N", help="cap for elements listing, 1..500")
    parser.add_argument(
        "--block",
        action="append",
        metavar="NAME",
        help="process the agent must not touch (repeatable, comma-separated allowed)",
    )
    parser.add_argument("--no-failsafe", action="store_true", help="disable the corner failsafe")
    parser.add_argument(
        "--allow-terminal-input",
        action="store_true",
        help="allow type_text/key while a terminal window is in front",
    )
    return parser


def load_config(argv: list[str] | None = None, env: Mapping[str, str] | None = None) -> Config:
    """Build a Config. Precedence: CLI > env > defaults. Invalid values raise ValueError."""
    args = _build_parser().parse_args(sys.argv[1:] if argv is None else argv)
    environ: Mapping[str, str] = os.environ if env is None else env

    def pick(cli: str | None, var: str) -> tuple[str, str] | None:
        """Return (raw value, label) from CLI if given, else env if non-empty, else None."""
        if cli is not None:
            return cli, "--" + var.removeprefix("CUW_").lower().replace("_", "-")
        raw = environ.get(var)
        if raw is not None and raw.strip() != "":
            return raw, var
        return None

    defaults = Config()
    max_size = defaults.max_size
    max_image_tokens = defaults.max_image_tokens
    image_format = defaults.image_format
    jpeg_quality = defaults.jpeg_quality
    monitor = defaults.monitor
    max_elements = defaults.max_elements

    if (p := pick(args.max_size, "CUW_MAX_SIZE")) is not None:
        max_size = _parse_int(p[0], p[1], 256, 4096)
    if (p := pick(args.max_image_tokens, "CUW_MAX_IMAGE_TOKENS")) is not None:
        max_image_tokens = _parse_int(p[0], p[1], 100, 4784)
    if (p := pick(args.image_format, "CUW_FORMAT")) is not None:
        image_format = _parse_format(p[0], p[1])
    if (p := pick(args.jpeg_quality, "CUW_JPEG_QUALITY")) is not None:
        jpeg_quality = _parse_int(p[0], p[1], 1, 95)
    if (p := pick(args.monitor, "CUW_MONITOR")) is not None:
        monitor = _parse_int(p[0], p[1], 1, None)
    if (p := pick(args.max_elements, "CUW_MAX_ELEMENTS")) is not None:
        max_elements = _parse_int(p[0], p[1], 1, 500)

    # CLI --block replaces the env list entirely (CLI > env).
    if args.block is not None:
        blocked = _normalize_blocks(args.block)
    else:
        blocked = _normalize_blocks([environ.get("CUW_BLOCK", "")])

    failsafe = defaults.failsafe
    if args.no_failsafe:
        failsafe = False
    else:
        raw = environ.get("CUW_FAILSAFE")
        if raw is not None and raw.strip() != "":
            failsafe = _parse_bool(raw, "CUW_FAILSAFE")

    allow_terminal_input = defaults.allow_terminal_input
    if args.allow_terminal_input:
        allow_terminal_input = True
    else:
        raw = environ.get("CUW_ALLOW_TERMINAL_INPUT")
        if raw is not None and raw.strip() != "":
            allow_terminal_input = _parse_bool(raw, "CUW_ALLOW_TERMINAL_INPUT")

    return Config(
        max_size=max_size,
        max_image_tokens=max_image_tokens,
        image_format=image_format,
        jpeg_quality=jpeg_quality,
        monitor=monitor,
        max_elements=max_elements,
        blocked_processes=blocked,
        failsafe=failsafe,
        allow_terminal_input=allow_terminal_input,
    )
