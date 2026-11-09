package dev.eren.deneme

import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.SystemClock

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Olcum.init(this)
        Olcum.arttir("surec_sayaci")
    }
}

/** Süreç ölümünü de aşması gereken sayaçlar SharedPreferences'ta, gerisi bellekte. */
object Olcum {
    const val PAKET = "dev.eren.deneme"

    private lateinit var sp: SharedPreferences
    val surecBaslangic: Long = SystemClock.elapsedRealtime()

    @Volatile var servisBaslangic = 0L
    @Volatile var bagli = false
    @Volatile var surecBaglantisi = 0
    @Volatile var sonKomut = "-"
    @Volatile var erisim: ErisimServisi? = null
    @Volatile var sonPencerePaketi: String? = null
    @Volatile var wakeLockTutuluyor = false
    @Volatile var wakeLockAyarla: ((Boolean) -> Unit)? = null

    fun init(c: Context) {
        sp = c.getSharedPreferences("olcum", Context.MODE_PRIVATE)
    }

    fun yaz(k: String, v: String) = sp.edit().putString(k, v).apply()
    fun oku(k: String): String? = sp.getString(k, null)
    fun sayi(k: String): Int = sp.getInt(k, 0)
    fun arttir(k: String): Int {
        val n = sp.getInt(k, 0) + 1
        sp.edit().putInt(k, n).apply()
        return n
    }

    /** Zaman damgalı olay kaydı: "epoch_ms ayrıntı". */
    fun olay(k: String, ayrinti: String) = yaz(k, "${System.currentTimeMillis()} $ayrinti")
}

object Baslatici {
    /** Başarı ya da engel durum kaydına girer, çünkü asıl ölçülen budur. */
    fun baslat(c: Context, kaynak: String) {
        try {
            c.startForegroundService(Intent(c, CihazServisi::class.java).putExtra("kaynak", kaynak))
            Olcum.olay("servis_baslat_son", "$kaynak ok")
        } catch (e: Exception) {
            Olcum.olay("servis_baslat_hata", "$kaynak ${e.javaClass.simpleName}: ${e.message}")
        }
    }
}
