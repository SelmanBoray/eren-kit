package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `araba`: köpükler arasında araba (yıkama, muayene, lastik). Kaynak: `tasarim/cizim/araba.svg` (prototip). */
internal val ArabaCizimi = cizim("araba", LevhaRengi.KOBALT) {
    zemin("M22.5 137h195a2.5 2.5 0 0 1 2.5 2.5v0a2.5 2.5 0 0 1 -2.5 2.5h-195a2.5 2.5 0 0 1 -2.5 -2.5v-0a2.5 2.5 0 0 1 2.5 -2.5z")
    kopuk("M41 52a9 9 0 1 0 18 0a9 9 0 1 0 -18 0z")
    kopuk("M63 34a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z")
    kopuk("M183 42a7 7 0 1 0 14 0a7 7 0 1 0 -14 0z")
    kopuk("M202 62a4 4 0 1 0 8 0a4 4 0 1 0 -8 0z")
    kopuk("M116 24a6 6 0 1 0 12 0a6 6 0 1 0 -12 0z")
    // gövde
    pf("M28 118v-16q0-11 11-13l24-5 21-27q6-8 16-8h46q10 0 16 8l20 27 21 5q11 3 11 14v15q0 6-6 6H34q-6 0-6-6z")
    pl("M93 82l14-19q3-4 8-4h11v23z")
    pl("M134 59h10q5 0 8 4l14 19h-32z")
    pd("M140 92h10a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-0a2 2 0 0 1 2 -2z")
    pl("M204 94h4a3 3 0 0 1 3 3v3a3 3 0 0 1 -3 3h-4a3 3 0 0 1 -3 -3v-3a3 3 0 0 1 3 -3z")
    pd("M30 96h2a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2z")
    // tekerler
    pd("M61 122a17 17 0 1 0 34 0a17 17 0 1 0 -34 0z")
    pl("M71.5 122a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0z")
    pd("M153 122a17 17 0 1 0 34 0a17 17 0 1 0 -34 0z")
    pl("M163.5 122a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0z")
}
