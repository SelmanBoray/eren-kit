package dev.eren.ajanda.ekran.sahne

import android.app.Application
import android.provider.Settings
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.eren.ajanda.ekran.sahne.gezinme.Gezgin
import dev.eren.ajanda.ekran.sahne.gezinme.Hedef
import dev.eren.ajanda.ekran.sahne.gezinme.rememberGezgin
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import dev.eren.ajanda.ekran.sahne.tema.SahneTema
import dev.eren.ajanda.ekran.sahne.tema.sistemHareketi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate

/** Gezinme iskeletinin davranışı ve erişilebilirlik adları (TalkBack'in gördüğü ağaç). Çekirdek yüklenmez. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = TELEFON)
class SahneEtkilesimTest {
    private val etkinlik = TestEtkinligi()

    @get:Rule
    val kurallar = etkinlik.zincir
    private val kural get() = etkinlik.compose

    private lateinit var gezgin: Gezgin

    private fun ac(hareket: SahneHareket = SahneHareket.Tam) {
        kural.setContent {
            gezgin = rememberGezgin()
            SahneTema(hareket = hareket) { SahneKok(bugun = LocalDate.of(2026, 3, 12), gezgin = gezgin) }
        }
        kural.waitForIdle()
    }

    private val sekme = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)

    @Test
    fun sekmelerSekmeRoluVeSeciliDurumTasir() {
        ac()
        val sekmeler = kural.onAllNodes(sekme).fetchSemanticsNodes()
        assertEquals(3, sekmeler.size)
        kural.onNode(sekme.and(SemanticsMatcher.expectValue(SemanticsProperties.ContentDescription, listOf("Bugün")))).assertIsSelected()
        kural.onNodeWithContentDescription("Takvim").assertIsNotSelected().performClick()
        kural.waitForIdle()
        kural.onNodeWithContentDescription("Takvim").assertIsSelected()
        assertEquals(Hedef.Sekme.TAKVIM, gezgin.ust)
    }

    @Test
    fun artiYeniKaydiAcarGeriKapatir() {
        ac()
        kural.onNodeWithContentDescription("Yeni kayıt").performClick()
        kural.waitForIdle()
        assertEquals(Hedef.Duzenle(null), gezgin.ust)
        kural.onNodeWithText("Ne yapacaksın?").assertIsDisplayed()
        kural.runOnUiThread { kural.activity.onBackPressedDispatcher.onBackPressed() }
        kural.waitForIdle()
        assertEquals(Hedef.Sekme.BUGUN, gezgin.ust)
    }

    @Test
    fun levhaAyrintiyiAcarTamamlaDairesiAyriHedeftir() {
        ac()
        // Tamamla dairesi levhayı açmaz.
        kural.onNodeWithContentDescription("Tamamla: Kahve molası").performClick()
        kural.waitForIdle()
        assertEquals(Hedef.Sekme.BUGUN, gezgin.ust)
        // Levhanın kendisi ayrıntıyı açar.
        kural.onNodeWithText("Diş kontrolü", substring = false).performClick()
        kural.waitForIdle()
        assertEquals(Hedef.Ayrinti("ornek-dis"), gezgin.ust)
        kural.onNodeWithContentDescription("Kapat").performClick()
        kural.waitForIdle()
        assertEquals(Hedef.Sekme.BUGUN, gezgin.ust)
    }

    @Test
    fun azaltilmisHareketteDeGezinmeCalisir() {
        ac(SahneHareket.Azaltilmis)
        kural.onNodeWithContentDescription("Tarihsizler").performClick()
        kural.waitForIdle()
        assertEquals(Hedef.Sekme.TARIHSIZ, gezgin.ust)
        assertTrue(kural.onAllNodesWithText("Formu imzala").fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun animasyonlarKapaliysaSistemHareketiAzaltilir() {
        val cozucu = kural.activity.contentResolver
        Settings.Global.putFloat(cozucu, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
        var olcum: SahneHareket? = null
        kural.setContent { olcum = sistemHareketi() }
        kural.waitForIdle()
        assertTrue(olcum!!.azalt)
    }
}
