package dev.eren.ajanda.kimlik

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import dev.eren.ajanda.CekirdekErisimi
import dev.eren.ajanda.ag.BaglantiYoneticisi
import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.Gozlemci
import dev.eren.ajanda.cekirdek.KabukHatasi
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * SAHİBİ: K1. Eşleştirme ekranı: PC'deki `eslestir --ajanda` çıktısını yapıştırma, kısa kod, PC parmak
 * izinin gösterilmesi, sonuç ve eşleşmeyi kaldırma. Mantık [EslestirmeMakinesi]'nde (saf, birim
 * testli); bu sınıf yalnız çizer, olayları verir ve komutları yürütür.
 *
 * Açmak: [ac]. Eşleşme yeni tamamlanınca `RESULT_OK` ile döner. Eşleşme durumunun kaynağı çekirdektir
 * (`cekirdek.eslesmeDurumu()`); bu ekran kalıcı bir şey saklamaz.
 *
 * Güvenlik: pencere `FLAG_SECURE` (ekran görüntüsü ve son uygulamalar önizlemesi yok); alanlar
 * kişiselleştirilmiş klavye öğrenimine, otomatik doldurmaya ve kayıtlı örnek durumuna (Bundle) kapalı;
 * kod ve veri günlüğe yazılmaz. Panodan geçerli veri alınınca pano temizlenir (API 28+).
 *
 * Bağlantı yaşam döngüsü K2/K4'ündür: bu ekran yalnız eşleştirme başlarken `BaglantiYoneticisi.basla`
 * der, `birak` demez (ana ekran altta görünür kalır).
 */
class EslestirmeEkrani : Activity() {

    companion object {
        fun ac(context: Context) {
            val niyet = Intent(context, EslestirmeEkrani::class.java)
            if (context !is Activity) niyet.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(niyet)
        }

        private const val KIRMIZI = 0xFFB3261E.toInt()
        private const val YESIL = 0xFF1B6E1B.toInt()
        private const val GRI = 0xFF5F5F5F.toInt()
    }

    private val makine = EslestirmeMakinesi()
    private var durum: EkranDurumu = EkranDurumu.Yukleniyor()

    private val ana = Handler(Looper.getMainLooper())

    /** Çekirdek çağrıları için tek arka iş parçacığı: sıra korunur (başlatma, ardından okuma). */
    private val arka: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "eslestirme") }

    /** Yalnız [arka]'da erişilir. */
    private var cekirdek: Cekirdek? = null
    private var gozlemciNo: ULong? = null

    private val gozlemci = object : Gozlemci {
        // Çekirdeğin etki kilidi altında çağrılır: çekirdeğe burada girilmez, okuma arka iş parçacığına atılır.
        override fun degisti(degisim: Degisim) {
            if (degisim.eslesme || degisim.baglanti || degisim.tumu) arkada { durumuOku() }
        }
    }

    private lateinit var kok: LinearLayout
    private var giris: GirisGorunumu? = null

    // ---------------------------------------------------------------------------------------------
    // Yaşam döngüsü
    // ---------------------------------------------------------------------------------------------

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        kok = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(32), dp(20), dp(24))
        }
        val kaydirma = ScrollView(this).apply {
            isFillViewport = true
            filterTouchesWhenObscured = true
            addView(kok, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        setContentView(kaydirma)

        // Döndürmede durum korunur; süreç yeniden yaratıldıysa (Bundle) çekirdekten baştan okunur.
        @Suppress("DEPRECATION")
        val saklanan = lastNonConfigurationInstance as? EkranDurumu
        uygula(if (saklanan != null) makine.yenidenKur(saklanan) else Gecis(EkranDurumu.Yukleniyor()))
    }

    @Suppress("OVERRIDE_DEPRECATION")
    override fun onRetainNonConfigurationInstance(): Any? = durum

    override fun onStart() {
        super.onStart()
        arkada {
            val c = cekirdekAl()
            gozlemciNo = c.gozlemciEkle(gozlemci)
        }
        komutuYurut(Komut.DurumuOku)
    }

    override fun onStop() {
        arkada {
            val no = gozlemciNo ?: return@arkada
            gozlemciNo = null
            cekirdek?.gozlemciCikar(no)
        }
        super.onStop()
    }

    override fun onDestroy() {
        ana.removeCallbacksAndMessages(null)
        // Kuyruktaki iş (ör. eşleştirmeyi başlatma, gözlemci çıkarma) biter; yenisi alınmaz.
        arka.shutdown()
        super.onDestroy()
    }

    // ---------------------------------------------------------------------------------------------
    // Olay -> durum -> çizim + komut
    // ---------------------------------------------------------------------------------------------

    private fun gonder(olay: Olay) {
        if (isDestroyed) return
        uygula(makine.isle(durum, olay))
    }

    private fun uygula(gecis: Gecis) {
        val onceki = durum
        durum = gecis.durum
        if (onceki != durum || kok.childCount == 0) ciz(durum)
        gecis.komutlar.forEach(::komutuYurut)
    }

    private fun komutuYurut(komut: Komut) {
        when (komut) {
            is Komut.DurumuOku -> arkada { durumuOku() }
            is Komut.EslestirmeyiBaslat -> arkada {
                val hata = try {
                    // Cihaz anahtarı yoksa şimdi üretilir: Keystore hatası burada anlaşılır biçimde görünür
                    // ve üretim, çekirdeğin motor kilidi altındaki `pair_request`'e kalmaz.
                    KeystoreKimlik(applicationContext).acikAnahtar()
                    cekirdekAl().eslestirmeBaslat(komut.qr)
                    BaglantiYoneticisi.basla(applicationContext)
                    null
                } catch (e: Exception) {
                    hataMetni(e)
                }
                anada(Olay.BaslatmaBitti(hata))
            }
            is Komut.BaglantiyiBaslat -> arkada {
                try {
                    BaglantiYoneticisi.basla(applicationContext)
                } catch (_: Exception) {
                    // Zaman aşımı sonucu gösterir.
                }
            }
            is Komut.ZamanlayiciKur -> {
                val kalan = (komut.bitisMs - SystemClock.elapsedRealtime()).coerceAtLeast(0)
                ana.postDelayed({
                    val (agVar, tailscaleVar) = agDurumu()
                    gonder(Olay.ZamanDoldu(SystemClock.elapsedRealtime(), agVar, tailscaleVar))
                }, kalan + 50)
            }
            is Komut.EslesmeyiKaldir -> arkada {
                val hata = try {
                    cekirdekAl().eslesmeyiKaldir()
                    null
                } catch (e: Exception) {
                    hataMetni(e)
                }
                anada(Olay.KaldirmaBitti(hata))
            }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Arka iş parçacığı (çekirdek çağrıları ana iş parçacığında yapılmaz)
    // ---------------------------------------------------------------------------------------------

    private fun arkada(isi: () -> Unit) {
        try {
            arka.execute {
                try {
                    isi()
                } catch (_: Exception) {
                    // Okuma hatası durumuOku'da olaya çevrilir; ötekiler sessizce düşer.
                }
            }
        } catch (_: RejectedExecutionException) {
            // Etkinlik kapanıyor.
        }
    }

    private fun anada(olay: Olay) {
        ana.post { gonder(olay) }
    }

    private fun cekirdekAl(): Cekirdek = cekirdek ?: CekirdekErisimi.al(applicationContext).also { cekirdek = it }

    private fun durumuOku() {
        val olay = try {
            val c = cekirdekAl()
            val eslesme = c.eslesmeDurumu()
            val baglanti = try {
                c.baglantiDurumu()
            } catch (_: Exception) {
                null
            }
            Olay.DurumGeldi(eslesme, baglanti, SystemClock.elapsedRealtime())
        } catch (e: Exception) {
            Olay.DurumOkunamadi(hataMetni(e))
        } catch (e: LinkageError) {
            // Yerel kitaplık yüklenemedi: çökmek yerine söyle.
            Olay.DurumOkunamadi(hataMetni(e))
        }
        anada(olay)
    }

    private fun hataMetni(e: Throwable): String = when (e) {
        is CekirdekHatasi.Yazilmadi -> "Bu işlem çekirdekte henüz yazılmadı (${e.parca})."
        is CekirdekHatasi.Eslesme -> "Eşleşme: ${e.mesaj}"
        is CekirdekHatasi.GecersizDurum -> "Şu an yapılamıyor: ${e.mesaj}"
        is CekirdekHatasi.GecersizGirdi -> "Geçersiz eşleştirme verisi (${e.alan}: ${e.neden})."
        is CekirdekHatasi.Depo -> "Yerel depo hatası: ${e.mesaj}"
        is CekirdekHatasi.KabukCagrisi -> "Telefon kabuğu hatası: ${e.mesaj}"
        is KabukHatasi.Basarisiz -> "Telefon kimliği: ${e.mesaj}"
        else -> e.javaClass.simpleName
    }

    /** (etkin ağ var mı, VPN üstünden mi). Tailscale Android'de VpnService'tir; uygulamanın etkin ağı VPN'se tünel açık. */
    private fun agDurumu(): Pair<Boolean, Boolean> {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return true to true
        return try {
            val ag = cm.activeNetwork ?: return false to false
            val yetenek = cm.getNetworkCapabilities(ag)
            true to (yetenek?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true)
        } catch (_: SecurityException) {
            true to true
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Çizim
    // ---------------------------------------------------------------------------------------------

    private fun ciz(d: EkranDurumu) {
        if (d is EkranDurumu.Giris) {
            girisiCiz(d)
            return
        }
        kok.removeAllViews()
        when (d) {
            is EkranDurumu.Yukleniyor -> bekleme("Eşleşme durumu okunuyor…")
            is EkranDurumu.Kaldiriliyor -> bekleme("Eşleşme kaldırılıyor…")
            is EkranDurumu.Baglaniyor -> {
                kok.addView(baslik("Eşleştiriliyor"))
                kok.addView(ProgressBar(this), satirDuzeni())
                kok.addView(metin(EslestirmeMetinleri.asama(d.asama)))
                kok.addView(metin("PC: ${d.host}:${d.port}", renk = GRI))
                d.parmakIzi?.let { kok.addView(parmakIziGorunumu(it)) }
                kok.addView(dugme("Vazgeç") { gonder(Olay.Vazgec) })
            }
            is EkranDurumu.Eslesti -> {
                if (d.yeni) setResult(RESULT_OK)
                kok.addView(baslik(if (d.yeni) "Eşleşme tamamlandı" else "Eşleşmiş"))
                kok.addView(metin("PC: ${d.host}:${d.port}"))
                kok.addView(metin("Bu telefonun kimliği: ${d.deviceId}", renk = GRI, mono = true))
                kok.addView(dugme(if (d.yeni) "Tamam" else "Kapat", birincil = d.yeni) { finish() })
                kok.addView(dugme("Eşleşmeyi kaldır") { kaldirmaOnayi() })
            }
            is EkranDurumu.Basarisiz -> {
                val (b, aciklama) = EslestirmeMetinleri.hata(d.hata)
                kok.addView(baslik(b))
                kok.addView(metin(aciklama))
                kok.addView(dugme("Yeniden dene", birincil = true) { gonder(Olay.YenidenDene) })
                kok.addView(dugme("Kapat") { finish() })
            }
            is EkranDurumu.Giris -> Unit
        }
    }

    private fun kaldirmaOnayi() {
        AlertDialog.Builder(this)
            .setTitle("Eşleşme kaldırılsın mı?")
            .setMessage(
                "Telefondaki ajanda kopyası, gönderilmemiş değişiklikler ve kurulu hatırlatmalar silinir; " +
                    "cihaz anahtarı da silinir. Yeniden eşleştirmek için PC'de yeni kod gerekir.",
            )
            .setPositiveButton("Kaldır") { _, _ -> gonder(Olay.KaldirmaOnaylandi) }
            .setNegativeButton("Vazgeç", null)
            .show()
    }

    /** Giriş görünümü bir kez kurulur; yazarken odak ve imleç kaybolmasın diye yalnız değişen parçalar güncellenir. */
    private fun girisiCiz(d: EkranDurumu.Giris) {
        val g = giris ?: GirisGorunumu().also { giris = it }
        if (kok.childCount != 1 || kok.getChildAt(0) !== g.kok) {
            kok.removeAllViews()
            kok.addView(g.kok)
        }
        g.guncelle(d)
    }

    private inner class GirisGorunumu {
        val kok = LinearLayout(this@EslestirmeEkrani).apply { orientation = LinearLayout.VERTICAL }
        private var yaziliyor = false
        private val bilgi = metin("", renk = GRI)
        private val veriAlani = EditText(this@EslestirmeEkrani).apply {
            hint = "Komutun çıktısını buraya yapıştırın"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            gizliAlan()
            minLines = 3
            maxLines = 8
            gravity = Gravity.TOP or Gravity.START
            typeface = Typeface.MONOSPACE
            textSize = 12f
            filters = arrayOf(InputFilter.LengthFilter(EslestirmeVerisi.AZAMI_METIN * 2))
        }
        private val veriSonucu = metin("")
        private val parmakIzi = LinearLayout(this@EslestirmeEkrani).apply { orientation = LinearLayout.VERTICAL }
        private val kodAlani = EditText(this@EslestirmeEkrani).apply {
            hint = "Kod (ör. ABCD2345)"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or
                InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            gizliAlan()
            isSingleLine = true
            typeface = Typeface.MONOSPACE
            textSize = 20f
            letterSpacing = 0.1f
            filters = arrayOf(InputFilter.LengthFilter(40))
        }
        private val kodSonucu = metin("")
        private val eslestir = dugme("Eşleştir", birincil = true) {
            val (agVar, _) = agDurumu()
            gonder(Olay.EslestirIstendi(SystemClock.elapsedRealtime(), agVar))
        }

        init {
            kok.addView(baslik(EslestirmeMetinleri.BASLIK))
            EslestirmeMetinleri.ADIMLAR.forEach { kok.addView(metin(it)) }
            kok.addView(bilgi)
            kok.addView(dugme("Panodan yapıştır") { panodanYapistir() })
            kok.addView(veriAlani, satirDuzeni())
            kok.addView(veriSonucu)
            kok.addView(parmakIzi)
            kok.addView(kodAlani, satirDuzeni())
            kok.addView(kodSonucu)
            kok.addView(eslestir)
            veriAlani.addTextChangedListener(izleyici { if (!yaziliyor) gonder(Olay.VeriDegisti(it)) })
            kodAlani.addTextChangedListener(izleyici { if (!yaziliyor) gonder(Olay.KodDegisti(it)) })
        }

        fun guncelle(d: EkranDurumu.Giris) {
            yaziliyor = true
            try {
                if (veriAlani.text.toString() != d.veriMetni) veriAlani.setText(d.veriMetni)
                if (kodAlani.text.toString() != d.kodMetni) kodAlani.setText(d.kodMetni)
            } finally {
                yaziliyor = false
            }
            val b = d.bilgi
            bilgi.visibility = if (b == null) View.GONE else View.VISIBLE
            bilgi.text = b?.let(EslestirmeMetinleri::bilgi) ?: ""

            parmakIzi.removeAllViews()
            when (val v = d.veri) {
                VeriCozumu.Bos -> veriSonucu.yaz("", GRI)
                is VeriCozumu.Hatali -> veriSonucu.yaz(EslestirmeMetinleri.veriHatasi(v.hata), KIRMIZI)
                is VeriCozumu.Gecerli -> {
                    veriSonucu.yaz("PC: ${v.qr.host}:${v.qr.port}", YESIL)
                    parmakIzi.addView(parmakIziGorunumu(v.parmakIzi))
                }
            }
            val kh = d.kodHatasi
            when {
                d.kodMetni.isEmpty() -> kodSonucu.yaz(EslestirmeMetinleri.kodHatasi(KodHatasi.Bos), GRI)
                kh != null -> kodSonucu.yaz(EslestirmeMetinleri.kodHatasi(kh), KIRMIZI)
                d.veri is VeriCozumu.Gecerli -> kodSonucu.yaz("Kod veriyle aynı.", YESIL)
                else -> kodSonucu.yaz("", GRI)
            }
            eslestir.isEnabled = d.eslestirilebilir
        }

        private fun panodanYapistir() {
            val pano = getSystemService(ClipboardManager::class.java)
            val icerik = pano?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)
                ?.coerceToText(this@EslestirmeEkrani)?.toString()
            if (icerik.isNullOrEmpty()) {
                Toast.makeText(this@EslestirmeEkrani, "Pano boş.", Toast.LENGTH_SHORT).show()
                return
            }
            veriAlani.setText(icerik) // izleyici VeriDegisti gönderir
            // Pano kodu taşıyor: kullanıldıysa başka uygulamalara bırakılmaz.
            val d = durum
            if (d is EkranDurumu.Giris && d.veri is VeriCozumu.Gecerli && Build.VERSION.SDK_INT >= 28) {
                try {
                    pano?.clearPrimaryClip()
                } catch (_: Exception) {
                }
            }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Görünüm yardımcıları
    // ---------------------------------------------------------------------------------------------

    private fun dp(n: Int): Int = (resources.displayMetrics.density * n).toInt()

    private fun satirDuzeni() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = dp(8) }

    private fun baslik(s: String) = TextView(this).apply {
        text = s
        textSize = 22f
        setTypeface(typeface, Typeface.BOLD)
        setPadding(0, 0, 0, dp(12))
    }

    private fun metin(s: String, renk: Int? = null, mono: Boolean = false) = TextView(this).apply {
        text = s
        textSize = 15f
        setPadding(0, dp(4), 0, dp(4))
        if (renk != null) setTextColor(renk)
        if (mono) typeface = Typeface.MONOSPACE
    }

    private fun TextView.yaz(s: String, renk: Int) {
        text = s
        setTextColor(renk)
        visibility = if (s.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun dugme(s: String, birincil: Boolean = false, tik: () -> Unit) = Button(this).apply {
        text = s
        isAllCaps = false
        filterTouchesWhenObscured = true
        if (birincil) setTypeface(typeface, Typeface.BOLD)
        setOnClickListener { tik() }
    }

    /** Parmak izi dört satırda dörder grup: PC'deki tek satırla göz göze karşılaştırmak için. */
    private fun parmakIziGorunumu(parmakIzi: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(8), 0, dp(8))
        addView(metin("PC anahtarının parmak izi (PC'deki \"Parmak izi:\" satırıyla aynı olmalı):", renk = GRI))
        val satirlar = parmakIzi.split(" ").chunked(4).joinToString("\n") { it.joinToString(" ") }
        addView(
            TextView(this@EslestirmeEkrani).apply {
                text = satirlar
                textSize = 17f
                typeface = Typeface.MONOSPACE
                setTextIsSelectable(false)
            },
        )
    }

    private fun bekleme(s: String) {
        kok.addView(ProgressBar(this), satirDuzeni())
        kok.addView(metin(s).apply { gravity = Gravity.CENTER_HORIZONTAL })
    }

    private fun EditText.gizliAlan() {
        imeOptions = imeOptions or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
        importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
        isSaveEnabled = false
    }

    private fun izleyici(f: (String) -> Unit) = object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        override fun afterTextChanged(s: Editable?) = f(s?.toString() ?: "")
    }
}
