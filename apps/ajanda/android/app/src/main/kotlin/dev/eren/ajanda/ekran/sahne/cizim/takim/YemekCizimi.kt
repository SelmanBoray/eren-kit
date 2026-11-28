package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.Canlanma
import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.kutu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `yemek`: kapağı kalkmış, buharı tüten tencere (yemek yap, akşam yemeği). */
internal val YemekCizimi = cizim("yemek", LevhaRengi.KUM) {
    ps2("M188 62q-8-10 0-22M204 70q-8-10 0-20", canli = Canlanma.BUHAR)
    zemin(kutu(46f, 138f, 148f, 5f, 2.5f))
    pd(kutu(44f, 88f, 24f, 10f, 5f)) // kulplar
    pd(kutu(172f, 88f, 24f, 10f, 5f))
    pf("M62 80h116v34q0 22-22 22H84q-22 0-22-22z") // tencere
    ps3("M78 94v22")
    pd(kutu(56f, 74f, 128f, 10f, 5f)) // ağız
    donuk(-10f, 64f, 66f) {
        pf("M64 66q0-24 56-24t56 24z") // kapak
        pd(kutu(110f, 32f, 20f, 10f, 5f))
    }
}
