package dev.eren.ajanda.ekran.sahne.tema

import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import dev.eren.ajanda.R

/**
 * Yazı tipi: Bricolage Grotesque (Mathieu Triay, SIL Open Font License 1.1), uygulamaya gömülü değişken
 * dosya: `res/font/bricolage_grotesque.ttf`, lisans metni `res/raw/ofl_bricolage_grotesque.txt`.
 *
 * Eksenlerden `wght` (200–800) ve `opsz` (12–96) kullanılır; `wdth` 100'de kalır. Tarayıcı optik boyu yazı
 * boyuna kendisi eşitler, Compose eşitlemez: her aile, stillerinin taban boyuna yakın optik boyla kurulur
 * (kullanıcının yazı ölçeği optik boyu değiştirmez). SAHNE.md §2.1'deki üç kova:
 * [Baslik] opsz 40 (28 sp ve üstü), [Ara] opsz 20 (17–24 sp), [Metin] opsz 14 (16 sp ve altı).
 * Ara ağırlıklar (550, 650) prototipte kullanıldığı için ailelerde var.
 */
@OptIn(ExperimentalTextApi::class)
object Bricolage {
    private fun kes(agirlik: Int, optikBoy: Float) = Font(
        resId = R.font.bricolage_grotesque,
        weight = FontWeight(agirlik),
        variationSettings = FontVariation.Settings(
            FontVariation.weight(agirlik),
            FontVariation.Setting("opsz", optikBoy),
        ),
    )

    private fun aile(optikBoy: Float, vararg agirliklar: Int) = FontFamily(agirliklar.map { kes(it, optikBoy) })

    val Baslik: FontFamily = aile(40f, 600, 700, 800)
    val Ara: FontFamily = aile(20f, 400, 500, 550, 600, 650, 700, 800)
    val Metin: FontFamily = aile(14f, 400, 500, 550, 600, 650, 700)
}

/** Prototipte kullanılan ara ağırlıklar. */
object Agirlik {
    val Orta550 = FontWeight(550)
    val Kalin650 = FontWeight(650)
}

/**
 * Yazı ölçeği (SAHNE.md §2.2). Boylar `sp`: kullanıcının yazı ölçeğine uyar (Android 14+ doğrusal olmayan
 * ölçek dahil). Satır değeri verilmeyenler prototipten miras 1.4. Başlıklar `LineBreak.Heading` ile
 * dengeli kırılır (prototipte `text-wrap:balance`).
 */
@Immutable
data class SahneYazi(
    /** Takvimde ay adı (52). */
    val ayBasligi: TextStyle,
    /** Bugün ekranının cümlesi, "Sırada … var." (39). */
    val gunBasligi: TextStyle,
    /** Ayrıntıda kaydın adı; katman sayfalarının başlığı (38). */
    val ayrintiBasligi: TextStyle,
    /** Yeni kayıtta başlık alanı (30). */
    val yeniGiris: TextStyle,
    /** Büyük levhanın başlığı (28). */
    val levhaBuyuk: TextStyle,
    /** Takvimde seçili günün başlığı (24). */
    val takvimGun: TextStyle,
    /** Geniş levhanın (taslak) başlığı (22). */
    val levhaGenis: TextStyle,
    /** Kare levha ve takvim şeridi kartı (21). */
    val levhaKare: TextStyle,
    /** Varış kartının görevi (19). */
    val kartBaslik: TextStyle,
    /** "Ekle" (19) ve ayrıntıdaki "Bitti" (18): büyük düğme. */
    val dugmeBuyuk: TextStyle,
    /** Takvim günü rakamı (18; bugün 800). */
    val gunNo: TextStyle,
    /** Tarihsiz satırın adı (17). */
    val satirAd: TextStyle,
    /** Ayrıntıdaki not (17 / 1.5). */
    val govdeBuyuk: TextStyle,
    /** Ayrıntıda tarih ve saat (17). */
    val zaman: TextStyle,
    /** Taban (16); gün başlığının alt satırı. */
    val govde: TextStyle,
    /** Tarih satırı (15 / 500). Bölüm başlığı 600, hap ve alt çubuk 600, onay düğmeleri 650 ile `copy`. */
    val etiket: TextStyle,
    /** Levhanın zaman satırı (14 / 500, %88 saydam çizilir). */
    val levhaAlt: TextStyle,
    /** Hafta günü adları, bağlantı türü (13). */
    val kucuk: TextStyle,
) {
    companion object {
        private val sikiSatir = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.Both)
        private val miras = 1.4.em

        private fun baslik(boy: Int, satir: TextUnit, harf: Double, aile: FontFamily = Bricolage.Baslik) = TextStyle(
            fontFamily = aile, fontWeight = FontWeight.Bold, fontSize = boy.sp, lineHeight = satir,
            letterSpacing = harf.em, lineHeightStyle = sikiSatir, lineBreak = LineBreak.Heading,
        )

        private fun metin(boy: Int, agirlik: FontWeight, satir: TextUnit = miras, aile: FontFamily = Bricolage.Metin) = TextStyle(
            fontFamily = aile, fontWeight = agirlik, fontSize = boy.sp, lineHeight = satir,
        )

        val Varsayilan = SahneYazi(
            ayBasligi = baslik(52, 0.9.em, -0.035),
            gunBasligi = baslik(39, 1.0.em, -0.03),
            ayrintiBasligi = baslik(38, 1.0.em, -0.03),
            yeniGiris = baslik(30, miras, -0.02).copy(lineBreak = LineBreak.Simple),
            levhaBuyuk = baslik(28, 1.0.em, -0.025),
            takvimGun = baslik(24, miras, -0.02, Bricolage.Ara),
            levhaGenis = baslik(22, 1.0.em, -0.025, Bricolage.Ara),
            levhaKare = baslik(21, 1.0.em, -0.025, Bricolage.Ara),
            kartBaslik = baslik(19, 1.1.em, -0.01, Bricolage.Ara),
            dugmeBuyuk = metin(18, FontWeight.Bold, aile = Bricolage.Ara),
            gunNo = metin(18, FontWeight.SemiBold, 1.0.em, Bricolage.Ara),
            satirAd = metin(17, FontWeight.SemiBold, aile = Bricolage.Ara),
            govdeBuyuk = metin(17, FontWeight.Normal, 1.5.em, Bricolage.Ara),
            zaman = metin(17, FontWeight.Medium, aile = Bricolage.Ara),
            govde = metin(16, FontWeight.Normal),
            etiket = metin(15, FontWeight.Medium),
            levhaAlt = metin(14, FontWeight.Medium),
            kucuk = metin(13, FontWeight.Normal),
        )
    }
}
