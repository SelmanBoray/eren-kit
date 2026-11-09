package dev.eren.cihaz.adaptor

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognizerIntent
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import dev.eren.cihaz.cekirdek.UygulamaDurumu

/**
 * Kısayol (sözleşme §3): kullanıcı telefonda bir uygulamaya bakarken Hızlı Ayarlar kutucuğundan ya da
 * kalıcı bildirimdeki "<ad> ile konuş" eyleminden açılır. Saydam pencere; alttaki uygulama görünür kalır.
 *
 * Akış: (1) ilk iş `KisayolDeposu.onPlan` ile ön plandaki paket yakalanır (dikte penceresi öne
 * geçmeden); (2) köprüdeki `dikte()` ile aynı RecognizerIntent (tr-TR, RECORD_AUDIO yok); (3) metin
 * gelince altta küçük kart: metin, varsa "Bağlam: <ad>", 3 sn geri sayımlı Gönder ve İptal;
 * (4) süre dolunca ya da Gönder'de `KisayolDeposu.koy` (tek çağıran burası), JS ayakta değilse
 * (`Adaptor.olaylar == null`) uygulamanın başlatıcı etkinliği açılır; sonra kapanır.
 *
 * İptal: İptal düğmesi, geri tuşu, kartın dışına dokunma, kart açıkken ekrandan ayrılma. Dikte iptal
 * ya da boşsa sessizce kapanır. Döndürmede aşama, metin, bağlam ve kalan süre korunur; dikte yeniden
 * başlatılmaz, `bitti` bayrağı ve tek seferlik geçiş çift gönderimi önler.
 *
 * Kartta gösterilen bağlam ile gönderilen bağlam aynıdır: ad gösterilemiyorsa (hassas/değişmez liste,
 * çekirdek yok, etiket okunamadı) paket de gönderilmez.
 */
class KisayolActivity : Activity() {

    private companion object {
        const val ISTEK_DIKTE = 0x4B01
        const val GERI_SAYIM_MS = 3000L
        const val AD_EN_COK = 80
        const val KART_AZAMI_DP = 480

        const val ASAMA_DIKTE = 0
        const val ASAMA_KART = 1

        const val D_ASAMA = "asama"
        const val D_BITTI = "bitti"
        const val D_PAKET = "paket"
        const val D_AD = "ad"
        const val D_METIN = "metin"
        const val D_KALAN = "kalan_ms"
    }

    private val ana = Handler(Looper.getMainLooper())

    private var asama = ASAMA_DIKTE
    private var bitti = false
    private var paket: String? = null
    private var ad: String? = null
    private var metin = ""

    // Geri sayımın bittiği an (elapsedRealtime).
    private var sonMs = 0L

    private lateinit var kok: FrameLayout
    private var gonderDugmesi: Button? = null

    private val tik = object : Runnable {
        override fun run() {
            if (bitti || asama != ASAMA_KART) return
            val kalan = sonMs - SystemClock.elapsedRealtime()
            if (kalan <= 0) {
                gonder()
                return
            }
            gonderDugmesi?.text = gonderYazisi(kalan)
            // Bir sonraki tam saniye sınırında yeniden bak.
            ana.postDelayed(this, (kalan - 1) % 1000 + 1)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val kayit = savedInstanceState
        if (kayit == null) {
            // İlk iş: dikte penceresi öne geçmeden kullanıcının baktığı uygulama.
            paket = KisayolDeposu.onPlan(this)
        } else {
            asama = kayit.getInt(D_ASAMA, ASAMA_DIKTE)
            bitti = kayit.getBoolean(D_BITTI, false)
            paket = kayit.getString(D_PAKET)
            ad = kayit.getString(D_AD)
            metin = kayit.getString(D_METIN).orEmpty()
            val kalan = kayit.getLong(D_KALAN, GERI_SAYIM_MS).coerceIn(0L, GERI_SAYIM_MS)
            sonMs = SystemClock.elapsedRealtime() + kalan
        }
        if (bitti) {
            finish()
            return
        }

        window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        kok = FrameLayout(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            // Kartın dışına dokunma iptaldir. Görünmez tam ekran alan ekran okuyucuya sunulmaz.
            isClickable = true
            setOnClickListener { iptal() }
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            setOnApplyWindowInsetsListener { v, ic ->
                val i = ic.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                v.setPadding(i.left, i.top, i.right, i.bottom)
                ic
            }
        }
        setContentView(kok)

        if (kayit == null) {
            dikteBaslat()
        } else if (asama == ASAMA_KART) {
            if (metin.isEmpty()) {
                kapat()
            } else {
                kartiKur()
                ana.post(tik)
            }
        }
        // Dikte sürerken yeniden kurulduysa: sonuç onActivityResult ile bu örneğe gelir; yeniden başlatılmaz.
    }

    // ---------------------------------------------------------------------------------------------
    // Dikte
    // ---------------------------------------------------------------------------------------------

    /** Köprüdeki `dikte()` ile aynı ayarlar. */
    private fun dikteBaslat() {
        val niyet = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "tr-TR")
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        try {
            startActivityForResult(niyet, ISTEK_DIKTE)
        } catch (_: ActivityNotFoundException) {
            bildir("Bu telefonda ses tanıma bulunamadı.")
            kapat()
        } catch (_: SecurityException) {
            bildir("Ses tanıma açılamadı.")
            kapat()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != ISTEK_DIKTE || bitti || asama != ASAMA_DIKTE) return
        val m = if (resultCode == RESULT_OK) {
            data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim()
        } else {
            null
        }
        if (m.isNullOrEmpty()) return kapat()
        metin = m
        ad = baglamAdi(paket)
        // Kartta gösterilmeyen bağlam gönderilmez.
        if (ad == null) paket = null
        asama = ASAMA_KART
        sonMs = SystemClock.elapsedRealtime() + GERI_SAYIM_MS
        kartiKur()
        ana.post(tik)
    }

    // ---------------------------------------------------------------------------------------------
    // Kart
    // ---------------------------------------------------------------------------------------------

    private fun kartiKur() {
        kok.removeAllViews()
        val kart = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = GradientDrawable().apply {
                setColor(Renkler.yuzey)
                setStroke(dp(1), Renkler.kenar)
                cornerRadius = dp(16).toFloat()
            }
            elevation = dp(8).toFloat()
            // Kartın boş yerine dokunuş "dışarı" sayılmaz.
            isClickable = true
        }
        kart.addView(yazi("${asistanAdi()} oturumuna gidecek", Renkler.metinIkincil, 13f, kalin = true))
        kart.addView(
            yazi(temiz(metin), Renkler.metin, 17f).apply {
                maxLines = 6
                ellipsize = TextUtils.TruncateAt.END
                setPadding(0, dp(6), 0, dp(4))
            },
        )
        ad?.let { kart.addView(yazi("Bağlam: " + temiz(it), Renkler.metinIkincil, 13f)) }

        val satir = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(12), 0, 0)
        }
        satir.addView(
            dugme("İptal", Color.TRANSPARENT, Renkler.metin, Renkler.kenarGuclu) { iptal() },
            LinearLayout.LayoutParams(0, dp(48), 1f).apply { rightMargin = dp(6) },
        )
        val gonder = dugme(
            gonderYazisi(sonMs - SystemClock.elapsedRealtime()),
            Renkler.vurgu,
            Renkler.dolguUstu,
            null,
        ) { gonder() }
        gonderDugmesi = gonder
        satir.addView(gonder, LinearLayout.LayoutParams(0, dp(48), 1f).apply { leftMargin = dp(6) })
        kart.addView(satir)

        val genis = resources.configuration.screenWidthDp > KART_AZAMI_DP + 24
        val yer = FrameLayout.LayoutParams(
            if (genis) dp(KART_AZAMI_DP) else ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL,
        ).apply { setMargins(dp(12), 0, dp(12), dp(16)) }
        kok.addView(kart, yer)
    }

    private fun gonderYazisi(kalanMs: Long): String = "Gönder (${(kalanMs.coerceAtLeast(0L) + 999) / 1000})"

    /**
     * Ön plandaki paketin görünen adı; yalnız çekirdek ayaktayken ve paket hassas/değişmez listede
     * değilken (`KisayolDeposu.koy` ile aynı süzgeç). Kontrol karakterleri ayıklanır, en çok 80.
     */
    private fun baglamAdi(p: String?): String? {
        if (p == null) return null
        val listeler = Adaptor.cekirdek?.listeler ?: return null
        val uygun = try {
            when (listeler.durum(p)) {
                UygulamaDurumu.HASSAS, UygulamaDurumu.DEGISMEZ -> false
                else -> true
            }
        } catch (_: Exception) {
            false
        }
        if (!uygun) return null
        return try {
            @Suppress("DEPRECATION")
            val ham = packageManager.getApplicationLabel(packageManager.getApplicationInfo(p, 0)).toString()
            val sb = StringBuilder(ham.length)
            for (c in ham) {
                if (c.code < 0x20 || c.code in 0x7F..0x9F) continue
                sb.append(c)
            }
            var s = sb.toString().trim()
            if (s.length > AD_EN_COK) {
                var son = AD_EN_COK
                // Vekil çiftini ortadan bölme.
                if (Character.isHighSurrogate(s[son - 1])) son--
                s = s.substring(0, son).trim()
            }
            s.ifEmpty { null }
        } catch (_: Exception) {
            null
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Gönder / iptal
    // ---------------------------------------------------------------------------------------------

    private fun gonder() {
        if (bitti || asama != ASAMA_KART) return
        bitti = true
        ana.removeCallbacksAndMessages(null)
        val tamam = try {
            KisayolDeposu.koy(this, metin, paket)
            true
        } catch (_: Exception) {
            false
        }
        if (!tamam) {
            bildir("${asistanAdi()} oturumuna iletilemedi.")
        } else if (Adaptor.olaylar == null) {
            // JS ayakta değil: uygulama açılınca `kisayolAl` ile yuvadan çeker.
            uygulamayiAc()
        }
        finish()
    }

    private fun uygulamayiAc() {
        val niyet = packageManager.getLaunchIntentForPackage(packageName) ?: return
        niyet.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startActivity(niyet)
        } catch (_: ActivityNotFoundException) {
        } catch (_: SecurityException) {
        }
    }

    private fun iptal() = kapat()

    /** Göndermeden kapanır. Dikte sürüyorsa tanıyıcı da kapatılır (sonucu sahipsiz kalmasın). */
    private fun kapat() {
        if (bitti) return
        bitti = true
        ana.removeCallbacksAndMessages(null)
        if (asama == ASAMA_DIKTE) {
            try {
                finishActivity(ISTEK_DIKTE)
            } catch (_: Exception) {
            }
        }
        finish()
    }

    @Deprecated("Geri tuşu iptaldir")
    override fun onBackPressed() {
        iptal()
    }

    override fun onStop() {
        super.onStop()
        // Kart açıkken ekrandan ayrılmak (ana ekran, başka uygulama, ekranın kapanması) iptaldir;
        // döndürme değildir. Dikte sürerken tanıyıcı bizi örtebilir; o durum iptal sayılmaz.
        if (asama == ASAMA_KART && !bitti && !isChangingConfigurations) iptal()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt(D_ASAMA, asama)
        outState.putBoolean(D_BITTI, bitti)
        outState.putString(D_PAKET, paket)
        outState.putString(D_AD, ad)
        outState.putString(D_METIN, metin)
        val kalan = if (asama == ASAMA_KART) sonMs - SystemClock.elapsedRealtime() else GERI_SAYIM_MS
        outState.putLong(D_KALAN, kalan.coerceIn(0L, GERI_SAYIM_MS))
    }

    override fun onDestroy() {
        ana.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    // ---------------------------------------------------------------------------------------------
    // Küçük yardımcılar (görsel dil OnayActivity ile aynı)
    // ---------------------------------------------------------------------------------------------

    private fun bildir(s: String) {
        try {
            Toast.makeText(applicationContext, s, Toast.LENGTH_SHORT).show()
        } catch (_: Exception) {
        }
    }

    /** Görünmez/yön değiştiren denetim karakterleri görünür işaretle değişir (yalnız gösterim). */
    private fun temiz(s: String): String {
        val sb = StringBuilder(s.length)
        for (ch in s) {
            val t = Character.getType(ch)
            val kotu = (t == Character.FORMAT.toInt() || t == Character.CONTROL.toInt() ||
                t == Character.LINE_SEPARATOR.toInt() || t == Character.PARAGRAPH_SEPARATOR.toInt()) &&
                ch != '\n' && ch != '\t'
            sb.append(if (kotu) '·' else ch)
        }
        return sb.toString()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun yazi(s: String, renk: Int, sp: Float, kalin: Boolean = false) = TextView(this).apply {
        text = s
        setTextColor(renk)
        textSize = sp
        if (kalin) setTypeface(typeface, Typeface.BOLD)
        setTextIsSelectable(false)
        setPadding(0, dp(2), 0, dp(2))
    }

    private fun dugme(ad: String, renk: Int, yaziRengi: Int, kenarRengi: Int?, eylem: () -> Unit): Button {
        val b = Button(this)
        b.text = ad
        b.setTextColor(yaziRengi)
        b.isAllCaps = false
        b.textSize = 15f
        b.background = GradientDrawable().apply {
            setColor(renk)
            if (kenarRengi != null) setStroke(dp(1), kenarRengi)
            cornerRadius = dp(10).toFloat()
        }
        b.setOnClickListener { eylem() }
        return b
    }
}
