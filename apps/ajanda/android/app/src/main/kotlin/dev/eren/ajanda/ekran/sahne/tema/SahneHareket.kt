package dev.eren.ajanda.ekran.sahne.tema

import android.animation.ValueAnimator
import android.database.ContentObserver
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

/**
 * Hareket belirteçleri. Değerler `apps/ajanda/tasarim/SAHNE.md` §4'ten (prototipin Bezier eğrilerinin aşma
 * oranı ve tepe zamanından hesaplanmış yay karşılıkları). Sahne'nin hareketi yaylıdır: öğe yerine biraz
 * aşarak oturur. Aşan eğriler yayla verilir ki hareket yarıda kesilip yön değiştirse de (ayrıntı açılırken
 * geri çekmek gibi) hız korunsun. SAHNE.md §12.9: sertlikler gerçek telefonda denenip ±%30 ayarlanabilir.
 *
 * "Hareketi azalt" (Erişilebilirlik → "Animasyonları kaldır", animatör ölçeği 0): [azalt] doğru olur ve
 * çağıran açıkça dallanır (SAHNE.md §6): yer değiştiren, büyüyen, dönen ve paylaşılan öğe hareketleri kapanır
 * ([uzamsal] yanlış), yaylar ve eğriler anında biter, kademeler sıfırlanır; yalnız kısa solma kalabilir.
 * Durum değişikliği hareketsiz de anlaşılır olmalı: renk, işaret ve metin her zaman son hâline gelir.
 * Ölçek 0 değil ama farklıysa (0.5x, 2x) Compose bütün animasyon saatini o ölçekle kendisi çarpar.
 *
 * Kullanım: `Sahne.hareket.yay<Dp>()`, `if (Sahne.hareket.uzamsal) ...`.
 */
@Immutable
class SahneHareket(val azalt: Boolean) {
    /** `YAY` ve alt çubuk lekesi: %6–7 aşan yay (tepe ~330 ms). Çoğu giriş ve yerleşme. */
    fun <T> yay(): FiniteAnimationSpec<T> =
        if (azalt) snap() else spring(dampingRatio = YAY_SONUMU, stiffness = YAY_SERTLIGI)

    /** Kısa `YAY` (420 ms): geri yaylanma, basılı geri bildirim, kısa girişler. */
    fun <T> yayHizli(): FiniteAnimationSpec<T> =
        if (azalt) snap() else spring(dampingRatio = YAY_SONUMU, stiffness = YAY_HIZLI_SERTLIGI)

    /** Hafif aşan, oturan yay: levhadan ayrıntıya büyüme, yeniden diz, büyük yüzeyler. */
    fun <T> oturma(): FiniteAnimationSpec<T> =
        if (azalt) snap() else spring(dampingRatio = OTURMA_SONUMU, stiffness = OTURMA_SERTLIGI)

    /** Basılınca 0.97'ye inme ve bırakınca dönme (SAHNE.md §8.1: `yayHizli`). */
    fun <T> basma(): FiniteAnimationSpec<T> = yayHizli()

    /** `YUM`: aşmasız yavaşlayan eğri (baş yazısı, kapak resmi, tost). */
    fun <T> yumusak(sureMs: Int = 460): FiniteAnimationSpec<T> =
        if (azalt) snap() else tween(sureMs, easing = YUMUSAK)

    /** Ayrıntının levhaya dönüşü: standart hızlan-yavaşla, 380 ms. */
    fun <T> kapanis(): FiniteAnimationSpec<T> =
        if (azalt) snap() else tween(380, easing = KAPANIS)

    /** Dairesel açılış (yeni kayıt, levhanın boyanması): yavaşlayan, 560 ms. */
    fun <T> acilis(): FiniteAnimationSpec<T> =
        if (azalt) snap() else tween(560, easing = ACILIS)

    /** Dairesel kapanış: hızlanan, 380 ms. */
    fun <T> kapanisDaire(): FiniteAnimationSpec<T> =
        if (azalt) snap() else tween(380, easing = KAPANIS_DAIRE)

    /**
     * Saydamlık ve renk geçişi. Azaltılmış kipte de kısa bir solma kalır (yer değiştirme değil;
     * SAHNE.md §6, "yeniden diz" satırı).
     */
    fun <T> solma(sureMs: Int = SOLMA_MS): FiniteAnimationSpec<T> =
        tween(durationMillis = if (azalt) AZ_SOLMA_MS else sureMs, easing = YUMUSAK)

    /** Ardışık girişlerde öğeler arası gecikme (ms); prototipteki kademeler korunur. */
    fun kademe(i: Int, adimMs: Int = 90, ilkMs: Int = 0): Int = if (azalt) 0 else ilkMs + i * adimMs

    /** Ölçek, kaydırma, dönme, paylaşılan öğe geçişi açık mı. */
    val uzamsal: Boolean get() = !azalt

    /** Sürekli (döngüsel) hareketler oynasın mı (köpük, buhar, varış halkası). */
    val surekli: Boolean get() = !azalt

    companion object {
        const val YAY_SONUMU = 0.65f
        const val YAY_SERTLIGI = 200f
        const val YAY_HIZLI_SERTLIGI = 300f
        const val OTURMA_SONUMU = 0.8f
        const val OTURMA_SERTLIGI = 220f
        const val SOLMA_MS = 240
        const val AZ_SOLMA_MS = 150

        /** Prototipteki `cubic-bezier(.2,.8,.2,1)`. */
        val YUMUSAK = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
        val KAPANIS = CubicBezierEasing(0.4f, 0f, 0.3f, 1f)
        val ACILIS = CubicBezierEasing(0.3f, 0.7f, 0.2f, 1f)
        val KAPANIS_DAIRE = CubicBezierEasing(0.5f, 0f, 0.7f, 0.3f)

        val Tam = SahneHareket(azalt = false)
        val Azaltilmis = SahneHareket(azalt = true)
    }
}

/**
 * Sistemin animasyon ayarını izler: "Animasyonları kaldır" açıksa (ya da animatör ölçeği 0) [SahneHareket.Azaltilmis].
 * Ayar uygulama açıkken değişirse hemen yansır.
 *
 * Değişiklik iki ayrı yoldan, belirsiz sırayla gelir: ayarın kendisi ([ContentObserver]) ve sürecin animatör
 * ölçeği (pencere yöneticisi bağlayıcı üstünden `ValueAnimator.setDurationScale` çağırır). Ayar bildirimi
 * geldiğinde süreç ölçeği henüz eskisi olabilir; o anda [ValueAnimator.areAnimatorsEnabled] okumak, ayar geri
 * açıldığında azaltılmış kipi takılı bırakır. Bu yüzden:
 * - API 33+: süreç ölçeğinin kendi dinleyicisi ([ValueAnimator.registerDurationScaleChangeListener]) esas
 *   alınır; ölçek gerçekten değişince bildirir (pil tasarrufunun animasyonu kapatması da buna dahil).
 * - Daha eskide: yalnız ayarın değeri okunur.
 * Başlangıçta ikisi de okunur; o anda yarış yoktur.
 */
@Composable
fun sistemHareketi(): SahneHareket {
    val context = LocalContext.current
    var azalt by remember { mutableStateOf(animatorOlcegi(context) == 0f || !ValueAnimator.areAnimatorsEnabled()) }
    DisposableEffect(context) {
        val ana = Handler(Looper.getMainLooper())
        azalt = animatorOlcegi(context) == 0f || !ValueAnimator.areAnimatorsEnabled()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Bağlayıcı iş parçacığından çağrılabilir; durum ana iş parçacığında yazılır.
            val dinleyici = ValueAnimator.DurationScaleChangeListener { olcek -> ana.post { azalt = olcek == 0f } }
            ValueAnimator.registerDurationScaleChangeListener(dinleyici)
            onDispose { ValueAnimator.unregisterDurationScaleChangeListener(dinleyici) }
        } else {
            val cozucu = context.contentResolver
            val gozcu = object : ContentObserver(ana) {
                override fun onChange(selfChange: Boolean) {
                    azalt = animatorOlcegi(context) == 0f
                }
            }
            cozucu.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, gozcu)
            onDispose { cozucu.unregisterContentObserver(gozcu) }
        }
    }
    return if (azalt) SahneHareket.Azaltilmis else SahneHareket.Tam
}

private fun animatorOlcegi(context: android.content.Context): Float =
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
