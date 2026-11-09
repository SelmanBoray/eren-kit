package dev.eren.cihaz.adaptor

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import dev.eren.cihaz.cekirdek.GrantNedeni

/**
 * Kalıcı bildirimdeki "Durdur": önce tam yetkiyi kapatır, sonra bütün izinleri `kullanici_durdurdu` ile geri çeker, sonra servisi durdurur.
 */
class DurdurAlici : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Bildirimler.ISLEM_DURDUR) return
        val uygulama = context.applicationContext
        // Her şeyden önce: bayrak kapanınca OtoIzinKapisi ilk adımda reddeder; gecikme penceresinde
        // gelen otomatik izin servisi yeniden açamaz. İstisna akışı durdurmamalı.
        try {
            TamYetki.kapat(uygulama)
        } catch (_: Throwable) {
        }
        val guncelle = Adaptor.oturumGuncelle
        if (guncelle != null) {
            // grant_revoked çerçevesi WS ipliğinde gider; servis hemen düşerse yarım kalmasın.
            guncelle.izinGeriCek(null, GrantNedeni.KULLANICI_DURDURDU)
            // Erişilebilirlik servisi 10 sn beklemeden hemen kapansın.
            ErisimAnahtari.kapat(uygulama)
            val bekleyen = goAsync()
            Handler(Looper.getMainLooper()).postDelayed({
                CihazServisi.durdur(uygulama)
                bekleyen.finish()
            }, GECIKME_MS)
        } else {
            // Bağlantı yok (eşleşme yok ya da kopuk): izinleri doğrudan çekirdekten çek.
            try {
                Adaptor.cekirdek?.izinler?.geriCek(null, GrantNedeni.KULLANICI_DURDURDU)
            } finally {
                ErisimAnahtari.kapat(uygulama)
                CihazServisi.durdur(uygulama)
            }
        }
    }

    private companion object {
        const val GECIKME_MS = 1_500L
    }
}
