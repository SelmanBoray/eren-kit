"""Yarıda kesilen yedeklemeden kalan geçici kopyanın temizlenmesi.

Süreç yedek sürerken zorla sonlandırılırsa (Görev Zamanlayıcı durdurması, oturum kapanışı)
yedek dizininde `.beyin-yedek-<hex>.tmp` (ve SQLite yan dosyası) kalır: veritabanının şifresiz
tam ya da yarım kopyası. Bayat olanı sonraki yedeklemede silinir; taze olana (o an süren başka
bir yedekleme olabilir) dokunulmaz; silme hatası yedeği düşürmez.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from bellek.beyin import db, yedek


@pytest.fixture()
def kur(tmp_path):
    db_yol = tmp_path / "beyin.db"
    db.baglan(db_yol).close()
    dizin = tmp_path / "yedekler"
    dizin.mkdir()
    return db_yol, dizin


def _artik(dizin: Path, ad: str, yas: float) -> Path:
    p = dizin / ad
    p.write_bytes(b"SQLite format 3\x00 yarim kopya")
    t = time.time() - yas
    os.utime(p, (t, t))
    return p


def test_bayat_gecici_kopya_ve_yan_dosyasi_silinir(kur):
    db_yol, dizin = kur
    eski = _artik(dizin, ".beyin-yedek-0123456789ab.tmp", 2 * 3600)
    eski_yan = _artik(dizin, ".beyin-yedek-0123456789ab.tmp-journal", 2 * 3600)
    yedek.yedekle(db_yol, dizin)
    assert not eski.exists() and not eski_yan.exists()


def test_taze_gecici_kopyaya_dokunulmaz(kur):
    """O an başka bir süreçte süren yedeklemenin geçici dosyası silinmez."""
    db_yol, dizin = kur
    taze = _artik(dizin, ".beyin-yedek-aaaaaaaaaaaa.tmp", 60)
    yedek.yedekle(db_yol, dizin)
    assert taze.exists()


def test_kaliba_uymayan_dosyaya_dokunulmaz(kur):
    db_yol, dizin = kur
    baska = _artik(dizin, ".beyin-yedek-notlar.tmp", 10 * 24 * 3600)
    kullanici = _artik(dizin, "benim.tmp", 10 * 24 * 3600)
    yedek.yedekle(db_yol, dizin)
    assert baska.exists() and kullanici.exists()


def test_yedek_basarisiz_olsa_da_bayat_kopya_silinir(kur, monkeypatch):
    """Yedek art arda başarısız olsa da artık birikmez (temizlik kopyadan önce yapılır)."""
    db_yol, dizin = kur
    eski = _artik(dizin, ".beyin-yedek-0123456789ab.tmp", 2 * 3600)

    def patla(*a, **kw):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(yedek, "_sqlite_kopyala", patla)
    with pytest.raises(yedek.YedekHatasi):
        yedek.yedekle(db_yol, dizin)
    assert not eski.exists()


def test_silme_hatasi_yedegi_dusurmez(kur, monkeypatch):
    db_yol, dizin = kur
    eski = _artik(dizin, ".beyin-yedek-0123456789ab.tmp", 2 * 3600)
    gercek = Path.unlink

    def kilitli(self, *a, **kw):
        if self.name.startswith(".beyin-yedek-0123456789ab"):
            raise PermissionError(13, "kullanımda")
        return gercek(self, *a, **kw)

    monkeypatch.setattr(Path, "unlink", kilitli)
    yeni = yedek.yedekle(db_yol, dizin)
    yedek.dogrula(yeni)
    assert eski.exists()
