# Telefon uygulaması: tasarım dili

Bu belge `app/` arayüzünün görsel ve etkileşim dilinin tek kaynağıdır. Ekranları yeniden yazan her agent
renk, yazı, boşluk, bileşen ve hareket kararını buradan alır; burada olmayan bir değeri kendisi uydurmaz,
eksik görürse raporlar. Davranış (ne zaman ne gönderilir, hangi durum ne demek) `app/TASARIM.md` ve
`app/src/cekirdek/` sözleşmesinden gelir; güvenlik `docs/GUVENLIK.md`'den. Çelişkide öncelik: güvenlik >
davranış > bu belge. Ad karışmasın: `app/TASARIM.md` modül tasarımıdır, bu belge görsel tasarım dilidir.

Kaynak: kullanıcının isteği: arayüz güzelleştirilsin, daha sade olsun ("slop" olmasın), pastel ve daha koyu
tonlar kullanılsın; ayrıntı tasarımcıya bırakıldı. Okunan mevcut
ekranlar: `App.tsx`, `src/ekranlar/*` (Sohbet, Plan, Rapor, Soru, Durum, Kurulum, `tema.ts`,
`Bilesenler.tsx`), yerel `OnayActivity.kt`. Kontrast ve renk ayrımı hesapla üretildi (bölüm 2.3, 2.4).

---

## 1. Yön

**Gece denizi zemin, pastel işaretler.** Kullanıcı daha sade, pastel ve daha koyu tonlar istedi: koyu tonlar
zemini ve balonları taşır, pasteller yalnız bir şey söylenecekse çıkar (eylem, durum, uyarı). Zemin nötr
siyah değil, Karadeniz'in gece rengi (koyu deniz mavisi-yeşili, 196°); vurgu olgun başak sarısı. Bu,
gece denizi ve olgun başak imgesine bağlanır ama asıl gerekçe işlevseldir: **sıcak renk dikkat
ve eylem, serin renk içerik** kuralı ekranı tek bakışta okunur kılar. Tek imza öğesi üst çubuğun
altındaki **hat**: telefonla PC arasındaki bağı gösteren 2 dp'lik çizgi. Sorun yoksa sıradan bir
ayraçtır, bağlanırken akar, kopunca renk değiştirir. Geri kalan her şey sessiz: gölge, degrade, emoji ve
büyük harfli etiket yok.

**Tema kararı: tek koyu tema.** Açık/koyu ikilisi yok. Gerekçe:

1. Kullanıcı koyu ton istedi; açık tema bu isteğe karşı ikinci bir yön olurdu.
2. Tek kullanıcı, tek cihaz. İkinci tema ikinci palet, ikinci kontrast tablosu ve her ekranın iki kez
   denetlenmesi demek; sadelik isteğine ters.
3. Yerel onay ekranı (`OnayActivity`) zaten koyu (`#121212`); tek koyu tema onunla birleşir.
4. Gün ışığı riski gövde metninin 12-15:1 kontrastıyla (AAA) karşılanır. Sistem açık temada olsa da
   uygulama koyu kalır. Jeton adları anlamsaldır (`zemin`, `metin`), "koyu" sözcüğü taşımaz; ileride açık
   palet gerekirse yalnız değerler değişir.

---

## 2. Renk

### 2.1 Kurallar

- **Koyu tonlar zemindir, pasteller işarettir.** Büyük alanlar (ekran, balon, kart, çekmece) koyu
  katmanlardan; pastel yalnız düğme dolgusu, durum metni, durum noktası, kenar vurgusu, rozet ve hatta.
- **Sıcak = dikkat ve eylem, serin = içerik.** Başak (`vurgu`), kayısı (`uyari`) ve gül (`hata`) bir şey
  yapılacak ya da bir şey ters gidiyorsa görünür. Kullanıcının balonu bilerek serin (koyu gece mavisi):
  ekranda en sık görünen öğe sakin kalmalı.
- **Renk hiçbir zaman tek başına bilgi taşımaz.** Her durum rengi yanında metinle gelir ("Bağlı",
  "Bağlantı yok"). Döteranopide `basari` ile `hata` neredeyse aynıdır (bölüm 2.4).
- **Bileşende hex yok.** Her renk `tema.ts`'teki `renk` nesnesinden gelir. Saydamlık (`opacity`) ile
  kapalı ya da basılı durum üretilmez; her durumun kendi jetonu var.
- **Derinlik açıklıkla verilir, gölgeyle değil:** `zemin` < `yuzey` < `yuzeyUst`.

### 2.2 Jetonlar

Değerler HSL tarifinden bir betikle üretildi (betik oturum çalışma alanında, repoda değil; yöntem 2.3'te).
Kotlin tarafı aynı hex'leri kullanır (bölüm 6.18).

| Jeton | Hex | Anlam ve kullanım |
|---|---|---|
| `zemin` | `#101A1E` | Ekran zemini, giriş çubuğu, üst çubuk. En koyu katman. |
| `yuzey` | `#1D2A2F` | Asistan balonu, kartlar, girdi kutusu, çekmece paneli. |
| `yuzeyUst` | `#26353B` | Diyalog, alt sayfa (eylem menüsü, çalışan işler). Kapalı birincil düğmenin dolgusu. |
| `secili` | `#283C43` | Çekmecede açık olan sohbetin satırı. |
| `basili` | `#324349` | Basılı satır, basılı ikincil ve metin düğmesi, basılı simge düğmesi. |
| `kenar` | `#35454B` | Ayraç, kart kenarı, hattın sakin hali, üst ve alt çubuk çizgisi. Dekoratif. |
| `kenarGuclu` | `#687F87` | İkincil düğme ve girdi kenarı (seçilebilir öğenin sınırı, 3:1). |
| `metin` | `#EFEAE1` | Birincil metin: mesajlar, başlıklar, düğme yazıları. Hafif sıcak kâğıt beyazı. |
| `metinIkincil` | `#AFBEC0` | Kart bölüm adları, alt başlık, diyalog gövdesi, sohbet önizlemesi. |
| `metinSonuk` | `#97A7AA` | Zaman, sistem notu, yer tutucu, kapalı düğme yazısı, sonuçlanmış durum. |
| `vurgu` | `#EDE0A1` | Olgun başak. Birincil düğme, odaklı girdi kenarı, karar bekleyen kart kenarı, rozet, metin düğmesi. |
| `vurguBasili` | `#D5C37B` | Basılı birincil düğme. |
| `vurguSecim` | `rgba(237, 224, 161, 0.35)` | Girdide seçili metnin arka planı (`selectionColor`). |
| `dolguUstu` | `#101A1E` | Pastel dolgunun (vurgu, hata, rozet) üstündeki metin ve simge. |
| `kullaniciBalon` | `#2B4455` | Kullanıcının balonu: koyu gece mavisi. Metni `metin`. |
| `asistanBalon` | `#1D2A2F` | Asistanın balonu (`yuzey` ile aynı değer, ayrı ad). Metni `metin`. |
| `basari` | `#9ED1B1` | Adaçayı. Bağlı, tamamlandı, onaylandı, cevaplandı. |
| `basariZemin` | `#1C3026` | Başarı şeridi zemini. |
| `basariKenar` | `#3C6752` | Başarı şeridi kenarı. |
| `uyari` | `#F2AC7D` | Kayısı. Bağlantı bekliyor, kirli içerik, yarım kaldı, limit, zaman aşımı. |
| `uyariZemin` | `#332519` | Uyarı şeridi zemini. |
| `uyariKenar` | `#6D4E36` | Uyarı şeridi kenarı. |
| `hata` | `#F4A4AA` | Gül. Bağlantı hatası, gönderilemedi, gizlenen plan, tehlikeli düğme, "Sil" satırı. |
| `hataZemin` | `#321B1E` | Hata şeridi zemini. |
| `hataKenar` | `#6A3940` | Hata şeridi kenarı. |
| `hataBasili` | `#DA8B90` | Basılı tehlikeli düğme. |
| `bilgi` | `#ACD0EC` | Açık gök. Bağlanıyor, eşitleniyor, iş sürüyor, asistan başka sohbette yazıyor. |
| `bilgiZemin` | `#192733` | Bilgi şeridi zemini. |
| `bilgiKenar` | `#36536D` | Bilgi şeridi kenarı. |
| `perde` | `rgba(6, 12, 14, 0.72)` | Çekmece, alt sayfa ve diyalog arkasındaki örtü. |

Durum renklerinin hangi durumda kullanılacağı bileşenlerde tablo halinde (bölüm 6).

Üretim tarifi (HSL; ton°, doygunluk %, açıklık %), bir jeton ayarlanacaksa buradan ayarlanıp hex ve
kontrast yeniden hesaplanır: katmanlar ton 196: `zemin` 30/9, `yuzey` 23/15, `yuzeyUst` 21/19, `secili`
26/21, `basili` 19/24, `kenar` 17/25, `kenarGuclu` 13/47. Metin: `metin` 40/32/91, `metinIkincil`
188/12/72, `metinSonuk` 190/10/63. `vurgu` 50/68/78, `vurguBasili` 48/52/66, `kullaniciBalon` 204/33/25.
Pasteller: `basari` 142/36/72, `uyari` 24/82/72, `hata` 356/78/80, `bilgi` 206/62/80, `hataBasili`
356/52/70. Durum zeminleri ve kenarları aynı tonun 15 ve 32 açıklıktaki hali: başarı 150/26, uyarı 26/34,
hata 352/30, bilgi 208/34. Yarı saydam karıştırma denendi, sıcak tonları griye çektiği için bırakıldı.

### 2.3 Kontrast tablosu (hesaplanmış)

Yöntem: WCAG 2.x göreli parlaklık (sRGB doğrusallaştırma, katsayılar 0,2126 / 0,7152 / 0,0722), oran =
(L1 + 0,05) / (L2 + 0,05). Eşik: normal metin 4,5:1 (AA; 7:1 üstü AAA), arayüz öğesi 3:1 (WCAG 1.4.11).
"Bilgi" satırları eşik taşımaz, katman farkını gösterir. 59 çiftin hepsi eşiğini geçiyor.

| Ön | Arka | Kullanım | Oran | Eşik | Sonuç |
|---|---|---|---|---|---|
| `metin` | `zemin` | gövde metni, ekran zemini | 14.75:1 | 4.5 | AAA |
| `metin` | `yuzey` | Asistan balonu, kart metni | 12.30:1 | 4.5 | AAA |
| `metin` | `yuzeyUst` | diyalog, çekmece, alt sayfa metni | 10.59:1 | 4.5 | AAA |
| `metin` | `kullaniciBalon` | Kullanıcı balonu metni | 8.50:1 | 4.5 | AAA |
| `metin` | `secili` | seçili sohbet satırı | 9.64:1 | 4.5 | AAA |
| `metin` | `basili` | basılı satır / ikincil düğme | 8.61:1 | 4.5 | AAA |
| `metinIkincil` | `zemin` | ikincil metin | 9.21:1 | 4.5 | AAA |
| `metinIkincil` | `yuzey` | kart bölüm adı, önizleme | 7.69:1 | 4.5 | AAA |
| `metinIkincil` | `yuzeyUst` | diyalog gövdesi | 6.62:1 | 4.5 | AA |
| `metinIkincil` | `secili` | seçili satırda önizleme | 6.02:1 | 4.5 | AA |
| `metinIkincil` | `kullaniciBalon` | Kullanıcı balonunda ikincil | 5.31:1 | 4.5 | AA |
| `metinSonuk` | `zemin` | zaman, sistem notu, yer tutucu | 7.09:1 | 4.5 | AAA |
| `metinSonuk` | `yuzey` | kart içi sönük, girdi yer tutucusu | 5.91:1 | 4.5 | AA |
| `metinSonuk` | `yuzeyUst` | çekmece/alt sayfa sönük, kapalı düğme | 5.09:1 | 4.5 | AA |
| `metinSonuk` | `secili` | seçili satırda zaman | 4.63:1 | 4.5 | AA |
| `dolguUstu` | `vurgu` | birincil düğme, rozet | 13.27:1 | 4.5 | AAA |
| `dolguUstu` | `vurguBasili` | basılı birincil düğme | 10.03:1 | 4.5 | AAA |
| `dolguUstu` | `hata` | tehlikeli düğme | 9.03:1 | 4.5 | AAA |
| `dolguUstu` | `hataBasili` | basılı tehlikeli düğme | 6.80:1 | 4.5 | AA |
| `vurgu` | `zemin` | vurgu metni | 13.27:1 | 4.5 | AAA |
| `vurgu` | `yuzey` | kartta "Onayını bekliyor" | 11.08:1 | 4.5 | AAA |
| `vurgu` | `yuzeyUst` | çekmecede vurgu | 9.53:1 | 4.5 | AAA |
| `basari` | `zemin` | başarı metni | 10.27:1 | 4.5 | AAA |
| `basari` | `yuzey` | kartta başarı durumu | 8.57:1 | 4.5 | AAA |
| `basari` | `yuzeyUst` | alt sayfada başarı | 7.38:1 | 4.5 | AAA |
| `basari` | `basariZemin` | başarı şeridi | 8.14:1 | 4.5 | AAA |
| `uyari` | `zemin` | uyarı metni | 9.23:1 | 4.5 | AAA |
| `uyari` | `yuzey` | kartta uyarı durumu | 7.70:1 | 4.5 | AAA |
| `uyari` | `yuzeyUst` | alt sayfada uyarı | 6.63:1 | 4.5 | AA |
| `uyari` | `uyariZemin` | uyarı şeridi | 7.73:1 | 4.5 | AAA |
| `hata` | `zemin` | hata metni | 9.03:1 | 4.5 | AAA |
| `hata` | `yuzey` | kartta hata durumu | 7.54:1 | 4.5 | AAA |
| `hata` | `yuzeyUst` | menüde "Sil" | 6.49:1 | 4.5 | AA |
| `hata` | `hataZemin` | hata şeridi | 8.19:1 | 4.5 | AAA |
| `bilgi` | `zemin` | bilgi metni | 10.93:1 | 4.5 | AAA |
| `bilgi` | `yuzey` | kartta "sürüyor" | 9.12:1 | 4.5 | AAA |
| `bilgi` | `yuzeyUst` | alt sayfada "sürüyor" | 7.85:1 | 4.5 | AAA |
| `bilgi` | `secili` | seçili satırda "iş sürüyor" | 7.15:1 | 4.5 | AAA |
| `bilgi` | `bilgiZemin` | bilgi şeridi | 9.42:1 | 4.5 | AAA |
| `metin` | `uyariZemin` | uyarı şeridinde gövde metni | 12.35:1 | 4.5 | AAA |
| `metin` | `hataZemin` | hata şeridinde gövde metni | 13.37:1 | 4.5 | AAA |
| `metin` | `bilgiZemin` | bilgi şeridinde gövde metni | 12.71:1 | 4.5 | AAA |
| `vurgu` | `uyariZemin` | uyarı şeridinde metin düğmesi | 11.12:1 | 4.5 | AAA |
| `vurgu` | `hataZemin` | hata şeridinde metin düğmesi | 12.03:1 | 4.5 | AAA |
| `vurgu` | `bilgiZemin` | bilgi şeridinde metin düğmesi | 11.44:1 | 4.5 | AAA |
| `kenarGuclu` | `zemin` | ikincil düğme / girdi kenarı (zeminde) | 4.19:1 | 3.0 | geçer |
| `kenarGuclu` | `yuzey` | ikincil düğme / girdi kenarı (kartta) | 3.49:1 | 3.0 | geçer |
| `kenarGuclu` | `yuzeyUst` | ikincil düğme kenarı (diyalogda) | 3.01:1 | 3.0 | geçer (sınırda) |
| `vurgu` | `zemin` | birincil düğme dolgusu, odaklı girdi kenarı | 13.27:1 | 3.0 | geçer |
| `vurgu` | `yuzey` | karar bekleyen kart kenarı | 11.08:1 | 3.0 | geçer |
| `hata` | `yuzeyUst` | tehlikeli düğme dolgusu (diyalogda) | 6.49:1 | 3.0 | geçer |
| `basari` | `zemin` | durum noktası (bağlı) | 10.27:1 | 3.0 | geçer |
| `uyari` | `zemin` | hat çizgisi (yeniden denenecek) | 9.23:1 | 3.0 | geçer |
| `hata` | `zemin` | hat çizgisi (bağlantı hatası) | 9.03:1 | 3.0 | geçer |
| `bilgi` | `kenar` | hattın akan parçası, izine göre | 6.17:1 | 3.0 | geçer |
| `yuzey` | `zemin` | Asistan balonu / kart ile zemin farkı | 1.20:1 | — | bilgi |
| `kullaniciBalon` | `zemin` | Kullanıcı balonu ile zemin farkı | 1.73:1 | — | bilgi |
| `yuzeyUst` | `zemin` | çekmece / diyalog ile zemin farkı | 1.39:1 | — | bilgi |
| `kenar` | `zemin` | ayraç çizgisi (dekoratif) | 1.77:1 | — | bilgi |

Jetonlardan biri değişirse tablo yeniden hesaplanır; tahminle güncellenmez. `kenarGuclu` diyalogda
sınırda (3,01): ikincil düğmenin yazısı zaten 10:1 olduğu için kabul edildi, ama bu jeton koyulaştırılmaz.

### 2.4 Pasteller birbirinden ayrılıyor mu

CIELAB ΔE76; renk körlüğü Machado 2009 matrisiyle (şiddet 1,0) benzetildi. ΔE 10 altı karışabilir.

| Çift | Normal | Döteranopi | Protanopi |
|---|---|---|---|
| `vurgu` / `basari` | 30.0 | 26.0 | 20.8 |
| `vurgu` / `uyari` | 28.3 | 12.1 | 15.4 |
| `vurgu` / `hata` | 44.4 | 23.6 | 34.0 |
| `vurgu` / `bilgi` | 50.7 | 52.3 | 49.9 |
| `basari` / `uyari` | 49.6 | 27.7 | 19.1 |
| `basari` / `hata` | 53.6 | **3.8** | 13.7 |
| `basari` / `bilgi` | 33.2 | 27.9 | 30.2 |
| `uyari` / `hata` | 27.2 | 24.2 | 27.6 |
| `uyari` / `bilgi` | 58.4 | 55.6 | 48.5 |
| `hata` / `bilgi` | 45.3 | 31.5 | 22.8 |
| `kullaniciBalon` / `asistanBalon` | 14.0 | 14.1 | 14.3 |

İlk denemede `vurgu` ile `uyari` 17,8 (döteranopide 6,2) çıktı; başak sarıya, kayısı turuncuya
kaydırılarak 28,3 / 12,1'e açıldı. `basari`/`hata` döteranopide ayrışmaz; bu yüzden bölüm 2.1'deki
"renk tek başına bilgi taşımaz" kuralı zorunludur ve hat, bağlıyken yeşil değil nötrdür.

---

## 3. Yazı

**Varsayılan plan: yalnız sistem fontu.** `fontFamily` verilmez; Android sistem yazı tipini kullanır
(test telefonunda üretici arayüzünün sistem fontu). Tek istisna makine metni: klasör yolu, paket adı, dosya listesi,
komut. Bunlarda `fontFamily: "monospace"`. Etiket, zaman ya da sayı için monospace kullanılmaz.
Gömülü font önerisi ayrı (bölüm 9) ve isteğe bağlıdır.

**Ölçek** (sp; satır yüksekliği dp, tam sayı). Yazı jetonları renk taşımaz; renk kullanım yerinde
`renk`'ten verilir.

| Jeton | Boyut | Satır | Ağırlık | Kullanım |
|---|---|---|---|---|
| `buyuk` | 22 | 28 | 600 | Durum ve Kurulum ekran başlığı. Sohbette yok. |
| `baslik` | 18 | 24 | 600 | Üst çubukta sohbet adı, kart başlığı, diyalog başlığı, çekmece başlığı. |
| `govde` | 16 | 24 | 400 | Mesaj metni, kart gövdesi, liste satırı adı, girdi. |
| `govdeKalin` | 16 | 24 | 600 | Düğme yazısı, seçili sohbet adı, durum değeri. |
| `kucuk` | 14 | 20 | 400 | Alt başlık, önizleme, sistem notu, şerit metni, bölüm notu. |
| `kucukKalin` | 14 | 20 | 600 | Kart türü ve bölüm adı ("Kesin yapılacaklar"), menü başlığı. |
| `mini` | 12 | 16 | 400 | Zaman, balon altı durum ("Bağlantı bekliyor"). En küçük boyut budur. |
| `miniKalin` | 12 | 16 | 600 | Okunmamış rozeti. |
| `kod` | 14 | 20 | 400 | Makine metni (`monospace`). |

Kurallar:

- İki ağırlık: 400 ve 600. 700 ve üstü yok. (600 bazı ROM'larda 700 gibi görünebilir; sorun değil.)
- Harf aralığı 0. `textTransform: "uppercase"` yasak: hem şablon görünümü verir hem de Türkçe `i`/`İ`
  dönüşümü dile bağlı değildir ("İş" yanlış büyür). Mevcut `stil.etiket` bunu kullanıyor, kalkacak.
- Her metin stilinde `includeFontPadding: false` (Android dikey ortalama).
- Sistem yazı boyutu büyütmesine uyulur. Mesaj metninde sınır yok; üst çubuk, düğme, rozet ve sekme
  gibi sabit yükseklikli öğelerde `maxFontSizeMultiplier: 1.4`.
- Satır uzunluğu: balon en çok ekranın %82-88'i olduğu için 16 sp'de satır başına yaklaşık 35-45 karakter
  düşer; ayrıca sınır gerekmez.
- Güvenilmez metin (Asistan çıktısı, plan, rapor) düz `Text` ile, otomatik bağlantısız, `selectable` gösterilir
  (mevcut `Duz` bileşeni). Bu bir güvenlik kuralıdır; görünüm için delinmez.

---

## 4. Boşluk, köşe, kenar, gölge

**Boşluk** (4 dp ızgara; anahtar = 4'ün katı):

| Jeton | dp | Kullanım |
|---|---|---|
| `bosluk[1]` | 4 | Aynı göndericinin ardışık balonları arası, simge ile metin arası. |
| `bosluk[2]` | 8 | Düğmeler arası, kart içi satırlar arası, nokta ile metin arası. |
| `bosluk[3]` | 12 | Gönderici değişince balonlar arası, kart ile balon arası, giriş çubuğu yatay iç boşluğu. |
| `bosluk[4]` | 16 | Ekran kenar boşluğu, kart iç boşluğu, kart bölümleri arası. |
| `bosluk[6]` | 24 | Diyalog iç boşluğu, bölüm başlığı üstü (Durum, Kurulum). |
| `bosluk[8]` | 32 | Boş durum metninin yatay boşluğu. |

Ekran kenar boşluğu her yerde 16. Dokunma hedefi en az 48×48 dp (`olcu.dokunma`); görsel olarak küçük
öğe (`hitSlop` ile) 48'e tamamlanır.

**Köşe yarıçapı** (hiyerarşiye göre; her şeye aynı yarıçap verilmez):

| Jeton | dp | Kullanım |
|---|---|---|
| `yaricap.kucuk` | 8 | Satır içi şerit (kirli, gizlenen plan, sistem uyarısı), balonun gönderici tarafındaki alt köşesi. |
| `yaricap.orta` | 12 | Düğme, girdi, kart. |
| `yaricap.buyuk` | 18 | Balon, diyalog, alt sayfanın üst köşeleri. |
| `yaricap.tam` | 999 | Rozet, iş hapı, "en alta in" düğmesi, durum noktası. |

Üst çubuğa yapışık durum şeridi ve çekmece paneli köşesizdir.

**Kenar kalınlığı:** `cizgi.ince` = `StyleSheet.hairlineWidth` (ayraçlar, üst/alt çubuk çizgisi),
`cizgi.normal` = 1 (kart, ikincil düğme, girdi, şerit), `cizgi.kalin` = 2 (hat).

**Gölge: yok.** `elevation` ve `shadow*` hiçbir yerde kullanılmaz. Katman ayrımı zemin açıklığıyla
(`zemin` → `yuzey` → `yuzeyUst`) ve gerektiğinde 1 dp kenarla yapılır. Örtülü katmanlarda (çekmece,
diyalog) ayrımı `perde` verir.

---

## 5. Düzen ve gezinme

**Karar: alt sekme çubuğu kalkar.** Bugünkü üç sekmeden (Sohbet, Durum, Kurulum) yalnız Sohbet her gün
kullanılıyor; çoklu sohbetle birlikte sohbet listesi bir çekmeceye girer, Durum ve Kurulum çekmecenin
altına iner. Ekranın 56 dp'si sohbete geri döner, klavye açılınca sekme çubuğunu gizleme mantığı da
gereksizleşir. Gezinme kütüphanesi eklenmez: `App.tsx` içinde `ekran: "sohbet" | "durum" | "kurulum"`
durumu ve `BackHandler` yeter (Durum/Kurulum'da geri tuşu sohbete döner).

İlk açılışta eşleşme yoksa Kurulum ekranı açılır.

Sohbet ekranının iskeleti:

```
+------------------------------------------+
| (=)  Ölçüm betiği              (o 2 iş) (+)|  üst çubuk, 56 dp + durum çubuğu boşluğu
|      o Asistan yazıyor                    |
|==========================================|  hat, 2 dp
| Bağlantı yok. Mesajların telefonda   Şimdi|  durum şeridi (yalnız sorun sürerse)
| bekliyor, bağlanınca gider.        bağlan |
|                                          |
|                  +---------------------+ |
|                  | Kullanıcı balonu    | |
|                  +---------------------+ |
|  +----------------------------+          |
|  | Asistan balonu             |          |
|  +----------------------------+          |
|  +--------------------------------------+|
|  | PC işi planı       o Onayını bekliyor||  karar bekleyen kart: vurgu kenarı
|  | Ölçüm betiğini çalıştır              ||
|  | [ Reddet ]           [   Onayla   ]  ||
|  +--------------------------------------+|
|             Asistan yeni bir oturuma geçti|  sistem notu
|                                   ( v 3 )|  en alta in
|------------------------------------------|
| [ Asistana yaz                  ] [Dikte]|  giriş çubuğu
+------------------------------------------+
```

---

## 6. Bileşenler

Durum tablolarında "zemin / metin / kenar" sütunları `renk` jetonudur.

### 6.1 Üst çubuk

- Yükseklik 56 + durum çubuğu boşluğu (bölüm 12.4). Zemin `zemin`. Altında hat (6.2).
- Soldan sağa: menü simge düğmesi (48×48, `accessibilityLabel="Sohbetler"`), başlık bloğu (esnek), iş hapı
  (yalnız iş varsa), yeni sohbet simge düğmesi (`arti`, `accessibilityLabel="Yeni sohbet"`).
- Başlık bloğu: sohbet adı `baslik` + `metin`, tek satır, sonu `…`. Altında alt başlık: 8 dp nokta +
  `kucuk` metin. Başka bir sohbette okunmamış varsa menü simgesinin sağ üstünde 8 dp `vurgu` noktası.
- Alt başlık durumu (yukarıdan aşağı ilk tutan kazanır):

| Koşul | Nokta | Alt başlık metni | Metin rengi |
|---|---|---|---|
| `hata !== null` ve bağlı değil | `hata` | Bağlantı yok | `hata` |
| `baglanti === "kapali"`, yeniden deneme planlı | `uyari` | Bağlantı yok, yeniden denenecek | `metinIkincil` |
| `baglanti === "baglaniyor"` | `bilgi` | Bağlanıyor | `metinIkincil` |
| `baglanti === "el_sikisma"` | `bilgi` | Kimlik doğrulanıyor | `metinIkincil` |
| bağlı, `esitleniyor` | `bilgi` | Eksik mesajlar alınıyor | `metinIkincil` |
| bağlı, bu sohbette akış var | `basari` | Asistan yazıyor | `metinIkincil` |
| bağlı, `sunucu.eren === "baslatiliyor"` | `basari` | Asistan başlatılıyor | `metinIkincil` |
| bağlı, `sunucu.eren === "kapali"` | `uyari` | Bağlı, asistan kapalı | `metinIkincil` |
| bağlı | `basari` | Bağlı | `metinIkincil` |

- **İş hapı** (yalnız çalışan iş sayısı > 0): yükseklik 32, yatay iç boşluk 12, `yaricap.tam`, zemin
  `zemin`, kenar 1 `kenar`; içinde 8 dp `bilgi` noktası + `kucuk` `metin` "2 iş". Dokunma hedefi 48'e
  `hitSlop` ile. Basılı: zemin `basili`. Dokununca "Çalışan işler" alt sayfası (6.15).
  `accessibilityLabel="2 iş çalışıyor, listeyi aç"`.

### 6.2 Hat (imza öğesi)

Üst çubuğun hemen altında, tam genişlik, yüksekliği her durumda 2 dp (durum değişince düzen kaymaz).
Anlamı alt başlıktaki metin taşır; hat görsel tekrardır, erişilebilirlik ağacına girmez
(`importantForAccessibility="no-hide-descendants"`).

| Durum | Görünüm |
|---|---|
| Bağlı, eşitleme yok | Yalnız altta `cizgi.ince` kalınlığında `kenar`. Sıradan bir ayraç; dikkat çekmez. |
| Bağlanıyor, kimlik doğrulanıyor, eşitleniyor | 2 dp `kenar` iz üstünde ekran genişliğinin %30'u kadar `bilgi` parça soldan sağa akar: `translateX` −%30'dan %100'e, `sure.hat` (1400 ms), `Easing.inOut(Easing.ease)`, döngü. |
| Bağlantı yok, yeniden denenecek | 2 dp düz `uyari`. |
| Bağlantı hatası | 2 dp düz `hata`. |
| Az hareket açık | Akan parça yerine 2 dp düz `bilgi`. |

Uygulamada hareket eden tek kalıcı öğe budur; o da yalnız bir şey olurken hareket eder.

### 6.3 Durum şeridi (çevrimdışı ve hata)

- Hattın altında, tam genişlik, köşesiz, alt kenarı 1 dp. İç boşluk yatay 16, dikey 10. Satır: metin
  (`kucuk`, esnek) + sağda metin düğmesi.
- Bağlantı sorunu **3 sn'den uzun sürerse** görünür (`sure.seritGecikme`); hızlı yeniden bağlanmalarda
  titremez. Depo hatası hemen görünür.
- Toast, modal ya da tam ekran hata yok; şerit sorun çözülünce kaybolur.

| Tür | Koşul | Zemin | Metin | Kenar | Metin içeriği | Düğme |
|---|---|---|---|---|---|---|
| uyarı | bağlantı kapalı, yeniden deneme planlı | `uyariZemin` | `metin` | `uyariKenar` | Bağlantı yok. Mesajların telefonda bekliyor, bağlanınca gider. | "Şimdi bağlan" → `simdiBaglan()` |
| hata | `hata` bir bağlantı/kimlik hatası | `hataZemin` | `metin` | `hataKenar` | Hata koduna göre bir cümle; eşlemesiz kodda "Bağlanılamadı ({kod}). Kurulum ekranına bak." | "Kurulum" |
| hata | `depo_hatasi` ya da açılış hatası | `hataZemin` | `metin` | `hataKenar` | Telefondaki kayıt okunamadı. Uygulamayı kapatıp yeniden aç. | yok |

Metin düğmesi şeritte de `vurgu` renklidir (kontrastı 11:1 üstü).

### 6.4 Mesaj balonları

Ortak: iç boşluk dikey 10, yatay 14; `yaricap.buyuk`, gönderici tarafındaki alt köşe `yaricap.kucuk`;
metin `govde` + `metin`, `selectable`; kenar ve gölge yok. Aynı göndericinin ardışık balonları arası
`bosluk[1]`, gönderici değişince `bosluk[3]`. Balon başına avatar ya da ad yok; hizalama ve renk yeter.

**Kullanıcı balonu**: sağa yaslı, en çok liste genişliğinin %82'si, zemin `kullaniciBalon`, sağ alt köşe 8.
Henüz olayı gelmemiş mesajın durumu balonun altında, sağa yaslı, `mini`:

| Bekleyen durumu | Metin | Renk |
|---|---|---|
| `kuyrukta` | Bağlantı bekliyor | `uyari` |
| `yollandi` | Gönderiliyor | `metinSonuk` |
| `teslim_edildi` | Teslim edildi | `metinSonuk` |
| olay geldi (`ogeler` içinde) | yok | — |

Gönderilemeyen mesaj (`hatalar`): balonun yerinde satır içi hata şeridi (6.6) "Gönderilemedi ({kod}):
{metnin ilk 80 karakteri}" + "Kapat" metin düğmesi.

**Asistan balonu**: sola yaslı, en çok %88 (uzun yanıtlar için daha geniş), zemin `asistanBalon`, sol alt köşe 8.

| Durum | Görünüm |
|---|---|
| Kalıcı yanıt | Balon. |
| Akış başladı, metin boş | Yazıyor göstergesi (6.11) balonun içinde. |
| Akış sürüyor | Balon büyür. Altında solda `mini` `metinSonuk` "Yazıyor" ve aynı satırda "Turu kes" metin düğmesi. Bugünkü giriş çubuğu üstündeki tam genişlik "Turu kes" düğmesi kalkar; düğme durdurduğu şeyin yanında durur. |
| Tur kesildi, yarım metin var | Balon, metni `metinIkincil`; altında `mini` `metinSonuk` "Tur kesildi, yanıt yarım kaldı." |
| Tur kesildi, metin yok | Ortalanmış sistem notu "Tur kesildi." |

**Zaman ayracı**: iki öğe arasında 30 dakikadan uzun boşluk varsa ortada `mini` `metinSonuk`: bugünse
"14:32", dünse "Dün 22:10", daha eskiyse "3 Kasım 09:05". Balon başına zaman damgası yok.

### 6.5 Sistem notu, devir, iş satırı

- **Bilgi notu** (`sistem` + `seviye === "bilgi"`, devir, kısa tur notları): ortalanmış, en çok %85
  genişlik, `kucuk` `metinSonuk`, zeminsiz. Devir: "Asistan yeni bir oturuma geçti (nesil 3)."
- **Uyarı ve kritik not**: satır içi şerit (6.6), sırasıyla uyarı ve hata türü.
- **İş satırı** (`tur === "is"`): sola yaslı tek satır, 8 dp nokta + `kucuk` `metinIkincil`:
  "İş 12 sürüyor: {başlık}". Dokununca Çalışan işler alt sayfası açılır. İş bitince nokta rengi ve metin
  değişir: tamam `basari` "İş 12 bitti", hata `hata` "İş 12 hatayla bitti", yarım ve limit `uyari`
  "İş 12 yarım kaldı" / "İş 12 limitte durdu", iptal `metinSonuk` "İş 12 iptal edildi". Rapor kartı
  ayrıca gelir.

### 6.6 Satır içi şerit

Zaman çizelgesinde ve kart içinde uyarı kutusu: zemin `uyariZemin` / `hataZemin` / `bilgiZemin`, kenar 1 dp
ilgili `*Kenar`, `yaricap.kucuk`, iç boşluk 12, metin `kucuk` ve ilgili pastel (`uyari`, `hata`, `bilgi`).
Metinde sözcük vurgulanmaz, "UYARI:" gibi büyük harfli önek konmaz; şeridin rengi ve yeri yeter.

Kullanım: kirli plan/rapor (uyarı), gizlenen plan (hata, mevcut metin korunur), gönderilemedi (hata),
sistem uyarısı (uyarı), kritik sistem notu (hata), serbest metin isteği (uyarı).

### 6.7 Kartlar: ortak

Plan, rapor ve soru kartı tam genişliktir (balon değildir): zemin `yuzey`, kenar 1 dp `kenar`,
`yaricap.orta`, iç boşluk 16, satırlar arası 8, bölümler arası 16.

- **Başlık satırı**: solda kart türü `kucukKalin` `metinIkincil`; sağda durum etiketi (8 dp nokta +
  `kucuk` metin, durum renginde). Ara nokta ("·") ile birleştirilmiş meta dizisi kullanılmaz; bugünkü
  "Plan · PC işi · Onayını bekliyor" iki ayrı öğeye bölünür.
- **Kart türü adları**: "PC işi planı", "Telefon işi planı", "İş 12 raporu", "İş 12 sorusu".
- **Başlık**: `baslik` `metin`.
- **Bölüm adları**: `kucukKalin` `metinIkincil`, cümle düzeninde ("Görev metni", "Kesin yapılacaklar",
  "Kesin yapılmayacaklar", "Yapıldı", "Yapılmadı", "Dosyalar", "Açık noktalar").
- **Maddeler**: satır = 16 dp genişlikte "•" + esnek metin (asılı girinti). `govde` `metin`.
- **Makine metni** (klasör, dosya, paket adı): `kod` `metinIkincil`, `selectable`.
- **Karar bekleyen kart** (plan `bekliyor`, soru `bekliyor`): kenar 1 dp `vurgu`. Yalnız bunlar; ekrandaki
  sarı çerçeve "senden bir şey bekleniyor" demektir.
- **Sonuçlanmış plan kartı** varsayılan kapalıdır: başlık satırı + başlık + "Ayrıntı" metin düğmesi;
  açılınca "Gizle". Rapor açık gelir ama her liste ilk 5 maddeyi gösterir, fazlası için
  "Tümünü göster (12)". Açma/kapama anında olur, animasyon yok.
- **Düğme satırı**: düğmeler eşit genişlik, arası 8; ikincil solda, birincil sağda.
- **Sonuç notu** (karar gönderildi vb.): düğmelerin altında `kucuk` `metinIkincil`; ret ve hata notu
  `hata`.

Durum etiketleri (nokta ve metin aynı renk):

| Kart | Durum | Metin | Renk |
|---|---|---|---|
| Plan | `bekliyor` | Onayını bekliyor | `vurgu` |
| Plan | `onaylandi` | Onaylandı | `basari` |
| Plan | `reddedildi` | Reddedildi | `metinSonuk` |
| Plan | `iptal` | İptal edildi | `metinSonuk` |
| Rapor | `tamam` | Tamamlandı | `basari` |
| Rapor | `hata` | Hata | `hata` |
| Rapor | `yarim` | Yarım kaldı | `uyari` |
| Rapor | `iptal` | İptal edildi | `metinSonuk` |
| Rapor | `limit_durdu` | Limit nedeniyle durdu | `uyari` |
| Soru | `bekliyor` | Cevap bekliyor | `vurgu` |
| Soru | `cevaplandi` | Cevaplandı | `basari` |
| Soru | `zaman_asimi` | Zaman aşımı | `uyari` |
| Soru | `iptal` | İptal edildi | `metinSonuk` |
| İş | `suruyor` | Sürüyor | `bilgi` |

(Soru kartı bugün sonuçlanınca ham `kart.durum` değerini yazıyor; yukarıdaki metinler kullanılır.)

### 6.8 Plan, rapor ve soru kartına özel

- **Plan**: başlık altında kirli uyarısı (şerit), sonra `kod` ile "Klasör: …", görev metni, kesin
  yapılacaklar / yapılmayacaklar, telefon izni bölümü (mod "okuma"/"yazma", uygulamalar `kod` ile alt
  alta, serbest metin isteği uyarı şeridiyle). Düğmeler: "Reddet" (ikincil) + "Onayla" (birincil);
  telefon işinde "Telefonda izin iste" (birincil). Meşgulken iki düğme de kapalı, birincil yazısı
  "Gönderiliyor".
- **Rapor**: kirli uyarısı (şerit) başlığın altında; rapor yoksa `kucuk` `metinSonuk` "Rapor yok."
- **Soru**: soru metni `govde`; seçenekler alt alta tam genişlik ikincil düğmeler; serbest cevap girdisi
  (6.9'daki girdi stili, `yuzey` üstünde olduğu için zemini `zemin`) + "Cevabı gönder" (birincil).
  Sonuçlanınca: soru + `kucuk` `metinIkincil` "Cevap: …".

### 6.9 Giriş çubuğu

- Kap: zemin `zemin`, üstte `cizgi.ince` `kenar`, iç boşluk yatay 12 dikey 8, satır, `alignItems:
  "flex-end"`, ara 8. Alt güvenli alan boşluğu altına eklenir (bölüm 12.4).
- **Girdi**: esnek, en az 48 en çok 140 dp (yaklaşık 5 satır, sonra kayar); zemin `yuzey`; kenar 1 dp
  `kenarGuclu`, odaktayken `vurgu`; `yaricap.orta`; iç boşluk yatay 14 dikey 12; `govde` `metin`;
  `placeholderTextColor` `metinSonuk`; `cursorColor` `vurgu`; `selectionColor` `vurguSecim`;
  `selectionHandleColor` `vurgu`.
- Yer tutucu: bağlıyken "Asistana yaz"; bağlı değilken "Asistana yaz, bağlanınca gider".
- **Tek eylem yuvası** (en az 88 dp genişlik, böylece değişirken çubuk zıplamaz): girdi boşken ikincil
  "Dikte" (cihaz desteklemiyorsa yuva gizli); girdi doluyken birincil "Gönder". İki düğme yan yana
  durmaz.
- Gönderme ya da dikte hatası: çubuğun hemen üstünde, yatay 16 boşlukla `kucuk` `hata` tek satır.
  Sonraki başarılı gönderimde kalkar.
- Kendi mesajını gönderince liste, nerede olursa olsun en alta iner.

### 6.10 En alta in düğmesi (yeni)

- **Ne zaman görünür:** listenin alttan uzaklığı 240 dp'yi aşınca (`esik.altaInGoster`); 80 dp'nin
  altına inince gizlenir (`esik.altaInGizle`). İki eşik arasındaki fark titremeyi önler.
- **Kendiliğinden kaydırma kuralı (davranış değişikliği):** Kullanıcı alttayken (80 dp içinde) yeni içerik
  listeyi altta tutar. Yukarıdayken yeni içerik listeyi **kaydırmaz**, sayaç artar. Bugünkü kod her
  değişiklikte `scrollToEnd` çağırıyor; geçmişi okurken ekran elinden kaçıyor.
- **Okunmamış sayısı:** Kullanıcı alttan ayrıldıktan sonra gelen asistan kaynaklı öğeler sayılır: `asistan`,
  `plan`, `soru`, `rapor`, `tur_kesildi`, `devir`, uyarı/kritik `sistem`. Başlayan bir akış 1 sayılır
  (her delta değil). Kullanıcının kendi mesajları ve iş satırları sayılmaz. 99'dan sonra "99+".
- **Görünüm:**

| Durum | Biçim | Zemin | İçerik | Kenar |
|---|---|---|---|---|
| Sayı 0 | 44 dp daire (`hitSlop` ile 48) | `yuzeyUst` | `asagi` simgesi, `metin` | 1 dp `kenar` |
| Sayı > 0 | 40 dp yükseklikte hap, yatay iç boşluk 14 | `vurgu` | `asagi` simgesi + `miniKalin` sayı, `dolguUstu` | yok |
| Basılı | aynı | `basili` / `vurguBasili` | aynı | aynı |

- **Yer:** sağdan 16, giriş çubuğunun 12 dp üstü; klavye açıkken de çubuğun üstünde kalır.
- **Dokununca:** `scrollToEnd({ animated: !azHareket })`, sayaç sıfırlanır.
- **Giriş/çıkış:** opaklık 0→1 ve `translateY` 8→0, `sure.hizli`.
- `accessibilityLabel`: "En alta in" ya da "En alta in, 3 yeni mesaj".

### 6.11 Yazıyor ve yükleniyor göstergeleri

- **Asistan yazıyor (metin henüz yok)**: Asistan balonu (64×38) içinde 6 dp üç nokta, renk `metinIkincil`;
  opaklık 0,3→1→0,3, noktalar arası 160 ms gecikme, döngü `sure.nokta` (1200 ms).
  `accessibilityLiveRegion="polite"`, etiket "Asistan yazıyor". Az hareket açıksa noktalar duran üç nokta.
- **Uygulama açılışı**: `baslat` 300 ms'den uzun sürerse ortada küçük `ActivityIndicator` (`metinSonuk`)
  + `kucuk` "Yükleniyor". Daha kısa sürerse hiçbir şey gösterilmez.
- **Meşgul düğme**: döndürücü yok; düğme kapanır ve yazısı süreci söyler ("Gönderiliyor").
- İskelet, parıltı (shimmer) ya da tam ekran yükleme perdesi yok.

### 6.12 Çekmece: sohbet listesi (yeni)

```
+--------------------------------+:::::::
| Sohbetler                      |:::::::
| [ + Yeni sohbet              ] |:::::::   perde
|--------------------------------|:::::::
| Ölçüm betiği            14:32 ...|:::::   seçili satır: zemin `secili`
| Asistan yazıyor                  |:::::
| Commit özeti              Dün (3)...|:::  (3) = okunmamış rozeti
| Sen: Tamam, PR'ı aç.             |:::::
| Kurulum notları         3 Kas ...|:::::
| 1 iş sürüyor                     |:::::
|                                |:::::::
|--------------------------------|:::::::
| Durum                        o |:::::::   o = uyarı noktası (isteğe bağlı)
| Kurulum                        |:::::::
+--------------------------------+:::::::
```

- Açılış: menü düğmesi. Kapanış: perdeye dokunma, geri tuşu, satır seçme. Kenardan kaydırarak açma
  isteğe bağlıdır (`PanResponder`), zorunlu değil.
- Uygulama: RN `Modal` (`transparent`, `animationType="none"`, `statusBarTranslucent`) + `Animated`
  ile soldan kayma (bölüm 7). Panel genişliği ekranın %85'i, en çok 340 dp; zemin
  `yuzey`; köşesiz; perde `perde`.
- Başlık: üst boşluk + `baslik` `metin` "Sohbetler", yatay 16. Altında tam genişlik ikincil düğme
  "Yeni sohbet" (solda `arti` simgesi).
- **Satır**: en az 64 dp, yatay 16 dikey 10; zemin seçiliyse `secili`, basılıyken `basili`.
  - Sol sütun (esnek): ad `govde` `metin` (seçiliyse `govdeKalin`), tek satır; altında önizleme `kucuk`
    tek satır. Önizleme önceliği: bu sohbette akış varsa `bilgi` "Asistan yazıyor"; iş sürüyorsa `bilgi`
    "1 iş sürüyor"; yoksa son mesaj `metinSonuk` (kullanıcınınsa başında "Sen: ").
  - Orta sütun: zaman `mini` `metinSonuk` (bugün "14:32", dün "Dün", son 7 gün gün adı "Salı", daha
    eski "3 Kas"; ay kısaltmaları Oca Şub Mar Nis May Haz Tem Ağu Eyl Eki Kas Ara); altında okunmamış
    rozeti.
  - Sağ: `nokta3` simge düğmesi 48×48, `accessibilityLabel="{ad} seçenekleri"` → eylem menüsü (6.13).
  - Uzun basma da eylem menüsünü açar.
- **Okunmamış rozeti**: en az 20 dp genişlik, 20 yükseklik, `yaricap.tam`, zemin `vurgu`, `miniKalin`
  `dolguUstu`. Açık sohbette gösterilmez. Sayılan öğeler 6.10'dakiyle aynı; sohbet açılıp en alta
  inilince sıfırlanır.
- Sıra: son etkinlik en üstte. Tarih grubu başlığı ("Bugün", "Bu hafta") yok.
- Alt bölüm: `cizgi.ince` `kenar` ayraç, sonra "Durum" ve "Kurulum" satırları (`govde` `metin`, en az
  52 dp). İsteğe bağlı: PC'de bellek az, limit %90 üstü ya da asistan kapalıysa "Durum" satırının sağında
  8 dp `uyari` noktası.
- Liste boşsa: başlık ve "Yeni sohbet" düğmesi durur, altında `kucuk` `metinSonuk` "Henüz sohbet yok."

**Yeni sohbet**: üst çubuktaki `arti` ya da çekmecedeki düğme. Boş durum ekranıyla (6.16) açılır, girdi
odak alır. Ad: ilk mesaja kadar "Yeni sohbet", sonra ilk mesajın ilk 40 karakteri (sözcük ortasından
kesilmez, sonuna "…"; yalnız ad hâlâ "Yeni sohbet" ise, `chat_rename` ile). Kullanıcı dilediğinde yeniden
adlandırır. Sohbet sayısı üst sınırı 8: dolunca "Yeni sohbet" düğmeleri `sohbet_siniri` yanıtını
`kucuk` `uyari` satırıyla gösterir. Sohbet kimliğini telefon üretir, çevrimdışıyken de açılabilir.

### 6.13 Eylem menüsü (alt sayfa)

- `Modal` + `perde`; alttan çıkar; zemin `yuzeyUst`, üst köşeler `yaricap.buyuk`, alt güvenli alan
  boşluğu + 8.
- Başlık: sohbet adı `kucukKalin` `metinIkincil`, tek satır, yatay 16, üst 16.
- Satırlar (en az 52 dp, yatay 16, `govde`, simgesiz, basılı `basili`):
  1. "Yeniden adlandır" (`metin`) → ad diyaloğu
  2. "Geçmişi sil" (`hata`) → onay diyaloğu
  3. "Sohbeti sil" (`hata`) → onay diyaloğu
- Kapanış: perde, geri tuşu. Ayrıca "Vazgeç" satırı yok.

### 6.14 Diyaloglar: silme onayı ve yeniden adlandırma (yeni)

`Alert.alert` kullanılmaz (sistem temasını izler, biçimlenmez). Ortak kap: `Modal` (`transparent`,
`animationType="none"`) + `perde`; ortada kutu: genişlik ekran − 48, en çok 400; zemin `yuzeyUst`;
`yaricap.buyuk`; iç boşluk 24; öğeler arası 12. Başlık `baslik` `metin`; gövde `govde` `metinIkincil`.
Düğme satırı eşit genişlikte iki düğme, ara 8: solda "Vazgeç" (ikincil), sağda eylem. Geri tuşu ve
perde "Vazgeç" sayılır.

**Silme onayı (geri alınamaz):**

- Eylem düğmesi tehlikelidir (6.17) ve diyalog açıldıktan sonra **600 ms kapalıdır**
  (`sure.tehlikeKilidi`): menüye dokunan parmağın ikinci dokunuşu silmesin.
- Silme başarısızsa diyalog açık kalır, düğmelerin üstünde `kucuk` `hata` "Silinemedi: telefonda kayıt
  hatası." gibi bir satır çıkar.
- Başarıda toast yok; sonuç yerinde görünür (geçmiş silindiyse boş durum, sohbet silindiyse liste).
  Açık sohbet silinince en son etkin diğer sohbet açılır; hiç yoksa yeni boş sohbet.

| Eylem | Başlık | Gövde | Ek satır (koşullu, `kucuk` `uyari`) | Düğme |
|---|---|---|---|---|
| Geçmişi sil | Geçmiş silinsin mi? | "{ad}" sohbetindeki tüm mesajlar ve kartlar silinir. Bu geri alınamaz. | Gönderilmeyi bekleyen {n} mesaj da silinir. / Süren {n} iş durmaz. | Geçmişi sil |
| Sohbeti sil | Sohbet silinsin mi? | "{ad}" ve içindeki tüm mesajlar silinir. Bu geri alınamaz. | Gönderilmeyi bekleyen {n} mesaj da silinir. (Sohbette tur, çalışan iş ya da bekleyen soru varsa PC `sohbet_mesgul` döner; bkz. aşağıdaki not.) | Sohbeti sil |
| İşi iptal et | İş {n} iptal edilsin mi? | Asistan işi durdurur. O ana kadar yapılanlar geri alınmaz. | yok | İşi iptal et |

Gövde metni silmenin **gerçekte neyi sildiğini** söylemek zorundadır. Kapsam kararlıdır (`server/MODULLER.md`
"Dilim 2: çoklu sohbet" M5, `app/TASARIM.md` "Dilim 2: çoklu sohbet", `protocol/README.md`): "Geçmişi sil"
(`chat_clear`) ve "Sohbeti sil" (`chat_delete`) PC'ye gider; kayıt hem telefondan hem PC'den silinir, asistanın
transkriptleri de gider. Gövdeye "telefondan ve PC'den silinir" yazılır; yalnız telefondaki kayıt
sanılmasın. Süren işe etkisi: "Geçmişi sil" işi durdurmaz (iş kayıtları kalır); "Sohbeti sil" tur, çalışan
iş ya da bekleyen soru varken reddedilir (`sohbet_mesgul`): diyalog açık kalır ve hata satırı "Önce
sohbetteki işi bitir ya da iptal et." der. Sohbet silinirken bekleyen planlar iptal edilir. `ana` sohbeti
silinemez (`sohbet_silinemez`): menüde "Sohbeti sil" satırı `ana` için görünür ama kapalıdır ve "Ana sohbet silinemez, yalnız geçmişi silinebilir." açıklamasını taşır; "Geçmişi sil" açık kalır.
İş iptalinin sonucu için kapsam 6.15'teki işe göre belirlenir.

**Yeniden adlandırma:**

- Başlık "Sohbeti yeniden adlandır". Gövdede girdi (6.9 stili, zemini `zemin`): `autoFocus`,
  `selectTextOnFocus`, `maxLength={60}`, tek satır, `returnKeyType="done"`.
- Düğmeler "Vazgeç" (ikincil) + "Kaydet" (birincil). Kırpılmış metin boşsa ya da değişmediyse "Kaydet"
  kapalı. Klavyedeki tamam tuşu "Kaydet"tir.

### 6.15 Çalışan işler alt sayfası (yeni)

- Kap 6.13 ile aynı. Başlık `baslik` `metin` "Çalışan işler".
- Satır (en az 64 dp, yatay 16): üstte iş başlığı `govde` `metin` (en çok 2 satır); altında `kucuk`
  `metinSonuk` "İş 12, PC işi, 8 dk" (başka sohbetteyse sonuna ", {sohbet adı}"). Sağda "İptal et"
  tehlikeli metin düğmesi → 6.14 onayı.
- Satıra dokununca alt sayfa kapanır, işin sohbeti açılır ve liste iş satırına kayar.
- İş kalmazsa (alt sayfa açıkken biterse) `kucuk` `metinSonuk` "Çalışan iş yok."
- Süre metni: 1 dakikadan azsa "az önce", sonra "8 dk", 60 dk'dan sonra "1 sa 12 dk".

### 6.16 Boş durumlar

- **Yeni ya da geçmişi silinmiş sohbet**: liste alanının dikey ortasının biraz üstünde, yatay 32:
  `govde` `metinIkincil` "Asistana yaz." ve altında `kucuk` `metinSonuk` "Mesajın PC'deki asistana gider.
  Bağlantı yoksa telefonda bekler, bağlanınca gönderilir." Logo, çizim, selamlama ve öneri çipi yok.
- **Eşleşme yok**: aynı yerde "PC ile eşleşme yok." + birincil "Kuruluma git".
- **Sohbet listesi boş**: 6.12.

### 6.17 Düğmeler

| Tür | Zemin | Metin | Kenar | Basılı | Kapalı |
|---|---|---|---|---|---|
| Birincil | `vurgu` | `dolguUstu` | yok | zemin `vurguBasili` | zemin `yuzeyUst`, metin `metinSonuk` |
| İkincil | saydam | `metin` | 1 dp `kenarGuclu` | zemin `basili` | kenar `kenar`, metin `metinSonuk` |
| Metin | saydam | `vurgu` | yok | zemin `basili` | metin `metinSonuk` |
| Tehlikeli | `hata` | `dolguUstu` | yok | zemin `hataBasili` | zemin `yuzeyUst`, metin `metinSonuk` |
| Tehlikeli metin | saydam | `hata` | yok | zemin `basili` | metin `metinSonuk` |
| Simge | saydam | simge `metin` | yok | zemin `basili`, `yaricap.tam` | simge `metinSonuk` |

- Ölçü: en az 48 dp yükseklik, yatay iç boşluk 16 (metin düğmesinde 12), `yaricap.orta`, yazı
  `govdeKalin`. Simge düğmesi 48×48, simge kutusu 24.
- Kapalı durum `opacity` ile yapılmaz (koyu zeminde bulanık görünür); yukarıdaki jetonlar kullanılır.
- Birincil düğme bir ekranda (ya da kartta) en çok bir tanedir.
- `accessibilityRole="button"`, `accessibilityState={{ disabled }}`. Basılı hal `Pressable`'ın
  `style={({ pressed }) => …}` biçimiyle verilir; `android_ripple` kullanılmaz (tek tip basılı görünüm).
- Yazının sonuna "→" ya da başka ok eklenmez.

### 6.18 Yerel ekranların uyumu

`OnayActivity` Kotlin'de, `tema.ts`'i içe aktaramaz. Aynı hex değerleri adaptörde tek bir renk nesnesine
(örneğin `TemaRenk.kt`) kopyalanır; eşitliği bir test (TS kaynağını okuyarak, `SozlesmeTest` deseni)
sınar. Bugünkü değerlerin karşılığı:

| `OnayActivity` bugün | Yeni jeton |
|---|---|
| Kaydırma zemini `#121212` | `zemin` `#101A1E` |
| Kutu zemini `#1E1E1E` | `yuzey` `#1D2A2F` |
| Kutu kenarı `#404040` | `kenar` `#35454B` |
| Ön plan `#EEEEEE` | `metin` `#EFEAE1` |
| Soluk `#A8A8A8` | `metinIkincil` `#AFBEC0` |
| Kırmızı `#FF6B6B` (metin) | `hata` `#F4A4AA` |
| Kırmızı kutu (kenar kırmızı) | zemin `hataZemin`, kenar 1 dp `hata`, metin `hata` |
| "Reddet" `#444444` + beyaz | İkincil: saydam, 1 dp `kenarGuclu`, metin `metin`; basılı `basili` |
| "Onayla" `#1E7A3C` + beyaz | Birincil: `vurgu`, metin `dolguUstu`; basılı `vurguBasili` |
| Düğme köşesi 10, kutu köşesi 8 | 12 (`orta`), 8 (`kucuk`) |
| `RadioButton` varsayılan rengi | `buttonTintList` = `vurgu` |
| Yazı 13/15/16/20 sp | 14 (`kucuk`), 16 (`govde`), 16, 18 (`baslik`) |

Güvenlik davranışına (FLAG_SECURE, örtülü dokunuş reddi, erişilebilirlik tıklamasının engeli,
biyometri) dokunulmaz; bu bölüm yalnız renk, köşe ve yazı boyutudur. Metindeki büyük harfli önekler
("UYARI:", "SERBEST METİN:", "YAZ:") bu belgenin kuralına göre cümle düzenine çevrilmelidir (şerit
rengi ve kalın yazı zaten uyarıyı taşıyor); ama bu bir güvenlik ekranının metni olduğu için değişiklik
güvenlik sahibinin onayıyla yapılır.

`EslestirmeActivity`, `UygulamaListesiActivity`, `DenetimActivity` ve `TanilamaActivity` bugün açık
renk vermiyor; varsayılan `Theme.AppCompat.DayNight` ile sistem temasını izliyorlar. Aynı renk nesnesiyle
zemin `zemin`, metin `metin`, ikincil metin `metinIkincil` olarak boyanmalı; yoksa sistem açık temadayken
koyu uygulamadan beyaz bir ekrana geçilir.

### 6.19 Durum ve Kurulum ekranları

- Tam ekran. Üst çubuk: `geri` simge düğmesi + `baslik` "Durum" / "Kurulum"; hat burada da durur.
  Android geri tuşu sohbete döner.
- İçerik kartlara bölünmez; bölüm başlığı + ayraçlı satırlar. Zemin `zemin`. Bölüm başlığı `kucukKalin`
  `metinIkincil`, üstü 24 altı 8. Satır en az 48 dp, yatay 16, aralarında `cizgi.ince` `kenar`.
- Değer satırı: solda ad `govde` `metin`, sağda değer `govdeKalin` `metin`, `selectable`. Dikkat isteyen
  değer (PC'de bellek az, limit %90 ve üstü, asistan kapalı) `uyari` renginde; açıklaması bölüm altında
  uyarı şeridiyle (6.6).
- **Durum**: "Bağlantı" (durum, varsa eşitleme ve son hata; ikincil "Şimdi bağlan"), "Asistan" (durum, PC
  ekran kilidi, aktif iş, boş RAM, 5 saatlik ve haftalık limit), "Tanılama" (ikincil "Tanılamayı aç").
  Bağlantı yokken "Asistan" bölümünde `kucuk` `metinSonuk` "Bağlantı yok, durum bilinmiyor."
- **Kurulum**: "Eşleşme" bölümü: durum noktası + "PC ile eşleşilmiş" (`basari`) ya da "Eşleşme yok"
  (`hata`); talimat `kucuk` `metinIkincil` ("PC'de `eren eslestir` çalıştır, sonra Eşleştir'e bas";
  komut `kod` ile); birincil "Eşleştir". "Telefon ayarları" bölümü: her satırda ad + durum noktası ve
  metni ("Açık" `basari`, "Kapalı" `hata`, "Bilinmiyor" `metinSonuk`) + ikincil "Aç"; bölüm sonunda
  ikincil "Durumu yenile".
- Yerel modül yoksa en üstte uyarı şeridi (mevcut metin).

---

## 7. Hareket

Mevcut bağımlılıklarla: RN `Animated` (`useNativeDriver: true`, yalnız `opacity` ve `transform`) ve
`Easing`. Reanimated yok, gerekmiyor.

| Ne | Süre | Eğri | Not |
|---|---|---|---|
| Çekmece açılış | `sure.orta` 220 ms | `Easing.out(Easing.cubic)` | `translateX` −panel → 0, perde opaklığı 0 → 1 |
| Çekmece kapanış | `sure.hizli` 150 ms | `Easing.in(Easing.cubic)` | tersi |
| Alt sayfa açılış / kapanış | 220 / 150 ms | aynı | `translateY` yükseklik → 0 |
| Diyalog açılış | 150 ms | `Easing.out(Easing.cubic)` | opaklık 0 → 1, ölçek 0,98 → 1; kapanış anında |
| En alta in görün / gizlen | 150 ms | `Easing.out(Easing.cubic)` | opaklık, `translateY` 8 → 0 |
| Hat akışı | `sure.hat` 1400 ms, döngü | `Easing.inOut(Easing.ease)` | yalnız bağlanırken / eşitlenirken |
| Yazıyor noktaları | `sure.nokta` 1200 ms, döngü | doğrusal | noktalar arası 160 ms |
| Listeyi en alta kaydırma | yerleşik | — | `scrollToEnd({ animated })` |

- **Animasyon yok:** yeni mesajın girişi (kayma ya da solma yok, balon belirir), kart açma/kapama, sekme
  ya da ekran geçişi (Durum ve Kurulum anında açılır), düğme basılı hali.
- **Az hareket:** `AccessibilityInfo.isReduceMotionEnabled()` ve `reduceMotionChanged` dinlenir. Açıksa
  bütün süreler 0, hat ve noktalar durağan (6.2, 6.11), `scrollToEnd` animasyonsuz.
- Titreşim yok: `app.json` `VIBRATE` iznini engelliyor.

---

## 8. Simgeler

Mevcut bağımlılıklarda simge kütüphanesi yok (`react-native-svg`, `@expo/vector-icons` kurulu değil).
**Varsayılan: düz `View`'lerle çizilen küçük bir `Simge` bileşeni.** Bağımlılık yok, her boyutta keskin,
rengi jetondan alır. Çizgi kalınlığı 2 dp, kutu 24×24, ortalı.

| Ad | Çizim | Kullanım | Erişilebilirlik etiketi (düğmede) |
|---|---|---|---|
| `menu` | 18×2 üç çubuk, aralık 4 | Üst çubuk solu | Sohbetler |
| `arti` | 16×2 iki çubuk, biri 90° döndürülmüş | Yeni sohbet | Yeni sohbet |
| `asagi` | 9×9 kutunun sağ ve alt kenarı (2 dp), 45° döndürülmüş | En alta in | En alta in |
| `geri` | `asagi` 135° döndürülmüş | Durum ve Kurulum üst çubuğu | Geri |
| `nokta3` | 4 dp üç daire, aralık 4, yatay | Sohbet satırı seçenekleri | {ad} seçenekleri |
| `kapat` | 16×2 iki çubuk, ±45° | Yalnız gerekirse (alt sayfa ve diyalog perdeyle kapanır) | Kapat |
| `nokta` | 8 dp daire | Durum noktası (düğme değil) | yok |

- Anlamı tartışmasız eylemler simgeyle (menü, yeni, aşağı, geri, seçenekler); diğer her şey metinle:
  "Dikte", "Gönder", "Turu kes", "Onayla". Mikrofon, gönder oku, robot, kıvılcım, beyin simgesi yok.
- Unicode simge karakteri (⋯ ↓ ✓ ✗) kullanılmaz: yazı tipine göre boyut ve taban çizgisi değişir.
  Kurulum'daki "✓ / ✗" yerine durum noktası + "Açık" (`basari`) / "Kapalı" (`hata`) / "Bilinmiyor"
  (`metinSonuk`). Madde imi "•" metin içinde kalabilir.
- Emoji hiçbir yerde yok.

---

## 9. Metin dili

- Cümle düzeni, ünlem yok, özür yok ("Hay aksi", "Üzgünüz" yok). Hata ne olduğunu ve ne yapılacağını
  söyler: "Bağlantı yok. Mesajların telefonda bekliyor, bağlanınca gider."
- Eylem adı akış boyunca aynı kalır: "Turu kes" → not "Tur kesildi"; "Geçmişi sil" → diyalog düğmesi
  "Geçmişi sil"; "İşi iptal et" → "İş 12 iptal edildi". "Gönder" → "Gönderiliyor" → "Teslim edildi".
- Hitap ikinci tekil ("Asistana yaz", "Kurulum ekranına bak"). Asistan üçüncü tekil ("Asistan yazıyor").
  Belgedeki "Asistan" sözcüğü, uygulamada derleme anında ayarlanan görünen asistan adının
  (`EREN_KIT_ASSISTANT_NAME`, varsayılan "Claude") yer tutucusudur; sunucudan gelen ad her zaman önceliklidir.
- Meta bilgi ara nokta ("·") ile değil, düzenle (ayrı öğe) ya da doğal cümleyle ("İş 12, PC işi, 8 dk")
  verilir. "Kelime — parça" kalıbı kullanılmaz.
- Teknik kodlar yalnız parantez içinde ve sona: "Gönderilemedi (zaman_asimi)". Kullanıcı geliştirici, kodu
  görmek ister; ama cümle kodsuz da anlaşılmalı.

---

## 10. Yapma listesi (bu uygulamada "slop")

1. Emoji (durum, düğme, boş durum, sistem notu dahil). Kıvılcım, robot, beyin simgesi.
2. Asistan için avatar dairesi, "E" harfli rozet, her balonun başında ad.
3. Degrade: başlıkta, balonda, düğmede, zeminde. Mor-mavi "AI" geçişi hiç.
4. Kart ve balon altında gölge (`elevation`, `shadow*`), cam/bulanık efekt.
5. Her öğeye aynı köşe yarıçapı; her şeyin hap biçiminde olması.
6. Büyük harfli, harf aralığı açılmış etiket (`textTransform: "uppercase"`). Bugünkü `stil.etiket`.
7. Ara noktalı meta dizileri ("Plan · PC işi · Onayını bekliyor"). Bugünkü üç kartın başlığı.
8. Düğme yazısına "→" eklemek ("Devam et →").
9. Boş sohbette kişiselleştirilmiş selamlama ("Merhaba <ad>! Bugün sana nasıl yardımcı olabilirim?") ve öneri çipleri.
10. Her durumu dolgulu renkli hapla göstermek (rozet çorbası). Durum = nokta + metin; dolgulu tek öğe
    okunmamış rozeti.
11. Etiket, zaman ya da sayı için monospace; terminal taklidi (yeşil yazı, yanıp sönen blok imleç, ">"
    istemi). Monospace yalnız makine metninde.
12. Sürekli hareket: her mesajın kayarak girmesi, parıltılı iskelet, gönder düğmesinde nabız, zıplayan
    öğeler. Hareket eden tek kalıcı öğe hat, o da yalnız bağlanırken.
13. Kapalı düğmeyi `opacity: 0.45` ile soldurmak.
14. Saf siyah `#000` ya da nötr `#121212` / `#111` zemin; neon yeşil ya da asit vurgu.
15. Claude'un toprak turuncusu (`#D97757` civarı) ve krem zemin (`#F4F1EA`).
16. Her işlemde toast ("Mesaj gönderildi!"). Durum yerinde görünür.
17. Anlamı belirsiz simge-yalnız düğme (mikrofon simgesi tek başına "Dikte" yerine).
18. Bölüm üstüne süs etiketi, sıra olmayan içerikte 01/02/03 numarası, dekoratif ayraç.
19. Bileşen içinde hex renk. Her renk `renk` jetonundan.
20. Sistem `Alert.alert` ile silme onayı (açık temada beyaz kutu çıkar, biçimlenmez).
21. Durum ve Kurulum'u birbirinin aynı yuvarlak kartlara bölmek. Orada bölüm başlığı + ayraçlı satırlar
    kullanılır (6.19).

---

## 11. Bağımlılık önerileri

Varsayılan tasarım bunların hiçbiri olmadan uygulanabilir. Hepsi öneridir; kurma kararı şefin.

| Ad | Neden | Yerel derleme | Öncelik |
|---|---|---|---|
| `react-native-safe-area-context` | `edgeToEdgeEnabled=true` (`android/gradle.properties`) ve JS'te inset işlenmiyor; RN'in `SafeAreaView`'ı Android'de bir şey yapmaz. Üst çubuk, giriş çubuğu, çekmece ve alt sayfa için doğru durum çubuğu ve gezinti çubuğu boşluğu verir. Bkz. 12.4. | Evet: yerel modül, yeni APK gerekir (`expo prebuild` otomatik bağlar). | Yüksek, telefonda sorun görülürse |
| Gömülü yazı tipi: Atkinson Hyperlegible Next (OFL) + `expo-font` (config eklentisiyle derleme anında gömme) | `l / I / 1` ve `O / 0` ayrımı için tasarlanmış; plan kartında ve onay ekranında paket adı, yol ve görev metni okunurken karışıklık bir güvenlik riski. Sistem fontundan daha belirgin bir kimlik. Türkçe glif kapsamı kurulumdan önce doğrulanmalı. | Evet: font varlığı APK'ya gömülür; `expo-font` bugün yalnız `expo`'nun iç bağımlılığı, doğrudan bağımlılık olarak eklenmeli. | Düşük, isteğe bağlı |
| `react-native-svg` | Simgeler için tam vektör (mikrofon, gönder oku gibi karmaşık şekiller). Bu tasarım onlara ihtiyaç duymuyor; `View` simgeleri yeterli. | Evet. | Düşük |
| `expo-navigation-bar` | Sistem açık temadayken gezinti çubuğu düğmelerinin koyu zeminde koyu kalması olasılığına karşı stil verme. Önce telefonda bakılmalı; Android 15 kenardan kenara modunda sistem kontrastı kendisi ayarlayabilir. | Evet. | Yalnız sorun görülürse |

Önerilmeyenler: `react-native-reanimated` ve `react-native-gesture-handler` (çekmece, alt sayfa ve hat
`Animated` + `PanResponder` ile yapılıyor), `react-navigation` (üç ekran için gereksiz), `expo-haptics`
(`VIBRATE` engelli), herhangi bir UI kiti (kendi kalıplarını getirir).

---

## 12. Uygulama notu

### 12.1 `tema.ts` sözleşmesi

`tema.ts` yalnız jeton taşır; bileşen içermez. **İlk önce ve tek agent tarafından yazılır, sonra
dondurulur**; ekran agent'ları ona karşı yazar (projenin `sozlesme.ts` deseni). Değerler bölüm 2-7'deki
tablolardır. Dışa aktarımların şekli:

```ts
import type { TextStyle } from "react-native";

export declare const renk: Readonly<{
  zemin: string; yuzey: string; yuzeyUst: string; secili: string; basili: string;
  kenar: string; kenarGuclu: string;
  metin: string; metinIkincil: string; metinSonuk: string;
  vurgu: string; vurguBasili: string; vurguSecim: string; dolguUstu: string;
  kullaniciBalon: string; asistanBalon: string;
  basari: string; basariZemin: string; basariKenar: string;
  uyari: string; uyariZemin: string; uyariKenar: string;
  hata: string; hataZemin: string; hataKenar: string; hataBasili: string;
  bilgi: string; bilgiZemin: string; bilgiKenar: string;
  perde: string;
}>;
export type RenkAdi = keyof typeof renk;
export type DurumRengi = "basari" | "uyari" | "hata" | "bilgi";

export type YaziAdi =
  | "buyuk" | "baslik" | "govde" | "govdeKalin"
  | "kucuk" | "kucukKalin" | "mini" | "miniKalin" | "kod";
/** fontSize, lineHeight, fontWeight, includeFontPadding; `kod` ayrıca fontFamily. Renk yok. */
export declare const yazi: Readonly<Record<YaziAdi, TextStyle>>;

export declare const bosluk: Readonly<{ 1: 4; 2: 8; 3: 12; 4: 16; 6: 24; 8: 32 }>;
export declare const yaricap: Readonly<{ kucuk: 8; orta: 12; buyuk: 18; tam: 999 }>;
export declare const cizgi: Readonly<{ ince: number; normal: 1; kalin: 2 }>;

export declare const olcu: Readonly<{
  dokunma: 48; ustCubuk: 56; hat: 2;
  girdiEnAz: 48; girdiEnCok: 140; eylemYuvasi: 88;
  balonKullanici: "82%"; balonAsistan: "88%";
  cekmeceOran: 0.85; cekmeceEnCok: 340; diyalogEnCok: 400;
  nokta: 8; rozet: 20; altaInDaire: 44; altaInHap: 40;
}>;

export declare const sure: Readonly<{
  hizli: 150; orta: 220; hat: 1400; nokta: 1200;
  tehlikeKilidi: 600; seritGecikme: 3000; yukleniyorGecikme: 300;
}>;

export declare const esik: Readonly<{
  altaInGoster: 240; altaInGizle: 80;
  zamanAyraciDk: 30; adUzunlugu: 60; otomatikAd: 40; okunmamisEnCok: 99;
}>;

/** Yalnız ortak düzen: ekran (flex 1, zemin), satir, ayrac. Bileşen stilleri bileşen dosyasında. */
export declare const stil: Readonly<Record<"ekran" | "satir" | "ayrac", object>>;
```

### 12.2 Eski adlardan geçiş

Bugünkü `tema.ts` adlarının karşılığı. Dikkat: iki eski renk adı yeni bir dışa aktarımla çakışıyor
(`renk.yazi` ↔ `yazi`, `renk.cizgi` ↔ `cizgi`).

| Eski | Yeni |
|---|---|
| `renk.arka` | `renk.zemin` |
| `renk.kart` | `renk.yuzey` |
| `renk.yazi` | `renk.metin` |
| `renk.soluk` | `renk.metinIkincil` (etiket, ikincil) ya da `renk.metinSonuk` (zaman, not) |
| `renk.cizgi` | `renk.kenar` |
| `renk.vurgu` (mavi, açık zeminde metin) | `renk.vurgu` (başak, dolgu ve koyu zeminde metin): değer ve rol değişti |
| `renk.vurguYazi` | `renk.dolguUstu` |
| `renk.kullanici` | `renk.kullaniciBalon` |
| `renk.uyari` / `renk.uyariArka` | `renk.uyari` / `renk.uyariZemin` |
| `renk.hata` | `renk.hata` (değer değişti) |
| `renk.iyi` | `renk.basari` |
| `stil.kart` | kart bileşeni (6.7) |
| `stil.etiket` | `yazi.kucukKalin` + `renk.metinIkincil`; büyük harf kalkar |
| `stil.baslik`, `stil.metin`, `stil.soluk` | `yazi.baslik`, `yazi.govde`, `yazi.kucuk` + renk |
| `stil.uyari` | satır içi şerit (6.6) |
| `stil.dugme*`, `stil.dugmeKapali` | `Dugme` bileşeni, `tur` özelliğiyle (6.17); `opacity` kalkar |
| `stil.girdi` | girdi (6.9) |

Geçiş biçimi şefin kararı: ya bütün ekranlar aynı turda yeniden yazılır ya da yeni `tema.ts` geçici,
`@deprecated` işaretli eski adlar taşır ve son ekran geçince bunlar silinir.

### 12.3 Bileşen dosyaları (öneri)

Bir dosya bir sorumluluk; ekran agent'ları paralel yazabilsin diye:

| Dosya | İçerik |
|---|---|
| `ekranlar/tema.ts` | Jetonlar (12.1). |
| `ekranlar/Bilesenler.tsx` | `Dugme` (`tur: "birincil" \| "ikincil" \| "metin" \| "tehlikeli" \| "tehlikeliMetin"`), `SimgeDugme`, `Duz` (değişmez), `DurumEtiketi`, `Serit`. |
| `ekranlar/Simge.tsx` | `Simge` (bölüm 8). |
| `ekranlar/UstCubuk.tsx` | Üst çubuk, hat, iş hapı, durum şeridi. |
| `ekranlar/Cekmece.tsx` | Sohbet listesi çekmecesi. |
| `ekranlar/Katman.tsx` | `AltSayfa`, `Diyalog` kapları (perde, hareket, geri tuşu). |
| `ekranlar/SohbetDiyaloglari.tsx` | Eylem menüsü, silme onayı, ad diyaloğu, çalışan işler. |
| `ekranlar/AltaIn.tsx` | En alta in düğmesi ve kaydırma eşiği mantığı. |
| `ekranlar/Balonlar.tsx` | Kullanıcı/asistan balonu, yazıyor göstergesi, sistem notu, zaman ayracı, iş satırı. |

### 12.4 Android kabuğu

- `App.tsx`'teki `SafeAreaView` Android'de boşluk vermez; `edgeToEdgeEnabled=true`. Üst çubuk durum
  çubuğu yüksekliğini (bağımlılıksız: `StatusBar.currentHeight`), giriş çubuğu, çekmece ve alt sayfa
  gezinti çubuğu boşluğunu hesaba katmalı. Bağımlılıksız alt boşluk için güvenilir çekirdek API yok;
  telefonda bakılmalı (bölüm 11, ilk satır).
- `expo-status-bar`: `style="light"` (koyu zeminde açık simgeler). Bugün `"auto"`; sistem açık temadayken
  koyu zeminde koyu simge çıkar.
- `app.json` `userInterfaceStyle` bugün `"light"`. Uygulama renkleri açıkça verdiği için RN ekranlarını
  etkilemez; ama yerel aktiviteler ve açılış ekranı için `"dark"` yapılması ve açılış arka planının
  (`splashscreen_background` bugün `#FFFFFF`) `zemin` olması gerekir, yoksa açılışta beyaz parlama olur.
  Bu ayrı bir iş (app.json + prebuild); bu belgenin ekran işlerinin parçası değil.
- Klavye boşluğu mantığı (`App.tsx`) korunur; alt sekme çubuğu kalkınca `klavye === 0` koşulu da gereksiz.

---

## 13. Bu belgenin bilmedikleri

- ~~Çoklu sohbetin veri modeli~~ **Çözüldü (Dilim 2).** Sohbet kalıcı kayıt olarak PC'de (`sohbetler`
  tablosu, `ana` varsayılan, üst sınır 8); telefon listeyi `chat_created/renamed/deleted` olaylarından ve
  `server_status.sohbetler`'den kurar, okunmamış sayısı ve en son açık sohbet telefonda tutulur. `seq`
  küresel kalır. Tanım: `server/MODULLER.md` "Dilim 2: çoklu sohbet", `app/TASARIM.md` "Dilim 2: çoklu
  sohbet", `protocol/README.md`.
- ~~Geçmişi ve sohbeti silmenin kapsamı~~ **Çözüldü (Dilim 2).** İkisi de PC'de de siler; "Sohbeti sil"
  meşgul sohbette (`sohbet_mesgul`) reddedilir, "Geçmişi sil" işi durdurmaz, `ana` silinemez. Bkz. 6.14 ve
  aynı atıflar.
- **Çalışan iş listesi**: `server_status.aktif_is` yalnız sayı; liste `IsKarti` (`suruyor`) öğelerinden
  kurulursa sayıyla uyuşmayabilir. Hap sayısının hangisinden alınacağı uygulayanın kararı.
- Renkler yalnız PC'de çizilmiş kaba bir taslakta görüldü; test telefonunun ekranında, düşük parlaklıkta ve güneşte
  görülmedi. Kontrast hesabı sRGB değerleri üzerinden.
- 600 ağırlığın üretici arayüzünün sistem fontunda ayrı bir kalınlıkla çizilip çizilmediği doğrulanmadı.
- `selectionHandleColor`, `cursorColor` ve `Modal` `statusBarTranslucent` özelliklerinin RN 0.88'de
  beklendiği gibi çalıştığı derlemede doğrulanmalı.
- Telefonun dp genişliği ölçülmedi (yaklaşık 393-440 dp); düzen 360 dp'de de bozulmamalı.
