package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.security.MessageDigest

class PlanHashTest {
    private val depo: File = File(System.getProperty("eren.depo")).canonicalFile

    private class Vektor(val ad: String, val plan: JsonDeger, val kanonik: String, val hash: String)

    private fun vektorler(): List<Vektor> {
        val dosya = File(depo, "protocol/vektorler/plan-hash.json")
        val kok = (Json.coz(dosya.readText(Charsets.UTF_8)) as JsonSonucu.Tamam).deger as JsonDeger.Nesne
        val dizi = kok.alanlar.getValue("vektorler") as JsonDeger.Dizi
        return dizi.ogeler.map {
            val n = (it as JsonDeger.Nesne).alanlar
            Vektor(
                (n.getValue("ad") as JsonDeger.Metin).deger,
                n.getValue("plan"),
                (n.getValue("kanonik") as JsonDeger.Metin).deger,
                (n.getValue("plan_hash") as JsonDeger.Metin).deger,
            )
        }
    }

    private fun sha(metin: String): String =
        MessageDigest.getInstance("SHA-256").digest(metin.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    @Test
    fun `her vektorde kanonik metin ve hash bire bir`() {
        val v = vektorler()
        assertTrue(v.size >= 4, "vektör sayısı: ${v.size}")
        for (x in v) {
            val s = Kanonik.kanonik(x.plan)
            assertTrue(s is KanonikSonucu.Tamam, "${x.ad}: $s")
            assertEquals(x.kanonik, (s as KanonikSonucu.Tamam).metin, "${x.ad} kanonik")
            assertEquals(x.hash, PlanHash.planHash(x.plan), "${x.ad} plan_hash")
            // Vektörün kendi tutarlılığı: JDK ile bağımsız özet.
            assertEquals(x.hash, sha(x.kanonik), "${x.ad} vektör iç tutarlılığı")
            assertEquals(64, x.hash.length)
            assertTrue(x.hash.all { it in "0123456789abcdef" })
        }
    }

    @Test
    fun `vektor kanonik metni yeniden cozulup kanoniklesince ayni kalir`() {
        for (x in vektorler()) {
            val geri = (Json.coz(x.kanonik) as JsonSonucu.Tamam).deger
            assertEquals(x.kanonik, (Kanonik.kanonik(geri) as KanonikSonucu.Tamam).metin, x.ad)
            assertEquals(x.hash, PlanHash.planHash(geri), x.ad)
        }
    }

    @Test
    fun `anahtar sirasi hash degistirmez`() {
        for (x in vektorler()) {
            val n = x.plan as JsonDeger.Nesne
            val ters = JsonDeger.Nesne(
                LinkedHashMap<String, JsonDeger>().also { m ->
                    n.alanlar.entries.reversed().forEach { m[it.key] = it.value }
                },
            )
            assertEquals(x.hash, PlanHash.planHash(ters), x.ad)
        }
    }

    @Test
    fun `birlesik ve ayrisik unicode farkli hash verir`() {
        val v = vektorler()
        val ayri = v.first { it.ad == "ayrisik-unicode" }
        val birlesik = v.first { it.ad == "birlesik-unicode" }
        assertNotEquals(ayri.hash, birlesik.hash)
    }

    @Test
    fun `plan metninde tek bayt farki hash i degistirir`() {
        val x = vektorler().first { it.ad == "pc-turkce" }
        val plan = x.plan as JsonDeger.Nesne
        val gorev = (plan.alanlar.getValue("gorev_metni") as JsonDeger.Metin).deger
        fun hash(alan: String, deger: JsonDeger) = PlanHash.planHash(JsonDeger.Nesne(plan.alanlar + (alan to deger)))
        val hepsi = mutableSetOf(x.hash)
        for (i in gorev.indices step 3) {
            val c = gorev[i]
            if (c.isSurrogate()) continue
            val degisik = gorev.substring(0, i) + (if (c == 'x') 'y' else 'x') + gorev.substring(i + 1)
            val h = hash("gorev_metni", JsonDeger.Metin(degisik))
            assertNotNull(h)
            assertTrue(hepsi.add(h!!), "çakışma konum $i")
        }
        for (ek in listOf(gorev + " ", gorev + "\n", " $gorev", gorev.dropLast(2), gorev.uppercase())) {
            assertTrue(hepsi.add(hash("gorev_metni", JsonDeger.Metin(ek))!!), "çakışma: ${ek.takeLast(5)}")
        }
        val dizi = plan.alanlar.getValue("kirli_kaynak") as JsonDeger.Dizi
        assertTrue(dizi.ogeler.size >= 2, "kirli_kaynak sırası sınanamıyor")
        assertTrue(hepsi.add(hash("kirli_kaynak", JsonDeger.Dizi(dizi.ogeler.reversed()))!!))
        assertTrue(hepsi.add(hash("yeni", JsonDeger.Bos)!!))
    }

    @Test
    fun `kanonikleseyen plan icin null doner`() {
        val taban = (vektorler().first().plan as JsonDeger.Nesne).alanlar
        fun hash(alan: String, deger: JsonDeger) = PlanHash.planHash(JsonDeger.Nesne(taban + (alan to deger)))
        assertNull(hash("kirli_kaynak", JsonDeger.Dizi(listOf(JsonDeger.Ondalik(1.5)))))
        assertNull(hash("__proto__", JsonDeger.Bos))
        assertNull(hash("baslik", JsonDeger.Metin("a\uD800")))
        assertNull(hash("n", JsonDeger.Tam(9007199254740992L)))
        var d: JsonDeger = JsonDeger.Tam(1)
        repeat(40) { d = JsonDeger.Dizi(listOf(d)) }
        assertNull(hash("ic", d))
    }
}
