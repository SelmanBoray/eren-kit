package dev.eren.ajanda.alarm

import dev.eren.ajanda.alarm.AlarmPlanlayici.KurmaYolu
import dev.eren.ajanda.cekirdek.KabukHatasi
import dev.eren.ajanda.cekirdek.KacirilanBildirimi
import dev.eren.ajanda.cekirdek.KayitTuru
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class AlarmPlanlayiciTest {
    private val sistem = SahteAlarmSistemi()
    private val bildirici = SahteBildirici()
    private val sorunlar = BellekSorunKaydi { 42L }
    private val planlayici = AlarmPlanlayici(sistem, bildirici, sorunlar)

    @Test
    fun kur_istek_kodu_alarm_numarasidir_ve_tetik_aynen_gider() {
        planlayici.kur(alarm(7, tetik = 1_795_606_200_000))
        assertEquals(setOf(7), sistem.kurulu.keys)
        assertEquals(SahteAlarmSistemi.Kurulum(7, 1_795_606_200_000, KurmaYolu.KESIN), sistem.kurulu[7])
    }

    @Test
    fun ayni_numara_ikinci_kez_kurulunca_yerine_gecer_cift_alarm_olmaz() {
        planlayici.kur(alarm(3, tetik = 100))
        planlayici.kur(alarm(3, tetik = 200))
        planlayici.kur(alarm(4, tetik = 300))
        assertEquals(2, sistem.kurulu.size)
        assertEquals(200L, sistem.kurulu[3]!!.tetikMs)
        // Kurulum ve iptal aynı kodu kullanır.
        planlayici.iptal(3)
        assertEquals(setOf(4), sistem.kurulu.keys)
        assertEquals(listOf("kur 3 KESIN", "kur 3 KESIN", "kur 4 KESIN", "iptal 3"), sistem.cagrilar)
    }

    @Test
    fun bilinmeyen_numarayi_iptal_etmek_sessiz_ve_zararsizdir() {
        planlayici.kur(alarm(1))
        planlayici.iptal(99)
        assertEquals(setOf(1), sistem.kurulu.keys)
        assertTrue(sorunlar.oku().bos)
    }

    @Test
    fun strateji_randevuya_calar_saat_otekilerine_kesin() {
        assertEquals(KurmaYolu.CALAR_SAAT, AlarmPlanlayici.yolSec(KayitTuru.RANDEVU, kesinIzni = true))
        assertEquals(KurmaYolu.KESIN, AlarmPlanlayici.yolSec(KayitTuru.GOREV, kesinIzni = true))
        assertEquals(KurmaYolu.KESIN, AlarmPlanlayici.yolSec(KayitTuru.NOT, kesinIzni = true))
        for (t in KayitTuru.entries) assertEquals(KurmaYolu.GEVSEK, AlarmPlanlayici.yolSec(t, kesinIzni = false))
        planlayici.kur(alarm(1, tur = KayitTuru.RANDEVU))
        assertEquals(KurmaYolu.CALAR_SAAT, sistem.kurulu[1]!!.yol)
    }

    @Test
    fun kesin_izin_yokken_gevsek_kurulur_hata_degildir_ve_durumda_gorunur() {
        sistem.kesinIzin = false
        planlayici.kur(alarm(5, tur = KayitTuru.RANDEVU))
        assertEquals(KurmaYolu.GEVSEK, sistem.kurulu[5]!!.yol)
        assertTrue(sorunlar.oku().bos)
        val d = HatirlatmaDurumu.hesapla(iyiOlgular().copy(kesinAlarmIzni = false), sorunlar.oku())
        assertEquals(listOf(HatirlatmaSorunu.KESIN_ALARM_IZNI_YOK), d.sorunlar)
        assertTrue(d.engelVar)
    }

    @Test
    fun izin_kurma_aninda_geri_alinmissa_gevsek_yola_duser() {
        sistem.kesinYolReddet = true
        planlayici.kur(alarm(2, tur = KayitTuru.RANDEVU))
        assertEquals(KurmaYolu.GEVSEK, sistem.kurulu[2]!!.yol)
        assertEquals(listOf("kur 2 CALAR_SAAT", "kur 2 GEVSEK"), sistem.cagrilar)
    }

    @Test
    fun kurulamayan_alarm_cekirdege_hata_doner_ve_kaydedilir() {
        sistem.kurHatasi = IllegalStateException("500 alarm")
        try {
            planlayici.kur(alarm(9))
            fail("KabukHatasi bekleniyordu")
        } catch (e: KabukHatasi.Basarisiz) {
            assertTrue(e.mesaj, e.mesaj.contains("IllegalStateException"))
        }
        assertEquals(1, sorunlar.oku().kurulamayanSayisi)
        assertTrue(sistem.kurulu.isEmpty())
        val d = HatirlatmaDurumu.hesapla(iyiOlgular(), sorunlar.oku())
        assertEquals(listOf(HatirlatmaSorunu.KURULAMAYAN_ALARM), d.sorunlar)
    }

    @Test
    fun int_e_sigmayan_numara_baska_alarmin_kodunu_almaz() {
        for (no in listOf(-1L, Int.MAX_VALUE.toLong() + 1)) {
            try {
                planlayici.kur(alarm(no))
                fail("hata bekleniyordu: $no")
            } catch (_: KabukHatasi.Basarisiz) {
            }
        }
        assertTrue(sistem.kurulu.isEmpty())
        assertEquals(Int.MAX_VALUE, AlarmPlanlayici.istekKodu(Int.MAX_VALUE.toLong()))
    }

    @Test
    fun kacirilanlar_tek_bildirimde_gosterilir() {
        planlayici.kacirilanlariGoster(KacirilanBildirimi(listOf(bildirim(1), bildirim(2), bildirim(3))))
        assertEquals(1, bildirici.ozetler.size)
        assertEquals(listOf(1L, 2L, 3L), bildirici.ozetler[0].map { it.alarmNo })
        // Tek satır da aynı yoldan (tek özet bildirimi).
        planlayici.kacirilanlariGoster(KacirilanBildirimi(listOf(bildirim(4))))
        assertEquals(2, bildirici.ozetler.size)
        // Boş özet bildirim üretmez.
        planlayici.kacirilanlariGoster(KacirilanBildirimi(emptyList()))
        assertEquals(2, bildirici.ozetler.size)
        assertTrue(sorunlar.oku().bos)
    }

    @Test
    fun kacirilan_gosterilemezse_kayit_kimlikleri_saklanir_ve_cekirdege_hata_doner() {
        bildirici.gosterebilir = false
        gosterilemediBekle { planlayici.kacirilanlariGoster(KacirilanBildirimi(listOf(bildirim(1), bildirim(2)))) }
        assertEquals(listOf("k_1", "k_2"), sorunlar.oku().gosterilemeyenKayitlar)
        assertEquals(2, sorunlar.oku().gosterilemeyenSayisi)
        bildirici.gosterebilir = true
        bildirici.firlat = SecurityException("bildirim")
        gosterilemediBekle { planlayici.kacirilanlariGoster(KacirilanBildirimi(listOf(bildirim(3)))) }
        assertEquals(3, sorunlar.oku().gosterilemeyenSayisi)
    }

    /** Çekirdek teslim işaretini ancak hata görürse kaldırır (MIMARI.md R4, K3). */
    private inline fun gosterilemediBekle(blok: () -> Unit) {
        try {
            blok()
            fail("KabukHatasi bekleniyordu")
        } catch (e: KabukHatasi.Basarisiz) {
            assertTrue(e.mesaj, e.mesaj.contains("gösterilemedi"))
        }
    }
}

fun iyiOlgular() = IzinOlgulari(
    sdk = 34, bildirimIzni = true, bildirimlerAcik = true, hatirlatmaKanaliAcik = true, kacirilanKanaliAcik = true,
    kesinAlarmIzni = true, arkaPlanKisitli = false, pilOptimizasyonundanMuaf = true,
)
