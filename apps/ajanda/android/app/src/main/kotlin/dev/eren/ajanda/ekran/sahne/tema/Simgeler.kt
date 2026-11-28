package dev.eren.ajanda.ekran.sahne.tema

import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.unit.dp

/**
 * Çizgi simgeleri: 24 birimlik ızgarada, yuvarlak uçlu tek kalınlık çizgi (prototipin simge takımı).
 * Hepsi bu projede çizildi; dış kaynaklı simge yok, lisans yükü yok.
 * Büyük boyda (levha figürü) aynı simge kalın bir afiş çizgisine dönüşür.
 */
object Simgeler {
    private fun cizgi(ad: String, vararg yollar: String, kalinlik: Float = 1.8f): ImageVector =
        ImageVector.Builder(name = ad, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
            .apply {
                for (y in yollar) {
                    addPath(
                        pathData = addPathNodes(y),
                        fill = null,
                        stroke = SolidColor(Color.Black),
                        strokeLineWidth = kalinlik,
                        strokeLineCap = StrokeCap.Round,
                        strokeLineJoin = StrokeJoin.Round,
                    )
                }
            }.build()

    /** Daireyi yol olarak yazar (SVG `circle` karşılığı). */
    private fun daire(cx: Float, cy: Float, r: Float) = "M${cx - r} ${cy}a$r $r 0 1 0 ${2 * r} 0a$r $r 0 1 0 ${-2 * r} 0"

    // Gezinme ve denetim
    val Gun = cizgi("gun", "M5 7h14M5 12h14M5 17h9")
    val Takvim = cizgi("takvim", "M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4")
    val Tarihsiz = cizgi("tarihsiz", "M5 7.5h2M10 7.5h9M5 12h2M10 12h9M5 16.5h2M10 16.5h6")
    val Arti = cizgi("arti", "M12 5v14M5 12h14", kalinlik = 2.4f)
    val Tik = cizgi("tik", "M5 12.5l4.5 4.5L19 7.5", kalinlik = 2.6f)
    val Geri = cizgi("geri", "M14.5 5.5L8 12l6.5 6.5")
    val Ileri = cizgi("ileri", "M9.5 5.5L16 12l-6.5 6.5")
    val Asagi = cizgi("asagi", "M5.5 9.5L12 16l6.5-6.5")
    val Kapat = cizgi("kapat", "M6 6l12 12M18 6L6 18")
    val Ayar = cizgi("ayar", "M4 8h9M17 8h3M4 16h3M11 16h9", daire(15f, 8f, 2.2f), daire(9f, 16f, 2.2f))

    // Levha figürleri (sonraki dilimde kaydın simge anahtarından seçilir)
    val Fincan = cizgi("fincan", "M5 9.5h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9.5zM16 11h1.5a2.5 2.5 0 0 1 0 5H16M8.5 6c0-1 1-1 1-2.2M12.5 6c0-1 1-1 1-2.2")
    val Dis = cizgi("dis", "M7.6 3.5c1.7 0 2.6 1 4.4 1s2.7-1 4.4-1C18.6 3.5 20 5.3 20 7.7c0 2.6-1.2 4-1.7 6.8-.4 2.4-.7 6-2.3 6-1.7 0-1.2-5-4-5s-2.3 5-4 5c-1.6 0-1.9-3.6-2.3-6C5.2 11.7 4 10.3 4 7.7 4 5.3 5.4 3.5 7.6 3.5z")
    val Sepet = cizgi("sepet", "M4 9.5h16l-1.5 8.7a2 2 0 0 1-2 1.8H7.5a2 2 0 0 1-2-1.8L4 9.5zM8 9.5l3-5.5M16 9.5L13 4M9.5 13v3.5M14.5 13v3.5")
    val Imza = cizgi("imza", "M6.5 5.5h11v15h-11zM9.5 3.5h5v3.5h-5zM9 16.5c.8-1.8 1.5-2.3 2-1.2.5 1 .9 1.5 1.7.3.6-1 1.2-.9 2.3.3", "M9.5 10.5h5")
    val Kutu = cizgi("kutu", "M3.5 8L12 3.5 20.5 8v8.5L12 21l-8.5-4.5V8zM3.5 8l8.5 4.5L20.5 8M12 12.5V21")
    val Ilac = cizgi("ilac", "M7.2 16.8a4.2 4.2 0 0 1 0-6l3.6-3.6a4.2 4.2 0 0 1 6 6l-3.6 3.6a4.2 4.2 0 0 1-6 0zM9 9l6 6")
    val Fatura = cizgi("fatura", "M6.5 3.5h11v17l-2.2-1.5-2.2 1.5-1.1-.8-1.1.8-2.2-1.5-2.2 1.5v-17zM9.5 8.5h5M9.5 12.5h5")
    val Cadir = cizgi("cadir", "M3 19.5L12 5l9 14.5H3zM12 5v14.5M12 12l-3.5 7.5")
    val Yildiz = cizgi("yildiz", daire(12f, 12f, 3.2f), "M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2")
    val Zil = cizgi("zil", "M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14l1.5-2zM10.3 20.5a1.8 1.8 0 0 0 3.4 0")
}

/** Simge. [aciklama] TalkBack'in okuyacağı ad; süs ya da yanındaki yazıyla aynıysa `null`. */
@Composable
fun Simge(simge: ImageVector, aciklama: String?, modifier: Modifier = Modifier, renk: Color = LocalSahneMetinStili.current.color) {
    Image(
        painter = rememberVectorPainter(simge),
        contentDescription = aciklama,
        modifier = modifier,
        colorFilter = ColorFilter.tint(renk),
    )
}
