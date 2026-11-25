package dev.eren.ajanda

import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.AlarmKabugu
import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.GirdiYolu
import dev.eren.ajanda.cekirdek.Gozlemci
import dev.eren.ajanda.cekirdek.Hatirlatma
import dev.eren.ajanda.cekirdek.KabukHatasi
import dev.eren.ajanda.cekirdek.KacirilanBildirimi
import dev.eren.ajanda.cekirdek.KayitGovdesi
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.KimlikKabugu
import dev.eren.ajanda.cekirdek.KurulacakAlarm
import dev.eren.ajanda.cekirdek.ListeSorgusu
import dev.eren.ajanda.cekirdek.Sekme
import dev.eren.ajanda.cekirdek.Tasima
import dev.eren.ajanda.cekirdek.YenidenKurmaNedeni
import dev.eren.ajanda.cekirdek.cekirdekSurumu
import dev.eren.ajanda.cekirdek.eslestirmeQrCoz
import dev.eren.ajanda.cekirdek.metniTemizle
import dev.eren.ajanda.cekirdek.varsayilanHatirlatmalar
import dev.eren.ajanda.kabuk.JavaZaman
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Üretilen UniFFI bağlamalarını masaüstü JVM'de gerçek Rust kitaplığına karşı çalıştırır
 * (Gradle `jna.library.path`'i target/debug'a ayarlar). Köprü yüzeyinin Kotlin'den derlendiğini,
 * tiplerin iki yönde geçtiğini ve ikinci dalganın parçalarının `Yazilmadi` döndüğünü gösterir.
 */
class KopruTest {
    @get:Rule
    val gecici = TemporaryFolder()

    private object SahteKimlik : KimlikKabugu {
        override fun acikAnahtar(): ByteArray = ByteArray(91)
        override fun imzala(veri: ByteArray): ByteArray = veri.reversedArray()
        override fun dogrula(acikAnahtar: ByteArray, veri: ByteArray, imza: ByteArray): Boolean = true
        override fun rastgele(uzunluk: UInt): ByteArray = ByteArray(uzunluk.toInt()) { it.toByte() }
        override fun anahtariSil() {}
    }

    private object SahteAlarm : AlarmKabugu {
        override fun kur(alarm: KurulacakAlarm) {}
        override fun iptal(alarmNo: Long) {}
        override fun kacirilanlariGoster(bildirim: KacirilanBildirimi) {}
    }

    private fun ac() = Cekirdek.ac(gecici.newFile("t.sqlite3").absolutePath, SahteKimlik, JavaZaman, SahteAlarm)

    private inline fun yazilmadiBekle(ne: String, blok: () -> Unit) {
        try {
            blok()
            fail("$ne: Yazilmadi bekleniyordu")
        } catch (e: CekirdekHatasi.Yazilmadi) {
            assertTrue(e.parca, e.parca.isNotEmpty())
        }
    }

    @Test
    fun acilirSemaKurulurTaniCalisir() {
        ac().use { c ->
            assertEquals(2L, c.semaSurumu())
            val rapor = KopruKaniti.calistir(c)
            assertTrue(rapor, rapor.endsWith(KopruKaniti.TAMAM))
            assertTrue(rapor, rapor.contains("İkinci dalga: bekliyor"))
        }
        assertTrue(cekirdekSurumu().isNotEmpty())
    }

    @Test
    fun modelTipleriIkiYondeGecer() {
        assertEquals(listOf<Hatirlatma>(Hatirlatma.Once(60)), varsayilanHatirlatmalar())
        val qr = eslestirmeQrCoz(KopruKaniti.ORNEK_QR)
        assertEquals("100.101.102.103", qr.host)
        try {
            eslestirmeQrCoz(KopruKaniti.ORNEK_QR.replace("100.101.", "100.200."))
            fail("Tailscale dışı adres kabul edildi")
        } catch (e: CekirdekHatasi.GecersizGirdi) {
            assertEquals("host", e.alan)
        }
        val govde = KayitGovdesi(
            tur = KayitTuru.RANDEVU,
            baslik = "Dişçi ☕️",
            aciklama = null,
            zaman = AjandaZamani.An("2026-11-26", "15:00", 45, "Europe/Istanbul", "yarın 3'te"),
            hatirlatmalar = varsayilanHatirlatmalar(),
            tekrar = null,
        )
        ac().use { c -> yazilmadiBekle("ekle") { c.ekle(govde, GirdiYolu.ELLE) } }
    }

    @Test
    fun ikinciDalgaParcalariYazilmadiDoner() {
        ac().use { c ->
            yazilmadiBekle("liste") { c.liste(ListeSorgusu(Sekme.TARIHLI, false)) }
            yazilmadiBekle("alarm") { c.alarmlariYenidenKur(YenidenKurmaNedeni.ACILIS) }
            yazilmadiBekle("alarmCaldi") { c.alarmCaldi(1L) }
            yazilmadiBekle("eslesme") { c.eslesmeDurumu() }
            yazilmadiBekle("metin") { metniTemizle("a") }
            val tasima = object : Tasima {
                override fun gonder(metin: String) = true
                override fun kapat(neden: String) {}
            }
            yazilmadiBekle("kanal") { c.baglantiAcildi(tasima) }
        }
    }

    @Test
    fun gozlemciNumaralariAyri() {
        ac().use { c ->
            val g = object : Gozlemci {
                override fun degisti(degisim: Degisim) {}
            }
            val a = c.gozlemciEkle(g)
            val b = c.gozlemciEkle(g)
            assertNotEquals(a, b)
            c.gozlemciCikar(a)
            c.gozlemciCikar(b)
        }
    }

    @Test
    fun javaZamanSozlesmeKurali() {
        // Vektörlerin "14:30 UTC+3" anı.
        assertEquals(1_795_606_200_000L, JavaZaman.yereldenAna("2026-11-25", "14:30", "Etc/GMT-3"))
        // Yaz saati boşluğu: 02:30 yok, boşluk kadar ileri (03:30 EDT = 07:30Z).
        assertEquals(1_772_955_000_000L, JavaZaman.yereldenAna("2026-03-08", "02:30", "America/New_York"))
        // Çakışma: önceki ofset (01:30 EDT = 05:30Z).
        assertEquals(1_793_511_000_000L, JavaZaman.yereldenAna("2026-11-01", "01:30", "America/New_York"))
        val y = JavaZaman.andanYerele(1_795_606_200_000L, "Europe/Istanbul")
        assertEquals("2026-11-25" to "14:30", y.tarih to y.saat)
        try {
            JavaZaman.yereldenAna("2026-11-25", "14:30", "Yok/Boyle")
            fail("bilinmeyen dilim kabul edildi")
        } catch (e: KabukHatasi.Basarisiz) {
            assertTrue(e.mesaj, e.mesaj.contains("Yok/Boyle"))
        }
    }
}
