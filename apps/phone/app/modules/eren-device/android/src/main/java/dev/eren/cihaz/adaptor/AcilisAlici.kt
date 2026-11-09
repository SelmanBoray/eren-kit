package dev.eren.cihaz.adaptor

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Açılışta ve güncellemeden sonra servisi React Native başlatmadan kaldırır. */
class AcilisAlici : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> CihazServisi.baslat(context)
        }
    }
}
