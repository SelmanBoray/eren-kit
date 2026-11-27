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
import dev.eren.ajanda.cekirdek.AktarmaBicimi
import dev.eren.ajanda.cekirdek.DisaAktarma
import java.io.FileNotFoundException
import java.io.IOException
import java.io.OutputStream
import java.time.ZoneId
import java.util.concurrent.Executor
import java.util.concurrent.Executors

/**
 * SAHİBİ: D6. Otomatik yedeğin Android girişi (ince; kurallar [OtomatikYedekPlani] ve [OtomatikYedekci]'de).
 *
 * Ayarlar ekranı için:
 * - [klasorSecmeNiyeti] ile `startActivityForResult`; dönen ağaç URI'si [klasorSecildi]'ye (ana iş
 *   parçacığında çağrılabilir; kalıcı izni alır, eskisini bırakır).
 * - [acKapat]: açınca iş kurulur, kapatınca kaldırılır. Klasör yoksa açılmaz (`false`).
 * - [gorunum]: açık/kapalı, klasör adı, erişim, son yedek ve son hata (arka planda çağır: sağlayıcıya sorar).
 * - [simdiYedekle]: arka planda dener, [bitti] o iş parçacığında çağrılır.
 * - [isiDenetle]: ekran açılışında; açıksa iş kurulu değilse kurar (tekrarlı çağrıya dayanıklı).
 *
 * Periyodik iş: `EsitlemeIsi`'nin [EsitlemeIsi.YEDEK_ISI] işi (ağ koşulsuz, saatte bir) [arkaPlanda]'yı çağırır.
 * Eşitleme işleri değişmez; yedek onlardan bağımsızdır. Bütün denemeler tek iş parçacığında sırayla.
 */
object OtomatikYedek {
    private const val TERCIHLER = "ajanda_otomatik_yedek"

    private val ISCI: Executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "ajanda-otomatik-yedek").apply { isDaemon = true }
    }

    @Volatile
    private var ornek: OtomatikYedekci? = null

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
            ).also { ornek = it }
        }
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
        if (eski != null && eski != agac.toString()) {
            runCatching { cr.releasePersistableUriPermission(Uri.parse(eski), bayrak) }
        }
        a.klasorYap(agac.toString())
        return true
    }

    /** Döner: istenen hale geçildi mi (açmak için klasör gerekir). */
    fun acKapat(context: Context, acik: Boolean): Boolean {
        val a = ayarlar(context)
        if (acik && a.oku().klasor == null) return false
        a.acikYap(acik)
        if (acik) isKur(context) else isIptal(context)
        return true
    }

    /** Ekran için anlık durum. Sağlayıcıya sorar: ana iş parçacığında çağırma. */
    fun gorunum(context: Context): YedekGorunumu {
        val d = ayarlar(context).oku()
        val cr = context.applicationContext.contentResolver
        val uri = d.klasor?.let(Uri::parse)
        val erisim = uri != null && SafYedekKlasoru.izinVar(cr, uri)
        val ad = if (uri != null && erisim) SafYedekKlasoru.klasorAdi(cr, uri) else null
        return YedekGorunumu(d, ad, erisim)
    }

    fun simdiYedekle(context: Context, bitti: (YedekSonucu) -> Unit) {
        val uygulama = context.applicationContext
        ISCI.execute { bitti(yedekci(uygulama).simdiYedekle()) }
    }

    /** Periyodik iş: zamanı geldiyse yedekler; [bitti] yedek iş parçacığında, tam bir kez. */
    fun arkaPlanda(context: Context, bitti: (YedekSonucu) -> Unit) {
        val uygulama = context.applicationContext
        ISCI.execute {
            var sonuc: YedekSonucu = YedekSonucu.Gerekmedi
            try {
                if (!ayarlar(uygulama).oku().acik) {
                    isIptal(uygulama)
                } else {
                    sonuc = yedekci(uygulama).gerekirseYedekle()
                }
            } catch (t: Throwable) {
                YedekGunlugu.uyari("otomatik yedek işi düştü", t)
                sonuc = YedekSonucu.Basarisiz(YedekSorunu.BEKLENMEYEN)
            } finally {
                bitti(sonuc)
            }
        }
    }

    /** Açıksa ve iş kurulu değilse kurar. */
    fun isiDenetle(context: Context) {
        if (ayarlar(context).oku().acik) isKur(context)
    }

    private fun isKur(context: Context) {
        val js = context.getSystemService(JobScheduler::class.java) ?: return
        val mevcut = js.getPendingJob(EsitlemeIsi.YEDEK_ISI)
        // Aynı iş varsa yeniden kurma: kurmak dönemi sıfırlar.
        if (mevcut != null && mevcut.intervalMillis == EsitlemeIsi.YEDEK_PERIYOT_MS && mevcut.isPersisted) return
        js.schedule(EsitlemeIsi.yedekIsi(context))
    }

    private fun isIptal(context: Context) {
        context.getSystemService(JobScheduler::class.java)?.cancel(EsitlemeIsi.YEDEK_ISI)
    }
}

/** Ekranın göstereceği: ayar ve son sonuç, klasörün görünen adı, kalıcı izin hâlâ var mı. */
data class YedekGorunumu(val durum: YedekDurumu, val klasorAdi: String?, val erisimVar: Boolean)

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

/** Platform `SharedPreferences` üstünde ayar (anahtarlar sabit; değerler yalnız URI, an, ad ve sorun türü). */
internal class TercihYedekAyarlari(private val p: SharedPreferences) : YedekAyarDeposu {
    override fun oku(): YedekDurumu = YedekDurumu(
        acik = p.getBoolean(ACIK, false),
        klasor = p.getString(KLASOR, null),
        sonBasariliMs = if (p.contains(SON_MS)) p.getLong(SON_MS, 0) else null,
        sonDosya = p.getString(SON_DOSYA, null),
        sonHata = p.getString(HATA, null)?.let { ad -> YedekSorunu.entries.firstOrNull { it.name == ad } ?: YedekSorunu.BEKLENMEYEN },
        sonHataMs = if (p.contains(HATA_MS)) p.getLong(HATA_MS, 0) else null,
    )

    override fun acikYap(acik: Boolean) {
        p.edit().putBoolean(ACIK, acik).commit()
    }

    override fun klasorYap(klasor: String?) {
        p.edit().putString(KLASOR, klasor).remove(HATA).remove(HATA_MS).commit()
    }

    override fun basarili(an: Long, dosya: String) {
        p.edit().putLong(SON_MS, an).putString(SON_DOSYA, dosya).remove(HATA).remove(HATA_MS).commit()
    }

    override fun basarisiz(an: Long, sorun: YedekSorunu) {
        p.edit().putString(HATA, sorun.name).putLong(HATA_MS, an).commit()
    }

    private companion object {
        const val ACIK = "acik"
        const val KLASOR = "klasor"
        const val SON_MS = "son_basarili_ms"
        const val SON_DOSYA = "son_dosya"
        const val HATA = "son_hata"
        const val HATA_MS = "son_hata_ms"
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
