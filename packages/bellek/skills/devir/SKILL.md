---
name: "devir"
description: "Oturum devri: /devir, devir notu yaz, oturumu devret, yeni oturuma geçeceğim, kaldığımız yeri kaydet dendiğinde zengin devir notu yazar; yeni oturumda önceki işe devam edilirken de notu okutur."
---

# Devir

## Not klasörü
Devir notlarının kökü `BELLEK_DEVIR_DIR` ortam değişkeninden gelir; tanımlı değilse `bellek.toml` içindeki `vault` klasörünün altındaki `devir` klasörüdür. Klasörü öğrenmek için (Git Bash): `echo "$BELLEK_DEVIR_DIR"`; boşsa `bellek yollar` çıktısındaki `vault` + `/devir`. Yeni oturumun bağlamındaki devir dizini de aynı klasördeki notları listeler; oradaki yolları örnek al. Otomatik notlar `oto/` alt klasöründedir, zengin notlar doğrudan kökte durur.

## Not yazma
Saati tahmin etme; önce komutla al (Git Bash): `date +%Y-%m-%dT%H:%M:%S%:z` (tarih alanı) ve `date +%Y-%m-%d-%H%M` (dosya adı).
Yol: `<devir klasörü>/YYYY-MM-DD-HHMM-<slug>.md` (slug küçük harf ASCII, tire). Aynı oturum için zengin not zaten varsa yenisini açma, onu güncelle.

Biçim (sözleşme, dizin okuyucu ayrıştırır; değerlerde satır sonu yok):

```
---
tur: devir
oturum: <bağlamdaki "Oturum kimliği" değeri, yoksa ->
konu: <kısa başlık>
proje: <ana çalışma klasörü ya da ->
tarih: <ISO 8601, saat dilimi ZORUNLU, ör. 2026-11-08T19:30:00+03:00>
durum: devam | bitti | beklemede
---
## Neredeyiz
## Sıradaki adımlar
## Açık sorular ve kararlar
## İlgili dosyalar ve komutlar
```

Kurallar:
- Kişisel/özel işse ön bilgiye `private: true` eklenebilir (not yeni oturumların dizininde görünmez).
- Toplam en çok ~2500 karakter. Konuşma özeti değil, bağlamsız bir oturumun devam edebileceği durum: dosya yolları, komutlar, son test sonucu, bekleyen kararlar.
- Sır, parola, API anahtarı, kişisel veri yazma.

Yazdıktan sonra kullanıcıya yalnız iki satır:
`Not: <yol>`
`Artık bu oturumu kapatabilirsin; yeni oturumda '<konu>'ya devam de, dizin otomatik gelir.`

## Devam etme
Yeni oturumda kullanıcı önceki işe devam etmek isterse bağlamdaki devir dizininden ilgili notu oku. İş bitince notun `durum` değerini `bitti` yap.
