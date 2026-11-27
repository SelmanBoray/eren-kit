package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.TakvimGunOzeti
import dev.eren.ajanda.cekirdek.TakvimOgesi
import dev.eren.ajanda.cekirdek.TakvimSeridi
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Takvim sekmesinin görünüm mantığı (saf; Android'siz birim testli): ay ızgarasının yerleşimi (hafta
 * pazartesi başlar), çok günlü şeritlerin haftalara bölünüp sıralara (şerit hattı) yerleşmesi, gün
 * hücresinin işaretleri ve ekran okuyucu metni, seçili günün satırları.
 *
 * Veri çekirdektedir (`takvimAyi`, `takvimGunu`; kurallar `cekirdek/src/motor/takvim.rs`): gün sınırı,
 * sıra, tekrar örnekleri ve görünürlük orada; burada yalnız gösterim. Ay dışındaki (önceki/sonraki ayın)
 * hücreler boştur: çekirdek yalnız ayın günlerini sayar, sayısız gün göstermek yanıltırdı.
 */
object Takvim {

    /** Bir ayın ızgarası: [ilkSutun] ayın 1'inin sütunu (0 = pazartesi), [haftaSayisi] 4..6. */
    data class Izgara(val ay: YearMonth) {
        val ilkSutun: Int = ay.atDay(1).dayOfWeek.value - 1
        val gunSayisi: Int = ay.lengthOfMonth()
        val haftaSayisi: Int = (ilkSutun + gunSayisi + 6) / 7

        /** Ayın günü için (hafta, sütun). */
        fun yer(t: LocalDate): Pair<Int, Int> {
            require(YearMonth.from(t) == ay) { "$t bu ayda değil ($ay)" }
            val i = ilkSutun + t.dayOfMonth - 1
            return i / 7 to i % 7
        }

        /** Hücredeki gün; ay dışıysa null. */
        fun gun(hafta: Int, sutun: Int): LocalDate? {
            val n = hafta * 7 + sutun - ilkSutun + 1
            return if (n in 1..gunSayisi) ay.atDay(n) else null
        }

        fun hafta(h: Int): List<LocalDate?> = (0 until 7).map { gun(h, it) }
    }

    // ---------------------------------------------------------------------------------------------
    // Şeritler
    // ---------------------------------------------------------------------------------------------

    /**
     * Bir şeridin bir haftadaki parçası (ayın içine kırpılmış). [basliyor]/[bitiyor]: şeridin gerçek ucu
     * bu parçada mı (değilse uç düz çizilir: önceki/sonraki haftaya ya da aya sürüyor).
     */
    data class SeritParcasi(
        val serit: TakvimSeridi,
        val hafta: Int,
        val sira: Int,
        val basSutun: Int,
        val sonSutun: Int,
        val basliyor: Boolean,
        val bitiyor: Boolean,
    )

    /** Görünen parçalar, ayın kullandığı sıra sayısı ve sığmadığı için gizlenen şerit sayısı (gün başına). */
    data class SeritYerlesimi(
        val parcalar: List<SeritParcasi>,
        val siraSayisi: Int,
        val gizli: Map<LocalDate, Int>,
    ) {
        fun haftadakiler(h: Int) = parcalar.filter { it.hafta == h }
    }

    /**
     * Şeritleri haftalara böler ve her haftada açgözlü sıraya yerleştirir: çekirdeğin sırasıyla (ilk gün
     * artan, uzun önce) her parça, sütunları boş olan en üst sıraya. [enCokSira]'nın altına düşenler
     * çizilmez, kapladıkları günlerde [SeritYerlesimi.gizli] sayılır. Bozuk tarihli şerit atlanır.
     */
    fun seritYerlesimi(izgara: Izgara, seritler: List<TakvimSeridi>, enCokSira: Int): SeritYerlesimi {
        val ayBas = izgara.ay.atDay(1)
        val aySon = izgara.ay.atEndOfMonth()
        val parcalar = mutableListOf<SeritParcasi>()
        val gizli = mutableMapOf<LocalDate, Int>()
        var siraSayisi = 0
        // hafta -> sıra -> dolu sütunlar
        val doluluk = Array(izgara.haftaSayisi) { mutableListOf<BooleanArray>() }
        for (s in seritler) {
            val ilk = tarih(s.ilkGun) ?: continue
            val son = tarih(s.sonGun) ?: continue
            if (son < ilk || son < ayBas || ilk > aySon) continue
            val bas = maxOf(ilk, ayBas)
            val bit = minOf(son, aySon)
            var h = izgara.yer(bas).first
            val sonHafta = izgara.yer(bit).first
            while (h <= sonHafta) {
                val gunler = izgara.hafta(h)
                val sutunlar = gunler.indices.filter { i -> gunler[i]?.let { it in bas..bit } == true }
                val b = sutunlar.first()
                val e = sutunlar.last()
                val siralar = doluluk[h]
                var sira = siralar.indexOfFirst { dolu -> (b..e).none { dolu[it] } }
                if (sira < 0) {
                    siralar += BooleanArray(7)
                    sira = siralar.lastIndex
                }
                for (i in b..e) siralar[sira][i] = true
                if (sira < enCokSira) {
                    parcalar += SeritParcasi(s, h, sira, b, e, basliyor = gunler[b] == ilk, bitiyor = gunler[e] == son)
                    siraSayisi = maxOf(siraSayisi, sira + 1)
                } else {
                    for (i in b..e) gunler[i]?.let { gizli[it] = (gizli[it] ?: 0) + 1 }
                }
                h++
            }
        }
        return SeritYerlesimi(parcalar, siraSayisi, gizli)
    }

    private fun tarih(s: String): LocalDate? = runCatching { LocalDate.parse(s) }.getOrNull()

    // ---------------------------------------------------------------------------------------------
    // Gün hücresi
    // ---------------------------------------------------------------------------------------------

    enum class Nokta { ACIK, TASLAK, KAPALI }

    /**
     * Hücrenin noktaları: yalnız tek günlük öğeler (çok günlüler şerittir). En çok 3 nokta; her var olan
     * tür en az bir nokta alır, kalan yer önce açıklara. [fazla]: 3'ten çok tek günlük öğe var.
     * Çekirdeğin sayıları çok günlüleri de içerir; tür payları tek günlük sayıyla sınırlanır (yaklaşık).
     */
    data class Isaretler(val noktalar: List<Nokta>, val fazla: Boolean)

    fun isaretler(o: TakvimGunOzeti?): Isaretler {
        if (o == null) return Isaretler(emptyList(), false)
        val tek = (o.toplam - o.serit).coerceAtLeast(0)
        val taslak = o.taslak.coerceIn(0, tek)
        val kapali = o.kapali.coerceIn(0, tek - taslak)
        val acik = tek - taslak - kapali
        val sayilar = linkedMapOf(Nokta.ACIK to acik, Nokta.TASLAK to taslak, Nokta.KAPALI to kapali)
        val noktalar = sayilar.filterValues { it > 0 }.keys.toMutableList()
        val kalan = sayilar.mapValues { (_, n) -> (n - 1).coerceAtLeast(0) }.toMutableMap()
        while (noktalar.size < ENCOK_NOKTA) {
            val tur = Nokta.entries.firstOrNull { (kalan[it] ?: 0) > 0 } ?: break
            kalan[tur] = kalan.getValue(tur) - 1
            noktalar += tur
        }
        noktalar.sortBy { it.ordinal }
        return Isaretler(noktalar.take(ENCOK_NOKTA), tek > ENCOK_NOKTA)
    }

    const val ENCOK_NOKTA = 3

    /** Ekran okuyucu: "Cuma, 27 Kasım, bugün, seçili. 3 kayıt: 2 açık, 1 taslak; 1 çok günlü." */
    fun hucreAciklamasi(t: LocalDate, o: TakvimGunOzeti?, bugun: LocalDate, secili: Boolean, yuklendi: Boolean = true): String = buildString {
        append(EkranMetinleri.uzunTarih(t, bugun))
        if (t == bugun) append(", bugün")
        if (secili) append(", seçili")
        append(". ")
        when {
            !yuklendi -> append("Yükleniyor.")
            o == null || o.toplam == 0 -> append("Kayıt yok.")
            else -> {
                append(o.toplam).append(" kayıt")
                val parcalar = listOfNotNull(
                    "${o.acik} açık".takeIf { o.acik > 0 && o.acik != o.toplam },
                    "${o.kapali} tamamlanmış ya da iptal".takeIf { o.kapali > 0 },
                    "${o.taslak} taslak".takeIf { o.taslak > 0 },
                )
                if (parcalar.isNotEmpty()) append(": ").append(parcalar.joinToString(", "))
                if (o.serit > 0) append("; ").append(o.serit).append(" çok günlü")
                append('.')
            }
        }
    }

    /** Seçili günün başlığı: "Bugün · Cuma, 27 Kasım", "Yarın · …", "Pazartesi, 4 Ocak 2027". */
    fun gunBasligi(t: LocalDate, bugun: LocalDate): String {
        val uzun = EkranMetinleri.uzunTarih(t, bugun)
        return when (EkranMetinleri.goreliGun(t, bugun)) {
            "bugün" -> "Bugün · $uzun"
            "yarın" -> "Yarın · $uzun"
            "dün" -> "Dün · $uzun"
            else -> uzun
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Seçili günün satırları (Tarihli sekmesinin satırı: [Liste.satir])
    // ---------------------------------------------------------------------------------------------

    /**
     * Seçili günün liste öğeleri, çekirdeğin sırasıyla. Satır Tarihli sekmesindekiyle aynıdır; yalnız yer
     * öğeden gelir (tekrarda örneğin günü ve saati, durumu da örneğinki) ve gün başlıkta yazdığı için
     * satırda tarih yok. Açık, tekrarsız ve günü geçmiş öğe gecikmiş görünür.
     */
    fun satirlar(ogeler: List<TakvimOgesi>, gun: LocalDate, simdi: ZonedDateTime, gonderim: Liste.Gonderim): List<Liste.Oge> {
        if (ogeler.isEmpty()) return listOf(Liste.Oge.Bos(BOS_GUN))
        return ogeler.mapNotNull { o -> satir(o, gun, simdi, gonderim)?.let { Liste.Oge.Satir(it) } }
    }

    const val BOS_GUN = "Bu gün için kayıt yok."

    fun satir(o: TakvimOgesi, gun: LocalDate, simdi: ZonedDateTime, gonderim: Liste.Gonderim): Liste.KayitSatiri? {
        val ilk = tarih(o.ilkGun) ?: return null
        val son = tarih(o.sonGun) ?: ilk
        val saat = o.saat?.let { runCatching { LocalTime.parse(it) }.getOrNull() }
        val g = o.gorunum.copy(kayit = o.gorunum.kayit.copy(durum = o.durum))
        val k = g.kayit
        val z = k.zaman
        val konum = Liste.Konum(
            ilkGun = ilk,
            sonGun = son,
            saat = saat,
            kendiSaati = if (z is AjandaZamani.An) kendiSaati(z, o.ornekTarihi, simdi.zone) else null,
            gunBolumu = (z as? AjandaZamani.Gun)?.gunBolumu,
        )
        val bugun = simdi.toLocalDate()
        val zaman = when {
            // Önceki günden süren saatli öğe: başlangıç saati bu günün saati değildir.
            z is AjandaZamani.An && gun > ilk -> if (gun < son || o.bitisSaati == null) "Sürüyor · tüm gün" else "Sürüyor · bitiş ${o.bitisSaati}"
            // Grup BUGUN: satır tarih yazmaz (gün başlıkta), saatsize "Tüm gün", bugünse geçen saate "geçti".
            else -> Liste.zamanMetni(k, konum, Liste.Grup.BUGUN, simdi)
        }
        val gecikmis = o.durum == KayitDurumu.ACIK && o.ornekTarihi == null && k.tekrar == null && son < bugun
        return Liste.satir(g, simdi, Liste.Grup.BUGUN, konum, gonderim, zaman = zaman, gecikmis = gecikmis, ornekTarihi = o.ornekTarihi)
    }

    /** Kaydın dilimi bu günde cihazınkinden farklı ofsetteyse kendi saati ("15:00 Europe/London"). */
    private fun kendiSaati(z: AjandaZamani.An, ornekTarihi: String?, cihaz: ZoneId): String? = try {
        val kendi = ZoneId.of(z.saatDilimi)
        val yerel = ZonedDateTime.of(LocalDate.parse(ornekTarihi ?: z.tarih), LocalTime.parse(z.saat), kendi)
        if (yerel.offset != yerel.withZoneSameInstant(cihaz).offset) "${z.saat} ${z.saatDilimi}" else null
    } catch (_: Exception) {
        null
    }

    /** Lejant: yalnız ayda görünen türler (kapalılar gizliyken "kapalı" yok). */
    fun lejant(kapalilarDahil: Boolean): List<Pair<Nokta, String>> = listOfNotNull(
        Nokta.ACIK to "Açık",
        Nokta.TASLAK to "Taslak",
        (Nokta.KAPALI to "Kapalı").takeIf { kapalilarDahil },
    )
}

/**
 * Takvim sekmesinin seçimi: gösterilen ay ve seçili gün (her zaman o ayda), bir de seçimin yapıldığı
 * "bugün". Gece yarısı geçince bugünü seçili olan kullanıcı yeni güne (gerekirse yeni aya) taşınır;
 * başka bir gün seçtiyse seçimi korunur. Saf ve değişmez; ekran durumu [metin] ile saklanır.
 */
data class TakvimDurumu(val ay: YearMonth, val secili: LocalDate, val bugun: LocalDate) {
    init {
        require(YearMonth.from(secili) == ay) { "seçili gün gösterilen ayda olmalı" }
    }

    fun gunSec(t: LocalDate) = copy(ay = YearMonth.from(t), secili = t)

    /** Ay değişir: o ay bugünü içeriyorsa bugün, değilse ayın 1'i seçilir. */
    fun ayKaydir(n: Long): TakvimDurumu {
        val yeni = ay.plusMonths(n)
        return copy(ay = yeni, secili = if (YearMonth.from(bugun) == yeni) bugun else yeni.atDay(1))
    }

    fun bugune() = copy(ay = YearMonth.from(bugun), secili = bugun)

    /** Bugünü mü gösteriyor (ekran "Bugün" düğmesini gizler). */
    val bugunde: Boolean get() = secili == bugun

    /** Gün değişti (gece yarısı, saat/dilim değişimi ya da uzun aradan sonra açılış). */
    fun bugunGuncelle(yeni: LocalDate): TakvimDurumu = when {
        yeni == bugun -> this
        secili == bugun -> TakvimDurumu(YearMonth.from(yeni), yeni, yeni)
        else -> copy(bugun = yeni)
    }

    /** "2026-11|2026-11-27|2026-11-27" (ay|seçili|bugün). */
    fun metin(): String = "$ay|$secili|$bugun"

    companion object {
        fun baslangic(bugun: LocalDate) = TakvimDurumu(YearMonth.from(bugun), bugun, bugun)

        /** [metin]'in tersi; bozuksa null. Seçili gün ayda değilse ay seçili güne uyar. */
        fun coz(s: String?): TakvimDurumu? {
            val p = s?.split('|') ?: return null
            if (p.size != 3) return null
            return try {
                val secili = LocalDate.parse(p[1])
                val bugun = LocalDate.parse(p[2])
                val ay = YearMonth.parse(p[0]).takeIf { it == YearMonth.from(secili) } ?: YearMonth.from(secili)
                TakvimDurumu(ay, secili, bugun)
            } catch (_: Exception) {
                null
            }
        }
    }
}
