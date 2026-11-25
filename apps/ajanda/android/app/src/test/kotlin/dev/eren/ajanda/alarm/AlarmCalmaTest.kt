package dev.eren.ajanda.alarm

import dev.eren.ajanda.alarm.AlarmCalmaIsleyici.Sonuc
import dev.eren.ajanda.cekirdek.HatirlatmaBildirimi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.Executor

class AlarmCalmaTest {
    private val sorulan = mutableListOf<Long>()
    private val bildirici = SahteBildirici()
    private val sorunlar = BellekSorunKaydi { 1L }

    private fun isleyici(yanit: (Long) -> HatirlatmaBildirimi?) =
        AlarmCalmaIsleyici({ sorulan += it; yanit(it) }, bildirici, sorunlar)

    @Test
    fun calan_alarm_cekirdege_numarasiyla_sorulur_ve_yanit_gosterilir() {
        val b = bildirim(12)
        assertEquals(Sonuc.GOSTERILDI, isleyici { b }.isle(12))
        assertEquals(listOf(12L), sorulan)
        assertEquals(listOf(b), bildirici.hatirlatmalar)
        assertTrue(sorunlar.oku().bos)
    }

    @Test
    fun bos_yanitta_hicbir_sey_gosterilmez() {
        assertEquals(Sonuc.SUSTU, isleyici { null }.isle(5))
        assertEquals(listOf(5L), sorulan)
        assertTrue(bildirici.hatirlatmalar.isEmpty() && bildirici.ozetler.isEmpty() && bildirici.ayrintisizlar.isEmpty())
        assertTrue(sorunlar.oku().bos)
    }

    @Test
    fun numarasiz_niyet_cekirdege_gitmez() {
        assertEquals(Sonuc.GECERSIZ_NUMARA, isleyici { bildirim(1) }.isle(-1))
        assertTrue(sorulan.isEmpty() && bildirici.hatirlatmalar.isEmpty())
    }

    @Test
    fun bildirim_izni_yokken_gosterilemeyen_kaydedilir_ve_durumda_gorunur() {
        bildirici.gosterebilir = false
        assertEquals(Sonuc.GOSTERILEMEDI, isleyici { bildirim(8) }.isle(8))
        assertEquals(listOf("k_8"), sorunlar.oku().gosterilemeyenKayitlar)
        val d = HatirlatmaDurumu.hesapla(iyiOlgular().copy(bildirimIzni = false), sorunlar.oku())
        assertEquals(
            listOf(HatirlatmaSorunu.BILDIRIM_IZNI_YOK, HatirlatmaSorunu.GOSTERILEMEYEN_HATIRLATMA),
            d.sorunlar,
        )
        assertTrue(d.engelVar)
    }

    @Test
    fun bildirici_istisnasi_da_gosterilemedi_sayilir() {
        bildirici.firlat = SecurityException("izin")
        assertEquals(Sonuc.GOSTERILEMEDI, isleyici { bildirim(2) }.isle(2))
        assertEquals(1, sorunlar.oku().gosterilemeyenSayisi)
    }

    @Test
    fun cekirdek_hatasinda_ayrintisiz_hatirlatma_ve_kayit() {
        assertEquals(Sonuc.CEKIRDEK_HATASI, isleyici { throw IllegalStateException("db") }.isle(4))
        assertEquals(listOf(4L), bildirici.ayrintisizlar)
        assertEquals(1, sorunlar.oku().cekirdekHatasiSayisi)
        // Bildirim de gösterilemiyorsa o da sayılır.
        bildirici.gosterebilir = false
        isleyici { throw UnsatisfiedLinkError("so") }.isle(6)
        assertEquals(2, sorunlar.oku().cekirdekHatasiSayisi)
        assertEquals(1, sorunlar.oku().gosterilemeyenSayisi)
    }

    @Test
    fun is_parcacigi_hata_olsa_da_yayini_bitirir() {
        val hemen = Executor { it.run() }
        var bitti = 0
        val hatalar = mutableListOf<Throwable>()
        AlarmIsParcacigi.calistir(hemen, { bitti++ }, { hatalar += it }) { throw IllegalStateException("x") }
        AlarmIsParcacigi.calistir(hemen, { bitti++ }, { hatalar += it }) {}
        val reddeden = Executor { throw java.util.concurrent.RejectedExecutionException() }
        AlarmIsParcacigi.calistir(reddeden, { bitti++ }, { hatalar += it }) {}
        assertEquals(3, bitti)
        assertEquals(2, hatalar.size)
    }
}
