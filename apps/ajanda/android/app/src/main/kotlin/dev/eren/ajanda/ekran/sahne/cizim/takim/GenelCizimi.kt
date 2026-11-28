package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `genel`: güneş; eşleşme yoksa ve çizimi henüz yapılmamış anahtarlarda çizilir. Kaynak: `tasarim/cizim/yildiz.svg` (prototip). */
internal val GenelCizimi = cizim("genel", LevhaRengi.KUM) {
    pf("M86 80a34 34 0 1 0 68 0a34 34 0 1 0 -68 0z")
    ps2("M120 22v14M120 124v14M62 80h14M164 80h14M79 39l10 10M151 111l10 10M79 121l10-10M151 49l10-10")
}
