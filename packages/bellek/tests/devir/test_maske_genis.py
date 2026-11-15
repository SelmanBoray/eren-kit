"""maskele: güvenlik denetimi B3 regresyonları (sır süzgecinin genişletilmesi).

Sahte sırlar parçalardan kurulur: depo gizlilik tarayıcısı (scripts/gizlilik_tara.py) test
dosyasındaki düz biçimleri gerçek sır sanmasın.
"""
from __future__ import annotations

import time

import pytest

from bellek.devir.transcript import maskele

G = "[gizli]"
PEM_BAS = "-----BEGIN " + "OPENSSH PRIVATE KEY" + "-----"
PEM_SON = "-----END " + "OPENSSH PRIVATE KEY" + "-----"


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


def _tckn_uret(taban: str = "123456789") -> str:
    d = [int(c) for c in taban]
    d.append(((sum(d[0:9:2]) * 7) - sum(d[1:8:2])) % 10)
    d.append(sum(d) % 10)
    return "".join(map(str, d))


# ---- denetimde maskelenmeyen örnekler ----

@pytest.mark.parametrize("metin,deger", [
    ("giriş ali@example.com:" + "Hunter" + "2024! ile", "Hunter2024!"),
    ("export PG" + "PASSWORD=" + "Hunter2024", "Hunter2024"),
    ("MYSQL_PWD=" + "Hunter2024 mysql", "Hunter2024"),
    ("DB_PASS=" + "Hunter2024", "Hunter2024"),
    ("mysql -u root -p" + "Hunter2024 veritabani", "Hunter2024"),
    ("mysqldump -h db -uroot -p'" + "Hunter2024' x > y.sql", "Hunter2024"),
    ("sshpass -p " + "Hunter2024 ssh host", "Hunter2024"),
    ("curl -u admin:" + "Hunter2024 https://api.example.com", "Hunter2024"),
    ('{"password": "' + 'Hunter2024"}', "Hunter2024"),
    ("{'api_key': '" + "Hunter2024xyz'}", "Hunter2024xyz"),
    ("Authorization: Basic " + "YWxpOkh1bnRlcjIwMjQ=", "YWxpOkh1bnRlcjIwMjQ="),
    ("tok gl" + "pat-" + "AbCdEfGhIjKlMnOpQrSt12", "AbCdEfGhIjKlMnOpQrSt12"),
    ("npm_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"),
    ("hf_" + "AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf", "AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf"),
    ("sk_" + "live_" + "AbCdEfGhIjKlMnOpQrStUvWx", "AbCdEfGhIjKlMnOpQrStUvWx"),
    ("ya" + "29." + "a0AfH6SMBxAbCdEfGhIjKlMnOp", "a0AfH6SMBxAbCdEfGhIjKlMnOp"),
    ("AS" + "IA" + "ABCDEFGHIJKLMNOP", "ABCDEFGHIJKLMNOP"),
    ("https://hooks.slack.com/services/" + "T000/B000/XXXXXXXXXXXXXXXXXXXXXXXX",
     "XXXXXXXXXXXXXXXXXXXXXXXX"),
])
def test_maskele_denetim_ornekleri(metin, deger):
    c = maskele(metin)
    assert deger not in c, c
    assert G in c


def test_maskele_eposta_parola_epostayi_korur():
    c = maskele("ali@example.com:" + "Hunter2024!")
    assert c == "ali@example.com:" + G


def test_maskele_pem_blogu_tumuyle():
    govde = "b3BlbnNzaC1rZXktdjEAAAAA\nQUJDREVGR0hJSktMTU5PUFFSU1RVVldY\n"
    c = maskele(f"anahtar:\n{PEM_BAS}\n{govde}{PEM_SON}\nsonra devam")
    assert "b3BlbnNz" not in c and "QUJDREVG" not in c
    assert "PRIVATE KEY" not in c
    assert c.startswith("anahtar:\n") and c.endswith("\nsonra devam")


def test_maskele_pem_sonu_yoksa_metnin_sonuna_dek():
    c = maskele(f"bak {PEM_BAS} b3BlbnNzaC1rZXktdjEAAAAA kesildi")
    assert c == "bak " + G


def test_maskele_pem_iki_blok():
    blok = f"{PEM_BAS}\nQUJD\n{PEM_SON}"
    c = maskele(f"a {blok} b {blok} c")
    assert c == f"a {G} b {G} c"


def test_maskele_kart_nokta_ayracli():
    kart = _luhn_uret("411111111111111")
    g = ".".join(kart[i:i + 4] for i in range(0, 16, 4))
    c = maskele(f"kart {g} son")
    assert c == f"kart {G} son"


def test_maskele_iban_kucuk_harf():
    c = maskele("iban tr33 0006 1005 1978 6457 8413 26 yatır")
    assert c == f"iban {G} yatır"


def test_maskele_tckn_bosluklu_anahtar_sozcuklu():
    t = _tckn_uret()
    gosterim = f"{t[:3]} {t[3:6]} {t[6:9]} {t[9:]}"
    assert maskele(f"TC {gosterim} kayıt") == f"TC {G} kayıt"


def test_maskele_tam_genislik_onek():
    gizli = "ｓｋ－" + "ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔ１２３"
    c = maskele(f"anahtar {gizli} bitti")
    assert "ａｂｃｄ" not in c and "abcd" not in c
    assert G in c


# ---- yanlış pozitif: sıradan metin bozulmaz ----

@pytest.mark.parametrize("m", [
    "git@github.com:kullanici/proje.git adresinden klonla",
    "git clone git@gitlab.com:grup1/repo2.git",
    "ssh deploy@sunucu.example.com:2222 ile bağlan",
    "ali@example.com: yarın toplantı var",
    "ali@example.com:dosya.txt",
    "mkdir -p build && gcc -pthread a.c",
    "mysql -u root -p veritabani",
    "mysql -P 3306 -h db",
    "bypass=true ve compass: kuzey",
    "tokenizer: bpe, token sayısı 300K",
    '{"tokens": 1200, "token_count": 5}',
    "BEGIN PRIVATE KEY yazısı tek başına başlık değil",
    "pi 3.14159265358979323 ve 1.234.567.890.123 sayıları",
    "192.168.100.200 ve 10.0.0.1 adresleri",
    "sürüm 2026.11.15.1234 yayında",
    "tr33 dersi ve ab12 cdef ghij kodu",
    "Ｔｏｋｙｏ ve ｆｕｌｌｗｉｄｔｈ metin",
    "Basic bilgiler: Authorization başlığı ayrı anlatılacak",
    "curl -u admin https://api.example.com",
])
def test_maskele_genis_yanlis_pozitif_yok(m):
    assert maskele(m) == m


# ---- doğrusal süre (felaket geri izleme yok) ----

@pytest.mark.parametrize("parca", [
    PEM_BAS + " ",
    "a@" ,
    "a.b@c.d.e:",
    "ali@example.com:" + "x" * 30 + "/",
    "mysql " + " -" * 50,
    "curl -u a:",
    "PGPASSWORD" * 3 + " ",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaapassword ",
    "4111.1111.1111.",
    "tr33 0006 ",
    "ｓｋ－",
])
def test_maskele_saldirgan_girdi_dogrusal(parca):
    kucuk = parca * 2_000
    buyuk = parca * 16_000
    t0 = time.perf_counter()
    maskele(kucuk)
    t1 = time.perf_counter()
    maskele(buyuk)
    t2 = time.perf_counter()
    # 8 kat girdi: doğrusal ~8x; ikinci dereceden olsa ~64x. Ölçüm gürültüsüne pay bırakılır.
    assert (t2 - t1) < max(2.0, 25 * (t1 - t0)), (parca, t1 - t0, t2 - t1)
