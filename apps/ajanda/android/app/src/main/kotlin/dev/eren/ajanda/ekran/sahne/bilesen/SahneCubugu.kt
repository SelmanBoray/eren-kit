package dev.eren.ajanda.ekran.sahne.bilesen

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.sahne.gezinme.Hedef
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.tema.Simge
import dev.eren.ajanda.ekran.sahne.tema.Simgeler
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Alt çubuk (SAHNE.md §3.5): ekranın altında ortalı, yüzen mürekkep hap. Seçili sekmenin arkasında zemin
 * renginde %16'lık bir leke yayla kayar; sağda vurgu renginde "yeni kayıt" düğmesi.
 *
 * Üç sekme yazılarıyla 360 dp'ye sığmaz: yalnız seçili sekme yazısını gösterir, ötekiler simgedir
 * (seçim değişince yazı yayla açılır). Yazı ölçeği 1.3 ve üstündeyse hiçbir sekme yazı göstermez
 * (SAHNE.md §10.2). TalkBack her sekmeyi adıyla, `Role.Tab` ve seçili durumuyla okur.
 *
 * Konum ve sistem çubuğu payı çağıranın işi (bkz. `SahneKok`).
 */
@Composable
fun SahneCubugu(
    secili: Hedef.Sekme,
    onSekme: (Hedef.Sekme) -> Unit,
    onYeni: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val renk = Sahne.renk
    val hareket = Sahne.hareket
    val yaziYok = LocalDensity.current.fontScale >= 1.3f
    // Sekmelerin çubuk içindeki yeri (px): leke bunlara kayar.
    val yerler = remember { mutableStateMapOf<Hedef.Sekme, Pair<Int, Int>>() }
    val lekeX = remember { Animatable(0f) }
    val lekeG = remember { Animatable(0f) }
    val hedefYer = yerler[secili]
    LaunchedEffect(hedefYer) {
        val (x, g) = hedefYer ?: return@LaunchedEffect
        if (lekeG.value == 0f) {
            lekeX.snapTo(x.toFloat()); lekeG.snapTo(g.toFloat())
        } else {
            launch { lekeX.animateTo(x.toFloat(), hareket.yay()) }
            launch { lekeG.animateTo(g.toFloat(), hareket.yay()) }
        }
    }
    Box(
        modifier
            .clip(Sahne.olcu.hap)
            .background(renk.murekkep)
            .padding(6.dp),
    ) {
        if (lekeG.value > 0f) {
            val d = LocalDensity.current
            Box(
                Modifier
                    .offset { IntOffset(lekeX.value.roundToInt(), 0) }
                    .width(with(d) { lekeG.value.toDp() })
                    .height(48.dp)
                    .clip(Sahne.olcu.hap)
                    .background(renk.zemin.copy(alpha = 0.16f)),
            )
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Genişlik sınırlıyken önce "+" ve seçili olmayan sekmeler ölçülür (her biri en az 48 dp); seçili
            // sekmenin yazısı kalan yere sığarsa görünür, sığmazsa yalnız simge kalır. Hiçbir dokunma hedefi 48 dp'nin altına inmez.
            Row(Modifier.selectableGroup().weight(1f, fill = false), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (s in Hedef.Sekme.entries) {
                    val sec = s == secili
                    Row(
                        Modifier
                            .then(if (sec) Modifier.weight(1f, fill = false) else Modifier)
                            .height(48.dp)
                            .widthIn(min = 48.dp)
                            .onPlaced { yerler[s] = it.positionInParent().x.roundToInt() to it.size.width }
                            .clip(Sahne.olcu.hap)
                            .selectable(selected = sec, role = Role.Tab, onClick = { onSekme(s) })
                            .semantics { contentDescription = s.ad }
                            .animateContentSize(hareket.yay())
                            .padding(horizontal = if (sec && !yaziYok) 18.dp else 14.dp)
                            .alpha(if (sec) 1f else 0.72f),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        // Yazı sığarsa tam görünür, sığmazsa hiç görünmez (yarım "Tari…" yerine yalnız simge).
                        Layout(
                            content = {
                                Simge(s.simge(), aciklama = null, modifier = Modifier.requiredSize(20.dp), renk = renk.zemin)
                                if (sec && !yaziYok) {
                                    Metin(
                                        s.ad,
                                        stil = Sahne.yazi.etiket.copy(fontWeight = FontWeight.SemiBold),
                                        renk = renk.zemin,
                                        satirSiniri = 1,
                                        modifier = Modifier.clearAndSetSemantics {},
                                    )
                                }
                            },
                        ) { olculer, c ->
                            val ikon = olculer[0].measure(Constraints())
                            val yazi = olculer.getOrNull(1)?.measure(Constraints(maxHeight = c.maxHeight))
                            val bosluk = 8.dp.roundToPx()
                            val sigar = yazi != null && ikon.width + bosluk + yazi.width <= c.maxWidth
                            val g = if (sigar) ikon.width + bosluk + yazi!!.width else ikon.width
                            val y = maxOf(ikon.height, if (sigar) yazi!!.height else 0)
                            layout(g, y) {
                                ikon.place(0, (y - ikon.height) / 2)
                                if (sigar) yazi!!.place(ikon.width + bosluk, (y - yazi.height) / 2)
                            }
                        }
                    }
                }
            }
            Box(
                Modifier
                    .requiredSize(width = 56.dp, height = 48.dp)
                    .clip(Sahne.olcu.hap)
                    .background(renk.vurgu)
                    // SAHNE.md §10.1: koyu temada vurgu ile açık mürekkep arasında ayrım zayıf; zemin renginde halka.
                    .then(if (renk.koyu) Modifier.border(2.dp, renk.zemin, Sahne.olcu.hap) else Modifier)
                    .clickable(role = Role.Button, onClick = onYeni)
                    .semantics { contentDescription = "Yeni kayıt" },
                contentAlignment = Alignment.Center,
            ) {
                Simge(Simgeler.Arti, aciklama = null, modifier = Modifier.size(24.dp), renk = renk.vurguUstu)
            }
        }
    }
}

fun Hedef.Sekme.simge() = when (this) {
    Hedef.Sekme.BUGUN -> Simgeler.Gun
    Hedef.Sekme.TAKVIM -> Simgeler.Takvim
    Hedef.Sekme.TARIHSIZ -> Simgeler.Tarihsiz
}
