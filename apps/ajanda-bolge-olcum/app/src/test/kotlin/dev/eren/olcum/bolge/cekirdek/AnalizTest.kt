package dev.eren.olcum.bolge.cekirdek

import dev.eren.olcum.bolge.cekirdek.Ornekler.DK
import dev.eren.olcum.bolge.cekirdek.Ornekler.SA
import dev.eren.olcum.bolge.cekirdek.Ornekler.T0
import dev.eren.olcum.bolge.cekirdek.Ornekler.algi
import dev.eren.olcum.bolge.cekirdek.Ornekler.baslangic
import dev.eren.olcum.bolge.cekirdek.Ornekler.elle
import dev.eren.olcum.bolge.cekirdek.Ornekler.etiket
import dev.eren.olcum.bolge.cekirdek.Ornekler.kur
import dev.eren.olcum.bolge.cekirdek.Ornekler.o
import dev.eren.olcum.bolge.cekirdek.Ornekler.satir
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AnalizTest {
    private fun analiz(l: List<Olay>, simdi: Long = T0 + 48 * SA) = Analiz.analiz(l, simdi)

    @Test
    fun elleVarisaGoreKolBasinaGecikme() {
        val l = baslangic()
        val v = T0 + SA
        l += elle(v, 1, Gecis.GIRIS)
        l += algi(v + 90_000, Kol.GMS, Gecis.GIRIS, 1, 1)
        l += algi(v + 4 * DK, Kol.CERCEVE, Gecis.GIRIS, 1, 1)
        l += algi(v + 3 * DK + 30_000, Kol.GMS, Gecis.BEKLE, 1, 1)
        val oz = analiz(l)
        assertEquals(1, satir(oz, Kol.GMS, Gecis.GIRIS).eslesen)
        assertEquals(90_000L, satir(oz, Kol.GMS, Gecis.GIRIS).gecikme.ortanca)
        assertEquals(240_000L, satir(oz, Kol.CERCEVE, Gecis.GIRIS).gecikme.ortanca)
        assertEquals(210_000L, satir(oz, Kol.GMS, Gecis.BEKLE).gecikme.ortanca)
        // Bölge 1'e Wi-Fi eşli değil: Wi-Fi kolu bu varışta sayılmaz (kaçırma değil).
        assertEquals(0, satir(oz, Kol.WIFI, Gecis.GIRIS).kacirmaPayda)
        assertEquals(1, oz.gercekGiris)
    }

    @Test
    fun kacanVeNedeni() {
        val l = baslangic()
        // Bölge 2 (Wi-Fi eşli): yalnız gms yakaladı.
        l += elle(T0 + SA, 2, Gecis.GIRIS)
        l += algi(T0 + SA + DK, Kol.GMS, Gecis.GIRIS, 2, 1)
        // Yeniden başlatma: 2. açılış T0+2sa, kollar kurulmadı.
        Ornekler.acilislar[2] = T0 + 2 * SA
        l += o(Tur.ACILIS, T0 + 2 * SA + 30_000, boot = 2)
        l += elle(T0 + 3 * SA, 1, Gecis.GIRIS, boot = 2)
        // Konum kapalıyken varış: oranın dışında tutulur.
        l += o(Tur.KONUM, T0 + 4 * SA, mapOf("etkin" to "0"), boot = 2)
        l += elle(T0 + 4 * SA + 30 * DK, 1, Gecis.GIRIS, boot = 2)
        val oz = analiz(l)
        val c = satir(oz, Kol.CERCEVE, Gecis.GIRIS)
        assertEquals(3, c.kacan)
        assertEquals(1, c.kacanNedenleri[Analiz.N_ACIKLANAMAYAN])
        assertEquals(1, c.kacanNedenleri[Analiz.N_KURULU_DEGIL])
        assertEquals(1, c.kacanNedenleri[Analiz.N_KONUM_KAPALI])
        assertEquals(2, c.kacirmaPay)
        assertEquals(2, c.kacirmaPayda)
        val g = satir(oz, Kol.GMS, Gecis.GIRIS)
        assertEquals(1, g.eslesen)
        assertEquals(1, g.kacirmaPay)
        assertEquals(0.5, g.kacirmaOrani!!, 1e-9)
        // Wi-Fi yalnız eşli bölge 2'deki varışta sayılır.
        assertEquals(1, satir(oz, Kol.WIFI, Gecis.GIRIS).kacirmaPayda)
        Ornekler.acilislar.remove(2)
    }

    @Test
    fun yeniVarisHenuzKacirmaSayilmaz() {
        val l = baslangic()
        l += elle(T0 + SA, 1, Gecis.GIRIS)
        val oz = analiz(l, simdi = T0 + SA + 10 * DK)
        val s = satir(oz, Kol.GMS, Gecis.GIRIS)
        assertEquals(1, s.bekleyen)
        assertEquals(0, s.kacan)
        assertNull(s.kacirmaOrani)
    }

    @Test
    fun cikisVarsaPencereErkenKapanir() {
        val l = baslangic()
        l += elle(T0 + SA, 1, Gecis.GIRIS)
        l += elle(T0 + SA + 20 * DK, 1, Gecis.CIKIS)
        // Algı kullanıcı çıktıktan sonra geldi: varış için geç, kaçtı sayılır.
        l += algi(T0 + SA + 30 * DK, Kol.GMS, Gecis.GIRIS, 1, 1)
        val oz = analiz(l)
        val s = satir(oz, Kol.GMS, Gecis.GIRIS)
        assertEquals(0, s.eslesen)
        assertEquals(1, s.kacan)
        assertEquals(1, s.etiketsiz)
    }

    @Test
    fun etiketlerYanlisTetikVeGecis() {
        val l = baslangic()
        l += algi(T0 + SA, Kol.GMS, Gecis.GIRIS, 1, 7)
        l += etiket(T0 + SA + DK, 7, Cevap.GECTI)
        l += algi(T0 + 3 * SA, Kol.GMS, Gecis.GIRIS, 1, 8)
        l += etiket(T0 + 3 * SA + DK, 8, Cevap.ZATEN)
        l += algi(T0 + 5 * SA, Kol.GMS, Gecis.GIRIS, 2, 9)
        l += algi(T0 + 7 * SA, Kol.GMS, Gecis.CIKIS, 2, 10)
        l += etiket(T0 + 7 * SA + DK, 10, Cevap.CIKMADIM)
        l += elle(T0 + 9 * SA, 2, Gecis.GECTI)
        val oz = analiz(l)
        val g = satir(oz, Kol.GMS, Gecis.GIRIS)
        assertEquals(1, g.yanlis[Cevap.Y_GECIS])
        assertEquals(1, g.yanlis[Cevap.Y_SINIR])
        assertEquals(1, g.etiketsiz)
        assertEquals(0, g.eslesen)
        assertEquals(1.0, g.yanlisOrani!!, 1e-9)
        // Biri etiketten, biri elle iki geçiş; gms yalnız etiketlisinde tetiklendi.
        assertEquals(2, g.gecisToplam)
        assertEquals(1, g.gecisTetik)
        assertEquals(0, satir(oz, Kol.CERCEVE, Gecis.GIRIS).gecisTetik)
        assertEquals(1, satir(oz, Kol.GMS, Gecis.CIKIS).yanlis[Cevap.Y_SINIR])
        assertEquals(2, oz.gecisSayisi)
    }

    @Test
    fun etiketlenenVarisinGecikmesiBildirimAnindanSayilir() {
        val l = baslangic()
        val t = T0 + 2 * SA
        l += algi(t, Kol.GMS, Gecis.GIRIS, 1, 3)
        l += algi(t + 2 * DK, Kol.CERCEVE, Gecis.GIRIS, 1, 3)
        l += etiket(t + 40 * DK, 3, Cevap.VARDIM, dk = 10)
        val oz = analiz(l)
        assertEquals(10 * DK, satir(oz, Kol.GMS, Gecis.GIRIS).gecikme.ortanca)
        assertEquals(12 * DK, satir(oz, Kol.CERCEVE, Gecis.GIRIS).gecikme.ortanca)
    }

    @Test
    fun kurulumTetigiVarisSayilmaz() {
        val l = baslangic()
        val t = T0 + 2 * SA
        l += kur(t, Kol.GMS, neden = "boot")
        l += algi(t + 20_000, Kol.GMS, Gecis.GIRIS, 1, 4, kurSonrasi = 20_000)
        l += etiket(t + DK, 4, Cevap.ZATEN)
        val oz = analiz(l)
        val s = satir(oz, Kol.GMS, Gecis.GIRIS)
        assertEquals(1, s.kurulum)
        assertEquals(0, s.yanlisToplam)
        assertEquals(0, oz.gercekGiris)
        assertTrue(Analiz.bolumler(l).first { it.id == 4 }.kurulum)
    }

    @Test
    fun yakinGercekOlaylarBirlesirElleYeglenir() {
        val l = baslangic()
        val t = T0 + 2 * SA
        l += elle(t + 5 * DK, 1, Gecis.GIRIS)
        l += algi(t + 8 * DK, Kol.GMS, Gecis.GIRIS, 1, 5)
        l += etiket(t + 9 * DK, 5, Cevap.VARDIM, dk = 0)
        val oz = analiz(l)
        assertEquals(1, oz.gercekGiris)
        assertEquals(3 * DK, satir(oz, Kol.GMS, Gecis.GIRIS).gecikme.ortanca)
    }

    private fun seri(n: Int, kacan: Int, gecikme: Long): List<Olay> {
        val l = baslangic()
        for (i in 0 until n) {
            val t = T0 + (i + 1) * 3 * SA
            l += elle(t, 1, Gecis.GIRIS)
            if (i >= kacan) l += algi(t + gecikme, Kol.GMS, Gecis.GIRIS, 1, 100 + i)
        }
        return l
    }

    @Test
    fun kararEsikleri() {
        val son = T0 + 200 * SA
        assertEquals("GEÇER", satir(Analiz.analiz(seri(10, 0, DK), son), Kol.GMS, Gecis.GIRIS).karar)
        assertTrue(satir(Analiz.analiz(seri(9, 0, DK), son), Kol.GMS, Gecis.GIRIS).karar.startsWith("VERİ YETERSİZ"))
        val k = satir(Analiz.analiz(seri(20, 1, DK), son), Kol.GMS, Gecis.GIRIS)
        assertEquals(0.05, k.kacirmaOrani!!, 1e-9)
        assertTrue(k.karar, k.karar.startsWith("GEÇMEZ") && k.karar.contains("kaçırma"))
        val p = satir(Analiz.analiz(seri(10, 0, 6 * DK), son), Kol.GMS, Gecis.GIRIS)
        assertTrue(p.karar, p.karar.contains("p95"))
        // Wi-Fi ve çerçeve hiç algılamadıysa kaçırma %100.
        assertEquals(1.0, satir(Analiz.analiz(seri(10, 0, DK), son), Kol.CERCEVE, Gecis.GIRIS).kacirmaOrani!!, 1e-9)
    }

    @Test
    fun donemlerAyriSayilir() {
        val l = baslangic()
        l += elle(T0 + SA, 1, Gecis.GIRIS)
        l += o(Tur.DONEM, T0 + 24 * SA, mapOf("no" to "2"))
        l += elle(T0 + 30 * SA, 1, Gecis.GIRIS)
        l += algi(T0 + 30 * SA + DK, Kol.GMS, Gecis.GIRIS, 1, 2)
        val oz = analiz(l, T0 + 60 * SA)
        assertEquals(3, oz.donemler.size)
        assertEquals(1, satir(oz, Kol.GMS, Gecis.GIRIS, 1).kacan)
        assertEquals(0, satir(oz, Kol.GMS, Gecis.GIRIS, 1).eslesen)
        assertEquals(1, satir(oz, Kol.GMS, Gecis.GIRIS, 2).eslesen)
        assertEquals(0, satir(oz, Kol.GMS, Gecis.GIRIS, 2).kacan)
    }

    @Test
    fun kaydirmaSonrasiKosulu() {
        val l = baslangic()
        l += o(Tur.EKRAN, T0 + 9 * DK)
        l += o(Tur.ISARET, T0 + 10 * DK, mapOf("tur" to "kaydir"))
        l += elle(T0 + 2 * SA, 1, Gecis.GIRIS) // elle kayıt için ekran hemen önce açılır; pay içinde
        l += o(Tur.EKRAN, T0 + 2 * SA - 30_000)
        l += elle(T0 + 6 * SA, 1, Gecis.GIRIS)
        l += algi(T0 + 6 * SA + DK, Kol.GMS, Gecis.GIRIS, 1, 2, ekran = "1")
        val oz = analiz(l)
        val s = satir(oz, Kol.GMS, Gecis.GIRIS)
        assertEquals(1 to 1, s.kosulKacirma["kaydırıp atma sonrası"])
        assertEquals(0 to 1, s.kosulKacirma["olağan"])
        assertEquals(1, s.kosulGecikme["ekran açık"]!!.n)
    }

    @Test
    fun yenidenBaslatmaVePil() {
        val l = baslangic()
        l += o(Tur.IS, T0 + SA, mapOf("pil" to "80", "sarj" to "0"))
        l += o(Tur.IS, T0 + 2 * SA, mapOf("pil" to "78", "sarj" to "0"))
        l += o(Tur.IS, T0 + 3 * SA, mapOf("pil" to "76", "sarj" to "0"))
        l += o(Tur.IS, T0 + 4 * SA, mapOf("pil" to "90", "sarj" to "1"))
        l += o(Tur.KAPANIS, T0 + 5 * SA)
        Ornekler.acilislar[2] = T0 + 6 * SA
        l += o(Tur.ACILIS, T0 + 6 * SA + 35_000, boot = 2)
        l += o(Tur.BOOT, T0 + 6 * SA + 40_000, boot = 2)
        l += kur(T0 + 6 * SA + 45_000, Kol.GMS, boot = 2, neden = "soguk:boot")
        l += algi(T0 + 6 * SA + 60_000, Kol.GMS, Gecis.GIRIS, 1, 9, kurSonrasi = 15_000, boot = 2)
        val oz = analiz(l)
        assertEquals(1, oz.bootlar.size)
        val b = oz.bootlar[0]
        assertEquals(40_000L, b.yayin)
        assertEquals(45_000L, b.kurlar[Kol.GMS]!!.first)
        assertTrue(b.kapanisYayini)
        assertEquals("açılış yayını", b.ilkCanlanma)
        assertEquals(1, b.kurulumTetikleri.size)
        assertEquals(1, oz.pil.size)
        assertEquals(2.0, oz.pil[0].oran!!, 1e-9)
        Ornekler.acilislar.remove(2)
    }
}
