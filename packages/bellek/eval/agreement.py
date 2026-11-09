"""Jüri dosyası doğrulama ve jüriler arası uyum ölçümü (PROTOCOL.md §6).

İki bağımsız jürinin (A, B) etiket dosyalarını şemaya, sorgu setine (batch
dosyalarındaki qid'ler) ve not kimliklerine (notes.jsonl) karşı doğrular;
hakemden önce ham etiketlerle doğrusal ağırlıklı Cohen κ_w, ham uyum, pozitif
özgül uyum (PSA) ve sorgu düzeyinde negatiflik κ'sını hesaplar.

Prompt metni okunmaz ve basılmaz: batch dosyalarından yalnız `qid` alınır,
ekrana yalnız qid, not kimliği ve sayılar çıkar.

Kullanım:
    python -m eval.agreement --a JURI_A --b JURI_B --notes NOTES_JSONL --batches KLASÖR [--out YOL]

Çıkış kodları: 0 doğrulama temiz ve eşik geçti; 3 doğrulama temiz ama eşik
geçilmedi; 1 doğrulama hatası ya da girdi/çıktı hatası; 2 argüman hatası.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Any

GRADES: tuple[int, ...] = (0, 1, 2)
THRESHOLD: dict[str, float] = {"kappa_w": 0.60, "neg_kappa": 0.60}
# Eşik karşılaştırması tam kesirle yapılır (kayan nokta yuvarlaması 0,5999… ile 0,60'ı karıştırmasın).
_THRESHOLD_EXACT: dict[str, Fraction] = {"kappa_w": Fraction(3, 5), "neg_kappa": Fraction(3, 5)}

_REQUIRED_FIELDS: tuple[tuple[str, type], ...] = (
    ("qid", str),
    ("juror", str),
    ("contentless", bool),
    ("labels", list),
    ("read", list),
)
_OPTIONAL_FIELDS: tuple[tuple[str, type], ...] = (
    ("model", str),
    ("rubric", str),
    ("batch", int),
    ("comment", str),
)
_TYPE_NAMES: dict[type, str] = {str: "str", bool: "bool", int: "int", list: "list"}

EXIT_OK = 0
EXIT_INVALID = 1
EXIT_USAGE = 2
EXIT_BELOW_THRESHOLD = 3


@dataclass(frozen=True)
class JurorRow:
    qid: str
    juror: str
    contentless: bool
    grades: Mapping[str, int]
    whys: Mapping[str, str]
    read: tuple[str, ...]


# --------------------------------------------------------------------------- doğrulama


def _json_type(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "str"
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "nesne"
    return type(value).__name__


def _has_type(value: Any, expected: type) -> bool:
    if expected is int:
        return isinstance(value, int) and not isinstance(value, bool)
    return isinstance(value, expected)


def _is_valid_grade(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value in (1, 2)


def _show(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return repr(value)


def _read_lines(path: Path) -> list[tuple[int, str | None]]:
    """Dosyayı satır satır çözer: (satır no, metin; UTF-8 hatasında None). BOM yok sayılır."""
    data = path.read_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    lines: list[tuple[int, str | None]] = []
    for number, raw in enumerate(data.split(b"\n"), start=1):
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            lines.append((number, None))
            continue
        lines.append((number, text.strip()))
    return lines


def _parse_row(obj: dict[str, Any], note_ids: set[str]) -> tuple[JurorRow | None, list[str]]:
    """Tek jüri satırını doğrular; (satır hatasızsa JurorRow, hata mesajları)."""
    problems: list[str] = []
    for name, expected in _REQUIRED_FIELDS:
        if name not in obj:
            problems.append(f"zorunlu alan eksik: {name}")
        elif not _has_type(obj[name], expected):
            problems.append(
                f"{name} {_TYPE_NAMES[expected]} olmalı (bulunan: {_json_type(obj[name])})"
            )
    for name, expected in _OPTIONAL_FIELDS:
        if name in obj and not _has_type(obj[name], expected):
            problems.append(
                f"{name} {_TYPE_NAMES[expected]} olmalı (bulunan: {_json_type(obj[name])})"
            )

    read = obj.get("read")
    read_ok = isinstance(read, list)
    read_set: set[str] = set()
    if isinstance(read, list):
        for index, item in enumerate(read, start=1):
            if isinstance(item, str):
                read_set.add(item)
            else:
                read_ok = False
                problems.append(f"read[{index}] str olmalı (bulunan: {_json_type(item)})")

    grades: dict[str, int] = {}
    whys: dict[str, str] = {}
    labeled: set[str] = set()
    labels = obj.get("labels")
    if isinstance(labels, list):
        for index, label in enumerate(labels, start=1):
            where = f"labels[{index}]"
            if not isinstance(label, dict):
                problems.append(f"{where} nesne olmalı (bulunan: {_json_type(label)})")
                continue
            note = label.get("note")
            note_ok = isinstance(note, str)
            if not note_ok:
                problems.append(f"{where}: note eksik ya da str değil")
            grade = label.get("grade")
            grade_ok = _is_valid_grade(grade)
            if "grade" not in label:
                problems.append(f"{where}: grade eksik")
            elif not grade_ok:
                problems.append(
                    f"{where}: grade 1 ya da 2 olmalı (bulunan: {_show(grade)}); "
                    "0 yazılmaz, listelenmeyen not 0'dır"
                )
            why = label.get("why")
            why_ok = isinstance(why, str) and bool(why.strip())
            if "why" not in label:
                problems.append(f"{where}: why eksik")
            elif not isinstance(why, str):
                problems.append(f"{where}: why str olmalı (bulunan: {_json_type(why)})")
            elif not why_ok:
                problems.append(f"{where}: why boş")
            if not note_ok:
                continue
            assert isinstance(note, str)
            if note not in note_ids:
                problems.append(f"{where}: not, not listesinde yok: {note}")
            if note in labeled:
                problems.append(f"{where}: aynı not bu satırda ikinci kez etiketlenmiş: {note}")
                continue
            labeled.add(note)
            if read_ok and note not in read_set:
                problems.append(f"{where}: etiketli not read'de yok (R1 ihlali): {note}")
            if grade_ok and why_ok:
                assert isinstance(grade, int) and isinstance(why, str)
                grades[note] = grade
                whys[note] = why

    if obj.get("contentless") is True and isinstance(labels, list) and labels:
        problems.append("contentless true iken labels boş olmalı (R2)")

    if problems:
        return None, problems
    row = JurorRow(
        qid=obj["qid"],
        juror=obj["juror"],
        contentless=obj["contentless"],
        grades=grades,
        whys=whys,
        read=tuple(obj["read"]),
    )
    return row, []


def load_juror(
    path: Path, expected_qids: set[str], note_ids: set[str]
) -> tuple[dict[str, JurorRow], list[str]]:
    """Jüri JSONL dosyasını doğrular; (geçerli satırlar qid → row, Türkçe hata listesi).

    Hatalı satır sonuca girmez. Bir qid birden çok satırda görülürse o qid'in hiçbir
    satırı sayılmaz (hangisinin geçerli olduğu belirsizdir). Boş satırlar yok sayılır.
    "Eksik qid" dosyada hiç görülmeyen beklenen qid'lerdir; görülüp hatalı olan satır
    kendi hatasıyla raporlanır, ayrıca eksik sayılmaz.
    """
    errors: list[str] = []
    try:
        lines = _read_lines(path)
    except OSError as exc:
        return {}, [f"dosya okunamadı: {path} ({exc.strerror or exc})"]

    expected = set(expected_qids)
    candidates: list[tuple[str, JurorRow | None]] = []
    seen: dict[str, list[int]] = {}
    for number, text in lines:
        if text is None:
            errors.append(f"satır {number}: UTF-8 olarak çözülemedi")
            continue
        if not text:
            continue
        try:
            obj = json.loads(text)
        except json.JSONDecodeError as exc:
            errors.append(f"satır {number}: JSON değil ({exc.msg}, sütun {exc.colno})")
            continue
        if not isinstance(obj, dict):
            errors.append(f"satır {number}: JSON nesnesi değil (bulunan: {_json_type(obj)})")
            continue
        qid = obj.get("qid")
        prefix = f"satır {number} ({qid})" if isinstance(qid, str) else f"satır {number}"
        row, problems = _parse_row(obj, note_ids)
        errors.extend(f"{prefix}: {problem}" for problem in problems)
        if not isinstance(qid, str):
            continue
        if qid not in expected:
            errors.append(f"{prefix}: qid sorgu setinde (batch dosyalarında) yok")
            row = None
        previous = seen.get(qid)
        if previous:
            errors.append(
                f"{prefix}: qid tekrar ediyor (ilk: satır {previous[0]}); "
                "bu qid'in hiçbir satırı sayılmaz"
            )
        seen.setdefault(qid, []).append(number)
        candidates.append((qid, row))

    rows: dict[str, JurorRow] = {}
    for qid, row in candidates:
        if row is not None and len(seen[qid]) == 1:
            rows[qid] = row

    missing = sorted(expected - set(seen))
    if missing:
        errors.append(f"eksik qid ({len(missing)}): {', '.join(missing)}")
    return rows, errors


# --------------------------------------------------------------------------- ölçüler


def pair_grades(
    a: dict[str, JurorRow], b: dict[str, JurorRow], note_ids: set[str]
) -> list[tuple[str, str, int, int]]:
    """İki jüride de bulunan qid'ler × note_ids (sıralı) için (qid, not, g_a, g_b); listelenmeyen 0."""
    notes = sorted(note_ids)
    pairs: list[tuple[str, str, int, int]] = []
    for qid in sorted(a.keys() & b.keys()):
        grades_a = a[qid].grades
        grades_b = b[qid].grades
        for note in notes:
            pairs.append((qid, note, grades_a.get(note, 0), grades_b.get(note, 0)))
    return pairs


def _kappa_exact(pairs: list[tuple[Any, Any]], categories: tuple[Any, ...]) -> Fraction | None:
    """Doğrusal ağırlıklı κ'yı tam kesirle hesaplar; tanımsızsa None.

    w_ij = 1 − |i − j| / (k − 1) (i, j kategorilerin sıra indisleri);
    p_o = Σ w_ij·o_ij, p_e = Σ w_ij·a_i·b_j; κ_w = (p_o − p_e) / (1 − p_e).
    k = 2'de ağırlık birim matristir, sonuç sıradan Cohen κ'dır.
    """
    index: dict[Any, int] = {}
    for position, category in enumerate(categories):
        if category in index:
            raise ValueError(f"kategori iki kez verilmiş: {category!r}")
        index[category] = position
    k = len(categories)
    counts = [[0] * k for _ in range(k)]
    for left, right in pairs:
        if left not in index or right not in index:
            raise ValueError(f"kategori dışı değer: ({left!r}, {right!r}); kategoriler: {categories!r}")
        counts[index[left]][index[right]] += 1
    n = len(pairs)
    if n == 0 or k < 2:
        return None
    row_totals = [sum(counts[i]) for i in range(k)]
    col_totals = [sum(counts[i][j] for i in range(k)) for j in range(k)]
    observed = Fraction(0)
    chance = Fraction(0)
    for i in range(k):
        for j in range(k):
            weight = 1 - Fraction(abs(i - j), k - 1)
            observed += weight * counts[i][j]
            chance += weight * row_totals[i] * col_totals[j]
    p_o = observed / n
    p_e = chance / (n * n)
    if p_e == 1:
        return None
    return (p_o - p_e) / (1 - p_e)


def weighted_kappa(
    pairs: list[tuple[int, int]], categories: tuple[int, ...] = GRADES
) -> float | None:
    """Doğrusal ağırlıklı Cohen κ_w (PROTOCOL §6). p_e == 1 (tek kategori) ya da çift yoksa None."""
    value = _kappa_exact(pairs, categories)
    return None if value is None else float(value)


def cohen_kappa(pairs: list[tuple[bool, bool]]) -> float | None:
    """İkili Cohen κ. p_e == 1 ya da çift yoksa None."""
    value = _kappa_exact([(bool(x), bool(y)) for x, y in pairs], (False, True))
    return None if value is None else float(value)


def _ratio(numerator: int, denominator: int) -> float | None:
    return None if denominator == 0 else numerator / denominator


def _negatives(
    pairs: list[tuple[str, str, int, int]], qids: list[str]
) -> list[tuple[bool, bool]]:
    positive_a = {qid for qid, _, grade_a, _ in pairs if grade_a >= 1}
    positive_b = {qid for qid, _, _, grade_b in pairs if grade_b >= 1}
    return [(qid not in positive_a, qid not in positive_b) for qid in qids]


def agreement(
    a: dict[str, JurorRow], b: dict[str, JurorRow], note_ids: set[str]
) -> dict[str, Any]:
    """Hakemden önce A ve B ham etiketleriyle uyum ölçüleri (PROTOCOL §6 tablosu)."""
    common = sorted(a.keys() & b.keys())
    pairs = pair_grades(a, b, note_ids)
    graded = [(grade_a, grade_b) for _, _, grade_a, grade_b in pairs]

    kappa_w = _kappa_exact(graded, GRADES)
    same_all = sum(1 for x, y in graded if x == y)
    either = [(x, y) for x, y in graded if x >= 1 or y >= 1]
    same_pos = sum(1 for x, y in either if x == y)
    a_pos = sum(1 for x, _ in graded if x >= 1)
    b_pos = sum(1 for _, y in graded if y >= 1)
    both_pos = sum(1 for x, y in graded if x >= 1 and y >= 1)

    negatives = _negatives(pairs, common)
    neg_kappa = _kappa_exact(negatives, (False, True))
    neg_same = sum(1 for x, y in negatives if x == y)
    contentless_same = sum(1 for qid in common if a[qid].contentless == b[qid].contentless)

    passed = (
        kappa_w is not None
        and neg_kappa is not None
        and kappa_w >= _THRESHOLD_EXACT["kappa_w"]
        and neg_kappa >= _THRESHOLD_EXACT["neg_kappa"]
    )
    return {
        "n_queries": len(common),
        "n_pairs": len(pairs),
        "kappa_w": None if kappa_w is None else float(kappa_w),
        "raw_all": _ratio(same_all, len(graded)),
        "raw_pos": _ratio(same_pos, len(either)),
        "psa": _ratio(2 * both_pos, a_pos + b_pos),
        "neg_kappa": None if neg_kappa is None else float(neg_kappa),
        "neg_raw": _ratio(neg_same, len(negatives)),
        "a_pos_pairs": a_pos,
        "b_pos_pairs": b_pos,
        "contentless_agree": _ratio(contentless_same, len(common)),
        "threshold": dict(THRESHOLD),
        "passed": passed,
    }


def disagreements(
    a: dict[str, JurorRow], b: dict[str, JurorRow], note_ids: set[str]
) -> list[dict[str, Any]]:
    """Hakeme gidecek ayrışmalar: önce grade'i farklı çiftler (qid, not sırasıyla),
    ardından contentless kararı farklı sorgular (qid sırasıyla, "note": None)."""
    result: list[dict[str, Any]] = []
    for qid, note, grade_a, grade_b in pair_grades(a, b, note_ids):
        if grade_a != grade_b:
            result.append({
                "qid": qid,
                "note": note,
                "grades": [grade_a, grade_b],
                "whys": [a[qid].whys.get(note, ""), b[qid].whys.get(note, "")],
            })
    for qid in sorted(a.keys() & b.keys()):
        if a[qid].contentless != b[qid].contentless:
            result.append({
                "qid": qid,
                "note": None,
                "contentless": [a[qid].contentless, b[qid].contentless],
            })
    return result


def _confusion(pairs: list[tuple[str, str, int, int]]) -> list[list[int]]:
    matrix = [[0] * len(GRADES) for _ in GRADES]
    for _, _, grade_a, grade_b in pairs:
        matrix[GRADES.index(grade_a)][GRADES.index(grade_b)] += 1
    return matrix


# --------------------------------------------------------------------------- girdi dosyaları


class _InputError(Exception):
    pass


def _iter_json_objects(path: Path) -> list[tuple[int, dict[str, Any]]]:
    try:
        lines = _read_lines(path)
    except OSError as exc:
        raise _InputError(f"dosya okunamadı: {path} ({exc.strerror or exc})") from exc
    objects: list[tuple[int, dict[str, Any]]] = []
    for number, text in lines:
        if text is None:
            raise _InputError(f"{path} satır {number}: UTF-8 olarak çözülemedi")
        if not text:
            continue
        try:
            obj = json.loads(text)
        except json.JSONDecodeError as exc:
            raise _InputError(f"{path} satır {number}: JSON değil ({exc.msg})") from exc
        if not isinstance(obj, dict):
            raise _InputError(f"{path} satır {number}: JSON nesnesi değil")
        objects.append((number, obj))
    return objects


def load_note_ids(path: Path) -> set[str]:
    """notes.jsonl'dan not kimliklerini okur (her satırda `note_id`)."""
    if not path.is_file():
        raise _InputError(f"not listesi bulunamadı: {path}")
    note_ids: set[str] = set()
    for number, obj in _iter_json_objects(path):
        note_id = obj.get("note_id")
        if not isinstance(note_id, str) or not note_id:
            raise _InputError(f"{path} satır {number}: note_id eksik ya da str değil")
        if note_id in note_ids:
            raise _InputError(f"{path} satır {number}: note_id tekrar ediyor: {note_id}")
        note_ids.add(note_id)
    if not note_ids:
        raise _InputError(f"not listesi boş: {path}")
    return note_ids


def load_expected_qids(directory: Path) -> set[str]:
    """Klasördeki `batch-*.jsonl` dosyalarının qid'lerini toplar (metin okunmaz)."""
    if not directory.is_dir():
        raise _InputError(f"batch klasörü bulunamadı: {directory}")
    files = sorted(directory.glob("batch-*.jsonl"))
    if not files:
        raise _InputError(f"batch klasöründe batch-*.jsonl yok: {directory}")
    origin: dict[str, str] = {}
    for path in files:
        for number, obj in _iter_json_objects(path):
            qid = obj.get("qid")
            if not isinstance(qid, str) or not qid:
                raise _InputError(f"{path.name} satır {number}: qid eksik ya da str değil")
            if qid in origin:
                raise _InputError(
                    f"{path.name} satır {number}: qid {qid} başka batch'te de var ({origin[qid]})"
                )
            origin[qid] = f"{path.name} satır {number}"
    if not origin:
        raise _InputError(f"batch dosyalarında hiç qid yok: {directory}")
    return set(origin)


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
    parser = _Parser(
        prog="python -m eval.agreement",
        description="İki jüri dosyasını doğrular ve jüriler arası uyumu ölçer (PROTOCOL.md §6).",
        add_help=False,
    )
    parser.add_argument("-h", "--help", action="help", help="bu yardım metnini göster")
    parser.add_argument("--a", metavar="YOL", type=Path, required=True, help="jüri A JSONL dosyası")
    parser.add_argument("--b", metavar="YOL", type=Path, required=True, help="jüri B JSONL dosyası")
    parser.add_argument("--notes", metavar="YOL", type=Path, required=True,
                        help="not listesi notes.jsonl (her satırda note_id)")
    parser.add_argument("--batches", metavar="KLASÖR", type=Path, required=True,
                        help="batch-*.jsonl dosyalarının klasörü (qid'leri beklenen sorgu setidir)")
    parser.add_argument("--out", metavar="YOL", type=Path, default=None,
                        help="uyum sonucunu JSON olarak yaz (varsa ezilmez)")
    return parser


def _fmt(value: float | None) -> str:
    return "tanımsız" if value is None else f"{value:.3f}".replace(".", ",")


def _print_errors(label: str, path: Path, valid: int, errors: list[str]) -> None:
    status = "hata yok" if not errors else f"{len(errors)} hata"
    print(f"  {label} ({path}): {valid} geçerli satır, {status}")
    for error in errors:
        print(f"    - {error}")


def _print_report(
    result: dict[str, Any],
    pairs: list[tuple[str, str, int, int]],
    rows_a: dict[str, JurorRow],
    rows_b: dict[str, JurorRow],
    n_disagree: int,
    n_contentless: int,
    has_errors: bool,
) -> None:
    common = sorted(rows_a.keys() & rows_b.keys())
    negatives = _negatives(pairs, common)
    neg_a = sum(1 for x, _ in negatives if x)
    neg_b = sum(1 for _, y in negatives if y)

    def verdict(key: str) -> str:
        value = result[key]
        if value is None:
            return "tanımsız"
        return "geçti" if value >= THRESHOLD[key] else "geçmedi"

    print("\nUyum (hakemden önce, ham etiketler)")
    if has_errors:
        print("  Not: yalnız iki dosyada da geçerli olan sorgularla hesaplandı.")
    only_a = len(rows_a.keys() - rows_b.keys())
    only_b = len(rows_b.keys() - rows_a.keys())
    if only_a or only_b:
        print(f"  Yalnız A'da geçerli sorgu: {only_a}, yalnız B'de: {only_b} (hesaba girmedi)")
    def limit(key: str) -> str:
        return f"{THRESHOLD[key]:.2f}".replace(".", ",")

    lines = [
        ("Ortak sorgu", str(result["n_queries"])),
        ("Çift (sorgu × not)", str(result["n_pairs"])),
        ("κ_w (doğrusal ağırlık)",
         f"{_fmt(result['kappa_w']):<9} eşik ≥ {limit('kappa_w')}  {verdict('kappa_w')}"),
        ("Negatiflik κ",
         f"{_fmt(result['neg_kappa']):<9} eşik ≥ {limit('neg_kappa')}  {verdict('neg_kappa')}"),
        ("Ham uyum (tüm çiftler)", _fmt(result["raw_all"])),
        ("Ham uyum (en az biri ≥ 1)", _fmt(result["raw_pos"])),
        ("PSA", _fmt(result["psa"])),
        ("Negatiflik ham uyum", _fmt(result["neg_raw"])),
        ("≥ 1 çift (A / B)", f"{result['a_pos_pairs']} / {result['b_pos_pairs']}"),
        ("Negatif sorgu (A / B)", f"{neg_a} / {neg_b}"),
        ("contentless uyumu", _fmt(result["contentless_agree"])),
    ]
    width = max(len(name) for name, _ in lines)
    for name, value in lines:
        print(f"  {name:<{width}}  {value}")

    matrix = _confusion(pairs)
    print("\n  Karışıklık matrisi (satır A, sütun B)")
    print("        " + "".join(f"{'B=' + str(g):>8}" for g in GRADES))
    for i, grade in enumerate(GRADES):
        print(f"    A={grade} " + "".join(f"{matrix[i][j]:>8}" for j in range(len(GRADES))))
    print(f"\n  Hakeme gidecek: {n_disagree} çift, {n_contentless} sorguda contentless ayrışması")


def _setup_streams() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8")
            except (OSError, ValueError):
                pass


def main(argv: list[str] | None = None) -> int:
    _setup_streams()
    parser = _build_parser()
    try:
        args = parser.parse_args(argv)
    except _ArgumentError as exc:
        print(exc.usage, end="", file=sys.stderr)
        print(f"hata: {exc.message}", file=sys.stderr)
        return EXIT_USAGE
    except _ParserExit as exc:  # -h / --help
        return exc.status

    path_a: Path = args.a
    path_b: Path = args.b
    out: Path | None = args.out
    if out is not None and out.exists():
        print(f"hata: çıktı dosyası zaten var, ezilmez: {out}", file=sys.stderr)
        return EXIT_INVALID
    try:
        note_ids = load_note_ids(args.notes)
        expected_qids = load_expected_qids(args.batches)
    except _InputError as exc:
        print(f"hata: {exc}", file=sys.stderr)
        return EXIT_INVALID

    rows_a, errors_a = load_juror(path_a, expected_qids, note_ids)
    rows_b, errors_b = load_juror(path_b, expected_qids, note_ids)
    has_errors = bool(errors_a or errors_b)

    print(f"Sorgu seti: {len(expected_qids)} qid, not listesi: {len(note_ids)} not")
    print("\nDoğrulama")
    _print_errors("A", path_a, len(rows_a), errors_a)
    _print_errors("B", path_b, len(rows_b), errors_b)

    result = agreement(rows_a, rows_b, note_ids)
    pairs = pair_grades(rows_a, rows_b, note_ids)
    split = disagreements(rows_a, rows_b, note_ids)
    n_contentless = sum(1 for item in split if item["note"] is None)
    _print_report(result, pairs, rows_a, rows_b, len(split) - n_contentless, n_contentless,
                  has_errors)

    if out is not None:
        payload = dict(result)
        payload["errors"] = {"a": errors_a, "b": errors_b}
        try:
            out.parent.mkdir(parents=True, exist_ok=True)
            with out.open("x", encoding="utf-8", newline="\n") as handle:
                handle.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        except FileExistsError:
            print(f"hata: çıktı dosyası zaten var, ezilmez: {out}", file=sys.stderr)
            return EXIT_INVALID
        except OSError as exc:
            print(f"hata: çıktı yazılamadı: {out} ({exc.strerror or exc})", file=sys.stderr)
            return EXIT_INVALID
        print(f"\nYazıldı: {out}")

    if has_errors:
        print("\nSonuç: doğrulama hatası var; hatalı sorgular yeniden koşulmalı (çıkış 1).")
        return EXIT_INVALID
    if result["passed"]:
        print("\nSonuç: kabul eşiği geçti (çıkış 0).")
        return EXIT_OK
    print("\nSonuç: kabul eşiği geçilmedi (çıkış 3).")
    return EXIT_BELOW_THRESHOLD


if __name__ == "__main__":
    sys.exit(main())
