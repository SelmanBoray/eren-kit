package dev.eren.ajanda.aktarma

import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.EkDosyasi
import dev.eren.ajanda.cekirdek.IceAktarmaOnizlemesi
import dev.eren.ajanda.ekran.CekirdekYuzu
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.time.LocalDate

/**
 * SAHİBİ: D3. Dışa ve içe aktarma akışı (saf; görünüm yalnız [Adim]'ı gösterir ve düğmeleri iletir).
 *
 * - Dışa: [disaAktar] çekirdekten belgeyi alır, kaba yazar; sonuç metni.
 * - İçe: [dosyaOku] kabı okur, önizlemeyi ister ([Adim.Onay]) -> [onayla] ekleri yerleştirir, `iceAktar`
 *   çağırır; telefon önizlemeden sonra değiştiyse yeni planla yeniden [Adim.Onay], değilse [Adim.Bilgi].
 *   [vazgec] bekleyen dosyayı bırakır. [Adim.Onay] gösterilen planın izini taşır; görünüm onu [onayla]'ya geri
 *   verir: onay o izle yapılır (ekranda eski plan kaldıysa çekirdek uygulamaz, yeni planla yeniden sorulur), aynı
 *   adımla ikinci onay (çift dokunma) çekirdeğe gitmez, ilk onayın sonucunu yeniden döner. Uygulandıktan sonra
 *   sonuç metni kurulamazsa da "içe aktarıldı" denir.
 *
 * İş parçacığı: bütün yöntemler eşzamanlıdır, çekirdeği çağırır; ana iş parçacığından çağrılmaz. Her iş
 * parçacığından çağrılabilir: durum ve çekirdek çağrıları tek kilit altında sıralanır. Her [Exception] ve [OutOfMemoryError] (dev ya da bozuk dosya;
 * "çok büyük ya da bozuk" denir, bekleyen dosya bırakılır) bir [Adim.Hata]'ya çevrilir. Başka [Error]'lar
 * (ör. `StackOverflowError`, `LinkageError`) yakalanmaz, çağırana çıkar.
 * Mahremiyet: dosya içeriği hiçbir günlüğe yazılmaz; metinler yalnız sayı ve tarih taşır.
 */
class AktarmaAkisi(
    private val c: CekirdekYuzu,
    private val metinler: AktarmaMetinleri,
    private val depo: EkDeposu = EkDeposu.Yok,
) {
    /** Görünümün göstereceği adım. */
    sealed class Adim {
        abstract val baslik: String
        abstract val metin: String

        /** Onay iste: olumlu düğme [onayla]`(bu)`, olumsuz [vazgec]. [iz]: gösterilen planın izi (gösterilmez). */
        data class Onay(override val baslik: String, override val metin: String, val dugme: String, val iz: String = "") : Adim()

        /** Bilgi (sonuç ya da yapılacak bir şey yok); tek "Tamam". */
        data class Bilgi(override val baslik: String, override val metin: String) : Adim()

        /** Hata; tek "Tamam". */
        data class Hata(override val baslik: String, override val metin: String) : Adim()
    }

    /** [ekler]: dosyanın taşıdığı ekler (dosyadan gelir, telefonun haline bağlı değil). */
    private class Bekleyen(val okunan: YedekKabi.Okunan, val iz: String, val ekler: List<EkDosyasi>)

    private val kilit = Any()

    @Volatile
    private var bekleyen: Bekleyen? = null

    /** Son uygulanan içe aktarmanın izi ve sonucu (aynı adımla gelen ikinci onay için). */
    private var uygulanan: Pair<String, Adim.Bilgi>? = null

    /**
     * Dışa aktarır ve [ac]'ın verdiği akışa yazar (akış burada kapatılır). Başarısızlıkta [basarisizsa]
     * çağrılır (yarım dosyayı silmek için; hatası yutulur).
     */
    fun disaAktar(ac: () -> OutputStream, basarisizsa: () -> Unit = {}): Adim = synchronized(kilit) {
        try {
            val bicim = c.aktarmaBicimi()
            val disa = c.disaAktar()
            ac().use { YedekKabi.yaz(it, bicim, disa, depo) }
            Adim.Bilgi(metinler.disaBaslik, metinler.disaSonucu(disa))
        } catch (e: Exception) {
            runCatching(basarisizsa)
            Adim.Hata(metinler.disaHataBaslik, metinler.hata(e, yazarken = true))
        } catch (e: OutOfMemoryError) {
            runCatching(basarisizsa)
            Adim.Hata(metinler.disaHataBaslik, metinler.hata(e, yazarken = true))
        }
    }

    /** Seçilen dosyayı okur ([ac]'ın akışı burada kapatılır) ve önizlemeyi döner. */
    fun dosyaOku(ac: () -> InputStream): Adim = synchronized(kilit) {
        bekleyen = null
        try {
            val bicim = c.aktarmaBicimi()
            val okunan = ac().use { YedekKabi.oku(it, bicim) }
            val plan = c.iceAktarmaOnizlemesi(okunan.belge)
            // Kaptaki ekler planınkilerle birebir tutmalı (fazlası beklenmeyen girdidir).
            if (okunan.ekler.keys.any { o -> plan.ekler.none { it.ozet == o } }) throw YedekHatasi.GecersizDosya("belgede olmayan ek")
            onizlemeAdimi(okunan, plan, degisti = false)
        } catch (e: Exception) {
            Adim.Hata(metinler.iceHataBaslik, metinler.hata(e, yazarken = false))
        } catch (e: OutOfMemoryError) {
            // Okunan kap yereldedir, burada bırakılır; süreç düşmez.
            Adim.Hata(metinler.iceHataBaslik, metinler.hata(e, yazarken = false))
        }
    }

    /**
     * Kullanıcı [adim]'daki önizlemeyi onayladı; onay o adımın iziyle yapılır. `null` (eski görünüm): bekleyen
     * planın iziyle.
     */
    fun onayla(adim: Adim.Onay? = null): Adim = synchronized(kilit) {
        val u = uygulanan
        if (adim != null && u != null && adim.iz == u.first) return u.second
        val b = bekleyen ?: return Adim.Hata(metinler.iceHataBaslik, metinler.bekleyenYok)
        val iz = adim?.iz?.takeIf { it.isNotEmpty() } ?: b.iz
        val s = try {
            val bicim = c.aktarmaBicimi()
            YedekKabi.ekleriYerlestir(b.ekler, b.okunan, bicim, depo)
            c.iceAktar(b.okunan.belge, iz)
        } catch (e: Exception) {
            bekleyen = null
            return Adim.Hata(metinler.iceHataBaslik, metinler.hata(e, yazarken = false))
        } catch (e: OutOfMemoryError) {
            bekleyen = null
            return Adim.Hata(metinler.iceHataBaslik, metinler.hata(e, yazarken = false))
        }
        if (s.uygulandi) {
            // Yazıldı: bundan sonraki hiçbir hata "yapılamadı" diye söylenmez.
            bekleyen = null
            val metin = try {
                metinler.iceSonucu(s.plan)
            } catch (_: Exception) {
                metinler.iceSonucuKisa
            }
            return Adim.Bilgi(metinler.iceSonucBaslik, metin).also { uygulanan = iz to it }
        }
        try {
            onizlemeAdimi(b.okunan, s.plan, degisti = true)
        } catch (e: Exception) {
            bekleyen = null
            Adim.Hata(metinler.iceHataBaslik, metinler.hata(e, yazarken = false))
        }
    }

    fun vazgec() = synchronized(kilit) {
        bekleyen = null
    }

    /** Onay bekleyen dosya var mı (görünüm yeniden kurulunca). */
    val onayBekliyor: Boolean get() = bekleyen != null

    private fun onizlemeAdimi(okunan: YedekKabi.Okunan, plan: IceAktarmaOnizlemesi, degisti: Boolean): Adim {
        val metin = metinler.onizleme(plan, degisti)
        return if (plan.yeni + plan.guncellenecek == 0) {
            bekleyen = null
            Adim.Bilgi(metinler.iceBaslik, metin)
        } else {
            bekleyen = Bekleyen(okunan, plan.iz, plan.ekler)
            Adim.Onay(if (degisti) metinler.degistiBaslik else metinler.iceBaslik, metin, metinler.onayDugmesi, plan.iz)
        }
    }

    companion object {
        /** Sistem dosya seçicisine önerilen ad (`ajanda-yedegi-2026-11-27.zip`). */
        fun onerilenAd(gun: LocalDate): String = "ajanda-yedegi-$gun.zip"

        const val MIME = "application/zip"
    }
}

/** Hata sınıfının kullanıcı metnine eşlemi için ara sınıf (saf). */
internal enum class AktarmaSorunu { GECERSIZ, DAHA_YENI, COK_BUYUK, BELLEK, EK_BOZUK, OKUNAMADI, YAZILAMADI, DEPO, BEKLENMEYEN }

internal fun sorunu(e: Throwable, yazarken: Boolean): AktarmaSorunu = when (e) {
    is OutOfMemoryError -> AktarmaSorunu.BELLEK
    is YedekHatasi.CokBuyuk -> AktarmaSorunu.COK_BUYUK
    is YedekHatasi.EkBozuk -> AktarmaSorunu.EK_BOZUK
    is YedekHatasi.GecersizDosya -> AktarmaSorunu.GECERSIZ
    is CekirdekHatasi.GecersizGirdi -> when {
        e.alan == "bicim_surumu" || e.alan == "sozlesme_surumu" -> AktarmaSorunu.DAHA_YENI
        e.alan == "belge" && e.neden == "çok büyük" -> AktarmaSorunu.COK_BUYUK
        else -> AktarmaSorunu.GECERSIZ
    }
    is CekirdekHatasi.Depo -> AktarmaSorunu.DEPO
    is IOException -> if (yazarken) AktarmaSorunu.YAZILAMADI else AktarmaSorunu.OKUNAMADI
    is SecurityException -> if (yazarken) AktarmaSorunu.YAZILAMADI else AktarmaSorunu.OKUNAMADI
    else -> AktarmaSorunu.BEKLENMEYEN
}
