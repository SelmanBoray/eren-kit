package dev.eren.olcum.bolge

import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.LocationManager
import android.os.SystemClock
import dev.eren.olcum.bolge.cekirdek.Kayitlar
import dev.eren.olcum.bolge.cekirdek.Sabit
import dev.eren.olcum.bolge.cekirdek.Tur

class Uygulama : Application() {
    companion object {
        /** Sürecin başladığı an (elapsedRealtime). */
        @Volatile
        var surecBaslangic: Long = 0L
    }

    override fun onCreate() {
        surecBaslangic = SystemClock.elapsedRealtime()
        super.onCreate()
        Bildirim.kanalKur(this)
        if (Durum.calisiyor(this)) Gunluk.yaz(this, Tur.ACILIS)
        // Manifest alıcısı HyperOS'ta engellenebilir; süreç yaşarken kapanış ve konum değişimi ayrıca dinlenir.
        val f = IntentFilter(Intent.ACTION_SHUTDOWN).apply { addAction(LocationManager.PROVIDERS_CHANGED_ACTION) }
        registerReceiver(SistemAlici(), f, Context.RECEIVER_NOT_EXPORTED)
    }
}

/** Ölçümü başlatma / durdurma. */
object Olcum {
    fun baslat(ctx: Context) {
        Durum.baslat(ctx)
        Durum.sonCikisYaz(ctx, System.currentTimeMillis())
        Durum.konumEtkinYaz(ctx, Olgular.konumAcik(ctx))
        Gunluk.yaz(
            ctx, Tur.BASLA,
            linkedMapOf(
                "bekleme" to "${Sabit.BEKLEME}",
                "kurulumPenceresi" to "${Sabit.KURULUM}",
                "donem" to "${Durum.donem(ctx)}",
                "konumAcik" to Kayitlar.b(Olgular.konumAcik(ctx)),
            ),
        )
        // Bölge bilgisi (koordinatsız) her başlangıçta yeniden yazılır; günlük silinse de rapor bölgeleri bilir.
        for (b in Bolgeler.hepsi(ctx)) Gunluk.yaz(ctx, Tur.BOLGE, Kayitlar.bolgeAlanlari(b, null, null))
        Olgular.olguYaz(ctx, zorla = true)
        Izleme.kurHepsi(ctx, "basla")
    }

    fun durdur(ctx: Context) {
        Izleme.kaldirHepsi(ctx)
        Gunluk.yaz(ctx, Tur.DUR)
        Durum.durdur(ctx)
    }
}
