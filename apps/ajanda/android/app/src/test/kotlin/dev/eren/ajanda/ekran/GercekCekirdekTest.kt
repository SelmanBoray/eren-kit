package dev.eren.ajanda.ekran

import dev.eren.ajanda.KopruKaniti
import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.Gozlemci
import dev.eren.ajanda.cekirdek.IslemTuru
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.KuyrukRetNedeni
import dev.eren.ajanda.cekirdek.Sekme
import dev.eren.ajanda.cekirdek.Tasima
import dev.eren.ajanda.cekirdek.eslestirmeQrCoz
import dev.eren.ajanda.cekirdek.varsayilanHatirlatmalar
import dev.eren.ajanda.kabuk.JavaZaman
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.time.LocalDate
import java.time.ZonedDateTime

/**
 * Ekran mantığı gerçek Rust çekirdeğine karşı (JVM, JNA): elle ekleme -> listede görünme -> tamamlama ->
 * geri alma -> silme -> geri yükleme, kapatıp açınca verinin durması, gözlemci bildirimiyle yenileme ve
 * servisin kalıcı reddinden ret listesine, oradan düzeltip yeniden eklemeye.
 */
class GercekCekirdekTest {
    @get:Rule
    val gecici = TemporaryFolder()

    private val simdi = { ZonedDateTime.now() }

    private fun ac(yol: String): Cekirdek = Cekirdek.ac(yol, TestKimlik(), JavaZaman, TestAlarm())

    private class Toplayan : Gozlemci {
        val gelen = mutableListOf<Degisim>()
        override fun degisti(degisim: Degisim) {
            gelen += degisim
        }
    }

    private fun satirlar(a: AnaDenetleyici) = a.model().ogeler.filterIsInstance<Liste.Oge.Satir>().map { it.satir }

    @Test
    fun elleEklemeTamamlamaSilmeGeriYuklemeVeKalicilik() {
        val yol = gecici.newFile("ekran.sqlite3").absolutePath
        val bugun = LocalDate.now()
        ac(yol).use { c ->
            val g = Toplayan()
            c.gozlemciEkle(g)
            val yuz = CekirdekYuzu.Gercek(c)
            val a = AnaDenetleyici(yuz, simdi)
            a.hepsiniOku()
            assertTrue(satirlar(a).isEmpty())
            assertEquals("Eşleşmedi", a.model().gosterge.kisa)
            assertFalse(a.model().eslesmeVar)

            // Form -> govdeyiHazirla -> ekle (çevrimdışı, eşleşme yok: yerelde uygulanır, kuyruğa girer).
            val f = KayitFormu.yeni(KayitTuru.RANDEVU, bugun.plusDays(1), "Europe/Istanbul", varsayilanHatirlatmalar())
                .copy(baslik = "  Örnek randevu​ ")
            val id = yuz.ekle(yuz.govdeyiHazirla(f.govde()))
            val d = g.gelen.single()
            assertEquals(listOf(id), d.kayitlar)
            assertEquals(setOf(Sekme.TARIHLI), a.degisti(d))
            val s = satirlar(a).single()
            assertEquals("Örnek randevu" to id, s.baslik to s.kayitId)
            // Eşleşme yok: gönderilecek yer yok, gönderim iddiası da yok (bulgu 7).
            assertTrue(s.isaretler.toString(), s.isaretler.none { it == Liste.Isaret.GONDERILIYOR || it == Liste.Isaret.BEKLIYOR })
            assertFalse(s.aciklama.contains("gönderil"))
            assertFalse(Liste.Isaret.ASISTAN in s.isaretler)
            assertEquals("eşleşme yokken işlem kuyrukta bekler", 1, c.baglantiDurumu().kuyrukta)

            // Tamamla -> listeden çıkar (kapalılar gizli) -> geri al -> geri gelir.
            g.gelen.clear()
            val tamam = a.durumDegistir(id, KayitDurumu.TAMAM)
            assertFalse(tamam.hata)
            a.degisti(g.gelen.reduce { x, y -> Yenileme.birlestir(x, y) })
            assertTrue(satirlar(a).isEmpty())
            a.kapalilariGoster(true)
            assertTrue(satirlar(a).single().kapali)
            a.kapalilariGoster(false)
            g.gelen.clear()
            a.geriAl(tamam.geriAlma!!)
            a.degisti(g.gelen.reduce { x, y -> Yenileme.birlestir(x, y) })
            assertFalse(satirlar(a).single().kapali)

            // Sil -> silinenlerde -> geri yükle.
            g.gelen.clear()
            val sil = a.sil(id)
            a.degisti(g.gelen.reduce { x, y -> Yenileme.birlestir(x, y) })
            assertTrue(satirlar(a).isEmpty())
            a.gorunumSec(Gorunum.SILINENLER)
            assertTrue(satirlar(a).single().silindi)
            g.gelen.clear()
            a.geriAl(sil.geriAlma!!)
            a.degisti(g.gelen.reduce { x, y -> Yenileme.birlestir(x, y) })
            assertTrue(satirlar(a).isEmpty())
            a.gorunumSec(Gorunum.TARIHLI)
            assertEquals(listOf(id), satirlar(a).map { it.kayitId })
        }
        // Süreç öldü, uygulama yeniden açıldı: kayıt ve kuyruktaki işlemler durur.
        ac(yol).use { c ->
            val a = AnaDenetleyici(CekirdekYuzu.Gercek(c), simdi)
            a.hepsiniOku()
            assertEquals(listOf("Örnek randevu"), satirlar(a).map { it.baslik })
            assertTrue(c.baglantiDurumu().kuyrukta >= 1)
        }
    }

    private class SahteSoket : Tasima {
        val giden = mutableListOf<String>()
        override fun gonder(metin: String): Boolean {
            giden += metin
            return true
        }
        override fun kapat(neden: String) {}
    }

    private fun cerceve(tur: String, govde: String) = """{"v":2,"type":"$tur"$govde}"""

    @Test
    fun servisReddiRetListesindeGorunurDuzeltilipYenidenEklenir() {
        ac(gecici.newFile("ret.sqlite3").absolutePath).use { c ->
            val yuz = CekirdekYuzu.Gercek(c)
            val a = AnaDenetleyici(yuz, simdi)
            val g = Toplayan()
            c.gozlemciEkle(g)

            // Eşleştir, bağlan, el sıkış, telafi; canlıya geç.
            val qr = eslestirmeQrCoz(KopruKaniti.ORNEK_QR)
            c.eslestirmeBaslat(qr)
            val soket = SahteSoket()
            val nesil = c.baglantiAcildi(soket)
            c.cerceveGeldi(nesil, cerceve("pair_result", ""","ok":true,"device_id":"c_cihaz1","server_public_key":"${qr.serverPublicKey}","kapsam":"ajanda""""))
            assertTrue(soket.giden.last(), soket.giden.last().contains("\"type\":\"hello\""))
            c.cerceveGeldi(nesil, cerceve("auth_challenge", ""","server_nonce":"QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB","server_signature":"MEUCIQCq""""))
            assertTrue(soket.giden.last().contains("\"type\":\"auth_response\""))
            c.cerceveGeldi(nesil, cerceve("welcome", ""","depo_id":"d_depo1","bas_rev":0,"tam":true,"server_time_ms":1"""))
            c.cerceveGeldi(nesil, cerceve("esitlendi", ""","rev":0"""))
            assertEquals(BaglantiAsamasi.CANLI, c.baglantiDurumu().asama)
            a.hepsiniOku()
            assertEquals("Bağlı", a.model().gosterge.kisa)

            // Elle ekleme canlıyken hemen gider; PC kalıcı olarak reddeder.
            val f = KayitFormu.yeni(KayitTuru.GOREV, null, "Europe/Istanbul", emptyList()).copy(baslik = "Reddedilecek")
            val ilkId = yuz.ekle(yuz.govdeyiHazirla(f.govde()))
            val islemId = Regex("\"islem_id\":\"([^\"]+)\"").find(soket.giden.last())!!.groupValues[1]
            // Canlıyken yolda: "gönderiliyor" doğru.
            a.gorunumSec(Gorunum.TARIHSIZ)
            a.degisti(g.gelen.reduce { x, y -> Yenileme.birlestir(x, y) })
            assertTrue(Liste.Isaret.GONDERILIYOR in satirlar(a).single { it.kayitId == ilkId }.isaretler)
            g.gelen.clear()
            c.cerceveGeldi(nesil, cerceve("islem_sonucu", ""","islem_id":"$islemId","ok":false,"code":"saat_dilimi_bilinmiyor""""))
            val d = g.gelen.reduce { x, y -> Yenileme.birlestir(x, y) }
            assertTrue(d.retListesi)
            a.degisti(d)

            // Sessizce kaybolmaz: ret listesinde, gövdesiyle; iyimser kayıt geri alındı.
            val m = a.model()
            assertEquals(1, m.retSayisi)
            assertTrue(c.kayit(ilkId) == null || c.kayit(ilkId)!!.kayit.silindi)
            val r = c.retListesi().single()
            assertEquals(Triple(IslemTuru.EKLE, KuyrukRetNedeni.SAAT_DILIMI_BILINMIYOR, "Reddedilecek"), Triple(r.islem, r.neden, r.govde?.baslik))
            a.gorunumSec(Gorunum.RET)
            val satir = a.model().retSatirlari.single()
            assertTrue(satir.duzeltilebilir)
            assertEquals("PC saat dilimini tanımadı.", satir.neden)

            // Düzelt formu ret gövdesiyle açılır; kaydedince yeni kayıt + ret girdisi atılır.
            val form = KayitFormu.govdeden(r.govde!!, "Europe/Istanbul").copy(baslik = "Düzeltildi")
            val yeniId = RetListesi.duzelt(yuz, r.islemId, yuz.govdeyiHazirla(form.govde()))
            assertTrue(c.retListesi().isEmpty())
            assertNotNull(c.kayit(yeniId))
            assertEquals("Düzeltildi", c.kayit(yeniId)!!.kayit.baslik)
            a.degisti(g.gelen.reduce { x, y -> Yenileme.birlestir(x, y) })
            assertEquals(0, a.model().retSayisi)

            // Bağlantı koptu: eşleşmiş ama çevrimdışı; yeni değişiklik "PC'yi bekliyor", gönderiliyor değil.
            c.baglantiKapandi(nesil, null)
            g.gelen.clear()
            val bekleyenId = yuz.ekle(yuz.govdeyiHazirla(f.copy(baslik = "Bekleyen").govde()))
            a.gorunumSec(Gorunum.TARIHSIZ)
            a.degisti(g.gelen.reduce { x, y -> Yenileme.birlestir(x, y) })
            val s = satirlar(a).single { it.kayitId == bekleyenId }
            assertTrue(s.isaretler.toString(), Liste.Isaret.BEKLIYOR in s.isaretler)
            assertFalse(Liste.Isaret.GONDERILIYOR in s.isaretler)
            assertTrue(s.aciklama, s.aciklama.contains("gönderilmeyi bekliyor"))
        }
    }

    @Test
    fun formNotuGercekCekirdeginGunHatirlatmasindanGelir() {
        val yol = gecici.newFile("onizleme.sqlite3").absolutePath
        val bugun = LocalDate.now()
        ac(yol).use { c ->
            val yuz = CekirdekYuzu.Gercek(c)
            val yarin = KayitFormu.yeni(KayitTuru.GOREV, bugun.plusDays(1), "Europe/Istanbul", varsayilanHatirlatmalar())
                .copy(baslik = "Araba yıkama")
            val aksam = yarin.bolumVer(dev.eren.ajanda.cekirdek.GunBolumu.AKSAM)
            val o = yuz.hatirlatmaOnizlemesi(aksam.govde())
            assertEquals(bugun.plusDays(1).toString(), o.gunHatirlatmasi!!.tarih)
            assertEquals("17:00", o.gunHatirlatmasi!!.saat)
            assertEquals("Yarın 17:00'de hatırlatılır.", KayitFormu.hatirlatmaNotu(aksam, o, bugun))
            assertEquals("09:00", yuz.hatirlatmaOnizlemesi(yarin.govde()).gunHatirlatmasi!!.saat)
            // Elle eklenen saatsiz kayıt gerçekten alarm kurar (v1'de kurmazdı).
            val alarm = TestAlarm()
            Cekirdek.ac(gecici.newFile("alarm.sqlite3").absolutePath, TestKimlik(), JavaZaman, alarm).use { c2 ->
                c2.ekle(aksam.govde(), dev.eren.ajanda.cekirdek.GirdiYolu.ELLE)
                assertEquals(1, alarm.kurulan.size)
            }
        }
    }
}
