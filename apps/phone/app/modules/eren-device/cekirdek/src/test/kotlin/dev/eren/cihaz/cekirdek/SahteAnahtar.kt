package dev.eren.cihaz.cekirdek

import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/** Yazılım P-256 telefon anahtarı. `imzalananlar` çekirdeğin hangi metni imzaladığını gösterir. */
class SahteAnahtar : AnahtarPortu {
    private val ozel: PrivateKey
    private val acik: String
    private val kilit = Any()
    private val imzali = ArrayList<String>()

    init {
        val cift = SahteImza.yeniCift()
        ozel = cift.private
        acik = Base64.getEncoder().encodeToString(cift.public.encoded)
    }

    /** `imzala` çağrılarının metinleri, sırayla. */
    val imzalananlar: List<String> get() = synchronized(kilit) { ArrayList(imzali) }

    override fun acikAnahtar(): String = acik

    override fun imzala(metin: String): String {
        synchronized(kilit) { imzali.add(metin) }
        return SahteImza.imzala(ozel, metin)
    }

    override fun dogrula(acikAnahtar: String, metin: String, imza: String): Boolean =
        SahteImza.dogrula(acikAnahtar, metin, imza)
}

/** Sahtelerin ortak P-256 yardımcıları. */
internal object SahteImza {
    fun yeniCift(): java.security.KeyPair =
        KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    fun imzala(ozel: PrivateKey, metin: String): String {
        val s = Signature.getInstance("SHA256withECDSA")
        s.initSign(ozel)
        s.update(metin.toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(s.sign())
    }

    fun dogrula(acikAnahtar: String, metin: String, imza: String): Boolean = try {
        val anahtar = KeyFactory.getInstance("EC")
            .generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(acikAnahtar)))
        val s = Signature.getInstance("SHA256withECDSA")
        s.initVerify(anahtar)
        s.update(metin.toByteArray(Charsets.UTF_8))
        s.verify(Base64.getDecoder().decode(imza))
    } catch (_: Exception) {
        false
    }
}
