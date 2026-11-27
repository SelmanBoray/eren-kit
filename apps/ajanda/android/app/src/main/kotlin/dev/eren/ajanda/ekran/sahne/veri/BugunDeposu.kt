package dev.eren.ajanda.ekran.sahne.veri

import androidx.compose.runtime.Stable
import dev.eren.ajanda.alarm.HatirlatmaDurumu
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.Gozlemci
import dev.eren.ajanda.ekran.CekirdekYuzu
import dev.eren.ajanda.ekran.GeriAlma
import dev.eren.ajanda.ekran.IslemSonucu
import dev.eren.ajanda.ekran.KayitFormu
import dev.eren.ajanda.ekran.Yenileme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.ZonedDateTime
import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicLong

/** Ekranın göstereceği tost isteği; [no] her istekte artar (aynı metin art arda da gösterilsin). */
data class TostIstegi(val no: Long, val mesaj: String, val geriAlma: GeriAlma?, val hata: Boolean = false)

/**
 * Çekirdek ile Compose arasındaki durum tutucu (Bugün sekmesi).
 *
 * İş parçacığı: bütün çekirdek çağrıları [calistirici]'da (üretimde tek iş parçacıklı); [BugunDenetleyici]
 * yalnız orada yaşar. Sonuç değişmez bir [BugunModeli] olarak [model]'e yazılır; `StateFlow` her iş
 * parçacığından yazılabilir, Compose onu `collectAsState` ile ana iş parçacığında okur. Böylece ana iş
 * parçacığı çekirdeğe hiç girmez, arka iş parçacığı Compose durumuna hiç dokunmaz.
 *
 * Gözlemci: çekirdek [gozlemci]'yi kendi etki kilidi altında çağırır; burada yalnız değişiklik biriktirilir
 * ve [calistirici]'ya tek iş atılır (çekirdeğe yeniden girilmez; arka arkaya gelen bildirimler birleşir).
 * Kaydı yaşam döngüsü yapar ([basla]/[dur]); [baglan] gözlemciyi çekirdeğe ekleyip çıkaran işlevdir.
 *
 * İşlem sonrası tamamlama: [bitince] ana iş parçacığında ([anaya]) ve yeni model yazıldıktan sonra çağrılır;
 * ekran levhanın kilidini o zaman açar.
 */
@Stable
class BugunDeposu(
    private val yuz: () -> CekirdekYuzu,
    private val saat: () -> ZonedDateTime,
    private val calistirici: Executor,
    private val anaya: (() -> Unit) -> Unit,
    private val baglan: ((Gozlemci) -> (() -> Unit))? = null,
    bitenleriGizle: Boolean = false,
    private val bitenleriGizleYaz: (Boolean) -> Unit = {},
) {
    private val _model = MutableStateFlow(BugunModeli.yukleniyor(saat().toLocalDate()).copy(bitenleriGizle = bitenleriGizle))
    val model: StateFlow<BugunModeli> = _model.asStateFlow()

    private val _tost = MutableStateFlow<TostIstegi?>(null)
    val tost: StateFlow<TostIstegi?> = _tost.asStateFlow()
    private val tostNo = AtomicLong()

    /**
     * Açılış hareketi (SAHNE.md §5.1) oynadı mı. Yalnız soğuk açılışta oynar: sekmeden dönüşte ve ekran
     * dönüşünde değil (depo etkinlik yeniden kurulsa da yaşar).
     */
    @Volatile var acilisOynadi: Boolean = false

    /** Ekranın en son gösterdiği tostun numarası (sekmeye dönüşte aynı tost yeniden çıkmasın). */
    @Volatile var gosterilenTost: Long = 0

    // Yalnız [calistirici]'da.
    private var denetleyici: BugunDenetleyici? = null
    private var baglantiyiKes: (() -> Unit)? = null
    private val ilkGizle = bitenleriGizle

    private val kilit = Any()
    private var bekleyen: Degisim? = null
    private var sirada = false

    val gozlemci: Gozlemci = object : Gozlemci {
        // Çekirdeğin etki kilidi altında gelir: yalnız biriktirir, okuma arka iş parçacığında.
        override fun degisti(degisim: Degisim) {
            val at = synchronized(kilit) {
                bekleyen = Yenileme.birlestir(bekleyen, degisim)
                if (sirada) false else true.also { sirada = true }
            }
            if (at) arkada {
                val d = synchronized(kilit) {
                    sirada = false
                    bekleyen.also { bekleyen = null }
                }
                if (d != null) {
                    denetleyici().degisti(d)
                    yayinla()
                }
            }
        }
    }

    private fun denetleyici(): BugunDenetleyici =
        denetleyici ?: BugunDenetleyici(yuz(), saat).also { it.bitenleriGizle = ilkGizle; denetleyici = it }

    private fun arkada(is_: () -> Unit) {
        try {
            calistirici.execute {
                try {
                    is_()
                } catch (e: Exception) {
                    tostGoster(KayitFormu.hataMesaji(e).mesaj, null, hata = true)
                } catch (_: LinkageError) {
                    // Yerel kitaplık yüklenemedi: çökmek yerine söyle.
                    tostGoster("Ajanda çekirdeği yüklenemedi.", null, hata = true)
                }
            }
        } catch (_: RejectedExecutionException) {
            // Kapanıyor.
        }
    }

    private fun yayinla() {
        _model.value = denetleyici().model()
    }

    /** Gözlemciyi ekler ve her şeyi okur (öne geliş). */
    fun basla() = arkada {
        if (baglantiyiKes == null) baglantiyiKes = baglan?.invoke(gozlemci)
        denetleyici().hepsiniOku()
        yayinla()
    }

    /** Gözlemciyi çıkarır (arka plana geçiş). */
    fun dur() = arkada {
        baglantiyiKes?.invoke()
        baglantiyiKes = null
    }

    /** Gözlemciye bakmadan her şeyi yeniden okur (eşleştirmeden dönüş gibi). */
    fun yenile() = arkada {
        denetleyici().hepsiniOku()
        yayinla()
    }

    /** Dakikada bir: "geçti", gün cümlesi ve gün değişimi için yeniden kurar (gün değiştiyse çekirdeğe sorar). */
    fun dakika() = arkada { yayinla() }

    fun hatirlatmaVer(h: HatirlatmaDurumu?) = arkada {
        denetleyici().hatirlatma = h
        yayinla()
    }

    fun bitenleriGizle(b: Boolean) {
        bitenleriGizleYaz(b)
        _model.value = _model.value.copy(bitenleriGizle = b)
        arkada {
            denetleyici().bitenleriGizle = b
            yayinla()
        }
    }

    fun tostGoster(mesaj: String, geriAlma: GeriAlma?, hata: Boolean = false) {
        _tost.value = TostIstegi(tostNo.incrementAndGet(), mesaj, geriAlma, hata)
    }

    /**
     * İşlemi yapar, etkilediği kayıtları hemen yeniden okur ([etki]; gözlemci de birazdan aynısını bildirir,
     * ama levhanın kilidi model güncellenmeden açılmasın), modeli yazar, sonra [bitince] ve tost.
     */
    private fun islem(bitince: () -> Unit, etki: Degisim, f: (BugunDenetleyici) -> IslemSonucu) {
        val is_ = {
            val s = try {
                f(denetleyici())
            } finally {
                runCatching { denetleyici().degisti(etki) }
                yayinla()
                anaya(bitince)
            }
            if (s.mesaj != null) tostGoster(s.mesaj, s.geriAlma, s.hata)
        }
        arkada(is_)
    }

    private fun kayitlar(vararg id: String) = Degisim(id.toList(), false, false, false, false, emptyList())

    fun tamamla(k: BugunKaydi, tamam: Boolean = true, bitince: () -> Unit = {}) = islem(bitince, kayitlar(k.kayitId)) { it.tamamla(k, tamam) }
    fun onayla(id: String, bitince: () -> Unit = {}) = islem(bitince, kayitlar(id)) { it.onayla(id) }
    fun hepsiniOnayla(idler: List<String>, bitince: () -> Unit = {}) = islem(bitince, kayitlar(*idler.toTypedArray())) { it.hepsiniOnayla(idler) }
    fun vazgec(id: String, bitince: () -> Unit = {}) = islem(bitince, kayitlar(id)) { it.vazgec(id) }
    fun retAt(islemId: String, bitince: () -> Unit = {}) =
        islem(bitince, Degisim(emptyList(), false, true, false, false, emptyList())) { it.retAt(islemId) }
    fun geriAl(g: GeriAlma, bitince: () -> Unit = {}) = islem(
        bitince,
        kayitlar(
            when (g) {
                is GeriAlma.Durum -> g.kayitId
                is GeriAlma.GeriYukle -> g.kayitId
                is GeriAlma.Sil -> g.kayitId
            },
        ),
    ) { it.geriAl(g) }
}
