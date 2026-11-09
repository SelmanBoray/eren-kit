<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img src="docs/assets/banner-light.svg" alt="eren-kit">
</picture>

**Claude Code için bellek, orkestrasyon ve eller.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform: Windows 10 | 11 · macOS](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011%20%C2%B7%20macOS-0078D6.svg)](#-hızlı-başlangıç)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-3776AB.svg)](packages/bellek/pyproject.toml)
[![Node 24+ (phone only)](https://img.shields.io/badge/node-24%2B%20(phone%20only)-5FA04E.svg)](apps/phone/package.json)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-toolkit-D97757.svg)](https://docs.claude.com/en/docs/claude-code/overview)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](CHANGELOG.md)

[English](README.md) · Türkçe

</div>

---

## 💡 Neden

Claude Code güçlü bir eş programcıdır, ama kutudan çıktığı haliyle oturum bitince her şeyi unutur,
tüm işi sürekli büyüyen tek bir bağlamın içinde yapar ve Windows CLI'da ekranınızı göremez, kullanamaz.
eren-kit bu üç boşluğu dolduran kişisel bir araç takımıdır: oturumlar arasında kalıcı yerel bir
**bellek** (ve oturumlar arası devir notları), ana modelin işi dar kapsamlı alt agent'lara
dağıtmasını sağlayan bir **orkestrasyon** kuralı ve Windows için bir computer-use MCP sunucusu
biçiminde **eller**. Her şey kendi makinenizde çalışır ve kurulum tek bir PowerShell betiğiyle yapılır.

> [!NOTE]
> eren-kit **alfa** aşamasında bir yazılımdır; tek bir kişinin Windows kurulumu için yazıldı ve
> orada test edildi. Belgelerin ve Opus Orkestra kurallarının bir kısmı hâlâ Türkçedir. Pürüzler
> olabilir; önce `-DryRun` ile kurulum betiğinin neler yapacağını okuyun.

## 🧩 İçinde neler var

<p align="center">
  <img src="docs/assets/components.tr.svg" alt="eren-kit bileşenleri: Bellek &amp; Beyin, Devir, Opus Orkestra, computer-use-windows, Telefon uygulaması (deneysel)" width="100%">
</p>

| Bileşen | Ne yapar | Tür | Durum |
| --- | --- | --- | --- |
| [**Bellek & Beyin**](#bellek--beyin-beyin) (`packages/bellek`) | Sizin ve işleriniz hakkında kalıcı, hiyerarşik bir bilgi ağacı; Claude'a `beyin` MCP sunucusu olarak sunulur, yerel bir web arayüzü vardır | MCP · CLI · Web arayüzü | Çalışıyor (alfa) |
| [**Devir**](#devir-devir) (`packages/bellek`) | Bir sonraki oturumun kaldığı yerden devam edebilmesi için devir notları yazar; pahalı uzun bağlamlar için uyarır | Hook · Skill | Çalışıyor (alfa) |
| [**Önce harita belge kapısı**](#önce-harita-belge-kapısı-kapi) (`packages/bellek`) | Büyük Markdown belgelerini ilk okumada reddedip başlık haritasını döndürür; ajan yalnız gereken bölümü okur | Hook | Çalışıyor (alfa) |
| [**Opus Orkestra**](#opus-orkestra) (`packages/opus-orkestra`) | Çalışma kuralı: ana model kodu kendisi yazmaz, işi çok sayıda dar kapsamlı alt agent'a böler ve sonucu doğrular | Skill · Hook | Çalışıyor; kurallar Türkçe |
| [**computer-use-windows**](#computer-use-windows) (`packages/computer-use-windows`) | Windows'ta terminal agent'ları için ekran, UI Automation, fare ve klavye; koruma önlemleriyle | MCP | Çalışıyor (0.1.0) |
| [**Telefon uygulaması (deneysel)**](#telefon-uygulaması-deneysel) (`apps/phone`) | Telefonunuzdan PC'nizdeki ana Claude oturumuyla konuşun | Uygulama | **Deneysel**, kullanıma hazır değil |

## 🏗️ Mimari

```mermaid
flowchart LR
    subgraph PC["Windows PC'niz"]
        CC["Claude Code oturumu"]

        subgraph MCP["MCP sunucuları (stdio)"]
            BMCP["beyin<br/>beyin köprüsü"]
            CUW["computer-use-windows"]
        end

        subgraph HOOKS["Hook'lar (settings.json)"]
            HD["devir hook'u<br/>SessionStart · UserPromptSubmit · Stop"]
            HK["kapı hook'u<br/>PreToolUse · Read *.md"]
            HO["Opus Orkestra hook'u<br/>SessionStart, 4 parça"]
        end

        subgraph SKILLS["Skill'ler (~/.claude/skills)"]
            SD["/devir"]
            SO["opus-orkestra"]
        end

        subgraph DATA["Yerel veri"]
            SVC["beyin servisi<br/>127.0.0.1, oturum açılışında başlar"]
            DB[("beyin.db<br/>SQLite")]
            NOTES[("devir notları<br/>vault/devir")]
        end

        WEB["Web arayüzü<br/>beyin ac"]
        DESK["Masaüstü<br/>ekran, fare, klavye"]
    end

    PHONE["Telefon uygulaması<br/>deneysel"]

    CC <--> BMCP
    CC <--> CUW
    HD --> CC
    HO --> CC
    HK -->|"büyük .md okumasını reddeder, harita döndürür"| CC
    CC --> SD
    CC --> SO
    BMCP <--> SVC
    SVC <--> DB
    WEB <--> SVC
    HD --> NOTES
    SD --> NOTES
    CUW <--> DESK
    PHONE -.-> CC
```

Claude Code, stdio üzerinden iki yerel MCP sunucusuyla konuşur. Hook'lar oturum başında bağlam ekler,
tur bittiğinde devir notlarını yazar. Beyin veritabanının tek bir yazıcısı vardır: `127.0.0.1`
üzerindeki küçük bir servis; MCP köprüsü de web arayüzü de onun üzerinden geçer. Telefon bağlantısı
(kesikli çizgi) deneyseldir.

## 🚀 Hızlı başlangıç

### Ön koşullar

| Gereksinim | Ne için gerekli | Notlar |
| --- | --- | --- |
| Windows 10 veya 11 | her şey | macOS'ta `install.sh` kullanın, bkz. [macOS ve iOS](#-macos-ve-ios). Linux henüz desteklenmiyor |
| PowerShell | kurulum betiği | PowerShell 7 önerilir; Windows PowerShell 5.1 de çalışır |
| Python 3.12+ | Bellek & Beyin, Devir | computer-use-windows ve kurulum betiği için 3.11+ yeterli |
| `PATH` üzerinde `python`, 3.11+ | Devir ve Opus Orkestra hook'ları | Hook'lar doğrudan `python` komutunu çağırır ve kurulum betiği sürümünü denetler. Python'u kurarken **"Add python.exe to PATH"** kutusunu işaretleyin |
| [Claude Code CLI](https://docs.claude.com/en/docs/claude-code/setup) (`claude`) | MCP kaydı | Yoksa kurulum betiği MCP adımlarını atlar ve elle yapılacak komutu yazdırır |
| Node 24+ ve npm | yalnızca Telefon uygulaması | Varsayılan kurulum için gerekmez |

### Kurulum

```powershell
git clone https://github.com/SelmanBoray/eren-kit.git
cd eren-kit

.\install.ps1 -DryRun                    # optional: list what would change, change nothing
.\install.ps1 -AssistantName "Ada"       # install the default components
```

Çalıştırma politikası betiği engellerse:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Ardından:

1. **Claude Code'u yeniden başlatın**; yeni MCP sunucularını, hook'ları ve skill'leri tanısın.
2. **MCP sunucularını kontrol edin:**

   ```powershell
   claude mcp list        # should list "beyin" and "computer-use-windows"
   ```

3. **Beynin web arayüzünü açın** (isteğe bağlı). Beyin servisi zaten arka planda çalışıyor:
   kurulum betiği onu zamanlanmış görev olarak kaydeder ve hemen başlatır.

   ```powershell
   packages\bellek\.venv\Scripts\beyin ac
   ```

4. **İsteğe bağlı: not klasörünüzü ayarlayın.** Kurulum betiği, yoksa `bellek.example.toml`
   dosyasını `packages\bellek\bellek.toml` olarak kopyalar. Devir notlarının
   `packages\bellek\vault` dışında bir yerde durmasını istiyorsanız oradaki `vault` değerini düzenleyin.

### Bileşenleri seçin

Varsayılan küme `beyin, devir, kapi, orkestra, computer-use` bileşenleridir. Telefon uygulaması yalnızca
siz isterseniz kurulur.

```powershell
.\install.ps1 -Components beyin,devir          # memory + handoff only
.\install.ps1 -Components orkestra             # just the orchestration rule
.\install.ps1 -Components computer-use         # just the Windows computer-use server
.\install.ps1 -Components phone                # experimental phone app dependencies (npm ci)
```

Kurulum betiğini yeniden çalıştırmak güvenlidir: değişeni günceller, geri kalanına dokunmaz.

## 🍎 macOS ve iOS

<p align="center">
  <img src="docs/assets/macos.tr.svg" alt="eren-kit macOS üzerinde: install.sh Claude Code için hook, skill ve beyin MCP'sini, beyin servisini çalıştıran bir LaunchAgent'ı yazar; iPhone ve iPad beyni Tailscale üzerinden ana ekran web uygulaması olarak açar" width="100%">
</p>

macOS'ta `install.sh`, Windows'taki `install.ps1` ile aynı işi aynı kurallarla yapar: `settings.json`
dosyasını birleştirir, değiştirdiği her şeyi yedekler, yeniden çalıştırmak güvenlidir ve yalnızca
kendi kurduğunu kaldırır.

```bash
git clone https://github.com/SelmanBoray/eren-kit.git && cd eren-kit
./install.sh --dry-run                    # neyin değişeceğini listele, hiçbir şeyi değiştirme
./install.sh --assistant-name "Ada"       # beyin, devir, kapi, orkestra kur
./install.sh --uninstall                  # geri kaldır (venv'ler ve verin kalır)
```

Python 3.12+ (`brew install python@3.13`) ve Claude Code CLI gerekir. Seçenekler Windows betiğiyle
aynıdır: `--components`, `--claude-home`, `--skip-mcp`, `--no-service`, `--replace-existing`; ayrıca
`--tailscale-host` (aşağıda).

| | Windows | macOS |
| --- | --- | --- |
| Beyin servisi | Oturum açılışında Görev Zamanlayıcı görevi | LaunchAgent `com.eren-kit.beyin-servis` (`~/Library/LaunchAgents`); çökerse yeniden başlar, günlük `~/Library/Logs/eren-kit` altında |
| Yerel veri | `%LOCALAPPDATA%\Bellek` | `~/Library/Application Support/Bellek` |
| Hook yorumlayıcısı | `PATH`'teki `python` | 3.11+ bir Python'un mutlak yolu (macOS'ta `python` komutu genelde yoktur) |
| Asistan adı | kullanıcı ortam değişkeni | `settings.json` içindeki `env` alanı ve servis plist'i |
| Computer use | `computer-use-windows` MCP | Claude Code'un [yerleşik computer use'u](https://code.claude.com/docs/en/computer-use): oturumda `/mcp` → `computer-use` → **Enable** (Pro/Max, etkileşimli oturum) |

<p align="center"><img src="docs/assets/beyin-macos.jpg" alt="macOS'ta örnek veriyle beyin web arayüzü: tek bir kök etrafında projeler, tercihler, araçlar ve kişiler; yan panelde bir projenin ayrıntısı açık" width="100%"></p>
<p align="center"><sub>macOS'ta beyin web arayüzü (örnek veri).</sub></p>

**iPhone ve iPad.** Beynin web arayüzü mobil Safari'de çalışır ve ana ekrana uygulama olarak
eklenebilir (web manifesti ve ikonu vardır). Yalnızca kendi cihazlarına, tailnet üzerinden aç:

```bash
tailscale serve --bg --http 80 http://127.0.0.1:47321
./install.sh --components beyin --tailscale-host "<mac>.<tailnet>.ts.net"
packages/bellek/.venv/bin/beyin ac --yazdir --taban "http://<mac>.<tailnet>.ts.net"
```

Yazdırılan adresi telefonda aç, ardından Paylaş → **Ana Ekrana Ekle**. Ana ekran uygulamasının ayrı
depolaması vardır; ilk açılışta aynı adresi (ya da yalnızca anahtarı) giriş ekranındaki alana
yapıştır, yalnızca o uygulama için hatırlanır. Normal tarayıcı sekmesinde anahtar yine yalnızca
oturum boyunca tutulur. İnternete hiçbir şey açılmaz: funnel yok, servis yine yalnızca `127.0.0.1`
üzerinde dinler.


## 🛠️ `install.ps1` başvurusu

```text
.\install.ps1 [-Components <list>] [-AssistantName <name>] [-ClaudeHome <folder>]
              [-DryRun] [-Uninstall] [-SkipMcp] [-NoService] [-ReplaceExisting] [-Help]
```

| Parametre | Açıklama |
| --- | --- |
| `-Components` | Virgülle ayrılmış bileşen listesi, ör. `-Components beyin,devir`. Geçerli değerler: `beyin`, `devir`, `kapi`, `orkestra`, `computer-use`, `phone`. Varsayılan: `beyin, devir, kapi, orkestra, computer-use` |
| `-AssistantName` | Asistan adı; `EREN_KIT_ASSISTANT_NAME` kullanıcı ortam değişkenine yazılır. Verilmezse mevcut değer korunur, o da yoksa `"Claude"` kullanılır |
| `-ClaudeHome` | Claude Code ayar klasörü. Varsayılan: `CLAUDE_CONFIG_DIR` ortam değişkeni tanımlıysa o, değilse `%USERPROFILE%\.claude` |
| `-DryRun` | Hiçbir şeyi değiştirmez; yapılacakları listeler |
| `-Uninstall` | Seçilen bileşenlerin MCP kayıtlarını, hook'larını, kopyalanan skill'lerini ve beyin servisi görevini kaldırır. Venv'leri ve kullanıcı verisini **silmez** |
| `-SkipMcp` | `claude mcp add/remove` adımlarını atlar |
| `-NoService` | Beyin servisinin zamanlanmış görevini kurmaz (veya kaldırmaz); servisi kendiniz yönetirsiniz |
| `-ReplaceExisting` | `settings.json` içinde, depo dışındaki aynı hook betiklerinin eski kopyalarına ait girdileri (ör. başka bir klasördeki `bellek\devir\hook.py` ya da `bellek\kapi\hook.py`, `~\.claude\hooks\opus-orkestra-sessionstart.py`) yedek alarak kaldırır. Bu anahtar olmadan eskiler kalır ve hook'lar iki kez çalışır |
| `-Help` | Yerleşik yardımı gösterir (Türkçe) |

| Bileşen | Kurulum betiği ne yapar |
| --- | --- |
| `beyin` | `packages\bellek\.venv` oluşturur ve `pip install -e` çalıştırır; yoksa `bellek.example.toml` dosyasını `bellek.toml` olarak kopyalar; `bellek.beyin` modülünün içe aktarılabildiğini denetler; `beyin` MCP sunucusunu kaydeder (kullanıcı kapsamı); beyin servisi görevini kaydedip başlatır (aşağıya bakın) |
| `devir` | Aynı venv'i kullanır; `PATH` üzerindeki `python` komutunun 3.11+ olduğunu denetler; devir hook'unu `SessionStart`, `UserPromptSubmit` ve `Stop` olaylarına ekler; skill'i `<ClaudeHome>\skills\devir` klasörüne kopyalar |
| `kapi` | `PATH` üzerindeki `python` komutunun 3.11+ olduğunu denetler; kapı hook'unu `PreToolUse` olayına ekler (`Read` için `.md`/`.markdown` filtresiyle). Venv ya da skill yoktur |
| `orkestra` | `PATH` üzerindeki `python` komutunun 3.11+ olduğunu denetler; `SKILL.md` dosyasını `<ClaudeHome>\skills\opus-orkestra` klasörüne kopyalar; dört `SessionStart` hook komutu ekler |
| `computer-use` | `packages\computer-use-windows\.venv` oluşturur ve `pip install -e` çalıştırır; `computer-use-windows` MCP sunucusunu kaydeder (kullanıcı kapsamı) |
| `phone` | Node 24+ ve npm olup olmadığına bakar; `apps\phone` içinde `npm ci` çalıştırır. Hiçbir şey kaydedilmez; elle başlatılır |

Mevcut kurulumunuza nasıl davrandığı:

- **`settings.json` birleştirilir, üzerine yazılmaz.** Diğer ayarlarınız ve hook'larınız korunur.
  eren-kit'in hook'ları depo içindeki betik yollarından tanınır; bu yüzden yeniden çalıştırmak onları
  asla ikiye katlamaz, depoyu taşırsanız eski girdiler güncellenir. Hiçbir şey değişmiyorsa dosyaya
  dokunulmaz.
- **Önce yedek.** `settings.json` değiştirilmeden ya da bir skill klasörü değiştirilmeden önce
  orijinal `<ClaudeHome>\backups\eren-kit\<timestamp>\` altına kopyalanır.
- **MCP kayıtları** `claude` CLI'ının kendi kullanıcı yapılandırmasına gider (`-ClaudeHome`'dan
  bağımsızdır). Aynı olan bir kayda dokunulmaz. Adı aynı ama komutu farklı olan bir kayıt önce
  yedeklenir, sonra değiştirilir; yenisi eklenemezse eskisi geri yüklenir. Bu kayıt deponun dışını
  gösteriyorsa kurulum betiği bunu söyler, `-DryRun` sırasında da.
- **Beyin servisi görevi.** `beyin` bileşeni, `eren-kit-beyin-servis` adlı kullanıcı düzeyinde bir
  Görev Zamanlayıcı görevi kaydeder (yönetici hakkı gerekmez). Görev,
  `packages\bellek\.venv\Scripts\pythonw.exe -m bellek.beyin servis` komutunu her oturum açılışında
  sessizce çalıştırır ve kurulumdan hemen sonra başlatılır. Yeniden kurulum onu günceller ve yeniden
  başlatır; `-Uninstall -Components beyin` durdurup kaldırır; `-NoService` bu adımı atlar. Aynı servisi
  başka bir görev zaten çalıştırıyorsa kurulum betiği sizi uyarır, çünkü ikisi aynı bağlantı noktasını
  kullanır.
- **Kopyalanan skill'lere** küçük bir `.eren-kit` işaret dosyası konur. `-Uninstall` yalnızca bu
  işareti taşıyan ya da depodaki kopyayla eşleşen skill klasörlerini kaldırır, önce onları yedekler;
  geri kalan her şeye dokunulmaz. Yedek alınamazsa hiçbir şey silinmez.

### Elle kurulumdan geçiş

Bu parçalardan herhangi birini daha önce elle kurduysanız (örneğin başka bir klasördeki devir hook'unu
ya da `~\.claude\hooks` altındaki Opus Orkestra hook'unu), kurulum betiği kendi girdilerini ekler ve
eski kopyaların hâlâ kayıtlı olduğunu, dolayısıyla bu hook'ların iki kez çalışacağını söyler. Geçiş için:

```powershell
.\install.ps1 -DryRun -ReplaceExisting      # see which old entries would be replaced
.\install.ps1 -ReplaceExisting              # remove them (settings.json is backed up first)
```

`-ReplaceExisting` yalnızca `settings.json` içindeki hook girdilerine dokunur; eski betik dosyalarını
silmez. Mevcut bir `beyin` ya da `computer-use-windows` MCP kaydı, yukarıda anlatıldığı gibi bu
anahtar olmadan da (yedek alınarak) değiştirilir; `-DryRun` bunu önceden gösterir.

### Kaldırma

```powershell
.\install.ps1 -Uninstall                         # default components
.\install.ps1 -Uninstall -Components orkestra    # just one
```

Bu işlem hook'ları, kopyalanan skill'leri, beyin servisi görevini ve bu depoyu gösteren MCP
kayıtlarını kaldırır (başka yeri gösteren bir `beyin` ya da `computer-use-windows` kaydı uyarıyla
birlikte yerinde bırakılır). Venv'leri, `bellek.toml` dosyasını, beyin veritabanınızı, notlarınızı ve
`EREN_KIT_ASSISTANT_NAME` değişkenini korur; kalmasını istemiyorsanız bunları elle silin.

## 📦 Bileşenler

### Bellek & Beyin (`beyin`)

Sizin hakkınızda hiyerarşik bir "beyin haritası": başlığı, özeti ve ayrıntısı olan düğümler, yalnızca
eklenebilen olgular, net bir yeri olmayan öneriler için bir gelen kutusu ve bir değişiklik geçmişi;
hepsi tek bir SQLite dosyasında.

- **Altı MCP aracı:** `beyin_ara` (arama), `beyin_gez` (bir düğümü ve çocuklarını gezme),
  `beyin_oku` (bir düğümü okuma), `beyin_yaz` (olgu ekleme), `beyin_duzelt` (özeti/ayrıntıyı
  düzenleme ya da bir olguyu emekli etme), `beyin_gelen` (gelen kutusu öğelerini listeleme veya karara bağlama).
- **Tek yazıcı.** `127.0.0.1` üzerindeki (varsayılan bağlantı noktası `47321`) yerel bir servis,
  veritabanına yazan tek süreçtir. Kurulum betiği onu her oturum açılışında arka planda çalıştırır
  (zamanlanmış görev `eren-kit-beyin-servis`). Çalışmıyorsa okumalar salt okunur bir bağlantıyla yine
  çalışır, `beyin_yaz` yazmaları ise servis başlayana kadar kuyruğa alınır.
- **Web arayüzü.** `beyin ac`, beyni zamanla büyüyen parlak bir miselyum ağı olarak çizen, ağırlıklı
  olarak salt okunur bir görünümü tarayıcınızda açar. Yalnızca gelen kutusu kararlarını yazabilir.
- **Koruma önlemleri.** Sır gibi görünen metinler `beyin_yaz` tarafından reddedilir; düğümler özel
  olarak işaretlenebilir.
- **Araç adları ve CLI Türkçedir** (`ara` = arama, `gez` = gezme, `oku` = okuma,
  `yaz` = yazma, `duzelt` = düzeltme, `gelen` = gelen kutusu).

```powershell
# from the repository root
packages\bellek\.venv\Scripts\beyin ac         # open the web UI (needs the service running)
packages\bellek\.venv\Scripts\beyin ara "project deadlines"
packages\bellek\.venv\Scripts\bellek doktor    # health check of the install
```

`-NoService` ile ya da elle kurduysanız servisi kendiniz başlatın ve o terminali açık bırakın
(veya kendi otomatik başlatmanızı kurun):

```powershell
packages\bellek\.venv\Scripts\beyin servis
```

Claude Code'da örnek istemler:

- "Şu anki projelerim hakkında neler biliyorsun?"
- "Küçük ve sık commit'leri tercih ettiğimi hatırla."
- "O teslim tarihi cumaya kaydı, beyni güncelle."

Ayrıntılar: [packages/bellek/README.md](packages/bellek/README.md) (Türkçe, İngilizce özetle)
ve tasarım sözleşmesi [packages/bellek/DESIGN.md](packages/bellek/DESIGN.md).

### Devir (`devir`)

Uzun oturumlar pahalıdır. Devir, konunun ipini kaybetmeden yeni, kısa bir oturuma geçmenizi sağlar.

- **`Stop` hook'u:** oturum başına kısa bir otomatik not yazar.
- **`SessionStart` hook'u:** oturum kimliğini ve son notların bir dizinini yeni oturumun bağlamına ekler.
- **`UserPromptSubmit` hook'u:** uzun bir aradan sonra önbelleği yeniden yazma maliyeti ve çok büyük
  bağlamlar konusunda uyarır (bağlama metin eklemez).
- **`/devir` skill'i:** istek üzerine zengin bir devir notu yazar ve bir sonraki oturumun onu okumasına yardım eder.
- **Hata durumunda sessiz (fail-open):** herhangi bir hatada hook hiçbir şey yazdırmaz ve oturumu asla engellemez.

Notlar `BELLEK_DEVIR_DIR` altında tutulur; varsayılan olarak `vault` klasörünüzün içindeki `devir`
klasörüdür (otomatik notlar `devir\oto\` içinde).

Örnek: oturumu kapatmadan önce `/devir` yazın, yeni oturumda da *"son devir notundan devam et"* deyin.

Ayrıntılar: [packages/bellek/README.md](packages/bellek/README.md) ve skill dosyası
[packages/bellek/skills/devir/SKILL.md](packages/bellek/skills/devir/SKILL.md).

### Önce harita belge kapısı (`kapi`)

Büyük bir Markdown belgesini baştan sona okumak bağlamı boşuna doldurur. Kapı, Bellek paketindeki bir
Claude Code `PreToolUse` hook'udur (`packages/bellek/src/bellek/kapi/hook.py`): bir ajan (ana oturum ya
da alt agent) ≥16 KB'lık bir Markdown dosyasına ilk kez dokunduğunda okumayı reddeder ve gerekçe olarak
başlık haritasını (her başlığın satır aralığı ve boyutu) döndürür. Ajan sonra yalnız gereken bölümü
`offset`/`limit` ile okur.

- **Neden:** ölçümde alt agent'lar büyük proje belgelerini tekrar tekrar 275-280 satırlık parçalar
  halinde okuyordu.
- **Geçenler:** ≤80 satırlık hedefli okumalar geçer; ikinci deneme her zaman geçer, yani kapı asla
  kilitlemez.
- **Ucuz:** hook `if` filtresiyle (`Read(//**/*.md)`, `Read(//**/*.markdown)`) kayıtlıdır; diğer
  okumalarda süreç başlatılmaz.
- **Hata durumunda sessiz (fail-open):** herhangi bir hatada okuma olduğu gibi geçer.
- **Kapatma:** `BELLEK_KAPI=kapali` ortam değişkeni ya da `.\install.ps1 -Uninstall -Components kapi`.
- **Ölçüm günlüğü:** `%LOCALAPPDATA%\Bellek\kapi\kapi.jsonl`.

### Opus Orkestra

Kodlama oturumları için bir çalışma kuralı: ana model kodu kendisi yazmaz. İşi çok sayıda dar
kapsamlı alt agent'a böler (basit, sınırları net işler için Sonnet; karmaşık işler için Opus), her
birinin sınırlarını belirler ve sonucu doğrular.

- **Neden:** ana modelin bağlamı plan ve sizin niyetiniz üzerinde kalır; bağımsız işler paralel
  yürür; taze bağlamlı bir gözden geçirici, yazarın varsayımlarına çıpalanmaz.
- **Her zaman açık:** bir `SessionStart` hook'u kuralları her oturumun başında enjekte eder. Claude
  Code hook bağlamını 10.000 karakterle sınırladığı için metin `## ` başlıklarından bölünür ve dört
  hook komutuyla (`--parca 1` ile `--parca 4`) iletilir.
- **Kapatma:** modelden bir oturum için kapatmasını isteyin ya da
  `.\install.ps1 -Uninstall -Components orkestra` ile kaldırın.
- **Dil:** kural metni şu an Türkçedir. İngilizce sürüm [yol haritasında](#-yol-haritası).

Ayrıntılar: [packages/opus-orkestra/README.md](packages/opus-orkestra/README.md) ve kurallar
[packages/opus-orkestra/skill/SKILL.md](packages/opus-orkestra/skill/SKILL.md) dosyasında.

### computer-use-windows

Claude Code'un yerleşik computer use özelliği Windows'taki CLI'da yoktur. Bu MCP sunucusu onu
terminalinizdeki agent'a getirir; iki kural üzerine kuruludur: **önce terminal** ve **token tasarrufu**.

- **12 araç:** `screenshot`, `zoom`, `elements`, `windows`, `focus`, `click`, `type_text`, `key`,
  `scroll`, `drag`, `move`, `wait`.
- **Piksellerden önce metin.** `elements`, arayüzü Windows UI Automation üzerinden okur; ekran
  görüntüleri varsayılan olarak yaklaşık 1,2 bin token'a küçültülür; eylem araçları asla görüntü döndürmez.
- **Koruma önlemleri.** Parola alanlarına ve terminallere yazmayı reddeder, uygulama engelleme
  listesini (`--block`) destekler ve bir acil durdurma düzeneği vardır: **durdurmak için fareyi bir ekran köşesine götürün.**
- **Yalnızca yerel:** ağ erişimi yok, telemetri yok.

Örnek istemler:

- "Ayarlar'ı aç ve Gece ışığı'nı etkinleştir."
- "Uygulamamı `bin\Debug` içinden başlat, kayıt formunu doldur ve Kaydet düğmesinin etkinleşip etkinleşmediğini söyle."

Ayrıntılar, seçenekler ve token maliyet tabloları:
[packages/computer-use-windows/README.tr.md](packages/computer-use-windows/README.tr.md).

### Telefon uygulaması (deneysel)

> [!WARNING]
> Bu çalışma henüz devam ediyor ve **kullanıma hazır değil**. Arayüzler, protokol ve güvenlik modeli
> değişebilir. Test sunucusunda kimlik doğrulama yoktur: onu asla güvenmediğiniz bir ağa açmayın.

Amaç: telefonunuzdan PC'nizdeki ana Claude oturumuyla konuşmak. Ana oturum işi kendisi yapmaz; her
görev için yeni bir Claude Code oturumu açar, onaylamanız için bir plan gösterir ve sonucu geri
bildirir. Dizin şu an ortak protokolü, testleriyle birlikte PC servisi tasarımını ve bağımsız bir
ölçüm deneyini içerir.

Ayrıntılar (Türkçe, İngilizce özetle): [apps/phone/README.md](apps/phone/README.md).

### Elle kurulum

<details>
<summary><code>install.ps1</code> yerine bileşenleri elle kurun</summary>

Aşağıdaki komutlar deponun kök dizininde olduğunuzu varsayar.

**Bellek & Beyin**

```powershell
cd packages\bellek
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -e .
Copy-Item bellek.example.toml bellek.toml        # then edit the paths
.venv\Scripts\bellek doktor
claude mcp add beyin -s user -- "$PWD\.venv\Scripts\python.exe" -m bellek.beyin mcp
.venv\Scripts\beyin servis                       # brain service; keep this terminal open
```

Kurulum betiği olmadan zamanlanmış görev de olmaz; yazmaların uygulanmasını ve web arayüzünün
açılmasını istediğiniz her an `beyin servis` komutunu kendiniz (ya da kendi Görev Zamanlayıcı
girdinizle) başlatın.

**Devir**

`packages\bellek\skills\devir` klasörünü `~\.claude\skills\devir` altına kopyalayın, ardından şu
komutu `~\.claude\settings.json` içindeki `SessionStart`, `UserPromptSubmit` ve `Stop` olaylarına
ekleyin (`<repo>` yerine deponun yolunu yazın; `|| true`, hata veren bir hook'un oturumu
engellemesini önler):

```text
python -I "<repo>/packages/bellek/src/bellek/devir/hook.py" || true
```

**Opus Orkestra**

`packages\opus-orkestra\skill\SKILL.md` dosyasını `~\.claude\skills\opus-orkestra\SKILL.md` olarak
kopyalayın ve
[packages/opus-orkestra/README.md](packages/opus-orkestra/README.md#install) içinde gösterilen dört
`SessionStart` komutunu ekleyin.

**computer-use-windows**

```powershell
cd packages\computer-use-windows
python -m venv .venv
.venv\Scripts\python -m pip install -e .
claude mcp add computer-use-windows -s user -- "$PWD\.venv\Scripts\computer-use-windows.exe"
```

Klonlamadan, `uvx` ile de çalıştırılabilir; bkz.
[packages/computer-use-windows/README.tr.md](packages/computer-use-windows/README.tr.md#alternatif-klonlamadan-uvx).

</details>

## ⚙️ Yapılandırma

### Ortam değişkenleri

| Değişken | Kullanan | Varsayılan | Anlamı |
| --- | --- | --- | --- |
| `CLAUDE_CONFIG_DIR` | kurulum betiği | `%USERPROFILE%\.claude` | Claude Code'un ayar klasörü; kurulum betiği `-ClaudeHome` için varsayılan olarak bunu kullanır |
| `EREN_KIT_ASSISTANT_NAME` | beyin web arayüzü, telefon uygulaması | `Claude` | Asistanın görünen adı. `-AssistantName` ile ayarlanır. Claude Code içinde Claude'u yeniden adlandırmaz |
| `BELLEK_CONFIG` | Bellek & Beyin, Devir | `packages\bellek\bellek.toml` | Yapılandırma dosyasının yolu |
| `BELLEK_BEYIN_DB` | Bellek & Beyin | `%LOCALAPPDATA%\Bellek\beyin.db` (macOS: `~/Library/Application Support/Bellek/beyin.db`) | Beyin veritabanı |
| `BELLEK_BEYIN_PORT` | Bellek & Beyin | `47321` | Yerel beyin servisinin bağlantı noktası |
| `BELLEK_BEYIN_IZINLI_HOST` | Bellek & Beyin | boş | Servisin kabul ettiği ek `Host` değerleri (virgülle ayrılmış); başka bir cihazdan erişim için |
| `BELLEK_DEVIR_DIR` | Devir | `<vault>\devir` | Devir notlarının kök klasörü |
| `BELLEK_DEVIR_UYARI` | Devir | `durdur` | Uyarı kipi: `durdur` (durdur), `uyar` (uyar), `kapali` (kapalı) |
| `BELLEK_KAPI` | Önce harita belge kapısı | boş (açık) | `kapali` yapılırsa kapı hiçbir okumayı reddetmez |
| `OPUS_ORKESTRA_SKILL` | Opus Orkestra | `~\.claude\skills\opus-orkestra\SKILL.md` | Hook'un enjekte ettiği kural dosyasının yolu |
| `CUW_MAX_SIZE`, `CUW_BLOCK`, `CUW_FAILSAFE`, … | computer-use-windows | paket README'sine bakın | Görüntü boyutu, uygulama engelleme listesi, acil durdurma ve daha fazlası ([tam tablo](packages/computer-use-windows/README.tr.md#yapılandırma)) |

Beynin günlük, kuyruk ve token dosyaları için de değişkenleri vardır; bkz.
[bellek README'si](packages/bellek/README.md#ortam-değişkenleri).

### `bellek.toml`

[`packages/bellek/bellek.example.toml`](packages/bellek/bellek.example.toml) şablondur; kurulum
betiği onu `packages\bellek\bellek.toml` olarak kopyalar, bu dosya git tarafından yok sayılır. Ana anahtarlar:

```toml
[bellek]
vault = "vault"                        # your notes folder; handoff notes go to vault/devir
# state_dir = "..."                    # isteğe bağlı; varsayılan %LOCALAPPDATA%/Bellek (macOS: ~/Library/Application Support/Bellek)

[server]
host = "127.0.0.1"                     # local only
port = 47321
```

Salt okunur not kaynakları (`[[source]]`) da ekleyebilir, klasörleri proje adlarına
eşleyebilirsiniz (`[projects]`); şablon ikisini de açıklar.

## 🔒 Gizlilik ve güvenlik

- **Verileriniz yerelde kalır.** Beyin veritabanı, notlar, günlükler ve token'lar
  `%LOCALAPPDATA%\Bellek` (macOS: `~/Library/Application Support/Bellek`) ile vault klasörünüzde durur. Beyin servisi yalnızca `127.0.0.1` üzerinde dinler.
- **Depoya kişisel hiçbir şey girmez.** `bellek.toml`, `vault/`, değerlendirme verileri,
  veritabanları, `.env` dosyaları ve anahtarlar [`.gitignore`](.gitignore) içinde listelidir.
- **Model sağlayıcısına dikkat edin.** Bir aracın döndürdüğü her şey (beyin girdileri, ekran
  görüntüleri, ekran metni) Claude oturumunuzun parçası olur ve geri kalanı gibi model sağlayıcınıza gönderilir.
- **computer-use-windows gerçek farenizi ve klavyenizi kontrol eder.** Parola alanlarına ya da
  terminallere yazmaz, uygulama engelleme listesine uyar ve fareyi bir ekran köşesine götürmek her
  eylemi durdurur. O çalışırken PC'yi kullanmayın, hassas pencereleri kapatın ve parolaları kendiniz yazın.
- **Hook'lar hata durumunda sessizdir (fail-open).** Bozuk bir hook hiçbir şey yazdırmaz ve
  oturumunuzu asla engellemez.
- **Güvenlik açığı bildirimi:** bkz. [SECURITY.md](SECURITY.md).

## 🗂️ Depo yapısı

```text
eren-kit/
├── install.ps1                    # one-command installer (run with -Help)
├── scripts/installer/             # installer module and settings.json hook merger
├── packages/
│   ├── bellek/                    # Memory & Brain + Handoff (Python 3.12+)
│   │   ├── src/bellek/            #   core, beyin (brain), devir (handoff)
│   │   ├── skills/devir/          #   /devir skill
│   │   ├── eval/                  #   retrieval evaluation set
│   │   └── bellek.example.toml    #   config template
│   ├── opus-orkestra/             # orchestration rule
│   │   ├── skill/SKILL.md         #   the rules (Turkish)
│   │   └── hooks/                 #   SessionStart hook
│   └── computer-use-windows/      # Windows computer-use MCP server (Python 3.11+)
├── apps/
│   └── phone/                     # experimental phone app (Node 24+, TypeScript)
├── docs/assets/                   # banner and diagrams
└── .github/workflows/ci.yml       # tests on windows-latest
```

## 🧭 Yol haritası

Eksik olanların dürüst listesi, sıralama gözetmeksizin:

- [ ] **İngilizce Opus Orkestra kuralları** (şu an yalnızca Türkçe).
- [ ] **Kullanılabilir bir telefon uygulaması:** istemci uygulaması, kimlik doğrulama ve eşleştirme henüz yapılmadı.
- [x] **macOS desteği** (`install.sh`, LaunchAgent, yerleşik computer use) ve iPhone/iPad'de beyin
      web arayüzü. computer-use-windows tasarım gereği yalnızca Windows içindir.
- [ ] **Linux desteği** (yollar hazır; kurulum betiği ve servis birimi henüz yok).
- [ ] **Tüm takım için `uvx` ile tek satırlık kurulum** (bugün yalnızca computer-use-windows `uvx`
      üzerinden çalışabiliyor).
- [ ] `bellek` paketi için daha fazla İngilizce belge.

## 🤝 Katkıda bulunma

Issue'lar ve pull request'ler memnuniyetle karşılanır. [CONTRIBUTING.md](CONTRIBUTING.md) her
paketin testlerinin nasıl çalıştırılacağını anlatır; CI bunları her pull request için Windows'ta çalıştırır.
Lütfen kişisel veri ya da sır asla commit'lemeyin ve asistan adını sabit yazmak yerine
`EREN_KIT_ASSISTANT_NAME` değişkeninden okuyun. Değişiklikler [CHANGELOG.md](CHANGELOG.md) dosyasında izlenir.

## 📄 Lisans

[MIT](LICENSE) © 2026 SelmanBoray

Anthropic ile bağlantılı değildir ve onun tarafından onaylanmamıştır.
