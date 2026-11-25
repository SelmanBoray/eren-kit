package dev.eren.ajanda.alarm

import android.content.Context
import dev.eren.ajanda.cekirdek.AlarmKabugu
import dev.eren.ajanda.cekirdek.KabukHatasi
import dev.eren.ajanda.cekirdek.KacirilanBildirimi
import dev.eren.ajanda.cekirdek.KurulacakAlarm

/**
 * SAHİBİ: K3 (alarm, bildirim, alıcılar). Alarm kurma STRATEJİSİNİN TEK YERİ: hangi AlarmManager
 * çağrısı (setAlarmClock / setExactAndAllowWhileIdle / izin yoksa setAndAllowWhileIdle), izin
 * denetimi. `apps/ajanda-olcum` sonucu stratejiyi değiştirirse yalnız bu sınıf değişir.
 * PendingIntent: `AlarmAlici`, istek kodu `alarm.alarmNo.toInt()`, ekstra `alarm_no`.
 * İSKELET: her yöntem "yazılmadı" fırlatır.
 */
class AlarmPlanlayici(private val context: Context) : AlarmKabugu {
    private fun yazilmadi(): Nothing = throw KabukHatasi.Basarisiz("yazılmadı: alarm.AlarmPlanlayici (K3)")

    override fun kur(alarm: KurulacakAlarm) = yazilmadi()

    override fun iptal(alarmNo: Long) = yazilmadi()

    override fun kacirilanlariGoster(bildirim: KacirilanBildirimi) = yazilmadi()
}
