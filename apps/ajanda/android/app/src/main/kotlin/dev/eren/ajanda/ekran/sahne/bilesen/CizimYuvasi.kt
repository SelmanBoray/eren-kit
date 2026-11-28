package dev.eren.ajanda.ekran.sahne.bilesen

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import dev.eren.ajanda.ekran.sahne.cizim.KayitCizimi
import dev.eren.ajanda.ekran.sahne.cizim.cizimAnahtari

/**
 * Çizim anahtarından levhanın çizim yuvası: kaydın gerçek çizimi ([KayitCizimi], SAHNE.md §7). Yuva verilen
 * alanı (levhanın "çizim kutusu", §3.2) doldurur; çizim 240 × 160 kutusunu oraya ortalayarak sığdırır.
 *
 * - Boyama ([LevhaCizimi.boyama]): taslakta 0 (karakalem), onayda 0 → 1 (§5.4), açık levhada 1.
 * - Canlı parçalar ([LevhaCizimi.canli]) yalnız çağıran açtığında oynar (Bugün'de büyük levha, §5.15);
 *   hareket azaltılmışsa ya da çizim görünmüyorsa `KayitCizimi` kendisi durdurur.
 * - Köpük patlaması ([LevhaCizimi.patlama]) tamamlama anında sürülür (§5.2).
 *
 * Bilinmeyen ya da boş anahtar `genel` çizer.
 */
fun cizimYuvasi(anahtar: String?): LevhaCizimYuvasi {
    val a = cizimAnahtari(anahtar)
    return { d ->
        KayitCizimi(
            anahtar = a,
            ilerleme = d.boyama,
            takim = d.takim,
            canli = d.canli,
            modifier = Modifier.fillMaxSize(),
            patlama = d.patlama,
            imzaOynasin = d.imzaOynasin,
        )
    }
}

private val YUVALAR = HashMap<String, LevhaCizimYuvasi>()

/** Aynı anahtar için aynı nesne (yeniden çizimde yuva değişmiş sayılmasın). Anahtar önce kayıttaki karşılığına iner. */
fun cizimYuvasiOnbellekli(anahtar: String?): LevhaCizimYuvasi =
    cizimAnahtari(anahtar).let { a -> YUVALAR.getOrPut(a) { cizimYuvasi(a) } }
