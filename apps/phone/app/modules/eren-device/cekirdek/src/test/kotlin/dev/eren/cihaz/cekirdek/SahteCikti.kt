package dev.eren.cihaz.cekirdek

import java.io.File

/**
 * Giden çerçeveleri `eren.cikti` sistem özelliğindeki dosyaya (JSON Lines) ekler; özellik yoksa
 * hiçbir şey yapmaz. Node testi bunları `cihazYukariCoz` ile doğrular. Çerçeve tek satır olmalıdır.
 */
object SahteCikti {
    private val kilit = Any()

    fun ekle(kare: String) {
        val yol = System.getProperty("eren.cikti") ?: return
        require('\n' !in kare && '\r' !in kare) { "çerçeve tek satır olmalı" }
        synchronized(kilit) {
            val dosya = File(yol)
            dosya.absoluteFile.parentFile?.mkdirs()
            dosya.appendText(kare + "\n", Charsets.UTF_8)
        }
    }
}
