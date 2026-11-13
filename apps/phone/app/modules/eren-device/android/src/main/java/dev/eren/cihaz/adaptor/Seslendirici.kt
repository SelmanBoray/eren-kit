package dev.eren.cihaz.adaptor

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.HandlerThread
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import dev.eren.cihaz.cekirdek.SesParcalari
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Metni Android'in yerleşik `TextToSpeech` motoruyla okur (köprü `seslendir`/`seslendirmeyiDurdur`,
 * olay `seslendirmeDurumu{konusuyor}`). Yeni izin ve bağımlılık yok; motor bağlanması için manifestte
 * `TTS_SERVICE` sorgusu var.
 *
 * İplik: bütün durum tek `eren-ses` ipliğinde okunur/yazılır; motorun bağlayıcı iplikten gelen geri
 * çağrıları ve ses odağı değişimleri oraya aktarılır. Genel yöntemler her iplikten çağrılabilir.
 *
 * Okuma: metin `SesParcalari.bol` ile platformun tek istek sınırına (`getMaxSpeechInputLength`) göre
 * cümle sınırlarından bölünür; ilk parça `QUEUE_FLUSH` (süren okumanın yerine geçer), ötekiler
 * `QUEUE_ADD`. Parça kimliği `"<okumaNo>:<sıra>"`; başka okumaya ait geç gelen geri çağrı yok sayılır.
 * Olay: kabul edilen her okuma için tam bir `true`, sonra tam bir `false` (son parça bitti, kesildi,
 * hata, odak kaybı, bekçi). Yerine geçen okumada önce eskisinin `false`'u, sonra yenisinin `true`'su.
 *
 * Motor ilk çağrıda tembel kurulur; kurulum bitene kadar istek bekletilir (tek yuva: yenisi eskisini
 * `false` ile bitirir), `KURULUM_BEKLEME_MS`'de kurulmazsa `false` döner ve motor bırakılır (sonraki
 * çağrı yeniden kurar). Her sonuç geri çağrısı tam bir kez çağrılır; `kapat` bekleyeni de bitirir.
 *
 * Ses odağı: `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` (müzik kısılır, durmaz); okuma bitince bırakılır.
 * Odak kalıcı ya da geçici kaybedilirse (arama, dikte tanıyıcısı) okuma kesilir; "kısılabilir" kayıpta
 * sistem bizi kendisi kısar. Odak reddedilirse: görüşme/zil sürüyorsa (`mode != MODE_NORMAL`) okunmaz;
 * değilse (ör. Android 15+ arka plan kısıtı) odaksız okunur.
 *
 * Dikteden önce kesme: köprü `dikte` kendi örneğinin `durdur`'unu, `KisayolActivity` ise
 * `Seslendirici.etkiniDurdur()`'u çağırır (asistan kendi sesini dinlemesin).
 */
class Seslendirici(baglam: Context, private val durumBildir: (Boolean) -> Unit) {

    private class Istek(val metin: String, val dil: String, val sonuc: (Boolean) -> Unit)

    private val ctx: Context = baglam.applicationContext
    private val ip = HandlerThread("eren-ses").apply { start() }
    private val h = Handler(ip.looper)

    // ---- Yalnız `ip` ipliğinde ----
    private var motor: TextToSpeech? = null
    private var motorHazir = false
    private var kurulumNo = 0
    private var bekleyen: Istek? = null
    private var okumaNo = 0
    private var okuyor = false
    private var sonParcaKimligi: String? = null
    private var sessizSayac = 0
    private var odakVar = false
    private var kapandi = false

    private val nitelik: AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANT)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    private val odakIstegi: AudioFocusRequest by lazy {
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(nitelik)
            .setWillPauseWhenDucked(false)
            .setOnAudioFocusChangeListener({ degisim -> odakDegisti(degisim) }, h)
            .build()
    }

    private val dinleyici = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {
            h.post { if (okuyor && okumaNoOku(utteranceId) == okumaNo) sessizSayac = 0 }
        }

        override fun onDone(utteranceId: String?) {
            h.post { if (okuyor && utteranceId != null && utteranceId == sonParcaKimligi) okumayiBitir(false) }
        }

        // Soyut ama kullanımdan kalkmış; çerçevenin iki argümanlı `onError`'u varsayılan olarak bunu çağırır.
        @Suppress("OVERRIDE_DEPRECATION")
        override fun onError(utteranceId: String?) {
            h.post { if (okuyor && okumaNoOku(utteranceId) == okumaNo) okumayiBitir(true) }
        }

        // `stop()` ya da başka bir QUEUE_FLUSH bu okumanın parçasını kestiyse okuma biter.
        override fun onStop(utteranceId: String?, interrupted: Boolean) {
            h.post { if (okuyor && okumaNoOku(utteranceId) == okumaNo) okumayiBitir(true) }
        }
    }

    init {
        etkin.set(this)
    }

    // ---------------------------------------------------------------------------------------------
    // Genel yüzey (her iplikten)
    // ---------------------------------------------------------------------------------------------

    /** Okumayı başlatır; `sonuc(true)`: kabul edildi (bitmesi beklenmez). Tam bir kez çağrılır. */
    fun seslendir(metin: String, dil: String, sonuc: (Boolean) -> Unit) {
        val tek = AtomicBoolean(false)
        val bitir: (Boolean) -> Unit = { b ->
            if (tek.compareAndSet(false, true)) {
                try {
                    sonuc(b)
                } catch (_: Exception) {
                }
            }
        }
        if (metin.isBlank() || yerel(dil) == null) {
            bitir(false)
            return
        }
        val istek = Istek(metin, dil, bitir)
        val gonderildi = guvenliGonder {
            try {
                seslendirIpte(istek)
            } catch (_: Exception) {
                // Sonuç verilmeden istisna: askıda kalmasın (verildiyse bu çağrı etkisiz).
                if (bekleyen === istek) bekleyen = null
                bitir(false)
            }
        }
        if (!gonderildi) bitir(false)
    }

    /** Süren okumayı keser, bekleyen isteği `false` ile bitirir; `bitti` iş bitince (tam bir kez). */
    fun durdur(bitti: (() -> Unit)?) {
        val tek = AtomicBoolean(false)
        val son: () -> Unit = {
            if (tek.compareAndSet(false, true)) {
                try {
                    bitti?.invoke()
                } catch (_: Exception) {
                }
            }
        }
        val gonderildi = guvenliGonder {
            try {
                bekleyeniBitir()
                okumayiBitir(true)
            } finally {
                son()
            }
        }
        if (!gonderildi) son()
    }

    /** Modül yıkımında: motor kapanır, odak bırakılır, bekleyen biter, iplik durur. */
    fun kapat() {
        etkin.compareAndSet(this, null)
        val gonderildi = guvenliGonder {
            kapandi = true
            bekleyeniBitir()
            // JS bağlamı gidiyor: olay gönderilmez, yalnız ses ve odak temizlenir.
            if (okuyor) {
                okuyor = false
                okumaNo++
                sonParcaKimligi = null
            }
            motoruBirak()
            odagiBirak()
            ip.quitSafely()
        }
        if (!gonderildi) ip.quitSafely()
    }

    // ---------------------------------------------------------------------------------------------
    // `ip` ipliği
    // ---------------------------------------------------------------------------------------------

    private fun seslendirIpte(istek: Istek) {
        if (kapandi) {
            istek.sonuc(false)
            return
        }
        // Henüz kabul edilmemiş eski istek yenisine yer açar.
        bekleyeniBitir()
        val m = motor
        if (m != null && motorHazir) {
            istek.sonuc(okuGuvenli(m, istek))
            return
        }
        bekleyen = istek
        if (m == null) motoruKur()
        h.postDelayed({ bekleyenZamanAsimi(istek) }, KURULUM_BEKLEME_MS)
    }

    private fun motoruKur() {
        val no = ++kurulumNo
        motorHazir = false
        val m = try {
            TextToSpeech(ctx) { durum -> guvenliGonder { kuruldu(no, durum) } }
        } catch (_: Exception) {
            null
        }
        if (m == null) {
            bekleyeniBitir()
            return
        }
        motor = m
    }

    private fun kuruldu(no: Int, durum: Int) {
        if (no != kurulumNo || kapandi) return
        val m = motor ?: return
        if (durum != TextToSpeech.SUCCESS) {
            motoruBirak()
            bekleyeniBitir()
            return
        }
        try {
            m.setAudioAttributes(nitelik)
            m.setOnUtteranceProgressListener(dinleyici)
        } catch (_: Exception) {
            motoruBirak()
            bekleyeniBitir()
            return
        }
        motorHazir = true
        val b = bekleyen ?: return
        bekleyen = null
        b.sonuc(okuGuvenli(m, b))
    }

    private fun bekleyenZamanAsimi(istek: Istek) {
        if (bekleyen !== istek) return
        bekleyen = null
        istek.sonuc(false)
        // Motor hâlâ kurulmadıysa bırakılır; sonraki çağrı temiz bir bağlanma dener.
        if (!motorHazir) motoruBirak()
    }

    private fun bekleyeniBitir() {
        val b = bekleyen ?: return
        bekleyen = null
        b.sonuc(false)
    }

    /** Beklenmedik istisnada okuma yarım kalmaz: susturulur, odak bırakılır, sonuç false. */
    private fun okuGuvenli(m: TextToSpeech, istek: Istek): Boolean = try {
        oku(m, istek)
    } catch (_: Exception) {
        okumayiBitir(true)
        sustur(m)
        odagiBirak()
        false
    }

    /** Kabul edildiyse true. Reddedilen istek süren okumaya dokunmaz (dil/boş metin denetimleri önce). */
    private fun oku(m: TextToSpeech, istek: Istek): Boolean {
        val yer = yerel(istek.dil) ?: return false
        val parcalar = SesParcalari.bol(istek.metin, azamiUzunluk())
        if (parcalar.isEmpty()) return false
        try {
            if (m.isLanguageAvailable(yer) < TextToSpeech.LANG_AVAILABLE) return false
            if (m.setLanguage(yer) < TextToSpeech.LANG_AVAILABLE) return false
        } catch (_: Exception) {
            return false
        }

        // Eski okuma burada biter (olayı önce gider); sesi aşağıdaki QUEUE_FLUSH ya da hata yolu keser.
        // Odak tutuluyorsa bırakılmaz: müzik arada bir an yükselip yeniden kısılmasın.
        if (okuyor) {
            okuyor = false
            okumaNo++
            sonParcaKimligi = null
            bildir(false)
        }
        if (!odakAl()) {
            sustur(m)
            odagiBirak()
            return false
        }
        val no = ++okumaNo
        for ((i, p) in parcalar.withIndex()) {
            val kip = if (i == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
            val s = try {
                m.speak(p, kip, null, "$no:$i")
            } catch (_: Exception) {
                TextToSpeech.ERROR
            }
            if (s != TextToSpeech.SUCCESS) {
                okumaNo++
                sustur(m)
                odagiBirak()
                // Motor bağlantısı kopmuş olabilir: bırakılır, sonraki çağrı yeniden kurar.
                motoruBirak()
                return false
            }
        }
        sonParcaKimligi = "$no:${parcalar.size - 1}"
        okuyor = true
        sessizSayac = 0
        bildir(true)
        h.postDelayed(Bekci(no), BEKCI_ARALIK_MS)
        return true
    }

    /** Süren okumayı bitirir; okuma yoksa etkisiz. `kes`: motor da susturulur (doğal bitişte gerekmez). */
    private fun okumayiBitir(kes: Boolean) {
        if (!okuyor) return
        okuyor = false
        okumaNo++
        sonParcaKimligi = null
        if (kes) motor?.let { sustur(it) }
        odagiBirak()
        bildir(false)
    }

    /**
     * Motor ölürse (servis çöküşü) geri çağrı hiç gelmeyebilir: okuma sürerken saniyede bir
     * `isSpeaking` yoklanır (sentez de "konuşuyor" sayılır); art arda `BEKCI_SESSIZ_SINIRI` kez
     * sessizse okuma biter ve motor bırakılır. `onStart` sayacı sıfırlar.
     */
    private inner class Bekci(private val no: Int) : Runnable {
        override fun run() {
            if (!okuyor || no != okumaNo) return
            val konusuyor = try {
                motor?.isSpeaking == true
            } catch (_: Exception) {
                false
            }
            sessizSayac = if (konusuyor) 0 else sessizSayac + 1
            if (sessizSayac >= BEKCI_SESSIZ_SINIRI) {
                okumayiBitir(true)
                motoruBirak()
                return
            }
            h.postDelayed(this, BEKCI_ARALIK_MS)
        }
    }

    private fun odakDegisti(degisim: Int) {
        when (degisim) {
            // Geçici kayıpta da istek bırakılır: odak geri gelince okuma kendiliğinden sürmesin.
            AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                okumayiBitir(true)
                odagiBirak()
            }
            else -> Unit
        }
    }

    private fun odakAl(): Boolean {
        if (odakVar) return true
        val am = sesYoneticisi() ?: return true
        val r = try {
            am.requestAudioFocus(odakIstegi)
        } catch (_: Exception) {
            AudioManager.AUDIOFOCUS_REQUEST_FAILED
        }
        if (r == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            odakVar = true
            return true
        }
        val kip = try {
            am.mode
        } catch (_: Exception) {
            AudioManager.MODE_NORMAL
        }
        return kip == AudioManager.MODE_NORMAL
    }

    private fun odagiBirak() {
        if (!odakVar) return
        odakVar = false
        try {
            sesYoneticisi()?.abandonAudioFocusRequest(odakIstegi)
        } catch (_: Exception) {
        }
    }

    private fun motoruBirak() {
        kurulumNo++
        motorHazir = false
        val m = motor ?: return
        motor = null
        try {
            m.stop()
        } catch (_: Exception) {
        }
        try {
            m.shutdown()
        } catch (_: Exception) {
        }
    }

    private fun sustur(m: TextToSpeech) {
        try {
            m.stop()
        } catch (_: Exception) {
        }
    }

    private fun bildir(konusuyor: Boolean) {
        try {
            durumBildir(konusuyor)
        } catch (_: Exception) {
        }
    }

    private fun sesYoneticisi(): AudioManager? = try {
        ctx.getSystemService(AudioManager::class.java)
    } catch (_: Exception) {
        null
    }

    private fun azamiUzunluk(): Int = try {
        TextToSpeech.getMaxSpeechInputLength()
    } catch (_: Exception) {
        YEDEK_AZAMI_UZUNLUK
    }.let { if (it > 0) it else YEDEK_AZAMI_UZUNLUK }

    private fun okumaNoOku(kimlik: String?): Int? = kimlik?.substringBefore(':')?.toIntOrNull()

    /** Kapalı iplikte `post` false döner ya da istisna atar; ikisi de "gönderilemedi". */
    private fun guvenliGonder(blok: () -> Unit): Boolean = try {
        h.post {
            try {
                blok()
            } catch (_: Exception) {
            }
        }
    } catch (_: Exception) {
        false
    }

    companion object {
        private const val KURULUM_BEKLEME_MS = 8000L
        private const val BEKCI_ARALIK_MS = 1000L
        private const val BEKCI_SESSIZ_SINIRI = 8
        private const val DIL_AZAMI = 35
        private const val YEDEK_AZAMI_UZUNLUK = 4000
        private val DIL_DESENI = Regex("^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$")

        private val etkin = AtomicReference<Seslendirici?>(null)

        /** Süreçteki etkin seslendiricinin okumasını keser; yoksa etkisiz. Her iplikten. */
        @JvmStatic
        fun etkiniDurdur() {
            try {
                etkin.get()?.durdur(null)
            } catch (_: Exception) {
            }
        }

        /** BCP 47 etiketi (`tr-TR`; `tr_TR` de kabul) → Locale; geçersizse null. */
        private fun yerel(dil: String): Locale? {
            val d = dil.trim().replace('_', '-')
            if (d.isEmpty() || d.length > DIL_AZAMI || !DIL_DESENI.matches(d)) return null
            val l = Locale.forLanguageTag(d)
            return if (l.language.isNullOrEmpty()) null else l
        }
    }
}
