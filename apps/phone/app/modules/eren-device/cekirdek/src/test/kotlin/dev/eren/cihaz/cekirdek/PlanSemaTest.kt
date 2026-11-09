package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * `Sema.planCoz`: katı şema. `SOHBET_SURUMU` 5'te kalkan `kesin_yapilacaklar` ve
 * `kesin_yapilmayacaklar` anahtarlarını taşıyan plan bilinmeyen anahtar sayılır ve reddedilir.
 */
class PlanSemaTest {
    private val depo: File = File(System.getProperty("eren.depo")).canonicalFile

    private fun vektorPlanlari(): Map<String, JsonDeger.Nesne> {
        val dosya = File(depo, "protocol/vektorler/plan-hash.json")
        val kok = (Json.coz(dosya.readText(Charsets.UTF_8)) as JsonSonucu.Tamam).deger as JsonDeger.Nesne
        val dizi = kok.alanlar.getValue("vektorler") as JsonDeger.Dizi
        return dizi.ogeler.associate {
            val n = (it as JsonDeger.Nesne).alanlar
            (n.getValue("ad") as JsonDeger.Metin).deger to (n.getValue("plan") as JsonDeger.Nesne)
        }
    }

    private fun metin(d: JsonDeger): String = (Kanonik.kanonik(d) as KanonikSonucu.Tamam).metin

    private fun ekle(plan: JsonDeger.Nesne, anahtar: String, deger: JsonDeger) =
        JsonDeger.Nesne(plan.alanlar + (anahtar to deger))

    @Test
    fun `pc ve telefon vektor planlari cozulur ve hash vektorle ayni`() {
        val planlar = vektorPlanlari()
        for (ad in listOf("pc-turkce", "telefon-yaz")) {
            val ham = planlar.getValue(ad)
            val p = Sema.planCoz(metin(ham))
            assertNotNull(p, ad)
            assertEquals(PlanHash.planHash(ham), PlanHash.planHash(p!!.ham), ad)
        }
    }

    @Test
    fun `kaldirilan liste alanlarini tasiyan plan reddedilir`() {
        val planlar = vektorPlanlari()
        val dolu = JsonDeger.Dizi(listOf(JsonDeger.Metin("Testleri çalıştır")))
        val bos = JsonDeger.Dizi(emptyList())
        for (ad in listOf("pc-turkce", "telefon-yaz")) {
            val ham = planlar.getValue(ad)
            assertNotNull(Sema.planCoz(metin(ham)), ad)
            for (anahtar in listOf("kesin_yapilacaklar", "kesin_yapilmayacaklar")) {
                for (deger in listOf(dolu, bos)) {
                    assertNull(Sema.planCoz(metin(ekle(ham, anahtar, deger))), "$ad + $anahtar")
                }
            }
            val ikisi = ekle(ekle(ham, "kesin_yapilacaklar", dolu), "kesin_yapilmayacaklar", bos)
            assertNull(Sema.planCoz(metin(ikisi)), "$ad + ikisi")
        }
    }

    @Test
    fun `vektor planlarinda kaldirilan alan yok`() {
        for ((ad, p) in vektorPlanlari()) {
            assertTrue(p.alanlar.keys.none { it.startsWith("kesin_") }, ad)
        }
    }
}
