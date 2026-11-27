package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.AjandaKaydi
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.EslesmeDurumu
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitGorunumu
import dev.eren.ajanda.cekirdek.RetGirdisi
import dev.eren.ajanda.cekirdek.Sekme
import java.time.LocalDate
import java.time.ZonedDateTime

/** Ana ekranın gösterdiği liste. */
enum class Gorunum(val sekme: Sekme?) {
    TARIHLI(Sekme.TARIHLI),
    TARIHSIZ(Sekme.TARIHSIZ),
    TASLAKLAR(Sekme.TASLAKLAR),
    SILINENLER(Sekme.SILINENLER),
    RET(null),
    /** Ay ızgarası + seçili günün kayıtları (veri `takvimAyi`/`takvimGunu`, liste değil). */
    TAKVIM(null),
    ;

    val anaSekme get() = this == TARIHLI || this == TARIHSIZ || this == TAKVIM
}

/** Ana ekranın bir anlık çizim modeli (arka iş parçacığında kurulur, ana iş parçacığında çizilir). */
data class AnaModel(
    val gorunum: Gorunum,
    val ogeler: List<Liste.Oge>,
    val retSatirlari: List<RetListesi.RetSatiri>,
    val taslakSayisi: Int,
    val retSayisi: Int,
    val gosterge: DurumGostergesi.Gosterge,
    val eslesmeVar: Boolean,
    val kapalilarDahil: Boolean,
    val yuklendi: Boolean,
    /** Takvim sekmesi görünürken dolu. */
    val takvim: TakvimModeli? = null,
    /** Takvimin seçimi (sekme görünmese de; ekran durumu kaydında saklanır). */
    val takvimDurumu: TakvimDurumu? = null,
)

/** Kullanıcının bir işlemi geri alabilmesi için ters işlem. */
sealed class GeriAlma {
    data class Durum(val kayitId: String, val durum: KayitDurumu, val ornekTarihi: String? = null) : GeriAlma()
    data class GeriYukle(val kayitId: String) : GeriAlma()
    data class Sil(val kayitId: String) : GeriAlma()
}

data class IslemSonucu(val mesaj: String?, val geriAlma: GeriAlma? = null, val hata: Boolean = false)

/**
 * Ana ekranın durumu ve çekirdek konuşması. YALNIZ ekranın tek arka iş parçacığında çağrılır (çekirdek
 * çağrıları eşzamanlı); ekran [model]'i ana iş parçacığına taşıyıp çizer. Android'e bağlı değildir:
 * testte gerçek çekirdekle ya da sahte [CekirdekYuzu] ile sürülür.
 */
class AnaDenetleyici(private val c: CekirdekYuzu, private val saat: () -> ZonedDateTime) {
    var gorunum: Gorunum = Gorunum.TARIHLI
        private set
    var kapalilarDahil: Boolean = false
        private set

    /** Yüklü listeler (önbellek). Görünmeyen ve etkilenen liste atılır, gösterilince yeniden sorgulanır. */
    private val listeler = mutableMapOf<Sekme, List<KayitGorunumu>>()
    private var ret: List<RetGirdisi>? = null
    private var eslesme: EslesmeDurumu? = null
    private var adresVar = false
    private var baglanti: BaglantiDurumu? = null
    private var okumaHatasi: String? = null

    /** Takvim sekmesinin seçimi ve önbelleği ("kapalılar" seçimi Tarihli sekmesiyle ortak). */
    val takvim = TakvimDenetleyici(c)

    private fun bugun() = saat().toLocalDate()

    /** Gözlemciye ya da bekleyen değişikliğe bakmadan her şeyi okur (açılış, öne geliş). */
    fun hepsiniOku() {
        listeler.clear()
        ret = null
        takvim.gecersizKil()
        durumuOku(eslesmeDe = true)
        retiOku()
        gerekenListeleriOku()
        if (gorunum == Gorunum.TAKVIM) takvimiOku()
    }

    fun gorunumSec(g: Gorunum) {
        gorunum = g
        if (g == Gorunum.RET) retiOku() else gerekenListeleriOku()
        if (g == Gorunum.TAKVIM) takvimiOku()
    }

    fun kapalilariGoster(b: Boolean) {
        if (b == kapalilarDahil) return
        kapalilarDahil = b
        // Silinenler bu seçeneği yok sayar; ötekiler yeniden sorgulanır.
        listeler.keys.retainAll(setOf(Sekme.SILINENLER))
        takvim.kapalilariGoster(b)
        gerekenListeleriOku()
        if (gorunum == Gorunum.TAKVIM) takvimiOku()
    }

    // Takvim seçimi: durum değişir, gereken ay/gün (önbellekte yoksa) okunur.

    private fun takvimiOku() {
        takvim.durumAl(bugun())
        takvim.gerekeniOku()
    }

    fun takvimGeriYukle(d: TakvimDurumu) = takvim.geriYukle(d)

    fun takvimGunSec(t: LocalDate) {
        takvim.degistir(bugun()) { it.gunSec(t) }
        takvim.gerekeniOku()
    }

    fun takvimAyKaydir(n: Long) {
        takvim.degistir(bugun()) { it.ayKaydir(n) }
        takvim.gerekeniOku()
    }

    fun takvimBugune() {
        takvim.degistir(bugun()) { it.bugune() }
        takvim.gerekeniOku()
    }

    /** Ay değiştirme anında çizilsin diye komşu aylar (çizimden sonra, ayrı iş olarak). */
    fun takvimKomsulari() {
        if (gorunum == Gorunum.TAKVIM) takvim.komsulariOku()
    }

    /** Ekranın her an elinde tutması gereken listeler: görünen + taslak sayısı için taslaklar. */
    private fun gerekenListeler(): Set<Sekme> = setOfNotNull(gorunum.sekme, Sekme.TASLAKLAR)

    private fun gerekenListeleriOku() {
        for (s in gerekenListeler()) if (s !in listeler) listeyiOku(s)
    }

    private fun listeyiOku(s: Sekme) {
        try {
            listeler[s] = c.liste(s, kapalilarDahil)
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
            okumaHatasi = null
        } catch (e: Exception) {
            okumaHatasi = KayitFormu.hataMesaji(e).mesaj
        }
    }

    /**
     * Gözlemci bildirimi (birleştirilmiş). Döner: bu çağrıda yeniden sorgulanan listeler (test için).
     */
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
            val uyeler = listeler.mapValues { (_, l) -> l.mapTo(HashSet()) { it.kayit.kayitId } }
            sorgulanacak += Yenileme.etkilenenListeler(uyeler, yeniHaller, kapalilarDahil)
        }
        if (plan.eslesme || plan.baglanti) durumuOku(eslesmeDe = plan.eslesme)
        if (plan.ret) retiOku()
        // Takvim: kayıt değişince önbellek atılır; görünürse hemen, değilse gösterilince okunur.
        if (d.tumu || d.kayitlar.isNotEmpty()) {
            takvim.gecersizKil()
            if (gorunum == Gorunum.TAKVIM) takvimiOku()
        }
        val gereken = gerekenListeler()
        val okunan = mutableSetOf<Sekme>()
        for (s in sorgulanacak) {
            if (s in gereken) {
                listeyiOku(s)
                okunan += s
            } else {
                listeler.remove(s) // bayat: gösterilince okunur
            }
        }
        return okunan
    }

    /**
     * Çizim modeli. Takvim görünürken gün değiştiyse (ekran dakikada bir çizer) seçim yeni güne kayar ve
     * eksik ay/gün okunur: bu yüzden de yalnız arka iş parçacığında.
     */
    fun model(): AnaModel {
        val simdi = saat()
        val bugun = simdi.toLocalDate()
        val takvimDurumu = takvim.durumAl(bugun)
        if (gorunum == Gorunum.TAKVIM) takvim.gerekeniOku()
        val liste = gorunum.sekme?.let { listeler[it] }
        // Bağlantı ya da eşleşme değişince listeler yeniden sorgulanmaz; rozet burada yeniden hesaplanır.
        val gonderim = Liste.Gonderim.hesapla(adresVar, baglanti?.asama)
        val takvimModeli = if (gorunum == Gorunum.TAKVIM) takvim.model(bugun) else null
        val ogeler = when (gorunum) {
            Gorunum.TARIHLI -> liste?.let { Liste.tarihliler(it, simdi, gonderim) }
            Gorunum.TARIHSIZ -> liste?.let { Liste.tarihsizler(it, simdi, gonderim) }
            Gorunum.TASLAKLAR -> liste?.let {
                Liste.duz(it, simdi, Liste.Grup.TASLAK, "Onay bekleyen taslak yok. Asistanın kendiliğinden eklediği kayıtlar burada onay bekler.", gonderim)
            }
            Gorunum.SILINENLER -> liste?.let { Liste.duz(it, simdi, Liste.Grup.SILINEN, "Silinen kayıt yok.", gonderim) }
            Gorunum.RET -> emptyList()
            Gorunum.TAKVIM -> takvim.gun(takvimDurumu.secili)?.let { Takvim.satirlar(it, takvimDurumu.secili, simdi, gonderim) }
        }
        val retler = ret.orEmpty()
        return AnaModel(
            gorunum = gorunum,
            ogeler = ogeler ?: emptyList(),
            retSatirlari = if (gorunum == Gorunum.RET) retler.map { RetListesi.satir(it, simdi.toInstant().toEpochMilli(), simdi.zone) } else emptyList(),
            taslakSayisi = listeler[Sekme.TASLAKLAR]?.count { it.kayit.durum == KayitDurumu.ACIK } ?: 0,
            retSayisi = retler.size,
            gosterge = DurumGostergesi.hesapla(
                eslesme, baglanti, adresVar, simdi.toInstant().toEpochMilli(), simdi.zone,
                okumaHatasi ?: takvim.okumaHatasi.takeIf { gorunum == Gorunum.TAKVIM },
            ),
            eslesmeVar = when (eslesme) {
                is EslesmeDurumu.Eslesti, is EslesmeDurumu.Bekliyor -> true
                is EslesmeDurumu.Reddedildi -> adresVar
                is EslesmeDurumu.Yok -> false
                null -> true // okunana dek şerit gösterme
            },
            kapalilarDahil = kapalilarDahil,
            // Takvimde ızgara hemen çizilir (işaretleri okununca gelir); bekleme çarkı yok.
            yuklendi = ogeler != null || gorunum == Gorunum.RET || gorunum == Gorunum.TAKVIM,
            takvim = takvimModeli,
            takvimDurumu = takvimDurumu,
        )
    }

    // ---------------------------------------------------------------------------------------------
    // İşlemler: çekirdek önce yerelde uygular (çevrimdışı da çalışır); liste gözlemciyle yenilenir.
    // ---------------------------------------------------------------------------------------------

    private fun baslik(id: String): String =
        listeler.values.asSequence().flatten().firstOrNull { it.kayit.kayitId == id }?.kayit?.baslik
            ?: takvimOgesi(id)?.gorunum?.kayit?.baslik
            ?: runCatching { c.kayit(id)?.kayit?.baslik }.getOrNull() ?: "Kayıt"

    private fun takvimOgesi(id: String) = takvim.durum?.let { d -> takvim.gun(d.secili) }?.firstOrNull { it.gorunum.kayit.kayitId == id }

    private fun kisalt(s: String) = if (s.length > 40) s.take(39) + "…" else s

    private inline fun yap(blok: () -> IslemSonucu): IslemSonucu = try {
        blok()
    } catch (e: Exception) {
        IslemSonucu(KayitFormu.hataMesaji(e).mesaj, hata = true)
    }

    /** [ornekTarihi]: takvimde tekrarın yalnız o örneği (serinin öteki günleri değişmez). */
    fun durumDegistir(id: String, durum: KayitDurumu, ornekTarihi: String? = null): IslemSonucu = yap {
        val b = kisalt(baslik(id))
        val onceki = if (ornekTarihi != null) {
            takvim.oge(id, ornekTarihi)?.durum
        } else {
            listeler.values.asSequence().flatten().firstOrNull { it.kayit.kayitId == id }?.kayit?.durum
                ?: takvim.oge(id, null)?.durum
        } ?: KayitDurumu.ACIK
        c.durumDegistir(id, durum, ornekTarihi)
        // Örnekte hangi günün değiştiği de söylenir: "“Ders” (3 Ara) tamamlandı".
        val ek = ornekTarihi?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
            ?.let { " (${EkranMetinleri.kisaTarih(it, bugun())})" } ?: ""
        val mesaj = when (durum) {
            KayitDurumu.TAMAM -> "“$b”$ek tamamlandı"
            KayitDurumu.ACIK -> "“$b”$ek yeniden açıldı"
            KayitDurumu.IPTAL -> "“$b”$ek iptal edildi"
        }
        IslemSonucu(mesaj, GeriAlma.Durum(id, onceki, ornekTarihi).takeIf { onceki != durum })
    }

    fun sil(id: String): IslemSonucu = yap {
        val b = kisalt(baslik(id))
        c.sil(id)
        IslemSonucu("“$b” silindi", GeriAlma.GeriYukle(id))
    }

    fun geriYukle(id: String): IslemSonucu = yap {
        val b = kisalt(baslik(id))
        c.geriYukle(id)
        IslemSonucu("“$b” geri yüklendi", GeriAlma.Sil(id))
    }

    fun onayla(id: String): IslemSonucu = yap {
        val b = kisalt(baslik(id))
        c.onayla(id)
        IslemSonucu("“$b” onaylandı; hatırlatmaları kuruldu")
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
