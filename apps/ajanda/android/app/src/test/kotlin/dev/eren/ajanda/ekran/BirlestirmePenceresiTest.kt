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
 * Ana ekranın birleştirme penceresi kuralı ([BirlestirmePenceresi]: pencere kimliği, geri tuşu, "Eşleşmeyi kaldır"ın
 * ikinci onayı), sonuç kutusu ([SonucKutusu]), göstergenin onay bekleyen hali ve ekranın akışı kullanma biçimi: akış
 * süreç boyunca tek, açılışta `denetle()` (zorlamasız), şeritten/menüden `denetle(zorla = true)`; döndürmede soru
 * yutulmaz, "Şimdi değil" denmiş soru yeniden zorla sorulmaz.
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
        // Yeni soru "değişti" der (kullanıcı okurken plan değişti).
        assertEquals("Kayıtlar bu arada değişti", yeni!!.baslik)
        // Bekleyen kalktı: akış açıklar, açıklama sorunun yerine geçer (P5: sessiz kapanma yok).
        cekirdek.plan = null
        val aciklama = goster(p.geldi(akis.denetle()))
        assertEquals("Birleştirilemedi", aciklama.baslik)
        assertNull(p.soru)
        // Akışın açıklamadığı null (savunma): açık soru kapanır, görünüm kısa not gösterir.
        cekirdek.plan = plan("iz3")
        goster(p.geldi(akis.denetle()))
        assertEquals(BirlestirmePenceresi.Is.Kapat, p.geldi(null))
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
        val pencere1 = Any()
        p.acildi(pencere1)
        // Pencere açıkken plan değişti; kullanıcı eski pencereden onayladı (düğme kapattı).
        cekirdek.plan = plan("iz2")
        assertTrue(p.kapandi(pencere1))
        val s = akis.onayla(eski)
        assertEquals(listOf<String?>("iz1"), cekirdek.onaylananIzler)
        val yeni = goster(p.geldi(s)) as BirlestirmeAkisi.Adim.Onay
        assertEquals("iz2", yeni.iz)
        assertEquals("Kayıtlar bu arada değişti", yeni.baslik)
        // Yeni pencereden onay: o adımın iziyle uygulanır.
        val pencere2 = Any()
        p.acildi(pencere2)
        assertTrue(p.kapandi(pencere2))
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
        val pencere = Any()
        ikinci.acildi(pencere)
        assertTrue(ikinci.kapandi(pencere))
        akis.simdiDegil(soru)
        assertEquals(BirlestirmePenceresi.Is.Dokunma, BirlestirmePenceresi().geldi(akis.denetle()))
        // Şerit ve menü öğesi sonBekleyen doluyken görünür; dokununca zorla sorulur.
        val b = akis.sonBekleyen
        assertTrue(b != null && b.ertelendi)
        goster(BirlestirmePenceresi().geldi(akis.denetle(zorla = true)))
    }

    @Test
    fun yalnizEkrandakiPencereninKapanisiDurumuDegistirir() {
        val p = BirlestirmePenceresi()
        cekirdek.plan = plan("iz1")
        goster(p.geldi(akis.denetle()))
        val eski = Any()
        p.acildi(eski)
        // Arka plandan yeni plan geldi: eski pencere kapatılır (dismiss), yenisi açılır.
        cekirdek.plan = plan("iz2")
        val yeni = goster(p.geldi(akis.denetle())) as BirlestirmeAkisi.Adim.Onay
        val yeniPencere = Any()
        p.acildi(yeniPencere)
        // Eski pencerenin geç gelen kapanış/geri dinleyicisi yeni soruyu silmez, ertelemez.
        assertEquals(false, p.kapandi(eski))
        assertNull(p.geriBasildi(eski))
        assertEquals(yeni, p.soru)
        // Geri tuşu: "Şimdi değil" sayılır (ertelenecek soru döner), durum silinir.
        assertEquals(yeni, p.geriBasildi(yeniPencere))
        assertNull(p.soru)
        assertNull(p.geriBasildi(yeniPencere))
        // Sonuç penceresinde geri: ertelenecek bir şey yok.
        goster(p.geldi(BirlestirmeAkisi.Adim.Bilgi("b", "m")))
        val bilgi = Any()
        p.acildi(bilgi)
        assertNull(p.geriBasildi(bilgi))
        assertNull(p.adim)
    }

    @Test
    fun eslesmeyiKaldirIkinciOnayIsterGeriDonSoruyaDoner() {
        val p = BirlestirmePenceresi()
        cekirdek.plan = plan("iz1")
        val soru = goster(p.geldi(akis.denetle())) as BirlestirmeAkisi.Adim.Onay
        val soruPenceresi = Any()
        p.acildi(soruPenceresi)
        // "Eşleşmeyi kaldır": ikinci onay açılır; soru açık sayılır.
        assertEquals(soru, p.kaldirmaIstendi(soruPenceresi))
        assertTrue(p.kaldirmaOnayinda)
        assertEquals(soru, p.soru)
        val onayPenceresi = Any()
        p.acildi(onayPenceresi)
        // Eski soru penceresinin geç gelen olayları yok sayılır.
        assertNull(p.kaldirmaIstendi(soruPenceresi))
        assertNull(p.geriBasildi(soruPenceresi))
        // Aynı plan yeniden geldi: onay penceresi yerinde kalır.
        assertEquals(BirlestirmePenceresi.Is.Dokunma, p.geldi(akis.denetle()))
        // "Geri dön" (ya da geri tuşu): soru yeniden açılır, eşleşme silinmez.
        assertEquals(soru, p.soruyaDon(onayPenceresi))
        assertTrue(!p.kaldirmaOnayinda)
        val soruPenceresi2 = Any()
        p.acildi(soruPenceresi2)
        assertNull(p.soruyaDon(soruPenceresi2))
        // Yeniden "Eşleşmeyi kaldır", sonra arka plandan yeni plan: onay penceresinin yerine yeni soru geçer.
        p.kaldirmaIstendi(soruPenceresi2)
        p.acildi(Any())
        cekirdek.plan = plan("iz2")
        val yeni = goster(p.geldi(akis.denetle())) as BirlestirmeAkisi.Adim.Onay
        assertEquals("Kayıtlar bu arada değişti", yeni.baslik)
        assertTrue(!p.kaldirmaOnayinda)
        // İkinci onayda "Eşleşmeyi kaldır": pencere kapanır (vazgeç görünümde, arka iş parçacığında).
        val s = Any()
        p.acildi(s)
        p.kaldirmaIstendi(s)
        val o = Any()
        p.acildi(o)
        assertTrue(p.kapandi(o))
        assertNull(p.adim)
        assertTrue(cekirdek.onaylananIzler.isEmpty())
    }

    @Test
    fun sonucKutusuYanitiBirKezVeYeniEtkinligeTasir() {
        val k = SonucKutusu<BirlestirmeAkisi.Adim>()
        val a = BirlestirmeAkisi.Adim.Bilgi("Birleştirildi", "m")
        // Etkinlik yaşıyor: arka iş parçacığı koyar, ana iş parçacığı bir kez teslim alır.
        k.koy(a)
        assertTrue(k.teslimEt(a))
        assertEquals(false, k.teslimEt(a))
        assertNull(k.al())
        // Etkinlik o arada yok edildi (ileti düştü): yeni etkinlik onStart'ta alır.
        k.koy(a)
        assertEquals(a, k.al())
        assertNull(k.al())
        // Yeni etkinlik aldıktan sonra eski etkinliğin geç iletisi göstermez.
        k.koy(a)
        k.al()
        assertEquals(false, k.teslimEt(a))
        // Gösterilmemiş eskisinin yerine yenisi geçer; eşit metinli ayrı yanıtlar kimlikle ayrılır.
        val b1 = BirlestirmeAkisi.Adim.Hata("h", "m")
        val b2 = BirlestirmeAkisi.Adim.Hata("h", "m")
        k.koy(b1)
        k.koy(b2)
        assertEquals(false, k.teslimEt(b1))
        assertTrue(k.teslimEt(b2))
    }

    @Test
    fun gostergeOnayBekleyenBirlestirmedeEsitleniyorDemez() {
        // P1: bekleme sırasında çekirdek TELAFI'de; gösterge "Eşitleniyor…" yerine "Onay bekliyor" der.
        val dilim = java.time.ZoneId.of("Europe/Istanbul")
        val es = dev.eren.ajanda.cekirdek.EslesmeDurumu.Eslesti("d", "100.101.102.103", 8765)
        fun g(a: dev.eren.ajanda.cekirdek.BaglantiAsamasi) = DurumGostergesi.hesapla(
            es, dev.eren.ajanda.cekirdek.BaglantiDurumu(a, 0, 0, null, null, null, ertelenenIslem = 0), true, 0, dilim,
        )
        val telafi = g(dev.eren.ajanda.cekirdek.BaglantiAsamasi.TELAFI)
        assertEquals("Eşitleniyor…", telafi.kisa)
        val bekliyor = DurumGostergesi.birlestirmeyle(telafi, bekliyor = true)
        assertTrue(bekliyor === DurumGostergesi.BIRLESTIRME_BEKLIYOR)
        assertEquals("Onay bekliyor", bekliyor.kisa)
        assertEquals(DurumGostergesi.Ton.UYARI, bekliyor.ton)
        assertTrue(bekliyor.ayrinti, bekliyor.ayrinti.contains("hiçbir şey eşitlenmez"))
        assertTrue(!Regex("\\bPC\\b").containsMatchIn(bekliyor.kisa + bekliyor.ayrinti))
        // Varsayılan davranış değişmez; bayat "bekliyor" bağlı/çevrimdışı göstergeyi örtmez.
        assertEquals(telafi, DurumGostergesi.birlestirmeyle(telafi, bekliyor = false))
        val canli = g(dev.eren.ajanda.cekirdek.BaglantiAsamasi.CANLI)
        assertEquals(canli, DurumGostergesi.birlestirmeyle(canli, bekliyor = true))
        val kopuk = g(dev.eren.ajanda.cekirdek.BaglantiAsamasi.KOPUK)
        assertEquals(kopuk, DurumGostergesi.birlestirmeyle(kopuk, bekliyor = true))
    }
}
