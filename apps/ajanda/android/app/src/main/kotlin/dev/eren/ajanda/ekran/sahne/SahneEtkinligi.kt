package dev.eren.ajanda.ekran.sahne

import android.app.Application
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelProvider
import dev.eren.ajanda.CekirdekErisimi
import dev.eren.ajanda.ag.BaglantiYoneticisi
import dev.eren.ajanda.alarm.AlarmYenidenKurma
import dev.eren.ajanda.alarm.Bildirimler
import dev.eren.ajanda.alarm.HatirlatmaDurumu
import dev.eren.ajanda.alarm.HatirlatmaSorunu
import dev.eren.ajanda.cekirdek.YenidenKurmaNedeni
import dev.eren.ajanda.ekran.CekirdekYuzu
import dev.eren.ajanda.ekran.HatirlatmaUyarilari
import dev.eren.ajanda.ekran.KayitEkrani
import dev.eren.ajanda.ekran.sahne.ekranlar.BugunEylemleri
import dev.eren.ajanda.ekran.sahne.tema.SahneTema
import dev.eren.ajanda.ekran.sahne.veri.BugunDeposu
import dev.eren.ajanda.kimlik.EslestirmeEkrani
import java.time.LocalDate
import java.time.ZonedDateTime
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Sahne arayüzünün etkinliği (Jetpack Compose). Eski ekranlar (`ekran/AnaEkran` ...) yeni ekranlar hazır
 * olana kadar başlatıcı girişi olarak kalır; bu etkinlik yalnız debug derlemede ikinci bir başlatıcı
 * girişiyle ("Ajanda Sahne", `src/debug/AndroidManifest.xml`) açılır.
 *
 * Veri: Bugün'ün durum tutucusu ([BugunDeposu]) bir `ViewModel`'de yaşar (ekran dönüşünde yeniden okunmaz,
 * açılış hareketi bir kez oynar); çekirdek çağrıları onun tek arka iş parçacığında. Gözlemci öne gelişte
 * eklenir, arka plana geçişte çıkarılır. Eski ana ekranın etkinlik işleri burada da yapılır: açılışta
 * alarmların yeniden kurulması, bildirim izni, bildirimden gelen kaydın açılması, eşleştirme, hatırlatma
 * sorunlarının çözümü, gönderilemeyen değişikliğin düzeltilmesi ve dakika sayacı.
 *
 * Kenardan kenara çizer. Durum çubuğu saydam; gezinme çubuğu sistemin varsayılan perdesiyle: API 29+'da
 * 3 tuşlu gezinmede sistem kendisi karşıtlık perdesi koyar (hareketle gezinmede perde yok), API 26-28'de
 * tuşların arkasında her zaman yarı saydam perde durur ki koyu levha geçerken de okunsunlar.
 */
class SahneEtkinligi : ComponentActivity() {

    /** Etkinlik yeniden kurulsa da yaşayan durum: Bugün deposu ve iş parçacığı. */
    class Veri(uygulama: Application) : AndroidViewModel(uygulama) {
        private val arka: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "ajanda-sahne") }
        private val ana = Handler(Looper.getMainLooper())
        private val tercih = uygulama.getSharedPreferences("ajanda_sahne", Context.MODE_PRIVATE)

        val bugun = BugunDeposu(
            yuz = { CekirdekYuzu.Gercek(CekirdekErisimi.al(uygulama)) },
            saat = { ZonedDateTime.now() },
            calistirici = arka,
            anaya = { f -> ana.post(f) },
            baglan = { g ->
                val c = CekirdekErisimi.al(uygulama)
                val no = c.gozlemciEkle(g)
                ({ c.gozlemciCikar(no) })
            },
            bitenleriGizle = tercih.getBoolean("bitenleri_gizle", false),
            bitenleriGizleYaz = { tercih.edit().putBoolean("bitenleri_gizle", it).apply() },
        )

        override fun onCleared() {
            bugun.dur()
            arka.shutdown()
        }
    }

    private lateinit var veri: Veri
    private val ana = Handler(Looper.getMainLooper())
    private var acilacakKayit by mutableStateOf<String?>(null)
    private var izinIstendi = false
    private val tercih by lazy { getSharedPreferences("ajanda_sahne", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT),
            // Varsayılan perde (androidx.activity): açıkta %90 beyaz, koyuda %50 koyu gri.
            navigationBarStyle = SystemBarStyle.auto(PERDE_ACIK, PERDE_KOYU),
        )
        super.onCreate(savedInstanceState)
        veri = ViewModelProvider(this)[Veri::class.java]
        val ilkAcilis = !veri.bugun.acilisOynadi
        if (savedInstanceState == null) {
            // Açılışta alarmlar yeniden kurdurulur (bildirim kanallarını da kurar); kendi iş parçacığında.
            AlarmYenidenKurma.arkaPlanda(this, YenidenKurmaNedeni.UYGULAMA_ACILDI)
            bildirimdenGeldiyse(intent)
        } else {
            izinIstendi = savedInstanceState.getBoolean("izin_istendi")
        }
        val eylemler = BugunEylemleri(
            eslestir = ::eslestir,
            hatirlatmaCoz = ::uyariCoz,
            retDuzelt = { KayitEkrani.retDuzelt(this, ISTEK_KAYIT, it) },
        )
        setContent {
            // Gün değişimini depo dakika sayacıyla izler; bugün yalnız görüntü testleri için sabitlenebilen değer.
            val bugun = remember { LocalDate.now() }
            SahneTema {
                SahneKok(
                    bugun = bugun,
                    bugunDeposu = veri.bugun,
                    bugunEylemleri = eylemler,
                    acilis = ilkAcilis,
                    acilacakKayit = acilacakKayit,
                    kayitAcildi = { acilacakKayit = null },
                )
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean("izin_istendi", izinIstendi)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        bildirimdenGeldiyse(intent)
    }

    override fun onStart() {
        super.onStart()
        veri.bugun.basla()
        hatirlatmayiOku()
        dakikaSayaci.run()
        if (!izinIstendi && HatirlatmaDurumu.bildirimIzniIstenmeli(this)) {
            izinIstendi = true
            bildirimIzniIste()
        }
    }

    override fun onStop() {
        ana.removeCallbacks(dakikaSayaci)
        veri.bugun.dur()
        super.onStop()
    }

    /** "Geçti", gün cümlesi ve gün değişimi için dakikada bir yeniden kurar. */
    private val dakikaSayaci = object : Runnable {
        override fun run() {
            veri.bugun.dakika()
            val simdi = System.currentTimeMillis()
            ana.postDelayed(this, 60_000 - simdi % 60_000 + 50)
        }
    }

    private fun bildirimdenGeldiyse(i: Intent?) {
        val id = i?.getStringExtra(Bildirimler.KAYIT_ID) ?: return
        i.removeExtra(Bildirimler.KAYIT_ID)
        acilacakKayit = id
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            ISTEK_ESLESTIRME -> {
                veri.bugun.yenile()
                if (resultCode == RESULT_OK) BaglantiYoneticisi.simdiDene()
            }
            ISTEK_KAYIT -> if (resultCode == RESULT_OK) {
                data?.getStringExtra(KayitEkrani.SONUC_MESAJI)?.let { veri.bugun.tostGoster(it, null) }
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        @Suppress("DEPRECATION")
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == ISTEK_IZIN) hatirlatmayiOku()
    }

    private fun eslestir() {
        @Suppress("DEPRECATION")
        startActivityForResult(Intent(this, EslestirmeEkrani::class.java), ISTEK_ESLESTIRME)
    }

    // Hatırlatma sorunları (eski ana ekranla aynı yol).

    private fun hatirlatmayiOku() {
        val h = try {
            HatirlatmaDurumu.oku(this)
        } catch (_: Exception) {
            null
        }
        veri.bugun.hatirlatmaVer(h)
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
            veri.bugun.tostGoster("Ayar ekranı açılamadı.", null, hata = true)
        }
    }

    companion object {
        private const val ISTEK_KAYIT = 41
        private const val ISTEK_ESLESTIRME = 42
        private const val ISTEK_IZIN = 43

        /** androidx.activity `EdgeToEdge`'in varsayılan perdeleri (orada `internal`). */
        private val PERDE_ACIK = android.graphics.Color.argb(0xe6, 0xFF, 0xFF, 0xFF)
        private val PERDE_KOYU = android.graphics.Color.argb(0x80, 0x1b, 0x1b, 0x1b)
    }
}
