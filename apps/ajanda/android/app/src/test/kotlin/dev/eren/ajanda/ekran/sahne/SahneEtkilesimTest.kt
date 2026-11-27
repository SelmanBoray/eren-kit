package dev.eren.ajanda.ekran.sahne

import android.app.Application
import android.provider.Settings
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.unit.dp
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

    /** SAHNE.md §3.1: dokunma hedefleri en az 48 dp. Yuvarlak düğmelerin tıklanan alanı dairenin kendisi. */
    @Test
    fun yuvarlakDugmelerEnAz48dp() {
        ac()
        fun olc(ad: String) {
            kural.onNodeWithContentDescription(ad).assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
        }
        olc("Ayarlar")
        kural.runOnUiThread { gezgin.sekmeSec(Hedef.Sekme.TAKVIM) }
        kural.waitForIdle()
        olc("Önceki ay")
        olc("Sonraki ay")
        for ((h, ad) in listOf(Hedef.Ayrinti("ornek-dis") to "Kapat", Hedef.Duzenle(null) to "Vazgeç", Hedef.Ayarlar to "Geri")) {
            kural.runOnUiThread { gezgin.ac(h) }
            kural.waitForIdle()
            olc(ad)
            kural.runOnUiThread { gezgin.geri() }
            kural.waitForIdle()
        }
    }

    /** Lisans ekranı APK'ya giren bileşenleri ve lisans metinlerini gösterir. */
    @Test
    fun lisansEkraniButunBilesenleriGosterir() {
        ac()
        kural.runOnUiThread { gezgin.ac(Hedef.Ayarlar) }
        kural.waitForIdle()
        kural.onNodeWithText("Açık kaynak lisansları").performClick()
        kural.waitForIdle()
        for (parca in listOf(
            "androidx.compose.foundation:foundation 1.11.4",
            "org.jetbrains.kotlin:kotlin-stdlib 2.2.20",
            "com.squareup.okhttp3:okhttp 4.12.0",
            "Java Native Access (JNA) 5.17.0",
            "uniffi 0.32.2",
            "Public Suffix List",
            "TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION",
            "Mozilla Public License Version 2.0",
            "libffi - Copyright (c) 1996-2022",
            "Copyright (c) 2014 The rusqlite developers",
            "SIL OPEN FONT LICENSE",
        )) {
            kural.onNodeWithText(parca, substring = true).performScrollTo().assertExists()
        }
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
