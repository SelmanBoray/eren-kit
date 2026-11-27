package dev.eren.olcum.bolge

import android.content.Context
import android.content.SharedPreferences
import dev.eren.olcum.bolge.cekirdek.Sabit
import dev.eren.olcum.bolge.cekirdek.Yon
import java.security.SecureRandom

/** Ölçümün kalıcı durumu (özel SharedPreferences). Koordinat burada da tutulmaz (bölgeler ayrı dosyada). */
object Durum {
    private fun sp(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences("durum", Context.MODE_PRIVATE)

    fun calisiyor(ctx: Context) = sp(ctx).getBoolean("calisiyor", false)

    fun baslat(ctx: Context) = sp(ctx).edit().putBoolean("calisiyor", true).putLong("bas", System.currentTimeMillis()).commit()

    fun durdur(ctx: Context) = sp(ctx).edit().putBoolean("calisiyor", false).commit()

    // ------------------------------------------------------------ kolların kurulum durumu

    fun kurYaz(ctx: Context, kol: String, sonuc: String, boot: Int, zaman: Long, neden: String) {
        sp(ctx).edit()
            .putString("kur_${kol}_sonuc", sonuc)
            .putInt("kur_${kol}_boot", boot)
            .putLong("kur_${kol}_zaman", zaman)
            .putString("kur_${kol}_neden", neden)
            .commit()
    }

    fun kurSonuc(ctx: Context, kol: String) = sp(ctx).getString("kur_${kol}_sonuc", "yok") ?: "yok"
    fun kurBoot(ctx: Context, kol: String) = sp(ctx).getInt("kur_${kol}_boot", Int.MIN_VALUE)
    fun kurZaman(ctx: Context, kol: String) = sp(ctx).getLong("kur_${kol}_zaman", 0L)
    fun kurNeden(ctx: Context, kol: String) = sp(ctx).getString("kur_${kol}_neden", "") ?: ""

    /** Kolu "düşürüldü" olarak işaretler (ör. Play Hizmetleri 1000 hatası); sonraki denetim yeniden kurar. */
    fun kurDusur(ctx: Context, kol: String, sonuc: String) = sp(ctx).edit().putString("kur_${kol}_sonuc", sonuc).commit()

    fun kurSifirla(ctx: Context, kollar: List<String>) {
        val e = sp(ctx).edit()
        for (k in kollar) {
            e.remove("kur_${k}_sonuc"); e.remove("kur_${k}_boot"); e.remove("kur_${k}_zaman"); e.remove("kur_${k}_neden")
        }
        e.commit()
    }

    // ------------------------------------------------------------ çeşitli

    fun konumEtkin(ctx: Context): Boolean? =
        if (sp(ctx).contains("konum_etkin")) sp(ctx).getBoolean("konum_etkin", true) else null

    fun konumEtkinYaz(ctx: Context, v: Boolean) = sp(ctx).edit().putBoolean("konum_etkin", v).commit()

    fun sonCikis(ctx: Context) = sp(ctx).getLong("son_cikis", 0L)
    fun sonCikisYaz(ctx: Context, t: Long) = sp(ctx).edit().putLong("son_cikis", t).apply()

    fun sonOlgu(ctx: Context) = sp(ctx).getString("son_olgu", "") ?: ""
    fun sonOlguYaz(ctx: Context, s: String) = sp(ctx).edit().putString("son_olgu", s).apply()

    fun donem(ctx: Context) = sp(ctx).getInt("donem", 1)
    fun donemYaz(ctx: Context, no: Int) = sp(ctx).edit().putInt("donem", no).commit()

    fun beyan(ctx: Context, ad: String) = sp(ctx).getBoolean("beyan_$ad", false)
    fun beyanYaz(ctx: Context, ad: String, v: Boolean) = sp(ctx).edit().putBoolean("beyan_$ad", v).commit()

    @Synchronized
    fun yeniBolgeId(ctx: Context): Int {
        val n = sp(ctx).getInt("son_bolge_id", 0) + 1
        sp(ctx).edit().putInt("son_bolge_id", n).commit()
        return n
    }

    /** Wi-Fi ağ adının özetinde kullanılan cihaza özel rastgele tuz. Dışa verilmez. */
    @Synchronized
    fun tuz(ctx: Context): String {
        sp(ctx).getString("tuz", null)?.let { return it }
        val b = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val s = b.joinToString("") { "%02x".format(it) }
        sp(ctx).edit().putString("tuz", s).commit()
        return s
    }

    /** Son Wi-Fi bağlantısı (ağ tutamacı, zaman); aynı bağlantının tekrar yayınlarını ayırmak için. */
    fun wifiSon(ctx: Context): Pair<Long, Long> =
        sp(ctx).getLong("wifi_tutamac", -1L) to sp(ctx).getLong("wifi_zaman", 0L)

    fun wifiSonYaz(ctx: Context, tutamac: Long, zaman: Long) =
        sp(ctx).edit().putLong("wifi_tutamac", tutamac).putLong("wifi_zaman", zaman).commit()

    // ------------------------------------------------------------ bölümler (bildirim grupları)

    data class BolumKaydi(val id: Int, val ilk: Long, val etiketli: Boolean, val yeni: Boolean, val kollar: String)

    /**
     * Aynı bölge ve yöndeki algılar [Sabit.BOLUM] içinde tek bölümde (tek bildirimde) toplanır.
     * kolEtiketi ("gms/giris@14:02") bölümün kol listesine eklenir.
     */
    @Synchronized
    fun bolumAl(ctx: Context, bolge: Int, yon: Yon, zaman: Long, kolEtiketi: String): BolumKaydi {
        val p = sp(ctx)
        val anahtar = "bolum_${bolge}_${yon.name}"
        val q = (p.getString(anahtar, "") ?: "").split(';')
        if (q.size >= 3) {
            val id = q[0].toIntOrNull()
            val ilk = q[1].toLongOrNull()
            if (id != null && ilk != null && zaman - ilk in 0..Sabit.BOLUM) {
                val kollar = (p.getString("bolumKol_$id", "") ?: "").let { if (it.isEmpty()) kolEtiketi else "$it, $kolEtiketi" }
                p.edit().putString("bolumKol_$id", kollar).commit()
                return BolumKaydi(id, ilk, q[2] == "1", false, kollar)
            }
        }
        val id = p.getInt("son_bolum", 0) + 1
        p.edit()
            .putInt("son_bolum", id)
            .putString(anahtar, "$id;$zaman;0")
            .putString("bolumKol_$id", kolEtiketi)
            .commit()
        return BolumKaydi(id, zaman, false, true, kolEtiketi)
    }

    @Synchronized
    fun bolumEtiketle(ctx: Context, bolum: Int) {
        val p = sp(ctx)
        for ((k, v) in p.all) {
            if (!k.startsWith("bolum_") || v !is String) continue
            val q = v.split(';')
            if (q.size >= 3 && q[0] == "$bolum") p.edit().putString(k, "${q[0]};${q[1]};1").commit()
        }
    }
}
