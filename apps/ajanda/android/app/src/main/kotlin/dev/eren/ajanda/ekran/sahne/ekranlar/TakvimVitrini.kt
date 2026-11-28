package dev.eren.ajanda.ekran.sahne.ekranlar

import dev.eren.ajanda.ekran.Takvim
import dev.eren.ajanda.ekran.TakvimDurumu
import dev.eren.ajanda.ekran.sahne.veri.AyIzgarasi
import dev.eren.ajanda.ekran.sahne.veri.BugunKaydi
import dev.eren.ajanda.ekran.sahne.veri.Gorunus
import dev.eren.ajanda.ekran.sahne.veri.KomsuRenk
import dev.eren.ajanda.ekran.sahne.veri.LevhaHali
import dev.eren.ajanda.ekran.sahne.veri.SeciliGun
import dev.eren.ajanda.ekran.sahne.veri.TakvimNoktasi
import dev.eren.ajanda.ekran.sahne.veri.TakvimSahneDenetleyici
import dev.eren.ajanda.ekran.sahne.veri.TakvimSahneModeli
import java.time.LocalDate

/** Örnek kaydın vitrin kaydı (Takvim ve Tarihsizler vitrinleri). */
internal fun vitrinKaydi(o: OrnekKayit): BugunKaydi {
    val cizim = Gorunus.cizim(simge = null, baslik = o.baslik)
    return BugunKaydi(
        anahtar = o.id, kayitId = o.id, baslik = o.baslik, zaman = o.zaman, renk = Gorunus.renkAnahtardan(cizim), cizim = cizim,
        hal = when {
            o.taslak -> LevhaHali.TASLAK
            o.bitti -> LevhaHali.BITTI
            else -> LevhaHali.ACIK
        },
        aciklama = listOfNotNull(o.baslik, o.zaman).joinToString(", "),
    )
}

/**
 * Çekirdeksiz Takvim: yer tutucu örneklerden ([Ornekler], bugüne göre gün farkıyla) kurulan model. Yalnız depo
 * verilmediğinde (iskelet testleri, önizleme) çizilir.
 */
internal fun takvimVitrini(d: TakvimDurumu, gizle: Boolean): TakvimSahneModeli {
    val bugun = d.bugun
    val ornekler = Ornekler.hepsi.filter { !it.tarihsiz && !(gizle && it.bitti) }
    fun gunun(t: LocalDate) = ornekler.filter { bugun.plusDays(it.gunFarki.toLong()) == t }
    val aylar = listOf(d.ay.minusMonths(1), d.ay, d.ay.plusMonths(1)).associateWith { ay ->
        val bos = AyIzgarasi.bos(ay, bugun)
        bos.copy(
            yuklendi = true,
            hucreler = bos.hucreler.map { h ->
                if (!h.ayda) return@map h
                val l = gunun(h.tarih)
                val noktalar = l.map { o ->
                    TakvimNoktasi(
                        vitrinKaydi(o).renk,
                        when {
                            o.bitti -> Takvim.Nokta.KAPALI
                            o.taslak -> Takvim.Nokta.TASLAK
                            else -> Takvim.Nokta.ACIK
                        },
                    )
                }
                val fazla = noktalar.size > Takvim.ENCOK_NOKTA
                val okunus = dev.eren.ajanda.ekran.EkranMetinleri.uzunTarih(h.tarih, bugun) +
                    (if (h.tarih == bugun) ", bugün" else "") + ". " + if (l.isEmpty()) "Kayıt yok." else "${l.size} kayıt."
                h.copy(noktalar = if (fazla) noktalar.take(Takvim.ENCOK_NOKTA - 1) else noktalar, fazla = fazla, okunus = okunus)
            },
        )
    }
    val l = gunun(d.secili).sortedBy { it.bitti }.map(::vitrinKaydi)
    return TakvimSahneModeli(
        durum = d,
        aylar = aylar,
        gun = SeciliGun(d.secili, TakvimSahneDenetleyici.gunBasligi(d.secili, bugun), KomsuRenk.ayir(l)),
        bitenleriGizle = gizle,
        yuklendi = true,
    )
}
