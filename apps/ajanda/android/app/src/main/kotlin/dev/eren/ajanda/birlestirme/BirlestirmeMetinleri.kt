package dev.eren.ajanda.birlestirme

import dev.eren.ajanda.cekirdek.BirlestirmeOnizlemesi
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.KoparmaSonucu

/**
 * SAHİBİ: D4 (Android). Birleştirme önizlemesinin kullanıcı metinleri (saf). Yalnız sayı taşır: kayıt başlığı,
 * kimliği ya da alan değeri metne girmez. Servis "Eren servisi" diye anılır.
 */
open class BirlestirmeMetinleri {
    val baslik = "Kayıtlar Eren servisiyle birleştirilsin mi?"
    val degistiBaslik = "Kayıtlar bu arada değişti"
    val sonucBaslik = "Birleştirildi"
    val koptuBaslik = "Birleştirilemedi"
    val vazgecBaslik = "Bağlanma iptal edildi"
    val hataBaslik = "Birleştirme yapılamadı"
    val onayDugmesi = "Birleştir"
    val vazgecDugmesi = "Vazgeç"
    val sonraDugmesi = "Şimdi değil"
    val koptu = "Eren servisiyle bağlantı koptu; hiçbir kayıt değişmedi. Yeniden bağlanınca yeniden sorulacak."
    /** Sonuç metninin ilk cümlesi; sayılar kurulamazsa tek başına. */
    val sonucKisa = "Bu telefon artık Eren servisine bağlı."
    val zatenBaslik = "Zaten bağlı"
    val zaten = "Bu telefon Eren servisine bağlı; birleştirme bu arada tamamlanmış. Kayıtları artık Eren servisi tutar."
    /** Bu onayın planı daha önce uygulanmış, ama telefon şimdi bağlı değil (ör. sonradan bağlantı koparıldı). */
    val oncedenBaslik = "Birleştirme daha önce yapıldı"
    val onceden = "Bu birleştirme daha önce tamamlanmıştı; bu onay hiçbir kaydı değiştirmedi."
    val belirsizBaslik = "Birleştirmenin sonucu okunamadı"
    val belirsiz = "Birleştirmenin uygulanıp uygulanmadığı şu an okunamadı. Kayıtlar yenilenince durum görünür; " +
        "birleştirme hâlâ bekliyorsa yeniden sorulur."

    /** "Bekleyen birleştirme" şeridi (`BirlestirmeAkisi.bekleyen`); düğme `denetle(zorla = true)`. */
    val bekleyenSeridi = "Kayıtların Eren servisiyle birleştirilmesi onayınızı bekliyor."
    val bekleyenDugmesi = "Gözden geçir"

    fun onizleme(p: BirlestirmeOnizlemesi, degisti: Boolean): String = buildList {
        if (degisti) add("Önizlemeden sonra kayıtlar değişti; plan yenilendi.")
        add(
            if (p.ayniDepo) "Bu telefon daha önce bu Eren servisine bağlıydı. Aradaki değişiklikler birleştirilecek."
            else "Bu telefondaki kayıtlar Eren servisindekilerle birleştirilecek.",
        )
        val satirlar = buildList {
            if (p.yeni > 0) add("${p.yeni} kayıt Eren servisine yeni kayıt olarak gidecek")
            if (p.degisen > 0) add("${p.degisen} kayıttaki değişiklik Eren servisine gidecek")
            if (p.cakisanlar.isNotEmpty()) {
                add(
                    "${p.cakisanlar.size} kayıtta iki tarafta da aynı bilgi değişmiş: telefondaki geçerli olacak " +
                        "(Eren servisindeki önceki hali geçmişte kalır)",
                )
            }
            if (p.pcSilmisler.isNotEmpty()) {
                add(
                    "${p.pcSilmisler.size} kayıt Eren servisinde silinmiş ama telefonda değişmiş: " +
                        "gönderilemeyenler listesine düşecek",
                )
            }
            if (p.retListesine.isNotEmpty()) add("${p.retListesine.size} kayıt birleşemiyor: gönderilemeyenler listesine düşecek")
            if (p.dusecekMezar > 0) add("Telefonda silinmiş ${p.dusecekMezar} kayıt gönderilmeyecek, Silinenler'den kalkacak")
            if (p.taslaklar.isNotEmpty()) {
                add(
                    "${p.taslaklar.size} taslak Eren servisine gönderilmeyecek: ana listeden kalkıp gönderilemeyenler " +
                        "listesine düşecek, oradan düzeltilip eklenebilir",
                )
            }
            if (p.okunamayanPcTemeli > 0) {
                add(
                    "${p.okunamayanPcTemeli} kaydın Eren servisindeki önceki hali okunamıyor: " +
                        "telefondaki farklı her alan Eren servisine gidecek",
                )
            }
            if (p.ayni > 0) add("${p.ayni} kayıt Eren servisindekiyle aynı")
            if (p.servistenGelecek > 0) add("${p.servistenGelecek} kayıt Eren servisinden telefona gelecek")
            if (p.olasiCiftler.isNotEmpty()) {
                add(
                    "${p.olasiCiftler.size} kayıt Eren servisindeki bir kayda benziyor (aynı tür, başlık ve zaman): " +
                        "ikisi de tutulacak, listede işaretlenecek",
                )
            }
        }
        satirlar.forEach { add("• $it") }
        if (p.islem > 0) add("Onaylarsanız değişiklikler Eren servisine ${p.islem} işlem olarak gönderilir.")
        add("Bundan sonra kayıtları Eren servisi tutar; bu telefon ona bağlı çalışır.")
        add("Vazgeçerseniz hiçbir kayıt değişmez; eşleşme silinir, yeniden bağlanmak için QR kodu yeniden okutulur.")
        add("Şimdi değil derseniz hiçbir kayıt değişmez; bağlantı yeniden kurulunca ya da kayıtlar değişince yeniden sorulur.")
    }.joinToString("\n")

    /**
     * Uygulanan planın sonucu. Gönderilemeyenler: `retListesine` ve taslaklar dökmede hemen düşer; Eren servisinde
     * silinmişler servis reddedince düşer (ayrı cümle).
     */
    open fun sonuc(p: BirlestirmeOnizlemesi?): String = buildList {
        add(sonucKisa)
        if (p == null) return@buildList
        if (p.islem > 0) add("${p.islem} işlem Eren servisine gönderilmek üzere sıraya alındı.")
        if (p.retListesine.isNotEmpty()) add("${p.retListesine.size} kayıt gönderilemeyenler listesine düştü; oradan düzeltilebilir.")
        if (p.taslaklar.isNotEmpty()) {
            add("${p.taslaklar.size} taslak ana listeden kalkıp gönderilemeyenler listesine düştü; oradan düzeltilip eklenebilir.")
        }
        if (p.pcSilmisler.isNotEmpty()) {
            add("${p.pcSilmisler.size} kayıt Eren servisinde silinmiş olduğu için gönderilemeyenler listesine düşecek.")
        }
        if (p.olasiCiftler.isNotEmpty()) add("${p.olasiCiftler.size} olası çift listede işaretlendi.")
    }.joinToString("\n")

    fun vazgecSonucu(k: KoparmaSonucu): String =
        if (k.baglanmaIptal) {
            "Kayıtlar bu telefonda olduğu gibi duruyor. Yeniden bağlanmak için Eren servisinin QR kodunu yeniden okutun."
        } else {
            "Süren bir bağlanma yoktu; hiçbir şey değişmedi."
        }

    fun hata(e: Throwable): String = when (e) {
        is CekirdekHatasi.GecersizDurum -> "Bu telefon zaten Eren servisine bağlı; sorulacak bir şey yok."
        is CekirdekHatasi.Depo -> "Telefondaki kayıt deposu kullanılamadı. Yeniden deneyin."
        else -> "Beklenmeyen bir sorun oldu. Yeniden deneyin."
    }
}
