package dev.eren.cihaz.adaptor

import android.content.Context

/**
 * Tam yetki bayrağı: kalıcı, uygulama içi SharedPreferences (MODE_PRIVATE), varsayılan kapalı.
 *
 * `ac` yalnız `TamYetkiActivity` tarafından (biyometri/cihaz kimlik bilgisi başarısından sonra)
 * çağrılır; PC ve JS açamaz (yapısal test `TamYetki.ac(` çağrısını yalnız o dosyada arar).
 * `kapat` her zaman serbesttir. Değişiklik hemen kalıcı yazılır (`commit`) ve köprü olayı
 * için `Adaptor.olaylar?.durumDegisti()` çağrılır.
 */
object TamYetki {
    private const val DOSYA = "eren_tam_yetki"
    private const val ANAHTAR = "acik"

    @Volatile
    private var onbellek: Boolean? = null

    /** Ucuz ve iş-parçacığı güvenli okuma; ilk okumadan sonra bellekten döner. */
    fun acik(ctx: Context): Boolean {
        onbellek?.let { return it }
        return synchronized(this) {
            onbellek ?: ctx.applicationContext
                .getSharedPreferences(DOSYA, Context.MODE_PRIVATE)
                .getBoolean(ANAHTAR, false)
                .also { onbellek = it }
        }
    }

    /** Yalnız `TamYetkiActivity` çağırır. */
    fun ac(ctx: Context) = yaz(ctx, true)

    /** Her zaman serbest. */
    fun kapat(ctx: Context) = yaz(ctx, false)

    private fun yaz(ctx: Context, deger: Boolean) {
        val degisti = synchronized(this) {
            val onceki = acik(ctx)
            ctx.applicationContext
                .getSharedPreferences(DOSYA, Context.MODE_PRIVATE)
                .edit().putBoolean(ANAHTAR, deger).commit()
            onbellek = deger
            onceki != deger
        }
        if (degisti) Adaptor.olaylar?.durumDegisti()
    }
}
