package dev.eren.olcum.ajanda

import android.Manifest
import android.app.ActivityManager
import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import dev.eren.olcum.ajanda.cekirdek.Plan
import dev.eren.olcum.ajanda.cekirdek.Tur
import java.util.concurrent.TimeUnit

/**
 * Ölçümün Android tarafı: alarmları kurar, süreç girişlerini izler, işleri kaydeder,
 * cihaz olgularını toplar. Bütün giriş noktaları (alıcılar, iş, ekran) ana iş parçacığında çalışır.
 */
object Olcum {
    const val EYLEM_ALARM = "dev.eren.olcum.ajanda.ALARM"

    /** Önden kurulan alarm penceresi; her girişte ileri kaydırılır. */
    private const val PENCERE = 24 * Plan.SAAT

    const val IS_KISITSIZ = 1
    const val IS_AGLI = 2

    private var surecIlkGiris = true

    /** Bu süreçte henüz hiçbir giriş noktası çalışmadıysa true (soğuk başlatma). */
    @Synchronized
    fun surecIlkMi() = surecIlkGiris

    // ---------------------------------------------------------------- başlat / durdur

    fun baslat(ctx: Context) {
        val plan = Plan.varsayilan(System.currentTimeMillis())
        Durum.baslat(ctx, plan)
        Durum.sonCikisYaz(ctx, System.currentTimeMillis())
        Gunluk.yaz(ctx, Tur.BASLA, plan.alanlar())
        olguYaz(ctx, zorla = true)
        synchronized(this) { surecIlkGiris = false }
        isleriDenetle(ctx, kaydet = false)
        kur(ctx, tam = true, kaynak = "basla")
    }

    fun durdur(ctx: Context) {
        val plan = Durum.plan(ctx)
        val am = ctx.getSystemService(AlarmManager::class.java)
        if (plan != null) {
            val simdi = System.currentTimeMillis()
            for (s in plan.seriler) {
                for (k in plan.ilkSonraki(s, simdi)..Durum.kurulanSon(ctx, s.kod)) {
                    val pi = niyet(ctx, s.kod, k, plan.zaman(s, k), PendingIntent.FLAG_NO_CREATE) ?: continue
                    am.cancel(pi)
                    pi.cancel()
                }
            }
        }
        val js = ctx.getSystemService(JobScheduler::class.java)
        js.cancel(IS_KISITSIZ)
        js.cancel(IS_AGLI)
        Gunluk.yaz(ctx, Tur.DUR)
        Durum.durdur(ctx)
    }

    // ---------------------------------------------------------------- giriş noktaları

    /**
     * Her giriş noktası çağırır. Süreçteki ilk girişte (soğuk) alarm niyetlerinin ve işlerin
     * sistemde hâlâ durup durmadığını kaydeder, sonra bütün pencereyi yeniden kurar.
     * @return bu giriş süreç için ilk miydi
     */
    fun giris(ctx: Context, kaynak: String, tamZorla: Boolean = false): Boolean {
        val soguk: Boolean
        synchronized(this) {
            soguk = surecIlkGiris
            surecIlkGiris = false
        }
        if (!Durum.calisiyor(ctx)) return soguk
        if (soguk) {
            niyetleriDenetle(ctx)
            isleriDenetle(ctx, kaydet = true)
        }
        kur(ctx, tam = soguk || tamZorla, kaynak = if (soguk) "surec:$kaynak" else kaynak)
        return soguk
    }

    // ---------------------------------------------------------------- alarmlar

    private fun istekKodu(seri: String, k: Int) = (if (seri == Plan.KESIN) 1_000_000 else 2_000_000) + k

    private fun niyet(ctx: Context, seri: String, k: Int, plan: Long, bayrak: Int): PendingIntent? {
        val i = Intent(ctx, AlarmAlici::class.java)
            .setAction(EYLEM_ALARM)
            .putExtra("seri", seri)
            .putExtra("slot", k)
            .putExtra("plan", plan)
        return PendingIntent.getBroadcast(ctx, istekKodu(seri, k), i, bayrak or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun kesinOlur(am: AlarmManager) =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()

    /** tam=true: gelecekteki bütün pencereyi yeniden kurar; değilse yalnız yeni slotları ekler. */
    fun kur(ctx: Context, tam: Boolean, kaynak: String) {
        if (!Durum.calisiyor(ctx)) return
        val plan = Durum.plan(ctx) ?: return
        val am = ctx.getSystemService(AlarmManager::class.java)
        val simdi = System.currentTimeMillis()
        val kesin = kesinOlur(am)
        for (s in plan.seriler) {
            val gelecek = plan.ilkSonraki(s, simdi)
            val ilk = if (tam) gelecek else maxOf(gelecek, Durum.kurulanSon(ctx, s.kod) + 1)
            val son = minOf(plan.sonOnceki(s, simdi + PENCERE), plan.sonSlot(s))
            if (ilk > son) continue
            var hata = 0
            for (k in ilk..son) {
                val t = plan.zaman(s, k)
                val pi = niyet(ctx, s.kod, k, t, PendingIntent.FLAG_UPDATE_CURRENT)!!
                try {
                    if (s.kod == Plan.CALAR) {
                        val goster = PendingIntent.getActivity(
                            ctx, 0, Intent(ctx, AnaEkran::class.java), PendingIntent.FLAG_IMMUTABLE,
                        )
                        am.setAlarmClock(AlarmManager.AlarmClockInfo(t, goster), pi)
                    } else if (kesin) {
                        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi)
                    } else {
                        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi)
                    }
                } catch (_: SecurityException) {
                    hata++
                }
            }
            Durum.kurulanSonYaz(ctx, s.kod, son)
            Gunluk.yaz(
                ctx, Tur.KUR,
                linkedMapOf(
                    "seri" to s.kod, "ilk" to "$ilk", "son" to "$son", "kaynak" to kaynak,
                    "tam" to b(tam), "kesin" to b(kesin), "hata" to "$hata",
                ),
            )
        }
    }

    /** Sıradaki (kurulmuş olması gereken) alarmın niyeti sistemde hâlâ var mı? */
    private fun niyetleriDenetle(ctx: Context) {
        val plan = Durum.plan(ctx) ?: return
        val simdi = System.currentTimeMillis()
        for (s in plan.seriler) {
            val k = plan.ilkSonraki(s, simdi)
            if (k > Durum.kurulanSon(ctx, s.kod) || k > plan.sonSlot(s)) continue
            val var_ = niyet(ctx, s.kod, k, plan.zaman(s, k), PendingIntent.FLAG_NO_CREATE) != null
            Gunluk.yaz(ctx, Tur.PI, linkedMapOf("seri" to s.kod, "slot" to "$k", "var" to b(var_)))
        }
    }

    // ---------------------------------------------------------------- periyodik işler

    /** İşler sistemde kayıtlı mı (kaydet=true ise günlüğe yaz); eksikse yeniden kaydet. */
    fun isleriDenetle(ctx: Context, kaydet: Boolean) {
        val js = ctx.getSystemService(JobScheduler::class.java)
        for (id in listOf(IS_KISITSIZ, IS_AGLI)) {
            val var_ = js.getPendingJob(id) != null
            if (kaydet) Gunluk.yaz(ctx, Tur.ISVAR, linkedMapOf("id" to "$id", "var" to b(var_)))
            if (var_) continue
            val b = JobInfo.Builder(id, ComponentName(ctx, IsServisi::class.java))
                .setPeriodic(TimeUnit.MINUTES.toMillis(15))
                .setPersisted(true)
            if (id == IS_AGLI) b.setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            js.schedule(b.build())
        }
    }

    // ---------------------------------------------------------------- olgular

    private fun b(x: Boolean) = if (x) "1" else "0"

    /** Çalma anındaki hızlı durum (her alarm ve işte yazılır). */
    fun anDurumu(ctx: Context): Map<String, String> {
        val pm = ctx.getSystemService(PowerManager::class.java)
        val bm = ctx.getSystemService(BatteryManager::class.java)
        val m = linkedMapOf(
            "ekran" to b(pm.isInteractive),
            "idle" to b(pm.isDeviceIdleMode),
        )
        if (Build.VERSION.SDK_INT >= 33) m["hafif"] = b(pm.isDeviceLightIdleMode)
        m["tasarruf"] = b(pm.isPowerSaveMode)
        m["sarj"] = b(bm.isCharging)
        m["muaf"] = b(pm.isIgnoringBatteryOptimizations(ctx.packageName))
        if (Build.VERSION.SDK_INT >= 28) {
            m["kova"] = "${ctx.getSystemService(UsageStatsManager::class.java).appStandbyBucket}"
        }
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

    /** Ölçümü yorumlamak için cihaz olguları. Kişisel veri yok: cihazın kullanıcı verdiği adı alınmaz. */
    fun olgular(ctx: Context): Map<String, String> {
        val pm = ctx.getSystemService(PowerManager::class.java)
        val am = ctx.getSystemService(AlarmManager::class.java)
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val acm = ctx.getSystemService(ActivityManager::class.java)
        val m = linkedMapOf(
            "android" to Build.VERSION.RELEASE,
            "sdk" to "${Build.VERSION.SDK_INT}",
            "guvenlikYamasi" to Build.VERSION.SECURITY_PATCH,
            "uretici" to Build.MANUFACTURER,
            "marka" to Build.BRAND,
            "model" to Build.MODEL,
            "miui" to getprop("ro.miui.ui.version.name"),
            "hyperos" to getprop("ro.mi.os.version.name"),
            "hedefSdk" to "${ctx.applicationInfo.targetSdkVersion}",
            "kesinAlarmIzni" to if (Build.VERSION.SDK_INT >= 31) b(am.canScheduleExactAlarms()) else "gerekmez",
            "pilOptimizasyonuMuaf" to b(pm.isIgnoringBatteryOptimizations(ctx.packageName)),
            "gucTasarrufu" to b(pm.isPowerSaveMode),
            "bildirimlerAcik" to b(nm.areNotificationsEnabled()),
            "bildirimIzni" to if (Build.VERSION.SDK_INT >= 33) {
                b(ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            } else "gerekmez",
        )
        if (Build.VERSION.SDK_INT >= 28) {
            m["bekletmeKovasi"] = kovaAdi(ctx.getSystemService(UsageStatsManager::class.java).appStandbyBucket)
            m["arkaPlanKisitli"] = b(acm.isBackgroundRestricted)
        }
        return m
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

    /** Sistemin kaydettiği süreç çıkışlarından yenilerini yazar (Android 11+). */
    fun cikislariYaz(ctx: Context) {
        if (Build.VERSION.SDK_INT < 30 || !Durum.calisiyor(ctx)) return
        val acm = ctx.getSystemService(ActivityManager::class.java)
        val son = Durum.sonCikis(ctx)
        val yeni = try {
            acm.getHistoricalProcessExitReasons(ctx.packageName, 0, 16)
                .filter { it.timestamp > son }
                .sortedBy { it.timestamp }
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
                    "aciklama" to (e.description ?: "").take(80),
                ),
            )
        }
        if (yeni.isNotEmpty()) Durum.sonCikisYaz(ctx, yeni.last().timestamp)
    }

    fun gecen() = SystemClock.elapsedRealtime()
}
