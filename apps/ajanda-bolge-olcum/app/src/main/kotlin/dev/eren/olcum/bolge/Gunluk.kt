package dev.eren.olcum.bolge

import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import dev.eren.olcum.bolge.cekirdek.GunlukBicimi
import dev.eren.olcum.bolge.cekirdek.Olay
import java.io.File
import java.io.FileOutputStream

/**
 * Yalnız eklenen, satır başına bir olay tutan günlük (uygulamanın özel alanında).
 * Logcat'e hiçbir şey yazılmaz. Alanlar GunlukBicimi içinde gizlilik süzgecinden geçer.
 */
object Gunluk {
    private const val DOSYA = "gunluk.tsv"
    private val kilit = Any()

    fun dosya(ctx: Context) = File(ctx.filesDir, DOSYA)

    fun bootSayisi(ctx: Context): Int =
        try {
            Settings.Global.getInt(ctx.contentResolver, Settings.Global.BOOT_COUNT, -1)
        } catch (_: Exception) {
            -1
        }

    fun yaz(
        ctx: Context,
        tur: String,
        alan: Map<String, String> = emptyMap(),
        duvar: Long = System.currentTimeMillis(),
        gecen: Long = SystemClock.elapsedRealtime(),
    ): Olay {
        val o = Olay(tur, duvar, gecen, bootSayisi(ctx), alan)
        synchronized(kilit) {
            val f = dosya(ctx)
            val yeni = !f.exists()
            FileOutputStream(f, true).use { out ->
                if (yeni) out.write((GunlukBicimi.BASLIK + "\n").toByteArray(Charsets.UTF_8))
                out.write((GunlukBicimi.yaz(o) + "\n").toByteArray(Charsets.UTF_8))
                out.flush()
                // Ani kapanmada son satırlar kaybolmasın.
                try { out.fd.sync() } catch (_: Exception) {}
            }
        }
        return o
    }

    fun oku(ctx: Context): String = synchronized(kilit) {
        val f = dosya(ctx)
        if (f.exists()) f.readText(Charsets.UTF_8) else ""
    }

    fun sil(ctx: Context) = synchronized(kilit) { dosya(ctx).delete() }
}
