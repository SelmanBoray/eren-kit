package dev.eren.cihaz.adaptor

import android.app.Activity
import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Tanılama: hata ayıklamanın tek yeri (ADB ve logcat yok). Salt okuma. Ekran metni, jeton,
 * eşleşme anahtarı ve istisna iletisi gösterilmez; yalnız durum, tür ve yığın.
 */
class TanilamaActivity : Activity() {
    private val arka = Executors.newSingleThreadExecutor()
    private lateinit var govde: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        val kok = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        kok.addView(Button(this).apply {
            text = "Yenile"
            isAllCaps = false
            setTextColor(Renkler.metin)
            background = StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_pressed), dugmeKutusu(Renkler.basili))
                addState(intArrayOf(), dugmeKutusu(Color.TRANSPARENT))
            }
            setOnClickListener { yukle() }
        })
        govde = TextView(this).apply {
            textSize = 13f
            setTextColor(Renkler.metin)
            typeface = android.graphics.Typeface.MONOSPACE
            setTextIsSelectable(true)
        }
        kok.addView(govde)
        setContentView(ScrollView(this).apply {
            setBackgroundColor(Renkler.zemin)
            addView(kok, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        })
        yukle()
    }

    override fun onDestroy() {
        arka.shutdownNow()
        super.onDestroy()
    }

    private fun yukle() {
        govde.text = "Yükleniyor…"
        arka.execute {
            val metin = try {
                rapor()
            } catch (_: Exception) {
                "Rapor kurulamadı."
            }
            runOnUiThread { if (!isDestroyed) govde.text = metin }
        }
    }

    private fun rapor(): String {
        val sb = StringBuilder()
        val c = Adaptor.cekirdek

        sb.append("DURUM\n")
        sb.append("servis: ").append(if (c != null) "çalışıyor" else "çalışmıyor").append('\n')
        val baglanti = Adaptor.oturumGuncelle
        val bagli = (baglanti as? Baglanti)?.baglimi() ?: false
        sb.append("/cihaz: ").append(
            when {
                baglanti == null -> "bağlantı sürücüsü yok"
                bagli -> "bağlı"
                else -> "bağlı değil"
            },
        ).append('\n')
        val a11y = try { c?.ekran?.durum()?.a11y } catch (_: Exception) { null }
        sb.append("erişilebilirlik (canlı): ").append(
            when (a11y) { true -> "bağlı"; false -> "bağlı değil"; null -> "bilinmiyor" },
        ).append('\n')
        sb.append("erişilebilirlik (sistem ayarı): ")
            .append(if (erisimAyarAcik()) "açık" else "kapalı").append('\n')
        sb.append(eslesmeSatiri()).append('\n')

        sb.append("\nANA İPLİK TAKILMALARI (2 sn üstü, en yeni üstte)\n")
        sb.append(AnaIplikBekcisi.oku(this))

        sb.append("\nSON ÇIKIŞ NEDENLERİ\n")
        sb.append(cikislar())

        sb.append("\nSON YAKALANMAMIŞ İSTİSNA\n")
        sb.append(istisna())
        return sb.toString()
    }

    private fun erisimAyarAcik(): Boolean {
        val hedef = "$packageName/dev.eren.cihaz.adaptor.ErisimServisi"
        val ham = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            ?: return false
        return ham.split(':').any { it.equals(hedef, ignoreCase = true) }
    }

    /** Adres gösterilir; PC açık anahtarı ve jeton okunmaz. */
    private fun eslesmeSatiri(): String {
        val e = try { EslesmeDeposu(this).oku() } catch (_: Exception) { null }
            ?: return "eşleşme: yok"
        return "eşleşme: var (${guvenli(e.host, 80)}:${e.port})"
    }

    private fun cikislar(): String {
        val am = getSystemService(ActivityManager::class.java) ?: return "okunamadı\n"
        val liste = try {
            am.getHistoricalProcessExitReasons(null, 0, 8)
        } catch (_: Exception) {
            return "okunamadı\n"
        }
        if (liste.isEmpty()) return "kayıt yok\n"
        val bicim = SimpleDateFormat("dd.MM HH:mm:ss", Locale.getDefault())
        val sb = StringBuilder()
        var izler = 0
        for (e in liste) {
            sb.append(bicim.format(Date(e.timestamp))).append("  ")
                .append(neden(e.reason)).append(" (durum ").append(e.status).append(")\n")
            val ac = e.description
            if (!ac.isNullOrEmpty()) sb.append("  ").append(guvenli(ac, 100)).append('\n')
            // ANR izi: ANR'de süreç öldüyse o kayıtta; "Bekle" sonrası başka nedenle öldüyse de o kayda
            // eklenir. Native çökmenin izi ikili tombstone'dur, okunmaz.
            if (izler < IZ_AZAMI_KAYIT && e.reason != ApplicationExitInfo.REASON_CRASH_NATIVE) {
                val y = anaYigin(e)
                if (y.isNotEmpty()) {
                    izler++
                    sb.append("  ANR izi:\n")
                    y.forEach { sb.append("    ").append(it).append('\n') }
                }
            }
        }
        return sb.toString()
    }

    /**
     * Sistem izinden (ANR anındaki iplik dökümü) yalnız ana ipliğin ve, ana iplik bir kilit
     * bekliyorsa, kilidi tutan ipliğin çerçeveleri (`at`/`- ` satırları). Başka metin alınmaz.
     */
    private fun anaYigin(e: ApplicationExitInfo): List<String> {
        val akis = try {
            e.traceInputStream
        } catch (_: Exception) {
            null
        } ?: return emptyList()
        val cikti = ArrayList<String>()
        try {
            akis.bufferedReader(Charsets.UTF_8).use { r ->
                var bolum = 0 // 0 dışarıda, 1 ana iplik, 2 kilidi tutan iplik
                var sayac = 0
                var tutan: String? = null
                var anaBitti = false
                var okunan = 0
                while (true) {
                    val satir = r.readLine() ?: break
                    if (++okunan > IZ_AZAMI_SATIR) break
                    if (satir.startsWith("\"")) {
                        bolum = when {
                            !anaBitti && satir.startsWith("\"main\"") && satir.contains(" tid=1 ") -> 1
                            tutan != null && satir.contains(" tid=$tutan ") -> 2
                            else -> 0
                        }
                        sayac = 0
                        when (bolum) {
                            1 -> cikti.add("main: " + durumKelimesi(satir))
                            2 -> cikti.add("kilidi tutan iplik (tid $tutan): " + durumKelimesi(satir))
                        }
                        continue
                    }
                    if (bolum == 0) continue
                    val s = satir.trim()
                    if (s.isEmpty()) {
                        if (bolum == 2) break
                        anaBitti = true
                        if (tutan == null) break
                        bolum = 0
                        continue
                    }
                    if (!s.startsWith("at ") && !s.startsWith("- ")) continue
                    if (sayac < (if (bolum == 1) ANA_CERCEVE else TUTAN_CERCEVE)) {
                        cikti.add(guvenli(s, 160))
                        sayac++
                    }
                    if (bolum == 1 && tutan == null) KILIT_SAHIBI.find(s)?.let { tutan = it.groupValues[1] }
                }
            }
        } catch (_: Exception) {
            // Okunabilen kadarı gösterilir.
        }
        return cikti
    }

    /** `"main" prio=5 tid=1 Blocked` → `Blocked`. */
    private fun durumKelimesi(baslik: String): String =
        baslik.trim().substringAfterLast(' ').filter { it.isLetter() }.take(20).ifEmpty { "?" }

    private fun neden(k: Int): String = when (k) {
        ApplicationExitInfo.REASON_ANR -> "ANR"
        ApplicationExitInfo.REASON_CRASH -> "çökme (Java)"
        ApplicationExitInfo.REASON_CRASH_NATIVE -> "çökme (native)"
        ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "bağımlılık öldü"
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "aşırı kaynak"
        ApplicationExitInfo.REASON_EXIT_SELF -> "kendi çıktı"
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "başlatma hatası"
        ApplicationExitInfo.REASON_LOW_MEMORY -> "bellek yetersiz"
        ApplicationExitInfo.REASON_OTHER -> "diğer"
        ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "izin değişti"
        ApplicationExitInfo.REASON_SIGNALED -> "sinyal"
        ApplicationExitInfo.REASON_USER_REQUESTED -> "kullanıcı kapattı"
        ApplicationExitInfo.REASON_USER_STOPPED -> "kullanıcı durdurdu"
        ApplicationExitInfo.REASON_FREEZER -> "dondurucu"
        else -> "bilinmeyen ($k)"
    }

    /** Dosyadan yalnız sınıf adları ve `at` satırları alınır; iletiler (`: ...`) kesilir. */
    private fun istisna(): String {
        val f = File(filesDir, ISTISNA_DOSYASI)
        if (!f.isFile) return "kayıt yok\n"
        val satirlar = try {
            f.useLines { it.take(200).toList() }
        } catch (_: Exception) {
            return "okunamadı\n"
        }
        val sb = StringBuilder()
        var yazilan = 0
        for ((i, ham) in satirlar.withIndex()) {
            val s = ham.trim()
            val cikti = when {
                i == 0 -> s.substringBefore(':')
                s.startsWith("Caused by:") -> "Caused by: " + s.removePrefix("Caused by:").trim().substringBefore(':')
                s.startsWith("at ") -> s
                else -> continue
            }
            sb.append(guvenli(cikti, 160)).append('\n')
            if (++yazilan >= 40) break
        }
        return if (sb.isEmpty()) "kayıt boş\n" else sb.toString()
    }

    private fun guvenli(s: String, azami: Int): String =
        s.filter { !it.isISOControl() }.let { if (it.length > azami) it.substring(0, azami) + "…" else it }

    private fun dp(n: Int): Int = (n * resources.displayMetrics.density).toInt()

    private fun dugmeKutusu(renk: Int) = GradientDrawable().apply {
        setColor(renk)
        setStroke(dp(1), Renkler.kenarGuclu)
        cornerRadius = dp(10).toFloat()
    }

    private companion object {
        /** Yakalanmamış istisna dosyası (`filesDir` altında): ilk satır tür[: ileti], sonra yığın. */
        const val ISTISNA_DOSYASI = "yakalanmamis_istisna.txt"
        const val IZ_AZAMI_KAYIT = 3
        const val IZ_AZAMI_SATIR = 200_000
        const val ANA_CERCEVE = 30
        const val TUTAN_CERCEVE = 15
        val KILIT_SAHIBI = Regex("held by thread (\\d+)")
    }
}

/**
 * Ana iplik bekçisi. "Bekle" denen ANR'de süreç ölmez, ApplicationExitInfo'ya kayıt düşmez; bekçi
 * ana iplik `ESIK_MS`'den uzun yanıt vermezse o anki yığınını ve o an uygulamanın kendi (`dev.eren`) kodunda çalışan
 * ipliklerin yığınlarını yazar. Yalnız çerçeveler (sınıf.yöntem(dosya:satır)); ileti, ekran metni,
 * jeton yok. Son `AZAMI_KAYIT` kayıt `filesDir/DOSYA`'da durur. Süreç başına tek iplik; ana ipliğe
 * saniyede bir boş ileti bırakır.
 */
internal object AnaIplikBekcisi {
    private const val DOSYA = "ana_iplik_takilma.txt"
    private const val ESIK_MS = 2_000L
    private const val ARALIK_MS = 1_000L
    private const val AZAMI_BEKLEME_MS = 120_000L
    private const val AZAMI_KAYIT = 3
    private const val ANA_CERCEVE = 30
    private const val DIGER_CERCEVE = 12
    private const val DIGER_IPLIK = 4

    private var basladi = false

    @Synchronized
    fun baslat(ctx: Context) {
        if (basladi) return
        basladi = true
        val uygulama = ctx.applicationContext
        Thread({ dongu(uygulama) }, "eren-ana-bekci").apply { isDaemon = true }.start()
    }

    fun oku(ctx: Context): String {
        val f = File(ctx.filesDir, DOSYA)
        if (!f.isFile) return "kayıt yok\n"
        return try {
            f.readText(Charsets.UTF_8).ifEmpty { "kayıt yok\n" }
        } catch (_: Exception) {
            "okunamadı\n"
        }
    }

    private fun dongu(ctx: Context) {
        val looper = Looper.getMainLooper()
        val ana = Handler(looper)
        val anaIplik = looper.thread
        while (true) {
            try {
                val yanit = AtomicBoolean(false)
                val bas = SystemClock.uptimeMillis()
                ana.post { yanit.set(true) }
                Thread.sleep(ESIK_MS)
                if (!yanit.get()) {
                    val durum = anaIplik.state
                    val yigin = anaIplik.stackTrace
                    val digerleri = erenIplikleri(anaIplik)
                    while (!yanit.get() && SystemClock.uptimeMillis() - bas < AZAMI_BEKLEME_MS) Thread.sleep(100)
                    val sure = SystemClock.uptimeMillis() - bas
                    // Uykudan uyanışta ana iplik boşta bekliyorsa (nativePollOnce) takılma sayılmaz.
                    if (sure >= ESIK_MS && !bosta(yigin)) yaz(ctx, sure, yanit.get(), durum, yigin, digerleri)
                }
                Thread.sleep(ARALIK_MS)
            } catch (_: InterruptedException) {
                return
            } catch (_: Throwable) {
                try {
                    Thread.sleep(ARALIK_MS)
                } catch (_: InterruptedException) {
                    return
                }
            }
        }
    }

    private fun bosta(y: Array<StackTraceElement>): Boolean =
        y.firstOrNull()?.let { it.className == "android.os.MessageQueue" && it.methodName == "nativePollOnce" } == true

    /** O an uygulamanın kendi (`dev.eren`) kodunda olan iplikler (kilit sahibi genelde bunlardan biridir). */
    private fun erenIplikleri(ana: Thread): List<Pair<Thread, Array<StackTraceElement>>> = try {
        val ben = Thread.currentThread()
        Thread.getAllStackTraces().entries
            .filter { (t, y) -> t !== ana && t !== ben && y.any { it.className.startsWith("dev.eren.") } }
            .take(DIGER_IPLIK)
            .map { it.key to it.value }
    } catch (_: Throwable) {
        emptyList()
    }

    private fun yaz(
        ctx: Context,
        sure: Long,
        bitti: Boolean,
        durum: Thread.State,
        yigin: Array<StackTraceElement>,
        digerleri: List<Pair<Thread, Array<StackTraceElement>>>,
    ) {
        try {
            val sb = StringBuilder()
            sb.append("=== ").append(SimpleDateFormat("dd.MM HH:mm:ss", Locale.US).format(Date()))
                .append("  ").append(sure).append(" ms").append(if (bitti) "" else "+")
                .append("  main: ").append(durum.name).append('\n')
            yigin.take(ANA_CERCEVE).forEach { sb.append("at ").append(it.toString()).append('\n') }
            for ((t, y) in digerleri) {
                // OkHttp iplik adı adres taşır: yalnız ilk sözcük.
                val ad = t.name.substringBefore(' ').filter { it.isLetterOrDigit() || it in "-_." }.take(32)
                sb.append("-- ").append(ad).append(" (").append(t.state.name).append(")\n")
                y.take(DIGER_CERCEVE).forEach { sb.append("at ").append(it.toString()).append('\n') }
            }
            val f = File(ctx.filesDir, DOSYA)
            val eski = try {
                if (f.isFile) f.readText(Charsets.UTF_8) else ""
            } catch (_: Exception) {
                ""
            }
            val kayitlar = (listOf(sb.toString()) + kayitlaraBol(eski)).take(AZAMI_KAYIT)
            val gecici = File(ctx.filesDir, "$DOSYA.tmp")
            gecici.writeText(kayitlar.joinToString(""), Charsets.UTF_8)
            if (!gecici.renameTo(f)) {
                f.delete()
                gecici.renameTo(f)
            }
        } catch (_: Exception) {
            // Yazılamadı: kayıt düşer.
        }
    }

    private fun kayitlaraBol(metin: String): List<String> {
        val sonuc = ArrayList<String>()
        val sb = StringBuilder()
        for (s in metin.lineSequence()) {
            if (s.startsWith("=== ") && sb.isNotEmpty()) {
                sonuc.add(sb.toString())
                sb.setLength(0)
            }
            if (s.isNotEmpty()) sb.append(s).append('\n')
        }
        if (sb.isNotEmpty()) sonuc.add(sb.toString())
        return sonuc
    }
}
