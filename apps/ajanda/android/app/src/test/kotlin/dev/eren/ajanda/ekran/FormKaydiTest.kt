package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.DuzenlemeTemeli
import dev.eren.ajanda.cekirdek.GunBolumu
import dev.eren.ajanda.cekirdek.HaftaGunu
import dev.eren.ajanda.cekirdek.Hatirlatma
import dev.eren.ajanda.cekirdek.KayitGovdesi
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.Tekrar
import dev.eren.ajanda.cekirdek.TekrarSikligi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime

/** Kaydedilmemiş form döndürme, tema değişimi ve süreç ölümünden sonra eksiksiz geri gelir (bulgu 4). */
class FormKaydiTest {
    private fun gidipGelir(d: FormDurumu) = assertEquals(d, FormKaydi.oku(FormKaydi.yaz(d)))

    @Test
    fun yeniKayitYazilmisAmaKaydedilmemis() {
        val f = KayitFormu.yeni(KayitTuru.RANDEVU, LocalDate.of(2026, 11, 28), "Europe/Istanbul", listOf(Hatirlatma.Once(60)))
            .copy(baslik = "yarın 15:00 dişçi", aciklama = "Satır 1\nSatır 2 · “tırnak” = & %", saat = LocalTime.of(15, 0))
        gidipGelir(FormDurumu(f, null, dilimTanindi = true))
        // Boş başlık, dilim tanınmadı, sınır üstü hatırlatma (form henüz geçersiz olabilir).
        val bos = KayitFormu.yeni(KayitTuru.NOT, null, "GMT+03:00", (0..9).map { Hatirlatma.Once(it) })
        gidipGelir(FormDurumu(bos, null, dilimTanindi = false))
    }

    @Test
    fun duzenlemeTemeliVeButunZamanTurleri() {
        val tekrar = Tekrar(TekrarSikligi.HAFTALIK, 2, listOf(HaftaGunu.PZT, HaftaGunu.CUM), "2027-01-31", null)
        val zamanlar = listOf(
            AjandaZamani.An("2026-11-26", "15:00", 45, "Europe/Istanbul", "yarın öğleden sonra"),
            AjandaZamani.An("2026-11-26", "09:30", null, "UTC", null),
            AjandaZamani.Gun("2026-12-01", GunBolumu.AKSAM, "Europe/Istanbul", "ayın başı"),
            AjandaZamani.Donem("2026-12-24", "2026-12-31", "Europe/Istanbul", null),
            AjandaZamani.Belirsiz("haftaya bir ara"),
            null,
        )
        for (z in zamanlar) {
            val govde = KayitGovdesi(
                KayitTuru.GOREV, "Toplantı", null, z,
                listOf(Hatirlatma.Once(10), Hatirlatma.Mutlak("2026-11-25", "20:00", "Europe/Istanbul")),
                tekrar.takeIf { z is AjandaZamani.An },
            )
            val f = KayitFormu.govdeden(govde, "Europe/Istanbul").copy(aciklama = "değişti", zamanDegisti = z is AjandaZamani.Gun)
            gidipGelir(FormDurumu(f, DuzenlemeTemeli(7, govde), dilimTanindi = true))
        }
        // Boş gün listeli ve adetli tekrar.
        val t2 = Tekrar(TekrarSikligi.AYLIK, 1, null, null, 12)
        val g2 = KayitGovdesi(KayitTuru.RANDEVU, "Kira", "açıklama", AjandaZamani.Gun("2026-12-05", null, "UTC", null), emptyList(), t2)
        gidipGelir(FormDurumu(KayitFormu.govdeden(g2, "UTC"), DuzenlemeTemeli(1, g2), dilimTanindi = true))
    }

    @Test
    fun bozukKayitNullDoner() {
        val d = FormKaydi.yaz(FormDurumu(KayitFormu(baslik = "x"), null, true))
        assertNull(FormKaydi.oku(d - "tur"))
        assertNull(FormKaydi.oku(d + ("h.n" to "1")))
        assertNull(FormKaydi.oku(d + ("tur" to "YOK")))
        assertNull(FormKaydi.oku(emptyMap()))
    }
}
