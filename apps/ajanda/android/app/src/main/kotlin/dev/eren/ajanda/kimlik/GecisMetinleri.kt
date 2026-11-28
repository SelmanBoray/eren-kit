package dev.eren.ajanda.kimlik

import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.GecisNedeni
import dev.eren.ajanda.cekirdek.GecisOzeti
import dev.eren.ajanda.cekirdek.KoparmaSonucu

/** Bir geçişin kullanıcıya söylenecek hali: kısa başlık ve sıfır olmayan sayılardan kurulan satırlar. */
data class GecisMetni(val baslik: String, val satirlar: List<String>) {
    val govde: String get() = satirlar.joinToString("\n")
}

/**
 * D6: bağlantı geçişlerinin kullanıcı metinleri (saf). Kaynaklar `baglantiyiKopar()`'ın [KoparmaSonucu]'u ve
 * `sonGecis()`'in [GecisOzeti]'dir (MIMARI.md "Yerel kip ve veri koruması"). Sayısı sıfır olan bilgi için
 * cümle kurulmaz. Servis "Eren servisi", çalıştığı makine "bilgisayar" diye anılır; "PC" geçmez.
 */
object GecisMetinleri {
    const val KOPARMA_BASLIGI = "Eren servisinden ayrılsın mı?"
    const val KOPAR_DUGMESI = "Bağlantıyı kopar"
    const val VAZGEC_DUGMESI = "Vazgeç"

    private const val KAYITLAR_DURUYOR = "Kayıtlarınız bu telefonda duruyor; uygulama Eren servisi olmadan çalışmayı sürdürüyor."
    /** Yeniden bağlanmada kayıtlar sorulmadan gitmez (D4 birleştirme onayı); servise yeni gidecek taslak hiç gitmez. */
    private const val YEDEK_DURUYOR = "Eren servisindeki kopya yedek olarak duruyor. Yeniden bağlanırsanız telefondaki değişiklikler sorulmadan " +
        "gönderilmez; birleştirmeyi onaylarsanız (Eren servisinde olmayan taslaklar hariç) oraya gider."

    /**
     * Koparmadan önceki onay. `kuyrukta`: `baglantiDurumu().kuyrukta` (henüz gönderilmemiş işlem); okunamadıysa
     * `null` (sayısız genel cümle).
     */
    fun koparmaOnayi(kuyrukta: Int?): GecisMetni = GecisMetni(
        KOPARMA_BASLIGI,
        buildList {
            add("Kayıtlarınız bu telefonda kalır; uygulama Eren servisi olmadan çalışmayı sürdürür.")
            when {
                kuyrukta == null -> add("Henüz gönderilmemiş değişiklikler telefonda kalır ama Eren servisine gitmez.")
                kuyrukta > 0 -> add("$kuyrukta değişiklik henüz Eren servisine gitmedi; telefonda kalır ama servise gönderilmez.")
            }
            add("Eren servisindeki kopya yedek olarak durur. Yeniden bağlanmak için bilgisayarda yeni kod gerekir.")
        },
    )

    /** `baglantiyiKopar()` döndükten hemen sonra gösterilecek sonuç. */
    fun koparma(s: KoparmaSonucu): GecisMetni = when (s.oncekiKip) {
        CalismaKipi.BAGLI -> GecisMetni("Eren servisinden ayrıldı", ayrilmaSatirlari(s))
        CalismaKipi.YEREL ->
            if (s.baglanmaIptal) {
                GecisMetni("Bağlanma durduruldu", listOf("Eren servisine bağlanma durduruldu; kayıtlarınıza dokunulmadı."))
            } else {
                GecisMetni("Bağlı değil", listOf("Bu telefon bir Eren servisine bağlı değil; değişen bir şey olmadı."))
            }
    }

    /** `sonGecis()`'in söylediği: ne oldu, telefonda ne kaldı, servis tarafında ne duruyor. */
    fun gecis(g: GecisOzeti): GecisMetni = when (g.neden) {
        GecisNedeni.KOPARMA -> GecisMetni("Eren servisinden ayrıldı", ayrilmaSatirlari(g.koparma))
        GecisNedeni.ESLESME_KALDIRILDI -> GecisMetni("Eşleşme kaldırıldı", ayrilmaSatirlari(g.koparma))
        GecisNedeni.DEPO_DEGISTI -> GecisMetni("Başka bir Eren servisi", depoDegistiSatirlari(g.koparma))
    }

    /**
     * Geçiş bildirimi gösterilmeli mi: `sonGecis()` kalıcıdır (sonraki geçiş üstüne yazar), bu yüzden arayüz
     * gösterdiği geçişin `tsMs`'ini saklar ve yalnız yenisini gösterir.
     */
    fun gosterilmeli(g: GecisOzeti?, gosterilenTsMs: Long?): Boolean = g != null && g.tsMs != gosterilenTsMs

    private const val UYGULAMAYI_ACIN = "Uygulamayı açtığınızda yeniden bağlanır; gönderilecek bir şey varsa birleştirmeyi size sorar."

    /**
     * Arka plan eşitlemesi yerel kipte eşleşme varken durdu (`ArkaPlanSonucu.YEREL_KIP`): bildirim metni.
     * [birlestirmeBekliyor]: `birlestirmeOnizlemesi()` dolu (onay gerçekten bekleniyor); yalnız o zaman "onayınızı
     * bekliyor" denir. Öteki durumlarda arka planda bağlanılmadığı ve uygulama açılınca ne olacağı söylenir
     * (D4: gidecek bir şey yoksa soru sorulmadan eşitlenir).
     */
    fun duraklama(g: GecisOzeti, birlestirmeBekliyor: Boolean): GecisMetni = when {
        birlestirmeBekliyor -> GecisMetni(
            "Birleştirme onayınızı bekliyor",
            listOf(
                "Eren servisiyle eşitleme, birleştirmeyi onaylayana ya da vazgeçene dek duruyor.",
                "Kayıtlarınız bu telefonda duruyor; onaylamadan servise gönderilmez.",
            ),
        )
        g.neden == GecisNedeni.DEPO_DEGISTI -> GecisMetni(
            "Eşitleme durdu",
            listOf(
                "Bu telefonun bağlandığı Eren servisi değişti; arka planda eşitleme yapılmıyor.",
                "Kayıtlarınız bu telefonda duruyor ve sorulmadan yeni servise gönderilmez.",
                UYGULAMAYI_ACIN,
            ),
        )
        else -> GecisMetni(
            "Eşitleme durdu",
            listOf(
                "Eren servisine yeniden bağlanma tamamlanmadı; arka planda eşitleme yapılmıyor.",
                "Kayıtlarınız bu telefonda duruyor.",
                UYGULAMAYI_ACIN,
            ),
        )
    }

    private fun ayrilmaSatirlari(s: KoparmaSonucu): List<String> = buildList {
        add(KAYITLAR_DURUYOR)
        gonderilmeyen(s)?.let { add("$it Eren servisine gönderilmeden ayrıldı ama bu telefonda duruyor.") }
        yanitsiz(s)?.let(::add)
        add(YEDEK_DURUYOR)
        ret(s)?.let(::add)
        okunamayan(s)?.let(::add)
    }

    private fun depoDegistiSatirlari(s: KoparmaSonucu): List<String> = buildList {
        add(
            "Bu telefonun bağlandığı Eren servisi değişti. Kayıtlarınız bu telefonda duruyor; yeni servise sorulmadan " +
                "gönderilmez, birleştirmeyi onaylarsanız (orada olmayan taslaklar hariç) oraya gider.",
        )
        gonderilmeyen(s)?.let { add("$it önceki Eren servisine gönderilmeden kaldı; bu telefonda duruyor, birleştirmeyi onaylarsanız yeni servise gider.") }
        yanitsiz(s, "önceki Eren servisine")?.let(::add)
        add(
            "Önceki Eren servisindeki kopya olduğu gibi duruyor. Ona yeniden bağlanıp birleştirmeyi onaylarsanız bu telefondaki " +
                "kayıtlar, yeni servisten gelenler dahil, oraya da gönderilir.",
        )
        ret(s)?.let(::add)
        okunamayan(s)?.let(::add)
    }

    /** "N değişiklik" ya da "N değişiklik (M kayıtta)"; hiç yoksa `null`. */
    private fun gonderilmeyen(s: KoparmaSonucu): String? {
        val islem = s.gonderilmeyenIslem
        val kayit = s.gonderilmeyenKayit
        return when {
            islem <= 0 && kayit <= 0 -> null
            islem <= 0 -> "$kayit kayıttaki değişiklik"
            kayit <= 0 || kayit == islem -> "$islem değişiklik"
            else -> "$islem değişiklik ($kayit kayıtta)"
        }
    }

    private fun yanitsiz(s: KoparmaSonucu, servise: String = "Eren servisine"): String? {
        val n = s.yanitsizIslem
        return when {
            n <= 0 -> null
            n >= s.gonderilmeyenIslem -> "Bunlar gönderilmişti ama yanıtı gelmedi; $servise ulaşmış olabilir."
            else -> "Bunlardan $n tanesi gönderilmişti ama yanıtı gelmedi; $servise ulaşmış olabilir."
        }
    }

    private fun okunamayan(s: KoparmaSonucu): String? =
        if (s.okunamayanPcTemeli > 0) {
            "${s.okunamayanPcTemeli} kaydın Eren servisindeki hali okunamadı; yeniden bağlanıp birleştirmeyi onaylarsanız " +
                "telefondaki farklı her alan servise gönderilir."
        } else null

    private fun ret(s: KoparmaSonucu): String? =
        if (s.retListesinde > 0) "Gönderilemeyenler listesindeki ${s.retListesinde} değişiklik yerinde duruyor." else null
}
