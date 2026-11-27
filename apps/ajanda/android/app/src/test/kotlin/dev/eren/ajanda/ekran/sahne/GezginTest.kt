package dev.eren.ajanda.ekran.sahne

import androidx.compose.animation.core.SnapSpec
import androidx.compose.animation.core.SpringSpec
import dev.eren.ajanda.ekran.sahne.gezinme.Gezgin
import dev.eren.ajanda.ekran.sahne.gezinme.Hedef
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Gezinme yığını ve hareket belirteçleri: düz JVM, Android ya da çekirdek gerekmez. */
class GezginTest {
    private fun gezgin(vararg h: Hedef) = Gezgin.saklayici().let { s ->
        // Saklayıcının geri yükleme yolu, kurucuyla aynı onarımı yapar.
        with(s) { restore(h.map { it.anahtar })!! }
    }

    @Test
    fun hedefAnahtarlariGidipGelir() {
        val hepsi = listOf(
            Hedef.Sekme.BUGUN, Hedef.Sekme.TAKVIM, Hedef.Sekme.TARIHSIZ,
            Hedef.Ayrinti("a:b:c"), Hedef.Duzenle(null), Hedef.Duzenle("k1"), Hedef.Ayarlar,
        )
        for (h in hepsi) assertEquals(h, Hedef.coz(h.anahtar))
        assertNull(Hedef.coz("bilinmeyen"))
        assertNull(Hedef.coz("ayrinti:"))
    }

    @Test
    fun katmanAcilirVeGeriKapanir() {
        val g = gezgin(Hedef.Sekme.BUGUN)
        g.ac(Hedef.Ayrinti("k1"))
        g.ac(Hedef.Duzenle("k1"))
        assertEquals(3, g.derinlik)
        assertEquals(Hedef.Ayrinti("k1"), g.alttaki())
        assertTrue(g.geri())
        assertEquals(Hedef.Ayrinti("k1"), g.ust)
        assertTrue(g.geri())
        assertEquals(Hedef.Sekme.BUGUN, g.ust)
        assertFalse("Bugün'de geri etkinliği kapatır", g.geri())
    }

    @Test
    fun ayniKatmanIkiKezAcilmaz() {
        val g = gezgin(Hedef.Sekme.BUGUN)
        g.ac(Hedef.Ayarlar)
        g.ac(Hedef.Ayarlar)
        assertEquals(2, g.derinlik)
    }

    @Test
    fun sekmeDegisimiYiginiIndirirVeGeriBugunuDoner() {
        val g = gezgin(Hedef.Sekme.BUGUN)
        g.ac(Hedef.Ayrinti("k1"))
        g.sekmeSec(Hedef.Sekme.TARIHSIZ)
        assertEquals(1, g.derinlik)
        assertEquals(Hedef.Sekme.TARIHSIZ, g.sekme)
        assertTrue(g.geriGidilebilir())
        assertTrue(g.geri())
        assertEquals(Hedef.Sekme.BUGUN, g.ust)
        assertFalse(g.geriGidilebilir())
    }

    @Test
    fun geriYonuYigindanAnlasilir() {
        val g = gezgin(Hedef.Sekme.BUGUN)
        val a = Hedef.Ayrinti("k1")
        assertFalse("açılış ileri", run { g.ac(a); g.geriMi(Hedef.Sekme.BUGUN, a) })
        assertTrue("parmakla geri çekerken (yığın değişmeden) geri", g.geriMi(a, Hedef.Sekme.BUGUN))
        g.geri()
        assertTrue("kapanmış katmandan dönüş geri", g.geriMi(a, Hedef.Sekme.BUGUN))
    }

    @Test
    fun bozukSaklananYiginOnarilir() {
        val g = Gezgin.saklayici().let { with(it) { restore(listOf("ayrinti:k1", "takvim", "olmayan")) }!! }
        // Kök sekme değilse Bugün eklenir; kök dışındaki sekmeler ve çözülemeyenler atılır.
        assertEquals(listOf("bugun", "ayrinti:k1"), g.anahtarlar())
    }

    @Test
    fun kapananKatmanlarinDurumuSilinir() {
        val g = gezgin(Hedef.Sekme.BUGUN)
        g.ac(Hedef.Ayrinti("k1"))
        assertEquals(emptyList<String>(), g.kapananlar())
        g.geri()
        assertEquals(listOf("ayrinti:k1"), g.kapananlar())
        assertEquals(emptyList<String>(), g.kapananlar())
    }

    @Test
    fun azaltilmisHareketYerDegistirmezAnindaBiter() {
        val az = SahneHareket.Azaltilmis
        assertTrue(az.yay<Float>() is SnapSpec)
        assertTrue(az.oturma<Float>() is SnapSpec)
        assertTrue(az.acilis<Float>() is SnapSpec)
        assertFalse(az.uzamsal)
        assertFalse(az.surekli)
        assertEquals(0, az.kademe(3))
        val tam = SahneHareket.Tam
        val yay = tam.yay<Float>() as SpringSpec
        // SAHNE.md §4: YAY = sönüm 0.65, sertlik 200; oturan = 0.8 / 220.
        assertEquals(0.65f, yay.dampingRatio)
        assertEquals(200f, yay.stiffness)
        assertEquals(220f, (tam.oturma<Float>() as SpringSpec).stiffness)
        assertEquals(140 + 2 * 90, tam.kademe(2, ilkMs = 140))
    }

    @Test
    fun koyuTemadaYalnizLevhaZeminiDegisir() {
        for (r in LevhaRengi.entries) {
            val a = r.takim(koyu = false)
            val k = r.takim(koyu = true)
            assertEquals(a.copy(zemin = k.zemin), k)
        }
    }

}
