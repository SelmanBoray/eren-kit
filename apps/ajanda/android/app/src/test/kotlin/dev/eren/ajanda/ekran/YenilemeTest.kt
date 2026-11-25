package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.IslemTuru
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitGovdesi
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.KuyrukRetNedeni
import dev.eren.ajanda.cekirdek.RetGirdisi
import dev.eren.ajanda.cekirdek.Sekme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

/** Gözlemci bildiriminde yalnız gerekenin yenilenmesi ve ret listesi akışı (sahte çekirdekle, çağrı sayarak). */
class YenilemeTest {
    private val simdi = ZonedDateTime.of(2026, 11, 26, 10, 0, 0, 0, ZoneId.of("Europe/Istanbul"))

    private fun d(
        kayitlar: List<String> = emptyList(),
        tumu: Boolean = false,
        ret: Boolean = false,
        baglanti: Boolean = false,
        eslesme: Boolean = false,
        gecmis: List<String> = emptyList(),
    ) = Degisim(kayitlar, tumu, ret, baglanti, eslesme, gecmis)

    @Test
    fun birlestirmeHepsiniTasir() {
        val a = d(kayitlar = listOf("a", "b"), baglanti = true)
        val b = d(kayitlar = listOf("b", "c"), ret = true, gecmis = listOf("a"))
        assertEquals(d(kayitlar = listOf("a", "b", "c"), ret = true, baglanti = true, gecmis = listOf("a")), Yenileme.birlestir(a, b))
        assertEquals(b, Yenileme.birlestir(null, b))
    }

    @Test
    fun uyelikCekirdekSuzgeciyleAyni() {
        val tarihli = kayit("t", zaman = gun("2026-11-26"))
        assertTrue(Yenileme.uyeMi(Sekme.TARIHLI, tarihli, false))
        assertFalse(Yenileme.uyeMi(Sekme.TARIHSIZ, tarihli, false))
        val bitmis = tarihli.copy(durum = KayitDurumu.TAMAM)
        assertFalse(Yenileme.uyeMi(Sekme.TARIHLI, bitmis, false))
        assertTrue(Yenileme.uyeMi(Sekme.TARIHLI, bitmis, true))
        val silinmis = bitmis.copy(silindi = true)
        assertFalse(Yenileme.uyeMi(Sekme.TARIHLI, silinmis, true))
        assertTrue("silinenler kapalıları da gösterir", Yenileme.uyeMi(Sekme.SILINENLER, silinmis, false))
        assertTrue(Yenileme.uyeMi(Sekme.TARIHSIZ, kayit("b", zaman = dev.eren.ajanda.cekirdek.AjandaZamani.Belirsiz("bir ara")), false))
        assertTrue(Yenileme.uyeMi(Sekme.TASLAKLAR, kayit("s", taslak = true), false))
    }

    private fun hazir(): Pair<SahteYuz, AnaDenetleyici> {
        val y = SahteYuz()
        y.kayitlar["t1"] = kayit("t1", zaman = gun("2026-11-26"))
        y.kayitlar["s1"] = kayit("s1")
        y.kayitlar["taslak"] = kayit("taslak", taslak = true)
        val a = AnaDenetleyici(y) { simdi }
        a.hepsiniOku()
        y.sifirla()
        return y to a
    }

    @Test
    fun ilgisizKayitDegisimiListeyiSorgulatmaz() {
        val (y, a) = hazir()
        // Tarihliler görünürken tarihsiz bir kayıt değişti: yalnız o kayıt okunur.
        y.kayitlar["s1"] = y.kayitlar.getValue("s1").copy(baslik = "değişti")
        assertEquals(emptySet<Sekme>(), a.degisti(d(kayitlar = listOf("s1"))))
        assertEquals(listOf("kayit:s1"), y.cagrilar)
    }

    @Test
    fun gorunenListedekiKayitDegisinceYalnizOListe() {
        val (y, a) = hazir()
        y.kayitlar["t1"] = y.kayitlar.getValue("t1").copy(durum = KayitDurumu.TAMAM)
        assertEquals(setOf(Sekme.TARIHLI), a.degisti(d(kayitlar = listOf("t1"))))
        assertEquals(listOf("kayit:t1", "liste:TARIHLI"), y.cagrilar)
        assertTrue(a.model().ogeler.none { it is Liste.Oge.Satir && it.satir.kayitId == "t1" })
    }

    @Test
    fun listeyeYeniGirenKayitIcinSorgulanir() {
        val (y, a) = hazir()
        y.kayitlar["yeni"] = kayit("yeni", zaman = gun("2026-11-27"), taslak = true)
        assertEquals(setOf(Sekme.TARIHLI, Sekme.TASLAKLAR), a.degisti(d(kayitlar = listOf("yeni"))))
        assertEquals(2, a.model().taslakSayisi)
    }

    @Test
    fun baglantiVeRetYalnizKendiSorgusu() {
        val (y, a) = hazir()
        a.degisti(d(baglanti = true))
        assertEquals(listOf("baglantiDurumu"), y.cagrilar)
        y.sifirla()
        a.degisti(d(ret = true))
        assertEquals(setOf("retListesi", "baglantiDurumu"), y.cagrilar.toSet())
        y.sifirla()
        a.degisti(d(eslesme = true))
        assertEquals(setOf("eslesmeDurumu", "baglantiAdresi", "baglantiDurumu"), y.cagrilar.toSet())
        y.sifirla()
        a.degisti(d(tumu = true))
        assertTrue(y.cagrilar.containsAll(listOf("liste:TARIHLI", "liste:TASLAKLAR", "retListesi", "eslesmeDurumu")))
        assertFalse("yüklü olmayan liste sorgulanmaz", y.cagrilar.contains("liste:TARIHSIZ"))
    }

    @Test
    fun gorunmeyenListeBayatlanirGosterilinceOkunur() {
        val (y, a) = hazir()
        a.gorunumSec(Gorunum.TARIHSIZ)
        a.gorunumSec(Gorunum.TARIHLI)
        y.sifirla()
        // Tarihsiz yüklü ama görünmüyor: değişince sorgulanmaz, atılır.
        y.kayitlar["s1"] = y.kayitlar.getValue("s1").copy(durum = KayitDurumu.TAMAM)
        assertEquals(emptySet<Sekme>(), a.degisti(d(kayitlar = listOf("s1"))))
        assertEquals(listOf("kayit:s1"), y.cagrilar)
        y.sifirla()
        a.gorunumSec(Gorunum.TARIHSIZ)
        assertEquals(listOf("liste:TARIHSIZ"), y.cagrilar)
        // Bayat olmayan liste yeniden sorgulanmaz.
        y.sifirla()
        a.gorunumSec(Gorunum.TARIHLI)
        assertEquals(emptyList<String>(), y.cagrilar)
    }

    @Test
    fun islemlerGeriAlinabilir() {
        val (y, a) = hazir()
        val s = a.durumDegistir("t1", KayitDurumu.TAMAM)
        assertEquals(GeriAlma.Durum("t1", KayitDurumu.ACIK), s.geriAlma)
        assertTrue(s.mesaj!!.contains("tamamlandı"))
        a.geriAl(s.geriAlma!!)
        assertEquals(KayitDurumu.ACIK, y.kayitlar.getValue("t1").durum)
        val sil = a.sil("s1")
        assertEquals(GeriAlma.GeriYukle("s1"), sil.geriAlma)
        a.geriAl(sil.geriAlma!!)
        assertFalse(y.kayitlar.getValue("s1").silindi)
        // Hata kullanıcı mesajına çevrilir, fırlatılmaz.
        val h = a.sil("yok")
        assertTrue(h.hata)
    }

    // -------------------------------------------------------------------------------------------
    // Ret listesi
    // -------------------------------------------------------------------------------------------

    private val govde = KayitGovdesi(KayitTuru.GOREV, "Düzeltilmiş", null, null, emptyList(), null)

    private fun ret(islem: IslemTuru, kayitId: String, g: KayitGovdesi? = govde) =
        RetGirdisi("i_$kayitId", kayitId, islem, KuyrukRetNedeni.SAAT_DILIMI_BILINMIYOR, g, 1_000)

    @Test
    fun retSatiri() {
        val r = RetListesi.satir(ret(IslemTuru.EKLE, "k1"), simdi.toInstant().toEpochMilli(), simdi.zone)
        assertEquals("Düzeltilmiş", r.baslik)
        assertEquals("Ekleme", r.islemMetni)
        assertEquals("PC saat dilimini tanımadı.", r.neden)
        assertTrue(r.duzeltilebilir)
        val govdesiz = RetListesi.satir(ret(IslemTuru.SIL, "k_abcdef123", null), 0, simdi.zone)
        assertFalse(govdesiz.duzeltilebilir)
        assertEquals("Kayıt def123", govdesiz.baslik)
        KuyrukRetNedeni.values().forEach { assertTrue(EkranMetinleri.retNedeni(it).isNotBlank()) }
    }

    @Test
    fun eklemeReddiYeniKayitOlarakDuzeltilirSonraAtilir() {
        val y = SahteYuz()
        y.ret += ret(IslemTuru.EKLE, "k_eski")
        val id = RetListesi.duzelt(y, "i_k_eski", govde)
        assertEquals(listOf("retListesi", "kayit:k_eski", "ekle", "retAt:i_k_eski"), y.cagrilar)
        assertEquals("Düzeltilmiş", y.kayitlar.getValue(id).baslik)
        assertTrue(y.ret.isEmpty())
    }

    @Test
    fun duranKaydinDuzenlemeReddiAyniKaydaUygulanir() {
        val y = SahteYuz()
        y.kayitlar["k1"] = kayit("k1")
        y.ret += ret(IslemTuru.GUNCELLE, "k1")
        assertEquals("k1", RetListesi.duzelt(y, "i_k1", govde))
        assertTrue(y.cagrilar.contains("duzenle:k1"))
        assertFalse(y.cagrilar.contains("ekle"))
        assertEquals(1, y.kayitlar.size)
        // Kayıt silinmişse düzenleme yeni kayıt olur.
        y.kayitlar["k2"] = kayit("k2", silindi = true)
        assertTrue(RetListesi.hedef(ret(IslemTuru.GUNCELLE, "k2"), y.kayitlar["k2"]) is RetListesi.Hedef.YeniKayit)
    }

    @Test
    fun yazmaBasarisizsaRetGirdisiDurur() {
        val y = SahteYuz()
        y.ret += ret(IslemTuru.EKLE, "k_eski")
        y.ekleHatasi = dev.eren.ajanda.cekirdek.CekirdekHatasi.GecersizGirdi("zaman.saat_dilimi", "IANA dilim biçimi değil")
        try {
            RetListesi.duzelt(y, "i_k_eski", govde)
            fail("hata yutuldu")
        } catch (e: dev.eren.ajanda.cekirdek.CekirdekHatasi.GecersizGirdi) {
            assertEquals(FormAlani.DILIM, KayitFormu.hataMesaji(e).alan)
        }
        assertFalse(y.cagrilar.any { it.startsWith("retAt") })
        assertEquals(1, y.ret.size)
    }

    @Test
    fun retGorunumuModeli() {
        val (y, a) = hazir()
        y.ret += ret(IslemTuru.EKLE, "k9")
        a.degisti(d(ret = true))
        assertEquals(1, a.model().retSayisi)
        a.gorunumSec(Gorunum.RET)
        assertEquals(listOf("Düzeltilmiş"), a.model().retSatirlari.map { it.baslik })
    }
}
