package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.Gozlemci
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitGovdesi
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.Tekrar
import dev.eren.ajanda.cekirdek.TekrarSikligi
import dev.eren.ajanda.kabuk.JavaZaman
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.time.LocalDate
import java.time.ZonedDateTime

/**
 * Takvim ekranının mantığı gerçek Rust çekirdeğine karşı (JVM, JNA): tekrar eden kayıt ve dönem ızgarada
 * ve seçili günde görünür, örnek tamamlanınca yalnız o gün listeden çıkar (kapalılar gizliyken), geri
 * alınınca döner; "kapalıları göster" takvime de uygulanır.
 */
class TakvimGercekTest {
    @get:Rule
    val gecici = TemporaryFolder()

    private class Toplayan : Gozlemci {
        val gelen = mutableListOf<Degisim>()
        override fun degisti(degisim: Degisim) {
            synchronized(gelen) { gelen += degisim }
        }

        fun al(): Degisim = synchronized(gelen) { gelen.reduce { a, b -> Yenileme.birlestir(a, b) }.also { gelen.clear() } }
    }

    private fun satirlar(a: AnaDenetleyici) = a.model().ogeler.filterIsInstance<Liste.Oge.Satir>().map { it.satir }

    @Test
    fun tekrarOrnegiVeDonemTakvimde() {
        val bugun = LocalDate.now()
        val yol = gecici.newFile("takvim.sqlite3").absolutePath
        Cekirdek.ac(yol, TestKimlik(), JavaZaman, TestAlarm()).use { c ->
            val g = Toplayan()
            c.gozlemciEkle(g)
            val yuz = CekirdekYuzu.Gercek(c)
            val a = AnaDenetleyici(yuz) { ZonedDateTime.now() }
            val dilim = "Europe/Istanbul"
            val seri = yuz.ekle(
                yuz.govdeyiHazirla(
                    KayitGovdesi(
                        KayitTuru.GOREV, "Günlük örnek", null, AjandaZamani.Gun(bugun.minusDays(1).toString(), null, dilim, null),
                        emptyList(), Tekrar(TekrarSikligi.GUNLUK, 1, null, null, null),
                    ),
                ),
            )
            yuz.ekle(
                yuz.govdeyiHazirla(
                    KayitGovdesi(
                        KayitTuru.GOREV, "Dönem örneği", null, AjandaZamani.Donem(bugun.toString(), bugun.plusDays(2).toString(), dilim, null),
                        emptyList(), null,
                    ),
                ),
            )
            a.hepsiniOku()
            a.gorunumSec(Gorunum.TAKVIM)
            val tk = a.model().takvim!!
            val ozet = tk.ozetler!!.getValue(bugun)
            assertEquals(2, ozet.toplam)
            assertEquals(1, ozet.serit)
            assertEquals(listOf("Dönem örneği"), tk.seritler.parcalar.map { it.serit.baslik }.distinct())
            // Bugünün sayısı = günün liste uzunluğu (çekirdeğin sözü).
            val bugunku = satirlar(a)
            assertEquals(ozet.toplam, bugunku.size)
            val ornek = bugunku.single { it.kayitId == seri }
            assertEquals(bugun.toString(), ornek.ornekTarihi)
            assertTrue(Liste.Isaret.TEKRAR in ornek.isaretler)

            // Örneği tamamla: bugünden çıkar (kapalılar gizli), yarınki örnek açık kalır.
            g.al()
            val s = a.durumDegistir(seri, KayitDurumu.TAMAM, ornek.ornekTarihi)
            a.degisti(g.al())
            assertEquals(listOf("Dönem örneği"), satirlar(a).map { it.baslik })
            val yarin = yuz.takvimGunu(bugun.plusDays(1).toString(), false).single { it.gorunum.kayit.kayitId == seri }
            assertEquals(KayitDurumu.ACIK, yarin.durum)

            // Kapalılar dahilken tamamlanan örnek görünür, kapalı olarak.
            a.kapalilariGoster(true)
            val kapali = satirlar(a).single { it.kayitId == seri }
            assertTrue(kapali.kapali)
            assertEquals(1, a.model().takvim!!.ozetler!!.getValue(bugun).kapali)

            // Geri al: örnek yeniden açık.
            a.geriAl(s.geriAlma!!)
            a.degisti(g.al())
            assertTrue(!satirlar(a).single { it.kayitId == seri }.kapali)

            // Ay değiştirme ve dönüş gerçek sorguyla da tutarlı.
            a.takvimAyKaydir(1)
            assertEquals(bugun.withDayOfMonth(1).plusMonths(1), a.model().takvimDurumu!!.secili)
            a.takvimBugune()
            assertEquals(bugun, a.model().takvimDurumu!!.secili)
        }
    }
}
