package dev.eren.ajanda.aktarma

import dev.eren.ajanda.ag.Gunluk
import dev.eren.ajanda.cekirdek.AktarmaBicimi
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.DisaAktarma
import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.time.ZoneId
import java.util.zip.ZipInputStream

/**
 * SAHİBİ: D6. Bir otomatik yedek denemesi (saf; Android'e dokunan kısım [YedekKlasoru],
 * [YedekAyarDeposu] ve [YedekBildiricisi] arkasında). Sahiplik ve ad kuralları [OtomatikYedekPlani]'nda:
 * yalnız bu kurulumun ([kurulum]) yazdığı dosyalara dokunulur. Akış:
 * 1. Klasörü listele (erişim burada denetlenir). Önceki denemeden yarım kalmış doğrudan yazım
 *    ([YedekDurumu.yarimYazim]) ve bu kurulumun artık geçici dosyaları silinir.
 * 2. Yeni ad (`ajanda-otomatik-yedek-<gün>-<SSddss>-<kurulum>.zip`; klasörde varsa saniye ilerler) +
 *    `.yaziliyor` oluşturulur, `disaAktar()` belgesi D3'ün kabıyla ([YedekKabi]) yazılır, kapanınca **geri
 *    okunup doğrulanır** (zip girdilerinin CRC'si, belgenin bayt boyu, ek sayısı). Hata olursa yarım dosya silinir.
 * 3. Geçici son ada çevrilir. Sağlayıcı yeniden adlandırmayı desteklemiyorsa (ya da başka ad verirse) sağlam
 *    geçici **tutulur**, ad [YedekDurumu.yarimYazim]'a yazılır, son ad doğrudan yazılıp doğrulanır; ancak sonra
 *    geçici silinir ve iz temizlenir.
 * 4. Eski yedekler yeni yedek doğrulandıktan sonra temizlenir ([OtomatikYedekPlani.silinecekler]; hatası
 *    yedeği düşürmez, günlüğe yazılır). Aynı günün eski dosyası da böylece, yenisi yerindeyken silinir.
 * 5. Sonuç [YedekAyarDeposu]'na yazılır; arka plan denemesinde söylenecek bir şey varsa
 *    ([OtomatikYedekPlani.soylenecek]) bildirilir, gösterilebildiyse "söylendi" diye işaretlenir.
 *
 * İş parçacığı: eşzamanlıdır, çekirdeği çağırır; ana iş parçacığından çağrılmaz. Aynı anda tek deneme
 * (`@Synchronized`). Mahremiyet: dosya içeriği günlüğe ve bildirime girmez; günlükte yalnız hata sınıfı ve sorun türü.
 */
class OtomatikYedekci(
    private val kaynak: YedekKaynagi,
    private val klasorAc: (String) -> YedekKlasoru,
    private val ayarlar: YedekAyarDeposu,
    private val saat: () -> Long,
    private val dilim: () -> ZoneId,
    private val gunluk: Gunluk,
    /** Bu kurulumun kimliği (8 küçük hex; `OtomatikYedekPlani.kurulumGecerli`). */
    private val kurulum: () -> String,
    private val bildirici: YedekBildiricisi = YedekBildiricisi.Yok,
    private val depo: EkDeposu = EkDeposu.Yok,
) {
    /** Arka plan işi: zamanı geldiyse yedekle; söylenecek bir şey varsa bildir. */
    @Synchronized
    fun gerekirseYedekle(): YedekSonucu {
        val d = ayarlar.oku()
        if (!OtomatikYedekPlani.zamaniGeldiMi(d, saat(), dilim())) return YedekSonucu.Gerekmedi
        return dene(d, arkaPlan = true)
    }

    /**
     * "Şimdi yedekle": gün ve açık/kapalı denetimi yok; klasör gerekir. Sonucu kullanıcı ekranda görür
     * (`OtomatikYedekMetinleri.sonuc`): sorun ve sınır uyarısı "söylendi" sayılır, bildirim gösterilmez.
     */
    @Synchronized
    fun simdiYedekle(): YedekSonucu = dene(ayarlar.oku(), arkaPlan = false)

    private fun dene(d: YedekDurumu, arkaPlan: Boolean): YedekSonucu {
        val simdi = saat()
        val sonuc = try {
            val klasor = d.klasor?.let(klasorAc) ?: throw KlasorYok()
            yaz(klasor, simdi)
        } catch (e: Exception) {
            YedekSonucu.Basarisiz(sorunu(e)).also { gunluk.uyari("otomatik yedek olmadı: ${it.sorun}", e) }
        } catch (e: OutOfMemoryError) {
            YedekSonucu.Basarisiz(YedekSorunu.BELLEK).also { gunluk.uyari("otomatik yedek olmadı: bellek", null) }
        } catch (e: LinkageError) {
            // Yerel kitaplık yüklenemedi.
            YedekSonucu.Basarisiz(YedekSorunu.CEKIRDEK).also { gunluk.uyari("otomatik yedek olmadı: çekirdek", e) }
        }
        try {
            when (sonuc) {
                // Deneme sürerken klasör değiştiyse eski klasörün başarısı yenisine yazılmaz.
                is YedekSonucu.Yapildi -> ayarlar.degistir { if (it.klasor == d.klasor) it.basariliOldu(simdi, sonuc) else it }
                is YedekSonucu.Basarisiz -> ayarlar.degistir { if (it.klasor == d.klasor) it.basarisizOldu(simdi, sonuc.sorun) else it }
                YedekSonucu.Gerekmedi -> Unit
            }
        } catch (e: Exception) {
            gunluk.uyari("yedek sonucu saklanamadı", e)
        }
        soyle(sonuc, arkaPlan, simdi)
        return sonuc
    }

    /** Arka planda: söylenecek varsa bildir. Önde: sonuç ekranda görüldü, söylendi say. */
    private fun soyle(sonuc: YedekSonucu, arkaPlan: Boolean, simdi: Long) {
        try {
            if (sonuc is YedekSonucu.Yapildi) bildirici.kaldir()
            if (!arkaPlan) {
                val b = when {
                    sonuc is YedekSonucu.Basarisiz -> YedekBildirimi.Sorun(sonuc.sorun)
                    sonuc is YedekSonucu.Yapildi && sonuc.sinirAsiyor -> YedekBildirimi.SinirAsiyor
                    else -> null
                }
                if (b != null) ayarlar.degistir { it.bildirildi(b) }
                return
            }
            val d = ayarlar.oku()
            val b = OtomatikYedekPlani.soylenecek(d, simdi) ?: return
            val (baslik, metin) = OtomatikYedekMetinleri(dilim()).bildirim(b, OtomatikYedekPlani.gunOnce(d, simdi, dilim()))
            if (bildirici.goster(baslik, metin)) ayarlar.degistir { it.bildirildi(b) }
        } catch (e: Exception) {
            gunluk.uyari("yedek bildirimi gösterilemedi", e)
        }
    }

    private fun yaz(klasor: YedekKlasoru, simdi: Long): YedekSonucu {
        val k = kurulum()
        if (!OtomatikYedekPlani.kurulumGecerli(k)) throw IllegalStateException("kurulum kimliği geçersiz")
        val once = klasor.listele()
        yarimYazimiTemizle(klasor, once, k)
        for (g in once.filter { OtomatikYedekPlani.geciciMi(it.ad, k) }) sessizSil(klasor, g)

        val bicim = kaynak.bicim()
        val disa = kaynak.disaAktar()
        val hedef = OtomatikYedekPlani.bosAd(simdi, dilim(), k, once.map { it.ad }.toSet())
        val beklenen = Beklenen(utf8Boyu(disa.belge), disa.ekler.distinctBy { it.ozet }.size)

        val gecici = klasor.olustur(OtomatikYedekPlani.geciciAd(hedef), GECICI_MIME)
        yazVeyaSil(klasor, gecici, bicim, disa, beklenen)
        val adlanan = klasor.yenidenAdlandir(gecici, hedef)
        if (adlanan?.ad != hedef) {
            // Desteklenmiyor ya da sağlayıcı başka ad verdi. Sağlam geçici son yazım doğrulanana dek kalır;
            // süreç arada ölürse iz sonraki denemede yarım son dosyayı siler.
            val saglam = adlanan ?: gecici
            ayarlar.degistir { it.copy(yarimYazim = hedef) }
            val son = klasor.olustur(hedef, AktarmaAkisi.MIME)
            if (son.ad != hedef) {
                sessizSil(klasor, son)
                throw IOException("sağlayıcı yedeğe başka ad verdi")
            }
            yazVeyaSil(klasor, son, bicim, disa, beklenen)
            ayarlar.degistir { it.copy(yarimYazim = null) }
            sessizSil(klasor, saglam)
        }

        var silinen = 0
        try {
            val bugun = OtomatikYedekPlani.gun(simdi, dilim())
            for (f in OtomatikYedekPlani.silinecekler(klasor.listele(), k, bugun, koru = hedef)) {
                if (klasor.sil(f)) silinen++
            }
        } catch (e: Exception) {
            gunluk.uyari("eski yedekler temizlenemedi", e)
        }
        return YedekSonucu.Yapildi(hedef, disa.kayit.toLong(), silinen, disa.retListesinde, disa.iceAktarmaSiniriniAsiyor)
    }

    /** Önceki denemenin doğrulanmamış doğrudan yazımı (yalnız bu kurulumun adıysa) silinir; silinince iz kalkar. */
    private fun yarimYazimiTemizle(klasor: YedekKlasoru, dosyalar: List<KlasorDosyasi>, k: String) {
        val ad = ayarlar.oku().yarimYazim ?: return
        val kalan = if (OtomatikYedekPlani.yedekAni(ad, k) == null) emptyList()
        else dosyalar.filter { it.ad == ad }.filterNot { sessizSil(klasor, it) }
        if (kalan.isEmpty()) ayarlar.degistir { if (it.yarimYazim == ad) it.copy(yarimYazim = null) else it }
    }

    private fun yazVeyaSil(klasor: YedekKlasoru, d: KlasorDosyasi, bicim: AktarmaBicimi, disa: DisaAktarma, b: Beklenen) {
        try {
            klasor.yazmaAc(d).use { YedekKabi.yaz(it, bicim, disa, depo) }
            klasor.okumaAc(d).use { dogrula(it, bicim, b) }
        } catch (t: Throwable) {
            sessizSil(klasor, d)
            throw t
        }
    }

    /** Döner: silindi mi (hata günlüğe yazılır, atılmaz). */
    private fun sessizSil(klasor: YedekKlasoru, d: KlasorDosyasi): Boolean = try {
        klasor.sil(d)
    } catch (e: Exception) {
        gunluk.uyari("yedek klasöründe dosya silinemedi", e)
        false
    }

    private class KlasorYok : IOException("klasör seçilmedi")

    /** Yazılan dosya geri okunduğunda beklenenle tutmadı. */
    internal class Dogrulanamadi(neden: String) : IOException(neden)

    /** Geri okumada beklenen: belgenin UTF-8 bayt boyu ve ek dosyası sayısı. */
    private class Beklenen(val belge: Long, val ek: Int)

    companion object {
        const val GECICI_MIME = "application/octet-stream"

        internal fun sorunu(e: Throwable): YedekSorunu = when {
            e is KlasorYok -> YedekSorunu.KLASOR_YOK
            e is KlasorErisimiYok || e is SecurityException -> YedekSorunu.ERISIM_YOK
            yerYok(e) -> YedekSorunu.YER_YOK
            e is YedekHatasi.CokBuyuk -> YedekSorunu.COK_BUYUK
            e is YedekHatasi.EkBozuk -> YedekSorunu.EK_BOZUK
            e is Dogrulanamadi -> YedekSorunu.DOGRULANAMADI
            e is CekirdekHatasi -> YedekSorunu.CEKIRDEK
            e is IOException -> YedekSorunu.YAZILAMADI
            else -> YedekSorunu.BEKLENMEYEN
        }

        /**
         * Kabı akışla geri okur (bellekte tutmadan): her girdi sonuna dek okunur (`ZipInputStream` CRC'yi orada
         * denetler), belge girdisi tek ve boyu [b]'deki gibi, ek dosyası sayısı tutmalı. Bozuk zip, kesik dosya ya
         * da okuma hatası [Dogrulanamadi]; erişim hatası olduğu gibi geçer.
         */
        private fun dogrula(giris: InputStream, bicim: AktarmaBicimi, b: Beklenen) {
            var belge = -1L
            var ek = 0
            try {
                val z = ZipInputStream(BufferedInputStream(giris, 64 * 1024))
                val tampon = ByteArray(64 * 1024)
                while (true) {
                    val g = z.nextEntry ?: break
                    var n = 0L
                    while (true) {
                        val r = z.read(tampon)
                        if (r < 0) break
                        n += r
                    }
                    when {
                        g.name == bicim.belgeAdi -> {
                            if (belge >= 0) throw Dogrulanamadi("belge yinelenmiş")
                            belge = n
                        }
                        !g.isDirectory -> ek++
                    }
                }
            } catch (e: Dogrulanamadi) {
                throw e
            } catch (e: KlasorErisimiYok) {
                throw e
            } catch (e: IOException) {
                throw Dogrulanamadi("geri okunamadı")
            } catch (e: IllegalArgumentException) {
                throw Dogrulanamadi("geri okunamadı")
            }
            if (belge != b.belge) throw Dogrulanamadi("belge boyu tutmuyor")
            if (ek != b.ek) throw Dogrulanamadi("ek sayısı tutmuyor")
        }

        /** `YedekKabi`'nın yazdığı UTF-8 boyu: eşsiz vekil `?` (1 bayt) olur. */
        internal fun utf8Boyu(s: String): Long {
            var n = 0L
            var i = 0
            while (i < s.length) {
                val c = s[i]
                n += when {
                    c.code < 0x80 -> 1
                    c.code < 0x800 -> 2
                    Character.isHighSurrogate(c) && i + 1 < s.length && Character.isLowSurrogate(s[i + 1]) -> { i++; 4 }
                    Character.isSurrogate(c) -> 1
                    else -> 3
                }
                i++
            }
            return n
        }

        /** `ENOSPC`: Android'de `IOException` ("write failed: ENOSPC ...") ya da nedeni `ErrnoException`. */
        private fun yerYok(e: Throwable): Boolean =
            generateSequence(e) { it.cause }.take(8).any { h ->
                val m = h.message ?: return@any false
                m.contains("ENOSPC") || m.contains("No space left", ignoreCase = true)
            }
    }
}

/** Yedeğin kaynağı: çekirdeğin `aktarmaBicimi()` ve `disaAktar()`'ı (üretimde UniFFI; testte sahte). */
interface YedekKaynagi {
    fun bicim(): AktarmaBicimi
    fun disaAktar(): DisaAktarma
}

/**
 * Yedek klasörü (üretimde SAF ağacı, `SafYedekKlasoru`; testte bellekte). Erişim yoksa (izin geri
 * alınmış, klasör silinmiş) [KlasorErisimiYok] atar.
 */
interface YedekKlasoru {
    /** Klasörün doğrudan çocukları (dosyalar). */
    fun listele(): List<KlasorDosyasi>

    /** Boş dosya oluşturur; sağlayıcı adı değiştirebilir (dönen [KlasorDosyasi.ad] gerçek addır). */
    fun olustur(ad: String, mime: String): KlasorDosyasi

    fun yazmaAc(d: KlasorDosyasi): OutputStream

    /** Yazılanı doğrulamak için geri okuma. */
    fun okumaAc(d: KlasorDosyasi): InputStream

    /** Döner: silindi mi. */
    fun sil(d: KlasorDosyasi): Boolean

    /** Döner: yeni haliyle dosya (sağlayıcı adı değiştirmiş olabilir); `null`: desteklenmiyor ya da olmadı. */
    fun yenidenAdlandir(d: KlasorDosyasi, yeniAd: String): KlasorDosyasi?
}

/** İzin geri alınmış ya da klasör yok. */
class KlasorErisimiYok(neden: String) : IOException(neden)

/**
 * Otomatik yedeğin kalıcı ayarı ve son sonucu (üretimde platform `SharedPreferences`). Geçişler
 * [YedekDurumu]'nun saf yöntemleriyle yapılır; depo yalnız saklar.
 */
interface YedekAyarDeposu {
    fun oku(): YedekDurumu

    /** Oku-değiştir-yaz, süreç genelinde tek kilit altında (ekran ve yedek iş parçacığı yarışmasın). */
    fun degistir(f: (YedekDurumu) -> YedekDurumu)
}

/**
 * Yedek durum bildirimi (üretimde `Bildirimler` durum kanalı). `goster` `false`: gösterilemedi (bildirim izni
 * ya da kanal kapalı); durum saklı kalır, uygulama açılınca `YedekGorunumu.soylenmemis` ile gösterilir.
 */
interface YedekBildiricisi {
    fun goster(baslik: String, metin: String): Boolean

    /** Başarılı yedekten sonra eski sorun bildirimini kaldırır. */
    fun kaldir()

    object Yok : YedekBildiricisi {
        override fun goster(baslik: String, metin: String) = false
        override fun kaldir() = Unit
    }
}
