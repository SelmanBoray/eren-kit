package dev.eren.ajanda.ag

import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.GecisNedeni
import dev.eren.ajanda.cekirdek.GecisOzeti
import dev.eren.ajanda.cekirdek.KoparmaSonucu
import dev.eren.ajanda.kimlik.GecisMetinleri
import dev.eren.ajanda.kimlik.GecisMetni
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** K5: yerel kipte eşleşme varken duran arka plan eşitlemesi geçiş başına bir kez, doğru metinle bildirilir. */
class DuraklamaBildirimiTest {
    private fun ozet(neden: GecisNedeni, ts: Long) = GecisOzeti(
        neden, ts, KoparmaSonucu(CalismaKipi.BAGLI, 0, 0, 0, 0, false, 0), "depo-a",
        if (neden == GecisNedeni.DEPO_DEGISTI) "depo-b" else null,
    )

    private var gecis: GecisOzeti? = ozet(GecisNedeni.DEPO_DEGISTI, 1_000)
    private var bekliyor = false
    private var gorunur = false
    private var izin = true
    private var saklanan: Long? = null
    private val gosterilen = mutableListOf<GecisMetni>()
    private var kaldirilan = 0
    private var cekirdekHatasi: Exception? = null
    private val uyarilar = mutableListOf<String>()

    private val b = DuraklamaBildirimi(
        cekirdek = object : DuraklamaCekirdegi {
            override fun sonGecis(): GecisOzeti? { cekirdekHatasi?.let { throw it }; return gecis }
            override fun birlestirmeBekliyor() = bekliyor
        },
        gosterilen = object : GosterilenGecis {
            override fun oku() = saklanan
            override fun yaz(tsMs: Long) { saklanan = tsMs }
        },
        bildirici = object : DuraklamaBildiricisi {
            override fun goster(m: GecisMetni): Boolean {
                if (!izin) return false
                gosterilen += m
                return true
            }
            override fun kaldir() { kaldirilan++ }
        },
        gorunur = { gorunur },
        gunluk = object : Gunluk {
            override fun bilgi(mesaj: String) {}
            override fun uyari(mesaj: String, hata: Throwable?) { uyarilar += mesaj }
        },
    )

    @Test
    fun depoDegistiGecisBasinaBirKez() {
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(1, gosterilen.size)
        assertEquals(1_000L, saklanan)
        assertEquals("Eşitleme durdu", gosterilen[0].baslik)
        assertTrue(gosterilen[0].govde.contains("Eren servisi değişti"))
        assertFalse(gosterilen[0].govde.contains("onayınızı bekliyor"))
        // Yeni geçiş: yeniden bir kez.
        gecis = ozet(GecisNedeni.DEPO_DEGISTI, 2_000)
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(2, gosterilen.size)
        assertEquals(2_000L, saklanan)
    }

    @Test
    fun yalnizGercektenBekleyenOnaydaOnayinizdiyeSoyler() {
        bekliyor = true
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals("Birleştirme onayınızı bekliyor", gosterilen.single().baslik)
        val m = GecisMetinleri.duraklama(ozet(GecisNedeni.DEPO_DEGISTI, 1), birlestirmeBekliyor = false)
        assertFalse((m.baslik + m.govde).contains("onay"))
        val k = GecisMetinleri.duraklama(ozet(GecisNedeni.KOPARMA, 1), birlestirmeBekliyor = false)
        assertTrue(k.govde.contains("yeniden bağlanma tamamlanmadı"))
        assertFalse(k.govde.contains("servisi değişti"))
    }

    @Test
    fun izinYoksaSessizAtlarSaklamaz() {
        izin = false
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertTrue(gosterilen.isEmpty())
        assertNull(saklanan)
        // İzin gelince (geçiş hâlâ gösterilmemiş) gösterilir.
        izin = true
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(1, gosterilen.size)
    }

    @Test
    fun arayuzGorunurkenGosterilmez() {
        gorunur = true
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertTrue(gosterilen.isEmpty())
        assertNull(saklanan)
        gorunur = false
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(1, gosterilen.size)
    }

    @Test
    fun arayuzGosterdiyseYinelenmez() {
        saklanan = 1_000
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertTrue(gosterilen.isEmpty())
    }

    @Test
    fun gecisYoksaYaDaBaskaSonuctaBildirimYok() {
        gecis = null
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        gecis = ozet(GecisNedeni.DEPO_DEGISTI, 5)
        for (s in ArkaPlanSonucu.entries - ArkaPlanSonucu.YEREL_KIP) b.arkaPlanBitti(s)
        assertTrue(gosterilen.isEmpty())
        // Eşitlenince ya da eşleşme kalkınca duraklama bildirimi kalkar.
        assertEquals(2, kaldirilan)
    }

    @Test
    fun cekirdekHatasiDisariCikmaz() {
        cekirdekHatasi = IllegalStateException("x")
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertTrue(gosterilen.isEmpty())
        assertEquals(listOf("duraklama bildirimi başarısız"), uyarilar)
    }

    @Test
    fun metinlerdePcVeSifirYok() {
        val pc = Regex("(?<![\\p{L}\\p{N}_])PC(?![\\p{L}\\p{N}_])")
        for (n in GecisNedeni.entries) for (bek in listOf(true, false)) {
            val m = GecisMetinleri.duraklama(ozet(n, 1), bek)
            assertFalse(pc.containsMatchIn(m.baslik + m.govde))
            assertTrue(m.satirlar.isNotEmpty())
        }
    }
}
