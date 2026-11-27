package dev.eren.ajanda.kimlik

import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.GecisNedeni
import dev.eren.ajanda.cekirdek.GecisOzeti
import dev.eren.ajanda.cekirdek.KoparmaSonucu
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GecisMetinleriTest {
    private fun sonuc(
        kip: CalismaKipi = CalismaKipi.BAGLI,
        kayit: Int = 0,
        islem: Int = 0,
        yanitsiz: Int = 0,
        ret: Int = 0,
        iptal: Boolean = false,
        okunamayanTemel: Int = 0,
    ) = KoparmaSonucu(kip, kayit, islem, yanitsiz, ret, iptal, okunamayanTemel)

    private fun ozet(neden: GecisNedeni, s: KoparmaSonucu = sonuc(), ts: Long = 1_000) =
        GecisOzeti(neden, ts, s, "depo-a", if (neden == GecisNedeni.DEPO_DEGISTI) "depo-b" else null)

    private fun GecisMetni.hepsi() = baslik + "\n" + govde

    @Test
    fun bosKoparmadaSayiCumlesiYok() {
        val m = GecisMetinleri.koparma(sonuc())
        assertEquals("Eren servisinden ayrıldı", m.baslik)
        // Yalnız iki sabit cümle: kayıtlar telefonda, servisteki kopya yedek.
        assertEquals(2, m.satirlar.size)
        assertTrue(m.govde.contains("bu telefonda duruyor"))
        assertTrue(m.govde.contains("yedek olarak duruyor"))
        assertFalse(m.govde.contains("gönderilmeden"))
        assertFalse(m.govde.contains("yanıtı gelmedi"))
        assertFalse(m.govde.contains("Gönderilemeyenler"))
        assertFalse(Regex("\\b0\\b").containsMatchIn(m.govde))
    }

    @Test
    fun gonderilmeyenlerSayilir() {
        val m = GecisMetinleri.koparma(sonuc(kayit = 3, islem = 3))
        assertTrue(m.govde, m.govde.contains("3 değişiklik Eren servisine gönderilmeden ayrıldı ama bu telefonda duruyor."))
        val ayri = GecisMetinleri.koparma(sonuc(kayit = 2, islem = 5))
        assertTrue(ayri.govde, ayri.govde.contains("5 değişiklik (2 kayıtta) Eren servisine gönderilmeden ayrıldı"))
    }

    @Test
    fun yanitsizVeRetAyriSoylenir() {
        val kismi = GecisMetinleri.koparma(sonuc(kayit = 4, islem = 4, yanitsiz = 1, ret = 2))
        assertTrue(kismi.govde, kismi.govde.contains("Bunlardan 1 tanesi gönderilmişti ama yanıtı gelmedi; Eren servisine ulaşmış olabilir."))
        assertTrue(kismi.govde, kismi.govde.contains("Gönderilemeyenler listesindeki 2 değişiklik yerinde duruyor."))
        val hepsi = GecisMetinleri.koparma(sonuc(kayit = 2, islem = 2, yanitsiz = 2))
        assertTrue(hepsi.govde, hepsi.govde.contains("Bunlar gönderilmişti ama yanıtı gelmedi"))
    }

    @Test
    fun okunamayanTemelYalnizSifirDegilseSoylenir() {
        val var_ = GecisMetinleri.koparma(sonuc(okunamayanTemel = 3))
        assertTrue(var_.govde, var_.govde.contains("3 kaydın Eren servisindeki hali okunamadı; yeniden bağlanıp birleştirmeyi onaylarsanız telefondaki farklı her alan servise gönderilir."))
        assertFalse(var_.hepsi(), Regex("\bPC\b").containsMatchIn(var_.hepsi()))
        val yok = GecisMetinleri.koparma(sonuc())
        assertFalse(yok.govde, yok.govde.contains("okunamadı"))
    }

    @Test
    fun yerelKiptenKoparma() {
        val iptal = GecisMetinleri.koparma(sonuc(kip = CalismaKipi.YEREL, iptal = true))
        assertEquals("Bağlanma durduruldu", iptal.baslik)
        assertTrue(iptal.govde.contains("dokunulmadı"))
        val bos = GecisMetinleri.koparma(sonuc(kip = CalismaKipi.YEREL))
        assertEquals("Bağlı değil", bos.baslik)
        assertEquals(1, bos.satirlar.size)
    }

    @Test
    fun gecisNedenleri() {
        val kopar = GecisMetinleri.gecis(ozet(GecisNedeni.KOPARMA, sonuc(kayit = 1, islem = 1)))
        assertEquals("Eren servisinden ayrıldı", kopar.baslik)
        assertTrue(kopar.govde.contains("1 değişiklik Eren servisine gönderilmeden"))

        val kaldir = GecisMetinleri.gecis(ozet(GecisNedeni.ESLESME_KALDIRILDI))
        assertEquals("Eşleşme kaldırıldı", kaldir.baslik)
        assertTrue(kaldir.govde.contains("yedek olarak duruyor"))

        val depo = GecisMetinleri.gecis(ozet(GecisNedeni.DEPO_DEGISTI, sonuc(kayit = 2, islem = 2, yanitsiz = 1)))
        assertEquals("Başka bir Eren servisi", depo.baslik)
        assertEquals(
            "Bu telefonun bağlandığı Eren servisi değişti. Kayıtlarınız bu telefonda duruyor; yeni servise sorulmadan " +
                "gönderilmez, birleştirmeyi onaylarsanız (orada olmayan taslaklar hariç) oraya gider.",
            depo.satirlar.first(),
        )
        assertTrue(depo.govde, depo.govde.contains("2 değişiklik önceki Eren servisine gönderilmeden kaldı"))
        assertTrue(depo.govde, depo.govde.contains("önceki Eren servisine ulaşmış olabilir"))
        // A→B→A: B'nin kayıtları A'ya da gider (MIMARI "Bilinen sınırlar" 9); önceden söylenir.
        assertTrue(depo.govde, depo.govde.contains("yeniden bağlanıp birleştirmeyi onaylarsanız"))

        val bosDepo = GecisMetinleri.gecis(ozet(GecisNedeni.DEPO_DEGISTI))
        assertEquals(2, bosDepo.satirlar.size)
    }

    @Test
    fun gonderimHepBirlestirmeOnayinaBagliSoylenir() {
        // Yeniden bağlanmada kayıtlar sorulmadan gitmez (D4): "gönderilir / gider" diyen her cümle onayı anar.
        val gelecek = Regex("gönderilir\\b|gönderilecek\\b|\\bgider\\b")
        val satirlar = ornekMetinler().flatMap { it.split("\n") }.filter { gelecek.containsMatchIn(it) }
        assertTrue(satirlar.isNotEmpty())
        val kosulsuz = satirlar.filterNot { it.contains("onaylarsanız") }
        assertTrue("koşulsuz gönderim:\n" + kosulsuz.joinToString("\n"), kosulsuz.isEmpty())
        // Taslaklar gönderilmez: yedek ve depo değişimi cümleleri söyler.
        val kopar = GecisMetinleri.koparma(sonuc())
        assertTrue(kopar.govde, kopar.govde.contains("(Eren servisinde olmayan taslaklar hariç)"))
        assertTrue(GecisMetinleri.gecis(ozet(GecisNedeni.DEPO_DEGISTI)).govde.contains("taslaklar hariç"))
    }

    @Test
    fun koparmaOnayi() {        val sayili = GecisMetinleri.koparmaOnayi(4)
        assertEquals(GecisMetinleri.KOPARMA_BASLIGI, sayili.baslik)
        assertTrue(sayili.govde.contains("4 değişiklik henüz Eren servisine gitmedi"))
        assertTrue(sayili.govde.contains("yedek olarak durur"))
        assertEquals(2, GecisMetinleri.koparmaOnayi(0).satirlar.size)
        assertTrue(GecisMetinleri.koparmaOnayi(null).govde.contains("Henüz gönderilmemiş"))
    }

    @Test
    fun gecisBirKezGosterilir() {
        val g = ozet(GecisNedeni.KOPARMA, ts = 42)
        assertFalse(GecisMetinleri.gosterilmeli(null, null))
        assertTrue(GecisMetinleri.gosterilmeli(g, null))
        assertFalse(GecisMetinleri.gosterilmeli(g, 42))
        assertTrue(GecisMetinleri.gosterilmeli(g, 41))
    }

    /** Bütün dallar; `KullaniciMetniTest` bunları "PC" için tarar. */
    internal companion object {
        fun ornekMetinler(): List<String> {
            val t = GecisMetinleriTest()
            val sonuclar = listOf(
                t.sonuc(), t.sonuc(kayit = 1, islem = 2, yanitsiz = 1, ret = 1), t.sonuc(kayit = 3, islem = 3, yanitsiz = 3),
                t.sonuc(islem = 1), t.sonuc(kayit = 1),
                t.sonuc(kip = CalismaKipi.YEREL), t.sonuc(kip = CalismaKipi.YEREL, iptal = true),
            )
            val metinler = sonuclar.map(GecisMetinleri::koparma) +
                GecisNedeni.entries.flatMap { n -> sonuclar.map { GecisMetinleri.gecis(t.ozet(n, it)) } } +
                listOf(null, 0, 5).map(GecisMetinleri::koparmaOnayi)
            return metinler.map { it.baslik + "\n" + it.govde } + listOf(GecisMetinleri.KOPAR_DUGMESI, GecisMetinleri.VAZGEC_DUGMESI)
        }
    }
}
