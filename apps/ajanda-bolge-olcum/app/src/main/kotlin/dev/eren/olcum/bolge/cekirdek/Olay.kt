package dev.eren.olcum.bolge.cekirdek

/**
 * Günlükteki tek bir olay. Saf veri; Android'e bağlı değil.
 *
 * Satır biçimi (sekmeyle ayrılmış):
 *   TUR <tab> duvarMs <tab> gecenMs <tab> boot <tab> anahtar=değer <tab> ...
 * duvarMs = System.currentTimeMillis(), gecenMs = SystemClock.elapsedRealtime(),
 * boot = Settings.Global.BOOT_COUNT (bilinmiyorsa -1).
 *
 * Günlükte koordinat, bölge adı, Wi-Fi ağ adı ve cihaz kimliği BULUNMAZ: alanlar yazılmadan önce
 * [Gizlilik.alanTemizle] süzgecinden geçer.
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
    fun tam(k: String): Int? = alan[k]?.toIntOrNull()
    fun bayrak(k: String): Boolean? = when (alan[k]) {
        "1" -> true
        "0" -> false
        else -> null
    }

    /** Açılışın duvar saatindeki yaklaşık anı (duvar - gecen). */
    val acilisDuvar: Long get() = duvar - gecen
}

/** Olay türleri. Kısa ve sabit; ayrıştırıcı bilinmeyen türleri de kabul eder. */
object Tur {
    const val BASLA = "BASLA"           // ölçüm başladı: ayarlar
    const val DUR = "DUR"               // ölçüm durduruldu
    const val OLGU = "OLGU"             // cihaz olguları anlık görüntüsü
    const val BOLGE = "BOLGE"           // bölge tanımı (koordinatsız): id, r, wifi, dogruluk
    const val BOLGESIL = "BOLGESIL"     // bölge silindi: id
    const val WIFIBAG = "WIFIBAG"       // bölgeye Wi-Fi eşlendi / kaldırıldı: id, var
    const val KONUMAL = "KONUMAL"       // "bulunduğum yeri kaydet" / "konumu sına" ölçümü
    const val KUR = "KUR"               // bir kol kuruldu: kol, neden, sonuc, hata, n
    const val DENETIM = "DENETIM"       // soğuk girişte kolun sistemdeki izi: kol, piVar, bootDegisti
    const val ALGI = "ALGI"             // kol bir geçiş bildirdi: kol, gecis, bolge, bolum, ...
    const val GMSHATA = "GMSHATA"       // Play Hizmetleri hata olayı yolladı: kod
    const val WIFI = "WIFI"             // Wi-Fi bağlantı olayı: eslesen, kimlik, tekrar
    const val ETIKET = "ETIKET"         // kullanıcı bir bölümü etiketledi: bolum, cevap, dk
    const val ELLE = "ELLE"             // elle gerçek olay: bolge, gecis, dk
    const val ISARET = "ISARET"         // deneme işareti: tur
    const val BEYAN = "BEYAN"           // kullanıcı beyanı (otomatik başlatma vb.): ad, deger
    const val DONEM = "DONEM"           // ölçüm dönemi değişti: no
    const val ACILIS = "ACILIS"         // uygulama süreci başladı
    const val EKRAN = "EKRAN"           // bir ekran öne geldi: ad
    const val CIKIS = "CIKIS"           // sistemin bildirdiği süreç çıkışı
    const val BOOT = "BOOT"             // açılış yayını alındı
    const val KAPANIS = "KAPANIS"       // kapanış yayını alındı
    const val GUNCELLEME = "GUNCELLEME" // paket güncellendi
    const val KONUM = "KONUM"           // konum hizmeti açıldı/kapandı: etkin
    const val IS = "IS"                 // periyodik denetim işi çalıştı (pil örneği taşır)
}

object GunlukBicimi {
    const val BASLIK = "# ajanda-bolge-olcum gunluk v1"

    private fun temiz(s: String): String =
        s.replace('\t', ' ').replace('\n', ' ').replace('\r', ' ')

    private fun temizAnahtar(s: String): String = temiz(s).replace('=', '_')

    /** Yazmadan önce gizlilik süzgeci uygulanır; yasak anahtar ya da koordinat biçimli değer geçmez. */
    fun yaz(o: Olay): String = buildString {
        append(temizAnahtar(o.tur)).append('\t')
        append(o.duvar).append('\t')
        append(o.gecen).append('\t')
        append(o.boot)
        for ((k, v) in Gizlilik.alanTemizle(o.alan)) {
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
