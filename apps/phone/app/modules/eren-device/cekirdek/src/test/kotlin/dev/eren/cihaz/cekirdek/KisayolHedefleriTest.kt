package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class KisayolHedefleriTest {
    private val biz = "dev.eren.app/dev.eren.cihaz.adaptor.KisayolErisimServisi"
    private val talkBack = "com.google.android.marvin.talkback/.TalkBackService"
    private val buyutme = "com.android.server.accessibility.MagnificationController"

    @Test
    fun bosListeyeYalnizBizEklenir() {
        for (bos in listOf(null, "", "  ", ":")) {
            val e = KisayolHedefleri.ekle(bos, biz)
            assertEquals(biz, e.yeniDeger)
            assertTrue(e.digerHedefler.isEmpty())
            assertTrue(e.degisti)
        }
    }

    @Test
    fun oncekiHedefSilinmezSonaEklenir() {
        val e = KisayolHedefleri.ekle(talkBack, biz)
        assertEquals("$talkBack:$biz", e.yeniDeger)
        assertEquals(listOf(talkBack), e.digerHedefler)
        assertTrue(e.degisti)
    }

    @Test
    fun birdenCokOncekiHedefSirasiylaKorunur() {
        val e = KisayolHedefleri.ekle("$talkBack:$buyutme", biz)
        assertEquals("$talkBack:$buyutme:$biz", e.yeniDeger)
        assertEquals(listOf(talkBack, buyutme), e.digerHedefler)
    }

    @Test
    fun zatenVarsaDegismezVeIkiKezEklenmez() {
        val e = KisayolHedefleri.ekle("$talkBack:$biz", biz)
        assertFalse(e.degisti)
        assertEquals("$talkBack:$biz", e.yeniDeger)
        assertEquals(listOf(talkBack), e.digerHedefler)
    }

    @Test
    fun kisaBicimAyniBilesenSayilir() {
        val kisa = "dev.eren.app/.KisayolErisimServisi"
        val uzun = "dev.eren.app/dev.eren.app.KisayolErisimServisi"
        assertFalse(KisayolHedefleri.ekle(kisa, uzun).degisti)
        assertTrue(KisayolHedefleri.iceriyor(kisa, uzun))
        assertTrue(KisayolHedefleri.iceriyor(" $talkBack : $uzun ", uzun))
    }

    @Test
    fun baskaPaketinAyniSinifAdiBizSayilmaz() {
        val sahte = "com.kotu/dev.eren.cihaz.adaptor.KisayolErisimServisi"
        assertFalse(KisayolHedefleri.iceriyor(sahte, biz))
        val e = KisayolHedefleri.ekle(sahte, biz)
        assertTrue(e.degisti)
        assertEquals(listOf(sahte), e.digerHedefler)
    }

    @Test
    fun iceriyorBosta() {
        assertFalse(KisayolHedefleri.iceriyor(null, biz))
        assertFalse(KisayolHedefleri.iceriyor("", biz))
        assertFalse(KisayolHedefleri.iceriyor(talkBack, biz))
    }
}
