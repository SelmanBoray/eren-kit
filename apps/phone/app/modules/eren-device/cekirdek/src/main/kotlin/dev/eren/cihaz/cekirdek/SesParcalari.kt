package dev.eren.cihaz.cekirdek

/**
 * Seslendirilecek metnin, seslendirme motorunun tek istek sınırını (`azami`, UTF-16 karakter) aşmayan
 * parçalara bölünmesi. Sınır çağırandan gelir (adaptörde `TextToSpeech.getMaxSpeechInputLength()`);
 * burada sabit varsayılmaz. Saf ve belirlenimci; Android görmez.
 *
 * Kurallar:
 *  - Cümle sonu: `.`, `!`, `?`, `…` (ardından gelen bitirici ve kapanış tırnak/ayraçlarıyla birlikte),
 *    arkasından boşluk ya da metin sonu geliyorsa. "3.5" gibi boşluksuz nokta sınır değildir.
 *    Satır sonu da sınırdır (liste maddeleri, paragraflar).
 *  - Boşluk koşuları tek boşluğa iner; parçalar kırpılır; boş parça üretilmez.
 *  - Cümleler sınıra sığdıkça aynı parçaya toplanır (az istek, az boşluk). Ayırıcı özgün sınırı
 *    korur: satır sonundan gelen sınır `\n`, ötekiler tek boşluk.
 *  - Tek başına sınırı aşan cümle önce (parçanın ikinci yarısındaki) `,` `;` `:` sonrasından, yoksa son
 *    boşluktan, o da yoksa sert kesilir; sert kesim UTF-16 vekil çiftini ortadan bölmez.
 *  - Boşluk dışındaki karakterlerin sırası ve içeriği aynen korunur.
 */
object SesParcalari {

    /** Vekil çifti bölmeden ilerleyebilmek için en küçük anlamlı sınır. */
    private const val ASGARI_SINIR = 2

    private const val BITIRICILER = ".!?…"
    private const val KAPAYICILAR = "\"'”’»)]}"
    private const val ARA_IMLER = ",;:"

    private class Cumle(val metin: String, var satirSonu: Boolean)

    fun bol(metin: String, azami: Int): List<String> {
        val sinir = azami.coerceAtLeast(ASGARI_SINIR)
        val parcalar = ArrayList<String>()
        val tampon = StringBuilder()
        var oncekiSatirSonu = false
        for (c in cumleler(metin)) {
            if (c.metin.length > sinir) {
                if (tampon.isNotEmpty()) {
                    parcalar.add(tampon.toString())
                    tampon.setLength(0)
                }
                parcalar.addAll(uzunuBol(c.metin, sinir))
            } else if (tampon.isEmpty()) {
                tampon.append(c.metin)
            } else if (tampon.length + 1 + c.metin.length <= sinir) {
                tampon.append(if (oncekiSatirSonu) '\n' else ' ').append(c.metin)
            } else {
                parcalar.add(tampon.toString())
                tampon.setLength(0)
                tampon.append(c.metin)
            }
            oncekiSatirSonu = c.satirSonu
        }
        if (tampon.isNotEmpty()) parcalar.add(tampon.toString())
        return parcalar
    }

    private fun satirSonuMu(ch: Char): Boolean =
        ch == '\n' || ch == '\r' || ch == ' ' || ch == ' ' || ch == '\u000B' || ch == '\u000C' ||
            ch == '\u0085'

    private fun cumleler(metin: String): List<Cumle> {
        val sonuc = ArrayList<Cumle>()
        val sb = StringBuilder()
        var bosluk = false

        fun bitir(satirSonu: Boolean) {
            val s = sb.toString().trim()
            if (s.isNotEmpty()) {
                sonuc.add(Cumle(s, satirSonu))
            } else if (satirSonu && sonuc.isNotEmpty()) {
                // "Tamam.\n" gibi: cümle noktada bitti, ardından gelen satır sonu ayırıcıyı belirler.
                sonuc[sonuc.size - 1].satirSonu = true
            }
            sb.setLength(0)
            bosluk = false
        }

        val n = metin.length
        var i = 0
        while (i < n) {
            val ch = metin[i]
            when {
                satirSonuMu(ch) -> {
                    bitir(true)
                    i++
                }
                ch.isWhitespace() -> {
                    bosluk = true
                    i++
                }
                else -> {
                    if (bosluk && sb.isNotEmpty()) sb.append(' ')
                    bosluk = false
                    sb.append(ch)
                    i++
                    if (ch in BITIRICILER) {
                        while (i < n && (metin[i] in BITIRICILER || metin[i] in KAPAYICILAR)) {
                            sb.append(metin[i])
                            i++
                        }
                        if (i >= n || metin[i].isWhitespace()) bitir(false)
                    }
                }
            }
        }
        bitir(false)
        return sonuc
    }

    /** `s` boşlukları tekleşmiş, kırpılmış ve `sinir`'den uzundur. */
    private fun uzunuBol(s: String, sinir: Int): List<String> {
        val sonuc = ArrayList<String>()
        var kalan = s
        while (kalan.length > sinir) {
            val kesim = kesimYeri(kalan, sinir)
            val parca = kalan.substring(0, kesim).trim()
            if (parca.isNotEmpty()) sonuc.add(parca)
            kalan = kalan.substring(kesim).trim()
        }
        if (kalan.isNotEmpty()) sonuc.add(kalan)
        return sonuc
    }

    /** `[0, kesim)` parçası; `1 <= kesim <= sinir`. Önkoşul: `s.length > sinir`, `s[0]` boşluk değil. */
    private fun kesimYeri(s: String, sinir: Int): Int {
        var sonBosluk = -1
        for (i in sinir downTo 1) {
            if (!s[i].isWhitespace()) continue
            if (s[i - 1] in ARA_IMLER && i >= sinir / 2) return i
            if (sonBosluk < 0) sonBosluk = i
        }
        if (sonBosluk > 0) return sonBosluk
        var k = sinir
        if (Character.isHighSurrogate(s[k - 1]) && Character.isLowSurrogate(s[k])) k--
        return k
    }
}
