"""maskele: genişletme (B3) sonrası gözden geçirmenin bulduğu gerilemeler.

1. Süre: kötü durum girdilerinde felaket geri izleme (ikinci dereceden ya da
   karakter başına milisaniyeler süren kurallar).
2. Taban sürümün (genişletme öncesi) gizlediği değerin artık kaçması.
3. Sıradan metnin sır sanılması (yazma yolu ``maskele(x) != x`` ile reddeder).

Sahte sırlar parçalardan kurulur (depo gizlilik tarayıcısı takılmasın).
"""
from __future__ import annotations

import time

import pytest

from bellek.devir.transcript import maskele

G = "[gizli]"
P = "pass" + "word"
DEGER = "Hunter" + "2024"
EP = "a" + "@b.cc:"  # e-posta:  (parçalı: gizlilik tarayıcısı e-posta sanmasın)


def _luhn_uret(govde: str) -> str:
    toplam = 0
    for i, c in enumerate(reversed(govde)):
        n = int(c)
        if i % 2 == 0:
            n *= 2
            if n > 9:
                n -= 9
        toplam += n
    return govde + str((10 - toplam % 10) % 10)


def _grupla(s: str, ayrac: str) -> str:
    return ayrac.join(s[i:i + 4] for i in range(0, len(s), 4))


# ---- 1. süre: kötü durum girdileri (mutlak sınır) ----
# Eski kodda: EP*8000+'/' (56 KB) 13-24 sn; 'pin-'*1000 (4 KB) ~6 sn;
# 'tc' + 30 KB boşluk ikinci dereceden. Yenisinde hepsi milisaniyeler.

@pytest.mark.parametrize("girdi", [
    pytest.param(EP * 8_000 + "/", id="eposta-tek-bolu"),
    pytest.param(("(" + EP) * 7_000 + "/", id="eposta-parantez"),
    pytest.param(EP * 8_000 + " x", id="eposta-bosluk"),
    pytest.param("pin-" * 1_000, id="pin-tire"),
    pytest.param("pin a-" * 700, id="pin-sozcuk-tire"),
    pytest.param("kart şifresi " * 400, id="kart-sifresi"),
    pytest.param("tc" + " " * 30_000 + "x", id="tc-bosluk"),
    pytest.param("mysql -" * 8_000, id="mysql-tire"),
    pytest.param("curl -u " * 7_000, id="curl-u"),
    pytest.param("sshpass -p " * 5_000, id="sshpass"),
    pytest.param('curl -H "' + "curl -H x " * 5_000, id="curl-kapanmayan-tirnak"),
    pytest.param("4 " * 25_000, id="kart-tek-haneli-gruplar"),
    pytest.param("4111 " * 10_000, id="kart-4lu-gruplar"),
    pytest.param("a-" * 25_000 + "://x", id="url-sema"),
])
def test_maskele_kotu_durum_suresi(girdi):
    t0 = time.perf_counter()
    maskele(girdi)
    gecen = time.perf_counter() - t0
    assert gecen < 1.0, (len(girdi), gecen)


def test_maskele_eposta_parola_tek_bolu_dogrusal():
    """Gözden geçirmedeki ölçüm: tek bir sondaki "/" ile her e-postadan sona dek
    tarama. 8 kat girdi doğrusal ~8x; ikinci dereceden ~64x."""
    kucuk = EP * 1_000 + "/"
    buyuk = EP * 8_000 + "/"
    t0 = time.perf_counter()
    maskele(kucuk)
    t1 = time.perf_counter()
    maskele(buyuk)
    t2 = time.perf_counter()
    assert (t2 - t1) < max(0.5, 25 * (t1 - t0)), (t1 - t0, t2 - t1)


# ---- 2. taban sürümün gizleyip genişletmenin kaçırdıkları ----

@pytest.mark.parametrize("metin,deger", [
    (P + "=None-of-your-business9", "None-of-your-business9"),
    (P + ": True#2024x", "True#2024x"),
    ("token=null!x9Q", "null!x9Q"),
    ("DB_PASSWORD=undefined-x1", "undefined-x1"),
    ("secret: false&" + "Q7", "false&Q7"),
    ("api_key=nil+" + "abc9", "nil+abc9"),
])
def test_maskele_bayrak_sozcuguyle_baslayan_deger_gizlenir(metin, deger):
    c = maskele(metin)
    assert deger not in c, c
    assert G in c


@pytest.mark.parametrize("m", [
    P + "=None",
    P + ": true,",
    "token=null.",
    '{"isAdmin": true, "' + P + '": null}',
    "secret = undefined)",
])
def test_maskele_yalniz_bayrak_degeri_dokunulmaz(m):
    assert maskele(m) == m


@pytest.mark.parametrize("metin,deger", [
    # Yeni bağlamlı kurallar anahtar sözcüğü kendi değerleri sanıp yutmamalı.
    ("curl -u a:" + "secret = " + DEGER + "xQ", DEGER + "xQ"),
    ("a@b.example.com:" + "token=" + DEGER + "!", DEGER + "!"),
    ("Authorization: Basic " + P + " was " + DEGER + "#3,", DEGER + "#3"),
    ("Authorization: Basic GITHUB_TOKEN= " + DEGER + "*a", DEGER + "*a"),
    # 32 karakterden uzun şema adı (taban sınırsızdı).
    ("a" * 45 + "://kullanici:" + DEGER + "@host/db", DEGER),
])
def test_maskele_kural_sirasi_ve_sema_gerilemesi(metin, deger):
    c = maskele(metin)
    assert deger not in c, c


@pytest.mark.parametrize("on,ayrac,boy", [
    ("1.", " ", 19),   # öndeki "1." 19 haneli kartı pencereden itiyordu
    ("0.", "-", 19),
    ("1.", " ", 16),
    ("7 ", " ", 16),
    ("12 ", " ", 16),
])
def test_maskele_kart_onundeki_sayi_karti_kacirmaz(on, ayrac, boy):
    kart = _luhn_uret("5135" + "8782561366" + "7694"[: boy - 15])
    assert len(kart) == boy
    g = _grupla(kart, ayrac)
    c = maskele(f"bak {on}{g} son")
    assert kart[-4:] not in c.replace(on, ""), c
    assert c == f"bak {on}{G} son"


def test_maskele_ondalik_kesir_kart_sayilmaz():
    """Bilinçli dışlama: "0.4111..." ondalık sayının kesir kısmıdır (taban gizliyordu)."""
    kesir = _luhn_uret("411111111111111")
    assert maskele(f"oran 0.{kesir} çıktı") == f"oran 0.{kesir} çıktı"


# ---- 3. yanlış pozitif: komut satırı kuralları ----

@pytest.mark.parametrize("m", [
    "mysql ayarlarını yaptım; ls -pla",
    "mysql yedeği için find /var -perm 600",
    "mysql kurulu, ps -p 1234 ile bak",
    "sshpass kurdum; ls -pla",
    "sshpass yok, ssh -p 2222 host ile bağlan",
    "curl ile indirdim, docker run -u 1000:1000 img",
    "curl kurulu; sudo -u postgres:postgres psql",
    "`mysql -p`, `glpat-` belirteçleri",
])
def test_maskele_komut_baglami_yanlis_pozitif_yok(m):
    assert maskele(m) == m


@pytest.mark.parametrize("metin,deger", [
    ('mysql -e "select 1" -p' + DEGER, DEGER),
    ("mysql -h db.local -P 3306 -u root -p" + DEGER + " mydb", DEGER),
    ("mariadb-dump --single-transaction -uroot -p" + DEGER, DEGER),
    ("sshpass -v -p " + DEGER + " ssh host", DEGER),
    ("sshpass -P assword -p " + DEGER + " ssh host", DEGER),
    ("curl -H 'Accept: a/b' https://api.example.com -u admin:" + DEGER, DEGER),
    ("curl -X POST --user=admin:" + DEGER + " https://api.example.com", DEGER),
    ("curl -sS -uadmin:" + DEGER + " https://api.example.com", DEGER),
])
def test_maskele_komut_satiri_parolasi_gizlenir(metin, deger):
    c = maskele(metin)
    assert deger not in c, c
    assert G in c
