package dev.eren.olcum.ajanda

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.WindowInsets
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import dev.eren.olcum.ajanda.cekirdek.Analiz
import dev.eren.olcum.ajanda.cekirdek.GunlukBicimi
import dev.eren.olcum.ajanda.cekirdek.Rapor
import dev.eren.olcum.ajanda.cekirdek.Tur
import java.io.File
import java.text.SimpleDateFormat
import java.time.ZoneId
import java.util.Date
import java.util.Locale

/** Tek ekran: durum özeti, izin kısayolları, işaretler, dışa verme. Bağımlılıksız düz görünümler. */
class AnaEkran : Activity() {
    private lateinit var ozetYazi: TextView
    private lateinit var baslatDugme: Button

    private val KAYDET = 41

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val yogunluk = resources.displayMetrics.density
        val pay = (12 * yogunluk).toInt()

        val kok = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        fun dugme(ad: String, is_: () -> Unit) = Button(this).apply {
            text = ad
            isAllCaps = false
            setOnClickListener { is_() }
            kok.addView(this)
        }
        fun baslik(ad: String) = TextView(this).apply {
            text = ad
            textSize = 16f
            setTypeface(typeface, Typeface.BOLD)
            setPadding(0, pay, 0, pay / 3)
            kok.addView(this)
        }

        baslik("Ajanda ölçümü: alarm ve arka plan güvenilirliği")
        baslatDugme = dugme("") { baslatDurdur() }

        baslik("İzinler ve ayarlar")
        dugme("Pil optimizasyonundan muaf tut") { pilMuafiyeti() }
        dugme("Uygulama bilgisi (otomatik başlatma, pil tasarrufu)") {
            ac(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
        if (Build.VERSION.SDK_INT >= 31) {
            dugme("Kesin alarm izni") {
                ac(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
            }
        }
        if (Build.VERSION.SDK_INT >= 33) {
            dugme("Bildirim izni iste") { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7) }
        }

        baslik("İşaret koy (deneme yapmadan hemen önce)")
        dugme("Son uygulamalardan kaydıracağım") { isaret("kaydir") }
        dugme("Telefonu yeniden başlatacağım") { isaret("yeniden") }
        dugme("Saat dilimini / saati değiştireceğim") { isaret("saat") }

        baslik("Sonuç")
        dugme("Özeti yenile") { yenile() }
        dugme("Dosyaya kaydet") { dosyayaKaydet() }
        dugme("Paylaş (dosya olarak)") { paylas() }
        dugme("Günlüğü sil") { gunluguSil() }

        ozetYazi = TextView(this).apply {
            typeface = Typeface.MONOSPACE
            textSize = 11f
            setTextIsSelectable(true)
            setPadding(0, pay, 0, pay * 2)
            kok.addView(this)
        }

        val kaydirma = ScrollView(this).apply { addView(kok) }
        kaydirma.setOnApplyWindowInsetsListener { v, ic ->
            val (s, u, sa, a) = if (Build.VERSION.SDK_INT >= 30) {
                val b = ic.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                listOf(b.left, b.top, b.right, b.bottom)
            } else {
                @Suppress("DEPRECATION")
                listOf(ic.systemWindowInsetLeft, ic.systemWindowInsetTop, ic.systemWindowInsetRight, ic.systemWindowInsetBottom)
            }
            v.setPadding(s + pay, u + pay, sa + pay, a)
            ic
        }
        kaydirma.clipToPadding = false
        setContentView(kaydirma)
    }

    override fun onResume() {
        super.onResume()
        Olcum.giris(this, "ekran")
        Olcum.olguYaz(this, zorla = false)
        yenile()
    }

    private fun yenile() {
        baslatDugme.text = if (Durum.calisiyor(this)) "Ölçümü durdur" else "Ölçümü başlat (72 saat)"
        ozetYazi.text = ozetMetni()
    }

    private fun ozetMetni(): String {
        val ay = GunlukBicimi.ayristirHepsi(Gunluk.oku(this))
        val ozet = Analiz.analiz(ay.olaylar, System.currentTimeMillis(), ay.hataliSatir)
        val simdiki = Olcum.olgular(this).entries.joinToString("\n") { "  ${it.key}: ${it.value}" }
        return Rapor.metin(ozet, ZoneId.systemDefault()) + "\n■ Cihaz olguları (şimdi)\n" + simdiki
    }

    private fun baslatDurdur() {
        if (Durum.calisiyor(this)) {
            AlertDialog.Builder(this)
                .setMessage("Ölçüm durdurulsun mu? Günlük silinmez.")
                .setPositiveButton("Durdur") { _, _ -> Olcum.durdur(this); yenile() }
                .setNegativeButton("Vazgeç", null)
                .show()
        } else {
            Olcum.baslat(this)
            val am = getSystemService(AlarmManager::class.java)
            if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
                Toast.makeText(this, "Kesin alarm izni yok; 'Kesin alarm izni' düğmesine bakın.", Toast.LENGTH_LONG).show()
            }
            yenile()
        }
    }

    private fun pilMuafiyeti() {
        try {
            @Suppress("BatteryLife")
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        } catch (_: ActivityNotFoundException) {
            ac(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    private fun ac(i: Intent) {
        try {
            startActivity(i)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "Bu ayar ekranı bu telefonda yok.", Toast.LENGTH_LONG).show()
        }
    }

    private fun isaret(tur: String) {
        if (!Durum.calisiyor(this)) {
            Toast.makeText(this, "Önce ölçümü başlatın.", Toast.LENGTH_SHORT).show()
            return
        }
        Gunluk.yaz(this, Tur.ISARET, linkedMapOf("tur" to tur))
        Toast.makeText(this, "İşaret kaydedildi.", Toast.LENGTH_SHORT).show()
    }

    private fun dosyaAdi(): String =
        "ajanda-olcum-" + SimpleDateFormat("yyyyMMdd-HHmm", Locale.ROOT).format(Date()) + ".txt"

    private fun disaMetin(): String =
        Rapor.disaAktarim(ozetMetni(), Gunluk.oku(this), System.currentTimeMillis())

    private fun dosyayaKaydet() {
        val i = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TITLE, dosyaAdi())
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(i, KAYDET)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "Dosya seçici yok; 'Paylaş'ı kullanın.", Toast.LENGTH_LONG).show()
        }
    }

    @Deprecated("Platform Activity API'si")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        if (requestCode != KAYDET || resultCode != RESULT_OK || uri == null) return
        try {
            contentResolver.openOutputStream(uri, "wt")!!.use { it.write(disaMetin().toByteArray(Charsets.UTF_8)) }
            Toast.makeText(this, "Kaydedildi.", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Kaydedilemedi: ${e.javaClass.simpleName}", Toast.LENGTH_LONG).show()
        }
    }

    private fun paylas() {
        val klasor = PaylasimSaglayici.klasor(this)
        klasor.listFiles()?.forEach { it.delete() }
        val f = File(klasor, dosyaAdi())
        f.writeText(disaMetin(), Charsets.UTF_8)
        val i = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_STREAM, PaylasimSaglayici.uri(this, f))
            .putExtra(Intent.EXTRA_SUBJECT, f.name)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        ac(Intent.createChooser(i, "Günlüğü paylaş"))
    }

    private fun gunluguSil() {
        if (Durum.calisiyor(this)) {
            Toast.makeText(this, "Önce ölçümü durdurun.", Toast.LENGTH_SHORT).show()
            return
        }
        AlertDialog.Builder(this)
            .setMessage("Günlük kalıcı olarak silinsin mi? Önce dışa verdiğinizden emin olun.")
            .setPositiveButton("Sil") { _, _ -> Gunluk.sil(this); yenile() }
            .setNegativeButton("Vazgeç", null)
            .show()
    }
}
