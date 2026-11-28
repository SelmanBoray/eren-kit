package dev.eren.ajanda.ekran.sahne.ekranlar

import androidx.compose.animation.BoundsTransform
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.animateBounds
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.LookaheadScope
import androidx.compose.ui.layout.Placeable
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.eren.ajanda.ekran.Takvim
import dev.eren.ajanda.ekran.sahne.bilesen.soldur
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.veri.AyIzgarasi
import dev.eren.ajanda.ekran.sahne.veri.DonemSeridi
import dev.eren.ajanda.ekran.sahne.veri.GunHucresi
import dev.eren.ajanda.ekran.sahne.veri.TakvimNoktasi
import java.time.LocalDate
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Ay ızgarası (SAHNE.md §3.6, §5.12): 7 sütun, satır arası 2 dp, hücre en/boy en az 1 : 1.08; numara ve altında
 * en çok üç nokta; haftanın altında dönem şeritleri (en çok iki sıra; sığmayan "+" olur).
 *
 * Seçili gün lekesi tek bir öğedir: gün değişince eski günden yeni güne yayla kayar ([animateBounds]), 0.7'den
 * büyür, rengi 300 ms'de yeni günün takımına geçer; numaralar 250 ms'de. Hareket azaltılmışsa leke yeni günde
 * belirir (§6).
 *
 * TalkBack: her hücre ayrı odaktır, seçilebilir ("seçili" durumu); okunuşu tarih, kayıt, taslak ve çok günlü
 * sayısı ([GunHucresi.okunus]). Şeritler ve noktalar dekoratiftir: anlamları hücrenin okunuşunda.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
internal fun AyIzgarasiCiz(
    iz: AyIzgarasi,
    secili: LocalDate?,
    bugun: LocalDate,
    lekeRengi: LevhaRengi?,
    onSec: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
) {
    val renk = Sahne.renk
    val hareket = Sahne.hareket
    val takim = lekeRengi?.let { Sahne.levha(it) }
    // Hareket azaltılmışsa renk de anında: geçiş kurulmaz (bir kare bile eski renk kalmasın).
    val lekeZemin = renkGecisi(takim?.zemin ?: renk.murekkep, 300, hareket.azalt)
    val lekeYazi = renkGecisi(takim?.yazi ?: renk.zemin, 250, hareket.azalt)
    val diz = remember(hareket) { BoundsTransform { _, _ -> hareket.yay<Rect>() } }
    val olcek = remember { Animatable(1f) }
    val ilk = remember { booleanArrayOf(true) }
    LaunchedEffect(secili) {
        if (!ilk[0] && secili != null && hareket.uzamsal) {
            olcek.snapTo(0.7f)
            olcek.animateTo(1f, hareket.yay())
        }
    }
    SideEffect { ilk[0] = false }
    val seciliIndeks = iz.hucreler.indexOfFirst { it.tarih == secili }

    LookaheadScope {
        Layout(
            modifier = modifier,
            content = {
                Box(
                    Modifier
                        .then(if (hareket.uzamsal) Modifier.animateBounds(this@LookaheadScope, boundsTransform = diz) else Modifier)
                        .graphicsLayer { scaleX = olcek.value; scaleY = olcek.value }
                        .clip(CircleShape)
                        .background(lekeZemin),
                )
                iz.hucreler.forEachIndexed { i, h ->
                    key(h.tarih) { GunHucresiCiz(h, i == seciliIndeks, h.tarih == bugun, lekeYazi, onSec) }
                }
                iz.seritler.forEach { s -> key(s.anahtar) { DonemSeridiCiz(s) } }
            },
        ) { olculer, c ->
            val w = c.maxWidth
            fun x(sutun: Int) = (sutun * w / 7f).roundToInt()
            val hucreEnAz = (w / 7f * 1.08f).roundToInt()
            val n = iz.hucreler.size
            val hucreler = ArrayList<Placeable>(n)
            for (i in 0 until n) {
                val s = i % 7
                val cw = x(s + 1) - x(s)
                hucreler += olculer[1 + i].measure(Constraints(minWidth = cw, maxWidth = cw, minHeight = hucreEnAz))
            }
            val hc = hucreler.maxOfOrNull { it.height } ?: hucreEnAz
            val ic = 3.dp.roundToPx()
            val seritOlculeri = iz.seritler.mapIndexed { j, s ->
                val gen = (x(s.sonSutun + 1) - x(s.basSutun) - (if (s.basliyor) ic else 0) - (if (s.bitiyor) ic else 0)).coerceAtLeast(0)
                olculer[1 + n + j].measure(Constraints.fixedWidth(gen))
            }
            val seritH = max(16.dp.roundToPx(), seritOlculeri.maxOfOrNull { it.height } ?: 0)
            val seritAdim = seritH + 3.dp.roundToPx()
            val ara = 2.dp.roundToPx()
            // Şerit alanı haftaya göre: şeritsiz hafta sıkı kalır, şeritli hafta kendi sıra sayısı kadar uzar.
            val haftaSira = IntArray(iz.haftalar)
            for (s in iz.seritler) if (s.hafta in haftaSira.indices) haftaSira[s.hafta] = max(haftaSira[s.hafta], s.sira + 1)
            val satirY = IntArray(iz.haftalar + 1)
            for (h in 0 until iz.haftalar) {
                val alan = if (haftaSira[h] > 0) haftaSira[h] * seritAdim + 2.dp.roundToPx() else 0
                satirY[h + 1] = satirY[h] + hc + alan + ara
            }
            val yukseklik = (satirY[iz.haftalar] - ara).coerceAtLeast(0)
            val cap = if (seciliIndeks >= 0) {
                val s = seciliIndeks % 7
                (min(x(s + 1) - x(s), hc) - 2.dp.roundToPx()).coerceAtLeast(0)
            } else {
                0
            }
            val leke = olculer[0].measure(Constraints.fixed(cap, cap))
            layout(w, yukseklik) {
                if (seciliIndeks >= 0) {
                    val s = seciliIndeks % 7
                    val h = seciliIndeks / 7
                    leke.place(x(s) + (x(s + 1) - x(s) - cap) / 2, satirY[h] + (hc - cap) / 2)
                }
                hucreler.forEachIndexed { i, p -> p.place(x(i % 7), satirY[i / 7]) }
                iz.seritler.forEachIndexed { j, s ->
                    seritOlculeri[j].place(
                        x(s.basSutun) + if (s.basliyor) ic else 0,
                        satirY[s.hafta] + hc + s.sira * seritAdim,
                    )
                }
            }
        }
    }
}

/** Renk geçişi ([sureMs], doğrusal değil yumuşak); [anlik] ise geçişsiz hedef renk. */
@Composable
private fun renkGecisi(hedef: Color, sureMs: Int, anlik: Boolean): Color {
    if (anlik) return hedef
    val r by animateColorAsState(hedef, tween(sureMs), label = "renk")
    return r
}

/** Gün hücresi: numara (bugün 800 ve altı çizili; ay dışı soluk, %50, 400) ve noktalar. */
@Composable
private fun GunHucresiCiz(h: GunHucresi, secili: Boolean, bugunMu: Boolean, lekeYazi: Color, onSec: (LocalDate) -> Unit) {
    val renk = Sahne.renk
    val hareket = Sahne.hareket
    val hedef = when {
        secili -> lekeYazi
        !h.ayda -> renk.soluk.copy(alpha = 0.5f)
        else -> renk.murekkep
    }
    val sayiRengi = renkGecisi(hedef, 250, hareket.azalt)
    Box(
        Modifier
            .selectable(selected = secili, onClick = { onSec(h.tarih) })
            .semantics { contentDescription = h.okunus },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Metin(
                h.tarih.dayOfMonth.toString(),
                stil = Sahne.yazi.gunNo.copy(
                    fontWeight = when {
                        bugunMu -> FontWeight.ExtraBold
                        !h.ayda -> FontWeight.Normal
                        else -> FontWeight.SemiBold
                    },
                ),
                renk = sayiRengi,
                satirSiniri = 1,
                modifier = Modifier
                    .clearAndSetSemantics {}
                    .then(
                        if (bugunMu) {
                            // Bugün: numaranın altı çizili (2.5 dp, 4 dp aşağıda).
                            Modifier.drawBehind {
                                val y = size.height + 4.dp.toPx()
                                val k = 2.5.dp.toPx()
                                drawLine(sayiRengi, Offset(size.width * 0.12f, y), Offset(size.width * 0.88f, y), strokeWidth = k, cap = StrokeCap.Round)
                            }
                        } else {
                            Modifier
                        },
                    ),
            )
            Spacer(Modifier.height(if (bugunMu) 8.dp else 5.dp))
            Noktalar(h.noktalar, h.fazla, secili, lekeYazi)
        }
    }
}

/**
 * En çok üç işaret (7 dp daire, 3 dp ara): açık dolu (kaydın takımı), tamamlanmış %40, taslak 1.5 dp kesikli halka
 * (soluk), sığmayan için "+". Seçili günde lekenin yazı rengiyle. Açık temada zeminden zor seçilen takımlarda
 * (gök, kum, pembe, hardal) noktaya 1 dp koyu halka (§10.1).
 */
@Composable
private fun Noktalar(noktalar: List<TakvimNoktasi>, fazla: Boolean, secili: Boolean, lekeYazi: Color) {
    val renk = Sahne.renk
    val koyu = renk.koyu
    val murekkep = renk.murekkep
    val soluk = renk.soluk
    val takimlar = noktalar.map { n -> n.renk?.let { Sahne.levha(it) } }
    Canvas(Modifier.size(width = 27.dp, height = 7.dp).clearAndSetSemantics {}) {
        val r = 3.5.dp.toPx()
        val adim = 10.dp.toPx()
        val adet = noktalar.size + if (fazla) 1 else 0
        if (adet == 0) return@Canvas
        var cx = size.width / 2f - (adet - 1) * adim / 2f
        val cy = size.height / 2f
        noktalar.forEachIndexed { i, n ->
            val t = takimlar[i]
            val dolgu = when {
                secili -> lekeYazi.copy(alpha = 0.9f)
                t != null -> t.zemin
                else -> murekkep
            }
            when (n.tur) {
                Takvim.Nokta.TASLAK -> drawCircle(
                    if (secili) lekeYazi else soluk, radius = r - 0.75.dp.toPx(), center = Offset(cx, cy),
                    style = Stroke(1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(), 1.6.dp.toPx()))),
                )
                else -> {
                    val alfa = if (n.tur == Takvim.Nokta.KAPALI) 0.4f else 1f
                    drawCircle(dolgu.copy(alpha = dolgu.alpha * alfa), radius = r, center = Offset(cx, cy))
                    val r0 = n.renk
                    if (!secili && !koyu && t != null && n.tur == Takvim.Nokta.ACIK &&
                        (r0 == LevhaRengi.GOK || r0 == LevhaRengi.KUM || r0 == LevhaRengi.PEMBE || r0 == LevhaRengi.HARDAL)
                    ) {
                        drawCircle(t.koyuAyrinti, radius = r - 0.5.dp.toPx(), center = Offset(cx, cy), style = Stroke(1.dp.toPx()))
                    }
                    // Koyu temada gece takımı zeminden seçilmez (§10.1): soluk halka.
                    if (!secili && koyu && r0 == LevhaRengi.GECE) {
                        drawCircle(soluk.copy(alpha = alfa), radius = r - 0.5.dp.toPx(), center = Offset(cx, cy), style = Stroke(1.dp.toPx()))
                    }
                }
            }
            cx += adim
        }
        if (fazla) {
            val k = 2.8.dp.toPx()
            val c = if (secili) lekeYazi else soluk
            val s = 1.6.dp.toPx()
            drawLine(c, Offset(cx - k, cy), Offset(cx + k, cy), strokeWidth = s, cap = StrokeCap.Round)
            drawLine(c, Offset(cx, cy - k), Offset(cx, cy + k), strokeWidth = s, cap = StrokeCap.Round)
        }
    }
}

/**
 * Dönem şeridinin bir haftadaki parçası: kaydın takımında bant, gerçek uçlarında yuvarlak; adı içinde. Tamamlanan
 * solar ve üstü çizilir; taslak karakalem (boyasız, kesikli çerçeve).
 */
@Composable
private fun DonemSeridiCiz(s: DonemSeridi) {
    val takim = Sahne.levha(s.renk)
    val renk = Sahne.renk
    val r = 7.dp
    val sekil = RoundedCornerShape(
        topStart = if (s.basliyor) r else 0.dp, bottomStart = if (s.basliyor) r else 0.dp,
        topEnd = if (s.bitiyor) r else 0.dp, bottomEnd = if (s.bitiyor) r else 0.dp,
    )
    val soluk = renk.soluk
    Box(
        Modifier
            .clearAndSetSemantics {}
            .then(if (s.kapali) Modifier.soldur().graphicsLayer { alpha = 0.55f } else Modifier)
            .clip(sekil)
            .then(
                if (s.taslak) {
                    Modifier.drawWithCache {
                        val cerceve = sekil.createOutline(size, layoutDirection, this)
                        val kalem = Stroke(1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx())))
                        onDrawBehind { drawOutline(cerceve, soluk, style = kalem) }
                    }
                } else {
                    Modifier.background(takim.zemin)
                },
            )
            .padding(horizontal = 6.dp, vertical = 1.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Metin(
            s.baslik,
            stil = Sahne.yazi.kucuk.copy(
                fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.SemiBold,
                textDecoration = if (s.kapali) TextDecoration.LineThrough else null,
            ),
            renk = if (s.taslak) renk.murekkep else takim.yazi,
            satirSiniri = 1,
        )
    }
}
