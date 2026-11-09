package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DenetimKaydiTest {
    private val saat = SahteSaat()
    private val port = SahteDenetim()
    private val kayit = denetimKaydiKur.kur(port, saat)

    private fun satir(
        duvarMs: Long = 1L,
        olay: DenetimOlayi = DenetimOlayi.KOMUT,
        grantId: String? = null,
        cmdId: String? = null,
        komut: CmdAdi? = null,
        denied: DeniedNeden? = null,
        hata: CihazHatasi? = null,
        grantNedeni: GrantNedeni? = null,
        paket: String? = null,
        kaynak: IzinKaynagi? = null,
    ) = DenetimSatiri(duvarMs, olay, grantId, cmdId, komut, denied, hata, grantNedeni, paket, kaynak)

    // ---- Satır üretimi

    @Test
    fun satirdaMetinAlaniYok() {
        // Yapısal kanıt: ekran/yazılan metin, jeton, başlık, uygulama adı taşıyacak alan yoktur.
        val alanlar = DenetimSatiri::class.java.declaredFields.filter { !it.isSynthetic }.map { it.name }.toSet()
        assertEquals(
            setOf("duvarMs", "olay", "grantId", "cmdId", "komut", "denied", "hata", "grantNedeni", "paket", "kaynak"),
            alanlar,
        )
        // Metin alanları yalnız kimlik/paket: kapalı liste dışında String alan sayısı sabit.
        val stringAlanlar = DenetimSatiri::class.java.declaredFields
            .filter { !it.isSynthetic && it.type == String::class.java }.map { it.name }.toSet()
        assertEquals(setOf("grantId", "cmdId", "paket"), stringAlanlar)
    }

    @Test
    fun komutBirSatirYazar() {
        saat.duvarKur(555L)
        kayit.komut("c1", "g1", CmdAdi.CLICK, DeniedNeden.IZIN_YOK, CihazHatasi.ZAMAN_ASIMI, "com.android.settings")
        assertEquals(
            listOf(
                satir(555L, DenetimOlayi.KOMUT, "g1", "c1", CmdAdi.CLICK, DeniedNeden.IZIN_YOK, CihazHatasi.ZAMAN_ASIMI, null, "com.android.settings"),
            ),
            port.satirlar,
        )
    }

    @Test
    fun komutNullAlanlarlaAdimSifirReddi() {
        kayit.komut("c2", null, null, DeniedNeden.GECERSIZ_ARG, null, null)
        val s = port.satirlar.single()
        assertEquals(DenetimOlayi.KOMUT, s.olay)
        assertEquals("c2", s.cmdId)
        assertNull(s.grantId)
        assertNull(s.komut)
        assertNull(s.paket)
        assertNull(s.grantNedeni)
    }

    @Test
    fun izinVerildiPaketBasinaBirSatir() {
        kayit.izinVerildi("g1", listOf("a.b", "c.d", "e.f"), IzinKaynagi.ONAY)
        val s = port.satirlar
        assertEquals(3, s.size)
        assertEquals(listOf("a.b", "c.d", "e.f"), s.map { it.paket })
        assertTrue(s.all { it.olay == DenetimOlayi.IZIN_VERILDI && it.grantId == "g1" && it.cmdId == null })
        assertTrue(s.all { it.kaynak == IzinKaynagi.ONAY })
    }

    @Test
    fun izinVerildiSatiriKaynagiTasir() {
        saat.duvarKur(777L)
        kayit.izinVerildi("g-oto", listOf("a.b", "c.d"), IzinKaynagi.OTO)
        kayit.izinVerildi("g-onay", listOf("e.f"), IzinKaynagi.ONAY)
        assertEquals(
            listOf(
                satir(777L, DenetimOlayi.IZIN_VERILDI, grantId = "g-oto", paket = "a.b", kaynak = IzinKaynagi.OTO),
                satir(777L, DenetimOlayi.IZIN_VERILDI, grantId = "g-oto", paket = "c.d", kaynak = IzinKaynagi.OTO),
                satir(777L, DenetimOlayi.IZIN_VERILDI, grantId = "g-onay", paket = "e.f", kaynak = IzinKaynagi.ONAY),
            ),
            port.satirlar,
        )
    }

    @Test
    fun kaynakYalnizIzinVerildiSatirinda() {
        kayit.komut("c", "g", CmdAdi.WAIT, null, null, "p")
        kayit.izinVerildi("g", listOf("p"), IzinKaynagi.OTO)
        kayit.izinGeriCekildi("g", GrantNedeni.IS_BITTI)
        kayit.baglantiAcildi()
        kayit.baglantiKoptu()
        for (s in port.satirlar) {
            if (s.olay == DenetimOlayi.IZIN_VERILDI) assertEquals(IzinKaynagi.OTO, s.kaynak) else assertNull(s.kaynak, s.olay.name)
        }
    }

    @Test
    fun izinGeriCekildi() {
        kayit.izinGeriCekildi("g9", GrantNedeni.KULLANICI_DURDURDU)
        val s = port.satirlar.single()
        assertEquals(DenetimOlayi.IZIN_GERI_CEKILDI, s.olay)
        assertEquals("g9", s.grantId)
        assertEquals(GrantNedeni.KULLANICI_DURDURDU, s.grantNedeni)
        assertNull(s.paket)
    }

    @Test
    fun baglantiOlaylari() {
        kayit.baglantiAcildi()
        saat.ilerlet(10)
        kayit.baglantiKoptu()
        val s = port.satirlar
        assertEquals(listOf(DenetimOlayi.BAGLANTI_ACILDI, DenetimOlayi.BAGLANTI_KOPTU), s.map { it.olay })
        assertEquals(10L, s[1].duvarMs - s[0].duvarMs)
        assertTrue(s.all { it.grantId == null && it.cmdId == null && it.komut == null && it.denied == null && it.hata == null && it.grantNedeni == null && it.paket == null })
    }

    @Test
    fun herOlayTuruBirSatirUretir() {
        kayit.komut("c", "g", CmdAdi.WAIT, null, null, "p")
        kayit.izinVerildi("g", listOf("p"), IzinKaynagi.ONAY)
        kayit.izinGeriCekildi("g", GrantNedeni.IS_BITTI)
        kayit.baglantiAcildi()
        kayit.baglantiKoptu()
        assertEquals(DenetimOlayi.entries.toSet(), port.satirlar.map { it.olay }.toSet())
        assertEquals(DenetimOlayi.entries.size, port.satirlar.size)
        assertTrue(port.satirlar.all { it.duvarMs == saat.duvarMs() })
    }

    @Test
    fun bosPaketListesiSatirYazmaz() {
        kayit.izinVerildi("g", emptyList(), IzinKaynagi.OTO)
        assertTrue(port.satirlar.isEmpty())
    }

    // ---- Port ve saat hataları

    private class AtanPort(private val hata: () -> Exception) : DenetimPortu {
        var cagri = 0

        override fun ekle(satir: DenetimSatiri) {
            cagri++
            throw hata()
        }

        override fun izinKimlikleri(): List<String> = emptyList()

        override fun izinKimlikleriniYaz(kimlikler: List<String>) {}
    }

    @Test
    fun portIstisnaAtarsaCagiranCokmez() {
        val hatalar = listOf<() -> Exception>(
            { RuntimeException("x") },
            { java.io.IOException("disk dolu") },
            { IllegalStateException() },
            { UnsupportedOperationException() },
        )
        for (h in hatalar) {
            val p = AtanPort(h)
            val k = denetimKaydiKur.kur(p, saat)
            k.komut("c", "g", CmdAdi.KEY, null, null, "p")
            k.izinVerildi("g", listOf("a", "b"), IzinKaynagi.OTO)
            k.izinGeriCekildi("g", GrantNedeni.IS_IPTAL)
            k.baglantiAcildi()
            k.baglantiKoptu()
            assertTrue(p.cagri >= 4)
        }
    }

    @Test
    fun saatIstisnaAtarsaCagiranCokmez() {
        val bozuk = object : SaatPortu {
            override fun monotonikMs(): Long = 0

            override fun duvarMs(): Long = throw IllegalStateException("saat")

            override fun uyu(ms: Long) {}
        }
        val k = denetimKaydiKur.kur(port, bozuk)
        k.komut("c", null, null, null, null, null)
        k.baglantiAcildi()
        assertTrue(port.satirlar.isEmpty())
    }

    @Test
    fun ilkHatadanSonraSonrakiCagrilarCalisir() {
        var n = 0
        val alinan = ArrayList<DenetimSatiri>()
        val kismen = object : DenetimPortu {
            override fun ekle(satir: DenetimSatiri) {
                if (n++ == 0) throw RuntimeException("ilk")
                alinan.add(satir)
            }

            override fun izinKimlikleri() = emptyList<String>()

            override fun izinKimlikleriniYaz(kimlikler: List<String>) {}
        }
        val k = denetimKaydiKur.kur(kismen, saat)
        k.baglantiAcildi()
        k.baglantiKoptu()
        assertEquals(listOf(DenetimOlayi.BAGLANTI_KOPTU), alinan.map { it.olay })
    }

    // ---- Biçim

    private fun gidisDonus(s: DenetimSatiri) {
        val yazilan = DenetimBicimi.yaz(s)
        assertFalse(yazilan.contains('\n') || yazilan.contains('\r'), "satır sonu sızdı: $yazilan")
        assertEquals(s, DenetimBicimi.coz(yazilan), yazilan)
    }

    @Test
    fun gidisDonusHerOlayVeHerKapaliListeDegeri() {
        for (o in DenetimOlayi.entries) gidisDonus(satir(olay = o))
        for (k in CmdAdi.entries) gidisDonus(satir(komut = k))
        for (d in DeniedNeden.entries) gidisDonus(satir(denied = d))
        for (h in CihazHatasi.entries) gidisDonus(satir(hata = h))
        for (g in GrantNedeni.entries) gidisDonus(satir(grantNedeni = g))
        for (o in DenetimOlayi.entries) for (k in IzinKaynagi.entries) gidisDonus(satir(olay = o, kaynak = k))
        gidisDonus(satir(duvarMs = 0))
        gidisDonus(satir(duvarMs = Long.MAX_VALUE))
        gidisDonus(satir(duvarMs = -5))
        gidisDonus(satir(duvarMs = Long.MIN_VALUE))
    }

    @Test
    fun gidisDonusZorMetinler() {
        val zor = listOf(
            "", "a", "|", "||", "~", "%", "%0041", "%%", "a|b~c%d", "\n", "\r\n", "x\ny", "\u0000",
            "çğıöşüÇĞİÖŞÜ", "com.örnek.uygulama", "paket ~ |", " ", "\t",
            "😀", "a😀b", "\uD83D", "\uDE00", "\uDE00\uD83D", "￿",
            "v1|1|KOMUT|~|~|~|~|~|~|~", "A".repeat(5000), "com.a.b:c-d_e.f",
        )
        for (z in zor) {
            gidisDonus(satir(grantId = z, cmdId = z, paket = z))
            gidisDonus(satir(grantId = z))
            gidisDonus(satir(paket = z))
            gidisDonus(satir(olay = DenetimOlayi.IZIN_VERILDI, grantId = z, paket = z, kaynak = IzinKaynagi.OTO))
        }
    }

    @Test
    fun bosDizeNullDegildir() {
        val s = satir(grantId = "", cmdId = null, paket = "")
        val c = DenetimBicimi.coz(DenetimBicimi.yaz(s))!!
        assertEquals("", c.grantId)
        assertNull(c.cmdId)
        assertEquals("", c.paket)
    }

    @Test
    fun yazilanSatirdaMetinAyiriciSizmaz() {
        val y = DenetimBicimi.yaz(satir(grantId = "a|b", cmdId = "~", paket = "x\ny%"))
        assertEquals(10, y.split('|').size)
        assertTrue(y.startsWith("v1|"))
        assertFalse(y.contains('\n'))
    }

    @Test
    fun kaynakliSatirV2VeOnBirAlan() {
        val oto = DenetimBicimi.yaz(
            satir(duvarMs = 42, olay = DenetimOlayi.IZIN_VERILDI, grantId = "g1", paket = "com.a|b", kaynak = IzinKaynagi.OTO),
        )
        assertEquals("v2|42|IZIN_VERILDI|g1|~|~|~|~|~|com.a%007Cb|OTO", oto)
        assertEquals(11, oto.split('|').size)
        val onay = DenetimBicimi.yaz(satir(duvarMs = 1, olay = DenetimOlayi.IZIN_VERILDI, grantId = "g", paket = "p", kaynak = IzinKaynagi.ONAY))
        assertEquals("v2|1|IZIN_VERILDI|g|~|~|~|~|~|p|ONAY", onay)
        // Kaynaksız satır bayt bayt eski biçimde kalır.
        assertEquals(
            "v1|1|IZIN_VERILDI|g|~|~|~|~|~|p",
            DenetimBicimi.yaz(satir(duvarMs = 1, olay = DenetimOlayi.IZIN_VERILDI, grantId = "g", paket = "p")),
        )
    }

    @Test
    fun eskiV1IzinSatiriKaynaksizOkunurVeAynenYazilir() {
        val eski = "v1|1730000000000|IZIN_VERILDI|gAbC-_9|~|~|~|~|~|com.ornek.mesaj"
        val c = DenetimBicimi.coz(eski)!!
        assertEquals(DenetimOlayi.IZIN_VERILDI, c.olay)
        assertEquals("gAbC-_9", c.grantId)
        assertEquals("com.ornek.mesaj", c.paket)
        assertNull(c.kaynak)
        assertEquals(eski, DenetimBicimi.yaz(c))
    }

    @Test
    fun bozukKaynakliSatirlardaNull() {
        val v2 = DenetimBicimi.yaz(satir(duvarMs = 9, olay = DenetimOlayi.IZIN_VERILDI, grantId = "g", paket = "p", kaynak = IzinKaynagi.OTO))
        val a = v2.split('|')
        fun degis(i: Int, v: String) = a.toMutableList().also { it[i] = v }.joinToString("|")
        val bozuklar = listOf(
            // kaynak alanı v2'de zorunlu ve yalnız enum adı
            degis(10, "~"), degis(10, ""), degis(10, "oto"), degis(10, "Oto"), degis(10, "OTO "), degis(10, "BILINMEYEN"),
            degis(10, "%004FTO"),
            // sürüm ve alan sayısı birbirini tutmalı
            degis(0, "v1"), degis(0, "v3"), degis(0, "V2"),
            a.dropLast(1).joinToString("|"),
            "$v2|OTO", "$v2|", "$v2|~",
            "v1|9|IZIN_VERILDI|g|~|~|~|~|~|p|OTO",
            "v1|9|IZIN_VERILDI|g|~|~|~|~|~|p|~",
            "v2|9|IZIN_VERILDI|g|~|~|~|~|~|p",
        )
        for (b in bozuklar) assertNull(DenetimBicimi.coz(b), "kabul edildi: '$b'")
        assertNotNull(DenetimBicimi.coz(v2))
        assertNotNull(DenetimBicimi.coz(degis(10, "ONAY")))
    }

    @Test
    fun kaydinUrettigiSatirlarBicimdenGecer() {
        kayit.komut("c|1", "g~1", CmdAdi.TYPE_TEXT, DeniedNeden.METIN_KILIDI, null, "çalışan\npaket")
        kayit.izinVerildi("g", listOf("a%b", "😀"), IzinKaynagi.OTO)
        for (s in port.satirlar) assertEquals(s, DenetimBicimi.coz(DenetimBicimi.yaz(s)))
    }

    private val temel = DenetimBicimi.yaz(satir(duvarMs = 42, grantId = "g1", cmdId = "c1", komut = CmdAdi.CLICK, paket = "p.q"))

    @Test
    fun temelSatirCozulur() {
        assertNotNull(DenetimBicimi.coz(temel))
    }

    @Test
    fun bozukSatirlardaNull() {
        val a = temel.split('|')
        fun degis(i: Int, v: String) = a.toMutableList().also { it[i] = v }.joinToString("|")

        val bozuklar = listOf(
            "", "|", "v1", "v1|", "garbage", "\n", temel + "\n", "\n" + temel,
            degis(0, "v2"), degis(0, "V1"), degis(0, "v0"), degis(0, ""), degis(0, "v1 "),
            a.drop(1).joinToString("|"),
            a.dropLast(1).joinToString("|"),
            temel + "|~", "$temel|",
            // sayı kanonik değil
            degis(1, "042"), degis(1, "+42"), degis(1, "42.0"), degis(1, "4e1"), degis(1, "-0"), degis(1, " 42"), degis(1, "42 "),
            degis(1, ""), degis(1, "~"), degis(1, "abc"), degis(1, "9223372036854775808"), degis(1, "0x2A"),
            // bilinmeyen enum
            degis(2, "BILINMEYEN"), degis(2, "komut"), degis(2, "Komut"), degis(2, ""), degis(2, "~"),
            degis(5, "click_"), degis(5, "CLICK"), degis(5, "bilinmeyen"), degis(5, ""),
            degis(6, "izin_yok2"), degis(6, "IZIN_YOK"), degis(7, "yok"), degis(8, "yok"), degis(8, ""),
            // kaçış hataları
            degis(3, "%"), degis(3, "%00"), degis(3, "%00ZZ"), degis(3, "%00zz"), degis(3, "%0041"),
            degis(3, "a%"), degis(3, "%000a"),
            degis(4, "a b"), degis(4, "ç"), degis(4, "a\tb"), degis(4, "a\rb"),
            degis(9, "a/b"), degis(9, "a%2Fb"), degis(9, "~~"), degis(9, "a~"),
        )
        for (b in bozuklar) assertNull(DenetimBicimi.coz(b), "kabul edildi: '" + b.replace("\n", "\\n") + "'")
    }

    @Test
    fun cozKeyfiGirdideIstisnaAtmaz() {
        val girdiler = listOf(
            "|".repeat(9), "|".repeat(10), "|".repeat(100_000), "%".repeat(10_000),
            "v1|" + "%".repeat(50) + "|~|~|~|~|~|~|~",
            "\uD800", "v1|1|KOMUT|%D83|~|~|~|~|~|~", "v1|99999999999999999999|KOMUT|~|~|~|~|~|~|~",
            "v1|1|KOMUT|%FFFF|~|~|~|~|~|~", "\u0000", "v1|1|KOMUT|~|~|~|~|~|~|😀",
            "v2|" + "|".repeat(9), "v2|1|IZIN_VERILDI|~|~|~|~|~|~|~|" + "O".repeat(10_000), "v2|1|KOMUT|~|~|~|~|~|~|~|😀",
        )
        for (g in girdiler) DenetimBicimi.coz(g)
        val rnd = java.util.Random(12345)
        val alfabe = "v1|~%0123456789ABCDEFKOMUT_-.:\n çÇ"
        repeat(3000) {
            val len = rnd.nextInt(60)
            val m = buildString { repeat(len) { append(alfabe[rnd.nextInt(alfabe.length)]) } }
            val c = DenetimBicimi.coz(m)
            // kabul edilen her satır kayıpsız yeniden yazılır (tek biçim)
            if (c != null) assertEquals(m, DenetimBicimi.yaz(c))
        }
    }

    @Test
    fun tekBicimYazCozYaz() {
        val s = satir(
            duvarMs = 7, grantId = "ç|", cmdId = "~", komut = CmdAdi.KEY, denied = DeniedNeden.MESGUL,
            hata = CihazHatasi.EYLEM_BASARISIZ, grantNedeni = GrantNedeni.IS_BITTI, paket = "😀",
        )
        val y = DenetimBicimi.yaz(s)
        assertEquals(y, DenetimBicimi.yaz(DenetimBicimi.coz(y)!!))
    }
}
