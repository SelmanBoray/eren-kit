package dev.eren.ajanda.kimlik

import dev.eren.ajanda.cekirdek.AjandaKanalHatasi
import dev.eren.ajanda.cekirdek.BaglantiAsamasi

/**
 * Eşleştirme ekranının kullanıcı metinleri (saf; ortak metin kaynaklarına dokunmamak için burada).
 * Servis "Eren servisi", çalıştığı makine "bilgisayar" diye anılır; "PC" sözcüğü kullanıcı metnine girmez
 * (`KullaniciMetniTest`).
 * Kod ve anahtar hiçbir metne girmez; parmak izi açık anahtarın özetidir, gösterilmek içindir.
 */
object EslestirmeMetinleri {
    const val KOMUT = "eslestir --ajanda"

    const val BASLIK = "Eren'e bağlan"
    val ADIMLAR = listOf(
        "1. Bilgisayarda eşleştirme komutunu çalıştırın: $KOMUT",
        "2. Çıktının tamamını kopyalayıp aşağıya yapıştırın ({ ile başlayan satır eşleştirme verisidir).",
        "3. Çıktıdaki \"Kod:\" satırındaki kodu yazın.",
        "4. Aşağıda görünen parmak izini bilgisayardaki \"Parmak izi:\" satırıyla karşılaştırın; aynı değilse eşleştirmeyin.",
    )

    fun veriHatasi(h: VeriHatasi): String = when (h) {
        VeriHatasi.CokUzun -> "Metin çok uzun. Yalnız eşleştirme komutunun çıktısını yapıştırın."
        VeriHatasi.JsonSatiriYok -> "Eşleştirme verisi bulunamadı: { ile başlayan satır yok. Komutun çıktısını eksiksiz kopyalayın."
        VeriHatasi.JsonDegil -> "Eşleştirme verisi bozuk (okunamadı). Çıktıyı yeniden kopyalayın."
        VeriHatasi.BaskaKanal ->
            "Bu veri ajanda için değil (sohbet uygulamasının eşleştirme verisi). Bilgisayarda \"$KOMUT\" çalıştırıp onun çıktısını yapıştırın."
        VeriHatasi.ParmakIziUyusmuyor ->
            "Metindeki parmak izi verideki anahtarla tutmuyor: metin bozulmuş ya da iki çıktı karışmış. Çıktıyı yeniden kopyalayın."
        is VeriHatasi.GecersizAlan -> when (h.alan) {
            // Sürüm 2: başka sürümün QR'ı (eski servisin açtığı pencere ya da daha yeni servis).
            "v" -> "Eşleştirme verisi başka bir ajanda sürümünden. Bilgisayardaki Eren servisi ile bu uygulamayı aynı sürüme güncelleyip yeni kod alın."
            "host" -> "Eren servisinin adresi bir Tailscale adresi değil (100.64.0.0/10). Bilgisayarda Tailscale'in açık olduğunu denetleyin."
            else -> "Eşleştirme verisi geçersiz (${h.alan}: ${h.neden})."
        }
    }

    fun kodHatasi(h: KodHatasi): String = when (h) {
        KodHatasi.Bos -> "Bilgisayardaki \"Kod:\" satırındaki kodu yazın."
        KodHatasi.Kisa -> "Kod en az ${EslestirmeVerisi.KOD_EN_KISA} karakterdir."
        KodHatasi.Uzun -> "Kod en çok ${EslestirmeVerisi.KOD_EN_UZUN} karakterdir."
        KodHatasi.GecersizKarakter -> "Kod yalnız harf (A-Z) ve rakam içerir."
        KodHatasi.VeriyleUyusmuyor ->
            "Kod, yapıştırılan veriyle uyuşmuyor. Kodu bilgisayardan yeniden okuyun; komutu yeniden çalıştırdıysanız yeni çıktıyı yapıştırın."
    }

    fun bilgi(b: Bilgi): String = when (b) {
        is Bilgi.Kaldirildi ->
            "Eşleşme bu telefondan kaldırıldı ve cihaz anahtarı silindi. Kayıtlarınız bu telefonda duruyor; " +
                "uygulama Eren servisi olmadan çalışmayı sürdürüyor. Eren servisindeki kopya yedek olarak duruyor. " +
                "Bu telefonu Eren servisinden de kaldırmak için bilgisayarda: ${kaldirmaKomutu(b.deviceId)}"
    }

    /** Servisteki cihaz kaydını kaldıran komut (bilgisayarda çalıştırılır). */
    fun kaldirmaKomutu(deviceId: String): String = "$KOMUT --kaldir $deviceId"

    // --- Eşleştirme ekranının sabit metinleri ---------------------------------------------------

    /** Bağlanılan ya da eşleşilen makinenin adresi. */
    fun adres(host: String, port: Int): String = "Bilgisayar: $host:$port"

    const val PARMAK_IZI_ACIKLAMASI =
        "Eren servisinin anahtar parmak izi (bilgisayardaki \"Parmak izi:\" satırıyla aynı olmalı):"

    const val KALDIRMA_BASLIGI = "Eşleşme kaldırılsın mı?"

    /**
     * Eşleşmeyi kaldırma onayı. `eslesmeyiKaldir` koparmadır (D2): kayıt silinmez, eşleşme bilgisi ve cihaz
     * anahtarı silinir; servisteki cihaz kaydı ayrıca bilgisayardan kaldırılır (komut sonra gösterilir).
     */
    const val KALDIRMA_ONAYI =
        "Kayıtlarınız bu telefonda kalır; uygulama Eren servisi olmadan çalışmayı sürdürür. Henüz gönderilmemiş " +
            "değişiklikler de telefonda kalır ama Eren servisine gitmez. Eren servisindeki kopya yedek olarak durur. " +
            "Bu telefonun cihaz anahtarı silinir; yeniden bağlanmak için bilgisayarda yeni kod gerekir. Kaldırınca, " +
            "bu telefonu Eren servisinden de kaldıracak komut gösterilir."

    /**
     * Sayılı kaldırma onayı: gönderilmemişlerin toplamı `kuyrukta + ertelenen` (`BaglantiDurumu.kuyrukta`,
     * `ertelenenIslem`; [GecisMetinleri.gonderilmeyenler]). `kuyrukta` `null` (okunamadı): [KALDIRMA_ONAYI].
     */
    fun kaldirmaOnayi(kuyrukta: Int?, ertelenen: Int = 0): String {
        if (kuyrukta == null) return KALDIRMA_ONAYI
        return listOfNotNull(
            "Kayıtlarınız bu telefonda kalır; uygulama Eren servisi olmadan çalışmayı sürdürür.",
            GecisMetinleri.gonderilmeyenler(kuyrukta, ertelenen),
            "Eren servisindeki kopya yedek olarak durur. Bu telefonun cihaz anahtarı silinir; yeniden bağlanmak için " +
                "bilgisayarda yeni kod gerekir. Kaldırınca, bu telefonu Eren servisinden de kaldıracak komut gösterilir.",
        ).joinToString(" ")
    }

    const val KALDIR_DUGMESI = "Kaldır"

    fun asama(a: BaglantiAsamasi?): String = when (a) {
        null, BaglantiAsamasi.KOPUK -> "Eren servisine bağlanılıyor…"
        BaglantiAsamasi.ESLESTIRME -> "Eren servisinin yanıtı bekleniyor…"
        else -> "Kimlik doğrulanıyor…"
    }

    /** Başlık ve açıklama. */
    fun hata(h: EslestirmeHatasi): Pair<String, String> = when (h) {
        EslestirmeHatasi.YanlisKod -> "Kod kabul edilmedi" to
            "Eren servisi bu kodu reddetti (kullanılmış ya da yerine yenisi üretilmiş olabilir). Bilgisayarda \"$KOMUT\" komutunu yeniden çalıştırıp yeni çıktıyı yapıştırın."
        EslestirmeHatasi.PencereKapali -> "Eşleştirme penceresi kapalı" to
            "Kodun süresi dolmuş (5 dakika) ya da pencere kapanmış (yeni bir eşleştirme komutu öncekini kapatır). Komutu yeniden çalıştırın."
        EslestirmeHatasi.YanlisKanal -> "Yanlış kanal" to
            "Eren servisi bu eşleştirmeyi ajanda kanalında kabul etmedi; pencere sohbet uygulaması için açılmış olabilir. Bilgisayarda \"$KOMUT\" ile yeni kod üretin."
        EslestirmeHatasi.IpUyusmuyor -> "Adres kabul edilmedi" to
            "Eren servisi bağlantının geldiği adresi kabul etmedi. Telefonun Tailscale bağlantısını denetleyip komutu yeniden çalıştırın."
        EslestirmeHatasi.AgYok -> "Ağ yok" to
            "Telefonda etkin bir ağ bağlantısı yok. Wi-Fi ya da mobil veriyi açıp yeniden deneyin."
        is EslestirmeHatasi.PcyeUlasilamadi -> {
            val ek = h.sonHata?.let { " (son hata: ${kanalHatasiAdi(it)})" } ?: ""
            when {
                !h.tailscaleVar -> "Tailscale bağlı değil" to
                    "Eren servisine yalnız Tailscale üzerinden bağlanılır. Telefonda Tailscale'i açıp yeniden deneyin.$ek"
                h.asama == BaglantiAsamasi.ESLESTIRME -> "Eren servisi yanıt vermedi" to
                    "İstek Eren servisine ulaştı ama sonuç gelmedi. Bilgisayardaki Eren servisini denetleyip yeniden deneyin.$ek"
                else -> "Eren servisine ulaşılamadı" to
                    "Bilgisayarda Eren servisinin çalıştığını ve iki cihazın da Tailscale'de açık olduğunu denetleyin.$ek"
            }
        }
        is EslestirmeHatasi.PcReddetti -> "Eren servisi eşleştirmeyi reddetti" to "Neden: ${kanalHatasiAdi(h.kod)}."
        is EslestirmeHatasi.Cekirdek -> "Beklenmeyen hata" to h.mesaj
    }

    /** Kablodaki adı (`AJANDA_KANAL_HATALARI`): `ESLESTIRME_KAPALI` -> `eslestirme_kapali`. */
    fun kanalHatasiAdi(k: AjandaKanalHatasi): String = k.name.lowercase(java.util.Locale.ROOT)
}
