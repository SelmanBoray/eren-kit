package dev.eren.ajanda.aktarma

import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.Sekme
import dev.eren.ajanda.cekirdek.varsayilanHatirlatmalar
import dev.eren.ajanda.ekran.CekirdekYuzu
import dev.eren.ajanda.ekran.KayitFormu
import dev.eren.ajanda.ekran.TestAlarm
import dev.eren.ajanda.ekran.TestKimlik
import dev.eren.ajanda.kabuk.JavaZaman
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.time.LocalDate
import java.time.ZoneId

/**
 * Gerçek Rust çekirdeğine karşı (JVM, JNA): ekle -> dışa aktar -> kabı yaz -> oku -> boş çekirdeğe içe
 * aktar -> kayıt aynı; ikinci içe aktarma bir şey değiştirmez.
 */
class AktarmaGercekTest {
    @get:Rule
    val gecici = TemporaryFolder()

    private fun ac(ad: String): Cekirdek =
        Cekirdek.ac(gecici.newFile(ad).absolutePath, TestKimlik(), JavaZaman, TestAlarm())

    private val metinler = AktarmaMetinleri(ZoneId.of("Europe/Istanbul"))

    @Test
    fun ekleDisaAktarIceAktarKayitAyni() {
        val kap = ByteArrayOutputStream()
        val idler: List<String>
        val kaynakKayitlar = ac("kaynak.sqlite3").use { c ->
            val yuz = CekirdekYuzu.Gercek(c)
            val bugun = LocalDate.now()
            val f1 = KayitFormu.yeni(KayitTuru.RANDEVU, bugun.plusDays(2), "Europe/Istanbul", varsayilanHatirlatmalar())
                .copy(baslik = "Örnek randevu")
            val f2 = KayitFormu.yeni(KayitTuru.GOREV, null, "Europe/Istanbul", emptyList()).copy(baslik = "Örnek görev")
            idler = listOf(yuz.ekle(yuz.govdeyiHazirla(f1.govde())), yuz.ekle(yuz.govdeyiHazirla(f2.govde())))
            yuz.sil(idler[1])

            val a = AktarmaAkisi(yuz, metinler).disaAktar({ kap })
            assertTrue(a.metin, a is AktarmaAkisi.Adim.Bilgi)
            assertEquals("2 kayıt yedeğe yazıldı (1 silinmiş kayıt dahil).", a.metin)
            idler.map { yuz.kayit(it)!!.kayit }
        }

        // Kap biçime uyar: kökte belge, UTF-8.
        val okunan = YedekKabi.oku(ByteArrayInputStream(kap.toByteArray()), dev.eren.ajanda.cekirdek.aktarmaBicimi())
        assertTrue(okunan.belge.startsWith("{"))

        ac("hedef.sqlite3").use { c ->
            val yuz = CekirdekYuzu.Gercek(c)
            assertEquals(CalismaKipi.YEREL, yuz.kip())
            assertTrue(yuz.liste(Sekme.TARIHLI, true).isEmpty())
            // Üretimdeki yol: çekirdeğin bayt API'si.
            val akis = AktarmaAkisi(AktarmaCekirdegi.Gercek(c), metinler)

            val o = akis.dosyaOku { ByteArrayInputStream(kap.toByteArray()) }
            assertTrue(o.metin, o is AktarmaAkisi.Adim.Onay)
            assertTrue(o.metin, o.metin.contains("• 2 yeni kayıt eklenecek"))
            assertTrue(o.metin, o.metin.endsWith("Kayıtlar bu telefona yazılacak."))
            val s = akis.onayla()
            assertTrue(s.metin, s is AktarmaAkisi.Adim.Bilgi)
            assertEquals("2 yeni kayıt eklendi.", s.metin)

            // Kayıtlar alanlarıyla geldi (revizyon yerel sayaçtandır).
            for (k in kaynakKayitlar) {
                val g = yuz.kayit(k.kayitId)!!.kayit
                assertEquals(k.copy(revizyon = 0), g.copy(revizyon = 0))
            }
            assertEquals(listOf(idler[0]), yuz.liste(Sekme.TARIHLI, true).map { it.kayit.kayitId })
            assertEquals(listOf(idler[1]), yuz.liste(Sekme.SILINENLER, true).map { it.kayit.kayitId })

            // Aynı dosya yeniden: yapılacak bir şey yok, onay istenmez.
            val ikinci = akis.dosyaOku { ByteArrayInputStream(kap.toByteArray()) }
            assertTrue(ikinci.metin, ikinci is AktarmaAkisi.Adim.Bilgi)
            assertTrue(ikinci.metin, ikinci.metin.contains("• 2 kayıt telefondakiyle aynı"))
        }
    }
}
