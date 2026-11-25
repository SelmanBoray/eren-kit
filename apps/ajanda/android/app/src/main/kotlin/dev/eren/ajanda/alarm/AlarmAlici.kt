package dev.eren.ajanda.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * SAHİBİ: K3. Alarm çaldı: `goAsync`, arka plan iş parçacığında
 * `cekirdek.alarmCaldi(alarmNo)`; `null` değilse bildirimi göster. İSKELET.
 */
class AlarmAlici : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {}

    companion object {
        const val ALARM_NO = "alarm_no"
    }
}
