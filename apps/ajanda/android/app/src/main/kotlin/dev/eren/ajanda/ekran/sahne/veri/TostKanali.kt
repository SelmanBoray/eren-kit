package dev.eren.ajanda.ekran.sahne.veri

import dev.eren.ajanda.ekran.GeriAlma
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Uygulamanın tek tost kanalı (SAHNE.md §5.13): Bugün, Takvim ve Tarihsizler aynı kanala yazar. Aynı anda bir tost
 * vardır; yenisi eskisinin yerini alır. Sekme değişse de tost kalan süresiyle yeni ekranda sürer ve "Geri al" onu
 * çıkaran depoya gider (her tost kendi geri alıcısını taşır).
 *
 * Süre iki saatle sınırlıdır: ekranın saydığı süre (ekran yokken işlemez; kullanıcı dönünce geri alma elindedir)
 * ve **gerçek saatle üst sınır** ([UST_SINIR_MS] ya da önerilen sürenin biraz fazlası): telefon kilitli kalıp
 * saatler sonra açılınca eski bir tost "Geri al"ıyla yeniden çıkmaz (G3).
 *
 * İş parçacığı: [goster] her iş parçacığından (çoğu arka iş parçacığı); süre ve geri alma ana iş parçacığından.
 */
class TostKanali(private val zaman: () -> Long = System::currentTimeMillis) {
    private val _tost = MutableStateFlow<TostIstegi?>(null)
    val tost: StateFlow<TostIstegi?> = _tost.asStateFlow()
    private val tostNo = AtomicLong()

    /** Tost numarası -> geri alıcı (yalnız son birkaç tost tutulur). */
    private val geriAlicilar = ConcurrentHashMap<Long, (GeriAlma) -> Unit>()

    /** Tost numarası -> gösterildiği gerçek an (ms). */
    private val baslangic = ConcurrentHashMap<Long, Long>()

    // Yalnız ana iş parçacığında.
    private var gosterilenNo = 0L
    private var gosterilenKalan = 0L
    private var gosterilenSon = Long.MAX_VALUE
    private var geriAlinanNo = 0L

    /** Tostu gösterir. [geriAl]: "Geri al"a dokunulunca [geriAlma]'yı çekirdeğe götürecek depo. */
    fun goster(mesaj: String, geriAlma: GeriAlma?, hata: Boolean = false, geriAl: ((GeriAlma) -> Unit)? = null) {
        val no = tostNo.incrementAndGet()
        if (geriAl != null) geriAlicilar[no] = geriAl
        baslangic[no] = zaman()
        geriAlicilar.keys.removeAll { it < no - TUTULAN }
        baslangic.keys.removeAll { it < no - TUTULAN }
        _tost.value = TostIstegi(no, mesaj, geriAlma, hata)
    }

    /**
     * Tostun ekranda kalacağı süre. Yeni tostta [ilkSure]'yi verir; ekran yeniden kurulunca (döndürme, ayrıntıdan
     * ya da başka sekmeden dönüş) aynı tost kalan süresiyle döner. Süresi dolmuş, gerçek saatle üst sınırı geçmiş,
     * eylemi kullanılmış ya da yerini yenisine bırakmış tost için `null`.
     */
    fun tostSuresi(no: Long, ilkSure: () -> Long): Long? {
        if (no < gosterilenNo) return null
        if (no == gosterilenNo) return gosterilenKalan.takeIf { it > 0 && zaman() < gosterilenSon }
        val bas = baslangic[no] ?: zaman()
        val sure = ilkSure()
        gosterilenNo = no
        gosterilenSon = bas + maxOf(UST_SINIR_MS, sure + PAY_MS)
        if (zaman() >= gosterilenSon) {
            gosterilenKalan = 0
            return null
        }
        return sure.also { gosterilenKalan = it }
    }

    fun tostKalani(no: Long, kalan: Long) {
        if (no == gosterilenNo) gosterilenKalan = kalan
    }

    /**
     * "Geri al": her tost için bir kez ve üst sınır geçmeden. Tostun kendi geri alıcısı yoksa [yedek] (dışarıdan
     * kurulmuş tost isteği).
     */
    fun tostuGeriAl(t: TostIstegi, yedek: (GeriAlma) -> Unit) {
        val g = t.geriAlma ?: return
        if (t.no <= geriAlinanNo) return
        val bas = baslangic[t.no]
        val son = if (t.no == gosterilenNo) gosterilenSon else (bas ?: zaman()) + UST_SINIR_MS
        if (zaman() >= son) return
        geriAlinanNo = t.no
        if (t.no == gosterilenNo) gosterilenKalan = 0
        (geriAlicilar.remove(t.no) ?: yedek)(g)
    }

    companion object {
        private const val TUTULAN = 8

        /** Bir tostun gerçek saatle en çok yaşayacağı süre (önerilen süre bundan uzunsa o + [PAY_MS]). */
        const val UST_SINIR_MS = 30_000L
        private const val PAY_MS = 5_000L
    }
}
