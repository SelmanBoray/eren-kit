package dev.eren.ajanda.ekran

import android.app.Activity
import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.LinearLayout
import android.widget.TextView
import dev.eren.ajanda.R

/**
 * Ekranların ortak görünüm parçaları (platform View'ları; AndroidX yok). Renkler kaynak dosyasından
 * (`ekran_renkler.xml`, koyu tema `values-night`); yazı boyları `sp`: sistemin büyük yazı ayarı uygulanır,
 * satırlar sabit yükseklik taşımaz.
 */
class Tasarim(private val c: Context) {
    val zemin = renk(R.color.ekran_zemin)
    val yuzey = renk(R.color.ekran_yuzey)
    val yuzeyIkincil = renk(R.color.ekran_yuzey_ikincil)
    val murekkep = renk(R.color.ekran_murekkep)
    val soluk = renk(R.color.ekran_soluk)
    val cizgi = renk(R.color.ekran_cizgi)
    val vurgu = renk(R.color.ekran_vurgu)
    val vurguUzerine = renk(R.color.ekran_vurgu_uzerine)
    val gecikmis = renk(R.color.ekran_gecikmis)
    val taslakZemin = renk(R.color.ekran_taslak_zemin)
    val taslakYazi = renk(R.color.ekran_taslak_yazi)
    val asistanZemin = renk(R.color.ekran_asistan_zemin)
    val asistanYazi = renk(R.color.ekran_asistan_yazi)
    val iyi = renk(R.color.ekran_iyi)
    val uyariZemin = renk(R.color.ekran_uyari_zemin)
    val uyariYazi = renk(R.color.ekran_uyari_yazi)
    val bilgiZemin = renk(R.color.ekran_bilgi_zemin)
    val bilgiYazi = renk(R.color.ekran_bilgi_yazi)

    val koyu: Boolean =
        (c.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    private fun renk(id: Int) = c.getColor(id)

    fun dp(n: Int): Int = (c.resources.displayMetrics.density * n + 0.5f).toInt()
    fun dpf(n: Float): Float = c.resources.displayMetrics.density * n

    fun yazi(
        s: CharSequence = "",
        boy: Float = 16f,
        renk: Int = murekkep,
        kalin: Boolean = false,
        serif: Boolean = false,
    ) = TextView(c).apply {
        text = s
        setTextSize(TypedValue.COMPLEX_UNIT_SP, boy)
        setTextColor(renk)
        typeface = Typeface.create(if (serif) Typeface.SERIF else Typeface.SANS_SERIF, if (kalin) Typeface.BOLD else Typeface.NORMAL)
        // Metin düz gösterilir: bağlantıya çevrilmez (kayıt eylemsiz veridir).
        autoLinkMask = 0
        linksClickable = false
    }

    fun yuvarlak(zemin: Int, yaricapDp: Float = 8f, kenar: Int? = null): GradientDrawable = GradientDrawable().apply {
        setColor(zemin)
        cornerRadius = dpf(yaricapDp)
        if (kenar != null) setStroke(dp(1), kenar)
    }

    /** Dokunma dalgası olan zemin. */
    fun dokunulur(zemin: Drawable?, maske: Drawable? = null): Drawable {
        // Maske zeminin AYRI bir kopyası olmalı: aynı nesne iki katmanda olursa iç içe dolgu kipinde
        // payı iki kez uygulanır ve çizim küçülür.
        val m = maske ?: zemin?.constantState?.newDrawable()?.mutate() ?: yuvarlak(0xFFFFFFFF.toInt(), 0f)
        return RippleDrawable(ColorStateList.valueOf((soluk and 0x00FFFFFF) or 0x33000000), zemin, m).apply {
            paddingMode = android.graphics.drawable.LayerDrawable.PADDING_MODE_STACK
        }
    }

    /** Küçük işaret ("Taslak", "Asistan"). */
    fun rozet(s: String, zemin: Int, yaziRengi: Int) = yazi(s, 12f, yaziRengi, kalin = true).apply {
        background = yuvarlak(zemin, 10f)
        setPadding(dp(8), dp(2), dp(8), dp(2))
        maxLines = 1
    }

    /** Düz metin düğmesi (çerçevesiz, vurgu renkli). */
    fun metinDugmesi(s: String, renk: Int = vurgu, tik: () -> Unit) = yazi(s, 15f, renk, kalin = true).apply {
        gravity = Gravity.CENTER
        minHeight = dp(44)
        minWidth = dp(44)
        setPadding(dp(12), dp(8), dp(12), dp(8))
        background = dokunulur(null, yuvarlak(0xFFFFFFFF.toInt(), 8f))
        isClickable = true
        isFocusable = true
        setOnClickListener { tik() }
    }

    /** Dolgulu ana düğme. */
    fun anaDugme(s: String, tik: () -> Unit) = yazi(s, 16f, vurguUzerine, kalin = true).apply {
        gravity = Gravity.CENTER
        minHeight = dp(48)
        setPadding(dp(20), dp(10), dp(20), dp(10))
        background = dokunulur(yuvarlak(vurgu, 24f))
        isClickable = true
        isFocusable = true
        setOnClickListener { tik() }
    }

    /** Seçilebilir yonga (tür, tarih, hatırlatma seçimleri). */
    fun yonga(s: String, secili: Boolean, tik: () -> Unit) = yazi(s, 14f, if (secili) vurguUzerine else murekkep).apply {
        gravity = Gravity.CENTER
        minHeight = dp(40)
        setPadding(dp(14), dp(6), dp(14), dp(6))
        background = dokunulur(if (secili) yuvarlak(vurgu, 20f) else yuvarlak(yuzey, 20f, cizgi))
        isClickable = true
        isFocusable = true
        isSelected = secili
        setOnClickListener { tik() }
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.END
    }

    fun ayirici() = View(c).apply {
        setBackgroundColor(cizgi)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, maxOf(1, dp(1) / 2))
    }

    fun satirParam(ust: Int = 0, alt: Int = 0) = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply {
        topMargin = dp(ust)
        bottomMargin = dp(alt)
    }

    fun sarParam(sag: Int = 0) = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply { marginEnd = dp(sag) }

    companion object {
        /**
         * Kenardan kenara pencere (targetSdk 36; Android 15+ zorunlu): sistem çubuğu ve klavye payı
         * kök görünüme dolgu olarak verilir. Daha eski sürümde pencere zaten çubukların içindedir.
         * `ek`: pay her değiştiğinde çağrılır (ör. alttaki yüzen düğmenin yeri).
         */
        fun payUygula(kok: View, ek: ((ust: Int, alt: Int) -> Unit)? = null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
                kok.setOnApplyWindowInsetsListener { v, pay ->
                    val p = pay.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
                    v.setPadding(p.left, p.top, p.right, p.bottom)
                    ek?.invoke(p.top, p.bottom)
                    pay
                }
            }
        }

        /** Durum ve gezinme çubuğu simgelerinin rengi temaya uysun. */
        @Suppress("DEPRECATION")
        fun cubuklar(a: Activity, koyu: Boolean) {
            val w = a.window
            if (Build.VERSION.SDK_INT >= 30) {
                val maske = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                w.insetsController?.setSystemBarsAppearance(if (koyu) 0 else maske, maske)
            } else {
                var b = w.decorView.systemUiVisibility
                b = if (koyu) b and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv() else b or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                if (Build.VERSION.SDK_INT >= 27) {
                    b = if (koyu) b and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv() else b or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                }
                w.decorView.systemUiVisibility = b
            }
        }
    }
}
