package dev.eren.ajanda

import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.cekirdekSurumu
import dev.eren.ajanda.cekirdek.sqliteSurumu

/**
 * Köprünün uçtan uca çalıştığını gösterir: Kotlin -> Rust, Rust -> Kotlin (imza),
 * Rust içinde SQLite'a yazıp geri okuma. Hem ekran hem JVM testi kullanır.
 */
object KopruKaniti {
    const val TAMAM = "KÖPRÜ TAMAM"

    fun calistir(cekirdek: Cekirdek, metin: String = "köprü denemesi ğüşİıöç"): String {
        val yazilan = cekirdek.imzalaVeYaz(metin)
        val okunan = checkNotNull(cekirdek.oku(yazilan.kimlik)) { "yazılan kayıt okunamadı: #${yazilan.kimlik}" }
        check(okunan.metin == metin) { "metin bozuldu: ${okunan.metin}" }
        val imza = checkNotNull(okunan.imza) { "imza yazılmadı" }
        check(imza.contentEquals(yazilan.imza)) { "imza bozuldu" }
        return buildString {
            appendLine("Çekirdek ${cekirdekSurumu()}, gömülü SQLite ${sqliteSurumu()}, şema ${cekirdek.semaSurumu()}")
            appendLine("Kotlin → Rust: tamam")
            appendLine("Rust → Kotlin (imza): ${imza.size} bayt")
            appendLine("SQLite yaz/oku: #${okunan.kimlik} \"${okunan.metin}\"")
            append(TAMAM)
        }
    }
}
