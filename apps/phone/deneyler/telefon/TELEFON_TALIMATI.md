# Telefon talimatı (deneme uygulaması kurulumu)

Bu adımlar, Android telefonda yan yüklenen deneme uygulamasının önünde engel olup olmadığını ölçmek içindir. Bir adım takılırsa aşmaya çalışma: ekranda yazanı aynen not et, sonra birlikte bakılır. Menü adları üretici arayüzüne ve Android sürümüne göre farklı olabilir; farklıysa onu da not et. Testler bitene kadar banka, e-devlet, parola yöneticisi gibi hassas uygulamaları açma. Uygulamadaki parola kutusuna gerçek parola yazma.

Deneme uygulaması telefonda "eren-kit deneme" adıyla görünür (paket adı `dev.eren.deneme`; bu bir kod tanımlayıcısıdır). Aşağıdaki adımlarda "deneme uygulaması" bu uygulamadır.

**0. Hazırlık.** Telefon ile PC aynı özel ağda olmalı (örneğin Tailscale kullanıyorsan açık ve bağlı olsun). PC tarafında test sunucusu çalışıyor olmalı (bkz. `README.md`); sunucunun adresi `PC_ADRESI_BURAYA` yer tutucusunun yerine geçer.
→ Bağlı değilse ya da bağlanmıyorsa: "ağ bağlı değil" diye not et.

**1. Dosyayı indir ve aç.** Telefonda tarayıcıdan `http://PC_ADRESI_BURAYA:47800/deneme.apk` adresini aç. Tarayıcı "zararlı olabilir" derse yine de indir, sonra İndirilenler'den aç. Dosya boyutunun PC'deki `deneme.apk` ile aynı olduğunu doğrula.
→ Sayfa açılmazsa: hata metnini aynen not et.
→ Not et: hangi tarayıcıyla indirdin, hangi uygulamayla açtın, inmesi yaklaşık ne kadar sürdü.

**2. Kaynak izni.** "Bu kaynaktan yükleme izni yok" çıkarsa Ayarlar'a geç, izni aç, geri dön.
→ Çıktıysa: "kaynak izni istendi, verildi" diye not et. Çıkmadıysa: "kaynak izni çıkmadı" diye not et.

**3. Kurulum uyarıları.** Üretici güvenlik taraması ya da "riskli uygulama" ekranı çıkarsa geri sayımı bekleyip "Yine de yükle"yi seç. Google Play Protect "Güvenli olmayan uygulama engellendi" derse "Daha fazla ayrıntı" → "Yine de yükle"yi seç. "Taramaya gönderilsin mi" sorusunda "Gönderme"yi seç.
→ Her uyarının başlığını sırayla not et.
→ "Yine de yükle" seçeneği yoksa, üretici hesabı girişi ya da "Güvenli mod" kapatma istiyorsa, "doğrulanmamış geliştirici" gibi bir şey diyorsa: **dur, hiçbir şeyi kapatma**, ekrandaki metni aynen not et.
→ Kurulduysa: "kuruldu" diye not et.

**4. Uygulamayı aç.** Deneme uygulamasını aç. Bildirim izni sorarsa "İzin ver"i seç.
→ Not et: ekrandaki "Bağlantı:" satırı "var" mı "yok" mu, bildirim çubuğunda "deneme çalışıyor" bildirimi görünüyor mu.

**5. Erişilebilirliği dene.** Uygulamadaki "Erişilebilirlik ayarları" düğmesine bas. "Yüklü uygulamalar" (ya da "İndirilen uygulamalar") altında deneme uygulamasına gir, açmayı dene.
→ "Kısıtlanmış ayar" uyarısı çıktıysa ya da düğme griyse: metni aynen not et, sonra 6. adıma geç.
→ Uyarı çıkmadan açıldıysa: "kısıtlı ayar çıkmadı" diye not et, 7. adımdan devam et.

**6. Kısıtlı ayarlara izin ver.** Uygulamadaki "Uygulama bilgisi" düğmesine bas, sağ üstteki üç noktaya (⋮) dokun, "Kısıtlı ayarlara izin ver"i seç, ekran kilidini ya da parmak izini gir. Sonra 5. adımdaki yere dönüp yeniden aç.
→ Üç noktada bu seçenek yoksa: "seçenek yok" diye not et, üç noktada neler yazdığını da ekle.

**7. Tam kontrol uyarısı.** Android "tam kontrol" uyarısı gösterir, üretici arayüzü ek bir geri sayım koyabilir. Bekle, "İzin ver"i seç.
→ Not et: geri sayım kaç saniyeydi, uygulamaya dönünce ilk satır "Erişilebilirlik: açık (servis bağlı)" mı.

**8. Otomatik başlatma ve pil.** "Uygulama bilgisi"ne yeniden gir. Varsa "Otomatik başlatma"yı aç. "Pil tasarrufu"nda "Kısıtlama yok"u seç.
→ Not et: ikisini de bulabildin mi, ayarlayınca öyle kaldı mı. Bulamadığın varsa adını yaz.

**9. Ağ uygulamasının pili.** Telefon ile PC'yi bağlayan VPN/ağ uygulaması için de aynı "Pil tasarrufu" ekranına bak (örneğin Tailscale). Önce mevcut değerini not et, sonra "Kısıtlama yok" yap. Ağ uygulaması uyursa kopmanın suçu deneme uygulamasına yazılır; ikisini ayırmak için gerekir.
→ Not et: eski değer neydi.

**10. Hazır.** Deneme uygulaması ekranını açık bırak, ekranı kapatma. Testler başlatılır; ekranı kapatma ve yeniden başlatma adımları sırası gelince istenir.

**Deneme bitince** deneme uygulamasını kaldır. Durdurmak istersen Erişilebilirlik'ten kapatman ya da uygulamayı silmen yeter.
