package dev.eren.ajanda.aktarma

import dev.eren.ajanda.ag.Gunluk
import dev.eren.ajanda.cekirdek.AktarmaBicimi
import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.DisaAktarma
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/** Otomatik yedek (D6): zaman kuralı, dosya adı, temizlik ve sahte klasörle deneme akışı ve hataları. */
class OtomatikYedekTest {
    private val dilim = ZoneId.of("Europe/Istanbul")
    private fun an(gun: Int, saat: Int = 10, dk: Int = 0, ay: Int = 11) =
        ZonedDateTime.of(2026, ay, gun, saat, dk, 0, 0, dilim).toInstant().toEpochMilli()

    private val acik = YedekDurumu(acik = true, klasor = "agac://yedek")
    private val dk = 60_000L

    // --- Zaman kuralı -------------------------------------------------------------------------

    @Test
    fun kapaliyKlasorsuzZamaniGelmez() {
        assertFalse(OtomatikYedekPlani.zamaniGeldiMi(YedekDurumu(), an(28), dilim))
        assertFalse(OtomatikYedekPlani.zamaniGeldiMi(YedekDurumu(acik = true), an(28), dilim))
        assertFalse(OtomatikYedekPlani.zamaniGeldiMi(acik.copy(acik = false), an(28), dilim))
    }

    @Test
    fun hicYedekYoksaZamaniGelir() {
        assertTrue(OtomatikYedekPlani.zamaniGeldiMi(acik, an(28), dilim))
    }

    @Test
    fun ayniGunIkinciYedekYokErtesiGunVar() {
        val d = acik.copy(sonBasariliMs = an(28, 0, 5))
        assertFalse(OtomatikYedekPlani.zamaniGeldiMi(d, an(28, 23, 59), dilim))
        assertTrue(OtomatikYedekPlani.zamaniGeldiMi(d, an(29, 0, 1), dilim))
        // Gün cihaz diliminde: İstanbul'da 23:30 ile 00:30 ayrı gün (UTC'de aynı gün).
        val gece = acik.copy(sonBasariliMs = an(28, 23, 30))
        assertTrue(OtomatikYedekPlani.zamaniGeldiMi(gece, an(29, 0, 30), dilim))
        assertFalse(OtomatikYedekPlani.zamaniGeldiMi(gece, an(29, 0, 30), ZoneId.of("UTC")))
    }

    @Test
    fun saatGeriAlindiysaYineYedeklenir() {
        val d = acik.copy(sonBasariliMs = an(30))
        assertTrue(OtomatikYedekPlani.zamaniGeldiMi(d, an(28), dilim))
    }

    @Test
    fun hataSonrasiBeklenir() {
        val h = an(28, 10)
        val d = acik.copy(sonHata = YedekSorunu.YAZILAMADI, sonHataMs = h)
        assertFalse(OtomatikYedekPlani.zamaniGeldiMi(d, h + 29 * dk, dilim))
        assertTrue(OtomatikYedekPlani.zamaniGeldiMi(d, h + 30 * dk, dilim))
        // Hata anı gelecekteyse (saat geri alındı) beklenmez.
        assertTrue(OtomatikYedekPlani.zamaniGeldiMi(d, h - 5 * dk, dilim))
    }

    // --- Ad ve temizlik -----------------------------------------------------------------------

    @Test
    fun dosyaAdiVeKalip() {
        val g = LocalDate.of(2026, 11, 28)
        assertEquals("ajanda-yedegi-2026-11-28.zip", OtomatikYedekPlani.dosyaAdi(g))
        assertEquals("ajanda-yedegi-2026-11-28.zip.yaziliyor", OtomatikYedekPlani.geciciAd(g))
        assertEquals(g, OtomatikYedekPlani.yedekGunu("ajanda-yedegi-2026-11-28.zip"))
        for (ad in listOf(
            "ajanda-yedegi-2026-11-28 (1).zip", "ajanda-yedegi-2026-02-30.zip", "ajanda-yedegi-2026-11-28.zip.bak",
            "AJANDA-YEDEGI-2026-11-28.zip", "eski-ajanda-yedegi-2026-11-28.zip", "ajanda-yedegi-26-11-28.zip", "notlar.txt",
        )) assertNull(ad, OtomatikYedekPlani.yedekGunu(ad))
        assertTrue(OtomatikYedekPlani.geciciMi("ajanda-yedegi-2026-11-28.zip.yaziliyor"))
        assertFalse(OtomatikYedekPlani.geciciMi("benim.yaziliyor"))
        assertFalse(OtomatikYedekPlani.geciciMi("ajanda-yedegi-2026-11-28.zip"))
    }

    @Test
    fun enYeniYediKalirBaskaDosyayaDokunulmaz() {
        val yedekler = (1..10).map { KlasorDosyasi(OtomatikYedekPlani.dosyaAdi(LocalDate.of(2026, 11, 18 + it)), "y$it") }
        val baska = listOf(
            KlasorDosyasi("ajanda-yedegi-2026-01-01 (1).zip", "b1"),
            KlasorDosyasi("fotograf.jpg", "b2"),
            KlasorDosyasi("ajanda-yedegi-2025-02-30.zip", "b3"),
        )
        val gecici = KlasorDosyasi("ajanda-yedegi-2026-11-20.zip.yaziliyor", "g1")
        val sil = OtomatikYedekPlani.silinecekler(baska + yedekler.shuffled(java.util.Random(3)) + gecici)
        assertEquals(setOf("g1", "y1", "y2", "y3"), sil.map { it.kimlik }.toSet())
        assertEquals(listOf("g1"), OtomatikYedekPlani.silinecekler(baska + yedekler.take(7) + gecici).map { it.kimlik })
    }

    // --- Deneme akışı (sahte klasör) -------------------------------------------------------------

    private val gizli = "Gizli doktor randevusu"
    private val bicim = AktarmaBicimi("ajanda.json", "ekler/", 1, 1024uL * 1024uL, 4096uL)

    private class SahteKaynak(var bicim: AktarmaBicimi, var disa: DisaAktarma) : YedekKaynagi {
        var hata: Exception? = null
        var cagri = 0
        override fun bicim() = bicim
        override fun disaAktar(): DisaAktarma {
            cagri++
            hata?.let { throw it }
            return disa
        }
    }

    private class SahteAyarlar(var d: YedekDurumu) : YedekAyarDeposu {
        override fun oku() = d
        override fun acikYap(acik: Boolean) { d = d.copy(acik = acik) }
        override fun klasorYap(klasor: String?) { d = d.copy(klasor = klasor, sonHata = null, sonHataMs = null) }
        override fun basarili(an: Long, dosya: String) { d = d.copy(sonBasariliMs = an, sonDosya = dosya, sonHata = null, sonHataMs = null) }
        override fun basarisiz(an: Long, sorun: YedekSorunu) { d = d.copy(sonHata = sorun, sonHataMs = an) }
    }

    private class ToplayanGunluk : Gunluk {
        val satirlar = mutableListOf<String>()
        override fun bilgi(mesaj: String) { satirlar += mesaj }
        override fun uyari(mesaj: String, hata: Throwable?) { satirlar += "$mesaj ${hata?.javaClass?.simpleName}" }
    }

    /** Bellekte klasör: sağlayıcı gibi çakışan ada ` (1)` ekler; hata ve destek ayarlanabilir. */
    private class SahteKlasor : YedekKlasoru {
        class Dosya(var ad: String, var veri: ByteArray = ByteArray(0))

        val dosyalar = LinkedHashMap<String, Dosya>()
        private var sayac = 0
        var erisim = true
        var adlandirmaVar = true
        var adlandirmaEkKoyar = false
        /** Yazılan bayt sayısı bunu geçince atılacak hata. */
        var yazmaHatasi: Pair<Int, IOException>? = null

        fun adlar() = dosyalar.values.map { it.ad }.sorted()
        fun ekle(ad: String, veri: ByteArray = byteArrayOf(1)) { dosyalar["d${sayac++}"] = Dosya(ad, veri) }
        fun veri(ad: String) = dosyalar.values.single { it.ad == ad }.veri

        private fun denetle() { if (!erisim) throw KlasorErisimiYok("izin yok") }

        private fun bosAd(ad: String): String {
            if (dosyalar.values.none { it.ad == ad }) return ad
            val nokta = ad.lastIndexOf('.')
            return if (nokta < 0) "$ad (1)" else ad.substring(0, nokta) + " (1)" + ad.substring(nokta)
        }

        override fun listele(): List<KlasorDosyasi> {
            denetle()
            return dosyalar.map { (k, d) -> KlasorDosyasi(d.ad, k) }
        }

        override fun olustur(ad: String, mime: String): KlasorDosyasi {
            denetle()
            val k = "d${sayac++}"
            dosyalar[k] = Dosya(bosAd(ad))
            return KlasorDosyasi(dosyalar.getValue(k).ad, k)
        }

        override fun yazmaAc(d: KlasorDosyasi): OutputStream {
            denetle()
            val hedef = dosyalar[d.kimlik] ?: throw IOException("yok")
            val tampon = ByteArrayOutputStream()
            val hata = yazmaHatasi
            return object : OutputStream() {
                override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
                override fun write(b: ByteArray, off: Int, len: Int) {
                    if (hata != null && tampon.size() + len > hata.first) throw hata.second
                    tampon.write(b, off, len)
                    hedef.veri = tampon.toByteArray()
                }
            }
        }

        override fun sil(d: KlasorDosyasi): Boolean = dosyalar.remove(d.kimlik) != null

        override fun yenidenAdlandir(d: KlasorDosyasi, yeniAd: String): KlasorDosyasi? {
            if (!adlandirmaVar) return null
            val f = dosyalar[d.kimlik] ?: return null
            f.ad = if (adlandirmaEkKoyar) "$yeniAd (1)" else bosAd(yeniAd)
            return KlasorDosyasi(f.ad, d.kimlik)
        }
    }

    private val kaynak = SahteKaynak(
        bicim,
        DisaAktarma("""{"bicim":"eren_ajanda_yedegi","kayitlar":[{"baslik":"$gizli"}]}""", 3, 0, 0, 0, CalismaKipi.YEREL, emptyList()),
    )
    private val klasor = SahteKlasor()
    private val ayarlar = SahteAyarlar(acik)
    private val gunluk = ToplayanGunluk()
    private var simdi = an(28, 9)
    private val yedekci = OtomatikYedekci(kaynak, { klasor }, ayarlar, { simdi }, { dilim }, gunluk)

    private val bugun = "ajanda-yedegi-2026-11-28.zip"

    private fun gecerliYedek(ad: String) {
        val o = YedekKabi.oku(ByteArrayInputStream(klasor.veri(ad)), bicim)
        assertTrue(o.belge.contains("eren_ajanda_yedegi"))
    }

    private fun temizGunluk() {
        gunluk.satirlar.forEach { assertFalse(it, it.contains(gizli)) }
    }

    @Test
    fun yedekYazarSonucuSaklar() {
        klasor.ekle("notlar.txt")
        val s = yedekci.gerekirseYedekle()
        assertEquals(YedekSonucu.Yapildi(bugun, 3, 0), s)
        assertEquals(listOf(bugun, "notlar.txt"), klasor.adlar())
        gecerliYedek(bugun)
        assertEquals(simdi, ayarlar.d.sonBasariliMs)
        assertEquals(bugun, ayarlar.d.sonDosya)
        assertNull(ayarlar.d.sonHata)
        temizGunluk()
    }

    @Test
    fun ayniGunIkinciCagriYazmaz() {
        yedekci.gerekirseYedekle()
        simdi = an(28, 22)
        assertEquals(YedekSonucu.Gerekmedi, yedekci.gerekirseYedekle())
        assertEquals(1, kaynak.cagri)
        simdi = an(29, 8)
        assertTrue(yedekci.gerekirseYedekle() is YedekSonucu.Yapildi)
        assertEquals(listOf(bugun, "ajanda-yedegi-2026-11-29.zip"), klasor.adlar())
    }

    @Test
    fun kapaliysaHicDokunmaz() {
        ayarlar.d = acik.copy(acik = false)
        assertEquals(YedekSonucu.Gerekmedi, yedekci.gerekirseYedekle())
        assertEquals(0, kaynak.cagri)
        assertTrue(klasor.dosyalar.isEmpty())
    }

    @Test
    fun yediYedekKalirKullaniciDosyasiKalir() {
        for (g in 15..27) klasor.ekle(OtomatikYedekPlani.dosyaAdi(LocalDate.of(2026, 11, g)))
        klasor.ekle("ajanda-yedegi-2026-11-01 (1).zip")
        klasor.ekle("tatil.pdf")
        val s = yedekci.gerekirseYedekle() as YedekSonucu.Yapildi
        assertEquals(7, s.silinen)
        val beklenen = (22..28).map { OtomatikYedekPlani.dosyaAdi(LocalDate.of(2026, 11, it)) } +
            listOf("ajanda-yedegi-2026-11-01 (1).zip", "tatil.pdf")
        assertEquals(beklenen.sorted(), klasor.adlar())
    }

    @Test
    fun simdiYedekleAyniGunYenisiniYazar() {
        yedekci.gerekirseYedekle()
        val ilk = klasor.veri(bugun).size
        kaynak.disa = kaynak.disa.copy(kayit = 4, belge = kaynak.disa.belge + " ")
        simdi = an(28, 15)
        assertEquals(YedekSonucu.Yapildi(bugun, 4, 0), yedekci.simdiYedekle())
        // Aynı ad yerinde: " (1)" yok.
        assertEquals(listOf(bugun), klasor.adlar())
        assertTrue(klasor.veri(bugun).size >= ilk)
        gecerliYedek(bugun)
    }

    @Test
    fun yarimKalanYazmaDosyaBirakmaz() {
        klasor.ekle("notlar.txt")
        klasor.yazmaHatasi = 10 to IOException("write failed: EIO (I/O error)")
        assertEquals(YedekSonucu.Basarisiz(YedekSorunu.YAZILAMADI), yedekci.gerekirseYedekle())
        assertEquals(listOf("notlar.txt"), klasor.adlar())
        assertEquals(YedekSorunu.YAZILAMADI, ayarlar.d.sonHata)
        assertEquals(simdi, ayarlar.d.sonHataMs)
        assertNull(ayarlar.d.sonBasariliMs)
        // Bekleme içinde yeniden denenmez; sonra denenir ve hata temizlenir.
        klasor.yazmaHatasi = null
        simdi += 10 * dk
        assertEquals(YedekSonucu.Gerekmedi, yedekci.gerekirseYedekle())
        simdi += 30 * dk
        assertTrue(yedekci.gerekirseYedekle() is YedekSonucu.Yapildi)
        assertNull(ayarlar.d.sonHata)
        temizGunluk()
    }

    @Test
    fun yerYoksaYerYokDenir() {
        klasor.yazmaHatasi = 0 to IOException("write failed", IOException("ENOSPC (No space left on device)"))
        assertEquals(YedekSonucu.Basarisiz(YedekSorunu.YER_YOK), yedekci.gerekirseYedekle())
        assertTrue(klasor.dosyalar.isEmpty())
    }

    @Test
    fun izinGeriAlindiysaErisimYok() {
        klasor.erisim = false
        assertEquals(YedekSonucu.Basarisiz(YedekSorunu.ERISIM_YOK), yedekci.gerekirseYedekle())
        assertEquals(0, kaynak.cagri)
        assertEquals(YedekSorunu.ERISIM_YOK, ayarlar.d.sonHata)
        assertEquals(YedekSorunu.ERISIM_YOK, OtomatikYedekci.sorunu(SecurityException("yol")))
    }

    @Test
    fun klasorSecilmediyseSoylenir() {
        ayarlar.d = YedekDurumu(acik = false)
        assertEquals(YedekSonucu.Basarisiz(YedekSorunu.KLASOR_YOK), yedekci.simdiYedekle())
    }

    @Test
    fun cekirdekHatasiDosyaOlusturmaz() {
        kaynak.hata = CekirdekHatasi.Depo("kilitli")
        assertEquals(YedekSonucu.Basarisiz(YedekSorunu.CEKIRDEK), yedekci.gerekirseYedekle())
        assertTrue(klasor.dosyalar.isEmpty())
    }

    @Test
    fun adlandirmaYoksaDogrudanYazilir() {
        klasor.adlandirmaVar = false
        assertEquals(YedekSonucu.Yapildi(bugun, 3, 0), yedekci.gerekirseYedekle())
        assertEquals(listOf(bugun), klasor.adlar())
        gecerliYedek(bugun)
    }

    @Test
    fun saglayiciBaskaAdVerirseArtikKalmaz() {
        klasor.adlandirmaEkKoyar = true
        assertEquals(YedekSonucu.Yapildi(bugun, 3, 0), yedekci.gerekirseYedekle())
        assertEquals(listOf(bugun), klasor.adlar())
        gecerliYedek(bugun)
    }

    @Test
    fun oncekiCokmeninGeciciDosyasiSilinir() {
        klasor.ekle("ajanda-yedegi-2026-11-27.zip.yaziliyor")
        klasor.ekle("ajanda-yedegi-2026-11-28.zip.yaziliyor")
        yedekci.gerekirseYedekle()
        assertEquals(listOf(bugun), klasor.adlar())
    }

    @Test
    fun hataSiniflari() {
        assertEquals(YedekSorunu.COK_BUYUK, OtomatikYedekci.sorunu(YedekHatasi.CokBuyuk()))
        assertEquals(YedekSorunu.EK_BOZUK, OtomatikYedekci.sorunu(YedekHatasi.EkBozuk("x")))
        assertEquals(YedekSorunu.YER_YOK, OtomatikYedekci.sorunu(IOException("write failed: ENOSPC (No space left on device)")))
        assertEquals(YedekSorunu.ERISIM_YOK, OtomatikYedekci.sorunu(KlasorErisimiYok("x")))
        assertEquals(YedekSorunu.YAZILAMADI, OtomatikYedekci.sorunu(IOException("x")))
        assertEquals(YedekSorunu.BEKLENMEYEN, OtomatikYedekci.sorunu(IllegalStateException("x")))
    }

    @Test
    fun metinlerTurkceVePcYok() {
        val m = OtomatikYedekMetinleri(dilim)
        val pc = Regex("\\bPC\\b")
        val hepsi = YedekSorunu.entries.map { m.sorun(it) } + listOf(
            m.baslik, m.aciklama, m.klasorSecilmedi,
            m.sonYedek(YedekDurumu()), m.sonYedek(acik.copy(sonBasariliMs = an(28, 9, 5))),
            m.sonHata(acik.copy(sonHata = YedekSorunu.YER_YOK, sonHataMs = an(28, 9))) ?: "",
            m.sonuc(YedekSonucu.Gerekmedi), m.sonuc(YedekSonucu.Yapildi(bugun, 3, 0)),
        )
        hepsi.forEach { assertFalse(it, pc.containsMatchIn(it)); assertTrue(it.isNotBlank()) }
        assertEquals("Son yedek: 28 Kasım 2026 09:05", m.sonYedek(acik.copy(sonBasariliMs = an(28, 9, 5))))
        assertNull(m.sonHata(acik))
        assertNotNull(m.sonHata(acik.copy(sonHata = YedekSorunu.ERISIM_YOK)))
        assertEquals(YedekSorunu.entries.size, YedekSorunu.entries.map { m.sorun(it) }.toSet().size)
    }
}
