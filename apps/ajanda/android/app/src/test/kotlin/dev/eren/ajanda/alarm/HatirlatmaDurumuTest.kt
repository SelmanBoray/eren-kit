package dev.eren.ajanda.alarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HatirlatmaDurumuTest {
    private val bos = KayitliSorunlar()

    @Test
    fun her_sey_yolundayken_sorun_yok() {
        val d = HatirlatmaDurumu.hesapla(iyiOlgular(), bos)
        assertTrue(d.sorunlar.isEmpty())
        assertFalse(d.engelVar)
    }

    @Test
    fun bildirim_izni_ve_kapali_bildirimler() {
        val izinsiz = HatirlatmaDurumu.hesapla(iyiOlgular().copy(bildirimIzni = false, bildirimlerAcik = false), bos)
        assertEquals(listOf(HatirlatmaSorunu.BILDIRIM_IZNI_YOK), izinsiz.sorunlar)
        assertTrue(izinsiz.engelVar)
        // Android 12'de izin yoktur; uygulama bildirimleri ayardan kapatılmış olabilir.
        val eski = HatirlatmaDurumu.hesapla(iyiOlgular().copy(sdk = 32, bildirimIzni = false, bildirimlerAcik = false), bos)
        assertEquals(listOf(HatirlatmaSorunu.BILDIRIMLER_KAPALI), eski.sorunlar)
        val kanal = HatirlatmaDurumu.hesapla(iyiOlgular().copy(hatirlatmaKanaliAcik = false, kacirilanKanaliAcik = false), bos)
        assertEquals(
            listOf(HatirlatmaSorunu.HATIRLATMA_KANALI_KAPALI, HatirlatmaSorunu.KACIRILAN_KANALI_KAPALI),
            kanal.sorunlar,
        )
        assertTrue(kanal.engelVar)
        val yalnizKacirilan = HatirlatmaDurumu.hesapla(iyiOlgular().copy(kacirilanKanaliAcik = false), bos)
        assertFalse(yalnizKacirilan.engelVar)
    }

    @Test
    fun pil_bilgi_duzeyinde_arka_plan_kisiti_engel() {
        val pil = HatirlatmaDurumu.hesapla(iyiOlgular().copy(pilOptimizasyonundanMuaf = false), bos)
        assertEquals(listOf(HatirlatmaSorunu.PIL_OPTIMIZASYONU), pil.sorunlar)
        assertFalse(pil.engelVar)
        val kisit = HatirlatmaDurumu.hesapla(iyiOlgular().copy(arkaPlanKisitli = true), bos)
        assertEquals(listOf(HatirlatmaSorunu.ARKA_PLAN_KISITLI), kisit.sorunlar)
        assertTrue(kisit.engelVar)
    }

    @Test
    fun kayitli_sorunlar_sinirli_ve_temizlenebilir() {
        val k = BellekSorunKaydi { 7L }
        repeat(25) { k.gosterilemedi(listOf("k_$it")) }
        k.kurulamadi("x")
        val s = k.oku()
        assertEquals(KayitliSorunlar.GOSTERILEMEYEN_SINIRI, s.gosterilemeyenKayitlar.size)
        assertEquals("k_24", s.gosterilemeyenKayitlar.last())
        assertEquals(25, s.gosterilemeyenSayisi)
        assertEquals(7L, s.sonSorunMs)
        assertEquals(
            listOf(HatirlatmaSorunu.GOSTERILEMEYEN_HATIRLATMA, HatirlatmaSorunu.KURULAMAYAN_ALARM),
            HatirlatmaDurumu.hesapla(iyiOlgular(), s).sorunlar,
        )
        k.temizle()
        assertTrue(k.oku().bos)
    }
}
