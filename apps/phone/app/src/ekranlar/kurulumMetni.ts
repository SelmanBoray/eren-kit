/**
 * Kurulum ekranının yetkiyle ilgili metinleri. Her cümle kodun gerçekten yaptığını söyler; testler
 * (`test/ekranlar/kurulumMetni.test.ts`) mutlak iddiaları ve yanıltıcı kalıpları yakalar.
 *
 * Gerçekler (Kotlin): kararı olmayan kurulu uygulama varsayılan AÇIK başlar; banka/para/kimlik
 * uygulaması ad ve paket adından TAHMİNLE hassas başlar (`HassasUygulamalar.otomatikHassasMi`, liste ve
 * ipuçları her uygulamayı yakalamaz). Değişmez ret listesi (Ayarlar, Play Store, izin pencereleri...)
 * ve parola alanı reddi kapıdadır. Yeni eşleşme kaydı tam yetkiyi kapatır (`EslestirmeActivity`).
 * Ses tuşu kısayolu önceki kısayol hedeflerini silmez (`KisayolHedefleri.ekle`).
 */
import type { EslestirmeSonucu, SesKisayoluSonucu } from "../../modules/eren-device/src/ErenDevice.types.ts";
import type { Sonuc } from "../cihaz/erenDevice.ts";

export function tamYetkiAciklamasi(ad: string): string {
  return (
    `Açıkken ${ad} telefonda onay sormadan okur, yazar, gönderir. Uygulamalar listesinde açık olan her ` +
    `uygulamada çalışır; kurulu sıradan uygulamalar varsayılan olarak açıktır. Kapalı (hassas) uygulamalar, Ayarlar ` +
    `ve parola alanları yine yasak. Kalıcı bildirimdeki Durdur o anki işleri keser ve tam yetkiyi de kapatır; ` +
    `başka bir PC ile eşleşmek de tam yetkiyi kapatır. Yeniden açmak için buradan Aç (kimlik doğrulama).`
  );
}

export function uygulamalarAciklamasi(ad: string): string {
  return (
    `${ad} telefonda kurulu sıradan uygulamaları varsayılan olarak kullanabilir. Banka, e-para, kripto, borsa, iki ` +
    `adımlı doğrulama ve e-Devlet gibi uygulamaları adından ve paket adından tahmin edip kapalı başlatır; ` +
    `bu tahmin her uygulamayı yakalamaz (özellikle yurt dışı uygulamalarını). Listeyi kontrol et, ` +
    `istemediğini buradan kapat.`
  );
}

export function sesKisayoluAciklamasi(ad: string): string {
  return (
    `Ses açma ve kısma tuşlarını birlikte yaklaşık 3 saniye basılı tut: ${ad} dinlemeye başlar, baktığın ` +
    `uygulamayı bağlam olarak alır. Kur, telefondaki mevcut erişilebilirlik kısayolunu (ör. TalkBack) silmez; ` +
    `ikisi birlikte kalır ve tuşlara basınca telefon hangisinin açılacağını sorar.`
  );
}

export function sesKisayoluNotu(r: Sonuc<SesKisayoluSonucu>): string {
  if (!r.ok || r.deger === "hata") {
    return "Kısayol kurulamadı. Ayarlar > Erişilebilirlik > Erişilebilirlik kısayolundan elle \"Ses tuşu kısayolu\" seçebilirsin.";
  }
  if (r.deger === "yetki_yok") {
    return "Kurulum adımı eksik: telefonu USB ile bağlayıp `node kurulum/telefon.ts` çalıştır.";
  }
  const onay = "İlk kullanımda telefon bir kez onay isteyebilir; onayladıktan sonra tuşlara yeniden basman gerekebilir.";
  if (r.deger === "kuruldu_digerleriyle") {
    return (
      "Kısayol kuruldu. Önceki erişilebilirlik kısayolun silinmedi: tuşlara basınca telefon hangisinin " +
      `açılacağını sorar. ${onay}`
    );
  }
  return `Kısayol kuruldu. ${onay}`;
}

/** `tamYetkiOnceAcikti`: eşleştirmeden önce okunan durum; yeni eşleşme kaydı tam yetkiyi kapatır. */
export function eslesmeNotu(r: Sonuc<{ sonuc: EslestirmeSonucu }>, tamYetkiOnceAcikti: boolean): string {
  if (!r.ok) return r.neden === "desteklenmiyor" ? "Bu cihazda eşleşme desteklenmiyor." : "Eşleşme başlatılamadı.";
  if (r.deger.sonuc === "iptal") return "Eşleşme iptal edildi.";
  if (r.deger.sonuc !== "tamam") return "Eşleşme başarısız.";
  return tamYetkiOnceAcikti
    ? "Eşleşildi. Tam yetki kapatıldı; bu PC için istersen yeniden açabilirsin."
    : "Eşleşildi.";
}
