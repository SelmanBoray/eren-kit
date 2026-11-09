package dev.eren.deneme

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock

class CihazServisi : Service() {
    private var baglanti: Baglanti? = null
    private var wl: PowerManager.WakeLock? = null
    private var bildirim: Notification? = null

    override fun onBind(i: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel("olcum", getString(R.string.bildirim_kanali), NotificationManager.IMPORTANCE_LOW)
        )
        val dokunma = PendingIntent.getActivity(
            this, 0, Intent(this, AnaActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        val n = Notification.Builder(this, "olcum")
            .setSmallIcon(R.drawable.ikon)
            .setContentTitle(getString(R.string.bildirim_basligi))
            .setContentText("PC bağlantısı ölçülüyor")
            .setContentIntent(dokunma)
            .setOngoing(true)
            .build()
        bildirim = n
        if (!onPlanaGec(n)) {
            stopSelf()
            return
        }
        Olcum.servisBaslangic = SystemClock.elapsedRealtime()
        Olcum.arttir("servis_sayaci")
        val pm = getSystemService(PowerManager::class.java)
        wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "eren:olcum").apply {
            setReferenceCounted(false)
        }
        Olcum.wakeLockAyarla = { acik -> wakeLock(acik) }
        wakeLock(true)
        baglanti = Baglanti(this).also { it.baslat() }
    }

    private fun onPlanaGec(n: Notification): Boolean = try {
        startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        true
    } catch (e: Exception) {
        // HyperOS ya da Android engellerse süreç ölmesin, neden status'ta okunsun.
        Olcum.olay("start_foreground_hata", "${e.javaClass.simpleName}: ${e.message}")
        false
    }

    private fun wakeLock(acik: Boolean) {
        val w = wl ?: return
        if (acik) w.acquire() else if (w.isHeld) w.release()
        Olcum.wakeLockTutuluyor = w.isHeld
    }

    override fun onStartCommand(i: Intent?, flags: Int, startId: Int): Int {
        Olcum.olay("servis_komut", "${i?.getStringExtra("kaynak") ?: "null_intent(sticky)"} flags=$flags")
        bildirim?.let { onPlanaGec(it) }
        return START_STICKY
    }

    override fun onTaskRemoved(i: Intent?) {
        Olcum.arttir("gorev_kaldirildi_sayaci")
        Olcum.olay("gorev_kaldirildi", "")
        baglanti?.not("task_removed")
        super.onTaskRemoved(i)
    }

    override fun onDestroy() {
        Olcum.olay("servis_destroy", "")
        Olcum.wakeLockAyarla = null
        wakeLock(false)
        Olcum.servisBaslangic = 0L
        baglanti?.durdur()
        super.onDestroy()
    }
}
