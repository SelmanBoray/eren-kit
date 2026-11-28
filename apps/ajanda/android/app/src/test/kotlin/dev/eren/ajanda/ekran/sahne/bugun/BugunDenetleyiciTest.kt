package dev.eren.ajanda.ekran.sahne.bugun

import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.GunBolumu
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.Sekme
import dev.eren.ajanda.ekran.GeriAlma
import dev.eren.ajanda.ekran.an
import dev.eren.ajanda.ekran.gun
import dev.eren.ajanda.ekran.kayit
import dev.eren.ajanda.ekran.sahne.veri.BugunDenetleyici
import dev.eren.ajanda.ekran.sahne.veri.BugunModeli
import dev.eren.ajanda.ekran.sahne.veri.Gorunus
import dev.eren.ajanda.ekran.sahne.veri.LevhaHali
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Bugün durum tutucusunun mantığı: sıralama, sıradaki iş, geçti, kalanlar, yaklaşanlar, işlemler. Sahte çekirdekle. */
class BugunDenetleyiciTest {
    private val c = BugunCekirdegi()
    private var simdi = SIMDI
    private val d = BugunDenetleyici(c) { simdi }

    private fun model(): BugunModeli {
        d.hepsiniOku()
        return d.model()
    }

    private fun BugunModeli.basliklar() = acikler.map { it.baslik }

    @Test
    fun gunSiralamasiBolumsuzBolumluSaatli() {
        c.ekle(
            kayit("a", "Akşam yürüyüşü", gun(GUN.toString(), bolum = GunBolumu.AKSAM)),
            kayit("b", "Diş", an(GUN.toString(), "17:00")),
            kayit("c", "Fatura", gun(GUN.toString())),
            kayit("d", "Sabah sporu", gun(GUN.toString(), bolum = GunBolumu.SABAH)),
            kayit("e", "Kahve", an(GUN.toString(), "15:30")),
        )
        val m = model()
        // Sıradaki (saati şimdiden sonra olan ilk: 15:30) başta; ötekiler gün sırasıyla.
        assertEquals(listOf("Kahve", "Fatura", "Sabah sporu", "Akşam yürüyüşü", "Diş"), m.basliklar())
        assertEquals("e", m.siradaki)
        assertEquals("Sırada kahve var.", m.cumle)
        assertEquals("1 saat sonra, 15:30", m.alt)
    }

    @Test
    fun siradakiYakinsaDakikaYazilir() {
        c.ekle(kayit("e", "Kahve", an(GUN.toString(), "14:40")))
        assertEquals("20 dakika sonra, 14:40", model().alt)
    }

    @Test
    fun saatiGecenGundeKalirGectiIsaretiTasirSiradakiOlmaz() {
        c.ekle(
            kayit("sabah", "Toplantı", an(GUN.toString(), "09:00")),
            kayit("aksam", "Market", an(GUN.toString(), "18:00")),
        )
        val m = model()
        val gecen = m.acikler.single { it.kayitId == "sabah" }
        assertTrue(gecen.gecti)
        assertEquals(LevhaHali.ACIK, gecen.hal)
        assertFalse(m.acikler.single { it.kayitId == "aksam" }.gecti)
        assertEquals("aksam", m.siradaki)
        assertTrue(gecen.aciklama.contains("saati geçti"))
    }

    @Test
    fun gelecekteSaatliYoksaSiradakiIlkAciktir() {
        c.ekle(kayit("sabah", "Toplantı", an(GUN.toString(), "09:00")), kayit("bolum", "Çiçek", gun(GUN.toString())))
        val m = model()
        assertEquals("bolum", m.siradaki)
        assertEquals("Bugün, tüm gün", m.alt)
    }

    @Test
    fun kalanlarOncekiGunlerinAcigiDir() {
        c.ekle(
            kayit("dun", "Kargo", an(gunSonra(-1), "10:00")),
            kayit("eski", "Vergi", gun(gunSonra(-5))),
            kayit("bitmis", "Su", gun(gunSonra(-2)), durum = KayitDurumu.TAMAM),
            kayit("bugun", "Kahve", an(GUN.toString(), "16:00")),
        )
        val m = model()
        // En eskisi önce; bitmiş geçmiş görünmez; bugünkü mozaikte.
        assertEquals(listOf("eski", "dun"), m.kalanlar.map { it.kayitId })
        assertTrue(m.kalanlar.first().zaman!!.contains("5 gün geçti"))
        assertEquals(listOf("bugun"), m.acikler.map { it.kayitId })
    }

    @Test
    fun yaklasanlarGunGunSonrasiAyri() {
        c.ekle(
            kayit("y1", "Kitap", an(gunSonra(1), "11:00")),
            kayit("y0", "Fırın", gun(gunSonra(1))),
            kayit("h", "Bisiklet", gun(gunSonra(4), bolum = GunBolumu.SABAH)),
            kayit("s", "Pasaport", an(gunSonra(20), "09:30")),
        )
        val m = model()
        assertEquals(listOf("Yarın, 13 Mart", "Pazartesi, 16 Mart", "Sonrası"), m.yaklasanlar.map { it.baslik })
        assertEquals(listOf("Fırın", "Kitap"), m.yaklasanlar[0].kayitlar.map { it.baslik })
        assertEquals("11:00", m.yaklasanlar[0].kayitlar[1].zaman)
        assertTrue(m.yaklasanlar[2].kayitlar.single().zaman!!.contains("1 Nis"))
    }

    @Test
    fun taslaklarBastaVeBugundeIkinciKezYok() {
        c.ekle(
            kayit("t", "Eczane", an(GUN.toString(), "17:00"), taslak = true),
            kayit("t2", "Fatura", an(gunSonra(2), "10:00"), taslak = true),
            kayit("a", "Kahve", an(GUN.toString(), "15:00")),
        )
        val m = model()
        assertEquals(listOf("t", "t2"), m.taslaklar.map { it.kayitId })
        assertTrue(m.taslaklar.all { it.hal == LevhaHali.TASLAK })
        assertEquals(listOf("a"), m.acikler.map { it.kayitId })
        assertTrue(m.yaklasanlar.isEmpty())
        assertEquals("bugün, 17:00", m.taslaklar[0].zaman)
        assertEquals(3, m.yogunlukSayisi) // 1 açık + 2 taslak
    }

    @Test
    fun tamamlaVeGeriAl() {
        c.ekle(kayit("a", "Kahve", an(GUN.toString(), "15:00")), kayit("b", "Diş", an(GUN.toString(), "17:00")))
        val ilk = model()
        val s = d.tamamla(ilk.acikler.first())
        assertEquals("Bitti: Kahve", s.mesaj)
        assertEquals(GeriAlma.Durum("a", KayitDurumu.ACIK, null), s.geriAlma)
        d.degisti(Degisim(listOf("a"), false, false, false, false, emptyList()))
        val sonra = d.model()
        // Tamamlanan solar ve günün sonuna iner (bitenler); sıradaki değişti.
        assertEquals(listOf("b"), sonra.acikler.map { it.kayitId })
        assertEquals(listOf("a"), sonra.bitenler.map { it.kayitId })
        assertEquals(LevhaHali.BITTI, sonra.bitenler.single().hal)
        assertEquals("b", sonra.siradaki)

        assertEquals("Geri alındı", d.geriAl(s.geriAlma!!).mesaj)
        d.degisti(Degisim(listOf("a"), false, false, false, false, emptyList()))
        assertEquals(listOf("a", "b"), d.model().acikler.map { it.kayitId })
        assertEquals(listOf("durum:a:TAMAM", "durum:a:ACIK"), c.cagrilar.filter { it.startsWith("durum:") })
    }

    @Test
    fun tekrarOrneginiTamamlamakYalnizOGunu() {
        c.ekle(kayit("r", "Vitamin", an(GUN.toString(), "09:00")))
        c.ornekTarihleri["r"] = GUN.toString()
        val k = model().acikler.single()
        assertEquals("r@${GUN}", k.anahtar)
        d.tamamla(k)
        assertTrue(c.cagrilar.contains("durum:r:TAMAM:$GUN"))
    }

    @Test
    fun taslakOnaylaVeVazgecGeriAl() {
        c.ekle(kayit("t", "Eczane", an(GUN.toString(), "17:00"), taslak = true), kayit("v", "Kırtasiye", gun(GUN.toString()), taslak = true))
        model()
        assertEquals("Onaylandı", d.onayla("t").mesaj)
        assertNull(d.onayla("t").geriAlma)
        val v = d.vazgec("v")
        assertEquals("Öneriden vazgeçildi", v.mesaj)
        assertEquals(GeriAlma.GeriYukle("v"), v.geriAlma)
        d.degisti(Degisim(listOf("t", "v"), false, false, false, false, emptyList()))
        val m = d.model()
        // Onaylanan bugünün mozaiğine iner; vazgeçilen kalkar.
        assertTrue(m.taslaklar.isEmpty())
        assertEquals(listOf("t"), m.acikler.map { it.kayitId })
        d.geriAl(v.geriAlma!!)
        d.degisti(Degisim(listOf("v"), false, false, false, false, emptyList()))
        assertEquals(listOf("v"), d.model().taslaklar.map { it.kayitId })
    }

    @Test
    fun bosGunCumlesi() {
        val m = model()
        assertEquals("Bugünlük bu kadar.", m.cumle)
        assertEquals("Yeni bir şey eklemek için artıya dokun.", m.alt)
        assertTrue(m.bos)
        c.ekle(kayit("x", "Kahve", an(GUN.toString(), "09:00"), durum = KayitDurumu.TAMAM))
        assertEquals("1 iş bitti.", model().alt)
    }

    @Test
    fun notTamamlanmaz() {
        c.ekle(kayit("n", "Fikir", gun(GUN.toString()), tur = KayitTuru.NOT))
        assertFalse(model().acikler.single().tamamlanabilir)
    }

    @Test
    fun degisiklikteYalnizEtkilenenListeOkunur() {
        c.ekle(kayit("a", "Kahve", an(gunSonra(1), "15:00")))
        model()
        c.cagrilar.clear()
        // Yarınki kayıt değişti: Tarihli yeniden, Taslaklar okunmaz; bugünün takvim günü her zaman.
        val okunan = d.degisti(Degisim(listOf("a"), false, false, false, false, emptyList()))
        assertEquals(setOf(Sekme.TARIHLI), okunan)
        assertTrue(c.cagrilar.contains("takvimGunu:$GUN"))
        assertFalse(c.cagrilar.contains("liste:TASLAKLAR"))
        // Yalnız bağlantı: hiçbir liste.
        c.cagrilar.clear()
        assertTrue(d.degisti(Degisim(emptyList(), false, false, true, false, emptyList())).isEmpty())
        assertFalse(c.cagrilar.any { it.startsWith("liste") || it.startsWith("takvim") })
    }

    @Test
    fun gunDegisinceYenidenOkunur() {
        c.ekle(kayit("y", "Kitap", an(gunSonra(1), "11:00")))
        model()
        simdi = SIMDI.plusDays(1).withHour(8)
        val m = d.model()
        assertEquals(GUN.plusDays(1), m.bugun)
        assertEquals(listOf("y"), m.acikler.map { it.kayitId })
        assertEquals("Sırada kitap var.", m.cumle)
    }

    @Test
    fun durumOzetiEslesmeYokVeRet() {
        c.eslesme = dev.eren.ajanda.cekirdek.EslesmeDurumu.Yok
        val m = model()
        assertFalse(m.durum.eslesmeVar)
        assertEquals("Eşleşmedi", m.durum.gosterge.kisa)
    }

    @Test
    fun renkVeCizimKararli() {
        assertEquals(Gorunus.renk("k_1"), Gorunus.renk("k_1"))
        assertEquals(Gorunus.cizim(null, "Kahve molası"), Gorunus.cizim(null, "Kahve molası"))
    }

    // ---------------------------------------------------------------------------------------------
    // Gözden geçirme düzeltmeleri
    // ---------------------------------------------------------------------------------------------

    private fun degisim(vararg id: String) = Degisim(id.toList(), false, false, false, false, emptyList())

    /** İptal edilmiş iş "Yeniden aç"tan sonra geri alınınca iptale döner; tamamlanmış olmaz. */
    @Test
    fun iptalEdilenYenidenAcilipGeriAlinincaIptaleDoner() {
        c.ekle(kayit("i", "Toplantı", an(GUN.toString(), "16:00"), durum = KayitDurumu.IPTAL))
        val biten = model().bitenler.single()
        assertTrue(biten.aciklama.contains("iptal edildi"))
        val s = d.tamamla(biten, tamam = false)
        assertEquals(GeriAlma.Durum("i", KayitDurumu.IPTAL, null), s.geriAlma)
        d.degisti(degisim("i"))
        assertEquals(listOf("i"), d.model().acikler.map { it.kayitId })
        d.geriAl(s.geriAlma!!)
        assertEquals(KayitDurumu.IPTAL, c.sahte.kayitlar.getValue("i").durum)
    }

    /** Süren aralıklı iş "şimdi"dir: geçti sayılmaz, sıradaki odur; bitişi geçince geçti olur. */
    @Test
    fun surenAralikliIsSimdidirBitinceGecer() {
        c.ekle(
            kayit("t", "Toplantı", an(GUN.toString(), "10:00", sure = 120)),
            kayit("o", "Öğle yemeği", an(GUN.toString(), "12:30")),
        )
        simdi = SIMDI.withHour(10).withMinute(1)
        val m = model()
        val t = m.acikler.single { it.kayitId == "t" }
        assertFalse(t.gecti)
        assertEquals("10:00–12:00", t.zaman)
        assertEquals("t", m.siradaki)
        assertEquals("Sırada toplantı var.", m.cumle)
        assertEquals("Şimdi, 10:00–12:00", m.alt)

        simdi = SIMDI.withHour(11).withMinute(59)
        assertEquals("t", d.model().siradaki)

        simdi = SIMDI.withHour(12).withMinute(0)
        val sonra = d.model()
        assertTrue(sonra.acikler.single { it.kayitId == "t" }.gecti)
        assertEquals("o", sonra.siradaki)
    }

    /** Önceki günlerden kalan ya da yaklaşan iş tamamlanınca kaybolmaz: solup kendi sırasının sonuna iner. */
    @Test
    fun kalandanVeYaklasandanTamamlananSolupSonaIner() {
        c.ekle(
            kayit("eski", "Vergi", gun(gunSonra(-5))),
            kayit("dun", "Kargo", an(gunSonra(-1), "10:00")),
            kayit("y1", "Kitap", an(gunSonra(1), "11:00")),
            kayit("y2", "Fırın", an(gunSonra(1), "12:00")),
        )
        val ilk = model()
        d.tamamla(ilk.kalanlar.first { it.kayitId == "eski" })
        d.tamamla(ilk.yaklasanlar[0].kayitlar.first { it.kayitId == "y1" })
        d.degisti(degisim("eski", "y1"))
        val m = d.model()
        assertEquals(listOf("dun", "eski"), m.kalanlar.map { it.kayitId })
        assertEquals(listOf(LevhaHali.ACIK, LevhaHali.BITTI), m.kalanlar.map { it.hal })
        assertEquals(listOf("y2", "y1"), m.yaklasanlar[0].kayitlar.map { it.kayitId })
        assertEquals(LevhaHali.BITTI, m.yaklasanlar[0].kayitlar.last().hal)
        assertTrue(m.bitenler.isEmpty())

        // Yeniden açılınca yerine döner (tek kopya).
        val s = d.tamamla(m.kalanlar.last(), tamam = false)
        assertEquals(GeriAlma.Durum("eski", KayitDurumu.TAMAM, null), s.geriAlma)
        d.degisti(degisim("eski"))
        val acildi = d.model()
        assertEquals(listOf("eski", "dun"), acildi.kalanlar.map { it.kayitId })
        assertTrue(acildi.kalanlar.all { it.hal == LevhaHali.ACIK })

        // Ertesi gün tutulmaz.
        simdi = SIMDI.plusDays(1)
        assertTrue(d.model().yaklasanlar.flatMap { it.kayitlar }.none { it.kayitId == "y1" })
    }

    /** Bir kaynağın okuma hatasını başka bir kaynağın başarılı okuması silmez. */
    @Test
    fun okumaHatasiYalnizKendiOkumasiylaSilinir() {
        c.ekle(kayit("a", "Kahve", an(GUN.toString(), "15:00")), kayit("y", "Kitap", an(gunSonra(1), "11:00")))
        c.listeHatasi = IllegalStateException("liste")
        val m = model()
        assertNotNull("liste okunamadı", m.okumaHatasi)
        // Takvim yine başarılı okunur: listenin hatası durur.
        d.degisti(degisim("a"))
        assertNotNull(d.model().okumaHatasi)
        c.listeHatasi = null
        d.degisti(degisim("y"))
        assertNull(d.model().okumaHatasi)
    }

    /** Takvim okunamazsa ekran "yüklendi" kalır ve hatayı söyler; liste okuması bu hatayı silmez, dünün günü bugün diye gösterilmez. */
    @Test
    fun takvimHatasiListeOkumasiylaSilinmez() {
        c.ekle(kayit("a", "Kahve", an(GUN.toString(), "15:00")), kayit("y", "Kitap", an(gunSonra(1), "11:00")))
        model()
        // Gün değişti, takvim okunamıyor; listeler okunuyor.
        c.sahte.takvimHatasi = IllegalStateException("takvim")
        simdi = SIMDI.plusDays(1).withHour(8)
        val m = d.model()
        assertTrue(m.yuklendi)
        assertNotNull(m.okumaHatasi)
        assertTrue("dünün işleri bugün diye gösterilmez", m.acikler.none { it.kayitId == "a" })
        assertNotNull(d.model().okumaHatasi)
        c.sahte.takvimHatasi = null
        d.degisti(degisim("a"))
        val duzeldi = d.model()
        assertNull(duzeldi.okumaHatasi)
        assertEquals(listOf("y"), duzeldi.acikler.map { it.kayitId })
    }

    /** Bugün'de olmayan kayıt (tarihsiz) ayrıntı için çekirdekten okunur: başlık, yer, levhanın renk kuralı. */
    @Test
    fun ayrintiOzetiCekirdektenOkunur() {
        c.ekle(kayit("t", "Kitap oku"), kayit("s", "Silinmiş", silindi = true))
        model()
        val o = d.ayrintiOzeti("t")!!
        assertEquals("Kitap oku", o.kayit.baslik)
        assertEquals("Tarihsiz", o.yer)
        assertEquals(Gorunus.renkAnahtardan(o.kayit.cizim!!), o.kayit.renk)
        assertNull(d.ayrintiOzeti("s"))
        assertNull(d.ayrintiOzeti("yok"))
    }
}
