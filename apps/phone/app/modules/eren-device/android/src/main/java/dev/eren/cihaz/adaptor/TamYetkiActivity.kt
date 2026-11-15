package dev.eren.cihaz.adaptor

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Tam yetkinin açıldığı tek yer (`TamYetki.ac(` yalnız bu dosyada). Kullanıcı ne değiştiğini okur,
 * "Aç"a gerçek parmakla basar, `BIOMETRIC_STRONG or DEVICE_CREDENTIAL` ile kimliğini doğrular;
 * yalnız doğrulama başarısından sonra bayrak açılır. PC ve JS bu ekranı geçemez: etkinlik dışa kapalı,
 * düğmeler erişilebilirlik tıklamasını ve örtülü dokunuşu reddeder, pencere FLAG_SECURE.
 * Sonuç: RESULT_OK + extra `sonuc` ("acildi"|"iptal"). Kapatmak bu ekranı gerektirmez.
 */
class TamYetkiActivity : Activity() {

    companion object {
        const val EXTRA_SONUC = "sonuc"

        private const val FLAG_KISMEN_GIZLI = 0x2 // FLAG_WINDOW_IS_PARTIALLY_OBSCURED
        private const val FLAG_GIZLI = 0x1 // FLAG_WINDOW_IS_OBSCURED
    }

    private lateinit var hataMetni: TextView
    private lateinit var gizliUyari: TextView

    private var bitti = false
    private var biyometrideMi = false
    private var iptalSinyali: CancellationSignal? = null

    private val fg = Renkler.metin
    private val soluk = Renkler.metinIkincil
    private val kirmizi = Renkler.hata

    private val yetki: Int
        get() = BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        // Zaten açıksa değişecek bir şey yok; kimlik doğrulama istemeden aynı sonucu döner.
        if (TamYetki.acik(this)) return bitir("acildi")
        kur()
    }

    // ---------------------------------------------------------------------------------------
    // Ekran
    // ---------------------------------------------------------------------------------------

    private fun kur() {
        val kok = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(24))
        }
        gizliUyari = metin("", kirmizi, 14f, bold = true).apply { visibility = View.GONE }
        kok.addView(gizliUyari)

        val ad = asistanAdi()
        kok.addView(metin("Tam yetki", soluk, 13f))
        kok.addView(metin("$ad uygulamasına telefonda tam yetki verilsin mi?", fg, 20f, bold = true))
        kok.addView(
            metin(
                "Açarsanız $ad bu telefonda onay ekranı göstermeden okur, yazar ve mesaj gönderir.",
                fg,
                16f,
            ),
        )

        kok.addView(baslik("Ne değişir"))
        kok.addView(
            kutu(
                "• Onay ekranı çıkmaz; telefondaki iş siz onaylamadan hemen başlar.\n" +
                    "• Ne yazacağını ve kime göndereceğini önceden görmezsiniz.",
                fg,
            ),
        )

        kok.addView(baslik("Hangi uygulamalarda"))
        kok.addView(
            kutu(
                "• Uygulamalar ekranında açık olan her uygulamada çalışır. Kurulu sıradan uygulamalar " +
                    "(sonradan kurulanlar da) siz kapatmadıkça açık başlar.\n" +
                    "• Banka, e-para, kripto, borsa, iki adımlı doğrulama, e-Devlet ve parola uygulamalarını " +
                    "adından ve paket adından tahmin edip kapalı başlatır. Bu tahmin her uygulamayı yakalamaz; " +
                    "açmadan önce Uygulamalar ekranındaki listeyi kontrol edin ve istemediklerinizi kapatın.",
                fg,
            ),
        )

        kok.addView(baslik("Değişmeyenler (yine geçerli)"))
        kok.addView(
            kutu(
                "• Değişmez ret listesi: Ayarlar, Play Store, kurulum ve izin pencereleri, kilit ekranı, " +
                    "Tailscale, üretici güvenlik uygulamaları ve $ad uygulamasının kendisi. $ad bunlara hiç girmez.\n" +
                    "• Uygulamalar ekranında kapalı olan uygulamalara girmez.\n" +
                    "• Parola alanlarına yazmaz.\n" +
                    "• Her iş yine süreli ve eylem bütçelidir ve denetim günlüğüne kaydedilir.\n" +
                    "• Kalıcı bildirim açık kalır; Durdur ile her işi anında kesersiniz.",
                fg,
            ),
        )

        kok.addView(baslik("Kapatmak"))
        kok.addView(
            kutu(
                "İstediğiniz an $ad uygulamasından kapatabilirsiniz. Kapatmak kimlik doğrulama istemez. " +
                    "Başka bir PC ile eşleşmek de tam yetkiyi kapatır; yeni PC için yeniden açmanız gerekir.",
                fg,
            ),
        )

        kok.addView(baslik("Risk"))
        kok.addView(
            kutu(
                "Ekranda okunan bir metin (mesaj, web sayfası, bildirim) $ad oturumunu kandırırsa, $ad " +
                    "sizin adınıza mesaj gönderebilir ve siz bunu ancak sonradan görürsünüz. " +
                    "Bu riski kabul ediyorsanız açın.",
                kirmizi,
                kalin = true,
            ),
        )

        // Kimlik doğrulama yoksa açılamaz; yalnız vazgeçilebilir.
        val dogrulamaVar = biyometriVarMi()
        hataMetni = metin("", kirmizi, 14f, bold = true)
        kok.addView(hataMetni)
        if (!dogrulamaVar) {
            hataMetni.text = "Açılamaz: tam yetki için ekran kilidi (parmak izi, yüz ya da PIN) gerekir; " +
                "bu telefonda kurulu değil."
        }

        val dugmeler = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(16), 0, 0)
        }
        val vazgec = dugme("Vazgeç", Color.TRANSPARENT, Renkler.metin, Renkler.kenarGuclu) { bitir("iptal") }
        dugmeler.addView(vazgec, LinearLayout.LayoutParams(0, dp(52), 1f).apply { rightMargin = dp(8) })
        if (dogrulamaVar) {
            val ac = dugme("Aç (kimlik doğrulama)", Renkler.vurgu, Renkler.dolguUstu) { acmayiDene() }
            dugmeler.addView(ac, LinearLayout.LayoutParams(0, dp(52), 1f).apply { leftMargin = dp(8) })
        }
        kok.addView(dugmeler)

        val sv = ScrollView(this).apply {
            setBackgroundColor(Renkler.zemin)
            isFillViewport = true
            addView(kok, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        guvenliYap(sv)
        setContentView(sv)
        guvenliYap(window.decorView)
    }

    // ---------------------------------------------------------------------------------------
    // Açma akışı
    // ---------------------------------------------------------------------------------------

    private fun acmayiDene() {
        if (bitti || biyometrideMi) return
        if (!biyometriVarMi()) {
            hataMetni.text = "Açılamaz: tam yetki için ekran kilidi (parmak izi, yüz ya da PIN) gerekir; " +
                "bu telefonda kurulu değil."
            return
        }
        hataMetni.text = ""
        biyometriIste()
    }

    private fun biyometriVarMi(): Boolean {
        val bm = getSystemService(BiometricManager::class.java) ?: return false
        return bm.canAuthenticate(yetki) == BiometricManager.BIOMETRIC_SUCCESS
    }

    private fun biyometriIste() {
        val sinyal = CancellationSignal()
        iptalSinyali = sinyal
        biyometrideMi = true
        try {
            val bp = BiometricPrompt.Builder(this)
                .setTitle("Tam yetkiyi aç")
                .setSubtitle("${asistanAdi()} bu telefonda onay ekranı olmadan okuyup yazabilecek ve gönderebilecek")
                .setAllowedAuthenticators(yetki)
                .build()
            bp.authenticate(
                sinyal,
                mainExecutor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult?) {
                        biyometrideMi = false
                        // Ekran kapandıysa ya da yeniden kurulduysa (eski örnek) bayrak açılmaz.
                        if (bitti || isFinishing || isDestroyed) return
                        TamYetki.ac(this@TamYetkiActivity)
                        bitir("acildi")
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) {
                        biyometrideMi = false
                        // Vazgeçme, kilitlenme, zaman aşımı: hepsi iptal; bayrak kapalı kalır.
                        if (bitti || isDestroyed) return
                        bitir("iptal")
                    }
                },
            )
        } catch (_: Exception) {
            biyometrideMi = false
            iptalSinyali = null
            if (!bitti) hataMetni.text = "Kimlik doğrulama başlatılamadı; tam yetki açılmadı."
        }
    }

    private fun bitir(sonuc: String) {
        if (bitti) return
        bitti = true
        iptalSinyali?.cancel()
        setResult(RESULT_OK, Intent().putExtra(EXTRA_SONUC, sonuc))
        finish()
    }

    @Deprecated("Geri tuşu iptaldir")
    override fun onBackPressed() {
        bitir("iptal")
    }

    override fun onStop() {
        super.onStop()
        // Ekrandan ayrıldıysa (ana ekran, başka uygulama) istek bayatlar; biyometri penceresi hariç.
        if (!bitti && !biyometrideMi && !isChangingConfigurations) bitir("iptal")
    }

    override fun onDestroy() {
        // Yeniden kurulumda eski örneğin istemi kapanır; geri çağrısı `isDestroyed` ile yok sayılır.
        if (!bitti) iptalSinyali?.cancel()
        super.onDestroy()
    }

    // ---------------------------------------------------------------------------------------
    // Dokunuş güvenliği (OnayActivity ile aynı)
    // ---------------------------------------------------------------------------------------

    private fun gizliDokunus(e: MotionEvent): Boolean =
        (e.flags and (FLAG_GIZLI or FLAG_KISMEN_GIZLI)) != 0

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (gizliDokunus(ev)) {
            if (::gizliUyari.isInitialized) {
                gizliUyari.text = "Ekranın üstünde başka bir pencere var; dokunuş reddedildi."
                gizliUyari.visibility = View.VISIBLE
            }
            return true
        }
        return super.dispatchTouchEvent(ev)
    }

    /** Yalnız gerçek, gizlenmemiş parmak dokunuşu eylemi tetikler; erişilebilirlik tıklaması tetiklemez. */
    private fun dugme(ad: String, renk: Int, yaziRengi: Int, kenarRengi: Int? = null, eylem: () -> Unit): Button {
        val b = Button(this)
        b.text = ad
        b.setTextColor(yaziRengi)
        b.isAllCaps = false
        b.background = GradientDrawable().apply {
            setColor(renk)
            if (kenarRengi != null) setStroke(dp(1), kenarRengi)
            cornerRadius = dp(10).toFloat()
        }
        b.filterTouchesWhenObscured = true
        var basladi = false
        b.setOnTouchListener { v, e ->
            if (gizliDokunus(e)) {
                basladi = false
                v.isPressed = false
                return@setOnTouchListener true
            }
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    basladi = true
                    v.isPressed = true
                }
                MotionEvent.ACTION_UP -> {
                    v.isPressed = false
                    val icinde = e.x >= 0 && e.y >= 0 && e.x <= v.width && e.y <= v.height
                    if (basladi && icinde) eylem()
                    basladi = false
                }
                MotionEvent.ACTION_CANCEL -> {
                    basladi = false
                    v.isPressed = false
                }
            }
            true
        }
        b.accessibilityDelegate = object : View.AccessibilityDelegate() {
            override fun performAccessibilityAction(host: View, action: Int, args: Bundle?): Boolean {
                if (action == AccessibilityNodeInfo.ACTION_CLICK ||
                    action == AccessibilityNodeInfo.ACTION_LONG_CLICK
                ) {
                    return false
                }
                return super.performAccessibilityAction(host, action, args)
            }

            override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
                super.onInitializeAccessibilityNodeInfo(host, info)
                info.removeAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_CLICK)
                info.removeAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_LONG_CLICK)
                info.isClickable = false
            }
        }
        return b
    }

    /** Tüm ağaca: örtülü dokunuşu süz, API 34+ erişilebilirlik verisini hassas say. */
    private fun guvenliYap(v: View) {
        v.filterTouchesWhenObscured = true
        if (Build.VERSION.SDK_INT >= 34) {
            v.setAccessibilityDataSensitive(View.ACCESSIBILITY_DATA_SENSITIVE_YES)
        }
        if (v is ViewGroup) for (k in 0 until v.childCount) guvenliYap(v.getChildAt(k))
    }

    // ---------------------------------------------------------------------------------------
    // Küçük yardımcılar (OnayActivity ile aynı görsel dil)
    // ---------------------------------------------------------------------------------------

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun metin(s: String, renk: Int, sp: Float, bold: Boolean = false) = TextView(this).apply {
        text = s
        setTextColor(renk)
        textSize = sp
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setTextIsSelectable(false)
        setPadding(0, dp(4), 0, dp(4))
    }

    private fun baslik(s: String) = metin(s, soluk, 13f, bold = true).apply { setPadding(0, dp(16), 0, dp(4)) }

    private fun kutu(s: String, renk: Int, kalin: Boolean = false) = metin(s, renk, 15f, bold = kalin).apply {
        setPadding(dp(12), dp(10), dp(12), dp(10))
        background = GradientDrawable().apply {
            setColor(if (renk == kirmizi) Renkler.hataZemin else Renkler.yuzey)
            setStroke(dp(1), if (renk == kirmizi) kirmizi else Renkler.kenar)
            cornerRadius = dp(8).toFloat()
        }
    }
}
