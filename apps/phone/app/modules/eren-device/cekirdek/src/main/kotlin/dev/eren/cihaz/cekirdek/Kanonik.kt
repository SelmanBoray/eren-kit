package dev.eren.cihaz.cekirdek

import java.security.MessageDigest

/** protocol/src/kanonik.ts portu: aynı girdiden aynı baytlar. */
object Kanonik : KanonikIslemi {
    private const val AZAMI_DERINLIK = 32
    private const val EN_BUYUK_GUVENLI: Long = 9_007_199_254_740_991L
    private const val ONALTILI = "0123456789abcdef"

    private class Bozuk(val neden: KanonikHatasi) : Exception(null, null, false, false)

    override fun kanonik(deger: JsonDeger): KanonikSonucu =
        try {
            KanonikSonucu.Tamam(YaziTamponu().also { yazDeger(deger, 0, it) }.toString())
        } catch (e: Bozuk) {
            KanonikSonucu.Hata(e.neden)
        }

    override fun sha256Hex(bayt: ByteArray): String {
        val ozet = MessageDigest.getInstance("SHA-256").digest(bayt)
        val cikti = StringBuilder(64)
        for (b in ozet) {
            val v = b.toInt() and 0xff
            cikti.append(ONALTILI[v ushr 4]).append(ONALTILI[v and 0x0f])
        }
        return cikti.toString()
    }

    private class YaziTamponu {
        private val sb = StringBuilder()

        fun ekle(metin: String) {
            sb.append(metin)
        }

        fun ekle(harf: Char) {
            sb.append(harf)
        }

        override fun toString(): String = sb.toString()
    }

    private fun iyiBicimliMi(metin: String): Boolean {
        var i = 0
        while (i < metin.length) {
            val birim = metin[i]
            if (birim in '\uD800'..'\uDBFF') {
                if (i + 1 >= metin.length || metin[i + 1] !in '\uDC00'..'\uDFFF') return false
                i++
            } else if (birim in '\uDC00'..'\uDFFF') {
                return false
            }
            i++
        }
        return true
    }

    private fun yazMetin(metin: String, t: YaziTamponu) {
        if (!iyiBicimliMi(metin)) throw Bozuk(KanonikHatasi.ESSIZ_VEKIL)
        t.ekle('"')
        for (birim in metin) {
            val kod = birim.code
            when {
                kod == 0x22 -> t.ekle("\\\"")
                kod == 0x5c -> t.ekle("\\\\")
                kod == 0x08 -> t.ekle("\\b")
                kod == 0x09 -> t.ekle("\\t")
                kod == 0x0a -> t.ekle("\\n")
                kod == 0x0c -> t.ekle("\\f")
                kod == 0x0d -> t.ekle("\\r")
                kod < 0x20 -> {
                    t.ekle("\\u00")
                    t.ekle(ONALTILI[kod ushr 4])
                    t.ekle(ONALTILI[kod and 0x0f])
                }
                else -> t.ekle(birim)
            }
        }
        t.ekle('"')
    }

    private fun yazDeger(deger: JsonDeger, derinlik: Int, t: YaziTamponu) {
        if (derinlik > AZAMI_DERINLIK) throw Bozuk(KanonikHatasi.COK_DERIN)
        when (deger) {
            JsonDeger.Bos -> t.ekle("null")
            is JsonDeger.Mantik -> t.ekle(if (deger.deger) "true" else "false")
            is JsonDeger.Metin -> yazMetin(deger.deger, t)
            is JsonDeger.Tam -> {
                if (deger.deger > EN_BUYUK_GUVENLI || deger.deger < -EN_BUYUK_GUVENLI) {
                    throw Bozuk(KanonikHatasi.ONDALIK)
                }
                t.ekle(deger.deger.toString())
            }
            is JsonDeger.Ondalik -> throw Bozuk(KanonikHatasi.ONDALIK)
            is JsonDeger.Dizi -> {
                t.ekle('[')
                deger.ogeler.forEachIndexed { sira, oge ->
                    if (sira > 0) t.ekle(',')
                    yazDeger(oge, derinlik + 1, t)
                }
                t.ekle(']')
            }
            is JsonDeger.Nesne -> {
                t.ekle('{')
                // String.compareTo UTF-16 birim sırasıdır (JS varsayılan sort ile aynı).
                var ilk = true
                for (anahtar in deger.alanlar.keys.sorted()) {
                    if (anahtar == "__proto__") throw Bozuk(KanonikHatasi.YASAK_ANAHTAR)
                    if (!ilk) t.ekle(',')
                    ilk = false
                    yazMetin(anahtar, t)
                    t.ekle(':')
                    yazDeger(deger.alanlar.getValue(anahtar), derinlik + 1, t)
                }
                t.ekle('}')
            }
        }
    }
}
