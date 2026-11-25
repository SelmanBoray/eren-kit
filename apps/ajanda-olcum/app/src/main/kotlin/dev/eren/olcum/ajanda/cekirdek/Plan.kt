package dev.eren.olcum.ajanda.cekirdek

/**
 * Bir alarm serisinin sabit ızgarası: slot k'nın planlanan anı = bas + ofset + k * aralik.
 * Izgara deterministik olduğu için "hangi alarm hiç çalmadı" sorusu günlükten kesin yanıtlanır.
 */
data class SeriPlani(val kod: String, val aralik: Long, val ofset: Long)

data class Plan(val bas: Long, val son: Long, val seriler: List<SeriPlani>) {

    fun seri(kod: String): SeriPlani? = seriler.firstOrNull { it.kod == kod }

    fun zaman(s: SeriPlani, k: Int): Long = bas + s.ofset + k.toLong() * s.aralik

    /** Planlanan anı [son] anını aşmayan en büyük slot; hiç slot yoksa -1. */
    fun sonSlot(s: SeriPlani): Int {
        val bos = son - bas - s.ofset
        return if (bos < 0) -1 else (bos / s.aralik).toInt()
    }

    /** Planlanan anı t'den kesin büyük olan ilk slot (en az 0). */
    fun ilkSonraki(s: SeriPlani, t: Long): Int {
        val bos = t - bas - s.ofset
        if (bos < 0) return 0
        return (bos / s.aralik).toInt() + 1
    }

    /** Planlanan anı t'ye eşit ya da küçük olan son slot; yoksa -1. */
    fun sonOnceki(s: SeriPlani, t: Long): Int {
        val bos = t - bas - s.ofset
        if (bos < 0) return -1
        return (bos / s.aralik).toInt()
    }

    /** (alt, ust] aralığına düşen ve plan sonunu aşmayan slotlar. */
    fun slotlar(s: SeriPlani, altHaric: Long, ustDahil: Long): IntRange {
        val ilk = ilkSonraki(s, altHaric)
        val son = minOf(sonOnceki(s, ustDahil), sonSlot(s))
        return ilk..son
    }

    fun alanlar(): Map<String, String> = linkedMapOf(
        "bas" to bas.toString(),
        "son" to son.toString(),
        "seriler" to seriler.joinToString(",") { "${it.kod}:${it.aralik}:${it.ofset}" },
    )

    companion object {
        const val DK = 60_000L
        const val SAAT = 60 * DK

        /** Kesin alarm serisi: setExactAndAllowWhileIdle. */
        const val KESIN = "E"
        /** Çalar saat serisi: setAlarmClock (Doze'dan muaf, durum çubuğunda saat simgesi). */
        const val CALAR = "C"

        const val SURE = 72 * SAAT

        val VARSAYILAN_SERILER = listOf(
            // 15 dk: 48 saatte 192 örnek; Doze'daki "9 dakikada bir" kısıtının üstünde.
            SeriPlani(KESIN, 15 * DK, 0),
            // 3 saat: cihazı Doze'dan çıkaran setAlarmClock seyrek tutulur ki kesin serinin
            // Doze ölçümünü bozmasın; 7,5 dk kaydırılır ki iki seri aynı ana düşmesin.
            SeriPlani(CALAR, 3 * SAAT, 7 * DK + 30_000),
        )

        /** Başlangıç bir sonraki tam dakikadan 2 dk sonra. */
        fun varsayilan(simdi: Long): Plan {
            val bas = (simdi / DK + 1) * DK + 2 * DK
            return Plan(bas, bas + SURE, VARSAYILAN_SERILER)
        }

        fun ayristir(o: Olay): Plan? {
            val bas = o.sayi("bas") ?: return null
            val son = o.sayi("son") ?: return null
            val ser = o.metin("seriler") ?: return null
            val liste = ser.split(',').mapNotNull { p ->
                val q = p.split(':')
                if (q.size != 3) return@mapNotNull null
                val a = q[1].toLongOrNull() ?: return@mapNotNull null
                val f = q[2].toLongOrNull() ?: return@mapNotNull null
                if (a <= 0) null else SeriPlani(q[0], a, f)
            }
            if (liste.isEmpty()) return null
            return Plan(bas, son, liste)
        }
    }
}
