package dev.eren.ajanda

import android.content.Context
import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.kabuk.AndroidKabuk
import java.io.File

/**
 * Süreç başına tek Rust çekirdeği. Etkinlik, alarm alıcısı, açılış alıcısı ve arka plan
 * işi aynı yoldan alır; arayüz açık olmak zorunda değildir (yalnız bir Context yeter).
 *
 * Çekirdek çağrıları eşzamanlıdır ve SQLite'a dokunur: ana iş parçacığından çağırma.
 */
object CekirdekErisimi {
    const val VERITABANI = "ajanda.sqlite3"

    @Volatile
    private var ornek: Cekirdek? = null

    fun al(context: Context): Cekirdek =
        ornek ?: synchronized(this) {
            ornek ?: ac(File(context.applicationContext.filesDir, VERITABANI)).also { ornek = it }
        }

    private fun ac(dosya: File): Cekirdek = Cekirdek.ac(dosya.absolutePath, AndroidKabuk())
}
