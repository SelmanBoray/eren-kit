package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.daire
import dev.eren.ajanda.ekran.sahne.cizim.kutu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `sac`: tarak ve açık makas (kuaför, berber, saç kesimi). */
internal val SacCizimi = cizim("sac", LevhaRengi.PEMBE) {
    pd(kutu(56f, 120f, 128f, 10f, 5f), alfa = 0.5f) // tarak
    ps2("M66 132v8M80 132v8M94 132v8M108 132v8M122 132v8M136 132v8M150 132v8M164 132v8M176 132v8")
    donuk(-18f, 128f, 76f) {
        pf("M84 76q0-7 7-7h45l70 5q4 2 0 4l-70 5h-45q-7 0-7-7z")
        ps2(daire(70f, 76f, 13f))
    }
    donuk(18f, 128f, 76f) {
        pf("M84 76q0-7 7-7h45l70 5q4 2 0 4l-70 5h-45q-7 0-7-7z")
        ps2(daire(70f, 76f, 13f))
    }
    pd(daire(128f, 76f, 5f)) // vida
}
