package dev.eren.cihaz.adaptor

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Path
import android.os.Build
import android.os.Bundle
import android.os.Looper
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import dev.eren.cihaz.cekirdek.CihazHatasi
import dev.eren.cihaz.cekirdek.EylemPortu
import dev.eren.cihaz.cekirdek.EylemSonucu
import dev.eren.cihaz.cekirdek.KaydirmaYonu
import dev.eren.cihaz.cekirdek.Nokta
import dev.eren.cihaz.cekirdek.Sinirlar
import dev.eren.cihaz.cekirdek.Tus
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.hypot

/**
 * `EylemPortu` gerçeklemesi: ekranı değiştiren her şey. Güvenlik kararı çekirdektedir (yalnız kapı
 * geçtikten sonra çağrılır); burada politika yok, eylemin sadık uygulanması var: jest çekirdeğin
 * denetlediği noktada başlar (kaydırmada varsayılan nokta çekirdeğinkiyle aynı ekran ortası), düğüm
 * `EkranOkuyucu.canliDugum`'dan gelir, uygulama yalnız `getLaunchIntentForPackage` ile açılır.
 *
 * İplik: `bagla`/`kopar` ana iplikte, port çağrıları komut işçisi ipliğinde gelir. Eylemler tek
 * kilitle sıralanır. Jest sonucu ana iplikte gelen geri çağrıyla bir mandala yazılır, işçi sınırlı
 * süre bekler. `kopar` kilidi almaz (ana iplik hiç bloklanmaz) ve bekleyen jesti hemen düşürür. Ana
 * iplikten gelen port çağrısı reddedilir: jest geri çağrısı ana iplikte geleceği için kilitlenirdi.
 *
 * `Gonderildi` yalnız "sisteme verildi" demektir: düğüm eyleminde `performAction` doğru döndü, jestte
 * `onCompleted` geldi, uygulama açmada `startActivity` atmadı. Eylemin sonucunu kanıtlamaz.
 */
class Eylemci : EylemPortu, A11yBagi {
    @Volatile private var servis: AccessibilityService? = null

    /** Şu an sonucu beklenen jest; `kopar` onu düşürür. Yalnız kilit altındaki işçi yazar. */
    @Volatile private var bekleyen: JestBekleyici? = null

    private val kilit = Any()

    override fun bagla(servis: AccessibilityService) {
        this.servis = servis
    }

    override fun kopar() {
        servis = null
        bekleyen?.koptu()
    }

    override fun dugumeDokun(no: Int, tiklama: Int, uzun: Boolean): EylemSonucu =
        yurut { s -> dugumeDokunIc(s, no, tiklama, uzun) }

    override fun noktayaDokun(nokta: Nokta, tiklama: Int, uzun: Boolean): EylemSonucu =
        yurut { s -> noktayaDokunIc(s, nokta, tiklama, uzun) }

    override fun metinYaz(no: Int, metin: String): EylemSonucu =
        yurut { _ -> metinYazIc(no, metin) }

    override fun tus(tus: Tus, tekrar: Int): EylemSonucu =
        yurut { s -> tusIc(s, tus, tekrar) }

    override fun kaydir(yon: KaydirmaYonu, miktar: Int?, nokta: Nokta?): EylemSonucu =
        yurut { s -> kaydirIc(s, yon, miktar, nokta) }

    override fun surukle(bas: Nokta, son: Nokta): EylemSonucu =
        yurut { s -> surukleIc(s, bas, son) }

    override fun uygulamaAc(paket: String): EylemSonucu =
        yurut { s -> uygulamaAcIc(s, paket) }

    // ---------------------------------------------------------------------------------------------
    // Ortak çerçeve
    // ---------------------------------------------------------------------------------------------

    /** Ana iplik reddi, sıralama kilidi, bağlılık denetimi ve istisnanın `Basarisiz`'e çevrilmesi. */
    private inline fun yurut(blok: (AccessibilityService) -> EylemSonucu): EylemSonucu {
        if (Looper.myLooper() === Looper.getMainLooper()) return hata(CihazHatasi.EYLEM_BASARISIZ)
        return synchronized(kilit) {
            val s = servis
            if (s == null) {
                hata(CihazHatasi.EYLEM_BASARISIZ)
            } else {
                try {
                    blok(s)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    hata(CihazHatasi.EYLEM_BASARISIZ)
                } catch (_: RuntimeException) {
                    hata(CihazHatasi.EYLEM_BASARISIZ)
                }
            }
        }
    }

    private fun hata(h: CihazHatasi): EylemSonucu = EylemSonucu.Basarisiz(h)

    /** Bekleme sonrası servis değiştiyse ya da koptuysa eylem sürmez. */
    private fun hala(s: AccessibilityService): Boolean = servis === s

    /** Düğüm numarası `EkranOkuyucu`'nun son okumasındandır; düğüm burada aranmaz, tutulmaz. */
    private fun canliDugum(no: Int): AccessibilityNodeInfo? =
        (Adaptor.cekirdek?.ekran as? EkranOkuyucu)?.canliDugum(no)

    // ---------------------------------------------------------------------------------------------
    // Düğüm eylemleri
    // ---------------------------------------------------------------------------------------------

    private fun dugumeDokunIc(s: AccessibilityService, no: Int, tiklama: Int, uzun: Boolean): EylemSonucu {
        if (tiklama !in 1..2) return hata(CihazHatasi.EYLEM_BASARISIZ)
        val dugum = canliDugum(no) ?: return hata(CihazHatasi.ELEMENT_BULUNAMADI)
        // Düğüm kendisi tıklanamıyorsa en yakın tıklanabilir ata; çekirdeğin etiket denetimi her
        // tıklanabilir atayı zaten kapsar.
        val hedef = dokunulacak(dugum, uzun) ?: return hata(CihazHatasi.EYLEM_BASARISIZ)
        // Devre dışı düğüm uygulamanın kendi kuralıdır; erişilebilirlik yoluyla aşılmaz.
        if (!hedef.isEnabled) return hata(CihazHatasi.EYLEM_BASARISIZ)
        val eylem = if (uzun) AccessibilityNodeInfo.ACTION_LONG_CLICK else AccessibilityNodeInfo.ACTION_CLICK
        for (i in 0 until tiklama) {
            if (i > 0) {
                Thread.sleep(CIFT_ARA_MS)
                if (!hala(s)) return hata(CihazHatasi.EYLEM_BASARISIZ)
            }
            if (!hedef.performAction(eylem)) return hata(CihazHatasi.EYLEM_BASARISIZ)
        }
        return EylemSonucu.Gonderildi
    }

    private fun dokunulacak(dugum: AccessibilityNodeInfo, uzun: Boolean): AccessibilityNodeInfo? {
        var n: AccessibilityNodeInfo? = dugum
        var adim = 0
        while (n != null && adim <= ATA_SINIRI) {
            if (if (uzun) n.isLongClickable else n.isClickable) return n
            n = n.parent
            adim++
        }
        return null
    }

    /** `ACTION_SET_TEXT`: alanı baştan yazar, eklemez. */
    private fun metinYazIc(no: Int, metin: String): EylemSonucu {
        val dugum = canliDugum(no) ?: return hata(CihazHatasi.ELEMENT_BULUNAMADI)
        if (!dugum.isEditable || !dugum.isEnabled) return hata(CihazHatasi.EYLEM_BASARISIZ)
        val arg = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, metin)
        }
        return if (dugum.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arg)) {
            EylemSonucu.Gonderildi
        } else {
            hata(CihazHatasi.EYLEM_BASARISIZ)
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Tuşlar
    // ---------------------------------------------------------------------------------------------

    private fun tusIc(s: AccessibilityService, tus: Tus, tekrar: Int): EylemSonucu {
        if (tekrar !in 1..Sinirlar.TEKRAR_MAX) return hata(CihazHatasi.EYLEM_BASARISIZ)
        for (i in 0 until tekrar) {
            if (i > 0) {
                Thread.sleep(TEKRAR_ARA_MS)
                if (!hala(s)) return hata(CihazHatasi.EYLEM_BASARISIZ)
            }
            val sonuc = tekTus(s, tus)
            if (sonuc != EylemSonucu.Gonderildi) return sonuc
        }
        return EylemSonucu.Gonderildi
    }

    /**
     * BACK/HOME: genel eylem. ENTER: giriş odağındaki alana `ACTION_IME_ENTER` (API 30; genel bir
     * Enter eylemi yok). DPAD: genel eylem, yalnız API 33+; altında açıkça `Basarisiz`.
     */
    private fun tekTus(s: AccessibilityService, tus: Tus): EylemSonucu = when (tus) {
        Tus.BACK -> genel(s, AccessibilityService.GLOBAL_ACTION_BACK)
        Tus.HOME -> genel(s, AccessibilityService.GLOBAL_ACTION_HOME)
        Tus.ENTER -> imeEnter(s)
        Tus.DPAD_UP ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                genel(s, AccessibilityService.GLOBAL_ACTION_DPAD_UP)
            } else {
                hata(CihazHatasi.EYLEM_BASARISIZ)
            }
        Tus.DPAD_DOWN ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                genel(s, AccessibilityService.GLOBAL_ACTION_DPAD_DOWN)
            } else {
                hata(CihazHatasi.EYLEM_BASARISIZ)
            }
        Tus.DPAD_LEFT ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                genel(s, AccessibilityService.GLOBAL_ACTION_DPAD_LEFT)
            } else {
                hata(CihazHatasi.EYLEM_BASARISIZ)
            }
        Tus.DPAD_RIGHT ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                genel(s, AccessibilityService.GLOBAL_ACTION_DPAD_RIGHT)
            } else {
                hata(CihazHatasi.EYLEM_BASARISIZ)
            }
        Tus.DPAD_CENTER ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                genel(s, AccessibilityService.GLOBAL_ACTION_DPAD_CENTER)
            } else {
                hata(CihazHatasi.EYLEM_BASARISIZ)
            }
    }

    private fun genel(s: AccessibilityService, eylem: Int): EylemSonucu =
        if (s.performGlobalAction(eylem)) EylemSonucu.Gonderildi else hata(CihazHatasi.EYLEM_BASARISIZ)

    private fun imeEnter(s: AccessibilityService): EylemSonucu {
        val odak = s.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return hata(CihazHatasi.ELEMENT_BULUNAMADI)
        val id = AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id
        return if (odak.performAction(id)) EylemSonucu.Gonderildi else hata(CihazHatasi.EYLEM_BASARISIZ)
    }

    // ---------------------------------------------------------------------------------------------
    // Jestler
    // ---------------------------------------------------------------------------------------------

    /** Tek dokunuş 50 ms; uzun basma sistem eşiği + 400 ms; çift dokunuşta iki vuruş arası 100 ms. */
    private fun noktayaDokunIc(s: AccessibilityService, nokta: Nokta, tiklama: Int, uzun: Boolean): EylemSonucu {
        if (tiklama !in 1..2 || nokta.x < 0 || nokta.y < 0) return hata(CihazHatasi.EYLEM_BASARISIZ)
        val basma = if (uzun) ViewConfiguration.getLongPressTimeout().toLong() + UZUN_BASMA_PAYI_MS else DOKUNMA_MS
        val yapici = GestureDescription.Builder()
        var bas = 0L
        repeat(tiklama) {
            yapici.addStroke(GestureDescription.StrokeDescription(noktaYolu(nokta), bas, basma))
            bas += basma + CIFT_ARA_MS
        }
        return jestGonder(s, yapici.build(), bas - CIFT_ARA_MS)
    }

    /**
     * `miktar` birimi eksen boyunun onda biri (varsayılan 5 = yarım ekran). Parmak içeriğin tersine
     * gider (DOWN: parmak yukarı). Her vuruş tam olarak `nokta`da (yoksa çekirdekle aynı ekran
     * ortasında) BAŞLAR: dokunuşu alan pencere çekirdeğin denetlediği penceredir; bitiş ekranın %5
     * kenarına girmez. Uzun mesafe en çok 6 vuruşa bölünür; yer darsa eksik kaydırır. Fırlatma (fling)
     * nedeniyle gerçek kayma miktardan fazla olabilir.
     */
    private fun kaydirIc(s: AccessibilityService, yon: KaydirmaYonu, miktar: Int?, nokta: Nokta?): EylemSonucu {
        val adim = miktar ?: VARSAYILAN_KAYDIRMA
        if (adim !in 1..Sinirlar.KAYDIRMA_MAX) return hata(CihazHatasi.EYLEM_BASARISIZ)
        val (genislik, yukseklik) = ekranBoyutu(s) ?: return hata(CihazHatasi.EYLEM_BASARISIZ)
        val p = nokta ?: Nokta(genislik / 2, yukseklik / 2)
        if (p.x !in 0 until genislik || p.y !in 0 until yukseklik) return hata(CihazHatasi.EYLEM_BASARISIZ)

        val dikey = yon == KaydirmaYonu.UP || yon == KaydirmaYonu.DOWN
        val boy = if (dikey) yukseklik else genislik
        val konum = if (dikey) p.y else p.x
        val isaret = when (yon) {
            KaydirmaYonu.DOWN, KaydirmaYonu.RIGHT -> -1
            KaydirmaYonu.UP, KaydirmaYonu.LEFT -> 1
        }
        val kenar = (boy * KENAR_ORANI).toInt()
        val alan = if (isaret < 0) konum - kenar else (boy - 1 - kenar) - konum
        val tekMax = minOf(alan, (boy * TEK_SURME_ORANI).toInt())
        val esik = (dokunmaEsigi(s) * 3).toInt()
        if (tekMax < esik) return hata(CihazHatasi.EYLEM_BASARISIZ)

        val toplam = boy.toLong() * adim / KAYDIRMA_BOLEN
        val adet = ((toplam + tekMax - 1) / tekMax).toInt().coerceIn(1, AZAMI_SURME)
        val mesafe = (toplam / adet).toInt().coerceIn(esik, tekMax)
        val son = if (dikey) Nokta(p.x, p.y + isaret * mesafe) else Nokta(p.x + isaret * mesafe, p.y)
        val sure = (mesafe / KAYDIRMA_HIZI).toLong().coerceIn(KAYDIRMA_MIN_MS, KAYDIRMA_MAX_MS)

        for (i in 0 until adet) {
            if (i > 0) {
                Thread.sleep(SURME_ARA_MS)
                if (!hala(s)) return hata(CihazHatasi.EYLEM_BASARISIZ)
            }
            val sonuc = jestGonder(s, cizgiJesti(p, son, sure), sure)
            if (sonuc != EylemSonucu.Gonderildi) return sonuc
        }
        return EylemSonucu.Gonderildi
    }

    /**
     * Tek vuruş: `bas`ta in, düz çizgiyle `son`a git, kalk (yaklaşık 1 px/ms, 300-1500 ms). Başta
     * basılı tutma yok. Dokunma eşiğinden kısa sürükleme dokunuş olurdu: `Basarisiz`.
     */
    private fun surukleIc(s: AccessibilityService, bas: Nokta, son: Nokta): EylemSonucu {
        if (bas.x < 0 || bas.y < 0 || son.x < 0 || son.y < 0) return hata(CihazHatasi.EYLEM_BASARISIZ)
        val mesafe = hypot((son.x - bas.x).toDouble(), (son.y - bas.y).toDouble())
        if (mesafe <= dokunmaEsigi(s)) return hata(CihazHatasi.EYLEM_BASARISIZ)
        val sure = (mesafe / SURUKLE_HIZI).toLong().coerceIn(SURUKLE_MIN_MS, SURUKLE_MAX_MS)
        return jestGonder(s, cizgiJesti(bas, son, sure), sure)
    }

    private fun noktaYolu(n: Nokta): Path = Path().apply { moveTo(n.x.toFloat(), n.y.toFloat()) }

    private fun cizgiJesti(a: Nokta, b: Nokta, sure: Long): GestureDescription {
        val yol = Path().apply {
            moveTo(a.x.toFloat(), a.y.toFloat())
            lineTo(b.x.toFloat(), b.y.toFloat())
        }
        return GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(yol, 0L, sure))
            .build()
    }

    /** Sistemin dokunma eşiği (8 dp) piksel olarak. */
    private fun dokunmaEsigi(s: AccessibilityService): Float = DOKUNMA_ESIGI_DP * s.resources.displayMetrics.density

    /**
     * Önce `EkranPortu.anlik()`'in boyutu: çekirdek varsayılan kaydırma noktasını aynı değerin
     * ortasından denetler. Okunamazsa ekranın tam sınırı.
     */
    private fun ekranBoyutu(s: AccessibilityService): Pair<Int, Int>? {
        val anlik = try {
            Adaptor.cekirdek?.ekran?.anlik()
        } catch (_: RuntimeException) {
            null
        }
        if (anlik != null && anlik.ekranGenisligi > 0 && anlik.ekranYuksekligi > 0) {
            return anlik.ekranGenisligi to anlik.ekranYuksekligi
        }
        val wm = s.getSystemService(WindowManager::class.java) ?: return null
        val sinir = wm.maximumWindowMetrics.bounds
        return if (sinir.width() > 0 && sinir.height() > 0) sinir.width() to sinir.height() else null
    }

    /**
     * Jesti verir ve sonucunu sınırlı süre bekler. Geri çağrı ana iplikte gelir (işleyici `null`);
     * işçi bloklanır, ana iplik bloklanmaz. `false` dönüş ya da iptal: `EYLEM_BASARISIZ`; süre
     * dolarsa `ZAMAN_ASIMI` (jest hâlâ sürüyor olabilir; sonraki jest onu iptal eder).
     */
    private fun jestGonder(s: AccessibilityService, jest: GestureDescription, sureMs: Long): EylemSonucu {
        val b = JestBekleyici()
        bekleyen = b
        try {
            // `kopar` önce servisi boşaltır sonra bekleyeni düşürür: ikisinden biri mutlaka görülür.
            if (!hala(s)) return hata(CihazHatasi.EYLEM_BASARISIZ)
            if (!s.dispatchGesture(jest, b, null)) return hata(CihazHatasi.EYLEM_BASARISIZ)
            if (!b.bekle(sureMs + JEST_PAYI_MS)) return hata(CihazHatasi.ZAMAN_ASIMI)
            return if (b.durum() == JestBekleyici.TAMAM) EylemSonucu.Gonderildi else hata(CihazHatasi.EYLEM_BASARISIZ)
        } finally {
            bekleyen = null
        }
    }

    private class JestBekleyici : AccessibilityService.GestureResultCallback() {
        private val sonuc = AtomicInteger(BEKLIYOR)
        private val bitti = CountDownLatch(1)

        override fun onCompleted(gestureDescription: GestureDescription?) = bitir(TAMAM)

        override fun onCancelled(gestureDescription: GestureDescription?) = bitir(IPTAL)

        fun koptu() = bitir(IPTAL)

        fun bekle(ms: Long): Boolean = bitti.await(ms, TimeUnit.MILLISECONDS)

        fun durum(): Int = sonuc.get()

        private fun bitir(s: Int) {
            sonuc.compareAndSet(BEKLIYOR, s)
            bitti.countDown()
        }

        companion object {
            const val BEKLIYOR = 0
            const val TAMAM = 1
            const val IPTAL = 2
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Uygulama açma
    // ---------------------------------------------------------------------------------------------

    /**
     * Yalnız `getLaunchIntentForPackage(paket)`; veri, ek ya da URL eklenmez. Çözülen bileşen başka
     * pakete çıkarsa açılmaz. Başlatıcısı olmayan paket `UYGULAMA_BULUNAMADI`.
     */
    private fun uygulamaAcIc(s: AccessibilityService, paket: String): EylemSonucu {
        if (paket.isEmpty() || paket.length > Sinirlar.PAKET_ADI) return hata(CihazHatasi.UYGULAMA_BULUNAMADI)
        val niyet = s.packageManager.getLaunchIntentForPackage(paket)
            ?: return hata(CihazHatasi.UYGULAMA_BULUNAMADI)
        if (niyet.component?.packageName != paket) return hata(CihazHatasi.UYGULAMA_BULUNAMADI)
        niyet.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        if (!hala(s)) return hata(CihazHatasi.EYLEM_BASARISIZ)
        return try {
            // Arka plandan başlatma, sistemin bağladığı erişilebilirlik servisi istisnasıyla izinlidir.
            s.startActivity(niyet)
            EylemSonucu.Gonderildi
        } catch (_: ActivityNotFoundException) {
            hata(CihazHatasi.UYGULAMA_BULUNAMADI)
        }
    }

    private companion object {
        const val DOKUNMA_MS = 50L
        const val UZUN_BASMA_PAYI_MS = 400L
        const val CIFT_ARA_MS = 100L
        const val TEKRAR_ARA_MS = 150L
        const val JEST_PAYI_MS = 2_000L
        const val ATA_SINIRI = 64

        const val VARSAYILAN_KAYDIRMA = 5
        const val KAYDIRMA_BOLEN = 10L
        const val KENAR_ORANI = 0.05f
        const val TEK_SURME_ORANI = 0.45f
        const val AZAMI_SURME = 6
        const val SURME_ARA_MS = 250L
        const val KAYDIRMA_HIZI = 1.5f
        const val KAYDIRMA_MIN_MS = 200L
        const val KAYDIRMA_MAX_MS = 800L

        const val SURUKLE_HIZI = 1.0
        const val SURUKLE_MIN_MS = 300L
        const val SURUKLE_MAX_MS = 1_500L
        const val DOKUNMA_ESIGI_DP = 8f
    }
}
