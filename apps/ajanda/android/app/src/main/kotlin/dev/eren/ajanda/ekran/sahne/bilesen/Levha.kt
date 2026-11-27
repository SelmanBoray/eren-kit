package dev.eren.ajanda.ekran.sahne.bilesen

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.toRect
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.layout
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
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
}

/**
 * Kaydın levhası: Sahne'nin temel öğesi. Rengi kaydın renk takımından, çizimi simge anahtarından gelir.
 * - [taslak]: asistanın önerdiği, onay bekleyen kayıt; karakalem: boyasız, kesik çerçeveli.
 * - [bitti]: renkleri solar.
 * - [kayitId] verilirse levha ayrıntının kapağıyla paylaşılan öğe olur ([paylasilanLevha]).
 * - [kose]: büyük ve geniş levhada sağ alt, karede sağ üst köşedeki denetim (ör. [TamamlaDugmesi]);
 *   taslakta onay düğmeleri sol alta gelir. Köşedeki denetim ayrı bir dokunma ve TalkBack hedefidir.
 *
 * TalkBack levhayı tek düğüm okur: başlık, zaman ve durum ("asistan önerisi, onay bekliyor", "tamamlandı").
 * Büyük yazı ölçeğinde levha uzar; başlık en çok üç satır, sonra "…".
 */
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
) {
    val olcu = Sahne.olcu
    val renkler = Sahne.renk
    val takim = Sahne.levha(renk)
    val sekil = olcu.levha
    val yaziRengi = if (taslak) renkler.murekkep else takim.yazi
    // SAHNE.md §10.1: açıkta gök ve kum, koyuda gece levhasının kenarı zeminden zor seçilir; 1 dp çizgi.
    val kenarCizgisi = !taslak && renk.zemindenSecilmez(renkler.koyu)
    val durum = when {
        taslak -> "asistan önerisi, onay bekliyor"
        bitti -> "tamamlandı"
        else -> null
    }
    Box(
        modifier
            .then(if (kayitId != null) Modifier.paylasilanLevha(kayitId, sekil) else Modifier)
            .enAzOran(boy.oran)
            .then(if (bitti) Modifier.soldur() else Modifier)
            .clip(sekil)
            .then(
                when {
                    taslak -> Modifier.kesikCerceve(renkler.soluk, olcu.levhaYaricapi.value)
                    kenarCizgisi -> Modifier.background(takim.zemin).border(1.dp, renkler.cizgi, sekil)
                    else -> Modifier.background(takim.zemin)
                },
            )
            .clickable(onClickLabel = "Aç", role = Role.Button, onClick = onAc)
            .semantics(mergeDescendants = true) { if (durum != null) stateDescription = durum },
    ) {
        if (figur != null) {
            LevhaFiguru(figur, takim, taslak, Modifier.figurAlani(boy))
        }
        YaziRengi(yaziRengi) {
            val yazi = Sahne.yazi
            val (stil, ic) = when (boy) {
                LevhaBoyu.BUYUK -> yazi.levhaBuyuk to Modifier.padding(start = 18.dp, end = 68.dp, top = 16.dp, bottom = 16.dp)
                LevhaBoyu.KARE -> yazi.levhaKare to Modifier.padding(14.dp)
                LevhaBoyu.GENIS -> yazi.levhaGenis to Modifier.padding(start = 18.dp, end = 0.dp, top = 16.dp, bottom = 62.dp)
            }
            Column(
                Modifier
                    .align(if (boy == LevhaBoyu.GENIS) Alignment.TopStart else Alignment.BottomStart)
                    .fillMaxWidth(if (boy == LevhaBoyu.GENIS) 0.5f else 1f)
                    .then(ic),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Metin(baslik, stil = stil, satirSiniri = 3)
                if (altSatir != null) {
                    Metin(altSatir, stil = yazi.levhaAlt, modifier = Modifier.alpha(0.88f), satirSiniri = 2)
                }
            }
            if (kose != null) {
                Box(
                    Modifier
                        .align(
                            when {
                                taslak -> Alignment.BottomStart
                                boy == LevhaBoyu.KARE -> Alignment.TopEnd
                                else -> Alignment.BottomEnd
                            },
                        )
                        .then(
                            when {
                                taslak -> Modifier.padding(start = 18.dp, bottom = 14.dp)
                                boy == LevhaBoyu.KARE -> Modifier.padding(7.dp) // 42 dp daire, 48 dp dokunma alanı: görünür pay 10 dp
                                else -> Modifier.padding(11.dp) // 46 dp daire: görünür pay 12 dp
                            },
                        ),
                ) { kose() }
            }
        }
    }
}

/**
 * Levhanın çizimi. Bu dilimde çizim takımı yok (SAHNE.md §7, sonraki dilim): simge afiş boyunda, levhanın
 * figür renginde çizilir; arkasında koyu ayrıntı renginde yumuşak bir leke. Taslakta boyasız, kesik çizgi.
 * Dekoratiftir, TalkBack okumaz.
 */
@Composable
fun LevhaFiguru(figur: ImageVector, takim: LevhaTakimi, taslak: Boolean, modifier: Modifier = Modifier) {
    val murekkep = Sahne.renk.murekkep
    Box(modifier, contentAlignment = Alignment.Center) {
        Box(Modifier.aspectRatio(1f), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize()) {
                val r = size.minDimension * 0.46f
                if (taslak) {
                    drawCircle(
                        color = murekkep.copy(alpha = 0.35f), radius = r,
                        style = Stroke(2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 5.dp.toPx()))),
                    )
                } else {
                    drawCircle(takim.koyuAyrinti.copy(alpha = 0.28f), radius = r, center = Offset(center.x + r * 0.12f, center.y + r * 0.10f))
                    drawCircle(takim.acikAyrinti.copy(alpha = 0.22f), radius = r * 0.34f, center = Offset(center.x - r * 0.62f, center.y - r * 0.58f))
                }
            }
            Simge(
                figur, aciklama = null,
                modifier = Modifier.fillMaxSize(0.82f),
                renk = if (taslak) murekkep.copy(alpha = 0.7f) else takim.figur,
            )
        }
    }
}

/** Kenarı ekran zemininden zor seçilen takımlar (SAHNE.md §10.1). */
fun LevhaRengi.zemindenSecilmez(koyu: Boolean): Boolean =
    if (koyu) this == LevhaRengi.GECE else this == LevhaRengi.GOK || this == LevhaRengi.KUM

/** Taslak levhanın 2 dp, 6/6 dp kesikli, içe çizili çerçevesi (SAHNE.md §3.3). */
private fun Modifier.kesikCerceve(renk: androidx.compose.ui.graphics.Color, yaricapDp: Float): Modifier = drawWithCache {
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
