package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.TakvimAyi
import dev.eren.ajanda.cekirdek.TakvimGunOzeti
import dev.eren.ajanda.cekirdek.TakvimOgesi
import dev.eren.ajanda.cekirdek.Tekrar
import dev.eren.ajanda.cekirdek.TekrarSikligi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Takvim sekmesinin durumu ve çekirdek konuşması (sahte çekirdekle, çağrı sayarak): hangi ay/gün ne zaman
 * sorgulanır, önbellek, "kapalılar" seçiminin ortaklığı, kayıt değişiminde yenileme, gece yarısı, seçimin
 * sekme değişimi ve kayıttan geri yüklemeyle korunması, tekrar örneğinin tamamlanıp geri alınması.
 */
class TakvimDenetleyiciTest {
    private val ist = ZoneId.of("Europe/Istanbul")
    private var simdi = ZonedDateTime.of(2026, 11, 27, 10, 0, 0, 0, ist)

    private fun t(s: String) = LocalDate.parse(s)

    private fun hazir(): Pair<SahteYuz, AnaDenetleyici> {
        val y = SahteYuz()
        val a = AnaDenetleyici(y) { simdi }
        a.hepsiniOku()
        y.sifirla()
        return y to a
    }

    private fun SahteYuz.takvimCagrilari() = cagrilar.filter { it.startsWith("takvim") }

    private fun degisim(kayitlar: List<String> = emptyList(), tumu: Boolean = false, baglanti: Boolean = false) =
        Degisim(kayitlar, tumu, false, baglanti, false, emptyList())

    @Test
    fun takvimSekmesiAyiVeBugunuOkur() {
        val (y, a) = hazir()
        a.gorunumSec(Gorunum.TAKVIM)
        assertEquals(listOf("takvimAyi:2026-11", "takvimGunu:2026-11-27"), y.takvimCagrilari())
        val m = a.model()
        assertNotNull(m.takvim)
        val tk = m.takvim!!
        assertEquals(TakvimDurumu.baslangic(t("2026-11-27")), tk.durum)
        assertEquals(YearMonth.of(2026, 11), tk.izgara.ay)
        assertEquals("Bugün · Cuma, 27 Kasım", tk.gunBasligi)
        assertEquals(0, tk.gunSayisi)
        assertEquals(listOf(Liste.Oge.Bos(Takvim.BOS_GUN)), m.ogeler)
        assertTrue("ızgara hemen çizilir", m.yuklendi)
        // Başka sekmede takvim modeli taşınmaz, seçim taşınır (kayıt için).
        a.gorunumSec(Gorunum.TARIHLI)
        assertNull(a.model().takvim)
        assertEquals(tk.durum, a.model().takvimDurumu)
    }

    @Test
    fun ayDegistirmeKomsuOnbellektenGelir() {
        val (y, a) = hazir()
        a.gorunumSec(Gorunum.TAKVIM)
        a.takvimKomsulari()
        assertEquals(setOf(YearMonth.of(2026, 10), YearMonth.of(2026, 11), YearMonth.of(2026, 12)), a.takvim.yukluAylar)
        y.sifirla()
        a.takvimAyKaydir(1)
        assertEquals("ay önbellekte: yalnız seçili gün sorgulanır", listOf("takvimGunu:2026-12-01"), y.takvimCagrilari())
        assertEquals(YearMonth.of(2026, 12), a.model().takvim!!.izgara.ay)
        y.sifirla()
        a.takvimAyKaydir(-1)
        assertEquals(listOf("takvimGunu:2026-11-27"), y.takvimCagrilari())
        // Önbellek sınırlı: uzaklara gidince eski aylar düşer.
        repeat(10) { a.takvimAyKaydir(1); a.takvimKomsulari() }
        assertTrue(a.takvim.yukluAylar.size <= TakvimDenetleyici.ENCOK_AY)
        assertTrue(YearMonth.of(2027, 9) in a.takvim.yukluAylar)
    }

    @Test
    fun gunSecimiYalnizGunuSorgular() {
        val (y, a) = hazir()
        a.gorunumSec(Gorunum.TAKVIM)
        y.sifirla()
        a.takvimGunSec(t("2026-11-15"))
        assertEquals(listOf("takvimGunu:2026-11-15"), y.takvimCagrilari())
        // Başka ayın günü (ör. ileride ızgara dışından): ay da okunur.
        y.sifirla()
        a.takvimGunSec(t("2027-01-04"))
        assertEquals(listOf("takvimAyi:2027-01", "takvimGunu:2027-01-04"), y.takvimCagrilari())
        a.takvimBugune()
        assertEquals(TakvimDurumu.baslangic(t("2026-11-27")), a.model().takvimDurumu)
    }

    @Test
    fun kapalilarSecimiTarihliSekmesiyleOrtak() {
        val (y, a) = hazir()
        a.gorunumSec(Gorunum.TAKVIM)
        y.sifirla()
        a.kapalilariGoster(true)
        assertEquals(listOf("takvimAyi:2026-11:kapalilar", "takvimGunu:2026-11-27:kapalilar"), y.takvimCagrilari())
        assertTrue(a.model().kapalilarDahil)
        assertTrue(a.model().takvim!!.kapalilarDahil)
        // Tarihli sekmesinde değiştirilen seçim takvime de geçer (gösterilince yeniden okunur).
        a.gorunumSec(Gorunum.TARIHLI)
        a.kapalilariGoster(false)
        y.sifirla()
        a.gorunumSec(Gorunum.TAKVIM)
        assertEquals(listOf("takvimAyi:2026-11", "takvimGunu:2026-11-27"), y.takvimCagrilari())
    }

    @Test
    fun kayitDegisimiTakvimiYenilerBaglantiDegisimiYenilemez() {
        val (y, a) = hazir()
        a.gorunumSec(Gorunum.TAKVIM)
        y.sifirla()
        a.degisti(degisim(baglanti = true))
        assertTrue(y.takvimCagrilari().isEmpty())
        a.degisti(degisim(kayitlar = listOf("x")))
        assertEquals(listOf("takvimAyi:2026-11", "takvimGunu:2026-11-27"), y.takvimCagrilari())
        // Takvim görünmezken değişim: önbellek atılır, gösterilince okunur.
        a.gorunumSec(Gorunum.TARIHSIZ)
        y.sifirla()
        a.degisti(degisim(tumu = true))
        assertTrue(y.takvimCagrilari().isEmpty())
        a.gorunumSec(Gorunum.TAKVIM)
        assertEquals(listOf("takvimAyi:2026-11", "takvimGunu:2026-11-27"), y.takvimCagrilari())
    }

    @Test
    fun geceYarisiBugunYeniGuneKayar() {
        simdi = ZonedDateTime.of(2026, 11, 30, 23, 59, 0, 0, ist)
        val (y, a) = hazir()
        a.gorunumSec(Gorunum.TAKVIM)
        y.sifirla()
        simdi = simdi.plusMinutes(2) // 1 Aralık 00:01; ekran dakikada bir model ister
        val m = a.model()
        assertEquals(TakvimDurumu.baslangic(t("2026-12-01")), m.takvim!!.durum)
        assertEquals(listOf("takvimAyi:2026-12", "takvimGunu:2026-12-01"), y.takvimCagrilari())
        // Başka gün seçiliyken seçim korunur, yalnız "bugün" ilerler.
        a.takvimGunSec(t("2026-12-10"))
        simdi = simdi.plusDays(1)
        val d = a.model().takvim!!.durum
        assertEquals(t("2026-12-10") to t("2026-12-02"), d.secili to d.bugun)
    }

    @Test
    fun secimSekmeDegisinceVeGeriYukleninceKorunur() {
        val (_, a) = hazir()
        a.gorunumSec(Gorunum.TAKVIM)
        a.takvimAyKaydir(2)
        a.takvimGunSec(t("2027-01-20"))
        a.gorunumSec(Gorunum.TARIHLI)
        a.gorunumSec(Gorunum.TAKVIM)
        val kayit = a.model().takvimDurumu!!
        assertEquals(t("2027-01-20"), kayit.secili)

        // Döndürme / süreç ölümü: yeni denetleyici kayıttan başlar.
        val y2 = SahteYuz()
        val b = AnaDenetleyici(y2) { simdi }
        b.takvimGeriYukle(TakvimDurumu.coz(kayit.metin())!!)
        b.gorunumSec(Gorunum.TAKVIM)
        assertEquals(listOf("takvimAyi:2027-01", "takvimGunu:2027-01-20"), y2.takvimCagrilari())
        assertEquals(kayit, b.model().takvimDurumu)

        // Gece yarısını kayıtta geçiren "bugün" seçimi yeni güne kayar.
        val c = AnaDenetleyici(SahteYuz()) { simdi }
        c.takvimGeriYukle(TakvimDurumu.baslangic(t("2026-11-26")))
        c.gorunumSec(Gorunum.TAKVIM)
        assertEquals(TakvimDurumu.baslangic(t("2026-11-27")), c.model().takvimDurumu)
    }

    @Test
    fun tekrarOrnegiTamamlanirVeGeriAlinir() {
        val (y, a) = hazir()
        val seri = kayit("r1", "Günlük yürüyüş", zaman = gun("2026-11-01")).copy(tekrar = Tekrar(TekrarSikligi.GUNLUK, 1, null, null, null))
        y.kayitlar["r1"] = seri
        y.takvimGunleri["2026-11-27"] = listOf(
            TakvimOgesi(gor(seri), "2026-11-27", KayitDurumu.ACIK, "2026-11-27", "2026-11-27", null, null),
        )
        a.gorunumSec(Gorunum.TAKVIM)
        val satir = (a.model().ogeler.single() as Liste.Oge.Satir).satir
        assertEquals("2026-11-27", satir.ornekTarihi)
        y.sifirla()
        val s = a.durumDegistir(satir.kayitId, KayitDurumu.TAMAM, satir.ornekTarihi)
        assertEquals(listOf("durum:r1:TAMAM:2026-11-27"), y.cagrilar.filter { it.startsWith("durum") })
        assertEquals("“Günlük yürüyüş” (27 Kas) tamamlandı", s.mesaj)
        assertEquals(GeriAlma.Durum("r1", KayitDurumu.ACIK, "2026-11-27"), s.geriAlma)
        assertEquals(KayitDurumu.ACIK, y.kayitlar.getValue("r1").durum)
        a.geriAl(s.geriAlma!!)
        assertEquals("durum:r1:ACIK:2026-11-27", y.cagrilar.last { it.startsWith("durum") })
        // Tarihli sekmesindeki gibi örneksiz çağrı kaydın kendisine gider.
        a.durumDegistir("r1", KayitDurumu.TAMAM)
        assertEquals("durum:r1:TAMAM", y.cagrilar.last { it.startsWith("durum") })
    }

    @Test
    fun ozetlerVeSeritlerModeleGirer() {
        val (y, a) = hazir()
        y.takvimAylari["2026-11"] = TakvimAyi(
            2026, 11,
            (1..30).map { g ->
                val tarih = String.format(java.util.Locale.ROOT, "2026-11-%02d", g)
                if (g == 27) TakvimGunOzeti(tarih, 2, 2, 0, 0, 2, 0, 0, 1) else TakvimGunOzeti(tarih, 0, 0, 0, 0, 0, 0, 0, 0)
            },
            listOf(dev.eren.ajanda.cekirdek.TakvimSeridi("d", null, "Dönem", dev.eren.ajanda.cekirdek.KayitTuru.GOREV, KayitDurumu.ACIK, false, "2026-11-26", "2026-11-28")),
        )
        a.gorunumSec(Gorunum.TAKVIM)
        val tk = a.model().takvim!!
        assertEquals(30, tk.ozetler!!.size)
        assertEquals(2, tk.ozetler!![t("2026-11-27")]!!.toplam)
        assertEquals(listOf(4 to (3..5)), tk.seritler.parcalar.map { it.hafta to (it.basSutun..it.sonSutun) })
        assertEquals(1, tk.seritler.siraSayisi)
    }

    @Test
    fun okumaHatasiIzgarayiIsaretsizBirakir() {
        val (y, a) = hazir()
        y.takvimHatasi = CekirdekHatasi.GecersizGirdi("yil", "aralık dışı")
        a.gorunumSec(Gorunum.TAKVIM)
        val m = a.model()
        assertNull(m.takvim!!.ozetler)
        assertNull(m.takvim!!.gunSayisi)
        assertTrue(m.ogeler.isEmpty())
        assertFalse(m.gosterge.kisa.isEmpty())
    }
}
