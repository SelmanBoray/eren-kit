package dev.eren.olcum.ajanda.cekirdek

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset

class AnalizTest {
    private val B = 1_700_000_040_000L
    private val DK = Plan.DK
    private val SA = Plan.SAAT
    private val e = SeriPlani("E", 15 * DK, 0)
    private val c = SeriPlani("C", 180 * DK, 7 * DK + 30_000)
    private val plan = Plan(B, B + 6 * SA, listOf(e, c))

    /** Boot b'deki olay; açılış anı verilerek gecen hesaplanır. */
    private fun o(tur: String, duvar: Long, vararg alan: Pair<String, String>, boot: Int = 1, acilis: Long = B - SA) =
        Olay(tur, duvar, duvar - acilis, boot, linkedMapOf(*alan))

    private fun basla() = o(Tur.BASLA, B - DK, *plan.alanlar().toList().toTypedArray())
    private fun kur(seri: String, ilk: Int, son: Int, t: Long, boot: Int = 1, acilis: Long = B - SA, kaynak: String = "basla") =
        o(Tur.KUR, t, "seri" to seri, "ilk" to "$ilk", "son" to "$son", "kaynak" to kaynak, boot = boot, acilis = acilis)
    private fun cal(seri: String, k: Int, gecikme: Long, vararg ek: Pair<String, String>, boot: Int = 1, acilis: Long = B - SA): Olay {
        val s = plan.seri(seri)!!
        return o(Tur.CAL, plan.zaman(s, k) + gecikme, "seri" to seri, "slot" to "$k", *ek, boot = boot, acilis = acilis)
    }

    private fun seri(oz: Ozet, kod: String) = oz.seriler.first { it.kod == kod }

    @Test
    fun hepsiZamanindaCalar() {
        val ev = mutableListOf(basla(), kur("E", 0, 30, B - DK), kur("C", 0, 1, B - DK))
        for (k in 0..8) ev += cal("E", k, k * 1000L, "ekran" to "0", "idle" to if (k < 4) "1" else "0", "soguk" to "1")
        val oz = Analiz.analiz(ev, B + 2 * SA)
        val s = seri(oz, "E")
        assertEquals(9, s.beklenen)
        assertEquals(9, s.calan)
        assertEquals(0, s.kacan)
        assertEquals(0, s.bekleyen)
        assertEquals(4000L, s.gecikme.ortanca)
        assertEquals(8000L, s.gecikme.enKotu)
        assertEquals(0.0, s.kacanOrani!!, 1e-9)
        assertEquals(4, s.kosula.getValue("durum: doze").n)
        assertEquals(5, s.kosula.getValue("durum: ekran kapalı").n)
        assertEquals(9, s.kosula.getValue("süreç: soğuk başlatıldı").n)
        // C serisinin 7,5 dk'lık slotu çalmadı, kuruluydu: açıklanamayan.
        val cs = seri(oz, "C")
        assertEquals(1, cs.kacan)
        assertEquals(mapOf(Neden.ACIKLANAMAYAN to 1), cs.kacanNedenleri)
        assertEquals(listOf(B + 7 * DK + 30_000), cs.aciklanamayan)
    }

    @Test
    fun yenidenBaslatmaKapaliVeKurulumBoslugunuAyirir() {
        val acilis2 = B + 100 * DK
        val ev = mutableListOf(basla(), kur("E", 0, 40, B - DK), kur("C", 0, 1, B - DK))
        for (k in 0..3) ev += cal("E", k, 500)
        ev += cal("C", 0, 200)
        ev += o(Tur.KAPANIS, B + 50 * DK)
        // ikinci açılış: yayın 2 dk sonra, alarmlar 30 dk sonra kuruluyor
        ev += o(Tur.ACILIS, acilis2 + 2 * DK, boot = 2, acilis = acilis2)
        ev += o(Tur.BOOT, acilis2 + 2 * DK, "eylem" to "BOOT_COMPLETED", boot = 2, acilis = acilis2)
        ev += kur("E", 9, 40, acilis2 + 30 * DK, boot = 2, acilis = acilis2, kaynak = "surec:boot")
        ev += kur("C", 1, 1, acilis2 + 30 * DK, boot = 2, acilis = acilis2, kaynak = "surec:boot")
        for (k in 9..15) ev += cal("E", k, 1500, boot = 2, acilis = acilis2)
        ev += cal("C", 1, 300, boot = 2, acilis = acilis2)

        val oz = Analiz.analiz(ev, B + 4 * SA)
        val s = seri(oz, "E")
        assertEquals(1, s.bekleyen)            // slot 16 (240 dk) henüz 30 dk dolmadı
        assertEquals(16, s.beklenen)
        assertEquals(11, s.calan)
        assertEquals(5, s.kacan)
        assertEquals(3, s.kacanNedenleri[Neden.KAPALI])          // 60, 75, 90 dk
        assertEquals(2, s.kacanNedenleri[Neden.ACILIS_SONRASI])  // 105, 120 dk
        assertEquals(2.0 / 13.0, s.kacanOrani!!, 1e-9)

        assertEquals(1, oz.bootlar.size)
        val b = oz.bootlar[0]
        assertEquals(2, b.boot)
        assertEquals(acilis2, b.acilisDuvar)
        assertTrue(b.kapanisYayini)
        assertTrue(b.acilisYayini)
        assertEquals(2 * DK, b.yayinGecikme)
        assertEquals(30 * DK, b.kurGecikme)
        assertEquals("surec:boot", b.kurKaynak)

        val p = oz.pencereler.first { it.ad.startsWith("yeniden") }
        assertEquals(1, p.olay)
        // 105..210 dk arası E slotları (8) + C slotu 187,5 dk (1)
        assertEquals(9, p.planli)
        assertEquals(7, p.calan)
    }

    @Test
    fun kapanisYayiniYoksaOlasiKapaliSayilir() {
        val acilis2 = B + 100 * DK
        val ev = mutableListOf(basla(), kur("E", 0, 40, B - DK))
        ev += cal("E", 0, 0)
        ev += o(Tur.IS, B + 10 * DK, "id" to "1")
        ev += kur("E", 8, 40, acilis2 + 10 * DK, boot = 2, acilis = acilis2)
        for (k in 8..10) ev += cal("E", k, 0, boot = 2, acilis = acilis2)
        val oz = Analiz.analiz(ev, B + 3 * SA)
        val s = seri(oz, "E")
        assertEquals(2, s.bekleyen)                               // 165, 180 dk
        assertEquals(11, s.beklenen)
        assertEquals(4, s.calan)
        // 15..90 dk: son canlılık (10 dk) ile açılış (100 dk) arası
        assertEquals(6, s.kacanNedenleri[Neden.KAPALI_OLASI])
        assertEquals(1, s.kacanNedenleri[Neden.ACILIS_SONRASI])  // 105 dk: 100..110 dk arası
        assertEquals(0.2, s.kacanOrani!!, 1e-9)
        assertTrue(!oz.bootlar.single().kapanisYayini)
        assertTrue(!oz.bootlar.single().acilisYayini)
    }

    @Test
    fun zorlaDurdurmaAyrisir() {
        val ev = mutableListOf(basla(), kur("E", 0, 20, B - DK))
        ev += cal("E", 0, 0)
        ev += cal("E", 1, 0)
        ev += o(Tur.ACILIS, B + 80 * DK)
        ev += o(Tur.CIKIS, B + 80 * DK, "zaman" to "${B + 20 * DK}", "neden" to "10")
        ev += kur("E", 6, 20, B + 80 * DK, kaynak = "surec:ekran")
        for (k in 7..12) ev += cal("E", k, 0)
        val oz = Analiz.analiz(ev, B + 3 * SA)
        val s = seri(oz, "E")
        assertEquals(4, s.kacanNedenleri[Neden.ZORLA])          // 30, 45, 60, 75 dk
        assertEquals(1, s.kacanNedenleri[Neden.ACIKLANAMAYAN])  // 90 dk
        assertEquals(mapOf("kullanıcı zorla durdurdu" to 1), oz.cikislar)
    }

    @Test
    fun kurulmamisVeBekleyen() {
        val ev = mutableListOf(basla(), kur("E", 0, 2, B - DK))
        for (k in 0..2) ev += cal("E", k, 0)
        val oz = Analiz.analiz(ev, B + 2 * SA)
        val s = seri(oz, "E")
        assertEquals(2, s.bekleyen)                               // 105, 120 dk
        assertEquals(4, s.kacanNedenleri[Neden.KURULMAMIS])       // 45..90 dk
        assertEquals(7, s.beklenen)
    }

    @Test
    fun saatSicramasiPenceresiAnaIstatistigeGirmez() {
        val ev = mutableListOf(basla(), kur("E", 0, 30, B - DK))
        ev += o(Tur.SAAT, B + 61 * DK, "sicrama" to "${SA}")
        for (k in 0..4) ev += cal("E", k, B + 61 * DK - plan.zaman(e, k) + 100)
        for (k in 5..6) ev += cal("E", k, 2000)
        ev += cal("E", 6, 9000) // çift çalma
        val oz = Analiz.analiz(ev, B + 2 * SA)
        val s = seri(oz, "E")
        assertEquals(5, s.saatPenceresinde)
        assertEquals(5, s.saatPenceresindeCalan)
        assertEquals(2000L, s.gecikme.enKotu)
        assertEquals(1, s.cift)
        assertEquals(1, oz.saatOlay)
    }

    @Test
    fun durdurmaSonrasiBeklenmez() {
        val ev = mutableListOf(basla(), kur("E", 0, 30, B - DK))
        for (k in 0..2) ev += cal("E", k, 0)
        ev += o(Tur.DUR, B + 31 * DK)
        val oz = Analiz.analiz(ev, B + 5 * SA)
        assertEquals(3, seri(oz, "E").beklenen)
        assertEquals(0, seri(oz, "E").kacan)
        assertEquals(B + 31 * DK, oz.durdurma)
    }

    @Test
    fun yalnizSonBaslatmaDegerlendirilir() {
        val eski = listOf(basla(), cal("E", 0, 99_999))
        val yeniB = B + 10 * SA
        val p2 = Plan(yeniB, yeniB + SA, listOf(e))
        val ev = eski + listOf(
            Olay(Tur.BASLA, yeniB - DK, 0, 1, p2.alanlar()),
            Olay(Tur.KUR, yeniB - DK, 0, 1, mapOf("seri" to "E", "ilk" to "0", "son" to "4")),
            Olay(Tur.CAL, yeniB + 10, 0, 1, mapOf("seri" to "E", "slot" to "0")),
        )
        val oz = Analiz.analiz(ev, yeniB + 31 * DK)
        val s = oz.seriler.single()
        assertEquals(1, s.beklenen)
        assertEquals(10L, s.gecikme.enKotu)
    }

    @Test
    fun periyodikIsAraliklari() {
        val ev = mutableListOf(basla())
        for (t in listOf(0L, 15L, 45L)) ev += o(Tur.IS, B + t * DK, "id" to "1")
        ev += o(Tur.IS, B, "id" to "2")
        ev += o(Tur.ISVAR, B, "id" to "1", "var" to "0")
        ev += o(Tur.PI, B, "seri" to "E", "slot" to "1", "var" to "1")
        val oz = Analiz.analiz(ev, B + SA)
        val i1 = oz.isler.first { it.id == "1" }
        assertEquals(3, i1.n)
        assertEquals(22 * DK + 30_000, i1.ortanca)
        assertEquals(30 * DK, i1.p90)
        assertEquals(30 * DK, i1.enUzun)
        val i2 = oz.isler.first { it.id == "2" }
        assertEquals(1, i2.n)
        assertNull(i2.ortanca)
        assertEquals(1, oz.isKayip)
        assertEquals(0, oz.piKayip)
        assertEquals(1, oz.piKontrol)
    }

    @Test
    fun baslatilmamisGunlukCokmez() {
        val oz = Analiz.analiz(emptyList(), B)
        assertNull(oz.plan)
        assertTrue(oz.seriler.isEmpty())
        assertTrue(Rapor.metin(oz, ZoneOffset.UTC).contains("başlatılmadı"))
    }
}
