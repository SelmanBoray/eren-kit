package dev.eren.ajanda.ag

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import dev.eren.ajanda.CekirdekErisimi

/**
 * Süreç başına tek bağlantı yöneticisi. Mantık `BaglantiDenetcisi`'nde, strateji `AgStratejisi.kt`'de.
 *
 * Ön plan bağlantısını etkinlikler açıp kapatmaz: [izle] uygulamanın etkinlik yaşam döngüsünü
 * [GorunurlukSayaci]'na bağlar (kural orada, tek yerde): herhangi bir ekran görünürken bağlantı açık,
 * hiçbiri görünmezken kısa bekleme sonrası kapalı. Eşleşme yoksa (`baglantiAdresi() == null`) hiçbir
 * bağlantı açılmaz; eşleşme varsa periyodik arka plan eşitleme işi de kurulur.
 *
 * Bütün yöntemler her iş parçacığından çağrılabilir, hemen döner, tekrarlı çağrıya dayanıklıdır.
 */
object BaglantiYoneticisi {
    @Volatile
    private var denetci: BaglantiDenetcisi? = null

    @Volatile
    private var izleniyor = false

    @Volatile
    private var gorunurluk: GorunurlukSayaci? = null

    /** Uygulamanın bir ekranı şu an görünür mü (arka plan bildirimi görünür arayüzde gösterilmez). */
    val arayuzGorunur: Boolean get() = gorunurluk?.gorunur == true

    /** `AjandaUygulamasi.onCreate`: etkinliklerin görünürlüğünü bağlantı talebine bağlar (süreçte bir kez). */
    fun izle(uygulama: Application) {
        synchronized(this) {
            if (izleniyor) return
            izleniyor = true
        }
        val sayac = GorunurlukSayaci(gorundu = { al(uygulama).basla() }, gizlendi = { denetci?.birak() })
        gorunurluk = sayac
        uygulama.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityStarted(activity: Activity) = sayac.basladi()
            override fun onActivityStopped(activity: Activity) = sayac.durdu()
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityResumed(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
    }

    /**
     * Eşleştirme başladı ya da bitti: bağlantı isteniyorsa (bir ekran görünürken) beklemeyi atlayıp hemen
     * dener. Talebi değiştirmez: görünür ekran yoksa hiçbir şey yapmaz.
     */
    fun simdiDene() {
        denetci?.hemenDene()
    }

    /** `EsitlemeIsi`: kısa oturum; [bitti] yöneticinin iş parçacığında, tam bir kez. */
    internal fun arkaPlanOturumu(context: Context, bitti: (ArkaPlanSonucu) -> Unit): Iptal =
        al(context).arkaPlanOturumu(bitti)

    private fun al(context: Context): BaglantiDenetcisi =
        denetci ?: synchronized(this) {
            denetci ?: olustur(context.applicationContext).also { denetci = it }
        }

    // Yalnız nesne kurar; çekirdek, OkHttp istemcisi ve ağ dinleyicisi ilk işte, ağ iş parçacığında açılır.
    private fun olustur(uygulama: Context) = BaglantiDenetcisi(
        cekirdekAl = { CekirdekKanali(CekirdekErisimi.al(uygulama)) },
        acici = OkHttpSoketAcici(AgAyarlari.VARSAYILAN),
        zaman = YurutucuZamanlayici("ajanda-ag"),
        ag = AndroidAgIzleyici(uygulama),
        isler = JobIsPlanlayici(uygulama),
        gunluk = LogGunluk,
        ayar = AgAyarlari.VARSAYILAN,
    )
}
