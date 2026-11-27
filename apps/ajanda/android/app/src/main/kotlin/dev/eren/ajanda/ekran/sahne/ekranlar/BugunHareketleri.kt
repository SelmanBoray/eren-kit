package dev.eren.ajanda.ekran.sahne.ekranlar

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import dev.eren.ajanda.ekran.sahne.bilesen.Boyama
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import dev.eren.ajanda.ekran.sahne.veri.BugunDeposu
import dev.eren.ajanda.ekran.sahne.veri.BugunKaydi
import dev.eren.ajanda.ekran.sahne.veri.LevhaHali
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Bir kaydın sürmekte olan hareketi. */
enum class Surec { TAMAMLANIYOR, ONAYLANIYOR, VAZGECILIYOR }

/**
 * Bugün ekranının durum değiştiren hareketleri (SAHNE.md §5.2, §5.4, §5.5): hareket oynar, sonra çekirdeğe
 * gidilir; o arada kayıt dokunmaya kapalıdır. "Hareketi azalt"ta ([SahneHareket.azalt]) hiçbir bekleme yoktur:
 * çekirdeğe hemen gidilir, levha son hâline hemen geçer (§6). Depo yoksa (vitrin) hareket oynar, veri değişmez.
 *
 * Durum anahtarı kaydın [BugunKaydi.anahtar]'ıdır; değerler Compose durumu (çizim okur).
 */
@Stable
class BugunHareketleri internal constructor(
    private val kapsam: CoroutineScope,
    private val hareket: SahneHareket,
    private val depo: BugunDeposu?,
    private val titresim: HapticFeedback,
) {
    /** Sürmekte olan süreçler (kilit). */
    val surec = mutableStateMapOf<String, Surec>()

    /** Tamamlama: yıkama bandının ilerlemesi. */
    val yikama = mutableStateMapOf<String, Float>()

    /** Onay: boyama ve düğmelerin saydamlığı. */
    val boyama = mutableStateMapOf<String, Boyama>()
    val dugmeAlfa = mutableStateMapOf<String, Float>()

    /** Vazgeç: çıkış ilerlemesi (0..1: söner, küçülür, döner). */
    val cikis = mutableStateMapOf<String, Float>()

    fun kilitli(anahtar: String) = anahtar in surec

    /** Daire dolu görünsün mü (tamamlama hareketi sürerken model henüz değişmedi). */
    fun tamamGorunsun(k: BugunKaydi): Boolean = when (surec[k.anahtar]) {
        Surec.TAMAMLANIYOR -> k.hal != LevhaHali.BITTI
        else -> k.hal == LevhaHali.BITTI
    }

    private fun bitir(anahtar: String) {
        surec.remove(anahtar)
        yikama.remove(anahtar)
        boyama.remove(anahtar)
        dugmeAlfa.remove(anahtar)
        cikis.remove(anahtar)
    }

    /**
     * Tamamlar ya da yeniden açar. [levha]: büyük/kare levhada yıkama bandı geçer ve 720 ms sonra kayıt
     * biter; satır ve kartlarda bant yok, 300 ms sonra (§5.2).
     */
    fun tamamla(k: BugunKaydi, tamam: Boolean = k.hal != LevhaHali.BITTI, levha: Boolean = false) {
        if (kilitli(k.anahtar)) return
        if (tamam) titresim.performHapticFeedback(HapticFeedbackType.Confirm)
        if (!tamam || hareket.azalt) {
            surec[k.anahtar] = Surec.TAMAMLANIYOR
            git(k.anahtar) { depo?.tamamla(k, tamam, it) }
            return
        }
        surec[k.anahtar] = Surec.TAMAMLANIYOR
        sonra(listOf(k.anahtar), { depo?.tamamla(k, true, it) }) {
            if (levha) {
                launch {
                    val a = Animatable(0f)
                    a.animateTo(1f, tween(700, easing = BANT)) { yikama[k.anahtar] = value }
                }
                delay(720)
            } else {
                delay(300)
            }
        }
    }

    /** Taslağı onaylar: karakalemden boyamaya (§5.4), 900 ms sonra çekirdeğe. */
    fun onayla(kayitlar: List<BugunKaydi>) {
        val bos = kayitlar.filterNot { kilitli(it.anahtar) }
        if (bos.isEmpty()) return
        titresim.performHapticFeedback(HapticFeedbackType.Confirm)
        bos.forEach { surec[it.anahtar] = Surec.ONAYLANIYOR }
        val idler = bos.map { it.kayitId }
        val cagir: (() -> Unit) -> Unit = { son -> if (idler.size == 1) depo?.onayla(idler.first(), son) else depo?.hepsiniOnayla(idler, son) }
        if (hareket.azalt) {
            bos.forEach { boyama[it.anahtar] = Boyama.BOYALI; dugmeAlfa[it.anahtar] = 0f }
            git(bos.map { it.anahtar }, cagir)
            return
        }
        sonra(bos.map { it.anahtar }, cagir) {
            for (k in bos) {
                val a = k.anahtar
                boyama[a] = Boyama.KARAKALEM
                launch { Animatable(1f).animateTo(0f, tween(200)) { dugmeAlfa[a] = value } }
                launch { Animatable(0f).animateTo(1f, tween(800, easing = SahneHareket.ACILIS)) { boyama[a] = (boyama[a] ?: Boyama.KARAKALEM).copy(daire = value) } }
                launch { Animatable(0f).animateTo(1f, tween(400, easing = LinearEasing)) { boyama[a] = (boyama[a] ?: Boyama.KARAKALEM).copy(yazi = value) } }
                launch { Animatable(0f).animateTo(1f, tween(600, delayMillis = 150)) { boyama[a] = (boyama[a] ?: Boyama.KARAKALEM).copy(cizim = value) } }
            }
            delay(900)
        }
    }

    /** Öneriden vazgeç (§5.5): levha 260 ms'de söner, küçülür, döner; sonra silinir. */
    fun vazgec(k: BugunKaydi) {
        if (kilitli(k.anahtar)) return
        surec[k.anahtar] = Surec.VAZGECILIYOR
        if (hareket.azalt) {
            cikis[k.anahtar] = 1f
            git(k.anahtar) { depo?.vazgec(k.kayitId, it) }
            return
        }
        sonra(listOf(k.anahtar), { depo?.vazgec(k.kayitId, it) }) {
            Animatable(0f).animateTo(1f, tween(260, easing = FastOutLinearInEasing)) { cikis[k.anahtar] = value }
        }
    }

    /**
     * [hareketi] oynatır, sonra çekirdeğe gider. Ekran o arada bestecilikten çıkarsa (sekme değişti) hareket
     * kesilir ama işlem yine yapılır: kullanıcının dokunuşu kaybolmaz.
     */
    private fun sonra(anahtarlar: List<String>, cagri: (() -> Unit) -> Unit, hareketi: suspend CoroutineScope.() -> Unit) {
        kapsam.launch {
            var gitti = false
            try {
                coroutineScope { hareketi() }
                gitti = true
                git(anahtarlar, cagri)
            } finally {
                if (!gitti) git(anahtarlar, cagri)
            }
        }
    }

    private fun git(anahtar: String, cagri: (() -> Unit) -> Unit) = git(listOf(anahtar), cagri)

    private fun git(anahtarlar: List<String>, cagri: (() -> Unit) -> Unit) {
        val son = { anahtarlar.forEach(::bitir) }
        if (depo == null) {
            // Vitrin: veri yok; hareketin son hâli bir an görünür, sonra eski hâline döner.
            kapsam.launch {
                delay(if (hareket.azalt) 0L else 400L)
                son()
            }
        } else {
            cagri(son)
        }
    }

    companion object {
        /** Yıkama bandının eğrisi: `cubic-bezier(.4,0,.2,1)`. */
        val BANT = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)
    }
}

@Composable
fun rememberBugunHareketleri(depo: BugunDeposu?): BugunHareketleri {
    val kapsam = rememberCoroutineScope()
    val hareket = Sahne.hareket
    val titresim = LocalHapticFeedback.current
    return remember(depo, hareket) { BugunHareketleri(kapsam, hareket, depo, titresim) }
}
