package dev.eren.ajanda.ag

import android.content.Context
import dev.eren.ajanda.CekirdekErisimi

/**
 * Süreç başına tek bağlantı yöneticisi (K1 ve K4'ün çağırdığı tek yüz; imza sabit). Mantık
 * `BaglantiDenetcisi`'nde, strateji `AgStratejisi.kt`'de.
 *
 * İkisi de her iş parçacığından (ana dahil) çağrılabilir, hemen döner, tekrarlı ve eşzamanlı çağrıya
 * dayanıklıdır. Durum `basla`/`birak` çiftinin son çağrısıdır (sayaç değil): görünür bir etkinlik
 * kaldıkça `birak` çağrılmamalıdır.
 */
object BaglantiYoneticisi {
    @Volatile
    private var denetci: BaglantiDenetcisi? = null

    /**
     * Arayüz görünür oldu ya da eşleştirme başladı: bağlı kal (kopunca artan beklemeyle yeniden).
     * Eşleşme yoksa (`baglantiAdresi() == null`) hiçbir bağlantı açılmaz. Eşleşme varsa periyodik
     * arka plan eşitleme işini de kurar.
     */
    fun basla(context: Context) {
        al(context).basla()
    }

    /** Arayüz kapandı: kısa beklemeden (ve varsa kuyruk boşaltmadan) sonra bağlantıyı bırak. */
    fun birak() {
        denetci?.birak()
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
