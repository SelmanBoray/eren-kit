package dev.eren.ajanda.ag

import dev.eren.ajanda.KopruKaniti
import dev.eren.ajanda.cekirdek.AjandaKanalHatasi
import dev.eren.ajanda.cekirdek.AlarmKabugu
import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.EslesmeDurumu
import dev.eren.ajanda.cekirdek.KacirilanBildirimi
import dev.eren.ajanda.cekirdek.KimlikKabugu
import dev.eren.ajanda.cekirdek.KurulacakAlarm
import dev.eren.ajanda.cekirdek.eslestirmeQrCoz
import dev.eren.ajanda.kabuk.JavaZaman
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Gerçek OkHttp istemcisi (`OkHttpSoketAcici`) + süreç içi sahte WebSocket sunucusu (yalnız 127.0.0.1).
 * Üretimdeki adres çekirdekten gelir; burada sahte açıcı onu doğrulayıp geri döngüdeki sunucuya çevirir.
 * Son test gerçek Rust çekirdeğiyle (JNA) eşleştirme isteğini ve PC reddini uçtan uca yürütür.
 */
class GercekSoketTest {
    @get:Rule
    val gecici = TemporaryFolder()

    private val zaman = YurutucuZamanlayici("test-gercek-ag")
    private val cekirdek = SahteCekirdek()
    private val gunluk = ToplayanGunluk()
    private val haberler = LinkedBlockingQueue<String>()

    private val olaylar = object : AjandaSoketi.Olaylar {
        override fun acildi(soket: AjandaSoketi) {
            haberler += "acildi"
        }

        override fun kapandi(soket: AjandaSoketi, tur: KapanisTuru) {
            haberler += "kapandi $tur"
        }
    }

    @After
    fun kapat() {
        zaman.kapat()
    }

    private fun yonlendir(sv: TestWsSunucusu, ayar: AgAyarlari, beklenen: String = TEST_ADRESI): SoketAcici {
        val gercek = OkHttpSoketAcici(ayar)
        return SoketAcici { adres, d ->
            assertEquals(beklenen, adres)
            gercek.ac(sv.adres, d)
        }
    }

    private fun ac(sv: TestWsSunucusu, ayar: AgAyarlari = AgAyarlari()): AjandaSoketi {
        val s = AjandaSoketi(cekirdek, zaman, gunluk, ayar, olaylar)
        s.bagla(yonlendir(sv, ayar), TEST_ADRESI)
        assertTrue("bağlanmadı", sv.baglantiyiBekle())
        assertEquals("acildi", haberler.poll(5, TimeUnit.SECONDS))
        return s
    }

    private fun haber(): String? = haberler.poll(5, TimeUnit.SECONDS)

    /** Geç gelebilecek ikinci kapanış olayları için kısa bekleme, sonra tek kapanış denetimi. */
    private fun tekKapanis() {
        Thread.sleep(300)
        assertEquals(listOf("kapandi 1"), cekirdek.kapanislar())
        assertNull("ikinci haber", haberler.poll())
    }

    @Test
    fun cercevelerSiraylaKarsiKapatinca() {
        TestWsSunucusu().use { sv ->
            cekirdek.acilistaGonder = listOf("a1", "a2")
            cekirdek.yanit = { listOf("y:$it") }
            ac(sv)
            assertEquals("a1", sv.gelen())
            assertEquals("a2", sv.gelen())
            repeat(50) { sv.gonder("s$it") }
            repeat(50) { assertEquals("y:s$it", sv.gelen()) }
            sv.kapat(1000)
            assertEquals("kapandi KARSI_KAPATTI", haber())
            assertEquals("kapanış yanıtlandı", 1000, sv.kapanisKodlari.poll(5, TimeUnit.SECONDS))
            tekKapanis()
            val gelen = synchronized(cekirdek) { cekirdek.olaylar.filter { it.startsWith("cerceve") } }
            assertEquals((0 until 50).map { "cerceve 1 s$it" }, gelen)
        }
    }

    @Test
    fun bizKapatinca() {
        TestWsSunucusu().use { sv ->
            val s = ac(sv)
            s.birak(KapanisTuru.BIZ_KAPATTIK)
            assertEquals("kapandi BIZ_KAPATTIK", haber())
            assertEquals(1000, sv.kapanisKodlari.poll(5, TimeUnit.SECONDS))
            tekKapanis()
        }
    }

    @Test
    fun cekirdekKapatinca() {
        TestWsSunucusu().use { sv ->
            ac(sv)
            sv.gonder("kapat")
            assertEquals("kapandi CEKIRDEK_KAPATTI", haber())
            assertEquals(1000, sv.kapanisKodlari.poll(5, TimeUnit.SECONDS))
            tekKapanis()
        }
    }

    @Test
    fun sunucuKesilinceHata() {
        TestWsSunucusu().use { sv ->
            ac(sv)
            sv.kes()
            assertEquals("kapandi HATA", haber())
            tekKapanis()
        }
    }

    @Test
    fun pingYanitsizKalincaZamanAsimi() {
        TestWsSunucusu().use { sv ->
            sv.pongVer = false
            ac(sv, AgAyarlari(pingAraligiMs = 200))
            assertEquals("kapandi ZAMAN_ASIMI", haber())
            tekKapanis()
        }
    }

    @Test
    fun cerceveSiniriGercekBoyutta() {
        TestWsSunucusu().use { sv ->
            ac(sv)
            val sinir = AgAyarlari.AZAMI_CERCEVE
            sv.gonder("x".repeat(sinir)) // tam sınırda: çekirdeğe gider
            sv.gonder("y".repeat(sinir + 1)) // aşan: gitmez, 1009
            assertEquals("kapandi CERCEVE_SINIRI", haber())
            assertEquals(1009, sv.kapanisKodlari.poll(5, TimeUnit.SECONDS))
            tekKapanis()
            val gelenler = synchronized(cekirdek) { cekirdek.olaylar.filter { it.startsWith("cerceve") } }
            assertEquals(1, gelenler.size)
            assertEquals("cerceve 1 ".length + sinir, gelenler.single().length)
        }
    }

    @Test
    fun ikiliCerceveKapatir() {
        TestWsSunucusu().use { sv ->
            ac(sv)
            sv.ikiliGonder()
            assertEquals("kapandi PROTOKOL", haber())
            assertEquals(1003, sv.kapanisKodlari.poll(5, TimeUnit.SECONDS))
            tekKapanis()
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Gerçek Rust çekirdeği + yönetici + gerçek OkHttp
    // ---------------------------------------------------------------------------------------------

    private class SahteKimlik : KimlikKabugu {
        override fun acikAnahtar(): ByteArray = ByteArray(91)
        override fun imzala(veri: ByteArray): ByteArray = veri.reversedArray()
        override fun dogrula(acikAnahtar: ByteArray, veri: ByteArray, imza: ByteArray): Boolean = true
        override fun rastgele(uzunluk: UInt): ByteArray = ByteArray(uzunluk.toInt()) { it.toByte() }
        override fun anahtariSil() {}
    }

    private class SahteAlarm : AlarmKabugu {
        override fun kur(alarm: KurulacakAlarm) {}
        override fun iptal(alarmNo: Long) {}
        override fun kacirilanlariGoster(bildirim: KacirilanBildirimi) {}
    }

    @Test
    fun gercekCekirdekleEslestirmeIstegiVePcReddi() {
        Cekirdek.ac(gecici.newFile("ag.sqlite3").absolutePath, SahteKimlik(), JavaZaman, SahteAlarm()).use { c ->
            c.eslestirmeBaslat(eslestirmeQrCoz(KopruKaniti.ORNEK_QR))
            val adres = c.baglantiAdresi() ?: error("adres yok")
            TestWsSunucusu().use { sv ->
                val ayar = AgAyarlari(ilkBeklemeMs = 100)
                val isler = SahteIsler()
                val d = BaglantiDenetcisi(
                    { CekirdekKanali(c) }, yonlendir(sv, ayar, beklenen = adres), zaman, SahteAg(true),
                    isler, gunluk, ayar, { 0.5 },
                )
                d.basla()
                assertTrue(sv.baglantiyiBekle())
                val istek = sv.gelen() ?: error("pair_request gelmedi")
                assertTrue(istek.contains("\"type\":\"pair_request\""))
                sv.gonder("""{"v":1,"type":"pair_result","ok":false,"code":"eslestirme_kodu_gecersiz"}""")
                // Çekirdek `Tasima.kapat` dedi: kapanış çerçevesi sunucuya ulaştı.
                assertEquals(1000, sv.kapanisKodlari.poll(5, TimeUnit.SECONDS))
                assertEquals(
                    EslesmeDurumu.Reddedildi(AjandaKanalHatasi.ESLESTIRME_KODU_GECERSIZ),
                    c.eslesmeDurumu(),
                )
                // Yeniden deneme (100 ms) adresi boş bulur: ikinci bağlantı yok, periyodik iş kaldırılır.
                Thread.sleep(1_000)
                assertEquals(BaglantiAsamasi.KOPUK, c.baglantiDurumu().asama)
                assertNull(c.baglantiAdresi())
                assertEquals(1, sv.baglantiSayisi.get())
                assertEquals(listOf("periyodik", "periyodik-iptal"), isler.cagrilar)
                assertTrue(gunluk.satirlar.none { it.contains("100.") || it.contains("pair") })
                d.birak()
            }
        }
    }
}
