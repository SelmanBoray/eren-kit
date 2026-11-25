package dev.eren.ajanda.ag

import dev.eren.ajanda.cekirdek.Tasima

/**
 * Tek bir bağlantı denemesi: ham soket (OkHttp) ile çekirdek arasındaki köprü. Çekirdeğe `Tasima` (yazma
 * ucu), ham sokete `HamDinleyici` olur. Her deneme yeni bir nesne: eski soketin geç olayı yenisine karışmaz
 * (çekirdek ayrıca nesille eler).
 *
 * İş parçacıkları:
 * - `acildi`, `mesaj` okuma iş parçacığında: çekirdek çağrısı ORADA yapılır (çerçeve sırası doğal olarak
 *   korunur, büyük telafide TCP geri basıncı kalır; arada bellek kuyruğu yok).
 * - `gonder`, `kapat` çekirdeğin etki kilidi altında gelir: bloklamaz, çekirdeğe yeniden girmez.
 * - Kapanışın çekirdeğe bildirimi (`baglantiKapandi`) ve yöneticiye haber HER ZAMAN yöneticinin sıralı
 *   yürütücüsünde: geri çağrının içinden çekirdeğe girilmez, sonraki bağlantının açılışıyla sıra karışmaz.
 *
 * Kapanış kuralı: soket başına TAM BİR kez sonlanır (ilk gelen kazanır: karşı kapattı, hata, zaman aşımı,
 * biz kapattık, çekirdek kapattı, çerçeve sınırı). Çekirdek nesli verdiyse ona tam bir kez
 * `baglantiKapandi(nesil)` gider; açılış hata verdiyse (`ACILAMADI`) hiç gitmez (MIMARI.md R4 notu).
 * Nesil henüz gelmeden kapanış başladıysa (açılış sürerken kesildi) bildirimi açılış tamamlanınca yapar.
 *
 * Çerçeve sınırı: gelen ya da giden metin [AgAyarlari.azamiCerceve] UTF-16 birimini aşarsa çekirdeğe
 * verilmez/yollanmaz, bağlantı 1009 ile kapatılır. OkHttp gelen mesajı sınırsız tamponlar; denetim
 * tamponlandıktan sonradır (karşı uç eşleşmede kaydedilen Tailscale adresidir).
 */
class AjandaSoketi internal constructor(
    private val cekirdek: KanalCekirdegi,
    private val zaman: Zamanlayici,
    private val gunluk: Gunluk,
    private val ayar: AgAyarlari,
    private val olaylar: Olaylar,
) : Tasima, HamDinleyici {

    /** Yöneticiye haberler; ikisi de yöneticinin yürütücüsünde çağrılır. */
    interface Olaylar {
        /** Soket açıldı ve çekirdek kabul etti. */
        fun acildi(soket: AjandaSoketi)

        /** Bağlantı bitti; soket başına tam bir kez, çekirdeğe bildirildikten sonra. */
        fun kapandi(soket: AjandaSoketi, tur: KapanisTuru)
    }

    private enum class HamIslem { KAPAT, IPTAL, YOK }

    private val kilit = Any()

    // Yalnız [kilit] altında. Çekirdek çağrısı kilit altında YAPILMAZ: çekirdeğin etki kilidi altında gelen
    // `kapat`/`gonder` bu kilidi ister; kilit altında çekirdeği beklemek kilitlenme olurdu.
    private var ham: HamSoket? = null
    private var hamAcildi = false
    private var nesil: ULong? = null
    private var bitti = false

    /** Çekirdek bu bağlantıyı kabul etti mi (açılış süresi denetimi için). */
    val acik: Boolean
        get() = synchronized(kilit) { nesil != null && !bitti }

    /** Yöneticinin yürütücüsünde: soketi açar. Atarsa soket bitmiş sayılır ve haber verilir. */
    internal fun bagla(acici: SoketAcici, adres: String) {
        val h = try {
            acici.ac(adres, this)
        } catch (e: Exception) {
            gunluk.uyari("soket açılamadı", e)
            sonlandir(KapanisTuru.HATA, HamIslem.YOK, 0)
            return
        }
        val kes = synchronized(kilit) {
            if (ham == null) ham = h
            bitti
        }
        if (kes) h.iptal()
    }

    /** Yönetici bırakıyor (birak, oturum sonu, açılış süresi). */
    internal fun birak(tur: KapanisTuru) {
        sonlandir(tur, HamIslem.KAPAT, KOD_NORMAL)
    }

    // ---------------------------------------------------------------------------------------------
    // Tasima (çekirdeğin etki kilidi altında)
    // ---------------------------------------------------------------------------------------------

    override fun gonder(metin: String): Boolean {
        val h = synchronized(kilit) { if (bitti) null else ham } ?: return false
        if (metin.length > ayar.azamiCerceve) {
            gunluk.uyari("giden çerçeve sınırı aştı (${metin.length} birim)")
            sonlandir(KapanisTuru.CERCEVE_SINIRI, HamIslem.KAPAT, KOD_BUYUK)
            return false
        }
        return try {
            h.gonder(metin)
        } catch (e: Exception) {
            gunluk.uyari("gönderilemedi", e)
            false
        }
    }

    override fun kapat(neden: String) {
        // Neden metni günlüğe yazılmaz (karşıdan gelen ayrıntıyı taşıyabilir).
        sonlandir(KapanisTuru.CEKIRDEK_KAPATTI, HamIslem.KAPAT, KOD_NORMAL)
    }

    // ---------------------------------------------------------------------------------------------
    // HamDinleyici (okuma iş parçacığı)
    // ---------------------------------------------------------------------------------------------

    override fun acildi(soket: HamSoket) {
        val kesildi = synchronized(kilit) {
            if (ham == null) ham = soket
            hamAcildi = true
            bitti
        }
        if (kesildi) {
            soket.iptal()
            return
        }
        val n = try {
            cekirdek.baglantiAcildi(this)
        } catch (e: Exception) {
            // Eşleşme yok ya da kabuk hatası: çekirdek taşımayı kaydetmedi, kapanış ona bildirilmez.
            gunluk.uyari("çekirdek bağlantıyı açmadı", e)
            sonlandir(KapanisTuru.ACILAMADI, HamIslem.KAPAT, KOD_NORMAL)
            return
        }
        val gecKapanis = synchronized(kilit) {
            nesil = n
            bitti
        }
        if (gecKapanis) {
            // Açılış sürerken kapanış başladı (ör. çekirdek açılışta `kapat` dedi ya da süre doldu): kapanış
            // haberi zaten yollandı, çekirdeğe borçlu olunan tek bildirim burada.
            zaman.execute { cekirdegeKapanis(n) }
        } else {
            zaman.execute { olaylar.acildi(this) }
        }
    }

    override fun mesaj(metin: String) {
        val n = synchronized(kilit) { if (bitti) null else nesil } ?: return
        if (metin.length > ayar.azamiCerceve) {
            gunluk.uyari("gelen çerçeve sınırı aştı (${metin.length} birim)")
            sonlandir(KapanisTuru.CERCEVE_SINIRI, HamIslem.KAPAT, KOD_BUYUK)
            return
        }
        try {
            cekirdek.cerceveGeldi(n, metin)
        } catch (e: Exception) {
            // Çekirdek bağlantıyı zaten kapattırdı (`kapat` geldi); sürdür.
            gunluk.uyari("çerçeve işlenemedi", e)
        }
    }

    override fun ikiliMesaj() {
        gunluk.uyari("ikili çerçeve geldi")
        sonlandir(KapanisTuru.PROTOKOL, HamIslem.KAPAT, KOD_IKILI)
    }

    override fun kapaniyor(kod: Int) {
        // Kapanış el sıkışmasını tamamla (OkHttp yanıtı kendisi yollamaz).
        sonlandir(KapanisTuru.KARSI_KAPATTI, HamIslem.KAPAT, KOD_NORMAL)
    }

    override fun kapandi(tur: KapanisTuru) {
        sonlandir(tur, HamIslem.IPTAL, 0)
    }

    // ---------------------------------------------------------------------------------------------

    private fun sonlandir(tur: KapanisTuru, islem: HamIslem, kod: Int) {
        val h: HamSoket?
        val n: ULong?
        val acilmisti: Boolean
        synchronized(kilit) {
            if (bitti) return
            bitti = true
            h = ham
            n = nesil
            acilmisti = hamAcildi
        }
        if (h != null) {
            try {
                when {
                    islem == HamIslem.YOK -> {}
                    // Açılmamış soketin kapanış el sıkışması yok: kes.
                    islem == HamIslem.IPTAL || !acilmisti -> h.iptal()
                    else -> {
                        h.kapat(kod)
                        // Karşı taraf kapanışı yanıtlamazsa kaynak kalmasın (çekirdek beklemez, aşağıda bildirilir).
                        zaman.sonra(ayar.kapatmaBeklemeMs) { h.iptal() }
                    }
                }
            } catch (e: Exception) {
                gunluk.uyari("soket kapatılamadı", e)
            }
        }
        // `n == null` ve açılış sürüyorsa çekirdeğe bildirimi `acildi` yapar; ACILAMADI'da hiç yapılmaz.
        zaman.execute {
            if (n != null) cekirdegeKapanis(n)
            olaylar.kapandi(this, tur)
        }
    }

    private fun cekirdegeKapanis(n: ULong) {
        try {
            cekirdek.baglantiKapandi(n)
        } catch (e: Exception) {
            gunluk.uyari("çekirdeğe kapanış bildirilemedi", e)
        }
    }

    companion object {
        const val KOD_NORMAL = 1000
        const val KOD_IKILI = 1003
        const val KOD_BUYUK = 1009
    }
}
