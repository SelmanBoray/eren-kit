package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.daire
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `telefon`: çalan çevirmeli telefon (ara, telefon, görüşme, randevu al). */
internal val TelefonCizimi = cizim("telefon", LevhaRengi.KOBALT) {
    ps2("M40 40q-8 12 0 24M28 32q-14 20 0 40M200 40q8 12 0 24M212 32q14 20 0 40") // çalma
    pf("M70 136l12-48q2-8 10-8h56q8 0 10 8l12 48q2 6-4 6h-92q-6 0-4-6z") // gövde
    pd("M56 66q0-24 24-26h80q24 2 24 26v4q0 6-6 6h-18q-6 0-6-6v-8h-48v8q0 6-6 6h-18q-6 0-6-6z") // ahize
    pl(daire(120f, 110f, 22f)) // kadran
    pd(daire(120f, 110f, 7f))
}
