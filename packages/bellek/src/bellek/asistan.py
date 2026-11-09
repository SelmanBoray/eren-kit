"""Arayüzde gösterilen asistan adı.

Kodda sabit bir asistan adı ya da kişiliği yoktur. Ad `EREN_KIT_ASSISTANT_NAME`
ortam değişkeninden okunur; yoksa ya da boşsa "Claude" kullanılır.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

ORTAM_DEGISKENI = "EREN_KIT_ASSISTANT_NAME"
VARSAYILAN_AD = "Claude"
AD_SINIRI = 40


def asistan_adi(env: Mapping[str, str] | None = None) -> str:
    """Gösterilecek asistan adı: tek satır, en çok AD_SINIRI karakter."""
    env = os.environ if env is None else env
    ham = env.get(ORTAM_DEGISKENI) or ""
    ad = " ".join("".join(c for c in ham if c.isprintable()).split())
    if not ad:
        return VARSAYILAN_AD
    return ad[:AD_SINIRI].rstrip()
