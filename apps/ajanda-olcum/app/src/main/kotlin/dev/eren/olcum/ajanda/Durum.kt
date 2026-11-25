package dev.eren.olcum.ajanda

import android.content.Context
import android.content.SharedPreferences
import dev.eren.olcum.ajanda.cekirdek.Plan
import dev.eren.olcum.ajanda.cekirdek.SeriPlani

/** Ölçümün kalıcı durumu (SharedPreferences). */
object Durum {
    private fun sp(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences("durum", Context.MODE_PRIVATE)

    fun calisiyor(ctx: Context) = sp(ctx).getBoolean("calisiyor", false)

    fun plan(ctx: Context): Plan? {
        val p = sp(ctx)
        if (!p.contains("bas")) return null
        val seriler = (p.getString("seriler", "") ?: "").split(',').mapNotNull {
            val q = it.split(':')
            if (q.size != 3) null else SeriPlani(q[0], q[1].toLong(), q[2].toLong())
        }
        return Plan(p.getLong("bas", 0), p.getLong("son", 0), seriler)
    }

    fun baslat(ctx: Context, plan: Plan) {
        val e = sp(ctx).edit()
        e.putBoolean("calisiyor", true)
        e.putLong("bas", plan.bas)
        e.putLong("son", plan.son)
        e.putString("seriler", plan.alanlar()["seriler"])
        for (s in plan.seriler) e.putInt("kurulan_${s.kod}", -1)
        e.putString("son_olgu", "")
        e.commit()
    }

    fun durdur(ctx: Context) = sp(ctx).edit().putBoolean("calisiyor", false).commit()

    fun kurulanSon(ctx: Context, seri: String) = sp(ctx).getInt("kurulan_$seri", -1)
    fun kurulanSonYaz(ctx: Context, seri: String, k: Int) = sp(ctx).edit().putInt("kurulan_$seri", k).commit()

    /** Aynı açılışta duvar saati ile geçen süre arasındaki fark; saat sıçramasını ölçmek için. */
    fun saatCapasi(ctx: Context, boot: Int, ofset: Long) {
        sp(ctx).edit().putInt("capa_boot", boot).putLong("capa_ofset", ofset).apply()
    }

    /** Önceki çapaya göre sıçrama; farklı açılıştaysa null. */
    fun sicrama(ctx: Context, boot: Int, ofset: Long): Long? {
        val p = sp(ctx)
        if (!p.contains("capa_ofset") || p.getInt("capa_boot", Int.MIN_VALUE) != boot) return null
        return ofset - p.getLong("capa_ofset", ofset)
    }

    fun sonCikis(ctx: Context) = sp(ctx).getLong("son_cikis", 0L)
    fun sonCikisYaz(ctx: Context, t: Long) = sp(ctx).edit().putLong("son_cikis", t).apply()

    fun sonOlgu(ctx: Context) = sp(ctx).getString("son_olgu", "") ?: ""
    fun sonOlguYaz(ctx: Context, s: String) = sp(ctx).edit().putString("son_olgu", s).apply()
}
