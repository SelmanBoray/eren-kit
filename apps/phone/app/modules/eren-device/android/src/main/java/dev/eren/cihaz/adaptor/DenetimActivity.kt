package dev.eren.cihaz.adaptor

import android.app.Activity
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ArrayAdapter
import android.widget.TextView
import dev.eren.cihaz.cekirdek.DenetimOlayi
import dev.eren.cihaz.cekirdek.DenetimSatiri
import dev.eren.cihaz.cekirdek.IzinKaynagi
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/** Denetim günlüğü, yeniden eskiye. Satırda metin içeriği yoktur; yalnız kimlik ve kapalı liste değerleri. */
class DenetimActivity : Activity() {
    private val arka = Executors.newSingleThreadExecutor()
    private lateinit var baslik: TextView
    private lateinit var liste: ListView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        val kok = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(8))
            setBackgroundColor(Renkler.zemin)
        }
        baslik = TextView(this).apply { textSize = 14f; text = "Yükleniyor…"; setTextColor(Renkler.metinIkincil) }
        kok.addView(baslik)
        liste = ListView(this).apply { divider = null }
        kok.addView(liste, ViewGroup.LayoutParams.MATCH_PARENT, 0)
        (liste.layoutParams as LinearLayout.LayoutParams).weight = 1f
        setContentView(kok)

        val grant = intent?.getStringExtra("grant_id")?.takeIf { it.isNotEmpty() }
        yukle(grant)
    }

    override fun onDestroy() {
        arka.shutdownNow()
        super.onDestroy()
    }

    private fun yukle(grant: String?) {
        val kapi = Adaptor.cekirdek?.denetimKapisi
        if (kapi == null) {
            baslik.text = "Servis çalışmıyor; denetim okunamadı."
            return
        }
        arka.execute {
            val satirlar = try {
                kapi.satirlar(SON_N, grant)
            } catch (_: Exception) {
                null
            }
            val metinler = satirlar?.asReversed()?.map { bicimle(it) }
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                if (metinler == null) {
                    baslik.text = "Denetim okunamadı."
                    return@runOnUiThread
                }
                baslik.text = if (metinler.isEmpty()) "Kayıt yok." else
                    "Son ${metinler.size} kayıt, yeniden eskiye" +
                        (if (grant != null) " (izin ${kisa(grant)})" else "")
                liste.adapter = object : ArrayAdapter<String>(this, android.R.layout.simple_list_item_1, metinler) {
                    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View =
                        (super.getView(position, convertView, parent) as TextView).apply {
                            setTextColor(Renkler.metin)
                        }
                }
            }
        }
    }

    private fun bicimle(s: DenetimSatiri): String {
        val zaman = SimpleDateFormat("dd.MM HH:mm:ss", Locale.getDefault()).format(Date(s.duvarMs))
        val olay = when (s.olay) {
            DenetimOlayi.KOMUT -> "komut"
            DenetimOlayi.IZIN_VERILDI -> "izin verildi"
            DenetimOlayi.IZIN_GERI_CEKILDI -> "izin geri çekildi"
            DenetimOlayi.BAGLANTI_ACILDI -> "bağlantı açıldı"
            DenetimOlayi.BAGLANTI_KOPTU -> "bağlantı koptu"
        }
        val sonuc = when {
            s.denied != null -> "RET " + s.denied.kablo
            s.hata != null -> "HATA " + s.hata.kablo
            s.grantNedeni != null -> s.grantNedeni.kablo
            s.olay == DenetimOlayi.KOMUT -> "ret ya da hata yok"
            else -> null
        }
        val sb = StringBuilder(zaman).append("  ").append(olay)
        if (s.olay == DenetimOlayi.IZIN_VERILDI) {
            when (s.kaynak) {
                IzinKaynagi.OTO -> sb.append(" (otomatik (tam yetki))")
                IzinKaynagi.ONAY -> sb.append(" (onaylı)")
                null -> {}
            }
        }
        s.komut?.let { sb.append("\nkomut: ").append(it.kablo) }
        sonuc?.let { sb.append("\nsonuç: ").append(it) }
        s.paket?.let { sb.append("\npaket: ").append(guvenli(it)) }
        s.grantId?.let { sb.append("\nizin: ").append(kisa(it)) }
        return sb.toString()
    }

    private fun kisa(id: String): String = guvenli(id).take(8)

    /** Kapalı kümeden gelmeyen tek alanlar (paket, kimlik): denetim karakterlerini at, kısalt. */
    private fun guvenli(s: String): String = s.filter { !it.isISOControl() }.take(100)

    private fun dp(n: Int): Int = (n * resources.displayMetrics.density).toInt()

    private companion object {
        const val SON_N = 300
    }
}
