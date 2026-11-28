package dev.eren.ajanda.ekran.sahne

import android.app.Activity
import android.os.Build
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.animation.core.Animatable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.eren.ajanda.ekran.sahne.ekranlar.AyrintiKaynagi
import dev.eren.ajanda.ekran.sahne.ekranlar.ayrintiRengi
import dev.eren.ajanda.ekran.sahne.veri.AyrintiOzeti
import dev.eren.ajanda.ekran.sahne.veri.BugunDeposu
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import dev.eren.ajanda.ekran.sahne.bilesen.SahneCubugu
import dev.eren.ajanda.ekran.sahne.ekranlar.AyarlarYerTutucu
import dev.eren.ajanda.ekran.sahne.ekranlar.AyrintiYerTutucu
import dev.eren.ajanda.ekran.sahne.ekranlar.BugunEkrani
import dev.eren.ajanda.ekran.sahne.ekranlar.BugunEylemleri
import dev.eren.ajanda.ekran.sahne.ekranlar.DuzenleYerTutucu
import dev.eren.ajanda.ekran.sahne.ekranlar.Ornekler
import dev.eren.ajanda.ekran.sahne.ekranlar.TakvimYerTutucu
import dev.eren.ajanda.ekran.sahne.ekranlar.TarihsizYerTutucu
import dev.eren.ajanda.ekran.sahne.gezinme.Gezgin
import dev.eren.ajanda.ekran.sahne.gezinme.Hedef
import dev.eren.ajanda.ekran.sahne.gezinme.SahneGezinme
import dev.eren.ajanda.ekran.sahne.gezinme.rememberGezgin
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import java.time.LocalDate

/**
 * Sahne arayüzünün kökü: gezinme, hedefler ve alt çubuk. Tema dışarıdan ([dev.eren.ajanda.ekran.sahne.tema.SahneTema]).
 * Çekirdeğe kendisi dokunmaz: Bugün'ün verisi [bugunDeposu]'ndan gelir (`null`: yer tutucu örnekler; iskelet
 * testleri). [bugun] dışarıdan gelir ki görüntüler günden güne değişmesin.
 *
 * - [acilis]: soğuk açılış; alt çubuk aşağıdan gelir (SAHNE.md §5.1).
 * - [acilacakKayit]: bildirimden gelen kayıt; ayrıntısı açılır, sonra [kayitAcildi] çağrılır.
 *
 * Sonraki dilimler öteki hedeflerin yer tutucularını gerçek ekranlarla değiştirir; gezinme ve çubuk aynı kalır.
 */
@Composable
fun SahneKok(
    bugun: LocalDate,
    modifier: Modifier = Modifier,
    gezgin: Gezgin = rememberGezgin(),
    bugunDeposu: BugunDeposu? = null,
    bugunEylemleri: BugunEylemleri = BugunEylemleri(),
    acilis: Boolean = false,
    acilacakKayit: String? = null,
    kayitAcildi: () -> Unit = {},
) {
    SistemCubuklari(gezgin.ust, bugunDeposu)
    LaunchedEffect(acilacakKayit) {
        if (acilacakKayit != null) {
            gezgin.ac(Hedef.Ayrinti(acilacakKayit))
            kayitAcildi()
        }
    }
    val hareketTemasi = Sahne.hareket
    // Alt çubuk açılışta 96 dp aşağıdan, 380 ms gecikmeyle yayla gelir (§5.1).
    val cubukGiris = remember { Animatable(if (acilis && hareketTemasi.uzamsal) 0f else 1f) }
    LaunchedEffect(Unit) {
        if (cubukGiris.value < 1f) {
            delay(380)
            cubukGiris.animateTo(1f, hareketTemasi.yay())
        }
    }
    val yogunluk = LocalDensity.current
    Box(modifier.fillMaxSize().background(Sahne.renk.zemin)) {
        SahneGezinme(
            gezgin,
            katmanUstu = { gecis ->
                val hareket = Sahne.hareket
                gecis.AnimatedVisibility(
                    visible = { it is Hedef.Sekme },
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .windowInsetsPadding(WindowInsets.navigationBars)
                        // Dar ekranda çubuk kenara değmesin ve ölçüsü belli olsun (iç öğeler bu genişliğe sığar).
                        .padding(start = Sahne.olcu.kenar, end = Sahne.olcu.kenar, bottom = Sahne.olcu.cubukAltPayi)
                        .graphicsLayer {
                            translationY = (1f - cubukGiris.value) * with(yogunluk) { 96.dp.toPx() }
                            alpha = cubukGiris.value.coerceIn(0f, 1f)
                        },
                    enter = fadeIn(hareket.solma(200)) + if (hareket.uzamsal) slideInVertically(hareket.yay()) { it * 2 } else fadeIn(hareket.solma()),
                    exit = fadeOut(hareket.solma(160)) + if (hareket.uzamsal) slideOutVertically(hareket.oturma()) { it * 2 } else fadeOut(hareket.solma()),
                ) {
                    SahneCubugu(
                        secili = gezgin.sekme,
                        onSekme = gezgin::sekmeSec,
                        onYeni = { gezgin.ac(Hedef.Duzenle(null)) },
                    )
                }
            },
        ) { h ->
            when (h) {
                Hedef.Sekme.BUGUN -> BugunEkrani(
                    bugunDeposu, bugun,
                    onKayit = { gezgin.ac(Hedef.Ayrinti(it)) },
                    onAyarlar = { gezgin.ac(Hedef.Ayarlar) },
                    eylemler = bugunEylemleri,
                )
                Hedef.Sekme.TAKVIM -> TakvimYerTutucu(bugun, onKayit = { gezgin.ac(Hedef.Ayrinti(it)) })
                Hedef.Sekme.TARIHSIZ -> TarihsizYerTutucu(onKayit = { gezgin.ac(Hedef.Ayrinti(it)) })
                is Hedef.Ayrinti -> {
                    val kapat = { gezgin.geri(); Unit }
                    AyrintiYerTutucu(h.kayitId, onKapat = kapat, kaynak = ayrintiKaynagi(bugunDeposu, h.kayitId, kapat))
                }
                is Hedef.Duzenle -> DuzenleYerTutucu(h.kayitId, onKapat = { gezgin.geri() })
                Hedef.Ayarlar -> AyarlarYerTutucu(onKapat = { gezgin.geri() })
            }
        }
    }
}

/**
 * Ayrıntının kaydı: Bugün modelinde varsa oradan (renk levhayla aynı: anahtardan ve komşu kuralından), yoksa
 * çekirdekten okunur. Depo yoksa ya da kimlik yer tutucu örneğiyse `null` (örnek gösterilir).
 */
@Composable
private fun ayrintiKaynagi(depo: BugunDeposu?, kayitId: String, onKapat: () -> Unit): AyrintiKaynagi? {
    if (depo == null) return null
    val model by depo.model.collectAsState()
    val modelde = model.ayrintiOzeti(kayitId)
    val ornek = Ornekler.bul(kayitId) != null
    var okunan by remember(kayitId) { mutableStateOf<AyrintiOzeti?>(null) }
    var okundu by remember(kayitId) { mutableStateOf(false) }
    val oku = modelde == null && !ornek
    LaunchedEffect(kayitId, oku) {
        if (oku) depo.kayitOku(kayitId) { okunan = it; okundu = true }
    }
    val ozet = modelde ?: okunan
    return when {
        ozet != null -> AyrintiKaynagi.Gercek(ozet) { tamam -> depo.tamamla(ozet.kayit, tamam); onKapat() }
        ornek -> null
        okundu -> AyrintiKaynagi.Bulunamadi
        else -> AyrintiKaynagi.Okunuyor
    }
}

/**
 * Durum ve gezinme çubuğu simgelerinin açık/koyu seçimi (SAHNE.md §1.3): zeminde temaya göre; ayrıntı ve
 * yeni kayıtta üst kenar renkli kapak olduğundan o takımın yazı rengine göre (ayrıntıda kapağın rengi:
 * [ayrintiRengi]).
 */
@Composable
private fun SistemCubuklari(ust: Hedef, depo: BugunDeposu?) {
    if (LocalInspectionMode.current) return
    val view = LocalView.current
    val pencere = (view.context as? Activity)?.window ?: return
    val koyuZemin = Sahne.renk.koyu
    val ustRengi = when (ust) {
        is Hedef.Ayrinti -> ayrintiRengi(ust.kayitId, ayrintiKaynagi(depo, ust.kayitId, onKapat = {}))
        is Hedef.Duzenle -> Ornekler.bul(ust.kayitId)?.renk ?: LevhaRengi.KUM
        else -> null
    }
    val ustYazi = ustRengi?.let { Sahne.levha(it).yazi }
    SideEffect {
        val denetci = WindowCompat.getInsetsController(pencere, view)
        // Açık görünüm = koyu simge. Kapak yazısı koyuysa (açık zemin) simgeler koyu olmalı.
        denetci.isAppearanceLightStatusBars = ustYazi?.let { it.luminance() < 0.5f } ?: !koyuZemin
        // API 26-28: gezinme çubuğu (3 tuş) sistemin perdesinde durur (SahneEtkinligi); simge rengi o perdeye
        // göre sistemde kalır, kapağa göre değiştirilirse koyu levha üstünde tuşlar kaybolur.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            denetci.isAppearanceLightNavigationBars = if (ust is Hedef.Duzenle) (ustYazi?.luminance() ?: 1f) < 0.5f else !koyuZemin
        }
    }
}
