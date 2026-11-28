package dev.eren.ajanda.ekran.sahne.cizim

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Spacer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onVisibilityChanged
import androidx.compose.animation.core.withInfiniteAnimationFrameNanos
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import dev.eren.ajanda.ekran.sahne.tema.LevhaTakimi
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Kaydın çizimi (SAHNE.md §7). Ekranlar bunu levhaya, ayrıntı kapağına ve yeni kayıt sahnesine yuva olarak verir.
 *
 * - [anahtar]: kaydın simge anahtarı ([CIZIM_ANAHTARLARI]); bilinmeyen ya da `null` anahtar `genel` çizer.
 * - [ilerleme]: 0 karakalem (taslak), 1 boyalı. Arası onay geçişidir: dolgular `rol saydamlığı × ilerleme`,
 *   kesikli karakalem çizgisi `1 − ilerleme` saydamlıkla çizilir. Geçişi çağıran sürer ([boyamaIlerlemesi]).
 * - [takim]: renkler; temaya göre `Sahne.levha(renk)`. Çizim zemin çizmez, levhanın zemini üstüne konur.
 * - [canli]: canlı parçalar (köpük, buhar, pırıltı, imza) oynasın mı. Yalnız "canlı yerlerde" açılır: büyük
 *   levha, ayrıntı kapağı, yeni kayıt sahnesi (§5.15). Hareket azaltılmışsa ([Sahne.hareket]) yok sayılır:
 *   parçalar dinlenme karesinde, imza tamamen çizili durur. Çizim ekranda görünmüyorsa ya da uygulama ön
 *   planda değilse saat durur, kare çizilmez.
 * - [karakalemRengi]: taslak çizgisinin rengi (`s-ink`).
 * - [patlama]: köpüklerin tamamlanma patlaması, 0 → 1 ([KOPUK_PATLAMA_MS] boyunca çağıran sürer); köpüğü
 *   olmayan çizimde etkisiz.
 * - [imzaOynasin]: bir kez oynayan imza bu gösterimde oynasın mı (§5.15: gün içinde bir kez). `false` ise imza
 *   baştan çizili gelir.
 *
 * Boyut: 240 × 160 kutusu verilen alana ortalanarak sığdırılır (`contain`). Genişlik verilip yükseklik
 * serbestse yükseklik 2:3 oranından gelir. TalkBack için süstür; anlamı başlık taşır.
 */
@Composable
fun KayitCizimi(
    anahtar: String?,
    ilerleme: Float,
    takim: LevhaTakimi,
    canli: Boolean,
    modifier: Modifier = Modifier,
    karakalemRengi: Color = Sahne.renk.murekkep,
    patlama: Float = 0f,
    imzaOynasin: Boolean = true,
) {
    val hazir = cizimBul(anahtar).hazir
    val hareketAcik = canli && Sahne.hareket.surekli && (hazir.surekliVar || hazir.tekSeferVar)

    var gorunur by remember { mutableStateOf(false) }
    val yasam by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val aktif = hareketAcik && gorunur && yasam.isAtLeast(Lifecycle.State.RESUMED)

    // Sürekli döngülerin saati: yalnız aktifken ilerler; durunca kaldığı yerde bekler.
    val surekliSaat = remember { mutableLongStateOf(0L) }
    if (hazir.surekliVar) {
        LaunchedEffect(aktif) {
            if (!aktif) return@LaunchedEffect
            val taban = surekliSaat.longValue
            var bas = -1L
            while (true) {
                withInfiniteAnimationFrameNanos { n ->
                    if (bas < 0) bas = n
                    surekliSaat.longValue = taban + (n - bas) / 1_000_000
                }
            }
        }
    }

    // Bir kez oynayan imzanın saati: 0 → TEK_SEFER_SURE_MS; oynamayacaksa baştan bitmiş.
    val tekSeferOynar = hareketAcik && imzaOynasin
    val tekSefer = remember(hazir) { Animatable(if (tekSeferOynar) 0f else BITMIS) }
    if (hazir.tekSeferVar) {
        LaunchedEffect(tekSeferOynar, aktif) {
            if (!tekSeferOynar) tekSefer.snapTo(BITMIS)
            else if (aktif && tekSefer.value < BITMIS) {
                tekSefer.animateTo(BITMIS, tween((BITMIS - tekSefer.value).roundToInt(), easing = LinearEasing))
            }
        }
    }

    val poz = remember { Poz() }
    Spacer(
        modifier
            .varsayilanBoy()
            .then(if (hareketAcik) Modifier.onVisibilityChanged(minFractionVisible = 0.05f) { gorunur = it } else Modifier)
            .drawBehind {
                // Saatler burada okunur: kare başına yalnız çizim yenilenir, yeniden oluşturma olmaz.
                val surekliMs = if (hareketAcik) surekliSaat.longValue else 0L
                cizimiCiz(hazir, takim, karakalemRengi, ilerleme, surekliMs, tekSefer.value, patlama, poz)
            },
    )
}

/** Köpük patlamasının süresi (SAHNE.md §5.2): [KayitCizimi] `patlama` parametresi bu sürede 0 → 1 sürülür. */
const val KOPUK_PATLAMA_MS = 550

/**
 * Karakalemden boyamaya geçişin ilerlemesi (SAHNE.md §5.4): [boyali] olunca 0 → 1, 600 ms, 150 ms gecikme
 * (prototipte dolgunun `transition: fill-opacity .6s .15s`). Hareket azaltılmışsa anında.
 */
@Composable
fun boyamaIlerlemesi(boyali: Boolean): Float {
    val azalt = Sahne.hareket.azalt
    val deger by animateFloatAsState(
        targetValue = if (boyali) 1f else 0f,
        animationSpec = if (azalt) snap() else tween(BOYAMA_MS, delayMillis = BOYAMA_GECIKME_MS, easing = CSS_EASE),
        label = "boyama",
    )
    return deger
}

private const val BOYAMA_MS = 600
private const val BOYAMA_GECIKME_MS = 150
private const val BITMIS = CizimHareketi.TEK_SEFER_SURE_MS.toFloat()

/** CSS `ease`. */
private val CSS_EASE = CubicBezierEasing(0.25f, 0.1f, 0.25f, 1f)

/** Kısıt yoksa 240 × 160 dp; yalnız genişlik verilmişse yükseklik 2:3. */
private fun Modifier.varsayilanBoy(): Modifier = layout { olculen, c ->
    val g = if (c.hasBoundedWidth) c.maxWidth else 240.dp.roundToPx().coerceIn(c.minWidth, c.maxWidth)
    val y = if (c.hasBoundedHeight) c.maxHeight
    else (g * CIZIM_YUKSEKLIK / CIZIM_GENISLIK).roundToInt().coerceIn(c.minHeight, c.maxHeight)
    val p = olculen.measure(Constraints.fixed(g, y))
    layout(g, y) { p.place(0, 0) }
}

private const val SIZMA = 0.002f

/** Karakalem çizgisi: 2 birim, 5/5 kesik (viewBox biriminde; çizimle ölçeklenir). Dolgu parçalarında uç düz. */
private val KARAKALEM_DOLGU by lazy(LazyThreadSafetyMode.NONE) {
    Stroke(width = 2f, cap = StrokeCap.Butt, pathEffect = PathEffect.dashPathEffect(floatArrayOf(5f, 5f)))
}

/** Çizgi parçalarında karakalem ucu yuvarlak kalır (prototipte `stroke-linecap: round` korunur). */
private val KARAKALEM_CIZGI by lazy(LazyThreadSafetyMode.NONE) {
    Stroke(width = 2f, cap = StrokeCap.Round, pathEffect = PathEffect.dashPathEffect(floatArrayOf(5f, 5f)))
}

/** Bütün çizimi 240 × 160 kutusundan bu alana ortalayarak çizer. */
internal fun DrawScope.cizimiCiz(
    hazir: HazirCizim,
    takim: LevhaTakimi,
    karakalem: Color,
    ilerleme: Float,
    surekliMs: Long,
    tekSeferMs: Float,
    patlama: Float,
    poz: Poz,
) {
    val s = min(size.width / CIZIM_GENISLIK, size.height / CIZIM_YUKSEKLIK)
    if (s <= 0f) return
    val boya = ilerleme.coerceIn(0f, 1f)
    val ox = (size.width - CIZIM_GENISLIK * s) / 2f
    val oy = (size.height - CIZIM_YUKSEKLIK * s) / 2f
    withTransform({
        translate(ox, oy)
        scale(s, s, pivot = Offset.Zero)
    }) {
        for (hp in hazir.parcalar) {
            CizimHareketi.hesapla(hp.parca, surekliMs, tekSeferMs, patlama, poz)
            val boyaAlfa = (hp.parca.alfa * boya * poz.alfa).coerceIn(0f, 1f)
            val kalemAlfa = ((1f - boya) * poz.alfa).coerceIn(0f, 1f)
            if (boyaAlfa <= SIZMA && kalemAlfa <= SIZMA) continue
            val yol = kirpilmis(hp, poz.kirp) ?: continue
            val renk = rolRengi(hp.parca.rol, takim)
            if (poz.dx == 0f && poz.dy == 0f && poz.olcek == 1f && poz.aci == 0f) {
                parcaCiz(hp, yol, renk, boyaAlfa, karakalem, kalemAlfa)
            } else {
                withTransform({
                    translate(poz.dx, poz.dy)
                    if (poz.aci != 0f) rotate(poz.aci, hp.merkez)
                    if (poz.olcek != 1f) scale(poz.olcek, poz.olcek, hp.merkez)
                }) {
                    parcaCiz(hp, yol, renk, boyaAlfa, karakalem, kalemAlfa)
                }
            }
        }
    }
}

private fun DrawScope.parcaCiz(hp: HazirParca, yol: Path, renk: Color, boyaAlfa: Float, karakalem: Color, kalemAlfa: Float) {
    if (boyaAlfa > SIZMA) drawPath(yol, renk, alpha = boyaAlfa, style = hp.boyaliCizgi ?: Fill)
    if (kalemAlfa > SIZMA) {
        drawPath(yol, karakalem, alpha = kalemAlfa, style = if (hp.parca.cizgi != null) KARAKALEM_CIZGI else KARAKALEM_DOLGU)
    }
}

private fun kirpilmis(hp: HazirParca, oran: Float): Path? {
    val olcer = hp.olcer ?: return hp.yol
    if (oran >= 1f) return hp.yol
    if (oran <= 0f) return null
    val k = hp.kirpik!!
    k.rewind()
    olcer.getSegment(0f, olcer.length * oran, k, true)
    return k
}

internal fun rolRengi(rol: Rol, takim: LevhaTakimi): Color = when (rol) {
    Rol.F -> takim.figur
    Rol.L -> takim.acikAyrinti
    Rol.D -> takim.koyuAyrinti
    Rol.B -> takim.zemin
}
