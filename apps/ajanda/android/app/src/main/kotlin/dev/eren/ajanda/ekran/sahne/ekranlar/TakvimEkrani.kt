package dev.eren.ajanda.ekran.sahne.ekranlar

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.snap
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.snapping.SnapPosition
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyItemScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.EkranMetinleri
import dev.eren.ajanda.ekran.TakvimDurumu
import dev.eren.ajanda.ekran.sahne.bilesen.Boyama
import dev.eren.ajanda.ekran.sahne.bilesen.HapDugme
import dev.eren.ajanda.ekran.sahne.bilesen.Levha
import dev.eren.ajanda.ekran.sahne.bilesen.LevhaBoyu
import dev.eren.ajanda.ekran.sahne.bilesen.LevhaFiguru
import dev.eren.ajanda.ekran.sahne.bilesen.TamamlaDugmesi
import dev.eren.ajanda.ekran.sahne.bilesen.TaslakSatir
import dev.eren.ajanda.ekran.sahne.bilesen.TostAlani
import dev.eren.ajanda.ekran.sahne.bilesen.TostDurumu
import dev.eren.ajanda.ekran.sahne.bilesen.TostKanaliniBagla
import dev.eren.ajanda.ekran.sahne.bilesen.YuvarlakDugme
import dev.eren.ajanda.ekran.sahne.bilesen.ayrintiyaBagli
import dev.eren.ajanda.ekran.sahne.bilesen.cizimYuvasiOnbellekli
import dev.eren.ajanda.ekran.sahne.bilesen.kesikCerceve
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import dev.eren.ajanda.ekran.sahne.tema.Simgeler
import dev.eren.ajanda.ekran.sahne.veri.AyIzgarasi
import dev.eren.ajanda.ekran.sahne.veri.BugunKaydi
import dev.eren.ajanda.ekran.sahne.veri.LevhaHali
import dev.eren.ajanda.ekran.sahne.veri.SeciliGun
import dev.eren.ajanda.ekran.sahne.veri.TakvimDeposu
import dev.eren.ajanda.ekran.sahne.veri.TakvimSahneDenetleyici
import dev.eren.ajanda.ekran.sahne.veri.TakvimSahneModeli
import kotlinx.coroutines.launch
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth

/** Gün şeridi bu kadar karta kadar yatay levhalardır; fazlası kompakt satırlar (SAHNE.md §9 "takvimde yoğun gün"). */
internal const val SERIT_SINIRI = 4

/** Takvim sekmesinin eylemleri: depoya ya da (depo yoksa) vitrinin yerel seçimine gider. */
@Immutable
internal class TakvimKumandasi(
    val gunSec: (LocalDate) -> Unit,
    val ayKaydir: (Long) -> Unit,
    val bugune: () -> Unit,
    val bitenleriGizle: (Boolean) -> Unit,
    val yenile: () -> Unit,
)

/**
 * Takvim sekmesi (SAHNE.md §3.6, §5.12, §9; YOL-HARITASI 4.3): ay başı, ay ızgarası (pazartesi başlar; dönem
 * şeritleri; renkli noktalar), seçili günün başlığı ve kayıtları. Hafta görünümü yok.
 *
 * - **Gün**: yatay kaydırılan, ortaya oturan şerit levhalar (en çok [SERIT_SINIRI]); fazlası kompakt satırlar
 *   (sağa çekerek tamamlanır). Sıra: bölümsüz saatsizler, gün bölümlüler, saatliler; tamamlanan iş solar ve sona
 *   iner. Taslak karakalem, Onayla / Vazgeç. Levhaya ya da satıra dokunmak ayrıntıyı açar (levha kapağa büyür).
 * - **Ay**: ok düğmeleri, ızgarayı yatay sürükleme (56 dp) ya da ay dışı güne dokunma; "Bugün" seçime döner.
 * - **Hareket**: ay 70 dp yandan, adı 24 dp dikeyde gelir; gün lekesi kayar; kartlar sırayla sağdan gelir.
 *   "Hareketi azalt"ta hepsi anlık (§6); sürükleme parmağı izler.
 * - **Tost** ortak kanaldan (geri alma). Silme ayrıntıdan.
 *
 * [depo] `null` ise yer tutucu örneklerle çizilir (iskelet testleri); seçim yerel, işlemler veriyi değiştirmez.
 */
@Composable
fun TakvimEkrani(depo: TakvimDeposu?, bugun: LocalDate, onKayit: (String) -> Unit, modifier: Modifier = Modifier) {
    val bag = if (depo != null) depoyaBagla(depo) else vitrineBagla(bugun)
    val secim = bag.secim
    val kumanda = bag.kumanda
    val hareketler = rememberBugunHareketleri(depo)
    // Bir işlemin hareketi sürerken ekran işlemin başladığı andaki modeli gösterir; çekirdek çağrısı çoktan gitti.
    val model = hareketler.dondur(bag.model)
    val tost = remember { TostDurumu() }
    if (depo != null) TostKanaliniBagla(depo.tostKanali, tost)

    val gun: SeciliGun? = model.gun?.takeIf { it.gun == secim.secili }
    val kayitlar = gun?.kayitlar
    val seritKipi = kayitlar != null && kayitlar.size in 1..SERIT_SINIRI
    val pay = sayfaPayi()
    val yon = LocalLayoutDirection.current
    val yan = Modifier.padding(start = pay.calculateStartPadding(yon), end = pay.calculateEndPadding(yon))
    val ay = model.aylar[secim.ay]
    val girisler = remember { KartGirisleri() }
    val hareketAyari = Sahne.hareket
    if (kayitlar != null) girisler.gun(secim.secili, hareketAyari.uzamsal)
    LaunchedEffect(girisler.sayac) { girisler.oynat() }

    Box(modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            state = rememberLazyListState(),
            contentPadding = PaddingValues(top = pay.calculateTopPadding(), bottom = pay.calculateBottomPadding()),
        ) {
            item(key = "bas") { AyBasi(secim, kumanda, yan) }
            item(key = "izgara") { IzgaraAlani(secim, model, kumanda, yan) }
            if (ay?.okunamadi != null) {
                item(key = "ay-hata") {
                    OkumaHatasi("Bu ayın işaretleri okunamadı.", kumanda.yenile, yan.padding(top = 10.dp).then(takvimOgeHareketi()))
                }
            }
            item(key = "gun-baslik") {
                // Seçili günün başlığı; bugünden uzaktayken yanında "Bugün" (ay başı dar ekranda ay adına yer bıraksın).
                Row(yan.padding(start = 2.dp, top = 22.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Metin(
                        TakvimSahneDenetleyici.gunBasligi(secim.secili, secim.bugun),
                        stil = Sahne.yazi.takvimGun,
                        modifier = Modifier.weight(1f).semantics { heading() },
                    )
                    if (!secim.bugunde) {
                        Box(Modifier.padding(start = 8.dp).semantics(mergeDescendants = true) { contentDescription = "Bugüne dön" }) {
                            HapDugme("Bugün", onClick = kumanda.bugune, dolu = false)
                        }
                    }
                }
            }
            when {
                gun?.okunamadi != null && kayitlar == null -> item(key = "gun-hata") {
                    OkumaHatasi("Bu günün kayıtları okunamadı.", kumanda.yenile, yan.then(takvimOgeHareketi()))
                }
                kayitlar == null -> item(key = "gun-bekle") { Spacer(Modifier.height(1.dp)) }
                kayitlar.isEmpty() -> item(key = "gun-bos:${secim.secili}") { BosGunKarti(yan.then(takvimOgeHareketi()).kartGirisi(girisler, 0)) }
                seritKipi -> item(key = "serit:${secim.secili}") {
                    KartSeridi(kayitlar, secim.secili, girisler, hareketler, onKayit, pay.calculateStartPadding(yon), pay.calculateEndPadding(yon))
                }
                else -> itemsIndexed(kayitlar, key = { _, k -> "s:${secim.secili}:${k.anahtar}" }) { i, k ->
                    TakvimSatiri(k, hareketler, onKayit, yan.padding(bottom = 8.dp).then(takvimOgeHareketi()).kartGirisi(girisler, i))
                }
            }
            if (gun != null && (model.bitenleriGizle || gun.bitenSayisi > 0)) {
                item(key = "bitenler") {
                    BitenlerSecimi(model.bitenleriGizle, gun.bitenSayisi, kumanda.bitenleriGizle, yan.padding(top = 6.dp).then(takvimOgeHareketi()))
                }
            }
            item(key = "son") { Spacer(Modifier.height(1.dp)) }
        }
        TostAlani(
            tost,
            Modifier
                .align(Alignment.BottomCenter)
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(start = 16.dp, end = 16.dp, bottom = 96.dp),
        )
    }
}

/** Ekranın seçimi, modeli ve eylemleri. */
private class TakvimBagi(val secim: TakvimDurumu, val model: TakvimSahneModeli, val kumanda: TakvimKumandasi)

@Composable
private fun depoyaBagla(depo: TakvimDeposu): TakvimBagi {
    val secim by depo.secim.collectAsState()
    val model by depo.model.collectAsState()
    DisposableEffect(depo) {
        depo.goruldu()
        onDispose { depo.gizlendi() }
    }
    // Seçim süreç ölümünden sağ çıksın: kaydedilmiş seçim yalnız ilk kuruluşta geri yüklenir.
    var kayitli by rememberSaveable { mutableStateOf<String?>(null) }
    val ilkKayit = remember { kayitli }
    LaunchedEffect(depo) { TakvimDurumu.coz(ilkKayit)?.let(depo::geriYukle) }
    SideEffect { kayitli = secim.metin() }
    val kumanda = remember(depo) {
        TakvimKumandasi(depo::gunSec, depo::ayKaydir, depo::bugune, depo::bitenleriGizle, depo::yenile)
    }
    return TakvimBagi(secim, model, kumanda)
}

@Composable
private fun vitrineBagla(bugun: LocalDate): TakvimBagi {
    var metin by rememberSaveable { mutableStateOf(TakvimDurumu.baslangic(bugun).metin()) }
    var gizle by rememberSaveable { mutableStateOf(false) }
    val secim = TakvimDurumu.coz(metin) ?: TakvimDurumu.baslangic(bugun)
    val model = remember(secim, gizle) { takvimVitrini(secim, gizle) }
    val kumanda = TakvimKumandasi(
        gunSec = { t -> metin = secim.gunSec(t).metin() },
        ayKaydir = { n -> metin = secim.ayKaydir(n).metin() },
        bugune = { metin = secim.bugune().metin() },
        bitenleriGizle = { gizle = it },
        yenile = {},
    )
    return TakvimBagi(secim, model, kumanda)
}

private val IKI_HARF = listOf("Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz")

/** Ay başı (§3.6): ay adı ve yanında yıl; sağda iki yuvarlak ok. */
@Composable
private fun AyBasi(secim: TakvimDurumu, kumanda: TakvimKumandasi, modifier: Modifier) {
    val hareket = Sahne.hareket
    val d = LocalDensity.current
    val buyukYazi = d.fontScale > 1.3f
    Row(modifier.padding(start = 2.dp, top = 4.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        AnimatedContent(
            targetState = secim.ay,
            modifier = Modifier.weight(1f),
            transitionSpec = {
                val yonu = if (targetState > initialState) 1 else -1
                if (hareket.uzamsal) {
                    val k = with(d) { 24.dp.roundToPx() }
                    (fadeIn(hareket.solma(220)) + slideInVertically(hareket.yay()) { yonu * k }) togetherWith
                        (fadeOut(hareket.solma(120)) + slideOutVertically(hareket.oturma()) { -yonu * k / 2 })
                } else {
                    EnterTransition.None togetherWith ExitTransition.None
                }.using(SizeTransform(clip = false) { _, _ -> snap() })
            },
            label = "ayAdi",
        ) { ay ->
            Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.semantics(mergeDescendants = true) { heading() }) {
                Metin(
                    ayAdi(ay),
                    stil = if (buyukYazi) Sahne.yazi.gunBasligi else Sahne.yazi.ayBasligi,
                    satirSiniri = 1,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Metin(
                    ay.year.toString(),
                    stil = Sahne.yazi.govde.copy(fontWeight = FontWeight.Medium),
                    renk = Sahne.renk.soluk,
                    satirSiniri = 1,
                    modifier = Modifier.padding(start = 8.dp, bottom = 4.dp),
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            YuvarlakDugme(Simgeler.Geri, "Önceki ay", { kumanda.ayKaydir(-1) })
            YuvarlakDugme(Simgeler.Ileri, "Sonraki ay", { kumanda.ayKaydir(1) })
        }
    }
}

private fun ayAdi(ay: YearMonth): String = EkranMetinleri.ayVeYil(ay).substringBeforeLast(' ')

/**
 * Hafta günleri ve ızgara. Izgara parmağı %60 izler; 56 dp'yi geçip bırakılınca ay değişir, değilse yayla geri
 * döner (§5.12). Yeni ay 70 dp yandan ve saydamdan gelir.
 */
@Composable
private fun IzgaraAlani(secim: TakvimDurumu, model: TakvimSahneModeli, kumanda: TakvimKumandasi, modifier: Modifier) {
    val hareket = Sahne.hareket
    val d = LocalDensity.current
    val kapsam = rememberCoroutineScope()
    val kayma = remember { Animatable(0f) }
    val esik = with(d) { 56.dp.toPx() }
    val kisa = d.fontScale >= 1.5f
    Column(modifier) {
        Row(Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
            for (g in DayOfWeek.entries) {
                Metin(
                    if (kisa) IKI_HARF[g.ordinal] else EkranMetinleri.kisaGunAdi(g),
                    stil = Sahne.yazi.kucuk.copy(textAlign = TextAlign.Center),
                    renk = Sahne.renk.soluk,
                    modifier = Modifier.weight(1f).semantics { contentDescription = EkranMetinleri.gunAdi(g) },
                    satirSiniri = 1,
                )
            }
        }
        Box(
            Modifier
                .pointerInput(kumanda) {
                    var toplam = 0f
                    detectHorizontalDragGestures(
                        onDragStart = { toplam = 0f },
                        onDragEnd = {
                            val n = when {
                                toplam < -esik -> 1L
                                toplam > esik -> -1L
                                else -> 0L
                            }
                            if (n != 0L) kumanda.ayKaydir(n)
                            kapsam.launch { kayma.animateTo(0f, hareket.yayHizli()) }
                        },
                        onDragCancel = { kapsam.launch { kayma.animateTo(0f, hareket.yayHizli()) } },
                    ) { degisim, miktar ->
                        degisim.consume()
                        toplam += miktar
                        kapsam.launch { kayma.snapTo(toplam * 0.6f) }
                    }
                }
                .graphicsLayer { translationX = kayma.value },
        ) {
            AnimatedContent(
                targetState = secim.ay,
                transitionSpec = { ayGecisi(targetState > initialState, hareket, with(d) { 70.dp.roundToPx() }) },
                label = "ay",
            ) { a ->
                val iz = model.aylar[a] ?: remember(a, secim.bugun) { AyIzgarasi.bos(a, secim.bugun) }
                AyIzgarasiCiz(
                    iz,
                    secili = secim.secili.takeIf { YearMonth.from(it) == a },
                    bugun = secim.bugun,
                    lekeRengi = model.lekeRengi(secim.secili),
                    onSec = kumanda.gunSec,
                )
            }
        }
    }
}

private fun ayGecisi(ileri: Boolean, hareket: SahneHareket, kayma: Int): ContentTransform {
    if (!hareket.uzamsal) return ContentTransform(EnterTransition.None, ExitTransition.None, sizeTransform = SizeTransform { _, _ -> snap() })
    val yon = if (ileri) 1 else -1
    return (fadeIn(hareket.solma(220)) + slideInHorizontally(hareket.yay()) { yon * kayma }) togetherWith
        (fadeOut(hareket.solma(120)) + slideOutHorizontally(hareket.oturma()) { -yon * kayma / 2 })
}

/**
 * Seçili günün şerit kartları: ekran genişliğinin %64'ü, ortaya oturur, ekran kenarına kadar taşar. Sağa çekme yok
 * (yatay kaydırmayla çakışır, §8.3); tamamlama dairesi ve TalkBack eylemi var.
 */
@Composable
private fun KartSeridi(kayitlar: List<BugunKaydi>, gun: LocalDate, girisler: KartGirisleri, h: BugunHareketleri, onKayit: (String) -> Unit, bas: Dp, son: Dp) {
    val durum = key(gun) { rememberLazyListState() }
    val genislik = (LocalConfiguration.current.screenWidthDp * 0.64f).dp
    LazyRow(
        state = durum,
        flingBehavior = rememberSnapFlingBehavior(durum, SnapPosition.Center),
        contentPadding = PaddingValues(start = bas, end = son),
        horizontalArrangement = Arrangement.spacedBy(Sahne.olcu.aralik),
    ) {
        itemsIndexed(kayitlar, key = { _, k -> k.anahtar }) { i, k ->
            TakvimKarti(k, h, onKayit, Modifier.width(genislik).then(takvimOgeHareketi()).kartGirisi(girisler, i))
        }
    }
}

/** Şerit kartı: levha (§3.2 tablo "şerit"); tamamlanan solar, taslak karakalem ve onay düğmeleri üstte. */
@Composable
private fun TakvimKarti(k: BugunKaydi, h: BugunHareketleri, onKayit: (String) -> Unit, modifier: Modifier) {
    val takim = Sahne.levha(k.renk)
    val sekil = Sahne.olcu.levha
    val kilitli = h.kilitli(k.anahtar)
    if (k.hal == LevhaHali.TASLAK) {
        val cikis = h.cikis[k.anahtar] ?: 0f
        val alfa = h.dugmeAlfa[k.anahtar] ?: 1f
        Levha(
            baslik = k.baslik,
            altSatir = listOfNotNull("Asistan önerdi", k.zaman).joinToString(", "),
            renk = k.renk,
            boy = LevhaBoyu.SERIT,
            onAc = { onKayit(k.kayitId) },
            cizim = cizimYuvasiOnbellekli(k.cizim),
            modifier = modifier
                .ayrintiyaBagli(k.kayitId, sekil)
                .graphicsLayer {
                    alpha = 1f - cikis
                    scaleX = 1f - 0.3f * cikis; scaleY = scaleX
                    rotationZ = 4f * cikis
                },
            taslak = true,
            boyama = h.boyama[k.anahtar] ?: Boyama.KARAKALEM,
            kilitli = kilitli,
            aciklama = k.aciklama,
            erisim = { taslakEylemleri(k, h) },
            kose = {
                Row(Modifier.graphicsLayer { this.alpha = alfa }, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    HapDugme("Onayla", onClick = { h.onayla(listOf(k)) }, onayDugmesi = true)
                    HapDugme("Vazgeç", onClick = { h.vazgec(k) }, dolu = false, onayDugmesi = true)
                }
            },
        )
        return
    }
    val tamam = h.tamamGorunsun(k)
    Levha(
        baslik = k.baslik,
        altSatir = k.zaman,
        renk = k.renk,
        boy = LevhaBoyu.SERIT,
        onAc = { onKayit(k.kayitId) },
        cizim = cizimYuvasiOnbellekli(k.cizim),
        modifier = modifier.ayrintiyaBagli(k.kayitId, sekil),
        bitti = k.hal == LevhaHali.BITTI,
        isaret = if (k.gecti && k.hal == LevhaHali.ACIK) "Geçti" else null,
        yikama = h.yikama[k.anahtar] ?: 0f,
        patlama = h.patlama[k.anahtar] ?: 0f,
        kilitli = kilitli,
        imzaOynasin = false,
        aciklama = k.aciklama,
        erisim = { tamamlaEylemi(k, h, levha = true) },
        kose = if (k.tamamlanabilir) {
            { TamamlaDugmesi(tamam, k.baslik, { h.tamamla(k, it, levha = true) }, oyukRengi = takim.zemin, boyut = 42.dp) }
        } else {
            null
        },
    )
}

/** Taslağın TalkBack eylemleri. */
private fun androidx.compose.ui.semantics.SemanticsPropertyReceiver.taslakEylemleri(k: BugunKaydi, h: BugunHareketleri) {
    customActions = listOf(
        CustomAccessibilityAction("Onayla") { h.onayla(listOf(k)); true },
        CustomAccessibilityAction("Vazgeç") { h.vazgec(k); true },
    )
}

/** Yoğun günün satırı: açık ve biten iş kompakt satır (sağa çekilir), taslak karakalem satır. */
@Composable
private fun TakvimSatiri(k: BugunKaydi, h: BugunHareketleri, onKayit: (String) -> Unit, modifier: Modifier) {
    if (k.hal == LevhaHali.TASLAK) {
        TaslakSatir(
            baslik = k.baslik, alt = k.zaman, renk = k.renk, cizim = cizimYuvasiOnbellekli(k.cizim),
            onAc = { onKayit(k.kayitId) }, onOnayla = { h.onayla(listOf(k)) }, onVazgec = { h.vazgec(k) },
            modifier = modifier,
            boyama = h.boyama[k.anahtar] ?: Boyama.KARAKALEM,
            dugmeAlfa = h.dugmeAlfa[k.anahtar] ?: 1f,
            cikis = h.cikis[k.anahtar] ?: 0f,
            kilitli = h.kilitli(k.anahtar),
            aciklama = k.aciklama,
            erisim = { taslakEylemleri(k, h) },
        )
    } else {
        BugunSatiri(k, h, onKayit, modifier)
    }
}

/** Boş gün: karakalem, kesik çerçeveli kart ("henüz boyanmamış gün"). */
@Composable
private fun BosGunKarti(modifier: Modifier) {
    val renk = Sahne.renk
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 112.dp)
            .kesikCerceve(renk.soluk.copy(alpha = 0.6f), Sahne.olcu.levhaYaricapi.value)
            .padding(start = 18.dp, end = 14.dp, top = 14.dp, bottom = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Metin("Bu gün boş.", stil = Sahne.yazi.levhaGenis)
            Metin("Artıya dokunup bir şey ekle.", stil = Sahne.yazi.levhaAlt, renk = renk.soluk, modifier = Modifier.padding(top = 6.dp))
        }
        Box(Modifier.width(84.dp).height(84.dp)) {
            LevhaFiguru(Simgeler.Yildiz, Sahne.levha(LevhaRengi.KUM), 0f, Modifier.fillMaxSize())
        }
    }
}

/** Okuma hatası: kesik çerçeveli satır ve "Yeniden dene". Elde eski veri varsa o kalır (bu yalnız veri yokken). */
@Composable
internal fun OkumaHatasi(metin: String, onYenidenDene: () -> Unit, modifier: Modifier) {
    val renk = Sahne.renk
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 72.dp)
            .kesikCerceve(renk.soluk.copy(alpha = 0.6f), Sahne.olcu.satirYaricapi.value)
            .padding(start = 18.dp, end = 10.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Metin(metin, stil = Sahne.yazi.levhaAlt, renk = renk.soluk, modifier = Modifier.weight(1f))
        HapDugme("Yeniden dene", onClick = onYenidenDene, onayDugmesi = true)
    }
}

/** "Bitenler: Gizle / Göster" (Bugün'le ortak seçim). */
@Composable
internal fun BitenlerSecimi(gizli: Boolean, sayi: Int, onDegis: (Boolean) -> Unit, modifier: Modifier) {
    val metin = when {
        gizli -> "Bitenler gizli"
        sayi == 1 -> "1 iş bitti"
        else -> "$sayi iş bitti"
    }
    val dugme = if (gizli) "Göster" else "Gizle"
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Metin(metin, stil = Sahne.yazi.etiket.copy(fontWeight = FontWeight.SemiBold), renk = Sahne.renk.soluk, modifier = Modifier.weight(1f).padding(start = 2.dp))
        Box(
            Modifier
                .heightIn(min = Sahne.olcu.dokunma)
                .clip(Sahne.olcu.hap)
                .clickable(role = Role.Button, onClickLabel = "Bitenler: $dugme") { onDegis(!gizli) }
                .padding(horizontal = 12.dp),
            contentAlignment = Alignment.Center,
        ) {
            Metin(dugme, stil = Sahne.yazi.etiket.copy(fontWeight = FontWeight.SemiBold), renk = Sahne.renk.murekkep)
        }
    }
}

/** Liste öğesinin yer değiştirme, giriş ve çıkışı (§5.3); hareket azaltılmışsa hiçbiri (§6). */
@Composable
internal fun LazyItemScope.takvimOgeHareketi(): Modifier {
    val h = Sahne.hareket
    return if (h.azalt) {
        Modifier.animateItem(fadeInSpec = null, placementSpec = null, fadeOutSpec = null)
    } else {
        Modifier.animateItem(fadeInSpec = h.solma(220), placementSpec = h.oturma(), fadeOutSpec = h.solma(160))
    }
}

/**
 * Gün değişince kartların girişi (§5.12): sırayla 60 dp sağdan, 0.9 ölçekten, YAY eğrisiyle 520 ms; gecikme `i × 70`.
 * Bütün kartlar tek bir zaman çizgisine ([zaman], ms) bakar: sonradan kaydırılıp ekrana giren kart çizginin
 * neresindeyse oradan çizilir (giriş bittiyse yerinde), aynı günde yeniden dizilen kart yeniden oynamaz. Hareket
 * azaltılmışsa çizgi hep sonda.
 */
@Stable
internal class KartGirisleri {
    private var gun: LocalDate? = null

    /** Girişin zaman çizgisi (ms); [SON]'da her kart yerinde. */
    var zaman by mutableFloatStateOf(SON)
        private set

    /** Yeni gün sayacı (oynatıcıyı tetikler). */
    var sayac by mutableIntStateOf(0)
        private set

    /** Listesi gelen gün yeni ise çizgi başa alınır (çizimde: ilk karede kartlar zaten girişin başında). */
    fun gun(g: LocalDate, oyna: Boolean) {
        if (g == gun) return
        gun = g
        if (oyna) {
            zaman = 0f
            sayac++
        }
    }

    suspend fun oynat() {
        if (zaman >= SON) return
        animate(zaman, SON, animationSpec = tween((SON - zaman).toInt(), easing = LinearEasing)) { v, _ -> zaman = v }
    }

    companion object {
        const val SUREMS = 520f
        const val ADIM = 70f
        const val SON = SUREMS + 7 * ADIM

        /** Prototipin `YAY` eğrisi (`cubic-bezier(.34,1.45,.55,1)`, %6.6 aşma). */
        val YAY = CubicBezierEasing(0.34f, 1.45f, 0.55f, 1f)
    }
}

/** Kartın girişteki hâli ([KartGirisleri]); [sira] kademe. */
internal fun Modifier.kartGirisi(g: KartGirisleri, sira: Int): Modifier = graphicsLayer {
    val t = ((g.zaman - minOf(sira, 7) * KartGirisleri.ADIM) / KartGirisleri.SUREMS).coerceIn(0f, 1f)
    if (t >= 1f) return@graphicsLayer
    val v = KartGirisleri.YAY.transform(t)
    alpha = t.coerceIn(0f, 1f)
    translationX = (1f - v) * 60.dp.toPx()
    val o = 0.9f + 0.1f * v
    scaleX = o; scaleY = o
}
