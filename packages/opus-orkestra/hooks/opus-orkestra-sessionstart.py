"""SessionStart hook: opus-orkestra skill metnini her oturum basinda baglama zorunlu olarak enjekte eder.

SKILL.md bulma sirasi: --skill <yol> -> OPUS_ORKESTRA_SKILL ortam degiskeni ->
~/.claude/skills/opus-orkestra/SKILL.md -> bu betige gore ../skill/SKILL.md
(--skill oldugu gibi kullanilir; digerlerinde ilk var olan dosya secilir).

Kullanim: python opus-orkestra-sessionstart.py [--parca <n>] [--skill <yol>]
Metin '## ' basliklarindan bloklara bolunur ve en fazla AZAMI_PARCA parcaya dagitilir;
her parca ayri hook komutu olarak calisir (n. parca -> --parca n).
"""
import json
import os
import re
import sys

# Claude Code additionalContext'i hook basina 10.000 karakterle sinirlar (fazlasi dosyaya tasinir,
# modele yalniz ilk 2.000 karakter gider); 9.500 guvenlik payi birakir.
SINIR_KARAKTER = 9500
AZAMI_PARCA = 4

SKILL_YOLU_GOSTERIM = "~/.claude/skills/opus-orkestra/SKILL.md"


def gosterim_yolu(yol):
    """Modele gosterilecek yol: gercekten secilen dosya; ev dizini altindaysa ~ ile kisaltilir."""
    mutlak = os.path.normpath(os.path.abspath(yol))
    ev = os.path.normpath(os.path.expanduser("~"))
    gorece = os.path.relpath(mutlak, ev) if os.path.splitdrive(mutlak)[0].lower() == os.path.splitdrive(ev)[0].lower() else None
    if gorece and not gorece.startswith(".."):
        return "~/" + gorece.replace(os.sep, "/")
    return mutlak.replace(os.sep, "/")


def etiket(n, m):
    return (
        "# ZORUNLU CALISMA KURALI: OPUS ORKESTRA (parça %d/%d)\n\n" % (n, m)
        + "Bu kurallar %d parça halinde gelir ve parçaların sırası karışık olabilir. " % m
        + "Tüm parçalar bu oturumda sistem promptu gibi geçerlidir; kod yazma/düzenleme/hata düzeltme/refactor/test "
        "kapsayan HER görevde bu kurallara uyarsın. Kullanıcı skill'i kapatmanı açıkça istemedikçe bu kural geçerlidir. "
        "Parçalardan biri eksik ya da kesilmiş görünüyorsa, işe başlamadan " + SKILL_YOLU_GOSTERIM +
        " dosyasının tamamını Read ile oku. Tüm parçalar eksiksiz geldiyse Skill aracıyla ayrıca yüklemene gerek yok.\n\n"
    )


def uyari(basliklar):
    """Sigmayan basliklar kisa tutulur: ilk 5 baslik (en cok 60 karakter), kalani 've N bolum daha'."""
    gosterilen = []
    for ad in basliklar[:5]:
        gosterilen.append(ad if len(ad) <= 60 else ad[:59] + "…")
    liste = ", ".join(gosterilen)
    if len(basliklar) > 5:
        liste += " ve %d bölüm daha" % (len(basliklar) - 5)
    return (
        "UYARI: kuralların bir kısmı hook sınırına sığmadı (%s). "
        "İşe başlamadan dosyanın tamamını Read ile oku.\n\n"
        "Kullanıcıya kuralların eksik yüklendiğini işe başlamadan söyle.\n\n" % liste
    )


def govde_al(text):
    """Frontmatter yalniz ilk satir tam '---' ve kapanis satiri tam '---' ise atilir."""
    satirlar = text.split("\n")
    if satirlar[0].rstrip("\r") == "---":
        for i in range(1, len(satirlar)):
            if satirlar[i].rstrip("\r") == "---":
                return "\n".join(satirlar[i + 1:]).lstrip("\n")
    return text


def bloklara_bol(body):
    """'## ' ile baslayan satirlardan boler; birlestirilince ozgun govde cikar."""
    idx = [mt.start() for mt in re.finditer(r"(?m)^## ", body)]
    if not idx or idx[0] != 0:
        idx = [0] + idx
    idx.append(len(body))
    return [body[idx[i]:idx[i + 1]] for i in range(len(idx) - 1) if body[idx[i]:idx[i + 1]]]


def baslik_adi(blok):
    ilk = blok.split("\n", 1)[0].strip()
    return ilk[3:].strip() if ilk.startswith("## ") else "başlıksız giriş bölümü"


def yerlestir(bloklar, uyari_metni):
    """Acgozlu yerlestirme. 1. parca etiket + uyariyi tasir (govdesi bos kalabilir).
    Doner: (parcalar[govde str], sigmayan blok indeksleri)."""
    ekn = len(etiket(1, AZAMI_PARCA))
    kapasite_n = SINIR_KARAKTER - ekn
    kapasite_1 = kapasite_n - len(uyari_metni)
    parcalar = []
    sigmayan = []
    for i, blok in bloklar:
        if len(blok) > kapasite_n:
            sigmayan.append(i)  # bos bir parcaya bile sigmiyor
            continue
        if not parcalar:
            parcalar.append("")
        kap = kapasite_1 if len(parcalar) == 1 else kapasite_n
        if len(parcalar[-1]) + len(blok) <= kap:
            parcalar[-1] += blok
        elif len(parcalar) < AZAMI_PARCA:
            parcalar.append(blok)
        else:
            sigmayan.append(i)
    return parcalar, sigmayan


def parcala(body):
    bloklar = list(enumerate(bloklara_bol(body)))
    tum = dict(bloklar)
    sigmayan = []
    while True:
        uyari_metni = uyari([baslik_adi(tum[i]) for i in sigmayan]) if sigmayan else ""
        kalan = [(i, b) for i, b in bloklar if i not in sigmayan]
        parcalar, ek = yerlestir(kalan, uyari_metni)
        if not ek:
            return parcalar, uyari_metni
        sigmayan = sorted(sigmayan + ek)


def parca_metni(n, parcalar, uyari_metni):
    m = len(parcalar)
    return etiket(n, m) + (uyari_metni if n == 1 else "") + parcalar[n - 1]


def varsayilan_skill():
    """--skill verilmediyse: ortam degiskeni -> ~/.claude kurulumu -> betige gore ../skill/SKILL.md.
    Ilk var olan dosya secilir; hicbiri yoksa kurulum yolu doner (hata mesaji icin)."""
    kurulum = os.path.join(os.path.expanduser("~"), ".claude", "skills", "opus-orkestra", "SKILL.md")
    paket = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "skill", "SKILL.md")
    adaylar = []
    env = os.environ.get("OPUS_ORKESTRA_SKILL")
    if env:
        adaylar.append(env)
    adaylar += [kurulum, paket]
    for yol in adaylar:
        if os.path.isfile(yol):
            return yol
    return kurulum


def argumanlar(argv):
    n = 1
    skill = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--parca" and i + 1 < len(argv):
            try:
                v = int(argv[i + 1])
                n = v if 1 <= v <= AZAMI_PARCA else 1
            except ValueError:
                n = 1
            i += 2
            continue
        if a == "--skill" and i + 1 < len(argv):
            skill = argv[i + 1]
            i += 2
            continue
        i += 1
    if skill is None:
        skill = varsayilan_skill()
    return n, skill


def yaz(obj):
    data = (json.dumps(obj, ensure_ascii=True) + "\n").encode("utf-8")
    try:
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    except AttributeError:
        sys.stdout.write(data.decode("utf-8"))


def bildir(mesaj):
    yaz({
        "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "UYARI: " + mesaj},
        "systemMessage": mesaj,
    })


def main():
    global SKILL_YOLU_GOSTERIM
    n, skill = argumanlar(sys.argv[1:])
    SKILL_YOLU_GOSTERIM = gosterim_yolu(skill)
    try:
        with open(skill, encoding="utf-8-sig") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError):
        if n == 1:
            bildir("opus-orkestra SKILL.md okunamadı (" + SKILL_YOLU_GOSTERIM + "); hook boş geçti. "
                   "Kullanıcıya bunu işe başlamadan söyle; dosyayı Read ile okumayı dene.")
        return 0

    govde = govde_al(text)
    if not govde.strip():
        if n == 1:
            bildir("opus-orkestra SKILL.md boş (" + SKILL_YOLU_GOSTERIM + "); hook boş geçti, kurallar eksik. "
                   "Kullanıcıya bunu işe başlamadan söyle; dosyayı Read ile okumayı dene.")
        return 0

    parcalar, uyari_metni = parcala(govde)
    if not parcalar and uyari_metni:
        parcalar = [""]  # her blok sigmadi: yalniz etiket + uyari
    if not parcalar or n > len(parcalar):
        return 0

    if uyari_metni:
        mesaj = ("Opus Orkestra kuralı eksik yüklendi: bazı bölümler hook sınırına sığmadı, "
                 "kurallar tam değil (parça %d/%d)." % (n, len(parcalar)))
    else:
        mesaj = "Opus Orkestra kuralı yüklendi (parça %d/%d)." % (n, len(parcalar))
    yaz({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": parca_metni(n, parcalar, uyari_metni),
        },
        "systemMessage": mesaj,
        "suppressOutput": True,
    })
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
