"""devir.transcript regresyon testleri (2. evre ve istek sayımı).

Kapsam:
* İki evreli düzenleme taramasında 2. evrenin süre bütçesi 2. evreye
  girildiği andan sayılır; 1. evre uzun sürse de son 12 MB'tan önceki
  düzenlemeler bulunur, 2. evre yine de sınırlıdır (fail-open, kısmi sonuç).
* İstek sayımı ve ona bağlı sonuçlar JSON biçiminden (sıkışık, boşluklu,
  ``apiBlockIndex`` son anahtar) bağımsızdır; biçim farkı süre sınırı olmayan
  tam çözümleme yedeğine düşürmez.

Sentetik dökümler tmp_path altında üretilir; gerçek oturum kaydı okunmaz.
Sahte saat üretim döngüsünün yapısına bağlanmaz: zaman, okuyucunun dosyanın
sonundan geriye doğru kesintisiz kapsadığı bayt miktarından türetilir.
"""
from __future__ import annotations

import builtins
import json
import os
import time as _gercek_time

import pytest

from bellek.devir import transcript
from bellek.devir.transcript import oturum_ozeti

SID = "11111111-2222-3333-4444-555555555555"
CWD = "C:\\proje"
MB = 1024 * 1024
SON_BUTCE = getattr(transcript, "_SON_BUTCE", 12 * MB)


# ------------------------------------------------------------- satır üretimi

def _ts(i: int) -> str:
    return f"2026-11-08T10:{(i // 60) % 60:02d}:{i % 60:02d}.123Z"


def _jsonla(d: dict, bicim: str = "sikisik") -> str:
    """sikisik: Claude Code biçimi; bosluklu: json.dumps varsayılanı;
    sonda: sıkışık, ``apiBlockIndex`` nesnenin son anahtarı."""
    if bicim == "bosluklu":
        return json.dumps(d, ensure_ascii=False)
    if bicim == "sonda" and "apiBlockIndex" in d:
        d = dict(d)
        d["apiBlockIndex"] = d.pop("apiBlockIndex")
    return json.dumps(d, ensure_ascii=False, separators=(",", ":"))


def kullanici(metin: str, i: int) -> dict:
    return {"parentUuid": None, "isSidechain": False, "type": "user",
            "message": {"role": "user", "content": metin},
            "uuid": f"u{i}", "timestamp": _ts(i), "cwd": CWD, "sessionId": SID}


def arac_sonucu(i: int, metin: str) -> dict:
    return {"parentUuid": "x", "isSidechain": False, "type": "user",
            "message": {"role": "user", "content": [
                {"tool_use_id": f"toolu_{i}", "type": "tool_result", "content": metin,
                 "is_error": False}]},
            "uuid": f"tr{i}", "timestamp": _ts(i), "toolUseResult": {"ok": True},
            "cwd": CWD, "sessionId": SID}


def asistan(i: int, blok: int = 0, icerik: list | None = None, model: str = "claude-opus-x",
            mid: str | None = None, rid: str | None = None, api: bool = True) -> dict:
    d = {"parentUuid": "p", "isSidechain": False,
         "message": {"model": model, "id": mid or f"msg_{i}", "type": "message",
                     "role": "assistant",
                     "content": icerik or [{"type": "text", "text": "tamam"}],
                     "stop_reason": None,
                     "usage": {"input_tokens": 2, "cache_creation_input_tokens": 10,
                               "cache_read_input_tokens": 100, "output_tokens": 5}}}
    if rid is not False:
        d["requestId"] = rid or f"req_{i}"
    if api:
        d["apiBlockIndex"] = blok
    d.update({"type": "assistant", "uuid": f"a{i}_{blok}", "timestamp": _ts(i),
              "cwd": CWD, "sessionId": SID})
    return d


def duzenleme(i: int, yol: str, ad: str = "Edit", blok: int = 0) -> dict:
    girdi = ({"file_path": yol, "content": "x"} if ad == "Write"
             else {"file_path": yol, "old_string": "a", "new_string": "b"})
    return asistan(i, blok=blok, icerik=[{"type": "tool_use", "id": f"toolu_{i}", "name": ad,
                                          "input": girdi, "caller": {"type": "direct"}}])


def _dolgu_yaz(f, satir: bytes, en_az: int) -> None:
    yazilan = 0
    while yazilan < en_az:
        f.write(satir)
        yazilan += len(satir)


def _dolgu_satiri(boy: int) -> bytes:
    return (_jsonla(arac_sonucu(0, "x" * boy)) + "\n").encode()


# ------------------------------------------------- sahte saat ve okuma izi

class _Kapsam:
    """Dosyanın sonundan geriye doğru kesintisiz okunmuş bölgenin boyu."""

    def __init__(self) -> None:
        self.boyut = 0
        self.alt: int | None = None

    def kaydet(self, konum: int, n: int) -> None:
        if n <= 0:
            return
        if self.alt is None:
            self.alt = self.boyut
        if konum < self.alt <= konum + n:
            self.alt = konum

    def okunan(self) -> int:
        return 0 if self.alt is None else self.boyut - self.alt


class _IzliDosya:
    """Gerçek dosya nesnesine vekil; yalnız read/readinto konumlarını kaydeder."""

    def __init__(self, f, kapsam: _Kapsam) -> None:
        self._f = f
        self._k = kapsam
        kapsam.boyut = os.fstat(f.fileno()).st_size

    def read(self, *a):
        konum = self._f.tell()
        veri = self._f.read(*a)
        self._k.kaydet(konum, len(veri))
        return veri

    def readinto(self, b):
        konum = self._f.tell()
        n = self._f.readinto(b)
        self._k.kaydet(konum, n or 0)
        return n

    def __iter__(self):
        return iter(self._f)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self._f.close()
        return False

    def __getattr__(self, ad):
        return getattr(self._f, ad)


class _SahteSaat:
    """Her çağrıda kesin artan (1e-7 s adım) ve okuma kapsamına bağlı saat."""

    def __init__(self, kapsam: _Kapsam, zaman) -> None:
        self.cagri = 0
        self._k = kapsam
        self._zaman = zaman

    def __call__(self) -> float:
        self.cagri += 1
        return self._zaman(self._k.okunan()) + self.cagri * 1e-7


class _SahteTimeModulu:
    def __init__(self, saat: _SahteSaat) -> None:
        self.perf_counter = self.monotonic = self.time = saat
        self.perf_counter_ns = self.monotonic_ns = self.time_ns = lambda: int(saat() * 1e9)

    def __getattr__(self, ad):
        return getattr(_gercek_time, ad)


def _yamala(monkeypatch, hedef, zaman) -> tuple[_SahteSaat, _Kapsam]:
    kapsam = _Kapsam()
    hedef_s = os.path.normcase(os.path.abspath(os.fspath(hedef)))

    def sahte_open(dosya, mode="r", *a, **k):
        f = builtins.open(dosya, mode, *a, **k)
        try:
            ayni = os.path.normcase(os.path.abspath(os.fspath(dosya))) == hedef_s
        except TypeError:
            ayni = False
        return _IzliDosya(f, kapsam) if ayni and "b" in mode else f

    saat = _SahteSaat(kapsam, zaman)
    monkeypatch.setattr(transcript, "open", sahte_open, raising=False)
    if hasattr(transcript, "time"):
        monkeypatch.setattr(transcript, "time", _SahteTimeModulu(saat))
    for ad in ("perf_counter", "monotonic"):
        if callable(getattr(transcript, ad, None)):
            monkeypatch.setattr(transcript, ad, saat)
    return saat, kapsam


# --------------------------------------------------------- büyük döküm (>12 MB)

UZAK = ["C:\\proje\\uzak_1.py", "C:\\proje\\uzak_2.py"]
YAKIN = ["C:\\proje\\yakin_1.py", "C:\\proje\\yakin_2.py"]


@pytest.fixture(scope="module")
def buyuk_dokum(tmp_path_factory):
    """Düzen: [ilk istem, 2 uzak düzenleme][~4 MB küçük satırlı dolgu]
    [2 yakın düzenleme][son 12 MB + 512 KB iri satırlı dolgu][başlık, son istem,
    son assistant]. Yakın düzenlemeler son 12 MB'ın hemen önünde, uzaklar
    dosyanın başında; ikisi de yalnız 2. evrede bulunabilir.

    Dönüş: (yol, yakın düzenlemelerin dosya sonuna uzaklığı).
    """
    yol = tmp_path_factory.mktemp("evre2") / "buyuk.jsonl"
    with open(yol, "wb") as f:
        def yaz(d):
            f.write((_jsonla(d) + "\n").encode())
        yaz(kullanici("ilk istem", 1))
        yaz(duzenleme(2, UZAK[0]))
        yaz(duzenleme(3, UZAK[1], "Write"))
        _dolgu_yaz(f, _dolgu_satiri(4 * 1024), 4 * MB)
        yakin_konum = f.tell()
        yaz(duzenleme(4, YAKIN[0], "MultiEdit"))
        yaz(duzenleme(5, YAKIN[1]))
        _dolgu_yaz(f, _dolgu_satiri(128 * 1024), SON_BUTCE + MB // 2)
        yaz({"type": "custom-title", "customTitle": "buyuk oturum", "sessionId": SID})
        yaz(kullanici("son istem", 6))
        yaz(asistan(7, model="claude-son"))
        boyut = f.tell()
    assert boyut > SON_BUTCE + 4 * MB
    return yol, boyut - yakin_konum


def test_b_buyuk_dokumde_eski_duzenlemeler_bulunur_saat_yamasiz(buyuk_dokum):
    yol, _ = buyuk_dokum
    o = oturum_ozeti(yol)
    assert o["duzenlenen"] == UZAK + YAKIN
    assert o["baslik"] == "buyuk oturum"
    assert o["son_istem"] == "son istem"
    assert o["son_model"] == "claude-son"


def test_a_evre1_uzun_surse_de_evre2_kendi_butcesiyle_arar(buyuk_dokum, monkeypatch):
    yol, _ = buyuk_dokum
    # Sondan ilk 12 MB okunurken saat 100 s ilerler (1. evre "uzun sürmüş"),
    # sonrasında yalnız 1e-7 s'lik adımlarla ilerler (2. evre hızlı).
    saat, kapsam = _yamala(monkeypatch, yol,
                           lambda k: 100.0 * min(k, SON_BUTCE) / SON_BUTCE)
    o = oturum_ozeti(yol)
    assert saat.cagri > 0, "sahte saat hiç çağrılmadı; yama etkisiz"
    assert kapsam.okunan() > SON_BUTCE, "okuma izi kurulamadı; yama etkisiz"
    assert o["duzenlenen"] == UZAK + YAKIN, (
        "1. evre 100 s sürmüş gibi gösterildi, 2. evre kendi içinde ~0 s sürdü; "
        "son 12 MB'tan önceki düzenlemeler bulunmalıydı, bulunan: "
        f"{o['duzenlenen']}")
    assert o["son_model"] == "claude-son"


def test_c_evre2_sure_siniri_kismi_sonucla_doner(buyuk_dokum, monkeypatch):
    yol, yakin_uzaklik = buyuk_dokum
    esik = yakin_uzaklik + MB  # yakınlar okunduktan sonra, uzaklardan ~3 MB önce
    saat, _ = _yamala(monkeypatch, yol, lambda k: 1000.0 if k > esik else 0.0)
    o = oturum_ozeti(yol)  # istisna fırlatmamalı
    assert saat.cagri > 0, "sahte saat hiç çağrılmadı; yama etkisiz"
    assert isinstance(o, dict)
    assert o["duzenlenen"] == YAKIN, (
        "2. evre bütçesi aşıldıktan sonra tarama durmalı (uzaklar eksik), "
        f"bütçe içindekiler bulunmalı; bulunan: {o['duzenlenen']}")
    assert o["baslik"] == "buyuk oturum"
    assert o["son_istem"] == "son istem"
    assert o["son_model"] == "claude-son"


# ------------------------------------------------ istek sayımı ve JSON biçimi

ISTEK = 5


def _oturum_satirlari() -> list[dict]:
    """5 istek; her yanıt 3 blok satırı (apiBlockIndex 0..2, aynı id), araya
    araç sonuçları ve apiBlockIndex taşımayan yapay bir hata satırı."""
    s: list[dict] = [kullanici("ilk istem", 0)]
    for r in range(ISTEK):
        i = 10 * (r + 1)
        mid, rid = f"msg_{i}", f"req_{i}"
        s.append(asistan(i, 0, [{"type": "thinking", "thinking": "dusun"}], mid=mid, rid=rid))
        s.append(duzenleme(i, f"C:\\proje\\dosya{r}.py", "Edit" if r % 2 else "Write", blok=1))
        s[-1]["message"]["id"], s[-1]["requestId"] = mid, rid
        s.append(asistan(i, 2, mid=mid, rid=rid))
        s.append(arac_sonucu(i + 1, "cikti"))
        if r == 2:
            s.append(asistan(i + 2, model="<synthetic>", mid="msg_yapay", rid=False, api=False,
                             icerik=[{"type": "text", "text": "API Error"}]))
            s.append(kullanici("ara istem", i + 3))
    s.append({"type": "ai-title", "aiTitle": "bicim oturumu", "sessionId": SID})
    s.append(kullanici("son istem", 99))
    return s


def _bicimli_yaz(yol, bicim: str):
    with open(yol, "w", encoding="utf-8", newline="\n") as f:
        for d in _oturum_satirlari():
            f.write(_jsonla(d, bicim) + "\n")
    return yol


def test_bicim_yardimcisi_isaretleri_uretir(tmp_path):
    sik = _bicimli_yaz(tmp_path / "s.jsonl", "sikisik").read_bytes()
    bos = _bicimli_yaz(tmp_path / "b.jsonl", "bosluklu").read_bytes()
    son = _bicimli_yaz(tmp_path / "n.jsonl", "sonda").read_bytes()
    assert sik.count(b'"apiBlockIndex":0,') == ISTEK
    assert bos.count(b'"apiBlockIndex": 0,') == ISTEK and b'"apiBlockIndex":0' not in bos
    assert son.count(b'"apiBlockIndex":0}') == ISTEK and b'"apiBlockIndex":0,' not in son


@pytest.mark.parametrize("bicim", ["sikisik", "bosluklu", "sonda"])
def test_d_istek_sayimi_bicimden_bagimsiz(tmp_path, bicim):
    taban = oturum_ozeti(_bicimli_yaz(tmp_path / "taban.jsonl", "sikisik"))
    o = oturum_ozeti(_bicimli_yaz(tmp_path / f"{bicim}.jsonl", bicim))
    assert o["istek_sayisi"] == ISTEK, (
        f"{bicim} biçiminde istek sayısı {o['istek_sayisi']}, beklenen {ISTEK} "
        "(sıkışık biçimdeki sayımla aynı olmalı)")
    assert o == taban
    assert taban["duzenlenen"] == [f"C:\\proje\\dosya{r}.py" for r in range(ISTEK)]
    assert taban["baslik"] == "bicim oturumu"


@pytest.mark.parametrize("bicim", ["bosluklu", "sonda"])
def test_e_bicim_farki_tam_cozumleme_yedegine_dusurmez(tmp_path, monkeypatch, bicim):
    """Satır çözümleme sayısı biçimden bağımsız olmalı: boşluklu/sonda biçim
    tüm assistant satırlarını ikinci kez çözen yedek yola düşmemeli."""
    gercek = transcript._coz
    sayac = {"n": 0}

    def izli_coz(satir):
        sayac["n"] += 1
        return gercek(satir)

    monkeypatch.setattr(transcript, "_coz", izli_coz)
    oturum_ozeti(_bicimli_yaz(tmp_path / "taban.jsonl", "sikisik"))
    taban = sayac["n"]
    sayac["n"] = 0
    oturum_ozeti(_bicimli_yaz(tmp_path / f"{bicim}.jsonl", bicim))
    assert sayac["n"] <= taban, (
        f"{bicim} biçiminde {sayac['n']} satır çözüldü, sıkışıkta {taban}; "
        "fazlalık süre sınırı olmayan tam çözümleme yedeğinden geliyor")


# ----------------------------------------------------- orta boy döküm (değişmez)

def test_orta_boy_dokum_sonuclari_degismez(tmp_path):
    yol = tmp_path / "orta.jsonl"
    with open(yol, "wb") as f:
        def yaz(d):
            f.write((_jsonla(d) + "\n").encode())
        yaz(kullanici("orta ilk istem", 1))
        yaz(duzenleme(2, "C:\\proje\\a.py"))
        _dolgu_yaz(f, _dolgu_satiri(128 * 1024), 3 * MB)
        yaz(duzenleme(3, "C:\\proje\\b.py", "Write"))
        yaz({"type": "ai-title", "aiTitle": "orta oturum", "sessionId": SID})
        yaz(kullanici("orta son istem", 4))
        yaz(asistan(7, model="claude-son"))
    assert oturum_ozeti(yol) == {
        "oturum": SID, "cwd": CWD, "baslik": "orta oturum",
        "ilk_istem": "orta ilk istem", "son_istem": "orta son istem",
        "duzenlenen": ["C:\\proje\\a.py", "C:\\proje\\b.py"],
        "son_baglam": 112, "son_model": "claude-son", "son_zaman": _ts(7),
        "istek_sayisi": 3,
    }
