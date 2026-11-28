package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.Canlanma
import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `kahve`: buharı tüten fincan (kahve, çay, kahvaltı). Kaynak: `tasarim/cizim/fincan.svg` (prototip). */
internal val KahveCizimi = cizim("kahve", LevhaRengi.HARDAL) {
    ps2("M100 46q-8-10 0-22M126 46q-8-10 0-22", canli = Canlanma.BUHAR)
    pf("M68 62h104v32q0 36-36 36h-32q-36 0-36-36z")
    ps2("M172 74h6q16 0 16 15t-16 15h-8") // kulp
    pd("M60 136h120a4 4 0 0 1 4 4v0a4 4 0 0 1 -4 4h-120a4 4 0 0 1 -4 -4v-0a4 4 0 0 1 4 -4z") // tabak
}
