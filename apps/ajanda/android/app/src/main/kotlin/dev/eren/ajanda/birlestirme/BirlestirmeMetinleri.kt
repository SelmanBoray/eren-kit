package dev.eren.ajanda.birlestirme

import dev.eren.ajanda.cekirdek.BirlestirmeOnizlemesi
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.KoparmaSonucu

/**
 * SAHİBİ: D4 (Android). Birleştirme önizlemesinin kullanıcı metinleri (saf). Yalnız sayı taşır: kayıt başlığı,
 * kimliği ya da alan değeri metne girmez. Servis "Eren servisi" diye anılır.
 */
class BirlestirmeMetinleri {
    val baslik = "Kayıtlar Eren servisiyle birleştirilsin mi?"
    val degistiBaslik = "Kayıtlar bu arada değişti"
    val sonucBaslik = "Birleştirildi"
    val koptuBaslik = "Birleştirilemedi"
    val vazgecBaslik = "Bağlanma iptal edildi"
    val hataBaslik = "Birleştirme yapılamadı"
    val onayDugmesi = "Birleştir"
    val vazgecDugmesi = "Vazgeç"
    val sonraDugmesi = "Şimdi değil"
    val bekleyenYok = "Onay bekleyen bir birleştirme yok."
    val koptu = "Eren servisiyle bağlantı koptu; hiçbir kayıt değişmedi. Yeniden bağlanınca yeniden sorulacak."

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
        add("Şimdi değil derseniz bağlantı yeniden kurulunca yeniden sorulur.")
    }.joinToString("\n")

    fun sonuc(p: BirlestirmeOnizlemesi?): String = buildList {
        add("Bu telefon artık Eren servisine bağlı.")
        if (p == null) return@buildList
        if (p.islem > 0) add("${p.islem} işlem Eren servisine gönderilmek üzere sıraya alındı.")
        val ret = p.retListesine.size + p.pcSilmisler.size
        if (ret > 0) add("$ret kayıt gönderilemeyenler listesine düşebilir; oradan düzeltilebilir.")
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
