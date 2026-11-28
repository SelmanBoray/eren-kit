package dev.eren.ajanda.ekran

import dev.eren.ajanda.birlestirme.BirlestirmeAkisi
import dev.eren.ajanda.birlestirme.BirlestirmeCekirdegi
import dev.eren.ajanda.cekirdek.BirlestirmeOnizlemesi
import dev.eren.ajanda.cekirdek.BirlestirmeSonucu
import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.KoparmaSonucu
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Ana ekranın birleştirme penceresi kuralı ([BirlestirmePenceresi]) ve ekranın akışı kullanma biçimi: akış süreç
 * boyunca tek, açılışta `denetle()` (zorlamasız), menüden `denetle(zorla = true)`; döndürmede soru yutulmaz,
 * "Şimdi değil" denmiş plan yeniden zorla sorulmaz.
 */
class BirlestirmePenceresiTest {
    private class SahteCekirdek : BirlestirmeCekirdegi {
        var plan: BirlestirmeOnizlemesi? = null
        val onaylananIzler = mutableListOf<String?>()
        override fun birlestirmeOnizlemesi() = plan
        override fun birlestirmeyiOnayla(iz: String?): BirlestirmeSonucu {
            onaylananIzler += iz
            val p = plan
            // Gerçek çekirdek: iz güncel plana uymazsa uygulamaz, yeni planı döner.
            return if (p != null && p.iz == iz) BirlestirmeSonucu(true, p).also { plan = null } else BirlestirmeSonucu(false, p)
        }
        override fun birlestirmedenVazgec() = KoparmaSonucu(CalismaKipi.YEREL, 0, 0, 0, 0, true)
        override fun kip() = CalismaKipi.YEREL
    }

    private fun plan(iz: String) = BirlestirmeOnizlemesi(
        depoId = "depo",
        ayniDepo = false,
        yeni = 1,
        degisen = 0,
        cakisanlar = emptyList(),
        pcSilmisler = emptyList(),
        retListesine = emptyList(),
        dusecekMezar = 0,
        ayni = 0,
        servistenGelecek = 0,
        islem = 1,
        olasiCiftler = emptyList(),
        iz = iz,
        taslaklar = emptyList(),
        okunamayanPcTemeli = 0,
    )

    private val cekirdek = SahteCekirdek()
    private val akis = BirlestirmeAkisi(cekirdek, kusak = { 1L })

    private fun goster(i: BirlestirmePenceresi.Is): BirlestirmeAkisi.Adim {
        assertTrue("$i", i is BirlestirmePenceresi.Is.Goster)
        return (i as BirlestirmePenceresi.Is.Goster).adim
    }

    @Test
    fun ayniSoruYenidenAcilmazYenisiYerineGecerNullYalnizSoruyuKapatir() {
        val p = BirlestirmePenceresi()
        assertEquals(BirlestirmePenceresi.Is.Dokunma, p.geldi(null))
        cekirdek.plan = plan("iz1")
        val ilk = akis.denetle()
        assertEquals(ilk, goster(p.geldi(ilk)))
        assertEquals(ilk, p.soru)
        // Yeni bir ilgili bildirim aynı planı getirdi: pencere yerinde kalır.
        assertEquals(BirlestirmePenceresi.Is.Dokunma, p.geldi(akis.denetle()))
        // Plan değişti: yeni soru eskisinin yerine geçer.
        cekirdek.plan = plan("iz2")
        val yeni = akis.denetle()
        assertEquals(yeni, goster(p.geldi(yeni)))
        // Sorulacak bir şey kalmadı: açık soru kapanır.
        cekirdek.plan = null
        assertEquals(BirlestirmePenceresi.Is.Kapat, p.geldi(akis.denetle()))
        assertNull(p.soru)
        // Sonuç penceresine null dokunmaz.
        val bilgi = BirlestirmeAkisi.Adim.Bilgi("b", "m")
        goster(p.geldi(bilgi))
        assertNull(p.soru)
        assertEquals(BirlestirmePenceresi.Is.Dokunma, p.geldi(null))
    }

    @Test
    fun eskiPencereninAdimiylaOnayYeniSoruGetirirOdaGosterilir() {
        val p = BirlestirmePenceresi()
        cekirdek.plan = plan("iz1")
        val eski = akis.denetle() as BirlestirmeAkisi.Adim.Onay
        goster(p.geldi(eski))
        // Pencere açıkken plan değişti; kullanıcı eski pencereden onayladı (düğme kapattı).
        cekirdek.plan = plan("iz2")
        p.kapandi()
        val s = akis.onayla(eski)
        assertEquals(listOf<String?>("iz1"), cekirdek.onaylananIzler)
        val yeni = goster(p.geldi(s)) as BirlestirmeAkisi.Adim.Onay
        assertEquals("iz2", yeni.iz)
        // Yeni pencereden onay: o adımın iziyle uygulanır.
        p.kapandi()
        val sonuc = akis.onayla(yeni)
        assertEquals(listOf<String?>("iz1", "iz2"), cekirdek.onaylananIzler)
        assertTrue(goster(p.geldi(sonuc)) is BirlestirmeAkisi.Adim.Bilgi)
    }

    @Test
    fun dondurmedeSoruYutulmazSimdiDegilYenidenSorulmazMenudenAcilir() {
        cekirdek.plan = plan("iz1")
        // İlk etkinlik soruyu gösterdi; döndürme pencereyi yok etti.
        goster(BirlestirmePenceresi().geldi(akis.denetle()))
        // Yeni etkinlik (yeni pencere durumu, aynı akış): onStart'taki denetle soruyu yeniden getirir.
        val yeniden = akis.denetle()
        val ikinci = BirlestirmePenceresi()
        val soru = goster(ikinci.geldi(yeniden)) as BirlestirmeAkisi.Adim.Onay
        // "Şimdi değil", sonra yine döndürme: aynı plan aynı bağlantıda yeniden sorulmaz.
        ikinci.kapandi()
        akis.simdiDegil(soru)
        assertEquals(BirlestirmePenceresi.Is.Dokunma, BirlestirmePenceresi().geldi(akis.denetle()))
        // Menü öğesi bekleyen() doluyken görünür; dokununca zorla sorulur.
        val b = akis.bekleyen()
        assertTrue(b != null && b.ertelendi)
        goster(BirlestirmePenceresi().geldi(akis.denetle(zorla = true)))
    }
}
