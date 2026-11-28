package dev.eren.ajanda.ekran.sahne.bugun

import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitGovdesi
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.Tekrar
import dev.eren.ajanda.cekirdek.TekrarSikligi
import dev.eren.ajanda.ekran.sahne.veri.LevhaHali
import org.junit.Assert.assertFalse
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

    /**
     * G2: tekrarlı işte tek dokunuş bütün seriyi kapatmaz. Gerçek çekirdek, üretimdeki sıra (tek arka iş
     * parçacığı, eşzamansız gözlemci).
     * - Çapası yarın olan seri "Yarın"da çapa örneğiyle durur; tamamlanınca yalnız o örnek kapanır.
     * - Çapası geçmişte kalan seri "Tekrarlayanlar"da tamamlanamaz; zorlansa da çekirdek değişmez (hata tostu).
     * - Bugünün örneği takvimden tarihli gelir; tamamlanınca yalnız bugün kapanır.
     * - Ayrıntı (bildirimden açılan) geçmiş çapalı seriyi tamamlanamaz verir.
     */
    @Test
    fun tekrarliIsteTekDokunusSeriyiKapatmaz() {
        val yol = gecici.newFile("tekrar.sqlite3").absolutePath
        val arka = Executors.newSingleThreadExecutor()
        fun bekle() = repeat(3) { arka.submit {}.get(10, TimeUnit.SECONDS) }
        val bugun = LocalDate.now()
        val dilim = ZoneId.systemDefault().id
        Cekirdek.ac(yol, TestKimlik(), JavaZaman, TestAlarm()).use { c ->
            val yuz = CekirdekYuzu.Gercek(c)
            fun seri(ad: String, capa: LocalDate) = yuz.ekle(
                yuz.govdeyiHazirla(
                    KayitGovdesi(
                        KayitTuru.GOREV, ad, null, AjandaZamani.Gun(capa.toString(), null, dilim, null),
                        emptyList(), Tekrar(TekrarSikligi.GUNLUK, 1, null, null, null),
                    ),
                ),
            )
            val yarinki = seri("Yarınki ders", bugun.plusDays(1))
            val eski = seri("Eski ders", bugun.minusDays(3))
            val depo = BugunDeposu(
                yuz = { yuz },
                saat = { ZonedDateTime.now() },
                calistirici = arka,
                anaya = { it() },
                baglan = { g -> val no = c.gozlemciEkle(g); { c.gozlemciCikar(no) } },
            )
            depo.basla()
            bekle()
            fun durum(id: String) = yuz.kayit(id)!!.kayit
            fun satir(id: String) = depo.model.value.yaklasanlar.flatMap { it.kayitlar }.single { it.kayitId == id }

            // Yarın: çapa örneği hedeflenir; yalnız o örnek kapanır, seri açık kalır.
            val y = satir(yarinki)
            assertEquals(bugun.plusDays(1).toString(), y.ornekTarihi)
            assertTrue(y.tamamlanabilir)
            depo.tamamla(y)
            bekle()
            assertEquals(KayitDurumu.ACIK, durum(yarinki).durum)
            assertEquals(listOf(bugun.plusDays(1).toString()), durum(yarinki).ornekler.map { it.tarih })
            assertEquals(LevhaHali.BITTI, satir(yarinki).hal)
            assertTrue(depo.tost.value!!.mesaj.startsWith("Bitti: Yarınki ders ("))

            // Tekrarlayanlar: örnek belli değil, tamamlanamaz; zorlansa da seri kapanmaz.
            val t = satir(eski)
            assertEquals(null, t.ornekTarihi)
            assertFalse(t.tamamlanabilir)
            depo.tamamla(t)
            bekle()
            assertEquals(KayitDurumu.ACIK, durum(eski).durum)
            assertTrue(depo.tost.value!!.hata)

            // Bugünün örneği takvimden tarihli; yalnız bugün kapanır.
            val b = depo.model.value.acikler.single { it.kayitId == eski }
            assertEquals(bugun.toString(), b.ornekTarihi)
            depo.tamamla(b)
            bekle()
            assertEquals(KayitDurumu.ACIK, durum(eski).durum)
            assertEquals(listOf(bugun.toString()), durum(eski).ornekler.map { it.tarih })
            assertTrue(depo.model.value.bitenler.any { it.kayitId == eski })

            // Ayrıntı (bildirimden): geçmiş çapalı seri tamamlanamaz, yarın çapalı olan çapa örneğiyle gelir.
            var ozet: dev.eren.ajanda.ekran.sahne.veri.AyrintiOzeti? = null
            depo.kayitOku(eski) { ozet = it }
            bekle()
            assertFalse(ozet!!.kayit.tamamlanabilir)
            depo.kayitOku(yarinki) { ozet = it }
            bekle()
            assertEquals(bugun.plusDays(1).toString(), ozet!!.kayit.ornekTarihi)

            depo.dur()
            bekle()
        }
        arka.shutdown()
    }
}
