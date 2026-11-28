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
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Otomatik yedek (D6): zaman kuralı ve geri çekilme, dosya adı ve sahiplik, temizlik, sahte klasörle deneme
 * akışı (geri okuyup doğrulama, yarım yazım), hatalar ve bildirim kuralları.
 */
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

    @Test
    fun ardisikHatadaBeklemeArtar() {
        assertEquals(30 * dk, OtomatikYedekPlani.bekleme(0))
        assertEquals(30 * dk, OtomatikYedekPlani.bekleme(1))
        assertEquals(60 * dk, OtomatikYedekPlani.bekleme(2))
        assertEquals(120 * dk, OtomatikYedekPlani.bekleme(3))
        assertEquals(240 * dk, OtomatikYedekPlani.bekleme(4))
        assertEquals(360 * dk, OtomatikYedekPlani.bekleme(5))
        assertEquals(360 * dk, OtomatikYedekPlani.bekleme(1000))
        val h = an(28, 10)
        val d = acik.copy(sonHata = YedekSorunu.BELLEK, sonHataMs = h, ardisikHata = 3)
        assertFalse(OtomatikYedekPlani.zamaniGeldiMi(d, h + 119 * dk, dilim))
        assertTrue(OtomatikYedekPlani.zamaniGeldiMi(d, h + 120 * dk, dilim))
    }

    /** Y10: iş saatte bir uyanmaz; bir sonraki gerekli ana kurulur. */
    @Test
    fun isBirSonrakiGerekliAnaKurulur() {
        val p = OtomatikYedekPlani
        assertNull(p.isGecikmesiMs(YedekDurumu(), an(28), dilim))
        assertNull(p.isGecikmesiMs(YedekDurumu(acik = true), an(28), dilim))
        // Zamanı geldi: en kısa gecikme.
        assertEquals(p.ASGARI_GECIKME_MS, p.isGecikmesiMs(acik, an(28, 9), dilim))
        // Bugün yedek alındı: yarının başına (cihaz diliminde).
        val bugunAlindi = acik.copy(sonBasariliMs = an(28, 9))
        assertEquals(an(29, 0) - an(28, 9), p.isGecikmesiMs(bugunAlindi, an(28, 9), dilim))
        // Hata beklemesi sürüyor: kalan süre.
        val hata = acik.copy(sonHata = YedekSorunu.BELLEK, sonHataMs = an(28, 10), ardisikHata = 3)
        assertEquals(90 * dk, p.isGecikmesiMs(hata, an(28, 10, 30), dilim))
        // Gecikme en çok bir gün (saat ya da dilim değişirse yeniden hesaplanır).
        val gelecek = acik.copy(sonBasariliMs = an(28, 9))
        assertTrue(p.isGecikmesiMs(gelecek, an(28, 0, 1), dilim)!! <= p.AZAMI_GECIKME_MS)
    }

    /** Y9: başka klasör seçilince o klasörün geçmişi yok; aynı klasörün yeniden seçimi yalnız hatayı siler. */
    @Test
    fun yeniKlasorSonYedegiSifirlar() {
        val d = acik.copy(
            sonBasariliMs = an(28, 9), sonDosya = "x", sonHata = YedekSorunu.ERISIM_YOK, sonHataMs = an(28, 10),
            ardisikHata = 2, hataBasiMs = an(28, 10), bildirilenSorun = YedekSorunu.ERISIM_YOK, sonRetDisarida = 3,
        )
        val yeni = d.klasorle("agac://baska")
        assertEquals(YedekDurumu(acik = true, klasor = "agac://baska"), yeni)
        assertTrue(OtomatikYedekPlani.zamaniGeldiMi(yeni, an(28, 11), dilim))
        val ayni = d.klasorle(d.klasor)
        assertEquals(an(28, 9), ayni.sonBasariliMs)
        assertNull(ayni.sonHata)
        assertEquals(0, ayni.ardisikHata)
        assertNull(ayni.bildirilenSorun)
    }

    @Test
    fun gunOnceCihazGunuyle() {
        val p = OtomatikYedekPlani
        assertNull(p.gunOnce(acik, an(28), dilim))
        assertEquals(0, p.gunOnce(acik.copy(sonBasariliMs = an(28, 0, 1)), an(28, 23, 59), dilim))
        assertEquals(1, p.gunOnce(acik.copy(sonBasariliMs = an(27, 23, 59)), an(28, 0, 1), dilim))
        assertEquals(9, p.gunOnce(acik.copy(sonBasariliMs = an(19, 12)), an(28, 8), dilim))
        // Saat geri alındı: eksi gün yok.
        assertEquals(0, p.gunOnce(acik.copy(sonBasariliMs = an(30)), an(28), dilim))
        val m = OtomatikYedekMetinleri(dilim)
        assertEquals("Son başarılı yedek bugün alındı.", m.gunOnce(0))
        assertEquals("Son başarılı yedek dün alındı.", m.gunOnce(1))
        assertEquals("Son başarılı yedek 9 gün önce alındı.", m.gunOnce(9))
        assertEquals("Henüz başarılı yedek yok.", m.gunOnce(null))
    }

    // --- Ad ve temizlik -----------------------------------------------------------------------

    private val kurulum = "0a1b2c3d"
    private val baskaKurulum = "ffff0000"
    private val bugunGun = LocalDate.of(2026, 11, 28)

    private fun ad(ms: Long, k: String = kurulum) = OtomatikYedekPlani.dosyaAdi(ms, dilim, k)

    @Test
    fun dosyaAdiVeKalip() {
        val p = OtomatikYedekPlani
        val a = an(28, 9, 5)
        assertEquals("ajanda-otomatik-yedek-2026-11-28-090500-0a1b2c3d.zip", ad(a))
        assertEquals(ad(a) + ".yaziliyor", p.geciciAd(ad(a)))
        assertEquals(LocalDateTime.of(2026, 11, 28, 9, 5, 0), p.yedekAni(ad(a), kurulum))
        // Elle dışa aktarmanın önerdiği ad otomatik kalıba hiç uymaz (Y1).
        assertNull(p.yedekAni(AktarmaAkisi.onerilenAd(bugunGun), kurulum))
        for (x in listOf(
            ad(a, baskaKurulum), ad(a).replace(".zip", " (1).zip"), "ajanda-otomatik-yedek-2026-02-30-090500-0a1b2c3d.zip",
            ad(a).uppercase(), "eski-" + ad(a), ad(a) + ".bak", "ajanda-yedegi-2026-11-28.zip", "notlar.txt",
            "ajanda-otomatik-yedek-2026-11-28-0905-0a1b2c3d.zip",
        )) assertNull(x, p.yedekAni(x, kurulum))
        // Geçici: sağlayıcının eklediği ekle de bu kurulumun geçicisi (Y9); başkasınınki değil.
        assertTrue(p.geciciMi(ad(a) + ".yaziliyor", kurulum))
        assertTrue(p.geciciMi(ad(a) + " (1).yaziliyor", kurulum))
        assertTrue(p.geciciMi(ad(a).replace(".zip", " (1).zip") + ".yaziliyor", kurulum))
        assertTrue(p.geciciMi(ad(a) + ".yaziliyor (1)", kurulum))
        assertFalse(p.geciciMi(ad(a, baskaKurulum) + ".yaziliyor", kurulum))
        assertFalse(p.geciciMi("ajanda-yedegi-2026-11-28.zip.yaziliyor", kurulum))
        assertFalse(p.geciciMi(ad(a), kurulum))
        assertFalse(p.geciciMi("benim.yaziliyor", kurulum))
        // Kurulum kimliği.
        assertTrue(p.kurulumGecerli(p.yeniKurulum(java.util.Random(1))))
        assertTrue(p.kurulumGecerli(p.yeniKurulum()))
        assertFalse(p.kurulumGecerli("0A1B2C3D"))
        assertFalse(p.kurulumGecerli("0a1b2c"))
        // Aynı saniyede yedek varsa saniye ilerler.
        assertEquals(ad(a + 1000), p.bosAd(a, dilim, kurulum, setOf(ad(a))))
        assertEquals(ad(a + 2000), p.bosAd(a, dilim, kurulum, setOf(ad(a), p.geciciAd(ad(a + 1000)))))
    }

    @Test
    fun gunBasinaEnYeniVeEnYeniYediGunKalirBaskasinaDokunulmaz() {
        val bizim = (1..10).map { KlasorDosyasi(ad(an(18 + it, 9)), "y$it") } // 19..28 Kasım
        val ayniGunEski = KlasorDosyasi(ad(an(28, 8)), "eski")
        val baska = listOf(
            KlasorDosyasi(ad(an(20, 9), baskaKurulum), "b0"),
            KlasorDosyasi("ajanda-yedegi-2026-01-01.zip", "b1"),
            KlasorDosyasi("fotograf.jpg", "b2"),
            KlasorDosyasi(ad(an(20, 9)).replace(".zip", " (1).zip"), "b3"),
            KlasorDosyasi(ad(an(20, 9), baskaKurulum) + ".yaziliyor", "b4"),
        )
        val gecici = KlasorDosyasi(ad(an(20, 9)) + ".yaziliyor", "g1")
        val hepsi = baska + (bizim + ayniGunEski).shuffled(java.util.Random(3)) + gecici
        val sil = OtomatikYedekPlani.silinecekler(hepsi, kurulum, bugunGun, koru = ad(an(28, 9)))
        assertEquals(setOf("g1", "y1", "y2", "y3", "eski"), sil.map { it.kimlik }.toSet())
        assertEquals(listOf("g1"), OtomatikYedekPlani.silinecekler(baska + bizim.takeLast(7) + gecici, kurulum, bugunGun).map { it.kimlik })
    }

    /** Y8: saat ileri gitmişken yazılmış geleceğe tarihli yedekler yeni yedeği sildirmez. */
    @Test
    fun gelecegeTarihliYedeklerYeniyiSildirmez() {
        val gelecek = (1..7).map { KlasorDosyasi(ad(an(it, 9, ay = 12)), "f$it") }
        val yeni = KlasorDosyasi(ad(an(28, 9)), "n")
        val sil = OtomatikYedekPlani.silinecekler(gelecek.shuffled(java.util.Random(5)) + yeni, kurulum, bugunGun, koru = yeni.ad)
        assertEquals(listOf("f1"), sil.map { it.kimlik })
        // Korunan verilmese bile bugünkü (gerçek) yedek geleceğe tarihlilerden önce gelir.
        assertEquals(listOf("f1"), OtomatikYedekPlani.silinecekler(gelecek + yeni, kurulum, bugunGun).map { it.kimlik })
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
        override fun degistir(f: (YedekDurumu) -> YedekDurumu) { d = f(d) }
    }

    private class SahteBildirici : YedekBildiricisi {
        var izin = true
        val gosterilen = mutableListOf<Pair<String, String>>()
        var kaldirilan = 0
        override fun goster(baslik: String, metin: String): Boolean {
            if (!izin) return false
            gosterilen += baslik to metin
            return true
        }
        override fun kaldir() { kaldirilan++ }
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
        /** Yazılan bayt sayısı bunu geçince atılacak hata ([hataliAd]'a uyan dosyada). */
        var yazmaHatasi: Pair<Int, IOException>? = null
        var hataliAd: (String) -> Boolean = { true }
        /** Bu bayttan sonrası sessizce düşer (sağlayıcı dosyayı kesik yazdı). */
        var sessizKes: Int? = null
        /** Geri okumada bu konumdaki bayt bozulur (sağlayıcı bozuk döndürdü). */
        var okurkenBoz: Int? = null
        /** Bir dosya yazmaya açılınca (adıyla). */
        var yazmaAcildi: (String) -> Unit = {}
        /**
         * Drive benzeri: yeniden adlandırmada kimlik korunur, ama yeniden adlandırmadan sonraki ilk liste önbellekten
         * gelir (dosya eski adıyla görünür).
         */
        var listeOnbellekli = false
        private val bayatAdlar = HashMap<String, String>()

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
            return dosyalar.map { (k, d) -> KlasorDosyasi(bayatAdlar[k] ?: d.ad, k) }.also { bayatAdlar.clear() }
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
            yazmaAcildi(hedef.ad)
            val tampon = ByteArrayOutputStream()
            val hata = yazmaHatasi?.takeIf { hataliAd(hedef.ad) }
            val kes = sessizKes
            return object : OutputStream() {
                override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
                override fun write(b: ByteArray, off: Int, len: Int) {
                    if (hata != null && tampon.size() + len > hata.first) throw hata.second
                    tampon.write(b, off, len)
                    val v = tampon.toByteArray()
                    hedef.veri = if (kes != null && v.size > kes) v.copyOf(kes) else v
                }
            }
        }

        override fun okumaAc(d: KlasorDosyasi): java.io.InputStream {
            denetle()
            val v = (dosyalar[d.kimlik] ?: throw IOException("yok")).veri.copyOf()
            okurkenBoz?.let { i -> if (i < v.size) v[i] = (v[i].toInt() xor 0x5a).toByte() }
            return ByteArrayInputStream(v)
        }

        override fun sil(d: KlasorDosyasi): Boolean = dosyalar.remove(d.kimlik) != null

        override fun yenidenAdlandir(d: KlasorDosyasi, yeniAd: String): KlasorDosyasi? {
            if (!adlandirmaVar) return null
            val f = dosyalar[d.kimlik] ?: return null
            if (listeOnbellekli) bayatAdlar[d.kimlik] = f.ad
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
    private val bildirici = SahteBildirici()
    private var simdi = an(28, 9)
    private val yedekci = OtomatikYedekci(kaynak, { klasor }, ayarlar, { simdi }, { dilim }, gunluk, { kurulum }, bildirici)

    /** 28 Kasım 09:00'daki yedeğin adı (testlerin çoğu bu anda başlar). */
    private val bugun = "ajanda-otomatik-yedek-2026-11-28-090000-0a1b2c3d.zip"

    private fun gecerliYedek(ad: String) {
        val o = YedekKabi.oku(ByteArrayInputStream(klasor.veri(ad)), bicim)
        assertTrue(o.belge.contains("eren_ajanda_yedegi"))
    }

    /** Klasördeki bu kurulumun yedekleri (ad sırasıyla). */
    private fun bizimkiler(k: String = kurulum) = klasor.adlar().filter { OtomatikYedekPlani.yedekAni(it, k) != null }

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
        assertEquals(listOf(bugun, ad(an(29, 8))), klasor.adlar())
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
        for (g in 15..27) klasor.ekle(ad(an(g, 9)))
        klasor.ekle("ajanda-yedegi-2026-11-01 (1).zip")
        klasor.ekle("tatil.pdf")
        val s = yedekci.gerekirseYedekle() as YedekSonucu.Yapildi
        assertEquals(7, s.silinen)
        val beklenen = (22..28).map { ad(an(it, 9)) } + listOf("ajanda-yedegi-2026-11-01 (1).zip", "tatil.pdf")
        assertEquals(beklenen.sorted(), klasor.adlar())
    }

    @Test
    fun simdiYedekleAyniGunYenisiniYazarEskisiniSonraSiler() {
        yedekci.gerekirseYedekle()
        kaynak.disa = kaynak.disa.copy(kayit = 4, belge = kaynak.disa.belge + " ")
        simdi = an(28, 15)
        val ikinci = ad(an(28, 15))
        assertEquals(YedekSonucu.Yapildi(ikinci, 4, 1), yedekci.simdiYedekle())
        // Yeni ad; " (1)" yok, sabahki ancak yenisi doğrulandıktan sonra silindi.
        assertEquals(listOf(ikinci), klasor.adlar())
        gecerliYedek(ikinci)
    }

    /** Y6: aynı günün sağlam dosyası, yenisi yazılıp doğrulanmadan silinmez. */
    @Test
    fun ayniGununSaglamDosyasiYenisiOlmadanSilinmez() {
        yedekci.gerekirseYedekle()
        val sabah = klasor.veri(bugun).copyOf()
        simdi = an(28, 15)
        klasor.yazmaHatasi = 10 to IOException("write failed: EIO (I/O error)")
        assertEquals(YedekSonucu.Basarisiz(YedekSorunu.YAZILAMADI), yedekci.simdiYedekle())
        assertEquals(listOf(bugun), klasor.adlar())
        assertTrue(sabah.contentEquals(klasor.veri(bugun)))
        gecerliYedek(bugun)
        // Bugünün başarısı silinmedi: ertesi güne dek yeni deneme gerekmez, sabahki yedek yerinde.
        assertEquals(an(28, 9), ayarlar.d.sonBasariliMs)
    }

    /** Y6: yazılan dosya geri okunup doğrulanır; kesik yazılmışsa silinir ve yedek sayılmaz. */
    @Test
    fun kesikYazilanDosyaDogrulanamazVeSilinir() {
        klasor.ekle("notlar.txt")
        klasor.sessizKes = 40
        assertEquals(YedekSonucu.Basarisiz(YedekSorunu.DOGRULANAMADI), yedekci.gerekirseYedekle())
        assertEquals(listOf("notlar.txt"), klasor.adlar())
        assertEquals(YedekSorunu.DOGRULANAMADI, ayarlar.d.sonHata)
        assertNull(ayarlar.d.sonBasariliMs)
        // Bozuk içerik (sıkıştırılmış veride bir bayt; CRC ya da açma tutmaz) de yakalanır.
        klasor.sessizKes = null
        klasor.okurkenBoz = 45
        simdi += 30 * dk
        assertEquals(YedekSonucu.Basarisiz(YedekSorunu.DOGRULANAMADI), yedekci.gerekirseYedekle())
        assertEquals(listOf("notlar.txt"), klasor.adlar())
        klasor.okurkenBoz = null
        simdi += 60 * dk
        assertTrue(yedekci.gerekirseYedekle() is YedekSonucu.Yapildi)
        assertEquals(1, bizimkiler().size)
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
    fun oncekiCokmeninGeciciDosyasiSilinirBaskasininKalir() {
        klasor.ekle(ad(an(27, 9)) + ".yaziliyor")
        klasor.ekle(ad(an(28, 8)) + " (1).yaziliyor")
        val baskasinin = ad(an(28, 8), baskaKurulum) + ".yaziliyor"
        klasor.ekle(baskasinin)
        klasor.ekle("ajanda-yedegi-2026-11-28.zip.yaziliyor")
        yedekci.gerekirseYedekle()
        assertEquals(listOf("ajanda-yedegi-2026-11-28.zip.yaziliyor", bugun, baskasinin).sorted(), klasor.adlar())
    }

    /** Y6: adlandırmasız sağlayıcıda sağlam geçici, son ada yazılan doğrulanana dek kalır; iz tutulur. */
    @Test
    fun adlandirmaYoksaGeciciSonYazimDogrulanincaSilinir() {
        klasor.adlandirmaVar = false
        val gorulen = mutableListOf<Pair<String, String?>>()
        klasor.yazmaAcildi = { ad -> gorulen += ad to ayarlar.d.yarimYazim }
        assertEquals(YedekSonucu.Yapildi(bugun, 3, 0), yedekci.gerekirseYedekle())
        // Son ada yazmaya başlarken iz vardı, geçici hâlâ klasördeydi.
        assertEquals(listOf(OtomatikYedekPlani.geciciAd(bugun) to null, bugun to bugun), gorulen)
        assertNull(ayarlar.d.yarimYazim)
        assertEquals(listOf(bugun), klasor.adlar())
        gecerliYedek(bugun)
    }

    /** Y6: son ada doğrudan yazım yarıda kalırsa (hata) sağlam geçici durur, yarım son dosya kalmaz. */
    @Test
    fun adlandirmaYoksaSonYazimHatasiYarimDosyaBirakmaz() {
        klasor.adlandirmaVar = false
        klasor.yazmaHatasi = 10 to IOException("write failed: EIO (I/O error)")
        klasor.hataliAd = { !it.endsWith(OtomatikYedekPlani.GECICI_EK) }
        assertEquals(YedekSonucu.Basarisiz(YedekSorunu.YAZILAMADI), yedekci.gerekirseYedekle())
        assertEquals(listOf(OtomatikYedekPlani.geciciAd(bugun)), klasor.adlar())
        assertTrue(bizimkiler().isEmpty())
        // Sonraki deneme artık geçiciyi temizler ve yazar.
        klasor.yazmaHatasi = null
        simdi += 30 * dk
        val s = yedekci.gerekirseYedekle() as YedekSonucu.Yapildi
        assertEquals(listOf(s.dosya), klasor.adlar())
        assertNull(ayarlar.d.yarimYazim)
    }

    /** Y6: süreç son ada yazarken öldüyse (iz kaldı) sonraki deneme o yarım dosyayı siler; yedek sayılmaz. */
    @Test
    fun surecOlunceYarimKalanSonDosyaSilinir() {
        val yarim = ad(an(27, 9))
        klasor.ekle(yarim, byteArrayOf(0x50, 0x4b))
        klasor.ekle(OtomatikYedekPlani.geciciAd(yarim))
        val elle = "ajanda-yedegi-2026-11-27.zip"
        klasor.ekle(elle)
        ayarlar.d = acik.copy(yarimYazim = yarim)
        assertEquals(YedekSonucu.Yapildi(bugun, 3, 0), yedekci.gerekirseYedekle())
        assertEquals(listOf(elle, bugun).sorted(), klasor.adlar())
        assertNull(ayarlar.d.yarimYazim)
        // İz başka kurulumun adını gösterse (bozuk tercih) ona dokunulmaz.
        val baskasinin = ad(an(26, 9), baskaKurulum)
        klasor.ekle(baskasinin)
        ayarlar.d = ayarlar.d.copy(yarimYazim = baskasinin)
        simdi = an(29, 9)
        yedekci.gerekirseYedekle()
        assertTrue(baskasinin in klasor.adlar())
        assertNull(ayarlar.d.yarimYazim)
    }

    /** Y8: geleceğe tarihli yedekler varken yeni yedek yazılır ve kalır; en eski gelecek tarihli düşer. */
    @Test
    fun saatDuzelinceYeniYedekKalir() {
        for (g in 1..7) klasor.ekle(ad(an(g, 9, ay = 12)))
        val s = yedekci.gerekirseYedekle() as YedekSonucu.Yapildi
        assertEquals(1, s.silinen)
        assertTrue(bugun in klasor.adlar())
        assertFalse(ad(an(1, 9, ay = 12)) in klasor.adlar())
        assertEquals(7, bizimkiler().size)
    }

    /** Y10: geri çekilme sürerken arka plan denemesi belgeyi yeniden üretmez. */
    @Test
    fun geriCekilmeSurerkenBelgeUretilmez() {
        kaynak.hata = CekirdekHatasi.Depo("kilitli")
        assertTrue(yedekci.gerekirseYedekle() is YedekSonucu.Basarisiz)
        simdi += 30 * dk
        assertTrue(yedekci.gerekirseYedekle() is YedekSonucu.Basarisiz)
        assertEquals(2, ayarlar.d.ardisikHata)
        simdi += 59 * dk
        assertEquals(YedekSonucu.Gerekmedi, yedekci.gerekirseYedekle())
        assertEquals(2, kaynak.cagri)
        simdi += 1 * dk
        assertTrue(yedekci.gerekirseYedekle() is YedekSonucu.Basarisiz)
        assertEquals(3, kaynak.cagri)
        kaynak.hata = null
        simdi += 120 * dk
        assertTrue(yedekci.gerekirseYedekle() is YedekSonucu.Yapildi)
        assertEquals(0, ayarlar.d.ardisikHata)
        assertNull(ayarlar.d.hataBasiMs)
    }

    // --- Y1: kullanıcının ya da başka kurulumun dosyalarına dokunulmaz ------------------------------

    /** Senaryo 1: İndirilenler'de önceki aylardan varsayılan adlı elle yedekler. */
    @Test
    fun elleAlinmisEskiYedeklerSilinmez() {
        val elle = (1..11).map { "ajanda-yedegi-2026-${"%02d".format(it)}-15.zip" } +
            listOf("ajanda-yedegi-2026-11-27.zip", "ajanda-yedegi-2026-11-27 (1).zip")
        elle.forEachIndexed { i, a -> klasor.ekle(a, byteArrayOf(i.toByte(), 7)) }
        val s = yedekci.gerekirseYedekle() as YedekSonucu.Yapildi
        assertEquals(0, s.silinen)
        // On gün daha: yalnız bu kurulumun yedekleri yediye iner.
        for (g in 29..30) { simdi = an(g, 9); yedekci.gerekirseYedekle() }
        for (g in 1..8) { simdi = an(g, 9, ay = 12); yedekci.gerekirseYedekle() }
        assertEquals(7, bizimkiler().size)
        elle.forEachIndexed { i, a -> assertTrue(a, byteArrayOf(i.toByte(), 7).contentEquals(klasor.veri(a))) }
    }

    /** Senaryo 2: aynı gün elle alınmış "riskli işlemden önceki" yedek ezilmez, silinmez. */
    @Test
    fun ayniGunElleAlinanYedekEzilmez() {
        val elle = AktarmaAkisi.onerilenAd(bugunGun)
        val oncesi = byteArrayOf(9, 9, 9)
        klasor.ekle(elle, oncesi)
        assertTrue(yedekci.gerekirseYedekle() is YedekSonucu.Yapildi)
        simdi = an(28, 15)
        assertTrue(yedekci.simdiYedekle() is YedekSonucu.Yapildi)
        simdi = an(28, 15, 0) + 500
        assertTrue(yedekci.simdiYedekle() is YedekSonucu.Yapildi)
        assertTrue(oncesi.contentEquals(klasor.veri(elle)))
        assertEquals(listOf(elle, ad(an(28, 15) + 1000)).sorted(), klasor.adlar())
    }

    /** Senaryo 3: aynı klasörü kullanan iki telefon birbirinin yedeğini (ve yazılmakta olanını) silmez. */
    @Test
    fun ikiTelefonBirbirininYedeginiSilmez() {
        val ayarB = SahteAyarlar(acik)
        val b = OtomatikYedekci(kaynak, { klasor }, ayarB, { simdi }, { dilim }, gunluk, { baskaKurulum })
        for (g in 15..28) {
            // B'nin yarıda kalmış (ya da o an yazılmakta olan) geçicisi A'nın denemesinde durur.
            val bGecici = ad(an(g, 8), baskaKurulum) + ".yaziliyor"
            klasor.ekle(bGecici)
            simdi = an(g, 9)
            assertTrue(yedekci.gerekirseYedekle() is YedekSonucu.Yapildi)
            assertTrue(bGecici in klasor.adlar())
            simdi = an(g, 9, 30)
            assertTrue(b.gerekirseYedekle() is YedekSonucu.Yapildi)
            // Kendi artık geçicisini B temizler.
            assertFalse(bGecici in klasor.adlar())
        }
        assertEquals((22..28).map { ad(an(it, 9)) }, bizimkiler())
        assertEquals((22..28).map { ad(an(it, 9, 30), baskaKurulum) }, bizimkiler(baskaKurulum))
        assertEquals(14, klasor.adlar().size)
    }

    // --- Y4 ve Y5: uyarılar ve bildirim ------------------------------------------------------------

    @Test
    fun yedegeGirmeyenRetSonuctaVeDurumda() {
        kaynak.disa = kaynak.disa.copy(retListesinde = 2)
        val s = yedekci.gerekirseYedekle() as YedekSonucu.Yapildi
        assertEquals(2, s.retDisarida)
        assertEquals(2, ayarlar.d.sonRetDisarida)
        val m = OtomatikYedekMetinleri(dilim)
        val beklenen = "Gönderilemeyenler listesindeki 2 değişiklik yedeğe girmedi; önce onları düzeltin ya da atın."
        assertTrue(m.sonuc(s).contains(beklenen))
        assertEquals(listOf(beklenen), m.uyarilar(ayarlar.d))
        // Ret kalmadıysa uyarı kalkar.
        kaynak.disa = kaynak.disa.copy(retListesinde = 0)
        simdi = an(29, 9)
        yedekci.gerekirseYedekle()
        assertTrue(m.uyarilar(ayarlar.d).isEmpty())
        assertTrue(bildirici.gosterilen.isEmpty())
    }

    @Test
    fun kaliciSorunBirKezBildirilirBasariIleSifirlanir() {
        klasor.erisim = false
        yedekci.gerekirseYedekle()
        assertEquals(1, bildirici.gosterilen.size)
        assertEquals("Otomatik yedek alınamıyor", bildirici.gosterilen[0].first)
        assertTrue(bildirici.gosterilen[0].second.contains("Klasörü yeniden seçin"))
        assertEquals(YedekSorunu.ERISIM_YOK, ayarlar.d.bildirilenSorun)
        for (i in 1..5) { simdi += 6 * 60 * dk; yedekci.gerekirseYedekle() }
        assertEquals(1, bildirici.gosterilen.size)
        assertNull(OtomatikYedekPlani.soylenecek(ayarlar.d, simdi))
        // Başka bir sorun yeniden bildirilir.
        klasor.erisim = true
        klasor.yazmaHatasi = 0 to IOException("write failed", IOException("ENOSPC (No space left on device)"))
        simdi += 6 * 60 * dk
        yedekci.gerekirseYedekle()
        assertEquals(2, bildirici.gosterilen.size)
        // Başarı bildirimi kaldırır, durumu sıfırlar; yeni dizide aynı sorun yeniden bildirilir.
        klasor.yazmaHatasi = null
        simdi = an(30, 9)
        assertTrue(yedekci.gerekirseYedekle() is YedekSonucu.Yapildi)
        assertEquals(1, bildirici.kaldirilan)
        assertNull(ayarlar.d.bildirilenSorun)
        klasor.erisim = false
        simdi = an(1, 9, ay = 12)
        yedekci.gerekirseYedekle()
        assertEquals(3, bildirici.gosterilen.size)
        assertTrue(bildirici.gosterilen[2].second.contains("Son başarılı yedek dün alındı."))
    }

    @Test
    fun izinYoksaSessizAtlanirDurumSaklanir() {
        bildirici.izin = false
        klasor.erisim = false
        yedekci.gerekirseYedekle()
        assertTrue(bildirici.gosterilen.isEmpty())
        assertNull(ayarlar.d.bildirilenSorun)
        // Uygulama açılınca gösterilecek.
        val b = OtomatikYedekPlani.soylenecek(ayarlar.d, simdi)
        assertEquals(YedekBildirimi.Sorun(YedekSorunu.ERISIM_YOK), b)
        ayarlar.d = ayarlar.d.bildirildi(b!!)
        assertNull(OtomatikYedekPlani.soylenecek(ayarlar.d, simdi))
        // İzin sonradan verilse de söylenen yinelenmez.
        bildirici.izin = true
        simdi += 60 * dk
        yedekci.gerekirseYedekle()
        assertTrue(bildirici.gosterilen.isEmpty())
    }

    @Test
    fun geciciSorunBirGunSurerseBildirilir() {
        kaynak.hata = CekirdekHatasi.Depo("kilitli")
        val ilk = simdi
        while (simdi - ilk < 24 * 60 * dk) {
            yedekci.gerekirseYedekle()
            if (simdi - (ayarlar.d.hataBasiMs ?: simdi) < OtomatikYedekPlani.GECICI_BILDIRIM_ESIGI_MS) {
                assertTrue(bildirici.gosterilen.isEmpty())
            }
            simdi += 30 * dk
        }
        yedekci.gerekirseYedekle()
        simdi += 6 * 60 * dk
        yedekci.gerekirseYedekle()
        assertEquals(1, bildirici.gosterilen.size)
        assertEquals(YedekSorunu.CEKIRDEK, ayarlar.d.bildirilenSorun)
    }

    @Test
    fun icerAktarmaSiniriBirKezSoylenir() {
        kaynak.disa = kaynak.disa.copy(iceAktarmaSiniriniAsiyor = true)
        val s = yedekci.gerekirseYedekle() as YedekSonucu.Yapildi
        assertTrue(s.sinirAsiyor)
        val m = OtomatikYedekMetinleri(dilim)
        assertTrue(m.sonuc(s).contains("geri yüklenemez"))
        assertTrue(m.uyarilar(ayarlar.d).single().contains("geri yüklenemez"))
        assertEquals(listOf("Yedek geri yüklenemeyecek kadar büyük"), bildirici.gosterilen.map { it.first })
        simdi = an(29, 9)
        yedekci.gerekirseYedekle()
        assertEquals(1, bildirici.gosterilen.size)
        // Sınırın altına inince sıfırlanır, yeniden aşınca yeniden söylenir.
        kaynak.disa = kaynak.disa.copy(iceAktarmaSiniriniAsiyor = false)
        simdi = an(30, 9)
        yedekci.gerekirseYedekle()
        assertFalse(ayarlar.d.sinirBildirildi)
        kaynak.disa = kaynak.disa.copy(iceAktarmaSiniriniAsiyor = true)
        simdi = an(1, 9, ay = 12)
        yedekci.gerekirseYedekle()
        assertEquals(2, bildirici.gosterilen.size)
    }

    @Test
    fun icerAktarmaSiniriniAsanBelgeYineYazilir() {
        // Y2: belge içe aktarma sınırını (sahte biçimde 1 MiB) aşıyor. Eskiden `YedekKabi.yaz` "çok büyük" atardı,
        // otomatik yedek COK_BUYUK dönerdi ve veri yalnız telefonda kalırdı. Şimdi yazılır, geri okunup doğrulanır,
        // sınır uyarısı söylenir.
        val iri = """{"bicim":"eren_ajanda_yedegi","kayitlar":[""" + "x".repeat(bicim.belgeAzamiBayt.toInt() + 512 * 1024) + "]}"
        kaynak.disa = kaynak.disa.copy(belge = iri, iceAktarmaSiniriniAsiyor = true)
        val s = yedekci.gerekirseYedekle()
        assertTrue("$s", s is YedekSonucu.Yapildi)
        assertTrue((s as YedekSonucu.Yapildi).sinirAsiyor)
        assertNull(ayarlar.d.sonHata)
        assertTrue(ayarlar.d.sonSinirAsiyor)
        assertEquals(listOf("Yedek geri yüklenemeyecek kadar büyük"), bildirici.gosterilen.map { it.first })
        // Dosya tam: belge girdisi birebir (bu sürüm onu içe aktaramaz; sınır okurken uygulanır).
        val z = java.util.zip.ZipInputStream(ByteArrayInputStream(klasor.veri(bugun)))
        assertEquals(bicim.belgeAdi, z.nextEntry!!.name)
        assertEquals(iri, String(z.readBytes(), Charsets.UTF_8))
        try {
            YedekKabi.oku(ByteArrayInputStream(klasor.veri(bugun)), bicim)
            org.junit.Assert.fail("çok büyük bekleniyordu")
        } catch (_: YedekHatasi.CokBuyuk) {
        }
    }

    @Test
    fun simdiYedekleSonucuSoylenmisSayilir() {
        klasor.erisim = false
        assertEquals(YedekSonucu.Basarisiz(YedekSorunu.ERISIM_YOK), yedekci.simdiYedekle())
        assertTrue(bildirici.gosterilen.isEmpty())
        assertEquals(YedekSorunu.ERISIM_YOK, ayarlar.d.bildirilenSorun)
        simdi += 60 * dk
        yedekci.gerekirseYedekle()
        assertTrue(bildirici.gosterilen.isEmpty())
    }

    @Test
    fun kapaliykenSoylenecekYok() {
        val d = YedekDurumu(acik = false, klasor = "agac://yedek", sonHata = YedekSorunu.ERISIM_YOK, sonHataMs = an(28))
        assertNull(OtomatikYedekPlani.soylenecek(d, an(28)))
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
        // Yeni uyarılar ve bildirimler.
        val yeni = listOf(
            m.sonuc(YedekSonucu.Yapildi(bugun, 3, 0, bellekAsiyor = true, eskiSurumAcamaz = true)),
            m.bildirim(YedekBildirimi.BellekAsiyor, 0).first, m.bildirim(YedekBildirimi.BellekAsiyor, 0).second,
        ) + m.uyarilar(acik.copy(sonBasariliMs = 1, sonBellekAsiyor = true))
        yeni.forEach { assertFalse(it, pc.containsMatchIn(it)); assertTrue(it.isNotBlank()) }
    }

    // --- T3: silinen yedek işi yeniden kurulur (ekrana bağlı değil) ---------------------------------

    private class SahtePlanlayici : YedekIsPlanlayici {
        var is_: KuruluYedekIsi? = null
        val kurulan = mutableListOf<Long>()
        var kaldirilan = 0
        override fun kurulu() = is_
        override fun kur(gecikmeMs: Long) {
            kurulan += gecikmeMs
            is_ = KuruluYedekIsi(periyodik = false, kalici = true)
        }
        override fun kaldir() {
            kaldirilan++
            is_ = null
        }
    }

    /**
     * T3: zorla durdurma ya da pil yöneticisi işi siler; [YedekIsDenetcisi.denetle] (uygulama açılışı, eşitleme
     * işi, açılış alıcısı) onu kurar, kurulu olana dokunmaz, çalışanı durdurmaz.
     */
    @Test
    fun silinenYedekIsiDenetimdeYenidenKurulur() {
        val p = SahtePlanlayici()
        var calisiyor = false
        var yazilamadi = false
        val d = YedekIsDenetcisi(ayarlar, p, { simdi }, { dilim }, { calisiyor }, { yazilamadi })
        // Açık, iş yok (silindi): kurulur; zamanı gelmişse en kısa gecikmeyle.
        d.denetle()
        assertEquals(listOf(OtomatikYedekPlani.ASGARI_GECIKME_MS), p.kurulan)
        // Kurulu tek seferlik kalıcı iş: zamanlamasına dokunulmaz (her açılışta çağrılır).
        repeat(3) { d.denetle() }
        assertEquals(1, p.kurulan.size)
        // Eski sürümün periyodik işi ya da kalıcı olmayan iş tek seferlik kalıcıya çevrilir.
        p.is_ = KuruluYedekIsi(periyodik = true, kalici = true)
        d.denetle()
        p.is_ = KuruluYedekIsi(periyodik = false, kalici = false)
        d.denetle()
        assertEquals(3, p.kurulan.size)
        // Çalışan işe dokunulmaz (yeniden kurmak onu durdururdu); bitince sonrakiniKur kurar.
        p.is_ = null
        calisiyor = true
        d.denetle()
        d.yenidenKur()
        assertEquals(3, p.kurulan.size)
        d.sonrakiniKur()
        assertEquals(4, p.kurulan.size)
        calisiyor = false
        // Bugün yedek alındıysa yarının başına.
        ayarlar.d = acik.copy(sonBasariliMs = an(28, 8))
        p.is_ = null
        d.denetle()
        assertEquals(an(29, 0) - simdi, p.kurulan.last())
        // k2: ayar diske yazılamadıysa en az 6 saat (soğuk süreç her dakika denemesin).
        ayarlar.d = acik.copy(sonHata = YedekSorunu.YER_YOK, sonHataMs = simdi, ardisikHata = 1)
        d.yenidenKur()
        assertEquals(30 * dk, p.kurulan.last())
        yazilamadi = true
        d.yenidenKur()
        assertEquals(OtomatikYedekPlani.AYAR_YAZILAMADI_BEKLEMESI_MS, p.kurulan.last())
        assertEquals(6 * 60 * dk, OtomatikYedekPlani.isGecikmesiMs(acik, simdi, dilim, ayarYazilamadi = true))
        // Kapalıyken denetim dokunmaz; ayar değişince kaldırılır; klasörsüz açık iş de kaldırılır.
        ayarlar.d = acik.copy(acik = false)
        val n = p.kurulan.size
        d.denetle()
        assertEquals(n, p.kurulan.size)
        assertEquals(0, p.kaldirilan)
        d.yenidenKur()
        assertEquals(1, p.kaldirilan)
        ayarlar.d = YedekDurumu(acik = true)
        d.denetle()
        assertEquals(n, p.kurulan.size)
        assertEquals(2, p.kaldirilan)
    }

    // --- k2: ayar yazılamazsa çağıran öğrenir ------------------------------------------------------

    /** Bellekte `SharedPreferences`: platformunki gibi `commit` başarısız olsa da bellekteki değer değişir. */
    private class SahteTercihler : android.content.SharedPreferences {
        val m = HashMap<String, Any?>()
        var commitSonucu = true

        override fun getAll(): MutableMap<String, *> = m
        override fun getString(key: String?, defValue: String?): String? = m[key] as String? ?: defValue
        override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? = defValues
        override fun getInt(key: String?, defValue: Int): Int = m[key] as Int? ?: defValue
        override fun getLong(key: String?, defValue: Long): Long = m[key] as Long? ?: defValue
        override fun getFloat(key: String?, defValue: Float): Float = defValue
        override fun getBoolean(key: String?, defValue: Boolean): Boolean = m[key] as Boolean? ?: defValue
        override fun contains(key: String?): Boolean = key in m
        override fun registerOnSharedPreferenceChangeListener(l: android.content.SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
        override fun unregisterOnSharedPreferenceChangeListener(l: android.content.SharedPreferences.OnSharedPreferenceChangeListener?) = Unit

        override fun edit(): android.content.SharedPreferences.Editor = object : android.content.SharedPreferences.Editor {
            private val degisen = HashMap<String, Any?>()
            private val silinen = HashSet<String>()
            private fun koy(k: String?, v: Any?) = apply { degisen[k!!] = v }
            override fun putString(key: String?, value: String?) = koy(key, value)
            override fun putStringSet(key: String?, values: MutableSet<String>?) = koy(key, values)
            override fun putInt(key: String?, value: Int) = koy(key, value)
            override fun putLong(key: String?, value: Long) = koy(key, value)
            override fun putFloat(key: String?, value: Float) = koy(key, value)
            override fun putBoolean(key: String?, value: Boolean) = koy(key, value)
            override fun remove(key: String?) = apply { silinen += key!! }
            override fun clear() = apply { silinen += m.keys }
            override fun commit(): Boolean {
                apply()
                return commitSonucu
            }
            override fun apply() {
                silinen.forEach { m.remove(it) }
                m.putAll(degisen)
            }
        }
    }

    @Test
    fun ayarYazilamazsaCagiranOgrenirIsGeciktirilir() {
        val t = SahteTercihler()
        val a = TercihYedekAyarlari(t)
        val d = acik.copy(sonBasariliMs = an(27), sonDosya = bugun, sonBellekAsiyor = true, bellekBildirildi = true)
        a.degistir { d }
        assertEquals(d, a.oku())
        assertFalse(TercihYedekAyarlari.sonYazimBasarisiz)
        t.commitSonucu = false
        try {
            a.degistir { it.copy(ardisikHata = 2) }
            org.junit.Assert.fail("IOException bekleniyordu")
        } catch (_: IOException) {
        }
        assertTrue(TercihYedekAyarlari.sonYazimBasarisiz)
        // Deneme sonucu saklanamasa da yedek sonucu döner; günlüğe yazılır.
        val y = OtomatikYedekci(kaynak, { klasor }, a, { simdi }, { dilim }, gunluk, { kurulum }, bildirici)
        assertTrue(y.simdiYedekle() is YedekSonucu.Yapildi)
        assertTrue(gunluk.satirlar.any { it.startsWith("yedek sonucu saklanamadı") })
        t.commitSonucu = true
        a.degistir { it }
        assertFalse(TercihYedekAyarlari.sonYazimBasarisiz)
    }

    // --- k1: kurulum kimliği yalnız dosya yoksa üretilir ---------------------------------------------

    @Test
    fun kurulumKimligiYalnizDosyaYoksaUretilir() {
        val dizin = java.nio.file.Files.createTempDirectory("kurulum").toFile()
        try {
            val f = java.io.File(dizin, "otomatik_yedek_kurulum")
            var uretilen = 0
            val uret = { uretilen++; "%08x".format(uretilen) }
            assertEquals("00000001", OtomatikYedek.kurulumDosyasi(f, uret, gunluk))
            assertEquals("00000001", OtomatikYedek.kurulumDosyasi(f, uret, gunluk))
            assertEquals(1, uretilen)
            // Dosya var ama okunamıyor (burada dizin): yeni kimlik üretilmez, atar, dosyaya dokunulmaz.
            val okunamaz = java.io.File(dizin, "okunamaz").apply { mkdirs() }
            try {
                OtomatikYedek.kurulumDosyasi(okunamaz, uret, gunluk)
                org.junit.Assert.fail("IOException bekleniyordu")
            } catch (_: IOException) {
            }
            assertTrue(okunamaz.isDirectory)
            assertEquals(1, uretilen)
            // İçeriği kimlik değilse (bozuk) yenisi yazılır.
            f.writeText("bozuk")
            assertEquals("00000002", OtomatikYedek.kurulumDosyasi(f, uret, gunluk))
            assertEquals("00000002", f.readText())
            assertEquals("00000002", OtomatikYedek.kurulumDosyasi(f, uret, gunluk))
        } finally {
            dizin.deleteRecursively()
        }
    }

    // --- T4: liste önbellekten gelse de az önce yazılan yedek silinmez -------------------------------

    /**
     * T4: Drive benzeri sağlayıcı yeniden adlandırmada kimliği korur, sonraki listeyi önbellekten verir: yeni yedek
     * eski geçici adıyla görünür. Eskiden yazmadan sonraki temizlik onu geçici sanıp siliyordu, sonuç yine
     * `Yapildi`'ydı; günler sonra klasörde yalnız eski yedekler kalırdı.
     */
    @Test
    fun onbellekliListedeAzOnceYazilanYedekSilinmez() {
        klasor.listeOnbellekli = true
        for (g in 15..28) {
            simdi = an(g, 9)
            val s = yedekci.gerekirseYedekle()
            assertTrue("$g: $s", s is YedekSonucu.Yapildi)
            assertTrue("$g", ad(an(g, 9)) in klasor.adlar())
            gecerliYedek(ad(an(g, 9)))
        }
        assertEquals((22..28).map { ad(an(it, 9)) }, bizimkiler())
        assertTrue(klasor.adlar().none { it.endsWith(OtomatikYedekPlani.GECICI_EK) })
    }

    @Test
    fun kimligiKorunanSilinmezYazmadanSonraGeciciyeDokunulmaz() {
        val yeni = KlasorDosyasi(ad(an(28, 9)) + ".yaziliyor", "yeni") // önbellekten eski adıyla
        val artik = KlasorDosyasi(ad(an(27, 9)) + ".yaziliyor", "artik")
        val eskiler = (20..27).map { KlasorDosyasi(ad(an(it, 9)), "e$it") }
        val hepsi = eskiler + yeni + artik
        val koru = ad(an(28, 9))
        val sil = OtomatikYedekPlani.silinecekler(hepsi, kurulum, bugunGun, koru = koru, koruKimlikler = setOf("yeni"), geciciDahil = false)
        // Bugünün günü korunanındır (listede o adla görünmese de): en yeni 6 eski gün kalır.
        assertEquals(setOf("e20", "e21"), sil.map { it.kimlik }.toSet())
        val geciciyle = OtomatikYedekPlani.silinecekler(hepsi, kurulum, bugunGun, koru = koru, koruKimlikler = setOf("yeni"))
        assertEquals(setOf("e20", "e21", "artik"), geciciyle.map { it.kimlik }.toSet())
        // Kimliği korunan, kalıba uyan başka bir adla görünse de silinmez.
        val baskaAdla = KlasorDosyasi(ad(an(10, 9)), "yeni")
        assertFalse(OtomatikYedekPlani.silinecekler(eskiler + baskaAdla, kurulum, bugunGun, koruKimlikler = setOf("yeni")).any { it.kimlik == "yeni" })
    }

    // --- k3: adlandırmasız sağlayıcıda doğrulanmış son dosya korunur ----------------------------------

    private fun tamKap(): ByteArray = ByteArrayOutputStream().also { YedekKabi.yaz(it, bicim, kaynak.disa, EkDeposu.Yok) }.toByteArray()

    /** Merkezi dizinin başladığı konum (`PK\u0001\u0002`): öncesi girdi sınırında kesik bir zip'tir. */
    private fun merkeziDizinKonumu(z: ByteArray): Int =
        (0 until z.size - 3).first { z[it] == 0x50.toByte() && z[it + 1] == 0x4b.toByte() && z[it + 2] == 1.toByte() && z[it + 3] == 2.toByte() }

    /** k3: süreç son ada yazıp doğruladıktan sonra, iz silinmeden öldü: sonraki deneme sağlam son dosyayı silmez. */
    @Test
    fun izSilinmedenOlenSurecinSaglamSonDosyasiKorunur() {
        val son = ad(an(27, 9))
        val tam = tamKap()
        klasor.ekle(son, tam)
        klasor.ekle(OtomatikYedekPlani.geciciAd(son), tam)
        ayarlar.d = acik.copy(yarimYazim = son)
        assertTrue(yedekci.gerekirseYedekle() is YedekSonucu.Yapildi)
        assertTrue(tam.contentEquals(klasor.veri(son)))
        assertEquals(listOf(son, bugun), klasor.adlar())
        assertNull(ayarlar.d.yarimYazim)
        // Girdi sınırında kesik (merkezi dizini yok) dosya bütün sayılmaz: silinir.
        val kesik = ad(an(26, 9))
        klasor.ekle(kesik, tam.copyOf(merkeziDizinKonumu(tam)))
        ayarlar.d = ayarlar.d.copy(yarimYazim = kesik)
        simdi = an(29, 9)
        assertTrue(yedekci.gerekirseYedekle() is YedekSonucu.Yapildi)
        assertFalse(kesik in klasor.adlar())
        assertNull(ayarlar.d.yarimYazim)
    }

    /** Doğrulama dosyanın sonunu da arar: girdi sınırında kesilip merkezi dizini düşen yazım yedek sayılmaz. */
    @Test
    fun merkeziDiziniDusenYazimDogrulanamaz() {
        klasor.sessizKes = merkeziDizinKonumu(tamKap())
        assertEquals(YedekSonucu.Basarisiz(YedekSorunu.DOGRULANAMADI), yedekci.gerekirseYedekle())
        assertTrue(klasor.dosyalar.isEmpty())
        // Tam kap geçer; kesiği ve sonuna eklenmiş açıklaması olan geçmez.
        val tam = tamKap()
        assertEquals(OtomatikYedekci.utf8Boyu(kaynak.disa.belge) to 0, OtomatikYedekci.butunlukDenetle(ByteArrayInputStream(tam), bicim))
        for (bozuk in listOf(tam.copyOf(tam.size - 1), tam.copyOf(merkeziDizinKonumu(tam)))) {
            try {
                OtomatikYedekci.butunlukDenetle(ByteArrayInputStream(bozuk), bicim)
                org.junit.Assert.fail("doğrulanamadı bekleniyordu")
            } catch (_: OtomatikYedekci.Dogrulanamadi) {
            }
        }
    }

    // --- T5 ve biçim 2: büyüklük ve sürüm uyarıları ------------------------------------------------

    /** T5: belge sınırın altında ama bu telefonun açma bütçesini aşıyor: söylenir, bir kez bildirilir; sınır önce gelir. */
    @Test
    fun buTelefondaAcilamayacakYedekSoylenirSinirUyarisiOnceGelir() {
        var butce = 1L
        val y = OtomatikYedekci(kaynak, { klasor }, ayarlar, { simdi }, { dilim }, gunluk, { kurulum }, bildirici, acmaButcesi = { butce })
        val m = OtomatikYedekMetinleri(dilim)
        val s = y.gerekirseYedekle() as YedekSonucu.Yapildi
        assertTrue(s.bellekAsiyor)
        assertFalse(s.sinirAsiyor)
        assertTrue(m.sonuc(s), m.sonuc(s).endsWith(AktarmaMetinleri.BELLEK_YETMEYEBILIR))
        assertEquals(listOf(AktarmaMetinleri.BELLEK_YETMEYEBILIR), m.uyarilar(ayarlar.d))
        assertEquals(listOf("Yedek bu telefonda açılamayabilir"), bildirici.gosterilen.map { it.first })
        simdi = an(29, 9)
        y.gerekirseYedekle()
        assertEquals(1, bildirici.gosterilen.size)
        // Sınır da aşılıyorsa yalnız sınır uyarısı (daha güçlüsü), o da bir kez.
        kaynak.disa = kaynak.disa.copy(iceAktarmaSiniriniAsiyor = true)
        simdi = an(30, 9)
        val s2 = y.gerekirseYedekle() as YedekSonucu.Yapildi
        assertFalse(s2.bellekAsiyor)
        assertEquals(listOf(AktarmaMetinleri.SINIR_ASIYOR), m.uyarilar(ayarlar.d))
        assertEquals(listOf("Yedek bu telefonda açılamayabilir", "Yedek geri yüklenemeyecek kadar büyük"), bildirici.gosterilen.map { it.first })
        // Bütçe yetiyorsa uyarı yok.
        butce = Long.MAX_VALUE
        kaynak.disa = kaynak.disa.copy(iceAktarmaSiniriniAsiyor = false)
        simdi = an(1, 9, ay = 12)
        assertFalse((y.gerekirseYedekle() as YedekSonucu.Yapildi).bellekAsiyor)
        assertTrue(m.uyarilar(ayarlar.d).isEmpty())
        // "Şimdi yedekle" sonucu ekranda görüldü: söylendi sayılır.
        butce = 1L
        assertTrue((y.simdiYedekle() as YedekSonucu.Yapildi).bellekAsiyor)
        assertTrue(ayarlar.d.bellekBildirildi)
        assertNull(OtomatikYedekPlani.soylenecek(ayarlar.d, simdi))
    }

    @Test
    fun bicim2YedekEskiSurumlerleAcilamazDenir() {
        val m = OtomatikYedekMetinleri(dilim)
        kaynak.disa = kaynak.disa.copy(bicimSurumu = 2, retYedekte = 1)
        val s = yedekci.gerekirseYedekle() as YedekSonucu.Yapildi
        assertTrue(s.eskiSurumAcamaz)
        assertEquals("3 kayıt yedeğe yazıldı: $bugun\n" + AktarmaMetinleri.ESKI_SURUM_ACAMAZ, m.sonuc(s))
        kaynak.disa = kaynak.disa.copy(bicimSurumu = 1, retYedekte = 0)
        simdi = an(29, 9)
        val s2 = yedekci.gerekirseYedekle() as YedekSonucu.Yapildi
        assertFalse(s2.eskiSurumAcamaz)
        assertFalse(m.sonuc(s2).contains("eski sürüm"))
    }
}
