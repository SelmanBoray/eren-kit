package dev.eren.cihaz.adaptor

import android.Manifest
import android.app.Activity
import android.app.AppOpsManager
import android.app.KeyguardManager
import android.app.NotificationManager
import android.app.StatusBarManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.hardware.biometrics.BiometricManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import android.speech.RecognizerIntent
import android.util.Base64
import dev.eren.cihaz.cekirdek.BildirimTuru
import dev.eren.cihaz.cekirdek.CekirdekSinirlari
import dev.eren.cihaz.cekirdek.GrantNedeni
import dev.eren.cihaz.cekirdek.ImzaRolu
import dev.eren.cihaz.cekirdek.Kanal
import dev.eren.cihaz.cekirdek.KimlikMetni
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.NetworkInterface
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/*
 * JS'in yerel katmana tek kapısı. Yüzey birebir `ErenDevice.types.ts`: cmd, cmd_result, token, ham
 * çerçeve ve genel imzalama yok. Güvenlik kararı burada verilmez: izin yalnız OnayActivity'de
 * (kullanıcı onayı) ya da OtoIzinKapisi'nde (tam yetki açıkken) doğar; köprü yalnız onları çağırır
 * ve yalnız opak `grant_id` döndürür. Tam yetki bayrağını köprü açamaz (yalnız TamYetkiActivity),
 * kapatabilir. Çekirdek henüz kurulu değilse (Adaptor.cekirdek == null) işlevler "hazır değil" sonucu döner.
 *
 * Aktivite sözleşmesi (bu dosyanın varsayımı): sınıflar adla açılır; sonuç `RESULT_OK`/`RESULT_CANCELED`
 * ve extra `sonuc` (+ `grant_id` / `kod`) ile okunur. Eşleşme `EslesmeDeposu`'ndan okunur.
 *
 * İplikler: AsyncFunction'lar Expo'nun TEK `expo.modules.AsyncFunctionQueue` ipliğinde sırayla koşar;
 * orada uyuyan bir çağrı bütün köprüyü bekletir. Bu yüzden çekirdek beklemesi uyumaz, `arka`
 * ipliğinde 100 ms'lik yeniden denemeyle yapılır. Yaşam döngüsü olayları (ön plana geçiş) ana
 * iplikte gelir; servis başlatma ve olay haritası hesabı `arka`'ya alınır.
 */
class ErenDeviceModule : Module(), AdaptorOlaylari {

    private class SohbetOturumu(val deviceId: String, val clientNonce: String, val bitisMs: Long)

    private val oturumlar = ConcurrentHashMap<String, SohbetOturumu>()
    private val bekleyenler = HashMap<Int, (Int, Intent?) -> Unit>()
    private val ana = Handler(Looper.getMainLooper())
    private val sesKilidi = Any()
    private var seslendiriciOrnegi: Seslendirici? = null
    private var sesKapandi = false
    private val arkaIp = lazy { HandlerThread("eren-modul").apply { start() } }
    private val arka: Handler by lazy { Handler(arkaIp.value.looper) }

    override fun definition() = ModuleDefinition {
        Name("ErenDevice")
        Events("durumDegisti", "izinlerDegisti", "bildirimAcildi", "kisayolGeldi", "seslendirmeDurumu")

        OnCreate {
            Adaptor.olaylar = this@ErenDeviceModule
            baglam()?.let { AnaIplikBekcisi.baslat(it) }
            arkadaGuvenli { servisiAyaktaTut() }
        }
        OnActivityEntersForeground { arkadaGuvenli { servisiAyaktaTut() } }
        OnDestroy {
            if (Adaptor.olaylar === this@ErenDeviceModule) Adaptor.olaylar = null
            seslendiriciyiKapat()
            tumBekleyenleriBitir()
            if (arkaIp.isInitialized()) arkaIp.value.quitSafely()
        }
        OnActivityResult { _, yuk ->
            val geri = synchronized(bekleyenler) { bekleyenler.remove(yuk.requestCode) }
            geri?.invoke(yuk.resultCode, yuk.data)
        }

        AsyncFunction("durum") { -> durumHaritasi() }

        AsyncFunction("eslesme") { ->
            val e = eslesmeOku()
            if (e == null || e.host.isEmpty() || e.port !in 1..65535) {
                null
            } else {
                mapOf("device_id" to e.deviceId, "host" to e.host, "port" to e.port)
            }
        }

        AsyncFunction("eslestir") { promise: Promise ->
            val sonuc: (Int, Intent?) -> Unit = { kod, veri ->
                val s = veri?.getStringExtra("sonuc")
                val sonuc = when {
                    s == "tamam" || s == "iptal" || s == "hata" -> s
                    kod == Activity.RESULT_OK -> "tamam"
                    kod == Activity.RESULT_CANCELED -> "iptal"
                    else -> "hata"
                }
                val cikti = HashMap<String, Any?>()
                cikti["sonuc"] = sonuc
                val elleKod = veri?.getStringExtra("kod")
                if (sonuc == "tamam" && elleKod != null && elleKod.length <= 64) cikti["kod"] = elleKod
                if (sonuc == "tamam") durumDegisti()
                promise.resolve(cikti)
            }
            val hata = mapOf<String, Any?>("sonuc" to "hata")
            if (!aktiviteBaslat(ISTEK_ESLESTIRME, Intent().setClassName(paketAdi(), SINIF_ESLESTIRME), sonuc)) {
                promise.resolve(hata)
            }
        }

        AsyncFunction("sohbetHello") { promise: Promise ->
            cekirdekHazirOlunca { c ->
                try {
                    promise.resolve(sohbetHello(c))
                } catch (_: Exception) {
                    promise.reject("ERR_EREN_HELLO", null, null)
                }
            }
        }

        AsyncFunction("sohbetSinama") { oturum: String, serverNonce: String, serverSignature: String ->
            sohbetSinama(oturum, serverNonce, serverSignature)
        }

        AsyncFunction("izinIste") { planJson: String, planHash: String, promise: Promise ->
            val gecersiz = mapOf<String, Any?>("sonuc" to "gecersiz")
            if (planJson.isEmpty() || planJson.length > PLAN_AZAMI || planHash.isEmpty() || planHash.length > 128) {
                promise.resolve(gecersiz)
                return@AsyncFunction
            }
            cekirdekHazirOlunca { c ->
                try {
                    if (c == null) {
                        promise.resolve(gecersiz)
                        return@cekirdekHazirOlunca
                    }
                    val intent = Intent().setClassName(paketAdi(), SINIF_ONAY)
                        .putExtra("plan_json", planJson)
                        .putExtra("plan_hash", planHash)
                    val sonuc: (Int, Intent?) -> Unit = { kod, veri ->
                        promise.resolve(izinSonucu(kod, veri))
                        izinlerDegisti()
                    }
                    if (!aktiviteBaslat(ISTEK_ONAY, intent, sonuc)) {
                        promise.resolve(mapOf<String, Any?>("sonuc" to "iptal"))
                    }
                } catch (_: Exception) {
                    promise.resolve(gecersiz)
                }
            }
        }

        AsyncFunction("otoIzin") { planJson: String, planHash: String, promise: Promise ->
            // Tam bir kez: kapı da tek sonuç verir; bu bekçi beklenmedik istisna yoluna karşı.
            val tek = AtomicBoolean(false)
            val bitir: (Map<String, Any?>) -> Unit = { m -> if (tek.compareAndSet(false, true)) promise.resolve(m) }
            if (planJson.isEmpty() || planJson.length > PLAN_AZAMI || planHash.isEmpty() || planHash.length > 128) {
                bitir(onayGerekli("gecersiz"))
                return@AsyncFunction
            }
            val ctx = baglam()
            if (ctx == null) {
                bitir(onayGerekli("cekirdek_yok"))
                return@AsyncFunction
            }
            // Tam yetki kapalıysa servisi kaldırmadan (Durdur sonrası yeniden doğmasın) hemen dön.
            // Kapı kendi içinde yine denetler; bu ön kontrol yalnız gereksiz servis kaldırmayı önler.
            if (!tamYetkiAcikMi(ctx)) {
                bitir(onayGerekli("tam_yetki_kapali"))
                return@AsyncFunction
            }
            // Çekirdek kuruluyorsa kısa bekle; sıra ve bütün kararlar (tam yetki dahil) kapıda.
            // Kapı ana ipliğe kendisi geçer, sonucu ana iplikte tam bir kez verir.
            cekirdekHazirOlunca { _ ->
                try {
                    OtoIzinKapisi.dene(ctx, planJson, planHash) { s ->
                        val m = otoIzinSonucu(s)
                        bitir(m)
                        if (m["sonuc"] == "verildi") izinlerDegisti()
                    }
                } catch (_: Exception) {
                    bitir(onayGerekli("gecersiz"))
                }
            }
        }

        AsyncFunction("izinler") { -> izinListesi() }

        AsyncFunction("izinGeriCek") { grantId: String? ->
            val id = grantId?.takeIf { it.isNotEmpty() && it.length <= 64 }
            if (grantId == null || id != null) {
                val g = Adaptor.oturumGuncelle
                if (g != null) {
                    g.izinGeriCek(id, GrantNedeni.KULLANICI_DURDURDU)
                } else {
                    // Bağlantı yokken de kapatmak serbest: yalnız izin düşer, yenisi doğmaz.
                    Adaptor.cekirdek?.izinler?.geriCek(id, GrantNedeni.KULLANICI_DURDURDU)
                }
                izinlerDegisti()
            }
            null
        }

        AsyncFunction("uygulamaListesiAc") { -> sadeAc(SINIF_UYGULAMALAR, null); null }

        AsyncFunction("denetimAc") { grantId: String? ->
            sadeAc(SINIF_DENETIM, grantId?.takeIf { it.isNotEmpty() && it.length <= 64 })
            null
        }

        AsyncFunction("tanilamaAc") { -> sadeAc(SINIF_TANILAMA, null); null }

        AsyncFunction("ayarAc") { hedef: String ->
            ayarAc(hedef)
            null
        }

        AsyncFunction("dikte") { promise: Promise ->
            // Tanıyıcı açılmadan süren okuma kesilir: asistan kendi sesini dinlemesin.
            mevcutSeslendirici()?.durdur(null)
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "tr-TR")
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            val sonuc: (Int, Intent?) -> Unit = { kod, veri ->
                val metin = if (kod == Activity.RESULT_OK) {
                    veri?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim()
                } else {
                    null
                }
                if (metin.isNullOrEmpty()) {
                    promise.resolve(mapOf<String, Any?>("iptal" to true))
                } else {
                    promise.resolve(mapOf<String, Any?>("metin" to metin))
                }
            }
            if (!aktiviteBaslat(ISTEK_DIKTE, intent, sonuc)) {
                promise.resolve(mapOf<String, Any?>("iptal" to true))
            }
        }

        // Okumanın bitmesi beklenmez; motor yok/dil yok/boş metin/başlatılamadı → false (reddetmez).
        AsyncFunction("seslendir") { metin: String, dil: String, promise: Promise ->
            val s = seslendirici()
            if (s == null) {
                promise.resolve(false)
            } else {
                s.seslendir(metin, dil) { kabul -> promise.resolve(kabul) }
            }
        }

        AsyncFunction("seslendirmeyiDurdur") { promise: Promise ->
            val s = mevcutSeslendirici()
            if (s == null) {
                promise.resolve(null)
            } else {
                s.durdur { promise.resolve(null) }
            }
        }

        // Bayrağı yalnız TamYetkiActivity açar (biyometri); köprü yalnız ekranı gösterir.
        AsyncFunction("tamYetkiAc") { promise: Promise ->
            val sonuc: (Int, Intent?) -> Unit = { kod, veri ->
                // "acildi" iddiası bayrağın gerçekten açık olmasına bağlanır; RESULT_CANCELED/extra yok → iptal.
                val acildi = kod == Activity.RESULT_OK && veri?.getStringExtra("sonuc") == "acildi" &&
                    tamYetkiAcikMi(baglam())
                promise.resolve(if (acildi) "acildi" else "iptal")
            }
            if (!aktiviteBaslat(ISTEK_TAM_YETKI, Intent().setClassName(paketAdi(), SINIF_TAM_YETKI), sonuc)) {
                promise.resolve("iptal")
            }
        }

        // Kapatmak her zaman serbest; kapatılamadıysa sessiz geçmez (JS "kapandı" sanmasın).
        AsyncFunction("tamYetkiKapat") { promise: Promise ->
            val ctx = baglam()
            if (ctx == null) {
                promise.reject("ERR_EREN_TAM_YETKI", null, null)
                return@AsyncFunction
            }
            try {
                TamYetki.kapat(ctx)
                promise.resolve(null)
            } catch (_: Exception) {
                promise.reject("ERR_EREN_TAM_YETKI", null, null)
            }
        }

        AsyncFunction("kisayolAl") { ->
            val m = KisayolDeposu.al()
            if (m == null) {
                null
            } else {
                mapOf(
                    "id" to m.id,
                    "metin" to m.metin,
                    "paket" to m.paket,
                    "ad" to m.ad,
                    "zaman_ms" to m.zamanMs,
                )
            }
        }

        AsyncFunction("kisayolTuket") { id: String ->
            if (id.isNotEmpty() && id.length <= 64) KisayolDeposu.tuket(id)
            null
        }

        AsyncFunction("kisayolKutucuguEkle") { promise: Promise -> kutucukEkle(promise) }

        AsyncFunction("sesKisayoluKur") { ->
            val ctx = baglam()
            if (ctx == null) {
                "hata"
            } else {
                try {
                    when (ErisimAnahtari.sesKisayoluKur(ctx)) {
                        SesKisayoluSonucu.KURULDU -> "kuruldu"
                        SesKisayoluSonucu.KURULDU_DIGERLERIYLE -> "kuruldu_digerleriyle"
                        SesKisayoluSonucu.YETKI_YOK -> "yetki_yok"
                        SesKisayoluSonucu.HATA -> "hata"
                    }
                } catch (_: Exception) {
                    "hata"
                }
            }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // AdaptorOlaylari: yalnız hızlandırıcı; JS gerçeği durum()/izinler() ile çeker.
    // ---------------------------------------------------------------------------------------------

    // Her iplikten çağrılır (ana iplik dahil); harita hesabı (ağ arayüzleri, sistem servisleri) `arka`'da.
    override fun durumDegisti() {
        arkadaGuvenli { sendEvent("durumDegisti", durumHaritasi()) }
    }

    override fun izinlerDegisti() {
        // Expo olay yükü nesne olmak zorunda: dizi `izinler` anahtarında gider.
        arkadaGuvenli { sendEvent("izinlerDegisti", mapOf<String, Any?>("izinler" to izinListesi())) }
    }

    private fun arkadaGuvenli(blok: () -> Unit) {
        try {
            arka.post {
                try {
                    blok()
                } catch (_: Exception) {
                }
            }
        } catch (_: Exception) {
        }
    }

    override fun bildirimAcildi(tur: BildirimTuru) {
        try {
            sendEvent("bildirimAcildi", mapOf<String, Any?>("tur" to tur.kablo))
        } catch (_: Exception) {
        }
    }

    // Yalnız kimlik gider; metin JS'e `kisayolAl()` ile çekilir.
    override fun kisayolGeldi(id: String) {
        try {
            sendEvent("kisayolGeldi", mapOf<String, Any?>("id" to id))
        } catch (_: Exception) {
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Seslendirme: modül başına tek `Seslendirici`, ilk `seslendir`'de kurulur, yıkımda kapanır.
    // ---------------------------------------------------------------------------------------------

    private fun seslendirici(): Seslendirici? = synchronized(sesKilidi) {
        if (sesKapandi) return@synchronized null
        seslendiriciOrnegi ?: baglam()?.let { ctx ->
            try {
                Seslendirici(ctx) { konusuyor -> seslendirmeDurumu(konusuyor) }
            } catch (_: Exception) {
                null
            }
        }?.also { seslendiriciOrnegi = it }
    }

    /** Kurulmadıysa kurmaz (durdurmak için motor bağlamaya gerek yok). */
    private fun mevcutSeslendirici(): Seslendirici? = synchronized(sesKilidi) { seslendiriciOrnegi }

    private fun seslendiriciyiKapat() {
        val s = synchronized(sesKilidi) {
            sesKapandi = true
            val o = seslendiriciOrnegi
            seslendiriciOrnegi = null
            o
        }
        try {
            s?.kapat()
        } catch (_: Exception) {
        }
    }

    private fun seslendirmeDurumu(konusuyor: Boolean) {
        try {
            sendEvent("seslendirmeDurumu", mapOf<String, Any?>("konusuyor" to konusuyor))
        } catch (_: Exception) {
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Durum
    // ---------------------------------------------------------------------------------------------

    private fun durumHaritasi(): Map<String, Any?> {
        val ctx = baglam()
        val ekran = try {
            Adaptor.cekirdek?.ekran?.durum()
        } catch (_: Exception) {
            null
        }
        return mapOf(
            "eslesmis" to (eslesmeOku() != null),
            "cihaz_bagli" to ((Adaptor.oturumGuncelle as? Baglanti)?.baglimi() == true),
            "a11y" to (ekran?.a11y ?: false),
            "adb_enabled" to (ekran?.adbAcik ?: adbAcikMi(ctx)),
            "kilitli" to (ekran?.kilitli ?: kilitliMi(ctx)),
            "bildirim_izni" to bildirimIzniVarMi(ctx),
            "pil_muaf" to pilMuafMi(ctx),
            "vpn_aktif" to vpnAktifMi(),
            "biyometri" to biyometriVarMi(ctx),
            "erisim_yetkisi" to erisimYetkisiVarMi(ctx),
            "kullanim_erisimi" to kullanimErisimiVarMi(ctx),
            "tam_yetki" to tamYetkiAcikMi(ctx),
            "ses_kisayolu" to sesKisayoluKuruluMu(ctx),
        )
    }

    private fun sesKisayoluKuruluMu(ctx: Context?): Boolean {
        if (ctx == null) return false
        return try {
            ErisimAnahtari.sesKisayoluKurulu(ctx)
        } catch (_: Exception) {
            false
        }
    }

    // WRITE_SECURE_SETTINGS (kurulumda `adb shell pm grant`).
    private fun erisimYetkisiVarMi(ctx: Context?): Boolean {
        if (ctx == null) return false
        return try {
            ErisimAnahtari.yetkiVar(ctx)
        } catch (_: Exception) {
            false
        }
    }

    // `appops set <paket> GET_USAGE_STATS allow` → MODE_ALLOWED. MODE_DEFAULT'ta karar
    // PACKAGE_USAGE_STATS iznine düşer (UsageStatsManager'ın kendi kuralı).
    private fun kullanimErisimiVarMi(ctx: Context?): Boolean {
        if (ctx == null) return false
        return try {
            val ao = ctx.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
            when (ao.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)) {
                AppOpsManager.MODE_ALLOWED -> true
                AppOpsManager.MODE_DEFAULT ->
                    ctx.checkSelfPermission(Manifest.permission.PACKAGE_USAGE_STATS) ==
                        PackageManager.PERMISSION_GRANTED
                else -> false
            }
        } catch (_: Exception) {
            false
        }
    }

    // Okunamıyorsa kapalı say: bilinmeyen durum yetkili görünmesin.
    private fun tamYetkiAcikMi(ctx: Context?): Boolean {
        if (ctx == null) return false
        return try {
            TamYetki.acik(ctx)
        } catch (_: Exception) {
            false
        }
    }

    private fun adbAcikMi(ctx: Context?): Boolean = try {
        ctx != null && Settings.Global.getInt(ctx.contentResolver, Settings.Global.ADB_ENABLED, 0) == 1
    } catch (_: Exception) {
        false
    }

    // Okunamıyorsa kilitli say: bilinmeyen durum izinli görünmesin.
    private fun kilitliMi(ctx: Context?): Boolean = try {
        val km = ctx?.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        km?.isKeyguardLocked ?: true
    } catch (_: Exception) {
        true
    }

    private fun bildirimIzniVarMi(ctx: Context?): Boolean = try {
        (ctx?.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager)
            ?.areNotificationsEnabled() == true
    } catch (_: Exception) {
        false
    }

    private fun pilMuafMi(ctx: Context?): Boolean = try {
        val pm = ctx?.getSystemService(Context.POWER_SERVICE) as? PowerManager
        pm?.isIgnoringBatteryOptimizations(ctx.packageName) == true
    } catch (_: Exception) {
        false
    }

    // ACCESS_NETWORK_STATE izni manifestte yok: ağ arayüzü adlarına bakılır (tun*, tailscale*, wg*).
    private fun vpnAktifMi(): Boolean = try {
        NetworkInterface.getNetworkInterfaces()?.toList()?.any { ag ->
            val ad = ag.name.lowercase()
            ag.isUp && (ad.startsWith("tun") || ad.startsWith("tailscale") || ad.startsWith("wg") || ad.startsWith("ppp"))
        } == true
    } catch (_: Exception) {
        false
    }

    private fun biyometriVarMi(ctx: Context?): Boolean = try {
        val bm = ctx?.getSystemService(BiometricManager::class.java)
        bm?.canAuthenticate(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
            BiometricManager.BIOMETRIC_SUCCESS
    } catch (_: Exception) {
        false
    }

    // ---------------------------------------------------------------------------------------------
    // Eşleşme (EslestirmeActivity'nin yazdığı kalıcı kayıt)
    // ---------------------------------------------------------------------------------------------

    private class EslesmeKaydi(val deviceId: String, val pcAcikAnahtar: String, val host: String, val port: Int)

    private fun eslesmeOku(): EslesmeKaydi? {
        val ctx = baglam() ?: return null
        return try {
            val k = EslesmeDeposu(ctx).oku() ?: return null
            if (k.deviceId.isEmpty() || k.pcAcikAnahtar.isEmpty()) null
            else EslesmeKaydi(k.deviceId, k.pcAcikAnahtar, k.host, k.port)
        } catch (_: Exception) {
            null
        }
    }

    // ---------------------------------------------------------------------------------------------
    // /sohbet el sıkışması: yalnız imza döner; imzalanan metin burada kurulur
    // ---------------------------------------------------------------------------------------------

    private fun sohbetHello(c: CekirdekErisimi?): Map<String, Any?> {
        val e = eslesmeOku()
        // Hazır değil: boş sonuç; sinama bu oturumu hiç tanımaz.
        if (c == null || e == null) {
            return mapOf("device_id" to "", "client_nonce" to "", "oturum" to "")
        }
        val simdi = c.saat.monotonikMs()
        oturumlar.entries.removeIf { it.value.bitisMs <= simdi }
        while (oturumlar.size >= OTURUM_AZAMI) {
            val en = oturumlar.entries.minByOrNull { it.value.bitisMs } ?: break
            oturumlar.remove(en.key)
        }
        val nonce = Base64.encodeToString(c.rastgele.baytlar(CekirdekSinirlari.NONCE_BAYT), Base64.NO_WRAP)
        val oturum = Base64.encodeToString(
            c.rastgele.baytlar(16),
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
        )
        oturumlar[oturum] = SohbetOturumu(e.deviceId, nonce, simdi + OTURUM_OMRU_MS)
        return mapOf("device_id" to e.deviceId, "client_nonce" to nonce, "oturum" to oturum)
    }

    private fun sohbetSinama(oturum: String, serverNonce: String, serverSignature: String): Map<String, Any?> {
        val yok = mapOf<String, Any?>("hata" to "oturum_yok")
        val gecersiz = mapOf<String, Any?>("hata" to "imza_gecersiz")
        val c = Adaptor.cekirdek ?: return yok
        // Tek kullanım: sonuç ne olursa olsun oturum burada tüketilir.
        val o = oturumlar.remove(oturum) ?: return yok
        if (c.saat.monotonikMs() > o.bitisMs) return yok
        val e = eslesmeOku() ?: return yok
        if (e.deviceId != o.deviceId) return yok
        if (serverSignature.isEmpty() || serverSignature.length > 512) return gecersiz
        return try {
            val pcMetin = KimlikMetni.metin(ImzaRolu.PC, Kanal.SOHBET, o.deviceId, o.clientNonce, serverNonce)
                ?: return gecersiz
            if (!c.anahtar.dogrula(e.pcAcikAnahtar, pcMetin, serverSignature)) return gecersiz
            val telMetin = KimlikMetni.metin(ImzaRolu.TELEFON, Kanal.SOHBET, o.deviceId, o.clientNonce, serverNonce)
                ?: return gecersiz
            mapOf("signature" to c.anahtar.imzala(telMetin))
        } catch (_: Exception) {
            gecersiz
        }
    }

    // ---------------------------------------------------------------------------------------------
    // İzinler (jeton hiçbir yerde yok)
    // ---------------------------------------------------------------------------------------------

    private fun izinListesi(): List<Map<String, Any?>> {
        val c = Adaptor.cekirdek ?: return emptyList()
        return try {
            c.izinler.aktifler().map { a ->
                val k = a.kayit
                mapOf(
                    "grant_id" to k.grantId,
                    "plan_id" to k.planId,
                    "plan_hash" to k.planHash,
                    "mod" to k.mod.kablo,
                    "uygulamalar" to k.uygulamalar.map { mapOf("paket" to it.paket, "ad" to it.ad) },
                    "kalan_ms" to a.kalanMs,
                    "butce" to k.kalanButce,
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun izinSonucu(kod: Int, veri: Intent?): Map<String, Any?> {
        val s = veri?.getStringExtra("sonuc")
        val sonuc = when {
            s == "onaylandi" || s == "reddedildi" || s == "iptal" || s == "gecersiz" -> s
            kod == Activity.RESULT_OK && !veri?.getStringExtra("grant_id").isNullOrEmpty() -> "onaylandi"
            kod == Activity.RESULT_CANCELED -> "iptal"
            else -> "gecersiz"
        }
        if (sonuc != "onaylandi") return mapOf("sonuc" to sonuc)
        // Onay iddiası, gerçekten aktif bir izne bağlanmıyorsa kabul edilmez.
        val id = veri?.getStringExtra("grant_id")
        val var_ = !id.isNullOrEmpty() && id.length <= 64 &&
            (Adaptor.cekirdek?.izinler?.aktifler()?.any { it.kayit.grantId == id } == true)
        return if (var_) mapOf("sonuc" to "onaylandi", "grant_id" to id) else mapOf("sonuc" to "gecersiz")
    }

    /** `OtoIzinSonucu` → TS şekli. Yalnız opak `grant_id`; bilinmeyen neden `gecersiz` sayılır. */
    private fun otoIzinSonucu(s: OtoIzinSonucu): Map<String, Any?> = when (s) {
        is OtoIzinSonucu.Verildi -> {
            // izinSonucu ile aynı ölçüt: iddia gerçekten aktif bir izne bağlanmalı.
            val id = s.grantId
            val var_ = id.isNotEmpty() && id.length <= 64 &&
                (Adaptor.cekirdek?.izinler?.aktifler()?.any { it.kayit.grantId == id } == true)
            if (var_) mapOf("sonuc" to "verildi", "grant_id" to id) else onayGerekli("gecersiz")
        }
        is OtoIzinSonucu.OnayGerekli -> onayGerekli(if (s.neden in OTO_NEDENLER) s.neden else "gecersiz")
    }

    private fun onayGerekli(neden: String): Map<String, Any?> = mapOf("sonuc" to "onay_gerekli", "neden" to neden)

    // ---------------------------------------------------------------------------------------------
    // Aktiviteler ve ayarlar
    // ---------------------------------------------------------------------------------------------

    /**
     * `arka` ipliği. Eşleşme varsa ve çekirdek yoksa (ilk kurulum, Durdur sonrası, servis henüz
     * kuruluyor) servisi kaldırır; en çok 3 sn'de bir. Çalışan serviste yalnız `onStartCommand`
     * tetikler (hafif), servis yeniden yaratılmaz.
     */
    private fun servisiAyaktaTut() {
        if (Adaptor.cekirdek != null) return
        val ctx = baglam() ?: return
        val simdi = SystemClock.elapsedRealtime()
        synchronized(servisKilidi) {
            if (simdi - sonServisDenemesi < SERVIS_DENEME_ARALIK_MS) return
            sonServisDenemesi = simdi
        }
        if (eslesmeOku() != null) CihazServisi.baslat(ctx)
    }

    /**
     * Çekirdek kurulunca `sonra(c)`; en çok ~4 sn içinde kurulmazsa `sonra(null)` ("hazır değil", JS
     * yeniden dener). Hiçbir iplik uyumaz: hazırsa hemen çağıran iplikte, değilse `arka`'da 100 ms
     * aralıkla bakılır. Modül yıkıldıysa (`arka` kapalı) hemen null.
     */
    private fun cekirdekHazirOlunca(sonra: (CekirdekErisimi?) -> Unit) {
        Adaptor.cekirdek?.let {
            sonra(it)
            return
        }
        val son = SystemClock.elapsedRealtime() + CEKIRDEK_BEKLEME_MS
        val yokla = object : Runnable {
            var ilk = true

            override fun run() {
                if (ilk) {
                    ilk = false
                    try {
                        servisiAyaktaTut()
                    } catch (_: Exception) {
                    }
                }
                val c = Adaptor.cekirdek
                if (c != null || SystemClock.elapsedRealtime() >= son || !arka.postDelayed(this, 100)) sonra(c)
            }
        }
        if (!arka.post(yokla)) sonra(null)
    }

    private fun baglam(): Context? = appContext.reactContext?.applicationContext

    private fun paketAdi(): String = baglam()?.packageName.orEmpty()

    /** Sonucu bekleyen başlatma. Aynı istek kodu bekliyorsa eskisi iptal sayılır. false: başlatılamadı. */
    private fun aktiviteBaslat(istek: Int, intent: Intent, sonuc: (Int, Intent?) -> Unit): Boolean {
        val akt = appContext.currentActivity ?: return false
        val eski = synchronized(bekleyenler) { bekleyenler.put(istek, sonuc) }
        eski?.invoke(Activity.RESULT_CANCELED, null)
        ana.post {
            try {
                akt.startActivityForResult(intent, istek)
            } catch (_: ActivityNotFoundException) {
                geriAl(istek, sonuc)
            } catch (_: SecurityException) {
                geriAl(istek, sonuc)
            }
        }
        return true
    }

    private fun geriAl(istek: Int, sonuc: (Int, Intent?) -> Unit) {
        val hala = synchronized(bekleyenler) {
            if (bekleyenler[istek] === sonuc) bekleyenler.remove(istek) else null
        }
        hala?.invoke(Activity.RESULT_CANCELED, null)
    }

    private fun tumBekleyenleriBitir() {
        val hepsi = synchronized(bekleyenler) {
            val l = bekleyenler.values.toList()
            bekleyenler.clear()
            l
        }
        hepsi.forEach { it.invoke(Activity.RESULT_CANCELED, null) }
    }

    private fun sadeAc(sinif: String, grantId: String?) {
        val ctx = baglam() ?: return
        val intent = Intent().setClassName(ctx.packageName, sinif).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (grantId != null) intent.putExtra("grant_id", grantId)
        baslatSessiz(ctx, intent)
    }

    // Yalnız sabit hedefler; JS'ten gelen başka hiçbir değer intent'e girmez.
    private fun ayarAc(hedef: String) {
        val ctx = baglam() ?: return
        val intent = when (hedef) {
            "erisilebilirlik" -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            "uygulama_bilgisi" -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", ctx.packageName, null))
            "pil" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            "bildirim" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
            "vpn" -> Intent(Settings.ACTION_VPN_SETTINGS)
            else -> return
        }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        baslatSessiz(ctx, intent)
    }

    private fun baslatSessiz(ctx: Context, intent: Intent) {
        ana.post {
            try {
                ctx.startActivity(intent)
            } catch (_: ActivityNotFoundException) {
            } catch (_: SecurityException) {
            }
        }
    }

    /**
     * Android 13+ sistem iletişim kutusuyla Hızlı Ayarlar'a `KisayolKutucugu`'nu ekleme isteği (uygulama
     * ön planda olmalı). Sonuç kodları: eklendi/zaten/reddedildi; geçici hatalar (ön planda değil,
     * istek zaten sürüyor) `reddedildi` (yeniden denenebilir); kalıcı hatalar (durum çubuğu servisi
     * yok, bileşen/paket uyuşmazlığı, başka kullanıcı) ve 13 altı `desteklenmiyor`. Tam bir kez çözülür.
     */
    private fun kutucukEkle(promise: Promise) {
        val tek = AtomicBoolean(false)
        val bitir: (String) -> Unit = { s -> if (tek.compareAndSet(false, true)) promise.resolve(s) }
        val ctx = baglam()
        if (ctx == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            bitir("desteklenmiyor")
            return
        }
        val gonderildi = ana.post {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                try {
                    val sbm = ctx.getSystemService(StatusBarManager::class.java)
                    if (sbm == null) {
                        bitir("desteklenmiyor")
                    } else {
                        sbm.requestAddTileService(
                            ComponentName(ctx, KisayolKutucugu::class.java),
                            ctx.asistanAdi(),
                            Icon.createWithResource(ctx, R.drawable.ic_eren_kutucuk),
                            ctx.mainExecutor,
                        ) { kod ->
                            bitir(
                                when (kod) {
                                    StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED -> "eklendi"
                                    StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED -> "zaten"
                                    StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED,
                                    StatusBarManager.TILE_ADD_REQUEST_ERROR_APP_NOT_IN_FOREGROUND,
                                    StatusBarManager.TILE_ADD_REQUEST_ERROR_REQUEST_IN_PROGRESS,
                                    -> "reddedildi"
                                    else -> "desteklenmiyor"
                                },
                            )
                        }
                    }
                } catch (_: Exception) {
                    bitir("desteklenmiyor")
                }
            } else {
                bitir("desteklenmiyor")
            }
        }
        if (!gonderildi) bitir("desteklenmiyor")
    }

    private companion object {
        const val SINIF_ONAY = "dev.eren.cihaz.adaptor.OnayActivity"
        const val SINIF_ESLESTIRME = "dev.eren.cihaz.adaptor.EslestirmeActivity"
        const val SINIF_UYGULAMALAR = "dev.eren.cihaz.adaptor.UygulamaListesiActivity"
        const val SINIF_DENETIM = "dev.eren.cihaz.adaptor.DenetimActivity"
        const val SINIF_TANILAMA = "dev.eren.cihaz.adaptor.TanilamaActivity"
        const val SINIF_TAM_YETKI = "dev.eren.cihaz.adaptor.TamYetkiActivity"
        const val ISTEK_ONAY = 0x4501
        const val ISTEK_ESLESTIRME = 0x4502
        const val ISTEK_DIKTE = 0x4503
        const val ISTEK_TAM_YETKI = 0x4504
        val OTO_NEDENLER = setOf(
            "tam_yetki_kapali",
            "gecersiz",
            "uygulama_listede_degil",
            "hassas",
            "erisim_acilamadi",
            "cekirdek_yok",
        )
        const val PLAN_AZAMI = 1 shl 20
        const val OTURUM_OMRU_MS = 30_000L
        const val OTURUM_AZAMI = 8
        const val CEKIRDEK_BEKLEME_MS = 4000L
        const val SERVIS_DENEME_ARALIK_MS = 3000L
        val servisKilidi = Any()
        @Volatile var sonServisDenemesi = -SERVIS_DENEME_ARALIK_MS
    }
}
