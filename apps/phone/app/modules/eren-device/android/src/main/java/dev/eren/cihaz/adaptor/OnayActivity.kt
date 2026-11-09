package dev.eren.cihaz.adaptor

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import dev.eren.cihaz.cekirdek.CekirdekSinirlari
import dev.eren.cihaz.cekirdek.IzinModu
import dev.eren.cihaz.cekirdek.IzinliUygulama
import dev.eren.cihaz.cekirdek.OnayliIzin
import dev.eren.cihaz.cekirdek.Plan
import dev.eren.cihaz.cekirdek.PlanHash
import dev.eren.cihaz.cekirdek.Sema
import dev.eren.cihaz.cekirdek.TelefonIzinIstegi
import dev.eren.cihaz.cekirdek.UygulamaDurumu

/**
 * Izin ureten tek yer (degismez 1). Plan siki cozulur, ozet yeniden hesaplanir, kullanici gorevi
 * ve kapsami gorup onaylar. Guvenlik karari yine cekirdektedir; burasi yalniz kullanici onayini alir.
 * Onay (ve gerekiyorsa biyometri) sonrasi once `ErisimAnahtari.ac` ile erisilebilirlik servisi acilir;
 * izin yalniz `AcmaSonucu.ACIK`'tan sonra dogar (servis bagli -> izin -> `izinEklendi`). `YETKI_YOK` ve
 * `ZAMAN_ASIMI`'nda izin dogmaz, ekran acik kalir, yeniden denenebilir.
 * Sonuc: RESULT_OK + extra `sonuc` ("onaylandi"|"reddedildi"|"iptal"|"gecersiz") + `grant_id`.
 * Jeton hicbir yolla disari cikmaz. Plan/gorev metni gunluge girmez.
 */
class OnayActivity : Activity() {

    companion object {
        const val EXTRA_PLAN_JSON = "plan_json"
        const val EXTRA_PLAN_HASH = "plan_hash"
        const val EXTRA_SONUC = "sonuc"
        const val EXTRA_GRANT_ID = "grant_id"

        private val SURELER_DK = longArrayOf(5, 10, 30, 60)
        private val BUTCELER = intArrayOf(10, 30, 100, 300)
        private const val FLAG_KISMEN_GIZLI = 0x2 // FLAG_WINDOW_IS_PARTIALLY_OBSCURED
        private const val FLAG_GIZLI = 0x1 // FLAG_WINDOW_IS_OBSCURED

        // "Ayarları aç" ile erişilebilirlik ayarlarında kalınabilecek en uzun süre; sonra onay bayatlar.
        private const val AYAR_AZAMI_MS = 3 * 60_000L
    }

    private class UygulamaSatiri(val paket: String, val ad: String)

    private var plan: Plan? = null
    private var hash: String = ""
    private var istek: TelefonIzinIstegi? = null
    private var uygulamalar: List<UygulamaSatiri> = emptyList()

    private lateinit var sureGrubu: RadioGroup
    private lateinit var butceGrubu: RadioGroup
    private lateinit var hataMetni: TextView
    private lateinit var gizliUyari: TextView
    private lateinit var digerUyari: TextView
    private lateinit var bekleme: LinearLayout
    private lateinit var erisimEngeli: LinearLayout
    private var onayDugmesi: Button? = null
    private val sureIdleri = LinkedHashMap<Int, Long>()
    private val butceIdleri = LinkedHashMap<Int, Int>()

    private var bitti = false
    private var biyometrideMi = false
    private var iptalSinyali: CancellationSignal? = null

    // Erişilebilirlik açılışı sürerken true; ikinci onay ve seçim değişikliği kapalı.
    private var erisimBekleniyor = false
    // Her açma denemesinin numarası; eski/yinelenen yanıt yok sayılır.
    private var erisimDenemesi = 0
    // "Ayarları aç" ile erişilebilirlik ayarlarına gidildi; dönüşe kadar onStop iptal etmez (süreli).
    private var ayardaMi = false
    private val anaIplik = Handler(Looper.getMainLooper())
    private val ayarSuresiDoldu = Runnable { if (ayardaMi) bitir("iptal") }

    private val fg = Renkler.metin
    private val soluk = Renkler.metinIkincil
    private val kirmizi = Renkler.hata

    private val yetki: Int
        get() = BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)

        val cekirdek = Adaptor.cekirdek
        val ham = intent.getStringExtra(EXTRA_PLAN_JSON)
        val beklenen = intent.getStringExtra(EXTRA_PLAN_HASH)
        if (cekirdek == null || ham == null || beklenen == null) return bitir("gecersiz")
        val p = Sema.planCoz(ham) ?: return bitir("gecersiz")
        val h = PlanHash.planHash(p.ham) ?: return bitir("gecersiz")
        if (h != beklenen) return bitir("gecersiz")
        val i = p.telefonIzinIstegi ?: return bitir("gecersiz")
        plan = p
        hash = h
        istek = i
        uygulamalar = i.uygulamalar.map { UygulamaSatiri(it, cekirdek.paket.ad(it)) }
        kur(p, i)
    }

    // ---------------------------------------------------------------------------------------
    // Ekran
    // ---------------------------------------------------------------------------------------

    private fun kur(p: Plan, i: TelefonIzinIstegi) {
        val yaz = i.mod == IzinModu.YAZ
        val kok = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(24))
        }
        gizliUyari = metin("", kirmizi, 14f, bold = true).apply { visibility = View.GONE }
        kok.addView(gizliUyari)

        kok.addView(metin("Telefon izni isteği", soluk, 13f))
        kok.addView(metin(temiz(p.baslik), fg, 20f, bold = true))

        // Başka erişilebilirlik servisi uyarısı (erişilebilirlik ayarlarından dönüşte tazelenir)
        digerUyari = kutu("", kirmizi)
        kok.addView(digerUyari)
        digerUyariGuncelle()

        kok.addView(baslik("Görev (PC'den gelen metin, tamamı)"))
        kok.addView(kutu(temiz(p.gorevMetni), fg))

        kok.addView(baslik("Mod"))
        kok.addView(
            if (yaz) metin("YAZ: dokunur ve metin yazar", kirmizi, 16f, bold = true)
            else metin("Yalnız OKU: ekranı okur, dokunmaz, yazmaz", fg, 16f, bold = true),
        )

        kok.addView(baslik("Uygulamalar (adlar bu telefondan okunur)"))
        val cekirdek = Adaptor.cekirdek
        for (u in uygulamalar) {
            val d = cekirdek?.listeler?.durum(u.paket) ?: UygulamaDurumu.YENI
            val etiket = if (d == UygulamaDurumu.ACIK) "" else "   [${durumAdi(d)}]"
            val renk = if (d == UygulamaDurumu.ACIK) fg else kirmizi
            kok.addView(metin(temiz(u.ad) + etiket, renk, 16f, bold = true))
            kok.addView(metin(temiz(u.paket), soluk, 12f))
        }

        if (yaz && i.izinliMetin.isNotEmpty()) {
            kok.addView(baslik("Yazılabilecek metinler (birebir, her biri bir kez)"))
            kok.addView(kutu(i.izinliMetin.joinToString("\n\n") { "\"" + temiz(it) + "\"" }, fg))
        }
        if (yaz && i.serbestMetin) {
            kok.addView(
                kutu(
                    "SERBEST METİN: PC bu uygulamada, bütçe bitene kadar istediği HER metni yazabilir " +
                        "(mesaj, arama, form, ödeme notu). Ne yazacağını siz denetleyemezsiniz. " +
                        "Yalnız bu bilgisayara ve göreve tam güveniyorsanız onaylayın.",
                    kirmizi,
                    kalin = true,
                ),
            )
        }

        // Süre ve bütçe
        val varsSure = if (yaz) CekirdekSinirlari.YAZMA_SURESI_MS else CekirdekSinirlari.OKUMA_SURESI_MS
        val varsButce = if (yaz) CekirdekSinirlari.YAZMA_BUTCESI else CekirdekSinirlari.OKUMA_BUTCESI
        kok.addView(baslik("Süre"))
        sureGrubu = RadioGroup(this)
        for (dk in SURELER_DK) {
            val ms = dk * 60_000L
            if (ms > CekirdekSinirlari.AZAMI_SURE_MS) continue
            val rb = radyo("$dk dk" + if (ms == varsSure) " (varsayılan)" else "")
            sureGrubu.addView(rb)
            sureIdleri[rb.id] = ms
            if (ms == varsSure) sureGrubu.check(rb.id)
        }
        kok.addView(sureGrubu)
        kok.addView(baslik("Bütçe (en çok bu kadar dokunma/yazma eylemi)"))
        butceGrubu = RadioGroup(this)
        for (b in BUTCELER) {
            if (b > CekirdekSinirlari.AZAMI_BUTCE) continue
            val rb = radyo("$b eylem" + if (b == varsButce) " (varsayılan)" else "")
            butceGrubu.addView(rb)
            butceIdleri[rb.id] = b
            if (b == varsButce) butceGrubu.check(rb.id)
        }
        kok.addView(butceGrubu)

        // Onay engelleri
        val engeller = engeller()
        hataMetni = metin("", kirmizi, 14f, bold = true)
        kok.addView(hataMetni)
        if (engeller.isNotEmpty()) {
            hataMetni.text = "Onaylanamaz:\n" + engeller.joinToString("\n") { "• $it" }
        }

        // Erişilebilirlik açılırken ilerleme
        bekleme = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            visibility = View.GONE
            setPadding(0, dp(8), 0, dp(4))
            addView(
                ProgressBar(this@OnayActivity).apply {
                    isIndeterminate = true
                    indeterminateTintList = android.content.res.ColorStateList.valueOf(Renkler.vurgu)
                },
                LinearLayout.LayoutParams(dp(24), dp(24)),
            )
            addView(metin("Erişilebilirlik servisi açılıyor…", fg, 14f).apply { setPadding(dp(12), dp(4), 0, dp(4)) })
        }
        kok.addView(bekleme)

        // YETKI_YOK: uygulamanın servisi kendisi açamıyor; kullanıcı ayarlardan elle açıp dönebilir.
        erisimEngeli = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            addView(
                kutu(
                    "Onaylanamaz: ${asistanAdi()} uygulaması erişilebilirlik servisini kendisi açamıyor; kurulumdaki adb adımı " +
                        "(WRITE_SECURE_SETTINGS izni) yapılmamış. İzin verilmedi.\n" +
                        "Ayarlar'dan ${asistanAdi()} uygulamasının erişilebilirlik servisini elle açıp bu ekrana dönün, sonra yeniden onaylayın.",
                    kirmizi,
                    kalin = true,
                ),
            )
            addView(
                dugme("Ayarları aç", Color.TRANSPARENT, Renkler.metin, Renkler.kenarGuclu) { erisimAyariniAc() },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)).apply { topMargin = dp(8) },
            )
        }
        kok.addView(erisimEngeli)

        val dugmeler = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(16), 0, 0)
        }
        val reddet = dugme("Reddet", Color.TRANSPARENT, Renkler.metin, Renkler.kenarGuclu) { bitir("reddedildi") }
        dugmeler.addView(reddet, LinearLayout.LayoutParams(0, dp(52), 1f).apply { rightMargin = dp(8) })
        if (engeller.isEmpty()) {
            val onay = dugme(
                if (biyometriGerek(i)) "Onayla (kimlik doğrulama)" else "Onayla",
                Renkler.vurgu,
                Renkler.dolguUstu,
            ) { onayla() }
            onayDugmesi = onay
            dugmeler.addView(onay, LinearLayout.LayoutParams(0, dp(52), 1f).apply { leftMargin = dp(8) })
        }
        kok.addView(dugmeler)

        val sv = ScrollView(this).apply {
            setBackgroundColor(Renkler.zemin)
            isFillViewport = true
            addView(kok, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        guvenliYap(sv)
        setContentView(sv)
        guvenliYap(window.decorView)
    }

    /** Onayı engelleyen nedenler; boşsa onay düğmesi görünür. Her çağrıda taze okunur. */
    private fun engeller(): List<String> {
        val i = istek ?: return listOf("Plan geçersiz")
        val c = Adaptor.cekirdek ?: return listOf("Servis çalışmıyor")
        val sonuc = ArrayList<String>()
        if (uygulamalar.isEmpty()) sonuc.add("Uygulama listesi boş")
        if (i.mod == IzinModu.YAZ && uygulamalar.size != 1) sonuc.add("Yazma izni tek uygulamaya verilir")
        for (u in uygulamalar) {
            when (c.listeler.durum(u.paket)) {
                UygulamaDurumu.ACIK -> Unit
                UygulamaDurumu.DEGISMEZ ->
                    sonuc.add("${temiz(u.ad)}: değişmez ret listesinde (sistem/güvenlik uygulaması ya da bu uygulamanın kendisi)")
                UygulamaDurumu.HASSAS ->
                    sonuc.add("${temiz(u.ad)}: Uygulamalar ekranında kapalı; açmak için oradan açın")
                UygulamaDurumu.YENI ->
                    sonuc.add("${temiz(u.ad)}: bu telefonda kurulu değil")
            }
        }
        if (biyometriGerek(i) && !biyometriVarMi()) {
            sonuc.add("Bu izin için ekran kilidi/biyometri gerekir; telefonda kurulu değil")
        }
        return sonuc
    }

    // ---------------------------------------------------------------------------------------
    // Onay akışı
    // ---------------------------------------------------------------------------------------

    private fun onayla() {
        if (bitti || biyometrideMi || erisimBekleniyor) return
        val i = istek ?: return
        val e = engeller()
        if (e.isNotEmpty()) {
            hataMetni.text = "Onaylanamaz:\n" + e.joinToString("\n") { "• $it" }
            return
        }
        if (biyometriGerek(i)) biyometriIste() else erisimiAc()
    }

    private fun biyometriGerek(i: TelefonIzinIstegi) = i.mod == IzinModu.YAZ || i.serbestMetin

    private fun biyometriVarMi(): Boolean {
        val bm = getSystemService(BiometricManager::class.java) ?: return false
        return bm.canAuthenticate(yetki) == BiometricManager.BIOMETRIC_SUCCESS
    }

    private fun biyometriIste() {
        val sinyal = CancellationSignal()
        iptalSinyali = sinyal
        biyometrideMi = true
        val bp = BiometricPrompt.Builder(this)
            .setTitle("İzni onayla")
            .setSubtitle("${asistanAdi()} bu telefonda yazma ya da serbest metin yetkisi alacak")
            .setAllowedAuthenticators(yetki)
            .build()
        bp.authenticate(
            sinyal,
            mainExecutor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult?) {
                    biyometrideMi = false
                    erisimiAc()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) {
                    biyometrideMi = false
                    if (!bitti) hataMetni.text = "Kimlik doğrulama tamamlanmadı; izin verilmedi."
                }
            },
        )
    }

    /**
     * Kullanıcı onayı (ve gerekiyorsa biyometri) sonrası, izin doğmadan HEMEN önce erişilebilirlik
     * servisini açar. İzin yalnız `ACIK`'tan sonra doğar; böylece PC'nin ilk komutu servis henüz
     * bağlanmadı diye `erisilebilirlik_kapali` ile yanmaz.
     */
    private fun erisimiAc() {
        if (bitti || erisimBekleniyor) return
        if (plan == null || istek == null) return
        if (Adaptor.cekirdek == null) return bitir("gecersiz")
        val e = engeller()
        if (e.isNotEmpty()) {
            hataMetni.text = "Onaylanamaz:\n" + e.joinToString("\n") { "• $it" }
            return
        }
        val deneme = ++erisimDenemesi
        beklemeyiGoster(true)
        // Sözleşme: ana iplikte çağrılır; yanıt en geç ~4 sn içinde, bir kez, ana iplikte gelir
        // (aynı çağrı içinde de gelebilir; bu satırdan sonra iş yapılmaz).
        ErisimAnahtari.ac(applicationContext) { sonuc -> erisimSonucu(deneme, sonuc) }
    }

    private fun erisimSonucu(deneme: Int, sonuc: AcmaSonucu) {
        if (deneme != erisimDenemesi || !erisimBekleniyor) return
        beklemeyiGoster(false)
        // Reddet/geri/ekrandan ayrılma bekleme sırasında olduysa izin doğmaz.
        if (bitti || isFinishing || isDestroyed) return
        when (sonuc) {
            AcmaSonucu.ACIK -> izinUret()
            AcmaSonucu.YETKI_YOK -> {
                hataMetni.text = ""
                erisimEngeli.visibility = View.VISIBLE
            }
            AcmaSonucu.ZAMAN_ASIMI -> {
                hataMetni.text = "Erişilebilirlik servisi zamanında bağlanmadı; izin verilmedi. " +
                    "Yeniden onaylayarak tekrar deneyebilirsiniz."
            }
        }
    }

    /** Bekleme sırasında ilerleme görünür; onay düğmesi ve süre/bütçe seçimi kilitlenir. */
    private fun beklemeyiGoster(acik: Boolean) {
        erisimBekleniyor = acik
        bekleme.visibility = if (acik) View.VISIBLE else View.GONE
        onayDugmesi?.let {
            it.isEnabled = !acik
            it.alpha = if (acik) 0.5f else 1f
        }
        for (g in listOf(sureGrubu, butceGrubu)) {
            for (k in 0 until g.childCount) g.getChildAt(k).isEnabled = !acik
        }
        if (acik) {
            hataMetni.text = ""
            erisimEngeli.visibility = View.GONE
        }
    }

    /** "Ayarları aç": köprüdeki `ayarAc("erisilebilirlik")` ile aynı sabit hedef. Dönüşte yeniden denenebilir. */
    private fun erisimAyariniAc() {
        if (bitti || biyometrideMi || erisimBekleniyor || ayardaMi) return
        ayardaMi = true
        try {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        } catch (_: Exception) {
            ayardaMi = false
            hataMetni.text = "Erişilebilirlik ayarları açılamadı; telefonun Ayarlar uygulamasından açın."
            return
        }
        anaIplik.removeCallbacks(ayarSuresiDoldu)
        anaIplik.postDelayed(ayarSuresiDoldu, AYAR_AZAMI_MS)
    }

    /**
     * İzin doğan tek nokta (değişmez 1). Yalnız `erisimSonucu` içinden, `AcmaSonucu.ACIK` ile çağrılır.
     * Doğrulamadan sonra durum bir kez daha taze okunur.
     */
    private fun izinUret() {
        if (bitti) return
        val p = plan ?: return
        val i = istek ?: return
        val c = Adaptor.cekirdek ?: return bitir("gecersiz")
        val e = engeller()
        if (e.isNotEmpty()) {
            hataMetni.text = "Onaylanamaz:\n" + e.joinToString("\n") { "• $it" }
            return
        }
        val sure = sureIdleri[sureGrubu.checkedRadioButtonId] ?: return bitir("gecersiz")
        val butce = butceIdleri[butceGrubu.checkedRadioButtonId] ?: return bitir("gecersiz")
        val yaz = i.mod == IzinModu.YAZ
        val onay = OnayliIzin(
            planId = p.planId,
            planHash = hash,
            mod = i.mod,
            uygulamalar = uygulamalar.map { IzinliUygulama(it.paket, it.ad) },
            izinliMetin = if (yaz) i.izinliMetin else emptyList(),
            serbestMetin = yaz && i.serbestMetin,
            sureMs = sure,
            butce = butce,
        )
        val kayit = c.izinler.ekle(onay) ?: return bitir("gecersiz")
        Adaptor.oturumGuncelle?.izinEklendi(kayit)
        bitir("onaylandi", kayit.grantId)
    }

    private fun bitir(sonuc: String, grantId: String? = null) {
        if (bitti) return
        bitti = true
        iptalSinyali?.cancel()
        val veri = Intent().putExtra(EXTRA_SONUC, sonuc)
        if (grantId != null) veri.putExtra(EXTRA_GRANT_ID, grantId)
        setResult(RESULT_OK, veri)
        finish()
    }

    @Deprecated("Geri tuşu iptaldir")
    override fun onBackPressed() {
        bitir("iptal")
    }

    override fun onStop() {
        super.onStop()
        // Ekrandan ayrıldıysa (ana ekran, başka uygulama) onay bayatlar; biyometri penceresi ve
        // "Ayarları aç" ile gidilen erişilebilirlik ayarları (AYAR_AZAMI_MS ile süreli) hariç.
        if (!bitti && !biyometrideMi && !ayardaMi && !isChangingConfigurations) bitir("iptal")
    }

    override fun onResume() {
        super.onResume()
        if (!ayardaMi) return
        // Erişilebilirlik ayarlarından dönüş: süre sayacı durur, başka servis uyarısı tazelenir.
        ayardaMi = false
        anaIplik.removeCallbacks(ayarSuresiDoldu)
        if (!bitti) digerUyariGuncelle()
    }

    override fun onDestroy() {
        anaIplik.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    // ---------------------------------------------------------------------------------------
    // Dokunuş güvenliği
    // ---------------------------------------------------------------------------------------

    private fun gizliDokunus(e: MotionEvent): Boolean =
        (e.flags and (FLAG_GIZLI or FLAG_KISMEN_GIZLI)) != 0

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (gizliDokunus(ev)) {
            if (::gizliUyari.isInitialized) {
                gizliUyari.text = "Ekranın üstünde başka bir pencere var; dokunuş reddedildi."
                gizliUyari.visibility = View.VISIBLE
            }
            return true
        }
        return super.dispatchTouchEvent(ev)
    }

    /** Yalnız gerçek, gizlenmemiş parmak dokunuşu eylemi tetikler; erişilebilirlik tıklaması tetiklemez. */
    private fun dugme(ad: String, renk: Int, yaziRengi: Int, kenarRengi: Int? = null, eylem: () -> Unit): Button {
        val b = Button(this)
        b.text = ad
        b.setTextColor(yaziRengi)
        b.isAllCaps = false
        b.background = GradientDrawable().apply {
            setColor(renk)
            if (kenarRengi != null) setStroke(dp(1), kenarRengi)
            cornerRadius = dp(10).toFloat()
        }
        b.filterTouchesWhenObscured = true
        var basladi = false
        b.setOnTouchListener { v, e ->
            if (gizliDokunus(e)) {
                basladi = false
                v.isPressed = false
                return@setOnTouchListener true
            }
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    basladi = true
                    v.isPressed = true
                }
                MotionEvent.ACTION_UP -> {
                    v.isPressed = false
                    val icinde = e.x >= 0 && e.y >= 0 && e.x <= v.width && e.y <= v.height
                    if (basladi && icinde) eylem()
                    basladi = false
                }
                MotionEvent.ACTION_CANCEL -> {
                    basladi = false
                    v.isPressed = false
                }
            }
            true
        }
        b.accessibilityDelegate = object : View.AccessibilityDelegate() {
            override fun performAccessibilityAction(host: View, action: Int, args: Bundle?): Boolean {
                if (action == AccessibilityNodeInfo.ACTION_CLICK ||
                    action == AccessibilityNodeInfo.ACTION_LONG_CLICK
                ) {
                    return false
                }
                return super.performAccessibilityAction(host, action, args)
            }

            override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
                super.onInitializeAccessibilityNodeInfo(host, info)
                info.removeAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_CLICK)
                info.removeAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_LONG_CLICK)
                info.isClickable = false
            }
        }
        return b
    }

    /** Tüm ağaca: örtülü dokunuşu süz, API 34+ erişilebilirlik verisini hassas say. */
    private fun guvenliYap(v: View) {
        v.filterTouchesWhenObscured = true
        if (Build.VERSION.SDK_INT >= 34) {
            v.setAccessibilityDataSensitive(View.ACCESSIBILITY_DATA_SENSITIVE_YES)
        }
        if (v is ViewGroup) for (k in 0 until v.childCount) guvenliYap(v.getChildAt(k))
    }

    private fun digerUyariGuncelle() {
        val digerleri = digerErisilebilirlikServisleri()
        if (digerleri.isEmpty()) {
            digerUyari.visibility = View.GONE
            return
        }
        digerUyari.text = "UYARI: Başka erişilebilirlik servisleri etkin: " + digerleri.joinToString(", ") +
            ". Bunlar bu ekranı ve izin verdiğiniz uygulamaların içeriğini görebilir. " +
            "Tanımadığınız bir servis varsa onaylamayın."
        digerUyari.visibility = View.VISIBLE
    }

    private fun digerErisilebilirlikServisleri(): List<String> {
        val am = getSystemService(AccessibilityManager::class.java) ?: return emptyList()
        return am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
            .filter { it.resolveInfo?.serviceInfo?.packageName != packageName }
            .map {
                val pk = it.resolveInfo?.serviceInfo?.packageName ?: "?"
                val ad = it.resolveInfo?.loadLabel(packageManager)?.toString() ?: pk
                temiz(ad) + " (" + temiz(pk) + ")"
            }
    }

    // ---------------------------------------------------------------------------------------
    // Küçük yardımcılar
    // ---------------------------------------------------------------------------------------

    private fun durumAdi(d: UygulamaDurumu) = when (d) {
        UygulamaDurumu.ACIK -> "açık"
        UygulamaDurumu.HASSAS -> "kapalı"
        UygulamaDurumu.YENI -> "kurulu değil"
        UygulamaDurumu.DEGISMEZ -> "kilitli"
    }

    /** Güvenilmez metinde görünmez/yön değiştiren denetim karakterleri görünür işaretle değişir. */
    private fun temiz(s: String): String {
        val sb = StringBuilder(s.length)
        for (ch in s) {
            val t = Character.getType(ch)
            val kotu = (t == Character.FORMAT.toInt() || t == Character.CONTROL.toInt() ||
                t == Character.LINE_SEPARATOR.toInt() || t == Character.PARAGRAPH_SEPARATOR.toInt()) &&
                ch != '\n' && ch != '\t'
            sb.append(if (kotu) '·' else ch)
        }
        return sb.toString()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun metin(s: String, renk: Int, sp: Float, bold: Boolean = false) = TextView(this).apply {
        text = s
        setTextColor(renk)
        textSize = sp
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setTextIsSelectable(false)
        setPadding(0, dp(4), 0, dp(4))
    }

    private fun baslik(s: String) = metin(s, soluk, 13f, bold = true).apply { setPadding(0, dp(16), 0, dp(4)) }

    private fun kutu(s: String, renk: Int, kalin: Boolean = false) = metin(s, renk, 15f, bold = kalin).apply {
        setPadding(dp(12), dp(10), dp(12), dp(10))
        background = GradientDrawable().apply {
            setColor(if (renk == kirmizi) Renkler.hataZemin else Renkler.yuzey)
            setStroke(dp(1), if (renk == kirmizi) kirmizi else Renkler.kenar)
            cornerRadius = dp(8).toFloat()
        }
    }

    private fun radyo(s: String) = RadioButton(this).apply {
        id = View.generateViewId()
        text = s
        setTextColor(fg)
        buttonTintList = android.content.res.ColorStateList.valueOf(Renkler.vurgu)
    }
}
