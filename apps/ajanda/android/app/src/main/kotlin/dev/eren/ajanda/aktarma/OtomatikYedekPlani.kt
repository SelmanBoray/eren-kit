package dev.eren.ajanda.aktarma

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * SAHİBİ: D6. Seçilen klasöre otomatik yedeğin saf kuralları (Android'siz, JVM testli).
 *
 * - Varsayılan kapalı. Açıksa ve klasör seçilmişse günde bir yedek: son başarılı yedeğin cihaz günü
 *   bugün değilse zamanı gelmiştir. Başarısız denemeden sonra [YENIDEN_DENEME_MS] beklenir.
 * - Dosya adı D3'ün önerdiği addır (`ajanda-yedegi-2026-11-28.zip`); yazılırken geçici ad
 *   (`...zip.yaziliyor`) taşır, bitince yeniden adlandırılır.
 * - Temizlik yalnız bu kalıba birebir uyan dosyalara dokunur: en yeni [TUTULAN] tarihli yedek kalır,
 *   artık geçici dosyalar silinir. Kullanıcının başka dosyası (ör. `ajanda-yedegi-2026-11-28 (1).zip`)
 *   hiç sayılmaz.
 */
object OtomatikYedekPlani {
    const val TUTULAN = 7

    /** Başarısız denemeden sonra yeni deneme için beklenen süre (periyodik iş daha sık uyanabilir). */
    const val YENIDEN_DENEME_MS = 30L * 60 * 1000

    const val GECICI_EK = ".yaziliyor"

    private val AD = Regex("""ajanda-yedegi-(\d{4})-(\d{2})-(\d{2})\.zip""")

    fun zamaniGeldiMi(d: YedekDurumu, simdiMs: Long, dilim: ZoneId): Boolean {
        if (!d.acik || d.klasor == null) return false
        val son = d.sonBasariliMs
        if (son != null && gun(son, dilim) == gun(simdiMs, dilim)) return false
        val hata = d.sonHataMs
        // Saat geri alındıysa (hata anı gelecekte) bekleme uygulanmaz.
        if (hata != null && simdiMs >= hata && simdiMs - hata < YENIDEN_DENEME_MS) return false
        return true
    }

    fun gun(ms: Long, dilim: ZoneId): LocalDate = Instant.ofEpochMilli(ms).atZone(dilim).toLocalDate()

    fun dosyaAdi(gun: LocalDate): String = AktarmaAkisi.onerilenAd(gun)

    fun geciciAd(gun: LocalDate): String = dosyaAdi(gun) + GECICI_EK

    /** Ad bu kalıba uyan bir yedekse günü; değilse (başka dosya, geçersiz tarih) `null`. */
    fun yedekGunu(ad: String): LocalDate? {
        val m = AD.matchEntire(ad) ?: return null
        val (y, a, g) = m.destructured
        return runCatching { LocalDate.of(y.toInt(), a.toInt(), g.toInt()) }.getOrNull()
    }

    fun geciciMi(ad: String): Boolean = ad.endsWith(GECICI_EK) && yedekGunu(ad.removeSuffix(GECICI_EK)) != null

    /**
     * Silinecekler: kalıba uyan yedeklerden en yeni [tut] tanesi dışındakiler (güne göre; aynı gün
     * birden çok varsa ada göre) ve bütün artık geçici dosyalar. Kalıba uymayana dokunulmaz.
     */
    fun silinecekler(dosyalar: List<KlasorDosyasi>, tut: Int = TUTULAN): List<KlasorDosyasi> {
        val yedekler = dosyalar.mapNotNull { d -> yedekGunu(d.ad)?.let { d to it } }
            .sortedWith(compareByDescending<Pair<KlasorDosyasi, LocalDate>> { it.second }.thenByDescending { it.first.ad })
        val fazla = yedekler.drop(tut.coerceAtLeast(0)).map { it.first }
        return dosyalar.filter { geciciMi(it.ad) } + fazla
    }
}

/** Klasördeki bir dosya: görünen ad ve sağlayıcının kimliği (SAF'ta belge URI'si). */
data class KlasorDosyasi(val ad: String, val kimlik: String)

/**
 * Kalıcı ayar ve son sonuç. [klasor]: SAF ağaç URI'si. [sonHata] ve [sonHataMs] son denemenin hatası
 * (başarılı yedek ikisini temizler).
 */
data class YedekDurumu(
    val acik: Boolean = false,
    val klasor: String? = null,
    val sonBasariliMs: Long? = null,
    val sonDosya: String? = null,
    val sonHata: YedekSorunu? = null,
    val sonHataMs: Long? = null,
)

/** Otomatik yedeğin hata türleri (kalıcı: adıyla saklanır). */
enum class YedekSorunu { KLASOR_YOK, ERISIM_YOK, YER_YOK, YAZILAMADI, COK_BUYUK, EK_BOZUK, BELLEK, CEKIRDEK, BEKLENMEYEN }

/** Bir deneme sonucu. */
sealed class YedekSonucu {
    /** Zamanı gelmemiş ya da kapalı. */
    object Gerekmedi : YedekSonucu()

    data class Yapildi(val dosya: String, val kayit: Long, val silinen: Int) : YedekSonucu()

    data class Basarisiz(val sorun: YedekSorunu) : YedekSonucu()
}

/** Ayarlar ekranının ve hata bildiriminin metinleri (saf; içerik taşımaz, yalnız tarih ve ad). */
class OtomatikYedekMetinleri(private val dilim: ZoneId) {
    val baslik = "Otomatik yedek"
    val aciklama = "Açıkken günde bir yedek seçtiğiniz klasöre yazılır; en yeni ${OtomatikYedekPlani.TUTULAN} yedek tutulur."
    val klasorSecilmedi = "Klasör seçilmedi"

    private val tarihBicimi = DateTimeFormatter.ofPattern("d MMMM yyyy HH:mm", Locale.forLanguageTag("tr"))

    fun tarih(ms: Long): String = tarihBicimi.format(Instant.ofEpochMilli(ms).atZone(dilim))

    fun sonYedek(d: YedekDurumu): String =
        d.sonBasariliMs?.let { "Son yedek: ${tarih(it)}" } ?: "Henüz yedek alınmadı"

    /** Son denemenin hatası; yoksa `null`. */
    fun sonHata(d: YedekDurumu): String? {
        val s = d.sonHata ?: return null
        val an = d.sonHataMs?.let { " (${tarih(it)})" } ?: ""
        return "Son deneme başarısız$an: ${sorun(s)}"
    }

    fun sorun(s: YedekSorunu): String = when (s) {
        YedekSorunu.KLASOR_YOK -> "Yedek klasörü seçilmedi. Bir klasör seçin."
        YedekSorunu.ERISIM_YOK -> "Yedek klasörüne erişilemiyor (izin geri alınmış ya da klasör silinmiş olabilir). Klasörü yeniden seçin."
        YedekSorunu.YER_YOK -> "Yedek klasöründe yer kalmadı. Yer açın ya da başka bir klasör seçin."
        YedekSorunu.YAZILAMADI -> "Yedek dosyası yazılamadı. Yeniden deneyin ya da başka bir klasör seçin."
        YedekSorunu.COK_BUYUK -> "Yedek çok büyük; yazılamadı."
        YedekSorunu.EK_BOZUK -> "Ek dosyalarından biri bozuk ya da eksik; yedek yazılamadı."
        YedekSorunu.BELLEK -> "Telefonun belleği yedeği hazırlamaya yetmedi."
        YedekSorunu.CEKIRDEK -> "Telefondaki kayıt deposu kullanılamadı. Yeniden deneyin."
        YedekSorunu.BEKLENMEYEN -> "Beklenmeyen bir sorun oldu. Yeniden deneyin."
    }

    fun sonuc(s: YedekSonucu): String = when (s) {
        YedekSonucu.Gerekmedi -> "Bugünün yedeği zaten alınmış."
        is YedekSonucu.Yapildi -> "${s.kayit} kayıt yedeğe yazıldı: ${s.dosya}"
        is YedekSonucu.Basarisiz -> sorun(s.sorun)
    }
}
