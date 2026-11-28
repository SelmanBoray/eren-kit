package dev.eren.ajanda.ekran.sahne.ekranlar

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyItemScope
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.Stable
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalAccessibilityManager
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.DurumGostergesi
import dev.eren.ajanda.ekran.HatirlatmaUyarilari
import dev.eren.ajanda.ekran.sahne.bilesen.AraBaslik
import dev.eren.ajanda.ekran.sahne.bilesen.BitenHapi
import dev.eren.ajanda.ekran.sahne.bilesen.DurumSeridi
import dev.eren.ajanda.ekran.sahne.bilesen.DurumTonu
import dev.eren.ajanda.ekran.sahne.bilesen.GostergeHapi
import dev.eren.ajanda.ekran.sahne.bilesen.HapDugme
import dev.eren.ajanda.ekran.sahne.bilesen.KalanKarti
import dev.eren.ajanda.ekran.sahne.bilesen.LevhaFiguru
import dev.eren.ajanda.ekran.sahne.bilesen.TostAlani
import dev.eren.ajanda.ekran.sahne.bilesen.TostDurumu
import dev.eren.ajanda.ekran.sahne.bilesen.YuvarlakDugme
import dev.eren.ajanda.ekran.sahne.bilesen.cizimYuvasiOnbellekli
import dev.eren.ajanda.ekran.sahne.bilesen.kesikCerceve
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.tema.Simgeler
import dev.eren.ajanda.ekran.sahne.veri.BugunDeposu
import dev.eren.ajanda.ekran.sahne.veri.BugunKaydi
import dev.eren.ajanda.ekran.sahne.veri.BugunModeli
import dev.eren.ajanda.ekran.sahne.veri.LevhaHali
import dev.eren.ajanda.ekran.sahne.veri.MozaikPlani
import dev.eren.ajanda.ekran.sahne.veri.YogunGun
import java.time.LocalDate

/**
 * Etkinliğe ait işler (başka etkinlik açmak, izin istemek). Bugün ekranı bunları yalnız çağırır.
 */
class BugunEylemleri(
    /** PC eşleştirme ekranı. */
    val eslestir: () -> Unit = {},
    /** Hatırlatma sorununun çözümü (izin iste, ayarı aç, "anladım"). */
    val hatirlatmaCoz: (HatirlatmaUyarilari.Uyari) -> Unit = {},
    /** Gönderilemeyen değişikliği düzeltip yeniden ekleme (eski kayıt formu). */
    val retDuzelt: (String) -> Unit = {},
)

/**
 * Bugün sekmesi (SAHNE.md §3.2–3.4, §5.1–5.5, §9): eski "Tarihliler" listesinin yerini alır.
 *
 * Yukarıdan aşağı: baş (tarih, PC göstergesi, ayarlar; gün cümlesi), durum şeritleri (eşleşme yok,
 * hatırlatma sorunu, gönderilemeyenler), önceki günlerden kalanlar, taslaklar ve günün mozaiği, bitenler,
 * yaklaşan günler. Altta tost (geri alma).
 *
 * [depo] `null` ise yer tutucu örneklerle çizilir (iskelet testleri); işlemler veriyi değiştirmez.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BugunEkrani(
    depo: BugunDeposu?,
    bugun: LocalDate,
    onKayit: (String) -> Unit,
    onAyarlar: () -> Unit,
    modifier: Modifier = Modifier,
    eylemler: BugunEylemleri = BugunEylemleri(),
) {
    val modelDurumu: State<BugunModeli> = depo?.model?.collectAsState() ?: remember(bugun) { mutableStateOf(vitrinModeli(bugun)) }
    val hareket = Sahne.hareket
    val hareketler = rememberBugunHareketleri(depo)
    // Bir işlemin hareketi sürerken ekran işlemin başladığı andaki modeli gösterir; çekirdek çağrısı çoktan gitti.
    val model = hareketler.dondur(modelDurumu.value)
    val tost = remember { TostDurumu() }

    // Depodan gelen tostlar (işlem sonucu, hata). Süresini depo tutar: ekran yeniden kurulunca (döndürme,
    // ayrıntıdan dönüş) tost kalan süresiyle döner; süresi dolan ya da eylemi kullanılan yeniden çıkmaz.
    if (depo != null) {
        val istek by depo.tost.collectAsState()
        val erisim = LocalAccessibilityManager.current
        LaunchedEffect(istek) {
            val t = istek ?: return@LaunchedEffect
            val g = t.geriAlma
            val sure = depo.tostSuresi(t.no) { TostDurumu.sure(g != null, erisim) } ?: return@LaunchedEffect
            tost.goster(
                t.mesaj, eylem = if (g != null) "Geri al" else null, hata = t.hata, sure = sure,
                onKalan = { depo.tostKalani(t.no, it) },
            ) { depo.tostuGeriAl(t) }
        }
    }

    // Açılış hareketi yalnız soğuk açılışta ve ekran başına bir kez (§5.1 [A]): baş ve mozaik ilk kuruluşta
    // tüketir; kaydırıp ekrandan çıkan öğe dönünce, ekran dönünce yeniden oynamaz.
    val acilis = rememberSaveable(saver = AcilisHareketi.Saklayici) {
        (depo != null && !depo.acilisOynadi && hareket.uzamsal).let { AcilisHareketi(bas = it, mozaik = it) }
    }
    if (model.yuklendi && depo != null) SideEffect { depo.acilisOynadi = true }

    // Yoğun gün (§9): eşikte sıkışır, iki altına inince açılır.
    val yaziOlcegi = LocalDensity.current.fontScale
    var yogunKarari by rememberSaveable { mutableStateOf<Boolean?>(null) }
    val yogun = if (model.yuklendi) YogunGun.karar(yogunKarari, model.yogunlukSayisi, yaziOlcegi > 1.3f) else false
    if (model.yuklendi && yogun != yogunKarari) SideEffect { yogunKarari = yogun }
    val parcalar = remember(model.acikler, model.taslaklar, yogun, yaziOlcegi) {
        MozaikPlani.kur(model.acikler, model.taslaklar, yogun, tekSutun = yaziOlcegi >= 1.5f)
    }

    var durumAcik by rememberSaveable { mutableStateOf(false) }
    var bitenlerAcik by rememberSaveable { mutableStateOf(false) }

    Box(modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            state = rememberLazyListState(),
            contentPadding = sayfaPayi(),
            verticalArrangement = Arrangement.spacedBy(Sahne.olcu.aralik),
        ) {
            item(key = "bas") {
                BugunBasi(model, acilis.tuket(AcilisHareketi.Parca.BAS), onAyarlar, onDurum = { durumAcik = true })
            }
            durumSeritleri(model, eylemler, onDurum = { durumAcik = true })
            if (model.kalanlar.isNotEmpty()) {
                item(key = "kalanlar") { Kalanlar(model.kalanlar, hareketler, onKayit, ogeHareketi()) }
            }
            if (model.yuklendi) {
                if (model.gunOkunamadi) {
                    item(key = "okunamadi") { GunOkunamadi({ depo?.yenile() }, ogeHareketi()) }
                } else if (parcalar.isEmpty()) {
                    item(key = "bos") { BosGun(ogeHareketi()) }
                } else {
                    item(key = "mozaik") {
                        BugunMozaik(parcalar, model.siradaki, hareketler, acilis.tuket(AcilisHareketi.Parca.MOZAIK), onKayit, ogeHareketi())
                    }
                }
            }
            if (model.bitenler.isNotEmpty()) {
                item(key = "bitenler-baslik") {
                    BolumBasligi(
                        "Bitenler",
                        sayi = model.bitenler.size,
                        dugme = if (model.bitenleriGizle) "Göster" else "Gizle",
                        onDugme = { depo?.bitenleriGizle(!model.bitenleriGizle) },
                        modifier = ogeHareketi(),
                    )
                }
                if (!model.bitenleriGizle) {
                    item(key = "bitenler") {
                        Bitenler(model.bitenler, yogun && !bitenlerAcik, { bitenlerAcik = true }, hareketler, onKayit, ogeHareketi())
                    }
                }
            }
            for (g in model.yaklasanlar) {
                item(key = "g:${g.anahtar}") { AraBaslik(g.baslik, ogeHareketi()) }
                items(g.kayitlar, key = { "y:${g.anahtar}:${it.anahtar}" }) { k ->
                    BugunSatiri(k, hareketler, onKayit, ogeHareketi())
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

    if (durumAcik) {
        BugunDurumPenceresi(model, depo, eylemler, onKapat = { durumAcik = false })
    }
}

/**
 * Açılış hareketi (§5.1) ekran başına bir kez. Baş ve mozaik LazyColumn öğesidir: kaydırınca ekrandan çıkan
 * öğe atılır, dönünce baştan kurulur. Karar öğenin içinde hatırlansaydı her dönüşte açılış yeniden oynardı;
 * burada her parça ilk kuruluşunda kararı alır ve tüketir. Ekran dönünce de korunur (kaydedilir).
 */
@Stable
internal class AcilisHareketi(bas: Boolean, mozaik: Boolean) {
    enum class Parca { BAS, MOZAIK }

    private val bekleyen = BooleanArray(2).also { it[0] = bas; it[1] = mozaik }

    /** Bu parça açılışı oynasın mı: ilk kuruluşta bekleyen karar; sonraki kuruluşlarda hep `false`. */
    @Composable
    fun tuket(p: Parca): Boolean {
        val oyna = remember { bekleyen[p.ordinal] }
        SideEffect { bekleyen[p.ordinal] = false }
        return oyna
    }

    companion object {
        val Saklayici: Saver<AcilisHareketi, List<Boolean>> = Saver(
            save = { listOf(it.bekleyen[0], it.bekleyen[1]) },
            restore = { AcilisHareketi(it[0], it[1]) },
        )
    }
}

/**
 * Liste öğesinin yer değiştirme, giriş ve çıkış hareketi (§5.3). Hareket azaltılmışsa hiçbiri: öğe yeni
 * yerinde belirir (§6).
 */
@Composable
private fun LazyItemScope.ogeHareketi(): Modifier {
    val h = Sahne.hareket
    return if (h.azalt) {
        Modifier.animateItem(fadeInSpec = null, placementSpec = null, fadeOutSpec = null)
    } else {
        Modifier.animateItem(fadeInSpec = h.solma(220), placementSpec = h.oturma(), fadeOutSpec = h.solma(160))
    }
}

/** Baş (§3.2): tarih satırı, PC göstergesi ve ayarlar; gün cümlesi; alt satır. Açılışta aşağıdan gelir. */
@Composable
private fun BugunBasi(model: BugunModeli, acilis: Boolean, onAyarlar: () -> Unit, onDurum: () -> Unit) {
    val hareket = Sahne.hareket
    val d = LocalDensity.current
    val giris = remember { Animatable(if (acilis) 0f else 1f) }
    LaunchedEffect(Unit) { if (giris.value < 1f) giris.animateTo(1f, hareket.yumusak(460)) }
    // Gün cümlesi değişince (sıradaki iş değişti) yeniden belirir (§5.3): 0.3 → 1, 400 ms doğrusal.
    val cumleAlfa = remember { Animatable(1f) }
    val ilkCumle = remember { arrayOf<String?>(null) }
    LaunchedEffect(model.cumle) {
        val onceki = ilkCumle[0]
        ilkCumle[0] = model.cumle
        if (onceki != null && onceki.isNotEmpty() && onceki != model.cumle && !hareket.azalt) {
            cumleAlfa.snapTo(0.3f)
            cumleAlfa.animateTo(1f, tween(400, easing = LinearEasing))
        }
    }
    val g = model.durum.gosterge
    Column(
        Modifier
            .padding(start = 2.dp, end = 2.dp, top = 4.dp, bottom = 8.dp)
            .graphicsLayer {
                alpha = giris.value
                translationY = (1f - giris.value) * with(d) { 18.dp.toPx() }
            },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Metin(model.tarih, stil = Sahne.yazi.etiket, renk = Sahne.renk.soluk, modifier = Modifier.weight(1f), satirSiniri = 2)
            GostergeHapi(g.kisa, g.ton.sahne(), onClick = onDurum, modifier = Modifier.padding(start = 8.dp))
            YuvarlakDugme(Simgeler.Ayar, aciklama = "Ayarlar", onClick = onAyarlar, modifier = Modifier.padding(start = 4.dp))
        }
        if (model.cumle.isNotEmpty()) {
            Metin(
                model.cumle,
                stil = Sahne.yazi.gunBasligi,
                modifier = Modifier
                    .padding(top = 6.dp)
                    .graphicsLayer { alpha = cumleAlfa.value }
                    .semantics { heading() },
            )
        }
        if (model.alt.isNotEmpty()) {
            Metin(model.alt, stil = Sahne.yazi.govde, renk = Sahne.renk.soluk, modifier = Modifier.padding(top = 10.dp))
        }
    }
}

internal fun DurumGostergesi.Ton.sahne(): DurumTonu = when (this) {
    DurumGostergesi.Ton.IYI -> DurumTonu.IYI
    DurumGostergesi.Ton.SURUYOR -> DurumTonu.SURUYOR
    DurumGostergesi.Ton.CEVRIMDISI -> DurumTonu.CEVRIMDISI
    DurumGostergesi.Ton.UYARI -> DurumTonu.UYARI
}

/** Eski ana ekranın şeritleri: eşleşme yok, hatırlatma sorunu, gönderilemeyenler. */
private fun LazyListScope.durumSeritleri(model: BugunModeli, eylemler: BugunEylemleri, onDurum: () -> Unit) {
    if (!model.yuklendi) return
    val d = model.durum
    if (!d.eslesmeVar) {
        item(key = "serit-eslesme") {
            DurumSeridi("PC ile eşleşmedi; kayıtlar yalnız bu telefonda.", "Eşleştir", DurumTonu.CEVRIMDISI, eylemler.eslestir, ogeHareketi())
        }
    }
    val h = d.hatirlatmaSeridi
    if (h != null && d.hatirlatmaSeritMetni != null) {
        item(key = "serit-hatirlatma") {
            DurumSeridi(
                "Hatırlatmalar çalmayabilir: ${d.hatirlatmaSeritMetni}", h.dugme, DurumTonu.UYARI,
                { eylemler.hatirlatmaCoz(h) }, ogeHareketi(), onGovde = onDurum,
            )
        }
    }
    if (d.retler.isNotEmpty()) {
        item(key = "serit-ret") {
            DurumSeridi("${d.retler.size} değişiklik PC'ye gönderilemedi.", "Gör", DurumTonu.UYARI, onDurum, ogeHareketi(), onGovde = onDurum)
        }
    }
}

/** Önceki günlerden kalan açık işler: küçük kartların yatay şeridi; sayfa kenarına taşar. */
@Composable
private fun Kalanlar(kalanlar: List<BugunKaydi>, h: BugunHareketleri, onKayit: (String) -> Unit, modifier: Modifier = Modifier) {
    val kenar = Sahne.olcu.kenar
    // Tamamlanan kalan şeritte solmuş durur (sonda); başlık açık olanları sayar.
    val acik = kalanlar.count { it.hal == LevhaHali.ACIK }
    Column(modifier) {
        AraBaslik(if (acik <= 1) "Önceki günlerden kalan" else "Önceki günlerden kalan $acik iş", Modifier.padding(bottom = 0.dp))
        Row(
            Modifier
                .kenaraTas(kenar)
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = kenar),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (k in kalanlar) {
                key(k.anahtar) {
                    KalanKarti(
                        baslik = k.baslik,
                        alt = k.zaman,
                        renk = k.renk,
                        cizim = cizimYuvasiOnbellekli(k.cizim),
                        tamam = h.tamamGorunsun(k),
                        onAc = { onKayit(k.kayitId) },
                        onTamamla = { t -> h.tamamla(k, t) },
                        kilitli = h.kilitli(k.anahtar),
                        aciklama = k.aciklama,
                        erisim = { tamamlaEylemi(k, h, levha = false) },
                    )
                }
            }
        }
    }
}

/** Satırı sayfa payının dışına, ekran kenarına kadar genişletir (yatay şerit kenardan kayar). */
private fun Modifier.kenaraTas(kenar: Dp): Modifier = layout { m, c ->
    val k = kenar.roundToPx()
    val w = if (c.hasBoundedWidth) c.maxWidth + 2 * k else c.maxWidth
    val p = m.measure(c.copy(minWidth = w, maxWidth = w))
    layout(c.maxWidth, p.height) { p.place(-k, 0) }
}

/** Bölüm başlığı ve sağında küçük metin düğmesi ("Gizle"). */
@Composable
private fun BolumBasligi(ad: String, sayi: Int, dugme: String, onDugme: () -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
        AraBaslik("$ad · $sayi", Modifier.weight(1f))
        Box(
            Modifier
                .padding(bottom = 0.dp)
                .heightIn(min = Sahne.olcu.dokunma)
                .clip(Sahne.olcu.hap)
                .clickable(role = Role.Button, onClickLabel = "$ad: $dugme", onClick = onDugme)
                .padding(horizontal = 12.dp),
            contentAlignment = Alignment.Center,
        ) {
            Metin(dugme, stil = Sahne.yazi.etiket.copy(fontWeight = FontWeight.SemiBold), renk = Sahne.renk.murekkep)
        }
    }
}

/** Bitenler (§3.4, §9): hap'lar; yoğun günde 6'yı geçerse ilk 5 + "ve N iş daha". */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Bitenler(
    bitenler: List<BugunKaydi>,
    kisalt: Boolean,
    onHepsi: () -> Unit,
    h: BugunHareketleri,
    onKayit: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val gorunen = if (kisalt && bitenler.size > YogunGun.BITEN_SINIRI) bitenler.take(YogunGun.BITEN_SINIRI - 1) else bitenler
    val gorulen = remember { HashSet<String>() }
    val ilk = remember { booleanArrayOf(true) }
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
                        if (k.tamamlanabilir) {
                            customActions = listOf(CustomAccessibilityAction("Yeniden aç") { h.tamamla(k, false); true })
                        }
                    },
                )
            }
        }
        if (gorunen.size < bitenler.size) {
            BitenFazlasi(bitenler.size - gorunen.size, onHepsi)
        }
    }
    SideEffect {
        ilk[0] = false
        gorulen.clear()
        bitenler.mapTo(gorulen) { it.anahtar }
    }
}

@Composable
private fun BitenFazlasi(n: Int, onClick: () -> Unit) {
    // Görünür hap 44 dp; dokunma alanı 48 dp (§3.1, G6).
    Box(
        Modifier
            .heightIn(min = Sahne.olcu.dokunma)
            .clip(Sahne.olcu.hap)
            .clickable(role = Role.Button, onClickLabel = "Hepsini göster", onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .heightIn(min = 44.dp)
                .clip(Sahne.olcu.hap)
                .background(Sahne.renk.yuz)
                .padding(horizontal = 16.dp),
            contentAlignment = Alignment.Center,
        ) {
            Metin("ve $n iş daha", stil = Sahne.yazi.etiket.copy(fontWeight = FontWeight.SemiBold), renk = Sahne.renk.soluk)
        }
    }
}

/**
 * Bugünün takvim günü okunamadı (çekirdek hatası): "boş gün" gösterilmez. Gün cümlesi ve gösterge nedeni
 * söyler; burada yeniden deneme. Okuma düzelince (dakika sayacı, değişiklik, öne geliş) gün kendiliğinden gelir.
 */
@Composable
private fun GunOkunamadi(onYenidenDene: () -> Unit, modifier: Modifier = Modifier) {
    val renk = Sahne.renk
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 96.dp)
            .kesikCerceve(renk.soluk.copy(alpha = 0.6f), Sahne.olcu.levhaYaricapi.value)
            .padding(start = 18.dp, end = 12.dp, top = 14.dp, bottom = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Metin("Okuma düzelince bugünün işleri burada görünür.", stil = Sahne.yazi.levhaAlt, renk = renk.soluk, modifier = Modifier.weight(1f))
        HapDugme("Yeniden dene", onClick = onYenidenDene, onayDugmesi = true)
    }
}

/**
 * Boş gün: karakalem, kesik çerçeveli geniş bir levha ("henüz boyanmamış gün"). Gün cümlesi zaten ne
 * yapılacağını söyler; bu yalnız sayfanın boş görünmemesi için.
 */
@Composable
private fun BosGun(modifier: Modifier = Modifier) {
    val renk = Sahne.renk
    Box(
        modifier
            .fillMaxWidth()
            .heightIn(min = 186.dp)
            .kesikCerceve(renk.soluk.copy(alpha = 0.6f), Sahne.olcu.levhaYaricapi.value),
    ) {
        Column(Modifier.align(Alignment.TopStart).fillMaxWidth(0.55f).padding(start = 18.dp, top = 18.dp)) {
            Metin("Boş bir gün.", stil = Sahne.yazi.levhaGenis)
            Metin("Eklediğin iş burada levha olur.", stil = Sahne.yazi.levhaAlt, renk = renk.soluk, modifier = Modifier.padding(top = 6.dp))
        }
        Box(
            Modifier
                .align(Alignment.CenterEnd)
                .padding(end = 16.dp, top = 18.dp, bottom = 18.dp)
                .heightIn(max = 150.dp)
                .fillMaxWidth(0.42f),
        ) {
            LevhaFiguru(Simgeler.Yildiz, Sahne.levha(LevhaRengi.KUM), 0f, Modifier.fillMaxWidth())
        }
    }
}
