package dev.eren.ajanda.ekran

import android.app.Activity
import android.app.AlertDialog
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import dev.eren.ajanda.CekirdekErisimi
import dev.eren.ajanda.R
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.DuzenlemeTemeli
import dev.eren.ajanda.cekirdek.GecmisSayfasi
import dev.eren.ajanda.cekirdek.Gozlemci
import dev.eren.ajanda.cekirdek.Hatirlatma
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitGorunumu
import dev.eren.ajanda.cekirdek.KayitGovdesi
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.RetGirdisi
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * SAHİBİ: K4. Kayıt ekleme, ayrıntı + düzenleme ve ret listesinden "düzelt ve yeniden ekle" formu.
 * Form mantığı [KayitFormu]'nda (saf); çekirdek çağrıları tek arka iş parçacığında. Metin düz
 * gösterilir; gizli karakter temizliği ve son doğrulama çekirdeğindir (`govdeyiHazirla`), sorunu
 * ilgili alanın altında Türkçe gösterilir. Kaydedince `RESULT_OK` + [SONUC_MESAJI] ile döner.
 */
class KayitEkrani : Activity() {

    companion object {
        const val SONUC_MESAJI = "dev.eren.ajanda.ekran.SONUC_MESAJI"
        private const val MOD = "mod"
        private const val KAYIT_ID = "kayit_id"
        private const val ISLEM_ID = "islem_id"
        private const val TARIH = "tarih"
        private const val TUR = "tur"

        fun yeni(a: Activity, istek: Int, tarih: LocalDate?, tur: KayitTuru) {
            val i = Intent(a, KayitEkrani::class.java).putExtra(MOD, Mod.YENI.name).putExtra(TUR, tur.name)
            if (tarih != null) i.putExtra(TARIH, tarih.toString())
            @Suppress("DEPRECATION") a.startActivityForResult(i, istek)
        }

        fun duzenle(a: Activity, istek: Int, kayitId: String) {
            val i = Intent(a, KayitEkrani::class.java).putExtra(MOD, Mod.DUZENLE.name).putExtra(KAYIT_ID, kayitId)
            @Suppress("DEPRECATION") a.startActivityForResult(i, istek)
        }

        fun retDuzelt(a: Activity, istek: Int, islemId: String) {
            val i = Intent(a, KayitEkrani::class.java).putExtra(MOD, Mod.RET.name).putExtra(ISLEM_ID, islemId)
            @Suppress("DEPRECATION") a.startActivityForResult(i, istek)
        }
    }

    private enum class Mod { YENI, DUZENLE, RET }

    private lateinit var t: Tasarim
    private val ana = Handler(Looper.getMainLooper())
    private val arka: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "ajanda-form") }
    private var yuz: CekirdekYuzu? = null
    private var gozlemciNo: ULong? = null

    private lateinit var mod: Mod
    private var kayitId: String? = null
    private var islemId: String? = null

    // Ana iş parçacığı durumu
    private var form: KayitFormu? = null
    /** Düzenlemede formun açıldığı hal: yalnız kullanıcının ondan değiştirdiği alanlar gider. */
    private var temel: DuzenlemeTemeli? = null
    private var kayit: KayitGorunumu? = null
    private var ret: RetGirdisi? = null
    private var sorunlar: List<FormSorunu> = emptyList()
    private var dilimTanindi = true
    private var canli = false
    private var gonderim = Liste.Gonderim.YEREL
    private var gecmis: GecmisSayfasi? = null
    private var mesgul = false
    private val cihazDilimi: String = ZoneId.systemDefault().id

    private lateinit var icerik: LinearLayout
    private lateinit var baslikYazisi: TextView
    private lateinit var kaydetDugmesi: TextView
    private lateinit var silDugmesi: TextView
    private lateinit var meta: LinearLayout
    private lateinit var turKutusu: LinearLayout
    private lateinit var baslikAlani: EditText
    private lateinit var baslikSorunu: TextView
    private lateinit var zamanKutusu: LinearLayout
    private lateinit var zamanSorunu: TextView
    private lateinit var hatirlatmaKutusu: LinearLayout
    private lateinit var hatirlatmaSorunu: TextView
    private lateinit var aciklamaAlani: EditText
    private lateinit var aciklamaSorunu: TextView
    private lateinit var dilimKutusu: LinearLayout
    private lateinit var genelSorun: TextView
    private lateinit var gecmisKutusu: LinearLayout
    private lateinit var yukleniyor: ProgressBar
    private lateinit var form_: LinearLayout
    private var yaziliyor = false

    private val gozlemci = object : Gozlemci {
        // Etki kilidi altında: yalnız arka iş parçacığına iş atar.
        override fun degisti(degisim: Degisim) {
            val id = kayitId ?: return
            if (degisim.tumu || id in degisim.kayitlar) arkada { kaydiYenidenOku(id) }
            if (id in degisim.gecmis) arkada { gecmisiOku(id) }
            if (degisim.baglanti || degisim.eslesme || degisim.tumu) arkada { baglantiyiOku() }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Yaşam döngüsü
    // ---------------------------------------------------------------------------------------------

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.EkranTema)
        super.onCreate(savedInstanceState)
        t = Tasarim(this)
        @Suppress("DEPRECATION")
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN)
        mod = runCatching { Mod.valueOf(intent.getStringExtra(MOD) ?: "") }.getOrDefault(Mod.YENI)
        kayitId = intent.getStringExtra(KAYIT_ID)
        islemId = intent.getStringExtra(ISLEM_ID)
        kur()
        val tur = runCatching { KayitTuru.valueOf(intent.getStringExtra(TUR) ?: "") }.getOrDefault(KayitTuru.GOREV)
        val tarih = intent.getStringExtra(TARIH)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        // Kaydedilmemiş form (döndürme, tema değişimi, süreç ölümü) varsa o geri gelir.
        val kayitli = FormKaydi.bundleOku(savedInstanceState)
        arkada { yukle(tur, tarih, kayitli) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        form?.let { FormKaydi.bundleYaz(outState, FormDurumu(it, temel, dilimTanindi)) }
    }

    override fun onStart() {
        super.onStart()
        if (kayitId != null) arkada {
            gozlemciNo = CekirdekErisimi.al(applicationContext).gozlemciEkle(gozlemci)
        }
    }

    override fun onStop() {
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

    // ---------------------------------------------------------------------------------------------
    // Arka iş parçacığı
    // ---------------------------------------------------------------------------------------------

    private fun c(): CekirdekYuzu = yuz ?: CekirdekYuzu.Gercek(CekirdekErisimi.al(applicationContext)).also { yuz = it }

    private fun arkada(isi: () -> Unit) {
        try {
            arka.execute {
                try {
                    isi()
                } catch (e: Exception) {
                    anada { genelSorunGoster(KayitFormu.hataMesaji(e).mesaj) }
                } catch (_: LinkageError) {
                    anada { genelSorunGoster("Ajanda çekirdeği yüklenemedi.") }
                }
            }
        } catch (_: RejectedExecutionException) {
        }
    }

    private fun anada(f: () -> Unit) {
        ana.post { if (!isDestroyed) f() }
    }

    /** Dilim biçimi çekirdeğin kuralından geçiyor mu (cihaz dilimi `GMT+03:00` gibi olabilir). */
    private fun dilimGecerli(dilim: String): Boolean = try {
        c().govdeyiHazirla(KayitGovdesi(KayitTuru.GOREV, "x", null, AjandaZamani.Gun("2026-01-01", dilim, null), emptyList(), null))
        true
    } catch (e: CekirdekHatasi.GecersizGirdi) {
        !e.alan.endsWith("saat_dilimi")
    }

    /** [kayitli]: kaydedilmemiş form geri geliyor (yoksa formu kayıttan/varsayılandan kur). */
    private fun yukle(tur: KayitTuru, tarih: LocalDate?, kayitli: FormDurumu?) {
        when (mod) {
            Mod.YENI -> {
                val f = kayitli?.form ?: KayitFormu.yeni(tur, tarih, cihazDilimi, c().varsayilanHatirlatmalar())
                val gecerli = kayitli?.dilimTanindi ?: dilimGecerli(cihazDilimi)
                anada {
                    dilimTanindi = gecerli
                    formuVer(f, null)
                    baslikAlani.requestFocus()
                    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
                }
            }
            Mod.DUZENLE -> {
                val id = kayitId ?: return
                val g = c().kayit(id)
                baglantiyiOku()
                anada {
                    if (g == null) {
                        bulunamadi("Kayıt bulunamadı; silinmiş ya da henüz eşitlenmemiş olabilir.")
                    } else {
                        kayit = g
                        if (kayitli != null) {
                            dilimTanindi = kayitli.dilimTanindi
                            formuVer(kayitli.form, kayitli.temel)
                        } else {
                            val f = KayitFormu.kayittan(g.kayit, cihazDilimi)
                            formuVer(f, DuzenlemeTemeli(g.kayit.revizyon, f.govde()))
                        }
                    }
                }
            }
            Mod.RET -> {
                val r = c().retListesi().firstOrNull { it.islemId == islemId }
                val gecerli = kayitli?.dilimTanindi ?: dilimGecerli(cihazDilimi)
                anada {
                    dilimTanindi = gecerli
                    val govde = r?.govde
                    if (r == null || govde == null) {
                        bulunamadi("Bu değişiklik artık listede yok ya da içeriği okunamıyor.")
                    } else {
                        ret = r
                        formuVer(kayitli?.form ?: KayitFormu.govdeden(govde, cihazDilimi), null)
                    }
                }
            }
        }
    }

    /** Bağlantı ve eşleşme: geçmiş isteği ve "gönderiliyor/bekliyor" bilgisi için (arka iş parçacığı). */
    private fun baglantiyiOku() {
        val asama = runCatching { c().baglantiDurumu().asama }.getOrNull()
        val adresVar = runCatching { c().baglantiAdresi() != null }.getOrDefault(false)
        anada {
            canli = asama == BaglantiAsamasi.CANLI
            val yeni = Liste.Gonderim.hesapla(adresVar, asama)
            if (yeni != gonderim) {
                gonderim = yeni
                if (::meta.isInitialized && form != null) metayiCiz()
            }
        }
    }

    private fun kaydiYenidenOku(id: String) {
        val g = c().kayit(id)
        anada {
            if (g != null) {
                kayit = g
                metayiCiz()
            }
        }
    }

    private fun gecmisiOku(id: String) {
        val s = c().gecmis(id)
        anada {
            gecmis = s
            gecmisiCiz()
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Görünüm
    // ---------------------------------------------------------------------------------------------

    private fun kur() {
        val kok = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(t.zemin)
        }
        val ust = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(t.dp(4), t.dp(6), t.dp(8), t.dp(6))
        }
        ust.addView(t.metinDugmesi("✕", t.murekkep) { finish() }.apply {
            textSize = 20f
            contentDescription = "Vazgeç"
        })
        baslikYazisi = t.yazi(
            when (mod) {
                Mod.YENI -> "Yeni kayıt"
                Mod.DUZENLE -> "Kayıt"
                Mod.RET -> "Düzelt ve yeniden ekle"
            },
            20f, serif = true,
        ).apply { if (android.os.Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true }
        ust.addView(baslikYazisi, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        silDugmesi = t.metinDugmesi("Sil", t.gecikmis) { silOnayi() }.apply {
            contentDescription = "Kaydı sil"
            visibility = View.GONE
        }
        ust.addView(silDugmesi)
        kaydetDugmesi = t.anaDugme("Kaydet") { kaydet() }.apply { isEnabled = false; alpha = 0.5f }
        ust.addView(kaydetDugmesi)
        kok.addView(ust)
        kok.addView(t.ayirici())

        icerik = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(t.dp(20), t.dp(8), t.dp(20), t.dp(32))
        }
        yukleniyor = ProgressBar(this)
        icerik.addView(yukleniyor, t.satirParam(ust = 32))
        form_ = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }
        icerik.addView(form_)

        meta = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        form_.addView(meta)

        form_.addView(etiket("Tür"))
        turKutusu = yatay()
        form_.addView(turKutusu)

        baslikAlani = EditText(this).apply {
            hint = "Ne? (ör. Dişçi randevusu)"
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 20f)
            setTextColor(t.murekkep)
            setHintTextColor(t.soluk)
            // Mantıken tek satır (Enter ve klavyenin "Bitti"si kaydeder), görünüşte satır kaydırır.
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            imeOptions = EditorInfo.IME_ACTION_DONE
            setHorizontallyScrolling(false)
            maxLines = 4
            background = t.yuvarlak(t.yuzey, 10f, t.cizgi)
            setPadding(t.dp(14), t.dp(12), t.dp(14), t.dp(12))
            contentDescription = "Başlık"
            setOnEditorActionListener { _, eylem, olay ->
                if (eylem == EditorInfo.IME_ACTION_DONE ||
                    (olay?.keyCode == android.view.KeyEvent.KEYCODE_ENTER && olay.action == android.view.KeyEvent.ACTION_DOWN)
                ) {
                    kaydet()
                    true
                } else {
                    false
                }
            }
            addTextChangedListener(izleyici { s -> if (!yaziliyor) formuDegistir(sorunAlani = FormAlani.BASLIK) { it.copy(baslik = s) } })
        }
        form_.addView(etiket("Başlık"))
        form_.addView(baslikAlani, t.satirParam(ust = 4))
        baslikSorunu = sorunYazisi()
        form_.addView(baslikSorunu)

        form_.addView(etiket("Ne zaman?"))
        zamanKutusu = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        form_.addView(zamanKutusu)
        zamanSorunu = sorunYazisi()
        form_.addView(zamanSorunu)
        dilimKutusu = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        form_.addView(dilimKutusu)

        form_.addView(etiket("Hatırlatma"))
        hatirlatmaKutusu = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        form_.addView(hatirlatmaKutusu)
        hatirlatmaSorunu = sorunYazisi()
        form_.addView(hatirlatmaSorunu)

        form_.addView(etiket("Açıklama"))
        aciklamaAlani = EditText(this).apply {
            hint = "İsteğe bağlı"
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 16f)
            setTextColor(t.murekkep)
            setHintTextColor(t.soluk)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            minLines = 2
            maxLines = 10
            gravity = Gravity.TOP or Gravity.START
            background = t.yuvarlak(t.yuzey, 10f, t.cizgi)
            setPadding(t.dp(14), t.dp(12), t.dp(14), t.dp(12))
            contentDescription = "Açıklama"
            addTextChangedListener(izleyici { s -> if (!yaziliyor) formuDegistir(sorunAlani = FormAlani.ACIKLAMA) { it.copy(aciklama = s) } })
        }
        form_.addView(aciklamaAlani, t.satirParam(ust = 4))
        aciklamaSorunu = sorunYazisi()
        form_.addView(aciklamaSorunu)

        genelSorun = sorunYazisi()
        form_.addView(genelSorun, t.satirParam(ust = 12))

        gecmisKutusu = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        form_.addView(gecmisKutusu, t.satirParam(ust = 16))

        val kaydirma = ScrollView(this).apply {
            isFillViewport = true
            addView(icerik)
        }
        kok.addView(kaydirma, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        Tasarim.payUygula(kok)
        setContentView(kok)
        Tasarim.cubuklar(this, t.koyu)
    }

    private fun etiket(s: String) = t.yazi(s, 13f, t.soluk, kalin = true).apply {
        letterSpacing = 0.06f
        setPadding(0, t.dp(18), 0, t.dp(6))
    }

    private fun yatay() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
    }

    private fun sorunYazisi() = t.yazi("", 14f, t.gecikmis).apply {
        visibility = View.GONE
        accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        setPadding(0, t.dp(4), 0, 0)
    }

    private fun izleyici(f: (String) -> Unit) = object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        override fun afterTextChanged(s: Editable?) = f(s?.toString() ?: "")
    }

    private fun bulunamadi(metin: String) {
        yukleniyor.visibility = View.GONE
        icerik.addView(t.yazi(metin, 16f, t.soluk), t.satirParam(ust = 24))
        icerik.addView(t.anaDugme("Kapat") { finish() }, t.satirParam(ust = 16))
    }

    private fun formuVer(f: KayitFormu, acilis: DuzenlemeTemeli?) {
        form = f
        temel = acilis
        yukleniyor.visibility = View.GONE
        form_.visibility = View.VISIBLE
        kaydetDugmesi.isEnabled = true
        kaydetDugmesi.alpha = 1f
        yaziliyor = true
        try {
            baslikAlani.setText(f.baslik)
            baslikAlani.setSelection(baslikAlani.text.length)
            aciklamaAlani.setText(f.aciklama)
        } finally {
            yaziliyor = false
        }
        metayiCiz()
        secimleriCiz()
        gecmisiCiz()
    }

    private fun formuDegistir(sorunAlani: FormAlani? = null, yeniden: Boolean = false, f: (KayitFormu) -> KayitFormu) {
        val onceki = form ?: return
        form = f(onceki)
        if (sorunAlani != null && sorunlar.any { it.alan == sorunAlani }) {
            sorunlar = sorunlar.filter { it.alan != sorunAlani }
            sorunlariCiz()
        }
        if (yeniden) secimleriCiz()
        sayaciGoster()
    }

    /** Başlık sınıra yaklaşınca sayaç (UTF-16 birimi, çekirdeğin saydığı gibi). */
    private fun sayaciGoster() {
        val f = form ?: return
        val n = f.baslik.trim().length
        if (sorunlar.none { it.alan == FormAlani.BASLIK }) {
            if (n > KayitFormu.BASLIK_SINIRI - 40) {
                baslikSorunu.visibility = View.VISIBLE
                baslikSorunu.text = "$n / ${KayitFormu.BASLIK_SINIRI}"
                baslikSorunu.setTextColor(if (n > KayitFormu.BASLIK_SINIRI) t.gecikmis else t.soluk)
            } else {
                baslikSorunu.visibility = View.GONE
            }
        }
    }

    /** Kaynak, taslak, durum, gönderiliyor, silinmiş bilgisi ve eylemleri (düzenlemede); ret nedeni. */
    private fun metayiCiz() {
        meta.removeAllViews()
        val r = ret
        if (r != null) {
            meta.addView(kart(t.uyariZemin) {
                addView(t.yazi("${EkranMetinleri.islem(r.islem)} PC'ye gönderilemedi", 15f, t.uyariYazi, kalin = true))
                addView(t.yazi(EkranMetinleri.retNedeni(r.neden), 14f, t.uyariYazi))
                addView(t.yazi("Düzeltip kaydedince yeniden gönderilir ve bu satır listeden kalkar.", 13f, t.uyariYazi))
            })
        }
        val g = kayit ?: return
        val k = g.kayit
        silDugmesi.visibility = if (k.silindi) View.GONE else View.VISIBLE
        val bugun = LocalDate.now()
        meta.addView(kart(if (Liste.otomatikMi(k.kaynak)) t.asistanZemin else t.yuzeyIkincil) {
            val yazi = if (Liste.otomatikMi(k.kaynak)) t.asistanYazi else t.soluk
            addView(t.yazi(Liste.kaynakMetni(k.kaynak), 14f, yazi, kalin = true))
            k.kaynak.alinti?.let { addView(t.yazi("“$it”", 15f, yazi, serif = true), t.satirParam(ust = 4)) }
            val zaman = EkranMetinleri.goreliAn(k.olusturmaMs, System.currentTimeMillis(), ZoneId.systemDefault())
            val gidis = if (g.bekleyen) gonderim.okunus?.let { " · $it" } ?: "" else ""
            addView(t.yazi("Eklendi: $zaman$gidis", 13f, yazi), t.satirParam(ust = 4))
        })
        if (k.silindi) {
            meta.addView(kart(t.uyariZemin) {
                addView(t.yazi("Bu kayıt silindi.", 15f, t.uyariYazi, kalin = true))
                addView(t.metinDugmesi("Geri yükle", t.uyariYazi) { islemYap("Geri yüklendi") { it.geriYukle(k.kayitId) } })
            })
            form_.alpha = 0.6f
            kaydetDugmesi.isEnabled = false
            kaydetDugmesi.alpha = 0.5f
            return
        }
        if (k.taslak) {
            meta.addView(kart(t.taslakZemin) {
                addView(t.yazi("Taslak: onayınızı bekliyor", 15f, t.taslakYazi, kalin = true))
                addView(t.yazi("Sizin yazmadığınız bir turda eklendi; onaylanana dek hatırlatma kurulmaz.", 14f, t.taslakYazi))
                val satir = yatay()
                satir.addView(t.metinDugmesi("Onayla", t.taslakYazi) { onayla() })
                satir.addView(t.metinDugmesi("Sil", t.taslakYazi) { islemYap("Taslak silindi", geriYukle = true) { it.sil(k.kayitId) } })
                addView(satir)
            })
        }
        val satir = yatay()
        if (k.durum == KayitDurumu.ACIK) {
            satir.addView(t.metinDugmesi("✓ Tamamlandı olarak işaretle") {
                islemYap("“${kisa(k.baslik)}” tamamlandı", ac = true) { it.durumDegistir(k.kayitId, KayitDurumu.TAMAM) }
            })
        } else {
            val ne = if (k.durum == KayitDurumu.TAMAM) "Tamamlandı" else "İptal edildi"
            satir.addView(t.yazi(ne, 15f, t.iyi, kalin = true), t.sarParam(sag = 8))
            satir.addView(t.metinDugmesi("Yeniden aç") { islemYap("Yeniden açıldı") { it.durumDegistir(k.kayitId, KayitDurumu.ACIK) } })
        }
        meta.addView(satir, t.satirParam(ust = 4))
        if (k.tekrar != null) {
            meta.addView(t.yazi("↻ Bu kayıt tekrar ediyor. Tamamlamak bütün seriyi kapatır (örnek başına işlem henüz yok).", 13f, t.soluk))
        }
    }

    private fun kart(zemin: Int, icerik: LinearLayout.() -> Unit) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = t.yuvarlak(zemin, 12f)
        setPadding(t.dp(14), t.dp(10), t.dp(10), t.dp(8))
        layoutParams = t.satirParam(ust = 10)
        icerik()
    }

    /** Tür, zaman, hatırlatma ve dilim seçimleri (yazı alanları yeniden kurulmaz: odak ve imleç korunur). */
    private fun secimleriCiz() {
        val f = form ?: return
        val bugun = LocalDate.now()

        turKutusu.removeAllViews()
        for (tur in KayitTuru.values()) {
            turKutusu.addView(
                t.yonga(EkranMetinleri.tur(tur), f.tur == tur) {
                    formuDegistir(yeniden = true) { it.copy(tur = tur) }
                }.apply { contentDescription = "Tür: ${EkranMetinleri.tur(tur)}" + if (f.tur == tur) ", seçili" else "" },
                t.sarParam(sag = 8),
            )
        }

        zamanKutusu.removeAllViews()
        val z = f.zaman
        // Dokunulmamış özgün dönem ya da belirsiz zaman olduğu gibi gösterilir (kaydedilince korunur).
        if (!f.zamanDegisti && (z is AjandaZamani.Donem || z is AjandaZamani.Belirsiz)) {
            val metin = when (z) {
                is AjandaZamani.Donem -> runCatching {
                    "${EkranMetinleri.kisaTarih(LocalDate.parse(z.baslangic), bugun)} – ${EkranMetinleri.kisaTarih(LocalDate.parse(z.bitis), bugun)}"
                }.getOrDefault("${z.baslangic} – ${z.bitis}")
                is AjandaZamani.Belirsiz -> "“${z.ifade}”"
                else -> ""
            }
            zamanKutusu.addView(t.yazi("$metin (değiştirmek için aşağıdan seçin)", 15f, t.murekkep), t.satirParam(alt = 6))
        }
        val ifade = when (z) {
            is AjandaZamani.An -> z.ifade
            is AjandaZamani.Gun -> z.ifade
            else -> null
        }
        if (ifade != null && !f.zamanDegisti) zamanKutusu.addView(t.yazi("Söylenen: “$ifade”", 13f, t.soluk), t.satirParam(alt = 6))

        val gunler = yatay()
        val tarih = if (f.zamanDegisti || z is AjandaZamani.An || z is AjandaZamani.Gun) f.tarih else null
        fun gunYongasi(ad: String, secili: Boolean, aciklama: String, tik: () -> Unit) =
            t.yonga(ad, secili, tik).apply { contentDescription = aciklama + if (secili) ", seçili" else "" }
        gunler.addView(gunYongasi("Tarihsiz", tarih == null && (f.zamanDegisti || z == null), "Tarihsiz") {
            formuDegistir(FormAlani.ZAMAN, yeniden = true) { it.tarihVer(null) }
        }, t.sarParam(sag = 6))
        gunler.addView(gunYongasi("Bugün", tarih == bugun, "Bugün") {
            formuDegistir(FormAlani.ZAMAN, yeniden = true) { it.tarihVer(bugun) }
        }, t.sarParam(sag = 6))
        gunler.addView(gunYongasi("Yarın", tarih == bugun.plusDays(1), "Yarın") {
            formuDegistir(FormAlani.ZAMAN, yeniden = true) { it.tarihVer(bugun.plusDays(1)) }
        }, t.sarParam(sag = 6))
        val baskaGun = tarih != null && tarih != bugun && tarih != bugun.plusDays(1)
        gunler.addView(gunYongasi(if (baskaGun) EkranMetinleri.gunluTarih(tarih!!, bugun) else "Tarih seç…", baskaGun, "Tarih seç") {
            tarihSec(tarih ?: bugun)
        })
        zamanKutusu.addView(kaydirilir(gunler))

        if (tarih != null) {
            val saatSatiri = yatay()
            val s = f.saat
            if (s == null) {
                saatSatiri.addView(t.yonga("Saat ekle", false) { saatSec(LocalTime.of(9, 0)) }.apply {
                    contentDescription = "Saat ekle; şimdi tüm gün"
                }, t.sarParam(sag = 6))
                saatSatiri.addView(t.yazi("Tüm gün", 14f, t.soluk))
            } else {
                saatSatiri.addView(t.yonga(EkranMetinleri.saat(s), true) { saatSec(s) }.apply {
                    contentDescription = "Saat ${EkranMetinleri.saat(s)}; değiştirmek için dokunun"
                }, t.sarParam(sag = 6))
                saatSatiri.addView(t.metinDugmesi("Saati kaldır", t.soluk) { formuDegistir(FormAlani.ZAMAN, yeniden = true) { it.saatVer(null) } })
            }
            zamanKutusu.addView(saatSatiri, t.satirParam(ust = 8))
        }

        dilimKutusu.removeAllViews()
        val dilimGoster = !dilimTanindi || (tarih != null && f.dilim != cihazDilimi)
        if (dilimGoster) {
            val metin = if (!dilimTanindi && f.dilim == cihazDilimi) {
                "Telefonun saat dilimi (${f.dilim}) tanınmadı; tarihli kayıt için bir dilim seçin."
            } else {
                "Saat dilimi: ${f.dilim}"
            }
            dilimKutusu.addView(t.yazi(metin, 14f, if (!dilimTanindi && f.dilim == cihazDilimi) t.gecikmis else t.soluk), t.satirParam(ust = 8))
            dilimKutusu.addView(t.metinDugmesi("Dilim seç") { dilimSec() }, t.sarParam())
        }

        hatirlatmaKutusu.removeAllViews()
        val secenekler = KayitFormu.hatirlatmaSecenekleri(f)
        val satir = yatay()
        for (h in secenekler) {
            val secili = h in f.hatirlatmalar
            val ad = EkranMetinleri.hatirlatma(h, bugun)
            satir.addView(t.yonga(ad, secili) {
                formuDegistir(FormAlani.HATIRLATMA, yeniden = true) { it.hatirlatmaDegistir(h) }
            }.apply { contentDescription = "Hatırlatma: $ad" + if (secili) ", seçili" else "" }, t.sarParam(sag = 6))
        }
        hatirlatmaKutusu.addView(kaydirilir(satir))
        val not = when {
            f.hatirlatmalar.isEmpty() -> "Hatırlatma kurulmayacak."
            f.zaman == null || f.zaman is AjandaZamani.Belirsiz -> "Tarih yokken \"önce\" hatırlatması bekler; tarih ve saat verilince kurulur."
            f.hatirlatmaBekler -> "Saat seçilmedikçe \"önce\" hatırlatması bekler, çalmaz."
            else -> null
        }
        if (not != null) hatirlatmaKutusu.addView(t.yazi(not, 13f, t.soluk), t.satirParam(ust = 4))
        sorunlariCiz()
    }

    private fun kaydirilir(v: View) = android.widget.HorizontalScrollView(this).apply {
        isHorizontalScrollBarEnabled = false
        addView(v)
    }

    private fun tarihSec(ilk: LocalDate) {
        DatePickerDialog(this, { _, y, a, g ->
            formuDegistir(FormAlani.ZAMAN, yeniden = true) { it.tarihVer(LocalDate.of(y, a + 1, g)) }
        }, ilk.year, ilk.monthValue - 1, ilk.dayOfMonth).show()
    }

    private fun saatSec(ilk: LocalTime) {
        TimePickerDialog(this, { _, s, d ->
            formuDegistir(FormAlani.ZAMAN, yeniden = true) { it.saatVer(LocalTime.of(s, d)) }
        }, ilk.hour, ilk.minute, true).show()
    }

    private fun dilimSec() {
        val simdi = java.time.Instant.now()
        val dilimler = ZoneId.getAvailableZoneIds()
            .filter { '/' in it && !it.startsWith("Etc/") && !it.startsWith("SystemV/") }
            .map { ZoneId.of(it) to it }
            .sortedWith(compareBy({ it.first.rules.getOffset(simdi).totalSeconds }, { it.second }))
        val adlar = dilimler.map { (z, ad) -> "${z.rules.getOffset(simdi).id.replace("Z", "+00:00")}  $ad" }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle("Saat dilimi")
            .setItems(adlar) { _, i ->
                dilimTanindi = true
                formuDegistir(FormAlani.DILIM, yeniden = true) { it.copy(dilim = dilimler[i].second, zamanDegisti = it.zamanDegisti || it.tarih != null) }
            }
            .setNegativeButton("Vazgeç", null)
            .show()
    }

    private fun sorunlariCiz() {
        fun yaz(v: TextView, alanlar: Set<FormAlani>) {
            val s = sorunlar.firstOrNull { it.alan in alanlar }
            if (s == null) {
                if (v !== baslikSorunu) v.visibility = View.GONE
            } else {
                v.text = s.mesaj
                v.setTextColor(t.gecikmis)
                v.visibility = View.VISIBLE
            }
        }
        yaz(baslikSorunu, setOf(FormAlani.BASLIK))
        if (sorunlar.none { it.alan == FormAlani.BASLIK }) sayaciGoster()
        yaz(zamanSorunu, setOf(FormAlani.ZAMAN, FormAlani.DILIM, FormAlani.TEKRAR))
        yaz(hatirlatmaSorunu, setOf(FormAlani.HATIRLATMA))
        yaz(aciklamaSorunu, setOf(FormAlani.ACIKLAMA))
        yaz(genelSorun, setOf(FormAlani.GENEL, FormAlani.TUR))
    }

    private fun genelSorunGoster(m: String) {
        mesgul = false
        sorunlar = sorunlar.filter { it.alan != FormAlani.GENEL } + FormSorunu(FormAlani.GENEL, m)
        if (::genelSorun.isInitialized) {
            if (form_.visibility != View.VISIBLE) {
                yukleniyor.visibility = View.GONE
                form_.visibility = View.VISIBLE
            }
            sorunlariCiz()
        }
    }

    private fun gecmisiCiz() {
        gecmisKutusu.removeAllViews()
        val id = kayitId ?: return
        if (mod != Mod.DUZENLE || kayit == null) return
        gecmisKutusu.addView(t.ayirici())
        val g = gecmis
        if (g == null) {
            gecmisKutusu.addView(t.metinDugmesi("Değişiklik geçmişini göster", t.soluk) { gecmisIste(id, null) }, t.sarParam())
            return
        }
        gecmisKutusu.addView(etiket("Değişiklik geçmişi"))
        val simdi = System.currentTimeMillis()
        val dilim = ZoneId.systemDefault()
        g.satirlar.forEach { gecmisKutusu.addView(t.yazi(EkranMetinleri.gecmisSatiri(it, simdi, dilim), 14f, t.soluk), t.satirParam(ust = 2)) }
        when {
            g.yukleniyor -> gecmisKutusu.addView(t.yazi("Yükleniyor…", 14f, t.soluk))
            g.hata != null -> gecmisKutusu.addView(t.yazi("Geçmiş alınamadı.", 14f, t.gecikmis))
            g.satirlar.isEmpty() -> gecmisKutusu.addView(t.yazi("Kayıtlı değişiklik yok.", 14f, t.soluk))
        }
        if (g.devami && !g.yukleniyor) {
            gecmisKutusu.addView(t.metinDugmesi("Daha eskiler", t.soluk) { gecmisIste(id, g.satirlar.lastOrNull()?.rev) }, t.sarParam())
        }
    }

    private fun gecmisIste(id: String, onceRev: Long?) {
        arkada {
            val bagli = runCatching { c().baglantiDurumu().asama == BaglantiAsamasi.CANLI }.getOrDefault(false)
            if (!bagli) {
                anada { genelSorunGoster("Değişiklik geçmişi PC'de durur; PC'ye bağlıyken görüntülenebilir.") }
                return@arkada
            }
            c().gecmisIste(id, onceRev)
            gecmisiOku(id)
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Kaydetme ve işlemler
    // ---------------------------------------------------------------------------------------------

    private fun kaydet(sonra: ((CekirdekYuzu) -> Unit)? = null, mesaj: String? = null) {
        val f = form ?: return
        if (mesgul) return
        val on = KayitFormu.onDenetim(f)
        if (on.isNotEmpty()) {
            sorunlar = on
            sorunlariCiz()
            if (on.any { it.alan == FormAlani.BASLIK }) baslikAlani.requestFocus()
            return
        }
        mesgul = true
        val acilan = temel
        arkada {
            val sorun = try {
                val c = c()
                val g = c.govdeyiHazirla(f.govde())
                when (mod) {
                    Mod.YENI -> c.ekle(g)
                    // Yalnız kullanıcının formun açıldığı halden değiştirdiği alanlar gider (çekirdek hesaplar;
                    // değişmeyen form hiçbir şey göndermez). Form açıkken PC'den inen değişiklik korunur.
                    Mod.DUZENLE -> c.duzenle(kayitId!!, acilan, g)
                    Mod.RET -> RetListesi.duzelt(c, islemId!!, g)
                }
                sonra?.invoke(c)
                null
            } catch (e: Exception) {
                KayitFormu.hataMesaji(e, f)
            }
            anada {
                mesgul = false
                if (sorun == null) {
                    bitir(
                        mesaj ?: when (mod) {
                            Mod.YENI -> "“${kisa(f.baslik)}” eklendi"
                            Mod.DUZENLE -> "Kaydedildi"
                            Mod.RET -> "Düzeltildi ve yeniden gönderilecek"
                        },
                    )
                } else {
                    if (sorun.alan == FormAlani.DILIM) dilimTanindi = false
                    sorunlar = listOf(sorun)
                    secimleriCiz()
                }
            }
        }
    }

    private fun kisa(s: String) = s.trim().let { if (it.length > 40) it.take(39) + "…" else it }

    /** Taslağı onaylar; formda değişiklik varsa önce kaydeder (tek dokunuş). */
    private fun onayla() {
        val id = kayitId ?: return
        kaydet(sonra = { it.onayla(id) }, mesaj = "Onaylandı; hatırlatmaları kuruldu")
    }

    private fun islemYap(mesaj: String, geriYukle: Boolean = false, ac: Boolean = false, f: (CekirdekYuzu) -> Unit) {
        if (mesgul) return
        mesgul = true
        arkada {
            val sorun = try {
                f(c())
                null
            } catch (e: Exception) {
                KayitFormu.hataMesaji(e)
            }
            anada {
                mesgul = false
                if (sorun == null) bitir(mesaj, geriYukle = geriYukle, ac = ac) else genelSorunGoster(sorun.mesaj)
            }
        }
    }

    private fun silOnayi() {
        val k = kayit?.kayit ?: return
        AlertDialog.Builder(this)
            .setTitle("Silinsin mi?")
            .setMessage("“${kisa(k.baslik)}” silinir; hatırlatmaları kaldırılır. Silinenler listesinden geri yükleyebilirsiniz.")
            .setPositiveButton("Sil") { _, _ -> islemYap("“${kisa(k.baslik)}” silindi", geriYukle = true) { it.sil(k.kayitId) } }
            .setNegativeButton("Vazgeç", null)
            .show()
    }

    private fun bitir(mesaj: String, geriYukle: Boolean = false, ac: Boolean = false) {
        val i = Intent().putExtra(SONUC_MESAJI, mesaj)
        kayitId?.let { id ->
            if (geriYukle) i.putExtra(SONUC_GERI_YUKLE, id)
            if (ac) i.putExtra(SONUC_YENIDEN_AC, id)
        }
        setResult(RESULT_OK, i)
        finish()
    }
}

/** [KayitEkrani] sonucu: geri alınabilir işlemin kaydı (ana ekranın geri alma çubuğu için). */
const val SONUC_GERI_YUKLE = "dev.eren.ajanda.ekran.SONUC_GERI_YUKLE"
const val SONUC_YENIDEN_AC = "dev.eren.ajanda.ekran.SONUC_YENIDEN_AC"
