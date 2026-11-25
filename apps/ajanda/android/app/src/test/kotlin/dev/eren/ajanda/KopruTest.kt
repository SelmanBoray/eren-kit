package dev.eren.ajanda

import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.Kabuk
import dev.eren.ajanda.cekirdek.KabukHatasi
import dev.eren.ajanda.cekirdek.cekirdekSurumu
import dev.eren.ajanda.kabuk.AndroidKabuk
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.concurrent.atomic.AtomicInteger

/**
 * Üretilen UniFFI bağlamalarını masaüstü JVM'de gerçek Rust kitaplığına karşı çalıştırır
 * (Gradle `jna.library.path`'i target/debug'a ayarlar). Android'e özgü kod yok.
 */
class KopruTest {
    @get:Rule
    val gecici = TemporaryFolder()

    private fun ac(kabuk: Kabuk) = Cekirdek.ac(gecici.newFile("t.sqlite3").absolutePath, kabuk)

    @Test
    fun kotlindenRustaRusttanKotlineVeSqlite() {
        val cagri = AtomicInteger()
        val kabuk = object : Kabuk {
            override fun imzala(veri: ByteArray): ByteArray {
                cagri.incrementAndGet()
                return veri.reversedArray()
            }
        }
        ac(kabuk).use { c ->
            val metin = "merhaba ğüşİıöç"
            val k = c.imzalaVeYaz(metin)
            assertEquals(1, cagri.get())
            assertArrayEquals(metin.toByteArray().reversedArray(), k.imza)
            val o = c.oku(k.kimlik)!!
            assertEquals(metin, o.metin)
            assertArrayEquals(k.imza, o.imza)
            assertNull(c.oku(k.kimlik + 1))
            assertEquals(1L, c.semaSurumu())
        }
    }

    @Test
    fun kabukHatasiRustaGidipCekirdekHatasiOlarakDoner() {
        val kabuk = object : Kabuk {
            override fun imzala(veri: ByteArray): ByteArray = throw KabukHatasi.Basarisiz("anahtar yok")
        }
        ac(kabuk).use { c ->
            try {
                c.imzalaVeYaz("x")
                fail("istisna bekleniyordu")
            } catch (e: CekirdekHatasi.KabukCagrisi) {
                assertTrue(e.mesaj, e.mesaj.contains("anahtar yok"))
            }
            assertNull("hata olunca yazılmamalı", c.oku(1))
        }
    }

    @Test
    fun beklenmeyenKotlinIstisnasiDeTasinir() {
        val kabuk = object : Kabuk {
            override fun imzala(veri: ByteArray): ByteArray = error("patladı")
        }
        ac(kabuk).use { c ->
            try {
                c.imzalaVeYaz("x")
                fail("istisna bekleniyordu")
            } catch (e: CekirdekHatasi.KabukCagrisi) {
                assertTrue(e.mesaj, e.mesaj.contains("patladı"))
            }
        }
    }

    @Test
    fun ekrandakiKanitAndroidKabuguylaCalisir() {
        ac(AndroidKabuk()).use { c ->
            val rapor = KopruKaniti.calistir(c)
            assertTrue(rapor, rapor.endsWith(KopruKaniti.TAMAM))
            assertTrue(rapor, rapor.contains("32 bayt"))
        }
        assertTrue(cekirdekSurumu().isNotEmpty())
    }
}
