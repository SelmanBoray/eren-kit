"""Tohum (JSONL) dosyasini beyin veritabanina aktarir.

Kullanim: ``ice_al(con, jsonl_yol, uzerine_yaz=False) -> dict``

Donen sozluk: dugum_eklendi, dugum_guncellendi, kenar, olgu, atlanan, hatalar,
korunan (her zaman var; list[str]).

* Tek islem: her sey tek transaction'da yazilir, kritik hatada (dosya okunamaz,
  kok satiri bozuk) HICBIR sey yazilmaz; sayaclar 0, hatalar dolu doner.
  Istisna sizdirilmaz (beklenmeyen istisna da "hatalar"a yazilip geri alinir).
  Islem ``BEGIN IMMEDIATE`` ile acilir: yazma kilidi basta alinir, baska yazar
  varsa busy_timeout kadar beklenir (ertelenmis BEGIN'de okuma->yazma yukseltmesi
  WAL'da SQLITE_BUSY_SNAPSHOT verip tum aktarimi geri aldirabiliyordu).
* Sir: satirin herhangi bir metin alaninda yazma yolunun reddettigi bir sir
  (``maskele`` deseni) varsa satir butunuyle atlanir; hata kaydi sirri icermez.
  Taranan alanlar yazma yolununkiyle ayni turdendir: baslik, ozet, ayrinti, olgular
  (kimlik/yol alanlari -anahtar, kaynaklar, ebeveyn/ilgili- taranmaz). Kendi
  gizliligi ``sir_icerir`` olan satirda yalniz baslik taranir (govde indekslenmez,
  okumada gizlenir). Hata iletileri hicbir satir icin icerik alintilamaz.
* Koruma: var olan dugumun baslik/ozet/ayrinti/tur/durum/tarih alanlarindan biri
  en son tohum disi bir kaynakla (yazma/duzeltme yolu; ``gecmis`` kaydindan
  bulunur) degistirildiyse, ``uzerine_yaz=False`` iken bu alanlara dokunulmaz;
  tohum farkli bir deger tasiyorsa anahtar ``korunan``a eklenir. Gizlilik yine
  yalniz siki yone gider; kenarlar ve yeni olgular eskisi gibi islenir.
  ``uzerine_yaz=True`` iken tohum kazanir.
* Iki gecis: once dugumler (anahtar ile), sonra kenarlar (birincil alt, ek alt,
  ilgili) tohum satir sirasiyla.
* Idempotent: var olan anahtar guncellenir, ayni normalize metinli aktif olgu
  eklenmez, var olan kenar atlanir.
* ``atlanan``: hata yuzunden atlanan satir/kenar/olgu + zaten var oldugu icin
  eklenmeyen kenar/olgu sayisi.
* Satir hatalari (bilinmeyen ebeveyn, dongu, alan siniri...) yalniz o satiri ya
  da kenari atlatir; kokteki sorun hepsini durdurur.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import unicodedata
from pathlib import Path

from bellek.devir.transcript import maskele

from . import db

# Yeni tohumlarda kok satirinin anahtari (db ile ayni). Kok, anahtarindan degil turundan
# taninir: tur='kok' olan tek satir, anahtari ne olursa olsun koktur (eski tohumlar).
# Cocuklar koke hem o satirin anahtariyla hem KOK_ANAHTAR ile baglanabilir.
KOK_ANAHTAR = db.KOK_ANAHTAR
TURLER = {"kok", "dal", "proje", "kisi", "olay", "tercih", "kural", "arac", "bilgi"}
GIZLILIKLER = {"normal", "ozel", "sir_icerir"}
BASLIK_MAX = getattr(db, "BASLIK_SINIR", 120)
DURUMLAR = set(getattr(db, "DUGUM_DURUMLARI", ("aktif", "bitti", "duraklatildi", "bekliyor", "bilinmiyor", "arsiv")))
OZET_MAX = 200
AYRINTI_MAX = 1500
OLGU_MAX = 300
_TARIH = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _norm(metin: str) -> str:
    m = unicodedata.normalize("NFKC", metin).replace("İ", "i").replace("I", "ı")
    return " ".join(m.casefold().split()).rstrip(" .;,")


def _liste(v, ad, hatalar_yerel):
    if v is None:
        return []
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
        hatalar_yerel.append(f"{ad} string listesi olmali")
        return []
    return v


def _metinler(v):
    """Degerin icindeki tum dizeler (ic ice liste/sozluk dahil)."""
    if isinstance(v, str):
        yield v
    elif isinstance(v, list):
        for x in v:
            yield from _metinler(x)
    elif isinstance(v, dict):
        for x in v.values():
            yield from _metinler(x)


# Yazma yolunun (yaz._check_text / _check_edit) sir denetimi uyguladigi turden alanlar:
# kullaniciya gosterilen ve indekslenen serbest metin. Kimlik/yol alanlari (anahtar,
# kaynaklar, ebeveyn/ilgili anahtar basvurulari) taranmaz: maskele'nin uzun-dizi kalibi
# proje klasoru adli yollari, UUID'li not adlarini ve uzun anahtarlari sir sayiyordu.
_SIR_TARANAN = ("baslik", "ozet", "ayrinti", "olgular")
# Satirin KENDI gizliligi sir_icerir ise govde taranmaz (DESIGN §16.2: govde saklanir,
# indekslenmez, okumada gizlenir); baslik indekslendigi icin yine taranir.
_SIR_ICERIR_TARANAN = ("baslik",)


def _sirli_alanlar(k: dict) -> list[str]:
    """Yazma yolunun reddedecegi sir iceren alanlarin adlari (ayni ``maskele`` denetimi).

    Kalitimla sir sayilan (kendi isareti normal/ozel) satir tam taranir.
    """
    taranan = _SIR_ICERIR_TARANAN if k.get("gizlilik") == "sir_icerir" else _SIR_TARANAN
    return [alan for alan in taranan
            if any(s and maskele(s) != s for s in _metinler(k.get(alan)))]


def _goster(v) -> str:
    """Hata iletisinde secim alani degeri: yalniz kisa ve sirsiz dizeyse gosterilir."""
    if isinstance(v, str) and len(v) <= 40 and maskele(v) == v:
        return repr(v)
    return "(gösterilmedi)"


def _dogrula(no, ham):
    """Bir satiri dogrular. (kayit|None, [hata]) doner."""
    h: list[str] = []
    try:
        k = json.loads(ham)
    except ValueError as e:
        return None, [f"satir {no}: gecersiz JSON ({e})"]
    if not isinstance(k, dict):
        return None, [f"satir {no}: nesne degil"]
    # Sir denetimi her seyden once (hata iletileri icerik alintilamaz; yine de once ele).
    sirli = _sirli_alanlar(k)
    if sirli:
        a = k.get("anahtar")
        ad = f"satır {no} [{a.strip()}]" if isinstance(a, str) and a.strip() else f"satır {no}"
        return None, [f"{ad}: sır (parola/anahtar/token) içeriyor ({', '.join(sirli)}); "
                      "sırlar beyne yazılmaz, satır atlandı"]
    anahtar = k.get("anahtar")
    if not isinstance(anahtar, str) or not anahtar.strip():
        return None, [f"satir {no}: anahtar yok"]
    anahtar = anahtar.strip()
    ad = f"satir {no} [{anahtar}]"
    baslik = k.get("baslik")
    if not isinstance(baslik, str) or not baslik.strip():
        h.append("baslik bos")
    elif len(baslik.strip()) > BASLIK_MAX:
        h.append(f"baslik {len(baslik.strip())} > {BASLIK_MAX}")
    ozet = k.get("ozet") or ""
    ayrinti = k.get("ayrinti") or ""
    if not isinstance(ozet, str) or not isinstance(ayrinti, str):
        h.append("ozet/ayrinti string olmali")
    else:
        if len(ozet) > OZET_MAX:
            h.append(f"ozet {len(ozet)} > {OZET_MAX}")
        if len(ayrinti) > AYRINTI_MAX:
            h.append(f"ayrinti {len(ayrinti)} > {AYRINTI_MAX}")
    tur = k.get("tur") or "bilgi"
    if not isinstance(tur, str) or tur not in TURLER:
        h.append(f"bilinmeyen tur {_goster(tur)}")
    gizlilik = k.get("gizlilik") or "normal"
    if not isinstance(gizlilik, str) or gizlilik not in GIZLILIKLER:
        h.append(f"bilinmeyen gizlilik {_goster(gizlilik)}")
    tarih = k.get("tarih")
    if tarih is not None and not (isinstance(tarih, str) and _TARIH.match(tarih)):
        h.append(f"tarih biçimi YYYY-MM-DD degil: {_goster(tarih)}")
    durum = k.get("durum") or "aktif"
    if not isinstance(durum, str) or durum not in DURUMLAR:
        h.append(f"bilinmeyen durum {_goster(durum)}")
    bp = k.get("birincil_ebeveyn")
    if bp is not None and not isinstance(bp, str):
        h.append("birincil_ebeveyn string|null olmali")
    ek = _liste(k.get("ek_ebeveynler"), "ek_ebeveynler", h)
    ilgili = _liste(k.get("ilgili"), "ilgili", h)
    kaynaklar = _liste(k.get("kaynaklar"), "kaynaklar", h)
    olgular_ham = _liste(k.get("olgular"), "olgular", h)
    if h:
        return None, [f"{ad}: {x}" for x in h]
    olgular, olgu_hata = [], []
    for o in olgular_ham:
        if not o.strip():
            continue
        if len(o) > OLGU_MAX:
            # icerik alintilanmaz (sir_icerir govdesi taranmadigi icin sizabilirdi)
            olgu_hata.append(f"{ad}: olgu {len(o)} > {OLGU_MAX} karakter, atlandi")
        else:
            olgular.append(o.strip())
    return {
        "no": no, "anahtar": anahtar, "baslik": baslik.strip(), "ozet": ozet,
        "ayrinti": ayrinti, "tur": tur, "durum": durum, "gizlilik": gizlilik,
        "tarih": tarih, "bp": bp.strip() if bp else None,
        "ek": [x.strip() for x in ek], "ilgili": [x.strip() for x in ilgili],
        "olgular": olgular, "kaynaklar": [x.strip() for x in kaynaklar if x.strip()],
        "olgu_hata": olgu_hata,
    }, []


class _Sp:
    """Kismi geri alim icin savepoint (hata olursa o islem geri sarilir)."""

    def __init__(self, con, ad):
        self.con, self.ad = con, ad

    def __enter__(self):
        self.con.execute(f"SAVEPOINT {self.ad}")

    def __exit__(self, tp, v, tb):
        if tp is None:
            self.con.execute(f"RELEASE {self.ad}")
        else:
            self.con.execute(f"ROLLBACK TO {self.ad}")
            self.con.execute(f"RELEASE {self.ad}")
        return False


_GIZLILIK_SIRA = {"normal": 0, "ozel": 1, "sir_icerir": 2}


def _kaynak_bul_ya_da_ekle(con, tur, ref):
    """Ayni (tur, ref) kaynak varsa onu kullanir, yoksa ekler."""
    satir = con.execute(
        "SELECT id FROM kaynak WHERE tur = ? AND ref = ? ORDER BY tarih LIMIT 1", (tur, ref)
    ).fetchall()  # fetchall: acik imleç birakma (create_function kilitlenir)
    if satir:
        return satir[0][0]
    return db.kaynak_ekle(con, tur, ref=ref, istemci="ice_al")


def _gizlilik_gevsetme(con, dugum_id, yeni):
    """Gizlilik yalniz kisitlayici yone gider: mevcut ile yeninin siki olani."""
    satir = con.execute("SELECT gizlilik FROM dugum WHERE id = ?", (dugum_id,)).fetchall()
    eski = satir[0][0] if satir else "normal"
    return eski if _GIZLILIK_SIRA.get(eski, 0) > _GIZLILIK_SIRA.get(yeni, 0) else yeni


def _kenar_satiri(con, e, c, tur):
    satir = con.execute(
        "SELECT birincil FROM kenar WHERE ebeveyn=? AND cocuk=? AND tur=?", (e, c, tur)
    ).fetchall()
    return satir[0] if satir else None


def _mevcut_olgular(con, dugum_id):
    """Dugumun HER durumdaki (aktif/eskidi/reddedildi) olgularinin normalize metinleri."""
    return {db.normalize(r[0]) for r in con.execute("SELECT metin FROM olgu WHERE dugum = ?", (dugum_id,))}


def _kok_satiri_mi(ham) -> bool:
    """Gecersiz bir satirin kok satiri (tur='kok') olup olmadigi; JSON bozuksa False."""
    try:
        k = json.loads(ham)
    except ValueError:
        return False
    return isinstance(k, dict) and k.get("tur") == "kok"


def _sonuc(hatalar=None):
    return {"dugum_eklendi": 0, "dugum_guncellendi": 0, "kenar": 0, "olgu": 0,
            "atlanan": 0, "hatalar": list(hatalar or []), "korunan": []}


# Tohum disi kaynakla degistirilmisse yeniden ice alimda korunan alanlar.
KORUNAN_ALANLAR = ("baslik", "ozet", "ayrinti", "tur", "durum", "tarih")
# ice_al'in kendi yazdigi kaynak turleri (dugum kaynak izi: tohum ya da satirin ilk 'kaynaklar' yolu).
# Dis yazma yolu bu turleri veremez (yaz.DIS_KAYNAK_TURLERI = oturum/elle).
_TOHUM_KAYNAK_TURLERI = ("tohum", "memory")


def _dis_degisiklik_var(con, dugum_id) -> bool:
    """Dugumun korunan alanlarindan birinin SON degisikligi tohum disi bir kaynaktan mi?

    ``gecmis`` kayitlari sirayla yurunur; her korunan alan icin onu en son degistiren
    guncellemenin kaynagi tutulur. Kaynagi olmayan (None) ya da tohum/memory disi
    guncelleme dis degisikliktir. Dugumun ilk eklenmesi (kim eklerse eklesin) sayilmaz;
    yalniz gizlilik ya da kenar degisikligi korumayi baslatmaz ya da bitirmez.
    """
    sahip: dict[str, bool] = {}  # alan -> son degisiklik tohumdan mi
    satirlar = con.execute(
        "SELECT g.islem, g.eski_json, g.yeni_json, k.tur FROM gecmis g"
        " LEFT JOIN kaynak k ON k.id = g.kaynak_id"
        " WHERE g.tablo = 'dugum' AND g.hedef_id = ? ORDER BY g.id",
        (dugum_id,),
    ).fetchall()
    for islem, eski_j, yeni_j, ktur in satirlar:
        if islem == "ekle":
            sahip.clear()
            continue
        if islem != "guncelle":
            continue
        try:
            eski, yeni = json.loads(eski_j or "{}"), json.loads(yeni_j or "{}")
        except ValueError:
            continue
        if not isinstance(eski, dict) or not isinstance(yeni, dict):
            continue
        tohumdan = ktur in _TOHUM_KAYNAK_TURLERI
        for alan in KORUNAN_ALANLAR:
            if eski.get(alan) != yeni.get(alan):
                sahip[alan] = tohumdan
    return any(not v for v in sahip.values())


def ice_al(con, jsonl_yol, uzerine_yaz: bool = False) -> dict:
    """Tohumu aktarir; ayrintilar modul docstring'inde. Istisna sizdirmaz.

    ``uzerine_yaz=False`` (varsayilan): tohum disi duzeltilmis dugumlerin alanlari
    korunur (``korunan``). ``True``: tohum her alani yazar (eski davranis).
    """
    yol = Path(jsonl_yol)
    try:
        veri = yol.read_bytes()
        metin = veri.decode("utf-8-sig")
    except (OSError, UnicodeDecodeError) as e:
        return _sonuc([f"tohum okunamadi: {e}"])
    sha = hashlib.sha256(veri).hexdigest()

    # ---- Dogrulama (yazmadan) ----
    hatalar: list[str] = []
    atlanan = 0
    kayitlar: dict[str, dict] = {}
    sira: list[str] = []
    kok_a: str | None = None  # tohumdaki kok satirinin anahtari
    kok_bozuk = False
    for no, ham in enumerate(metin.splitlines(), 1):
        if not ham.strip():
            continue
        k, h = _dogrula(no, ham)
        if k is None:
            hatalar += h
            atlanan += 1
            if kok_a is None and _kok_satiri_mi(ham):
                kok_bozuk = True
            continue
        if k["anahtar"] in kayitlar:
            hatalar.append(f"satir {no} [{k['anahtar']}]: yinelenen anahtar, atlandi")
            atlanan += 1
            continue
        if k["tur"] == "kok":
            if kok_a is not None or kok_bozuk:
                hatalar.append(f"satir {no} [{k['anahtar']}]: ikinci kok satiri, atlandi")
                atlanan += 1
                continue
            kok_a = k["anahtar"]
        hatalar += k.pop("olgu_hata")
        atlanan += 0
        kayitlar[k["anahtar"]] = k
        sira.append(k["anahtar"])

    # kok kontrolu (kritik)
    kok = kayitlar.get(kok_a) if kok_a is not None else None
    kritik = []
    if kok is not None and kok["bp"] is not None:
        kritik.append(f"kok [{kok_a}] birincil_ebeveyn tasiyor: {kok['bp']!r}")
    if kok is None and kok_bozuk:
        kritik.append("kok satiri gecersiz")
    # koke baglanirken kullanilabilen anahtarlar: tohumdaki kok anahtari ve KOK_ANAHTAR
    kok_adlari = {KOK_ANAHTAR} | ({kok_a} if kok_a is not None else set())
    if kritik:
        return _sonuc(["KRITIK: " + x for x in kritik] + hatalar)

    # DB'de zaten var olan anahtarlar (ebeveyn cozumu icin) – okuma
    def var_mi(a):
        if a in kayitlar or db.anahtardan_id(con, a) is not None:
            return True
        # kok, tohumdaki kendi anahtariyla ya da KOK_ANAHTAR ile anilabilir
        return a in kok_adlari and (kok_a is not None or db.kok_bul(con) is not None)

    # kok olmayan ve birincil ebeveynsiz, bilinmeyen ebeveynli, dongulu satirlari ele
    atilacak: dict[str, str] = {}
    for a, k in kayitlar.items():
        if a == kok_a:
            continue
        if k["bp"] is None:
            atilacak[a] = "birincil_ebeveyn bos (yalniz kok null olabilir)"
        elif k["bp"] == a:
            atilacak[a] = "kendi kendisinin ebeveyni"
        elif not var_mi(k["bp"]):
            atilacak[a] = f"bilinmeyen birincil ebeveyn {k['bp']!r}"
    degisti = True
    while degisti:  # atilan ebeveynin cocuklari da duser
        degisti = False
        for a, k in kayitlar.items():
            if a in atilacak or a == kok_a:
                continue
            if k["bp"] in atilacak:
                atilacak[a] = f"birincil ebeveyn {k['bp']!r} atlandi"
                degisti = True
    for a, k in kayitlar.items():  # birincil zincirde dongu
        if a in atilacak:
            continue
        gor, x = set(), a
        while x in kayitlar and x not in atilacak and x not in gor and kayitlar[x]["bp"]:
            gor.add(x)
            x = kayitlar[x]["bp"]
        if x in gor:
            atilacak[a] = "birincil ebeveyn zincirinde dongu"
    # dongu dugumlerinin torunlari tekrar dussun
    degisti = True
    while degisti:
        degisti = False
        for a, k in kayitlar.items():
            if a not in atilacak and a != kok_a and k["bp"] in atilacak:
                atilacak[a] = f"birincil ebeveyn {k['bp']!r} atlandi"
                degisti = True
    for a in sira:
        if a in atilacak:
            hatalar.append(f"satir {kayitlar[a]['no']} [{a}]: {atilacak[a]}, atlandi")
            atlanan += 1
    gecerli = [a for a in sira if a not in atilacak]

    # ---- Yazma ----
    sonuc = _sonuc()
    if con.in_transaction:
        con.commit()
    try:
        # IMMEDIATE: yazma kilidi okumadan once alinir; bekleme busy_timeout ile olur.
        con.execute("BEGIN IMMEDIATE")
        tohum_id = _kaynak_bul_ya_da_ekle(con, "tohum", f"{yol.resolve()} sha256:{sha}")
        kok_dugum = db.kok_id(con)
        idler: dict[str, int] = {}
        kayn_onbellek: dict[str, int] = {}

        def kaynak_idleri(yollar):
            out = []
            for p in yollar:
                if p not in kayn_onbellek:
                    kayn_onbellek[p] = _kaynak_bul_ya_da_ekle(con, "memory", p)
                out.append(kayn_onbellek[p])
            return out

        # Gecis 1: dugumler (satir basina savepoint; kok disinda hata satiri atlatir)
        yazilan: list[str] = []
        korunan: list[str] = []
        for a in gecerli:
            k = kayitlar[a]
            korundu = False
            try:
                with _Sp(con, "sp_dugum"):
                    kids = kaynak_idleri(k["kaynaklar"])
                    kid = kids[0] if kids else tohum_id  # dugum kaynak izi: ilk kaynak yolu
                    alan = dict(baslik=k["baslik"], ozet=k["ozet"], ayrinti=k["ayrinti"],
                                tur=k["tur"], durum=k["durum"], gizlilik=k["gizlilik"],
                                tarih=k["tarih"])
                    if a == kok_a:
                        nid, eklendi, kid = kok_dugum, False, tohum_id
                    else:
                        nid = db.anahtardan_id(con, a)
                        eklendi = nid is None
                    if eklendi:
                        nid = db.dugum_ekle(con, anahtar=a, kaynak_id=kid, **alan)
                    else:
                        alan["gizlilik"] = _gizlilik_gevsetme(con, nid, alan["gizlilik"])
                        if not uzerine_yaz and _dis_degisiklik_var(con, nid):
                            mevcut = con.execute(
                                "SELECT " + ", ".join(KORUNAN_ALANLAR) + " FROM dugum WHERE id = ?",
                                (nid,)).fetchall()[0]
                            korundu = any(mevcut[i] != alan[f] for i, f in enumerate(KORUNAN_ALANLAR))
                            # yalniz gizlilik (siki yone) yazilir; korunan alanlara dokunulmaz
                            alan = {"gizlilik": alan["gizlilik"]}
                        db.dugum_guncelle(con, nid, kaynak_id=kid, **alan)
            except (ValueError, sqlite3.IntegrityError) as ex:
                if a == kok_a:
                    raise
                hatalar.append(f"satir {k['no']} [{a}]: yazilamadi ({ex}), atlandi")
                atlanan += 1
                continue
            sonuc["dugum_eklendi" if eklendi else "dugum_guncellendi"] += 1
            if korundu:
                korunan.append(a)
            idler[a] = nid
            yazilan.append(a)
        gecerli = yazilan

        def coz(a):
            if a in idler:
                return idler[a]
            if a in kok_adlari:
                return kok_dugum
            return db.anahtardan_id(con, a)

        def kenar(e_anahtar, c_anahtar, tur, birincil, no, kid):
            e, c = coz(e_anahtar), coz(c_anahtar)
            ad = f"satir {no} [{c_anahtar}]"
            if e is None:
                hatalar.append(f"{ad}: bilinmeyen ebeveyn/ilgili {e_anahtar!r}, kenar atlandi")
                return 0, 1
            if e == c:
                hatalar.append(f"{ad}: kendine kenar, atlandi")
                return 0, 1
            mevcut = _kenar_satiri(con, e, c, tur)
            if mevcut is not None:
                if birincil and not mevcut[0]:  # ek kenar birincile yukseltilir (tasima)
                    try:
                        with _Sp(con, "sp_kenar"):
                            db.kenar_ekle(con, e, c, tur=tur, birincil=True, kaynak_id=kid)
                    except ValueError as ex:
                        hatalar.append(f"{ad}: birincil tasima {e_anahtar!r} -> {ex}, atlandi")
                        return 0, 1
                    return 0, 0
                return 0, 1
            try:
                with _Sp(con, "sp_kenar"):
                    db.kenar_ekle(con, e, c, tur=tur, birincil=birincil, kaynak_id=kid)
            except ValueError as ex:
                hatalar.append(f"{ad}: {tur} kenari {e_anahtar!r} -> dongu/gecersiz ({ex}), atlandi")
                return 0, 1
            except sqlite3.IntegrityError:
                return 0, 1  # zaten var
            return 1, 0

        # Gecis 2: kenarlar (satir sirasiyla)
        for a in gecerli:
            k = kayitlar[a]
            if a == kok_a:
                pass
            else:
                n, s = kenar(k["bp"], a, "alt", True, k["no"], tohum_id)
                sonuc["kenar"] += n; atlanan += s
            for e in k["ek"]:
                n, s = kenar(e, a, "alt", False, k["no"], tohum_id)
                sonuc["kenar"] += n; atlanan += s
            for r in k["ilgili"]:
                n, s = kenar(a, r, "ilgili", False, k["no"], tohum_id)
                sonuc["kenar"] += n; atlanan += s

        # Olgular
        for a in gecerli:
            k = kayitlar[a]
            nid = idler[a]
            var = _mevcut_olgular(con, nid)
            for o in k["olgular"]:
                n = db.normalize(o)
                if n in var:
                    atlanan += 1
                    continue
                db.olgu_ekle(con, nid, o, kaynak_id=tohum_id)
                var.add(n)
                sonuc["olgu"] += 1

        con.commit()
    except Exception as ex:  # noqa: BLE001 - sozlesme: istisna sizdirma
        try:
            con.rollback()
        except sqlite3.Error:
            pass
        return _sonuc(hatalar + [f"KRITIK: yazma basarisiz, geri alindi: {type(ex).__name__}: {ex}"])

    sonuc["atlanan"] = atlanan
    sonuc["hatalar"] = hatalar
    sonuc["korunan"] = korunan
    return sonuc
