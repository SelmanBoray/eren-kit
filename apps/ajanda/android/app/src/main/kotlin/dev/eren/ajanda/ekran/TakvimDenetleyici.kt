package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.TakvimAyi
import dev.eren.ajanda.cekirdek.TakvimGunOzeti
import dev.eren.ajanda.cekirdek.TakvimOgesi
import java.time.LocalDate
import java.time.YearMonth

/** Takvim sekmesinin bir anlık çizim modeli (arka iş parçacığında kurulur). */
data class TakvimModeli(
    val durum: TakvimDurumu,
    val izgara: Takvim.Izgara,
    /** Ayın gün özetleri; `null`: ay henüz okunmadı (ızgara işaretsiz çizilir). */
    val ozetler: Map<LocalDate, TakvimGunOzeti>?,
    val seritler: Takvim.SeritYerlesimi,
    val gunBasligi: String,
    /** Seçili günün öğe sayısı; `null`: gün henüz okunmadı. */
    val gunSayisi: Int?,
    val kapalilarDahil: Boolean,
)

/**
 * Takvim sekmesinin verisi ve seçimi. [AnaDenetleyici] gibi YALNIZ ekranın arka iş parçacığında çağrılır.
 *
 * Önbellek: son [ENCOK_AY] ay (ay değiştirme anında çizilsin diye komşular önceden okunur) ve seçili
 * gün. Kayıt değişiminde ([gecersizKil]) hepsi atılır: tekrar ve çok günlü öğe yüzünden değişen kaydın
 * hangi ayları etkilediği ucuz bilinmez, sorgu ise ucuzdur (20000 kayıtta ay ~25 ms, `MIMARI.md`).
 */
class TakvimDenetleyici(private val c: CekirdekYuzu) {
    var durum: TakvimDurumu? = null
        private set
    var kapalilarDahil = false
        private set
    var okumaHatasi: String? = null
        private set

    private val aylar = object : LinkedHashMap<YearMonth, TakvimAyi>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<YearMonth, TakvimAyi>?) = size > ENCOK_AY
    }
    private var gunVerisi: Pair<LocalDate, List<TakvimOgesi>>? = null

    /** Şimdiki seçim; ilk çağrıda bugün, gün değiştiyse [TakvimDurumu.bugunGuncelle] kuralıyla. */
    fun durumAl(bugun: LocalDate): TakvimDurumu =
        (durum ?: TakvimDurumu.baslangic(bugun)).bugunGuncelle(bugun).also { durum = it }

    /** Kaydedilmiş seçim (döndürme, süreç ölümü). */
    fun geriYukle(d: TakvimDurumu) {
        durum = d
    }

    fun degistir(bugun: LocalDate, f: (TakvimDurumu) -> TakvimDurumu): TakvimDurumu =
        f(durumAl(bugun)).also { durum = it }

    fun kapalilariGoster(b: Boolean) {
        if (b == kapalilarDahil) return
        kapalilarDahil = b
        gecersizKil()
    }

    fun gecersizKil() {
        aylar.clear()
        gunVerisi = null
    }

    /** Gösterilen ay ve seçili gün önbellekte yoksa okunur. */
    fun gerekeniOku() {
        val d = durum ?: return
        if (d.ay !in aylar) ayOku(d.ay)
        if (gunVerisi?.first != d.secili) gunOku(d.secili)
    }

    /** Önceki ve sonraki ay (ay değiştirme bekletmesin). Gösterilen ay önbellekte en yeni kalır. */
    fun komsulariOku() {
        val d = durum ?: return
        for (ay in listOf(d.ay.plusMonths(1), d.ay.minusMonths(1))) if (ay !in aylar) ayOku(ay)
        aylar[d.ay]
    }

    fun ay(ay: YearMonth): TakvimAyi? = aylar[ay]

    fun gun(t: LocalDate): List<TakvimOgesi>? = gunVerisi?.takeIf { it.first == t }?.second

    /** Seçili günün öğesi (durum değişikliğinin geri alınacak hali ve başlığı için). */
    fun oge(kayitId: String, ornekTarihi: String?): TakvimOgesi? =
        gunVerisi?.second?.firstOrNull { it.gorunum.kayit.kayitId == kayitId && it.ornekTarihi == ornekTarihi }

    /** Önbellekte olan ay ayları (test). */
    val yukluAylar: Set<YearMonth> get() = aylar.keys.toSet()

    private fun ayOku(ay: YearMonth) {
        try {
            aylar[ay] = c.takvimAyi(ay.year, ay.monthValue, kapalilarDahil)
            okumaHatasi = null
        } catch (e: Exception) {
            okumaHatasi = KayitFormu.hataMesaji(e).mesaj
        }
    }

    private fun gunOku(t: LocalDate) {
        try {
            gunVerisi = t to c.takvimGunu(t.toString(), kapalilarDahil)
            okumaHatasi = null
        } catch (e: Exception) {
            okumaHatasi = KayitFormu.hataMesaji(e).mesaj
        }
    }

    /** Çizim modeli; [enCokSira]: ızgarada gösterilen şerit sırası. */
    fun model(bugun: LocalDate, enCokSira: Int = ENCOK_SIRA): TakvimModeli {
        val d = durumAl(bugun)
        val izgara = Takvim.Izgara(d.ay)
        val ay = aylar[d.ay]
        val ozetler = ay?.gunler?.mapNotNull { o -> runCatching { LocalDate.parse(o.tarih) }.getOrNull()?.let { it to o } }?.toMap()
        return TakvimModeli(
            durum = d,
            izgara = izgara,
            ozetler = ozetler,
            seritler = Takvim.seritYerlesimi(izgara, ay?.seritler.orEmpty(), enCokSira),
            gunBasligi = Takvim.gunBasligi(d.secili, bugun),
            gunSayisi = gun(d.secili)?.size,
            kapalilarDahil = kapalilarDahil,
        )
    }

    companion object {
        const val ENCOK_AY = 7
        const val ENCOK_SIRA = 2
    }
}
