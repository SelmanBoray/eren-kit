package dev.eren.ajanda.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import dev.eren.ajanda.cekirdek.AlarmKabugu
import dev.eren.ajanda.cekirdek.KabukHatasi
import dev.eren.ajanda.cekirdek.KacirilanBildirimi
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.KurulacakAlarm

/**
 * SAHİBİ: K3. Alarm kurma STRATEJİSİNİN TEK YERİ; uygulamada AlarmManager'ı yalnız bu dosya çağırır.
 *
 * Strateji (ölçümden önce seçildi; `apps/ajanda-olcum` sonucu yalnız bu dosyayı değiştirir):
 * - Kesin alarm izni varsa RANDEVU -> `setAlarmClock`: Doze'dan muaf, cihazı uyandırır, sistemin
 *   en güvendiği alarm türü; gecikmesi en pahalı olan randevuya ayrıldı.
 * - Kesin alarm izni varsa GÖREV/NOT -> `setExactAndAllowWhileIdle`: Doze'da da çalar (uygulama başına
 *   kota yüzünden birkaç dakika gecikebilir), durum çubuğunda çalar saat simgesi göstermez.
 * - İzin yoksa (yalnız Android 12/12L'de kullanıcı SCHEDULE_EXACT_ALARM'ı kapatırsa; 13+'te
 *   USE_EXACT_ALARM kendiliğinden verilir) -> `setAndAllowWhileIdle` (gevşek: sistem tetikten sonra
 *   kalan sürenin bir kesrine dek geciktirebilir; her yeniden kurulum pencereyi daraltır). Hata
 *   sayılmaz; `HatirlatmaDurumu` bunu kullanıcıya KESIN_ALARM_IZNI_YOK olarak gösterir.
 * Reddedilen: hepsine `setAlarmClock` (her görev durum çubuğunda çalar saat simgesi ve saat
 * uygulamasının "sonraki alarm"ı olur, her biri cihazı tam uyandırır); pil muafiyetini kendiliğinden
 * istemek (ölçüm gerekliliğini göstermeden kullanıcıyı ayara itmek; manifestte
 * REQUEST_IGNORE_BATTERY_OPTIMIZATIONS da yok); ön plan servisi (kalıcı bildirim, gereksiz).
 * Ölçüme göre: çalar saat serisi kesin seriden belirgin iyiyse `CALAR_SAAT_TURLERI`'ne GOREV/NOT
 * eklenir; muafiyetle düzeliyorsa strateji aynı kalır, ekran PIL_OPTIMIZASYONU sorununu zorunlu
 * adım yapar; kesin alarm muafiyetsiz de ~%0 kaçırıyorsa değişiklik yok.
 *
 * Kimlik: istek kodu = `alarmNo.toInt()`, niyet = `AlarmAlici` + eylem + `ajanda-alarm:<no>` verisi.
 * Aynı numaranın ikinci `kur`u aynı PendingIntent'i verir; AlarmManager eskisini değiştirir (çift
 * alarm olmaz). `iptal` niyeti aynı işlevden kurar. Kurulamayan alarm `KabukHatasi` fırlatır:
 * çekirdek satırı siler ve sonraki yeniden kurulumda yeniden dener.
 * Çekirdeğin etki kilidi altında çağrılır: çekirdeğe geri girmez, kısa sürer.
 */
class AlarmPlanlayici internal constructor(
    private val sistem: AlarmSistemi,
    private val bildirici: Bildirici,
    private val sorunlar: SorunKaydi,
) : AlarmKabugu {

    /** `CekirdekErisimi`'nin kurduğu üretim örneği. */
    constructor(context: Context) : this(
        AndroidAlarmSistemi(context.applicationContext),
        Bildirimler(context.applicationContext),
        TercihSorunKaydi(context.applicationContext),
    )

    /** Android'deki karşılıkları `AndroidAlarmSistemi.kur`'da. */
    enum class KurmaYolu { CALAR_SAAT, KESIN, GEVSEK }

    override fun kur(alarm: KurulacakAlarm) {
        val kod = istekKodu(alarm.alarmNo)
        val yol = yolSec(alarm.tur, sistem.kesinAlarmIzniVar())
        val hata = dene { sistem.kur(kod, alarm.alarmNo, alarm.tetikMs, yol) } ?: return
        // İzin denetimiyle kurma arasında izin geri alındıysa (12/12L) gevşek yolla bir kez daha.
        val sonHata = if (hata is SecurityException && yol != KurmaYolu.GEVSEK) {
            dene { sistem.kur(kod, alarm.alarmNo, alarm.tetikMs, KurmaYolu.GEVSEK) } ?: return
        } else {
            hata
        }
        val neden = "alarm kurulamadı (${sonHata.javaClass.simpleName})"
        sorunlar.kurulamadi(neden)
        throw KabukHatasi.Basarisiz(neden)
    }

    override fun iptal(alarmNo: Long) {
        val hata = dene { sistem.iptal(istekKodu(alarmNo), alarmNo) } ?: return
        throw KabukHatasi.Basarisiz("alarm iptal edilemedi (${hata.javaClass.simpleName})")
    }

    override fun kacirilanlariGoster(bildirim: KacirilanBildirimi) {
        if (bildirim.satirlar.isEmpty()) return
        val gosterildi = try {
            bildirici.kacirilanGoster(bildirim.satirlar)
        } catch (e: Exception) {
            false
        }
        if (!gosterildi) sorunlar.gosterilemedi(bildirim.satirlar.map { it.kayitId })
    }

    private inline fun dene(blok: () -> Unit): Exception? =
        try {
            blok()
            null
        } catch (e: Exception) {
            e
        }

    companion object {
        /** `setAlarmClock` ile kurulan türler (ölçüm sonucu yalnız bunu değiştirmeli). */
        val CALAR_SAAT_TURLERI: Set<KayitTuru> = setOf(KayitTuru.RANDEVU)

        fun yolSec(tur: KayitTuru, kesinIzni: Boolean): KurmaYolu = when {
            !kesinIzni -> KurmaYolu.GEVSEK
            tur in CALAR_SAAT_TURLERI -> KurmaYolu.CALAR_SAAT
            else -> KurmaYolu.KESIN
        }

        /**
         * Çekirdeğin alarm numarası (SQLite AUTOINCREMENT, 1'den) PendingIntent istek kodudur.
         * Int'e sığmayan numara sessizce sarmalanıp başka alarmın kodunu almasın: hata.
         */
        fun istekKodu(alarmNo: Long): Int {
            if (alarmNo < 0 || alarmNo > Int.MAX_VALUE) {
                throw KabukHatasi.Basarisiz("alarm numarası istek koduna sığmıyor: $alarmNo")
            }
            return alarmNo.toInt()
        }
    }
}

/** AlarmManager'ın uygulamanın kullandığı yüzü (testte sahtesi). Karar vermez; `AlarmPlanlayici` verir. */
interface AlarmSistemi {
    fun kesinAlarmIzniVar(): Boolean

    /** Aynı `istekKodu` varsa değiştirir. İzin yoksa `SecurityException`, sınır aşılırsa `IllegalStateException`. */
    fun kur(istekKodu: Int, alarmNo: Long, tetikMs: Long, yol: AlarmPlanlayici.KurmaYolu)

    /** Yoksa hiçbir şey yapmaz. */
    fun iptal(istekKodu: Int, alarmNo: Long)
}

/** Üretim: AlarmManager + `AlarmAlici`'ya giden PendingIntent. Uygulamada AlarmManager'ı çağıran tek sınıf. */
internal class AndroidAlarmSistemi(private val context: Context) : AlarmSistemi {
    private val am: AlarmManager by lazy { context.getSystemService(AlarmManager::class.java) }

    override fun kesinAlarmIzniVar(): Boolean = kesinAlarmIzniVar(am)

    override fun kur(istekKodu: Int, alarmNo: Long, tetikMs: Long, yol: AlarmPlanlayici.KurmaYolu) {
        val pi = niyet(istekKodu, alarmNo, PendingIntent.FLAG_UPDATE_CURRENT)
            ?: throw IllegalStateException("PendingIntent kurulamadı")
        when (yol) {
            AlarmPlanlayici.KurmaYolu.CALAR_SAAT ->
                am.setAlarmClock(AlarmManager.AlarmClockInfo(tetikMs, Bildirimler.uygulamayiAcNiyeti(context, null)), pi)
            AlarmPlanlayici.KurmaYolu.KESIN -> am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, tetikMs, pi)
            AlarmPlanlayici.KurmaYolu.GEVSEK -> am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, tetikMs, pi)
        }
    }

    override fun iptal(istekKodu: Int, alarmNo: Long) {
        val pi = niyet(istekKodu, alarmNo, PendingIntent.FLAG_NO_CREATE) ?: return
        am.cancel(pi)
        pi.cancel()
    }

    /** `kur` ve `iptal` birebir aynı niyeti buradan kurar (Intent.filterEquals: eylem, veri, bileşen). */
    private fun niyet(istekKodu: Int, alarmNo: Long, bayrak: Int): PendingIntent? {
        val i = Intent(context, AlarmAlici::class.java)
            .setAction(AlarmAlici.EYLEM)
            .setData(Uri.fromParts(VERI_SEMASI, alarmNo.toString(), null))
            .putExtra(AlarmAlici.ALARM_NO, alarmNo)
        return PendingIntent.getBroadcast(context, istekKodu, i, bayrak or PendingIntent.FLAG_IMMUTABLE)
    }

    companion object {
        const val VERI_SEMASI = "ajanda-alarm"

        fun kesinAlarmIzniVar(am: AlarmManager): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
    }
}
