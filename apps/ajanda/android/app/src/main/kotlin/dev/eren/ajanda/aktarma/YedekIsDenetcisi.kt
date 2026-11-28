package dev.eren.ajanda.aktarma

import java.time.ZoneId

/**
 * SAHİBİ: D6. Otomatik yedek işinin kurulma kuralı (saf; JobScheduler [YedekIsPlanlayici] arkasında).
 *
 * İş tek seferliktir ve kendini bitince yeniden kurar ([sonrakiniKur]). Zorla durdurma ya da üreticinin pil
 * yöneticisi kurulu işi siler; o zaman kendini yeniden kuracak bir çalışma da olmaz. Bu yüzden [denetle]
 * yaşam çizgisinin birkaç yerinden çağrılır (T3): uygulama açılışı (`BaglantiYoneticisi.izle`, ilk görünür ekran),
 * periyodik eşitleme işi (`EsitlemeIsi`, `ArkaPlanEsitleme`) ve açılış/güncelleme alıcısı (`AcilisAlici`). Ayar
 * ekranına bağlı değildir.
 *
 * - [denetle]: açıksa ve kurulu tek seferlik kalıcı iş yoksa kurar (varsa zamanlamasına dokunmaz); eski sürümün
 *   periyodik işi tek seferliğe çevrilir. Kapalıysa bir şey yapmaz (kalan işi iş kendisi kaldırır).
 * - [yenidenKur]: ayar değişti (klasör, aç/kapat, şimdi yedekle): açıksa bir sonraki gerekli ana yeniden kurar,
 *   değilse kaldırır.
 * - [sonrakiniKur]: iş bitti (`jobFinished`'den sonra): [yenidenKur] gibi, ama çalışma işaretine bakmaz.
 *
 * Çalışan iş aynı numarayla yeniden kurulursa sistem onu durdurur: [calisiyor] doğruyken [denetle] ve
 * [yenidenKur] dokunmaz (iş bitince [sonrakiniKur] güncel ayarla kurar). [ayarYazilamadi]: son ayar yazımı diske
 * geçmedi (k2), gecikme en az `AYAR_YAZILAMADI_BEKLEMESI_MS`.
 */
class YedekIsDenetcisi(
    private val ayarlar: YedekAyarDeposu,
    private val planlayici: YedekIsPlanlayici,
    private val saat: () -> Long,
    private val dilim: () -> ZoneId,
    private val calisiyor: () -> Boolean = { false },
    private val ayarYazilamadi: () -> Boolean = { false },
) {
    fun denetle() {
        if (calisiyor()) return
        if (!ayarlar.oku().acik) return
        val mevcut = planlayici.kurulu()
        if (mevcut != null && !mevcut.periyodik && mevcut.kalici) return
        kur()
    }

    fun yenidenKur() {
        if (calisiyor()) return
        if (ayarlar.oku().acik) kur() else planlayici.kaldir()
    }

    fun sonrakiniKur() {
        if (ayarlar.oku().acik) kur() else planlayici.kaldir()
    }

    fun kaldir() = planlayici.kaldir()

    private fun kur() {
        val gecikme = OtomatikYedekPlani.isGecikmesiMs(ayarlar.oku(), saat(), dilim(), ayarYazilamadi())
        if (gecikme == null) planlayici.kaldir() else planlayici.kur(gecikme)
    }
}

/** Kurulu yedek işinin özü (üretimde `JobInfo`'dan). */
data class KuruluYedekIsi(val periyodik: Boolean, val kalici: Boolean)

/** Yedek işinin kurulduğu yer (üretimde `JobScheduler`, `EsitlemeIsi.YEDEK_ISI`; testte bellekte). */
interface YedekIsPlanlayici {
    /** Kurulu (bekleyen ya da çalışan) yedek işi; yoksa `null`. */
    fun kurulu(): KuruluYedekIsi?

    /** Tek seferlik, kalıcı işi [gecikmeMs] sonraya kurar (kurulu olanın yerine geçer). */
    fun kur(gecikmeMs: Long)

    fun kaldir()
}
