package dev.eren.ajanda

import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.EslesmeDurumu
import dev.eren.ajanda.cekirdek.ListeSorgusu
import dev.eren.ajanda.cekirdek.Sekme
import dev.eren.ajanda.cekirdek.cekirdekSurumu
import dev.eren.ajanda.cekirdek.eslestirmeQrCoz
import dev.eren.ajanda.cekirdek.sqliteSurumu
import dev.eren.ajanda.cekirdek.varsayilanHatirlatmalar

/**
 * Köprü tanısı: Kotlin -> Rust, Rust içinde SQLite (şema), model (QR doğrulaması) ve motorun salt
 * okuma sorguları (eşleşme, bağlantı, liste). Hiçbir şey yazmaz; gerçek veritabanında da güvenle
 * çalışır. Kişisel veri basmaz (kayıt içeriği, cihaz kimliği, adres yok; yalnız sayı ve durum adı).
 * Debug alıcısı ve JVM testi kullanır (ana ekran K4 yazılana dek de).
 */
object KopruKaniti {
    const val ETIKET = "Ajanda"
    const val TAMAM = "KÖPRÜ TAMAM"

    /** Belgelerde ve testlerde kullanılan örnek QR (Tailscale aralığından). */
    const val ORNEK_QR =
        """{"v":1,"kanal":"ajanda","host":"100.101.102.103","port":8765,"kod":"ABCD2345","server_public_key":"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAELo7RHblixW/eCgcHUWEUpDbbJAklv2hci/UyoZvt3tlFknx8R6AuK4fNoCDUtAri/uqLoKYXC/n78yrmUiLyFg=="}"""

    /** Eşzamanlı (SQLite): ana iş parçacığından çağırma. */
    fun calistir(cekirdek: Cekirdek): String {
        val qr = eslestirmeQrCoz(ORNEK_QR)
        check(qr.port == 8765) { "QR bozuldu" }
        val varsayilan = varsayilanHatirlatmalar()
        val eslesme = when (cekirdek.eslesmeDurumu()) {
            is EslesmeDurumu.Yok -> "yok"
            is EslesmeDurumu.Bekliyor -> "bekliyor"
            is EslesmeDurumu.Eslesti -> "eşleşti"
            is EslesmeDurumu.Reddedildi -> "reddedildi"
        }
        val baglanti = cekirdek.baglantiDurumu()
        val tarihli = cekirdek.liste(ListeSorgusu(Sekme.TARIHLI, false)).size
        val tarihsiz = cekirdek.liste(ListeSorgusu(Sekme.TARIHSIZ, false)).size
        return buildString {
            appendLine("Çekirdek ${cekirdekSurumu()}, gömülü SQLite ${sqliteSurumu()}, şema ${cekirdek.semaSurumu()}")
            appendLine("Model: QR ${qr.host}:${qr.port}, varsayılan hatırlatma $varsayilan")
            appendLine("Motor: eşleşme $eslesme, bağlantı ${baglanti.asama}, kuyrukta ${baglanti.kuyrukta}")
            appendLine("Kayıtlar: tarihli $tarihli, tarihsiz $tarihsiz")
            append(TAMAM)
        }
    }
}
