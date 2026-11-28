package dev.eren.ajanda.aktarma

import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.DisaAktarma
import dev.eren.ajanda.cekirdek.IceAktarmaOnizlemesi
import dev.eren.ajanda.cekirdek.IceAktarmaSonucu
import dev.eren.ajanda.ekran.CekirdekYuzu
import dev.eren.ajanda.ekran.SahteYuz
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Akış denetleyicisi sahte çekirdek yüzüyle: adımlar, metinler, yeniden önizleme dalı, hatalar. */
class AktarmaAkisiTest {
    private val dilim = ZoneId.of("Europe/Istanbul")
    private val metinler = AktarmaMetinleri(dilim)
    private val yuz = SahteYuz()
    private val akis = AktarmaAkisi(yuz, metinler)

    /** İçerik: metinlere ve günlüğe girmemesi gereken başlık. */
    private val gizli = "Gizli doktor randevusu"
    private val belge = """{"bicim":"eren_ajanda_yedegi","kayitlar":[{"baslik":"$gizli"}]}"""
    private val anMs = ZonedDateTime.of(2026, 11, 27, 14, 5, 0, 0, dilim).toInstant().toEpochMilli()

    private fun plan(
        yeni: Int = 2,
        guncellenecek: Int = 1,
        kip: CalismaKipi = CalismaKipi.YEREL,
        iz: String = "iz1",
        islem: Int = 0,
        gonderilmeyecek: Int = 0,
        silinecek: Int = 0,
        geriYuklenecek: Int = 0,
        taslak: Int = 0,
        onaylanacak: Int = 0,
        okunamayanRet: Int = 0,
        taslagaDonecek: Int = 0,
        retGelecek: Int = 0,
        retGecersiz: Int = 0,
    ) = IceAktarmaOnizlemesi(
        kip = kip, disaAktarmaMs = anMs, toplam = 10, silinmis = 1, yeni = yeni, guncellenecek = guncellenecek,
        ayni = 4, atlanacak = 1, gecersiz = 1, sinirAsan = 0, gonderilmeyecek = gonderilmeyecek,
        kuyrugaGirecekIslem = islem, gecersizler = emptyList(), ekler = emptyList(), iz = iz,
        silinecek = silinecek, geriYuklenecek = geriYuklenecek, taslakGonderilmeyecek = taslak,
        taslakOnaylanacak = onaylanacak, okunamayanRetListesine = okunamayanRet, taslagaDonecek = taslagaDonecek,
        retListesineGelecek = retGelecek, retGecersiz = retGecersiz,
    )

    private fun kap(b: String = belge): ByteArray {
        val c = ByteArrayOutputStream()
        YedekKabi.yaz(c, yuz.bicim, DisaAktarma(b, 1, 0, 0, 0, CalismaKipi.YEREL, emptyList()), EkDeposu.Yok)
        return c.toByteArray()
    }

    private fun AktarmaAkisi.Adim.hepsi() = "$baslik\n$metin"

    private fun temiz(a: AktarmaAkisi.Adim) {
        val t = a.hepsi()
        assertFalse(t, t.contains(gizli))
        assertFalse(t, Regex("\\bPC\\b").containsMatchIn(t))
    }

    @Test
    fun disaAktarKabaYazarVeSonucuSoyler() {
        yuz.disa = DisaAktarma(belge, 3, 1, 0, 2, CalismaKipi.BAGLI, emptyList())
        val cikti = ByteArrayOutputStream()
        val a = akis.disaAktar({ cikti })
        assertTrue(a is AktarmaAkisi.Adim.Bilgi)
        assertEquals(
            "3 kayıt yedeğe yazıldı (1 silinmiş kayıt dahil).\n" +
                "Eren servisine henüz gitmemiş değişiklikler de yedekte.\n" +
                "Gönderilemeyenler listesindeki 2 değişiklik yedeğe girmedi; önce onları düzeltin ya da atın.",
            a.metin,
        )
        assertEquals(belge, YedekKabi.oku(ByteArrayInputStream(cikti.toByteArray()), yuz.bicim).belge)
        temiz(a)
    }

    @Test
    fun disaAktarYazilamazsaYarimDosyaSilinir() {
        yuz.disa = DisaAktarma(belge, 1, 0, 0, 0, CalismaKipi.YEREL, emptyList())
        var silindi = false
        val bozuk = object : OutputStream() {
            override fun write(b: Int) = throw IOException("disk dolu")
        }
        val a = akis.disaAktar({ bozuk }) { silindi = true }
        assertTrue(a is AktarmaAkisi.Adim.Hata)
        assertEquals("Dosya yazılamadı. Başka bir yer seçip yeniden deneyin.", a.metin)
        assertTrue(silindi)
    }

    @Test
    fun iceAktarmaOnizlemeOnayVeSonuc() {
        yuz.onizlemeler += plan()
        yuz.iceSonuclari += IceAktarmaSonucu(true, plan())
        val o = akis.dosyaOku { ByteArrayInputStream(kap()) }
        assertTrue(o.toString(), o is AktarmaAkisi.Adim.Onay)
        assertEquals("İçe aktarılsın mı?", o.baslik)
        assertEquals(
            "27 Kasım 2026 14:05 tarihli yedek: 10 kayıt.\n" +
                "• 2 yeni kayıt eklenecek\n" +
                "• 1 kayıt güncellenecek (yedekteki daha yeni)\n" +
                "• 4 kayıt telefondakiyle aynı\n" +
                "• 1 kayıt atlanacak (telefondaki daha yeni)\n" +
                "• 1 kayıt okunamadı, alınmayacak\n" +
                "Kayıtlar bu telefona yazılacak.",
            o.metin,
        )
        assertTrue(akis.onayBekliyor)
        temiz(o)

        val s = akis.onayla()
        assertTrue(s is AktarmaAkisi.Adim.Bilgi)
        assertEquals("2 yeni kayıt eklendi, 1 kayıt güncellendi.\n1 kayıt okunamadığı için alınmadı.", s.metin)
        assertEquals(listOf("iceAktarmaOnizlemesi", "iceAktar:iz1"), yuz.cagrilar)
        assertEquals(listOf(belge), yuz.iceBelgeleri)
        assertFalse(akis.onayBekliyor)
        temiz(s)
    }

    @Test
    fun uygulanmadiysaYeniPlanGosterilirYeniIzleUygulanir() {
        yuz.onizlemeler += plan(iz = "iz1")
        yuz.iceSonuclari += IceAktarmaSonucu(false, plan(yeni = 1, iz = "iz2"))
        yuz.iceSonuclari += IceAktarmaSonucu(true, plan(yeni = 1, iz = "iz2"))
        assertTrue(akis.dosyaOku { ByteArrayInputStream(kap()) } is AktarmaAkisi.Adim.Onay)

        val yeniden = akis.onayla()
        assertTrue(yeniden is AktarmaAkisi.Adim.Onay)
        assertEquals("Telefon bu arada değişti", yeniden.baslik)
        assertTrue(yeniden.metin, yeniden.metin.startsWith("Önizlemeden sonra telefondaki kayıtlar değişti; plan yenilendi.\n"))
        assertTrue(yeniden.metin, yeniden.metin.contains("• 1 yeni kayıt eklenecek"))

        val s = akis.onayla()
        assertTrue(s is AktarmaAkisi.Adim.Bilgi)
        assertEquals(listOf("iceAktarmaOnizlemesi", "iceAktar:iz1", "iceAktar:iz2"), yuz.cagrilar)
    }

    @Test
    fun bagliKipteEdenServisineGidecekIslemSayisi() {
        yuz.onizlemeler += plan(kip = CalismaKipi.BAGLI, islem = 7, gonderilmeyecek = 2)
        yuz.iceSonuclari += IceAktarmaSonucu(true, plan(kip = CalismaKipi.BAGLI, islem = 7))
        val o = akis.dosyaOku { ByteArrayInputStream(kap()) }
        assertTrue(o.metin, o.metin.contains("• 2 silinmiş kayıt Eren servisine gönderilmeyecek"))
        assertTrue(o.metin, o.metin.contains("Değişiklikler Eren servisine 7 işlem olarak gönderilecek"))
        temiz(o)
        val s = akis.onayla()
        assertTrue(s.metin, s.metin.contains("7 işlem Eren servisine gönderilmek üzere sıraya alındı."))
        temiz(s)
    }

    @Test
    fun silinecekGeriYuklenecekGuncellenecekAltMaddesiTaslakAlinmaz() {
        yuz.onizlemeler += plan(kip = CalismaKipi.BAGLI, islem = 3, guncellenecek = 5, silinecek = 2, geriYuklenecek = 1, taslak = 4)
        yuz.iceSonuclari += IceAktarmaSonucu(true, plan(kip = CalismaKipi.BAGLI, islem = 3, guncellenecek = 5, taslak = 4))
        val o = akis.dosyaOku { ByteArrayInputStream(kap()) }
        // Silinecek ve geri yüklenecek, güncellenecek 5'in içindedir: kardeş madde değil, "bunlardan" alt maddesi.
        assertTrue(
            o.metin,
            o.metin.contains(
                "• 5 kayıt güncellenecek (yedekteki daha yeni)\n" +
                    "   – bunlardan 2 kayıt silinecek (yedekteki daha yeni hali silinmiş)\n" +
                    "   – bunlardan 1 kayıt geri yüklenecek (telefonda silinmiş, yedekteki daha yeni hali geri gelecek)\n",
            ),
        )
        assertFalse(o.metin, o.metin.contains("• 2 kayıt silinecek"))
        // Bağlı kipte taslak hiç alınmaz (servise gitmez, telefona da yazılmaz).
        assertTrue(o.metin, o.metin.contains("• 4 taslak alınmayacak (Eren servisi taslak kabul etmez; yedek dosyasında kalır)"))
        assertFalse(o.metin, o.metin.contains("taslak Eren servisine gönderilmeyecek"))
        temiz(o)
        val s = akis.onayla(o as AktarmaAkisi.Adim.Onay)
        assertTrue(s.metin, s.metin.contains("4 taslak alınmadı; Eren servisi taslak kabul etmez."))
        temiz(s)
    }

    @Test
    fun onayAdiminIziyleYapilirCiftDokunmaCekirdegeGitmez() {
        yuz.onizlemeler += plan(iz = "iz1")
        yuz.iceSonuclari += IceAktarmaSonucu(true, plan(iz = "iz1"))
        val o = akis.dosyaOku { ByteArrayInputStream(kap()) } as AktarmaAkisi.Adim.Onay
        assertEquals("iz1", o.iz)
        val s1 = akis.onayla(o)
        val s2 = akis.onayla(o)
        assertEquals("İçe aktarıldı", s1.baslik)
        assertEquals(s1, s2)
        assertEquals(1, yuz.cagrilar.count { it.startsWith("iceAktar:") })
    }

    @Test
    fun eskiAdimlaOnayEskiIzleGiderYeniPlanSorulur() {
        yuz.onizlemeler += plan(iz = "iz2")
        yuz.iceSonuclari += IceAktarmaSonucu(false, plan(iz = "iz3", yeni = 7))
        akis.dosyaOku { ByteArrayInputStream(kap()) }
        // Ekranda daha eski bir plan kalmış: onun iziyle gider, çekirdek uygulamaz, yeni plan sorulur.
        val eski = AktarmaAkisi.Adim.Onay("İçe aktarılsın mı?", "eski", "İçe aktar", "iz1")
        val yeni = akis.onayla(eski)
        assertTrue(yeni is AktarmaAkisi.Adim.Onay)
        assertEquals("iz3", (yeni as AktarmaAkisi.Adim.Onay).iz)
        assertTrue(yeni.metin, yeni.metin.contains("• 7 yeni kayıt eklenecek"))
        assertEquals(listOf("iceAktarmaOnizlemesi", "iceAktar:iz1"), yuz.cagrilar)
        assertTrue(akis.onayBekliyor)
    }

    @Test
    fun uygulandiktanSonraMetinKurulamazsaYapilamadiDenmez() {
        val bozuk = object : AktarmaMetinleri(dilim) {
            override fun iceSonucu(p: IceAktarmaOnizlemesi): String = throw IllegalStateException("biçim")
        }
        val a = AktarmaAkisi(yuz, bozuk)
        yuz.onizlemeler += plan()
        yuz.iceSonuclari += IceAktarmaSonucu(true, plan())
        val o = a.dosyaOku { ByteArrayInputStream(kap()) } as AktarmaAkisi.Adim.Onay
        val s = a.onayla(o)
        assertTrue(s is AktarmaAkisi.Adim.Bilgi)
        assertEquals("İçe aktarıldı", s.baslik)
        assertEquals("Yedekteki kayıtlar içe aktarıldı.", s.metin)
        assertFalse(a.onayBekliyor)
    }

    /** Bayt API'li sahte çekirdek: gelen baytları kaydeder, sonucu [SahteYuz]'den alır (o da çağrıyı sayar). */
    private inner class BaytCekirdegi : AktarmaCekirdegi {
        val gelenler = mutableListOf<ByteArray>()
        override fun aktarmaBicimi() = yuz.aktarmaBicimi()
        override fun disaAktar() = yuz.disaAktar()
        override fun iceAktarmaOnizlemesiBayt(belge: ByteArray): IceAktarmaOnizlemesi {
            gelenler += belge
            return yuz.iceAktarmaOnizlemesi("")
        }
        override fun iceAktarBayt(belge: ByteArray, iz: String?): IceAktarmaSonucu {
            gelenler += belge
            return yuz.iceAktar("", iz)
        }
    }

    @Test
    fun baytYoluBelgeyiKaptakiBaytlarlaVerirAdimlarAyni() {
        val bc = BaytCekirdegi()
        val a = AktarmaAkisi(bc, metinler)
        yuz.onizlemeler += plan()
        yuz.iceSonuclari += IceAktarmaSonucu(true, plan())
        val o = a.dosyaOku { ByteArrayInputStream(kap()) } as AktarmaAkisi.Adim.Onay
        assertEquals(akisAdimi(), o)
        val s = a.onayla(o)
        assertEquals("2 yeni kayıt eklendi, 1 kayıt güncellendi.\n1 kayıt okunamadığı için alınmadı.", s.metin)
        assertEquals(listOf("iceAktarmaOnizlemesi", "iceAktar:iz1"), yuz.cagrilar)
        assertEquals(2, bc.gelenler.size)
        // Önizleme ve uygulama aynı diziyi alır (kopya yok), içeriği belgenin UTF-8'i.
        assertTrue(bc.gelenler[0] === bc.gelenler[1])
        assertArrayEquals(belge.toByteArray(Charsets.UTF_8), bc.gelenler[0])
    }

    /** Aynı kap ve plan için eski (yüz) yolun ilk adımı. */
    private fun akisAdimi(): AktarmaAkisi.Adim {
        val y = SahteYuz()
        y.onizlemeler += plan()
        return AktarmaAkisi(y, metinler).dosyaOku { ByteArrayInputStream(kap()) }
    }

    @Test
    fun baytYoluCekirdeginUtf8HatasiGecersizDenir() {
        val bc = object : AktarmaCekirdegi by BaytCekirdegi() {
            override fun iceAktarmaOnizlemesiBayt(belge: ByteArray): IceAktarmaOnizlemesi =
                throw CekirdekHatasi.GecersizGirdi("belge", "UTF-8 değil (bayt 3)")
        }
        val a = AktarmaAkisi(bc, metinler).dosyaOku { ByteArrayInputStream(kap()) }
        assertTrue(a is AktarmaAkisi.Adim.Hata)
        assertEquals("Bu dosya bir ajanda yedeği değil ya da bozuk.", a.metin)
    }

    @Test
    fun esZamanliOnaylarTekIceAktarma() {
        val kapi = CountDownLatch(1)
        val girdi = CountDownLatch(1)
        val icerde = AtomicInteger()
        val azami = AtomicInteger()
        val bekleten = object : CekirdekYuzu by yuz {
            override fun iceAktar(belge: String, iz: String?): IceAktarmaSonucu {
                azami.accumulateAndGet(icerde.incrementAndGet(), ::maxOf)
                try {
                    girdi.countDown()
                    assertTrue(kapi.await(10, TimeUnit.SECONDS))
                    return yuz.iceAktar(belge, iz)
                } finally {
                    icerde.decrementAndGet()
                }
            }
        }
        val a = AktarmaAkisi(bekleten, metinler)
        yuz.onizlemeler += plan()
        yuz.iceSonuclari += IceAktarmaSonucu(true, plan())
        val o = a.dosyaOku { ByteArrayInputStream(kap()) } as AktarmaAkisi.Adim.Onay
        val sonuclar = Collections.synchronizedList(mutableListOf<AktarmaAkisi.Adim>())
        val t1 = Thread { sonuclar += a.onayla(o) }.apply { start() }
        assertTrue(girdi.await(10, TimeUnit.SECONDS))
        val t2 = Thread { sonuclar += a.onayla(o) }.apply { start() }
        val son = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        while (t2.state != Thread.State.BLOCKED) {
            assertTrue("${t2.state}", System.nanoTime() < son && t2.isAlive)
            Thread.sleep(1)
        }
        kapi.countDown()
        t1.join(10_000)
        t2.join(10_000)
        assertEquals(1, azami.get())
        assertEquals(1, yuz.cagrilar.count { it.startsWith("iceAktar:") })
        assertEquals(2, sonuclar.size)
        assertTrue("$sonuclar", sonuclar.all { it is AktarmaAkisi.Adim.Bilgi && it.baslik == "İçe aktarıldı" })
    }

    @Test
    fun sifirsaSilinecekGeriYuklenecekVeTaslakSatiriYok() {
        yuz.onizlemeler += plan()
        val o = akis.dosyaOku { ByteArrayInputStream(kap()) }
        assertFalse(o.metin, o.metin.contains("silinecek"))
        assertFalse(o.metin, o.metin.contains("geri yüklenecek"))
        assertFalse(o.metin, o.metin.contains("taslak"))
    }

    @Test
    fun yapilacakBirSeyYoksaOnayIstenmez() {
        yuz.onizlemeler += plan(yeni = 0, guncellenecek = 0)
        val o = akis.dosyaOku { ByteArrayInputStream(kap()) }
        assertTrue(o is AktarmaAkisi.Adim.Bilgi)
        assertTrue(o.metin, o.metin.endsWith("Telefona eklenecek ya da güncellenecek kayıt yok."))
        assertFalse(akis.onayBekliyor)
        assertTrue(akis.onayla() is AktarmaAkisi.Adim.Hata)
        assertFalse(yuz.cagrilar.any { it.startsWith("iceAktar:") })
    }

    @Test
    fun vazgecilenDosyaUygulanmaz() {
        yuz.onizlemeler += plan()
        akis.dosyaOku { ByteArrayInputStream(kap()) }
        akis.vazgec()
        assertEquals(metinler.bekleyenYok, akis.onayla().metin)
        assertFalse(yuz.cagrilar.any { it.startsWith("iceAktar:") })
    }

    @Test
    fun hataMetinleri() {
        val gecersiz = "Bu dosya bir ajanda yedeği değil ya da bozuk."
        val dahaYeni = "Bu yedek uygulamanın daha yeni bir sürümüyle yapılmış. İçe aktarmak için uygulamayı güncelleyin."
        val buyuk = "Dosya çok büyük; bir ajanda yedeği bu kadar büyük olamaz."

        // Zip değil.
        assertEquals(gecersiz, akis.dosyaOku { ByteArrayInputStream("düz metin".toByteArray()) }.metin)
        // Kap fazla büyük (sahte biçimin sınırı 1 MiB).
        val iri = ByteArrayOutputStream().also {
            YedekKabi.yaz(it, yuz.bicim.copy(belgeAzamiBayt = 1uL shl 30), DisaAktarma("x".repeat(2 shl 20), 1, 0, 0, 0, CalismaKipi.YEREL, emptyList()), EkDeposu.Yok)
        }.toByteArray()
        assertEquals(buyuk, akis.dosyaOku { ByteArrayInputStream(iri) }.metin)

        // Çekirdeğin belge hataları.
        val durumlar = listOf(
            CekirdekHatasi.GecersizGirdi("bicim_surumu", "daha yeni bir biçim: uygulamayı güncelleyin") to dahaYeni,
            CekirdekHatasi.GecersizGirdi("sozlesme_surumu", "daha yeni bir sözleşme: uygulamayı güncelleyin") to dahaYeni,
            CekirdekHatasi.GecersizGirdi("bicim", "ajanda yedeği değil") to gecersiz,
            CekirdekHatasi.GecersizGirdi("belge", "JSON değil (satır 1, sütun 2)") to gecersiz,
            CekirdekHatasi.GecersizGirdi("belge", "çok büyük") to buyuk,
            CekirdekHatasi.Depo(gizli) to "Telefondaki kayıt deposu kullanılamadı. Yeniden deneyin.",
        )
        for ((h, beklenen) in durumlar) {
            yuz.onizlemeler += h
            val a = akis.dosyaOku { ByteArrayInputStream(kap()) }
            assertTrue(a is AktarmaAkisi.Adim.Hata)
            assertEquals("İçe aktarılamadı", a.baslik)
            assertEquals(beklenen, a.metin)
            temiz(a)
        }
        // Okuma hatası.
        assertEquals("Dosya okunamadı. Yeniden deneyin.", akis.dosyaOku { throw IOException("izin yok") }.metin)
    }

    @Test
    fun bellekYetmezseSurecDusmezCokBuyukYaDaBozukDenir() {
        val beklenen = "Dosya çok büyük ya da bozuk; telefonun belleği açmaya yetmedi."
        // Okuma sırasında.
        val o = akis.dosyaOku { throw OutOfMemoryError("test") }
        assertTrue(o is AktarmaAkisi.Adim.Hata)
        assertEquals(beklenen, o.metin)

        // Çekirdeğin önizlemesi sırasında (sahte yüz OOM fırlatır).
        val oomYuz = object : CekirdekYuzu by yuz {
            var onizlemeOom = true
            override fun iceAktarmaOnizlemesi(belge: String): IceAktarmaOnizlemesi =
                if (onizlemeOom) throw OutOfMemoryError("test") else yuz.iceAktarmaOnizlemesi(belge)
            override fun iceAktar(belge: String, iz: String?): IceAktarmaSonucu = throw OutOfMemoryError("test")
            override fun disaAktar(): DisaAktarma = throw OutOfMemoryError("test")
        }
        val a2 = AktarmaAkisi(oomYuz, metinler)
        val o2 = a2.dosyaOku { ByteArrayInputStream(kap()) }
        assertEquals(beklenen, o2.metin)
        assertFalse(a2.onayBekliyor)

        // Onay sırasında: bekleyen dosya bırakılır.
        oomYuz.onizlemeOom = false
        yuz.onizlemeler += plan()
        assertTrue(a2.dosyaOku { ByteArrayInputStream(kap()) } is AktarmaAkisi.Adim.Onay)
        val s = a2.onayla()
        assertTrue(s is AktarmaAkisi.Adim.Hata)
        assertEquals(beklenen, s.metin)
        assertFalse(a2.onayBekliyor)

        // Dışa aktarırken: yarım dosya silinir.
        var silindi = false
        val d = a2.disaAktar({ ByteArrayOutputStream() }) { silindi = true }
        assertEquals("Dışa aktarılamadı", d.baslik)
        assertEquals(beklenen, d.metin)
        assertTrue(silindi)
    }

    @Test
    fun yerelKipteTaslakOnayiTaslagaDonusVeOkunamayanAltMaddeler() {
        yuz.onizlemeler += plan(guncellenecek = 6, onaylanacak = 2, taslagaDonecek = 1, okunamayanRet = 3)
        yuz.iceSonuclari += IceAktarmaSonucu(true, plan(guncellenecek = 6, onaylanacak = 2, taslagaDonecek = 1, okunamayanRet = 3))
        val o = akis.dosyaOku { ByteArrayInputStream(kap()) } as AktarmaAkisi.Adim.Onay
        assertTrue(
            o.metin,
            o.metin.contains(
                "• 6 kayıt güncellenecek (yedekteki daha yeni)\n" +
                    "   – bunlardan 2 taslak onaylanacak (yedekteki hali onaylı; hatırlatması varsa kurulur)\n" +
                    "   – bunlardan 1 kayıt taslağa dönecek (yedekteki hali onaylanmamış öneri; hatırlatmaları kalkar)\n" +
                    "   – bunlardan 3 kayıt telefonda okunamıyor: yedekteki hali yazılacak, telefondaki eski hali " +
                    "gönderilemeyenler listesine düşecek (oradan düzeltilebilir ya da atılabilir)\n",
            ),
        )
        assertFalse(o.metin, o.metin.contains("Eren servisine gönderilir"))
        temiz(o)
        val s = akis.onayla(o)
        assertEquals(
            "2 yeni kayıt eklendi, 6 kayıt güncellendi.\n" +
                "2 taslak onaylandı.\n" +
                "1 kayıt taslağa döndü; hatırlatmaları kalktı.\n" +
                "Telefonda okunamayan 3 kaydın eski hali gönderilemeyenler listesine kondu.\n" +
                "1 kayıt okunamadığı için alınmadı.",
            s.metin,
        )
        temiz(s)
    }

    @Test
    fun bagliKipteTaslakOnayiServiseGittigiSoylenir() {
        yuz.onizlemeler += plan(kip = CalismaKipi.BAGLI, islem = 4, guncellenecek = 3, onaylanacak = 2)
        yuz.iceSonuclari += IceAktarmaSonucu(true, plan(kip = CalismaKipi.BAGLI, islem = 4, guncellenecek = 3, onaylanacak = 2))
        val o = akis.dosyaOku { ByteArrayInputStream(kap()) } as AktarmaAkisi.Adim.Onay
        assertTrue(
            o.metin,
            o.metin.contains("   – bunlardan 2 taslak onaylanacak (yedekteki hali onaylı; onay Eren servisine gönderilir, hatırlatması varsa kurulur)\n"),
        )
        temiz(o)
        val s = akis.onayla(o)
        assertTrue(s.metin, s.metin.contains("2 taslağın onayı Eren servisine gönderilmek üzere sıraya alındı."))
        temiz(s)
    }

    @Test
    fun retGirdileriSayilirYalnizRetVarsaDaOnaySorulur() {
        yuz.onizlemeler += plan(retGelecek = 3, retGecersiz = 1)
        val o = akis.dosyaOku { ByteArrayInputStream(kap()) }
        assertTrue(o.metin, o.metin.contains("• Yedekteki 3 gönderilemeyen değişiklik gönderilemeyenler listesine eklenecek\n"))
        assertTrue(o.metin, o.metin.contains("• Yedekteki 1 gönderilemeyen değişiklik okunamadı, alınmayacak\n"))
        temiz(o)

        // Kayıtlar aynı ama ret girdisi gelecek: çekirdek onu yazar, onay sorulur.
        val y2 = SahteYuz()
        val a2 = AktarmaAkisi(y2, metinler)
        y2.onizlemeler += plan(yeni = 0, guncellenecek = 0, retGelecek = 2, iz = "izr")
        y2.iceSonuclari += IceAktarmaSonucu(true, plan(yeni = 0, guncellenecek = 0, retGelecek = 2, iz = "izr"))
        val o2 = a2.dosyaOku { ByteArrayInputStream(kap()) }
        assertTrue(o2.metin, o2 is AktarmaAkisi.Adim.Onay)
        assertTrue(o2.metin, o2.metin.endsWith("Kayıtlar değişmeyecek; yalnız gönderilemeyenler listesine eklenecek."))
        val s2 = a2.onayla(o2 as AktarmaAkisi.Adim.Onay)
        assertEquals(
            "Değişen kayıt olmadı.\n2 değişiklik gönderilemeyenler listesine eklendi.\n1 kayıt okunamadığı için alınmadı.",
            s2.metin,
        )
        assertEquals(listOf("iceAktarmaOnizlemesi", "iceAktar:izr"), y2.cagrilar)

        // Yalnız geçersiz ret girdisi: yapılacak bir şey yok.
        val y3 = SahteYuz()
        y3.onizlemeler += plan(yeni = 0, guncellenecek = 0, retGecersiz = 2)
        assertTrue(AktarmaAkisi(y3, metinler).dosyaOku { ByteArrayInputStream(kap()) } is AktarmaAkisi.Adim.Bilgi)
    }

    @Test
    fun sifirsaYeniSayilarinCumlesiYok() {
        yuz.onizlemeler += plan()
        yuz.iceSonuclari += IceAktarmaSonucu(true, plan())
        val o = akis.dosyaOku { ByteArrayInputStream(kap()) } as AktarmaAkisi.Adim.Onay
        val s = akis.onayla(o)
        for (t in listOf(o.metin, s.metin)) {
            for (parca in listOf("onaylan", "taslağa", "telefonda okunamayan", "telefonda okunamıyor", "gönderilemeyen")) {
                assertFalse("$parca: $t", t.contains(parca))
            }
        }
    }

    @Test
    fun disaAktarRetYedekteVeSinirAsimiSoylenir() {
        yuz.disa = DisaAktarma(belge, 3, 0, 0, 1, CalismaKipi.YEREL, emptyList(), retYedekte = 4, iceAktarmaSiniriniAsiyor = true)
        val a = akis.disaAktar({ ByteArrayOutputStream() })
        assertTrue(a.metin, a is AktarmaAkisi.Adim.Bilgi)
        assertEquals(
            "3 kayıt yedeğe yazıldı.\n" +
                "Gönderilemeyenler listesindeki 4 değişiklik de yedekte; içe aktarılınca o listeye geri gelir.\n" +
                "Gönderilemeyenler listesindeki 1 değişiklik yedeğe girmedi; önce onları düzeltin ya da atın.\n" +
                "Yedek yazıldı, ancak bu uygulama sürümünün içe aktarma sınırını aşıyor; bu sürümle geri yüklenemez.",
            a.metin,
        )
        temiz(a)
        // Sıfır ve yanlışsa cümle yok.
        yuz.disa = DisaAktarma(belge, 3, 0, 0, 0, CalismaKipi.YEREL, emptyList())
        assertEquals("3 kayıt yedeğe yazıldı.", akis.disaAktar({ ByteArrayOutputStream() }).metin)
    }

    @Test
    fun icAktarmaSiniriniAsanBelgeDeYazilir() {
        // Sahte biçimin belge sınırı 1 MiB; 2 MiB'lik belge yazılır (eskiden "çok büyük" hatasıydı).
        val iri = "x".repeat(2 shl 20)
        yuz.disa = DisaAktarma(iri, 1, 0, 0, 0, CalismaKipi.YEREL, emptyList(), iceAktarmaSiniriniAsiyor = true)
        val cikti = ByteArrayOutputStream()
        val a = akis.disaAktar({ cikti })
        assertTrue(a.metin, a is AktarmaAkisi.Adim.Bilgi)
        assertTrue(a.metin, a.metin.contains("geri yüklenemez"))
        // Aynı sürümde geri okunmaz: biçim sınırı.
        assertEquals("Dosya çok büyük; bir ajanda yedeği bu kadar büyük olamaz.", akis.dosyaOku { ByteArrayInputStream(cikti.toByteArray()) }.metin)
    }

    @Test
    fun cekirdeginCokBuyukNedeniOnekleTaninir() {
        val buyuk = "Dosya çok büyük; bir ajanda yedeği bu kadar büyük olamaz."
        // Çekirdeğin gerçek nedenleri (`motor/aktarma.rs`): sayı taşır, önekle karşılaştırılır.
        for (neden in listOf("çok büyük (en çok 64 MiB)", "çok büyük (kayıtlar dışı en çok 4 MiB)")) {
            assertEquals(neden, buyuk, metinler.hata(CekirdekHatasi.GecersizGirdi("belge", neden), yazarken = false))
            yuz.onizlemeler += CekirdekHatasi.GecersizGirdi("belge", neden)
            assertEquals(buyuk, akis.dosyaOku { ByteArrayInputStream(kap()) }.metin)
        }
        // Başka alanın "çok büyük"ü belge sınırı değildir.
        assertEquals("Bu dosya bir ajanda yedeği değil ya da bozuk.", metinler.hata(CekirdekHatasi.GecersizGirdi("kayitlar.3", "çok büyük"), false))
    }

    @Test
    fun bellekButcesiAsilincaAyriMetin() {
        val m = metinler.hata(YedekHatasi.BellekYetmez(), yazarken = false)
        assertEquals(
            "Dosya, telefonun şu an ayırabildiği bellek için çok büyük; açılmadı. Uygulamayı kapatıp yeniden açarak deneyin.",
            m,
        )
        assertFalse(Regex("\\bPC\\b").containsMatchIn(m))
    }

    @Test
    fun onerilenAdTarihli() {
        assertEquals("ajanda-yedegi-2026-11-27.zip", AktarmaAkisi.onerilenAd(LocalDate.of(2026, 11, 27)))
    }
}
