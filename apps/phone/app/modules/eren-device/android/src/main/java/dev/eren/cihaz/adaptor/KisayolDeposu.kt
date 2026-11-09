package dev.eren.cihaz.adaptor

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import dev.eren.cihaz.cekirdek.UygulamaDurumu
import java.security.SecureRandom

/** Kısayoldan gelen dikte metni ve (varsa) o anki ön plan uygulaması. `zamanMs`: duvar saati. */
data class KisayolMesaji(
    val id: String,
    val metin: String,
    val paket: String?,
    val ad: String?,
    val zamanMs: Long,
)

/**
 * Hızlı Ayarlar kutucuğu ya da bildirimden konuşulan mesajın bellekte tek yuvalık bekleme yeri.
 * JS `al` ile çeker, işleyince `tuket` eder. İş parçacığı güvenli.
 */
object KisayolDeposu {
    private const val AD_EN_COK = 80
    private const val SYSTEMUI = "com.android.systemui"

    /**
     * Ön plan sorgusunun kademeli pencereleri (2 dk, 30 dk, 6 sa). Kısa pencerede uygun olay varsa o
     * zaten en son olaydır; uzun (pahalı) sorguya yalnız bulunamazsa geçilir. En uzunu, kullanıcının
     * ekran açıkken tek uygulamada uzun süre kalmasını kapsar.
     */
    private val PENCERELER_MS = longArrayOf(2 * 60_000L, 30 * 60_000L, 6 * 60 * 60_000L)

    /** Kendi geçici kısayol ekranımız; olayları "kullanıcının baktığı uygulama" sayılmaz. */
    private val KISAYOL_SINIFI = KisayolActivity::class.java.name

    private val kilit = Any()
    private val rastgele = SecureRandom()

    @Volatile
    private var yuva: KisayolMesaji? = null

    /**
     * Kısayol ekranı açılmadan hemen önce kullanıcının baktığı uygulamanın paketi.
     *
     * Kullanım olaylarında systemui ile `KisayolActivity` (kendi geçici kısayol ekranımız) olayları
     * atlanır: Android 10+'da sistem bu etkinliği `onCreate`'ten önce RESUMED yapıp olay yazar, alttaki
     * uygulama ise yalnız PAUSED olur. Kalanlar içinde en son `ACTIVITY_RESUMED` (API 29 altı
     * `MOVE_TO_FOREGROUND`) varsayılan başlatıcıya ya da kendi paketimizin başka bir etkinliğine
     * aitse `null` (kullanıcı ana ekranda ya da bu uygulamada); değilse o paket. Bayat uygulamayı bu "en son
     * olay" kuralı engellediği için pencere geniş tutulur (kademeli, en çok 6 sa; bkz.
     * [PENCERELER_MS]). Yetki yoksa, olay bulunamazsa ya da hata olursa `null`.
     */
    fun onPlan(ctx: Context): String? {
        return try {
            val uygulama = ctx.applicationContext
            val usm = uygulama.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
                ?: return null
            val kendi = uygulama.packageName
            val baslatici = baslaticiPaketi(uygulama)
            val hedefTur = if (Build.VERSION.SDK_INT >= 29) {
                UsageEvents.Event.ACTIVITY_RESUMED
            } else {
                @Suppress("DEPRECATION")
                UsageEvents.Event.MOVE_TO_FOREGROUND
            }
            val olay = UsageEvents.Event()
            val simdi = System.currentTimeMillis()
            for (pencere in PENCERELER_MS) {
                val olaylar = usm.queryEvents(simdi - pencere, simdi) ?: return null
                var enSon: String? = null
                var enSonZaman = Long.MIN_VALUE
                while (olaylar.hasNextEvent()) {
                    olaylar.getNextEvent(olay)
                    if (olay.eventType != hedefTur) continue
                    val paket = olay.packageName ?: continue
                    if (paket == SYSTEMUI) continue
                    if (paket == kendi && olay.className == KISAYOL_SINIFI) continue
                    if (olay.timeStamp >= enSonZaman) {
                        enSonZaman = olay.timeStamp
                        enSon = paket
                    }
                }
                // Kısa pencere uzunun son kesitidir: burada bulunan olay genel olarak da en sonudur.
                if (enSon != null) {
                    // Kendi paketimiz ya da başlatıcıysa kullanıcı başka uygulamaya bakmıyor.
                    return if (enSon == kendi || enSon == baslatici) null else enSon
                }
            }
            null
        } catch (_: Exception) {
            null
        }
    }

    /** Mesajı yuvaya koyar (eskisini siler), JS'e haber verir, id döner. */
    fun koy(ctx: Context, metin: String, paket: String?): String {
        val uygulama = ctx.applicationContext
        var temizPaket: String? = null
        var ad: String? = null
        if (paket != null && paketUygun(paket)) {
            temizPaket = paket
            ad = etiket(uygulama, paket)
        }
        val id = yeniId()
        val mesaj = KisayolMesaji(id, metin, temizPaket, ad, System.currentTimeMillis())
        synchronized(kilit) { yuva = mesaj }
        try {
            Adaptor.olaylar?.kisayolGeldi(id)
        } catch (_: Exception) {
            // Olay düşerse JS açılışta `al` ile çeker.
        }
        return id
    }

    fun al(): KisayolMesaji? = synchronized(kilit) { yuva }

    /** Yalnız `id` yuvadakiyle eşleşirse siler (daha yeni bir mesaj ezilmez). */
    fun tuket(id: String) {
        synchronized(kilit) {
            if (yuva?.id == id) yuva = null
        }
    }

    /** Hassas ya da değişmez listedeki (ya da durumu bilinemeyen) paket bağlam olarak verilmez. */
    private fun paketUygun(paket: String): Boolean {
        val listeler = Adaptor.cekirdek?.listeler ?: return false
        return try {
            when (listeler.durum(paket)) {
                UygulamaDurumu.HASSAS, UygulamaDurumu.DEGISMEZ -> false
                else -> true
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun baslaticiPaketi(ctx: Context): String? {
        return try {
            val niyet = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
            ctx.packageManager.resolveActivity(niyet, PackageManager.MATCH_DEFAULT_ONLY)
                ?.activityInfo?.packageName
        } catch (_: Exception) {
            null
        }
    }

    private fun etiket(ctx: Context, paket: String): String? {
        return try {
            val pm = ctx.packageManager
            val ham = pm.getApplicationLabel(pm.getApplicationInfo(paket, 0)).toString()
            val temiz = StringBuilder()
            for (c in ham) {
                if (c.code < 0x20 || c.code in 0x7F..0x9F) continue
                temiz.append(c)
            }
            var s = temiz.toString().trim()
            if (s.length > AD_EN_COK) {
                var son = AD_EN_COK
                // Vekil çiftini ortadan bölme.
                if (Character.isHighSurrogate(s[son - 1])) son--
                s = s.substring(0, son).trim()
            }
            s.ifEmpty { null }
        } catch (_: Exception) {
            null
        }
    }

    private fun yeniId(): String {
        val b = ByteArray(8)
        rastgele.nextBytes(b)
        return b.joinToString("") { "%02x".format(it) }
    }
}
