package dev.eren.ajanda.alarm

import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.KayitTuru
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate

class BildirimIcerigiTest {
    private val bugun = LocalDate.parse("2026-11-25")
    private val dilim = "Europe/Istanbul"

    private fun an(tarih: String, saat: String = "15:00", d: String = dilim) = AjandaZamani.An(tarih, saat, null, d, null)

    @Test
    fun zaman_metni() {
        val z = { zaman: AjandaZamani?, ornek: String? -> BildirimIcerigi.zamanMetni(zaman, ornek, bugun, dilim) }
        assertEquals("bugün 15:00", z(an("2026-11-25"), null))
        assertEquals("yarın 09:30", z(an("2026-11-26", "09:30"), null))
        assertEquals("dün 15:00", z(an("2026-11-24"), null))
        assertEquals("01.12.2026 15:00", z(an("2026-12-01"), null))
        assertEquals("bugün 15:00 (Europe/Berlin)", z(an("2026-11-25", d = "Europe/Berlin"), null))
        // Tekrarda örneğin günü.
        assertEquals("yarın 15:00", z(an("2026-11-01"), "2026-11-26"))
        assertEquals("bugün", z(AjandaZamani.Gun("2026-11-25", dilim, null), null))
        assertEquals("bugün – 27.11.2026", z(AjandaZamani.Donem("2026-11-25", "2026-11-27", dilim, null), null))
        assertEquals("haftaya bir ara", z(AjandaZamani.Belirsiz("haftaya bir ara"), null))
        assertNull(z(null, null))
        assertEquals("bozuk", BildirimIcerigi.gun("bozuk", bugun))
    }

    @Test
    fun hatirlatma_icerigi_ve_kilit_ekrani_yuzu() {
        val i = BildirimIcerigi.hatirlatma(bildirim(1, baslik = "Dişçi ☕️", tur = KayitTuru.RANDEVU), bugun, dilim)
        assertEquals("Dişçi ☕️", i.baslik)
        assertEquals("Randevu · bugün 15:00", i.metin)
        assertFalse(i.gizliBaslik.contains("Dişçi") || i.gizliMetin.contains("Dişçi"))
        val zamansiz = BildirimIcerigi.hatirlatma(bildirim(2, tur = KayitTuru.GOREV, zaman = null), bugun, dilim)
        assertEquals("Görev", zamansiz.metin)
    }

    @Test
    fun kacirilan_ozeti_tek_bildirimde_birlesir() {
        val satirlar = (1L..8L).map { BildirimIcerigi.ozetSatiri(bildirim(it, tetik = 1000 - it), bugun, dilim) }
        val o = BildirimIcerigi.kacirilan(BildirimIcerigi.birlestir(emptyList(), satirlar))
        assertEquals("8 hatırlatma kaçırıldı", o.icerik.baslik)
        assertEquals(BildirimIcerigi.GORUNEN_SATIR, o.gorunenSatirlar.size)
        assertEquals(2, o.tasan)
        // Tetik sırasıyla (en eski önce).
        assertEquals((8L downTo 1L).toList(), o.satirlar.map { it.alarmNo })
        assertFalse((1..8).any { o.icerik.gizliMetin.contains("Başlık $it") || o.icerik.gizliBaslik.contains("Başlık $it") })

        val tek = BildirimIcerigi.kacirilan(listOf(satirlar[0]))
        assertEquals("Kaçırılan hatırlatma", tek.icerik.baslik)
        assertEquals("Başlık 1 · bugün 15:00", tek.icerik.metin)
        assertEquals(0, tek.tasan)
    }

    @Test
    fun ekrandaki_ozetle_birlesirken_ayni_alarm_bir_kez() {
        val s = { no: Long -> BildirimIcerigi.ozetSatiri(bildirim(no, tetik = no * 10), bugun, dilim) }
        val b = BildirimIcerigi.birlestir(listOf(s(3), s(1)), listOf(s(2), s(3)))
        assertEquals(listOf(1L, 2L, 3L), b.map { it.alarmNo })
        assertEquals("3 hatırlatma kaçırıldı", BildirimIcerigi.kacirilan(b).icerik.baslik)
    }
}
