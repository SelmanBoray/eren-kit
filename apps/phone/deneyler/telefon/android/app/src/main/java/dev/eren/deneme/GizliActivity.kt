package dev.eren.deneme

import android.app.Activity
import android.os.Bundle
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Ekran görüntüsünün FLAG_SECURE karşısındaki davranışını ölçmek için. */
class GizliActivity : Activity() {
    private var sayac = 0

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        val kok = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setOnApplyWindowInsetsListener { v, ins ->
                val s = ins.getInsets(WindowInsets.Type.systemBars())
                v.setPadding(s.left + 32, s.top + 32, s.right + 32, s.bottom + 32)
                ins
            }
        }
        kok.addView(TextView(this).apply { text = "Gizli ekran (FLAG_SECURE)"; textSize = 22f })
        val yazi = TextView(this).apply { id = R.id.gizli_sayac; text = "Gizli sayaç: 0"; textSize = 18f }
        kok.addView(Button(this).apply {
            id = R.id.gizli_say
            text = "Gizli say"
            setOnClickListener { sayac++; yazi.text = "Gizli sayaç: $sayac" }
        })
        kok.addView(yazi)
        kok.addView(Button(this).apply {
            text = "Geri"
            setOnClickListener { finish() }
        })
        setContentView(kok)
    }
}
