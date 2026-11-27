package dev.eren.ajanda.aktarma

import dev.eren.ajanda.cekirdek.AktarmaBicimi
import dev.eren.ajanda.cekirdek.DisaAktarma
import dev.eren.ajanda.cekirdek.EkDosyasi
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipException
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * SAHİBİ: D3. Yedek kabı (zip): kökte belge (`AktarmaBicimi.belgeAdi`, UTF-8, BOM'suz), ekler
 * `AktarmaBicimi.eklerDizini` + `<ozet>`. Ad, dizin ve sınırlar çekirdekten gelir ([AktarmaBicimi]).
 * Saf Kotlin (Android bağımlılığı yok); akışları çağıran açar ve kapatır.
 *
 * Okurken: her girdinin adı beyaz listeden geçer (belge, ek dizini, `ekler/<64 hex>`), yol kaçışı
 * (`..`, mutlak yol, ters bölü) ve beklenmeyen ya da yinelenen girdi reddedilir. Boyutlar başlığa
 * güvenilmeden açılırken sayılır: belge, her ek ve açılmış toplam ayrı sınırlıdır (şişirme saldırısı).
 *
 * Mahremiyet: hata mesajları dosya içeriği ya da girdi adı taşımaz.
 */
object YedekKabi {
    /** Kaptaki ek dosyası sayısının üst sınırı (bugün ek yok; kötü dosyaya karşı bekçi). */
    const val AZAMI_EK_SAYISI = 10_000

    /** Ham dosyanın açılmış toplamı aşabileceği pay (zip başlıkları, sıkışmayan veri). */
    private const val HAM_PAYI = 1L shl 20

    private val OZET = Regex("[0-9a-f]{64}")

    /** Okunan kap: belgenin metni ve özeti dosya adıyla doğrulanmış ek baytları. */
    class Okunan(val belge: String, val ekler: Map<String, ByteArray>)

    /**
     * Dışa aktarmayı kaba yazar. Her ekin baytı [depo]'dan okunur, özeti ve boyu denetlenir.
     * @throws YedekHatasi ek eksik ya da bozuksa; [IOException] yazılamazsa.
     */
    fun yaz(cikis: OutputStream, bicim: AktarmaBicimi, disa: DisaAktarma, depo: EkDeposu) {
        val belge = disa.belge.toByteArray(Charsets.UTF_8)
        if (belge.size.toLong() > bicim.belgeAzamiBayt.toLong()) throw YedekHatasi.CokBuyuk()
        val z = ZipOutputStream(cikis)
        z.putNextEntry(ZipEntry(bicim.belgeAdi))
        z.write(belge)
        z.closeEntry()
        if (disa.ekler.isNotEmpty()) {
            val yazilan = HashSet<String>()
            for (ek in disa.ekler) {
                if (!yazilan.add(ek.ozet)) continue
                val veri = depo.oku(ek.ozet) ?: throw YedekHatasi.EkBozuk("ek dosyası telefonda yok")
                EkDenetimi.denetle(ek, veri, bicim)
                z.putNextEntry(ZipEntry(ek.yol))
                z.write(veri)
                z.closeEntry()
            }
        }
        z.finish()
        z.flush()
    }

    /**
     * Kabı okur ve doğrular (belgenin içeriğine bakmaz: o çekirdeğin işi).
     * @param toplamAzamiBayt açılmış bütün girdilerin toplam sınırı (varsayılan: belge sınırı; ekler
     *   gelince ve depolamaya akıtılınca yeniden bakılır).
     * @throws YedekHatasi geçersiz kap, çok büyük, bozuk ek; [IOException] okunamazsa.
     */
    fun oku(
        giris: InputStream,
        bicim: AktarmaBicimi,
        toplamAzamiBayt: Long = bicim.belgeAzamiBayt.toLong(),
    ): Okunan {
        val belgeAzami = bicim.belgeAzamiBayt.toLong()
        val ekAzami = bicim.ekAzamiBayt.toLong()
        // Sıkıştırılmış girdi de sayılır: açılmış toplamdan büyük ham dosya okunmaz.
        val ham = SinirliGiris(giris, toplamAzamiBayt + HAM_PAYI)
        var belge: ByteArray? = null
        val ekler = LinkedHashMap<String, ByteArray>()
        var toplam = 0L
        var dizinGoruldu = false
        try {
            ZipInputStream(ham).use { z ->
                while (true) {
                    val g = z.nextEntry ?: break
                    val ad = g.name
                    yoluDenetle(ad)
                    when {
                        ad == bicim.belgeAdi -> {
                            if (g.isDirectory || belge != null) throw YedekHatasi.GecersizDosya("belge yinelenmiş")
                            val b = sinirliOku(z, minOf(belgeAzami, toplamAzamiBayt - toplam))
                            toplam += b.size
                            belge = b
                        }
                        ad == bicim.eklerDizini && g.isDirectory -> {
                            if (dizinGoruldu) throw YedekHatasi.GecersizDosya("dizin yinelenmiş")
                            dizinGoruldu = true
                        }
                        ad.startsWith(bicim.eklerDizini) && !g.isDirectory &&
                            OZET.matches(ad.substring(bicim.eklerDizini.length)) -> {
                            val ozet = ad.substring(bicim.eklerDizini.length)
                            if (ozet in ekler) throw YedekHatasi.GecersizDosya("ek yinelenmiş")
                            if (ekler.size >= AZAMI_EK_SAYISI) throw YedekHatasi.CokBuyuk()
                            val b = sinirliOku(z, minOf(ekAzami, toplamAzamiBayt - toplam))
                            toplam += b.size
                            if (EkDenetimi.ozet(b) != ozet) throw YedekHatasi.EkBozuk("ek özeti tutmuyor")
                            ekler[ozet] = b
                        }
                        else -> throw YedekHatasi.GecersizDosya("beklenmeyen girdi")
                    }
                    z.closeEntry()
                }
            }
        } catch (e: ZipException) {
            throw YedekHatasi.GecersizDosya("zip bozuk")
        } catch (e: java.io.EOFException) {
            // Yarım kalmış dosya.
            throw YedekHatasi.GecersizDosya("zip bozuk")
        } catch (e: IllegalArgumentException) {
            // ZipInputStream geçersiz ad kodlamasında bunu atar.
            throw YedekHatasi.GecersizDosya("zip bozuk")
        }
        val b = belge ?: throw YedekHatasi.GecersizDosya("belge yok")
        return Okunan(utf8(b), ekler)
    }

    /**
     * İçe aktarmadan önce: planın ekleri kaptakilerle birebir tutmalı (eksik ya da fazla yok), her biri
     * yolu, boyu ve özetiyle denetlenir; aynı özetli dosya telefonda varsa yeniden yazılmaz.
     * @return yeni yazılan ek sayısı.
     */
    fun ekleriYerlestir(planEkleri: List<EkDosyasi>, okunan: Okunan, bicim: AktarmaBicimi, depo: EkDeposu): Int {
        val beklenen = planEkleri.map { it.ozet }.toSet()
        if (okunan.ekler.keys.any { it !in beklenen }) throw YedekHatasi.GecersizDosya("belgede olmayan ek")
        var yazilan = 0
        for (ek in planEkleri) {
            if (ek.yol != bicim.eklerDizini + ek.ozet) throw YedekHatasi.EkBozuk("ek yolu tutmuyor")
            val veri = okunan.ekler[ek.ozet] ?: throw YedekHatasi.EkBozuk("ek dosyası kapta yok")
            EkDenetimi.denetle(ek, veri, bicim)
            if (depo.varMi(ek.ozet)) continue
            depo.yaz(ek.ozet, veri)
            yazilan++
        }
        return yazilan
    }

    /** Zip girdi adı: mutlak yol, sürücü harfi, ters bölü ve `..`/`.` parçası reddedilir. */
    internal fun yoluDenetle(ad: String) {
        val kacis = ad.isEmpty() || ad.startsWith("/") || ad.contains('\\') || ad.contains('\u0000') ||
            (ad.length >= 2 && ad[1] == ':') ||
            ad.split('/').any { it == ".." || it == "." }
        if (kacis) throw YedekHatasi.GecersizDosya("girdi yolu kapsam dışında")
    }

    /** Girdiyi en çok [azami] bayta dek okur; fazlası [YedekHatasi.CokBuyuk]. */
    private fun sinirliOku(z: InputStream, azami: Long): ByteArray {
        val cikti = ByteArrayOutputStream()
        val tampon = ByteArray(64 * 1024)
        var n = 0L
        while (true) {
            val r = z.read(tampon)
            if (r < 0) break
            n += r
            if (n > azami) throw YedekHatasi.CokBuyuk()
            cikti.write(tampon, 0, r)
        }
        return cikti.toByteArray()
    }

    private fun utf8(b: ByteArray): String {
        // BOM'suz yazılır; elle düzenlenmiş dosyada başta BOM varsa atlanır.
        val bas = if (b.size >= 3 && b[0] == 0xEF.toByte() && b[1] == 0xBB.toByte() && b[2] == 0xBF.toByte()) 3 else 0
        return try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(b, bas, b.size - bas))
                .toString()
        } catch (_: CharacterCodingException) {
            throw YedekHatasi.GecersizDosya("belge UTF-8 değil")
        }
    }

    /** Ham (sıkıştırılmış) girdiyi sayar; [azami]'yi aşınca [YedekHatasi.CokBuyuk]. */
    private class SinirliGiris(private val ic: InputStream, private val azami: Long) : InputStream() {
        private var n = 0L
        private fun say(r: Int): Int {
            if (r > 0) {
                n += r
                if (n > azami) throw YedekHatasi.CokBuyuk()
            }
            return r
        }
        override fun read(): Int {
            val r = ic.read()
            if (r >= 0) say(1)
            return r
        }
        override fun read(b: ByteArray, off: Int, len: Int): Int = say(ic.read(b, off, len))
        override fun close() = ic.close()
    }
}

/** Kap hataları. Mesajlar sabittir (içerik taşımaz); kullanıcı metni [AktarmaMetinleri]'nde. */
sealed class YedekHatasi(mesaj: String) : IOException(mesaj) {
    /** Zip değil, belge yok, beklenmeyen ya da yinelenen girdi, yol kaçışı, UTF-8 değil. */
    class GecersizDosya(neden: String) : YedekHatasi(neden)

    /** Belge, bir ek, açılmış toplam ya da ek sayısı sınırı aşıyor. */
    class CokBuyuk : YedekHatasi("çok büyük")

    /** Ekin baytı, boyu ya da özeti tutmuyor; ya da ek bulunamadı. */
    class EkBozuk(neden: String) : YedekHatasi(neden)
}

/** Ek dosyalarının denetimi: sha256 (64 küçük harf hex) ve bayt. */
object EkDenetimi {
    fun ozet(veri: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(veri).joinToString("") { "%02x".format(it.toInt() and 0xff) }

    fun denetle(ek: EkDosyasi, veri: ByteArray, bicim: AktarmaBicimi) {
        if (ek.bayt < 0 || ek.bayt > bicim.ekAzamiBayt.toLong()) throw YedekHatasi.CokBuyuk()
        if (veri.size.toLong() != ek.bayt) throw YedekHatasi.EkBozuk("ek boyu tutmuyor")
        if (ozet(veri) != ek.ozet) throw YedekHatasi.EkBozuk("ek özeti tutmuyor")
    }
}

/**
 * Telefondaki ek dosyalarının deposu (içerik adresli: ad özettir). Depolaması ekler gelince yazılır;
 * bugün [Yok] (hiç ek yok).
 */
interface EkDeposu {
    fun varMi(ozet: String): Boolean
    fun oku(ozet: String): ByteArray?
    /** Yalnız [varMi] yanlışken çağrılır; veri denetlenmiştir. */
    fun yaz(ozet: String, veri: ByteArray)

    object Yok : EkDeposu {
        override fun varMi(ozet: String) = false
        override fun oku(ozet: String): ByteArray? = null
        override fun yaz(ozet: String, veri: ByteArray) = throw YedekHatasi.EkBozuk("ek deposu yok")
    }
}
