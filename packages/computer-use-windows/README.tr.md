# computer-use-windows

[English](README.md) | **Türkçe**

[![CI](https://github.com/SelmanBoray/eren-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/SelmanBoray/eren-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue.svg)](pyproject.toml)
[![Platform: Windows 10 | 11](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D6.svg)](#sınırlamalar)

**Windows'ta terminal tabanlı yapay zekâ ajanları için bilgisayar kullanımı.** Claude Code'un ya da
herhangi bir stdio MCP istemcisinin ekranı görmesini, UI Automation öğelerini okumasını ve fare ile
klavyeyi kullanmasını sağlayan bir MCP sunucusudur. Mümkün olduğunca az token harcayacak şekilde
tasarlanmıştır.

Claude Code'un yerleşik bilgisayar kullanımı
[Windows'ta CLI'da mevcut değil](https://code.claude.com/docs/en/computer-use). Dokümantasyon,
Windows kullanıcılarını Desktop uygulamasına yönlendiriyor. Bu sunucu, bilgisayar kullanımını
terminalinizdeki ajana getirir ve iki kurala uyar:

- **Önce terminal.** Ajan, kabuğunda yapılabilen her şeyi kabuğunda yapar. Bu araçlar yalnızca
  sadece arayüzle yapılabilen işler içindir: yerel (native) iletişim kutuları, CLI veya API'si
  olmayan uygulamalar ve görsel kontroller.
- **Token tasarrufu.** Piksellerden önce metin gelir. Ajan ekran görüntüsü yerine öğe listelerini
  okur. Ekran görüntüleri küçültülür (en fazla yaklaşık 4,8 bin yerine yaklaşık 1,2 bin token),
  `zoom` ihtiyaç anında ayrıntı verir ve eylem araçları asla görüntü döndürmez.

Bu paket [eren-kit monorepo](../../README.md)'sunun içindedir. Deponun kökünden:

```powershell
.\install.ps1 -Components computer-use
```

Elle kurulum için [Hızlı başlangıç](#hızlı-başlangıç) bölümüne bakın.

## Ajan ne görür

Aşağıda örnek amaçlı bir etkileşim var. Öğe adları uygulamaya göre değişir.

```text
$ Start-Process ms-settings:display          # the agent's own shell, not this server
> elements(query="night light")
window: "Settings" (systemsettings.exe) — 2 elements
[1] text "Night light"
[2] button "Night light"
> click(element=2)
ok | foreground: "Settings" (systemsettings.exe)
```

Bu iş için görüntüye gerek kalmadı, birkaç satır metin yetti. Ajanın gerçekten bakması gerektiğinde:

```text
> screenshot()
[image 1280x720]
monitor 1/2 1280x720 (scale 1.50) ~1196 tokens | foreground: "Settings" (systemsettings.exe)
```

## Özellikler

- **12 araç:** `screenshot`, `zoom`, `elements`, `windows`, `focus`, `click`, `type_text`, `key`,
  `scroll`, `drag`, `move`, `wait`.
- **Arayüzü metin olarak okur.** `elements`, bir pencerenin düğmelerini, alanlarını, menü öğelerini
  ve metinlerini listelemek için Windows UI Automation'ı kullanır. Her kaydın ajanın tıklayabileceği
  bir id'si vardır; görüntüye gerek kalmaz.
- **Modele göre boyutlandırılmış ekran görüntüleri.** Her görüntü uzun kenara göre (varsayılan 1280
  px) ve token bütçesine göre (varsayılan 1.568) sınırlanır. Görüntüler her zaman modelin sınırlarına
  sığar; böylece API onları yeniden boyutlandırmaz ve Claude'un koordinatları doğru kalır. Görüntüler
  PNG veya JPEG olarak gelir ve her ekran görüntüsü boyutunu, ölçeğini ve tahmini token sayısını
  bildirir.
- **Küçük yazılar için `zoom`.** Ekranın bir bölgesini yerel çözünürlükte kırpar; böylece ajanın tam
  çözünürlüklü bir ekran görüntüsüne ihtiyacı kalmaz.
- **Kısa eylem sonuçları.** `click`, `type_text`, `key`, `scroll`, `drag`, `move`, `focus` ve `wait`,
  ön plandaki pencerenin adını veren tek satırlık metin döndürür. Asla görüntü döndürmezler.
- **Doğru koordinatlar.** `x,y`, ajanın gördüğü ekran görüntüsündeki piksellerdir; sunucu bunları
  fiziksel ekran piksellerine çevirir. Sunucu monitör başına DPI farkındalığına sahiptir ve negatif
  koordinatlardaki monitörler dahil birden çok monitörü destekler.
- **Her dilde çalışan yazma.** Unicode yazma, klavye düzenine bağlı değildir (Türkçe `ğüşıöçİ`,
  emoji, her yazı sistemi). Kısayollar (`ctrl+s`) ve tuş dizileri (`tab tab enter`) de desteklenir.
- **Koruma önlemleri.** Sunucu parola alanlarına ve terminallere yazmaz. Bir uygulama engelleme
  listesi (siz ayarlayana dek boş) ve bir failsafe (acil durdurma) vardır: ajanı durdurmak için
  fareyi ekranın bir köşesine götürün. Bunlar korkuluktur, kum havuzu (sandbox) değil: kullanmadan
  önce [Güvenlik ve gizlilik](#güvenlik-ve-gizlilik) bölümünü okuyun.
- **Yalnızca yerel.** Ağ erişimi ve telemetri yoktur. Dört çalışma zamanı bağımlılığı vardır (`mcp`,
  `mss`, `Pillow`, `comtypes`) ve girdi, `ctypes` üzerinden Win32 `SendInput` ile gönderilir.

## Hızlı başlangıç

### Önerilen: monorepo yükleyicisi

[eren-kit deposunun](../../README.md) kökünden:

```powershell
.\install.ps1 -Components computer-use
```

Bu komut `packages/computer-use-windows/.venv` oluşturur, bu paketi kurar ve MCP sunucusunu
`computer-use-windows` adıyla kaydeder. Sunucuyu seçeneksiz kaydeder; yani engelleme listesi boştur
ve yükleyici bunu sormaz. Sonradan [Önerilen kurulum](#önerilen-kurulum) bölümündeki gibi ayarlayın.

### Elle kurulum (venv)

```powershell
cd packages\computer-use-windows
python -m venv .venv
.venv\Scripts\python -m pip install -e .
claude mcp add computer-use-windows -s user -- "$PWD\.venv\Scripts\computer-use-windows.exe"
```

`.venv\Scripts\computer-use-windows.exe --version` ile kontrol edin. `--block` gibi seçenekler
çalıştırılabilir dosyanın yolundan sonra gelir.

### Alternatif: klonlamadan uvx

Bu bölümün geri kalanı, yerel kopya olmadan sunucuyu doğrudan GitHub'dan uv ile kurar.

### Gereksinimler

- Windows 10 veya 11
- [uv](https://docs.astral.sh/uv/). Python 3.11+ yüklü değilse uv sizin için indirebilir.
- Git; uv bu depoyu GitHub'dan çekmek için kullanır
- Bir MCP istemcisi. Birincil hedef Claude Code'dur; stdio MCP sunucusu çalıştıran her istemci
  (Codex CLI, Gemini CLI, Cursor, …) çalışabilir. `screenshot` ve `zoom`, görüntü kabul eden bir
  model gerektirir.

### 1. uv'yi kurun

```powershell
winget install --id=astral-sh.uv -e
```

Resmî kurulum betiğini de kullanabilirsiniz:
`powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`. Ardından
`uvx`'in `PATH`'inizde olması için yeni bir terminal açın.

### 2. Çalıştığını kontrol edin (isteğe bağlı)

```powershell
uvx --from git+https://github.com/SelmanBoray/eren-kit#subdirectory=packages/computer-use-windows computer-use-windows --version
```

Bu komut `computer-use-windows 0.1.0` çıktısını verir. Ayrıca bağımlılıkları önceden indirir; böylece
MCP istemcinizin ilk başlatması hızlı olur.

### 3. Claude Code'a ekleyin

```powershell
claude mcp add computer-use-windows -s user -- uvx --from git+https://github.com/SelmanBoray/eren-kit#subdirectory=packages/computer-use-windows computer-use-windows
```

`-s user`, sunucuyu her projede kullanılabilir yapar. Yeni bir Claude Code oturumu başlatıp `/mcp`
çalıştırın; `computer-use-windows` bağlı görünmelidir. Deneyebileceğiniz birkaç şey:

- "Ayarlar'ı aç ve Gece ışığı'nı etkinleştir."
- "`bin\Debug` içindeki uygulamamı başlat, kayıt formunu doldur ve Kaydet düğmesinin etkinleşip
  etkinleşmediğini söyle."
- "Paint'i aç ve kırmızı bir dikdörtgen çiz."

### Seçenekleri iletme

İkinci `computer-use-windows`'tan (komut adı) sonra gelen her şey sunucuya iletilir:

```powershell
claude mcp add computer-use-windows -s user -- uvx --from git+https://github.com/SelmanBoray/eren-kit#subdirectory=packages/computer-use-windows computer-use-windows --block keepass.exe --max-size 1024
```

Seçenekleri sonradan değiştirmek için `claude mcp remove computer-use-windows -s user` komutunu
çalıştırın ve sunucuyu yeniden ekleyin.

### Diğer MCP istemcileri

JSON yapılandırma dosyası kullanan çoğu istemci şuna benzer bir blok kabul eder. İhtiyacınız yoksa
`--block` argümanlarını ve `env`'i çıkarın:

```json
{
  "mcpServers": {
    "computer-use-windows": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/SelmanBoray/eren-kit#subdirectory=packages/computer-use-windows",
        "computer-use-windows",
        "--block",
        "keepass.exe"
      ],
      "env": { "CUW_MAX_SIZE": "1024" }
    }
  }
}
```

Codex CLI, `~/.codex/config.toml` içinde TOML kullanır:

```toml
[mcp_servers.computer-use-windows]
command = "uvx"
args = ["--from", "git+https://github.com/SelmanBoray/eren-kit#subdirectory=packages/computer-use-windows", "computer-use-windows"]
```

### Güncelleme ve kaldırma

`uvx`, kurduklarını önbelleğe alır. En son commit'i almak için bir kez şunu çalıştırın:

```powershell
uvx --refresh --from git+https://github.com/SelmanBoray/eren-kit#subdirectory=packages/computer-use-windows computer-use-windows --version
```

Sunucuyu Claude Code'dan kaldırmak için `claude mcp remove computer-use-windows -s user` komutunu
çalıştırın.

## "Önce terminal" nasıl işler

Birkaç mekanizma ajanı kabuğunda tutar ve görüntü kullanımını nadir tutar:

1. **Sunucu talimatları.** Claude Code gibi istemciler, bir MCP sunucusunun talimatlarını her
   oturumda ajanın bağlamına ekler; bu yüzden talimatlar 900 karakterin altında tutulur. Talimatlar
   ajana, araçların yalnızca arayüzle yapılabilen işler için son çare olduğunu söyler. Geri kalan
   her şey kabukta kalır: uygulama, dosya ve URL açma (`Start-Process`), dosya işlemleri, pano
   (`Get-Clipboard`/`Set-Clipboard`), süreçler ve CLI'ı olan ayarlar. Web sayfaları için ajan,
   varsa bir tarayıcı otomasyon aracını tercih etmelidir. Talimatlar ayrıca en ucuzdan başlayan bir
   sıra belirler: `windows`/`focus`, sonra `elements`, öğeler yetmezse `screenshot`, ayrıntı için
   `zoom`. Tam metin
   [`instructions.py`](src/computer_use_windows/instructions.py) içindedir.
2. **Kestirme araç yok.** Sunucuda kabuk, dosya, kayıt defteri veya süreç başlatma aracı yoktur;
   böylece ajan, kabuğunun daha iyi yaptığı işler için GUI otomasyonunu kullanamaz.
3. **Terminallere klavye girdisi yok.** Ajanın kendi terminali veya editörü genellikle ön plandaki
   penceredir. Oraya yazmak metni ajanın kendisine enjekte ederdi. Bu yüzden ön plandaki pencere
   aşağıdakilerden biri olduğunda `type_text` ve `key` reddedilir:
   - **Ajanın kendi ana ortamı (host):** ajanın içinde çalıştığı terminal veya editör; örneğin ajan
     VS Code'un entegre terminalinde çalışıyorsa VS Code. Sunucu bunu kendi üst süreç zincirinde
     yukarı çıkarak bulur.
   - **Bir konsol penceresi;** pencere sınıfına göre tespit edilir (`ConsoleWindowClass`,
     `CASCADIA_HOSTING_WINDOW_CLASS`, `PseudoConsoleWindow`, `mintty`, `VirtualConsoleClass`).
   - **Özel bir terminal uygulaması:** `windowsterminal.exe`, `openconsole.exe`, `wezterm-gui.exe`,
     `alacritty.exe`, `mintty.exe`, `kitty.exe`, `hyper.exe`, `tabby.exe`, `conemu.exe`,
     `conemu64.exe`.

   Bir betiğin gösterdiği GUI penceresi (örneğin PowerShell'den açılan bir WinForms iletişim
   kutusu) terminal sayılmaz. Hata mesajı ajana kabuğunu kullanmasını ya da önce hedef pencereye
   `focus` yapmasını söyler. `--allow-terminal-input` bu korumayı kapatır.
4. **Otomatik ekran görüntüsü yok.** Eylemler, ön plandaki pencereyi adlandıran tek satır döndürür.
   Ajan sonuçları `elements` ile kontrol eder ve yalnızca metin yetmediğinde ekran görüntüsü alır.

## Araçlar

`x,y`, **son ekran görüntüsündeki** piksellerdir; `element` ise **son `elements` çağrısından** gelen
bir id'dir. Ajan hiç ekran görüntüsü almadan `x,y` verirse, önce bir ekran görüntüsü alması ya da
öğe id'lerini kullanması gerektiğini söyleyen bir hata alır.

| Tool | Parameters | What it does |
|---|---|---|
| `screenshot` | `monitor?` | Bir monitörün görüntüsünü alır ve boyut sınırına göre küçültür. Görüntüyle birlikte tek satır döndürür: monitör, boyut, ölçek, tahmini token, ön plandaki pencere. |
| `zoom` | `x0, y0, x1, y1` | Son ekran görüntüsünün bir bölgesini yerel çözünürlükte yeniden yakalar; küçük yazılar içindir. Koordinatlar ekran görüntüsü uzayında kalır. |
| `elements` | `query?, window?` | Ön plandaki ya da verilen pencerenin UI Automation öğelerini metin olarak listeler: id, rol, ad, değer, merkez. Parola değerlerini asla göstermez. Tarama yarıda kesildiyse listenin eksik olduğunu bildirir. Engelli uygulamada reddedilir; engelleme listesi varken başka pencerelerin listesi de o uygulamanın pencerelerini ve pencere başlıklarını göstermez (aşağıda Engelleme listesi). |
| `windows` | yok | Görünür üst düzey pencereleri listeler: handle, süreç, başlık, `[foreground]`/`[minimized]`. Engelli uygulamanın başlıkları gizlenir. |
| `focus` | `window` | Bir pencere simge durumundaysa handle ile geri yükler ve öne getirir. Yanıt vermeyen pencere reddedilir. |
| `click` | `x, y` veya `element`; `button, clicks, modifiers?` | Sol, sağ veya orta tıklama, 1–3 tıklama; isteğe bağlı olarak `ctrl`/`alt`/`shift`/`win` basılı tutularak. Terminal ya da ajanın kendi penceresi üzerinde sağ ve orta tık reddedilir (yapıştırma yapar). |
| `type_text` | `text` | Klavye düzeninden bağımsız Unicode metin yazar (`\n` = Enter, `\t` = Tab). Hedefi (parola alanı, terminal, engelli uygulama) ilk karakterden sonra, her Tab/Enter'dan sonra ve her 50 karakterde yeniden denetler. Yazma sırasında ön pencere değişirse yeni pencere ilk pencere gibi denetlenir ve geçerse yazma sürer; Enter'dan sonraki değişimde metin durur. Hata kaç karakterin yazıldığını söyler. |
| `key` | `keys, repeat` | Tuşlara ve kısayollara basar: `ctrl+s`, `alt+f4`, `tab tab enter`. 1–100 kez tekrarlar; çağrı başına en çok 200 tuş basışı. Odak parola alanındayken yalnız gezinme tuşları ve kısayollar çalışır; karakter üreten akortlar reddedilir. |
| `scroll` | `direction, amount, x?, y?` | Tekerleği yukarı, aşağı, sola veya sağa 1–50 adım çevirir; bir noktada ya da imleçte. |
| `drag` | `x0, y0, x1, y1` | Sol düğmeyi basılı tutarak bir noktadan diğerine sürükler (kaydırıcılar, seçimler, öğe taşıma). Uçlardan biri terminal ya da ajanın kendi penceresi üzerindeyse reddedilir. |
| `move` | `x, y` | İşaretçiyi tıklamadan taşır; üzerine gelince açılan menüler ve araç ipuçları için. |
| `wait` | `seconds` | Arayüzün oturması için en fazla 10 sn bekler. |

## Token maliyeti

Bilgisayar kullanımında asıl maliyet görüntülerdir. Claude bir görüntüyü
`⌈width / 28⌉ × ⌈height / 28⌉` görsel token olarak sayar. Her modelin ayrıca bir boyut sınırı vardır:
Claude 4.7 ve sonrası uzun kenarda 2.576 px ve 4.784 token'a izin verir; diğer modeller 1.568 px ve
1.568 token'a izin verir
([Anthropic vision dokümanları](https://platform.claude.com/docs/en/build-with-claude/vision)). API,
daha büyük bir görüntüyü küçültür; Claude da küçültülmüş görüntünün koordinatlarıyla yanıt verir ve
tıklamalar yanlış yere düşer.

Bunu önlemek için sunucu, her `screenshot` ve `zoom` görüntüsünü hem `--max-size` (uzun kenar,
varsayılan 1280 px) hem de `--max-image-tokens` (varsayılan 1.568) sınırına sığana kadar küçültür.
Varsayılanlar her Claude modeline uyar. Her sonuç satırındaki `~N tokens` aynı formülü kullanır.

| What the agent gets | Settings | Image sent | ≈ tokens |
|---|---|---|---|
| 1920×1080, 2560×1440 veya 3840×2160 bir monitörün `screenshot`'ı | varsayılanlar | 1280×720 | 1.196 |
| 1920×1200 bir monitörün `screenshot`'ı | varsayılanlar | 1280×800 | 1.334 |
| 1280×1024 bir monitörün `screenshot`'ı | varsayılanlar (token bütçesi devreye girer) | 1225×980 | 1.540 |
| 1920×1080 bir monitörün `screenshot`'ı | `--max-size 1024` | 1024×576 | 777 |
| 2560×1440 bir monitörün `screenshot`'ı, yalnızca Claude 4.7+ | `--max-size 2576 --max-image-tokens 4784` | 2560×1440 | 4.784 |
| 600×400 kırpma döndüren `zoom` | varsayılanlar | 600×400 | 330 |
| `elements`, `windows`, her eylem | | yalnızca metin | görüntü token'ı yok |

Karşılaştırma için, Claude 4.7+ üzerinde tam 1920×1080 bir görüntü 2.691 token, tam 2560×1440 bir
görüntü ise 4.784 token tutar. Dolayısıyla varsayılan bir ekran görüntüsü, tam 1080p ekrana göre
yaklaşık %56, tam 1440p ekrana göre yaklaşık %75 daha ucuzdur.

**Daha net ekran görüntüleri.** Claude 4.7+ modeli kullanıyorsanız `--max-size` değerini 2576'ya,
`--max-image-tokens` değerini 4784'e kadar yükseltebilirsiniz. Ekran görüntüleri netleşir ve her biri
daha pahalıya gelir. Diğer modellerde `--max-size` değerini 1568 veya altında, token bütçesini
varsayılanında tutun.

Bu rakamlarla ilgili bazı notlar:

- Metin yine sıradan metin token'ı harcar. Uzun bir `elements` listesi birikebilir; bu yüzden liste
  sınırlıdır (`--max-elements`, varsayılan 80) ve `query` listeyi daraltır.
- `--format jpeg` yük boyutunu küçültür ama token sayısını değiştirmez. Token sayısı yalnızca piksel
  boyutuna bağlıdır.
- Diğer model sağlayıcıları görüntü token'larını farklı sayar.

## Yapılandırma

Her seçenek bir komut satırı bayrağıyla ya da bir ortam değişkeniyle ayarlanabilir. Öncelik sırası
CLI, sonra ortam değişkeni, sonra varsayılanlardır. Komut satırında verilen bir `--block`,
`CUW_BLOCK`'u tamamen değiştirir. Geçersiz değerler, bayrağın veya değişkenin adını belirten bir
hatayla reddedilir.

| Flag | Environment variable | Default | Meaning |
|---|---|---|---|
| `--max-size N` | `CUW_MAX_SIZE` | `1280` | `screenshot` ve `zoom` görüntüleri için uzun kenar sınırı, 256–2576 px (API'nin uzun kenar sınırı). Sunucu asla büyütmez. |
| `--max-image-tokens N` | `CUW_MAX_IMAGE_TOKENS` | `1568` | `screenshot`/`zoom` görüntüsü başına token bütçesi, 100–4784. Görüntüler sığana kadar küçültülür; böylece API onları yeniden boyutlandırmaz ([Token maliyeti](#token-maliyeti) bölümüne bakın). |
| `--format png\|jpeg` | `CUW_FORMAT` | `png` | Görüntü biçimi |
| `--jpeg-quality N` | `CUW_JPEG_QUALITY` | `80` | JPEG kalitesi, 1–95 |
| `--monitor N` | `CUW_MONITOR` | primary | `screenshot` için varsayılan monitör (1'den başlar) |
| `--max-elements N` | `CUW_MAX_ELEMENTS` | `80` | `elements`'in döndürdüğü en fazla satır, 1–500 |
| `--block NAME` | `CUW_BLOCK` | none | Ajanın kullanmaması gereken süreçler: pencerelerine girdi, `focus` ve `elements` reddedilir; başka pencerelerdeki `elements` onların pencerelerini atlar ve pencere başlıklarını tekrarlayan metinleri gizler; `windows` ve sonuç satırları pencere başlıklarını gizler. Ekran görüntülerinde yine görünürler. Bayrak tekrarlanabilir ve virgülle de kabul eder (`--block keepass.exe,1password`); değişken virgülle ayrılmış bir liste alır. Eşleşmede büyük/küçük harf yok sayılır ve `.exe` isteğe bağlıdır. |
| `--no-failsafe` | `CUW_FAILSAFE` | on | Ekran köşesi failsafe'ini kapatır. `0`/`false`/`no`/`off` kapatır. |
| `--allow-terminal-input` | `CUW_ALLOW_TERMINAL_INPUT` | off | Bir terminal önde olduğunda `type_text`/`key` kullanımına izin verir; terminalde sağ/orta tık ve sürüklemeye de izin verir. `1`/`true`/`yes`/`on` etkinleştirir. |
| `--version` | | | Sürümü yazdırıp çıkar |

## Güvenlik ve gizlilik

**Sunucunun yaptıkları:**

- **Ağ yok, telemetri yok.** Sunucu hiçbir ağ bağlantısı açmaz. Ekran görüntüleri ve metin yalnızca
  stdio üzerinden MCP istemcinize gider. İstemciniz bunları, oturumunuzun geri kalanı gibi model
  sağlayıcınıza gönderir.
- **Parola alanları.** Odaktaki öğe kendini parola alanı olarak bildirdiğinde (UI Automation
  `IsPassword`) `type_text` reddedilir; `key` ile karakter üreten akortlar da reddedilir (gezinme
  tuşları ve kısayollar çalışır). Parola denetimi yapılamazsa (UI Automation yanıt vermezse) bir
  yeniden denemeden sonra yazma reddedilir. `elements` bir parola alanının değerini asla göstermez.
  Ajana, parolayı sizin yazmanızı istemesi söylenir.
- **Terminaller.** Terminal pencerelerine ve ajanın içinde çalıştığı terminale veya editöre klavye
  girdisi reddedilir ([“Önce terminal” nasıl işler](#önce-terminal-nasıl-işler) bölümüne bakın).
  Denetim, nokta/odak altındaki pencerenin kök ve kök-sahip penceresine (ve başka sürece ait gömülü
  alt pencereye) bakar. Explorer gibi başlatıcılar ajanın barındırıcısı sayılmaz.
  Yazma sırasında ön pencere değişirse yeni pencere ilk pencere gibi denetlenir (terminal, engelli
  uygulama, ajanın kendi barındırıcısı, parola alanı) ve geçerse yazma sürer. Enter'dan sonraki
  değişimde metin durur, çünkü Enter penceresi henüz açılmamış bir programı başlatmış olabilir.
- **Ön plan penceresi yokken** klavye girdisi reddedilir.
- **Engelleme listesi.** `--block keepass.exe`, ajanın o uygulamayı kullanmasını engeller. Ona
  girdi reddedilir: işaretçi eylemlerinde sunucu hedef noktanın altındaki pencereye,
  `type_text`/`key` için ön plandaki pencereye bakar. Pencerelerinde `focus` ve `elements`
  reddedilir (engelleme listesi varken `elements` bir ön plan penceresi ya da handle ister ve
  ağacında her uygulamanın penceresi bulunan masaüstü penceresini reddeder). Başka bir pencerede
  `elements`, içindeki engelli uygulama pencerelerini (ör. başka bir uygulamaya gömülü olanı) atlar;
  adı ya da değeri engelli uygulamanın görünür bir penceresinin başlığını içeren her öğe için
  `(text hidden: blocked app)` gösterir: görev çubuğu düğmesi, Alt-Tab ya da Görev Görünümü girdisi
  veya Görev Yöneticisi satırı başlığı böyle tekrarlar. Bu bir metin eşleşmesidir: başka bir
  uygulamanın kısalttığı ya da değiştirdiği başlık yakalanmaz ve başka uygulamalar engelli
  uygulamanın içeriğini kendi sözleriyle yine gösterebilir. `windows` ve sonuç satırları başlıkları
  yerine `(title hidden: blocked app)` gösterir. Her denetim pencerenin kök ve kök-sahip
  penceresine bakar; işaretçi denetimleri başka sürece ait gömülü alt pencereye de bakar. Engelli
  uygulamanın görev çubuğu düğmesine tıklamak reddedilmez (tık görev çubuğuna düşer), ama öne
  getirdiği pencereye girdi reddedilir. Ajana, bu adımı sizin yapmanızı istemesi söylenir. Ekran
  görüntüleri süzülmez (aşağıya bakın) ve liste siz ayarlayana dek boştur.
- **Failsafe.** Farenizi herhangi bir monitörün herhangi bir köşesine götürün. Bundan sonra her eylem
  reddedilir ve ajana durup size sorması söylenir. Fareyi köşeden uzaklaştırdığınızda eylemler yeniden
  çalışır. Ajan fareyi köşeden kendi başına çıkaramaz, çünkü `move` da reddedilir. Ajanın işaretçiyi
  götürdüğü bir köşe sayılmaz; bu muafiyet imleç başka yerde görülene kadar sürer. Denetim uzun
  girdi boyunca da yapılır: yazma partileri, akortlar, kaydırma ve sürükleme adımları arasında.

**Sizi neye karşı koruyamaz:**

- Araçlar **gerçek** fareyi ve klavyeyi kontrol eder. Ajan çalışırken bilgisayarı kullanmayın ve ne
  yaptığını izleyin.
- Ekrandaki her şey modelin girdisi olur; ajanı yönlendirmek için yazılmış metinler de dahil
  (prompt injection). Hassas pencereleri kapatın veya simge durumuna küçültün. Engelleme listesi
  girdiyi ve öğe okumayı durdurur, ama engelli pencereler `screenshot` ve `zoom` görüntülerinde yine
  görünür ve başlıklarının başka bir uygulamadaki kısaltılmış ya da değiştirilmiş hali `elements`'te
  yine çıkabilir.
- **Claude Code'un izin kurallarının dışında program çalıştırabilir.** Klavye ve fareyle
  başlatabildiğiniz her şeyi ajan da başlatabilir: Win+R, Başlat menüsü araması, Görev Yöneticisi'nin
  "Yeni görev çalıştır"ı ya da herhangi bir dosya penceresinin adres çubuğu `cmd`'yi, PowerShell'i ya
  da başka bir programı başlatabilir. Claude Code'un Bash izin/yasak kuralları ve sandbox'ı buna
  uygulanmaz. Terminal koruması yalnızca terminal pencerelerine yazmayı reddeder; engelleme listesi
  de bu yolu kapatamaz, çünkü neredeyse her uygulamanın bir dosya penceresi vardır. Önündeki tek engel,
  Claude Code'un her `click`, `type_text` ve `key` çağrısından önce sormasıdır.
- **Varsayılan engelleme listesi yok.** `--block` ayarlayana dek ajan parola yöneticiniz dahil her
  uygulamayı kullanabilir.

### Önerilen kurulum

- **Ajanın asla kullanmaması gereken uygulamaları engelleyin**: parola yöneticileri (`keepass.exe`,
  `keepassxc.exe`, `1password.exe`, `bitwarden.exe`), doğrulayıcı (authenticator), banka ve kripto
  cüzdanı uygulamaları, uzak erişim araçları (`mstsc.exe`, `anydesk.exe`, `teamviewer.exe`). Eşleşme
  süreç adıyladır; Görev Yöneticisi'nin Ayrıntılar sekmesi gösterir. Bir tarayıcıyı engellemek tüm
  pencerelerini engeller; site bazında engelleme yoktur. eren-kit yükleyicisinden sonra sunucuyu
  listeyle yeniden kaydedin:

  ```powershell
  claude mcp remove computer-use-windows -s user
  claude mcp add computer-use-windows -s user -- "<eren-kit>\packages\computer-use-windows\.venv\Scripts\computer-use-windows.exe" --block keepass.exe,keepassxc.exe,1password.exe,bitwarden.exe
  ```

  Yükleyiciyi yeniden çalıştırdıktan sonra seçeneklerinizin durduğunu
  `claude mcp get computer-use-windows` ile denetleyin.
- **Eylemler için onay istemini koruyun.** `click`, `type_text`, `key`, `drag` ya da `focus`'a
  otomatik izin vermeyin; bir `type_text` ya da `key` çağrısını onaylamadan önce ne yazacağını okuyun.
- **Şu durumlarda kullanmayın:** gözetimsizken, hassas pencereler açıkken ya da kilidi açıkken, ya
  da güvenlik sınırınızın Claude Code'un Bash izin kuralları veya sandbox'ı olduğu oturumlarda
  (örneğin güvenmediğiniz kod üzerinde çalışırken). Sunucuyu yalnızca gereken yerde kaydedin
  (`-s user` yerine `-s local`) ya da işiniz bitince kaldırın.

**Claude Code için ipucu:** Claude Code, aracı izinli yapmadığınız sürece her MCP aracı çağrısından
önce sorar. Orta yol, `settings.json` içinde yalnızca salt okunur araçlara otomatik izin vermek;
tıklayan ya da yazan her şey için onay istemini korumaktır:

```json
{
  "permissions": {
    "allow": [
      "mcp__computer-use-windows__screenshot",
      "mcp__computer-use-windows__zoom",
      "mcp__computer-use-windows__elements",
      "mcp__computer-use-windows__windows"
    ]
  }
}
```

## Sınırlamalar

- **Yalnızca Windows.** Diğer sistemlerde sunucu bir mesaj yazdırır ve 2 koduyla çıkar. Windows 11'de
  geliştirildi; Windows 10'dan gelen geri bildirimler memnuniyetle karşılanır.
- **Yönetici olarak çalışan uygulamalar.** Yükseltilmemiş (non-elevated) bir süreç, yükseltilmiş bir
  pencereye girdi gönderemez (User Interface Privilege Isolation). Terminalinizi yönetici olarak
  çalıştırmak bunu aşar, ancak o zaman ajan da yönetici haklarıyla çalışır.
- **UAC istemleri ve kilit ekranı** güvenli masaüstünde çalışır; bu sunucu orayı kontrol edemez.
- **DRM korumalı içerik** (bazı video oynatıcılar ve yayın uygulamaları) ekran görüntülerinde siyah
  görünebilir.
- **Bazı oyunlar** enjekte edilen girdiyi yok sayar ve çoğu UI Automation öğesi sunmaz.
- **`elements` uygulamaya bağlıdır.** Standart Windows denetimleri iyi tanımlanır. Özel çizilmiş
  arayüzler ve canvas'lar az sayıda öğe sunabilir ya da hiç sunmayabilir; bu durumda ajan
  `screenshot`'a döner. Çok büyük ağaçlarda (tarayıcılar, Gezgin) `elements` yaklaşık 2 saniye sonra
  durur ve bulduklarını döndürür; daraltmak için `query` kullanın. Tarama kesilirse liste eksik
  olduğu bildirilir.
- **Öğe id'leri** pencereleri kapandıysa, küçültüldüyse, taşındıysa ya da yeniden boyutlandıysa veya
  noktayı başka bir ana pencere örtüyorsa (başka bir uygulamanın penceresi ya da aynı uygulamanın
  listelenen ikinci penceresi) reddedilir. Aynı uygulamanın menüsü, açılır listesi ya da ipucu
  öğenin üstündeyse sorun değildir. Pencere içinde kaydırma pencere dikdörtgenini değiştirmez ve fark edilmez;
  kaydırdıktan sonra `elements`'i yeniden çağırın.
- **Odak değişimi denetimi sınırlıdır.** Tab/Enter'dan sonraki kısa bekleme süresinden geç
  gerçekleşen odak değişimi yakalanmaz (ör. yavaş yüklenen iki adımlı giriş sayfası). Parola alanına
  ctrl+v / shift+insert ile yapıştırma engellenmez.
- UI Automation ilk karakterden sonra yanıt vermezse yalnız o karakter yazılır, kalanı reddedilir.
- **Çok satırlı yazma daha yavaştır** (Enter başına yaklaşık 0,1 sn).
- **Parola tespiti**, uygulamanın alanı parola alanı olarak işaretlemesine dayanır. Bunu bildirmeyen
  bir alan tespit edilmez.
- **Terminal koruması her terminali tanıyamaz.** Ajanın kendi ana ortamını, konsol pencerelerini ve
  listelenen terminal uygulamalarını yakalar. Başka bir uygulamaya gömülü bir terminal tespit
  edilmez; örneğin ajanın içinde çalışmadığı bir editörün entegre terminali.
- **Koordinatlar eskir.** Koordinatlar son ekran görüntüsüne, öğe id'leri son `elements` çağrısına
  aittir. Ekran değişirse ajan yeniden bakmalıdır.

## Sorun giderme

- **`uvx` tanınmıyor.** uv'yi kurduktan sonra yeni bir terminal açın.
- **Sunucu ilk başlatmada bağlanmıyor.** İlk çalıştırma bağımlılıkları indirir. [2. adımı](#2-çalıştığını-kontrol-edin-isteğe-bağlı)
  bir kez çalıştırın, sonra istemcinizi yeniden başlatın.
- **"The foreground window is a terminal" veya "…the terminal or editor running you".** Bu beklenen
  davranıştır: ajan önce hedef pencereye `focus` yapmalıdır. Bir terminalde gerçekten klavye girdisi
  istiyorsanız sunucuyu `--allow-terminal-input` ile başlatın.
- **"The user moved the mouse to a screen corner".** Fareniz bir ekran köşesinde (failsafe). Köşeden
  uzaklaştırın.
- **Tıklamalar yanlış yere düşüyor.** Ekran, son ekran görüntüsünden beri değişti. Ajandan yeni bir
  ekran görüntüsü almasını isteyin ya da öğe id'lerini kullanın.

## Geliştirme

```powershell
git clone https://github.com/SelmanBoray/eren-kit
cd eren-kit\packages\computer-use-windows
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m pytest                   # unit tests: never move the mouse or press keys
.venv\Scripts\python -m pytest -m integration    # opens a test window and takes over mouse and keyboard
.venv\Scripts\python -m ruff check .
```

Birim testleri salt okunur ekran görüntüleri alabilir ve mevcut pencerelerin UI Automation ağacını
okuyabilir. Entegrasyon testleri küçük bir WinForms penceresi (`CUW Test Form`) açar ve onu gerçek
fareniz ve klavyenizle sürer. Testler bitene kadar ikisine de dokunmayın.

Yerel kopyanızı Claude Code'da denemek için:

```powershell
claude mcp add cuw-dev -- C:\path\to\computer-use-windows\.venv\Scripts\python.exe -m computer_use_windows
```

`src/computer_use_windows/` dizininin yapısı:

| Module | Role |
|---|---|
| `server.py` | MCP sunucusu, 12 araç, her eylemden önce güvenlik kontrolleri |
| `config.py` | CLI bayrakları ve ortam değişkenleri |
| `screen.py` | DPI farkındalığı, monitörler, yakalama, küçültme, koordinat eşleme |
| `input.py` | `SendInput` ile fare ve klavye |
| `uia.py` | Pencereler, UI Automation öğeleri, sunucunun üst süreç zinciri |
| `safety.py` | Failsafe, engelleme listesi, terminal ve parola korumaları |
| `instructions.py` | Ajana gösterilen sunucu talimatları ve araç açıklamaları |

## Katkıda bulunma

Issue'lar ve pull request'ler memnuniyetle karşılanır. [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına
bakın.

Bu proje terminalden çıkma zahmetinden sizi kurtarıyorsa, bir yıldız başkalarının da onu bulmasına
yardımcı olur.

## Lisans

[MIT](LICENSE) © 2026 SelmanBoray

Anthropic ile bağlantılı değildir, Anthropic tarafından onaylanmamıştır.
