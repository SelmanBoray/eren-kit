"""eval.corpus testleri (yalnız sözleşmeden yazıldı).

VARSAYIM: pytest repo kökünü import yoluna ekler (`pythonpath = ["."]`).
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest

from bellek.config import Config, Source
from eval import corpus


def write(path: Path, text: str = "içerik") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def make_config(root: Path, sources: tuple[str, ...] = ("a", "b")) -> Config:
    vault = root / "vault"
    vault.mkdir(parents=True, exist_ok=True)
    srcs = []
    for name in sources:
        p = root / f"src_{name}"
        p.mkdir(parents=True, exist_ok=True)
        srcs.append(Source(name, p))
    return Config(
        config_path=root / "bellek.toml",
        vault=vault,
        state_dir=root / "state",
        sources=tuple(srcs),
        server_host="127.0.0.1",
        server_port=47321,
        projects={},
    )


def rels(config: Config) -> list[tuple[str, str]]:
    return [(s, r) for s, _p, r in corpus.iter_corpus_files(config)]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree_state(root: Path) -> dict[str, tuple[str, int]]:
    out = {}
    for p in sorted(root.rglob("*")):
        if p.is_file():
            out[p.relative_to(root).as_posix()] = (sha(p), p.stat().st_mtime_ns)
    return out


def write_toml(root: Path, config: Config) -> Path:
    lines = [
        "[bellek]",
        f'vault = "{config.vault.as_posix()}"',
        f'state_dir = "{config.state_dir.as_posix()}"',
        "",
    ]
    for s in config.sources:
        lines += ["[[source]]", f'name = "{s.name}"', f'path = "{s.path.as_posix()}"', ""]
    toml = root / "bellek.toml"
    toml.write_text("\n".join(lines), encoding="utf-8")
    return toml


# ---------------------------------------------------------------- iter_corpus_files


def test_vault_source_name() -> None:
    assert corpus.VAULT_SOURCE_NAME == "vault"


def test_vault_first_then_sources_in_order(tmp_path: Path) -> None:
    cfg = make_config(tmp_path, ("zeta", "alfa"))
    write(cfg.sources[0].path / "z.md")
    write(cfg.sources[1].path / "a.md")
    write(cfg.vault / "v.md")
    assert rels(cfg) == [("vault", "v.md"), ("zeta", "z.md"), ("alfa", "a.md")]


def test_tuple_shape_and_absolute_path(tmp_path: Path) -> None:
    cfg = make_config(tmp_path)
    f = write(cfg.vault / "alt" / "n.md")
    items = corpus.iter_corpus_files(cfg)
    assert isinstance(items, list)
    name, path, rel = items[0]
    assert name == "vault"
    assert path.is_absolute()
    assert Path(path).samefile(f)
    assert rel == "alt/n.md"


def test_missing_source_dir_skipped(tmp_path: Path) -> None:
    cfg = make_config(tmp_path)
    write(cfg.vault / "v.md")
    write(cfg.sources[1].path / "b.md")
    cfg.sources[0].path.rmdir()
    assert rels(cfg) == [("vault", "v.md"), ("b", "b.md")]


def test_missing_vault_skipped(tmp_path: Path) -> None:
    cfg = make_config(tmp_path)
    write(cfg.sources[0].path / "a.md")
    cfg.vault.rmdir()
    assert rels(cfg) == [("a", "a.md")]


def test_only_md_extension_case_insensitive(tmp_path: Path) -> None:
    cfg = make_config(tmp_path)
    for name in ("not.md", "NOT2.MD", "Karma.Md", "x.txt", "y.md.bak", "z.markdown", "md"):
        write(cfg.vault / name)
    got = {r for _s, r in rels(cfg)}
    assert got == {"not.md", "NOT2.MD", "Karma.Md"}


def test_directory_named_md_is_not_a_file(tmp_path: Path) -> None:
    cfg = make_config(tmp_path)
    (cfg.vault / "klasor.md").mkdir()
    write(cfg.vault / "klasor.md" / "ic.md")
    assert rels(cfg) == [("vault", "klasor.md/ic.md")]


def test_subdirectories_included(tmp_path: Path) -> None:
    cfg = make_config(tmp_path)
    write(cfg.vault / "a" / "b" / "c" / "derin.md")
    assert rels(cfg) == [("vault", "a/b/c/derin.md")]


def test_root_memory_md_excluded_but_nested_included(tmp_path: Path) -> None:
    cfg = make_config(tmp_path)
    for base in (cfg.vault, cfg.sources[0].path):
        write(base / "MEMORY.md")
        write(base / "alt" / "MEMORY.md")
    got = rels(cfg)
    assert ("vault", "MEMORY.md") not in got
    assert ("a", "MEMORY.md") not in got
    assert ("vault", "alt/MEMORY.md") in got
    assert ("a", "alt/MEMORY.md") in got


def test_dot_files_and_dirs_excluded(tmp_path: Path) -> None:
    cfg = make_config(tmp_path)
    write(cfg.vault / ".gizli.md")
    write(cfg.vault / ".obsidian" / "not.md")
    write(cfg.vault / ".obsidian" / "derin" / "x.md")
    write(cfg.vault / "alt" / ".gizli.md")
    write(cfg.vault / "alt" / ".klasor" / "y.md")
    write(cfg.vault / "alt" / "gorunur.md")
    assert rels(cfg) == [("vault", "alt/gorunur.md")]


def test_symlinks_excluded(tmp_path: Path) -> None:
    cfg = make_config(tmp_path)
    real = write(tmp_path / "disarda.md")
    write(cfg.vault / "gercek.md")
    try:
        os.symlink(real, cfg.vault / "bag.md")
        os.symlink(tmp_path, cfg.vault / "klasor_bagi", target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("symlink oluşturma yetkisi yok")
    assert rels(cfg) == [("vault", "gercek.md")]


def test_sorted_by_source_then_posix_rel_path(tmp_path: Path) -> None:
    cfg = make_config(tmp_path)
    for rel in ("b.md", "a/z.md", "a/b.md", "c/d/e.md", "A.md"):
        write(cfg.vault / rel)
        write(cfg.sources[1].path / rel)
    got = rels(cfg)
    expected = [("vault", r) for r in sorted(r for s, r in got if s == "vault")] + [
        ("b", r) for r in sorted(r for s, r in got if s == "b")
    ]
    assert got == expected
    assert len(got) == 10


def test_turkish_filenames(tmp_path: Path) -> None:
    cfg = make_config(tmp_path)
    f = write(cfg.vault / "analiz" / "ödev notu.md", "şğıİ")
    items = corpus.iter_corpus_files(cfg)
    assert [r for _s, _p, r in items] == ["analiz/ödev notu.md"]
    assert Path(items[0][1]).samefile(f)


# ---------------------------------------------------------------- snapshot


def populate(cfg: Config) -> None:
    write(cfg.vault / "v.md", "vault notu")
    write(cfg.vault / "analiz" / "ödev notu.md", "Türkçe içerik: şçğüöı")
    write(cfg.sources[0].path / "a.md", "a içeriği")
    write(cfg.sources[0].path / "MEMORY.md", "dışlanır")
    write(cfg.sources[0].path / "alt" / "MEMORY.md", "dahil")
    (cfg.vault / "ikili.md").write_bytes(b"\x00\x01\r\n\xff")


def test_snapshot_copies_and_manifest(tmp_path: Path) -> None:
    cfg = make_config(tmp_path / "kaynak")
    populate(cfg)
    out = tmp_path / "out"
    m = corpus.snapshot(cfg, "v1", out)

    root = out / "v1"
    assert (root / "manifest.json").is_file()
    on_disk = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    assert on_disk == m

    assert m["version"] == "v1"
    ts = m["created_at"]
    assert isinstance(ts, str) and ts.endswith("Z")

    expected = corpus.iter_corpus_files(cfg)
    assert len(m["files"]) == len(expected) == m["total_files"]
    total = 0
    for entry, (name, path, rel) in zip(
        sorted(m["files"], key=lambda e: (e["source"], e["rel_path"])),
        sorted(expected, key=lambda t: (t[0], t[2])),
    ):
        assert entry["source"] == name
        assert entry["rel_path"] == rel
        copy = root / "files" / name / rel
        assert copy.read_bytes() == path.read_bytes()
        assert entry["sha256"] == sha(path)
        assert entry["size"] == path.stat().st_size
        total += entry["size"]
    assert m["total_bytes"] == total

    names = [s["name"] for s in m["sources"]]
    assert names == ["vault", "a", "b"]
    by = {s["name"]: s for s in m["sources"]}
    assert all(s["exists"] for s in m["sources"])
    assert by["vault"]["files"] == 3
    assert by["a"]["files"] == 2
    assert by["b"]["files"] == 0
    assert Path(by["a"]["path"]).samefile(cfg.sources[0].path)


def test_snapshot_missing_source_marked_not_exists(tmp_path: Path) -> None:
    cfg = make_config(tmp_path / "kaynak")
    populate(cfg)
    cfg.sources[1].path.rmdir()
    m = corpus.snapshot(cfg, "v1", tmp_path / "out")
    by = {s["name"]: s for s in m["sources"]}
    assert by["b"]["exists"] is False
    assert by["b"]["files"] == 0
    assert by["a"]["exists"] is True


def test_snapshot_existing_version_raises(tmp_path: Path) -> None:
    cfg = make_config(tmp_path / "kaynak")
    populate(cfg)
    out = tmp_path / "out"
    corpus.snapshot(cfg, "v1", out)
    with pytest.raises(FileExistsError):
        corpus.snapshot(cfg, "v1", out)


@pytest.mark.parametrize("bad", ["../x", "v 1", "", "a/b", "a\\b", "ö", "v1\n"])
def test_snapshot_invalid_version(tmp_path: Path, bad: str) -> None:
    cfg = make_config(tmp_path / "kaynak")
    populate(cfg)
    out = tmp_path / "out"
    with pytest.raises(ValueError):
        corpus.snapshot(cfg, bad, out)
    assert not (tmp_path / "x").exists()


@pytest.mark.parametrize("good", ["v1", "2026-10-24", "a_b.c-d", "V.2"])
def test_snapshot_valid_versions(tmp_path: Path, good: str) -> None:
    cfg = make_config(tmp_path / "kaynak")
    populate(cfg)
    m = corpus.snapshot(cfg, good, tmp_path / "out")
    assert m["version"] == good
    assert (tmp_path / "out" / good / "manifest.json").is_file()


def test_snapshot_does_not_modify_sources(tmp_path: Path) -> None:
    cfg = make_config(tmp_path / "kaynak")
    populate(cfg)
    before = tree_state(tmp_path / "kaynak")
    corpus.snapshot(cfg, "v1", tmp_path / "out")
    assert tree_state(tmp_path / "kaynak") == before


def test_snapshot_empty_corpus(tmp_path: Path) -> None:
    cfg = make_config(tmp_path / "kaynak")
    m = corpus.snapshot(cfg, "v1", tmp_path / "out")
    assert m["files"] == []
    assert m["total_files"] == 0
    assert m["total_bytes"] == 0
    assert corpus.verify("v1", tmp_path / "out") == []


# ---------------------------------------------------------------- verify


def snap(tmp_path: Path) -> tuple[Config, Path]:
    cfg = make_config(tmp_path / "kaynak")
    populate(cfg)
    out = tmp_path / "out"
    corpus.snapshot(cfg, "v1", out)
    return cfg, out


def test_verify_clean(tmp_path: Path) -> None:
    _cfg, out = snap(tmp_path)
    assert corpus.verify("v1", out) == []


def test_verify_detects_modified_content(tmp_path: Path) -> None:
    _cfg, out = snap(tmp_path)
    (out / "v1" / "files" / "vault" / "v.md").write_text("bozuk", encoding="utf-8")
    problems = corpus.verify("v1", out)
    assert problems
    assert all(isinstance(p, str) for p in problems)


def test_verify_detects_same_size_modification(tmp_path: Path) -> None:
    _cfg, out = snap(tmp_path)
    p = out / "v1" / "files" / "vault" / "v.md"
    data = bytearray(p.read_bytes())
    data[0] ^= 0x01
    p.write_bytes(bytes(data))
    assert corpus.verify("v1", out)


def test_verify_detects_deleted_copy(tmp_path: Path) -> None:
    _cfg, out = snap(tmp_path)
    (out / "v1" / "files" / "a" / "a.md").unlink()
    assert corpus.verify("v1", out)


def test_verify_detects_extra_file(tmp_path: Path) -> None:
    _cfg, out = snap(tmp_path)
    write(out / "v1" / "files" / "vault" / "fazla.md", "fazla")
    assert corpus.verify("v1", out)


def test_verify_missing_manifest_raises(tmp_path: Path) -> None:
    _cfg, out = snap(tmp_path)
    (out / "v1" / "manifest.json").unlink()
    with pytest.raises(FileNotFoundError):
        corpus.verify("v1", out)


def test_verify_unknown_version_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        corpus.verify("yok", tmp_path / "out")


# ---------------------------------------------------------------- CLI


def snapshot_args(toml: Path, out: Path, version: str = "v1") -> list[str]:
    return ["snapshot", "--version", version, "--out", str(out), "--config", str(toml)]


def test_cli_snapshot_and_verify(tmp_path: Path) -> None:
    cfg = make_config(tmp_path / "kaynak")
    populate(cfg)
    toml = write_toml(tmp_path, cfg)
    out = tmp_path / "out"
    assert corpus.main(snapshot_args(toml, out)) == 0
    assert (out / "v1" / "manifest.json").is_file()
    assert corpus.main(["verify", "--version", "v1", "--out", str(out)]) == 0


def test_cli_snapshot_twice_returns_1(tmp_path: Path) -> None:
    cfg = make_config(tmp_path / "kaynak")
    populate(cfg)
    toml = write_toml(tmp_path, cfg)
    out = tmp_path / "out"
    assert corpus.main(snapshot_args(toml, out)) == 0
    assert corpus.main(snapshot_args(toml, out)) == 1


def test_cli_verify_corrupted_returns_1(tmp_path: Path) -> None:
    cfg = make_config(tmp_path / "kaynak")
    populate(cfg)
    toml = write_toml(tmp_path, cfg)
    out = tmp_path / "out"
    assert corpus.main(snapshot_args(toml, out)) == 0
    (out / "v1" / "files" / "vault" / "v.md").write_text("bozuk", encoding="utf-8")
    assert corpus.main(["verify", "--version", "v1", "--out", str(out)]) == 1


def test_cli_missing_config_returns_2(tmp_path: Path) -> None:
    out = tmp_path / "out"
    rc = corpus.main(snapshot_args(tmp_path / "yok.toml", out))
    assert rc == 2
    assert not (out / "v1").exists()


def test_cli_unknown_subcommand_returns_2(tmp_path: Path) -> None:
    assert corpus.main(["bilinmeyen"]) == 2


# ---------------------------------------------------------------- bos dosya dislama (M1 ek)


@pytest.mark.parametrize(
    "data",
    [b"", b" ", b"\n", b"\t\n\r\x0b\x0c ", b"  \r\n\r\n  ", b"\xef\xbb\xbf"],
    ids=["bos", "bosluk", "satir", "tum-ascii-bosluk", "karisik", "yalniz-bom"],
)
def test_blank_md_excluded(tmp_path: Path, data: bytes) -> None:
    cfg = make_config(tmp_path)
    (cfg.vault / "bos.md").write_bytes(data)
    write(cfg.vault / "dolu.md", "x")
    assert rels(cfg) == [("vault", "dolu.md")]


@pytest.mark.parametrize("data", [b"x", b" x ", b"\n.\n", "ş".encode("utf-8")])
def test_single_visible_char_included(tmp_path: Path, data: bytes) -> None:
    cfg = make_config(tmp_path)
    (cfg.sources[0].path / "t.md").write_bytes(data)
    assert rels(cfg) == [("a", "t.md")]


def test_blank_nested_md_excluded(tmp_path: Path) -> None:
    cfg = make_config(tmp_path)
    (cfg.vault / "alt").mkdir()
    (cfg.vault / "alt" / "bos.md").write_bytes(b"")
    assert rels(cfg) == []


def test_snapshot_skips_blank_files(tmp_path: Path) -> None:
    cfg = make_config(tmp_path / "kaynak")
    populate(cfg)
    (cfg.vault / "bos.md").write_bytes(b"")
    (cfg.vault / "bom.md").write_bytes(b"\xef\xbb\xbf")
    out = tmp_path / "out"
    m = corpus.snapshot(cfg, "v1", out)
    assert all(e["rel_path"] not in ("bos.md", "bom.md") for e in m["files"])
    assert not (out / "v1" / "files" / "vault" / "bos.md").exists()
    assert corpus.verify("v1", out) == []


# ---------------------------------------------------------------- indeks dosyalari


def test_iter_index_files_order_and_shape(tmp_path: Path) -> None:
    cfg = make_config(tmp_path)
    write(cfg.sources[1].path / "MEMORY.md", "b idx")
    write(cfg.vault / "MEMORY.md", "v idx")
    write(cfg.sources[0].path / "MEMORY.md", "a idx")
    items = corpus.iter_index_files(cfg)
    assert [n for n, _ in items] == ["vault", "a", "b"]
    for (name, p), root in zip(items, [cfg.vault, cfg.sources[0].path, cfg.sources[1].path]):
        assert isinstance(p, Path) and p.is_absolute()
        assert p.samefile(root / "MEMORY.md")


def test_iter_index_files_skips_sources_without_root_index(tmp_path: Path) -> None:
    cfg = make_config(tmp_path)
    write(cfg.sources[1].path / "MEMORY.md", "b idx")
    assert [n for n, _ in corpus.iter_index_files(cfg)] == ["b"]


def test_iter_index_files_excludes_nested(tmp_path: Path) -> None:
    cfg = make_config(tmp_path)
    write(cfg.sources[0].path / "alt" / "MEMORY.md", "ic")
    assert corpus.iter_index_files(cfg) == []
    assert rels(cfg) == [("a", "alt/MEMORY.md")]


def test_iter_index_files_missing_source_dir(tmp_path: Path) -> None:
    import shutil

    cfg = make_config(tmp_path)
    write(cfg.vault / "MEMORY.md", "v")
    shutil.rmtree(cfg.sources[0].path)
    assert [n for n, _ in corpus.iter_index_files(cfg)] == ["vault"]


def test_iter_index_files_empty(tmp_path: Path) -> None:
    assert corpus.iter_index_files(make_config(tmp_path)) == []


def idx_snap(tmp_path: Path) -> tuple[Config, Path, dict]:
    cfg = make_config(tmp_path / "kaynak")
    populate(cfg)  # a kaynaginda kok MEMORY.md var
    write(cfg.vault / "MEMORY.md", "vault dizini şçğ")
    out = tmp_path / "out"
    m = corpus.snapshot(cfg, "v1", out)
    return cfg, out, m


def test_snapshot_copies_index_files(tmp_path: Path) -> None:
    cfg, out, m = idx_snap(tmp_path)
    root = out / "v1" / "index"
    assert (root / "vault" / "MEMORY.md").read_bytes() == (cfg.vault / "MEMORY.md").read_bytes()
    assert (root / "a" / "MEMORY.md").read_bytes() == (
        cfg.sources[0].path / "MEMORY.md"
    ).read_bytes()
    assert not (root / "b").exists()


def test_snapshot_manifest_index_files(tmp_path: Path) -> None:
    cfg, out, m = idx_snap(tmp_path)
    on_disk = json.loads((out / "v1" / "manifest.json").read_text(encoding="utf-8"))
    assert on_disk == m
    assert [e["source"] for e in m["index_files"]] == ["vault", "a"]
    for e, src in zip(m["index_files"], [cfg.vault, cfg.sources[0].path]):
        assert e["rel_path"] == "MEMORY.md"
        assert e["sha256"] == sha(src / "MEMORY.md")
        assert e["size"] == (src / "MEMORY.md").stat().st_size


def test_snapshot_index_not_counted_in_corpus(tmp_path: Path) -> None:
    cfg, out, m = idx_snap(tmp_path)
    assert not any(e["rel_path"] == "MEMORY.md" for e in m["files"])
    assert len(m["files"]) == m["total_files"] == len(corpus.iter_corpus_files(cfg))
    assert m["total_bytes"] == sum(e["size"] for e in m["files"])
    assert not (out / "v1" / "files" / "vault" / "MEMORY.md").exists()


def test_snapshot_sources_index_flag(tmp_path: Path) -> None:
    _cfg, _out, m = idx_snap(tmp_path)
    by = {s["name"]: s for s in m["sources"]}
    assert by["vault"]["index"] is True
    assert by["a"]["index"] is True
    assert by["b"]["index"] is False


def test_snapshot_without_any_index(tmp_path: Path) -> None:
    cfg = make_config(tmp_path / "kaynak")
    write(cfg.vault / "v.md", "x")
    m = corpus.snapshot(cfg, "v1", tmp_path / "out")
    assert m["index_files"] == []
    assert all(s["index"] is False for s in m["sources"])
    assert corpus.verify("v1", tmp_path / "out") == []


def test_snapshot_index_does_not_modify_sources(tmp_path: Path) -> None:
    cfg = make_config(tmp_path / "kaynak")
    populate(cfg)
    write(cfg.vault / "MEMORY.md", "idx")
    before = tree_state(tmp_path / "kaynak")
    corpus.snapshot(cfg, "v1", tmp_path / "out")
    assert tree_state(tmp_path / "kaynak") == before


def test_verify_clean_with_index(tmp_path: Path) -> None:
    _cfg, out, _m = idx_snap(tmp_path)
    assert corpus.verify("v1", out) == []


def test_verify_detects_modified_index(tmp_path: Path) -> None:
    _cfg, out, _m = idx_snap(tmp_path)
    (out / "v1" / "index" / "vault" / "MEMORY.md").write_text("bozuk", encoding="utf-8")
    assert corpus.verify("v1", out)


def test_verify_detects_same_size_modified_index(tmp_path: Path) -> None:
    _cfg, out, _m = idx_snap(tmp_path)
    p = out / "v1" / "index" / "a" / "MEMORY.md"
    data = bytearray(p.read_bytes())
    data[0] ^= 0x01
    p.write_bytes(bytes(data))
    assert corpus.verify("v1", out)


def test_verify_detects_deleted_index(tmp_path: Path) -> None:
    _cfg, out, _m = idx_snap(tmp_path)
    (out / "v1" / "index" / "a" / "MEMORY.md").unlink()
    assert corpus.verify("v1", out)


def test_verify_detects_extra_file_under_index(tmp_path: Path) -> None:
    _cfg, out, _m = idx_snap(tmp_path)
    write(out / "v1" / "index" / "vault" / "fazla.md", "fazla")
    assert corpus.verify("v1", out)


def test_verify_detects_extra_index_source_dir(tmp_path: Path) -> None:
    _cfg, out, _m = idx_snap(tmp_path)
    write(out / "v1" / "index" / "b" / "MEMORY.md", "fazla")
    assert corpus.verify("v1", out)


def test_verify_old_manifest_without_index_key(tmp_path: Path) -> None:
    import shutil

    cfg = make_config(tmp_path / "kaynak")
    write(cfg.vault / "v.md", "x")
    out = tmp_path / "out"
    corpus.snapshot(cfg, "v1", out)
    mp = out / "v1" / "manifest.json"
    m = json.loads(mp.read_text(encoding="utf-8"))
    m.pop("index_files", None)
    mp.write_text(json.dumps(m), encoding="utf-8")
    shutil.rmtree(out / "v1" / "index", ignore_errors=True)
    assert corpus.verify("v1", out) == []


def test_verify_old_manifest_after_index_snapshot(tmp_path: Path) -> None:
    import shutil

    _cfg, out, _m = idx_snap(tmp_path)
    mp = out / "v1" / "manifest.json"
    m = json.loads(mp.read_text(encoding="utf-8"))
    m.pop("index_files")
    mp.write_text(json.dumps(m), encoding="utf-8")
    shutil.rmtree(out / "v1" / "index")
    assert corpus.verify("v1", out) == []
