package dev.eren.ajanda.alarm

import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.GunBolumu
import dev.eren.ajanda.cekirdek.HatirlatmaBildirimi
import dev.eren.ajanda.cekirdek.KayitTuru
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/** Bildirimin Android'den bağımsız içeriği. `gizli*`: kilit ekranında görünen, kişisel veri taşımayan yüz. */
data class Icerik(
    val baslik: String,
    val metin: String?,
    val gizliBaslik: String,
    val gizliMetin: String,
)

/** Kaçırılan özetinin bir satırı; `alarmNo` birleştirmede tekilliği sağlar. */
data class OzetSatiri(val alarmNo: Long, val tetikMs: Long, val kayitId: String, val metin: String)

data class OzetIcerik(
    val icerik: Icerik,
    /** Bildirimde görünen satırlar (en çok `GORUNEN_SATIR`). */
    val gorunenSatirlar: List<String>,
    /** Görünmeyen satır sayısı ("+N daha"). */
    val tasan: Int,
    /** Özetteki bütün satırlar: bildirimle saklanır, sonraki özet bunlarla birleşir. */
    val satirlar: List<OzetSatiri>,
)

/** Bildirim metinleri (uygulama yalnız Türkçe; ortak metin kaynağı yok). */
object AlarmMetinleri {
    const val UYGULAMA = "Ajanda"
    const val KANAL_HATIRLATMA = "Hatırlatmalar"
    const val KANAL_HATIRLATMA_ACIKLAMA = "Randevu ve görev hatırlatmaları"
    const val KANAL_KACIRILAN = "Kaçırılan hatırlatmalar"
    const val KANAL_KACIRILAN_ACIKLAMA = "Telefon kapalıyken ya da alarm silinmişken geçen hatırlatmaların özeti"
    const val GIZLI_HATIRLATMA = "Bir hatırlatmanın zamanı geldi"
    const val AYRINTISIZ_BASLIK = "Hatırlatma"
    const val AYRINTISIZ_METIN = "Ayrıntı yüklenemedi; uygulamayı açın"

    fun tur(t: KayitTuru): String = when (t) {
        KayitTuru.GOREV -> "Görev"
        KayitTuru.RANDEVU -> "Randevu"
        KayitTuru.NOT -> "Not"
    }

    /** Gün bölümü (v2): saatsiz kaydın bildiriminde saat yerine ("bugün akşam"); saat uydurulmaz. */
    fun gunBolumu(b: GunBolumu): String = when (b) {
        GunBolumu.SABAH -> "sabah"
        GunBolumu.OGLE -> "öğle"
        GunBolumu.OGLEDEN_SONRA -> "öğleden sonra"
        GunBolumu.AKSAM -> "akşam"
        GunBolumu.GECE -> "gece"
    }

    fun kacirilanBaslik(sayi: Int): String = if (sayi == 1) "Kaçırılan hatırlatma" else "$sayi hatırlatma kaçırıldı"

    fun tasan(sayi: Int): String = "+$sayi daha"
}

object BildirimIcerigi {
    /** InboxStyle'ın güvenle gösterdiği satır sayısı. */
    const val GORUNEN_SATIR = 6

    private val TARIH = DateTimeFormatter.ofPattern("dd.MM.yyyy")

    /** `bugun`: cihazın bugünü; `cihazDilimi`: kaydın dilimi farklıysa metne eklenir. */
    fun hatirlatma(b: HatirlatmaBildirimi, bugun: LocalDate, cihazDilimi: String): Icerik {
        val zaman = zamanMetni(b.zaman, b.ornekTarihi, bugun, cihazDilimi)
        return Icerik(
            baslik = b.baslik,
            metin = listOfNotNull(AlarmMetinleri.tur(b.tur), zaman).joinToString(" · "),
            gizliBaslik = AlarmMetinleri.UYGULAMA,
            gizliMetin = AlarmMetinleri.GIZLI_HATIRLATMA,
        )
    }

    fun ayrintisiz(): Icerik = Icerik(
        baslik = AlarmMetinleri.AYRINTISIZ_BASLIK,
        metin = AlarmMetinleri.AYRINTISIZ_METIN,
        gizliBaslik = AlarmMetinleri.UYGULAMA,
        gizliMetin = AlarmMetinleri.GIZLI_HATIRLATMA,
    )

    fun ozetSatiri(b: HatirlatmaBildirimi, bugun: LocalDate, cihazDilimi: String): OzetSatiri {
        val zaman = zamanMetni(b.zaman, b.ornekTarihi, bugun, cihazDilimi)
        return OzetSatiri(b.alarmNo, b.tetikMs, b.kayitId, listOfNotNull(b.baslik, zaman).joinToString(" · "))
    }

    /** Ekranda duran özetin satırlarına yenileri eklenir (aynı alarm bir kez), tetik sırasıyla. */
    fun birlestir(onceki: List<OzetSatiri>, yeni: List<OzetSatiri>): List<OzetSatiri> {
        val sonuc = LinkedHashMap<Long, OzetSatiri>()
        for (s in onceki + yeni) sonuc.putIfAbsent(s.alarmNo, s)
        return sonuc.values.sortedWith(compareBy({ it.tetikMs }, { it.alarmNo }))
    }

    /** Bir ya da daha çok satır tek özet bildirim olur. */
    fun kacirilan(satirlar: List<OzetSatiri>): OzetIcerik {
        require(satirlar.isNotEmpty()) { "boş kaçırılan özeti" }
        val baslik = AlarmMetinleri.kacirilanBaslik(satirlar.size)
        val gorunen = satirlar.take(GORUNEN_SATIR).map { it.metin }
        return OzetIcerik(
            icerik = Icerik(
                baslik = baslik,
                metin = if (satirlar.size == 1) satirlar[0].metin else gorunen.joinToString(", "),
                gizliBaslik = AlarmMetinleri.UYGULAMA,
                gizliMetin = baslik,
            ),
            gorunenSatirlar = gorunen,
            tasan = satirlar.size - gorunen.size,
            satirlar = satirlar,
        )
    }

    /**
     * "bugün 15:00", "yarın", "bugün akşam" (saatsiz günde bölüm, saat uydurulmaz), "25.11.2026 – 27.11.2026"; tekrarda örneğin günü. Kaydın dilimi cihazınkinden
     * farklıysa saat o dilimdedir ve dilim adı eklenir. Zamansız kayıtta null.
     */
    fun zamanMetni(zaman: AjandaZamani?, ornekTarihi: String?, bugun: LocalDate, cihazDilimi: String): String? {
        fun dilimEki(d: String) = if (d == cihazDilimi) "" else " ($d)"
        return when (zaman) {
            null -> null
            is AjandaZamani.An -> "${gun(ornekTarihi ?: zaman.tarih, bugun)} ${zaman.saat}${dilimEki(zaman.saatDilimi)}"
            is AjandaZamani.Gun -> gun(ornekTarihi ?: zaman.tarih, bugun) + (zaman.gunBolumu?.let { " " + AlarmMetinleri.gunBolumu(it) } ?: "")
            is AjandaZamani.Donem -> "${gun(zaman.baslangic, bugun)} – ${gun(zaman.bitis, bugun)}"
            is AjandaZamani.Belirsiz -> zaman.ifade
        }
    }

    fun gun(tarih: String, bugun: LocalDate): String {
        val t = try {
            LocalDate.parse(tarih)
        } catch (e: Exception) {
            return tarih
        }
        return when (t) {
            bugun -> "bugün"
            bugun.plusDays(1) -> "yarın"
            bugun.minusDays(1) -> "dün"
            else -> t.format(TARIH)
        }
    }
}
