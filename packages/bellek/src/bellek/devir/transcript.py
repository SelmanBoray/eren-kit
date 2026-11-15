"""Claude Code oturum kaydından (JSONL) hızlı özet çıkarma.

Hook'lar her turda çalıştığı için bu modül yalnız standart kütüphane kullanır
ve dosyanın tamamını belleğe almaz: başından sınırlı bir parça ileriye,
sonundan sınırlı bir parça geriye doğru okunur. Hiçbir genel fonksiyon istisna
fırlatmaz; dosya yoksa ya da okunamıyorsa boş sonuç döner.

Gerçek kayıtlardan doğrulanan şema (Claude Code 2.1.29x-2.1.31x):

* Her satır bir JSON nesnesi, ``type`` alanı satır türünü verir.
* ``user`` / ``assistant`` satırlarında ``sessionId``, ``cwd``, ``timestamp``
  (ISO, ``...Z``), ``isSidechain``; içerik ``message`` altında.
* ``assistant``: her içerik bloğu (thinking/text/tool_use) ayrı satırdır,
  aynı yanıtın satırları aynı ``message.id`` ve ``requestId``'yi taşır,
  ``message.usage`` tekrarlanır; ``apiBlockIndex`` 0'dan başlar. Hata/yapay
  mesajlarda ``message.model == "<synthetic>"``.
* Araç çağrısı: ``message.content[i]`` = ``{"type": "tool_use", "name",
  "input"}``; Edit/Write/MultiEdit için ``input.file_path``, NotebookEdit için
  ``input.notebook_path``.
* ``user`` satırı türleri: araç sonucu (``content`` listesi, ``tool_result``
  blokları, satırda ``toolUseResult`` alanı); gerçek istem (yeni sürümlerde
  ``origin.kind == "human"``, ``promptSource`` typed/suggestion_accepted/
  queued; SDK istemlerinde ``origin`` yok, ``promptSource == "sdk"``);
  arka plan bildirimi (``origin.kind == "task-notification"``, metin
  ``<task-notification>`` ile başlar); ``isMeta`` (skill metni,
  ``<system-reminder>``, ``<local-command-caveat>``); slash komutu
  (``<command-name>``/``<command-message>``/``<command-args>``) ve çıktısı
  (``<local-command-stdout>``, ``<bash-input>``, ``<bash-stdout>``);
  sıkıştırma özeti (``isCompactSummary``, ``isVisibleInTranscriptOnly``);
  ``[Request interrupted by user...]`` metin bloğu.
* Başlık satırları: ``{"type": "custom-title", "customTitle"}``,
  ``{"type": "ai-title", "aiTitle"}``; eski biçim ``{"type": "summary",
  "summary"}`` (güncel kayıtlarda görülmedi). Bu satırlar oturum boyunca
  yeniden eklenir, sonuncusu genelde dosyanın son birkaç on KB'ındadır.
* Hook çıktıları ``user`` değil ``attachment`` satırlarıdır (``attachment.type``
  hook_success, hook_additional_context ...); ayrıca ``system`` satırları
  (``subtype``) vardır. İkisi de özete girmez.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Iterator

__all__ = ["oturum_ozeti", "son_istek_bilgisi", "maskele"]

# Okuma sınırları (bayt).
_BAS_BUTCE = 2 * 1024 * 1024          # ilk istem için baştan okunan en çok
_SON_BUTCE = 12 * 1024 * 1024         # özet için sondan geriye okunan en çok
_SON_ISTEK_BUTCE = 8 * 1024 * 1024    # son_istek_bilgisi için geriye en çok
_BLOK = 256 * 1024
_SAYIM_BLOK = 8 * 1024 * 1024
_SAYIM_SURE = 0.12  # s; istek sayımında aşılırsa oranlayarak tahmin

_DUZENLEME_ARACLARI = {"Edit": "file_path", "Write": "file_path",
                       "MultiEdit": "file_path", "NotebookEdit": "notebook_path"}
_EN_COK_DUZENLENEN = 15
_ISTEM_UZUNLUK = 200
_BASLIK_UZUNLUK = 80


class _Isaretler:
    """Satır türü için hızlı bayt ön-süzgeçleri (JSON çözmeden önce).

    Claude Code sıkışık JSON yazar (``"type":"user"``); ``json.dumps``
    varsayılanıyla (``"type": "user"``) üretilmiş kayıtlar da desteklenir.
    Biçim dosya başına bir kez seçilir (bkz. ``_isaret_sec``), böylece sıcak
    döngüde satır başına tek ``in`` taraması yapılır.
    """

    __slots__ = ("asistan", "kullanici", "basliklar", "duzenleme", "sikistirma",
                 "blok0")

    def __init__(self, ayrac: str) -> None:
        def isaret(anahtar: str, deger: str) -> bytes:
            return f'"{anahtar}"{ayrac}"{deger}"'.encode()
        self.asistan = isaret("type", "assistant")
        # Değeri 0 olan apiBlockIndex; ardından "," ya da "}" gelebilir (JSON
        # tamsayısı 0'dan sonra rakam alamaz), bu yüzden sonu açık bırakılır.
        self.blok0 = f'"apiBlockIndex"{ayrac}0'.encode()
        self.kullanici = isaret("type", "user")
        # sıkıştırma sınırı: system/compact_boundary ya da özet user satırı
        self.sikistirma = (isaret("subtype", "compact_boundary"),
                           f'"isCompactSummary"{ayrac}true'.encode())
        self.basliklar = tuple(isaret("type", t)
                               for t in ("custom-title", "ai-title", "summary"))
        adlar = "|".join(re.escape(a) for a in _DUZENLEME_ARACLARI)
        self.duzenleme = re.compile(
            re.escape(f'"name"{ayrac}"').encode() + b"(?:" + adlar.encode() + b')"')


_SIKISIK = _Isaretler(":")
_BOSLUKLU = _Isaretler(": ")
_ISARET_ARAC_SONUCU = b'"toolUseResult"'
# İstek sayımı: sıcak yolda dosya biçimine göre ``_Isaretler.blok0`` düz bayt
# sayımıyla, biçim tutmayan parçada (alan var ama işaret yok) regex ile.
# ``_ISARET_BLOK0`` eski adıyla korunur (sıkışık, alan ortada biçimi).
_ISARET_BLOK0 = b'"apiBlockIndex":0,'
_ANAHTAR_BLOK = b'"apiBlockIndex"'
_BLOK0_DESEN = re.compile(rb'"apiBlockIndex"[ \t]*:[ \t]*0(?![0-9.eE])')


def _isaret_sec(f) -> _Isaretler:
    """Dosyanın ilk 64 KB'ına bakıp JSON biçimini seçer.

    Sıkışık bir kayıtta ``"type": "`` kaçışsız olarak geçemez (metin içindeki
    tırnaklar ``\\"`` olarak yazılır), bu yüzden yanlış pozitif vermez.
    """
    try:
        f.seek(0)
        bas = f.read(64 * 1024)
    except Exception:
        return _SIKISIK
    return _BOSLUKLU if b'"type": "' in bas else _SIKISIK


_DUZENLEME_SURE = 0.10  # s; 12 MB ötesinde düzenleme aramanın süre sınırı

# --------------------------------------------------------------------- maske

_GIZLI = "[gizli]"


def _tc_gecerli(n: str) -> bool:
    """T.C. kimlik no algoritması (11 hane, ilk hane 0 değil, 10. ve 11.
    haneler sağlama)."""
    if len(n) != 11 or not n.isdigit() or n[0] == "0":
        return False
    d = [int(c) for c in n]
    if ((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10 != d[9]:
        return False
    return sum(d[:10]) % 10 == d[10]


def _luhn_gecerli(n: str) -> bool:
    toplam = 0
    for i, c in enumerate(reversed(n)):
        r = int(c)
        if i % 2:
            r *= 2
            if r > 9:
                r -= 9
        toplam += r
    return toplam % 10 == 0


def _iban_gecerli(n: str) -> bool:
    """ISO 13616 mod-97 sağlaması (n boşluksuz, büyük harf)."""
    if not (15 <= len(n) <= 34):
        return False
    duzen = n[4:] + n[:4]
    try:
        return int("".join(str(int(c, 36)) for c in duzen)) % 97 == 1
    except ValueError:
        return False


def _iban_degistir(m: re.Match) -> str:
    n = re.sub(r"[ \-]", "", m.group(0)).upper()
    # TR + 24 rakam biçimi kendi başına yeterince belirgin; diğer ülke
    # kodlarında yanlış alarmı önlemek için mod-97 sağlaması aranır.
    if (n.startswith("TR") and len(n) == 26 and n[2:].isdigit()) or _iban_gecerli(n):
        return _GIZLI
    return m.group(0)


def _iban_kucuk_degistir(m: re.Match) -> str:
    """Küçük harfle yazılmış IBAN ("tr33 0006 ..."): küçük harfli hex/sözcük dizilerinde
    yanlış alarmı önlemek için mod-97 sağlaması ve hesap kısmında en az 10 rakam aranır."""
    n = re.sub(r"[ \-]", "", m.group(0)).upper()
    if sum(c.isdigit() for c in n[4:]) >= 10 and _iban_gecerli(n):
        return _GIZLI
    return m.group(0)


def _kart_degistir(m: re.Match) -> str:
    """13-19 hane, Luhn ve kart ağı ön eki (2-6: Mastercard/Amex/Visa/...,
    9792: Troy); 1 ile başlayan milisaniye zaman damgaları böylece elenir.

    Eşleşme ayraçla bitişen başka bir sayıyı da yutmuş olabilir ("4111 ...
    1111 20"); bu durumda yalnız ayraç sınırında biten önekler denenir,
    kalan kısım korunur. Bitişik rakam dizisi bölünmez.

    Eşleşme ayraçlı rakam dizisinin tamamıdır; kart önünde ayraçla bitişen bir
    sayı da olabilir ("1.4111 1111 ...", "7 4111 1111 ..."). Bu yüzden her grup
    başından başlayan pencereler denenir (en uzun önce); dizideki her kart
    gizlenir. Nokta sonrası bitişik kart adayı ondalık kesirdir ("0.4111..."),
    gizlenmez.
    """
    metin = m.group(0)
    gruplar = [(g.start(), g.end()) for g in _RAKAM_GRUBU.finditer(metin)]
    parcalar: list[str] = []
    kesim = 0
    g = 0
    while g < len(gruplar):
        h = _kart_penceresi(metin, gruplar, g)
        if h is None:
            g += 1
            continue
        parcalar += [metin[kesim:gruplar[g][0]], _GIZLI]
        kesim = gruplar[h][1]
        g = h + 1
    if not parcalar:
        return metin
    parcalar.append(metin[kesim:])
    return "".join(parcalar)


_RAKAM_GRUBU = re.compile(r"\d+")


def _kart_boylari(boylar: list[int]) -> bool:
    """Grup boyları kart biçimine uyuyor mu (_kart_bicimi'nin ucuz ön süzgeci)."""
    if len(boylar) == 1:
        return True
    if boylar in ([4, 6, 5], [4, 6, 4]):
        return True
    return all(b == 4 for b in boylar[:-1]) and 1 <= boylar[-1] <= 4


def _kart_penceresi(metin: str, gruplar: list[tuple[int, int]], g: int) -> int | None:
    """g. gruptan başlayan geçerli kartın son grubunun sırası (yoksa None)."""
    bas = gruplar[g][0]
    if not (metin[bas] in "23456" or metin.startswith("9792", bas)):
        return None
    boylar: list[int] = []
    toplam = 0
    adaylar: list[int] = []
    for h in range(g, len(gruplar)):
        b = gruplar[h][1] - gruplar[h][0]
        toplam += b
        if toplam > 19:
            break
        boylar.append(b)
        if toplam >= 13 and _kart_boylari(boylar):
            adaylar.append(h)
        if boylar[0] != 4 and h > g:
            break  # çok gruplu biçimlerin hepsi 4'lü grupla başlar
    nokta = bas > 0 and metin[bas - 1] == "."
    for h in reversed(adaylar):
        if nokta and h == g:
            continue  # "0.4111..." ondalık kesir
        aday = metin[bas:gruplar[h][1]]
        # Luhn önce: ucuz ve adayların ~%90'ını eler (_kart_bicimi düzenli ifade çalıştırır).
        if _luhn_gecerli("".join(metin[a:b] for a, b in gruplar[g:h + 1])) and _kart_bicimi(aday):
            return h
    return None


_ISO_TARIH = re.compile(r"(?:19|20)\d\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])")
_YIL = re.compile(r"(?:19|20)\d\d")


def _kart_bicimi(metin: str) -> bool:
    """Ayraçlı dizinin gerçek kart biçiminde olup olmadığı.

    Kabul: bitişik 13-19 hane; 4'lü gruplar (son grup 1-4 hane: 4-4-4-4,
    4-4-4-4-3, 4-4-4-1); Amex/Diners 4-6-5 ve 4-6-4. Ret: ISO tarih
    (YYYY-AA-GG) barındıran ya da iki veya daha çok 19xx/20xx yıl grubu taşıyan
    diziler ("2023 2024 2025 2026", "2025-01-02 2025-01-09").
    """
    if _ISO_TARIH.search(metin):
        return False
    gruplar = re.split(r"[ \-.]+", metin.strip(" -."))
    if len(gruplar) == 1:
        return True
    if sum(1 for g in gruplar if len(g) == 4 and _YIL.fullmatch(g)) >= 2:
        return False
    boylar = [len(g) for g in gruplar]
    if boylar in ([4, 6, 5], [4, 6, 4]):
        return True
    return all(b == 4 for b in boylar[:-1]) and 1 <= boylar[-1] <= 4


def _tc_degistir(m: re.Match) -> str:
    return _GIZLI if _tc_gecerli(m.group(0)) else m.group(0)


_HARF = "a-zçğıöşü"
# Komut satırı seçenek değeri: tırnaklı (sınırlı uzunluk: kapanmayan tırnak her
# başlangıçta metnin sonuna dek taranmasın) ya da "-" ile başlamayan sözcük.
_KOMUT_DEGER = r"""(?:"[^"\n]{0,200}"|'[^'\n]{0,200}'|[^\s\-]\S*+)"""
_MASKE_ONBELLEK: list[tuple[re.Pattern[str], object]] | None = None


def _maske_derle() -> list[tuple[re.Pattern[str], object]]:
    """Maske kalıplarını derler; içe aktarmada değil ilk kullanımda çağrılır
    (UserPromptSubmit yolu maske kullanmaz, derleme maliyeti ona yüklenmez).
    """
    return [
        # PEM özel anahtar bloğu: başlıktan END satırına, END yoksa (kesilmiş metin)
        # metnin sonuna kadar. Gövde "-----END" görene dek tek geçişle taranır;
        # END'siz ilk blok metnin sonunu yuttuğu için tarama doğrusal kalır.
        (re.compile(r"-----BEGIN[A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----"
                    r"(?:(?!-----END)[\s\S])*(?:-----END[A-Z0-9 ]{0,40}-----)?"), _GIZLI),
        # IBAN: ülke kodu + 2 sağlama + 11-30 alfasayısal, 4'lü gruplar boşluklu
        # ya da bitişik (önce: içindeki rakamlar kart/TC kuralına takılmasın).
        # Büyük harf zorunlu: küçük harfli hex dizileri aday bile olmaz.
        (re.compile(r"(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?:[ \-]?[A-Z0-9]{4}){2,7}"
                    r"(?:[ \-]?[A-Z0-9]{1,4})?(?![A-Za-z0-9])"), _iban_degistir),
        # Tümü küçük harfli IBAN: ayrı kural (büyük harfli adayın önüne geçip onu
        # yutmasın); kabul için sağlama + en az 10 rakam (bkz. _iban_kucuk_degistir).
        (re.compile(r"(?<![A-Za-z0-9])[a-z]{2}\d{2}(?:[ \-]?[a-z0-9]{4}){2,7}"
                    r"(?:[ \-]?[a-z0-9]{1,4})?(?![A-Za-z0-9])"), _iban_kucuk_degistir),
        # PIN/CVV/CVC/kart şifresi/... kodu + en çok 3 ara sözcük + 3-6 rakam:
        # "Kart PIN 4821", "PIN kodum 4821", "CVV'si 123", "güvenlik kodu (CVV)
        # 123", "kartın şifresi 4821". Ara sözcükler rakam içermez; Türkçe ekler
        # kapalı listeden ("pinned", "spin" gibi İngilizce sözcükler eşleşmez).
        (re.compile(
            rf"(?i)(?<![{_HARF}0-9])("
            rf"(?:pin|cvv2?|cvc2?|kart[{_HARF}]*\s+(?:şifre|sifre|parola)[{_HARF}]*"
            rf"|(?:şifre|sifre|güvenlik|guvenlik|onay|doğrulama|dogrulama|sms)\s+kod[{_HARF}]*)"
            rf"(?:'?(?:si|sı|su|sü|im|ım|um|üm|in|ın|un|ün|i|ı|u|ü|m|n|e|a|de|da|le|la|ni|nı))?)"
            rf"(?![{_HARF}])"
            # Ayraç ve sözcük parçaları iyelikli (*+, {{1,24}}+): sözcük sınıfı "-"yi de
            # kapsadığından geri izlemeli biçim "pin-pin-pin-..." gibi girdide her
            # başlangıçta binlerce bölüntü deniyordu (4 KB'ta saniyeler).
            rf"((?:[\s:=()\[\]\-–]*+[^\s\d:=()\[\]]{{1,24}}+){{0,3}}?[\s:=()\[\]\-–]*+)"
            rf"(?<![0-9])\d{{3,6}}(?![\d.,/:\-]\d|\d)"),
         r"\1\2" + _GIZLI),
        # Anahtar sözcüklü TC kimlik no: sağlama aranmaz (bağlam açık).
        (re.compile(
            rf"(?i)(?<![{_HARF}0-9])(t\.?\s?c\.?(?:\s?kimlik)?(?:\s?no)?|tckn|"
            rf"kimlik\s?(?:no|numarası|numaram)?)(\s*+[:=]?\s*+)"
            rf"(?:\d{{11}}|\d{{3}}[ \-]\d{{3}}[ \-]\d{{3}}[ \-]\d{{2}})(?!\d)"),
         r"\1\2" + _GIZLI),
        # Kart numarası: 13-19 hane, boşluk/tire/nokta ayraçlı; Luhn ve grup biçimiyle
        # doğrulanır (ondalık sayı, sürüm, IP biçimleri _kart_bicimi'nde elenir).
        # Aday ayraçlı rakam dizisinin tamamıdır (iyelikli): 19 haneyle kesilseydi
        # öndeki bir sayı ("1.", "7 ") kartı pencerenin dışına iterdi.
        (re.compile(r"(?<![\d\-])(?<!\d\.)\d(?:[ \-.]?\d){12,}+"), _kart_degistir),
        # Anahtar sözcüksüz 11 haneli sayı: yalnız TC algoritmasından geçerse.
        (re.compile(r"(?<![\d.,\-])[1-9]\d{10}(?![\d])"), _tc_degistir),
        # URL'deki kullanıcı:parola -> scheme://kullanici:[gizli]@
        # Şema adı sınırlı (≤32) ve başlangıç çapasız: sınırsız olsaydı "a-a-a-..."
        # gibi uzun dizide her sözcük sınırından sona dek taranır, süre ikinci
        # dereceden büyürdü; çapasız olduğu için 32'den uzun şema adının son 32
        # karakterinden eşleşir, parola yine gizlenir.
        (re.compile(r"(?i)([a-z][a-z0-9+.\-]{0,31}://[^\s:/@]+:)[^\s@/]+@"),
         r"\1" + _GIZLI + "@"),
        # JWT (base64url '{"' = eyJ), kısa olanlar da
        (re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}(?:\.[A-Za-z0-9_\-]*){0,2}"), _GIZLI),
        # anahtar=deger / anahtar: deger -> anahtar korunur, değer gizlenir.
        # Önde harf/rakam olmamalı ama "_" olabilir: DB_PASSWORD=, GITHUB_TOKEN=,
        # MY_SECRET=, AWS_SECRET_ACCESS_KEY=. Türkçe ekli biçimler: şifrem:,
        # parolası=. "key" yalnız "_KEY"/"-key" son eki olarak sayılır. Büyük harfli
        # ortam değişkeninde önek bitişik olabilir: PGPASSWORD=, GHTOKEN= (camelCase
        # isPassword: true ya da bypass= sayılmaz). Anahtar tırnaklı olabilir:
        # {"password": "..."} ("path-key": gibi son ekli anahtar tırnaklıyken sayılmaz).
        # Değer yalnız true/false/null/none/nil/undefined ise (ardından en çok kapanış
        # noktalaması) dokunulmaz: ayar bayrağı, sır değil. "None-of-x9", "null!x9Q",
        # "True#2024x" gibi bu sözcükle başlayıp süren değerler gizlenir.
        (re.compile(
            r"(?i)(?<![a-z0-9çğıöşü])"
            r"((?:(?-i:[A-Z]+(?:PASSWORD|PASSWD|SECRET|TOKEN))|password|passwd|pwd|"
            r"passphrase|pass|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)[\"']?"
            r"|(?<=[_\-])key"
            r"|(?:parola|şifre|sifre)(?:m|n|si|sı|miz|mız|niz|nız)?[\"']?)"
            r"(\s*[:=]\s*)"
            r"(?!(?:true|false|null|none|nil|undefined)[,;.)\]}\"'`]*+(?!\S))"
            r"(\"[^\"]*\"|'[^']*'|\S+)"),
         r"\1\2" + _GIZLI),
        # boşlukla ayrılan parola: "password is hunter2", "parolam 1234".
        # Yanlış pozitifi önlemek için değer en az 4 karakter olmalı ve rakam ya
        # da simge içermeli ("şifre 2 aşamalı" dokunulmaz).
        (re.compile(
            r"(?i)(?<![a-z0-9çğıöşü])"
            r"((?:password|passwd|passphrase)(?:\s+(?:is|was))?"
            r"|(?:parola|şifre|sifre)(?:m|n|si|sı|miz|mız|niz|nız)?"
            r"(?:\s+(?:şu|şudur))?)"
            r"(\s+)(?=[^\s,;]*[0-9!@#$%^&*?_+\-])[^\s,;]{4,}"),
         r"\1\2" + _GIZLI),
        (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/\-]{16,}=*"), "Bearer " + _GIZLI),
        (re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"), _GIZLI),
        (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"), _GIZLI),
        (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"), _GIZLI),
        (re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}"), _GIZLI),
        (re.compile(r"\bxox[abeoprs]-[A-Za-z0-9\-]{10,}"), _GIZLI),
        (re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), _GIZLI),
        # Önekli hizmet belirteçleri: GitLab, npm, Hugging Face, Stripe, PyPI,
        # Google OAuth erişim belirteci.
        (re.compile(r"\bgl(?:pat|dt|rt|ptt|ft|soat|cbt)-[A-Za-z0-9_\-]{20,}"), _GIZLI),
        (re.compile(r"\bnpm_[A-Za-z0-9]{30,}"), _GIZLI),
        (re.compile(r"\bhf_[A-Za-z0-9]{30,}"), _GIZLI),
        (re.compile(r"\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}"), _GIZLI),
        (re.compile(r"\bpypi-[A-Za-z0-9_\-]{40,}"), _GIZLI),
        (re.compile(r"\bya29\.[A-Za-z0-9_\-]{20,}"), _GIZLI),
        # Webhook adresleri: yolun gizli kısmı (adres yapısı korunur).
        (re.compile(r"(?i)(\bhooks\.slack\.com/(?:services|workflows|triggers)/)[A-Za-z0-9/_\-]{10,}"),
         r"\1" + _GIZLI),
        (re.compile(r"(?i)(\bdiscord(?:app)?\.com/api/webhooks/)[0-9]+/[A-Za-z0-9_\-]{20,}"),
         r"\1" + _GIZLI),
        # 32+ karakterlik kesintisiz hex/base64 benzeri dizi; en az bir rakam
        # içermeli (uzun snake_case adları ve sözcükleri korumak için). "/"
        # karakter sınıfında yok: dosya yolları maskelenmesin.
        (re.compile(r"(?<![A-Za-z0-9+_\-])(?=[A-Za-z_\-+]*[0-9])"
                    r"[A-Za-z0-9+_\-]{32,}={0,2}(?![A-Za-z0-9+_\-])"), _GIZLI),
        # Bağlamlı yeni kurallar (e-posta:parola, komut satırı, Authorization) en
        # sonda: önde olsalardı "curl -u a:password=X", "<e-posta>:token=X" gibi
        # metinde anahtar sözcüğü kendi değerleri sanıp yutar, asıl değeri anahtar=değer
        # kuralından kaçırırlardı.
        # e-posta:parola -> e-posta korunur. Değer boşluğa ya da metin sonuna dek
        # sürer, "/" içermez (git@host:grup/repo dokunulmaz), en az 4 karakterdir,
        # rakam ya da simge içerir; yalnız 1-5 rakamsa (port) dokunulmaz.
        # Doğrusal süre: eşleşme yalnız boşluk/"/" sonrası parça başında başlar,
        # parçanın boşlukla ya da metin sonuyla bittiği bir kez denetlenir, e-posta
        # parça içinde tembel önekle aranır (önek grup 1'de korunur). Çapasız
        # biçim "<e-posta>:<e-posta>:...<e-posta>:/" girdisinde her e-postadan sona dek tarayıp
        # geri izliyordu (56 KB'ta onlarca saniye).
        (re.compile(r"(?<![^\s/])(?=[^\s/]*+(?!\S))"
                    r"([^\s/]*?(?<![A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}:)"
                    r"(?!\d{1,5}(?!\S))(?=[^\s/]*[0-9!@#$%^&*?_+=])[^\s/]{4,}+(?!\S)"),
         r"\1" + _GIZLI),
        # Komut satırında parola: mysql/mariadb -pDEĞER (bitişik; "-p" tek başına
        # parola sorar, -P port), sshpass -p DEĞER, curl -u kullanıcı:DEĞER.
        # Komutla bayrak arasında yalnız seçenekler (değerleriyle) bulunabilir:
        # "mysql ayarlarını yaptım; ls -pla" ya da "find /var -perm" gibi aynı
        # satırdaki başka komutun bayrağı parola sayılmaz.
        (re.compile(r"(\b(?:mysql|mysqldump|mysqladmin|mysqlimport|mysqlcheck|mariadb"
                    r"(?:-dump|-admin)?)(?:\.exe)?\b"
                    rf"(?:\s+-\S*+(?:\s+{_KOMUT_DEGER})?){{0,12}}?\s+-p)[^\s\-`,;)|&>]\S*"),
         r"\1" + _GIZLI),
        (re.compile(rf"(\bsshpass\b(?:\s+(?:-[vhe]\b|-[fdP]\s*{_KOMUT_DEGER})){{0,6}}?\s+-p\s*)"
                    r"[^\s\-`,;)|&>]\S*"),
         r"\1" + _GIZLI),
        (re.compile(r"(\bcurl\b"
                    rf"(?:\s+(?:-\S*+(?:\s+{_KOMUT_DEGER})?|[A-Za-z][A-Za-z0-9+.\-]*+://\S*+)){{0,16}}?"
                    r"\s+(?:-u|--user[\s=])\s*[^\s:]+:)[^\s:]\S*"),
         r"\1" + _GIZLI),
        # HTTP Authorization başlığı (Basic/Token; Bearer yukarıda ayrı kuralda).
        (re.compile(r"(?i)(\bauthorization[\"']?\s*[:=]\s*[\"']?(?:basic|token)\s+)"
                    r"[A-Za-z0-9+/._~\-]{8,}=*"),
         r"\1" + _GIZLI),
    ]


def _maske_kaliplari() -> list[tuple[re.Pattern[str], object]]:
    global _MASKE_ONBELLEK
    if _MASKE_ONBELLEK is None:
        _MASKE_ONBELLEK = _maske_derle()
    return _MASKE_ONBELLEK


def __getattr__(ad: str):
    """``_MASKE_KALIPLARI`` eski modül düzeyi adı tembel olarak verilir."""
    if ad == "_MASKE_KALIPLARI":
        return _maske_kaliplari()
    raise AttributeError(f"module {__name__!r} has no attribute {ad!r}")


def _maske_uygula(metin: str) -> str:
    for kalip, yerine in _maske_kaliplari():
        metin = kalip.sub(yerine, metin)
    return metin


def maskele(metin: str) -> str:
    """API anahtarı/token benzeri dizileri ``[gizli]`` ile değiştirir.

    Uyumluluk biçimleri (tam genişlik "ｓｋ－...", matematik harfleri) kalıpları atlatmasın
    diye ASCII dışı metin NFKC ile de denenir; normalleştirilmiş metin daha çok gizli değer
    yakalarsa o döner. Sırsız metin değişmeden döner (yazma yolu ``maskele(x) != x`` ile sır
    arar; yalnız normalleştirme yüzünden yazma reddedilmez).
    """
    try:
        if not metin:
            return metin if isinstance(metin, str) else ""
        sonuc = _maske_uygula(metin)
        if not metin.isascii():
            import unicodedata
            normal = unicodedata.normalize("NFKC", metin)
            if normal != metin:
                normal_sonuc = _maske_uygula(normal)
                if normal_sonuc.count(_GIZLI) > sonuc.count(_GIZLI):
                    return normal_sonuc
        return sonuc
    except Exception:
        return ""

# ------------------------------------------------------------------- okuma


def _ileri_satirlar(f, butce: int) -> Iterator[bytes]:
    """Dosyanın başından en çok ``butce`` bayt; yalnız tam satırlar."""
    f.seek(0)
    veri = f.read(butce)
    tam = len(veri) < butce
    satirlar = veri.split(b"\n")
    if not tam:
        satirlar.pop()  # yarım kalan son satır
    for s in satirlar:
        if s.strip():
            yield s


def _geri_satirlar(f, boyut: int, butce: int) -> Iterator[bytes]:
    """Sondan başa doğru satırlar (en yeni önce), en çok ``butce`` bayt.

    Çok uzun satırlar parça listesinde tutulur; birleştirme yalnız satır sonu
    bulunduğunda yapılır, böylece okuma doğrusal kalır. Bütçe dolarsa en
    baştaki yarım satır verilmez.
    """
    konum = boyut
    okunan = 0
    kuyruk: list[bytes] = []  # henüz satır sonu görülmemiş parçalar (ters sıra)
    while konum > 0 and okunan < butce:
        n = min(_BLOK, konum)
        konum -= n
        f.seek(konum)
        parca = f.read(n)
        okunan += n
        i = parca.find(b"\n")
        if i == -1:
            kuyruk.append(parca)
            continue
        kuyruk.reverse()
        bolum = parca[i + 1:] + b"".join(kuyruk)
        for s in reversed(bolum.split(b"\n")):
            if s.strip():
                yield s
        kuyruk = [parca[:i]]
    if konum == 0 and kuyruk:
        kuyruk.reverse()
        s = b"".join(kuyruk)
        if s.strip():
            yield s


def _coz(satir: bytes) -> dict | None:
    try:
        o = json.loads(satir)
    except Exception:
        try:
            o = json.loads(satir.decode("utf-8", errors="replace"))
        except Exception:
            return None
    return o if isinstance(o, dict) else None


def _ac(transcript_path):
    if not transcript_path:
        return None
    try:
        yol = os.fspath(transcript_path)
        f = open(yol, "rb")
    except Exception:
        return None
    return f

# ---------------------------------------------------------------- yorumlama


def _kisalt(metin: str, n: int) -> str:
    metin = " ".join(metin.split())
    if len(metin) <= n:
        return metin
    return metin[: n - 1].rstrip() + "…"


_SR_BLOK = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)
_KOMUT_AD = re.compile(r"<command-name>\s*(.*?)\s*</command-name>", re.S)
_KOMUT_ARG = re.compile(r"<command-args>\s*(.*?)\s*</command-args>", re.S)


def _istem_metni(o: dict) -> str | None:
    """Satır gerçek bir kullanıcı istemiyse ham metnini, değilse None döner."""
    if o.get("type") != "user" or o.get("isSidechain") is True:
        return None
    if o.get("isMeta") or o.get("isCompactSummary") or o.get("isVisibleInTranscriptOnly"):
        return None
    if "toolUseResult" in o:
        return None
    origin = o.get("origin")
    if isinstance(origin, dict) and origin.get("kind") not in (None, "human"):
        return None
    mesaj = o.get("message")
    if not isinstance(mesaj, dict):
        return None
    icerik = mesaj.get("content")
    if isinstance(icerik, str):
        metin = icerik
    elif isinstance(icerik, list):
        parcalar = []
        for b in icerik:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_result":
                return None
            if b.get("type") == "text" and isinstance(b.get("text"), str):
                parcalar.append(b["text"])
        metin = "\n".join(parcalar)
    else:
        return None
    metin = _SR_BLOK.sub("", metin).strip()
    if not metin or metin.startswith("[Request interrupted"):
        return None
    if metin.startswith("<"):
        # Slash komutu: yalnız argümanı olan çağrılar istem sayılır.
        ad = _KOMUT_AD.search(metin)
        if ad and metin.lstrip().startswith(("<command-name>", "<command-message>")):
            arg = _KOMUT_ARG.search(metin)
            if arg and arg.group(1).strip():
                return f"{ad.group(1).strip()} {arg.group(1).strip()}"
            return None
        if isinstance(origin, dict) and origin.get("kind") == "human":
            return metin  # kullanıcı gerçekten "<" ile başlayan bir şey yazmış
        return None  # task-notification, local-command-*, bash-* ...
    return metin


def _istek_bilgisi(o: dict) -> dict | None:
    """Ana oturum assistant satırıysa (son_baglam, son_model, son_zaman)."""
    if o.get("type") != "assistant" or o.get("isSidechain") is True:
        return None
    mesaj = o.get("message")
    if not isinstance(mesaj, dict):
        return None
    model = mesaj.get("model")
    if not model or model == "<synthetic>":
        return None
    u = mesaj.get("usage")
    if not isinstance(u, dict):
        return None
    try:
        p = (int(u.get("input_tokens") or 0)
             + int(u.get("cache_read_input_tokens") or 0)
             + int(u.get("cache_creation_input_tokens") or 0))
    except Exception:
        return None
    zaman = o.get("timestamp")
    return {"son_baglam": p, "son_model": str(model),
            "son_zaman": zaman if isinstance(zaman, str) else None}


def _duzenlenen_yollar(o: dict) -> list[str]:
    """Satırdaki düzenleme aracı çağrılarının dosya yolları (satır içi sıra)."""
    mesaj = o.get("message")
    if not isinstance(mesaj, dict) or not isinstance(mesaj.get("content"), list):
        return []
    yollar = []
    for b in mesaj["content"]:
        if isinstance(b, dict) and b.get("type") == "tool_use":
            alan = _DUZENLEME_ARACLARI.get(b.get("name"))
            girdi = b.get("input")
            if alan and isinstance(girdi, dict):
                yol = girdi.get(alan)
                if isinstance(yol, str) and yol:
                    yollar.append(yol)
    return yollar


def _blok0_say(veri: bytes, isaret: bytes, bas: int = 0,
               son: int | None = None) -> int:
    """``veri[bas:son]`` içinde değeri 0 olan ``"apiBlockIndex"`` alanları.

    Önce dosya biçiminin işaretiyle (``_Isaretler.blok0``) düz bayt sayımı;
    hiç yoksa ama alan geçiyorsa (biçim seçimi tutmamış) regex sayar. İki yol
    aynı JSON için aynı sayıyı verir. Dilim kopyalanmaz.
    """
    if son is None:
        son = len(veri)
    sayi = veri.count(isaret, bas, son)
    if sayi or veri.find(_ANAHTAR_BLOK, bas, son) == -1:
        return sayi
    return sum(1 for _ in _BLOK0_DESEN.finditer(veri, bas, son))


def _istek_sayisi(f, boyut: int, isr: _Isaretler) -> int:
    """Değeri 0 olan ``"apiBlockIndex"`` alanlarını tüm dosyada parça parça sayar.

    Her API yanıtının ilk blok satırı bu alanı bir kez taşır; JSON metni
    içinde geçen kopyalar kaçışlı (``\\"``) olduğundan eşleşmez. Sıkışık
    (``"apiBlockIndex":0,``), boşluklu (``"apiBlockIndex": 0,``) ve alanın
    nesnede son olduğu (``...0}``) biçimler aynı sayılır. Parçalar satır
    sonunda bölünür; eşleşme iki parçaya bölünemez, iki kez sayılamaz.
    Gerçek kayıtlarda tekil (message.id, requestId) sayısıyla %0-2 farkla
    örtüşür (fark: ``apiBlockIndex`` taşımayan yapay/hata satırları).

    Sayım 0,12 sn'yi aşarsa (soğuk disk önbelleği, çok büyük dosya) okunan
    kısımdaki yoğunluk dosya boyuna oranlanarak tahmin döner.

    İşaret hiç yoksa (eski sürüm ya da elle üretilmiş kayıt) ve dosya 64
    MB'tan küçükse assistant satırları çözülüp (message.id, requestId)
    çiftleri tekilleştirilir; daha büyükse 0 döner. Bu yedek yol da kendi
    0,12 sn'lik bütçesiyle sınırlıdır; aşılırsa okunan kısmın yoğunluğundan
    oranlanır.
    """
    sayi = 0
    okunan = 0
    onceki = b""
    baslangic = time.perf_counter()
    f.seek(0)
    while True:
        parca = f.read(_SAYIM_BLOK)
        if not parca:
            if onceki:
                sayi += _blok0_say(onceki, isr.blok0)
            break
        okunan += len(parca)
        ilk = parca.find(b"\n")
        if ilk == -1:
            onceki += parca  # satır sonu yok: tek satır sürüyor
        else:
            # önceki parçadan süren satır + bu parçanın tam satırları;
            # yarım kalan son satır bir sonraki tura taşınır.
            sayi += _blok0_say(onceki + parca[:ilk + 1], isr.blok0)
            son = parca.rfind(b"\n") + 1
            sayi += _blok0_say(parca, isr.blok0, ilk + 1, son)
            onceki = parca[son:]
        if okunan < boyut and time.perf_counter() - baslangic > _SAYIM_SURE:
            return round(sayi * boyut / okunan) if sayi else 0
    if sayi:
        return sayi
    if boyut > 64 * 1024 * 1024:
        return 0
    ciftler: set[tuple] = set()
    okunan = 0
    baslangic = time.perf_counter()
    f.seek(0)
    for satir in f:
        okunan += len(satir)
        if okunan < boyut and time.perf_counter() - baslangic > _SAYIM_SURE:
            return round(len(ciftler) * boyut / okunan)
        if isr.asistan not in satir:
            continue
        o = _coz(satir)
        if o is None or o.get("type") != "assistant" or o.get("isSidechain") is True:
            continue
        mesaj = o.get("message")
        mid = mesaj.get("id") if isinstance(mesaj, dict) else None
        rid = o.get("requestId")
        if mid is None and rid is None:
            continue
        ciftler.add((str(mid), str(rid)))
    return len(ciftler)

# --------------------------------------------------------------- genel API


def _bos_istek() -> dict:
    return {"son_baglam": None, "son_model": None, "son_zaman": None}


def _sikistirma_siniri_mi(satir: bytes, isr: _Isaretler) -> bool:
    """Satır ana oturumda bir bağlam sıkıştırma sınırı mı?

    Gerçek kayıtta sıkıştırma iki ardışık satır bırakır:
    ``{"type":"system","subtype":"compact_boundary","compactMetadata":
    {"preTokens","postTokens","trigger",...}}`` ve ardından özet metni taşıyan
    ``{"type":"user","isCompactSummary":true,"isVisibleInTranscriptOnly":true}``.
    Sıkıştırma yeni bir assistant satırı yazmaz; bu yüzden sınırdan önceki
    son usage artık güncel bağlamı göstermez.
    """
    if not (isr.sikistirma[0] in satir or isr.sikistirma[1] in satir):
        return False
    o = _coz(satir)
    if o is None or o.get("isSidechain") is True:
        return False
    tur = o.get("type")
    return ((tur == "system" and o.get("subtype") == "compact_boundary")
            or (tur == "user" and o.get("isCompactSummary") is True))


def son_istek_bilgisi(transcript_path: str | Path) -> dict:
    """Son ana-oturum assistant mesajının bağlam boyu, modeli ve zamanı.

    Dosyanın yalnız sonundan geriye doğru okur (en çok 8 MB) ve ilk uygun
    satırda durur. ``son_baglam`` = input_tokens + cache_read_input_tokens +
    cache_creation_input_tokens. ``<synthetic>`` model ve alt agent
    (isSidechain) satırları atlanır.

    Son assistant satırından sonra bir sıkıştırma sınırı varsa
    (``compact_boundary`` ya da ``isCompactSummary``) üç alan da None döner:
    sıkıştırma sonrası henüz istek yapılmadı, eski usage yanıltıcıdır.
    """
    sonuc = _bos_istek()
    f = _ac(transcript_path)
    if f is None:
        return sonuc
    try:
        with f:
            boyut = os.fstat(f.fileno()).st_size
            isr = _isaret_sec(f)
            for satir in _geri_satirlar(f, boyut, _SON_ISTEK_BUTCE):
                if isr.asistan not in satir:
                    if _sikistirma_siniri_mi(satir, isr):
                        return _bos_istek()
                    continue
                o = _coz(satir)
                if o is None:
                    continue
                bilgi = _istek_bilgisi(o)
                if bilgi:
                    return bilgi
    except Exception:
        pass
    return sonuc


def oturum_ozeti(transcript_path: str | Path) -> dict:
    """Oturum kaydının özeti (anahtarlar modül sözleşmesindeki gibi).

    Okuma: baştan en çok 2 MB ileri (ilk istem, yedek sessionId/cwd), sondan
    en çok 12 MB geriye (başlıklar, son istem, düzenlenen dosyalar, son
    istek bilgisi, sessionId, cwd). Geriye okuma gereken her şey bulununca
    erken durur. ``cwd`` ve ``oturum`` kaydın en son satırlarından alınır.

    ``istek_sayisi``: tekil (message.id, requestId) assistant mesajı sayısının
    yaklaşığıdır; tüm dosyada değeri 0 olan ``"apiBlockIndex"`` alanı
    (sıkışık ya da boşluklu biçim) 8 MB'lık parçalarla sayılır, JSON
    çözülmez; sayım 0,12 sn'yi aşarsa okunan kısmın yoğunluğundan oranlanır
    (bkz. ``_istek_sayisi``).

    Son 12 MB içinde (1. evre) 15'ten az düzenleme varsa geriye okuma yalnız
    düzenleme aracı çağrılarına bakarak sürer (2. evre: bayt araması, yalnız
    eşleşen satır çözülür). 2. evre en çok 0,10 sn sürer; bu bütçe 2. evreye
    girildiği andan sayılır, 1. evrenin süresinden etkilenmez. Bu sürede
    dosyanın başına varılmazsa ``duzenlenen`` eksik kalır.

    1. evrede kimlik alanları (``oturum``, ``cwd``) dolduktan sonra bir satır
    yalnız henüz boş bir alanı doldurabilecek bayt işaretini taşıyorsa
    çözülür; sonuç, her satırı çözmekle aynıdır.

    Son assistant satırından sonra sıkıştırma sınırı varsa (bkz.
    ``_sikistirma_siniri_mi``) ``son_baglam`` None olur; ``son_model`` ve
    ``son_zaman`` o assistant satırından gelmeye devam eder.

    Sınırlar: ilk istem ilk 2 MB'ta yoksa ``ilk_istem`` None kalır; başlık ve
    son istem son 12 MB'ta yoksa bulunamaz.
    """
    sonuc = {
        "oturum": None, "cwd": None, "baslik": None,
        "ilk_istem": None, "son_istem": None, "duzenlenen": [],
        "son_baglam": None, "son_model": None, "son_zaman": None,
        "istek_sayisi": 0,
    }
    f = _ac(transcript_path)
    if f is None:
        return sonuc
    try:
        with f:
            boyut = os.fstat(f.fileno()).st_size
            isr = _isaret_sec(f)
            ozel = ai = ozet = None
            son_istem_ham = None
            istek = None
            sikisti = False
            duzenlenen: list[str] = []  # en yeni önce
            gorulen: set[str] = set()

            evre2_baslangic = None  # 2. evrenin süre bütçesi girişte başlar
            okunan = 0
            for satir in _geri_satirlar(f, boyut, boyut):
                okunan += len(satir) + 1
                if len(duzenlenen) >= _EN_COK_DUZENLENEN:
                    if (ozel is not None and son_istem_ham is not None
                            and istek is not None and sonuc["cwd"] is not None):
                        break
                    if okunan > _SON_BUTCE:
                        break
                if okunan > _SON_BUTCE:
                    # 2. evre: yalnız düzenleme aracı çağrıları aranır,
                    # süre sınırıyla (bkz. docstring).
                    simdi = time.perf_counter()
                    if evre2_baslangic is None:
                        evre2_baslangic = simdi
                    elif simdi - evre2_baslangic > _DUZENLEME_SURE:
                        break
                    if (isr.asistan not in satir
                            or isr.duzenleme.search(satir) is None):
                        continue
                    o = _coz(satir)
                    if o is None or o.get("isSidechain") is True:
                        continue
                    for yol in reversed(_duzenlenen_yollar(o)):
                        if yol not in gorulen and len(duzenlenen) < _EN_COK_DUZENLENEN:
                            gorulen.add(yol)
                            duzenlenen.append(yol)
                    continue
                asistan = isr.asistan in satir
                if (istek is None and not sikisti and not asistan
                        and _sikistirma_siniri_mi(satir, isr)):
                    sikisti = True  # son assistant satırından sonra sıkıştırma
                kullanici = (not asistan and isr.kullanici in satir
                             and _ISARET_ARAC_SONUCU not in satir)
                if sonuc["oturum"] is not None and sonuc["cwd"] is not None:
                    # Kimlik alanları dolu: satır yalnız henüz boş bir alanı
                    # doldurabiliyorsa çözülür. Her koşul, çözülse sonucu
                    # değiştirebilecek satırın zorunlu taşıdığı bayt işaretidir
                    # (bkz. aşağıdaki tür dalları); işaret yoksa çözüm etkisizdir.
                    # ai/summary başlığı, özel başlık bulunduktan sonra çıktıya
                    # giremez. Sonuç, her satırı çözen yolla aynıdır.
                    if not (
                        (asistan and (istek is None
                                      or (len(duzenlenen) < _EN_COK_DUZENLENEN
                                          and isr.duzenleme.search(satir) is not None)))
                        or (son_istem_ham is None
                            and (kullanici or isr.kullanici in satir))
                        or (ozel is None and (
                            isr.basliklar[0] in satir
                            or (ai is None and (
                                isr.basliklar[1] in satir
                                or (ozet is None and isr.basliklar[2] in satir)))))
                    ):
                        continue
                    if not (asistan or kullanici
                            or (len(satir) < 64 * 1024
                                and any(t in satir for t in isr.basliklar))):
                        continue  # başlık satırı da değil: çözülmezdi
                else:
                    baslik_satiri = (not asistan and not kullanici
                                     and len(satir) < 64 * 1024
                                     and any(t in satir for t in isr.basliklar))
                    if not (asistan or kullanici or baslik_satiri):
                        if sonuc["oturum"] is not None or len(satir) > 4096:
                            continue
                o = _coz(satir)
                if o is None:
                    continue
                if sonuc["oturum"] is None and isinstance(o.get("sessionId"), str):
                    sonuc["oturum"] = o["sessionId"]
                if (sonuc["cwd"] is None and isinstance(o.get("cwd"), str)
                        and o.get("isSidechain") is not True):
                    sonuc["cwd"] = o["cwd"]
                tur = o.get("type")
                if tur == "custom-title":
                    if ozel is None and isinstance(o.get("customTitle"), str) \
                            and o["customTitle"].strip():
                        ozel = o["customTitle"]
                elif tur == "ai-title":
                    if ai is None and isinstance(o.get("aiTitle"), str) \
                            and o["aiTitle"].strip():
                        ai = o["aiTitle"]
                elif tur == "summary":
                    if ozet is None and isinstance(o.get("summary"), str) \
                            and o["summary"].strip():
                        ozet = o["summary"]
                elif tur == "assistant":
                    if o.get("isSidechain") is True:
                        continue
                    if istek is None:
                        istek = _istek_bilgisi(o)
                    if len(duzenlenen) < _EN_COK_DUZENLENEN:
                        for yol in reversed(_duzenlenen_yollar(o)):
                            if yol not in gorulen:
                                gorulen.add(yol)
                                duzenlenen.append(yol)
                elif tur == "user":
                    if son_istem_ham is None:
                        son_istem_ham = _istem_metni(o)

            ilk_istem_ham = None
            for satir in _ileri_satirlar(f, min(_BAS_BUTCE, boyut)):
                if isr.kullanici not in satir or _ISARET_ARAC_SONUCU in satir:
                    if sonuc["oturum"] is not None and sonuc["cwd"] is not None:
                        continue
                o = _coz(satir)
                if o is None:
                    continue
                if sonuc["oturum"] is None and isinstance(o.get("sessionId"), str):
                    sonuc["oturum"] = o["sessionId"]
                if sonuc["cwd"] is None and isinstance(o.get("cwd"), str):
                    sonuc["cwd"] = o["cwd"]
                metin = _istem_metni(o)
                if metin:
                    ilk_istem_ham = metin
                    break

            if ilk_istem_ham is None and son_istem_ham is not None \
                    and boyut <= _SON_BUTCE:
                # dosyanın tamamı geriye okundu; ilk istem yoksa son istem de
                # aynı tek istemdir (ör. başta 2 MB'ı aşan dev ekler).
                ilk_istem_ham = son_istem_ham

            if ilk_istem_ham:
                sonuc["ilk_istem"] = _kisalt(maskele(ilk_istem_ham), _ISTEM_UZUNLUK)
            if son_istem_ham:
                sonuc["son_istem"] = _kisalt(maskele(son_istem_ham), _ISTEM_UZUNLUK)
            for aday in (ozel, ai, ozet):
                if aday:
                    sonuc["baslik"] = _kisalt(maskele(aday), _BASLIK_UZUNLUK)
                    break
            else:
                if ilk_istem_ham:
                    sonuc["baslik"] = _kisalt(maskele(ilk_istem_ham), _BASLIK_UZUNLUK)
            sonuc["duzenlenen"] = list(reversed(duzenlenen))
            if istek:
                sonuc.update(istek)
            if sikisti:
                sonuc["son_baglam"] = None
            sonuc["istek_sayisi"] = _istek_sayisi(f, boyut, isr)
    except Exception:
        pass
    return sonuc
