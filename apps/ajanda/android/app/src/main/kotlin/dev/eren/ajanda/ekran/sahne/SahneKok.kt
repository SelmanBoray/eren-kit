package dev.eren.ajanda.ekran.sahne

import android.app.Activity
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
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import dev.eren.ajanda.ekran.sahne.bilesen.SahneCubugu
import dev.eren.ajanda.ekran.sahne.ekranlar.AyarlarYerTutucu
import dev.eren.ajanda.ekran.sahne.ekranlar.AyrintiYerTutucu
import dev.eren.ajanda.ekran.sahne.ekranlar.BugunYerTutucu
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
 * Çekirdeğe dokunmaz; ekran görüntüsü testleri bunu doğrudan çizer. [bugun] dışarıdan gelir ki görüntüler
 * günden güne değişmesin.
 *
 * Sonraki dilimler hedeflerin yer tutucularını gerçek ekranlarla değiştirir; gezinme ve çubuk aynı kalır.
 */
@Composable
fun SahneKok(
    bugun: LocalDate,
    modifier: Modifier = Modifier,
    gezgin: Gezgin = rememberGezgin(),
) {
    SistemCubuklari(gezgin.ust)
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
                        .padding(bottom = Sahne.olcu.cubukAltPayi),
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
                Hedef.Sekme.BUGUN -> BugunYerTutucu(bugun, onKayit = { gezgin.ac(Hedef.Ayrinti(it)) }, onAyarlar = { gezgin.ac(Hedef.Ayarlar) })
                Hedef.Sekme.TAKVIM -> TakvimYerTutucu(bugun, onKayit = { gezgin.ac(Hedef.Ayrinti(it)) })
                Hedef.Sekme.TARIHSIZ -> TarihsizYerTutucu(onKayit = { gezgin.ac(Hedef.Ayrinti(it)) })
                is Hedef.Ayrinti -> AyrintiYerTutucu(h.kayitId, onKapat = { gezgin.geri() })
                is Hedef.Duzenle -> DuzenleYerTutucu(h.kayitId, onKapat = { gezgin.geri() })
                Hedef.Ayarlar -> AyarlarYerTutucu(onKapat = { gezgin.geri() })
            }
        }
    }
}

/**
 * Durum ve gezinme çubuğu simgelerinin açık/koyu seçimi (SAHNE.md §1.3): zeminde temaya göre; ayrıntı ve
 * yeni kayıtta üst kenar renkli kapak olduğundan o takımın yazı rengine göre.
 */
@Composable
private fun SistemCubuklari(ust: Hedef) {
    if (LocalInspectionMode.current) return
    val view = LocalView.current
    val pencere = (view.context as? Activity)?.window ?: return
    val koyuZemin = Sahne.renk.koyu
    val ustRengi = when (ust) {
        is Hedef.Ayrinti -> Ornekler.bul(ust.kayitId)?.renk ?: LevhaRengi.KUM
        is Hedef.Duzenle -> Ornekler.bul(ust.kayitId)?.renk ?: LevhaRengi.KUM
        else -> null
    }
    val ustYazi = ustRengi?.let { Sahne.levha(it).yazi }
    SideEffect {
        val denetci = WindowCompat.getInsetsController(pencere, view)
        // Açık görünüm = koyu simge. Kapak yazısı koyuysa (açık zemin) simgeler koyu olmalı.
        denetci.isAppearanceLightStatusBars = ustYazi?.let { it.luminance() < 0.5f } ?: !koyuZemin
        denetci.isAppearanceLightNavigationBars = if (ust is Hedef.Duzenle) (ustYazi?.luminance() ?: 1f) < 0.5f else !koyuZemin
    }
}
