package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.kutu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `tamir`: anahtarı ve tornavidası taşan alet çantası (tamir, usta, montaj). */
internal val TamirCizimi = cizim("tamir", LevhaRengi.KOBALT) {
    donuk(-18f, 84f, 70f) {
        pl("M77 18a12 12 0 1 0 14 0v9h-14zM79 34h10v40h-10z") // İngiliz anahtarı
    }
    donuk(16f, 156f, 70f) {
        ps2("M156 40v30") // tornavida ucu
        pd(kutu(149f, 16f, 14f, 30f, 6f)) // tornavida sapı
    }
    ps2("M100 60v-14q0-6 6-6h28q6 0 6 6v14") // çanta sapı
    pf(kutu(54f, 60f, 132f, 76f, 9f)) // çanta
    pd("M54 82v-13q0-9 9-9h114q9 0 9 9v13z", alfa = 0.28f)
    pd(kutu(110f, 76f, 20f, 13f, 3f)) // kilit
    zemin(kutu(44f, 138f, 152f, 5f, 2.5f))
}
