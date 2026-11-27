package dev.eren.ajanda.ekran

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Paint
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.provider.Settings
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import dev.eren.ajanda.CekirdekErisimi
import dev.eren.ajanda.R
import dev.eren.ajanda.ag.BaglantiYoneticisi
import dev.eren.ajanda.aktarma.AktarmaAkisi
import dev.eren.ajanda.aktarma.AktarmaMetinleri
import dev.eren.ajanda.alarm.AlarmYenidenKurma
import dev.eren.ajanda.alarm.Bildirimler
import dev.eren.ajanda.alarm.HatirlatmaDurumu
import dev.eren.ajanda.alarm.HatirlatmaSorunu
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.Gozlemci
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.YenidenKurmaNedeni
import dev.eren.ajanda.kimlik.EslestirmeEkrani
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * SAHİBİ: K4. Başlatıcı etkinlik: üç ana sekme (tarihliler, tarihsizler, takvim), yardımcı görünümler
 * (taslaklar, silinenler, gönderilemeyenler), PC bağlantı göstergesi, uyarı şeritleri, ekleme düğmesi
 * ve geri alma çubuğu. Mantık [AnaDenetleyici]'de ve saf nesnelerde ([Liste], [DurumGostergesi],
 * [HatirlatmaUyarilari], [RetListesi], [Yenileme]); bu sınıf yalnız çizer ve olayları iletir.
 *
 * İş parçacığı: bütün çekirdek çağrıları tek arka iş parçacığında ([arka]); gözlemci yalnız bekleyen
 * değişikliği biriktirir ve oraya iş atar (çekirdeğe geri girmez). Çizim ana iş parçacığında.
 */
class AnaEkran : Activity() {

    private lateinit var t: Tasarim
    private val ana = Handler(Looper.getMainLooper())
    private val arka: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "ajanda-ekran") }

    /** Yalnız [arka]'da erişilir. */
    private var denetleyici: AnaDenetleyici? = null
    /** Yalnız [arka]'da erişilir (dışa ve içe aktarma, D3). */
    private var aktarma: AktarmaAkisi? = null
    private var gozlemciNo: ULong? = null

    private val bekleyenKilit = Any()
    private var bekleyen: Degisim? = null
    private var yenilemeSirada = false

    private val gozlemci = object : Gozlemci {
        // Çekirdeğin etki kilidi altında gelir: yalnız biriktirir, okuma arka iş parçacığında.
        override fun degisti(degisim: Degisim) {
            val is_ = synchronized(bekleyenKilit) {
                bekleyen = Yenileme.birlestir(bekleyen, degisim)
                if (yenilemeSirada) false else true.also { yenilemeSirada = true }
            }
            if (is_) arkada {
                val d = synchronized(bekleyenKilit) {
                    yenilemeSirada = false
                    bekleyen.also { bekleyen = null }
                }
                if (d != null) {
                    denetleyiciAl().degisti(d)
                    modeliGonder()
                }
            }
        }
    }

    // Ana iş parçacığı durumu
    private var model: AnaModel? = null
    private var sonAnaGorunum = Gorunum.TARIHLI
    private var hatirlatma: HatirlatmaDurumu? = null
    private var izinIstendi = false
    private var geriCagrisi: Any? = null

    private lateinit var kok: FrameLayout
    private lateinit var gunAdi: TextView
    private lateinit var baslik: TextView
    private lateinit var geriDugmesi: TextView
    private lateinit var gosterge: TextView
    private lateinit var seritler: LinearLayout
    private lateinit var sekmeler: LinearLayout
    private lateinit var sekmeTarihli: TextView
    private lateinit var sekmeTarihsiz: TextView
    private lateinit var sekmeTakvim: TextView
    private lateinit var takvimGorunumu: TakvimGorunumu
    /** Döndürme/süreç ölümünden gelen takvim seçimi (model gelene dek kayıtta korunur). */
    private var kayitliTakvim: TakvimDurumu? = null
    private lateinit var liste: ListView
    private lateinit var yukleniyor: ProgressBar
    private lateinit var ekleDugmesi: TextView
    private lateinit var cubuk: LinearLayout
    private lateinit var cubukMetni: TextView
    private lateinit var cubukEylemi: TextView
    private val uyarlayici = Uyarlayici()

    private val tercih: SharedPreferences by lazy { getSharedPreferences("ajanda_ekran", MODE_PRIVATE) }

    // ---------------------------------------------------------------------------------------------
    // Yaşam döngüsü
    // ---------------------------------------------------------------------------------------------

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.EkranTema)
        super.onCreate(savedInstanceState)
        t = Tasarim(this)
        kur()
        if (savedInstanceState == null) {
            // Açılışta alarmlar yeniden kurdurulur (bildirim kanallarını da kurar); kendi iş parçacığında.
            AlarmYenidenKurma.arkaPlanda(this, YenidenKurmaNedeni.UYGULAMA_ACILDI)
            bildirimdenGeldiyse(intent)
        } else {
            sonAnaGorunum = runCatching { Gorunum.valueOf(savedInstanceState.getString("gorunum") ?: "") }.getOrDefault(Gorunum.TARIHLI)
            izinIstendi = savedInstanceState.getBoolean("izin_istendi")
            kayitliTakvim = TakvimDurumu.coz(savedInstanceState.getString("takvim"))
        }
        val kapalilar = tercih.getBoolean("kapalilar", false)
        val ilk = sonAnaGorunum
        val takvim = kayitliTakvim
        arkada {
            val d = denetleyiciAl()
            // Seçim önce: gün o arada değiştiyse model kuralı uygular (TakvimDurumu.bugunGuncelle).
            takvim?.let { d.takvimGeriYukle(it) }
            d.kapalilariGoster(kapalilar)
            d.gorunumSec(ilk)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString("gorunum", (model?.gorunum ?: sonAnaGorunum).name)
        outState.putBoolean("izin_istendi", izinIstendi)
        (model?.takvimDurumu ?: kayitliTakvim)?.let { outState.putString("takvim", it.metin()) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        bildirimdenGeldiyse(intent)
    }

    override fun onStart() {
        super.onStart()
        arkada {
            val d = denetleyiciAl()
            gozlemciNo = CekirdekErisimi.al(applicationContext).gozlemciEkle(gozlemci)
            d.hepsiniOku()
            modeliGonder()
        }
        // Bağlantı herhangi bir ekran görünürken açıktır: kural tek yerde (`ag/GorunurlukSayaci.kt`).
        hatirlatmayiOku()
        dakikaSayaci.run()
        if (!izinIstendi && HatirlatmaDurumu.bildirimIzniIstenmeli(this)) {
            izinIstendi = true
            bildirimIzniIste()
        }
    }

    override fun onStop() {
        ana.removeCallbacks(dakikaSayaci)
        arkada {
            val no = gozlemciNo ?: return@arkada
            gozlemciNo = null
            CekirdekErisimi.al(applicationContext).gozlemciCikar(no)
        }
        super.onStop()
    }

    override fun onDestroy() {
        ana.removeCallbacksAndMessages(null)
        arka.shutdown()
        super.onDestroy()
    }

    /** Gün değişimi ve "5 dk önce" metinleri için dakikada bir yeniden gruplar (çekirdeğe sormadan). */
    private val dakikaSayaci = object : Runnable {
        override fun run() {
            arkada { modeliGonder() }
            ana.postDelayed(this, 60_000)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            ISTEK_KAYIT -> if (resultCode == RESULT_OK && data != null) {
                val geriAlma = data.getStringExtra(SONUC_GERI_YUKLE)?.let { GeriAlma.GeriYukle(it) }
                    ?: data.getStringExtra(SONUC_YENIDEN_AC)?.let { GeriAlma.Durum(it, KayitDurumu.ACIK) }
                data.getStringExtra(KayitEkrani.SONUC_MESAJI)?.let { cubukGoster(it, geriAlma) }
            }
            ISTEK_DISA_AKTAR -> data?.data?.takeIf { resultCode == RESULT_OK }?.let { uri ->
                arkada {
                    val adim = aktarmaAl().disaAktar(
                        ac = { contentResolver.openOutputStream(uri, "wt") ?: throw java.io.IOException("akış yok") },
                        basarisizsa = { DocumentsContract.deleteDocument(contentResolver, uri) },
                    )
                    anada { aktarmaGoster(adim) }
                }
            }
            ISTEK_ICE_AKTAR -> data?.data?.takeIf { resultCode == RESULT_OK }?.let { uri ->
                arkada {
                    val adim = aktarmaAl().dosyaOku { contentResolver.openInputStream(uri) ?: throw java.io.IOException("akış yok") }
                    anada { aktarmaGoster(adim) }
                }
            }
            ISTEK_ESLESTIRME -> {
                arkada {
                    denetleyiciAl().hepsiniOku()
                    modeliGonder()
                }
                if (resultCode == RESULT_OK) BaglantiYoneticisi.simdiDene()
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == ISTEK_IZIN) hatirlatmayiOku()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (model?.gorunum?.anaSekme == false) gorunumSec(sonAnaGorunum) else @Suppress("DEPRECATION") super.onBackPressed()
    }

    /** Android 13+: geri hareketi yardımcı görünümden ana sekmeye döner (targetSdk 36'da onBackPressed gelmez). */
    private fun geriyiAyarla(yardimci: Boolean) {
        if (Build.VERSION.SDK_INT < 33) return
        val d = onBackInvokedDispatcher
        val mevcut = geriCagrisi as? OnBackInvokedCallback
        if (yardimci && mevcut == null) {
            val cb = OnBackInvokedCallback { gorunumSec(sonAnaGorunum) }
            d.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb)
            geriCagrisi = cb
        } else if (!yardimci && mevcut != null) {
            d.unregisterOnBackInvokedCallback(mevcut)
            geriCagrisi = null
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Arka iş parçacığı
    // ---------------------------------------------------------------------------------------------

    private fun denetleyiciAl(): AnaDenetleyici = denetleyici ?: AnaDenetleyici(
        CekirdekYuzu.Gercek(CekirdekErisimi.al(applicationContext)),
    ) { ZonedDateTime.now() }.also { denetleyici = it }

    private fun aktarmaAl(): AktarmaAkisi = aktarma ?: AktarmaAkisi(
        CekirdekYuzu.Gercek(CekirdekErisimi.al(applicationContext)),
        AktarmaMetinleri(ZoneId.systemDefault()),
    ).also { aktarma = it }

    private fun arkada(isi: () -> Unit) {
        try {
            arka.execute {
                try {
                    isi()
                } catch (e: Exception) {
                    anada { cubukGoster(KayitFormu.hataMesaji(e).mesaj, null) }
                } catch (e: LinkageError) {
                    // Yerel kitaplık yüklenemedi: çökmek yerine söyle.
                    anada { cubukGoster("Ajanda çekirdeği yüklenemedi.", null) }
                }
            }
        } catch (_: RejectedExecutionException) {
            // Etkinlik kapanıyor.
        }
    }

    private fun anada(f: () -> Unit) {
        ana.post { if (!isDestroyed) f() }
    }

    private fun modeliGonder() {
        val m = denetleyiciAl().model()
        anada { ciz(m) }
    }

    private fun islem(f: (AnaDenetleyici) -> IslemSonucu) = arkada {
        val s = f(denetleyiciAl())
        anada { if (s.mesaj != null) cubukGoster(s.mesaj, s.geriAlma) }
    }

    // ---------------------------------------------------------------------------------------------
    // Görünüm kurulumu
    // ---------------------------------------------------------------------------------------------

    private fun kur() {
        kok = FrameLayout(this).apply { setBackgroundColor(t.zemin) }
        val dikey = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        kok.addView(dikey, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        // Üst çubuk: (geri) gün + tarih | gösterge | menü
        val ust = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(t.dp(16), t.dp(12), t.dp(4), t.dp(4))
        }
        geriDugmesi = t.metinDugmesi("←", t.murekkep) { gorunumSec(sonAnaGorunum) }.apply {
            textSize = 22f
            contentDescription = "Geri"
            visibility = View.GONE
        }
        ust.addView(geriDugmesi)
        val basliklar = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        gunAdi = t.yazi("", 12f, t.soluk, kalin = true).apply { letterSpacing = 0.12f }
        baslik = t.yazi("", 26f, t.murekkep, serif = true).apply {
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            isFocusable = true
            accessibilityHeading()
        }
        basliklar.addView(gunAdi)
        basliklar.addView(baslik)
        ust.addView(basliklar, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        gosterge = t.yazi("…", 13f, t.soluk).apply {
            gravity = Gravity.CENTER_VERTICAL
            minHeight = t.dp(36)
            setPadding(t.dp(10), t.dp(4), t.dp(12), t.dp(4))
            background = t.dokunulur(t.yuvarlak(t.yuzey, 18f, t.cizgi))
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            maxWidth = t.dp(180)
            compoundDrawablePadding = t.dp(6)
            setOnClickListener { durumPenceresi() }
        }
        ust.addView(gosterge)
        lateinit var menu: TextView
        menu = t.metinDugmesi("⋮", t.murekkep) { menuAc(menu) }.apply {
            textSize = 22f
            contentDescription = "Diğer seçenekler"
        }
        ust.addView(menu)
        dikey.addView(ust)

        seritler = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(t.dp(12), 0, t.dp(12), 0)
        }
        dikey.addView(seritler)

        // Sekmeler: üç eşit sekme, seçili olanın altı vurgu çizgili.
        sekmeler = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(t.dp(12), t.dp(8), t.dp(12), 0)
        }
        sekmeTarihli = sekme(EkranMetinleri.TARIHLILER) { gorunumSec(Gorunum.TARIHLI) }
        sekmeTarihsiz = sekme(EkranMetinleri.TARIHSIZLER) { gorunumSec(Gorunum.TARIHSIZ) }
        sekmeTakvim = sekme(EkranMetinleri.TAKVIM) { gorunumSec(Gorunum.TAKVIM) }
        for (s in listOf(sekmeTarihli, sekmeTarihsiz, sekmeTakvim)) {
            sekmeler.addView(s, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        }
        dikey.addView(sekmeler)

        takvimGorunumu = TakvimGorunumu(
            this, t,
            gunSec = { g -> arkada { denetleyiciAl().takvimGunSec(g); modeliGonder() } },
            ayKaydir = { n ->
                arkada { denetleyiciAl().takvimAyKaydir(n); modeliGonder() }
                arkada { denetleyiciAl().takvimKomsulari() }
            },
            bugune = { arkada { denetleyiciAl().takvimBugune(); modeliGonder() } },
            ekle = { g -> KayitEkrani.yeni(this, ISTEK_KAYIT, g, KayitTuru.GOREV) },
        )
        dikey.addView(t.ayirici())

        val govde = FrameLayout(this)
        liste = ListView(this).apply {
            divider = null
            dividerHeight = 0
            selector = GradientDrawable().apply { setColor(0) }
            clipToPadding = false
            setPadding(0, t.dp(4), 0, t.dp(96))
            adapter = uyarlayici
            // Satırlar kendi tıklamasını alır: içlerinde tıklanabilir halka ve düğmeler var, ListView'in
            // öğe tıklaması bu durumda gelmez.
            itemsCanFocus = true
        }
        govde.addView(liste, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        yukleniyor = ProgressBar(this)
        govde.addView(yukleniyor, FrameLayout.LayoutParams(t.dp(40), t.dp(40), Gravity.CENTER))
        dikey.addView(govde, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        // Ekleme düğmesi (sağ alt).
        ekleDugmesi = t.yazi("+", 30f, t.vurguUzerine).apply {
            gravity = Gravity.CENTER
            background = t.dokunulur(GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(t.vurgu) })
            elevation = t.dpf(6f)
            contentDescription = "Yeni kayıt ekle"
            isClickable = true
            isFocusable = true
            setOnClickListener { yeniKayit() }
        }
        kok.addView(ekleDugmesi, FrameLayout.LayoutParams(t.dp(60), t.dp(60), Gravity.BOTTOM or Gravity.END).apply {
            setMargins(0, 0, t.dp(20), t.dp(20))
        })

        // Geri alma çubuğu (alt).
        cubuk = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = t.yuvarlak(t.murekkep, 12f)
            elevation = t.dpf(8f)
            setPadding(t.dp(16), t.dp(6), t.dp(6), t.dp(6))
            visibility = View.GONE
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        cubukMetni = t.yazi("", 15f, t.zemin)
        cubukEylemi = t.metinDugmesi("Geri al", t.taslakZemin) {}
        cubuk.addView(cubukMetni, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        cubuk.addView(cubukEylemi)
        kok.addView(cubuk, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM).apply {
            setMargins(t.dp(12), 0, t.dp(12), t.dp(12))
        })

        Tasarim.payUygula(kok)
        setContentView(kok)
        Tasarim.cubuklar(this, t.koyu)
        basligiYaz(Gorunum.TARIHLI)
        sekmeleriCiz(Gorunum.TARIHLI)
    }

    private fun TextView.accessibilityHeading() {
        if (Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true
    }

    private fun sekme(ad: String, tik: () -> Unit) = t.yazi(ad, 16f, t.soluk, kalin = true).apply {
        gravity = Gravity.CENTER
        minHeight = t.dp(48)
        // Büyük yazıda dar sekme iki satıra iner (kısaltılmaz); alt çizgi alta yaslıdır.
        maxLines = 2
        setPadding(t.dp(4), t.dp(6), t.dp(4), t.dp(8))
        isClickable = true
        isFocusable = true
        setOnClickListener { tik() }
    }

    private fun sekmeleriCiz(g: Gorunum) {
        sekmeler.visibility = if (g.anaSekme) View.VISIBLE else View.GONE
        for ((v, bu) in listOf(sekmeTarihli to Gorunum.TARIHLI, sekmeTarihsiz to Gorunum.TARIHSIZ, sekmeTakvim to Gorunum.TAKVIM)) {
            val secili = g == bu
            v.setTextColor(if (secili) t.murekkep else t.soluk)
            v.isSelected = secili
            v.background = t.dokunulur(if (secili) altCizgi() else null, t.yuvarlak(0xFFFFFFFF.toInt(), 0f))
            v.contentDescription = "${v.text} sekmesi" + if (secili) ", seçili" else ""
        }
    }

    private fun altCizgi() = android.graphics.drawable.LayerDrawable(
        arrayOf(GradientDrawable().apply { setColor(t.vurgu) }),
    ).apply {
        // Sekme yüksekliği yazı boyuyla değişir: çizgi sabit üst paya değil alta yaslı.
        setLayerGravity(0, Gravity.BOTTOM or Gravity.FILL_HORIZONTAL)
        setLayerHeight(0, t.dp(3))
        setLayerInsetLeft(0, t.dp(20))
        setLayerInsetRight(0, t.dp(20))
    }

    private fun basligiYaz(g: Gorunum) {
        val bugun = LocalDate.now()
        if (g.anaSekme) {
            gunAdi.text = EkranMetinleri.gunAdi(bugun.dayOfWeek).uppercase(java.util.Locale.forLanguageTag("tr"))
            gunAdi.visibility = View.VISIBLE
            baslik.text = EkranMetinleri.gunVeAy(bugun)
            baslik.contentDescription = "Bugün ${EkranMetinleri.uzunTarih(bugun, bugun)}"
        } else {
            gunAdi.visibility = View.GONE
            baslik.text = when (g) {
                Gorunum.TASLAKLAR -> EkranMetinleri.TASLAKLAR
                Gorunum.SILINENLER -> EkranMetinleri.SILINENLER
                Gorunum.RET -> EkranMetinleri.GONDERILEMEYENLER
                else -> EkranMetinleri.UYGULAMA
            }
            baslik.contentDescription = null
        }
        geriDugmesi.visibility = if (g.anaSekme) View.GONE else View.VISIBLE
        ekleDugmesi.visibility = if (g.anaSekme) View.VISIBLE else View.GONE
    }

    // ---------------------------------------------------------------------------------------------
    // Çizim
    // ---------------------------------------------------------------------------------------------

    private fun ciz(m: AnaModel) {
        val onceki = model
        model = m
        if (m.gorunum.anaSekme) sonAnaGorunum = m.gorunum
        basligiYaz(m.gorunum)
        sekmeleriCiz(m.gorunum)
        geriyiAyarla(!m.gorunum.anaSekme)
        gostergeyiCiz(m.gosterge)
        seritleriCiz(m)
        yukleniyor.visibility = if (m.yuklendi) View.GONE else View.VISIBLE
        uyarlayici.ver(m)
        if (onceki?.gorunum != m.gorunum) liste.setSelection(0)
        if (m.takvimDurumu != null) kayitliTakvim = m.takvimDurumu
        ekleDugmesi.contentDescription = m.takvim?.let {
            "Seçili güne yeni kayıt ekle: ${EkranMetinleri.uzunTarih(it.durum.secili, it.durum.bugun)}"
        } ?: "Yeni kayıt ekle"
    }

    private fun gostergeyiCiz(g: DurumGostergesi.Gosterge) {
        val renk = when (g.ton) {
            DurumGostergesi.Ton.IYI -> t.iyi
            DurumGostergesi.Ton.SURUYOR -> t.soluk
            DurumGostergesi.Ton.CEVRIMDISI -> t.soluk
            DurumGostergesi.Ton.UYARI -> t.gecikmis
        }
        gosterge.text = g.kisa
        gosterge.setTextColor(if (g.ton == DurumGostergesi.Ton.UYARI) t.gecikmis else t.murekkep)
        val nokta = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            if (g.ton == DurumGostergesi.Ton.CEVRIMDISI) setStroke(t.dp(2), renk) else setColor(renk)
            setSize(t.dp(9), t.dp(9))
        }
        gosterge.setCompoundDrawablesRelativeWithIntrinsicBounds(nokta, null, null, null)
        gosterge.contentDescription = "PC bağlantısı: ${g.kisa}. Ayrıntı için dokunun."
    }

    private fun seritleriCiz(m: AnaModel) {
        seritler.removeAllViews()
        if (!m.gorunum.anaSekme) return
        if (!m.eslesmeVar) {
            seritler.addView(serit("PC ile eşleşmedi; kayıtlar yalnız bu telefonda.", "Eşleştir", t.bilgiZemin, t.bilgiYazi) { eslestir() })
        }
        val h = hatirlatma
        if (h != null) {
            HatirlatmaUyarilari.seritMetni(h)?.let { metin ->
                val ilk = HatirlatmaUyarilari.serit(h)!!
                seritler.addView(serit("Hatırlatmalar çalmayabilir: $metin", ilk.dugme, t.uyariZemin, t.uyariYazi, govdeTik = { hatirlatmaPenceresi() }) { uyariCoz(ilk) })
            }
        }
        if (m.retSayisi > 0) {
            seritler.addView(serit("${m.retSayisi} değişiklik PC'ye gönderilemedi.", "Gör", t.uyariZemin, t.uyariYazi) { gorunumSec(Gorunum.RET) })
        }
        if (m.taslakSayisi > 0) {
            seritler.addView(serit("Asistan ${m.taslakSayisi} taslak ekledi; onayınızı bekliyor.", "Gözden geçir", t.taslakZemin, t.taslakYazi) { gorunumSec(Gorunum.TASLAKLAR) })
        }
    }

    private fun serit(metin: String, dugme: String, zemin: Int, yazi: Int, govdeTik: (() -> Unit)? = null, tik: () -> Unit): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = t.yuvarlak(zemin, 12f)
            setPadding(t.dp(14), t.dp(4), t.dp(4), t.dp(4))
            layoutParams = t.satirParam(ust = 6)
            val m = t.yazi(metin, 14f, yazi).apply { setPadding(0, t.dp(6), 0, t.dp(6)) }
            if (govdeTik != null) {
                m.isClickable = true
                m.setOnClickListener { govdeTik() }
            }
            addView(m, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(t.metinDugmesi(dugme, yazi, tik).apply { contentDescription = "$dugme: $metin" })
        }

    // ---------------------------------------------------------------------------------------------
    // Olaylar
    // ---------------------------------------------------------------------------------------------

    private fun gorunumSec(g: Gorunum) {
        if (g.anaSekme) sonAnaGorunum = g
        // Hemen başlık ve sekme değişsin; liste arka plandan gelince çizilir.
        basligiYaz(g)
        sekmeleriCiz(g)
        arkada {
            denetleyiciAl().gorunumSec(g)
            modeliGonder()
        }
        if (g == Gorunum.TAKVIM) arkada { denetleyiciAl().takvimKomsulari() }
    }

    private fun yeniKayit() {
        val g = model?.gorunum ?: sonAnaGorunum
        val tarih = when (g) {
            Gorunum.TARIHSIZ -> null
            // Takvimde form seçili günle açılır.
            Gorunum.TAKVIM -> model?.takvimDurumu?.secili ?: LocalDate.now()
            else -> LocalDate.now()
        }
        KayitEkrani.yeni(this, ISTEK_KAYIT, tarih, KayitTuru.GOREV)
    }

    private fun ogeMenusu(v: View, s: Liste.KayitSatiri): Boolean {
        val m = PopupMenu(this, v, Gravity.END)
        val eylemler = mutableListOf<Pair<String, () -> Unit>>()
        if (s.silindi) {
            eylemler += "Geri yükle" to { islem { it.geriYukle(s.kayitId) } }
        } else {
            // Takvimdeki tekrar örneğinde durum yalnız o güne; düzenleme ve silme serinin tamamına.
            val o = s.ornekTarihi
            if (s.taslak) eylemler += "Onayla" to { islem { it.onayla(s.kayitId) } }
            eylemler += if (s.kapali) "Yeniden aç" to { islem { it.durumDegistir(s.kayitId, KayitDurumu.ACIK, o) } }
            else "Tamamlandı" to { islem { it.durumDegistir(s.kayitId, KayitDurumu.TAMAM, o) } }
            eylemler += (if (o != null) "Seriyi düzenle" else "Düzenle") to { KayitEkrani.duzenle(this, ISTEK_KAYIT, s.kayitId) }
            if (!s.kapali) eylemler += "İptal et" to { islem { it.durumDegistir(s.kayitId, KayitDurumu.IPTAL, o) } }
            eylemler += (if (o != null) "Seriyi sil" else "Sil") to { islem { it.sil(s.kayitId) } }
        }
        eylemler.forEachIndexed { i, (ad, _) -> m.menu.add(0, i, i, ad) }
        m.setOnMenuItemClickListener { eylemler[it.itemId].second(); true }
        m.show()
        return true
    }

    private fun retMenusu(r: RetListesi.RetSatiri) {
        val b = AlertDialog.Builder(this)
            .setTitle(r.baslik)
            .setMessage("${r.islemMetni} gönderilemedi (${r.zaman}).\n${r.neden}")
            .setNegativeButton("Vazgeç", null)
            .setNeutralButton("At") { _, _ -> retAtOnayi(r) }
        if (r.duzeltilebilir) b.setPositiveButton("Düzelt") { _, _ -> KayitEkrani.retDuzelt(this, ISTEK_KAYIT, r.islemId) }
        b.show()
    }

    private fun retAtOnayi(r: RetListesi.RetSatiri) {
        AlertDialog.Builder(this)
            .setTitle("Değişiklik atılsın mı?")
            .setMessage("“${r.baslik}” için gönderilemeyen ${r.islemMetni.lowercase(java.util.Locale.forLanguageTag("tr"))} kalıcı olarak atılır.")
            .setPositiveButton("At") { _, _ -> islem { it.retAt(r.islemId) } }
            .setNegativeButton("Vazgeç", null)
            .show()
    }

    private fun menuAc(v: View) {
        val m = model
        val p = PopupMenu(this, v)
        val eylemler = mutableListOf<Pair<String, () -> Unit>>()
        eylemler += "Taslaklar (${m?.taslakSayisi ?: 0})" to { gorunumSec(Gorunum.TASLAKLAR) }
        eylemler += "Gönderilemeyenler (${m?.retSayisi ?: 0})" to { gorunumSec(Gorunum.RET) }
        eylemler += "Silinenler" to { gorunumSec(Gorunum.SILINENLER) }
        val kapalilar = m?.kapalilarDahil == true
        eylemler += (if (kapalilar) "Tamamlananları gizle" else "Tamamlananları göster") to { kapalilariGoster(!kapalilar) }
        eylemler += "Hatırlatma durumu" to { hatirlatmaPenceresi() }
        eylemler += "PC eşleştirmesi" to { eslestir() }
        eylemler += "Dışa aktar" to { dosyaSec(ISTEK_DISA_AKTAR) }
        eylemler += "İçe aktar" to { dosyaSec(ISTEK_ICE_AKTAR) }
        eylemler.forEachIndexed { i, (ad, _) -> p.menu.add(0, i, i, ad) }
        p.setOnMenuItemClickListener { eylemler[it.itemId].second(); true }
        p.show()
    }

    /** Sistem dosya seçicisi (SAF; izin gerekmez). Sonuç [onActivityResult]'ta. */
    private fun dosyaSec(istek: Int) {
        val niyet = if (istek == ISTEK_DISA_AKTAR) {
            Intent(Intent.ACTION_CREATE_DOCUMENT).putExtra(Intent.EXTRA_TITLE, AktarmaAkisi.onerilenAd(LocalDate.now()))
        } else {
            Intent(Intent.ACTION_OPEN_DOCUMENT)
        }.addCategory(Intent.CATEGORY_OPENABLE).setType(AktarmaAkisi.MIME)
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(niyet, istek)
        } catch (_: ActivityNotFoundException) {
            cubukGoster("Dosya seçici açılamadı.", null)
        }
    }

    /** Aktarma adımını gösterir; onay arka iş parçacığında sürer. */
    private fun aktarmaGoster(adim: AktarmaAkisi.Adim) {
        val b = AlertDialog.Builder(this).setTitle(adim.baslik).setMessage(adim.metin)
        if (adim is AktarmaAkisi.Adim.Onay) {
            b.setPositiveButton(adim.dugme) { _, _ ->
                arkada {
                    val s = aktarmaAl().onayla()
                    anada { aktarmaGoster(s) }
                }
            }
            b.setNegativeButton("Vazgeç") { _, _ -> arkada { aktarmaAl().vazgec() } }
            b.setOnCancelListener { arkada { aktarmaAl().vazgec() } }
        } else {
            b.setPositiveButton("Tamam", null)
        }
        b.show()
    }

    private fun kapalilariGoster(b: Boolean) {
        tercih.edit().putBoolean("kapalilar", b).apply()
        arkada {
            denetleyiciAl().kapalilariGoster(b)
            modeliGonder()
        }
    }

    private fun eslestir() {
        @Suppress("DEPRECATION")
        startActivityForResult(Intent(this, EslestirmeEkrani::class.java), ISTEK_ESLESTIRME)
    }

    private fun bildirimdenGeldiyse(i: Intent?) {
        val id = i?.getStringExtra(Bildirimler.KAYIT_ID) ?: return
        i.removeExtra(Bildirimler.KAYIT_ID)
        KayitEkrani.duzenle(this, ISTEK_KAYIT, id)
    }

    private fun durumPenceresi() {
        val g = model?.gosterge ?: return
        val b = AlertDialog.Builder(this)
            .setTitle("PC bağlantısı: ${g.kisa}")
            .setMessage(g.ayrinti)
            .setNegativeButton("Kapat", null)
        if (g.eylem == DurumGostergesi.Eylem.ESLESTIR) b.setPositiveButton("Eşleştir") { _, _ -> eslestir() }
        else b.setNeutralButton("Eşleştirme") { _, _ -> eslestir() }
        b.show()
    }

    // ---------------------------------------------------------------------------------------------
    // Hatırlatma sorunları
    // ---------------------------------------------------------------------------------------------

    private fun hatirlatmayiOku() {
        hatirlatma = try {
            HatirlatmaDurumu.oku(this)
        } catch (_: Exception) {
            null
        }
        model?.let { seritleriCiz(it) }
    }

    private fun bildirimIzniIste() {
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(HatirlatmaDurumu.BILDIRIM_IZNI), ISTEK_IZIN)
    }

    private fun uyariCoz(u: HatirlatmaUyarilari.Uyari) {
        when (u.cozum) {
            HatirlatmaUyarilari.Cozum.IZIN_ISTE -> {
                // İlk kez ya da gerekçe gösterilebiliyorsa sistem penceresi; kalıcı reddedildiyse ayar ekranı.
                if (Build.VERSION.SDK_INT >= 33 && (!tercih.getBoolean("izin_soruldu", false) ||
                        shouldShowRequestPermissionRationale(HatirlatmaDurumu.BILDIRIM_IZNI))
                ) {
                    tercih.edit().putBoolean("izin_soruldu", true).apply()
                    bildirimIzniIste()
                } else {
                    ayarAc(u.sorun)
                }
            }
            HatirlatmaUyarilari.Cozum.AYARI_AC -> ayarAc(u.sorun)
            HatirlatmaUyarilari.Cozum.GORULDU -> {
                HatirlatmaDurumu.goruldu(this)
                hatirlatmayiOku()
            }
        }
    }

    private fun ayarAc(s: HatirlatmaSorunu) {
        val niyet = HatirlatmaDurumu.cozumNiyeti(this, s)
        try {
            if (niyet != null) startActivity(niyet) else uygulamaAyrintisi()
        } catch (_: ActivityNotFoundException) {
            uygulamaAyrintisi()
        } catch (_: SecurityException) {
            uygulamaAyrintisi()
        }
    }

    private fun uygulamaAyrintisi() {
        try {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
        } catch (_: Exception) {
            cubukGoster("Ayar ekranı açılamadı.", null)
        }
    }

    private fun hatirlatmaPenceresi() {
        val h = try {
            HatirlatmaDurumu.oku(this)
        } catch (_: Exception) {
            null
        }
        hatirlatma = h
        val uyarilar = h?.let { HatirlatmaUyarilari.uyarilar(it) }.orEmpty()
        val icerik = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(t.dp(24), t.dp(8), t.dp(24), t.dp(8))
        }
        var pencere: AlertDialog? = null
        if (uyarilar.isEmpty()) {
            icerik.addView(t.yazi("Hatırlatmaları engelleyen bir sorun görünmüyor. Hatırlatmalar PC kapalıyken de bu telefonda çalar.", 15f))
        }
        for (u in uyarilar) {
            icerik.addView(t.yazi(u.baslik, 16f, if (u.engel) t.gecikmis else t.murekkep, kalin = true), t.satirParam(ust = 12))
            icerik.addView(t.yazi(u.aciklama, 14f, t.soluk), t.satirParam(ust = 2))
            icerik.addView(t.metinDugmesi(u.dugme) { pencere?.dismiss(); uyariCoz(u) }, t.sarParam())
        }
        pencere = AlertDialog.Builder(this)
            .setTitle("Hatırlatma durumu")
            .setView(ScrollView(this).apply { addView(icerik) })
            .setPositiveButton("Kapat", null)
            .show()
    }

    // ---------------------------------------------------------------------------------------------
    // Geri alma çubuğu
    // ---------------------------------------------------------------------------------------------

    private val cubuguGizle = Runnable { cubuk.visibility = View.GONE }

    private fun cubukGoster(metin: String, geriAlma: GeriAlma?) {
        ana.removeCallbacks(cubuguGizle)
        cubukMetni.text = metin
        cubukEylemi.visibility = if (geriAlma != null) View.VISIBLE else View.GONE
        cubukEylemi.setOnClickListener {
            cubuk.visibility = View.GONE
            if (geriAlma != null) islem { it.geriAl(geriAlma) }
        }
        cubuk.visibility = View.VISIBLE
        cubuk.announceForAccessibility(metin + if (geriAlma != null) ". Geri alınabilir." else "")
        ana.postDelayed(cubuguGizle, if (geriAlma != null) 7_000 else 4_000)
    }

    // ---------------------------------------------------------------------------------------------
    // Liste uyarlayıcısı
    // ---------------------------------------------------------------------------------------------

    private sealed class Oge {
        data class Liste_(val oge: Liste.Oge) : Oge()
        data class Kayit(val oge: Liste.Oge.Satir) : Oge()
        data class Ret(val satir: RetListesi.RetSatiri) : Oge()
        data class Bilgi(val metin: String) : Oge()
        /** Takvim sekmesinin üst bölümü (ızgara); altında seçili günün satırları. */
        data class Takvim_(val model: TakvimModeli) : Oge()
    }

    private inner class Uyarlayici : BaseAdapter() {
        private var ogeler: List<Oge> = emptyList()

        fun ver(m: AnaModel) {
            ogeler = if (m.gorunum == Gorunum.RET) {
                if (m.retSatirlari.isEmpty()) listOf(Oge.Bilgi("Gönderilemeyen değişiklik yok."))
                else listOf(Oge.Bilgi("PC bu değişiklikleri kalıcı olarak reddetti. Düzeltip yeniden ekleyebilir ya da atabilirsiniz.")) +
                    m.retSatirlari.map { Oge.Ret(it) }
            } else {
                val satirlar = m.ogeler.map { if (it is Liste.Oge.Satir) Oge.Kayit(it) else Oge.Liste_(it) }
                // Takvim: ızgara listenin ilk öğesidir (küçük ekranda günün satırlarıyla birlikte kayar).
                m.takvim?.let { tk -> takvimGorunumu.ver(tk); listOf(Oge.Takvim_(tk)) + satirlar } ?: satirlar
            }
            notifyDataSetChanged()
        }

        fun oge(i: Int): Oge? = ogeler.getOrNull(i)

        override fun getCount() = ogeler.size
        override fun getItem(position: Int): Any = ogeler[position]
        override fun getItemId(position: Int) = position.toLong()
        override fun getViewTypeCount() = 5
        override fun getItemViewType(position: Int) = when (val o = ogeler[position]) {
            is Oge.Kayit -> 0
            is Oge.Liste_ -> if (o.oge is Liste.Oge.Baslik) 1 else 2
            is Oge.Bilgi -> 2
            is Oge.Ret -> 3
            is Oge.Takvim_ -> 4
        }

        override fun isEnabled(position: Int) = when (ogeler[position]) {
            is Oge.Kayit, is Oge.Ret -> true
            else -> false
        }

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View = when (val o = ogeler[position]) {
            is Oge.Kayit -> kayitSatiri(convertView as? SatirGorunumu ?: SatirGorunumu(), o.oge.satir)
            is Oge.Liste_ -> when (val l = o.oge) {
                is Liste.Oge.Baslik -> grupBasligi(convertView as? TextView ?: t.yazi(), l)
                is Liste.Oge.Bos -> bilgi(convertView as? TextView ?: t.yazi(), l.metin)
                is Liste.Oge.Satir -> error("satır Kayit'tir")
            }
            is Oge.Bilgi -> bilgi(convertView as? TextView ?: t.yazi(), o.metin)
            is Oge.Ret -> retSatiri(convertView as? RetGorunumu ?: RetGorunumu(), o.satir)
            // Tek örnek: [ver]'de güncellendi.
            is Oge.Takvim_ -> takvimGorunumu
        }
    }

    private fun grupBasligi(v: TextView, b: Liste.Oge.Baslik): View = v.apply {
        val ek = b.ek?.let { " · $it" } ?: ""
        val sayi = if (b.sayi > 0) "  ${b.sayi}" else ""
        text = b.grup.baslik.uppercase(java.util.Locale.forLanguageTag("tr")) + ek.uppercase(java.util.Locale.forLanguageTag("tr")) + sayi
        setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 12f)
        letterSpacing = 0.1f
        setTypeface(android.graphics.Typeface.SANS_SERIF, android.graphics.Typeface.BOLD)
        setTextColor(
            when (b.grup) {
                Liste.Grup.GECIKMIS -> t.gecikmis
                Liste.Grup.BUGUN -> t.vurgu
                else -> t.soluk
            },
        )
        setPadding(t.dp(20), t.dp(18), t.dp(20), t.dp(6))
        contentDescription = "${b.grup.baslik}${b.ek?.let { ", $it" } ?: ""}, ${b.sayi} kayıt"
        accessibilityHeading()
    }

    private fun bilgi(v: TextView, metin: String): View = v.apply {
        text = metin
        setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 15f)
        setTextColor(t.soluk)
        setTypeface(android.graphics.Typeface.SANS_SERIF, android.graphics.Typeface.NORMAL)
        setPadding(t.dp(20), t.dp(10), t.dp(20), t.dp(10))
    }

    /** Kayıt satırı: tamamlama halkası | başlık, zaman, işaretler | taslak/silinen eylemleri. */
    private inner class SatirGorunumu : LinearLayout(this@AnaEkran) {
        val halka = t.yazi("", 15f, t.vurguUzerine, kalin = true).apply {
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
        }
        val baslik = t.yazi("", 16f).apply {
            maxLines = 3
            ellipsize = TextUtils.TruncateAt.END
        }
        val alt = t.yazi("", 14f, t.soluk).apply { maxLines = 2; ellipsize = TextUtils.TruncateAt.END }
        val isaretler = LinearLayout(this@AnaEkran).apply { orientation = HORIZONTAL }
        val eylemler = LinearLayout(this@AnaEkran).apply {
            orientation = VERTICAL
            gravity = Gravity.CENTER
        }

        init {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = t.dp(60)
            setPadding(t.dp(12), t.dp(8), t.dp(8), t.dp(8))
            background = t.dokunulur(null, t.yuvarlak(0xFFFFFFFF.toInt(), 0f))
            addView(halka, LayoutParams(t.dp(44), t.dp(44)).apply { marginEnd = t.dp(8) })
            val orta = LinearLayout(this@AnaEkran).apply { orientation = VERTICAL }
            orta.addView(baslik)
            orta.addView(alt)
            orta.addView(isaretler, t.satirParam(ust = 4))
            addView(orta, LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(eylemler)
        }
    }

    private fun kayitSatiri(v: SatirGorunumu, s: Liste.KayitSatiri): View {
        v.contentDescription = s.aciklama
        v.setOnClickListener { KayitEkrani.duzenle(this, ISTEK_KAYIT, s.kayitId) }
        v.setOnLongClickListener { ogeMenusu(it, s) }
        v.baslik.text = s.baslik
        v.baslik.setTextColor(if (s.kapali) t.soluk else t.murekkep)
        v.baslik.paintFlags = if (s.kapali) v.baslik.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
        else v.baslik.paintFlags and Paint.STRIKE_THRU_TEXT_FLAG.inv()
        v.alt.text = s.alt ?: ""
        v.alt.visibility = if (s.alt == null) View.GONE else View.VISIBLE
        v.alt.setTextColor(if (s.gecikmis && !s.kapali) t.gecikmis else t.soluk)

        // Tamamlama halkası (görev ve randevu); notta yerine küçük bir işaret.
        val halka = v.halka
        if (s.tamamlanabilir) {
            halka.visibility = View.VISIBLE
            halka.text = if (s.kapali) "✓" else ""
            halka.background = t.dokunulur(GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setSize(t.dp(24), t.dp(24))
                if (s.kapali) setColor(t.iyi) else setStroke(t.dp(2), if (s.gecikmis) t.gecikmis else t.soluk)
            }.let { d -> android.graphics.drawable.InsetDrawable(d, t.dp(10)) })
            halka.contentDescription = if (s.kapali) "Yeniden aç: ${s.baslik}" else "Tamamla: ${s.baslik}"
            halka.setOnClickListener {
                islem { it.durumDegistir(s.kayitId, if (s.kapali) KayitDurumu.ACIK else KayitDurumu.TAMAM, s.ornekTarihi) }
            }
        } else {
            halka.visibility = if (s.silindi) View.GONE else View.VISIBLE
            halka.text = "¶"
            halka.setTextColor(t.soluk)
            halka.background = null
            halka.contentDescription = null
            halka.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            halka.setOnClickListener(null)
            halka.isClickable = false
        }
        if (s.tamamlanabilir) {
            halka.setTextColor(t.vurguUzerine)
            halka.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        }

        v.isaretler.removeAllViews()
        for (i in s.isaretler) {
            if (i == Liste.Isaret.SILINDI) continue
            val (zemin, yazi) = when (i) {
                Liste.Isaret.TASLAK -> t.taslakZemin to t.taslakYazi
                Liste.Isaret.ASISTAN -> t.asistanZemin to t.asistanYazi
                Liste.Isaret.GONDERILIYOR -> t.yuzeyIkincil to t.soluk
                else -> t.yuzeyIkincil to t.soluk
            }
            val ad = when (i) {
                Liste.Isaret.ASISTAN -> "✦ Asistan"
                Liste.Isaret.GONDERILIYOR -> "↑ Gönderiliyor"
                Liste.Isaret.BEKLIYOR -> "⋯ PC'yi bekliyor"
                Liste.Isaret.TEKRAR -> "↻ Tekrar"
                else -> i.metin
            }
            v.isaretler.addView(t.rozet(ad, zemin, yazi), t.sarParam(sag = 6))
        }
        v.isaretler.visibility = if (v.isaretler.childCount == 0) View.GONE else View.VISIBLE

        // Taslak: tek dokunuşla onay ya da silme. Silinen: geri yükle.
        v.eylemler.removeAllViews()
        when {
            s.silindi -> v.eylemler.addView(t.metinDugmesi("Geri yükle") { islem { it.geriYukle(s.kayitId) } }.apply {
                contentDescription = "Geri yükle: ${s.baslik}"
            })
            s.taslak && !s.kapali -> {
                v.eylemler.addView(t.metinDugmesi("Onayla") { islem { it.onayla(s.kayitId) } }.apply {
                    contentDescription = "Onayla: ${s.baslik}"
                })
                v.eylemler.addView(t.metinDugmesi("Sil", t.soluk) { islem { it.sil(s.kayitId) } }.apply {
                    contentDescription = "Sil: ${s.baslik}"
                })
            }
        }
        v.eylemler.visibility = if (v.eylemler.childCount == 0) View.GONE else View.VISIBLE
        return v
    }

    private inner class RetGorunumu : LinearLayout(this@AnaEkran) {
        val baslik = t.yazi("", 16f, kalin = true)
        val alt = t.yazi("", 13f, t.soluk)
        val neden = t.yazi("", 14f, t.uyariYazi)
        val dugmeler = LinearLayout(this@AnaEkran).apply { orientation = HORIZONTAL }

        init {
            orientation = VERTICAL
            setPadding(t.dp(20), t.dp(10), t.dp(12), t.dp(6))
            background = t.dokunulur(null, t.yuvarlak(0xFFFFFFFF.toInt(), 0f))
            addView(baslik)
            addView(alt)
            addView(neden, t.satirParam(ust = 4))
            addView(dugmeler)
        }
    }

    private fun retSatiri(v: RetGorunumu, r: RetListesi.RetSatiri): View {
        v.contentDescription = r.aciklama
        v.setOnClickListener { retMenusu(r) }
        v.baslik.text = r.baslik
        v.alt.text = "${r.islemMetni} gönderilemedi · ${r.zaman}"
        v.neden.text = r.neden
        v.dugmeler.removeAllViews()
        if (r.duzeltilebilir) {
            v.dugmeler.addView(t.metinDugmesi("Düzelt ve yeniden ekle") { KayitEkrani.retDuzelt(this, ISTEK_KAYIT, r.islemId) }.apply {
                contentDescription = "Düzelt ve yeniden ekle: ${r.baslik}"
            })
        }
        v.dugmeler.addView(t.metinDugmesi("At", t.soluk) { retAtOnayi(r) }.apply { contentDescription = "At: ${r.baslik}" })
        return v
    }

    companion object {
        private const val ISTEK_KAYIT = 41
        private const val ISTEK_ESLESTIRME = 42
        private const val ISTEK_IZIN = 43
        private const val ISTEK_DISA_AKTAR = 44
        private const val ISTEK_ICE_AKTAR = 45
    }
}
