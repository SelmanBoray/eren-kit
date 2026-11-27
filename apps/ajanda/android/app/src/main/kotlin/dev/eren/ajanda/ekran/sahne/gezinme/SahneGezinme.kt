package dev.eren.ajanda.ekran.sahne.gezinme

import androidx.activity.compose.BackHandler
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.SeekableTransitionState
import androidx.compose.animation.core.Transition
import androidx.compose.animation.core.rememberTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import kotlinx.coroutines.launch
import kotlin.coroutines.cancellation.CancellationException

/** Paylaşılan öğe alanı ([SharedTransitionLayout]); gezinme dışında (önizleme, tek ekran testi) `null`. */
@OptIn(ExperimentalSharedTransitionApi::class)
val LocalPaylasimAlani = staticCompositionLocalOf<SharedTransitionScope?> { null }

/** İçinde bulunulan hedefin giriş/çıkış kapsamı; gezinme dışında `null`. */
val LocalHedefKapsami = compositionLocalOf<AnimatedVisibilityScope?> { null }

/**
 * Levha ile ayrıntı kapağını bağlar: ikisi de aynı [kayitId] ile bunu çağırırsa, ayrıntı açılırken levha
 * yerinden büyüyerek kapağa dönüşür, kapanırken geri küçülür (geri hareketiyle parmağı izleyerek).
 * Gezinme dışında ya da hareket azaltılmışken etkisizdir.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun Modifier.paylasilanLevha(kayitId: String, sekil: Shape): Modifier {
    val alan = LocalPaylasimAlani.current ?: return this
    val kapsam = LocalHedefKapsami.current ?: return this
    if (!Sahne.hareket.uzamsal) return this
    return with(alan) {
        this@paylasilanLevha.sharedBounds(
            sharedContentState = rememberSharedContentState(levhaAnahtari(kayitId)),
            animatedVisibilityScope = kapsam,
            resizeMode = SharedTransitionScope.ResizeMode.RemeasureToBounds,
            clipInOverlayDuringTransition = OverlayClip(sekil),
        )
    }
}

/**
 * Hedefleri çizer ve aralarındaki geçişi yönetir.
 * - Sekmeler arası: içerik sekme yönünde hafifçe kayarak yer değiştirir.
 * - Katman (ayrıntı, form, ayarlar): alttan yükselerek açılır; ayrıntıda kapak levhadan büyür.
 * - Geri hareketi (Android 14+ öngörülü geri): katmanın kapanışı parmağı izler; bırakınca tamamlanır,
 *   vazgeçince geri yerine oturur.
 * - Hareket azaltılmışsa yalnız kısa solma.
 *
 * Her hedefin `rememberSaveable` durumu (kaydırma konumu gibi) hedef anahtarıyla saklanır; sekmelerinki
 * sekme değişse de kalır, kapanan katmanınki silinir.
 *
 * [katmanUstu]: hedeflerin üstünde, aynı geçişe bağlı çizilen parça (alt çubuk). Sekmedeyken görünür.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun SahneGezinme(
    gezgin: Gezgin,
    modifier: Modifier = Modifier,
    katmanUstu: @Composable BoxScope.(Transition<Hedef>) -> Unit = {},
    hedef: @Composable (Hedef) -> Unit,
) {
    val hareket = Sahne.hareket
    val durum = remember { SeekableTransitionState(gezgin.ust) }
    val gecis = rememberTransition(durum, label = "sahne")
    var parmakta by remember { mutableStateOf(false) }
    val kapsam = rememberCoroutineScope()

    LaunchedEffect(gezgin.ust) {
        // Yalnız hedefe değil şimdiki hâle de bakılır: yarıda bırakılmış bir arama (seekTo) hedefi zaten
        // gezgin.ust'e çekmiş olabilir; o durumda da geçiş sona götürülmeli.
        if (!parmakta && (durum.targetState != gezgin.ust || durum.currentState != gezgin.ust)) durum.animateTo(gezgin.ust)
    }

    // Katman açıkken: öngörülü geri, kapanışı parmağa bağlar.
    PredictiveBackHandler(enabled = gezgin.derinlik > 1) { olaylar ->
        val alttaki = gezgin.alttaki()
        if (alttaki == null) {
            // `enabled` henüz yeniden çizimle güncellenmedi (ör. "Kapat" ile geri aynı karede). Akış
            // toplanmadan dönülürse activity-compose IllegalStateException fırlatır; olaylar boşa toplanır.
            olaylar.collect {}
            return@PredictiveBackHandler
        }
        parmakta = true
        try {
            olaylar.collect { e -> durum.seekTo(e.progress, targetState = alttaki) }
            gezgin.geri()
            durum.animateTo(alttaki)
        } catch (e: CancellationException) {
            // Vazgeçmede activity-compose 1.13 bu görevi de iptal eder: buradan askıya alınan her çağrı
            // hemen atar. Yerine oturma ayrı bir eşyordamda; hedef gezgin.ust (vazgeçmede katmanın kendisi,
            // kapanış animasyonu yarıda kesildiyse alttaki).
            kapsam.launch { durum.animateTo(gezgin.ust) }
            throw e
        } finally {
            parmakta = false
        }
    }
    // Kökte, Bugün dışındaki sekmede: geri Bugün'e döner. Bugün'de işlenmez, etkinlik kapanır.
    BackHandler(enabled = gezgin.derinlik == 1 && gezgin.geriGidilebilir()) { gezgin.geri() }

    val saklama = rememberSaveableStateHolder()
    val acikAnahtarlar = gezgin.anahtarlar().toSet()
    LaunchedEffect(acikAnahtarlar) {
        gezgin.kapananlar().forEach(saklama::removeState)
    }

    SharedTransitionLayout(modifier.fillMaxSize()) {
        CompositionLocalProvider(LocalPaylasimAlani provides this) {
            Box(Modifier.fillMaxSize()) {
                gecis.AnimatedContent(
                    modifier = Modifier.fillMaxSize(),
                    transitionSpec = { gecisBicimi(gezgin, hareket) },
                    contentKey = { it.anahtar },
                ) { h ->
                    CompositionLocalProvider(LocalHedefKapsami provides this) {
                        saklama.SaveableStateProvider(h.anahtar) { hedef(h) }
                    }
                }
                katmanUstu(gecis)
            }
        }
    }
}

private fun AnimatedContentTransitionScope<Hedef>.gecisBicimi(gezgin: Gezgin, hareket: SahneHareket): ContentTransform {
    val once = initialState
    val sonra = targetState
    if (!hareket.uzamsal) {
        return (fadeIn(hareket.solma()) togetherWith fadeOut(hareket.solma())).using(SizeTransform(clip = false))
    }
    // Sekmeden sekmeye: sekme sırası yönünde kısa kayma.
    if (once is Hedef.Sekme && sonra is Hedef.Sekme) {
        val ileri = sonra.ordinal > once.ordinal
        val yon = if (ileri) 1 else -1
        return (
            fadeIn(hareket.solma(220)) + slideInHorizontally(hareket.yay()) { yon * it / 7 }
            ) togetherWith (
            fadeOut(hareket.solma(160)) + slideOutHorizontally(hareket.oturma()) { -yon * it / 10 }
            )
    }
    val geri = gezgin.geriMi(once, sonra)
    return if (!geri) {
        // Katman açılıyor: yeni olan üstte, alttan yükselir; alttaki biraz geri çekilir.
        (
            fadeIn(hareket.solma(200)) + slideInVertically(hareket.yay()) { it / 9 } + scaleIn(hareket.yay(), initialScale = 0.96f)
            ) togetherWith (
            fadeOut(hareket.solma(260)) + scaleOut(hareket.oturma(), targetScale = 0.97f)
            )
    } else {
        // Katman kapanıyor: üstteki aşağı iner ve solar; alttaki yerine oturur.
        (
            fadeIn(hareket.solma(180)) + scaleIn(hareket.oturma(), initialScale = 0.97f)
            ) togetherWith (
            fadeOut(hareket.solma(200)) + slideOutVertically(hareket.oturma()) { it / 8 } + scaleOut(hareket.oturma(), targetScale = 0.96f)
            )
    }.apply { targetContentZIndex = if (geri) -1f else 1f }
}
