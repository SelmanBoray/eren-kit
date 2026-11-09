package dev.eren.deneme

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootAlici : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        Olcum.olay("boot_alici", i.action ?: "?")
        Olcum.arttir("boot_alici_sayaci")
        Baslatici.baslat(c, "boot:${i.action?.substringAfterLast('.')}")
    }
}
