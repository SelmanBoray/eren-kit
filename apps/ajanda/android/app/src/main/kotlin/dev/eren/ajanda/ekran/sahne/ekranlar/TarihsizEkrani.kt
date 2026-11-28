package dev.eren.ajanda.ekran.sahne.ekranlar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.sahne.bilesen.AraBaslik
import dev.eren.ajanda.ekran.sahne.bilesen.BitenHapi
import dev.eren.ajanda.ekran.sahne.bilesen.Boyama
import dev.eren.ajanda.ekran.sahne.bilesen.LevhaFiguru
import dev.eren.ajanda.ekran.sahne.bilesen.TaslakSatir
import dev.eren.ajanda.ekran.sahne.bilesen.TostAlani
import dev.eren.ajanda.ekran.sahne.bilesen.TostDurumu
import dev.eren.ajanda.ekran.sahne.bilesen.TostKanaliniBagla
import dev.eren.ajanda.ekran.sahne.bilesen.cizimYuvasiOnbellekli
import dev.eren.ajanda.ekran.sahne.bilesen.kesikCerceve
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.tema.Simgeler
import dev.eren.ajanda.ekran.sahne.veri.BugunKaydi
import dev.eren.ajanda.ekran.sahne.veri.KomsuRenk
import dev.eren.ajanda.ekran.sahne.veri.TarihsizDeposu
import dev.eren.ajanda.ekran.sahne.veri.TarihsizModeli
import dev.eren.ajanda.ekran.sahne.veri.YogunGun

/**
 * Tarihsizler sekmesi (SAHNE.md §3.4): zamanı sonra belli olacak işler. Yukarıdan aşağı: baş (kaç iş bekliyor),
 * asistanın önerileri (karakalem satır, Onayla / Vazgeç), yapılacaklar (kompakt satır; daireyle ya da sağa
 * çekerek tamamlanır), notlar (tamamlanmaz), bitenler (hap; en son biten başta, çoksa "ve N iş daha"; Bugün'le
 * ortak Gizle / Göster).
 *
 * Tamamlanan iş görünür kalır: satır 300 ms dolu daireyle durur, sonra Bitenler'in başına hap olarak iner; tost
 * geri alır. Silme ayrıntıdan. [depo] `null` ise yer tutucu örneklerle çizilir.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TarihsizEkrani(depo: TarihsizDeposu?, onKayit: (String) -> Unit, modifier: Modifier = Modifier) {
    var vitrinGizle by rememberSaveable { mutableStateOf(false) }
    val modelDurumu: State<TarihsizModeli> = depo?.model?.collectAsState() ?: remember(vitrinGizle) { mutableStateOf(tarihsizVitrini(vitrinGizle)) }
    if (depo != null) {
        DisposableEffect(depo) {
            depo.goruldu()
            onDispose { depo.gizlendi() }
        }
    }
    val hareketler = rememberBugunHareketleri(depo)
    val model = hareketler.dondur(modelDurumu.value)
    val tost = remember { TostDurumu() }
    if (depo != null) TostKanaliniBagla(depo.tostKanali, tost)
    val gizle: (Boolean) -> Unit = { b -> if (depo != null) depo.bitenleriGizle(b) else vitrinGizle = b }
    var bitenlerAcik by rememberSaveable { mutableStateOf(false) }

    Box(modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            state = rememberLazyListState(),
            contentPadding = sayfaPayi(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item(key = "bas") { TarihsizBasi(model) }
            if (model.okumaHatasi != null) {
                item(key = "hata") {
                    OkumaHatasi(
                        if (model.acikSayisi == 0 && model.bitenler.isEmpty()) "Tarihsiz işler okunamadı." else "Liste güncellenemedi; son okunan hâli görünüyor.",
                        { depo?.yenile() },
                        Modifier.then(takvimOgeHareketi()),
                    )
                }
            }
            if (model.yuklendi && model.bos && model.okumaHatasi == null) {
                item(key = "bos") { BosListe(Modifier.then(takvimOgeHareketi())) }
            }
            items(model.taslaklar, key = { "t:${it.anahtar}" }) { k ->
                TaslakSatir(
                    baslik = k.baslik, alt = k.zaman, renk = k.renk, cizim = cizimYuvasiOnbellekli(k.cizim),
                    onAc = { onKayit(k.kayitId) }, onOnayla = { hareketler.onayla(listOf(k)) }, onVazgec = { hareketler.vazgec(k) },
                    modifier = Modifier.then(takvimOgeHareketi()),
                    boyama = hareketler.boyama[k.anahtar] ?: Boyama.KARAKALEM,
                    dugmeAlfa = hareketler.dugmeAlfa[k.anahtar] ?: 1f,
                    cikis = hareketler.cikis[k.anahtar] ?: 0f,
                    kilitli = hareketler.kilitli(k.anahtar),
                    aciklama = k.aciklama,
                    erisim = {
                        customActions = listOf(
                            CustomAccessibilityAction("Onayla") { hareketler.onayla(listOf(k)); true },
                            CustomAccessibilityAction("Vazgeç") { hareketler.vazgec(k); true },
                        )
                    },
                )
            }
            items(model.yapilacaklar, key = { "y:${it.anahtar}" }) { k ->
                BugunSatiri(k, hareketler, onKayit, Modifier.then(takvimOgeHareketi()))
            }
            if (model.notlar.isNotEmpty()) {
                item(key = "notlar-baslik") { AraBaslik("Notlar", Modifier.then(takvimOgeHareketi())) }
                items(model.notlar, key = { "n:${it.anahtar}" }) { k ->
                    BugunSatiri(k, hareketler, onKayit, Modifier.then(takvimOgeHareketi()))
                }
            }
            if (model.bitenler.isNotEmpty()) {
                item(key = "bitenler-baslik") {
                    BitenlerBasligi(model.bitenler.size, model.bitenleriGizle, gizle, Modifier.then(takvimOgeHareketi()))
                }
                if (!model.bitenleriGizle) {
                    item(key = "bitenler") {
                        BitenHaplari(model.bitenler, bitenlerAcik, { bitenlerAcik = true }, hareketler, onKayit, Modifier.then(takvimOgeHareketi()))
                    }
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

@Composable
private fun TarihsizBasi(model: TarihsizModeli) {
    Column(Modifier.padding(start = 2.dp, end = 2.dp, top = 4.dp, bottom = 10.dp)) {
        Metin("Zamanı sonra belli olur", stil = Sahne.yazi.etiket, renk = Sahne.renk.soluk)
        Metin("Tarihsizler", stil = Sahne.yazi.gunBasligi, modifier = Modifier.padding(top = 8.dp).semantics { heading() })
        val n = model.taslaklar.size + model.yapilacaklar.size
        val alt = when {
            !model.yuklendi -> ""
            n == 0 && model.notlar.isEmpty() -> "Bekleyen iş yok."
            n == 0 -> "${model.notlar.size} not."
            model.taslaklar.isNotEmpty() -> "$n iş bekliyor; ${model.taslaklar.size} öneri onay istiyor."
            else -> "$n iş bekliyor."
        }
        if (alt.isNotEmpty()) Metin(alt, stil = Sahne.yazi.govde, renk = Sahne.renk.soluk, modifier = Modifier.padding(top = 10.dp))
    }
}

@Composable
private fun BosListe(modifier: Modifier) {
    val renk = Sahne.renk
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 140.dp)
            .kesikCerceve(renk.soluk.copy(alpha = 0.6f), Sahne.olcu.levhaYaricapi.value)
            .padding(start = 18.dp, end = 14.dp, top = 16.dp, bottom = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Metin("Tarihsiz iş yok.", stil = Sahne.yazi.levhaGenis)
            Metin("Zamanı belli olmayan işler burada durur.", stil = Sahne.yazi.levhaAlt, renk = renk.soluk, modifier = Modifier.padding(top = 6.dp))
        }
        Box(Modifier.size(96.dp)) {
            LevhaFiguru(Simgeler.Cadir, Sahne.levha(LevhaRengi.KUM), 0f, Modifier.fillMaxSize())
        }
    }
}

/** "Bitenler · N" ve Gizle / Göster (Bugün'le ortak seçim). */
@Composable
private fun BitenlerBasligi(sayi: Int, gizli: Boolean, onDegis: (Boolean) -> Unit, modifier: Modifier) {
    val dugme = if (gizli) "Göster" else "Gizle"
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
        AraBaslik("Bitenler · $sayi", Modifier.weight(1f))
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

/** Biten hap'ları: en son biten başta; altıdan çoksa ilk beş ve "ve N iş daha". Yeni gelen küçükten büyür. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BitenHaplari(
    bitenler: List<BugunKaydi>,
    acik: Boolean,
    onHepsi: () -> Unit,
    h: BugunHareketleri,
    onKayit: (String) -> Unit,
    modifier: Modifier,
) {
    val gorunen = if (!acik && bitenler.size > YogunGun.BITEN_SINIRI) bitenler.take(YogunGun.BITEN_SINIRI - 1) else bitenler
    val gorulen = remember { HashSet<String>() }
    val ilk = remember { booleanArrayOf(true) }
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        gorunen.forEachIndexed { i, k ->
            key(k.anahtar) {
                BitenHapi(
                    ad = k.baslik,
                    renk = k.renk,
                    onAc = { onKayit(k.kayitId) },
                    modifier = Modifier.giris(if (!ilk[0] && k.anahtar !in gorulen) Giris.YENI else Giris.YOK, i),
                    aciklama = k.aciklama,
                    iptal = k.iptal,
                    erisim = {
                        if (k.tamamlanabilir) customActions = listOf(CustomAccessibilityAction("Yeniden aç") { h.tamamla(k, false); true })
                    },
                )
            }
        }
        if (gorunen.size < bitenler.size) {
            Box(
                Modifier
                    .heightIn(min = Sahne.olcu.dokunma)
                    .clip(Sahne.olcu.hap)
                    .clickable(role = Role.Button, onClickLabel = "Hepsini göster", onClick = onHepsi),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier.heightIn(min = 44.dp).clip(Sahne.olcu.hap).background(Sahne.renk.yuz).padding(horizontal = 16.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Metin("ve ${bitenler.size - gorunen.size} iş daha", stil = Sahne.yazi.etiket.copy(fontWeight = FontWeight.SemiBold), renk = Sahne.renk.soluk)
                }
            }
        }
    }
    SideEffect {
        ilk[0] = false
        gorulen.clear()
        bitenler.mapTo(gorulen) { it.anahtar }
    }
}

/** Çekirdeksiz Tarihsizler: yer tutucu örneklerden. */
internal fun tarihsizVitrini(gizle: Boolean): TarihsizModeli {
    val l = Ornekler.tarihsizler.map(::vitrinKaydi)
    return TarihsizModeli(
        yuklendi = true,
        taslaklar = emptyList(),
        yapilacaklar = KomsuRenk.ayir(l),
        notlar = emptyList(),
        bitenler = emptyList(),
        bitenleriGizle = gizle,
    )
}
