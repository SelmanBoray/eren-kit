"""bellek.config testleri (sözleşmeden yazıldı; yalnız tmp_path kullanır)."""

from __future__ import annotations

import dataclasses
import os
import sys
from pathlib import Path

import pytest

from bellek import config as config_module
from bellek.config import (
    Config,
    ConfigError,
    Source,
    default_config_path,
    load_config,
    project_for_cwd,
)

WIN = sys.platform == "win32"


def norm(p: Path | str) -> str:
    return os.path.normcase(os.path.normpath(str(p)))


def same(a: Path | str, b: Path | str) -> bool:
    return norm(Path(a).resolve()) == norm(Path(b).resolve())


def lit(p: Path | str) -> str:
    """TOML tek tırnaklı (literal) metin; ters eğik çizgiler korunur."""
    return "'" + str(p) + "'"


def write(tmp_path: Path, text: str, name: str = "bellek.toml") -> Path:
    f = tmp_path / name
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(text, encoding="utf-8")
    return f


@pytest.fixture(autouse=True)
def _temiz_ortam(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BELLEK_CONFIG", raising=False)


# ---------------------------------------------------------------- varsayılanlar


def test_varsayilanlar(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    f = write(tmp_path, f"[bellek]\nvault = {lit(tmp_path / 'vault')}\n")
    cfg = load_config(f)
    assert isinstance(cfg, Config)
    assert same(cfg.config_path, f)
    assert same(cfg.vault, tmp_path / "vault")
    assert cfg.sources == ()
    assert cfg.server_host == "127.0.0.1"
    assert cfg.server_port == 47321
    assert len(cfg.projects) == 0
    if WIN:
        assert same(cfg.state_dir, tmp_path / "local" / "Bellek")


def test_acik_degerler(tmp_path):
    f = write(
        tmp_path,
        f"""
[bellek]
vault = {lit(tmp_path / 'v')}
state_dir = {lit(tmp_path / 'st')}

[server]
host = "0.0.0.0"
port = 8080
""",
    )
    cfg = load_config(f)
    assert same(cfg.state_dir, tmp_path / "st")
    assert cfg.server_host == "0.0.0.0"
    assert cfg.server_port == 8080


def test_server_tablosu_kismi(tmp_path):
    f = write(tmp_path, f"[bellek]\nvault = {lit(tmp_path)}\n[server]\nport = 1\n")
    cfg = load_config(f)
    assert cfg.server_host == "127.0.0.1"
    assert cfg.server_port == 1


def test_port_ust_sinir_gecerli(tmp_path):
    f = write(tmp_path, f"[bellek]\nvault = {lit(tmp_path)}\n[server]\nport = 65535\n")
    assert load_config(f).server_port == 65535


def test_dataclasslar_donuk(tmp_path):
    f = write(tmp_path, f"[bellek]\nvault = {lit(tmp_path)}\n")
    cfg = load_config(f)
    with pytest.raises(dataclasses.FrozenInstanceError):
        cfg.server_port = 1  # type: ignore[misc]
    s = Source("a", tmp_path)
    with pytest.raises(dataclasses.FrozenInstanceError):
        s.name = "b"  # type: ignore[misc]


def test_config_error_value_error():
    assert issubclass(ConfigError, ValueError)


# ---------------------------------------------------------------- yol çözümü


def test_goreli_yollar_config_klasorune_gore(tmp_path, monkeypatch):
    sub = tmp_path / "conf"
    f = write(
        sub,
        """
[bellek]
vault = "vault"
state_dir = "../state"

[[source]]
name = "notlar"
path = "notlar/alt"

[projects]
"proj/a" = "A"
""",
    )
    cwd_elsewhere = tmp_path / "baska"
    cwd_elsewhere.mkdir()
    monkeypatch.chdir(cwd_elsewhere)
    cfg = load_config(f)
    assert same(cfg.vault, sub / "vault")
    assert same(cfg.state_dir, tmp_path / "state")
    assert same(cfg.sources[0].path, sub / "notlar" / "alt")
    assert [(norm(Path(k).resolve()), v) for k, v in cfg.projects.items()] == [
        (norm((sub / "proj" / "a").resolve()), "A")
    ]


def test_mutlak_yol_oldugu_gibi(tmp_path):
    other = tmp_path / "x" / "y"
    f = write(tmp_path / "conf", f"[bellek]\nvault = {lit(other)}\n")
    assert same(load_config(f).vault, other)


def test_tilde_acilir(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("USERPROFILE", str(tmp_path / "home"))
    f = write(
        tmp_path,
        """
[bellek]
vault = "~/vault"
state_dir = "~/st"

[[source]]
name = "s"
path = "~/src"
""",
    )
    cfg = load_config(f)
    assert same(cfg.vault, tmp_path / "home" / "vault")
    assert same(cfg.state_dir, tmp_path / "home" / "st")
    assert same(cfg.sources[0].path, tmp_path / "home" / "src")


def test_dolar_ortam_degiskeni_acilir(tmp_path, monkeypatch):
    monkeypatch.setenv("BELLEK_TEST_KOK", str(tmp_path / "kok"))
    f = write(
        tmp_path,
        """
[bellek]
vault = "$BELLEK_TEST_KOK/vault"

[[source]]
name = "s"
path = "$BELLEK_TEST_KOK/src"
""",
    )
    cfg = load_config(f)
    assert same(cfg.vault, tmp_path / "kok" / "vault")
    assert same(cfg.sources[0].path, tmp_path / "kok" / "src")


@pytest.mark.skipif(not WIN, reason="%VAR% açılımı Windows'a özgü")
def test_yuzde_ortam_degiskeni_acilir(tmp_path, monkeypatch):
    monkeypatch.setenv("BELLEK_TEST_KOK", str(tmp_path / "kok"))
    f = write(
        tmp_path,
        """
[bellek]
vault = "%BELLEK_TEST_KOK%/vault"
state_dir = "%BELLEK_TEST_KOK%/state"
""",
    )
    cfg = load_config(f)
    assert same(cfg.vault, tmp_path / "kok" / "vault")
    assert same(cfg.state_dir, tmp_path / "kok" / "state")


def test_yollarin_var_olmasi_gerekmez(tmp_path):
    f = write(
        tmp_path,
        f"""
[bellek]
vault = {lit(tmp_path / 'yok' / 'vault')}
[[source]]
name = "s"
path = {lit(tmp_path / 'yok' / 'src')}
""",
    )
    cfg = load_config(f)
    assert not cfg.vault.exists()
    assert not cfg.sources[0].path.exists()


def test_kaynak_sirasi_korunur(tmp_path):
    names = ["zeta", "alfa", "orta", "beta", "kappa"]
    body = "".join(f'[[source]]\nname = "{n}"\npath = "p_{n}"\n\n' for n in names)
    f = write(tmp_path, f"[bellek]\nvault = {lit(tmp_path)}\n\n{body}")
    cfg = load_config(f)
    assert isinstance(cfg.sources, tuple)
    assert [s.name for s in cfg.sources] == names
    assert all(isinstance(s, Source) for s in cfg.sources)
    assert same(cfg.sources[1].path, tmp_path / "p_alfa")


def test_projects_okunur(tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    f = write(
        tmp_path,
        f'[bellek]\nvault = {lit(tmp_path)}\n[projects]\n{lit(a)} = "Alfa"\n{lit(b)} = "Beta"\n',
    )
    cfg = load_config(f)
    got = {norm(Path(k).resolve()): v for k, v in cfg.projects.items()}
    assert got == {norm(a.resolve()): "Alfa", norm(b.resolve()): "Beta"}


# ---------------------------------------------------------------- varsayılan yol


def test_default_config_path_env(tmp_path, monkeypatch):
    hedef = tmp_path / "ozel" / "x.toml"
    monkeypatch.setenv("BELLEK_CONFIG", str(hedef))
    assert Path(default_config_path()) == hedef


def test_default_config_path_repo_koku(monkeypatch):
    monkeypatch.delenv("BELLEK_CONFIG", raising=False)
    p = default_config_path()
    assert p.name == "bellek.toml"
    beklenen = Path(config_module.__file__).resolve().parent.parent.parent
    assert same(p.parent, beklenen)


def test_load_config_none_env_kullanir(tmp_path, monkeypatch):
    f = write(tmp_path, f"[bellek]\nvault = {lit(tmp_path / 'v')}\n", name="ozel.toml")
    monkeypatch.setenv("BELLEK_CONFIG", str(f))
    cfg = load_config()
    assert same(cfg.config_path, f)
    assert same(cfg.vault, tmp_path / "v")
    assert same(load_config(None).config_path, f)


def test_load_config_bellek_toml_yoksa_sablon(tmp_path, monkeypatch):
    """Örtük varsayılan bellek.toml yoksa paket kökündeki şablon yüklenir."""
    monkeypatch.setattr(config_module, "_package_root", lambda: tmp_path)
    write(tmp_path, "[bellek]\nvault = 'kasa'\n", name="bellek.example.toml")
    cfg = load_config()
    assert cfg.template is True
    assert same(cfg.config_path, tmp_path / "bellek.example.toml")
    assert same(cfg.vault, tmp_path / "kasa")


def test_load_config_bellek_toml_varsa_sablon_kullanilmaz(tmp_path, monkeypatch):
    monkeypatch.setattr(config_module, "_package_root", lambda: tmp_path)
    write(tmp_path, "[bellek]\nvault = 'sablon'\n", name="bellek.example.toml")
    write(tmp_path, "[bellek]\nvault = 'gercek'\n")
    cfg = load_config()
    assert cfg.template is False
    assert same(cfg.vault, tmp_path / "gercek")


def test_load_config_ne_ayar_ne_sablon_acik_hata(tmp_path, monkeypatch):
    monkeypatch.setattr(config_module, "_package_root", lambda: tmp_path)
    with pytest.raises(ConfigError, match="bellek.example.toml"):
        load_config()


def test_load_config_acik_yol_ya_da_env_yoksa_sablona_dusmez(tmp_path, monkeypatch):
    monkeypatch.setattr(config_module, "_package_root", lambda: tmp_path)
    write(tmp_path, "[bellek]\nvault = 'kasa'\n", name="bellek.example.toml")
    with pytest.raises(ConfigError):
        load_config(tmp_path / "bellek.toml")
    monkeypatch.setenv("BELLEK_CONFIG", str(tmp_path / "yok.toml"))
    with pytest.raises(ConfigError):
        load_config()


def test_repodaki_sablon_gecerli_ve_kisisel_yol_icermez(monkeypatch):
    """bellek.example.toml geçerli bir ayardır; mutlak kişisel yol taşımaz."""
    monkeypatch.setenv("LOCALAPPDATA", os.environ.get("LOCALAPPDATA") or "/tmp/local")
    ornek = config_module.example_config_path()
    cfg = load_config(ornek)
    assert cfg.template is False  # açık yolla yüklendi
    assert same(cfg.vault, ornek.parent / "vault")
    for src in cfg.sources:
        assert "<" not in str(src.path)  # yer tutuculu örnekler yorumda kalır
    metin = ornek.read_text(encoding="utf-8")
    assert "Users" not in metin  # mutlak kullanıcı klasörü yolu yok


def test_load_config_none_dosya_yoksa(tmp_path, monkeypatch):
    monkeypatch.setenv("BELLEK_CONFIG", str(tmp_path / "yok.toml"))
    with pytest.raises(ConfigError):
        load_config()


# ---------------------------------------------------------------- hatalar


def test_dosya_yok(tmp_path):
    with pytest.raises(ConfigError):
        load_config(tmp_path / "yok.toml")


def test_bozuk_toml(tmp_path):
    f = write(tmp_path, "[bellek\nvault = = =\n")
    with pytest.raises(ConfigError):
        load_config(f)


def test_bos_dosya(tmp_path):
    f = write(tmp_path, "")
    with pytest.raises(ConfigError):
        load_config(f)


def test_vault_eksik(tmp_path):
    f = write(tmp_path, "[bellek]\nstate_dir = 'x'\n")
    with pytest.raises(ConfigError, match="vault"):
        load_config(f)


@pytest.mark.parametrize("port", [0, 70000, 65536, -1])
def test_port_aralik_disi(tmp_path, port):
    f = write(tmp_path, f"[bellek]\nvault = {lit(tmp_path)}\n[server]\nport = {port}\n")
    with pytest.raises(ConfigError, match="port"):
        load_config(f)


@pytest.mark.parametrize("deger", ['"8080"', "80.5", "true"])
def test_port_tam_sayi_degil(tmp_path, deger):
    f = write(tmp_path, f"[bellek]\nvault = {lit(tmp_path)}\n[server]\nport = {deger}\n")
    with pytest.raises(ConfigError, match="port"):
        load_config(f)


def test_ayni_source_adi_iki_kez(tmp_path):
    f = write(
        tmp_path,
        f"""[bellek]
vault = {lit(tmp_path)}
[[source]]
name = "notlar"
path = "a"
[[source]]
name = "notlar"
path = "b"
""",
    )
    with pytest.raises(ConfigError, match="notlar"):
        load_config(f)


def test_source_name_eksik(tmp_path):
    f = write(tmp_path, f'[bellek]\nvault = {lit(tmp_path)}\n[[source]]\npath = "a"\n')
    with pytest.raises(ConfigError, match="name"):
        load_config(f)


def test_source_path_eksik(tmp_path):
    f = write(tmp_path, f'[bellek]\nvault = {lit(tmp_path)}\n[[source]]\nname = "a"\n')
    with pytest.raises(ConfigError, match="path"):
        load_config(f)


def test_bilinmeyen_tablo(tmp_path):
    f = write(tmp_path, f"[bellek]\nvault = {lit(tmp_path)}\n[gizemli]\nx = 1\n")
    with pytest.raises(ConfigError, match="gizemli"):
        load_config(f)


def test_bilinmeyen_anahtar_bellek(tmp_path):
    f = write(tmp_path, f"[bellek]\nvault = {lit(tmp_path)}\nvaltu = 1\n")
    with pytest.raises(ConfigError, match="valtu"):
        load_config(f)


def test_bilinmeyen_anahtar_server(tmp_path):
    f = write(tmp_path, f"[bellek]\nvault = {lit(tmp_path)}\n[server]\nhots = 'x'\n")
    with pytest.raises(ConfigError, match="hots"):
        load_config(f)


def test_bilinmeyen_anahtar_source(tmp_path):
    f = write(
        tmp_path,
        f"[bellek]\nvault = {lit(tmp_path)}\n[[source]]\nname = 'a'\npath = 'b'\nrenk = 'mavi'\n",
    )
    with pytest.raises(ConfigError, match="renk"):
        load_config(f)


def test_yanlis_tip_vault(tmp_path):
    f = write(tmp_path, "[bellek]\nvault = 5\n")
    with pytest.raises(ConfigError):
        load_config(f)


def test_yanlis_tip_state_dir(tmp_path):
    f = write(tmp_path, f"[bellek]\nvault = {lit(tmp_path)}\nstate_dir = 5\n")
    with pytest.raises(ConfigError):
        load_config(f)


def test_yanlis_tip_host(tmp_path):
    f = write(tmp_path, f"[bellek]\nvault = {lit(tmp_path)}\n[server]\nhost = 1\n")
    with pytest.raises(ConfigError):
        load_config(f)


def test_yanlis_tip_proje_adi(tmp_path):
    f = write(tmp_path, f"[bellek]\nvault = {lit(tmp_path)}\n[projects]\n'a' = 3\n")
    with pytest.raises(ConfigError):
        load_config(f)


def test_yanlis_tip_source_adi(tmp_path):
    f = write(tmp_path, f"[bellek]\nvault = {lit(tmp_path)}\n[[source]]\nname = 1\npath = 'a'\n")
    with pytest.raises(ConfigError):
        load_config(f)


def test_bellek_tablo_degil(tmp_path):
    f = write(tmp_path, "bellek = 3\n")
    with pytest.raises(ConfigError):
        load_config(f)


# ---------------------------------------------------------------- project_for_cwd


def make_cfg(tmp_path: Path, projects: dict[Path, str]) -> Config:
    return Config(
        config_path=tmp_path / "bellek.toml",
        vault=tmp_path / "vault",
        state_dir=tmp_path / "state",
        sources=(),
        server_host="127.0.0.1",
        server_port=47321,
        projects=projects,
    )


@pytest.fixture
def kok(tmp_path) -> Path:
    return tmp_path.resolve()


def test_pfc_tam_eslesme(kok):
    cfg = make_cfg(kok, {kok / "Ucgenler": "Uc"})
    assert project_for_cwd(cfg, kok / "Ucgenler") == "Uc"


def test_pfc_alt_klasor(kok):
    cfg = make_cfg(kok, {kok / "Ucgenler": "Uc"})
    assert project_for_cwd(cfg, kok / "Ucgenler" / "lib" / "src") == "Uc"


def test_pfc_en_uzun_onek(kok):
    cfg = make_cfg(
        kok,
        {
            kok / "w": "genel",
            kok / "w" / "uygulama": "uyg",
            kok / "w" / "uygulama" / "ic": "ic",
        },
    )
    assert project_for_cwd(cfg, kok / "w" / "uygulama" / "ic" / "x") == "ic"
    assert project_for_cwd(cfg, kok / "w" / "uygulama" / "baska") == "uyg"
    assert project_for_cwd(cfg, kok / "w" / "diger") == "genel"


def test_pfc_en_uzun_onek_ekleme_sirasindan_bagimsiz(kok):
    cfg = make_cfg(kok, {kok / "w" / "a": "derin", kok / "w": "genel"})
    assert project_for_cwd(cfg, kok / "w" / "a" / "b") == "derin"


def test_pfc_bilesen_siniri(kok):
    cfg = make_cfg(kok, {kok / "Uc": "kisa"})
    assert project_for_cwd(cfg, kok / "Ucgenler") is None
    assert project_for_cwd(cfg, kok / "Ucgenler" / "x") is None
    assert project_for_cwd(cfg, kok / "Uc" / "x") == "kisa"


def test_pfc_bilesen_siniri_uzun_kisa_birlikte(kok):
    cfg = make_cfg(kok, {kok / "Uc": "kisa", kok / "Ucgenler": "uzun"})
    assert project_for_cwd(cfg, kok / "Ucgenler" / "x") == "uzun"
    assert project_for_cwd(cfg, kok / "Ucx") is None


def test_pfc_eslesmeme(kok):
    cfg = make_cfg(kok, {kok / "a": "A"})
    assert project_for_cwd(cfg, kok / "b") is None
    assert project_for_cwd(cfg, kok) is None


def test_pfc_bos_projects(kok):
    assert project_for_cwd(make_cfg(kok, {}), kok / "x") is None


def test_pfc_ust_klasor_kapsamaz(kok):
    cfg = make_cfg(kok, {kok / "a" / "b": "AB"})
    assert project_for_cwd(cfg, kok / "a") is None


@pytest.mark.skipif(not WIN, reason="büyük/küçük harf duyarsızlığı Windows'a özgü")
def test_pfc_buyuk_kucuk_harf(kok):
    cfg = make_cfg(kok, {kok / "Ucgenler": "Uc"})
    assert project_for_cwd(cfg, Path(str(kok / "Ucgenler" / "Lib").upper())) == "Uc"
    assert project_for_cwd(cfg, Path(str(kok / "Ucgenler").lower())) == "Uc"


@pytest.mark.skipif(not WIN, reason="ayraç duyarsızlığı Windows'a özgü")
def test_pfc_ayrac_duyarsiz(tmp_path):
    kok = tmp_path.resolve()
    ileri = str(kok / "Ucgenler").replace("\\", "/")
    f = write(tmp_path, f'[bellek]\nvault = {lit(kok)}\n[projects]\n"{ileri}" = "Uc"\n')
    cfg = load_config(f)
    assert project_for_cwd(cfg, kok / "Ucgenler" / "x") == "Uc"
    assert project_for_cwd(cfg, Path(ileri + "/x/y")) == "Uc"
    assert project_for_cwd(cfg, Path(ileri)) == "Uc"


@pytest.mark.skipif(not WIN, reason="ayraç duyarsızlığı Windows'a özgü")
def test_pfc_ileri_egik_bilesen_siniri(kok):
    cfg = make_cfg(kok, {kok / "Uc": "kisa"})
    cwd = Path(str(kok / "Ucgenler").replace("\\", "/"))
    assert project_for_cwd(cfg, cwd) is None


def test_pfc_load_config_ile_uctan_uca(tmp_path):
    kok = tmp_path.resolve()
    f = write(
        tmp_path,
        f"""[bellek]
vault = {lit(kok / 'v')}
[projects]
"p/genel" = "G"
"p/genel/ozel" = "O"
""",
    )
    cfg = load_config(f)
    assert project_for_cwd(cfg, kok / "p" / "genel" / "ozel" / "z") == "O"
    assert project_for_cwd(cfg, kok / "p" / "genel" / "baska") == "G"
    assert project_for_cwd(cfg, kok / "p" / "genelx") is None


# ------------------------------------------- regresyon: cwd açılımı, tanımsız değişken, çakışan anahtar


def _env_ref(name: str) -> str:
    return f"%{name}%" if WIN else f"${name}"


def test_pfc_cwd_ortam_degiskeni_acilmaz(tmp_path, monkeypatch):
    kok = tmp_path.resolve()
    monkeypatch.setenv("BELLEK_TEST_X", "digerklasor")
    cfg = make_cfg(kok, {kok / "digerklasor": "Diger"})
    # Açılsaydı kok/digerklasor/alt olur ve eşleşirdi.
    cwd = kok / _env_ref("BELLEK_TEST_X") / "alt"
    assert project_for_cwd(cfg, cwd) is None


def test_pfc_cwd_tilde_acilmaz(tmp_path, monkeypatch):
    kok = tmp_path.resolve()
    home = kok / "home"
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    cfg = make_cfg(kok, {home / "proj": "P"})
    assert project_for_cwd(cfg, Path("~") / "proj" / "x") is None
    assert project_for_cwd(cfg, Path("~/proj")) is None


def test_pfc_literal_ortam_degiskeni_adli_klasor_eslesir(tmp_path, monkeypatch):
    kok = tmp_path.resolve()
    monkeypatch.setenv("BELLEK_TEST_X", "baska")
    lit_dir = kok / _env_ref("BELLEK_TEST_X")
    cfg = make_cfg(kok, {lit_dir: "Literal"})
    assert project_for_cwd(cfg, lit_dir) == "Literal"
    assert project_for_cwd(cfg, lit_dir / "alt") == "Literal"
    assert project_for_cwd(cfg, kok / "baska") is None


TANIMSIZ = "BELLEK_TANIMSIZ_XYZ"

_REFS = ["$BELLEK_TANIMSIZ_XYZ", "${BELLEK_TANIMSIZ_XYZ}"]
if WIN:
    _REFS.append("%BELLEK_TANIMSIZ_XYZ%")


def _toml_for(field: str, ref: str, tmp_path: Path) -> str:
    v = lit(tmp_path / "v")
    val = f"'{ref}/x'"
    if field == "vault":
        return f"[bellek]\nvault = {val}\n"
    if field == "state_dir":
        return f"[bellek]\nvault = {v}\nstate_dir = {val}\n"
    if field == "source":
        return f"[bellek]\nvault = {v}\n[[source]]\nname = \"a\"\npath = {val}\n"
    if field == "projects":
        return f"[bellek]\nvault = {v}\n[projects]\n{val} = \"P\"\n"
    raise AssertionError(field)


@pytest.mark.parametrize("ref", _REFS)
@pytest.mark.parametrize("field", ["vault", "state_dir", "source", "projects"])
def test_tanimsiz_ortam_degiskeni_hata(tmp_path, monkeypatch, field, ref):
    monkeypatch.delenv(TANIMSIZ, raising=False)
    f = write(tmp_path, _toml_for(field, ref, tmp_path))
    with pytest.raises(ConfigError, match=TANIMSIZ):
        load_config(f)


@pytest.mark.parametrize("ref", ["$BELLEK_TANIMLI_XYZ", "${BELLEK_TANIMLI_XYZ}"])
def test_tanimli_ortam_degiskeni_acilir(tmp_path, monkeypatch, ref):
    monkeypatch.setenv("BELLEK_TANIMLI_XYZ", "gercek")
    f = write(
        tmp_path,
        f"[bellek]\nvault = '{ref}/v'\nstate_dir = '{ref}/s'\n"
        f"[[source]]\nname = \"a\"\npath = '{ref}/src'\n"
        f"[projects]\n'{ref}/p' = \"P\"\n",
    )
    cfg = load_config(f)
    assert cfg.vault.parts[-2:] == ("gercek", "v")
    assert cfg.state_dir.parts[-2:] == ("gercek", "s")
    assert cfg.sources[0].path.parts[-2:] == ("gercek", "src")
    (folder,) = cfg.projects
    assert folder.parts[-2:] == ("gercek", "p")


@pytest.mark.skipif(not WIN, reason="%VAR% yalnız Windows'ta anlamlı")
def test_tanimli_yuzde_ortam_degiskeni_acilir(tmp_path, monkeypatch):
    monkeypatch.setenv("BELLEK_TANIMLI_XYZ", "gercek")
    f = write(tmp_path, "[bellek]\nvault = '%BELLEK_TANIMLI_XYZ%/v'\n")
    assert load_config(f).vault.parts[-2:] == ("gercek", "v")


def _projects_toml(tmp_path: Path, k1: str, k2: str) -> str:
    return (
        f"[bellek]\nvault = {lit(tmp_path / 'v')}\n[projects]\n"
        f"{lit(k1)} = \"A\"\n{lit(k2)} = \"B\"\n"
    )


def _assert_cakisma(tmp_path: Path, k1: str, k2: str) -> None:
    f = write(tmp_path, _projects_toml(tmp_path, k1, k2))
    with pytest.raises(ConfigError) as ei:
        load_config(f)
    msg = str(ei.value)
    assert k1 in msg and k2 in msg


def test_projects_goreli_ve_mutlak_ayni_klasor(tmp_path):
    kok = tmp_path.resolve()
    _assert_cakisma(tmp_path, "proj", str(kok / "proj"))


@pytest.mark.skipif(not WIN, reason="büyük/küçük harf duyarsızlığı Windows'a özgü")
def test_projects_yalniz_buyuk_kucuk_harf_farki(tmp_path):
    _assert_cakisma(tmp_path, "C:/X/Proj", "c:/x/proj")


@pytest.mark.skipif(not WIN, reason="ayraç denkliği Windows'a özgü")
def test_projects_yalniz_ayrac_farki(tmp_path):
    _assert_cakisma(tmp_path, "C:/X/Proj", "C:" + chr(92) + "X" + chr(92) + "Proj")


def test_projects_farkli_klasorler_hata_vermez(tmp_path):
    kok = tmp_path.resolve()
    f = write(tmp_path, _projects_toml(tmp_path, "proj1", str(kok / "proj2")))
    assert len(load_config(f).projects) == 2
