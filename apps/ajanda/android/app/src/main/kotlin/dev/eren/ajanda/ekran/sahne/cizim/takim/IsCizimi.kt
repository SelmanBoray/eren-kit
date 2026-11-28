package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.Canlanma
import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `is`: kıskaçlı pano, imza atan kalem (vardiya, mesai, iş yeri). Kaynak: `tasarim/cizim/imza.svg` (prototip). */
internal val IsCizimi = cizim("is", LevhaRengi.CAM) {
    pf("M82 20h76a12 12 0 0 1 12 12v104a12 12 0 0 1 -12 12h-76a12 12 0 0 1 -12 -12v-104a12 12 0 0 1 12 -12z") // pano
    pl("M85 36h70a5 5 0 0 1 5 5v92a5 5 0 0 1 -5 5h-70a5 5 0 0 1 -5 -5v-92a5 5 0 0 1 5 -5z") // kağıt
    pd("M107 12h26a7 7 0 0 1 7 7v6a7 7 0 0 1 -7 7h-26a7 7 0 0 1 -7 -7v-6a7 7 0 0 1 7 -7z") // kıskaç
    pb2("M93 52h52a3 3 0 0 1 3 3v0a3 3 0 0 1 -3 3h-52a3 3 0 0 1 -3 -3v-0a3 3 0 0 1 3 -3z")
    pb2("M93 68h34a3 3 0 0 1 3 3v0a3 3 0 0 1 -3 3h-34a3 3 0 0 1 -3 -3v-0a3 3 0 0 1 3 -3z")
    pb2("M93 84h44a3 3 0 0 1 3 3v0a3 3 0 0 1 -3 3h-44a3 3 0 0 1 -3 -3v-0a3 3 0 0 1 3 -3z")
    imza("M90 124q7-20 13-5 4 11 10-6 4-11 8 4 3 9 9-2 5-9 9 2 3 6 9 0")
    pd("M189 69l10 10-34 34-13 3 3-13z", canli = Canlanma.KALEM)
}
