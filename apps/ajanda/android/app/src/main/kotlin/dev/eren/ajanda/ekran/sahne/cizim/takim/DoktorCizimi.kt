package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.daire
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `doktor`: steteskop (doktor, muayene, hastane, kontrol). */
internal val DoktorCizimi = cizim("doktor", LevhaRengi.KUM) {
    ps2("M68 26v24q0 22 24 22t24-22v-24M92 72v22q0 36 32 36t32-34") // hortum
    pd(daire(68f, 22f, 7f)) // kulaklıklar
    pd(daire(116f, 22f, 7f))
    pf(daire(156f, 72f, 22f)) // göğüs başlığı
    pl(daire(156f, 72f, 12f))
}
