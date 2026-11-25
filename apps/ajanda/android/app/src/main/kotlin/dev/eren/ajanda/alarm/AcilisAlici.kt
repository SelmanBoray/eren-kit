package dev.eren.ajanda.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import dev.eren.ajanda.CekirdekErisimi
import dev.eren.ajanda.cekirdek.YenidenKurmaNedeni
import java.util.TimeZone

/**
 * SAHİBİ: K3. Açılış, paket güncellemesi, saat/dilim değişimi (ve kayıtlıysa kesin alarm izni
 * değişimi): `goAsync`, arka plan iş parçacığında `cekirdek.alarmlariYenidenKur(neden)`.
 * Yeniden başlatma ve zorla durdurma AlarmManager'ı boşaltır; kurulu alarmların tek kanıtı çekirdeğin
 * kaydıdır, çekirdek hepsini aynı numarayla yeniden kurar ve pencere içindeki kaçırılanları tek özette gösterir.
 */
class AcilisAlici : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val neden = AlarmYenidenKurma.nedenAl(intent.action) ?: return
        val uygulama = context.applicationContext
        val bekleyen = goAsync()
        AlarmIsParcacigi.calistir(
            bitir = { bekleyen.finish() },
            hata = { Log.w(AlarmAlici.ETIKET, "yeniden kurulamadı", it) },
        ) { AlarmYenidenKurma.simdi(uygulama, neden) }
    }
}

/**
 * Alarmları yeniden kurdurmanın tek giriş noktası (alıcılar, açılış ekranı, periyodik iş).
 * - Ana iş parçacığından (ör. `AnaEkran.onCreate`): `arkaPlanda(context, UYGULAMA_ACILDI)`.
 * - Zaten arka plandaysan (ör. `EsitlemeIsi`'nin iş parçacığı): `simdi(context, PERIYODIK)`.
 * Bildirim kanallarını da kurar.
 */
object AlarmYenidenKurma {
    /** `AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED` (API 31). */
    const val EYLEM_KESIN_IZIN = "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"

    /** Alıcının eylemi -> neden; tanınmayan eylem `null` (yok sayılır). */
    fun nedenAl(eylem: String?): YenidenKurmaNedeni? = when (eylem) {
        "android.intent.action.BOOT_COMPLETED",
        "android.intent.action.QUICKBOOT_POWERON",
        "com.htc.intent.action.QUICKBOOT_POWERON" -> YenidenKurmaNedeni.ACILIS
        "android.intent.action.MY_PACKAGE_REPLACED" -> YenidenKurmaNedeni.PAKET_GUNCELLENDI
        "android.intent.action.TIME_SET" -> YenidenKurmaNedeni.SAAT_DEGISTI
        "android.intent.action.TIMEZONE_CHANGED" -> YenidenKurmaNedeni.DILIM_DEGISTI
        // İzin verilince gevşek kurulanlar kesin yoldan yeniden kurulsun. Köprüde ayrı neden yok;
        // çekirdek nedeni yalnız kayıt için kullanır.
        EYLEM_KESIN_IZIN -> YenidenKurmaNedeni.PERIYODIK
        else -> null
    }

    /** Eşzamanlı; ana iş parçacığından çağırma. Döner: başarılı mı (hata `HatirlatmaDurumu`'na yazılır). */
    fun simdi(context: Context, neden: YenidenKurmaNedeni): Boolean {
        val uygulama = context.applicationContext
        try {
            Bildirimler.kanallariKur(uygulama)
        } catch (e: Exception) {
            Log.w(AlarmAlici.ETIKET, "kanallar kurulamadı", e)
        }
        return isle(
            neden,
            yenidenKur = { CekirdekErisimi.al(uygulama).alarmlariYenidenKur(it) },
            sorunlar = TercihSorunKaydi(uygulama),
        )
    }

    /** Sıraya koyar, hemen döner (alıcıların iş parçacığında çalışır). */
    fun arkaPlanda(context: Context, neden: YenidenKurmaNedeni) {
        val uygulama = context.applicationContext
        AlarmIsParcacigi.calistir(bitir = {}, hata = { Log.w(AlarmAlici.ETIKET, "yeniden kurulamadı", it) }) {
            simdi(uygulama, neden)
        }
    }

    internal fun isle(
        neden: YenidenKurmaNedeni,
        yenidenKur: (YenidenKurmaNedeni) -> Unit,
        sorunlar: SorunKaydi,
        dilimiTazele: () -> Unit = { TimeZone.setDefault(null) },
    ): Boolean {
        // Süreç dilim değişmeden önce başladıysa JVM'in önbellekteki varsayılan dilimi eskidir;
        // çekirdeğin `cihazDilimi`'si (ZoneId.systemDefault) sistemden yeniden okusun.
        if (neden == YenidenKurmaNedeni.DILIM_DEGISTI) dilimiTazele()
        return try {
            yenidenKur(neden)
            true
        } catch (t: Throwable) {
            sorunlar.cekirdekHatasi("yeniden kurma ($neden): ${t.javaClass.simpleName}")
            false
        }
    }
}
