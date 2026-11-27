package dev.eren.olcum.bolge

import android.app.Activity
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputFilter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import dev.eren.olcum.bolge.cekirdek.Kayitlar
import dev.eren.olcum.bolge.cekirdek.KonumAlmaIst
import dev.eren.olcum.bolge.cekirdek.Mesafe
import dev.eren.olcum.bolge.cekirdek.Rapor
import dev.eren.olcum.bolge.cekirdek.Tur
import kotlin.math.roundToInt

/**
 * "Bulunduğum yeri kaydet" ve "konumu sına". Play birleşik konum + GPS + ağ sağlayıcısını aynı anda dinler,
 * her kaynağın ilk konum süresini ve doğruluğunu ölçer; en doğru örneği merkez yapar.
 * Koordinat yalnız bellekte ve özel bölge deposunda kalır; günlüğe yalnız süreler ve doğruluklar yazılır.
 */
class BolgeEkrani : Activity() {
    private val ana = Handler(Looper.getMainLooper())
    private lateinit var d: Duzen
    private var sina = false

    private lateinit var adKutu: EditText
    private lateinit var yaricapGrubu: RadioGroup
    private lateinit var wifiKutu: CheckBox
    private lateinit var kapaliKutu: CheckBox
    private lateinit var baslatDugme: Button
    private lateinit var kaydetDugme: Button
    private lateinit var canli: TextView

    private var bas = 0L
    private var bitis = 0L
    private var calisiyor = false
    private var kaydedildi = false
    private var ist = KonumAlmaIst()
    private var enIyi: Location? = null
    private var enIyiKaynak = ""
    private val son = HashMap<String, Float?>()

    private val fused by lazy { LocationServices.getFusedLocationProviderClient(this) }
    private val lm by lazy { getSystemService(LocationManager::class.java) }

    private val fusedGeri = object : LocationCallback() {
        override fun onLocationResult(r: LocationResult) {
            for (l in r.locations) yeni("fused", l)
        }
    }
    private val gpsDinle = LocationListener { yeni("gps", it) }
    private val agDinle = LocationListener { yeni("ag", it) }

    private val tik = object : Runnable {
        override fun run() {
            if (!calisiyor) return
            goster()
            val gecen = SystemClock.elapsedRealtime() - bas
            if (gecen >= if (sina) 60_000L else 180_000L) {
                durdur()
                if (sina) sinamaBitti()
            } else {
                ana.postDelayed(this, 1_000)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sina = intent.getStringExtra("amac") == "sina"
        d = Duzen(this)
        if (!Olgular.kesinKonum(this)) {
            uzun("Önce ana ekrandan kesin konum iznini verin.")
            finish()
            return
        }
        if (sina) {
            d.baslik("Şu anki konumu sına")
            d.yazi("60 sn konum toplanır; en doğru konumun en yakın bölge merkezine uzaklığı kaydedilir (koordinat değil).")
        } else {
            d.baslik("Bulunduğum yeri bölge olarak kaydet")
            d.yazi("Kaydetmek istediğiniz yerde durun. Kapalı alandaysanız işaretleyin: kapalı alanda konum alma süresi ayrıca ölçülür.")
            adKutu = EditText(this).apply {
                hint = "Ad (yalnız bu telefonda görünür), ör. Kütüphane"
                filters = arrayOf(InputFilter.LengthFilter(40))
                isSingleLine = true
                d.kok.addView(this)
            }
            d.yazi("Yarıçap:")
            yaricapGrubu = RadioGroup(this).apply {
                orientation = RadioGroup.HORIZONTAL
                for (r in listOf(100, 150, 250)) addView(RadioButton(this@BolgeEkrani).apply { text = "$r m"; id = r })
                check(150)
                d.kok.addView(this)
            }
            val ssidVar = WifiAlici.simdikiSsid(this) != null
            wifiKutu = CheckBox(this).apply {
                text = if (ssidVar) "Bağlı olduğum Wi-Fi'yi bu bölgeyle eşle (ağ adı saklanmaz)" else "Wi-Fi eşleme: bağlı ağın adı okunamıyor"
                isEnabled = ssidVar
                isChecked = false
                d.kok.addView(this)
            }
        }
        kapaliKutu = CheckBox(this).apply { text = "Kapalı alandayım"; d.kok.addView(this) }
        baslatDugme = d.dugme("Konum almaya başla") { if (calisiyor) durdur() else baslat() }
        canli = d.yazi(boyut = 13f)
        kaydetDugme = d.dugme(if (sina) "Bitir ve kaydet" else "Bu konumu kaydet") { if (sina) { durdur(); sinamaBitti() } else kaydet() }
        kaydetDugme.isEnabled = false
        d.dugme("Vazgeç") { finish() }
        d.goster()
    }

    override fun onResume() {
        super.onResume()
        if (Durum.calisiyor(this)) Gunluk.yaz(this, Tur.EKRAN, linkedMapOf("ad" to if (sina) "sina" else "kayit"))
        Izleme.giris(this, "ekran")
    }

    private fun baslat() {
        if (!Olgular.konumAcik(this)) {
            uzun("Konum kapalı; açıp yeniden deneyin.")
            return
        }
        ist = KonumAlmaIst()
        enIyi = null
        son.clear()
        bas = SystemClock.elapsedRealtime()
        bitis = 0L
        calisiyor = true
        try {
            val istek = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1_000L).setMinUpdateIntervalMillis(500L).build()
            fused.requestLocationUpdates(istek, fusedGeri, Looper.getMainLooper())
        } catch (_: Exception) {
        }
        for ((p, dinle) in listOf(LocationManager.GPS_PROVIDER to gpsDinle, LocationManager.NETWORK_PROVIDER to agDinle)) {
            try {
                if (lm.isProviderEnabled(p)) lm.requestLocationUpdates(p, 1_000L, 0f, dinle, Looper.getMainLooper())
            } catch (_: Exception) {
            }
        }
        baslatDugme.text = "Durdur"
        ana.post(tik)
    }

    private fun durdur() {
        if (!calisiyor) return
        calisiyor = false
        bitis = SystemClock.elapsedRealtime()
        try { fused.removeLocationUpdates(fusedGeri) } catch (_: Exception) {}
        try { lm.removeUpdates(gpsDinle) } catch (_: Exception) {}
        try { lm.removeUpdates(agDinle) } catch (_: Exception) {}
        baslatDugme.text = "Yeniden başlat"
        goster()
    }

    private fun yeni(kaynak: String, l: Location) {
        if (!calisiyor) return
        val t = SystemClock.elapsedRealtime() - bas
        val yas = (SystemClock.elapsedRealtimeNanos() - l.elapsedRealtimeNanos) / 1_000_000
        val dog = if (l.hasAccuracy()) l.accuracy else null
        if (!ist.ekle(kaynak, t, dog, yas)) return
        son[kaynak] = dog
        val e = enIyi
        if (dog != null && (e == null || !e.hasAccuracy() || dog < e.accuracy)) {
            enIyi = l
            enIyiKaynak = kaynak
        } else if (e == null) {
            enIyi = l
            enIyiKaynak = kaynak
        }
        kaydetDugme.isEnabled = true
    }

    private fun goster() {
        val gecen = if (bas == 0L) 0 else SystemClock.elapsedRealtime() - bas
        val satirlar = ist.kaynaklar.entries.joinToString("\n") { (ad, k) ->
            "  ${kaynakAdi(ad)}: ilk ${Rapor.sure(k.ilkMs)}, son ±${son[ad]?.roundToInt() ?: "-"} m, en iyi ±${k.enIyi?.roundToInt() ?: "-"} m, ${k.n} örnek"
        }
        canli.text = "Süre: ${Rapor.sure(gecen)}" + (if (calisiyor) " (sürüyor)" else "") + "\n" +
            (if (satirlar.isEmpty()) "  henüz konum yok" else satirlar) + "\n" +
            "En iyi: ±${ist.enIyi?.roundToInt() ?: "-"} m (${kaynakAdi(ist.enIyiKaynak ?: "-")})" +
            (if (ist.eski > 0) "\nönbellekten gelen eski konum (sayılmadı): ${ist.eski}" else "")
    }

    private fun kaynakAdi(k: String) = when (k) { "fused" -> "Play birleşik"; "gps" -> "GPS"; "ag" -> "Ağ"; else -> k }

    private fun konumAlmaKaydi(amac: String, ek: Map<String, String> = emptyMap()) {
        val alan = ist.alanlar(amac, kapaliKutu.isChecked, (if (bitis > 0) bitis else SystemClock.elapsedRealtime()) - bas)
        alan.putAll(ek)
        Gunluk.yaz(this, Tur.KONUMAL, alan)
    }

    private fun kaydet() {
        val l = enIyi ?: return
        val ad = adKutu.text.toString().trim()
        if (ad.isEmpty()) {
            kisa("Bir ad yazın.")
            return
        }
        durdur()
        val r = yaricapGrubu.checkedRadioButtonId.takeIf { it in listOf(100, 150, 250) } ?: 150
        val wifi = if (wifiKutu.isChecked) Kayitlar.wifiOzeti(WifiAlici.simdikiSsid(this), Durum.tuz(this)) else null
        val b = Bolgeler.ekle(this, ad, l.latitude, l.longitude, r, wifi)
        kaydedildi = true
        Gunluk.yaz(this, Tur.BOLGE, Kayitlar.bolgeAlanlari(b, if (l.hasAccuracy()) l.accuracy else null, enIyiKaynak))
        konumAlmaKaydi("kayit", linkedMapOf("bolge" to "${b.id}"))
        Bolgeler.kisayollariGuncelle(this)
        if (Durum.calisiyor(this)) Izleme.kurHepsi(this, "bolge_eklendi")
        kisa("${b.ad} kaydedildi (${b.etiket}, ±${if (l.hasAccuracy()) l.accuracy.roundToInt() else "?"} m).")
        finish()
    }

    private fun sinamaBitti() {
        if (kaydedildi) return
        kaydedildi = true
        val l = enIyi
        val bolgeler = Bolgeler.hepsi(this)
        if (l == null || bolgeler.isEmpty()) {
            konumAlmaKaydi("sina")
            canli.append("\nKonum alınamadı.")
            return
        }
        val yakin = bolgeler.minBy { Mesafe.metre(it.enlem, it.boylam, l.latitude, l.longitude) }
        val u = Mesafe.metre(yakin.enlem, yakin.boylam, l.latitude, l.longitude)
        konumAlmaKaydi(
            "sina",
            linkedMapOf("bolge" to "${yakin.id}", "uzaklik" to "${u.roundToInt()}", "icinde" to Kayitlar.b(u <= yakin.yaricap)),
        )
        kaydetDugme.isEnabled = false
        canli.append("\n\nEn yakın: ${yakin.ad} (${yakin.etiket}), merkeze ${u.roundToInt()} m " +
            "(${if (u <= yakin.yaricap) "içeride" else "dışarıda"}, yarıçap ${yakin.yaricap} m). Kaydedildi.")
    }

    override fun onDestroy() {
        durdur()
        ana.removeCallbacksAndMessages(null)
        // Kaydedilmeden çıkılsa da konum alma süresi ölçümü kaybolmasın.
        if (!kaydedildi && ist.n > 0 && ::kapaliKutu.isInitialized) konumAlmaKaydi(if (sina) "sina" else "vazgecildi")
        super.onDestroy()
    }
}
