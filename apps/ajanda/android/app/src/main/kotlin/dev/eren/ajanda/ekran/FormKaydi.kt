package dev.eren.ajanda.ekran

import android.os.Bundle
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.DuzenlemeTemeli
import dev.eren.ajanda.cekirdek.HaftaGunu
import dev.eren.ajanda.cekirdek.Hatirlatma
import dev.eren.ajanda.cekirdek.KayitGovdesi
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.Tekrar
import dev.eren.ajanda.cekirdek.TekrarSikligi
import java.time.LocalDate
import java.time.LocalTime

/**
 * Kayıt ekranının kaydedilmemiş hali: döndürme, tema değişimi ve süreç ölümünden sonra geri gelir
 * (`onSaveInstanceState`). Formun bütün alanları, düzenlemede formun açıldığı hal ([temel]: yalnız
 * kullanıcının değiştirdiği alanlar gitsin diye) ve dilim uyarısının durumu.
 */
data class FormDurumu(
    val form: KayitFormu,
    val temel: DuzenlemeTemeli?,
    val dilimTanindi: Boolean,
)

/**
 * [FormDurumu] <-> düz anahtar/değer (saf; Android'siz sınanır). Bundle'a iki dizi olarak yazılır
 * ([bundleYaz], [bundleOku]). Çözülemeyen kayıt `null` döner: ekran formu baştan yükler.
 */
object FormKaydi {
    private const val ANAHTARLAR = "form_anahtarlar"
    private const val DEGERLER = "form_degerler"

    fun yaz(d: FormDurumu): Map<String, String> {
        val m = LinkedHashMap<String, String>()
        fun koy(k: String, v: Any?) {
            if (v != null) m[k] = v.toString()
        }
        val f = d.form
        koy("tur", f.tur.name)
        koy("baslik", f.baslik)
        koy("aciklama", f.aciklama)
        koy("tarih", f.tarih)
        koy("saat", f.saat?.let(EkranMetinleri::saat))
        koy("dilim", f.dilim)
        koy("zamanDegisti", if (f.zamanDegisti) "1" else "0")
        koy("dilimTanindi", if (d.dilimTanindi) "1" else "0")
        hatirlatmalariYaz(m, "h", f.hatirlatmalar)
        zamaniYaz(m, "oz", f.ozgunZaman)
        tekrariYaz(m, "tk", f.tekrar)
        d.temel?.let { t ->
            koy("t.rev", t.revizyon)
            koy("t.tur", t.govde.tur.name)
            koy("t.baslik", t.govde.baslik)
            koy("t.aciklama", t.govde.aciklama)
            zamaniYaz(m, "t.z", t.govde.zaman)
            hatirlatmalariYaz(m, "t.h", t.govde.hatirlatmalar)
            tekrariYaz(m, "t.tk", t.govde.tekrar)
        }
        return m
    }

    fun oku(m: Map<String, String>): FormDurumu? = try {
        val form = KayitFormu(
            tur = KayitTuru.valueOf(m.getValue("tur")),
            baslik = m["baslik"] ?: "",
            aciklama = m["aciklama"] ?: "",
            tarih = m["tarih"]?.let(LocalDate::parse),
            saat = m["saat"]?.let(LocalTime::parse),
            hatirlatmalar = hatirlatmalariOku(m, "h"),
            dilim = m["dilim"] ?: "",
            ozgunZaman = zamaniOku(m, "oz"),
            zamanDegisti = m["zamanDegisti"] == "1",
            tekrar = tekrariOku(m, "tk"),
        )
        val temel = m["t.rev"]?.let { rev ->
            DuzenlemeTemeli(
                rev.toLong(),
                KayitGovdesi(
                    KayitTuru.valueOf(m.getValue("t.tur")),
                    m.getValue("t.baslik"),
                    m["t.aciklama"],
                    zamaniOku(m, "t.z"),
                    hatirlatmalariOku(m, "t.h"),
                    tekrariOku(m, "t.tk"),
                ),
            )
        }
        FormDurumu(form, temel, m["dilimTanindi"] != "0")
    } catch (_: Exception) {
        null
    }

    fun bundleYaz(b: Bundle, d: FormDurumu) {
        val m = yaz(d)
        b.putStringArray(ANAHTARLAR, m.keys.toTypedArray())
        b.putStringArray(DEGERLER, m.values.toTypedArray())
    }

    fun bundleOku(b: Bundle?): FormDurumu? {
        val k = b?.getStringArray(ANAHTARLAR) ?: return null
        val v = b.getStringArray(DEGERLER) ?: return null
        if (k.size != v.size) return null
        return oku(k.zip(v).toMap())
    }

    private fun hatirlatmalariYaz(m: MutableMap<String, String>, p: String, l: List<Hatirlatma>) {
        m["$p.n"] = l.size.toString()
        l.forEachIndexed { i, h ->
            when (h) {
                is Hatirlatma.Once -> {
                    m["$p.$i.tur"] = "once"
                    m["$p.$i.dk"] = h.dk.toString()
                }
                is Hatirlatma.Mutlak -> {
                    m["$p.$i.tur"] = "mutlak"
                    m["$p.$i.tarih"] = h.tarih
                    m["$p.$i.saat"] = h.saat
                    m["$p.$i.dilim"] = h.saatDilimi
                }
            }
        }
    }

    private fun hatirlatmalariOku(m: Map<String, String>, p: String): List<Hatirlatma> =
        (0 until (m["$p.n"]?.toInt() ?: 0)).map { i ->
            when (val tur = m.getValue("$p.$i.tur")) {
                "once" -> Hatirlatma.Once(m.getValue("$p.$i.dk").toInt())
                "mutlak" -> Hatirlatma.Mutlak(m.getValue("$p.$i.tarih"), m.getValue("$p.$i.saat"), m.getValue("$p.$i.dilim"))
                else -> throw IllegalArgumentException("hatırlatma türü: $tur")
            }
        }

    private fun zamaniYaz(m: MutableMap<String, String>, p: String, z: AjandaZamani?) {
        fun koy(k: String, v: Any?) {
            if (v != null) m["$p.$k"] = v.toString()
        }
        when (z) {
            null -> {}
            is AjandaZamani.An -> {
                koy("k", "an"); koy("tarih", z.tarih); koy("saat", z.saat); koy("sure", z.sureDk)
                koy("dilim", z.saatDilimi); koy("ifade", z.ifade)
            }
            is AjandaZamani.Gun -> {
                koy("k", "gun"); koy("tarih", z.tarih); koy("dilim", z.saatDilimi); koy("ifade", z.ifade)
            }
            is AjandaZamani.Donem -> {
                koy("k", "donem"); koy("bas", z.baslangic); koy("bit", z.bitis); koy("dilim", z.saatDilimi)
                koy("ifade", z.ifade)
            }
            is AjandaZamani.Belirsiz -> {
                koy("k", "belirsiz"); koy("ifade", z.ifade)
            }
        }
    }

    private fun zamaniOku(m: Map<String, String>, p: String): AjandaZamani? {
        fun al(k: String) = m.getValue("$p.$k")
        return when (val k = m["$p.k"]) {
            null -> null
            "an" -> AjandaZamani.An(al("tarih"), al("saat"), m["$p.sure"]?.toInt(), al("dilim"), m["$p.ifade"])
            "gun" -> AjandaZamani.Gun(al("tarih"), al("dilim"), m["$p.ifade"])
            "donem" -> AjandaZamani.Donem(al("bas"), al("bit"), al("dilim"), m["$p.ifade"])
            "belirsiz" -> AjandaZamani.Belirsiz(al("ifade"))
            else -> throw IllegalArgumentException("zaman kesinliği: $k")
        }
    }

    private fun tekrariYaz(m: MutableMap<String, String>, p: String, t: Tekrar?) {
        if (t == null) return
        m["$p.siklik"] = t.siklik.name
        m["$p.aralik"] = t.aralik.toString()
        t.gunler?.let { g -> m["$p.gunler"] = g.joinToString(",") { it.name } }
        t.bitisTarihi?.let { m["$p.bitis"] = it }
        t.adet?.let { m["$p.adet"] = it.toString() }
    }

    private fun tekrariOku(m: Map<String, String>, p: String): Tekrar? {
        val siklik = m["$p.siklik"] ?: return null
        return Tekrar(
            TekrarSikligi.valueOf(siklik),
            m.getValue("$p.aralik").toInt(),
            m["$p.gunler"]?.let { g -> if (g.isEmpty()) emptyList() else g.split(",").map(HaftaGunu::valueOf) },
            m["$p.bitis"],
            m["$p.adet"]?.toInt(),
        )
    }
}
