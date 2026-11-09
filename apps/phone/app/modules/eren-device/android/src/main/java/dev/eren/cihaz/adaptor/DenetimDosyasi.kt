package dev.eren.cihaz.adaptor

import android.content.Context
import dev.eren.cihaz.cekirdek.DenetimBicimIslemi
import dev.eren.cihaz.cekirdek.DenetimBicimi
import dev.eren.cihaz.cekirdek.DenetimPortu
import dev.eren.cihaz.cekirdek.DenetimSatiri
import java.io.File

/**
 * Denetim günlüğü: uygulamaya özel dizinde sona-ekli dosya, boyut aşılınca bir yedeğe döner.
 * Yazma hatası yutulur. Jeton ve ekran metni bu dosyaya hiç gelmez (satır tipi izin vermez).
 */
class DenetimDosyasi(context: Context) : DenetimPortu, DenetimKapisi {
    private val dizin = File(context.applicationContext.filesDir, "denetim").apply { mkdirs() }
    private val gunluk = File(dizin, "denetim.log")
    private val yedek = File(dizin, "denetim.log.1")
    private val kimlikDosyasi = File(dizin, "izinler.txt")
    private val kilit = Any()

    override val bicim: DenetimBicimIslemi = DenetimBicimi

    override fun ekle(satir: DenetimSatiri) {
        try {
            val metin = DenetimBicimi.yaz(satir) + "\n"
            synchronized(kilit) {
                if (gunluk.length() >= SINIR_BAYT) {
                    yedek.delete()
                    gunluk.renameTo(yedek)
                }
                gunluk.appendText(metin, Charsets.UTF_8)
            }
        } catch (_: Exception) {
            // Denetim yazılamadı: satır düşer.
        }
    }

    override fun izinKimlikleri(): List<String> {
        return try {
            synchronized(kilit) {
                if (!kimlikDosyasi.exists()) return emptyList()
                kimlikDosyasi.readLines(Charsets.UTF_8).map { it.trim() }.filter(::kimlikGecerli)
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    override fun izinKimlikleriniYaz(kimlikler: List<String>) {
        try {
            synchronized(kilit) {
                val gecici = File(dizin, "izinler.txt.tmp")
                gecici.writeText(
                    kimlikler.filter(::kimlikGecerli).joinToString("") { it + "\n" },
                    Charsets.UTF_8,
                )
                if (!gecici.renameTo(kimlikDosyasi)) {
                    kimlikDosyasi.delete()
                    gecici.renameTo(kimlikDosyasi)
                }
            }
        } catch (_: Exception) {
            // Yazılamadı: sonraki açılışta eski liste kalır, jeton zaten diskte değil.
        }
    }

    override fun satirlar(sonN: Int, grantId: String?): List<DenetimSatiri> {
        if (sonN <= 0) return emptyList()
        return try {
            val ham = synchronized(kilit) {
                (if (yedek.exists()) yedek.readLines(Charsets.UTF_8) else emptyList()) +
                    (if (gunluk.exists()) gunluk.readLines(Charsets.UTF_8) else emptyList())
            }
            ham.mapNotNull { DenetimBicimi.coz(it) }
                .filter { grantId == null || it.grantId == grantId }
                .takeLast(sonN)
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun kimlikGecerli(s: String): Boolean =
        s.isNotEmpty() && s.length <= 64 &&
            s.all { (it in 'A'..'Z') || (it in 'a'..'z') || (it in '0'..'9') || it in "._:-" }

    private companion object {
        const val SINIR_BAYT = 512L * 1024
    }
}
