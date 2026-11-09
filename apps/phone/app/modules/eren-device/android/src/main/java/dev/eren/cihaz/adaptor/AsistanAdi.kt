package dev.eren.cihaz.adaptor

import android.content.Context

/** Etiket boş ya da okunamazsa kullanılan ad (launcher adı varsayılanıyla aynı). */
internal const val VARSAYILAN_ASISTAN_ADI = "eren-kit"

/**
 * Kullanıcıya görünen asistan adı: uygulama etiketi, çalışma anında okunur.
 *
 * Etiket derleme anında `EREN_KIT_ASSISTANT_NAME` (yoksa `"eren-kit"`) olarak ayarlanır; Kotlin
 * tarafı görünen metinde sabit ad yazmaz, bu değeri kullanır.
 */
internal fun Context.asistanAdi(): String =
    try {
        applicationInfo.loadLabel(packageManager).toString().trim().ifEmpty { VARSAYILAN_ASISTAN_ADI }
    } catch (_: RuntimeException) {
        VARSAYILAN_ASISTAN_ADI
    }
