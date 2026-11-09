package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.text.Normalizer

class EtiketTest {
    private fun dugum(
        ad: String = "",
        ipucu: String? = null,
        kaynakId: String? = null,
        tiklanabilir: Boolean = false,
        parola: Boolean = false,
        duzenlenebilir: Boolean = false,
    ) = Dugum(
        no = 0, paket = "com.ornek.uygulama", rol = "node", ad = ad, deger = null, ipucu = ipucu,
        kaynakId = kaynakId, sinir = Dikdortgen(0, 0, 10, 10), tiklanabilir = tiklanabilir,
        duzenlenebilir = duzenlenebilir, etkin = true, parola = parola, odakli = false,
    )

    private fun baglam(d: Dugum, atalar: List<Dugum> = emptyList(), torunlar: List<Dugum> = emptyList()) =
        DugumBaglami(d, atalar, torunlar)

    @Test
    fun saldirganYazimlarEslesir() {
        val nfd = Normalizer.normalize("Gönder", Normalizer.Form.NFD)
        assertNotEquals("Gönder", nfd)
        val metinler = listOf(
            "GÖNDER", "Gönder ", "gönder", "Gö​nder", "Gö­nder", nfd, "SEND",
            "Send message", "Sil", "SİL", "sıl", "Delete", "Öde", "Pay now", "Satın al", "Onayla",
        )
        for (m in metinler) {
            val kod = m.map { it.code }
            assertTrue(Etiket.eslesir(m), "eşleşmeliydi: $kod")
            assertTrue(Etiket.etiketli(baglam(dugum(ad = m))), "etiketli olmalıydı: $kod")
        }
    }

    @Test
    fun masumMetinlerEslesmez() {
        assertFalse(Etiket.eslesir("Gelen kutusu"))
        assertFalse(Etiket.eslesir("Ayarlar"))
        assertFalse(Etiket.eslesir(""))
    }

    @Test
    fun katlamaGorunmezVeIleHarfleriAtar() {
        assertEquals("gonder", Etiket.katla("GÖNDER"))
        assertEquals("gonder", Etiket.katla("Gö​nd­er"))
        assertEquals("sil", Etiket.katla("SİL"))
        assertEquals("sil", Etiket.katla("sıl"))
    }

    @Test
    fun tiklanabilirAtaEtiketliyse() {
        val ata = dugum(ad = "Sil", tiklanabilir = true)
        assertTrue(Etiket.etiketli(baglam(dugum(), atalar = listOf(ata))))
    }

    @Test
    fun torunlardanBiriEtiketliyse() {
        val torunlar = listOf(dugum(ad = "Ayarlar"), dugum(ad = "Gönder"))
        assertTrue(Etiket.etiketli(baglam(dugum(), torunlar = torunlar)))
    }

    @Test
    fun masumBaglamEtiketsiz() {
        val b = baglam(
            dugum(ad = "Gelen kutusu"),
            listOf(dugum(ad = "Ayarlar", tiklanabilir = true)),
            listOf(dugum(ad = "Ayarlar")),
        )
        assertFalse(Etiket.etiketli(b))
    }

    @Test
    fun kaynakIdEtiketiEslesir() {
        for (id in listOf("com.x:id/btnSend", "sendButton")) {
            assertTrue(Etiket.etiketli(baglam(dugum(kaynakId = id))), id)
        }
    }

    @Test
    fun parolaAlaniTanir() {
        assertTrue(Etiket.parolaAlani(dugum(parola = true)))
        for (ip in listOf("Şifre", "PIN", "OTP", "password", "Doğrulama kodu")) {
            assertTrue(Etiket.parolaAlani(dugum(ipucu = ip)), ip)
        }
        assertFalse(Etiket.parolaAlani(dugum(ipucu = "Ara")))
        assertFalse(Etiket.parolaAlani(dugum(ad = "Ayarlar")))
    }
}
