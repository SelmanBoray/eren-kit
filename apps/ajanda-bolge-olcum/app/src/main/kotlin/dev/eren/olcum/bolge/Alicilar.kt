package dev.eren.olcum.bolge

import android.app.job.JobParameters
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import dev.eren.olcum.bolge.cekirdek.Gecis
import dev.eren.olcum.bolge.cekirdek.Kayitlar
import dev.eren.olcum.bolge.cekirdek.Kol
import dev.eren.olcum.bolge.cekirdek.Tur

/** goAsync ile en çok ~9 sn bekleyip bitiren yardımcı (Play Hizmetleri görevleri eşzamansız). */
private fun BroadcastReceiver.bekleyerek(is_: (bitti: () -> Unit) -> Unit) {
    val p = goAsync()
    var bitti = false
    val bitir = {
        if (!bitti) {
            bitti = true
            p.finish()
        }
    }
    Handler(Looper.getMainLooper()).postDelayed(bitir, 9_000)
    is_(bitir)
}

/** Kol 1: Play Hizmetleri geofence olayı. */
class GmsAlici : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val duvar = System.currentTimeMillis()
        val gecen = SystemClock.elapsedRealtime()
        if (intent.action != Izleme.EYLEM_GMS || !Durum.calisiyor(ctx)) return
        val ev = GeofencingEvent.fromIntent(intent)
        if (ev == null) {
            Gunluk.yaz(ctx, Tur.GMSHATA, linkedMapOf("kod" to "olay_yok"), duvar, gecen)
        } else if (ev.hasError()) {
            // 1000 = GEOFENCE_NOT_AVAILABLE (ör. konum kapandı); Play Hizmetleri bu durumda geofence'leri siler.
            Gunluk.yaz(ctx, Tur.GMSHATA, linkedMapOf("kod" to "${ev.errorCode}"), duvar, gecen)
            if (ev.errorCode == 1000) Durum.kurDusur(ctx, Kol.GMS, "dusuruldu:1000")
        } else {
            val gecis = when (ev.geofenceTransition) {
                Geofence.GEOFENCE_TRANSITION_ENTER -> Gecis.GIRIS
                Geofence.GEOFENCE_TRANSITION_EXIT -> Gecis.CIKIS
                Geofence.GEOFENCE_TRANSITION_DWELL -> Gecis.BEKLE
                else -> "bilinmeyen_${ev.geofenceTransition}"
            }
            val ornek = ev.triggeringLocation?.let { Algilama.ornek(it, "tetikleyen") }
            for (g in ev.triggeringGeofences.orEmpty()) {
                val id = g.requestId.removePrefix("b").toIntOrNull() ?: continue
                Algilama.isle(ctx, Kol.GMS, gecis, id, ornek, duvar, gecen)
            }
        }
        bekleyerek { bitti -> Izleme.giris(ctx, "gms", bitti) }
    }
}

/** Kol 2: Android çerçevesinin yakınlık uyarısı (Play Hizmetleri yok). Konum olayla gelmez; son bilinen konum eklenir. */
class CerceveAlici : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val duvar = System.currentTimeMillis()
        val gecen = SystemClock.elapsedRealtime()
        if (intent.action != Izleme.EYLEM_CERCEVE || !Durum.calisiyor(ctx)) return
        val id = intent.getIntExtra("bolge", -1)
        val gecis = if (!intent.hasExtra(LocationManager.KEY_PROXIMITY_ENTERING)) "bilinmeyen"
        else if (intent.getBooleanExtra(LocationManager.KEY_PROXIMITY_ENTERING, false)) Gecis.GIRIS else Gecis.CIKIS
        if (id > 0) Algilama.isle(ctx, Kol.CERCEVE, gecis, id, Algilama.sonKonum(ctx), duvar, gecen)
        bekleyerek { bitti -> Izleme.giris(ctx, "cerceve", bitti) }
    }
}

/** Kol 3 (yan işaret): Wi-Fi ağına bağlanma. Ağ adı yalnız tuzlu özetle karşılaştırılır, hiçbir yere yazılmaz. */
class WifiAlici : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val duvar = System.currentTimeMillis()
        val gecen = SystemClock.elapsedRealtime()
        if (intent.action != Izleme.EYLEM_WIFI || !Durum.calisiyor(ctx)) return
        val ag = intent.getParcelableExtra(ConnectivityManager.EXTRA_NETWORK, Network::class.java)
        val tutamac = ag?.networkHandle ?: -1L
        val (onceki, oncekiZaman) = Durum.wifiSon(ctx)
        val tekrar = tutamac != -1L && tutamac == onceki && duvar - oncekiZaman < 6 * 3_600_000L
        if (!tekrar) Durum.wifiSonYaz(ctx, tutamac, duvar)
        val bolgeler = Bolgeler.hepsi(ctx)
        val ssid = simdikiSsid(ctx)
        val alan = Kayitlar.wifiAlanlari(ssid, Durum.tuz(ctx), bolgeler, tekrar)
        alan.putAll(Olgular.anDurumu(ctx))
        Gunluk.yaz(ctx, Tur.WIFI, alan, duvar, gecen)
        val eslesen = alan["eslesen"]?.toIntOrNull() ?: 0
        if (eslesen > 0 && !tekrar) {
            Algilama.isle(ctx, Kol.WIFI, Gecis.GIRIS, eslesen, Algilama.sonKonum(ctx), duvar, gecen)
        }
        bekleyerek { bitti -> Izleme.giris(ctx, "wifi", bitti) }
    }

    companion object {
        /** Bağlı Wi-Fi'nin adı (yalnız bellek içi). Konum izni ve konum açık değilse okunamaz. */
        @Suppress("DEPRECATION")
        fun simdikiSsid(ctx: Context): String? = try {
            Kayitlar.ssidNormal(ctx.getSystemService(WifiManager::class.java).connectionInfo?.ssid)
        } catch (_: Exception) {
            null
        }
    }
}

/** Açılış, kapanış, paket güncellemesi, konumun açılıp kapanması. */
class SistemAlici : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (!Durum.calisiyor(ctx)) return
        when (val eylem = intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON" -> {
                Gunluk.yaz(ctx, Tur.BOOT, linkedMapOf("eylem" to eylem.substringAfterLast('.')))
                Olgular.olguYaz(ctx, zorla = true)
                konumDegisti(ctx, kur = false, kaynak = "boot") {}
                bekleyerek { bitti -> Izleme.giris(ctx, "boot", bitti) }
            }
            Intent.ACTION_SHUTDOWN, "android.intent.action.REBOOT" -> {
                Gunluk.yaz(ctx, Tur.KAPANIS, linkedMapOf("eylem" to eylem.substringAfterLast('.')))
            }
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                Gunluk.yaz(ctx, Tur.GUNCELLEME)
                // Güncellemeden sonra kayıtların kalıp kalmadığı DENETIM'e yazılır, sonra hepsi yeniden kurulur.
                bekleyerek { bitti -> Izleme.girisZorla(ctx, "guncelleme", "guncelleme", bitti) }
            }
            LocationManager.PROVIDERS_CHANGED_ACTION, LocationManager.MODE_CHANGED_ACTION -> {
                bekleyerek { bitti ->
                    if (!konumDegisti(ctx, kur = true, kaynak = "yayin", bitti = bitti)) Izleme.giris(ctx, "konum_yayini", bitti)
                }
            }
        }
    }

    companion object {
        /**
         * Konumun açık/kapalı durumu değiştiyse KONUM yazar; açıldıysa (kur=true) bütün kolları yeniden kurar.
         * @return yeniden kurulum başlatıldıysa true (bitti o zaman kurulum bitince çağrılır), değilse false
         */
        fun konumDegisti(ctx: Context, kur: Boolean, kaynak: String, bitti: () -> Unit): Boolean {
            if (!Durum.calisiyor(ctx)) return false
            val simdi = Olgular.konumAcik(ctx)
            val onceki = Durum.konumEtkin(ctx)
            if (onceki == simdi) return false
            Durum.konumEtkinYaz(ctx, simdi)
            Gunluk.yaz(ctx, Tur.KONUM, linkedMapOf("etkin" to Kayitlar.b(simdi), "ilk" to Kayitlar.b(onceki == null), "kaynak" to kaynak))
            if (simdi && kur && onceki == false) {
                // Soğuk süreçse önce iz denetimi kaydedilir; ardından bütün kollar zorla kurulur.
                Izleme.girisZorla(ctx, "konum_$kaynak", "konum_acildi:$kaynak", bitti)
                return true
            }
            return false
        }
    }
}

/** Bildirimdeki hızlı yanıt düğmeleri. */
class EtiketAlici : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Bildirim.EYLEM_ETIKET) return
        Etiketler.etiketle(
            ctx,
            intent.getIntExtra("bolum", -1),
            intent.getIntExtra("bolge", -1),
            intent.getStringExtra("yon") ?: "?",
            intent.getStringExtra("cevap") ?: "?",
            intent.getIntExtra("dk", 0),
            yol = "bildirim",
        )
        bekleyerek { bitti -> Izleme.giris(ctx, "etiket", bitti) }
    }
}

/** 30 dakikalık denetim işi: pil örneği, olgu değişimi, kolların denetimi. */
class IsServisi : JobService() {
    override fun onStartJob(p: JobParameters): Boolean {
        val duvar = System.currentTimeMillis()
        val gecen = SystemClock.elapsedRealtime()
        if (!Durum.calisiyor(this)) return false
        val alan = linkedMapOf("id" to "${p.jobId}", "soguk" to Kayitlar.b(Izleme.surecIlkMi()))
        alan.putAll(Olgular.anDurumu(this))
        Gunluk.yaz(this, Tur.IS, alan, duvar, gecen)
        Olgular.olguYaz(this, zorla = false)
        val bitti = { jobFinished(p, false) }
        // Konum yayını kaçtıysa (HyperOS kısıtı) konumun açıldığı burada fark edilir.
        if (!SistemAlici.konumDegisti(this, kur = true, kaynak = "is", bitti = bitti)) Izleme.giris(this, "is", bitti)
        return true
    }

    override fun onStopJob(p: JobParameters): Boolean = false
}
