package dev.eren.ajanda.ekran.sahne.ekranlar

import dev.eren.ajanda.ekran.sahne.veri.BugunKaydi
import dev.eren.ajanda.ekran.sahne.veri.BugunModeli
import dev.eren.ajanda.ekran.sahne.veri.DurumOzeti
import dev.eren.ajanda.ekran.sahne.veri.Gorunus
import dev.eren.ajanda.ekran.sahne.veri.GunGrubu
import dev.eren.ajanda.ekran.sahne.veri.LevhaHali
import dev.eren.ajanda.ekran.sahne.veri.komsuRenkleriAyir
import java.time.LocalDate

/**
 * Çekirdeksiz Bugün: yer tutucu örneklerden ([Ornekler]) kurulan sabit model. Yalnız depo verilmediğinde
 * (iskelet testleri, önizleme) çizilir; gerçek uygulama her zaman çekirdekten okur.
 */
internal fun vitrinModeli(bugun: LocalDate): BugunModeli {
    fun BugunKaydi(o: OrnekKayit, hal: LevhaHali): BugunKaydi {
        val cizim = Gorunus.cizim(simge = null, baslik = o.baslik)
        return BugunKaydi(
            anahtar = o.id, kayitId = o.id, baslik = o.baslik, zaman = o.zaman, renk = Gorunus.renkAnahtardan(cizim), cizim = cizim, hal = hal,
            aciklama = listOfNotNull(o.baslik, o.zaman).joinToString(", "),
        )
    }
    val gunun = Ornekler.bugun
    val acikler = gunun.filter { !it.taslak && !it.bitti }.map { BugunKaydi(it, LevhaHali.ACIK) }
    val sira = acikler.firstOrNull()
    val yaklasan = Ornekler.hepsi.filter { !it.tarihsiz && it.gunFarki > 0 }.groupBy { it.gunFarki }.toSortedMap().map { (fark, l) ->
        val t = bugun.plusDays(fark.toLong())
        GunGrubu(t.toString(), Gorunus.gunBasligi(t, bugun), l.map { BugunKaydi(it, LevhaHali.ACIK) })
    }
    return BugunModeli(
        yuklendi = true,
        bugun = bugun,
        tarih = Gorunus.uzunTarih(bugun),
        cumle = sira?.let { "Sırada ${Gorunus.kucuk(it.baslik)} var." } ?: "Bugünlük bu kadar.",
        alt = sira?.let { "Bugün, ${it.zaman}" } ?: "",
        kalanlar = emptyList(),
        taslaklar = gunun.filter { it.taslak }.map { BugunKaydi(it, LevhaHali.TASLAK) },
        acikler = acikler,
        siradaki = sira?.anahtar,
        bitenler = gunun.filter { it.bitti }.map { BugunKaydi(it, LevhaHali.BITTI) },
        bitenleriGizle = false,
        yaklasanlar = yaklasan,
        durum = DurumOzeti.Okunuyor,
    ).komsuRenkleriAyir()
}
