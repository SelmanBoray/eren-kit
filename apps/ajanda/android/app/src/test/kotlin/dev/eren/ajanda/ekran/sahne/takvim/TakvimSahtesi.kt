package dev.eren.ajanda.ekran.sahne.takvim

import dev.eren.ajanda.cekirdek.AjandaOrnegi
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitGorunumu
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.OrnekDurumu
import dev.eren.ajanda.cekirdek.TakvimAyi
import dev.eren.ajanda.cekirdek.TakvimGunOzeti
import dev.eren.ajanda.cekirdek.TakvimOgesi
import dev.eren.ajanda.cekirdek.TakvimSeridi
import dev.eren.ajanda.cekirdek.Tekrar
import dev.eren.ajanda.cekirdek.TekrarSikligi
import dev.eren.ajanda.ekran.CekirdekYuzu
import dev.eren.ajanda.ekran.gor
import dev.eren.ajanda.ekran.sahne.bugun.BugunCekirdegi
import dev.eren.ajanda.ekran.sahne.bugun.Hemen
import dev.eren.ajanda.ekran.sahne.bugun.SIMDI
import dev.eren.ajanda.ekran.sahne.veri.BugunDeposu
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZonedDateTime

/** Günlük tekrar (örnekleri sahte açar; kuralı yok sayılır). */
val GUNLUK = Tekrar(TekrarSikligi.GUNLUK, 1, null, null, null)

/**
 * Takvim sorgularını kayıtlardan kuran sahte çekirdek ([BugunCekirdegi] üstüne):
 * - `takvimGunu`: tekrarsız kayıtlar günü kapsıyorsa (dönem her gününde), tekrarlı kayıtlar yalnız [ornekGunleri]'nde
 *   örnek olarak (örnek tarihi ve örneğin kendi durumuyla; kapalı örnek yalnız `kapalilarDahil` iken).
 * - `takvimAyi`: ayın her günü için özet (`takvimGunu`'nden sayılır) ve çok günlü öğelerin şeritleri.
 * - `durumDegistir(…, ornekTarihi)`: örneğin durumu tutulur; `kayit` örnek satırlarını gerçek çekirdek gibi verir.
 * - [ayHatasi], [gunHatasi]: doluysa o sorgu atar.
 */
class TakvimCekirdegi(val ic: BugunCekirdegi = BugunCekirdegi()) : CekirdekYuzu by ic {
    val sahte get() = ic.sahte
    val cagrilar get() = ic.cagrilar

    /** Tekrarlı kayıt -> örneklerinin günleri. */
    val ornekGunleri = mutableMapOf<String, List<String>>()

    /** Tekrarlı kayıt -> örnek tarihi -> durum (yoksa açık). */
    val ornekDurumlari = mutableMapOf<String, MutableMap<String, KayitDurumu>>()

    var ayHatasi: Exception? = null
    var gunHatasi: Exception? = null

    fun ekle(vararg k: dev.eren.ajanda.cekirdek.AjandaKaydi) = ic.ekle(*k)

    override fun takvimGunu(tarih: String, kapalilarDahil: Boolean): List<TakvimOgesi> {
        gunHatasi?.let { throw it }
        val tek = ic.takvimGunu(tarih, kapalilarDahil).filter { it.gorunum.kayit.tekrar == null }
        val ornek = ornekGunleri.mapNotNull { (id, gunler) ->
            if (tarih !in gunler) return@mapNotNull null
            val k = sahte.kayitlar[id] ?: return@mapNotNull null
            if (k.silindi) return@mapNotNull null
            val d = if (k.durum != KayitDurumu.ACIK) k.durum else ornekDurumlari[id]?.get(tarih) ?: KayitDurumu.ACIK
            if (!kapalilarDahil && d != KayitDurumu.ACIK) return@mapNotNull null
            TakvimOgesi(
                gorunum = gor(ornekli(k)), ornekTarihi = tarih, durum = d, ilkGun = tarih, sonGun = tarih,
                saat = (k.zaman as? AjandaZamani.An)?.saat, bitisSaati = null,
            )
        }
        return tek + ornek
    }

    override fun takvimAyi(yil: Int, ay: Int, kapalilarDahil: Boolean): TakvimAyi {
        val ym = YearMonth.of(yil, ay)
        sahte.cagrilar += "takvimAyi:$ym"
        ayHatasi?.let { throw it }
        val seritler = linkedMapOf<String, TakvimSeridi>()
        val gunler = (1..ym.lengthOfMonth()).map { d ->
            val t = ym.atDay(d).toString()
            val l = takvimGunu(t, kapalilarDahil)
            for (o in l) if (o.ilkGun != o.sonGun) {
                val k = o.gorunum.kayit
                seritler.getOrPut(k.kayitId) { TakvimSeridi(k.kayitId, o.ornekTarihi, k.baslik, k.tur, o.durum, k.taslak, o.ilkGun, o.sonGun) }
            }
            TakvimGunOzeti(
                tarih = t,
                toplam = l.size,
                acik = l.count { it.durum == KayitDurumu.ACIK },
                kapali = l.count { it.durum != KayitDurumu.ACIK },
                taslak = l.count { it.gorunum.kayit.taslak },
                gorev = l.count { it.gorunum.kayit.tur == KayitTuru.GOREV },
                randevu = l.count { it.gorunum.kayit.tur == KayitTuru.RANDEVU },
                notlar = l.count { it.gorunum.kayit.tur == KayitTuru.NOT },
                serit = l.count { it.ilkGun != it.sonGun },
            )
        }
        return TakvimAyi(yil, ay, gunler, seritler.values.sortedWith(compareBy({ it.ilkGun }, { it.ilkGun.compareTo(it.sonGun) })))
    }

    override fun durumDegistir(kayitId: String, durum: KayitDurumu, ornekTarihi: String?) {
        if (ornekTarihi != null) ornekDurumlari.getOrPut(kayitId) { mutableMapOf() }[ornekTarihi] = durum
        ic.durumDegistir(kayitId, durum, ornekTarihi)
    }

    override fun kayit(kayitId: String): KayitGorunumu? = ic.kayit(kayitId)?.let { it.copy(kayit = ornekli(it.kayit)) }

    private fun ornekli(k: dev.eren.ajanda.cekirdek.AjandaKaydi) = k.copy(
        ornekler = ornekDurumlari[k.kayitId].orEmpty().mapNotNull { (t, d) ->
            when (d) {
                KayitDurumu.TAMAM -> AjandaOrnegi(t, OrnekDurumu.TAMAM)
                KayitDurumu.IPTAL -> AjandaOrnegi(t, OrnekDurumu.IPTAL)
                KayitDurumu.ACIK -> null
            }
        }.sortedBy { it.tarih },
    )
}

/** Sahte takvim çekirdeğiyle, hemen çalışan Bugün deposu (kardeşleri: takvim, tarihsiz); gözlemci bağlı. */
fun takvimDeposu(c: TakvimCekirdegi, saat: () -> ZonedDateTime = { SIMDI }): BugunDeposu = BugunDeposu(
    yuz = { c },
    saat = saat,
    calistirici = Hemen,
    anaya = { it() },
    baglan = { g -> c.ic.gozlemci = g; { c.ic.gozlemci = null } },
)

fun LocalDate.metin() = toString()
