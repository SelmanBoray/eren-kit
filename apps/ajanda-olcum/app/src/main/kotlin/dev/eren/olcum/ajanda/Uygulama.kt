package dev.eren.olcum.ajanda

import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.SystemClock
import dev.eren.olcum.ajanda.cekirdek.Tur

class Uygulama : Application() {
    companion object {
        /** Sürecin başladığı an (elapsedRealtime). */
        @Volatile
        var surecBaslangic: Long = 0L
    }

    override fun onCreate() {
        surecBaslangic = SystemClock.elapsedRealtime()
        super.onCreate()
        if (Durum.calisiyor(this)) {
            Gunluk.yaz(this, Tur.ACILIS)
            Olcum.cikislariYaz(this)
        }
        // Kapanış yayını manifestten her cihazda gelmeyebilir; süreç yaşarken de dinlenir.
        val f = IntentFilter(Intent.ACTION_SHUTDOWN)
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(SistemAlici(), f, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(SistemAlici(), f)
        }
    }
}
