package dev.eren.olcum.bolge

import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.Looper
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import dev.eren.olcum.bolge.cekirdek.Kayitlar
import dev.eren.olcum.bolge.cekirdek.Kol
import dev.eren.olcum.bolge.cekirdek.Sabit
import dev.eren.olcum.bolge.cekirdek.Tur
import java.util.concurrent.TimeUnit

/**
 * Üç algılama kolunu kurar, söker ve denetler:
 *  - gms: Play Hizmetleri geofence (giriş, çıkış, bekleme), tek PendingIntent.
 *  - cerceve: LocationManager.addProximityAlert, bölge başına PendingIntent (Play Hizmetleri kullanmaz).
 *  - wifi: ConnectivityManager.registerNetworkCallback(PendingIntent), Wi-Fi bağlantısı.
 * Hepsi sistemde PendingIntent ile durur; süreç ölse de sistem uygulamayı uyandırır (kısıtlanmadıkça).
 * Bütün çağrılar ana iş parçacığından yapılır.
 */
object Izleme {
    const val EYLEM_GMS = "dev.eren.olcum.bolge.GMS"
    const val EYLEM_CERCEVE = "dev.eren.olcum.bolge.CERCEVE"
    const val EYLEM_WIFI = "dev.eren.olcum.bolge.WIFI"
    const val IS_DENETIM = 1
    private const val ISTEK_GMS = 1
    private const val ISTEK_WIFI = 2
    private const val ISTEK_CERCEVE = 1000

    private val ana = Handler(Looper.getMainLooper())
    private val kuruluyor = HashSet<String>()
    private var surecIlk = true

    @Synchronized
    fun surecIlkMi() = surecIlk

    // ------------------------------------------------------------ PendingIntent'ler (konum servisleri doldurur: değişebilir olmalı)

    fun gmsNiyeti(ctx: Context, bayrak: Int): PendingIntent? =
        PendingIntent.getBroadcast(
            ctx, ISTEK_GMS, Intent(ctx, GmsAlici::class.java).setAction(EYLEM_GMS), bayrak or PendingIntent.FLAG_MUTABLE,
        )

    fun cerceveNiyeti(ctx: Context, bolge: Int, bayrak: Int): PendingIntent? =
        PendingIntent.getBroadcast(
            ctx, ISTEK_CERCEVE + bolge,
            Intent(ctx, CerceveAlici::class.java).setAction(EYLEM_CERCEVE).putExtra("bolge", bolge),
            bayrak or PendingIntent.FLAG_MUTABLE,
        )

    fun wifiNiyeti(ctx: Context, bayrak: Int): PendingIntent? =
        PendingIntent.getBroadcast(
            ctx, ISTEK_WIFI, Intent(ctx, WifiAlici::class.java).setAction(EYLEM_WIFI), bayrak or PendingIntent.FLAG_MUTABLE,
        )

    private fun izVar(ctx: Context, kol: String): Boolean = when (kol) {
        Kol.GMS -> gmsNiyeti(ctx, PendingIntent.FLAG_NO_CREATE) != null
        Kol.CERCEVE -> Bolgeler.hepsi(ctx).all { cerceveNiyeti(ctx, it.id, PendingIntent.FLAG_NO_CREATE) != null }
        else -> wifiNiyeti(ctx, PendingIntent.FLAG_NO_CREATE) != null
    }

    // ------------------------------------------------------------ giriş noktaları

    /**
     * Her giriş noktası (alıcılar, iş, ekranlar) çağırır. Süreçteki ilk girişte (soğuk) kolların sistemde
     * hâlâ izi olup olmadığını günlüğe yazar ve eksik/eskimiş olanları yeniden kurar.
     * PendingIntent izi yalnız soğuk girişte anlamlıdır (sıcak süreçte kendi nesnelerimiz izi canlı tutar).
     */
    private fun ilkAl(): Boolean = synchronized(this) {
        val s = surecIlk
        surecIlk = false
        s
    }

    fun giris(ctx: Context, kaynak: String, bitti: () -> Unit = {}): Boolean {
        val soguk = ilkAl()
        if (!Durum.calisiyor(ctx)) {
            bitti()
            return soguk
        }
        if (soguk) Olgular.cikislariYaz(ctx)
        denetle(ctx, if (soguk) "soguk:$kaynak" else kaynak, kaydet = soguk, bitti = bitti)
        return soguk
    }

    /** Soğuksa izleri kaydeder, sonra (denetimin yeniden kurmasını beklemeden) bütün kolları bir kez zorla kurar. */
    fun girisZorla(ctx: Context, kaynak: String, neden: String, bitti: () -> Unit = {}) {
        val soguk = ilkAl()
        if (!Durum.calisiyor(ctx)) {
            bitti()
            return
        }
        if (soguk) {
            Olgular.cikislariYaz(ctx)
            izleriYaz(ctx, "soguk:$kaynak")
        }
        kurHepsi(ctx, neden, bitti)
    }

    private data class Iz(val kol: String, val iz: Boolean, val bootDegisti: Boolean, val sonuc: String)

    private fun izler(ctx: Context): List<Iz> {
        val boot = Gunluk.bootSayisi(ctx)
        return Kol.HEPSI.map { Iz(it, izVar(ctx, it), Durum.kurBoot(ctx, it) != boot, Durum.kurSonuc(ctx, it)) }
    }

    private fun izleriYaz(ctx: Context, neden: String, l: List<Iz> = izler(ctx)) {
        for (z in l) Gunluk.yaz(
            ctx, Tur.DENETIM,
            linkedMapOf("kol" to z.kol, "piVar" to Kayitlar.b(z.iz), "bootDegisti" to Kayitlar.b(z.bootDegisti), "sonuc" to z.sonuc, "neden" to neden),
        )
    }

    /** Kolları denetler; açılış değiştiyse, (soğuk girişte) iz yoksa ya da son kurulum başarısızsa yeniden kurar. */
    fun denetle(ctx: Context, neden: String, kaydet: Boolean, bitti: () -> Unit = {}) {
        if (!Durum.calisiyor(ctx)) {
            bitti()
            return
        }
        val simdi = System.currentTimeMillis()
        val l = izler(ctx)
        if (kaydet) izleriYaz(ctx, neden, l)
        val gerek = ArrayList<String>()
        for (z in l) {
            val yakinHata = z.sonuc.startsWith("hata") && !z.bootDegisti && simdi - Durum.kurZaman(ctx, z.kol) < 15 * Sabit.DK
            val lazim = z.bootDegisti || z.sonuc != "ok" || (kaydet && !z.iz)
            if (lazim && !yakinHata && z.kol !in kuruluyor) gerek += z.kol
        }
        if (gerek.isEmpty()) bitti() else kur(ctx, gerek, neden, bitti)
    }

    /** Bütün kolları zorla yeniden kurar (başlatma, bölge değişimi, konum açıldı, izin verildi). */
    fun kurHepsi(ctx: Context, neden: String, bitti: () -> Unit = {}) {
        if (!Durum.calisiyor(ctx)) {
            bitti()
            return
        }
        kur(ctx, Kol.HEPSI.filter { it !in kuruluyor }, neden, bitti)
    }

    // ------------------------------------------------------------ kurulum

    private fun kurKaydi(ctx: Context, kol: String, neden: String, sonuc: String, hata: String?, n: Int) {
        val boot = Gunluk.bootSayisi(ctx)
        val simdi = System.currentTimeMillis()
        Durum.kurYaz(ctx, kol, if (sonuc == "ok") "ok" else "hata:${hata ?: "?"}", boot, simdi, neden)
        val m = linkedMapOf("kol" to kol, "neden" to neden, "sonuc" to sonuc, "n" to "$n")
        if (hata != null) m["hata"] = hata
        m["arkaPlanIzni"] = Kayitlar.b(Olgular.arkaPlanKonum(ctx))
        m["konumAcik"] = Kayitlar.b(Olgular.konumAcik(ctx))
        Gunluk.yaz(ctx, Tur.KUR, m, simdi)
    }

    private fun kur(ctx: Context, kollar: List<String>, neden: String, bitti: () -> Unit) {
        val bolgeler = Bolgeler.hepsi(ctx)
        isiKur(ctx)
        if (Kol.CERCEVE in kollar) cerceveKur(ctx, neden)
        if (Kol.WIFI in kollar) wifiKur(ctx, neden, bolgeler.size)
        if (Kol.GMS in kollar) gmsKur(ctx, neden, bitti) else bitti()
    }

    private fun gmsKur(ctx: Context, neden: String, bitti: () -> Unit) {
        val bolgeler = Bolgeler.hepsi(ctx)
        if (!Olgular.kesinKonum(ctx)) {
            kurKaydi(ctx, Kol.GMS, neden, "hata", "kesin_konum_izni_yok", bolgeler.size); bitti(); return
        }
        val durum = try { GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(ctx) } catch (_: Throwable) { -1 }
        if (durum != ConnectionResult.SUCCESS) {
            kurKaydi(ctx, Kol.GMS, neden, "hata", "play_hizmetleri_$durum", bolgeler.size); bitti(); return
        }
        val pi = gmsNiyeti(ctx, PendingIntent.FLAG_UPDATE_CURRENT)!!
        val istemci = LocationServices.getGeofencingClient(ctx)
        synchronized(this) { kuruluyor += Kol.GMS }
        var bitmis = false
        fun son(sonuc: String, hata: String?) {
            if (bitmis) return
            bitmis = true
            synchronized(this) { kuruluyor -= Kol.GMS }
            kurKaydi(ctx, Kol.GMS, neden, sonuc, hata, bolgeler.size)
            bitti()
        }
        // Play Hizmetleri yanıt vermezse alıcı sonsuza dek beklemesin.
        ana.postDelayed({ son("hata", "zaman_asimi") }, 8_000)
        istemci.removeGeofences(pi).addOnCompleteListener {
            if (bolgeler.isEmpty()) {
                son("ok", null)
                return@addOnCompleteListener
            }
            val l = bolgeler.map { b ->
                Geofence.Builder()
                    .setRequestId("b${b.id}")
                    .setCircularRegion(b.enlem, b.boylam, b.yaricap.toFloat())
                    .setExpirationDuration(Geofence.NEVER_EXPIRE)
                    .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT or Geofence.GEOFENCE_TRANSITION_DWELL)
                    .setLoiteringDelay(Sabit.BEKLEME.toInt())
                    .build()
            }
            // İçerideyken kurulunca hemen ENTER gelir: analiz bunu "kurulum tetiği" olarak ayırır.
            val istek = GeofencingRequest.Builder()
                .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
                .addGeofences(l)
                .build()
            try {
                istemci.addGeofences(istek, pi)
                    .addOnSuccessListener { son("ok", null) }
                    .addOnFailureListener { e -> son("hata", if (e is ApiException) "kod_${e.statusCode}" else e.javaClass.simpleName) }
            } catch (e: SecurityException) {
                son("hata", "SecurityException")
            }
        }
    }

    private fun cerceveKur(ctx: Context, neden: String) {
        val bolgeler = Bolgeler.hepsi(ctx)
        if (!Olgular.kesinKonum(ctx)) {
            kurKaydi(ctx, Kol.CERCEVE, neden, "hata", "kesin_konum_izni_yok", bolgeler.size); return
        }
        val lm = ctx.getSystemService(LocationManager::class.java)
        var hata: String? = null
        for (b in bolgeler) {
            val pi = cerceveNiyeti(ctx, b.id, PendingIntent.FLAG_UPDATE_CURRENT)!!
            try {
                lm.removeProximityAlert(pi)
                // expiration -1: süresiz.
                lm.addProximityAlert(b.enlem, b.boylam, b.yaricap.toFloat(), -1L, pi)
            } catch (e: Exception) {
                hata = e.javaClass.simpleName
            }
        }
        kurKaydi(ctx, Kol.CERCEVE, neden, if (hata == null) "ok" else "hata", hata, bolgeler.size)
    }

    private fun wifiKur(ctx: Context, neden: String, n: Int) {
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        val pi = wifiNiyeti(ctx, PendingIntent.FLAG_UPDATE_CURRENT)!!
        try { cm.releaseNetworkRequest(pi) } catch (_: Exception) {}
        try {
            val istek = NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build()
            cm.registerNetworkCallback(istek, pi)
            kurKaydi(ctx, Kol.WIFI, neden, "ok", null, n)
        } catch (e: Exception) {
            kurKaydi(ctx, Kol.WIFI, neden, "hata", e.javaClass.simpleName, n)
        }
    }

    /** 30 dakikalık kalıcı denetim işi (pil örneği + kolların denetimi). İkinci bir canlanma yolu olarak da ölçülür. */
    private fun isiKur(ctx: Context) {
        val js = ctx.getSystemService(JobScheduler::class.java)
        if (js.getPendingJob(IS_DENETIM) != null) return
        val i = JobInfo.Builder(IS_DENETIM, ComponentName(ctx, IsServisi::class.java))
            .setPeriodic(TimeUnit.MINUTES.toMillis(30))
            .setPersisted(true)
            .build()
        try { js.schedule(i) } catch (_: Exception) {}
    }

    // ------------------------------------------------------------ sökme

    fun bolgeKaldir(ctx: Context, id: Int) {
        val pi = cerceveNiyeti(ctx, id, PendingIntent.FLAG_NO_CREATE) ?: return
        try { ctx.getSystemService(LocationManager::class.java).removeProximityAlert(pi) } catch (_: Exception) {}
        pi.cancel()
    }

    fun kaldirHepsi(ctx: Context) {
        gmsNiyeti(ctx, PendingIntent.FLAG_NO_CREATE)?.let { pi ->
            try { LocationServices.getGeofencingClient(ctx).removeGeofences(pi) } catch (_: Exception) {}
        }
        for (b in Bolgeler.hepsi(ctx)) bolgeKaldir(ctx, b.id)
        wifiNiyeti(ctx, PendingIntent.FLAG_NO_CREATE)?.let { pi ->
            try { ctx.getSystemService(ConnectivityManager::class.java).releaseNetworkRequest(pi) } catch (_: Exception) {}
            pi.cancel()
        }
        ctx.getSystemService(JobScheduler::class.java).cancel(IS_DENETIM)
        Durum.kurSifirla(ctx, Kol.HEPSI)
    }

    // ------------------------------------------------------------ ekran için durum

    data class KolDurumu(val kol: String, val etkin: Boolean, val aciklama: String)

    fun durumlar(ctx: Context): List<KolDurumu> {
        val boot = Gunluk.bootSayisi(ctx)
        val calisiyor = Durum.calisiyor(ctx)
        val bolgeSayisi = Bolgeler.hepsi(ctx).size
        return Kol.HEPSI.map { kol ->
            val sonuc = Durum.kurSonuc(ctx, kol)
            val sorun = when {
                !calisiyor -> "ölçüm kapalı"
                bolgeSayisi == 0 -> "bölge yok"
                !Olgular.kesinKonum(ctx) -> "kesin konum izni yok"
                kol != Kol.WIFI && !Olgular.arkaPlanKonum(ctx) -> "arka plan konumu izni yok (yalnız uygulama açıkken çalışır)"
                kol != Kol.WIFI && !Olgular.konumAcik(ctx) -> "konum kapalı"
                kol in kuruluyor -> "kuruluyor…"
                Durum.kurBoot(ctx, kol) != boot -> "bu açılışta henüz kurulmadı"
                sonuc != "ok" -> "kurulamadı ($sonuc)"
                else -> null
            }
            if (sorun == null) {
                val z = java.text.SimpleDateFormat("dd.MM HH:mm", java.util.Locale.ROOT).format(java.util.Date(Durum.kurZaman(ctx, kol)))
                KolDurumu(kol, true, "etkin (kuruldu $z, ${Durum.kurNeden(ctx, kol)})")
            } else {
                KolDurumu(kol, false, sorun)
            }
        }
    }
}
