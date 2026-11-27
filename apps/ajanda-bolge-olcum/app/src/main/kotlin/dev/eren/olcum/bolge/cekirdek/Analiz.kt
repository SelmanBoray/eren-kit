package dev.eren.olcum.bolge.cekirdek

/** Analiz eşikleri. Değiştirmek ölçümün anlamını değiştirir; README'deki karar ölçütüyle aynı tutulmalı. */
object Sabit {
    const val SN = 1_000L
    const val DK = 60_000L
    const val SAAT = 60 * DK

    /** Gerçek varış anı tahmini (etiket) kaba olduğundan algı bu kadar ÖNCE de gelmiş olabilir. */
    const val ONCE = 10 * DK
    /** Gerçek olaydan sonra algının beklendiği en uzun süre; aşılırsa "kaçtı". */
    const val SONRA = 60 * DK
    /** Aynı bölge/yön için bu süre içindeki gerçek olaylar tek olaydır (elle + etiket). */
    const val BIRLESTIR = 20 * DK
    /** Kol kurulduktan bu süre içinde gelen algı "kurulum tetiği"dir (zaten içerideyken kurulma). */
    const val KURULUM = 3 * DK
    /** Play Hizmetleri bekleme (DWELL) süresi; kurulumda da bu kullanılır. */
    const val BEKLEME = 3 * DK
    /** Bir bildirime (bölüme) katılma süresi. */
    const val BOLUM = 30 * DK
    /** Önünden geçme olayına yakın sayılan algı penceresi. */
    const val GECIS_ONCE = 10 * DK
    const val GECIS_SONRA = 15 * DK
    /** Elle kayıt için uygulama açılır; bu kadar önceki ekran açılışı "kullanıcı uygulamayı açtı" sayılmaz. */
    const val EKRAN_PAYI = 2 * DK

    const val MIN_ORNEK = 10
    const val ESIK_KACIRMA = 0.05
    const val ESIK_P95 = 5 * DK
}

object Kol {
    const val GMS = "gms"
    const val CERCEVE = "cerceve"
    const val WIFI = "wifi"
    val HEPSI = listOf(GMS, CERCEVE, WIFI)

    fun ad(k: String) = when (k) {
        GMS -> "Play Hizmetleri geofence"
        CERCEVE -> "Android yakınlık uyarısı"
        WIFI -> "Wi-Fi bağlantısı"
        else -> k
    }
}

object Gecis {
    const val GIRIS = "giris"
    const val CIKIS = "cikis"
    const val BEKLE = "bekle"
    const val GECTI = "gecti"

    fun ad(g: String) = when (g) {
        GIRIS -> "giriş"
        CIKIS -> "çıkış"
        BEKLE -> "bekleme (${Sabit.BEKLEME / Sabit.DK} dk)"
        GECTI -> "önünden geçme"
        else -> g
    }
}

object Cevap {
    const val VARDIM = "vardim"
    const val CIKTIM = "ciktim"
    const val GECTI = "gecti"
    const val ZATEN = "zaten"
    const val CIKMADIM = "cikmadim"
    const val DEGIL = "degil"

    const val Y_GECIS = "önünden geçme"
    const val Y_SINIR = "sınır/zaten içerideydim"
    const val Y_HAYALI = "hayali (bölgede değildim)"
    val YANLIS_TURLERI = listOf(Y_GECIS, Y_SINIR, Y_HAYALI)

    fun yanlisTuru(c: String?): String? = when (c) {
        GECTI -> Y_GECIS
        ZATEN, CIKMADIM -> Y_SINIR
        DEGIL -> Y_HAYALI
        else -> null
    }
}

enum class Yon { GIRIS, CIKIS }

fun yonu(gecis: String): Yon = if (gecis == Gecis.CIKIS) Yon.CIKIS else Yon.GIRIS

/** Raporda bir satır: bir kolun bir geçiş türü. */
data class Satir(val kol: String, val gecis: String) {
    val yon: Yon get() = yonu(gecis)
    val ad: String get() = "${Kol.ad(kol)} · ${Gecis.ad(gecis)}"

    companion object {
        val GIRISLER = listOf(
            Satir(Kol.GMS, Gecis.GIRIS), Satir(Kol.GMS, Gecis.BEKLE),
            Satir(Kol.CERCEVE, Gecis.GIRIS), Satir(Kol.WIFI, Gecis.GIRIS),
        )
        val CIKISLAR = listOf(Satir(Kol.GMS, Gecis.CIKIS), Satir(Kol.CERCEVE, Gecis.CIKIS))
    }
}

data class Algi(
    val zaman: Long,
    val kol: String,
    val gecis: String,
    val bolge: Int,
    val bolum: Int,
    /** Kol kurulduktan hemen sonra geldi (kurulum tetiği): varış sayılmaz. */
    val ilk: Boolean,
    val olay: Olay,
)

/** Kullanıcının bildirdiği gerçek varış/çıkış. kaynak: "elle" ya da "etiket". */
data class Gercek(
    val zaman: Long,
    val bolge: Int,
    val yon: Yon,
    val kaynak: String,
    val olay: Olay,
)

/** Kullanıcının bildirdiği "yalnız önünden geçtim". */
data class GecisOlayi(val zaman: Long, val bolge: Int, val kaynak: String)

data class Bolum(
    val id: Int,
    val bolge: Int,
    val yon: Yon,
    val ilk: Long,
    val kollar: List<String>,
    val etiket: String?,
    val kurulum: Boolean,
)

data class Eslesme(
    val gercek: Gercek,
    val algi: Algi?,
    /** eslesti | kacti | bekliyor */
    val sonuc: String,
    val neden: String?,
    val kosullar: Set<String>,
)

data class SatirOzeti(
    val satir: Satir,
    val eslesen: Int,
    val kacan: Int,
    val bekleyen: Int,
    val kacanNedenleri: Map<String, Int>,
    /** Kaçırma oranının paydası/payı (konum kullanıcı tarafından kapatılmışken olanlar hariç). */
    val kacirmaPay: Int,
    val kacirmaPayda: Int,
    val gecikme: GecikmeIst,
    val erken: Int,
    val yanlis: Map<String, Int>,
    val tekrar: Int,
    val etiketsiz: Int,
    val kurulum: Int,
    val gecisTetik: Int,
    val gecisToplam: Int,
    val kosulGecikme: Map<String, GecikmeIst>,
    val kosulKacirma: Map<String, Pair<Int, Int>>,
) {
    val kacirmaOrani: Double? get() = if (kacirmaPayda == 0) null else kacirmaPay.toDouble() / kacirmaPayda
    val yanlisToplam: Int get() = yanlis.values.sum()
    val yanlisOrani: Double? get() = (eslesen + yanlisToplam).let { if (it == 0) null else yanlisToplam.toDouble() / it }

    val karar: String
        get() {
            if (kacirmaPayda < Sabit.MIN_ORNEK) return "VERİ YETERSİZ (gerçek olay ${kacirmaPayda}, en az ${Sabit.MIN_ORNEK})"
            val k = kacirmaOrani ?: return "VERİ YETERSİZ"
            val p = gecikme.p95
            val sorun = ArrayList<String>()
            if (k >= Sabit.ESIK_KACIRMA) sorun += "kaçırma ≥ %5"
            if (p == null || p >= Sabit.ESIK_P95) sorun += "gecikme p95 ≥ 5 dk"
            return if (sorun.isEmpty()) "GEÇER" else "GEÇMEZ (" + sorun.joinToString(", ") + ")"
        }
}

data class BolgeBilgi(val id: Int, val yaricap: Int?, val wifi: Boolean, val dogruluk: Int?, val silindi: Boolean)

data class BootBilgi(
    val acilis: Long,
    val kapanisYayini: Boolean,
    /** Açılış yayınının açılıştan sonraki gecikmesi (ms); gelmediyse null. */
    val yayin: Long?,
    /** kol -> (açılıştan sonra ms, neden) */
    val kurlar: Map<String, Pair<Long, String>>,
    val ilkCanlanma: String?,
    val ilkCanlanmaMs: Long?,
    val kurulumTetikleri: List<String>,
)

data class KonumDongusu(
    val kapanma: Long,
    val acilma: Long?,
    val gmsHata: Boolean,
    /** kol -> (açılmadan sonra ms, neden) */
    val kurlar: Map<String, Pair<Long, String>>,
)

data class PilDonemi(val ad: String, val saat: Double, val dusus: Int) {
    val oran: Double? get() = if (saat < 0.5) null else dusus / saat
}

data class DonemOzeti(val ad: String, val satirlar: List<SatirOzeti>)

data class Ozet(
    val simdi: Long,
    val bas: Long?,
    val durdurma: Long?,
    val bolgeler: List<BolgeBilgi>,
    val gercekGiris: Int,
    val gercekCikis: Int,
    val gecisSayisi: Int,
    val etiketsizBolum: Int,
    val donemler: List<DonemOzeti>,
    val bootlar: List<BootBilgi>,
    val konumDongu: List<KonumDongusu>,
    val konumAlma: List<Olay>,
    val pil: List<PilDonemi>,
    val wifi: Map<String, Int>,
    val denetim: Map<String, Pair<Int, Int>>,
    val kurHatalari: Map<String, Int>,
    val gmsHatalari: Map<String, Int>,
    val cikislar: Map<String, Int>,
    val beyanlar: Map<String, String>,
    val olgular: Map<String, String>,
    val olaySayisi: Int,
    val hataliSatir: Int,
)

object Analiz {
    private const val K_KAYDIRMA = "kaydırıp atma sonrası"
    private const val K_BOOT = "yeniden başlatma sonrası (uygulama açılmadan)"
    private const val K_KONUM = "konum kapatıp açma sonrası"
    private const val K_TASARRUF = "pil tasarrufu açık"
    private const val K_OLAGAN = "olağan"

    const val N_KONUM_KAPALI = "konum kapalıydı"
    const val N_KURULU_DEGIL = "kol kurulu değildi"
    const val N_ACIKLANAMAYAN = "açıklanamayan"

    // ------------------------------------------------------------------ yardımcı yapılar

    private class Baglam(olaylar: List<Olay>) {
        val sirali = olaylar.sortedBy { it.duvar }
        val ekranlar = sirali.filter { it.tur == Tur.EKRAN }.map { it.duvar }
        val isaretler = sirali.filter { it.tur == Tur.ISARET }
        val konumlar = sirali.filter { it.tur == Tur.KONUM }
        val donemler = sirali.filter { it.tur == Tur.DONEM }
        val bootlar: List<Pair<String, List<Olay>>>
        val yenidenBaslatmalar: List<Long>

        init {
            val g = LinkedHashMap<String, MutableList<Olay>>()
            for (o in olaylar) g.getOrPut(bootAnahtari(o)) { ArrayList() }.add(o)
            bootlar = g.entries.map { it.key to it.value.sortedBy { o -> o.gecen } }
                .sortedBy { (_, l) -> l.minOf { it.acilisDuvar } }
            yenidenBaslatmalar = bootlar.drop(1).map { (_, l) -> l.minOf { it.acilisDuvar } }
        }

        fun sonEkran(t: Long): Long = ekranlar.lastOrNull { it <= t - Sabit.EKRAN_PAYI } ?: Long.MIN_VALUE

        fun donem(t: Long): Int = donemler.lastOrNull { it.duvar <= t }?.tam("no") ?: 1

        fun konumAcik(t: Long): Boolean = konumlar.lastOrNull { it.duvar <= t }?.bayrak("etkin") ?: true

        /** t anında kol kurulu muydu: KUR ok -> evet; KUR hata, yeniden başlatma, konum kapanması (gms) -> hayır. */
        fun kurulu(kol: String, t: Long): Boolean {
            data class D(val z: Long, val v: Boolean)
            val d = ArrayList<D>()
            for (o in sirali) {
                if (o.duvar > t) break
                when (o.tur) {
                    Tur.KUR -> if (o.metin("kol") == kol) d += D(o.duvar, o.metin("sonuc") == "ok")
                    Tur.DUR -> d += D(o.duvar, false)
                    Tur.KONUM -> if (kol == Kol.GMS && o.bayrak("etkin") == false) d += D(o.duvar, false)
                    Tur.GMSHATA -> if (kol == Kol.GMS && o.metin("kod") == "1000") d += D(o.duvar, false)
                }
            }
            for (r in yenidenBaslatmalar) if (r <= t) d += D(r, false)
            return d.maxByOrNull { it.z }?.v ?: false
        }

        fun tasarruf(t: Long, kaynak: Olay): Boolean =
            kaynak.bayrak("tasarruf") ?: (sirali.lastOrNull { it.duvar <= t && it.alan.containsKey("tasarruf") }?.bayrak("tasarruf") == true)

        fun kosullar(g: Gercek): Set<String> {
            val s = LinkedHashSet<String>()
            val e = sonEkran(g.zaman)
            if (isaretler.any { it.metin("tur") == "kaydir" && it.duvar > e && it.duvar <= g.zaman }) s += K_KAYDIRMA
            if (yenidenBaslatmalar.any { it > e && it <= g.zaman }) s += K_BOOT
            if (konumlar.any { it.bayrak("etkin") == true && it.bayrak("ilk") != true && it.duvar > e && it.duvar <= g.zaman } ||
                isaretler.any { it.metin("tur") == "konum" && it.duvar > e && it.duvar <= g.zaman }
            ) s += K_KONUM
            if (tasarruf(g.zaman, g.olay)) s += K_TASARRUF
            if (s.isEmpty()) s += K_OLAGAN
            return s
        }
    }

    fun bootAnahtari(o: Olay): String = if (o.boot >= 0) "b${o.boot}" else "a${o.acilisDuvar / 30_000}"

    fun algilar(olaylar: List<Olay>): List<Algi> = olaylar.filter { it.tur == Tur.ALGI }.mapNotNull { o ->
        val kol = o.metin("kol") ?: return@mapNotNull null
        val gecis = o.metin("gecis") ?: return@mapNotNull null
        val bolge = o.tam("bolge") ?: return@mapNotNull null
        val ks = o.sayi("kurSonrasi")
        val pencere = Sabit.KURULUM + if (gecis == Gecis.BEKLE) Sabit.BEKLEME else 0L
        Algi(o.duvar, kol, gecis, bolge, o.tam("bolum") ?: -1, ks != null && ks in 0..pencere, o)
    }.sortedBy { it.zaman }

    private fun etiketler(olaylar: List<Olay>): Map<Int, Olay> {
        val m = HashMap<Int, Olay>()
        for (o in olaylar.sortedBy { it.duvar }) if (o.tur == Tur.ETIKET) o.tam("bolum")?.let { m[it] = o }
        return m
    }

    fun bolumler(olaylar: List<Olay>): List<Bolum> {
        val et = etiketler(olaylar)
        return algilar(olaylar).filter { it.bolum >= 0 }.groupBy { it.bolum }.map { (id, l) ->
            Bolum(
                id, l.first().bolge, yonu(l.first().gecis), l.first().zaman,
                l.map { "${it.kol}/${it.gecis}" }.distinct(), et[id]?.metin("cevap"), l.all { it.ilk },
            )
        }.sortedByDescending { it.ilk }
    }

    /** Elle ve etiketle bildirilen gerçek varış/çıkışlar; yakın olanlar birleştirilir (elle olan yeğlenir). */
    fun gercekler(olaylar: List<Olay>): List<Gercek> {
        val ham = ArrayList<Gercek>()
        for (o in olaylar) {
            if (o.tur != Tur.ELLE) continue
            val g = o.metin("gecis") ?: continue
            if (g != Gecis.GIRIS && g != Gecis.CIKIS) continue
            val b = o.tam("bolge") ?: continue
            ham += Gercek(o.duvar - (o.sayi("dk") ?: 0) * Sabit.DK, b, yonu(g), "elle", o)
        }
        val bolumIlk = algilar(olaylar).groupBy { it.bolum }.mapValues { it.value.first() }
        for ((bolum, e) in etiketler(olaylar)) {
            val c = e.metin("cevap")
            if (c != Cevap.VARDIM && c != Cevap.CIKTIM) continue
            val a = bolumIlk[bolum] ?: continue
            ham += Gercek(a.zaman - (e.sayi("dk") ?: 0) * Sabit.DK, a.bolge, if (c == Cevap.VARDIM) Yon.GIRIS else Yon.CIKIS, "etiket", a.olay)
        }
        val sonuc = ArrayList<Gercek>()
        for ((_, l) in ham.groupBy { it.bolge to it.yon }) {
            val s = l.sortedBy { it.zaman }
            var i = 0
            while (i < s.size) {
                val bas = s[i].zaman
                var j = i
                while (j + 1 < s.size && s[j + 1].zaman - bas <= Sabit.BIRLESTIR) j++
                val kume = s.subList(i, j + 1)
                sonuc += kume.firstOrNull { it.kaynak == "elle" } ?: kume.first()
                i = j + 1
            }
        }
        return sonuc.sortedBy { it.zaman }
    }

    fun gecisler(olaylar: List<Olay>): List<GecisOlayi> {
        val l = ArrayList<GecisOlayi>()
        for (o in olaylar) if (o.tur == Tur.ELLE && o.metin("gecis") == Gecis.GECTI) {
            val b = o.tam("bolge") ?: continue
            l += GecisOlayi(o.duvar - (o.sayi("dk") ?: 0) * Sabit.DK, b, "elle")
        }
        val bolumIlk = algilar(olaylar).groupBy { it.bolum }.mapValues { it.value.first() }
        for ((bolum, e) in etiketler(olaylar)) if (e.metin("cevap") == Cevap.GECTI) {
            val a = bolumIlk[bolum] ?: continue
            l += GecisOlayi(a.zaman, a.bolge, "etiket")
        }
        return l.sortedBy { it.zaman }
    }

    /** t anında bölgeye Wi-Fi eşli miydi (BOLGE wifi / WIFIBAG olaylarına göre). */
    private fun wifiEsli(sirali: List<Olay>, bolge: Int, t: Long): Boolean {
        var v = false
        for (o in sirali) {
            if (o.duvar > t) break
            if (o.tur == Tur.BOLGE && o.tam("id") == bolge) v = o.bayrak("wifi") == true
            if (o.tur == Tur.WIFIBAG && o.tam("id") == bolge) v = o.bayrak("var") == true
        }
        return v
    }

    // ------------------------------------------------------------------ eşleştirme

    private class SatirHam(
        val satir: Satir,
        val eslesmeler: List<Eslesme>,
        /** her algı için tür: eslesti | kurulum | tekrar | etiketsiz | yanlış türü */
        val turler: List<Pair<Algi, String>>,
        val gecisler: List<Pair<GecisOlayi, Boolean>>,
    )

    private fun satirEslestir(
        s: Satir,
        tum: List<Algi>,
        gercekler: List<Gercek>,
        gecisler: List<GecisOlayi>,
        et: Map<Int, Olay>,
        bg: Baglam,
        simdi: Long,
    ): SatirHam {
        val satirAlgi = tum.filter { it.kol == s.kol && it.gecis == s.gecis }
        val aday = satirAlgi.filter { !it.ilk && Cevap.yanlisTuru(et[it.bolum]?.metin("cevap")) == null }
        val kullanilan = HashSet<Algi>()
        val eslesmeler = ArrayList<Eslesme>()
        val ilgili = gercekler.filter { it.yon == s.yon }
            .filter { s.kol != Kol.WIFI || wifiEsli(bg.sirali, it.bolge, it.zaman) }
        for (g in ilgili) {
            val karsi = gercekler.firstOrNull { it.bolge == g.bolge && it.yon != g.yon && it.zaman > g.zaman }?.zaman ?: Long.MAX_VALUE
            val son = minOf(g.zaman + Sabit.SONRA, karsi)
            val a = aday.firstOrNull { it !in kullanilan && it.bolge == g.bolge && it.zaman >= g.zaman - Sabit.ONCE && it.zaman <= son }
            val k = bg.kosullar(g)
            if (a != null) {
                kullanilan += a
                eslesmeler += Eslesme(g, a, "eslesti", null, k)
            } else if (simdi < g.zaman + Sabit.SONRA && karsi == Long.MAX_VALUE) {
                eslesmeler += Eslesme(g, null, "bekliyor", null, k)
            } else {
                val neden = when {
                    !bg.konumAcik(g.zaman) -> N_KONUM_KAPALI
                    !bg.kurulu(s.kol, g.zaman) -> N_KURULU_DEGIL
                    else -> N_ACIKLANAMAYAN
                }
                eslesmeler += Eslesme(g, null, "kacti", neden, k)
            }
        }
        val turler = satirAlgi.map { a ->
            a to when {
                a in kullanilan -> "eslesti"
                a.ilk -> "kurulum"
                else -> {
                    val c = et[a.bolum]?.metin("cevap")
                    Cevap.yanlisTuru(c) ?: if (c == null) "etiketsiz" else "tekrar"
                }
            }
        }
        val gec = if (s.yon == Yon.GIRIS) gecisler.map { p ->
            p to satirAlgi.any { !it.ilk && it.bolge == p.bolge && it.zaman >= p.zaman - Sabit.GECIS_ONCE && it.zaman <= p.zaman + Sabit.GECIS_SONRA }
        } else emptyList()
        return SatirHam(s, eslesmeler, turler, gec)
    }

    private fun ozetle(h: SatirHam, filtre: (Long) -> Boolean): SatirOzeti {
        val es = h.eslesmeler.filter { filtre(it.gercek.zaman) }
        val eslesen = es.filter { it.sonuc == "eslesti" }
        val kacan = es.filter { it.sonuc == "kacti" }
        val sayilan = kacan.filter { it.neden != N_KONUM_KAPALI }
        val gecikmeler = eslesen.map { it.algi!!.zaman - it.gercek.zaman }
        val turler = h.turler.filter { filtre(it.first.zaman) }
        val yanlis = LinkedHashMap<String, Int>()
        for (y in Cevap.YANLIS_TURLERI) yanlis[y] = turler.count { it.second == y }
        val kosulGecikme = LinkedHashMap<String, GecikmeIst>()
        fun kg(ad: String, p: (Olay) -> Boolean) {
            val d = eslesen.filter { p(it.algi!!.olay) }.map { maxOf(0L, it.algi!!.zaman - it.gercek.zaman) }
            if (d.isNotEmpty()) kosulGecikme[ad] = GecikmeIst.hesapla(d)
        }
        kg("ekran kapalı") { it.bayrak("ekran") == false }
        kg("ekran açık") { it.bayrak("ekran") == true }
        kg("Doze (derin uyku)") { it.bayrak("idle") == true }
        kg("soğuk süreç") { it.bayrak("soguk") == true }
        kg("pil tasarrufu açık") { it.bayrak("tasarruf") == true }
        kg("şarjda") { it.bayrak("sarj") == true }
        val kosulKacirma = LinkedHashMap<String, Pair<Int, Int>>()
        for (e in es.filter { it.sonuc != "bekliyor" && it.neden != N_KONUM_KAPALI }) for (k in e.kosullar) {
            val (a, b) = kosulKacirma[k] ?: (0 to 0)
            kosulKacirma[k] = (a + if (e.sonuc == "kacti") 1 else 0) to (b + 1)
        }
        val gec = h.gecisler.filter { filtre(it.first.zaman) }
        return SatirOzeti(
            satir = h.satir,
            eslesen = eslesen.size,
            kacan = kacan.size,
            bekleyen = es.count { it.sonuc == "bekliyor" },
            kacanNedenleri = kacan.groupingBy { it.neden ?: "?" }.eachCount(),
            kacirmaPay = sayilan.size,
            kacirmaPayda = eslesen.size + sayilan.size,
            gecikme = GecikmeIst.hesapla(gecikmeler.map { maxOf(0L, it) }),
            erken = gecikmeler.count { it < 0 },
            yanlis = yanlis,
            tekrar = turler.count { it.second == "tekrar" },
            etiketsiz = turler.count { it.second == "etiketsiz" },
            kurulum = turler.count { it.second == "kurulum" },
            gecisTetik = gec.count { it.second },
            gecisToplam = gec.size,
            kosulGecikme = kosulGecikme,
            kosulKacirma = kosulKacirma,
        )
    }

    // ------------------------------------------------------------------ ana giriş

    fun analiz(olaylar: List<Olay>, simdi: Long, hataliSatir: Int = 0): Ozet {
        val bg = Baglam(olaylar)
        val sirali = bg.sirali
        val tum = algilar(olaylar)
        val et = etiketler(olaylar)
        val gercek = gercekler(olaylar)
        val gecis = gecisler(olaylar)

        val satirlar = LinkedHashSet<Satir>()
        satirlar += Satir.GIRISLER
        satirlar += Satir.CIKISLAR
        for (a in tum) satirlar += Satir(a.kol, a.gecis)
        val hamlar = satirlar.map { satirEslestir(it, tum, gercek, gecis, et, bg, simdi) }

        val donemNolari = (listOf(1) + bg.donemler.mapNotNull { it.tam("no") }).distinct().sorted()
        val donemler = ArrayList<DonemOzeti>()
        donemler += DonemOzeti("Tüm ölçüm", hamlar.map { ozetle(it) { true } })
        if (donemNolari.size > 1) for (d in donemNolari) {
            donemler += DonemOzeti(donemAdi(d), hamlar.map { h -> ozetle(h) { bg.donem(it) == d } })
        }

        // bölgeler
        val bolgeMap = LinkedHashMap<Int, BolgeBilgi>()
        for (o in sirali) when (o.tur) {
            Tur.BOLGE -> o.tam("id")?.let { id ->
                bolgeMap[id] = BolgeBilgi(id, o.tam("r"), o.bayrak("wifi") == true, o.tam("dogruluk") ?: bolgeMap[id]?.dogruluk, false)
            }
            Tur.WIFIBAG -> o.tam("id")?.let { id -> bolgeMap[id]?.let { bolgeMap[id] = it.copy(wifi = o.bayrak("var") == true) } }
            Tur.BOLGESIL -> o.tam("id")?.let { id -> bolgeMap[id]?.let { bolgeMap[id] = it.copy(silindi = true) } }
        }

        // yeniden başlatmalar
        val bootlar = ArrayList<BootBilgi>()
        for ((i, p) in bg.bootlar.withIndex()) {
            val l = p.second
            val bootOlayi = l.firstOrNull { it.tur == Tur.BOOT }
            if (i == 0 && bootOlayi == null) continue
            val acilis = l.minOf { it.acilisDuvar }
            val kurlar = LinkedHashMap<String, Pair<Long, String>>()
            for (o in l) if (o.tur == Tur.KUR && o.metin("sonuc") == "ok") {
                val k = o.metin("kol") ?: continue
                if (k !in kurlar) kurlar[k] = o.gecen to (o.metin("neden") ?: "?")
            }
            val onceki = if (i > 0) bg.bootlar[i - 1].second else emptyList()
            // Süreci kimin uyandırdığı: süreç başlangıcı ve onun yan kayıtları atlanır.
            val ilk = l.firstOrNull { it.tur !in setOf(Tur.CIKIS, Tur.ACILIS, Tur.OLGU, Tur.DENETIM, Tur.KUR) }
            bootlar += BootBilgi(
                acilis = acilis,
                kapanisYayini = onceki.any { it.tur == Tur.KAPANIS },
                yayin = bootOlayi?.gecen,
                kurlar = kurlar,
                ilkCanlanma = ilk?.let { canlanmaAdi(it) },
                ilkCanlanmaMs = ilk?.gecen,
                kurulumTetikleri = tum.filter { it.ilk && bootAnahtari(it.olay) == p.first }
                    .map { "${Kol.ad(it.kol)} ${Gecis.ad(it.gecis)} bölge ${it.bolge} (+${it.olay.gecen / 1000} sn)" },
            )
        }

        // konum kapatıp açma
        val dongu = ArrayList<KonumDongusu>()
        val konumOlay = bg.konumlar
        for ((i, o) in konumOlay.withIndex()) {
            if (o.bayrak("etkin") != false) continue
            val acilma = konumOlay.drop(i + 1).firstOrNull { it.bayrak("etkin") == true }?.duvar
            val kurlar = LinkedHashMap<String, Pair<Long, String>>()
            if (acilma != null) for (k in sirali) if (k.tur == Tur.KUR && k.duvar >= acilma && k.metin("sonuc") == "ok") {
                val kol = k.metin("kol") ?: continue
                if (kol !in kurlar) kurlar[kol] = (k.duvar - acilma) to (k.metin("neden") ?: "?")
            }
            val ust = (acilma ?: simdi) + 10 * Sabit.DK
            dongu += KonumDongusu(o.duvar, acilma, sirali.any { it.tur == Tur.GMSHATA && it.duvar >= o.duvar - Sabit.DK && it.duvar <= ust }, kurlar)
        }

        // pil
        val pil = ArrayList<PilDonemi>()
        val ornekler = sirali.filter { it.alan.containsKey("pil") && it.alan.containsKey("sarj") }
        val saat = HashMap<Int, Double>()
        val dusus = HashMap<Int, Int>()
        for ((a, b) in ornekler.zipWithNext()) {
            if (bootAnahtari(a) != bootAnahtari(b)) continue
            if (a.bayrak("sarj") != false || b.bayrak("sarj") != false) continue
            val dt = b.duvar - a.duvar
            if (dt < 5 * Sabit.DK || dt > 12 * Sabit.SAAT) continue
            val d = (a.tam("pil") ?: continue) - (b.tam("pil") ?: continue)
            if (d < 0) continue
            val no = bg.donem(a.duvar)
            saat[no] = (saat[no] ?: 0.0) + dt / Sabit.SAAT.toDouble()
            dusus[no] = (dusus[no] ?: 0) + d
        }
        for (no in saat.keys.sorted()) pil += PilDonemi(donemAdi(no), saat[no]!!, dusus[no] ?: 0)

        // Wi-Fi olayları
        val wifiOlay = sirali.filter { it.tur == Tur.WIFI }
        val wifi = linkedMapOf(
            "toplam" to wifiOlay.size,
            "bölgeyle eşleşen" to wifiOlay.count { (it.tam("eslesen") ?: 0) > 0 && it.bayrak("tekrar") != true },
            "eşleşmeyen ağ" to wifiOlay.count { (it.tam("eslesen") ?: 0) == 0 && it.metin("kimlik") == "alindi" },
            "ağ adı okunamadı" to wifiOlay.count { it.metin("kimlik") == "alinamadi" },
            "aynı bağlantının tekrarı" to wifiOlay.count { it.bayrak("tekrar") == true },
        )

        val denetim = LinkedHashMap<String, Pair<Int, Int>>()
        for (o in sirali) if (o.tur == Tur.DENETIM) {
            val k = o.metin("kol") ?: continue
            val (n, y) = denetim[k] ?: (0 to 0)
            denetim[k] = (n + 1) to (y + if (o.bayrak("piVar") == false) 1 else 0)
        }
        val kurHata = sirali.filter { it.tur == Tur.KUR && it.metin("sonuc") != "ok" }
            .groupingBy { "${it.metin("kol")}: ${it.metin("hata") ?: it.metin("sonuc")}" }.eachCount()
        val gmsHata = sirali.filter { it.tur == Tur.GMSHATA }.groupingBy { it.metin("kod") ?: "?" }.eachCount()
        val cikis = sirali.filter { it.tur == Tur.CIKIS }.groupingBy { cikisAdi(it.tam("neden")) }.eachCount()
        val beyan = LinkedHashMap<String, String>()
        for (o in sirali) if (o.tur == Tur.BEYAN) o.metin("ad")?.let { beyan[it] = o.metin("deger") ?: "?" }

        val bas = sirali.lastOrNull { it.tur == Tur.BASLA }
        val dur = sirali.lastOrNull { it.tur == Tur.DUR }?.takeIf { bas != null && it.duvar > bas.duvar }
        return Ozet(
            simdi = simdi,
            bas = bas?.duvar,
            durdurma = dur?.duvar,
            bolgeler = bolgeMap.values.toList(),
            gercekGiris = gercek.count { it.yon == Yon.GIRIS },
            gercekCikis = gercek.count { it.yon == Yon.CIKIS },
            gecisSayisi = gecis.size,
            etiketsizBolum = bolumler(olaylar).count { it.etiket == null },
            donemler = donemler,
            bootlar = bootlar,
            konumDongu = dongu,
            konumAlma = sirali.filter { it.tur == Tur.KONUMAL },
            pil = pil,
            wifi = wifi,
            denetim = denetim,
            kurHatalari = kurHata,
            gmsHatalari = gmsHata,
            cikislar = cikis,
            beyanlar = beyan,
            olgular = sirali.lastOrNull { it.tur == Tur.OLGU }?.alan ?: emptyMap(),
            olaySayisi = olaylar.size,
            hataliSatir = hataliSatir,
        )
    }

    fun donemAdi(no: Int) = when (no) {
        1 -> "Dönem 1 (varsayılan ayarlar)"
        2 -> "Dönem 2 (otomatik başlatma + pil muafiyeti)"
        else -> "Dönem $no"
    }

    private fun canlanmaAdi(o: Olay): String = when (o.tur) {
        Tur.EKRAN -> "kullanıcı uygulamayı açtı"
        Tur.BOOT -> "açılış yayını"
        Tur.IS -> "periyodik iş"
        Tur.ALGI -> "konum olayı (${o.metin("kol")})"
        Tur.WIFI -> "Wi-Fi olayı"
        Tur.ACILIS -> "süreç başladı"
        else -> o.tur
    }

    /** ApplicationExitInfo.REASON_* adları. */
    fun cikisAdi(n: Int?): String = when (n) {
        1 -> "kendi çıkışı"; 2 -> "sinyal"; 3 -> "düşük bellek"; 4 -> "çökme"; 5 -> "yerel çökme"
        6 -> "ANR"; 7 -> "başlatma hatası"; 8 -> "izin değişti"; 9 -> "aşırı kaynak"
        10 -> "kullanıcı istedi (zorla durdurma/kaydırma)"; 11 -> "kullanıcı durdurdu"; 12 -> "bağımlılık öldü"
        13 -> "diğer"; 14 -> "dondurucu"; 15 -> "paket durumu"; 16 -> "paket güncellendi"
        else -> "bilinmiyor($n)"
    }
}
