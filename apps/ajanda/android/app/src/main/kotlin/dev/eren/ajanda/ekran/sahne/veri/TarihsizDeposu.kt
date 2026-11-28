package dev.eren.ajanda.ekran.sahne.veri

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitGorunumu
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.Sekme
import dev.eren.ajanda.ekran.CekirdekYuzu
import dev.eren.ajanda.ekran.KayitFormu
import dev.eren.ajanda.ekran.Liste
import dev.eren.ajanda.ekran.Yenileme

/**
 * Tarihsizler sekmesinin modeli (SAHNE.md §3.4): yukarıdan aşağı asistanın önerileri (karakalem), yapılacaklar
 * (görev ve randevu; tamamlanır), notlar (tamamlanmaz), bitenler (hap; en son biten başta).
 */
@Immutable
data class TarihsizModeli(
    val yuklendi: Boolean,
    val taslaklar: List<BugunKaydi>,
    val yapilacaklar: List<BugunKaydi>,
    val notlar: List<BugunKaydi>,
    val bitenler: List<BugunKaydi>,
    val bitenleriGizle: Boolean,
    /** Liste okunamadı (elde veri yoksa liste boş değil, hata gösterilir; varsa eski hâli kalır). */
    val okumaHatasi: String? = null,
) {
    val acikSayisi: Int get() = taslaklar.size + yapilacaklar.size + notlar.size
    val bos: Boolean get() = acikSayisi == 0 && bitenler.isEmpty()

    fun ayrintiOzeti(kayitId: String): AyrintiOzeti? =
        (taslaklar + yapilacaklar + notlar + bitenler).firstOrNull { it.kayitId == kayitId }?.let { AyrintiOzeti(it, "Tarihsiz") }

    companion object {
        fun yukleniyor(gizle: Boolean) = TarihsizModeli(false, emptyList(), emptyList(), emptyList(), emptyList(), gizle)
    }
}

/**
 * Tarihsizler'in çekirdek konuşması (YALNIZ tek arka iş parçacığında). `liste(TARIHSIZ, kapalılar dahil)`: açık
 * ve kapalı tarihsiz kayıtlar tek sorguda; kapalılar "Bitenler" hap'larıdır (seçim gizliyse çizilmez, sayılır).
 * Okuma başarısızsa eldeki liste kalır, hata ayrıca söylenir.
 */
class TarihsizDenetleyici(private val c: CekirdekYuzu) {
    private var liste: List<KayitGorunumu>? = null
    private var hata: String? = null
    private var adresVar = false
    private var baglanti: BaglantiDurumu? = null

    fun hepsiniOku() {
        durumuOku()
        oku()
    }

    private fun oku() {
        try {
            liste = c.liste(Sekme.TARIHSIZ, true)
            hata = null
        } catch (e: Exception) {
            hata = KayitFormu.hataMesaji(e).mesaj
        }
    }

    private fun durumuOku() {
        try {
            adresVar = c.baglantiAdresi() != null
            baglanti = c.baglantiDurumu()
        } catch (_: Exception) {
            // Gönderim işareti eski hâliyle kalır; liste okuması ayrı.
        }
    }

    fun degisti(d: Degisim) {
        if (d.eslesme || d.baglanti) durumuOku()
        val plan = Yenileme.plan(d, if (liste != null) setOf(Sekme.TARIHSIZ) else emptySet())
        val okunacak = d.tumu || hata != null || liste == null || Sekme.TARIHSIZ in plan.listeler || plan.kayitlar.isNotEmpty()
        if (okunacak) oku()
    }

    fun model(gizle: Boolean): TarihsizModeli {
        val gonderim = Liste.Gonderim.hesapla(adresVar, baglanti?.asama)
        val l = liste.orEmpty().filter { !it.kayit.silindi }
        val (acik, kapali) = l.partition { it.kayit.durum == KayitDurumu.ACIK }
        val taslaklar = acik.filter { it.kayit.taslak }
        val (notlar, yapilacak) = acik.filterNot { it.kayit.taslak }.partition { it.kayit.tur == KayitTuru.NOT }
        fun kayit(g: KayitGorunumu): BugunKaydi {
            val k = g.kayit
            return KayitKurucu.kur(
                g, anahtar = k.kayitId,
                // Zamanı yoksa açıklamanın ilk satırı (eski Tarihsizler satırı gibi): not ve iş neyin nesi okunsun.
                zaman = (k.zaman as? AjandaZamani.Belirsiz)?.let { "“${it.ifade}”" } ?: ilkSatir(k.aciklama),
                hal = KayitKurucu.hal(k.durum, k.taslak), gecti = false, ornekTarihi = null, gonderim = gonderim,
                durumMetni = KayitKurucu.durumMetni(k.durum), iptal = k.durum == KayitDurumu.IPTAL,
                // v3 BAĞLANTI NOKTASI: `bolge = k.bolge?.ad`.
                bolge = null,
            ).let { if (it.tekrar && it.ornekTarihi == null) it.copy(tamamlanabilir = false) else it }
        }
        return TarihsizModeli(
            yuklendi = liste != null || hata != null,
            taslaklar = KomsuRenk.ayir(taslaklar.map(::kayit)),
            yapilacaklar = KomsuRenk.ayir(yapilacak.map(::kayit)),
            notlar = KomsuRenk.ayir(notlar.map(::kayit)),
            bitenler = KomsuRenk.ayir(kapali.sortedByDescending { it.kayit.guncellemeMs }.map(::kayit)),
            bitenleriGizle = gizle,
            okumaHatasi = hata,
        )
    }
}

private fun ilkSatir(s: String?): String? =
    s?.lineSequence()?.firstOrNull { it.isNotBlank() }?.trim()?.let { if (it.length > 80) it.take(79) + "…" else it }

/** Tarihsizler sekmesinin durum tutucusu ([KardesDepo]; Bugün deposu kurar ve yaşatır). */
@Stable
class TarihsizDeposu internal constructor(ortam: DepoOrtami) :
    KardesDepo<TarihsizModeli>(ortam, TarihsizModeli.yukleniyor(ortam.bitenleriGizle())) {
    private var denetleyici: TarihsizDenetleyici? = null
    private fun d() = denetleyici ?: TarihsizDenetleyici(c).also { denetleyici = it }

    override fun hepsiniOku() = d().hepsiniOku()
    override fun degisiklik(d: Degisim) = d().degisti(d)
    override fun kur(): TarihsizModeli = d().model(ortam.bitenleriGizle())

    /** Seçim yalnız gösterimi değiştirir (kapalılar zaten okunuyor): yeniden okumadan yeniden kur. */
    override fun gizleDegisti(gizle: Boolean) = Unit
}
