package dev.eren.cihaz.adaptor

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** Hızlı ayarlar kutucuğu: dokununca KisayolActivity (sesle söyle) açılır. */
class KisayolKutucugu : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        val kutucuk = qsTile ?: return
        kutucuk.state = Tile.STATE_ACTIVE
        kutucuk.label = asistanAdi()
        if (Build.VERSION.SDK_INT >= 29) {
            kutucuk.subtitle = "Söyle"
        }
        kutucuk.updateTile()
    }

    override fun onClick() {
        super.onClick()
        if (isLocked) {
            unlockAndRun { ac() }
        } else {
            ac()
        }
    }

    private fun ac() {
        val niyet = Intent(this, KisayolActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) {
            val bekleyen = PendingIntent.getActivity(
                this,
                0,
                niyet,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            startActivityAndCollapse(bekleyen)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(niyet)
        }
    }
}
