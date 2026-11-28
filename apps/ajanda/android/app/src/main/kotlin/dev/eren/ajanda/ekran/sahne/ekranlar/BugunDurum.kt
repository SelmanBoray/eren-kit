package dev.eren.ajanda.ekran.sahne.ekranlar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.DurumGostergesi
import dev.eren.ajanda.ekran.RetListesi
import dev.eren.ajanda.ekran.sahne.bilesen.HapDugme
import dev.eren.ajanda.ekran.sahne.bilesen.SahnePenceresi
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.veri.BugunDeposu
import dev.eren.ajanda.ekran.sahne.veri.BugunModeli
import java.util.Locale

/**
 * Durum penceresi (PC göstergesine ya da bir şeride dokununca): eski ana ekranın bağlantı penceresi,
 * "Hatırlatma durumu" penceresi ve "Gönderilemeyenler" görünümü tek yerde. Her sorunun yanında çözüm düğmesi.
 */
@Composable
internal fun BugunDurumPenceresi(model: BugunModeli, depo: BugunDeposu?, eylemler: BugunEylemleri, onKapat: () -> Unit) {
    val d = model.durum
    val g = d.gosterge
    var atilacak by rememberSaveable { mutableStateOf<String?>(null) }
    SahnePenceresi(
        baslik = "PC bağlantısı: ${g.kisa}",
        onKapat = onKapat,
        dugmeler = {
            HapDugme(
                if (g.eylem == DurumGostergesi.Eylem.ESLESTIR) "Eşleştir" else "Eşleştirme",
                onClick = { onKapat(); eylemler.eslestir() },
                dolu = false, onayDugmesi = true,
            )
            HapDugme("Kapat", onClick = onKapat, onayDugmesi = true)
        },
    ) {
        Metin(g.ayrinti, stil = Sahne.yazi.govde, renk = Sahne.renk.soluk)

        AltBaslik("Hatırlatmalar")
        if (d.hatirlatma.isEmpty()) {
            Metin(
                "Hatırlatmaları engelleyen bir sorun görünmüyor. Hatırlatmalar PC kapalıyken de bu telefonda çalar.",
                stil = Sahne.yazi.govde, renk = Sahne.renk.soluk,
            )
        }
        for (u in d.hatirlatma) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Metin(
                    u.baslik, stil = Sahne.yazi.etiket.copy(fontWeight = FontWeight.SemiBold),
                    renk = if (u.engel) Sahne.levha(LevhaRengi.DOMATES).zemin.takeIf { !Sahne.renk.koyu } ?: Sahne.renk.murekkep else Sahne.renk.murekkep,
                )
                Metin(u.aciklama, stil = Sahne.yazi.govde, renk = Sahne.renk.soluk)
                HapDugme(u.dugme, onClick = { onKapat(); eylemler.hatirlatmaCoz(u) }, dolu = false, onayDugmesi = true)
            }
        }

        if (d.retler.isNotEmpty()) {
            AltBaslik("Gönderilemeyenler")
            Metin(
                "PC bu değişiklikleri kalıcı olarak reddetti. Düzeltip yeniden ekleyebilir ya da atabilirsin.",
                stil = Sahne.yazi.govde, renk = Sahne.renk.soluk,
            )
            for (r in d.retler) RetSatiri(r, onDuzelt = { onKapat(); eylemler.retDuzelt(r.islemId) }, onAt = { atilacak = r.islemId })
        }
    }

    val at = atilacak
    val r = d.retler.firstOrNull { it.islemId == at }
    if (r != null) {
        SahnePenceresi(
            baslik = "Değişiklik atılsın mı?",
            onKapat = { atilacak = null },
            dugmeler = {
                HapDugme("Vazgeç", onClick = { atilacak = null }, dolu = false, onayDugmesi = true)
                HapDugme("At", onClick = { atilacak = null; depo?.retAt(r.islemId) }, onayDugmesi = true)
            },
        ) {
            Metin(
                "“${r.baslik}” için gönderilemeyen ${r.islemMetni.lowercase(Locale.forLanguageTag("tr"))} kalıcı olarak atılır.",
                stil = Sahne.yazi.govde,
            )
        }
    }
}

@Composable
private fun AltBaslik(s: String) {
    Metin(
        s, stil = Sahne.yazi.etiket.copy(fontWeight = FontWeight.SemiBold), renk = Sahne.renk.murekkep,
        modifier = Modifier.padding(top = 10.dp).semantics { heading() },
    )
}

@Composable
private fun RetSatiri(r: RetListesi.RetSatiri, onDuzelt: () -> Unit, onAt: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Metin(r.baslik, stil = Sahne.yazi.etiket.copy(fontWeight = FontWeight.SemiBold))
        Metin("${r.islemMetni} gönderilemedi · ${r.zaman}", stil = Sahne.yazi.kucuk, renk = Sahne.renk.soluk)
        Metin(r.neden, stil = Sahne.yazi.govde, renk = Sahne.renk.soluk)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (r.duzeltilebilir) HapDugme("Düzelt", onClick = onDuzelt, dolu = false, onayDugmesi = true)
            HapDugme("At", onClick = onAt, dolu = false, onayDugmesi = true)
        }
    }
}
