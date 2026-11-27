package dev.eren.ajanda.ekran.sahne.bilesen

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.offset
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.tema.Simge
import dev.eren.ajanda.ekran.sahne.tema.Simgeler
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Sağa çekerek tamamlama (SAHNE.md §8.3, Tabela'dan): içerik parmakla 0–150 dp sağa kayar; arkada [zemin]
 * üstünde solda tik ve "Bitti" (tamamlanmışsa "Geri al"). 84 dp'yi geçip ya da 800 dp/s'den hızlı
 * bırakılırsa [onTamamla] çağrılır. İçerik her durumda yayla yerine döner. Eşik geçildiği anda bir kez
 * hafif titreşim. Dikey kaydırmayla çakışmaz: yatay eşik aşılmadan sürükleme başlamaz.
 *
 * Parmağı doğrudan izlediği için "hareketi azalt"ta da çalışır (§6); yalnız bırakınca dönüş anlıktır.
 * Erişilebilirlik: tek yol değildir; daire ve özel eylem aynı işi yapar (§10.3). [etkin] yanlışsa düz içerik.
 */
@Composable
fun SagaCek(
    etkin: Boolean,
    tamam: Boolean,
    zemin: Color,
    yazi: Color,
    sekil: Shape,
    onTamamla: () -> Unit,
    modifier: Modifier = Modifier,
    icerik: @Composable () -> Unit,
) {
    if (!etkin) {
        Box(modifier) { icerik() }
        return
    }
    val hareket = Sahne.hareket
    val d = LocalDensity.current
    val enCok = with(d) { 150.dp.toPx() }
    val esik = with(d) { 84.dp.toPx() }
    val hizEsigi = with(d) { 800.dp.toPx() }
    val kayma = remember { Animatable(0f) }
    val kapsam = rememberCoroutineScope()
    val titresim = LocalHapticFeedback.current
    val guncelTamamla = rememberUpdatedState(onTamamla)
    // Sürükleme dış kutuda dinlenir (kaymayan koordinatlar: hız doğru ölçülür), içerik kayar.
    Box(
        modifier
            .pointerInput(Unit) {
                val izci = VelocityTracker()
                var gecti = false
                // Konum burada eşzamanlı tutulur; Animatable'a yazmak eşyordamla, bir kare geriden gelir.
                var konum = 0f
                detectHorizontalDragGestures(
                    onDragStart = { izci.resetTracking(); gecti = false; konum = kayma.value },
                    onDragEnd = {
                        val hiz = izci.calculateVelocity().x
                        val tetik = konum > esik || hiz > hizEsigi
                        konum = 0f
                        kapsam.launch { kayma.animateTo(0f, hareket.yayHizli()) }
                        if (tetik) guncelTamamla.value()
                    },
                    onDragCancel = { konum = 0f; kapsam.launch { kayma.animateTo(0f, hareket.yayHizli()) } },
                ) { degisim, miktar ->
                    izci.addPosition(degisim.uptimeMillis, degisim.position)
                    val yeni = (konum + miktar).coerceIn(0f, enCok)
                    konum = yeni
                    if (!gecti && yeni > esik) {
                        gecti = true
                        titresim.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
                    } else if (gecti && yeni < esik) {
                        gecti = false
                    }
                    degisim.consume()
                    kapsam.launch { kayma.snapTo(yeni) }
                }
            },
    ) {
        if (kayma.value > 0.5f) {
            Box(
                Modifier
                    .matchParentSize()
                    .clip(sekil)
                    .background(zemin)
                    .clearAndSetSemantics {},
                contentAlignment = Alignment.CenterStart,
            ) {
                Row(
                    Modifier
                        .padding(start = 18.dp)
                        .graphicsLayer { alpha = (kayma.value / esik).coerceIn(0f, 1f) },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Simge(Simgeler.Tik, aciklama = null, modifier = Modifier.size(22.dp), renk = yazi)
                    Metin(if (tamam) "Geri al" else "Bitti", stil = Sahne.yazi.etiket.copy(fontWeight = FontWeight.Bold), renk = yazi, satirSiniri = 1)
                }
            }
        }
        Box(
            Modifier
                .offset { IntOffset(kayma.value.roundToInt(), 0) },
        ) { icerik() }
    }
}
