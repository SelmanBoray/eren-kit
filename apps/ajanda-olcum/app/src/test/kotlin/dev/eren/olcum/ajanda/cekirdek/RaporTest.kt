package dev.eren.olcum.ajanda.cekirdek

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset

class RaporTest {

    @Test
    fun sureBicimi() {
        assertEquals("-", Rapor.sure(null))
        assertEquals("850 ms", Rapor.sure(850))
        assertEquals("12,3 sn", Rapor.sure(12_345))
        assertEquals("3 dk 5 sn", Rapor.sure(185_000))
        assertEquals("2 sa 1 dk", Rapor.sure(7_260_000))
        assertEquals("-1,5 sn", Rapor.sure(-1_500))
    }

    @Test
    fun disaAktarimYenidenAyristirilir() {
        val olaylar = listOf(
            Olay(Tur.IS, 10, 5, 1, mapOf("id" to "1")),
            Olay(Tur.CAL, 20, 6, 1, mapOf("seri" to "E", "slot" to "0")),
        )
        val ham = GunlukBicimi.BASLIK + "\n" + olaylar.joinToString("\n") { GunlukBicimi.yaz(it) }
        val disa = Rapor.disaAktarim("özet satırı 1\nözet\tsatırı 2", ham, 123L)
        assertTrue(disa.startsWith("# ajanda-olcum"))
        val geri = GunlukBicimi.ayristirHepsi(disa)
        assertEquals(olaylar, geri.olaylar)
        assertEquals(0, geri.hataliSatir)
    }

    @Test
    fun metinTemelBolumleriIcerir() {
        val B = 1_700_000_040_000L
        val plan = Plan(B, B + Plan.SAAT, listOf(SeriPlani(Plan.KESIN, 15 * Plan.DK, 0)))
        val ev = listOf(
            Olay(Tur.BASLA, B - 1, 0, 1, plan.alanlar()),
            Olay(Tur.KUR, B - 1, 0, 1, mapOf("seri" to "E", "ilk" to "0", "son" to "4")),
            Olay(Tur.CAL, B + 2_000, 0, 1, mapOf("seri" to "E", "slot" to "0", "idle" to "1")),
            Olay(Tur.OLGU, B, 0, 1, mapOf("sdk" to "34", "uretici" to "Ornek")),
        )
        val m = Rapor.metin(Analiz.analiz(ev, B + 2 * Plan.SAAT), ZoneOffset.UTC)
        assertTrue(m, m.contains("Kesin alarm"))
        assertTrue(m, m.contains("planlanan 5  çalan 1  kaçan 4"))
        assertTrue(m, m.contains("durum: doze"))
        assertTrue(m, m.contains("sdk: 34"))
        assertTrue(m, m.contains("%80,0"))
    }
}
