package dev.eren.cihaz.adaptor

import android.accessibilityservice.AccessibilityService
import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import dev.eren.cihaz.cekirdek.AnahtarPortu
import dev.eren.cihaz.cekirdek.CihazOturumu
import dev.eren.cihaz.cekirdek.DenetimKaydi
import dev.eren.cihaz.cekirdek.DenetimPortu
import dev.eren.cihaz.cekirdek.EkranPortu
import dev.eren.cihaz.cekirdek.Eslesme
import dev.eren.cihaz.cekirdek.EylemPortu
import dev.eren.cihaz.cekirdek.GrantNedeni
import dev.eren.cihaz.cekirdek.Izinler
import dev.eren.cihaz.cekirdek.KomutIsleyici
import dev.eren.cihaz.cekirdek.Listeler
import dev.eren.cihaz.cekirdek.OturumBilgisi
import dev.eren.cihaz.cekirdek.RastgelePortu
import dev.eren.cihaz.cekirdek.SaatPortu
import dev.eren.cihaz.cekirdek.cihazOturumuKur
import dev.eren.cihaz.cekirdek.denetimKaydiKur
import dev.eren.cihaz.cekirdek.izinlerKur
import dev.eren.cihaz.cekirdek.komutIsleyiciKur
import dev.eren.cihaz.cekirdek.listelerKur
import java.io.File
import java.security.SecureRandom

/**
 * Ön plan (specialUse) servisi. Süreçteki tek çekirdek örneğini kurar ve `Baglanti`'yı başlatır;
 * Expo/React bağlamından bağımsızdır. Çekirdek kurulamazsa süreç çökmez: hata türü ve yığın dosyaya
 * yazılır, bildirim bunu söyler.
 *
 * İplikler: ana iplikte yalnız ön plana geçiş, wake lock, izinlerin anında geri çekilmesi ve
 * erişilebilirlik servisinin portlara bağlanması/koparılması (geç bağlanma dahil) kalır.
 * Kurulum (bütün paketlerin imza/ad taraması, Keystore, OkHttp), saniyelik tik ve kapanış süreç
 * boyunca tek `eren-servis` ipliğinde sırayla çalışır; `cekirdek`, `baglanti`, `paketBilgisi`,
 * `sonBagli` yalnız o iplikte okunur ve yazılır.
 */
class CihazServisi : Service() {
    companion object {
        const val EKSTRA_WAKE_LOCK = "wake_lock"
        private const val EKSTRA_YENIDEN_ESLES = "yeniden_esles"

        /** Yakalanmamış istisna ve çekirdek kurulum hatası; yalnız tür ve yığın (`TanilamaActivity` okur). */
        const val ISTISNA_DOSYASI = "yakalanmamis_istisna.txt"
        private const val TIK_MS = 1000L
        private const val WL_ETIKET = "eren:servis"

        /**
         * Süreç ömrü boyunca tek iş ipliği. Eski örneğin kapanışı ile yeni örneğin kurulumu da burada
         * sıraya girer; `Adaptor.cekirdek` iki örnek arasında yarışmaz.
         */
        private val isIpi: HandlerThread by lazy { HandlerThread("eren-servis").apply { start() } }

        /** Servisi başlatır; arka plan kısıtı vb. ile reddedilirse false (çökmez). */
        @JvmStatic
        fun baslat(ctx: Context, wakeLock: Boolean = false): Boolean = try {
            ContextCompat.startForegroundService(
                ctx,
                Intent(ctx, CihazServisi::class.java).putExtra(EKSTRA_WAKE_LOCK, wakeLock),
            )
            true
        } catch (_: Exception) {
            false
        }

        /** Eşleşme değişti: izinler geri çekilir, eski bağlantı kapanır, yenisi kurulur (servis kapalıysa kalkar). */
        @JvmStatic
        fun eslesmeDegisti(ctx: Context): Boolean = try {
            ContextCompat.startForegroundService(
                ctx,
                Intent(ctx, CihazServisi::class.java).putExtra(EKSTRA_YENIDEN_ESLES, true),
            )
            true
        } catch (_: Exception) {
            false
        }

        @JvmStatic
        fun durdur(ctx: Context) {
            try {
                ctx.stopService(Intent(ctx, CihazServisi::class.java))
            } catch (_: Exception) {
            }
        }

        private var istisnaKuruldu = false

        /** Yığın izi iletisiz yazılır: tür + çerçeveler. İstisna metni kişisel/güvenilmez veri taşıyabilir. */
        private fun hataYaz(ctx: Context, etiket: String, t: Throwable) {
            try {
                // Biçim: ilk satır `tür: ileti` (ileti yerine yalnız kendi sabit etiketimiz), sonra `at` satırları.
                val sb = StringBuilder()
                sb.append(t.javaClass.name).append(": ").append(etiket).append('\n')
                var c: Throwable? = t
                var derin = 0
                while (c != null && derin < 5) {
                    if (derin > 0) sb.append("Caused by: ").append(c.javaClass.name).append('\n')
                    for (e in c.stackTrace.take(40)) sb.append("\tat ").append(e.toString()).append('\n')
                    c = c.cause
                    derin++
                }
                File(ctx.filesDir, ISTISNA_DOSYASI).writeText(sb.toString())
            } catch (_: Throwable) {
            }
        }

        @Synchronized
        private fun istisnaIsleyiciKur(ctx: Context) {
            if (istisnaKuruldu) return
            istisnaKuruldu = true
            val uygulama = ctx.applicationContext
            val onceki = Thread.getDefaultUncaughtExceptionHandler()
            Thread.setDefaultUncaughtExceptionHandler { iplik, t ->
                hataYaz(uygulama, "yakalanmamis", t)
                onceki?.uncaughtException(iplik, t)
            }
        }
    }

    private val saat = object : SaatPortu {
        override fun monotonikMs(): Long = SystemClock.elapsedRealtime()
        override fun duvarMs(): Long = System.currentTimeMillis()
        override fun uyu(ms: Long) {
            if (ms > 0) Thread.sleep(ms)
        }
    }

    private val rastgele = object : RastgelePortu {
        private val sr = SecureRandom()
        override fun baytlar(adet: Int): ByteArray = ByteArray(adet).also { sr.nextBytes(it) }
    }

    /** Oturum eşleşmeden sonra kurulur; komut işleyici ona bu sarmalayıcıdan bakar. */
    private class OturumVekili : OturumBilgisi {
        @Volatile var gercek: CihazOturumu? = null
        override fun pcSimdiMs(): Long? = gercek?.pcSimdiMs()
        override fun baglantiNo(): Long = gercek?.baglantiNo() ?: 0L
    }

    private inner class Cekirdek(
        override val ekran: EkranPortu,
        override val eylem: EylemPortu,
        private val a11y: List<A11yBagi>,
        override val anahtar: AnahtarPortu,
        override val denetimPortu: DenetimPortu,
        override val denetimKapisi: DenetimKapisi,
        override val izinler: Izinler,
        override val listeler: Listeler,
        override val denetim: DenetimKaydi,
        override val paket: PaketKapisi,
    ) : CekirdekErisimi {
        override val saat: SaatPortu get() = this@CihazServisi.saat
        override val rastgele: RastgelePortu get() = this@CihazServisi.rastgele
        override lateinit var komutIsleyici: KomutIsleyici

        /**
         * Portlara bağlı servis örneği. Ana iplik yazar (geri çağrılar ve `canliServisiBagla` orada).
         * Aynı örneğin ikinci kez bağlanması (geç bağlanma ile `onServiceConnected` yarışı) hiçbir şey
         * yapmaz: `EkranOkuyucu.bagla` süren okumayı geçersiz kılar, olaylar zaten gitmiştir.
         */
        @Volatile private var bagliServis: AccessibilityService? = null

        // Erişilebilirlik geri çağrıları ana iplikte gelir: portlar ve izin geri çekme hemen (kısa),
        // durum çerçevesi ve köprü olayları iş ipliğinde.
        override fun erisilebilirlikBaglandi(servis: AccessibilityService) {
            if (bagliServis === servis) return
            bagliServis = servis
            a11y.forEach { it.bagla(servis) }
            arkada {
                Adaptor.oturumGuncelle?.cihazDurumuDegisti()
                Adaptor.olaylar?.durumDegisti()
            }
        }

        override fun erisilebilirlikKoptu() {
            bagliServis = null
            a11y.forEach { it.kopar() }
            // Yalnız kopuş anındaki izinler, tek tek: geri çekme geç çalışırsa kopuştan SONRA doğan
            // (servis kapanıp hemen yeniden açılınca verilen) izne dokunmaz.
            val kimlikler = izinler.aktifler().map { it.kayit.grantId }
            val g = Adaptor.oturumGuncelle
            for (id in kimlikler) {
                try {
                    if (g != null) {
                        g.izinGeriCek(id, GrantNedeni.ERISILEBILIRLIK_KAPANDI)
                    } else {
                        izinler.geriCek(id, GrantNedeni.ERISILEBILIRLIK_KAPANDI)
                    }
                } catch (t: Throwable) {
                    hataYaz(this@CihazServisi, "erisim_kopus_izin", t)
                    // Oturum yolu düştüyse izin yine de yerelde ölür (yoksa boş liste döner, yan etkisiz).
                    try {
                        izinler.geriCek(id, GrantNedeni.ERISILEBILIRLIK_KAPANDI)
                    } catch (_: Throwable) {
                    }
                }
            }
            arkada {
                Adaptor.oturumGuncelle?.cihazDurumuDegisti()
                Adaptor.olaylar?.durumDegisti()
                Adaptor.olaylar?.izinlerDegisti()
            }
        }
    }

    // Ana iplik yazar (onCreate/onDestroy), iş ipliği okur.
    @Volatile private var isci: Handler? = null
    @Volatile private var kapandi = false
    @Volatile private var bildirimler: Bildirimler? = null

    // Yalnız iş ipliği; `cekirdek` onDestroy'da da okunur (yayından hemen çekmek için).
    @Volatile private var cekirdek: Cekirdek? = null
    private var paketBilgisi: PaketBilgisi? = null
    private var eslesmeDeposu: EslesmeDeposu? = null
    private val vekil = OturumVekili()
    private var baglanti: Baglanti? = null
    private var sonBagli = false

    // Yalnız ana iplik.
    private var wl: PowerManager.WakeLock? = null

    /** Erişilebilirlik bağlama/kopma ana iplikte sıralanır; geç bağlanma da oraya gider. */
    private val anaIplik = Handler(Looper.getMainLooper())

    private val tikR: Runnable = object : Runnable {
        override fun run() {
            if (kapandi) return
            try {
                tik()
            } catch (t: Throwable) {
                hataYaz(this@CihazServisi, "tik", t)
            }
            isci?.postDelayed(this, TIK_MS)
        }
    }

    override fun onBind(i: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        istisnaIsleyiciKur(this)
        AnaIplikBekcisi.baslat(this)
        val b = Bildirimler(this).also { bildirimler = it }
        val n = try {
            b.kanallariKur()
            b.onPlan()
        } catch (t: Throwable) {
            hataYaz(this, "bildirim", t)
            stopSelf()
            return
        }
        if (!onPlanaGec(n)) {
            stopSelf()
            return
        }
        // Paket taraması yüzlerce PackageManager çağrısı ve kaynak yüklemesidir: ana iplikte ANR yapar.
        val h = Handler(isIpi.looper)
        isci = h
        h.post { kur(b) }
    }

    /** İş ipliği. */
    private fun kur(b: Bildirimler) {
        if (kapandi) return
        try {
            cekirdekKur(b)
        } catch (t: Throwable) {
            // Çekirdek kurulamadı: süreç çökmez, bağlantı açılmaz, bildirim bunu söyler.
            hataYaz(this, "cekirdek_kurulum", t)
            cekirdek?.let { if (Adaptor.cekirdek === it) Adaptor.cekirdek = null }
            cekirdek = null
            b.cekirdekHatasi()
            // Çekirdek yoksa aktif izin de yok.
            erisimUzlastir(false)
            return
        }
        if (kapandi) return
        baglantiKur()
        isci?.post(tikR)
    }

    /** İş ipliği. */
    private fun cekirdekKur(b: Bildirimler) {
        val denetimDosyasi = DenetimDosyasi(this)
        val paket = PaketBilgisi(this).also { paketBilgisi = it }
        val ekran = EkranOkuyucu(applicationContext)
        val eylem = Eylemci()
        val anahtar = AnahtarDeposu()
        val denetim = denetimKaydiKur.kur(denetimDosyasi, saat)
        // Önceki süreçten kalan izin kimliklerini kurucu diskten okur; çekirdek bunları işler.
        val izinler = izinlerKur.kur(saat, rastgele, denetimDosyasi, denetim)
        val listeler = listelerKur.kur(packageName, paket.listeGirdisi())
        val c = Cekirdek(
            ekran = ekran,
            eylem = eylem,
            a11y = listOf(ekran, eylem),
            anahtar = anahtar,
            denetimPortu = denetimDosyasi,
            denetimKapisi = denetimDosyasi,
            izinler = izinler,
            listeler = listeler,
            denetim = denetim,
            paket = paket,
        )
        c.komutIsleyici = komutIsleyiciKur.kur(ekran, eylem, saat, izinler, listeler, denetim, vekil)
        cekirdek = c
        eslesmeDeposu = EslesmeDeposu(this)
        // Tarama sürerken servis durdurulduysa yayınlanmaz; `kapat` sırada bekliyor.
        if (kapandi) return
        Adaptor.cekirdek = c
        paket.baslat()
        b.sayac(0, 0, null)
        // Çökme/yeniden başlatmadan açık kalmış erişilebilirlik servisi, aktif izin yoksa kapanır.
        erisimUzlastir(izinler.aktifler().isNotEmpty())
        // Servis çekirdekten önce bağlandıysa (açılış, elle açma) portlara şimdi bağlanır.
        canliServisiBagla(c)
    }

    /**
     * İş ipliğinden çağrılır, iş ana iplikte: kontrol ve bağlama, `ErisimServisi`'nin bağlanma/kopma
     * geri çağrılarıyla aynı iplikte sıralanır; arada kopmuş bir servis bağlanmaz. Zaten bağlıysa
     * `erisilebilirlikBaglandi` hiçbir şey yapmaz.
     */
    private fun canliServisiBagla(c: Cekirdek) {
        anaIplik.post {
            if (kapandi || Adaptor.cekirdek !== c) return@post
            try {
                val s = ErisimAnahtari.canliServis() ?: return@post
                c.erisilebilirlikBaglandi(s)
            } catch (t: Throwable) {
                hataYaz(this, "erisim_gec_baglanma", t)
            }
        }
    }

    /** Erişilebilirlik servisi yalnız aktif izin varken açık. Hata tiki ya da kurulumu durdurmaz. */
    private fun erisimUzlastir(aktifIzinVar: Boolean) {
        try {
            ErisimAnahtari.uzlastir(applicationContext, aktifIzinVar)
        } catch (t: Throwable) {
            hataYaz(this, "erisim_uzlastir", t)
        }
    }

    /** İş ipliği. Eşleşme varsa oturumu ve bağlantıyı kurar; yoksa sonraki `onStartCommand` yeniden dener. */
    private fun baglantiKur() {
        val c = cekirdek ?: return
        if (baglanti != null) return
        val k = try {
            eslesmeDeposu?.oku()
        } catch (_: Exception) {
            null
        } ?: return
        try {
            val oturum = cihazOturumuKur.kur(
                Eslesme(k.deviceId, k.pcAcikAnahtar),
                c.anahtar, rastgele, saat, c.ekran, c.izinler, c.listeler, c.denetim,
            )
            vekil.gercek = oturum
            val bg = Baglanti(this, oturum, bildirimler!!)
            baglanti = bg
            bg.baslat()
        } catch (t: Throwable) {
            hataYaz(this, "baglanti_kurulum", t)
            baglanti = null
            vekil.gercek = null
        }
    }

    /**
     * Ana iplik, eşleşme değişince: eski PC'nin izinleri sıra beklemeden düşer. Kısa iş (çekirdek
     * durumu + giden çerçeve hesabı); oturumun kapanışı iş ipliğinde `yenidenEsle`'de.
     */
    private fun izinleriHemenCek() {
        try {
            val g = Adaptor.oturumGuncelle
            if (g != null) {
                g.izinGeriCek(null, GrantNedeni.KULLANICI_DURDURDU)
            } else {
                Adaptor.cekirdek?.izinler?.geriCek(null, GrantNedeni.KULLANICI_DURDURDU)
            }
        } catch (t: Throwable) {
            hataYaz(this, "yeniden_esle_izin", t)
        }
    }

    /** İş ipliği. Eşleşme değişti: eski PC'ye verilmiş bütün izinler düşer, eski oturum kapanır. */
    private fun yenidenEsle() {
        val c = cekirdek ?: return
        val eski = baglanti
        try {
            if (eski != null) eski.izinGeriCek(null, GrantNedeni.KULLANICI_DURDURDU)
            else c.izinler.geriCek(null, GrantNedeni.KULLANICI_DURDURDU)
        } catch (t: Throwable) {
            hataYaz(this, "yeniden_esle_izin", t)
            try {
                c.izinler.geriCek(null, GrantNedeni.KULLANICI_DURDURDU)
            } catch (_: Throwable) {
            }
        }
        try {
            eski?.durdur()
        } catch (_: Exception) {
        }
        baglanti = null
        vekil.gercek = null
        sonBagli = false
        Adaptor.olaylar?.izinlerDegisti()
        Adaptor.olaylar?.durumDegisti()
    }

    /** Köprü/oturum bildirimi iş ipliğine; servis kapanıyorsa düşer (yalnız hızlandırıcı). */
    private fun arkada(blok: () -> Unit) {
        isci?.post {
            try {
                blok()
            } catch (t: Throwable) {
                hataYaz(this, "arka", t)
            }
        }
    }

    /** İş ipliği, saniyede bir. */
    private fun tik() {
        val c = cekirdek ?: return
        val b = bildirimler ?: return
        baglanti?.tik()
        val bagli = baglanti?.baglimi() == true
        if (bagli != sonBagli) {
            sonBagli = bagli
            b.baglantiDurumu(bagli)
            Adaptor.olaylar?.durumDegisti()
        }
        val aktif = c.izinler.aktifler().firstOrNull()
        // İzin kalmayınca erişilebilirlik servisi kapanır.
        erisimUzlastir(aktif != null)
        if (aktif == null) {
            b.sayac(0, 0, null)
        } else {
            val ilk = aktif.kayit.uygulamalar.firstOrNull()?.paket
            // Ad PackageManager'dan; plandaki metin bildirime girmez.
            val ad = if (ilk == null) "izin açık" else c.paket.ad(ilk)
            b.sayac(aktif.kalanMs, aktif.kayit.kalanButce, ad)
        }
    }

    private fun onPlanaGec(n: Notification): Boolean = try {
        ServiceCompat.startForeground(
            this,
            Bildirimler.ONPLAN_ID,
            n,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
        )
        true
    } catch (t: Exception) {
        // Arka planda başlatma kısıtı (üretici arayüzleri dahil): süreç ölmesin.
        hataYaz(this, "on_plan", t)
        false
    }

    override fun onStartCommand(i: Intent?, flags: Int, startId: Int): Int {
        // Yeniden eşleştirme amacı wake lock ayarına dokunmaz.
        if (i == null || i.hasExtra(EKSTRA_WAKE_LOCK)) {
            wakeLock(i?.getBooleanExtra(EKSTRA_WAKE_LOCK, false) == true)
        }
        val yeniden = i?.getBooleanExtra(EKSTRA_YENIDEN_ESLES, false) == true
        if (yeniden) izinleriHemenCek()
        isci?.post {
            if (kapandi) return@post
            if (yeniden) yenidenEsle()
            // Eşleşme servis ayaktayken yapıldıysa bağlantıyı şimdi kur.
            if (cekirdek != null) baglantiKur()
        }
        return START_STICKY
    }

    private fun wakeLock(acik: Boolean) {
        try {
            if (acik) {
                if (wl == null) {
                    wl = getSystemService(PowerManager::class.java)
                        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WL_ETIKET)
                        .apply { setReferenceCounted(false) }
                }
                if (wl?.isHeld == false) wl?.acquire()
            } else if (wl?.isHeld == true) {
                wl?.release()
            }
        } catch (_: SecurityException) {
            // Manifestte WAKE_LOCK yok; varsayılan kapalı kalır.
        }
    }

    override fun onDestroy() {
        wakeLock(false)
        kapandi = true
        // Çekirdek yayından hemen çekilir; bağlantı ve alıcıların kapanışı iş ipliğinde, sırayla.
        cekirdek?.let { if (Adaptor.cekirdek === it) Adaptor.cekirdek = null }
        // Çekirdekle birlikte izinler de yok olur: erişilebilirlik servisi açık kalmaz. Hata yıkımı durdurmaz.
        try {
            ErisimAnahtari.kapat(applicationContext)
        } catch (t: Throwable) {
            hataYaz(this, "erisim_kapat", t)
        }
        val h = isci
        isci = null
        if (h != null) {
            // Bekleyen kurulum/tik/komut düşer (yalnız bu örneğin iletileri).
            h.removeCallbacksAndMessages(null)
            h.post { kapat() }
        }
        super.onDestroy()
    }

    /** İş ipliği. */
    private fun kapat() {
        try {
            baglanti?.durdur()
        } catch (_: Exception) {
        }
        baglanti = null
        vekil.gercek = null
        try {
            paketBilgisi?.durdur()
        } catch (_: Exception) {
        }
        paketBilgisi = null
        cekirdek?.let { if (Adaptor.cekirdek === it) Adaptor.cekirdek = null }
        cekirdek = null
    }
}
