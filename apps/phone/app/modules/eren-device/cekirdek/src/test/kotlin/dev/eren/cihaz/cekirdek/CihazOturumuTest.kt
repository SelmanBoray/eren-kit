package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.Base64

private fun tur(kare: String): String =
    requireNotNull(Regex("\"type\"\\s*:\\s*\"([a-z_]+)\"").find(kare)) { "type yok: $kare" }.groupValues[1]

private fun alan(kare: String, ad: String): String? =
    Regex("\"" + ad + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").find(kare)?.groupValues?.get(1)

/** Her giden çerçeve eren.cikti dosyasına da yazılır (Node testi cihazYukariCoz ile doğrular). */
private fun OturumCiktisi.k(): OturumCiktisi {
    giden.forEach { SahteCikti.ekle(it) }
    return this
}

private class Duzen(eskiKimlikler: List<String> = emptyList()) {
    val k = SahteKurulum()
    val denetimPortu = SahteDenetim(eskiKimlikler)
    val kayit: DenetimKaydi = denetimKaydiKur.kur(denetimPortu, k.saat)
    val izinler: Izinler = izinlerKur.kur(k.saat, k.rastgele, denetimPortu, kayit)
    val listeler: Listeler = listelerKur.kur(
        "dev.eren.app",
        ListeGirdisi(
            kurulu = listOf(KuruluUygulama("com.example.mesaj", "Mesajlar", "imza1")),
            kararlar = mapOf("com.example.mesaj" to KullaniciKarari(UygulamaDurumu.ACIK, "imza1")),
            cozulenDegismez = emptySet(),
        ),
    )
    val oturum: CihazOturumu = cihazOturumuKur.kur(
        Eslesme(k.pc.deviceId, k.pc.acikAnahtar),
        k.anahtar,
        k.rastgele,
        k.saat,
        k.ekran,
        izinler,
        listeler,
        kayit,
    )

    class El(val hello: String, val meydan: SahtePc.Meydan, val yanit: OturumCiktisi, val welcome: OturumCiktisi?)

    fun izinEkle(sureMs: Long = 600_000L, butce: Int = 5): IzinKaydi = requireNotNull(
        izinler.ekle(
            OnayliIzin(
                planId = "p1",
                planHash = "a".repeat(64),
                mod = IzinModu.OKU,
                uygulamalar = listOf(IzinliUygulama("com.example.mesaj", "Mesajlar")),
                izinliMetin = emptyList(),
                serbestMetin = false,
                sureMs = sureMs,
                butce = butce,
            ),
        ),
    )

    fun baglan(): String {
        val c = oturum.baglandi().k()
        assertEquals(1, c.giden.size)
        assertEquals("hello", tur(c.giden[0]))
        assertFalse(c.kapat)
        return c.giden[0]
    }

    /** welcome a kadar gider; welcomeYolla yanlışsa auth_response ta durur. */
    fun elSikis(
        varyant: SahtePc.Varyant = SahtePc.Varyant.DOGRU,
        sunucuZamani: Long = 1_790_000_000_000L,
        serverNonce: String? = null,
        welcomeYolla: Boolean = true,
    ): El {
        val hello = baglan()
        val meydan = if (serverNonce == null) k.pc.authChallenge(hello, varyant)
        else k.pc.authChallenge(hello, varyant, serverNonce)
        val yanit = oturum.gelen(meydan.kare).k()
        val welcome = if (welcomeYolla && !yanit.kapat) oturum.gelen(k.pc.welcome(sunucuZamani)).k() else null
        return El(hello, meydan, yanit, welcome)
    }

    fun dogrulanmis(): El = elSikis().also { assertEquals(OturumDurumu.DOGRULANDI, oturum.durum()) }
}

private fun turler(c: OturumCiktisi): List<String> = c.giden.map { tur(it) }

class CihazOturumuTest {
    @Test
    fun dogruElSikisSirayla() {
        val d = Duzen()
        d.izinEkle()
        d.izinEkle()
        assertEquals(OturumDurumu.KAPALI, d.oturum.durum())
        assertNull(d.oturum.pcSimdiMs())

        val hello = d.baglan()
        assertEquals(OturumDurumu.SINAMA_BEKLENIYOR, d.oturum.durum())
        assertEquals(d.k.pc.deviceId, alan(hello, "device_id"))
        val cn = requireNotNull(alan(hello, "client_nonce"))
        assertEquals(CekirdekSinirlari.NONCE_BAYT, Base64.getDecoder().decode(cn).size)
        assertTrue(d.k.rastgele.istekler.contains(CekirdekSinirlari.NONCE_BAYT))

        val meydan = d.k.pc.authChallenge(hello)
        val yanit = d.oturum.gelen(meydan.kare).k()
        assertEquals(listOf("auth_response"), turler(yanit))
        assertFalse(yanit.kapat)
        assertNull(yanit.komut)
        assertEquals(OturumDurumu.KARSILAMA_BEKLENIYOR, d.oturum.durum())
        assertTrue(d.k.pc.telefonImzasiDogru(hello, meydan, yanit.giden[0], d.k.anahtar.acikAnahtar()))
        // Yalnız telefon/cihaz metni imzalanır, tek kez.
        assertEquals(
            listOf("eren-auth-v1\ntelefon\ncihaz\n${d.k.pc.deviceId}\n$cn\n${meydan.serverNonce}"),
            d.k.anahtar.imzalananlar,
        )
        assertFalse(yanit.olaylar.contains(OturumOlayi.Dogrulandi))

        val welcome = d.oturum.gelen(d.k.pc.welcome()).k()
        assertEquals(OturumDurumu.DOGRULANDI, d.oturum.durum())
        assertTrue(welcome.olaylar.contains(OturumOlayi.Dogrulandi))
        assertEquals(listOf("device_state", "app_list", "grant_issued", "grant_issued"), turler(welcome))
        assertFalse(welcome.kapat)
        assertNull(welcome.komut)
        assertTrue(welcome.giden[1].contains("com.example.mesaj"))
        val kimlikler = d.izinler.aktifler().map { it.kayit.grantId }
        assertEquals(kimlikler, welcome.giden.drop(2).map { alan(it, "grant_id") })
        assertEquals(1, d.k.anahtar.imzalananlar.size)
    }

    @Test
    fun herKotuVaryantTelefonuSessizceKapatirVeImzalamaz() {
        for (v in SahtePc.Varyant.entries) {
            if (v == SahtePc.Varyant.DOGRU) continue
            val d = Duzen()
            d.izinEkle()
            val el = d.elSikis(v)
            assertTrue(el.yanit.giden.isEmpty(), "$v: çerçeve yollanmamalı")
            assertTrue(el.yanit.kapat, "$v: kapatmalı")
            assertNull(el.yanit.komut, "$v")
            assertTrue(d.k.anahtar.imzalananlar.isEmpty(), "$v: imzalamamalı")
            assertEquals(OturumDurumu.KAPALI, d.oturum.durum(), "$v")
            assertFalse(el.yanit.olaylar.contains(OturumOlayi.Dogrulandi), "$v")
            // Kapalıyken gelen welcome oturumu doğrulamaz, jeton içeren çerçeve çıkmaz.
            val sonra = d.oturum.gelen(d.k.pc.welcome()).k()
            assertNotEquals(OturumDurumu.DOGRULANDI, d.oturum.durum(), "$v")
            assertFalse(sonra.olaylar.contains(OturumOlayi.Dogrulandi), "$v")
            assertFalse(sonra.giden.any { tur(it) == "grant_issued" }, "$v")
            assertNull(sonra.komut, "$v")
            assertNull(d.oturum.pcSimdiMs(), "$v")
        }
    }

    @Test
    fun welcomeOncesiCmdIslenmezVeKomutDolmaz() {
        // KAPALI
        val d0 = Duzen()
        assertNull(d0.oturum.gelen(d0.k.pc.cmd()).k().komut)

        // SINAMA_BEKLENIYOR
        val d1 = Duzen()
        d1.baglan()
        val c1 = d1.oturum.gelen(d1.k.pc.cmd()).k()
        assertNull(c1.komut)
        assertTrue(c1.kapat)
        assertTrue(c1.giden.isEmpty(), "giden çerçeve yok, yalnız kapat")

        // KARSILAMA_BEKLENIYOR
        val d2 = Duzen()
        d2.elSikis(welcomeYolla = false)
        assertEquals(OturumDurumu.KARSILAMA_BEKLENIYOR, d2.oturum.durum())
        val c2 = d2.oturum.gelen(d2.k.pc.cmd()).k()
        assertNull(c2.komut)
        assertTrue(c2.kapat)
        assertTrue(c2.giden.isEmpty(), "giden çerçeve yok, yalnız kapat")
        assertNotEquals(OturumDurumu.DOGRULANDI, d2.oturum.durum())
    }

    @Test
    fun welcomeOncesiGrantRevokeNotifyVeWelcomeEtkisizdir() {
        val d = Duzen()
        d.izinEkle()
        d.baglan()
        val a = d.oturum.gelen(d.k.pc.grantRevoke(null)).k()
        assertTrue(a.kapat)
        assertTrue(a.giden.isEmpty())
        assertEquals(1, d.izinler.aktifler().size)

        val d2 = Duzen()
        d2.baglan()
        val n = d2.oturum.gelen(d2.k.pc.notify()).k()
        assertTrue(n.kapat)
        assertTrue(n.giden.isEmpty())
        assertTrue(n.olaylar.none { it is OturumOlayi.Bildirim })

        // auth_challenge dan önce welcome da sıra dışıdır.
        val d3 = Duzen()
        d3.baglan()
        val w = d3.oturum.gelen(d3.k.pc.welcome()).k()
        assertTrue(w.kapat)
        assertTrue(w.giden.isEmpty())
        assertNotEquals(OturumDurumu.DOGRULANDI, d3.oturum.durum())
        assertNull(d3.oturum.pcSimdiMs())
    }

    @Test
    fun dogrulanmisOturumdaCmdHamOlarakDisariVerilir() {
        val d = Duzen()
        d.dogrulanmis()
        val kmd = d.k.pc.cmd()
        val c = d.oturum.gelen(kmd).k()
        assertEquals(kmd, c.komut)
        assertTrue(c.giden.isEmpty())
        assertFalse(c.kapat)
        // Adım 0 da takılacak komut da (KomutReddi) hamıyla adaptöre gider, kapatmaz.
        val kotu = d.k.pc.cmd(cmdId = "c2", ekAlanlar = ",\"url\":\"https://x\"")
        val c2 = d.oturum.gelen(kotu).k()
        assertEquals(kotu, c2.komut)
        assertFalse(c2.kapat)
    }

    @Test
    fun ikinciAuthChallengeKapatir() {
        // Yanıtı beklerken.
        val d = Duzen()
        val el = d.elSikis(welcomeYolla = false)
        val ikinci = d.k.pc.authChallenge(el.hello)
        val c = d.oturum.gelen(ikinci.kare).k()
        assertTrue(c.kapat)
        assertNull(c.komut)
        assertEquals(1, d.k.anahtar.imzalananlar.size)
        assertNotEquals(OturumDurumu.DOGRULANDI, d.oturum.durum())
        assertTrue(c.giden.isEmpty())

        // Doğrulanmış oturumda.
        val d2 = Duzen()
        val el2 = d2.dogrulanmis()
        val c2 = d2.oturum.gelen(d2.k.pc.authChallenge(el2.hello).kare).k()
        assertTrue(c2.kapat)
        assertTrue(c2.giden.isEmpty())
        assertNull(c2.komut)
        assertEquals(1, d2.k.anahtar.imzalananlar.size)
        assertEquals(OturumDurumu.KAPALI, d2.oturum.durum())
    }

    @Test
    fun eskiServerNonceTekrariReddedilir() {
        val d = Duzen()
        val ilk = d.dogrulanmis()
        d.oturum.koptu()
        assertEquals(OturumDurumu.KAPALI, d.oturum.durum())
        val imzaSayisi = d.k.anahtar.imzalananlar.size
        // Yeni bağlantıda aynı server_nonce, yeni client_nonce a göre geçerli imzayla.
        val hello2 = d.baglan()
        val tekrar = d.k.pc.authChallenge(hello2, SahtePc.Varyant.DOGRU, ilk.meydan.serverNonce)
        val c = d.oturum.gelen(tekrar.kare).k()
        assertTrue(c.giden.isEmpty())
        assertTrue(c.kapat)
        assertEquals(imzaSayisi, d.k.anahtar.imzalananlar.size)
        assertEquals(OturumDurumu.KAPALI, d.oturum.durum())
    }

    @Test
    fun ileriSaatYalnizSaatFarkiniEtkiler() {
        val d = Duzen()
        val izin = d.izinEkle(sureMs = 600_000L, butce = 5)
        assertNull(d.oturum.pcSimdiMs())
        val once = d.oturum.baglantiNo()
        val ileri = d.k.saat.duvarMs() + 1_000_000_000L
        val el = d.elSikis(sunucuZamani = ileri)
        assertEquals(OturumDurumu.DOGRULANDI, d.oturum.durum())
        assertTrue(d.oturum.baglantiNo() > once)
        assertEquals(ileri, d.oturum.pcSimdiMs())
        d.k.saat.ilerlet(1_000L)
        assertEquals(ileri + 1_000L, d.oturum.pcSimdiMs())
        // İzin süresi monotoniktir: sunucu saati uzatamaz ya da kısaltamaz.
        val aktif = d.izinler.aktifler()
        assertEquals(1, aktif.size)
        assertEquals(izin.grantId, aktif[0].kayit.grantId)
        assertEquals(599_000L, aktif[0].kalanMs)
        assertEquals(5, aktif[0].kayit.kalanButce)
        val welcome = requireNotNull(el.welcome)
        assertEquals(listOf("device_state", "app_list", "grant_issued"), turler(welcome))
        assertNull(welcome.komut)
        d.oturum.koptu()
        assertNull(d.oturum.pcSimdiMs())
    }

    @Test
    fun kopmadaCalisanKomutunSonucuYeniBaglantiyaTasinmaz() {
        val d = Duzen()
        d.izinEkle()
        d.dogrulanmis()
        val no1 = d.oturum.baglantiNo()
        val c = d.oturum.gelen(d.k.pc.cmd()).k()
        assertNotNull(c.komut)
        d.oturum.koptu()
        val no2 = d.oturum.baglantiNo()
        assertTrue(no2 > no1, "kopma bağlantı numarasını artırmalı")
        assertNull(d.oturum.pcSimdiMs())
        val el = d.elSikis()
        assertTrue(d.oturum.baglantiNo() > no2)
        val w = requireNotNull(el.welcome)
        // Yeni bağlantıda eski komuttan ne sonuç çerçevesi ne yeniden çalıştırma çıkar.
        assertTrue(w.giden.none { tur(it) == "cmd_result" })
        assertNull(w.komut)
        assertEquals(listOf("device_state", "app_list", "grant_issued"), turler(w))
    }

    @Test
    fun grantRevokeNullHepsiniKapatir() {
        val d = Duzen()
        val a = d.izinEkle()
        val b = d.izinEkle()
        d.dogrulanmis()
        val c = d.oturum.gelen(d.k.pc.grantRevoke(null, "limit_kilit")).k()
        assertFalse(c.kapat)
        assertTrue(d.izinler.aktifler().isEmpty())
        val kapanan = c.giden.filter { tur(it) == "grant_revoked" }
        assertEquals(setOf(a.grantId, b.grantId), kapanan.mapNotNull { alan(it, "grant_id") }.toSet())
        assertTrue(kapanan.all { alan(it, "neden") == "limit_kilit" })
        assertTrue(c.olaylar.contains(OturumOlayi.IzinlerDegisti))
        assertEquals(2, d.denetimPortu.olaylar(DenetimOlayi.IZIN_GERI_CEKILDI).size)
        assertTrue(d.denetimPortu.kimlikYazimlari.last().isEmpty())
    }

    @Test
    fun grantRevokeTekIzniKapatir() {
        val d = Duzen()
        val a = d.izinEkle()
        val b = d.izinEkle()
        d.dogrulanmis()
        val c = d.oturum.gelen(d.k.pc.grantRevoke(a.grantId, "is_iptal")).k()
        assertEquals(listOf(b.grantId), d.izinler.aktifler().map { it.kayit.grantId })
        assertEquals(
            listOf(a.grantId),
            c.giden.filter { tur(it) == "grant_revoked" }.mapNotNull { alan(it, "grant_id") },
        )
        assertTrue(c.olaylar.contains(OturumOlayi.IzinlerDegisti))
    }

    @Test
    fun eskiSurectenKalanKimliklerSuresiBitti() {
        val d = Duzen(eskiKimlikler = listOf("gEski1", "gEski2"))
        val a = d.izinEkle()
        val el = d.elSikis()
        val w = requireNotNull(el.welcome)
        assertEquals(
            listOf("device_state", "app_list", "grant_issued", "grant_revoked", "grant_revoked"),
            turler(w),
        )
        assertEquals(a.grantId, alan(w.giden[2], "grant_id"))
        assertEquals(listOf("gEski1", "gEski2"), w.giden.drop(3).map { alan(it, "grant_id") })
        assertTrue(w.giden.drop(3).all { alan(it, "neden") == "suresi_bitti" })
    }

    @Test
    fun notifyKontrolKarakteriniTemizler() {
        val d = Duzen()
        d.dogrulanmis()
        val kare = d.k.pc.notify(
            notifyId = "n7",
            tur = "soru",
            baslik = "Ba\u0000ş\u001b[31mlık\u007f",
            metin = "Soru\u0007 var\u0085 mi\u009b",
        )
        val c = d.oturum.gelen(kare).k()
        assertFalse(c.kapat)
        assertNull(c.komut)
        assertTrue(c.giden.none { tur(it) == "notify_ack" }, "ack gösterilince yollanır")
        val b = c.olaylar.filterIsInstance<OturumOlayi.Bildirim>().single()
        assertEquals("n7", b.notifyId)
        assertEquals(BildirimTuru.SORU, b.tur)
        assertTrue(b.baslik.none { Character.isISOControl(it) }, "başlıkta kontrol karakteri kaldı")
        assertTrue(b.metin.none { Character.isISOControl(it) }, "metinde kontrol karakteri kaldı")
        assertTrue(b.metin.contains("Soru") && b.metin.contains("var"))
        val ack = d.oturum.bildirimGosterildi("n7").k()
        assertEquals(listOf("notify_ack"), turler(ack))
        assertEquals("n7", alan(ack.giden[0], "notify_id"))
    }

    @Test
    fun notifyAsiriUzunMetinKirpilirYaDaReddedilir() {
        val d = Duzen()
        d.dogrulanmis()
        val uzun = "x".repeat(Sinirlar.BILDIRIM_METIN + 100)
        val c = d.oturum.gelen(d.k.pc.notify(metin = uzun)).k()
        val b = c.olaylar.filterIsInstance<OturumOlayi.Bildirim>()
        if (b.isEmpty()) {
            assertTrue(c.kapat, "uzun bildirim ya kırpılmalı ya da bağlantı kapanmalı")
        } else {
            assertTrue(b.single().metin.length <= Sinirlar.BILDIRIM_METIN)
        }
        val d2 = Duzen()
        d2.dogrulanmis()
        val c2 = d2.oturum.gelen(d2.k.pc.notify(baslik = "b".repeat(Sinirlar.BILDIRIM_BASLIK + 50))).k()
        val b2 = c2.olaylar.filterIsInstance<OturumOlayi.Bildirim>()
        if (b2.isEmpty()) assertTrue(c2.kapat) else assertTrue(b2.single().baslik.length <= Sinirlar.BILDIRIM_BASLIK)
    }

    @Test
    fun asagiYondaGrantIssuedVeYukariYonMesajlariReddedilir() {
        val jeton = SahtePc.JETON
        val yukari = listOf(
            "{\"v\":1,\"type\":\"grant_issued\",\"grant_id\":\"gX\",\"token\":\"$jeton\",\"plan_id\":\"p1\"," +
                "\"plan_hash\":\"${"a".repeat(64)}\",\"mod\":\"yaz\",\"uygulamalar\":[\"com.example.mesaj\"]," +
                "\"kalan_ms\":600000,\"butce\":300}",
            "{\"v\":1,\"type\":\"hello\",\"device_id\":\"tel-1\",\"client_nonce\":\"${"A".repeat(44)}\"}",
            "{\"v\":1,\"type\":\"auth_response\",\"signature\":\"${"A".repeat(40)}\"}",
            "{\"v\":1,\"type\":\"cmd_result\",\"cmd_id\":\"c1\",\"ok\":true,\"foreground\":null}",
            "{\"v\":1,\"type\":\"device_state\",\"a11y\":true,\"adb_enabled\":false,\"kilitli\":false}",
            "{\"v\":1,\"type\":\"app_list\",\"uygulamalar\":[]}",
            "{\"v\":1,\"type\":\"notify_ack\",\"notify_id\":\"n1\"}",
            "{\"v\":1,\"type\":\"grant_revoked\",\"grant_id\":\"g1\",\"neden\":\"is_iptal\"}",
        )
        for (kare in yukari) {
            val d = Duzen()
            val a = d.izinEkle()
            d.dogrulanmis()
            val c = d.oturum.gelen(kare).k()
            val ad = tur(kare)
            assertTrue(c.kapat, "$ad: kapatmalı")
            assertNull(c.komut, ad)
            assertTrue(c.giden.isEmpty(), "$ad: giden çerçeve yok, yalnız kapat")
            assertEquals(listOf(a.grantId), d.izinler.aktifler().map { it.kayit.grantId }, ad)
            assertTrue(c.giden.none { it.contains("gX") }, ad)
        }
    }

    @Test
    fun bozukMetinCerceveYollamadanKapatir() {
        val d = Duzen()
        d.dogrulanmis()
        val c = d.oturum.gelen("bu json degil").k()
        assertTrue(c.kapat)
        assertTrue(c.giden.isEmpty(), "giden çerçeve yok, yalnız kapat")
        assertNull(c.komut)
    }

    @Test
    fun bilgisayarinErroruKapaninirOlayVerir() {
        val d = Duzen()
        d.baglan()
        val c = d.oturum.gelen(d.k.pc.hata("imza_gecersiz")).k()
        assertTrue(c.kapat)
        assertTrue(c.giden.isEmpty())
        assertTrue(c.olaylar.contains(OturumOlayi.Kapaniyor(HataKodu.IMZA_GECERSIZ, true)))
        assertNotEquals(OturumDurumu.DOGRULANDI, d.oturum.durum())
    }

    @Test
    fun dogrulanmamisOturumdaIzinCagrilariCerceveUretmez() {
        val d = Duzen()
        assertTrue(d.oturum.cihazDurumuDegisti().k().giden.isEmpty())
        assertTrue(d.oturum.uygulamalarDegisti().k().giden.isEmpty())
        val izin = d.izinEkle()
        assertTrue(d.oturum.izinEklendi(izin).k().giden.isEmpty())
        d.baglan()
        assertTrue(d.oturum.izinEklendi(izin).k().giden.isEmpty())
        val c = d.oturum.izinGeriCek(null, GrantNedeni.KULLANICI_DURDURDU).k()
        assertTrue(c.giden.isEmpty())
        // Yan etkisi yine de yapılır.
        assertTrue(d.izinler.aktifler().isEmpty())
    }

    @Test
    fun dogrulanmisOturumdaIzinCagrilariCerceveUretir() {
        val d = Duzen()
        d.dogrulanmis()
        val izin = d.izinEkle(sureMs = 5_000L)
        val ver = d.oturum.izinEklendi(izin).k()
        assertEquals(listOf("grant_issued"), turler(ver))
        assertEquals(izin.grantId, alan(ver.giden[0], "grant_id"))
        d.k.saat.ilerlet(6_000L)
        val tik = d.oturum.tik().k()
        assertEquals(listOf("grant_revoked"), turler(tik))
        assertEquals("suresi_bitti", alan(tik.giden[0], "neden"))
        val durum = d.oturum.cihazDurumuDegisti().k()
        assertEquals(listOf("device_state"), turler(durum))
        assertEquals(listOf("app_list"), turler(d.oturum.uygulamalarDegisti().k()))
    }
}
