package dev.eren.cihaz.adaptor

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.graphics.Typeface
import android.os.Bundle
import android.os.CancellationSignal
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import dev.eren.cihaz.cekirdek.UygulamaBilgisi
import dev.eren.cihaz.cekirdek.UygulamaDurumu
import java.util.concurrent.Executors

class UygulamaListesiActivity : Activity() {
    private val arka = Executors.newSingleThreadExecutor()
    private lateinit var liste: LinearLayout
    private lateinit var ust: TextView
    private var dogrulaniyor = false
    private var iptal: CancellationSignal? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        val kok = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
            filterTouchesWhenObscured = true
        }
        ust = TextView(this).apply {
            textSize = 14f
            setTextColor(Renkler.metinIkincil)
            text = "Hangi uygulamalarda ${asistanAdi()} uygulamasına izin verebileceğinizi seçin. Açık yapmak " +
                "doğrulama ister; hassas ya da yeni yapmak istemez. Kilitli olanlar değişmez."
        }
        kok.addView(ust)
        liste = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        kok.addView(liste)
        setContentView(ScrollView(this).apply {
            setBackgroundColor(Renkler.zemin)
            isFillViewport = true
            addView(kok, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        })
        yukle()
    }

    override fun onDestroy() {
        iptal?.cancel()
        arka.shutdownNow()
        super.onDestroy()
    }

    private fun yukle() {
        val c = Adaptor.cekirdek
        if (c == null) {
            ust.text = "Servis çalışmıyor; liste okunamadı."
            liste.removeAllViews()
            return
        }
        arka.execute {
            val uygulamalar = try {
                // Depo ile liste aynı anda yenilenir; çekirdek görüntüsü güncel kararı yansıtsın.
                c.listeler.guncelle(c.paket.listeGirdisi())
                c.listeler.uygulamalar().sortedBy { it.ad.lowercase() }
            } catch (_: Exception) {
                null
            }
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                if (uygulamalar == null) {
                    ust.text = "Liste okunamadı."
                    return@runOnUiThread
                }
                ciz(uygulamalar)
            }
        }
    }

    private fun ciz(uygulamalar: List<UygulamaBilgisi>) {
        liste.removeAllViews()
        for (u in uygulamalar) liste.addView(satir(u))
    }

    private fun satir(u: UygulamaBilgisi): View {
        val kap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(12), 0, dp(12))
        }
        kap.addView(TextView(this).apply {
            text = temiz(u.ad, 60)
            setTextColor(Renkler.metin)
            textSize = 16f
            setTypeface(typeface, Typeface.BOLD)
        })
        kap.addView(TextView(this).apply {
            text = temiz(u.paket, 100)
            setTextColor(Renkler.metinIkincil)
            textSize = 12f
            alpha = 0.7f
        })
        if (u.durum == UygulamaDurumu.DEGISMEZ) {
            kap.addView(TextView(this).apply {
                text = "Kilitli: bu uygulamada izin verilemez"
                textSize = 13f
                setTextColor(Renkler.metinIkincil)
            })
            return kap
        }
        val dugmeler = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for ((durum, ad) in SECENEKLER) {
            dugmeler.addView(Button(this).apply {
                text = if (u.durum == durum) "● $ad" else ad
                isEnabled = u.durum != durum
                isAllCaps = false
                // Seçili seçenek (devre dışı) birincil görünür, diğerleri ikincil.
                setTextColor(
                    ColorStateList(
                        arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()),
                        intArrayOf(Renkler.dolguUstu, Renkler.metin),
                    ),
                )
                background = StateListDrawable().apply {
                    addState(intArrayOf(-android.R.attr.state_enabled), dugmeKutusu(Renkler.vurgu, null))
                    addState(intArrayOf(android.R.attr.state_pressed), dugmeKutusu(Renkler.basili, Renkler.kenarGuclu))
                    addState(intArrayOf(), dugmeKutusu(Color.TRANSPARENT, Renkler.kenarGuclu))
                }
                filterTouchesWhenObscured = true
                setOnClickListener { sec(u, durum) }
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
        kap.addView(dugmeler)
        return kap
    }

    private fun sec(u: UygulamaBilgisi, hedef: UygulamaDurumu) {
        if (dogrulaniyor) return
        if (hedef == UygulamaDurumu.ACIK) {
            dogrula(u) { uygula(u, hedef) }
        } else {
            uygula(u, hedef)
        }
    }

    /** Yalnız `acik` için çağrılır; doğrulama başarısızsa ya da kurulamazsa karar yazılmaz. */
    private fun dogrula(u: UygulamaBilgisi, basarili: () -> Unit) {
        val izinli = BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL
        val yonetici = getSystemService(BiometricManager::class.java)
        if (yonetici == null || yonetici.canAuthenticate(izinli) != BiometricManager.BIOMETRIC_SUCCESS) {
            Toast.makeText(this, "Doğrulama kurulu değil; açık yapılamaz.", Toast.LENGTH_LONG).show()
            return
        }
        dogrulaniyor = true
        val sinyal = CancellationSignal()
        iptal = sinyal
        val istem = BiometricPrompt.Builder(this)
            .setTitle("Uygulamayı açık yap")
            .setSubtitle(temiz(u.ad, 60))
            .setAllowedAuthenticators(izinli)
            .build()
        istem.authenticate(sinyal, mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult?) {
                dogrulaniyor = false
                basarili()
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) {
                dogrulaniyor = false
            }
        })
    }

    private fun uygula(u: UygulamaBilgisi, hedef: UygulamaDurumu) {
        val c = Adaptor.cekirdek
        if (c == null) {
            Toast.makeText(this, "Servis çalışmıyor.", Toast.LENGTH_SHORT).show()
            return
        }
        arka.execute {
            // İmza özeti karar anında okunur; okunamazsa (paket yok) hiçbir şey yazılmaz.
            val imza = c.paket.imzaOzeti(u.paket)
            val bilgi = c.paket as? PaketBilgisi
            val yazildi = bilgi != null && imza != null && try {
                if (hedef == UygulamaDurumu.YENI) bilgi.kararSil(u.paket) else bilgi.kararYaz(u.paket, hedef, imza)
                true
            } catch (_: Exception) {
                false
            }
            if (yazildi) {
                try {
                    c.listeler.guncelle(c.paket.listeGirdisi())
                    Adaptor.oturumGuncelle?.uygulamalarDegisti()
                } catch (_: Exception) {
                }
            }
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                if (!yazildi) Toast.makeText(this, "Karar kaydedilemedi.", Toast.LENGTH_SHORT).show()
                yukle()
            }
        }
    }

    private fun dp(n: Int): Int = (n * resources.displayMetrics.density).toInt()

    private fun dugmeKutusu(renk: Int, kenar: Int?) = GradientDrawable().apply {
        setColor(renk)
        if (kenar != null) setStroke(dp(1), kenar)
        cornerRadius = dp(10).toFloat()
    }

    private companion object {
        val SECENEKLER = listOf(
            UygulamaDurumu.ACIK to "Açık",
            UygulamaDurumu.HASSAS to "Hassas",
            UygulamaDurumu.YENI to "Yeni",
        )
    }
}

/** Başkasının metni: denetim karakterlerini at, kısalt. Yalnız görüntü. */
private fun temiz(s: String, azami: Int): String {
    val t = s.filter { !it.isISOControl() }
    return if (t.length > azami) t.substring(0, azami) + "…" else t
}
