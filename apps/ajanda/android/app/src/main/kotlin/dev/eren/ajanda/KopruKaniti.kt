package dev.eren.ajanda

import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.cekirdekSurumu
import dev.eren.ajanda.cekirdek.eslestirmeQrCoz
import dev.eren.ajanda.cekirdek.sqliteSurumu
import dev.eren.ajanda.cekirdek.varsayilanHatirlatmalar

/**
 * Köprü tanısı: Kotlin -> Rust, Rust içinde SQLite (şema), model (QR doğrulaması), ve ikinci
 * dalganın henüz yazılmamış parçalarının `Yazilmadi` olarak döndüğü. Ekran, debug alıcısı ve JVM
 * testi kullanır.
 */
object KopruKaniti {
    const val ETIKET = "Ajanda"
    const val TAMAM = "KÖPRÜ TAMAM"

    /** Belgelerde ve testlerde kullanılan örnek QR (Tailscale aralığından). */
    const val ORNEK_QR =
        """{"v":1,"kanal":"ajanda","host":"100.101.102.103","port":8765,"kod":"ABCD2345","server_public_key":"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAELo7RHblixW/eCgcHUWEUpDbbJAklv2hci/UyoZvt3tlFknx8R6AuK4fNoCDUtAri/uqLoKYXC/n78yrmUiLyFg=="}"""

    fun calistir(cekirdek: Cekirdek): String {
        val qr = eslestirmeQrCoz(ORNEK_QR)
        check(qr.port == 8765) { "QR bozuldu" }
        val varsayilan = varsayilanHatirlatmalar()
        val bekleyen = runCatching { cekirdek.eslesmeDurumu() }.exceptionOrNull()
        return buildString {
            appendLine("Çekirdek ${cekirdekSurumu()}, gömülü SQLite ${sqliteSurumu()}, şema ${cekirdek.semaSurumu()}")
            appendLine("Model: QR ${qr.host}:${qr.port}, varsayılan hatırlatma $varsayilan")
            appendLine(
                "İkinci dalga: " +
                    if (bekleyen is CekirdekHatasi.Yazilmadi) "bekliyor (${bekleyen.parca})" else "yazıldı",
            )
            append(TAMAM)
        }
    }
}
