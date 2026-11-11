"""Bellek sağlık kontrolü: ortamın ve yapılandırmanın kullanıma hazır olup olmadığını denetler."""

from __future__ import annotations

import json
import re
import sqlite3
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
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


# ---- Beyin veritabanı ------------------------------------------------------------
#
# Salt okunur açma (WAL inceliği): `mode=ro` bağlantısı WAL kipindeki bir veritabanında
# `-wal`/`-shm` yoksa onları oluşturur ve kapanınca silemez (yan dosya kalır). Bu yüzden
# `-wal` ve `-journal` yoksa (= açık yazıcı yok, her şey ana dosyada) `immutable=1` ile
# kilitsiz ve yan dosyasız okunur. Kilitsiz okuma, tam o anda açılıp kapanan bir yazıcının
# checkpoint'ine denk gelirse sahte bozulma görebilir; bu yüzden immutable okumada çıkan
# bütünlük hatası normal `mode=ro` ile bir kez daha doğrulanır. `-wal` varsa yazıcı açıktır
# (ya da kirli kapanmıştır): normal `mode=ro` mevcut yan dosyaları kullanır, yenisini açmaz.
# Hiçbir yolda ana dosyaya yazılmaz; FTS5 `integrity-check` bir INSERT komutu olduğundan
# salt okunur bağlantıda çalışmaz, bellekteki kopyada (backup API) koşturulur.

_INTEGRITY_FULL_MAX_BYTES = 64 * 1024 * 1024  # üstünde quick_check (O(N), indeks-tablo eşleşmesi hariç)
_FTS_COPY_MAX_BYTES = 64 * 1024 * 1024  # üstünde FTS5 integrity-check için belleğe kopyalanmaz
_BUSY_TIMEOUT_MS = 2000
_ORPHAN_SAMPLE = 3
_INBOX_STALE_DAYS = 14
_QUEUE_STALE_HOURS = 24
_HOOK_LOG_DAYS = 7


class _SchemaUnknown(Exception):
    """Şema sürümü kodun bildiğinden yeni ya da geçersiz; ayrıntılı denetim atlanır."""


def _beyin_db_path() -> Path:
    from bellek.beyin import db

    return Path(db.varsayilan_yol())


def _ro_uri(path: Path, immutable: bool) -> str:
    uri = path.resolve().as_uri() + "?mode=ro"
    return uri + "&immutable=1" if immutable else uri


def _can_open_immutable(path: Path) -> bool:
    return not Path(f"{path}-wal").exists() and not Path(f"{path}-journal").exists()


def _connect_ro(path: Path, immutable: bool) -> sqlite3.Connection:
    from bellek.beyin import db

    con = sqlite3.connect(_ro_uri(path, immutable), uri=True, timeout=_BUSY_TIMEOUT_MS / 1000)
    try:
        con.execute(f"PRAGMA busy_timeout = {_BUSY_TIMEOUT_MS}")
        con.create_function("bellek_normalize", 1, db.normalize, deterministic=True)
    except BaseException:
        con.close()
        raise
    return con


def _schema_version(con: sqlite3.Connection) -> int:
    return int(con.execute("PRAGMA user_version").fetchone()[0])


def _open_beyin(path: Path) -> sqlite3.Connection:
    """Şema sürümü tanınan veritabanını salt okunur açar; tanınmıyorsa _SchemaUnknown."""
    from bellek.beyin import db

    con = _connect_ro(path, _can_open_immutable(path))
    try:
        version = _schema_version(con)
    except BaseException:
        con.close()
        raise
    if version < 0 or version > db.SEMA_SURUMU:
        con.close()
        raise _SchemaUnknown(version)
    return con


def _has_table(con: sqlite3.Connection, name: str) -> bool:
    row = con.execute("SELECT 1 FROM sqlite_master WHERE name = ?", (name,)).fetchone()
    return row is not None


def _integrity_problems(con: sqlite3.Connection, full: bool) -> list[str]:
    pragma = "integrity_check" if full else "quick_check"
    rows = [str(r[0]) for r in con.execute(f"PRAGMA {pragma}(5)").fetchall()]
    return [] if rows == ["ok"] else rows


def _short(text: str, limit: int = 120) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _check_beyin_db(path: Path) -> Check:
    from bellek.beyin import db

    if not path.exists():
        return Check("beyin_db", OK, f"Beyin veritabanı henüz oluşturulmamış ({path}); ilk yazmada oluşturulur.")
    if not path.is_file():
        return Check("beyin_db", ERROR, f"Beyin veritabanı yolu bir dosya değil: {path}. BELLEK_BEYIN_DB'yi düzeltin.")
    full = path.stat().st_size <= _INTEGRITY_FULL_MAX_BYTES
    method = "integrity_check" if full else "quick_check (büyük dosya)"
    immutable = _can_open_immutable(path)
    try:
        con = _connect_ro(path, immutable)
        try:
            version = _schema_version(con)
            problems = _integrity_problems(con, full)
            if problems and immutable:
                con.close()
                con = _connect_ro(path, False)  # eşzamanlı checkpoint'e karşı kilitli yeniden doğrula
                version = _schema_version(con)
                problems = _integrity_problems(con, full)
            nodes = con.execute("SELECT count(*) FROM dugum").fetchone()[0] if _has_table(con, "dugum") else 0
        finally:
            con.close()
    except sqlite3.DatabaseError as exc:
        return Check(
            "beyin_db",
            ERROR,
            f"Beyin veritabanı okunamıyor ya da bozuk ({path}): {_short(exc)}. Yedekten geri yükleyin.",
        )
    if problems:
        return Check(
            "beyin_db",
            ERROR,
            f"Beyin veritabanı bütünlük denetimini geçmedi ({method}): {_short('; '.join(problems))}. "
            "Yedekten geri yükleyin.",
        )
    if version < 0 or version > db.SEMA_SURUMU:
        return Check(
            "beyin_db",
            ERROR,
            f"Beyin şema sürümü {version} tanınmıyor (bu kod en çok {db.SEMA_SURUMU} biliyor). Bellek'i güncelleyin.",
        )
    if version < db.SEMA_SURUMU:
        return Check(
            "beyin_db",
            WARN,
            f"Beyin şema sürümü {version} eski (beklenen {db.SEMA_SURUMU}); ilk yazma bağlantısı veri "
            f"silmeden göç eder. {nodes} düğüm.",
        )
    return Check("beyin_db", OK, f"Beyin veritabanı sağlam: {nodes} düğüm, şema sürümü {version} ({method}).")


def _beyin_skip(name: str, path: Path) -> Check | None:
    """Veritabanı yoksa ya da dosya değilse ayrıntılı denetim atlanır."""
    if not path.exists():
        return Check(name, OK, "Beyin veritabanı henüz oluşturulmamış; atlandı.")
    if not path.is_file():
        return Check(name, OK, "Beyin veritabanı yolu dosya değil; atlandı (bkz. beyin_db).")
    return None


def _run_on_beyin(name: str, path: Path, body: Callable[[sqlite3.Connection], Check]) -> Check:
    skipped = _beyin_skip(name, path)
    if skipped is not None:
        return skipped
    try:
        con = _open_beyin(path)
    except _SchemaUnknown:
        return Check(name, OK, "Şema sürümü tanınmıyor; atlandı (bkz. beyin_db).")
    except sqlite3.DatabaseError as exc:
        return Check(name, ERROR, f"Beyin veritabanı açılamadı: {_short(exc)}.")
    try:
        if not _has_table(con, "dugum"):
            return Check(name, OK, "Beyin şeması henüz kurulmamış; atlandı.")
        return body(con)
    except sqlite3.DatabaseError as exc:
        return Check(name, ERROR, f"Beyin veritabanı okunurken hata: {_short(exc)} (bkz. beyin_db).")
    finally:
        con.close()


def _fts_body(path: Path) -> Callable[[sqlite3.Connection], Check]:
    def body(con: sqlite3.Connection) -> Check:
        from bellek.beyin import db

        if not _has_table(con, "dugum_fts"):
            return Check("beyin_fts", ERROR, "Tam metin indeksi (dugum_fts) yok. Yazma bağlantısı şemayı yeniden kurar.")
        problems: list[str] = []
        integrity = "FTS5 integrity-check"
        work = con
        mem: sqlite3.Connection | None = None
        try:
            if path.stat().st_size <= _FTS_COPY_MAX_BYTES:
                mem = sqlite3.connect(":memory:")
                con.backup(mem)
                mem.create_function("bellek_normalize", 1, db.normalize, deterministic=True)
                work = mem
                try:
                    mem.execute("INSERT INTO dugum_fts(dugum_fts) VALUES('integrity-check')")
                except sqlite3.DatabaseError as exc:
                    problems.append(f"indeks bozuk ({_short(exc, 80)})")
            else:
                integrity = "FTS5 integrity-check atlandı (büyük dosya)"

            node_ids = {r[0] for r in work.execute("SELECT id FROM dugum")}
            fts_rows: dict[str, tuple[str, ...]] = {}
            duplicates = 0
            for row in work.execute("SELECT id, baslik, ozet, ayrinti, olgular FROM dugum_fts"):
                if row[0] in fts_rows:
                    duplicates += 1
                fts_rows[row[0]] = tuple(v or "" for v in row[1:])
            missing = len(node_ids - fts_rows.keys())
            extra = len(fts_rows.keys() - node_ids)
            stale = 0
            selection = getattr(db, "_FTS_SECIM", None)
            if selection:
                for row in work.execute(selection):
                    current = fts_rows.get(row[0])
                    if current is not None and current != tuple(v or "" for v in row[1:]):
                        stale += 1
        finally:
            if mem is not None:
                mem.close()
        if missing:
            problems.append(f"{missing} düğüm indekste yok")
        if extra:
            problems.append(f"{extra} indeks satırı var olmayan düğüme ait")
        if duplicates:
            problems.append(f"{duplicates} yinelenen indeks satırı")
        if stale:
            problems.append(f"{stale} düğümün indeks içeriği güncel değil")
        if problems:
            return Check(
                "beyin_fts",
                ERROR,
                "Tam metin indeksi tutarsız: " + "; ".join(problems)
                + ". İndeksi yeniden kurun (db.fts_yeniden_kur).",
            )
        return Check("beyin_fts", OK, f"Tam metin indeksi tutarlı: {len(node_ids)} düğüm ({integrity}).")

    return body


def _orphan_body(con: sqlite3.Connection) -> Check:
    from bellek.beyin import db

    root = db.kok_bul(con)
    where = (
        "d.id IS NOT ? AND NOT EXISTS (SELECT 1 FROM kenar k"
        " WHERE k.cocuk = d.id AND k.tur = 'alt' AND k.birincil = 1)"
    )
    count = con.execute(f"SELECT count(*) FROM dugum d WHERE {where}", (root,)).fetchone()[0]
    if not count:
        return Check("beyin_yetim", OK, "Kök dışındaki her düğümün birincil ebeveyni var.")
    sample = con.execute(
        f"SELECT d.id, d.baslik, d.gizlilik FROM dugum d WHERE {where} ORDER BY d.olusturma, d.id LIMIT ?",
        (root, _ORPHAN_SAMPLE),
    ).fetchall()
    # Başlık yalnız 'normal' gizlilikte gösterilir; diğerlerinde yalnız kimlik.
    names = [f"{_short(b, 40)} ({i})" if g == "normal" else str(i) for i, b, g in sample]
    more = f" ve {count - len(sample)} tane daha" if count > len(sample) else ""
    no_root = " Kök düğüm bulunamadı." if root is None else ""
    return Check(
        "beyin_yetim",
        WARN,
        f"{count} düğümün birincil ebeveyni yok: {', '.join(names)}{more}.{no_root} "
        "Bunları bir dala bağlayın.",
    )


def _parse_time(text: str) -> datetime | None:
    try:
        moment = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.astimezone()


def _inbox_body(con: sqlite3.Connection) -> Check:
    if not _has_table(con, "gelen"):
        return Check("beyin_gelen", OK, "Gelen kutusu tablosu yok; atlandı.")
    rows = con.execute("SELECT zaman FROM gelen WHERE durum = 'bekliyor'").fetchall()
    if not rows:
        return Check("beyin_gelen", OK, "Gelen kutusunda bekleyen öneri yok.")
    times = [t for t in (_parse_time(str(r[0])) for r in rows) if t is not None]
    oldest_days = (datetime.now(timezone.utc) - min(times)).days if times else 0
    if oldest_days >= _INBOX_STALE_DAYS:
        return Check(
            "beyin_gelen",
            WARN,
            f"Gelen kutusunda {len(rows)} öneri bekliyor; en eskisi {oldest_days} gündür karar bekliyor. "
            "Önerileri gözden geçirip kabul ya da red edin.",
        )
    return Check("beyin_gelen", OK, f"Gelen kutusunda {len(rows)} öneri bekliyor (en eskisi {oldest_days} gün).")


def _check_beyin_queue() -> Check:
    from bellek.beyin import servis

    queue = Path(servis._kuyruk_yolu())
    files: list[Path] = []
    if queue.is_file() and queue.stat().st_size > 0:
        files.append(queue)
    if queue.parent.is_dir():
        files += sorted(p for p in queue.parent.glob(servis.glob_kacis(queue.name) + ".*.isleniyor") if p.is_file())
    if not files:
        return Check("beyin_kuyruk", OK, "Bekleyen çevrimdışı beyin yazması yok.")
    pending = 0
    oldest: datetime | None = None
    for f in files:
        lines = [ln for ln in f.read_bytes().decode("utf-8", errors="replace").splitlines() if ln.strip()]
        pending += len(lines)
        moment: datetime | None = None
        if lines:
            try:
                first = json.loads(lines[0])
                moment = _parse_time(str(first.get("kuyruk_zamani", ""))) if isinstance(first, dict) else None
            except ValueError:
                moment = None
        if moment is None:
            moment = datetime.fromtimestamp(f.stat().st_mtime, timezone.utc)
        oldest = moment if oldest is None or moment < oldest else oldest
    if not pending:
        return Check("beyin_kuyruk", OK, "Bekleyen çevrimdışı beyin yazması yok.")
    hours = int((datetime.now(timezone.utc) - oldest).total_seconds() // 3600) if oldest else 0
    if hours >= _QUEUE_STALE_HOURS:
        return Check(
            "beyin_kuyruk",
            WARN,
            f"{pending} çevrimdışı beyin yazması {hours} saattir işlenmeyi bekliyor; beyin servisi "
            "çalışmıyor olabilir. Servisi başlatın.",
        )
    return Check("beyin_kuyruk", OK, f"{pending} çevrimdışı beyin yazması işlenmeyi bekliyor ({hours} saat).")


# ---- Hook hata günlükleri --------------------------------------------------------

_LOG_ENTRY = re.compile(r"^\[([^\]\s]+)\] ?(.*)$")
_EXC_LINE = re.compile(r"^([A-Za-z_][\w.]*)(?::|$)")
_PATH_LIKE = re.compile(r"""(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|/(?:Users|home|mnt|tmp|var|root|[a-z])/)[^\s'"<>|,;)]*""")
_TRACEBACK_HEAD = "Traceback (most recent call last):"


def _hook_log_paths() -> list[tuple[str, Path]]:
    from bellek.devir import hook as devir_hook
    from bellek.kapi import hook as kapi_hook

    return [
        ("kapı", Path(kapi_hook.state_dir()) / "hook.log"),
        ("devir", Path(devir_hook.state_dir()) / "hook.log"),
    ]


def _summarize_entry(first: str, rest: list[str]) -> str:
    """Tek satırlık, yol ve serbest metin sızdırmayan özet: bağlam + istisna türü."""
    context = first.split(_TRACEBACK_HEAD, 1)[0].strip().rstrip(":").strip()
    exc_type = ""
    if _TRACEBACK_HEAD in first or any(ln.startswith(_TRACEBACK_HEAD) for ln in rest):
        for line in reversed(rest):
            m = _EXC_LINE.match(line)
            if m and not line.startswith(("Traceback", "During handling", "The above exception")):
                exc_type = m.group(1).rsplit(".", 1)[-1]
                break
        summary = f"{context}: {exc_type}" if context and exc_type else (context or exc_type or "istisna")
    else:
        # Düz iletide yalnız baştaki sabit kısım: parantez/iki nokta sonrası değişken ayrıntı taşır.
        summary = re.split(r"[(:;]", context, maxsplit=1)[0].strip()
    summary = _PATH_LIKE.sub("<yol>", summary)
    return _short(summary, 80) or "(boş kayıt)"


def _read_hook_errors(path: Path, since: datetime) -> tuple[int, datetime | None, str]:
    """(son dönemdeki kayıt sayısı, en son kaydın zamanı, en son kaydın özeti)."""
    text = path.read_bytes().decode("utf-8", errors="replace")
    entries: list[tuple[datetime, str, list[str]]] = []
    for line in text.splitlines():
        m = _LOG_ENTRY.match(line)
        moment = _parse_time(m.group(1)) if m else None
        if m and moment is not None:
            entries.append((moment, m.group(2), []))
        elif entries:
            entries[-1][2].append(line)
    recent = [e for e in entries if e[0] >= since]
    if not recent:
        return 0, None, ""
    latest = max(recent, key=lambda e: e[0])
    return len(recent), latest[0], _summarize_entry(latest[1], latest[2])


def _check_hook_logs() -> Check:
    since = datetime.now(timezone.utc) - timedelta(days=_HOOK_LOG_DAYS)
    parts: list[str] = []
    unreadable: list[str] = []
    for component, path in _hook_log_paths():
        if not path.is_file():
            continue
        try:
            count, latest, summary = _read_hook_errors(path, since)
        except OSError as exc:
            unreadable.append(f"{component} ({exc.strerror or type(exc).__name__})")
            continue
        if count:
            when = latest.astimezone().strftime("%Y-%m-%d %H:%M") if latest else "?"
            parts.append(f"{component} {count} (son: {when}, {summary})")
    if parts:
        extra = f"; okunamayan: {', '.join(unreadable)}" if unreadable else ""
        return Check(
            "hook_gunluk",
            WARN,
            f"Son {_HOOK_LOG_DAYS} günde hook hatası: {'; '.join(parts)}{extra}. "
            "Ayrıntı bileşenin durum klasöründeki hook.log'da.",
        )
    if unreadable:
        return Check("hook_gunluk", WARN, f"Hook günlüğü okunamadı: {', '.join(unreadable)}.")
    return Check("hook_gunluk", OK, f"Son {_HOOK_LOG_DAYS} günde hook hatası yok.")


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
    # Yol her denetimde yeniden çözülür: çözüm hatası da _safe ile o denetimin error'ı olur.
    checks += [
        _safe("beyin_db", lambda: _check_beyin_db(_beyin_db_path())),
        _safe("beyin_fts", lambda: _run_on_beyin("beyin_fts", _beyin_db_path(), _fts_body(_beyin_db_path()))),
        _safe("beyin_yetim", lambda: _run_on_beyin("beyin_yetim", _beyin_db_path(), _orphan_body)),
        _safe("beyin_gelen", lambda: _run_on_beyin("beyin_gelen", _beyin_db_path(), _inbox_body)),
        _safe("beyin_kuyruk", _check_beyin_queue),
        _safe("hook_gunluk", _check_hook_logs),
    ]
    return DoctorReport(tuple(checks))
