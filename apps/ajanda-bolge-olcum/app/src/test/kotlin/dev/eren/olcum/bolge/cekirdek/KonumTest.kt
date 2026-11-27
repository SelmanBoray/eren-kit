package dev.eren.olcum.bolge.cekirdek

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class KonumTest {
    @Test
    fun haversine() {
        assertEquals(111_195.0, Mesafe.metre(0.0, 0.0, 1.0, 0.0), 5.0)
        val kuzey150 = 150.0 / 111_195.0
        assertEquals(150.0, Mesafe.metre(10.0, 20.0, 10.0 + kuzey150, 20.0), 0.5)
        assertEquals(0.0, Mesafe.metre(-5.5, 7.25, -5.5, 7.25), 1e-9)
    }

    @Test
    fun ozelDepoGidisDonus() {
        val l = listOf(
            Bolge(1, "Ad\tsekmeli", 1.25, -2.5, 150, "abcd", 10L),
            Bolge(4, "İkinci yer", -10.0, 100.125, 250, null, 20L),
        )
        val g = BolgeDeposu.oku(BolgeDeposu.yaz(l))
        assertEquals(2, g.size)
        assertEquals("Ad sekmeli", g[0].ad)
        assertEquals(l[1], g[1])
        assertEquals(1.25, g[0].enlem, 0.0)
        assertEquals("abcd", g[0].wifiOzet)
    }

    @Test
    fun konumAlmaIstatistigi() {
        val i = KonumAlmaIst()
        assertTrue(i.ekle("fused", 2_000, 60f, 100))
        assertFalse(i.ekle("ag", 2_500, 20f, 25_000)) // önbellekten eski konum sayılmaz
        assertTrue(i.ekle("gps", 4_000, 40f, 200))
        assertTrue(i.ekle("gps", 9_000, 15f, 200))
        assertEquals(2_000L, i.ilkMs)
        assertEquals(4_000L, i.ilk50Ms)
        assertEquals(9_000L, i.ilk20Ms)
        assertEquals(15f, i.enIyi)
        assertEquals("gps", i.enIyiKaynak)
        assertEquals(1, i.eski)
        val a = i.alanlar("kayit", true, 30_000)
        assertEquals("1", a["kapali"])
        assertEquals("15", a["enIyi"])
        assertEquals("4000", a["k_gps_ilk"])
        assertEquals("2", a["k_gps_n"])
        assertNull(a["k_ag_n"])
    }

    @Test
    fun wifiOzetiVeEslesme() {
        assertEquals("Ag", Kayitlar.ssidNormal("\"Ag\""))
        assertNull(Kayitlar.ssidNormal("<unknown ssid>"))
        assertNull(Kayitlar.wifiOzeti(null, "t"))
        val a = Kayitlar.wifiOzeti("\"OrnekAg\"", "t1")
        assertEquals(a, Kayitlar.wifiOzeti("OrnekAg", "t1"))
        assertNotEquals(a, Kayitlar.wifiOzeti("OrnekAg", "t2"))
        assertEquals(16, a!!.length)
        val b = listOf(Bolge(3, "x", 0.0, 0.0, 100, a, 0L))
        assertEquals("3", Kayitlar.wifiAlanlari("OrnekAg", "t1", b, false)["eslesen"])
        assertEquals("0", Kayitlar.wifiAlanlari("Baska", "t1", b, false)["eslesen"])
        assertEquals("alinamadi", Kayitlar.wifiAlanlari("<unknown ssid>", "t1", b, false)["kimlik"])
    }

    @Test
    fun istatistik() {
        assertEquals(3L, Istatistik.ortanca(listOf(5, 1, 3)))
        assertEquals(2L, Istatistik.ortanca(listOf(1, 2, 3, 4)))
        assertEquals(95L, Istatistik.yuzdelik((1L..100L).toList(), 95))
        val g = GecikmeIst.hesapla(listOf(30_000, 90_000, 4 * 60_000, 20 * 60_000))
        assertEquals(listOf(1, 1, 1, 0, 1), g.kovalar)
    }
}
