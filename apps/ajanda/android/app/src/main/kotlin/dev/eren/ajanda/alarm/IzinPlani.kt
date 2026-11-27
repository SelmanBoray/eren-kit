package dev.eren.ajanda.alarm

import android.app.Activity
import android.app.AlarmManager
import android.content.Context

/** İzin kararının sorulduğu an. */
enum class IzinAni {
    /** Uygulama açıldı (ilk açılış dahil). Hiçbir izin istenmez (D6). */
    ACILIS,

    /** Bir kayıt kaydedildi (ekleme ya da düzenleme). İzinler hatırlatmalı ilk kayıtta istenir. */
    KAYIT_KAYDEDILDI,

    /** Kullanıcı hatırlatma uyarısındaki "İzin ver"e dokundu (`HatirlatmaUyarilari`). */
    UYARIYA_DOKUNULDU,
}

/** Karara giren olgular (Android'den [IzinPlani.oku] ile; testte elle). */
data class IzinGirdisi(
    val an: IzinAni,
    /** Kaydedilen kaydın kurulacak hatırlatması var (ör. `hatirlatmaOzeti(govde).kurulacak > 0`). */
    val hatirlatmaVar: Boolean,
    val sdk: Int,
    /** POST_NOTIFICATIONS verildi (Android 12 ve altında hep doğru). */
    val bildirimIzni: Boolean,
    /** Bildirim izni sistem penceresiyle daha önce soruldu (kalıcı tercih). */
    val bildirimSoruldu: Boolean,
    /** `shouldShowRequestPermissionRationale(POST_NOTIFICATIONS)`: bir kez reddedildi, yeniden sorulabilir. */
    val gerekceGosterilebilir: Boolean,
    /** Kesin alarm izni var (Android 11 ve altı ile 13+ `USE_EXACT_ALARM`'la hep doğru). */
    val kesinAlarmIzni: Boolean,
    /** Kesin alarm açıklaması kayıt anında daha önce gösterildi (kalıcı tercih). */
    val kesinAlarmAciklandi: Boolean,
) {
    /** Bildirim izni sorulup reddedildi ve sistem penceresi bir daha açılmaz (yalnız ayar ekranı kalır). */
    val bildirimKaliciReddedildi: Boolean get() = bildirimSoruldu && !gerekceGosterilebilir && !bildirimIzni
}

/** Ekranın yapacağı tek şey. */
sealed interface IzinKarari {
    data object Hicbiri : IzinKarari

    /**
     * Sistem izin penceresi: `requestPermissions(arrayOf(HatirlatmaDurumu.BILDIRIM_IZNI), kod)`; önce
     * [IzinPlani.bildirimSoruldu] çağrılır. Sonuç `onRequestPermissionsResult`'ta; ardından
     * `HatirlatmaDurumu.oku` yeniden okunur.
     */
    data object BildirimIzniIste : IzinKarari

    /**
     * Açıklama penceresi; düğme `HatirlatmaDurumu.cozumNiyeti(context, sorun)` ile ayar ekranını açar
     * (yoksa uygulama ayrıntısı). Kesin alarm açıklaması kayıt anında gösterildiyse [IzinPlani.kesinAlarmAciklandi].
     */
    data class AyaraYonlendir(val sorun: HatirlatmaSorunu, val baslik: String, val aciklama: String, val dugme: String) : IzinKarari
}

/**
 * D6: hangi anda hangi iznin isteneceği (saf karar [karar]; Android okuması [oku], kalıcı işaretler
 * [bildirimSoruldu]/[kesinAlarmAciklandi]). Davranış mevcut koddan türetildi (`AnaEkran.uyariCoz`,
 * `HatirlatmaDurumu`, `AlarmPlanlayici`); tek fark: açılışta artık hiçbir izin istenmez.
 *
 * Kurallar:
 * - [IzinAni.ACILIS]: her zaman [IzinKarari.Hicbiri].
 * - [IzinAni.KAYIT_KAYDEDILDI]: hatırlatma yoksa hiçbiri. Varsa önce bildirim izni (Android 13+): hiç
 *   sorulmadıysa sistem penceresi; sorulup reddedildiyse kayıtta yeniden sorulmaz (kullanıcının seçimine
 *   saygı; ana ekrandaki şerit "Bildirim izni yok"u göstermeyi sürdürür). Sonra kesin alarm (yalnız
 *   Android 12/12L'de kapatılabilir; sistem penceresi yoktur): izin yoksa ve daha önce açıklanmadıysa
 *   ayara yönlendiren açıklama, bir kez.
 * - [IzinAni.UYARIYA_DOKUNULDU]: kullanıcı açıkça istedi. Bildirim izni yoksa: hiç sorulmadıysa ya da
 *   gerekçe gösterilebiliyorsa sistem penceresi, kalıcı reddedildiyse bildirim ayarı. Bildirim izni varsa
 *   ve kesin alarm yoksa kesin alarm ayarı.
 * - Bir çağrı tek karar verir; bildirim önce gelir. Gerçek cihazda ikisi birlikte eksik olmaz (12/12L'de
 *   bildirim izni yoktur, 13+'te kesin alarm kendiliğinden verilir).
 */
object IzinPlani {
    private const val DOSYA = "ajanda_ekran"

    /** `AnaEkran`'ın bugünkü anahtarı (aynı tercih: sürüm yükseltmesinde "soruldu" bilgisi kaybolmaz). */
    const val BILDIRIM_SORULDU = "izin_soruldu"
    const val KESIN_ALARM_ACIKLANDI = "kesin_alarm_aciklandi"

    fun karar(g: IzinGirdisi): IzinKarari = when (g.an) {
        IzinAni.ACILIS -> IzinKarari.Hicbiri
        IzinAni.KAYIT_KAYDEDILDI -> kayitta(g)
        IzinAni.UYARIYA_DOKUNULDU -> uyarida(g)
    }

    private fun bildirimGerekli(g: IzinGirdisi) = g.sdk >= 33 && !g.bildirimIzni

    private fun kayitta(g: IzinGirdisi): IzinKarari = when {
        !g.hatirlatmaVar -> IzinKarari.Hicbiri
        bildirimGerekli(g) -> if (!g.bildirimSoruldu) IzinKarari.BildirimIzniIste else IzinKarari.Hicbiri
        !g.kesinAlarmIzni && !g.kesinAlarmAciklandi -> kesinAlarmAciklamasi()
        else -> IzinKarari.Hicbiri
    }

    private fun uyarida(g: IzinGirdisi): IzinKarari = when {
        bildirimGerekli(g) ->
            if (!g.bildirimKaliciReddedildi) IzinKarari.BildirimIzniIste
            else IzinKarari.AyaraYonlendir(
                HatirlatmaSorunu.BILDIRIM_IZNI_YOK,
                "Bildirim izni kapalı",
                "Bildirim iznini daha önce vermediniz; Android bunu bir daha sormuyor. Hatırlatmaların görünmesi için " +
                    "açılacak ayarda ajandanın bildirimlerine izin verin.",
                "Ayarı aç",
            )
        !g.kesinAlarmIzni -> kesinAlarmAciklamasi()
        else -> IzinKarari.Hicbiri
    }

    private fun kesinAlarmAciklamasi() = IzinKarari.AyaraYonlendir(
        HatirlatmaSorunu.KESIN_ALARM_IZNI_YOK,
        "Hatırlatmalar gecikebilir",
        "Bu telefonda kesin alarm izni kapalı; hatırlatmalar dakikalarca, hatta saatlerce gecikebilir. Açılacak " +
            "ayarda \"Alarmlar ve hatırlatıcılar\" iznini verin.",
        "Ayarı aç",
    )

    /** Canlı olgular. Ana iş parçacığından çağrılabilir (sistem servisleri ve SharedPreferences). */
    fun oku(activity: Activity, an: IzinAni, hatirlatmaVar: Boolean): IzinGirdisi {
        val t = activity.getSharedPreferences(DOSYA, Context.MODE_PRIVATE)
        val sdk = android.os.Build.VERSION.SDK_INT
        return IzinGirdisi(
            an = an,
            hatirlatmaVar = hatirlatmaVar,
            sdk = sdk,
            bildirimIzni = !HatirlatmaDurumu.bildirimIzniIstenmeli(activity),
            bildirimSoruldu = t.getBoolean(BILDIRIM_SORULDU, false),
            gerekceGosterilebilir = sdk >= 33 && activity.shouldShowRequestPermissionRationale(HatirlatmaDurumu.BILDIRIM_IZNI),
            kesinAlarmIzni = AndroidAlarmSistemi.kesinAlarmIzniVar(activity.getSystemService(AlarmManager::class.java)),
            kesinAlarmAciklandi = t.getBoolean(KESIN_ALARM_ACIKLANDI, false),
        )
    }

    /** [IzinKarari.BildirimIzniIste] yürütülmeden hemen önce. */
    fun bildirimSoruldu(context: Context) = isaretle(context, BILDIRIM_SORULDU)

    /** Kesin alarm açıklaması kayıt anında gösterilince. */
    fun kesinAlarmAciklandi(context: Context) = isaretle(context, KESIN_ALARM_ACIKLANDI)

    private fun isaretle(context: Context, anahtar: String) =
        context.applicationContext.getSharedPreferences(DOSYA, Context.MODE_PRIVATE).edit().putBoolean(anahtar, true).apply()
}
