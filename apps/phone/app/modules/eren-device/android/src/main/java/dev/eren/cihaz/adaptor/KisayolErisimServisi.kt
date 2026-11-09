package dev.eren.cihaz.adaptor

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Ses tuşu kısayolunun tetiği: sistem bu servisi açınca `KisayolActivity`'yi başlatır ve hemen
 * `disableSelf()` ile kapanır; bir sonraki basışta sistem yeniden açar.
 *
 * Neden ayrı servis: erişilebilirlik kısayolu (ses aç + ses kıs basılı) hedef servisi açıp kapatır.
 * Asıl `ErisimServisi` ekranı okur/dokunur ve yalnız izin varken açık tutulur; kısayola bağlansaydı
 * tuşa basmak o yetkileri izinsiz açardı. Bu servisin hiçbir yeteneği yoktur (bkz. xml/kisayol_erisim):
 * olay işlemez, pencere içeriği okumaz, jest yapmaz. Settings yazımı da yapmaz (yalnız ErisimAnahtari).
 */
class KisayolErisimServisi : AccessibilityService() {
    // Aynı bağlanmada en çok bir tetik.
    private val tetiklendi = AtomicBoolean(false)

    override fun onServiceConnected() {
        super.onServiceConnected()
        if (!tetiklendi.compareAndSet(false, true)) return
        try {
            // Servis sistemce bağlıyken arka plandan etkinlik başlatma serbesttir; startActivity
            // eşzamanlı olduğundan denetim disableSelf'ten önce yapılır.
            startActivity(
                Intent(this, KisayolActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (e: RuntimeException) {
            Log.w(ETIKET, "Kısayol etkinliği açılamadı: ${e.javaClass.simpleName}")
        } finally {
            // Başlatma başarısız olsa da servis açık kalmamalı; yoksa sonraki basış onu kapatır.
            disableSelf()
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Bilerek boş: olay türü istenmez, hiçbir olay işlenmez.
    }

    override fun onInterrupt() {
        // Geri bildirim üretilmez; kesilecek bir şey yok.
    }

    private companion object {
        const val ETIKET = "ErenKisayol"
    }
}
