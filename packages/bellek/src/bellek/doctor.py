"""Bellek sağlık kontrolü: ortamın ve yapılandırmanın kullanıma hazır olup olmadığını denetler."""

from __future__ import annotations

import sqlite3
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bellek.config import Config

OK = "ok"
WARN = "warn"
ERROR = "error"

_SEVERITY: dict[str, int] = {OK: 0, WARN: 1, ERROR: 2}
_MIN_PYTHON: tuple[int, int] = (3, 12)


@dataclass(frozen=True)
class Check:
    name: str
    status: str  # "ok" | "warn" | "error"
    detail: str


@dataclass(frozen=True)
class DoctorReport:
    checks: tuple[Check, ...]

    @property
    def status(self) -> str:
        """En kötü durumu döner (error > warn > ok); boşsa "ok"."""
        worst = OK
        for check in self.checks:
            if _SEVERITY.get(check.status, 2) > _SEVERITY[worst]:
                worst = check.status if check.status in _SEVERITY else ERROR
        return worst


def _check_python() -> Check:
    v = sys.version_info
    version = f"{v.major}.{v.minor}.{v.micro}"
    if (v.major, v.minor) >= _MIN_PYTHON:
        return Check("python", OK, f"Python {version}")
    return Check(
        "python",
        ERROR,
        f"Python {version} çok eski; en az {_MIN_PYTHON[0]}.{_MIN_PYTHON[1]} gerekli. Python'u güncelleyin.",
    )


def _check_template(config_path: Path) -> Check:
    return Check(
        "config",
        WARN,
        f"bellek.toml yok; şablon kullanılıyor: {config_path}. Kendi ayarınız için şablonu "
        "aynı klasöre bellek.toml adıyla kopyalayıp düzenleyin.",
    )


def _check_vault(vault: Path) -> Check:
    if vault.is_dir():
        return Check("vault", OK, f"Kasa klasörü mevcut: {vault}")
    return Check(
        "vault",
        ERROR,
        f"Kasa klasörü bulunamadı: {vault}. Klasörü oluşturun ya da bellek.toml'daki yolu düzeltin.",
    )


def _is_writable_dir(path: Path) -> bool:
    """Klasöre yazılabilir mi? Geçici dosya kapatılınca işletim sistemi tarafından silinir."""
    with tempfile.TemporaryFile(dir=path):
        pass
    return True


def _check_state_dir(state_dir: Path) -> Check:
    if not state_dir.is_dir():
        return Check("state_dir", WARN, f"Durum klasörü yok: {state_dir}. İlk kullanımda oluşturulacak.")
    try:
        _is_writable_dir(state_dir)
    except OSError as exc:
        return Check(
            "state_dir",
            ERROR,
            f"Durum klasörüne yazılamıyor: {state_dir} ({exc.strerror or exc}). Klasör izinlerini kontrol edin.",
        )
    return Check("state_dir", OK, f"Durum klasörü mevcut ve yazılabilir: {state_dir}")


def _check_source(name: str, path: Path) -> Check:
    check_name = f"source:{name}"
    if path.is_dir():
        return Check(check_name, OK, f"Kaynak klasörü mevcut: {path}")
    return Check(
        check_name,
        WARN,
        f"Kaynak klasörü bulunamadı: {path}. Yolu düzeltin ya da kaynağı bellek.toml'dan kaldırın.",
    )


def _check_fts5() -> Check:
    conn = sqlite3.connect(":memory:")
    try:
        conn.execute("CREATE VIRTUAL TABLE _bellek_probe USING fts5(content)")
    except sqlite3.Error as exc:
        return Check(
            "sqlite_fts5",
            ERROR,
            f"SQLite FTS5 kullanılamıyor ({exc}). FTS5 destekli bir Python/SQLite sürümü gerekli.",
        )
    finally:
        conn.close()
    return Check("sqlite_fts5", OK, f"FTS5 kullanılabilir (SQLite {sqlite3.sqlite_version})")


def _safe(name: str, func: Callable[[], Check]) -> Check:
    try:
        return func()
    except Exception as exc:  # noqa: BLE001 - tek kontrol raporu kesmemeli
        return Check(name, ERROR, f"Kontrol beklenmedik şekilde başarısız oldu: {type(exc).__name__}: {exc}")


def run_checks(config: Config) -> DoctorReport:
    """Tüm sağlık kontrollerini sabit sırayla çalıştırır; kalıcı hiçbir değişiklik yapmaz."""
    checks: list[Check] = []
    if getattr(config, "template", False):
        checks.append(_safe("config", lambda: _check_template(Path(config.config_path))))
    checks += [
        _safe("python", _check_python),
        _safe("vault", lambda: _check_vault(Path(config.vault))),
        _safe("state_dir", lambda: _check_state_dir(Path(config.state_dir))),
    ]
    try:
        sources = tuple(config.sources)
    except Exception as exc:  # noqa: BLE001
        checks.append(Check("sources", ERROR, f"Kaynak listesi okunamadı: {type(exc).__name__}: {exc}"))
        sources = ()
    for source in sources:
        checks.append(
            _safe(
                f"source:{getattr(source, 'name', '?')}",
                lambda s=source: _check_source(s.name, Path(s.path)),
            )
        )
    checks.append(_safe("sqlite_fts5", _check_fts5))
    return DoctorReport(tuple(checks))
