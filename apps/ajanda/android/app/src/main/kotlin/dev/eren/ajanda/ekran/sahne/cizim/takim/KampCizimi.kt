package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `kamp`: ay ışığında çadır (kamp, gezi, yürüyüş). Kaynak: `tasarim/cizim/cadir.svg` (prototip). */
internal val KampCizimi = cizim("kamp", LevhaRengi.GECE) {
    pf("M167 42a15 15 0 1 0 30 0a15 15 0 1 0 -30 0z") // ay
    pl("M36 134l84-100 84 100z")
    pd("M120 34l-24 100h48z", alfa = 0.8f) // kapı
    pd("M27 132h186a3 3 0 0 1 3 3v0a3 3 0 0 1 -3 3h-186a3 3 0 0 1 -3 -3v-0a3 3 0 0 1 3 -3z")
}
