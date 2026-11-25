package dev.eren.ajanda.alarm

import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.HatirlatmaBildirimi
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.KurulacakAlarm

/**
 * AlarmManager'ın bu pakete önemli anlamı: alarm PendingIntent kimliğiyle (burada istek kodu) tutulur,
 * aynı kimlikle ikinci kurulum eskisinin yerine geçer, iptal yoksa bir şey yapmaz.
 */
class SahteAlarmSistemi(var kesinIzin: Boolean = true) : AlarmSistemi {
    data class Kurulum(val alarmNo: Long, val tetikMs: Long, val yol: AlarmPlanlayici.KurmaYolu)

    val kurulu = LinkedHashMap<Int, Kurulum>()
    val cagrilar = mutableListOf<String>()

    /** Kesin yollar `SecurityException` (izin denetimiyle kurma arasında izin geri alındı). */
    var kesinYolReddet = false

    /** Her kurulum bu istisnayı fırlatır (ör. 500 alarm sınırı). */
    var kurHatasi: RuntimeException? = null

    override fun kesinAlarmIzniVar() = kesinIzin

    override fun kur(istekKodu: Int, alarmNo: Long, tetikMs: Long, yol: AlarmPlanlayici.KurmaYolu) {
        cagrilar += "kur $istekKodu $yol"
        kurHatasi?.let { throw it }
        if (kesinYolReddet && yol != AlarmPlanlayici.KurmaYolu.GEVSEK) throw SecurityException("izin yok")
        kurulu[istekKodu] = Kurulum(alarmNo, tetikMs, yol)
    }

    override fun iptal(istekKodu: Int, alarmNo: Long) {
        cagrilar += "iptal $istekKodu"
        kurulu.remove(istekKodu)
    }
}

class SahteBildirici(var gosterebilir: Boolean = true) : Bildirici {
    val hatirlatmalar = mutableListOf<HatirlatmaBildirimi>()
    val ozetler = mutableListOf<List<HatirlatmaBildirimi>>()
    val ayrintisizlar = mutableListOf<Long>()
    var firlat: RuntimeException? = null

    override fun hatirlatmaGoster(b: HatirlatmaBildirimi): Boolean {
        firlat?.let { throw it }
        if (gosterebilir) hatirlatmalar += b
        return gosterebilir
    }

    override fun kacirilanGoster(satirlar: List<HatirlatmaBildirimi>): Boolean {
        firlat?.let { throw it }
        if (gosterebilir) ozetler += satirlar
        return gosterebilir
    }

    override fun ayrintisizGoster(alarmNo: Long): Boolean {
        if (gosterebilir) ayrintisizlar += alarmNo
        return gosterebilir
    }
}

const val GUN_MS = 86_400_000L

fun alarm(no: Long, tetik: Long = 1_000_000L + no, tur: KayitTuru = KayitTuru.GOREV) =
    KurulacakAlarm(alarmNo = no, kayitId = "k_$no", tetikMs = tetik, ornekTarihi = null, tur = tur)

fun bildirim(
    no: Long,
    baslik: String = "Başlık $no",
    tur: KayitTuru = KayitTuru.RANDEVU,
    zaman: AjandaZamani? = AjandaZamani.An("2026-11-25", "15:00", null, "Europe/Istanbul", null),
    tetik: Long = 1_000_000L + no,
    ornekTarihi: String? = null,
) = HatirlatmaBildirimi(
    alarmNo = no, kayitId = "k_$no", baslik = baslik, tur = tur, zaman = zaman,
    ornekTarihi = ornekTarihi, tetikMs = tetik,
)
