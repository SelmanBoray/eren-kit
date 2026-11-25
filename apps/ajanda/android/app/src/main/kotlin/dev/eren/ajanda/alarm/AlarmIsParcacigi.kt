package dev.eren.ajanda.alarm

import java.util.concurrent.Executor
import java.util.concurrent.Executors

/**
 * Alıcıların çekirdek işi için tek arka plan iş parçacığı (çekirdek çağrıları ana iş parçacığında
 * yapılmaz). Sıralı: açılışta yeniden kurulum ile o sırada çalan alarm üst üste binmez.
 * `bitir` (alıcıda `PendingResult.finish`) iş başarısız da olsa her zaman çağrılır.
 */
internal object AlarmIsParcacigi {
    private val yurutucu: Executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "ajanda-alarm").apply { isDaemon = true }
    }

    fun calistir(bitir: () -> Unit, hata: (Throwable) -> Unit = {}, is_: () -> Unit) =
        calistir(yurutucu, bitir, hata, is_)

    /** Test: eşzamanlı yürütücüyle. */
    fun calistir(yurutucu: Executor, bitir: () -> Unit, hata: (Throwable) -> Unit, is_: () -> Unit) {
        try {
            yurutucu.execute {
                try {
                    is_()
                } catch (t: Throwable) {
                    hata(t)
                } finally {
                    bitir()
                }
            }
        } catch (t: Throwable) {
            // Yürütücü reddetti: yayını açık bırakma.
            hata(t)
            bitir()
        }
    }
}
