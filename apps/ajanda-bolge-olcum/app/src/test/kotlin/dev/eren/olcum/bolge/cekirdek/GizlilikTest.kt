package dev.eren.olcum.bolge.cekirdek

import dev.eren.olcum.bolge.cekirdek.Ornekler.DK
import dev.eren.olcum.bolge.cekirdek.Ornekler.SA
import dev.eren.olcum.bolge.cekirdek.Ornekler.T0
import dev.eren.olcum.bolge.cekirdek.Ornekler.o
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset

/**
 * Koordinat, bölge adı ve Wi-Fi ağ adı rapora / günlüğe / paylaşılan çıktıya sızmaz.
 * Olaylar uygulamanın kullandığı aynı saf alan kurucularıyla (Kayitlar, KonumAlmaIst) üretilir.
 * Bütün değerler uydurmadır.
 */
class GizlilikTest {
    private val tuz = "0123456789abcdef0123456789abcdef"
    private val ssid = "OrnekAg-5G"
    private val b1 = Bolge(1, "Gizli Kafe", 0.1234567, -25.7654321, 150, Kayitlar.wifiOzeti(ssid, tuz), T0)
    private val b2 = Bolge(2, "Uydurma Park", -45.1234567, -120.7654321, 100, null, T0)
    private val bolgeler = listOf(b1, b2)
    /** Bölge 1 merkezine ~40 m uzakta uydurma bir konum (açık denizde, gerçek bir yer değil). */
    private val yakin = Ornek(0.1238099, -25.7653210, 14.3f, 2_000L, "tetikleyen")

    private fun gunluk(): String {
        val ist = KonumAlmaIst()
        ist.ekle("fused", 2_100, 35.2f, 500)
        ist.ekle("gps", 8_400, 9.7f, 300)
        val olaylar = listOf(
            o(Tur.BASLA, T0),
            o(Tur.BOLGE, T0, Kayitlar.bolgeAlanlari(b1, 9.7f, "gps")),
            o(Tur.BOLGE, T0, Kayitlar.bolgeAlanlari(b2, 22.4f, "fused")),
            o(Tur.KONUMAL, T0, ist.alanlar("kayit", true, 30_000).apply { put("bolge", "1") }),
            o(Tur.KUR, T0, mapOf("kol" to Kol.GMS, "sonuc" to "ok", "neden" to "basla")),
            o(Tur.ELLE, T0 + SA, linkedMapOf("bolge" to "1", "gecis" to Gecis.GIRIS, "dk" to "0").apply { putAll(Kayitlar.konumAlanlari(b1, yakin)) }),
            o(Tur.ALGI, T0 + SA + DK, Kayitlar.algiAlanlari(Kol.GMS, Gecis.GIRIS, 1, 1, 5 * SA, b1, yakin)),
            o(Tur.ALGI, T0 + SA + 2 * DK, Kayitlar.algiAlanlari(Kol.CERCEVE, Gecis.GIRIS, 2, 2, 5 * SA, b2, yakin)),
            o(Tur.WIFI, T0 + SA + 3 * DK, Kayitlar.wifiAlanlari(ssid, tuz, bolgeler, tekrar = false)),
            o(Tur.WIFI, T0 + SA + 4 * DK, Kayitlar.wifiAlanlari("BaskaAg", tuz, bolgeler, tekrar = false)),
            // Bir hatanın sızdırmaya çalıştığı alanlar: süzgeç bunları atmalı.
            o(Tur.OLGU, T0 + 2 * SA, mapOf("enlem" to "0.1234567", "ssid" to ssid, "aciklama" to "yer 0.1234567,-25.7654321", "model" to "Ornek-1")),
        )
        return GunlukBicimi.BASLIK + "\n" + olaylar.joinToString("\n") { GunlukBicimi.yaz(it) } + "\n"
    }

    private fun disaAktarim(): String {
        val ham = gunluk()
        val ay = GunlukBicimi.ayristirHepsi(ham)
        val ozet = Rapor.metin(Analiz.analiz(ay.olaylar, T0 + 10 * SA, ay.hataliSatir), ZoneOffset.UTC)
        return Rapor.disaAktarim(ozet, ham, T0 + 10 * SA)
    }

    private fun yasaklar(): List<String> =
        bolgeler.flatMap { Gizlilik.kaliplar(it.enlem) + Gizlilik.kaliplar(it.boylam) } +
            Gizlilik.kaliplar(yakin.enlem) + Gizlilik.kaliplar(yakin.boylam) +
            listOf("Gizli Kafe", "Uydurma Park", ssid, "BaskaAg", tuz)

    @Test
    fun disaAktarimdaKoordinatAdVeAgAdiYok() {
        val m = disaAktarim()
        for (y in yasaklar()) assertFalse("sızıntı: $y", m.contains(y, ignoreCase = true))
        // Çıktı boş değil: uzaklık, doğruluk ve anonim etiket var.
        assertTrue(m.contains("uzaklik="))
        assertTrue(m.contains("dogruluk="))
        assertTrue(m.contains("bölge 1"))
        assertTrue(m.contains("eslesen=1"))
        // Cihazdaki gerçek değerlere karşı son tarama da temiz bulmalı.
        assertEquals(0, Gizlilik.temizle(m, bolgeler, listOf(ssid)).duzeltme)
    }

    @Test
    fun uzaklikDogruHesaplanir() {
        val a = Kayitlar.konumAlanlari(b1, yakin)
        val u = a["uzaklik"]!!.toInt()
        assertTrue("uzaklık $u", u in 30..50)
        assertEquals("1", a["icinde"])
        assertEquals("14", a["dogruluk"])
    }

    @Test
    fun gunlukSuzgeciYasakAnahtarVeKoordinatDegeriniAtar() {
        val s = GunlukBicimi.yaz(o(Tur.OLGU, T0, mapOf("enlem" to "1.5", "Boylam" to "2", "ad" to "x", "not" to "5.4321,67.8901", "uzaklik" to "38")))
        assertFalse(s.contains("enlem"))
        assertFalse(s.contains("Boylam"))
        assertFalse(s.contains("ad="))
        assertFalse(s.contains("5.4321"))
        assertTrue(s.contains("not=${Gizlilik.GIZLI},${Gizlilik.GIZLI}"))
        assertTrue(s.contains("uzaklik=38"))
    }

    @Test
    fun sonTaramaSizintiyiYakalarVeSiler() {
        val kirli = "rapor: Gizli Kafe merkez 0.12346, -25.76543; gizli kafe yine; Gizli Kafeterya ayrı kelime"
        val g = Gizlilik.temizle(kirli, bolgeler)
        assertEquals(4, g.duzeltme)
        assertFalse(g.metin.contains("0.1234"))
        assertFalse(g.metin.contains("25.7654"))
        assertFalse(g.metin.contains("Gizli Kafe ", ignoreCase = true))
        // Tam kelime olmayan eşleşmeye dokunmaz.
        assertTrue(g.metin.contains("Gizli Kafeterya"))
    }

    @Test
    fun nesneMetinleriGizliAlanGostermez() {
        assertFalse(b1.toString().contains("0.1234"))
        assertFalse(b1.toString().contains("Gizli"))
        assertFalse(yakin.toString().contains("0.1238"))
    }

    @Test
    fun ozelDepoDisaAktarimaGirmez() {
        // Özel depo koordinat içerir (beklenen); dışa aktarım bu metni hiç kullanmaz.
        val depo = BolgeDeposu.yaz(bolgeler)
        assertTrue(depo.contains("0.1234567"))
        assertFalse(disaAktarim().contains(BolgeDeposu.BASLIK))
    }
}
