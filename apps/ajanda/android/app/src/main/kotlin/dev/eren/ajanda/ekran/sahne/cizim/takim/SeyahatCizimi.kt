package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.daire
import dev.eren.ajanda.ekran.sahne.cizim.kutu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `seyahat`: çekilen tekerlekli bavul, üstünden geçen uçak (seyahat, uçuş, otel, bavul). */
internal val SeyahatCizimi = cizim("seyahat", LevhaRengi.GOK) {
    zemin(kutu(56f, 138f, 128f, 6f, 3f))
    donuk(-8f, 120f, 130f) {
        ps2("M106 46V20h28v26") // çekme kolu
        pd(daire(96f, 134f, 7f)) // tekerler
        pd(daire(144f, 134f, 7f))
        pf(kutu(78f, 44f, 84f, 88f, 12f)) // gövde
        pd(kutu(98f, 44f, 10f, 88f), alfa = 0.28f) // kayışlar
        pd(kutu(132f, 44f, 10f, 88f), alfa = 0.28f)
    }
    donuk(-16f, 187f, 34f) { // kalkan uçak
        pf("M166 34q0-4 4-4h32q6 0 6 4t-6 4h-32q-4 0-4-4z")
        pf("M186 31l-10-15h7l15 15zM186 37l-10 15h7l15-15zM172 31l-5-8h5l7 8zM172 37l-5 8h5l7-8z")
    }
}
