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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.sahne.bilesen.AraBaslik
import dev.eren.ajanda.ekran.sahne.bilesen.HapDugme
import dev.eren.ajanda.ekran.sahne.bilesen.Levha
import dev.eren.ajanda.ekran.sahne.bilesen.LevhaBoyu
import dev.eren.ajanda.ekran.sahne.bilesen.TamamlaDugmesi
import dev.eren.ajanda.ekran.sahne.bilesen.YuvarlakDugme
import dev.eren.ajanda.ekran.sahne.tema.Agirlik
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.tema.Simge
import dev.eren.ajanda.ekran.sahne.tema.Simgeler
import java.time.LocalDate

/**
 * Bugün sekmesinin yer tutucusu: başlık, mozaik ve bitenler, örnek verilerle (SAHNE.md §3.2).
 * Gerçek ekran sonraki dilimde; burada yerleşim, levha biçimleri ve paylaşılan öğe bağı sınanır.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BugunYerTutucu(
    bugun: LocalDate,
    onKayit: (String) -> Unit,
    onAyarlar: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var bitenler by rememberSaveable { mutableStateOf(Ornekler.bugun.filter { it.bitti }.map { it.id }.toSet()) }
    val kayitlar = Ornekler.bugun
    val acik = kayitlar.filter { !it.taslak && it.id !in bitenler }
    val taslaklar = kayitlar.filter { it.taslak }
    val biten = kayitlar.filter { it.id in bitenler }
    val sira = acik.firstOrNull()
    val digerleri = acik.drop(1)
    // SAHNE.md §10.2: yazı ölçeği 1.5 ve üstünde mozaik tek sütun.
    val tekSutun = LocalDensity.current.fontScale >= 1.5f
    val aralik = Sahne.olcu.aralik

    LazyColumn(
        modifier.fillMaxSize(),
        state = rememberLazyListState(),
        contentPadding = sayfaPayi(),
        verticalArrangement = Arrangement.spacedBy(aralik),
    ) {
        item(key = "bas") {
            Row(Modifier.padding(start = 2.dp, end = 2.dp, top = 4.dp, bottom = 8.dp)) {
                Column(Modifier.weight(1f)) {
                    Metin(uzunTarih(bugun), stil = Sahne.yazi.etiket, renk = Sahne.renk.soluk)
                    Metin(
                        if (sira != null) "Sırada ${sira.baslik.kucukTr()} var." else "Bugünlük bu kadar.",
                        stil = Sahne.yazi.gunBasligi,
                        modifier = Modifier.padding(top = 8.dp).semantics { heading() },
                    )
                    Metin(
                        if (sira != null) "Bugün, ${sira.zaman}" else "${biten.size} iş bitti.",
                        stil = Sahne.yazi.govde, renk = Sahne.renk.soluk,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
                YuvarlakDugme(Simgeler.Ayar, aciklama = "Ayarlar", onClick = onAyarlar, modifier = Modifier.padding(start = 8.dp))
            }
        }
        if (sira != null) {
            item(key = sira.id) {
                Levha(
                    baslik = sira.baslik, altSatir = "Bugün, ${sira.zaman}", renk = sira.renk, boy = LevhaBoyu.BUYUK,
                    figur = sira.figur, onAc = { onKayit(sira.id) }, kayitId = sira.id,
                    kose = { TamamlaDugmesi(false, sira.baslik, { bitenler = bitenler + sira.id }, oyukRengi = Sahne.levha(sira.renk).zemin) },
                    modifier = Modifier.animateItem(),
                )
            }
        }
        val ciftler = if (tekSutun) digerleri.map { listOf(it) } else digerleri.chunked(2)
        for (cift in ciftler) {
            item(key = cift.joinToString { it.id }) {
                Row(Modifier.animateItem(), horizontalArrangement = Arrangement.spacedBy(aralik)) {
                    for (k in cift) {
                        val boy = if (cift.size == 1) LevhaBoyu.GENIS else LevhaBoyu.KARE
                        Levha(
                            baslik = k.baslik, altSatir = k.zaman, renk = k.renk, boy = boy, figur = k.figur,
                            onAc = { onKayit(k.id) }, kayitId = k.id,
                            kose = {
                                TamamlaDugmesi(
                                    false, k.baslik, { bitenler = bitenler + k.id },
                                    oyukRengi = Sahne.levha(k.renk).zemin,
                                    boyut = if (boy == LevhaBoyu.KARE) 42.dp else 46.dp,
                                )
                            },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
        for (t in taslaklar) {
            item(key = t.id) {
                Levha(
                    baslik = t.baslik, altSatir = "Asistan önerdi, ${t.zaman}", renk = t.renk, boy = LevhaBoyu.GENIS,
                    figur = t.figur, onAc = { onKayit(t.id) }, kayitId = t.id, taslak = true,
                    kose = {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            HapDugme("Onayla", onClick = {}, onayDugmesi = true)
                            HapDugme("Vazgeç", onClick = {}, dolu = false, onayDugmesi = true)
                        }
                    },
                    modifier = Modifier.animateItem(),
                )
            }
        }
        if (biten.isNotEmpty()) {
            item(key = "bitenler-baslik") { AraBaslik("Bitenler") }
            item(key = "bitenler") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (k in biten) BitenHapi(k.baslik, k, onAc = { onKayit(k.id) })
                }
            }
        }
        item(key = "son") { Spacer(Modifier.width(1.dp)) }
    }
}

/** Biten hapı (SAHNE.md §3.4): renk dairesinde tik, üstü çizili ad. Dokununca ayrıntı açılır. */
@Composable
private fun BitenHapi(ad: String, k: OrnekKayit, onAc: () -> Unit) {
    val takim = Sahne.levha(k.renk)
    Row(
        Modifier
            .heightIn(min = 44.dp)
            .clip(Sahne.olcu.hap)
            .background(Sahne.renk.yuz)
            .clickable(role = Role.Button, onClickLabel = "Aç", onClick = onAc)
            .padding(start = 6.dp, end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(32.dp).clip(CircleShape).background(takim.zemin), contentAlignment = Alignment.Center) {
            Simge(Simgeler.Tik, aciklama = null, modifier = Modifier.size(18.dp), renk = takim.yazi)
        }
        Metin(
            ad,
            stil = Sahne.yazi.etiket.copy(fontWeight = Agirlik.Orta550, textDecoration = TextDecoration.LineThrough),
            renk = Sahne.renk.soluk, satirSiniri = 1,
        )
    }
}
