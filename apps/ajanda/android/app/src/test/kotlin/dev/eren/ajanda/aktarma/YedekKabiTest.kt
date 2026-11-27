package dev.eren.ajanda.aktarma

import dev.eren.ajanda.cekirdek.AktarmaBicimi
import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.DisaAktarma
import dev.eren.ajanda.cekirdek.EkDosyasi
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/** Yedek kabı: gidiş-dönüş, yol kaçışı, şişirme, beklenmeyen girdi, ek özeti ve boyu (saf; çekirdek yok). */
class YedekKabiTest {
    private val bicim = AktarmaBicimi("ajanda.json", "ekler/", 1, 10_000uL, 4096uL)

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

    private fun oku(b: ByteArray, toplam: Long = bicim.belgeAzamiBayt.toLong()) =
        YedekKabi.oku(ByteArrayInputStream(b), bicim, toplam)

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
    fun sisirmeReddedilir() {
        // 5 MB sıfır birkaç KB'a sıkışır; açılırken sayılır, belge sınırında (10 000 bayt) kesilir.
        val bomba = zip("ajanda.json" to ByteArray(5_000_000))
        assertTrue(bomba.size < 10_000)
        reddedilir<YedekHatasi.CokBuyuk> { oku(bomba) }

        // Tek ek sınırı (4096).
        val iri = ByteArray(5000) { 7 }
        reddedilir<YedekHatasi.CokBuyuk> { oku(zip("ajanda.json" to "{}".toByteArray(), "ekler/${EkDenetimi.ozet(iri)}" to iri)) }

        // Açılmış toplam: her biri sınırda ama toplam aşar.
        val a = ByteArray(3000) { 1 }
        val b = ByteArray(3000) { 2 }
        val iki = zip("ajanda.json" to "{}".toByteArray(), "ekler/${EkDenetimi.ozet(a)}" to a, "ekler/${EkDenetimi.ozet(b)}" to b)
        assertEquals(2, oku(iki).ekler.size)
        reddedilir<YedekHatasi.CokBuyuk> { oku(iki, toplam = 5000) }
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
        reddedilir<YedekHatasi.CokBuyuk> { EkDenetimi.denetle(e.copy(bayt = 5000), v, bicim) }
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
    fun yazarkenEksikYaDaBozukEkReddedilir() {
        val v = "ek".toByteArray()
        reddedilir<YedekHatasi.EkBozuk> { YedekKabi.yaz(ByteArrayOutputStream(), bicim, disa("{}", listOf(ek(v))), EkDeposu.Yok) }
        val d = BellekDeposu().apply { dosyalar[EkDenetimi.ozet(v)] = "değişmiş".toByteArray() }
        reddedilir<YedekHatasi.EkBozuk> { YedekKabi.yaz(ByteArrayOutputStream(), bicim, disa("{}", listOf(ek(v))), d) }
        reddedilir<YedekHatasi.CokBuyuk> { YedekKabi.yaz(ByteArrayOutputStream(), bicim, disa("x".repeat(10_001)), EkDeposu.Yok) }
    }
}
