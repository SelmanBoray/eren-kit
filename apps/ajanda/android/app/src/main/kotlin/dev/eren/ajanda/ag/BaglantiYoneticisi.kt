package dev.eren.ajanda.ag

import android.content.Context

/**
 * SAHİBİ: K2. Ne zaman bağlanılacağı: arayüz açıkken sürekli (kopunca artan bekleme ile yeniden),
 * arka planda `EsitlemeIsi` ile kısa oturum (eşitlen, kuyruğu boşalt, kapat). Adres
 * `cekirdek.baglantiAdresi()`; `null` ise bağlanma. Tek seferde tek soket. İSKELET.
 */
object BaglantiYoneticisi {
    /** Arayüz görünür oldu ya da eşleştirme başladı: bağlı kal. */
    fun basla(context: Context) {}

    /** Arayüz kapandı: bağlantıyı bırak (arka plan işi kendi oturumunu açar). */
    fun birak() {}
}
