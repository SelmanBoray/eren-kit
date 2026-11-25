package dev.eren.olcum.ajanda.cekirdek

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GunlukBicimiTest {

    @Test
    fun yazVeAyristirGidisDonus() {
        val o = Olay(Tur.CAL, 1_700_000_000_123L, 98_765L, 42, linkedMapOf("seri" to "E", "slot" to "7", "idle" to "1"))
        val satir = GunlukBicimi.yaz(o)
        assertEquals("CAL\t1700000000123\t98765\t42\tseri=E\tslot=7\tidle=1", satir)
        assertEquals(o, GunlukBicimi.ayristir(satir))
    }

    @Test
    fun sekmeVeSatirSonuTemizlenirDegerdekiEsittirKorunur() {
        val o = Olay(Tur.CIKIS, 1L, 2L, -1, linkedMapOf("aciklama" to "a\tb\nc=d", "k=x" to "v"))
        val geri = GunlukBicimi.ayristir(GunlukBicimi.yaz(o))!!
        assertEquals("a b c=d", geri.metin("aciklama"))
        assertEquals("v", geri.metin("k_x"))
        assertEquals(-1, geri.boot)
    }

    @Test
    fun bozukVeYorumSatirlari() {
        assertNull(GunlukBicimi.ayristir("# yorum"))
        assertNull(GunlukBicimi.ayristir(""))
        assertNull(GunlukBicimi.ayristir("CAL\tx\t1\t1"))
        assertNull(GunlukBicimi.ayristir("CAL\t1\t1"))
        assertNull(GunlukBicimi.ayristir("CAL\t1\t1\t1\tanahtarsiz"))
        val metin = listOf(
            GunlukBicimi.BASLIK,
            "IS\t10\t5\t1\tid=1",
            "yarım satı",
            "",
            "IS\t20\t15\t1\tid=2\r",
        ).joinToString("\n")
        val s = GunlukBicimi.ayristirHepsi(metin)
        assertEquals(2, s.olaylar.size)
        assertEquals(1, s.hataliSatir)
        assertEquals("2", s.olaylar[1].metin("id"))
    }

    @Test
    fun bayrakVeSayi() {
        val o = Olay(Tur.CAL, 0, 0, 0, mapOf("a" to "1", "b" to "0", "c" to "x", "n" to "12"))
        assertEquals(true, o.bayrak("a"))
        assertEquals(false, o.bayrak("b"))
        assertNull(o.bayrak("c"))
        assertEquals(12L, o.sayi("n"))
        assertNull(o.sayi("c"))
    }
}
