package dev.eren.ajanda.ag

import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicInteger

/**
 * Bir `EsitlemeIsi` çalışmasının mantığı (Android'siz, birim testli): oturum aç (bağlan, eşitlen, kuyruğu
 * boşalt, kapat) -> alarmları yeniden kurdur -> işi bitir. Alarm işi [yurutucu]'de yapılır (ne ana iş
 * parçacığı ne bağlantı yöneticisininki). Sistem durdurursa ([durdur]) bağlantı bırakılır, iş bitirilmez.
 */
class ArkaPlanEsitleme(
    private val oturumAc: ((ArkaPlanSonucu) -> Unit) -> Iptal,
    private val alarmlariKur: () -> Unit,
    private val yurutucu: Executor,
    private val bitir: (ArkaPlanSonucu) -> Unit,
    private val gunluk: Gunluk,
) {
    private val durum = AtomicInteger(SURUYOR)

    @Volatile
    private var iptal: Iptal? = null

    fun baslat() {
        iptal = oturumAc { sonuc -> yurutucu.execute { oturumBitti(sonuc) } }
    }

    /** `onStopJob`: döner `true` = iş henüz bitmemişti (sistem yeniden planlasın). */
    fun durdur(): Boolean {
        val surdu = durum.compareAndSet(SURUYOR, DURDURULDU)
        iptal?.iptal()
        return surdu
    }

    private fun oturumBitti(sonuc: ArkaPlanSonucu) {
        if (durum.get() != SURUYOR) return
        // Sonuç ne olursa olsun: PC'ye ulaşılamasa da kaçırılan/yeniden kurulacak alarmlar telefonda.
        try {
            alarmlariKur()
        } catch (e: Exception) {
            gunluk.uyari("alarmlar yeniden kurulamadı", e)
        }
        if (durum.compareAndSet(SURUYOR, BITTI)) bitir(sonuc)
    }

    private companion object {
        const val SURUYOR = 0
        const val BITTI = 1
        const val DURDURULDU = 2
    }
}
