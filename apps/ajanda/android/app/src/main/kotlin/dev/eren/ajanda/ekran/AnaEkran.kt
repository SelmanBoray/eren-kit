package dev.eren.ajanda.ekran

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.widget.ScrollView
import android.widget.TextView
import dev.eren.ajanda.CekirdekErisimi
import dev.eren.ajanda.KopruKaniti

/**
 * SAHİBİ: K4 (ekranlar). İki ana sekme (tarihliler, tarihsizler: `cekirdek.liste`), taslak işareti ve
 * onayı, elle ekleme/düzenleme formu (`varsayilanHatirlatmalar`, `govdeyiHazirla`, `ekle`, `duzenle`),
 * tamamla/geri al (`durumDegistir`), sil/geri yükle, ret listesi (`retListesi`, `retAt`), bağlantı
 * durumu; `gozlemciEkle` ile yenilenir. İSKELET: yalnız köprü tanısını gösterir.
 */
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
            Log.i(KopruKaniti.ETIKET, sonuc)
            runOnUiThread { yazi.text = sonuc }
        }.start()
    }
}
