package dev.eren.ajanda.ekran.sahne.tema

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.interaction.FocusInteraction
import androidx.compose.foundation.interaction.Interaction
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.IndicationNodeFactory
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.node.DelegatableNode
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.invalidateDraw
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.TextStyle
import androidx.compose.foundation.text.BasicText
import kotlinx.coroutines.launch

/**
 * Ölçüler ve biçimler. Kenar payı telefonda 16 dp (prototip `--gl/--gr`); levhalar büyük yarıçaplı,
 * satırlar orta, düğme ve çubuklar hap biçimli. Dokunma hedefleri en az 48 dp (SAHNE.md §3.1).
 */
@Immutable
data class SahneOlculer(
    val kenar: Dp = 16.dp,
    val aralik: Dp = 10.dp,
    val bolumAraligi: Dp = 26.dp,
    val levhaYaricapi: Dp = 26.dp,
    val satirYaricapi: Dp = 20.dp,
    val kapakYaricapi: Dp = 34.dp,
    val dokunma: Dp = 48.dp,
    /**
     * Yuvarlak simge düğmesinin görünür dairesi (SAHNE.md §3.7, §3.8: 46 dp). Dokunma alanı dairenin
     * çevresindeki kutudur ve en az [dokunma] (`YuvarlakDugme`). Tek kaynak: `YUVARLAK_DUGME_GORUNUR` buradan okur.
     */
    val yuvarlakDugme: Dp = 46.dp,
    /** Alt çubuğun yüksekliği (6 dp iç pay + 48 dp öğe + 6 dp); içerik altına bu kadar ve sistem çubuğu kadar pay bırakır. */
    val cubukYuksekligi: Dp = 60.dp,
    val cubukAltPayi: Dp = 14.dp,
) {
    val levha get() = RoundedCornerShape(levhaYaricapi)
    val satir get() = RoundedCornerShape(satirYaricapi)
    val hap get() = RoundedCornerShape(percent = 50)
}

val LocalSahneRenkleri = staticCompositionLocalOf { SahneRenkleri.Acik }
val LocalSahneYazi = staticCompositionLocalOf { SahneYazi.Varsayilan }
val LocalSahneHareket = staticCompositionLocalOf { SahneHareket.Tam }
val LocalSahneOlculer = staticCompositionLocalOf { SahneOlculer() }

/** Varsayılan yazı stili: [Metin] ve [BasicText] bunu taban alır (renk dahil). */
val LocalSahneMetinStili = staticCompositionLocalOf { TextStyle.Default }

/** Temaya erişim: `Sahne.renk.zemin`, `Sahne.yazi.selam`, `Sahne.hareket.yay()`, `Sahne.olcu.kenar`. */
object Sahne {
    val renk: SahneRenkleri @Composable @ReadOnlyComposable get() = LocalSahneRenkleri.current
    val yazi: SahneYazi @Composable @ReadOnlyComposable get() = LocalSahneYazi.current
    val hareket: SahneHareket @Composable @ReadOnlyComposable get() = LocalSahneHareket.current
    val olcu: SahneOlculer @Composable @ReadOnlyComposable get() = LocalSahneOlculer.current

    /** Bir levha renginin bu temadaki takımı. */
    @Composable @ReadOnlyComposable
    fun levha(r: LevhaRengi): LevhaTakimi = r.takim(LocalSahneRenkleri.current.koyu)
}

/**
 * Sahne teması. [koyu] varsayılanda sistemden; [hareket] varsayılanda sistemin animasyon ayarından
 * ([sistemHareketi]). Testler ikisini de dışarıdan verebilir.
 *
 * Material kullanılmaz: dokunma izi ([BasmaIzi]: basılınca hafif küçülme, odakta çerçeve), metin seçme
 * renkleri ve yazı tabanı burada kurulur.
 */
@Composable
fun SahneTema(
    koyu: Boolean = isSystemInDarkTheme(),
    hareket: SahneHareket = sistemHareketi(),
    icerik: @Composable () -> Unit,
) {
    val renk = if (koyu) SahneRenkleri.Koyu else SahneRenkleri.Acik
    val yazi = SahneYazi.Varsayilan
    val iz = remember(renk, hareket) { BasmaIzi(renk.murekkep, hareket) }
    val secim = remember(renk) { TextSelectionColors(handleColor = renk.murekkep, backgroundColor = renk.vurgu.copy(alpha = 0.45f)) }
    CompositionLocalProvider(
        LocalSahneRenkleri provides renk,
        LocalSahneYazi provides yazi,
        LocalSahneHareket provides hareket,
        LocalSahneOlculer provides SahneOlculer(),
        LocalSahneMetinStili provides yazi.govde.copy(color = renk.murekkep),
        LocalIndication provides iz,
        LocalTextSelectionColors provides secim,
        content = icerik,
    )
}

/** Temanın yazı tabanıyla metin. [renk] verilmezse içinde bulunduğu yüzeyin yazı rengi ([LocalSahneMetinStili]). */
@Composable
fun Metin(
    metin: String,
    modifier: Modifier = Modifier,
    stil: TextStyle = LocalSahneMetinStili.current,
    renk: Color = Color.Unspecified,
    satirSiniri: Int = Int.MAX_VALUE,
) {
    val taban = LocalSahneMetinStili.current
    val son = taban.merge(stil).let { if (renk != Color.Unspecified) it.copy(color = renk) else it }
    BasicText(text = metin, modifier = modifier, style = son, maxLines = satirSiniri, softWrap = true,
        overflow = if (satirSiniri == Int.MAX_VALUE) androidx.compose.ui.text.style.TextOverflow.Clip
        else androidx.compose.ui.text.style.TextOverflow.Ellipsis)
}

/** İçindeki [Metin]'lerin rengini (ve isterse stilini) değiştirir: levha üstünde yazı levha takımının rengini alır. */
@Composable
fun YaziRengi(renk: Color, icerik: @Composable () -> Unit) {
    CompositionLocalProvider(LocalSahneMetinStili provides LocalSahneMetinStili.current.copy(color = renk), content = icerik)
}

/**
 * Dokunma izi. Material dalgası yerine: basılınca içerik %3 küçülür ve yayla geri döner (hareket azaltılmışsa
 * küçülme yerine hafif karartma), klavye ya da erişilebilirlik odağında yuvarlak çerçeve çizilir.
 */
class BasmaIzi(private val odakRengi: Color, private val hareket: SahneHareket) : IndicationNodeFactory {
    override fun create(interactionSource: InteractionSource): DelegatableNode =
        BasmaIziDugumu(interactionSource, odakRengi, hareket)

    override fun equals(other: Any?) = other is BasmaIzi && other.odakRengi == odakRengi && other.hareket.azalt == hareket.azalt
    override fun hashCode() = 31 * odakRengi.hashCode() + hareket.azalt.hashCode()
}

private class BasmaIziDugumu(
    private val kaynak: InteractionSource,
    private val odakRengi: Color,
    private val hareket: SahneHareket,
) : Modifier.Node(), DrawModifierNode {
    private val basili = Animatable(0f)
    private var odakta = false

    override fun onAttach() {
        coroutineScope.launch {
            val basmalar = mutableListOf<Interaction>()
            kaynak.interactions.collect { e ->
                when (e) {
                    is PressInteraction.Press -> basmalar += e
                    is PressInteraction.Release -> basmalar -= e.press
                    is PressInteraction.Cancel -> basmalar -= e.press
                    is FocusInteraction.Focus -> { odakta = true; invalidateDraw() }
                    is FocusInteraction.Unfocus -> { odakta = false; invalidateDraw() }
                }
                if (e is PressInteraction) {
                    val hedef = if (basmalar.isEmpty()) 0f else 1f
                    launch {
                        basili.animateTo(hedef, hareket.basma())
                    }
                }
            }
        }
    }

    // basili.value çizimde okunur; Modifier.Node çizimi anlık durum okumalarını izler, ayrıca tetiklemeye gerek yok.
    override fun ContentDrawScope.draw() {
        val p = basili.value
        if (hareket.uzamsal) {
            val s = 1f - 0.03f * p
            scale(s) { this@draw.drawContent() }
        } else {
            drawContent()
            if (p > 0f) drawRect(odakRengi.copy(alpha = 0.10f * p))
        }
        if (odakta) {
            val k = 3.dp.toPx()
            drawRoundRect(
                color = odakRengi,
                cornerRadius = CornerRadius(minOf(size.minDimension / 2f, 26.dp.toPx())),
                style = Stroke(width = k),
            )
        }
    }
}
