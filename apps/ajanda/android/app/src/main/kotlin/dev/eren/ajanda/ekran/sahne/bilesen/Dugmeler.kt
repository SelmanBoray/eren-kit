package dev.eren.ajanda.ekran.sahne.bilesen

import androidx.compose.ui.semantics.heading
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.sahne.tema.Agirlik
import dev.eren.ajanda.ekran.sahne.tema.LocalSahneMetinStili
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.tema.Simge

/**
 * Yuvarlak simge düğmesi (kapat, ay değiştir, ayarlar). [aciklama] TalkBack'in okuduğu ad, zorunlu.
 *
 * [boyut] görünür dairedir (SAHNE.md §3.7, §3.8: 46 dp). Dokunma alanı dairenin çevresindeki kutudur ve en az
 * 48 dp ([HapDugme]'deki iç/dış ayrımı gibi): tıklama dış kutuda olduğu için Compose'un küçük öğe
 * genişletmesine güvenilmez (altta dokunma alan bir kardeş varsa genişletme ona kaybeder). Dış kutu görünür
 * daireden her yana 1 dp taşar; [modifier]'daki konum payı dış kutuya uygulanır.
 */
@Composable
fun YuvarlakDugme(
    simge: ImageVector,
    aciklama: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    zemin: Color = Sahne.renk.yuz,
    renk: Color = Sahne.renk.murekkep,
    cerceve: Boolean = false,
    boyut: Dp = YUVARLAK_DUGME_GORUNUR,
) {
    val alan = if (boyut > Sahne.olcu.dokunma) boyut else Sahne.olcu.dokunma
    Box(
        modifier
            .size(alan)
            .clip(CircleShape)
            .clickable(role = Role.Button, onClickLabel = null, onClick = onClick)
            .semantics { contentDescription = aciklama },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(boyut)
                .clip(CircleShape)
                .background(zemin)
                .then(if (cerceve) Modifier.border(2.dp, renk, CircleShape) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            Simge(simge, aciklama = null, modifier = Modifier.size(22.dp), renk = renk)
        }
    }
}

/** Yuvarlak düğmenin görünür boyu (prototipte 46 dp); dokunma alanı [Sahne.olcu] `dokunma` (48 dp). */
val YUVARLAK_DUGME_GORUNUR: Dp = 46.dp

/**
 * Hap biçimli yazılı düğme. [dolu]: mürekkep zemin; değilse içinde bulunduğu yüzeyin yazı rengiyle 2 dp
 * çerçeve. [onayDugmesi]: taslaktaki "Onayla / Vazgeç" (SAHNE.md §3.3): görünür boy 40 dp, yazı 650.
 * Dokunma alanı her durumda en az 48 dp.
 */
@Composable
fun HapDugme(
    yazi: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    dolu: Boolean = true,
    onayDugmesi: Boolean = false,
    zemin: Color = Sahne.renk.murekkep,
    renk: Color = Sahne.renk.zemin,
) {
    val cizgi = if (dolu) zemin else LocalSahneMetinStili.current.color
    val boy = if (onayDugmesi) 40.dp else Sahne.olcu.dokunma
    Box(
        modifier
            .heightIn(min = Sahne.olcu.dokunma)
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .heightIn(min = boy)
                .clip(Sahne.olcu.hap)
                .then(if (dolu) Modifier.background(zemin) else Modifier.border(2.dp, cizgi, Sahne.olcu.hap))
                .padding(horizontal = if (onayDugmesi) 16.dp else 20.dp, vertical = 8.dp)
                .defaultMinSize(minWidth = 48.dp),
            contentAlignment = Alignment.Center,
        ) {
            Metin(
                yazi,
                stil = Sahne.yazi.etiket.copy(fontWeight = if (onayDugmesi) Agirlik.Kalin650 else FontWeight.SemiBold),
                renk = if (dolu) renk else cizgi,
            )
        }
    }
}

/**
 * Tamamla düğmesi: çerçeveli daire; dokununca dolar, tik çizilerek gelir (yayla hafif büyüyüp oturur).
 * Rengi içinde bulunduğu yüzeyin yazı rengidir; tik [oyukRengi] ile çizilir (levhada levha zemini).
 * TalkBack: "Tamamla: <başlık>", durum "tamamlandı / açık".
 */
@Composable
fun TamamlaDugmesi(
    tamam: Boolean,
    baslik: String,
    onDegis: (Boolean) -> Unit,
    oyukRengi: Color,
    modifier: Modifier = Modifier,
    boyut: Dp = 46.dp,
    renk: Color = LocalSahneMetinStili.current.color,
) {
    val hareket = Sahne.hareket
    // Hareket azaltılmışsa tik dolu ve çizili hâlde belirir (SAHNE.md §6, 5.2 satırı): solma da yok.
    val dolum by animateFloatAsState(if (tamam) 1f else 0f, if (hareket.azalt) snap() else hareket.solma(200), label = "dolum")
    val cizim by animateFloatAsState(if (tamam) 1f else 0f, hareket.oturma(), label = "tik")
    // Tamamlanınca daire 0.6'dan yayla büyüyerek oturur (SAHNE.md §5.2); geri alınca olduğu yerde kalır.
    val olcek = remember { androidx.compose.animation.core.Animatable(1f) }
    val ilkCizim = remember { booleanArrayOf(true) }
    androidx.compose.runtime.LaunchedEffect(tamam) {
        val ilk = ilkCizim[0]
        ilkCizim[0] = false
        if (!ilk && tamam && hareket.uzamsal) {
            olcek.snapTo(0.6f)
            olcek.animateTo(1f, hareket.yay())
        }
    }
    val tikYolu = remember { Path() }
    val parca = remember { Path() }
    val olcer = remember { PathMeasure() }
    Box(
        modifier
            .size(maxOf(boyut, Sahne.olcu.dokunma))
            .toggleable(value = tamam, role = Role.Checkbox, onValueChange = onDegis)
            .semantics {
                contentDescription = "Tamamla: $baslik"
                stateDescription = if (tamam) "tamamlandı" else "açık"
            },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(boyut)) {
            scale(olcek.value) {
                val k = 2.dp.toPx()
                drawCircle(renk.copy(alpha = dolum), radius = size.minDimension / 2f)
                drawCircle(renk, radius = size.minDimension / 2f - k / 2f, style = Stroke(k))
                if (cizim > 0f) {
                    val s = size.minDimension / 24f
                    tikYolu.reset()
                    tikYolu.moveTo(7f * s, 12.5f * s)
                    tikYolu.lineTo(10.7f * s, 16.2f * s)
                    tikYolu.lineTo(17.2f * s, 8.2f * s)
                    olcer.setPath(tikYolu, false)
                    parca.reset()
                    olcer.getSegment(0f, olcer.length * cizim, parca, true)
                    drawPath(parca, oyukRengi, style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                }
            }
        }
    }
}

/** Küçük ara başlık ("Bitenler", "Tarihi olmayanlar"). */
@Composable
fun AraBaslik(yazi: String, modifier: Modifier = Modifier) {
    Metin(
        yazi,
        stil = Sahne.yazi.etiket.copy(fontWeight = FontWeight.SemiBold),
        renk = Sahne.renk.soluk,
        modifier = modifier
            .padding(start = 2.dp, top = Sahne.olcu.bolumAraligi, bottom = 10.dp)
            .semantics { heading() },
    )
}
