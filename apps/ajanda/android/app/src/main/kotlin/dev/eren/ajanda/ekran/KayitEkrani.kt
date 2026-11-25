package dev.eren.ajanda.ekran

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

/**
 * SAHİBİ: K4. Elle ekleme ve düzenleme formu (`KayitGovdesi`): tür, başlık, açıklama, zaman
 * (an/gün/dönem/belirsiz; dilim varsayılanı `ZamanKabugu.cihazDilimi`), hatırlatmalar (açılışta
 * `varsayilanHatirlatmalar()`). Yazarken `metniTemizle`, kaydetmeden önce `govdeyiHazirla`;
 * metin düz gösterilir, bağlantıya çevrilmez. Ret listesinden "düzelt" de bu formu açar. İSKELET.
 */
class KayitEkrani : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply { text = "Kayıt formu: yazılmadı (K4)" })
    }
}
