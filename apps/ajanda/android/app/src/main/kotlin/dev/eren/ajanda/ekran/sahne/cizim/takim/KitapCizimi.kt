package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `kitap`: ayraçlı açık kitap (kitap, okuma, kütüphane, ödev). */
internal val KitapCizimi = cizim("kitap", LevhaRengi.GECE) {
    pf("M164 120v22l7-6 7 6v-24z") // ayraç
    pf("M28 52q46-14 92 2q46-16 92-2v78q-46-12-92 4q-46-16-92-4z") // kapak
    pl("M38 46q42-10 78 6v74q-36-14-78-8z") // sol sayfa
    pl("M124 52q36-16 78-6v72q-42-6-78 8z") // sağ sayfa
    ps("M52 66q22-5 50 2M52 82q22-5 50 2M52 98q22-5 36 2M138 68q22-7 50-2M138 84q22-7 50-2M138 100q22-7 30-1") // satırlar
}
