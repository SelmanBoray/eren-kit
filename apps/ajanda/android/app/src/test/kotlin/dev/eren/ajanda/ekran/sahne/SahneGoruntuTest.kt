package dev.eren.ajanda.ekran.sahne

import android.app.Application
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import dev.eren.ajanda.ekran.sahne.gezinme.Hedef
import dev.eren.ajanda.ekran.sahne.gezinme.rememberGezgin
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import dev.eren.ajanda.ekran.sahne.tema.SahneTema
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.LocalDate

/**
 * Sahne iskeletinin cihazsız ekran görüntüleri (Robolectric yerel grafik + Roborazzi).
 *
 * - Çekirdek yüklenmez: uygulama sınıfı düz [Application] (gerçek `AjandaUygulamasi` Rust kitaplığını açar),
 *   ekranlar yer tutucu örneklerle çizilir.
 * - Android 15 (SDK 35) çalışma zamanı, 360 × 780 dp telefon, xhdpi (720 × 1560 px).
 * - Koyu tema `night` niteleyicisiyle, büyük yazı `fontScale = 2` (Android 14+ en büyük ölçek) ile.
 * - Gün sabit: 12 Mart 2026, Perşembe; görüntüler günden güne değişmez.
 *
 * Kaydet:   gradlew recordRoborazziDebug --tests "dev.eren.ajanda.ekran.sahne.SahneGoruntuTest"
 * Doğrula:  gradlew verifyRoborazziDebug --tests "dev.eren.ajanda.ekran.sahne.SahneGoruntuTest"
 * Düz `testDebugUnitTest` ekranları çizer (çökme ve düzen hatası yakalanır) ama görüntü yazmaz.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = TELEFON)
class SahneGoruntuTest {
    private val etkinlik = TestEtkinligi()

    @get:Rule
    val kurallar = etkinlik.zincir
    private val kural get() = etkinlik.compose

    private fun ciz(ad: String, vararg yigin: Hedef) {
        kural.setContent {
            SahneTema(hareket = SahneHareket.Tam) {
                SahneKok(bugun = GUN, gezgin = rememberGezgin(*yigin))
            }
        }
        kural.waitForIdle()
        kural.onRoot().captureRoboImage("src/test/screenshots/sahne/$ad.png")
    }

    @Test fun bugunAcik() = ciz("bugun_acik", Hedef.Sekme.BUGUN)
    @Test fun takvimAcik() = ciz("takvim_acik", Hedef.Sekme.TAKVIM)
    @Test fun tarihsizAcik() = ciz("tarihsiz_acik", Hedef.Sekme.TARIHSIZ)

    @Config(qualifiers = "+night")
    @Test fun bugunKoyu() = ciz("bugun_koyu", Hedef.Sekme.BUGUN)

    @Config(qualifiers = "+night")
    @Test fun takvimKoyu() = ciz("takvim_koyu", Hedef.Sekme.TAKVIM)

    @Config(qualifiers = "+night")
    @Test fun tarihsizKoyu() = ciz("tarihsiz_koyu", Hedef.Sekme.TARIHSIZ)

    @Config(fontScale = 2f)
    @Test fun bugunBuyukYazi() = ciz("bugun_buyuk_yazi", Hedef.Sekme.BUGUN)

    @Config(fontScale = 2f)
    @Test fun takvimBuyukYazi() = ciz("takvim_buyuk_yazi", Hedef.Sekme.TAKVIM)

    @Config(fontScale = 2f)
    @Test fun tarihsizBuyukYazi() = ciz("tarihsiz_buyuk_yazi", Hedef.Sekme.TARIHSIZ)

    /** Küçük ekran (320 × 568 dp) ve orta büyük yazı (1.3: alt çubuk yazısız). */
    @Config(qualifiers = "w320dp-h568dp-port-xhdpi", fontScale = 1.3f)
    @Test fun bugunKucukEkran() = ciz("bugun_kucuk_ekran", Hedef.Sekme.BUGUN)

    // Yer tutucu katmanlar
    @Test fun ayrintiAcik() = ciz("ayrinti_acik", Hedef.Sekme.BUGUN, Hedef.Ayrinti("ornek-kahve"))
    @Test fun yeniKayitAcik() = ciz("yeni_kayit_acik", Hedef.Sekme.BUGUN, Hedef.Duzenle(null))
    @Test fun ayarlarAcik() = ciz("ayarlar_acik", Hedef.Sekme.BUGUN, Hedef.Ayarlar)

    @Config(qualifiers = "+night")
    @Test fun ayrintiKoyu() = ciz("ayrinti_koyu", Hedef.Sekme.BUGUN, Hedef.Ayrinti("ornek-dis"))

    companion object {
        val GUN: LocalDate = LocalDate.of(2026, 3, 12)
    }
}

/** Ortak telefon niteleyicisi. */
const val TELEFON = "w360dp-h780dp-port-xhdpi"
