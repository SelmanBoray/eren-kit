package dev.eren.olcum.bolge.cekirdek

import java.security.MessageDigest
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Kullanıcının tanımladığı yer. Koordinatlar ve ad YALNIZ uygulamanın özel deposunda (bolgeler.tsv) durur.
 * Günlüğe ve rapora yalnız [etiket] ("bölge 3"), yarıçap ve uzaklık girer.
 * toString bilerek gizli alanları göstermez: yanlışlıkla bir metin şablonuna girerse sızmasın.
 */
data class Bolge(
    val id: Int,
    val ad: String,
    val enlem: Double,
    val boylam: Double,
    val yaricap: Int,
    /** Eşlenen Wi-Fi ağ adının tuzlu özeti; ağ adının kendisi hiçbir yerde saklanmaz. */
    val wifiOzet: String?,
    val olusturma: Long,
) {
    val etiket: String get() = "bölge $id"
    override fun toString(): String = "Bolge($etiket, r=$yaricap)"
}

/** Tek bir konum örneği. Bellekte yaşar; yalnız [Kayitlar] içinden uzaklığa çevrilerek günlüğe girer. */
data class Ornek(
    val enlem: Double,
    val boylam: Double,
    val dogruluk: Float?,
    /** Örneğin kullanıldığı andaki yaşı (ms); bilinmiyorsa null. */
    val yasMs: Long?,
    val kaynak: String,
) {
    override fun toString(): String = "Ornek($kaynak)"
}

object Mesafe {
    private const val R = 6_371_008.8

    /** Haversine; metre. */
    fun metre(enlem1: Double, boylam1: Double, enlem2: Double, boylam2: Double): Double {
        val f1 = Math.toRadians(enlem1)
        val f2 = Math.toRadians(enlem2)
        val df = f2 - f1
        val dl = Math.toRadians(boylam2 - boylam1)
        val a = sin(df / 2) * sin(df / 2) + cos(f1) * cos(f2) * sin(dl / 2) * sin(dl / 2)
        return 2 * R * asin(min(1.0, sqrt(a)))
    }

    fun metre(b: Bolge, o: Ornek): Double = metre(b.enlem, b.boylam, o.enlem, o.boylam)
}

/** Özel depo biçimi (tek satır = tek bölge). Bu metin hiçbir zaman dışa verilmez. */
object BolgeDeposu {
    const val BASLIK = "# bolgeler v1 (ozel; disa verilmez)"

    private fun temiz(s: String) = s.replace('\t', ' ').replace('\n', ' ').replace('\r', ' ').trim()

    fun yaz(bolgeler: List<Bolge>): String = buildString {
        appendLine(BASLIK)
        for (b in bolgeler) {
            append(b.id).append('\t')
            append(temiz(b.ad)).append('\t')
            append(b.enlem.toString()).append('\t')
            append(b.boylam.toString()).append('\t')
            append(b.yaricap).append('\t')
            append(b.wifiOzet ?: "-").append('\t')
            append(b.olusturma)
            appendLine()
        }
    }

    fun oku(metin: String): List<Bolge> = metin.lineSequence().mapNotNull { s ->
        if (s.isBlank() || s.startsWith("#")) return@mapNotNull null
        val p = s.split('\t')
        if (p.size < 7) return@mapNotNull null
        Bolge(
            id = p[0].toIntOrNull() ?: return@mapNotNull null,
            ad = p[1],
            enlem = p[2].toDoubleOrNull() ?: return@mapNotNull null,
            boylam = p[3].toDoubleOrNull() ?: return@mapNotNull null,
            yaricap = p[4].toIntOrNull() ?: return@mapNotNull null,
            wifiOzet = p[5].takeIf { it != "-" && it.isNotEmpty() },
            olusturma = p[6].toLongOrNull() ?: 0L,
        )
    }.toList()
}

/**
 * Android'den gelen konum/bölge/ağ bilgisini günlük alanlarına çeviren TEK yer.
 * Koordinatlar burada uzaklığa indirgenir; çıktıda koordinat, ad ya da ağ adı yoktur (testle sınanır).
 */
object Kayitlar {
    fun b(x: Boolean) = if (x) "1" else "0"

    /** Konum örneğinin bölgeye göre özeti: uzaklık (m), doğruluk (m), yaş, kaynak, içeride mi. */
    fun konumAlanlari(bolge: Bolge?, o: Ornek?): LinkedHashMap<String, String> {
        val m = LinkedHashMap<String, String>()
        if (o == null) {
            m["konumVar"] = "0"
            return m
        }
        m["konumVar"] = "1"
        m["konumKaynak"] = o.kaynak
        o.dogruluk?.let { m["dogruluk"] = "${it.roundToInt()}" }
        o.yasMs?.let { m["konumYasi"] = "$it" }
        if (bolge != null) {
            val u = Mesafe.metre(bolge, o)
            m["uzaklik"] = "${u.roundToInt()}"
            m["icinde"] = b(u <= bolge.yaricap)
        }
        return m
    }

    fun algiAlanlari(
        kol: String,
        gecis: String,
        bolgeId: Int,
        bolum: Int,
        kurSonrasi: Long?,
        bolge: Bolge?,
        o: Ornek?,
    ): LinkedHashMap<String, String> {
        val m = linkedMapOf(
            "kol" to kol,
            "gecis" to gecis,
            "bolge" to "$bolgeId",
            "bolum" to "$bolum",
        )
        if (kurSonrasi != null) m["kurSonrasi"] = "$kurSonrasi"
        if (bolge == null) m["bilinmeyenBolge"] = "1" else m["r"] = "${bolge.yaricap}"
        m.putAll(konumAlanlari(bolge, o))
        return m
    }

    fun bolgeAlanlari(b: Bolge, dogruluk: Float?, kaynak: String?): LinkedHashMap<String, String> {
        val m = linkedMapOf("id" to "${b.id}", "r" to "${b.yaricap}", "wifi" to b(b.wifiOzet != null))
        if (dogruluk != null) m["dogruluk"] = "${dogruluk.roundToInt()}"
        if (kaynak != null) m["kaynak"] = kaynak
        return m
    }

    /** Ağ adını normalleştirir ("<unknown ssid>" ve boş -> null). */
    fun ssidNormal(ham: String?): String? {
        val s = ham?.trim()?.removeSurrounding("\"") ?: return null
        if (s.isEmpty() || s == "<unknown ssid>" || s == "0x") return null
        return s
    }

    /** Tuzlu SHA-256 özetinin ilk 16 hanesi. Tuz cihazda rastgele üretilir ve dışa verilmez. */
    fun wifiOzeti(ssid: String?, tuz: String): String? {
        val s = ssidNormal(ssid) ?: return null
        val d = MessageDigest.getInstance("SHA-256").digest("$tuz:$s".toByteArray(Charsets.UTF_8))
        return d.joinToString("") { "%02x".format(it) }.take(16)
    }

    fun wifiEslesen(ozet: String?, bolgeler: List<Bolge>): Bolge? =
        if (ozet == null) null else bolgeler.firstOrNull { it.wifiOzet == ozet }

    /** WIFI olayının alanları: hangi bölgeyle eşleşti, ağ adı okunabildi mi. Ağ adı girmez. */
    fun wifiAlanlari(ssid: String?, tuz: String, bolgeler: List<Bolge>, tekrar: Boolean): LinkedHashMap<String, String> {
        val oz = wifiOzeti(ssid, tuz)
        val e = wifiEslesen(oz, bolgeler)
        return linkedMapOf(
            "kimlik" to if (oz != null) "alindi" else "alinamadi",
            "eslesen" to "${e?.id ?: 0}",
            "tekrar" to b(tekrar),
        )
    }
}

/**
 * "Bulunduğum yeri kaydet" sırasında gelen konumların istatistiği. Saf; koordinat tutmaz.
 * t = ölçüm başından beri geçen ms.
 */
class KonumAlmaIst {
    class Kaynak {
        var n = 0
        var ilkMs: Long? = null
        var enIyi: Float? = null
    }

    val kaynaklar = LinkedHashMap<String, Kaynak>()
    var n = 0; private set
    var eski = 0; private set
    var ilkMs: Long? = null; private set
    var ilk50Ms: Long? = null; private set
    var ilk20Ms: Long? = null; private set
    var enIyi: Float? = null; private set
    var enIyiKaynak: String? = null; private set

    /** yasMs: konumun alındığı andaki yaşı. Eski (önbellekten) konumlar sayılmaz, ayrıca sayılır. */
    fun ekle(kaynak: String, t: Long, dogruluk: Float?, yasMs: Long?): Boolean {
        if (yasMs != null && yasMs > ESKI_MS) {
            eski++
            return false
        }
        n++
        val k = kaynaklar.getOrPut(kaynak) { Kaynak() }
        k.n++
        if (k.ilkMs == null) k.ilkMs = t
        if (ilkMs == null) ilkMs = t
        if (dogruluk != null) {
            if (k.enIyi == null || dogruluk < k.enIyi!!) k.enIyi = dogruluk
            if (enIyi == null || dogruluk < enIyi!!) {
                enIyi = dogruluk
                enIyiKaynak = kaynak
            }
            if (dogruluk <= 50f && ilk50Ms == null) ilk50Ms = t
            if (dogruluk <= 20f && ilk20Ms == null) ilk20Ms = t
        }
        return true
    }

    fun alanlar(amac: String, kapaliAlan: Boolean, toplamMs: Long): LinkedHashMap<String, String> {
        val m = linkedMapOf(
            "amac" to amac,
            "kapali" to Kayitlar.b(kapaliAlan),
            "toplam" to "$toplamMs",
            "n" to "$n",
            "eski" to "$eski",
        )
        ilkMs?.let { m["ilk"] = "$it" }
        ilk50Ms?.let { m["ilk50"] = "$it" }
        ilk20Ms?.let { m["ilk20"] = "$it" }
        enIyi?.let { m["enIyi"] = "${it.roundToInt()}" }
        enIyiKaynak?.let { m["secilen"] = it }
        for ((ad, k) in kaynaklar) {
            m["k_${ad}_n"] = "${k.n}"
            k.ilkMs?.let { m["k_${ad}_ilk"] = "$it" }
            k.enIyi?.let { m["k_${ad}_enIyi"] = "${it.roundToInt()}" }
        }
        return m
    }

    companion object {
        const val ESKI_MS = 10_000L
    }
}
