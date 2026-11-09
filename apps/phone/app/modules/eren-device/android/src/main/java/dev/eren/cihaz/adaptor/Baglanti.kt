package dev.eren.cihaz.adaptor

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import dev.eren.cihaz.cekirdek.AzamiCerceve
import dev.eren.cihaz.cekirdek.CihazOturumu
import dev.eren.cihaz.cekirdek.GrantNedeni
import dev.eren.cihaz.cekirdek.HataKodu
import dev.eren.cihaz.cekirdek.IzinKaydi
import dev.eren.cihaz.cekirdek.OturumCiktisi
import dev.eren.cihaz.cekirdek.OturumDurumu
import dev.eren.cihaz.cekirdek.OturumOlayi
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.net.InetAddress
import java.net.Proxy
import java.net.UnknownHostException
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/*
 * `/cihaz` WebSocket istemcisi ve `CihazOturumu`'nun tek sürücüsü (AdaptorSozlesmesi DEĞİŞMEZ 2).
 * `Kanal.CIHAZ` imzası oturumun içindedir; oturumu yalnız bu sınıf sürer.
 *
 * Sıra: her oturum çağrısı ve onun giden çerçeveleri tek `sira` kilidi altında hesaplanıp OkHttp
 * kuyruğuna yazılır; kablodaki sıra hesap sırasıdır. Çıktı, hesaplandığı sokete bağlıdır: soket
 * değiştiyse düşer. `OturumGuncelle` çağrıları çağıranın ipliğinde çalışır (geri çekme çekirdeğe
 * hemen işler); olaylar ve komut kilit dışında işlenir. `cmd` işçi ipliğine gider, kuyruklanmaz;
 * ikinci komuta `mesgul`'ü çekirdek verir. Gelen metin, giden metin ve hata ayrıntısı günlüğe girmez.
 */
class Baglanti(
    context: Context,
    private val oturum: CihazOturumu,
    private val bildirimler: Bildirimler,
) : OturumGuncelle {

    private companion object {
        const val ILK_GECIKME_MS = 1_000L
        const val EN_COK_GECIKME_MS = 30_000L

        // Doğrulanmış bağlantı en az bu kadar yaşadıysa geri çekilme baştan başlar; kısa ömürlü
        // bağlantılar (welcome sonrası hemen kapatan PC) sıkı döngü kuramaz.
        const val KARARLI_MS = 30_000L

        // Bağlanma + el sıkışma için üst süre (sunucunun el sıkışması 10 sn).
        const val ACILIS_SURESI_MS = 30_000L
        const val PING_SN = 30L

        // Bir komut çalışırken gelenlere çekirdek `mesgul` versin diye birkaç iplik; kuyruk yok.
        const val KOMUT_ISCI_AZAMI = 4

        const val KAPAT_NORMAL = 1000
        const val KAPAT_GIDIYOR = 1001
        const val KAPAT_PROTOKOL = 1002
        const val KAPAT_IKILI = 1003
        const val KAPAT_KURAL = 1008
        const val KAPAT_BUYUK = 1009
        const val KAPAT_IC = 1011
    }

    private val ctx: Context = context.applicationContext
    private val depo = EslesmeDeposu(ctx)

    /** Oturum bu eşleşmeyle kuruldu; kayıt değişirse ya da silinirse bu nesne bir daha bağlanmaz. */
    private val eslesme: KayitliEslesme = depo.oku() ?: throw IllegalStateException("eslesme_yok")

    init {
        require(tailscaleAdresiMi(eslesme.host) && eslesme.port in 1..65535) { "eslesme_adresi_gecersiz" }
    }

    private val istek: Request = Request.Builder().url("ws://${eslesme.host}:${eslesme.port}/cihaz").build()

    // Vekil yok (sistem proxy'si soketi başka hosta götürmesin), DNS yok (adres sayısal), yönlendirme yok.
    private val istemci: OkHttpClient = OkHttpClient.Builder()
        .proxy(Proxy.NO_PROXY)
        .dns(DnsYok)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .pingInterval(PING_SN, TimeUnit.SECONDS)
        .build()

    private val iplik = HandlerThread("eren-cihaz-ws").apply { start() }
    private val h = Handler(iplik.looper)

    private val isci = ThreadPoolExecutor(
        0,
        KOMUT_ISCI_AZAMI,
        30L,
        TimeUnit.SECONDS,
        SynchronousQueue(),
        ThreadFactory { r -> Thread(r, "eren-komut") },
    )

    private val cm: ConnectivityManager? = ctx.getSystemService(ConnectivityManager::class.java)

    private val sira = Any()
    private val baslatildi = AtomicBoolean(false)

    @Volatile private var soket: WebSocket? = null

    @Volatile private var durdu = false

    // Aşağıdakiler yalnız `sira` altında okunur ve yazılır.
    private var gecikme = ILK_GECIKME_MS
    private var dogrulanmaAni: Long? = null
    private var sonDenemeMs = 0L
    private var acilisBekcisi: Runnable? = null
    private var agDinleniyor = false
    private val vpnAglari = HashSet<Network>()
    private var eslesmeGecersiz = false

    private val baglanR = Runnable { baglan() }

    // ---------------------------------------------------------------------------------------------
    // Servisin yüzeyi
    // ---------------------------------------------------------------------------------------------

    fun baslat() {
        if (durdu || !baslatildi.compareAndSet(false, true)) return
        Adaptor.oturumGuncelle = this
        agiDinle()
        h.post(baglanR)
    }

    fun durdur() {
        synchronized(sira) {
            if (durdu) return
            durdu = true
            h.removeCallbacksAndMessages(null)
            acilisBekcisi = null
            dogrulanmaAni = null
            val w = soket
            soket = null
            try {
                oturum.koptu()
            } catch (e: Exception) {
                // kapanış yine tamamlanır
            }
            if (w != null) kapatSoket(w, KAPAT_GIDIYOR)
        }
        if (Adaptor.oturumGuncelle === this) Adaptor.oturumGuncelle = null
        agiBirak()
        iplik.quitSafely()
        // Çalışan komut kesilir; sonucu zaten hiçbir sokete gitmez.
        isci.shutdownNow()
        istemci.dispatcher.executorService.shutdown()
    }

    fun baglimi(): Boolean = soket != null && oturum.durum() == OturumDurumu.DOGRULANDI

    /** `CihazServisi` saniyede bir çağırır: süresi dolan izinler için `grant_revoked`. */
    fun tik() = guncel { oturum.tik() }

    // ---------------------------------------------------------------------------------------------
    // OturumGuncelle: bağlı değilse çekirdek yine güncellenir, çerçeve düşer
    // ---------------------------------------------------------------------------------------------

    override fun izinEklendi(izin: IzinKaydi) = guncel { oturum.izinEklendi(izin) }

    override fun izinGeriCek(grantId: String?, neden: GrantNedeni) = guncel { oturum.izinGeriCek(grantId, neden) }

    override fun uygulamalarDegisti() = guncel { oturum.uygulamalarDegisti() }

    override fun cihazDurumuDegisti() = guncel { oturum.cihazDurumuDegisti() }

    // ---------------------------------------------------------------------------------------------
    // Bağlanma ve kopma
    // ---------------------------------------------------------------------------------------------

    private fun baglan() {
        synchronized(sira) {
            if (durdu || eslesmeGecersiz || soket != null) return
            // VPN yokken deneme yok; `vpnGeldi` yeniden kurar. Dinleyici kurulamadıysa yalnız geri çekilme.
            if (agDinleniyor && vpnAglari.isEmpty()) return
            val simdiki = try {
                depo.oku()
            } catch (e: Exception) {
                null
            }
            if (simdiki == null || simdiki != eslesme || !tailscaleAdresiMi(simdiki.host)) {
                eslesmeGecersiz = true
                return
            }
            sonDenemeMs = SystemClock.uptimeMillis()
            // Kilit altında: geri çağrı `soket` atanmadan işlenmesin.
            val w = try {
                istemci.newWebSocket(istek, dinleyici)
            } catch (e: Exception) {
                planla()
                return
            }
            soket = w
            val bekci = Runnable { acilisDoldu(w) }
            acilisBekcisi = bekci
            h.postDelayed(bekci, ACILIS_SURESI_MS)
        }
    }

    private fun acilisDoldu(w: WebSocket) {
        synchronized(sira) {
            if (w === soket && oturum.durum() != OturumDurumu.DOGRULANDI) kopar(w, KAPAT_KURAL)
        }
    }

    /** `sira` altında. Güncel soketse oturumu kapatır, soketi bırakır, yeniden bağlanmayı planlar. */
    private fun kopar(w: WebSocket, kod: Int?) {
        if (w !== soket) return
        soket = null
        acilisBekcisi?.let { h.removeCallbacks(it) }
        acilisBekcisi = null
        val dogrulanmisti = dogrulanmaAni
        dogrulanmaAni = null
        try {
            oturum.koptu()
        } catch (e: Exception) {
            // kapanış yine tamamlanır
        }
        kapatSoket(w, kod)
        if (dogrulanmisti != null && SystemClock.elapsedRealtime() - dogrulanmisti >= KARARLI_MS) {
            gecikme = ILK_GECIKME_MS
        }
        planla()
        if (dogrulanmisti != null) h.post { durumBildir() }
    }

    /** `sira` altında. 1 -> 30 sn geri çekilme. */
    private fun planla() {
        if (durdu || eslesmeGecersiz) return
        h.removeCallbacks(baglanR)
        h.postDelayed(baglanR, gecikme)
        gecikme = (gecikme * 2).coerceAtMost(EN_COK_GECIKME_MS)
    }

    private fun kapatSoket(w: WebSocket, kod: Int?) {
        try {
            // `close` kuyruktaki çerçeveleri (ör. `error`) önce yollar.
            if (kod == null || !w.close(kod, null)) w.cancel()
        } catch (e: Exception) {
            w.cancel()
        }
    }

    private val dinleyici = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            soketten(webSocket) { oturum.baglandi() }
        }

        // OkHttp okuyucu ipliği: bir sonraki çerçeve bu işlenmeden okunmaz (bellek kendiliğinden sınırlı).
        override fun onMessage(webSocket: WebSocket, text: String) {
            soketten(webSocket) { oturum.gelen(text) }
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            synchronized(sira) { kopar(webSocket, KAPAT_IKILI) }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            synchronized(sira) { kopar(webSocket, KAPAT_NORMAL) }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            synchronized(sira) { kopar(webSocket, null) }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            synchronized(sira) { kopar(webSocket, null) }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Oturum çıktısı
    // ---------------------------------------------------------------------------------------------

    /** Soket olayından gelen çağrı: soket artık güncel değilse hiçbir şey yapılmaz. */
    private fun soketten(w: WebSocket, cagri: () -> OturumCiktisi) {
        val c = synchronized(sira) {
            if (durdu || w !== soket) return
            val c = try {
                cagri()
            } catch (e: Exception) {
                kopar(w, KAPAT_IC)
                return
            }
            uygula(w, c)
            c
        }
        sonra(w, c)
    }

    /** Telefondan gelen değişim: o anki sokete yollanır, soket yoksa çerçeve düşer. */
    private fun guncel(cagri: () -> OturumCiktisi) {
        val (w, c) = synchronized(sira) {
            val w = soket
            val c = try {
                cagri()
            } catch (e: Exception) {
                return
            }
            if (w != null) uygula(w, c)
            w to c
        }
        sonra(w, c)
    }

    /** `sira` altında: giden çerçeveler, sonra gerekiyorsa kapanış. */
    private fun uygula(w: WebSocket, c: OturumCiktisi) {
        if (c.olaylar.any { it is OturumOlayi.Dogrulandi }) {
            dogrulanmaAni = SystemClock.elapsedRealtime()
            acilisBekcisi?.let { h.removeCallbacks(it) }
            acilisBekcisi = null
        }
        gonder(w, c.giden)
        if (c.kapat) kopar(w, kapanisKodu(c))
    }

    /** `sira` altında. OkHttp `send` bloklamaz; reddederse soket bitmiştir. */
    private fun gonder(w: WebSocket, giden: List<String>) {
        for (m in giden) {
            if (w !== soket) return
            // Sunucu `maxPayload` bayt sayar; sınırı aşan çerçeve yollanmaz (bilgisayar zaman aşımı görür).
            if (!cerceveSigar(m)) continue
            if (!w.send(m)) {
                kopar(w, null)
                return
            }
        }
    }

    /** Kilit dışında: köprü olayları, bildirim, komut. */
    private fun sonra(w: WebSocket?, c: OturumCiktisi) {
        for (o in c.olaylar) {
            try {
                when (o) {
                    is OturumOlayi.Dogrulandi -> Adaptor.olaylar?.durumDegisti()
                    is OturumOlayi.IzinlerDegisti -> Adaptor.olaylar?.izinlerDegisti()
                    is OturumOlayi.Bildirim -> {
                        // Güvenilmez başlık/metin yalnız bildirime gider.
                        bildirimler.olay(o.notifyId, o.tur, o.baslik, o.metin)
                        if (w != null) soketten(w) { oturum.bildirimGosterildi(o.notifyId) }
                    }
                    // Kapanışı `kopar` işledi ve durumu bildirdi.
                    is OturumOlayi.Kapaniyor -> Unit
                }
            } catch (e: Exception) {
                // köprü/bildirim hatası oturumu etkilemez
            }
        }
        val ham = c.komut
        if (ham != null && w != null && !c.kapat) komutVer(w, ham)
    }

    private fun komutVer(w: WebSocket, ham: String) {
        val isleyici = try {
            Adaptor.cekirdek?.komutIsleyici
        } catch (e: Exception) {
            null
        } ?: return
        try {
            isci.execute {
                val giden = try {
                    isleyici.isle(ham)
                } catch (e: Exception) {
                    emptyList()
                }
                // Kopmada sonuç yeni bağlantıya gitmez: yalnız komutun geldiği sokete, hâlâ güncelse.
                if (giden.isNotEmpty()) synchronized(sira) { gonder(w, giden) }
            }
        } catch (e: RejectedExecutionException) {
            // Taşma ya da durdu: komut kuyruklanmaz, düşer; bilgisayar zaman aşımında `belirsiz` sayar.
        }
    }

    private fun kapanisKodu(c: OturumCiktisi): Int {
        val k = c.olaylar.firstNotNullOfOrNull { it as? OturumOlayi.Kapaniyor } ?: return KAPAT_NORMAL
        if (k.pcden) return KAPAT_NORMAL
        return when (k.kod) {
            HataKodu.MESAJ_COK_BUYUK -> KAPAT_BUYUK
            HataKodu.PROTOKOL_UYUMSUZ -> KAPAT_PROTOKOL
            HataKodu.IC_HATA -> KAPAT_IC
            else -> KAPAT_KURAL
        }
    }

    private fun durumBildir() {
        try {
            Adaptor.olaylar?.durumDegisti()
        } catch (e: Exception) {
            // yalnız hızlandırıcı
        }
    }

    // ---------------------------------------------------------------------------------------------
    // VPN kapısı
    // ---------------------------------------------------------------------------------------------

    private val agGeriCagrisi = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = vpnGeldi(network)

        override fun onLost(network: Network) = vpnGitti(network)
    }

    private fun agiDinle() {
        val c = cm ?: return
        try {
            val vpnIstegi = NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_VPN)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
                .build()
            synchronized(sira) { agDinleniyor = true }
            c.registerNetworkCallback(vpnIstegi, agGeriCagrisi, h)
        } catch (e: Exception) {
            // ACCESS_NETWORK_STATE yoksa kapı kurulamaz; geri çekilme yine sıkı döngüyü önler.
            synchronized(sira) { agDinleniyor = false }
        }
    }

    private fun agiBirak() {
        try {
            cm?.unregisterNetworkCallback(agGeriCagrisi)
        } catch (e: Exception) {
            // kayıtlı değildi
        }
    }

    private fun vpnGeldi(n: Network) {
        synchronized(sira) {
            val ilk = vpnAglari.isEmpty()
            vpnAglari.add(n)
            // Yalnız "VPN yok -> var" geçişi denemeyi öne çeker; geri çekilme sıfırlanmaz.
            if (!ilk || durdu || eslesmeGecersiz || soket != null) return
            h.removeCallbacks(baglanR)
            val bekle = (sonDenemeMs + ILK_GECIKME_MS - SystemClock.uptimeMillis()).coerceAtLeast(0L)
            h.postDelayed(baglanR, bekle)
        }
    }

    private fun vpnGitti(n: Network) {
        synchronized(sira) { vpnAglari.remove(n) }
    }
}

/** IP sabit yazıldığı için OkHttp DNS'e hiç sormaz; sorarsa reddedilir. */
private object DnsYok : Dns {
    override fun lookup(hostname: String): List<InetAddress> = throw UnknownHostException()
}

/**
 * 100.64.0.0/10, dört ondalık sekizli, baştaki sıfır yok (bazı çözücüler `064`'ü sekizlik okur ve
 * aralık dışına çıkar).
 */
private fun tailscaleAdresiMi(adres: String): Boolean {
    if (adres.length > 15) return false
    val parcalar = adres.split('.')
    if (parcalar.size != 4) return false
    val sayilar = IntArray(4)
    for (i in 0 until 4) {
        val p = parcalar[i]
        if (p.isEmpty() || p.length > 3 || !p.all { it in '0'..'9' }) return false
        if (p.length > 1 && p[0] == '0') return false
        val n = p.toInt()
        if (n > 255) return false
        sayilar[i] = n
    }
    return sayilar[0] == 100 && sayilar[1] in 64..127
}

/** UTF-8 bayt sayısı `AzamiCerceve.CIHAZ`'ı aşmıyor mu. */
private fun cerceveSigar(m: String): Boolean {
    val n = m.length
    val sinir = AzamiCerceve.CIHAZ.toLong()
    if (n > sinir) return false
    if (n.toLong() * 3 <= sinir) return true
    var bayt = 0L
    var i = 0
    while (i < n) {
        val k = m[i].code
        bayt += when {
            k < 0x80 -> 1
            k < 0x800 -> 2
            k in 0xD800..0xDBFF && i + 1 < n && m[i + 1].code in 0xDC00..0xDFFF -> {
                i++
                4
            }
            else -> 3
        }
        if (bayt > sinir) return false
        i++
    }
    return true
}
