package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.kutu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `bitki`: üstüne su damlayan saksı çiçeği (çiçekleri sula, fide, bahçe). */
internal val BitkiCizimi = cizim("bitki", LevhaRengi.GOK) {
    pd("M64 18q6 9 6 13a6 6 0 0 1 -12 0q0-4 6-13zM84 34q5 8 5 11a5 5 0 0 1 -10 0q0-3 5-11zM58 50q5 8 5 11a5 5 0 0 1 -10 0q0-3 5-11z", alfa = 0.5f)
    pf(kutu(117f, 50f, 6f, 50f, 3f)) // sap
    pf("M118 84q-38 4-46-28q36-6 46 28z")
    pf("M122 70q32-2 42-30q-36-4-42 30z")
    pf("M120 54q-15-17 0-38q15 21 0 38z")
    ps3("M114 80q-18-6-32-20M126 66q14-6 30-20")
    pd("M90 104h60l-7 32q-1 4-5 4h-36q-4 0-5-4z", alfa = 0.8f) // saksı
    pd(kutu(84f, 96f, 72f, 12f, 4f))
}
