package dev.eren.ajanda.ekran.sahne.cizim

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.asAndroidPath
import androidx.compose.ui.graphics.vector.PathParser

/**
 * Ayrıştırılmış parça: yol bir kez kurulur ve çizimler arasında paylaşılır (SAHNE.md §7.4). Yalnız ana iş
 * parçacığında kullanılır (Compose çizimi).
 */
internal class HazirParca(
    val parca: Parca,
    val yol: Path,
    /** Sınır kutusu (dönüş uygulanmış); pırıltı ve köpük kendi merkezinde ölçeklenir. */
    val sinir: Rect,
    /** İmza için yol ölçeri (uzunluk ve kırpma); öteki parçalarda `null`. */
    val olcer: PathMeasure?,
) {
    val merkez: Offset get() = sinir.center

    /** İmzanın kırpılmış hâli için yeniden kullanılan yol. */
    val kirpik: Path? = if (olcer != null) Path() else null

    /** Boyalı hâldeki çizgi (yuvarlak uç ve köşe); dolgu parçasında `null`. */
    val boyaliCizgi: Stroke? = parca.cizgi?.let { Stroke(width = it, cap = StrokeCap.Round, join = StrokeJoin.Round) }
}

internal class HazirCizim(val parcalar: List<HazirParca>) {
    /** Sürekli döngüsü olan parça var mı (köpük, buhar, pırıltı): yoksa saat hiç kurulmaz. */
    val surekliVar: Boolean = parcalar.any { it.parca.canli?.surekli == true }

    /** Bir kez oynayan parça var mı (imza, kalem). */
    val tekSeferVar: Boolean = parcalar.any { it.parca.canli?.surekli == false }

    val kopukVar: Boolean = parcalar.any { it.parca.canli == Canlanma.KOPUK }

    companion object {
        fun kur(cizim: Cizim): HazirCizim = HazirCizim(cizim.parcalar.map { hazirla(it) })

        fun hazirla(p: Parca): HazirParca {
            val yol = PathParser().parsePathString(p.yol).toPath()
            p.donus?.let { d ->
                val m = android.graphics.Matrix().apply { setRotate(d.aci, d.cx, d.cy) }
                yol.asAndroidPath().transform(m)
            }
            val olcer = if (p.canli == Canlanma.IMZA) PathMeasure().apply { setPath(yol, false) } else null
            return HazirParca(p, yol, yol.getBounds(), olcer)
        }
    }
}
