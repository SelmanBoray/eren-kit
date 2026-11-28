package dev.eren.ajanda.ekran.sahne.veri

import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.ekran.GeriAlma
import dev.eren.ajanda.ekran.an
import dev.eren.ajanda.ekran.gun
import dev.eren.ajanda.ekran.kayit
import dev.eren.ajanda.ekran.sahne.bugun.BugunCekirdegi
import dev.eren.ajanda.ekran.sahne.bugun.GUN
import dev.eren.ajanda.ekran.sahne.bugun.Hemen
import dev.eren.ajanda.ekran.sahne.bugun.SIMDI
import dev.eren.ajanda.ekran.sahne.bugun.sahteDepo
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Üç ekranın ortak altyapısı (gözden geçirme bulguları G3–G5): tostun gerçek saatle üst sınırı, geri almanın
 * önceki durumu çekirdekten alması ve bu arada değişen kaydı ezmemesi, model kurulamasa da işlemin tostunun
 * (geri almasıyla) kalması, okuma hatasında listelerin boşaltılmaması.
 */
class OrtakAltyapiTest {
    private val c = BugunCekirdegi()

    // G3 ------------------------------------------------------------------------------------------

    @Test
    fun tostGercekSaatleUstSinirliGeriAlmaSonraUygulanmaz() {
        var simdi = 1_000_000L
        val k = TostKanali { simdi }
        val alinan = mutableListOf<GeriAlma>()
        k.goster("Bitti: Diş", GeriAlma.Durum("d", KayitDurumu.ACIK)) { alinan += it }
        val t = k.tost.value!!
        assertEquals(4200L, k.tostSuresi(t.no) { 4200L })
        k.tostKalani(t.no, 3000L)
        // Ekran gitti, telefon kilitli kaldı; 31 saniye sonra dönüş: tost yeniden çıkmaz, geri alma da uygulanmaz.
        simdi += 31_000L
        assertNull(k.tostSuresi(t.no) { 4200L })
        k.tostuGeriAl(t) { alinan += it }
        assertTrue(alinan.isEmpty())
    }

    @Test
    fun tostUstSinirIcindeKalanSureyleDonerVeBirKezGeriAlir() {
        var simdi = 0L
        val k = TostKanali { simdi }
        val alinan = mutableListOf<GeriAlma>()
        k.goster("Bitti: Diş", GeriAlma.Durum("d", KayitDurumu.ACIK)) { alinan += it }
        val t = k.tost.value!!
        k.tostSuresi(t.no) { 4200L }
        k.tostKalani(t.no, 2500L)
        simdi += 10_000L
        assertEquals(2500L, k.tostSuresi(t.no) { 4200L })
        k.tostuGeriAl(t) { alinan += it }
        k.tostuGeriAl(t) { alinan += it }
        assertEquals(1, alinan.size)
    }

    @Test
    fun oncekiDurumEkranKopyasindanDegilCekirdektenAlinir() {
        // Telefonda tamamlandı, PC iptal etti; ekranın solmuş kopyası hâlâ "tamamlandı". "Yeniden aç"ın geri
        // alması işi TAMAM'a değil IPTAL'e götürmeli.
        c.ekle(kayit("d", "Diş", an(GUN.toString(), "17:00"), durum = KayitDurumu.IPTAL))
        val kopya = BugunKaydi("d", "d", "Diş", "17:00", LevhaRengi.KUM, null, LevhaHali.BITTI, iptal = false)
        val s = KayitKurucu.tamamla(c, kopya, tamam = false)
        assertEquals(GeriAlma.Durum("d", KayitDurumu.IPTAL, null), s.geriAlma)
    }

    @Test
    fun geriAlmaBuAradaDegisenKaydiEzmez() {
        c.ekle(kayit("d", "Diş", an(GUN.toString(), "17:00")))
        val depo = sahteDepo(c).also { it.basla() }
        depo.tamamla(depo.model.value.acikler.single())
        val tost = depo.tost.value!!
        // PC iptal etti.
        c.sahte.kayitlar["d"] = c.sahte.kayitlar.getValue("d").copy(durum = KayitDurumu.IPTAL)
        c.cagrilar.clear()
        depo.tostuGeriAl(tost)
        assertTrue(c.cagrilar.none { it.startsWith("durum:") })
        assertEquals(KayitKurucu.DEGISTI_UYARISI, depo.tost.value!!.mesaj)
        assertEquals(KayitDurumu.IPTAL, c.sahte.kayitlar.getValue("d").durum)
    }

    // G4 ------------------------------------------------------------------------------------------

    /** Modeli kurulamayan kardeş depo (işlemden sonra kur() atar). */
    private class AtanDepo(ortam: DepoOrtami) : KardesDepo<Int>(ortam, 0) {
        @Volatile var at = false
        override fun hepsiniOku() = Unit
        override fun degisiklik(d: Degisim) = Unit
        override fun kur(): Int = if (at) throw IllegalStateException("model kurulamadı") else 1
    }

    @Test
    fun modelKurulamasaDaIslemTostuGeriAlmasiylaKalir() {
        c.ekle(kayit("d", "Diş", an(GUN.toString(), "17:00")))
        val kanal = TostKanali()
        val ortam = DepoOrtami({ c }, { SIMDI }, Hemen, { it() }, kanal, { false }, {})
        val depo = AtanDepo(ortam)
        depo.goruldu()
        depo.at = true
        var bitti = false
        depo.tamamla(BugunKaydi("d", "d", "Diş", "17:00", LevhaRengi.KUM, null, LevhaHali.ACIK), bitince = { bitti = true })
        assertTrue("kilit açılır", bitti)
        assertEquals(KayitDurumu.TAMAM, c.sahte.kayitlar.getValue("d").durum)
        val t = kanal.tost.value!!
        assertEquals("Bitti: Diş", t.mesaj)
        assertNotNull("geri alma kaybolmaz", t.geriAlma)
        assertFalse(t.hata)
    }

    // G5 ------------------------------------------------------------------------------------------

    @Test
    fun okumaHatasiListeleriBosaltmaz() {
        c.ekle(
            kayit("kitap", "Kitap iadesi", an(GUN.plusDays(1).toString(), "11:00")),
            kayit("eski", "Su faturası", gun(GUN.minusDays(2).toString())),
            kayit("t", "Eczane", gun(GUN.plusDays(3).toString()), taslak = true),
        )
        val d = BugunDenetleyici(c) { SIMDI }
        d.hepsiniOku()
        val once = d.model()
        assertEquals(1, once.kalanlar.size)
        assertEquals(1, once.taslaklar.size)
        assertTrue(once.yaklasanlar.isNotEmpty())
        c.listeHatasi = IllegalStateException("okunamadı")
        d.hepsiniOku()
        val sonra = d.model()
        assertEquals(once.kalanlar.map { it.kayitId }, sonra.kalanlar.map { it.kayitId })
        assertEquals(once.taslaklar.map { it.kayitId }, sonra.taslaklar.map { it.kayitId })
        assertEquals(once.yaklasanlar.map { it.anahtar }, sonra.yaklasanlar.map { it.anahtar })
        assertNotNull(sonra.okumaHatasi)
    }
}
