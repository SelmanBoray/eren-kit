package dev.eren.ajanda.aktarma

import dev.eren.ajanda.cekirdek.AktarmaBicimi
import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.DisaAktarma
import dev.eren.ajanda.cekirdek.EkDosyasi
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.BufferedInputStream
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.OutputStream
import java.security.MessageDigest
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * Yedek kabı: gidiş-dönüş, yol kaçışı, şişirme, beklenmeyen girdi, ek özeti ve boyu, bellek bütçesi. Sınırlar
 * gerçek çekirdeğin `aktarmaBicimi()`'nden (JNA); büyük girdiler diskte akışla kurulur.
 */
class YedekKabiTest {
    @get:Rule
    val gecici = TemporaryFolder()

    /** Gerçek sınırlar: belge 64 MiB, ek 4 MiB, ekler toplamı 16 MiB, açılmış toplam 80 MiB, 10 000 ek. */
    private val bicim: AktarmaBicimi = dev.eren.ajanda.cekirdek.aktarmaBicimi()
    private val s = YedekKabi.Sinirlar(bicim)
    private val mib = 1L shl 20

    private class BellekDeposu : EkDeposu {
        val dosyalar = linkedMapOf<String, ByteArray>()
        var yazma = 0
        override fun varMi(ozet: String) = ozet in dosyalar
        override fun oku(ozet: String) = dosyalar[ozet]
        override fun yaz(ozet: String, veri: ByteArray) {
            yazma++
            dosyalar[ozet] = veri
        }
    }

    private fun disa(belge: String, ekler: List<EkDosyasi> = emptyList()) =
        DisaAktarma(belge, 1, 0, 0, 0, CalismaKipi.YEREL, ekler)

    private fun ek(veri: ByteArray, yol: String? = null): EkDosyasi {
        val o = EkDenetimi.ozet(veri)
        return EkDosyasi(o, veri.size.toLong(), "image/png", yol ?: "ekler/$o")
    }

    private fun zip(vararg girdiler: Pair<String, ByteArray?>): ByteArray {
        val b = ByteArrayOutputStream()
        ZipOutputStream(b).use { z ->
            for ((ad, veri) in girdiler) {
                z.putNextEntry(ZipEntry(ad))
                if (veri != null) z.write(veri)
                z.closeEntry()
            }
        }
        return b.toByteArray()
    }

    private fun oku(b: ByteArray, butce: Long? = null) =
        if (butce == null) YedekKabi.oku(ByteArrayInputStream(b), bicim) else YedekKabi.oku(ByteArrayInputStream(b), bicim, butce)

    private fun oku(f: File) = BufferedInputStream(f.inputStream(), 64 * 1024).use { YedekKabi.oku(it, bicim) }

    /** [boy] baytlık içerik: [bas] ve ardından [dolgu] (sıkışır); akışla yazılır, bellekte tutulmaz. */
    private class Icerik(val boy: Long, val bas: ByteArray = ByteArray(0), val dolgu: Byte = 'a'.code.toByte()) {
        fun yaz(o: OutputStream) {
            val b = minOf(bas.size.toLong(), boy).toInt()
            o.write(bas, 0, b)
            var kalan = boy - b
            val t = ByteArray(1 shl 20) { dolgu }
            while (kalan > 0) {
                val n = minOf(kalan, t.size.toLong()).toInt()
                o.write(t, 0, n)
                kalan -= n
            }
        }

        fun ozet(): String {
            val md = MessageDigest.getInstance("SHA-256")
            yaz(object : OutputStream() {
                override fun write(b: Int) = md.update(b.toByte())
                override fun write(b: ByteArray, off: Int, len: Int) = md.update(b, off, len)
            })
            return md.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
        }

        fun crc(): Long {
            val c = CRC32()
            yaz(object : OutputStream() {
                override fun write(b: Int) = c.update(b)
                override fun write(b: ByteArray, off: Int, len: Int) = c.update(b, off, len)
            })
            return c.value
        }
    }

    /** Ek girdisi: ad içeriğin özetidir. [i] içeriği ayırır (özetler farklı). */
    private fun ekIcerigi(boy: Long, i: Int) = Icerik(boy, java.nio.ByteBuffer.allocate(4).putInt(i).array(), 0)

    private fun ekGirdisi(c: Icerik) = "ekler/${c.ozet()}" to c

    /** Diskte zip (akışla; deflate ya da saklanmış). İçerik `null`: veri taşımayan girdi. */
    private fun dosyaZip(saklanmis: Boolean, vararg girdiler: Pair<String, Icerik?>): File {
        val f = gecici.newFile()
        ZipOutputStream(f.outputStream().buffered(1 shl 20)).use { z ->
            for ((ad, c) in girdiler) {
                val g = ZipEntry(ad)
                if (saklanmis && c != null) {
                    g.method = ZipEntry.STORED
                    g.size = c.boy
                    g.compressedSize = c.boy
                    g.crc = c.crc()
                }
                z.putNextEntry(g)
                c?.yaz(z)
                z.closeEntry()
            }
        }
        return f
    }

    private inline fun <reified T : YedekHatasi> reddedilir(f: () -> Unit) {
        try {
            f()
            fail("${T::class.simpleName} bekleniyordu")
        } catch (e: YedekHatasi) {
            assertTrue("${e::class.simpleName}: ${e.message}", e is T)
        }
    }

    @Test
    fun gidisDonusBelgeUtf8BomsuzVeKokte() {
        val belge = """{"bicim":"eren_ajanda_yedegi","not":"Çağrı ışık şöyle"}"""
        val cikti = ByteArrayOutputStream()
        YedekKabi.yaz(cikti, bicim, disa(belge), EkDeposu.Yok)
        val b = cikti.toByteArray()

        val adlar = mutableListOf<String>()
        var ham: ByteArray? = null
        ZipInputStream(ByteArrayInputStream(b)).use { z ->
            while (true) {
                val g = z.nextEntry ?: break
                adlar += g.name
                ham = z.readBytes()
            }
        }
        assertEquals(listOf("ajanda.json"), adlar)
        assertArrayEquals(belge.toByteArray(Charsets.UTF_8), ham)
        assertTrue("BOM yok", ham!![0] == '{'.code.toByte())

        val o = oku(b)
        assertEquals(belge, o.belge)
        assertTrue(o.ekler.isEmpty())
    }

    @Test
    fun ekliGidisDonusVeAyniOzetYenidenYazilmaz() {
        val v1 = ByteArray(300) { it.toByte() }
        val v2 = "ikinci ek".toByteArray()
        val kaynak = BellekDeposu().apply { dosyalar[EkDenetimi.ozet(v1)] = v1; dosyalar[EkDenetimi.ozet(v2)] = v2 }
        val ekler = listOf(ek(v1), ek(v2))
        val cikti = ByteArrayOutputStream()
        YedekKabi.yaz(cikti, bicim, disa("{}", ekler), kaynak)

        val o = oku(cikti.toByteArray())
        assertEquals(ekler.map { it.ozet }.toSet(), o.ekler.keys)
        val hedef = BellekDeposu()
        assertEquals(2, YedekKabi.ekleriYerlestir(ekler, o, bicim, hedef))
        assertArrayEquals(v1, hedef.dosyalar[ekler[0].ozet])
        // İkinci kez: ikisi de telefonda var, yazılmaz.
        assertEquals(0, YedekKabi.ekleriYerlestir(ekler, o, bicim, hedef))
        assertEquals(2, hedef.yazma)
    }

    @Test
    fun ekDizinGirdisiKabulEdilir() {
        val o = oku(zip("ekler/" to null, "ajanda.json" to "{}".toByteArray()))
        assertEquals("{}", o.belge)
    }

    @Test
    fun yolKacisiReddedilir() {
        val belge = "ajanda.json" to "{}".toByteArray()
        for (ad in listOf("../ajanda.json", "/ajanda.json", "ekler/../ajanda.json", "C:/ajanda.json", "ekler\\x", "./ajanda.json", "a/../../b")) {
            reddedilir<YedekHatasi.GecersizDosya> { oku(zip(belge, ad to "x".toByteArray())) }
            reddedilir<YedekHatasi.GecersizDosya> { oku(zip(ad to "x".toByteArray(), belge)) }
        }
    }

    @Test
    fun beklenmeyenGirdiReddedilir() {
        val belge = "ajanda.json" to "{}".toByteArray()
        reddedilir<YedekHatasi.GecersizDosya> { oku(zip(belge, "baska.txt" to "x".toByteArray())) }
        reddedilir<YedekHatasi.GecersizDosya> { oku(zip(belge, "ekler/kisa" to "x".toByteArray())) }
        reddedilir<YedekHatasi.GecersizDosya> { oku(zip(belge, "ekler/alt/" to null)) }
        reddedilir<YedekHatasi.GecersizDosya> { oku(zip(belge, "ajanda.json/" to null)) }
        // Büyük harfli özet adı da yabancıdır (özet küçük harf hex).
        val v = "x".toByteArray()
        reddedilir<YedekHatasi.GecersizDosya> { oku(zip(belge, "ekler/${EkDenetimi.ozet(v).uppercase()}" to v)) }
    }

    @Test
    fun belgesizZipOlmayanVeBozukDosyaReddedilir() {
        reddedilir<YedekHatasi.GecersizDosya> { oku(zip("ekler/" to null)) }
        reddedilir<YedekHatasi.GecersizDosya> { oku(ByteArray(0)) }
        reddedilir<YedekHatasi.GecersizDosya> { oku("""{"bicim":"eren_ajanda_yedegi"}""".toByteArray()) }
        // Sıkışmayan veri: yarıda kesilince girdinin ortası kopar.
        val tam = zip("ajanda.json" to ByteArray(2000).also { java.util.Random(1).nextBytes(it) })
        reddedilir<YedekHatasi.GecersizDosya> { oku(tam.copyOf(tam.size / 2)) }
        reddedilir<YedekHatasi.GecersizDosya> { oku(zip("ajanda.json" to byteArrayOf(0x7b, 0xC3.toByte(), 0x28, 0x7d))) }
    }

    @Test
    fun basindakiBomAtlanir() {
        val o = oku(zip("ajanda.json" to byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte(), '{'.code.toByte(), '}'.code.toByte())))
        assertEquals("{}", o.belge)
    }

    @Test
    fun gercekSinirlarCekirdektenGelir() {
        // Kotlin sabit tutmaz; değerler çekirdekten. Değişirse bu test ve MIMARI birlikte güncellenir.
        assertEquals(64 * mib, s.belge)
        assertEquals(4 * mib, s.ek)
        assertEquals(16 * mib, s.eklerToplam)
        assertEquals(80 * mib, s.acilmisToplam)
        assertEquals(s.belge + s.eklerToplam, s.acilmisToplam)
        assertEquals(10_000, s.ekAdet)
    }

    @Test
    fun eskiKopruninSifirSinirlariEnDarSayilir() {
        // Yeni alanlar verilmemiş (0): ek kabul edilmez, açılmış toplam belge + ekler toplamıdır.
        val eski = AktarmaBicimi("ajanda.json", "ekler/", 1, 1000uL, 10uL)
        val e = YedekKabi.Sinirlar(eski)
        assertEquals(0L, e.eklerToplam)
        assertEquals(1000L, e.acilmisToplam)
        assertEquals(0, e.ekAdet)
        val v = "x".toByteArray()
        reddedilir<YedekHatasi.CokBuyuk> {
            YedekKabi.oku(ByteArrayInputStream(zip("ajanda.json" to "{}".toByteArray(), "ekler/${EkDenetimi.ozet(v)}" to v)), eski)
        }
        assertEquals("{}", YedekKabi.oku(ByteArrayInputStream(zip("ajanda.json" to "{}".toByteArray())), eski).belge)
    }

    @Test
    fun sisirmeReddedilir() {
        // 100 MiB sıfır ~100 KB'a sıkışır; açılırken sayılır, belge sınırında (64 MiB) kesilir.
        val bomba = dosyaZip(false, "ajanda.json" to Icerik(100 * mib, dolgu = 0))
        assertTrue("${bomba.length()}", bomba.length() < 1 shl 20)
        reddedilir<YedekHatasi.CokBuyuk> { oku(bomba) }

        // Tek ek sınırı (4 MiB): sınırda kabul, bir fazlası red.
        val belge = "ajanda.json" to Icerik(2, "{}".toByteArray())
        assertEquals(1, oku(dosyaZip(false, belge, ekGirdisi(ekIcerigi(s.ek, 1)))).ekler.size)
        reddedilir<YedekHatasi.CokBuyuk> { oku(dosyaZip(false, belge, ekGirdisi(ekIcerigi(s.ek + 1, 1)))) }

        // Eklerin toplamı (16 MiB): dört tam ek sığar, beşincisi aşar (her biri tek başına sınırda).
        val dort = (1..4).map { ekGirdisi(ekIcerigi(s.ek, it)) }
        assertEquals(4, oku(dosyaZip(false, belge, *dort.toTypedArray())).ekler.size)
        reddedilir<YedekHatasi.CokBuyuk> { oku(dosyaZip(false, belge, *(dort + ekGirdisi(ekIcerigi(1, 5))).toTypedArray())) }
    }

    @Test
    fun acilmisToplamBelgeVeEklerSiniriylaDolar() {
        // Belge 64 MiB + ekler 16 MiB = 80 MiB (tam sınır) kabul; dizin girdisinin tek baytı aşırır.
        val belge = "ajanda.json" to Icerik(s.belge)
        val ekler = (1..4).map { ekGirdisi(ekIcerigi(s.ek, it)) }.toTypedArray()
        val o = oku(dosyaZip(false, belge, *ekler))
        assertEquals(s.belge.toInt(), o.baytlar.size)
        assertEquals(4, o.ekler.size)
        reddedilir<YedekHatasi.CokBuyuk> { oku(dosyaZip(false, "ekler/" to Icerik(1, dolgu = 0), belge, *ekler)) }
    }

    @Test
    fun sisirilmisEkDizinGirdisiReddedilir() {
        // `ekler/` dizin girdisi veri taşıyor: saklanmaz ama açılmış boyu toplama girer (eskiden
        // `closeEntry` sayılmadan açıyordu). 100 MiB sıfır ~100 KB'a sıkışır; ham sınır onu durdurmaz.
        val bomba = dosyaZip(false, "ajanda.json" to Icerik(2, "{}".toByteArray()), "ekler/" to Icerik(100 * mib, dolgu = 0))
        val giris = BufferedInputStream(bomba.inputStream())
        reddedilir<YedekHatasi.CokBuyuk> { giris.use { YedekKabi.oku(it, bicim) } }

        // Sınırın altındaki dizin verisi de toplama sayılır: belge (2) + dizin toplamı 80 MiB'i bir bayt aşar.
        val belge = "ajanda.json" to Icerik(2, "{}".toByteArray())
        reddedilir<YedekHatasi.CokBuyuk> { oku(dosyaZip(false, belge, "ekler/" to Icerik(s.acilmisToplam - 1, dolgu = 0))) }
        assertEquals("{}", oku(dosyaZip(false, belge, "ekler/" to Icerik(s.acilmisToplam - 2, dolgu = 0))).belge)
        // Veri taşımayan dizin girdisi bugünkü gibi kabul.
        assertEquals("{}", oku(zip("ajanda.json" to "{}".toByteArray(), "ekler/" to null)).belge)
    }

    @Test
    fun bellekButcesiAsilincaBellekYetmezBicimSiniriylaKarismaz() {
        // Bütçe belgeyi 2 kat sayar: 10 000 baytlık belge 20 000 baytlık bütçeye sığar, 19 999'a sığmaz.
        val b = zip("ajanda.json" to ByteArray(10_000) { 'a'.code.toByte() })
        assertEquals(10_000, oku(b, butce = 20_000).baytlar.size)
        reddedilir<YedekHatasi.BellekYetmez> { oku(b, butce = 19_999) }
        // Ek: tutulan belgeden sonra kalan bütçenin yarısı (3000 baytlık ek, 1000 baytlık belgeden sonra).
        val v = ByteArray(3000) { 3 }
        val ekli = zip("ajanda.json" to ByteArray(1000) { 'a'.code.toByte() }, "ekler/${EkDenetimi.ozet(v)}" to v)
        assertEquals(1, oku(ekli, butce = 7000).ekler.size)
        reddedilir<YedekHatasi.BellekYetmez> { oku(ekli, butce = 6999) }
        // Biçim sınırını aşan girdi bütçe yetse de "çok büyük"tür.
        reddedilir<YedekHatasi.CokBuyuk> { oku(dosyaZip(false, "ajanda.json" to Icerik(s.belge + 1)).readBytes(), butce = Long.MAX_VALUE) }
        // Varsayılan bütçe gerçek yığından: payı ayırır, eksiye düşmez.
        val r = Runtime.getRuntime()
        val pay = maxOf(YedekKabi.BELLEK_PAYI_EN_AZ, r.maxMemory() / 4)
        val butce = YedekKabi.bellekButcesi(Long.MAX_VALUE)
        assertTrue("$butce", butce in 0..(r.maxMemory() - pay))
    }

    @Test
    fun ekOzetiVeBoyuDenetlenir() {
        val v = "ek verisi".toByteArray()
        val baska = "başka".toByteArray()
        // Kapta adı özetle tutmayan dosya.
        reddedilir<YedekHatasi.EkBozuk> { oku(zip("ajanda.json" to "{}".toByteArray(), "ekler/${EkDenetimi.ozet(baska)}" to v)) }

        val e = ek(v)
        EkDenetimi.denetle(e, v, bicim)
        reddedilir<YedekHatasi.EkBozuk> { EkDenetimi.denetle(e.copy(bayt = e.bayt + 1), v, bicim) }
        reddedilir<YedekHatasi.EkBozuk> { EkDenetimi.denetle(e.copy(ozet = EkDenetimi.ozet(baska)), v, bicim) }
        reddedilir<YedekHatasi.CokBuyuk> { EkDenetimi.denetle(e.copy(bayt = s.ek + 1), v, bicim) }
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", EkDenetimi.ozet(ByteArray(0)))
    }

    @Test
    fun yerlestirmeDenetimleri() {
        val v = "ek".toByteArray()
        val e = ek(v)
        val o = oku(zip("ajanda.json" to "{}".toByteArray(), e.yol to v))
        // Planda olmayan kap eki: beklenmeyen.
        reddedilir<YedekHatasi.GecersizDosya> { YedekKabi.ekleriYerlestir(emptyList(), o, bicim, BellekDeposu()) }
        // Planın eki kapta yok.
        val yok = ek("yok".toByteArray())
        reddedilir<YedekHatasi.EkBozuk> { YedekKabi.ekleriYerlestir(listOf(e, yok), o, bicim, BellekDeposu()) }
        // Yol özetle tutmuyor.
        reddedilir<YedekHatasi.EkBozuk> { YedekKabi.ekleriYerlestir(listOf(e.copy(yol = "ekler/x")), o, bicim, BellekDeposu()) }
        // Boy tutmuyor: depoya bir şey yazılmaz.
        val d = BellekDeposu()
        reddedilir<YedekHatasi.EkBozuk> { YedekKabi.ekleriYerlestir(listOf(e.copy(bayt = 99)), o, bicim, d) }
        assertEquals(0, d.yazma)
    }

    @Test
    fun onBinEkliKabinBasliklariHamPayaSigar() {
        // Eski sabit 1 MiB pay: 10 000 ekin yerel başlıkları (~120 bayt) tek başına ~1,2 MB eder ve geçerli kap
        // reddedilirdi. Pay artık girdi başına eklenir. Açılmış toplam burada bilerek küçük (64 KiB): ham pay
        // gerçek 80 MiB'in gölgesinde kalmasın; ek adedi gerçek sınırda.
        val b = bicim.copy(belgeAzamiBayt = 64uL * 1024uL, acilmisToplamAzamiBayt = 64uL * 1024uL)
        val depo = BellekDeposu()
        val ekler = List(s.ekAdet) { i ->
            val v = java.nio.ByteBuffer.allocate(4).putInt(i).array()
            depo.dosyalar[EkDenetimi.ozet(v)] = v
            ek(v)
        }
        val cikti = ByteArrayOutputStream()
        YedekKabi.yaz(cikti, b, disa("{}", ekler), depo)
        val ham = cikti.toByteArray()
        assertTrue("ham ${ham.size}", ham.size > 64 * 1024 + (1 shl 20))
        val o = YedekKabi.oku(ByteArrayInputStream(ham), b)
        assertEquals(s.ekAdet, o.ekler.size)
        assertEquals(ekler.size, YedekKabi.ekleriYerlestir(ekler, o, b, BellekDeposu()))
    }

    @Test
    fun ekAdediSiniriAsilincaRed() {
        val c = ByteArrayOutputStream()
        ZipOutputStream(c).use { z ->
            z.putNextEntry(ZipEntry("ajanda.json"))
            z.write("{}".toByteArray())
            z.closeEntry()
            repeat(s.ekAdet + 1) { i ->
                val v = java.nio.ByteBuffer.allocate(4).putInt(i).array()
                z.putNextEntry(ZipEntry("ekler/${EkDenetimi.ozet(v)}"))
                z.write(v)
                z.closeEntry()
            }
        }
        reddedilir<YedekHatasi.CokBuyuk> { oku(c.toByteArray()) }
    }

    @Test
    fun sinirTamDoluncaKabulBirFazlasiRed() {
        // Gerçek belge sınırı (64 MiB). Akışla yazılmış (boy başlıkta yok) ve saklanmış (boy başlıkta var,
        // güvenilmez) girdiler.
        for (saklanmis in listOf(false, true)) {
            val o = oku(dosyaZip(saklanmis, "ajanda.json" to Icerik(s.belge)))
            assertEquals(s.belge.toInt(), o.baytlar.size)
            assertTrue(o.baytlar[0] == 'a'.code.toByte() && o.baytlar[o.baytlar.lastIndex] == 'a'.code.toByte())
            reddedilir<YedekHatasi.CokBuyuk> { oku(dosyaZip(saklanmis, "ajanda.json" to Icerik(s.belge + 1))) }
            assertEquals("", oku(zipYontemle(saklanmis, "ajanda.json" to ByteArray(0))).belge)
        }
    }

    @Test
    fun icerAktarmaSiniriniAsanBelgeYazilir() {
        // Yazarken sınır yok: uygulamanın kendi belgesi içe aktarma sınırını aşsa da kaba girer (bayrağı çağıran
        // söyler). Sınır yalnız okurken. Burada biçimin belge sınırı bilerek küçük (1000): 64 MiB'lik dize gerekmesin.
        val kucuk = bicim.copy(belgeAzamiBayt = 1000uL, acilmisToplamAzamiBayt = 1000uL)
        val belge = "ş".repeat(5000)
        val c = ByteArrayOutputStream()
        YedekKabi.yaz(c, kucuk, disa(belge), EkDeposu.Yok)
        assertEquals(belge, YedekKabi.oku(ByteArrayInputStream(c.toByteArray()), bicim).belge)
        reddedilir<YedekHatasi.CokBuyuk> { YedekKabi.oku(ByteArrayInputStream(c.toByteArray()), kucuk) }
    }

    @Test
    fun utf8KatiCozulurDortBaytlilarDahil() {
        val metin = "{\"not\":\"Çağrı ışık şöyle 😀 𝄞 İ ğ\"}"
        assertEquals(metin, oku(zip("ajanda.json" to metin.toByteArray(Charsets.UTF_8))).belge)
        val bomlu = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + metin.toByteArray(Charsets.UTF_8)
        assertEquals(metin, oku(zip("ajanda.json" to bomlu)).belge)
        val bozuklar = listOf(
            byteArrayOf(0x7b, 0xE2.toByte(), 0x82.toByte()), // yarım üç baytlık dizi
            byteArrayOf(0xC0.toByte(), 0xAF.toByte()), // aşırı uzun kodlama
            byteArrayOf(0xED.toByte(), 0xA0.toByte(), 0x80.toByte()), // kodlanmış vekil
            byteArrayOf(0x80.toByte()), // başsız devam baytı
            byteArrayOf(0xF5.toByte(), 0x80.toByte(), 0x80.toByte(), 0x80.toByte()), // U+10FFFF üstü
        )
        for (b in bozuklar) reddedilir<YedekHatasi.GecersizDosya> { oku(zip("ajanda.json" to b)) }
    }

    @Test
    fun belgeBaytlariTamBoyluBomsuzVeParcaSinirlariniAsar() {
        // 64 KiB'ten 4 MiB'e büyüyen parça sınırlarını aşan (~9 MB) çok baytlı belge; BOM'lu ve BOM'suz.
        val genis = bicim
        val metin = buildString { var i = 0; while (length < 4_500_000) { append(if (i % 5 == 0) "ğ😀" else "a"); i++ } }
        val utf8 = metin.toByteArray(Charsets.UTF_8)
        val bom = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())
        for (girdi in listOf(utf8, bom + utf8)) {
            val o = YedekKabi.oku(ByteArrayInputStream(zip("ajanda.json" to girdi)), genis)
            assertArrayEquals(utf8, o.baytlar)
            assertEquals(metin, o.belge)
        }
        // Yalnız BOM: boş belge.
        assertEquals(0, oku(zip("ajanda.json" to bom)).baytlar.size)
    }

    @Test
    fun yazilanBelgeBirebir() {
        // Parça sınırlarını (64 Ki karakter) aşan, çok baytlı karakterli belge.
        val belge = buildString { repeat(70_000) { append(if (it % 3 == 0) "ş" else if (it % 7 == 0) "😀" else "a") } }
        val c = ByteArrayOutputStream()
        YedekKabi.yaz(c, bicim, disa(belge), EkDeposu.Yok)
        assertEquals(belge, YedekKabi.oku(ByteArrayInputStream(c.toByteArray()), bicim).belge)
    }

    private fun zipYontemle(saklanmis: Boolean, vararg girdiler: Pair<String, ByteArray>): ByteArray {
        val b = ByteArrayOutputStream()
        ZipOutputStream(b).use { z ->
            for ((ad, veri) in girdiler) {
                val g = ZipEntry(ad)
                if (saklanmis) {
                    g.method = ZipEntry.STORED
                    g.size = veri.size.toLong()
                    g.compressedSize = veri.size.toLong()
                    g.crc = java.util.zip.CRC32().apply { update(veri) }.value
                }
                z.putNextEntry(g)
                z.write(veri)
                z.closeEntry()
            }
        }
        return b.toByteArray()
    }

    @Test
    fun yazarkenEksikYaDaBozukEkReddedilir() {
        val v = "ek".toByteArray()
        reddedilir<YedekHatasi.EkBozuk> { YedekKabi.yaz(ByteArrayOutputStream(), bicim, disa("{}", listOf(ek(v))), EkDeposu.Yok) }
        val d = BellekDeposu().apply { dosyalar[EkDenetimi.ozet(v)] = "değişmiş".toByteArray() }
        reddedilir<YedekHatasi.EkBozuk> { YedekKabi.yaz(ByteArrayOutputStream(), bicim, disa("{}", listOf(ek(v))), d) }
    }
}
