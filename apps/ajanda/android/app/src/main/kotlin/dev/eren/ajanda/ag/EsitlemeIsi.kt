package dev.eren.ajanda.ag

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import dev.eren.ajanda.alarm.AlarmYenidenKurma
import dev.eren.ajanda.cekirdek.YenidenKurmaNedeni
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor
import java.util.concurrent.Executors

/**
 * Arka plan eşitlemesi (JobScheduler, ağ koşullu). İki iş aynı hizmette:
 * - [PERIYODIK_IS]: 15 dk'da bir (strateji `AgStratejisi.kt`); ön plan bağlantısı eşleşmeli
 *   adres görünce kurar, kalıcıdır (yeniden başlatmada sürer).
 * - [KUYRUK_ISI]: arayüz kapanırken kuyrukta işlem kaldıysa ağ gelince bir kez.
 * Her çalışma: bağlan -> `CANLI && kuyrukta == 0` (ya da süre/deneme sınırı) -> kapat ->
 * `AlarmYenidenKurma.simdi(PERIYODIK)` -> `jobFinished`.
 */
class EsitlemeIsi : JobService() {

    private val calisanlar = ConcurrentHashMap<Int, ArkaPlanEsitleme>()

    override fun onStartJob(params: JobParameters): Boolean {
        val uygulama = applicationContext
        val id = params.jobId
        val is_ = ArkaPlanEsitleme(
            oturumAc = { bitti -> BaglantiYoneticisi.arkaPlanOturumu(uygulama, bitti) },
            alarmlariKur = { AlarmYenidenKurma.simdi(uygulama, YenidenKurmaNedeni.PERIYODIK) },
            yurutucu = ISCI,
            bitir = { sonuc ->
                calisanlar.remove(id)
                LogGunluk.bilgi("eşitleme işi bitti: $sonuc")
                jobFinished(params, false)
            },
            gunluk = LogGunluk,
        )
        calisanlar[id] = is_
        is_.baslat()
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        val is_ = calisanlar.remove(params.jobId) ?: return false
        return is_.durdur()
    }

    companion object {
        const val PERIYODIK_IS = 7301
        const val KUYRUK_ISI = 7302

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
    }
}
