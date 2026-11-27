package dev.eren.ajanda.aktarma

import dev.eren.ajanda.cekirdek.AktarmaBicimi
import dev.eren.ajanda.cekirdek.DisaAktarma
import dev.eren.ajanda.cekirdek.EkDosyasi
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.CharBuffer
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
 * Toplama her girdinin açılmış baytı girer, saklanmayanlarınki (dizin girdisi) de; aşan okuma ilk
 * fazla tamponda kesilir. Sınırlar yalnız çekirdekten okunur (`aktarmaBicimi()`); burada sabit yok.
 *
 * Mahremiyet: hata mesajları dosya içeriği ya da girdi adı taşımaz.
 */
object YedekKabi {
    /** Kaptaki ek dosyası sayısının üst sınırı (bugün ek yok; kötü dosyaya karşı bekçi). */
    const val AZAMI_EK_SAYISI = 10_000

    /**
     * Ham (sıkıştırılmış) dosyanın açılmış toplamı aşabileceği sabit pay: sıkışmayan verinin deflate ek yükü
     * (65 535 baytlık saklı blok başına 5 bayt: 32 MiB'de ~2,6 KB), `ZipInputStream`'in önden okuması (~1 KB) ve
     * ilk girdinin başlığı. Girdi başlıkları ayrıca [GIRDI_PAYI] ile her girdide eklenir.
     */
    private const val HAM_PAYI = 1L shl 20

    /**
     * Her girdinin ham paya eklediği: yerel başlık (30) + ad (bizim adlarımız en çok 70) + ekstra alan (başka zip
     * araçlarının zaman damgaları ~40) + veri tanımlayıcısı (16, zip64'te 24). 1 KiB bunların çok üstündedir;
     * 10 000 ek girdisi için toplam pay ~10 MiB olur (sabit 1 MiB, ~1,2 MB'lık başlıklara yetmezdi). Merkezi dizin
     * okunmaz (`ZipInputStream` orada durur).
     */
    private const val GIRDI_PAYI = 1L shl 10

    private val OZET = Regex("[0-9a-f]{64}")

    /** Okunan kap: belgenin metni ve özeti dosya adıyla doğrulanmış ek baytları. */
    class Okunan(val belge: String, val ekler: Map<String, ByteArray>)

    /**
     * Dışa aktarmayı kaba yazar. Her ekin baytı [depo]'dan okunur, özeti ve boyu denetlenir.
     * @throws YedekHatasi ek eksik ya da bozuksa; [IOException] yazılamazsa.
     */
    fun yaz(cikis: OutputStream, bicim: AktarmaBicimi, disa: DisaAktarma, depo: EkDeposu) {
        // Belgenin UTF-8 kopyası tutulmaz: boy önce sayılır, metin parça parça kodlanıp yazılır.
        if (utf8Boyu(disa.belge) > bicim.belgeAzamiBayt.toLong()) throw YedekHatasi.CokBuyuk()
        val z = ZipOutputStream(cikis)
        z.putNextEntry(ZipEntry(bicim.belgeAdi))
        utf8Yaz(disa.belge, z)
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
     * @param toplamAzamiBayt açılmış bütün girdilerin toplam sınırı (varsayılan: çekirdeğin belge sınırı; ekler
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
        val belge = Tutucu()
        val ekler = LinkedHashMap<String, ByteArray>()
        var toplam = 0L
        var dizinGoruldu = false
        try {
            ZipInputStream(ham).use { z ->
                while (true) {
                    val g = z.nextEntry ?: break
                    ham.payEkle(GIRDI_PAYI)
                    val ad = g.name
                    yoluDenetle(ad)
                    when {
                        ad == bicim.belgeAdi -> {
                            if (g.isDirectory || belge.bayt != null) throw YedekHatasi.GecersizDosya("belge yinelenmiş")
                            // Yerel değişkene alınmaz: dizinin tek başvurusu tutucudadır (çözülürken bırakılır).
                            belge.bayt = sinirliOku(z, minOf(belgeAzami, toplamAzamiBayt - toplam), g.size)
                            toplam += belge.bayt?.boy ?: 0
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
                            val b = sinirliOku(z, minOf(ekAzami, toplamAzamiBayt - toplam), g.size).tam()
                            toplam += b.size
                            if (EkDenetimi.ozet(b) != ozet) throw YedekHatasi.EkBozuk("ek özeti tutmuyor")
                            ekler[ozet] = b
                        }
                        else -> throw YedekHatasi.GecersizDosya("beklenmeyen girdi")
                    }
                    // Girdinin okunmamış kalanı (dizin girdisinin verisi gibi) `closeEntry`'de sayılmadan
                    // açılırdı: burada sayılarak tüketilir, toplam sınırı aşınca okuma kesilir.
                    toplam += sinirliAt(z, toplamAzamiBayt - toplam)
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
        if (belge.bayt == null) throw YedekHatasi.GecersizDosya("belge yok")
        return Okunan(utf8(belge), ekler)
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

    /** Okunmuş girdi: [dizi]'nin ilk [boy] baytı (dizi büyüyerek doldu; kesilmiş kopya çıkarılmaz). */
    private class Bayt(val dizi: ByteArray, val boy: Int) {
        /** Tam boylu dizi (ekler için; küçüktür). */
        fun tam(): ByteArray = if (boy == dizi.size) dizi else dizi.copyOf(boy)
    }

    /** Belgenin baytları; UTF-8 çözülürken bırakılır ki dizi ile metin aynı anda bellekte uzun kalmasın. */
    private class Tutucu(var bayt: Bayt? = null)

    /**
     * Girdiyi en çok [azami] bayta dek okur; fazlası [YedekHatasi.CokBuyuk]. Bellek: tek dizi, kopyasız döner.
     * [bildirilen] başlıktaki açılmış boy (bilinmiyorsa -1; zip'i bizim yazdığımız gibi akışla yazılmışsa hep
     * bilinmez): güvenilmez, yalnız ilk dizi boyu için ve [azami]'yle sınırlı. Bilinmiyorsa dizi 1,5 katla büyür.
     */
    private fun sinirliOku(z: InputStream, azami: Long, bildirilen: Long): Bayt {
        val ust = minOf(azami, (Int.MAX_VALUE - 16).toLong()).toInt().coerceAtLeast(0)
        var dizi = ByteArray(if (bildirilen in 0..ust.toLong()) bildirilen.toInt() + 1 else minOf(ust + 1, 64 * 1024))
        var n = 0
        while (true) {
            if (n == dizi.size) {
                // Sınır `ust`; bir fazlası taşmayı gösterir (dizi ust + 1'den büyümez).
                val yeni = minOf(ust.toLong() + 1, maxOf(dizi.size.toLong() * 3 / 2, dizi.size + 64L * 1024)).toInt()
                dizi = dizi.copyOf(yeni)
            }
            val r = z.read(dizi, n, dizi.size - n)
            if (r < 0) break
            n += r
            if (n > ust) throw YedekHatasi.CokBuyuk()
        }
        return Bayt(dizi, n)
    }

    /** Girdinin kalanını saklamadan okur ve sayar; [azami]'yi aşınca [YedekHatasi.CokBuyuk]. */
    private fun sinirliAt(z: InputStream, azami: Long): Long {
        val tampon = ByteArray(8 * 1024)
        var n = 0L
        while (true) {
            val r = z.read(tampon)
            if (r < 0) return n
            n += r
            if (n > azami) throw YedekHatasi.CokBuyuk()
        }
    }

    /**
     * Katı UTF-8 çözümü (bozuk dizi reddedilir). Bellek: karakter sayısı önce sayılır, tam boylu `CharArray`'e
     * doğrudan çözülür (kodlayıcının büyüyen tamponu ve `toString` kopyası yok); bayt dizisi `String` kurulmadan
     * bırakılır. Tepe: bayt + karakter dizisi, sonra karakter dizisi + `String`.
     */
    private fun utf8(t: Tutucu): String {
        // Çözüm ayrı çerçevede: döndüğünde bayt dizisine hiçbir yerel başvuru kalmaz.
        val (karakterler, boy) = coz(t)
        return String(karakterler, 0, boy)
    }

    private fun coz(t: Tutucu): Pair<CharArray, Int> {
        val b = t.bayt ?: throw YedekHatasi.GecersizDosya("belge yok")
        val d = b.dizi
        // BOM'suz yazılır; elle düzenlenmiş dosyada başta BOM varsa atlanır.
        val bas = if (b.boy >= 3 && d[0] == 0xEF.toByte() && d[1] == 0xBB.toByte() && d[2] == 0xBF.toByte()) 3 else 0
        val karakterler = CharArray(utf16Boyu(d, bas, b.boy))
        val cikti = CharBuffer.wrap(karakterler)
        val cozucu = Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        val r = cozucu.decode(ByteBuffer.wrap(d, bas, b.boy - bas), cikti, true)
        // Geçerli UTF-8'de sayım kesindir: taşma da bozuk girdi demektir.
        if (!r.isUnderflow || !cozucu.flush(cikti).isUnderflow) throw YedekHatasi.GecersizDosya("belge UTF-8 değil")
        t.bayt = null
        return karakterler to cikti.position()
    }

    /** Geçerli UTF-8'in UTF-16 boyu: devam baytı (10xxxxxx) sayılmaz, dört baytlık dizi iki karakterdir. */
    private fun utf16Boyu(d: ByteArray, bas: Int, son: Int): Int {
        var n = 0
        for (i in bas until son) {
            val x = d[i].toInt() and 0xFF
            if (x and 0xC0 != 0x80) n++
            if (x >= 0xF0) n++
        }
        return n
    }

    /** UTF-8 boyu (yalnız sınır denetimi için; eşsiz vekil `?` yerine 3 sayılır, yukarı yuvarlar). */
    private fun utf8Boyu(s: String): Long {
        var n = 0L
        var i = 0
        while (i < s.length) {
            val c = s[i]
            n += when {
                c.code < 0x80 -> 1
                c.code < 0x800 -> 2
                Character.isHighSurrogate(c) && i + 1 < s.length && Character.isLowSurrogate(s[i + 1]) -> { i++; 4 }
                else -> 3
            }
            i++
        }
        return n
    }

    /** [s]'yi 64 Ki karakterlik parçalarla UTF-8 yazar (eşsiz vekil `?` olur: `toByteArray` ile aynı). */
    private fun utf8Yaz(s: String, cikis: OutputStream) {
        val kodlayici = Charsets.UTF_8.newEncoder()
            .onMalformedInput(CodingErrorAction.REPLACE)
            .onUnmappableCharacter(CodingErrorAction.REPLACE)
        val giris = CharBuffer.wrap(s)
        val tampon = ByteBuffer.allocate(256 * 1024)
        fun bosalt() {
            cikis.write(tampon.array(), 0, tampon.position())
            tampon.clear()
        }
        while (true) {
            val r = kodlayici.encode(giris, tampon, true)
            if (r.isError) r.throwException()
            bosalt()
            if (r.isUnderflow) break
        }
        while (true) {
            val r = kodlayici.flush(tampon)
            bosalt()
            if (r.isUnderflow) break
        }
    }

    /** Ham (sıkıştırılmış) girdiyi sayar; [azami]'yi aşınca [YedekHatasi.CokBuyuk]. Sınır girdi başına büyür. */
    private class SinirliGiris(private val ic: InputStream, private var azami: Long) : InputStream() {
        private var n = 0L

        fun payEkle(pay: Long) {
            azami += pay
        }

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
