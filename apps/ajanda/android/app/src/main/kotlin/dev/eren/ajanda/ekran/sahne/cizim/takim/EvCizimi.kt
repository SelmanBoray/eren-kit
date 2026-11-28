package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.Canlanma
import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.kutu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `ev`: bacası tüten, penceresi yanan ev (ev, taşınma, kira evi, misafir). */
internal val EvCizimi = cizim("ev", LevhaRengi.DOMATES) {
    ps2("M152 30q-8-8 0-16", canli = Canlanma.BUHAR) // duman
    pd(kutu(144f, 36f, 16f, 34f, 2f)) // baca
    pf(kutu(70f, 76f, 100f, 60f, 4f)) // duvar
    pd("M56 78l58-44q6-4 12 0l58 44q6 6-2 8H58q-8-2-2-8z") // çatı
    pd(kutu(82f, 96f, 32f, 28f, 5f)) // pencere
    pl(kutu(86f, 100f, 11f, 9f, 2f) + kutu(99f, 100f, 11f, 9f, 2f) + kutu(86f, 111f, 11f, 9f, 2f) + kutu(99f, 111f, 11f, 9f, 2f))
    pd("M128 136v-24q0-12 12-12t12 12v24z") // kapı
    zemin(kutu(44f, 135f, 152f, 6f, 3f))
}
