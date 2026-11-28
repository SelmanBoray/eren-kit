package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.Canlanma
import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `ilac`: eğik kapsül ve parlayan eczane artısı. Kaynak: `tasarim/cizim/ilac.svg` (prototip). */
internal val IlacCizimi = cizim("ilac", LevhaRengi.GOK) {
    donuk(-32f, 120f, 84f) {
        pl("M82 58h76a26 26 0 0 1 26 26v0a26 26 0 0 1 -26 26h-76a26 26 0 0 1 -26 -26v-0a26 26 0 0 1 26 -26z")
        pf("M120 58h38a26 26 0 0 1 0 52h-38z")
        pd("M77.5 68h27a3.5 3.5 0 0 1 3.5 3.5v0a3.5 3.5 0 0 1 -3.5 3.5h-27a3.5 3.5 0 0 1 -3.5 -3.5v-0a3.5 3.5 0 0 1 3.5 -3.5z", alfa = 0.16f)
    }
    pf("M190 22h10v10h10v10h-10v10h-10V42h-10V32h10z", canli = Canlanma.PIRILTI) // eczane artısı
}
