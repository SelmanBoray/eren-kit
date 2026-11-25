package dev.eren.ajanda.ag

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.io.InterruptedIOException
import java.net.Proxy
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit

/**
 * OkHttp 4.12 WebSocket'i [HamSoket]/[HamDinleyici]'ye bağlar. Android'e bağlı değil (JVM testinde süreç
 * içi sahte sunucuyla sınanır). Adres olduğu gibi kullanılır: yalnız çekirdeğin `baglantiAdresi()`'nden
 * (eşleşmede kaydedilen Tailscale adresi) gelir.
 *
 * Güvenlik: vekil sunucu yok (Wi-Fi vekili ayarlı olsa da trafik PC'ye doğrudan gider), yönlendirme
 * izlenmez (yükseltme yanıtı başka adrese çeviremez), bağlantı hatasında başka yol denenmez.
 */
class OkHttpSoketAcici(private val ayar: AgAyarlari = AgAyarlari.VARSAYILAN) : SoketAcici {

    private val istemci: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(ayar.tcpSuresiMs, TimeUnit.MILLISECONDS)
            // Yalnız yükseltme yanıtına uygulanır; yükseltmeden sonra okuma süresi yoktur (ping denetler).
            .readTimeout(ayar.tcpSuresiMs, TimeUnit.MILLISECONDS)
            .writeTimeout(ayar.tcpSuresiMs, TimeUnit.MILLISECONDS)
            .pingInterval(ayar.pingAraligiMs, TimeUnit.MILLISECONDS)
            .proxy(Proxy.NO_PROXY)
            .followRedirects(false)
            .followSslRedirects(false)
            .retryOnConnectionFailure(false)
            .build()
    }

    override fun ac(adres: String, dinleyici: HamDinleyici): HamSoket {
        require(adres.startsWith("ws://")) { "yalnız ws:// adresi" }
        val sarmal = Sarmal()
        val istek = Request.Builder().url(adres).build()
        val ws = istemci.newWebSocket(istek, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                sarmal.ata(webSocket)
                dinleyici.acildi(sarmal)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                dinleyici.mesaj(text)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                dinleyici.ikiliMesaj()
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                sarmal.ata(webSocket)
                dinleyici.kapaniyor(code)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                dinleyici.kapandi(KapanisTuru.KARSI_KAPATTI)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                val tur = if (t is SocketTimeoutException || t is InterruptedIOException) {
                    KapanisTuru.ZAMAN_ASIMI
                } else {
                    KapanisTuru.HATA
                }
                dinleyici.kapandi(tur)
            }
        })
        sarmal.ata(ws)
        return sarmal
    }

    /** Geri çağrılar `newWebSocket` dönmeden gelebilir: soket hangisi önce görürse oradan atanır (aynı nesne). */
    private class Sarmal : HamSoket {
        @Volatile
        private var ws: WebSocket? = null

        fun ata(w: WebSocket) {
            if (ws == null) ws = w
        }

        override fun gonder(metin: String): Boolean = ws?.send(metin) ?: false

        override fun kapat(kod: Int) {
            ws?.close(kod, null)
        }

        override fun iptal() {
            ws?.cancel()
        }
    }
}
