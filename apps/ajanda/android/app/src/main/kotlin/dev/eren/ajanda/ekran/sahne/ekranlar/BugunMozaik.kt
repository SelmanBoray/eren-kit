package dev.eren.ajanda.ekran.sahne.ekranlar

import androidx.compose.animation.BoundsTransform
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.animateBounds
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.LookaheadScope
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.sahne.bilesen.Boyama
import dev.eren.ajanda.ekran.sahne.bilesen.HapDugme
import dev.eren.ajanda.ekran.sahne.bilesen.KompaktSatir
import dev.eren.ajanda.ekran.sahne.bilesen.Levha
import dev.eren.ajanda.ekran.sahne.bilesen.LevhaBoyu
import dev.eren.ajanda.ekran.sahne.bilesen.SagaCek
import dev.eren.ajanda.ekran.sahne.bilesen.TamamlaDugmesi
import dev.eren.ajanda.ekran.sahne.bilesen.cizimYuvasiOnbellekli
import dev.eren.ajanda.ekran.sahne.bilesen.kesikCerceve
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.veri.BugunKaydi
import dev.eren.ajanda.ekran.sahne.veri.LevhaHali
import dev.eren.ajanda.ekran.sahne.veri.MozaikBicimi
import dev.eren.ajanda.ekran.sahne.veri.MozaikParcasi
import kotlinx.coroutines.delay
import kotlin.math.max

/** Bir parçanın ekrana girişi. */
internal enum class Giris {
    /** Hareketsiz: yerinde. */
    YOK,

    /** Açılış (§5.1): sırayla, aşağıdan, hafif eğik ve küçük. */
    ACILIS,

    /** Yeniden dizde yeni gelen (§5.3): küçükten, eğik. */
    YENI,
}

/**
 * Giriş hareketi. Karar ilk çizimde verilir ve hatırlanır (sonraki yeniden çizimler hareketi yeniden
 * başlatmaz). Hareket azaltılmışsa hiç oynamaz.
 */
@Composable
internal fun Modifier.giris(giris: Giris, sira: Int): Modifier {
    val hareket = Sahne.hareket
    val karar = remember { if (hareket.uzamsal) giris else Giris.YOK }
    val p = remember { Animatable(if (karar == Giris.YOK) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (karar == Giris.ACILIS) delay(140L + sira * 90L)
        if (p.value < 1f) p.animateTo(1f, hareket.yay())
    }
    val d = LocalDensity.current
    if (karar == Giris.YOK) return this
    return graphicsLayer {
        val v = p.value
        alpha = v.coerceIn(0f, 1f)
        when (karar) {
            Giris.ACILIS -> {
                translationY = (1f - v) * with(d) { 46.dp.toPx() }
                scaleX = 0.88f + 0.12f * v; scaleY = scaleX
                rotationZ = -2.5f * (1f - v)
            }
            Giris.YENI -> {
                scaleX = 0.5f + 0.5f * v; scaleY = scaleX
                rotationZ = -6f * (1f - v)
            }
            Giris.YOK -> Unit
        }
    }
}

/**
 * Günün mozaiği (SAHNE.md §3.2, §9): taslaklar, sıradaki iş (büyük), ikişer kareler, yoğun günde kompakt
 * satırlar. Her parça kendi anahtarıyla durur; sıra ya da biçim değişince (iş bitti, öneri onaylandı,
 * sıradaki değişti) eski yerinden ve boyundan yenisine kayar ([animateBounds], §5.3 "yeniden diz"); yeni
 * gelen küçükten büyür. İlk çizimde [acilis] ise parçalar sırayla açılış hareketiyle gelir (§5.1).
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
internal fun BugunMozaik(
    parcalar: List<MozaikParcasi>,
    siradaki: String?,
    hareketler: BugunHareketleri,
    acilis: Boolean,
    onKayit: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val hareket = Sahne.hareket
    val aralik = Sahne.olcu.aralik
    val gorulen = remember { HashSet<String>() }
    val ilk = remember { booleanArrayOf(true) }
    val diz = remember(hareket) { BoundsTransform { _, _ -> hareket.oturma<Rect>() } }
    LookaheadScope {
        Layout(
            modifier = modifier,
            content = {
                parcalar.forEachIndexed { i, p ->
                    key(p.anahtar) {
                        val g = when {
                            ilk[0] -> if (acilis) Giris.ACILIS else Giris.YOK
                            p.anahtar !in gorulen -> Giris.YENI
                            else -> Giris.YOK
                        }
                        Box(
                            Modifier
                                .then(if (hareket.uzamsal) Modifier.animateBounds(this@LookaheadScope, boundsTransform = diz) else Modifier)
                                .giris(g, i),
                        ) {
                            MozaikParcasiCiz(p, p.anahtar == siradaki, hareketler, onKayit)
                        }
                    }
                }
            },
        ) { olculer, c ->
            val w = c.maxWidth
            val bosluk = aralik.roundToPx()
            val satirAraligi = 8.dp.roundToPx()
            val yerler = ArrayList<Triple<androidx.compose.ui.layout.Placeable, Int, Int>>(olculer.size)
            var y = 0
            var i = 0
            while (i < olculer.size) {
                val b = parcalar[i].bicim
                if (b == MozaikBicimi.KARE && i + 1 < olculer.size && parcalar[i + 1].bicim == MozaikBicimi.KARE) {
                    val sol = (w - bosluk) / 2
                    val a = olculer[i].measure(Constraints.fixedWidth(sol))
                    val s = olculer[i + 1].measure(Constraints.fixedWidth(w - bosluk - sol))
                    yerler += Triple(a, 0, y)
                    yerler += Triple(s, sol + bosluk, y)
                    y += max(a.height, s.height)
                    i += 2
                } else {
                    val p = olculer[i].measure(Constraints.fixedWidth(w))
                    yerler += Triple(p, 0, y)
                    y += p.height
                    i += 1
                }
                if (i < olculer.size) {
                    y += if (b == MozaikBicimi.SATIR && parcalar[i].bicim == MozaikBicimi.SATIR) satirAraligi else bosluk
                }
            }
            layout(w, y) { yerler.forEach { (p, x, py) -> p.place(x, py) } }
        }
    }
    SideEffect {
        ilk[0] = false
        gorulen.clear()
        parcalar.mapTo(gorulen) { it.anahtar }
    }
}

@Composable
private fun MozaikParcasiCiz(p: MozaikParcasi, siradaki: Boolean, h: BugunHareketleri, onKayit: (String) -> Unit) {
    when (p.bicim) {
        MozaikBicimi.BUYUK, MozaikBicimi.KARE, MozaikBicimi.GENIS -> AcikLevha(
            p.kayit,
            when (p.bicim) {
                MozaikBicimi.BUYUK -> LevhaBoyu.BUYUK
                MozaikBicimi.KARE -> LevhaBoyu.KARE
                else -> LevhaBoyu.GENIS
            },
            siradaki, h, onKayit,
        )
        MozaikBicimi.TASLAK -> TaslakLevha(p.kayit, h, onKayit)
        MozaikBicimi.TASLAK_GRUBU -> OneriGrubu(p.kayitlar, h, onKayit)
        MozaikBicimi.SATIR -> BugunSatiri(p.kayit, h, onKayit)
    }
}

/** Tamamla / Geri al özel eylemi (TalkBack). */
internal fun SemanticsPropertyReceiver.tamamlaEylemi(k: BugunKaydi, h: BugunHareketleri, levha: Boolean) {
    if (!k.tamamlanabilir) return
    val tamam = k.hal == LevhaHali.BITTI
    customActions = listOf(
        CustomAccessibilityAction(if (tamam) "Yeniden aç" else "Tamamla") { h.tamamla(k, !tamam, levha); true },
    )
}

@Composable
private fun AcikLevha(k: BugunKaydi, boy: LevhaBoyu, siradaki: Boolean, h: BugunHareketleri, onKayit: (String) -> Unit) {
    val takim = Sahne.levha(k.renk)
    val tamam = h.tamamGorunsun(k)
    val kilitli = h.kilitli(k.anahtar)
    // Canlı parçalar yalnız büyük levhada (§5.15); imza orada gün içinde bir kez, sonra çizili gelir.
    val canli = boy == LevhaBoyu.BUYUK && Sahne.hareket.surekli
    val imza = if (canli) remember(k.anahtar) { h.imzaOynasin(k) } else false
    SagaCek(
        etkin = k.tamamlanabilir && !kilitli,
        tamam = tamam,
        // [Ö] Levhanın kendi zemini zaten b: arkası bir ton koyu olsun ki kayan kenar görünsün (§8.3 "b" der).
        zemin = takim.koyuAyrinti,
        yazi = takim.acikAyrinti,
        sekil = Sahne.olcu.levha,
        onTamamla = { h.tamamla(k, !tamam, levha = true) },
    ) {
        Levha(
            baslik = k.baslik,
            altSatir = k.zaman,
            renk = k.renk,
            boy = boy,
            onAc = { onKayit(k.kayitId) },
            cizim = cizimYuvasiOnbellekli(k.cizim),
            kayitId = k.kayitId,
            isaret = if (k.gecti) "Geçti" else null,
            yikama = h.yikama[k.anahtar] ?: 0f,
            patlama = h.patlama[k.anahtar] ?: 0f,
            kilitli = kilitli,
            canli = canli,
            imzaOynasin = imza,
            aciklama = k.aciklama + if (siradaki) ", sıradaki iş" else "",
            erisim = { tamamlaEylemi(k, h, levha = true) },
            kose = if (k.tamamlanabilir) {
                {
                    TamamlaDugmesi(
                        tamam, k.baslik, { h.tamamla(k, it, levha = true) },
                        oyukRengi = takim.zemin,
                        boyut = if (boy == LevhaBoyu.KARE) 42.dp else 46.dp,
                    )
                }
            } else {
                null
            },
        )
    }
}

/** Taslak (karakalem) levha: "Asistan önerdi, …", Onayla / Vazgeç (§3.3, §5.4, §5.5). */
@Composable
private fun TaslakLevha(k: BugunKaydi, h: BugunHareketleri, onKayit: (String) -> Unit, modifier: Modifier = Modifier) {
    val cikis = h.cikis[k.anahtar] ?: 0f
    val alfa = h.dugmeAlfa[k.anahtar] ?: 1f
    Levha(
        baslik = k.baslik,
        altSatir = listOfNotNull("Asistan önerdi", k.zaman).joinToString(", "),
        renk = k.renk,
        boy = LevhaBoyu.GENIS,
        onAc = { onKayit(k.kayitId) },
        cizim = cizimYuvasiOnbellekli(k.cizim),
        modifier = modifier.graphicsLayer {
            alpha = 1f - cikis
            scaleX = 1f - 0.3f * cikis; scaleY = scaleX
            rotationZ = 4f * cikis
        },
        kayitId = k.kayitId,
        taslak = true,
        boyama = h.boyama[k.anahtar] ?: Boyama.KARAKALEM,
        kilitli = h.kilitli(k.anahtar),
        aciklama = listOfNotNull(k.baslik, k.zaman).joinToString(", "),
        erisim = {
            customActions = listOf(
                CustomAccessibilityAction("Onayla") { h.onayla(listOf(k)); true },
                CustomAccessibilityAction("Vazgeç") { h.vazgec(k); true },
            )
        },
        kose = {
            Row(Modifier.graphicsLayer { this.alpha = alfa }, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                HapDugme("Onayla", onClick = { h.onayla(listOf(k)) }, onayDugmesi = true)
                HapDugme("Vazgeç", onClick = { h.vazgec(k) }, dolu = false, onayDugmesi = true)
            }
        },
    )
}

/**
 * Yoğun günde birden çok öneri: tek karakalem levha, "Asistanın N önerisi"; içinde yatay kaydırılan
 * karakalem levhalar, her birinde Onayla / Vazgeç; başta "Hepsini onayla" (§9).
 */
@Composable
private fun OneriGrubu(kayitlar: List<BugunKaydi>, h: BugunHareketleri, onKayit: (String) -> Unit) {
    val renk = Sahne.renk
    Column(
        Modifier
            .fillMaxWidth()
            .kesikCerceve(renk.soluk, Sahne.olcu.levhaYaricapi.value)
            .padding(top = 16.dp, bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Metin(
                "Asistanın ${kayitlar.size} önerisi",
                stil = Sahne.yazi.levhaGenis,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            HapDugme("Hepsini onayla", onClick = { h.onayla(kayitlar) }, onayDugmesi = true)
        }
        Row(
            Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            for (k in kayitlar) key(k.anahtar) { TaslakLevha(k, h, onKayit, Modifier.width(300.dp)) }
        }
    }
}

/** Yoğun günün sırasındaki ve yaklaşan günlerdeki kompakt satır. */
@Composable
internal fun BugunSatiri(k: BugunKaydi, h: BugunHareketleri, onKayit: (String) -> Unit, modifier: Modifier = Modifier) {
    KompaktSatir(
        baslik = k.baslik,
        alt = k.zaman,
        renk = k.renk,
        cizim = cizimYuvasiOnbellekli(k.cizim),
        tamam = h.tamamGorunsun(k),
        onAc = { onKayit(k.kayitId) },
        onTamamla = if (k.tamamlanabilir) { t -> h.tamamla(k, t) } else null,
        modifier = modifier,
        isaret = if (k.gecti && k.hal == LevhaHali.ACIK) "Geçti" else null,
        kilitli = h.kilitli(k.anahtar),
        aciklama = k.aciklama,
        erisim = { tamamlaEylemi(k, h, levha = false) },
    )
}
