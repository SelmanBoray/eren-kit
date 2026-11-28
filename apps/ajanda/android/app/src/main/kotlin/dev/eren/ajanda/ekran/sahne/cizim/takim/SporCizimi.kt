package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.kutu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `spor`: koşan spor ayakkabısı (spor, antrenman, koşu, maç). */
internal val SporCizimi = cizim("spor", LevhaRengi.KOBALT) {
    ps2("M26 74h20M20 94h28M30 114h16") // hız çizgileri
    pf("M64 118V68q0-10 10-10h20q10 0 14 10q6 14 20 14h8l44 12q26 8 26 24z") // üst
    pd(kutu(58f, 60f, 12f, 26f, 5f)) // topuk kulağı
    pd("M178 96q28 6 28 22h-38q-2-14 10-22z", alfa = 0.28f) // burun
    ps2("M116 74l10-6M128 80l10-6M140 84l10-6") // bağcık
    pl(kutu(58f, 114f, 154f, 16f, 8f)) // taban
}
