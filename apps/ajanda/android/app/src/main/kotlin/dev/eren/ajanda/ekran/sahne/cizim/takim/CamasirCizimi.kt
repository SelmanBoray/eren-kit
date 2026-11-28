package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.kutu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `camasir`: ipte kuruyan, damlayan tişört ve çorap (çamaşır yıka, as, topla). */
internal val CamasirCizimi = cizim("camasir", LevhaRengi.DOMATES) {
    ps2("M26 38q94 24 188 0") // ip
    pf("M86 50l-24 14 10 18 12-6v44q0 4 4 4h44q4 0 4-4V76l12 6 10-18-24-14q-6 10-24 10t-24-10z") // tişört
    pl("M166 48h16v28q0 4 4 6l8 4q6 4 3 10q-3 5-9 3l-18-8q-5-2-5-8z") // çorap
    pd(kutu(82f, 40f, 8f, 16f, 2f)) // mandallar
    pd(kutu(130f, 41f, 8f, 16f, 2f))
    pd(kutu(170f, 39f, 8f, 16f, 2f))
    pd("M100 134q4 6 4 9a4 4 0 0 1 -8 0q0-3 4-9zM122 140q4 6 4 9a4 4 0 0 1 -8 0q0-3 4-9z", alfa = 0.5f) // damlalar
}
