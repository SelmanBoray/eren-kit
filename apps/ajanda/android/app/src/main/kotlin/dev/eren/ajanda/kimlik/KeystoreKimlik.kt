package dev.eren.ajanda.kimlik

import android.content.Context
import dev.eren.ajanda.cekirdek.KabukHatasi
import dev.eren.ajanda.cekirdek.KimlikKabugu

/**
 * SAHİBİ: K1 (kimlik ve eşleştirme). Android Keystore'daki P-256 cihaz anahtarı:
 * `acikAnahtar` SPKI DER, `imzala` SHA256withECDSA (DER), `dogrula` PC imzası (java.security),
 * `rastgele` SecureRandom, `anahtariSil`. Başvuru: apps/phone/app/modules/eren-device (yalnız örnek).
 * İSKELET: her yöntem "yazılmadı" fırlatır.
 */
class KeystoreKimlik(private val context: Context) : KimlikKabugu {
    private fun yazilmadi(): Nothing = throw KabukHatasi.Basarisiz("yazılmadı: kimlik.KeystoreKimlik (K1)")

    override fun acikAnahtar(): ByteArray = yazilmadi()

    override fun imzala(veri: ByteArray): ByteArray = yazilmadi()

    override fun dogrula(acikAnahtar: ByteArray, veri: ByteArray, imza: ByteArray): Boolean = yazilmadi()

    override fun rastgele(uzunluk: UInt): ByteArray = yazilmadi()

    override fun anahtariSil() = yazilmadi()
}
