package dev.eren.ajanda.ag

import dev.eren.ajanda.cekirdek.CekirdekHatasi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Tek bağlantının çekirdekle köprüsü: sıra, kapanışın tam bir kez bildirimi, nesil, çerçeve sınırı. */
class AjandaSoketiTest {
    private val zaman = SahteZamanlayici()
    private val cekirdek = SahteCekirdek()
    private val acici = SahteAcici()
    private val gunluk = ToplayanGunluk()
    private val haberler = mutableListOf<String>()

    private val olaylar = object : AjandaSoketi.Olaylar {
        override fun acildi(soket: AjandaSoketi) {
            haberler += "acildi"
        }

        override fun kapandi(soket: AjandaSoketi, tur: KapanisTuru) {
            haberler += "kapandi $tur"
        }
    }

    private fun yeni(ayar: AgAyarlari = AgAyarlari()): Pair<AjandaSoketi, SahteHamSoket> {
        val s = AjandaSoketi(cekirdek, zaman, gunluk, ayar, olaylar)
        s.bagla(acici, TEST_ADRESI)
        return s to acici.son
    }

    @Test
    fun cercevelerIkiYondeSirayla() {
        cekirdek.acilistaGonder = listOf("hello")
        cekirdek.yanit = { listOf("y:$it") }
        val (_, h) = yeni()
        assertEquals(TEST_ADRESI, h.adres)
        h.ac()
        listOf("a", "b", "c").forEach(h::gelen)
        zaman.bosalt()
        assertEquals(listOf("acildi 1", "cerceve 1 a", "cerceve 1 b", "cerceve 1 c"), cekirdek.olaylar)
        assertEquals(listOf("hello", "y:a", "y:b", "y:c"), h.gonderilen)
        assertEquals(listOf("acildi"), haberler)
    }

    /** Her kapanış türünde çekirdeğe tam bir kez `baglantiKapandi`, yöneticiye tam bir kez haber. */
    @Test
    fun herKapanisTurundeTamBirKezBildirilir() {
        data class Senaryo(val beklenen: KapanisTuru, val kod: Int?, val adim: (AjandaSoketi, SahteHamSoket) -> Unit)

        val senaryolar = listOf(
            // Karşı taraf kapattı: kapanış yanıtlanır; OkHttp ardından `onClosed`, hatta geç `onFailure` verebilir.
            Senaryo(KapanisTuru.KARSI_KAPATTI, 1000) { _, h -> h.karsiKapatti(); h.hata() },
            Senaryo(KapanisTuru.HATA, null) { _, h -> h.hata(); h.zamanAsimi() },
            Senaryo(KapanisTuru.ZAMAN_ASIMI, null) { _, h -> h.zamanAsimi(); h.hata() },
            Senaryo(KapanisTuru.BIZ_KAPATTIK, 1000) { s, h -> s.birak(KapanisTuru.BIZ_KAPATTIK); h.karsiKapatti() },
            // Çekirdek `Tasima.kapat` dedi (etki kilidi altında): bildirim yürütücüye bırakılır.
            Senaryo(KapanisTuru.CEKIRDEK_KAPATTI, 1000) { _, h -> h.gelen("kapat"); h.karsiKapatti(); h.hata() },
        )
        for (sn in senaryolar) {
            val z = SahteZamanlayici()
            val c = SahteCekirdek()
            val a = SahteAcici()
            val haber = mutableListOf<String>()
            val o = object : AjandaSoketi.Olaylar {
                override fun acildi(soket: AjandaSoketi) {}
                override fun kapandi(soket: AjandaSoketi, tur: KapanisTuru) {
                    haber += "$tur"
                }
            }
            val s = AjandaSoketi(c, z, gunluk, AgAyarlari(), o)
            s.bagla(a, TEST_ADRESI)
            val h = a.son
            h.ac()
            z.bosalt()
            sn.adim(s, h)
            z.bosalt()
            s.birak(KapanisTuru.BIZ_KAPATTIK) // geç ikinci kapatma da sayılmaz
            z.ilerle(10_000)
            assertEquals(sn.beklenen.name, listOf("kapandi 1"), c.kapanislar())
            assertEquals(sn.beklenen.name, listOf("${sn.beklenen}"), haber)
            assertEquals(sn.beklenen.name, sn.kod, h.kapatmaKodu)
            assertFalse(sn.beklenen.name, s.gonder("sonra"))
        }
    }

    @Test
    fun bizimKapatmamizdaKarsiYanitlamazsaHamSoketKesilir() {
        val (s, h) = yeni()
        h.ac()
        s.birak(KapanisTuru.BIZ_KAPATTIK)
        zaman.bosalt()
        assertEquals(listOf("kapandi 1"), cekirdek.kapanislar())
        assertFalse(h.iptalEdildi)
        zaman.ilerle(AgAyarlari().kapatmaBeklemeMs)
        assertTrue(h.iptalEdildi)
    }

    @Test
    fun cerceveHataAtarsaSurdururIcerikGunlugeGirmez() {
        val (_, h) = yeni()
        h.ac()
        h.gelen("GIZLI-ICERIK-1")
        h.gelen("boz") // çekirdek kapattırır ve atar
        h.gelen("GIZLI-ICERIK-2") // kapandıktan sonra çekirdeğe gitmez
        zaman.bosalt()
        assertEquals(
            listOf("acildi 1", "cerceve 1 GIZLI-ICERIK-1", "cerceve 1 boz", "kapandi 1"),
            cekirdek.olaylar,
        )
        assertEquals(listOf("acildi", "kapandi CEKIRDEK_KAPATTI"), haberler)
        assertTrue(gunluk.satirlar.toString(), gunluk.satirlar.any { it.contains("GecersizGirdi") })
        assertTrue(gunluk.satirlar.none { it.contains("GIZLI") || it.contains("bozuk") || it.contains("192.0.2") })
    }

    @Test
    fun cekirdekAcilistaReddederseKapanisBildirilmez() {
        cekirdek.acilisHatasi = CekirdekHatasi.Eslesme("eşleşme yok")
        val (_, h) = yeni()
        h.ac()
        h.hata()
        zaman.bosalt()
        assertEquals(emptyList<String>(), cekirdek.olaylar)
        assertEquals(listOf("kapandi ACILAMADI"), haberler)
        assertEquals(1000, h.kapatmaKodu)
    }

    @Test
    fun acilmadanKesilenSoketGecAcilirsaCekirdegeGitmez() {
        val (s, h) = yeni()
        s.birak(KapanisTuru.ZAMAN_ASIMI)
        assertTrue(h.iptalEdildi)
        h.ac() // OkHttp'nin geç açılışı
        h.gelen("x")
        zaman.bosalt()
        assertEquals(emptyList<String>(), cekirdek.olaylar)
        assertEquals(listOf("kapandi ZAMAN_ASIMI"), haberler)
    }

    /** Çekirdek açılışın içinde kapattırırsa (nesil henüz yok) bildirim açılış dönünce, tam bir kez. */
    @Test
    fun acilisSirasindaKapanisNesilGelinceBirKezBildirilir() {
        cekirdek.acilistaGonder = listOf("1234567890X") // giden sınır aşımı açılışın içinde
        val (_, h) = yeni(AgAyarlari(azamiCerceve = 10))
        h.ac()
        h.hata()
        zaman.ilerle(10_000)
        assertEquals(listOf("acildi 1", "kapandi 1"), cekirdek.olaylar)
        assertEquals(listOf("kapandi CERCEVE_SINIRI"), haberler)
        assertEquals(emptyList<String>(), h.gonderilen)
        assertEquals(1009, h.kapatmaKodu)
    }

    @Test
    fun gelenCerceveSiniriUtf16BirimiyleUygulanir() {
        val (_, h) = yeni(AgAyarlari(azamiCerceve = 10))
        h.ac()
        h.gelen("😀".repeat(5)) // 10 birim: sınırda, geçer
        h.gelen("😀".repeat(6)) // 12 birim: çekirdeğe verilmez, 1009
        h.gelen("sonra")
        zaman.bosalt()
        assertEquals(listOf("acildi 1", "cerceve 1 ${"😀".repeat(5)}", "kapandi 1"), cekirdek.olaylar)
        assertEquals(listOf("acildi", "kapandi CERCEVE_SINIRI"), haberler)
        assertEquals(1009, h.kapatmaKodu)
    }

    @Test
    fun gidenCerceveSiniriAsilincaYollanmazKapatilir() {
        cekirdek.yanit = { if (it == "buyuk") listOf("x".repeat(11)) else listOf("k") }
        val (s, h) = yeni(AgAyarlari(azamiCerceve = 10))
        h.ac()
        h.gelen("kucuk")
        h.gelen("buyuk")
        zaman.bosalt()
        assertEquals(listOf("k"), h.gonderilen)
        assertEquals(1009, h.kapatmaKodu)
        assertEquals(listOf("kapandi 1"), cekirdek.kapanislar())
        assertFalse(s.gonder("k"))
    }

    @Test
    fun ikiliCerceveProtokolHatasidir() {
        val (_, h) = yeni()
        h.ac()
        h.dinleyici.ikiliMesaj()
        zaman.bosalt()
        assertEquals(1003, h.kapatmaKodu)
        assertEquals(listOf("acildi", "kapandi PROTOKOL"), haberler)
        assertEquals(listOf("kapandi 1"), cekirdek.kapanislar())
    }

    @Test
    fun eskiSokettenGecGelenOlayYenisineKarismaz() {
        val (s1, h1) = yeni()
        h1.ac()
        s1.birak(KapanisTuru.BIZ_KAPATTIK)
        zaman.bosalt()
        val (_, h2) = yeni()
        h2.ac()
        // Eski soketin geç olayları: çerçeve, kapanış, hata.
        h1.gelen("eski")
        h1.karsiKapatti()
        h1.hata()
        h2.gelen("yeni")
        zaman.bosalt()
        assertEquals(listOf("acildi 1", "kapandi 1", "acildi 2", "cerceve 2 yeni"), cekirdek.olaylar)
        assertEquals(listOf("acildi", "kapandi BIZ_KAPATTIK", "acildi"), haberler)
        assertFalse(h2.bitti)
    }

    @Test
    fun hamSoketYollayamazsaGonderFalse() {
        val (s, h) = yeni()
        h.ac()
        h.gonderebilir = false
        assertFalse(s.gonder("x"))
        h.gonderebilir = true
        assertTrue(s.gonder("x"))
    }
}
