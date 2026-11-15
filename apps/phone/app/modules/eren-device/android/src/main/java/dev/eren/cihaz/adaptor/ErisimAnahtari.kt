package dev.eren.cihaz.adaptor

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import dev.eren.cihaz.cekirdek.KisayolHedefleri

/** [ErisimAnahtari.ac] sonucu; geri çağrı her zaman tam bir kez ve ana iplikte gelir. */
enum class AcmaSonucu { ACIK, YETKI_YOK, ZAMAN_ASIMI }

/**
 * [ErisimAnahtari.sesKisayoluKur] sonucu. `KURULDU_DIGERLERIYLE`: kullanıcının önceki kısayol
 * hedefleri korundu, bizimki yanlarına eklendi (tuşlara basınca Android hangisini açacağını sorar).
 */
enum class SesKisayoluSonucu { KURULDU, KURULDU_DIGERLERIYLE, YETKI_YOK, HATA }

/**
 * Uygulamanın erişilebilirlik servisini (`ErisimServisi`) açıp kapatan süreç genelinde tek nesne ve
 * `Settings.Secure`'a yazan TEK yer. Karar: servis yalnız aktif izin varken açık; kurulumda bir kez
 * `adb shell pm grant dev.eren.app android.permission.WRITE_SECURE_SETTINGS`.
 *
 * İPLİKLER. Durum tek kilit altında; kilit altında IPC yapılmaz. Ayar okuma/yazma ve `disableSelf`
 * tek sıralı yazıcı ipliğinde ("eren-erisim") yürür; ekleme/çıkarma yazımları istendikleri sırayla
 * uygulanır. `ac` sonuçları ve zaman aşımı ana iplikte. Hiçbir çağrı ana ipliği bloklamaz.
 *
 * KAPANIŞ YARIŞI. Servis kopunca `CekirdekErisimi.erisilebilirlikKoptu` tüm izinleri geri çeker. Bu
 * yüzden kapanış sürerken gelen `ac` hemen `ACIK` dönmez: kopuşu bekler, sonra yeniden açar. `ACIK`
 * verildikten sonra da `uzlastir` en az [KAPATMA_BEKLEMESI_MS] kapatmaz (izin `ACIK` ile
 * `izinler.ekle` arasında doğarken servis kapanmasın diye "son bağlanma" sayılır).
 */
object ErisimAnahtari {
    const val ACMA_ZAMAN_ASIMI_MS = 4000L
    const val KAPATMA_BEKLEMESI_MS = 10_000L

    /** Hiç olmamış olayın zamanı; `simdi - HIC` taşmaz. */
    private const val HIC = Long.MIN_VALUE / 4

    /** AOSP `Settings.Secure.ACCESSIBILITY_SHORTCUT_TARGET_SERVICE` (@hide). */
    private const val KISAYOL_HEDEF = "accessibility_shortcut_target_service"

    private val kilit = Any()
    private val ana = Handler(Looper.getMainLooper())
    private val yazici: Handler by lazy {
        Handler(HandlerThread("eren-erisim").apply { start() }.looper)
    }

    // ---- Aşağıdakiler yalnız `kilit` altında okunur/yazılır. ----

    /** Bağlı servis örneği (`servisBaglandi` yazar, `servisKoptu` bırakır). */
    private var canli: AccessibilityService? = null

    /** `disableSelf` istendi, kopuş bekleniyor. Yalnız `canli != null` iken kurulur. */
    private var kapanisSuruyor = false
    private var kapanisBasMs = 0L

    /** Süren açma turunun bekleyenleri; tur çözülünce hepsi aynı sonucu alır. */
    private val bekleyenler = ArrayList<(AcmaSonucu) -> Unit>()

    /** Her tur başında ve çözümünde artar; eski turun zaman aşımı/yazımı yeni turu etkilemez. */
    private var tur = 0L

    /** Tur, kapanışın kopuşunu bekliyor; ekleme yazımı kopuştan sonra yapılır. */
    private var kopusBekleniyor = false
    private var turBaglami: Context? = null

    private var sonBaglanmaMs = HIC
    private var sonAktifMs = HIC

    // ---------------------------------------------------------------------------------------------

    /** `WRITE_SECURE_SETTINGS` verilmiş mi (kurulumda `adb shell pm grant`). */
    fun yetkiVar(ctx: Context): Boolean =
        ctx.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * Servisi açar. Bağlıysa hemen `ACIK`; yetki yoksa (ve bağlı değil ya da kapanıyorsa) `YETKI_YOK`.
     * Aksi halde listeye yalnız kendi bileşenini ekler, `ACCESSIBILITY_ENABLED=1` yazar; bağlanınca
     * `ACIK`, [ACMA_ZAMAN_ASIMI_MS] içinde bağlanmazsa `ZAMAN_ASIMI` (girdi geri çıkarılır). Kapanış
     * sürüyorsa önce kopuşu bekler. Süren tura katılan her çağrı aynı sonucu alır.
     */
    fun ac(ctx: Context, sonuc: (AcmaSonucu) -> Unit) {
        val app = uygulama(ctx)
        val yetki = yetkiVar(app)
        val simdi = SystemClock.elapsedRealtime()
        var yazilacakTur = 0L
        val hemen: AcmaSonucu? = synchronized(kilit) {
            if (bekleyenler.isNotEmpty()) {
                bekleyenler.add(sonuc)
                return
            }
            kapanisTakildiysaBirak(simdi)
            if (canli != null && !kapanisSuruyor) {
                sonBaglanmaMs = simdi
                return@synchronized AcmaSonucu.ACIK
            }
            // Bağlı değil ya da kapanıyor: yetkisiz yeniden açılamaz.
            if (!yetki) return@synchronized AcmaSonucu.YETKI_YOK
            bekleyenler.add(sonuc)
            val buTur = ++tur
            turBaglami = app
            kopusBekleniyor = kapanisSuruyor
            if (!kopusBekleniyor) yazilacakTur = buTur
            ana.postDelayed({ zamanAsimi(app, buTur) }, ACMA_ZAMAN_ASIMI_MS)
            null
        }
        if (hemen != null) ana.post { sonuc(hemen) }
        if (yazilacakTur > 0L) acmaYaz(app, yazilacakTur)
    }

    /**
     * Hemen kapatır. Canlı servis varsa `disableSelf()` (yetki istemez); yetki varsa listeden yalnız
     * kendi bileşenini de çıkarır (bağlı değilse tek yol, bağlıysa yedek). `ACCESSIBILITY_ENABLED`'a
     * ve başka servislere dokunmaz. Süren açma turu varsa `ZAMAN_ASIMI` ile iptal edilir. Yetki de
     * canlı servis de yoksa sessiz.
     */
    fun kapat(ctx: Context) {
        val app = uygulama(ctx)
        kapatIc(app, yetkiVar(app), SystemClock.elapsedRealtime(), kosullu = false)
    }

    /**
     * Herhangi bir iplikten (saniyelik tik, açılış). Yetki varsa, bekleyen açma yoksa, aktif izin
     * yoksa ve son izin bitişinden de son bağlanmadan (`ACIK` verilişi dahil) da
     * [KAPATMA_BEKLEMESI_MS] geçtiyse kapatır. Yetki yoksa (servis Ayarlar'dan elle açılmış) hiç
     * kapatmaz.
     */
    fun uzlastir(ctx: Context, aktifIzinVar: Boolean) {
        val simdi = SystemClock.elapsedRealtime()
        synchronized(kilit) {
            if (aktifIzinVar) sonAktifMs = simdi
            if (!kapatilabilir(simdi)) return
        }
        val app = uygulama(ctx)
        if (!yetkiVar(app)) return
        kapatIc(app, true, simdi, kosullu = true)
    }

    /** `ErisimServisi.onServiceConnected` (ana iplik): canlı örneği tutar, bekleyenleri `ACIK` çözer. */
    fun servisBaglandi(servis: AccessibilityService) {
        val liste = synchronized(kilit) {
            canli = servis
            kapanisSuruyor = false
            sonBaglanmaMs = SystemClock.elapsedRealtime()
            topla(null, AcmaSonucu.ACIK)
        }
        dagit(liste, AcmaSonucu.ACIK)
    }

    /**
     * `ErisimServisi` gerçek kopuşu (ana iplik): canlı örneği bırakır. Kopuşu bekleyen açma turu
     * varsa ekleme yazımını şimdi başlatır.
     */
    fun servisKoptu() {
        var app: Context? = null
        var buTur = 0L
        synchronized(kilit) {
            canli = null
            kapanisSuruyor = false
            if (kopusBekleniyor && bekleyenler.isNotEmpty()) {
                kopusBekleniyor = false
                app = turBaglami
                buTur = tur
            }
        }
        app?.let { acmaYaz(it, buTur) }
    }

    /** `servisBaglandi` ile kaydedilen canlı servis (yoksa `null`); yan etkisiz, `kilit` altında okunur. */
    fun canliServis(): AccessibilityService? = synchronized(kilit) { canli }

    /** Bekleyen bir açma var mı. */
    fun bekleniyor(): Boolean = synchronized(kilit) { bekleyenler.isNotEmpty() }

    // ---- Ses tuşu kısayolu (ses aç + ses kıs ~3 sn) ----

    /**
     * Ses tuşu kısayolunu `KisayolErisimServisi`'ne bağlar. Kullanıcının önceki kısayol hedefleri
     * (`accessibility_shortcut_target_service`, ':' ile ayrılmış liste) SİLİNMEZ: bizimki yoksa sona
     * eklenir ([KisayolHedefleri.ekle]); birden çok hedef varken Android basışta hangisinin açılacağını
     * sorar. Yalnız bu tek ayar yazılır. `accessibility_shortcut_dialog_shown`'a dokunulmaz: Android'in
     * ilk kullanımda gösterdiği "kısayol neyi açar" onay penceresi bastırılmaz.
     * Kilit ekranı anahtarı (`accessibility_shortcut_on_lock_screen`) yazılmaz. Bu anahtar
     * kilitli korumayı sağlamaz: ölçümde (2026-11-09) 0 iken de kısayol kilitliyken tetiklendi. Kilitliyken
     * açmama koruması `KisayolErisimServisi`'ndedir (`KeyguardManager.isKeyguardLocked`).
     * `ENABLED_ACCESSIBILITY_SERVICES`'a dokunmaz; kısayol servisini sistem açıp kapatır.
     * Herhangi bir iplikten çağrılabilir (bir okuma, en çok bir yazım). Anahtar adı `Settings.Secure`'ın
     * gizli (@hide) alanıdır (AOSP `Settings.java`), bu yüzden dizge olarak yazılır.
     */
    fun sesKisayoluKur(ctx: Context): SesKisayoluSonucu {
        val app = uygulama(ctx)
        if (!yetkiVar(app)) return SesKisayoluSonucu.YETKI_YOK
        return try {
            val cr = app.contentResolver
            val hedef = ComponentName(app, KisayolErisimServisi::class.java).flattenToString()
            val ekleme = KisayolHedefleri.ekle(Settings.Secure.getString(cr, KISAYOL_HEDEF), hedef)
            if (ekleme.degisti) Settings.Secure.putString(cr, KISAYOL_HEDEF, ekleme.yeniDeger)
            if (ekleme.digerHedefler.isEmpty()) {
                SesKisayoluSonucu.KURULDU
            } else {
                SesKisayoluSonucu.KURULDU_DIGERLERIYLE
            }
        } catch (e: SecurityException) {
            SesKisayoluSonucu.HATA
        } catch (e: RuntimeException) {
            SesKisayoluSonucu.HATA
        }
    }

    /**
     * Kısayol hedef ayarı bu uygulamanın `KisayolErisimServisi` bileşenini içeriyor mu (yeni Android
     * sürümlerinde hedef ':' ile ayrılmış liste olabilir; hem uzun hem kısa biçim tanınır).
     */
    fun sesKisayoluKurulu(ctx: Context): Boolean {
        return try {
            val app = uygulama(ctx)
            val biz = ComponentName(app, KisayolErisimServisi::class.java).flattenToString()
            KisayolHedefleri.iceriyor(Settings.Secure.getString(app.contentResolver, KISAYOL_HEDEF), biz)
        } catch (e: RuntimeException) {
            false
        }
    }

    // ---------------------------------------------------------------------------------------------

    private fun uygulama(ctx: Context): Context = ctx.applicationContext ?: ctx

    /** Kilit altında. `disableSelf` kopuşu [ACMA_ZAMAN_ASIMI_MS] içinde getirmediyse kapanış bırakılır. */
    private fun kapanisTakildiysaBirak(simdi: Long) {
        if (kapanisSuruyor && simdi - kapanisBasMs >= ACMA_ZAMAN_ASIMI_MS) kapanisSuruyor = false
    }

    /** Kilit altında. `uzlastir`'ın kapatma koşulu (yetki hariç). */
    private fun kapatilabilir(simdi: Long): Boolean {
        if (bekleyenler.isNotEmpty()) return false
        if (simdi - sonAktifMs < KAPATMA_BEKLEMESI_MS) return false
        if (simdi - sonBaglanmaMs < KAPATMA_BEKLEMESI_MS) return false
        kapanisTakildiysaBirak(simdi)
        return !kapanisSuruyor
    }

    /** Kilit altında. Turun bekleyenlerini boşaltıp döndürür; `buTur` null ise süren tur. */
    private fun topla(buTur: Long?, sonuc: AcmaSonucu): List<(AcmaSonucu) -> Unit>? {
        if (bekleyenler.isEmpty() || (buTur != null && buTur != tur)) return null
        tur++
        kopusBekleniyor = false
        turBaglami = null
        if (sonuc == AcmaSonucu.ACIK) sonBaglanmaMs = SystemClock.elapsedRealtime()
        return ArrayList(bekleyenler).also { bekleyenler.clear() }
    }

    /** Kilit dışında. Her geri çağrı ayrı iletiyle ana iplikte. */
    private fun dagit(liste: List<(AcmaSonucu) -> Unit>?, sonuc: AcmaSonucu) {
        liste?.forEach { cb -> ana.post { cb(sonuc) } }
    }

    private fun acmaYaz(app: Context, buTur: Long) {
        yazici.post {
            val gecerli = synchronized(kilit) {
                tur == buTur && bekleyenler.isNotEmpty() && !kopusBekleniyor
            }
            if (!gecerli) return@post
            try {
                listeyeEkle(app)
            } catch (e: SecurityException) {
                val liste = synchronized(kilit) { topla(buTur, AcmaSonucu.YETKI_YOK) }
                dagit(liste, AcmaSonucu.YETKI_YOK)
            } catch (e: RuntimeException) {
                // Başka ayar hatası: tur zaman aşımıyla düşer, girdi geri alınır.
            }
        }
    }

    /** Ana iplik. Tur hâlâ sürüyorsa `ZAMAN_ASIMI` verir ve girdiyi geri çıkarır. */
    private fun zamanAsimi(app: Context, buTur: Long) {
        val liste = synchronized(kilit) { topla(buTur, AcmaSonucu.ZAMAN_ASIMI) } ?: return
        dagit(liste, AcmaSonucu.ZAMAN_ASIMI)
        yazici.post {
            // Bu arada servis bağlandıysa ya da yeni tur başladıysa dokunma: bağlıyı `uzlastir`
            // kapatır, yeni turun ekleme yazımı zaten bundan sonra sırada.
            val dokunma = synchronized(kilit) { canli != null || bekleyenler.isNotEmpty() }
            if (dokunma || !yetkiVar(app)) return@post
            try {
                listedenCikar(app)
            } catch (e: RuntimeException) {
                // Yetki bu arada gittiyse sessiz.
            }
        }
    }

    private fun kapatIc(app: Context, yetki: Boolean, simdi: Long, kosullu: Boolean) {
        var iptal: List<(AcmaSonucu) -> Unit>? = null
        var servis: AccessibilityService? = null
        synchronized(kilit) {
            if (kosullu && !kapatilabilir(simdi)) return
            iptal = topla(null, AcmaSonucu.ZAMAN_ASIMI)
            val s = canli
            if (s != null && !kapanisSuruyor) {
                kapanisSuruyor = true
                kapanisBasMs = simdi
                servis = s
            }
        }
        dagit(iptal, AcmaSonucu.ZAMAN_ASIMI)
        val hedef = servis
        if (hedef == null && !yetki) return
        yazici.post {
            if (hedef != null) {
                try {
                    hedef.disableSelf()
                } catch (e: RuntimeException) {
                    // Bağlantı zaten ölü: kopuş gelir ya da kapanış takıldı sayılıp bırakılır.
                }
            }
            if (yetki) {
                try {
                    listedenCikar(app)
                } catch (e: RuntimeException) {
                    // Yetki bu arada gittiyse sessiz.
                }
            }
        }
    }

    // ---- Ayar okuma/yazma: yalnız yazıcı ipliği. ----

    private fun bilesen(app: Context): ComponentName =
        ComponentName(app.packageName, ErisimServisi::class.java.name)

    private fun girdiler(cr: ContentResolver): List<String> =
        Settings.Secure.getString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            ?.split(':')
            ?.filter { it.isNotBlank() }
            ?: emptyList()

    /** Hem `flattenToString` hem kısa (`paket/.Sinif`) biçimi tanır. */
    private fun bizimMi(girdi: String, biz: ComponentName): Boolean =
        ComponentName.unflattenFromString(girdi.trim()) == biz

    /** Başka servisleri ve sıralarını korur; kendini iki kez eklemez. */
    private fun listeyeEkle(app: Context) {
        val cr = app.contentResolver
        val biz = bilesen(app)
        val liste = girdiler(cr)
        if (liste.none { bizimMi(it, biz) }) {
            Settings.Secure.putString(
                cr,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
                (liste + biz.flattenToString()).joinToString(":"),
            )
        }
        if (Settings.Secure.getInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 0) != 1) {
            Settings.Secure.putInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
        }
    }

    /** Yalnız kendi bileşenini çıkarır; değişiklik yoksa yazmaz. `ACCESSIBILITY_ENABLED`'a dokunmaz. */
    private fun listedenCikar(app: Context) {
        val cr = app.contentResolver
        val biz = bilesen(app)
        val liste = girdiler(cr)
        val kalan = liste.filterNot { bizimMi(it, biz) }
        if (kalan.size != liste.size) {
            Settings.Secure.putString(
                cr,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
                kalan.joinToString(":"),
            )
        }
    }
}
