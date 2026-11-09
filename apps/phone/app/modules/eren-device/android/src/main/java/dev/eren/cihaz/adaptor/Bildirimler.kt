package dev.eren.cihaz.adaptor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import dev.eren.cihaz.cekirdek.BildirimTuru

/**
 * Kalıcı ön plan bildirimi, kanallar ve PC'den gelen bildirimler.
 *
 * Kalıcı bildirimde güvenilmez metin yoktur: yalnız bağlantı durumu, PackageManager'dan gelen
 * uygulama adı ve sayılar. `olay`'daki başlık/metin PC'den gelir; yalnız bildirime girer, günlüğe girmez.
 */
class Bildirimler(private val ctx: Context) {
    companion object {
        const val KANAL_DURUM = "eren_durum"
        const val KANAL_OLAY = "eren_olay"
        const val ONPLAN_ID = 4101

        /** Dokunulan bildirimin türü; modül açılışta okuyup `Adaptor.olaylar?.bildirimAcildi` çağırır. */
        const val EKSTRA_TUR = "eren_bildirim_tur"
        const val ISLEM_DURDUR = "dev.eren.cihaz.adaptor.DURDUR"

        private const val ISTEK_SOYLE = 7001

        private const val ISARET = android.R.drawable.stat_notify_sync_noanim
    }

    private val nm: NotificationManager = ctx.getSystemService(NotificationManager::class.java)

    /** Görünen asistan adı (uygulama etiketi); çalışma anında bir kez okunur. */
    private val ad: String by lazy { ctx.asistanAdi() }

    @Volatile private var bagli = false
    @Volatile private var hata = false
    @Volatile private var izinAktif = false
    @Volatile private var uygulamaAdi: String? = null
    @Volatile private var kalanMs = 0L
    @Volatile private var kalanButce = 0

    fun kanallariKur() {
        nm.createNotificationChannel(
            NotificationChannel(KANAL_DURUM, "$ad bağlantısı", NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(KANAL_OLAY, "$ad bildirimleri", NotificationManager.IMPORTANCE_HIGH),
        )
    }

    /** Bağlantı durumu değişince çağrılır; bildirimi yeniler. */
    fun baglantiDurumu(bagliMi: Boolean) {
        if (bagli == bagliMi) return
        bagli = bagliMi
        yenile()
    }

    /** Çekirdek kurulamadıysa kalıcı bildirim bunu söyler (hata metni yok). */
    fun cekirdekHatasi() {
        hata = true
        yenile()
    }

    /** İzin yoksa `uygulama` null; sayaç gizlenir. Görünür değer değişmediyse bildirim yeniden gönderilmez. */
    fun sayac(kalanMs: Long, kalanButce: Int, uygulama: String? = null) {
        val aktif = uygulama != null
        if (aktif == izinAktif && uygulama == uygulamaAdi && kalanMs / 1000 == this.kalanMs / 1000 &&
            kalanButce == this.kalanButce
        ) {
            return
        }
        izinAktif = aktif
        uygulamaAdi = uygulama
        this.kalanMs = kalanMs
        this.kalanButce = kalanButce
        yenile()
    }

    fun onPlan(): Notification {
        val durum = when {
            hata -> "Çekirdek başlatılamadı"
            bagli -> "PC ile bağlı"
            else -> "PC bağlantısı bekleniyor"
        }
        val b = NotificationCompat.Builder(ctx, KANAL_DURUM)
            .setSmallIcon(ISARET)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(acmaIstegi(null, 0))
        if (izinAktif && !hata) {
            val kalan = kalanMs.coerceAtLeast(0L) / 1000
            val sure = "${kalan / 60}:${(kalan % 60).toString().padStart(2, '0')}"
            b.setContentTitle("$ad: ${uygulamaAdi ?: "izin açık"}")
            b.setContentText("Kalan $sure · bütçe $kalanButce · $durum")
            b.addAction(
                NotificationCompat.Action.Builder(
                    0,
                    "Durdur",
                    PendingIntent.getBroadcast(
                        ctx,
                        1,
                        Intent(ctx, DurdurAlici::class.java).setAction(ISLEM_DURDUR),
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                    ),
                ).build(),
            )
        } else {
            b.setContentTitle(ad)
            b.setContentText(durum)
        }
        // "Durdur" (varsa) önce kalır; "<ad> ile konuş" (kısayol) her durumda sona eklenir.
        b.addAction(
            NotificationCompat.Action.Builder(
                0,
                "$ad ile konuş",
                PendingIntent.getActivity(
                    ctx,
                    ISTEK_SOYLE,
                    Intent(ctx, KisayolActivity::class.java),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            ).build(),
        )
        return b.build()
    }

    /** PC'den gelen bildirim; başlık ve metin güvenilmez, yalnız burada görünür. */
    fun olay(notifyId: String, tur: BildirimTuru, baslik: String, metin: String) {
        val n = NotificationCompat.Builder(ctx, KANAL_OLAY)
            .setSmallIcon(ISARET)
            .setContentTitle(baslik)
            .setContentText(metin)
            .setStyle(NotificationCompat.BigTextStyle().bigText(metin))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(acmaIstegi(tur, 1 + (notifyId.hashCode() and 0x0FFF)))
            .build()
        gonder(1000 + (notifyId.hashCode() and 0x0FFF), n)
    }

    /** Bildirime dokunuş uygulamayı açınca modül çağırır. */
    fun acildi(tur: BildirimTuru) {
        Adaptor.olaylar?.bildirimAcildi(tur)
    }

    private fun yenile() = gonder(ONPLAN_ID, onPlan())

    private fun gonder(id: Int, n: Notification) {
        try {
            nm.notify(id, n)
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS verilmemiş olabilir; servis bundan etkilenmez.
        }
    }

    private fun acmaIstegi(tur: BildirimTuru?, istek: Int): PendingIntent? {
        val niyet = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
        niyet.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (tur != null) niyet.putExtra(EKSTRA_TUR, tur.kablo)
        return PendingIntent.getActivity(
            ctx,
            istek,
            niyet,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
