package dev.eren.ajanda.aktarma

import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.DisaAktarma
import dev.eren.ajanda.cekirdek.IceAktarmaOnizlemesi
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * SAHİBİ: D3. Dışa ve içe aktarmanın kullanıcı metinleri (saf). Yalnız sayı ve tarih taşır: dosyanın
 * içeriği (başlık vb.) metne girmez. Servis "Eren servisi" diye anılır.
 */
class AktarmaMetinleri(private val dilim: ZoneId) {
    val disaBaslik = "Dışa aktarıldı"
    val disaHataBaslik = "Dışa aktarılamadı"
    val iceBaslik = "İçe aktarılsın mı?"
    val degistiBaslik = "Telefon bu arada değişti"
    val iceSonucBaslik = "İçe aktarıldı"
    val iceHataBaslik = "İçe aktarılamadı"
    val onayDugmesi = "İçe aktar"
    val bekleyenYok = "Onay bekleyen dosya yok. Dosyayı yeniden seçin."

    private val tarihBicimi = DateTimeFormatter.ofPattern("d MMMM yyyy HH:mm", Locale.forLanguageTag("tr"))

    fun tarih(ms: Long): String = tarihBicimi.format(Instant.ofEpochMilli(ms).atZone(dilim))

    fun disaSonucu(d: DisaAktarma): String = buildList {
        add(
            if (d.silinmis > 0) "${d.kayit} kayıt yedeğe yazıldı (${d.silinmis} silinmiş kayıt dahil)."
            else "${d.kayit} kayıt yedeğe yazıldı.",
        )
        if (d.kip == CalismaKipi.BAGLI) add("Eren servisine henüz gitmemiş değişiklikler de yedekte.")
        if (d.okunamayan > 0) add("${d.okunamayan} kayıt bu telefonda okunamadı; yedeğe olduğu gibi kondu.")
        if (d.retListesinde > 0) {
            add("Gönderilemeyenler listesindeki ${d.retListesinde} değişiklik yedeğe girmedi; önce onları düzeltin ya da atın.")
        }
    }.joinToString("\n")

    fun onizleme(p: IceAktarmaOnizlemesi, degisti: Boolean): String = buildList {
        if (degisti) add("Önizlemeden sonra telefondaki kayıtlar değişti; plan yenilendi.")
        add("${tarih(p.disaAktarmaMs)} tarihli yedek: ${p.toplam} kayıt.")
        val satirlar = buildList {
            if (p.yeni > 0) add("${p.yeni} yeni kayıt eklenecek")
            if (p.guncellenecek > 0) add("${p.guncellenecek} kayıt güncellenecek (yedekteki daha yeni)")
            if (p.ayni > 0) add("${p.ayni} kayıt telefondakiyle aynı")
            if (p.atlanacak > 0) add("${p.atlanacak} kayıt atlanacak (telefondaki daha yeni)")
            if (p.sinirAsan > 0) add("${p.sinirAsan} kayıt sınır dolduğu için eklenemeyecek")
            if (p.silinecek > 0) {
                add("${p.silinecek} kayıt silinecek (telefondaki kayıt, yedekteki daha yeni silinmiş haliyle değişecek)")
            }
            if (p.geriYuklenecek > 0) {
                add("${p.geriYuklenecek} kayıt geri yüklenecek (telefonda silinmiş, yedekteki daha yeni haliyle geri gelecek)")
            }
            if (p.gecersiz > 0) add("${p.gecersiz} kayıt okunamadı, alınmayacak")
            if (p.taslakGonderilmeyecek > 0) add("${p.taslakGonderilmeyecek} taslak Eren servisine gönderilmeyecek")
            if (p.gonderilmeyecek > 0) add("${p.gonderilmeyecek} silinmiş kayıt Eren servisine gönderilmeyecek")
        }
        satirlar.forEach { add("• $it") }
        if (p.yeni + p.guncellenecek == 0) {
            add("Telefona eklenecek ya da güncellenecek kayıt yok.")
        } else if (p.kip == CalismaKipi.BAGLI) {
            add(
                "Değişiklikler Eren servisine ${p.kuyrugaGirecekIslem} işlem olarak gönderilecek; kaydı Eren servisi yapar. " +
                    "Kaynak bilgisi ve zamanlar Eren servisinin olur.",
            )
        } else {
            add("Kayıtlar bu telefona yazılacak.")
        }
    }.joinToString("\n")

    fun iceSonucu(p: IceAktarmaOnizlemesi): String = buildList {
        val parcalar = buildList {
            if (p.yeni > 0) add("${p.yeni} yeni kayıt eklendi")
            if (p.guncellenecek > 0) add("${p.guncellenecek} kayıt güncellendi")
        }
        add(if (parcalar.isEmpty()) "Değişen kayıt olmadı." else parcalar.joinToString(", ") + ".")
        if (p.kip == CalismaKipi.BAGLI && p.kuyrugaGirecekIslem > 0) {
            add("${p.kuyrugaGirecekIslem} işlem Eren servisine gönderilmek üzere sıraya alındı.")
        }
        if (p.gecersiz > 0) add("${p.gecersiz} kayıt okunamadığı için alınmadı.")
        if (p.sinirAsan > 0) add("${p.sinirAsan} kayıt sınır dolduğu için eklenmedi.")
    }.joinToString("\n")

    fun hata(e: Throwable, yazarken: Boolean): String = when (sorunu(e, yazarken)) {
        AktarmaSorunu.GECERSIZ -> "Bu dosya bir ajanda yedeği değil ya da bozuk."
        AktarmaSorunu.DAHA_YENI -> "Bu yedek uygulamanın daha yeni bir sürümüyle yapılmış. İçe aktarmak için uygulamayı güncelleyin."
        AktarmaSorunu.COK_BUYUK -> "Dosya çok büyük; bir ajanda yedeği bu kadar büyük olamaz."
        AktarmaSorunu.BELLEK -> "Dosya çok büyük ya da bozuk; telefonun belleği açmaya yetmedi."
        AktarmaSorunu.EK_BOZUK -> "Yedekteki ek dosyalarından biri bozuk; yedek kullanılamıyor."
        AktarmaSorunu.OKUNAMADI -> "Dosya okunamadı. Yeniden deneyin."
        AktarmaSorunu.YAZILAMADI -> "Dosya yazılamadı. Başka bir yer seçip yeniden deneyin."
        AktarmaSorunu.DEPO -> "Telefondaki kayıt deposu kullanılamadı. Yeniden deneyin."
        AktarmaSorunu.BEKLENMEYEN -> "Beklenmeyen bir sorun oldu. Yeniden deneyin."
    }
}
