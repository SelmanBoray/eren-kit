package dev.eren.ajanda.ekran.sahne.bugun

import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.varsayilanHatirlatmalar
import dev.eren.ajanda.ekran.CekirdekYuzu
import dev.eren.ajanda.ekran.KayitFormu
import dev.eren.ajanda.ekran.TestAlarm
import dev.eren.ajanda.ekran.TestKimlik
import dev.eren.ajanda.ekran.sahne.veri.BugunDeposu
import dev.eren.ajanda.kabuk.JavaZaman
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Bugün durum tutucusu gerçek Rust çekirdeğine karşı (JVM, JNA), üretimdeki gibi: tek arka iş parçacığı,
 * çekirdeğe eklenen gözlemci. Çekirdeğe başka yoldan (ör. PC'den) gelen kayıt gözlemciyle ekrana düşer;
 * ekrandan tamamlama çekirdeğe yazılır ve geri alınır.
 */
class BugunGercekTest {
    @get:Rule
    val gecici = TemporaryFolder()

    @Test
    fun gercekCekirdektenOkurGozlemciyleYenilenirTamamlarGeriAlir() {
        val yol = gecici.newFile("bugun.sqlite3").absolutePath
        val arka = Executors.newSingleThreadExecutor()
        fun bekle() = arka.submit {}.get(10, TimeUnit.SECONDS)
        Cekirdek.ac(yol, TestKimlik(), JavaZaman, TestAlarm()).use { c ->
            val yuz = CekirdekYuzu.Gercek(c)
            val depo = BugunDeposu(
                yuz = { yuz },
                saat = { ZonedDateTime.now() },
                calistirici = arka,
                anaya = { it() },
                baglan = { g -> val no = c.gozlemciEkle(g); { c.gozlemciCikar(no) } },
            )
            depo.basla()
            bekle()
            val m0 = depo.model.value
            assertTrue(m0.yuklendi)
            assertTrue(m0.acikler.isEmpty())
            assertEquals("Bugünlük bu kadar.", m0.cumle)

            // Çekirdeğe doğrudan eklenen bugünkü görev: gözlemci bildirir, depo yeniden okur.
            val bugun = LocalDate.now()
            val f = KayitFormu.yeni(KayitTuru.GOREV, bugun, ZoneId.systemDefault().id, varsayilanHatirlatmalar()).copy(baslik = "Örnek görev")
            val id = c.ekle(yuz.govdeyiHazirla(f.govde()), dev.eren.ajanda.cekirdek.GirdiYolu.ELLE)
            bekle()
            bekle() // gözlemcinin attığı iş
            val k = depo.model.value.acikler.single()
            assertEquals(id, k.kayitId)
            assertEquals("Sırada örnek görev var.", depo.model.value.cumle)

            depo.tamamla(k)
            bekle()
            bekle()
            assertEquals(listOf(id), depo.model.value.bitenler.map { it.kayitId })
            assertEquals("Bitti: Örnek görev", depo.tost.value!!.mesaj)

            depo.geriAl(depo.tost.value!!.geriAlma!!)
            bekle()
            bekle()
            assertEquals(listOf(id), depo.model.value.acikler.map { it.kayitId })

            depo.dur()
            bekle()
        }
        arka.shutdown()
    }
}
