package dev.eren.ajanda.kimlik

import dev.eren.ajanda.cekirdek.AjandaKanalHatasi
import dev.eren.ajanda.cekirdek.BaglantiAsamasi

/**
 * Eşleştirme ekranının kullanıcı metinleri (saf; ortak metin kaynaklarına dokunmamak için burada).
 * Kod ve anahtar hiçbir metne girmez; parmak izi açık anahtarın özetidir, gösterilmek içindir.
 */
object EslestirmeMetinleri {
    const val KOMUT = "eslestir --ajanda"

    const val BASLIK = "PC ile eşleştir"
    val ADIMLAR = listOf(
        "1. PC'de eşleştirme komutunu çalıştırın: $KOMUT",
        "2. Çıktının tamamını kopyalayıp aşağıya yapıştırın ({ ile başlayan satır eşleştirme verisidir).",
        "3. Çıktıdaki \"Kod:\" satırındaki kodu yazın.",
        "4. Aşağıda görünen parmak izini PC'deki \"Parmak izi:\" satırıyla karşılaştırın; aynı değilse eşleştirmeyin.",
    )

    fun veriHatasi(h: VeriHatasi): String = when (h) {
        VeriHatasi.CokUzun -> "Metin çok uzun. Yalnız eşleştirme komutunun çıktısını yapıştırın."
        VeriHatasi.JsonSatiriYok -> "Eşleştirme verisi bulunamadı: { ile başlayan satır yok. Komutun çıktısını eksiksiz kopyalayın."
        VeriHatasi.JsonDegil -> "Eşleştirme verisi bozuk (okunamadı). Çıktıyı yeniden kopyalayın."
        VeriHatasi.BaskaKanal ->
            "Bu veri ajanda için değil (sohbet uygulamasının eşleştirme verisi). PC'de \"$KOMUT\" çalıştırıp onun çıktısını yapıştırın."
        VeriHatasi.ParmakIziUyusmuyor ->
            "Metindeki parmak izi verideki anahtarla tutmuyor: metin bozulmuş ya da iki çıktı karışmış. Çıktıyı yeniden kopyalayın."
        is VeriHatasi.GecersizAlan -> when (h.alan) {
            "host" -> "PC adresi bir Tailscale adresi değil (100.64.0.0/10). PC'de Tailscale'in açık olduğunu denetleyin."
            else -> "Eşleştirme verisi geçersiz (${h.alan}: ${h.neden})."
        }
    }

    fun kodHatasi(h: KodHatasi): String = when (h) {
        KodHatasi.Bos -> "PC'deki \"Kod:\" satırındaki kodu yazın."
        KodHatasi.Kisa -> "Kod en az ${EslestirmeVerisi.KOD_EN_KISA} karakterdir."
        KodHatasi.Uzun -> "Kod en çok ${EslestirmeVerisi.KOD_EN_UZUN} karakterdir."
        KodHatasi.GecersizKarakter -> "Kod yalnız harf (A-Z) ve rakam içerir."
        KodHatasi.VeriyleUyusmuyor ->
            "Kod, yapıştırılan veriyle uyuşmuyor. Kodu PC'den yeniden okuyun; komutu yeniden çalıştırdıysanız yeni çıktıyı yapıştırın."
    }

    fun bilgi(b: Bilgi): String = when (b) {
        is Bilgi.Kaldirildi ->
            "Eşleşme bu telefondan kaldırıldı ve cihaz anahtarı silindi. PC'deki kaydı da kaldırmak için: $KOMUT --kaldir ${b.deviceId}"
    }

    fun asama(a: BaglantiAsamasi?): String = when (a) {
        null, BaglantiAsamasi.KOPUK -> "PC'ye bağlanılıyor…"
        BaglantiAsamasi.ESLESTIRME -> "PC'nin yanıtı bekleniyor…"
        else -> "Kimlik doğrulanıyor…"
    }

    /** Başlık ve açıklama. */
    fun hata(h: EslestirmeHatasi): Pair<String, String> = when (h) {
        EslestirmeHatasi.YanlisKod -> "Kod kabul edilmedi" to
            "PC bu kodu reddetti (kullanılmış ya da yerine yenisi üretilmiş olabilir). PC'de \"$KOMUT\" komutunu yeniden çalıştırıp yeni çıktıyı yapıştırın."
        EslestirmeHatasi.PencereKapali -> "Eşleştirme penceresi kapalı" to
            "Kodun süresi dolmuş (5 dakika) ya da pencere kapanmış (yeni bir eşleştirme komutu öncekini kapatır). Komutu yeniden çalıştırın."
        EslestirmeHatasi.YanlisKanal -> "Yanlış kanal" to
            "PC bu eşleştirmeyi ajanda kanalında kabul etmedi; pencere sohbet uygulaması için açılmış olabilir. PC'de \"$KOMUT\" ile yeni kod üretin."
        EslestirmeHatasi.IpUyusmuyor -> "Adres kabul edilmedi" to
            "PC bağlantının geldiği adresi kabul etmedi. Telefonun Tailscale bağlantısını denetleyip komutu yeniden çalıştırın."
        EslestirmeHatasi.AgYok -> "Ağ yok" to
            "Telefonda etkin bir ağ bağlantısı yok. Wi-Fi ya da mobil veriyi açıp yeniden deneyin."
        is EslestirmeHatasi.PcyeUlasilamadi -> {
            val ek = h.sonHata?.let { " (son hata: ${kanalHatasiAdi(it)})" } ?: ""
            when {
                !h.tailscaleVar -> "Tailscale bağlı değil" to
                    "PC'ye yalnız Tailscale üzerinden bağlanılır. Telefonda Tailscale'i açıp yeniden deneyin.$ek"
                h.asama == BaglantiAsamasi.ESLESTIRME -> "PC yanıt vermedi" to
                    "İstek PC'ye ulaştı ama sonuç gelmedi. PC'deki servisi denetleyip yeniden deneyin.$ek"
                else -> "PC'ye ulaşılamadı" to
                    "PC'deki servisin çalıştığını ve iki cihazın da Tailscale'de açık olduğunu denetleyin.$ek"
            }
        }
        is EslestirmeHatasi.PcReddetti -> "PC eşleştirmeyi reddetti" to "Neden: ${kanalHatasiAdi(h.kod)}."
        is EslestirmeHatasi.Cekirdek -> "Beklenmeyen hata" to h.mesaj
    }

    /** Kablodaki adı (`AJANDA_KANAL_HATALARI`): `ESLESTIRME_KAPALI` -> `eslestirme_kapali`. */
    fun kanalHatasiAdi(k: AjandaKanalHatasi): String = k.name.lowercase(java.util.Locale.ROOT)
}
