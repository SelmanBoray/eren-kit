package dev.eren.ajanda.ekran.sahne.veri

import androidx.compose.runtime.Stable
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.ekran.TakvimDurumu
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.time.LocalDate

/**
 * Takvim sekmesinin durum tutucusu ([KardesDepo]; Bugün deposu kurar ve yaşatır).
 *
 * Seçim ([secim]: gösterilen ay, seçili gün, "bugün") ana iş parçacığında **hemen** değişir: ekran gün lekesini
 * ve ayı dokunuş anında taşır, veri arka iş parçacığından arkasından gelir ([model]). Model hangi seçim için
 * kurulduğunu taşır; ekran ikisini eşler. Gece yarısı geçince bugünü seçili olan kullanıcı yeni güne taşınır
 * ([TakvimDurumu.bugunGuncelle], dakika sayacı).
 */
@Stable
class TakvimDeposu internal constructor(ortam: DepoOrtami) :
    KardesDepo<TakvimSahneModeli>(ortam, TakvimSahneModeli.bos(TakvimDurumu.baslangic(ortam.saat().toLocalDate()), ortam.bitenleriGizle())) {

    private val _secim = MutableStateFlow(TakvimDurumu.baslangic(ortam.saat().toLocalDate()))
    val secim: StateFlow<TakvimDurumu> = _secim.asStateFlow()

    /** Kullanıcı seçimi değiştirdi mi (kaydedilmiş seçim yalnız değişmemişken geri yüklenir). */
    @Volatile private var secimDegisti = false

    // Yalnız arka iş parçacığında.
    private var denetleyici: TakvimSahneDenetleyici? = null
    private var renkSirada = false

    private fun d(): TakvimSahneDenetleyici =
        denetleyici ?: TakvimSahneDenetleyici(c, ortam.saat).also { it.bitenleriGizle = ortam.bitenleriGizle(); denetleyici = it }

    /** Seçimin bugünü güncel mi (gün değiştiyse taşır); arka iş parçacığında, seçimi de günceller. */
    private fun guncelSecim(): TakvimDurumu {
        val bugun = ortam.saat().toLocalDate()
        _secim.update { it.bugunGuncelle(bugun) }
        return _secim.value
    }

    override fun hepsiniOku() {
        d().bitenleriGizle = ortam.bitenleriGizle()
        d().hepsiniOku(guncelSecim())
    }

    override fun degisiklik(d: Degisim) = d().degisti(d, guncelSecim())

    override fun kur(): TakvimSahneModeli {
        val s = guncelSecim()
        d().gerekeniOku(s)
        return d().model(s)
    }

    override fun gizleDegisti(gizle: Boolean) {
        d().bitenleriGizle = gizle
    }

    /** Model yazıldıktan sonra: komşu aylar ve nokta renkleri, sırayla (araya giren işlem beklemesin). */
    private fun sonraOku() {
        if (renkSirada) return
        renkSirada = true
        arkada {
            renkSirada = false
            val s = guncelSecim()
            d().komsulariOku(s)
            val kaldi = d().renkleriDoldur(s)
            yayinla()
            if (kaldi) sonraOku()
        }
    }

    /** Seçimi [f] ile değiştirir: ekran hemen, veri arka iş parçacığında. */
    private fun sec(f: (TakvimDurumu) -> TakvimDurumu) {
        secimDegisti = true
        _secim.update(f)
        arkada {
            val s = guncelSecim()
            d().gerekeniOku(s)
            yayinla()
            sonraOku()
        }
    }

    fun gunSec(t: LocalDate) = sec { it.gunSec(t) }
    fun ayKaydir(n: Long) = sec { it.ayKaydir(n) }
    fun bugune() = sec { it.bugune() }

    /** Kaydedilmiş seçim (süreç ölümü sonrası): yalnız kullanıcı bu süreçte seçim yapmadıysa. */
    fun geriYukle(d: TakvimDurumu) {
        if (secimDegisti) return
        sec { d.bugunGuncelle(it.bugun) }
    }

    override fun yayinlaSonrasi() = sonraOku()
}
