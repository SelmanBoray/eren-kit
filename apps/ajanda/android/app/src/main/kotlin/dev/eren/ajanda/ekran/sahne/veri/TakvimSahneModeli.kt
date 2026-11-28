package dev.eren.ajanda.ekran.sahne.veri

import androidx.compose.runtime.Immutable
import dev.eren.ajanda.ekran.Takvim
import dev.eren.ajanda.ekran.TakvimDurumu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import java.time.LocalDate
import java.time.YearMonth

/**
 * Gün hücresinin bir noktası (SAHNE.md §3.6): tek günlük bir kayıt. [renk] kaydın takımı (`null`: günün kayıtları
 * henüz okunmadı, yalnız sayı biliniyor; mürekkep rengiyle çizilir). [tur]: açık dolu, taslak kesikli halka,
 * kapalı (tamamlanmış ya da iptal) %40 saydam.
 */
@Immutable
data class TakvimNoktasi(val renk: LevhaRengi?, val tur: Takvim.Nokta)

/**
 * Ay ızgarasının bir hücresi. [ayda] yanlışsa önceki ya da sonraki ayın günüdür (soluk, işaretsiz; dokununca o
 * aya geçilir). [fazla]: noktalara sığmayan kayıt ya da şerit var (üçüncü noktanın yerine "+", §9). [okunus]:
 * TalkBack'in okuduğu tek cümle ("Perşembe, 12 Mart, bugün. 3 kayıt: 2 açık, 1 taslak."); seçili durum ayrıca.
 */
@Immutable
data class GunHucresi(
    val tarih: LocalDate,
    val ayda: Boolean,
    val noktalar: List<TakvimNoktasi>,
    val fazla: Boolean,
    val okunus: String,
)

/**
 * Birden çok güne yayılan kaydın bir haftadaki parçası (dönem şeridi; SAHNE.md §12.2, Sahne diliyle): kaydın
 * takımında yuvarlak uçlu bant, uç yalnız şeridin gerçek başında/sonunda yuvarlak. [kapali] solar, [taslak]
 * karakalem (kesikli, boyasız).
 */
@Immutable
data class DonemSeridi(
    val anahtar: String,
    val kayitId: String,
    val baslik: String,
    val renk: LevhaRengi,
    val hafta: Int,
    val sira: Int,
    val basSutun: Int,
    val sonSutun: Int,
    val basliyor: Boolean,
    val bitiyor: Boolean,
    val kapali: Boolean,
    val taslak: Boolean,
)

/**
 * Bir ayın ızgarası (pazartesi başlar): [haftalar] × 7 hücre, şeritler ve kullandıkları sıra sayısı. [yuklendi]
 * yanlışsa ay henüz okunmadı ya da okunamadı ([okunamadi]): hücreler işaretsiz çizilir.
 */
@Immutable
data class AyIzgarasi(
    val ay: YearMonth,
    val haftalar: Int,
    val hucreler: List<GunHucresi>,
    val seritler: List<DonemSeridi>,
    val siraSayisi: Int,
    val yuklendi: Boolean,
    val okunamadi: String? = null,
) {
    fun hucre(t: LocalDate): GunHucresi? = hucreler.firstOrNull { it.tarih == t }

    companion object {
        /** Verisi henüz gelmemiş ayın ızgarası: hücreler işaretsiz ("Yükleniyor."). */
        fun bos(ay: YearMonth, bugun: LocalDate): AyIzgarasi {
            val iz = Takvim.Izgara(ay)
            val ilk = ay.atDay(1).minusDays(iz.ilkSutun.toLong())
            val hucreler = (0 until iz.haftaSayisi * 7).map { i ->
                val t = ilk.plusDays(i.toLong())
                val ayda = YearMonth.from(t) == ay
                val okunus = if (ayda) {
                    Takvim.hucreAciklamasi(t, null, bugun, secili = false, yuklendi = false)
                } else {
                    "${dev.eren.ajanda.ekran.EkranMetinleri.uzunTarih(t, bugun)}, ${if (t < ay.atDay(1)) "önceki ay" else "sonraki ay"}."
                }
                GunHucresi(t, ayda, emptyList(), false, okunus)
            }
            return AyIzgarasi(ay, iz.haftaSayisi, hucreler, emptyList(), 0, yuklendi = false)
        }
    }
}

/**
 * Seçili günün kayıtları (YOL-HARITASI 4.3 sırası: bölümsüz saatsizler, gün bölümlüler, saatliler; tamamlanan
 * iş solar ve sona iner). [kayitlar] `null`: gün okunamadı ([okunamadi]).
 */
@Immutable
data class SeciliGun(
    val gun: LocalDate,
    val baslik: String,
    val kayitlar: List<BugunKaydi>?,
    val okunamadi: String? = null,
) {
    val acikSayisi: Int get() = kayitlar.orEmpty().count { it.hal != LevhaHali.BITTI }
    val bitenSayisi: Int get() = kayitlar.orEmpty().count { it.hal == LevhaHali.BITTI }
}

/**
 * Takvim sekmesinin bir anlık modeli (arka iş parçacığında kurulur). [durum]: modelin kurulduğu seçim; ekranın
 * seçimi bundan ileride olabilir (dokunuş anında değişir), ekran ay ve günü seçime göre eşler.
 * [aylar]: gösterilen ay ve okunmuşsa komşuları (kaydırınca hemen çizilsin).
 */
@Immutable
data class TakvimSahneModeli(
    val durum: TakvimDurumu,
    val aylar: Map<YearMonth, AyIzgarasi>,
    val gun: SeciliGun?,
    val bitenleriGizle: Boolean,
    val yuklendi: Boolean,
    val okumaHatasi: String? = null,
) {
    val bugun: LocalDate get() = durum.bugun

    /** [t] gününün ilk kaydının rengi (seçili gün lekesi, §3.6): gün okunduysa listeden, yoksa hücrenin ilk noktasından. */
    fun lekeRengi(t: LocalDate): LevhaRengi? {
        if (gun?.gun == t && gun.kayitlar != null) return gun.kayitlar.firstOrNull()?.renk
        return aylar[YearMonth.from(t)]?.hucre(t)?.noktalar?.firstOrNull()?.renk
    }

    /** Kaydın takvimdeki hâli (ayrıntı için; seçili günde ise). */
    fun ayrintiOzeti(kayitId: String): AyrintiOzeti? {
        val g = gun ?: return null
        val k = g.kayitlar?.firstOrNull { it.kayitId == kayitId } ?: return null
        return AyrintiOzeti(k, g.baslik)
    }

    companion object {
        fun bos(durum: TakvimDurumu, gizle: Boolean) = TakvimSahneModeli(durum, emptyMap(), null, gizle, yuklendi = false)
    }
}
