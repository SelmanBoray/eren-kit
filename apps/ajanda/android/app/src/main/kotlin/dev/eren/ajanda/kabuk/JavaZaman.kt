package dev.eren.ajanda.kabuk

import dev.eren.ajanda.cekirdek.KabukHatasi
import dev.eren.ajanda.cekirdek.YerelAn
import dev.eren.ajanda.cekirdek.ZamanKabugu
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale

/**
 * Çekirdeğin saati ve dilim çevirisi: sözleşmenin başvuru kuralı java.time'dır
 * (`ZonedDateTime.of`: yaz saati boşluğunda boşluk kadar ileri, çakışmada önceki ofset).
 * Saf ve kilitsiz; çekirdeğe geri çağrı yapmaz (motor kilidi altında çağrılır).
 */
object JavaZaman : ZamanKabugu {
    override fun simdiMs(): Long = System.currentTimeMillis()

    override fun cihazDilimi(): String = ZoneId.systemDefault().id

    override fun yereldenAna(tarih: String, saat: String, saatDilimi: String): Long =
        try {
            ZonedDateTime.of(LocalDate.parse(tarih), LocalTime.parse(saat), ZoneId.of(saatDilimi))
                .toInstant()
                .toEpochMilli()
        } catch (e: Exception) {
            throw KabukHatasi.Basarisiz("çevrilemedi ($saatDilimi): ${e.message}")
        }

    override fun andanYerele(anMs: Long, saatDilimi: String): YerelAn =
        try {
            val z = Instant.ofEpochMilli(anMs).atZone(ZoneId.of(saatDilimi))
            YerelAn(
                tarih = z.toLocalDate().toString(),
                saat = String.format(Locale.ROOT, "%02d:%02d", z.hour, z.minute),
                saatDilimi = saatDilimi,
            )
        } catch (e: Exception) {
            throw KabukHatasi.Basarisiz("çevrilemedi ($saatDilimi): ${e.message}")
        }
}
