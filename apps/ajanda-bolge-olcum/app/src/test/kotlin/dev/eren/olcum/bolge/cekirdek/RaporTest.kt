package dev.eren.olcum.bolge.cekirdek

import dev.eren.olcum.bolge.cekirdek.Ornekler.DK
import dev.eren.olcum.bolge.cekirdek.Ornekler.SA
import dev.eren.olcum.bolge.cekirdek.Ornekler.T0
import dev.eren.olcum.bolge.cekirdek.Ornekler.algi
import dev.eren.olcum.bolge.cekirdek.Ornekler.baslangic
import dev.eren.olcum.bolge.cekirdek.Ornekler.elle
import dev.eren.olcum.bolge.cekirdek.Ornekler.o
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset

class RaporTest {
    private fun senaryo(): List<Olay> {
        val l = baslangic()
        for (i in 0 until 10) {
            val t = T0 + (i + 1) * 4 * SA
            l += elle(t, 1, Gecis.GIRIS)
            l += algi(t + 2 * DK, Kol.GMS, Gecis.GIRIS, 1, 10 + i)
            if (i % 2 == 0) l += algi(t + 7 * DK, Kol.CERCEVE, Gecis.GIRIS, 1, 10 + i)
        }
        l += o(Tur.KONUM, T0 + 50 * SA, mapOf("etkin" to "0"))
        l += o(Tur.GMSHATA, T0 + 50 * SA + 5_000, mapOf("kod" to "1000"))
        l += o(Tur.KONUM, T0 + 50 * SA + 3 * DK, mapOf("etkin" to "1"))
        l += Ornekler.kur(T0 + 50 * SA + 3 * DK + 2_000, Kol.GMS, neden = "konum_acildi:yayin")
        l += o(Tur.KONUMAL, T0 + 2 * DK, mapOf("amac" to "kayit", "kapali" to "1", "ilk" to "4200", "ilk50" to "9000", "enIyi" to "12", "secilen" to "gps", "n" to "30", "toplam" to "40000", "k_gps_n" to "20", "k_gps_ilk" to "6000", "k_gps_enIyi" to "12"))
        l += o(Tur.OLGU, T0, mapOf("android" to "16", "sdk" to "36"))
        return l
    }

    @Test
    fun raporBolumleriVeKarar() {
        val m = Rapor.metin(Analiz.analiz(senaryo(), T0 + 60 * SA), ZoneOffset.UTC)
        assertTrue(m.startsWith(Rapor.BASLIK))
        assertTrue(m.contains("▸ Play Hizmetleri geofence · giriş"))
        assertTrue(m.contains("gerçek varış 10: yakalanan 10, kaçan 0"))
        assertTrue(m.contains("KARAR: GEÇER"))
        // Çerçeve kolu 5/10 kaçırdı.
        assertTrue(m.contains("kaçırma %50,0 (5/10)"))
        assertTrue(m.contains("KARAR: GEÇMEZ"))
        assertTrue(m.contains("■ Konum kapatıp açma: 1"))
        assertTrue(m.contains("Play hata olayı geldi"))
        assertTrue(m.contains("+2,0 sn (konum_acildi:yayin)"))
        assertTrue(m.contains("kapalı alan: ilk konum 4,2 sn"))
        assertTrue(m.contains("bölge 1: yarıçap 150 m"))
        assertTrue(m.contains("sdk: 36"))
    }

    @Test
    fun disaAktarimYenidenAyristirilabilir() {
        val l = senaryo()
        val ham = GunlukBicimi.BASLIK + "\n" + l.joinToString("\n") { GunlukBicimi.yaz(it) } + "\n"
        val ozet = Rapor.metin(Analiz.analiz(l, T0 + 60 * SA), ZoneOffset.UTC)
        val d = Rapor.disaAktarim(ozet, ham, T0)
        val ay = GunlukBicimi.ayristirHepsi(d)
        assertEquals(l.size, ay.olaylar.size)
        assertEquals(0, ay.hataliSatir)
        assertEquals(l.map { it.tur }, ay.olaylar.map { it.tur })
    }

    @Test
    fun sureBicimi() {
        assertEquals("850 ms", Rapor.sure(850))
        assertEquals("4,2 sn", Rapor.sure(4_250))
        assertEquals("3 dk 5 sn", Rapor.sure(185_000))
        assertEquals("2 sa 1 dk", Rapor.sure(2 * 3_600_000L + 60_000))
        assertEquals("-", Rapor.sure(null))
        assertEquals("%5,0", Rapor.yuzde(0.05))
    }

    @Test
    fun bosGunluk() {
        val m = Rapor.metin(Analiz.analiz(emptyList(), T0), ZoneOffset.UTC)
        assertTrue(m.contains("Ölçüm henüz başlatılmadı."))
        assertTrue(m.contains("VERİ YETERSİZ"))
    }
}
