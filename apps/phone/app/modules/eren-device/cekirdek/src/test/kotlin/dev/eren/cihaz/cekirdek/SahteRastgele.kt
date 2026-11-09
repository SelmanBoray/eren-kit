package dev.eren.cihaz.cekirdek

import java.util.Random

/** Tohumlu, tekrarlanabilir rastgelelik. `siradaki` ile verilen hazır yanıtlar önce tüketilir. */
class SahteRastgele(tohum: Long = 1L) : RastgelePortu {
    private val kilit = Any()
    private val uretec = Random(tohum)
    private val hazir = ArrayDeque<ByteArray>()
    private val istenenler = ArrayList<Int>()

    /** Her `baytlar` çağrısının istediği adet, sırayla. */
    val istekler: List<Int> get() = synchronized(kilit) { ArrayList(istenenler) }

    /** Sonraki çağrılar için hazır yanıtlar; boyut uymazsa `baytlar` hata atar (test hatasıdır). */
    fun siradaki(vararg yanit: ByteArray) {
        synchronized(kilit) { yanit.forEach { hazir.addLast(it.copyOf()) } }
    }

    override fun baytlar(adet: Int): ByteArray = synchronized(kilit) {
        istenenler.add(adet)
        val h = hazir.removeFirstOrNull()
        if (h != null) {
            check(h.size == adet) { "SahteRastgele: hazır yanıt ${h.size} bayt, istenen $adet" }
            h
        } else {
            ByteArray(adet).also { uretec.nextBytes(it) }
        }
    }
}
