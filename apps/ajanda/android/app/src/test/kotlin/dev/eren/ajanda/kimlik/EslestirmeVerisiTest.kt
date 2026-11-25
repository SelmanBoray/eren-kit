package dev.eren.ajanda.kimlik

import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Yapıştırılan çıktının çözümü ve kısa kod. Şema denetimi gerçek Rust `eslestirmeQrCoz`'dan geçer
 * (Gradle masaüstü kitaplığını derler, JNA yükler); QR vektörleri `ajanda-kurallar.json` `qr`'dan.
 */
class EslestirmeVerisiTest {
    @Suppress("UNCHECKED_CAST")
    private val qrVektoru = Vektorler.kurallar()["qr"] as Map<String, Any?>

    @Suppress("UNCHECKED_CAST")
    private val gecerli = (qrVektoru["gecerli"] as List<Map<String, Any?>>).single()

    @Suppress("UNCHECKED_CAST")
    private fun gecersiz(ad: String): Map<String, Any?> =
        (qrVektoru["gecersiz"] as List<Map<String, Any?>>).single { it["ad"] == ad }["qr"] as Map<String, Any?>

    private val satir = Json.yaz(gecerli)
    private val parmakIzi = P256.parmakIzi(Base64.getDecoder().decode(gecerli["server_public_key"] as String))

    /** PC'deki `kodMetni` çıktısının biçimi (eslestir.ts). */
    private fun komutCiktisi(json: String = satir, izi: String = parmakIzi, kod: String = "ABCD2345") =
        "$json\nParmak izi: $izi\nKod:$kod  (5 dakika geçerli, tek kullanımlık)\n" +
            "Kapsam: ajanda (yalnız ajanda uygulamasıyla eşleşir; sohbet kanalını açamaz).\n"

    private fun gecerliMi(c: VeriCozumu): VeriCozumu.Gecerli {
        assertTrue(c.toString(), c is VeriCozumu.Gecerli)
        return c as VeriCozumu.Gecerli
    }

    private fun hata(c: VeriCozumu): VeriHatasi {
        assertTrue(c.toString(), c is VeriCozumu.Hatali)
        return (c as VeriCozumu.Hatali).hata
    }

    @Test
    fun gecerliAjandaVerisi() {
        val g = gecerliMi(EslestirmeVerisi.coz(satir))
        assertEquals("100.101.102.103", g.qr.host)
        assertEquals(8765, g.qr.port)
        assertEquals("ABCD2345", g.qr.kod)
        assertEquals(gecerli["server_public_key"], g.qr.serverPublicKey)
        assertEquals(parmakIzi, g.parmakIzi)
    }

    @Test
    fun komutCiktisininTamamiVeEtrafindakiSatirlar() {
        val metin = "PS C:\\> eslestir --ajanda\r\n" +
            "Uyarı: {bu satır { ile başlamıyor}\r\n" +
            "   " + komutCiktisi().replace("\n", "\r\n") +
            "{\"bu\":\"ikinci süslü satır, okunmaz\"}\r\n"
        val g = gecerliMi(EslestirmeVerisi.coz(metin))
        assertEquals("ABCD2345", g.qr.kod)
        assertEquals(satir, EslestirmeVerisi.jsonSatiriniBul(metin))
        // Bayt sırası işareti ve yalnız \r ile ayrılmış satırlar.
        gecerliMi(EslestirmeVerisi.coz("\uFEFF" + komutCiktisi().replace("\n", "\r")))
    }

    @Test
    fun sohbetVerisiReddedilir() {
        assertEquals(VeriHatasi.BaskaKanal, hata(EslestirmeVerisi.coz(Json.yaz(gecersiz("eski QR (kanal yok)")))))
        assertEquals(VeriHatasi.BaskaKanal, hata(EslestirmeVerisi.coz(Json.yaz(gecersiz("başka kanal")))))
        // Sohbet komutunun tam çıktısı (kanal yok, kapsam satırı yok).
        val sohbet = Json.yaz(gecersiz("eski QR (kanal yok)")) + "\nParmak izi: $parmakIzi\nKod:ABCD2345  (5 dakika geçerli, tek kullanımlık)\n"
        assertEquals(VeriHatasi.BaskaKanal, hata(EslestirmeVerisi.coz(sohbet)))
    }

    @Test
    fun fazlaEksikVeBicimsizAlanlar() {
        val kapsam = hata(EslestirmeVerisi.coz(Json.yaz(gecersiz("kapsam alanı"))))
        assertEquals(VeriHatasi.GecersizAlan("kapsam", "bilinmeyen alan"), kapsam)

        val tailscaleDisi = hata(EslestirmeVerisi.coz(Json.yaz(gecersiz("Tailscale dışı adres"))))
        assertTrue(tailscaleDisi.toString(), tailscaleDisi is VeriHatasi.GecersizAlan && tailscaleDisi.alan == "host")

        for (alan in listOf("v", "host", "port", "kod", "server_public_key")) {
            val h = hata(EslestirmeVerisi.coz(Json.yaz(gecerli - alan)))
            assertEquals(alan, VeriHatasi.GecersizAlan(alan, "zorunlu alan yok"), h)
        }
        val surum = hata(EslestirmeVerisi.coz(Json.yaz(gecerli + ("v" to 2L))))
        assertTrue(surum is VeriHatasi.GecersizAlan && surum.alan == "v")
        val port = hata(EslestirmeVerisi.coz(Json.yaz(gecerli + ("port" to 70000L))))
        assertTrue(port is VeriHatasi.GecersizAlan && port.alan == "port")
        val kucukKod = hata(EslestirmeVerisi.coz(Json.yaz(gecerli + ("kod" to "abcd2345"))))
        assertTrue(kucukKod is VeriHatasi.GecersizAlan && kucukKod.alan == "kod")
        // Şemadan geçen ama P-256 SPKI olmayan anahtar ("abc").
        val anahtar = hata(EslestirmeVerisi.coz(Json.yaz(gecerli + ("server_public_key" to "YWJj"))))
        assertTrue(anahtar is VeriHatasi.GecersizAlan && anahtar.alan == "server_public_key")
    }

    @Test
    fun bozukEksikYaDaUzunMetin() {
        assertEquals(VeriCozumu.Bos, EslestirmeVerisi.coz(""))
        assertEquals(VeriCozumu.Bos, EslestirmeVerisi.coz(" \n\t "))
        assertEquals(VeriHatasi.JsonSatiriYok, hata(EslestirmeVerisi.coz("Kod:ABCD2345\nParmak izi: AAAA")))
        assertEquals(VeriHatasi.JsonDegil, hata(EslestirmeVerisi.coz(satir.dropLast(1))))
        assertEquals(VeriHatasi.JsonDegil, hata(EslestirmeVerisi.coz("{v:1}")))
        assertTrue(hata(EslestirmeVerisi.coz("[1,2]")) == VeriHatasi.JsonSatiriYok)
        assertEquals(VeriHatasi.CokUzun, hata(EslestirmeVerisi.coz(satir + "\n" + "x".repeat(EslestirmeVerisi.AZAMI_METIN))))
        assertEquals(VeriHatasi.CokUzun, hata(EslestirmeVerisi.coz("{" + " ".repeat(EslestirmeVerisi.AZAMI_SATIR) + "}")))
    }

    @Test
    fun parmakIziSatiriDenetlenir() {
        // Aynı iz, farklı boşluk ve harf büyüklüğüyle: kabul.
        gecerliMi(EslestirmeVerisi.coz(komutCiktisi(izi = parmakIzi.lowercase().replace(" ", ""))))
        // Başka anahtarın izi: metin karışmış.
        val baska = P256.parmakIzi("abc".toByteArray())
        assertEquals(VeriHatasi.ParmakIziUyusmuyor, hata(EslestirmeVerisi.coz(komutCiktisi(izi = baska))))
        assertNull(EslestirmeVerisi.parmakIziSatiri(satir))
    }

    @Test
    fun kodDuzeltme() {
        assertEquals("ABCD2345", EslestirmeVerisi.koduDuzelt(" abcd-2345 "))
        assertEquals("ABCD2345", EslestirmeVerisi.koduDuzelt("Kod:ABCD2345"))
        assertEquals("ABCD2345", EslestirmeVerisi.koduDuzelt("kod: ABCD 2345"))
        // Türkçe klavye: i -> I (İ değil), İ ve ı -> I.
        assertEquals("IIII12", EslestirmeVerisi.koduDuzelt("iİıI12"))
        // ASCII dışı harf olduğu gibi kalır (biçim denetimi onu "geçersiz karakter" diye gösterir).
        assertEquals("ABş123", EslestirmeVerisi.koduDuzelt("abş123"))
        assertEquals(KodHatasi.GecersizKarakter, EslestirmeVerisi.kodBicimHatasi(EslestirmeVerisi.koduDuzelt("abş123")))
    }

    @Test
    fun kodBicimi() {
        assertEquals(KodHatasi.Bos, EslestirmeVerisi.kodBicimHatasi(""))
        assertEquals(KodHatasi.Kisa, EslestirmeVerisi.kodBicimHatasi("ABC12"))
        assertNull(EslestirmeVerisi.kodBicimHatasi("ABC123"))
        assertNull(EslestirmeVerisi.kodBicimHatasi("A".repeat(32)))
        assertEquals(KodHatasi.Uzun, EslestirmeVerisi.kodBicimHatasi("A".repeat(33)))
        assertEquals(KodHatasi.GecersizKarakter, EslestirmeVerisi.kodBicimHatasi("ABŞ123"))
        assertEquals(KodHatasi.GecersizKarakter, EslestirmeVerisi.kodBicimHatasi("abcd2345"))
        assertEquals(KodHatasi.GecersizKarakter, EslestirmeVerisi.kodBicimHatasi("ABCD 2345"))
    }

    @Test
    fun kodVeriyleKarsilastirilir() {
        val veri = EslestirmeVerisi.coz(komutCiktisi())
        assertNull(EslestirmeVerisi.kodHatasi("ABCD2345", veri))
        assertEquals(KodHatasi.VeriyleUyusmuyor, EslestirmeVerisi.kodHatasi("ABCD2346", veri))
        assertEquals(KodHatasi.VeriyleUyusmuyor, EslestirmeVerisi.kodHatasi("ABCD23456", veri))
        // Biçim hatası önce gelir.
        assertEquals(KodHatasi.Kisa, EslestirmeVerisi.kodHatasi("ABCD", veri))
        // Veri yokken yalnız biçim.
        assertNull(EslestirmeVerisi.kodHatasi("ABCD2346", VeriCozumu.Bos))
    }
}
