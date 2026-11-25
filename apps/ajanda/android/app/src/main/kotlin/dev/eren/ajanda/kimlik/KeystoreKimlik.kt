package dev.eren.ajanda.kimlik

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import dev.eren.ajanda.cekirdek.KabukHatasi
import dev.eren.ajanda.cekirdek.KimlikKabugu
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Cihaz anahtarının saklandığı yer. Özel anahtar bu arayüzün dışına çıkmaz: yalnız açık yarısı ve
 * imza verilir. Üretimde [AndroidKeystoreAnahtari]; JVM birim testlerinde yazılım anahtarı.
 */
interface CihazAnahtari {
    /** Açık yarı, SPKI DER. Anahtar yoksa üretir. */
    fun acikAnahtar(): ByteArray

    /** ECDSA P-256 + SHA-256, DER. Anahtar yoksa üretir. */
    fun imzala(veri: ByteArray): ByteArray

    /** Anahtarı siler; sonraki [acikAnahtar] yenisini üretir. Yoksa bir şey yapmaz. */
    fun sil()
}

/**
 * SAHİBİ: K1. Çekirdeğin `KimlikKabugu`'su: cihaz anahtarı ([CihazAnahtari]), PC imzasının doğrulaması
 * ([P256.dogrula]) ve güvenli rastgele.
 *
 * Motor kilidi altında çağrılır (MIMARI.md "Geri çağrı kuralı"): çekirdeğe yeniden girmez. Hatalar
 * `KabukHatasi.Basarisiz` olur; iletiye anahtar malzemesi ve imzalanan veri girmez, yalnız işlemin adı
 * ve istisnanın sınıfı.
 */
class KeystoreKimlik internal constructor(
    private val anahtar: CihazAnahtari,
    private val rastgeleKaynak: SecureRandom,
) : KimlikKabugu {

    /** `CekirdekErisimi`'nin kurucusu. Keystore süreç geneli olduğu için bağlam gerekmez. */
    @Suppress("UNUSED_PARAMETER")
    constructor(context: Context) : this(AndroidKeystoreAnahtari, SecureRandom())

    override fun acikAnahtar(): ByteArray = kabuk("açık anahtar") {
        val der = anahtar.acikAnahtar()
        if (!P256.acikAnahtarMi(der)) throw KabukHatasi.Basarisiz("kimlik: cihaz anahtarı P-256 SPKI değil")
        der
    }

    override fun imzala(veri: ByteArray): ByteArray = kabuk("imza") { anahtar.imzala(veri) }

    /** Bozuk anahtar ya da imza `false`'tur (PC'nin imzası reddedilir), hata değil. */
    override fun dogrula(acikAnahtar: ByteArray, veri: ByteArray, imza: ByteArray): Boolean =
        P256.dogrula(acikAnahtar, veri, imza)

    override fun rastgele(uzunluk: UInt): ByteArray {
        if (uzunluk > AZAMI_RASTGELE) throw KabukHatasi.Basarisiz("kimlik: rastgele uzunluğu sınır dışı ($uzunluk)")
        return ByteArray(uzunluk.toInt()).also { rastgeleKaynak.nextBytes(it) }
    }

    override fun anahtariSil() = kabuk("anahtar silme") { anahtar.sil() }

    private inline fun <T> kabuk(ne: String, blok: () -> T): T =
        try {
            blok()
        } catch (e: KabukHatasi) {
            throw e
        } catch (e: Exception) {
            throw KabukHatasi.Basarisiz("kimlik: $ne başarısız (${e.javaClass.simpleName})")
        }

    companion object {
        /** Çekirdeğin istediği en uzun rastgele dizi (nonce ve kimlikler birkaç düzine bayttır). */
        const val AZAMI_RASTGELE: UInt = 4096u
    }
}

/**
 * Android Keystore'daki P-256 cihaz anahtarı. Özel anahtar Keystore'dan çıkmaz.
 *
 * Kararlar:
 * - Yalnız `PURPOSE_SIGN`: PC imzası yazılımda, PC'nin açık anahtarıyla doğrulanır; cihaz anahtarıyla
 *   doğrulama gerekmez.
 * - Kullanıcı doğrulaması istenmez ve cihaz kilitliyken de imzalar: arka plan eşitlemesi (JobScheduler)
 *   ekran kapalıyken bağlanır.
 * - StrongBox istenmez (TEE yeter): imza motor kilidi altında alınır ve StrongBox'ta yüzlerce ms
 *   sürebilir; bazı cihazlarda StrongBox EC üretimi de güvenilmez.
 * - Takma ad sohbet uygulamasınınkinden (`eren_telefon_p256`) ayrıdır; zaten ayrı uygulamanın ayrı
 *   Keystore'udur. Sondaki `v1` anahtar biçimi değişirse yeni ad için.
 * - Kayıt var ama sertifikası okunamıyorsa sessizce yenisi üretilmez (eşleşme habersizce bozulurdu):
 *   hata fırlatılır; yenisi yalnız eşleşme kaldırılınca ([sil]) gelir.
 *
 * Kilit ve açık anahtar önbelleği nesne (süreç) düzeyinde: iki [KeystoreKimlik] örneği aynı anda
 * üretmeye kalkıp birbirinin anahtarını ezemez.
 */
internal object AndroidKeystoreAnahtari : CihazAnahtari {
    const val TAKMA_AD = "dev.eren.ajanda.cihaz_p256.v1"
    private const val SAGLAYICI = "AndroidKeyStore"

    private val kilit = Any()

    @Volatile
    private var acikOnbellek: ByteArray? = null

    override fun acikAnahtar(): ByteArray {
        acikOnbellek?.let { return it.copyOf() }
        synchronized(kilit) {
            acikOnbellek?.let { return it.copyOf() }
            val ks = keyStore()
            if (!ks.containsAlias(TAKMA_AD)) uret()
            val sertifika = ks.getCertificate(TAKMA_AD)
                ?: throw IllegalStateException("anahtar kaydının sertifikası yok")
            val der = sertifika.publicKey.encoded
            acikOnbellek = der
            return der.copyOf()
        }
    }

    override fun imzala(veri: ByteArray): ByteArray {
        acikAnahtar() // yoksa üret
        val ozel = keyStore().getKey(TAKMA_AD, null) as? PrivateKey
            ?: throw IllegalStateException("özel anahtar yok")
        val imza = Signature.getInstance(P256.IMZA_ALGORITMASI)
        imza.initSign(ozel)
        imza.update(veri)
        return imza.sign()
    }

    override fun sil() {
        synchronized(kilit) {
            acikOnbellek = null
            val ks = keyStore()
            if (ks.containsAlias(TAKMA_AD)) ks.deleteEntry(TAKMA_AD)
        }
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(SAGLAYICI).apply { load(null) }

    private fun uret() {
        val ozellik = KeyGenParameterSpec.Builder(TAKMA_AD, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(false)
            .build()
        val uretici = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, SAGLAYICI)
        uretici.initialize(ozellik)
        uretici.generateKeyPair()
    }
}
