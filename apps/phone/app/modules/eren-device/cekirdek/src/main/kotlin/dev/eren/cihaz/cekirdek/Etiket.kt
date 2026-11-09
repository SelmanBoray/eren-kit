package dev.eren.cihaz.cekirdek

import java.text.Normalizer
import java.util.Locale

/*
 * Geri alınamaz eylemi tetikleyen düğümlerin (gönder, sil, öde...) ve parola alanlarının tanınması.
 * Hata yönü bilinçli: yanlış pozitif kabul (kullanıcı yalnız-oku izninde bir düğmeye basamaz),
 * yanlış negatif kabul değil. Bu yüzden sözlük geniş, katlama agresiftir: aksan, harf büyüklüğü,
 * İ/ı/I/i, görünmez karakter ve birleşik/ayrık yazım farkı eşleşmeyi bozamaz.
 */
object Etiket : EtiketIslemi {

    /** Eşleşme üç yoldan biridir; terimler katlanmış (ASCII, küçük harf) yazılır. */
    private val SOZLUK: List<String> = listOf(
        // Türkçe
        "gonder", "yolla", "paylas", "sil", "kaldir", "cikar", "ode", "onayla", "onay", "kabul",
        "satin", "siparis", "tamamla", "ilet", "yanitla", "cevapla", "yayinla", "yayimla", "bagis",
        "havale", "aktar", "transfer", "eft", "sifirla", "temizle", "bosalt", "kalici", "yukle",
        "engelle", "sikayet", "rezerve", "rezervasyon", "evet", "abone ol", "iptal et",
        // İngilizce
        "send", "share", "delete", "remove", "pay", "buy", "confirm", "post", "submit", "purchase",
        "order", "checkout", "check out", "publish", "reply", "forward", "tweet", "donate",
        "subscribe", "erase", "wipe", "reset", "clear", "discard", "unsend", "resend", "accept",
        "approve", "authorize", "authorise", "book", "reserve", "upload", "uninstall", "deactivate",
        "block", "report", "tip", "yes", "withdraw", "deposit", "unlink", "unfriend",
    )

    private val PAROLA_SOZLUGU: List<String> = listOf(
        "sifre", "parola", "pin", "otp", "kod", "password", "passcode", "passwd", "pwd", "code",
        "dogrulama", "verification", "secret", "cvv", "cvc", "iban", "tckn", "kart no", "card number",
    )

    /** Bu uzunluk ve üstü terim metnin herhangi bir yerinde, daha kısası sözcük başında aranır. */
    private const val ALT_DIZGE_ESIGI = 6

    private val KUCUK_BUYUK_1 = Regex("(\\p{Ll})(\\p{Lu})")
    private val KUCUK_BUYUK_2 = Regex("(\\p{Lu})(\\p{Lu}\\p{Ll})")

    // Katlama sonrası Latin'e benzeyen Kiril ve Yunan harfleri.
    private val BENZER: Map<Char, Char> = mapOf(
        'а' to 'a', 'е' to 'e', 'о' to 'o', 'р' to 'p', 'с' to 'c', 'х' to 'x', 'у' to 'y',
        'і' to 'i', 'ј' to 'j', 'к' to 'k', 'м' to 'm', 'т' to 't', 'н' to 'h', 'в' to 'b',
        'ѕ' to 's', 'ԁ' to 'd', 'ɡ' to 'g',
        'ο' to 'o', 'α' to 'a', 'ε' to 'e', 'ρ' to 'p', 'ν' to 'v', 'τ' to 't', 'κ' to 'k',
        'ι' to 'i', 'υ' to 'u', 'β' to 'b', 'η' to 'n', 'χ' to 'x',
    )

    override fun katla(metin: String): String {
        val ayrik = Normalizer.normalize(metin, Normalizer.Form.NFKD)
        val sb = StringBuilder(ayrik.length)
        var i = 0
        while (i < ayrik.length) {
            val cp = ayrik.codePointAt(i)
            i += Character.charCount(cp)
            when {
                cp == 0x09 || cp == 0x0a || cp == 0x0d -> sb.append(' ')
                gorunmez(cp) -> Unit
                Character.isWhitespace(cp) || Character.isSpaceChar(cp) -> sb.append(' ')
                else -> {
                    val tur = Character.getType(cp)
                    if (tur == Character.NON_SPACING_MARK.toInt() ||
                        tur == Character.ENCLOSING_MARK.toInt()
                    ) {
                        Unit
                    } else {
                        sb.appendCodePoint(cp)
                    }
                }
            }
        }
        // İ/I/ı hepsi i olur; Locale.ROOT kullanmak I'yı i yapar, ı'yı olduğu gibi bırakırdı.
        val ic = sb.toString().replace('İ', 'i').replace('ı', 'i').replace('I', 'i')
        val kucuk = ic.lowercase(Locale.ROOT)
        val son = StringBuilder(kucuk.length)
        for (c in kucuk) son.append(BENZER[c] ?: c)
        return son.toString().trim().replace(Regex(" {2,}"), " ")
    }

    override fun eslesir(metin: String): Boolean = sozlukle(metin, SOZLUK)

    override fun etiketli(baglam: DugumBaglami): Boolean {
        if (etiketMetniEslesir(baglam.dugum)) return true
        // Tıklanabilir her ata: iç içe tıklanabilirde hangisinin tetiklendiği bilinmez.
        if (baglam.atalar.any { it.tiklanabilir && etiketMetniEslesir(it) }) return true
        return baglam.torunlar.any { etiketMetniEslesir(it) }
    }

    override fun parolaAlani(dugum: Dugum): Boolean {
        if (dugum.parola) return true
        if (dugum.ipucu?.let { sozlukle(it, PAROLA_SOZLUGU) } == true) return true
        if (dugum.kaynakId?.let { sozlukle(kimlikSonu(it), PAROLA_SOZLUGU) } == true) return true
        // Boş alanın ipucunu bazı adaptörler açıklama olarak verir; yalnız düzenlenebilirde bakılır.
        return dugum.duzenlenebilir && sozlukle(dugum.ad, PAROLA_SOZLUGU)
    }

    private fun etiketMetniEslesir(d: Dugum): Boolean =
        sozlukle(d.ad, SOZLUK) ||
            (d.ipucu?.let { sozlukle(it, SOZLUK) } == true) ||
            (d.kaynakId?.let { sozlukle(kimlikSonu(it), SOZLUK) } == true)

    private fun kimlikSonu(kimlik: String): String = kimlik.substringAfterLast('/')

    private fun gorunmez(cp: Int): Boolean =
        (cp < 0x20) ||
            (cp in 0x7f..0x9f) ||
            cp == 0xad ||
            cp == 0x061c ||
            cp in 0x200b..0x200f ||
            cp in 0x2028..0x202e ||
            cp in 0x2060..0x206f ||
            cp == 0xfeff ||
            Character.getType(cp) == Character.FORMAT.toInt()

    private fun sozlukle(ham: String, sozluk: List<String>): Boolean {
        if (ham.isEmpty()) return false
        // CamelCase kimlikleri (`btnSend`, `etPIN`) katlamadan önce ayrılır.
        val ayrik = ham.replace(KUCUK_BUYUK_1, "$1 $2").replace(KUCUK_BUYUK_2, "$1 $2")
        val kat = katla(ayrik)
        val sozcukler = ArrayList<String>()
        val sb = StringBuilder()
        for (c in kat) {
            if (Character.isLetter(c)) {
                sb.append(c)
            } else if (sb.isNotEmpty()) {
                sozcukler.add(sb.toString())
                sb.setLength(0)
            }
        }
        if (sb.isNotEmpty()) sozcukler.add(sb.toString())
        if (sozcukler.isEmpty()) return false
        val birlesik = " " + sozcukler.joinToString(" ") + " "
        return sozluk.any { terim ->
            when {
                terim.contains(' ') -> birlesik.contains(" $terim ") || birlesik.contains(" $terim")
                terim.length >= ALT_DIZGE_ESIGI -> birlesik.contains(terim)
                else -> sozcukler.any { it.startsWith(terim) }
            }
        }
    }
}
