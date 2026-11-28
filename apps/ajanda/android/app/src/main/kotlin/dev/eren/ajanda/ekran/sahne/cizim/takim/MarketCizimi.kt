package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `market`: dolu alışveriş sepeti. Kaynak: `tasarim/cizim/sepet.svg` (prototip). */
internal val MarketCizimi = cizim("market", LevhaRengi.HARDAL) {
    donuk(-14f, 101f, 64f) {
        pl("M101 28h0a9 9 0 0 1 9 9v54a9 9 0 0 1 -9 9h-0a9 9 0 0 1 -9 -9v-54a9 9 0 0 1 9 -9z") // ekmek
    }
    pd("M132 88V52q0-6 4-9v-10h10v10q4 3 4 9v36z") // şişe
    pl("M155 72a13 13 0 1 0 26 0a13 13 0 1 0 -26 0z")
    ps2("M82 84q38-60 76 0") // sap
    pf("M62 84h116l-11 46q-2 10-12 10H85q-10 0-12-10z")
    pd("M62.5 78h115a6.5 6.5 0 0 1 6.5 6.5v0a6.5 6.5 0 0 1 -6.5 6.5h-115a6.5 6.5 0 0 1 -6.5 -6.5v-0a6.5 6.5 0 0 1 6.5 -6.5z")
    ps3("M96 102v26M120 102v26M144 102v26")
}
