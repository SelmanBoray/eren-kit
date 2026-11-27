package dev.eren.ajanda.aktarma

import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.DisaAktarma
import dev.eren.ajanda.cekirdek.IceAktarmaOnizlemesi
import dev.eren.ajanda.cekirdek.IceAktarmaSonucu
import dev.eren.ajanda.ekran.CekirdekYuzu
import dev.eren.ajanda.ekran.SahteYuz
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
    ) = IceAktarmaOnizlemesi(
        kip = kip, disaAktarmaMs = anMs, toplam = 10, silinmis = 1, yeni = yeni, guncellenecek = guncellenecek,
        ayni = 4, atlanacak = 1, gecersiz = 1, sinirAsan = 0, gonderilmeyecek = gonderilmeyecek,
        kuyrugaGirecekIslem = islem, gecersizler = emptyList(), ekler = emptyList(), iz = iz,
        silinecek = silinecek, geriYuklenecek = geriYuklenecek, taslakGonderilmeyecek = taslak,
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
    fun onerilenAdTarihli() {
        assertEquals("ajanda-yedegi-2026-11-27.zip", AktarmaAkisi.onerilenAd(LocalDate.of(2026, 11, 27)))
    }
}
