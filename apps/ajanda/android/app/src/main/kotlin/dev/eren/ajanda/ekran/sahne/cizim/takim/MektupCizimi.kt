package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.daire
import dev.eren.ajanda.ekran.sahne.cizim.kutu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `mektup`: mühürlü zarf yola çıkmış, uçuyor (mektup, posta, kartpostal). */
internal val MektupCizimi = cizim("mektup", LevhaRengi.PEMBE) {
    ps2("M30 70h24M22 92h32M36 114h18") // hız çizgileri
    donuk(-8f, 132f, 88f) {
        pf(kutu(70f, 48f, 124f, 80f, 8f)) // zarf
        ps("M78 120l38-28M186 120l-38-28") // alt kıvrımlar
        pd("M76 52h112l-50 38q-6 4-12 0z", alfa = 0.28f) // kapak
        pd(daire(132f, 88f, 9f)) // mühür
    }
}
