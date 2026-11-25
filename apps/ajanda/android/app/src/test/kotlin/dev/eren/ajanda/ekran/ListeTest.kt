package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.KaynakYolu
import dev.eren.ajanda.cekirdek.Tekrar
import dev.eren.ajanda.cekirdek.TekrarSikligi
import dev.eren.ajanda.cekirdek.TurKokeni
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class ListeTest {
    private val ist = ZoneId.of("Europe/Istanbul")

    /** Perşembe 26 Kasım 2026, 10:00 İstanbul. Haftanın pazarı 29 Kasım. */
    private val simdi = ZonedDateTime.of(2026, 11, 26, 10, 0, 0, 0, ist)

    private fun gruplar(o: List<Liste.Oge>): List<Pair<Liste.Grup, List<String>>> {
        val cikti = mutableListOf<Pair<Liste.Grup, MutableList<String>>>()
        for (x in o) when (x) {
            is Liste.Oge.Baslik -> cikti += x.grup to mutableListOf()
            is Liste.Oge.Satir -> cikti.last().second += x.satir.kayitId
            is Liste.Oge.Bos -> Unit
        }
        return cikti
    }

    @Test
    fun tarihlilerGunGrubunaVeSirayaDuser() {
        val l = listOf(
            kayit("gecen", zaman = an("2026-11-24", "09:00")),
            kayit("bugunSaat", zaman = an("2026-11-26", "15:00")),
            kayit("bugunTumGun", zaman = gun("2026-11-26")),
            kayit("bugunErken", zaman = an("2026-11-26", "08:00")),
            kayit("yarin", zaman = an("2026-11-27", "09:00")),
            kayit("pazar", zaman = gun("2026-11-29")),
            kayit("pazartesi", zaman = gun("2026-11-30")),
            kayit("donem", zaman = AjandaZamani.Donem("2026-11-20", "2026-11-28", "Europe/Istanbul", null)),
            kayit("bitenDonem", zaman = AjandaZamani.Donem("2026-11-01", "2026-11-25", "Europe/Istanbul", null)),
        ).map { gor(it) }
        val g = gruplar(Liste.tarihliler(l, simdi))
        assertEquals(
            listOf(
                Liste.Grup.GECIKMIS to listOf("gecen", "bitenDonem"),
                // Aynı günde önce tüm gün olanlar (süren dönem dahil), sonra saat sırası.
                Liste.Grup.BUGUN to listOf("bugunTumGun", "donem", "bugunErken", "bugunSaat"),
                Liste.Grup.YARIN to listOf("yarin"),
                Liste.Grup.BU_HAFTA to listOf("pazar"),
                Liste.Grup.SONRASI to listOf("pazartesi"),
            ),
            g,
        )
    }

    @Test
    fun gecikmisListedeBirOncekiSirayaGoreArtar() {
        val l = listOf(kayit("b", zaman = gun("2026-11-20")), kayit("a", zaman = gun("2026-11-10"))).map { gor(it) }
        assertEquals(listOf("a", "b"), gruplar(Liste.tarihliler(l, simdi)).first().second)
    }

    @Test
    fun bosBugunDeGorunur() {
        val o = Liste.tarihliler(listOf(gor(kayit("y", zaman = gun("2026-11-27")))), simdi)
        assertEquals(Liste.Oge.Baslik(Liste.Grup.BUGUN, 0), o[0])
        assertTrue(o[1] is Liste.Oge.Bos)
        assertEquals(Liste.Grup.YARIN, (o[2] as Liste.Oge.Baslik).grup)
        assertEquals("Cuma, 27 Kasım", (o[2] as Liste.Oge.Baslik).ek)
    }

    @Test
    fun gunSiniriCihazDilimineGoreHesaplanir() {
        // İstanbul'da 27 Kasım 01:30 = Londra'da 26 Kasım 22:30: Londra'daki telefonda "bugün".
        val londra = ZonedDateTime.of(2026, 11, 26, 20, 0, 0, 0, ZoneId.of("Europe/London"))
        val k = gor(kayit("gece", zaman = an("2026-11-27", "01:30")))
        val o = Liste.tarihliler(listOf(k), londra)
        assertEquals(Liste.Grup.BUGUN to listOf("gece"), gruplar(o).first())
        val satir = (o[1] as Liste.Oge.Satir).satir
        assertEquals("22:30 · (01:30 Europe/Istanbul)", satir.alt)
        // Aynı kayıt İstanbul'daki telefonda yarındır ve dilim notu yoktur.
        val o2 = Liste.tarihliler(listOf(k), simdi)
        assertEquals(Liste.Grup.YARIN to listOf("gece"), gruplar(o2)[1])
        assertEquals("01:30", (o2.last() as Liste.Oge.Satir).satir.alt)
    }

    @Test
    fun saatsizGunDilimdenBagimsizTakvimGunudur() {
        val tokyo = ZonedDateTime.of(2026, 11, 26, 23, 30, 0, 0, ZoneId.of("Asia/Tokyo"))
        val o = Liste.tarihliler(listOf(gor(kayit("g", zaman = gun("2026-11-26", "America/New_York")))), tokyo)
        assertEquals(Liste.Grup.BUGUN to listOf("g"), gruplar(o).first())
    }

    @Test
    fun gecesiYarisiSinirindaGrupDegisir() {
        val k = gor(kayit("k", zaman = gun("2026-11-27")))
        val once = ZonedDateTime.of(2026, 11, 26, 23, 59, 0, 0, ist)
        val sonra = ZonedDateTime.of(2026, 11, 27, 0, 0, 0, 0, ist)
        assertEquals(Liste.Grup.YARIN, gruplar(Liste.tarihliler(listOf(k), once))[1].first)
        assertEquals(Liste.Grup.BUGUN to listOf("k"), gruplar(Liste.tarihliler(listOf(k), sonra))[0])
    }

    @Test
    fun pazarGunuBuHaftaBosSonrasiDoludur() {
        val pazar = ZonedDateTime.of(2026, 11, 29, 9, 0, 0, 0, ist)
        val o = Liste.tarihliler(listOf(gor(kayit("sali", zaman = gun("2026-12-01")))), pazar)
        assertEquals(listOf(Liste.Grup.BUGUN, Liste.Grup.SONRASI), gruplar(o).map { it.first })
    }

    @Test
    fun kapalilarGecmisteEnYeniUstte() {
        val l = listOf(
            kayit("eski", zaman = gun("2026-11-01"), durum = KayitDurumu.TAMAM),
            kayit("yeni", zaman = gun("2026-11-25"), durum = KayitDurumu.TAMAM),
            kayit("bugunBitti", zaman = an("2026-11-26", "09:00"), durum = KayitDurumu.TAMAM),
        ).map { gor(it) }
        val g = gruplar(Liste.tarihliler(l, simdi))
        assertEquals(Liste.Grup.BUGUN to listOf("bugunBitti"), g[0])
        assertEquals(Liste.Grup.GECMIS to listOf("yeni", "eski"), g[1])
        val satir = Liste.tarihliler(l, simdi).filterIsInstance<Liste.Oge.Satir>().first().satir
        assertTrue(satir.kapali)
        assertFalse(satir.gecikmis)
    }

    @Test
    fun gecmisteKalanTekrarGecikmisSayilmaz() {
        val t = Tekrar(TekrarSikligi.HAFTALIK, 1, null, null, null)
        val l = listOf(gor(kayit("seri", zaman = gun("2026-10-01")).copy(tekrar = t)))
        val g = gruplar(Liste.tarihliler(l, simdi))
        assertEquals(Liste.Grup.TEKRARLAYAN to listOf("seri"), g[1])
        assertTrue((Liste.tarihliler(l, simdi).last() as Liste.Oge.Satir).satir.isaretler.contains(Liste.Isaret.TEKRAR))
    }

    @Test
    fun satirZamanMetinleri() {
        val o = Liste.tarihliler(
            listOf(
                kayit("gec", zaman = an("2026-11-23", "14:00")),
                kayit("sabah", zaman = an("2026-11-26", "08:00", sure = 45), tur = KayitTuru.RANDEVU),
                kayit("tumgun", zaman = gun("2026-11-26")),
                kayit("cuma", zaman = an("2026-11-28", "19:30")),
                kayit("ileri", zaman = an("2027-01-04", "09:00")),
            ).map { gor(it) },
            simdi,
        ).filterIsInstance<Liste.Oge.Satir>().associate { it.satir.kayitId to it.satir }
        assertEquals("Pzt 23 Kas · 14:00 · 3 gün geçti", o.getValue("gec").alt)
        assertTrue(o.getValue("gec").gecikmis)
        // Saati geçen açık randevu "geçti" der; tür görev değilse başta yazar.
        assertEquals("Randevu · 08:00 · 45 dk · geçti", o.getValue("sabah").alt)
        assertEquals("Tüm gün", o.getValue("tumgun").alt)
        assertEquals("Cumartesi · 19:30", o.getValue("cuma").alt)
        assertEquals("Pzt 4 Oca 2027 · 09:00", o.getValue("ileri").alt)
    }

    @Test
    fun tarihsizlerYapilacakNotKapaliSirasi() {
        val l = listOf(
            kayit("not1", tur = KayitTuru.NOT, aciklama = "\n  ilk satır\nikinci"),
            kayit("gorev1"),
            kayit("belirsiz", zaman = AjandaZamani.Belirsiz("haftaya bir ara")),
            kayit("bitti", durum = KayitDurumu.TAMAM),
            kayit("gorev2", tur = KayitTuru.RANDEVU),
        ).map { gor(it) }
        val o = Liste.tarihsizler(l, simdi)
        assertEquals(
            listOf(
                Liste.Grup.YAPILACAK to listOf("gorev1", "belirsiz", "gorev2"),
                Liste.Grup.NOTLAR to listOf("not1"),
                Liste.Grup.KAPALI to listOf("bitti"),
            ),
            gruplar(o),
        )
        val s = o.filterIsInstance<Liste.Oge.Satir>().associate { it.satir.kayitId to it.satir }
        assertEquals("“haftaya bir ara”", s.getValue("belirsiz").alt)
        assertEquals("Not · ilk satır", s.getValue("not1").alt)
        assertFalse("notta tamamlama kutusu yok", s.getValue("not1").tamamlanabilir)
        assertNull(s.getValue("gorev1").alt)
        assertTrue(Liste.tarihsizler(emptyList(), simdi).single() is Liste.Oge.Bos)
    }

    @Test
    fun taslakVeOtomatikIsaretleri() {
        val elle = Liste.satir(gor(kayit("e")), simdi, Liste.Grup.YAPILACAK, null)
        assertEquals(emptyList<Liste.Isaret>(), elle.isaretler)
        val taslak = Liste.satir(
            gor(kayit("t", taslak = true, yol = KaynakYolu.SOHBET_ARACI, kokeni = TurKokeni.SENTETIK), bekleyen = true),
            simdi, Liste.Grup.YAPILACAK, null,
        )
        assertEquals(listOf(Liste.Isaret.TASLAK, Liste.Isaret.ASISTAN, Liste.Isaret.GONDERILIYOR), taslak.isaretler)
        assertTrue(taslak.taslak)
        assertTrue(taslak.aciklama, taslak.aciklama.contains("taslak, onay bekliyor"))
        assertTrue(taslak.aciklama.contains("asistan ekledi"))
        assertTrue(taslak.aciklama.contains("gönderiliyor"))
        val asistan = Liste.satir(gor(kayit("a", yol = KaynakYolu.SOHBET_ARACI)), simdi, Liste.Grup.YAPILACAK, null)
        assertEquals(listOf(Liste.Isaret.ASISTAN), asistan.isaretler)
        val sesli = Liste.satir(gor(kayit("s", yol = KaynakYolu.SESLI_NOT).copy()), simdi, Liste.Grup.YAPILACAK, null)
        assertFalse(sesli.isaretler.contains(Liste.Isaret.ASISTAN))
        val silinen = Liste.satir(gor(kayit("x", silindi = true)), simdi, Liste.Grup.SILINEN, null)
        assertFalse(silinen.tamamlanabilir)
        assertTrue(silinen.aciklama.endsWith("silindi"))
    }

    @Test
    fun kaynakMetinleri() {
        assertEquals("Elle eklendi", Liste.kaynakMetni(kayit("e").kaynak))
        assertEquals(
            "Asistan kendiliğinden ekledi (sizin yazmadığınız bir turda)",
            Liste.kaynakMetni(kayit("s", yol = KaynakYolu.SOHBET_ARACI, kokeni = TurKokeni.SENTETIK).kaynak),
        )
        assertEquals(
            "Asistan, sohbette söylediğiniz üzerine ekledi",
            Liste.kaynakMetni(kayit("i", yol = KaynakYolu.SOHBET_ARACI).kaynak),
        )
    }

    @Test
    fun ekranOkuyucuCumlesi() {
        val s = Liste.satir(
            gor(kayit("r", baslik = "Diş kontrolü", zaman = an("2026-11-26", "15:00"), tur = KayitTuru.RANDEVU)),
            simdi, Liste.Grup.BUGUN, Liste.konum(an("2026-11-26", "15:00"), ist),
        )
        assertEquals("Randevu: Diş kontrolü, 15:00", s.aciklama)
    }

    @Test
    fun bozukZamanSatiriDusurmez() {
        // Bilinmeyen dilim: cihaz dilimi varsayılır, kayıt kaybolmaz.
        val o = Liste.tarihliler(listOf(gor(kayit("z", zaman = an("2026-11-26", "12:00", dilim = "Yok/Boyle")))), simdi)
        assertEquals(Liste.Grup.BUGUN to listOf("z"), gruplar(o).first())
    }
}
