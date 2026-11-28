package dev.eren.ajanda.ekran.sahne.ekranlar

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.vector.ImageVector
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import dev.eren.ajanda.ekran.sahne.tema.Simgeler

/**
 * Yer tutucu kayıt. Bu dilimde ekranlar çekirdeğe bağlı değil; iskelet, temayı ve geçişleri göstermek için
 * aşağıdaki uydurma örneklerle çizilir. Sonraki dilim bunu `AnaDenetleyici`/`Liste` çıktısından kurulan
 * gerçek görünüm modeliyle değiştirir ve bu dosyayı siler.
 */
@Immutable
data class OrnekKayit(
    val id: String,
    val baslik: String,
    val zaman: String?,
    val renk: LevhaRengi,
    val figur: ImageVector,
    val taslak: Boolean = false,
    val bitti: Boolean = false,
    val tarihsiz: Boolean = false,
    /** Takvimde hangi güne düştüğü, bugüne göre gün farkı. */
    val gunFarki: Int = 0,
)

object Ornekler {
    val hepsi: List<OrnekKayit> = listOf(
        OrnekKayit("ornek-kahve", "Kahve molası", "15:30", LevhaRengi.HARDAL, Simgeler.Fincan),
        OrnekKayit("ornek-dis", "Diş kontrolü", "17:00", LevhaRengi.PEMBE, Simgeler.Dis),
        OrnekKayit("ornek-market", "Market alışverişi", "Akşam", LevhaRengi.KOBALT, Simgeler.Sepet),
        OrnekKayit("ornek-kargo", "Kargo teslimi", "Öğleden sonra", LevhaRengi.CAM, Simgeler.Kutu),
        OrnekKayit("ornek-fatura", "Fatura ödemesi", "yarın, 10:00", LevhaRengi.GECE, Simgeler.Fatura, taslak = true),
        OrnekKayit("ornek-ilac", "Vitamin", "09:00", LevhaRengi.DOMATES, Simgeler.Ilac, bitti = true),
        OrnekKayit("ornek-kamp", "Kamp çadırını onar", null, LevhaRengi.KUM, Simgeler.Cadir, tarihsiz = true),
        OrnekKayit("ornek-imza", "Formu imzala", null, LevhaRengi.GOK, Simgeler.Imza, tarihsiz = true),
        OrnekKayit("ornek-zil", "Kapı zilini değiştir", null, LevhaRengi.DOMATES, Simgeler.Zil, tarihsiz = true),
        OrnekKayit("ornek-yarin", "Kitap iadesi", "11:00", LevhaRengi.GOK, Simgeler.Yildiz, gunFarki = 1),
        OrnekKayit("ornek-hafta", "Bisiklet bakımı", "Sabah", LevhaRengi.CAM, Simgeler.Yildiz, gunFarki = 4),
        OrnekKayit("ornek-gecen", "Su faturası", "14:00", LevhaRengi.KOBALT, Simgeler.Fatura, bitti = true, gunFarki = -3),
    )

    val bugun get() = hepsi.filter { !it.tarihsiz && it.gunFarki == 0 }
    val tarihsizler get() = hepsi.filter { it.tarihsiz }

    fun bul(id: String?): OrnekKayit? = hepsi.firstOrNull { it.id == id }
}
