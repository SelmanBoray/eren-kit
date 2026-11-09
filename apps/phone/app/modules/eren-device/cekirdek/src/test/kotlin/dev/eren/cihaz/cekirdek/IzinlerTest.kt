package dev.eren.cihaz.cekirdek

import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue

/** Saldırgan PC gözüyle `Izinler`: çıktılar yalnız kapalı liste, jeton yalnız bellekte. */
class IzinlerTest {
    private inline fun <reified T : Any> assertIs(v: Any?): T = assertInstanceOf(T::class.java, v)

    /** Çağrıları metin olarak biriktirir ve satırı `SahteDenetim`'e de yazar: jeton taraması için. */
    private class KayitliDenetim(private val port: SahteDenetim, private val saat: SaatPortu) : DenetimKaydi {
        val cagrilar = ArrayList<String>()

        override fun komut(
            cmdId: String,
            grantId: String?,
            komut: CmdAdi?,
            denied: DeniedNeden?,
            hata: CihazHatasi?,
            paket: String?,
        ) {
            cagrilar.add("komut $cmdId $grantId $komut $denied $hata $paket")
            port.ekle(DenetimSatiri(saat.duvarMs(), DenetimOlayi.KOMUT, grantId, cmdId, komut, denied, hata, null, paket))
        }

        override fun izinVerildi(grantId: String, paketler: List<String>, kaynak: IzinKaynagi) {
            cagrilar.add("verildi $grantId $paketler $kaynak")
            paketler.forEach {
                port.ekle(DenetimSatiri(saat.duvarMs(), DenetimOlayi.IZIN_VERILDI, grantId, null, null, null, null, null, it, kaynak))
            }
        }

        override fun izinGeriCekildi(grantId: String, neden: GrantNedeni) {
            cagrilar.add("geri $grantId $neden")
            port.ekle(DenetimSatiri(saat.duvarMs(), DenetimOlayi.IZIN_GERI_CEKILDI, grantId, null, null, null, null, neden, null))
        }

        override fun baglantiAcildi() {
            cagrilar.add("acildi")
        }

        override fun baglantiKoptu() {
            cagrilar.add("koptu")
        }
    }

    private class Ortam(
        val saat: SahteSaat = SahteSaat(),
        val rastgele: SahteRastgele = SahteRastgele(7L),
        val disk: SahteDenetim = SahteDenetim(),
    ) {
        val kayit = KayitliDenetim(disk, saat)
        val izinler: Izinler = izinlerKur.kur(saat, rastgele, disk, kayit)
    }

    private val uyg = listOf(IzinliUygulama("com.ornek.a", "A"))

    private fun onay(
        mod: IzinModu = IzinModu.OKU,
        uygulamalar: List<IzinliUygulama> = uyg,
        metin: List<String> = emptyList(),
        serbest: Boolean = false,
        sureMs: Long = 60_000L,
        butce: Int = 10,
    ) = OnayliIzin("plan1", "h".repeat(64), mod, uygulamalar, metin, serbest, sureMs, butce)

    private fun Ortam.ver(o: OnayliIzin = onay()): IzinKaydi = izinler.ekle(o)!!

    private fun ret(b: IzinBulgusu): DeniedNeden = assertIs<IzinBulgusu.Gecersiz>(b).neden

    private fun gecerli(b: IzinBulgusu): IzinBulgusu.Gecerli = assertIs<IzinBulgusu.Gecerli>(b)

    // ---- kimlik ve jeton ----

    @Test
    fun bilinmeyenGrantIzinYok() {
        val o = Ortam()
        val k = o.ver()
        assertEquals(DeniedNeden.IZIN_YOK, ret(o.izinler.bul("g-yok", k.token)))
        assertEquals(DeniedNeden.IZIN_YOK, ret(o.izinler.bul("", "")))
        assertEquals(Harcama.Ret(DeniedNeden.IZIN_YOK), o.izinler.harca("g-yok", null))
    }

    @Test
    fun yanlisJetonlarHepJetonYanlis() {
        val o = Ortam()
        val a = o.ver()
        val b = o.ver()
        val t = a.token
        val bir = if (t.last() == 'A') 'B' else 'A'
        val tersHarf = t.map { if (it.isUpperCase()) it.lowercaseChar() else it.uppercaseChar() }.joinToString("")
        assertNotEquals(t, tersHarf)
        val adaylar = listOf(
            "baska izin" to b.token,
            "onek" to t.dropLast(1),
            "kisa onek" to t.take(8),
            "sonuna ekli" to t + "x",
            "son harf" to t.dropLast(1) + bir,
            "ilk harf" to bir + t.drop(1),
            "buyuk kucuk" to tersHarf,
            "bos" to "",
            "bosluklu" to " $t",
        )
        for ((ad, aday) in adaylar) {
            assertEquals(DeniedNeden.JETON_YANLIS, ret(o.izinler.bul(a.grantId, aday)), ad)
        }
        gecerli(o.izinler.bul(a.grantId, t))
        gecerli(o.izinler.bul(b.grantId, b.token))
    }

    @Test
    fun yanlisJetonBulBirSeyDusurmez() {
        val o = Ortam()
        val k = o.ver(onay(butce = 5))
        repeat(20) { o.izinler.bul(k.grantId, "yanlis") }
        assertEquals(5, gecerli(o.izinler.bul(k.grantId, k.token)).izin.kalanButce)
        assertEquals(1, o.izinler.aktifler().size)
    }

    @Test
    fun grantIdVeJetonRastgelePorttan() {
        val r = SahteRastgele(1L)
        val tokenBaytlari = ByteArray(CekirdekSinirlari.JETON_BAYT) { (it + 1).toByte() }
        val o = Ortam(rastgele = r)
        r.siradaki(tokenBaytlari)
        val k = o.ver()
        assertEquals(CekirdekSinirlari.JETON_BAYT, r.istekler.first())
        assertTrue(r.istekler.size >= 2, "grant_id için de istek bekleniyor")
        assertTrue(r.istekler.all { it > 0 })
        assertTrue(Base64.getUrlDecoder().decode(k.token).contentEquals(tokenBaytlari))
        val k2 = o.ver()
        assertNotEquals(k.token, k2.token)
        assertNotEquals(k.grantId, k2.grantId)
        assertTrue(k.grantId.isNotEmpty() && k.grantId.length <= Sinirlar.OPAK_ID)
    }

    @Test
    fun portKisaBaytVerirseEkleNull() {
        val saat = SahteSaat()
        val disk = SahteDenetim()
        val kisa = object : RastgelePortu {
            override fun baytlar(adet: Int) = ByteArray(adet - 1)
        }
        val iz = izinlerKur.kur(saat, kisa, disk, KayitliDenetim(disk, saat))
        assertNull(iz.ekle(onay()))
        assertTrue(iz.aktifler().isEmpty())
    }

    @Test
    fun ayniGrantIdYenidenUretilirseCakismaKabulEdilmez() {
        val r = SahteRastgele(1L)
        val o = Ortam(rastgele = r)
        val sabitJeton = ByteArray(32) { 1 }
        val sabitId = ByteArray(16) { 2 }
        r.siradaki(sabitJeton, sabitId)
        val ilk = o.ver()
        r.siradaki(sabitJeton, sabitId)
        val ikinci = o.izinler.ekle(onay())
        if (ikinci != null) assertNotEquals(ilk.grantId, ikinci.grantId)
        assertEquals(1, o.izinler.aktifler().count { it.kayit.grantId == ilk.grantId })
    }

    // ---- ekle doğrulaması ----

    @Test
    fun ekleSinirDisiGirdiyiReddeder() {
        val o = Ortam()
        assertNull(o.izinler.ekle(onay(sureMs = 0)))
        assertNull(o.izinler.ekle(onay(sureMs = -1)))
        assertNull(o.izinler.ekle(onay(sureMs = CekirdekSinirlari.AZAMI_SURE_MS + 1)))
        assertNull(o.izinler.ekle(onay(butce = 0)))
        assertNull(o.izinler.ekle(onay(butce = CekirdekSinirlari.AZAMI_BUTCE + 1)))
        assertNull(o.izinler.ekle(onay(uygulamalar = emptyList())))
        val iki = listOf(IzinliUygulama("com.a.b", "A"), IzinliUygulama("com.c.d", "C"))
        assertNull(o.izinler.ekle(onay(mod = IzinModu.YAZ, uygulamalar = iki)))
        assertTrue(o.izinler.aktifler().isEmpty())
        assertTrue(o.disk.kimlikYazimlari.isEmpty(), "reddedilen ekle diske yazmaz")
        assertTrue(o.kayit.cagrilar.isEmpty(), "reddedilen ekle denetim satiri uretmez")
    }

    @Test
    fun ekleSinirDegerleriniKabulEder() {
        val o = Ortam()
        assertEquals(1, o.izinler.ekle(onay(sureMs = 1, butce = 1))!!.kalanButce)
        val ust = o.izinler.ekle(onay(sureMs = CekirdekSinirlari.AZAMI_SURE_MS, butce = CekirdekSinirlari.AZAMI_BUTCE))
        assertEquals(CekirdekSinirlari.AZAMI_BUTCE, ust!!.kalanButce)
        assertEquals(o.saat.monotonikMs() + CekirdekSinirlari.AZAMI_SURE_MS, ust.bitisMonotonikMs)
        assertIs<IzinKaydi>(o.izinler.ekle(onay(mod = IzinModu.YAZ)))
        val iki = listOf(IzinliUygulama("com.a.b", "A"), IzinliUygulama("com.c.d", "C"))
        assertIs<IzinKaydi>(o.izinler.ekle(onay(mod = IzinModu.OKU, uygulamalar = iki)))
    }

    // ---- kaynak (onay ekranı / tam yetki altında otomatik) ----

    @Test
    fun kaynakVarsayilaniOnayVeKaydaGecer() {
        val o = Ortam()
        // Mevcut çağıranlar (OnayActivity) kaynak vermez: varsayılan ONAY.
        val ham = OnayliIzin("plan1", "h".repeat(64), IzinModu.OKU, uyg, emptyList(), false, 60_000L, 10)
        assertEquals(IzinKaynagi.ONAY, ham.kaynak)
        val k = o.ver(ham)
        assertEquals(IzinKaynagi.ONAY, k.kaynak)
        assertEquals(IzinKaynagi.ONAY, gecerli(o.izinler.bul(k.grantId, k.token)).izin.kaynak)
        assertEquals(IzinKaynagi.ONAY, o.izinler.aktifler().single().kayit.kaynak)
        assertEquals(listOf("verildi ${k.grantId} [com.ornek.a] ONAY"), o.kayit.cagrilar)
        assertEquals(listOf(IzinKaynagi.ONAY), o.disk.olaylar(DenetimOlayi.IZIN_VERILDI).map { it.kaynak })
    }

    @Test
    fun otoKaynakliIzinKaydaVeHerDenetimSatirinaGecer() {
        val o = Ortam()
        val iki = listOf(IzinliUygulama("com.a.b", "A"), IzinliUygulama("com.c.d", "C"))
        val k = o.ver(onay(uygulamalar = iki, butce = 5).copy(kaynak = IzinKaynagi.OTO))
        assertEquals(IzinKaynagi.OTO, k.kaynak)
        assertEquals(IzinKaynagi.OTO, gecerli(o.izinler.bul(k.grantId, k.token)).izin.kaynak)
        assertEquals(IzinKaynagi.OTO, o.izinler.aktifler().single().kayit.kaynak)
        // Kaynak davranışı değiştirmez: harcama ve anlık kopya aynı, kaynak korunur.
        assertEquals(Harcama.Tamam(4), o.izinler.harca(k.grantId, null))
        val sonra = gecerli(o.izinler.bul(k.grantId, k.token)).izin
        assertEquals(4, sonra.kalanButce)
        assertEquals(IzinKaynagi.OTO, sonra.kaynak)

        assertEquals(listOf("verildi ${k.grantId} [com.a.b, com.c.d] OTO"), o.kayit.cagrilar)
        val satirlar = o.disk.olaylar(DenetimOlayi.IZIN_VERILDI)
        assertEquals(listOf("com.a.b", "com.c.d"), satirlar.map { it.paket })
        assertTrue(satirlar.all { it.grantId == k.grantId && it.kaynak == IzinKaynagi.OTO })
    }

    @Test
    fun otoKaynakSinirDenetiminiAsamaz() {
        val o = Ortam()
        fun oto(x: OnayliIzin) = o.izinler.ekle(x.copy(kaynak = IzinKaynagi.OTO))
        assertNull(oto(onay(sureMs = 0)))
        assertNull(oto(onay(sureMs = CekirdekSinirlari.AZAMI_SURE_MS + 1)))
        assertNull(oto(onay(butce = 0)))
        assertNull(oto(onay(butce = CekirdekSinirlari.AZAMI_BUTCE + 1)))
        assertNull(oto(onay(uygulamalar = emptyList())))
        val iki = listOf(IzinliUygulama("com.a.b", "A"), IzinliUygulama("com.c.d", "C"))
        assertNull(oto(onay(mod = IzinModu.YAZ, uygulamalar = iki)))
        assertTrue(o.izinler.aktifler().isEmpty())
        assertTrue(o.kayit.cagrilar.isEmpty())
        assertTrue(o.disk.satirlar.isEmpty())
    }

    @Test
    fun ayniGirdideKaynakDisindaKayitAyni() {
        val a = Ortam(rastgele = SahteRastgele(9L))
        val b = Ortam(rastgele = SahteRastgele(9L))
        val onayli = a.ver(onay(mod = IzinModu.YAZ, metin = listOf("x")))
        val oto = b.ver(onay(mod = IzinModu.YAZ, metin = listOf("x")).copy(kaynak = IzinKaynagi.OTO))
        assertEquals(onayli.copy(kaynak = IzinKaynagi.OTO), oto)
    }

    @Test
    fun gercekDenetimKaydiylaOtoSatiriKaynakliBicimdeYazilir() {
        val saat = SahteSaat()
        val disk = SahteDenetim()
        val iz = izinlerKur.kur(saat, SahteRastgele(5L), disk, denetimKaydiKur.kur(disk, saat))
        val oto = iz.ekle(onay().copy(kaynak = IzinKaynagi.OTO))!!
        val onayli = iz.ekle(onay())!!
        iz.geriCek(oto.grantId, GrantNedeni.KULLANICI_DURDURDU)

        val verildi = disk.olaylar(DenetimOlayi.IZIN_VERILDI)
        assertEquals(listOf(oto.grantId to IzinKaynagi.OTO, onayli.grantId to IzinKaynagi.ONAY), verildi.map { it.grantId to it.kaynak })
        val geri = disk.olaylar(DenetimOlayi.IZIN_GERI_CEKILDI).single()
        assertNull(geri.kaynak, "kaynak yalnız izin verildi satırında")

        val otoMetni = DenetimBicimi.yaz(verildi[0])
        assertTrue(otoMetni.startsWith("v2|") && otoMetni.endsWith("|com.ornek.a|OTO"), otoMetni)
        assertTrue(DenetimBicimi.yaz(verildi[1]).endsWith("|com.ornek.a|ONAY"))
        assertTrue(DenetimBicimi.yaz(geri).startsWith("v1|"))
        for (s in disk.satirlar) {
            val metin = DenetimBicimi.yaz(s)
            assertEquals(s, DenetimBicimi.coz(metin))
            for (j in listOf(oto.token, onayli.token)) assertFalse(metin.contains(j.take(16)), "jeton sizdi: $metin")
        }
    }

    // ---- geri çekme ve mezar taşı ----

    @Test
    fun geriCekilenIzinGeriCekildiDer() {
        val o = Ortam()
        val k = o.ver()
        assertEquals(listOf(k.grantId), o.izinler.geriCek(k.grantId, GrantNedeni.KULLANICI_DURDURDU))
        assertEquals(DeniedNeden.IZIN_GERI_CEKILDI, ret(o.izinler.bul(k.grantId, k.token)))
        assertEquals(DeniedNeden.IZIN_GERI_CEKILDI, ret(o.izinler.bul(k.grantId, "yanlis")))
        assertEquals(Harcama.Ret(DeniedNeden.IZIN_GERI_CEKILDI), o.izinler.harca(k.grantId, null))
        assertTrue(o.izinler.aktifler().isEmpty())
        assertEquals(emptyList<String>(), o.izinler.geriCek(k.grantId, GrantNedeni.IS_BITTI), "ikinci cekme bos")
        assertEquals(emptyList<String>(), o.izinler.geriCek("g-yok", GrantNedeni.IS_BITTI))
    }

    @Test
    fun hepsiniGeriCekVeSadeceBirini() {
        val o = Ortam()
        val a = o.ver()
        val b = o.ver()
        val c = o.ver()
        assertEquals(listOf(b.grantId), o.izinler.geriCek(b.grantId, GrantNedeni.IS_IPTAL))
        gecerli(o.izinler.bul(a.grantId, a.token))
        assertEquals(setOf(a.grantId, c.grantId), o.izinler.geriCek(null, GrantNedeni.ERISILEBILIRLIK_KAPANDI).toSet())
        assertTrue(o.izinler.aktifler().isEmpty())
        for (k in listOf(a, b, c)) assertEquals(DeniedNeden.IZIN_GERI_CEKILDI, ret(o.izinler.bul(k.grantId, k.token)))
        assertEquals(emptyList<String>(), o.izinler.geriCek(null, GrantNedeni.LIMIT_KILIT))
    }

    @Test
    fun mezarTasiTasmaSinirindaEnEskiDuser() {
        // Bellek şişmesin diye kayıt tutmayan port ve denetim.
        val port = object : DenetimPortu {
            override fun ekle(satir: DenetimSatiri) = Unit
            override fun izinKimlikleri(): List<String> = emptyList()
            override fun izinKimlikleriniYaz(kimlikler: List<String>) = Unit
        }
        val bos = object : DenetimKaydi {
            override fun komut(
                cmdId: String,
                grantId: String?,
                komut: CmdAdi?,
                denied: DeniedNeden?,
                hata: CihazHatasi?,
                paket: String?,
            ) = Unit

            override fun izinVerildi(grantId: String, paketler: List<String>, kaynak: IzinKaynagi) = Unit
            override fun izinGeriCekildi(grantId: String, neden: GrantNedeni) = Unit
            override fun baglantiAcildi() = Unit
            override fun baglantiKoptu() = Unit
        }
        val iz = izinlerKur.kur(SahteSaat(), SahteRastgele(3L), port, bos)
        val sinir = 10_000
        val kimlikler = ArrayList<String>()
        for (i in 0..sinir) {
            val k = iz.ekle(onay(butce = 1))!!
            kimlikler.add(k.grantId)
            iz.geriCek(k.grantId, GrantNedeni.IS_BITTI)
        }
        assertEquals(DeniedNeden.IZIN_YOK, ret(iz.bul(kimlikler.first(), "x")), "en eski mezar taşı düşer")
        assertEquals(DeniedNeden.IZIN_GERI_CEKILDI, ret(iz.bul(kimlikler[1], "x")))
        assertEquals(DeniedNeden.IZIN_GERI_CEKILDI, ret(iz.bul(kimlikler.last(), "x")))
        assertEquals(Harcama.Ret(DeniedNeden.IZIN_YOK), iz.harca(kimlikler.first(), null))
    }

    // ---- süre ----

    @Test
    fun sureMonotonikSaatleBiter() {
        val o = Ortam()
        val k = o.ver(onay(sureMs = 1_000))
        o.saat.ilerlet(999)
        gecerli(o.izinler.bul(k.grantId, k.token))
        o.saat.ilerlet(1)
        assertEquals(DeniedNeden.IZIN_SURESI_BITTI, ret(o.izinler.bul(k.grantId, k.token)))
        assertEquals(Harcama.Ret(DeniedNeden.IZIN_SURESI_BITTI), o.izinler.harca(k.grantId, null))
        assertTrue(o.izinler.aktifler().isEmpty())
    }

    @Test
    fun duvarSaatiGeriOynasaSureUzamaz() {
        val o = Ortam()
        val k = o.ver(onay(sureMs = 1_000))
        o.saat.duvarSapmasi(-10 * 3_600_000L)
        o.saat.ilerlet(1_000)
        o.saat.duvarSapmasi(-86_400_000L)
        assertEquals(DeniedNeden.IZIN_SURESI_BITTI, ret(o.izinler.bul(k.grantId, k.token)))
        assertEquals(listOf(k.grantId), o.izinler.suresiGecenler())
    }

    @Test
    fun duvarSaatiIleriAlinincaSureKisalmaz() {
        val o = Ortam()
        val k = o.ver(onay(sureMs = 600_000))
        o.saat.duvarSapmasi(100 * 86_400_000L)
        gecerli(o.izinler.bul(k.grantId, k.token))
        assertEquals(600_000L, o.izinler.aktifler().single().kalanMs)
        assertTrue(o.izinler.suresiGecenler().isEmpty())
    }

    @Test
    fun kalanSureMonotonikFarktanGelir() {
        val o = Ortam()
        o.ver(onay(sureMs = 10_000))
        o.saat.ilerlet(4_000)
        assertEquals(6_000L, o.izinler.aktifler().single().kalanMs)
    }

    @Test
    fun suresiGecenlerHerKimligiBirKezVerir() {
        val o = Ortam()
        val kisa = o.ver(onay(sureMs = 1_000))
        val uzun = o.ver(onay(sureMs = 100_000))
        assertTrue(o.izinler.suresiGecenler().isEmpty())
        o.saat.ilerlet(1_000)
        assertEquals(listOf(kisa.grantId), o.izinler.suresiGecenler())
        assertTrue(o.izinler.suresiGecenler().isEmpty())
        assertEquals(DeniedNeden.IZIN_SURESI_BITTI, ret(o.izinler.bul(kisa.grantId, kisa.token)))
        assertEquals(listOf(uzun.grantId), o.izinler.aktifler().map { it.kayit.grantId })
        assertEquals(listOf(uzun.grantId), o.disk.kimlikYazimlari.last())
    }

    @Test
    fun suresiBitmisIzindeYanlisJetonOnceJetonYanlis() {
        val o = Ortam()
        val k = o.ver(onay(sureMs = 1_000))
        o.saat.ilerlet(5_000)
        assertEquals(DeniedNeden.JETON_YANLIS, ret(o.izinler.bul(k.grantId, "yanlis")))
    }

    // ---- bütçe ----

    @Test
    fun butceTamSinirdaNinciGecerNArtiBirButceDolar() {
        val o = Ortam()
        val k = o.ver(onay(butce = 3))
        assertEquals(Harcama.Tamam(2), o.izinler.harca(k.grantId, null))
        assertEquals(Harcama.Tamam(1), o.izinler.harca(k.grantId, null))
        assertEquals(Harcama.Tamam(0), o.izinler.harca(k.grantId, null))
        assertEquals(Harcama.Ret(DeniedNeden.BUTCE_DOLDU), o.izinler.harca(k.grantId, null))
        assertEquals(Harcama.Ret(DeniedNeden.BUTCE_DOLDU), o.izinler.harca(k.grantId, null))
        assertEquals(0, gecerli(o.izinler.bul(k.grantId, k.token)).izin.kalanButce)
    }

    @Test
    fun retlerButceYemez() {
        val o = Ortam()
        val k = o.ver(onay(mod = IzinModu.YAZ, metin = listOf("merhaba"), butce = 4))
        o.izinler.bul(k.grantId, "yanlis")
        assertEquals(Harcama.Ret(DeniedNeden.METIN_KILIDI), o.izinler.harca(k.grantId, "baska"))
        assertEquals(Harcama.Ret(DeniedNeden.IZIN_YOK), o.izinler.harca("g-yok", null))
        assertEquals(4, gecerli(o.izinler.bul(k.grantId, k.token)).izin.kalanButce)
        assertEquals(Harcama.Tamam(3), o.izinler.harca(k.grantId, null))
    }

    @Test
    fun suresiBitenVeGeriCekilenIzinButceHarcamaz() {
        val o = Ortam()
        val k = o.ver(onay(sureMs = 100, butce = 5))
        o.saat.ilerlet(100)
        assertEquals(Harcama.Ret(DeniedNeden.IZIN_SURESI_BITTI), o.izinler.harca(k.grantId, null))
        val j = o.ver(onay(butce = 5))
        o.izinler.geriCek(j.grantId, GrantNedeni.IS_IPTAL)
        assertEquals(Harcama.Ret(DeniedNeden.IZIN_GERI_CEKILDI), o.izinler.harca(j.grantId, null))
    }

    // ---- izinli metin ----

    @Test
    fun izinliMetinMaddesiTekKullanim() {
        val o = Ortam()
        val k = o.ver(onay(mod = IzinModu.YAZ, metin = listOf("merhaba", "dunya"), butce = 10))
        assertEquals(Harcama.Tamam(9), o.izinler.harca(k.grantId, "merhaba"))
        assertEquals(setOf(0), gecerli(o.izinler.bul(k.grantId, k.token)).kullanilanMaddeler)
        assertEquals(Harcama.Ret(DeniedNeden.METIN_KILIDI), o.izinler.harca(k.grantId, "merhaba"))
        assertEquals(9, gecerli(o.izinler.bul(k.grantId, k.token)).izin.kalanButce)
        assertEquals(Harcama.Tamam(8), o.izinler.harca(k.grantId, "dunya"))
        assertEquals(setOf(0, 1), gecerli(o.izinler.bul(k.grantId, k.token)).kullanilanMaddeler)
    }

    @Test
    fun metinBirebirEslesmeIster() {
        val o = Ortam()
        val k = o.ver(onay(mod = IzinModu.YAZ, metin = listOf("Merhaba"), butce = 10))
        for (aday in listOf("merhaba", "Merhaba ", " Merhaba", "Merhab", "MERHABA", "")) {
            assertEquals(Harcama.Ret(DeniedNeden.METIN_KILIDI), o.izinler.harca(k.grantId, aday), "[$aday]")
        }
        assertEquals(10, gecerli(o.izinler.bul(k.grantId, k.token)).izin.kalanButce)
        assertEquals(Harcama.Tamam(9), o.izinler.harca(k.grantId, "Merhaba"))
    }

    @Test
    fun ayniMetinIkiMaddeIseIkiKezGecer() {
        val o = Ortam()
        val k = o.ver(onay(mod = IzinModu.YAZ, metin = listOf("a", "a"), butce = 10))
        assertEquals(Harcama.Tamam(9), o.izinler.harca(k.grantId, "a"))
        assertEquals(Harcama.Tamam(8), o.izinler.harca(k.grantId, "a"))
        assertEquals(Harcama.Ret(DeniedNeden.METIN_KILIDI), o.izinler.harca(k.grantId, "a"))
        assertEquals(setOf(0, 1), gecerli(o.izinler.bul(k.grantId, k.token)).kullanilanMaddeler)
    }

    @Test
    fun metinsizHarcamaMaddeYemez() {
        val o = Ortam()
        val k = o.ver(onay(mod = IzinModu.YAZ, metin = listOf("a"), butce = 10))
        o.izinler.harca(k.grantId, null)
        assertTrue(gecerli(o.izinler.bul(k.grantId, k.token)).kullanilanMaddeler.isEmpty())
        assertEquals(Harcama.Tamam(8), o.izinler.harca(k.grantId, "a"))
    }

    @Test
    fun serbestMetindeMaddeHarcanmazButceDuser() {
        val o = Ortam()
        val k = o.ver(onay(mod = IzinModu.YAZ, metin = listOf("a"), serbest = true, butce = 3))
        repeat(3) { i ->
            assertEquals(Harcama.Tamam(2 - i), o.izinler.harca(k.grantId, "listede-olmayan metin"))
        }
        assertEquals(Harcama.Ret(DeniedNeden.BUTCE_DOLDU), o.izinler.harca(k.grantId, "a"))
        assertTrue(gecerli(o.izinler.bul(k.grantId, k.token)).kullanilanMaddeler.isEmpty())
    }

    @Test
    fun butceDolunMaddeHarcanmaz() {
        val o = Ortam()
        val k = o.ver(onay(mod = IzinModu.YAZ, metin = listOf("a", "b"), butce = 1))
        assertEquals(Harcama.Tamam(0), o.izinler.harca(k.grantId, "a"))
        assertEquals(Harcama.Ret(DeniedNeden.BUTCE_DOLDU), o.izinler.harca(k.grantId, "b"))
        assertEquals(setOf(0), gecerli(o.izinler.bul(k.grantId, k.token)).kullanilanMaddeler)
    }

    // ---- jeton sızıntısı ve disk ----

    @Test
    fun jetonHicbirDenetimSatiriVeDiskListesindeGecmez() {
        val o = Ortam()
        val a = o.ver(onay(mod = IzinModu.YAZ, metin = listOf("x"), butce = 5))
        val b = o.ver(onay(butce = 5))
        o.izinler.harca(a.grantId, "x")
        o.izinler.harca(b.grantId, null)
        o.izinler.bul(a.grantId, "yanlis")
        o.saat.ilerlet(10_000_000)
        o.izinler.suresiGecenler()
        val c = o.ver()
        o.izinler.geriCek(c.grantId, GrantNedeni.KULLANICI_DURDURDU)
        o.izinler.geriCek(null, GrantNedeni.LIMIT_KILIT)

        val taranacak = buildList {
            o.disk.satirlar.forEach { add(it.toString()) }
            o.disk.kimlikYazimlari.forEach { add(it.toString()) }
            addAll(o.disk.izinKimlikleri())
            addAll(o.kayit.cagrilar)
        }
        assertTrue(o.disk.satirlar.isNotEmpty() && o.disk.kimlikYazimlari.isNotEmpty())
        assertTrue(taranacak.any { it.contains(a.grantId) }, "tarama bos degil: kimlik gorunmeli")
        for (jeton in listOf(a.token, b.token, c.token)) {
            val parca = jeton.take(16)
            for (s in taranacak) assertFalse(s.contains(parca), "jeton sizdi: $s")
        }
    }

    @Test
    fun diskListesiJetonsuzVeAktiflerleAyni() {
        val o = Ortam()
        val a = o.ver()
        val b = o.ver()
        assertEquals(listOf(a.grantId, b.grantId), o.disk.kimlikYazimlari.last())
        o.izinler.geriCek(a.grantId, GrantNedeni.IS_BITTI)
        assertEquals(listOf(b.grantId), o.disk.kimlikYazimlari.last())
        o.izinler.geriCek(null, GrantNedeni.IS_BITTI)
        assertEquals(emptyList<String>(), o.disk.kimlikYazimlari.last())
    }

    @Test
    fun surecYenidenAcilincaEskiKimliklerGeriCekildiSayilir() {
        val saat = SahteSaat()
        val disk = SahteDenetim()
        val ilk = izinlerKur.kur(saat, SahteRastgele(1L), disk, KayitliDenetim(disk, saat))
        val a = ilk.ekle(onay())!!
        val b = ilk.ekle(onay())!!
        val beklenen = listOf(a.grantId, b.grantId)

        val yeni = izinlerKur.kur(SahteSaat(), SahteRastgele(2L), disk, KayitliDenetim(disk, saat))
        assertEquals(beklenen, yeni.eskiSurectenKalanlar())
        assertTrue(yeni.aktifler().isEmpty())
        // Jeton diskte yok: doğru jeton bile eski izni canlandıramaz.
        assertEquals(DeniedNeden.IZIN_GERI_CEKILDI, ret(yeni.bul(a.grantId, a.token)))
        assertEquals(Harcama.Ret(DeniedNeden.IZIN_GERI_CEKILDI), yeni.harca(b.grantId, null))
        val k = yeni.ekle(onay())!!
        assertEquals(beklenen, yeni.eskiSurectenKalanlar(), "sonradan eklenen listeye girmez")
        assertFalse(k.grantId in yeni.eskiSurectenKalanlar())
    }

    @Test
    fun eskiKimlikListesiTekrarsiz() {
        val saat = SahteSaat()
        val disk = SahteDenetim(listOf("gA", "gB", "gA"))
        val iz = izinlerKur.kur(saat, SahteRastgele(), disk, KayitliDenetim(disk, saat))
        assertEquals(listOf("gA", "gB"), iz.eskiSurectenKalanlar())
    }

    // ---- eşzamanlılık ----

    @Test
    fun esZamanliHarcaButceyiAsmaz() {
        val o = Ortam()
        val butce = 50
        val k = o.ver(onay(butce = butce))
        val isAdedi = 16
        val tur = 20
        val havuz = Executors.newFixedThreadPool(isAdedi)
        val baslat = CountDownLatch(1)
        val tamam = AtomicInteger()
        val butceDoldu = AtomicInteger()
        val baska = AtomicInteger()
        val kalanlar = java.util.Collections.synchronizedList(ArrayList<Int>())
        try {
            val isler = (0 until isAdedi).map {
                havuz.submit {
                    baslat.await()
                    repeat(tur) {
                        when (val h = o.izinler.harca(k.grantId, null)) {
                            is Harcama.Tamam -> {
                                tamam.incrementAndGet()
                                kalanlar.add(h.kalanButce)
                            }
                            is Harcama.Ret ->
                                if (h.neden == DeniedNeden.BUTCE_DOLDU) butceDoldu.incrementAndGet() else baska.incrementAndGet()
                        }
                    }
                }
            }
            baslat.countDown()
            isler.forEach { it.get(30, TimeUnit.SECONDS) }
        } finally {
            havuz.shutdownNow()
        }
        assertEquals(butce, tamam.get())
        assertEquals(isAdedi * tur - butce, butceDoldu.get())
        assertEquals(0, baska.get())
        assertEquals((0 until butce).toSet(), kalanlar.toSet(), "her kalan değer bir kez")
        assertEquals(0, gecerli(o.izinler.bul(k.grantId, k.token)).izin.kalanButce)
    }

    @Test
    fun esZamanliMetinMaddesiTekKezGecer() {
        val o = Ortam()
        val k = o.ver(onay(mod = IzinModu.YAZ, metin = listOf("tek"), butce = 100))
        val havuz = Executors.newFixedThreadPool(8)
        val baslat = CountDownLatch(1)
        val tamam = AtomicInteger()
        try {
            val isler = (0 until 8).map {
                havuz.submit {
                    baslat.await()
                    repeat(25) { if (o.izinler.harca(k.grantId, "tek") is Harcama.Tamam) tamam.incrementAndGet() }
                }
            }
            baslat.countDown()
            isler.forEach { it.get(30, TimeUnit.SECONDS) }
        } finally {
            havuz.shutdownNow()
        }
        assertEquals(1, tamam.get())
        assertEquals(99, gecerli(o.izinler.bul(k.grantId, k.token)).izin.kalanButce)
    }

    @Test
    fun esZamanliEkleBenzersizKimlikVerir() {
        val o = Ortam()
        val havuz = Executors.newFixedThreadPool(8)
        val sonuc = java.util.Collections.synchronizedList(ArrayList<IzinKaydi>())
        val baslat = CountDownLatch(1)
        try {
            val isler = (0 until 8).map {
                havuz.submit {
                    baslat.await()
                    repeat(25) { o.izinler.ekle(onay())?.let(sonuc::add) }
                }
            }
            baslat.countDown()
            isler.forEach { it.get(30, TimeUnit.SECONDS) }
        } finally {
            havuz.shutdownNow()
        }
        assertEquals(200, sonuc.size)
        assertEquals(200, sonuc.map { it.grantId }.toSet().size)
        assertEquals(200, sonuc.map { it.token }.toSet().size)
        assertEquals(200, o.izinler.aktifler().size)
    }
}
