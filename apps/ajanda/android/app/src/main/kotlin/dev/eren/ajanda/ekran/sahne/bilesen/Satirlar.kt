package dev.eren.ajanda.ekran.sahne.bilesen

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.sahne.tema.Agirlik
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.tema.Simge
import dev.eren.ajanda.ekran.sahne.tema.Simgeler

/**
 * Kompakt satır (SAHNE.md §3.4 tarihsiz satırı, §9 yoğun günün sırası, yaklaşan günler): solda 44 dp renkli
 * küçük resim, ortada başlık ve zaman, sağda tamamlama dairesi; en az 60 dp. Satıra dokunmak ayrıntıyı
 * açar; daire ayrı hedeftir; [cekilebilir] ise sağa çekerek de tamamlanır (§8.3).
 * TalkBack satırı tek düğüm okur ([aciklama]); daire ayrıca odaklanır; [erisim] ile özel eylemler.
 */
@Composable
fun KompaktSatir(
    baslik: String,
    alt: String?,
    renk: LevhaRengi,
    cizim: LevhaCizimYuvasi?,
    tamam: Boolean,
    onAc: () -> Unit,
    onTamamla: ((Boolean) -> Unit)?,
    modifier: Modifier = Modifier,
    isaret: String? = null,
    kilitli: Boolean = false,
    cekilebilir: Boolean = onTamamla != null,
    aciklama: String? = null,
    erisim: (SemanticsPropertyReceiver.() -> Unit)? = null,
) {
    val renkler = Sahne.renk
    val takim = Sahne.levha(renk)
    val sekil = Sahne.olcu.satir
    SagaCek(
        etkin = cekilebilir && onTamamla != null && !kilitli,
        tamam = tamam,
        zemin = takim.zemin,
        yazi = takim.yazi,
        sekil = sekil,
        onTamamla = { onTamamla?.invoke(!tamam) },
        modifier = modifier,
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 60.dp)
                .clip(sekil)
                .background(renkler.yuz)
                .clickable(enabled = !kilitli, onClickLabel = "Aç", onClick = onAc)
                .semantics(mergeDescendants = true) {
                    contentDescription = aciklama ?: listOfNotNull(baslik, alt).joinToString(", ")
                    if (tamam) stateDescription = "tamamlandı"
                    erisim?.invoke(this)
                }
                .padding(start = 8.dp, end = 3.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            KucukResim(renk, cizim, 44.dp, Modifier.then(if (tamam) Modifier.soldur() else Modifier))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Metin(
                    baslik,
                    stil = Sahne.yazi.satirAd.let { if (tamam) it.copy(textDecoration = TextDecoration.LineThrough) else it },
                    renk = if (tamam) renkler.soluk else renkler.murekkep,
                    satirSiniri = 2,
                )
                if (alt != null || isaret != null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (alt != null) Metin(alt, stil = Sahne.yazi.levhaAlt, renk = renkler.soluk, satirSiniri = 1, modifier = Modifier.weight(1f, fill = false))
                        if (isaret != null) Isaret(isaret, renkler.murekkep)
                    }
                }
            }
            if (onTamamla != null) {
                TamamlaDugmesi(tamam, baslik, { onTamamla(it) }, oyukRengi = renkler.zemin, boyut = 42.dp, renk = renkler.murekkep)
            }
        }
    }
}

/** Kaydın küçük resmi: takım zemini üstünde çizim (§3.4: köşe 14 dp, 5 dp iç boşluk). */
@Composable
fun KucukResim(renk: LevhaRengi, cizim: LevhaCizimYuvasi?, boyut: Dp, modifier: Modifier = Modifier) {
    val takim = Sahne.levha(renk)
    Box(
        modifier
            .size(boyut)
            .clip(RoundedCornerShape(boyut * 14f / 44f))
            .background(takim.zemin)
            .padding(boyut * 5f / 44f)
            .clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        if (cizim != null) Box(Modifier.fillMaxSize()) { cizim(LevhaCizimi(takim, 1f, false)) }
    }
}

/**
 * Önceki günlerden kalan açık iş (Bugün'ün başındaki "kalanlar" şeridi): küçük kart; renkli resim, ad, ne
 * kadar geçtiği ve tamamlama dairesi. Kart ayrıntıyı açar, daire tamamlar. Yatay kaydırılan şeritte durduğu
 * için sağa çekme yok (§8.3: yatay kaydırmayla çakışır). Tamamlanınca solar (resim soluk, ad üstü çizili)
 * ve şeritte kalır.
 */
@Composable
fun KalanKarti(
    baslik: String,
    alt: String?,
    renk: LevhaRengi,
    cizim: LevhaCizimYuvasi?,
    tamam: Boolean,
    onAc: () -> Unit,
    onTamamla: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    kilitli: Boolean = false,
    aciklama: String? = null,
    erisim: (SemanticsPropertyReceiver.() -> Unit)? = null,
) {
    val renkler = Sahne.renk
    Row(
        modifier
            .width(248.dp)
            .heightIn(min = 64.dp)
            .clip(Sahne.olcu.satir)
            .background(renkler.yuz)
            .clickable(enabled = !kilitli, onClickLabel = "Aç", onClick = onAc)
            .semantics(mergeDescendants = true) {
                contentDescription = aciklama ?: listOfNotNull(baslik, alt).joinToString(", ")
                if (tamam) stateDescription = "tamamlandı"
                erisim?.invoke(this)
            }
            .padding(start = 8.dp, end = 3.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        KucukResim(renk, cizim, 40.dp, Modifier.then(if (tamam) Modifier.soldur() else Modifier))
        Column(Modifier.weight(1f)) {
            Metin(
                baslik,
                stil = Sahne.yazi.etiket.copy(fontWeight = Agirlik.Kalin650).let { if (tamam) it.copy(textDecoration = TextDecoration.LineThrough) else it },
                renk = if (tamam) renkler.soluk else renkler.murekkep,
                satirSiniri = 2,
            )
            if (alt != null) Metin(alt, stil = Sahne.yazi.kucuk, renk = renkler.soluk, satirSiniri = 2)
        }
        TamamlaDugmesi(tamam, baslik, onTamamla, oyukRengi = renkler.zemin, boyut = 38.dp, renk = renkler.murekkep)
    }
}

/**
 * Biten hap'ı (SAHNE.md §3.4): renk dairesinde tik, üstü çizili ad. Dokununca ayrıntı açılır; "Yeniden aç"
 * özel eylem olarak ([erisim]) verilir. [iptal]: iş tamamlanmadı, iptal edildi (PC'den); dairede tik yerine
 * çarpı, TalkBack durumu "iptal edildi".
 */
@Composable
fun BitenHapi(
    ad: String,
    renk: LevhaRengi,
    onAc: () -> Unit,
    modifier: Modifier = Modifier,
    aciklama: String? = null,
    iptal: Boolean = false,
    erisim: (SemanticsPropertyReceiver.() -> Unit)? = null,
) {
    val takim = Sahne.levha(renk)
    Row(
        modifier
            .heightIn(min = 44.dp)
            .clip(Sahne.olcu.hap)
            .background(Sahne.renk.yuz)
            .clickable(role = Role.Button, onClickLabel = "Aç", onClick = onAc)
            .semantics(mergeDescendants = true) {
                contentDescription = aciklama ?: ad
                stateDescription = if (iptal) "iptal edildi" else "tamamlandı"
                erisim?.invoke(this)
            }
            .padding(start = 6.dp, end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(32.dp).clip(CircleShape).background(takim.zemin), contentAlignment = Alignment.Center) {
            Simge(if (iptal) Simgeler.Kapat else Simgeler.Tik, aciklama = null, modifier = Modifier.size(if (iptal) 16.dp else 18.dp), renk = takim.yazi)
        }
        Metin(
            ad,
            stil = Sahne.yazi.etiket.copy(fontWeight = Agirlik.Orta550, textDecoration = TextDecoration.LineThrough),
            renk = Sahne.renk.soluk, satirSiniri = 1,
        )
    }
}
