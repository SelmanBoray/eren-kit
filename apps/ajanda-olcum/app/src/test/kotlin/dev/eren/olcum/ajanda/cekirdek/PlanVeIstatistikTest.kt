package dev.eren.olcum.ajanda.cekirdek

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlanVeIstatistikTest {
    private val B = 1_700_000_040_000L
    private val DK = Plan.DK
    private val e = SeriPlani("E", 15 * DK, 0)
    private val c = SeriPlani("C", 180 * DK, 7 * DK + 30_000)
    private val plan = Plan(B, B + 6 * Plan.SAAT, listOf(e, c))

    @Test
    fun slotZamanlari() {
        assertEquals(B, plan.zaman(e, 0))
        assertEquals(B + 45 * DK, plan.zaman(e, 3))
        assertEquals(B + 187 * DK + 30_000, plan.zaman(c, 1))
        assertEquals(24, plan.sonSlot(e))      // 6 sa / 15 dk
        assertEquals(1, plan.sonSlot(c))       // 7,5 dk ve 187,5 dk
    }

    @Test
    fun ilkSonrakiVeSonOnceki() {
        assertEquals(0, plan.ilkSonraki(e, B - 1))
        assertEquals(1, plan.ilkSonraki(e, B))          // tam slot anı "sonraki" değildir
        assertEquals(2, plan.ilkSonraki(e, B + 16 * DK))
        assertEquals(-1, plan.sonOnceki(e, B - 1))
        assertEquals(0, plan.sonOnceki(e, B))
        assertEquals(1, plan.sonOnceki(e, B + 29 * DK))
        assertEquals(1..2, plan.slotlar(e, B, B + 30 * DK))
        assertTrue(plan.slotlar(e, B + 100 * Plan.SAAT, B + 200 * Plan.SAAT).isEmpty())
    }

    @Test
    fun alanlarGidisDonus() {
        val o = Olay(Tur.BASLA, 0, 0, 1, plan.alanlar())
        assertEquals(plan, Plan.ayristir(o))
        assertNull(Plan.ayristir(Olay(Tur.BASLA, 0, 0, 1, mapOf("bas" to "1"))))
    }

    @Test
    fun varsayilanPlanTamDakikadaBaslar() {
        val p = Plan.varsayilan(B + 12_345)
        assertEquals(0L, p.bas % DK)
        assertTrue(p.bas >= B + 2 * DK)
        assertEquals(Plan.SURE, p.son - p.bas)
        // 72 saatte 289 kesin + 24 çalar slotu; telefonda aynı anda en çok 24 saatlik pencere kurulur.
        assertEquals(288, p.sonSlot(p.seri(Plan.KESIN)!!))
        assertEquals(23, p.sonSlot(p.seri(Plan.CALAR)!!))
    }

    @Test
    fun ortancaVeYuzdelik() {
        assertNull(Istatistik.ortanca(emptyList()))
        assertEquals(3L, Istatistik.ortanca(listOf(5, 1, 3)))
        assertEquals(2L, Istatistik.ortanca(listOf(1, 4, 3, 1)))  // (1+3)/2
        assertEquals(-2L, Istatistik.ortanca(listOf(-1, -2)))     // taban bölme
        val d = (1L..100L).toList()
        assertEquals(95L, Istatistik.yuzdelik(d, 95))
        assertEquals(1L, Istatistik.yuzdelik(d, 0))
        assertEquals(100L, Istatistik.yuzdelik(d, 100))
        assertEquals(7L, Istatistik.yuzdelik(listOf(7), 95))
    }

    @Test
    fun gecikmeKovalari() {
        val g = GecikmeIst.hesapla(listOf(-500, 0, 10_000, 10_001, 60_000, 300_001, 900_000, 900_001))
        assertEquals(listOf(3, 2, 0, 2, 1), g.kovalar)
        assertEquals(900_001L, g.enKotu)
        assertEquals(8, g.n)
    }
}
