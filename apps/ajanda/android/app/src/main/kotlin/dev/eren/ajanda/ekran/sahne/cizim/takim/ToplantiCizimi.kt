package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.daire
import dev.eren.ajanda.ekran.sahne.cizim.kutu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `toplanti`: masanın ardında üç kişi, ortadaki konuşuyor (toplantı, görüşme). */
internal val ToplantiCizimi = cizim("toplanti", LevhaRengi.CAM) {
    pf(daire(68f, 66f, 12f) + "M46 106q0-26 22-26t22 26z")
    pf(daire(172f, 66f, 12f) + "M150 106q0-26 22-26t22 26z")
    pf(daire(120f, 58f, 14f) + "M94 106q0-30 26-30t26 30z")
    pl("M144 18h46q8 0 8 8v12q0 8-8 8h-30l-12 8 2-8q-6 0-6-8v-12q0-8 8-8z") // konuşma balonu
    pd(daire(158f, 32f, 3.5f) + daire(170f, 32f, 3.5f) + daire(182f, 32f, 3.5f))
    ps2("M56 116v22M184 116v22") // masa ayakları
    pd(kutu(34f, 104f, 172f, 12f, 6f)) // masa
}
