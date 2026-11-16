"""eren-kit: Claude Code kullanıcı kapsamlı MCP kaydını okur (salt okunur).

    python -I mcp_config.py --name <ad> [--config <.claude.json yolu>]

Kullanıcı kapsamlı MCP sunucuları Claude Code'un ~/.claude.json dosyasında (ya da
CLAUDE_CONFIG_DIR ayarlıysa $CLAUDE_CONFIG_DIR/.claude.json) "mcpServers" altında durur.
"claude mcp get" sunucuyu başlatıp sağlık denetimi yaptığı için onun yerine dosya okunur.
Çıktı: stdout'a tek satır ASCII JSON:
    {"found": bool, "path": ..., "entry": {...}|null, "safe": {...}|null, "ps_problems": [...]}

"entry", PowerShell'in ConvertFrom-Json'ının okuyabileceği kopyadır; okuyamadığı anahtarlar (boş,
yalnız harf büyüklüğüyle ayrılan) "ps_problems"te yazılır ve install.ps1 o kayda dokunmaz.

"safe", kaydın değerlerini PowerShell nesnesine dönüştürmeden (ConvertFrom-Json PowerShell 7'de
tarih biçimli dizeleri DateTime'a çevirir) yeniden yazabilmek içindir: "entry" kaydın tamamı,
"args" her argüman (None'lar atlanır), "env" env nesnesi safe_json biçiminde; "pretty" yedek
dosyası için okunur JSON. install.ps1 bunları "claude mcp add-json" komutuna olduğu gibi koyar.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import string
import sys

# safe_json'da dizelerin içinde çıplak kalan karakterler; gerisi \uXXXX olur. Böylece JSON'da
# cmd.exe'nin yorumladığı hiçbir karakter (% ^ & | < > ! ( ) satır sonu) ve dize içinde " ya da \
# kalmaz: komut satırına (claude.cmd sarmalayıcısı dahil) birebir ve komut olarak yorumlanmadan
# geçer. ErenKit.Installer.psm1'deki $script:JsonSafeChars ile aynı küme.
_SAFE = frozenset(string.ascii_letters + string.digits + " ._,:/=+@#~-")


def safe_json(v) -> str:
    """Değeri JSON'a çevirir; dizelerde güvenli küme dışındaki her UTF-16 birimi \\uXXXX olur."""
    if isinstance(v, str):
        out = ['"']
        for ch in v:
            if ch in _SAFE:
                out.append(ch)
            else:
                b = ch.encode("utf-16-be", "surrogatepass")
                out.extend("\\u%02x%02x" % (b[i], b[i + 1]) for i in range(0, len(b), 2))
        out.append('"')
        return "".join(out)
    if v is None or isinstance(v, (bool, int, float)):
        return json.dumps(v)
    if isinstance(v, dict):
        return "{" + ",".join(safe_json(str(k)) + ":" + safe_json(x) for k, x in v.items()) + "}"
    if isinstance(v, (list, tuple)):
        return "[" + ",".join(safe_json(x) for x in v) + "]"
    return safe_json(str(v))


def safe_parts(entry: dict) -> dict:
    args = entry.get("args")
    env = entry.get("env")
    return {
        "entry": safe_json(entry),
        "args": [safe_json(a) for a in args if a is not None] if isinstance(args, list) else [],
        "env": safe_json(env) if isinstance(env, dict) else None,
        "pretty": json.dumps(entry, indent=2, ensure_ascii=False),
    }


# ---------------------------------------------------------------- kaydı göstermek ve denetlemek
#
# Kurulum (install_macos.py, ErenKit.Installer.psm1'deki eşleri) ve doktor aynı kuralı uygular; iki
# platform her girdide aynı metni üretir (test_kayit_gizliligi karşılaştırır). Kullanıcının kaydı sır
# taşıyabilir (uzak sunucu adresinde belirteç, Authorization başlığı, "--token=..." argümanı, env
# değeri, hatta "command" içine gömülü bir parola). Ekrana yazılan metin terminal kaydına, ekran
# paylaşımına ve yapıştırılan hata raporuna gider; bu yüzden kayıttan yalnız şunlar gösterilir:
# - program yolu, yalnız describe_program'ın dar izin listesine uyuyorsa (aşağıda),
# - kurulumun kendi yazdığı (depoda herkese açık) önek argümanlar; kalanlar yalnız sayıyla,
# - uzak sunucu için tür ve şema://sunucu[:port], yalnız describe_url'nin dar izin listesine uyuyorsa,
# - env/headers yalnız adlarıyla (değerleri hiçbir yerde); adlar terminal_safe'ten geçer.
# Kayıttan gelen her parça terminale kontrol karakteri, ANSI kaçışı ya da satır sonu olarak geçmez.

UNRESOLVED_URL = "(adres çözümlenemedi; gösterilmez)"
HIDDEN_PROGRAM = "(program yolu olağandışı; gösterilmez)"

# Terminalde görünmeden etki eden karakterler: C0 (satır sonu dahil), DEL, C1 (0x9b = CSI), yön/
# görünmez biçim karakterleri ve eşi olmayan UTF-16 vekilleri. ErenKit.Installer.psm1 ile aynı küme.
_INVISIBLE = frozenset([0x061C, 0x2028, 0x2029, 0xFEFF, *range(0x200B, 0x2010), *range(0x202A, 0x202F),
                        *range(0x2060, 0x2065), *range(0x2066, 0x2070), *range(0xFFF9, 0xFFFC)])


def _needs_escape(code: int) -> bool:
    return code < 0x20 or 0x7F <= code <= 0x9F or 0xD800 <= code <= 0xDFFF or code in _INVISIBLE


def terminal_safe(text, keep_newline: bool = False) -> str:
    """Metni terminale güvenle yazılabilir yapar: kontrol/görünmez karakterler görünür kaçışa
    (\\xNN, \\uNNNN) çevrilir; böylece ANSI kaçışı, satır başı ya da sahte satır üretemez.
    keep_newline: iletinin kendi satır yapısı (çok satırlı hata çıktısı) korunur; \\r\\n -> \\n."""
    s = text if isinstance(text, str) else str(text)
    if keep_newline:
        s = s.replace("\r\n", "\n")
    out = []
    for ch in s:
        code = ord(ch)
        if keep_newline and ch == "\n":
            out.append(ch)
        elif _needs_escape(code):
            out.append("\\x%02x" % code if code <= 0xFF else "\\u%04x" % code)
        else:
            out.append(ch)
    return "".join(out)


# Gösterilecek port yalnız şemanın varsayılanı değilse yazılır.
_DEFAULT_PORTS = {"http": 80, "https": 443, "ws": 80, "wss": 443}
_URL_RE = re.compile(r"([A-Za-z][A-Za-z0-9+.\-]*)://([^/?#]*)(.*)\Z", re.S)
_USERINFO_RE = re.compile(r"[A-Za-z0-9\-._~!$&'()*+,;=:%]*\Z")
_HOSTPORT_RE = re.compile(r"(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.\-]+)(?::([0-9]{1,5}))?\Z")
_LABEL_RE = re.compile(r"[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\Z")


def describe_url(url) -> str:
    """Uzak sunucu adresinin sır taşımayan kısmı: şema://sunucu[:port], gizlenen bir şey varsa '/…'.

    Dar izin listesi (ayrıştırıcılar arasında yoruma açık ya da olağandışı her adres sabit
    UNRESOLVED_URL olur; böylece kullanıcı bilgisi "sunucu adı" sanılıp yazılmaz):
    - adres yalnız basılabilir ASCII'dir (0x21-0x7e): boşluk, kontrol karakteri, ASCII dışı, ters
      bölü (bazı ayrıştırıcılar '/' sayar) yok;
    - şema http, https, ws ya da wss; ardından '//';
    - sunucu kısmı ('//' ile ilk '/', '?' ya da '#' arası) en çok bir '@' içerir; '@' önündeki
      kullanıcı bilgisi RFC 3986 karakterleriyle sınırlıdır ve gizlenir; geri kalanda '@' yok
      (ör. https://kul:12#gizli@sunucu/ -> çözümlenemedi, 'kul' sunucu adı diye yazılmaz);
    - sunucu adı harf/rakam/'-' etiketleri ('.' ile, her biri 1-63, '-' ile başlamaz/bitmez) ya da
      köşeli parantezli IPv6 (onaltılık, ':' ve '.'); küçük harfe çevrilir;
    - port 0-65535; şemanın varsayılanıysa yazılmaz."""
    if not isinstance(url, str) or not url:
        return "(adres yok)"
    if any(not ("\x21" <= ch <= "\x7e") for ch in url) or "\\" in url:
        return UNRESOLVED_URL
    m = _URL_RE.match(url)
    if not m:
        return UNRESOLVED_URL
    scheme, auth, rest = m.group(1).lower(), m.group(2), m.group(3)
    if scheme not in _DEFAULT_PORTS or "@" in rest:
        return UNRESOLVED_URL
    userinfo, hostport = None, auth
    if "@" in auth:
        userinfo, _, hostport = auth.partition("@")
        if "@" in hostport or not _USERINFO_RE.match(userinfo):
            return UNRESOLVED_URL
    hm = _HOSTPORT_RE.match(hostport)
    if not hm:
        return UNRESOLVED_URL
    host = hm.group(1).lower()
    if host.startswith("["):
        if ":" not in host:
            return UNRESOLVED_URL
    elif not all(_LABEL_RE.match(lab) for lab in host.split(".")):
        return UNRESOLVED_URL
    text = f"{scheme}://{host}"
    if hm.group(2) is not None:
        port = int(hm.group(2))
        if port > 65535:
            return UNRESOLVED_URL
        if port != _DEFAULT_PORTS[scheme]:
            text += f":{port}"
    return text + ("/…" if userinfo is not None or rest not in ("", "/") else "")


# describe_program: program yolunda izin verilen karakterler. Harf/rakam, boşluk, . _ - + ~ / \ ( ) @
# ve Latin harfleri (U+00C0-U+024F; × ve ÷ hariç: Türkçe/Avrupa dillerindeki kullanıcı adları).
# ':' yalnız sürücü harfinden sonra (C:). '=', '%', '$', '?', '#', '&', ';', tırnaklar ve benzeri yok.
_PROGRAM_ASCII = frozenset(string.ascii_letters + string.digits + " ._-+~/\\()@")
_PROGRAM_SUFFIXES = (".exe", ".cmd", ".bat", ".com", ".ps1", ".py", ".pyw", ".js", ".mjs", ".cjs", ".sh")


def _program_char_ok(ch: str) -> bool:
    return ch in _PROGRAM_ASCII or (0xC0 <= ord(ch) <= 0x24F and ch not in "\u00d7\u00f7")


def program_shown(cmd) -> bool:
    """Program yolu ekrana yazılabilir mi? (bkz. describe_program)"""
    if not isinstance(cmd, str) or not cmd:
        return False
    for i, ch in enumerate(cmd):
        if ch == ":":
            if i != 1 or cmd[0] not in string.ascii_letters:
                return False
        elif not _program_char_ok(ch):
            return False
    if " " not in cmd:
        return True
    # Boşluklu: yalnız mutlak bir yol ("C:\Program Files\..."), boşluklar dosya/klasör adının içinde.
    # "araç gizli-belirteç" gibi komut + argüman biçimi gösterilmez.
    if cmd != cmd.strip(" ") or "  " in cmd:
        return False
    if not (re.match(r"[A-Za-z]:[\\/]", cmd) or cmd.startswith(("/", "\\\\", "~/", "~\\"))):
        return False
    words = cmd.split(" ")
    if any(w.startswith("-") for w in words[1:]):
        return False
    last = words[-1]
    return "/" in last or "\\" in last or last.lower().endswith(_PROGRAM_SUFFIXES)


def describe_program(cmd) -> str:
    """Program yolunun ekrandaki biçimi. Yol kaydın kimliğidir ve gösterilir; ama "command" alanına
    gömülmüş bir sır ("curl https://kul:parola@...", "araç --token=...") yazılmasın diye yalnız dar
    bir izin listesine uyan yol gösterilir, gerisi sabit HIDDEN_PROGRAM olur. Kural (program_shown):
    yalnız izinli karakterler; ':' yalnız sürücü harfinden sonra; boşluk varsa yol mutlaktır, boşluk
    tek ve uçlarda değildir, boşlukla ayrılan hiçbir parça '-' ile başlamaz ve son parça bir yol
    ayırıcı içerir ya da bilinen bir program/betik uzantısıyla biter (C:\\Program Files (x86)\\x\\y.exe
    gösterilir, "C:\\araç\\x.exe GİZLİ" gösterilmez). Boşluk içeren yol tırnak içinde yazılır."""
    if not program_shown(cmd):
        return HIDDEN_PROGRAM
    return f'"{cmd}"' if " " in cmd else cmd


REMOTE_TYPES = ("sse", "http", "ws")


def _entry_type(entry: dict):
    """Kaydın türü: alan yoksa "stdio" (Claude Code'un varsayılanı); geçersizse None."""
    if "type" not in entry:
        return "stdio"
    t = entry["type"]
    return t if isinstance(t, str) and t in ("stdio", *REMOTE_TYPES) else None


def describe_entry(entry, shown_args: int = 0) -> str:
    """Kaydın ekranda gösterilecek biçimi (bkz. yukarıdaki kural). shown_args: baştan kaç argüman
    yazılır (yalnız kurulumun bildiği önek); kalanlar sayılır. Kayıttan yalnız dize değerler ve
    yalnız izin listesine uyanlar yazılır; dize olmayan değerin yalnız türü söylenir."""
    if not isinstance(entry, dict):
        return "(kayıt bir JSON nesnesi değil)"
    t = _entry_type(entry)
    if t is None:
        return f"(türü tanınmayan kayıt: {_kind(entry['type'])})"
    if t in REMOTE_TYPES:
        return f"{t} {describe_url(entry.get('url'))}"
    cmd = entry.get("command")
    if "command" in entry and not isinstance(cmd, str):
        return f"(komutu dize olmayan kayıt: {_kind(cmd)}; değeri yazılmaz)"
    if not cmd:
        names = ", ".join(terminal_safe(k) for k in entry) or "-"
        return f"(komutu ya da adresi olmayan kayıt; alanlar: {names})"
    args = entry.get("args")
    args = [a for a in args if a is not None] if isinstance(args, list) else []
    k = 0  # yalnız baştaki dize argümanlar yazılabilir (bilinen önek hep dizedir)
    while k < shown_args and k < len(args) and isinstance(args[k], str):
        k += 1
    shown_args = k
    parts = [describe_program(cmd)] + [terminal_safe(a) for a in args[:shown_args]]
    text = " ".join(f'"{p}"' if i and " " in p else p for i, p in enumerate(parts))
    hidden = len(args) - shown_args
    return text + (f" (+{hidden} argüman daha; değerleri yazılmaz)" if hidden else "")


def known_prefix(entry, variants) -> int:
    """Kaydın argümanları bu öneklerden biriyle başlıyorsa en uzun eşleşenin uzunluğu, yoksa 0."""
    args = entry.get("args") if isinstance(entry, dict) else None
    if not isinstance(args, list):
        return 0
    best = 0
    for v in variants:
        v = list(v)
        if len(v) > best and args[: len(v)] == v:
            best = len(v)
    return best


def _kind(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true/false"
    if isinstance(v, (int, float)):
        return "sayı"
    if isinstance(v, dict):
        return "nesne"
    if isinstance(v, list):
        return "dizi"
    if isinstance(v, str):
        return "dize"
    return type(v).__name__


_MAX_SAFE_INT = 2 ** 53 - 1  # JavaScript Number.MAX_SAFE_INTEGER


def _positive_int(v) -> bool:
    if isinstance(v, bool):
        return False
    if isinstance(v, int):
        return 0 < v <= _MAX_SAFE_INT
    return isinstance(v, float) and v.is_integer() and 0 < v <= _MAX_SAFE_INT


def _check_str_map(entry: dict, key: str, out: list[str]) -> None:
    if key in entry:
        d = entry[key]
        if not isinstance(d, dict):
            out.append(f"{key}: {_kind(d)} (nesne olmalı)")
        else:
            out.extend(f"{key}.{terminal_safe(k)}: {_kind(x)}" for k, x in d.items() if not isinstance(x, str))


def entry_problems(entry) -> list[str]:
    """Claude Code'un kabul etmediği değerlerin yeri ve türü (değer yazılmaz).

    Claude Code geçersiz bir kaydı yok sayar ("Skipped — invalid MCP server config") ve "claude mcp
    add-json" aynı kaydı reddeder: böyle bir kayıt silinirse geri yüklenemez. Kurulum bu durumda
    kayda dokunmaz, doktor hata verir. Sınır tahmin değil, gerçek claude 2.1.325 ile ölçüldü
    (tests/claude_mcp_sinir.json; testler her vakayı buna karşı sınar):
    - type yoksa "stdio"; yalnız "stdio", "sse", "http", "ws" kabul (null, büyük harf, "sse-ide"... ret).
    - stdio: command boş olmayan dize (zorunlu); args dize dizisi; env değerleri dize olan nesne.
    - sse/http/ws: url dize (zorunlu; biçimi denetlenmez); headers değerleri dize olan nesne;
      headersHelper dize. sse/http'de ayrıca oauth nesne (clientId varsa dize) ve tools nesne dizisi
      (her öğede name dize).
    - hepsinde timeout pozitif tam sayı (en çok 2^53-1).
    Kaydın türüne ait olmayan alanlar (stdio'da url/headers, uzakta command/args/env, bilinmeyen
    alanlar) Claude Code'ca yok sayılır, burada da denetlenmez."""
    if not isinstance(entry, dict):
        return []
    out: list[str] = []
    t = _entry_type(entry)
    if t is None:
        v = entry["type"]
        return ["type: bilinmeyen tür" if isinstance(v, str) else f"type: {_kind(v)}"]
    if t == "stdio":
        if "command" not in entry:
            out.append("command: yok (zorunlu)")
        elif not isinstance(entry["command"], str):
            out.append(f"command: {_kind(entry['command'])}")
        elif not entry["command"]:
            out.append("command: boş dize")
        if "args" in entry:
            a = entry["args"]
            if not isinstance(a, list):
                out.append(f"args: {_kind(a)} (dizi olmalı)")
            else:
                out.extend(f"args[{i}]: {_kind(x)}" for i, x in enumerate(a) if not isinstance(x, str))
        _check_str_map(entry, "env", out)
    else:
        if "url" not in entry:
            out.append("url: yok (zorunlu)")
        elif not isinstance(entry["url"], str):
            out.append(f"url: {_kind(entry['url'])}")
        _check_str_map(entry, "headers", out)
        if "headersHelper" in entry and not isinstance(entry["headersHelper"], str):
            out.append(f"headersHelper: {_kind(entry['headersHelper'])}")
        if t != "ws":
            if "oauth" in entry:
                o = entry["oauth"]
                if not isinstance(o, dict):
                    out.append(f"oauth: {_kind(o)} (nesne olmalı)")
                elif "clientId" in o and not isinstance(o["clientId"], str):
                    out.append(f"oauth.clientId: {_kind(o['clientId'])}")
            if "tools" in entry:
                tl = entry["tools"]
                if not isinstance(tl, list):
                    out.append(f"tools: {_kind(tl)} (dizi olmalı)")
                else:
                    for i, x in enumerate(tl):
                        if not isinstance(x, dict):
                            out.append(f"tools[{i}]: {_kind(x)} (nesne olmalı)")
                        elif not isinstance(x.get("name"), str):
                            out.append(f"tools[{i}].name: {_kind(x['name']) if 'name' in x else 'yok (zorunlu)'}")
    if "timeout" in entry:
        v = entry["timeout"]
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            out.append(f"timeout: {_kind(v)}")
        elif not _positive_int(v):
            out.append("timeout: sayı (pozitif tam sayı olmalı)")
    return out


def problem_text(name: str, problems: list[str]) -> str:
    """entry_problems için kullanıcı iletisi (ErenKit.Installer.psm1 Format-McpProblem ile aynı)."""
    return (f'"{name}" kaydında Claude Code\'un kabul etmediği değer var ({", ".join(problems)}); '
            "Claude Code bu kaydı şu an yok sayıyor. .claude.json'da değeri düzeltin (ör. sayıysa tırnak "
            'içine alın: 8080 -> "8080") ya da kaydı silin, sonra yeniden çalıştırın')


def unregister_problem_text(name: str, problems: list[str]) -> str:
    """Kaldırmada geçersiz kayıt: dokunulmaz (ErenKit.Installer.psm1 ile aynı ileti)."""
    return (f'MCP kaydı "{name}" kaldırılmadı, hiçbir şey değiştirilmedi: {problem_text(name, problems)}. '
            f"Kaydı yine de silmek için: claude mcp remove {name} -s user")


def _fold(k: str) -> str:
    # .NET OrdinalIgnoreCase'e yakın: karakter karakter büyük harf (tek karaktere eşlenenler).
    return "".join(c.upper() if len(c.upper()) == 1 else c for c in k)


def ps_key_problems(entry):
    """PowerShell'in ConvertFrom-Json'ının okuyamadığı nesne anahtarları: boş anahtar ve yalnız harf
    büyüklüğüyle ayrılan anahtarlar (ör. env'de Path ile PATH; Windows'ta ortam değişkeni adları
    zaten büyük/küçük harf ayırmaz). (sorunlar, PowerShell'in okuyabileceği kopya) döner; kopyada boş
    anahtarlar düşer, aynı anahtarın yalnız ilk yazılışı kalır. install.ps1 sorun varsa kayda dokunmaz."""
    problems: list[str] = []

    def walk(v, where: str):
        if isinstance(v, dict):
            label = where or "kayıt"
            seen: dict[str, list[str]] = {}
            out = {}
            if "" in v:
                problems.append(f"{terminal_safe(label)}: boş anahtar")
            for k, x in v.items():
                if k == "":
                    continue
                seen.setdefault(_fold(k), []).append(k)
                if len(seen[_fold(k)]) == 1:
                    out[k] = walk(x, f"{where}.{k}" if where else k)
            for names in seen.values():
                if len(names) > 1:
                    problems.append(f"{terminal_safe(label)}: yalnız harf büyüklüğüyle ayrılan anahtarlar "
                                    f"({', '.join(terminal_safe(n) for n in names)})")
            return out
        if isinstance(v, list):
            return [walk(x, f"{where}[{i}]") for i, x in enumerate(v)]
        return v

    reduced = walk(entry, "")
    return problems, reduced


def default_config() -> str:
    d = os.environ.get("CLAUDE_CONFIG_DIR")
    if d:
        return os.path.join(d, ".claude.json")
    return os.path.join(os.path.expanduser("~"), ".claude.json")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="eren-kit MCP kaydı okuyucu")
    p.add_argument("--name", required=True)
    p.add_argument("--config")
    args = p.parse_args(argv)
    path = args.config or default_config()
    try:
        if not os.path.exists(path):
            print(json.dumps({"found": False, "path": path, "entry": None, "safe": None}))
            return 0
        with open(path, encoding="utf-8-sig") as f:
            data = json.load(f)
        servers = data.get("mcpServers") if isinstance(data, dict) else None
        entry = servers.get(args.name) if isinstance(servers, dict) else None
        if not isinstance(entry, dict):
            entry = None
        # "entry" PowerShell'in okuyabileceği kopyadır; "safe" (dize) her zaman dosyadaki kaydın tamamı.
        ps_problems, ps_entry = ps_key_problems(entry) if entry is not None else ([], None)
        print(json.dumps({"found": entry is not None, "path": path, "entry": ps_entry,
                          "safe": safe_parts(entry) if entry is not None else None,
                          "ps_problems": ps_problems}))
        return 0
    except Exception as e:  # noqa: BLE001 - tek satır hata özeti istenir
        print(json.dumps({"error": f"{type(e).__name__}: {e}", "path": path}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
