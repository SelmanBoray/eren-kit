package dev.eren.ajanda.kimlik

import java.security.GeneralSecurityException
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * Sözleşmenin kimlik kodlaması (`temel.ts` `AcikAnahtar`, `Imza`): P-256 açık anahtarı SPKI DER,
 * imza ECDSA P-256 + SHA-256 DER, kabloda standart base64 (base64'ü Rust yapar).
 *
 * Yalnız java.security: Keystore'a dokunmaz, JVM birim testinde de aynen çalışır. PC imzasının
 * doğrulaması (`KimlikKabugu.dogrula`) ve parmak izi buradadır.
 */
object P256 {
    const val IMZA_ALGORITMASI = "SHA256withECDSA"

    /** Sıkıştırılmamış noktalı P-256 SPKI DER'in boyu: 26 bayt önek + 65 bayt nokta. */
    const val SPKI_UZUNLUGU = 91

    /** DER ECDSA P-256 imzasının en büyük boyu: SEQUENCE(2) + 2 x INTEGER(2 + 33). */
    const val AZAMI_IMZA = 72

    /**
     * `SEQUENCE { SEQUENCE { id-ecPublicKey, secp256r1 }, BIT STRING (0 kullanılmayan bit) }` başı.
     * Algoritma ve eğri OID'leri sabittir: başka eğri ya da algoritma burada elenir.
     */
    private val SPKI_ONEKI: ByteArray = onaltilik("3059301306072a8648ce3d020106082a8648ce3d030107034200")

    /** Sıkıştırılmamış nokta işareti (SEC1). */
    private const val NOKTA_ISARETI: Byte = 0x04

    /** `der` sıkıştırılmamış noktalı bir P-256 SPKI DER mi (biçim denetimi; nokta eğride mi bakılmaz). */
    fun acikAnahtarMi(der: ByteArray): Boolean {
        if (der.size != SPKI_UZUNLUGU) return false
        for (i in SPKI_ONEKI.indices) if (der[i] != SPKI_ONEKI[i]) return false
        return der[SPKI_ONEKI.size] == NOKTA_ISARETI
    }

    /** SPKI DER'den açık anahtar; P-256 değilse ya da çözülemezse `null`. */
    fun acikAnahtar(der: ByteArray): PublicKey? {
        if (!acikAnahtarMi(der)) return null
        return try {
            KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(der))
        } catch (_: GeneralSecurityException) {
            null
        }
    }

    /**
     * PC imzasını doğrular: `imza` (DER), `veri` (imza metninin UTF-8 baytları) üzerine `acikAnahtar`
     * (SPKI DER) ile. Bozuk anahtar ya da bozuk imza istisna değil `false`'tur.
     */
    fun dogrula(acikAnahtar: ByteArray, veri: ByteArray, imza: ByteArray): Boolean {
        if (imza.isEmpty() || imza.size > AZAMI_IMZA) return false
        val anahtar = acikAnahtar(acikAnahtar) ?: return false
        return try {
            val dogrulayici = Signature.getInstance(IMZA_ALGORITMASI)
            dogrulayici.initVerify(anahtar)
            dogrulayici.update(veri)
            dogrulayici.verify(imza)
        } catch (_: GeneralSecurityException) {
            false
        } catch (_: IllegalArgumentException) {
            false
        }
    }

    /**
     * PC'deki `eslestir` komutunun (`parmakIzi`) ve sohbet uygulamasının aynısı: SPKI DER'in SHA-256'sı,
     * büyük harf onaltılık, dörtlü gruplar, aralarında tek boşluk.
     */
    fun parmakIzi(der: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(der)
            .joinToString("") { "%02X".format(it.toInt() and 0xFF) }
            .chunked(4)
            .joinToString(" ")

    /** Kablodaki (base64) açık anahtarı çözer; P-256 SPKI değilse `null`. */
    fun base64Coz(acikAnahtarB64: String): ByteArray? {
        val der = try {
            Base64.getDecoder().decode(acikAnahtarB64)
        } catch (_: IllegalArgumentException) {
            return null
        }
        return if (acikAnahtarMi(der)) der else null
    }

    private fun onaltilik(s: String): ByteArray =
        ByteArray(s.length / 2) { i -> s.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
}
