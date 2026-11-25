package dev.eren.ajanda.kimlik

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

/**
 * SAHİBİ: K1. Eşleştirme: PC'nin gösterdiği QR/JSON metnini al (yapıştırma ya da tarama),
 * `eslestirmeQrCoz` ile doğrula, `cekirdek.eslestirmeBaslat(qr)`, sonra bağlantıyı başlat
 * (`ag.BaglantiYoneticisi`) ve `eslesmeDurumu`'nu göster. İSKELET.
 */
class EslestirmeEkrani : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply { text = "Eşleştirme: yazılmadı (K1)" })
    }
}
