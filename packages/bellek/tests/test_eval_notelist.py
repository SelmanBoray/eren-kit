"""eval.notelist testleri (yalnız sözleşmeden yazıldı).

VARSAYIM: pytest repo kökünü import yoluna ekler. CRLF'li dosyada `chars`
testi yapılmaz (okuma yönteminden bağımsız kalmak için).
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from eval import notelist
from eval.notelist import NoteEntry


def make_corpus(root: Path, files: dict) -> Path:
    cdir = root / "v1"
    entries = []
    for (source, rel), content in files.items():
        data = content if isinstance(content, bytes) else content.encode("utf-8")
        p = cdir / "files" / source / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        entries.append({"source": source, "rel_path": rel,
                        "sha256": "a" * 64, "size": len(data)})
    (cdir / "manifest.json").write_text(
        json.dumps({"files": entries}), encoding="utf-8")
    return cdir


# ---------------- parse_frontmatter ----------------

def test_frontmatter_full():
    text = "---\nname: Not\ndescription: Kısa özet\ntype: user\n---\nGövde\n"
    f, body = notelist.parse_frontmatter(text)
    assert f == {"name": "Not", "description": "Kısa özet", "type": "user"}
    assert body.strip() == "Gövde"


def test_frontmatter_nested_metadata():
    text = ("---\nname: x\nmetadata:\n  type: project\n"
            "  originSessionId: abc-123\n---\nbody")
    f, body = notelist.parse_frontmatter(text)
    assert f["name"] == "x"
    assert f["metadata.type"] == "project"
    assert f["metadata.originSessionId"] == "abc-123"
    assert body.strip() == "body"


def test_frontmatter_top_level_type():
    f, _ = notelist.parse_frontmatter("---\ntype: feedback\n---\nx")
    assert f["type"] == "feedback"


def test_frontmatter_quotes_and_whitespace():
    text = "---\nname: 'Tek tırnak'\ndescription: \"Çift tırnak\"\ntype:   user  \n---\n"
    f, _ = notelist.parse_frontmatter(text)
    assert f["name"] == "Tek tırnak"
    assert f["description"] == "Çift tırnak"
    assert f["type"] == "user"


def test_frontmatter_unclosed():
    text = "---\nname: x\nGövde burada\n"
    assert notelist.parse_frontmatter(text) == ({}, text)


def test_no_frontmatter():
    text = "# Başlık\n\ngövde\n"
    assert notelist.parse_frontmatter(text) == ({}, text)


def test_empty_text():
    assert notelist.parse_frontmatter("") == ({}, "")


def test_frontmatter_crlf():
    text = "---\r\nname: x\r\nmetadata:\r\n  type: user\r\n---\r\nGövde\r\n"
    f, body = notelist.parse_frontmatter(text)
    assert f["name"] == "x"
    assert f["metadata.type"] == "user"
    assert body.strip() == "Gövde"


def test_frontmatter_bom():
    f, body = notelist.parse_frontmatter("﻿---\nname: x\n---\nb")
    assert f == {"name": "x"}
    assert body.strip() == "b"


def test_frontmatter_ignores_lists_and_unknown_lines():
    text = ("---\nname: x\ntags:\n  - a\n  - b\nsaçma satır\n"
            "multi: |\n  satır1\n  satır2\ntype: user\n---\nb")
    f, body = notelist.parse_frontmatter(text)
    assert f["name"] == "x"
    assert f["type"] == "user"
    assert body.strip() == "b"
    assert "satır1" not in f.values()


# ---------------- describe ----------------

def test_describe_uses_description():
    assert notelist.describe({"description": "Açıklama"}, "# H\n\ngövde") == "Açıklama"


def test_describe_heading_and_body():
    out = notelist.describe({}, "# Başlık\n\nilk satır\nikinci satır\n")
    assert out == "Başlık — ilk satır ikinci satır"


def test_describe_strips_multiple_hashes():
    out = notelist.describe({}, "### Derin Başlık\ngövde")
    assert out == "Derin Başlık — gövde"


def test_describe_no_heading():
    assert notelist.describe({}, "sadece   metin\nsatırı\n") == "sadece metin satırı"


def test_describe_truncates_body_default():
    out = notelist.describe({}, "# H\n\n" + "a" * 500)
    assert out == "H — " + "a" * 150


def test_describe_truncates_no_heading_custom_max():
    out = notelist.describe({}, "b" * 100, max_chars=20)
    assert out == "b" * 20


def test_describe_collapses_whitespace_single_line():
    out = notelist.describe({}, "# T\n\nbir\n\n\n  iki\t\tüç\r\n")
    assert out == "T — bir iki üç"
    assert "\n" not in out and "\r" not in out


def test_describe_empty_description_falls_back():
    out = notelist.describe({"description": ""}, "# H\ngövde")
    assert out == "H — gövde"


# ---------------- note_type ----------------

def test_note_type_variants():
    assert notelist.note_type({"type": "user"}) == "user"
    assert notelist.note_type({"metadata.type": "project"}) == "project"
    assert notelist.note_type({"type": "a", "metadata.type": "b"}) == "a"
    assert notelist.note_type({}) == ""


# ---------------- build_note_list ----------------

def test_note_entry_frozen():
    e = NoteEntry("a/b.md", "a", "b", "d", "t", 3)
    with pytest.raises(dataclasses.FrozenInstanceError):
        e.name = "x"  # type: ignore[misc]


def test_build_sorted_and_fields(tmp_path):
    cdir = make_corpus(tmp_path, {
        ("zeta", "z.md"): "---\nname: Zed\ndescription: Z açıklaması\ntype: user\n---\nz",
        ("alfa", "sub/b.md"): "# Başlık\n\ngövde",
        ("alfa", "a.md"): "---\nmetadata:\n  type: project\n---\nx",
    })
    entries = notelist.build_note_list(cdir)
    ids = [e.note_id for e in entries]
    assert ids == ["alfa/a.md", "alfa/sub/b.md", "zeta/z.md"]
    a, b, z = entries
    assert (a.source, a.name, a.type) == ("alfa", "a", "project")
    assert (b.name, b.description, b.type) == ("b", "Başlık — gövde", "")
    assert (z.name, z.description, z.type) == ("Zed", "Z açıklaması", "user")


def test_build_chars_counts_characters_including_frontmatter(tmp_path):
    text = "---\nname: x\n---\nçğıöşü ✓"
    cdir = make_corpus(tmp_path, {("s", "t.md"): text})
    (e,) = notelist.build_note_list(cdir)
    assert e.chars == len(text)
    assert e.chars < len(text.encode("utf-8"))


def test_build_name_fallback_stem(tmp_path):
    cdir = make_corpus(tmp_path, {("s", "dir/my.note.md"): "gövde"})
    (e,) = notelist.build_note_list(cdir)
    assert e.name == "my.note"


def test_build_missing_manifest(tmp_path):
    (tmp_path / "v1").mkdir()
    with pytest.raises(FileNotFoundError):
        notelist.build_note_list(tmp_path / "v1")


def test_build_missing_file_on_disk(tmp_path):
    cdir = make_corpus(tmp_path, {("s", "a.md"): "x", ("s", "b.md"): "y"})
    (cdir / "files" / "s" / "b.md").unlink()
    with pytest.raises(FileNotFoundError):
        notelist.build_note_list(cdir)


# ---------------- write_note_list ----------------

def sample_entries():
    return [
        NoteEntry("s/a.md", "s", "a", "Türkçe şğü açıklama", "user", 10),
        NoteEntry("s/b.md", "s", "b|c", "sütun | ayracı", "", 5),
    ]


def test_write_jsonl_and_md(tmp_path):
    j, m = tmp_path / "n.jsonl", tmp_path / "n.md"
    notelist.write_note_list(sample_entries(), j, m)
    raw = j.read_text(encoding="utf-8")
    assert "\\u" not in raw and "Türkçe şğü" in raw
    rows = [json.loads(ln) for ln in raw.splitlines() if ln.strip()]
    assert rows == [dataclasses.asdict(e) for e in sample_entries()]
    md = m.read_text(encoding="utf-8")
    lines = [ln for ln in md.splitlines() if ln.startswith("|")]
    assert lines[0].replace(" ", "") == "|note_id|type|name|description|chars|"
    assert len(lines) >= 4  # başlık + ayraç + 2 not
    assert "b\\|c" in md and "sütun \\| ayracı" in md
    assert "Türkçe şğü açıklama" in md
    assert sum(1 for ln in lines if "s/a.md" in ln) == 1
    assert sum(1 for ln in lines if "s/b.md" in ln) == 1


@pytest.mark.parametrize("existing", ["jsonl", "md", "both"])
def test_write_refuses_overwrite_and_writes_nothing(tmp_path, existing):
    j, m = tmp_path / "n.jsonl", tmp_path / "n.md"
    if existing in ("jsonl", "both"):
        j.write_text("ESKİ-J", encoding="utf-8")
    if existing in ("md", "both"):
        m.write_text("ESKİ-M", encoding="utf-8")
    with pytest.raises(FileExistsError):
        notelist.write_note_list(sample_entries(), j, m)
    if existing == "jsonl":
        assert not m.exists()
        assert j.read_text(encoding="utf-8") == "ESKİ-J"
    elif existing == "md":
        assert not j.exists()
        assert m.read_text(encoding="utf-8") == "ESKİ-M"
    else:
        assert j.read_text(encoding="utf-8") == "ESKİ-J"
        assert m.read_text(encoding="utf-8") == "ESKİ-M"


# ---------------- CLI ----------------

def test_cli_ok_then_exists(tmp_path):
    cdir = make_corpus(tmp_path, {("s", "a.md"): "# H\n\ngövde"})
    argv = ["--version", "v1", "--corpus-dir", str(cdir)]
    assert notelist.main(argv) == 0
    assert (cdir / "notes.jsonl").is_file()
    assert (cdir / "notes.md").is_file()
    first = (cdir / "notes.jsonl").read_text(encoding="utf-8")
    assert notelist.main(argv) == 1
    assert (cdir / "notes.jsonl").read_text(encoding="utf-8") == first


def test_cli_missing_manifest(tmp_path):
    cdir = tmp_path / "v1"
    cdir.mkdir()
    assert notelist.main(["--version", "v1", "--corpus-dir", str(cdir)]) == 1
    assert not (cdir / "notes.jsonl").exists()


def test_cli_unknown_argument_returns_2(tmp_path):
    cdir = make_corpus(tmp_path, {("s", "a.md"): "x"})
    rc = notelist.main(["--version", "v1", "--corpus-dir", str(cdir), "--bogus"])
    assert rc == 2
