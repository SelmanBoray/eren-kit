package dev.eren.ajanda.ag

import dev.eren.ajanda.cekirdek.AjandaKanalHatasi
import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.Gozlemci
import dev.eren.ajanda.cekirdek.SurumUyusmazligi
import dev.eren.ajanda.cekirdek.Tasima
import java.util.PriorityQueue

/** Belgelemeye ayrılmış adres (RFC 5737): testler gerçek bir makineye işaret etmez. */
const val TEST_ADRESI = "ws://192.0.2.10:8765/ajanda"

/**
 * Sanal saatli, tek iş parçacıklı zamanlayıcı: hiçbir şey kendiliğinden çalışmaz; test [bosalt] ya da
 * [ilerle] der. `execute` ve `sonra` gerçeğiyle aynı sırada (zaman, sonra veriliş sırası) çalışır.
 */
class SahteZamanlayici : Zamanlayici {
    var simdi = 0L
        private set
    private var sayac = 0L

    private class Gorev(val an: Long, val sira: Long, val is_: Runnable) {
        var iptal = false
    }

    private val gorevler = PriorityQueue<Gorev>(compareBy<Gorev>({ it.an }, { it.sira }))

    override fun simdiMs(): Long = simdi

    override fun execute(command: Runnable) {
        gorevler += Gorev(simdi, sayac++, command)
    }

    override fun sonra(gecikmeMs: Long, is_: Runnable): Iptal {
        val g = Gorev(simdi + gecikmeMs.coerceAtLeast(0), sayac++, is_)
        gorevler += g
        return Iptal { g.iptal = true }
    }

    /** Şimdiye kadar olgunlaşmış her işi (çalışırken eklenenler dahil) çalıştırır. */
    fun bosalt() = ilerle(0)

    fun ilerle(ms: Long) {
        val hedef = simdi + ms
        while (true) {
            val g = gorevler.peek() ?: break
            if (g.an > hedef) break
            gorevler.poll()
            simdi = g.an
            if (!g.iptal) g.is_.run()
        }
        simdi = hedef
    }

    /** İptal edilmemiş bekleyen zamanlı işlerin kalan süreleri (ms), artan. */
    fun bekleyenler(): List<Long> = gorevler.filter { !it.iptal }.map { it.an - simdi }.sorted()
}

/** Elle sürülen ham soket: test olayları [dinleyici] üzerinden "okuma iş parçacığı" gibi verir. */
class SahteHamSoket(val adres: String, val dinleyici: HamDinleyici) : HamSoket {
    val gonderilen = mutableListOf<String>()
    var kapatmaKodu: Int? = null
    var iptalEdildi = false
    var gonderebilir = true

    val bitti get() = kapatmaKodu != null || iptalEdildi

    override fun gonder(metin: String): Boolean {
        if (!gonderebilir || bitti) return false
        gonderilen += metin
        return true
    }

    override fun kapat(kod: Int) {
        if (kapatmaKodu == null) kapatmaKodu = kod
    }

    override fun iptal() {
        iptalEdildi = true
    }

    // Test yardımcıları (OkHttp'nin yapacağı çağrılar)
    fun ac() = dinleyici.acildi(this)
    fun gelen(metin: String) = dinleyici.mesaj(metin)
    fun karsiKapatti(kod: Int = 1000) {
        dinleyici.kapaniyor(kod)
        dinleyici.kapandi(KapanisTuru.KARSI_KAPATTI)
    }
    fun hata() = dinleyici.kapandi(KapanisTuru.HATA)
    fun zamanAsimi() = dinleyici.kapandi(KapanisTuru.ZAMAN_ASIMI)
}

class SahteAcici : SoketAcici {
    val acilanlar = mutableListOf<SahteHamSoket>()
    var hata: RuntimeException? = null

    /** Aynı anda bitmemiş en çok soket sayısı (açılış anında ölçülür). */
    var enCokAcik = 0
        private set

    @Synchronized
    override fun ac(adres: String, dinleyici: HamDinleyici): HamSoket {
        hata?.let { throw it }
        val s = SahteHamSoket(adres, dinleyici)
        acilanlar += s
        enCokAcik = maxOf(enCokAcik, acilanlar.count { !it.bitti })
        return s
    }

    @get:Synchronized
    val son: SahteHamSoket get() = acilanlar.last()

    @Synchronized
    fun acikSayisi() = acilanlar.count { !it.bitti }
}

/**
 * Çekirdeğin ağ yüzünün sahtesi: olay günlüğü tutar ("acildi 1", "cerceve 1 x", "kapandi 1"), gerçeği
 * gibi nesil üretir ve eski nesli eler; açılışta ve gelen çerçeveye yanıt olarak `Tasima.gonder`'i
 * (etki kilidi altındaki gibi) çağırır.
 */
class SahteCekirdek : KanalCekirdegi {
    var adres: String? = TEST_ADRESI
    val olaylar = mutableListOf<String>()
    var acilisHatasi: Exception? = null
    var acilistaGonder: List<String> = emptyList()

    /** Gelen çerçeveye yanıt (gönderilecekler). "kapat" gelirse `Tasima.kapat`, "boz" gelirse atar. */
    var yanit: (String) -> List<String> = { emptyList() }
    var durum = durumOlustur(BaglantiAsamasi.KOPUK, 0)
    val gozlemciler = mutableListOf<Gozlemci>()
    private var nesil = 0UL
    private var guncel: Pair<ULong, Tasima>? = null

    @Synchronized
    override fun baglantiAdresi(): String? = adres

    @Synchronized
    override fun baglantiAcildi(tasima: Tasima): ULong {
        acilisHatasi?.let { throw it }
        nesil++
        guncel?.let { olaylar += "ortulu-kapandi ${it.first}" }
        guncel = nesil to tasima
        olaylar += "acildi $nesil"
        acilistaGonder.forEach { tasima.gonder(it) }
        return nesil
    }

    @Synchronized
    override fun cerceveGeldi(nesil: ULong, metin: String) {
        val g = guncel
        if (g == null || g.first != nesil) {
            olaylar += "yoksayildi $nesil"
            return
        }
        olaylar += "cerceve $nesil $metin"
        when (metin) {
            "kapat" -> g.second.kapat("test")
            "boz" -> {
                g.second.kapat("bozuk")
                throw CekirdekHatasi.GecersizGirdi("cerceve", "bozuk")
            }
            // Kapattırmadan atan çekirdek (beklenmeyen panik gibi).
            "patla" -> throw CekirdekHatasi.KabukCagrisi("patladı")
            else -> yanit(metin).forEach { g.second.gonder(it) }
        }
    }

    /** Kapanışla gelen karşı kodları (nesil sırasıyla). */
    val kapanisKodlari = mutableListOf<Int?>()

    @Synchronized
    override fun baglantiKapandi(nesil: ULong, kod: Int?) {
        olaylar += "kapandi $nesil"
        kapanisKodlari += kod
        if (guncel?.first == nesil) guncel = null
    }

    /** `baglantiDurumu()` çağrı sayısı. */
    var durumOkuma = 0
        private set

    /** `baglantiDurumu()` içinde, durum dönmeden önce (çekirdeğin yukarı denemesi gibi). */
    var durumOkunurken: () -> Unit = {}

    @Synchronized
    override fun baglantiDurumu(): BaglantiDurumu {
        durumOkuma++
        durumOkunurken()
        return durum
    }

    /** Çekirdeğin şimdiki bağlantıyı kendisi kapatması (`Tasima.kapat`). */
    @Synchronized
    fun kendisiKapat() {
        guncel?.second?.kapat("test")
    }

    var calismaKipi = CalismaKipi.BAGLI

    @Synchronized
    override fun kip(): CalismaKipi = calismaKipi

    @Synchronized
    override fun gozlemciEkle(gozlemci: Gozlemci): ULong {
        gozlemciler += gozlemci
        return gozlemciler.size.toULong()
    }

    /** Durumu değiştirip gözlemcilere `baglanti` değişimi bildirir (motorun yapacağı gibi). */
    fun durumYaz(asama: BaglantiAsamasi, kuyrukta: Int, surum: SurumUyusmazligi? = null, yukariDenemeMs: Long? = null) {
        synchronized(this) { durum = durumOlustur(asama, kuyrukta, surum).copy(yukariDenemeMs = yukariDenemeMs) }
        val d = Degisim(emptyList(), false, false, true, false, emptyList())
        gozlemciler.toList().forEach { it.degisti(d) }
    }

    fun eslesmeDegisti() {
        val d = Degisim(emptyList(), true, true, true, true, emptyList())
        gozlemciler.toList().forEach { it.degisti(d) }
    }

    @Synchronized
    fun kapanislar(): List<String> = olaylar.filter { it.startsWith("kapandi") }

    companion object {
        fun durumOlustur(asama: BaglantiAsamasi, kuyrukta: Int, surum: SurumUyusmazligi? = null) =
            BaglantiDurumu(asama, kuyrukta, 0, null, if (surum != null) AjandaKanalHatasi.PROTOKOL_UYUMSUZ else null, surum)
    }
}

class SahteAg(var var_: Boolean = true) : AgIzleyici {
    private var dinleyici: ((Boolean) -> Unit)? = null
    var baslatmaSayisi = 0

    override fun baslat(dinleyici: (agVar: Boolean) -> Unit): Boolean {
        baslatmaSayisi++
        this.dinleyici = dinleyici
        return var_
    }

    fun degistir(yeni: Boolean) {
        var_ = yeni
        dinleyici?.invoke(yeni)
    }
}

class SahteIsler : IsPlanlayici {
    val cagrilar = mutableListOf<String>()

    @Synchronized
    override fun periyodikKur() {
        cagrilar += "periyodik"
    }

    @Synchronized
    override fun periyodikIptal() {
        cagrilar += "periyodik-iptal"
    }

    @Synchronized
    override fun kuyrukIsiKur() {
        cagrilar += "kuyruk"
    }
}

/** Günlüğü toplar; testler içerik sızmadığını da denetler. */
class ToplayanGunluk : Gunluk {
    val satirlar = mutableListOf<String>()

    @Synchronized
    override fun bilgi(mesaj: String) {
        satirlar += mesaj
    }

    @Synchronized
    override fun uyari(mesaj: String, hata: Throwable?) {
        satirlar += if (hata == null) mesaj else "$mesaj (${hata.tur()})"
    }
}
