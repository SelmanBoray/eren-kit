package dev.eren.ajanda.ekran.sahne.bilesen

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.sahne.TELEFON
import dev.eren.ajanda.ekran.sahne.TestEtkinligi
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import dev.eren.ajanda.ekran.sahne.tema.SahneTema
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Sağa çekme sarmalayıcısı kilitlenince (`etkin` yanlış: tamamlama hareketi sürüyor) içeriği baştan kurmaz.
 * Kurarsa içindeki tamamlama dairesi durumunu yitirir (dolum 1'den başlar, yaylanma atlanır, SAHNE.md §5.2)
 * ve çekilen içerik yaylanmadan yerine sıçrar (§8.3).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = TELEFON)
class SagaCekTest {
    private val etkinlik = TestEtkinligi()

    @get:Rule
    val kurallar = etkinlik.zincir
    private val kural get() = etkinlik.compose

    @Test
    fun kilitleninceIcerikDurumunuKorur() {
        var etkin by mutableStateOf(true)
        val kurulanlar = mutableListOf<Any>()
        var atilma = 0
        kural.setContent {
            SahneTema(koyu = false, hareket = SahneHareket.Tam) {
                SagaCek(etkin, tamam = false, zemin = Color.Green, yazi = Color.Black, sekil = RectangleShape, onTamamla = {}) {
                    val nesne = remember { Any().also { kurulanlar += it } }
                    DisposableEffect(Unit) { onDispose { atilma++ } }
                    Box(Modifier.size(200.dp, 80.dp).testTag("icerik"))
                }
            }
        }
        kural.waitForIdle()
        val ilk = kurulanlar.single()
        kural.runOnUiThread { etkin = false }
        kural.waitForIdle()
        kural.runOnUiThread { etkin = true }
        kural.waitForIdle()
        assertEquals("içerik yeniden kurulmadı", 1, kurulanlar.size)
        assertSame(ilk, kurulanlar.single())
        assertEquals("içerik atılmadı", 0, atilma)
    }

    @Test
    fun tamamlayipKilitleninceIcerikYaylaDoner() {
        var etkin by mutableStateOf(true)
        kural.setContent {
            SahneTema(koyu = false, hareket = SahneHareket.Tam) {
                // Gerçek ekrandaki gibi: tamamlama levhayı kilitler (sarmalayıcı kapanır).
                SagaCek(etkin, tamam = false, zemin = Color.Green, yazi = Color.Black, sekil = RectangleShape, onTamamla = { etkin = false }) {
                    Box(Modifier.size(300.dp, 80.dp).testTag("icerik"))
                }
            }
        }
        kural.waitForIdle()
        val bas = kural.onNodeWithTag("icerik").getUnclippedBoundsInRoot().left
        kural.mainClock.autoAdvance = false
        kural.onNodeWithTag("icerik").performTouchInput {
            down(Offset(40f, centerY))
            repeat(10) { moveBy(Offset(25f, 0f), delayMillis = 16) }
            // Bırakmadan önce dur: hız sıfıra iner, tetiği eşik verir (250 px > 84 dp = 168 px).
            advanceEventTime(120)
            up()
        }
        kural.mainClock.advanceTimeByFrame()
        kural.mainClock.advanceTimeByFrame()
        val simdi = kural.onNodeWithTag("icerik").getUnclippedBoundsInRoot().left
        assertTrue("tamamlandı ve kilitlendi", !etkin)
        assertTrue("içerik yerine sıçramadı, yayla dönüyor (fark ${simdi - bas})", simdi - bas > 20.dp)
        kural.mainClock.advanceTimeBy(1500)
        assertEquals(bas, kural.onNodeWithTag("icerik").getUnclippedBoundsInRoot().left)
    }
}
