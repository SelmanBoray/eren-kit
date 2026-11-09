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
        from .db import baglan
        from . import ice_al
        sonuc = ice_al.ice_al(baglan(), args.jsonl)
        print(json.dumps(sonuc, ensure_ascii=False, indent=2, default=str))
        hatalar = sonuc.get("hatalar") if isinstance(sonuc, dict) else None
        return 1 if hatalar else 0

    if k == "disa-aktar":
        from .db import baglan
        from . import disa_aktar
        con = baglan(salt_okunur=True)
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
    from .db import baglan
    from . import sorgu
    con = baglan(salt_okunur=True)
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
