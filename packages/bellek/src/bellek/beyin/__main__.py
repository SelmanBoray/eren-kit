"""CLI: python -m bellek.beyin <komut>"""

from __future__ import annotations

import argparse
import json
import sys


def _kur():
    p = argparse.ArgumentParser(prog="python -m bellek.beyin", description="Beyin: kullanıcı hakkındaki bilgi grafı")
    alt = p.add_subparsers(dest="komut", required=True)

    a = alt.add_parser("ice-al", help="JSONL dosyasından içe al")
    a.add_argument("jsonl")
    a.add_argument("--uzerine-yaz", action="store_true", help="tohum dışı düzeltilmiş düğümleri de tohumla ez")

    a = alt.add_parser("yedekle", help="veritabanının tutarlı yedeğini al")
    a.add_argument("--dizin", default=None, help="yedek dizini (vars. yerel durum dizini)")
    a.add_argument("--sakla", type=int, default=14, help="saklanacak yedek sayısı (vars. 14)")

    a = alt.add_parser("yedekler", help="yedekleri listele")
    a.add_argument("--dizin", default=None, help="yedek dizini (vars. yerel durum dizini)")

    a = alt.add_parser("geri-yukle", help="yedekten geri yükle (servis kapalıyken)")
    a.add_argument("yedek")
    a.add_argument("--evet", action="store_true", help="onay sormadan geri yükle")

    a = alt.add_parser("disa-aktar", help="haritayı dışa aktar")
    a.add_argument("--bicim", choices=["md", "jsonl"], required=True)
    a.add_argument("--cikti", help="çıktı dosyası (jsonl için zorunlu)")
    a.add_argument("--ozelsiz", action="store_true", help="özel düğümlerin özetini gizle")

    a = alt.add_parser("servis", help="yerel servisi başlat")
    a.add_argument("--port", type=int, default=None)

    alt.add_parser("mcp", help="MCP köprüsünü başlat")

    a = alt.add_parser("ac", help="görsel arayüzü tarayıcıda aç")
    a.add_argument("--port", type=int, default=None, help="servis portu (vars. BELLEK_BEYIN_PORT veya varsayılan)")
    a.add_argument("--yazdir", action="store_true", help="tarayıcıyı açma, yalnız adresi yazdır")
    a.add_argument(
        "--taban",
        default=None,
        help="üretilen adresin tabanı (ör. http://makine.tailnet.ts.net); verilmezse "
        "http://127.0.0.1:<port>. Sağlık yoklaması yine 127.0.0.1 üzerinden yapılır",
    )

    a = alt.add_parser("ara", help="ara")
    a.add_argument("sorgu")
    a = alt.add_parser("gez", help="düğümde gez (id yoksa kök)")
    a.add_argument("id", nargs="?", default=None)
    a = alt.add_parser("oku", help="düğümü oku")
    a.add_argument("id")
    return p


def _ac(port, yazdir: bool, taban: str | None = None) -> int:
    import os
    import urllib.request
    from . import servis

    if port is None:
        try:
            port = int(os.environ.get("BELLEK_BEYIN_PORT") or servis.VARSAYILAN_PORT)
        except ValueError:
            port = servis.VARSAYILAN_PORT
    try:
        istek = urllib.request.Request(f"http://127.0.0.1:{port}/api/saglik")
        with urllib.request.urlopen(istek, timeout=2) as y:
            ok = y.status == 200 and json.loads(y.read().decode("utf-8")).get("durum") == "ok"
    except Exception:
        ok = False
    if not ok:
        print(
            f"Beyin servisi çalışmıyor (127.0.0.1:{port}). "
            "`python -m bellek.beyin servis` ile başlat, sonra tekrar dene.",
            file=sys.stderr,
        )
        return 1
    belirtec = servis.arayuz_belirtec_hazirla()
    govde = taban.rstrip("/") if taban else f"http://127.0.0.1:{port}"
    url = f"{govde}/#t={belirtec}"
    if yazdir:
        print(url)
        return 0
    import webbrowser
    if not webbrowser.open(url):
        print("Tarayıcı açılamadı; adresi elle açmak için `ac --yazdir` kullan.", file=sys.stderr)
        return 1
    print("Arayüz tarayıcıda açıldı.")
    return 0


def _yedek_komutu(k: str, args) -> int:
    from pathlib import Path
    from . import yedek
    from .db import varsayilan_yol

    try:
        if k == "yedekle":
            dizin = Path(args.dizin) if args.dizin else yedek.varsayilan_yedek_dizini()
            if args.sakla < 1:
                print("Hata: --sakla en az 1 olmalı", file=sys.stderr)
                return 2
            yeni = yedek.yedekle(varsayilan_yol(), dizin, sakla=args.sakla)
            print(f"Yedek alındı: {yeni} ({len(yedek.yedekleri_listele(dizin))} yedek saklanıyor)")
            return 0

        if k == "yedekler":
            dizin = Path(args.dizin) if args.dizin else yedek.varsayilan_yedek_dizini()
            liste = yedek.yedekleri_listele(dizin)
            if not liste:
                print("Yedek yok.")
                return 0
            for yol in liste:
                print(yol)
            return 0

        # geri-yukle
        if not args.evet:
            print("Mevcut veritabanı kenara alınıp yedek geri yüklenecek. Devam edilsin mi? [e/H] ",
                  end="", file=sys.stderr, flush=True)
            try:
                yanit = sys.stdin.readline()
            except (OSError, ValueError):
                yanit = ""
            if yanit.strip().lower() not in ("e", "evet"):
                print("Vazgeçildi.", file=sys.stderr)
                return 1
        eski = yedek.geri_yukle(Path(args.yedek), varsayilan_yol())
        if eski is None:
            print("Geri yüklendi.")
        else:
            print(f"Geri yüklendi. Eski veritabanı kenarda: {eski}")
        return 0
    except yedek.YedekHatasi as e:
        print(f"Hata: {e}", file=sys.stderr)
        return 1


def main(argv=None) -> int:
    for akis in (sys.stdout, sys.stderr):
        try:
            akis.reconfigure(encoding="utf-8")
        except Exception:
            pass
    p = _kur()
    args = p.parse_args(argv)
    k = args.komut

    if k == "ice-al":
        from contextlib import closing
        from .db import baglan
        from . import ice_al
        with closing(baglan()) as con:
            sonuc = ice_al.ice_al(con, args.jsonl, uzerine_yaz=args.uzerine_yaz)
        print(json.dumps(sonuc, ensure_ascii=False, indent=2, default=str))
        korunan = sonuc.get("korunan") if isinstance(sonuc, dict) else None
        if korunan:
            print(f"Korunan (tohum dışı düzeltilmiş) düğüm: {len(korunan)}; ezmek için --uzerine-yaz")
        hatalar = sonuc.get("hatalar") if isinstance(sonuc, dict) else None
        return 1 if hatalar else 0

    if k in ("yedekle", "yedekler", "geri-yukle"):
        return _yedek_komutu(k, args)

    if k == "disa-aktar":
        from contextlib import closing
        from .db import baglan
        from . import disa_aktar
        with closing(baglan(salt_okunur=True)) as con:
            if args.bicim == "md":
                metin = disa_aktar.markdown_agac(con, ozel_dahil=not args.ozelsiz)
                if args.cikti:
                    with open(args.cikti, "w", encoding="utf-8", newline="\n") as f:
                        f.write(metin)
                else:
                    sys.stdout.write(metin)
                return 0
            if not args.cikti:
                p.error("jsonl biçimi için --cikti zorunlu")
            n = disa_aktar.jsonl_dok(con, args.cikti)
            print(f"{n} satır yazıldı: {args.cikti}")
            return 0

    if k == "servis":
        from . import servis
        if args.port is None:
            servis.calistir()
        else:
            servis.calistir(port=args.port)
        return 0

    if k == "mcp":
        from . import mcp_kopru
        mcp_kopru.main()
        return 0

    if k == "ac":
        if args.taban is not None:
            t = args.taban.strip()
            if not t.lower().startswith(("http://", "https://")):
                p.error("--taban http:// ya da https:// ile başlamalı")
            if "#" in t or "?" in t:
                p.error("--taban içinde '#' ya da '?' bulunamaz")
            if not t.split("://", 1)[1].strip("/"):
                p.error("--taban bir sunucu adresi içermeli")
            args.taban = t
        return _ac(args.port, args.yazdir, args.taban)

    # ara / gez / oku
    from contextlib import closing
    from .db import baglan
    from . import sorgu
    with closing(baglan(salt_okunur=True)) as con:
        if k == "ara":
            r = sorgu.ara(con, args.sorgu)
        elif k == "gez":
            r = sorgu.gez(con, args.id) if args.id is not None else sorgu.gez(con)
        else:
            r = sorgu.oku(con, args.id)
    print(r["metin"] if isinstance(r, dict) else r)
    return 0


if __name__ == "__main__":
    sys.exit(main())
