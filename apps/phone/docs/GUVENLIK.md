# eren-kit telefon: güvenlik

Durum: v1, 2026-11-06. Mimari için `MIMARI.md`, sayılar için `OLCUMLER.md`.

## Tehdit modeli
PC tek güven bölgesidir. Serbest bir iş oturumu servisle aynı Windows kullanıcısı olarak çalışır; PC tarafında "komut yalnız kullanıcıdan geldi" kanıtlanamaz. Bu yüzden sert sınır iki yerdedir: telefondaki Kotlin kapısı ve kullanıcının telefondaki onayı. Ana tehdit: ekranda okunan başka birinin metninin (mesaj, sayfa) komut gibi işlenmesi ve kandırılmış bir PC tarafının telefonu kullanması.

## Sert sınırlar
- **İş izni** telefonda, Kotlin'in `FLAG_SECURE` onay ekranında üretilir, orada saklanır, orada zorlanır. İmza yoktur: üreten ve zorlayan aynıdır. Uygulama adları PackageManager'dan gelir. PC yalnız opak `grant_id` + jeton tutar (servis belleğinde). JS izin oluşturamaz, yalnız onay ekranını isteyebilir. Yazma izni için biyometri istenir.
- **Metin kilidi:** "X'e şunu yaz" işinde izin `izinli_metin[]` taşır, Kotlin başka metni yazmaz. Serbest metin ayrı, daha sert uyarılı bir onaydır. Yazma işinde tek paket vardır; başka uygulamadan okuma izni verilmez.
- **Görünürlük:** izin aktifken kalıcı bildirim + `Durdur` düğmesi + yerel denetim günlüğü. İzin yokken erişilebilirlik olayları işlenmez.
- **ADB sistemde yok:** oturumlara ADB aracı verilmez, çünkü ADB bütün telefon katmanlarını atlar. `device_state.adb_enabled` açıksa uygulama kırmızı uyarı verir.

## PC tümüyle kandırılsa da telefonun reddettikleri
- İzin yok, süresi bitmiş, jeton yanlış, eylem bütçesi dolmuş.
- Ön plan paketi izin dışı (her eylemden hemen önce ve ekran görüntüsünden sonra yeniden denetlenir).
- Hassas uygulama listesi; yeni kurulan uygulama liste kararına kadar.
- Değişmez ret listesi: eren-kit telefon uygulaması, Ayarlar, paket kurucu, Play, izin diyalogları, üretici güvenlik uygulaması, Tailscale, kilit ekranı.
- Parola alanı ve değerleri.
- "Yalnız oku" izninde `type_text`/`key`, ham x,y dokunma, gönder/sil/öde etiketli düğüm.
- URL veya intent açma.
- İzin dışı pencere görünürken ekran görüntüsü.

## Ekrandan okunan metnin sarılması
- Köprü, çıktının tamamını `<<<EKRAN kimlik` ile `>>>EKRAN kimlik` arasına alır; kimlik her çağrıda güvenli üreteçten 64 bit hex.
- Her eleman tek satırdır; `id`, `rol`, `x,y` köprüden gelir, metinden gelmez.
- `ad` ve `değer` alanlarında kaçış: `\`, `"`, `\n \r \t`; C0/C1 kontrol karakterleri `\xNN`; U+202A-202E, U+2066-2069, U+200B-200F, U+061C, U+2060, U+FEFF `\uXXXX`. Kırpma 500 karakterde, kaçırmadan önce.
- `_meta` alanı modele gitmez; savunma sayılmaz ve kullanılmaz.
- Telefon profilinin sistem istemine, ölçümde denenmiş güvenlik metni girer.
- Raporlar da güvenilmez veridir: sentetik olay gövde taşımaz, gövde çitli `rapor_oku` ile gelir. Ana oturum, `isSynthetic` olaylardan plan önermez.
- Telefon işlerinin raporu `kirli` etiketlidir. Model bazen tuzak metnini `[passage omitted]` diye atlar; mesajın aslı gerekiyorsa kaynak ekran kaydı denetim günlüğünden alınır.

## Ölçümler kanıt değildir
Model katmanında yapılan tuzak testlerinde araç ihlali görülmedi (Sonnet 0/46, Opus 0/7, ana oturum sürecinde `plan_oner` ihlali 0), ama bu "model dayanıyor" demek için yetmez: örnek sayısı küçük, saldırılar açık ve kaba, göreve uyumlu saldırılar denenmedi, ortam sahteydi. Sarma kuralının ihlali azalttığı gösterilemedi. Ayrıntı ve sınırlar `OLCUMLER.md`. Güvence modelin davranışından değil, Kotlin kapısından gelir.

## FLAG_SECURE hassas uygulamaları korumaz
Gerçek cihazda ekran görüntüsü `FLAG_SECURE` pencerede hata vermeden yaklaşık tamamen siyah dönüyor, ama erişilebilirlik ağacı (`elements`) aynı pencerenin metnini okuyor. Bu yüzden hassas uygulama koruması paket listesiyle yapılır; `FLAG_SECURE`'a güvenilmez. Siyah görüntü `secure_ekran` olarak işaretlenir.

## Kalan açıklar
Bilinen ve kabul edilmiş durumlar; kapatılmış sayılmamalı.
1. Serbest bir PC oturumu kendi kullanıcısı olarak servis kodunu, DB'yi ve ana oturum transkriptini değiştirebilir, canlı bir izni kötüye kullanabilir, sahte plan gösterebilir. Telefonda yeni izin üretemez.
2. Yazma izinli uygulamada serbest metin hâlâ modele güvenir.
3. "Yalnız oku" dokunması gerçek salt okuma değildir; etiket filtresi en iyi çabadır.
4. SMS okuma izni tek kullanımlık parolaları (OTP) görebilir.
5. Ana oturum kandırılıp zararlı bir plan önerebilir; son savunma kullanıcının onayıdır (onay yorgunluğu riski). PC işlerinde "yapılmayacaklar" listesi teknik olarak zorlanmaz.
6. Ek (ölçümlerden): `ok:true` yanıtı eylemin sonucunu kanıtlamaz, durum yeniden okunmalıdır; bu denetim eksik uygulanırsa servis yanlış başarı raporlayabilir.
7. Ek (ölçümlerden): `claude` çıktısındaki güvenlik sınıflandırıcısı bir istekte hata döndürebilir; sonrasında ana oturum oturumunun kullanılabilir kalıp kalmadığı ölçülmedi.
8. Ek (ölçümlerden): `claude` ileride `-p` için `--bare` varsayılanına geçerse ana oturum süreci abonelik girişini kaybedebilir; servis sürümü kilitlemeli ya da açılışta `apiKeySource`/ilk tur hatasını izlemelidir.
9. Ekran görüntüsü kanalı üzerinden enjeksiyon, bidi/uzun metin ve çok adımlı saldırılar ölçülmedi.
