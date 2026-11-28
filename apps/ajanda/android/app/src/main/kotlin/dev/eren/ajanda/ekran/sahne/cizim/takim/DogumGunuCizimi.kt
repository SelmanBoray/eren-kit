package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.Canlanma
import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.kutu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `dogum_gunu`: mumları yanan pasta (doğum günü, kutlama, parti). */
internal val DogumGunuCizimi = cizim("dogum_gunu", LevhaRengi.PEMBE) {
    ps2("M96 58v18M120 52v24M144 58v18") // mumlar
    pf("M96 36q9 10 0 17q-9-7 0-17z", canli = Canlanma.PIRILTI) // alevler
    pf("M120 30q9 10 0 17q-9-7 0-17z", canli = Canlanma.PIRILTI)
    pf("M144 36q9 10 0 17q-9-7 0-17z", canli = Canlanma.PIRILTI)
    pf(kutu(62f, 78f, 116f, 54f, 10f)) // pasta
    pd("M62 88q0-10 10-10h96q10 0 10 10v6q-7 10-14.5 0t-14.5 0-14.5 0-14.5 0-14.5 0-14.5 0-14.5 0-14.5 0z", alfa = 0.28f) // krema
    pd(kutu(48f, 128f, 144f, 10f, 5f)) // tabak
}
