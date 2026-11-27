package dev.eren.ajanda.aktarma

import dev.eren.ajanda.ag.Gunluk
import dev.eren.ajanda.cekirdek.AktarmaBicimi
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.DisaAktarma
import java.io.IOException
import java.io.OutputStream
import java.time.ZoneId

/**
 * SAHİBİ: D6. Bir otomatik yedek denemesi (saf; Android'e dokunan kısım [YedekKlasoru] ve
 * [YedekAyarDeposu] arkasında). Akış:
 * 1. Klasörü listele (erişim burada denetlenir); artık geçici dosyaları sil.
 * 2. `<gün>.zip.yaziliyor` oluştur, `disaAktar()` belgesini D3'ün kabıyla ([YedekKabi]) yaz; hata olursa
 *    yarım dosyayı sil.
 * 3. Aynı günün eski dosyası varsa sil, geçiciyi `<gün>.zip` adına çevir. Sağlayıcı yeniden adlandırmayı
 *    desteklemiyorsa geçici silinir ve son ad doğrudan yazılır (yine hata olursa silinir).
 * 4. Kalıba uyan yedeklerden en yeni [OtomatikYedekPlani.TUTULAN] tanesi dışındakileri sil (hatası yedeği
 *    düşürmez, günlüğe yazılır).
 * 5. Sonucu [YedekAyarDeposu]'na yaz: başarıda an ve dosya, hatada [YedekSorunu] ve an.
 *
 * İş parçacığı: eşzamanlıdır, çekirdeği çağırır; ana iş parçacığından çağrılmaz. Aynı anda tek deneme
 * (`@Synchronized`). Mahremiyet: dosya içeriği günlüğe girmez; günlükte yalnız hata sınıfı ve sorun türü.
 */
class OtomatikYedekci(
    private val kaynak: YedekKaynagi,
    private val klasorAc: (String) -> YedekKlasoru,
    private val ayarlar: YedekAyarDeposu,
    private val saat: () -> Long,
    private val dilim: () -> ZoneId,
    private val gunluk: Gunluk,
    private val depo: EkDeposu = EkDeposu.Yok,
) {
    /** Periyodik iş: zamanı geldiyse yedekle. */
    @Synchronized
    fun gerekirseYedekle(): YedekSonucu {
        val d = ayarlar.oku()
        if (!OtomatikYedekPlani.zamaniGeldiMi(d, saat(), dilim())) return YedekSonucu.Gerekmedi
        return dene(d)
    }

    /** "Şimdi yedekle": gün ve açık/kapalı denetimi yok; klasör gerekir. */
    @Synchronized
    fun simdiYedekle(): YedekSonucu = dene(ayarlar.oku())

    private fun dene(d: YedekDurumu): YedekSonucu {
        val simdi = saat()
        val sonuc = try {
            val klasor = d.klasor?.let(klasorAc) ?: throw KlasorYok()
            yaz(klasor, OtomatikYedekPlani.gun(simdi, dilim()))
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
                is YedekSonucu.Yapildi -> ayarlar.basarili(simdi, sonuc.dosya)
                is YedekSonucu.Basarisiz -> ayarlar.basarisiz(simdi, sonuc.sorun)
                YedekSonucu.Gerekmedi -> Unit
            }
        } catch (e: Exception) {
            gunluk.uyari("yedek sonucu saklanamadı", e)
        }
        return sonuc
    }

    private fun yaz(klasor: YedekKlasoru, gun: java.time.LocalDate): YedekSonucu {
        val once = klasor.listele()
        for (g in once.filter { OtomatikYedekPlani.geciciMi(it.ad) }) sessizSil(klasor, g)

        val bicim = kaynak.bicim()
        val disa = kaynak.disaAktar()
        val hedef = OtomatikYedekPlani.dosyaAdi(gun)

        val gecici = klasor.olustur(OtomatikYedekPlani.geciciAd(gun), GECICI_MIME)
        yazVeyaSil(klasor, gecici, bicim, disa)
        for (eski in klasor.listele().filter { it.ad == hedef && it.kimlik != gecici.kimlik }) klasor.sil(eski)
        val adlanan = klasor.yenidenAdlandir(gecici, hedef)
        if (adlanan?.ad != hedef) {
            // Desteklenmiyor ya da sağlayıcı başka ad verdi: o dosyayı bırakma, son adı doğrudan yaz.
            sessizSil(klasor, adlanan ?: gecici)
            val son = klasor.olustur(hedef, AktarmaAkisi.MIME)
            yazVeyaSil(klasor, son, bicim, disa)
        }

        var silinen = 0
        try {
            for (f in OtomatikYedekPlani.silinecekler(klasor.listele())) {
                if (klasor.sil(f)) silinen++
            }
        } catch (e: Exception) {
            gunluk.uyari("eski yedekler temizlenemedi", e)
        }
        return YedekSonucu.Yapildi(hedef, disa.kayit.toLong(), silinen)
    }

    private fun yazVeyaSil(klasor: YedekKlasoru, d: KlasorDosyasi, bicim: AktarmaBicimi, disa: DisaAktarma) {
        try {
            klasor.yazmaAc(d).use { YedekKabi.yaz(it, bicim, disa, depo) }
        } catch (t: Throwable) {
            sessizSil(klasor, d)
            throw t
        }
    }

    private fun sessizSil(klasor: YedekKlasoru, d: KlasorDosyasi) {
        try {
            klasor.sil(d)
        } catch (e: Exception) {
            gunluk.uyari("yedek klasöründe dosya silinemedi", e)
        }
    }

    private class KlasorYok : IOException("klasör seçilmedi")

    companion object {
        const val GECICI_MIME = "application/octet-stream"

        internal fun sorunu(e: Throwable): YedekSorunu = when {
            e is KlasorYok -> YedekSorunu.KLASOR_YOK
            e is KlasorErisimiYok || e is SecurityException -> YedekSorunu.ERISIM_YOK
            yerYok(e) -> YedekSorunu.YER_YOK
            e is YedekHatasi.CokBuyuk -> YedekSorunu.COK_BUYUK
            e is YedekHatasi.EkBozuk -> YedekSorunu.EK_BOZUK
            e is CekirdekHatasi -> YedekSorunu.CEKIRDEK
            e is IOException -> YedekSorunu.YAZILAMADI
            else -> YedekSorunu.BEKLENMEYEN
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

    /** Döner: silindi mi. */
    fun sil(d: KlasorDosyasi): Boolean

    /** Döner: yeni haliyle dosya (sağlayıcı adı değiştirmiş olabilir); `null`: desteklenmiyor ya da olmadı. */
    fun yenidenAdlandir(d: KlasorDosyasi, yeniAd: String): KlasorDosyasi?
}

/** İzin geri alınmış ya da klasör yok. */
class KlasorErisimiYok(neden: String) : IOException(neden)

/** Otomatik yedeğin kalıcı ayarı ve son sonucu (üretimde platform `SharedPreferences`). */
interface YedekAyarDeposu {
    fun oku(): YedekDurumu
    fun acikYap(acik: Boolean)
    /** Yeni klasör: son hata temizlenir. */
    fun klasorYap(klasor: String?)
    fun basarili(an: Long, dosya: String)
    fun basarisiz(an: Long, sorun: YedekSorunu)
}
