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
open class AktarmaMetinleri(private val dilim: ZoneId) {
    val disaBaslik = "Dışa aktarıldı"
    val disaHataBaslik = "Dışa aktarılamadı"
    val iceBaslik = "İçe aktarılsın mı?"
    val degistiBaslik = "Telefon bu arada değişti"
    val iceSonucBaslik = "İçe aktarıldı"
    val iceHataBaslik = "İçe aktarılamadı"
    val onayDugmesi = "İçe aktar"
    val bekleyenYok = "Onay bekleyen dosya yok. Dosyayı yeniden seçin."

    /** Uygulanmış içe aktarmanın sayılı metni kurulamazsa. */
    val iceSonucuKisa = "Yedekteki kayıtlar içe aktarıldı."

    private val tarihBicimi = DateTimeFormatter.ofPattern("d MMMM yyyy HH:mm", Locale.forLanguageTag("tr"))

    fun tarih(ms: Long): String = tarihBicimi.format(Instant.ofEpochMilli(ms).atZone(dilim))

    /**
     * [bellekAsiyor]: belge içe aktarma sınırının altında ama bu telefonda açmaya gereken bellek uygulamanın en iyi
     * durumda ayırabileceğini aşıyor (`YedekKabi.buTelefondaAcmaButcesi`); sınır aşılıyorsa yok sayılır.
     */
    fun disaSonucu(d: DisaAktarma, bellekAsiyor: Boolean = false): String = buildList {
        add(
            if (d.silinmis > 0) "${d.kayit} kayıt yedeğe yazıldı (${d.silinmis} silinmiş kayıt dahil)."
            else "${d.kayit} kayıt yedeğe yazıldı.",
        )
        if (d.kip == CalismaKipi.BAGLI) add("Eren servisine henüz gitmemiş değişiklikler de yedekte.")
        if (d.okunamayan > 0) add("${d.okunamayan} kayıt bu telefonda okunamadı; yedeğe olduğu gibi kondu.")
        if (d.retYedekte > 0) {
            add("Gönderilemeyenler listesindeki ${d.retYedekte} değişiklik de yedekte; içe aktarılınca o listeye geri gelir.")
        }
        if (d.retListesinde > 0) {
            add("Gönderilemeyenler listesindeki ${d.retListesinde} değişiklik yedeğe girmedi; önce onları düzeltin ya da atın.")
        }
        if (d.iceAktarmaSiniriniAsiyor) add(SINIR_ASIYOR) else if (bellekAsiyor) add(BELLEK_YETMEYEBILIR)
        if (d.bicimSurumu == 2L) add(ESKI_SURUM_ACAMAZ)
    }.joinToString("\n")

    fun onizleme(p: IceAktarmaOnizlemesi, degisti: Boolean): String = buildList {
        if (degisti) add("Önizlemeden sonra telefondaki kayıtlar değişti; plan yenilendi.")
        add("${tarih(p.disaAktarmaMs)} tarihli yedek: ${p.toplam} kayıt.")
        val bagli = p.kip == CalismaKipi.BAGLI
        val satirlar = buildList {
            if (p.yeni > 0) add("• ${p.yeni} yeni kayıt eklenecek")
            if (p.guncellenecek > 0) {
                add("• ${p.guncellenecek} kayıt güncellenecek (yedekteki daha yeni)")
                // Alt sayılar güncellenecek kayıtların içindedir: alt madde, ayrıca sayılmaz.
                if (p.silinecek > 0) {
                    add("   – bunlardan ${p.silinecek} kayıt silinecek (yedekteki daha yeni hali silinmiş)")
                }
                if (p.geriYuklenecek > 0) {
                    add("   – bunlardan ${p.geriYuklenecek} kayıt geri yüklenecek (telefonda silinmiş, yedekteki daha yeni hali geri gelecek)")
                }
                if (p.taslakOnaylanacak > 0) {
                    add(
                        "   – bunlardan ${p.taslakOnaylanacak} taslak onaylanacak (yedekteki hali onaylı; " +
                            (if (bagli) "onay Eren servisine gönderilir, " else "") + "hatırlatması varsa kurulur)",
                    )
                }
                if (p.taslagaDonecek > 0) {
                    add("   – bunlardan ${p.taslagaDonecek} kayıt taslağa dönecek (yedekteki hali onaylanmamış öneri; hatırlatmaları kalkar)")
                }
                if (p.okunamayanRetListesine > 0) {
                    add(
                        "   – bunlardan ${p.okunamayanRetListesine} kayıt telefonda okunamıyor: yedekteki hali yazılacak, " +
                            "telefondaki eski hali gönderilemeyenler listesine düşecek (oradan düzeltilebilir ya da atılabilir)",
                    )
                }
            }
            if (p.ayni > 0) add("• ${p.ayni} kayıt telefondakiyle aynı")
            if (p.atlanacak > 0) add("• ${p.atlanacak} kayıt atlanacak (telefondaki daha yeni)")
            if (p.sinirAsan > 0) add("• ${p.sinirAsan} kayıt sınır dolduğu için eklenemeyecek")
            if (p.gecersiz > 0) add("• ${p.gecersiz} kayıt okunamadı, alınmayacak")
            if (p.taslakGonderilmeyecek > 0) {
                add("• ${p.taslakGonderilmeyecek} taslak alınmayacak (Eren servisi taslak kabul etmez; yedek dosyasında kalır)")
            }
            if (p.gonderilmeyecek > 0) add("• ${p.gonderilmeyecek} silinmiş kayıt Eren servisine gönderilmeyecek")
            if (p.retListesineGelecek > 0) {
                add("• Yedekteki ${p.retListesineGelecek} gönderilemeyen değişiklik gönderilemeyenler listesine eklenecek")
            }
            if (p.retGecersiz > 0) add("• Yedekteki ${p.retGecersiz} gönderilemeyen değişiklik okunamadı, alınmayacak")
            if (p.retBayat > 0) {
                add("• Yedekteki ${p.retBayat} gönderilemeyen değişiklik alınmayacak (kaydı bu telefonda yedekten sonra değişmiş)")
            }
        }
        addAll(satirlar)
        val kayitVar = p.yeni + p.guncellenecek > 0
        when {
            !yapilacakVar(p) -> add("Telefona eklenecek ya da güncellenecek kayıt yok.")
            !kayitVar -> add("Kayıtlar değişmeyecek; yalnız gönderilemeyenler listesine eklenecek.")
            bagli -> add(
                "Değişiklikler Eren servisine ${p.kuyrugaGirecekIslem} işlem olarak gönderilecek; kaydı Eren servisi yapar. " +
                    "Kaynak bilgisi ve zamanlar Eren servisinin olur.",
            )
            else -> add("Kayıtlar bu telefona yazılacak.")
        }
    }.joinToString("\n")

    open fun iceSonucu(p: IceAktarmaOnizlemesi): String = buildList {
        val parcalar = buildList {
            if (p.yeni > 0) add("${p.yeni} yeni kayıt eklendi")
            if (p.guncellenecek > 0) add("${p.guncellenecek} kayıt güncellendi")
        }
        add(if (parcalar.isEmpty()) "Değişen kayıt olmadı." else parcalar.joinToString(", ") + ".")
        if (p.kip == CalismaKipi.BAGLI && p.kuyrugaGirecekIslem > 0) {
            add("${p.kuyrugaGirecekIslem} işlem Eren servisine gönderilmek üzere sıraya alındı.")
        }
        if (p.taslakOnaylanacak > 0) {
            add(
                if (p.kip == CalismaKipi.BAGLI) "${p.taslakOnaylanacak} taslağın onayı Eren servisine gönderilmek üzere sıraya alındı."
                else "${p.taslakOnaylanacak} taslak onaylandı.",
            )
        }
        if (p.taslagaDonecek > 0) add("${p.taslagaDonecek} kayıt taslağa döndü; hatırlatmaları kalktı.")
        if (p.okunamayanRetListesine > 0) {
            add("Telefonda okunamayan ${p.okunamayanRetListesine} kaydın eski hali gönderilemeyenler listesine kondu.")
        }
        if (p.retListesineGelecek > 0) add("${p.retListesineGelecek} değişiklik gönderilemeyenler listesine eklendi.")
        if (p.gecersiz > 0) add("${p.gecersiz} kayıt okunamadığı için alınmadı.")
        if (p.sinirAsan > 0) add("${p.sinirAsan} kayıt sınır dolduğu için eklenmedi.")
        if (p.taslakGonderilmeyecek > 0) add("${p.taslakGonderilmeyecek} taslak alınmadı; Eren servisi taslak kabul etmez.")
        if (p.retGecersiz > 0) add("${p.retGecersiz} gönderilemeyen değişiklik okunamadığı için alınmadı.")
        if (p.retBayat > 0) add("${p.retBayat} gönderilemeyen değişiklik alınmadı; kaydı bu telefonda yedekten sonra değişmişti.")
    }.joinToString("\n")

    fun hata(e: Throwable, yazarken: Boolean): String = when (sorunu(e, yazarken)) {
        AktarmaSorunu.GECERSIZ -> "Bu dosya bir ajanda yedeği değil ya da bozuk."
        AktarmaSorunu.DAHA_YENI -> "Bu yedek uygulamanın daha yeni bir sürümüyle yapılmış. İçe aktarmak için uygulamayı güncelleyin."
        AktarmaSorunu.COK_BUYUK -> COK_BUYUK_METNI
        AktarmaSorunu.BELLEK -> "Dosya çok büyük ya da bozuk; telefonun belleği açmaya yetmedi."
        AktarmaSorunu.BELLEK_BUTCESI -> BELLEK_BUTCESI_METNI
        AktarmaSorunu.EK_BOZUK -> "Yedekteki ek dosyalarından biri bozuk; yedek kullanılamıyor."
        AktarmaSorunu.OKUNAMADI -> "Dosya okunamadı. Yeniden deneyin."
        AktarmaSorunu.YAZILAMADI -> "Dosya yazılamadı. Başka bir yer seçip yeniden deneyin."
        AktarmaSorunu.DEPO -> "Telefondaki kayıt deposu kullanılamadı. Yeniden deneyin."
        AktarmaSorunu.BEKLENMEYEN -> "Beklenmeyen bir sorun oldu. Yeniden deneyin."
    }

    companion object {
        /** Yazılan belge bu sürümün içe aktarma sınırını aşıyor (`DisaAktarma.iceAktarmaSiniriniAsiyor`). */
        const val SINIR_ASIYOR = "Yedek yazıldı, ancak bu uygulama sürümünün içe aktarma sınırını aşıyor; bu sürümle geri yüklenemez."

        /** Yazılan belge sınırın altında ama bu telefonun açma belleğini aşıyor (`YedekKabi.buTelefondaAcmaButcesi`). */
        const val BELLEK_YETMEYEBILIR = "Yedek yazıldı, ancak bu telefonda geri yüklemeye uygulamanın belleği yetmeyebilir; " +
            "daha çok belleği olan bir cihazda açılabilir."

        /** Belge biçim 2 (`DisaAktarma.bicimSurumu`): biçim 1 okuyan eski uygulama dosyayı bütünüyle reddeder. */
        const val ESKI_SURUM_ACAMAZ = "Bu yedek uygulamanın eski sürümleriyle açılamaz; bu ya da daha yeni bir sürümle geri yüklenir."

        /**
         * Biçim sınırı (kap ya da çekirdeğin belge sınırı). Dosya bu uygulamanın kendi yedeği olabilir: dışa aktarma
         * sınırı aşan belgeyi de yazar.
         */
        const val COK_BUYUK_METNI = "Dosya, bu uygulama sürümünün açabileceğinden büyük; açılmadı. Bu uygulamanın büyük bir " +
            "yedeği olabilir (uygulama sınırı aşan yedeği de yazar), ancak bu sürümle geri yüklenemez."

        /** Yığın bütçesi o an yetmedi ([YedekHatasi.BellekYetmez]); dosya bozuk sayılmaz. */
        const val BELLEK_BUTCESI_METNI = "Dosya bu telefonda şu an açılamıyor: uygulamanın ayırabildiği bellek yetmedi. " +
            "Uygulamayı kapatıp yeniden açarak deneyin; yine olmazsa daha çok belleği olan bir cihazda açılabilir."

        /**
         * Uygulanınca bir şey yazılacak mı: kayıt (yeni ya da güncellenecek) ya da ret listesine gelecek girdi
         * (`retListesineGelecek`: kayıtlar aynı olsa da yazılır). Yoksa onay istenmez. Bayat ret girdileri
         * (`retBayat`) yazılmaz: yalnız onlar varsa onay sorulmaz.
         */
        fun yapilacakVar(p: IceAktarmaOnizlemesi): Boolean = p.yeni + p.guncellenecek + p.retListesineGelecek > 0
    }
}
