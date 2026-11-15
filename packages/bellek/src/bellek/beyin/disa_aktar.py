"""Beyin grafını dışa aktarma: markdown ağacı ve JSONL dökümü.

Gizlilik etkin değere göre uygulanır (DESIGN §16.2): düğümün kendi işareti ile
birincil ata zincirinin en kısıtlayıcısı. Kural tek yerde, `sorgu._EtkinGizlilik`
içindedir; burada yeniden yazılmaz. Okuma yolu yazmaz (kök oluşturulmaz).
"""

from __future__ import annotations

import json

from . import db, sorgu

_NORMAL, _OZEL, _SIR = "normal", "ozel", "sir_icerir"


def _satirlar(con, sql, args=()):
    cur = con.execute(sql, args)
    ad = [d[0] for d in cur.description]
    return [dict(zip(ad, r)) for r in cur.fetchall()]


def _tek_satir(m):
    return " ".join(str(m).split()) if m else ""


def markdown_agac(con, ozel_dahil=True, sir_dahil=False) -> str:
    dugumler = {d["id"]: d for d in _satirlar(con, "SELECT * FROM dugum")}
    kenarlar = _satirlar(con, "SELECT * FROM kenar")
    kok = db.kok_bul(con)  # okuma yolu: kök yoksa oluşturulmaz
    if kok not in dugumler:
        kok = None
    etkin = sorgu._EtkinGizlilik(con)

    cocuklar: dict = {}
    birincil_ebeveyn: dict = {}
    for k in kenarlar:
        if k["birincil"]:
            cocuklar.setdefault(k["ebeveyn"], []).append(k)
            birincil_ebeveyn.setdefault(k["cocuk"], k["ebeveyn"])
    for lst in cocuklar.values():
        lst.sort(key=lambda k: (k["sira"] if k["sira"] is not None else 0,
                                dugumler.get(k["cocuk"], {}).get("baslik") or "",
                                k["cocuk"]))

    def baslik(i):
        return dugumler[i]["baslik"]

    def yol(i):
        parcalar, goruldu = [], set()
        while i is not None and i in dugumler and i not in goruldu:
            goruldu.add(i)
            parcalar.append(baslik(i))
            i = birincil_ebeveyn.get(i)
        return " / ".join(reversed(parcalar))

    def ozet_metni(d):
        g = etkin(d["id"])
        # Sır, özelden daha kısıtlayıcıdır: sır içeriği hem sir_dahil hem
        # ozel_dahil ister (özel bir dalın altındaki sır da özel sayılır).
        if g == _SIR and not (sir_dahil and ozel_dahil):
            return "[gizli]"
        if g == _OZEL and not ozel_dahil:
            return "[özel]"
        return _tek_satir(d.get("ozet"))

    def satir(d, girinti):
        s = f"{girinti}- **{d['baslik']}**"
        o = ozet_metni(d)
        if o:
            s += f" — {o}"
        durum = d.get("durum")
        if durum and durum != "aktif":
            s += f" [{durum}]"
        if d.get("tarih"):
            s += f" ({d['tarih']})"
        ilg = ilgili.get(d["id"])
        if ilg:
            s += " · ilgili: " + ", ".join(baslik(x) for x in ilg[:3])
        return s

    cikti, goruldu = [], set()

    def yuru(i, derinlik):
        girinti = "  " * derinlik
        if i in goruldu:  # döngü koruması
            return
        goruldu.add(i)
        cikti.append(satir(dugumler[i], girinti))
        for k in cocuklar.get(i, []):
            if k["cocuk"] in dugumler:
                yuru(k["cocuk"], derinlik + 1)
        # birincil olmayan kenarlar (ek yerleşim)
        for k in ek_kenarlar.get(i, []):
            c = k["cocuk"]
            if c in dugumler:
                cikti.append(f"{girinti}  - ↪ {baslik(c)} (birincil: {yol(birincil_ebeveyn.get(c))})")

    ek_kenarlar: dict = {}
    ilgili: dict = {}
    for k in sorted(kenarlar, key=lambda k: (k["sira"] if k["sira"] is not None else 0,
                                             dugumler.get(k["cocuk"], {}).get("baslik") or "",
                                             k["cocuk"])):
        if k["tur"] == "ilgili":
            for a, b in ((k["ebeveyn"], k["cocuk"]), (k["cocuk"], k["ebeveyn"])):
                if b in dugumler and b != a:
                    ilgili.setdefault(a, [])
                    if b not in ilgili[a]:
                        ilgili[a].append(b)
        elif not k["birincil"]:
            ek_kenarlar.setdefault(k["ebeveyn"], []).append(k)

    if kok is not None:
        yuru(kok, 0)
    yetim = [i for i in sorted(dugumler) if i not in goruldu]
    if yetim:
        cikti.append("")
        cikti.append("## Yetim düğümler (birincil ebeveyni yok)")
        for i in yetim:
            if i not in goruldu:
                yuru(i, 0)

    dal = sum(1 for i in dugumler if cocuklar.get(i))
    kok_basligi = dugumler[kok]["baslik"] if kok is not None else db.KOK_BASLIK
    baslik_satiri = [
        f"# {kok_basligi} — bilgi haritası",
        "",
        f"Toplam {len(dugumler)} düğüm, {dal} dal.",
        "",
    ]
    return "\n".join(baslik_satiri + cikti) + "\n"


def jsonl_dok(con, yol) -> int:
    """Deterministik JSONL dökümü (id sırasıyla). Yazılan satır sayısını döner.

    Etkin gizliliği sır olan düğümün (kendi işaretli ya da sır atadan kalıtan)
    özeti, ayrıntısı ve olgu metinleri boşaltılır; `gizlilik` alanı düğümün
    kendi değeri olarak kalır (geri yüklemede kalıtım yeniden hesaplanır).
    """
    etkin = sorgu._EtkinGizlilik(con)
    sirlar = set()
    n = 0
    from bellek.izin import ozel_acici  # POSIX: yeni döküm dosyası 0600 (yedekler gibi)

    with open(yol, "w", encoding="utf-8", newline="\n", opener=ozel_acici) as f:
        def yaz(tur, satir):
            nonlocal n
            f.write(json.dumps({"tur": tur, **{k: v for k, v in satir.items() if k != "tur"}},
                               ensure_ascii=False, sort_keys=True) + "\n")
            n += 1

        for d in _satirlar(con, "SELECT * FROM dugum ORDER BY id"):
            if etkin(d["id"]) == _SIR:
                sirlar.add(d["id"])
                d["ayrinti"] = None
                d["ozet"] = None
            d["dugum_turu"] = d.pop("tur", None)
            yaz("dugum", d)
        for k in _satirlar(con, "SELECT * FROM kenar ORDER BY ebeveyn, cocuk, tur"):
            k["kenar_turu"] = k.pop("tur", None)
            yaz("kenar", k)
        for o in _satirlar(con, "SELECT * FROM olgu WHERE durum = 'aktif' ORDER BY id"):
            if o.get("dugum") in sirlar:
                o["metin"] = None
            yaz("olgu", o)
    return n
