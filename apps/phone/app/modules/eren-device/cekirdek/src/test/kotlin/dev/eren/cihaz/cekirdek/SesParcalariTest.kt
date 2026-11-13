package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.random.Random

class SesParcalariTest {

    private fun bosluksuz(s: String): String = s.filterNot { it.isWhitespace() }

    private fun denetle(metin: String, azami: Int): List<String> {
        val p = SesParcalari.bol(metin, azami)
        val sinir = azami.coerceAtLeast(2)
        for (x in p) {
            assertTrue(x.length <= sinir, "sınır aşıldı ($sinir): ${x.length}")
            assertTrue(x.isNotEmpty(), "boş parça")
            assertEquals(x.trim(), x, "kırpılmamış parça")
            assertFalse(Character.isLowSurrogate(x.first()), "vekil çifti bölündü (baş)")
            assertFalse(Character.isHighSurrogate(x.last()), "vekil çifti bölündü (son)")
        }
        assertEquals(bosluksuz(metin), bosluksuz(p.joinToString("")), "içerik korunmadı")
        return p
    }

    @Test
    fun bosVeYalnizBoslukParcaVermez() {
        assertEquals(emptyList<String>(), SesParcalari.bol("", 100))
        assertEquals(emptyList<String>(), SesParcalari.bol(" \n\t  \r\n ", 100))
    }

    @Test
    fun kisaMetinTekParcaVeBosluklarTeklesir() {
        assertEquals(listOf("Merhaba dünya. Nasılsın?"), denetle("  Merhaba   dünya.\tNasılsın?  ", 4000))
    }

    @Test
    fun cumleSinirindanBolunur() {
        val metin = "Bir iki üç. Dört beş altı! Yedi sekiz? Dokuz on."
        // "Bir iki üç. Dört beş altı!" 26 karakter: iki cümle sığar, üçüncüsü sığmaz.
        assertEquals(
            listOf("Bir iki üç. Dört beş altı!", "Yedi sekiz? Dokuz on."),
            denetle(metin, 26),
        )
        // Her parça bir cümle sonunda biter.
        for (p in denetle(metin, 15)) assertTrue(p.last() in ".!?", p)
    }

    @Test
    fun ondalikNoktaSinirDegilKapanisTirnagiCumleyeDahil() {
        val metin = "Değer 3.5 oldu. Dedi ki: “Tamam.” Sonra gitti."
        assertEquals(
            listOf("Değer 3.5 oldu.", "Dedi ki: “Tamam.”", "Sonra gitti."),
            denetle(metin, 18),
        )
    }

    @Test
    fun satirSonuAyiriciOlarakKorunur() {
        assertEquals(listOf("Madde bir\nMadde iki\nMadde üç"), denetle("Madde bir\nMadde iki\r\n\nMadde üç", 100))
        assertEquals(listOf("Tamam.\nSonraki satır. Aynı satır."), denetle("Tamam.\nSonraki satır. Aynı satır.", 100))
    }

    @Test
    fun uzunCumleOnceAraImdenSonraBosluktanBolunur() {
        val metin = "aaaa bbbb, cccc dddd eeee"
        // 20 sınırında: ikinci yarıdaki virgülden sonra kesilir (son boşluk "dddd" sonrası olsa da).
        assertEquals(listOf("aaaa bbbb,", "cccc dddd eeee"), denetle(metin, 20))
        // Virgül yoksa son boşluktan.
        assertEquals(listOf("aaaa bbbb cccc", "dddd eeee"), denetle("aaaa bbbb cccc dddd eeee", 14))
    }

    @Test
    fun bosluksuzUzunMetinSertKesilirVekilCiftiBolunmez() {
        val emoji = "😀" // tek kod noktası, iki UTF-16 birimi
        val metin = "a" + emoji.repeat(10)
        val p = denetle(metin, 4)
        assertEquals(listOf("a" + emoji, emoji + emoji), p.take(2))
        assertTrue(p.all { it.length <= 4 })
    }

    @Test
    fun cokKucukSinirDonguyeGirmez() {
        assertEquals(listOf("ab", "cd", "e"), denetle("abcde", 0))
        assertEquals(listOf("ab", "cd", "e"), denetle("abcde", -5))
    }

    @Test
    fun rastgeleMetinlerdeSinirVeIcerikKorunur() {
        val rnd = Random(20261113)
        val havuz = "abcçdefgğhıijklmnoöprsştuüvyz.,;:!?… \n\t\"”)".toList() + listOf('\uD83D')
        repeat(300) { _ ->
            val sb = StringBuilder()
            repeat(rnd.nextInt(0, 400)) { _ ->
                val c = havuz[rnd.nextInt(havuz.size)]
                // Yüksek vekil yalnız eşiyle birlikte eklenir.
                if (c == '\uD83D') sb.append("😀") else sb.append(c)
            }
            denetle(sb.toString(), rnd.nextInt(2, 60))
        }
    }

    @Test
    fun platformBoyundaUzunMetinBirkacParcayaBolunur() {
        val cumle = "Bu bir deneme cümlesidir ve biraz uzundur. "
        val metin = cumle.repeat(300) // ~13000 karakter
        val p = denetle(metin, 4000)
        assertTrue(p.size in 4..5, "parça sayısı: ${p.size}")
        for (x in p) assertTrue(x.endsWith("."), "cümle ortasında bölündü")
    }
}
