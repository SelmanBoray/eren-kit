package dev.eren.ajanda.ekran.sahne.veri

import dev.eren.ajanda.alarm.HatirlatmaDurumu
import dev.eren.ajanda.cekirdek.AjandaKaydi
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.EslesmeDurumu
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitGorunumu
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.RetGirdisi
import dev.eren.ajanda.cekirdek.Sekme
import dev.eren.ajanda.cekirdek.TakvimOgesi
import dev.eren.ajanda.ekran.CekirdekYuzu
import dev.eren.ajanda.ekran.DurumGostergesi
import dev.eren.ajanda.ekran.EkranMetinleri
import dev.eren.ajanda.ekran.GeriAlma
import dev.eren.ajanda.ekran.HatirlatmaUyarilari
import dev.eren.ajanda.ekran.IslemSonucu
import dev.eren.ajanda.ekran.KayitFormu
import dev.eren.ajanda.ekran.Liste
import dev.eren.ajanda.ekran.RetListesi
import dev.eren.ajanda.ekran.Yenileme
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit

/**
 * Bugün ekranının çekirdek konuşması ve model kurucusu. YALNIZ tek bir arka iş parçacığında çağrılır
 * (çekirdek çağrıları eşzamanlı); Android'e ve Compose'a bağlı değildir, testte sahte [CekirdekYuzu] ile sürülür.
 * Eski [dev.eren.ajanda.ekran.AnaDenetleyici]'nin Tarihli sekmesinin yerini alır; aynı saf parçaları kullanır
 * ([Liste], [Yenileme], [DurumGostergesi], [RetListesi], [HatirlatmaUyarilari]).
 *
 * Veri:
 * - **Bugün**: `takvimGunu(bugün, kapalılar dahil)`. Takvim sorgusu tekrarın bugünkü örneğini kendi
 *   durumuyla verir (Tarihli listesi seriyi çapa gününde gösterirdi) ve motor kilidini almaz.
 * - **Kalanlar ve yaklaşanlar**: `liste(TARIHLI, kapalılar hariç)`, [Liste.tarihliGrup] ile gruplanır
 *   (Gecikmiş → kalanlar; Yarın, Bu hafta → gün gün; Sonrası; Tekrarlayanlar). Bugün grubu takvimden gelir.
 * - **Taslaklar**: `liste(TASLAKLAR)`. Taslak, bugün ya da yaklaşanlarda ikinci kez gösterilmez.
 *
 * Değişiklikte ([degisti]) yalnız etkilenen liste yeniden sorgulanır ([Yenileme]); bugünün takvim günü kayıt
 * değişince her zaman yeniden okunur (tekrar örneği hangi kaydın değiştiğinden anlaşılmaz; sorgu ucuz).
 */
class BugunDenetleyici(private val c: CekirdekYuzu, private val saat: () -> ZonedDateTime) {
    var bitenleriGizle: Boolean = false

    /** Android'den okunur (`HatirlatmaDurumu.oku`); ana iş parçacığı verir, burada yalnız gösterilir. */
    @Volatile var hatirlatma: HatirlatmaDurumu? = null

    private var okunanGun: LocalDate? = null
    private var bugunOgeleri: List<TakvimOgesi>? = null
    private val listeler = mutableMapOf<Sekme, List<KayitGorunumu>>()
    private var ret: List<RetGirdisi> = emptyList()
    private var eslesme: EslesmeDurumu? = null
    private var adresVar = false
    private var baglanti: BaglantiDurumu? = null
    private var okumaHatasi: String? = null

    private val izlenen = setOf(Sekme.TARIHLI, Sekme.TASLAKLAR)

    /** Açılış ve öne geliş: her şeyi okur. */
    fun hepsiniOku() {
        listeler.clear()
        durumuOku(eslesmeDe = true)
        retiOku()
        for (s in izlenen) listeyiOku(s)
        bugunuOku(saat().toLocalDate())
    }

    private fun bugunuOku(gun: LocalDate) {
        try {
            bugunOgeleri = c.takvimGunu(gun.toString(), true)
            okunanGun = gun
            okumaHatasi = null
        } catch (e: Exception) {
            okumaHatasi = KayitFormu.hataMesaji(e).mesaj
        }
    }

    private fun listeyiOku(s: Sekme) {
        try {
            listeler[s] = c.liste(s, false)
            okumaHatasi = null
        } catch (e: Exception) {
            okumaHatasi = KayitFormu.hataMesaji(e).mesaj
        }
    }

    private fun retiOku() {
        ret = try {
            c.retListesi()
        } catch (_: Exception) {
            ret
        }
    }

    private fun durumuOku(eslesmeDe: Boolean) {
        try {
            if (eslesmeDe || eslesme == null) {
                eslesme = c.eslesmeDurumu()
                adresVar = c.baglantiAdresi() != null
            }
            baglanti = c.baglantiDurumu()
        } catch (e: Exception) {
            okumaHatasi = KayitFormu.hataMesaji(e).mesaj
        }
    }

    /** Gözlemci bildirimi (birleştirilmiş). Döner: yeniden sorgulanan listeler (test için). */
    fun degisti(d: Degisim): Set<Sekme> {
        val plan = Yenileme.plan(d, listeler.keys)
        val sorgulanacak = plan.listeler.toMutableSet()
        if (plan.kayitlar.isNotEmpty()) {
            val yeniHaller: Map<String, AjandaKaydi?> = plan.kayitlar.associateWith { id ->
                try {
                    c.kayit(id)?.kayit
                } catch (_: Exception) {
                    null
                }
            }
            val uyeler = izlenen.associateWith { s -> listeler[s].orEmpty().mapTo(HashSet()) { it.kayit.kayitId } }
            sorgulanacak += Yenileme.etkilenenListeler(uyeler, yeniHaller, false)
        }
        if (plan.eslesme || plan.baglanti) durumuOku(eslesmeDe = plan.eslesme)
        if (plan.ret) retiOku()
        for (s in sorgulanacak) listeyiOku(s)
        if (d.tumu || d.kayitlar.isNotEmpty()) bugunuOku(saat().toLocalDate())
        return sorgulanacak
    }

    /** Çizim modeli. Gün değiştiyse (dakika sayacı) bugünü yeniden okur: bu yüzden de yalnız arka iş parçacığında. */
    fun model(): BugunModeli {
        val simdi = saat()
        val bugun = simdi.toLocalDate()
        if (okunanGun != null && okunanGun != bugun) {
            bugunuOku(bugun)
            for (s in izlenen) listeyiOku(s)
        }
        val gonderim = Liste.Gonderim.hesapla(adresVar, baglanti?.asama)
        val taslakKayitlari = listeler[Sekme.TASLAKLAR].orEmpty().filter { it.kayit.durum == KayitDurumu.ACIK && !it.kayit.silindi }
        val taslakIdleri = taslakKayitlari.mapTo(HashSet()) { it.kayit.kayitId }

        val gunOgeleri = bugunOgeleri.orEmpty().filter { !it.gorunum.kayit.taslak && it.gorunum.kayit.kayitId !in taslakIdleri }
        val bugunKayitlari = gunOgeleri.map { bugunKaydi(it, simdi, gonderim) }
        val sirali = Siralama.gun(gunOgeleri.zip(bugunKayitlari))
        val acikler = sirali.filter { it.hal == LevhaHali.ACIK }
        val bitenler = sirali.filter { it.hal == LevhaHali.BITTI }
        val siradaki = Siralama.siradaki(gunOgeleri.zip(bugunKayitlari).filter { it.second.hal == LevhaHali.ACIK }, simdi.toLocalTime())
        val acikSirali = if (siradaki == null) acikler else listOf(siradaki) + acikler.filter { it.anahtar != siradaki.anahtar }

        // Kalanlar ve yaklaşanlar.
        val kalanlar = mutableListOf<Pair<LocalDate, BugunKaydi>>()
        val gunler = sortedMapOf<LocalDate, MutableList<Pair<Liste.Konum, BugunKaydi>>>()
        val sonrasi = mutableListOf<Pair<Liste.Konum, BugunKaydi>>()
        val tekrarlayanlar = mutableListOf<BugunKaydi>()
        val haftaSiniri = bugun.plusDays(7)
        for (g in listeler[Sekme.TARIHLI].orEmpty()) {
            val k = g.kayit
            if (k.taslak || k.kayitId in taslakIdleri || k.durum != KayitDurumu.ACIK) continue
            val konum = Liste.konum(k.zaman, simdi.zone) ?: continue
            val (grup, gun) = Liste.tarihliGrup(k, konum, bugun)
            when (grup) {
                Liste.Grup.GECIKMIS -> kalanlar += gun to listeKaydi(g, simdi, grup, konum, gonderim, gecikme = true)
                Liste.Grup.YARIN, Liste.Grup.BU_HAFTA, Liste.Grup.SONRASI ->
                    if (gun < haftaSiniri) {
                        gunler.getOrPut(gun) { mutableListOf() } += konum to listeKaydi(g, simdi, Liste.Grup.YARIN, konum, gonderim)
                    } else {
                        sonrasi += konum to listeKaydi(g, simdi, Liste.Grup.SONRASI, konum, gonderim)
                    }
                Liste.Grup.TEKRARLAYAN -> tekrarlayanlar += listeKaydi(g, simdi, grup, konum, gonderim)
                else -> Unit // Bugün takvimden; Geçmiş yalnız kapalılar dahilken.
            }
        }
        val yaklasanlar = buildList {
            for ((gun, l) in gunler) add(GunGrubu(gun.toString(), Gorunus.gunBasligi(gun, bugun), Siralama.konumla(l)))
            if (sonrasi.isNotEmpty()) {
                add(GunGrubu("sonrasi", "Sonrası", sonrasi.sortedWith(compareBy({ it.first.ilkGun }, { if (it.first.saat == null) 0 else 1 }, { it.first.gunBolumu?.ordinal ?: -1 }, { it.first.saat })).map { it.second }))
            }
            if (tekrarlayanlar.isNotEmpty()) add(GunGrubu("tekrarlayanlar", "Tekrarlayanlar", tekrarlayanlar))
        }

        val (cumle, alt) = GunCumlesi.kur(acikSirali.firstOrNull(), siradaki != null, gunOgeleri, bitenler.size, simdi)
        val h = hatirlatma
        val uyarilar = h?.let { HatirlatmaUyarilari.uyarilar(it) }.orEmpty()
        return BugunModeli(
            yuklendi = bugunOgeleri != null || okumaHatasi != null,
            bugun = bugun,
            tarih = Gorunus.uzunTarih(bugun),
            cumle = cumle,
            alt = alt,
            kalanlar = kalanlar.sortedBy { it.first }.map { it.second },
            taslaklar = taslakKayitlari.map { taslakKaydi(it, simdi, gonderim) },
            acikler = acikSirali,
            siradaki = siradaki?.anahtar,
            bitenler = bitenler,
            bitenleriGizle = bitenleriGizle,
            yaklasanlar = yaklasanlar,
            durum = DurumOzeti(
                gosterge = DurumGostergesi.hesapla(eslesme, baglanti, adresVar, simdi.toInstant().toEpochMilli(), simdi.zone, okumaHatasi),
                eslesmeVar = when (eslesme) {
                    is EslesmeDurumu.Eslesti, is EslesmeDurumu.Bekliyor -> true
                    is EslesmeDurumu.Reddedildi -> adresVar
                    is EslesmeDurumu.Yok -> false
                    null -> true
                },
                retler = ret.map { RetListesi.satir(it, simdi.toInstant().toEpochMilli(), simdi.zone) },
                hatirlatma = uyarilar,
                hatirlatmaSeridi = h?.let { HatirlatmaUyarilari.serit(it) },
                hatirlatmaSeritMetni = h?.let { HatirlatmaUyarilari.seritMetni(it) },
            ),
            okumaHatasi = okumaHatasi,
        ).komsuRenkleriAyir()
    }

    // ---------------------------------------------------------------------------------------------
    // Kayıttan ekran kaydına
    // ---------------------------------------------------------------------------------------------

    private fun bugunKaydi(o: TakvimOgesi, simdi: ZonedDateTime, gonderim: Liste.Gonderim): BugunKaydi {
        val k = o.gorunum.kayit
        val bugun = simdi.toLocalDate()
        val saatMetni = o.saat
        val bolum = (k.zaman as? AjandaZamani.Gun)?.gunBolumu
        val zaman = when {
            saatMetni != null -> saatMetni + (o.bitisSaati?.let { "–$it" } ?: "")
            bolum != null -> EkranMetinleri.gunBolumuBuyuk(bolum)
            o.ilkGun != o.sonGun -> runCatching {
                "${EkranMetinleri.kisaTarih(LocalDate.parse(o.ilkGun), bugun)} – ${EkranMetinleri.kisaTarih(LocalDate.parse(o.sonGun), bugun)}"
            }.getOrNull()
            else -> "Tüm gün"
        }
        val acik = o.durum == KayitDurumu.ACIK
        val gecti = acik && saatMetni != null && o.ilkGun == bugun.toString() &&
            runCatching { LocalTime.parse(saatMetni) }.getOrNull()?.let { it < simdi.toLocalTime().withSecond(0).withNano(0) } == true
        return kaydet(
            o.gorunum, anahtar = o.ornekTarihi?.let { "${k.kayitId}@$it" } ?: k.kayitId, zaman = zaman,
            hal = if (acik) LevhaHali.ACIK else LevhaHali.BITTI, gecti = gecti, ornekTarihi = o.ornekTarihi, gonderim = gonderim,
            durumMetni = when (o.durum) {
                KayitDurumu.TAMAM -> "tamamlandı"
                KayitDurumu.IPTAL -> "iptal edildi"
                KayitDurumu.ACIK -> null
            },
        )
    }

    private fun listeKaydi(
        g: KayitGorunumu,
        simdi: ZonedDateTime,
        grup: Liste.Grup,
        konum: Liste.Konum,
        gonderim: Liste.Gonderim,
        gecikme: Boolean = false,
    ): BugunKaydi = kaydet(
        g, anahtar = g.kayit.kayitId, zaman = Liste.zamanMetni(g.kayit, konum, grup, simdi),
        hal = LevhaHali.ACIK, gecti = gecikme, ornekTarihi = null, gonderim = gonderim, durumMetni = null,
    )

    private fun taslakKaydi(g: KayitGorunumu, simdi: ZonedDateTime, gonderim: Liste.Gonderim): BugunKaydi {
        val k = g.kayit
        val konum = Liste.konum(k.zaman, simdi.zone)
        val zaman = when {
            konum == null -> (k.zaman as? AjandaZamani.Belirsiz)?.let { "“${it.ifade}”" }
            konum.ilkGun == simdi.toLocalDate() -> Liste.zamanMetni(k, konum, Liste.Grup.BUGUN, simdi)?.let { "bugün, ${Gorunus.kucuk(it)}" } ?: "bugün"
            else -> Liste.zamanMetni(k, konum, Liste.Grup.SONRASI, simdi)
        }
        return kaydet(g, anahtar = k.kayitId, zaman = zaman, hal = LevhaHali.TASLAK, gecti = false, ornekTarihi = null, gonderim = gonderim, durumMetni = null)
    }

    private fun kaydet(
        g: KayitGorunumu,
        anahtar: String,
        zaman: String?,
        hal: LevhaHali,
        gecti: Boolean,
        ornekTarihi: String?,
        gonderim: Liste.Gonderim,
        durumMetni: String?,
    ): BugunKaydi {
        val k = g.kayit
        val bekleyen = gonderim.okunus.takeIf { g.bekleyen }
        // v3 BAĞLANTI NOKTASI: kaydın simge alanı gelince `simge = k.simge` olur; öneriden önce gelir.
        val cizim = Gorunus.cizim(simge = null, baslik = k.baslik)
        val ham = BugunKaydi(
            anahtar = anahtar,
            kayitId = k.kayitId,
            baslik = k.baslik,
            zaman = zaman,
            renk = Gorunus.renkAnahtardan(cizim),
            cizim = cizim,
            hal = hal,
            gecti = gecti,
            tamamlanabilir = k.tur != KayitTuru.NOT && !k.silindi,
            ornekTarihi = ornekTarihi,
            bekleyen = bekleyen,
            tekrar = k.tekrar != null,
            asistan = Liste.otomatikMi(k.kaynak),
        )
        val aciklama = buildString {
            append(k.baslik)
            zaman?.let { append(", ").append(it) }
            if (k.tur != KayitTuru.GOREV) append(", ").append(Gorunus.kucuk(EkranMetinleri.tur(k.tur)))
            durumMetni?.let { append(", ").append(it) }
            append(Gorunus.isaretOkunusu(ham))
        }
        return ham.copy(aciklama = aciklama)
    }

    // ---------------------------------------------------------------------------------------------
    // İşlemler: çekirdek önce yerelde uygular; ekran gözlemciyle yenilenir.
    // ---------------------------------------------------------------------------------------------

    private fun kisalt(s: String) = if (s.length > 40) s.take(39) + "…" else s

    private inline fun yap(blok: () -> IslemSonucu): IslemSonucu = try {
        blok()
    } catch (e: Exception) {
        IslemSonucu(KayitFormu.hataMesaji(e).mesaj, hata = true)
    }

    /** Tamamlar ([tamam]) ya da yeniden açar. Tost: "Bitti: ⟨başlık⟩" + Geri al. */
    fun tamamla(k: BugunKaydi, tamam: Boolean = true): IslemSonucu = yap {
        val yeni = if (tamam) KayitDurumu.TAMAM else KayitDurumu.ACIK
        val onceki = if (k.hal == LevhaHali.BITTI) KayitDurumu.TAMAM else KayitDurumu.ACIK
        c.durumDegistir(k.kayitId, yeni, k.ornekTarihi)
        val b = kisalt(k.baslik)
        IslemSonucu(
            if (tamam) "Bitti: $b" else "Yeniden açıldı: $b",
            GeriAlma.Durum(k.kayitId, onceki, k.ornekTarihi).takeIf { onceki != yeni },
        )
    }

    /** Taslağı onaylar (karakalemden boyamaya). Çekirdekte onayın tersi yok: geri alma sunulmaz. */
    fun onayla(id: String): IslemSonucu = yap {
        c.onayla(id)
        IslemSonucu("Onaylandı")
    }

    /** Gruplu öneri levhasındaki "Hepsini onayla". */
    fun hepsiniOnayla(idler: List<String>): IslemSonucu = yap {
        idler.forEach { c.onayla(it) }
        IslemSonucu(if (idler.size == 1) "Onaylandı" else "${idler.size} öneri onaylandı")
    }

    /** Öneriden vazgeçmek taslağı siler (eski ekranın taslak satırındaki "Sil"); geri yüklenebilir. */
    fun vazgec(id: String): IslemSonucu = yap {
        c.sil(id)
        IslemSonucu("Öneriden vazgeçildi", GeriAlma.GeriYukle(id))
    }

    fun retAt(islemId: String): IslemSonucu = yap {
        c.retAt(islemId)
        IslemSonucu("Gönderilemeyen değişiklik atıldı")
    }

    fun geriAl(g: GeriAlma): IslemSonucu = yap {
        when (g) {
            is GeriAlma.Durum -> c.durumDegistir(g.kayitId, g.durum, g.ornekTarihi)
            is GeriAlma.GeriYukle -> c.geriYukle(g.kayitId)
            is GeriAlma.Sil -> c.sil(g.kayitId)
        }
        IslemSonucu("Geri alındı")
    }
}

/** Gün içi sıra ve sıradaki iş (saf; SAHNE.md §3.2). */
object Siralama {
    /**
     * Günün sırası: önce bölümsüz saatsizler, sonra gün bölümlüler (sabah .. gece), sonra saatliler saat
     * sırasıyla; eşitlikte çekirdeğin sırası. Çekirdek de böyle sıralar; burada yeniden sıralamak, sahte ve
     * eski çekirdekte de aynı ekranı verir.
     */
    fun gun(ogeler: List<Pair<TakvimOgesi, BugunKaydi>>): List<BugunKaydi> =
        ogeler.withIndex().sortedWith(
            compareBy(
                { if (it.value.first.saat == null) 0 else 1 },
                { ((it.value.first.gorunum.kayit.zaman as? AjandaZamani.Gun)?.gunBolumu?.ordinal) ?: -1 },
                { it.value.first.saat ?: "" },
                { it.index },
            ),
        ).map { it.value.second }

    /** Yaklaşan bir günün satırları, aynı kuralla. */
    fun konumla(l: List<Pair<Liste.Konum, BugunKaydi>>): List<BugunKaydi> =
        l.withIndex().sortedWith(
            compareBy({ if (it.value.first.saat == null) 0 else 1 }, { it.value.first.gunBolumu?.ordinal ?: -1 }, { it.value.first.saat }, { it.index }),
        ).map { it.value.second }

    /** Sıradaki iş: saati şimdiden sonra olan ilk açık kayıt; yoksa sıralamadaki ilk açık kayıt. */
    fun siradaki(acikler: List<Pair<TakvimOgesi, BugunKaydi>>, simdi: LocalTime): BugunKaydi? {
        val sirali = gun(acikler)
        val saatli = acikler.mapNotNull { (o, k) -> o.saat?.let { s -> runCatching { LocalTime.parse(s) }.getOrNull()?.let { it to k } } }
            .filter { it.first >= simdi.withSecond(0).withNano(0) }
            .minByOrNull { it.first }?.second
        return saatli ?: sirali.firstOrNull()
    }
}

/** Gün cümlesi ve alt satır (SAHNE.md §3.2). */
object GunCumlesi {
    fun kur(
        siradaki: BugunKaydi?,
        saatliSiradakiVar: Boolean,
        ogeler: List<TakvimOgesi>,
        bitenSayisi: Int,
        simdi: ZonedDateTime,
    ): Pair<String, String> {
        if (siradaki == null) {
            return "Bugünlük bu kadar." to if (bitenSayisi > 0) "$bitenSayisi iş bitti." else "Yeni bir şey eklemek için artıya dokun."
        }
        val cumle = "Sırada ${Gorunus.kucuk(siradaki.baslik)} var."
        val oge = ogeler.firstOrNull { (it.ornekTarihi?.let { o -> "${it.gorunum.kayit.kayitId}@$o" } ?: it.gorunum.kayit.kayitId) == siradaki.anahtar }
        val saat = oge?.saat?.let { runCatching { LocalTime.parse(it) }.getOrNull() }
        val alt = if (saatliSiradakiVar && saat != null && !siradaki.gecti) {
            val dk = ChronoUnit.MINUTES.between(simdi.toLocalTime().withSecond(0).withNano(0), saat)
            "${Gorunus.kalanSure(dk)}, ${EkranMetinleri.saat(saat)}"
        } else {
            "Bugün, ${Gorunus.kucuk(siradaki.zaman ?: "tüm gün")}"
        }
        return cumle to alt
    }
}
