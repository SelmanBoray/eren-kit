package dev.eren.ajanda.ekran.sahne.tema

import android.animation.ValueAnimator
import android.app.Application
import android.os.Looper
import android.provider.Settings
import dev.eren.ajanda.ekran.sahne.TELEFON
import dev.eren.ajanda.ekran.sahne.TestEtkinligi
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers
import org.robolectric.util.ReflectionHelpers.ClassParameter

/**
 * "Animasyonları kaldır" uygulama açıkken değişince. Gerçek cihazda iki ayrı bildirim gelir ve sıraları
 * belirsizdir: ayarın kendisi (ContentObserver) ve sürecin animatör ölçeği (pencere yöneticisi
 * `ValueAnimator.setDurationScale` ile, bağlayıcı üstünden). Burada ikisi elle, kötü sırayla verilir.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = TELEFON)
class SistemHareketiTest {
    private val etkinlik = TestEtkinligi()

    @get:Rule
    val kurallar = etkinlik.zincir
    private val kural get() = etkinlik.compose

    /**
     * Ayarı yazar. Robolectric ayarı yazarken sürecin ölçeğini de hemen (dinleyicisiz) eşitliyor; gerçek cihazda
     * o güncelleme bağlayıcıdan sonra gelir. [surecGeriden] verilirse ölçek, gözcü bildirimi işlenmeden önce o
     * değere geri çekilir: bildirim anında süreç henüz eski ölçektedir.
     */
    private fun ayar(olcek: Float, surecGeriden: Float? = null) {
        kural.runOnUiThread {
            Settings.Global.putFloat(kural.activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, olcek)
            if (surecGeriden != null) ozgunOlcek(surecGeriden)
        }
        // Gözcü bildirimi ana döngüye gönderilir; Compose'un waitForIdle'ı onu her zaman boşaltmıyor.
        shadowOf(Looper.getMainLooper()).idle()
        kural.waitForIdle()
    }

    private fun ozgunOlcek(olcek: Float) {
        ReflectionHelpers.callStaticMethod<Unit>(
            ValueAnimator::class.java, "\$\$robo\$\$android_animation_ValueAnimator\$setDurationScale",
            ClassParameter.from(Float::class.javaPrimitiveType, olcek),
        )
    }

    /**
     * Pencere yöneticisinin yaptığı gibi sürecin animatör ölçeğini değiştirir. Robolectric'in gölgesi
     * (`ShadowValueAnimator.setDurationScale`) yalnız alanı yazıyor, dinleyicileri çağırmıyor (ölçüldü:
     * ölçek 0 oldu, kayıtlı dinleyici hiç çağrılmadı); bu yüzden çerçevenin özgün gövdesi doğrudan çağrılır.
     */
    private fun surecOlcegi(olcek: Float) {
        kural.runOnUiThread { ozgunOlcek(olcek) }
        shadowOf(Looper.getMainLooper()).idle()
        kural.waitForIdle()
    }

    @Test
    fun animasyonlarGeriAcilincaAzaltilmisKipKalkar() {
        var olcum: SahneHareket? = null
        kural.setContent { olcum = sistemHareketi() }
        kural.waitForIdle()
        assertFalse(olcum!!.azalt)

        // Kapat: ayar ve süreç ölçeği 0.
        ayar(0f)
        surecOlcegi(0f)
        assertTrue(olcum!!.azalt)

        // Geri aç: ayar bildirimi, süreç ölçeği güncellenmeden önce gelir; ölçek sonra 1 olur.
        ayar(1f, surecGeriden = 0f)
        surecOlcegi(1f)
        assertFalse("animasyonlar açıldıktan sonra uzamsal hareket geri gelmeli", olcum!!.azalt)
    }

    @Test
    fun yalnizSurecOlcegiSifirsaDaAzaltilir() {
        // Pil tasarrufu gibi: ayar 1 kalır, sürecin ölçeği 0 olur.
        var olcum: SahneHareket? = null
        kural.setContent { olcum = sistemHareketi() }
        kural.waitForIdle()
        surecOlcegi(0f)
        assertTrue(olcum!!.azalt)
        surecOlcegi(1f)
        assertFalse(olcum!!.azalt)
    }
}
