package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.daire
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `eglence`: taşan, patlayan mısır kutusu (sinema, konser, eğlence). */
internal val EglenceCizimi = cizim("eglence", LevhaRengi.DOMATES) {
    kopuk(daire(56f, 46f, 6f))
    kopuk(daire(120f, 17f, 5f))
    kopuk(daire(186f, 36f, 7f))
    kopuk(daire(200f, 62f, 4.5f))
    pl("M72 70q-8-18 10-22q0-16 18-14q6-14 22-6q12-12 24 0q18-6 20 12q18 2 14 22q6 4 4 8z") // mısırlar
    pf("M68 66h104l-13 70q-1 4-5 4H86q-4 0-5-4z") // kutu
    pb2("M89 66h21l2.4 74h-14zM130 66h21l-8.6 74h-14z") // şeritler
}
