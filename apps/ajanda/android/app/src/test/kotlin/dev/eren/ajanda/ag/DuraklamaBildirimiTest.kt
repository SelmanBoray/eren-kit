package dev.eren.ajanda.ag

import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.GecisNedeni
import dev.eren.ajanda.cekirdek.GecisOzeti
import dev.eren.ajanda.cekirdek.KoparmaSonucu
import dev.eren.ajanda.kimlik.GecisMetinleri
import dev.eren.ajanda.kimlik.GecisMetni
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** K5: yerel kipte eşleşme varken duran arka plan eşitlemesi geçiş başına bir kez, doğru metinle bildirilir. */
class DuraklamaBildirimiTest {
    private fun ozet(neden: GecisNedeni, ts: Long) = GecisOzeti(
        neden, ts, KoparmaSonucu(CalismaKipi.BAGLI, 0, 0, 0, 0, false, 0), "depo-a",
        if (neden == GecisNedeni.DEPO_DEGISTI) "depo-b" else null,
    )

    private var gecis: GecisOzeti? = ozet(GecisNedeni.DEPO_DEGISTI, 1_000)
    private var bekliyor = false
    private var planIzi = "plan-1"
    private var eslesme: String? = "eslesti:cihaz-1"
    private var gorunur = false
    private var izin = true
    private var saklanan: Long? = null
    private var uygulamadaSaklanan: Long? = null
    private var uygulamadaYazildi = 0
    private var saklananPlan: String? = null
    private var saklananEslesme: String? = null
    private val gosterilen = mutableListOf<GecisMetni>()
    private var kaldirilan = 0
    private var cekirdekHatasi: Exception? = null
    private val uyarilar = mutableListOf<String>()

    private val b = DuraklamaBildirimi(
        cekirdek = object : DuraklamaCekirdegi {
            override fun sonGecis(): GecisOzeti? { cekirdekHatasi?.let { throw it }; return gecis }
            override fun bekleyenPlan() = if (bekliyor) planIzi else null
            override fun eslesme() = eslesme
        },
        duraklama = object : GosterilenDuraklama {
            override fun plan() = saklananPlan
            override fun planYaz(iz: String) { saklananPlan = iz }
            override fun eslesme() = saklananEslesme
            override fun eslesmeYaz(kimlik: String) { saklananEslesme = kimlik }
        },
        gosterilen = object : GosterilenGecis {
            override fun oku() = saklanan
            override fun yaz(tsMs: Long) { saklanan = tsMs }
        },
        uygulamada = object : GosterilenGecis {
            override fun oku() = uygulamadaSaklanan
            override fun yaz(tsMs: Long) { uygulamadaYazildi++; uygulamadaSaklanan = tsMs }
        },
        bildirici = object : DuraklamaBildiricisi {
            override fun goster(m: GecisMetni): Boolean {
                if (!izin) return false
                gosterilen += m
                return true
            }
            override fun kaldir() { kaldirilan++ }
        },
        gorunur = { gorunur },
        gunluk = object : Gunluk {
            override fun bilgi(mesaj: String) {}
            override fun uyari(mesaj: String, hata: Throwable?) { uyarilar += mesaj }
        },
    )

    @Test
    fun depoDegistiGecisBasinaBirKez() {
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(1, gosterilen.size)
        assertEquals(1_000L, saklanan)
        assertEquals("Eşitleme durdu", gosterilen[0].baslik)
        assertTrue(gosterilen[0].govde.contains("Eren servisi değişti"))
        assertFalse(gosterilen[0].govde.contains("onayınızı bekliyor"))
        // Yeni geçiş: yeniden bir kez.
        gecis = ozet(GecisNedeni.DEPO_DEGISTI, 2_000)
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(2, gosterilen.size)
        assertEquals(2_000L, saklanan)
    }

    @Test
    fun yalnizGercektenBekleyenOnaydaOnayinizdiyeSoyler() {
        bekliyor = true
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals("Birleştirme onayınızı bekliyor", gosterilen.single().baslik)
        val m = GecisMetinleri.duraklama(ozet(GecisNedeni.DEPO_DEGISTI, 1), birlestirmeBekliyor = false)
        assertFalse((m.baslik + m.govde).contains("onay"))
        val k = GecisMetinleri.duraklama(ozet(GecisNedeni.KOPARMA, 1), birlestirmeBekliyor = false)
        assertTrue(k.govde.contains("yeniden bağlanma tamamlanmadı"))
        assertFalse(k.govde.contains("servisi değişti"))
    }

    @Test
    fun izinYoksaSessizAtlarSaklamaz() {
        izin = false
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertTrue(gosterilen.isEmpty())
        assertNull(saklanan)
        // İzin gelince (geçiş hâlâ gösterilmemiş) gösterilir.
        izin = true
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(1, gosterilen.size)
    }

    @Test
    fun arayuzGorunurkenGosterilmez() {
        gorunur = true
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertTrue(gosterilen.isEmpty())
        assertNull(saklanan)
        gorunur = false
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(1, gosterilen.size)
    }

    /** k5: arayüz geçişi gösterdiyse geçiş metni yinelenmez, ama duran eşitleme eşleşme başına bir kez söylenir. */
    @Test
    fun arayuzGosterdiyseGecisYinelenmezDuraklamaBirKez() {
        saklanan = 1_000
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(listOf(DuraklamaBildirimi.ESITLEME_BEKLIYOR), gosterilen)
        assertEquals(1_000L, saklanan)
    }

    @Test
    fun eslesmeYoksaYaDaBaskaSonuctaBildirimYok() {
        gecis = null
        eslesme = null
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        gecis = ozet(GecisNedeni.DEPO_DEGISTI, 5)
        eslesme = "eslesti:cihaz-1"
        for (s in ArkaPlanSonucu.entries - ArkaPlanSonucu.YEREL_KIP) b.arkaPlanBitti(s)
        assertTrue(gosterilen.isEmpty())
        // Eşitlenince ya da eşleşme kalkınca duraklama bildirimi kalkar.
        assertEquals(2, kaldirilan)
    }

    /** k5: ilk eşleşmede geçiş yok; duran eşitleme eşleşme başına bir kez, yeni eşleşmede yeniden. */
    @Test
    fun ilkEslesmedeGecisYokkenDeBirKezBildirilir() {
        gecis = null
        repeat(3) { b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP) }
        assertEquals(listOf(DuraklamaBildirimi.ESITLEME_BEKLIYOR), gosterilen)
        assertEquals("eslesti:cihaz-1", saklananEslesme)
        assertNull(saklanan)
        eslesme = "eslesti:cihaz-2"
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(2, gosterilen.size)
        // İzin yoksa saklanmaz, izin gelince gösterilir.
        izin = false
        eslesme = "bekliyor:10.0.0.2:8443"
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals("eslesti:cihaz-2", saklananEslesme)
        izin = true
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(3, gosterilen.size)
    }

    /** k5: koparmadan sonra yeniden eşleşme; koparma geçişini arayüz göstermişti. */
    @Test
    fun koparmadanSonraYenidenEslesmeBildirilir() {
        gecis = ozet(GecisNedeni.KOPARMA, 7_000)
        saklanan = 7_000
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(listOf(DuraklamaBildirimi.ESITLEME_BEKLIYOR), gosterilen)
        // Arayüz göstermemişse koparma geçişinin kendi metni ("yeniden bağlanma tamamlanmadı"), sonra yinelenmez.
        gosterilen.clear()
        saklanan = null
        saklananEslesme = null
        repeat(2) { b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP) }
        assertEquals(1, gosterilen.size)
        assertTrue(gosterilen[0].govde.contains("yeniden bağlanma tamamlanmadı"))
        assertEquals(7_000L, saklanan)
        assertEquals("eslesti:cihaz-1", saklananEslesme)
    }

    /** k5: onay bekleyen her plan bir kez; geçiş yoksa ya da gösterilmişse de. Plan düşünce yinelenmez. */
    @Test
    fun onayBekleyenHerPlanBirKez() {
        gecis = null
        bekliyor = true
        repeat(2) { b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP) }
        assertEquals(listOf(DuraklamaBildirimi.ONAY_BEKLIYOR), gosterilen)
        assertEquals("plan-1", saklananPlan)
        // Yeni bağlanmada yeni plan: yeniden bir kez.
        planIzi = "plan-2"
        repeat(2) { b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP) }
        assertEquals(2, gosterilen.size)
        // Bağlantı kapanınca plan düşer: aynı eşleşmenin duraklaması söylenmiş sayılır.
        bekliyor = false
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(2, gosterilen.size)
        // Gösterilmiş geçişle de plan bildirilir (geçişin metniyle).
        gecis = ozet(GecisNedeni.DEPO_DEGISTI, 9_000)
        saklanan = 9_000
        bekliyor = true
        planIzi = "plan-3"
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals("Birleştirme onayınızı bekliyor", gosterilen.last().baslik)
        assertEquals(3, gosterilen.size)
        // Görünürken hiçbiri.
        gorunur = true
        planIzi = "plan-4"
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(3, gosterilen.size)
    }

    /**
     * E3: bildirim `DEPO_DEGISTI`'yi söyledi diye uygulamanın geçiş penceresi susmaz. Bildirim yalnız kendi
     * işaretine yazar; uygulama penceresi yine bir kez açılır, gösterince kendi işaretine yazar ve bir daha açılmaz.
     */
    @Test
    fun bildirimDepoDegistiSoylesedeUygulamaBirKezGosterir() {
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(1, gosterilen.size)
        assertEquals(1_000L, saklanan)
        assertEquals("bildirim uygulamanın işaretine yazmaz", 0, uygulamadaYazildi)
        assertNull(uygulamadaSaklanan)
        val g = gecis
        assertTrue("uygulama penceresi açılır", GecisMetinleri.uygulamadaGosterilmeli(g, uygulamadaSaklanan, saklanan))
        // Arayüz gösterdi (üretimde `DuraklamaBildirimi.gecisGosterildi`): uygulamanın işareti.
        uygulamadaSaklanan = g!!.tsMs
        assertFalse("bir kez", GecisMetinleri.uygulamadaGosterilmeli(g, uygulamadaSaklanan, saklanan))
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals("bildirim de yinelemez", 1, gosterilen.size)
    }

    /** E3: uygulama geçişi gösterdiyse bildirim onu söylemez (yalnız duran eşitlemeyi, eşleşme başına bir kez). */
    @Test
    fun uygulamaGosterdiyseBildirimGecisiSoylemez() {
        uygulamadaSaklanan = 1_000
        repeat(2) { b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP) }
        assertEquals(listOf(DuraklamaBildirimi.ESITLEME_BEKLIYOR), gosterilen)
        assertNull("bildirimin işareti geçişle doldurulmaz", saklanan)
        assertEquals(0, uygulamadaYazildi)
    }

    /**
     * E3 geçişi: eski kurulumdaki tek kayıt bildirim işareti sayılır (`gosterilen_gecis_ts` anahtarı aynı kaldı),
     * uygulama işareti boş başlar. Eski kayıttaki `DEPO_DEGISTI` uygulamada bir kez gösterilir, bildirim yinelemez.
     */
    @Test
    fun eskiTekKayitBildirimIsaretiSayilirUygulamaBosBaslar() {
        saklanan = 1_000
        uygulamadaSaklanan = null
        val g = gecis!!
        assertTrue(GecisMetinleri.uygulamadaGosterilmeli(g, uygulamadaSaklanan, saklanan))
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(listOf(DuraklamaBildirimi.ESITLEME_BEKLIYOR), gosterilen)
        assertEquals(1_000L, saklanan)
        // Koparma geçişini bildirim söylediyse uygulama yinelemez (kullanıcının uygulamada yaptığı iş).
        val k = ozet(GecisNedeni.KOPARMA, 1_000)
        assertFalse(GecisMetinleri.uygulamadaGosterilmeli(k, null, 1_000))
        assertTrue(GecisMetinleri.uygulamadaGosterilmeli(k, null, null))
    }

    /**
     * K7: plan bildirimi geçişi anlatmaz, geçişin işaretine yazmaz. Uygulama geçişi işaretlemeden süreç öldüyse
     * (koparma, eşleşmeyi kaldırma) özet uygulamada yine açılır; uygulama hiç açılmadan plan kalkarsa geçişin
     * kendi metni bir kez bildirilir, sonra yinelenmez.
     */
    @Test
    fun planBildirimiGecisIsaretineYazmaz() {
        gecis = ozet(GecisNedeni.KOPARMA, 4_000)
        bekliyor = true
        repeat(2) { b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP) }
        assertEquals(listOf(DuraklamaBildirimi.ONAY_BEKLIYOR), gosterilen)
        assertNull("plan bildirimi geçişi söylemiş sayılmaz", saklanan)
        assertEquals(0, uygulamadaYazildi)
        assertTrue("uygulama özeti yine gösterir", GecisMetinleri.uygulamadaGosterilmeli(gecis, uygulamadaSaklanan, saklanan))

        // Plan kalktı, uygulama açılmadı: geçişin metni bir kez.
        bekliyor = false
        repeat(2) { b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP) }
        assertEquals(2, gosterilen.size)
        assertTrue(gosterilen[1].govde, gosterilen[1].govde.contains("yeniden bağlanma tamamlanmadı"))
        assertEquals(4_000L, saklanan)

        // Uygulama geçişi gösterdiyse plan da sonrası da geçişi söylemez.
        gosterilen.clear()
        saklanan = null
        saklananPlan = null
        uygulamadaSaklanan = 4_000
        bekliyor = true
        planIzi = "plan-9"
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        bekliyor = false
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertEquals(listOf(DuraklamaBildirimi.ONAY_BEKLIYOR), gosterilen)
        assertNull(saklanan)
    }

    @Test
    fun cekirdekHatasiDisariCikmaz() {
        cekirdekHatasi = IllegalStateException("x")
        b.arkaPlanBitti(ArkaPlanSonucu.YEREL_KIP)
        assertTrue(gosterilen.isEmpty())
        assertEquals(listOf("duraklama bildirimi başarısız"), uyarilar)
    }

    @Test
    fun metinlerdePcVeSifirYok() {
        val pc = Regex("(?<![\\p{L}\\p{N}_])PC(?![\\p{L}\\p{N}_])")
        for (n in GecisNedeni.entries) for (bek in listOf(true, false)) {
            val m = GecisMetinleri.duraklama(ozet(n, 1), bek)
            assertFalse(pc.containsMatchIn(m.baslik + m.govde))
            assertTrue(m.satirlar.isNotEmpty())
        }
        for (m in listOf(DuraklamaBildirimi.ONAY_BEKLIYOR, DuraklamaBildirimi.ESITLEME_BEKLIYOR)) {
            assertFalse(pc.containsMatchIn(m.baslik + m.govde))
            assertTrue(m.satirlar.isNotEmpty())
        }
        // Geçişsiz onay metni geçişlininkiyle aynı.
        assertEquals(GecisMetinleri.duraklama(ozet(GecisNedeni.KOPARMA, 1), true), DuraklamaBildirimi.ONAY_BEKLIYOR)
    }
}
