package dev.eren.ajanda.ag

import dev.eren.ajanda.cekirdek.SurumUyusmazligi
import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.CalismaKipi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.TimeUnit
import kotlin.random.Random

/** Bağlantı yaşam döngüsü: sanal saatle (tek iş parçacığı) ve bir eşzamanlılık testi gerçek yürütücüyle. */
class BaglantiDenetcisiTest {
    private val zaman = SahteZamanlayici()
    private val cekirdek = SahteCekirdek()
    private val acici = SahteAcici()
    private val ag = SahteAg(true)
    private val isler = SahteIsler()
    private val gunluk = ToplayanGunluk()
    private val ayar = AgAyarlari()

    private fun denetci(a: AgAyarlari = ayar) =
        BaglantiDenetcisi({ cekirdek }, acici, zaman, ag, isler, gunluk, a, rastgele = { 0.5 })

    /** basla -> soket açılır ve çekirdek kabul eder. */
    private fun bagliDenetci(): Pair<BaglantiDenetcisi, SahteHamSoket> {
        val d = denetci()
        d.basla()
        zaman.bosalt()
        val h = acici.son
        h.ac()
        zaman.bosalt()
        return d to h
    }

    @Test
    fun beklemeFormuluSapmaVeUstSinir() {
        assertEquals(0L, ayar.bekleme(0, 0.5))
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 32_000L, 60_000L, 60_000L), listOf(1, 2, 3, 6, 7, 50).map { ayar.bekleme(it, 0.5) })
        assertEquals(800L, ayar.bekleme(1, 0.0))
        assertEquals(1_200L, ayar.bekleme(1, 1.0))
        assertEquals(60_000L, ayar.bekleme(7, 1.0))
        assertEquals(48_000L, ayar.bekleme(7, 0.0))
    }

    @Test
    fun eslesmeYokkenHicBaglanmazEslesmeGelinceBaglanir() {
        cekirdek.adres = null
        val d = denetci()
        d.basla()
        d.basla()
        zaman.ilerle(10 * 60_000)
        assertTrue(acici.acilanlar.isEmpty())
        assertEquals("boşuna yeniden deneme kurulmaz", emptyList<Long>(), zaman.bekleyenler())
        assertFalse(isler.cagrilar.contains("periyodik"))

        cekirdek.adres = TEST_ADRESI
        cekirdek.eslesmeDegisti()
        zaman.bosalt()
        assertEquals(1, acici.acilanlar.size)
        assertEquals(TEST_ADRESI, acici.son.adres)
        assertEquals(listOf("periyodik"), isler.cagrilar)
    }

    @Test
    fun baslaBaglanirPeriyodikIsiBirKezKurar() {
        val (d, h) = bagliDenetci()
        assertEquals(listOf("acildi 1"), cekirdek.olaylar)
        d.basla()
        d.basla()
        zaman.bosalt()
        assertEquals("açıkken basla ikinci soket açmaz", 1, acici.acilanlar.size)
        assertFalse(h.bitti)
        assertEquals(listOf("periyodik"), isler.cagrilar)
    }

    @Test
    fun yenidenDenemeAraliklariBuyurCanlidaSifirlanir() {
        val d = denetci()
        d.basla()
        zaman.bosalt()
        val araliklar = mutableListOf<Long>()
        repeat(8) {
            acici.son.hata()
            zaman.bosalt()
            val bekleyen = zaman.bekleyenler()
            assertEquals(1, bekleyen.size)
            araliklar += bekleyen.single()
            val once = acici.acilanlar.size
            zaman.ilerle(bekleyen.single() - 1)
            assertEquals("süre dolmadan denenmez", once, acici.acilanlar.size)
            zaman.ilerle(1)
            assertEquals(once + 1, acici.acilanlar.size)
        }
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L, 60_000L), araliklar)

        // Açılış tek başına başarı sayılmaz; CANLI sayılır.
        acici.son.ac()
        zaman.bosalt()
        cekirdek.durumYaz(BaglantiAsamasi.EL_SIKISMA, 0)
        zaman.bosalt()
        acici.son.hata()
        zaman.bosalt()
        assertEquals(listOf(60_000L), zaman.bekleyenler())
        zaman.ilerle(60_000)
        acici.son.ac()
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0)
        zaman.bosalt()
        acici.son.karsiKapatti()
        zaman.bosalt()
        // (5 s'lik olan: kapanış yanıtlanmazsa ham soketi kesme zamanlayıcısı)
        assertEquals(listOf(1_000L, ayar.kapatmaBeklemeMs), zaman.bekleyenler())
        d.birak()
    }

    @Test
    fun agYokkenDenenmezAgGelinceHemenDenenir() {
        ag.var_ = false
        val d = denetci()
        d.basla()
        zaman.ilerle(5 * 60_000)
        assertTrue(acici.acilanlar.isEmpty())

        ag.degistir(true)
        zaman.bosalt()
        assertEquals(1, acici.acilanlar.size)

        // Koptu, bekleme kuruldu; ağ gidince bekleme iptal, hiç denenmez.
        acici.son.hata()
        zaman.bosalt()
        assertEquals(listOf(1_000L), zaman.bekleyenler())
        ag.degistir(false)
        zaman.ilerle(10 * 60_000)
        assertEquals(1, acici.acilanlar.size)
        assertEquals(emptyList<Long>(), zaman.bekleyenler())

        // Ağ geldi: sayaç sıfır, hemen.
        ag.degistir(true)
        zaman.bosalt()
        assertEquals(2, acici.acilanlar.size)

        // Açıkken yeni ağ haberi ikinci soket açmaz.
        ag.degistir(true)
        zaman.bosalt()
        assertEquals(2, acici.acilanlar.size)
        assertEquals(1, ag.baslatmaSayisi)
    }

    @Test
    fun birakKisaBekleyiptenKapatirTekrarliCagriZararsiz() {
        val (d, h) = bagliDenetci()
        d.birak()
        d.birak()
        zaman.ilerle(ayar.birakmaGecikmesiMs - 1)
        assertFalse(h.bitti)
        zaman.ilerle(1)
        assertEquals(1000, h.kapatmaKodu)
        assertEquals(listOf("kapandi 1"), cekirdek.kapanislar())
        zaman.ilerle(10 * 60_000)
        assertEquals("bıraktıktan sonra yeniden denenmez", 1, acici.acilanlar.size)
        assertFalse(isler.cagrilar.contains("kuyruk"))

        d.birak()
        zaman.bosalt()
        // Hiç başlamamış denetçide birak bir şey yapmaz.
        val d2 = denetci()
        d2.birak()
        zaman.ilerle(60_000)
        assertEquals(1, acici.acilanlar.size)
    }

    @Test
    fun bekleme_suresinde_basla_baglantiyi_korur() {
        val (d, h) = bagliDenetci()
        d.birak()
        zaman.ilerle(1_000)
        d.basla()
        zaman.ilerle(60_000)
        assertFalse(h.bitti)
        assertEquals(1, acici.acilanlar.size)
    }

    @Test
    fun birakildigindaKuyrukBosalanaDekBekler() {
        val (d, h) = bagliDenetci()
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 2)
        zaman.bosalt()
        d.birak()
        zaman.ilerle(ayar.birakmaGecikmesiMs)
        assertFalse("kuyruk boşalıyor", h.bitti)
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0)
        zaman.bosalt()
        assertEquals(1000, h.kapatmaKodu)
        assertFalse(isler.cagrilar.contains("kuyruk"))
    }

    @Test
    fun kuyrukBosalmazsaKapatirVeAgKosulluIsKurar() {
        val (d, h) = bagliDenetci()
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 2)
        zaman.bosalt()
        d.birak()
        zaman.ilerle(ayar.birakmaGecikmesiMs + ayar.bosaltmaSuresiMs - 1)
        assertFalse(h.bitti)
        zaman.ilerle(1)
        assertEquals(1000, h.kapatmaKodu)
        assertTrue(isler.cagrilar.contains("kuyruk"))
        zaman.ilerle(10 * 60_000)
        assertEquals(1, acici.acilanlar.size)
    }

    @Test
    fun kopukkenBirakilirsaKuyrukIsiKurulur() {
        val d = denetci()
        cekirdek.durum = SahteCekirdek.durumOlustur(BaglantiAsamasi.KOPUK, 1)
        d.basla()
        zaman.bosalt()
        acici.son.hata()
        zaman.bosalt()
        d.birak()
        zaman.ilerle(ayar.birakmaGecikmesiMs + 2_000)
        assertEquals(listOf("periyodik", "kuyruk"), isler.cagrilar)
        zaman.ilerle(10 * 60_000)
        assertTrue(acici.acilanlar.size <= 2)
        assertEquals(0, acici.acikSayisi())
    }

    @Test
    fun acilisSuresiDolarsaKesilirVeYenidenDenenir() {
        val d = denetci()
        d.basla()
        zaman.bosalt()
        val h = acici.son
        zaman.ilerle(ayar.acilisSuresiMs)
        assertTrue(h.iptalEdildi)
        assertEquals(emptyList<String>(), cekirdek.olaylar)
        assertEquals(listOf(1_000L), zaman.bekleyenler())
        zaman.ilerle(1_000)
        assertEquals(2, acici.acilanlar.size)
        d.birak()
    }

    @Test
    fun aciciAtarsaHataSayilirDongusuzYenidenDenenir() {
        acici.hata = IllegalArgumentException("bozuk adres")
        val d = denetci()
        d.basla()
        zaman.bosalt()
        assertEquals(listOf(1_000L), zaman.bekleyenler())
        zaman.ilerle(1_000)
        assertEquals(listOf(2_000L), zaman.bekleyenler())
        d.birak()
        zaman.ilerle(60_000)
        assertEquals(emptyList<Long>(), zaman.bekleyenler())
    }

    // ---------------------------------------------------------------------------------------------
    // Arka plan oturumu
    // ---------------------------------------------------------------------------------------------

    @Test
    fun arkaPlanOturumuEsitlenipKuyrukBosalincaKapatir() {
        val d = denetci()
        val sonuc = mutableListOf<ArkaPlanSonucu>()
        d.arkaPlanOturumu { sonuc += it }
        zaman.bosalt()
        val h = acici.son
        h.ac()
        zaman.bosalt()
        cekirdek.durumYaz(BaglantiAsamasi.TELAFI, 0)
        zaman.bosalt()
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 1)
        zaman.bosalt()
        assertTrue(sonuc.isEmpty())
        assertFalse(h.bitti)
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0)
        zaman.bosalt()
        assertEquals(listOf(ArkaPlanSonucu.ESITLENDI), sonuc)
        assertEquals(1000, h.kapatmaKodu)
        assertEquals(listOf("kapandi 1"), cekirdek.kapanislar())
        zaman.ilerle(10 * 60_000)
        assertEquals(1, acici.acilanlar.size)
        assertEquals(listOf(ArkaPlanSonucu.ESITLENDI), sonuc)
    }

    @Test
    fun arkaPlanSuresiDolarsaKapatir() {
        val d = denetci()
        val sonuc = mutableListOf<ArkaPlanSonucu>()
        d.arkaPlanOturumu { sonuc += it }
        zaman.bosalt()
        val h = acici.son
        h.ac()
        cekirdek.durumYaz(BaglantiAsamasi.TELAFI, 0)
        zaman.ilerle(ayar.arkaPlanSuresiMs - 1)
        assertTrue(sonuc.isEmpty())
        zaman.ilerle(1)
        assertEquals(listOf(ArkaPlanSonucu.SURE_DOLDU), sonuc)
        assertEquals(1000, h.kapatmaKodu)
        assertEquals(listOf("kapandi 1"), cekirdek.kapanislar())
    }

    @Test
    fun arkaPlanPcKapaliysaDenemeSinirindaBirakir() {
        val d = denetci()
        val sonuc = mutableListOf<ArkaPlanSonucu>()
        d.arkaPlanOturumu { sonuc += it }
        zaman.bosalt()
        acici.son.hata()
        zaman.ilerle(1_000)
        acici.son.hata()
        zaman.ilerle(2_000)
        acici.son.hata()
        zaman.bosalt()
        assertEquals(listOf(ArkaPlanSonucu.ULASILAMADI), sonuc)
        assertEquals(3, acici.acilanlar.size)
        zaman.ilerle(10 * 60_000)
        assertEquals(3, acici.acilanlar.size)
        assertEquals(emptyList<Long>(), zaman.bekleyenler())
    }

    @Test
    fun arkaPlanEslesmeYoksaBaglanmazPeriyodikIsiKaldirir() {
        cekirdek.adres = null
        val d = denetci()
        val sonuc = mutableListOf<ArkaPlanSonucu>()
        d.arkaPlanOturumu { sonuc += it }
        zaman.bosalt()
        assertEquals(listOf(ArkaPlanSonucu.ESLESME_YOK), sonuc)
        assertTrue(acici.acilanlar.isEmpty())
        assertEquals(listOf("periyodik-iptal"), isler.cagrilar)
    }

    @Test
    fun arkaPlanAgYoksaHemenBiter() {
        ag.var_ = false
        val d = denetci()
        val sonuc = mutableListOf<ArkaPlanSonucu>()
        d.arkaPlanOturumu { sonuc += it }
        zaman.bosalt()
        assertEquals(listOf(ArkaPlanSonucu.AG_YOK), sonuc)
        assertTrue(acici.acilanlar.isEmpty())
    }

    @Test
    fun arkaPlanArayuzunBaglantisiniKullanirKapatmaz() {
        val (d, h) = bagliDenetci()
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0)
        zaman.bosalt()
        val sonuc = mutableListOf<ArkaPlanSonucu>()
        d.arkaPlanOturumu { sonuc += it }
        zaman.bosalt()
        assertEquals(listOf(ArkaPlanSonucu.ESITLENDI), sonuc)
        assertFalse(h.bitti)
        assertEquals(1, acici.acilanlar.size)
    }

    @Test
    fun arkaPlanYerelKipteBaglanmaz() {
        cekirdek.calismaKipi = CalismaKipi.YEREL
        val d = denetci()
        val sonuc = mutableListOf<ArkaPlanSonucu>()
        d.arkaPlanOturumu { sonuc += it }
        zaman.bosalt()
        assertEquals(listOf(ArkaPlanSonucu.YEREL_KIP), sonuc)
        assertTrue(acici.acilanlar.isEmpty())
        // Periyodik iş kaldırılmaz (onaydan sonra bağlı kipte gerekir), süre zamanlayıcısı kalmaz.
        assertTrue(isler.cagrilar.isEmpty())
        assertEquals(emptyList<Long>(), zaman.bekleyenler())
    }

    @Test
    fun arkaPlanYerelKipteEslesmeYoksaEskiYol() {
        cekirdek.calismaKipi = CalismaKipi.YEREL
        cekirdek.adres = null
        val d = denetci()
        val sonuc = mutableListOf<ArkaPlanSonucu>()
        d.arkaPlanOturumu { sonuc += it }
        zaman.bosalt()
        assertEquals(listOf(ArkaPlanSonucu.ESLESME_YOK), sonuc)
        assertEquals(listOf("periyodik-iptal"), isler.cagrilar)
    }

    @Test
    fun yerelKipteOnPlanBaglantisiSurerArkaPlanOnaDokunmaz() {
        cekirdek.calismaKipi = CalismaKipi.YEREL
        val (d, h) = bagliDenetci()
        // Birleştirme onayı bekleniyor: bağlantı Telafi'de durur.
        cekirdek.durumYaz(BaglantiAsamasi.TELAFI, 0)
        zaman.bosalt()
        val sonuc = mutableListOf<ArkaPlanSonucu>()
        d.arkaPlanOturumu { sonuc += it }
        zaman.bosalt()
        assertEquals(listOf(ArkaPlanSonucu.YEREL_KIP), sonuc)
        assertFalse(h.bitti)
        assertEquals(1, acici.acilanlar.size)
    }

    @Test
    fun arkaPlanIptalBaglantiyiBirakir() {
        val d = denetci()
        val sonuc = mutableListOf<ArkaPlanSonucu>()
        val iptal = d.arkaPlanOturumu { sonuc += it }
        zaman.bosalt()
        val h = acici.son
        h.ac()
        zaman.bosalt()
        iptal.iptal()
        iptal.iptal()
        zaman.bosalt()
        assertEquals(listOf(ArkaPlanSonucu.IPTAL), sonuc)
        assertEquals(1000, h.kapatmaKodu)
    }

    // ---------------------------------------------------------------------------------------------
    // Eşzamanlılık: gerçek yürütücü, çok iş parçacığından basla/birak.
    // ---------------------------------------------------------------------------------------------

    @Test
    fun esZamanliBaslaBirakTekSoketIlkesiniBozmaz() {
        val gercek = YurutucuZamanlayici("test-ag")
        try {
            val d = BaglantiDenetcisi(
                { cekirdek }, acici, gercek, ag, isler, gunluk,
                AgAyarlari(birakmaGecikmesiMs = 0), rastgele = { 0.5 },
            )
            val is_parcaciklari = 8
            val engel = CyclicBarrier(is_parcaciklari)
            val bitti = CountDownLatch(is_parcaciklari)
            repeat(is_parcaciklari) { i ->
                Thread {
                    val r = Random(i)
                    engel.await()
                    repeat(300) { if (r.nextBoolean()) d.basla() else d.birak() }
                    bitti.countDown()
                }.start()
            }
            assertTrue(bitti.await(20, TimeUnit.SECONDS))
            d.basla()
            sirayiBosalt(gercek)
            assertTrue("aynı anda en çok bir soket: ${acici.enCokAcik}", acici.enCokAcik <= 1)
            assertEquals(1, acici.acikSayisi())

            d.birak()
            sirayiBosalt(gercek)
            assertEquals(0, acici.acikSayisi())
            assertNull(gunluk.satirlar.firstOrNull { it.contains("başarısız") })
        } finally {
            gercek.kapat()
        }
    }

    private fun sirayiBosalt(z: Zamanlayici) {
        repeat(5) {
            val l = CountDownLatch(1)
            z.execute { l.countDown() }
            assertTrue(l.await(5, TimeUnit.SECONDS))
        }
    }

    @Test
    fun surumUyusmazligindaYenidenBaglanmaGeriCekilirOneGelinceBirKezDenenir() {
        val (d, h) = bagliDenetci()
        // Eski servis: çekirdek uyuşmazlığı yazdı (v1 error çerçevesi), servis 1002 ile kapattı.
        cekirdek.durum = SahteCekirdek.durumOlustur(BaglantiAsamasi.KOPUK, 1, SurumUyusmazligi.SERVIS_ESKI)
        h.karsiKapatti(1002)
        zaman.bosalt()
        assertEquals("kapanış kodu çekirdeğe gider", listOf<Int?>(1002), cekirdek.kapanisKodlari)
        val bekleyen = zaman.bekleyenler()
        assertTrue(bekleyen.toString(), ayar.surumBeklemeMs in bekleyen)
        assertFalse("artan beklemeli sıkı döngü yok", bekleyen.any { it < ayar.kapatmaBeklemeMs })

        // Ağ değişimi de boşuna denemez; uzun bekleme sürer.
        ag.degistir(true)
        zaman.ilerle(10 * 60_000)
        assertEquals(1, acici.acilanlar.size)

        // Kullanıcı uygulamayı yeniden öne getirdi (belki güncelledi): hemen bir kez denenir.
        d.basla()
        zaman.bosalt()
        assertEquals(2, acici.acilanlar.size)
        acici.son.ac()
        acici.son.karsiKapatti(1002)
        zaman.bosalt()
        assertTrue(ayar.surumBeklemeMs in zaman.bekleyenler())
        assertEquals(2, acici.acilanlar.size)

        // Süre dolunca bir deneme; servis güncellenmiş: CANLI, durum kalkar, sıradan bekleme geri gelir.
        zaman.ilerle(ayar.surumBeklemeMs)
        assertEquals(3, acici.acilanlar.size)
        acici.son.ac()
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0)
        zaman.bosalt()
        cekirdek.durum = SahteCekirdek.durumOlustur(BaglantiAsamasi.KOPUK, 0)
        acici.son.hata()
        zaman.bosalt()
        assertEquals(listOf(1_000L), zaman.bekleyenler())
        d.birak()
    }

    /**
     * Düşülen alt sürümde boşta açık kalan canlı bağlantı: `yukariDenemeMs` anına bir `baglantiDurumu()`
     * yoklaması kurulur (duvar saatiyle ölçülür); o çağrıda çekirdek kapatır, sıradan kopma gibi yeniden bağlanılır.
     * An geçmiş ama kapatılmamışsa (yolda işlem) `yukariTekrarMs` sonra yeniden yoklanır, döngü dönmez. Uzak an
     * tavanla (`yukariTekrarMs`) yoklanır: kalan bu aralığa inince tam ana kurulur.
     */
    @Test
    fun yukariDenemeAninaDurumYoklamasiKurulur() {
        var duvar = 5_000_000L
        val d = BaglantiDenetcisi({ cekirdek }, acici, zaman, ag, isler, gunluk, ayar, rastgele = { 0.5 }, duvarSaati = { duvar })
        d.basla()
        zaman.bosalt()
        val h = acici.son
        h.ac()
        zaman.bosalt()
        val tekrar = ayar.yukariTekrarMs
        val an = duvar + 60 * tekrar
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0, yukariDenemeMs = an)
        zaman.bosalt()
        assertTrue(zaman.bekleyenler().toString(), tekrar in zaman.bekleyenler())
        assertFalse("tavan: saatlik bekleme kurulmaz", zaman.bekleyenler().any { it > tekrar })
        // Aynı an yeniden okununca ikinci yoklama kurulmaz.
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0, yukariDenemeMs = an)
        zaman.bosalt()
        assertEquals(1, zaman.bekleyenler().count { it == tekrar })

        // Ana dek tavan aralığıyla yoklanır (bağlantı kapanmaz); son aralık tam ana denk gelir, çekirdek o
        // çağrıda bağlantıyı kapatır.
        cekirdek.durumOkunurken = {
            if (duvar >= an) {
                cekirdek.durum = SahteCekirdek.durumOlustur(BaglantiAsamasi.KOPUK, 0)
                cekirdek.kendisiKapat()
            }
        }
        val once = cekirdek.durumOkuma
        repeat(59) {
            duvar += tekrar
            zaman.ilerle(tekrar)
        }
        assertEquals("aralık başına bir yoklama", once + 59, cekirdek.durumOkuma)
        assertFalse(h.bitti)
        duvar += tekrar - 1
        zaman.ilerle(tekrar - 1)
        assertEquals("erken yoklanmaz", once + 59, cekirdek.durumOkuma)
        assertFalse(h.bitti)
        duvar += 1
        zaman.ilerle(1)
        assertTrue("yoklama çekirdeği çağırdı", cekirdek.durumOkuma > once + 59)
        assertTrue("bağlantı kapandı", h.bitti)
        h.karsiKapatti()
        zaman.bosalt()
        assertTrue("sıradan kopma gibi yeniden bağlanır: ${zaman.bekleyenler()}", 1_000L in zaman.bekleyenler())
        zaman.ilerle(1_000)
        assertEquals(2, acici.acilanlar.size)
        d.birak()
    }

    @Test
    fun yukariDenemeAniGecmisseTekrarAraligiylaYoklanirKopuncaIptal() {
        var duvar = 9_000_000L
        val d = BaglantiDenetcisi({ cekirdek }, acici, zaman, ag, isler, gunluk, ayar, rastgele = { 0.5 }, duvarSaati = { duvar })
        d.basla()
        zaman.bosalt()
        acici.son.ac()
        zaman.bosalt()
        // Yolda işlem var: çekirdek an geçtiği hâlde kapatmaz, an durumda kalır.
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0, yukariDenemeMs = duvar - 10)
        zaman.bosalt()
        assertTrue(zaman.bekleyenler().toString(), ayar.yukariTekrarMs in zaman.bekleyenler())
        val once = cekirdek.durumOkuma
        zaman.ilerle(ayar.yukariTekrarMs)
        assertEquals(once + 1, cekirdek.durumOkuma)
        assertTrue("yeniden kuruldu, sıfır gecikmeli döngü yok", ayar.yukariTekrarMs in zaman.bekleyenler())
        assertFalse(0L in zaman.bekleyenler())
        // An kalkınca (v3'e çıkıldı ya da yeniden bağlanıldı) yoklama iptal.
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0)
        zaman.bosalt()
        assertFalse(ayar.yukariTekrarMs in zaman.bekleyenler())
        // Yeniden kurulup soket kopunca da iptal; CANLI değilken kurulmaz.
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0, yukariDenemeMs = duvar + 500)
        zaman.bosalt()
        assertTrue(500L in zaman.bekleyenler())
        cekirdek.durum = SahteCekirdek.durumOlustur(BaglantiAsamasi.KOPUK, 0)
        acici.son.hata()
        zaman.bosalt()
        assertFalse(500L in zaman.bekleyenler())
        cekirdek.durumYaz(BaglantiAsamasi.TELAFI, 0, yukariDenemeMs = duvar + 700)
        zaman.bosalt()
        assertFalse(700L in zaman.bekleyenler())
        d.birak()
    }

    /**
     * Geçmiş isteğinin zaman aşımı (`gecmisBeklemeMs`): o ana bir `baglantiDurumu()` yoklaması kurulur (aşamadan
     * bağımsız, soket açıkken); an geçtiyse çekirdek isteği düşürür ve an durumdan kalkar.
     */
    @Test
    fun gecmisBeklemeAninaDurumYoklamasiKurulur() {
        var duvar = 7_000_000L
        val d = BaglantiDenetcisi({ cekirdek }, acici, zaman, ag, isler, gunluk, ayar, rastgele = { 0.5 }, duvarSaati = { duvar })
        d.basla()
        zaman.bosalt()
        acici.son.ac()
        zaman.bosalt()
        cekirdek.durumYaz(BaglantiAsamasi.TELAFI, 0)
        zaman.bosalt()
        // Gerçek akış: `gecmisIste` yalnız `Degisim.gecmis` yayar (`baglanti` yok).
        val an = duvar + 30_000
        cekirdek.gecmisDegisti(an)
        zaman.bosalt()
        assertTrue(zaman.bekleyenler().toString(), 30_000L in zaman.bekleyenler())
        // Aynı an yeniden okununca ikinci yoklama kurulmaz.
        cekirdek.gecmisDegisti(an)
        zaman.bosalt()
        assertEquals(1, zaman.bekleyenler().count { it == 30_000L })

        // An gelince tek okuma; çekirdek o çağrıda isteği düşürür, an kalkar, yeni yoklama kurulmaz.
        cekirdek.durumOkunurken = {
            if (duvar >= an) cekirdek.durum = SahteCekirdek.durumOlustur(BaglantiAsamasi.TELAFI, 0)
        }
        val once = cekirdek.durumOkuma
        duvar += 29_999
        zaman.ilerle(29_999)
        assertEquals("erken yoklanmaz", once, cekirdek.durumOkuma)
        duvar += 1
        zaman.ilerle(1)
        assertEquals("yoklama çekirdeği bir kez çağırdı", once + 1, cekirdek.durumOkuma)
        assertFalse(zaman.bekleyenler().toString(), zaman.bekleyenler().any { it == ayar.yukariTekrarMs || it == 0L })
        assertFalse(acici.son.bitti)

        // Düşürme kancası kalkar: yoksa sonraki her okumada yazılan durumu (yeni `gecmisBeklemeMs`) ezerdi.
        cekirdek.durumOkunurken = {}
        // Soket kapanınca kurulu geçmiş yoklaması iptal; kopukken kurulmaz.
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0)
        cekirdek.gecmisDegisti(duvar + 800)
        zaman.bosalt()
        assertTrue(800L in zaman.bekleyenler())
        cekirdek.durum = SahteCekirdek.durumOlustur(BaglantiAsamasi.KOPUK, 0)
        acici.son.hata()
        zaman.bosalt()
        assertFalse(800L in zaman.bekleyenler())
        d.birak()
    }

    /** İki an tek zamanlayıcıda birleşir: en yakın olan kurulur, sonra öteki; ayrı ayrı yarışmazlar. */
    @Test
    fun yukariVeGecmisAnlariTekYoklamadaBirlesir() {
        var duvar = 11_000_000L
        val d = BaglantiDenetcisi({ cekirdek }, acici, zaman, ag, isler, gunluk, ayar, rastgele = { 0.5 }, duvarSaati = { duvar })
        d.basla()
        zaman.bosalt()
        acici.son.ac()
        zaman.bosalt()
        val yukari = duvar + 3_600_000
        val gecmis = duvar + 30_000
        val dinlenen = zaman.bekleyenler()
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0, yukariDenemeMs = yukari, gecmisBeklemeMs = gecmis)
        zaman.bosalt()
        val yeni = zaman.bekleyenler() - dinlenen.toSet()
        assertEquals("tek yoklama, en yakın an: $yeni", listOf(30_000L), yeni)

        // Geçmiş anı gelince yoklanır; istek düştü, yukarı anı kalır: yalnız o kurulur.
        cekirdek.durumOkunurken = {
            if (duvar >= gecmis) cekirdek.durum = SahteCekirdek.durumOlustur(BaglantiAsamasi.CANLI, 0).copy(yukariDenemeMs = yukari)
        }
        val once = cekirdek.durumOkuma
        duvar += 30_000
        zaman.ilerle(30_000)
        assertEquals(once + 1, cekirdek.durumOkuma)
        // Yukarı anı uzakta: tavanla (`yukariTekrarMs`) kurulur.
        val kalan = zaman.bekleyenler()
        assertTrue(kalan.toString(), ayar.yukariTekrarMs in kalan)
        assertEquals(1, kalan.count { it == ayar.yukariTekrarMs })
        assertFalse("geçmiş için ayrı yoklama kalmadı", kalan.any { it in 1L..30_000L })

        // Ters sıra: yukarı anı daha yakınsa o kurulur.
        cekirdek.durumOkunurken = {}
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0, yukariDenemeMs = duvar + 2_000, gecmisBeklemeMs = duvar + 9_000)
        zaman.bosalt()
        val ters = zaman.bekleyenler()
        assertTrue(ters.toString(), 2_000L in ters)
        assertFalse(ters.toString(), 9_000L in ters)
        assertFalse("önceki yoklama iptal edildi", ayar.yukariTekrarMs in ters)
        d.birak()
    }

    /**
     * K1: çekirdek `gecmis_iste`'de yalnız `Degisim.gecmis` yayar. Gözlemci onu da dinler: başka hiçbir sinyal
     * gelmeden yoklama kurulur, yanıt gelince (yine yalnız `gecmis`) kalkar.
     */
    @Test
    fun yalnizGecmisDegisimiYoklamayiKurarYanitKaldirir() {
        var duvar = 13_000_000L
        val d = BaglantiDenetcisi({ cekirdek }, acici, zaman, ag, isler, gunluk, ayar, rastgele = { 0.5 }, duvarSaati = { duvar })
        d.basla()
        zaman.bosalt()
        acici.son.ac()
        zaman.bosalt()
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0)
        zaman.bosalt()
        val once = zaman.bekleyenler()
        val okuma = cekirdek.durumOkuma
        cekirdek.gecmisDegisti(duvar + 45_000)
        zaman.bosalt()
        assertEquals("durum yeniden okundu", okuma + 1, cekirdek.durumOkuma)
        assertEquals(listOf(45_000L), zaman.bekleyenler() - once.toSet())
        // Yanıt geldi: çekirdek isteği düşürür, an kalkar; yine yalnız `gecmis`.
        cekirdek.gecmisDegisti(null)
        zaman.bosalt()
        assertFalse(zaman.bekleyenler().toString(), 45_000L in zaman.bekleyenler())
        // Kayıt değişimi tek başına durumu okutmaz (eski davranış korunur).
        val okuma2 = cekirdek.durumOkuma
        cekirdek.gozlemciler.toList().forEach {
            it.degisti(dev.eren.ajanda.cekirdek.Degisim(listOf("k_ornek1"), false, false, false, false, emptyList()))
        }
        zaman.bosalt()
        assertEquals(okuma2, cekirdek.durumOkuma)
        d.birak()
    }

    /**
     * K2: anlar duvar saatiyle ölçülür. Saat geri gittiyse (`an - simdi` saatler) yoklama en çok `yukariTekrarMs`
     * bekler; her iki an için de.
     */
    @Test
    fun saatGeriGidinceYoklamaTavaniAsmaz() {
        var duvar = 20_000_000L
        val d = BaglantiDenetcisi({ cekirdek }, acici, zaman, ag, isler, gunluk, ayar, rastgele = { 0.5 }, duvarSaati = { duvar })
        d.basla()
        zaman.bosalt()
        acici.son.ac()
        zaman.bosalt()
        val once = zaman.bekleyenler()
        val gecmisAni = duvar + 30_000
        // Saat üç saat geri gitti; çekirdeğin bildirdiği an eski saate göre.
        duvar -= 3 * 3_600_000L
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0)
        cekirdek.gecmisDegisti(gecmisAni)
        zaman.bosalt()
        assertEquals(listOf(ayar.yukariTekrarMs), zaman.bekleyenler() - once.toSet())
        // Tavan dolunca yoklanır; an hâlâ uzaksa yine tavanla (döngü dönmez, saatlerce de beklenmez).
        val okuma = cekirdek.durumOkuma
        duvar += ayar.yukariTekrarMs
        zaman.ilerle(ayar.yukariTekrarMs)
        assertEquals(okuma + 1, cekirdek.durumOkuma)
        assertEquals(listOf(ayar.yukariTekrarMs), zaman.bekleyenler() - once.toSet())

        // Yukarı anı için de: bir saat + üç saat uzakta görünen an tavanla.
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0, yukariDenemeMs = duvar + 4 * 3_600_000L)
        zaman.bosalt()
        val yeni = zaman.bekleyenler() - once.toSet()
        assertEquals(listOf(ayar.yukariTekrarMs), yeni)
        assertFalse(yeni.any { it > ayar.yukariTekrarMs })
        d.birak()
    }

    @Test
    fun surumUyusmazligindaArkaPlanOturumuHemenBiter() {
        val d = denetci()
        val sonuc = mutableListOf<ArkaPlanSonucu>()
        d.arkaPlanOturumu { sonuc += it }
        zaman.bosalt()
        acici.son.ac()
        zaman.bosalt()
        cekirdek.durum = SahteCekirdek.durumOlustur(BaglantiAsamasi.KOPUK, 0, SurumUyusmazligi.UYGULAMA_ESKI)
        acici.son.karsiKapatti(1002)
        zaman.bosalt()
        assertEquals(listOf(ArkaPlanSonucu.SURUM_UYUSMAZ), sonuc)
        assertEquals("üç deneme beklenmez", 1, acici.acilanlar.size)
    }
}
