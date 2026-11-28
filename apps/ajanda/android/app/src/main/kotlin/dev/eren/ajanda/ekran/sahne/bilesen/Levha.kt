package dev.eren.ajanda.ekran.sahne.bilesen

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.toRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.layout
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.sahne.gezinme.paylasilanLevha
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import dev.eren.ajanda.ekran.sahne.tema.LevhaTakimi
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.tema.Simge
import dev.eren.ajanda.ekran.sahne.tema.YaziRengi
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Levhanın mozaikteki biçimi (SAHNE.md §3.2): sıradaki iş [BUYUK], öteki açık işler [KARE] ikişer
 * (tek kalan [GENIS]), taslaklar [GENIS]. Oran yükseklik/genişliktir ve **en az** yüksekliktir.
 */
enum class LevhaBoyu(val oran: Float) {
    BUYUK(0.84f),
    KARE(1.2f),
    GENIS(0.52f),

    /** Takvimin seçili gün şeridindeki kart (§3.2 tablo: 1 : 1.08, genişlik ekranın %64'ü). */
    SERIT(1.08f),
}

/**
 * Onay hareketinin (karakalemden boyamaya, SAHNE.md §5.4) ara değerleri, her biri 0..1:
 * [daire] levha zemininin sağ-alttan büyüyen boya dairesi, [yazi] yazı renginin mürekkepten takım rengine
 * geçişi, [cizim] çizimin karakalemden boyalıya geçişi (çizim yuvasına verilir).
 */
@Immutable
data class Boyama(val daire: Float, val yazi: Float, val cizim: Float) {
    companion object {
        val KARAKALEM = Boyama(0f, 0f, 0f)
        val BOYALI = Boyama(1f, 1f, 1f)
    }
}

/**
 * Çizim yuvasına verilen durum. [boyama]: 0 karakalem, 1 boyalı (§7.3); [canli]: sürekli hareketler oynasın mı
 * (yalnız Bugün'ün büyük levhasında, §5.15); [patlama]: tamamlamada köpük patlaması 0..1 (§5.2);
 * [imzaOynasin]: bir kez oynayan imza bu gösterimde oynasın mı (§5.15 "gün içinde bir kez").
 * Çizim takımı (`ekran/sahne/cizim/KayitCizimi`) bunları alır ([cizimYuvasi]).
 */
@Immutable
data class LevhaCizimi(
    val takim: LevhaTakimi,
    val boyama: Float,
    val canli: Boolean,
    val patlama: Float = 0f,
    val imzaOynasin: Boolean = true,
)

/** Levhanın çizim yuvası: verilen alanı (§3.2 "çizim kutusu") doldurur. Dekoratiftir; TalkBack okumaz. */
typealias LevhaCizimYuvasi = @Composable BoxScope.(LevhaCizimi) -> Unit

/**
 * Kaydın levhası: Sahne'nin temel öğesi.
 * - [taslak]: asistanın önerdiği, onay bekleyen kayıt; karakalem: boyasız, kesik çerçeveli. Onay hareketinde
 *   [boyama] 0'dan 1'e sürülür.
 * - [bitti]: renkleri solar (takvim ve tarihsizlerde; Bugün'de biten levha hap'a dönüşür).
 * - [isaret]: başlığın üstünde küçük çerçeveli işaret ("Geçti"); renk taşımaz, solmaz.
 * - [yikama]: tamamlama hareketinin yıkama bandı (0..1; §5.2). 0 ve 1'de görünmez.
 * - [patlama]: çizimdeki köpüklerin tamamlanma patlaması (0..1; §5.2); köpüksüz çizimde etkisiz.
 * - [kilitli]: hareket sürerken dokunmaya kapalı (§5.2 [A]).
 * - [kayitId] verilirse levha ayrıntının kapağıyla paylaşılan öğe olur ([paylasilanLevha]).
 * - [kose]: büyük ve geniş levhada sağ alt, karede sağ üst köşedeki denetim (ör. [TamamlaDugmesi]);
 *   taslakta onay düğmeleri sol alta gelir. Köşedeki denetim ayrı bir dokunma ve TalkBack hedefidir.
 * - [cizim]: çizim yuvası (`null`: çizimsiz).
 *
 * TalkBack levhayı tek düğüm okur (yazılar birleşir, okunan [contentDescription]'dır): [aciklama] (yoksa başlık ve zaman) ve durum ("asistan önerisi, onay
 * bekliyor", "tamamlandı"); [erisim] ile özel eylemler (Tamamla, Onayla, Vazgeç) eklenir. Varsayılan dokunma
 * ayrıntıyı açar. Büyük yazı ölçeğinde levha uzar; başlık en çok üç satır, sonra "…".
 */
@Composable
fun Levha(
    baslik: String,
    altSatir: String?,
    renk: LevhaRengi,
    boy: LevhaBoyu,
    onAc: () -> Unit,
    cizim: LevhaCizimYuvasi?,
    modifier: Modifier = Modifier,
    kayitId: String? = null,
    taslak: Boolean = false,
    bitti: Boolean = false,
    isaret: String? = null,
    boyama: Boyama = if (taslak) Boyama.KARAKALEM else Boyama.BOYALI,
    yikama: Float = 0f,
    patlama: Float = 0f,
    kilitli: Boolean = false,
    canli: Boolean = false,
    imzaOynasin: Boolean = true,
    aciklama: String? = null,
    erisim: (SemanticsPropertyReceiver.() -> Unit)? = null,
    kose: (@Composable () -> Unit)? = null,
) {
    val olcu = Sahne.olcu
    val renkler = Sahne.renk
    val takim = Sahne.levha(renk)
    val sekil = olcu.levha
    val yaziRengi = lerp(renkler.murekkep, takim.yazi, boyama.yazi.coerceIn(0f, 1f))
    // SAHNE.md §10.1: açıkta gök ve kum, koyuda gece levhasının kenarı zeminden zor seçilir; 1 dp çizgi.
    val kenarCizgisi = boyama.daire >= 1f && renk.zemindenSecilmez(renkler.koyu)
    val kesikAlfa = if (taslak) (1f - boyama.daire * 3f).coerceIn(0f, 1f) else 0f
    val durum = when {
        taslak && boyama.daire < 1f -> "asistan önerisi, onay bekliyor"
        bitti -> "tamamlandı"
        else -> null
    }
    val okunus = aciklama ?: listOfNotNull(baslik, altSatir, isaret?.lowercase()).joinToString(", ")
    val bant = takim.acikAyrinti.copy(alpha = 0.5f)
    Box(
        modifier
            .then(if (kayitId != null) Modifier.paylasilanLevha(kayitId, sekil) else Modifier)
            .enAzOran(boy.oran)
            .then(if (bitti) Modifier.soldur() else Modifier)
            .clip(sekil)
            .drawBehind {
                val d = boyama.daire
                when {
                    d >= 1f -> drawRect(takim.zemin)
                    d > 0f -> drawCircle(
                        takim.zemin,
                        radius = d * max(size.width, size.height) * 1.5f,
                        center = Offset(size.width * 0.82f, size.height * 0.84f),
                    )
                }
            }
            .then(if (kenarCizgisi) Modifier.border(1.dp, renkler.cizgi, sekil) else Modifier)
            .then(if (kesikAlfa > 0f) Modifier.kesikCerceve(renkler.soluk.copy(alpha = kesikAlfa), olcu.levhaYaricapi.value) else Modifier)
            .drawWithContent {
                drawContent()
                if (yikama > 0f && yikama < 1f) {
                    // Yıkama bandı: levhanın %55'i genişliğinde, −18° eğik, soldan sağa (−%140 → +%260).
                    val bg = size.width * 0.55f
                    val x = (-1.4f + 4.0f * yikama) * bg
                    rotate(-18f, pivot = center) {
                        drawRect(bant, topLeft = Offset(x, -size.height), size = Size(bg, size.height * 3f))
                    }
                }
            }
            .clickable(enabled = !kilitli, onClickLabel = "Aç", onClick = onAc)
            .semantics(mergeDescendants = true) {
                contentDescription = okunus
                if (durum != null) stateDescription = durum
                erisim?.invoke(this)
            },
    ) {
        if (cizim != null) {
            Box(Modifier.figurAlani(boy).clearAndSetSemantics {}) {
                cizim(LevhaCizimi(takim, boyama.cizim, canli, patlama, imzaOynasin))
            }
        }
        YaziRengi(yaziRengi) {
            val yazi = Sahne.yazi
            val (stil, ic) = when (boy) {
                LevhaBoyu.BUYUK -> yazi.levhaBuyuk to Modifier.padding(start = 18.dp, end = 68.dp, top = 16.dp, bottom = 16.dp)
                LevhaBoyu.KARE, LevhaBoyu.SERIT -> yazi.levhaKare to Modifier.padding(14.dp)
                LevhaBoyu.GENIS -> yazi.levhaGenis to Modifier.padding(start = 18.dp, end = 0.dp, top = 16.dp, bottom = 62.dp)
            }
            Column(
                Modifier
                    .align(if (boy == LevhaBoyu.GENIS) Alignment.TopStart else Alignment.BottomStart)
                    .fillMaxWidth(if (boy == LevhaBoyu.GENIS) 0.5f else 1f)
                    .then(ic),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (isaret != null) Isaret(isaret, yaziRengi, Modifier.padding(bottom = 4.dp))
                Metin(baslik, stil = stil, satirSiniri = 3)
                if (altSatir != null) {
                    // Tam opak: levha takımlarının hepsi tam opaklıkta ≥ 4.5:1 (SAHNE.md §10.1); %88'de domates 4.28'e düşer.
                    Metin(altSatir, stil = yazi.levhaAlt, satirSiniri = 2)
                }
            }
            if (kose != null) {
                Box(
                    Modifier
                        .align(
                            when {
                                // Şerit kartında yazı altta: taslağın onay düğmeleri üstte (çizim kutusunun üstü boş).
                                taslak && boy == LevhaBoyu.SERIT -> Alignment.TopStart
                                taslak -> Alignment.BottomStart
                                boy == LevhaBoyu.KARE || boy == LevhaBoyu.SERIT -> Alignment.TopEnd
                                else -> Alignment.BottomEnd
                            },
                        )
                        .then(
                            when {
                                taslak && boy == LevhaBoyu.SERIT -> Modifier.padding(start = 10.dp, top = 10.dp, end = 10.dp)
                                taslak -> Modifier.padding(start = 18.dp, bottom = 14.dp)
                                boy == LevhaBoyu.KARE || boy == LevhaBoyu.SERIT -> Modifier.padding(7.dp) // 42 dp daire, 48 dp dokunma alanı: görünür pay 10 dp
                                else -> Modifier.padding(11.dp) // 46 dp daire: görünür pay 12 dp
                            },
                        ),
                ) { kose() }
            }
        }
    }
}

/** Eski imza (takvim ve tarihsiz yer tutucuları): çizim olarak simge verilir. */
@Composable
fun Levha(
    baslik: String,
    altSatir: String?,
    renk: LevhaRengi,
    boy: LevhaBoyu,
    figur: ImageVector?,
    onAc: () -> Unit,
    modifier: Modifier = Modifier,
    kayitId: String? = null,
    taslak: Boolean = false,
    bitti: Boolean = false,
    kose: (@Composable () -> Unit)? = null,
) = Levha(
    baslik = baslik, altSatir = altSatir, renk = renk, boy = boy, onAc = onAc,
    cizim = figur?.let { f -> { d: LevhaCizimi -> LevhaFiguru(f, d.takim, d.boyama, Modifier.fillMaxSize()) } },
    modifier = modifier, kayitId = kayitId, taslak = taslak, bitti = bitti, kose = kose,
)

/** Levha üstündeki küçük çerçeveli işaret ("Geçti"). Rengi levhanın yazı rengi; anlamı metinde. */
@Composable
fun Isaret(yazi: String, renk: Color, modifier: Modifier = Modifier) {
    Metin(
        yazi,
        stil = Sahne.yazi.kucuk.copy(fontWeight = FontWeight.SemiBold),
        renk = renk,
        satirSiniri = 1,
        modifier = modifier
            .border(1.5.dp, renk.copy(alpha = 0.8f), Sahne.olcu.hap)
            .padding(horizontal = 9.dp, vertical = 2.dp),
    )
}

/**
 * Yer tutucu çizim: simge afiş boyunda, levhanın figür renginde; arkasında koyu ayrıntı renginde yumuşak bir
 * leke. [boyama] 0'da karakalem (boyasız, kesik daire, mürekkep çizgi), 1'de boyalı; aradaki değerlerde
 * ikisi üst üste geçer. Yalnız eski imzalı levhalar (takvim, tarihsiz yer tutucuları) kullanır; Bugün
 * levhaları gerçek çizimi ([cizimYuvasi] → `KayitCizimi`) çizer.
 */
@Composable
fun LevhaFiguru(figur: ImageVector, takim: LevhaTakimi, boyama: Float, modifier: Modifier = Modifier) {
    val murekkep = Sahne.renk.murekkep
    val b = boyama.coerceIn(0f, 1f)
    Box(modifier, contentAlignment = Alignment.Center) {
        Box(Modifier.aspectRatio(1f), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize()) {
                val r = size.minDimension * 0.46f
                if (b < 1f) {
                    drawCircle(
                        color = murekkep.copy(alpha = 0.35f * (1f - b)), radius = r,
                        style = Stroke(2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 5.dp.toPx()))),
                    )
                }
                if (b > 0f) {
                    drawCircle(takim.koyuAyrinti.copy(alpha = 0.28f * b), radius = r, center = Offset(center.x + r * 0.12f, center.y + r * 0.10f))
                    drawCircle(takim.acikAyrinti.copy(alpha = 0.22f * b), radius = r * 0.34f, center = Offset(center.x - r * 0.62f, center.y - r * 0.58f))
                }
            }
            Simge(
                figur, aciklama = null,
                modifier = Modifier.fillMaxSize(0.82f),
                renk = lerp(murekkep.copy(alpha = 0.7f), takim.figur, b),
            )
        }
    }
}

/** Eski imza: [taslak] karakalem, değilse boyalı. */
@Composable
fun LevhaFiguru(figur: ImageVector, takim: LevhaTakimi, taslak: Boolean, modifier: Modifier = Modifier) =
    LevhaFiguru(figur, takim, if (taslak) 0f else 1f, modifier)

/** Kenarı ekran zemininden zor seçilen takımlar (SAHNE.md §10.1). */
fun LevhaRengi.zemindenSecilmez(koyu: Boolean): Boolean =
    if (koyu) this == LevhaRengi.GECE else this == LevhaRengi.GOK || this == LevhaRengi.KUM

/** Taslak levhanın 2 dp, 6/6 dp kesikli, içe çizili çerçevesi (SAHNE.md §3.3). */
internal fun Modifier.kesikCerceve(renk: Color, yaricapDp: Float): Modifier = drawWithCache {
    val k = 2.dp.toPx()
    val kesik = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 6.dp.toPx()))
    val yaricap = yaricapDp.dp.toPx() - k / 2
    onDrawBehind {
        drawRoundRect(
            color = renk,
            topLeft = Offset(k / 2, k / 2),
            size = Size(size.width - k, size.height - k),
            cornerRadius = CornerRadius(yaricap),
            style = Stroke(width = k, pathEffect = kesik),
        )
    }
}

/** Çizimin levha içindeki yeri (SAHNE.md §3.2 "çizim kutusu": üst, sağ, alt, sol yüzdeleri). */
private fun Modifier.figurAlani(boy: LevhaBoyu): Modifier = layout { m, c ->
    val w = c.maxWidth
    val h = if (c.hasBoundedHeight) c.maxHeight else (w * boy.oran).roundToInt()
    val (ust, sag, alt, sol) = when (boy) {
        LevhaBoyu.BUYUK -> listOf(0.07f, 0.09f, 0.30f, 0.09f)
        LevhaBoyu.KARE -> listOf(0.25f, 0.06f, 0.33f, 0.06f)
        LevhaBoyu.GENIS -> listOf(0.10f, 0.03f, 0.10f, 0.50f)
        LevhaBoyu.SERIT -> listOf(0.20f, 0.06f, 0.32f, 0.06f)
    }
    val gw = (w * (1 - sag - sol)).roundToInt().coerceAtLeast(0)
    val gh = (h * (1 - ust - alt)).roundToInt().coerceAtLeast(0)
    val p = m.measure(Constraints.fixed(gw, gh))
    layout(w, h) { p.place((w * sol).roundToInt(), (h * ust).roundToInt()) }
}

/**
 * En/boy oranından kısa olmayan ama içerik gerektirirse uzayan yükseklik (`aspectRatio`'nun tersine büyük
 * yazıda içeriği kesmez; SAHNE.md §10.2). Genişliği üstünden alır.
 */
fun Modifier.enAzOran(oran: Float): Modifier = layout { m, c ->
    val w = c.maxWidth
    val enAz = (w * oran).roundToInt().coerceIn(c.minHeight, c.maxHeight)
    val p = m.measure(c.copy(minWidth = w, maxWidth = w, minHeight = enAz))
    layout(w, max(enAz, p.height)) { p.place(0, 0) }
}

/** Bitmiş kaydın solması: doygunluğu %30'a indirir (prototipte `filter:saturate(.3)`). */
fun Modifier.soldur(): Modifier = drawWithCache {
    val boya = Paint().apply { colorFilter = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0.3f) }) }
    onDrawWithContent {
        drawIntoCanvas { kanvas ->
            kanvas.saveLayer(size.toRect(), boya)
            drawContent()
            kanvas.restore()
        }
    }
}
