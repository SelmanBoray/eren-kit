package dev.eren.ajanda

import android.app.Application
import dev.eren.ajanda.ag.BaglantiYoneticisi

/**
 * Uygulama nesnesi: yalnız ön plan bağlantısının kuralını kurar (`ag/GorunurlukSayaci.kt`): herhangi bir
 * ekran görünürken bağlantı açık, hiçbiri görünmezken kapalı. Alıcılar ve işler için de açılır; kayıt
 * yalnız bir geri çağrıdır, çekirdeği ya da ağı açmaz.
 */
class AjandaUygulamasi : Application() {
    override fun onCreate() {
        super.onCreate()
        BaglantiYoneticisi.izle(this)
    }
}
