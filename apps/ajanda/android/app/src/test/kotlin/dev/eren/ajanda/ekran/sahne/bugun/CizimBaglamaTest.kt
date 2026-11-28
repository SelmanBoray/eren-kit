package dev.eren.ajanda.ekran.sahne.bugun

import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import dev.eren.ajanda.ekran.an
import dev.eren.ajanda.ekran.gun
import dev.eren.ajanda.ekran.kayit
import dev.eren.ajanda.ekran.sahne.bilesen.Boyama
import dev.eren.ajanda.ekran.sahne.cizim.CIZIM_ANAHTARLARI
import dev.eren.ajanda.ekran.sahne.cizim.varsayilanLevhaRengi
import dev.eren.ajanda.ekran.sahne.ekranlar.BugunHareketleri
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import dev.eren.ajanda.ekran.sahne.veri.BugunDenetleyici
import dev.eren.ajanda.ekran.sahne.veri.BugunKaydi
import dev.eren.ajanda.ekran.sahne.veri.Gorunus
import dev.eren.ajanda.ekran.sahne.veri.KomsuRenk
import dev.eren.ajanda.ekran.sahne.veri.LevhaHali
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.asCoroutineDispatcher
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.Executor
import kotlin.random.Random

/**
 * Bugün levhalarının çizime bağlanması: anahtar seçimi (simge > başlık önerisi > genel), rengin anahtardan
 * gelmesi, komşu levhaların aynı takıma düşmemesi, "hareketi azalt"ta köpük patlaması ve boyamanın anında bitmesi.
 */
class CizimBaglamaTest {

    // --- Anahtar seçimi ---

    @Test
    fun anahtarBasliktanOnerilirEslesmeYoksaGenel() {
        assertEquals("araba", Gorunus.cizim(null, "Arabayı yıkat"))
        assertEquals("kahve", Gorunus.cizim(null, "Kahve molası"))
        assertEquals("dis", Gorunus.cizim(null, "DİŞ kontrolü"))
        assertEquals("genel", Gorunus.cizim(null, "Qwxz zvq"))
        assertEquals("genel", Gorunus.cizim(null, ""))
        // Sonuç her zaman çizilebilen bir anahtar.
        for (b in listOf("Arabayı yıkat", "Kira öde", "Vesikalık fotoğraf çektir", "Pazartesi planı")) {
            assertTrue(b, Gorunus.cizim(null, b) in CIZIM_ANAHTARLARI)
        }
        // "fotoğraf" içindeki "oto" arabaya düşmez (kelime başı kuralı, SAHNE.md §7.1).
        assertNotEquals("araba", Gorunus.cizim(null, "Vesikalık fotoğraf çektir"))
    }

    @Test
    fun kayitSimgesiOneridenOnceGelir() {
        // v3: kaydın simge alanı verilince başlık önerisi yok sayılır.
        assertEquals("araba", Gorunus.cizim("araba", "Kahve molası"))
        // Biçim dışı simge (sözleşme deseni dışı: büyük harf, boşluk) öneriye düşmez, genel çizer (v3 okuma).
        assertEquals("genel", Gorunus.cizim(" ARABA ", "Kahve molası"))
        // Bilinmeyen simge (yeni sürümden) genel çizer, öneriye düşmez.
        assertEquals("genel", Gorunus.cizim("uzay_gemisi", "Kahve molası"))
        // Boş simge "yok" sayılır: öneri çalışır.
        assertEquals("kahve", Gorunus.cizim("  ", "Kahve molası"))
    }

    @Test
    fun levhaRengiAnahtarinVarsayilanTakimi() {
        val c = BugunCekirdegi()
        c.ekle(
            kayit("araba", "Arabayı yıkat", an(GUN.toString(), "15:00")),
            kayit("x", "Qwxz zvq", an(GUN.toString(), "18:00")),
        )
        val m = model(c)
        val araba = m.acikler.single { it.kayitId == "araba" }
        assertEquals("araba", araba.cizim)
        assertEquals(varsayilanLevhaRengi("araba"), araba.renk)
        assertEquals(LevhaRengi.KOBALT, araba.renk)
        val bilinmeyen = m.acikler.single { it.kayitId == "x" }
        assertEquals("genel", bilinmeyen.cizim)
        assertEquals(varsayilanLevhaRengi("genel"), bilinmeyen.renk)
        // Kimlik rengi etkilemez: aynı başlık, farklı kimlik, aynı takım (komşu değillerse).
        assertEquals(Gorunus.renkAnahtardan(Gorunus.cizim(null, "Kahve")), varsayilanLevhaRengi("kahve"))
    }

    // --- Komşu renk kuralı ---

    private fun k(id: String, renk: LevhaRengi) =
        BugunKaydi(anahtar = id, kayitId = id, baslik = id, zaman = null, renk = renk, cizim = null, hal = LevhaHali.ACIK)

    @Test
    fun yanYanaAyniTakimYakinTakimaKayar() {
        val l = KomsuRenk.ayir(listOf(k("a", LevhaRengi.HARDAL), k("b", LevhaRengi.HARDAL)))
        assertEquals(LevhaRengi.HARDAL, l[0].renk)
        // Hardalın en yakını domates.
        assertEquals(LevhaRengi.DOMATES, l[1].renk)
    }

    @Test
    fun ilkKayitVeCakismayanlarKendiTakimindaKalir() {
        val giris = listOf(k("a", LevhaRengi.KOBALT), k("b", LevhaRengi.HARDAL), k("c", LevhaRengi.PEMBE))
        val l = KomsuRenk.ayir(giris)
        for (i in giris.indices) assertSame(giris[i], l[i])
    }

    @Test
    fun ikiOncekiyleDeCakismaz() {
        // Mozaikte büyük → kare | kare: üçüncü (sağdaki kare) büyükle de komşu.
        val l = KomsuRenk.ayir(listOf(k("a", LevhaRengi.KOBALT), k("b", LevhaRengi.HARDAL), k("c", LevhaRengi.KOBALT)))
        assertEquals(LevhaRengi.GECE, l[2].renk)
        // Üç ardışık aynı takım: ikinci en yakına, üçüncü ondan sonrakine.
        val u = KomsuRenk.ayir(listOf(k("a", LevhaRengi.KOBALT), k("b", LevhaRengi.KOBALT), k("c", LevhaRengi.KOBALT)))
        assertEquals(listOf(LevhaRengi.KOBALT, LevhaRengi.GECE, LevhaRengi.GOK), u.map { it.renk })
    }

    @Test
    fun rastgeleSiralardaPenceredeTekrarYokVeBelirlenimci() {
        val r = Random(7)
        repeat(500) {
            val giris = List(r.nextInt(1, 14)) { i -> k("k$i", LevhaRengi.entries[r.nextInt(LevhaRengi.entries.size)]) }
            val l = KomsuRenk.ayir(giris)
            assertEquals(giris.map { it.anahtar }, l.map { it.anahtar })
            for (i in l.indices) {
                for (j in maxOf(0, i - KomsuRenk.PENCERE) until i) assertNotEquals("$i-$j ${l.map { it.renk }}", l[j].renk, l[i].renk)
            }
            assertEquals(l.map { it.renk }, KomsuRenk.ayir(giris).map { it.renk })
        }
    }

    @Test
    fun yakinlikTablosuHerTakimiKapsar() {
        for (t in LevhaRengi.entries) {
            val y = KomsuRenk.YAKIN.getValue(t)
            assertFalse(t in y)
            assertEquals(y.size, y.toSet().size)
            assertTrue("pencere her zaman yakın takımla çözülür", y.size >= KomsuRenk.PENCERE)
        }
    }

    @Test
    fun modeldeTaslakVeMozaikTekSiraKalanlarVeYaklasanlarAyriSira() {
        val c = BugunCekirdegi()
        c.ekle(
            kayit("t", "Kahve çekirdeği al", gun(GUN.toString()), taslak = true),
            kayit("k1", "Kahve molası", an(GUN.toString(), "15:30")),
            kayit("k2", "Kahve sohbeti", an(GUN.toString(), "16:00")),
            kayit("k3", "Kahve tadımı", an(GUN.toString(), "17:00")),
            kayit("y1", "Kahve al", an(gunSonra(1), "10:00")),
            kayit("y2", "Kahve iç", an(gunSonra(1), "11:00")),
        )
        val m = model(c)
        val sira = (m.taslaklar + m.acikler).map { it.renk }
        assertEquals(4, sira.size)
        for (i in sira.indices) for (j in maxOf(0, i - 2) until i) assertNotEquals(sira[j], sira[i])
        // Taslak ilk sırada: kendi takımında.
        assertEquals(varsayilanLevhaRengi("kahve"), m.taslaklar.single().renk)
        val yarin = m.yaklasanlar.first().kayitlar.map { it.renk }
        assertEquals(varsayilanLevhaRengi("kahve"), yarin[0])
        assertNotEquals(yarin[0], yarin[1])
        // Çizim kaymaz: hepsi kahve çizer.
        assertTrue((m.taslaklar + m.acikler).all { it.cizim == "kahve" })
    }

    // --- Hareketi azalt: köpük patlaması ve boyama anında ---

    private class Kuyruk : Executor {
        val isler = ArrayDeque<Runnable>()
        override fun execute(command: Runnable) { isler += command }
        fun bosalt() { while (isler.isNotEmpty()) isler.removeFirst().run() }
    }

    private val titresim = object : HapticFeedback {
        override fun performHapticFeedback(hapticFeedbackType: HapticFeedbackType) = Unit
    }

    @Test
    fun hareketiAzaltKopukPatlamasiVeBoyamaAnindaSonHalinde() {
        val kuyruk = Kuyruk()
        val h = BugunHareketleri(CoroutineScope(kuyruk.asCoroutineDispatcher()), SahneHareket.Azaltilmis, null, titresim)
        val araba = k("araba", varsayilanLevhaRengi("araba")).copy(cizim = "araba")
        h.tamamla(araba, levha = true)
        // Aynı anda (hiçbir kare beklemeden) patlama bitmiş, bant hiç yok.
        assertEquals(1f, h.patlama["araba"])
        assertNull(h.yikama["araba"])
        kuyruk.bosalt()
        assertNull("iş bitince temizlenir", h.patlama["araba"])

        val taslak = k("t", varsayilanLevhaRengi("araba")).copy(cizim = "araba", hal = LevhaHali.TASLAK)
        h.onayla(listOf(taslak))
        assertEquals(Boyama.BOYALI, h.boyama["t"])
        assertEquals(0f, h.dugmeAlfa["t"])
        kuyruk.bosalt()
    }

    @Test
    fun satirTamamlamasindaKopukPatlamaz() {
        val kuyruk = Kuyruk()
        val h = BugunHareketleri(CoroutineScope(kuyruk.asCoroutineDispatcher()), SahneHareket.Azaltilmis, null, titresim)
        h.tamamla(k("araba", LevhaRengi.KOBALT).copy(cizim = "araba"), levha = false)
        assertNull(h.patlama["araba"])
        kuyruk.bosalt()
    }

    private fun model(c: BugunCekirdegi) = BugunDenetleyici(c) { SIMDI }.run {
        hepsiniOku()
        model()
    }
}
