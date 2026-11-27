package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.kutu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `okul`: cebinden kalem çıkan okul çantası (okul, ders, sınav, veli toplantısı). */
internal val OkulCizimi = cizim("okul", LevhaRengi.HARDAL) {
    ps2("M106 30q14-16 28 0") // sap
    pf(kutu(72f, 26f, 96f, 114f, 24f)) // gövde
    pd("M72 50q0-24 24-24h48q24 0 24 24v24q0 10-10 10h-76q-10 0-10-10z", alfa = 0.28f) // kapak
    pd(kutu(112f, 76f, 16f, 16f, 4f)) // toka
    donuk(14f, 146f, 100f) {
        pd(kutu(139f, 72f, 14f, 36f, 2f), alfa = 0.8f) // kalem
        pl("M139 72l7-14 7 14z")
    }
    pl(kutu(88f, 102f, 64f, 30f, 10f)) // ön cep
}
