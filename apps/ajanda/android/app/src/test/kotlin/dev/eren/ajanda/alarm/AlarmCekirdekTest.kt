package dev.eren.ajanda.alarm

import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.KimlikKabugu
import dev.eren.ajanda.cekirdek.YenidenKurmaNedeni
import dev.eren.ajanda.kabuk.JavaZaman
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * K3'ün parçaları gerçek Rust çekirdeğine karşı (JVM, `jna.library.path`). Kayıt eklemek R4'ü beklediği
 * için burada yalnız boş depo yolları: yeniden kurulum hatasız biter, bilinmeyen alarm susar.
 */
class AlarmCekirdekTest {
    @get:Rule
    val gecici = TemporaryFolder()

    private object SahteKimlik : KimlikKabugu {
        override fun acikAnahtar(): ByteArray = ByteArray(91)
        override fun imzala(veri: ByteArray): ByteArray = veri
        override fun dogrula(acikAnahtar: ByteArray, veri: ByteArray, imza: ByteArray): Boolean = true
        override fun rastgele(uzunluk: UInt): ByteArray = ByteArray(uzunluk.toInt())
        override fun anahtariSil() {}
    }

    @Test
    fun bos_depoda_yeniden_kurma_ve_bilinmeyen_alarm() {
        val sistem = SahteAlarmSistemi()
        val bildirici = SahteBildirici()
        val sorunlar = BellekSorunKaydi()
        val c = Cekirdek.ac(
            gecici.newFile("a.sqlite3").absolutePath, SahteKimlik, JavaZaman,
            AlarmPlanlayici(sistem, bildirici, sorunlar),
        )
        for (neden in YenidenKurmaNedeni.entries) {
            assertTrue(AlarmYenidenKurma.isle(neden, { c.alarmlariYenidenKur(it) }, sorunlar, dilimiTazele = {}))
        }
        val sonuc = AlarmCalmaIsleyici({ c.alarmCaldi(it) }, bildirici, sorunlar).isle(999)
        assertEquals(AlarmCalmaIsleyici.Sonuc.SUSTU, sonuc)
        assertTrue(sistem.cagrilar.isEmpty())
        assertTrue(bildirici.hatirlatmalar.isEmpty() && bildirici.ozetler.isEmpty() && bildirici.ayrintisizlar.isEmpty())
        assertTrue(sorunlar.oku().bos)
        c.destroy()
    }
}
