package dev.eren.olcum.ajanda.cekirdek

/** Çalmayan bir slotun en olası nedeni. Sıra önemli: ilk eşleşen kazanır. */
object Neden {
    const val KAPALI = "telefon kapalıydı"
    const val KAPALI_OLASI = "telefon kapalıydı (olası; kapanış yayını yok)"
    const val ACILIS_SONRASI = "yeniden başlatmadan sonra henüz kurulmamıştı"
    const val ZORLA = "uygulama zorla durdurulmuştu"
    const val KURULMAMIS = "hiç kurulmamıştı (kurma penceresi tükendi)"
    const val ACIKLANAMAYAN = "açıklanamayan (pil yönetimi / Doze?)"

    /** Telefonun kapalı olmasından kaynaklanan kaçırmalar oran hesabına girmez. */
    val ORAN_DISI = setOf(KAPALI, KAPALI_OLASI)
}

data class SeriOzet(
    val kod: String,
    /** Değerlendirilen slot sayısı (bekleyen ve saat-değişimi penceresindekiler hariç). */
    val beklenen: Int,
    val calan: Int,
    val kacan: Int,
    val bekleyen: Int,
    val cift: Int,
    val saatPenceresinde: Int,
    val saatPenceresindeCalan: Int,
    val kacanNedenleri: Map<String, Int>,
    val gecikme: GecikmeIst,
    val kosula: Map<String, GecikmeIst>,
    /** Açıklanamayan kaçırmaların planlanan anları (en çok 30). */
    val aciklanamayan: List<Long>,
) {
    val oranDisiKacan: Int get() = kacanNedenleri.filterKeys { it in Neden.ORAN_DISI }.values.sum()

    /** Telefon kapalıyken düşenler hariç kaçırma oranı (0..1); değerlendirme yoksa null. */
    val kacanOrani: Double?
        get() {
            val payda = beklenen - oranDisiKacan
            return if (payda <= 0) null else (kacan - oranDisiKacan).toDouble() / payda
        }
}

data class BootOzet(
    val boot: Int,
    val acilisDuvar: Long,
    val kapanisYayini: Boolean,
    val acilisYayini: Boolean,
    /** Açılış yayınının açılıştan ne kadar sonra geldiği. */
    val yayinGecikme: Long?,
    /** Alarmların açılıştan ne kadar sonra yeniden kurulduğu; hiç kurulmadıysa null. */
    val kurGecikme: Long?,
    val kurKaynak: String?,
)

data class IsOzet(val id: String, val n: Int, val ortanca: Long?, val p90: Long?, val enUzun: Long?)

data class PencereOzet(
    val ad: String,
    val olay: Int,
    val planli: Int,
    val calan: Int,
    val gecikme: GecikmeIst,
)

data class Ozet(
    val plan: Plan?,
    val simdi: Long,
    val durdurma: Long?,
    val seriler: List<SeriOzet>,
    val bootlar: List<BootOzet>,
    val isler: List<IsOzet>,
    val pencereler: List<PencereOzet>,
    val cikislar: Map<String, Int>,
    val piKontrol: Int,
    val piKayip: Int,
    val isKontrol: Int,
    val isKayip: Int,
    val saatOlay: Int,
    val dilimOlay: Int,
    val olgular: Map<String, String>,
    val olguSayisi: Int,
    val olaySayisi: Int,
    val hataliSatir: Int,
)

object Analiz {
    /** Planlanan anın üzerinden bu kadar geçmeden "kaçtı" denmez. */
    const val BEKLEME = 30 * Plan.DK

    private const val SAAT_PAYI = Plan.DK

    /** ApplicationExitInfo.REASON_* kodlarının adları. */
    val CIKIS_ADLARI = mapOf(
        0 to "bilinmiyor", 1 to "kendi çıktı", 2 to "sinyal", 3 to "düşük bellek",
        4 to "çöktü", 5 to "yerel çökme", 6 to "yanıt vermedi (ANR)", 7 to "başlatma hatası",
        8 to "izin değişti", 9 to "aşırı kaynak", 10 to "kullanıcı zorla durdurdu",
        11 to "kullanıcı durdurdu", 12 to "bağımlılık öldü", 13 to "diğer",
        14 to "donduruldu", 15 to "paket durumu değişti", 16 to "paket güncellendi",
    )

    /** Zorla durdurma sınıfı: bu çıkışlardan sonra sistem alarmları ve işleri siler. */
    val ZORLA_NEDENLER = setOf(10L, 11L)

    private data class Aralik(val bas: Long, val son: Long, val neden: String) {
        fun icinde(t: Long) = t in bas..son
    }

    fun kosul(c: Olay): String = when {
        c.bayrak("idle") == true -> "doze"
        c.bayrak("hafif") == true -> "hafif doze"
        c.bayrak("ekran") == false -> "ekran kapalı"
        c.bayrak("ekran") == true -> "ekran açık"
        else -> "bilinmiyor"
    }

    fun analiz(tum: List<Olay>, simdi: Long, hataliSatir: Int = 0): Ozet {
        val basIdx = tum.indexOfLast { it.tur == Tur.BASLA }
        val plan = if (basIdx >= 0) Plan.ayristir(tum[basIdx]) else null
        val ev = if (basIdx >= 0) tum.subList(basIdx, tum.size) else tum
        val olgular = ev.lastOrNull { it.tur == Tur.OLGU }?.alan
            ?: tum.lastOrNull { it.tur == Tur.OLGU }?.alan ?: emptyMap()
        val durdurma = ev.firstOrNull { it.tur == Tur.DUR }?.duvar

        // --- Açılışlar (boot) ---
        val bootSirasi = LinkedHashMap<Int, MutableList<Olay>>()
        for (o in ev) bootSirasi.getOrPut(o.boot) { ArrayList() }.add(o)
        val bootIdler = bootSirasi.keys.toList()
        val kesintiler = ArrayList<Aralik>()
        val bootlar = ArrayList<BootOzet>()
        for (i in 1 until bootIdler.size) {
            val onceki = bootSirasi.getValue(bootIdler[i - 1])
            val bu = bootSirasi.getValue(bootIdler[i])
            val acilis = bu.first().acilisDuvar
            val kapanis = onceki.lastOrNull { it.tur == Tur.KAPANIS }
            val kapanmaAni = kapanis?.duvar ?: onceki.last().duvar
            kesintiler.add(
                Aralik(kapanmaAni, acilis, if (kapanis != null) Neden.KAPALI else Neden.KAPALI_OLASI),
            )
            val ilkKur = bu.firstOrNull { it.tur == Tur.KUR }
            val sonraki = if (i + 1 < bootIdler.size) bootSirasi.getValue(bootIdler[i + 1]).first().acilisDuvar else simdi
            kesintiler.add(Aralik(acilis, ilkKur?.duvar ?: sonraki, Neden.ACILIS_SONRASI))
            val yayin = bu.firstOrNull { it.tur == Tur.BOOT }
            bootlar.add(
                BootOzet(
                    boot = bootIdler[i],
                    acilisDuvar = acilis,
                    kapanisYayini = kapanis != null,
                    acilisYayini = yayin != null,
                    yayinGecikme = yayin?.gecen,
                    kurGecikme = ilkKur?.gecen,
                    kurKaynak = ilkKur?.metin("kaynak"),
                ),
            )
        }

        // --- Zorla durdurma aralıkları ---
        val cikisOlaylari = ev.filter { it.tur == Tur.CIKIS }
        for (c in cikisOlaylari) {
            val neden = c.sayi("neden") ?: continue
            if (neden !in ZORLA_NEDENLER) continue
            val z = c.sayi("zaman") ?: c.duvar
            val sonrakiAcilis = ev.firstOrNull { it.tur == Tur.ACILIS && it.duvar > z }?.duvar ?: simdi
            kesintiler.add(Aralik(z, sonrakiAcilis, Neden.ZORLA))
        }
        val cikislar = cikisOlaylari
            .groupingBy { CIKIS_ADLARI[it.sayi("neden")?.toInt() ?: -1] ?: "kod ${it.metin("neden")}" }
            .eachCount()

        // --- Saat değişimi pencereleri ---
        val saatPencereleri = ev.filter { it.tur == Tur.SAAT }.map {
            val j = it.sayi("sicrama") ?: 0L
            Aralik(minOf(it.duvar - j, it.duvar) - SAAT_PAYI, maxOf(it.duvar - j, it.duvar) + SAAT_PAYI, "saat")
        }

        val hedefSon = minOf(plan?.son ?: Long.MIN_VALUE, durdurma ?: Long.MAX_VALUE)
        val calmalar = ev.filter { it.tur == Tur.CAL }
        val kurmalar = ev.filter { it.tur == Tur.KUR }

        // Pencere hesabı için tüm seriler birlikte: (planlanan an, çalma olayı?)
        val tumSlotlar = ArrayList<Pair<Long, Olay?>>()

        val seriler = plan?.seriler?.map { s ->
            val kurulu = kurmalar.filter { it.metin("seri") == s.kod }.mapNotNull {
                val a = it.sayi("ilk")?.toInt() ?: return@mapNotNull null
                val b = it.sayi("son")?.toInt() ?: return@mapNotNull null
                a..b
            }
            val bySlot = calmalar.filter { it.metin("seri") == s.kod }
                .groupBy { it.sayi("slot")?.toInt() ?: -1 }
            var beklenen = 0
            var calan = 0
            var bekleyen = 0
            var cift = 0
            var saatte = 0
            var saatteCalan = 0
            val nedenler = LinkedHashMap<String, Int>()
            val gecikmeler = ArrayList<Long>()
            val kosula = LinkedHashMap<String, MutableList<Long>>()
            val aciklanamayan = ArrayList<Long>()
            val sonK = plan.sonOnceki(s, hedefSon).coerceAtMost(plan.sonSlot(s))
            for (k in 0..sonK) {
                val t = plan.zaman(s, k)
                if (t > simdi) break
                val c = bySlot[k]?.minByOrNull { it.duvar }
                if (c != null) cift += (bySlot.getValue(k).size - 1)
                if (saatPencereleri.any { it.icinde(t) }) {
                    saatte++
                    if (c != null) saatteCalan++
                    continue
                }
                if (c == null && t > simdi - BEKLEME) {
                    bekleyen++
                    continue
                }
                beklenen++
                tumSlotlar.add(t to c)
                if (c != null) {
                    calan++
                    val g = c.duvar - t
                    gecikmeler.add(g)
                    kosula.getOrPut("durum: " + kosul(c)) { ArrayList() }.add(g)
                    when (c.bayrak("soguk")) {
                        true -> kosula.getOrPut("süreç: soğuk başlatıldı") { ArrayList() }.add(g)
                        false -> kosula.getOrPut("süreç: zaten çalışıyordu") { ArrayList() }.add(g)
                        null -> {}
                    }
                    when (c.bayrak("muaf")) {
                        true -> kosula.getOrPut("pil: optimizasyondan muaf") { ArrayList() }.add(g)
                        false -> kosula.getOrPut("pil: optimize ediliyor") { ArrayList() }.add(g)
                        null -> {}
                    }
                } else {
                    val n = kesintiler.firstOrNull { it.icinde(t) }?.neden
                        ?: if (kurulu.none { k in it }) Neden.KURULMAMIS else Neden.ACIKLANAMAYAN
                    nedenler[n] = (nedenler[n] ?: 0) + 1
                    if (n == Neden.ACIKLANAMAYAN && aciklanamayan.size < 30) aciklanamayan.add(t)
                }
            }
            SeriOzet(
                kod = s.kod,
                beklenen = beklenen,
                calan = calan,
                kacan = beklenen - calan,
                bekleyen = bekleyen,
                cift = cift,
                saatPenceresinde = saatte,
                saatPenceresindeCalan = saatteCalan,
                kacanNedenleri = nedenler,
                gecikme = GecikmeIst.hesapla(gecikmeler),
                kosula = kosula.mapValues { GecikmeIst.hesapla(it.value) },
                aciklanamayan = aciklanamayan,
            )
        } ?: emptyList()

        // --- Olay sonrası pencereler ---
        fun pencere(ad: String, anlar: List<Long>, uzunluk: Long): PencereOzet {
            val icindekiler = tumSlotlar.filter { (t, _) -> anlar.any { t >= it && t <= it + uzunluk } }
            val g = icindekiler.mapNotNull { (t, c) -> c?.let { it.duvar - t } }
            return PencereOzet(ad, anlar.size, icindekiler.size, g.size, GecikmeIst.hesapla(g))
        }
        val pencereler = listOf(
            pencere("yeniden başlatmadan sonraki 2 sa", bootlar.map { it.acilisDuvar }, 2 * Plan.SAAT),
            pencere(
                "\"kaydıracağım\" işaretinden sonraki 2 sa",
                ev.filter { it.tur == Tur.ISARET && it.metin("tur") == "kaydir" }.map { it.duvar },
                2 * Plan.SAAT,
            ),
            pencere("saat dilimi değişiminden sonraki 1 sa", ev.filter { it.tur == Tur.DILIM }.map { it.duvar }, Plan.SAAT),
        )

        // --- Periyodik işler ---
        val isler = ev.filter { it.tur == Tur.IS }
            .groupBy { it.metin("id") ?: "?" }
            .toSortedMap()
            .map { (id, l) ->
                val z = l.map { it.duvar }.sorted()
                val araliklar = z.zipWithNext { a, b -> b - a }
                IsOzet(id, l.size, Istatistik.ortanca(araliklar), Istatistik.yuzdelik(araliklar, 90), araliklar.maxOrNull())
            }

        val pi = ev.filter { it.tur == Tur.PI }
        val isv = ev.filter { it.tur == Tur.ISVAR }
        return Ozet(
            plan = plan,
            simdi = simdi,
            durdurma = durdurma,
            seriler = seriler,
            bootlar = bootlar,
            isler = isler,
            pencereler = pencereler,
            cikislar = cikislar,
            piKontrol = pi.size,
            piKayip = pi.count { it.bayrak("var") == false },
            isKontrol = isv.size,
            isKayip = isv.count { it.bayrak("var") == false },
            saatOlay = ev.count { it.tur == Tur.SAAT },
            dilimOlay = ev.count { it.tur == Tur.DILIM },
            olgular = olgular,
            olguSayisi = ev.count { it.tur == Tur.OLGU },
            olaySayisi = ev.size,
            hataliSatir = hataliSatir,
        )
    }
}
