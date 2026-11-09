package dev.eren.deneme

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.view.WindowInsets
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class AnaActivity : Activity() {
    private lateinit var durum: TextView
    private lateinit var sayacYazi: TextView
    private var sayac = 0
    private var parolaUzunluk = 0
    private val h = Handler(Looper.getMainLooper())
    private val tazele = object : Runnable {
        override fun run() {
            durumYaz()
            h.postDelayed(this, 1000)
        }
    }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val kok = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }
        val kaydirma = ScrollView(this).apply { addView(kok) }
        // targetSdk 36 kenardan kenara zorlar: içerik sistem çubuklarının altına girmesin.
        kaydirma.setOnApplyWindowInsetsListener { v, ins ->
            val s = ins.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
            v.setPadding(s.left, s.top, s.right, s.bottom)
            ins
        }
        setContentView(kaydirma)

        kok.addView(TextView(this).apply { text = getString(R.string.ad); textSize = 22f })
        durum = TextView(this).apply { id = R.id.durum; textSize = 14f }
        kok.addView(durum)

        kok.addView(EditText(this).apply {
            id = R.id.normal
            hint = "normal metin"
            inputType = InputType.TYPE_CLASS_TEXT
        })
        kok.addView(EditText(this).apply {
            id = R.id.parola
            hint = "parola"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    // İçerik değil, yalnız uzunluk ekrana çıkar: yazmanın ulaştığının bağımsız kanıtı.
                    parolaUzunluk = s?.length ?: 0
                    durumYaz()
                }
            })
        })

        sayacYazi = TextView(this).apply { id = R.id.sayac; text = "Sayaç: 0"; textSize = 18f }
        kok.addView(Button(this).apply {
            id = R.id.say
            text = "Say"
            setOnClickListener { sayac++; sayacYazi.text = "Sayaç: $sayac" }
        })
        kok.addView(sayacYazi)

        kok.addView(dugme("Gizli ekran (FLAG_SECURE)", R.id.gizli) {
            startActivity(Intent(this, GizliActivity::class.java))
        })
        kok.addView(dugme("Erişilebilirlik ayarları", View.NO_ID) {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        })
        kok.addView(dugme("Uygulama bilgisi", View.NO_ID) {
            startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
            )
        })

        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        Baslatici.baslat(this, "activity")
    }

    private fun dugme(yazi: String, kimlik: Int, tik: () -> Unit) = Button(this).apply {
        if (kimlik != View.NO_ID) id = kimlik
        text = yazi
        isAllCaps = false
        setOnClickListener { tik() }
    }

    private fun durumYaz() {
        val a11y = Durum.a11yAcik(this)
        durum.text = "Erişilebilirlik: ${if (a11y) "açık" else "kapalı"}" +
            " (servis ${if (Olcum.erisim != null) "bağlı" else "bağlı değil"})\n" +
            "Bağlantı: ${if (Olcum.bagli) "var" else "yok"} (toplam ${Olcum.sayi("toplam_baglanti")})\n" +
            "Son komut: ${Olcum.sonKomut}\n" +
            "Parola uzunluğu: $parolaUzunluk"
    }

    override fun onResume() {
        super.onResume()
        h.post(tazele)
    }

    override fun onPause() {
        h.removeCallbacks(tazele)
        super.onPause()
    }
}
