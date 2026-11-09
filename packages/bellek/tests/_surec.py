"""Test yardımcısı: test sırasında başlatılan süreç ağacını platformdan bağımsız kapatır."""

from __future__ import annotations

import os
import signal
import subprocess

# Popen(..., **YENI_OTURUM): POSIX'te süreç kendi grubunda başlar, böylece torunlarıyla birlikte
# tek sinyalle kapatılabilir. Windows'ta taskkill /T ağacı zaten izler.
YENI_OTURUM: dict = {} if os.name == "nt" else {"start_new_session": True}


def agaci_oldur(p: subprocess.Popen) -> None:
    """Sürecin tüm ağacını zorla kapatır; süreç zaten bitmişse sessizce geçer."""
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return
    try:
        os.killpg(p.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        try:
            p.kill()
        except OSError:
            pass
