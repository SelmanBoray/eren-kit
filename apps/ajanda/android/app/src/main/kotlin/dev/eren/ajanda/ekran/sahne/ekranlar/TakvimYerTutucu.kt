package dev.eren.ajanda.ekran.sahne.ekranlar

import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.sahne.bilesen.Levha
import dev.eren.ajanda.ekran.sahne.bilesen.LevhaBoyu
import dev.eren.ajanda.ekran.sahne.bilesen.YuvarlakDugme
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.tema.Simgeler
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.time.temporal.TemporalAdjusters

/**
 * Takvim sekmesinin yer tutucusu (SAHNE.md §3.6): ay başlığı, haftanın günleri, ay ızgarası, seçili günün
 * şeridi. Noktalar örnek kayıtlardan. Ay ve gün seçimi çalışır; veri bağı sonraki dilimde.
 */
@Composable
fun TakvimYerTutucu(bugun: LocalDate, onKayit: (String) -> Unit, modifier: Modifier = Modifier) {
    var ayKaydir by rememberSaveable { mutableLongStateOf(0L) }
    var secili by rememberSaveable { mutableStateOf(bugun.toEpochDay()) }
    val ay = YearMonth.from(bugun).plusMonths(ayKaydir)
    val seciliGun = LocalDate.ofEpochDay(secili)
    val pay = sayfaPayi()
    val yon = LocalLayoutDirection.current
    val hareket = Sahne.hareket

    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(top = pay.calculateTopPadding(), bottom = pay.calculateBottomPadding()),
    ) {
        Column(Modifier.padding(start = pay.calculateStartPadding(yon), end = pay.calculateEndPadding(yon))) {
            Row(Modifier.padding(start = 2.dp, end = 2.dp, top = 4.dp, bottom = 14.dp), verticalAlignment = Alignment.Bottom) {
                Metin(
                    ay.month.getDisplayName(TextStyle.FULL_STANDALONE, TURKCE).replaceFirstChar { it.titlecase(TURKCE) },
                    stil = Sahne.yazi.ayBasligi,
                    modifier = Modifier.semantics { heading() },
                    satirSiniri = 1,
                )
                Metin(
                    ay.year.toString(),
                    stil = Sahne.yazi.govde.copy(fontWeight = FontWeight.Medium),
                    renk = Sahne.renk.soluk,
                    modifier = Modifier.padding(start = 10.dp, bottom = 3.dp).weight(1f),
                )
                // Prototipte 44 dp; dokunma alanı en az 48 dp olsun diye ortak yuvarlak düğme boyu (SAHNE.md §3.1).
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    YuvarlakDugme(Simgeler.Geri, "Önceki ay", { ayKaydir -= 1 })
                    YuvarlakDugme(Simgeler.Ileri, "Sonraki ay", { ayKaydir += 1 })
                }
            }
            // Büyük yazıda üç harf sığmaz; iki harflik yaygın kısaltma.
            val kisa = LocalDensity.current.fontScale >= 1.5f
            Row(Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
                for (g in DayOfWeek.entries) {
                    Metin(
                        if (kisa) IKI_HARF[g.ordinal] else g.getDisplayName(TextStyle.SHORT, TURKCE).replaceFirstChar { it.titlecase(TURKCE) },
                        stil = Sahne.yazi.kucuk.copy(textAlign = androidx.compose.ui.text.style.TextAlign.Center),
                        renk = Sahne.renk.soluk,
                        modifier = Modifier.weight(1f),
                        satirSiniri = 1,
                    )
                }
            }
            AnimatedContent(
                targetState = ay,
                transitionSpec = {
                    val yonu = if (targetState > initialState) 1 else -1
                    if (hareket.uzamsal) {
                        (fadeIn(hareket.solma()) + slideInHorizontally(hareket.yay()) { yonu * 70 }) togetherWith fadeOut(hareket.solma(120))
                    } else {
                        fadeIn(hareket.solma()) togetherWith fadeOut(hareket.solma())
                    }
                },
                label = "ay",
            ) { a ->
                AyIzgarasi(a, bugun, seciliGun, onSec = { secili = it.toEpochDay() })
            }
        }
        val gunun = Ornekler.hepsi.filter { !it.tarihsiz && bugun.plusDays(it.gunFarki.toLong()) == seciliGun }
        Metin(
            goreliTarih(seciliGun, bugun),
            stil = Sahne.yazi.takvimGun,
            modifier = Modifier
                .padding(start = pay.calculateStartPadding(yon) + 2.dp, top = 18.dp, bottom = 10.dp)
                .semantics { heading() },
        )
        if (gunun.isEmpty()) {
            Metin(
                "Bu gün boş. Artıya dokunup bir şey ekle.",
                stil = Sahne.yazi.govde, renk = Sahne.renk.soluk,
                modifier = Modifier.padding(start = pay.calculateStartPadding(yon) + 2.dp, end = pay.calculateEndPadding(yon)),
            )
        } else {
            val genislik = LocalConfiguration.current.screenWidthDp.dp * 0.64f
            LazyRow(
                contentPadding = PaddingValues(start = pay.calculateStartPadding(yon), end = pay.calculateEndPadding(yon)),
                horizontalArrangement = Arrangement.spacedBy(Sahne.olcu.aralik),
            ) {
                items(gunun, key = { it.id }) { k ->
                    // Ayrıntıya paylaşılan öğe bağı Bugün'deki levhada; aynı kayıt iki yerde aynı anahtarla çizilemez.
                    Levha(
                        baslik = k.baslik, altSatir = k.zaman, renk = k.renk, boy = LevhaBoyu.KARE, figur = k.figur,
                        onAc = { onKayit(k.id) }, taslak = k.taslak, bitti = k.bitti,
                        modifier = Modifier.width(genislik),
                    )
                }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

private val IKI_HARF = listOf("Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz")

@Composable
private fun AyIzgarasi(ay: YearMonth, bugun: LocalDate, secili: LocalDate, onSec: (LocalDate) -> Unit) {
    val ilk = ay.atDay(1).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    val son = ay.atEndOfMonth().with(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY))
    val haftalar = ((son.toEpochDay() - ilk.toEpochDay() + 1) / 7).toInt()
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        for (h in 0 until haftalar) {
            Row {
                for (g in 0 until 7) {
                    val gun = ilk.plusDays((h * 7 + g).toLong())
                    GunHucresi(gun, ay, bugun, gun == secili, onSec, Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun GunHucresi(gun: LocalDate, ay: YearMonth, bugun: LocalDate, secili: Boolean, onSec: (LocalDate) -> Unit, modifier: Modifier) {
    val kayitlar = Ornekler.hepsi.filter { !it.tarihsiz && bugun.plusDays(it.gunFarki.toLong()) == gun }
    val disarida = YearMonth.from(gun) != ay
    val renk = Sahne.renk
    val leke = kayitlar.firstOrNull()?.let { Sahne.levha(it.renk) }
    val lekeZemin = leke?.zemin ?: renk.murekkep
    val lekeYazi = leke?.yazi ?: renk.zemin
    val yazi = if (secili) lekeYazi else renk.murekkep
    Box(
        modifier
            .enAzKare(1.08f)
            .selectable(selected = secili, role = Role.Button, onClick = { onSec(gun) })
            .semantics { contentDescription = "${uzunTarih(gun)}, ${kayitlar.size} kayıt" },
        contentAlignment = Alignment.Center,
    ) {
        if (secili) {
            Box(Modifier.fillMaxSize().padding(1.dp).aspectRatio(1f).clip(CircleShape).background(lekeZemin))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val bugunMu = gun == bugun
            Metin(
                gun.dayOfMonth.toString(),
                stil = Sahne.yazi.gunNo.copy(
                    fontWeight = when { bugunMu -> FontWeight.ExtraBold; disarida -> FontWeight.Normal; else -> FontWeight.SemiBold },
                    textDecoration = if (bugunMu) TextDecoration.Underline else null,
                ),
                renk = if (disarida && !secili) renk.soluk else yazi,
                modifier = if (disarida && !secili) Modifier.alpha(0.5f) else Modifier,
                satirSiniri = 1,
            )
            Row(Modifier.height(7.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                for (k in kayitlar.take(3)) {
                    val t = Sahne.levha(k.renk)
                    Canvas(Modifier.size(7.dp)) {
                        drawCircle(if (secili) lekeYazi.copy(alpha = 0.9f) else t.zemin.copy(alpha = if (k.bitti) 0.4f else 1f))
                    }
                }
            }
        }
    }
}

/** Genişliğe göre en az `oran` yükseklik (gün hücresi 1 : 1.08). */
private fun Modifier.enAzKare(oran: Float) = layout { m, c ->
    val w = c.maxWidth
    val h = (w * oran).toInt()
    val p = m.measure(c.copy(minWidth = w, maxWidth = w, minHeight = h, maxHeight = maxOf(h, c.minHeight).coerceAtLeast(h)))
    layout(w, maxOf(h, p.height)) { p.place(0, 0) }
}
