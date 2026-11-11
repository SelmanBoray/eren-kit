"""Paket geneli test yalıtımı: hiçbir test kullanıcının gerçek Bellek verisine ulaşmaz.

Kullanıcı verisine giden varsayılan yollar iki kaynaktan çözülür:

1. Platform veri kökü (`bellek.platform_dirs.data_dir`): beyin.db, çevrimdışı kuyruk,
   servis/köprü günlükleri, belirteçler, kapı ve devir durum klasörleri (hook.log dahil).
   `LOCALAPPDATA` her platformda bu kökü belirler; macOS/Linux'ta `XDG_DATA_HOME` yalnız
   LOCALAPPDATA yokken okunur.
2. Ayar dosyası (`BELLEK_CONFIG`, yoksa paket kökündeki `bellek.toml`): vault ve onun altındaki
   devir klasörü (`BELLEK_DEVIR_DIR` yoksa). Canlı kurulumda paket kökündeki `bellek.toml`
   gerçek vault'u gösterir; devir hook'u orada eski notları budayabilir.

Bu yüzden iki katman var:

- Oturum katmanı (`pytest_configure`, toplama öncesi): kabuktan gelen tekil yol geçersiz
  kılıcıları (`BELLEK_BEYIN_DB`, `BELLEK_KAPI_STATE`, ...) kaldırılır; kök değişkenleri,
  `BELLEK_CONFIG` ve `BELLEK_DEVIR_DIR` oturuma özel geçici klasöre yönlendirilir. Toplama anında
  çözülen modül sabitleri (ör. `devir.notlar.DEVIR_KOK`) ve `monkeypatch.undo()` çağıran testler
  de böylece gerçek veriye düşmez. Oturum sonunda ortam eski hâline döner.
- Test katmanı (autouse fikstür): her test için kök değişkenleri, `BELLEK_DEVIR_DIR` ve
  `BELLEK_CONFIG` (vault'u kendi yanında olan boş bir ayar) teste özel taze bir klasöre
  yönlendirilir. Klasör `tmp_path`'in içinde değil yanındadır; `tmp_path` içeriğini sabitleyen
  testler etkilenmez.

Tekil yol değişkenleri (`BELLEK_BEYIN_DB` ...) açıkça ayarlanmaz, yalnız kaldırılır: bir test
yalnız `LOCALAPPDATA` verip beyin.db'nin onun altında olmasını bekleyebilir.

Öncelik: testin kendi `monkeypatch.setenv`/`delenv`'i (test gövdesi ya da sonra kurulan fikstür)
bu düzenekten sonra çalışır ve kazanır; ayar çözümünü sınayan testler kendi `BELLEK_CONFIG`'ini
verir ya da kaldırır. Daha geniş kapsamlı (module/session) bir fikstür bir değişkeni zaten
değiştirmişse (değer oturum katmanınınkinden farklıysa) ona dokunulmaz. Çocuk süreç başlatan
testler `dict(os.environ)` ile bu yalıtılmış ortamı devralır; kendi verdikleri değerler kazanır.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest

# Platform veri kökünü belirleyen değişkenler.
KOK_DEGISKENLERI = ("LOCALAPPDATA", "XDG_DATA_HOME")

# Ayar ve devir klasörü: vault'a (kullanıcı notlarına) giden yol.
AYAR_DEGISKENLERI = ("BELLEK_CONFIG", "BELLEK_DEVIR_DIR")

# Kullanıcı verisine giden tekil yol geçersiz kılıcıları: kabuktan geliyorsa kaldırılır.
YOL_DEGISKENLERI = (
    "BELLEK_BEYIN_DB",
    "BELLEK_BEYIN_KUYRUK",
    "BELLEK_BEYIN_LOG",
    "BELLEK_BEYIN_KOPRU_LOG",
    "BELLEK_BEYIN_TOKEN_DOSYA",
    "BELLEK_BEYIN_ARAYUZ_TOKEN_DOSYA",
    "BELLEK_KAPI_STATE",
    "BELLEK_DEVIR_STATE",
)

TUM_DEGISKENLER = KOK_DEGISKENLERI + AYAR_DEGISKENLERI + YOL_DEGISKENLERI

# Kullanıcının kabuğundan gelen değerler (yalıtımdan önce); güvence testi bunları kullanır.
OTURUM_BASI_ORTAM: dict[str, str | None] = {ad: os.environ.get(ad) for ad in TUM_DEGISKENLER}

# Oturum katmanının kurduğu değerler; test katmanı "kimse değiştirmedi mi" sorusunu buna göre sorar.
_OTURUM_ORTAMI: dict[str, str | None] = {}
_OTURUM_KLASORU: str | None = None


def _yalitilmis_degerler(kok: Path) -> dict[str, str]:
    """`kok` altında yalıtılmış ortam: platform kökleri, boş ayar ve devir klasörü."""
    kok.mkdir(parents=True, exist_ok=True)
    ayar = kok / "bellek.toml"
    ayar.write_text('[bellek]\nvault = "vault"\n', encoding="utf-8")
    return {
        "LOCALAPPDATA": str(kok / "localappdata"),
        "XDG_DATA_HOME": str(kok / "xdg_data_home"),
        "BELLEK_CONFIG": str(ayar),
        "BELLEK_DEVIR_DIR": str(kok / "vault" / "devir"),
    }


def pytest_configure(config):
    global _OTURUM_KLASORU
    if _OTURUM_KLASORU is not None:
        return
    _OTURUM_KLASORU = tempfile.mkdtemp(prefix="bellek-test-oturum-")
    for ad in YOL_DEGISKENLERI:
        os.environ.pop(ad, None)
    os.environ.update(_yalitilmis_degerler(Path(_OTURUM_KLASORU)))
    _OTURUM_ORTAMI.update({ad: os.environ.get(ad) for ad in TUM_DEGISKENLER})


def pytest_unconfigure(config):
    global _OTURUM_KLASORU
    if _OTURUM_KLASORU is None:
        return
    for ad, deger in OTURUM_BASI_ORTAM.items():
        if deger is None:
            os.environ.pop(ad, None)
        else:
            os.environ[ad] = deger
    shutil.rmtree(_OTURUM_KLASORU, ignore_errors=True)
    _OTURUM_KLASORU = None


def _degismemis(ad: str) -> bool:
    """Değişken hâlâ oturum katmanının değerinde mi (daha geniş bir fikstür değiştirmedi mi)."""
    return os.environ.get(ad) == _OTURUM_ORTAMI.get(ad)


@pytest.fixture(autouse=True)
def _kullanici_verisinden_yalit(monkeypatch, tmp_path_factory):
    kok = tmp_path_factory.mktemp("yalitim")
    for ad, deger in _yalitilmis_degerler(kok).items():
        if _degismemis(ad):
            monkeypatch.setenv(ad, deger)
    # YOL_DEGISKENLERI oturum katmanında kaldırıldı; burada hâlâ tanımlıysa onları bilinçli
    # olarak kuran daha geniş kapsamlı bir fikstür vardır, dokunulmaz.
    yield kok
