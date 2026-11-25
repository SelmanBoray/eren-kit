package dev.eren.ajanda.alarm

import android.Manifest
import android.app.ActivityManager
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/** Hatırlatmaların telefonda çalmasını engelleyen ya da geciktiren, kullanıcıya gösterilecek durumlar. */
enum class HatirlatmaSorunu {
    /** Android 13+: POST_NOTIFICATIONS verilmedi. Hiçbir hatırlatma görünmez. */
    BILDIRIM_IZNI_YOK,

    /** Uygulamanın bildirimleri ayarlardan kapalı. Hiçbir hatırlatma görünmez. */
    BILDIRIMLER_KAPALI,

    /** "Hatırlatmalar" kanalı kapalı. */
    HATIRLATMA_KANALI_KAPALI,

    /** "Kaçırılan hatırlatmalar" kanalı kapalı. */
    KACIRILAN_KANALI_KAPALI,

    /** Kesin alarm izni yok (12/12L): alarmlar gevşek kurulur, dakikalar-saatler gecikebilir. */
    KESIN_ALARM_IZNI_YOK,

    /** Kullanıcı uygulamanın arka plan çalışmasını kısıtladı: alarmlar teslim edilmeyebilir. */
    ARKA_PLAN_KISITLI,

    /** Pil optimizasyonundan muaf değil (bilgi; ölçüm gerekli olduğunu gösterirse zorunlu adım olur). */
    PIL_OPTIMIZASYONU,

    /** Kayıtlı: çalan/kaçırılan hatırlatma gösterilemedi (`KayitliSorunlar.gosterilemeyenKayitlar`). */
    GOSTERILEMEYEN_HATIRLATMA,

    /** Kayıtlı: alarm kurulamadı (sonraki yeniden kurulumda yeniden denenir). */
    KURULAMAYAN_ALARM,

    /** Kayıtlı: alıcıda çekirdek çağrısı başarısız. */
    CEKIRDEK_HATASI,
}

/** Canlı olgular (Android'den okunur; testte elle). */
data class IzinOlgulari(
    val sdk: Int,
    val bildirimIzni: Boolean,
    val bildirimlerAcik: Boolean,
    val hatirlatmaKanaliAcik: Boolean,
    val kacirilanKanaliAcik: Boolean,
    val kesinAlarmIzni: Boolean,
    val arkaPlanKisitli: Boolean,
    val pilOptimizasyonundanMuaf: Boolean,
)

data class HatirlatmaDurumu(
    val sorunlar: List<HatirlatmaSorunu>,
    val kayitli: KayitliSorunlar,
) {
    /** Hatırlatmaların görünmesini engelleyen ya da güvenilmez yapan bir sorun var mı (bilgi düzeyi hariç). */
    val engelVar: Boolean get() = sorunlar.any { it in ENGELLER }

    companion object {
        val ENGELLER: Set<HatirlatmaSorunu> = setOf(
            HatirlatmaSorunu.BILDIRIM_IZNI_YOK,
            HatirlatmaSorunu.BILDIRIMLER_KAPALI,
            HatirlatmaSorunu.HATIRLATMA_KANALI_KAPALI,
            HatirlatmaSorunu.KESIN_ALARM_IZNI_YOK,
            HatirlatmaSorunu.ARKA_PLAN_KISITLI,
            HatirlatmaSorunu.GOSTERILEMEYEN_HATIRLATMA,
            HatirlatmaSorunu.KURULAMAYAN_ALARM,
            HatirlatmaSorunu.CEKIRDEK_HATASI,
        )

        /** Saf: olgular + kayıtlı sorunlar -> önem sırasıyla sorun listesi. */
        fun hesapla(o: IzinOlgulari, k: KayitliSorunlar): HatirlatmaDurumu {
            val s = mutableListOf<HatirlatmaSorunu>()
            when {
                o.sdk >= 33 && !o.bildirimIzni -> s += HatirlatmaSorunu.BILDIRIM_IZNI_YOK
                !o.bildirimlerAcik -> s += HatirlatmaSorunu.BILDIRIMLER_KAPALI
                else -> {
                    if (!o.hatirlatmaKanaliAcik) s += HatirlatmaSorunu.HATIRLATMA_KANALI_KAPALI
                    if (!o.kacirilanKanaliAcik) s += HatirlatmaSorunu.KACIRILAN_KANALI_KAPALI
                }
            }
            if (!o.kesinAlarmIzni) s += HatirlatmaSorunu.KESIN_ALARM_IZNI_YOK
            if (o.arkaPlanKisitli) s += HatirlatmaSorunu.ARKA_PLAN_KISITLI
            if (k.gosterilemeyenSayisi > 0) s += HatirlatmaSorunu.GOSTERILEMEYEN_HATIRLATMA
            if (k.kurulamayanSayisi > 0) s += HatirlatmaSorunu.KURULAMAYAN_ALARM
            if (k.cekirdekHatasiSayisi > 0) s += HatirlatmaSorunu.CEKIRDEK_HATASI
            if (!o.pilOptimizasyonundanMuaf) s += HatirlatmaSorunu.PIL_OPTIMIZASYONU
            return HatirlatmaDurumu(s, k)
        }

        /** Canlı durum. Ana iş parçacığından çağrılabilir (yalnız sistem servisleri ve SharedPreferences). */
        fun oku(context: Context): HatirlatmaDurumu = hesapla(olgular(context), TercihSorunKaydi(context.applicationContext).oku())

        /** Kullanıcı kayıtlı sorunları gördü (canlı olgular silinmez, kendiliğinden düzelir). */
        fun goruldu(context: Context) = TercihSorunKaydi(context.applicationContext).temizle()

        /**
         * Android 13+ ve izin verilmemişse true: ekran `activity.requestPermissions(arrayOf(BILDIRIM_IZNI), kod)`
         * çağırır; kullanıcı kalıcı reddettiyse (`shouldShowRequestPermissionRationale` false ve yine izin yok)
         * `cozumNiyeti(BILDIRIM_IZNI_YOK)` ayarı açar.
         */
        fun bildirimIzniIstenmeli(context: Context): Boolean =
            Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission(BILDIRIM_IZNI) != PackageManager.PERMISSION_GRANTED

        const val BILDIRIM_IZNI = Manifest.permission.POST_NOTIFICATIONS

        fun olgular(context: Context): IzinOlgulari {
            val nm = context.getSystemService(NotificationManager::class.java)
            val am = context.getSystemService(AlarmManager::class.java)
            val pm = context.getSystemService(PowerManager::class.java)
            val acm = context.getSystemService(ActivityManager::class.java)
            fun kanalAcik(id: String) = nm.getNotificationChannel(id)?.importance != NotificationManager.IMPORTANCE_NONE
            return IzinOlgulari(
                sdk = Build.VERSION.SDK_INT,
                bildirimIzni = !bildirimIzniIstenmeli(context),
                bildirimlerAcik = nm.areNotificationsEnabled(),
                hatirlatmaKanaliAcik = kanalAcik(Bildirimler.KANAL_HATIRLATMA),
                kacirilanKanaliAcik = kanalAcik(Bildirimler.KANAL_KACIRILAN),
                kesinAlarmIzni = AndroidAlarmSistemi.kesinAlarmIzniVar(am),
                arkaPlanKisitli = Build.VERSION.SDK_INT >= 28 && acm.isBackgroundRestricted,
                pilOptimizasyonundanMuaf = pm.isIgnoringBatteryOptimizations(context.packageName),
            )
        }

        /**
         * Sorunu çözecek ayar ekranı (`startActivity` ile; üretici ekranı yoksa `ActivityNotFoundException`
         * yakalanıp `APPLICATION_DETAILS` denenmeli). Kayıtlı sorunlarda null: gösterilir, `goruldu` ile silinir.
         * Xiaomi/MIUI'de otomatik başlatma ve pil tasarrufu ("Kısıtlama yok") uygulama ayrıntısı ekranındadır.
         */
        fun cozumNiyeti(context: Context, sorun: HatirlatmaSorunu): Intent? {
            val paket = context.packageName
            val ayrinti = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", paket, null))
            val i = when (sorun) {
                HatirlatmaSorunu.BILDIRIM_IZNI_YOK, HatirlatmaSorunu.BILDIRIMLER_KAPALI ->
                    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, paket)
                HatirlatmaSorunu.HATIRLATMA_KANALI_KAPALI, HatirlatmaSorunu.KACIRILAN_KANALI_KAPALI ->
                    Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, paket)
                        .putExtra(
                            Settings.EXTRA_CHANNEL_ID,
                            if (sorun == HatirlatmaSorunu.HATIRLATMA_KANALI_KAPALI) Bildirimler.KANAL_HATIRLATMA
                            else Bildirimler.KANAL_KACIRILAN,
                        )
                HatirlatmaSorunu.KESIN_ALARM_IZNI_YOK ->
                    if (Build.VERSION.SDK_INT >= 31) {
                        Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.fromParts("package", paket, null))
                    } else {
                        ayrinti
                    }
                HatirlatmaSorunu.ARKA_PLAN_KISITLI, HatirlatmaSorunu.PIL_OPTIMIZASYONU -> ayrinti
                HatirlatmaSorunu.GOSTERILEMEYEN_HATIRLATMA, HatirlatmaSorunu.KURULAMAYAN_ALARM,
                HatirlatmaSorunu.CEKIRDEK_HATASI -> null
            }
            return i?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }
}
