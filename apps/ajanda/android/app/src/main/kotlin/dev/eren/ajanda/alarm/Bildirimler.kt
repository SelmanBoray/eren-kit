package dev.eren.ajanda.alarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import dev.eren.ajanda.R
import dev.eren.ajanda.cekirdek.HatirlatmaBildirimi
import dev.eren.ajanda.cekirdek.KayitTuru
import java.time.LocalDate
import java.time.ZoneId

/** Bildirim gösterme yüzü (testte sahtesi). `false`: gösterilemedi (izin, uygulama ya da kanal kapalı). */
interface Bildirici {
    fun hatirlatmaGoster(b: HatirlatmaBildirimi): Boolean

    /** Bir ya da daha çok satır: tek özet bildirim (ekranda duran özetle birleşir). */
    fun kacirilanGoster(satirlar: List<HatirlatmaBildirimi>): Boolean

    /** Alarm çaldı ama çekirdek içeriği veremedi: kaçırmaktansa ayrıntısız hatırlatma. */
    fun ayrintisizGoster(alarmNo: Long): Boolean
}

/**
 * Üretim bildirimleri (platform API'si; AndroidX yok). İki kanal: hatırlatmalar (yüksek önem, sesli) ve
 * kaçırılanlar (varsayılan önem). Kilit ekranı: kanal ve bildirim `VISIBILITY_PRIVATE`, açık yüzde
 * başlık yok (`Icerik.gizli*`). Dokununca uygulamanın başlatıcı etkinliği açılır (`KAYIT_ID` ekstrasıyla).
 */
class Bildirimler(private val context: Context) : Bildirici {
    private val nm: NotificationManager by lazy { context.getSystemService(NotificationManager::class.java) }

    override fun hatirlatmaGoster(b: HatirlatmaBildirimi): Boolean {
        if (!gosterilebilir(KANAL_HATIRLATMA)) return false
        val i = BildirimIcerigi.hatirlatma(b, LocalDate.now(), ZoneId.systemDefault().id)
        val n = taslak(KANAL_HATIRLATMA, i)
            .setCategory(if (b.tur == KayitTuru.RANDEVU) Notification.CATEGORY_EVENT else Notification.CATEGORY_REMINDER)
            .setWhen(b.tetikMs)
            .setShowWhen(true)
            .setContentIntent(uygulamayiAcNiyeti(context, b.kayitId, istekKodu = b.alarmNo.toInt()))
            .build()
        nm.notify(ETIKET_HATIRLATMA, b.alarmNo.toInt(), n)
        return true
    }

    override fun kacirilanGoster(satirlar: List<HatirlatmaBildirimi>): Boolean {
        if (satirlar.isEmpty()) return true
        if (!gosterilebilir(KANAL_KACIRILAN)) return false
        val bugun = LocalDate.now()
        val dilim = ZoneId.systemDefault().id
        val yeni = satirlar.map { BildirimIcerigi.ozetSatiri(it, bugun, dilim) }
        val ozet = BildirimIcerigi.kacirilan(BildirimIcerigi.birlestir(ekrandakiOzet(), yeni))
        val stil = Notification.InboxStyle()
        ozet.gorunenSatirlar.forEach { stil.addLine(it) }
        if (ozet.tasan > 0) stil.setSummaryText(AlarmMetinleri.tasan(ozet.tasan))
        val n = taslak(KANAL_KACIRILAN, ozet.icerik)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setStyle(stil)
            .setNumber(ozet.satirlar.size)
            .setContentIntent(uygulamayiAcNiyeti(context, null, istekKodu = -1))
            .addExtras(android.os.Bundle().apply {
                putLongArray(EK_ALARMLAR, ozet.satirlar.map { it.alarmNo }.toLongArray())
                putLongArray(EK_TETIKLER, ozet.satirlar.map { it.tetikMs }.toLongArray())
                putStringArray(EK_KAYITLAR, ozet.satirlar.map { it.kayitId }.toTypedArray())
                putStringArray(EK_SATIRLAR, ozet.satirlar.map { it.metin }.toTypedArray())
            })
            .build()
        nm.notify(ETIKET_KACIRILAN, KACIRILAN_ID, n)
        return true
    }

    override fun ayrintisizGoster(alarmNo: Long): Boolean {
        if (!gosterilebilir(KANAL_HATIRLATMA)) return false
        val n = taslak(KANAL_HATIRLATMA, BildirimIcerigi.ayrintisiz())
            .setCategory(Notification.CATEGORY_REMINDER)
            .setContentIntent(uygulamayiAcNiyeti(context, null, istekKodu = alarmNo.toInt()))
            .build()
        nm.notify(ETIKET_HATIRLATMA, alarmNo.toInt(), n)
        return true
    }

    /** Uygulama bildirimleri (Android 13+: izin) ve kanal açık mı; kapalıyken `notify` sessizce düşer. */
    private fun gosterilebilir(kanal: String): Boolean {
        if (!nm.areNotificationsEnabled()) return false
        kanallariKur(context)
        return nm.getNotificationChannel(kanal)?.importance != NotificationManager.IMPORTANCE_NONE
    }

    private fun taslak(kanal: String, i: Icerik): Notification.Builder {
        val acik = Notification.Builder(context, kanal)
            .setSmallIcon(R.drawable.alarm_bildirim_simgesi)
            .setContentTitle(i.gizliBaslik)
            .setContentText(i.gizliMetin)
            .build()
        return Notification.Builder(context, kanal)
            .setSmallIcon(R.drawable.alarm_bildirim_simgesi)
            .setContentTitle(i.baslik)
            .setContentText(i.metin)
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(acik)
    }

    /** Ekranda duran kaçırılan özetinin satırları (kullanıcı silmediyse yenileriyle birleşir). */
    private fun ekrandakiOzet(): List<OzetSatiri> = try {
        val ek = nm.activeNotifications
            .firstOrNull { it.tag == ETIKET_KACIRILAN && it.id == KACIRILAN_ID }
            ?.notification?.extras ?: return emptyList()
        val alarmlar = ek.getLongArray(EK_ALARMLAR) ?: return emptyList()
        val tetikler = ek.getLongArray(EK_TETIKLER) ?: return emptyList()
        val kayitlar = ek.getStringArray(EK_KAYITLAR) ?: return emptyList()
        val satirlar = ek.getStringArray(EK_SATIRLAR) ?: return emptyList()
        if (setOf(alarmlar.size, tetikler.size, kayitlar.size).size != 1 || satirlar.size != alarmlar.size) {
            emptyList()
        } else {
            alarmlar.indices.map { OzetSatiri(alarmlar[it], tetikler[it], kayitlar[it], satirlar[it]) }
        }
    } catch (e: Exception) {
        emptyList()
    }

    companion object {
        const val KANAL_HATIRLATMA = "ajanda_hatirlatma"
        const val KANAL_KACIRILAN = "ajanda_kacirilan"
        const val ETIKET_HATIRLATMA = "ajanda.hatirlatma"
        const val ETIKET_KACIRILAN = "ajanda.kacirilan"
        const val KACIRILAN_ID = 1

        /** Bildirime dokununca açılan etkinliğe giden kayıt kimliği (K4 okuyabilir; yoksa yalnız uygulama açılır). */
        const val KAYIT_ID = "dev.eren.ajanda.KAYIT_ID"

        private const val EK_ALARMLAR = "dev.eren.ajanda.kacirilan.alarmlar"
        private const val EK_TETIKLER = "dev.eren.ajanda.kacirilan.tetikler"
        private const val EK_KAYITLAR = "dev.eren.ajanda.kacirilan.kayitlar"
        private const val EK_SATIRLAR = "dev.eren.ajanda.kacirilan.satirlar"

        /** Kanalları kurar (tekrar çağrı zararsız; kullanıcının değiştirdiği önem korunur). */
        fun kanallariKur(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java)
            val hatirlatma = NotificationChannel(
                KANAL_HATIRLATMA, AlarmMetinleri.KANAL_HATIRLATMA, NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = AlarmMetinleri.KANAL_HATIRLATMA_ACIKLAMA
                lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                enableVibration(true)
            }
            val kacirilan = NotificationChannel(
                KANAL_KACIRILAN, AlarmMetinleri.KANAL_KACIRILAN, NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = AlarmMetinleri.KANAL_KACIRILAN_ACIKLAMA
                lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            }
            nm.createNotificationChannels(listOf(hatirlatma, kacirilan))
        }

        /**
         * Uygulamanın başlatıcı etkinliğini açan niyet (`ekran` paketine derleme bağımlılığı yok).
         * `istekKodu` bildirim başına farklı olmalı (ekstralar FLAG_UPDATE_CURRENT ile ezilmesin).
         */
        fun uygulamayiAcNiyeti(context: Context, kayitId: String?, istekKodu: Int = 0): PendingIntent {
            val i = context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?: Intent().setPackage(context.packageName)
            i.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (kayitId != null) i.putExtra(KAYIT_ID, kayitId)
            return PendingIntent.getActivity(
                context, istekKodu, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
    }
}
