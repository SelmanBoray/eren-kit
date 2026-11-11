"""gizlilik_tara icin testler.

Test verisindeki sirlar ve kisisel yollar kaynakta bitisik yazilmaz; calisma
aninda parcalardan birlestirilir, boylece bu dosya kendisi bulgu uretmez.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import gizlilik_tara  # noqa: E402

KOK_DIZIN = SCRIPTS.parent

WIN = "C:" + "\\Us" + "ers\\"
MAC = "/Us" + "ers/"
LIN = "/ho" + "me/"
AD_YOLU = {
    "win": lambda ad: WIN + ad + "\\proje",
    "mac": lambda ad: MAC + ad + "/proje",
    "linux": lambda ad: LIN + ad + "/proje",
}
EPOSTA = "ayse" + "@" + "firma.com.tr"
SK_ANT = "sk-" + "ant-" + "a1B2" * 10


def yaz(kok, yol, icerik):
    p = Path(kok) / yol
    p.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(icerik, bytes):
        p.write_bytes(icerik)
    else:
        p.write_text(icerik, encoding="utf-8", newline="\n")
    return p


def tara(kok, dosyalar, izinli=(), yasak=()):
    return gizlilik_tara.tara(Path(kok), list(dosyalar), izinli, yasak)


def kurallar(bulgular):
    return [b.kural for b in bulgular]


def git(kok, *args):
    return subprocess.run(["git", *args], cwd=str(kok), capture_output=True, text=True)


def git_depo(kok):
    if shutil.which("git") is None:
        pytest.skip("git yok")
    r = git(kok, "init", "-q")
    if r.returncode != 0:
        pytest.skip("git init basarisiz")


# 1
@pytest.mark.parametrize("bicim", ["win", "mac", "linux"])
def test_kisisel_yol_bulur(tmp_path, bicim):
    yaz(tmp_path, "a.txt", "bir\niki\nyol: " + AD_YOLU[bicim]("ayse") + "\n")
    b = tara(tmp_path, ["a.txt"])
    assert len(b) == 1
    assert b[0].dosya == "a.txt"
    assert b[0].satir == 3
    assert b[0].kural == "kisisel_yol"


# 2
@pytest.mark.parametrize("ad", ["kullanici", "user", "username", "you", "runner", "Public"])
@pytest.mark.parametrize("bicim", ["win", "mac", "linux"])
def test_kisisel_yol_yer_tutucu_bulgu_degil(tmp_path, bicim, ad):
    yaz(tmp_path, "a.txt", "yol: " + AD_YOLU[bicim](ad) + "\n")
    assert tara(tmp_path, ["a.txt"]) == []


# 3
def test_eposta_bulur(tmp_path):
    yaz(tmp_path, "a.txt", "iletisim " + EPOSTA + "\n")
    b = tara(tmp_path, ["a.txt"])
    assert [x.kural for x in b] == ["eposta"]
    assert b[0].satir == 1


@pytest.mark.parametrize(
    "adres",
    [
        "no" + "reply" + "@" + "firma.com.tr",
        "ayse" + "@" + "no-reply." + "firma.com.tr",
        "12345+ayse" + "@" + "users.no" + "reply.github.com",
        "ayse" + "@" + "exam" + "ple.com",
        "ayse" + "@" + "exam" + "ple.org",
        "ayse" + "@" + "exam" + "ple.net",
        "ayse" + "@" + "anthro" + "pic.com",
    ],
)
def test_eposta_istisnalar_bulgu_degil(tmp_path, adres):
    yaz(tmp_path, "a.txt", "adres " + adres + "\n")
    assert "eposta" not in kurallar(tara(tmp_path, ["a.txt"]))


# 4
def _belirtecler():
    return {
        "sk-ant": SK_ANT,
        "ghp": "gh" + "p_" + "aB3dE5" * 6,
        "akia": "AK" + "IA" + "ABCD1234EFGH5678",
        "xox": "xo" + "xb-" + "1234567890-" + "0987654321-" + "AbCdEfGhIjKl",
        "pem": "-----" + "BEGIN RSA PRIV" + "ATE KEY-----",
        "password": "pass" + "word" + " = " + '"' + "Zq8xLm2PvR4t" + '"',
        "api_key": "api" + "_key" + ': "' + "Zq8xLm2PvR4tWn6YbC3d" + '"',
    }


@pytest.mark.parametrize("ad", list(_belirtecler()))
def test_belirtec_bulur(tmp_path, ad):
    yaz(tmp_path, "a.txt", "x\n" + _belirtecler()[ad] + "\n")
    b = tara(tmp_path, ["a.txt"])
    assert "belirtec" in kurallar(b)
    assert [x.satir for x in b if x.kural == "belirtec"] == [2]


# 5
@pytest.mark.parametrize(
    "metin",
    [
        "sk" + "-",
        "pass" + "word" + " = " + '""',
        "tok" + "en" + " = os.environ[" + '"X"' + "]",
        "parola alanına yazılmaz",
    ],
)
def test_belirtec_bulmaz(tmp_path, metin):
    yaz(tmp_path, "a.py", "import os\n" + metin + "\n")
    assert "belirtec" not in kurallar(tara(tmp_path, ["a.py"]))


# 6
def test_alinti_maskeli(tmp_path):
    yaz(tmp_path, "a.txt", "anahtar " + SK_ANT + "\n")
    b = [x for x in tara(tmp_path, ["a.txt"]) if x.kural == "belirtec"]
    assert b
    assert b[0].alinti
    assert SK_ANT not in b[0].alinti


# 7
def test_buyuk_ikili_bulur(tmp_path):
    yaz(tmp_path, "b.bin", b"\x00" * (600 * 1024))
    b = tara(tmp_path, ["b.bin"])
    assert [x.kural for x in b] == ["buyuk_ikili"]
    assert b[0].satir == 0
    assert b[0].dosya == "b.bin"


def test_kucuk_ikili_bulgu_degil(tmp_path):
    yaz(tmp_path, "k.bin", b"\x00\x01" * (50 * 1024))
    assert tara(tmp_path, ["k.bin"]) == []


def test_buyuk_duz_metin_buyuk_ikili_degil(tmp_path):
    yaz(tmp_path, "m.txt", ("a" * 99 + "\n") * 6200)
    assert (tmp_path / "m.txt").stat().st_size > 512 * 1024
    assert "buyuk_ikili" not in kurallar(tara(tmp_path, ["m.txt"]))


# 8
def test_ikili_satir_kurallariyla_taranmaz(tmp_path):
    yaz(tmp_path, "k.bin", b"\x00\x00" + SK_ANT.encode() + b"\x00\x00")
    assert "belirtec" not in kurallar(tara(tmp_path, ["k.bin"]))


# 9
def test_yasak_sozcuk(tmp_path):
    yaz(tmp_path, "a.txt", "ZEYNEPGIL projesi\n")
    b = tara(tmp_path, ["a.txt"], yasak=["Zeynepgil"])
    assert [x.kural for x in b] == ["yasak_sozcuk"]
    assert b[0].satir == 1
    assert tara(tmp_path, ["a.txt"], yasak=()) == []


# izin listesi yardimcisi
def izin(tmp_path, satirlar):
    p = tmp_path / "izinli.txt"
    p.write_text("\n".join(satirlar) + "\n", encoding="utf-8")
    return gizlilik_tara.izinli_oku(p)


# 10
def test_izin_yalniz_glob(tmp_path):
    yaz(tmp_path, "tests/a/b.py", "x " + EPOSTA + "\n")
    yaz(tmp_path, "src/b.py", "x " + EPOSTA + "\n")
    iz = izin(tmp_path, ["tests/**"])
    b = tara(tmp_path, ["tests/a/b.py", "src/b.py"], iz)
    assert [x.dosya for x in b] == ["src/b.py"]


# 11
def test_izin_glob_ve_kural(tmp_path):
    yaz(tmp_path, "docs/x.md", EPOSTA + "\n" + AD_YOLU["linux"]("ayse") + "\n")
    iz = izin(tmp_path, ["docs/** | eposta"])
    b = tara(tmp_path, ["docs/x.md"], iz)
    assert [x.kural for x in b] == ["kisisel_yol"]


# 12
def test_izin_glob_kural_regex(tmp_path):
    baska = "ayse" + "@" + "baska.com.tr"
    yaz(tmp_path, "src/a.py", "# " + EPOSTA + "\n# " + baska + "\n")
    iz = izin(tmp_path, [r"src/** | eposta | @firma\.com\.tr$"])
    b = tara(tmp_path, ["src/a.py"], iz)
    assert [x.kural for x in b] == ["eposta"]
    assert b[0].satir == 2


# 13
def test_izin_yorum_ve_bos_satir_yok_sayilir(tmp_path):
    iz = izin(tmp_path, ["# yorum", "", "   ", "docs/** | eposta"])
    assert len(iz) == 1


@pytest.mark.parametrize("satir", ["a/** | eposta | x | y", "src/** | eposta | ("])
def test_izin_gecersiz_satir_cikis_2(tmp_path, satir):
    git_depo(tmp_path)
    yaz(tmp_path, "a.txt", "temiz\n")
    git(tmp_path, "add", "a.txt")
    p = tmp_path / "izinli.txt"
    p.write_text("# basa yorum\n\n" + satir + "\n", encoding="utf-8")
    assert gizlilik_tara.main(["--kok", str(tmp_path), "--izinli", str(p)]) == 2


# 14
def test_bozuk_utf8_taramayi_durdurmaz(tmp_path):
    yaz(tmp_path, "a.txt", b"\xff\xfe\xc3\x28 ham\n" + EPOSTA.encode() + b"\n\x80\x81\n")
    b = tara(tmp_path, ["a.txt"])
    assert "eposta" in kurallar(b)


# 15
def test_var_olmayan_dosya_atlanir(tmp_path):
    yaz(tmp_path, "var.txt", EPOSTA + "\n")
    b = tara(tmp_path, ["yok.txt", "var.txt"])
    assert [x.dosya for x in b] == ["var.txt"]


# 16
def test_main_uctan_uca(tmp_path, capsys):
    git_depo(tmp_path)
    yaz(tmp_path, "temiz.txt", "merhaba\n")
    yaz(tmp_path, "kirli.txt", "yol " + AD_YOLU["linux"]("ayse") + "\n")
    git(tmp_path, "add", "temiz.txt", "kirli.txt")
    iz = tmp_path / "bos_izin.txt"
    iz.write_text("", encoding="utf-8")
    argv = ["--kok", str(tmp_path), "--izinli", str(iz)]

    assert gizlilik_tara.main(argv) == 1
    out = capsys.readouterr().out
    assert "kirli.txt:1: kisisel_yol" in out
    assert "ayse" not in out

    assert gizlilik_tara.main(argv + ["--json"]) == 1
    veri = json.loads(capsys.readouterr().out)
    assert isinstance(veri["taranan"], int)
    assert isinstance(veri["bulgular"], list)
    assert veri["bulgular"][0]["dosya"] == "kirli.txt"
    assert set(veri["bulgular"][0]) == {"dosya", "satir", "kural", "alinti"}

    assert git(tmp_path, "rm", "--cached", "-q", "kirli.txt").returncode == 0
    assert gizlilik_tara.main(argv) == 0
    capsys.readouterr()


# 17
def test_git_deposu_degil_cikis_2(tmp_path):
    if shutil.which("git") is None:
        pytest.skip("git yok")
    yaz(tmp_path, "a.txt", "x\n")
    assert gizlilik_tara.main(["--kok", str(tmp_path)]) == 2


# 18
def test_kendi_kendini_tarama():
    assert tara(KOK_DIZIN, ["scripts/tests/test_gizlilik_tara.py"]) == []
