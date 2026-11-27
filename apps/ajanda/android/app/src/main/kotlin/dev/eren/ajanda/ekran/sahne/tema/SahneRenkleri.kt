package dev.eren.ajanda.ekran.sahne.tema

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * Sahne renkleri. Fikir: "galeri duvarı". Zemin sakin ve neredeyse renksiz; rengi kayıtların levhaları taşır.
 * Değerler tasarım prototipinden (Sahne yönü, `--s-*` ve levha takımları) alındı; koyu temada yalnız
 * zemin ailesi ve levha zeminleri değişir, levhanın figür ve yazı renkleri aynı kalır.
 */
@Immutable
data class SahneRenkleri(
    /** Sayfa zemini. */
    val zemin: Color,
    /** Zeminden bir ton ayrılan yüzey: satır, yuvarlak düğme, çip. */
    val yuz: Color,
    /** Ana yazı ve koyu dolgu (alt çubuk, birincil düğme). */
    val murekkep: Color,
    /** İkincil yazı: tarih satırı, ara başlık, açıklama. */
    val soluk: Color,
    /** İnce ayırıcı ve boş durum çizgileri. */
    val cizgi: Color,
    /** Tek vurgu: "yeni kayıt" düğmesi. Az kullanılır. */
    val vurgu: Color,
    val vurguUstu: Color,
    /** Kipli katmanın arkasındaki karartma. */
    val perde: Color,
    val koyu: Boolean,
) {
    companion object {
        val Acik = SahneRenkleri(
            zemin = Color(0xFFFFFFFF),
            yuz = Color(0xFFF1F1F3),
            murekkep = Color(0xFF14151A),
            soluk = Color(0xFF676A74),
            cizgi = Color(0xFFE2E3E7),
            vurgu = Color(0xFFFFC83D),
            vurguUstu = Color(0xFF1A1505),
            perde = Color(0x8014151A),
            koyu = false,
        )
        val Koyu = SahneRenkleri(
            zemin = Color(0xFF0E0E11),
            yuz = Color(0xFF1C1C21),
            murekkep = Color(0xFFF5F3EE),
            soluk = Color(0xFF9C9EA8),
            cizgi = Color(0xFF2B2C33),
            vurgu = Color(0xFFFFC83D),
            vurguUstu = Color(0xFF1A1505),
            perde = Color(0x99000000),
            koyu = true,
        )
    }
}

/**
 * Bir levhanın renk takımı: [zemin] levhanın kendisi, [figur] çizimin ana rengi, [koyuAyrinti] ve
 * [acikAyrinti] çizimin gölge ve ışık parçaları, [yazi] levha üstündeki yazı.
 */
@Immutable
data class LevhaTakimi(
    val zemin: Color,
    val figur: Color,
    val koyuAyrinti: Color,
    val acikAyrinti: Color,
    val yazi: Color,
)

/**
 * Levha renkleri. Kaydın rengi (sonraki dilimde çekirdekteki simge anahtarından gelir) bu adlardan biridir.
 * Takımlar bilinçli olarak az: sekiz renk bir günü kalabalıklaştırmadan ayırt ettirir.
 */
enum class LevhaRengi(private val acik: LevhaTakimi, private val koyuZemin: Color) {
    KOBALT(LevhaTakimi(Color(0xFF2B50E0), Color(0xFFFFC83D), Color(0xFF0F1E5E), Color(0xFFDDE7FF), Color(0xFFFFFFFF)), Color(0xFF2747CC)),
    CAM(LevhaTakimi(Color(0xFF0F6B4F), Color(0xFFF7B8C6), Color(0xFF06382A), Color(0xFFF6F1E3), Color(0xFFFFFFFF)), Color(0xFF0D5F46)),
    HARDAL(LevhaTakimi(Color(0xFFF2B632), Color(0xFFD8432B), Color(0xFF3B2A05), Color(0xFFFFF4D2), Color(0xFF201703)), Color(0xFFE3A822)),
    PEMBE(LevhaTakimi(Color(0xFFF4A9BC), Color(0xFFFFFFFF), Color(0xFF5C1730), Color(0xFFFFE3EA), Color(0xFF3A0B1A)), Color(0xFFE79AAE)),
    DOMATES(LevhaTakimi(Color(0xFFC93A22), Color(0xFFF3D3A0), Color(0xFF5B140A), Color(0xFFFFE8D6), Color(0xFFFFFFFF)), Color(0xFFB93520)),
    GOK(LevhaTakimi(Color(0xFFBFE3EC), Color(0xFF1A8494), Color(0xFF0B3A42), Color(0xFFFFFFFF), Color(0xFF0B2A30)), Color(0xFFA9D3DD)),
    KUM(LevhaTakimi(Color(0xFFE4DFD2), Color(0xFF2B50E0), Color(0xFF2A2618), Color(0xFFFFFFFF), Color(0xFF1C1A14)), Color(0xFFD2CCBD)),
    GECE(LevhaTakimi(Color(0xFF1E2A3A), Color(0xFFF2B632), Color(0xFF0B121C), Color(0xFFC9D6E8), Color(0xFFFFFFFF)), Color(0xFF243347));

    fun takim(koyu: Boolean): LevhaTakimi = if (koyu) acik.copy(zemin = koyuZemin) else acik
}
