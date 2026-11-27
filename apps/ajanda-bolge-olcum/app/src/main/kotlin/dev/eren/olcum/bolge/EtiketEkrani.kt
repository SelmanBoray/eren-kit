package dev.eren.olcum.bolge

import android.app.Activity
import android.os.Bundle
import dev.eren.olcum.bolge.cekirdek.Cevap
import dev.eren.olcum.bolge.cekirdek.Tur
import dev.eren.olcum.bolge.cekirdek.Yon
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Bir algının gerçeğini sorar. Süre, bildirim ANINA göre sorulur (kullanıcı bildirimi geç görse de
 * gecikme doğru hesaplansın): "bildirim 14:02'de geldi; sen ne zaman varmıştın?"
 */
class EtiketEkrani : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val bolum = intent.getIntExtra("bolum", -1)
        val bolgeId = intent.getIntExtra("bolge", -1)
        val yon = runCatching { Yon.valueOf(intent.getStringExtra("yon") ?: "") }.getOrDefault(Yon.GIRIS)
        val ilk = intent.getLongExtra("ilk", System.currentTimeMillis())
        if (bolum < 0) {
            finish()
            return
        }
        val ad = Bolgeler.bul(this, bolgeId)?.ad ?: "bölge $bolgeId"
        val saat = SimpleDateFormat("HH:mm", Locale.ROOT).format(Date(ilk))
        val d = Duzen(this)
        fun sec(cevap: String, dk: Int) {
            Etiketler.etiketle(this, bolum, bolgeId, yon.name, cevap, dk, yol = "ekran")
            kisa("Kaydedildi.")
            finish()
        }
        if (yon == Yon.GIRIS) {
            d.baslik("$ad: varış algılandı ($saat)")
            d.yazi("İlk algı $saat'te geldi. O anda gerçekte ne oluyordu?")
            d.dugme("Yeni varmıştım (son 1-2 dk)") { sec(Cevap.VARDIM, 0) }
            d.yazi("Daha önce varmıştım; algıdan ne kadar önce?")
            val r1 = d.satir()
            for (dk in listOf(5, 10, 15)) d.dugme("$dk dk", r1) { sec(Cevap.VARDIM, dk) }
            val r2 = d.satir()
            for (dk in listOf(20, 30, 45, 60)) d.dugme(if (dk == 60) "1 sa+" else "$dk dk", r2) { sec(Cevap.VARDIM, dk) }
            d.dugme("Yalnız önünden / yakınından geçiyordum") { sec(Cevap.GECTI, 0) }
            d.dugme("Zaten buradaydım (yeni varmadım)") { sec(Cevap.ZATEN, 0) }
            d.dugme("Bölgede de yakınında da değildim") { sec(Cevap.DEGIL, 0) }
        } else {
            d.baslik("$ad: çıkış algılandı ($saat)")
            d.yazi("İlk algı $saat'te geldi. O anda gerçekte ne oluyordu?")
            d.dugme("Yeni çıkmıştım (son 1-2 dk)") { sec(Cevap.CIKTIM, 0) }
            d.yazi("Daha önce çıkmıştım; algıdan ne kadar önce?")
            val r1 = d.satir()
            for (dk in listOf(5, 10, 15)) d.dugme("$dk dk", r1) { sec(Cevap.CIKTIM, dk) }
            val r2 = d.satir()
            for (dk in listOf(20, 30, 45, 60)) d.dugme(if (dk == 60) "1 sa+" else "$dk dk", r2) { sec(Cevap.CIKTIM, dk) }
            d.dugme("Çıkmadım, hâlâ buradayım") { sec(Cevap.CIKMADIM, 0) }
            d.dugme("Bölgede hiç değildim") { sec(Cevap.DEGIL, 0) }
        }
        d.dugme("Sonra yanıtlarım") { finish() }
        d.goster()
    }

    override fun onResume() {
        super.onResume()
        if (Durum.calisiyor(this)) Gunluk.yaz(this, Tur.EKRAN, linkedMapOf("ad" to "etiket"))
        Izleme.giris(this, "ekran")
    }
}
