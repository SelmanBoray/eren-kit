package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.Canlanma
import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.daire
import dev.eren.ajanda.ekran.sahne.cizim.kutu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `banka`: çarklı kasa, parlayan (banka, hesap, kredi). */
internal val BankaCizimi = cizim("banka", LevhaRengi.CAM) {
    pd(kutu(58f, 36f, 14f, 22f, 4f)) // üst menteşe
    pd(kutu(58f, 94f, 14f, 22f, 4f)) // alt menteşe
    pd(kutu(80f, 122f, 20f, 18f, 4f)) // ayaklar
    pd(kutu(140f, 122f, 20f, 18f, 4f))
    pf(kutu(64f, 18f, 112f, 112f, 14f)) // gövde
    pd(kutu(78f, 32f, 84f, 84f, 10f), alfa = 0.16f) // kapak
    ps2(daire(120f, 74f, 22f) + "M120 44v60M94 59l52 30M94 89l52-30") // çark
    pd(daire(120f, 74f, 9f))
    pf("M196 22q2 11 13 13-11 2-13 13-2-11-13-13 11-2 13-13z", canli = Canlanma.PIRILTI)
}
