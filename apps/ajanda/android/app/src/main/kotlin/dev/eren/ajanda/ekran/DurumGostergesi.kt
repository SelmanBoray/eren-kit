package dev.eren.ajanda.ekran

import dev.eren.ajanda.alarm.HatirlatmaDurumu
import dev.eren.ajanda.alarm.HatirlatmaSorunu
import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.EslesmeDurumu
import dev.eren.ajanda.cekirdek.SurumUyusmazligi
import java.time.ZoneId

/**
 * Üst çubuktaki PC bağlantı göstergesi (saf): eşleşme, bağlantı aşaması, kuyruk ve son eşitleme.
 * Kısa metin çubukta, ayrıntı dokununca açılan pencerede durur.
 */
object DurumGostergesi {
    enum class Ton { IYI, SURUYOR, CEVRIMDISI, UYARI }

    enum class Eylem { ESLESTIR, YOK }

    data class Gosterge(val kisa: String, val ayrinti: String, val ton: Ton, val eylem: Eylem)

    /**
     * Onay bekleyen birleştirme (D4). Çekirdek bu sırada `TELAFI` aşamasındadır ama hiçbir şey eşitlenmez
     * ("Eşitleniyor…" yanlış olur): kayıtlar onaya dek ne gider ne gelir.
     */
    val BIRLESTIRME_BEKLIYOR = Gosterge(
        "Onay bekliyor",
        "Eren servisine bağlandı; kayıtların birleştirilmesi onayınızı bekliyor. Onaylayana dek hiçbir şey " +
            "eşitlenmez: bu telefondaki değişiklikler servise gitmez, servisteki değişiklikler de bu telefona gelmez.",
        Ton.UYARI, Eylem.YOK,
    )

    /**
     * [bekliyor] (görünümün `BirlestirmeAkisi`'nden bildiği) doğruysa süren ([Ton.SURUYOR]) bir göstergenin yerine
     * [BIRLESTIRME_BEKLIYOR]; değilse [g] olduğu gibi. Bağlı, çevrimdışı ve uyarı göstergelerine dokunmaz (bayat
     * bir "bekliyor" bilgisi onları örtmez). [hesapla]'nın davranışı değişmez.
     */
    fun birlestirmeyle(g: Gosterge, bekliyor: Boolean): Gosterge =
        if (bekliyor && g.ton == Ton.SURUYOR) BIRLESTIRME_BEKLIYOR else g

    /**
     * @param adresVar `baglantiAdresi() != null`: eski eşleşme dururken yeni QR reddedilince durum
     *   `Reddedildi` görünür ama bağlantı eskisiyle sürer (MIMARI "K1").
     * @param okumaHatasi çekirdek okunamadıysa kısa neden.
     */
    fun hesapla(
        eslesme: EslesmeDurumu?,
        baglanti: BaglantiDurumu?,
        adresVar: Boolean,
        simdiMs: Long,
        dilim: ZoneId,
        okumaHatasi: String? = null,
    ): Gosterge {
        if (okumaHatasi != null) {
            return Gosterge("Okunamadı", "Telefondaki ajanda deposu okunamadı: $okumaHatasi", Ton.UYARI, Eylem.YOK)
        }
        if (eslesme == null) return Gosterge("…", "Durum okunuyor.", Ton.SURUYOR, Eylem.YOK)
        val bekleyen = baglanti?.kuyrukta ?: 0
        // Eski (v2) servise bağlıyken bu serviste gitmeyen işlemler: v3 değişiklikleri ve aynı kayıtta onların
        // arkasında sırası tutulan sil/güncelle satırları. `kuyrukta`'ya girmezler ama gönderilmemişlerdir.
        val ertelenen = baglanti?.ertelenenIslem ?: 0
        val gonderilmemis = bekleyen + ertelenen
        val bekleyenMetni = bekleyenMetni(bekleyen, ertelenen)
        val sonEsitleme = baglanti?.sonEsitlenmeMs?.let { "Son eşitleme: ${EkranMetinleri.goreliAn(it, simdiMs, dilim)}." }
            ?: "Henüz hiç eşitlenmedi."

        when (eslesme) {
            is EslesmeDurumu.Yok -> return Gosterge(
                "Eşleşmedi",
                "Bu telefon PC ile eşleşmedi. Kayıtlarınız yalnız bu telefonda duruyor; eşleşince PC'ye gönderilir.\n$bekleyenMetni",
                Ton.UYARI, Eylem.ESLESTIR,
            )
            is EslesmeDurumu.Bekliyor -> return Gosterge(
                "Eşleştiriliyor",
                "PC ile eşleştirme sürüyor (${eslesme.host}).",
                Ton.SURUYOR, Eylem.YOK,
            )
            is EslesmeDurumu.Reddedildi -> if (!adresVar) {
                val (neden, _) = EkranMetinleri.kanalHatasi(eslesme.kod)
                return Gosterge(
                    "Eşleşme reddedildi",
                    "PC eşleştirmeyi reddetti: $neden\nPC'de yeni kod alıp yeniden eşleştirin.",
                    Ton.UYARI, Eylem.ESLESTIR,
                )
            }
            is EslesmeDurumu.Eslesti -> Unit
        }
        val reddedildiNotu = if (eslesme is EslesmeDurumu.Reddedildi) {
            "\nSon eşleştirme denemesi reddedildi; önceki eşleşme sürüyor."
        } else {
            ""
        }
        val b = baglanti ?: return Gosterge("…", "Bağlantı durumu okunuyor.$reddedildiNotu", Ton.SURUYOR, Eylem.YOK)
        val hata = b.sonHata?.let { EkranMetinleri.kanalHatasi(it) }
        val hataSatiri = hata?.let { "\nSon hata: ${it.first}" } ?: ""
        val surum = b.surumUyusmazligi
        if (surum != null && b.asama == BaglantiAsamasi.KOPUK) {
            // Sürüm uyuşmazlığı (v2): yeniden bağlanma geri çekilir; güncellenince kendiliğinden bağlanır.
            val (kisa, ne) = surumMetni(surum)
            return Gosterge(
                kisa,
                "$ne Kayıtlarınız, bekleyen değişiklikler ve hatırlatmalar telefonda duruyor; hatırlatmalar " +
                    "PC'den bağımsız çalmaya devam eder. Güncellemeden sonra aynı eşleşmeyle bağlanılır, yeniden " +
                    "eşleştirme gerekmez.\n$sonEsitleme\n$bekleyenMetni$reddedildiNotu",
                Ton.UYARI, Eylem.YOK,
            )
        }
        return when (b.asama) {
            BaglantiAsamasi.CANLI -> Gosterge(
                when {
                    bekleyen > 0 -> "Bağlı · $bekleyen gönderiliyor"
                    ertelenen > 0 -> "Bağlı · $ertelenen bekliyor"
                    else -> "Bağlı"
                },
                // Ertelenen değişiklik varken PC'deki kayıtlar güncel değildir (servis güncellenince gider).
                (if (ertelenen > 0) "PC'ye bağlı." else "PC'ye bağlı, kayıtlar güncel.") + "\n$bekleyenMetni$reddedildiNotu",
                Ton.IYI, Eylem.YOK,
            )
            BaglantiAsamasi.TELAFI -> Gosterge(
                "Eşitleniyor…",
                "PC'ye bağlandı, kayıtlar eşitleniyor.\n$sonEsitleme$reddedildiNotu",
                Ton.SURUYOR, Eylem.YOK,
            )
            BaglantiAsamasi.EL_SIKISMA, BaglantiAsamasi.ESLESTIRME -> Gosterge(
                "Bağlanıyor…",
                "PC'ye bağlanılıyor.\n$sonEsitleme\n$bekleyenMetni$reddedildiNotu",
                Ton.SURUYOR, Eylem.YOK,
            )
            BaglantiAsamasi.KOPUK -> {
                val yenidenEslestir = hata?.second == true
                val kisa = when {
                    yenidenEslestir -> "PC tanımıyor"
                    gonderilmemis > 0 -> "Çevrimdışı · $gonderilmemis bekliyor"
                    else -> "Çevrimdışı"
                }
                Gosterge(
                    kisa,
                    "PC'ye bağlı değil. Değişiklikler telefonda saklanıyor, bağlanınca gönderilir; " +
                        "hatırlatmalar PC'den bağımsız çalar.\n$sonEsitleme\n$bekleyenMetni$hataSatiri$reddedildiNotu",
                    if (yenidenEslestir) Ton.UYARI else Ton.CEVRIMDISI,
                    if (yenidenEslestir) Eylem.ESLESTIR else Eylem.YOK,
                )
            }
        }
    }
}

/**
 * Gönderilmemiş değişikliklerin ayrıntı satırı. "Bekleyen yok" ancak [kuyrukta] ve [ertelenenIslem] ikisi de
 * sıfırken söylenir (`BaglantiDurumu.ertelenen_islem`: gönderilmemişlerin toplamı ikisinindir).
 */
fun bekleyenMetni(kuyrukta: Int, ertelenenIslem: Int): String {
    if (kuyrukta <= 0 && ertelenenIslem <= 0) return "Gönderilmeyi bekleyen değişiklik yok."
    return listOfNotNull(
        "$kuyrukta değişiklik PC'ye gönderilmeyi bekliyor.".takeIf { kuyrukta > 0 },
        (
            "$ertelenenIslem değişiklik PC'deki servis güncellenince gidecek: servisin henüz tanımadığı alanlara " +
                "yapılanlar ve aynı kayıtta onların arkasında sırasını bekleyen silme ya da düzenlemeler."
            ).takeIf { ertelenenIslem > 0 },
    ).joinToString("\n")
}

/** Sürüm uyuşmazlığının kısa ve uzun metni (yön çekirdekten: karşı tarafın konuştuğu sürüm). */
fun surumMetni(s: SurumUyusmazligi): Pair<String, String> = when (s) {
    SurumUyusmazligi.SERVIS_ESKI ->
        "PC'yi güncelleyin" to "PC'deki ajanda servisi bu uygulamadan eski bir sürümde; bağlantı kurulamıyor. PC'deki eren'i güncelleyin."
    SurumUyusmazligi.UYGULAMA_ESKI ->
        "Uygulamayı güncelleyin" to "PC'deki ajanda servisi daha yeni bir sürümde; bu uygulama onunla konuşamıyor. Ajanda uygulamasını güncelleyin."
    SurumUyusmazligi.BILINMIYOR ->
        "Sürüm uyuşmuyor" to "Uygulama ile PC'deki ajanda servisi farklı sürümlerde; bağlantı kurulamıyor. Hangisi eskiyse onu güncelleyin."
}
/**
 * Hatırlatmaların çalmasını engelleyen sorunların gösterimi (saf). Engelleyen ilk sorun üstte şerit
 * olur; hepsi (bilgi düzeyindekiler dahil) dokununca açılan pencerede, her biri çözüm düğmesiyle.
 */
object HatirlatmaUyarilari {
    enum class Cozum {
        /** `requestPermissions(POST_NOTIFICATIONS)`; kalıcı reddedildiyse ayar ekranı. */
        IZIN_ISTE,

        /** `HatirlatmaDurumu.cozumNiyeti` ile ayar ekranı. */
        AYARI_AC,

        /** Kayıtlı sorun: gösterilir, "Anladım" ile `goruldu`. */
        GORULDU,
    }

    data class Uyari(val sorun: HatirlatmaSorunu, val baslik: String, val aciklama: String, val dugme: String, val cozum: Cozum, val engel: Boolean)

    fun uyarilar(d: HatirlatmaDurumu): List<Uyari> = d.sorunlar.map { s -> uyari(s, d, s in HatirlatmaDurumu.ENGELLER) }

    /** Şeritte gösterilecek tek uyarı: ilk engel (bilgi düzeyi şeride çıkmaz). */
    fun serit(d: HatirlatmaDurumu): Uyari? = uyarilar(d).firstOrNull { it.engel }

    /** Şeridin metni: ilk engel, birden çok engel varsa sayısı. */
    fun seritMetni(d: HatirlatmaDurumu): String? {
        val engeller = uyarilar(d).filter { it.engel }
        val ilk = engeller.firstOrNull() ?: return null
        return if (engeller.size > 1) "${ilk.baslik} (+${engeller.size - 1} sorun)" else ilk.baslik
    }

    private fun uyari(s: HatirlatmaSorunu, d: HatirlatmaDurumu, engel: Boolean): Uyari = when (s) {
        HatirlatmaSorunu.BILDIRIM_IZNI_YOK -> Uyari(
            s, "Bildirim izni yok", "Hatırlatmalar ekranda görünemez. Ajandanın bildirim göstermesine izin verin.",
            "İzin ver", Cozum.IZIN_ISTE, engel,
        )
        HatirlatmaSorunu.BILDIRIMLER_KAPALI -> Uyari(
            s, "Bildirimler kapalı", "Ajandanın bildirimleri ayarlardan kapatılmış; hiçbir hatırlatma görünmez.",
            "Bildirimleri aç", Cozum.AYARI_AC, engel,
        )
        HatirlatmaSorunu.HATIRLATMA_KANALI_KAPALI -> Uyari(
            s, "Hatırlatma bildirimleri kapalı", "\"Hatırlatmalar\" bildirim kategorisi kapalı.",
            "Aç", Cozum.AYARI_AC, engel,
        )
        HatirlatmaSorunu.KACIRILAN_KANALI_KAPALI -> Uyari(
            s, "Kaçırılan hatırlatma bildirimleri kapalı",
            "Telefon kapalıyken kaçan hatırlatmaların özeti gösterilemez.",
            "Aç", Cozum.AYARI_AC, engel,
        )
        HatirlatmaSorunu.KESIN_ALARM_IZNI_YOK -> Uyari(
            s, "Kesin alarm izni yok", "Hatırlatmalar dakikalarca, hatta saatlerce gecikebilir. \"Alarmlar ve hatırlatıcılar\" iznini verin.",
            "İzin ver", Cozum.AYARI_AC, engel,
        )
        HatirlatmaSorunu.ARKA_PLAN_KISITLI -> Uyari(
            s, "Arka plan kısıtlı", "Uygulamanın arka planda çalışması kısıtlanmış; hatırlatmalar çalmayabilir. Pil ayarında \"Kısıtlama yok\"u seçin.",
            "Ayarı aç", Cozum.AYARI_AC, engel,
        )
        HatirlatmaSorunu.PIL_OPTIMIZASYONU -> Uyari(
            s, "Pil optimizasyonu açık", "Bazı telefonlarda pil tasarrufu hatırlatmaları geciktirebilir. Gecikme görürseniz uygulamayı optimizasyondan çıkarın.",
            "Ayarı aç", Cozum.AYARI_AC, engel,
        )
        HatirlatmaSorunu.GOSTERILEMEYEN_HATIRLATMA -> Uyari(
            s, "Gösterilemeyen hatırlatma",
            "${d.kayitli.gosterilemeyenSayisi} hatırlatma çaldığı anda gösterilemedi (bildirimler kapalıydı). İlgili kayıtlara listeden bakın.",
            "Anladım", Cozum.GORULDU, engel,
        )
        HatirlatmaSorunu.KURULAMAYAN_ALARM -> Uyari(
            s, "Kurulamayan hatırlatma",
            "${d.kayitli.kurulamayanSayisi} hatırlatma telefona kurulamadı; uygulama her açılışta yeniden dener.",
            "Anladım", Cozum.GORULDU, engel,
        )
        HatirlatmaSorunu.CEKIRDEK_HATASI -> Uyari(
            s, "Hatırlatma işlenemedi",
            "Arka planda ${d.kayitli.cekirdekHatasiSayisi} kez hatırlatma işlenirken hata oldu.",
            "Anladım", Cozum.GORULDU, engel,
        )
    }
}
