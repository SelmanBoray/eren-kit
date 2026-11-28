package dev.eren.ajanda.ekran.sahne.bilesen

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne

/** Durumun tonu: rengi yalnız noktada taşınır; anlam metindedir. */
enum class DurumTonu { IYI, SURUYOR, CEVRIMDISI, UYARI }

@Composable
private fun tonRengi(t: DurumTonu): Color = when (t) {
    DurumTonu.IYI -> Sahne.levha(LevhaRengi.CAM).zemin
    DurumTonu.SURUYOR, DurumTonu.CEVRIMDISI -> Sahne.renk.soluk
    DurumTonu.UYARI -> Sahne.levha(LevhaRengi.DOMATES).zemin
}

@Composable
private fun DurumNoktasi(t: DurumTonu, modifier: Modifier = Modifier) {
    val r = tonRengi(t)
    Box(
        modifier
            .size(9.dp)
            .clip(CircleShape)
            .then(if (t == DurumTonu.CEVRIMDISI) Modifier.border(2.dp, r, CircleShape) else Modifier.background(r)),
    )
}

/**
 * PC bağlantı göstergesi (eski ana ekranın üst çubuğundaki): nokta + kısa metin ("Bağlı", "Çevrimdışı · 2
 * bekliyor"). Dokununca ayrıntı penceresi. Görünür boy 36 dp, dokunma alanı 48 dp.
 */
@Composable
fun GostergeHapi(kisa: String, ton: DurumTonu, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .heightIn(min = Sahne.olcu.dokunma)
            .clip(Sahne.olcu.hap)
            .clickable(role = Role.Button, onClickLabel = "Ayrıntı", onClick = onClick)
            .semantics(mergeDescendants = true) { contentDescription = "PC bağlantısı: $kisa" },
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier
                .heightIn(min = 36.dp)
                .widthIn(max = 200.dp)
                .clip(Sahne.olcu.hap)
                .background(Sahne.renk.yuz)
                .padding(start = 12.dp, end = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            DurumNoktasi(ton)
            Metin(
                kisa, stil = Sahne.yazi.kucuk.copy(fontWeight = FontWeight.Medium),
                renk = Sahne.renk.murekkep, satirSiniri = 1,
                modifier = Modifier.clearAndSetSemantics {},
            )
        }
    }
}

/**
 * Durum şeridi (eşleşme yok, hatırlatma sorunu, gönderilemeyenler): yüzey zemininde satır; solda ton
 * noktası, metin, sağda çerçeveli düğme. Metne dokunmak [onGovde] (varsa) yapar.
 */
@Composable
fun DurumSeridi(
    metin: String,
    dugme: String,
    ton: DurumTonu,
    onDugme: () -> Unit,
    modifier: Modifier = Modifier,
    onGovde: (() -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(Sahne.olcu.satir)
            .background(Sahne.renk.yuz)
            .then(if (onGovde != null) Modifier.clickable(onClickLabel = "Ayrıntı", onClick = onGovde) else Modifier)
            .padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        DurumNoktasi(ton)
        Metin(metin, stil = Sahne.yazi.etiket, renk = Sahne.renk.murekkep, modifier = Modifier.weight(1f).padding(vertical = 8.dp))
        HapDugme(dugme, onClick = onDugme, dolu = false, onayDugmesi = true, modifier = Modifier.semantics { contentDescription = "$dugme: $metin" })
    }
}

/**
 * Sahne'nin penceresi: ortada, zemin renginde büyük yarıçaplı kart; başlık, kaydırılabilir gövde ve
 * altta düğmeler. Dışına dokunmak ya da geri kapatır.
 */
@Composable
fun SahnePenceresi(
    baslik: String,
    onKapat: () -> Unit,
    dugmeler: @Composable () -> Unit,
    govde: @Composable ColumnScope.() -> Unit,
) {
    Dialog(onDismissRequest = onKapat) {
        Column(
            Modifier
                .widthIn(max = 520.dp)
                .clip(Sahne.olcu.levha)
                .background(Sahne.renk.zemin)
                .padding(start = 22.dp, end = 22.dp, top = 22.dp, bottom = 12.dp),
        ) {
            Metin(baslik, stil = Sahne.yazi.takvimGun, modifier = Modifier.semantics { heading() })
            Column(
                Modifier
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState())
                    .padding(top = 10.dp, bottom = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                content = govde,
            )
            Row(Modifier.align(Alignment.End), horizontalArrangement = Arrangement.spacedBy(6.dp)) { dugmeler() }
        }
    }
}
