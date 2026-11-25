package dev.eren.olcum.ajanda.cekirdek

/**
 * Günlükteki tek bir olay. Saf veri; Android'e bağlı değil.
 *
 * Satır biçimi (sekmeyle ayrılmış):
 *   TUR <tab> duvarMs <tab> gecenMs <tab> boot <tab> anahtar=değer <tab> ...
 * duvarMs = System.currentTimeMillis(), gecenMs = SystemClock.elapsedRealtime(),
 * boot = Settings.Global.BOOT_COUNT (bilinmiyorsa -1).
 */
data class Olay(
    val tur: String,
    val duvar: Long,
    val gecen: Long,
    val boot: Int,
    val alan: Map<String, String> = emptyMap(),
) {
    fun metin(k: String): String? = alan[k]
    fun sayi(k: String): Long? = alan[k]?.toLongOrNull()
    fun bayrak(k: String): Boolean? = when (alan[k]) {
        "1" -> true
        "0" -> false
        else -> null
    }

    /** Açılışın duvar saatindeki yaklaşık anı (duvar - gecen). */
    val acilisDuvar: Long get() = duvar - gecen
}

/** Olay türleri. Kısa ve sabit tutulur; ayrıştırıcı bilinmeyen türleri de kabul eder. */
object Tur {
    const val BASLA = "BASLA"       // ölçüm başladı; plan alanları
    const val DUR = "DUR"           // ölçüm durduruldu
    const val KUR = "KUR"           // alarm aralığı kuruldu: seri, ilk, son, kaynak
    const val CAL = "CAL"           // alarm çaldı: seri, slot, plan, ekran, idle, ...
    const val IS = "IS"             // periyodik iş çalıştı: id
    const val ACILIS = "ACILIS"     // uygulama süreci başladı
    const val CIKIS = "CIKIS"       // sistemin bildirdiği süreç çıkışı: zaman, neden
    const val BOOT = "BOOT"         // açılış yayını alındı: eylem
    const val KAPANIS = "KAPANIS"   // kapanma yayını alındı
    const val SAAT = "SAAT"         // saat elle/ağdan değişti: sicrama (ms)
    const val DILIM = "DILIM"       // saat dilimi değişti: ofsetDk
    const val OLGU = "OLGU"         // cihaz olguları anlık görüntüsü
    const val PI = "PI"             // bekleyen alarm niyeti var mı: seri, slot, var
    const val ISVAR = "ISVAR"       // periyodik iş sistemde kayıtlı mı: id, var
    const val ISARET = "ISARET"     // kullanıcının koyduğu işaret: tur
    const val GUNCELLEME = "GUNCELLEME"
}

object GunlukBicimi {
    const val BASLIK = "# ajanda-olcum gunluk v1"

    private fun temiz(s: String): String =
        s.replace('\t', ' ').replace('\n', ' ').replace('\r', ' ')

    private fun temizAnahtar(s: String): String = temiz(s).replace('=', '_')

    fun yaz(o: Olay): String = buildString {
        append(temizAnahtar(o.tur)).append('\t')
        append(o.duvar).append('\t')
        append(o.gecen).append('\t')
        append(o.boot)
        for ((k, v) in o.alan) {
            append('\t').append(temizAnahtar(k)).append('=').append(temiz(v))
        }
    }

    /** Bozuk ya da yorum satırında null döner. */
    fun ayristir(satir: String): Olay? {
        val s = satir.trimEnd('\r', '\n')
        if (s.isBlank() || s.startsWith("#")) return null
        val p = s.split('\t')
        if (p.size < 4 || p[0].isEmpty()) return null
        val duvar = p[1].toLongOrNull() ?: return null
        val gecen = p[2].toLongOrNull() ?: return null
        val boot = p[3].toIntOrNull() ?: return null
        val alan = LinkedHashMap<String, String>()
        for (i in 4 until p.size) {
            val e = p[i].indexOf('=')
            if (e <= 0) return null
            alan[p[i].substring(0, e)] = p[i].substring(e + 1)
        }
        return Olay(p[0], duvar, gecen, boot, alan)
    }

    data class Sonuc(val olaylar: List<Olay>, val hataliSatir: Int)

    fun ayristirHepsi(metin: String): Sonuc {
        val olaylar = ArrayList<Olay>()
        var hatali = 0
        for (satir in metin.lineSequence()) {
            val t = satir.trim()
            if (t.isEmpty() || t.startsWith("#")) continue
            val o = ayristir(satir)
            if (o == null) hatali++ else olaylar.add(o)
        }
        return Sonuc(olaylar, hatali)
    }
}
