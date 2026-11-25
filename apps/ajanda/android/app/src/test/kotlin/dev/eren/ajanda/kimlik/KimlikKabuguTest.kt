package dev.eren.ajanda.kimlik

import dev.eren.ajanda.cekirdek.KabukHatasi
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * JVM'de Android Keystore yok: `AndroidKeystoreAnahtari` yerine aynı sözleşmeli yazılım anahtarı.
 * Sınanan, [KeystoreKimlik]'in kabuk davranışı ve kodlamalar (SPKI DER, DER imza, base64 sınırları).
 * Keystore'un kendisi yalnız gerçek cihazda denenebilir (rapor).
 */
internal class YazilimAnahtari : CihazAnahtari {
    private var cift: KeyPair? = null
    var uretilen = 0

    private fun al(): KeyPair = cift ?: KeyPairGenerator.getInstance("EC")
        .apply { initialize(ECGenParameterSpec("secp256r1")) }
        .generateKeyPair().also { cift = it; uretilen++ }

    override fun acikAnahtar(): ByteArray = al().public.encoded

    override fun imzala(veri: ByteArray): ByteArray =
        Signature.getInstance(P256.IMZA_ALGORITMASI).run {
            initSign(al().private)
            update(veri)
            sign()
        }

    override fun sil() {
        cift = null
    }
}

class KimlikKabuguTest {
    private val anahtar = YazilimAnahtari()
    private val kimlik = KeystoreKimlik(anahtar, SecureRandom())

    /** Sözleşmenin base64 kuralı (`temel.ts` `BASE64`) ve uzunluk sınırları (`SINIRLAR`). */
    private val base64 = Regex("^[A-Za-z0-9+/]+={0,2}$")

    @Test
    fun acikAnahtarP256SpkiDer() {
        val der = kimlik.acikAnahtar()
        assertEquals(P256.SPKI_UZUNLUGU, der.size)
        assertTrue(P256.acikAnahtarMi(der))
        val k = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(der)) as ECPublicKey
        assertEquals(256, k.params.curve.field.fieldSize)
        assertEquals("X.509", k.format)
        val b64 = Base64.getEncoder().encodeToString(der)
        assertTrue(base64.matches(b64))
        assertTrue(b64.length in 1..256) // ACIK_ANAHTAR_MAX
        // Aynı anahtar: ikinci çağrı yeni anahtar üretmez.
        assertArrayEquals(der, kimlik.acikAnahtar())
        assertEquals(1, anahtar.uretilen)
    }

    @Test
    fun imzaDerVeDogrulanabilir() {
        val metin = "eren-ajanda-auth-v1\ntelefon\nkanal:ajanda\nkapsam:ajanda\ncihaz_Ornek\nQUJD\nREVG"
            .toByteArray(Charsets.UTF_8)
        val imza = kimlik.imzala(metin)
        assertTrue(derEcdsaMi(imza))
        assertTrue(imza.size <= P256.AZAMI_IMZA)
        val b64 = Base64.getEncoder().encodeToString(imza)
        assertTrue(base64.matches(b64))
        assertTrue(b64.length <= 256) // IMZA_MAX
        assertTrue(kimlik.dogrula(kimlik.acikAnahtar(), metin, imza))
        assertFalse(kimlik.dogrula(kimlik.acikAnahtar(), metin + 0x0a.toByte(), imza))
    }

    @Test
    fun silinceYeniAnahtar() {
        val ilk = kimlik.acikAnahtar()
        val eskiImza = kimlik.imzala(byteArrayOf(1, 2, 3))
        kimlik.anahtariSil()
        val ikinci = kimlik.acikAnahtar()
        assertFalse(ilk.contentEquals(ikinci))
        assertEquals(2, anahtar.uretilen)
        // Eski anahtarla alınmış imza yeni anahtarla doğrulanmaz.
        assertFalse(kimlik.dogrula(ikinci, byteArrayOf(1, 2, 3), eskiImza))
        assertTrue(kimlik.dogrula(ilk, byteArrayOf(1, 2, 3), eskiImza))
        kimlik.anahtariSil()
        kimlik.anahtariSil() // yokken silmek hata değil
    }

    @Test
    fun rastgeleUzunlukVeSinir() {
        assertEquals(0, kimlik.rastgele(0u).size)
        val a = kimlik.rastgele(32u)
        val b = kimlik.rastgele(32u)
        assertEquals(32, a.size)
        assertNotEquals(a.toList(), b.toList())
        assertEquals(KeystoreKimlik.AZAMI_RASTGELE.toInt(), kimlik.rastgele(KeystoreKimlik.AZAMI_RASTGELE).size)
        try {
            kimlik.rastgele(KeystoreKimlik.AZAMI_RASTGELE + 1u)
            fail("sınır aşıldı")
        } catch (e: KabukHatasi.Basarisiz) {
            assertTrue(e.mesaj.contains("rastgele"))
        }
    }

    @Test
    fun anahtarHatasiKabukHatasinaCevrilirMalzemeSizmaz() {
        val bozuk = object : CihazAnahtari {
            override fun acikAnahtar(): ByteArray = ByteArray(65) { 4 } // SPKI değil (ham nokta)
            override fun imzala(veri: ByteArray): ByteArray = throw IllegalStateException("GIZLI-" + String(veri))
            override fun sil() = throw java.security.KeyStoreException("x")
        }
        val k = KeystoreKimlik(bozuk, SecureRandom())
        try {
            k.acikAnahtar()
            fail()
        } catch (e: KabukHatasi.Basarisiz) {
            assertTrue(e.mesaj.contains("P-256"))
        }
        try {
            k.imzala("sir".toByteArray())
            fail()
        } catch (e: KabukHatasi.Basarisiz) {
            assertFalse(e.mesaj, e.mesaj.contains("GIZLI") || e.mesaj.contains("sir"))
            assertTrue(e.mesaj.contains("IllegalStateException"))
        }
        try {
            k.anahtariSil()
            fail()
        } catch (e: KabukHatasi.Basarisiz) {
            assertTrue(e.mesaj.contains("KeyStoreException"))
        }
    }

    /** `SEQUENCE { INTEGER r, INTEGER s }`, kısa uzunluk biçimi, r ve s 1..33 bayt. */
    private fun derEcdsaMi(d: ByteArray): Boolean {
        if (d.size < 8 || d[0] != 0x30.toByte() || (d[1].toInt() and 0xFF) != d.size - 2) return false
        var i = 2
        repeat(2) {
            if (d[i] != 0x02.toByte()) return false
            val n = d[i + 1].toInt() and 0xFF
            if (n !in 1..33) return false
            i += 2 + n
        }
        return i == d.size
    }
}
