package dev.eren.ajanda.ekran

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextPaint
import android.text.TextUtils
import android.text.style.ForegroundColorSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.LinearLayout
import android.widget.TextView
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Takvim sekmesinin üst bölümü (ana ekranın listesinde ilk öğe; altında seçili günün satırları):
 * ay başlığı ve gezinme, ay ızgarası, lejant, seçili günün başlığı ve "Ekle". Yalnız çizer ve olayları
 * iletir; seçim ve veri [TakvimDenetleyici]'de, yerleşim [Takvim]'de.
 */
class TakvimGorunumu(
    c: Context,
    private val t: Tasarim,
    private val gunSec: (LocalDate) -> Unit,
    private val ayKaydir: (Long) -> Unit,
    private val bugune: () -> Unit,
    private val ekle: (LocalDate) -> Unit,
) : LinearLayout(c) {

    private val ayBasligi = t.yazi("", 20f, t.murekkep, serif = true).apply {
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.END
        accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        if (Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true
    }
    private val bugunDugmesi = t.metinDugmesi("Bugün") { bugune() }.apply { contentDescription = "Bugüne dön" }
    private val izgara = AyIzgarasi(c, t, { gunSec(it) }, { ekle(it) }, { ayKaydir(it) })
    private val lejant = t.yazi("", 12f, t.soluk).apply {
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        setPadding(t.dp(20), t.dp(2), t.dp(20), 0)
    }
    private val gunBasligi = t.yazi("", 12f, t.soluk, kalin = true).apply {
        letterSpacing = 0.1f
        if (Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true
        isFocusable = true
    }
    private val ekleDugmesi = t.metinDugmesi("+ Ekle") { model?.let { ekle(it.durum.secili) } }

    private var model: TakvimModeli? = null

    /** Son çizilen ay (ay değişince ızgara kısa bir kaydırmayla gelir). */
    private var sonAy: YearMonth? = null

    init {
        orientation = VERTICAL
        val ust = LinearLayout(c).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(t.dp(20), t.dp(10), t.dp(8), t.dp(2))
        }
        ust.addView(ayBasligi, LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        ust.addView(bugunDugmesi)
        ust.addView(t.metinDugmesi("‹", t.murekkep) { ayKaydir(-1) }.apply {
            textSize = 24f
            contentDescription = "Önceki ay"
        })
        ust.addView(t.metinDugmesi("›", t.murekkep) { ayKaydir(1) }.apply {
            textSize = 24f
            contentDescription = "Sonraki ay"
        })
        addView(ust)
        addView(izgara, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            marginStart = t.dp(8)
            marginEnd = t.dp(8)
        })
        addView(lejant)
        val gun = LinearLayout(c).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(t.dp(20), t.dp(10), t.dp(8), 0)
        }
        gun.addView(gunBasligi, LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        gun.addView(ekleDugmesi)
        addView(gun)
    }

    fun ver(m: TakvimModeli) {
        model = m
        val d = m.durum
        ayBasligi.text = EkranMetinleri.ayVeYil(d.ay)
        bugunDugmesi.visibility = if (d.bugunde) View.INVISIBLE else View.VISIBLE
        lejant.text = lejantMetni(m.kapalilarDahil)

        val sayi = m.gunSayisi?.let { if (it > 0) "  $it" else "" } ?: ""
        gunBasligi.text = m.gunBasligi.uppercase(TR) + sayi
        gunBasligi.setTextColor(if (d.secili == d.bugun) t.vurgu else t.soluk)
        gunBasligi.contentDescription = m.gunBasligi.replace(" · ", ", ") +
            (m.gunSayisi?.let { if (it == 0) ", kayıt yok" else ", $it kayıt" } ?: "")
        ekleDugmesi.contentDescription = "Bu güne kayıt ekle: ${EkranMetinleri.uzunTarih(d.secili, d.bugun)}"

        val onceki = sonAy
        sonAy = d.ay
        izgara.ver(m)
        if (onceki != null && onceki != d.ay) izgara.kayarakGel(if (d.ay > onceki) 1 else -1)
    }

    private fun lejantMetni(kapalilar: Boolean): CharSequence {
        val s = SpannableStringBuilder()
        for ((n, ad) in Takvim.lejant(kapalilar)) {
            if (s.isNotEmpty()) s.append("    ")
            val bas = s.length
            s.append(if (n == Takvim.Nokta.TASLAK) "○" else "●")
            s.setSpan(ForegroundColorSpan(izgara.noktaRengi(n)), bas, s.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            s.append(' ').append(ad)
        }
        return s
    }

    companion object {
        val TR: Locale = Locale.forLanguageTag("tr")
    }
}

/**
 * Ay ızgarası: hafta günü başlıkları, ayın her günü için bir hücre (dokunulur, ekran okuyucuda tek tek
 * okunur), hücrelerin üstünde çok günlü şeritler. Ay dışı hücreler boştur. Yatay kaydırma ayı değiştirir.
 *
 * Yükseklik yazı boyundan ölçülür (sistemin büyük yazı ayarı), sabit dp değil; şerit sırası ayda
 * kullanılan kadar (en çok [TakvimDenetleyici.ENCOK_SIRA]).
 */
private class AyIzgarasi(
    c: Context,
    private val t: Tasarim,
    private val sec: (LocalDate) -> Unit,
    private val ekle: (LocalDate) -> Unit,
    private val kaydir: (Long) -> Unit,
) : ViewGroup(c) {

    private var model: TakvimModeli? = null
    private val hucreler = List(31) { GunHucresi(c) }
    private val KALIN = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
    private val DUZ = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)

    private fun sp(n: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, n, resources.displayMetrics)

    private val gunAdiBoya = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = sp(12f)
        color = t.soluk
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        textAlign = Paint.Align.CENTER
    }
    val sayiBoya = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = sp(15f)
        textAlign = Paint.Align.CENTER
    }
    val kucukBoya = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = sp(9f)
        color = t.soluk
        textAlign = Paint.Align.LEFT
    }
    private val seritYaziBoya = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textSize = sp(11f) }
    val dolgu = Paint(Paint.ANTI_ALIAS_FLAG)
    val cizgi = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val yol = Path()
    private val dikdortgen = RectF()

    private fun yukseklik(p: Paint) = p.fontMetrics.let { it.descent - it.ascent }

    // Ölçüler (onMeasure'da hesaplanır).
    private var sutun = 0f
    private var baslikY = 0
    val sayiAlani get() = max(t.dp(34).toFloat(), yukseklik(sayiBoya) + t.dp(10))
    val noktaAlani get() = max(t.dp(10).toFloat(), yukseklik(kucukBoya) + t.dp(2))
    private val seritYuksekligi get() = max(t.dp(15).toFloat(), yukseklik(seritYaziBoya) + t.dp(3))
    private val seritAdimi get() = seritYuksekligi + t.dp(2)
    private var satirY = 0f

    init {
        hucreler.forEach { addView(it) }
        setWillNotDraw(false)
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    fun noktaRengi(n: Takvim.Nokta) = when (n) {
        Takvim.Nokta.ACIK -> t.vurgu
        Takvim.Nokta.TASLAK -> t.taslakYazi
        Takvim.Nokta.KAPALI -> t.soluk
    }

    fun ver(m: TakvimModeli) {
        val olcuDegisti = model?.let { it.izgara.haftaSayisi != m.izgara.haftaSayisi || it.seritler.siraSayisi != m.seritler.siraSayisi } ?: true
        val ayDegisti = model?.izgara?.ay != m.izgara.ay
        model = m
        val iz = m.izgara
        for ((i, h) in hucreler.withIndex()) {
            if (i >= iz.gunSayisi) {
                h.visibility = View.GONE
                h.tarih = null
                continue
            }
            val gun = iz.ay.atDay(i + 1)
            h.visibility = View.VISIBLE
            h.tarih = gun
            val ozet = m.ozetler?.get(gun)
            h.secili = gun == m.durum.secili
            h.bugun = gun == m.durum.bugun
            h.gecmis = gun < m.durum.bugun
            h.isaretler = Takvim.isaretler(ozet)
            h.gizli = m.seritler.gizli[gun] ?: 0
            h.isSelected = h.secili
            h.contentDescription = Takvim.hucreAciklamasi(gun, ozet, m.durum.bugun, h.secili, yuklendi = m.ozetler != null)
            h.invalidate()
        }
        // Ay değişince hücrelerin yeri, hafta ya da şerit sırası sayısı değişince yükseklik değişir.
        if (olcuDegisti || ayDegisti) requestLayout()
        invalidate()
    }

    /** Ay değişince ızgara yandan kayarak gelir (kısa; hareketi azalt ayarında yok). */
    fun kayarakGel(yon: Int) {
        if (!animasyonlarAcik()) return
        animate().cancel()
        translationX = yon * t.dpf(32f)
        alpha = 0.3f
        animate().translationX(0f).alpha(1f).setDuration(160).start()
    }

    private fun animasyonlarAcik(): Boolean = try {
        android.provider.Settings.Global.getFloat(context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f
    } catch (_: Exception) {
        true
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val g = MeasureSpec.getSize(widthMeasureSpec)
        val m = model
        sutun = (g - paddingLeft - paddingRight) / 7f
        baslikY = (yukseklik(gunAdiBoya) + t.dp(10)).toInt()
        val siralar = m?.seritler?.siraSayisi ?: 0
        satirY = sayiAlani + noktaAlani + siralar * seritAdimi + t.dp(4)
        val haftalar = m?.izgara?.haftaSayisi ?: 5
        val y = paddingTop + baslikY + (haftalar * satirY).toInt() + paddingBottom
        val cw = MeasureSpec.makeMeasureSpec(sutun.toInt(), MeasureSpec.EXACTLY)
        val ch = MeasureSpec.makeMeasureSpec(satirY.toInt(), MeasureSpec.EXACTLY)
        hucreler.forEach { if (it.visibility != View.GONE) it.measure(cw, ch) }
        setMeasuredDimension(g, y)
    }

    override fun onLayout(changed: Boolean, l: Int, top: Int, r: Int, b: Int) {
        val iz = model?.izgara ?: return
        for (h in hucreler) {
            val gun = h.tarih ?: continue
            val (hafta, s) = iz.yer(gun)
            val x = (paddingLeft + s * sutun).toInt()
            val y = (paddingTop + baslikY + hafta * satirY).toInt()
            h.layout(x, y, (paddingLeft + (s + 1) * sutun).toInt(), (y + satirY).toInt())
        }
    }

    override fun dispatchDraw(canvas: Canvas) {
        // Hafta günü başlıkları; sütuna sığmazsa tek harf.
        val adlar = DayOfWeek.entries.map { EkranMetinleri.kisaGunAdi(it) }
        val tekHarf = adlar.any { gunAdiBoya.measureText(it) > sutun - t.dp(4) }
        val yb = paddingTop + baslikY / 2f - (gunAdiBoya.ascent() + gunAdiBoya.descent()) / 2f
        for ((i, ad) in adlar.withIndex()) {
            canvas.drawText(if (tekHarf) ad.take(1) else ad, paddingLeft + (i + 0.5f) * sutun, yb, gunAdiBoya)
        }
        super.dispatchDraw(canvas)
        seritleriCiz(canvas)
    }

    private fun seritleriCiz(canvas: Canvas) {
        val m = model ?: return
        val r = t.dpf(5f)
        val ic = t.dpf(3f)
        for (p in m.seritler.parcalar) {
            val ust = paddingTop + baslikY + p.hafta * satirY + sayiAlani + noktaAlani + p.sira * seritAdimi
            val sol = paddingLeft + p.basSutun * sutun + if (p.basliyor) ic else 0f
            val sag = paddingLeft + (p.sonSutun + 1) * sutun - if (p.bitiyor) ic else 0f
            dikdortgen.set(sol, ust, sag, ust + seritYuksekligi)
            val rs = if (p.basliyor) r else 0f
            val re = if (p.bitiyor) r else 0f
            yol.reset()
            yol.addRoundRect(dikdortgen, floatArrayOf(rs, rs, re, re, re, re, rs, rs), Path.Direction.CW)
            val kapali = p.serit.durum != dev.eren.ajanda.cekirdek.KayitDurumu.ACIK
            val (zemin, yazi) = when {
                kapali -> t.yuzeyIkincil to t.soluk
                p.serit.taslak -> t.taslakZemin to t.taslakYazi
                else -> karistir(t.vurgu, t.zemin, 0.24f) to t.murekkep
            }
            dolgu.color = zemin
            canvas.drawPath(yol, dolgu)
            if (p.serit.taslak && !kapali) {
                cizgi.color = t.taslakYazi
                cizgi.strokeWidth = t.dpf(1f)
                canvas.drawPath(yol, cizgi)
            }
            // Başlık: parçanın genişliğine kısaltılır; çok darsa yazılmaz.
            val pay = t.dpf(5f)
            val genislik = dikdortgen.width() - 2 * pay
            if (genislik > t.dpf(14f)) {
                seritYaziBoya.color = yazi
                seritYaziBoya.isStrikeThruText = kapali
                val metin = TextUtils.ellipsize(p.serit.baslik, seritYaziBoya, genislik, TextUtils.TruncateAt.END)
                val yy = dikdortgen.centerY() - (seritYaziBoya.ascent() + seritYaziBoya.descent()) / 2f
                canvas.drawText(metin, 0, metin.length, dikdortgen.left + pay, yy, seritYaziBoya)
            }
        }
    }

    private fun karistir(a: Int, b: Int, oran: Float): Int {
        fun k(s: Int) = ((a shr s and 0xFF) * oran + (b shr s and 0xFF) * (1 - oran)).toInt() and 0xFF
        return (0xFF shl 24) or (k(16) shl 16) or (k(8) shl 8) or k(0)
    }

    // ---------------------------------------------------------------------------------------------
    // Yatay kaydırma: ay değişir. Dikey hareket listenin (ListView kendisi alır).
    // ---------------------------------------------------------------------------------------------

    private val egik = ViewConfiguration.get(c).scaledTouchSlop
    private var basX = 0f
    private var basY = 0f
    private var kayiyor = false

    override fun onInterceptTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                basX = e.x
                basY = e.y
                kayiyor = false
            }
            MotionEvent.ACTION_MOVE -> if (!kayiyor) {
                val dx = e.x - basX
                val dy = e.y - basY
                if (abs(dx) > egik && abs(dx) > 2 * abs(dy)) {
                    kayiyor = true
                    parent?.requestDisallowInterceptTouchEvent(true)
                }
            }
        }
        return kayiyor
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                basX = e.x
                basY = e.y
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = e.x - basX
                if (!kayiyor && abs(dx) > egik && abs(dx) > 2 * abs(e.y - basY)) {
                    kayiyor = true
                    parent?.requestDisallowInterceptTouchEvent(true)
                }
                if (kayiyor) translationX = dx / 3f
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val dx = e.x - basX
                val vardi = kayiyor
                kayiyor = false
                animate().translationX(0f).setDuration(120).start()
                if (vardi && e.actionMasked == MotionEvent.ACTION_UP && abs(dx) > t.dp(56)) kaydir(if (dx < 0) 1 else -1)
            }
        }
        return true
    }

    // ---------------------------------------------------------------------------------------------
    // Gün hücresi
    // ---------------------------------------------------------------------------------------------

    private inner class GunHucresi(c: Context) : View(c) {
        var tarih: LocalDate? = null
        var secili = false
        var bugun = false
        var gecmis = false
        var isaretler = Takvim.Isaretler(emptyList(), false)
        var gizli = 0

        init {
            isClickable = true
            isFocusable = true
            background = t.dokunulur(null, t.yuvarlak(0xFFFFFFFF.toInt(), 10f))
            setOnClickListener { tarih?.let(sec) }
            setOnLongClickListener { tarih?.let(ekle); tarih != null }
            accessibilityDelegate = object : AccessibilityDelegate() {
                override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
                    super.onInitializeAccessibilityNodeInfo(host, info)
                    info.addAction(AccessibilityNodeInfo.AccessibilityAction(AccessibilityNodeInfo.ACTION_CLICK, "Günü seç"))
                    info.addAction(AccessibilityNodeInfo.AccessibilityAction(AccessibilityNodeInfo.ACTION_LONG_CLICK, "Bu güne kayıt ekle"))
                    info.isSelected = secili
                }
            }
        }

        override fun onDraw(canvas: Canvas) {
            val gun = tarih ?: return
            val w = width.toFloat()
            val cx = w / 2f
            val sa = sayiAlani
            val cy = sa / 2f
            val yaricap = min(sa, w) / 2f - t.dpf(3f)
            if (secili) {
                dolgu.color = t.vurgu
                canvas.drawCircle(cx, cy, yaricap, dolgu)
            } else if (bugun) {
                cizgi.color = t.vurgu
                cizgi.strokeWidth = t.dpf(1.5f)
                canvas.drawCircle(cx, cy, yaricap, cizgi)
            }
            sayiBoya.color = when {
                secili -> t.vurguUzerine
                bugun -> t.vurgu
                gecmis -> t.soluk
                else -> t.murekkep
            }
            sayiBoya.typeface = if (secili || bugun) KALIN else DUZ
            val metin = gun.dayOfMonth.toString()
            canvas.drawText(metin, cx, cy - (sayiBoya.ascent() + sayiBoya.descent()) / 2f, sayiBoya)

            // Noktalar (tek günlük öğeler) ve sığmayan şerit/öğe için "+".
            val nr = t.dpf(2.6f)
            val ara = t.dpf(7f)
            val noktalar = isaretler.noktalar
            val ny = sa + noktaAlani / 2f - t.dpf(1f)
            var x = cx - (noktalar.size - 1) * ara / 2f
            for (n in noktalar) {
                if (n == Takvim.Nokta.TASLAK) {
                    cizgi.color = noktaRengi(n)
                    cizgi.strokeWidth = t.dpf(1.3f)
                    canvas.drawCircle(x, ny, nr, cizgi)
                } else {
                    dolgu.color = noktaRengi(n)
                    canvas.drawCircle(x, ny, nr, dolgu)
                }
                x += ara
            }
            if (isaretler.fazla || gizli > 0) {
                val ek = if (gizli > 0) "+$gizli" else "+"
                val bas = if (noktalar.isEmpty()) cx - kucukBoya.measureText(ek) / 2f else x - ara / 2f + t.dpf(1f)
                canvas.drawText(ek, bas, ny - (kucukBoya.ascent() + kucukBoya.descent()) / 2f, kucukBoya)
            }
        }
    }
}
