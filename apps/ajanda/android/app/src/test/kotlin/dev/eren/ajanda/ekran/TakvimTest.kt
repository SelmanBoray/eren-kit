package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.TakvimGunOzeti
import dev.eren.ajanda.cekirdek.TakvimOgesi
import dev.eren.ajanda.cekirdek.TakvimSeridi
import dev.eren.ajanda.cekirdek.Tekrar
import dev.eren.ajanda.cekirdek.TekrarSikligi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.ZonedDateTime

/** Takvim sekmesinin saf mantığı: ızgara yerleşimi, şeritlerin haftalara bölünmesi, işaretler, metinler, seçim. */
class TakvimTest {
    private val ist = ZoneId.of("Europe/Istanbul")

    /** Cuma 27 Kasım 2026, 10:00 İstanbul. */
    private val simdi = ZonedDateTime.of(2026, 11, 27, 10, 0, 0, 0, ist)
    private val bugun = simdi.toLocalDate()

    private fun t(s: String) = LocalDate.parse(s)

    private fun serit(id: String, ilk: String, son: String, durum: KayitDurumu = KayitDurumu.ACIK, taslak: Boolean = false) =
        TakvimSeridi(kayitId = id, ornekTarihi = null, baslik = "Şerit $id", tur = KayitTuru.GOREV, durum = durum, taslak = taslak, ilkGun = ilk, sonGun = son)

    private fun ozet(toplam: Int, acik: Int = toplam, kapali: Int = 0, taslak: Int = 0, serit: Int = 0, tarih: String = "2026-11-27") =
        TakvimGunOzeti(tarih = tarih, toplam = toplam, acik = acik, kapali = kapali, taslak = taslak, gorev = toplam, randevu = 0, notlar = 0, serit = serit)

    // ---------------------------------------------------------------------------------------------
    // Izgara
    // ---------------------------------------------------------------------------------------------

    @Test
    fun ayinIlkGunununSutunuVeHaftaSayisi() {
        data class B(val ay: String, val ilkSutun: Int, val gun: Int, val hafta: Int)
        val beklenen = listOf(
            B("2026-11", 6, 30, 6), // 1 Kasım pazar: son sütun; 30 gün altı haftaya taşar
            B("2026-12", 1, 31, 5), // 1 Aralık salı
            B("2026-03", 6, 31, 6), // 31 gün, pazar başlangıç: altı hafta
            B("2026-04", 2, 30, 5), // 1 Nisan çarşamba
            B("2027-02", 0, 28, 4), // artık olmayan şubat pazartesi başlıyor: tam dört hafta
            B("2028-02", 1, 29, 5), // artık yıl: 29 gün
            B("2100-02", 0, 28, 4), // 100'e bölünüp 400'e bölünmeyen yıl artık değil
            B("2000-02", 1, 29, 5), // 400'e bölünen yıl artık
        )
        for (b in beklenen) {
            val iz = Takvim.Izgara(YearMonth.parse(b.ay))
            assertEquals(b.toString(), Triple(b.ilkSutun, b.gun, b.hafta), Triple(iz.ilkSutun, iz.gunSayisi, iz.haftaSayisi))
        }
    }

    @Test
    fun herAydaHerGunTekHucrededirVeSutunHaftaGunudur() {
        var ay = YearMonth.of(1999, 1)
        while (ay <= YearMonth.of(2031, 12)) {
            val iz = Takvim.Izgara(ay)
            assertTrue("$ay", iz.haftaSayisi in 4..6)
            val gorulen = mutableListOf<LocalDate>()
            for (h in 0 until iz.haftaSayisi) for (s in 0 until 7) {
                val g = iz.gun(h, s) ?: continue
                assertEquals("$g sütunu", g.dayOfWeek.value - 1, s)
                assertEquals(h to s, iz.yer(g))
                gorulen += g
            }
            assertEquals("$ay günleri sırayla bir kez", (1..ay.lengthOfMonth()).map { ay.atDay(it) }, gorulen)
            // Ay dışı hücreler boş; son haftadan sonrası da.
            assertNull(iz.gun(iz.haftaSayisi, 0))
            ay = ay.plusMonths(1)
        }
    }

    @Test
    fun kasim2026Hucreleri() {
        val iz = Takvim.Izgara(YearMonth.of(2026, 11))
        assertEquals(listOf(null, null, null, null, null, null, t("2026-11-01")), iz.hafta(0))
        assertEquals(t("2026-11-02"), iz.gun(1, 0))
        assertEquals(t("2026-11-30"), iz.gun(5, 0))
        assertNull(iz.gun(5, 1))
        assertEquals(4 to 4, iz.yer(t("2026-11-27")))
        assertEquals(DayOfWeek.FRIDAY, t("2026-11-27").dayOfWeek)
    }

    // ---------------------------------------------------------------------------------------------
    // Şeritler
    // ---------------------------------------------------------------------------------------------

    @Test
    fun oncekiAydanGelenSeritHaftalaraBolunurVeKirpilir() {
        val iz = Takvim.Izgara(YearMonth.of(2026, 11))
        val y = Takvim.seritYerlesimi(iz, listOf(serit("a", "2026-10-30", "2026-11-03")), 2)
        val p = y.parcalar.map { listOf(it.hafta, it.basSutun, it.sonSutun, it.basliyor, it.bitiyor) }
        assertEquals(
            listOf(
                listOf(0, 6, 6, false, false), // 1 Kasım (pazar): ekimden sürüyor, haftanın sonu
                listOf(1, 0, 1, false, true), // 2-3 Kasım: burada bitiyor
            ),
            p,
        )
        assertEquals(1, y.siraSayisi)
    }

    @Test
    fun sonrakiAyaTasanSeritAyinSonundaKesilir() {
        val iz = Takvim.Izgara(YearMonth.of(2026, 11))
        val y = Takvim.seritYerlesimi(iz, listOf(serit("a", "2026-11-29", "2026-12-02")), 2)
        assertEquals(
            listOf(listOf(4, 6, 6, true, false), listOf(5, 0, 0, false, false)),
            y.parcalar.map { listOf(it.hafta, it.basSutun, it.sonSutun, it.basliyor, it.bitiyor) },
        )
    }

    @Test
    fun cakisanSeritlerSiraAlirSigmayanGizliSayilir() {
        val iz = Takvim.Izgara(YearMonth.of(2026, 11))
        // 9 Kasım pazartesi (hafta 2). a: sal-per, b: çar-cum, c: per-cmt (iki sıra dolu), d: cmt-paz.
        val seritler = listOf(
            serit("a", "2026-11-10", "2026-11-12"),
            serit("b", "2026-11-11", "2026-11-13"),
            serit("c", "2026-11-12", "2026-11-14"),
            serit("d", "2026-11-14", "2026-11-15"),
        )
        val y = Takvim.seritYerlesimi(iz, seritler, enCokSira = 2)
        assertEquals(
            listOf("a" to 0, "b" to 1, "d" to 0),
            y.parcalar.map { it.serit.kayitId to it.sira },
        )
        assertEquals(mapOf(t("2026-11-12") to 1, t("2026-11-13") to 1, t("2026-11-14") to 1), y.gizli)
        assertEquals(2, y.siraSayisi)
        // Tek sıraya izin varsa b de gizlenir; sıra sayısı 1.
        val tek = Takvim.seritYerlesimi(iz, seritler, enCokSira = 1)
        assertEquals(listOf("a", "d"), tek.parcalar.map { it.serit.kayitId })
        assertEquals(1, tek.siraSayisi)
        assertEquals(2, tek.gizli[t("2026-11-12")])
    }

    @Test
    fun ayDisiVeBozukSeritAtlanir() {
        val iz = Takvim.Izgara(YearMonth.of(2026, 11))
        val y = Takvim.seritYerlesimi(
            iz,
            listOf(serit("eski", "2026-10-01", "2026-10-31"), serit("bozuk", "dün", "2026-11-02"), serit("ters", "2026-11-05", "2026-11-03")),
            2,
        )
        assertTrue(y.parcalar.isEmpty())
        assertEquals(0, y.siraSayisi)
    }

    @Test
    fun ayBoyuSeritHerHaftadaParcadir() {
        val iz = Takvim.Izgara(YearMonth.of(2026, 11))
        val y = Takvim.seritYerlesimi(iz, listOf(serit("uzun", "2026-10-15", "2027-01-10")), 2)
        assertEquals(6, y.parcalar.size)
        assertTrue(y.parcalar.none { it.basliyor || it.bitiyor })
        assertEquals((0..5).toList(), y.parcalar.map { it.hafta })
    }

    // ---------------------------------------------------------------------------------------------
    // Hücre
    // ---------------------------------------------------------------------------------------------

    @Test
    fun hucreNoktalari() {
        assertEquals(Takvim.Isaretler(emptyList(), false), Takvim.isaretler(null))
        assertEquals(Takvim.Isaretler(emptyList(), false), Takvim.isaretler(ozet(0)))
        assertEquals(listOf(Takvim.Nokta.ACIK, Takvim.Nokta.ACIK), Takvim.isaretler(ozet(2)).noktalar)
        // Yalnız şerit: nokta yok (şerit çizilir).
        assertTrue(Takvim.isaretler(ozet(2, serit = 2)).noktalar.isEmpty())
        assertEquals(listOf(Takvim.Nokta.ACIK), Takvim.isaretler(ozet(3, serit = 2)).noktalar)
        // Her tür en az bir nokta; 3'ten çok tek günlük öğe "fazla".
        val karma = Takvim.isaretler(ozet(toplam = 6, acik = 4, kapali = 2, taslak = 1))
        assertEquals(listOf(Takvim.Nokta.ACIK, Takvim.Nokta.TASLAK, Takvim.Nokta.KAPALI), karma.noktalar)
        assertTrue(karma.fazla)
        assertEquals(listOf(Takvim.Nokta.ACIK, Takvim.Nokta.ACIK, Takvim.Nokta.TASLAK), Takvim.isaretler(ozet(3, taslak = 1)).noktalar)
        assertFalse(Takvim.isaretler(ozet(3)).fazla)
    }

    @Test
    fun hucreEkranOkuyucuMetni() {
        assertEquals(
            "Cuma, 27 Kasım, bugün, seçili. 3 kayıt: 1 taslak; 1 çok günlü.",
            Takvim.hucreAciklamasi(bugun, ozet(3, taslak = 1, serit = 1), bugun, secili = true),
        )
        assertEquals(
            "Cumartesi, 28 Kasım. 4 kayıt: 3 açık, 1 tamamlanmış ya da iptal.",
            Takvim.hucreAciklamasi(t("2026-11-28"), ozet(4, acik = 3, kapali = 1), bugun, secili = false),
        )
        assertEquals("Pazartesi, 4 Ocak 2027. Kayıt yok.", Takvim.hucreAciklamasi(t("2027-01-04"), null, bugun, false))
        assertEquals("Pazartesi, 4 Ocak 2027. Yükleniyor.", Takvim.hucreAciklamasi(t("2027-01-04"), null, bugun, false, yuklendi = false))
    }

    @Test
    fun gunBasligiVeAyAdi() {
        assertEquals("Bugün · Cuma, 27 Kasım", Takvim.gunBasligi(bugun, bugun))
        assertEquals("Yarın · Cumartesi, 28 Kasım", Takvim.gunBasligi(t("2026-11-28"), bugun))
        assertEquals("Dün · Perşembe, 26 Kasım", Takvim.gunBasligi(t("2026-11-26"), bugun))
        assertEquals("Salı, 1 Aralık", Takvim.gunBasligi(t("2026-12-01"), bugun))
        assertEquals("Şubat 2028", EkranMetinleri.ayVeYil(YearMonth.of(2028, 2)))
    }

    // ---------------------------------------------------------------------------------------------
    // Seçili günün satırları
    // ---------------------------------------------------------------------------------------------

    private fun oge(
        k: dev.eren.ajanda.cekirdek.AjandaKaydi,
        ilk: String,
        son: String = ilk,
        durum: KayitDurumu = k.durum,
        ornek: String? = null,
        saat: String? = null,
        bitis: String? = null,
    ) = TakvimOgesi(gorunum = gor(k), ornekTarihi = ornek, durum = durum, ilkGun = ilk, sonGun = son, saat = saat, bitisSaati = bitis)

    private fun satir(o: TakvimOgesi, gun: String) = Takvim.satir(o, t(gun), simdi, Liste.Gonderim.YEREL)!!

    @Test
    fun tekrarOrnegiKendiGunuVeDurumuyla() {
        val seri = kayit("r", "Haftalık toplantı", zaman = an("2026-11-02", "09:30"), tur = KayitTuru.RANDEVU)
            .copy(tekrar = Tekrar(TekrarSikligi.HAFTALIK, 1, null, null, null))
        val s = satir(oge(seri, "2026-11-30", durum = KayitDurumu.TAMAM, ornek = "2026-11-30", saat = "09:30"), "2026-11-30")
        assertEquals("2026-11-30", s.ornekTarihi)
        assertTrue("örneğin durumu: tamam", s.kapali)
        assertEquals("Randevu · 09:30", s.alt)
        assertTrue(Liste.Isaret.TEKRAR in s.isaretler)
        assertFalse(s.gecikmis)
        assertTrue(s.aciklama, s.aciklama.contains("tamamlandı"))
        // Seri kendisi açık, kapanmamış geçmiş örnek gecikmiş sayılmaz (Tarihli sekmesiyle aynı).
        val gecmis = satir(oge(seri, "2026-11-23", ornek = "2026-11-23", saat = "09:30"), "2026-11-23")
        assertFalse(gecmis.kapali)
        assertFalse(gecmis.gecikmis)
    }

    @Test
    fun saatliSatirlarVeGecenSaat() {
        val sabah = kayit("s", zaman = an("2026-11-27", "09:00", sure = 45))
        assertEquals("09:00 · 45 dk · geçti", satir(oge(sabah, "2026-11-27", saat = "09:00"), "2026-11-27").alt)
        val aksam = kayit("a", zaman = an("2026-11-27", "19:00"))
        assertEquals("19:00", satir(oge(aksam, "2026-11-27", saat = "19:00"), "2026-11-27").alt)
        // Başka günde "geçti" yok, tarih yazılmaz (gün başlıkta).
        val yarin = kayit("y", zaman = an("2026-11-28", "08:00"))
        assertEquals("08:00", satir(oge(yarin, "2026-11-28", saat = "08:00"), "2026-11-28").alt)
    }

    @Test
    fun gecedenSurenSaatliOge() {
        val k = kayit("g", zaman = an("2026-11-26", "22:00", sure = 30 * 60), tur = KayitTuru.RANDEVU)
        val o = oge(k, "2026-11-26", "2026-11-28", saat = "22:00", bitis = "04:00")
        assertEquals("Randevu · 22:00 · 30 sa", satir(o, "2026-11-26").alt)
        assertEquals("Randevu · Sürüyor · tüm gün", satir(o, "2026-11-27").alt)
        assertEquals("Randevu · Sürüyor · bitiş 04:00", satir(o, "2026-11-28").alt)
    }

    @Test
    fun saatsizDonemTaslakVeGecikmis() {
        val gecikmis = satir(oge(kayit("eski", zaman = gun("2026-11-25")), "2026-11-25"), "2026-11-25")
        assertEquals("Tüm gün", gecikmis.alt)
        assertTrue(gecikmis.gecikmis)
        assertTrue(gecikmis.aciklama.contains("gecikmiş"))
        val bolum = satir(oge(kayit("b", zaman = gun("2026-11-27", bolum = dev.eren.ajanda.cekirdek.GunBolumu.AKSAM)), "2026-11-27"), "2026-11-27")
        assertEquals("Akşam", bolum.alt)
        val donem = kayit("d", zaman = dev.eren.ajanda.cekirdek.AjandaZamani.Donem("2026-11-26", "2026-11-29", "Europe/Istanbul", null))
        assertEquals("26 Kas – 29 Kas", satir(oge(donem, "2026-11-26", "2026-11-29"), "2026-11-27").alt)
        val taslak = satir(oge(kayit("t", zaman = gun("2026-11-27"), taslak = true), "2026-11-27"), "2026-11-27")
        assertTrue(taslak.taslak)
        assertTrue(Liste.Isaret.TASLAK in taslak.isaretler)
        // Kapalı geçmiş öğe gecikmiş değil.
        val kapali = satir(oge(kayit("k", zaman = gun("2026-11-20")), "2026-11-20", durum = KayitDurumu.TAMAM), "2026-11-20")
        assertFalse(kapali.gecikmis)
    }

    @Test
    fun bosGunVeSira() {
        assertEquals(listOf(Liste.Oge.Bos(Takvim.BOS_GUN)), Takvim.satirlar(emptyList(), bugun, simdi, Liste.Gonderim.YEREL))
        val l = listOf(
            oge(kayit("1", zaman = gun("2026-11-27")), "2026-11-27"),
            oge(kayit("2", zaman = an("2026-11-27", "08:00")), "2026-11-27", saat = "08:00"),
        )
        // Sıra çekirdeğindir: olduğu gibi korunur.
        assertEquals(
            listOf("1", "2"),
            Takvim.satirlar(l, bugun, simdi, Liste.Gonderim.YEREL).map { (it as Liste.Oge.Satir).satir.kayitId },
        )
    }

    // ---------------------------------------------------------------------------------------------
    // Seçim
    // ---------------------------------------------------------------------------------------------

    @Test
    fun secimAyDegistirmeVeBugun() {
        val d = TakvimDurumu.baslangic(bugun)
        assertTrue(d.bugunde)
        val ileri = d.ayKaydir(1)
        assertEquals(YearMonth.of(2026, 12) to t("2026-12-01"), ileri.ay to ileri.secili)
        assertFalse(ileri.bugunde)
        val geri = ileri.ayKaydir(-1)
        assertEquals("bugünün ayına dönünce bugün seçilir", bugun, geri.secili)
        val yilSonu = d.ayKaydir(14)
        assertEquals(YearMonth.of(2028, 1) to t("2028-01-01"), yilSonu.ay to yilSonu.secili)
        val sec = d.gunSec(t("2027-03-15"))
        assertEquals(YearMonth.of(2027, 3), sec.ay)
        assertEquals(TakvimDurumu.baslangic(bugun), sec.bugune())
        // 31 Ocak'tan şubata: ayın 1'i (31 Şubat yok).
        val ocak = TakvimDurumu(YearMonth.of(2027, 1), t("2027-01-31"), bugun).ayKaydir(1)
        assertEquals(t("2027-02-01"), ocak.secili)
    }

    @Test
    fun geceYarisiBuguneBakaniTasirBaskaGunuKorur() {
        val d = TakvimDurumu.baslangic(t("2026-11-30"))
        val ertesi = d.bugunGuncelle(t("2026-12-01"))
        assertEquals(TakvimDurumu(YearMonth.of(2026, 12), t("2026-12-01"), t("2026-12-01")), ertesi)
        val baska = d.gunSec(t("2026-11-15")).bugunGuncelle(t("2026-12-01"))
        assertEquals(t("2026-11-15") to YearMonth.of(2026, 11), baska.secili to baska.ay)
        assertEquals(t("2026-12-01"), baska.bugun)
        assertTrue(d === d.bugunGuncelle(t("2026-11-30")))
    }

    @Test
    fun secimMetneYazilirGeriOkunur() {
        val d = TakvimDurumu(YearMonth.of(2027, 2), t("2027-02-14"), bugun)
        assertEquals("2027-02|2027-02-14|2026-11-27", d.metin())
        assertEquals(d, TakvimDurumu.coz(d.metin()))
        assertNull(TakvimDurumu.coz(null))
        assertNull(TakvimDurumu.coz(""))
        assertNull(TakvimDurumu.coz("2027-02|bozuk|2026-11-27"))
        assertNull(TakvimDurumu.coz("2027-02|2027-02-14"))
        // Ay seçili güne uymuyorsa seçili gün esastır.
        assertEquals(YearMonth.of(2027, 3), TakvimDurumu.coz("2027-02|2027-03-01|2026-11-27")?.ay)
    }

    @Test(expected = IllegalArgumentException::class)
    fun seciliGunAyinDisindaOlamaz() {
        TakvimDurumu(YearMonth.of(2026, 11), t("2026-12-01"), bugun)
    }
}
