package dev.eren.cihaz.cekirdek

/*
 * Katı JSON ayrıştırıcı ve yazıcı (RFC 8259 + JsonHatasi katılığı). Saf Kotlin, org.json yok.
 * Derinlik sayımı kanonik.ts ile aynıdır: kök 0, her değer girişinde `derinlik > 32` reddedilir.
 * Özyineleme bu yüzden en çok 34 çerçeve derindir; yazıcı ise yığın taşmasın diye yinelemelidir.
 */

private const val AZAMI_DERINLIK = 32
private const val GUVENLI_TAM = 9007199254740991.0

private class JsonIstisna(val neden: JsonHatasi) : RuntimeException(null, null, false, false)

object Json : JsonIslemi {
    override fun coz(metin: String): JsonSonucu =
        try {
            JsonSonucu.Tamam(Ayristirici(metin).kok())
        } catch (h: JsonIstisna) {
            JsonSonucu.Hata(h.neden)
        } catch (_: StackOverflowError) {
            JsonSonucu.Hata(JsonHatasi.COK_DERIN)
        } catch (_: RuntimeException) {
            JsonSonucu.Hata(JsonHatasi.BOZUK)
        }

    override fun yaz(deger: JsonDeger): String {
        val sb = StringBuilder()
        val yigin = ArrayDeque<Cerceve>()
        yazDeger(deger, sb, yigin)
        while (yigin.isNotEmpty()) {
            when (val c = yigin.last()) {
                is Cerceve.Dizi -> {
                    if (c.it.hasNext()) {
                        if (!c.ilk) sb.append(',')
                        c.ilk = false
                        yazDeger(c.it.next(), sb, yigin)
                    } else {
                        yigin.removeLast()
                        sb.append(']')
                    }
                }
                is Cerceve.Nesne -> {
                    if (c.it.hasNext()) {
                        if (!c.ilk) sb.append(',')
                        c.ilk = false
                        val girdi = c.it.next()
                        yazMetin(girdi.key, sb)
                        sb.append(':')
                        yazDeger(girdi.value, sb, yigin)
                    } else {
                        yigin.removeLast()
                        sb.append('}')
                    }
                }
            }
        }
        return sb.toString()
    }

    private sealed interface Cerceve {
        class Dizi(val it: Iterator<JsonDeger>, var ilk: Boolean = true) : Cerceve

        class Nesne(val it: Iterator<Map.Entry<String, JsonDeger>>, var ilk: Boolean = true) : Cerceve
    }

    private fun yazDeger(deger: JsonDeger, sb: StringBuilder, yigin: ArrayDeque<Cerceve>) {
        when (deger) {
            JsonDeger.Bos -> sb.append("null")
            is JsonDeger.Mantik -> sb.append(if (deger.deger) "true" else "false")
            is JsonDeger.Tam -> sb.append(deger.deger)
            is JsonDeger.Ondalik ->
                if (deger.deger.isFinite()) sb.append(deger.deger.toString()) else sb.append("null")
            is JsonDeger.Metin -> yazMetin(deger.deger, sb)
            is JsonDeger.Dizi -> {
                sb.append('[')
                yigin.addLast(Cerceve.Dizi(deger.ogeler.iterator()))
            }
            is JsonDeger.Nesne -> {
                sb.append('{')
                yigin.addLast(Cerceve.Nesne(deger.alanlar.entries.iterator()))
            }
        }
    }

    private fun yazMetin(metin: String, sb: StringBuilder) {
        sb.append('"')
        var i = 0
        while (i < metin.length) {
            val c = metin[i]
            when {
                c == '"' -> sb.append("\\\"")
                c == '\\' -> sb.append("\\\\")
                c == '\n' -> sb.append("\\n")
                c == '\r' -> sb.append("\\r")
                c == '\t' -> sb.append("\\t")
                c == '\b' -> sb.append("\\b")
                c == '\u000C' -> sb.append("\\f")
                c < ' ' -> kacir(c, sb)
                c.isHighSurrogate() && i + 1 < metin.length && metin[i + 1].isLowSurrogate() -> {
                    sb.append(c).append(metin[i + 1])
                    i++
                }
                c.isSurrogate() -> kacir(c, sb)
                else -> sb.append(c)
            }
            i++
        }
        sb.append('"')
    }

    private fun kacir(c: Char, sb: StringBuilder) {
        val hex = "0123456789abcdef"
        val k = c.code
        sb.append("\\u")
            .append(hex[(k shr 12) and 15]).append(hex[(k shr 8) and 15])
            .append(hex[(k shr 4) and 15]).append(hex[k and 15])
    }

    private class Ayristirici(private val s: String) {
        private var i = 0

        fun kok(): JsonDeger {
            val v = deger(0)
            bosluk()
            if (i != s.length) bozuk()
            return v
        }

        private fun bozuk(): Nothing = throw JsonIstisna(JsonHatasi.BOZUK)

        private fun bosluk() {
            while (i < s.length) {
                val c = s[i]
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') i++ else break
            }
        }

        private fun deger(derinlik: Int): JsonDeger {
            if (derinlik > AZAMI_DERINLIK) throw JsonIstisna(JsonHatasi.COK_DERIN)
            bosluk()
            if (i >= s.length) bozuk()
            return when (s[i]) {
                '{' -> nesne(derinlik)
                '[' -> dizi(derinlik)
                '"' -> JsonDeger.Metin(metin())
                't' -> sabit("true", JsonDeger.Mantik(true))
                'f' -> sabit("false", JsonDeger.Mantik(false))
                'n' -> sabit("null", JsonDeger.Bos)
                else -> sayi()
            }
        }

        private fun sabit(ad: String, deger: JsonDeger): JsonDeger {
            if (!s.startsWith(ad, i)) bozuk()
            i += ad.length
            return deger
        }

        private fun dizi(derinlik: Int): JsonDeger {
            i++
            val ogeler = ArrayList<JsonDeger>()
            bosluk()
            if (i < s.length && s[i] == ']') {
                i++
                return JsonDeger.Dizi(ogeler)
            }
            while (true) {
                ogeler.add(deger(derinlik + 1))
                bosluk()
                if (i >= s.length) bozuk()
                when (s[i++]) {
                    ',' -> Unit
                    ']' -> return JsonDeger.Dizi(ogeler)
                    else -> bozuk()
                }
            }
        }

        private fun nesne(derinlik: Int): JsonDeger {
            i++
            val alanlar = LinkedHashMap<String, JsonDeger>()
            bosluk()
            if (i < s.length && s[i] == '}') {
                i++
                return JsonDeger.Nesne(alanlar)
            }
            while (true) {
                bosluk()
                if (i >= s.length || s[i] != '"') bozuk()
                val anahtar = metin()
                bosluk()
                if (i >= s.length || s[i] != ':') bozuk()
                i++
                val d = deger(derinlik + 1)
                if (alanlar.containsKey(anahtar)) throw JsonIstisna(JsonHatasi.YINELENEN_ANAHTAR)
                alanlar[anahtar] = d
                bosluk()
                if (i >= s.length) bozuk()
                when (s[i++]) {
                    ',' -> Unit
                    '}' -> return JsonDeger.Nesne(alanlar)
                    else -> bozuk()
                }
            }
        }

        private fun metin(): String {
            i++
            val sb = StringBuilder()
            while (true) {
                if (i >= s.length) bozuk()
                val c = s[i++]
                when {
                    c == '"' -> break
                    c < ' ' -> bozuk()
                    c == '\\' -> {
                        if (i >= s.length) bozuk()
                        when (s[i++]) {
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            '/' -> sb.append('/')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000C')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> sb.append(dortHane())
                            else -> bozuk()
                        }
                    }
                    else -> sb.append(c)
                }
            }
            return iyiBicimli(sb)
        }

        private fun dortHane(): Char {
            if (i + 4 > s.length) bozuk()
            var k = 0
            repeat(4) {
                val h = Character.digit(s[i++], 16)
                if (h < 0) bozuk()
                k = k * 16 + h
            }
            return k.toChar()
        }

        private fun iyiBicimli(sb: StringBuilder): String {
            var j = 0
            while (j < sb.length) {
                val c = sb[j]
                if (c.isHighSurrogate() && j + 1 < sb.length && sb[j + 1].isLowSurrogate()) {
                    j += 2
                    continue
                }
                if (c.isSurrogate()) throw JsonIstisna(JsonHatasi.ESSIZ_VEKIL)
                j++
            }
            return sb.toString()
        }

        private fun rakamlar(): Int {
            val bas = i
            while (i < s.length && s[i] in '0'..'9') i++
            return i - bas
        }

        private fun sayi(): JsonDeger {
            val bas = i
            if (s[i] == '-') i++
            if (i >= s.length) bozuk()
            if (s[i] == '0') i++ else if (s[i] in '1'..'9') rakamlar() else bozuk()
            if (i < s.length && s[i] == '.') {
                i++
                if (rakamlar() == 0) bozuk()
            }
            if (i < s.length && (s[i] == 'e' || s[i] == 'E')) {
                i++
                if (i < s.length && (s[i] == '+' || s[i] == '-')) i++
                if (rakamlar() == 0) bozuk()
            }
            val ham = s.substring(bas, i)
            val d = ham.toDouble()
            if (d.isInfinite() || (d == 0.0 && ham[0] == '-')) throw JsonIstisna(JsonHatasi.GUVENSIZ_SAYI)
            if (d % 1.0 != 0.0) return JsonDeger.Ondalik(d)
            if (Math.abs(d) > GUVENLI_TAM) throw JsonIstisna(JsonHatasi.GUVENSIZ_SAYI)
            return JsonDeger.Tam(d.toLong())
        }
    }
}
