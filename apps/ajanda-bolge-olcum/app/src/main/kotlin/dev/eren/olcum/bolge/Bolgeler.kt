package dev.eren.olcum.bolge

import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import dev.eren.olcum.bolge.cekirdek.Bolge
import dev.eren.olcum.bolge.cekirdek.BolgeDeposu
import java.io.File

/**
 * Bölgelerin özel deposu: filesDir/bolgeler.tsv. Koordinatların ve adların durduğu TEK yer.
 * Yedekleme kapalı (allowBackup=false + veri çıkarma kuralları), dışa verilmez.
 */
object Bolgeler {
    private const val DOSYA = "bolgeler.tsv"
    private val kilit = Any()

    private fun dosya(ctx: Context) = File(ctx.filesDir, DOSYA)

    fun hepsi(ctx: Context): List<Bolge> = synchronized(kilit) {
        val f = dosya(ctx)
        if (f.exists()) BolgeDeposu.oku(f.readText(Charsets.UTF_8)) else emptyList()
    }

    fun bul(ctx: Context, id: Int): Bolge? = hepsi(ctx).firstOrNull { it.id == id }

    private fun kaydet(ctx: Context, l: List<Bolge>) = synchronized(kilit) {
        val f = dosya(ctx)
        val g = File(ctx.filesDir, "$DOSYA.yeni")
        g.writeText(BolgeDeposu.yaz(l), Charsets.UTF_8)
        if (!g.renameTo(f)) {
            f.writeText(BolgeDeposu.yaz(l), Charsets.UTF_8)
            g.delete()
        }
    }

    fun ekle(ctx: Context, ad: String, enlem: Double, boylam: Double, yaricap: Int, wifiOzet: String?): Bolge {
        val b = Bolge(Durum.yeniBolgeId(ctx), ad.trim(), enlem, boylam, yaricap, wifiOzet, System.currentTimeMillis())
        synchronized(kilit) { kaydet(ctx, hepsi(ctx) + b) }
        return b
    }

    fun sil(ctx: Context, id: Int) = synchronized(kilit) { kaydet(ctx, hepsi(ctx).filter { it.id != id }) }

    fun wifiAyarla(ctx: Context, id: Int, ozet: String?): Bolge? = synchronized(kilit) {
        val l = hepsi(ctx).map { if (it.id == id) it.copy(wifiOzet = ozet) else it }
        kaydet(ctx, l)
        l.firstOrNull { it.id == id }
    }

    /** Uygulama simgesine uzun basınca "Vardım: <ad>" kısayolları (yalnız bu cihazda görünür). */
    fun kisayollariGuncelle(ctx: Context) {
        try {
            val sm = ctx.getSystemService(ShortcutManager::class.java) ?: return
            val en = minOf(4, sm.maxShortcutCountPerActivity)
            val l = hepsi(ctx).take(en).map { b ->
                ShortcutInfo.Builder(ctx, "vardim_${b.id}")
                    .setShortLabel("Vardım: ${b.ad}".take(25))
                    .setLongLabel("${b.ad}: şimdi vardım")
                    .setIcon(Icon.createWithResource(ctx, android.R.drawable.ic_menu_mylocation))
                    .setIntent(
                        Intent(ctx, AnaEkran::class.java)
                            .setAction(AnaEkran.EYLEM_VARDIM)
                            .putExtra("bolge", b.id),
                    )
                    .build()
            }
            sm.dynamicShortcuts = l
        } catch (_: Exception) {
            // Kısayol yalnız kolaylık; olmazsa ölçüm etkilenmez.
        }
    }
}
