package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `fatura`: şimşekli fatura fişi (fatura, kira, aidat). Kaynak: `tasarim/cizim/fatura.svg` (prototip). */
internal val FaturaCizimi = cizim("fatura", LevhaRengi.GECE) {
    pl("M78 18h84v122l-14-9-14 9-14-9-14 9-14-9-14 9z") // tırtıklı fiş
    pf("M127 40l-24 36h17l-9 32 28-40h-17z") // şimşek
}
