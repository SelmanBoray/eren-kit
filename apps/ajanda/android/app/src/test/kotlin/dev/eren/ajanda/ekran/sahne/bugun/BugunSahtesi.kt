package dev.eren.ajanda.ekran.sahne.bugun

import dev.eren.ajanda.cekirdek.AjandaKaydi
import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.EslesmeDurumu
import dev.eren.ajanda.cekirdek.Gozlemci
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.TakvimOgesi
import dev.eren.ajanda.ekran.CekirdekYuzu
import dev.eren.ajanda.ekran.Liste
import dev.eren.ajanda.ekran.SahteYuz
import dev.eren.ajanda.ekran.gor
import dev.eren.ajanda.ekran.sahne.veri.BugunDeposu
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.Executor

/** Testlerin sabit anı: 12 Mart 2026 Perşembe, 14:20, İstanbul. */
val DILIM: ZoneId = ZoneId.of("Europe/Istanbul")
val SIMDI: ZonedDateTime = ZonedDateTime.of(2026, 3, 12, 14, 20, 0, 0, DILIM)
val GUN: LocalDate = SIMDI.toLocalDate()
fun gunSonra(n: Long): String = GUN.plusDays(n).toString()

/**
 * Bugün ekranı için sahte çekirdek: [SahteYuz]'ün listelerine ek olarak `takvimGunu`'nü kayıtlardan kurar
 * (tekrarsız; günü kapsayan, silinmemiş, kapalılar yalnız istenirse) ve her değişiklikte [gozlemci]'ye
 * gerçek çekirdek gibi `Degisim` bildirir.
 */
class BugunCekirdegi(val sahte: SahteYuz = SahteYuz()) : CekirdekYuzu by sahte {
    var gozlemci: Gozlemci? = null
    var eslesme: EslesmeDurumu = EslesmeDurumu.Eslesti("d_test", "100.64.0.1", 8765)
    var asama: BaglantiAsamasi = BaglantiAsamasi.CANLI
    var kuyrukta = 0
    /** Tekrar örneği gibi: kayıt kimliği -> örnek tarihi (takvimGunu'nde öğeye yazılır). */
    val ornekTarihleri = mutableMapOf<String, String>()
    val cagrilar get() = sahte.cagrilar

    fun ekle(vararg k: AjandaKaydi) = k.forEach { sahte.kayitlar[it.kayitId] = it }

    private fun bildir(id: String) {
        gozlemci?.degisti(Degisim(listOf(id), false, false, false, false, emptyList()))
    }

    override fun eslesmeDurumu(): EslesmeDurumu = eslesme
    override fun baglantiAdresi(): String? = if (eslesme is EslesmeDurumu.Yok) null else "ws://100.64.0.1:8765"
    override fun baglantiDurumu(): BaglantiDurumu = BaglantiDurumu(asama, kuyrukta, sahte.ret.size, SIMDI.toInstant().toEpochMilli() - 120_000, null, null)

    override fun takvimGunu(tarih: String, kapalilarDahil: Boolean): List<TakvimOgesi> {
        sahte.cagrilar += "takvimGunu:$tarih"
        val t = LocalDate.parse(tarih)
        return sahte.kayitlar.values.mapNotNull { k ->
            if (k.silindi) return@mapNotNull null
            if (!kapalilarDahil && k.durum != KayitDurumu.ACIK) return@mapNotNull null
            val konum = Liste.konum(k.zaman, DILIM) ?: return@mapNotNull null
            if (t < konum.ilkGun || t > konum.sonGun) return@mapNotNull null
            TakvimOgesi(
                gorunum = gor(k),
                ornekTarihi = ornekTarihleri[k.kayitId],
                durum = k.durum,
                ilkGun = konum.ilkGun.toString(),
                sonGun = konum.sonGun.toString(),
                saat = konum.saat?.let { String.format(java.util.Locale.ROOT, "%02d:%02d", it.hour, it.minute) },
                bitisSaati = null,
            )
        }
    }

    override fun durumDegistir(kayitId: String, durum: KayitDurumu, ornekTarihi: String?) {
        sahte.durumDegistir(kayitId, durum, ornekTarihi)
        bildir(kayitId)
    }

    override fun onayla(kayitId: String) {
        sahte.onayla(kayitId)
        bildir(kayitId)
    }

    override fun sil(kayitId: String) {
        sahte.sil(kayitId)
        bildir(kayitId)
    }

    override fun geriYukle(kayitId: String) {
        sahte.geriYukle(kayitId)
        bildir(kayitId)
    }
}

/** Hemen (çağıran iş parçacığında) çalıştıran yürütücü: testte arka iş parçacığı yok. */
object Hemen : Executor {
    override fun execute(command: Runnable) = command.run()
}

/** Sahte çekirdekle, hemen çalışan bir depo; gözlemci bağlı. */
fun sahteDepo(c: BugunCekirdegi, saat: () -> ZonedDateTime = { SIMDI }): BugunDeposu = BugunDeposu(
    yuz = { c },
    saat = saat,
    calistirici = Hemen,
    anaya = { it() },
    baglan = { g -> c.gozlemci = g; { c.gozlemci = null } },
)
