"""Bellek ayar yükleyici: `bellek.toml` dosyasını okur ve doğrular.

Ayar dosyası sırası: açık yol (`load_config(yol)`) > `BELLEK_CONFIG` > paket kökündeki
`bellek.toml`. Yalnız sonuncusu örtük seçildiğinde ve dosya yoksa, repoda tutulan nötr
şablon `bellek.example.toml` kullanılır (`Config.template` True olur). Açıkça verilen
bir yol bulunamazsa her zaman `ConfigError` fırlatılır.
"""

from __future__ import annotations

import os
import re
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
from types import MappingProxyType
from typing import Any

DEFAULT_STATE_DIR = "%LOCALAPPDATA%/Bellek"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 47321
CONFIG_NAME = "bellek.toml"
EXAMPLE_CONFIG_NAME = "bellek.example.toml"

_TOP_KEYS = {"bellek", "server", "source", "projects"}
_BELLEK_KEYS = {"vault", "state_dir"}
_SERVER_KEYS = {"host", "port"}
_SOURCE_KEYS = {"name", "path"}


class ConfigError(ValueError):
    """Ayar dosyası eksik, bozuk veya geçersiz."""


@dataclass(frozen=True)
class Source:
    name: str
    path: Path


@dataclass(frozen=True)
class Config:
    config_path: Path
    vault: Path
    state_dir: Path
    sources: tuple[Source, ...]
    server_host: str
    server_port: int
    projects: Mapping[Path, str]
    template: bool = False  # True: bellek.toml yoktu, şablon (bellek.example.toml) yüklendi


def _package_root() -> Path:
    """Paket kökü (pyproject.toml ve bellek.toml'un klasörü; düzenlenebilir kurulum)."""
    return Path(__file__).resolve().parent.parent.parent


def default_config_path() -> Path:
    env = os.environ.get("BELLEK_CONFIG")
    if env:
        return Path(env)
    return _package_root() / CONFIG_NAME


def example_config_path() -> Path:
    """Repoda tutulan nötr ayar şablonu."""
    return _package_root() / EXAMPLE_CONFIG_NAME


def _check_keys(table: Mapping[str, Any], allowed: set[str], where: str) -> None:
    for key in table:
        if key not in allowed:
            raise ConfigError(f"{where} içinde bilinmeyen anahtar: '{key}'")


def _expect_table(value: Any, where: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise ConfigError(f"{where} bir tablo olmalı")
    return value


def _expect_str(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{where} boş olmayan bir metin olmalı")
    return value


# Açılım sözdizimi `ntpath.expandvars` ile aynı: `%%`, `%AD%`, `$$`, `${AD}`, `$AD`.
_VAR_REF = re.compile(r"%%|%([^%]*)%|\$\$|\$\{([^}]*)\}|\$([A-Za-z0-9_\-]+)")


def _undefined_vars(raw: str) -> list[str]:
    """Ham metindeki, ortamda tanımlı olmayan değişken adları (sırayla)."""
    missing: list[str] = []
    for m in _VAR_REF.finditer(raw):
        percent, braced, bare = m.groups()
        if percent is not None and os.name != "nt":
            continue  # POSIX'te %AD% açılmaz, literal kalır
        name = next((g for g in (percent, braced, bare) if g is not None), None)
        if not name:
            continue  # `%%`, `$$` veya boş ad
        if name not in os.environ and name not in missing:
            missing.append(name)
    return missing


def _resolve_path(raw: str, base: Path, where: str = "ayar") -> Path:
    missing = _undefined_vars(raw)
    if missing:
        names = ", ".join(f"'{n}'" for n in missing)
        raise ConfigError(
            f"{where} içinde tanımsız ortam değişkeni: {names} (değer: {raw!r})"
        )
    expanded = os.path.expandvars(os.path.expanduser(raw))
    path = Path(expanded)
    if not path.is_absolute():
        path = base / path
    return Path(os.path.normpath(path))


def _norm_key(path: Path | str) -> tuple[str, ...]:
    """Karşılaştırma için yol bileşenleri (küçük harf, `/` ve `\\` eşdeğer)."""
    text = os.path.normpath(str(path)).replace("/", "\\")
    return tuple(p.lower() for p in PureWindowsPath(text).parts)


def _select_config_path(path: Path | None) -> tuple[Path, bool]:
    """(okunacak ayar dosyası, şablon mu). Şablona yalnız örtük varsayılan yoksa düşülür."""
    if path is not None:
        return Path(path), False
    config_path = default_config_path()
    if not os.environ.get("BELLEK_CONFIG") and not config_path.exists():
        example = example_config_path()
        if example.is_file():
            return example, True
    return config_path, False


def _read_toml(config_path: Path) -> dict[str, Any]:
    try:
        raw_bytes = config_path.read_bytes()
    except FileNotFoundError:
        raise ConfigError(
            f"Ayar dosyası bulunamadı: {config_path}. Şablonu kopyalayın "
            f"({EXAMPLE_CONFIG_NAME} -> {CONFIG_NAME}) ya da BELLEK_CONFIG ile yol verin."
        ) from None
    except OSError as exc:
        raise ConfigError(f"Ayar dosyası okunamadı ({config_path}): {exc}") from None
    try:
        return tomllib.loads(raw_bytes.decode("utf-8"))
    except (tomllib.TOMLDecodeError, UnicodeDecodeError) as exc:
        raise ConfigError(f"Ayar dosyası bozuk ({config_path}): {exc}") from None


def _vault_from(data: Mapping[str, Any], base: Path) -> Path:
    if "bellek" not in data:
        raise ConfigError("[bellek] tablosu eksik")
    bellek = _expect_table(data["bellek"], "[bellek]")
    if "vault" not in bellek:
        raise ConfigError("[bellek] içinde 'vault' zorunlu ama eksik")
    return _resolve_path(_expect_str(bellek["vault"], "[bellek].vault"), base, "[bellek].vault")


def load_vault(path: Path | None = None) -> Path:
    """Yalnız [bellek].vault'u çözer (dosya seçimi load_config ile aynı).

    Ayarın başka bir yerindeki hata (ör. bozuk bir [[source]]) vault'u etkilemez; vault'un
    kendisi çözülemiyorsa ConfigError. Devir hook'u gibi yalnız vault'a ihtiyaç duyanlar için.
    """
    config_path, _ = _select_config_path(path)
    data = _read_toml(config_path)
    return _vault_from(data, config_path.resolve().parent)


def load_config(path: Path | None = None) -> Config:
    config_path, template = _select_config_path(path)
    data = _read_toml(config_path)

    config_path = config_path.resolve()
    base = config_path.parent
    _check_keys(data, _TOP_KEYS, "Ayar dosyası")

    if "bellek" not in data:
        raise ConfigError("[bellek] tablosu eksik")
    bellek = _expect_table(data["bellek"], "[bellek]")
    _check_keys(bellek, _BELLEK_KEYS, "[bellek]")
    vault = _vault_from(data, base)
    state_raw = _expect_str(bellek.get("state_dir", DEFAULT_STATE_DIR), "[bellek].state_dir")
    state_dir = _resolve_path(state_raw, base, "[bellek].state_dir")

    server = _expect_table(data.get("server", {}), "[server]")
    _check_keys(server, _SERVER_KEYS, "[server]")
    host = _expect_str(server.get("host", DEFAULT_HOST), "[server].host")
    port = server.get("port", DEFAULT_PORT)
    if isinstance(port, bool) or not isinstance(port, int):
        raise ConfigError(f"[server].port tam sayı olmalı, bulunan: {port!r}")
    if not 1 <= port <= 65535:
        raise ConfigError(f"[server].port 1–65535 aralığında olmalı, bulunan: {port}")

    raw_sources = data.get("source", [])
    if not isinstance(raw_sources, list):
        raise ConfigError("[[source]] bir tablo listesi olmalı")
    sources: list[Source] = []
    seen: set[str] = set()
    for i, item in enumerate(raw_sources, start=1):
        where = f"[[source]] #{i}"
        table = _expect_table(item, where)
        _check_keys(table, _SOURCE_KEYS, where)
        for req in ("name", "path"):
            if req not in table:
                raise ConfigError(f"{where} içinde '{req}' eksik")
        name = _expect_str(table["name"], f"{where}.name")
        if name in seen:
            raise ConfigError(f"Aynı source adı birden fazla kez kullanılmış: '{name}'")
        seen.add(name)
        src_path = _resolve_path(_expect_str(table["path"], f"{where}.path"), base, f"{where}.path")
        sources.append(Source(name, src_path))

    raw_projects = _expect_table(data.get("projects", {}), "[projects]")
    projects: dict[Path, str] = {}
    owners: dict[tuple[str, ...], str] = {}
    for folder, name in raw_projects.items():
        pname = _expect_str(name, f'[projects]."{folder}"')
        resolved = _resolve_path(
            _expect_str(folder, "[projects] anahtarı"), base, f'[projects]."{folder}"'
        )
        nk = _norm_key(resolved)
        if nk in owners:
            raise ConfigError(
                f"[projects] içinde iki anahtar aynı klasöre çözülüyor: "
                f"'{owners[nk]}' ve '{folder}' ({resolved})"
            )
        owners[nk] = folder
        projects[resolved] = pname

    return Config(
        config_path=config_path,
        vault=vault,
        state_dir=state_dir,
        sources=tuple(sources),
        server_host=host,
        server_port=port,
        projects=MappingProxyType(projects),
        template=template,
    )


def project_for_cwd(config: Config, cwd: Path) -> str | None:
    # cwd veridir: `~`/ortam değişkeni açılımı uygulanmaz, yalnız göreliyse Path.cwd()'ye bağlanır.
    path = Path(cwd)
    if not path.is_absolute():
        path = Path.cwd() / path
    target = _norm_key(Path(os.path.normpath(path)))
    best: tuple[int, str] | None = None
    for folder, name in config.projects.items():
        key = _norm_key(folder)
        if len(key) <= len(target) and target[: len(key)] == key:
            if best is None or len(key) > best[0]:
                best = (len(key), name)
    return best[1] if best else None
