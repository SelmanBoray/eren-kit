package dev.eren.olcum.bolge

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Typeface
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/** Bağımlılıksız düz görünümlerle küçük ekran kurucusu. */
class Duzen(private val a: Activity) {
    val pay = (12 * a.resources.displayMetrics.density).toInt()
    val kok = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }

    fun baslik(s: String, kap: ViewGroup = kok) = TextView(a).apply {
        text = s
        textSize = 16f
        setTypeface(typeface, Typeface.BOLD)
        setPadding(0, pay, 0, pay / 3)
        kap.addView(this)
    }

    fun yazi(s: String = "", kap: ViewGroup = kok, boyut: Float = 13f) = TextView(a).apply {
        text = s
        textSize = boyut
        setPadding(0, pay / 4, 0, pay / 4)
        kap.addView(this)
    }

    fun dugme(ad: String, kap: ViewGroup = kok, is_: () -> Unit) = Button(a).apply {
        text = ad
        isAllCaps = false
        setOnClickListener { is_() }
        if (kap is LinearLayout && kap.orientation == LinearLayout.HORIZONTAL) {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            textSize = 12f
        }
        kap.addView(this)
    }

    /** Yan yana eşit genişlikte düğmeler için satır. */
    fun satir(kap: ViewGroup = kok) = LinearLayout(a).apply {
        orientation = LinearLayout.HORIZONTAL
        kap.addView(this)
    }

    fun kutu(kap: ViewGroup = kok) = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL
        kap.addView(this)
    }

    /** Kaydırılabilir kök; sistem çubuklarının altında kalmaz (Android 15+ kenardan kenara). */
    fun goster() {
        val kaydirma = ScrollView(a).apply { addView(kok) }
        kaydirma.setOnApplyWindowInsetsListener { v, ic ->
            val b = ic.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
            v.setPadding(b.left + pay, b.top + pay, b.right + pay, b.bottom + pay)
            ic
        }
        kaydirma.clipToPadding = false
        a.setContentView(kaydirma)
    }
}

fun Activity.ac(i: Intent): Boolean = try {
    startActivity(i)
    true
} catch (_: ActivityNotFoundException) {
    false
} catch (_: SecurityException) {
    false
}

fun Activity.kisa(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()
fun Activity.uzun(s: String) = Toast.makeText(this, s, Toast.LENGTH_LONG).show()

fun View.gorunur(v: Boolean) {
    visibility = if (v) View.VISIBLE else View.GONE
}
