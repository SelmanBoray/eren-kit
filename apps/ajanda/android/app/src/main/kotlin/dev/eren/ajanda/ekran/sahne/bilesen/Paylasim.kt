package dev.eren.ajanda.ekran.sahne.bilesen

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalAccessibilityManager
import dev.eren.ajanda.ekran.sahne.gezinme.Hedef
import dev.eren.ajanda.ekran.sahne.gezinme.LocalHedefKapsami
import dev.eren.ajanda.ekran.sahne.gezinme.paylasilanLevha
import dev.eren.ajanda.ekran.sahne.veri.TostKanali
import dev.eren.ajanda.ekran.sahne.veri.TostIstegi

/**
 * Ayrıntı kapağıyla paylaşılan öğe ([paylasilanLevha]) ama **sekmeden sekmeye geçişte değil**: aynı kayıt hem
 * Bugün'de hem Takvim'de (bugün seçiliyken) ya da Tarihsizler'de çizilebilir; iki sekme geçerken aynı anahtarlı iki
 * öğe birbirine dönüşürdü. Bu ekranlar paylaşımı yalnız sekmeleri dururken ya da bir katman (ayrıntı) açılıp
 * kapanırken açar; levha ayrıntıya yine büyür, ayrıntıdan yine ona döner.
 */
@Composable
fun Modifier.ayrintiyaBagli(kayitId: String, sekil: Shape): Modifier {
    val gecis = LocalHedefKapsami.current?.transition?.parentTransition
    val sekmeGecisi = gecis != null && gecis.currentState != gecis.targetState &&
        gecis.currentState is Hedef.Sekme && gecis.targetState is Hedef.Sekme
    return if (sekmeGecisi) this else paylasilanLevha(kayitId, sekil)
}

/**
 * Ortak tost kanalını ([TostKanali]) ekranın [TostDurumu]'na bağlar: yeni tost kanalın verdiği süreyle gösterilir,
 * ekran yeniden kurulunca (sekme değişti, ayrıntıdan dönüldü) kalan süresiyle döner, "Geri al" tostu çıkaran
 * depoya gider (bir kez).
 */
@Composable
fun TostKanaliniBagla(kanal: TostKanali, durum: TostDurumu, yedekGeriAl: (TostIstegi) -> Unit = {}) {
    val istek by kanal.tost.collectAsState()
    val erisim = LocalAccessibilityManager.current
    LaunchedEffect(istek) {
        val t = istek ?: return@LaunchedEffect
        val g = t.geriAlma
        val sure = kanal.tostSuresi(t.no) { TostDurumu.sure(g != null, erisim) } ?: return@LaunchedEffect
        durum.goster(
            t.mesaj, eylem = if (g != null) "Geri al" else null, hata = t.hata, sure = sure,
            onKalan = { kanal.tostKalani(t.no, it) },
        ) { kanal.tostuGeriAl(t) { yedekGeriAl(t) } }
    }
}
