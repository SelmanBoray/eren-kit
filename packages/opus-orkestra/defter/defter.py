#!/usr/bin/env python3
"""defter — Opus Orkestra bağlam defteri (yalnız standart kütüphane + git).

Amaç: alt agent'lar kodu her seferinde baştan okumasın. Bir agent işini bitirince dokunduğu
dosyaların özetini yazar; defter dosyanın o anki içeriğini git nesne deposuna (`hash-object -w`)
kaydeder. Sonraki agent `oku` ile özeti ve yalnız o andan beri değişen kısmı (commit edilmemiş
değişiklikler dahil) alır; dosyanın tamamını ancak gerekirse okur.

Depo: `<git-common-dir>/orkestra/defter.jsonl` — depoya girmez, worktree'ler arasında ortaktır.

Komutlar:
  defter yaz --dosya YOL [--dosya YOL ...] --ozet METİN [--kavram "ad: açıklama" ...] [--gorev METİN]
  defter oku [YOL ...] [--sinir SATIR]     özet + kayıttan beri fark (yol verilmezse tümü)
  defter kavram                             kayıtlı kavramlar (her adın en son tanımı)
  defter durum                              kart sayısı, boyut, en eski/yeni kayıt
  defter ozetle [--eski N] [--yerel MODEL]  DENEYSEL: eski kartları sıkıştırma girdisi üretir;
                                            --yerel ile `ollama run MODEL` özetler ve özet kartı yazar
  defter temizle --tut N                    yalnız son N kartı tutar
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

OZET_SINIR = 1500
KAVRAM_SINIR = 240
VARSAYILAN_FARK_SINIRI = 160


class DefterHatasi(Exception):
    pass


def _git(*args: str, cwd: str | None = None, check: bool = True) -> str:
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8",
                       errors="replace")
    if check and p.returncode != 0:
        raise DefterHatasi(f"git {' '.join(args[:2])} başarısız: {p.stderr.strip()[:200]}")
    return p.stdout


def kok() -> str:
    try:
        return _git("rev-parse", "--show-toplevel").strip()
    except (DefterHatasi, FileNotFoundError) as e:
        raise DefterHatasi("bir git deposunun içinde çalıştır (defter depo başına tutulur)") from e


def defter_yolu(k: str) -> str:
    ortak = _git("rev-parse", "--git-common-dir", cwd=k).strip()
    if not os.path.isabs(ortak):
        ortak = os.path.join(k, ortak)
    return os.path.join(os.path.normpath(ortak), "orkestra", "defter.jsonl")


def goreli(k: str, yol: str) -> str:
    mutlak = os.path.abspath(yol)
    return os.path.relpath(mutlak, k).replace(os.sep, "/")


def kartlar(dosya: str) -> list[dict]:
    if not os.path.exists(dosya):
        return []
    out = []
    with open(dosya, encoding="utf-8") as f:
        for satir in f:
            satir = satir.strip()
            if not satir:
                continue
            try:
                out.append(json.loads(satir))
            except json.JSONDecodeError:
                continue  # yarım yazılmış satır: yok say
    return out


def ekle(dosya: str, kart: dict) -> None:
    os.makedirs(os.path.dirname(dosya), exist_ok=True)
    with open(dosya, "a", encoding="utf-8") as f:
        f.write(json.dumps(kart, ensure_ascii=False) + "\n")


def blob(k: str, rel: str, yaz: bool) -> str | None:
    yol = os.path.join(k, rel)
    if not os.path.isfile(yol):
        return None
    args = ["hash-object"] + (["-w"] if yaz else []) + ["--", rel]
    return _git(*args, cwd=k).strip()


def simdi() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# ---------------------------------------------------------------- komutlar

def k_yaz(a) -> int:
    k = kok()
    if not a.ozet and not a.kavram:
        raise DefterHatasi("--ozet ya da en az bir --kavram gerekli")
    ozet = (a.ozet or "").strip()
    if len(ozet) > OZET_SINIR:
        raise DefterHatasi(f"özet {OZET_SINIR} karakteri aşıyor ({len(ozet)}); kısalt, ayrıntı koda kalsın")
    kavramlar = []
    for kv in a.kavram or []:
        kv = kv.strip()
        if ":" not in kv or len(kv) > KAVRAM_SINIR:
            raise DefterHatasi(f'kavram "ad: açıklama" biçiminde ve ≤{KAVRAM_SINIR} karakter olmalı')
        ad, _, aciklama = kv.partition(":")
        kavramlar.append({"ad": ad.strip(), "aciklama": aciklama.strip()})
    dosyalar = []
    for y in a.dosya or []:
        rel = goreli(k, y)
        b = blob(k, rel, yaz=True)
        if b is None:
            raise DefterHatasi(f"dosya yok: {rel}")
        dosyalar.append({"yol": rel, "blob": b})
    head = _git("rev-parse", "--verify", "-q", "HEAD", cwd=k, check=False).strip() or None
    kart = {"zaman": simdi(), "tur": a.tur, "gorev": (a.gorev or "").strip() or None, "ozet": ozet,
            "dosyalar": dosyalar, "kavramlar": kavramlar, "head": head}
    ekle(defter_yolu(k), kart)
    print(f"defter: kart yazıldı ({len(dosyalar)} dosya, {len(kavramlar)} kavram)")
    return 0


def son_kartlar_dosya_icin(ks: list[dict]) -> dict[str, tuple[dict, str]]:
    """yol -> (o yolu içeren en son kart, o andaki blob)."""
    son: dict[str, tuple[dict, str]] = {}
    for kart in ks:
        for d in kart.get("dosyalar") or []:
            son[d["yol"]] = (kart, d["blob"])
    return son


def k_oku(a) -> int:
    k = kok()
    ks = kartlar(defter_yolu(k))
    son = son_kartlar_dosya_icin(ks)
    istenen = [goreli(k, y) for y in a.yollar] if a.yollar else sorted(son)
    if not istenen:
        print("defter boş: dosyaları gerektiği kadar oku, işin sonunda `defter yaz` ile özetle.")
        return 0
    kalan = a.sinir
    for rel in istenen:
        if rel not in son:
            print(f"## {rel}\nkayıt yok — dosyayı oku (gerekirse satır aralığıyla), sonra `defter yaz`.\n")
            continue
        kart, eski = son[rel]
        yeni = blob(k, rel, yaz=True)
        print(f"## {rel}  ({kart['zaman']})")
        print(kart["ozet"] or "(özet yok)")
        if yeni is None:
            print("durum: dosya artık YOK (silinmiş ya da taşınmış).\n")
            continue
        if yeni == eski:
            print("durum: kayıttan beri DEĞİŞMEDİ — özet güncel, dosyayı yeniden okumaya gerek yok.\n")
            continue
        fark = _git("diff", "--no-color", "-U2", eski, yeni, cwd=k, check=False).splitlines()
        fark = [s for s in fark if not s.startswith(("diff --git", "index "))]
        print(f"durum: kayıttan beri DEĞİŞTİ ({len(fark)} satır fark):")
        if kalan <= 0:
            print("[fark sınırı doldu; bu dosya için `defter oku " + rel + "` ayrıca çalıştır]\n")
            continue
        print("\n".join(fark[:kalan]))
        if len(fark) > kalan:
            print(f"[... {len(fark) - kalan} satır daha; gerekirse dosyanın ilgili aralığını oku]")
        kalan -= len(fark)
        print()
    return 0


def k_kavram(a) -> int:
    k = kok()
    son: dict[str, str] = {}
    for kart in kartlar(defter_yolu(k)):
        for kv in kart.get("kavramlar") or []:
            son[kv["ad"]] = kv["aciklama"]
    if not son:
        print("kayıtlı kavram yok")
    for ad in sorted(son, key=str.casefold):
        print(f"- {ad}: {son[ad]}")
    return 0


def k_durum(a) -> int:
    k = kok()
    yol = defter_yolu(k)
    ks = kartlar(yol)
    boyut = os.path.getsize(yol) if os.path.exists(yol) else 0
    dosya_sayisi = len(son_kartlar_dosya_icin(ks))
    print(f"defter: {yol}\nkart: {len(ks)}, izlenen dosya: {dosya_sayisi}, boyut: {boyut} bayt")
    if ks:
        print(f"en eski: {ks[0]['zaman']}  en yeni: {ks[-1]['zaman']}")
    return 0


def _sikistirma_girdisi(ks: list[dict]) -> str:
    satirlar = []
    for kart in ks:
        yollar = ", ".join(d["yol"] for d in kart.get("dosyalar") or [])
        satirlar.append(f"- [{kart['zaman']}] {kart.get('gorev') or ''} | {yollar} | {kart.get('ozet') or ''}")
        for kv in kart.get("kavramlar") or []:
            satirlar.append(f"  kavram {kv['ad']}: {kv['aciklama']}")
    return "\n".join(satirlar)


def k_ozetle(a) -> int:
    """DENEYSEL. Eski kartları tek özet kartına sıkıştırma girdisi üretir.

    Varsayılan: sıkıştırılacak metni yazdırır; şef bunu `model: "haiku"`, effort low bir alt
    agent'a verir ve dönen özeti `defter yaz --tur ozet --ozet ...` ile kaydettirir.
    --yerel MODEL: `ollama` kuruluysa özet yerel modelle üretilir (API token harcanmaz)."""
    k = kok()
    ks = [x for x in kartlar(defter_yolu(k)) if x.get("tur") != "ozet"]
    eski = ks[: max(0, len(ks) - a.eski)] if a.eski else ks
    if not eski:
        print("sıkıştırılacak eski kart yok")
        return 0
    girdi = _sikistirma_girdisi(eski)
    istem = ("Aşağıdaki proje defteri kartlarını, kod okumadan sonraki bir mühendisin işine yarayacak "
             f"şekilde en fazla {OZET_SINIR} karakterlik tek bir özete sıkıştır: modüllerin görevi, kritik "
             "arayüzler, alınan kararlar ve kavramlar. Tekrar ve geçmiş anlatısı yok.\n\n" + girdi)
    if not a.yerel:
        print(istem)
        return 0
    if not shutil.which("ollama"):
        raise DefterHatasi("--yerel için `ollama` bulunamadı; yerel model yoksa haiku alt agent'ı kullan")
    t0 = time.time()
    p = subprocess.run(["ollama", "run", a.yerel], input=istem, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=600)
    if p.returncode != 0 or not p.stdout.strip():
        raise DefterHatasi(f"yerel model özet üretemedi: {p.stderr.strip()[:200]}")
    ozet = p.stdout.strip()[:OZET_SINIR]
    ekle(defter_yolu(k), {"zaman": simdi(), "tur": "ozet", "gorev": f"yerel özet ({a.yerel})",
                          "ozet": ozet, "dosyalar": [], "kavramlar": [], "head": None})
    print(f"defter: {len(eski)} kart yerel modelle özetlendi ({time.time() - t0:.1f} sn)")
    return 0


def k_temizle(a) -> int:
    k = kok()
    yol = defter_yolu(k)
    ks = kartlar(yol)
    if a.tut < 0:
        raise DefterHatasi("--tut negatif olamaz")
    tut = ks[-a.tut:] if a.tut else []
    tmp = yol + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for kart in tut:
            f.write(json.dumps(kart, ensure_ascii=False) + "\n")
    os.replace(tmp, yol)
    print(f"defter: {len(ks) - len(tut)} kart silindi, {len(tut)} kaldı")
    return 0


def main(argv: list[str] | None = None) -> int:
    for akim in (sys.stdout, sys.stderr):
        try:
            akim.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    p = argparse.ArgumentParser(prog="defter", description="Opus Orkestra bağlam defteri")
    alt = p.add_subparsers(dest="komut", required=True)
    y = alt.add_parser("yaz")
    y.add_argument("--dosya", action="append")
    y.add_argument("--ozet")
    y.add_argument("--kavram", action="append")
    y.add_argument("--gorev")
    y.add_argument("--tur", default="kart", choices=["kart", "ozet"])
    o = alt.add_parser("oku")
    o.add_argument("yollar", nargs="*")
    o.add_argument("--sinir", type=int, default=VARSAYILAN_FARK_SINIRI, help="toplam fark satırı sınırı")
    alt.add_parser("kavram")
    alt.add_parser("durum")
    z = alt.add_parser("ozetle")
    z.add_argument("--eski", type=int, default=0, help="son N kartı dışarıda bırak")
    z.add_argument("--yerel", metavar="MODEL", help="DENEYSEL: ollama modeliyle yerelde özetle")
    t = alt.add_parser("temizle")
    t.add_argument("--tut", type=int, required=True)
    a = p.parse_args(argv)
    try:
        return {"yaz": k_yaz, "oku": k_oku, "kavram": k_kavram, "durum": k_durum,
                "ozetle": k_ozetle, "temizle": k_temizle}[a.komut](a)
    except DefterHatasi as e:
        print(f"defter: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
