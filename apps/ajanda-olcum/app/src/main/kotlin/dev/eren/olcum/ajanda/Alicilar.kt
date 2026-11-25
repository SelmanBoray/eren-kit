package dev.eren.olcum.ajanda

import android.app.job.JobParameters
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import dev.eren.olcum.ajanda.cekirdek.Tur
import java.util.TimeZone

/** Alarm çaldığında: an önce ölçülür, sonra yazılır, sonra pencere ileri kaydırılır. */
class AlarmAlici : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val duvar = System.currentTimeMillis()
        val gecen = SystemClock.elapsedRealtime()
        if (intent.action != Olcum.EYLEM_ALARM || !Durum.calisiyor(ctx)) return
        val soguk = Olcum.surecIlkMi()
        val alan = linkedMapOf(
            "seri" to (intent.getStringExtra("seri") ?: "?"),
            "slot" to "${intent.getIntExtra("slot", -1)}",
            "plan" to "${intent.getLongExtra("plan", 0L)}",
            "soguk" to if (soguk) "1" else "0",
            "surecYasi" to "${gecen - Uygulama.surecBaslangic}",
        )
        alan.putAll(Olcum.anDurumu(ctx))
        Gunluk.yaz(ctx, Tur.CAL, alan, duvar, gecen)
        Olcum.giris(ctx, "alarm")
    }
}

/** Açılış, kapanış, saat ve saat dilimi, paket güncellemesi. */
class SistemAlici : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (!Durum.calisiyor(ctx)) return
        when (val eylem = intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON" -> {
                Gunluk.yaz(ctx, Tur.BOOT, linkedMapOf("eylem" to eylem.substringAfterLast('.')))
                Olcum.olguYaz(ctx, zorla = true)
                Olcum.giris(ctx, "boot", tamZorla = true)
            }
            Intent.ACTION_SHUTDOWN, "android.intent.action.REBOOT" -> {
                Gunluk.yaz(ctx, Tur.KAPANIS, linkedMapOf("eylem" to eylem.substringAfterLast('.')))
            }
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                Gunluk.yaz(ctx, Tur.GUNCELLEME)
                Olcum.giris(ctx, "guncelleme", tamZorla = true)
            }
            Intent.ACTION_TIME_CHANGED -> {
                val duvar = System.currentTimeMillis()
                val gecen = SystemClock.elapsedRealtime()
                val j = Durum.sicrama(ctx, Gunluk.bootSayisi(ctx), duvar - gecen)
                Gunluk.yaz(
                    ctx, Tur.SAAT,
                    linkedMapOf("sicrama" to "${j ?: 0}", "bilinen" to if (j != null) "1" else "0"),
                    duvar, gecen,
                )
                Olcum.giris(ctx, "saat", tamZorla = true)
            }
            Intent.ACTION_TIMEZONE_CHANGED -> {
                // Yalnız ofset yazılır; bölge adı konum ipucu verebileceği için yazılmaz.
                val id = intent.getStringExtra("time-zone") // Intent.EXTRA_TIMEZONE (API 30 sabiti)
                val tz = if (id != null) TimeZone.getTimeZone(id) else TimeZone.getDefault()
                val ofsetDk = tz.getOffset(System.currentTimeMillis()) / 60_000
                Gunluk.yaz(ctx, Tur.DILIM, linkedMapOf("ofsetDk" to "$ofsetDk"))
                Olcum.giris(ctx, "dilim", tamZorla = true)
            }
        }
    }
}

/** Periyodik iş (ileride PC eşitlemesinin taşıyıcısı). Yalnız çalıştığı anı kaydeder. */
class IsServisi : JobService() {
    override fun onStartJob(p: JobParameters): Boolean {
        val duvar = System.currentTimeMillis()
        val gecen = SystemClock.elapsedRealtime()
        if (!Durum.calisiyor(this)) return false
        val alan = linkedMapOf(
            "id" to "${p.jobId}",
            "soguk" to if (Olcum.surecIlkMi()) "1" else "0",
        )
        alan.putAll(Olcum.anDurumu(this))
        Gunluk.yaz(this, Tur.IS, alan, duvar, gecen)
        Olcum.giris(this, "is${p.jobId}")
        Olcum.olguYaz(this, zorla = false)
        return false
    }

    override fun onStopJob(p: JobParameters): Boolean = false
}
