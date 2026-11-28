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
 * 1. Klasörü listele (erişim burada denetlenir). Önceki denemeden kalan doğrudan yazım
 *    ([YedekDurumu.yarimYazim]) yarımsa silinir, bütünse tutulur; bu kurulumun artık geçici dosyaları silinir,
 *    önceki denemenin doğruladığı dosya hariç ([YedekDurumu.sonKimlikler]: önbellekli listede geçici adıyla
 *    görünebilir; V3).
 * 2. Yeni ad (`ajanda-otomatik-yedek-<gün>-<SSddss>-<kurulum>.zip`; klasörde varsa saniye ilerler) +
 *    `.yaziliyor` oluşturulur, `disaAktar()` belgesi D3'ün kabıyla ([YedekKabi]) yazılır, kapanınca **geri
 *    okunup doğrulanır** (zip girdilerinin CRC'si, belgenin bayt boyu, ek sayısı, dosya sonundaki merkezi dizin
 *    kaydı). Hata olursa yarım dosya silinir.
 * 3. Geçici son ada çevrilir. Sağlayıcı yeniden adlandırmayı desteklemiyorsa (ya da başka ad verirse) sağlam
 *    geçici **tutulur**, ad [YedekDurumu.yarimYazim]'a yazılır, son ad doğrudan yazılıp doğrulanır; ancak sonra
 *    geçici silinir ve iz temizlenir.
 * 4. Eski yedekler yeni yedek doğrulandıktan sonra temizlenir ([OtomatikYedekPlani.silinecekler]; hatası
 *    yedeği düşürmez, günlüğe yazılır). Aynı günün eski dosyası da böylece, yenisi yerindeyken silinir. Bu
 *    temizlik geçicilere dokunmaz ve doğrulanan dosyayı sağlayıcı kimliğiyle de korur (T4).
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
    /** Bu telefonda içe aktarmanın en iyi durumda alabileceği bellek ([YedekKabi.buTelefondaAcmaButcesi]). */
    private val acmaButcesi: () -> Long = { YedekKabi.buTelefondaAcmaButcesi() },
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
            yaz(klasor, d.klasor, simdi)
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

    /**
     * Arka planda: söylenecek varsa bildir (arayüz görünürken de: yedeğin durumunu gösteren ekran henüz yok,
     * bildirim düşük önemli ve bir kezdir). Önde: sonuç ekranda görüldü, söylendi say; eski bildirim kalkar.
     */
    private fun soyle(sonuc: YedekSonucu, arkaPlan: Boolean, simdi: Long) {
        try {
            if (sonuc is YedekSonucu.Yapildi) bildirici.kaldir()
            if (!arkaPlan) {
                val b = when {
                    sonuc is YedekSonucu.Basarisiz -> YedekBildirimi.Sorun(sonuc.sorun)
                    sonuc is YedekSonucu.Yapildi && sonuc.sinirAsiyor -> YedekBildirimi.SinirAsiyor
                    sonuc is YedekSonucu.Yapildi && sonuc.bellekAsiyor -> YedekBildirimi.BellekAsiyor
                    else -> null
                }
                if (b != null) {
                    ayarlar.degistir { it.bildirildi(b) }
                    bildirici.kaldir()
                }
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

    private fun yaz(klasor: YedekKlasoru, klasorUri: String, simdi: Long): YedekSonucu {
        val k = kurulum()
        if (!OtomatikYedekPlani.kurulumGecerli(k)) throw IllegalStateException("kurulum kimliği geçersiz")
        val once = klasor.listele()
        yarimYazimiTemizle(klasor, once, k)
        // Önceki denemenin doğruladığı dosya, liste önbellekten gelirse hâlâ geçici adıyla görünebilir (az önce
        // yeniden adlandırıldı): kimliğiyle korunur, yenisi yazılmadan silinmez (V3).
        val oncekiKorunan = ayarlar.oku().takeIf { it.klasor == klasorUri }?.sonKimlikler.orEmpty()
        for (g in once.filter { OtomatikYedekPlani.geciciMi(it.ad, k) && it.kimlik !in oncekiKorunan }) sessizSil(klasor, g)

        val bicim = kaynak.bicim()
        val disa = kaynak.disaAktar()
        val hedef = OtomatikYedekPlani.bosAd(simdi, dilim(), k, once.map { it.ad }.toSet())
        val beklenen = Beklenen(utf8Boyu(disa.belge), disa.ekler.distinctBy { it.ozet }.size)

        val gecici = klasor.olustur(OtomatikYedekPlani.geciciAd(hedef), GECICI_MIME)
        yazVeyaSil(klasor, gecici, bicim, disa, beklenen)
        val adlanan = klasor.yenidenAdlandir(gecici, hedef)
        // Doğrulanan dosyanın sağlayıcı kimlikleri: temizlik onları hiçbir adla silmez (T4).
        val korunan = HashSet<String>()
        if (adlanan?.ad == hedef) {
            korunan += gecici.kimlik
            korunan += adlanan.kimlik
        } else {
            // Desteklenmiyor ya da sağlayıcı başka ad verdi. Sağlam geçici son yazım doğrulanana dek kalır;
            // süreç arada ölürse iz sonraki denemede son dosyayı yarımsa siler, bütünse tutar.
            val saglam = adlanan ?: gecici
            ayarlar.degistir { it.copy(yarimYazim = hedef) }
            val son = klasor.olustur(hedef, AktarmaAkisi.MIME)
            if (son.ad != hedef) {
                sessizSil(klasor, son)
                throw IOException("sağlayıcı yedeğe başka ad verdi")
            }
            yazVeyaSil(klasor, son, bicim, disa, beklenen)
            korunan += son.kimlik
            ayarlar.degistir { it.copy(yarimYazim = null) }
            sessizSil(klasor, saglam)
        }
        // Sonraki denemenin başı için saklanır (V3); saklanamazsa yedek düşmez, yalnız o koruma eksik kalır.
        try {
            ayarlar.degistir { if (it.klasor == klasorUri) it.copy(sonKimlikler = korunan.toSet()) else it }
        } catch (e: Exception) {
            gunluk.uyari("doğrulanan yedeğin kimliği saklanamadı", e)
        }

        // Yazmadan sonraki temizlik geçicilere dokunmaz (onlar deneme başında silinir): liste önbellekten
        // gelirse az önce adı değişen yedek eski geçici adıyla görünebilir (T4).
        var silinen = 0
        try {
            val bugun = OtomatikYedekPlani.gun(simdi, dilim())
            val sil = OtomatikYedekPlani.silinecekler(
                klasor.listele(), k, bugun, koru = hedef, koruKimlikler = korunan, geciciDahil = false,
            )
            for (f in sil) if (klasor.sil(f)) silinen++
        } catch (e: Exception) {
            gunluk.uyari("eski yedekler temizlenemedi", e)
        }
        val bellekAsiyor = try {
            !disa.iceAktarmaSiniriniAsiyor && YedekKabi.acmaBellegi(beklenen.belge, disa.ekler) > acmaButcesi()
        } catch (e: Exception) {
            false
        }
        return YedekSonucu.Yapildi(
            hedef, disa.kayit.toLong(), silinen, disa.retListesinde, disa.iceAktarmaSiniriniAsiyor,
            bellekAsiyor = bellekAsiyor, eskiSurumAcamaz = disa.bicimSurumu >= 2L,
        )
    }

    /**
     * Önceki denemenin doğrudan yazımı (yalnız bu kurulumun adıysa): süreç son ada yazarken ya da doğruladıktan
     * sonra izi silmeden ölmüş olabilir. Dosya bütünse ([butunlukDenetle]: sonuna dek yazılmış zip, CRC'ler
     * tutuyor, tek belge) sağlam yedektir, tutulur (k3); değilse silinir. İkisinde de iz kalkar.
     */
    private fun yarimYazimiTemizle(klasor: YedekKlasoru, dosyalar: List<KlasorDosyasi>, k: String) {
        val ad = ayarlar.oku().yarimYazim ?: return
        val kalan = if (OtomatikYedekPlani.yedekAni(ad, k) == null) emptyList()
        else dosyalar.filter { it.ad == ad }.filterNot { butunMu(klasor, it) || sessizSil(klasor, it) }
        if (kalan.isEmpty()) ayarlar.degistir { if (it.yarimYazim == ad) it.copy(yarimYazim = null) else it }
    }

    /** Döner: dosya bütün bir kap mı (okunamazsa yanlış; erişim hatası olduğu gibi geçer). */
    private fun butunMu(klasor: YedekKlasoru, d: KlasorDosyasi): Boolean = try {
        klasor.okumaAc(d).use { butunlukDenetle(it, kaynak.bicim()) }
        true
    } catch (e: KlasorErisimiYok) {
        throw e
    } catch (e: Exception) {
        false
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

        /** Kabı geri okur ([butunlukDenetle]); belgenin boyu ve ek sayısı [b]'deki gibi olmalı. */
        private fun dogrula(giris: InputStream, bicim: AktarmaBicimi, b: Beklenen) {
            val (belge, ek) = butunlukDenetle(giris, bicim)
            if (belge != b.belge) throw Dogrulanamadi("belge boyu tutmuyor")
            if (ek != b.ek) throw Dogrulanamadi("ek sayısı tutmuyor")
        }

        /** Zip'in sonundaki merkezi dizin sonu kaydı (açıklamasız): imza + 18 bayt. */
        private const val DIZIN_SONU_BOYU = 22

        /**
         * Kabı akışla okur (bellekte tutmadan): her girdi sonuna dek okunur (`ZipInputStream` CRC'yi ve boyu orada
         * denetler), belge girdisi tek olmalı; sonra dosyanın kalanı okunur, son 22 bayt merkezi dizin sonu kaydı
         * olmalı ve girdi sayısı görülenle tutmalı (yazım `finish`'e dek sürmüş: girdi sınırında kesik dosya da
         * yakalanır). Döner: (belge baytı, ek dosyası sayısı). Bozuk zip, kesik dosya ya da okuma hatası
         * [Dogrulanamadi]; erişim hatası olduğu gibi geçer.
         */
        internal fun butunlukDenetle(giris: InputStream, bicim: AktarmaBicimi): Pair<Long, Int> {
            var belge = -1L
            var ek = 0
            var girdi = 0
            val son = SonBaytlar(giris, DIZIN_SONU_BOYU)
            try {
                val z = ZipInputStream(BufferedInputStream(son, 64 * 1024))
                val tampon = ByteArray(64 * 1024)
                while (true) {
                    val g = z.nextEntry ?: break
                    girdi++
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
                // Merkezi dizin `ZipInputStream`'in okumadığı kalan: tamponlardakiler `son`'dan zaten geçti.
                while (son.read(tampon) >= 0) Unit
            } catch (e: Dogrulanamadi) {
                throw e
            } catch (e: KlasorErisimiYok) {
                throw e
            } catch (e: IOException) {
                throw Dogrulanamadi("geri okunamadı")
            } catch (e: IllegalArgumentException) {
                throw Dogrulanamadi("geri okunamadı")
            }
            if (belge < 0) throw Dogrulanamadi("belge yok")
            val s = son.son()
            val imza = s.size == DIZIN_SONU_BOYU && s[0] == 0x50.toByte() && s[1] == 0x4b.toByte() &&
                s[2] == 0x05.toByte() && s[3] == 0x06.toByte()
            if (!imza) throw Dogrulanamadi("dizin sonu yok")
            val sayi = (s[10].toInt() and 0xff) or ((s[11].toInt() and 0xff) shl 8)
            val aciklama = (s[20].toInt() and 0xff) or ((s[21].toInt() and 0xff) shl 8)
            // 0xFFFF: zip64 (sayı zip64 kaydında); bizim yazdığımız kaplar oraya varmaz.
            if (aciklama != 0 || (sayi != 0xffff && sayi != girdi)) throw Dogrulanamadi("dizin sonu tutmuyor")
            return belge to ek
        }

        /** `YedekKabi`'nın yazdığı UTF-8 boyu ([YedekKabi.utf8Boyu]). */
        internal fun utf8Boyu(s: String): Long = YedekKabi.utf8Boyu(s)

        /** `ENOSPC`: Android'de `IOException` ("write failed: ENOSPC ...") ya da nedeni `ErrnoException`. */
        private fun yerYok(e: Throwable): Boolean =
            generateSequence(e) { it.cause }.take(8).any { h ->
                val m = h.message ?: return@any false
                m.contains("ENOSPC") || m.contains("No space left", ignoreCase = true)
            }
    }

    /** Geçen baytların son [n]'ini tutan akış (merkezi dizin sonu kaydı için). */
    private class SonBaytlar(private val ic: InputStream, private val n: Int) : InputStream() {
        private val halka = ByteArray(n)
        private var toplam = 0L

        private fun ekle(b: ByteArray, off: Int, len: Int) {
            for (i in off until off + len) halka[((toplam + i - off) % n).toInt()] = b[i]
            toplam += len
        }

        /** Son [n] bayt (daha azı geçtiyse hepsi), sırasıyla. */
        fun son(): ByteArray {
            val k = minOf(toplam, n.toLong()).toInt()
            return ByteArray(k) { i -> halka[((toplam - k + i) % n).toInt()] }
        }

        override fun read(): Int {
            val r = ic.read()
            if (r >= 0) {
                halka[(toplam % n).toInt()] = r.toByte()
                toplam++
            }
            return r
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            val r = ic.read(b, off, len)
            if (r > 0) ekle(b, off, r)
            return r
        }

        override fun close() = ic.close()
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
