package dev.eren.ajanda.ag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Ön plan bağlantısının kuralı (bulgu 2 ve 3): herhangi bir ekran görünürken açık, hiçbiri görünmezken kısa
 * bekleme sonrası kapalı; ekranlar arası geçişte ve döndürmede düşmez. Etkinlik sırası Android'inki:
 * yeni ekran başlar (`basladi`), sonra eski durur (`durdu`).
 */
class GorunurlukSayaciTest {
    private val zaman = SahteZamanlayici()
    private val cekirdek = SahteCekirdek()
    private val acici = SahteAcici()
    private val ayar = AgAyarlari()
    private val denetci = BaglantiDenetcisi({ cekirdek }, acici, zaman, SahteAg(true), SahteIsler(), ToplayanGunluk(), ayar, rastgele = { 0.5 })
    private val sayac = GorunurlukSayaci(gorundu = { denetci.basla() }, gizlendi = { denetci.birak() })

    /** İlk ekran açıldı, bağlandı. */
    private fun ilkEkran(): SahteHamSoket {
        sayac.basladi()
        zaman.bosalt()
        val h = acici.son
        h.ac()
        zaman.bosalt()
        return h
    }

    @Test
    fun yalnizSayacSifiraInerkenBildirir() {
        val olaylar = mutableListOf<String>()
        val s = GorunurlukSayaci({ olaylar += "gorundu" }, { olaylar += "gizlendi" })
        s.durdu() // fazla durma sayacı bozmaz
        s.basladi()
        s.basladi()
        s.durdu()
        assertTrue(s.gorunur)
        s.durdu()
        assertFalse(s.gorunur)
        s.basladi()
        assertEquals(listOf("gorundu", "gizlendi", "gorundu"), olaylar)
    }

    /** Ana ekran -> kayıt ekranı (geçmiş canlı bağlantı ister) -> geri: bağlantı hiç düşmez, yeniden el sıkışma yok. */
    @Test
    fun ekranlarArasiGecisteBaglantiDusmez() {
        val h = ilkEkran()
        sayac.basladi() // KayitEkrani.onStart
        sayac.durdu() // AnaEkran.onStop
        zaman.ilerle(60_000)
        assertFalse("kayıt ekranı açıkken bağlantı açık", h.bitti)
        sayac.basladi() // AnaEkran.onStart (geri)
        sayac.durdu() // KayitEkrani.onStop
        zaman.ilerle(60_000)
        assertFalse(h.bitti)
        assertEquals(1, acici.acilanlar.size)
        assertEquals(listOf("acildi 1"), cekirdek.olaylar)
    }

    /** Döndürme / tema değişimi: aynı etkinlik durup yeniden başlar; bırakma beklemesi içinde, düşmez. */
    @Test
    fun yenidenKurulumdaBaglantiDusmez() {
        val h = ilkEkran()
        sayac.durdu()
        zaman.ilerle(100)
        sayac.basladi()
        zaman.ilerle(60_000)
        assertFalse(h.bitti)
        assertEquals(1, acici.acilanlar.size)
    }

    /** Eşleştirme ekranında Home: bekleme sonrası kapanır, arka planda yeniden bağlanma döngüsü yok. */
    @Test
    fun hicbirEkranGorunmezkenBeklemeSonrasiKapanir() {
        val h = ilkEkran()
        sayac.durdu()
        zaman.ilerle(ayar.birakmaGecikmesiMs - 1)
        assertFalse(h.bitti)
        zaman.ilerle(1)
        assertTrue("bırakıldı", h.bitti)
        assertEquals(1000, h.kapatmaKodu)
        zaman.ilerle(10 * 60_000)
        assertEquals("yeniden bağlanılmadı", 1, acici.acilanlar.size)
        assertEquals(listOf("kapandi 1"), cekirdek.kapanislar())
        assertEquals(emptyList<Long>(), zaman.bekleyenler().filter { it > 0 })

        // Görünmezken "hemen dene" (eşleştirme sonucu) hiçbir şey açmaz; görününce bağlanır.
        denetci.hemenDene()
        zaman.ilerle(60_000)
        assertEquals(1, acici.acilanlar.size)
        sayac.basladi()
        zaman.bosalt()
        assertEquals(2, acici.acilanlar.size)
    }

    /** Görünürken kopuk ve beklemedeyken "hemen dene" beklemeyi atlar. */
    @Test
    fun gorunurkenHemenDeneBeklemeyiAtlar() {
        ilkEkran().hata()
        zaman.bosalt()
        assertEquals(listOf(1_000L), zaman.bekleyenler())
        denetci.hemenDene()
        zaman.bosalt()
        assertEquals(2, acici.acilanlar.size)
    }
}
