package dev.eren.cihaz.adaptor

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.speech.RecognizerIntent
import android.widget.Toast
import dev.eren.cihaz.cekirdek.UygulamaDurumu

/**
 * Kısayol (sözleşme §3): kullanıcı telefonda bir uygulamaya bakarken Hızlı Ayarlar kutucuğundan,
 * kalıcı bildirimdeki "<ad> ile konuş" eyleminden ya da ses tuşu kısayolundan açılır. Saydam pencere;
 * alttaki uygulama görünür kalır, kendi görünümü yoktur.
 *
 * Akış: (1) ilk iş `KisayolDeposu.onPlan` ile ön plandaki paket yakalanır (dikte penceresi öne
 * geçmeden); (2) köprüdeki `dikte()` ile aynı RecognizerIntent (tr-TR, RECORD_AUDIO yok); (3) dikte
 * boş olmayan bir metin verince ONAY SORULMADAN hemen `KisayolDeposu.koy` (tek çağıran burası);
 * bağlam paketi yalnız görünen adı çıkarılabiliyorsa eklenir; (4) JS ayakta değilse
 * (`Adaptor.olaylar == null`) uygulamanın başlatıcı etkinliği açılır; kısa bir Toast ile kapanır.
 *
 * İptal: dikte iptal edilir ya da boş dönerse hiçbir şey gönderilmeden sessizce kapanır; geri tuşu
 * tanıyıcıyı da kapatır. Döndürmede (dikte sürerken) dikte yeniden başlatılmaz, sonuç yeni örneğe
 * gelir; yakalanan paket ve `bitti` bayrağı korunur. `bitti` gönderimden önce kurulur ve kaydedilir,
 * böylece aynı dikte sonucu iki kez gönderilmez.
 *
 * Gönderilen bağlamın süzgeci `KisayolDeposu.koy` ile aynıdır: ad çıkarılamıyorsa (hassas/değişmez
 * liste, çekirdek yok, etiket okunamadı) paket de gönderilmez.
 */
class KisayolActivity : Activity() {

    private companion object {
        const val ISTEK_DIKTE = 0x4B01
        const val AD_EN_COK = 80
        const val AD_GOSTERIM_EN_COK = 40

        const val D_BITTI = "bitti"
        const val D_PAKET = "paket"
    }

    private var bitti = false
    private var paket: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val kayit = savedInstanceState
        if (kayit == null) {
            // İlk iş: dikte penceresi öne geçmeden kullanıcının baktığı uygulama.
            paket = KisayolDeposu.onPlan(this)
        } else {
            bitti = kayit.getBoolean(D_BITTI, false)
            paket = kayit.getString(D_PAKET)
        }
        if (bitti) {
            finish()
            return
        }

        window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))

        if (kayit == null) dikteBaslat()
        // Dikte sürerken yeniden kurulduysa: sonuç onActivityResult ile bu örneğe gelir; yeniden başlatılmaz.
    }

    // ---------------------------------------------------------------------------------------------
    // Dikte
    // ---------------------------------------------------------------------------------------------

    /** Köprüdeki `dikte()` ile aynı ayarlar. */
    private fun dikteBaslat() {
        val niyet = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "tr-TR")
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        try {
            startActivityForResult(niyet, ISTEK_DIKTE)
        } catch (_: ActivityNotFoundException) {
            bildir("Bu telefonda ses tanıma bulunamadı.")
            kapat()
        } catch (_: SecurityException) {
            bildir("Ses tanıma açılamadı.")
            kapat()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != ISTEK_DIKTE || bitti) return
        val m = if (resultCode == RESULT_OK) {
            data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim()
        } else {
            null
        }
        if (m.isNullOrEmpty()) return kapat()
        val ad = baglamAdi(paket)
        // Adı çıkarılamayan bağlam gönderilmez.
        gonder(m, if (ad == null) null else paket, ad)
    }

    /**
     * Ön plandaki paketin görünen adı; yalnız çekirdek ayaktayken ve paket hassas/değişmez listede
     * değilken (`KisayolDeposu.koy` ile aynı süzgeç). Kontrol karakterleri ayıklanır, en çok 80.
     */
    private fun baglamAdi(p: String?): String? {
        if (p == null) return null
        val listeler = Adaptor.cekirdek?.listeler ?: return null
        val uygun = try {
            when (listeler.durum(p)) {
                UygulamaDurumu.HASSAS, UygulamaDurumu.DEGISMEZ -> false
                else -> true
            }
        } catch (_: Exception) {
            false
        }
        if (!uygun) return null
        return try {
            @Suppress("DEPRECATION")
            val ham = packageManager.getApplicationLabel(packageManager.getApplicationInfo(p, 0)).toString()
            val sb = StringBuilder(ham.length)
            for (c in ham) {
                if (c.code < 0x20 || c.code in 0x7F..0x9F) continue
                sb.append(c)
            }
            var s = sb.toString().trim()
            if (s.length > AD_EN_COK) {
                var son = AD_EN_COK
                // Vekil çiftini ortadan bölme.
                if (Character.isHighSurrogate(s[son - 1])) son--
                s = s.substring(0, son).trim()
            }
            s.ifEmpty { null }
        } catch (_: Exception) {
            null
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Gönder / iptal
    // ---------------------------------------------------------------------------------------------

    /** Onaysız gönderim; `bitti` önce kurulur ki aynı sonuç ikinci kez gönderilmesin. */
    private fun gonder(metin: String, baglamPaketi: String?, ad: String?) {
        if (bitti) return
        bitti = true
        val tamam = try {
            KisayolDeposu.koy(this, metin, baglamPaketi)
            true
        } catch (_: Exception) {
            false
        }
        if (!tamam) {
            bildir("${asistanAdi()} oturumuna iletilemedi.")
        } else {
            val gorunen = ad?.let { gosterimAdi(it) }
            val ek = if (gorunen == null) "" else " · $gorunen"
            bildir("${asistanAdi()} oturumuna gönderildi$ek")
            if (Adaptor.olaylar == null) {
                // JS ayakta değil: uygulama açılınca `kisayolAl` ile yuvadan çeker.
                uygulamayiAc()
            }
        }
        finish()
    }

    private fun uygulamayiAc() {
        val niyet = packageManager.getLaunchIntentForPackage(packageName) ?: return
        niyet.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startActivity(niyet)
        } catch (_: ActivityNotFoundException) {
        } catch (_: SecurityException) {
        }
    }

    /** Göndermeden kapanır. Dikte sürüyorsa tanıyıcı da kapatılır (sonucu sahipsiz kalmasın). */
    private fun kapat() {
        if (bitti) return
        bitti = true
        taniyiciyiKapat()
        finish()
    }

    /** Etkin dikte isteği yoksa etkisizdir. */
    private fun taniyiciyiKapat() {
        try {
            finishActivity(ISTEK_DIKTE)
        } catch (_: Exception) {
        }
    }

    @Deprecated("Geri tuşu iptaldir")
    override fun onBackPressed() {
        kapat()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(D_BITTI, bitti)
        outState.putString(D_PAKET, paket)
    }

    override fun onDestroy() {
        // Döndürme değil gerçek kapanışsa ve sonuç gelmeden kapanıyorsak tanıyıcı sahipsiz kalmasın.
        if (isFinishing && !bitti) {
            bitti = true
            taniyiciyiKapat()
        }
        super.onDestroy()
    }

    // ---------------------------------------------------------------------------------------------
    // Küçük yardımcılar
    // ---------------------------------------------------------------------------------------------

    /**
     * Yalnız Toast gösterimi için: FORMAT (yön değiştirenler dahil), CONTROL, satır/paragraf
     * ayırıcıları boşlukla değiştirilir ve bu yerine konan boşluklar tekleşir (addaki gerçek ardışık boşluklar kalır), en çok 40 karakter ("…" ile).
     * Depoya giden paket ve gönderilen metin bundan etkilenmez.
     */
    private fun gosterimAdi(ham: String): String? {
        val sb = StringBuilder(ham.length)
        var i = 0
        while (i < ham.length) {
            val cp = ham.codePointAt(i)
            i += Character.charCount(cp)
            val tur = Character.getType(cp)
            val zararli = tur == Character.FORMAT.toInt() ||
                tur == Character.CONTROL.toInt() ||
                tur == Character.LINE_SEPARATOR.toInt() ||
                tur == Character.PARAGRAPH_SEPARATOR.toInt()
            if (zararli) {
                if (sb.isNotEmpty() && sb.last() != ' ') sb.append(' ')
            } else {
                sb.appendCodePoint(cp)
            }
        }
        var s = sb.toString().trim()
        if (s.length > AD_GOSTERIM_EN_COK) {
            var son = AD_GOSTERIM_EN_COK - 1
            if (Character.isHighSurrogate(s[son - 1])) son--
            s = s.substring(0, son).trim() + "…"
        }
        return s.ifEmpty { null }
    }

    private fun bildir(s: String) {
        try {
            Toast.makeText(applicationContext, s, Toast.LENGTH_SHORT).show()
        } catch (_: Exception) {
        }
    }
}
