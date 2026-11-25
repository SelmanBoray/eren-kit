package dev.eren.ajanda.ag

import android.app.job.JobParameters
import android.app.job.JobService

/**
 * SAHİBİ: K2. Periyodik arka plan eşitlemesi (JobScheduler, ağ koşullu): bağlan, `baglantiDurumu`
 * `CANLI` ve kuyruk boş olunca kapat, `jobFinished`. Ayrıca `alarmlariYenidenKur(PERIYODIK)`.
 * Kurulumu (schedule) K2 yapar. İSKELET: hiçbir şey yapmaz.
 */
class EsitlemeIsi : JobService() {
    override fun onStartJob(params: JobParameters?): Boolean = false

    override fun onStopJob(params: JobParameters?): Boolean = false
}
