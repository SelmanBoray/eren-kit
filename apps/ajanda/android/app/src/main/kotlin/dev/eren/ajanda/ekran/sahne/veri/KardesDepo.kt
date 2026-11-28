package dev.eren.ajanda.ekran.sahne.veri

import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.ekran.CekirdekYuzu
import dev.eren.ajanda.ekran.GeriAlma
import dev.eren.ajanda.ekran.IslemSonucu
import dev.eren.ajanda.ekran.KayitFormu
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.ZonedDateTime
import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException

/**
 * Bugün deposunun kardeşleriyle (Takvim, Tarihsizler) paylaştığı ortam: çekirdek, saat, **tek** arka iş
 * parçacığı, ana iş parçacığına geçiş, tost kanalı ve "bitenleri gizle" seçimi. Bütün çekirdek çağrıları aynı
 * iş parçacığında sıraya girer (çekirdek eşzamanlı; iki depo aynı anda girmez).
 */
class DepoOrtami internal constructor(
    val yuz: () -> CekirdekYuzu,
    val saat: () -> ZonedDateTime,
    private val calistirici: Executor,
    val anaya: (() -> Unit) -> Unit,
    val tost: TostKanali,
    /** Bugün'ün "Bitenler: Gizle/Göster" seçimi; Takvim ve Tarihsizler de uyar. Her iş parçacığından okunur. */
    val bitenleriGizle: () -> Boolean,
    /** Seçimi değiştirir (Bugün deposu yazar, kalıcıdır ve bütün kardeşlere dağıtır). */
    val bitenleriGizleDegistir: (Boolean) -> Unit,
) {
    /** [is_]'i arka iş parçacığında çalıştırır; hata tost olur, kapanıyorsa sessizce bırakılır. */
    fun arkada(is_: () -> Unit) {
        try {
            calistirici.execute {
                try {
                    is_()
                } catch (e: Exception) {
                    tost.goster(KayitFormu.hataMesaji(e).mesaj, null, hata = true)
                } catch (_: LinkageError) {
                    tost.goster("Ajanda çekirdeği yüklenemedi.", null, hata = true)
                }
            }
        } catch (_: RejectedExecutionException) {
            // Kapanıyor.
        }
    }
}

/**
 * Bugün'ün kardeş depolarının ortak gövdesi (Takvim, Tarihsizler): değişmez model [model]'e (`StateFlow`) yazılır,
 * işlemler ve okumalar [DepoOrtami]'nın tek arka iş parçacığında. Bugün deposunun kalıbı (§ BugunDeposu):
 *
 * - **Gözlemci** Bugün deposundadır (tek kayıt); değişikliği arka iş parçacığında kardeşlere dağıtır
 *   ([degistiArkada]). Ekranı görünmeyen kardeş okumaz, yalnız bayatlar; görünür olunca ([goruldu]) okur.
 * - **İşlem**: çekirdeğe gider, etkilediği kayıtlar hemen yeniden okunur, model yazılır, sonra [bitince] ana iş
 *   parçacığında ve tost. Başarı tostu model kurulamasa da gösterilir (geri alma kaybolmaz).
 * - **Geri alma** tostun kendi geri alıcısıyla bu depoya döner; çekirdekteki şimdiki durum işlemin bıraktığı
 *   değilse (bu arada PC değiştirdi) uygulanmaz ([KayitKurucu.geriAl]).
 *
 * Alt sınıf yalnız okumayı ve modeli verir.
 */
abstract class KardesDepo<M : Any>(protected val ortam: DepoOrtami, ilk: M) : KayitIslemleri {
    @Suppress("PropertyName")
    protected val _model = MutableStateFlow(ilk)
    val model: StateFlow<M> = _model.asStateFlow()

    // Yalnız arka iş parçacığında.
    private var gorunur = false
    private var bayat = true

    protected val c: CekirdekYuzu get() = ortam.yuz()

    /** Uygulamanın ortak tost kanalı (ekran bağlar). */
    val tostKanali: TostKanali get() = ortam.tost

    /** Her şeyi okur (açılış, öne geliş, ekran yeniden görünür oldu). Arka iş parçacığında. */
    protected abstract fun hepsiniOku()

    /** Gözlemci bildirimi ya da işlemin etkisi: yalnız etkileneni okur. Arka iş parçacığında. */
    protected abstract fun degisiklik(d: Degisim)

    /** Çizim modeli (gün değiştiyse gerekeni okuyabilir). Arka iş parçacığında. */
    protected abstract fun kur(): M

    /** "Bitenleri gizle" değişti: okuma seçimi değişir. Arka iş parçacığında. */
    protected open fun gizleDegisti(gizle: Boolean) = Unit

    protected fun yayinla() {
        _model.value = kur()
    }

    /** Okuma ve model yazıldıktan sonraki düşük öncelikli iş (Takvim: komşu aylar, nokta renkleri). */
    protected open fun yayinlaSonrasi() = Unit

    protected fun arkada(is_: () -> Unit) = ortam.arkada(is_)

    /** Ekran çizildi: bayatsa okur, modeli yazar. */
    fun goruldu() = arkada {
        gorunur = true
        if (bayat) {
            hepsiniOku()
            bayat = false
        }
        yayinla()
        yayinlaSonrasi()
    }

    /** Ekran gitti (başka sekme): değişiklikler artık yalnız bayatlatır. */
    fun gizlendi() = arkada { gorunur = false }

    /** Gözlemciye bakmadan her şeyi yeniden okur ("Yeniden dene"). */
    fun yenile() = arkada {
        hepsiniOku()
        bayat = false
        yayinla()
        yayinlaSonrasi()
    }

    // Bugün deposunun dağıttıkları (zaten arka iş parçacığında).

    internal fun baslaArkada() {
        hepsiniOku()
        bayat = false
        yayinla()
        yayinlaSonrasi()
    }

    internal fun degistiArkada(d: Degisim) {
        if (gorunur) {
            degisiklik(d)
            yayinla()
            yayinlaSonrasi()
        } else if (d.tumu || d.kayitlar.isNotEmpty()) {
            bayat = true
        }
    }

    internal fun dakikaArkada() {
        if (gorunur) yayinla()
    }

    internal fun gizleArkada(gizle: Boolean) {
        gizleDegisti(gizle)
        if (gorunur) {
            hepsiniOku()
            bayat = false
            yayinla()
            yayinlaSonrasi()
        } else {
            bayat = true
        }
    }

    private fun kayitlar(vararg id: String) = Degisim(id.toList(), false, false, false, false, emptyList())

    /**
     * İşlemi yapar, etkilediği kayıtları hemen yeniden okur (gözlemci de birazdan bildirir, ama kilit model
     * güncellenmeden açılmasın), modeli yazar, sonra [bitince] ve tost. Model kurulamasa da kilit açılır ve
     * işlemin tostu (geri almasıyla) gösterilir; kurulamama ayrıca hata tostu olur.
     */
    protected fun islem(bitince: () -> Unit, etki: Degisim, beklenti: ((IslemSonucu) -> GeriAlmaBeklentisi?)? = null, f: () -> IslemSonucu): Unit = arkada {
        val s = try {
            f()
        } catch (e: Exception) {
            IslemSonucu(KayitFormu.hataMesaji(e).mesaj, hata = true)
        }
        var yenilemeHatasi: Exception? = null
        try {
            runCatching { degisiklik(etki) }
            yayinla()
            yayinlaSonrasi()
        } catch (e: Exception) {
            yenilemeHatasi = e
        } finally {
            ortam.anaya(bitince)
        }
        // Tek tost görünür: yenileme hatası önce, işlemin tostu (geri almasıyla) üstüne.
        yenilemeHatasi?.let { ortam.tost.goster(KayitFormu.hataMesaji(it).mesaj, null, hata = true) }
        if (s.mesaj != null) {
            val b = beklenti?.invoke(s)
            ortam.tost.goster(s.mesaj, s.geriAlma, s.hata) { g -> geriAl(g, b) }
        }
    }

    override fun tamamla(k: BugunKaydi, tamam: Boolean, bitince: () -> Unit) =
        islem(bitince, kayitlar(k.kayitId), { s -> KayitKurucu.beklenti(k, tamam, s) }) {
            KayitKurucu.tamamla(c, k, tamam, ortam.saat().toLocalDate())
        }

    override fun onayla(id: String, bitince: () -> Unit) = islem(bitince, kayitlar(id)) { KayitKurucu.onayla(c, id) }

    override fun hepsiniOnayla(idler: List<String>, bitince: () -> Unit) =
        islem(bitince, kayitlar(*idler.toTypedArray())) { KayitKurucu.hepsiniOnayla(c, idler) }

    override fun vazgec(id: String, bitince: () -> Unit) = islem(bitince, kayitlar(id)) { KayitKurucu.vazgec(c, id) }

    override fun imzaOynasin(anahtar: String): Boolean = false

    /** "Bitenler: Gizle/Göster" (Bugün'le ortak, kalıcı). */
    fun bitenleriGizle(b: Boolean) = ortam.bitenleriGizleDegistir(b)

    /** Tostun "Geri al"ı (ana iş parçacığından); [beklenen] varsa çekirdekteki şimdiki durum denetlenir. */
    fun geriAl(g: GeriAlma, beklenen: GeriAlmaBeklentisi? = null, bitince: () -> Unit = {}): Unit =
        islem(bitince, kayitlar(KayitKurucu.kimlik(g))) { KayitKurucu.geriAl(c, g, beklenen) }
}
