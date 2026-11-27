package dev.eren.ajanda.kimlik

import dev.eren.ajanda.cekirdek.AjandaKanalHatasi
import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * D6: kullanıcıya görünen metinlerde "PC" sözcüğü geçmez (servis "Eren servisi", makine "bilgisayar").
 * İki yoldan: (1) `kimlik/`, `aktarma/` ve D6'nın yeni dosyalarının kaynağındaki bütün dize sabitleri
 * (yorumlar ve `${...}` içindeki kod hariç; `EslestirmeEkrani` gibi JVM'de çalışmayan ekranlar da
 * böylece kapsanır), (2) metin işlevlerinin her dalının çıktısı. `ekran/` Kol U'nundur, kapsam dışı.
 */
class KullaniciMetniTest {
    private val pc = Regex("(?<![\\p{L}\\p{N}_])PC(?![\\p{L}\\p{N}_])")

    private fun kaynakKoku(): File {
        val yol = "src/main/kotlin/dev/eren/ajanda"
        var d: File? = File(System.getProperty("user.dir")).absoluteFile
        while (d != null) {
            for (aday in listOf(File(d, yol), File(d, "app/$yol"), File(d, "apps/ajanda/android/app/$yol"))) {
                if (aday.isDirectory) return aday
            }
            d = d.parentFile
        }
        throw AssertionError("Kaynak dizini bulunamadı: $yol (user.dir=${System.getProperty("user.dir")})")
    }

    private fun taranacaklar(): List<File> {
        val kok = kaynakKoku()
        val dizinler = listOf("kimlik", "aktarma").flatMap { p ->
            File(kok, p).listFiles { f -> f.extension == "kt" }.orEmpty().toList()
        }
        val tekler = listOf("alarm/IzinPlani.kt").map { File(kok, it) }
        tekler.forEach { assertTrue("yok: $it", it.isFile) }
        return (dizinler + tekler).sortedBy { it.path }
    }

    @Test
    fun kaynaktakiDizelerdePcYok() {
        val dosyalar = taranacaklar()
        assertTrue(dosyalar.any { it.name == "EslestirmeEkrani.kt" })
        assertTrue(dosyalar.any { it.name == "GecisMetinleri.kt" })
        assertTrue(dosyalar.any { it.name == "AktarmaMetinleri.kt" })
        val bulunan = dosyalar.flatMap { f ->
            KotlinDizeleri.ayikla(f.readText()).filter { pc.containsMatchIn(it) }.map { "${f.name}: \"$it\"" }
        }
        assertTrue("\"PC\" geçen kullanıcı metinleri:\n" + bulunan.joinToString("\n"), bulunan.isEmpty())
    }

    @Test
    fun ayiklayiciYorumuAtlarDizeyiBulur() {
        val ornek = """
            // PC yorumda
            /* PC /* iç içe */ PC */
            val a = "bir PC" + 'x' + '"'
            val b = "dış ${'$'}{if (x) "iç PC" else "z"} son"
            val c = ${"\"\"\""}ham "PC" metin${"\"\"\""}
            val d = "kaçış \" PC"
        """.trimIndent()
        val d = KotlinDizeleri.ayikla(ornek)
        assertTrue(d.toString(), d.contains("bir PC"))
        assertTrue(d.toString(), d.contains("iç PC"))
        assertTrue(d.toString(), d.any { it.contains("ham \"PC\" metin") })
        assertTrue(d.toString(), d.any { it.contains("kaçış \\\" PC") })
        assertTrue(d.toString(), d.none { it.contains("yorumda") || it.contains("iç içe") })
    }

    @Test
    fun metinIslevlerininCiktisindaPcYok() {
        val m = EslestirmeMetinleri
        val metinler = buildList {
            add(m.BASLIK)
            addAll(m.ADIMLAR)
            listOf(
                VeriHatasi.CokUzun, VeriHatasi.JsonSatiriYok, VeriHatasi.JsonDegil, VeriHatasi.BaskaKanal,
                VeriHatasi.ParmakIziUyusmuyor, VeriHatasi.GecersizAlan("v", "x"), VeriHatasi.GecersizAlan("host", "x"),
                VeriHatasi.GecersizAlan("port", "x"),
            ).forEach { add(m.veriHatasi(it)) }
            listOf(KodHatasi.Bos, KodHatasi.Kisa, KodHatasi.Uzun, KodHatasi.GecersizKarakter, KodHatasi.VeriyleUyusmuyor)
                .forEach { add(m.kodHatasi(it)) }
            add(m.bilgi(Bilgi.Kaldirildi("cihaz_X")))
            (BaglantiAsamasi.entries + listOf(null)).forEach { add(m.asama(it)) }
            listOf(
                EslestirmeHatasi.YanlisKod, EslestirmeHatasi.PencereKapali, EslestirmeHatasi.YanlisKanal,
                EslestirmeHatasi.IpUyusmuyor, EslestirmeHatasi.AgYok,
                EslestirmeHatasi.PcyeUlasilamadi(false, null, null),
                EslestirmeHatasi.PcyeUlasilamadi(true, BaglantiAsamasi.ESLESTIRME, AjandaKanalHatasi.ZAMAN_ASIMI),
                EslestirmeHatasi.PcyeUlasilamadi(true, BaglantiAsamasi.KOPUK, null),
                EslestirmeHatasi.PcReddetti(AjandaKanalHatasi.IC_HATA), EslestirmeHatasi.Cekirdek("x"),
            ).forEach { val (b, a) = m.hata(it); add(b); add(a) }
            add(m.adres("100.64.0.1", 8765))
            add(m.PARMAK_IZI_ACIKLAMASI)
            add(m.KALDIRMA_BASLIGI)
            add(m.KALDIRMA_ONAYI)
            addAll(GecisMetinleriTest.ornekMetinler())
        }
        val bulunan = metinler.filter { pc.containsMatchIn(it) }
        assertTrue("\"PC\" geçen metinler:\n" + bulunan.joinToString("\n"), bulunan.isEmpty())
    }

    @Test
    fun kaldirmaOnayiYeniDavranisiSoyler() {
        val o = EslestirmeMetinleri.KALDIRMA_ONAYI
        assertTrue(o.contains("bu telefonda kalır"))
        assertTrue(o.contains("çalışmayı sürdürür"))
        assertTrue(o.contains("yedek olarak durur"))
        assertTrue(o.contains("komut gösterilir"))
        // Eski (yanlış) metin: "Telefondaki ajanda kopyası ... ve kurulu hatırlatmalar silinir".
        assertTrue(!o.contains("ajanda kopyası") && !o.contains("hatırlatmalar silinir"))
        val b = EslestirmeMetinleri.bilgi(Bilgi.Kaldirildi("cihaz_X"))
        assertTrue(b.contains("bu telefonda duruyor"))
        assertTrue(b.contains("yedek olarak duruyor"))
    }
}

/** Kotlin kaynağındaki dize sabitlerinin metin parçaları (yorumlar ve şablon içi kod hariç). Testlik, yalın. */
internal object KotlinDizeleri {
    fun ayikla(kaynak: String): List<String> {
        val sonuc = mutableListOf<String>()
        Ayiklayici(kaynak, sonuc).kod(sonaKadar = true)
        return sonuc
    }

    private class Ayiklayici(val s: String, val sonuc: MutableList<String>) {
        var i = 0

        private fun bas(onek: String) = s.startsWith(onek, i)

        /** Kod kipi; `sonaKadar` yanlışsa eşlenmemiş `}`'de (şablon sonu) döner. */
        fun kod(sonaKadar: Boolean) {
            var derinlik = 0
            while (i < s.length) {
                when {
                    bas("//") -> { while (i < s.length && s[i] != '\n') i++ }
                    bas("/*") -> blokYorum()
                    bas("\"\"\"") -> { i += 3; dize(ham = true) }
                    s[i] == '"' -> { i++; dize(ham = false) }
                    s[i] == '\'' -> karakter()
                    s[i] == '{' -> { derinlik++; i++ }
                    s[i] == '}' -> {
                        if (derinlik == 0 && !sonaKadar) { i++; return }
                        derinlik--; i++
                    }
                    else -> i++
                }
            }
        }

        private fun blokYorum() {
            var d = 0
            while (i < s.length) {
                when {
                    bas("/*") -> { d++; i += 2 }
                    bas("*/") -> { d--; i += 2; if (d == 0) return }
                    else -> i++
                }
            }
        }

        private fun karakter() {
            i++
            if (i < s.length && s[i] == '\\') i += 2 else i++
            while (i < s.length && s[i] != '\'') i++
            i++
        }

        private fun dize(ham: Boolean) {
            val parca = StringBuilder()
            fun bitir() { if (parca.isNotEmpty()) sonuc += parca.toString(); parca.clear() }
            while (i < s.length) {
                when {
                    ham && bas("\"\"\"") -> {
                        i += 3
                        while (i < s.length && s[i] == '"') { parca.append('"'); i++ }
                        bitir(); return
                    }
                    !ham && s[i] == '"' -> { i++; bitir(); return }
                    !ham && s[i] == '\\' && i + 1 < s.length -> { parca.append(s, i, i + 2); i += 2 }
                    bas("\${") -> { i += 2; kod(sonaKadar = false) }
                    else -> { parca.append(s[i]); i++ }
                }
            }
            bitir()
        }
    }
}
