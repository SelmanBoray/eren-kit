package dev.eren.ajanda.ekran.sahne.tarihsiz

import android.app.Application
import android.graphics.Bitmap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeRight
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.ekran.kayit
import dev.eren.ajanda.ekran.sahne.TELEFON
import dev.eren.ajanda.ekran.sahne.TestEtkinligi
import dev.eren.ajanda.ekran.sahne.bugun.BugunCekirdegi
import dev.eren.ajanda.ekran.sahne.bugun.sahteDepo
import dev.eren.ajanda.ekran.sahne.ekranlar.TarihsizEkrani
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import dev.eren.ajanda.ekran.sahne.tema.SahneTema
import dev.eren.ajanda.ekran.sahne.veri.BugunDeposu
import dev.eren.ajanda.ekran.sahne.veri.LevhaHali
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Tarihsizler sekmesi sahte çekirdekle: bölümler (öneriler, yapılacaklar, notlar, bitenler), tamamla ve geri al,
 * sağa çekme, taslak onayı ve vazgeç, okuma hatası (veri boşaltılmaz), "hareketi azalt"ta anında bitme ve 48 dp
 * dokunma hedefleri (G6).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = TELEFON)
class TarihsizTest {
    private val etkinlik = TestEtkinligi()

    @get:Rule
    val kurallar = etkinlik.zincir
    private val kural get() = etkinlik.compose

    private val c = BugunCekirdegi()
    private lateinit var depo: BugunDeposu
    private var acilan: String? = null
    private val DIKEY_LISTE = hasScrollAction().and(SemanticsMatcher.keyIsDefined(SemanticsProperties.CollectionInfo))

    private fun ornek() {
        c.ekle(
            kayit("zil", "Kapı zilini değiştir", olusturma = 3_000),
            kayit("imza", "Formu imzala", olusturma = 2_000),
            kayit("ara", "Ustayı ara", AjandaZamani.Belirsiz("haftaya bir ara"), olusturma = 1_500),
            kayit("fikir", "Kitap fikri", tur = KayitTuru.NOT),
            kayit("oneri", "Kamp listesi hazırla", taslak = true),
            kayit("eski", "Vitamin al", durum = KayitDurumu.TAMAM),
        )
    }

    private fun ac(hareket: SahneHareket = SahneHareket.Tam, saatDursun: Boolean = false) {
        depo = sahteDepo(c).also { it.acilisOynadi = true; it.basla() }
        if (saatDursun) kural.mainClock.autoAdvance = false
        kural.setContent {
            SahneTema(koyu = false, hareket = hareket) {
                TarihsizEkrani(depo.tarihsiz, onKayit = { acilan = it })
            }
        }
        if (!saatDursun) kural.waitForIdle() else repeat(3) { kural.mainClock.advanceTimeByFrame() }
    }

    private fun durumCagrilari() = c.cagrilar.filter { it.startsWith("durum:") || it.startsWith("onayla:") || it.startsWith("sil:") || it.startsWith("geriYukle:") }

    private fun satir(bas: String) = kural.onNode(hasContentDescription(bas, substring = true).and(hasClickAction()).and(SemanticsMatcher.keyIsDefined(SemanticsActions.CustomActions)))

    @Test
    fun bolumlerVeSira() {
        ornek()
        ac()
        val m = depo.tarihsiz.model.value
        assertEquals(listOf("oneri"), m.taslaklar.map { it.kayitId })
        assertEquals(setOf("zil", "imza", "ara"), m.yapilacaklar.map { it.kayitId }.toSet())
        assertEquals(listOf("fikir"), m.notlar.map { it.kayitId })
        assertEquals(listOf("eski"), m.bitenler.map { it.kayitId })
        assertEquals("“haftaya bir ara”", m.yapilacaklar.single { it.kayitId == "ara" }.zaman)
        assertTrue(!m.notlar.single().tamamlanabilir)
        kural.onNodeWithText("4 iş bekliyor; 1 öneri onay istiyor.").assertIsDisplayed()
        satir("Formu imzala").performClick()
        assertEquals("imza", acilan)
        // Taslak karakalem: durum ve iki özel eylem.
        val t = kural.onNode(hasContentDescription("Kamp listesi", substring = true).and(hasClickAction())).fetchSemanticsNode().config
        assertEquals("asistan önerisi, onay bekliyor", t[SemanticsProperties.StateDescription])
        assertEquals(listOf("Onayla", "Vazgeç"), t[SemanticsActions.CustomActions].map { it.label })
    }

    @Test
    fun daireyleTamamlaBitenlereInerTostlaGeriAlinir() {
        ornek()
        ac()
        kural.mainClock.autoAdvance = false
        kural.onNodeWithContentDescription("Tamamla: Formu imzala").performClick()
        assertEquals(listOf("durum:imza:TAMAM"), durumCagrilari())
        kural.mainClock.advanceTimeBy(500)
        kural.mainClock.autoAdvance = true
        kural.waitForIdle()
        kural.onNodeWithText("Bitti: Formu imzala").assertIsDisplayed()
        // Görünür kalır: Bitenler'in başına hap olarak indi.
        assertEquals("imza", depo.tarihsiz.model.value.bitenler.first().kayitId)
        assertEquals(LevhaHali.BITTI, depo.tarihsiz.model.value.bitenler.first().hal)
        kural.onNodeWithText("Geri al").performClick()
        kural.waitForIdle()
        assertEquals(listOf("durum:imza:TAMAM", "durum:imza:ACIK"), durumCagrilari())
        assertTrue(depo.tarihsiz.model.value.yapilacaklar.any { it.kayitId == "imza" })
    }

    @Test
    fun sagaCekerekTamamlanir() {
        ornek()
        ac()
        satir("Kapı zilini").performTouchInput { swipeRight(startX = left + 20f, endX = left + 20f + 260f, durationMillis = 250) }
        kural.mainClock.advanceTimeBy(400)
        kural.waitForIdle()
        assertEquals(listOf("durum:zil:TAMAM"), durumCagrilari())
    }

    @Test
    fun taslakOnaylanirVazgecGeriYuklenir() {
        ornek()
        ac()
        kural.onNodeWithText("Onayla").performClick()
        assertEquals(listOf("onayla:oneri"), durumCagrilari())
        kural.mainClock.advanceTimeBy(1200)
        kural.waitForIdle()
        assertTrue(depo.tarihsiz.model.value.yapilacaklar.any { it.kayitId == "oneri" })
        c.ekle(kayit("oneri2", "Bisiklet bak", taslak = true))
        depo.yenile()
        kural.waitForIdle()
        kural.onNodeWithText("Vazgeç").performClick()
        kural.mainClock.advanceTimeBy(600)
        kural.waitForIdle()
        assertTrue(durumCagrilari().contains("sil:oneri2"))
        kural.onNodeWithText("Öneriden vazgeçildi").assertIsDisplayed()
        kural.onNodeWithText("Geri al").performClick()
        kural.waitForIdle()
        assertTrue(durumCagrilari().contains("geriYukle:oneri2"))
    }

    @Test
    fun okumaHatasiVeriBosaltmazYenidenDenenir() {
        ornek()
        ac()
        c.listeHatasi = IllegalStateException("okunamadı")
        depo.yenile()
        kural.waitForIdle()
        assertNotNull(depo.tarihsiz.model.value.okumaHatasi)
        kural.onNodeWithText("Liste güncellenemedi; son okunan hâli görünüyor.").assertIsDisplayed()
        satir("Formu imzala").assertIsDisplayed()
        c.listeHatasi = null
        kural.onNodeWithText("Yeniden dene").performClick()
        kural.waitForIdle()
        assertTrue(kural.onAllNodes(hasText("Yeniden dene")).fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun hicOkunamayanListeBosDegilHataGosterir() {
        c.listeHatasi = IllegalStateException("okunamadı")
        ac()
        kural.onNodeWithText("Tarihsiz işler okunamadı.").assertIsDisplayed()
        assertTrue(kural.onAllNodes(hasText("Tarihsiz iş yok.")).fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun bosListe() {
        ac()
        kural.onNodeWithText("Tarihsiz iş yok.").assertIsDisplayed()
    }

    @Test
    fun bitenHapVeFazlasiDokunmaHedefi48dp() {
        ornek()
        for (i in 0 until 8) c.ekle(kayit("b$i", "Biten $i", durum = KayitDurumu.TAMAM))
        ac()
        kural.onNode(DIKEY_LISTE).performScrollToNode(hasText("iş daha", substring = true))
        kural.onNode(hasContentDescription("Vitamin al", substring = true).and(hasClickAction())).assertHeightIsAtLeast(48.dp)
        kural.onNode(hasContentDescription("Biten 0", substring = true).and(hasClickAction())).assertHeightIsAtLeast(48.dp)
        kural.onNode(hasText("iş daha", substring = true).and(hasClickAction())).assertHeightIsAtLeast(48.dp)
    }

    // Hareketi azalt -------------------------------------------------------------------------------

    private fun goruntu(): Bitmap {
        lateinit var b: Bitmap
        kural.runOnUiThread {
            val v = kural.activity.window.decorView
            b = Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888)
            v.draw(android.graphics.Canvas(b))
        }
        return b
    }

    private fun hemenSonHalinde(sonra: Long = 1500): Boolean {
        kural.mainClock.advanceTimeByFrame()
        kural.mainClock.advanceTimeByFrame()
        val a = goruntu()
        kural.mainClock.advanceTimeBy(sonra)
        return a.sameAs(goruntu())
    }

    @Test
    fun hareketiAzaltHerSeyAnindaBiter() {
        ornek()
        ac(SahneHareket.Azaltilmis, saatDursun = true)
        assertTrue(hemenSonHalinde())
        kural.onNodeWithContentDescription("Tamamla: Formu imzala").performClick()
        kural.mainClock.advanceTimeByFrame()
        assertEquals(listOf("durum:imza:TAMAM"), durumCagrilari())
        assertTrue("tamamlama anında", hemenSonHalinde(1000))
        kural.onNodeWithText("Onayla").performClick()
        kural.mainClock.advanceTimeByFrame()
        assertTrue(durumCagrilari().contains("onayla:oneri"))
        assertTrue("onay anında", hemenSonHalinde(1000))
    }
}
