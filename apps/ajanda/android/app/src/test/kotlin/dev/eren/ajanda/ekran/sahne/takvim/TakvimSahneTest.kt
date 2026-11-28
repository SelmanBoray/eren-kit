package dev.eren.ajanda.ekran.sahne.takvim

import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.GunBolumu
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.ekran.GeriAlma
import dev.eren.ajanda.ekran.TakvimDurumu
import dev.eren.ajanda.ekran.an
import dev.eren.ajanda.ekran.gun
import dev.eren.ajanda.ekran.kayit
import dev.eren.ajanda.ekran.sahne.bugun.DILIM
import dev.eren.ajanda.ekran.sahne.bugun.GUN
import dev.eren.ajanda.ekran.sahne.bugun.SIMDI
import dev.eren.ajanda.ekran.sahne.veri.Gorunus
import dev.eren.ajanda.ekran.sahne.veri.LevhaHali
import dev.eren.ajanda.ekran.sahne.veri.TakvimSahneDenetleyici
import dev.eren.ajanda.ekran.sahne.veri.TakvimSahneModeli
import dev.eren.ajanda.ekran.Takvim
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZonedDateTime

/**
 * Takvim sekmesinin mantığı (JVM, sahte çekirdek): gün sırası, dönem şeritleri, tekrar örnekleri, ay geçişi, gece
 * yarısı ve "bugün"e dönüş, okuma hataları, hücrenin TalkBack okunuşu, taslak. Tarih: 12 Mart 2026 Perşembe, 14:20.
 */
class TakvimSahneTest {
    private val c = TakvimCekirdegi()
    private var simdi = SIMDI
    private val d = TakvimSahneDenetleyici(c) { simdi }
    private fun t(n: Long) = GUN.plusDays(n).toString()

    private fun model(durum: TakvimDurumu = TakvimDurumu.baslangic(GUN)): TakvimSahneModeli {
        d.hepsiniOku(durum)
        while (d.renkleriDoldur(durum)) Unit
        return d.model(durum)
    }

    private fun donem(bas: String, bit: String) = AjandaZamani.Donem(bas, bit, DILIM.id, null)

    @Test
    fun gunSiralamasiBolumsuzBolumluSaatliKapalilarSonda() {
        c.ekle(
            kayit("a", "Akşam yürüyüşü", gun(t(0), bolum = GunBolumu.AKSAM)),
            kayit("b", "Diş kontrolü", an(t(0), "17:00")),
            kayit("c", "Fatura öde", gun(t(0))),
            kayit("d", "Sabah sporu", gun(t(0), bolum = GunBolumu.SABAH)),
            kayit("e", "Vitamin", an(t(0), "09:30"), durum = KayitDurumu.TAMAM),
            kayit("f", "Fuar", donem(t(-1), t(1))),
            // Dünden süren saatli iş (23:00 + 2 saat): saatlilerin başında, saatinden değil.
            kayit("g", "Gece nöbeti", an(t(-1), "23:00", sure = 120)),
            kayit("h", "Kahve", an(t(0), "08:00")),
        )
        val g = model().gun!!
        assertEquals(
            listOf("Fatura öde", "Fuar", "Sabah sporu", "Akşam yürüyüşü", "Gece nöbeti", "Kahve", "Diş kontrolü", "Vitamin"),
            g.kayitlar!!.map { it.baslik },
        )
        val zaman = g.kayitlar.associate { it.kayitId to it.zaman }
        assertEquals("Tüm gün", zaman["c"])
        assertEquals("11 Mar – 13 Mar", zaman["f"])
        assertEquals("Sabah", zaman["d"])
        assertEquals("Sürüyor · bitiş 01:00", zaman["g"])
        assertEquals("17:00", zaman["b"])
        assertEquals(LevhaHali.BITTI, g.kayitlar.last().hal)
        // Saati geçmiş açık iş (bugün): "geçti".
        assertTrue(g.kayitlar.single { it.kayitId == "h" }.gecti)
        assertEquals("Bugün, 12 Mart", g.baslik)
    }

    @Test
    fun bitenleriGizleKapalilariOkumaz() {
        c.ekle(kayit("e", "Vitamin", an(t(0), "09:30"), durum = KayitDurumu.TAMAM), kayit("b", "Diş", an(t(0), "17:00")))
        d.bitenleriGizle = true
        assertEquals(listOf("Diş"), model().gun!!.kayitlar!!.map { it.baslik })
    }

    @Test
    fun donemSeritleriHaftalaraBolunurRenkKayittan() {
        // 9 Mart pazartesi. Fuar 11–17 Mart iki haftaya düşer; kongre 10–11 Mart.
        c.ekle(kayit("f", "Fuar", donem("2026-03-11", "2026-03-17")), kayit("k", "Kongre", donem("2026-03-10", "2026-03-11")))
        val ay = model().aylar.getValue(YearMonth.of(2026, 3))
        val fuar = ay.seritler.filter { it.kayitId == "f" }.sortedBy { it.hafta }
        assertEquals(2, fuar.size)
        assertEquals(listOf(2 to 6, 0 to 1), fuar.map { it.basSutun to it.sonSutun })
        assertTrue(fuar[0].basliyor && !fuar[0].bitiyor)
        assertTrue(!fuar[1].basliyor && fuar[1].bitiyor)
        assertEquals(Gorunus.renkAnahtardan(Gorunus.cizim(null, "Fuar")), fuar[0].renk)
        // Aynı haftada çakışan kongre ayrı sırada.
        val kongre = ay.seritler.single { it.kayitId == "k" }
        assertTrue(kongre.sira != fuar[0].sira)
        assertTrue(ay.siraSayisi >= 2)
        // Şeritli gün hücresinde nokta yok (çok günlü öğe noktaya girmez), okunuşta "çok günlü".
        val h = ay.hucre(LocalDate.of(2026, 3, 11))!!
        assertTrue(h.noktalar.isEmpty())
        assertTrue(h.okunus, h.okunus.contains("2 çok günlü"))
    }

    @Test
    fun tekrarOrnekleriKendiDurumlariylaGelir() {
        c.ekle(kayit("ders", "Piyano dersi", an(t(-2), "18:00")).copy(tekrar = GUNLUK))
        c.ornekGunleri["ders"] = listOf(t(-2), t(0), t(2))
        c.ornekDurumlari["ders"] = mutableMapOf(t(0) to KayitDurumu.TAMAM)
        val bugun = model().gun!!.kayitlar!!.single()
        assertEquals("ders@${t(0)}", bugun.anahtar)
        assertEquals(t(0), bugun.ornekTarihi)
        assertEquals(LevhaHali.BITTI, bugun.hal)
        assertTrue(bugun.tamamlanabilir)
        val sonra = model(TakvimDurumu.baslangic(GUN).gunSec(GUN.plusDays(2))).gun!!.kayitlar!!.single()
        assertEquals(LevhaHali.ACIK, sonra.hal)
        assertEquals(t(2), sonra.ornekTarihi)
        // Ayın hücresinde örneğin noktası örneğin durumuyla (bugün kapalı, sonra açık).
        val ay = model().aylar.getValue(YearMonth.of(2026, 3))
        assertEquals(Takvim.Nokta.KAPALI, ay.hucre(GUN)!!.noktalar.single().tur)
        assertEquals(Takvim.Nokta.ACIK, ay.hucre(GUN.plusDays(2))!!.noktalar.single().tur)
    }

    @Test
    fun ornegiTamamlamakYalnizOGunuDegistirirTostGunuSoyler() {
        c.ekle(kayit("ders", "Piyano dersi", an(t(-2), "18:00")).copy(tekrar = GUNLUK))
        c.ornekGunleri["ders"] = listOf(t(0), t(2))
        val depo = takvimDeposu(c).also { it.basla() }
        val tk = depo.takvim
        tk.goruldu()
        tk.gunSec(GUN.plusDays(2))
        val k = tk.model.value.gun!!.kayitlar!!.single()
        tk.tamamla(k)
        assertTrue(c.cagrilar.contains("durum:ders:TAMAM:${t(2)}"))
        assertEquals(KayitDurumu.ACIK, c.sahte.kayitlar.getValue("ders").durum)
        assertEquals("Bitti: Piyano dersi (14 Mar)", depo.tost.value!!.mesaj)
        assertEquals(LevhaHali.BITTI, tk.model.value.gun!!.kayitlar!!.single().hal)
        // Geri al: örnek yeniden açılır (çekirdekteki önceki durum açıktı).
        depo.tostuGeriAl(depo.tost.value!!)
        assertTrue(c.cagrilar.contains("durum:ders:ACIK:${t(2)}"))
        assertEquals(LevhaHali.ACIK, tk.model.value.gun!!.kayitlar!!.single().hal)
    }

    @Test
    fun ayGecisiGeceYarisiVeBugune() {
        c.ekle(kayit("n", "Nisan işi", gun("2026-04-03")))
        val depo = takvimDeposu(c) { simdi }.also { it.basla() }
        val tk = depo.takvim
        tk.goruldu()
        tk.ayKaydir(1)
        assertEquals(YearMonth.of(2026, 4), tk.secim.value.ay)
        assertEquals(LocalDate.of(2026, 4, 1), tk.secim.value.secili)
        assertTrue(c.cagrilar.contains("takvimAyi:2026-04"))
        // Komşu aylar önceden okunur (kaydırınca hemen çizilsin).
        assertNotNull(tk.model.value.aylar[YearMonth.of(2026, 5)])
        assertEquals(Gorunus.renkAnahtardan(Gorunus.cizim(null, "Nisan işi")), tk.model.value.aylar.getValue(YearMonth.of(2026, 4)).hucre(LocalDate.of(2026, 4, 3))!!.noktalar.single().renk)
        tk.bugune()
        assertEquals(GUN, tk.secim.value.secili)
        assertTrue(tk.secim.value.bugunde)

        // Gece yarısı: bugünü seçili olan yeni güne taşınır.
        simdi = ZonedDateTime.of(2026, 3, 13, 0, 1, 0, 0, DILIM)
        depo.dakika()
        assertEquals(GUN.plusDays(1), tk.secim.value.secili)
        assertEquals("Bugün, 13 Mart", tk.model.value.gun!!.baslik)
        // Başka gün seçiliyken gün değişirse seçim korunur, "bugün" ilerler.
        tk.gunSec(LocalDate.of(2026, 3, 20))
        simdi = ZonedDateTime.of(2026, 3, 14, 0, 1, 0, 0, DILIM)
        depo.dakika()
        assertEquals(LocalDate.of(2026, 3, 20), tk.secim.value.secili)
        assertEquals(LocalDate.of(2026, 3, 14), tk.secim.value.bugun)
    }

    @Test
    fun okumaHatasiKaynakBasinaVeriBosaltilmaz() {
        c.ekle(kayit("b", "Diş", an(t(0), "17:00")))
        val depo = takvimDeposu(c).also { it.basla() }
        val tk = depo.takvim
        tk.goruldu()
        assertEquals(1, tk.model.value.gun!!.kayitlar!!.size)
        // Ay okunamaz, gün okunur: yalnız ayın hatası.
        c.ayHatasi = IllegalStateException("ay bozuk")
        tk.yenile()
        val m = tk.model.value
        assertNotNull(m.aylar.getValue(YearMonth.of(2026, 3)).okunamadi)
        assertNull(m.gun!!.okunamadi)
        assertEquals(1, m.gun.kayitlar!!.size)
        // Gün de okunamaz: eldeki kayıtlar kalır, hata söylenir.
        c.gunHatasi = IllegalStateException("gün bozuk")
        tk.yenile()
        assertNotNull(tk.model.value.gun!!.okunamadi)
        assertEquals(listOf("Diş"), tk.model.value.gun!!.kayitlar!!.map { it.baslik })
        assertNotNull(tk.model.value.okumaHatasi)
        // Düzelince hatalar silinir.
        c.ayHatasi = null
        c.gunHatasi = null
        tk.yenile()
        assertNull(tk.model.value.okumaHatasi)
        assertNull(tk.model.value.aylar.getValue(YearMonth.of(2026, 3)).okunamadi)
    }

    @Test
    fun hicOkunamayanGunVeriYerineHataGosterir() {
        c.gunHatasi = IllegalStateException("gün bozuk")
        val m = model()
        assertNull(m.gun!!.kayitlar)
        assertNotNull(m.gun.okunamadi)
    }

    @Test
    fun gunHucresiTalkBackOkunusuTarihSayiTaslak() {
        c.ekle(
            kayit("a", "Kahve", an(t(0), "15:30")),
            kayit("b", "Diş", an(t(0), "17:00")),
            kayit("t", "Eczane", gun(t(0)), taslak = true),
            kayit("f", "Fuar", donem(t(0), t(2))),
        )
        val ay = model().aylar.getValue(YearMonth.of(2026, 3))
        val h = ay.hucre(GUN)!!
        assertTrue(h.okunus, h.okunus.startsWith("Perşembe, 12 Mart, bugün. 4 kayıt"))
        assertTrue(h.okunus, h.okunus.contains("1 taslak"))
        assertTrue(h.okunus, h.okunus.contains("1 çok günlü"))
        // Noktalar: tek günlükler, günün sırasıyla, kaydın renginde; taslak kesikli halka.
        assertEquals(listOf(Takvim.Nokta.TASLAK, Takvim.Nokta.ACIK, Takvim.Nokta.ACIK), h.noktalar.map { it.tur })
        assertEquals(Gorunus.renkAnahtardan(Gorunus.cizim(null, "Kahve")), h.noktalar[1].renk)
        val bos = ay.hucre(GUN.plusDays(5))!!
        assertEquals("Salı, 17 Mart. Kayıt yok.", bos.okunus)
        // Ay dışı hücre (önceki ayın günleri): soluk, okunuşu ayı söyler.
        val disi = ay.hucreler.first()
        assertFalse(disi.ayda)
        assertTrue(disi.okunus, disi.okunus.endsWith("önceki ay."))
    }

    @Test
    fun uctenCokKayitliGundeUcuncuNoktaArtiOlur() {
        for (i in 0 until 5) c.ekle(kayit("k$i", "İş $i", an(t(0), "1$i:00")))
        val h = model().aylar.getValue(YearMonth.of(2026, 3)).hucre(GUN)!!
        assertEquals(2, h.noktalar.size)
        assertTrue(h.fazla)
    }

    @Test
    fun taslakKarakalemOnaylanir() {
        c.ekle(kayit("t", "Eczaneden ilaç al", gun(t(0)), taslak = true))
        val depo = takvimDeposu(c).also { it.basla() }
        val tk = depo.takvim
        tk.goruldu()
        val k = tk.model.value.gun!!.kayitlar!!.single()
        assertEquals(LevhaHali.TASLAK, k.hal)
        tk.onayla(k.kayitId)
        assertTrue(c.cagrilar.contains("onayla:t"))
        assertEquals(LevhaHali.ACIK, tk.model.value.gun!!.kayitlar!!.single().hal)
        assertEquals("Onaylandı", depo.tost.value!!.mesaj)
    }

    @Test
    fun gorunmezKardesDegisiklikteOkumazGorununceOkur() {
        val depo = takvimDeposu(c).also { it.basla() }
        val tk = depo.takvim
        tk.goruldu()
        tk.gizlendi()
        c.cagrilar.clear()
        c.ekle(kayit("y", "Yeni", gun(t(0))))
        c.durumDegistir("y", KayitDurumu.ACIK, null)
        assertTrue("görünmezken takvim okunmaz", c.cagrilar.none { it.startsWith("takvimAyi") })
        tk.goruldu()
        assertEquals(listOf("Yeni"), tk.model.value.gun!!.kayitlar!!.map { it.baslik })
    }

    @Test
    fun geriAlmaBaskasininDegisikliginiEzmez() {
        // G3: telefonda tamamlandı, PC bu arada iptal etti: "Geri al" uygulanmaz.
        c.ekle(kayit("b", "Diş", an(t(0), "17:00")))
        val depo = takvimDeposu(c).also { it.basla() }
        val tk = depo.takvim
        tk.goruldu()
        tk.tamamla(tk.model.value.gun!!.kayitlar!!.single())
        val tost = depo.tost.value!!
        assertTrue(tost.geriAlma is GeriAlma.Durum)
        c.sahte.kayitlar["b"] = c.sahte.kayitlar.getValue("b").copy(durum = KayitDurumu.IPTAL)
        c.cagrilar.clear()
        depo.tostuGeriAl(tost)
        assertTrue(c.cagrilar.none { it.startsWith("durum:") })
        assertEquals(dev.eren.ajanda.ekran.sahne.veri.KayitKurucu.DEGISTI_UYARISI, depo.tost.value!!.mesaj)
    }
}
