package dev.eren.ajanda.ekran.sahne.bugun

import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.ekran.GeriAlma
import dev.eren.ajanda.ekran.an
import dev.eren.ajanda.ekran.gun
import dev.eren.ajanda.ekran.kayit
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import dev.eren.ajanda.ekran.sahne.veri.BugunKaydi
import dev.eren.ajanda.ekran.sahne.veri.LevhaHali
import dev.eren.ajanda.ekran.sahne.veri.MozaikBicimi
import dev.eren.ajanda.ekran.sahne.veri.MozaikPlani
import dev.eren.ajanda.ekran.sahne.veri.YogunGun
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mozaik düzeni, yoğun gün eşiği ve durum tutucunun iş parçacığı/gözlemci davranışı. */
class BugunDuzenTest {
    private fun k(i: Int, hal: LevhaHali = LevhaHali.ACIK) =
        BugunKaydi("k$i", "k$i", "İş $i", "1$i:00", LevhaRengi.KOBALT, null, hal)

    private fun bicimler(acik: Int, taslak: Int = 0, yogun: Boolean = false, tekSutun: Boolean = false) =
        MozaikPlani.kur((1..acik).map { k(it) }, (1..taslak).map { k(100 + it, LevhaHali.TASLAK) }, yogun, tekSutun).map { it.bicim }

    @Test
    fun normalGunBuyukSonraIkiserKareTekKalanGenis() {
        assertEquals(listOf(MozaikBicimi.BUYUK, MozaikBicimi.KARE, MozaikBicimi.KARE), bicimler(3))
        assertEquals(listOf(MozaikBicimi.BUYUK, MozaikBicimi.KARE, MozaikBicimi.KARE, MozaikBicimi.GENIS), bicimler(4))
        assertEquals(listOf(MozaikBicimi.BUYUK), bicimler(1))
        assertTrue(bicimler(0).isEmpty())
    }

    @Test
    fun taslaklarBastaHerBiriGenis() {
        assertEquals(listOf(MozaikBicimi.TASLAK, MozaikBicimi.TASLAK, MozaikBicimi.BUYUK, MozaikBicimi.GENIS), bicimler(2, taslak = 2))
    }

    @Test
    fun tekSutundaKarelerGenisOlur() {
        assertEquals(listOf(MozaikBicimi.BUYUK, MozaikBicimi.GENIS, MozaikBicimi.GENIS), bicimler(3, tekSutun = true))
    }

    @Test
    fun yogunGunSahneVeSira() {
        val b = bicimler(12, taslak = 3, yogun = true)
        // Öneriler tek gruplu levha; büyük + iki kare resimli; kalan 9 iş kompakt satır.
        assertEquals(MozaikBicimi.TASLAK_GRUBU, b[0])
        assertEquals(listOf(MozaikBicimi.BUYUK, MozaikBicimi.KARE, MozaikBicimi.KARE), b.subList(1, 4))
        assertEquals(List(9) { MozaikBicimi.SATIR }, b.drop(4))
        // Tek taslak yoğun günde de kendi levhasında.
        assertEquals(MozaikBicimi.TASLAK, bicimler(8, taslak = 1, yogun = true)[0])
    }

    @Test
    fun yogunGunEsigiVeGeriDonusPayi() {
        // Gün açılışı: 6'da yoğun, 5'te normal.
        assertTrue(YogunGun.karar(null, 6, buyukYazi = false))
        assertFalse(YogunGun.karar(null, 5, buyukYazi = false))
        // Yoğunken 5'e inmek açmaz; 4'te açılır.
        assertTrue(YogunGun.karar(true, 5, buyukYazi = false))
        assertFalse(YogunGun.karar(true, 4, buyukYazi = false))
        // Normalken 6'ya çıkınca sıkışır.
        assertFalse(YogunGun.karar(false, 5, buyukYazi = false))
        assertTrue(YogunGun.karar(false, 6, buyukYazi = false))
        // Büyük yazıda eşik 4, açılma 2'de.
        assertTrue(YogunGun.karar(null, 4, buyukYazi = true))
        assertTrue(YogunGun.karar(true, 3, buyukYazi = true))
        assertFalse(YogunGun.karar(true, 2, buyukYazi = true))
    }

    @Test
    fun depoGozlemciyleYenilenirVeIslemSonrasiKilitAcilir() {
        val c = BugunCekirdegi()
        c.ekle(kayit("a", "Kahve", an(GUN.toString(), "15:00")), kayit("b", "Diş", an(GUN.toString(), "17:00")))
        val depo = sahteDepo(c)
        assertFalse(depo.model.value.yuklendi)
        depo.basla()
        assertNotNull(c.gozlemci)
        assertEquals(listOf("a", "b"), depo.model.value.acikler.map { it.kayitId })

        // Dışarıdan (PC'den) gelen değişiklik: gözlemci bildirir, model yenilenir.
        c.sahte.kayitlar["b"] = c.sahte.kayitlar.getValue("b").copy(baslik = "Diş kontrolü")
        c.gozlemci!!.degisti(Degisim(listOf("b"), false, false, false, false, emptyList()))
        assertEquals("Diş kontrolü", depo.model.value.acikler[1].baslik)

        // İşlem: bitince çağrıldığında model zaten güncel; tost geri almalı.
        var bittiginde: List<String>? = null
        depo.tamamla(depo.model.value.acikler.first()) { bittiginde = depo.model.value.bitenler.map { it.kayitId } }
        assertEquals(listOf("a"), bittiginde)
        val t = depo.tost.value!!
        assertEquals("Bitti: Kahve", t.mesaj)
        assertEquals(GeriAlma.Durum("a", KayitDurumu.ACIK, null), t.geriAlma)

        depo.geriAl(t.geriAlma!!)
        assertEquals(listOf("a", "b"), depo.model.value.acikler.map { it.kayitId })
        assertEquals("Geri alındı", depo.tost.value!!.mesaj)

        depo.dur()
        assertNull(c.gozlemci)
    }

    @Test
    fun bitenleriGizleKalicidirVeModeleYansir() {
        val c = BugunCekirdegi()
        c.ekle(kayit("a", "Kahve", gun(GUN.toString()), durum = KayitDurumu.TAMAM))
        var yazilan: Boolean? = null
        val depo = dev.eren.ajanda.ekran.sahne.veri.BugunDeposu(
            yuz = { c }, saat = { SIMDI }, calistirici = Hemen, anaya = { it() }, bitenleriGizleYaz = { yazilan = it },
        )
        depo.basla()
        assertFalse(depo.model.value.bitenleriGizle)
        depo.bitenleriGizle(true)
        assertEquals(true, yazilan)
        assertTrue(depo.model.value.bitenleriGizle)
        assertEquals(1, depo.model.value.bitenler.size)
    }

    @Test
    fun cekirdekHatasiTostOlurCokmez() {
        val c = BugunCekirdegi()
        c.ekle(kayit("a", "Kahve", an(GUN.toString(), "15:00")))
        val depo = sahteDepo(c)
        depo.basla()
        c.sahte.kayitlar.clear() // kayıt yok: durumDegistir atar
        var bitti = false
        depo.tamamla(depo.model.value.acikler.first()) { bitti = true }
        assertTrue(bitti)
        assertTrue(depo.tost.value!!.hata)
    }
}
