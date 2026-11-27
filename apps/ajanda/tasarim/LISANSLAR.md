# Tasarım kaynağının lisans notları

Bu klasördeki prototip (`ajanda-yonler.html`, `parca/`) yazı tiplerini Google Fonts üzerinden bağlantıyla
yükler (`test/yap.mjs` satır 11, `ajanda-yonler.html` satır 3); yazı tipi dosyası depoda yoktur.
Uygulamaya gömülecek dosyaları indirmek ayrı bir iştir; aşağıdaki bilgiler o iş için kaynaktır.
Bilgiler google/fonts deposundaki `METADATA.pb` dosyalarından alındı (2026-11-27).

| Yazı tipi | Prototipte nerede | Tasarımcı | Lisans | Telif satırı | Kaynak depo | Eksenler | Alt kümeler |
|---|---|---|---|---|---|---|---|
| **Bricolage Grotesque** | Sahne yönünün tek yazı tipi (`--f-s`, `parca/10-kabuk.css` satır 6) | Mathieu Triay | SIL Open Font License 1.1 | Copyright 2022 The Bricolage Grotesque Project Authors | https://github.com/ateliertriay/bricolage | opsz 12–96, wdth 75–100, wght 200–800 | latin, latin-ext, vietnamese |
| Archivo | Kabuk ve Cetvel yönü (`--f-c`, satır 5) | Omnibus-Type | SIL Open Font License 1.1 | Copyright 2020 The Archivo Project Authors | https://github.com/Omnibus-Type/Archivo | wdth 62–125, wght 100–900 | latin, latin-ext, vietnamese |
| Barlow | Tabela yönü gövde yazısı (`--f-tm`, satır 8) | Jeremy Tribby | SIL Open Font License 1.1 | Copyright 2017 The Barlow Project Authors | https://github.com/jpt/barlow | durağan ağırlıklar | latin, latin-ext, vietnamese |
| Barlow Condensed | Tabela yönü kanat yazısı (`--f-t`, satır 7) | Jeremy Tribby | SIL Open Font License 1.1 | Copyright 2017 The Barlow Project Authors | https://github.com/jpt/barlow | durağan ağırlıklar | latin, latin-ext, vietnamese |

## Android uygulamasına girecek olan

- Yalnız **Bricolage Grotesque** gerekir (Sahne yönü). Değişken dosya (`opsz,wdth,wght`) tek dosyayla
  550 ve 650 gibi ara ağırlıkları da verir; `minSdk 26` olduğu için Compose `FontVariation` ile kullanılabilir.
  Ayrıntı: `SAHNE.md` "Yazı" bölümü.
- Cetvel'den alınan mezura saat seçicisi Sahne'ye taşınırken Archivo'nun dar kesimi (`font-stretch:62%`)
  yerine Bricolage Grotesque kullanılır (önerimiz; `SAHNE.md` "Etkileşimler"). Archivo ve Barlow'u
  uygulamaya gömmek gerekmez.
- `latin-ext` alt kümesi Türkçe harfleri (ı, İ, ş, ğ, ç, ö, ü) kapsar; prototipin ekran görüntülerinde
  bu harfler Bricolage Grotesque ile çizilmiş görünüyor (`goruntu/1-bugun-acik.png`).

## OFL 1.1'in uygulama için gerektirdikleri

- Yazı tipi uygulamayla birlikte dağıtılabilir, ticari uygulamada da kullanılabilir.
- Lisans metni (OFL.txt) ve telif satırı yazı tipiyle birlikte dağıtılmalıdır; uygulamada "Açık kaynak
  lisansları" ekranında ya da varlık klasöründe lisans dosyasıyla gösterilmesi yeterlidir.
- Yazı tipi tek başına satılamaz. Değiştirilirse (alt küme çıkarmak da değiştirmektir) "Reserved Font
  Name" varsa o ad kullanılamaz; Bricolage Grotesque'in `OFL.txt` dosyasında ayrılmış ad olup olmadığı
  dosya indirilirken kontrol edilmelidir.

## Öteki varlıklar

- Çizimler (`cizim/*.svg`, prototipte `parca/50-ortak.js` `RESIM`) ve simgeler (`IK`) bu prototip için
  elle yazılmış SVG yollarıdır; dış kaynaktan alınmadı.
- "Fotoğraf" yerine geçen görseller (`FOTO`) de elle çizilmiş SVG'dir; gerçek fotoğraf yoktur.
- Ekran görüntüleri (`goruntu/*.png`) prototipin başsız Chrome'da alınmış kareleridir; örnek verinin
  tamamı uydurmadır.
