package dev.eren.ajanda.ekran.sahne.veri

import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.TakvimGunOzeti
import dev.eren.ajanda.cekirdek.TakvimOgesi
import dev.eren.ajanda.ekran.CekirdekYuzu
import dev.eren.ajanda.ekran.EkranMetinleri
import dev.eren.ajanda.ekran.KayitFormu
import dev.eren.ajanda.ekran.Liste
import dev.eren.ajanda.ekran.Takvim
import dev.eren.ajanda.ekran.TakvimDurumu
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth
import java.time.ZonedDateTime

/**
 * Takvim sekmesinin çekirdek konuşması ve model kurucusu. YALNIZ tek arka iş parçacığında çağrılır; Android'e
 * ve Compose'a bağlı değildir. Veri çekirdeğin takvim sorgularından (`takvimAyi`, `takvimGunu`; MIMARI.md "Takvim
 * sekmesi"): gün sınırı, tekrar örnekleri ve görünürlük orada. Burada önbellek, sıra ve gösterim.
 *
 * - **Görünürlük** Tarihli sekmesiyle aynı: silinmiş yok, taslak görünür ve ayrıca sayılır, tamamlanmış ve iptal
 *   yalnız `kapalilarDahil` iken. `kapalilarDahil` Bugün'ün "Bitenler: Göster" seçimidir (varsayılan açık:
 *   tamamlanan iş görünür kalır, solar ve sona iner).
 * - **Önbellek**: son [ENCOK_AY] ay ve son [ENCOK_GUN] günün öğeleri. Kayıt değişince aylar atılır (tekrar ve
 *   dönem yüzünden hangi ayın etkilendiği ucuz bilinmez; sorgu ucuz), günler bayatlar ama nokta renkleri için
 *   eski hâliyle durur, sırayla tazelenir ([renkleriDoldur]).
 * - **Nokta renkleri**: ayın özeti yalnız sayı verir; noktanın rengi kaydın takımıdır (§3.6). Günün öğeleri
 *   okundukça (önce seçili gün, sonra ayın kayıtlı günleri, süre sınırlı adımlarla) renk gelir; okunmamış gün
 *   sayıyla, mürekkep noktalarla çizilir.
 * - **Okuma hatası** kaynak başına (her ay, her gün, durum): bir kaynağın hatası yalnız o kaynağın başarılı
 *   okumasıyla silinir; okunamamış veri boşaltılmaz (eski hâliyle kalır).
 */
class TakvimSahneDenetleyici(private val c: CekirdekYuzu, private val saat: () -> ZonedDateTime) {
    /** Bugün'ün "Bitenler: Gizle" seçimi; değişince her şey yeniden okunur. */
    var bitenleriGizle: Boolean = false
        set(b) {
            if (b == field) return
            field = b
            aylar.clear()
            gunler.clear()
            taze.clear()
        }

    private val kapalilarDahil get() = !bitenleriGizle

    private val aylar = object : LinkedHashMap<YearMonth, dev.eren.ajanda.cekirdek.TakvimAyi>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<YearMonth, dev.eren.ajanda.cekirdek.TakvimAyi>?) = size > ENCOK_AY
    }
    private val gunler = object : LinkedHashMap<LocalDate, List<TakvimOgesi>>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<LocalDate, List<TakvimOgesi>>?) = size > ENCOK_GUN
    }

    /** Son kayıt değişikliğinden sonra okunmuş günler (ötekiler bayat ama renk için kullanılır). */
    private val taze = HashSet<LocalDate>()
    private val ayHatalari = HashMap<YearMonth, String>()
    private val gunHatalari = HashMap<LocalDate, String>()
    private var durumHatasi: String? = null
    private var adresVar = false
    private var baglanti: BaglantiDurumu? = null

    /** Önbellekteki aylar (test). */
    val yukluAylar: Set<YearMonth> get() = aylar.keys.toSet()

    /** Açılış ve öne geliş: aylar ve günler bayatlar, gösterilen ay ve seçili gün okunur. */
    fun hepsiniOku(d: TakvimDurumu) {
        aylar.clear()
        taze.clear()
        durumuOku()
        gerekeniOku(d)
    }

    private fun durumuOku() {
        try {
            adresVar = c.baglantiAdresi() != null
            baglanti = c.baglantiDurumu()
            durumHatasi = null
        } catch (e: Exception) {
            durumHatasi = KayitFormu.hataMesaji(e).mesaj
        }
    }

    /** Gösterilen ay ve seçili gün önbellekte (taze) yoksa okunur. */
    fun gerekeniOku(d: TakvimDurumu) {
        if (d.ay !in aylar) ayOku(d.ay)
        if (d.secili !in taze) gunOku(d.secili)
    }

    /** Önceki ve sonraki ay (kaydırınca bekletmesin). Gösterilen ay önbellekte en yeni kalır. */
    fun komsulariOku(d: TakvimDurumu) {
        for (ay in listOf(d.ay.plusMonths(1), d.ay.minusMonths(1))) if (ay !in aylar) ayOku(ay)
        aylar[d.ay]
    }

    /** Gözlemci bildirimi ya da işlemin etkisi. */
    fun degisti(d: Degisim, durum: TakvimDurumu) {
        if (d.eslesme || d.baglanti) durumuOku()
        if (d.tumu || d.kayitlar.isNotEmpty()) {
            aylar.clear()
            taze.clear()
        }
        gerekeniOku(durum)
    }

    private fun ayOku(ay: YearMonth) {
        try {
            aylar[ay] = c.takvimAyi(ay.year, ay.monthValue, kapalilarDahil)
            ayHatalari.remove(ay)
        } catch (e: Exception) {
            ayHatalari[ay] = KayitFormu.hataMesaji(e).mesaj
        }
    }

    private fun gunOku(t: LocalDate) {
        try {
            gunler[t] = c.takvimGunu(t.toString(), kapalilarDahil)
            taze += t
            gunHatalari.remove(t)
        } catch (e: Exception) {
            gunHatalari[t] = KayitFormu.hataMesaji(e).mesaj
        }
    }

    /**
     * Gösterilen ayın kayıtlı ama tazesi olmayan günlerini okur (nokta renkleri), en çok [sinirNs] süre. Döner:
     * okunacak gün kaldı mı. Seçili gün ve bugün önce.
     */
    fun renkleriDoldur(d: TakvimDurumu, sinirNs: Long = RENK_ADIMI_NS): Boolean {
        val ay = aylar[d.ay] ?: return false
        val bekleyen = ay.gunler.asSequence()
            .filter { it.toplam > (it.serit) }
            .mapNotNull { runCatching { LocalDate.parse(it.tarih) }.getOrNull() }
            .filter { it !in taze && it !in gunHatalari }
            .sortedBy { if (it == d.secili || it == d.bugun) 0 else 1 }
            .toList()
        if (bekleyen.isEmpty()) return false
        val bas = System.nanoTime()
        for ((i, t) in bekleyen.withIndex()) {
            gunOku(t)
            if (System.nanoTime() - bas > sinirNs && i < bekleyen.lastIndex) return true
        }
        return false
    }

    // ---------------------------------------------------------------------------------------------
    // Model
    // ---------------------------------------------------------------------------------------------

    fun model(d: TakvimDurumu): TakvimSahneModeli {
        val simdi = saat()
        val gonderim = Liste.Gonderim.hesapla(adresVar, baglanti?.asama)
        val ayList = listOf(d.ay.minusMonths(1), d.ay, d.ay.plusMonths(1))
        val izgaralar = ayList.filter { it == d.ay || it in aylar }.associateWith { ayIzgarasi(it, d.bugun) }
        val gunHatasi = gunHatalari[d.secili]
        val ogeler = gunler[d.secili]
        val gun = SeciliGun(
            gun = d.secili,
            baslik = gunBasligi(d.secili, d.bugun),
            kayitlar = ogeler?.let { gunKayitlari(it, d.secili, simdi, gonderim) },
            okunamadi = gunHatasi,
        )
        val hata = gunHatasi ?: ayHatalari[d.ay] ?: durumHatasi
        return TakvimSahneModeli(
            durum = d,
            aylar = izgaralar,
            gun = gun.takeIf { ogeler != null || gunHatasi != null },
            bitenleriGizle = bitenleriGizle,
            yuklendi = d.ay in aylar || ayHatalari[d.ay] != null,
            okumaHatasi = hata,
        )
    }

    private fun ayIzgarasi(ay: YearMonth, bugun: LocalDate): AyIzgarasi {
        val iz = Takvim.Izgara(ay)
        val a = aylar[ay]
        val ozetler: Map<LocalDate, TakvimGunOzeti> = a?.gunler.orEmpty()
            .mapNotNull { o -> runCatching { LocalDate.parse(o.tarih) }.getOrNull()?.let { it to o } }.toMap()
        val yer = Takvim.seritYerlesimi(iz, a?.seritler.orEmpty(), ENCOK_SIRA)
        val ilk = ay.atDay(1).minusDays(iz.ilkSutun.toLong())
        val hucreler = (0 until iz.haftaSayisi * 7).map { i ->
            val t = ilk.plusDays(i.toLong())
            val ayda = YearMonth.from(t) == ay
            if (!ayda) {
                val yon = if (t < ay.atDay(1)) "önceki ay" else "sonraki ay"
                GunHucresi(t, false, emptyList(), false, "${EkranMetinleri.uzunTarih(t, bugun)}, $yon.")
            } else {
                val ozet = ozetler[t]
                val (noktalar, fazla) = noktalar(t, ozet, yer.gizli[t] ?: 0)
                GunHucresi(t, true, noktalar, fazla, Takvim.hucreAciklamasi(t, ozet, bugun, secili = false, yuklendi = a != null))
            }
        }
        val seritler = yer.parcalar.map { p ->
            val s = p.serit
            val renk = Gorunus.renkAnahtardan(Gorunus.cizim(null, s.baslik))
            DonemSeridi(
                anahtar = "${s.kayitId}@${s.ornekTarihi ?: ""}:${p.hafta}",
                kayitId = s.kayitId,
                baslik = s.baslik,
                renk = renk,
                hafta = p.hafta,
                sira = p.sira,
                basSutun = p.basSutun,
                sonSutun = p.sonSutun,
                basliyor = p.basliyor,
                bitiyor = p.bitiyor,
                kapali = s.durum != KayitDurumu.ACIK,
                taslak = s.taslak,
            )
        }
        return AyIzgarasi(ay, iz.haftaSayisi, hucreler, seritler, yer.siraSayisi, yuklendi = a != null, okunamadi = ayHatalari[ay])
    }

    /**
     * Hücre noktaları: yalnız tek günlük öğeler (çok günlüler şerittir), günün sırasıyla. En çok üç işaret; üçten
     * çok öğe ya da sığmayan şerit varsa üçüncünün yerine "+" (§9). Gün okunmadıysa çekirdeğin sayılarından,
     * renksiz.
     */
    private fun noktalar(t: LocalDate, ozet: TakvimGunOzeti?, gizliSerit: Int): Pair<List<TakvimNoktasi>, Boolean> {
        if (ozet == null || ozet.toplam == 0) return emptyList<TakvimNoktasi>() to (gizliSerit > 0)
        val ogeler = gunler[t]
        val hepsi: List<TakvimNoktasi> = if (ogeler != null) {
            Siralama.takvim(ogeler.filter { it.ilkGun == it.sonGun }, t).map { o ->
                val tur = when {
                    o.durum != KayitDurumu.ACIK -> Takvim.Nokta.KAPALI
                    o.gorunum.kayit.taslak -> Takvim.Nokta.TASLAK
                    else -> Takvim.Nokta.ACIK
                }
                TakvimNoktasi(Gorunus.renkAnahtardan(Gorunus.cizim(null, o.gorunum.kayit.baslik)), tur)
            }
        } else {
            val i = Takvim.isaretler(ozet)
            val n = i.noktalar.map { TakvimNoktasi(null, it) }
            if (i.fazla) n + TakvimNoktasi(null, Takvim.Nokta.ACIK) else n
        }
        val fazla = hepsi.size > Takvim.ENCOK_NOKTA || gizliSerit > 0
        val gorunen = if (fazla) hepsi.take(Takvim.ENCOK_NOKTA - 1) else hepsi
        return gorunen to fazla
    }

    /** Seçili günün kayıtları: günün sırası, kapalılar sonda; komşu levhalar aynı takıma düşmez. */
    private fun gunKayitlari(ogeler: List<TakvimOgesi>, gun: LocalDate, simdi: ZonedDateTime, gonderim: Liste.Gonderim): List<BugunKaydi> {
        val sirali = Siralama.takvim(ogeler, gun)
        val (acik, kapali) = sirali.partition { it.durum == KayitDurumu.ACIK }
        return KomsuRenk.ayir((acik + kapali).map { takvimKaydi(it, gun, simdi, gonderim) })
    }

    private fun takvimKaydi(o: TakvimOgesi, gun: LocalDate, simdi: ZonedDateTime, gonderim: Liste.Gonderim): BugunKaydi {
        val k = o.gorunum.kayit
        val acik = o.durum == KayitDurumu.ACIK
        val bugun = simdi.toLocalDate()
        val gecti = acik && gun == bugun && o.bugunkuAralik(bugun)?.gectiMi(simdi.toLocalTime()) == true
        val kayit = KayitKurucu.kur(
            o.gorunum,
            anahtar = o.ornekTarihi?.let { "${k.kayitId}@$it" } ?: k.kayitId,
            zaman = zamanMetni(o, gun, bugun),
            hal = KayitKurucu.hal(o.durum, k.taslak),
            gecti = gecti,
            ornekTarihi = o.ornekTarihi,
            gonderim = gonderim,
            durumMetni = KayitKurucu.durumMetni(o.durum),
            iptal = o.durum == KayitDurumu.IPTAL,
            // v3 BAĞLANTI NOKTASI: `bolge = k.bolge?.ad` (bölgeli kayıtta yalnız "@ ⟨ad⟩" etiketi).
            bolge = null,
        )
        // Tekrarlı kaydın örnek tarihi yoksa (olmamalı: takvim örnekleri tarihli) seri korunur.
        return if (kayit.tekrar && kayit.ornekTarihi == null) kayit.copy(tamamlanabilir = false) else kayit
    }

    companion object {
        const val ENCOK_AY = 7

        /** Seçili günün başlığı: "Bugün, 12 Mart", "Yarın, 13 Mart", "Dün, 11 Mart", "Cuma, 20 Mart". */
        fun gunBasligi(t: LocalDate, bugun: LocalDate): String {
            val ay = EkranMetinleri.gunVeAy(t) + if (t.year != bugun.year) " ${t.year}" else ""
            return when (EkranMetinleri.goreliGun(t, bugun)) {
                "bugün" -> "Bugün, $ay"
                "yarın" -> "Yarın, $ay"
                "dün" -> "Dün, $ay"
                else -> EkranMetinleri.uzunTarih(t, bugun)
            }
        }
        const val ENCOK_GUN = 62
        const val ENCOK_SIRA = 2

        /** Nokta renkleri için bir arka iş adımının süresi: araya giren işlem bundan çok beklemesin. */
        const val RENK_ADIMI_NS = 16_000_000L

        /**
         * Takvim öğesinin seçili gündeki zaman metni: saat ("14:45", süreliyse "10:00–12:00"), gün bölümü
         * ("Akşam"; saatten türetilmez), dönem ("12 Mar – 15 Mar"), önceki günden süren saatli iş ("Sürüyor ·
         * bitiş 10:00"), saatsiz gün ("Tüm gün").
         */
        fun zamanMetni(o: TakvimOgesi, gun: LocalDate, bugun: LocalDate): String {
            val z = o.gorunum.kayit.zaman
            val ilk = runCatching { LocalDate.parse(o.ilkGun) }.getOrNull() ?: gun
            val son = runCatching { LocalDate.parse(o.sonGun) }.getOrNull() ?: ilk
            return when {
                o.saat != null && gun > ilk -> if (gun < son || o.bitisSaati == null) "Sürüyor · tüm gün" else "Sürüyor · bitiş ${o.bitisSaati}"
                o.saat != null -> o.saat + (o.bitisSaati?.let { "–$it" } ?: "")
                z is AjandaZamani.Gun && z.gunBolumu != null -> EkranMetinleri.gunBolumuBuyuk(z.gunBolumu!!)
                ilk != son -> "${EkranMetinleri.kisaTarih(ilk, bugun)} – ${EkranMetinleri.kisaTarih(son, bugun)}"
                else -> "Tüm gün"
            }
        }
    }
}

/**
 * Takvim gününün sırası (YOL-HARITASI 4.3, saf): önce bölümsüz saatsizler (bölümsüz gün, dönem), sonra gün
 * bölümlüler bölüm sırasıyla, sonra saatliler saat sırasıyla; önceki günden süren saatli iş saatlilerin başında.
 * Saatten gün bölümü türetilmez. Eşitlikte çekirdeğin sırası.
 */
fun Siralama.takvim(ogeler: List<TakvimOgesi>, gun: LocalDate): List<TakvimOgesi> =
    ogeler.withIndex().sortedWith(
        compareBy(
            { (_, o) ->
                when {
                    o.saat != null -> 2
                    (o.gorunum.kayit.zaman as? AjandaZamani.Gun)?.gunBolumu != null -> 1
                    else -> 0
                }
            },
            { (_, o) -> (o.gorunum.kayit.zaman as? AjandaZamani.Gun)?.gunBolumu?.ordinal ?: -1 },
            { (_, o) ->
                val ilk = runCatching { LocalDate.parse(o.ilkGun) }.getOrNull()
                if (o.saat == null || (ilk != null && ilk < gun)) LocalTime.MIN else runCatching { LocalTime.parse(o.saat) }.getOrDefault(LocalTime.MIN)
            },
            { it.index },
        ),
    ).map { it.value }
