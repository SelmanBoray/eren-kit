package dev.eren.ajanda.kimlik

import dev.eren.ajanda.cekirdek.AjandaEslestirmeQr
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.eslestirmeQrCoz
import java.security.MessageDigest

/**
 * PC'deki `eslestir --ajanda` komutunun çıktısından eşleştirme verisini ve kullanıcının yazdığı kısa
 * kodu denetleyen saf mantık (Android çerçevesi yok; JVM birim testinde sınanır).
 *
 * Komutun çıktısı (`apps/phone/server/src/eslestir.ts` `kodMetni`):
 * ```
 * {"v":1,"kanal":"ajanda","host":...,"port":...,"kod":...,"server_public_key":...}
 * Parmak izi: XXXX XXXX ...
 * Kod:XXXXXXXX  (5 dakika geçerli, tek kullanımlık)
 * Kapsam: ajanda (...)
 * ```
 * Şema denetimi Rust'tadır (`eslestirmeQrCoz`, tek kaynak); burada yalnız satırı bulmak, hatayı
 * kullanıcıya anlatılabilir sınıfa ayırmak, anahtarın P-256 olduğunu ve varsa parmak izi satırının
 * tuttuğunu denetlemek var.
 */
object EslestirmeVerisi {
    /** Yapıştırılan metnin üst sınırı (komut çıktısı birkaç yüz karakterdir). */
    const val AZAMI_METIN = 8192

    /** JSON satırının üst sınırı. */
    const val AZAMI_SATIR = 1024

    const val KOD_EN_KISA = 6
    const val KOD_EN_UZUN = 32

    private const val PARMAK_IZI_ONEKI = "Parmak izi:"

    /**
     * Satırlara böler (`\n`, `\r\n`, `\r`) ve `{` ile başlayan ilk satırı verir. Kenardaki boşluk ve
     * bayt sırası işareti (bazı uygulamalar kopyalarken ekler) atılır.
     */
    fun jsonSatiriniBul(metin: String): String? =
        satirlar(metin).firstOrNull { it.startsWith("{") }

    /** `Parmak izi:` satırındaki değer (boşluksuz, büyük harf); satır yoksa `null`. */
    fun parmakIziSatiri(metin: String): String? =
        satirlar(metin)
            .firstOrNull { it.startsWith(PARMAK_IZI_ONEKI, ignoreCase = true) }
            ?.substring(PARMAK_IZI_ONEKI.length)
            ?.filterNot { it.isWhitespace() }
            ?.uppercase()

    private fun satirlar(metin: String): Sequence<String> =
        metin.lineSequence().map { s -> s.trim { it.isWhitespace() || it == '﻿' } }

    /**
     * Yapıştırılan metni çözer. `coz` şema denetimidir (üretimde Rust `eslestirmeQrCoz`): geçerli
     * `AjandaEslestirmeQr` döner ya da `CekirdekHatasi.GecersizGirdi{alan, neden}` fırlatır.
     */
    fun coz(metin: String, coz: (String) -> AjandaEslestirmeQr = ::eslestirmeQrCoz): VeriCozumu {
        if (metin.isBlank()) return VeriCozumu.Bos
        if (metin.length > AZAMI_METIN) return VeriCozumu.Hatali(VeriHatasi.CokUzun)
        val satir = jsonSatiriniBul(metin) ?: return VeriCozumu.Hatali(VeriHatasi.JsonSatiriYok)
        if (satir.length > AZAMI_SATIR) return VeriCozumu.Hatali(VeriHatasi.CokUzun)
        val qr = try {
            coz(satir)
        } catch (e: CekirdekHatasi.GecersizGirdi) {
            return VeriCozumu.Hatali(semaHatasi(e.alan, e.neden))
        }
        val der = P256.base64Coz(qr.serverPublicKey)
            ?: return VeriCozumu.Hatali(VeriHatasi.GecersizAlan("server_public_key", "P-256 açık anahtarı değil"))
        val parmakIzi = P256.parmakIzi(der)
        val yazilan = parmakIziSatiri(metin)
        if (yazilan != null && yazilan != parmakIzi.replace(" ", "")) {
            return VeriCozumu.Hatali(VeriHatasi.ParmakIziUyusmuyor)
        }
        return VeriCozumu.Gecerli(qr, parmakIzi)
    }

    /**
     * Rust'ın şema hatasını sınıflar. `kanal` alanındaki hata (eksik ya da `ajanda` değil) sohbet
     * uygulaması için üretilmiş veridir: `EslestirmeQr`'da `kanal` yoktur, alan sırası `v`, `kanal`, ...
     */
    internal fun semaHatasi(alan: String, neden: String): VeriHatasi = when {
        alan == "kanal" -> VeriHatasi.BaskaKanal
        alan.isEmpty() -> VeriHatasi.JsonDegil
        else -> VeriHatasi.GecersizAlan(alan, neden)
    }

    /**
     * Kullanıcının yazdığını kod biçimine getirir: boşluk ve tire atılır, baştaki `Kod:` atılır, Türkçe
     * klavyenin `İ`/`ı`/`i`'si `I` olur, büyük harfe çevrilir (yerel ayardan bağımsız).
     */
    fun koduDuzelt(girdi: String): String {
        var s = girdi.trim()
        if (s.startsWith("kod:", ignoreCase = true)) s = s.substring(4)
        val sb = StringBuilder(s.length)
        for (c in s) {
            when {
                c.isWhitespace() || c == '-' -> Unit
                c == 'İ' || c == 'ı' || c == 'i' -> sb.append('I')
                c in 'a'..'z' -> sb.append(c - ('a' - 'A'))
                else -> sb.append(c)
            }
        }
        return sb.toString()
    }

    /** Düzeltilmiş kodun biçim denetimi (`EslestirmeKodu`: 6-32, `^[A-Z0-9]+$`); geçerliyse `null`. */
    fun kodBicimHatasi(kod: String): KodHatasi? = when {
        kod.isEmpty() -> KodHatasi.Bos
        kod.any { it !in 'A'..'Z' && it !in '0'..'9' } -> KodHatasi.GecersizKarakter
        kod.length < KOD_EN_KISA -> KodHatasi.Kisa
        kod.length > KOD_EN_UZUN -> KodHatasi.Uzun
        else -> null
    }

    /**
     * Kodun tam denetimi: biçim, sonra yapıştırılan verideki kodla eşitlik (sabit süreli). Eşitlik,
     * yapıştırılan verinin kullanıcının PC ekranında gördüğü komut çıktısı olduğunu bağlar: bayat
     * (komut yeniden çalıştırıldı) ya da yolda değiştirilmiş veri PC'ye hiç gitmeden yakalanır.
     */
    fun kodHatasi(kod: String, veri: VeriCozumu): KodHatasi? {
        kodBicimHatasi(kod)?.let { return it }
        if (veri !is VeriCozumu.Gecerli) return null
        val esit = MessageDigest.isEqual(kod.toByteArray(Charsets.US_ASCII), veri.qr.kod.toByteArray(Charsets.US_ASCII))
        return if (esit) null else KodHatasi.VeriyleUyusmuyor
    }
}

/** Yapıştırılan metnin çözümü. */
sealed interface VeriCozumu {
    data object Bos : VeriCozumu

    /** `parmakIzi`: PC açık anahtarının parmak izi, komutun yazdığıyla aynı biçimde. */
    data class Gecerli(val qr: AjandaEslestirmeQr, val parmakIzi: String) : VeriCozumu {
        override fun toString() = "Gecerli(${qr.host}:${qr.port}, parmakIzi=$parmakIzi)"
    }

    data class Hatali(val hata: VeriHatasi) : VeriCozumu
}

sealed interface VeriHatasi {
    data object CokUzun : VeriHatasi

    /** `{` ile başlayan satır yok: komutun çıktısı değil. */
    data object JsonSatiriYok : VeriHatasi

    data object JsonDegil : VeriHatasi

    /** Sohbet uygulaması için (`eslestir`, `--ajanda`'sız) ya da başka kanal için üretilmiş veri. */
    data object BaskaKanal : VeriHatasi

    /** Şemadan geçmeyen alan (eksik, fazla, biçimsiz; Tailscale dışı adres dahil). */
    data class GecersizAlan(val alan: String, val neden: String) : VeriHatasi

    /** Metindeki `Parmak izi:` satırı JSON'daki anahtarla tutmuyor: metin bozulmuş ya da karışmış. */
    data object ParmakIziUyusmuyor : VeriHatasi
}

sealed interface KodHatasi {
    data object Bos : KodHatasi
    data object Kisa : KodHatasi
    data object Uzun : KodHatasi
    data object GecersizKarakter : KodHatasi

    /** Biçimi doğru ama yapıştırılan verideki kod değil. */
    data object VeriyleUyusmuyor : KodHatasi
}
