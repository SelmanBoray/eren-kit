package dev.eren.deneme

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.ActivityManager
import android.app.AppOpsManager
import android.app.ApplicationExitInfo
import android.app.KeyguardManager
import android.app.NotificationManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.view.accessibility.AccessibilityManager
import org.json.JSONArray
import org.json.JSONObject

/** `status` komutu: ölüm nedenleri ve kısıt durumu burada okunur. */
object Durum {
    private val CIKIS = mapOf(
        ApplicationExitInfo.REASON_ANR to "ANR",
        ApplicationExitInfo.REASON_CRASH to "CRASH",
        ApplicationExitInfo.REASON_CRASH_NATIVE to "CRASH_NATIVE",
        ApplicationExitInfo.REASON_DEPENDENCY_DIED to "DEPENDENCY_DIED",
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE to "EXCESSIVE_RESOURCE_USAGE",
        ApplicationExitInfo.REASON_EXIT_SELF to "EXIT_SELF",
        ApplicationExitInfo.REASON_FREEZER to "FREEZER",
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE to "INITIALIZATION_FAILURE",
        ApplicationExitInfo.REASON_LOW_MEMORY to "LOW_MEMORY",
        ApplicationExitInfo.REASON_OTHER to "OTHER",
        ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE to "PACKAGE_STATE_CHANGE",
        ApplicationExitInfo.REASON_PACKAGE_UPDATED to "PACKAGE_UPDATED",
        ApplicationExitInfo.REASON_PERMISSION_CHANGE to "PERMISSION_CHANGE",
        ApplicationExitInfo.REASON_SIGNALED to "SIGNALED",
        ApplicationExitInfo.REASON_UNKNOWN to "UNKNOWN",
        ApplicationExitInfo.REASON_USER_REQUESTED to "USER_REQUESTED",
        ApplicationExitInfo.REASON_USER_STOPPED to "USER_STOPPED",
    )

    fun a11yAcik(c: Context): Boolean {
        val am = c.getSystemService(AccessibilityManager::class.java)
        return am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
            .any { it.resolveInfo.serviceInfo.packageName == c.packageName }
    }

    fun agKisa(cm: ConnectivityManager): String {
        val nc = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "yok"
        val t = ArrayList<String>()
        if (nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) t.add("wifi")
        if (nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) t.add("hucresel")
        if (nc.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) t.add("vpn")
        return t.joinToString("+").ifEmpty { "diger" }
    }

    private fun ureticiAutostartOp(c: Context): Any {
        // Üreticiye özel gizli op; okunamazsa "okunamadi" döner, varsayım yapılmaz.
        return try {
            val aom = c.getSystemService(AppOpsManager::class.java)
            val m = AppOpsManager::class.java.getMethod(
                "checkOpNoThrow",
                Int::class.javaPrimitiveType,
                Int::class.javaPrimitiveType,
                String::class.java
            )
            m.invoke(aom, 10008, Process.myUid(), c.packageName) as Int
        } catch (e: Exception) {
            "okunamadi:${e.javaClass.simpleName}"
        }
    }

    fun rapor(c: Context): JSONObject {
        val pm = c.getSystemService(PowerManager::class.java)
        val am = c.getSystemService(ActivityManager::class.java)
        val cm = c.getSystemService(ConnectivityManager::class.java)
        val bm = c.getSystemService(BatteryManager::class.java)
        val us = c.getSystemService(UsageStatsManager::class.java)
        val km = c.getSystemService(KeyguardManager::class.java)
        val nm = c.getSystemService(NotificationManager::class.java)
        val simdi = SystemClock.elapsedRealtime()

        val cikislar = JSONArray()
        runCatching {
            am.getHistoricalProcessExitReasons(c.packageName, 0, 6).forEach {
                cikislar.put(
                    JSONObject()
                        .put("ts", it.timestamp)
                        .put("neden", CIKIS[it.reason] ?: it.reason.toString())
                        .put("onem", it.importance)
                        .put("aciklama", it.description ?: JSONObject.NULL)
                )
            }
        }
        val kurulum = JSONObject()
        runCatching {
            val i = c.packageManager.getInstallSourceInfo(c.packageName)
            kurulum.put("kuran", i.installingPackageName ?: JSONObject.NULL)
                .put("baslatan", i.initiatingPackageName ?: JSONObject.NULL)
                .put("kaynak_kodu", i.packageSource)
        }

        return JSONObject()
            .put("surec_yasi_ms", simdi - Olcum.surecBaslangic)
            .put("servis_yasi_ms", if (Olcum.servisBaslangic > 0) simdi - Olcum.servisBaslangic else JSONObject.NULL)
            .put("cihaz_acik_ms", simdi)
            .put("uyku_ms", simdi - SystemClock.uptimeMillis())
            .put("surec_baglantisi", Olcum.surecBaglantisi)
            .put("toplam_baglanti", Olcum.sayi("toplam_baglanti"))
            .put("baglanti_denemesi", Olcum.sayi("baglanti_denemesi"))
            .put("surec_sayaci", Olcum.sayi("surec_sayaci"))
            .put("servis_sayaci", Olcum.sayi("servis_sayaci"))
            .put("erisim_baglandi_sayaci", Olcum.sayi("erisim_baglandi_sayaci"))
            .put("gorev_kaldirildi_sayaci", Olcum.sayi("gorev_kaldirildi_sayaci"))
            .put("boot_alici_sayaci", Olcum.sayi("boot_alici_sayaci"))
            .put(
                "olaylar", JSONObject().also { o ->
                    listOf(
                        "son_kopma", "son_baglanti_hatasi", "servis_baslat_son", "servis_baslat_hata",
                        "start_foreground_hata", "servis_komut", "servis_destroy", "gorev_kaldirildi",
                        "boot_alici", "erisim_baglandi", "erisim_koptu", "ag_kayip", "gonderim_red"
                    ).forEach { k -> o.put(k, Olcum.oku(k) ?: JSONObject.NULL) }
                }
            )
            .put("a11y_ayarda_acik", a11yAcik(c))
            .put("a11y_servis_bagli", Olcum.erisim != null)
            .put("bildirim_acik", nm.areNotificationsEnabled())
            .put("wake_lock", Olcum.wakeLockTutuluyor)
            .put(
                "pil", JSONObject()
                    .put("yuzde", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
                    .put("sarj", bm.isCharging)
            )
            .put(
                "kisit", JSONObject()
                    .put("pil_optimizasyonu_muaf", pm.isIgnoringBatteryOptimizations(c.packageName))
                    .put("guc_tasarrufu", pm.isPowerSaveMode)
                    .put("doze", pm.isDeviceIdleMode)
                    .put("ekran_acik", pm.isInteractive)
                    .put("kilitli", km.isKeyguardLocked)
                    .put("arka_plan_kisitli", am.isBackgroundRestricted)
                    .put("standby_bucket", us.appStandbyBucket)
                    .put("veri_kisiti", cm.restrictBackgroundStatus)
                    .put("uretici_autostart_op", ureticiAutostartOp(c))
            )
            .put("ag", agKisa(cm))
            .put("kurulum", kurulum)
            .put("cikis_nedenleri", cikislar)
    }
}
