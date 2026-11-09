package dev.eren.deneme

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.os.SystemClock
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class Baglanti(private val c: Context) {
    companion object {
        /** Derlemede `EREN_KIT_PC_URL` ortam değişkeninden (bkz. app/build.gradle.kts). */
        val URL: String = BuildConfig.PC_URL
        const val PING_MS = 30_000L
        const val SESSIZLIK_MS = 75_000L
        const val GECIKME_EN_COK = 30_000L
    }

    private val ht = HandlerThread("baglanti").apply { start() }
    private val h = Handler(ht.looper)
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()
    private val komutlar = Komutlar(c) { gonder(it) }
    private val cm = c.getSystemService(ConnectivityManager::class.java)
    private val pm = c.getSystemService(PowerManager::class.java)
    private val bm = c.getSystemService(BatteryManager::class.java)

    @Volatile private var ws: WebSocket? = null
    private var acik = false
    @Volatile private var durdu = false
    private var gecikme = 1000L
    private var pingNo = 0
    private var sonPongUptime = 0L
    private var bekleyenNeden: String? = null
    private val baglanR = Runnable { baglan() }
    private val pingR = Runnable { pingAt() }

    private val agDinleyici = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(n: Network) {
            h.post {
                gecikme = 1000L
                if (ws == null) {
                    h.removeCallbacks(baglanR)
                    baglan()
                }
            }
        }

        override fun onLost(n: Network) {
            Olcum.olay("ag_kayip", "")
        }
    }

    fun baslat() {
        h.post { baglan() }
        cm.registerDefaultNetworkCallback(agDinleyici)
    }

    fun durdur() {
        durdu = true
        runCatching { cm.unregisterNetworkCallback(agDinleyici) }
        komutlar.kapat()
        h.post {
            h.removeCallbacksAndMessages(null)
            ws?.close(1000, "servis_durdu")
            ws = null
            Olcum.bagli = false
            ht.quitSafely()
        }
    }

    /** Sunucu günlüğüne serbest olay notu (görev kaldırıldı gibi). */
    fun not(olay: String) {
        gonder(JSONObject().put("t", "not").put("olay", olay).put("ts", System.currentTimeMillis()))
    }

    private fun gonder(o: JSONObject) {
        val w = ws ?: return
        if (!w.send(o.toString())) Olcum.olay("gonderim_red", o.optString("name", o.optString("t")))
    }

    private fun baglan() {
        if (durdu || ws != null) return
        Olcum.arttir("baglanti_denemesi")
        bekleyenNeden = null
        ws = http.newWebSocket(Request.Builder().url(URL).build(), Dinleyici())
    }

    private inner class Dinleyici : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            h.post { if (webSocket === ws) acildi() }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val m = runCatching { JSONObject(text) }.getOrNull() ?: return
            when (m.optString("t")) {
                "pong" -> h.post { sonPongUptime = SystemClock.uptimeMillis() }
                "cmd" -> komutlar.calistir(
                    m.optString("id"),
                    m.optString("name"),
                    m.optJSONObject("args") ?: JSONObject()
                )
            }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            h.post { kapandi(webSocket, "closed:$code:$reason") }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            h.post { kapandi(webSocket, "${t.javaClass.simpleName}:${t.message}") }
        }
    }

    private fun acildi() {
        acik = true
        gecikme = 1000L
        Olcum.bagli = true
        Olcum.surecBaglantisi++
        val toplam = Olcum.arttir("toplam_baglanti")
        sonPongUptime = SystemClock.uptimeMillis()
        gonder(
            JSONObject()
                .put("t", "hello")
                .put("ts", System.currentTimeMillis())
                .put("model", Build.MODEL)
                .put("sdk", Build.VERSION.SDK_INT)
                .put("surec_yasi_ms", SystemClock.elapsedRealtime() - Olcum.surecBaslangic)
                .put("surec_sayaci", Olcum.sayi("surec_sayaci"))
                .put("servis_sayaci", Olcum.sayi("servis_sayaci"))
                .put("toplam_baglanti", toplam)
                .put("son_kopma", Olcum.oku("son_kopma") ?: JSONObject.NULL)
                .put("a11y", Olcum.erisim != null)
                .put("wl", Olcum.wakeLockTutuluyor)
        )
        h.removeCallbacks(pingR)
        pingAt()
    }

    private fun kapandi(w: WebSocket, neden: String) {
        if (w !== ws) return
        val n = bekleyenNeden ?: neden
        ws = null
        h.removeCallbacks(pingR)
        if (acik) Olcum.olay("son_kopma", n) else Olcum.olay("son_baglanti_hatasi", n)
        acik = false
        Olcum.bagli = false
        if (durdu) return
        h.removeCallbacks(baglanR)
        h.postDelayed(baglanR, gecikme)
        gecikme = (gecikme * 2).coerceAtMost(GECIKME_EN_COK)
    }

    private fun pingAt() {
        val w = ws
        if (w == null || !acik) return
        val up = SystemClock.uptimeMillis()
        if (up - sonPongUptime > SESSIZLIK_MS) {
            bekleyenNeden = "pong_zaman_asimi"
            w.cancel()
            return
        }
        pingNo++
        gonder(
            JSONObject()
                .put("t", "ping")
                .put("n", pingNo)
                .put("ts", System.currentTimeMillis())
                .put("uyku_ms", SystemClock.elapsedRealtime() - up)
                .put("ekran", pm.isInteractive)
                .put("idle", pm.isDeviceIdleMode)
                .put("pil", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
                .put("sarj", bm.isCharging)
                .put("wl", Olcum.wakeLockTutuluyor)
                .put("ag", Durum.agKisa(cm))
                .put("surec_yasi_ms", SystemClock.elapsedRealtime() - Olcum.surecBaslangic)
        )
        h.postDelayed(pingR, PING_MS)
    }
}
