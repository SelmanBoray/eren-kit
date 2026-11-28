package dev.eren.ajanda.ekran.sahne.gezinme

import android.app.Application
import androidx.activity.BackEventCompat
import androidx.compose.animation.core.Transition
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import dev.eren.ajanda.ekran.sahne.TELEFON
import dev.eren.ajanda.ekran.sahne.TestEtkinligi
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import dev.eren.ajanda.ekran.sahne.tema.SahneTema
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Öngörülü geri hareketi (activity-compose 1.13). Sistem olayları OnBackPressedDispatcher'ın test
 * girişlerinden verilir; geçişin hangi karede durduğu `katmanUstu`'na gelen [Transition]'dan okunur.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = TELEFON)
class GeriHareketiTest {
    private val etkinlik = TestEtkinligi()

    @get:Rule
    val kurallar = etkinlik.zincir
    private val kural get() = etkinlik.compose

    private lateinit var gezgin: Gezgin
    private lateinit var gecis: Transition<Hedef>
    private val dagitici get() = kural.activity.onBackPressedDispatcher

    private val ayrinti = Hedef.Ayrinti("k1")

    private fun ac() {
        kural.setContent {
            gezgin = rememberGezgin()
            SahneTema(koyu = false, hareket = SahneHareket.Tam) {
                SahneGezinme(gezgin, katmanUstu = { gecis = it }) { Box(Modifier.fillMaxSize()) }
            }
        }
        kural.waitForIdle()
        kural.runOnUiThread { gezgin.ac(ayrinti) }
        kural.waitForIdle()
        oturdu(ayrinti)
    }

    private fun olay(ilerleme: Float) = BackEventCompat(0f, 400f, ilerleme, BackEventCompat.EDGE_LEFT)

    /** Geçiş [h]'de durgun: ne arada bir karede ne de başka bir hedefe doğru. */
    private fun oturdu(h: Hedef) {
        assertEquals("gezgin", h, gezgin.ust)
        assertEquals("geçişin şimdiki hâli", h, gecis.currentState)
        assertEquals("geçişin hedefi", h, gecis.targetState)
    }

    @Test
    fun yaridaVazgecilinceAyrintiYerineOturur() {
        ac()
        kural.runOnUiThread { dagitici.dispatchOnBackStarted(olay(0f)) }
        kural.waitForIdle()
        for (p in listOf(0.2f, 0.5f)) {
            kural.runOnUiThread { dagitici.dispatchOnBackProgressed(olay(p)) }
            kural.waitForIdle()
        }
        // Parmak yarıdayken geçiş gerçekten Bugün'e doğru aranıyor.
        assertEquals(Hedef.Sekme.BUGUN, gecis.targetState)

        kural.runOnUiThread { dagitici.dispatchOnBackCancelled() }
        kural.waitForIdle()
        oturdu(ayrinti)

        // Sonraki gezinmeler de doğru: "Kapat" Bugün'e indirir, yeniden açmak ayrıntıya çıkarır.
        kural.runOnUiThread { gezgin.geri() }
        kural.waitForIdle()
        oturdu(Hedef.Sekme.BUGUN)
        kural.runOnUiThread { gezgin.ac(ayrinti) }
        kural.waitForIdle()
        oturdu(ayrinti)
    }

    @Test
    fun hareketTamamlanincaKatmanKapanir() {
        ac()
        kural.runOnUiThread { dagitici.dispatchOnBackStarted(olay(0f)) }
        kural.waitForIdle()
        kural.runOnUiThread { dagitici.dispatchOnBackProgressed(olay(0.6f)) }
        kural.waitForIdle()
        kural.runOnUiThread { dagitici.onBackPressed() }
        kural.waitForIdle()
        oturdu(Hedef.Sekme.BUGUN)
    }

    @Test
    fun kapatIleGeriAyniKaredeyseCokmez() {
        ac()
        // "Kapat" yığını indirdi ama işleyicinin `enabled`'ı henüz yeniden çizimle güncellenmedi; o arada
        // sistem geri tuşu gelir. Çizim saati durdurulur ki işleyicinin görevi yeniden çizimden önce koşsun.
        kural.mainClock.autoAdvance = false
        kural.runOnUiThread {
            gezgin.geri()
            dagitici.onBackPressed()
        }
        kural.waitForIdle()
        kural.mainClock.autoAdvance = true
        kural.waitForIdle()
        oturdu(Hedef.Sekme.BUGUN)
    }
}
