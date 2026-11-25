package dev.eren.ajanda.ag

import android.app.job.JobScheduler
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.util.Log

/** Android'e bağlı ince uygulamalar (birim testi yok; mantık arayüzlerin arkasında sınanır). */

internal object LogGunluk : Gunluk {
    private const val ETIKET = "AjandaAg"

    override fun bilgi(mesaj: String) {
        Log.i(ETIKET, mesaj)
    }

    override fun uyari(mesaj: String, hata: Throwable?) {
        if (hata == null) Log.w(ETIKET, mesaj) else Log.w(ETIKET, "$mesaj (${hata.tur()})")
    }
}

/**
 * Varsayılan ağ (VPN açıksa Tailscale'in kendisi). `activeNetwork` uygulamaya engelli ağda (Veri
 * Tasarrufu, arka plan kısıtı) `null` döner; engel sonradan değişirse `onBlockedStatusChanged` (29+).
 */
internal class AndroidAgIzleyici(private val context: Context) : AgIzleyici {
    override fun baslat(dinleyici: (agVar: Boolean) -> Unit): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return true
        val ilk = cm.activeNetwork != null
        cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            private var varsayilan: Network? = null
            private var engelli = false

            override fun onAvailable(network: Network) {
                varsayilan = network
                engelli = false
                dinleyici(true)
            }

            override fun onLost(network: Network) {
                if (network != varsayilan) return
                varsayilan = null
                dinleyici(false)
            }

            override fun onBlockedStatusChanged(network: Network, blocked: Boolean) {
                if (network != varsayilan || blocked == engelli) return
                engelli = blocked
                dinleyici(!blocked)
            }
        })
        return ilk
    }
}

internal class JobIsPlanlayici(private val context: Context) : IsPlanlayici {
    private fun js(): JobScheduler? = context.getSystemService(JobScheduler::class.java)

    override fun periyodikKur() {
        val js = js() ?: return
        val mevcut = js.getPendingJob(EsitlemeIsi.PERIYODIK_IS)
        // Aynı iş varsa yeniden kurma: kurmak dönemi sıfırlar, her açılışta ertelerdi.
        if (mevcut != null && mevcut.intervalMillis == AgAyarlari.PERIYOT_MS && mevcut.isPersisted) return
        js.schedule(EsitlemeIsi.periyodikIs(context))
    }

    override fun periyodikIptal() {
        js()?.cancel(EsitlemeIsi.PERIYODIK_IS)
    }

    override fun kuyrukIsiKur() {
        js()?.schedule(EsitlemeIsi.kuyrukIsi(context))
    }
}
