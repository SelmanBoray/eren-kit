package dev.eren.ajanda.birlestirme

import dev.eren.ajanda.cekirdek.BirlestirmeOnizlemesi
import dev.eren.ajanda.cekirdek.BirlestirmeSonucu
import dev.eren.ajanda.cekirdek.CakisanKayit
import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.KoparmaSonucu
import dev.eren.ajanda.cekirdek.OlasiCift
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Birleştirme akışı sahte çekirdek yüzüyle: soru, yeniden önizleme, eski pencereyle onay, kopma, zaten uygulandı,
 * vazgeç, erteleme (plan ve bağlantı kuşağı), bekleyen sorgusu, eşzamanlılık, hatalar.
 */
class BirlestirmeAkisiTest {
    /** Sırayla tüketilen yanıtlar; [Exception] ise atılır. Eşzamanlılık için içerdeki çağrı sayısını izler. */
    private class SahteBirlestirme : BirlestirmeCekirdegi {
        val onizlemeler = ArrayDeque<Any?>()
        val onaySonuclari = ArrayDeque<Any>()
        var vazgecSonucu: Any = koparma(true)
        var kipYaniti: Any = CalismaKipi.YEREL
        val cagrilar: MutableList<String> = Collections.synchronizedList(mutableListOf())

        /** Doluysa onay çağrısı içeri girince [girdi]'yi sayar ve bu kapı açılana dek bekler. */
        var onayKapisi: CountDownLatch? = null
        val girdi = CountDownLatch(1)
        private val icerde = AtomicInteger()
        val azamiEsZaman = AtomicInteger()

        private inline fun <T> cagri(ad: String, is_: () -> T): T {
            azamiEsZaman.accumulateAndGet(icerde.incrementAndGet(), ::maxOf)
            try {
                cagrilar += ad
                return is_()
            } finally {
                icerde.decrementAndGet()
            }
        }

        override fun birlestirmeOnizlemesi(): BirlestirmeOnizlemesi? = cagri("onizleme") {
            val o = onizlemeler.removeFirst()
            if (o is Exception) throw o
            o as BirlestirmeOnizlemesi?
        }

        override fun birlestirmeyiOnayla(iz: String?): BirlestirmeSonucu = cagri("onayla:$iz") {
            onayKapisi?.let {
                girdi.countDown()
                assertTrue(it.await(10, TimeUnit.SECONDS))
            }
            val o = onaySonuclari.removeFirst()
            if (o is Exception) throw o
            o as BirlestirmeSonucu
        }

        override fun birlestirmedenVazgec(): KoparmaSonucu = cagri("vazgec") {
            val o = vazgecSonucu
            if (o is Exception) throw o
            o as KoparmaSonucu
        }

        override fun kip(): CalismaKipi = cagri("kip") {
            val o = kipYaniti
            if (o is Exception) throw o
            o as CalismaKipi
        }
    }

    private val yuz = SahteBirlestirme()

    /** Bağlantı kuşağı: testte elle artırılır (yeni soket). */
    private var kusakNo = 1L
    private val akis = BirlestirmeAkisi(yuz, kusak = { kusakNo })

    private fun onay(a: BirlestirmeAkisi.Adim?): BirlestirmeAkisi.Adim.Onay {
        assertTrue("$a", a is BirlestirmeAkisi.Adim.Onay)
        return a as BirlestirmeAkisi.Adim.Onay
    }

    private fun plan(
        iz: String = "iz1",
        yeni: Int = 3,
        degisen: Int = 2,
        cakisan: Int = 1,
        islem: Int = 5,
        ayniDepo: Boolean = false,
        cift: Int = 1,
        taslak: Int = 0,
        okunamayanTemel: Int = 0,
        ret: Int = 0,
    ) = BirlestirmeOnizlemesi(
        depoId = "depo_ornek",
        ayniDepo = ayniDepo,
        yeni = yeni,
        degisen = degisen,
        cakisanlar = List(cakisan) { CakisanKayit("k_gizli_$it", listOf("baslik")) },
        pcSilmisler = listOf("k_gizli_silinmis"),
        retListesine = List(ret) { "k_gizli_ret_$it" },
        dusecekMezar = 2,
        ayni = 4,
        servistenGelecek = 6,
        islem = islem,
        olasiCiftler = List(cift) { OlasiCift("k_gizli_tel_$it", "k_gizli_srv_$it") },
        iz = iz,
        taslaklar = List(taslak) { "k_gizli_taslak_$it" },
        okunamayanPcTemeli = okunamayanTemel,
    )

    private fun temiz(a: BirlestirmeAkisi.Adim) {
        val t = "${a.baslik}\n${a.metin}"
        assertFalse(t, t.contains("k_gizli"))
        assertFalse(t, t.contains("depo_ornek"))
        assertFalse(t, Regex("\\biz\\d\\b").containsMatchIn(t))
        assertFalse(t, Regex("\\bPC\\b").containsMatchIn(t))
    }

    @Test
    fun taslakVeOkunamayanTemelCumleleriYalnizSifirDegilse() {
        yuz.onizlemeler += plan(taslak = 2, okunamayanTemel = 3)
        val o = akis.denetle()!!
        assertTrue(
            o.metin,
            o.metin.contains(
                "• 2 taslak Eren servisine gönderilmeyecek: ana listeden kalkıp gönderilemeyenler listesine düşecek, " +
                    "oradan düzeltilip eklenebilir",
            ),
        )
        assertTrue(o.metin, o.metin.contains("• 3 kaydın Eren servisindeki önceki hali okunamıyor: telefondaki farklı her alan Eren servisine gidecek"))
        temiz(o)
    }

    @Test
    fun taslakVeOkunamayanTemelSifirsaCumleYok() {
        yuz.onizlemeler += plan()
        val o = akis.denetle()!!
        assertFalse(o.metin, o.metin.contains("taslak"))
        assertFalse(o.metin, o.metin.contains("okunamıyor"))
    }

    @Test
    fun onizlemeSorulurOnaylaninceSonucGelir() {
        yuz.onizlemeler += plan()
        yuz.onaySonuclari += BirlestirmeSonucu(true, plan())
        val o = onay(akis.denetle())
        assertEquals("Kayıtlar Eren servisiyle birleştirilsin mi?", o.baslik)
        assertEquals(
            "Bu telefondaki kayıtlar Eren servisindekilerle birleştirilecek.\n" +
                "• 3 kayıt Eren servisine yeni kayıt olarak gidecek\n" +
                "• 2 kayıttaki değişiklik Eren servisine gidecek\n" +
                "• 1 kayıtta iki tarafta da aynı bilgi değişmiş: telefondaki geçerli olacak (Eren servisindeki önceki hali geçmişte kalır)\n" +
                "• 1 kayıt Eren servisinde silinmiş ama telefonda değişmiş: gönderilemeyenler listesine düşecek\n" +
                "• Telefonda silinmiş 2 kayıt gönderilmeyecek, Silinenler'den kalkacak\n" +
                "• 4 kayıt Eren servisindekiyle aynı\n" +
                "• 6 kayıt Eren servisinden telefona gelecek\n" +
                "• 1 kayıt Eren servisindeki bir kayda benziyor (aynı tür, başlık ve zaman): ikisi de tutulacak, listede işaretlenecek\n" +
                "Onaylarsanız değişiklikler Eren servisine 5 işlem olarak gönderilir.\n" +
                "Bundan sonra kayıtları Eren servisi tutar; bu telefon ona bağlı çalışır.\n" +
                "Şimdi değil derseniz hiçbir kayıt değişmez; onay bekleyen birleştirme ana ekranda görünür, oradan " +
                "istediğiniz zaman açabilirsiniz. Bağlantı yeniden kurulunca yeniden sorulur.\n" +
                "Eşleşmeyi kaldırırsanız hiçbir kayıt değişmez; eşleşme silinir, yeniden bağlanmak için QR kodu yeniden okutulur.",
            o.metin,
        )
        // Geri alınamaz düğmenin adı sonucu söyler ("Vazgeç" değil); güvenli kapatma "Şimdi değil".
        assertEquals(listOf("Birleştir", "Eşleşmeyi kaldır", "Şimdi değil"), listOf(o.onayDugmesi, o.vazgecDugmesi, o.sonraDugmesi))
        assertEquals("iz1", o.iz)
        assertTrue(akis.onayBekliyor)
        temiz(o)

        val s = akis.onayla(o)
        assertTrue(s is BirlestirmeAkisi.Adim.Bilgi)
        assertEquals("Birleştirildi", s.baslik)
        assertEquals(
            "Bu telefon artık Eren servisine bağlı.\n" +
                "5 işlem Eren servisine gönderilmek üzere sıraya alındı.\n" +
                "1 kayıt Eren servisinde silinmiş olduğu için gönderilemeyenler listesine düşecek.\n" +
                "1 olası çift listede işaretlendi.",
            s.metin,
        )
        assertFalse(akis.onayBekliyor)
        assertEquals(listOf("onizleme", "onayla:iz1"), yuz.cagrilar)
        temiz(s)
    }

    @Test
    fun sonuctaTaslakVeRetAyriSayilir() {
        yuz.onizlemeler += plan(taslak = 2, ret = 3, cift = 0, islem = 0)
        yuz.onaySonuclari += BirlestirmeSonucu(true, plan(taslak = 2, ret = 3, cift = 0, islem = 0))
        val s = akis.onayla(onay(akis.denetle()))
        assertEquals(
            "Bu telefon artık Eren servisine bağlı.\n" +
                "3 kayıt gönderilemeyenler listesine düştü; oradan düzeltilebilir.\n" +
                "2 taslak ana listeden kalkıp gönderilemeyenler listesine düştü; oradan düzeltilip eklenebilir.\n" +
                "1 kayıt Eren servisinde silinmiş olduğu için gönderilemeyenler listesine düşecek.",
            s.metin,
        )
        temiz(s)
    }

    @Test
    fun bekleyenYoksaSorulmaz() {
        yuz.onizlemeler += null
        assertNull(akis.denetle())
        assertFalse(akis.onayBekliyor)
        yuz.onizlemeler += null
        assertNull(akis.bekleyen())
        assertFalse(yuz.cagrilar.any { it.startsWith("onayla") })
    }

    @Test
    fun planDegistiyseYeniPlanYeniIzleOnaylanir() {
        yuz.onizlemeler += plan(iz = "iz1")
        yuz.onaySonuclari += BirlestirmeSonucu(false, plan(iz = "iz2", yeni = 4))
        yuz.onaySonuclari += BirlestirmeSonucu(true, plan(iz = "iz2", yeni = 4))
        val ilk = onay(akis.denetle())
        val yeniden = onay(akis.onayla(ilk))
        assertEquals("Kayıtlar bu arada değişti", yeniden.baslik)
        assertEquals("iz2", yeniden.iz)
        assertTrue(
            yeniden.metin,
            yeniden.metin.startsWith("Önizlemeden sonra kayıtlar değişti; plan yenilendi. Aşağıdaki sayılar yeni plana göredir.\n"),
        )
        assertTrue(yeniden.metin, yeniden.metin.contains("• 4 kayıt Eren servisine yeni kayıt olarak gidecek"))
        assertTrue(akis.onayla(yeniden) is BirlestirmeAkisi.Adim.Bilgi)
        assertEquals(listOf("onizleme", "onayla:iz1", "onayla:iz2"), yuz.cagrilar)
    }

    @Test
    fun eskiPencereylekiOnayGosterilmeyenPlaniUygulamaz() {
        // A ekranda; gözlemci yeni bildirim getirdi, denetle planı B yaptı; görünüm yenilenmedi.
        yuz.onizlemeler += plan(iz = "iz1", yeni = 3)
        yuz.onizlemeler += plan(iz = "iz2", yeni = 9)
        val a = onay(akis.denetle())
        val b = onay(akis.denetle())
        assertEquals("iz2", b.iz)
        // Kullanıcı A'ya "Birleştir" der: çekirdeğe A'nın izi gider (B'nin değil); çekirdek uygulamaz.
        yuz.onaySonuclari += BirlestirmeSonucu(false, plan(iz = "iz2", yeni = 9))
        val yeni = onay(akis.onayla(a))
        assertEquals(listOf("onizleme", "onizleme", "onayla:iz1"), yuz.cagrilar)
        // Yeni soru: B'nin sayıları, "değişti" başlığıyla.
        assertEquals("Kayıtlar bu arada değişti", yeni.baslik)
        assertTrue(yeni.metin, yeni.metin.contains("• 9 kayıt Eren servisine yeni kayıt olarak gidecek"))
        assertEquals("iz2", yeni.iz)
        assertTrue(akis.onayBekliyor)
    }

    @Test
    fun ayniAdimlaIkinciOnayCekirdegeGitmez() {
        yuz.onizlemeler += plan()
        yuz.onaySonuclari += BirlestirmeSonucu(true, plan())
        val o = onay(akis.denetle())
        val ilk = akis.onayla(o)
        val ikinci = akis.onayla(o)
        assertEquals(ilk, ikinci)
        assertEquals("Birleştirildi", ikinci.baslik)
        assertEquals(1, yuz.cagrilar.count { it.startsWith("onayla") })
        // Uygulandıktan sonra önizleme kalktı: soru yok, son hal korunur (gecikmiş onay yine aynı sonucu alır).
        yuz.onizlemeler += null
        assertNull(akis.denetle())
        assertEquals(ilk, akis.onayla(o))
    }

    @Test
    fun bekleyenYokDeyinceKipOkunur() {
        // Kip yerel: bağlantı koptu, hiçbir şey yazılmadı.
        yuz.onizlemeler += plan()
        yuz.onaySonuclari += BirlestirmeSonucu(false, null)
        val a = akis.onayla(onay(akis.denetle()))
        assertTrue(a is BirlestirmeAkisi.Adim.Bilgi)
        assertEquals("Birleştirilemedi", a.baslik)
        assertEquals("Eren servisiyle bağlantı koptu; hiçbir kayıt değişmedi. Yeniden bağlanınca yeniden sorulacak.", a.metin)
        assertFalse(akis.onayBekliyor)
        temiz(a)

        // Kip bağlı: başka bir çağrı (ikinci akış, eski görünüm) uygulamış; "koptu" denmez.
        val ikinciAkis = BirlestirmeAkisi(yuz, kusak = { kusakNo })
        yuz.onizlemeler += plan(iz = "iz5")
        val o = onay(ikinciAkis.denetle())
        yuz.onaySonuclari += BirlestirmeSonucu(false, null)
        yuz.kipYaniti = CalismaKipi.BAGLI
        val z = ikinciAkis.onayla(o)
        assertEquals("Zaten bağlı", z.baslik)
        assertEquals("Bu telefon Eren servisine bağlı; birleştirme bu arada tamamlanmış. Kayıtları artık Eren servisi tutar.", z.metin)
        assertFalse(z.metin, z.metin.contains("koptu") || z.metin.contains("değişmedi"))
        assertEquals(z, ikinciAkis.onayla(o))
        temiz(z)

        // Kip de okunamadı: belirsiz olduğu söylenir.
        val ucuncu = BirlestirmeAkisi(yuz, kusak = { kusakNo })
        yuz.onizlemeler += plan(iz = "iz6")
        val o3 = onay(ucuncu.denetle())
        yuz.onaySonuclari += BirlestirmeSonucu(false, null)
        yuz.kipYaniti = CekirdekHatasi.Depo("k_gizli")
        val b = ucuncu.onayla(o3)
        assertEquals("Birleştirmenin sonucu okunamadı", b.baslik)
        assertTrue(b.metin, b.metin.contains("şu an okunamadı"))
        assertFalse(b.metin, b.metin.contains("hiçbir kayıt değişmedi"))
        temiz(b)
    }

    @Test
    fun zatenUygulandiKoparmadanSonraGecikmisOnaydaKoptuDenmez() {
        // Y7: birleştirme (iz7) başka bir yoldan uygulandı, sonra bağlantı koparıldı (kip yerel); eski adımla
        // gecikmiş onay gelir. Çekirdek "zaten uygulandı" der: "bağlantı koptu; hiçbir kayıt değişmedi" denmez.
        yuz.onizlemeler += plan(iz = "iz7")
        val o = onay(akis.denetle())
        yuz.onaySonuclari += BirlestirmeSonucu(false, null, zatenUygulandi = true)
        yuz.kipYaniti = CalismaKipi.YEREL
        val a = akis.onayla(o)
        assertTrue(a is BirlestirmeAkisi.Adim.Bilgi)
        assertEquals("Birleştirme daha önce yapıldı", a.baslik)
        assertEquals("Bu birleştirme daha önce tamamlanmıştı; bu onay hiçbir kaydı değiştirmedi.", a.metin)
        assertFalse(a.metin, a.metin.contains("koptu"))
        assertFalse(a.metin, a.metin.contains("bağlı"))
        assertFalse(akis.onayBekliyor)
        // Aynı adımla yeniden onay çekirdeğe gitmez.
        assertEquals(a, akis.onayla(o))
        assertEquals(1, yuz.cagrilar.count { it.startsWith("onayla") })
        temiz(a)

        // Zaten uygulandı ve kip bağlı: "zaten bağlı".
        val ikinci = BirlestirmeAkisi(yuz, kusak = { kusakNo })
        yuz.onizlemeler += plan(iz = "iz8")
        val o2 = onay(ikinci.denetle())
        yuz.onaySonuclari += BirlestirmeSonucu(false, null, zatenUygulandi = true)
        yuz.kipYaniti = CalismaKipi.BAGLI
        assertEquals("Zaten bağlı", ikinci.onayla(o2).baslik)

        // Zaten uygulandı, kip okunamadı: belirsiz değil, "daha önce yapıldı".
        val ucuncu = BirlestirmeAkisi(yuz, kusak = { kusakNo })
        yuz.onizlemeler += plan(iz = "iz9")
        val o3 = onay(ucuncu.denetle())
        yuz.onaySonuclari += BirlestirmeSonucu(false, null, zatenUygulandi = true)
        yuz.kipYaniti = CekirdekHatasi.Depo("k_gizli")
        assertEquals("Birleştirme daha önce yapıldı", ucuncu.onayla(o3).baslik)
    }

    @Test
    fun metinKurulamazsaDaUygulandiDenir() {
        val bozukMetin = object : BirlestirmeMetinleri() {
            override fun sonuc(p: BirlestirmeOnizlemesi?): String = throw IllegalStateException("biçim")
        }
        val a = BirlestirmeAkisi(yuz, bozukMetin, kusak = { kusakNo })
        yuz.onizlemeler += plan()
        yuz.onaySonuclari += BirlestirmeSonucu(true, plan())
        val s = a.onayla(onay(a.denetle()))
        assertTrue(s is BirlestirmeAkisi.Adim.Bilgi)
        assertEquals("Birleştirildi", s.baslik)
        assertEquals("Bu telefon artık Eren servisine bağlı.", s.metin)
    }

    @Test
    fun vazgecBaglanmayiIptalEder() {
        yuz.onizlemeler += plan()
        akis.denetle()
        val a = akis.vazgec()
        assertTrue(a is BirlestirmeAkisi.Adim.Bilgi)
        assertEquals("Bağlanma iptal edildi", a.baslik)
        assertTrue(a.metin, a.metin.contains("QR kodunu yeniden okutun"))
        assertFalse(akis.onayBekliyor)
        assertEquals(listOf("onizleme", "vazgec"), yuz.cagrilar)
        temiz(a)

        yuz.vazgecSonucu = koparma(false)
        assertEquals("Süren bir bağlanma yoktu; hiçbir şey değişmedi.", akis.vazgec().metin)
        yuz.vazgecSonucu = CekirdekHatasi.GecersizDurum("bağlı kipte")
        val h = akis.vazgec()
        assertTrue(h is BirlestirmeAkisi.Adim.Hata)
        assertEquals("Bu telefon zaten Eren servisine bağlı; sorulacak bir şey yok.", h.metin)
    }

    @Test
    fun simdiDegilAyniBaglantidaPlanDegisseDeSormazSeritKalir() {
        yuz.onizlemeler += plan(iz = "iz1")
        val o = onay(akis.denetle())
        akis.simdiDegil(o)
        // Birleştirme hâlâ onay bekliyor; ekran şerit gösterir.
        assertTrue(akis.onayBekliyor)
        assertTrue(akis.ertelendi)
        yuz.onizlemeler += plan(iz = "iz1")
        val b = akis.bekleyen()!!
        assertTrue(b.ertelendi)
        assertEquals("Eren servisiyle birleştirme onayınızı bekliyor; onaylayana dek kayıtlar eşitlenmez.", b.serit)
        assertEquals("Gözden geçir", b.dugme)
        assertEquals(b, akis.sonBekleyen)
        // Aynı plan, aynı bağlantı: sorulmaz.
        yuz.onizlemeler += plan(iz = "iz1")
        assertNull(akis.denetle())
        // P6: kullanıcı bir kayıt kaydetti, plan yenilendi (aynı bağlantı): pencere yeniden açılmaz, şerit kalır.
        yuz.onizlemeler += plan(iz = "iz2")
        assertNull(akis.denetle())
        assertTrue(akis.sonBekleyen!!.ertelendi)
        // Şeride dokunuldu: güncel planla sorulur ("değişti" denmez: kullanıcı okurken değişmedi).
        yuz.onizlemeler += plan(iz = "iz2")
        val zorla = onay(akis.denetle(zorla = true))
        assertEquals("iz2", zorla.iz)
        assertEquals("Kayıtlar Eren servisiyle birleştirilsin mi?", zorla.baslik)
        assertFalse(akis.ertelendi)
        assertFalse(akis.sonBekleyen!!.ertelendi)
        akis.simdiDegil(zorla)
        // Yeni bağlantı: yeniden sorulur.
        kusakNo++
        yuz.onizlemeler += plan(iz = "iz3")
        assertEquals("iz3", onay(akis.denetle()).iz)
        assertFalse(yuz.cagrilar.any { it.startsWith("onayla") || it == "vazgec" })
    }

    @Test
    fun soruAcikkenPlanDegisirseDegistiDenirVeIsaretKalir() {
        // P3: A ekranda, arka plandan gelen denetle B'yi getirdi: aynı başlıkla sessizce değişmez.
        yuz.onizlemeler += plan(iz = "iz1", yeni = 3)
        val a = onay(akis.denetle())
        assertEquals("Kayıtlar Eren servisiyle birleştirilsin mi?", a.baslik)
        yuz.onizlemeler += plan(iz = "iz2", yeni = 9)
        val b = onay(akis.denetle())
        assertEquals("iz2", b.iz)
        assertEquals("Kayıtlar bu arada değişti", b.baslik)
        assertTrue(b.metin, b.metin.startsWith("Önizlemeden sonra kayıtlar değişti; plan yenilendi."))
        assertTrue(b.metin, b.metin.contains("• 9 kayıt Eren servisine yeni kayıt olarak gidecek"))
        // Aynı plan yeniden denetlenince (yeni bildirim, döndürme) adım aynı kalır: pencere yerinde, işaret düşmez.
        yuz.onizlemeler += plan(iz = "iz2", yeni = 9)
        assertEquals(b, akis.denetle())
        // Onayın döndürdüğü yeni plan da işaretli kalır.
        yuz.onaySonuclari += BirlestirmeSonucu(false, plan(iz = "iz3", yeni = 4))
        val c = onay(akis.onayla(b))
        assertEquals("Kayıtlar bu arada değişti", c.baslik)
        yuz.onizlemeler += plan(iz = "iz3", yeni = 4)
        assertEquals(c, akis.denetle())
    }

    @Test
    fun soruAcikkenBekleyenKalkarsaAciklanir() {
        // P5: soru ekrandayken bağlantı koptu: pencere sessizce kapanmaz, ne olduğu söylenir.
        yuz.onizlemeler += plan(iz = "iz1")
        onay(akis.denetle())
        yuz.onizlemeler += null
        yuz.kipYaniti = CalismaKipi.YEREL
        val koptu = akis.denetle()!!
        assertEquals("Birleştirilemedi", koptu.baslik)
        assertEquals("Eren servisiyle bağlantı koptu; hiçbir kayıt değişmedi. Yeniden bağlanınca yeniden sorulacak.", koptu.metin)
        assertFalse(akis.onayBekliyor)
        assertNull(akis.sonBekleyen)
        // Bir kez söylenir.
        yuz.onizlemeler += null
        assertNull(akis.denetle())
        temiz(koptu)

        // Kip bağlı: bu arada tamamlanmış; aynı adımla gecikmiş onay çekirdeğe gitmez.
        yuz.onizlemeler += plan(iz = "iz2")
        val o = onay(akis.denetle())
        yuz.onizlemeler += null
        yuz.kipYaniti = CalismaKipi.BAGLI
        assertEquals("Zaten bağlı", akis.denetle()!!.baslik)
        assertEquals("Zaten bağlı", akis.onayla(o).baslik)
        assertFalse(yuz.cagrilar.any { it.startsWith("onayla") })

        // Kip okunamadı: belirsiz.
        val ikinci = BirlestirmeAkisi(yuz, kusak = { kusakNo })
        yuz.onizlemeler += plan(iz = "iz3")
        onay(ikinci.denetle())
        yuz.onizlemeler += null
        yuz.kipYaniti = CekirdekHatasi.Depo("k_gizli")
        assertEquals("Birleştirmenin sonucu okunamadı", ikinci.denetle()!!.baslik)

        // Ertelenmiş soru (pencere kapalı) kalkarsa açıklama yok: şerit kalkar.
        val ucuncu = BirlestirmeAkisi(yuz, kusak = { kusakNo })
        yuz.onizlemeler += plan(iz = "iz4")
        ucuncu.simdiDegil(onay(ucuncu.denetle()))
        yuz.onizlemeler += null
        assertNull(ucuncu.denetle())
        assertNull(ucuncu.sonBekleyen)
    }

    @Test
    fun sonBekleyenOnizlemeyiYenidenKurmaz() {
        // P7: her çağrıdan sonra görünüm sonBekleyen okur; çekirdeğe ikinci önizleme gitmez.
        assertNull(akis.sonBekleyen)
        yuz.onizlemeler += plan(iz = "iz1")
        val o = onay(akis.denetle())
        assertEquals(BirlestirmeAkisi.Bekleyen(false, akis.sonBekleyen!!.serit, "Gözden geçir"), akis.sonBekleyen)
        akis.simdiDegil(o)
        assertTrue(akis.sonBekleyen!!.ertelendi)
        // Bağlantı yenilendi: erteleme bu bağlantı için değil.
        kusakNo++
        assertFalse(akis.sonBekleyen!!.ertelendi)
        yuz.onaySonuclari += BirlestirmeSonucu(true, plan(iz = "iz1"))
        akis.onayla(o)
        assertNull(akis.sonBekleyen)
        assertEquals(listOf("onizleme", "onayla:iz1"), yuz.cagrilar)
        // Vazgeç de bekleyeni kaldırır.
        val ikinci = BirlestirmeAkisi(yuz, kusak = { kusakNo })
        yuz.onizlemeler += plan(iz = "iz2")
        onay(ikinci.denetle())
        ikinci.vazgec()
        assertNull(ikinci.sonBekleyen)
    }

    @Test
    fun simdiDegilKesintisizYenidenBaglanmadaYenidenSorulur() {
        yuz.onizlemeler += plan(iz = "iz1")
        akis.simdiDegil(onay(akis.denetle()))
        // Uygulama arkadaydı: bağlantı koptu ve yeniden kuruldu, aradaki boş önizlemeyi kimse görmedi.
        // Plan aynı (aynı iz), ama bağlantı yeni.
        kusakNo++
        yuz.onizlemeler += plan(iz = "iz1")
        assertFalse(akis.bekleyen()!!.ertelendi)
        yuz.onizlemeler += plan(iz = "iz1")
        val yeniden = onay(akis.denetle())
        assertEquals("iz1", yeniden.iz)
        assertFalse(akis.ertelendi)
        // Boş önizleme görülürse erteleme de düşer.
        akis.simdiDegil(yeniden)
        yuz.onizlemeler += null
        assertNull(akis.denetle())
        assertFalse(akis.ertelendi)
        assertFalse(akis.onayBekliyor)
    }

    @Test
    fun esZamanliOnaylarVeDenetimSiralanir() {
        yuz.onizlemeler += plan()
        val o = onay(akis.denetle())
        yuz.onaySonuclari += BirlestirmeSonucu(true, plan())
        yuz.onizlemeler += null
        val kapi = CountDownLatch(1)
        yuz.onayKapisi = kapi
        val sonuclar = Collections.synchronizedList(mutableListOf<BirlestirmeAkisi.Adim?>())
        val hatalar = Collections.synchronizedList(mutableListOf<Throwable>())
        fun is_(f: () -> BirlestirmeAkisi.Adim?) = Thread {
            try {
                sonuclar += f()
            } catch (t: Throwable) {
                hatalar += t
            }
        }
        // 1: düğme, çekirdeğin içinde bekler.
        val t1 = is_ { akis.onayla(o) }.apply { start() }
        assertTrue(yuz.girdi.await(10, TimeUnit.SECONDS))
        // 2: çift dokunma; 3: gözlemciden denetle. İkisi de kilitte bekler, çekirdeğe girmez.
        val t2 = is_ { akis.onayla(o) }.apply { start() }
        val t3 = is_ { akis.denetle() }.apply { start() }
        bekleyeKadar(t2)
        bekleyeKadar(t3)
        assertEquals(listOf("onizleme", "onayla:iz1"), yuz.cagrilar.toList())
        kapi.countDown()
        listOf(t1, t2, t3).forEach { it.join(10_000) }
        assertTrue("$hatalar", hatalar.isEmpty())
        assertEquals(1, yuz.azamiEsZaman.get())
        assertEquals(1, yuz.cagrilar.count { it.startsWith("onayla") })
        val bilgiler = sonuclar.filterIsInstance<BirlestirmeAkisi.Adim.Bilgi>()
        assertEquals("$sonuclar", 2, bilgiler.size)
        assertTrue("$bilgiler", bilgiler.all { it.baslik == "Birleştirildi" })
        assertTrue("$sonuclar", sonuclar.contains(null))
        assertFalse(akis.onayBekliyor)
    }

    /** [t] kilitte (`synchronized`) bekleyene dek. */
    private fun bekleyeKadar(t: Thread) {
        val son = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        while (t.state != Thread.State.BLOCKED) {
            assertTrue("iş parçacığı kilide gelmedi: ${t.state}", System.nanoTime() < son && t.isAlive)
            Thread.sleep(1)
        }
    }

    @Test
    fun ayniDepoVeYalnizSayilar() {
        yuz.onizlemeler += plan(ayniDepo = true, islem = 0, cakisan = 0, cift = 0, yeni = 0, degisen = 0)
        val o = akis.denetle()!!
        assertTrue(o.metin, o.metin.startsWith("Bu telefon daha önce bu Eren servisine bağlıydı."))
        assertFalse(o.metin, o.metin.contains("işlem olarak"))
        assertFalse(o.metin, o.metin.contains("benziyor"))
        temiz(o)
    }

    @Test
    fun hatalarAdimaCevrilir() {
        yuz.onizlemeler += CekirdekHatasi.Depo("k_gizli içerik")
        val a = akis.denetle()
        assertTrue(a is BirlestirmeAkisi.Adim.Hata)
        assertEquals("Birleştirme yapılamadı", a!!.baslik)
        assertEquals("Telefondaki kayıt deposu kullanılamadı. Yeniden deneyin.", a.metin)
        temiz(a)

        yuz.onizlemeler += plan()
        yuz.onaySonuclari += IllegalStateException("k_gizli")
        val o = onay(akis.denetle())
        val h = akis.onayla(o)
        assertEquals("Beklenmeyen bir sorun oldu. Yeniden deneyin.", h.metin)
        // Çekirdek hata verdi: uygulandığı bilinmiyor; soru açık kalır, aynı adımla yeniden denenebilir.
        assertTrue(akis.onayBekliyor)
        yuz.onaySonuclari += BirlestirmeSonucu(true, plan())
        assertEquals("Birleştirildi", akis.onayla(o).baslik)
        temiz(h)

        // Bekleyen sorgusu okuma hatasında null döner (hatayı denetle söyler).
        yuz.onizlemeler += CekirdekHatasi.Depo("k_gizli")
        assertNull(akis.bekleyen())
    }

    @Test
    fun ilgiliBildirimler() {
        fun d(tumu: Boolean = false, baglanti: Boolean = false, eslesme: Boolean = false, kayitlar: List<String> = emptyList()) =
            Degisim(kayitlar, tumu, false, baglanti, eslesme, emptyList())
        assertTrue(BirlestirmeAkisi.ilgili(d(baglanti = true)))
        assertTrue(BirlestirmeAkisi.ilgili(d(tumu = true)))
        assertTrue(BirlestirmeAkisi.ilgili(d(eslesme = true)))
        assertFalse(BirlestirmeAkisi.ilgili(d(kayitlar = listOf("k1"))))
    }

    private companion object {
        fun koparma(iptal: Boolean) = KoparmaSonucu(CalismaKipi.YEREL, 0, 0, 0, 0, iptal)
    }
}
