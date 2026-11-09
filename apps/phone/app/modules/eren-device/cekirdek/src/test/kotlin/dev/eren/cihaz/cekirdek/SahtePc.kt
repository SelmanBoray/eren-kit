package dev.eren.cihaz.cekirdek

import java.security.PrivateKey
import java.util.Base64
import java.util.Random

/**
 * Bilgisayar tarafı: yazılım P-256 anahtarı tutar, `protocol/CIHAZ.md` kablo metinlerini üretir.
 * İmza metni `protocol/src/temel.ts` `kimlikImzaMetni`'nin bağımsız kopyasıdır (`KimlikMetni.kt`'ye
 * bağlı değildir ki bir hata ikisinde birden saklanmasın). JSON elle kurulur, `Json` birimine bağlı değil.
 */
class SahtePc(
    val deviceId: String = "tel-1",
    tohum: Long = 7L,
) {
    /** `auth_challenge` imzasının nasıl bozulacağı. */
    enum class Varyant {
        DOGRU,

        /** İmza `sohbet` kanalı metniyle atılır (kanallar arası taşıma). */
        YANLIS_KANAL,

        /** İmza `telefon` rolüyle atılır (telefonun kendi rolünü yansıtma). */
        YANLIS_ROL,

        /** İmza başka (eski) bir `server_nonce` ile atılır, çerçevedeki nonce yenidir. */
        ESKI_NONCE,

        /** İmza başka (eski) bir `client_nonce` ile atılır. */
        ESKI_CLIENT_NONCE,

        /** İmza başka bir `device_id` için atılır. */
        YANLIS_DEVICE_ID,

        /** Geçerli imzanın bir baytı çevrilir. */
        BOZUK_IMZA,

        /** İmza metni doğru ama başka bir anahtarla atılır. */
        BASKA_ANAHTAR,

        /** Geçerli base64 ama DER olmayan çöp imza. */
        COP_IMZA,
    }

    /** Üretilen `auth_challenge`: çerçeve ve içindeki değerler (testlerin karşılaştırması için). */
    data class Meydan(val kare: String, val serverNonce: String, val clientNonce: String, val imza: String)

    private val cift = SahteImza.yeniCift()
    private val baskaCift = SahteImza.yeniCift()
    private val ozel: PrivateKey = cift.private
    private val rastgele = Random(tohum)

    /** Eşleştirmede telefona verilen PC açık anahtarı: SPKI DER, standart base64. */
    val acikAnahtar: String = Base64.getEncoder().encodeToString(cift.public.encoded)

    /** Başka bir PC'nin anahtarı (telefon eşleşmiş anahtarla doğruladığını göstermek için). */
    val baskaAcikAnahtar: String = Base64.getEncoder().encodeToString(baskaCift.public.encoded)

    private var oncekiServerNonce: String = nonce()

    fun nonce(): String = Base64.getEncoder().encodeToString(ByteArray(32).also { rastgele.nextBytes(it) })

    /** `hello` çerçevesinden `client_nonce`. */
    fun clientNonce(hello: String): String = alan(hello, "client_nonce")

    /** `hello` çerçevesinden `device_id`. */
    fun helloDeviceId(hello: String): String = alan(hello, "device_id")

    /**
     * `hello` karşılığı `auth_challenge`. `serverNonce` verilmezse yenisi üretilir. İmzalanan metin
     * `varyant`a göre bozulur; çerçevedeki alanlar her zaman şemaya uygundur.
     */
    fun authChallenge(
        hello: String,
        varyant: Varyant = Varyant.DOGRU,
        serverNonce: String = nonce(),
    ): Meydan {
        val cn = clientNonce(hello)
        val did = helloDeviceId(hello)
        val metin = when (varyant) {
            Varyant.YANLIS_KANAL -> imzaMetni("pc", "sohbet", did, cn, serverNonce)
            Varyant.YANLIS_ROL -> imzaMetni("telefon", "cihaz", did, cn, serverNonce)
            Varyant.ESKI_NONCE -> imzaMetni("pc", "cihaz", did, cn, oncekiServerNonce)
            Varyant.ESKI_CLIENT_NONCE -> imzaMetni("pc", "cihaz", did, nonce(), serverNonce)
            Varyant.YANLIS_DEVICE_ID -> imzaMetni("pc", "cihaz", did + "-x", cn, serverNonce)
            else -> imzaMetni("pc", "cihaz", did, cn, serverNonce)
        }
        var imza = when (varyant) {
            Varyant.BASKA_ANAHTAR -> SahteImza.imzala(baskaCift.private, metin)
            Varyant.COP_IMZA -> Base64.getEncoder().encodeToString(ByteArray(70) { 0x41 })
            else -> SahteImza.imzala(ozel, metin)
        }
        if (varyant == Varyant.BOZUK_IMZA) {
            val b = Base64.getDecoder().decode(imza)
            b[b.size - 5] = (b[b.size - 5].toInt() xor 0x55).toByte()
            imza = Base64.getEncoder().encodeToString(b)
        }
        oncekiServerNonce = serverNonce
        val kare = """{"v":1,"type":"auth_challenge","server_nonce":${j(serverNonce)},"server_signature":${j(imza)}}"""
        return Meydan(kare, serverNonce, cn, imza)
    }

    /** Telefonun `auth_response`'unu eşleşmiş telefon anahtarıyla doğrular (rol `telefon`, kanal `cihaz`). */
    fun telefonImzasiDogru(hello: String, meydan: Meydan, authResponse: String, telefonAcikAnahtar: String): Boolean {
        val metin = imzaMetni("telefon", "cihaz", helloDeviceId(hello), clientNonce(hello), meydan.serverNonce)
        return SahteImza.dogrula(telefonAcikAnahtar, metin, alan(authResponse, "signature"))
    }

    fun welcome(serverTimeMs: Long = 1_790_000_000_000L): String =
        """{"v":1,"type":"welcome","server_time_ms":$serverTimeMs}"""

    /**
     * `cmd` çerçevesi. `args` ham JSON nesne metnidir. `ekAlanlar` `,"alan":değer` biçiminde ham
     * eklenir (bilinmeyen alan saldırısı için).
     */
    fun cmd(
        cmdId: String = "c1",
        grantId: String = "g1",
        token: String = JETON,
        deadlineMs: Long = 1_790_000_030_000L,
        name: String = "foreground",
        args: String = "{}",
        ekAlanlar: String = "",
    ): String =
        """{"v":1,"type":"cmd","cmd_id":${j(cmdId)},"grant_id":${j(grantId)},"token":${j(token)},""" +
            """"deadline_ms":$deadlineMs,"name":${j(name)},"args":$args$ekAlanlar}"""

    /** `grant_id` `null` verilirse bütün izinler. */
    fun grantRevoke(grantId: String?, neden: String = "limit_kilit"): String =
        """{"v":1,"type":"grant_revoke","grant_id":${if (grantId == null) "null" else j(grantId)},"neden":${j(neden)}}"""

    fun notify(
        notifyId: String = "n1",
        tur: String = "soru",
        baslik: String = "Soru var",
        metin: String = "İş 7 cevap bekliyor.",
    ): String =
        """{"v":1,"type":"notify","notify_id":${j(notifyId)},"tur":${j(tur)},"baslik":${j(baslik)},"metin":${j(metin)}}"""

    fun hata(kod: String): String = """{"v":1,"type":"error","code":${j(kod)}}"""

    // `temel.ts` kimlikImzaMetni'nin bağımsız kopyası; PROTOKOL_SURUMU = 1.
    private fun imzaMetni(rol: String, kanal: String, deviceId: String, clientNonce: String, serverNonce: String) =
        listOf("eren-auth-v1", rol, kanal, deviceId, clientNonce, serverNonce).joinToString("\n")

    private fun alan(kare: String, ad: String): String {
        val m = Regex("\"" + ad + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").find(kare)
        return requireNotNull(m) { "SahtePc: çerçevede $ad yok" }.groupValues[1]
    }

    companion object {
        /** CIHAZ.md örneğiyle aynı, 42 karakterlik geçerli jeton. */
        const val JETON = "abcdefghijklmnopqrstuvwxyz012345_-ABCDEFG"

        /** JSON metin değeri; kontrol karakterleri ve tırnak/ters bölü kaçırılır. */
        fun j(s: String): String {
            val b = StringBuilder("\"")
            for (c in s) {
                when {
                    c == '"' -> b.append("\\\"")
                    c == '\\' -> b.append("\\\\")
                    c == '\n' -> b.append("\\n")
                    c == '\r' -> b.append("\\r")
                    c == '\t' -> b.append("\\t")
                    c < ' ' -> b.append("\\u").append(String.format("%04x", c.code))
                    else -> b.append(c)
                }
            }
            return b.append('"').toString()
        }
    }
}
