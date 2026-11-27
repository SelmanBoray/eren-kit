package dev.eren.olcum.bolge

import android.Manifest
import android.app.ActivityManager
import android.app.AppOpsManager
import android.app.NotificationManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.Process
import com.google.android.gms.common.GoogleApiAvailability
import dev.eren.olcum.bolge.cekirdek.Kayitlar
import dev.eren.olcum.bolge.cekirdek.Tur
import java.util.concurrent.TimeUnit

/**
 * Ölçümü yorumlamak için cihaz olguları. Kişisel veri yok: cihaz adı, seri no, ANDROID_ID, ağ adı alınmaz.
 * Okunamayan her şey "bilinmiyor(...)" olarak yazılır; varsayım yapılmaz.
 */
object Olgular {
    private fun b(x: Boolean) = Kayitlar.b(x)

    fun izinVar(ctx: Context, izin: String) = ctx.checkSelfPermission(izin) == PackageManager.PERMISSION_GRANTED

    fun kesinKonum(ctx: Context) = izinVar(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
    fun yaklasikKonum(ctx: Context) = izinVar(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)
    fun arkaPlanKonum(ctx: Context) = izinVar(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    fun bildirimIzni(ctx: Context) = izinVar(ctx, Manifest.permission.POST_NOTIFICATIONS)

    fun konumAcik(ctx: Context): Boolean =
        try { ctx.getSystemService(LocationManager::class.java).isLocationEnabled } catch (_: Exception) { false }

    fun pilYuzde(ctx: Context): Int =
        ctx.getSystemService(BatteryManager::class.java).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)

    fun pilMuaf(ctx: Context) = ctx.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(ctx.packageName)

    /** Her algıda ve periyodik işte yazılan hızlı durum. */
    fun anDurumu(ctx: Context): LinkedHashMap<String, String> {
        val pm = ctx.getSystemService(PowerManager::class.java)
        val bm = ctx.getSystemService(BatteryManager::class.java)
        val m = linkedMapOf(
            "ekran" to b(pm.isInteractive),
            "idle" to b(pm.isDeviceIdleMode),
        )
        if (Build.VERSION.SDK_INT >= 33) m["hafif"] = b(pm.isDeviceLightIdleMode)
        m["tasarruf"] = b(pm.isPowerSaveMode)
        m["sarj"] = b(bm.isCharging)
        m["pil"] = "${pilYuzde(ctx)}"
        m["muaf"] = b(pm.isIgnoringBatteryOptimizations(ctx.packageName))
        m["kova"] = "${ctx.getSystemService(UsageStatsManager::class.java).appStandbyBucket}"
        m["konumAcik"] = b(konumAcik(ctx))
        m["arkaPlanIzni"] = b(arkaPlanKonum(ctx))
        return m
    }

    private fun getprop(ad: String): String = try {
        val p = ProcessBuilder("getprop", ad).redirectErrorStream(true).start()
        val s = p.inputStream.bufferedReader().readText().trim()
        p.waitFor(2, TimeUnit.SECONDS)
        s
    } catch (_: Exception) {
        ""
    }

    private fun kovaAdi(k: Int) = when (k) {
        5 -> "muaf(5)"; 10 -> "etkin(10)"; 20 -> "çalışma_kümesi(20)"; 30 -> "sık(30)"
        40 -> "seyrek(40)"; 45 -> "kısıtlı(45)"; 50 -> "hiç(50)"; else -> "$k"
    }

    /**
     * HyperOS/MIUI "otomatik başlatma" izni. Herkese açık API yok; MIUI'nin uygulama işlemi 10008'i
     * gizli checkOpNoThrow ile okunmaya çalışılır. DOĞRULANMADI: Android 16'da gizli API engeli ya da
     * HyperOS'ta farklı kod nedeniyle "bilinmiyor" dönebilir. Kullanıcı beyanı ayrıca kaydedilir.
     */
    fun otomatikBaslatma(ctx: Context): String {
        if (!Build.MANUFACTURER.equals("Xiaomi", ignoreCase = true)) return "xiaomi_degil"
        return try {
            val aom = ctx.getSystemService(AppOpsManager::class.java)
            val m = AppOpsManager::class.java.getMethod(
                "checkOpNoThrow", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, String::class.java,
            )
            when (val r = m.invoke(aom, 10008, Process.myUid(), ctx.packageName) as Int) {
                AppOpsManager.MODE_ALLOWED -> "izinli"
                AppOpsManager.MODE_IGNORED -> "yasak"
                else -> "kod$r"
            }
        } catch (e: Throwable) {
            "bilinmiyor(${e.javaClass.simpleName})"
        }
    }

    fun gmsDurumu(ctx: Context): String = try {
        "${GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(ctx)}"
    } catch (e: Throwable) {
        "hata(${e.javaClass.simpleName})"
    }

    private fun gmsSurumu(ctx: Context): String = try {
        val pi = ctx.packageManager.getPackageInfo("com.google.android.gms", 0)
        "${pi.versionName}"
    } catch (_: Exception) {
        "yok"
    }

    @Suppress("DEPRECATION") // isScanAlwaysAvailable: kapalı alanda konum için Wi-Fi taramasının açık olup olmadığı
    fun olgular(ctx: Context): LinkedHashMap<String, String> {
        val pm = ctx.getSystemService(PowerManager::class.java)
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val acm = ctx.getSystemService(ActivityManager::class.java)
        val lm = ctx.getSystemService(LocationManager::class.java)
        val wm = ctx.getSystemService(WifiManager::class.java)
        fun saglayici(p: String) = try { b(lm.isProviderEnabled(p)) } catch (_: Exception) { "?" }
        return linkedMapOf(
            "android" to Build.VERSION.RELEASE,
            "sdk" to "${Build.VERSION.SDK_INT}",
            "guvenlikYamasi" to Build.VERSION.SECURITY_PATCH,
            "uretici" to Build.MANUFACTURER,
            "marka" to Build.BRAND,
            "model" to Build.MODEL,
            "miui" to getprop("ro.miui.ui.version.name"),
            "hyperos" to getprop("ro.mi.os.version.name"),
            "hyperosSurum" to getprop("ro.mi.os.version.incremental"),
            "hedefSdk" to "${ctx.applicationInfo.targetSdkVersion}",
            "uygulamaSurumu" to (try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "?" } catch (_: Exception) { "?" }),
            "playHizmetleri" to gmsDurumu(ctx),
            "playHizmetleriSurumu" to gmsSurumu(ctx),
            "kesinKonumIzni" to b(kesinKonum(ctx)),
            "yaklasikKonumIzni" to b(yaklasikKonum(ctx)),
            "arkaPlanKonumIzni" to b(arkaPlanKonum(ctx)),
            "bildirimIzni" to b(bildirimIzni(ctx)),
            "bildirimlerAcik" to b(nm.areNotificationsEnabled()),
            "konumAcik" to b(konumAcik(ctx)),
            "gpsSaglayici" to saglayici(LocationManager.GPS_PROVIDER),
            "agSaglayici" to saglayici(LocationManager.NETWORK_PROVIDER),
            "wifiAcik" to (try { b(wm.isWifiEnabled) } catch (_: Exception) { "?" }),
            "wifiTaramaHepAcik" to (try { b(wm.isScanAlwaysAvailable) } catch (_: Exception) { "?" }),
            "pilOptimizasyonuMuaf" to b(pm.isIgnoringBatteryOptimizations(ctx.packageName)),
            "gucTasarrufu" to b(pm.isPowerSaveMode),
            "bekletmeKovasi" to kovaAdi(ctx.getSystemService(UsageStatsManager::class.java).appStandbyBucket),
            "arkaPlanKisitli" to b(acm.isBackgroundRestricted),
            "otomatikBaslatma" to otomatikBaslatma(ctx),
            "beyanOtomatikBaslatma" to b(Durum.beyan(ctx, "otomatikBaslatma")),
            "beyanPilKisitYok" to b(Durum.beyan(ctx, "pilKisitYok")),
            "donem" to "${Durum.donem(ctx)}",
        )
    }

    /** Olgular son yazılandan farklıysa (ya da zorla) OLGU olayı yazar. */
    fun olguYaz(ctx: Context, zorla: Boolean) {
        if (!Durum.calisiyor(ctx)) return
        val m = olgular(ctx)
        val s = m.toString()
        if (!zorla && s == Durum.sonOlgu(ctx)) return
        Gunluk.yaz(ctx, Tur.OLGU, m)
        Durum.sonOlguYaz(ctx, s)
    }

    /** Sistemin kaydettiği süreç çıkışlarından yenilerini yazar. Açıklama metni yazılmaz (ne içerdiği belirsiz). */
    fun cikislariYaz(ctx: Context) {
        if (!Durum.calisiyor(ctx)) return
        val acm = ctx.getSystemService(ActivityManager::class.java)
        val son = Durum.sonCikis(ctx)
        val yeni = try {
            acm.getHistoricalProcessExitReasons(ctx.packageName, 0, 16).filter { it.timestamp > son }.sortedBy { it.timestamp }
        } catch (_: Exception) {
            emptyList()
        }
        for (e in yeni) {
            Gunluk.yaz(
                ctx, Tur.CIKIS,
                linkedMapOf(
                    "zaman" to "${e.timestamp}",
                    "neden" to "${e.reason}",
                    "durum" to "${e.status}",
                    "onem" to "${e.importance}",
                ),
            )
        }
        if (yeni.isNotEmpty()) Durum.sonCikisYaz(ctx, yeni.last().timestamp)
    }
}
