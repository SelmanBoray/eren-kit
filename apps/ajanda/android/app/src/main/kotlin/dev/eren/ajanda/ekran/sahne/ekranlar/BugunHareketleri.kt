package dev.eren.ajanda.ekran.sahne.ekranlar

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import dev.eren.ajanda.ekran.sahne.bilesen.Boyama
import dev.eren.ajanda.ekran.sahne.cizim.KOPUK_PATLAMA_MS
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import dev.eren.ajanda.ekran.sahne.veri.BugunKaydi
import dev.eren.ajanda.ekran.sahne.veri.KayitIslemleri
import dev.eren.ajanda.ekran.sahne.veri.LevhaHali
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Bir kaydın sürmekte olan hareketi. */
enum class Surec { TAMAMLANIYOR, ONAYLANIYOR, VAZGECILIYOR }

/**
 * Kayıt ekranlarının (Bugün, Takvim, Tarihsizler) durum değiştiren hareketleri (SAHNE.md §5.2, §5.4, §5.5).
 *
 * **Eylem harekete bağlı değildir.** Çekirdek çağrısı dokunuş anında gider; hareket yalnız görüntüdür. Ekran
 * arka plana geçince Compose kare saatini durdurur ve hareket askıda kalır: eylem hareketin sonunu bekleseydi
 * telefonu kilitleyen kullanıcının tamamladığı iş çekirdekte açık kalır, süreç ölünce de kaybolurdu. Hareket
 * sürerken ekran, hareketin başladığı andaki modeli gösterir ([dondur]); yeni model (iş Bitenler'e indi, öneri
 * boyandı, taslak silindi) hareket de çekirdek de bitince gelir. O arada kayıt dokunmaya kapalıdır ([surec]).
 * "Hareketi azalt"ta ([SahneHareket.azalt]) hareket yoktur; model çekirdek bitince gelir (§6). İşlem yapan depo
 * yoksa (vitrin) hareket oynar, veri değişmez.
 *
 * Durum anahtarı kaydın [BugunKaydi.anahtar]'ıdır; değerler Compose durumu (çizim okur).
 *
 * Ekranda depo başına tek nesne yaşar ([rememberBugunHareketleri]); hareket ayarı ve titreşim değişince
 * yalnız bu alanlar güncellenir. Ayar değişince yeni nesne kurulsaydı kilitler ([surec]) boşalır ve aynı levhaya
 * ikinci dokunuş çift tamamlama ya da çift onay olurdu.
 */
@Stable
class BugunHareketleri internal constructor(
    private val kapsam: CoroutineScope,
    hareket: SahneHareket,
    private val depo: KayitIslemleri?,
    titresim: HapticFeedback,
) {
    /** "Hareketi azalt" ayarı; her işlemin başında okunur (süren hareket kendi kararıyla biter). */
    internal var hareket: SahneHareket = hareket

    internal var titresim: HapticFeedback = titresim

    /** Sürmekte olan süreçler (kilit). */
    val surec = mutableStateMapOf<String, Surec>()

    /** Tamamlama: yıkama bandının ilerlemesi. */
    val yikama = mutableStateMapOf<String, Float>()

    /** Tamamlama: çizimdeki köpüklerin patlaması (0..1, [KOPUK_PATLAMA_MS]; bantla aynı anda başlar). */
    val patlama = mutableStateMapOf<String, Float>()

    /** Onay: boyama ve düğmelerin saydamlığı. */
    val boyama = mutableStateMapOf<String, Boyama>()
    val dugmeAlfa = mutableStateMapOf<String, Float>()

    /** Vazgeç: çıkış ilerlemesi (0..1: söner, küçülür, döner). */
    val cikis = mutableStateMapOf<String, Float>()

    /** Bitmemiş işlem sayısı (hareketi ya da çekirdek çağrısı sürüyor); sıfırdan büyükken ekran [donuk]'u gösterir. */
    private var acikIs by mutableIntStateOf(0)
    private var donuk: Any? by mutableStateOf(null)

    /** Ekranın en son gösterdiği model (yalnız ana iş parçacığında; çizimi tetiklemez). */
    private var sonGosterilen: Any? = null

    /**
     * Ekranın göstereceği model: bir işlemin hareketi ya da çekirdek çağrısı sürüyorsa işlemin başladığı andaki
     * model, değilse [canli]. Ekran her çizimde çağırır.
     */
    @Suppress("UNCHECKED_CAST")
    fun <M : Any> dondur(canli: M): M {
        val m = if (acikIs > 0) (donuk as? M ?: canli) else canli
        sonGosterilen = m
        return m
    }

    /** Bir işlem sürüyor (hareketi ya da çekirdek çağrısı bitmedi). */
    val suruyor: Boolean get() = acikIs > 0

    fun kilitli(anahtar: String) = anahtar in surec

    /** Daire dolu görünsün mü (tamamlama hareketi sürerken ekrandaki model henüz eski). */
    fun tamamGorunsun(k: BugunKaydi): Boolean = when (surec[k.anahtar]) {
        Surec.TAMAMLANIYOR -> k.hal != LevhaHali.BITTI
        else -> k.hal == LevhaHali.BITTI
    }

    private fun bitir(anahtar: String) {
        surec.remove(anahtar)
        yikama.remove(anahtar)
        patlama.remove(anahtar)
        boyama.remove(anahtar)
        dugmeAlfa.remove(anahtar)
        cikis.remove(anahtar)
    }

    /**
     * Tamamlar ya da yeniden açar; çekirdeğe hemen gider. [levha]: büyük/kare levhada yıkama bandı geçer ve
     * köpüklü çizimde köpükler aynı anda patlar; ekran 720 ms sonra yeni modele geçer. Satır ve kartlarda bant
     * ve köpük yok, 300 ms (§5.2). Hareket azaltılmışsa bant yok, köpük patlaması anında son hâlinde (§6).
     * Tamamlanamayan kayıtta (not; hangi günü olduğu belli olmayan tekrar) hiçbir şey yapmaz.
     */
    fun tamamla(k: BugunKaydi, tamam: Boolean = k.hal != LevhaHali.BITTI, levha: Boolean = false) {
        if (kilitli(k.anahtar) || !k.tamamlanabilir) return
        if (tamam) titresim.performHapticFeedback(HapticFeedbackType.Confirm)
        surec[k.anahtar] = Surec.TAMAMLANIYOR
        val gorunus: (suspend CoroutineScope.() -> Unit)? = when {
            !tamam -> null
            hareket.azalt -> {
                if (levha) patlama[k.anahtar] = 1f
                null
            }
            levha -> {
                {
                    launch {
                        Animatable(0f).animateTo(1f, tween(700, easing = BANT)) { yikama[k.anahtar] = value }
                    }
                    launch {
                        Animatable(0f).animateTo(1f, tween(KOPUK_PATLAMA_MS, easing = SahneHareket.YUMUSAK)) { patlama[k.anahtar] = value }
                    }
                    delay(720)
                }
            }
            else -> {
                { delay(300) }
            }
        }
        yurut(listOf(k.anahtar), { depo?.tamamla(k, tamam, it) }, gorunus)
    }

    /**
     * Bir kez oynayan imza (§5.15) bu gösterimde oynasın mı: gün içinde bir kez (depo sayar). Depo yoksa
     * (vitrin) her gösterimde.
     */
    fun imzaOynasin(k: BugunKaydi): Boolean = depo?.imzaOynasin(k.anahtar) ?: true

    /** Taslağı onaylar: çekirdeğe hemen; ekran karakalemden boyamaya geçer (§5.4, 900 ms). */
    fun onayla(kayitlar: List<BugunKaydi>) {
        val bos = kayitlar.filterNot { kilitli(it.anahtar) }
        if (bos.isEmpty()) return
        titresim.performHapticFeedback(HapticFeedbackType.Confirm)
        bos.forEach { surec[it.anahtar] = Surec.ONAYLANIYOR }
        val idler = bos.map { it.kayitId }
        val cagir: (() -> Unit) -> Unit = { son -> if (idler.size == 1) depo?.onayla(idler.first(), son) else depo?.hepsiniOnayla(idler, son) }
        if (hareket.azalt) {
            bos.forEach { boyama[it.anahtar] = Boyama.BOYALI; dugmeAlfa[it.anahtar] = 0f }
            yurut(bos.map { it.anahtar }, cagir, null)
            return
        }
        yurut(bos.map { it.anahtar }, cagir) {
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

    /** Öneriden vazgeç (§5.5): çekirdeğe hemen; levha 260 ms'de söner, küçülür, döner. */
    fun vazgec(k: BugunKaydi) {
        if (kilitli(k.anahtar)) return
        surec[k.anahtar] = Surec.VAZGECILIYOR
        if (hareket.azalt) {
            cikis[k.anahtar] = 1f
            yurut(listOf(k.anahtar), { depo?.vazgec(k.kayitId, it) }, null)
            return
        }
        yurut(listOf(k.anahtar), { depo?.vazgec(k.kayitId, it) }) {
            Animatable(0f).animateTo(1f, tween(260, easing = FastOutLinearInEasing)) { cikis[k.anahtar] = value }
        }
    }

    /**
     * İşlemi yürütür: çekirdek çağrısı ([cagri]) **hemen**, [gorunus] (varsa) aynı anda. İkisi de bitince kilit
     * açılır, hareketin ara değerleri silinir ve (başka işlem sürmüyorsa) ekran canlı modele döner. Ekran o
     * arada bestecilikten çıkarsa hareket kesilir (`finally`); çekirdek çağrısı zaten gitmiştir.
     */
    private fun yurut(anahtarlar: List<String>, cagri: (() -> Unit) -> Unit, gorunus: (suspend CoroutineScope.() -> Unit)?) {
        if (acikIs == 0) donuk = sonGosterilen
        acikIs++
        var kalan = 2
        val parcaBitti = {
            kalan--
            if (kalan == 0) {
                anahtarlar.forEach(::bitir)
                acikIs--
                if (acikIs == 0) donuk = null
            }
        }
        if (depo == null) {
            // Vitrin: veri yok; hareketin son hâli bir an görünür, sonra eski hâline döner.
            kapsam.launch {
                try {
                    delay(if (hareket.azalt) 0L else 400L)
                } finally {
                    parcaBitti()
                }
            }
        } else {
            cagri { parcaBitti() }
        }
        if (gorunus == null) {
            parcaBitti()
        } else {
            kapsam.launch {
                try {
                    coroutineScope { gorunus() }
                } finally {
                    parcaBitti()
                }
            }
        }
    }

    companion object {
        /** Yıkama bandının eğrisi: `cubic-bezier(.4,0,.2,1)`. */
        val BANT = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)
    }
}

@Composable
fun rememberBugunHareketleri(depo: KayitIslemleri?): BugunHareketleri {
    val kapsam = rememberCoroutineScope()
    val hareket = Sahne.hareket
    val titresim = LocalHapticFeedback.current
    val h = remember(depo) { BugunHareketleri(kapsam, hareket, depo, titresim) }
    SideEffect {
        h.hareket = hareket
        h.titresim = titresim
    }
    return h
}
