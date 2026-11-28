package dev.eren.ajanda.aktarma

import java.security.SecureRandom
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import java.util.Random

/**
 * SAHİBİ: D6. Seçilen klasöre otomatik yedeğin saf kuralları (Android'siz, JVM testli).
 *
 * - Varsayılan kapalı. Açıksa ve klasör seçilmişse günde bir yedek: son başarılı yedeğin cihaz günü
 *   bugün değilse zamanı gelmiştir. Başarısız denemeden sonra artan bekleme ([bekleme]: 30 dk, 1 sa, 2 sa,
 *   4 sa, en çok 6 sa). İş bir sonraki gerekli ana kurulur ([isGecikmesiMs]); saatte bir uyanmaz.
 * - **Sahiplik.** Otomatik yedek yalnız bu kurulumun yazdığı dosyalara dokunur. Ad kalıbı elle dışa aktarmanın
 *   önerdiği addan (`ajanda-yedegi-<gün>.zip`) ayrıdır ve kurulum kimliği taşır:
 *   `ajanda-otomatik-yedek-<gün>-<SSddss>-<kurulum>.zip` (kurulum: 8 küçük hex, kurulumda bir kez rastgele,
 *   yedeklenmeyen/aktarılmayan yerde saklanır). Kullanıcının elle aldığı yedeklere, başka telefonun (başka
 *   kurulumun) dosyalarına ve kalıba birebir uymayan hiçbir dosyaya dokunulmaz, üzerine yazılmaz. Yeniden
 *   kurulumdan önceki otomatik yedekler de artık "başkasınındır": silinmez.
 * - Her deneme yeni bir ad alır (aynı gün ikinci yedek ayrı dosyadır); sağlam eski dosya, yenisi yazılıp geri
 *   okunarak doğrulanmadan silinmez. Yazılırken geçici ad (`<ad>.yaziliyor`) taşır.
 * - Temizlik: bu kurulumun yedeklerinden gün başına en yenisi, en yeni [TUTULAN] gün kalır; az önce yazılan
 *   her zaman kalır (adıyla ve sağlayıcı kimliğiyle: liste önbellekten eski adı gösterse de); geleceğe tarihli
 *   olanlar (saat ileri gitmişti) en eski sayılır. Bu kurulumun artık geçici dosyaları (sağlayıcının eklediği
 *   ` (1)` gibi eklerle de) yalnız deneme başında silinir, yazmadan sonra değil (T4).
 */
object OtomatikYedekPlani {
    const val TUTULAN = 7

    /** Başarısız ilk denemeden sonra beklenen süre; ardışık her hatada iki katına çıkar. */
    const val YENIDEN_DENEME_MS = 30L * 60 * 1000

    /** Ardışık hatalarda en uzun bekleme. */
    const val AZAMI_BEKLEME_MS = 6L * 60 * 60 * 1000

    /** Geçici sorun ([YedekSorunu.kalici] yanlış) bu kadar sürerse bildirilir (yedek bir gündür alınamıyor). */
    const val GECICI_BILDIRIM_ESIGI_MS = 24L * 60 * 60 * 1000

    /** Tek seferlik iş en az bu kadar sonraya kurulur. */
    const val ASGARI_GECIKME_MS = 60_000L

    /** Tek seferlik iş en çok bu kadar sonraya kurulur (saat ya da dilim değişirse günde bir yeniden hesaplanır). */
    const val AZAMI_GECIKME_MS = 24L * 60 * 60 * 1000

    /**
     * Ayar dosyası yazılamadıysa (iç bellek dolu; `commit()` yanlış) iş en az bu kadar sonraya kurulur: sonuç
     * diske geçmediğinden soğuk başlayan süreç onu bilmez, her dakika yeniden denerdi (k2).
     */
    const val AYAR_YAZILAMADI_BEKLEMESI_MS = AZAMI_BEKLEME_MS

    const val GECICI_EK = ".yaziliyor"
    const val ONEK = "ajanda-otomatik-yedek-"

    private val KURULUM = Regex("[0-9a-f]{8}")
    private val AD = Regex("""ajanda-otomatik-yedek-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})-([0-9a-f]{8})\.zip""")
    private val AN_BICIMI = DateTimeFormatter.ofPattern("yyyy-MM-dd-HHmmss", Locale.ROOT)

    fun kurulumGecerli(k: String): Boolean = KURULUM.matches(k)

    /** Yeni kurulum kimliği (8 küçük hex). */
    fun yeniKurulum(rastgele: Random = SecureRandom()): String = "%08x".format(rastgele.nextInt())

    /** [ardisik] ardışık hatadan sonra yeni denemeye dek beklenen süre. */
    fun bekleme(ardisik: Int): Long {
        val n = (ardisik.coerceAtLeast(1) - 1).coerceAtMost(10)
        return (YENIDEN_DENEME_MS shl n).coerceAtMost(AZAMI_BEKLEME_MS)
    }

    fun zamaniGeldiMi(d: YedekDurumu, simdiMs: Long, dilim: ZoneId): Boolean {
        val an = sonrakiDenemeMs(d, simdiMs, dilim) ?: return false
        return an <= simdiMs
    }

    /**
     * Bir sonraki denemenin anı (zamanı geldiyse [simdiMs]); kapalıysa ya da klasör yoksa `null`. Bugün başarılı
     * yedek varsa yarının başı; son hata beklemesi sürüyorsa hata anı + [bekleme]. Saat geri alındıysa (hata
     * anı gelecekte) bekleme uygulanmaz.
     */
    fun sonrakiDenemeMs(d: YedekDurumu, simdiMs: Long, dilim: ZoneId): Long? {
        if (!d.acik || d.klasor == null) return null
        var an = simdiMs
        val son = d.sonBasariliMs
        if (son != null && gun(son, dilim) == gun(simdiMs, dilim)) {
            an = maxOf(an, gun(simdiMs, dilim).plusDays(1).atStartOfDay(dilim).toInstant().toEpochMilli())
        }
        val hata = d.sonHataMs
        if (hata != null && simdiMs >= hata) an = maxOf(an, hata + bekleme(d.ardisikHata))
        return an
    }

    /**
     * Tek seferlik işin gecikmesi ([ASGARI_GECIKME_MS]..[AZAMI_GECIKME_MS]); `null`: iş gerekmez. [ayarYazilamadi]:
     * son ayar yazımı diske geçmedi, en az [AYAR_YAZILAMADI_BEKLEMESI_MS] beklenir.
     */
    fun isGecikmesiMs(d: YedekDurumu, simdiMs: Long, dilim: ZoneId, ayarYazilamadi: Boolean = false): Long? =
        sonrakiDenemeMs(d, simdiMs, dilim)?.let {
            val g = (it - simdiMs).coerceIn(ASGARI_GECIKME_MS, AZAMI_GECIKME_MS)
            if (ayarYazilamadi) maxOf(g, AYAR_YAZILAMADI_BEKLEMESI_MS) else g
        }

    fun gun(ms: Long, dilim: ZoneId): LocalDate = Instant.ofEpochMilli(ms).atZone(dilim).toLocalDate()

    /** Son başarılı yedekten bu yana geçen cihaz günü (bugün 0; saat geri alındıysa 0); hiç yoksa `null`. */
    fun gunOnce(d: YedekDurumu, simdiMs: Long, dilim: ZoneId): Int? = d.sonBasariliMs?.let {
        ChronoUnit.DAYS.between(gun(it, dilim), gun(simdiMs, dilim)).coerceIn(0, Int.MAX_VALUE.toLong()).toInt()
    }

    /** Bu kurulumun [anMs] anındaki yedek adı. */
    fun dosyaAdi(anMs: Long, dilim: ZoneId, kurulum: String): String {
        require(kurulumGecerli(kurulum)) { "kurulum kimliği geçersiz" }
        return ONEK + AN_BICIMI.format(Instant.ofEpochMilli(anMs).atZone(dilim)) + "-" + kurulum + ".zip"
    }

    /** [mevcut]'ta olmayan ad: aynı saniyede yedek varsa saniye ilerletilir. */
    fun bosAd(anMs: Long, dilim: ZoneId, kurulum: String, mevcut: Set<String>): String {
        for (i in 0 until 120) {
            val ad = dosyaAdi(anMs + i * 1000L, dilim, kurulum)
            if (ad !in mevcut && geciciAd(ad) !in mevcut) return ad
        }
        throw IllegalStateException("boş yedek adı bulunamadı")
    }

    fun geciciAd(ad: String): String = ad + GECICI_EK

    /** Ad bu kurulumun kalıbına birebir uyan bir yedekse anı; değilse (başka dosya, başka kurulum) `null`. */
    fun yedekAni(ad: String, kurulum: String): LocalDateTime? {
        val m = AD.matchEntire(ad) ?: return null
        val (y, a, g, s, d, sn, k) = m.destructured
        if (k != kurulum) return null
        return runCatching { LocalDateTime.of(y.toInt(), a.toInt(), g.toInt(), s.toInt(), d.toInt(), sn.toInt()) }.getOrNull()
    }

    /**
     * Bu kurulumun artık geçici dosyası mı: önek, `-<kurulum>` ve `.yaziliyor` (sağlayıcı çakışmada
     * ` (1)` gibi ek koyabilir, yerini bilmiyoruz). Kurulum kimliği rastgele olduğundan başkasının dosyası uymaz.
     */
    fun geciciMi(ad: String, kurulum: String): Boolean =
        kurulumGecerli(kurulum) && ad.startsWith(ONEK) && ad.contains("-$kurulum") && ad.contains(GECICI_EK)

    /**
     * Silinecekler: bu kurulumun yedeklerinden gün başına en yenisi dışındakiler, en yeni [tut] gün dışındakiler
     * ve ([geciciDahil] ise) bu kurulumun bütün artık geçici dosyaları. [koru] (az önce yazılan) hep kalır ve
     * kendi gününü tutar. Sağlayıcı kimliği [koruKimlikler]'de olan dosya hiçbir adla silinmez: yeniden
     * adlandırmada kimliği koruyup listeyi önbellekten veren sağlayıcı (Drive benzeri) az önce doğrulanan yedeği
     * eski geçici adıyla gösterebilir (T4). Geleceğe tarihli yedekler ([bugun]'den sonra) en eski sayılır. Kalıba
     * birebir uymayana dokunulmaz.
     */
    fun silinecekler(
        dosyalar: List<KlasorDosyasi>,
        kurulum: String,
        bugun: LocalDate,
        koru: String? = null,
        tut: Int = TUTULAN,
        koruKimlikler: Set<String> = emptySet(),
        geciciDahil: Boolean = true,
    ): List<KlasorDosyasi> {
        val adaylar = dosyalar.filterNot { it.kimlik in koruKimlikler }
        val yedekler = adaylar.mapNotNull { d -> yedekAni(d.ad, kurulum)?.let { d to it } }
        val sirali = yedekler.sortedWith(
            compareBy<Pair<KlasorDosyasi, LocalDateTime>> { it.second.toLocalDate() > bugun }
                .thenByDescending { it.second }
                .thenByDescending { it.first.ad },
        )
        val gunler = HashSet<LocalDate>()
        // Az önce yazılan, listede (önbellek yüzünden) o adla görünmese de kendi gününü tutar.
        koru?.let { yedekAni(it, kurulum) }?.let { gunler += it.toLocalDate() }
        // Kimliğiyle korunan yedek de (hangi adla görünürse) kendi gününü tutar.
        for (d in dosyalar) if (d.kimlik in koruKimlikler) yedekAni(d.ad, kurulum)?.let { gunler += it.toLocalDate() }
        val fazla = mutableListOf<KlasorDosyasi>()
        for ((d, an) in sirali) {
            if (d.ad == koru) continue
            val g = an.toLocalDate()
            if (g in gunler || gunler.size >= tut.coerceAtLeast(1)) fazla += d else gunler += g
        }
        val geciciler = if (geciciDahil) adaylar.filter { geciciMi(it.ad, kurulum) && it.ad != koru } else emptyList()
        return geciciler + fazla
    }

    /**
     * Şimdi kullanıcıya söylenmesi gereken (bildirim ya da uygulama açılınca): henüz söylenmemiş son sorun
     * (kalıcıysa hemen, geçiciyse [GECICI_BILDIRIM_ESIGI_MS] sürdüyse), son yedeğin içe aktarma sınırını aştığı
     * ya da (sınırın altındaysa) bu telefonun açma belleğini aştığı. Söylendiyse ([YedekDurumu.bildirildi])
     * aynısı yeniden dönmez.
     */
    fun soylenecek(d: YedekDurumu, simdiMs: Long): YedekBildirimi? {
        if (!d.acik) return null
        val s = d.sonHata
        if (s != null) {
            if (d.bildirilenSorun == s) return null
            val basi = d.hataBasiMs ?: d.sonHataMs ?: simdiMs
            return if (s.kalici || simdiMs - basi >= GECICI_BILDIRIM_ESIGI_MS) YedekBildirimi.Sorun(s) else null
        }
        return when {
            d.sonSinirAsiyor -> if (!d.sinirBildirildi) YedekBildirimi.SinirAsiyor else null
            d.sonBellekAsiyor -> if (!d.bellekBildirildi) YedekBildirimi.BellekAsiyor else null
            else -> null
        }
    }
}

/** Kullanıcıya bir kez söylenecek yedek durumu. */
sealed class YedekBildirimi {
    data class Sorun(val sorun: YedekSorunu) : YedekBildirimi()

    /** Son yedek yazıldı ama bu sürümün içe aktarma sınırını aşıyor (`DisaAktarma.iceAktarmaSiniriniAsiyor`). */
    object SinirAsiyor : YedekBildirimi()

    /**
     * Son yedek sınırın altında ama bu telefonda açmak için gereken bellek, uygulamanın en iyi durumda
     * ayırabileceğini aşıyor (`YedekKabi.buTelefondaAcmaButcesi`).
     */
    object BellekAsiyor : YedekBildirimi()
}

/** Klasördeki bir dosya: görünen ad ve sağlayıcının kimliği (SAF'ta belge URI'si). */
data class KlasorDosyasi(val ad: String, val kimlik: String)

/**
 * Kalıcı ayar ve son sonuç. [klasor]: SAF ağaç URI'si. [sonHata] ve [sonHataMs] son denemenin hatası
 * (başarılı yedek ikisini temizler). [ardisikHata]: son başarıdan bu yana ardışık hata; [hataBasiMs] bu
 * dizinin ilk hatası. [bildirilenSorun]/[sinirBildirildi]: kullanıcıya söylenen (aynısı yinelenmez).
 * [sonSinirAsiyor], [sonBellekAsiyor], [sonRetDisarida]: son başarılı yedeğin uyarıları ([bellekBildirildi]: bellek
 * uyarısı söylendi). [yarimYazim]: yeniden adlandırmayı desteklemeyen sağlayıcıda son ada doğrudan yazılan
 * dosyanın adı (süreç ölürse sonraki deneme onu bütünse tutar, yarımsa siler; bozuk dosya yedek sayılmaz).
 * [sonKimlikler]: bu klasörde son doğrulanan yedeğin sağlayıcı kimlikleri (geçici ve son ad); sonraki denemenin
 * başındaki geçici temizliği onları silmez (önbellekli liste az önceki yedeği geçici adıyla gösterebilir; V3).
 * Başka klasör seçilince kalkar ([klasorle]).
 *
 * Geçişler saftır ([klasorle], [basariliOldu], [basarisizOldu], [bildirildi]); depo yalnız saklar.
 */
data class YedekDurumu(
    val acik: Boolean = false,
    val klasor: String? = null,
    val sonBasariliMs: Long? = null,
    val sonDosya: String? = null,
    val sonHata: YedekSorunu? = null,
    val sonHataMs: Long? = null,
    val ardisikHata: Int = 0,
    val hataBasiMs: Long? = null,
    val bildirilenSorun: YedekSorunu? = null,
    val sonSinirAsiyor: Boolean = false,
    val sinirBildirildi: Boolean = false,
    val sonRetDisarida: Int = 0,
    val yarimYazim: String? = null,
    val sonBellekAsiyor: Boolean = false,
    val bellekBildirildi: Boolean = false,
    val sonKimlikler: Set<String> = emptySet(),
) {
    /**
     * Klasör seçildi. Başka klasörse o klasörün geçmişi yoktur: son yedek, hata ve bildirim durumu sıfırlanır
     * (ilk yedek hemen alınır; ekran eski klasörün "son yedek"ini göstermez). Aynı klasör yeniden seçildiyse
     * (izin yeniden verildi) yalnız hata durumu temizlenir.
     */
    fun klasorle(yeni: String?): YedekDurumu =
        if (yeni == klasor) hataTemiz().copy(bildirilenSorun = null)
        else YedekDurumu(acik = acik, klasor = yeni)

    fun basariliOldu(an: Long, s: YedekSonucu.Yapildi): YedekDurumu = hataTemiz().copy(
        sonBasariliMs = an,
        sonDosya = s.dosya,
        bildirilenSorun = null,
        sonSinirAsiyor = s.sinirAsiyor,
        sinirBildirildi = s.sinirAsiyor && sinirBildirildi,
        sonBellekAsiyor = s.bellekAsiyor,
        bellekBildirildi = s.bellekAsiyor && bellekBildirildi,
        sonRetDisarida = s.retDisarida,
    )

    fun basarisizOldu(an: Long, sorun: YedekSorunu): YedekDurumu = copy(
        sonHata = sorun,
        sonHataMs = an,
        ardisikHata = ardisikHata + 1,
        hataBasiMs = hataBasiMs ?: an,
    )

    fun bildirildi(b: YedekBildirimi): YedekDurumu = when (b) {
        is YedekBildirimi.Sorun -> copy(bildirilenSorun = b.sorun)
        YedekBildirimi.SinirAsiyor -> copy(sinirBildirildi = true)
        YedekBildirimi.BellekAsiyor -> copy(bellekBildirildi = true)
    }

    private fun hataTemiz() = copy(sonHata = null, sonHataMs = null, ardisikHata = 0, hataBasiMs = null)
}

/**
 * Otomatik yedeğin hata türleri (kalıcı: adıyla saklanır). [kalici]: kendiliğinden geçmez (kullanıcı bir şey
 * yapmalı); ilk hatada bildirilir. Ötekiler [OtomatikYedekPlani.GECICI_BILDIRIM_ESIGI_MS] sürerse bildirilir.
 */
enum class YedekSorunu(val kalici: Boolean) {
    KLASOR_YOK(true),
    ERISIM_YOK(true),
    YER_YOK(true),
    YAZILAMADI(false),
    /** Yazılan dosya geri okunduğunda bozuk ya da eksik çıktı (silindi). */
    DOGRULANAMADI(false),
    COK_BUYUK(true),
    EK_BOZUK(true),
    BELLEK(false),
    CEKIRDEK(false),
    BEKLENMEYEN(false),
}

/** Bir deneme sonucu. */
sealed class YedekSonucu {
    /** Zamanı gelmemiş ya da kapalı. */
    object Gerekmedi : YedekSonucu()

    /**
     * [retDisarida]: yedeğe girmeyen (okunamayan ya da sınırı aşan) ret girdileri (`DisaAktarma.retListesinde`). [sinirAsiyor]: yedek
     * yazıldı ama bu sürümün içe aktarma sınırını aşıyor, bu sürümde geri yüklenemez. [bellekAsiyor]: sınırın
     * altında ama bu telefonda açmaya bellek yetmeyebilir (sınır aşılıyorsa hep yanlış). [eskiSurumAcamaz]: belge
     * biçim 2 ya da üstü (`DisaAktarma.bicimSurumu`), uygulamanın eski sürümleri bu dosyayı bütünüyle reddeder.
     */
    data class Yapildi(
        val dosya: String,
        val kayit: Long,
        val silinen: Int,
        val retDisarida: Int = 0,
        val sinirAsiyor: Boolean = false,
        val bellekAsiyor: Boolean = false,
        val eskiSurumAcamaz: Boolean = false,
    ) : YedekSonucu()

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

    /** `YedekGorunumu.sonYedekGunOnce` için: "Son başarılı yedek bugün / dün / N gün önce alındı." */
    fun gunOnce(gun: Int?): String = when {
        gun == null -> "Henüz başarılı yedek yok."
        gun <= 0 -> "Son başarılı yedek bugün alındı."
        gun == 1 -> "Son başarılı yedek dün alındı."
        else -> "Son başarılı yedek $gun gün önce alındı."
    }

    /** Son başarılı yedeğin uyarıları (ekranda son yedeğin altında; yoksa boş). */
    fun uyarilar(d: YedekDurumu): List<String> = buildList {
        if (d.sonBasariliMs == null) return@buildList
        if (d.sonRetDisarida > 0) add(retDisarida(d.sonRetDisarida))
        if (d.sonSinirAsiyor) add(sinirMetni) else if (d.sonBellekAsiyor) add(AktarmaMetinleri.BELLEK_YETMEYEBILIR)
    }

    /** Bildirimin başlığı ve metni. [gunOnce]: `OtomatikYedekPlani.gunOnce`. */
    fun bildirim(b: YedekBildirimi, gunOnce: Int?): Pair<String, String> = when (b) {
        is YedekBildirimi.Sorun -> "Otomatik yedek alınamıyor" to "${sorun(b.sorun)} ${gunOnce(gunOnce)}"
        YedekBildirimi.SinirAsiyor -> "Yedek geri yüklenemeyecek kadar büyük" to sinirMetni
        YedekBildirimi.BellekAsiyor -> "Yedek bu telefonda açılamayabilir" to AktarmaMetinleri.BELLEK_YETMEYEBILIR
    }

    private fun retDisarida(n: Int) = AktarmaMetinleri.retListesinde(n)

    private val sinirMetni = AktarmaMetinleri.SINIR_ASIYOR

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
        YedekSorunu.DOGRULANAMADI -> "Yazılan yedek dosyası geri okunduğunda bozuk çıktı ve silindi. Yeniden deneyin ya da başka bir klasör seçin."
        YedekSorunu.COK_BUYUK -> "Yedek çok büyük; yazılamadı."
        YedekSorunu.EK_BOZUK -> "Ek dosyalarından biri bozuk ya da eksik; yedek yazılamadı."
        YedekSorunu.BELLEK -> "Telefonun belleği yedeği hazırlamaya yetmedi."
        YedekSorunu.CEKIRDEK -> "Telefondaki kayıt deposu kullanılamadı. Yeniden deneyin."
        YedekSorunu.BEKLENMEYEN -> "Beklenmeyen bir sorun oldu. Yeniden deneyin."
    }

    fun sonuc(s: YedekSonucu): String = when (s) {
        YedekSonucu.Gerekmedi -> "Bugünün yedeği zaten alınmış."
        is YedekSonucu.Yapildi -> buildList {
            add("${s.kayit} kayıt yedeğe yazıldı: ${s.dosya}")
            if (s.retDisarida > 0) add(retDisarida(s.retDisarida))
            if (s.sinirAsiyor) add(sinirMetni) else if (s.bellekAsiyor) add(AktarmaMetinleri.BELLEK_YETMEYEBILIR)
            if (s.eskiSurumAcamaz) add(AktarmaMetinleri.ESKI_SURUM_ACAMAZ)
        }.joinToString("\n")
        is YedekSonucu.Basarisiz -> sorun(s.sorun)
    }
}
