package dev.eren.ajanda.ekran.sahne

import android.app.Application
import android.content.ComponentName
import android.content.pm.PackageManager
import androidx.compose.foundation.text.BasicText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * G8: emoji2'nin başlatıcısı birleşik manifestten kaldırıldı (açılışta sistemin emoji yazı tipi sağlayıcısına,
 * Play hizmetlerine başvurmasın). Öteki başlatıcılar yerinde kalır; Compose metni (emoji dahil) EmojiCompat
 * kurulmadan çizilir.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE) // metin gerçek yazı tipi ölçüsüyle ölçülsün
@Config(sdk = [35], application = Application::class, qualifiers = TELEFON)
class EmojiBaslaticiTest {
    private val etkinlik = TestEtkinligi()

    @get:Rule
    val kurallar = etkinlik.zincir
    private val kural get() = etkinlik.compose

    @Test
    fun emojiBaslaticisiManifesteYokOtekilerVar() {
        val ctx = ApplicationProvider.getApplicationContext<Application>()
        val saglayici = ctx.packageManager.getProviderInfo(
            ComponentName(ctx, "androidx.startup.InitializationProvider"),
            PackageManager.GET_META_DATA,
        )
        val anahtarlar = saglayici.metaData?.keySet().orEmpty()
        assertFalse(anahtarlar.toString(), "androidx.emoji2.text.EmojiCompatInitializer" in anahtarlar)
        // Birleştirme sağlayıcının kendisini silmedi: yaşam döngüsü ve profil başlatıcıları sürüyor.
        assertTrue(anahtarlar.toString(), "androidx.lifecycle.ProcessLifecycleInitializer" in anahtarlar)
        assertTrue(anahtarlar.toString(), "androidx.profileinstaller.ProfileInstallerInitializer" in anahtarlar)
    }

    @Test
    fun composeMetniEmojiCompatsizCizilir() {
        kural.setContent { BasicText("Kahve ☕ molası 🎉") }
        kural.waitForIdle()
        kural.onNodeWithText("Kahve ☕ molası 🎉").assertIsDisplayed().assertWidthIsAtLeast(40.dp)
        // EmojiCompat hiç kurulmadı (başlatıcı yok): Compose metni onu beklemeden sistem yazı tipiyle çizer.
        val sinif = Class.forName("androidx.emoji2.text.EmojiCompat")
        assertNotNull(sinif)
        assertFalse(sinif.getMethod("isConfigured").invoke(null) as Boolean)
    }
}
