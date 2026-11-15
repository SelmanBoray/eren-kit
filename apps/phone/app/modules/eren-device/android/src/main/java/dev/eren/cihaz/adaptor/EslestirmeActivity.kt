package dev.eren.cihaz.adaptor

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import dev.eren.cihaz.cekirdek.Json
import dev.eren.cihaz.cekirdek.JsonDeger
import dev.eren.cihaz.cekirdek.JsonSonucu
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** Tailscale CGNAT 100.64.0.0/10; baştaki sıfır reddedilir (sunucudan sıkı, sekizlik yorumu yok). */
private fun hostGecerliMi(host: String): Boolean {
    if (host.length > 15) return false
    val m = Regex("""^100\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$""").matchEntire(host) ?: return false
    val (b, c, d) = m.destructured
    return b.toInt() in 64..127 && c.toInt() <= 255 && d.toInt() <= 255
}

class EslestirmeActivity : Activity() {

    companion object {
        /** Result Intent extra anahtarları: `EslestirSonucu{sonuc, kod?}`. `kod` hiç doldurulmaz (tek kullanımlık sır). */
        const val EXTRA_SONUC = "sonuc"
        const val EXTRA_KOD = "kod"
        const val SONUC_TAMAM = "tamam"
        const val SONUC_IPTAL = "iptal"
        const val SONUC_HATA = "hata"

        private const val ZAMAN_ASIMI_MS = 15_000L
        private const val AZAMI_CERCEVE = 4096
        private val KOD_DESENI = Regex("^[A-Z0-9]+$")
        private val BASE64_DESENI = Regex("^[A-Za-z0-9+/]+={0,2}$")
        private val OPAK_ID_DESENI = Regex("^[A-Za-z0-9_-]{1,64}$")
    }

    /** Eşleştirme girdisi: QR'dan geliyorsa `pcAnahtar` bilinir, elle girişte `null`. */
    private class Hedef(val host: String, val port: Int, val kod: String, val pcAnahtar: String?)

    private val ana = Handler(Looper.getMainLooper())
    private val bitti = AtomicBoolean(false)
    private var soket: WebSocket? = null
    private var istemci: OkHttpClient? = null
    private var biyometriIptal: CancellationSignal? = null
    private var zamanAsimi: Runnable? = null
    private var kok: LinearLayout? = null
    private val arka = Executors.newSingleThreadExecutor()
    private var hazirlaniyor = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        val sv = ScrollView(this).apply { setBackgroundColor(Renkler.zemin) }
        val k = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val d = (resources.displayMetrics.density * 20).toInt()
            setPadding(d, d * 2, d, d)
            filterTouchesWhenObscured = true
        }
        sv.addView(k, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        sv.filterTouchesWhenObscured = true
        setContentView(sv)
        kok = k

        if (savedInstanceState != null) {
            // Süreç yeniden yaratıldıysa yarım akış sürdürülmez.
            bitir(SONUC_IPTAL)
            return
        }
        if (EslesmeDeposu(this).oku() != null) yenidenEslestirmeBiyometri() else taramayaBasla()
    }

    override fun onDestroy() {
        biyometriIptal?.cancel()
        baglantiyiKapat()
        arka.shutdown()
        super.onDestroy()
    }

    @Deprecated("Geri tuşu eşleştirmeyi iptal eder")
    override fun onBackPressed() {
        bitir(SONUC_IPTAL)
    }

    // ---------------------------------------------------------------------------------------------
    // Başlangıç: yeniden eşleştirmede biyometri, sonra QR tarama
    // ---------------------------------------------------------------------------------------------

    private fun yenidenEslestirmeBiyometri() {
        val kimlikler = BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
        val bm = getSystemService(BiometricManager::class.java)
        if (bm == null || bm.canAuthenticate(kimlikler) != BiometricManager.BIOMETRIC_SUCCESS) {
            // Doğrulama yapılamıyorsa mevcut eşleşme üzerine yazılmaz.
            bitir(SONUC_HATA)
            return
        }
        val iptal = CancellationSignal()
        biyometriIptal = iptal
        val istem = BiometricPrompt.Builder(this)
            .setTitle("Yeniden eşleştirme")
            .setSubtitle("Mevcut eşleşmenin yerine yenisi yazılacak; tam yetki açıksa kapanır")
            .setAllowedAuthenticators(kimlikler)
            .build()
        istem.authenticate(
            iptal,
            mainExecutor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult?) {
                    taramayaBasla()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) {
                    if (isFinishing) return
                    val iptalMi = errorCode == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED ||
                        errorCode == BiometricPrompt.BIOMETRIC_ERROR_CANCELED
                    bitir(if (iptalMi) SONUC_IPTAL else SONUC_HATA)
                }
            },
        )
    }

    private fun taramayaBasla() {
        if (isFinishing) return
        durum("QR kod okunuyor...", null)
        try {
            val secenek = GmsBarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build()
            GmsBarcodeScanning.getClient(this, secenek).startScan()
                .addOnSuccessListener { b -> qrGeldi(b.rawValue) }
                .addOnCanceledListener { elleGirisFormu("QR okuma iptal edildi.") }
                // Tarayıcı modülü yoksa ya da açılamadıysa elle girişe düş.
                .addOnFailureListener { elleGirisFormu("QR tarayıcı kullanılamıyor.") }
        } catch (_: Exception) {
            elleGirisFormu("QR tarayıcı kullanılamıyor.")
        }
    }

    // ---------------------------------------------------------------------------------------------
    // QR doğrulama ve onay ekranı
    // ---------------------------------------------------------------------------------------------

    private fun qrGeldi(ham: String?) {
        if (isFinishing) return
        val hedef = ham?.let { qrCoz(it) }
        if (hedef == null) {
            elleGirisFormu("QR geçersiz.")
            return
        }
        val parmak = parmakIzi(hedef.pcAnahtar!!)
        if (parmak == null) {
            elleGirisFormu("QR geçersiz.")
            return
        }
        onayEkrani(hedef, parmak) { baglan(hedef) }
    }

    /** `EslestirmeQr` (protocol/sohbet.ts) ile aynı katılık: yalnız bilinen 5 alan, tam eşleşme. */
    private fun qrCoz(ham: String): Hedef? {
        if (ham.length > 1024) return null
        val kok = (Json.coz(ham) as? JsonSonucu.Tamam)?.deger as? JsonDeger.Nesne ?: return null
        val a = kok.alanlar
        if (a.keys != setOf("v", "host", "port", "kod", "server_public_key")) return null
        if ((a["v"] as? JsonDeger.Tam)?.deger != 1L) return null
        val host = (a["host"] as? JsonDeger.Metin)?.deger ?: return null
        val port = (a["port"] as? JsonDeger.Tam)?.deger ?: return null
        val kod = (a["kod"] as? JsonDeger.Metin)?.deger ?: return null
        val anahtar = (a["server_public_key"] as? JsonDeger.Metin)?.deger ?: return null
        if (!hostGecerliMi(host) || port !in 1L..65535L) return null
        if (kod.length !in 6..32 || !KOD_DESENI.matches(kod)) return null
        if (anahtar.isEmpty() || anahtar.length > 256 || !BASE64_DESENI.matches(anahtar)) return null
        return Hedef(host, port.toInt(), kod, anahtar)
    }

    /** SPKI DER'in SHA-256'sı, 4'lü gruplar, büyük harf. Çözülemezse `null`. */
    private fun parmakIzi(anahtarB64: String): String? = try {
        val der = Base64.getDecoder().decode(anahtarB64)
        if (der.isEmpty()) null
        else MessageDigest.getInstance("SHA-256").digest(der)
            .joinToString("") { "%02X".format(it) }
            .chunked(4).joinToString(" ")
    } catch (_: Exception) {
        null
    }

    private fun onayEkrani(hedef: Hedef, parmak: String, onay: () -> Unit) {
        val k = kok ?: return
        k.removeAllViews()
        k.addView(baslik("PC'yi doğrula"))
        k.addView(metin("Aşağıdaki parmak izini PC'de eşleştirme komutunun yazdığıyla karşılaştır. Aynı değilse onaylama."))
        k.addView(alan("Adres", hedef.host))
        k.addView(alan("Port", hedef.port.toString()))
        k.addView(alan("PC anahtar parmak izi", parmak, mono = true))
        k.addView(dugme("Aynı, eşleştir", birincil = true) { onay() })
        k.addView(dugme("İptal") { bitir(SONUC_IPTAL) })
    }

    // ---------------------------------------------------------------------------------------------
    // Elle giriş (adres, port, 8 karakter kod). PC anahtarı yoldan sonra görülür ve onaylanır.
    // ---------------------------------------------------------------------------------------------

    private fun elleGirisFormu(uyari: String) {
        if (isFinishing) return
        val k = kok ?: return
        k.removeAllViews()
        k.addView(baslik("Elle eşleştir"))
        if (uyari.isNotEmpty()) k.addView(metin(uyari))
        val host = girdi("PC adresi (100.x.y.z)", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, 15)
        val port = girdi("Port", InputType.TYPE_CLASS_NUMBER, 5)
        val kod = girdi(
            "Eşleştirme kodu (8 karakter)",
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or
                InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
            8,
        )
        val hata = metin("")
        k.addView(host)
        k.addView(port)
        k.addView(kod)
        k.addView(hata)
        k.addView(dugme("Eşleştir", birincil = true) {
            val h = host.text.toString().trim()
            val p = port.text.toString().trim().toIntOrNull()
            val c = kod.text.toString().trim().uppercase()
            when {
                !hostGecerliMi(h) -> hata.text = "Adres 100.64.0.0/10 aralığında olmalı."
                p == null || p !in 1..65535 -> hata.text = "Port 1-65535 olmalı."
                c.length != 8 || !KOD_DESENI.matches(c) -> hata.text = "Kod 8 harf ya da rakam olmalı."
                else -> baglan(Hedef(h, p, c, null))
            }
        })
        k.addView(dugme("QR ile dene") { taramayaBasla() })
        k.addView(dugme("İptal") { bitir(SONUC_IPTAL) })
    }

    // ---------------------------------------------------------------------------------------------
    // Kısa ömürlü /sohbet bağlantısı: pair_request -> pair_result
    // ---------------------------------------------------------------------------------------------

    /**
     * İlk eşleşmede anahtar üretilir (StrongBox denemesi saniyeler sürebilir) ve OkHttp/TLS ilk kez
     * kurulur: ikisi de arka iplikte; soket yalnız ana iplikte açılıp kapanır.
     */
    private fun baglan(hedef: Hedef) {
        if (isFinishing || soket != null || hazirlaniyor) return
        hazirlaniyor = true
        durum("Bağlanıyor...", null)
        try {
            arka.execute {
                val anahtar = try {
                    (Adaptor.cekirdek?.anahtar ?: AnahtarDeposu()).acikAnahtar()
                } catch (_: Exception) {
                    null
                }
                val c = if (anahtar == null) {
                    null
                } else {
                    try {
                        OkHttpClient.Builder()
                            .proxy(java.net.Proxy.NO_PROXY)
                            .connectTimeout(8, TimeUnit.SECONDS)
                            .pingInterval(0, TimeUnit.SECONDS)
                            .build()
                    } catch (_: Exception) {
                        null
                    }
                }
                ana.post {
                    hazirlaniyor = false
                    if (isFinishing || isDestroyed) {
                        c?.dispatcher?.executorService?.shutdown()
                        return@post
                    }
                    if (anahtar == null || c == null) {
                        bitir(SONUC_HATA)
                        return@post
                    }
                    soketAc(hedef, anahtar, c)
                }
            }
        } catch (_: Exception) {
            hazirlaniyor = false
            bitir(SONUC_HATA)
        }
    }

    private fun soketAc(hedef: Hedef, cihazAnahtari: String, c: OkHttpClient) {
        val istek = Json.yaz(
            JsonDeger.Nesne(
                linkedMapOf(
                    "v" to JsonDeger.Tam(1),
                    "type" to JsonDeger.Metin("pair_request"),
                    "kod" to JsonDeger.Metin(hedef.kod),
                    "public_key" to JsonDeger.Metin(cihazAnahtari),
                    "platform" to JsonDeger.Metin("android"),
                    "etiket" to JsonDeger.Metin((Build.MODEL ?: "android").take(64)),
                ),
            ),
        )
        istemci = c
        val zaman = Runnable { sonuclandir(null, "Zaman aşımı.", SONUC_HATA) }
        zamanAsimi = zaman
        ana.postDelayed(zaman, ZAMAN_ASIMI_MS)

        soket = c.newWebSocket(
            Request.Builder().url("ws://${hedef.host}:${hedef.port}/sohbet").build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(istek)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (text.length > AZAMI_CERCEVE) {
                        sonuclandir(null, "Geçersiz yanıt.", SONUC_HATA)
                        return
                    }
                    cevapIsle(hedef, text)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    sonuclandir(null, "PC'ye bağlanılamadı.", SONUC_HATA)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    // Sonuç gelmeden kapanma (kod reddi dahil) hata sayılır; geldiyse bitti zaten set.
                    sonuclandir(null, "Bağlantı kapandı.", SONUC_HATA)
                }
            },
        )
    }

    /** OkHttp iş parçacığında çalışır: yalnız çözer ve ana iş parçacığına bırakır. */
    private fun cevapIsle(hedef: Hedef, text: String) {
        val a = ((Json.coz(text) as? JsonSonucu.Tamam)?.deger as? JsonDeger.Nesne)?.alanlar
        val izinli = setOf("v", "type", "ok", "device_id", "server_public_key", "code")
        if (a == null || !izinli.containsAll(a.keys) ||
            (a["v"] as? JsonDeger.Tam)?.deger != 1L ||
            (a["type"] as? JsonDeger.Metin)?.deger != "pair_result"
        ) {
            sonuclandir(null, "Geçersiz yanıt.", SONUC_HATA)
            return
        }
        val ok = (a["ok"] as? JsonDeger.Mantik)?.deger
        if (ok == null) {
            sonuclandir(null, "Geçersiz yanıt.", SONUC_HATA)
            return
        }
        if (!ok) {
            val mesaj = when ((a["code"] as? JsonDeger.Metin)?.deger) {
                "eslestirme_kapali" -> "PC'de eşleştirme açık değil ya da süresi doldu."
                "eslestirme_kodu_gecersiz" -> "Eşleştirme kodu yanlış."
                "ip_uyusmuyor" -> "PC bu cihazın adresini kabul etmedi."
                else -> "PC eşleştirmeyi reddetti."
            }
            sonuclandir(null, mesaj, SONUC_HATA)
            return
        }
        val id = (a["device_id"] as? JsonDeger.Metin)?.deger
        val anahtar = (a["server_public_key"] as? JsonDeger.Metin)?.deger
        if (id == null || anahtar == null || a.containsKey("code") || !OPAK_ID_DESENI.matches(id) ||
            anahtar.isEmpty() || anahtar.length > 256 || !BASE64_DESENI.matches(anahtar) || parmakIzi(anahtar) == null
        ) {
            sonuclandir(null, "Geçersiz yanıt.", SONUC_HATA)
            return
        }
        // QR akışı: PC anahtarı QR'dakiyle birebir aynı olmalı, değilse yazılmaz.
        if (hedef.pcAnahtar != null && anahtar != hedef.pcAnahtar) {
            sonuclandir(null, "PC anahtarı QR'daki ile uyuşmuyor. Eşleşme reddedildi.", SONUC_HATA)
            return
        }
        val kayit = KayitliEslesme(id, hedef.host, hedef.port, anahtar)
        if (!bitti.compareAndSet(false, true)) return
        ana.post {
            baglantiyiKapat()
            if (isFinishing || isDestroyed) return@post
            if (hedef.pcAnahtar != null) {
                kaydetVeBitir(kayit)
            } else {
                // Elle girişte anahtar ilk kez burada görülür: kullanıcı terminaldekiyle karşılaştırır.
                onayEkrani(hedef, parmakIzi(anahtar) ?: return@post) { kaydetVeBitir(kayit) }
            }
        }
    }

    private fun kaydetVeBitir(kayit: KayitliEslesme) {
        // Tam yetki önceki PC'ye verilmişti; yeni eşleşme onu devralmaz. Kayıttan ÖNCE kapanır: yeni
        // eşleşme ile açık tam yetki hiçbir an birlikte durmaz. Kayıt düşerse yetki kapalı kalır
        // (güvenli yön); kullanıcı yeniden açabilir.
        TamYetki.kapat(this)
        try {
            EslesmeDeposu(this).kaydet(kayit)
        } catch (_: Exception) {
            bitir(SONUC_HATA)
            return
        }
        // Eski oturum/izinler kapanır, yeni eşleşmeyle bağlantı kurulur (ilk eşleşmede servis de kalkar).
        CihazServisi.eslesmeDegisti(this)
        Adaptor.olaylar?.durumDegisti()
        bitir(SONUC_TAMAM)
    }

    /** Hata yolu: bir kez çalışır, bağlantıyı kapatır, mesajı gösterir. */
    private fun sonuclandir(@Suppress("UNUSED_PARAMETER") yok: Nothing?, mesaj: String, sonuc: String) {
        if (!bitti.compareAndSet(false, true)) return
        ana.post {
            baglantiyiKapat()
            if (isFinishing || isDestroyed) return@post
            durum(mesaj, "Tamam") { bitir(sonuc) }
        }
    }

    private fun baglantiyiKapat() {
        zamanAsimi?.let { ana.removeCallbacks(it) }
        zamanAsimi = null
        soket?.cancel()
        soket = null
        istemci?.dispatcher?.executorService?.shutdown()
        istemci = null
    }

    private fun bitir(sonuc: String) {
        if (isFinishing) return
        setResult(RESULT_OK, Intent().putExtra(EXTRA_SONUC, sonuc))
        finish()
    }

    // ---------------------------------------------------------------------------------------------
    // Ekran parçaları (res/ yok: kodla kurulur)
    // ---------------------------------------------------------------------------------------------

    private fun durum(mesaj: String, dugmeAdi: String?, tikla: (() -> Unit)? = null) {
        val k = kok ?: return
        k.removeAllViews()
        k.addView(baslik("Eşleştirme"))
        k.addView(metin(mesaj))
        if (dugmeAdi != null && tikla != null) k.addView(dugme(dugmeAdi) { tikla() })
    }

    private fun baslik(t: String) = TextView(this).apply {
        text = t
        setTextColor(Renkler.metin)
        textSize = 22f
        setTypeface(typeface, Typeface.BOLD)
        setPadding(0, 0, 0, dp(12))
    }

    private fun metin(t: String) = TextView(this).apply {
        text = t
        setTextColor(Renkler.metinIkincil)
        textSize = 16f
        setPadding(0, dp(4), 0, dp(12))
    }

    private fun alan(ad: String, deger: String, mono: Boolean = false): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(6), 0, dp(6))
        addView(TextView(context).apply { text = ad; textSize = 13f; setTextColor(Renkler.metinIkincil) })
        addView(TextView(context).apply {
            text = deger
            setTextColor(Renkler.metin)
            textSize = if (mono) 17f else 18f
            if (mono) typeface = Typeface.MONOSPACE
            setTextIsSelectable(false)
        })
    }

    private fun girdi(ipucu: String, tur: Int, azami: Int) = EditText(this).apply {
        hint = ipucu
        setTextColor(Renkler.metin)
        setHintTextColor(Renkler.metinIkincil)
        background = GradientDrawable().apply {
            setColor(Renkler.yuzeyUst)
            setStroke(dp(1), Renkler.kenar)
            cornerRadius = dp(8).toFloat()
        }
        setPadding(dp(12), dp(10), dp(12), dp(10))
        inputType = tur
        filters = arrayOf(InputFilter.LengthFilter(azami))
        isSingleLine = true
    }

    private fun dugmeKutusu(renk: Int, kenar: Int?) = GradientDrawable().apply {
        setColor(renk)
        if (kenar != null) setStroke(dp(1), kenar)
        cornerRadius = dp(10).toFloat()
    }

    private fun dugme(ad: String, birincil: Boolean = false, tikla: () -> Unit) = Button(this).apply {
        text = ad
        gravity = Gravity.CENTER
        setTextColor(if (birincil) Renkler.dolguUstu else Renkler.metin)
        background = StateListDrawable().apply {
            addState(
                intArrayOf(android.R.attr.state_pressed),
                if (birincil) dugmeKutusu(Renkler.vurguBasili, null) else dugmeKutusu(Renkler.basili, Renkler.kenarGuclu),
            )
            addState(
                intArrayOf(),
                if (birincil) dugmeKutusu(Renkler.vurgu, null) else dugmeKutusu(Color.TRANSPARENT, Renkler.kenarGuclu),
            )
        }
        setOnClickListener { tikla() }
    }

    private fun dp(v: Int) = (resources.displayMetrics.density * v).toInt()
}
