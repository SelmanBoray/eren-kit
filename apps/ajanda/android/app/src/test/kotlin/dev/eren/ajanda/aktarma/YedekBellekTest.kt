package dev.eren.ajanda.aktarma

import dev.eren.ajanda.cekirdek.AktarmaBicimi
import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.DisaAktarma
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * K6: büyük yedeğin (~25 MB belge, ~60 000 kayıt, Türkçe metin) okunurken yığın tepesi.
 *
 * - [buyukYedekOkunurTepeBellekYazilir] her koşuda: kap okunur, belge birebir döner; süreç içi tepe (çöp dahil,
 *   GC'ye bağlı üst sınır) standart çıktıya yazılır.
 * - [enAzYiginAranir] yalnız `AJANDA_BELLEK_OLC=1` ile: ayrı JVM'de (`-Xmx`, Serial GC, küçük genç kuşak) okumanın
 *   sığdığı en küçük yığın ikili aramayla bulunur. Bu, canlı tepe kümesidir (OOM eşiği).
 */
class YedekBellekTest {
    @Test
    fun buyukYedekOkunurTepeBellekYazilir() {
        val belge = belge(HEDEF_BAYT)
        val boy = belge.toByteArray(Charsets.UTF_8).size
        val kap = ByteArrayOutputStream().also { YedekKabi.yaz(it, BICIM, disa(belge), EkDeposu.Yok) }.toByteArray()
        // Varsayılan bellek bütçesiyle: uygulamanın kendi yaptığı büyük yedek kuralla reddedilmez.
        val (tepe, okunan) = surecIciTepe { YedekKabi.oku(ByteArrayInputStream(kap), BICIM) }
        assertEquals(belge, okunan.belge)
        println("BELLEK süreç içi: belge ${mb(boy)} MB (${belge.length} karakter), kap ${mb(kap.size)} MB, oku tepesi ~${mb(tepe)} MB (çöp dahil)")
    }

    @Test
    fun enAzYiginAranir() {
        assumeTrue("AJANDA_BELLEK_OLC=1 ile koşar", System.getenv("AJANDA_BELLEK_OLC") == "1")
        // 25 MB (gerçekçi büyük yedek) ve belge sınırına yakın (60 MiB) iki belge; gerçek sınırlarla.
        for (hedef in listOf(HEDEF_BAYT, SINIRA_YAKIN_BAYT)) {
            val dosya = File.createTempFile("ajanda-bellek", ".zip").apply { deleteOnExit() }
            val boy = run {
                val belge = belge(hedef)
                dosya.outputStream().use { YedekKabi.yaz(it, BICIM, disa(belge), EkDeposu.Yok) }
                OtomatikYedekci.utf8Boyu(belge)
            }
            // oku: bütçesiz (gerçek tepe); oku+butce: varsayılan bütçe kuralıyla (kuralın kabul ettiği en küçük
            // yığın); oku+indir: bütçesiz okuma + UniFFI'nin yerel belleğe indirişi.
            val sonuc = listOf("oku", "oku+butce", "oku+indir").associateWith { kip -> enAzYigin(dosya, kip) }
            println("BELLEK en az yığın: belge ${mb(boy)} MB; " + sonuc.entries.joinToString("; ") { "${it.key} ${it.value} MB" })
            // Kaba tavan: belgenin 8 katı (String'li uygulama ~5 katıydı: 123 MB; bayt tutan ~2-3 katı).
            assertTrue("$sonuc", sonuc.getValue("oku") <= 8 * boy / (1 shl 20) + 16)
            dosya.delete()
        }
    }

    /** Alt JVM'de [kip] işini `-Xmx` ile koşar; sığdığı en küçük MB (4 MB adımlı). */
    private fun enAzYigin(dosya: File, kip: String): Int {
        val java = File(System.getProperty("java.home"), "bin/java").path
        val cp = System.getProperty("java.class.path")
        val b = BICIM
        fun sigar(mb: Int): Boolean {
            val p = ProcessBuilder(
                java, "-Xmx${mb}m", "-Xms${mb}m", "-XX:+UseSerialGC", "-XX:MaxNewSize=4m", "-XX:NewSize=2m",
                "-cp", cp, BellekOlcumu::class.java.name, dosya.path, kip,
                b.belgeAzamiBayt.toString(), b.ekAzamiBayt.toString(), b.eklerToplamAzamiBayt.toString(),
                b.acilmisToplamAzamiBayt.toString(), b.ekAzamiAdet.toString(),
            ).redirectErrorStream(true).start()
            val cikti = p.inputStream.bufferedReader().readText()
            check(p.waitFor(120, TimeUnit.SECONDS)) { "alt JVM bitmedi" }
            return p.exitValue() == 0 && cikti.contains("TAMAM")
        }
        var alt = 8
        var ust = 1024
        check(sigar(ust)) { "1024 MB'a da sığmadı" }
        while (ust - alt > 4) {
            val orta = (alt + ust) / 2
            if (sigar(orta)) ust = orta else alt = orta
        }
        return ust
    }

    /** Kullanılan yığının (`Runtime`, çöp dahil) [is_] boyunca örneklenen tepesi, tabana göre. */
    private fun <T> surecIciTepe(is_: () -> T): Pair<Long, T> {
        val r = Runtime.getRuntime()
        fun kullanilan() = r.totalMemory() - r.freeMemory()
        repeat(3) { System.gc() }
        val taban = kullanilan()
        val tepe = AtomicLong(taban)
        val dur = AtomicBoolean(false)
        val ornekleyici = Thread {
            while (!dur.get()) {
                tepe.accumulateAndGet(kullanilan()) { a, b -> maxOf(a, b) }
                Thread.sleep(0, 200_000)
            }
        }.apply { isDaemon = true; start() }
        val sonuc = is_()
        dur.set(true)
        ornekleyici.join()
        tepe.accumulateAndGet(kullanilan()) { a, b -> maxOf(a, b) }
        return (tepe.get() - taban) to sonuc
    }

    internal companion object {
        const val HEDEF_BAYT = 25_000_000

        /** Belge sınırının (64 MiB) biraz altı. */
        const val SINIRA_YAKIN_BAYT = 60 * (1 shl 20)

        /** Gerçek sınırlar (çekirdekten, JNA). Alt JVM bunları argümanla alır (orada yerel kitaplık yüklenmez). */
        val BICIM: AktarmaBicimi by lazy { dev.eren.ajanda.cekirdek.aktarmaBicimi() }

        fun mb(b: Number) = "%.1f".format(b.toDouble() / (1 shl 20))

        fun disa(belge: String) = DisaAktarma(belge, 1, 0, 0, 0, CalismaKipi.YEREL, emptyList())

        /** Modelin kayıt JSON'una benzer, Türkçe içerikli belge (~[hedef] bayt). */
        fun belge(hedef: Int): String {
            val basliklar = listOf(
                "Diş hekimi randevusu", "Çarşamba toplantısı", "Ağrı kesici al", "Öğle yemeği: Şükrü ile",
                "İlaç saatleri", "Göz doktoru kontrolü", "Kira ödemesi", "Işık faturası", "Çocukları okuldan al",
            )
            val aciklamalar = listOf(
                "Kadıköy şubesinde, önceki ölçümleri ve sigorta kartını getir; geç kalırsan ara.",
                "Gündem: bütçe, işe alım, yıl sonu planı. Sunum dosyası paylaşılan klasörde.",
                "Günde iki kez, yemekten sonra; yan etki görürsen doktora söyle.",
                "Üsküdar'daki yeni yerde; rezervasyon Şükrü'nün adına yapıldı.",
            )
            val s = StringBuilder(hedef + 4096)
            s.append("""{"bicim":"eren_ajanda_yedegi","bicim_surumu":1,"bolgeler":[],"ekler":[],"kayitlar":[""")
            var i = 0
            while (s.length < hedef) {
                if (i > 0) s.append(',')
                val an = 1_790_000_000_000L + i * 3_600_000L
                s.append("""{"aciklama":"""").append(aciklamalar[i % aciklamalar.size]).append("""","baslik":"""")
                    .append(basliklar[i % basliklar.size]).append(" #").append(i)
                    .append("""","durum":"bekliyor","elle_alanlar":["baslik"],"guncelleme_ms":""").append(an + 17)
                    .append(""","hatirlatma":{"dakika_once":15},"kaynak":{"tur":"elle"},"kayit_id":"k_""")
                    .append(java.lang.Long.toHexString(an * 31 + i)).append("""","olusturma_ms":""").append(an)
                    .append(""","ornekler":[],"revizyon":""").append(i % 7 + 1)
                    .append(""","silindi":false,"taslak":false,"tur":"randevu","zaman":{"bas_ms":""").append(an)
                    .append(""","dilim":"Europe/Istanbul","tum_gun":false}}""")
                i++
            }
            s.append("""],"kip":"yerel","olusturma_ms":1790000000000,"sozlesme_surumu":3,"uygulama_surumu":"0.1"}""")
            return s.toString()
        }
    }
}

/**
 * Alt JVM işi: kabı okur. [args]: dosya, kip, sonra biçim sınırları (belge, ek, ekler toplamı, açılmış toplam, ek
 * adedi; üst JVM çekirdekten okur). Kip `oku`: bütçesiz (gerçek tepe); `oku+butce`: varsayılan bellek bütçesiyle
 * ([YedekKabi.bellekButcesi]; reddederse sığmadı sayılır); `oku+indir`: bütçesiz okuma ve UniFFI'nin belgeyi
 * çekirdeğe indirişinin taklidi. Belge bayt olarak tutulur ve bayt API'sine gider: UniFFI
 * `FfiConverterByteArray.lower` `RustBuffer`'ı yerel bellekte ayırıp baytları oraya yazar (yığında kopya yok);
 * burada JNA `Memory` ile aynısı yapılır.
 */
object BellekOlcumu {
    @JvmStatic
    fun main(args: Array<String>) {
        val bicim = AktarmaBicimi(
            "ajanda.json", "ekler/", 1, args[2].toULong(), args[3].toULong(), args[4].toULong(), args[5].toULong(), args[6].toUInt(),
        )
        val okunan = File(args[0]).inputStream().use {
            if (args[1] == "oku+butce") YedekKabi.oku(it, bicim) else YedekKabi.oku(it, bicim, Long.MAX_VALUE)
        }
        var n = okunan.baytlar.size.toLong()
        if (args[1] == "oku+indir") {
            val yerel = com.sun.jna.Memory(4L + okunan.baytlar.size)
            yerel.setInt(0, okunan.baytlar.size)
            yerel.write(4, okunan.baytlar, 0, okunan.baytlar.size)
            n += yerel.size()
            yerel.close()
        }
        println("TAMAM $n")
    }
}
