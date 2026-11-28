package dev.eren.ajanda.aktarma

import android.app.job.JobScheduler
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.provider.DocumentsContract
import dev.eren.ajanda.CekirdekErisimi
import dev.eren.ajanda.ag.EsitlemeIsi
import dev.eren.ajanda.ag.Gunluk
import dev.eren.ajanda.alarm.Bildirimler
import dev.eren.ajanda.cekirdek.AktarmaBicimi
import dev.eren.ajanda.cekirdek.DisaAktarma
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.ZoneId
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * SAHİBİ: D6. Otomatik yedeğin Android girişi (ince; kurallar [OtomatikYedekPlani] ve [OtomatikYedekci]'de).
 *
 * Ayarlar ekranı için:
 * - [klasorSecmeNiyeti] ile `startActivityForResult`; dönen ağaç URI'si [klasorSecildi]'ye (ana iş
 *   parçacığında çağrılabilir; kalıcı izni alır, eskisini bırakır; başka klasörse son yedek sıfırlanır ve
 *   açıksa iş yakın bir ana kurulur; eski yedek bildirimi kalkar).
 * - [acKapat]: açınca iş kurulur, kapatınca kaldırılır (bildirimi de). Klasör yoksa açılmaz (`false`).
 * - [gorunum]: açık/kapalı, klasör adı, erişim, son yedek (kaç gün önce), son hata, son yedeğin uyarıları ve
 *   henüz söylenmemiş sorun (arka planda çağır: sağlayıcıya sorar).
 * - [simdiYedekle]: arka planda dener, [bitti] o iş parçacığında çağrılır; sonucu ekran gösterir (söylendi sayılır).
 * - [soylendi]: ekran [YedekGorunumu.soylenmemis]'i gösterince çağırır (aynısı yeniden bildirilmez).
 *
 * İş: `EsitlemeIsi`'nin [EsitlemeIsi.YEDEK_ISI] işi; ağ koşulsuz, **tek seferlik**, bir sonraki gerekli ana
 * kurulur (`OtomatikYedekPlani.isGecikmesiMs`: bugün yedek varsa yarın, hata varsa artan bekleme). İş
 * [arkaPlanda]'yı çağırır, bitince [sonrakiniKur]. Eşitleme işleri değişmez. Bütün denemeler tek iş parçacığında.
 * Silinen işi (zorla durdurma, pil yöneticisi) [isiDenetle] yeniden kurar; ekrana bağlı değildir, çağıranlar:
 * `BaglantiYoneticisi.izle` (ilk ekran görünür olunca, [isiDenetleArkaPlanda]), `EsitlemeIsi`'nin eşitleme işleri,
 * `AcilisAlici` (açılış, güncelleme, saat). Kural [YedekIsDenetcisi]'nde.
 *
 * Bildirim: arka plan denemesinde söylenecek bir şey varsa (`OtomatikYedekPlani.soylenecek`) durum kanalında
 * bir kez (`Bildirimler.DURUM_YEDEK`); arayüz görünürken de gösterilir (ayar ekranı yok). İzin yoksa sessizce
 * atlanır, durum saklı kalır.
 */
object OtomatikYedek {
    private const val TERCIHLER = "ajanda_otomatik_yedek"
    private const val KURULUM_DOSYASI = "otomatik_yedek_kurulum"

    private val ISCI: Executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "ajanda-otomatik-yedek").apply { isDaemon = true }
    }

    @Volatile
    private var ornek: OtomatikYedekci? = null

    /** Yedek işi bu süreçte çalışıyor ([arkaPlanda] başından [arkaPlanda]'nın `bitti`'si dönene dek). */
    private val isCalisiyor = AtomicBoolean(false)

    private fun denetci(context: Context): YedekIsDenetcisi {
        val uygulama = context.applicationContext
        return YedekIsDenetcisi(
            ayarlar = ayarlar(uygulama),
            planlayici = JobYedekPlanlayici(uygulama),
            saat = System::currentTimeMillis,
            dilim = ZoneId::systemDefault,
            calisiyor = isCalisiyor::get,
            ayarYazilamadi = { TercihYedekAyarlari.sonYazimBasarisiz },
        )
    }

    private fun yedekci(context: Context): OtomatikYedekci = ornek ?: synchronized(this) {
        ornek ?: run {
            val uygulama = context.applicationContext
            OtomatikYedekci(
                kaynak = CekirdekKaynagi(uygulama),
                klasorAc = { SafYedekKlasoru(uygulama.contentResolver, Uri.parse(it)) },
                ayarlar = ayarlar(uygulama),
                saat = System::currentTimeMillis,
                dilim = ZoneId::systemDefault,
                gunluk = YedekGunlugu,
                kurulum = { kurulumKimligi(uygulama) },
                bildirici = DurumKanaliBildiricisi(uygulama),
            ).also { ornek = it }
        }
    }

    /**
     * Bu kurulumun kimliği: `noBackupFilesDir`'de (yedeğe ve cihazdan cihaza aktarıma girmez; iki telefon aynı
     * kimliği taşımasın). Yalnız dosya yoksa (ilk açılış, "verileri sil") ya da içeriği kimlik değilse yenisi
     * yazılır (geçici dosya + yeniden adlandırma). Okuma hatası (dosya varken) yeni kimlik üretmez, atar: deneme
     * başarısız olur, sonra yeniden denenir (k1: yeni kimlik eski yedekleri sahipsiz bırakırdı, hiç silinmezlerdi).
     */
    private fun kurulumKimligi(context: Context): String =
        kurulumDosyasi(File(context.noBackupFilesDir, KURULUM_DOSYASI))

    /** [kurulumKimligi]'nin dosya kuralı (JVM testli). */
    @Synchronized
    internal fun kurulumDosyasi(
        f: File,
        yeniKimlik: () -> String = { OtomatikYedekPlani.yeniKurulum() },
        gunluk: Gunluk = YedekGunlugu,
    ): String {
        if (f.exists()) {
            // Okunamazsa (izin, G/Ç, dizin) atar: yeni kimlik üretilmez.
            val var_ = f.readText().trim()
            if (OtomatikYedekPlani.kurulumGecerli(var_)) return var_
            gunluk.uyari("kurulum kimliği bozuk, yenisi yazılıyor", null)
        }
        val yeni = yeniKimlik()
        val gecici = File(f.parentFile, f.name + ".yeni")
        gecici.writeText(yeni)
        try {
            Files.move(gecici.toPath(), f.toPath(), StandardCopyOption.ATOMIC_MOVE)
        } catch (e: Exception) {
            gecici.delete()
            throw IOException("kurulum kimliği yazılamadı", e)
        }
        return yeni
    }

    private fun ayarlar(context: Context): YedekAyarDeposu =
        TercihYedekAyarlari(context.applicationContext.getSharedPreferences(TERCIHLER, Context.MODE_PRIVATE))

    /** Klasör seçici (`ACTION_OPEN_DOCUMENT_TREE`); kalıcı okuma-yazma izni istenir. */
    fun klasorSecmeNiyeti(): Intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
    )

    /** Döner: izin alındı ve klasör kaydedildi mi. */
    fun klasorSecildi(context: Context, agac: Uri): Boolean {
        val cr = context.applicationContext.contentResolver
        val bayrak = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        try {
            cr.takePersistableUriPermission(agac, bayrak)
        } catch (e: SecurityException) {
            YedekGunlugu.uyari("klasör izni alınamadı", e)
            return false
        }
        val a = ayarlar(context)
        val eski = a.oku().klasor
        try {
            a.degistir { it.klasorle(agac.toString()) }
        } catch (e: IOException) {
            YedekGunlugu.uyari("klasör kaydedilemedi", e)
            if (eski != agac.toString()) runCatching { cr.releasePersistableUriPermission(agac, bayrak) }
            return false
        }
        if (eski != null && eski != agac.toString()) {
            runCatching { cr.releasePersistableUriPermission(Uri.parse(eski), bayrak) }
        }
        // Hata ve bildirim durumu sıfırlandı (aynı klasör de): eski sorun bildirimi kalmasın.
        Bildirimler.durumKaldir(context.applicationContext, Bildirimler.DURUM_YEDEK)
        // Yeni klasöre ilk yedek ertesi günü beklemesin.
        isKurulamadiysaYaz { denetci(context).yenidenKur() }
        return true
    }

    /** Döner: istenen hale geçildi mi (açmak için klasör gerekir; ayar yazılamadıysa `false`). */
    fun acKapat(context: Context, acik: Boolean): Boolean {
        val a = ayarlar(context)
        if (acik && a.oku().klasor == null) return false
        try {
            a.degistir { it.copy(acik = acik) }
        } catch (e: IOException) {
            YedekGunlugu.uyari("ayar kaydedilemedi", e)
            return false
        }
        if (!acik) Bildirimler.durumKaldir(context.applicationContext, Bildirimler.DURUM_YEDEK)
        isKurulamadiysaYaz { denetci(context).yenidenKur() }
        return true
    }

    /** Ekran için anlık durum. Sağlayıcıya sorar: ana iş parçacığında çağırma. */
    fun gorunum(context: Context): YedekGorunumu {
        val d = ayarlar(context).oku()
        val cr = context.applicationContext.contentResolver
        val uri = d.klasor?.let(Uri::parse)
        val erisim = uri != null && SafYedekKlasoru.izinVar(cr, uri)
        val ad = if (uri != null && erisim) SafYedekKlasoru.klasorAdi(cr, uri) else null
        val simdi = System.currentTimeMillis()
        return YedekGorunumu(
            durum = d,
            klasorAdi = ad,
            erisimVar = erisim,
            sonYedekGunOnce = OtomatikYedekPlani.gunOnce(d, simdi, ZoneId.systemDefault()),
            soylenmemis = OtomatikYedekPlani.soylenecek(d, simdi),
        )
    }

    /** Ekran [YedekGorunumu.soylenmemis]'i kullanıcıya gösterdi: aynısı bildirimle yinelenmez. */
    fun soylendi(context: Context, b: YedekBildirimi) {
        try {
            ayarlar(context).degistir { it.bildirildi(b) }
        } catch (e: IOException) {
            YedekGunlugu.uyari("ayar kaydedilemedi", e)
        }
        Bildirimler.durumKaldir(context, Bildirimler.DURUM_YEDEK)
    }

    fun simdiYedekle(context: Context, bitti: (YedekSonucu) -> Unit) {
        val uygulama = context.applicationContext
        ISCI.execute {
            val s = yedekci(uygulama).simdiYedekle()
            isKurulamadiysaYaz { denetci(uygulama).yenidenKur() }
            bitti(s)
        }
    }

    /**
     * Yedek işi bitti (`EsitlemeIsi`, `jobFinished`'den sonra): açıksa bir sonraki gerekli ana yeniden kurar,
     * kapalıysa kaldırır. Durumu okur: ana iş parçacığında da çağrılabilir (yalnız tercih ve JobScheduler).
     */
    fun sonrakiniKur(context: Context) {
        isKurulamadiysaYaz { denetci(context).sonrakiniKur() }
    }

    /** Arka plan işi: zamanı geldiyse yedekler; [bitti] yedek iş parçacığında, tam bir kez. */
    fun arkaPlanda(context: Context, bitti: (YedekSonucu) -> Unit) {
        val uygulama = context.applicationContext
        isCalisiyor.set(true)
        try {
            ISCI.execute {
                var sonuc: YedekSonucu = YedekSonucu.Gerekmedi
                try {
                    if (!ayarlar(uygulama).oku().acik) {
                        denetci(uygulama).kaldir()
                    } else {
                        sonuc = yedekci(uygulama).gerekirseYedekle()
                    }
                } catch (t: Throwable) {
                    YedekGunlugu.uyari("otomatik yedek işi düştü", t)
                    sonuc = YedekSonucu.Basarisiz(YedekSorunu.BEKLENMEYEN)
                } finally {
                    try {
                        bitti(sonuc)
                    } finally {
                        isCalisiyor.set(false)
                    }
                }
            }
        } catch (t: Throwable) {
            isCalisiyor.set(false)
            throw t
        }
    }

    /**
     * Açıksa ve iş kurulu değilse kurar; kuruluysa zamanlamasına dokunmaz (eski sürümün periyodik işi tek
     * seferliğe çevrilir; çalışan işe dokunulmaz). Tekrarlı çağrıya dayanıklı, hata atmaz. Yalnız tercih ve
     * JobScheduler: her iş parçacığından çağrılabilir; ana iş parçacığında [isiDenetleArkaPlanda].
     */
    fun isiDenetle(context: Context) {
        isKurulamadiysaYaz { denetci(context).denetle() }
    }

    /** [isiDenetle] yedek iş parçacığında (ana iş parçacığı, ör. ekran görünür olunca); hemen döner. */
    fun isiDenetleArkaPlanda(context: Context) {
        val uygulama = context.applicationContext
        try {
            ISCI.execute { isiDenetle(uygulama) }
        } catch (e: Exception) {
            YedekGunlugu.uyari("yedek işi denetlenemedi", e)
        }
    }

    private inline fun isKurulamadiysaYaz(f: () -> Unit) {
        try {
            f()
        } catch (e: Exception) {
            YedekGunlugu.uyari("yedek işi kurulamadı", e)
        }
    }
}

/** Yedek işi `JobScheduler`'da ([EsitlemeIsi.YEDEK_ISI]). */
private class JobYedekPlanlayici(private val context: Context) : YedekIsPlanlayici {
    private val js: JobScheduler? get() = context.getSystemService(JobScheduler::class.java)

    override fun kurulu(): KuruluYedekIsi? =
        js?.getPendingJob(EsitlemeIsi.YEDEK_ISI)?.let { KuruluYedekIsi(periyodik = it.isPeriodic, kalici = it.isPersisted) }

    override fun kur(gecikmeMs: Long) {
        js?.schedule(EsitlemeIsi.yedekIsi(context, gecikmeMs))
    }

    override fun kaldir() {
        js?.cancel(EsitlemeIsi.YEDEK_ISI)
    }
}

/**
 * Ekranın göstereceği: ayar ve son sonuç, klasörün görünen adı, kalıcı izin hâlâ var mı.
 * - [sonYedekGunOnce]: son başarılı yedekten bu yana cihaz günü (bugün 0; hiç yoksa `null`);
 *   metni `OtomatikYedekMetinleri.gunOnce`.
 * - Son yedeğin uyarıları (yedeğe girmeyen ret girdileri, içe aktarma sınırı, bu telefonun açma belleği):
 *   `OtomatikYedekMetinleri.uyarilar(durum)`.
 * - [soylenmemis]: kullanıcıya henüz söylenmemiş sorun ya da büyüklük uyarısı (bildirim izni yoktu ya da kanal
 *   kapalıydı; arayüz görünürken de bildirim gösterilir). Ekran gösterince [OtomatikYedek.soylendi] çağırır. Metni
 *   `OtomatikYedekMetinleri.bildirim(soylenmemis, sonYedekGunOnce)`.
 */
data class YedekGorunumu(
    val durum: YedekDurumu,
    val klasorAdi: String?,
    val erisimVar: Boolean,
    val sonYedekGunOnce: Int? = null,
    val soylenmemis: YedekBildirimi? = null,
)

/** Yedek bildirimleri durum kanalında (`Bildirimler.DURUM_YEDEK`). */
private class DurumKanaliBildiricisi(private val context: Context) : YedekBildiricisi {
    override fun goster(baslik: String, metin: String): Boolean =
        Bildirimler.durumGoster(context, Bildirimler.DURUM_YEDEK, baslik, metin)

    override fun kaldir() = Bildirimler.durumKaldir(context, Bildirimler.DURUM_YEDEK)
}

private class CekirdekKaynagi(private val context: Context) : YedekKaynagi {
    override fun bicim(): AktarmaBicimi = dev.eren.ajanda.cekirdek.aktarmaBicimi()
    override fun disaAktar(): DisaAktarma = CekirdekErisimi.al(context).disaAktar()
}

private object YedekGunlugu : Gunluk {
    private const val ETIKET = "AjandaYedek"

    override fun bilgi(mesaj: String) {
        android.util.Log.i(ETIKET, mesaj)
    }

    override fun uyari(mesaj: String, hata: Throwable?) {
        // Yalnız sınıf adı: mesaj sağlayıcı yolu ya da veri taşıyabilir.
        if (hata == null) android.util.Log.w(ETIKET, mesaj) else android.util.Log.w(ETIKET, "$mesaj (${hata.javaClass.simpleName})")
    }
}

/**
 * Platform `SharedPreferences` üstünde ayar (anahtarlar sabit; değerler yalnız URI, an, ad, sayı ve sorun türü).
 * Bütün yazmalar süreç genelinde tek kilit altında oku-değiştir-yaz.
 */
internal class TercihYedekAyarlari(private val p: SharedPreferences) : YedekAyarDeposu {
    override fun oku(): YedekDurumu = synchronized(KILIT) {
        YedekDurumu(
            acik = p.getBoolean(ACIK, false),
            klasor = p.getString(KLASOR, null),
            sonBasariliMs = uzun(SON_MS),
            sonDosya = p.getString(SON_DOSYA, null),
            sonHata = sorun(HATA),
            sonHataMs = uzun(HATA_MS),
            ardisikHata = p.getInt(ARDISIK, 0),
            hataBasiMs = uzun(HATA_BASI),
            bildirilenSorun = sorun(BILDIRILEN),
            sonSinirAsiyor = p.getBoolean(SINIR, false),
            sinirBildirildi = p.getBoolean(SINIR_BILDIRILDI, false),
            sonRetDisarida = p.getInt(RET, 0),
            yarimYazim = p.getString(YARIM, null),
            sonBellekAsiyor = p.getBoolean(BELLEK, false),
            bellekBildirildi = p.getBoolean(BELLEK_BILDIRILDI, false),
        )
    }

    override fun degistir(f: (YedekDurumu) -> YedekDurumu) {
        synchronized(KILIT) {
            val d = f(oku())
            val yazildi = p.edit()
                .putBoolean(ACIK, d.acik)
                .koy(KLASOR, d.klasor)
                .koy(SON_MS, d.sonBasariliMs)
                .koy(SON_DOSYA, d.sonDosya)
                .koy(HATA, d.sonHata?.name)
                .koy(HATA_MS, d.sonHataMs)
                .putInt(ARDISIK, d.ardisikHata)
                .koy(HATA_BASI, d.hataBasiMs)
                .koy(BILDIRILEN, d.bildirilenSorun?.name)
                .putBoolean(SINIR, d.sonSinirAsiyor)
                .putBoolean(SINIR_BILDIRILDI, d.sinirBildirildi)
                .putInt(RET, d.sonRetDisarida)
                .koy(YARIM, d.yarimYazim)
                .putBoolean(BELLEK, d.sonBellekAsiyor)
                .putBoolean(BELLEK_BILDIRILDI, d.bellekBildirildi)
                .commit()
            // `commit` yanlış: diske geçmedi (iç bellek dolu). Bellekteki değer bu süreçte durur, soğuk başlayan
            // süreç bilmez: iş en az `AYAR_YAZILAMADI_BEKLEMESI_MS` sonraya kurulur (k2), çağıran öğrenir.
            sonYazimBasarisiz = !yazildi
            if (!yazildi) throw IOException("yedek ayarı saklanamadı")
        }
    }

    private fun uzun(k: String): Long? = if (p.contains(k)) p.getLong(k, 0) else null

    private fun sorun(k: String): YedekSorunu? =
        p.getString(k, null)?.let { ad -> YedekSorunu.entries.firstOrNull { it.name == ad } ?: YedekSorunu.BEKLENMEYEN }

    private fun SharedPreferences.Editor.koy(k: String, v: String?) = if (v == null) remove(k) else putString(k, v)

    private fun SharedPreferences.Editor.koy(k: String, v: Long?) = if (v == null) remove(k) else putLong(k, v)

    companion object {
        /** Bu süreçte son ayar yazımı diske geçmedi (`commit` yanlış); sonraki başarılı yazımda kalkar. */
        @Volatile
        var sonYazimBasarisiz = false
            private set

        private val KILIT = Any()
        private const val BELLEK = "son_bellek_asiyor"
        private const val BELLEK_BILDIRILDI = "bellek_bildirildi"
        const val ACIK = "acik"
        const val KLASOR = "klasor"
        const val SON_MS = "son_basarili_ms"
        const val SON_DOSYA = "son_dosya"
        const val HATA = "son_hata"
        const val HATA_MS = "son_hata_ms"
        const val ARDISIK = "ardisik_hata"
        const val HATA_BASI = "hata_basi_ms"
        const val BILDIRILEN = "bildirilen_sorun"
        const val SINIR = "son_sinir_asiyor"
        const val SINIR_BILDIRILDI = "sinir_bildirildi"
        const val RET = "son_ret_disarida"
        const val YARIM = "yarim_yazim"
    }
}

/**
 * SAF ağacı üstünde klasör (`DocumentsContract` + `ContentResolver`; AndroidX yok). Kalıcı yazma izni
 * yoksa ya da sorgu başarısızsa [KlasorErisimiYok].
 */
internal class SafYedekKlasoru(private val cr: ContentResolver, private val agac: Uri) : YedekKlasoru {

    private val klasorBelgesi: Uri by lazy {
        val id = try {
            DocumentsContract.getTreeDocumentId(agac)
        } catch (e: IllegalArgumentException) {
            throw KlasorErisimiYok("ağaç URI'si değil")
        }
        DocumentsContract.buildDocumentUriUsingTree(agac, id)
    }

    private fun erisimDenetle() {
        if (!izinVar(cr, agac)) throw KlasorErisimiYok("kalıcı izin yok")
    }

    override fun listele(): List<KlasorDosyasi> {
        erisimDenetle()
        val cocuklar = DocumentsContract.buildChildDocumentsUriUsingTree(agac, DocumentsContract.getDocumentId(klasorBelgesi))
        val sutunlar = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
        )
        val imlec = try {
            cr.query(cocuklar, sutunlar, null, null, null)
        } catch (e: SecurityException) {
            throw KlasorErisimiYok("sorgu reddedildi")
        } catch (e: IllegalArgumentException) {
            throw KlasorErisimiYok("klasör yok")
        } catch (e: IllegalStateException) {
            throw KlasorErisimiYok("klasör yok")
        } ?: throw KlasorErisimiYok("sorgu boş")
        return imlec.use { c ->
            buildList {
                while (c.moveToNext()) {
                    val id = c.getString(0) ?: continue
                    val ad = c.getString(1) ?: continue
                    if (c.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR) continue
                    add(KlasorDosyasi(ad, DocumentsContract.buildDocumentUriUsingTree(agac, id).toString()))
                }
            }
        }
    }

    override fun olustur(ad: String, mime: String): KlasorDosyasi {
        erisimDenetle()
        val uri = try {
            DocumentsContract.createDocument(cr, klasorBelgesi, mime, ad)
        } catch (e: FileNotFoundException) {
            throw KlasorErisimiYok("klasör yok")
        } ?: throw IOException("dosya oluşturulamadı")
        return KlasorDosyasi(adOku(uri) ?: ad, uri.toString())
    }

    override fun yazmaAc(d: KlasorDosyasi): OutputStream =
        cr.openOutputStream(Uri.parse(d.kimlik), "w") ?: throw IOException("dosya açılamadı")

    override fun okumaAc(d: KlasorDosyasi): InputStream = try {
        cr.openInputStream(Uri.parse(d.kimlik)) ?: throw IOException("dosya açılamadı")
    } catch (e: SecurityException) {
        throw KlasorErisimiYok("okuma reddedildi")
    }

    override fun sil(d: KlasorDosyasi): Boolean = try {
        DocumentsContract.deleteDocument(cr, Uri.parse(d.kimlik))
    } catch (e: FileNotFoundException) {
        false
    }

    override fun yenidenAdlandir(d: KlasorDosyasi, yeniAd: String): KlasorDosyasi? {
        val yeni = try {
            DocumentsContract.renameDocument(cr, Uri.parse(d.kimlik), yeniAd)
        } catch (e: UnsupportedOperationException) {
            null
        } catch (e: FileNotFoundException) {
            null
        } catch (e: IllegalStateException) {
            null
        } ?: return null
        // Sağlayıcı ad çakışmasında ek koyabilir: gerçek ad döner, çağıran karşılaştırır.
        return KlasorDosyasi(adOku(yeni) ?: yeniAd, yeni.toString())
    }

    private fun adOku(uri: Uri): String? = try {
        cr.query(uri, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    } catch (e: Exception) {
        null
    }

    companion object {
        fun izinVar(cr: ContentResolver, agac: Uri): Boolean =
            cr.persistedUriPermissions.any { it.uri == agac && it.isWritePermission && it.isReadPermission }

        /** Klasörün görünen adı; okunamazsa `null`. */
        fun klasorAdi(cr: ContentResolver, agac: Uri): String? = try {
            val belge = DocumentsContract.buildDocumentUriUsingTree(agac, DocumentsContract.getTreeDocumentId(agac))
            cr.query(belge, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        } catch (e: Exception) {
            null
        }
    }
}
