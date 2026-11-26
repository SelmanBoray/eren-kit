package dev.eren.ajanda.ekran

import dev.eren.ajanda.alarm.HatirlatmaDurumu
import dev.eren.ajanda.alarm.HatirlatmaSorunu
import dev.eren.ajanda.alarm.IzinOlgulari
import dev.eren.ajanda.alarm.KayitliSorunlar
import dev.eren.ajanda.cekirdek.AjandaKanalHatasi
import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.EslesmeDurumu
import dev.eren.ajanda.cekirdek.SurumUyusmazligi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class DurumGostergesiTest {
    private val dilim = ZoneId.of("Europe/Istanbul")
    private val simdi = ZonedDateTime.of(2026, 11, 26, 10, 0, 0, 0, dilim).toInstant().toEpochMilli()
    private val eslesti = EslesmeDurumu.Eslesti("d_ornek", "100.101.102.103", 8765)

    private fun b(asama: BaglantiAsamasi, kuyrukta: Int = 0, son: Long? = null, hata: AjandaKanalHatasi? = null, surum: SurumUyusmazligi? = null) =
        BaglantiDurumu(asama, kuyrukta, 0, son, hata, surum)

    private fun g(e: EslesmeDurumu?, bd: BaglantiDurumu?, adres: Boolean = true, hata: String? = null) =
        DurumGostergesi.hesapla(e, bd, adres, simdi, dilim, hata)

    @Test
    fun eslesmeDurumlari() {
        assertEquals("…", g(null, null).kisa)
        val yok = g(EslesmeDurumu.Yok, b(BaglantiAsamasi.KOPUK, kuyrukta = 2), adres = false)
        assertEquals("Eşleşmedi" to DurumGostergesi.Eylem.ESLESTIR, yok.kisa to yok.eylem)
        assertTrue(yok.ayrinti, yok.ayrinti.contains("2 değişiklik PC'ye gönderilmeyi bekliyor"))
        assertEquals("Eşleştiriliyor", g(EslesmeDurumu.Bekliyor("100.101.102.103", 8765), null, adres = true).kisa)
        val red = g(EslesmeDurumu.Reddedildi(AjandaKanalHatasi.ESLESTIRME_KODU_GECERSIZ), b(BaglantiAsamasi.KOPUK), adres = false)
        assertEquals("Eşleşme reddedildi" to DurumGostergesi.Eylem.ESLESTIR, red.kisa to red.eylem)
        assertTrue(red.ayrinti.contains("Eşleştirme kodu geçersiz."))
        // Eski eşleşme dururken yeni QR reddedildi: bağlantı eskisiyle sürer.
        val eskiyle = g(EslesmeDurumu.Reddedildi(AjandaKanalHatasi.ESLESTIRME_KODU_GECERSIZ), b(BaglantiAsamasi.CANLI), adres = true)
        assertEquals("Bağlı", eskiyle.kisa)
        assertTrue(eskiyle.ayrinti.contains("önceki eşleşme sürüyor"))
    }

    @Test
    fun baglantiAsamalari() {
        assertEquals("Bağlı" to DurumGostergesi.Ton.IYI, g(eslesti, b(BaglantiAsamasi.CANLI)).let { it.kisa to it.ton })
        assertEquals("Bağlı · 3 gönderiliyor", g(eslesti, b(BaglantiAsamasi.CANLI, kuyrukta = 3)).kisa)
        assertEquals("Eşitleniyor…", g(eslesti, b(BaglantiAsamasi.TELAFI)).kisa)
        assertEquals("Bağlanıyor…", g(eslesti, b(BaglantiAsamasi.EL_SIKISMA)).kisa)
        assertEquals("Bağlanıyor…", g(eslesti, b(BaglantiAsamasi.ESLESTIRME)).kisa)
        assertEquals("…", g(eslesti, null).kisa)
    }

    @Test
    fun cevrimdisiSonEsitlemeVeKuyruk() {
        val besDk = simdi - 5 * 60_000
        val c = g(eslesti, b(BaglantiAsamasi.KOPUK, kuyrukta = 1, son = besDk))
        assertEquals("Çevrimdışı · 1 bekliyor" to DurumGostergesi.Ton.CEVRIMDISI, c.kisa to c.ton)
        assertTrue(c.ayrinti, c.ayrinti.contains("Son eşitleme: 5 dk önce."))
        assertTrue(c.ayrinti.contains("hatırlatmalar PC'den bağımsız çalar"))
        val hic = g(eslesti, b(BaglantiAsamasi.KOPUK))
        assertEquals("Çevrimdışı", hic.kisa)
        assertTrue(hic.ayrinti.contains("Henüz hiç eşitlenmedi."))
        assertTrue(hic.ayrinti.contains("Gönderilmeyi bekleyen değişiklik yok."))
        val dun = g(eslesti, b(BaglantiAsamasi.KOPUK, son = simdi - 20 * 3_600_000L))
        assertTrue(dun.ayrinti, dun.ayrinti.contains("Son eşitleme: dün 14:00."))
    }

    @Test
    fun kanalHatasiYenidenEslestirmeIsteyebilir() {
        val tanimiyor = g(eslesti, b(BaglantiAsamasi.KOPUK, hata = AjandaKanalHatasi.CIHAZ_BILINMIYOR))
        assertEquals("PC tanımıyor" to DurumGostergesi.Eylem.ESLESTIR, tanimiyor.kisa to tanimiyor.eylem)
        assertEquals(DurumGostergesi.Ton.UYARI, tanimiyor.ton)
        val gecici = g(eslesti, b(BaglantiAsamasi.KOPUK, hata = AjandaKanalHatasi.ZAMAN_ASIMI))
        assertEquals("Çevrimdışı" to DurumGostergesi.Eylem.YOK, gecici.kisa to gecici.eylem)
        assertTrue(gecici.ayrinti.contains("Son hata: PC zamanında yanıt vermedi."))
        assertEquals("Okunamadı", g(eslesti, null, hata = "x").kisa)
        // Bütün kanal hatalarının metni var.
        AjandaKanalHatasi.values().forEach { assertTrue(EkranMetinleri.kanalHatasi(it).first.isNotBlank()) }
    }

    private fun olgu(
        bildirimIzni: Boolean = true,
        acik: Boolean = true,
        kanal: Boolean = true,
        kacirilan: Boolean = true,
        kesin: Boolean = true,
        kisitli: Boolean = false,
        muaf: Boolean = true,
    ) = IzinOlgulari(34, bildirimIzni, acik, kanal, kacirilan, kesin, kisitli, muaf)

    @Test
    fun hatirlatmaUyarilari() {
        val temiz = HatirlatmaDurumu.hesapla(olgu(), KayitliSorunlar())
        assertNull(HatirlatmaUyarilari.serit(temiz))
        assertTrue(HatirlatmaUyarilari.uyarilar(temiz).isEmpty())

        val izin = HatirlatmaDurumu.hesapla(olgu(bildirimIzni = false, kesin = false), KayitliSorunlar())
        val s = HatirlatmaUyarilari.serit(izin)!!
        assertEquals(HatirlatmaSorunu.BILDIRIM_IZNI_YOK to HatirlatmaUyarilari.Cozum.IZIN_ISTE, s.sorun to s.cozum)
        assertEquals("Bildirim izni yok (+1 sorun)", HatirlatmaUyarilari.seritMetni(izin))

        // Pil optimizasyonu yalnız bilgi: şeride çıkmaz, pencerede görünür.
        val pil = HatirlatmaDurumu.hesapla(olgu(muaf = false), KayitliSorunlar())
        assertNull(HatirlatmaUyarilari.serit(pil))
        assertEquals(listOf(HatirlatmaSorunu.PIL_OPTIMIZASYONU), HatirlatmaUyarilari.uyarilar(pil).map { it.sorun })

        val kayitli = HatirlatmaDurumu.hesapla(olgu(), KayitliSorunlar(gosterilemeyenSayisi = 2, gosterilemeyenKayitlar = listOf("k_1", "k_2")))
        val u = HatirlatmaUyarilari.serit(kayitli)!!
        assertEquals(HatirlatmaUyarilari.Cozum.GORULDU, u.cozum)
        assertTrue(u.aciklama.startsWith("2 hatırlatma"))

        // Her sorunun bir metni ve çözüm yolu var.
        val hepsi = HatirlatmaDurumu.hesapla(
            olgu(acik = true, kanal = false, kacirilan = false, kesin = false, kisitli = true, muaf = false),
            KayitliSorunlar(kurulamayanSayisi = 1, gosterilemeyenSayisi = 1, cekirdekHatasiSayisi = 1),
        )
        val uyarilar = HatirlatmaUyarilari.uyarilar(hepsi)
        assertEquals(hepsi.sorunlar, uyarilar.map { it.sorun })
        uyarilar.forEach { assertTrue(it.baslik.isNotBlank() && it.dugme.isNotBlank()) }
        assertEquals(
            setOf(HatirlatmaSorunu.KACIRILAN_KANALI_KAPALI, HatirlatmaSorunu.PIL_OPTIMIZASYONU),
            uyarilar.filter { !it.engel }.map { it.sorun }.toSet(),
        )
    }

    @Test
    fun surumUyusmazligiGuncelleDerYonuSoyler() {
        val es = EslesmeDurumu.Eslesti("c", "100.64.0.1", 8787)
        fun g(s: SurumUyusmazligi) = DurumGostergesi.hesapla(
            es, b(BaglantiAsamasi.KOPUK, kuyrukta = 2, hata = AjandaKanalHatasi.PROTOKOL_UYUMSUZ, surum = s), true, 0, ZoneId.of("UTC"),
        )
        val servis = g(SurumUyusmazligi.SERVIS_ESKI)
        assertEquals("PC'yi güncelleyin", servis.kisa)
        assertEquals(DurumGostergesi.Ton.UYARI, servis.ton)
        assertEquals("yeniden eşleştirme istenmez", DurumGostergesi.Eylem.YOK, servis.eylem)
        assertTrue(servis.ayrinti.contains("eski") && servis.ayrinti.contains("2 değişiklik"))
        assertEquals("Uygulamayı güncelleyin", g(SurumUyusmazligi.UYGULAMA_ESKI).kisa)
        assertEquals("Sürüm uyuşmuyor", g(SurumUyusmazligi.BILINMIYOR).kisa)
        // Yeniden denenirken (el sıkışma) sıradan "bağlanıyor".
        val dene = DurumGostergesi.hesapla(es, b(BaglantiAsamasi.EL_SIKISMA, surum = SurumUyusmazligi.SERVIS_ESKI), true, 0, ZoneId.of("UTC"))
        assertEquals("Bağlanıyor…", dene.kisa)
    }
}
