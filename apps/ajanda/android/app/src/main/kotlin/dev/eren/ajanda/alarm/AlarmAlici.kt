package dev.eren.ajanda.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import dev.eren.ajanda.CekirdekErisimi
import dev.eren.ajanda.cekirdek.HatirlatmaBildirimi

/**
 * SAHİBİ: K3. Alarm çaldı: `goAsync`, arka plan iş parçacığında `cekirdek.alarmCaldi(alarmNo)`;
 * çekirdek ne gösterileceğini söyler (`null`: zaten teslim edildi, kayıt değişti ya da numara bilinmiyor
 * -> hiçbir şey gösterilmez). Süreç soğuk başlayabilir: çekirdek burada açılır.
 */
class AlarmAlici : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != EYLEM) return
        val alarmNo = intent.getLongExtra(ALARM_NO, -1L)
        val uygulama = context.applicationContext
        val bekleyen = goAsync()
        AlarmIsParcacigi.calistir(
            bitir = { bekleyen.finish() },
            hata = { Log.w(ETIKET, "alarm işlenemedi", it) },
        ) {
            AlarmCalmaIsleyici(
                caldi = { CekirdekErisimi.al(uygulama).alarmCaldi(it) },
                bildirici = Bildirimler(uygulama),
                sorunlar = TercihSorunKaydi(uygulama),
            ).isle(alarmNo)
        }
    }

    companion object {
        /** Niyet ekstrası: çekirdeğin alarm numarası (`Long`). */
        const val ALARM_NO = "alarm_no"

        /** Niyet eylemi (`AlarmPlanlayici` kurar; başka eylem yok sayılır). */
        const val EYLEM = "dev.eren.ajanda.alarm.CALDI"

        internal const val ETIKET = "AjandaAlarm"
    }
}

/** Alarm çalınca yapılacak iş (Android'den bağımsız; testte sahte çekirdek ve bildiriciyle). */
internal class AlarmCalmaIsleyici(
    private val caldi: (Long) -> HatirlatmaBildirimi?,
    private val bildirici: Bildirici,
    private val sorunlar: SorunKaydi,
) {
    enum class Sonuc { GECERSIZ_NUMARA, SUSTU, GOSTERILDI, GOSTERILEMEDI, CEKIRDEK_HATASI }

    fun isle(alarmNo: Long): Sonuc {
        if (alarmNo < 0) return Sonuc.GECERSIZ_NUMARA
        val b = try {
            caldi(alarmNo)
        } catch (t: Throwable) {
            // Çekirdek açılamadı ya da hata verdi: alarm bizimdi, sessiz kalmaktansa ayrıntısız hatırlat.
            sorunlar.cekirdekHatasi("alarm: ${t.javaClass.simpleName}")
            if (!guvenle { bildirici.ayrintisizGoster(alarmNo) }) sorunlar.gosterilemedi(emptyList())
            return Sonuc.CEKIRDEK_HATASI
        } ?: return Sonuc.SUSTU
        if (guvenle { bildirici.hatirlatmaGoster(b) }) return Sonuc.GOSTERILDI
        sorunlar.gosterilemedi(listOf(b.kayitId))
        return Sonuc.GOSTERILEMEDI
    }

    private inline fun guvenle(blok: () -> Boolean): Boolean = try {
        blok()
    } catch (e: Exception) {
        false
    }
}
