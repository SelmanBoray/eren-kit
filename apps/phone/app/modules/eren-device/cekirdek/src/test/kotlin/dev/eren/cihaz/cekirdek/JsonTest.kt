package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.Random

class JsonTest {
    private fun hata(metin: String): JsonHatasi {
        val s = Json.coz(metin)
        assertTrue(s is JsonSonucu.Hata, "reddedilmeliydi: ${metin.take(60)} -> $s")
        return (s as JsonSonucu.Hata).neden
    }

    private fun tamam(metin: String): JsonDeger {
        val s = Json.coz(metin)
        assertTrue(s is JsonSonucu.Tamam, "kabul edilmeliydi: ${metin.take(60)} -> $s")
        return (s as JsonSonucu.Tamam).deger
    }

    private fun derin(n: Int, yaprak: String = "1"): String = "[".repeat(n) + yaprak + "]".repeat(n)

    @Test
    fun `yinelenen anahtar reddedilir`() {
        assertEquals(JsonHatasi.YINELENEN_ANAHTAR, hata("""{"a":1,"a":2}"""))
        assertEquals(JsonHatasi.YINELENEN_ANAHTAR, hata("""{"a":1,"b":2,"a":1}"""))
        assertEquals(JsonHatasi.YINELENEN_ANAHTAR, hata("""{"x":{"a":1,"a":2}}"""))
        assertEquals(JsonHatasi.YINELENEN_ANAHTAR, hata("""[{"x":[{"k":null,"k":null}]}]"""))
        // Kaçışla yazılmış aynı anahtar da yinelenendir.
        assertEquals(JsonHatasi.YINELENEN_ANAHTAR, hata("""{"a":1,"\u0061":2}"""))
        // Farklı düzeydeki aynı ad yinelenen değildir.
        tamam("""{"a":{"a":1}}""")
    }

    @Test
    fun `derinlik siniri 32 gecer 33 duser`() {
        tamam(derin(32))
        assertEquals(JsonHatasi.COK_DERIN, hata(derin(33)))
        assertEquals(JsonHatasi.COK_DERIN, hata(derin(34)))
        tamam("""{"a":""".repeat(32) + "1" + "}".repeat(32))
        assertEquals(JsonHatasi.COK_DERIN, hata("""{"a":""".repeat(33) + "1" + "}".repeat(33)))
    }

    @Test
    fun `yuz bin ic ice yigin tasirmaz`() {
        val n = 100_000
        assertEquals(JsonHatasi.COK_DERIN, hata(derin(n)))
        assertEquals(JsonHatasi.COK_DERIN, hata("[".repeat(n)))
        assertEquals(JsonHatasi.COK_DERIN, hata("""{"a":""".repeat(n)))
    }

    @Test
    fun `yazici cok derin degerde yigin tasirmaz`() {
        var d: JsonDeger = JsonDeger.Tam(1)
        repeat(100_000) { d = JsonDeger.Dizi(listOf(d)) }
        val metin = Json.yaz(d)
        assertEquals(200_001, metin.length)
        assertTrue(metin.startsWith("[[[") && metin.endsWith("]]]"))
    }

    @Test
    fun `guvensiz sayilar`() {
        for (m in listOf(
            "1e400", "-1e400", "9007199254740993", "9007199254740992", "-9007199254740993",
            "-0", "-0.0", "-0e5", "[1,-0]", """{"a":1e999}""",
        )) {
            assertEquals(JsonHatasi.GUVENSIZ_SAYI, hata(m), m)
        }
        assertEquals(JsonDeger.Tam(9007199254740991L), tamam("9007199254740991"))
        assertEquals(JsonDeger.Tam(-9007199254740991L), tamam("-9007199254740991"))
        assertEquals(JsonDeger.Tam(0), tamam("0"))
    }

    @Test
    fun `tam ve ondalik ayrimi`() {
        assertEquals(JsonDeger.Ondalik(1.5), tamam("1.5"))
        assertEquals(JsonDeger.Ondalik(-12.5), tamam("-12.5"))
        assertEquals(JsonDeger.Tam(100), tamam("1e2"))
        assertEquals(JsonDeger.Tam(100), tamam("1E+2"))
        assertEquals(JsonDeger.Tam(1), tamam("1.0"))
        assertEquals(JsonDeger.Tam(7), tamam("7"))
        assertEquals(JsonDeger.Ondalik(0.015), tamam("1.5e-2"))
    }

    @Test
    fun `essiz vekil reddedilir cift vekil kabul edilir`() {
        assertEquals(JsonHatasi.ESSIZ_VEKIL, hata("\"\\ud800\""))
        assertEquals(JsonHatasi.ESSIZ_VEKIL, hata("\"\\udc00\""))
        assertEquals(JsonHatasi.ESSIZ_VEKIL, hata("\"\\ud800a\""))
        assertEquals(JsonHatasi.ESSIZ_VEKIL, hata("\"\\udc00\\ud800\""))
        assertEquals(JsonHatasi.ESSIZ_VEKIL, hata("{\"\\ud83d\":1}"))
        assertEquals(JsonHatasi.ESSIZ_VEKIL, hata("\"\uD800\""))
        assertEquals(JsonDeger.Metin("\uD83D\uDE00"), tamam("\"\\ud83d\\ude00\""))
        assertEquals(JsonDeger.Metin("\uD83D\uDE00"), tamam("\"\uD83D\uDE00\""))
    }

    @Test
    fun `dilbilgisi katiligi`() {
        for (m in listOf(
            "", " ", "[1,2]x", "[1,2] 3", "{} {}", "nullx", "[1,]", "{\"a\":1,}", "[,1]", "{,}",
            "'a'", "{'a':1}", "['a']", "// y\n1", "/* y */1", "[1 /* y */]", "# y\n1",
            "\"a\nb\"", "\"a\tb\"", "\"a\u0001b\"", "\"a\u001fb\"", "\"a\\xb\"", "\"\\u12\"", "\"\\u12g4\"",
            "\"abc", "[", "{", "{\"a\"}", "{\"a\":}", "{a:1}", "{1:1}", "01", "+1", ".5", "1.", "1e", "1e+",
            "--1", "- 1", "0x10", "NaN", "Infinity", "-Infinity", "True", "nul", "tru", "undefined",
            "\u00a01", "\ufeff1", "1\u00a0", "[1;2]", "[1 2]", "{\"a\" 1}", "{\"a\":1 \"b\":2}",
        )) {
            hata(m)
        }
        // Kök her tür olabilir; çevresindeki JSON boşluğu serbesttir.
        assertEquals(JsonDeger.Bos, tamam(" \t\r\n null \n"))
        assertEquals(JsonDeger.Mantik(true), tamam("true"))
        assertEquals(JsonDeger.Metin("a/b"), tamam("\"a\\/b\""))
        assertEquals(JsonDeger.Dizi(emptyList()), tamam("[ ]"))
        assertEquals(JsonDeger.Nesne(emptyMap()), tamam("{ }"))
    }

    @Test
    fun `nesne sirasi korunur`() {
        val n = tamam("""{"z":1,"a":2,"m":3}""") as JsonDeger.Nesne
        assertEquals(listOf("z", "a", "m"), n.alanlar.keys.toList())
        assertEquals("""{"z":1,"a":2,"m":3}""", Json.yaz(n))
    }

    @Test
    fun `yazici kacis kurallari`() {
        assertEquals("\"a\\\"b\\\\c\\n\\r\\t\\b\\f\"", Json.yaz(JsonDeger.Metin("a\"b\\c\n\r\t\b\u000C")))
        assertEquals("\"\\u0001\\u001f\"", Json.yaz(JsonDeger.Metin("\u0001\u001f")))
        assertEquals("\"çş😀\"", Json.yaz(JsonDeger.Metin("çş😀")))
        assertEquals("\"\\ud800\"", Json.yaz(JsonDeger.Metin("\uD800")))
        assertEquals("\"\\udc00x\"", Json.yaz(JsonDeger.Metin("\uDC00x")))
        assertEquals("null", Json.yaz(JsonDeger.Ondalik(Double.NaN)))
        assertEquals("null", Json.yaz(JsonDeger.Ondalik(Double.POSITIVE_INFINITY)))
        assertEquals("[]", Json.yaz(JsonDeger.Dizi(emptyList())))
        assertEquals("{}", Json.yaz(JsonDeger.Nesne(emptyMap())))
    }

    private fun agaclar(): List<JsonDeger> {
        val r = Random(42)
        val havuz = listOf("a", "b", "c", " ", "\"", "\\", "/", "\n", "\t", "\u0001", "ç", "ş", "ğ", "😀", "€", "{", "}", "[", "]", ",", ":")
        fun metin(): String = buildString { repeat(r.nextInt(8)) { append(havuz[r.nextInt(havuz.size)]) } }
        fun uret(d: Int): JsonDeger {
            val t = r.nextInt(if (d >= 6) 5 else 8)
            return when (t) {
                0 -> JsonDeger.Bos
                1 -> JsonDeger.Mantik(r.nextBoolean())
                2 -> JsonDeger.Tam(r.nextLong() % 9007199254740991L)
                3 -> JsonDeger.Metin(metin())
                4 -> JsonDeger.Ondalik((r.nextInt(2_000_001) - 1_000_000) / 8.0 + 0.0625)
                5, 6 -> JsonDeger.Dizi(List(r.nextInt(5)) { uret(d + 1) })
                else -> JsonDeger.Nesne(
                    LinkedHashMap<String, JsonDeger>().also { m -> repeat(r.nextInt(5)) { m[metin()] = uret(d + 1) } },
                )
            }
        }
        return listOf(
            JsonDeger.Bos, JsonDeger.Tam(0), JsonDeger.Tam(-9007199254740991L), JsonDeger.Tam(9007199254740991L),
            JsonDeger.Metin(""), JsonDeger.Dizi(emptyList()), JsonDeger.Nesne(emptyMap()),
            JsonDeger.Ondalik(1.5), JsonDeger.Ondalik(-0.25), JsonDeger.Ondalik(1.0E-7),
            JsonDeger.Metin("\uD83D\uDE00 vekil çifti"),
        ) + List(500) { uret(0) }
    }

    @Test
    fun `coz yaz gidis donus`() {
        for (x in agaclar()) {
            val yazilan = Json.yaz(x)
            assertEquals(x, tamam(yazilan), "gidiş-dönüş: $yazilan")
            assertEquals(yazilan, Json.yaz(tamam(yazilan)))
        }
    }

    @Test
    fun `bulaniklastirma hic istisna sizdirmaz`() {
        val r = Random(20261107)
        val tohumlar = agaclar().map { Json.yaz(it) } + listOf(
            derin(40), "\"\\ud800\"", "1e400", "{\"a\":1,\"a\":2}", "-0", "9007199254740993",
        )
        val parcalar = listOf(
            "[", "]", "{", "}", ",", ":", "\"", "\\", "\\u", "\\ud800", "\\udc00", "e", "E", "-", "+", ".", "0",
            "9", "null", "true", "fals", "/*", "//", "'", "\u0000", "\u001f", "\u2028", "\ud800", "\udc00",
            "\uffff", "😀", "1e400", "-0", " ",
        )
        var tamamSayisi = 0
        var hataSayisi = 0
        repeat(5_000) { n ->
            val sb = StringBuilder(tohumlar[r.nextInt(tohumlar.size)])
            when (n % 4) {
                0 -> repeat(1 + r.nextInt(3)) { sb.insert(r.nextInt(sb.length + 1), parcalar[r.nextInt(parcalar.size)]) }
                1 -> repeat(1 + r.nextInt(3)) { if (sb.isNotEmpty()) sb.deleteCharAt(r.nextInt(sb.length)) }
                2 -> if (sb.isNotEmpty()) sb.setLength(r.nextInt(sb.length))
                else -> {
                    sb.setLength(0)
                    repeat(r.nextInt(30)) { sb.append(r.nextInt(0x10000).toChar()) }
                }
            }
            val girdi = sb.toString()
            val s = try {
                Json.coz(girdi)
            } catch (e: Throwable) {
                throw AssertionError("istisna sızdı: ${e::class.simpleName} girdi=${girdi.take(80)}", e)
            }
            when (s) {
                is JsonSonucu.Tamam -> {
                    tamamSayisi++
                    assertEquals(s.deger, tamam(Json.yaz(s.deger)))
                }
                is JsonSonucu.Hata -> hataSayisi++
            }
        }
        assertTrue(tamamSayisi > 0 && hataSayisi > 0, "hem kabul hem ret görülmeli: $tamamSayisi/$hataSayisi")
    }
}
