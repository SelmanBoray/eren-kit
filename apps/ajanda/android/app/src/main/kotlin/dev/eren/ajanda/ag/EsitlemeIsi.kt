package dev.eren.ajanda.ag

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import dev.eren.ajanda.aktarma.OtomatikYedek
import dev.eren.ajanda.alarm.AlarmYenidenKurma
import dev.eren.ajanda.cekirdek.YenidenKurmaNedeni
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.Executor
import java.util.concurrent.Executors

/**
 * Arka plan eşitlemesi (JobScheduler, ağ koşullu). İki iş aynı hizmette:
 * - [PERIYODIK_IS]: 15 dk'da bir (strateji `AgStratejisi.kt`); ön plan bağlantısı eşleşmeli
 *   adres görünce kurar, kalıcıdır (yeniden başlatmada sürer).
 * - [KUYRUK_ISI]: arayüz kapanırken kuyrukta işlem kaldıysa ağ gelince bir kez.
 * Her çalışma: bağlan -> `CANLI && kuyrukta == 0` (ya da süre/deneme sınırı) -> kapat ->
 * `AlarmYenidenKurma.simdi(PERIYODIK)` -> `jobFinished`. Yerel kipte (eşleşme olsa da) bağlanılmaz
 * (`ArkaPlanSonucu.YEREL_KIP`); alarmlar yine kurulur.
 * - [YEDEK_ISI] (D6): otomatik yedek açıkken tek seferlik, ağ koşulsuz, bir sonraki gerekli ana kurulu
 *   (`OtomatikYedekPlani.isGecikmesiMs`); yalnız `OtomatikYedek.arkaPlanda`, bitince `jobFinished` ve
 *   `OtomatikYedek.sonrakiniKur` (eşleşme, bağlantı ve eşitlemeden bağımsız). Kurup kaldıran `OtomatikYedek`.
 *   Eşitleme işlerinin her çalışması `OtomatikYedek.isiDenetle`'yi de çağırır (silinen yedek işi yeniden kurulur).
 * Eşitleme oturumu bitince sonuç [DuraklamaBildirimi]'ne gider (K5: yerel kipte eşleşme varken duran eşitleme
 * geçiş başına bir kez bildirilir; `CANLI` eşitlenince bildirim kalkar).
 */
class EsitlemeIsi : JobService() {

    private val calisanlar = ConcurrentHashMap<Int, ArkaPlanEsitleme>()
    private val yedekSuruyor = AtomicBoolean(false)

    override fun onStartJob(params: JobParameters): Boolean {
        val uygulama = applicationContext
        val id = params.jobId
        if (id == YEDEK_ISI) {
            yedekSuruyor.set(true)
            OtomatikYedek.arkaPlanda(uygulama) { sonuc ->
                LogGunluk.bilgi("yedek işi bitti: ${sonuc.javaClass.simpleName}")
                yedekSuruyor.set(false)
                jobFinished(params, false)
                // Bitmiş işin numarasıyla yeniden kur (çalışırken kurmak onu durdururdu).
                OtomatikYedek.sonrakiniKur(uygulama)
            }
            return true
        }
        val is_ = ArkaPlanEsitleme(
            oturumAc = { bitti -> BaglantiYoneticisi.arkaPlanOturumu(uygulama, bitti) },
            alarmlariKur = { AlarmYenidenKurma.simdi(uygulama, YenidenKurmaNedeni.PERIYODIK) },
            yurutucu = ISCI,
            bitir = { sonuc ->
                calisanlar.remove(id)
                LogGunluk.bilgi("eşitleme işi bitti: $sonuc")
                // ISCI iş parçacığında (çekirdek çağrısı burada olabilir); hatası işi düşürmez.
                DuraklamaBildirimi.uretim(uygulama).arkaPlanBitti(sonuc)
                jobFinished(params, false)
            },
            gunluk = LogGunluk,
            // T3: zorla durdurma ya da pil yöneticisi yedek işini sildiyse yeniden kurulur.
            yedekDenetle = { OtomatikYedek.isiDenetle(uygulama) },
        )
        calisanlar[id] = is_
        is_.baslat()
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        // Tek seferlik yedek işi bitmeden durdurulursa sistem yeniden kursun (yoksa iş kaybolur); deneme
        // arka planda sürer ve bitince `sonrakiniKur` bu kurulumu yenisiyle değiştirir.
        if (params.jobId == YEDEK_ISI) return yedekSuruyor.get()
        val is_ = calisanlar.remove(params.jobId) ?: return false
        return is_.durdur()
    }

    companion object {
        const val PERIYODIK_IS = 7301
        const val KUYRUK_ISI = 7302
        const val YEDEK_ISI = 7303

        /** Alarm yeniden kurulumu için (çekirdek çağrısı: ana iş parçacığı değil). */
        private val ISCI: Executor = Executors.newSingleThreadExecutor { r ->
            Thread(r, "ajanda-esitleme-isi").apply { isDaemon = true }
        }

        internal fun periyodikIs(context: Context): JobInfo =
            JobInfo.Builder(PERIYODIK_IS, ComponentName(context, EsitlemeIsi::class.java))
                .setPeriodic(AgAyarlari.PERIYOT_MS)
                .setPersisted(true)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .build()

        internal fun kuyrukIsi(context: Context): JobInfo =
            JobInfo.Builder(KUYRUK_ISI, ComponentName(context, EsitlemeIsi::class.java))
                .setPersisted(true)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .build()

        /**
         * Otomatik yedek (D6): tek seferlik, [gecikmeMs] sonra; ağ koşulu yok; kalıcı (yeniden başlatmada sürer).
         * Saatlik periyodik iş yerine: gün içinde boşuna uyanmaz, hatada artan beklemeyle yeniden kurulur.
         */
        internal fun yedekIsi(context: Context, gecikmeMs: Long): JobInfo =
            JobInfo.Builder(YEDEK_ISI, ComponentName(context, EsitlemeIsi::class.java))
                .setMinimumLatency(gecikmeMs.coerceAtLeast(0))
                .setPersisted(true)
                .build()
    }
}
