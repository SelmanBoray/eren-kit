package dev.eren.ajanda.ag

import java.util.concurrent.atomic.AtomicLong

/**
 * Süreç boyunca açılmaya başlanan soket sayısı (her bağlantı denemesi yeni bir kuşak). [BaglantiDenetcisi] her
 * soketi açarken artırır. Birleştirme akışı "Şimdi değil"i bu kuşağa bağlar: arada gözlemci olmasa da (uygulama
 * arkadaydı, aradaki boş önizleme görülmedi) yeni bir bağlantıda soru yeniden gelir. Süreç ölünce sıfırdan başlar;
 * o zaman akış da yeniden kurulur, erteleme zaten kalmaz.
 */
object BaglantiKusagi {
    private val sayac = AtomicLong()

    val simdiki: Long get() = sayac.get()

    internal fun yeni(): Long = sayac.incrementAndGet()
}
