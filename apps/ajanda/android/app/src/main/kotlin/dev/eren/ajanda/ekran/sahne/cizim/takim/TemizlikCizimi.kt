package dev.eren.ajanda.ekran.sahne.cizim.takim

import dev.eren.ajanda.ekran.sahne.cizim.Canlanma
import dev.eren.ajanda.ekran.sahne.cizim.cizim
import dev.eren.ajanda.ekran.sahne.cizim.kutu
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/** `temizlik`: sıkılan sprey şişesi, püskürttüğü yer pırıl pırıl (temizlik, silme, ev işi). */
internal val TemizlikCizimi = cizim("temizlik", LevhaRengi.HARDAL) {
    ps("M76 32l-10-6M74 42h-12M76 52l-10 6") // püskürtme
    pf("M52 26q2 11 13 13-11 2-13 13-2-11-13-13 11-2 13-13z", canli = Canlanma.PIRILTI)
    pf("M60 70q1.5 7 8 8-6.5 1-8 8-1.5-7-8-8 6.5-1 8-8z", canli = Canlanma.PIRILTI)
    ps2("M112 48q-9 9-5 19") // tetik
    pd(kutu(108f, 54f, 26f, 14f, 3f)) // boyun
    pf("M92 84q0-14 14-18h30q14 4 14 18v48q0 8-8 8h-42q-8 0-8-8z") // şişe
    pl(kutu(104f, 88f, 34f, 32f, 6f)) // etiket
    pd("M86 30h50q12 0 14 14l2 12h-38v-14h-28q-4 0-4-4v-4q0-4 4-4z") // başlık
}
