package dev.eren.ajanda

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.widget.ScrollView
import android.widget.TextView

/** İskelet ekranı: yalnız köprü kanıtını gösterir. Sekmeler (tarihliler/tarihsizler) sonra gelecek. */
class AnaEkran : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val yazi = TextView(this).apply {
            textSize = 16f
            setPadding(48, 96, 48, 48)
            text = "Çekirdek yükleniyor…"
        }
        setContentView(ScrollView(this).apply { addView(yazi) })

        Thread {
            val sonuc = runCatching { KopruKaniti.calistir(CekirdekErisimi.al(this)) }
                .getOrElse { "HATA: $it" }
            Log.i(ETIKET, sonuc)
            runOnUiThread { yazi.text = sonuc }
        }.start()
    }

    companion object {
        const val ETIKET = "Ajanda"
    }
}
