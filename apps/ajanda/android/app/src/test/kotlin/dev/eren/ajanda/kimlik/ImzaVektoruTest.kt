package dev.eren.ajanda.kimlik

import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `ajanda-kurallar.json` `imza` vektörü: Rust'ta kripto olmadığı için (MIMARI.md) gerçek P-256 imzası
 * burada, uygulamanın kullandığı doğrulama işleviyle ([P256.dogrula], `KimlikKabugu.dogrula`) sınanır.
 */
class ImzaVektoruTest {
    private val kurallar = Vektorler.kurallar()

    @Suppress("UNCHECKED_CAST")
    private val imza = kurallar["imza"] as Map<String, Any?>

    @Suppress("UNCHECKED_CAST")
    private fun imzaMetni(ad: String): Map<String, Any?> =
        (kurallar["imza_metni"] as List<Map<String, Any?>>).single { it["ad"] == ad }

    private fun b64(s: Any?) = Base64.getDecoder().decode(s as String)
    private val acik = b64(imza["public_key"])
    private val imzaDer = b64(imza["signature"])
    private val dogruMetin = metinBaytlari(imza["dogru_metin"] as String)
    private val yanlisMetin = metinBaytlari(imza["yanlis_metin"] as String)

    /** Vektördeki metnin UTF-8 baytları; vektörün kendi onaltılığıyla da tutmalı. */
    private fun metinBaytlari(ad: String): ByteArray {
        val girdi = imzaMetni(ad)
        val bayt = (girdi["metin"] as String).toByteArray(Charsets.UTF_8)
        val hex = bayt.joinToString("") { "%02x".format(it.toInt() and 0xFF) }
        assertEquals("imza_metni[$ad].utf8_hex", girdi["utf8_hex"], hex)
        return bayt
    }

    private val kimlik = KeystoreKimlik(YazilimAnahtari(), java.security.SecureRandom())

    @Test
    fun vektorunImzasiDogruMetinleDogrulanir() {
        assertTrue(P256.acikAnahtarMi(acik))
        assertTrue(P256.dogrula(acik, dogruMetin, imzaDer))
        // Çekirdeğin çağırdığı yol aynı sonucu verir.
        assertTrue(kimlik.dogrula(acik, dogruMetin, imzaDer))
    }

    @Test
    fun ayniImzaTelefonMetniyleReddedilir() {
        assertFalse(P256.dogrula(acik, yanlisMetin, imzaDer))
        assertFalse(kimlik.dogrula(acik, yanlisMetin, imzaDer))
    }

    @Test
    fun baskaKanalinImzaMetniReddedilir() {
        val pc = String(dogruMetin, Charsets.UTF_8)
        val sohbet = pc.replace("kanal:ajanda", "kanal:sohbet").replace("kapsam:ajanda", "kapsam:sohbet")
        val eskiOnek = pc.replace("eren-ajanda-auth-v1", "eren-auth-v1")
        for (m in listOf(sohbet, eskiOnek, pc + "\n", pc.removeSuffix(pc.takeLast(1)))) {
            assertFalse(m, P256.dogrula(acik, m.toByteArray(Charsets.UTF_8), imzaDer))
        }
    }

    @Test
    fun bozukImzaReddedilirIstisnaAtilmaz() {
        for (i in listOf(4, 10, 20, imzaDer.size / 2, imzaDer.size - 1)) {
            val bozuk = imzaDer.copyOf().also { it[i] = (it[i].toInt() xor 0x01).toByte() }
            assertFalse("bayt $i", P256.dogrula(acik, dogruMetin, bozuk))
        }
        assertFalse(P256.dogrula(acik, dogruMetin, imzaDer.copyOf(imzaDer.size - 1)))
        assertFalse(P256.dogrula(acik, dogruMetin, ByteArray(0)))
        assertFalse(P256.dogrula(acik, dogruMetin, ByteArray(64) { 1 })) // DER değil (ham r||s)
        assertFalse(P256.dogrula(acik, dogruMetin, ByteArray(P256.AZAMI_IMZA + 1)))
    }

    @Test
    fun bozukYaDaBaskaEgriAnahtarReddedilir() {
        assertFalse(P256.dogrula(acik.copyOf(acik.size - 1), dogruMetin, imzaDer))
        assertFalse(P256.dogrula(ByteArray(91), dogruMetin, imzaDer))
        val p384 = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp384r1")) }
            .generateKeyPair().public.encoded
        assertFalse(P256.acikAnahtarMi(p384))
        assertFalse(P256.dogrula(p384, dogruMetin, imzaDer))
        // Başka bir P-256 anahtarı: biçim doğru, imza tutmaz.
        val baska = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }
            .generateKeyPair().public.encoded
        assertTrue(P256.acikAnahtarMi(baska))
        assertFalse(P256.dogrula(baska, dogruMetin, imzaDer))
    }

    @Test
    fun parmakIziPcIleAyniKural() {
        // PC testindeki sabit: "abc"nin SHA-256'sı (FIPS 180-2).
        assertEquals(
            "BA78 16BF 8F01 CFEA 4141 40DE 5DAE 2223 B003 61A3 9617 7A9C B410 FF61 F200 15AD",
            P256.parmakIzi("abc".toByteArray(Charsets.US_ASCII)),
        )
        val izi = P256.parmakIzi(acik)
        assertTrue(izi, Regex("^([0-9A-F]{4} ){15}[0-9A-F]{4}$").matches(izi))
        assertArrayEquals(acik, P256.base64Coz(imza["public_key"] as String))
        assertNull(P256.base64Coz("YWJj"))
        assertNull(P256.base64Coz("%%%"))
    }
}
