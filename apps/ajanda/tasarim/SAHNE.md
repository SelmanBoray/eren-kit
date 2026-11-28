# Sahne: Android tasarım belgesi

Ajanda uygulamasının arayüzü "Sahne" yönünde Jetpack Compose ile yazılır. Bu belge o işin **tek tasarım
kaynağıdır**. Prototip bir yön seçme aracıydı; bu belge onun Compose'da, gerçek telefonda ve parmakla iyi
çalışan hâlini tarif eder. Ürün kararları `../YOL-HARITASI.md` "4A. Arayüz: Sahne yönü" ve "4.3 Takvim"
bölümlerindedir; burada yalnız görünüm ve davranış var.

## 0. Nasıl okunur

**Kaynaklar.** Her sayının yanında prototipteki yeri yazılıdır: `css:44` = `parca/30-sahne.css` satır 44,
`js:178` = `parca/70-sahne.js` satır 178, `ortak:16` = `parca/50-ortak.js`, `kabuk:20` =
`parca/10-kabuk.css`, `koyu:6` = `parca/11-koyu.css`. Birleşik dosya `ajanda-yonler.html` bu parçalardan
`test/yap.mjs` ile üretilir (çıktı aynıdır; 2026-11-27'de karşılaştırıldı); satır numaraları parçalara göredir.

**İşaretler.**

- **[P]** prototipten ölçüldü, olduğu gibi taşınır.
- **[A]** Android'de değişir; gerekçesi yanında.
- **[Ö]** prototipte yok, bu belgenin önerisi. Uygulayan agent değiştirebilir ama değiştirdiğini yazmalı.

**Birimler.** CSS `px` → Compose `dp`; yazı boyutu `px` → `sp`. Prototip 390 px genişlikte bir telefon
çerçevesinde sınandı (`test/s1-gorunum.mjs`, `boyut(390, 844)`); bu yüzden 1 px = 1 dp alınır.

**Dosyalar.**

| Yol | Ne |
|---|---|
| `ajanda-yonler.html` | Birleşik prototip (üç yön). Tarayıcıda açılır; `#sahne` ile Sahne açılır. |
| `parca/` | Prototipin kaynak parçaları. Sahne: `30-sahne.css`, `70-sahne.js`; ortak: `10-kabuk.css`, `11-koyu.css`, `50-ortak.js`. |
| `cizim/*.svg` | On çizim, ayrı dosyalar (bkz. §7). |
| `goruntu/*.png` | Temsilî ekran görüntüleri (390 dp genişlik, prototip kabuğu kırpılmış). |
| `test/` | Birleştirme (`yap.mjs`) ve başsız Chrome ile sınama betikleri (Node 22+, Chrome; yol `CHROME` ortam değişkeniyle verilebilir). Önce `node test/yap.mjs` çalışır, `test/onizleme.html`'yi üretir; çıktılar `.gitignore`'da. |
| `LISANSLAR.md` | Yazı tiplerinin lisansı ve kaynağı. |

**Ekran görüntüleri.** `goruntu/1-bugun-acik.png`, `2-bugun-koyu.png`, `3-taslak-bitenler.png`,
`4-ayrinti.png`, `5-yeni-kayit.png`, `6-takvim.png`; öteki yönlerden alınacaklar için `7-cetvel-mezura.png`
ve `8-tabela-pano.png`.

## 1. Renk

### 1.1 Yüzey belirteçleri

Galeri duvarı fikri: yüzey nötrdür, rengi levhalar taşır. Açık değerler `kabuk:16-18`, koyu değerler
`koyu:4-5`. Koyu tema sistem ayarına uyar; prototipte elle geçiş düğmesi de vardı (`90-baslat.js:64`),
uygulamada **[Ö]** sistem ayarı yeterli, uygulama içi seçim sonraya kalır.

| Belirteç (CSS) | Açık | Koyu | Görevi |
|---|---|---|---|
| `--s-bg` | `#FFFFFF` | `#0E0E11` | Ekran zemini; ayrıntı ve takvim zemini; ayrıntı kapatma düğmesinin zemini. |
| `--s-yuz` | `#F1F1F3` | `#1C1C21` | İkincil yüzey: tarihsiz satırlar, biten hap'ları, takvim ok düğmeleri, bağlantı kartları, hatırlatma hap'ları. |
| `--s-ink` | `#14151A` | `#F5F3EE` | Ana yazı; alt çubuk zemini; tost zemini; "Onayla" dolgusu; karakalem çizgisi; birincil düğme ("Bitti"). |
| `--s-soft` | `#676A74` | `#9C9EA8` | İkincil yazı (tarih, alt başlık, bölüm başlıkları); taslak levhanın kesikli çerçevesi; ay dışı günler. |
| `--s-line` | `#E2E3E7` | `#2B2C33` | Bağlantı kartındaki küçük resmin zemini (`js:10-11`). Ayırıcı çizgi olarak kullanılmıyor. |
| `--s-vurgu` | `#FFC83D` | `#FFC83D` | Tek vurgu: alt çubuktaki artı düğmesi. |
| `--s-vurgu-ust` | `#1A1505` | `#1A1505` | Vurgu üstündeki simge. |
| `--s-perde` | `rgba(20,21,26,.5)` | `rgba(0,0,0,.6)` | Tanımlı ama Sahne'de kullanılmıyor **[P]**. Alt sayfa (bottom sheet) gerekirse perde budur. |
| `--foto-ust` | `#FFFFFF` | (aynı) | Fotoğraf kapaklı levhada yazı rengi (`css:68`). |
| `--foto-perde` | `rgba(8,9,12,.62)` | (aynı) | Fotoğraf kapaklı levhada alttan yükselen karartma; levhanın alt %60'ı, saydamdan bu renge (`css:70`). |
| `--isik-bg` / `--isik-fg` | `#0A0B0C` / `#F4F4F2` | (aynı) | Fotoğraf büyütme ekranı (`kabuk:33`, `kabuk:94`). |

Yerel takma adlar (`css:2`): odak halkası `--odak = s-ink`; tost zemini `--tb = s-ink`, tost yazısı
`--tf = s-bg`, tost köşesi `--tr = 999px` (tam yuvarlak).

### 1.2 Levha takımları

Her kaydın bir rengi vardır; renk beş rolden oluşan bir takımdır (`kabuk:19-27`). Levhanın zemini `b`,
çizimin ana gövdesi `f`, çizimin koyu ve açık ayrıntıları `d` ve `l`, levha üstündeki yazı `i`.
Koyu temada **yalnız `b` değişir** (`koyu:6-7`); `f`, `d`, `l`, `i` iki temada aynıdır **[P]**.

| Takım | `b` açık | `b` koyu | `f` figür | `d` koyu ayrıntı | `l` açık ayrıntı | `i` yazı |
|---|---|---|---|---|---|---|
| kobalt | `#2B50E0` | `#2747CC` | `#FFC83D` | `#0F1E5E` | `#DDE7FF` | `#FFFFFF` |
| cam | `#0F6B4F` | `#0D5F46` | `#F7B8C6` | `#06382A` | `#F6F1E3` | `#FFFFFF` |
| hardal | `#F2B632` | `#E3A822` | `#D8432B` | `#3B2A05` | `#FFF4D2` | `#201703` |
| pembe | `#F4A9BC` | `#E79AAE` | `#FFFFFF` | `#5C1730` | `#FFE3EA` | `#3A0B1A` |
| domates | `#C93A22` | `#B93520` | `#F3D3A0` | `#5B140A` | `#FFE8D6` | `#FFFFFF` |
| gok | `#BFE3EC` | `#A9D3DD` | `#1A8494` | `#0B3A42` | `#FFFFFF` | `#0B2A30` |
| kum | `#E4DFD2` | `#D2CCBD` | `#2B50E0` | `#2A2618` | `#FFFFFF` | `#1C1A14` |
| gece | `#1E2A3A` | `#243347` | `#F2B632` | `#0B121C` | `#C9D6E8` | `#FFFFFF` |

Rollerin başka yerlerde kullanımı:

- **`b`**: levha zemini; ayrıntı kapağının zemini; yeni kayıt ekranının zemini; varış kartı; tarihsiz
  satırdaki küçük resim kutusu; biten hap'ındaki daire; takvimde günün noktası ve seçili gün lekesi.
- **`i`**: levha yazısı, levhadaki tamamlama dairesinin çerçevesi (`currentColor`); yeni kayıt
  ekranında yazı, çerçeveler ve seçili seçeneğin dolgusu (`css:180`, `css:188`).
- **`l`**: bitirirken levhanın üstünden geçen "yıkama" bandı (`css:65`); köpükler.
- Takvim noktasında iki istisna (`css:119-120`): **kum** noktası `s-soft`, **gece** noktası `gece-f`
  ile boyanır (kum beyaz zeminde, gece koyu zeminde görünmediği için).

**Kaydın rengi nereden gelir.** Başlıktan önerilir; aynı tablo çizimi de seçer (bkz. §7.1). Kullanıcı ya
da asistan değiştirebilir (`YOL-HARITASI.md` 4A). Eşleşme yoksa **kum + yildiz** (`ortak:116`).

### 1.3 Compose'a aktarım

- **[Ö]** Material 3 `ColorScheme` yalnız sistem bileşenleri (metin seçimi, kaydırma çubuğu, iletişim
  kutuları) için doldurulur: `background = surface = s-bg`, `surfaceVariant = s-yuz`, `onBackground =
  onSurface = s-ink`, `onSurfaceVariant = s-soft`, `primary = s-ink`, `onPrimary = s-bg`,
  `tertiary = s-vurgu`, `onTertiary = s-vurgu-ust`, `outline = s-soft`, `outlineVariant = s-line`.
- **[Ö]** Sahne'ye özgü değerler ayrı bir `SahneRenkleri` (yüzey belirteçleri) ve `LevhaTakimi(b, f, d, l, i)`
  sınıfıyla `CompositionLocal` üzerinden verilir. Levha takımı, kaydın renk anahtarından (`"kobalt"` …)
  çözülür; koyu temada yalnız `b` değiştirilir.
- **[A]** Android 12+ dinamik renk (Material You) **kullanılmaz**; levha renkleri kaydın anlamını taşır.
- **[A]** Sistem çubukları: durum çubuğu ve gezinme çubuğu kenardan kenara (edge-to-edge), zemin `s-bg`;
  ayrıntı ve yeni kayıt ekranında üst kenar renkli kapakla dolduğu için durum çubuğu simgeleri o anki
  takımın `i` rengine göre açık/koyu seçilir.

## 2. Yazı

### 2.1 Yazı tipi

- Sahne'nin tek yazı tipi **Bricolage Grotesque** (`kabuk:6`, `css:2`); yedekleri `"Trebuchet MS",
  system-ui`. Lisans ve kaynak: `LISANSLAR.md`.
- **[A]** Değişken dosya gömülür (`res/font/`); `minSdk 26` olduğu için `Font(R.font.x,
  variationSettings = FontVariation.Settings(FontVariation.weight(w), FontVariation.Setting("opsz", o)))`
  kullanılabilir. Ara ağırlıklar (550, 650) prototipte gerçekten kullanılıyor; değişken dosya bunları verir.
- **Optik boy (opsz, 12–96).** Tarayıcı `font-optical-sizing:auto` ile opsz'u yazı boyuna eşitler
  (CSS'te ayrı bir ayar yok, varsayılan davranış). **[A]** Compose'da bu otomatik değildir; her yazı
  stilinin `FontFamily`'si, o stilin **taban** boyuna eşit opsz ile kurulur (kullanıcının yazı ölçeği
  opsz'u değiştirmez). Pratikte üç kova yeter **[Ö]**: opsz 14 (≤16 sp), 20 (17–24 sp), 40 (≥28 sp).
  Not: Android'deki ilk `SahneYazi.kt` büyük başlıklarda opsz 96 kullanıyor; prototipte 39–52 px
  başlıklar opsz ≈ 39–52 ile çizildi. 96 daha sıkı ve ince ayrıntılı bir kesim verir; prototipteki
  görünüm için 40 öneriyorum, karar ekranda karşılaştırılarak verilir.
- **wdth** ekseni (75–100) prototipte kullanılmıyor; 100'de kalır.
- `text-wrap:balance` (`css:39`, `css:142`) → **[A]** `TextStyle(lineBreak = LineBreak.Heading)`.
- Saat gösteren yazılarda (levha alt yazısı, mezura okuması) eşit genişlikli rakam istenir: **[Ö]**
  `fontFeatureSettings = "tnum"`. Bricolage Grotesque'in `tnum` desteği doğrulanmadı; yoksa okuma
  kutusuna sabit genişlik verilir.
- Satır yüksekliği belirtilmeyen yerlerde prototip 1.4 kullanır (`kabuk:39`'dan miras).

### 2.2 Ölçek

Ağırlıklar: 400 normal, 500 orta, 550, 600 yarı kalın, 650, 700 kalın, 800 (yalnız takvimde bugün).
Harf aralığı `em` cinsindendir; Compose'da da `.em` ile verilir.

| Ad [Ö] | Boy (sp) | Satır | Ağırlık | Harf aralığı | Nerede | Kaynak |
|---|---|---|---|---|---|---|
| `ayBasligi` | 52 | 0.9 | 700 | −0.035 em | Takvimde ay adı | `css:106` |
| `gunBasligi` | 39 | 1.0 | 700 | −0.03 em | Bugün ekranının "Sırada … var." cümlesi | `css:39` |
| `ayrintiBasligi` | 38 | 1.0 | 700 | −0.03 em | Ayrıntıda kaydın adı | `css:142` |
| `yeniGiris` | 30 | (1.4) | 700 | −0.02 em | Yeni kayıtta başlık alanı | `css:175` |
| `levhaBuyuk` | 28 | 1.0 | 700 | −0.025 em | Büyük levhanın başlığı | `css:54` |
| `takvimGun` | 24 | (1.4) | 700 | −0.02 em | Takvimde seçili günün başlığı | `css:127` |
| `levhaGenis` | 22 | 1.0 | 700 | −0.025 em | Geniş levhanın (taslak) başlığı | `css:54`, `css:59` |
| `levhaKare` | 21 | 1.0 | 700 | −0.025 em | Kare levha ve takvim şeridi kartı | `css:54`, `css:57` |
| `kartBaslik` | 19 | 1.1 | 700 | −0.01 em | Varış kartının görevi | `css:148` |
| `dugmeBuyuk` | 19 / 18 | (1.4) | 700 | 0 | "Ekle" (19), ayrıntıdaki "Bitti" (18) | `css:188`, `css:166` |
| `gunNo` | 18 | 1.0 | 600 (bugün 800) | 0 | Takvim günü | `css:114`, `css:116` |
| `satirAd` | 17 | (1.4) | 600 | 0 | Tarihsiz satırın adı | `css:90` |
| `govdeBuyuk` | 17 | 1.5 | 400 | 0 | Ayrıntıdaki not; en çok 34 em genişlik | `css:145` |
| `zaman` | 17 | (1.4) | 500 | 0 | Ayrıntıda tarih ve saat | `css:143` |
| `govde` | 16 | (1.4) | 400 | 0 | Taban; gün başlığının alt satırı | `css:2`, `css:40` |
| `etiket` | 15 | (1.4) | 500 / 600 / 650 | 0 | Tarih (500), bölüm başlıkları (600), hap'lar ve alt çubuk (600), seçenek grupları ve onay düğmeleri (650), biten hap'ı (550) | `css:38`, `81`, `83`, `97`, `144`, `179`, `185`, `78` |
| `levhaAlt` | 14 | (1.4) | 500, %88 saydamlık | 0 | Levhanın zaman satırı; tost (500); kapak seçici (600) | `css:55`, `css:139`, `kabuk:92` |
| `kucuk` | 13 | (1.4) | 400 | 0 | Hafta günü adları, bağlantı türü | `css:111`, `css:161` |

Parantez içindeki satır değerleri mirastır, açıkça verilmemiştir.

## 3. Düzen

### 3.1 Genel ölçüler

- Yan boşluk: **16 dp**, güvenli alan daha büyükse o (`kabuk:3-4`, `max(16px, env(safe-area-inset-*))`).
  **[A]** Compose: `WindowInsets.safeDrawing` yatay bileşeni ile 16 dp'nin büyüğü.
- Sayfa iç boşluğu: üst 20, alt 120 dp (alt çubuk ve tost için yer; `css:36`).
- Levhalar arası boşluk 10 dp (`css:41`), köşe yarıçapı **26 dp** (`css:43`).
- Dokunma hedefleri: prototipte en küçük 40 dp (onay düğmeleri, hap'lar; `css:78`, `css:179`).
  **[A]** Android'de en az **48 dp** dokunma alanı: görünür boy 40–46 dp kalabilir, `Modifier.minimumInteractiveComponentSize()`
  ile dokunma alanı 48'e genişletilir.

### 3.2 Bugün ekranı ve mozaik

Yukarıdan aşağı (`js:42-55`):

1. **Baş** (`css:37-40`): iç boşluk 4/2/18 dp. Tarih satırı ("Cuma, 27 Kasım", `etiket` 500, `s-soft`);
   8 dp altında gün cümlesi (`gunBasligi`); 10 dp altında alt satır (`govde`, `s-soft`).
2. **Mozaik**: iki sütunlu ızgara, 10 dp boşluk (`css:41`).
3. **Bitenler** (varsa): bölüm başlığı + hap'lar.
4. **Tarihi olmayanlar**: bölüm başlığı + satırlar (boşsa "Tarihsiz iş yok.").

Bölüm başlıkları: `etiket` 600, `s-soft`, üst 26 / alt 10 dp (`css:81`).

**Gün cümlesi** (`js:44-48`):

- Sıradaki iş: saati şimdiden sonra olan ilk açık kayıt; yoksa sıralamadaki ilk açık kayıt.
- Saatliyse "Sırada ⟨başlık küçük harfle⟩ var." / "⟨N dakika⟩ sonra, ⟨SS:DD⟩" (60 dakikadan azsa dakika,
  değilse yuvarlanmış saat). Saatsizse alt satır "Bugün, ⟨zaman⟩".
- Açık iş yoksa "Bugünlük bu kadar." / "⟨N⟩ iş bitti." ya da "Yeni bir şey eklemek için artıya dokun."
- **[A]** Prototipte "şimdi" sabitti (`ortak:56`). Uygulamada dakikada bir yeniden hesaplanır; sıradaki iş
  değişince mozaik §5.3 "yeniden diz" hareketiyle yer değiştirir. Küçük harf Türkçe kurala göre
  (`Locale("tr")`; "İ" → "i", "I" → "ı").

**Sıralama** (`ortak:106-108`, `YOL-HARITASI.md` 4.3 ile aynı): önce bölümsüz saatsizler, sonra gün
bölümlüler (sabah, öğle, öğleden sonra, akşam, gece), sonra saatliler saat sırasıyla.

**Mozaik kuralı** (`js:51`):

| Sıra | Hangi kayıtlar | Levha biçimi |
|---|---|---|
| 1 | Sıradaki iş (en çok 1) | **büyük**: iki sütunu kaplar; canlı çizim |
| 2 | Öteki açık işler, sıralamaya göre | **kare**: yan yana iki; sayı tekse sonuncusu **geniş** |
| 3 | Taslaklar (asistan önerisi) | her biri **geniş**, açık işlerden sonra |
| — | Tamamlananlar | levha değil; "Bitenler" hap'ı (§3.4) |

Levha biçimleri (`css:45-58`; 390 dp ekranda içerik genişliği 358 dp ile ölçüler):

| Biçim | En/boy | 390 dp'de | Çizim kutusu (üst, sağ, alt, sol) | Yazı kutusu | Tamamlama dairesi |
|---|---|---|---|---|---|
| büyük | 1 : 0.84 | 358 × 301 | %7, %9, %30, %9 | alta yaslı; iç boşluk 16 / 68 / 16 / 18; başlık `levhaBuyuk` | 46 dp, sağ-alt 12 dp |
| kare | 1 : 1.2 | 174 × 209 | %25, %6, %33, %6 | alta yaslı; 14 dp; başlık `levhaKare` | 42 dp, sağ-üst 10 dp |
| geniş | 1 : 0.52 | 358 × 186 | %10, %3, %10, %50 (sağ yarı) | üste yaslı; 16 / %50 / 62 / 18; başlık `levhaGenis` | 46 dp, sağ-alt (taslakta yok) |
| şerit (takvim) | 1 : 1.08, genişlik %64 | 229 × 247 | %20, %6, %32, %6 | alta yaslı; 14 dp; `levhaKare` | 42 dp, sağ-üst 10 dp |

Levhanın içi (`js:13-19`): zemin `b`; çizim (viewBox 240 × 160, `contain` ile ortalı); başlık ve altında
zaman satırı ("13:00–21:00 @ İş yeri", `levhaAlt`). Taslakta zaman satırının başına "Asistan önerdi, "
eklenir; tamamlama dairesi yerine "Onayla" ve "Vazgeç" düğmeleri gelir (§3.3). Levhanın tamamı ayrıntıyı
açar; tamamlama dairesi ayrı bir dokunma hedefidir.

**Tamamlama dairesi** (`css:60-64`): çerçeve 2 dp, rengi `i`; içinde 22 dp tik, çizgi 3 dp, rengi `b`,
yuvarlak uç. Tamamlanınca daire `i` ile dolar, tik çizilir.

**Fotoğraf kapaklı levha** (`css:68-71`): fotoğraf levhayı kaplar (`ContentScale.Crop`), alt %60'a
saydamdan `foto-perde`'ye geçiş; yazı `foto-ust`; tik rengi `s-ink`.

### 3.3 Taslak (karakalem) levha

`css:73-79`:

- Zemin boyası yok (renk dairesi 0 yarıçap; §5.4). Yazı `s-ink`.
- Çerçeve: 2 dp **kesikli**, `s-soft`, içe çizili. **[A]** Compose'da `drawRoundRect` +
  `Stroke(width = 2.dp, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f) /*dp*/))` **[Ö]**
  (tarayıcının varsayılan kesik boyu ölçülmedi; 6/6 dp ekran görüntüsüne yakın).
- Çizim karakalemdir: dolgular kapalı, her parça 2 dp kesikli (5/5, viewBox biriminde) `s-ink` çizgi (§7.3).
- Düğmeler sol-alt 18/14 dp, aralarında 6 dp; boy 40, iç yatay 16 dp, tam yuvarlak, 2 dp `s-ink` çerçeve,
  yazı `etiket` 650. "Onayla" dolu (`s-ink` zemin, `s-bg` yazı); "Vazgeç" boş.

### 3.4 Bitenler ve tarihsizler

- **Biten hap'ı** (`css:82-86`): sola akan, sarılan sıra, 8 dp boşluk. Boy 44 dp, tam yuvarlak, `s-yuz`
  zemin, iç boşluk 0/16/0/6. Solda 32 dp daire (`b` zemin, `i` renkli tik, çizgi 2.6). Ad üstü çizili
  (1.5 dp), `s-soft`, tek satır, sonu "…". Dokununca ayrıntı açılır.
- **Tarihsiz satır** (`css:87-93`): alt alta, 8 dp boşluk. En az 60 dp boy, köşe 20 dp, `s-yuz` zemin,
  iç boşluk 0/6/0/8. Solda 44 dp küçük resim kutusu (köşe 14, `b` zemin, 5 dp iç boşluk, çizim);
  ortada ad (`satirAd`); sağda 42 dp tamamlama dairesi (çerçeve `s-ink`, dolunca tik `s-bg`).
  Tamamlanınca ad üstü çizili ve `s-soft`.

### 3.5 Alt çubuk

`css:96-102`, `js:25`: ekranın altında ortalı, alttan 14 dp, yüzen hap. Zemin `s-ink`, içerik `s-bg`,
iç boşluk 6 dp, öğeler arası 4 dp. Üç öğe: **Bugün** (simge + yazı), **artı** (56 × 48 dp, `s-vurgu`
zemin, 24 dp simge, çizgi 2.4), **Takvim**. Yazılı düğmeler 48 dp boy, iç yatay 18 dp, `etiket` 600;
seçili olmayanın saydamlığı %72. Seçili sekmenin arkasında `s-bg` renginde %16 saydam bir "leke" kayar.

- **[A]** Alt çubuk gezinme çubuğunun (gesture bar) üstünde durur: alt boşluk `14 dp +
  WindowInsets.navigationBars`.
- **Açık nokta:** `YOL-HARITASI.md` 4.3 "Tarihliler ve Tarihsizler kalır; yanına Takvim sekmesi gelir"
  diyor. Prototipte yalnız Bugün ve Takvim var; tarihsizler Bugün'ün altında, tarihliler takvimde.
  Üç sekmenin Sahne'de nasıl duracağı ürün kararıdır (§12).

### 3.6 Takvim

`css:105-129`, `js:100-131`; görüntü `goruntu/6-takvim.png`.

- **Baş**: ay adı (`ayBasligi`), yanında yıl (`govde` 500, `s-soft`), sağda iki yuvarlak ok düğmesi
  (44 dp, `s-yuz`), aralarında 6 dp. İç boşluk 4/2/14.
- **Hafta günleri**: "Pzt … Paz", `kucuk`, `s-soft`, ortalı; hafta pazartesi başlar (`ortak:59`).
- **Izgara**: 7 sütun, satır arası 2 dp; ay 5 ya da 6 hafta (`ortak:73-77`). Gün hücresi en/boy 1 : 1.08;
  numara (`gunNo`) ve altında en çok üç nokta (7 dp daire, 3 dp ara), noktanın rengi kaydın `b`'si.
  Tamamlanmış kaydın noktası %40 saydam, taslağın noktası 1.5 dp kesikli halka (`s-soft`).
  Ay dışı günler `s-soft`, %50, 400. Bugün: numaranın altı çizili (2.5 dp, 4 dp aşağıda), 800.
- **Seçili gün lekesi**: hücrenin kısa kenarından 2 dp küçük daire, o günün **ilk** kaydının `b`'si
  (kayıt yoksa `s-ink`); numara ve noktalar o takımın `i`'si (ya da `s-bg`) ile yazılır (`js:112-126`).
- **Seçili günün kayıtları**: başlık ("Bugün, 27 Kasım"; dün/yarın da göreli; `takvimGun`), altında yatay
  kaydırılan, ortaya oturan (snap) **şerit** levhalar; ekran kenarına kadar taşar. Boş gün: "Bu gün boş.
  Artıya dokunup bir şey ekle."
- **Açık noktalar** (`YOL-HARITASI.md` 4.3 ile fark): birden çok güne yayılan kayıt prototipte her günde
  ayrı kart olarak görünür, ızgarada şerit olarak çizilmez; kalıcı kural işareti prototipte yok (§12).

### 3.7 Ayrıntı

`css:132-167`, `js:150-172`; görüntü `goruntu/4-ayrinti.png`.

- **Kapak**: ekran yüksekliğinin %46'sı, en az 260 dp; zemin `b`; alt köşeler 34 dp yuvarlak. Çizim
  kutusu %16 üst, %10 yan, %8 alt. Kapak canlıdır (sürekli hareketler oynar).
- **Fotoğraf kapak** seçiliyse fotoğraf kapağı kaplar; sol-altta çizim "etiketi": 76 dp kare, köşe 22,
  `b` zemin, 8 dp iç boşluk, −6° eğik, kenarlardan 14 dp.
- **Kapat düğmesi**: sol-üst, 46 dp daire, `s-bg` zemin, `s-ink` aşağı ok; üstten 12 dp.
  **[A]** Üst boşluk `12 dp + statusBars` olur.
- **Kapak seçici** (fotoğrafı olan kayıtta): sağ-alt 14 dp; `s-bg` hap içinde iki düğme "Çizim" /
  "Fotoğraf" (38 dp boy, iç 14 dp, 600 14 sp); seçili olan `s-ink` dolgu.
- **İçerik** (iç boşluk 22 üst / 110 alt; bloklar arası 24 dp): başlık (`ayrintiBasligi`) ve zaman
  ("Bugün, 13:00–21:00", taslakta ", asistan önerdi"); **varış kartı** (bölgeli kayıtta: `b` zemin, köşe
  24, iç 12/16/12/12, 84 dp harita resmi köşe 16, üstte "⟨bölge⟩ bölgesine varınca", altta görev
  `kartBaslik`); **Not**; **Fotoğraflar** (yatay, ortaya oturan; her biri %72 genişlik, 4:3, köşe 20,
  sırayla −1.2° ve +1.4° eğik; sonda %44 genişlikte kesikli "Fotoğraf ekle" kutusu); **Bağlantılar** (iki
  sütun, 10 dp ara; kart `s-yuz`, köşe 20, küçük resim + ad + tür); **Hatırlatmalar** (hap'lar, 42 dp, zil
  simgesi; varış hatırlatması varsa "Varınca" hap'ı).
- Bölüm başlıkları ("Not", "Fotoğraflar" …) `etiket` 600 `s-soft`, alt 10 dp.
- **Alt düğme** (taslakta yok): ekrana yapışık, 56 dp, tam yuvarlak, `s-ink` zemin, "Bitti" (`dugmeBuyuk`
  18). Tamamlanmış kayıtta "Bitti, geri al" ve `s-yuz` zemin / `s-ink` yazı. Arkasında `s-bg`'ye geçen
  degrade (üstten %34'te tam). **[Ö]** Taslağın ayrıntısında altta "Onayla" / "Vazgeç" çifti olmalı;
  prototipte ayrıntıdan onaylanamıyor.

### 3.8 Yeni kayıt

`css:170-188`, `js:224-287`; görüntü `goruntu/5-yeni-kayit.png`.

- Tam ekran; zemin önerilen takımın `b`'si, yazı `i`. Açılışta **kum** ve **yildiz** (`js:228`, `js:239`).
- Sağ-üstte 46 dp kapat dairesi (2 dp `i` çerçeve). **[A]** üst boşluk + statusBars.
- **Sahne alanı**: kalan yüksekliği doldurur (en az 110 dp; iç boşluk üst 60, yan %16, alt 6); önerilen çizim.
- **Form** (iç 8/16/18/16, satırlar arası 14 dp):
  - Etiket "Ne yapacaksın?" (`etiket` 600, %85) ve başlık alanı: zeminsiz, alt çizgi 3 dp `i`,
    `yeniGiris`, ipucu "Yaz ya da aşağıdan seç" %45 saydam.
  - Örnek hap'lar: "Araba yıkama", "Dişçi", "Market", "Kargo", "Kahvaltı" (40 dp, 2 dp çerçeve).
  - Zaman türü: üç parçalı seçici "Saatli / Gün içinde / Tarihsiz" (2 dp çerçeve, 3 dp iç, 42 dp
    düğmeler; seçili parçanın altında `i` renkli kayan dolgu, yazısı `b`).
  - Türe göre: Saatli → saat seçici (prototipte 09:00, 12:00, 15:00, 18:00, 20:00 hap'ları; **[A]**
    Android'de Cetvel'in mezurası, §8.4); Gün içinde → beş gün bölümü hap'ı; Tarihsiz → "Tarih vermeden
    listeye girer."
  - "Ekle": 58 dp, tam yuvarlak, `i` zemin, `b` yazı, 700 19 sp.
- Takvimdeyken eklenen kayıt seçili güne, Bugün'deyken bugüne düşer (`js:276`).

## 4. Hareket ilkeleri ve eğriler

**Karakter.** Yaylı ve oyuncu: levhalar biraz aşıp yerine oturur; anlam taşımayan hareket yoktur.
Her hareket bir durum değişikliğini anlatır (sıra değişti, iş bitti, öneri onaylandı, ayrıntı açıldı).

**Prototipin eğrileri** (`js:3` ve satır içi):

| Ad | CSS eğrisi | Ölçülen davranış | Nerede |
|---|---|---|---|
| `YAY` | `cubic-bezier(.34,1.45,.55,1)` | %6.6 aşma; tepe sürenin %57'sinde | Çoğu giriş, yerleşme, geri yaylanma |
| `YUM` | `cubic-bezier(.2,.8,.2,1)` | aşmasız yavaşlayan | Baş yazısı, kapak resmi değişimi, tost |
| ayrıntı açılışı | `cubic-bezier(.3,1.2,.4,1)` | %1.2 aşma | Levhadan ayrıntıya büyüme (`js:178`) |
| yeniden diz | `cubic-bezier(.3,1.25,.45,1)` | %2.0 aşma | Yer değiştiren levhalar (`js:64`) |
| leke | `cubic-bezier(.34,1.4,.55,1)` | %5.3 aşma | Alt çubuk lekesi, zaman türü dolgusu (`css:102`, `css:182`) |
| kapanış | `cubic-bezier(.4,0,.3,1)` | standart hızlan-yavaşla | Ayrıntının levhaya dönmesi (`js:188`) |
| dairesel açılış | `cubic-bezier(.3,.7,.2,1)` | yavaşlayan | Yeni kayıt açılışı, levhanın boyanması (`js:255`, `css:44`) |
| dairesel kapanış | `cubic-bezier(.5,0,.7,.3)` | hızlanan | Yeni kayıt kapanışı (`js:260`) |

Aşma oranları, Bezier eğrisi örneklenerek ölçüldü (yerel betik; tepe değeri − 1).

**Compose karşılığı [A].** Aşan Bezier eğrileri `spring` ile değiştirilir; böylece hareket kesilip yön
değiştirse de (ör. ayrıntı açılırken geri çekmek) hız korunur. Değerler, aşma oranı ve tepe zamanından
ikinci dereceden sistem varsayılarak hesaplandı (sönüm oranı ζ = −ln(a)/√(π² + ln²(a)); 460–620 ms
süreler için sertlik 140–250 çıktı):

| Compose adı [Ö] | Karşıladığı | `spring(...)` |
|---|---|---|
| `Hareket.yay` | `YAY`, leke | `dampingRatio = 0.65f, stiffness = 200f` |
| `Hareket.yayHizli` | 420 ms'lik `YAY` (geri yaylanma, kısa girişler) | `dampingRatio = 0.65f, stiffness = 300f` |
| `Hareket.oturan` | ayrıntı açılışı, yeniden diz | `dampingRatio = 0.8f, stiffness = 220f` |
| `Hareket.yumusak` | `YUM` | `tween(süre, easing = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f))` |
| `Hareket.kapanis` | kapanış | `tween(380, easing = CubicBezierEasing(0.4f, 0f, 0.3f, 1f))` |
| `Hareket.acilis` | dairesel açılış | `tween(560, easing = CubicBezierEasing(0.3f, 0.7f, 0.2f, 1f))` |
| `Hareket.kapanisDaire` | dairesel kapanış | `tween(380, easing = CubicBezierEasing(0.5f, 0f, 0.7f, 0.3f))` |

**Android tarafıyla tutarlılık (2026-11-27).** Compose geçişindeki ilk tema dosyası
(`android/.../ekran/sahne/tema/SahneHareket.kt`) `yay` için ζ 0.62 / sertlik 380, `oturma` için aşmasız /
520 seçmiş. Bu değerlerle tepe ~205 ms'de gelir; prototipte `YAY`'ın tepesi 318–352 ms'de (yukarıdaki
ölçüm), yani Android'deki ilk hâl prototipten ~%40 daha çabuk. Hangisinin kalacağı gerçek telefonda
denenerek seçilir; seçilen değer bu tabloya da yazılır. Renk değerleri o dosyalarla birebir aynıdır.

Yaylarda süre yoktur; prototipteki **gecikmeler ve kademeler** (stagger) aynen korunur (`delay`), süreler
yalnız fikir verir. Gerçek telefonda ilk denemeden sonra sertlik ±%30 ayarlanabilir; prototip yalnız
öykünmeyle sınandı (`YOL-HARITASI.md` 4A).

## 5. Hareketler

Biçim: **ne olur** · prototipteki değerler · Compose önerisi. "Hareketi azalt" davranışı §6'da.

### 5.1 Açılış (Bugün ekranı ilk kez çizilir)

`js:36-40`.

- Baş: saydamdan tama, 18 dp aşağıdan yerine; 460 ms `YUM`.
- Mozaik levhaları sırayla: saydamlık 0 → 1, 46 dp aşağıdan, ölçek 0.88 → 1, −2.5° → 0°; 620 ms `YAY`,
  gecikme `140 + i × 90` ms.
- Alt çubuk: 96 dp aşağıdan yerine; 560 ms `YAY`, gecikme 380 ms.
- Compose: `Animatable` ile `graphicsLayer { alpha; translationY; scaleX/Y; rotationZ }`, `Hareket.yay`.
  **[A]** Yalnız soğuk açılışta oynar; sekmeden geri dönüşte ya da ekran dönüşünde oynamaz.

### 5.2 Tamamlama ("iş bitti")

`js:71-82`, `css:32-33`, `css:60-67`; uygulamada en çok görülecek hareket.

1. Tik: daire `i` ile dolar (200 ms), tik çizilir (çizgi uzunluğu 0 → tam, 300 ms, 100 ms gecikme);
   daire 0.6 → 1 ölçekle yaylanır (460 ms `YAY`).
2. Levhanın üstünden `l` renkli, %50 saydam, levhanın %55'i genişliğinde, −18° eğik bir **yıkama bandı**
   soldan sağa geçer (−%140 → +%260; 700 ms `cubic-bezier(.4,0,.2,1)`).
3. Aynı anda çizimdeki köpükler **patlar** (ölçek 1 → 1.9 → 2.6, saydamlık → 0; 550 ms `YUM`). Köpüğü
   olmayan çizimde yalnız bant geçer.
4. 720 ms sonra kayıt "bitti" olur; mozaik **yeniden dizilir** (§5.3), levha Bitenler hap'ına dönüşür.
5. Tost: "Bitti: ⟨başlık⟩" ve "Geri al" (§5.13).

- Geri almak (tamamlanmışı açmak) yalnız yeniden dizer.
- Tarihsiz satırda ve biten hap'ında bant ve köpük yok; 300 ms sonra durum değişir.
- Compose: tik `Path` + `PathMeasure.getSegment` ile çizilir; bant `drawWithContent` içinde
  `clipPath(levha)` + eğik dikdörtgen. **[Ö]** Haptik: tamamlama anında hafif bir
  onay titreşimi (`LocalHapticFeedback`, Compose sürümünde varsa `HapticFeedbackType.Confirm`).
- **[A]** 720 ms beklemede kullanıcı başka bir levhaya dokunabilir; bekleme sırasında levha
  dokunmaya kapalıdır (`js:73` `_mesgul`).

### 5.3 Yeniden diz

`js:56-67`. Kayıtlar değişince (bitti, onaylandı, eklendi, silindi, sıradaki iş değişti):

- Yerinde kalan: hareket yok.
- Yeri ya da boyu değişen: eski konum/boydan yenisine kayar (FLIP); 560 ms yeniden diz eğrisi.
- Yeni gelen: saydamdan, ölçek 0.5 → 1, −6° → 0°; 560 ms `YAY`.
- Gün cümlesi: saydamlık 0.3 → 1, 400 ms (doğrusal).
- Compose: mozaik `LazyVerticalGrid` (ya da `LazyColumn` içinde satırlar) + `Modifier.animateItem(
  placementSpec = Hareket.oturan, fadeInSpec = Hareket.yay)`. **[A]** Biçim değişimi (kare → büyük) için
  levha `SharedTransitionLayout` içinde `Modifier.sharedBounds(key = kayıt.id)` ile sarılır; `animateItem`
  boy değişimini kendisi canlandırmaz.

### 5.4 Onaylama: karakalemden boyamaya

`js:83-90`, `css:13`, `css:43-44`, `css:73-76`; görüntü `goruntu/3-taslak-bitenler.png`.

1. Onay düğmeleri 200 ms'de söner.
2. **Boya dairesi**: levhanın `b` zemini, levhanın sağ-alt köşesine yakın bir noktadan (%82, %84)
   büyüyen bir daireyle dolar (yarıçap 0 → levhanın %150'si; 800 ms dairesel açılış eğrisi).
3. Yazı rengi `s-ink`'ten `i`'ye geçer (400 ms).
4. Çizimin dolguları açılır (saydamlık 0 → rolün saydamlığı; 600 ms, 150 ms gecikme); kesikli karakalem
   çizgisi hemen kaybolur, çizgi rolündeki parçalar boyalı kalınlığına döner (prototipte bu geçiş anlık).
5. Kesikli çerçeve kaybolur (anlık).
6. 900 ms sonra mozaik yeniden dizilir (geniş → kare/büyük; §5.3); tost "Onaylandı".

- Compose: levha `drawBehind { drawCircle(b, radius = r.value * maxBoyut * 1.5f, center = (0.82w, 0.84h)) }`
  `clipPath` içinde; `r` 0 → 1 `Hareket.acilis` 800 ms. Çizim için §7.3'teki `boyama` oranı (0 → 1)
  dolgu saydamlığını ve karakalem çizgisinin saydamlığını birlikte sürer. **[Ö]** Karakalem çizgisi
  anlık kaybolmak yerine dolguyla ters orantılı 300 ms'de solar; prototipte anlık olması tarayıcı
  sınırıdır (`stroke-dasharray` geçişi yok), tasarım kararı değil.

### 5.5 Vazgeç (taslağı reddetme)

`js:91-97`: levha 260 ms `ease-in` ile söner, 0.7'ye küçülür, +4° döner; ardından kayıt silinir, yeniden
dizilir; tost "Öneriden vazgeçildi" + "Geri al".

### 5.6 Levhadan ayrıntıya büyüme

`js:173-181`; görüntü `goruntu/4-ayrinti.png`.

- Ayrıntının kapağı, dokunulan levhanın konum ve boyundan tam ekrana büyür; köşe yarıçapı 40 → alt
  köşeler 34; 560 ms ayrıntı açılışı eğrisi. (Dokunulan levha görünmüyorsa kapak yukarıdan iner:
  −%100 → 0, 440 ms `YUM`.)
- Ayrıntı zemini saydamdan `s-bg`'ye 320 ms.
- İçerik blokları sırayla 40 dp aşağıdan ve saydamdan gelir; 560 ms `YAY`, gecikme `140 + i × 60` ms.
- Alt düğme 30 dp aşağıdan; 420 ms `YAY`, 360 ms gecikme.
- Compose [A]: `SharedTransitionLayout` + `AnimatedContent`/gezinme hedefi; levha ve kapak aynı
  `sharedBounds(rememberSharedContentState("levha-${id}"))` anahtarını taşır,
  `boundsTransform = { _, _ -> Hareket.oturan }`, köşe yarıçapı `clipInOverlayDuringTransition` ile
  `RoundedCornerShape` canlandırılarak. Çizim de ayrı `sharedElement("cizim-${id}")` olur ki büyürken
  ölçeklenip bozulmasın. Navigation Compose kullanılıyorsa `LocalNavAnimatedVisibilityScope`.

### 5.7 Aşağı çekerek kapatma ve geri dönüş

`js:182-194`, `ortak:23-53`.

- Sürükleme yalnız **kapaktan** başlar, sayfa en üstteyken (`scrollTop ≤ 0`) ve düğmenin üstünde değilken.
  8 dp eşik; ilk yön dikey değilse bırakılır (eksen kilidi).
- Sürüklerken: sayfa parmakla `d` kadar iner; ölçek `max(0.8, 1 − d/1600)`, yatayda ortalı küçülür;
  köşeler `min(40, d/3)` dp.
- Bırakınca: `d > 110 dp` **ya da** hız `> 0.6 dp/ms` (600 dp/s) → kapanır; değilse 460 ms `YAY` ile geri
  yaylanır.
- **Kapanış**: ayrıntı, levhanın şimdiki yerine ve boyuna küçülür (sürenin %70'inde varır), son %30'da
  söner; köşeler 80'e; 380 ms kapanış eğrisi. Levha görünmüyorsa aşağı kayıp çıkar. Hedef levha bu
  sırada 0.94 → 1 yaylanır (460 ms `YAY`, 240 ms gecikme).
- Compose [A]: `Modifier.anchoredDraggable` yerine `pointerInput` + `VelocityTracker` (eşik ve hız
  prototiple aynı); içerik `LazyColumn`'sa `NestedScrollConnection.onPreScroll` en üstteyken aşağı çekişi
  kapanmaya yönlendirir. **Sistem geri hareketi** (`PredictiveBackHandler`, Android 14+) aynı küçülmeyi
  geri ilerlemesine (`progress`) bağlar: `d = progress × 200 dp` **[Ö]**; vazgeçilirse geri yaylanır.
  Geri tuşu ve Esc (`ortak:270`) da kapanışı oynatır.

### 5.8 Kapak değişimi (çizim ⇄ fotoğraf)

`js:201-206`: yeni kapak resmi saydamdan ve 1.12 ölçekten yerine (520 ms `YUM`); fotoğraf kapakta çizim
etiketi 0 ölçek ve +30°'den −6°'ye (560 ms `YAY`, 160 ms gecikme). Compose: `Crossfade` yerine
`AnimatedContent(transitionSpec = fadeIn + scaleIn(initialScale = 1.12f) togetherWith fadeOut)`.

### 5.9 Fotoğraf ekleme

`js:207-214`: yeni kare saydam, 0.6 ölçek, +8°'den −1.2°'ye (560 ms `YAY`); şerit ona kayar. İlk fotoğraf
eklenince kapak seçici belirir (çizim seçili kalır). **[A]** Fotoğraf seçimi sistem seçicisiyle
(`PickVisualMedia`); izin istemez.

### 5.10 Ayrıntıdan tamamlama

`js:215-220`: düğme 0.94 → 1 yaylanır (420 ms `YAY`); tamamlandıysa kapakta köpükler patlar ve 520 ms
sonra ayrıntı kendiliğinden kapanır (§5.7 kapanış), levha listede yeniden dizilir.

### 5.11 Yeni kayıt açılışı ve çizim önerisi

`js:224-262`; görüntü `goruntu/5-yeni-kayit.png`.

- **Dairesel açılış**: ekran, artı düğmesinin merkezinden büyüyen bir daireyle açılır (yarıçap 0 →
  ekran köşegeni); 560 ms dairesel açılış eğrisi. Kapanış tersine, 380 ms dairesel kapanış eğrisi.
- Çizim: saydam ve 0.5 ölçekten (620 ms `YAY`, 200 ms gecikme). Form satırları sırayla 30 dp aşağıdan
  (520 ms `YAY`, gecikme `180 + i × 50`).
- **Başlık yazılırken** (`js:247-253`, her tuşta): öneri tablosu (§7.1) başka bir çizim verirse
  - zemin ve yazı rengi yeni takıma geçer (`b` 450 ms, `i` 300 ms; `css:170`);
  - yeni çizim saydam, 0.4 ölçek ve −14°'den yerine yaylanır (620 ms `YAY`).
  Aynı çizim kalırsa hiçbir şey oynamaz.
- Zaman türü değişince seçili parçanın dolgusu kayar (450 ms leke eğrisi); alttaki seçenekler sırayla
  0.7 ölçekten belirir (380 ms `YAY`, gecikme `i × 35`).
- Boş başlıkla "Ekle": alan sallanır (0, −8, +7, 0 dp; 300 ms) ve odak alana döner.
- Ekleyince ekran kapanır; 240 ms sonra liste yeniden dizilir ve yeni levhaya kaydırılır; tarihsizse
  tost "Tarihi olmayanlara eklendi".
- Compose: `Modifier.clip(DaireselSekil(yaricap))` (özel `Shape`, `Path.addOval`) + `Animatable`;
  renkler `animateColorAsState`. **[A]** Yeni kayıt ayrı bir gezinme hedefi değil, Bugün/Takvim'in
  üstünde tam ekran katman (dialog değil) olarak durur; böylece klavye `imePadding` ile itilir.
- **[A]** Öneri her tuşta değil, yazma 150 ms durunca çalışır **[Ö]**; aksi hâlde hızlı yazarken renk
  titrer (prototipte her `input` olayında çalışıyor).

### 5.12 Takvim hareketleri

- **Sekme geçişi** (`js:139-147`): yeni sayfa %34 yandan (Takvim'e giderken sağdan, Bugün'e dönerken
  soldan) ve saydamdan gelir; 520 ms `YAY`. Alt çubuktaki leke yeni sekmeye kayar (500 ms leke eğrisi,
  genişlik 300 ms). Compose: `AnimatedContent` + `slideInHorizontally { it * 34 / 100 } + fadeIn`.
- **Gün seçimi** (`js:112-131`): leke eski günden yeni güne kayar ve 0.7 → 1 ölçeklenir (520 ms `YAY`),
  rengi 300 ms'de yeni günün takımına geçer; numara rengi 250 ms. Şerit kartları sırayla 60 dp sağdan,
  0.9 ölçekten (520 ms `YAY`, gecikme `i × 70`).
- **Ay değişimi** (`js:108-110`, `js:132-138`): ızgara yatay sürüklenir (parmağın %60'ı kadar); bırakınca
  `|dx| > 56 dp` ise ay değişir, değilse 420 ms `YAY` geri yaylanır. Yeni ay: ızgara 70 dp yandan ve
  saydamdan (520 ms `YAY`), ay adı 24 dp dikeyde (460 ms `YAY`). Ok düğmeleri de aynı geçişi oynatır.
  **[A]** Compose'da `HorizontalPager` (ay başına sayfa) bu davranışı ve TalkBack'i kendisi verir; prototipin
  %60 sürtünmesi yerine sayfalayıcının kendi takibi yeterli **[Ö]**.

### 5.13 Tost

`ortak:258-266`, `kabuk:92-93`: alttan 96 dp yukarıda, ortalı hap; 12 dp aşağıdan ve saydamdan 220 ms
`YUM`; eylemli olan 4200 ms, eylemsiz 2200 ms kalır, 200 ms'de söner. **[A]** Compose `SnackbarHost`
özel görünümle; eylemli tost TalkBack açıkken kendiliğinden kapanmaz (`SnackbarDuration.Indefinite`
yerine erişilebilirlik süresi: `AccessibilityManager.getRecommendedTimeoutMillis`).

### 5.14 Fotoğraf büyütme

`ortak:271-285`: koyu perde (`isik-bg`) 260 ms; fotoğraf karesinden ortadaki 4:3 kutuya büyür (340 ms `YUM`);
dokununca 240 ms `cubic-bezier(.4,0,.6,1)` geri. **[A]** Sıkıştırarak yakınlaştırma eklenir
(`transformable`); prototipte yok.

### 5.15 Sürekli (döngüsel) hareketler

Yalnız "canlı" yerlerde oynar: Bugün'ün **büyük levhası**, **ayrıntı kapağı** ve **yeni kayıt sahnesi**
(`js:51`, `js:158`, `js:230`). Kare levhalarda, takvimde, listelerde çizimler durağandır.

| Hareket | Değerler | Kaynak |
|---|---|---|
| Köpük | her köpük 0 → −7 dp → 0 dikey; 3.2 s `ease-in-out` sonsuz; köpükler −0.8, −1.7, −2.3, −1.1 s kaydırmalı | `css:25-27` |
| Buhar | 0 → −6 dp ve saydamlık 1 → 0.5 → 1; 2.8 s sonsuz | `css:28-29` |
| Pırıltı | kendi merkezinde ölçek 1 → 0.6 ve +20° → geri; 2.6 s sonsuz | `css:30-31` |
| İmza | imza çizgisi baştan sona çizilir (çizgi uzunluğu 0 → %100); 1.5 s, 0.5 s gecikme, `cubic-bezier(.5,0,.3,1)`, **bir kez** | `css:20-23` |
| Kalem | imzayla eş zamanlı: (−60, 9) → (−38, −4) %35 → (−16, 5) %70 → (0, 0), viewBox biriminde; bir kez | `css:22`, `css:24` |
| Varış halkası | harita işaretinin halkası 0.4 → 1.5 ölçek, saydamlık 0.9 → 0; 2.4 s `ease-out` sonsuz | `css:150-151` |

- Compose: `rememberInfiniteTransition` + `animateFloat(infiniteRepeatable(tween(3200, easing =
  FastOutSlowInEasing), RepeatMode.Reverse))`; kaydırma `StartOffset(800)` vb. Çizim, parça başına
  `withTransform` ile çizilir (§7.4).
- **[A]** Pil: sürekli hareketler ekran görünür ve uygulama ön plandayken oynar
  (`LocalLifecycleOwner` `RESUMED`); büyük levha ekrandan çıkınca durur. İmza ve kalem levha her
  göründüğünde değil, **gün içinde bir kez** oynar **[Ö]**.

## 6. "Hareketi azalt" açıkken

**Prototip** (`ortak:10-22`, `kabuk:98-101`): `prefers-reduced-motion` açıksa her betik hareketi 1 ms'ye
iner ve gecikmesi sıfırlanır; beklemeler (`bekle`) 0 olur; CSS hareketleri ve geçişleri 0.01 ms, tek
tekrar; varış halkası %30 saydamlıkta durağan kalır; kaydırmalar anlık (`scrollIntoView` `auto`).

**Android [A].** Ayar: Erişilebilirlik → "Animasyonları kaldır" (`Settings.Global.ANIMATOR_DURATION_SCALE
== 0`). Compose'un kendi süre ölçeğine güvenmek yerine bu değer bir `CompositionLocal` (`LocalHareketAz`)
olarak okunur ve aşağıdaki tabloya göre **açıkça** dallanılır; böylece sonsuz hareketlerin ve yayların
davranışı cihazdan cihaza değişmez. Doğrudan parmak takibi (sürüklerken sayfanın parmağı izlemesi) azaltılmaz;
yalnız parmaktan bağımsız hareketler kalkar.

| Hareket | Azaltılınca |
|---|---|
| 5.1 Açılış | Her şey son hâlinde görünür. |
| 5.2 Tamamlama | Tik dolu ve çizili hâlde belirir; bant ve köpük patlaması yok; 720 ms bekleme yok, kayıt hemen Bitenler'e geçer; tost kalır. Haptik kalır. |
| 5.3 Yeniden diz | Levhalar yeni yerlerinde belirir. **[Ö]** 150 ms saydamlık geçişi kalabilir (yer değiştirme değil, yalnız solma; WCAG 2.3.3 hareket sayılmaz). |
| 5.4 Onaylama | Levha boyalı hâlde belirir (daire yok); karakalem → boyalı anlık; 900 ms bekleme yok. |
| 5.5 Vazgeç | Levha hemen kalkar; tost kalır. |
| 5.6 Ayrıntıya büyüme | Ayrıntı doğrudan açılır; paylaşılan öğe geçişi kapalı (`sharedBounds` yerine anlık hedef). İçerik kademesi yok. |
| 5.7 Çekip kapatma | Sürüklerken parmağı izler (doğrudan işlem). Bırakınca kapanış ya da geri dönüş anlıktır. Geri hareketi önizlemesi (predictive back) sistemin kendi azaltılmış davranışına bırakılır. |
| 5.8 Kapak değişimi | Anlık; çizim etiketi −6° eğik durur (eğiklik durağan bir biçimdir, hareket değil). |
| 5.9 Fotoğraf ekleme | Kare yerinde belirir, şerit anlık kayar. |
| 5.10 Ayrıntıdan tamamlama | Düğme metni değişir; ayrıntı hemen kapanır (prototip de 0 ms; `js:219`). |
| 5.11 Yeni kayıt | Dairesel açılış yok, ekran doğrudan görünür. Çizim önerisi değişince yeni çizim ve renk anlık gelir. Boş başlıkta sallanma yerine yalnız odak ve hata metni (**[Ö]** "Bir başlık yaz"). |
| 5.12 Takvim | Sekme, gün ve ay değişimi anlık; leke yeni günde belirir. Pager kaydırması sistemin ayarına bırakılır. |
| 5.13 Tost | Anlık belirir ve kalkar; süreler aynı. |
| 5.14 Fotoğraf büyütme | Anlık açılır/kapanır. |
| 5.15 Sürekli hareketler | Hiçbiri oynamaz. Köpük, buhar, pırıltı dinlenme karesinde; imza **tamamen çizili**, kalem son yerinde; varış halkası 1.0 ölçek, %30 saydam, durağan. |

## 7. Çizimler

### 7.1 Liste ve öneri tablosu

On çizim (`ortak:159-201`), her biri `cizim/<ad>.svg` olarak ayrı dosyada. viewBox **240 × 160**;
çizim kendi zeminini taşımaz, levhanın `b` zemini üstüne konur.

| Çizim | Varsayılan takım | Başlıkta aranan (küçük harf, Türkçe) | Canlanan parçalar | Dosya |
|---|---|---|---|---|
| `araba` | kobalt | araba, oto, yıka, muayene, lastik | 5 köpük (süzülür; tamamlanınca patlar) | `cizim/araba.svg` |
| `dis` | pembe | diş, dişçi | 2 pırıltı | `cizim/dis.svg` |
| `sepet` | hardal | market, alışveriş, bakkal, pazar | — | `cizim/sepet.svg` |
| `imza` | cam | vardiya, imza, toplantı, iş yeri, mesai | imza çizgisi + kalem (bir kez) | `cizim/imza.svg` |
| `kutu` | domates | kargo, paket, koli, hediye | — | `cizim/kutu.svg` |
| `ilac` | gok | ilaç, eczane, vitamin | 1 pırıltı (artı işareti) | `cizim/ilac.svg` |
| `fincan` | hardal | kahve, kahvaltı, çay | buhar | `cizim/fincan.svg` |
| `fatura` | gece | fatura, kira, ödeme, aidat | — | `cizim/fatura.svg` |
| `cadir` | gece | gezi, kamp, tatil, yürüyüş | — | `cizim/cadir.svg` |
| `yildiz` | kum | (eşleşme yoksa) | — | `cizim/yildiz.svg` |

Tablo: `ortak:112-117`; ilk eşleşen satır kazanır.

- **[A] Eşleşme kuralı.** Prototip başlığın **içinde** arar; bu yanlış eşleşme üretir: "fotoğraf"
  içinde "oto" geçtiği için "Vesikalık fotoğraf çektir" **araba** çizimini alır; "Pazartesi" "pazar"
  ile sepete düşer. Android'de kelime başı eşleşmesi kullanılır (Türkçe küçük harfe çevrilmiş başlıkta
  kelime sınırından başlayan önek: `(^|[^a-zçğıöşü])oto`). Asıl kaynak `YOL-HARITASI.md` 4A'daki
  sözleşme v3 açık kümeli simge anahtarıdır; bu tablo yalnız telefon tarafındaki ilk öneridir.
- **[A] Takım genişliği.** Ürün 20–30 çizim istiyor (`YOL-HARITASI.md` 4A); yeni çizimler §7.5'teki
  kurallarla çizilir.

### 7.2 Boyalı hâl: roller

Her parça bir **rol** taşır; renk o anki takımdan gelir (`css:14-19`). SVG dosyalarında rol
`data-rol` özniteliğinde, renk varsayılan takımın düz rengi olarak yazılıdır.

| Rol (CSS sınıfı) | Boyalı hâl | Kaynak |
|---|---|---|
| `pf` | dolgu `f` | `css:14` |
| `pl` | dolgu `l` | `css:14` |
| `pd` | dolgu `d` (bazı parçalarda kendi saydamlığı: kutu %28 ve %50, ilac %16, çadır %80) | `css:14`, `ortak:185-197` |
| `pb2` | dolgu `b`, %45 | `css:14` |
| `ps` | çizgi `d`, 4 birim, yuvarlak uç, %22 | `css:15` |
| `ps2` | çizgi `d`, 7 birim, yuvarlak uç | `css:16` |
| `ps3` | çizgi `l`, 4 birim, yuvarlak uç, %55 | `css:17` |
| `rs-zemin` | dolgu `d`, %28 (zemin gölgesi) | `css:18` |
| köpük (`rs-kopuk circle`) | dolgu `l`, %92 | `css:19` |
| imza çizgisi | çizgi `d`, 4 birim, yuvarlak uç ve köşe | `css:20` |

Birimler viewBox birimidir; çizim levhaya ölçeklenince çizgi de ölçeklenir (büyük levhada 1 birim ≈ 1.2 dp).

### 7.3 Karakalem hâli (taslak)

`css:75-76`: her parçanın dolgusu kapanır (`fill-opacity: 0`); her parça — dolgulu olanlar da —
**`s-ink` renginde, 2 birim kalınlıkta, 5/5 kesikli** çizgiyle çizilir; rolün saydamlığı yok sayılır
(tam opak). Sonuç bir eskiz gibi görünür (`goruntu/3-taslak-bitenler.png`). Canlanan parçalar karakalemde
de canlıdır (yalnız canlı yerlerde; taslaklar mozaikte geniş levha olduğu için pratikte durağan).

Geçiş (§5.4): dolgu saydamlığı 0 → rol saydamlığı, 600 ms, 150 ms gecikme; çizgiler anlık.

**Soluk hâl (tamamlanmış)**: levha bütünüyle %30 doygunluğa iner (`css:67`, `filter: saturate(.3)`);
yalnız takvim şeridinde görünür (Bugün'de tamamlananlar hap'a dönüşür). **[A]** `RenderEffect` API 31+
gerektirdiği için takımın beş rengi Kotlin'de `ColorMatrix().setToSaturation(0.3f)` ile önceden
soldurulur ve levha o takımla çizilir; her API'de aynı sonuç.

### 7.4 Android'de nasıl çizilir (karar)

**Karar: SVG dosyaları çizimin kaynağıdır; uygulamada VectorDrawable ya da ImageVector değil, yol
verisinden Compose `Canvas` ile çizilir.** Gerekçe:

- Karakalem hâli kesikli çizgi ister; VectorDrawable ve ImageVector kesikli çizgiyi desteklemez,
  `PathEffect.dashPathEffect` yalnız `DrawScope`'ta vardır.
- Renk kayıt başına çalışma anında gelir (beş rol); VectorDrawable tek renk tonlamasıyla (tint) bunu yapamaz.
- Boyama oranı (0–1) dolgu ve karakalem çizgisini birlikte sürer; parçalar (köpük, buhar, pırıltı,
  kalem) kendi dönüşümleriyle canlanır; imza `PathMeasure` ile kırpılır. AnimatedVectorDrawable her çizim
  için ayrı XML ister ve karakalemi yine veremez.

Öneri **[Ö]**:

```kotlin
enum class Rol { F, L, D, B }
data class CizimParca(
    val yol: String,            // SVG path "d" verisi (cizim/*.svg'den)
    val rol: Rol,
    val alfa: Float = 1f,       // rolün boyalı saydamlığı (7.2)
    val cizgi: Float? = null,   // null = dolgu; değilse çizgi kalınlığı (viewBox birimi)
    val parca: String? = null,  // "kopuk", "pirilti", "buhar", "kalem", "imza_cizgi"
    val donus: String? = null,  // SVG transform (ör. "rotate(-32 120 84)"); ayrıştırılırken yola uygulanır
)
```

- Yollar `PathParser().parsePathString(d).toPath()` (`androidx.compose.ui.graphics.vector`) ile **bir kez** ayrıştırılıp önbelleğe alınır.
- `Canvas` içinde `withTransform { scale(...) }` ile 240 × 160 kutu levhanın çizim alanına `contain`
  ölçüsünde oturtulur; kesik aralığı (5/5) ve çizgi kalınlıkları viewBox biriminde kalır.
- Çizim fonksiyonu: `CizimCiz(cizim, takim, boyama: Float, canli: Boolean)`. Dolgu alfası
  `parca.alfa × boyama`; karakalem çizgisi alfası `1 − boyama`.
- Pırıltı kendi sınır kutusunun merkezinde döner/ölçeklenir (`transform-box: fill-box`, `css:30`);
  merkez `Path.getBounds()` ile bulunur.
- İmza çizgisinin `pathLength="100"`'ü normalleştirmedir; Android'de `PathMeasure.length` ile oran kullanılır.
- `cizim/*.svg` → Kotlin veri dönüşümü küçük bir betikle yapılır (bu klasördeki SVG'ler o betiğe
  uygun biçimde üretildi: her öğe `path`, `rect`/`circle` yola çevrildi, her öğede `id` ve `data-rol`;
  döndürülmüş iki öğe `transform` taşır: `sepet` içindeki ekmek, `ilac` grubu).

SVG dosyalarının boyu 1–3 KB; on çizim toplam ~20 KB. Gömülü varlık sorunu yok.

### 7.5 Yeni çizimler için kurallar

Prototipteki on çizimden çıkarıldı. Android'deki çizim takımı (`android/.../ekran/sahne/cizim/`) bu
kuralları uygular; `CizimKurallariTest` ölçülebilir olanları denetler. Bir çizimi çizen kişi yalnız bu
bölümü okuyarak takımla tutarlı çizebilmelidir.

**Nereye yazılır.** Her simge anahtarının kendi dosyası vardır: `cizim/takim/<Anahtar>Cizimi.kt`. Dosya
adı anahtarın deve biçimidir (`dogum_gunu` → `DogumGunuCizimi.kt`, değer adı `DogumGunuCizimi`). Çizimi
henüz yapılmamış anahtarın dosyasında `yerTutucu("banka", LevhaRengi.CAM)` yazar; bu satır
`cizim("banka", LevhaRengi.CAM) { … }` ile değiştirilir. Kayıt (`CizimKaydi.kt`) ve öteki dosyalar
değişmez. Anahtar listesi sözleşmedir (Kol C v3 `simge`); yeni anahtar eklemek çizim işi değildir.
`tasarim/cizim/` altında SVG kopyası tutmak isteğe bağlıdır; kaynak Kotlin dosyasıdır.

**Ölçek ve yerleşim.**
- Tuval 240 × 160 birimdir (3:2). Çizim zemin çizmez; levhanın `b` zemini üstüne konur ve levhadaki
  alana ortalanarak sığdırılır (`contain`). Büyük levhada 1 birim ≈ 1.2 dp, kare levhada ≈ 0.6 dp,
  takvim şeridinde ≈ 0.3 dp: çizim en küçük boyunda da tanınmalıdır.
- Şekil kenarlardan en az 4 birim içeride kalır (çizgi kalınlığı dahil; testte denetlenir). Asıl kütle
  x 30–210, y 15–145 arasındadır: ortalanmış tek bir nesne ya da nesne + tek bir eşlikçi (araba + köpük,
  fincan + buhar, pano + kalem). Zemin çizgisi varsa y 132–144 arasında, `zemin` ya da `pd` ile.
- Bakış düz önden ya da yandan; derinlik gerekiyorsa yalnız basit eş ölçülü kutu (`kargo`). Perspektif
  kaçışı, ufuk, sahne yok.

**Renk rolleri.** Parça rengini taşımaz, rolünü taşır; renk kaydın takımından gelir (§1.2). Yazıcıdaki
işlev adları prototipin sınıf adlarıdır (§7.2):

| İşlev | Boyalı hâl | Ne için |
|---|---|---|
| `pf` | dolgu `f` | ana gövde; her çizimde en az bir tane (testte denetlenir) |
| `pl` | dolgu `l` | cam, ışık, iç yüzey, ikinci nesne |
| `pd(alfa = …)` | dolgu `d`; saydamlık 1, .8, .5, .28 ya da .16 | teker, kıskaç, gölge yüzü, bant |
| `pb2` | dolgu `b`, %45 | figürün üstünde "oyulmuş" satırlar (pano yazısı) |
| `zemin` | dolgu `d`, %28 | yer gölgesi çizgisi |
| `ps` | çizgi `d`, 4 birim, %22 | figür üstünde ince gölge, kıvrım |
| `ps2` | çizgi `d`, 7 birim | sap, kulp, ışın, buhar |
| `ps3` | çizgi `l`, 4 birim, %55 | figür üstünde açık çizgi (sepet örgüsü) |
| `kopuk` | dolgu `l`, %92 | canlı köpük |
| `imza` | çizgi `d`, 4 birim | bir kez çizilen çizgi |

- Yalnız bu roller. Düz renk; degrade, gölge efekti, kontur (dış çizgi) yok: biçimler dolgu lekeleridir,
  çizgi yalnız `ps*` ve `imza` rolünde. Çizgi kalınlığı yalnız 4 ya da 7 (testte denetlenir); uçlar ve
  köşeler yuvarlak.
- Anlamı taşıyan parça `f` ya da `d` ile çizilir. `l` bazı takımlarda zemine çok yakındır (gökte `l`
  beyaz, `b` açık mavi; kumda `l` beyaz, `b` bej): `l` parçası `f` ya da `d` parçasının **üstünde**
  durmalı, levha zemininde tek başına anlam taşımamalı (köpük ve süs hariç). Çizim sekiz takımın hepsinde
  ve koyu temada okunur olmalı; katalog görüntüsüne bakılarak denetlenir.
- Varsayılan takım dosyadaki `LevhaRengi`'dir. Konunun gerçek rengine değil, takımın `f` rengine bakarak
  seçilir (kobalt takımında figür sarıdır: araba sarı). Bir günde yan yana gelen işler aynı takıma
  yığılmasın diye mevcut dağılıma bakılır (katalogda görülür).

**Biçim dili.** Hazır simge seti gibi durmaması için:
- Afiş gibi: büyük, tok, iki üç ana leke; ayrıntı az, ama bir tane **niyetli** ayrıntı olsun (arabanın
  köpükleri, fincanın buharı, panodaki imza, faturadaki şimşek, dişin pırıltısı). Nesneyi değil işin
  anını çiz: "araba" değil, "yıkanan araba".
- Köşeler yuvarlatılır (`q` eğrisi ya da 2–12 birim yarıçap); keskin köşe yalnız biçim gerektiriyorsa
  (çadır, şimşek, koli).
- Yazı, harf, rakam, logo, marka, yüz ve ifade (göz, ağız) yok; emoji gibi durmasın.
- Simge kütüphanesinden, yazı tipinden ya da başka bir çizimden yol kopyalanmaz; her yol bu projede
  elle yazılır. Yardımcılar: `daire(cx, cy, r)` ve `kutu(x, y, g, h, r)` SVG `circle`/`rect` karşılığı
  yol üretir; döndürülmüş parça grubu `donuk(aci, cx, cy) { … }`.

**Parça sayısı ve küçük parçalar.** 2–16 parça (canlı tekrarlar dahil; araba 16). Her parçanın uzun
kenarı en az 6 birim (testte denetlenir): daha küçüğü karakalemde kesik çizgiye boğulur, kare levhada
3–4 dp'ye düşer. Yazılış sırası çizim sırasıdır: arkadaki önce.

**Karakalem hâli nasıl türer.** Ayrıca çizilmez; boyalı tanımdan kendiliğinden türer (§7.3): her parça,
dolgulu olanlar da, `s-ink` renginde, 2 birim kalınlıkta, 5/5 kesikli çizgiyle yolunun çevresinden
çizilir; dolgu ve rol saydamlığı yok sayılır. Bu yüzden:
- Üst üste binen parçaların hepsinin çevresi görünür. Boyalıda tamamen örtülen arka parça koyma;
  karakalemde boş yere çizgi yığar.
- Bir yolun içindeki alt yollar (`M … z M … z`) karakalemde ayrı ayrı görünür; bunu bilerek kullan.
- Onay geçişinde (`ilerleme` 0 → 1) dolgu `rol saydamlığı × ilerleme`, karakalem `1 − ilerleme`
  saydamlığıyla birlikte çizilir; çizim dosyasında bunun için bir şey yapılmaz.

**Canlı parçalar (isteğe bağlı).** En çok bir tür (testte denetlenir); imza ile kalem birlikte tek tür
sayılır ve kalem imzasız olmaz. Değerler §5.15'tedir ve takımda sabittir; çizim yalnız hangi parçanın
canlı olduğunu söyler:

| Tür | Nasıl yazılır | Kural |
|---|---|---|
| köpük | `kopuk(yol)` (daire) | 3–6 küçük daire (r 4–9) figürün çevresinde; sıra kaydırması kendiliğinden |
| buhar | `ps2(yol, canli = Canlanma.BUHAR)` | figürün üstünde 1–2 kıvrık çizgi; 6 birim yükselir, üstte pay bırak |
| pırıltı | `pf(yol, canli = Canlanma.PIRILTI)` | 1–2 dört köşeli yıldız ya da artı; kendi merkezinde döner |
| bir kez çizilen çizgi | `imza(yol)` + isteğe bağlı `pd(yol, canli = Canlanma.KALEM)` | tek parça çizgi, baştan sona çizilir; kalem çizginin bitişinde durur |

- Canlı parça süstür: dinlenme karesinde de çizim tamamlanmış görünmelidir. Hareket azaltılınca, ekranda
  değilken ve uygulama arka plandayken parçalar dinlenme karesinde durur, imza tamamen çizili gelir;
  bunu `KayitCizimi` yapar, çizim dosyası bir şey yapmaz.
- Yeni bir canlanma türü (ör. alev titremesi) `Canlanma` ve `CizimHareketi` dosyalarına eklenir; bu çizim
  dosyası dışında bir değişikliktir ve ayrı iş olarak yapılır.

**Bitirme denetimi.** Çizim dosyası değişince:
1. `gradlew testDebugUnitTest --tests "dev.eren.ajanda.ekran.sahne.cizim.*"`: kurallar ve kayıt;
   `herAnahtarCizilir` yer tutucusu kalkan çizimin `genel`den farklı göründüğünü denetler.
2. `gradlew recordRoborazziDebug --tests "dev.eren.ajanda.ekran.sahne.cizim.CizimGoruntuTest"` ile
   `app/src/test/screenshots/sahne/cizim_katalog.png` yeniden kaydedilir ve bakılır: açık ve koyu;
   karakalem, yarı geçiş, boyalı; katalog hücresi (≈ 100 dp) kare levha boyuna yakındır, çizim orada
   tanınmalı.

## 8. Etkileşimler

Kaynak kısaltmaları bu bölümde ek olarak: `cetvel.js` = `parca/60-cetvel.js`, `cetvel.css` =
`parca/20-cetvel.css`, `tabela.js` = `parca/80-tabela.js`, `tabela.css` = `parca/40-tabela.css`.

### 8.1 Dokunma

| Nerede | Ne yapar | Kaynak |
|---|---|---|
| Levhanın herhangi bir yeri | Ayrıntıyı açar (§5.6) | `js:16`, `js:296` |
| Levhadaki daire, tarihsiz satırdaki daire | Tamamlar / geri alır (§5.2) | `js:7`, `js:297` |
| Taslakta "Onayla" / "Vazgeç" | §5.4 / §5.5 | `js:17` |
| Biten hap'ı, tarihsiz satırın adı | Ayrıntıyı açar | `js:52`, `js:54` |
| Alt çubuk: Bugün / Takvim | Sekme değişir (§5.12) | `js:25` |
| Alt çubuk: artı | Yeni kayıt (§5.11) | `js:25` |
| Takvim günü | Günü seçer | `js:302` |
| Ayrıntı: Çizim / Fotoğraf | Kapağı değiştirir (§5.8) | `js:160` |
| Ayrıntı: fotoğraf | Büyütür (§5.14) | `js:166` |
| Ayrıntı: bağlantı | Harita ya da belgeyi açar (prototipte tost) | `ortak:286` |
| Ayrıntı: "Fotoğraf ekle" | Sistem fotoğraf seçici | `js:166`, `js:207` |
| Tost: "Geri al" | Son işlemi geri alır | `ortak:261` |

- **[Ö]** Basılı geri bildirim: levha ve satırlar basılıyken 0.97 ölçeğe iner (`Hareket.yayHizli`);
  dalga (ripple) kullanılmaz. Prototipte basılı hâl yok (`kabuk:40`, dokunma vurgusu kapalı).
- Tamamlama dairesine dokunmak levhayı açmamalıdır (ayrı dokunma hedefi; prototipte iç içe düğmeler).

### 8.2 Sürükleme

| Nerede | Yön | Eşik / davranış | Kaynak |
|---|---|---|---|
| Ayrıntı kapağı | aşağı | 110 dp ya da 600 dp/s → kapat | §5.7, `js:192-194` |
| Takvim ızgarası | yatay | 56 dp → ay değişir | §5.12, `js:108-110` |
| Takvim şeridi, ayrıntı galerisi | yatay | serbest kaydırma, öğe ortaya oturur | `css:128`, `css:152` |
| Satır (Tabela'dan) | sağa | §8.3 | — |
| Mezura (Cetvel'den) | yatay | §8.4 | — |

Ortak sürükleme kuralı (`ortak:23-53`): 8 dp eşik, ilk yöne göre eksen kilidi, hız son iki olay arasından.
**[A]** Compose'da `ViewConfiguration.touchSlop` (≈8 dp) ve `VelocityTracker` kullanılır.

### 8.3 Sağa çekerek tamamlama (Tabela'dan alınır)

**Tabela'da** (`tabela.js:79-85`, `tabela.css:40-42`): satırın içi parmakla 0–150 dp sağa kayar; arkada
yeşil zemin (`--t-yesil`) üstünde "BİTTİ" (tamamlanmışsa "GERİ AL") yazar; `dx > 84 dp` bırakılırsa
tamamlanır; içerik her durumda 180 ms'de yerine döner. Taslak satırlarda kapalı.
Görüntü (Tabela panosu): `goruntu/8-tabela-pano.png`.

**Sahne'de [Ö]:**

- Geçerli olduğu yerler: tarihsiz satırlar, yoğun gündeki kompakt satırlar (§9), Bugün'deki kare ve büyük
  levhalar. **Geçerli olmadığı yerler**: takvim şeridi ve galeri (yatay kaydırmayla çakışır), taslaklar.
- Arkadaki zemin kaydın `b`'si, üstünde solda `i` renkli tik ve "Bitti" (tamamlanmışsa "Geri al").
  Çekilen içerik 0–150 dp, eşik **84 dp** ya da 800 dp/s sağa hız **[Ö]**.
- Eşik geçildiği anda hafif titreşim (bir kez); bırakınca §5.2 tamamlama oynar (bant zaten açılmış zeminden geçer).
- Geri dönüş `Hareket.yayHizli` (Tabela'nın adımlı `steps(4)` hareketi taşınmaz).
- Compose: `AnchoredDraggableState` (iki çapa: 0 ve 150 dp; `positionalThreshold = { 84.dp }`), ya da
  Material 3 `SwipeToDismissBox` yalnız `StartToEnd` yönüyle ve bırakınca yerine döndürülerek.
- Erişilebilirlik: sürükleme tek yol değildir; daire ve TalkBack özel eylemi aynı işi yapar (§10.3).

### 8.4 Mezura saat seçici (Cetvel'den alınır)

**Cetvel'de** (`cetvel.js:255-279`, `cetvel.css:157-166`; görüntü `goruntu/7-cetvel-mezura.png`):

- Ekran kenarından kenara 58 dp yüksekliğinde sarı bir şerit (`--c-sari #F7C600`, işaretler `--c-sari-ust
  #1C1A05`); ortada sabit bir ibre (2 dp, şeridin 6 dp üstüne ve altına taşar, `--c-ink`).
- Aralık **07:00–23:00** (`cetvel.js:3`, `B = 7, S = 23`), adım **15 dakika**, adım aralığı **18 dp**.
  Çeyrek işareti 10 dp boy 1 dp; saat işareti 22 dp boy 2 dp ve altında saat numarası (18 sp, 700, 28 dp aşağıda).
- Üstte büyük okuma ("13:00"; 46 sp, 700, dar kesim, eşit genişlikli rakam); her adımda 2 dp zıplar (90 ms).
- Başlangıç değeri: şimdiden 20 dakika sonrası, 15'e yukarı yuvarlanmış, en çok 23:00 (`cetvel.js:256`).
- Şerit kaydırılır ve en yakın işarete oturur (snap); klavyede sol/sağ ok bir adım (`cetvel.js:274`).
  Erişilebilirlikte `role=slider`, değer metni "13:00".

**Sahne'de [Ö]** (yeni kayıt ekranındaki saat hap'larının yerine):

- Şerit renkli zemin üstünde durduğu için takımdan boyanır: şerit zemini `l`, işaretler ve rakamlar `d`,
  ibre `i`. (Sarı şerit hardal ve kobalt zeminde kaybolur; `l`/`d` her takımda okunur.)
- Okuma 46 sp, 700, Bricolage Grotesque, `tnum`, `i` renginde; başlangıç değeri Cetvel'deki gibi.
- Aralık **00:00–23:45** **[Ö]** (prototipin 07–23 aralığı gece kayıtlarını dışarıda bırakır); adım 15 dk.
  5 dakikalık kayıt gerekiyorsa okumaya dokununca sistem saat seçicisi açılır **[Ö]**.
- Compose: `LazyRow` (öğe genişliği 18 dp, içerik dolgusu yarım ekran) + `rememberSnapFlingBehavior`;
  değer `firstVisibleItemIndex` ve kaydırma payından. Her adımda hafif tık titreşimi
  (`HapticFeedbackType.SegmentTick` varsa, yoksa `TextHandleMove`).
- Erişilebilirlik: `Modifier.semantics { progressBarRangeInfo = ...; setProgress { ... }; stateDescription
  = "13:00" }`; TalkBack ses tuşlarıyla 15 dk ilerler.

### 8.5 Sekmeli ayrıntı (Tabela'dan alınır)

**Tabela'da** (`tabela.js:143-160`, `tabela.js:175-182`, `tabela.css:84-88`): başlığın altında dört sekme
"Ayrıntılar · Fotolar² · Bağlantılar³ · Hatırlatma¹" (sayı üst simge, 12 sp); 44 dp boy, 17 sp 600;
seçili sekme dolu. Ayrıntılar: not, varış kutusu, tür/zaman/ekleyen. Sekme değişince içerik kanat gibi
çevrilir (90 + 130 ms).

**Sahne'de [Ö]:**

- Kapak ve başlık/zaman aynı kalır; altında yapışkan (sticky) hap sekmeler: **Ayrıntı · Fotoğraflar ·
  Bağlantılar · Hatırlatmalar**, sayılarıyla ("Fotoğraflar 2"). Biçim kapak seçiciyle aynı: `s-yuz` zemin
  hap, seçili `s-ink` dolgu / `s-bg` yazı, 40 dp görünür boy (48 dp dokunma).
- "Ayrıntı" sekmesi: varış kartı + not + "Ekleyen: Elle / Asistan" satırı (Tabela'dan).
- Boş sekme gizlenmez, sayısız görünür ve içinde boş metni olur ("Bağlantı yok.").
- **Ne zaman**: içerik bir ekranı geçiyorsa sekmeli; geçmiyorsa prototipteki tek sayfa. Basit kural
  **[Ö]**: fotoğraf, bağlantı ve hatırlatmadan **en az ikisi** doluysa sekmeli.
- Geçiş: `HorizontalPager` (sekmeler arası parmakla da geçilir), `Hareket.yay`; kanat çevirme taşınmaz.
- Aşağı çekerek kapatma sekmeli hâlde de yalnız kapaktan başlar.

### 8.6 Geri alma ve klavye

- Her yıkıcı ya da durum değiştiren işlem (tamamla, vazgeç) tostla geri alınabilir (`js:81`, `js:95`).
- Başlık alanında klavyenin "bitti" tuşu (`enterkeyhint=done`, `js:232`) formu gönderir:
  `KeyboardOptions(imeAction = ImeAction.Done)` + `onDone = { ekle() }`.
- Yeni kayıt açılınca başlık alanı **[Ö]** odaklanır ve klavye açılır (prototipte açılmıyor).

## 9. Yoğun gün [Ö]

**Sorun, ölçülerek.** 390 × 844 dp ekranda (içerik 358 dp, §3.2 ölçüleri):

| Açık iş | Bugün mozaiğinin boyu (baş ≈ 150 dp dahil) | Ekran |
|---|---|---|
| 3 | 150 + 301 + 10 + 209 ≈ 670 dp | 0.8 |
| 6 | 150 + 301 + 2 × 219 + 196 ≈ 1 085 dp | 1.3 |
| 12 | 150 + 301 + 5 × 219 + 196 ≈ 1 742 dp | 2.1 |
| 20 | 150 + 301 + 9 × 219 + 196 ≈ 2 618 dp | 3.1 |

Taslaklar her biri 196 dp (geniş + boşluk) daha ekler; büyük yazıda levhalar uzar (§10.2).

**Öneri: "sahne + sıra" düzeni.** Gün kalabalıklaşınca sahne kalır ama küçülür, geri kalanı sıra olur.

- **Eşik**: açık + taslak kayıt sayısı **6 ve üstü** (yazı ölçeği 1.3'ü aşıyorsa 4 ve üstü).
- **Sahne**: sıradaki iş **büyük** levha olarak kalır (canlı). Ardından gelen **iki** iş kare levha olarak
  yan yana kalır ("şimdi ve sonrası" hep resimli).
- **Sıra**: kalan açık işler, tarihsiz satırla aynı biçimde (§3.4) **kompakt satır**: solda 44 dp renkli
  küçük resim, ortada başlık ve altında zaman (`levhaAlt`, `s-soft`), sağda tamamlama dairesi; 60 dp boy,
  8 dp ara. Sıralama aynı (§3.2); gün bölümü saatten türetilmez (`YOL-HARITASI.md` 4.3).
  Satır sağa çekilerek tamamlanır (§8.3). Satıra dokununca ayrıntı açılır; ayrıntı satırın küçük resminden
  büyür (§5.6, aynı paylaşılan anahtar).
- **Öneriler**: birden çok taslak tek bir **karakalem geniş levha** olarak durur: "Asistanın 3 önerisi";
  içinde yatay kaydırılan karakalem kartlar, her birinde Onayla / Vazgeç. Onaylanan kart boyanıp (§5.4)
  sıraya iner. **[Ö]** "Hepsini onayla" yalnız bu gruplu levhada.
- **Bitenler** zaten hap'tır; 6'yı geçerse ilk 5 + "ve 4 iş daha" hap'ı (dokununca açılır).
- **Tarihsizler** 3'ü geçerse ilk 3 + "Tümünü göster (8)".
- Ölçüm: 12 açık işte 150 + 301 + 10 + 219 + 9 × 68 ≈ **1 292 dp (1.5 ekran)**; normal düzende 2.1 ekran.
  20 açık işte ≈ 1 836 dp (2.2 ekran; normalde 3.1).
- Geçiş: düzen değişince (ör. iş tamamlanıp sayı eşiğin altına inince) satırlar kare levhaya
  `sharedBounds` ile büyür (§5.3); sınır çevresinde gidip gelmeyi önlemek için düzen **yalnız gün açılışında
  ve sayı eşiği 2 farkla geçince** değişir **[Ö]** (6'da sıkışır, 4'e inince açılır).
- **Takvimde yoğun gün**: şerit 4 karttan fazlaysa şerit yerine aynı kompakt satırlar alt alta.
  Ay ızgarasında 3'ten fazla kayıtlı günde üçüncü noktanın yerine küçük "+" (`kucuk`, `s-soft`) **[Ö]**
  (prototip yalnız ilk üçünü gösterir, `js:104`).

## 10. Erişilebilirlik

### 10.1 Kontrast (ölçüldü)

WCAG 2.x göreli parlaklık formülüyle hesaplandı (yerel betik). Metin için en az 4.5 : 1, büyük metin ve
arayüz öğesi için 3 : 1.

| Çift | Açık | Koyu | Durum |
|---|---|---|---|
| `s-ink` / `s-bg` | 18.23 | 17.38 | iyi |
| `s-soft` / `s-bg` | 5.40 | 7.22 | iyi |
| `s-soft` / `s-yuz` | 4.79 | 6.36 | iyi (sınıra yakın, açık) |
| `s-vurgu-ust` / `s-vurgu` (artı simgesi) | 11.78 | 11.78 | iyi |
| `s-vurgu` / alt çubuk (`s-ink`) | 11.79 | **1.39** | koyu temada artı düğmesinin çubuktan ayrımı zayıf; simgenin kendisi okunur. **[Ö]** koyu temada artıya 2 dp `s-bg` halka |
| Levha yazısı `i` / `b` | 5.11 (domates) – 14.51 (gece) | 5.84 – 12.81 | sekiz takımın hepsi ≥ 4.5 |
| `foto-ust` / fotoğraf | — | — | perde (%62 siyah) olmadan güvence yok; perde levhanın alt %60'ında **zorunlu** |

Levha zemininin ekran zeminine karşıtlığı (arayüz öğesi sınırı):

| Takım | `b` / beyaz (açık) | `b` / `#0E0E11` (koyu) |
|---|---|---|
| kobalt / cam / domates | 6.31 / 6.49 / 5.11 | 2.62 / 2.52 / 3.30 |
| hardal / pembe | 1.82 / 1.87 | 9.08 / 8.84 |
| gok / kum | **1.36 / 1.33** | 11.98 / 12.03 |
| gece | 14.51 | **1.50** |

Levhanın anlamı yazıyla taşındığı için bu zorunlu değil; ama açık temada **gok ve kum**, koyu temada
**gece** levhasının kenarı zor seçilir. **[Ö]** Bu üç durumda levhaya 1 dp `s-line` çerçeve; takvim
noktalarında (açık temada gok/pembe/hardal 1.36–1.87) noktaya 1 dp `d` halka. Prototipte yok.

### 10.2 Büyük yazı

- Bütün yazılar `sp`; Android 14'ün doğrusal olmayan ölçeklemesi büyük başlıkları daha az büyütür.
- **[A]** Levhaların en/boy oranı **en az** yüksekliktir: `Modifier.aspectRatio` yerine
  `heightIn(min = genişlik × oran)`; yazı sığmazsa levha uzar, başlık en çok 3 satır, sonra "…".
- **[A]** Yazı ölçeği ≥ 1.5'te mozaik tek sütuna iner (kare levhalar geniş olur); yoğun gün eşiği 4'e iner (§9).
- **[A]** Alt çubukta yazı ölçeği ≥ 1.3'te "Bugün" ve "Takvim" yazıları gizlenir, simge + içerik açıklaması kalır.
- Mezura okuması ve saat numaraları da `sp`; şerit yüksekliği yazıyla büyür (58 dp en az).

### 10.3 TalkBack

- **Levha** tek odak düğümüdür (`Modifier.semantics(mergeDescendants = true)`): "⟨başlık⟩, ⟨zaman⟩,
  ⟨bölge⟩ bölgesi[, sıradaki iş]". Durum `stateDescription` ile: "tamamlandı", "asistan önerisi, onay
  bekliyor". Özel eylemler (`customActions`): **Tamamla / Geri al**, **Onayla**, **Vazgeç**; varsayılan
  dokunma ayrıntıyı açar. Prototip daireye "Tamamla: ⟨başlık⟩" etiketi veriyordu (`js:7`); Android'de
  daire de ayrı odaklanabilir kalır (dokunma hedefi), etiketi aynı.
- **Çizimler** dekoratiftir (`contentDescription = null`; prototipte `aria-hidden`, `ortak:202`).
  Fotoğraflar "Fotoğraf 1 / 2" gibi; kullanıcı fotoğrafına açıklama alanı ileride.
- **Takvim günü**: "Cuma, 27 Kasım, 5 kayıt" (`js:104`) **[Ö]** + ", 1 öneri" ve seçili durum
  (`selected = true`). Pager kullanılırsa ay değişimi "Aralık 2026" diye duyurulur.
- **Sekmeler**: alt çubuk `Role.Tab` ve seçili durumu; artı "Yeni kayıt" (`js:25`).
- **Yeni kayıt**: zaman türü ve seçenekler `Role.RadioButton` grubu (`js:234-235`); mezura kaydırıcı (§8.4).
- **Ayrıntı** açılınca odak başlığa, kapanınca açan levhaya döner. Kapat düğmesi "Kapat" (`js:159`).
  Aşağı çekme ve sağa çekmenin TalkBack karşılığı düğmeler ve özel eylemlerdir.
- **Tost** `LiveRegionMode.Polite`; eylemli tost TalkBack açıkken önerilen süre kadar kalır (§5.13).
- **Renk tek başına anlam taşımaz**: taslak = kesikli çerçeve + "Asistan önerdi" metni; tamamlanmış =
  tik + üstü çizili ad + soluk; sıradaki = en büyük levha + gün cümlesi.

## 11. Taşınmayacaklar

| Ne | Prototipte | Neden |
|---|---|---|
| Fotoğraf greni | `45-govde.html:8` (`feTurbulence`), `ortak:237` | Yalnız sahte fotoğrafı fotoğraf gibi göstermek içindi (`YOL-HARITASI.md` 4A). |
| Bulanıklık | `45-govde.html:7`, `ortak:207`, `ortak:213` | Aynı. |
| Sahte fotoğraf çizimleri (`FOTO`) ve degradeleri | `ortak:204-234`, `45-govde.html:2-6` | Uygulamada gerçek fotoğraf var. |
| Prototip kabuğu: yön seçici, künye, tema düğmesi, telefon çerçevesi, masaüstü düzeni | `kabuk:48-87`, `90-baslat.js`, `45-govde.html:10-31` | Yön seçme aracıydı. |
| Sabit "bugün" ve "şimdi", örnek veri | `ortak:56`, `ortak:79-103` | Uygulama gerçek saat ve kayıtları kullanır. Örnek metinler uydurmadır. |
| Fareyle sürükleme, Esc ile kapatma | `ortak:24-25`, `ortak:270`, `cetvel.js:276` | Android'de dokunma ve geri hareketi. |
| Cetvel'in ve Tabela'nın kendi görünümleri, yazı tipleri (Archivo, Barlow), kanat çevirme, adımlı (`steps`) hareketler | `20-cetvel.css`, `40-tabela.css`, `60-cetvel.js`, `80-tabela.js` | Yalnız mezura (§8.4), sağa çekme (§8.3) ve sekmeli ayrıntı (§8.5) alınır, Sahne diliyle. |
| Mezuranın sarısı (`--c-sari`) | `cetvel.css:158` | Sahne'de takımdan boyanır (§8.4). |
| `--s-perde` | `kabuk:17` | Sahne'de kullanılmıyor; alt sayfa gerekirse kullanılır. |
| Bağlantı kartındaki sahte harita/belge resimleri ve varış kartındaki harita çizimi | `js:8-11` | **[Ö]** Çizim olarak kalır (dış harita servisi yok, gizlilik); gerçek harita önizlemesi taşınmaz. |
| Saat hap'ları (09:00 … 20:00) | `js:227` | Mezura gelir (§8.4). |

## 12. Açık noktalar (karar gerekir)

1. **Sekmeler.** Ürün kararı "Tarihliler, Tarihsizler, Takvim" (`YOL-HARITASI.md` 4.3); Sahne prototipi
   "Bugün, Takvim" ve tarihsizleri Bugün'ün altına koyuyor. Önerim: alt çubuk **Bugün · artı · Takvim**
   kalsın; "Tarihliler" Bugün'ün altında "Yaklaşanlar" bölümü olarak (yarın ve sonrası, en çok 7 gün)
   gelsin. Karar ürün sahibinin.
2. **Dönem kayıtları** (birden çok güne yayılan) ızgarada şerit olarak ve **kalıcı kural işareti**:
   prototipte yok; Sahne diliyle çizilmeli.
3. **Düzenleme**: prototipte başlık, zaman, renk ve çizim sonradan değiştirilemiyor. Ayrıntıda bir
   "Düzenle" yolu ve kapakta "çizimi/rengi değiştir" seçicisi gerekir (çizim takımı ızgarası, renk takımı
   hap'ları).
4. **Silme** (onaylanmış kayıt): prototipte yok. Önerim: ayrıntıda taşma menüsü + tostla geri alma.
5. **Taslağı ayrıntıdan onaylama**: prototipte yok (§3.7).
6. **Geçmiş saatli, bitmemiş iş**: prototip, gelecekte saatli iş yoksa sıralamadaki ilk açık işi "sırada"
   sayar; bu sabahtan kalmış bir iş olabilir. Gecikmiş işin dili ve yeri (ör. "Sabahtan kaldı") kararı gerekir.
7. **Mezura aralığı ve adımı** (§8.4): 00:00–23:45 / 15 dk önerisi; 5 dk ihtiyacı.
8. **Çizim öneri tablosu** ile sözleşme v3 simge anahtarının eşlenmesi; 10 → 20–30 çizim.
9. **Yay değerleri** gerçek telefonda denenmedi; §4'teki sertlikler ilk tahmindir.
