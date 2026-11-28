# Simge (çizim) anahtarları

Her kaydın bir çizimi vardır. Çizim, sözleşme v3'teki simge anahtarıyla seçilir. Telefon, kullanıcı başlığı
yazarken bir anahtar önerir; kullanıcı ya da asistan bunu değiştirebilir.

- Kod: `android/.../ekran/sahne/cizim/CizimOnerisi.kt`, yani `CizimOnerisi.oner(baslik)`. Eşleşme varsa
  anahtarı, yoksa `null` döner.
- Sözcüklerin asıl kaynağı koddaki tablodur (`CizimOnerisi.SOZCUKLER`). Bu belge onun özetidir. Biri
  değişirse öteki de güncellenir.

## Anahtarlar

Anahtar biçimi `^[a-z][a-z0-9_]{0,31}$` kuralına uyar. Kümede 29 anahtar vardır. **Eşleşme yoksa `genel`
kullanılır**; `genel` için sözcük tanımlanmaz.

| Anahtar | Ne için | Başlıkta tanınan sözcükler (ekli biçimleri de geçer) |
|---|---|---|
| `genel` | Başka hiçbir anahtara uymayan kayıt | — |
| `araba` | Araç bakımı, yıkama, yakıt, belge | araba, otomobil, oto, araç, otopark, tüvtürk, egzoz, lastik, benzin, mazot, yakıt, kaporta, ehliyet, kasko, plaka |
| `banka` | Para, kart, havale | banka, atm, kredi, kart, havale, eft, iban, maaş, borç, faiz, döviz, dekont |
| `dis` | Diş hekimi | diş, dişçi, ortodont, implant |
| `dogum_gunu` | Doğum günü, yıldönümü | doğum günü, yaş günü, doğumgünü, yaşgünü, yıldönümü, pasta |
| `doktor` | Sağlık randevusu, tahlil, aşı | doktor, dr, hastane, hekim, klinik, poliklinik, muayene, tahlil, aşı, röntgen, mr, psikolog, terapi, tedavi |
| `ev` | Ev, taşınma (bağlam anahtarı) | ev, taşınma, anahtar |
| `fatura` | Fatura, kira, aidat, vergi | fatura, kira, aidat, ödeme, elektrik, doğalgaz, doğal gaz, vergi, taksit, sigorta, harç, abonelik |
| `ilac` | İlaç, eczane | ilaç, eczane, vitamin, reçete, hap, şurup, antibiyotik, takviye |
| `is` | İş, mesai, ofis (bağlam anahtarı) | iş, işyeri, mesai, vardiya, ofis, büro, rapor, imza |
| `kahve` | Kahve, çay, kahvaltı | kahve, kahvaltı, çay, kafe, cafe |
| `kargo` | Kargo, paket, sipariş, hediye | kargo, paket, koli, hediye, teslimat, sipariş, iade, kurye |
| `kitap` | Okuma, kütüphane | kitap, kütüphane, roman, dergi, okuma |
| `market` | Alışveriş, gıda | market, alışveriş, bakkal, pazar (yalnız ekli: "pazara"), manav, ekmek, süt, yumurta, sebze, meyve, erzak, migros, bim, a101, carrefour |
| `okul` | Ders, sınav, ödev (bağlam anahtarı) | okul, ders, dershane, dersane, sınav, ödev, üniversite, kampüs, kurs, kırtasiye, lise, fakülte, tez |
| `sac` | Kuaför, berber, bakım | saç, kuaför, berber, sakal, tıraş, traş, manikür, pedikür, röfle |
| `seyahat` | Yolculuk, tatil, bilet | seyahat, gezi, tatil, uçak, uçuş, bilet, otel, valiz, bavul, pasaport, havalimanı, havaalanı, otobüs, tren, gar, feribot, yolculuk, rezervasyon, taksi, plaj |
| `spor` | Spor, yürüyüş, maç | spor, gym, fitness, antrenman, idman, koşu, yürüyüş, yüzme, havuz, pilates, yoga, maç, futbol, basketbol, voleybol, tenis, bisiklet, halısaha, halı saha, egzersiz, maraton |
| `telefon` | Arama, mesaj (bağlam anahtarı) | telefon, mesaj, şarj, operatör, turkcell, vodafone, görüntülü |
| `temizlik` | Ev temizliği, çöp | temiz(lik/le), süpür, toz, bulaşık, paspas, çöp, halı, banyo |
| `toplanti` | Toplantı, görüşme, sunum | toplantı, görüşme, zoom, teams, sunum, mülakat, seminer, konferans, webinar |
| `yemek` | Yemek, restoran, tarif | yemek, restoran, lokanta, tarif, pişir, mutfak, makarna, pizza, çorba, brunch, kek, mangal |
| `kamp` | Kamp, doğa, piknik | kamp, kamping, çadır, doğa, piknik, orman, dağ, trekking, karavan |
| `evcil` | Evcil hayvan, veteriner | evcil, kedi, köpek, veteriner, mama, kuş, tasma, hamster, papağan, akvaryum |
| `bitki` | Çiçek, bahçe, sulama | bitki, çiçek, çiçekçi, saksı, fide, fidan, bahçe, gübre, ağaç, sula, orkide |
| `tamir` | Tamir, usta, arıza | tamir, tadilat, onar, usta, tesisat, musluk, arıza, kombi, elektrikçi, çilingir, hırdavat, montaj, kurulum |
| `camasir` | Çamaşır, ütü | çamaşır, ütü, deterjan, yumuşatıcı, çarşaf, nevresim, kuru temizleme |
| `eglence` | Sinema, konser, parti, düğün | eğlence, sinema, film, konser, tiyatro, parti, oyun, festival, gösteri, dizi, müze, sergi, davet, düğün, kına, kutlama, bowling, lunapark, buluşma, belgesel |
| `mektup` | Posta, e-posta, resmî evrak | mektup, posta, e-posta, mail, email, zarf, kartpostal, pul, ptt, noter, dilekçe, evrak, tebligat, başvuru, belge |

## Eşleşme kuralları

1. **Sözcük başı.** Sözcükler yalnız bir kelimenin başında aranır. Bu yüzden "fotoğraf" içindeki "oto"
   `araba`, "Pazartesi" içindeki "pazar" `market` önermez.
2. **Ekler.** Kelimenin arkasına ek gelebilir: "dişçiye", "markete", "faturayı", "ilacı", "köpeği".
   Kısa ya da başka bir kelimenin başı olan sözcüklerde (ev, iş, kira, kamp, saç, diş, çay, maç, kedi,
   ders, ...) arkadan yalnız ad çekim ekleri kabul edilir. "kirayı" ve "evde" geçer; "kiraz", "evrak",
   "evet", "kampanya" ve "saçma" geçmez. Ünsüzle biten köke m, n ya da s ile başlayan ek doğrudan
   gelemez. Bu yüzden "saçma" geçmez, "saçıma" geçer. Uzun sözcüklerde ekin ne olduğuna bakılmaz ("temizlikçi").
3. **Büyük/küçük harf.** Türkçe kurala göre çevrilir (İ → i). Büyük `I` hem `ı` hem `i` sayılır:
   "ILAÇ" ve "TOPLANTI" tanınır.
4. **Türkçe karakter.** Kullanıcı Türkçe harfi düz yazabilir: "dis hekimi" `dis`, "sac kestir" `sac`,
   "camasir" `camasir` önerir. Tersi geçmez: "dış" diş değildir.
5. **Birden çok eşleşme.**
   - `is`, `ev`, `okul` ve `telefon` bağlam anahtarlarıdır. Başlıkta başka bir anahtar da varsa ona yer
     verirler: "İş yerinde toplantı" `toplanti`, "Ev temizliği" `temizlik`, "Telefon faturası" `fatura`
     önerir.
   - Bunun dışında başlıkta önce geçen kazanır: "Doktora git, ilaç al" `doktor`, "Araba tamiri" `araba`
     önerir.
   - Aynı kelimede iki sözcük eşleşirse uzun olan kazanır: "elektrikçi" `tamir`, "halı saha" `spor`
     önerir.
6. **İstisnalar.** Ek kuralına uyduğu hâlde başka anlama gelen kelimeler dışlanır: isim/ismi (`is`),
   ise (düz yazılmış bağlaç), Doğan (`kamp`), Taksim (`seyahat`), sütun (`market`), kombine (`tamir`),
   macun/macera (`spor`).

## Asistan için

Asistan kayıt oluştururken ya da değiştirirken yukarıdaki 29 anahtardan birini seçer. Uygun anahtar yoksa
`genel` kullanır. Anahtarı başlığın anlamına göre seçer; tablodaki sözcükler yol gösterir ama sınır
değildir. Örneğin "Vesikalık fotoğraf çektir" için `genel` uygundur, "Annemin hediyesini kargola" için
`kargo` uygundur.
