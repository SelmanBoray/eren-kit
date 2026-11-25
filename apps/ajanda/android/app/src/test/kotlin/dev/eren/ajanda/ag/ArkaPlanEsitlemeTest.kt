package dev.eren.ajanda.ag

import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.Executor

/** `EsitlemeIsi`'nin bir çalışması: bağlan, eşitlen, kapat, alarmları yeniden kurdur, işi bitir. */
class ArkaPlanEsitlemeTest {
    private val zaman = SahteZamanlayici()
    private val cekirdek = SahteCekirdek()
    private val acici = SahteAcici()
    private val gunluk = ToplayanGunluk()
    private val ayar = AgAyarlari()
    private val denetci = BaglantiDenetcisi({ cekirdek }, acici, zaman, SahteAg(true), SahteIsler(), gunluk, ayar, { 0.5 })

    private val sira = mutableListOf<String>()
    private val alarmIsi = mutableListOf<Runnable>()

    /** Alarm işi ayrı bir yürütücüde: test onu ayrıca çalıştırır (ne ana ne ağ iş parçacığı). */
    private val yurutucu = Executor { alarmIsi += it }

    private val is_ = ArkaPlanEsitleme(
        oturumAc = { bitti -> denetci.arkaPlanOturumu(bitti) },
        alarmlariKur = { sira += "alarmlar" },
        yurutucu = yurutucu,
        bitir = { sira += "bitti $it" },
        gunluk = gunluk,
    )

    private fun alarmIsiniCalistir() {
        alarmIsi.toList().also { alarmIsi.clear() }.forEach { it.run() }
    }

    @Test
    fun esitleninceKapatirAlarmlariKurarIsiBitirir() {
        is_.baslat()
        zaman.bosalt()
        val h = acici.son
        h.ac()
        zaman.bosalt()
        cekirdek.durumYaz(BaglantiAsamasi.TELAFI, 0)
        zaman.bosalt()
        assertTrue(alarmIsi.isEmpty())
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0)
        zaman.bosalt()
        assertEquals("bağlantı kapandı", 1000, h.kapatmaKodu)
        assertEquals(listOf("kapandi 1"), cekirdek.kapanislar())
        alarmIsiniCalistir()
        assertEquals(listOf("alarmlar", "bitti ESITLENDI"), sira)
        assertFalse("bittikten sonra durdurma yeniden planlatmaz", is_.durdur())
    }

    @Test
    fun sureDolarsaDaKapatirAlarmlariKurar() {
        is_.baslat()
        zaman.bosalt()
        val h = acici.son
        h.ac()
        zaman.ilerle(ayar.arkaPlanSuresiMs)
        assertEquals(1000, h.kapatmaKodu)
        alarmIsiniCalistir()
        assertEquals(listOf("alarmlar", "bitti SURE_DOLDU"), sira)
    }

    @Test
    fun pcyeUlasilamasaDaAlarmlarKurulur() {
        is_.baslat()
        zaman.bosalt()
        repeat(ayar.arkaPlanDeneme) {
            acici.son.hata()
            zaman.ilerle(60_000)
        }
        alarmIsiniCalistir()
        assertEquals(listOf("alarmlar", "bitti ULASILAMADI"), sira)
        assertEquals(0, acici.acikSayisi())
    }

    @Test
    fun sistemDurdurursaBaglantiBirakilirIsBitirilmez() {
        is_.baslat()
        zaman.bosalt()
        val h = acici.son
        h.ac()
        zaman.bosalt()
        assertTrue("sürüyordu: yeniden planlansın", is_.durdur())
        zaman.bosalt()
        assertEquals(1000, h.kapatmaKodu)
        alarmIsiniCalistir()
        assertEquals(emptyList<String>(), sira)
        assertFalse(is_.durdur())
    }

    @Test
    fun alarmKurulumuAtarsaIsYineBiter() {
        val atan = ArkaPlanEsitleme(
            oturumAc = { bitti -> denetci.arkaPlanOturumu(bitti) },
            alarmlariKur = { throw IllegalStateException("kurulamadı") },
            yurutucu = yurutucu,
            bitir = { sira += "bitti $it" },
            gunluk = gunluk,
        )
        cekirdek.adres = null
        atan.baslat()
        zaman.bosalt()
        alarmIsiniCalistir()
        assertEquals(listOf("bitti ESLESME_YOK"), sira)
        assertTrue(gunluk.satirlar.any { it.startsWith("alarmlar yeniden kurulamadı") })
    }
}
