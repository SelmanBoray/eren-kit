package dev.eren.ajanda.ekran.sahne.veri

import dev.eren.ajanda.cekirdek.AjandaEki
import dev.eren.ajanda.cekirdek.AjandaKaydi
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.V3Alanlari
import dev.eren.ajanda.ekran.TakvimDurumu
import dev.eren.ajanda.ekran.an
import dev.eren.ajanda.ekran.kayit
import dev.eren.ajanda.ekran.sahne.bugun.BugunCekirdegi
import dev.eren.ajanda.ekran.sahne.bugun.GUN
import dev.eren.ajanda.ekran.sahne.bugun.SIMDI
import dev.eren.ajanda.ekran.sahne.cizim.varsayilanLevhaRengi
import dev.eren.ajanda.ekran.sahne.takvim.TakvimCekirdegi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sözleşme v3 alanlarının Sahne'de yalnız okunarak gösterilmesi: çizim anahtarının önceliği (kaydın simgesi >
 * başlıktan öneri > genel; biçim dışı ve takımda olmayan simge genel), bölgeli kayıtta yalnız "@ ⟨ad⟩", ek işareti
 * ve ertelenen değişikliğin "eşitlenecek" işareti. Bugün, Takvim ve Tarihsizler aynı kurucudan geçer.
 */
class V3GosterimTest {

    private fun eki(id: String) = AjandaEki(
        ekId = id, mime = "image/jpeg", bayt = 1000, genislik = 640, yukseklik = 480, ozet = "o_$id", kapak = false, olusturmaMs = 1_000,
    )

    private fun AjandaKaydi.v3(
        simge: String? = null,
        bolge: String? = null,
        ekler: List<AjandaEki> = emptyList(),
    ) = copy(v3 = V3Alanlari(simge = simge, bolge = bolge, ekler = ekler))

    // --- çizim anahtarı önceliği (saf) ---

    @Test
    fun simgeOneridenOnceOneriGeneldenOnce() {
        assertEquals("araba", Gorunus.cizim("araba", "Kahve molası"))
        assertEquals("kahve", Gorunus.cizim(null, "Kahve molası"))
        assertEquals("genel", Gorunus.cizim(null, "Qwxz zvq"))
        // Takımda olmayan (yeni sürümden gelen) simge genel çizer, öneriye düşmez.
        assertEquals("genel", Gorunus.cizim("uzay_gemisi", "Kahve molası"))
        // Biçim dışı simge (sözleşme deseni ^[a-z][a-z0-9_]{0,31}$ dışı) genel çizer, öneriye düşmez.
        for (s in listOf("Araba", "ARABA", " araba", "araba ", "1araba", "ara-ba", "araç", "a".repeat(33))) {
            assertEquals(s, "genel", Gorunus.cizim(s, "Kahve molası"))
        }
        // Desene uyan en uzun ad geçerli biçimdir (takımda yoksa yine genel).
        assertEquals("genel", Gorunus.cizim("a".repeat(32), "Kahve molası"))
    }

    @Test
    fun bugunKaydiSimgesiyleCizilirRengiSimgedenGelir() {
        val c = BugunCekirdegi()
        c.ekle(
            kayit("s", "Kahve molası", an(GUN.toString(), "15:00")).v3(simge = "araba"),
            kayit("o", "Kahve molası", an(GUN.toString(), "16:00")),
            kayit("b", "Kahve molası", an(GUN.toString(), "17:00")).v3(simge = "Araba"),
            kayit("y", "Kahve molası", an(GUN.toString(), "18:00")).v3(simge = "uzay_gemisi"),
        )
        val m = BugunDenetleyici(c) { SIMDI }.run { hepsiniOku(); model() }
        val k = m.acikler.associateBy { it.kayitId }
        assertEquals("araba", k.getValue("s").cizim)
        assertEquals(varsayilanLevhaRengi("araba"), k.getValue("s").renk)
        assertEquals("kahve", k.getValue("o").cizim)
        assertEquals("genel", k.getValue("b").cizim)
        assertEquals("genel", k.getValue("y").cizim)
    }

    // --- bölge, ek ve ertelenen işaretleri ---

    @Test
    fun altSatirIsaretleri() {
        assertEquals("13:00", Gorunus.altSatir("13:00", 0, false))
        assertNull(Gorunus.altSatir(null, 0, false))
        assertEquals("13:00 · 2 fotoğraf", Gorunus.altSatir("13:00", 2, false))
        assertEquals("13:00 · eşitlenecek", Gorunus.altSatir("13:00", 0, true))
        assertEquals("1 fotoğraf · eşitlenecek", Gorunus.altSatir(null, 1, true))
        assertEquals("13:00 @ İş yeri", KayitKurucu.bolgeli("13:00", "İş yeri"))
        assertEquals("@ İş yeri", KayitKurucu.bolgeli(null, "İş yeri"))
    }

    @Test
    fun bugunBolgeEkVeErtelenen() {
        val c = BugunCekirdegi()
        c.ekle(
            kayit("v", "Fatura öde", an(GUN.toString(), "18:00")).v3(bolge = "İş yeri", ekler = listOf(eki("e1"), eki("e2"))),
            kayit("d", "Düz iş", an(GUN.toString(), "19:00")),
        )
        c.sahte.ertelenenler += "v"
        val m = BugunDenetleyici(c) { SIMDI }.run { hepsiniOku(); model() }
        val v = m.acikler.single { it.kayitId == "v" }
        val zaman = v.zaman!!
        // Bölgede yalnız ad; konum yok.
        assertTrue(zaman, zaman.contains("18:00 @ İş yeri"))
        assertTrue(zaman, zaman.endsWith(" · 2 fotoğraf · eşitlenecek"))
        assertEquals(2, v.ekSayisi)
        assertTrue(v.ertelenen)
        // TalkBack: işaretler uzun hâliyle; "·" okunmaz.
        assertTrue(v.aciklama, v.aciklama.contains("@ İş yeri"))
        assertTrue(v.aciklama, v.aciklama.contains("2 fotoğraf eki"))
        assertTrue(v.aciklama, v.aciklama.contains("PC'deki servis güncellenince eşitlenecek"))
        assertFalse(v.aciklama, v.aciklama.contains("·"))
        // v3 alanı olmayan kayıt eskisi gibi.
        val d = m.acikler.single { it.kayitId == "d" }
        assertFalse(d.zaman!!, d.zaman!!.contains("@") || d.zaman!!.contains("·"))
        assertFalse(d.ertelenen)
        assertEquals(0, d.ekSayisi)
    }

    @Test
    fun takvimBolgeEkErtelenenVeSimge() {
        val c = TakvimCekirdegi()
        c.ekle(kayit("t", "Kahve", an(GUN.toString(), "10:00")).v3(simge = "kitap", bolge = "Ev", ekler = listOf(eki("e"))))
        c.sahte.ertelenenler += "t"
        val d = TakvimSahneDenetleyici(c) { SIMDI }
        val durum = TakvimDurumu.baslangic(GUN)
        d.hepsiniOku(durum)
        while (d.renkleriDoldur(durum)) Unit
        val m = d.model(durum)
        val k = m.gun!!.kayitlar!!.single()
        assertEquals("10:00 @ Ev · 1 fotoğraf · eşitlenecek", k.zaman)
        assertEquals("kitap", k.cizim)
        assertTrue(k.ertelenen)
        // Ay ızgarasındaki nokta da kaydın simgesinin rengini taşır.
        val nokta = m.aylar.values.firstNotNullOf { it.hucre(GUN) }.noktalar.single()
        assertEquals(varsayilanLevhaRengi("kitap"), nokta.renk)
    }

    @Test
    fun tarihsizBolgeEkErtelenenVeSimge() {
        val c = BugunCekirdegi()
        c.ekle(
            kayit("n", "Kahve al", aciklama = "Çekirdek").v3(simge = "market", bolge = "Market", ekler = listOf(eki("e"))),
            kayit("z", "Kahve al", zaman = AjandaZamani.Belirsiz("bir ara")).v3(bolge = "Ev"),
        )
        c.sahte.ertelenenler += "n"
        val d = TarihsizDenetleyici(c)
        d.hepsiniOku()
        val m = d.model(gizle = false)
        val n = m.yapilacaklar.single { it.kayitId == "n" }
        assertEquals("Çekirdek @ Market · 1 fotoğraf · eşitlenecek", n.zaman)
        assertEquals("market", n.cizim)
        val z = m.yapilacaklar.single { it.kayitId == "z" }
        assertEquals("“bir ara” @ Ev", z.zaman)
        assertEquals("kahve", z.cizim)
        assertFalse(z.ertelenen)
    }
}
