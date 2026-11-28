package dev.eren.ajanda.ekran.sahne.ekranlar

import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

internal val TURKCE: Locale = Locale.forLanguageTag("tr-TR")

/** "Perşembe, 12 Mart" */
internal fun uzunTarih(t: LocalDate): String =
    "${t.dayOfWeek.getDisplayName(TextStyle.FULL, TURKCE).replaceFirstChar { it.titlecase(TURKCE) }}, " +
        "${t.dayOfMonth} ${t.month.getDisplayName(TextStyle.FULL_STANDALONE, TURKCE).replaceFirstChar { it.titlecase(TURKCE) }}"

/** "Bugün, 12 Mart" / "Yarın, 13 Mart" / "Dün, 11 Mart" / "Cuma, 20 Mart" */
internal fun goreliTarih(t: LocalDate, bugun: LocalDate): String {
    val ay = "${t.dayOfMonth} ${t.month.getDisplayName(TextStyle.FULL_STANDALONE, TURKCE).replaceFirstChar { it.titlecase(TURKCE) }}"
    return when (t) {
        bugun -> "Bugün, $ay"
        bugun.plusDays(1) -> "Yarın, $ay"
        bugun.minusDays(1) -> "Dün, $ay"
        else -> uzunTarih(t)
    }
}

/** Türkçe küçük harf ("İ" -> "i", "I" -> "ı"). */
internal fun String.kucukTr(): String = lowercase(TURKCE)

/**
 * Sekme sayfalarının iç payı (SAHNE.md §3.1): yanlarda 16 dp ya da güvenli alan, üstte durum çubuğu + 20 dp,
 * altta gezinme çubuğu + 120 dp (alt çubuk ve tost için yer).
 */
@Composable
internal fun sayfaPayi(ust: Dp = 20.dp, alt: Dp = 120.dp): PaddingValues {
    val yon = LocalLayoutDirection.current
    val guvenli = WindowInsets.safeDrawing.asPaddingValues()
    val kenar = Sahne.olcu.kenar
    return PaddingValues(
        start = maxOf(kenar, guvenli.calculateStartPadding(yon)),
        end = maxOf(kenar, guvenli.calculateEndPadding(yon)),
        top = guvenli.calculateTopPadding() + ust,
        bottom = WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom).asPaddingValues().calculateBottomPadding() + alt,
    )
}
