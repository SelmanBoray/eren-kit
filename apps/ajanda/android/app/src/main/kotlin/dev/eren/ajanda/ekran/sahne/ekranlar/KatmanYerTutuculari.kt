package dev.eren.ajanda.ekran.sahne.ekranlar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.R
import dev.eren.ajanda.ekran.sahne.bilesen.AraBaslik
import dev.eren.ajanda.ekran.sahne.bilesen.HapDugme
import dev.eren.ajanda.ekran.sahne.bilesen.LevhaCizimi
import dev.eren.ajanda.ekran.sahne.bilesen.LevhaFiguru
import dev.eren.ajanda.ekran.sahne.bilesen.cizimYuvasiOnbellekli
import dev.eren.ajanda.ekran.sahne.veri.AyrintiOzeti
import dev.eren.ajanda.ekran.sahne.veri.LevhaHali
import dev.eren.ajanda.ekran.sahne.bilesen.YuvarlakDugme
import dev.eren.ajanda.ekran.sahne.gezinme.paylasilanLevha
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.tema.Simge
import dev.eren.ajanda.ekran.sahne.tema.Simgeler
import dev.eren.ajanda.ekran.sahne.tema.YaziRengi

/**
 * Ayrıntı yer tutucusunun kaynağı. Gerçek ekran sonraki dilimde; bu dilimde yer tutucu gerçek kaydı gösterir
 * ve yanıltıcı eylem taşımaz.
 */
sealed interface AyrintiKaynagi {
    /** Gerçek kayıt (Bugün modelinden ya da çekirdekten). [onTamamla] varsa alt düğme kaydı gerçekten tamamlar/açar. */
    data class Gercek(val ozet: AyrintiOzeti, val onTamamla: ((Boolean) -> Unit)?) : AyrintiKaynagi

    /** Kayıt çekirdekten okunuyor. */
    data object Okunuyor : AyrintiKaynagi

    /** Kayıt yok (silindi ya da kimlik bilinmiyor). */
    data object Bulunamadi : AyrintiKaynagi
}

/** Ayrıntı kapağının ve sistem çubuklarının rengi: gerçek kayıtta levhanın rengi (komşu kuralı dahil), örnekte örneğin. */
internal fun ayrintiRengi(kayitId: String, kaynak: AyrintiKaynagi?): LevhaRengi =
    (kaynak as? AyrintiKaynagi.Gercek)?.ozet?.kayit?.renk ?: Ornekler.bul(kayitId)?.renk ?: LevhaRengi.KUM

/**
 * Kayıt ayrıntısının yer tutucusu (SAHNE.md §3.7): renkli kapak, kapat düğmesi, başlık, zaman ve sabit alt
 * düğme. Kapak, Bugün'deki levhayla aynı paylaşılan öğe anahtarını taşır: levhadan büyüyerek açılır.
 *
 * [kaynak] `null`: kimlik yer tutucu örneklerinden ([Ornekler]; takvim ve tarihsiz yer tutucuları, vitrin);
 * örnekte alt düğme yok (değiştirecek kayıt yok). Gerçek kayıtta başlık, zaman, renk ve çizim kaydın kendisi;
 * alt düğme "Bitti" (bitmişse "Yeniden aç") kaydı çekirdekte değiştirir ve ayrıntıyı kapatır (tost Bugün'de).
 */
@Composable
fun AyrintiYerTutucu(kayitId: String, onKapat: () -> Unit, modifier: Modifier = Modifier, kaynak: AyrintiKaynagi? = null) {
    val gercek = kaynak as? AyrintiKaynagi.Gercek
    val g = gercek?.ozet?.kayit
    val k = if (kaynak == null) Ornekler.bul(kayitId) else null
    val takim = Sahne.levha(ayrintiRengi(kayitId, kaynak))
    val kapakSekli = RoundedCornerShape(bottomStart = Sahne.olcu.kapakYaricapi, bottomEnd = Sahne.olcu.kapakYaricapi)
    val baslik = when {
        g != null -> g.baslik
        k != null -> k.baslik
        kaynak == AyrintiKaynagi.Okunuyor -> "Kayıt okunuyor…"
        else -> "Kayıt bulunamadı."
    }
    val zamanSatiri = when {
        g != null -> listOfNotNull(gercek?.ozet?.yer, g.zaman).joinToString(", ") + if (g.hal == LevhaHali.TASLAK) ", asistan önerdi" else ""
        k != null -> listOfNotNull(if (k.tarihsiz) "Tarihsiz" else "Bugün", k.zaman).joinToString(", ") + if (k.taslak) ", asistan önerdi" else ""
        else -> ""
    }
    val onTamamla = gercek?.onTamamla?.takeIf { g != null && g.tamamlanabilir && g.hal != LevhaHali.TASLAK }
    // Bir kez: kapanış hareketi sürerken ikinci dokunuş ikinci kez değiştirmez.
    var gonderildi by remember(kayitId) { mutableStateOf(false) }
    BoxWithConstraints(modifier.fillMaxSize().background(Sahne.renk.zemin)) {
        val kapakBoyu = maxOf(260.dp, maxHeight * 0.46f)
        val genislik = maxWidth
        val yon = LocalLayoutDirection.current
        // Yanlarda kenar payı ya da güvenli alan (yatay çentik, yan gezinme çubuğu), hangisi büyükse.
        val pay = sayfaPayi()
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(kapakBoyu)
                    .paylasilanLevha(kayitId, kapakSekli)
                    .clip(kapakSekli)
                    .background(takim.zemin),
            ) {
                val cizimPayi = Modifier.fillMaxSize().padding(top = kapakBoyu * 0.16f, bottom = kapakBoyu * 0.08f, start = genislik * 0.10f, end = genislik * 0.10f)
                if (g != null) {
                    val yuva = cizimYuvasiOnbellekli(g.cizim)
                    Box(cizimPayi) { yuva(LevhaCizimi(takim, if (g.hal == LevhaHali.TASLAK) 0f else 1f, canli = false)) }
                } else if (k != null) {
                    LevhaFiguru(k.figur, takim, taslak = false, modifier = cizimPayi)
                }
            }
            Column(
                Modifier.padding(start = pay.calculateStartPadding(yon), end = pay.calculateEndPadding(yon), top = 22.dp, bottom = 110.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                Column {
                    Metin(baslik, stil = Sahne.yazi.ayrintiBasligi, modifier = Modifier.semantics { heading() })
                    if (zamanSatiri.isNotEmpty()) {
                        Metin(zamanSatiri, stil = Sahne.yazi.zaman, renk = Sahne.renk.soluk, modifier = Modifier.padding(top = 8.dp))
                    }
                }
                Column {
                    AraBaslik("Not", modifier = Modifier.padding(top = 0.dp))
                    Metin(
                        "Ayrıntı ekranı sonraki dilimde yazılacak: not, fotoğraflar, bağlantılar ve hatırlatmalar " +
                            "burada sırayla aşağıdan gelecek.",
                        stil = Sahne.yazi.govdeBuyuk,
                    )
                }
            }
        }
        YuvarlakDugme(
            Simgeler.Asagi, aciklama = "Kapat", onClick = onKapat,
            zemin = Sahne.renk.zemin, renk = Sahne.renk.murekkep,
            modifier = Modifier.padding(koseDugmesiPayi(sag = false)),
        )
        if (g != null && onTamamla != null) {
            // Alt düğme ve arkasındaki zemine geçen degrade (SAHNE.md §3.7).
            val bitti = g.hal == LevhaHali.BITTI
            val zemin = Sahne.renk.zemin
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .drawBehind {
                        drawRect(Brush.verticalGradient(0f to Color.Transparent, 0.34f to zemin, 1f to zemin))
                    }
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom))
                    .padding(start = pay.calculateStartPadding(yon), end = pay.calculateEndPadding(yon), top = 26.dp, bottom = 14.dp),
            ) {
                val dolu = !bitti
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 56.dp)
                        .clip(Sahne.olcu.hap)
                        .background(if (dolu) Sahne.renk.murekkep else Sahne.renk.yuz)
                        .clickable(enabled = !gonderildi, role = Role.Button) {
                            gonderildi = true
                            onTamamla(!bitti)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Metin(
                        if (bitti) "Yeniden aç" else "Bitti",
                        stil = Sahne.yazi.dugmeBuyuk,
                        renk = if (dolu) Sahne.renk.zemin else Sahne.renk.murekkep,
                    )
                }
            }
        }
    }
}

/**
 * Yeni kayıt ve düzenleme ekranının yer tutucusu (SAHNE.md §3.8): takım renginde tam ekran, çizim alanı,
 * başlık alanı ve örnek hap'lar. Bu dilimde kaydetmez; form sonraki dilimde `KayitFormu`'na bağlanır.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DuzenleYerTutucu(kayitId: String?, onKapat: () -> Unit, modifier: Modifier = Modifier) {
    val k = Ornekler.bul(kayitId)
    val renk = k?.renk ?: LevhaRengi.KUM
    val takim = Sahne.levha(renk)
    var baslik by rememberSaveable { mutableStateOf(k?.baslik.orEmpty()) }
    YaziRengi(takim.yazi) {
        BoxWithConstraints(modifier.fillMaxSize().background(takim.zemin)) {
            val ekranBoyu = maxHeight
            val yanPay = maxWidth * 0.16f
            val yon = LocalLayoutDirection.current
            val pay = sayfaPayi()
            Column(
                Modifier
                    .fillMaxSize()
                    .imePadding()
                    .verticalScroll(rememberScrollState())
                    // Kaydırılabilir sütunda ağırlık, en az yüksekliğe göre dağıtılır: çizim alanı kalan boşluğu doldurur.
                    .heightIn(min = ekranBoyu)
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top)),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .heightIn(min = 170.dp)
                        .padding(top = 60.dp, bottom = 6.dp, start = yanPay, end = yanPay),
                ) {
                    LevhaFiguru(k?.figur ?: Simgeler.Yildiz, takim, taslak = false, modifier = Modifier.fillMaxSize())
                }
                Column(
                    Modifier
                        .padding(start = pay.calculateStartPadding(yon), end = pay.calculateEndPadding(yon), top = 8.dp, bottom = 18.dp)
                        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom)),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Metin(
                        if (kayitId == null) "Ne yapacaksın?" else "Başlık",
                        stil = Sahne.yazi.etiket.copy(fontWeight = FontWeight.SemiBold),
                        modifier = Modifier.alpha(0.85f).semantics { heading() },
                    )
                    val yaziRengi = takim.yazi
                    BasicTextField(
                        value = baslik,
                        onValueChange = { baslik = it },
                        singleLine = true,
                        textStyle = Sahne.yazi.yeniGiris.copy(color = yaziRengi),
                        cursorBrush = SolidColor(yaziRengi),
                        modifier = Modifier
                            .fillMaxWidth()
                            .drawBehind {
                                val k3 = 3.dp.toPx()
                                drawLine(yaziRengi, Offset(0f, size.height - k3 / 2), Offset(size.width, size.height - k3 / 2), k3)
                            }
                            .padding(top = 2.dp, bottom = 8.dp),
                        decorationBox = { alan ->
                            Box {
                                if (baslik.isEmpty()) {
                                    Metin("Yaz ya da aşağıdan seç", stil = Sahne.yazi.yeniGiris, modifier = Modifier.alpha(0.45f), satirSiniri = 1)
                                }
                                alan()
                            }
                        },
                    )
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (o in listOf("Araba yıkama", "Dişçi", "Market", "Kargo", "Kahvaltı")) {
                            HapDugme(o, onClick = { baslik = o }, dolu = false, onayDugmesi = true)
                        }
                    }
                    Metin(
                        "Yer tutucu: bu ekran henüz kaydetmiyor.",
                        stil = Sahne.yazi.etiket, modifier = Modifier.alpha(0.85f),
                    )
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 58.dp)
                            .clip(Sahne.olcu.hap)
                            .background(takim.yazi)
                            .clickable(role = Role.Button, onClick = onKapat),
                        contentAlignment = Alignment.Center,
                    ) {
                        Metin(if (kayitId == null) "Ekle" else "Kaydet", stil = Sahne.yazi.dugmeBuyuk.copy(fontSize = Sahne.yazi.kartBaslik.fontSize), renk = takim.zemin)
                    }
                }
            }
            YuvarlakDugme(
                Simgeler.Kapat, aciklama = "Vazgeç", onClick = onKapat,
                zemin = Color.Transparent, renk = takim.yazi, cerceve = true,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(koseDugmesiPayi(sag = true)),
            )
        }
    }
}

/**
 * Ayarlar yer tutucusu: başlık ve satırlar. "Açık kaynak lisansları" APK'ya giren bütün açık kaynak
 * bileşenlerin listesini ve lisans metinlerini gösterir ([LISANS_METINLERI]; Play Store için lisansların
 * uygulamada görünmesi; SAHNE.md / LISANSLAR.md).
 */
@Composable
fun AyarlarYerTutucu(onKapat: () -> Unit, modifier: Modifier = Modifier) {
    var lisans by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    val metinler = remember(lisans) {
        if (!lisans) emptyList()
        else LISANS_METINLERI.map { id -> context.resources.openRawResource(id).bufferedReader().use { it.readText() } }
    }
    Box(modifier.fillMaxSize().background(Sahne.renk.zemin)) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(sayfaPayi(ust = 76.dp, alt = 40.dp)),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Metin("Ayarlar", stil = Sahne.yazi.ayrintiBasligi, modifier = Modifier.padding(start = 2.dp, bottom = 14.dp).semantics { heading() })
            AyarSatiri("Eşleştirme", "Bilgisayarla bağlantı", onClick = {})
            AyarSatiri("Bildirimler", "Hatırlatmalar ve izinler", onClick = {})
            AyarSatiri("Açık kaynak lisansları", "Kullanılan kitaplıklar ve yazı tipi", onClick = { lisans = !lisans })
            for (metin in metinler) {
                Metin(metin, stil = Sahne.yazi.kucuk, renk = Sahne.renk.soluk, modifier = Modifier.padding(horizontal = 2.dp, vertical = 8.dp))
            }
        }
        YuvarlakDugme(
            Simgeler.Geri, aciklama = "Geri", onClick = onKapat,
            modifier = Modifier.padding(koseDugmesiPayi(sag = false)),
        )
    }
}

/**
 * Lisans ekranının metinleri, sırayla: bileşen listesi (hangi bileşen hangi lisansla), sonra lisans metinleri.
 * Liste APK'nın bağımlılık ağaçlarından üretildi (Gradle releaseRuntimeClasspath, Rust çekirdeği için
 * `cargo tree -e normal,no-proc-macro`); bağımlılık eklenince ya da sürüm değişince yeniden üretilmeli.
 */
internal val LISANS_METINLERI = listOf(
    R.raw.acik_kaynak_bilesenleri,
    R.raw.lisans_apache_2_0,
    R.raw.lisans_mpl_2_0,
    R.raw.lisans_mit_zlib,
    R.raw.ofl_bricolage_grotesque,
)

/**
 * Üst köşedeki yuvarlak düğmenin payı: yanda sayfa içeriğiyle aynı hizada (kenar payı ya da güvenli alan,
 * hangisi büyükse; yatay çentikte düğme çentiğin altında kalmaz), üstte güvenli alanın 12 dp altında.
 */
@Composable
private fun koseDugmesiPayi(sag: Boolean): PaddingValues {
    val pay = sayfaPayi(ust = 12.dp, alt = 0.dp)
    val yon = LocalLayoutDirection.current
    return if (sag) {
        PaddingValues(end = pay.calculateEndPadding(yon), top = pay.calculateTopPadding())
    } else {
        PaddingValues(start = pay.calculateStartPadding(yon), top = pay.calculateTopPadding())
    }
}

@Composable
private fun AyarSatiri(ad: String, aciklama: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .clip(Sahne.olcu.satir)
            .background(Sahne.renk.yuz)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Metin(ad, stil = Sahne.yazi.satirAd)
            Metin(aciklama, stil = Sahne.yazi.etiket, renk = Sahne.renk.soluk)
        }
        Simge(Simgeler.Ileri, aciklama = null, modifier = Modifier.padding(start = 8.dp).height(20.dp), renk = Sahne.renk.soluk)
    }
}

