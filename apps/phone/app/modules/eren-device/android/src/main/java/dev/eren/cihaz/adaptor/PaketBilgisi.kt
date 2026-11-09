package dev.eren.cihaz.adaptor

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.provider.Settings
import dev.eren.cihaz.cekirdek.KuruluUygulama
import dev.eren.cihaz.cekirdek.KullaniciKarari
import dev.eren.cihaz.cekirdek.ListeGirdisi
import dev.eren.cihaz.cekirdek.UygulamaDurumu
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * Kurulu uygulamalar, imza özeti, görünen ad, intent çözümüyle değişmezler ve kullanıcı kararları.
 * `baslat()` paket değişimlerini dinler ve çekirdek listesini tazeler.
 *
 * `listeGirdisi()` bütün paketleri tarar (paket başına imza okuma + etiket için kaynak yükleme;
 * yüzlerce pakette saniyeler sürer). Ana iplikte ÇAĞRILMAZ: servis iş ipliği, paket ipliği ve
 * aktivitelerin arka ipliği çağırır.
 */
class PaketBilgisi(context: Context) : PaketKapisi {
    private val ctx = context.applicationContext
    private val pm: PackageManager = ctx.packageManager
    private val kararlar = ctx.getSharedPreferences("eren_paket_kararlari", Context.MODE_PRIVATE)
    private val imzaOnbellek = ConcurrentHashMap<String, Pair<Long, String?>>()

    /** (paket, yeniMi): PACKAGE_ADDED yeni, REPLACED değişen. Kaldırmada çağrılmaz. */
    @Volatile
    var paketDinleyici: ((paket: String, yeni: Boolean) -> Unit)? = null

    private var islemIpi: HandlerThread? = null
    private var alici: BroadcastReceiver? = null

    override fun listeGirdisi(): ListeGirdisi {
        val kurulu = ArrayList<KuruluUygulama>()
        val baslaticilar = baslaticiPaketleri()
        for (bilgi in pm.getInstalledApplications(0)) {
            val paket = bilgi.packageName
            // Okunamayan imza boş kalır; hiçbir kullanıcı kararıyla eşleşmez.
            val imza = imzaOzeti(paket) ?: ""
            // Etiket eldeki ApplicationInfo'dan (`ad()` ile aynı sonuç, paket başına bir çağrı az).
            val ad = try {
                bilgi.loadLabel(pm).toString().ifEmpty { paket }
            } catch (_: Exception) {
                paket
            }
            // Sistem iç paketi: sistem uygulaması VE başlatıcı simgesi yok. Kullanıcının kurduğu her
            // paket ve simgeli sistem uygulamaları (Telefon, Mesajlar, Chrome...) false.
            val sistemIci = bilgi.flags and ApplicationInfo.FLAG_SYSTEM != 0 && paket !in baslaticilar
            kurulu.add(KuruluUygulama(paket, ad, imza, sistemIci))
        }
        return ListeGirdisi(kurulu, kararlariOku(), degismezleriCoz())
    }

    /**
     * Başlatıcı simgesi olan paketler (ACTION_MAIN + CATEGORY_LAUNCHER), tek sorguda küme olarak.
     * Sorgu başarısızsa boş küme: o turda her sistem paketi sistem içi sayılır (güvenli yön, kapalı).
     */
    private fun baslaticiPaketleri(): Set<String> {
        return try {
            val niyet = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            pm.queryIntentActivities(niyet, 0).mapNotNullTo(HashSet()) { it.activityInfo?.packageName }
        } catch (_: Exception) {
            emptySet()
        }
    }

    override fun imzaOzeti(paket: String): String? {
        return try {
            val bilgi = pm.getPackageInfo(paket, PackageManager.GET_SIGNING_CERTIFICATES)
            val guncelleme = bilgi.lastUpdateTime
            imzaOnbellek[paket]?.let { if (it.first == guncelleme) return it.second }
            val si = bilgi.signingInfo
            val ozet: String? = if (si == null) {
                null
            } else {
                val imzalar = if (si.hasMultipleSigners()) si.apkContentsSigners else si.signingCertificateHistory
                if (imzalar == null || imzalar.isEmpty()) {
                    null
                } else {
                    val sha = MessageDigest.getInstance("SHA-256")
                    // Tek imzacıda sertifika özeti; çoklu imzacıda sıralı özetlerin özeti.
                    val parcalar = imzalar.map { hex(sha.digest(it.toByteArray())) }.sorted()
                    if (parcalar.size == 1) parcalar[0] else hex(sha.digest(parcalar.joinToString("").toByteArray()))
                }
            }
            imzaOnbellek[paket] = guncelleme to ozet
            ozet
        } catch (_: Exception) {
            null
        }
    }

    override fun ad(paket: String): String {
        return try {
            pm.getApplicationLabel(pm.getApplicationInfo(paket, 0)).toString().ifEmpty { paket }
        } catch (_: Exception) {
            paket
        }
    }

    /** `UygulamaListesiActivity`: yalnız ACIK ya da HASSAS; imza özeti karar anındaki. */
    fun kararYaz(paket: String, durum: UygulamaDurumu, imzaOzeti: String) {
        if (durum != UygulamaDurumu.ACIK && durum != UygulamaDurumu.HASSAS) return
        kararlar.edit().putString(paket, durum.kablo + "|" + imzaOzeti).commit()
    }

    fun kararSil(paket: String) {
        kararlar.edit().remove(paket).commit()
    }

    private fun kararlariOku(): Map<String, KullaniciKarari> {
        val sonuc = HashMap<String, KullaniciKarari>()
        for ((paket, deger) in kararlar.all) {
            val s = (deger as? String)?.split('|', limit = 2) ?: continue
            if (s.size != 2 || s[1].isEmpty()) continue
            val durum = when (s[0]) {
                UygulamaDurumu.ACIK.kablo -> UygulamaDurumu.ACIK
                UygulamaDurumu.HASSAS.kablo -> UygulamaDurumu.HASSAS
                else -> continue
            }
            sonuc[paket] = KullaniciKarari(durum, s[1])
        }
        return sonuc
    }

    /**
     * Intent çözümüyle değişmezler.
     * - Ayarlar, paket kurucu, izin denetleyicisi: yalnız sistem uygulaması olan çözümler.
     * - Ana ekran (ACTION_MAIN + CATEGORY_HOME) çözen her paket ve varsayılan klavyenin
     *   paketi: sistem şartı YOK. Değişmez yapmak yalnız kısıtlar, kötüye kullanılamaz;
     *   kullanıcının kurduğu bir başlatıcı ya da klavye de değişmez olur (kabul edildi).
     */
    private fun degismezleriCoz(): Set<String> {
        val niyetler = listOf(
            Intent(Settings.ACTION_SETTINGS),
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName)),
            Intent(Intent.ACTION_VIEW).setDataAndType(
                Uri.parse("content://paket/x.apk"),
                "application/vnd.android.package-archive",
            ),
            Intent(Intent.ACTION_INSTALL_PACKAGE).setData(Uri.parse("content://paket/x.apk")),
            Intent("android.intent.action.MANAGE_APP_PERMISSIONS"),
            Intent("android.intent.action.MANAGE_PERMISSIONS"),
        )
        val sonuc = HashSet<String>()
        for (n in niyetler) {
            try {
                for (r in pm.queryIntentActivities(n, PackageManager.MATCH_DEFAULT_ONLY)) {
                    val ai = r.activityInfo?.applicationInfo ?: continue
                    if (ai.flags and ApplicationInfo.FLAG_SYSTEM != 0) sonuc.add(ai.packageName)
                }
            } catch (_: Exception) {
                // Çözülemeyen intent atlanır; sabit adlar çekirdekte zaten var.
            }
        }
        // Ana ekran: bayraksız sorgu (MATCH_DEFAULT_ONLY, DEFAULT kategorisi bildirmeyen başlatıcıları kaçırır).
        try {
            val ev = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
            for (r in pm.queryIntentActivities(ev, 0)) {
                r.activityInfo?.packageName?.let { sonuc.add(it) }
            }
        } catch (_: Exception) {
        }
        // Klavye: yalnız varsayılan giriş yöntemi ("paket/sınıf"). Okunamazsa ya da boşsa eklenmez.
        try {
            Settings.Secure.getString(ctx.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
                ?.let { ComponentName.unflattenFromString(it)?.packageName }
                ?.takeIf { it.isNotEmpty() }
                ?.let { sonuc.add(it) }
        } catch (_: Exception) {
        }
        return sonuc
    }

    /** Paket olaylarını dinlemeye başlar; olayda listeyi tazeler. */
    fun baslat() {
        if (alici != null) return
        // Arka plan önceliği: güncelleme yağmurunda tam tarama arayüzle işlemci yarışmasın.
        val ip = HandlerThread("eren-paket", Process.THREAD_PRIORITY_BACKGROUND).also { it.start() }
        islemIpi = ip
        val a = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                val paket = i.data?.schemeSpecificPart ?: return
                val degisiyor = i.getBooleanExtra(Intent.EXTRA_REPLACING, false)
                when (i.action) {
                    Intent.ACTION_PACKAGE_ADDED -> if (!degisiyor) yenile(paket, true)
                    Intent.ACTION_PACKAGE_REPLACED -> yenile(paket, false)
                    Intent.ACTION_PACKAGE_REMOVED -> if (!degisiyor) yenile(null, false)
                }
            }
        }
        val f = IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REPLACED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addDataScheme("package")
        }
        ctx.registerReceiver(a, f, null, Handler(ip.looper))
        alici = a
    }

    fun durdur() {
        alici?.let {
            try {
                ctx.unregisterReceiver(it)
            } catch (_: Exception) {
            }
        }
        alici = null
        islemIpi?.quitSafely()
        islemIpi = null
    }

    private fun yenile(paket: String?, yeni: Boolean) {
        try {
            if (paket != null) imzaOnbellek.remove(paket)
            Adaptor.cekirdek?.listeler?.guncelle(listeGirdisi())
            Adaptor.oturumGuncelle?.uygulamalarDegisti()
            if (paket != null) paketDinleyici?.invoke(paket, yeni)
        } catch (_: Exception) {
            // Liste tazelenemedi: sonraki olayda ya da elle yenilemede düzelir.
        }
    }

    private fun hex(b: ByteArray): String = b.joinToString("") { "%02x".format(it) }
}
