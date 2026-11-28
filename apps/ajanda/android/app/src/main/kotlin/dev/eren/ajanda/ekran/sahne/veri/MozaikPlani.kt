package dev.eren.ajanda.ekran.sahne.veri

import androidx.compose.runtime.Immutable

/** Mozaikteki bir parçanın biçimi (SAHNE.md §3.2, §9). */
enum class MozaikBicimi {
    /** Sıradaki iş: iki sütunu kaplar, canlı çizim. */
    BUYUK,

    /** Yan yana iki; ardışık iki KARE bir sıra olur. */
    KARE,

    /** Tam genişlik, alçak (tek kalan kare; tek sütunda bütün kareler). */
    GENIS,

    /** Karakalem taslak levhası (tam genişlik). */
    TASLAK,

    /** Yoğun günde birden çok taslak: tek gruplu karakalem levha. */
    TASLAK_GRUBU,

    /** Yoğun günün sırası: kompakt satır. */
    SATIR,
}

@Immutable
data class MozaikParcasi(val anahtar: String, val bicim: MozaikBicimi, val kayitlar: List<BugunKaydi>) {
    val kayit: BugunKaydi get() = kayitlar.first()
}

/**
 * Bugünün mozaiği (saf): hangi kayıt hangi biçimde, hangi sırada.
 *
 * - Taslaklar başta (ürün varsayılanı: asistanın önerisi gözden kaçmasın). Yoğun günde birden çoksa tek
 *   gruplu levha ("Asistanın 3 önerisi").
 * - Sıradaki iş büyük; öteki açık işler ikişer kare, sayı tekse sonuncusu geniş. [tekSutun] (yazı ölçeği
 *   ≥ 1.5, §10.2) ise kareler geniş olur.
 * - [yogun] ise sıradakinden sonra en çok iki kare kalır, gerisi kompakt satır (§9 "sahne + sıra").
 */
object MozaikPlani {
    fun kur(acikler: List<BugunKaydi>, taslaklar: List<BugunKaydi>, yogun: Boolean, tekSutun: Boolean): List<MozaikParcasi> {
        val p = mutableListOf<MozaikParcasi>()
        if (yogun && taslaklar.size > 1) {
            p += MozaikParcasi("oneriler", MozaikBicimi.TASLAK_GRUBU, taslaklar)
        } else {
            taslaklar.forEach { p += MozaikParcasi(it.anahtar, MozaikBicimi.TASLAK, listOf(it)) }
        }
        if (acikler.isEmpty()) return p
        p += MozaikParcasi(acikler.first().anahtar, MozaikBicimi.BUYUK, listOf(acikler.first()))
        val kalan = acikler.drop(1)
        val resimli = if (yogun) kalan.take(YogunGun.SAHNEDE - 1) else kalan
        val satirlar = if (yogun) kalan.drop(YogunGun.SAHNEDE - 1) else emptyList()
        resimli.forEachIndexed { i, k ->
            val tekKalan = resimli.size % 2 == 1 && i == resimli.lastIndex
            p += MozaikParcasi(k.anahtar, if (tekSutun || tekKalan) MozaikBicimi.GENIS else MozaikBicimi.KARE, listOf(k))
        }
        satirlar.forEach { p += MozaikParcasi(it.anahtar, MozaikBicimi.SATIR, listOf(it)) }
        return p
    }
}
