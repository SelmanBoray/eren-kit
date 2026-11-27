package dev.eren.olcum.bolge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.location.Location
import android.location.LocationManager
import android.os.SystemClock
import dev.eren.olcum.bolge.cekirdek.Bolge
import dev.eren.olcum.bolge.cekirdek.Cevap
import dev.eren.olcum.bolge.cekirdek.Gecis
import dev.eren.olcum.bolge.cekirdek.Kayitlar
import dev.eren.olcum.bolge.cekirdek.Kol
import dev.eren.olcum.bolge.cekirdek.Ornek
import dev.eren.olcum.bolge.cekirdek.Tur
import dev.eren.olcum.bolge.cekirdek.Yon
import dev.eren.olcum.bolge.cekirdek.yonu
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Bir kolun bildirdiği geçişi işler: günlüğe yazar, bölüme katar, kullanıcıya gerçeği soran bildirimi gösterir. */
object Algilama {
    fun ornek(l: Location, kaynak: String): Ornek {
        val yas = (SystemClock.elapsedRealtimeNanos() - l.elapsedRealtimeNanos) / 1_000_000
        return Ornek(l.latitude, l.longitude, if (l.hasAccuracy()) l.accuracy else null, yas, kaynak)
    }

    /** Sağlayıcıların bildiği en taze konum (yeni konum istemez, pil harcamaz). */
    fun sonKonum(ctx: Context): Ornek? {
        if (!Olgular.kesinKonum(ctx) && !Olgular.yaklasikKonum(ctx)) return null
        val lm = ctx.getSystemService(LocationManager::class.java)
        var en: Location? = null
        var enKaynak = ""
        for ((p, ad) in listOf(LocationManager.FUSED_PROVIDER to "fused", LocationManager.GPS_PROVIDER to "gps", LocationManager.NETWORK_PROVIDER to "ag")) {
            val l = try { lm.getLastKnownLocation(p) } catch (_: Exception) { null } ?: continue
            if (en == null || l.elapsedRealtimeNanos > en.elapsedRealtimeNanos) {
                en = l
                enKaynak = "son:$ad"
            }
        }
        return en?.let { ornek(it, enKaynak) }
    }

    private fun saat(t: Long) = SimpleDateFormat("HH:mm", Locale.ROOT).format(Date(t))

    fun isle(ctx: Context, kol: String, gecis: String, bolgeId: Int, ornek: Ornek?, duvar: Long, gecen: Long, ek: Map<String, String> = emptyMap()) {
        if (!Durum.calisiyor(ctx)) return
        val soguk = Izleme.surecIlkMi()
        val bolge = Bolgeler.bul(ctx, bolgeId)
        val kurSonrasi = if (Durum.kurBoot(ctx, kol) == Gunluk.bootSayisi(ctx)) duvar - Durum.kurZaman(ctx, kol) else null
        val yon = yonu(gecis)
        val bolum = Durum.bolumAl(ctx, bolgeId, yon, duvar, "${Kol.ad(kol)} ${Gecis.ad(gecis)} ${saat(duvar)}")
        val alan = Kayitlar.algiAlanlari(kol, gecis, bolgeId, bolum.id, kurSonrasi, bolge, ornek)
        alan["soguk"] = Kayitlar.b(soguk)
        alan["surecYasi"] = "${gecen - Uygulama.surecBaslangic}"
        alan["bildirim"] = Kayitlar.b(Olgular.bildirimIzni(ctx))
        alan.putAll(ek)
        alan.putAll(Olgular.anDurumu(ctx))
        Gunluk.yaz(ctx, Tur.ALGI, alan, duvar, gecen)
        if (!bolum.etiketli) Bildirim.goster(ctx, bolum.id, bolgeId, bolge, yon, bolum.kollar, bolum.ilk, sessiz = !bolum.yeni)
    }
}

object Bildirim {
    const val KANAL = "bolge"
    const val EYLEM_ETIKET = "dev.eren.olcum.bolge.ETIKET"

    fun kanalKur(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val k = NotificationChannel(KANAL, "Bölge olayları", NotificationManager.IMPORTANCE_HIGH)
        k.description = "Bir bölgeye varış/çıkış algılanınca gerçeği sorar."
        nm.createNotificationChannel(k)
    }

    fun no(bolum: Int) = 10_000 + bolum

    private fun eylem(ctx: Context, bolum: Int, bolge: Int, yon: Yon, cevap: String, dk: Int, sira: Int): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, bolum * 10 + sira,
            Intent(ctx, EtiketAlici::class.java).setAction(EYLEM_ETIKET)
                .putExtra("bolum", bolum).putExtra("bolge", bolge).putExtra("yon", yon.name)
                .putExtra("cevap", cevap).putExtra("dk", dk),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    fun goster(ctx: Context, bolum: Int, bolgeId: Int, bolge: Bolge?, yon: Yon, kollar: String, ilk: Long, sessiz: Boolean) {
        if (!Olgular.bildirimIzni(ctx)) return
        val ad = bolge?.ad ?: "bölge $bolgeId"
        val baslik = if (yon == Yon.GIRIS) "$ad: vardın mı?" else "$ad: çıktın mı?"
        val ayrinti = PendingIntent.getActivity(
            ctx, bolum * 10 + 9,
            Intent(ctx, EtiketEkrani::class.java)
                .putExtra("bolum", bolum).putExtra("bolge", bolgeId).putExtra("yon", yon.name).putExtra("ilk", ilk)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val ikon = Icon.createWithResource(ctx, android.R.drawable.ic_menu_mylocation)
        val b = Notification.Builder(ctx, KANAL)
            .setSmallIcon(android.R.drawable.ic_dialog_map)
            .setContentTitle(baslik)
            .setContentText("Algılayan: $kollar")
            .setStyle(Notification.BigTextStyle().bigText("Algılayan: $kollar\nDokun: ayrıntılı yanıt (kaç dakika önce vardığın vb.)."))
            .setContentIntent(ayrinti)
            .setOnlyAlertOnce(sessiz)
            .setAutoCancel(false)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(
                Notification.Builder(ctx, KANAL).setSmallIcon(android.R.drawable.ic_dialog_map)
                    .setContentTitle("Bölge olayı algılandı").build(),
            )
        if (yon == Yon.GIRIS) {
            b.addAction(Notification.Action.Builder(ikon, "Yeni vardım", eylem(ctx, bolum, bolgeId, yon, Cevap.VARDIM, 0, 1)).build())
            b.addAction(Notification.Action.Builder(ikon, "Yalnız geçiyorum", eylem(ctx, bolum, bolgeId, yon, Cevap.GECTI, 0, 2)).build())
        } else {
            b.addAction(Notification.Action.Builder(ikon, "Yeni çıktım", eylem(ctx, bolum, bolgeId, yon, Cevap.CIKTIM, 0, 1)).build())
            b.addAction(Notification.Action.Builder(ikon, "Çıkmadım", eylem(ctx, bolum, bolgeId, yon, Cevap.CIKMADIM, 0, 2)).build())
        }
        b.addAction(Notification.Action.Builder(ikon, "Başka…", ayrinti).build())
        try {
            ctx.getSystemService(NotificationManager::class.java).notify(no(bolum), b.build())
        } catch (_: SecurityException) {
        }
    }
}

/** Kullanıcının bildirdiği gerçekler: bildirim etiketleri ve elle kayıtlar. */
object Etiketler {
    fun etiketle(ctx: Context, bolum: Int, bolge: Int, yon: String, cevap: String, dk: Int, yol: String) {
        Gunluk.yaz(
            ctx, Tur.ETIKET,
            linkedMapOf("bolum" to "$bolum", "bolge" to "$bolge", "yon" to yon, "cevap" to cevap, "dk" to "$dk", "yol" to yol),
        )
        Durum.bolumEtiketle(ctx, bolum)
        ctx.getSystemService(NotificationManager::class.java).cancel(Bildirim.no(bolum))
    }

    /** gecis: giris | cikis | gecti. Elle kayıt anında bilinen son konumun merkeze uzaklığı da yazılır. */
    fun elle(ctx: Context, bolgeId: Int, gecis: String, dk: Int) {
        val alan = linkedMapOf("bolge" to "$bolgeId", "gecis" to gecis, "dk" to "$dk")
        alan.putAll(Kayitlar.konumAlanlari(Bolgeler.bul(ctx, bolgeId), Algilama.sonKonum(ctx)))
        alan.putAll(Olgular.anDurumu(ctx))
        Gunluk.yaz(ctx, Tur.ELLE, alan)
    }
}
