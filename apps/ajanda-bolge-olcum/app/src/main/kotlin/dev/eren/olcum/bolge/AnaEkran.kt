package dev.eren.olcum.bolge

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
import dev.eren.olcum.bolge.cekirdek.Analiz
import dev.eren.olcum.bolge.cekirdek.Gecis
import dev.eren.olcum.bolge.cekirdek.Gizlilik
import dev.eren.olcum.bolge.cekirdek.GunlukBicimi
import dev.eren.olcum.bolge.cekirdek.Kayitlar
import dev.eren.olcum.bolge.cekirdek.Kol
import dev.eren.olcum.bolge.cekirdek.Rapor
import dev.eren.olcum.bolge.cekirdek.Tur
import dev.eren.olcum.bolge.cekirdek.Yon
import java.io.File
import java.text.SimpleDateFormat
import java.time.ZoneId
import java.util.Date
import java.util.Locale

/** Tek ana ekran: izleme durumu, kurulum adımları, bölgeler, elle kayıt, işaretler, rapor. */
class AnaEkran : Activity() {
    companion object {
        const val EYLEM_VARDIM = "dev.eren.olcum.bolge.VARDIM"
        private const val RC_KONUM = 1
        private const val RC_ARKA = 2
        private const val RC_BILDIRIM = 3
        private const val RC_KAYDET = 4
        private val DAKIKALAR = intArrayOf(0, 5, 10, 15, 30, 60)
        private val DAKIKA_ADLARI = arrayOf("Şimdi", "5 dk önce", "10 dk önce", "15 dk önce", "30 dk önce", "1 saat önce")
    }

    private lateinit var d: Duzen
    private lateinit var durumYazi: TextView
    private lateinit var baslatDugme: Button
    private lateinit var kurulumYazi: TextView
    private lateinit var arkaDugme: Button
    private lateinit var bolgeKutu: LinearLayout
    private lateinit var etiketKutu: LinearLayout
    private lateinit var donemYazi: TextView
    private lateinit var ozetYazi: TextView
    private lateinit var otoKutu: CheckBox
    private lateinit var pilKutu: CheckBox

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        d = Duzen(this)
        d.baslik("Bölge hatırlatması ölçümü")
        d.yazi("Bir yere varınca bildirim gelme güvenilirliğini üç yolla aynı anda ölçer. " +
            "Koordinatlar yalnız bu telefonda kalır; raporda yalnız \"bölge 1\" gibi etiketler olur. İnternet izni yoktur.")
        durumYazi = d.yazi(boyut = 14f).apply { setTypeface(typeface, Typeface.BOLD) }
        baslatDugme = d.dugme("") { baslatDurdur() }

        d.baslik("1. Kurulum (sırayla)")
        kurulumYazi = d.yazi()
        d.dugme("① Kesin konum izni") { konumIzni() }
        arkaDugme = d.dugme("② Arka plan konumu: \"Her zaman izin ver\"") { arkaPlanIzni() }
        d.dugme("③ Bildirim izni") { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), RC_BILDIRIM) }

        d.baslik("2. Bölgeler (en az iki)")
        bolgeKutu = d.kutu()
        d.dugme("+ Bulunduğum yeri bölge olarak kaydet") {
            startActivity(Intent(this, BolgeEkrani::class.java).putExtra("amac", "kayit"))
        }
        d.dugme("Şu anki konumu sına (merkeze uzaklık, doğruluk)") {
            if (Bolgeler.hepsi(this).isEmpty()) kisa("Önce bir bölge kaydedin.")
            else startActivity(Intent(this, BolgeEkrani::class.java).putExtra("amac", "sina"))
        }

        d.baslik("3. Yanıt bekleyen bildirimler")
        etiketKutu = d.kutu()

        d.baslik("4. Deneme işareti (denemeden hemen önce bas)")
        val s1 = d.satir()
        d.dugme("Kaydırıp atacağım", s1) { isaret("kaydir", "Şimdi uygulamayı son uygulamalardan kaydırıp atın; bir sonraki varışa kadar AÇMAYIN.") }
        d.dugme("Yeniden başlatacağım", s1) { isaret("yeniden", "Bölgenin içindeyken telefonu yeniden başlatın; sonra uygulamayı AÇMAYIN.") }
        val s2 = d.satir()
        d.dugme("Konumu kapatıp açacağım", s2) { isaret("konum", "Konumu hızlı ayarlardan kapatın, birkaç dakika sonra açın.") }
        d.dugme("Pil tasarrufunu açtım", s2) { isaret("tasarruf", "Pil tasarrufu açıkken olan varışlar ayrı sayılır.") }

        d.baslik("5. Dönem (ikinci hafta)")
        donemYazi = d.yazi()
        d.dugme("Pil optimizasyonundan muaf tut") { pilMuafiyeti() }
        d.dugme("HyperOS: otomatik başlatma") { otomatikBaslatma() }
        d.dugme("HyperOS: pil tasarrufu → Kısıtlama yok") { pilKisiti() }
        d.dugme("Uygulama bilgisi") { ac(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }
        otoKutu = CheckBox(this).apply {
            text = "Otomatik başlatmayı açtım"
            setOnClickListener { beyan("otomatikBaslatma", isChecked) }
            d.kok.addView(this)
        }
        pilKutu = CheckBox(this).apply {
            text = "Pil tasarrufunu \"Kısıtlama yok\" yaptım"
            setOnClickListener { beyan("pilKisitYok", isChecked) }
            d.kok.addView(this)
        }
        d.dugme("İkinci döneme geç (ayarları açtıktan sonra)") { donemDegistir() }

        d.baslik("6. Sonuç")
        val s3 = d.satir()
        d.dugme("Yenile", s3) { yenile() }
        d.dugme("Dosyaya kaydet", s3) { dosyayaKaydet() }
        d.dugme("Paylaş", s3) { paylas() }
        val s4 = d.satir()
        d.dugme("Kolları yeniden kur", s4) { Izleme.kurHepsi(this, "elle") { yenile() } }
        d.dugme("Günlüğü sil", s4) { gunluguSil() }
        ozetYazi = d.yazi(boyut = 11f).apply {
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
        }
        d.goster()
        kisayol(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        kisayol(intent)
    }

    /** Uygulama simgesindeki "Vardım: <ad>" kısayolu. */
    private fun kisayol(i: Intent?) {
        if (i?.action != EYLEM_VARDIM) return
        val id = i.getIntExtra("bolge", -1)
        val b = Bolgeler.bul(this, id) ?: return
        if (!Durum.calisiyor(this)) {
            kisa("Ölçüm başlatılmadı.")
            return
        }
        Etiketler.elle(this, id, Gecis.GIRIS, 0)
        kisa("${b.ad}: varış kaydedildi.")
        i.action = null
    }

    override fun onResume() {
        super.onResume()
        if (Durum.calisiyor(this)) Gunluk.yaz(this, Tur.EKRAN, linkedMapOf("ad" to "ana"))
        Izleme.giris(this, "ekran") { yenile() }
        Olgular.olguYaz(this, zorla = false)
        SistemAlici.konumDegisti(this, kur = true, kaynak = "ekran") { yenile() }
        yenile()
    }

    // ---------------------------------------------------------------- görünüm

    private fun saat(t: Long) = SimpleDateFormat("dd.MM HH:mm", Locale.ROOT).format(Date(t))

    private fun yenile() {
        val calisiyor = Durum.calisiyor(this)
        baslatDugme.text = if (calisiyor) "Ölçümü durdur" else "Ölçümü başlat"
        val kollar = Izleme.durumlar(this)
        val uyarilar = ArrayList<String>()
        if (calisiyor && !Olgular.bildirimIzni(this)) uyarilar += "Bildirim izni yok: algılar kaydedilir ama soru gelmez."
        if (calisiyor && Bolgeler.hepsi(this).size < 2) uyarilar += "En az iki bölge tanımlayın."
        val tamam = calisiyor && kollar.all { it.etkin }
        durumYazi.text = (if (!calisiyor) "Ölçüm KAPALI" else if (tamam) "İZLEME ETKİN" else "İZLEME ETKİN DEĞİL (aşağıya bakın)") + "\n" +
            kollar.joinToString("\n") { "${if (it.etkin) "✓" else "✗"} ${Kol.ad(it.kol)}: ${it.aciklama}" } +
            (if (uyarilar.isEmpty()) "" else "\n! " + uyarilar.joinToString("\n! "))
        durumYazi.setTextColor(if (tamam) Color.rgb(0, 110, 40) else Color.rgb(180, 20, 20))

        fun t(x: Boolean) = if (x) "✓" else "✗"
        kurulumYazi.text = "${t(Olgular.kesinKonum(this))} kesin konum   ${t(Olgular.arkaPlanKonum(this))} arka plan konumu   " +
            "${t(Olgular.bildirimIzni(this))} bildirim   ${t(Olgular.konumAcik(this))} konum açık" +
            if (Olgular.yaklasikKonum(this) && !Olgular.kesinKonum(this)) "\n! Yalnız YAKLAŞIK konum verilmiş; kesin konum gerekli." else ""
        arkaDugme.isEnabled = Olgular.kesinKonum(this)

        bolgeleriGoster()
        etiketsizleriGoster()

        val donem = Durum.donem(this)
        donemYazi.text = "Şu an: ${Analiz.donemAdi(donem)}\n" +
            "Pil muafiyeti: ${if (Olgular.pilMuaf(this)) "VAR" else "yok"} · otomatik başlatma (okunan): ${Olgular.otomatikBaslatma(this)}"
        otoKutu.isChecked = Durum.beyan(this, "otomatikBaslatma")
        pilKutu.isChecked = Durum.beyan(this, "pilKisitYok")

        val ay = GunlukBicimi.ayristirHepsi(Gunluk.oku(this))
        ozetYazi.text = Rapor.metin(Analiz.analiz(ay.olaylar, System.currentTimeMillis(), ay.hataliSatir), ZoneId.systemDefault())
    }

    private fun bolgeleriGoster() {
        bolgeKutu.removeAllViews()
        val l = Bolgeler.hepsi(this)
        if (l.isEmpty()) d.yazi("Henüz bölge yok.", bolgeKutu)
        for (b in l) {
            d.yazi("${b.ad} (${b.etiket}) · yarıçap ${b.yaricap} m · Wi-Fi ${if (b.wifiOzet != null) "eşli" else "eşsiz"}", bolgeKutu)
                .setTypeface(null, Typeface.BOLD)
            val r1 = d.satir(bolgeKutu)
            d.dugme("Vardım", r1) { elle(b.id, Gecis.GIRIS, "${b.ad}: ne zaman vardınız?") }
            d.dugme("Çıktım", r1) { elle(b.id, Gecis.CIKIS, "${b.ad}: ne zaman çıktınız?") }
            d.dugme("Önünden geçtim", r1) { elle(b.id, Gecis.GECTI, "${b.ad}: ne zaman önünden/yakınından geçtiniz?") }
            val r2 = d.satir(bolgeKutu)
            d.dugme(if (b.wifiOzet != null) "Wi-Fi eşini kaldır" else "Bağlı Wi-Fi'yi eşle", r2) { wifiEsle(b.id, b.wifiOzet == null) }
            d.dugme("Sil", r2) { bolgeSil(b.id, b.ad) }
        }
    }

    private fun etiketsizleriGoster() {
        etiketKutu.removeAllViews()
        val ay = GunlukBicimi.ayristirHepsi(Gunluk.oku(this))
        val l = Analiz.bolumler(ay.olaylar).filter { it.etiket == null }.take(8)
        if (l.isEmpty()) d.yazi("Yok.", etiketKutu)
        for (bl in l) {
            val ad = Bolgeler.bul(this, bl.bolge)?.ad ?: "bölge ${bl.bolge}"
            d.dugme("${saat(bl.ilk)} $ad ${if (bl.yon == Yon.GIRIS) "giriş" else "çıkış"}" +
                (if (bl.kurulum) " (kurulum)" else "") + " — yanıtla", etiketKutu) {
                startActivity(
                    Intent(this, EtiketEkrani::class.java)
                        .putExtra("bolum", bl.id).putExtra("bolge", bl.bolge).putExtra("yon", bl.yon.name).putExtra("ilk", bl.ilk),
                )
            }
        }
    }

    // ---------------------------------------------------------------- ölçüm

    private fun baslatDurdur() {
        if (Durum.calisiyor(this)) {
            AlertDialog.Builder(this)
                .setMessage("Ölçüm durdurulsun mu? Günlük silinmez.")
                .setPositiveButton("Durdur") { _, _ -> Olcum.durdur(this); yenile() }
                .setNegativeButton("Vazgeç", null)
                .show()
            return
        }
        if (!Olgular.kesinKonum(this)) {
            uzun("Önce ① kesin konum iznini verin.")
            return
        }
        Olcum.baslat(this)
        if (!Olgular.arkaPlanKonum(this)) uzun("Arka plan konumu izni yok: uygulama kapalıyken algılama çalışmaz. ②'ye basın.")
        yenile()
    }

    private fun elle(id: Int, gecis: String, soru: String) {
        if (!Durum.calisiyor(this)) {
            kisa("Önce ölçümü başlatın.")
            return
        }
        AlertDialog.Builder(this)
            .setTitle(soru)
            .setItems(DAKIKA_ADLARI) { _, i ->
                Etiketler.elle(this, id, gecis, DAKIKALAR[i])
                kisa("Kaydedildi.")
                yenile()
            }
            .setNegativeButton("Vazgeç", null)
            .show()
    }

    private fun isaret(tur: String, aciklama: String) {
        if (!Durum.calisiyor(this)) {
            kisa("Önce ölçümü başlatın.")
            return
        }
        Gunluk.yaz(this, Tur.ISARET, linkedMapOf("tur" to tur).apply { putAll(Olgular.anDurumu(this@AnaEkran)) })
        AlertDialog.Builder(this).setMessage("İşaret kaydedildi.\n\n$aciklama").setPositiveButton("Tamam", null).show()
    }

    private fun beyan(ad: String, deger: Boolean) {
        Durum.beyanYaz(this, ad, deger)
        if (Durum.calisiyor(this)) Gunluk.yaz(this, Tur.BEYAN, linkedMapOf("ad" to ad, "deger" to Kayitlar.b(deger)))
        Olgular.olguYaz(this, zorla = false)
    }

    private fun donemDegistir() {
        val yeni = if (Durum.donem(this) == 1) 2 else 1
        AlertDialog.Builder(this)
            .setMessage("${Analiz.donemAdi(yeni)} başlasın mı? Bundan sonraki olaylar bu dönemde sayılır.")
            .setPositiveButton("Başlat") { _, _ ->
                Durum.donemYaz(this, yeni)
                if (Durum.calisiyor(this)) Gunluk.yaz(this, Tur.DONEM, linkedMapOf("no" to "$yeni"))
                Olgular.olguYaz(this, zorla = true)
                yenile()
            }
            .setNegativeButton("Vazgeç", null)
            .show()
    }

    // ---------------------------------------------------------------- bölge işlemleri

    private fun wifiEsle(id: Int, esle: Boolean) {
        val ozet = if (esle) {
            Kayitlar.wifiOzeti(WifiAlici.simdikiSsid(this), Durum.tuz(this)) ?: run {
                uzun("Bağlı Wi-Fi'nin adı okunamadı. Wi-Fi'ye bağlı olun, konum açık ve kesin konum izni verilmiş olsun.")
                return
            }
        } else null
        Bolgeler.wifiAyarla(this, id, ozet)
        if (Durum.calisiyor(this)) Gunluk.yaz(this, Tur.WIFIBAG, linkedMapOf("id" to "$id", "var" to Kayitlar.b(ozet != null)))
        kisa(if (ozet != null) "Wi-Fi eşlendi (ağ adı saklanmadı, yalnız özeti)." else "Wi-Fi eşi kaldırıldı.")
        yenile()
    }

    private fun bolgeSil(id: Int, ad: String) {
        AlertDialog.Builder(this)
            .setMessage("\"$ad\" silinsin mi? Günlükteki geçmişi kalır.")
            .setPositiveButton("Sil") { _, _ ->
                Izleme.bolgeKaldir(this, id)
                Bolgeler.sil(this, id)
                if (Durum.calisiyor(this)) {
                    Gunluk.yaz(this, Tur.BOLGESIL, linkedMapOf("id" to "$id"))
                    Izleme.kurHepsi(this, "bolge_silindi") { yenile() }
                }
                Bolgeler.kisayollariGuncelle(this)
                yenile()
            }
            .setNegativeButton("Vazgeç", null)
            .show()
    }

    // ---------------------------------------------------------------- izinler ve ayarlar

    private fun konumIzni() {
        if (Olgular.kesinKonum(this)) {
            kisa("Kesin konum izni zaten var.")
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Kesin konum izni")
            .setMessage("Bir yere varışı 100-250 m'lik bir çemberle anlamak için KESİN konum gerekir. " +
                "Açılan pencerede \"Kesin\" seçili kalsın ve \"Uygulamayı kullanırken\"i seçin. " +
                "Konum yalnız bu telefonda tutulur; uygulamanın internet izni yoktur.")
            .setPositiveButton("Devam") { _, _ ->
                requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), RC_KONUM)
            }
            .setNegativeButton("Vazgeç", null)
            .show()
    }

    private fun arkaPlanIzni() {
        if (Olgular.arkaPlanKonum(this)) {
            kisa("Arka plan konumu izni zaten var.")
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Arka plan konumu")
            .setMessage("Uygulama kapalıyken de varışı algılamak için gerekir. Açılacak ayarlar sayfasında " +
                "\"Her zaman izin ver\"i seçip geri dönün.")
            .setPositiveButton("Ayarlara git") { _, _ ->
                requestPermissions(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION), RC_ARKA)
            }
            .setNegativeButton("Vazgeç", null)
            .show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        Olgular.olguYaz(this, zorla = true)
        val verildi = grantResults.isNotEmpty() && grantResults.all { it == android.content.pm.PackageManager.PERMISSION_GRANTED }
        if (!verildi && requestCode != RC_KAYDET) {
            // İzin iki kez reddedilince sistem pencereyi bir daha göstermez; ayarlara yönlendir.
            AlertDialog.Builder(this)
                .setMessage("İzin verilmedi. Uygulama ayarlarından elle verebilirsiniz (İzinler → Konum / Bildirimler).")
                .setPositiveButton("Ayarları aç") { _, _ ->
                    ac(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                }
                .setNegativeButton("Kapat", null)
                .show()
        }
        if (verildi && Durum.calisiyor(this)) Izleme.kurHepsi(this, "izin") { yenile() }
        yenile()
    }

    private fun pilMuafiyeti() {
        @Suppress("BatteryLife")
        val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
        if (!ac(i)) ac(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    /** HyperOS/MIUI ekran adları sürüme göre değişir; DOĞRULANMADI. Açılmazsa uygulama bilgisine düşer. */
    private fun otomatikBaslatma() {
        val adaylar = listOf(
            Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")),
            Intent("miui.intent.action.OP_AUTO_START").addCategory(Intent.CATEGORY_DEFAULT),
        )
        if (adaylar.none { ac(it) }) {
            uzun("Otomatik başlatma ekranı bulunamadı: Uygulama bilgisi → Otomatik başlatma.")
            ac(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
    }

    private fun pilKisiti() {
        val i = Intent().setComponent(ComponentName("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"))
            .putExtra("package_name", packageName)
            .putExtra("package_label", "Bölge Ölçüm")
        if (!ac(i)) {
            uzun("Pil ekranı bulunamadı: Uygulama bilgisi → Pil tasarrufu → Kısıtlama yok.")
            ac(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
    }

    // ---------------------------------------------------------------- dışa verme

    private fun dosyaAdi(): String =
        "bolge-olcum-" + SimpleDateFormat("yyyyMMdd-HHmm", Locale.ROOT).format(Date()) + ".txt"

    /** Rapor + ham günlük; son adımda cihazdaki gerçek gizli değerlere karşı taranır. */
    private fun disaMetin(): String {
        val ay = GunlukBicimi.ayristirHepsi(Gunluk.oku(this))
        val ozet = Rapor.metin(Analiz.analiz(ay.olaylar, System.currentTimeMillis(), ay.hataliSatir), ZoneId.systemDefault())
        val ham = Rapor.disaAktarim(ozet, Gunluk.oku(this), System.currentTimeMillis())
        val g = Gizlilik.temizle(ham, Bolgeler.hepsi(this), listOfNotNull(WifiAlici.simdikiSsid(this)))
        return g.metin + "# gizlilik denetimi: ${if (g.duzeltme == 0) "temiz" else "${g.duzeltme} değer silindi"}\n"
    }

    private fun dosyayaKaydet() {
        val i = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TITLE, dosyaAdi())
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(i, RC_KAYDET)
        } catch (_: Exception) {
            uzun("Dosya seçici yok; 'Paylaş'ı kullanın.")
        }
    }

    @Deprecated("Platform Activity API'si")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        if (requestCode != RC_KAYDET || resultCode != RESULT_OK || uri == null) return
        try {
            contentResolver.openOutputStream(uri, "wt")!!.use { it.write(disaMetin().toByteArray(Charsets.UTF_8)) }
            kisa("Kaydedildi.")
        } catch (e: Exception) {
            uzun("Kaydedilemedi: ${e.javaClass.simpleName}")
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
        ac(Intent.createChooser(i, "Raporu paylaş"))
    }

    private fun gunluguSil() {
        if (Durum.calisiyor(this)) {
            kisa("Önce ölçümü durdurun.")
            return
        }
        AlertDialog.Builder(this)
            .setMessage("Günlük kalıcı olarak silinsin mi? Bölgeler silinmez. Önce dışa verdiğinizden emin olun.")
            .setPositiveButton("Sil") { _, _ -> Gunluk.sil(this); yenile() }
            .setNegativeButton("Vazgeç", null)
            .show()
    }
}
