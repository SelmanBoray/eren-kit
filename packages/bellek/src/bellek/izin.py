"""Durum dosyaları ve klasörleri yalnız sahibine açık (POSIX); Windows'ta etkisiz.

Veritabanı, belirteçler, kuyruk, günlükler ve hook durumları kişisel veri taşır. POSIX'te
varsayılan umask (çoğunlukla 022) ile oluşan 0644 dosya ve 0755 klasör, aynı makinedeki başka
kullanıcılara okuma izni verir (ör. home'u 0755 olan Linux dağıtımları). Bu modül:

- yeni klasörleri 0700, yeni dosyaları 0600 ile oluşturur (umask yalnız bit kaldırabilir);
- var olan kurulumu düzeltir: bize ait klasör ve dosyalardan grup/diğer bitlerini kaldırır
  (``kisitla``); başka kullanıcıya ait ya da izni değiştirilemeyen yol olduğu gibi kalır.

Windows'ta ``%LOCALAPPDATA%`` ACL'si zaten kullanıcıya özeldir ve ``os.chmod`` yalnız salt
okunur bayrağını değiştirir; bu yüzden işlevler orada izin değiştirmez (yalnız klasör kurar).

Hook'lar da içe aktarır: yalnız ``os``/``stat``; işlevler (``ozel_klasor`` dışında) asla istisna
fırlatmaz.
"""
from __future__ import annotations

import os
import stat

KLASOR_MODU = 0o700
DOSYA_MODU = 0o600
_ETKIN = os.name != "nt"


def kisitla(yol: str | os.PathLike[str]) -> None:
    """Yol bize aitse grup/diğer izin bitlerini kaldırır (0644 -> 0600, 0755 -> 0700).

    Yoksa, başkasına aitse ya da chmod başarısızsa sessizce geçer. Windows'ta etkisiz.
    """
    if not _ETKIN:
        return
    try:
        st = os.stat(yol)
        if st.st_uid != os.getuid():
            return
        mod = stat.S_IMODE(st.st_mode)
        if mod & 0o077:
            os.chmod(yol, mod & ~0o077)
    except Exception:  # noqa: BLE001 - en iyi çaba
        pass


def ozel_klasor(yol: str | os.PathLike[str], *, duzelt: bool = True) -> None:
    """Klasörü (eksik üst klasörleriyle) 0700 kurar; ``duzelt`` ise var olanı da kısıtlar.

    ``duzelt=False``: kullanıcının seçtiği, başka şeyler de barındırabilecek bir klasör
    (ör. ``BELLEK_BEYIN_DB``'nin klasörü); yalnız yeni oluşturulanlar 0700 olur. Kurulamazsa
    ``mkdir``'in OSError'ını fırlatır (çağıranlar zaten mkdir hatasını bekler).
    """
    if not _ETKIN:
        os.makedirs(yol, exist_ok=True)
        return
    yol = os.fspath(yol)
    eksik: list[str] = []
    p = os.path.abspath(yol)
    while not os.path.isdir(p):
        eksik.append(p)
        ust = os.path.dirname(p)
        if ust == p:
            break
        p = ust
    for d in reversed(eksik):
        try:
            os.mkdir(d, KLASOR_MODU)
        except FileExistsError:
            if not os.path.isdir(d):
                raise
    if duzelt:
        kisitla(yol)


def ozel_acici(yol: str, bayraklar: int) -> int:
    """``open(..., opener=ozel_acici)``: yeni dosya 0600 oluşur (var olanın izni değişmez)."""
    return os.open(yol, bayraklar, DOSYA_MODU)


def ozel_dosya_olustur(yol: str | os.PathLike[str]) -> None:
    """Dosya yoksa boş ve 0600 oluşturur, varsa kısıtlar. Asla istisna fırlatmaz.

    Windows'ta hiçbir şey yapmaz (dosyayı da oluşturmaz: davranış eskisiyle aynı kalır).
    """
    if not _ETKIN:
        return
    try:
        fd = os.open(yol, os.O_WRONLY | os.O_CREAT | getattr(os, "O_BINARY", 0), DOSYA_MODU)
        os.close(fd)
    except Exception:  # noqa: BLE001
        pass
    kisitla(yol)
