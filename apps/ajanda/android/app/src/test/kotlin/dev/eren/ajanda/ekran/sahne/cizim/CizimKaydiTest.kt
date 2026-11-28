package dev.eren.ajanda.ekran.sahne.cizim

import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** Çizim kaydının sözleşmesi: 29 anahtar, biçim, bilinmeyen anahtar, varsayılan renk. Düz JVM testi. */
class CizimKaydiTest {

    @Test
    fun anahtarlarSozlesmeyleBirebirAyni() {
        assertEquals(SOZLESME, CIZIM_ANAHTARLARI)
        assertEquals(29, TUM_CIZIMLER.size)
    }

    @Test
    fun anahtarBicimiGecerli() {
        val bicim = Regex("^[a-z][a-z0-9_]{0,31}$")
        for (a in CIZIM_ANAHTARLARI) assertTrue("biçim dışı anahtar: $a", bicim.matches(a))
    }

    /** Bir çizim dosyası başka anahtarın adını kopyalarsa kayıt bozulur; her anahtar bir kez geçmeli. */
    @Test
    fun herAnahtarTekCizim() {
        assertEquals(CIZIM_ANAHTARLARI.size, CIZIM_ANAHTARLARI.toSet().size)
        for (a in CIZIM_ANAHTARLARI) assertEquals(a, cizimBul(a).anahtar)
    }

    @Test
    fun bilinmeyenAnahtarGenelCizer() {
        val genel = cizimBul(GENEL_ANAHTAR)
        for (a in listOf("uzay_gemisi", "", "  ", null, "Araba!", "x".repeat(40))) {
            assertSame("anahtar: $a", genel, cizimBul(a))
        }
        assertEquals(GENEL_ANAHTAR, cizimAnahtari("bilinmeyen"))
        assertEquals(LevhaRengi.KUM, varsayilanLevhaRengi("bilinmeyen"))
    }

    @Test
    fun anahtarKucukHarfeVeBosluksuzaIndirilir() {
        assertEquals("araba", cizimBul(" ARABA ").anahtar)
        assertEquals("dogum_gunu", cizimAnahtari("Dogum_Gunu"))
    }

    @Test
    fun tasinanOnCizimVeVarsayilanRenkleri() {
        val beklenen = mapOf(
            "genel" to LevhaRengi.KUM,
            "araba" to LevhaRengi.KOBALT,
            "dis" to LevhaRengi.PEMBE,
            "market" to LevhaRengi.HARDAL,
            "is" to LevhaRengi.CAM,
            "kargo" to LevhaRengi.DOMATES,
            "ilac" to LevhaRengi.GOK,
            "kahve" to LevhaRengi.HARDAL,
            "fatura" to LevhaRengi.GECE,
            "kamp" to LevhaRengi.GECE,
        )
        for ((a, renk) in beklenen) {
            assertEquals(a, renk, varsayilanLevhaRengi(a))
            assertFalse("$a yer tutucu olmamalı", cizimBul(a).yerTutucu)
        }
    }

    /** Yer tutucular `genel`in parçalarını çizer; çizimi yapılanlar kendi parçalarını taşır. */
    @Test
    fun yerTutucuGenelinParcalariniCizer() {
        val genel = cizimBul(GENEL_ANAHTAR).parcalar
        for (c in TUM_CIZIMLER) {
            if (c.yerTutucu) assertSame(c.anahtar, genel, c.parcalar)
            else if (c.anahtar != GENEL_ANAHTAR) assertTrue("${c.anahtar} genelin kopyası", c.parcalar !== genel)
        }
    }

    @Test
    fun daireVeKutuYollari() {
        assertEquals("M41 52a9 9 0 1 0 18 0a9 9 0 1 0 -18 0z", daire(50f, 52f, 9f))
        assertEquals("M10 20h30v5h-30z", kutu(10f, 20f, 30f, 5f))
        assertTrue(kutu(20f, 137f, 200f, 5f, 2.5f).startsWith("M22.5 137h195a2.5 2.5 0 0 1 2.5 2.5"))
    }

    companion object {
        val SOZLESME = listOf(
            "genel", "araba", "banka", "dis", "dogum_gunu", "doktor", "ev", "fatura", "ilac", "is", "kahve",
            "kargo", "kitap", "market", "okul", "sac", "seyahat", "spor", "telefon", "temizlik", "toplanti",
            "yemek", "kamp", "evcil", "bitki", "tamir", "camasir", "eglence", "mektup",
        )
    }
}
