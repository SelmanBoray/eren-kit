"""maskele: komut satırı parolaları (mysql -pX, sshpass -p X, curl -u k:X).

Kuralların düzenli ifade biçimi (25ca6ce) üç yönden gerilemişti:
1. Süre: tırnaklı seçenek değeri hem "değer" hem "sözcük" sayılabildiği için
   üstel geri izleme (curl -H "a" x16 satırlarından 200 KB'ta ~24 sn).
2. Kaçak: yalnız seçeneklere izin verdiği için taban sürümün gizlediği biçimler
   açıkta kalıyordu (tırnaklı ya da şemasız URL, bayraktan önce konumsal argüman).
3. Yanlış pozitif: ";" ile biten seçenekten sonraki sözcük onun değeri sanılıyordu.

Sahte sırlar parçalardan kurulur (depo gizlilik tarayıcısı takılmasın).
"""
from __future__ import annotations

import time

import pytest

from bellek.devir.transcript import maskele

G = "[gizli]"
P = "pass" + "word"
D = "Hunter" + "2024"


def _sure(metin: str) -> float:
    t0 = time.perf_counter()
    maskele(metin)
    return time.perf_counter() - t0


# ---- 1. süre ----

def _boyutla(birim: str, kb: int, onek: str = "") -> str:
    return onek + birim * max(1, kb * 1024 // len(birim))


@pytest.mark.parametrize("girdi", [
    # Gözden geçirmenin girdisi: çok satır, her biri 16 tırnaklı seçenek.
    pytest.param(_boyutla("curl" + ' -H "a"' * 16 + "\n", 200), id="curl-H-satirlar"),
    pytest.param(_boyutla("mysql" + ' -e "a"' * 12 + "\n", 200), id="mysql-e-satirlar"),
    pytest.param(_boyutla("sshpass" + " -f 'a'" * 6 + "\n", 200), id="sshpass-f-satirlar"),
    pytest.param(_boyutla(' -H "a"', 200, "curl"), id="curl-H-tek-satir"),
    # Ayrı belirteçteki değer bir sonraki komut: yürüyüş orada durmalı.
    pytest.param(_boyutla("sshpass -p sshpass ", 200), id="sshpass-p-zinciri"),
    pytest.param(_boyutla("curl -u curl:", 200), id="curl-u-zinciri"),
    pytest.param(_boyutla("-pX;a", 200, "mysql "), id="mysql-deger-uzantisi"),
    pytest.param(_boyutla("\"'curl -u a:b' \" ", 200), id="ic-ice-tirnak"),
    pytest.param(_boyutla("'\"curl", 200), id="karisik-tirnak"),
    pytest.param(_boyutla("curl -X a \\\n", 200), id="devam-satirlari"),
    pytest.param(_boyutla("$(curl ", 200), id="dolar-parantez"),
    pytest.param(_boyutla(P + ": '", 200), id="anahtar-kapanmayan-tirnak"),
])
def test_komut_kotu_durum_suresi(girdi):
    assert len(girdi) >= 190_000
    gecen = _sure(girdi)
    assert gecen < 1.0, (len(girdi), gecen)


def test_komut_suresi_dogrusal():
    """4 kat girdi doğrusal ~4x; üstel/ikinci dereceden çok daha fazlası."""
    birim = "curl" + ' -H "a"' * 16 + "\n"
    kucuk = _sure(_boyutla(birim, 25))
    buyuk = _sure(_boyutla(birim, 100))
    assert buyuk < max(0.5, 12 * kucuk), (kucuk, buyuk)


# ---- 2. kaçak: taban sürümün gizlediği biçimler ----

@pytest.mark.parametrize("metin", [
    "curl 'https://ornek.test/a' -u admin:" + D,
    'curl "https://ornek.test/a" -u admin:' + D,
    "curl ornek.test -u admin:" + D,
    "curl localhost:8080/api -u admin:" + D,
    "curl @args.txt -u admin:" + D,
    "curl -d '" + '{"a":1}' * 40 + "' -u admin:" + D,
    "curl https://x.test/?a=1&b=2 -u admin:" + D,
    "mysqldump mydb -uroot -p" + D + " > y.sql",
    "mysql mydb -uroot -p" + D,
    "mysqldump mydb tbl1 tbl2 -uroot -p" + D,
    '"C:\\Program Files\\MySQL\\bin\\mysql.exe" -uroot -p' + D,
    "mysql " + "-x a " * 14 + "-p" + D,
    "docker exec -it db mysql -uroot -p" + D,
    # Yeni kapsanan: tırnak içindeki komut, JSON dizgesi, devam satırı.
    'bash -c "mysql -uroot -p' + D + ' db"',
    "ssh host 'curl -u admin:" + D + " https://x.test'",
    '{"command":"curl -H \\"Accept: x\\" -u admin:' + D + '"}',
    "curl -X POST https://api.example.com \\\n  -H 'a: b' \\\n  -u admin:" + D,
    "curl -sSu admin:" + D,
    "curl -U proxy:" + D + " https://x.test",
    "curl --proxy-user proxy:" + D + " https://x.test",
    # Parolanın içindeki kabuk ayracı değeri kesmemeli.
    "mysql -uroot -pAb;" + D + " x",
    "curl -u admin:p(w)" + D + " x",
])
def test_komut_parolasi_kacmaz(metin):
    c = maskele(metin)
    assert D not in c, c
    assert G in c


def test_komut_tirnakli_degerde_kapanis_tirnagi_korunur():
    assert maskele("curl -u 'admin:" + D + "' x") == "curl -u 'admin:" + G + "' x"
    assert maskele("mysql -uroot -p'" + D + "' db") == "mysql -uroot -p" + G + " db"


# ---- 3. yanlış pozitif ----

@pytest.mark.parametrize("m", [
    "mysql -V; ls -pla",
    "curl -V; sudo -u postgres:postgres psql",
    "mysql -V && ls -pla",
    "curl -V | sudo -u a:b tee",
    "mysql -V\nls -pla",
    "curl https://x.test\nsudo -u postgres:postgres psql",
    "mysql dump aldım sonra netstat -plnt",
    "mysqldump db | ssh -p22 h 'cat > x'",
    "curl --user-agent x:y https://a",
    "mysql -u root -p veritabani",
    "sshpass -p",
    "curl x; cp -p a b",
    # 25ca6ce'de doğru olan, bozulmaması gerekenler
    "mysql ayarlarını yaptım; ls -pla",
    "mysql yedeği için find /var -perm 600",
    "find /var -perm 600",
    "ssh -p 2222 host",
    "docker run -u 1000:1000",
])
def test_komut_yanlis_pozitif_yok(m):
    assert maskele(m) == m


# ---- 4. anahtar=değer: tırnak başka anahtarın değerinin ortasında kapanınca ----

@pytest.mark.parametrize("metin,deger", [
    ("PGPASSWORD: 'nil%Rx\", _DB_PASSWORD = None'Cj9*.", "Cj9*."),
    ("PGPASSWORD: 'nil\n_DB_PASSWORD = None'Cj9*.", "Cj9*."),
    (P + ': "my secret phrase"x9', "x9"),
])
def test_anahtar_tirnakli_deger_sonraki_anahtari_acikta_birakmaz(metin, deger):
    c = maskele(metin)
    assert deger not in c, c


def test_anahtar_json_yapisi_korunur():
    m = '{"' + P + '":"abc","user":"x"}'
    assert maskele(m) == '{"' + P + '":' + G + ',"user":"x"}'
