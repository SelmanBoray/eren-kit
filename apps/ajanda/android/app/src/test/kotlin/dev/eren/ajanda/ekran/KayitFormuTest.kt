package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.Hatirlatma
import dev.eren.ajanda.cekirdek.KayitGovdesi
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.Tekrar
import dev.eren.ajanda.cekirdek.TekrarSikligi
import dev.eren.ajanda.cekirdek.govdeyiHazirla
import dev.eren.ajanda.cekirdek.varsayilanHatirlatmalar
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime

class KayitFormuTest {
    private val ist = "Europe/Istanbul"
    private val gun26 = LocalDate.of(2026, 11, 26)

    @Test
    fun yeniFormGovdesi() {
        val f = KayitFormu.yeni(KayitTuru.GOREV, gun26, ist, listOf(Hatirlatma.Once(60)))
            .copy(baslik = "Fatura öde", aciklama = "   ")
        assertEquals(
            KayitGovdesi(KayitTuru.GOREV, "Fatura öde", null, AjandaZamani.Gun("2026-11-26", ist, null), listOf(Hatirlatma.Once(60)), null),
            f.govde(),
        )
        val saatli = f.saatVer(LocalTime.of(9, 5))
        assertEquals(AjandaZamani.An("2026-11-26", "09:05", null, ist, null), saatli.govde().zaman)
        assertNull(saatli.tarihVer(null).govde().zaman)
        assertNull("tarih kalkınca saat de kalkar", saatli.tarihVer(null).saat)
        // Saatsiz kayıtta "önce" hatırlatması bekler (kullanıcıya söylenir).
        assertTrue(f.hatirlatmaBekler)
        assertFalse(saatli.hatirlatmaBekler)
    }

    @Test
    fun duzenlemedeDokunulmayanZamanKorunur() {
        val z = AjandaZamani.An("2026-11-27", "15:00", 45, ist, "yarın 3'te")
        val k = kayit("k", baslik = "Dişçi", zaman = z, tur = KayitTuru.RANDEVU)
        val f = KayitFormu.kayittan(k, "Europe/London")
        assertEquals(z, f.govde().zaman)
        assertEquals(ist, f.dilim)
        // Yalnız başlık değişti: zaman (ifade, süre) aynen.
        assertEquals(z, f.copy(baslik = "Dişçi kontrol").govde().zaman)
        // Saat değişti: ifade düşer, süre ve kaydın dilimi kalır.
        assertEquals(AjandaZamani.An("2026-11-27", "16:30", 45, ist, null), f.saatVer(LocalTime.of(16, 30)).govde().zaman)
    }

    @Test
    fun donemVeBelirsizDokunulmadikcaKorunur() {
        val d = AjandaZamani.Donem("2026-12-01", "2026-12-05", ist, "aralık başı")
        val f = KayitFormu.kayittan(kayit("d", zaman = d), ist)
        assertEquals(d, f.govde().zaman)
        assertEquals(AjandaZamani.Gun("2026-12-03", ist, null), f.tarihVer(LocalDate.of(2026, 12, 3)).govde().zaman)
        val b = AjandaZamani.Belirsiz("bir ara")
        val fb = KayitFormu.kayittan(kayit("b", zaman = b), ist)
        assertEquals(b, fb.govde().zaman)
        assertNull(fb.tarihVer(null).govde().zaman)
    }

    @Test
    fun hatirlatmaSecenekleriVeDegisimi() {
        val m = Hatirlatma.Mutlak("2026-11-27", "08:00", ist)
        val f = KayitFormu(hatirlatmalar = listOf(Hatirlatma.Once(60), Hatirlatma.Once(30), m))
        assertEquals(
            listOf(0, 10, 60, 1440).map { Hatirlatma.Once(it) } + listOf(Hatirlatma.Once(30), m),
            KayitFormu.hatirlatmaSecenekleri(f),
        )
        assertEquals(listOf(Hatirlatma.Once(30), m), f.hatirlatmaDegistir(Hatirlatma.Once(60)).hatirlatmalar)
        assertEquals(listOf(Hatirlatma.Once(60), Hatirlatma.Once(30), m, Hatirlatma.Once(0)), f.hatirlatmaDegistir(Hatirlatma.Once(0)).hatirlatmalar)
        assertEquals("1 saat önce", EkranMetinleri.hatirlatma(Hatirlatma.Once(60), gun26))
        assertEquals("Tam zamanında", EkranMetinleri.hatirlatma(Hatirlatma.Once(0), gun26))
        assertEquals("1 gün önce", EkranMetinleri.hatirlatma(Hatirlatma.Once(1440), gun26))
        assertEquals("27 Kas 08:00", EkranMetinleri.hatirlatma(m, gun26))
    }

    @Test
    fun onDenetim() {
        assertEquals(listOf(FormSorunu(FormAlani.BASLIK, "Başlık boş olamaz.")), KayitFormu.onDenetim(KayitFormu(baslik = "   ")))
        val uzun = "a".repeat(201)
        assertEquals(
            "Başlık çok uzun: en çok 200 karakter olabilir, şu an 201.",
            KayitFormu.onDenetim(KayitFormu(baslik = uzun)).single().mesaj,
        )
        // UTF-16 birimi: bir emoji iki birimdir (çekirdek de öyle sayar).
        assertEquals(1, KayitFormu.onDenetim(KayitFormu(baslik = "☕".repeat(150) + "😀".repeat(26))).size)
        assertTrue(KayitFormu.onDenetim(KayitFormu(baslik = "  tamam  ")).isEmpty())
        val tekrar = Tekrar(TekrarSikligi.GUNLUK, 1, null, null, null)
        assertEquals(FormAlani.TEKRAR, KayitFormu.onDenetim(KayitFormu(baslik = "x", tekrar = tekrar, zamanDegisti = true)).single().alan)
    }

    @Test
    fun cekirdekSorunlariTurkceMesaja() {
        assertEquals(FormSorunu(FormAlani.BASLIK, "Başlık boş olamaz."), KayitFormu.cekirdekSorunu("baslik", "çok kısa"))
        assertEquals(
            FormSorunu(FormAlani.DILIM, "Saat dilimi tanınmadı; listeden bir dilim seçin."),
            KayitFormu.cekirdekSorunu("zaman.saat_dilimi", "IANA dilim biçimi değil"),
        )
        assertEquals(FormAlani.HATIRLATMA, KayitFormu.cekirdekSorunu("hatirlatmalar.0.saat_dilimi", "IANA dilim biçimi değil").alan)
        assertEquals("Aynı hatırlatma iki kez seçilmiş.", KayitFormu.cekirdekSorunu("hatirlatmalar", "yinelenen hatırlatma").mesaj)
        assertEquals(
            "Açıklama görünmeyen bir karakter içeriyor; o kısmı silip yeniden yazın.",
            KayitFormu.cekirdekSorunu("aciklama", "görünmez ya da yok sayılan karakter").mesaj,
        )
        assertEquals(FormSorunu(FormAlani.GENEL, "Kayıt kabul edilmedi (bilinmeyen)."), KayitFormu.cekirdekSorunu("x", "bilinmeyen"))
        assertEquals(FormAlani.GENEL, KayitFormu.hataMesaji(CekirdekHatasi.KayitYok("k_1")).alan)
        assertEquals("Silinmiş kayıtta bu yapılamaz; önce geri yükleyin.", KayitFormu.hataMesaji(CekirdekHatasi.GecersizDurum("x")).mesaj)
    }

    /** Gerçek çekirdeğin form kuralı: sorun alanı ve nedeni çevirinin beklediği gibi gelir. */
    @Test
    fun gercekCekirdekSorunlariCevrilir() {
        fun sorun(g: KayitGovdesi, f: KayitFormu? = null): FormSorunu = try {
            govdeyiHazirla(g)
            fail("kabul edildi: $g")
            error("")
        } catch (e: CekirdekHatasi.GecersizGirdi) {
            KayitFormu.cekirdekSorunu(e.alan, e.neden, f)
        }
        val taban = KayitGovdesi(KayitTuru.GOREV, "x", null, null, varsayilanHatirlatmalar(), null)
        assertEquals(FormSorunu(FormAlani.BASLIK, "Başlık boş olamaz."), sorun(taban.copy(baslik = " ​ ")))
        val uzun = "ş".repeat(205)
        assertEquals(
            FormSorunu(FormAlani.BASLIK, "Başlık çok uzun: en çok 200 karakter olabilir, şu an 205."),
            sorun(taban.copy(baslik = uzun), KayitFormu(baslik = uzun)),
        )
        assertEquals(FormAlani.ACIKLAMA, sorun(taban.copy(aciklama = "a".repeat(4001))).alan)
        // Cihaz dilimi IANA biçiminde değilse (bazı cihazlarda "GMT+03:00") dilim seçtirilir.
        val dilim = sorun(taban.copy(zaman = AjandaZamani.Gun("2026-11-26", "GMT+03:00", null)))
        assertEquals(FormSorunu(FormAlani.DILIM, "Saat dilimi tanınmadı; listeden bir dilim seçin."), dilim)
        assertEquals(
            "Aynı hatırlatma iki kez seçilmiş.",
            sorun(taban.copy(hatirlatmalar = listOf(Hatirlatma.Once(5), Hatirlatma.Once(5)))).mesaj,
        )
        // Gizli karakter temizlenir, emoji korunur; çok satırlı başlık tek satır olur.
        val temiz = govdeyiHazirla(taban.copy(baslik = "  Dişçi​ ☕️\nkontrol  "))
        assertEquals("Dişçi ☕️ kontrol", temiz.baslik)
    }
}
