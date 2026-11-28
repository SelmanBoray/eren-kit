package dev.eren.ajanda.alarm

import android.app.Activity
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
    /** `areNotificationsEnabled()`: uygulamanın bildirimleri ayardan kapatılmamış (her sürüm). */
    val bildirimlerAcik: Boolean = true,
    /** "Hatırlatmalar" kanalı kapalı değil. */
    val hatirlatmaKanaliAcik: Boolean = true,
    /** "Kaçırılan hatırlatmalar" kanalı kapalı değil. */
    val kacirilanKanaliAcik: Boolean = true,
    /**
     * [bildirimSoruldu] bu kurulumdaki her izin isteğini kapsıyor: kurulum, her isteği işaretleyen sürümle başladı
     * ([IzinPlani.isaretGuvenilirMi]). Yanlışsa işaretsiz istekler (eski sürümün açılış isteği) olmuş olabilir;
     * varsayılan yanlış (bilinmeyen güvenli yana: ayar ekranı).
     */
    val soruldusuGuvenilir: Boolean = false,
) {
    /**
     * Bildirim izni sorulmuş olabilir: işaret var ya da işaret güvenilmez (işaretsiz eski istek olmuş olabilir).
     * Yanlışsa kesin: bu kurulumda hiç sorulmadı.
     */
    val bildirimSorulmusOlabilir: Boolean get() = bildirimSoruldu || !soruldusuGuvenilir

    /**
     * Sistem penceresinin açılacağı bilinmiyor: izin yok, Android gerekçe göstermiyor ve izin sorulmuş olabilir.
     * Android kalıcı retten sonra da hiç sorulmamışken de `shouldShowRequestPermissionRationale` için yanlış der;
     * kalıcı retten sonra `requestPermissions` sessiz kalır (ölü düğme). İkisi ancak işaretle ayrılır; işaret yoksa
     * ya da güvenilmezse kalıcı ret sayılır: ayar ekranı her durumda çalışır, sessiz istek çalışmaz.
     */
    val bildirimKaliciReddedildi: Boolean get() = bildirimSorulmusOlabilir && !gerekceGosterilebilir && !bildirimIzni
}

/** Ekranın yapacağı tek şey. */
sealed interface IzinKarari {
    data object Hicbiri : IzinKarari

    /**
     * Sistem izin penceresi: [IzinPlani.bildirimIzniIste] (işareti koyar, sonra `requestPermissions`). Kural
     * `onRequestPermissionsResult`'a dayanmaz; sonuç gelince `HatirlatmaDurumu.oku` yeniden okunur.
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
 * - [IzinAni.KAYIT_KAYDEDILDI]: hatırlatma yoksa hiçbiri. Varsa önce bildirim izni (Android 13+): kesin hiç
 *   sorulmadıysa sistem penceresi; sorulmuş olabilirse kayıtta yeniden sorulmaz (kullanıcının seçimine
 *   saygı; ana ekrandaki şerit "Bildirim izni yok"u göstermeyi sürdürür). "Sorulmuş olabilir" üç kaynaktan:
 *   kalıcı işaret, Android'in gerekçe bayrağı (bir kez reddedildi) ya da işaretin güvenilmemesi (kurulum,
 *   isteği işaretlemeyen eski sürümle başladı: [IzinGirdisi.soruldusuGuvenilir]). Sonra kesin alarm (yalnız Android 12/12L'de kapatılabilir; sistem
 *   penceresi yoktur): izin yoksa ve daha önce açıklanmadıysa ayara yönlendiren açıklama, bir kez. Bildirimler
 *   ya da kanal ayardan kapatıldıysa kayıtta sorulmaz (kullanıcının seçimi; şerit söyler).
 * - [IzinAni.UYARIYA_DOKUNULDU]: kullanıcı açıkça istedi; ölü düğme olmaz, bir sorun varsa bir yol açılır.
 *   Bildirim izni yoksa: kesin hiç sorulmadıysa ya da gerekçe gösterilebiliyorsa sistem penceresi; öteki her
 *   durumda (kalıcı ret ya da ayırt edilemiyor: [IzinGirdisi.bildirimKaliciReddedildi]) bildirim ayarı. Böylece
 *   iki kez reddedip işaretsiz kalmış kullanıcıda dokunuş sessiz kalan isteği açmaz. İzin var ama bildirimler kapalıysa (her sürüm; Android 12 ve altında tek
 *   yol) bildirim ayarı; bir kanal kapalıysa o kanalın ayarı. Bunlar açıksa ve kesin alarm yoksa kesin alarm ayarı.
 * - Bir çağrı tek karar verir; bildirim önce gelir. Gerçek cihazda ikisi birlikte eksik olmaz (12/12L'de
 *   bildirim izni yoktur, 13+'te kesin alarm kendiliğinden verilir).
 */
object IzinPlani {
    private const val DOSYA = "ajanda_ekran"

    /**
     * `AnaEkran`'ın bugünkü anahtarı (aynı tercih dosyası). Dikkat: bugünkü `AnaEkran` bunu yalnız uyarıya
     * dokunulunca koyar, açılıştaki izin isteğinde koymaz; açılışta (iki kez) reddeden kullanıcı için bu işaret
     * yoktur ve gerekçe bayrağı da yanlıştır. Bu yüzden işarete ancak [ISARET_GUVENILIR] doğruysa güvenilir.
     */
    const val BILDIRIM_SORULDU = "izin_soruldu"
    const val KESIN_ALARM_ACIKLANDI = "kesin_alarm_aciklandi"

    /** [isaretGuvenilirMi]'nin kalıcı kararı (ilk okumada bir kez verilir, sonra değişmez). */
    const val ISARET_GUVENILIR = "izin_isareti_guvenilir"

    fun karar(g: IzinGirdisi): IzinKarari = when (g.an) {
        IzinAni.ACILIS -> IzinKarari.Hicbiri
        IzinAni.KAYIT_KAYDEDILDI -> kayitta(g)
        IzinAni.UYARIYA_DOKUNULDU -> uyarida(g)
    }

    private fun bildirimGerekli(g: IzinGirdisi) = g.sdk >= 33 && !g.bildirimIzni

    private fun kayitta(g: IzinGirdisi): IzinKarari = when {
        !g.hatirlatmaVar -> IzinKarari.Hicbiri
        bildirimGerekli(g) ->
            if (!g.bildirimSorulmusOlabilir && !g.gerekceGosterilebilir) IzinKarari.BildirimIzniIste else IzinKarari.Hicbiri
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
        !g.bildirimlerAcik -> IzinKarari.AyaraYonlendir(
            HatirlatmaSorunu.BILDIRIMLER_KAPALI,
            "Bildirimler kapalı",
            "Ajandanın bildirimleri ayarlardan kapatılmış; hatırlatmalar görünmez. Açılacak ayarda ajandanın " +
                "bildirimlerini açın.",
            "Ayarı aç",
        )
        !g.hatirlatmaKanaliAcik -> kanalAciklamasi(HatirlatmaSorunu.HATIRLATMA_KANALI_KAPALI, "Hatırlatmalar")
        !g.kacirilanKanaliAcik -> kanalAciklamasi(HatirlatmaSorunu.KACIRILAN_KANALI_KAPALI, "Kaçırılan hatırlatmalar")
        !g.kesinAlarmIzni -> kesinAlarmAciklamasi()
        else -> IzinKarari.Hicbiri
    }

    private fun kanalAciklamasi(sorun: HatirlatmaSorunu, kanal: String) = IzinKarari.AyaraYonlendir(
        sorun,
        "\"$kanal\" bildirimleri kapalı",
        "Ajandanın \"$kanal\" bildirim türü ayarlardan kapatılmış; bu bildirimler görünmez. Açılacak ayarda onu açın.",
        "Ayarı aç",
    )

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
        val o = HatirlatmaDurumu.olgular(activity)
        return IzinGirdisi(
            an = an,
            hatirlatmaVar = hatirlatmaVar,
            sdk = o.sdk,
            bildirimIzni = o.bildirimIzni,
            bildirimSoruldu = t.getBoolean(BILDIRIM_SORULDU, false),
            gerekceGosterilebilir = o.sdk >= 33 && activity.shouldShowRequestPermissionRationale(HatirlatmaDurumu.BILDIRIM_IZNI),
            kesinAlarmIzni = o.kesinAlarmIzni,
            kesinAlarmAciklandi = t.getBoolean(KESIN_ALARM_ACIKLANDI, false),
            bildirimlerAcik = o.bildirimlerAcik,
            hatirlatmaKanaliAcik = o.hatirlatmaKanaliAcik,
            kacirilanKanaliAcik = o.kacirilanKanaliAcik,
            soruldusuGuvenilir = isaretGuvenilirMi(activity),
        )
    }

    /**
     * İşaretin güvenilirliği, kurulumda bir kez karar verilip saklanır ([guvenilirlikKarari]). Ancak ilk okuma
     * her istekten önce yapılırsa doğrudur: bütün istekler [bildirimIzniIste]'den geçmeli (açılış isteği dahil).
     */
    fun isaretGuvenilirMi(context: Context): Boolean {
        val t = context.applicationContext.getSharedPreferences(DOSYA, Context.MODE_PRIVATE)
        val kayitli = if (t.contains(ISARET_GUVENILIR)) t.getBoolean(ISARET_GUVENILIR, false) else null
        if (kayitli != null) return kayitli
        val (ilk, son) = try {
            @Suppress("DEPRECATION")
            val p = context.packageManager.getPackageInfo(context.packageName, 0)
            p.firstInstallTime to p.lastUpdateTime
        } catch (_: Exception) {
            0L to -1L
        }
        val karar = guvenilirlikKarari(null, ilk, son)
        t.edit().putBoolean(ISARET_GUVENILIR, karar).apply()
        return karar
    }

    /**
     * Saf kural. Saklı karar varsa odur. Yoksa (ilk okuma): kurulum hiç güncellenmediyse ([ilkKurulumMs] ==
     * [sonGuncellemeMs]) bu sürümle başlamıştır, her isteği işaretlenmiştir: güvenilir. Güncellendiyse eski sürüm
     * açılışta işaretsiz istemiş olabilir: güvenilmez (o kullanıcı için "sorulmuş olabilir"; dokunuş ayar ekranını
     * açar). Ölçülemezse güvenilmez. Yanılma payı güvenli yandadır: eski sürümü kurup hiç açmamış kullanıcı da
     * sistem penceresi yerine ayar ekranını görür (çalışan bir yol), ama sessiz istek hiç açılmaz.
     */
    internal fun guvenilirlikKarari(kayitli: Boolean?, ilkKurulumMs: Long, sonGuncellemeMs: Long): Boolean =
        kayitli ?: (ilkKurulumMs > 0 && ilkKurulumMs == sonGuncellemeMs)

    /**
     * [IzinKarari.BildirimIzniIste]'yi yürütür: önce işareti koyar, sonra (Android 13+) sistem penceresini ister.
     * Uygulamanın bütün bildirim izni istekleri bundan geçmeli (işaret ancak böyle güvenilir kalır).
     */
    fun bildirimIzniIste(activity: Activity, istekKodu: Int) {
        isaretGuvenilirMi(activity)
        bildirimSoruldu(activity)
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            activity.requestPermissions(arrayOf(HatirlatmaDurumu.BILDIRIM_IZNI), istekKodu)
        }
    }

    /** [IzinKarari.BildirimIzniIste] yürütülmeden hemen önce (ya da [bildirimIzniIste] kullanılır). */
    fun bildirimSoruldu(context: Context) = isaretle(context, BILDIRIM_SORULDU)

    /** Kesin alarm açıklaması kayıt anında gösterilince. */
    fun kesinAlarmAciklandi(context: Context) = isaretle(context, KESIN_ALARM_ACIKLANDI)

    private fun isaretle(context: Context, anahtar: String) =
        context.applicationContext.getSharedPreferences(DOSYA, Context.MODE_PRIVATE).edit().putBoolean(anahtar, true).apply()
}
