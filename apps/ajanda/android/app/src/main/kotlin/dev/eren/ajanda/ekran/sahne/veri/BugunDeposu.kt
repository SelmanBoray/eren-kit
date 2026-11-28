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
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException

/** Ekranın göstereceği tost isteği; [no] her istekte artar (aynı metin art arda da gösterilsin). */
data class TostIstegi(val no: Long, val mesaj: String, val geriAlma: GeriAlma?, val hata: Boolean = false)

/**
 * Çekirdek ile Compose arasındaki durum tutucu (Bugün sekmesi) ve kardeşlerinin (Takvim [takvim], Tarihsizler
 * [tarihsiz]) sahibi.
 *
 * İş parçacığı: bütün çekirdek çağrıları [calistirici]'da (üretimde tek iş parçacıklı); [BugunDenetleyici] ve
 * kardeşlerin denetleyicileri yalnız orada yaşar. Sonuç değişmez bir model olarak `StateFlow`'a yazılır; Compose onu
 * ana iş parçacığında okur. Ana iş parçacığı çekirdeğe hiç girmez, arka iş parçacığı Compose durumuna dokunmaz.
 *
 * Gözlemci: tek kayıt buradadır. Çekirdek [gozlemci]'yi kendi etki kilidi altında çağırır; burada yalnız değişiklik
 * biriktirilir ve [calistirici]'ya tek iş atılır; o iş Bugün'ü ve kardeşleri yeniler. Yaşam döngüsü ([basla],
 * [dur], [dakika], [yenile]) kardeşlere de dağıtılır: etkinlik yalnız bu depoyu tanır.
 *
 * Tost: uygulamanın tek kanalı ([tostKanali]); "Geri al" tostu çıkaran depoya döner.
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
    val tostKanali: TostKanali = TostKanali(),
) : KayitIslemleri {
    private val _model = MutableStateFlow(BugunModeli.yukleniyor(saat().toLocalDate()).copy(bitenleriGizle = bitenleriGizle))
    val model: StateFlow<BugunModeli> = _model.asStateFlow()

    val tost: StateFlow<TostIstegi?> get() = tostKanali.tost

    /** "Bitenler: Gizle" seçimi; her iş parçacığından okunur (kardeşler de uyar). */
    @Volatile private var gizle: Boolean = bitenleriGizle

    /**
     * Açılış hareketi (SAHNE.md §5.1) oynadı mı. Yalnız soğuk açılışta oynar: sekmeden dönüşte ve ekran
     * dönüşünde değil (depo etkinlik yeniden kurulsa da yaşar).
     */
    @Volatile var acilisOynadi: Boolean = false

    // Yalnız ana iş parçacığında (Compose).
    private var imzaGunu: java.time.LocalDate? = null
    private val imzaOynayanlar = HashSet<String>()

    /**
     * Tostun ekranda kalacağı süre (SAHNE.md §5.13; [TostKanali.tostSuresi]): ekran yeniden kurulunca aynı tost
     * kalan süresiyle döner, gerçek saatle üst sınırı vardır.
     */
    fun tostSuresi(no: Long, ilkSure: () -> Long): Long? = tostKanali.tostSuresi(no, ilkSure)

    /** Gösterilen tostun kalan süresi (ekran sayar, `TostDurumu`). */
    fun tostKalani(no: Long, kalan: Long) = tostKanali.tostKalani(no, kalan)

    /** Tostun "Geri al"ı: her tost için bir kez, tostu çıkaran depoya. */
    fun tostuGeriAl(t: TostIstegi) = tostKanali.tostuGeriAl(t) { geriAl(it) }

    /**
     * Bir kez oynayan imza ve kalem (SAHNE.md §5.15) bu gösterimde oynasın mı: kayıt başına **gün içinde bir
     * kez**. İlk soruşta `true` döner ve kaydı işaretler; aynı gün sonraki gösterimlerde imza çizili gelir.
     */
    override fun imzaOynasin(anahtar: String): Boolean {
        val gun = saat().toLocalDate()
        if (gun != imzaGunu) {
            imzaGunu = gun
            imzaOynayanlar.clear()
        }
        return imzaOynayanlar.add(anahtar)
    }

    // ---------------------------------------------------------------------------------------------
    // Kardeşler
    // ---------------------------------------------------------------------------------------------

    private val ortam = DepoOrtami(yuz, saat, calistirici, anaya, tostKanali, { gizle }, ::bitenleriGizle)
    private val kardesler = CopyOnWriteArrayList<KardesDepo<*>>()

    /** Takvim sekmesinin deposu: ilk istendiğinde kurulur, sonra gözlemciden ve yaşam döngüsünden pay alır. */
    val takvim: TakvimDeposu by lazy { TakvimDeposu(ortam).also { kardesler += it } }

    /** Tarihsizler sekmesinin deposu. */
    val tarihsiz: TarihsizDeposu by lazy { TarihsizDeposu(ortam).also { kardesler += it } }

    /** Kardeşlerin her birine (arka iş parçacığında) iş: birinin hatası ötekini durdurmaz. */
    private inline fun kardeslere(f: (KardesDepo<*>) -> Unit) {
        for (k in kardesler) {
            try {
                f(k)
            } catch (e: Exception) {
                tostGoster(KayitFormu.hataMesaji(e).mesaj, null, hata = true)
            }
        }
    }

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
                    try {
                        denetleyici().degisti(d)
                        yayinla()
                    } finally {
                        kardeslere { it.degistiArkada(d) }
                    }
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

    /** Gözlemciyi ekler ve her şeyi okur (öne geliş); kardeşler de okur (sekmeye geçiş beklemesin). */
    fun basla() = arkada {
        if (baglantiyiKes == null) baglantiyiKes = baglan?.invoke(gozlemci)
        try {
            denetleyici().hepsiniOku()
            yayinla()
        } finally {
            kardeslere { it.baslaArkada() }
        }
    }

    /** Gözlemciyi çıkarır (arka plana geçiş). */
    fun dur() = arkada {
        baglantiyiKes?.invoke()
        baglantiyiKes = null
    }

    /** Gözlemciye bakmadan her şeyi yeniden okur (eşleştirmeden dönüş gibi). */
    fun yenile() = arkada {
        try {
            denetleyici().hepsiniOku()
            yayinla()
        } finally {
            kardeslere { it.baslaArkada() }
        }
    }

    /** Dakikada bir: "geçti", gün cümlesi ve gün değişimi için yeniden kurar (gün değiştiyse çekirdeğe sorar). */
    fun dakika() = arkada {
        try {
            yayinla()
        } finally {
            kardeslere { it.dakikaArkada() }
        }
    }

    fun hatirlatmaVer(h: HatirlatmaDurumu?) = arkada {
        denetleyici().hatirlatma = h
        yayinla()
    }

    /** "Bitenler: Gizle/Göster" (Bugün, Takvim ve Tarihsizler ortak; kalıcı). */
    fun bitenleriGizle(b: Boolean) {
        gizle = b
        bitenleriGizleYaz(b)
        _model.value = _model.value.copy(bitenleriGizle = b)
        arkada {
            try {
                denetleyici().bitenleriGizle = b
                yayinla()
            } finally {
                kardeslere { it.gizleArkada(b) }
            }
        }
    }

    fun tostGoster(mesaj: String, geriAlma: GeriAlma?, hata: Boolean = false) {
        tostKanali.goster(mesaj, geriAlma, hata) { geriAl(it) }
    }

    /**
     * İşlemi yapar, etkilediği kayıtları hemen yeniden okur ([etki]; gözlemci de birazdan aynısını bildirir,
     * ama levhanın kilidi model güncellenmeden açılmasın), modeli yazar, sonra [bitince] ve tost.
     *
     * G4: işlemin tostu (geri almasıyla) model kurulamasa da gösterilir: çekirdekte iş olmuştur, geri alma yolu
     * kaybolmamalı. Kurulamama önce hata tostu olur, işlemin tostu onun yerini alır. [beklenti]: geri almanın ön koşulu (G3).
     */
    private fun islem(
        bitince: () -> Unit,
        etki: Degisim,
        beklenti: ((IslemSonucu) -> GeriAlmaBeklentisi?)? = null,
        f: (BugunDenetleyici) -> IslemSonucu,
    ): Unit = arkada {
        val s = try {
            f(denetleyici())
        } catch (e: Exception) {
            IslemSonucu(KayitFormu.hataMesaji(e).mesaj, hata = true)
        }
        var yenilemeHatasi: Exception? = null
        try {
            runCatching { denetleyici().degisti(etki) }
            yayinla()
        } catch (e: Exception) {
            yenilemeHatasi = e
        } finally {
            anaya(bitince)
        }
        // Tek tost görünür: yenileme hatası önce, işlemin tostu (geri almasıyla) üstüne; hata göstergede de kalır.
        yenilemeHatasi?.let { tostGoster(KayitFormu.hataMesaji(it).mesaj, null, hata = true) }
        if (s.mesaj != null) {
            val b = beklenti?.invoke(s)
            tostKanali.goster(s.mesaj, s.geriAlma, s.hata) { geriAl(it, b) }
        }
    }

    /** Ayrıntı için kaydı çekirdekten okur (Bugün modelinde değilse); [sonuc] ana iş parçacığında. */
    fun kayitOku(kayitId: String, sonuc: (AyrintiOzeti?) -> Unit) = arkada {
        val o = denetleyici().ayrintiOzeti(kayitId)
        anaya { sonuc(o) }
    }

    private fun kayitlar(vararg id: String) = Degisim(id.toList(), false, false, false, false, emptyList())

    override fun tamamla(k: BugunKaydi, tamam: Boolean, bitince: () -> Unit) =
        islem(bitince, kayitlar(k.kayitId), { s -> KayitKurucu.beklenti(k, tamam, s) }) { it.tamamla(k, tamam) }
    override fun onayla(id: String, bitince: () -> Unit) = islem(bitince, kayitlar(id)) { it.onayla(id) }
    override fun hepsiniOnayla(idler: List<String>, bitince: () -> Unit) = islem(bitince, kayitlar(*idler.toTypedArray())) { it.hepsiniOnayla(idler) }
    override fun vazgec(id: String, bitince: () -> Unit) = islem(bitince, kayitlar(id)) { it.vazgec(id) }
    fun retAt(islemId: String, bitince: () -> Unit = {}) =
        islem(bitince, Degisim(emptyList(), false, true, false, false, emptyList())) { it.retAt(islemId) }

    /** Geri alır; [beklenen] verilmişse kayıt bu arada başka yerden değiştiyse uygulanmaz (G3). */
    fun geriAl(g: GeriAlma, beklenen: GeriAlmaBeklentisi? = null, bitince: () -> Unit = {}): Unit =
        islem(bitince, kayitlar(KayitKurucu.kimlik(g))) { it.geriAl(g, beklenen) }
}
