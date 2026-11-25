package dev.eren.ajanda.kimlik

import java.io.File

/**
 * Dil bağımsız vektörler: `apps/phone/protocol/vektorler/` (tek kaynak, kopya yok; README ile aynı
 * kural, başka yer için `AJANDA_VEKTOR_DIZINI`). Test bağımlılığı eklememek için küçük bir JSON okuyucu.
 */
internal object Vektorler {
    fun dosya(ad: String): File {
        System.getenv("AJANDA_VEKTOR_DIZINI")?.takeIf { it.isNotEmpty() }?.let { return File(it, ad) }
        var dizin: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        while (dizin != null) {
            val aday = File(dizin, "apps/phone/protocol/vektorler/$ad")
            if (aday.isFile) return aday
            dizin = dizin.parentFile
        }
        error("vektör dosyası bulunamadı: $ad (AJANDA_VEKTOR_DIZINI ile verilebilir)")
    }

    @Suppress("UNCHECKED_CAST")
    fun kurallar(): Map<String, Any?> = Json.oku(dosya("ajanda-kurallar.json").readText(Charsets.UTF_8)) as Map<String, Any?>
}

/** En küçük JSON: nesne -> LinkedHashMap, dizi -> List, sayı -> Long/Double, metin, true/false/null. */
internal object Json {
    fun oku(metin: String): Any? {
        val o = Okuyucu(metin)
        val deger = o.deger()
        o.bosluk()
        require(o.i == metin.length) { "JSON sonunda fazlalık: ${o.i}" }
        return deger
    }

    fun yaz(d: Any?): String = StringBuilder().also { yaz(d, it) }.toString()

    private fun yaz(d: Any?, sb: StringBuilder) {
        when (d) {
            null -> sb.append("null")
            is String -> {
                sb.append('"')
                for (c in d) {
                    when {
                        c == '"' -> sb.append("\\\"")
                        c == '\\' -> sb.append("\\\\")
                        c < ' ' -> sb.append("\\u%04x".format(c.code))
                        else -> sb.append(c)
                    }
                }
                sb.append('"')
            }
            is Boolean, is Long, is Int -> sb.append(d.toString())
            is Double -> sb.append(if (d == Math.floor(d) && !d.isInfinite()) d.toLong().toString() else d.toString())
            is Map<*, *> -> {
                sb.append('{')
                d.entries.forEachIndexed { i, (k, v) ->
                    if (i > 0) sb.append(',')
                    yaz(k as String, sb)
                    sb.append(':')
                    yaz(v, sb)
                }
                sb.append('}')
            }
            is List<*> -> {
                sb.append('[')
                d.forEachIndexed { i, v ->
                    if (i > 0) sb.append(',')
                    yaz(v, sb)
                }
                sb.append(']')
            }
            else -> error("yazılamaz: ${d.javaClass}")
        }
    }

    private class Okuyucu(val s: String) {
        var i = 0

        fun bosluk() {
            while (i < s.length && s[i].isWhitespace()) i++
        }

        fun deger(): Any? {
            bosluk()
            require(i < s.length) { "beklenmeyen son" }
            return when (val c = s[i]) {
                '{' -> nesne()
                '[' -> dizi()
                '"' -> metin()
                't' -> sabit("true", true)
                'f' -> sabit("false", false)
                'n' -> sabit("null", null)
                else -> if (c == '-' || c.isDigit()) sayi() else error("beklenmeyen '$c' @$i")
            }
        }

        private fun sabit(ad: String, d: Any?): Any? {
            require(s.startsWith(ad, i)) { "beklenmeyen @$i" }
            i += ad.length
            return d
        }

        private fun nesne(): Map<String, Any?> {
            val m = LinkedHashMap<String, Any?>()
            i++
            bosluk()
            if (s[i] == '}') return m.also { i++ }
            while (true) {
                bosluk()
                val k = metin()
                bosluk()
                require(s[i] == ':') { "':' bekleniyordu @$i" }
                i++
                m[k] = deger()
                bosluk()
                when (s[i++]) {
                    ',' -> continue
                    '}' -> return m
                    else -> error("',' ya da '}' bekleniyordu @${i - 1}")
                }
            }
        }

        private fun dizi(): List<Any?> {
            val l = ArrayList<Any?>()
            i++
            bosluk()
            if (s[i] == ']') return l.also { i++ }
            while (true) {
                l.add(deger())
                bosluk()
                when (s[i++]) {
                    ',' -> continue
                    ']' -> return l
                    else -> error("',' ya da ']' bekleniyordu @${i - 1}")
                }
            }
        }

        private fun metin(): String {
            require(s[i] == '"') { "metin bekleniyordu @$i" }
            i++
            val sb = StringBuilder()
            while (true) {
                val c = s[i++]
                when (c) {
                    '"' -> return sb.toString()
                    '\\' -> when (val k = s[i++]) {
                        '"' -> sb.append('"')
                        '\\' -> sb.append('\\')
                        '/' -> sb.append('/')
                        'b' -> sb.append('\b')
                        'f' -> sb.append('\u000C')
                        'n' -> sb.append('\n')
                        'r' -> sb.append('\r')
                        't' -> sb.append('\t')
                        'u' -> {
                            sb.append(s.substring(i, i + 4).toInt(16).toChar())
                            i += 4
                        }
                        else -> error("kaçış '$k' @$i")
                    }
                    else -> sb.append(c)
                }
            }
        }

        private fun sayi(): Any {
            val bas = i
            while (i < s.length && (s[i].isDigit() || s[i] in "+-.eE")) i++
            val t = s.substring(bas, i)
            return t.toLongOrNull() ?: t.toDouble()
        }
    }
}
