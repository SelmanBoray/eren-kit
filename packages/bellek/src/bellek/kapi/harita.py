"""Büyük bir Markdown belgesinin başlık haritasını (satır aralığı ve boyut) çıkarır.

Yalnız standart kütüphane kullanır; başka bellek modüllerini import etmez.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_HEADING_RE = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+(.*))?$")
_CLOSING_RE = re.compile(r"(?:^|[ \t])#+$")
_FENCE_OPEN_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
_MIN_HEADINGS = 3


@dataclass(frozen=True)
class Baslik:
    seviye: int
    metin: str
    bas: int
    son: int
    karakter: int


def _split_lines(text: str) -> list[str]:
    """Claude Code Read aracıyla uyumlu satır bölme (yalnız '\n', sondaki '\r' atılır)."""
    if not text:
        return []
    parts = text.split("\n")
    if parts[-1] == "":
        parts.pop()
    return [p[:-1] if p.endswith("\r") else p for p in parts]


def _front_matter_end(lines: list[str]) -> int:
    """YAML ön bilgisinin son satırının 0 tabanlı indeksi; yoksa -1."""
    if not lines or lines[0] != "---":
        return -1
    for i in range(1, len(lines)):
        if lines[i] in ("---", "..."):
            return i
    return -1


def _scan(lines: list[str]) -> list[tuple[int, str, int]]:
    """(seviye, metin, 0 tabanlı satır indeksi) listesi."""
    found: list[tuple[int, str, int]] = []
    fence_char = ""
    fence_len = 0
    start = _front_matter_end(lines) + 1
    for idx in range(start, len(lines)):
        line = lines[idx]
        if fence_char:
            stripped = line.lstrip(" ")
            if len(line) - len(stripped) <= 3 and stripped.startswith(fence_char * fence_len):
                if stripped.rstrip(" \t").strip(fence_char) == "":
                    fence_char = ""
            continue
        m = _FENCE_OPEN_RE.match(line)
        if m:
            fence = m.group(1)
            if fence[0] != "`" or "`" not in m.group(2):
                fence_char = fence[0]
                fence_len = len(fence)
                continue
        h = _HEADING_RE.match(line)
        if not h:
            continue
        text = (h.group(2) or "").strip()
        c = _CLOSING_RE.search(text)
        if c:
            text = text[: c.start()].rstrip()
        if text:
            found.append((len(h.group(1)), text, idx))
    return found


def basliklari_cikar(metin: str) -> list[Baslik]:
    lines = _split_lines(metin)
    raw = _scan(lines)
    if not raw:
        return []
    prefix = [0]
    for line in lines:
        prefix.append(prefix[-1] + len(line) + 1)
    total = len(lines)
    ends = [total] * len(raw)
    stack: list[int] = []
    for i, (level, _t, idx) in enumerate(raw):
        while stack and raw[stack[-1]][0] >= level:
            ends[stack.pop()] = idx  # 1 tabanlı son = bu başlığın 0 tabanlı indeksi
        stack.append(i)
    return [
        Baslik(
            seviye=level,
            metin=text,
            bas=idx + 1,
            son=ends[i],
            karakter=prefix[ends[i]] - prefix[idx],
        )
        for i, (level, text, idx) in enumerate(raw)
    ]


_MAX_TITLE = 120


def _clip(text: str) -> str:
    return text if len(text) <= _MAX_TITLE else text[: _MAX_TITLE - 1] + "…"


def _format_size(chars: int) -> str:
    if chars < 1000:
        return f"{chars} kr"
    return f"{chars / 1000:.1f}".replace(".", ",") + " bin kr"


def harita_metni(yol: str, metin: str, *, en_cok_satir: int = 80) -> str | None:
    headings = basliklari_cikar(metin)
    if len(headings) < _MIN_HEADINGS:
        return None
    limit = max(1, en_cok_satir)
    shown = headings
    dropped_levels = False
    while len(shown) > limit and len({h.seviye for h in shown}) > 1:
        deepest = max(h.seviye for h in shown)
        shown = [h for h in shown if h.seviye != deepest]
        dropped_levels = True
    hidden = 0
    if len(shown) > limit:
        hidden = len(shown) - limit
        shown = shown[:limit]

    name = yol.replace("\\", "/").rstrip("/").split("/")[-1] or yol
    total_lines = len(_split_lines(metin))
    out = [
        f"{name} belgesi ({len(metin)} karakter, {total_lines} satır) bu bağlamda ilk kez "
        "açılıyor; içerik yerine başlık haritası döndürülüyor.",
        "Gereken bölümü Read ile `offset=<bas> limit=<son-bas+1>` vererek oku; aradığın "
        "haritada yoksa ya da belgenin tamamı gerçekten gerekiyorsa isteğini tekrarla, "
        "ikinci deneme geçer.",
    ]
    if dropped_levels:
        out.append("(Harita çok uzun olduğu için en derin başlık seviyeleri çıkarıldı.)")
    out.append("Harita:")
    base = min(h.seviye for h in shown)
    for h in shown:
        indent = "  " * (h.seviye - base)
        out.append(f"{indent}- {_clip(h.metin)} — satır {h.bas}-{h.son} (~{_format_size(h.karakter)})")
    if hidden:
        out.append(f"… (+{hidden} başlık daha)")
    return "\n".join(out)
