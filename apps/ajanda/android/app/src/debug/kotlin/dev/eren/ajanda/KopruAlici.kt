package dev.eren.ajanda

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * YALNIZ DEBUG: arayüz hiç açılmadan çekirdeğin bir alıcıdan çağrılabildiğini gösterir
 * (alarm/açılış alıcıları da aynı yolu kullanır):
 *   adb shell am broadcast -f 0x20 -n dev.eren.ajanda/.KopruAlici
 */
class KopruAlici : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val bekleyen = goAsync()
        Thread {
            try {
                val sonuc = runCatching { KopruKaniti.calistir(CekirdekErisimi.al(context)) }
                    .getOrElse { "HATA: $it" }
                Log.i(KopruKaniti.ETIKET, "[alıcı] $sonuc")
            } finally {
                bekleyen.finish()
            }
        }.start()
    }
}
