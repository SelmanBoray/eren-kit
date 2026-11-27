package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `kargo`: bantlı koli. Kaynak: `tasarim/cizim/kutu.svg` (prototip). */
internal val KargoCizimi = cizim("kargo", LevhaRengi.DOMATES) {
    pf("M64 62l56-24 56 24v60l-56 24-56-24z")
    pd("M120 86v60l56-24V62z", alfa = 0.28f) // sağ yüz gölgesi
    pl("M64 62l56 24 56-24-56-24z") // kapak
    pd("M88 51.7l56 24v18l8-3.4v-18l-56-24z", alfa = 0.5f) // bant
}
