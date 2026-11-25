package dev.eren.ajanda.kimlik

import dev.eren.ajanda.cekirdek.AjandaKanalHatasi
import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.EslesmeDurumu
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Eşleştirme ekranının durum makinesi: her sonuç için gösterilen durum ve yürütülen komutlar.
 * Android çerçevesi yok; çekirdek yanıtları (`EslesmeDurumu`, `BaglantiDurumu`) elle verilir.
 */
class EslestirmeDurumuTest {
    private val T = 1_000L
    private val makine = EslestirmeMakinesi(zamanAsimiMs = T)

    @Suppress("UNCHECKED_CAST")
    private val qr = (Vektorler.kurallar()["qr"] as Map<String, Any?>)["gecerli"].let { (it as List<Map<String, Any?>>).single() }

    @Suppress("UNCHECKED_CAST")
    private val sohbetQr = ((Vektorler.kurallar()["qr"] as Map<String, Any?>)["gecersiz"] as List<Map<String, Any?>>)
        .single { it["ad"] == "eski QR (kanal yok)" }["qr"] as Map<String, Any?>

    private val parmakIzi = P256.parmakIzi(Base64.getDecoder().decode(qr["server_public_key"] as String))
    private val cikti = "${Json.yaz(qr)}\nParmak izi: $parmakIzi\nKod:ABCD2345  (5 dakika geçerli, tek kullanımlık)\n"

    private fun durum(e: EslesmeDurumu, b: BaglantiDurumu? = null, simdi: Long = 0) = Olay.DurumGeldi(e, b, simdi)

    private fun baglanti(asama: BaglantiAsamasi, sonHata: AjandaKanalHatasi? = null) =
        BaglantiDurumu(asama = asama, kuyrukta = 0, retListesinde = 0, sonEsitlenmeMs = null, sonHata = sonHata)

    private val eslesti = EslesmeDurumu.Eslesti("cihaz_AjandaOrnek01", "100.101.102.103", 8765)

    /** Yapıştırılmış ve kodu girilmiş giriş. */
    private fun doluGiris(kod: String = "abcd-2345"): EkranDurumu.Giris {
        var d: EkranDurumu = EkranDurumu.Giris()
        d = makine.isle(d, Olay.VeriDegisti(cikti)).durum
        d = makine.isle(d, Olay.KodDegisti(kod)).durum
        return d as EkranDurumu.Giris
    }

    /** Eşleştirmeye basılmış ve `eslestirmeBaslat` bitmiş hal. */
    private fun bekleyen(simdi: Long = 100): EkranDurumu.Baglaniyor {
        val g = makine.isle(doluGiris(), Olay.EslestirIstendi(simdi, agVar = true))
        val b = makine.isle(g.durum, Olay.BaslatmaBitti(null))
        return b.durum as EkranDurumu.Baglaniyor
    }

    // --- Açılış -------------------------------------------------------------------------------

    @Test
    fun acilistaEslesmeYoksaGiris() {
        val g = makine.isle(EkranDurumu.Yukleniyor(), durum(EslesmeDurumu.Yok))
        assertEquals(EkranDurumu.Giris(), g.durum)
        assertTrue(g.komutlar.isEmpty())
    }

    @Test
    fun acilistaEslesmisse() {
        val g = makine.isle(EkranDurumu.Yukleniyor(), durum(eslesti))
        assertEquals(EkranDurumu.Eslesti("cihaz_AjandaOrnek01", "100.101.102.103", 8765, yeni = false), g.durum)
    }

    @Test
    fun acilistaYarimEslestirmeBeklenir() {
        val g = makine.isle(
            EkranDurumu.Yukleniyor(),
            durum(EslesmeDurumu.Bekliyor("100.101.102.103", 8765), baglanti(BaglantiAsamasi.KOPUK), simdi = 50),
        )
        val d = g.durum as EkranDurumu.Baglaniyor
        assertTrue(d.baslatildi)
        assertEquals(50 + T, d.bitisMs)
        assertEquals(null, d.donus)
        assertEquals(listOf(Komut.BaglantiyiBaslat, Komut.ZamanlayiciKur(50 + T)), g.komutlar)
    }

    @Test
    fun acilistaEskiRetGosterilirYenidenDenemedeGosterilmez() {
        val ret = durum(EslesmeDurumu.Reddedildi(AjandaKanalHatasi.ESLESTIRME_KAPALI))
        assertEquals(
            EkranDurumu.Basarisiz(EslestirmeHatasi.PencereKapali, donus = EkranDurumu.Giris()),
            makine.isle(EkranDurumu.Yukleniyor(), ret).durum,
        )
        assertEquals(EkranDurumu.Giris(), makine.isle(EkranDurumu.Yukleniyor(reddiGoster = false), ret).durum)
    }

    @Test
    fun durumOkunamazsaCekirdekHatasiVeYenidenOkuma() {
        val b = makine.isle(EkranDurumu.Yukleniyor(), Olay.DurumOkunamadi("yazılmadı")).durum
        assertEquals(EkranDurumu.Basarisiz(EslestirmeHatasi.Cekirdek("yazılmadı"), donus = null), b)
        val y = makine.isle(b, Olay.YenidenDene)
        assertEquals(EkranDurumu.Yukleniyor(reddiGoster = false), y.durum)
        assertEquals(listOf(Komut.DurumuOku), y.komutlar)
    }

    // --- Giriş --------------------------------------------------------------------------------

    @Test
    fun yapistirVeKodGirinceEslestirilebilir() {
        val yalnizVeri = makine.isle(EkranDurumu.Giris(), Olay.VeriDegisti(cikti)).durum as EkranDurumu.Giris
        assertTrue(yalnizVeri.veri is VeriCozumu.Gecerli)
        assertEquals(KodHatasi.Bos, yalnizVeri.kodHatasi)
        assertFalse(yalnizVeri.eslestirilebilir)

        val dolu = doluGiris()
        assertEquals(null, dolu.kodHatasi)
        assertTrue(dolu.eslestirilebilir)

        // Kod önce, veri sonra girilse de aynı.
        var d: EkranDurumu = EkranDurumu.Giris()
        d = makine.isle(d, Olay.KodDegisti("ABCD2345")).durum
        assertEquals(null, (d as EkranDurumu.Giris).kodHatasi) // veri yokken yalnız biçim
        d = makine.isle(d, Olay.VeriDegisti(cikti)).durum
        assertTrue((d as EkranDurumu.Giris).eslestirilebilir)
    }

    @Test
    fun eslestirBaslatmaVeZamanlayici() {
        val g = makine.isle(doluGiris(), Olay.EslestirIstendi(simdiMs = 100, agVar = true))
        val d = g.durum as EkranDurumu.Baglaniyor
        assertEquals("100.101.102.103", d.host)
        assertEquals(parmakIzi, d.parmakIzi)
        assertFalse(d.baslatildi)
        assertEquals(doluGiris(), d.donus)
        val baslat = g.komutlar[0] as Komut.EslestirmeyiBaslat
        assertEquals("ABCD2345", baslat.qr.kod)
        assertEquals(Komut.ZamanlayiciKur(100 + T), g.komutlar[1])
    }

    @Test
    fun eksikYaDaYanlisGiristeEslestirmeOlmaz() {
        val bos = EkranDurumu.Giris()
        assertSame(bos, makine.isle(bos, Olay.EslestirIstendi(0, true)).durum)
        val yanlisKod = doluGiris(kod = "ABCD2346")
        assertEquals(KodHatasi.VeriyleUyusmuyor, yanlisKod.kodHatasi)
        val g = makine.isle(yanlisKod, Olay.EslestirIstendi(0, true))
        assertSame(yanlisKod, g.durum)
        assertTrue(g.komutlar.isEmpty())
    }

    @Test
    fun sohbetVerisiGiristeReddedilir() {
        val d = makine.isle(EkranDurumu.Giris(), Olay.VeriDegisti(Json.yaz(sohbetQr))).durum as EkranDurumu.Giris
        assertEquals(VeriCozumu.Hatali(VeriHatasi.BaskaKanal), d.veri)
        val k = makine.isle(d, Olay.KodDegisti("ABCD2345")).durum as EkranDurumu.Giris
        assertFalse(k.eslestirilebilir)
    }

    @Test
    fun agYoksaHemenAgYokVeVeriKorunur() {
        val giris = doluGiris()
        val b = makine.isle(giris, Olay.EslestirIstendi(0, agVar = false))
        assertEquals(EkranDurumu.Basarisiz(EslestirmeHatasi.AgYok, donus = giris), b.durum)
        assertTrue(b.komutlar.isEmpty())
        assertEquals(giris, makine.isle(b.durum, Olay.YenidenDene).durum)
    }

    // --- PC'nin sonucu ------------------------------------------------------------------------

    @Test
    fun baslatmaBitmedenGelenEskiDurumYokSayilir() {
        val g = makine.isle(doluGiris(), Olay.EslestirIstendi(100, true)).durum
        val eskiRet = durum(EslesmeDurumu.Reddedildi(AjandaKanalHatasi.ESLESTIRME_KODU_GECERSIZ))
        assertSame(g, makine.isle(g, eskiRet).durum)
        assertSame(g, makine.isle(g, durum(EslesmeDurumu.Yok)).durum)
        val b = makine.isle(g, Olay.BaslatmaBitti(null))
        assertTrue((b.durum as EkranDurumu.Baglaniyor).baslatildi)
        assertEquals(listOf(Komut.DurumuOku), b.komutlar)
    }

    @Test
    fun basari() {
        var d: EkranDurumu = bekleyen()
        d = makine.isle(d, durum(EslesmeDurumu.Bekliyor("100.101.102.103", 8765), baglanti(BaglantiAsamasi.ESLESTIRME))).durum
        assertEquals(BaglantiAsamasi.ESLESTIRME, (d as EkranDurumu.Baglaniyor).asama)
        d = makine.isle(d, durum(eslesti)).durum
        assertEquals(EkranDurumu.Eslesti("cihaz_AjandaOrnek01", "100.101.102.103", 8765, yeni = true), d)
    }

    @Test
    fun pcninRetleriAyriAyriGosterilir() {
        val beklenen = mapOf(
            AjandaKanalHatasi.ESLESTIRME_KODU_GECERSIZ to EslestirmeHatasi.YanlisKod,
            AjandaKanalHatasi.ESLESTIRME_KAPALI to EslestirmeHatasi.PencereKapali,
            AjandaKanalHatasi.KANAL_DESTEKLENMIYOR to EslestirmeHatasi.YanlisKanal,
            AjandaKanalHatasi.IP_UYUSMUYOR to EslestirmeHatasi.IpUyusmuyor,
            AjandaKanalHatasi.IC_HATA to EslestirmeHatasi.PcReddetti(AjandaKanalHatasi.IC_HATA),
            AjandaKanalHatasi.YETKISIZ to EslestirmeHatasi.PcReddetti(AjandaKanalHatasi.YETKISIZ),
        )
        for ((kod, hata) in beklenen) {
            val d = makine.isle(bekleyen(), durum(EslesmeDurumu.Reddedildi(kod))).durum
            // Kod tek kullanımlık ve pencere değişmiş olabilir: yeniden denemede boş giriş (yeni çıktı).
            assertEquals(kod.name, EkranDurumu.Basarisiz(hata, donus = EkranDurumu.Giris()), d)
        }
        // Her kanal hatası bir sonuca eşlenir (kapalı liste genişlerse burada kalmaz).
        AjandaKanalHatasi.values().forEach { assertNotNull(EslestirmeMakinesi.hataKoddan(it)) }
    }

    @Test
    fun zamanAsimiAgVeTailscaleyeGoreAyrilir() {
        val d = bekleyen(simdi = 100)
        val bitis = d.bitisMs
        // Erken (eski) zamanlayıcı: değişmez.
        assertSame(d, makine.isle(d, Olay.ZamanDoldu(bitis - 1, agVar = true, tailscaleVar = true)).durum)
        assertEquals(
            EkranDurumu.Basarisiz(EslestirmeHatasi.AgYok, donus = d.donus),
            makine.isle(d, Olay.ZamanDoldu(bitis, agVar = false, tailscaleVar = false)).durum,
        )
        assertEquals(
            EkranDurumu.Basarisiz(EslestirmeHatasi.PcyeUlasilamadi(false, null, null), donus = d.donus),
            makine.isle(d, Olay.ZamanDoldu(bitis, agVar = true, tailscaleVar = false)).durum,
        )
        val yanitBekleyen = makine.isle(
            d,
            durum(EslesmeDurumu.Bekliyor("100.101.102.103", 8765), baglanti(BaglantiAsamasi.ESLESTIRME, AjandaKanalHatasi.ZAMAN_ASIMI)),
        ).durum
        val sonuc = makine.isle(yanitBekleyen, Olay.ZamanDoldu(bitis + 5, agVar = true, tailscaleVar = true)).durum
        assertEquals(
            EkranDurumu.Basarisiz(
                EslestirmeHatasi.PcyeUlasilamadi(true, BaglantiAsamasi.ESLESTIRME, AjandaKanalHatasi.ZAMAN_ASIMI),
                donus = d.donus,
            ),
            sonuc,
        )
        // Veri hâlâ geçerli olabilir: yeniden dene aynı girişe döner.
        assertEquals(doluGiris(), makine.isle(sonuc, Olay.YenidenDene).durum)
        // Zaman aşımından sonra arka planda tamamlanırsa başarı gösterilir.
        assertEquals(
            EkranDurumu.Eslesti("cihaz_AjandaOrnek01", "100.101.102.103", 8765, yeni = true),
            makine.isle(sonuc, durum(eslesti)).durum,
        )
    }

    @Test
    fun kesinRettenSonraGecEslesmeGosterilmez() {
        val b = EkranDurumu.Basarisiz(EslestirmeHatasi.YanlisKod, donus = EkranDurumu.Giris())
        assertSame(b, makine.isle(b, durum(eslesti)).durum)
    }

    @Test
    fun baslatmaHatasiVeVazgec() {
        val g = makine.isle(doluGiris(), Olay.EslestirIstendi(0, true)).durum as EkranDurumu.Baglaniyor
        assertEquals(
            EkranDurumu.Basarisiz(EslestirmeHatasi.Cekirdek("depo"), donus = g.donus),
            makine.isle(g, Olay.BaslatmaBitti("depo")).durum,
        )
        assertEquals(g.donus, makine.isle(g, Olay.Vazgec).durum)
    }

    // --- Eşleşmiş: kaldırma -------------------------------------------------------------------

    @Test
    fun eslesmeyiKaldirma() {
        val e = EkranDurumu.Eslesti("cihaz_AjandaOrnek01", "100.101.102.103", 8765, yeni = false)
        val k = makine.isle(e, Olay.KaldirmaOnaylandi)
        assertEquals(EkranDurumu.Kaldiriliyor("cihaz_AjandaOrnek01"), k.durum)
        assertEquals(listOf(Komut.EslesmeyiKaldir), k.komutlar)
        assertEquals(
            EkranDurumu.Giris(bilgi = Bilgi.Kaldirildi("cihaz_AjandaOrnek01")),
            makine.isle(k.durum, Olay.KaldirmaBitti(null)).durum,
        )
        val hata = makine.isle(k.durum, Olay.KaldirmaBitti("depo")).durum
        assertEquals(EkranDurumu.Basarisiz(EslestirmeHatasi.Cekirdek("depo"), donus = null), hata)
        // Başka yerden kaldırıldıysa girişe.
        assertEquals(EkranDurumu.Giris(), makine.isle(e, durum(EslesmeDurumu.Yok)).durum)
    }

    @Test
    fun dondurmedeYenidenKurma() {
        val g = makine.isle(doluGiris(), Olay.EslestirIstendi(100, true)).durum as EkranDurumu.Baglaniyor
        val y = makine.yenidenKur(g)
        assertEquals(g.copy(baslatildi = true), y.durum)
        assertEquals(listOf(Komut.ZamanlayiciKur(g.bitisMs)), y.komutlar)
        assertEquals(EkranDurumu.Yukleniyor(reddiGoster = false), makine.yenidenKur(EkranDurumu.Kaldiriliyor("x")).durum)
        val giris = doluGiris()
        assertSame(giris, makine.yenidenKur(giris).durum)
    }

    // --- Metinler ve sızıntı ------------------------------------------------------------------

    @Test
    fun metinlerKoduVeVeriyiSizdirmaz() {
        val giris = doluGiris()
        val olaylar = listOf(Olay.VeriDegisti(cikti), Olay.KodDegisti("ABCD2345"))
        val metinler = listOf(giris.toString(), giris.veri.toString()) + olaylar.map { it.toString() } +
            makine.isle(giris, Olay.EslestirIstendi(0, true)).let { g -> g.komutlar.map { it.toString() } + g.durum.toString() }
        for (m in metinler) assertFalse(m, m.contains("ABCD2345") || m.contains("abcd-2345"))
    }

    @Test
    fun herSonucunAnlasilirMetniVar() {
        val hatalar = listOf(
            EslestirmeHatasi.YanlisKod, EslestirmeHatasi.PencereKapali, EslestirmeHatasi.YanlisKanal,
            EslestirmeHatasi.IpUyusmuyor, EslestirmeHatasi.AgYok,
            EslestirmeHatasi.PcyeUlasilamadi(false, null, null),
            EslestirmeHatasi.PcyeUlasilamadi(true, BaglantiAsamasi.ESLESTIRME, AjandaKanalHatasi.ZAMAN_ASIMI),
            EslestirmeHatasi.PcyeUlasilamadi(true, BaglantiAsamasi.KOPUK, null),
            EslestirmeHatasi.PcReddetti(AjandaKanalHatasi.IC_HATA), EslestirmeHatasi.Cekirdek("x"),
        )
        val basliklar = hatalar.map { EslestirmeMetinleri.hata(it) }.onEach { (b, a) ->
            assertTrue(b.isNotBlank() && a.isNotBlank())
        }.map { it.first }
        // Ayrı sonuçlar ayrı başlıkla görünür.
        assertEquals(basliklar.size, basliklar.toSet().size)
        assertTrue(EslestirmeMetinleri.hata(EslestirmeHatasi.PcReddetti(AjandaKanalHatasi.IC_HATA)).second.contains("ic_hata"))
        assertTrue(EslestirmeMetinleri.veriHatasi(VeriHatasi.BaskaKanal).contains("--ajanda"))
        assertTrue(EslestirmeMetinleri.bilgi(Bilgi.Kaldirildi("cihaz_X")).contains("--kaldir cihaz_X"))
    }
}
