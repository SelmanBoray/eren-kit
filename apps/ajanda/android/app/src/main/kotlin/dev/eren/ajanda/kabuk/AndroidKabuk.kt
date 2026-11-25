package dev.eren.ajanda.kabuk

import dev.eren.ajanda.cekirdek.Kabuk
import dev.eren.ajanda.cekirdek.KabukHatasi
import java.security.MessageDigest

/**
 * Rust çekirdeğinin geri çağırdığı Android tarafı (Rust -> Kotlin).
 *
 * İSKELET: `imzala` şimdilik yalnız SHA-256 özeti döndürür; gerçek Android Keystore
 * imzası eşitleme işiyle birlikte buraya gelecek. Hata durumunda
 * `KabukHatasi.Basarisiz` fırlat; Rust'a `Err(KabukHatasi::Basarisiz)` olarak döner.
 */
class AndroidKabuk : Kabuk {
    override fun imzala(veri: ByteArray): ByteArray =
        try {
            MessageDigest.getInstance("SHA-256").digest(veri)
        } catch (e: Exception) {
            throw KabukHatasi.Basarisiz(e.toString())
        }
}
