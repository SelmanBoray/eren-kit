package dev.eren.ajanda.ekran.sahne.ekranlar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.sahne.bilesen.LevhaFiguru
import dev.eren.ajanda.ekran.sahne.bilesen.TamamlaDugmesi
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne

/**
 * Tarihsizler sekmesinin yer tutucusu: başlık ve tarihsiz satırlar (SAHNE.md §3.4), örnek verilerle.
 * Prototipte bu liste Bugün'ün altındaydı; sekme kararı SAHNE.md §12.1'de açık.
 */
@Composable
fun TarihsizYerTutucu(onKayit: (String) -> Unit, modifier: Modifier = Modifier) {
    var bitenler by rememberSaveable { mutableStateOf(emptySet<String>()) }
    val kayitlar = Ornekler.tarihsizler
    val acikSayisi = kayitlar.count { it.id !in bitenler }
    LazyColumn(
        modifier.fillMaxSize(),
        contentPadding = sayfaPayi(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item(key = "bas") {
            Column(Modifier.padding(start = 2.dp, end = 2.dp, top = 4.dp, bottom = 10.dp)) {
                Metin("Zamanı sonra belli olur", stil = Sahne.yazi.etiket, renk = Sahne.renk.soluk)
                Metin("Tarihsizler", stil = Sahne.yazi.gunBasligi, modifier = Modifier.padding(top = 8.dp).semantics { heading() })
                Metin(
                    if (acikSayisi == 0) "Tarihsiz iş yok." else "$acikSayisi iş bekliyor.",
                    stil = Sahne.yazi.govde, renk = Sahne.renk.soluk, modifier = Modifier.padding(top = 10.dp),
                )
            }
        }
        items(kayitlar, key = { it.id }) { k ->
            TarihsizSatir(
                k, tamam = k.id in bitenler,
                onAc = { onKayit(k.id) },
                onTamam = { bitenler = if (it) bitenler + k.id else bitenler - k.id },
                modifier = Modifier.animateItem(),
            )
        }
    }
}

/**
 * Tarihsiz satır (SAHNE.md §3.4): yüzey renginde, en az 60 dp; solda küçük çizim kutusu, ortada ad,
 * sağda tamamlama dairesi. Ada dokunmak ayrıntıyı açar, daire ayrı hedeftir.
 */
@Composable
fun TarihsizSatir(k: OrnekKayit, tamam: Boolean, onAc: () -> Unit, onTamam: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    val renk = Sahne.renk
    val takim = Sahne.levha(k.renk)
    Row(
        modifier
            .heightIn(min = 60.dp)
            .clip(Sahne.olcu.satir)
            .background(renk.yuz)
            .padding(start = 8.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(takim.zemin).padding(5.dp)) {
            LevhaFiguru(k.figur, takim, taslak = false, modifier = Modifier.fillMaxSize())
        }
        Box(
            Modifier
                .weight(1f)
                .heightIn(min = 60.dp)
                .clickable(role = Role.Button, onClickLabel = "Aç", onClick = onAc)
                .padding(horizontal = 8.dp, vertical = 8.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            Metin(
                k.baslik,
                stil = Sahne.yazi.satirAd.copy(textDecoration = if (tamam) TextDecoration.LineThrough else null),
                renk = if (tamam) renk.soluk else renk.murekkep,
            )
        }
        TamamlaDugmesi(tamam, k.baslik, onTamam, oyukRengi = renk.zemin, boyut = 42.dp, renk = renk.murekkep)
    }
}
