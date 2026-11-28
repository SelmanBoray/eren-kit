package dev.eren.ajanda.ekran.sahne.cizim

import org.junit.Assert.assertEquals
import org.junit.Test

/** Canlı parça pozları (SAHNE.md §5.15): prototipteki anahtar kareler. Düz JVM testi. */
class CizimHareketiTest {
    private val poz = Poz()
    private fun parca(c: Canlanma?, sira: Int = 0, alfa: Float = 1f) = Parca("M0 0h10v10z", Rol.F, alfa, null, c, sira, null)

    @Test
    fun duraganParcaHicKimildamaz() {
        CizimHareketi.hesapla(parca(null), 1234, 700f, 0.5f, poz)
        assertEquals(0f, poz.dx, 0f); assertEquals(0f, poz.dy, 0f); assertEquals(1f, poz.olcek, 0f); assertEquals(1f, poz.alfa, 0f)
    }

    @Test
    fun kopukYarimDongudeYediBirimYukarida() {
        CizimHareketi.hesapla(parca(Canlanma.KOPUK), 0, 0f, 0f, poz)
        assertEquals(0f, poz.dy, 1e-4f)
        CizimHareketi.hesapla(parca(Canlanma.KOPUK), 1600, 0f, 0f, poz)
        assertEquals(-7f, poz.dy, 1e-4f)
        CizimHareketi.hesapla(parca(Canlanma.KOPUK), 3200, 0f, 0f, poz)
        assertEquals(0f, poz.dy, 1e-4f)
    }

    /** İkinci köpük −0.8 s kaydırmalı: t = 800'de birincinin 1600'deki yerinde. */
    @Test
    fun kopuklerKaydirmali() {
        CizimHareketi.hesapla(parca(Canlanma.KOPUK, sira = 1), 800, 0f, 0f, poz)
        assertEquals(-7f, poz.dy, 1e-4f)
    }

    @Test
    fun buharYukselipSolar() {
        CizimHareketi.hesapla(parca(Canlanma.BUHAR), 1400, 0f, 0f, poz)
        assertEquals(-6f, poz.dy, 1e-4f)
        assertEquals(0.5f, poz.alfa, 1e-4f)
    }

    @Test
    fun piriltiKuculupDoner() {
        CizimHareketi.hesapla(parca(Canlanma.PIRILTI), 1300, 0f, 0f, poz)
        assertEquals(0.6f, poz.olcek, 1e-4f)
        assertEquals(20f, poz.aci, 1e-4f)
    }

    @Test
    fun imzaBeklerCizilirBiter() {
        assertEquals(0f, CizimHareketi.imzaOrani(0f), 0f)
        assertEquals(0f, CizimHareketi.imzaOrani(500f), 0f)
        assertEquals(1f, CizimHareketi.imzaOrani(2000f), 1e-4f)
        val orta = CizimHareketi.imzaOrani(1250f)
        assert(orta > 0.2f && orta < 0.9f) { "orta: $orta" }
    }

    @Test
    fun kalemAnahtarKarelerinden() {
        CizimHareketi.hesapla(parca(Canlanma.KALEM), 0, 0f, 0f, poz)
        assertEquals(-60f, poz.dx, 1e-4f); assertEquals(9f, poz.dy, 1e-4f)
        CizimHareketi.hesapla(parca(Canlanma.KALEM), 0, 500f + 0.35f * 1500f, 0f, poz)
        assertEquals(-38f, poz.dx, 1e-3f); assertEquals(-4f, poz.dy, 1e-3f)
        CizimHareketi.hesapla(parca(Canlanma.KALEM), 0, CizimHareketi.TEK_SEFER_SURE_MS.toFloat(), 0f, poz)
        assertEquals(0f, poz.dx, 1e-4f); assertEquals(0f, poz.dy, 1e-4f)
    }

    @Test
    fun patlamaBuyuyupKaybolur() {
        val p = parca(Canlanma.KOPUK, alfa = 0.92f)
        CizimHareketi.hesapla(p, 0, 0f, 0.4f, poz)
        assertEquals(1.9f, poz.olcek, 1e-3f)
        assertEquals(0.9f, p.alfa * poz.alfa, 1e-3f)
        CizimHareketi.hesapla(p, 0, 0f, 1f, poz)
        assertEquals(2.6f, poz.olcek, 1e-3f)
        assertEquals(0f, p.alfa * poz.alfa, 1e-4f)
    }
}
