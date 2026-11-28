package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.daire
import dev.eren.ajanda.ekran.sahne.cizim.kutu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `evcil`: tasmalı kedi mama kabının başında (veteriner, mama, kediyi besle). */
internal val EvcilCizimi = cizim("evcil", LevhaRengi.GECE) {
    pf("M74 132q-26 2-30-18q-2-12 8-16q4-1 5 3q1 3-2 5q-5 3-3 10q3 8 22 8z") // kuyruk
    pf("M64 136q-4-36 20-58q6-6 20-6t20 6q24 22 20 58z") // gövde
    pf("M82 58q0-12 2-16l-2-22 16 12q6-2 12 0l16-12-2 22q2 4 2 16q0 22-22 22t-22-22z") // baş
    pd(kutu(88f, 76f, 32f, 7f, 3.5f)) // tasma
    pl(daire(104f, 88f, 4.5f)) // künye
    pf("M166 120q22-16 42 0z") // mama
    pl("M160 118h54l-6 16q-1 3-5 3h-32q-4 0-5-3z") // kap
}
