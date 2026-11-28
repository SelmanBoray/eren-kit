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
 * güvenilmeden açılırken sayılır: belge (`belgeAzamiBayt`), her ek (`ekAzamiBayt`), eklerin toplamı
 * (`eklerToplamAzamiBayt`), ek adedi (`ekAzamiAdet`) ve açılmış toplam (`acilmisToplamAzamiBayt`) ayrı
 * sınırlıdır (şişirme saldırısı). Toplama her girdinin açılmış baytı girer, saklanmayanlarınki (dizin
 * girdisi) de; aşan okuma ilk fazla tamponda kesilir. Biçim sınırları yalnız çekirdekten okunur
 * (`aktarmaBicimi()`); burada sabit yok ([Sinirlar]).
 *
 * Bellek: biçim sınırlarının üstüne okuma, yığının o an ayırabileceğiyle de sınırlıdır ([bellekButcesi]):
 * güvenilmeyen dosya ancak bütçenin içinde belleğe alınır, aşan okuma [YedekHatasi.BellekYetmez]'le kesilir
 * (başka bir iş parçacığı `OutOfMemoryError` almasın; tek koruma o hatayı yakalamak olmasın).
 *
 * Yazarken sınır yok: uygulamanın kendi belgesi içe aktarma sınırını aşsa da yazılır (veri yalnız telefonda
 * kalmasın); bunu söylemek çağıranın işidir (`DisaAktarma.iceAktarmaSiniriniAsiyor`).
 *
 * Mahremiyet: hata mesajları dosya içeriği ya da girdi adı taşımaz.
 */
object YedekKabi {
    /**
     * Okumanın yığından ayırabileceği bütçe: `maxMemory - kullanılan - pay`. Pay en az [BELLEK_PAYI_EN_AZ], büyük
     * yığında yığının dörtte biri: arayüz, eşitleme ve alarm iş parçacıkları okuma sürerken de bellek ister.
     * Kullanılan çöpü de sayar (yukarı yuvarlar); bütçe gerekenden azsa bir kez `gc` istenip yeniden bakılır.
     * Ölçüm (K6, `YedekBellekTest`): 25 MB belgenin okunması en az ~2 x belge yığınla sığar; bütçe belgeyi 2 kat
     * sayar ([oku]).
     */
    const val BELLEK_PAYI_EN_AZ = 32L shl 20

    /** Pay, yığının bu kesri (1/4) ile [BELLEK_PAYI_EN_AZ]'ın büyüğüdür. */
    private const val BELLEK_PAYI_BOLEN = 4

    /**
     * Okurken geçici çarpan: belge parçalarda toplanıp sonunda tek diziye kopyalanır (tepe 2 x belge); ek dizisi
     * 1,5 katla büyür (tepe ~2,5 x ek; ek en çok 4 MiB, fark payın içinde kalır).
     */
    private const val GECICI_CARPAN = 2L

    /**
     * Çekirdeğin [AktarmaBicimi]'nden okuma sınırları. Sürümler arası köprüde yeni alanlar 0 gelebilir (eski
     * kurulum ya da sahte): eklerin toplamı ve adedi 0 ise ek kabul edilmez (en dar), açılmış toplam 0 ise
     * köprü belgesindeki tanımından (`belge + ekler toplamı`) türetilir.
     */
    class Sinirlar(bicim: AktarmaBicimi) {
        val belge = bicim.belgeAzamiBayt.sinir()
        val ek = bicim.ekAzamiBayt.sinir()
        val eklerToplam = bicim.eklerToplamAzamiBayt.sinir()
        val acilmisToplam = bicim.acilmisToplamAzamiBayt.sinir().takeIf { it > 0 } ?: (belge + eklerToplam)
        val ekAdet = bicim.ekAzamiAdet.toLong().coerceAtMost(Int.MAX_VALUE.toLong()).toInt()

        /** Biçimin izin verdiği en büyük kabın okunurken isteyebileceği yığın (bütçenin karşılaştırıldığı). */
        val enCokBellek: Long get() = GECICI_CARPAN * minOf(belge, acilmisToplam) + minOf(eklerToplam, acilmisToplam)

        private fun ULong.sinir(): Long = if (this > Long.MAX_VALUE.toULong()) Long.MAX_VALUE else toLong()
    }

    /**
     * Şu an okumaya ayrılabilecek yığın baytı (bkz. [BELLEK_PAYI_EN_AZ]). [gereken]'den azsa bir kez çöp
     * toplanması istenip yeniden ölçülür. `maxMemory` sınırsızsa sınırsız.
     */
    fun bellekButcesi(gereken: Long, r: Runtime = Runtime.getRuntime()): Long {
        val azami = r.maxMemory()
        if (azami == Long.MAX_VALUE) return Long.MAX_VALUE
        val pay = maxOf(BELLEK_PAYI_EN_AZ, azami / BELLEK_PAYI_BOLEN)
        fun bos() = azami - (r.totalMemory() - r.freeMemory()) - pay
        var b = bos()
        if (b < gereken) {
            r.gc()
            b = bos()
        }
        return b.coerceAtLeast(0)
    }

    /**
     * Yeni açılmış uygulamanın içe aktarma başlamadan yığında zaten tuttuğu (arayüz, çekirdek bağlamaları, OkHttp).
     * Tahmindir, cihazda ölçülmedi; JVM testinde taban ~2 MB'tır (MIMARI.md ölçümü), View tabanlı küçük bir
     * uygulamanın açılışta 10-25 MB tuttuğu varsayıldı, üst yanı alındı.
     */
    const val TABAN_KULLANIM = 32L shl 20

    /**
     * Bu telefonda [oku]'nun en iyi durumda (uygulama yeni açılmış, yalnız [TABAN_KULLANIM] dolu) alabileceği bütçe:
     * `maxMemory - pay - taban` (pay [bellekButcesi]'ndekiyle aynı). `maxMemory` sınırsızsa sınırsız. 128 MiB'lık
     * yığında 64 MiB: [acmaBellegi] 64 MiB'ı (32 MiB belge) aşan dosya bu telefonda açılmaz; 192 MiB'ta 112 MiB
     * (56 MiB belge); 256 MiB'ta 160 MiB (80 MiB belge: çekirdeğin 64 MiB sınırının üstü, uyarı çıkmaz).
     */
    fun buTelefondaAcmaButcesi(azami: Long = Runtime.getRuntime().maxMemory()): Long {
        if (azami == Long.MAX_VALUE) return Long.MAX_VALUE
        val pay = maxOf(BELLEK_PAYI_EN_AZ, azami / BELLEK_PAYI_BOLEN)
        return (azami - pay - TABAN_KULLANIM).coerceAtLeast(0)
    }

    /**
     * [oku]'nun bu kabı açmak için isteyeceği bütçe (yazıldığı sırayla: önce belge, sonra özeti tekil ekler).
     * Belge okunurken 2 kat sayılır; her ek okunurken o ana dek tutulan + 2 x ek. [belgeBayt]: belgenin UTF-8 boyu
     * ([utf8Boyu]).
     */
    fun acmaBellegi(belgeBayt: Long, ekler: List<EkDosyasi>): Long {
        var en = GECICI_CARPAN * belgeBayt
        var tutulan = belgeBayt
        for (ek in ekler.distinctBy { it.ozet }) {
            en = maxOf(en, tutulan + GECICI_CARPAN * ek.bayt)
            tutulan += ek.bayt
        }
        return en
    }

    /** [yaz]'ın yazdığı UTF-8 boyu: eşsiz vekil `?` (1 bayt) olur. */
    fun utf8Boyu(s: String): Long {
        var n = 0L
        var i = 0
        while (i < s.length) {
            val c = s[i]
            n += when {
                c.code < 0x80 -> 1
                c.code < 0x800 -> 2
                Character.isHighSurrogate(c) && i + 1 < s.length && Character.isLowSurrogate(s[i + 1]) -> { i++; 4 }
                Character.isSurrogate(c) -> 1
                else -> 3
            }
            i++
        }
        return n
    }

    /**
     * Yazılan belge içe aktarma sınırının altında ama bu telefonda açmaya gereken bellek [butce]'yi aşıyor mu
     * (sınır aşılıyorsa yanlış: o uyarı ayrıdır ve daha güçlüdür).
     */
    fun buTelefondaAcilamayabilir(disa: DisaAktarma, butce: Long): Boolean =
        !disa.iceAktarmaSiniriniAsiyor && acmaBellegi(utf8Boyu(disa.belge), disa.ekler) > butce

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

    /**
     * Okunan kap: belgenin UTF-8 baytları (doğrulanmış, BOM'suz, tam boylu dizi; çekirdeğin bayt API'sine
     * kopyasız verilir) ve özeti dosya adıyla doğrulanmış ek baytları.
     */
    class Okunan(val baytlar: ByteArray, val ekler: Map<String, ByteArray>) {
        /** Belgenin metni (her çağrıda yeniden çözülür; büyük belgede bellek ister, akış bunu kullanmaz). */
        val belge: String get() = String(baytlar, Charsets.UTF_8)
    }

    /**
     * Dışa aktarmayı kaba yazar. Her ekin baytı [depo]'dan okunur, özeti ve boyu denetlenir. Belge boyu
     * sınırlanmaz: içe aktarma sınırını aşan belge de yazılır (bkz. sınıf belgesi).
     * @throws YedekHatasi ek eksik ya da bozuksa; [IOException] yazılamazsa.
     */
    fun yaz(cikis: OutputStream, bicim: AktarmaBicimi, disa: DisaAktarma, depo: EkDeposu) {
        // Belgenin UTF-8 kopyası tutulmaz: metin parça parça kodlanıp yazılır.
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
     * Kabı okur ve doğrular (belgenin içeriğine bakmaz: o çekirdeğin işi). Sınırlar [bicim]'dendir ([Sinirlar]).
     * @param bellekButcesi okumanın yığından ayırabileceği bayt (varsayılan: [bellekButcesi]). Belge okunurken
     *   2 kat sayılır (geçici kopya), ekler okunurken 2 kat, sonra 1 kat; aşan okuma [YedekHatasi.BellekYetmez].
     * @throws YedekHatasi geçersiz kap, çok büyük, bellek yetmez, bozuk ek; [IOException] okunamazsa.
     */
    fun oku(
        giris: InputStream,
        bicim: AktarmaBicimi,
        bellekButcesi: Long = bellekButcesi(Sinirlar(bicim).enCokBellek),
    ): Okunan {
        val s = Sinirlar(bicim)
        val toplamAzamiBayt = s.acilmisToplam
        // Sıkıştırılmış girdi de sayılır: açılmış toplamdan büyük ham dosya okunmaz.
        val ham = SinirliGiris(giris, toplamAzamiBayt + HAM_PAYI)
        var belge: ByteArray? = null
        val ekler = LinkedHashMap<String, ByteArray>()
        var toplam = 0L
        var eklerToplam = 0L
        /** Okunup tutulan baytlar (belge + ekler): bütçeden düşülür. */
        var tutulan = 0L
        var dizinGoruldu = false
        fun bellekKalani() = ((bellekButcesi - tutulan) / GECICI_CARPAN).coerceAtLeast(0)
        try {
            ZipInputStream(ham).use { z ->
                while (true) {
                    val g = z.nextEntry ?: break
                    ham.payEkle(GIRDI_PAYI)
                    val ad = g.name
                    yoluDenetle(ad)
                    when {
                        ad == bicim.belgeAdi -> {
                            if (g.isDirectory || belge != null) throw YedekHatasi.GecersizDosya("belge yinelenmiş")
                            val (b, okunanBoy) = belgeyiOku(z, minOf(s.belge, toplamAzamiBayt - toplam), bellekKalani())
                            belge = b
                            toplam += okunanBoy
                            tutulan += b.size
                        }
                        ad == bicim.eklerDizini && g.isDirectory -> {
                            if (dizinGoruldu) throw YedekHatasi.GecersizDosya("dizin yinelenmiş")
                            dizinGoruldu = true
                        }
                        ad.startsWith(bicim.eklerDizini) && !g.isDirectory &&
                            OZET.matches(ad.substring(bicim.eklerDizini.length)) -> {
                            val ozet = ad.substring(bicim.eklerDizini.length)
                            if (ozet in ekler) throw YedekHatasi.GecersizDosya("ek yinelenmiş")
                            if (ekler.size >= s.ekAdet) throw YedekHatasi.CokBuyuk()
                            val azami = minOf(s.ek, s.eklerToplam - eklerToplam, toplamAzamiBayt - toplam)
                            val b = sinirliOku(z, azami, bellekKalani(), g.size).tam()
                            toplam += b.size
                            eklerToplam += b.size
                            tutulan += b.size
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
        val b = belge ?: throw YedekHatasi.GecersizDosya("belge yok")
        utf8Denetle(b)
        return Okunan(b, ekler)
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

    /** Okunan bayt [n] sınırı aştıysa: biçim sınırı ([azami]) [YedekHatasi.CokBuyuk], bellek ([bellek]) [YedekHatasi.BellekYetmez]. */
    private fun asildiysa(n: Long, azami: Long, bellek: Long) {
        if (n > azami) throw YedekHatasi.CokBuyuk()
        if (n > bellek) throw YedekHatasi.BellekYetmez()
    }

    /**
     * Girdiyi en çok [azami] bayta (biçim) ve [bellek] bayta (bütçe) dek okur; fazlası [asildiysa]. Bellek: tek dizi,
     * kopyasız döner. [bildirilen] başlıktaki açılmış boy (bilinmiyorsa -1; zip'i bizim yazdığımız gibi akışla
     * yazılmışsa hep bilinmez): güvenilmez, yalnız ilk dizi boyu için ve sınırla kırpılır. Bilinmiyorsa dizi 1,5
     * katla büyür.
     */
    private fun sinirliOku(z: InputStream, azami: Long, bellek: Long, bildirilen: Long): Bayt {
        val ust = minOf(azami, bellek, (Int.MAX_VALUE - 16).toLong()).toInt().coerceAtLeast(0)
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
            if (n > ust) asildiysa(n.toLong(), azami, bellek)
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
     * Belge girdisini en çok [azami] bayta (biçim) ve [bellek] bayta (bütçe) dek okur; fazlası [asildiysa]. Baytlar
     * büyüyen parçalarda (64 KiB'ten 4 MiB'e) toplanır, sonunda tam boylu tek diziye bir kez kopyalanır: tepe
     * ~2 x belge (büyüyen tek dizinin 1,5 kat payı ve son kesme kopyası yok). Baştaki UTF-8 BOM'u atılır (BOM'suz
     * yazılır; elle düzenlenmiş dosyada olabilir). Dönen: (BOM'suz dizi, okunan bayt sayısı BOM dahil).
     */
    private fun belgeyiOku(z: InputStream, azami: Long, bellek: Long): Pair<ByteArray, Long> {
        val ust = minOf(azami, bellek, (Int.MAX_VALUE - 16).toLong()).coerceAtLeast(0)
        val parcalar = ArrayList<ByteArray>()
        var son = ByteArray(minOf(ust + 1, 64L * 1024).toInt().coerceAtLeast(1))
        var sondaki = 0
        var n = 0L
        while (true) {
            if (sondaki == son.size) {
                parcalar += son
                son = ByteArray(minOf(son.size.toLong() * 2, 4L shl 20, ust + 1 - n).toInt().coerceAtLeast(1))
                sondaki = 0
            }
            val r = z.read(son, sondaki, son.size - sondaki)
            if (r < 0) break
            sondaki += r
            n += r
            if (n > ust) asildiysa(n, azami, bellek)
        }
        parcalar += son
        val bom = n >= 3 && bayt(parcalar, 0) == 0xEF.toByte() && bayt(parcalar, 1) == 0xBB.toByte() &&
            bayt(parcalar, 2) == 0xBF.toByte()
        val bas = if (bom) 3 else 0
        val sonuc = ByteArray((n - bas).toInt())
        var atla = bas
        var yer = 0
        for ((i, p) in parcalar.withIndex()) {
            val dolu = if (i == parcalar.lastIndex) sondaki else p.size
            val k = minOf(atla, dolu)
            atla -= k
            System.arraycopy(p, k, sonuc, yer, dolu - k)
            yer += dolu - k
            parcalar[i] = BOS
        }
        return sonuc to n
    }

    private val BOS = ByteArray(0)

    /** Parçalı belgenin [i]. baytı (yalnız BOM bakışı için; i < 3). */
    private fun bayt(parcalar: List<ByteArray>, i: Int): Byte {
        var k = i
        for (p in parcalar) {
            if (k < p.size) return p[k]
            k -= p.size
        }
        return 0
    }

    /** Katı UTF-8 denetimi (bozuk dizi reddedilir); çözüm küçük bir tampona akar, metin tutulmaz. */
    private fun utf8Denetle(d: ByteArray) {
        val cozucu = Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        val giris = ByteBuffer.wrap(d)
        val tampon = CharBuffer.allocate(64 * 1024)
        while (true) {
            val r = cozucu.decode(giris, tampon, true)
            if (r.isError) throw YedekHatasi.GecersizDosya("belge UTF-8 değil")
            tampon.clear()
            if (r.isUnderflow) break
        }
        while (true) {
            val r = cozucu.flush(tampon)
            if (r.isError) throw YedekHatasi.GecersizDosya("belge UTF-8 değil")
            tampon.clear()
            if (r.isUnderflow) break
        }
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

    /** Belge, bir ek, eklerin toplamı, açılmış toplam ya da ek sayısı biçim sınırını aşıyor. */
    class CokBuyuk : YedekHatasi("çok büyük")

    /** Biçim sınırının altında ama okuma yığının o an ayırabileceği bütçeyi aşıyor ([YedekKabi.bellekButcesi]). */
    class BellekYetmez : YedekHatasi("bellek yetmez")

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
