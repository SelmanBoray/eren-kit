package dev.eren.olcum.ajanda.cekirdek

object Istatistik {
    /** Ortanca; çift sayıda ögede iki ortadakinin ortalaması (aşağı yuvarlanmış). */
    fun ortanca(d: List<Long>): Long? {
        if (d.isEmpty()) return null
        val s = d.sorted()
        val m = s.size / 2
        return if (s.size % 2 == 1) s[m] else Math.floorDiv(s[m - 1] + s[m], 2L)
    }

    /** En yakın sıra yöntemiyle yüzdelik (p 0..100). */
    fun yuzdelik(d: List<Long>, p: Int): Long? {
        if (d.isEmpty()) return null
        val s = d.sorted()
        val sira = Math.ceil(p / 100.0 * s.size).toInt().coerceIn(1, s.size)
        return s[sira - 1]
    }
}

/** Gecikme dağılımı. Kovalar: ≤10 sn, ≤1 dk, ≤5 dk, ≤15 dk, >15 dk (negatif ilk kovaya). */
data class GecikmeIst(
    val n: Int,
    val ortanca: Long?,
    val p95: Long?,
    val enKotu: Long?,
    val kovalar: List<Int>,
) {
    companion object {
        val SINIRLAR = listOf(10_000L, 60_000L, 5 * 60_000L, 15 * 60_000L)
        val KOVA_ADLARI = listOf("≤10sn", "≤1dk", "≤5dk", "≤15dk", ">15dk")

        fun hesapla(d: List<Long>): GecikmeIst {
            val k = IntArray(SINIRLAR.size + 1)
            for (x in d) {
                val i = SINIRLAR.indexOfFirst { x <= it }
                k[if (i < 0) SINIRLAR.size else i]++
            }
            return GecikmeIst(
                d.size,
                Istatistik.ortanca(d),
                Istatistik.yuzdelik(d, 95),
                d.maxOrNull(),
                k.toList(),
            )
        }
    }
}
