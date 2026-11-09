"""Beyne yazma kararları ve gelen kutusu.

Tüm Claude Code oturumları (MCP ``beyin_yaz``) buradaki :func:`yaz` ile yazar.
Karar sırası:

1. Metin boş ya da 300 karakterden uzunsa reddedilir.
2. Metin (ya da başlık/ebeveyn) sır içeriyorsa reddedilir; sırlar beyne yazılmaz.
3. ``dugum_id`` verilmiş ve düğüm varsa ona olgu eklenir (aynısı varsa ``zaten_var``).
4. ``baslik`` + çözülen ``ebeveyn`` varsa: aynı başlıklı doğrudan çocuk varsa ona
   olgu eklenir, yoksa yeni düğüm açılır.
5. Aksi halde öneri gelen kutusuna gider; kullanıcı ya da sonraki oturum yerleştirir.

Var olan düğümün eskiyen özet/ayrıntısı :func:`duzelt` ile düzeltilir, eskiyen
olgusu ``eskit`` ile eskitilir (aynı sır/gizlilik/kaynak kuralları; değişiklik
``gecmis``e düşer).

Hiçbir genel fonksiyon istisna fırlatmaz. Okumalar karar verilirken yapılır,
yazmalar tek işlemde topluca uygulanır.
"""

from __future__ import annotations

import json
import re
import sqlite3
import unicodedata
from contextlib import contextmanager
from typing import Any, Iterator

from bellek.devir.transcript import maskele

from . import db

try:  # sorgu.yol yoksa yerel yedek yürüyüş kullanılır
    from . import sorgu as _sorgu
except Exception:  # pragma: no cover - paralel yazılan modül henüz yoksa
    _sorgu = None

METIN_SINIRI = 300
OZET_SINIRI = 200
MESAJ_SINIRI = 300
ADAY_SAYISI = 3
ADAY_HAVUZU = 12  # süzmeden önce istenen aday sayısı
BASLIK_SINIRI = 120
DIS_KAYNAK_TURLERI = ("oturum", "elle")
YOL_AYRACI = " › "
GIZLILIK_SIRASI = {"normal": 0, "ozel": 1}
OZEL_DAL = "ozel"

Result = dict[str, Any]


# ------------------------------------------------------------------ yardımcılar


def _key(text: Any) -> str:
    """Başlık/metin karşılaştırma anahtarı: db.normalize + Türkçe katlama.

    db.normalize zaten büyük/küçük ve Türkçe karakter duyarsızsa bu adım
    etkisizdir; değilse eşleşmeyi yine de garanti eder.
    """
    s = _drop_apostrophes(str(text or ""))
    try:
        s = db.normalize(s) or ""
    except Exception:
        pass
    s = s.replace("İ", "i").replace("I", "ı")
    s = s.casefold().replace("ı", "i")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.split())


_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")  # \n, \t (ve \r) serbest

_APOSTROPHES = str.maketrans("", "", "'’‘`´")


def _drop_apostrophes(text: str) -> str:
    """Türkçe ek kesmesini yut: "Kasım'da" ile "Kasımda" aynı sayılsın."""
    return text.translate(_APOSTROPHES)


def _clip(text: str, limit: int = MESAJ_SINIRI) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _result(sonuc: str, mesaj: str, dugum_id: str | None = None,
            yol: list[str] | None = None, **extra: Any) -> Result:
    out: Result = {"sonuc": sonuc, "dugum_id": dugum_id, "yol": yol,
                   "mesaj": _clip(mesaj)}
    out.update(extra)
    return out


def _reject(neden: str, dugum_id: str | None = None,
            yol: list[str] | None = None) -> Result:
    return _result("reddedildi", "Reddedildi: " + neden, dugum_id, yol)


def _as_id(value: Any) -> str | None:
    """Düğüm kimliği adayı (ULID metni); tam sayı da metne çevrilir."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _root(con: sqlite3.Connection) -> str | None:
    """Kök kimliği; okuma yolunda kök oluşturmaz (yoksa None)."""
    return db.kok_bul(con)


def _node(con: sqlite3.Connection, node_id: str) -> dict[str, Any] | None:
    cur = con.execute(
        "SELECT id, baslik, gizlilik FROM dugum WHERE id = ?", (node_id,))
    row = cur.fetchone()
    if row is None:
        return None
    return {"id": row[0], "baslik": row[1], "gizlilik": row[2]}


def _children(con: sqlite3.Connection, parent: str) -> list[tuple[str, str, int]]:
    """Doğrudan çocuklar (alt kenar): (id, başlık, birincil); birincil önce."""
    cur = con.execute(
        "SELECT d.id, d.baslik, k.birincil FROM kenar k "
        "JOIN dugum d ON d.id = k.cocuk "
        "WHERE k.ebeveyn = ? AND k.tur = 'alt'", (parent,))
    rows = [(r[0], r[1] or "", 1 if r[2] else 0) for r in cur.fetchall()]
    rows.sort(key=lambda r: (-r[2], r[0]))
    return rows


def _child_by_title(con: sqlite3.Connection, parent: str, title: str) -> str | None:
    want = _key(title)
    if not want:
        return None
    for cid, ctitle, _ in _children(con, parent):
        if _key(ctitle) == want:
            return cid
    return None


def _parents(con: sqlite3.Connection, node_id: str) -> list[str]:
    cur = con.execute(
        "SELECT ebeveyn FROM kenar WHERE cocuk = ? AND tur = 'alt' "
        "ORDER BY birincil DESC, ebeveyn", (node_id,))
    return [r[0] for r in cur.fetchall()]


def _path(con: sqlite3.Connection, node_id: str | None) -> list[str] | None:
    if node_id is None:
        return None
    if _sorgu is not None:
        try:
            yol = _sorgu.yol(con, node_id)
            if yol:
                return [str(p) for p in yol]
        except Exception:
            pass
    parts: list[str] = []
    seen: set[str] = set()
    cur: str | None = node_id
    while cur is not None and cur not in seen:
        seen.add(cur)
        node = _node(con, cur)
        if node is None:
            break
        parts.append(node["baslik"] or f"#{cur}")
        ups = _parents(con, cur)
        cur = ups[0] if ups else None
    return list(reversed(parts)) or None


def _path_text(path: list[str] | None, node_id: str | None = None) -> str:
    if path:
        return YOL_AYRACI.join(path)
    return f"#{node_id}" if node_id is not None else "?"


def _split_path(text: str) -> list[str]:
    text = text.replace("›", "/").replace("\\", "/")
    return [p.strip() for p in text.split("/") if p.strip()]


def _resolve_parent(con: sqlite3.Connection, ebeveyn: Any) -> str | None:
    """Ebeveyni düğüm id'sine çevirir; çözülemezse None."""
    if ebeveyn is None:
        return None
    node_id = _as_id(ebeveyn)
    if node_id is None:
        return None
    if _node(con, node_id) is not None:  # önce kimlik olarak dene
        return node_id
    if not isinstance(ebeveyn, str):
        return None
    parts = _split_path(ebeveyn)
    if not parts:
        return None
    root = _root(con)
    if root is None:
        return None
    root_node = _node(con, root)
    # "<kök başlığı>/Okul" biçimine de tolerans: kök adı, kökün aynı adlı çocuğu yoksa atlanır
    if (root_node is not None and _key(parts[0]) == _key(root_node["baslik"])
            and _child_by_title(con, root, parts[0]) is None):
        parts = parts[1:]
    cur = root
    for part in parts:
        nxt = _child_by_title(con, cur, part)
        if nxt is None:
            return None
        cur = nxt
    return cur


def _under_private(con: sqlite3.Connection, node_id: str) -> bool:
    """Düğüm kökün "Özel" dalının kendisi ya da torunu mu (herhangi bir yoldan)."""
    root = _root(con)
    if root is None:
        return False
    private_ids = {cid for cid, t, _ in _children(con, root) if _key(t) == OZEL_DAL}
    if not private_ids:
        return False
    seen: set[str] = set()
    stack = [node_id]
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        if cur in private_ids:
            return True
        seen.add(cur)
        if len(seen) > 10000:
            break
        stack.extend(_parents(con, cur))
    return False


def _secret_effective(con: sqlite3.Connection, node_id: str) -> bool:
    """Düğüm ya da herhangi bir atası ``sir_icerir`` mi (etkin gizlilik sır)."""
    seen: set[str] = set()
    stack = [node_id]
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        if len(seen) > 10000:
            return True  # emin olamıyorsak sır say
        row = con.execute("SELECT gizlilik FROM dugum WHERE id = ?", (cur,)).fetchone()
        if row is not None and row[0] == "sir_icerir":
            return True
        stack.extend(_parents(con, cur))
    return False


def _same_fact(con: sqlite3.Connection, node_id: str, metin: str) -> str | None:
    want = _key(metin)
    cur = con.execute(
        "SELECT id, metin FROM olgu WHERE dugum = ? AND durum = 'aktif'", (node_id,))
    for oid, otext in cur.fetchall():
        if _key(otext) == want:
            return oid
    return None


def _candidates(con: sqlite3.Connection, metin: str, baslik: str | None,
                ebeveyn: Any = None) -> list[dict[str, Any]]:
    hint = " ".join(_split_path(ebeveyn)) if isinstance(ebeveyn, str) else ""
    query = _drop_apostrophes(" ".join(p for p in (hint, baslik or "", metin) if p))
    try:
        hits = db.fts_ara(con, query, k=ADAY_HAVUZU) or []
    except Exception:
        hits = []
    root = _root(con)
    out: list[dict[str, Any]] = []
    for hit in hits:
        if len(out) >= ADAY_SAYISI:
            break
        try:
            hid, score = str(hit[0]), float(hit[1])
            if hid == root:  # kök öneri değeri taşımaz
                continue
            if _secret_effective(con, hid):  # sır dalı aday ya da mesajda görünmez
                continue
        except Exception:
            continue
        out.append({"id": hid, "yol": _path(con, hid), "skor": round(score, 4)})
    return out


@contextmanager
def _transaction(con: sqlite3.Connection) -> Iterator[None]:
    """Tek işlem: ``with con:``; otomatik onay kipinde BEGIN/COMMIT elle."""
    autocommit = getattr(con, "autocommit", None) is True
    if not con.in_transaction and (autocommit or con.isolation_level is None):
        con.execute("BEGIN")
        try:
            yield
        except BaseException:
            con.execute("ROLLBACK")
            raise
        con.execute("COMMIT")
        return
    with con:
        yield


def _open_source(con: sqlite3.Connection, kaynak: Any) -> str:
    """Her dış yazma bir kaynak kaydına bağlanır; dışarıdan yalnız oturum/elle.

    Başka tür (ör. taklit "tohum") ya da sözlük olmayan kaynak → oturum/bilinmiyor.
    """
    if not isinstance(kaynak, dict):
        kaynak = {}
    tur = kaynak.get("tur")
    if tur not in DIS_KAYNAK_TURLERI:
        tur = "oturum"
    ref = kaynak.get("ref")
    ref = str(ref).strip() if ref is not None and str(ref).strip() else "bilinmiyor"
    istemci = kaynak.get("istemci")
    istemci = str(istemci)[:100] if istemci is not None else None
    return db.kaynak_ekle(con, tur, ref[:300], istemci=istemci)


def _set_inbox_state(con: sqlite3.Connection, gid: str, state: str,
                     kaynak_id: str | None) -> None:
    """Gelen kaydının durumunu değiştirir; db'de işlev olmadığı için doğrudan SQL,
    geçmiş kaydı db'nin kendi yardımcısıyla düşülür."""
    old = con.execute("SELECT * FROM gelen WHERE id = ?", (gid,)).fetchone()
    con.execute("UPDATE gelen SET durum = ? WHERE id = ?", (state, gid))
    log = getattr(db, "_gecmis_yaz", None)
    if log is not None and old is not None:
        old_d = dict(zip(old.keys(), old)) if hasattr(old, "keys") else None
        new_d = dict(old_d, durum=state) if old_d is not None else {"durum": state}
        log(con, "guncelle", "gelen", gid, old_d, new_d, kaynak_id)


# ------------------------------------------------------------------ karar


def _check_text(metin: Any, baslik: Any, ebeveyn: Any,
                gizlilik: Any) -> tuple[str | None, str, str | None]:
    """(red nedeni, temiz metin, temiz başlık)."""
    # strip'ten önce: \x0b, \x0c, \x1c-\x1f Python'da boşluk sayılır
    for alan, deger in (("metin", metin), ("başlık", baslik), ("ebeveyn", ebeveyn)):
        if isinstance(deger, str) and _CONTROL.search(deger):
            return (f"{alan} kontrol karakteri içeriyor (muhtemel kaçış hatası; "
                    "ters bölüleri kontrol et)."), "", None
    if not isinstance(metin, str) or not metin.strip():
        return "metin boş.", "", None
    metin = metin.strip()
    if len(metin) > METIN_SINIRI:
        return (f"metin {len(metin)} karakter, sınır {METIN_SINIRI}. "
                "Kısalt ya da birkaç olguya böl."), metin, None
    if baslik is not None and not isinstance(baslik, str):
        return "başlık metin olmalı.", metin, None
    baslik = baslik.strip() if isinstance(baslik, str) and baslik.strip() else None
    if baslik is not None and len(baslik) > BASLIK_SINIRI:
        return (f"başlık {len(baslik)} karakter, sınır {BASLIK_SINIRI}."), metin, None
    for alan, deger in (("metin", metin), ("başlık", baslik), ("ebeveyn", ebeveyn)):
        if isinstance(deger, str) and deger and maskele(deger) != deger:
            return (f"{alan} sır (parola/anahtar/token) içeriyor; "
                    "sırlar beyne yazılmaz."), metin, baslik
    if gizlilik is not None and gizlilik not in GIZLILIK_SIRASI:
        if gizlilik == "sir_icerir":
            return "sır taşıyan bilgi beyne yazılmaz.", metin, baslik
        return "gizlilik 'normal' ya da 'ozel' olmalı.", metin, baslik
    return None, metin, baslik


def _decide(con: sqlite3.Connection, metin: str, dugum_id: Any, ebeveyn: Any,
            baslik: str | None, gizlilik: str | None,
            allow_root: bool = False) -> dict[str, Any]:
    """Salt okuma: ne yapılacağını belirler, yazmaz."""
    node_id = _as_id(dugum_id)
    if node_id is not None:
        node = _node(con, node_id)
        if node is not None:
            return _fact_plan(con, node, metin)

    parent_id = _resolve_parent(con, ebeveyn) if baslik else None
    if baslik and parent_id is not None:
        existing = _child_by_title(con, parent_id, baslik)
        if existing is not None:
            return _fact_plan(con, _node(con, existing), metin)
        if parent_id == _root(con) and not allow_root:
            return {"islem": "gelen", "tur": "yeni_dugum",
                    "neden": "Kök altında yeni üst dal yalnız kullanıcı onayıyla açılır."}
        if _secret_effective(con, parent_id):
            return {"islem": "red", "neden": "ebeveyn sır taşıyan dalda; buraya yazılmaz."}
        parent = _node(con, parent_id) or {}
        level = GIZLILIK_SIRASI.get(gizlilik or "normal", 0)
        if parent.get("gizlilik") in ("ozel", "sir_icerir") or _under_private(con, parent_id):
            level = max(level, GIZLILIK_SIRASI["ozel"])
        privacy = next(k for k, v in GIZLILIK_SIRASI.items() if v == level)
        return {"islem": "dugum", "ebeveyn": parent_id, "baslik": baslik,
                "gizlilik": privacy}

    neden = None
    if dugum_id is not None and node_id is not None:
        neden = f"Düğüm #{node_id} yok."
    elif dugum_id is not None:
        neden = "dugum_id geçersiz."
    elif ebeveyn is not None and baslik:
        neden = f"Ebeveyn bulunamadı: {str(ebeveyn)[:60]}."
    elif baslik and ebeveyn is None:
        neden = "Ebeveyn verilmedi."
    return {"islem": "gelen", "tur": "yeni_dugum" if baslik else "olgu",
            "neden": neden}


def _fact_plan(con: sqlite3.Connection, node: dict[str, Any] | None,
               metin: str) -> dict[str, Any]:
    if node is None:
        return {"islem": "red", "neden": "düğüm okunamadı."}
    if node["gizlilik"] == "sir_icerir" or _secret_effective(con, node["id"]):
        return {"islem": "red", "dugum_id": node["id"],
                "neden": f"düğüm #{node['id']} sır içeriyor; bu düğüme yazılmaz."}
    same = _same_fact(con, node["id"], metin)
    if same is not None:
        return {"islem": "zaten_var", "dugum_id": node["id"], "olgu_id": same}
    return {"islem": "olgu", "dugum_id": node["id"]}


def _apply(con: sqlite3.Connection, plan: dict[str, Any], metin: str,
           kaynak_id: str | None) -> Result:
    """Planı uygular (işlem açmaz; çağıran açar)."""
    if plan["islem"] == "olgu":
        nid = plan["dugum_id"]
        oid = db.olgu_ekle(con, nid, metin, kaynak_id=kaynak_id, guven="orta")
        path = _path(con, nid)
        return _result("olgu_eklendi", f"Eklendi: {_path_text(path, nid)} (olgu)",
                       nid, path, olgu_id=oid)
    if plan["islem"] == "dugum":
        nid = db.dugum_ekle(con, plan["baslik"], ozet=metin[:OZET_SINIRI],
                            tur="bilgi", gizlilik=plan["gizlilik"],
                            ebeveyn=plan["ebeveyn"], kaynak_id=kaynak_id)
        oid = db.olgu_ekle(con, nid, metin, kaynak_id=kaynak_id, guven="orta")
        path = _path(con, nid)
        ek = ", özel" if plan["gizlilik"] == "ozel" else ""
        return _result("dugum_eklendi",
                       f"Yeni düğüm: {_path_text(path, nid)} (olgu da eklendi{ek})",
                       nid, path, olgu_id=oid)
    raise ValueError(f"uygulanamaz plan: {plan['islem']}")


def _quick(con: sqlite3.Connection, plan: dict[str, Any]) -> Result | None:
    """Yazma gerektirmeyen planların sonucu."""
    if plan["islem"] == "red":
        nid = plan.get("dugum_id")
        return _reject(plan["neden"], nid, _path(con, nid))
    if plan["islem"] == "zaten_var":
        nid = plan["dugum_id"]
        path = _path(con, nid)
        return _result("zaten_var",
                       f"Zaten var: {_path_text(path, nid)} (olgu #{plan['olgu_id']})",
                       nid, path, olgu_id=plan["olgu_id"])
    return None


def _is_transient(e: BaseException) -> bool:
    """Kilit/meşgul: yazma kaybolmasın, çağıran yeniden denesin."""
    if not isinstance(e, sqlite3.OperationalError):
        return False
    text = str(e).lower()
    return "locked" in text or "busy" in text


def _error(e: BaseException) -> Result:
    if _is_transient(e):
        out = _reject(f"veritabanı meşgul ({e}); geçici, yeniden denenecek.")
        out["gecici_hata"] = True
        return out
    return _reject(f"beklenmeyen hata ({type(e).__name__}: {e}).")


# ------------------------------------------------------------------ genel API


def yaz(con: sqlite3.Connection, metin: Any, dugum_id: Any = None,
        ebeveyn: Any = None, baslik: Any = None, gizlilik: Any = None,
        kaynak: Any = None, **_ignored: Any) -> Result:
    """Kullanıcı hakkında yeni bilgiyi doğru yere yazar; sonuç sözlüğü döndürür."""
    try:
        neden, metin, baslik = _check_text(metin, baslik, ebeveyn, gizlilik)
        if neden:
            return _reject(neden)
        plan = _decide(con, metin, dugum_id, ebeveyn, baslik, gizlilik)
        quick = _quick(con, plan)
        if quick is not None:
            return quick
        if plan["islem"] == "gelen":
            adaylar = _candidates(con, metin, baslik, ebeveyn)
            oneri = {"metin": metin, "baslik": baslik,
                     "ebeveyn": ebeveyn if isinstance(ebeveyn, (str, int)) else None,
                     "adaylar": adaylar}
            if gizlilik is not None:
                oneri["gizlilik"] = gizlilik
            with _transaction(con):
                kid = _open_source(con, kaynak)
                gid = db.gelen_ekle(con, plan["tur"], oneri, kaynak_id=kid)
            if adaylar:
                aday = f"En iyi aday: {_path_text(adaylar[0]['yol'], adaylar[0]['id'])}."
            else:
                aday = "Uygun aday bulunamadı."
            on = (plan["neden"] + " ") if plan.get("neden") else ""
            return _result("gelen_kutusuna",
                           f"{on}Gelen kutusuna alındı (#{gid}). {aday} "
                           "Kullanıcı ya da sonraki oturum yerleştirecek.",
                           None, None, gelen_id=gid, adaylar=adaylar)
        with _transaction(con):
            kid = _open_source(con, kaynak)
            return _apply(con, plan, metin, kid)
    except Exception as e:
        return _error(e)


_DUZELT_ALANLARI = (("ozet", "özet"), ("ayrinti", "ayrıntı"))


def _squash(text: str) -> str:
    """Olgu eşleştirme anahtarı: kırp, iç boşlukları teke indir; harf duyarlı."""
    return " ".join(text.split())


def _check_edit(ozet: Any, ayrinti: Any,
                eskit: Any = None) -> tuple[str | None, dict[str, str], str | None]:
    """(red nedeni, temiz alanlar, temiz eskit metni).

    Yalnız verilen (None olmayan) alanlar döner; ``eskit`` verilmemişse None.
    """
    degerler = {"ozet": ozet, "ayrinti": ayrinti}
    if ozet is None and ayrinti is None and eskit is None:
        return "özet, ayrıntı ya da eskitilecek olgudan en az biri verilmeli.", {}, None
    for alan, ad in _DUZELT_ALANLARI:
        deger = degerler[alan]
        if deger is not None and not isinstance(deger, str):
            return f"{ad} metin olmalı.", {}, None
    if eskit is not None and not isinstance(eskit, str):
        return "eskitilecek olgu metin olmalı.", {}, None
    # strip'ten önce: \x0b, \x0c, \x1c-\x1f Python'da boşluk sayılır
    for alan, ad in _DUZELT_ALANLARI + (("eskit", "eskitilecek olgu"),):
        deger = eskit if alan == "eskit" else degerler[alan]
        if isinstance(deger, str) and _CONTROL.search(deger):
            return (f"{ad} kontrol karakteri içeriyor (muhtemel kaçış hatası; "
                    "ters bölüleri kontrol et)."), {}, None
    temiz: dict[str, str] = {}
    for alan, _ in _DUZELT_ALANLARI:
        deger = degerler[alan]
        if isinstance(deger, str):
            temiz[alan] = deger.strip()
    if "ozet" in temiz and not temiz["ozet"]:
        return "özet boş olamaz.", {}, None
    eskit_temiz = _squash(eskit) if isinstance(eskit, str) else None
    if eskit_temiz is not None and not eskit_temiz:
        return "eskitilecek olgu boş olamaz.", {}, None
    sinirlar = {"ozet": getattr(db, "OZET_SINIR", OZET_SINIRI),
                "ayrinti": getattr(db, "AYRINTI_SINIR", 1500)}
    ipucu = {"ozet": "Kısalt; uzun bilgi ayrıntıya ya da olguya yazılır.",
             "ayrinti": "Kısalt; fazlası olgu olarak eklenebilir."}
    for alan, ad in _DUZELT_ALANLARI:
        if alan in temiz and len(temiz[alan]) > sinirlar[alan]:
            return (f"{ad} {len(temiz[alan])} karakter, sınır {sinirlar[alan]}. "
                    f"{ipucu[alan]}"), {}, None
    for alan, ad in _DUZELT_ALANLARI:
        if temiz.get(alan) and maskele(temiz[alan]) != temiz[alan]:
            return (f"{ad} sır (parola/anahtar/token) içeriyor; "
                    "sırlar beyne yazılmaz."), {}, None
    if eskit_temiz and maskele(eskit_temiz) != eskit_temiz:
        return ("eskitilecek olgu sır (parola/anahtar/token) içeriyor; "
                "sırlar beyne yazılmaz."), {}, None
    return None, temiz, eskit_temiz


def _fact_to_retire(con: sqlite3.Connection, node_id: str,
                    metin: str) -> tuple[str | None, str | None]:
    """(red nedeni, eskitilecek olgu id'si). İkisi de None: yalnız eskimiş eşleşme var.

    Düğümün olguları kırpılmış/boşluğu teke indirilmiş metinle, harf duyarlı
    karşılaştırılır. Birden çok aktif eşleşme belirsizdir, reddedilir.
    """
    aktif: list[str] = []
    diger = 0
    for oid, otext, odurum in con.execute(
            "SELECT id, metin, durum FROM olgu WHERE dugum = ? ORDER BY id", (node_id,)):
        if _squash(otext or "") != metin:
            continue
        if odurum == "aktif":
            aktif.append(oid)
        else:
            diger += 1
    if len(aktif) > 1:
        return (f"düğüm #{node_id} için bu metinle {len(aktif)} aktif olgu eşleşiyor; "
                "belirsiz, eskitilmedi."), None
    if aktif:
        return None, aktif[0]
    if diger:
        return None, None
    return (f"olgu bulunamadı: düğüm #{node_id} aktif olgularında "
            f"“{_clip(metin, 80)}” yok. Metni beyin_oku çıktısındaki gibi ver."), None


def duzelt(con: sqlite3.Connection, dugum_id: Any, ozet: Any = None,
           ayrinti: Any = None, kaynak: Any = None, eskit: Any = None,
           **_ignored: Any) -> Result:
    """Var olan düğümün özetini/ayrıntısını düzeltir, istenirse bir olguyu eskitir.

    ``ozet`` ve ``ayrinti`` tam metin olarak değişir (başlık, gizlilik, tür, durum
    ve kenarlara dokunulmaz). ``ayrinti=""`` ayrıntıyı temizler; özet boş olamaz.
    ``eskit`` düğümün aktif bir olgusunun metnidir (kırpılır, iç boşluklar teke
    iner, harf duyarlı); eşleşen olgu ``db.olgu_eskit`` ile eskitilir, silinmez.
    Tüm değişiklikler tek işlemde yazılır ve ``gecmis``e düşer; herhangi bir
    doğrulama reddederse hiçbir şey yazılmaz. Değişecek bir şey yoksa yazma
    yapılmaz (``degismedi``).
    """
    try:
        node_id = _as_id(dugum_id)
        if node_id is None:
            return _reject("dugum_id geçersiz." if dugum_id is not None
                           else "dugum_id verilmedi.")
        neden, temiz, eskit_metin = _check_edit(ozet, ayrinti, eskit)
        if neden:
            return _reject(neden)
        row = con.execute("SELECT id, gizlilik, ozet, ayrinti FROM dugum WHERE id = ?",
                          (node_id,)).fetchone()
        if row is None:
            return _reject(f"Düğüm #{node_id} yok.")
        if row[1] == "sir_icerir" or _secret_effective(con, node_id):
            return _reject(f"düğüm #{node_id} sır içeriyor; bu düğüme yazılmaz.",
                           node_id, _path(con, node_id))
        olgu_id: str | None = None
        if eskit_metin is not None:
            neden, olgu_id = _fact_to_retire(con, node_id, eskit_metin)
            if neden:
                return _reject(neden, node_id, _path(con, node_id))
        mevcut = {"ozet": row[2] or "", "ayrinti": row[3] or ""}
        degisen = {k: v for k, v in temiz.items() if mevcut[k] != v}
        path = _path(con, node_id)
        if not degisen and olgu_id is None:
            ek = "; olgu zaten eskimiş" if eskit_metin is not None else ""
            return _result("degismedi",
                           f"Değişmedi: {_path_text(path, node_id)}; "
                           f"verilen değerler mevcutla aynı{ek}.",
                           node_id, path, degisen=[])
        with _transaction(con):
            kid = _open_source(con, kaynak)
            if degisen:
                db.dugum_guncelle(con, node_id, kaynak_id=kid, **degisen)
            if olgu_id is not None:
                db.olgu_eskit(con, olgu_id, kaynak_id=kid)
        adlar = [ad for alan, ad in _DUZELT_ALANLARI if alan in degisen]
        alanlar = [alan for alan, _ in _DUZELT_ALANLARI if alan in degisen]
        extra: dict[str, Any] = {}
        if olgu_id is not None:
            adlar.append("olgu eskitildi")
            alanlar.append("olgu")
            extra["olgu_id"] = olgu_id
        return _result("guncellendi",
                       f"Güncellendi: {_path_text(path, node_id)} ({', '.join(adlar)})",
                       node_id, path, degisen=alanlar, **extra)
    except Exception as e:
        return _error(e)


def gelen_listele(con: sqlite3.Connection, durum: str | None = "bekliyor") -> list[dict[str, Any]]:
    """Gelen kutusu kayıtları (``durum=None`` hepsi), eskiden yeniye."""
    try:
        sql = "SELECT id, zaman, tur, oneri_json, kaynak_id, durum FROM gelen"
        args: tuple[Any, ...] = ()
        if durum is not None:
            sql += " WHERE durum = ?"
            args = (durum,)
        out = []
        for gid, zaman, tur, oneri_json, kid, gdurum in con.execute(sql + " ORDER BY zaman, id", args):
            try:
                oneri = json.loads(oneri_json) if oneri_json else {}
            except Exception:
                oneri = {}
            if not isinstance(oneri, dict):
                oneri = {}
            out.append({"id": gid, "zaman": zaman, "tur": tur, "durum": gdurum,
                        "kaynak_id": kid, "oneri": oneri, "oneri_json": oneri_json,
                        "adaylar": oneri.get("adaylar") or []})
        return out
    except Exception:
        return []


def gelen_karar(con: sqlite3.Connection, gelen_id: Any, karar: Any,
                duzeltme: dict[str, Any] | None = None) -> Result:
    """Gelen kutusu önerisini kabul eder (kural 3/4 ile yazar) ya da reddeder."""
    try:
        gid = _as_id(gelen_id)
        if gid is None:
            return _reject("gelen kimliği geçersiz.")
        row = con.execute(
            "SELECT tur, oneri_json, kaynak_id, durum FROM gelen WHERE id = ?",
            (gid,)).fetchone()
        if row is None:
            return _reject(f"gelen #{gid} yok.")
        tur, oneri_json, kid, gdurum = row
        if gdurum != "bekliyor":
            return _reject(f"gelen #{gid} zaten karara bağlanmış ({gdurum}).")
        if karar == "red":
            with _transaction(con):
                _set_inbox_state(con, gid, "red", kid)
            return _result("reddedildi", f"Gelen #{gid} reddedildi; beyne yazılmadı.",
                           gelen_id=gid)
        if karar != "kabul":
            return _reject("karar 'kabul' ya da 'red' olmalı.")

        try:
            oneri = json.loads(oneri_json) if oneri_json else {}
        except Exception:
            oneri = {}
        if not isinstance(oneri, dict):
            oneri = {}
        if duzeltme is not None and not isinstance(duzeltme, dict):
            return _reject("duzeltme bir nesne olmalı.")
        d = duzeltme or {}

        metin = d.get("metin", oneri.get("metin"))
        gizlilik = d.get("gizlilik", oneri.get("gizlilik"))
        if "dugum_id" in d:
            dugum_id, ebeveyn, baslik = d["dugum_id"], None, None
        elif "ebeveyn" in d or "baslik" in d:
            dugum_id = None
            ebeveyn = d.get("ebeveyn", oneri.get("ebeveyn"))
            baslik = d.get("baslik", oneri.get("baslik"))
        elif tur == "olgu" and oneri.get("adaylar"):
            # düzeltmesiz kabul: en iyi adaya olgu
            dugum_id, ebeveyn, baslik = oneri["adaylar"][0].get("id"), None, None
        else:
            dugum_id, ebeveyn, baslik = None, oneri.get("ebeveyn"), oneri.get("baslik")

        neden, metin, baslik = _check_text(metin, baslik, ebeveyn, gizlilik)
        if neden:
            return _reject(neden)
        # gelen_karar kullanıcının onay yolu (servis arayüzü): kök altında dal açabilir
        plan = _decide(con, metin, dugum_id, ebeveyn, baslik, gizlilik, allow_root=True)
        if plan["islem"] == "gelen":
            ek = (plan["neden"] + " ") if plan.get("neden") else ""
            return _reject(f"{ek}Hedef çözülemedi; gelen #{gid} bekliyor. "
                           "duzeltme ile {dugum_id} ya da {ebeveyn, baslik} ver.")
        if plan["islem"] == "red":
            return _quick(con, plan)  # type: ignore[return-value]
        if plan["islem"] == "zaten_var":
            with _transaction(con):
                _set_inbox_state(con, gid, "kabul", kid)
            out = _quick(con, plan)
            assert out is not None
            out["gelen_id"] = gid
            return out
        with _transaction(con):
            out = _apply(con, plan, metin, kid)
            _set_inbox_state(con, gid, "kabul", kid)
        out["gelen_id"] = gid
        return out
    except Exception as e:
        return _error(e)
