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
     * An geçmiş ama kapatılmamışsa (yolda işlem) `yukariTekrarMs` sonra yeniden yoklanır, döngü dönmez.
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
        val an = duvar + 3_600_000
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0, yukariDenemeMs = an)
        zaman.bosalt()
        assertTrue(zaman.bekleyenler().toString(), 3_600_000L in zaman.bekleyenler())
        // Aynı an yeniden okununca ikinci yoklama kurulmaz.
        cekirdek.durumYaz(BaglantiAsamasi.CANLI, 0, yukariDenemeMs = an)
        zaman.bosalt()
        assertEquals(1, zaman.bekleyenler().count { it == 3_600_000L })

        // An gelince tek okuma; çekirdek o çağrıda bağlantıyı kapatır.
        cekirdek.durumOkunurken = {
            if (duvar >= an) {
                cekirdek.durum = SahteCekirdek.durumOlustur(BaglantiAsamasi.KOPUK, 0)
                cekirdek.kendisiKapat()
            }
        }
        val once = cekirdek.durumOkuma
        duvar += 3_599_999
        zaman.ilerle(3_599_999)
        assertEquals("erken yoklanmaz", once, cekirdek.durumOkuma)
        assertFalse(h.bitti)
        duvar += 1
        zaman.ilerle(1)
        assertTrue("yoklama çekirdeği çağırdı", cekirdek.durumOkuma > once)
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
