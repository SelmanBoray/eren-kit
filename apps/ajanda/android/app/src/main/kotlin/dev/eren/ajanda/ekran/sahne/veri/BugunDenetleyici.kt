package dev.eren.ajanda.ekran.sahne.veri

import dev.eren.ajanda.alarm.HatirlatmaDurumu
import dev.eren.ajanda.cekirdek.AjandaKaydi
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.EslesmeDurumu
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitGorunumu
import dev.eren.ajanda.cekirdek.OrnekDurumu
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
 *
 * Okuma hataları kaynak başına tutulur (bugünün günü, her liste, durum): bir kaynağın hatası yalnız o kaynağın
 * başarılı okumasıyla silinir; hatalı liste sonraki değişiklikte yeniden denenir.
 *
 * Tamamlanan iş görünür kalır (kullanıcı kararı): bugünün işi takvimden "bitenler"e iner; önceki günlerden
 * kalan ya da yaklaşan iş bu ekrandan tamamlanınca gün boyu kendi sırasının sonunda, solmuş durur ([tutulanlar]).
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

    // Kaynak başına okuma hatası.
    private var bugunHatasi: String? = null
    private val listeHatalari = mutableMapOf<Sekme, String>()
    private var durumHatasi: String? = null
    private val okumaHatasi: String? get() = bugunHatasi ?: listeHatalari.values.firstOrNull() ?: durumHatasi

    private val izlenen = setOf(Sekme.TARIHLI, Sekme.TASLAKLAR)

    /** Bu ekrandan tamamlanıp listeden düşen kalan/yaklaşan iş: hangi gün, hangi sırada ([GunGrubu.anahtar] ya da [KALAN]). */
    private class Tutulan(val gun: LocalDate, val yer: String, val kayit: BugunKaydi)

    private val tutulanlar = LinkedHashMap<String, Tutulan>()

    /** Son modelde kalanlar ve yaklaşanlardaki kayıtların yeri (tamamlanınca [tutulanlar]'a geçer). */
    private var sonYerler: Map<String, Pair<String, BugunKaydi>> = emptyMap()

    /**
     * Açılış ve öne geliş: her şeyi okur. Listeler önceden boşaltılmaz (G5): okunamayan liste eski hâliyle kalır,
     * hata ayrıca söylenir (kalanlar, taslaklar, yaklaşanlar ekrandan kalkmaz).
     */
    fun hepsiniOku() {
        durumuOku(eslesmeDe = true)
        retiOku()
        for (s in izlenen) listeyiOku(s)
        bugunuOku(saat().toLocalDate())
    }

    private fun bugunuOku(gun: LocalDate) {
        try {
            bugunOgeleri = c.takvimGunu(gun.toString(), true)
            okunanGun = gun
            bugunHatasi = null
        } catch (e: Exception) {
            bugunHatasi = KayitFormu.hataMesaji(e).mesaj
            // Başka günün öğeleri bugünün diye gösterilmez (gün değişti, yeni gün okunamadı).
            if (okunanGun != gun) bugunOgeleri = null
        }
    }

    private fun listeyiOku(s: Sekme) {
        try {
            listeler[s] = c.liste(s, false)
            listeHatalari.remove(s)
        } catch (e: Exception) {
            listeHatalari[s] = KayitFormu.hataMesaji(e).mesaj
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
            durumHatasi = null
        } catch (e: Exception) {
            durumHatasi = KayitFormu.hataMesaji(e).mesaj
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
            // Silinen (ya da artık olmayan) kayıt solmuş da durmaz.
            for ((id, k) in yeniHaller) if (k == null || k.silindi) tutulanlar.remove(id)
        }
        // Okunamamış liste her değişiklikte yeniden denenir.
        sorgulanacak += listeHatalari.keys.filter { it in izlenen }
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
        val gunDegisti = okunanGun != null && okunanGun != bugun
        // Gün değiştiyse ya da bugün hiç okunamadıysa yeniden dene (dakika sayacı da buraya gelir).
        if (gunDegisti || (okunanGun == null && bugunHatasi != null)) bugunuOku(bugun)
        if (gunDegisti) for (s in izlenen) listeyiOku(s)
        tutulanlar.values.removeAll { it.gun != bugun }
        val gonderim = Liste.Gonderim.hesapla(adresVar, baglanti?.asama)
        val taslakKayitlari = listeler[Sekme.TASLAKLAR].orEmpty().filter { it.kayit.durum == KayitDurumu.ACIK && !it.kayit.silindi }
        val taslakIdleri = taslakKayitlari.mapTo(HashSet()) { it.kayit.kayitId }

        val gunOgeleri = bugunOgeleri.orEmpty().filter { !it.gorunum.kayit.taslak && it.gorunum.kayit.kayitId !in taslakIdleri }
        val bugunKayitlari = gunOgeleri.map { bugunKaydi(it, simdi, gonderim) }
        val sirali = Siralama.gun(gunOgeleri.zip(bugunKayitlari))
        val acikler = sirali.filter { it.hal == LevhaHali.ACIK }
        val bitenler = sirali.filter { it.hal == LevhaHali.BITTI }
        val siradaki = Siralama.siradaki(gunOgeleri.zip(bugunKayitlari).filter { it.second.hal == LevhaHali.ACIK }, simdi.toLocalTime(), bugun)
        val acikSirali = if (siradaki == null) acikler else listOf(siradaki) + acikler.filter { it.anahtar != siradaki.anahtar }

        // Kalanlar ve yaklaşanlar.
        val kalanlar = mutableListOf<Pair<LocalDate, BugunKaydi>>()
        val gunler = sortedMapOf<LocalDate, MutableList<Pair<Liste.Konum, BugunKaydi>>>()
        val sonrasi = mutableListOf<Pair<Liste.Konum, BugunKaydi>>()
        val tekrarlayanlar = mutableListOf<BugunKaydi>()
        val haftaSiniri = bugun.plusDays(7)
        val yerler = HashMap<String, Pair<String, BugunKaydi>>()
        for (g in listeler[Sekme.TARIHLI].orEmpty()) {
            val k = g.kayit
            if (k.taslak || k.kayitId in taslakIdleri || k.durum != KayitDurumu.ACIK) continue
            val konum = Liste.konum(k.zaman, simdi.zone) ?: continue
            val (grup, gun) = Liste.tarihliGrup(k, konum, bugun)
            // Tekrarlı kaydın liste satırı çapa örneğidir (çapa bugünden sonra); "Tekrarlayanlar"da örnek belli değil.
            val ornek = capaOrnegi(k, bugun)
            val (yer, kayit) = when (grup) {
                Liste.Grup.GECIKMIS -> KALAN to listeKaydi(g, simdi, grup, konum, gonderim, gecikme = true).also { kalanlar += gun to it }
                Liste.Grup.YARIN, Liste.Grup.BU_HAFTA, Liste.Grup.SONRASI ->
                    if (gun < haftaSiniri) {
                        gun.toString() to listeKaydi(g, simdi, Liste.Grup.YARIN, konum, gonderim, ornek = ornek).also { gunler.getOrPut(gun) { mutableListOf() } += konum to it }
                    } else {
                        SONRASI to listeKaydi(g, simdi, Liste.Grup.SONRASI, konum, gonderim, ornek = ornek).also { sonrasi += konum to it }
                    }
                Liste.Grup.TEKRARLAYAN -> TEKRARLAYANLAR to listeKaydi(g, simdi, grup, konum, gonderim).also { tekrarlayanlar += it }
                else -> continue // Bugün takvimden; Geçmiş yalnız kapalılar dahilken.
            }
            yerler[k.kayitId] = yer to kayit
        }
        sonYerler = yerler
        // Tamamlanıp listeden düşenler kendi sıralarının sonunda, solmuş (yeniden açılan listede zaten var).
        val gorunenIdler = yerler.keys + gunOgeleri.mapTo(HashSet()) { it.gorunum.kayit.kayitId }
        val solanlar = tutulanlar.filterKeys { it !in gorunenIdler }.values.groupBy({ it.yer }, { it.kayit })
        fun solan(yer: String) = solanlar[yer].orEmpty()
        for (yer in solanlar.keys) runCatching { LocalDate.parse(yer) }.getOrNull()?.let { gunler.getOrPut(it) { mutableListOf() } }
        val yaklasanlar = buildList {
            for ((gun, l) in gunler) add(GunGrubu(gun.toString(), Gorunus.gunBasligi(gun, bugun), Siralama.konumla(l) + solan(gun.toString())))
            if (sonrasi.isNotEmpty() || solan(SONRASI).isNotEmpty()) {
                add(GunGrubu(SONRASI, "Sonrası", sonrasi.sortedWith(compareBy({ it.first.ilkGun }, { if (it.first.saat == null) 0 else 1 }, { it.first.gunBolumu?.ordinal ?: -1 }, { it.first.saat })).map { it.second } + solan(SONRASI)))
            }
            if (tekrarlayanlar.isNotEmpty() || solan(TEKRARLAYANLAR).isNotEmpty()) add(GunGrubu(TEKRARLAYANLAR, "Tekrarlayanlar", tekrarlayanlar + solan(TEKRARLAYANLAR)))
        }

        val gunOkunamadi = bugunOgeleri == null && bugunHatasi != null
        val (cumle, alt) = if (gunOkunamadi) {
            "Bugünün işleri okunamadı." to (bugunHatasi ?: "")
        } else {
            GunCumlesi.kur(acikSirali.firstOrNull(), siradaki != null, gunOgeleri, bitenler.size, simdi)
        }
        val h = hatirlatma
        val uyarilar = h?.let { HatirlatmaUyarilari.uyarilar(it) }.orEmpty()
        return BugunModeli(
            yuklendi = bugunOgeleri != null || bugunHatasi != null,
            bugun = bugun,
            tarih = Gorunus.uzunTarih(bugun),
            cumle = cumle,
            alt = alt,
            kalanlar = kalanlar.sortedBy { it.first }.map { it.second } + solan(KALAN),
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
            gunOkunamadi = gunOkunamadi,
        ).komsuRenkleriAyir()
    }

    /**
     * Ayrıntı için kaydın kendisi, çekirdekten (Bugün modelinde olmayan kayıt: bildirimden açılan tarihsiz iş
     * gibi). Yoksa ya da silindiyse `null`.
     */
    fun ayrintiOzeti(kayitId: String): AyrintiOzeti? {
        val g = try {
            c.kayit(kayitId)
        } catch (_: Exception) {
            null
        } ?: return null
        val k = g.kayit
        if (k.silindi) return null
        val simdi = saat()
        val konum = Liste.konum(k.zaman, simdi.zone)
        val grup = konum?.let { Liste.tarihliGrup(k, it, simdi.toLocalDate()).first }
        val zaman = when {
            konum == null -> (k.zaman as? AjandaZamani.Belirsiz)?.let { "“${it.ifade}”" }
            else -> Liste.zamanMetni(k, konum, grup ?: Liste.Grup.SONRASI, simdi)
        }
        // Tekrarlı kayıtta yalnız çapa örneği (bugün ya da sonrası) hedeflenebilir; değilse tamamlanamaz.
        val ornek = if (k.durum == KayitDurumu.ACIK) capaOrnegi(k, simdi.toLocalDate()) else null
        val ornekDurumu = ornek?.let { o -> k.ornekler.firstOrNull { it.tarih == o }?.durum }
        val durum = when {
            k.durum != KayitDurumu.ACIK -> k.durum
            ornekDurumu == OrnekDurumu.TAMAM -> KayitDurumu.TAMAM
            ornekDurumu == OrnekDurumu.IPTAL -> KayitDurumu.IPTAL
            else -> KayitDurumu.ACIK
        }
        val hal = when {
            k.taslak -> LevhaHali.TASLAK
            durum == KayitDurumu.ACIK -> LevhaHali.ACIK
            else -> LevhaHali.BITTI
        }
        val kayit = kaydet(
            g, anahtar = k.kayitId, zaman = zaman, hal = hal, gecti = false, ornekTarihi = ornek,
            gonderim = Liste.Gonderim.hesapla(adresVar, baglanti?.asama), durumMetni = durumMetni(durum),
            iptal = durum == KayitDurumu.IPTAL,
        ).seriKorumasi()
        val yer = when {
            k.zaman == null -> "Tarihsiz"
            grup == Liste.Grup.BUGUN -> "Bugün"
            grup == Liste.Grup.YARIN -> "Yarın"
            else -> null
        }
        return AyrintiOzeti(kayit, yer)
    }

    private fun durumMetni(d: KayitDurumu): String? = KayitKurucu.durumMetni(d)

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
        // Süreli iş bitişi geçince "geçti"; sürerken "şimdi"dir (sıradaki odur). Süresiz saatli iş başlayınca geçer.
        val gecti = acik && o.bugunkuAralik(bugun)?.gectiMi(simdi.toLocalTime()) == true
        return kaydet(
            o.gorunum, anahtar = o.ornekTarihi?.let { "${k.kayitId}@$it" } ?: k.kayitId, zaman = zaman,
            hal = if (acik) LevhaHali.ACIK else LevhaHali.BITTI, gecti = gecti, ornekTarihi = o.ornekTarihi, gonderim = gonderim,
            durumMetni = durumMetni(o.durum), iptal = o.durum == KayitDurumu.IPTAL,
        )
    }

    private fun listeKaydi(
        g: KayitGorunumu,
        simdi: ZonedDateTime,
        grup: Liste.Grup,
        konum: Liste.Konum,
        gonderim: Liste.Gonderim,
        gecikme: Boolean = false,
        ornek: String? = null,
    ): BugunKaydi {
        val k = g.kayit
        // Çapa örneği kapandıysa (seri açık) satır o örneğin hâlini gösterir.
        val ornekDurumu = ornek?.let { o -> k.ornekler.firstOrNull { it.tarih == o }?.durum }
        val durum = when (ornekDurumu) {
            OrnekDurumu.TAMAM -> KayitDurumu.TAMAM
            OrnekDurumu.IPTAL -> KayitDurumu.IPTAL
            null -> KayitDurumu.ACIK
        }
        return kaydet(
            g, anahtar = k.kayitId, zaman = Liste.zamanMetni(k, konum, grup, simdi),
            hal = if (durum == KayitDurumu.ACIK) LevhaHali.ACIK else LevhaHali.BITTI, gecti = gecikme, ornekTarihi = ornek,
            gonderim = gonderim, durumMetni = durumMetni(durum), iptal = durum == KayitDurumu.IPTAL,
        ).seriKorumasi()
    }

    /**
     * Tekrarlı kaydın örnek tarihi yoksa tamamlanamaz: çekirdek örneksiz durum değişikliğini serinin kendisine
     * uygular (bütün gelecek örnekler kapanır). Satır ayrıntıyı açar; tamamlama günün örneğinden (Bugün, Takvim).
     */
    private fun BugunKaydi.seriKorumasi(): BugunKaydi = if (tekrar && ornekTarihi == null && tamamlanabilir) copy(tamamlanabilir = false) else this

    /**
     * Tekrarlı kaydın liste satırının gösterdiği örnek: çapası bugün ya da sonrasındaysa çapa günü (serinin ilk
     * örneği odur; tarih kaydın kendi takvimindeki gün, çekirdeğin `ornekTarihi` biçimi). Çapa geçmişteyse
     * sıradaki örnek liste sorgusundan bilinmez: `null`.
     */
    private fun capaOrnegi(k: AjandaKaydi, bugun: LocalDate): String? {
        if (k.tekrar == null) return null
        val t = when (val z = k.zaman) {
            is AjandaZamani.An -> z.tarih
            is AjandaZamani.Gun -> z.tarih
            else -> null
        } ?: return null
        val gun = runCatching { LocalDate.parse(t) }.getOrNull() ?: return null
        return t.takeIf { gun >= bugun }
    }

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
        iptal: Boolean = false,
    ): BugunKaydi = KayitKurucu.kur(g, anahtar, zaman, hal, gecti, ornekTarihi, gonderim, durumMetni, iptal)

    // ---------------------------------------------------------------------------------------------
    // İşlemler: çekirdek önce yerelde uygular; ekran gözlemciyle yenilenir.
    // ---------------------------------------------------------------------------------------------


    private inline fun yap(blok: () -> IslemSonucu): IslemSonucu = try {
        blok()
    } catch (e: Exception) {
        IslemSonucu(KayitFormu.hataMesaji(e).mesaj, hata = true)
    }

    /**
     * Tamamlar ([tamam]) ya da yeniden açar. Tost: "Bitti: ⟨başlık⟩" + Geri al; geri alma kaydın gerçek önceki
     * durumuna döner (iptal edilmiş iş yeniden açılıp geri alınınca iptal kalır). Kalan ya da yaklaşan iş
     * tamamlanınca gün boyu yerinde solmuş durur.
     */
    fun tamamla(k: BugunKaydi, tamam: Boolean = true): IslemSonucu {
        val s = KayitKurucu.tamamla(c, k, tamam, saat().toLocalDate())
        if (tamam && !s.hata) {
            sonYerler[k.kayitId]?.takeIf { it.second.anahtar == k.anahtar }?.let { (yer, kayit) ->
                tutulanlar[k.kayitId] = Tutulan(saat().toLocalDate(), yer, kayit.copy(hal = LevhaHali.BITTI))
            }
        }
        return s
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

    fun geriAl(g: GeriAlma, beklenen: GeriAlmaBeklentisi? = null): IslemSonucu = KayitKurucu.geriAl(c, g, beklenen)
}

private const val KALAN = "kalan"
private const val SONRASI = "sonrasi"
private const val TEKRARLAYANLAR = "tekrarlayanlar"

/**
 * Takvim öğesinin bugünkü saat aralığı. [bas]: başlangıç (dünden süren işte gün başı); [son]: bitiş (süresizde
 * başlangıç; bugün bitmeyen ya da tam gece yarısı biten işte gün sonu). [sureli]: bitişi var.
 */
internal data class GunAraligi(val bas: LocalTime, val son: LocalTime, val sureli: Boolean) {
    /** Dakika çözünürlüğünde [simdi] bu aralığın içinde mi (süreli iş sürüyor). */
    fun suruyor(simdi: LocalTime): Boolean = sureli && simdi.dakika().let { bas <= it && it < son }

    /** Süreli iş bitişinde, süresiz iş başlangıcından sonra geçer. */
    fun gectiMi(simdi: LocalTime): Boolean = simdi.dakika().let { if (sureli) it >= son else bas < it }
}

private fun LocalTime.dakika(): LocalTime = withSecond(0).withNano(0)

/** Saatli öğede bugünkü aralık; saatsiz ya da okunamayan öğede `null`. */
internal fun TakvimOgesi.bugunkuAralik(bugun: LocalDate): GunAraligi? {
    val s = saat?.let { runCatching { LocalTime.parse(it) }.getOrNull() } ?: return null
    val ilk = runCatching { LocalDate.parse(ilkGun) }.getOrNull() ?: return null
    val son = runCatching { LocalDate.parse(sonGun) }.getOrNull() ?: ilk
    val bas = if (ilk < bugun) LocalTime.MIN else s
    val b = bitisSaati?.let { runCatching { LocalTime.parse(it) }.getOrNull() } ?: return GunAraligi(bas, bas, sureli = false)
    // Tam gece yarısında biten öğenin son günü önceki gündür, bitişi "00:00": o günün sonu.
    val bitis = if (son > bugun || b == LocalTime.MIDNIGHT) LocalTime.MAX else b
    return GunAraligi(bas, bitis, sureli = true)
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

    /**
     * Sıradaki iş: süren (süreli, şu an içinde olunan) ya da saati şimdiden sonra olan ilk açık kayıt; süren iş
     * "şimdi" sayılır, sıradaki odur. Yoksa sıralamadaki ilk açık kayıt. [bugun] verilmezse her öğe kendi ilk
     * gününde sayılır.
     */
    fun siradaki(acikler: List<Pair<TakvimOgesi, BugunKaydi>>, simdi: LocalTime, bugun: LocalDate? = null): BugunKaydi? {
        val sirali = gun(acikler)
        val n = simdi.dakika()
        val saatli = acikler.mapNotNull { (o, k) ->
            val gun = bugun ?: runCatching { LocalDate.parse(o.ilkGun) }.getOrNull() ?: return@mapNotNull null
            val a = o.bugunkuAralik(gun) ?: return@mapNotNull null
            when {
                a.suruyor(n) -> Triple(n, a.bas, k)
                a.bas >= n -> Triple(a.bas, a.bas, k)
                else -> null
            }
        }.minWithOrNull(compareBy<Triple<LocalTime, LocalTime, BugunKaydi>>({ it.first }, { it.second }))?.third
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
            if (oge?.bugunkuAralik(simdi.toLocalDate())?.suruyor(simdi.toLocalTime()) == true) {
                // Süren iş: "Şimdi, 10:00–12:00".
                "Şimdi, ${siradaki.zaman ?: EkranMetinleri.saat(saat)}"
            } else {
                val dk = ChronoUnit.MINUTES.between(simdi.toLocalTime().withSecond(0).withNano(0), saat)
                "${Gorunus.kalanSure(dk)}, ${EkranMetinleri.saat(saat)}"
            }
        } else {
            "Bugün, ${Gorunus.kucuk(siradaki.zaman ?: "tüm gün")}"
        }
        return cumle to alt
    }
}
