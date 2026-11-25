package dev.eren.ajanda

import android.content.Context
import dev.eren.ajanda.alarm.AlarmPlanlayici
import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.kabuk.JavaZaman
import dev.eren.ajanda.kimlik.KeystoreKimlik
import java.io.File

/**
 * Süreç başına tek Rust çekirdeği. Etkinlik, alarm alıcısı, açılış alıcısı ve arka plan
 * işi aynı yoldan alır; arayüz açık olmak zorunda değildir (yalnız bir Context yeter).
 *
 * Çekirdek çağrıları eşzamanlıdır ve SQLite'a dokunur: ana iş parçacığından çağırma.
 * Geri çağrı uygulamaları (kimlik, zaman, alarm) burada bağlanır; her birinin sahibi MIMARI.md'de.
 * Bu dosya ilk dalgada dondurulur.
 */
object CekirdekErisimi {
    const val VERITABANI = "ajanda.sqlite3"

    @Volatile
    private var ornek: Cekirdek? = null

    fun al(context: Context): Cekirdek =
        ornek ?: synchronized(this) {
            ornek ?: ac(context.applicationContext).also { ornek = it }
        }

    private fun ac(uygulama: Context): Cekirdek =
        Cekirdek.ac(
            File(uygulama.filesDir, VERITABANI).absolutePath,
            KeystoreKimlik(uygulama),
            JavaZaman,
            AlarmPlanlayici(uygulama),
        )
}
