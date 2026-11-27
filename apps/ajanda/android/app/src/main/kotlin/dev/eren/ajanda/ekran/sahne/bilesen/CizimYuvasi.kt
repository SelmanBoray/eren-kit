package dev.eren.ajanda.ekran.sahne.bilesen

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import dev.eren.ajanda.ekran.sahne.tema.Simgeler

/**
 * Çizim anahtarından levhanın çizim yuvası. BAĞLANACAK YER: çizim takımı (`ekran/sahne/cizim/`) hazır
 * olunca bu işlevin gövdesi `{ d -> KayitCizimi(anahtar, d.boyama, d.takim, d.canli) }` olur ve anahtar
 * boşsa takımın varsayılanı kullanılır. O zamana dek yer tutucu simge ([LevhaFiguru]) çizilir.
 */
fun cizimYuvasi(anahtar: String?): LevhaCizimYuvasi {
    val simge = yerTutucuSimge(anahtar)
    return { d -> LevhaFiguru(simge, d.takim, d.boyama, Modifier.fillMaxSize()) }
}

private val YUVALAR = HashMap<String?, LevhaCizimYuvasi>()

/** Aynı anahtar için aynı nesne (yeniden çizimde yuva değişmiş sayılmasın). */
fun cizimYuvasiOnbellekli(anahtar: String?): LevhaCizimYuvasi = YUVALAR.getOrPut(anahtar) { cizimYuvasi(anahtar) }

private fun yerTutucuSimge(anahtar: String?): ImageVector = when (anahtar) {
    "fincan" -> Simgeler.Fincan
    "dis" -> Simgeler.Dis
    "sepet" -> Simgeler.Sepet
    "kutu" -> Simgeler.Kutu
    "ilac" -> Simgeler.Ilac
    "fatura" -> Simgeler.Fatura
    "imza" -> Simgeler.Imza
    "cadir" -> Simgeler.Cadir
    "zil" -> Simgeler.Zil
    else -> Simgeler.Yildiz
}
