package dev.eren.ajanda.ekran.sahne.bilesen

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.AccessibilityManager
import androidx.compose.ui.platform.LocalAccessibilityManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Tostun içeriği. [no] her gösterimde farklı: aynı metin art arda gelse de süre yeniden başlar.
 * [sure]: ekranda kalacağı ms; `null` ise [TostDurumu.sure]. [onKalan]: kalan süre azaldıkça (en çok
 * [TostDurumu.ADIM_MS]'de bir) çağrılır; ekran yeniden kurulunca tost kaldığı yerden sürsün diye.
 */
@Immutable
data class TostIcerigi(
    val no: Long,
    val mesaj: String,
    val eylem: String?,
    val onEylem: () -> Unit,
    val hata: Boolean = false,
    val sure: Long? = null,
    val onKalan: (Long) -> Unit = {},
)

/**
 * Tost durumu (SAHNE.md §5.13): aynı anda bir tost; yenisi eskisinin yerini alır.
 * Eylemli tost 4200 ms, eylemsiz 2200 ms kalır; TalkBack açıkken sistemin önerdiği süre kadar.
 */
@Stable
class TostDurumu {
    var gorunen: TostIcerigi? by mutableStateOf(null)
        private set
    private var sayac = 0L

    fun goster(
        mesaj: String,
        eylem: String? = null,
        hata: Boolean = false,
        sure: Long? = null,
        onKalan: (Long) -> Unit = {},
        onEylem: () -> Unit = {},
    ) {
        gorunen = TostIcerigi(++sayac, mesaj, eylem, onEylem, hata, sure, onKalan)
    }

    /**
     * Tostun eylemi ("Geri al"): yalnız [no]'lu tost hâlâ görünüyorsa ve bir kez. Tost hemen kapanır; sönerken
     * (200 ms) ya da aynı karede gelen ikinci dokunuş bir şey yapmaz.
     */
    fun eylem(no: Long) {
        val t = gorunen ?: return
        if (t.no != no) return
        gorunen = null
        t.onEylem()
    }

    fun kapat(no: Long? = null) {
        if (no == null || gorunen?.no == no) gorunen = null
    }

    companion object {
        const val EYLEMLI_MS = 4200L
        const val EYLEMSIZ_MS = 2200L

        /** Kalan sürenin bildirildiği adım. */
        const val ADIM_MS = 100L

        /** Tostun süresi: eylemliyse 4200, değilse 2200 ms; TalkBack açıksa sistemin önerdiği süre (§5.13). */
        fun sure(eylemli: Boolean, erisim: AccessibilityManager?): Long {
            val sure = if (eylemli) EYLEMLI_MS else EYLEMSIZ_MS
            return erisim?.calculateRecommendedTimeoutMillis(sure, containsIcons = false, containsText = true, containsControls = eylemli) ?: sure
        }
    }
}

/**
 * Tostun çizildiği yer: ortalı, mürekkep zeminli hap; 12 dp aşağıdan ve saydamdan 220 ms'de gelir, 200 ms'de
 * söner (hareket azaltılmışsa anında). Konumu çağıran verir (alt çubuğun üstü). TalkBack: kibar canlı bölge.
 */
@Composable
fun TostAlani(durum: TostDurumu, modifier: Modifier = Modifier) {
    val hareket = Sahne.hareket
    val renk = Sahne.renk
    val erisim = LocalAccessibilityManager.current
    val d = LocalDensity.current
    // Ekranda kalan içerik (sönerken de çizilsin).
    var cizilen by remember { mutableStateOf<TostIcerigi?>(null) }
    val gorunurluk = remember { Animatable(0f) }
    val hedef = durum.gorunen
    LaunchedEffect(hedef) {
        if (hedef != null) {
            cizilen = hedef
            launch { gorunurluk.animateTo(1f, hareket.yumusak(220)) }
            // Süre adım adım sayılır (kare saatiyle aynı zaman): ekran giderse kalan süre bilinir.
            var kalan = hedef.sure ?: TostDurumu.sure(hedef.eylem != null, erisim)
            hedef.onKalan(kalan)
            while (kalan > 0) {
                val adim = minOf(kalan, TostDurumu.ADIM_MS)
                delay(adim)
                kalan -= adim
                hedef.onKalan(kalan)
            }
            durum.kapat(hedef.no)
        } else {
            gorunurluk.animateTo(0f, hareket.yumusak(200))
            cizilen = null
        }
    }
    val t = cizilen ?: return
    // Sönen tost (artık görünen değil) dokunulmaz.
    val etkin = durum.gorunen?.no == t.no
    Box(modifier, contentAlignment = Alignment.Center) {
        Row(
            Modifier
                .graphicsLayer {
                    alpha = gorunurluk.value.coerceIn(0f, 1f)
                    translationY = (1f - gorunurluk.value) * with(d) { 12.dp.toPx() }
                }
                .widthIn(max = 480.dp)
                .heightIn(min = 52.dp)
                .clip(Sahne.olcu.hap)
                .background(renk.murekkep)
                .semantics { liveRegion = LiveRegionMode.Polite }
                .padding(start = 20.dp, end = if (t.eylem != null) 6.dp else 20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Metin(
                t.mesaj,
                stil = Sahne.yazi.etiket,
                renk = renk.zemin,
                satirSiniri = 2,
                modifier = Modifier.weight(1f, fill = false).padding(vertical = 12.dp),
            )
            if (t.eylem != null) {
                Box(
                    Modifier
                        .heightIn(min = 48.dp)
                        .clip(Sahne.olcu.hap)
                        .clickable(enabled = etkin, role = Role.Button) { durum.eylem(t.no) }
                        .padding(horizontal = 14.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Metin(
                        t.eylem, stil = Sahne.yazi.etiket.copy(fontWeight = FontWeight.Bold),
                        // Koyu temada tost açık zeminli: sarı vurgu orada okunmaz (≈1.4:1), koyu yazı kalın.
                    renk = if (renk.koyu) renk.zemin else renk.vurgu, satirSiniri = 1,
                )
                }
            }
        }
    }
}
