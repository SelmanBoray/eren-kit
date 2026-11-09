package dev.eren.deneme

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Base64
import android.view.Display
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executor

/**
 * GÜVENLİK SINIRI (kesin): tap, tap_node, type yalnız ön plan paketi bu APK iken çalışır,
 * aksi halde `denied` döner. Parola alanının içeriği hiçbir yanıta girmez.
 */
class Komutlar(private val c: Context, private val gonder: (JSONObject) -> Unit) {
    private val ht = HandlerThread("komut").apply { start() }
    private val h = Handler(ht.looper)
    private val calistirici = Executor { h.post(it) }
    private val dugumler = HashMap<Int, AccessibilityNodeInfo>()

    private val ekranHatalari = mapOf(
        AccessibilityService.ERROR_TAKE_SCREENSHOT_INTERNAL_ERROR to "INTERNAL_ERROR",
        AccessibilityService.ERROR_TAKE_SCREENSHOT_NO_ACCESSIBILITY_ACCESS to "NO_ACCESSIBILITY_ACCESS",
        AccessibilityService.ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT to "INTERVAL_TIME_SHORT",
        AccessibilityService.ERROR_TAKE_SCREENSHOT_INVALID_DISPLAY to "INVALID_DISPLAY",
        AccessibilityService.ERROR_TAKE_SCREENSHOT_INVALID_WINDOW to "INVALID_WINDOW",
        AccessibilityService.ERROR_TAKE_SCREENSHOT_SECURE_WINDOW to "SECURE_WINDOW",
    )

    fun kapat() {
        ht.quitSafely()
    }

    fun calistir(id: String, ad: String, args: JSONObject) {
        h.post {
            val t0 = SystemClock.elapsedRealtime()
            val bitir: (JSONObject) -> Unit = { r ->
                val durum = when {
                    r.optBoolean("denied") -> "denied"
                    r.optBoolean("ok") -> "ok"
                    else -> "hata"
                }
                Olcum.sonKomut = "$ad: $durum"
                gonder(
                    r.put("t", "res").put("id", id).put("name", ad)
                        .put("ms", SystemClock.elapsedRealtime() - t0)
                )
            }
            try {
                when (ad) {
                    "foreground" -> bitir(foreground())
                    "elements" -> bitir(elements(args))
                    "screenshot" -> ekranGoruntusu(args, bitir)
                    "tap" -> tap(args, bitir)
                    "tap_node" -> bitir(tapNode(args))
                    "type" -> bitir(yaz(args))
                    "status" -> bitir(tamam().put("payload", Durum.rapor(c)))
                    "wakelock" -> {
                        val f = Olcum.wakeLockAyarla
                        if (f == null) {
                            bitir(hata("servis_yok"))
                        } else {
                            f(args.optBoolean("on", true))
                            bitir(tamam().put("wake_lock", Olcum.wakeLockTutuluyor))
                        }
                    }
                    else -> bitir(hata("bilinmeyen_komut"))
                }
            } catch (e: Exception) {
                bitir(hata("istisna").put("detay", "${e.javaClass.simpleName}: ${e.message}"))
            }
        }
    }

    private fun tamam() = JSONObject().put("ok", true)
    private fun hata(k: String) = JSONObject().put("ok", false).put("err", k)
    private fun ret(neden: String, fg: String?) = JSONObject()
        .put("ok", false).put("denied", true).put("reason", neden).put("fg", fg ?: JSONObject.NULL)

    private fun erisim(): ErisimServisi? = Olcum.erisim
    private fun fg(s: AccessibilityService): String? = s.rootInActiveWindow?.packageName?.toString()

    /** null: izinli. Değilse ret yanıtı. */
    private fun kapi(s: AccessibilityService): JSONObject? {
        val p = fg(s)
        return if (p == Olcum.PAKET) null else ret("foreground_not_self", p)
    }

    /** Dokunulacak noktadaki en üst pencere de bu APK'nın olmalı (bildirim perdesi, klavye, kayan pencere). */
    private fun noktaKapisi(s: AccessibilityService, x: Int, y: Int): JSONObject? {
        val r = Rect()
        for (w in s.windows.sortedByDescending { it.layer }) {
            w.getBoundsInScreen(r)
            if (r.contains(x, y)) {
                val p = w.root?.packageName?.toString()
                return if (p == Olcum.PAKET) null else ret("window_not_self", p)
            }
        }
        return ret("no_window", fg(s))
    }

    private fun foreground(): JSONObject {
        val s = erisim() ?: return hata("a11y_yok")
        val pencereler = JSONArray()
        val r = Rect()
        s.windows.sortedByDescending { it.layer }.forEach { w ->
            w.getBoundsInScreen(r)
            pencereler.put(
                JSONObject()
                    .put("pkg", w.root?.packageName?.toString() ?: JSONObject.NULL)
                    .put("tur", w.type)
                    .put("aktif", w.isActive)
                    .put("odak", w.isFocused)
                    .put("sinir", JSONArray(listOf(r.left, r.top, r.right, r.bottom)))
            )
        }
        return tamam()
            .put("fg", fg(s) ?: JSONObject.NULL)
            .put("son_olay_paketi", Olcum.sonPencerePaketi ?: JSONObject.NULL)
            .put("pencereler", pencereler)
    }

    private fun rol(sinif: String?): String {
        val k = sinif?.substringAfterLast('.') ?: return "bilinmiyor"
        return when (k) {
            "Button", "ImageButton", "MaterialButton" -> "button"
            "EditText", "AppCompatEditText", "TextInputEditText" -> "textbox"
            "TextView", "AppCompatTextView" -> "text"
            "ImageView", "AppCompatImageView" -> "image"
            "CheckBox" -> "checkbox"
            "RadioButton" -> "radio"
            "Switch", "SwitchCompat" -> "switch"
            else -> k.lowercase()
        }
    }

    private fun elements(args: JSONObject): JSONObject {
        val s = erisim() ?: return hata("a11y_yok")
        val enCok = args.optInt("max", 400).coerceIn(1, 2000)
        val kokler = if (args.optBoolean("all", false)) {
            s.windows.sortedByDescending { it.layer }.mapNotNull { it.root }
        } else {
            listOfNotNull(s.rootInActiveWindow)
        }
        if (kokler.isEmpty()) return hata("kok_yok")
        dugumler.clear()
        val cikti = JSONArray()
        var gezilen = 0
        var kirpildi = false
        val r = Rect()
        val yigin = ArrayDeque<AccessibilityNodeInfo>()
        kokler.reversed().forEach { yigin.addLast(it) }
        while (yigin.isNotEmpty()) {
            if (gezilen >= 5000) {
                kirpildi = true
                break
            }
            val n = yigin.removeLast()
            gezilen++
            for (i in n.childCount - 1 downTo 0) n.getChild(i)?.let { yigin.addLast(it) }
            if (!n.isVisibleToUser) continue
            val metin = n.text
            val aciklama = n.contentDescription
            val secili = !metin.isNullOrEmpty() || !aciklama.isNullOrEmpty() ||
                n.isClickable || n.isEditable || n.isCheckable || n.isPassword
            if (!secili) continue
            if (cikti.length() >= enCok) {
                kirpildi = true
                break
            }
            val no = cikti.length() + 1
            dugumler[no] = n
            n.getBoundsInScreen(r)
            val metinVar = !metin.isNullOrEmpty() && !n.isShowingHintText
            val o = JSONObject()
                .put("id", no)
                .put("role", rol(n.className?.toString()))
                .put("isPassword", n.isPassword)
                .put("hasText", metinVar)
                .put("bounds", JSONArray(listOf(r.left, r.top, r.right, r.bottom)))
                .put("clickable", n.isClickable)
                .put("editable", n.isEditable)
                .put("focused", n.isFocused)
                .put("pkg", n.packageName?.toString() ?: JSONObject.NULL)
            n.viewIdResourceName?.let { o.put("rid", it) }
            n.hintText?.let { o.put("hint", it.toString().take(80)) }
            if (!n.isPassword) {
                if (metinVar) o.put("text", metin.toString().take(200))
                if (!aciklama.isNullOrEmpty()) o.put("desc", aciklama.toString().take(200))
            }
            cikti.put(o)
        }
        return tamam()
            .put("fg", fg(s) ?: JSONObject.NULL)
            .put("gezilen", gezilen)
            .put("sayi", cikti.length())
            .put("kirpildi", kirpildi)
            .put("dugumler", cikti)
    }

    private fun ekranGoruntusu(args: JSONObject, bitir: (JSONObject) -> Unit) {
        val s = erisim() ?: return bitir(hata("a11y_yok"))
        val enBuyuk = args.optInt("max", 720).coerceIn(160, 2400)
        val kalite = args.optInt("q", 60).coerceIn(10, 95)
        val t0 = SystemClock.elapsedRealtime()
        s.takeScreenshot(
            Display.DEFAULT_DISPLAY, calistirici,
            object : AccessibilityService.TakeScreenshotCallback {
                override fun onSuccess(r: AccessibilityService.ScreenshotResult) {
                    try {
                        val t1 = SystemClock.elapsedRealtime()
                        val hb = r.hardwareBuffer
                        val donanim = Bitmap.wrapHardwareBuffer(hb, r.colorSpace)
                        if (donanim == null) {
                            hb.close()
                            bitir(hata("bitmap_yok"))
                            return
                        }
                        val yazilim = donanim.copy(Bitmap.Config.ARGB_8888, false)
                        hb.close()
                        val w = yazilim.width
                        val he = yazilim.height
                        val olcek = enBuyuk.toFloat() / maxOf(w, he)
                        val kucuk = if (olcek < 1f) {
                            Bitmap.createScaledBitmap(yazilim, (w * olcek).toInt(), (he * olcek).toInt(), true)
                        } else {
                            yazilim
                        }
                        val parlaklik = parlaklikOlc(kucuk)
                        val cikis = ByteArrayOutputStream()
                        kucuk.compress(Bitmap.CompressFormat.JPEG, kalite, cikis)
                        val b64 = Base64.encodeToString(cikis.toByteArray(), Base64.NO_WRAP)
                        bitir(
                            tamam()
                                .put("capture_ms", t1 - t0)
                                .put("encode_ms", SystemClock.elapsedRealtime() - t1)
                                .put("w", kucuk.width).put("h", kucuk.height)
                                .put("kaynak_w", w).put("kaynak_h", he)
                                .put("bytes", cikis.size())
                                .put("ort_parlaklik", parlaklik.first)
                                .put("siyah_orani", parlaklik.second)
                                .put("fg", fg(s) ?: JSONObject.NULL)
                                .put("jpeg_b64", b64)
                        )
                    } catch (e: Exception) {
                        bitir(hata("kodlama").put("detay", "${e.javaClass.simpleName}: ${e.message}"))
                    }
                }

                override fun onFailure(kod: Int) {
                    bitir(
                        hata("screenshot_failed")
                            .put("code", kod)
                            .put("code_name", ekranHatalari[kod] ?: "BILINMIYOR")
                            .put("capture_ms", SystemClock.elapsedRealtime() - t0)
                            .put("fg", fg(s) ?: JSONObject.NULL)
                    )
                }
            }
        )
    }

    /** FLAG_SECURE hata yerine siyah alan da verebilir: 40x40 örnekle ölçülür. */
    private fun parlaklikOlc(b: Bitmap): Pair<Int, Double> {
        var toplam = 0L
        var siyah = 0
        val adim = 40
        for (i in 0 until adim) {
            for (j in 0 until adim) {
                val p = b.getPixel(i * b.width / adim, j * b.height / adim)
                val l = (((p shr 16) and 255) * 3 + ((p shr 8) and 255) * 6 + (p and 255)) / 10
                toplam += l
                if (l < 8) siyah++
            }
        }
        val adet = adim * adim
        return Pair((toplam / adet).toInt(), siyah.toDouble() / adet)
    }

    private fun tap(args: JSONObject, bitir: (JSONObject) -> Unit) {
        val s = erisim() ?: return bitir(hata("a11y_yok"))
        val x = args.getInt("x")
        val y = args.getInt("y")
        if (x < 0 || y < 0) return bitir(hata("gecersiz_nokta"))
        kapi(s)?.let { return bitir(it) }
        noktaKapisi(s, x, y)?.let { return bitir(it) }
        val yol = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        val hareket = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(yol, 0, 60))
            .build()
        val gitti = s.dispatchGesture(
            hareket,
            object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(g: GestureDescription?) {
                    bitir(tamam().put("fg", fg(s) ?: JSONObject.NULL))
                }

                override fun onCancelled(g: GestureDescription?) {
                    bitir(hata("gesture_iptal"))
                }
            },
            h
        )
        if (!gitti) bitir(hata("dispatch_false"))
    }

    private fun dugum(args: JSONObject, s: AccessibilityService): Pair<AccessibilityNodeInfo?, JSONObject?> {
        kapi(s)?.let { return Pair(null, it) }
        val n = dugumler[args.getInt("id")] ?: return Pair(null, hata("dugum_yok"))
        if (!n.refresh()) return Pair(null, hata("dugum_bayat"))
        if (n.packageName?.toString() != Olcum.PAKET) {
            return Pair(null, ret("node_not_self", n.packageName?.toString()))
        }
        return Pair(n, null)
    }

    private fun tapNode(args: JSONObject): JSONObject {
        val s = erisim() ?: return hata("a11y_yok")
        val (n, sorun) = dugum(args, s)
        sorun?.let { return it }
        var hedef = n
        while (hedef != null && !hedef.isClickable) hedef = hedef.parent
        if (hedef == null) return hata("tiklanabilir_degil")
        if (hedef.packageName?.toString() != Olcum.PAKET) {
            return ret("node_not_self", hedef.packageName?.toString())
        }
        val ok = hedef.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        return if (ok) tamam().put("fg", fg(s) ?: JSONObject.NULL) else hata("click_false")
    }

    private fun yaz(args: JSONObject): JSONObject {
        val s = erisim() ?: return hata("a11y_yok")
        val (n, sorun) = dugum(args, s)
        sorun?.let { return it }
        if (n == null || !n.isEditable) return hata("duzenlenemez")
        val b = Bundle().apply {
            putCharSequence(
                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                args.getString("text").take(2000)
            )
        }
        val ok = n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b)
        n.refresh()
        // Parola dahil hiçbir metin geri yankılanmaz, yalnız gelip gelmediği.
        val geldi = !n.text.isNullOrEmpty() && !n.isShowingHintText
        return (if (ok) tamam() else hata("set_text_false"))
            .put("isPassword", n.isPassword)
            .put("text_set", geldi)
    }
}
