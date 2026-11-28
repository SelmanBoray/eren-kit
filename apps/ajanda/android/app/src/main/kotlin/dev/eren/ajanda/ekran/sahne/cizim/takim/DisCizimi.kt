package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.Canlanma
import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `dis`: pırıl pırıl azı dişi. Kaynak: `tasarim/cizim/dis.svg` (prototip). */
internal val DisCizimi = cizim("dis", LevhaRengi.PEMBE) {
    pf("M84 36q18-14 36-2 18-12 36 2 16 14 6 46-6 18-9 40-3 16-12 2-6-22-21-22t-21 22q-9 14-12-2-3-22-9-40-10-32 6-46z")
    ps("M97 54q-7 9-3 24")
    pf("M192 28q2 11 13 13-11 2-13 13-2-11-13-13 11-2 13-13z", canli = Canlanma.PIRILTI)
    pf("M50 88q1.5 7 8 8-6.5 1-8 8-1.5-7-8-8 6.5-1 8-8z", canli = Canlanma.PIRILTI)
}
