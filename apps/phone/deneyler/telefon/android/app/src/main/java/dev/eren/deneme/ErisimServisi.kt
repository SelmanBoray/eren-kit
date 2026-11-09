package dev.eren.deneme

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent

class ErisimServisi : AccessibilityService() {
    override fun onServiceConnected() {
        Olcum.erisim = this
        Olcum.arttir("erisim_baglandi_sayaci")
        Olcum.olay("erisim_baglandi", "")
        Baslatici.baslat(this, "erisim")
    }

    override fun onAccessibilityEvent(e: AccessibilityEvent?) {
        // Yalnız paket adı: olay metni hiç işlenmez.
        if (e?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            Olcum.sonPencerePaketi = e.packageName?.toString()
        }
    }

    override fun onInterrupt() {}

    override fun onUnbind(i: Intent?): Boolean {
        Olcum.erisim = null
        Olcum.olay("erisim_koptu", "unbind")
        return false
    }

    override fun onDestroy() {
        Olcum.erisim = null
        super.onDestroy()
    }
}
