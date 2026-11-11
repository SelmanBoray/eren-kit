"""Paket geneli test yalıtımı: hiçbir test kullanıcının gerçek Bellek verisine ulaşmaz.

Bileşenler kullanıcı verisine giden varsayılan yollarını tek bir platform kökünden türetir
(`bellek.platform_dirs.data_dir`): beyin.db, çevrimdışı kuyruk, servis/köprü günlükleri,
belirteç dosyaları, kapı ve devir durum klasörleri (hook.log dahil). `LOCALAPPDATA` her
platformda bu kökü belirler; macOS/Linux'ta `XDG_DATA_HOME` yalnız LOCALAPPDATA yokken
okunur. Bu yüzden her test için:

- `LOCALAPPDATA` ve `XDG_DATA_HOME` pytest geçici kökünde teste özel bir klasöre yönlendirilir;
- kullanıcının kabuğundan gelen yol geçersiz kılıcıları (`BELLEK_BEYIN_DB`, `BELLEK_KAPI_STATE`,
  `BELLEK_DEVIR_STATE`, `BELLEK_BEYIN_KUYRUK` ...) kaldırılır; böylece o yollar da geçici köke düşer.

Özel değerler açıkça ayarlanmaz (kaldırılır): bir test yalnız `LOCALAPPDATA` verip beyin.db'nin
onun altında olmasını bekleyebilir. Teste özel klasör `tmp_path`'in içinde değil yanındadır;
`tmp_path` içeriğini sabitleyen testler etkilenmez.

Öncelik: testin kendi `monkeypatch.setenv`'i (test gövdesi ya da sonra kurulan fikstür) bu
düzenekten sonra çalışır ve kazanır. Daha geniş kapsamlı (module/session) bir fikstür bir
değişkeni zaten değiştirmişse (değer oturum başındakinden farklıysa) ona dokunulmaz. Çocuk süreç
başlatan testler `dict(os.environ)` ile bu yalıtılmış ortamı devralır; kendi verdikleri değerler
yine kazanır.
"""

from __future__ import annotations

import os

import pytest

# Platform veri kökünü belirleyen değişkenler: teste özel geçici klasöre yönlendirilir.
KOK_DEGISKENLERI = ("LOCALAPPDATA", "XDG_DATA_HOME")

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
    "BELLEK_DEVIR_DIR",
)

# Oturum başındaki (kullanıcının kabuğundan gelen) değerler; güvence testi de bunları kullanır.
OTURUM_BASI_ORTAM: dict[str, str | None] = {
    ad: os.environ.get(ad) for ad in KOK_DEGISKENLERI + YOL_DEGISKENLERI
}


def _kabuktan_mi(ad: str) -> bool:
    """Değişken hâlâ oturum başındaki değerinde mi (kimse bilinçli olarak değiştirmedi mi)."""
    return os.environ.get(ad) == OTURUM_BASI_ORTAM[ad]


@pytest.fixture(autouse=True)
def _kullanici_verisinden_yalit(monkeypatch, tmp_path_factory):
    kok = tmp_path_factory.mktemp("yalitim")
    for ad in KOK_DEGISKENLERI:
        if _kabuktan_mi(ad):
            monkeypatch.setenv(ad, str(kok / ad.lower()))
    for ad in YOL_DEGISKENLERI:
        if OTURUM_BASI_ORTAM[ad] is not None and _kabuktan_mi(ad):
            monkeypatch.delenv(ad, raising=False)
    yield kok
