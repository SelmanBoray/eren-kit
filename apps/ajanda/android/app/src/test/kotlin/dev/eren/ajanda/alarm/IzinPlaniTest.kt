package dev.eren.ajanda.alarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class IzinPlaniTest {
    /** Android 13+, hiçbir izin yok, hiç sorulmadı. */
    private fun girdi(
        an: IzinAni = IzinAni.KAYIT_KAYDEDILDI,
        hatirlatma: Boolean = true,
        sdk: Int = 34,
        bildirim: Boolean = false,
        soruldu: Boolean = false,
        gerekce: Boolean = false,
        kesin: Boolean = true,
        aciklandi: Boolean = false,
        acik: Boolean = true,
        kanal: Boolean = true,
        kacirilan: Boolean = true,
        guvenilir: Boolean = true,
    ) = IzinGirdisi(an, hatirlatma, sdk, bildirim, soruldu, gerekce, kesin, aciklandi, acik, kanal, kacirilan, guvenilir)

    private fun karar(g: IzinGirdisi) = IzinPlani.karar(g)

    private fun ayar(k: IzinKarari): HatirlatmaSorunu {
        assertTrue("$k", k is IzinKarari.AyaraYonlendir)
        return (k as IzinKarari.AyaraYonlendir).sorun
    }

    @Test
    fun acilistaHicbirIzinIstenmez() {
        for (sdk in listOf(26, 31, 32, 33, 36)) for (b in listOf(true, false)) for (k in listOf(true, false)) for (s in listOf(true, false)) {
            val g = girdi(an = IzinAni.ACILIS, sdk = sdk, bildirim = b, kesin = k, soruldu = s)
            assertEquals("$g", IzinKarari.Hicbiri, karar(g))
        }
    }

    @Test
    fun hatirlatmasizKayittaIzinIstenmez() {
        assertEquals(IzinKarari.Hicbiri, karar(girdi(hatirlatma = false)))
        assertEquals(IzinKarari.Hicbiri, karar(girdi(hatirlatma = false, sdk = 31, bildirim = true, kesin = false)))
    }

    @Test
    fun ilkHatirlatmaliKayittaBildirimIzniIstenir() {
        assertEquals(IzinKarari.BildirimIzniIste, karar(girdi()))
        // Verilmişse istenmez; Android 12 ve altında çalışma zamanı izni yoktur.
        assertEquals(IzinKarari.Hicbiri, karar(girdi(bildirim = true)))
        assertEquals(IzinKarari.Hicbiri, karar(girdi(sdk = 32, bildirim = true)))
        assertEquals(IzinKarari.Hicbiri, karar(girdi(sdk = 26, bildirim = false)))
    }

    @Test
    fun reddedilenBildirimIzniKayittaYenidenSorulmaz() {
        assertEquals(IzinKarari.Hicbiri, karar(girdi(soruldu = true, gerekce = true)))
        assertEquals(IzinKarari.Hicbiri, karar(girdi(soruldu = true, gerekce = false)))
    }

    @Test
    fun kesinAlarmKayittaBirKezAyaraYonlendirir() {
        // Android 12/12L: bildirim izni yok (verilmiş sayılır), kesin alarm kapatılmış.
        val g = girdi(sdk = 31, bildirim = true, kesin = false)
        assertEquals(HatirlatmaSorunu.KESIN_ALARM_IZNI_YOK, ayar(karar(g)))
        assertEquals(IzinKarari.Hicbiri, karar(g.copy(kesinAlarmAciklandi = true)))
        assertEquals(IzinKarari.Hicbiri, karar(g.copy(kesinAlarmIzni = true)))
    }

    @Test
    fun bildirimKesinAlarmdanOnceGelir() {
        assertEquals(IzinKarari.BildirimIzniIste, karar(girdi(kesin = false)))
    }

    @Test
    fun uyaridaKullaniciIstediIcinYenidenSorulur() {
        val u = IzinAni.UYARIYA_DOKUNULDU
        assertEquals(IzinKarari.BildirimIzniIste, karar(girdi(an = u)))
        // Bir kez reddedildi: Android gerekçe gösterilebilir der, pencere yeniden açılır.
        assertEquals(IzinKarari.BildirimIzniIste, karar(girdi(an = u, soruldu = true, gerekce = true)))
        // Kalıcı ret: yalnız ayar ekranı.
        assertEquals(HatirlatmaSorunu.BILDIRIM_IZNI_YOK, ayar(karar(girdi(an = u, soruldu = true, gerekce = false))))
        // Kesin alarm: açıklama daha önce gösterilmiş olsa da kullanıcı istedi.
        assertEquals(
            HatirlatmaSorunu.KESIN_ALARM_IZNI_YOK,
            ayar(karar(girdi(an = u, sdk = 32, bildirim = true, kesin = false, aciklandi = true))),
        )
        assertEquals(IzinKarari.Hicbiri, karar(girdi(an = u, bildirim = true)))
    }

    @Test
    fun kaliciRetTanimi() {
        assertTrue(girdi(soruldu = true, gerekce = false).bildirimKaliciReddedildi)
        assertTrue(!girdi(soruldu = false).bildirimKaliciReddedildi)
        assertTrue(!girdi(soruldu = true, gerekce = true).bildirimKaliciReddedildi)
        assertTrue(!girdi(soruldu = true, bildirim = true).bildirimKaliciReddedildi)
        // İşaret güvenilmezse işaretsiz de "sorulmuş olabilir".
        assertTrue(girdi(soruldu = false, guvenilir = false).bildirimKaliciReddedildi)
        assertTrue(!girdi(soruldu = false, gerekce = true, guvenilir = false).bildirimKaliciReddedildi)
    }

    @Test
    fun acilistaIkiKezReddedenIsaretsizKullanicidaOluDugmeYok() {
        // K7: eski sürüm açılışta işaretsiz istedi, kullanıcı iki kez reddetti. Android'in hali: izin yok, gerekçe
        // bayrağı yanlış (kalıcı ret), işaret yok. Kurulum eski sürümle başladığı için işaret güvenilmez.
        val u = IzinAni.UYARIYA_DOKUNULDU
        val g = girdi(an = u, soruldu = false, gerekce = false, guvenilir = false)
        assertTrue(g.bildirimKaliciReddedildi)
        // Dokunuş sessiz kalan izin isteğini değil, ayar ekranını açar.
        assertEquals(HatirlatmaSorunu.BILDIRIM_IZNI_YOK, ayar(karar(g)))
        // Kayıtta da sessiz istek yapılmaz.
        assertEquals(IzinKarari.Hicbiri, karar(g.copy(an = IzinAni.KAYIT_KAYDEDILDI)))
        // Bir kez reddetmişse Android gerekçe der: pencere yine açılır (işaret olmasa da).
        assertEquals(IzinKarari.BildirimIzniIste, karar(g.copy(gerekceGosterilebilir = true)))
        // İzin sonradan ayardan verildiyse sorun yok.
        assertEquals(IzinKarari.Hicbiri, karar(g.copy(bildirimIzni = true)))
    }

    @Test
    fun yeniKurulumdaIsaretGuvenilirIlkDokunusPencereAcar() {
        val u = IzinAni.UYARIYA_DOKUNULDU
        // Bu sürümle başlayan kurulum: işaret yoksa kesin hiç sorulmadı.
        assertEquals(IzinKarari.BildirimIzniIste, karar(girdi(an = u, soruldu = false, gerekce = false, guvenilir = true)))
        assertEquals(IzinKarari.BildirimIzniIste, karar(girdi(soruldu = false, gerekce = false, guvenilir = true)))
        // Sorulduktan sonra gerekçe yoksa (kalıcı ret ya da pencere kapatıldı) ayar ekranı.
        assertEquals(HatirlatmaSorunu.BILDIRIM_IZNI_YOK, ayar(karar(girdi(an = u, soruldu = true, gerekce = false, guvenilir = true))))
    }

    @Test
    fun varsayilanGirdiGuvenliYanda() {
        // `soruldusuGuvenilir` verilmezse yanlış: bilinmeyen hal kalıcı ret sayılır (ayar ekranı çalışır, sessiz istek çalışmaz).
        val g = IzinGirdisi(IzinAni.UYARIYA_DOKUNULDU, true, 34, false, false, false, true, false)
        assertTrue(g.bildirimSorulmusOlabilir)
        assertEquals(HatirlatmaSorunu.BILDIRIM_IZNI_YOK, ayar(karar(g)))
    }

    @Test
    fun isaretGuvenilirlikKarari() {
        // Hiç güncellenmemiş kurulum: bu sürümle başladı.
        assertTrue(IzinPlani.guvenilirlikKarari(null, 1_000, 1_000))
        // Güncellenmiş kurulum: eski sürüm açılışta işaretsiz istemiş olabilir.
        assertTrue(!IzinPlani.guvenilirlikKarari(null, 1_000, 2_000))
        // Ölçülemedi: güvenilmez.
        assertTrue(!IzinPlani.guvenilirlikKarari(null, 0, -1))
        assertTrue(!IzinPlani.guvenilirlikKarari(null, 0, 0))
        // Saklı karar değişmez (sonraki güncellemeler onu bozmaz).
        assertTrue(IzinPlani.guvenilirlikKarari(true, 1_000, 9_000))
        assertTrue(!IzinPlani.guvenilirlikKarari(false, 5, 5))
    }

    @Test
    fun acilistaReddedenKayittaYenidenSorulmaz() {
        // Eski açılış isteği "soruldu" işaretini koymaz; bir kez reddedilince Android gerekçe bayrağını açar.
        assertEquals(IzinKarari.Hicbiri, karar(girdi(soruldu = false, gerekce = true)))
    }

    @Test
    fun uyaridaKapaliBildirimVeKanalOluDugmeBirakmaz() {
        val u = IzinAni.UYARIYA_DOKUNULDU
        // Android 12 ve altı: çalışma zamanı izni yok, tek yol bildirim ayarı.
        for (sdk in listOf(26, 31, 32)) {
            assertEquals(HatirlatmaSorunu.BILDIRIMLER_KAPALI, ayar(karar(girdi(an = u, sdk = sdk, bildirim = true, acik = false))))
        }
        // Android 13+: izin verilmiş ama bildirimler sonradan kapatılmış.
        assertEquals(HatirlatmaSorunu.BILDIRIMLER_KAPALI, ayar(karar(girdi(an = u, bildirim = true, acik = false))))
        // İzin yoksa önce izin (bildirimler de kapalı görünür).
        assertEquals(IzinKarari.BildirimIzniIste, karar(girdi(an = u, acik = false)))
        // Kanallar.
        assertEquals(HatirlatmaSorunu.HATIRLATMA_KANALI_KAPALI, ayar(karar(girdi(an = u, bildirim = true, kanal = false))))
        assertEquals(HatirlatmaSorunu.KACIRILAN_KANALI_KAPALI, ayar(karar(girdi(an = u, sdk = 31, bildirim = true, kacirilan = false))))
        // Bildirim yolu açıksa kesin alarm sırası gelir.
        assertEquals(HatirlatmaSorunu.KESIN_ALARM_IZNI_YOK, ayar(karar(girdi(an = u, sdk = 31, bildirim = true, kesin = false))))
        assertEquals(HatirlatmaSorunu.BILDIRIMLER_KAPALI, ayar(karar(girdi(an = u, sdk = 31, bildirim = true, kesin = false, acik = false))))
    }

    @Test
    fun kayittaKapaliBildirimSorulmaz() {
        assertEquals(IzinKarari.Hicbiri, karar(girdi(sdk = 31, bildirim = true, acik = false)))
        assertEquals(IzinKarari.Hicbiri, karar(girdi(bildirim = true, kanal = false)))
    }

    @Test
    fun ayarAciklamalarininMetniVar() {
        val u = IzinAni.UYARIYA_DOKUNULDU
        val kararlar = listOf(
            karar(girdi(an = u, soruldu = true)),
            karar(girdi(sdk = 31, bildirim = true, kesin = false)),
            karar(girdi(an = u, sdk = 31, bildirim = true, acik = false)),
            karar(girdi(an = u, bildirim = true, kanal = false)),
            karar(girdi(an = u, bildirim = true, kacirilan = false)),
        )
        for (k in kararlar) {
            val a = k as IzinKarari.AyaraYonlendir
            assertTrue(a.baslik.isNotBlank() && a.aciklama.isNotBlank() && a.dugme.isNotBlank())
            assertTrue(a.aciklama, !Regex("(?<![\\p{L}])PC(?![\\p{L}])").containsMatchIn(a.baslik + a.aciklama + a.dugme))
        }
    }
}
