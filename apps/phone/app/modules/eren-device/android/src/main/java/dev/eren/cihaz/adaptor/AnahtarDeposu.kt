package dev.eren.cihaz.adaptor

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import dev.eren.cihaz.cekirdek.AnahtarPortu
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * AndroidKeyStore P-256. Özel anahtar Keystore'dan çıkmaz; yalnız imza istenir. İlk kullanımda
 * üretilir, StrongBox yoksa yazılım destekli Keystore'a düşer.
 */
class AnahtarDeposu : AnahtarPortu {
    private val kilit = Any()

    @Volatile
    private var acikAnahtarB64: String? = null

    override fun acikAnahtar(): String {
        acikAnahtarB64?.let { return it }
        synchronized(kilit) {
            acikAnahtarB64?.let { return it }
            val ks = keyStore()
            if (!ks.containsAlias(TAKMA_AD)) uret()
            val b64 = Base64.getEncoder().encodeToString(ks.getCertificate(TAKMA_AD).publicKey.encoded)
            acikAnahtarB64 = b64
            return b64
        }
    }

    override fun imzala(metin: String): String {
        acikAnahtar() // anahtarın var olduğundan emin ol
        val ozel = keyStore().getKey(TAKMA_AD, null) as PrivateKey
        val imza = Signature.getInstance(ALGORITMA)
        imza.initSign(ozel)
        imza.update(metin.toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(imza.sign())
    }

    override fun dogrula(acikAnahtar: String, metin: String, imza: String): Boolean {
        return try {
            val anahtar = KeyFactory.getInstance("EC")
                .generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(acikAnahtar)))
            val dogrulayici = Signature.getInstance(ALGORITMA)
            dogrulayici.initVerify(anahtar)
            dogrulayici.update(metin.toByteArray(Charsets.UTF_8))
            dogrulayici.verify(Base64.getDecoder().decode(imza))
        } catch (_: Exception) {
            false
        }
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun uret() {
        fun dene(strongBox: Boolean) {
            val b = KeyGenParameterSpec.Builder(
                TAKMA_AD,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
            )
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
            if (strongBox && Build.VERSION.SDK_INT >= 28) b.setIsStrongBoxBacked(true)
            val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            gen.initialize(b.build())
            gen.generateKeyPair()
        }
        try {
            dene(true)
        } catch (_: Exception) {
            dene(false)
        }
    }

    private companion object {
        const val TAKMA_AD = "eren_telefon_p256"
        const val ALGORITMA = "SHA256withECDSA"
    }
}

/** Eşleşmiş PC: kimlik, adres, port ve PC açık anahtarı. Uygulamaya özel depoda; JS'e anahtar verilmez. */
data class KayitliEslesme(val deviceId: String, val host: String, val port: Int, val pcAcikAnahtar: String)

/** `EslestirmeActivity` yazar; `Baglanti` ve köprü okur. Yeniden eşleştirme eskinin üzerine yazar. */
class EslesmeDeposu(context: Context) {
    private val depo = context.applicationContext
        .getSharedPreferences("eren_eslesme", Context.MODE_PRIVATE)

    fun kaydet(e: KayitliEslesme) {
        depo.edit()
            .putString("device_id", e.deviceId)
            .putString("host", e.host)
            .putInt("port", e.port)
            .putString("pc_anahtar", e.pcAcikAnahtar)
            .commit()
    }

    fun oku(): KayitliEslesme? {
        val id = depo.getString("device_id", null) ?: return null
        val host = depo.getString("host", null) ?: return null
        val anahtar = depo.getString("pc_anahtar", null) ?: return null
        val port = depo.getInt("port", -1)
        if (port !in 1..65535) return null
        return KayitliEslesme(id, host, port, anahtar)
    }

    fun sil() {
        depo.edit().clear().commit()
    }
}
