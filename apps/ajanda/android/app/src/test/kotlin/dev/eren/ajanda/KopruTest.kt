package dev.eren.ajanda

import dev.eren.ajanda.cekirdek.AjandaKanalHatasi
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.AlarmKabugu
import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.EslesmeDurumu
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.time.Instant

/**
 * Üretilen UniFFI bağlamalarını masaüstü JVM'de gerçek Rust kitaplığına karşı çalıştırır
 * (Gradle `jna.library.path`'i target/debug'a ayarlar). Köprü yüzeyinin Kotlin'den derlendiğini,
 * tiplerin iki yönde geçtiğini ve motorun geri çağrılarla (kimlik, zaman, alarm, taşıma, gözlemci)
 * belirlenimci sonuç verdiğini gösterir. Davranışın ayrıntısı Rust testlerindedir (`tests/uctan_uca.rs`).
 */
class KopruTest {
    @get:Rule
    val gecici = TemporaryFolder()

    private class SahteKimlik : KimlikKabugu {
        var silinen = 0
        override fun acikAnahtar(): ByteArray = ByteArray(91)
        override fun imzala(veri: ByteArray): ByteArray = veri.reversedArray()
        override fun dogrula(acikAnahtar: ByteArray, veri: ByteArray, imza: ByteArray): Boolean = true
        override fun rastgele(uzunluk: UInt): ByteArray = ByteArray(uzunluk.toInt()) { it.toByte() }
        override fun anahtariSil() {
            silinen++
        }
    }

    private class SahteAlarm : AlarmKabugu {
        val kurulan = mutableListOf<KurulacakAlarm>()
        override fun kur(alarm: KurulacakAlarm) {
            kurulan += alarm
        }
        override fun iptal(alarmNo: Long) {}
        override fun kacirilanlariGoster(bildirim: KacirilanBildirimi) {}
    }

    private class SahteTasima : Tasima {
        val gonderilen = mutableListOf<String>()
        val kapatilan = mutableListOf<String>()
        override fun gonder(metin: String): Boolean {
            gonderilen += metin
            return true
        }
        override fun kapat(neden: String) {
            kapatilan += neden
        }
    }

    private class SayanGozlemci : Gozlemci {
        val gelen = mutableListOf<Degisim>()
        override fun degisti(degisim: Degisim) {
            gelen += degisim
        }
    }

    private val kimlik = SahteKimlik()
    private val alarm = SahteAlarm()

    private fun ac() = Cekirdek.ac(gecici.newFile("t.sqlite3").absolutePath, kimlik, JavaZaman, alarm)

    @Test
    fun acilirSemaKurulurTaniCalisir() {
        ac().use { c ->
            assertEquals(3L, c.semaSurumu())
            val rapor = KopruKaniti.calistir(c)
            assertTrue(rapor, rapor.endsWith(KopruKaniti.TAMAM))
            assertTrue(rapor, rapor.contains("eşleşme yok, bağlantı KOPUK, kuyrukta 0"))
            assertTrue(rapor, rapor.contains("tarihli 0, tarihsiz 0"))
        }
        assertTrue(cekirdekSurumu().isNotEmpty())
    }

    @Test
    fun modelTipleriIkiYondeGecerEkleyipOkur() {
        assertEquals(listOf<Hatirlatma>(Hatirlatma.Once(60)), varsayilanHatirlatmalar())
        val qr = eslestirmeQrCoz(KopruKaniti.ORNEK_QR)
        assertEquals("100.101.102.103", qr.host)
        try {
            eslestirmeQrCoz(KopruKaniti.ORNEK_QR.replace("100.101.", "100.200."))
            fail("Tailscale dışı adres kabul edildi")
        } catch (e: CekirdekHatasi.GecersizGirdi) {
            assertEquals("host", e.alan)
        }
        // Uzak gelecekte sabit an: sonuç bugünün tarihine bağlı değil.
        val zaman = AjandaZamani.An("2030-06-15", "15:00", 45, "Europe/Istanbul", "yarın 3'te")
        val govde = KayitGovdesi(
            tur = KayitTuru.RANDEVU,
            baslik = "Dişçi ☕️",
            aciklama = null,
            zaman = zaman,
            hatirlatmalar = varsayilanHatirlatmalar(),
            tekrar = null,
        )
        ac().use { c ->
            val id = c.ekle(govde, GirdiYolu.ELLE)
            assertTrue(id, id.startsWith("k_"))
            val g = c.kayit(id) ?: error("eklenen kayıt okunamadı")
            assertTrue(g.bekleyen)
            assertEquals(Triple("Dişçi ☕️", KayitTuru.RANDEVU, zaman), Triple(g.kayit.baslik, g.kayit.tur, g.kayit.zaman))
            assertEquals(listOf(id), c.liste(ListeSorgusu(Sekme.TARIHLI, false)).map { it.kayit.kayitId })
            assertEquals(1, c.baglantiDurumu().kuyrukta)

            // Alarm: 60 dk önce, Rust java.time'la (ZamanKabugu) çevirip AlarmKabugu'na kurdurdu (UTC+3).
            val kurulan = alarm.kurulan.single()
            assertEquals(Instant.parse("2030-06-15T11:00:00Z").toEpochMilli(), kurulan.tetikMs)
            assertEquals(id to KayitTuru.RANDEVU, kurulan.kayitId to kurulan.tur)
            // Erken çalan alarm tetik anında sayılır: bir kez bildirilir, ikincisi ve bilinmeyen numara susar.
            val b = c.alarmCaldi(kurulan.alarmNo) ?: error("alarm bildirimi bekleniyordu")
            assertEquals(Triple(id, "Dişçi ☕️", kurulan.tetikMs), Triple(b.kayitId, b.baslik, b.tetikMs))
            assertNull(c.alarmCaldi(kurulan.alarmNo))
            assertNull(c.alarmCaldi(9_999L))
        }
    }

    @Test
    fun motorYontemleriBosDepodaCalisir() {
        assertEquals("ab", metniTemizle("a​b"))
        ac().use { c ->
            assertEquals(EslesmeDurumu.Yok, c.eslesmeDurumu())
            assertNull(c.baglantiAdresi())
            val d = c.baglantiDurumu()
            assertEquals(BaglantiAsamasi.KOPUK to 0, d.asama to d.kuyrukta)
            assertTrue(c.liste(ListeSorgusu(Sekme.TARIHSIZ, true)).isEmpty())
            assertTrue(c.retListesi().isEmpty())
            c.alarmlariYenidenKur(YenidenKurmaNedeni.ACILIS)
            assertTrue(alarm.kurulan.isEmpty())
            assertNull(c.alarmCaldi(1L))
            try {
                c.baglantiAcildi(SahteTasima())
                fail("eşleşmesiz bağlantı kabul edildi")
            } catch (_: CekirdekHatasi.Eslesme) {
            }
        }
    }

    @Test
    fun eslestirmeAkisiGeriCagrilarlaIsler() {
        ac().use { c ->
            val gozlemci = SayanGozlemci()
            c.gozlemciEkle(gozlemci)
            val qr = eslestirmeQrCoz(KopruKaniti.ORNEK_QR)
            c.eslestirmeBaslat(qr)
            assertEquals(EslesmeDurumu.Bekliyor("100.101.102.103", 8765), c.eslesmeDurumu())
            assertEquals("ws://100.101.102.103:8765/ajanda", c.baglantiAdresi())
            assertTrue(gozlemci.gelen.any { it.eslesme })

            // Taşıma: açılınca pair_request yollanır (açık anahtar KimlikKabugu'ndan).
            val tasima = SahteTasima()
            val nesil = c.baglantiAcildi(tasima)
            val istek = tasima.gonderilen.single()
            assertTrue(istek, istek.contains("\"type\":\"pair_request\"") && istek.contains("\"kod\":\"ABCD2345\""))
            assertEquals(BaglantiAsamasi.ESLESTIRME, c.baglantiDurumu().asama)

            // PC reddi: durum Reddedildi, bağlantı kapattırılır, gözlemci bildirilir.
            gozlemci.gelen.clear()
            c.cerceveGeldi(nesil, """{"v":2,"type":"pair_result","ok":false,"code":"eslestirme_kodu_gecersiz"}""")
            assertEquals(EslesmeDurumu.Reddedildi(AjandaKanalHatasi.ESLESTIRME_KODU_GECERSIZ), c.eslesmeDurumu())
            assertEquals(1, tasima.kapatilan.size)
            assertTrue(gozlemci.gelen.any { it.eslesme })
            c.baglantiKapandi(nesil, null)
            assertNull(c.baglantiAdresi())

            // Yeniden başlatma bekliyor'a döner; kaldırma her şeyi ve cihaz anahtarını siler.
            c.eslestirmeBaslat(qr)
            assertEquals(EslesmeDurumu.Bekliyor("100.101.102.103", 8765), c.eslesmeDurumu())
            c.eslesmeyiKaldir()
            assertEquals(EslesmeDurumu.Yok, c.eslesmeDurumu())
            assertEquals(1, kimlik.silinen)
        }
    }

    @Test
    fun gozlemciNumaralariAyri() {
        ac().use { c ->
            val g = SayanGozlemci()
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
