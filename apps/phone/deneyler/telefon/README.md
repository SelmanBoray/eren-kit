# Telefon denemesi

Bu bir ölçüm denemesidir, ürün değildir.
Sunucuda kimlik doğrulama yoktur; ağa açık çalıştırılmamalıdır.
Adresler yer tutucudur: JS tarafında `EREN_PC_IP` (PC adresi) ve `EREN_TELEFON_IP` (izinli telefon adresi) ortam değişkenleri,
Kotlin tarafında derleme sırasında `EREN_KIT_PC_URL` ortam değişkeni (verilmezse `PC_ADRESI_BURAYA` yer tutucusu).
Dokunma ve yazma yalnız kendi ekranlarında çalışır (erişilebilirlik servisi).
Yazılma amacı şu sorulara cevap aramaktır:
- Yalın Kotlin uygulaması telefonu PC'den uzaktan okuyup yönlendirebilir mi?
- Arka plan servisi ve yeniden açılışta bağlantı ne kadar kalıcı kalır?
- Ekran okuma ve komut gecikmesi ne kadardır?
Sonuçlar `docs/OLCUMLER.md` içindedir.

Bileşenler: `android/` (yalın Kotlin APK), `sunucu/` (Node test sunucusu `sunucu.js`, komut satırı istemcisi `cli.js`, telefonsuz öz sınama `oztest.js`). Kurulum adımları: `TELEFON_TALIMATI.md`. Üst belge: `../../README.md`.
