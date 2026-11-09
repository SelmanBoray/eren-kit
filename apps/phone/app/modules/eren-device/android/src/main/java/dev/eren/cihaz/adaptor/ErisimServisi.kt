package dev.eren.cihaz.adaptor

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import java.util.concurrent.atomic.AtomicBoolean

/**
 * İnce bağlantı servisi: yalnız bağlanma/kopma haberini ve pencere değişiminin paket adını iletir.
 * Ekran okuma ve eylem `EkranOkuyucu` ile `Eylemci`'dedir.
 */
class ErisimServisi : AccessibilityService() {
    // Servis bağlı mı (çekirdekten bağımsız); kopuş bağlanma başına en çok bir kez bildirilir.
    private val baglandi = AtomicBoolean(false)

    override fun onServiceConnected() {
        super.onServiceConnected()
        // Çekirdekten bağımsız: erişim anahtarı servis durumunu buradan öğrenir.
        baglandi.set(true)
        ErisimAnahtari.servisBaglandi(this)
        val cekirdek = Adaptor.cekirdek
        if (cekirdek == null) {
            // Açılışta servis, çekirdeği kuran ön plan servisinden önce bağlanabilir.
            CihazServisi.baslat(this)
            // Çekirdek yoksa aktif izin de yoktur (izinler yalnız bellekte); yetki varsa
            // sonra yeniden açılabileceği için kapat. Yetki yoksa kullanıcı elle açmıştır, dokunma.
            if (ErisimAnahtari.yetkiVar(this)) ErisimAnahtari.kapat(this)
            return
        }
        cekirdek.erisilebilirlikBaglandi(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val cekirdek = Adaptor.cekirdek ?: return
        // Aktif izin yokken olay işlenmez: metne, kaynağa, düğüme bakılmaz.
        if (cekirdek.izinler.aktifler().isEmpty()) return
        (cekirdek.ekran as? EkranOkuyucu)?.pencereOlayi(event.packageName?.toString())
    }

    override fun onInterrupt() {
        // Kopuş değil: Android geri bildirimi kesmek ister, servis bağlı kalır.
    }

    override fun onUnbind(intent: Intent?): Boolean {
        kopuyuBildir()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        kopuyuBildir()
        super.onDestroy()
    }

    private fun kopuyuBildir() {
        if (baglandi.compareAndSet(true, false)) {
            ErisimAnahtari.servisKoptu()
            // Çekirdek geç bağlanmış olabilir (CihazServisi.canliServisiBagla); varsa haber ver.
            Adaptor.cekirdek?.erisilebilirlikKoptu()
        }
    }
}
