package dev.eren.cihaz.adaptor

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.app.KeyguardManager
import android.content.ComponentName
import android.content.Context
import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import android.util.DisplayMetrics
import android.view.Display
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import dev.eren.cihaz.cekirdek.AnlikDurum
import dev.eren.cihaz.cekirdek.CihazDurumu
import dev.eren.cihaz.cekirdek.CihazHatasi
import dev.eren.cihaz.cekirdek.Dikdortgen
import dev.eren.cihaz.cekirdek.Dugum
import dev.eren.cihaz.cekirdek.DugumBaglami
import dev.eren.cihaz.cekirdek.EkranPortu
import dev.eren.cihaz.cekirdek.ElementOkumasi
import dev.eren.cihaz.cekirdek.GoruntuSonucu
import dev.eren.cihaz.cekirdek.Pencere
import dev.eren.cihaz.cekirdek.PencereTuru
import dev.eren.cihaz.cekirdek.Sinirlar
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.roundToInt

/**
 * `EkranPortu`'nun gerçeği: erişilebilirlik ağacından ve `takeScreenshot`'tan okur. Hiçbir okuma
 * ekranı değiştirmez (eylem, odak isteği, kaydırma yok). Paket süzmesi ve kapı çekirdektedir; burada
 * yalnız ham okuma ve iki değişmez var: parola alanının metni hiç okunmaz, düğüm numaraları yalnız
 * son okumaya aittir.
 *
 * PENCERE TÜRÜ (üretici arayüzlerinde ölçülmedi; hata yönü bilinçli). Erişilebilirlik türü + geometri:
 *   TYPE_APPLICATION → UYGULAMA (PiP kipindeyse PIP; systemui balon/yüzen pencereleri de buraya
 *   düşer, paketleri izinli olamayacağı için çekirdekte reddedilir), TYPE_INPUT_METHOD → KLAVYE,
 *   erişilebilirlik/büyütme katmanı → ERISILEBILIRLIK_KATMANI, bölünmüş ekran ayıracı → DIGER_SISTEM,
 *   bilinmeyen tür → BILINMIYOR. TYPE_SYSTEM yalnız sıkı geometriyle çubuk sayılır, çünkü çubuk
 *   görüntüde paketsiz serbest geçer: odaksız, üst kenara yapışık, tam genişlik, en çok 1,5 durum
 *   çubuğu boyu → DURUM_CUBUGU; odaksız, alt/yan kenara yapışık ince şerit → GEZINTI_CUBUGU. Geri
 *   kalan sistem pencereleri: üstten yarıdan uzun → PERDE, üst çeyrekte kısa → HEADS_UP, öteki →
 *   DIGER_SISTEM (paket süzmesinden geçer, systemui izinli olmadığından reddedilir).
 *
 * İPLİK. `bagla`/`kopar`/`pencereOlayi` ana iplikte, port çağrıları ve `canliDugum` komut işçisinde
 * gelir. Servis, nesil ve son olay `@Volatile`/atomik; düğüm kaydı (`okuma`) yalnız `kilit` altında
 * okunur ve yazılır, kilit altında IPC yapılmaz. Kayıttaki düğüm nesneleri hiç değiştirilmez;
 * dışarı her zaman kopyası (tazelenmiş) verilir.
 *
 * BAĞLAM. Uygulama bağlamı kurucudan gelir (`CihazServisi`); servis bağlanmadan önce de `durum()`
 * (kilit, `ADB_ENABLED`) ve varsayılan klavye okuması onu kullanır.
 */
class EkranOkuyucu(baglam: Context) : EkranPortu, A11yBagi {
    private companion object {
        /** Bir `elementler()` okumasında gezilen en çok düğüm. */
        const val GEZINTI_SINIRI = 5_000

        /** Çekirdeğe verilen en çok düğüm (çekirdek süzüp `ELEMENT_ADET`'e indirir). */
        const val DUGUM_SINIRI = 2_000
        const val GEZINTI_SURESI_MS = 3_000L

        /** `Etiket` her tıklanabilir atayı tarar: zincir pratikte hiç kesilmesin. */
        const val ATA_SINIRI = 128
        const val TORUN_DERINLIGI = 3
        const val TORUN_SINIRI = 1_000

        /** Bellekte tutulan metin; kabloya çıkan kırpma çekirdekte (`ELEMENT_METIN`). */
        const val METIN_SINIRI = 2 * Sinirlar.ELEMENT_METIN

        /** Bu süreden eski okumanın numaraları geçmez. */
        const val OKUMA_OMRU_MS = 10 * 60_000L

        const val GORUNTU_SURESI_MS = 5_000L

        /** `INTERVAL_TIME_SHORT` sonrası tek yeniden deneme beklemesi (OLCUMLER: ≥1 sn). */
        const val ARALIK_BEKLEME_MS = 1_000L

        /** Tam ekran görüntünün uzun kenarı; `zoom` yalnız küçültülür, büyütülmez. */
        const val UZUN_KENAR = 1_280
        val KALITELER = intArrayOf(80, 60, 40)

        const val SIYAH_ORNEK = 64
        const val SIYAH_PARLAKLIK = 8

        val LISTELER = listOf("RecyclerView", "ListView", "GridView", "ScrollView", "ViewPager", "ViewPager2")

        /** Tanı günlüğünde yalnız bu biçimdeki paket adı yazılır. */
        val TANI_PAKET = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$")

        /** Ekran görüntüsü geri çağrısı bağlayıcı ipliğinde çalışır; yalnız sonucu bırakır. */
        val DOGRUDAN = Executor { it.run() }

        /** Bekleyen vazgeçti; geç gelen görüntü tamponu kapatılır. */
        val TERK = Any()
    }

    /** Son `elementler()` okumasının numaraları; `odak()` kaydı sona ekler. Yalnız `kilit` altında. */
    private class Okuma(val servis: AccessibilityService, val nesil: Long, val zamanMs: Long) {
        val dugumler = ArrayList<AccessibilityNodeInfo>()

        /** `AccessibilityNodeInfo.equals` kaynak düğüm + pencere kimliğidir. */
        val numaralar = HashMap<AccessibilityNodeInfo, Int>()

        fun ekle(n: AccessibilityNodeInfo): Int {
            numaralar[n]?.let { return it }
            val no = dugumler.size
            dugumler.add(n)
            numaralar[n] = no
            return no
        }
    }

    private sealed interface Ham {
        class Basarili(val sonuc: AccessibilityService.ScreenshotResult) : Ham
        class Hata(val kod: Int) : Ham
    }

    private class Esikler(val durumAzami: Int, val gezintiAzami: Int, val ince: Int)

    @Volatile private var servis: AccessibilityService? = null

    /** Uygulama bağlamı (servis bağlamı sızmasın diye `applicationContext`). */
    private val uygulama: Context = baglam.applicationContext ?: baglam

    @Volatile private var sonOlayPaketi: String? = null

    /** Her bağlanma/kopmada artar; eski nesilden okuma geçmez. */
    private val nesil = AtomicLong()

    private val kilit = Any()
    private var okuma: Okuma? = null

    // ---------------------------------------------------------------------------------------------
    // Bağlanma
    // ---------------------------------------------------------------------------------------------

    override fun bagla(servis: AccessibilityService) {
        nesil.incrementAndGet()
        synchronized(kilit) { okuma = null }
        sonOlayPaketi = null
        this.servis = servis
    }

    override fun kopar() {
        this.servis = null
        nesil.incrementAndGet()
        synchronized(kilit) { okuma = null }
        sonOlayPaketi = null
    }

    /**
     * `ErisimServisi`: `TYPE_WINDOW_STATE_CHANGED` olayının paketi (yalnız aktif izin varken). Klavye
     * açılınca gelen olayın paketi o anki varsayılan giriş yöntemiyse son olay ezilmez; yoksa kapı her
     * yazmayı ön plan değişti diye reddeder. Başka hiçbir paket süzülmez.
     */
    fun pencereOlayi(paket: String?) {
        if (servis == null) return
        if (paket != null && paket == varsayilanKlavyePaketi()) return
        sonOlayPaketi = paket
    }

    /**
     * Son okumada `no` numarasını almış düğümün tazelenmiş kopyası. Düğüm artık yoksa ya da görünmüyorsa,
     * okuma eskidiyse (yeni bağlanma, `OKUMA_OMRU_MS`) ya da servis bağlı değilse `null`.
     */
    fun canliDugum(no: Int): AccessibilityNodeInfo? {
        val s = servis ?: return null
        val kopya = synchronized(kilit) {
            val o = gecerliOkuma(s) ?: return null
            if (no < 0 || no >= o.dugumler.size) return null
            kopyala(o.dugumler[no])
        }
        return try {
            if (kopya.refresh() && kopya.isVisibleToUser && servis === s) kopya else null
        } catch (e: Exception) {
            null
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Port
    // ---------------------------------------------------------------------------------------------

    /** İçerik okumaz: bağlılık, kilit ekranı, `ADB_ENABLED`. Okunamayan kilit "kilitli" sayılır. */
    override fun durum(): CihazDurumu {
        val bagli = servis != null
        return CihazDurumu(a11y = bagli, kilitli = kilitliMi(uygulama), adbAcik = adbAcikMi(uygulama))
    }

    override fun anlik(): AnlikDurum {
        val zaman = SystemClock.elapsedRealtime()
        val s = servis ?: return bosAnlik(zaman).also { sonAnlik = it }
        val a = try {
            anlikOku(s, zaman)
        } catch (e: Exception) {
            bosAnlik(zaman)
        }
        sonAnlik = a
        return a
    }

    /**
     * Tanı günlüğü (`CihazServisi` "ErenKapi"): son `anlik()` okumasının yalnız paket adları ve pencere
     * türleri. Kapının her ret dalında son okunan anlık kararın girdisidir (kural 8, 11, 12). Başlık,
     * metin, düğüm içeriği yok; paket biçimine uymayan ad `?` olur.
     */
    @Volatile private var sonAnlik: AnlikDurum? = null

    fun sonAnlikOzeti(): String {
        val a = sonAnlik ?: return "anlik=yok"
        // Çubuklar ve aktif kökün kendi uygulama penceresi dışındaki görünen pencereler: izin dışı adaylar.
        val diger = a.pencereler
            .filter { it.tur != PencereTuru.DURUM_CUBUGU && it.tur != PencereTuru.GEZINTI_CUBUGU }
            .filter { !(it.tur == PencereTuru.UYGULAMA && it.paket == a.aktifKokPaketi) }
            .joinToString(",") { "${it.tur.name}:${guvenliPaket(it.paket)}" }
        return "kok=${guvenliPaket(a.aktifKokPaketi)} olay=${guvenliPaket(a.sonOlayPaketi)}" +
            " odak=${guvenliPaket(a.odakPaketi)} pencereler=[$diger]"
    }

    private fun guvenliPaket(p: String?): String = when {
        p == null -> "null"
        p.length <= Sinirlar.PAKET_ADI && TANI_PAKET.matches(p) -> p
        else -> "?"
    }

    override fun elementler(): ElementOkumasi {
        val s = servis ?: return ElementOkumasi(dugumler = emptyList(), kirpildi = false)
        val n0 = nesil.get()
        val bas = SystemClock.elapsedRealtime()
        val yeni = Okuma(s, n0, bas)
        val cikti = ArrayList<Dugum>()
        val kirpildi = try {
            gez(s, yeni, cikti, bas)
        } catch (e: Exception) {
            // Okuma yarıda kaldı: elde olan verilir, eksik olduğu söylenir.
            true
        }
        synchronized(kilit) {
            if (servis !== s || nesil.get() != n0) return ElementOkumasi(dugumler = emptyList(), kirpildi = false)
            okuma = yeni
        }
        return ElementOkumasi(dugumler = cikti, kirpildi = kirpildi)
    }

    override fun dugum(no: Int): DugumBaglami? {
        val s = servis ?: return null
        return try {
            val n = canliDugum(no) ?: return null
            baglamKur(s, n, no)
        } catch (e: Exception) {
            null
        }
    }

    override fun odak(): DugumBaglami? {
        val s = servis ?: return null
        return try {
            val f = s.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return null
            if (!f.refresh() || !f.isEditable || !f.isVisibleToUser) return null
            // Eylemci aynı numarayla `canliDugum` çağırır: odak düğümü de son okumaya kaydedilir.
            val no = kaydet(s, kopyala(f)) ?: return null
            baglamKur(s, f, no)
        } catch (e: Exception) {
            null
        }
    }

    /** `ERROR_TAKE_SCREENSHOT_SECURE_WINDOW` API 34 sabitidir; derlemede gömülür, 30-33'te hiç gelmez. */
    @SuppressLint("InlinedApi")
    override fun goruntu(bolge: Dikdortgen?): GoruntuSonucu {
        val s = servis ?: return GoruntuSonucu.Basarisiz(CihazHatasi.EYLEM_BASARISIZ)
        val bitis = SystemClock.elapsedRealtime() + GORUNTU_SURESI_MS
        var ham = hamGoruntu(s, GORUNTU_SURESI_MS) ?: return GoruntuSonucu.Basarisiz(CihazHatasi.ZAMAN_ASIMI)
        if (ham is Ham.Hata && ham.kod == AccessibilityService.ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT) {
            if (bitis - SystemClock.elapsedRealtime() <= ARALIK_BEKLEME_MS || !uyu(ARALIK_BEKLEME_MS)) {
                return GoruntuSonucu.Basarisiz(CihazHatasi.EKRAN_ALINAMADI)
            }
            val kalan = (bitis - SystemClock.elapsedRealtime()).coerceAtLeast(1L)
            ham = hamGoruntu(s, kalan) ?: return GoruntuSonucu.Basarisiz(CihazHatasi.ZAMAN_ASIMI)
        }
        return when (ham) {
            is Ham.Basarili -> try {
                isle(ham.sonuc, bolge)
            } catch (e: OutOfMemoryError) {
                GoruntuSonucu.Basarisiz(CihazHatasi.EKRAN_ALINAMADI)
            } catch (e: Exception) {
                GoruntuSonucu.Basarisiz(CihazHatasi.EKRAN_ALINAMADI)
            }
            is Ham.Hata ->
                if (ham.kod == AccessibilityService.ERROR_TAKE_SCREENSHOT_SECURE_WINDOW) {
                    GoruntuSonucu.Korumali
                } else {
                    GoruntuSonucu.Basarisiz(CihazHatasi.EKRAN_ALINAMADI)
                }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Durum
    // ---------------------------------------------------------------------------------------------

    private fun kilitliMi(ctx: Context): Boolean = try {
        val km = ctx.getSystemService(KeyguardManager::class.java)
        km == null || km.isKeyguardLocked || km.isDeviceLocked
    } catch (e: Exception) {
        true
    }

    private fun adbAcikMi(ctx: Context): Boolean = try {
        Settings.Global.getInt(ctx.contentResolver, Settings.Global.ADB_ENABLED, 0) == 1
    } catch (e: Exception) {
        false
    }

    /**
     * `Settings.Secure.DEFAULT_INPUT_METHOD` ("paket/sınıf") içindeki paket; okunamazsa `null` (o
     * zaman hiçbir olay süzülmez). Her olayda okunur: kullanıcı klavyeyi değiştirebilir.
     */
    private fun varsayilanKlavyePaketi(): String? = try {
        Settings.Secure.getString(uygulama.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
            ?.let { ComponentName.unflattenFromString(it)?.packageName }
            ?.takeIf { it.isNotEmpty() }
    } catch (e: Exception) {
        null
    }

    // ---------------------------------------------------------------------------------------------
    // Anlık durum ve pencereler
    // ---------------------------------------------------------------------------------------------

    private fun bosAnlik(zaman: Long) = AnlikDurum(
        aktifKokPaketi = null,
        sonOlayPaketi = null,
        odakPaketi = null,
        baslik = null,
        pencereler = emptyList(),
        ekranGenisligi = 0,
        ekranYuksekligi = 0,
        alinmaMonotonikMs = zaman,
    )

    private fun anlikOku(s: AccessibilityService, zaman: Long): AnlikDurum {
        val (gen, yuk) = ekranBoyutu(s)
        val esik = esikler(s)
        val pencereler = ArrayList<Pencere>()
        var odakPaketi: String? = null
        var baslik: String? = null
        val r = Rect()
        for (w in siraliPencereler(s)) {
            w.getBoundsInScreen(r)
            val gorunur = ekrandaMi(r, gen, yuk)
            val paket = if (gorunur || w.isFocused) kokPaketi(w) else null
            if (w.isFocused && odakPaketi == null) odakPaketi = paket
            if (w.isActive && baslik == null) baslik = w.title?.toString()?.let { kirp(it, METIN_SINIRI) }
            if (gorunur) {
                pencereler.add(
                    Pencere(
                        tur = tur(w, r, gen, yuk, esik),
                        paket = paket,
                        katman = w.layer,
                        sinir = dikdortgen(r),
                        aktif = w.isActive,
                        odakli = w.isFocused,
                    ),
                )
            }
        }
        val aktifKok = try {
            s.rootInActiveWindow?.packageName?.toString()
        } catch (e: Exception) {
            null
        }
        return AnlikDurum(
            aktifKokPaketi = aktifKok,
            sonOlayPaketi = sonOlayPaketi,
            odakPaketi = odakPaketi,
            baslik = baslik,
            pencereler = pencereler,
            ekranGenisligi = gen,
            ekranYuksekligi = yuk,
            alinmaMonotonikMs = zaman,
        )
    }

    /** En üst pencere önce. */
    private fun siraliPencereler(s: AccessibilityService): List<AccessibilityWindowInfo> = try {
        s.windows.sortedByDescending { it.layer }
    } catch (e: Exception) {
        emptyList()
    }

    private fun kokPaketi(w: AccessibilityWindowInfo): String? = try {
        w.root?.packageName?.toString()
    } catch (e: Exception) {
        null
    }

    /** Boş ya da ekran dışındaki pencere hiçbir şey göstermez; listeye girmez. */
    private fun ekrandaMi(r: Rect, gen: Int, yuk: Int): Boolean =
        !r.isEmpty && (gen <= 0 || yuk <= 0 || r.intersects(0, 0, gen, yuk))

    /** Mantıksal gerçek boyut (dönüş dahil); erişilebilirlik sınırları ve görüntü aynı uzayda. */
    @Suppress("DEPRECATION")
    private fun ekranBoyutu(c: Context): Pair<Int, Int> = try {
        val d = c.getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY)
        if (d == null) {
            0 to 0
        } else {
            val dm = DisplayMetrics()
            d.getRealMetrics(dm)
            dm.widthPixels to dm.heightPixels
        }
    } catch (e: Exception) {
        0 to 0
    }

    private fun esikler(c: Context): Esikler {
        val r = c.resources
        val dp = r.displayMetrics.density
        val durum = maxOf(
            maxOf(sistemBoyutu(r, "status_bar_height"), sistemBoyutu(r, "status_bar_height_portrait")),
            maxOf(sistemBoyutu(r, "status_bar_height_landscape"), (24 * dp).roundToInt()),
        )
        val gezinti = maxOf(
            maxOf(sistemBoyutu(r, "navigation_bar_height"), sistemBoyutu(r, "navigation_bar_width")),
            maxOf(sistemBoyutu(r, "navigation_bar_frame_height"), (48 * dp).roundToInt()),
        )
        return Esikler(durumAzami = durum * 3 / 2, gezintiAzami = gezinti * 3 / 2, ince = (24 * dp).roundToInt())
    }

    @SuppressLint("DiscouragedApi", "InternalInsetResource")
    private fun sistemBoyutu(r: Resources, ad: String): Int = try {
        val id = r.getIdentifier(ad, "dimen", "android")
        if (id == 0) 0 else r.getDimensionPixelSize(id)
    } catch (e: Exception) {
        0
    }

    /** `TYPE_MAGNIFICATION_OVERLAY` API 33 sabitidir; derlemede gömülür. */
    @SuppressLint("InlinedApi")
    private fun tur(w: AccessibilityWindowInfo, r: Rect, gen: Int, yuk: Int, e: Esikler): PencereTuru =
        when (w.type) {
            AccessibilityWindowInfo.TYPE_APPLICATION ->
                if (w.isInPictureInPictureMode) PencereTuru.PIP else PencereTuru.UYGULAMA
            AccessibilityWindowInfo.TYPE_INPUT_METHOD -> PencereTuru.KLAVYE
            AccessibilityWindowInfo.TYPE_SYSTEM -> sistemTuru(w, r, gen, yuk, e)
            AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY,
            AccessibilityWindowInfo.TYPE_MAGNIFICATION_OVERLAY,
            -> PencereTuru.ERISILEBILIRLIK_KATMANI
            AccessibilityWindowInfo.TYPE_SPLIT_SCREEN_DIVIDER -> PencereTuru.DIGER_SISTEM
            else -> PencereTuru.BILINMIYOR
        }

    /** Çubuk sayılmak görüntüde serbest geçiştir: yalnız odaksız ve kenara yapışık ince şerit. */
    private fun sistemTuru(w: AccessibilityWindowInfo, r: Rect, gen: Int, yuk: Int, e: Esikler): PencereTuru {
        if (gen <= 0 || yuk <= 0) return PencereTuru.BILINMIYOR
        val ust = r.top <= 0
        val alt = r.bottom >= yuk
        val sol = r.left <= 0
        val sag = r.right >= gen
        val en = r.width()
        val boy = r.height()
        if (!w.isFocused && !w.isActive) {
            if (ust && !alt && sol && sag && boy <= e.durumAzami) return PencereTuru.DURUM_CUBUGU
            // Dikey gezinti çubuğu ya da tam genişlikte alt çubuk.
            if (alt && !ust && sol && sag && boy <= e.gezintiAzami) return PencereTuru.GEZINTI_CUBUGU
            if (ust && alt && sol != sag && en <= e.gezintiAzami) return PencereTuru.GEZINTI_CUBUGU
            // Hareket şeritleri: alt ya da yan kenarda çok ince parça.
            if (alt && !ust && boy <= e.ince) return PencereTuru.GEZINTI_CUBUGU
            if (sol != sag && !(ust && alt) && en <= e.ince) return PencereTuru.GEZINTI_CUBUGU
        }
        return when {
            ust && sol && sag && boy >= yuk / 2 -> PencereTuru.PERDE
            r.top < yuk / 4 && boy < yuk / 2 -> PencereTuru.HEADS_UP
            else -> PencereTuru.DIGER_SISTEM
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Ağaç
    // ---------------------------------------------------------------------------------------------

    /** Görünen pencerelerin ağacı, en üst pencere önce, ön sıralı. Sınıra takıldıysa `true`. */
    private fun gez(s: AccessibilityService, yeni: Okuma, cikti: MutableList<Dugum>, bas: Long): Boolean {
        val (gen, yuk) = ekranBoyutu(s)
        val r = Rect()
        val kokler = ArrayList<AccessibilityNodeInfo>()
        for (w in siraliPencereler(s)) {
            w.getBoundsInScreen(r)
            if (!ekrandaMi(r, gen, yuk)) continue
            val kok = try {
                w.root
            } catch (e: Exception) {
                null
            }
            if (kok != null) kokler.add(kok)
        }
        if (kokler.isEmpty()) s.rootInActiveWindow?.let { kokler.add(it) }

        var gezilen = 0
        val yigin = ArrayDeque<AccessibilityNodeInfo>()
        for (kok in kokler) {
            yigin.clear()
            yigin.addLast(kok)
            while (yigin.isNotEmpty()) {
                if (gezilen >= GEZINTI_SINIRI || SystemClock.elapsedRealtime() - bas > GEZINTI_SURESI_MS) return true
                val n = yigin.removeLast()
                gezilen++
                // Görünmeyen alt ağaç (ekran dışı sayfa vb.) gezilmez.
                if (!n.isVisibleToUser) continue
                for (i in n.childCount - 1 downTo 0) n.getChild(i)?.let { yigin.addLast(it) }
                if (!secilir(n) || yeni.numaralar.containsKey(n)) continue
                if (cikti.size >= DUGUM_SINIRI) return true
                val d = dugumYap(n, yeni.dugumler.size)
                yeni.ekle(n)
                cikti.add(d)
            }
        }
        return false
    }

    private fun secilir(n: AccessibilityNodeInfo): Boolean {
        if (n.isPassword || n.isEditable || n.isCheckable || n.isClickable || n.isLongClickable) return true
        if (!n.text.isNullOrEmpty() || !n.contentDescription.isNullOrEmpty()) return true
        return tiklamaEylemiVar(n)
    }

    private fun tiklamaEylemiVar(n: AccessibilityNodeInfo): Boolean =
        n.actionList.any { it.id == AccessibilityNodeInfo.ACTION_CLICK }

    /** Hepsi `n`'nin şimdiki halinden. Parola alanında metin ve açıklama hiç okunmaz. */
    private fun dugumYap(n: AccessibilityNodeInfo, no: Int): Dugum {
        val parola = n.isPassword
        val duzenlenebilir = n.isEditable
        val tiklanabilir = n.isClickable || tiklamaEylemiVar(n)
        val ipucu = n.hintText?.toString()?.let { kirp(it, METIN_SINIRI) }
        val ad: String
        val deger: String?
        if (parola) {
            ad = ipucu.orEmpty()
            deger = null
        } else {
            val metin = n.text?.toString()
            val aciklama = n.contentDescription?.toString()
            if (duzenlenebilir) {
                // Alanın içeriği `ad`'a karışmaz; çekirdek parola sezerse yalnız `deger`'i düşürür.
                ad = aciklama?.takeIf { it.isNotEmpty() } ?: ipucu.orEmpty()
                deger = if (n.isShowingHintText) "" else metin.orEmpty()
            } else {
                ad = birlestir(metin, aciklama)
                deger = null
            }
        }
        val r = Rect()
        n.getBoundsInScreen(r)
        return Dugum(
            no = no,
            paket = n.packageName?.toString(),
            rol = rol(n, tiklanabilir, ad.isNotEmpty()),
            ad = kirp(ad, METIN_SINIRI),
            deger = deger?.let { kirp(it, METIN_SINIRI) },
            ipucu = ipucu,
            kaynakId = n.viewIdResourceName?.let { kirp(it, METIN_SINIRI) },
            sinir = dikdortgen(r),
            tiklanabilir = tiklanabilir,
            duzenlenebilir = duzenlenebilir,
            etkin = n.isEnabled,
            parola = parola,
            odakli = n.isFocused,
        )
    }

    private fun birlestir(metin: String?, aciklama: String?): String {
        val m = metin?.takeIf { it.isNotEmpty() }
        val a = aciklama?.takeIf { it.isNotEmpty() }
        return when {
            m == null -> a.orEmpty()
            a == null || a == m -> m
            else -> "$m ($a)"
        }
    }

    /** Sınıf adından rol; Compose ve WebView de rolü `android.widget.*` sınıf adıyla bildirir. */
    private fun rol(n: AccessibilityNodeInfo, tiklanabilir: Boolean, metinVar: Boolean): String {
        val sinif = n.className?.toString()?.substringAfterLast('.').orEmpty()
        if (n.isEditable || n.isPassword || sinif.endsWith("EditText") || sinif.endsWith("AutoCompleteTextView")) {
            return "edit"
        }
        return when {
            sinif.endsWith("RadioButton") -> "radio"
            sinif.endsWith("CheckBox") || sinif == "CheckedTextView" -> "checkbox"
            sinif.startsWith("Switch") || sinif.endsWith("Switch") -> "switch"
            sinif.endsWith("ToggleButton") -> "toggle"
            sinif.endsWith("Button") -> "button"
            sinif.endsWith("Spinner") -> "dropdown"
            sinif.endsWith("SeekBar") || sinif.endsWith("Slider") || sinif == "RatingBar" -> "slider"
            sinif.endsWith("ProgressBar") -> "progress"
            sinif.endsWith("WebView") -> "web"
            sinif == "TabWidget" || sinif.endsWith("TabView") -> "tab"
            LISTELER.any { sinif.endsWith(it) } -> "list"
            n.isCheckable -> "checkbox"
            tiklanabilir || n.isLongClickable -> "button"
            sinif.endsWith("ImageView") || sinif == "Image" -> "image"
            n.isHeading -> "heading"
            metinVar || sinif.endsWith("TextView") -> "text"
            else -> "group"
        }
    }

    /** Düğüm, bütün ataları (köke doğru) ve üç kat torunu; numara son okumadaysa o, değilse -1. */
    private fun baglamKur(s: AccessibilityService, n: AccessibilityNodeInfo, no: Int): DugumBaglami {
        val dugum = dugumYap(n, no)
        val atalar = ArrayList<Dugum>()
        var ata: AccessibilityNodeInfo? = n.parent
        while (ata != null && atalar.size < ATA_SINIRI) {
            atalar.add(dugumYap(ata, numara(s, ata)))
            ata = ata.parent
        }
        val torunlar = ArrayList<Dugum>()
        var kat: List<AccessibilityNodeInfo> = listOf(n)
        var derinlik = 0
        while (derinlik < TORUN_DERINLIGI && kat.isNotEmpty() && torunlar.size < TORUN_SINIRI) {
            val sonraki = ArrayList<AccessibilityNodeInfo>()
            for (ust in kat) {
                for (i in 0 until ust.childCount) {
                    if (torunlar.size >= TORUN_SINIRI) break
                    val c = ust.getChild(i) ?: continue
                    torunlar.add(dugumYap(c, numara(s, c)))
                    sonraki.add(c)
                }
            }
            kat = sonraki
            derinlik++
        }
        return DugumBaglami(dugum = dugum, atalar = atalar, torunlar = torunlar)
    }

    // ---------------------------------------------------------------------------------------------
    // Düğüm kaydı (yalnız `kilit` altında)
    // ---------------------------------------------------------------------------------------------

    /** Kilit altında çağrılır. */
    private fun gecerliOkuma(s: AccessibilityService): Okuma? {
        val o = okuma ?: return null
        if (o.servis !== s || o.nesil != nesil.get()) return null
        if (SystemClock.elapsedRealtime() - o.zamanMs > OKUMA_OMRU_MS) return null
        return o
    }

    private fun numara(s: AccessibilityService, n: AccessibilityNodeInfo): Int =
        synchronized(kilit) { gecerliOkuma(s)?.numaralar?.get(n) } ?: -1

    /** Düğüm son okumadaysa numarası; değilse sona eklenir (okuma yoksa yenisi açılır). */
    private fun kaydet(s: AccessibilityService, n: AccessibilityNodeInfo): Int? {
        synchronized(kilit) {
            if (servis !== s) return null
            val o = gecerliOkuma(s) ?: Okuma(s, nesil.get(), SystemClock.elapsedRealtime()).also { okuma = it }
            return o.ekle(n)
        }
    }

    @Suppress("DEPRECATION")
    private fun kopyala(n: AccessibilityNodeInfo): AccessibilityNodeInfo = AccessibilityNodeInfo.obtain(n)

    // ---------------------------------------------------------------------------------------------
    // Görüntü
    // ---------------------------------------------------------------------------------------------

    /** Eşzamanlı bekler; süre dolarsa `null` (geç gelen tampon geri çağrıda kapatılır). */
    private fun hamGoruntu(s: AccessibilityService, sureMs: Long): Ham? {
        val kutu = AtomicReference<Any?>(null)
        val bitti = CountDownLatch(1)
        val geri = object : AccessibilityService.TakeScreenshotCallback {
            override fun onSuccess(sonuc: AccessibilityService.ScreenshotResult) {
                if (!kutu.compareAndSet(null, Ham.Basarili(sonuc))) kapat(sonuc)
                bitti.countDown()
            }

            override fun onFailure(kod: Int) {
                kutu.compareAndSet(null, Ham.Hata(kod))
                bitti.countDown()
            }
        }
        try {
            s.takeScreenshot(Display.DEFAULT_DISPLAY, DOGRUDAN, geri)
        } catch (e: Exception) {
            return Ham.Hata(AccessibilityService.ERROR_TAKE_SCREENSHOT_INTERNAL_ERROR)
        }
        try {
            bitti.await(sureMs, TimeUnit.MILLISECONDS)
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        return kutu.getAndSet(TERK) as? Ham
    }

    private fun kapat(sonuc: AccessibilityService.ScreenshotResult) {
        try {
            sonuc.hardwareBuffer.close()
        } catch (e: Exception) {
        }
    }

    private fun uyu(ms: Long): Boolean = try {
        Thread.sleep(ms)
        true
    } catch (e: InterruptedException) {
        Thread.currentThread().interrupt()
        false
    }

    /** Kırpar (gerçek piksel), küçültür, JPEG'e çevirir; base64 sınırı aşılırsa kaliteyi/boyutu düşürür. */
    private fun isle(sonuc: AccessibilityService.ScreenshotResult, bolge: Dikdortgen?): GoruntuSonucu {
        val tam = yazilimBitmap(sonuc) ?: return GoruntuSonucu.Basarisiz(CihazHatasi.EKRAN_ALINAMADI)
        try {
            val w = tam.width
            val h = tam.height
            val x0 = (bolge?.sol ?: 0).coerceIn(0, w)
            val y0 = (bolge?.ust ?: 0).coerceIn(0, h)
            val x1 = (bolge?.sag ?: w).coerceIn(0, w)
            val y1 = (bolge?.alt ?: h).coerceIn(0, h)
            if (x1 <= x0 || y1 <= y0) return GoruntuSonucu.Basarisiz(CihazHatasi.EKRAN_ALINAMADI)
            val kw = x1 - x0
            val kh = y1 - y0
            val uzun = maxOf(kw, kh)
            var hedef = minOf(uzun, UZUN_KENAR)
            repeat(4) {
                val iw = maxOf(1, (kw.toDouble() * hedef / uzun).roundToInt())
                val ih = maxOf(1, (kh.toDouble() * hedef / uzun).roundToInt())
                val resim = kesVeOlcekle(tam, x0, y0, kw, kh, iw, ih)
                try {
                    val siyah = siyahOrani(resim)
                    for (q in KALITELER) {
                        val b64 = jpegBase64(resim, q) ?: continue
                        if (b64.length <= Sinirlar.EKRAN_BASE64) {
                            return GoruntuSonucu.Tamam(
                                mime = "image/jpeg",
                                base64 = b64,
                                genislik = iw,
                                yukseklik = ih,
                                olcek = uzun.toDouble() / maxOf(iw, ih),
                                siyahOrani = siyah,
                            )
                        }
                    }
                } finally {
                    if (resim !== tam) resim.recycle()
                }
                hedef = maxOf(1, hedef / 2)
            }
            return GoruntuSonucu.Basarisiz(CihazHatasi.EKRAN_ALINAMADI)
        } finally {
            tam.recycle()
        }
    }

    /** Donanım tamponu her durumda kapatılır. */
    private fun yazilimBitmap(sonuc: AccessibilityService.ScreenshotResult): Bitmap? {
        val hb = sonuc.hardwareBuffer
        try {
            val donanim = Bitmap.wrapHardwareBuffer(hb, sonuc.colorSpace) ?: return null
            try {
                return donanim.copy(Bitmap.Config.ARGB_8888, false)
            } finally {
                donanim.recycle()
            }
        } finally {
            hb.close()
        }
    }

    private fun kesVeOlcekle(tam: Bitmap, x: Int, y: Int, w: Int, h: Int, iw: Int, ih: Int): Bitmap {
        val kesit = if (x == 0 && y == 0 && w == tam.width && h == tam.height) {
            tam
        } else {
            Bitmap.createBitmap(tam, x, y, w, h)
        }
        if (iw == w && ih == h) return kesit
        val olcekli = Bitmap.createScaledBitmap(kesit, iw, ih, true)
        if (kesit !== tam && kesit !== olcekli) kesit.recycle()
        return olcekli
    }

    private fun jpegBase64(b: Bitmap, kalite: Int): String? {
        val cikis = ByteArrayOutputStream()
        if (!b.compress(Bitmap.CompressFormat.JPEG, kalite, cikis)) return null
        return Base64.encodeToString(cikis.toByteArray(), Base64.NO_WRAP)
    }

    /** `FLAG_SECURE` hata vermeden siyah dönebilir (OLCUMLER §5): en çok 64x64 örnekle ölçülür. */
    private fun siyahOrani(b: Bitmap): Double {
        val nx = minOf(SIYAH_ORNEK, b.width)
        val ny = minOf(SIYAH_ORNEK, b.height)
        if (nx <= 0 || ny <= 0) return 1.0
        var siyah = 0
        for (i in 0 until nx) {
            val x = ((2L * i + 1) * b.width / (2L * nx)).toInt()
            for (j in 0 until ny) {
                val y = ((2L * j + 1) * b.height / (2L * ny)).toInt()
                val p = b.getPixel(x, y)
                val l = (((p shr 16) and 255) * 3 + ((p shr 8) and 255) * 6 + (p and 255)) / 10
                if (l < SIYAH_PARLAKLIK) siyah++
            }
        }
        return siyah.toDouble() / (nx * ny)
    }

    // ---------------------------------------------------------------------------------------------
    // Yardımcılar
    // ---------------------------------------------------------------------------------------------

    private fun dikdortgen(r: Rect) = Dikdortgen(sol = r.left, ust = r.top, sag = r.right, alt = r.bottom)

    /** Vekil çifti bölünmez. */
    private fun kirp(s: String, azami: Int): String {
        if (s.length <= azami) return s
        var son = azami
        if (son > 0 && Character.isHighSurrogate(s[son - 1])) son--
        return s.substring(0, son)
    }
}
