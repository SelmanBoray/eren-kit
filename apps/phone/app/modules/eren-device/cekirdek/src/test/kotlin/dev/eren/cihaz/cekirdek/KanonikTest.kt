package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.security.MessageDigest
import java.util.Random

class KanonikTest {
    private fun kanonik(d: JsonDeger): String {
        val s = Kanonik.kanonik(d)
        assertTrue(s is KanonikSonucu.Tamam, "kabul edilmeliydi: $s")
        return (s as KanonikSonucu.Tamam).metin
    }

    private fun hata(d: JsonDeger): KanonikHatasi {
        val s = Kanonik.kanonik(d)
        assertTrue(s is KanonikSonucu.Hata, "reddedilmeliydi: $s")
        return (s as KanonikSonucu.Hata).neden
    }

    private fun nesne(vararg c: Pair<String, JsonDeger>) = JsonDeger.Nesne(linkedMapOf(*c))
    private fun metin(s: String) = JsonDeger.Metin(s)
    private fun tam(n: Long) = JsonDeger.Tam(n)

    private fun sarmal(n: Int): JsonDeger {
        var d: JsonDeger = tam(1)
        repeat(n) { d = JsonDeger.Dizi(listOf(d)) }
        return d
    }

    @Test
    fun `anahtar sirasi UTF16 birim sirasidir`() {
        val a = nesne("b" to tam(1), "a" to tam(2), "C" to tam(3), "ç" to tam(4))
        assertEquals("""{"C":3,"a":2,"b":1,"ç":4}""", kanonik(a))
        val b = nesne("ç" to tam(4), "C" to tam(3), "b" to tam(1), "a" to tam(2))
        assertEquals(kanonik(a), kanonik(b))
        // U+FF5E ile U+1F600 (D83D DE00): UTF-16 sırasında emoji önce, kod noktası sırasında sonra.
        val c = nesne("～" to tam(1), "😀" to tam(2))
        assertEquals("{\"😀\":2,\"～\":1}", kanonik(c))
        val d = nesne("ab" to nesne("y" to tam(1), "x" to tam(2)), "a" to JsonDeger.Bos)
        assertEquals("""{"a":null,"ab":{"x":2,"y":1}}""", kanonik(d))
    }

    @Test
    fun `kacis kurallari`() {
        assertEquals("\"\\\"\\\\\\b\\t\\n\\f\\r\"", kanonik(metin("\"\\\b\t\n\u000C\r")))
        assertEquals("\"\\u0000\\u0001\\u000b\\u000e\\u001f\"", kanonik(metin("\u0000\u0001\u000b\u000e\u001f")))
        assertEquals("\"\u007f/çĞ😀 \"", kanonik(metin("\u007f/çĞ😀 ")))
        assertEquals("{\"a\\n\":1}", kanonik(nesne("a\n" to tam(1))))
        assertTrue(kanonik(metin("ç")) != kanonik(metin("ç")))
    }

    @Test
    fun `sabitler ve bos kaplar`() {
        assertEquals("null", kanonik(JsonDeger.Bos))
        assertEquals("true", kanonik(JsonDeger.Mantik(true)))
        assertEquals("false", kanonik(JsonDeger.Mantik(false)))
        assertEquals("[]", kanonik(JsonDeger.Dizi(emptyList())))
        assertEquals("{}", kanonik(JsonDeger.Nesne(emptyMap())))
        assertEquals("0", kanonik(tam(0)))
        assertEquals("-7", kanonik(tam(-7)))
        val karma = JsonDeger.Dizi(listOf(tam(1), metin("a"), JsonDeger.Bos, nesne("k" to JsonDeger.Dizi(emptyList()))))
        assertEquals("""[1,"a",null,{"k":[]}]""", kanonik(karma))
    }

    @Test
    fun `proto anahtari reddedilir`() {
        assertEquals(KanonikHatasi.YASAK_ANAHTAR, hata(nesne("__proto__" to tam(1))))
        assertEquals(
            KanonikHatasi.YASAK_ANAHTAR,
            hata(nesne("a" to JsonDeger.Dizi(listOf(nesne("__proto__" to JsonDeger.Bos))))),
        )
        assertEquals("""{"a":"__proto__"}""", kanonik(nesne("a" to metin("__proto__"))))
        assertEquals("""{"__proto":1}""", kanonik(nesne("__proto" to tam(1))))
        val ayrisan = (Json.coz("""{"__proto__":1}""") as JsonSonucu.Tamam).deger
        assertEquals(KanonikHatasi.YASAK_ANAHTAR, hata(ayrisan))
    }

    @Test
    fun `ondalik ve guvensiz sayi reddedilir`() {
        assertEquals(KanonikHatasi.ONDALIK, hata(JsonDeger.Ondalik(1.5)))
        assertEquals(KanonikHatasi.ONDALIK, hata(JsonDeger.Ondalik(0.0)))
        assertEquals(KanonikHatasi.ONDALIK, hata(JsonDeger.Ondalik(Double.NaN)))
        assertEquals(KanonikHatasi.ONDALIK, hata(JsonDeger.Ondalik(Double.POSITIVE_INFINITY)))
        assertEquals(KanonikHatasi.ONDALIK, hata(JsonDeger.Dizi(listOf(JsonDeger.Ondalik(2.5)))))
        assertEquals("9007199254740991", kanonik(tam(9007199254740991L)))
        assertEquals("-9007199254740991", kanonik(tam(-9007199254740991L)))
        assertEquals(KanonikHatasi.ONDALIK, hata(tam(9007199254740992L)))
        assertEquals(KanonikHatasi.ONDALIK, hata(tam(-9007199254740992L)))
        assertEquals(KanonikHatasi.ONDALIK, hata(tam(Long.MAX_VALUE)))
        assertEquals(KanonikHatasi.ONDALIK, hata(tam(Long.MIN_VALUE)))
    }

    @Test
    fun `essiz vekil reddedilir`() {
        assertEquals(KanonikHatasi.ESSIZ_VEKIL, hata(metin("\uD800")))
        assertEquals(KanonikHatasi.ESSIZ_VEKIL, hata(metin("a\uDC00")))
        assertEquals(KanonikHatasi.ESSIZ_VEKIL, hata(metin("\uDE00\uD83D")))
        assertEquals(KanonikHatasi.ESSIZ_VEKIL, hata(metin("\uD83D")))
        assertEquals(KanonikHatasi.ESSIZ_VEKIL, hata(nesne("\uD800" to tam(1))))
        assertEquals("\"😀\"", kanonik(metin("😀")))
    }

    @Test
    fun `derinlik siniri`() {
        assertTrue(Kanonik.kanonik(sarmal(32)) is KanonikSonucu.Tamam)
        assertEquals(KanonikHatasi.COK_DERIN, hata(sarmal(33)))
        assertEquals(KanonikHatasi.COK_DERIN, hata(sarmal(5000)))
    }

    @Test
    fun `sha256 bilinen degerler`() {
        fun hex(s: String) = Kanonik.sha256Hex(s.toByteArray(Charsets.UTF_8))
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", hex(""))
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hex("abc"))
        assertEquals(
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
            hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
        )
        assertEquals("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", hex("a".repeat(1_000_000)))
    }

    @Test
    fun `sha256 JDK ile rastgele baytlarda ayni`() {
        val r = Random(7)
        val md = MessageDigest.getInstance("SHA-256")
        for (n in (0..140).toList() + listOf(255, 256, 1000, 4096, 65_537)) {
            val b = ByteArray(n).also { r.nextBytes(it) }
            val beklenen = md.digest(b).joinToString("") { "%02x".format(it) }
            assertEquals(beklenen, Kanonik.sha256Hex(b), "uzunluk $n")
        }
    }
}
