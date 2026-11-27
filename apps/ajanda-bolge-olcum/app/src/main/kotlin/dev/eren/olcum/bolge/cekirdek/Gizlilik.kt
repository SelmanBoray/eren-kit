package dev.eren.olcum.bolge.cekirdek

import java.util.Locale

/**
 * Gizlilik süzgeçleri (pazarlıksız kural: koordinat, bölge adı, ağ adı, cihaz kimliği dışarı çıkmaz).
 *
 * İki katman:
 *  1. [alanTemizle]: günlüğe yazılan her olayda yasak anahtarları ve koordinat biçimli değerleri atar.
 *  2. [temizle]: dışa verilen metni, cihazdaki gerçek gizli değerlere (bölge koordinatları ve adları)
 *     karşı tarar; bulursa siler ve kaç düzeltme yapıldığını bildirir. Normalde 0 olmalı.
 */
object Gizlilik {
    const val GIZLI = "[gizli]"

    val YASAK_ANAHTAR = setOf(
        "enlem", "boylam", "lat", "lon", "lng", "latitude", "longitude", "konum",
        "ad", "isim", "ssid", "bssid", "ag", "agadi", "mac", "androidid", "seri", "imei", "cihazadi",
    )

    /** Ondalık ayırıcıdan sonra 4+ hane: koordinat gibi görünür (bu uygulamanın kendi alanlarında yok). */
    private val KOORDINAT = Regex("""-?\d{1,3}[.,]\d{4,}""")

    fun alanTemizle(alan: Map<String, String>): LinkedHashMap<String, String> {
        val m = LinkedHashMap<String, String>()
        for ((k, v) in alan) {
            if (k.lowercase(Locale.ROOT) in YASAK_ANAHTAR) continue
            m[k] = KOORDINAT.replace(v, GIZLI)
        }
        return m
    }

    /** Bir koordinat değerinin metinde görünebileceği biçimler (3-7 hane, yuvarlanmış ve kesilmiş, . ve ,). */
    fun kaliplar(deger: Double): List<String> {
        val s = LinkedHashSet<String>()
        for (h in 3..7) {
            val yuv = String.format(Locale.ROOT, "%.${h}f", deger)
            val carpan = Math.pow(10.0, h.toDouble())
            val kes = String.format(Locale.ROOT, "%.${h}f", (if (deger < 0) Math.ceil(deger * carpan) else Math.floor(deger * carpan)) / carpan)
            for (x in listOf(yuv, kes)) {
                s += x
                s += x.replace('.', ',')
            }
        }
        return s.toList()
    }

    data class Sonuc(val metin: String, val duzeltme: Int)

    fun temizle(metin: String, bolgeler: List<Bolge>, ekGizliler: List<String> = emptyList()): Sonuc {
        var t = metin
        var n = 0
        val kaliplar = bolgeler.flatMap { kaliplar(it.enlem) + kaliplar(it.boylam) } + ekGizliler.filter { it.length >= 3 }
        for (k in kaliplar.distinct().sortedByDescending { it.length }) {
            var i = t.indexOf(k)
            while (i >= 0) {
                n++
                t = t.substring(0, i) + GIZLI + t.substring(i + k.length)
                i = t.indexOf(k, i + GIZLI.length)
            }
        }
        for (ad in bolgeler.map { it.ad.trim() }.filter { it.length >= 2 }.distinct()) {
            val r = Regex("(?<![\\p{L}\\p{N}])" + Regex.escape(ad) + "(?![\\p{L}\\p{N}])", RegexOption.IGNORE_CASE)
            val bulunan = r.findAll(t).count()
            if (bulunan > 0) {
                n += bulunan
                t = r.replace(t, GIZLI)
            }
        }
        return Sonuc(t, n)
    }
}
