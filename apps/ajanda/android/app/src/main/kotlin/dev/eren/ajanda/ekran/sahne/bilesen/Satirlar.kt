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
import androidx.compose.ui.graphics.graphicsLayer
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
fun KucukResim(renk: LevhaRengi, cizim: LevhaCizimYuvasi?, boyut: Dp, modifier: Modifier = Modifier, boyama: Float = 1f) {
    val takim = Sahne.levha(renk)
    val sekil = RoundedCornerShape(boyut * 14f / 44f)
    Box(
        modifier
            .size(boyut)
            .clip(sekil)
            .background(takim.zemin.copy(alpha = takim.zemin.alpha * boyama.coerceIn(0f, 1f)))
            .then(if (boyama < 1f) Modifier.kesikCerceve(Sahne.renk.soluk.copy(alpha = 1f - boyama), boyut.value * 14f / 44f) else Modifier)
            .padding(boyut * 5f / 44f)
            .clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        if (cizim != null) Box(Modifier.fillMaxSize()) { cizim(LevhaCizimi(takim, boyama, false)) }
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
    // Görünür hap 44 dp (§3.4); dokunma alanı en az 48 dp (§3.1): tıklama dış kutuda.
    Box(
        modifier
            .heightIn(min = Sahne.olcu.dokunma)
            .clip(Sahne.olcu.hap)
            .clickable(role = Role.Button, onClickLabel = "Aç", onClick = onAc)
            .semantics(mergeDescendants = true) {
                contentDescription = aciklama ?: ad
                stateDescription = if (iptal) "iptal edildi" else "tamamlandı"
                erisim?.invoke(this)
            },
        contentAlignment = Alignment.Center,
    ) {
    Row(
        Modifier
            .heightIn(min = 44.dp)
            .clip(Sahne.olcu.hap)
            .background(Sahne.renk.yuz)
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
}

/**
 * Asistanın önerdiği (taslak) kaydın satırı: karakalem (SAHNE.md §3.3): boyasız, 2 dp kesikli çerçeveli; küçük
 * resim de karakalem. Başlığın altında "Asistan önerdi, …" ve Onayla / Vazgeç. Onayda ([boyama]) satır yüzey rengine
 * boyanır, resim boyanır, düğmeler söner ([dugmeAlfa]); vazgeçte ([cikis]) söner, küçülür, döner. Sağa çekme yok
 * (§8.3: taslaklarda kapalı). TalkBack: tek düğüm, durum "asistan önerisi, onay bekliyor"; [erisim] ile Onayla /
 * Vazgeç özel eylemleri.
 */
@Composable
fun TaslakSatir(
    baslik: String,
    alt: String?,
    renk: LevhaRengi,
    cizim: LevhaCizimYuvasi?,
    onAc: () -> Unit,
    onOnayla: () -> Unit,
    onVazgec: () -> Unit,
    modifier: Modifier = Modifier,
    boyama: Boyama = Boyama.KARAKALEM,
    dugmeAlfa: Float = 1f,
    cikis: Float = 0f,
    kilitli: Boolean = false,
    aciklama: String? = null,
    erisim: (SemanticsPropertyReceiver.() -> Unit)? = null,
) {
    val renkler = Sahne.renk
    val sekil = Sahne.olcu.satir
    val boyali = boyama.daire >= 1f
    Column(
        modifier
            .graphicsLayer {
                alpha = 1f - cikis
                scaleX = 1f - 0.3f * cikis; scaleY = scaleX
                rotationZ = 3f * cikis
            }
            .fillMaxWidth()
            .heightIn(min = 60.dp)
            .clip(sekil)
            .background(renkler.yuz.copy(alpha = boyama.daire.coerceIn(0f, 1f)))
            .then(if (!boyali) Modifier.kesikCerceve(renkler.soluk.copy(alpha = 1f - boyama.daire), Sahne.olcu.satirYaricapi.value) else Modifier)
            .clickable(enabled = !kilitli, onClickLabel = "Aç", onClick = onAc)
            .semantics(mergeDescendants = true) {
                contentDescription = aciklama ?: listOfNotNull(baslik, alt).joinToString(", ")
                if (!boyali) stateDescription = "asistan önerisi, onay bekliyor"
                erisim?.invoke(this)
            }
            .padding(start = 8.dp, end = 10.dp, top = 8.dp, bottom = 6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            KucukResim(renk, cizim, 44.dp, boyama = boyama.cizim)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Metin(baslik, stil = Sahne.yazi.satirAd, renk = renkler.murekkep, satirSiniri = 2)
                Metin(listOfNotNull("Asistan önerdi", alt).joinToString(", "), stil = Sahne.yazi.levhaAlt, renk = renkler.soluk, satirSiniri = 2)
            }
        }
        Row(
            Modifier.padding(start = 56.dp).graphicsLayer { alpha = dugmeAlfa },
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            HapDugme("Onayla", onClick = { if (!kilitli) onOnayla() }, onayDugmesi = true)
            HapDugme("Vazgeç", onClick = { if (!kilitli) onVazgec() }, dolu = false, onayDugmesi = true)
        }
    }
}
