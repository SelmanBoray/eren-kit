package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Duman testi: sözleşme tiplerinin derlendiğini ve kapalı listeler ile `Sinirlar`'ın
 * protocol kaynağıyla (`cihaz.ts`, `temel.ts`, `sinirlar.ts`) birebir aynı olduğunu sınar. Davranış sınamaz; onu birim
 * dosyalarının kendi testleri yapar. `protocol` yolu `eren.depo` sistem özelliğinden gelir.
 */
class SozlesmeTest {
    private val depo: File = File(System.getProperty("eren.depo")).canonicalFile
    private val cihazTs: String get() = File(depo, "protocol/src/cihaz.ts").readText()
    private val temelTs: String get() = File(depo, "protocol/src/temel.ts").readText()
    private val sinirlarTs: String get() = File(depo, "protocol/src/sinirlar.ts").readText()

    /** `AD = [ ... ] as const;` içindeki çift tırnaklı dizeleri sırayla çıkarır. */
    private fun diziDegerleri(kaynak: String, ad: String): List<String> {
        val bas = Regex("""(?:export )?const $ad = \[""").find(kaynak)
            ?: error("$ad bulunamadı")
        val kalan = kaynak.substring(bas.range.last + 1)
        val son = kalan.indexOf("] as const")
        assertTrue(son > 0, "$ad kapanışı bulunamadı")
        return Regex(""""([^"]*)"""").findAll(kalan.substring(0, son))
            .map { it.groupValues[1] }
            .toList()
    }

    private fun <T> kablolar(degerler: Array<T>, al: (T) -> String): List<String> =
        degerler.map(al)

    @Test
    fun `kapali listeler protocol ile ayni`() {
        assertEquals(
            diziDegerleri(cihazTs, "CMD_ADLARI"),
            kablolar(CmdAdi.entries.toTypedArray()) { it.kablo },
            "CmdAdi",
        )
        assertEquals(
            diziDegerleri(cihazTs, "KEY_ADLARI"),
            kablolar(Tus.entries.toTypedArray()) { it.kablo },
            "Tus",
        )
        assertEquals(
            diziDegerleri(cihazTs, "SCROLL_YONLERI"),
            kablolar(KaydirmaYonu.entries.toTypedArray()) { it.kablo },
            "KaydirmaYonu",
        )
        assertEquals(
            diziDegerleri(cihazTs, "DENIED_NEDENLERI"),
            kablolar(DeniedNeden.entries.toTypedArray()) { it.kablo },
            "DeniedNeden",
        )
        assertEquals(
            diziDegerleri(cihazTs, "CIHAZ_HATALARI"),
            kablolar(CihazHatasi.entries.toTypedArray()) { it.kablo },
            "CihazHatasi",
        )
        assertEquals(
            diziDegerleri(cihazTs, "GRANT_NEDENLERI"),
            kablolar(GrantNedeni.entries.toTypedArray()) { it.kablo },
            "GrantNedeni",
        )
        assertEquals(
            diziDegerleri(cihazTs, "UYGULAMA_DURUMLARI"),
            kablolar(UygulamaDurumu.entries.toTypedArray()) { it.kablo },
            "UygulamaDurumu",
        )
    }

    @Test
    fun `IzinModu protocol ile ayni`() {
        // temel.ts: z.enum(["oku", "yaz"])
        val eslesme = Regex("""IzinModu = z\.enum\(\[([^\]]*)\]""").find(temelTs)
            ?: error("IzinModu bulunamadı")
        val beklenen = Regex(""""([^"]*)"""").findAll(eslesme.groupValues[1])
            .map { it.groupValues[1] }.toList()
        assertEquals(beklenen, kablolar(IzinModu.entries.toTypedArray()) { it.kablo })
    }

    @Test
    fun `PROTOKOL_SURUMU protocol ile ayni`() {
        val eslesme = Regex("""PROTOKOL_SURUMU = (\d+)""").find(sinirlarTs)
            ?: error("PROTOKOL_SURUMU bulunamadı")
        assertEquals(eslesme.groupValues[1].toInt(), PROTOKOL_SURUMU)
    }

    @Test
    fun `Sinirlar protocol ile ayni`() {
        val ts = sinirlarDegerleri()
        val bizim = sinirlarHaritasi()
        // Her TS sınırının Kotlin karşılığı var ve eşit.
        for ((ad, deger) in ts) {
            val bizdeki = bizim[ad] ?: error("Sinirlar.$ad Kotlin'de yok")
            assertEquals(deger, bizdeki, "Sinirlar.$ad")
        }
        assertEquals(ts.keys, bizim.keys, "sınır anahtar kümeleri")
    }

    /** `sinirlar.ts`'teki `SINIRLAR = { ... }` bloğunu ad -> sayı olarak çözer; `a * b` çarpımını hesaplar. */
    private fun sinirlarDegerleri(): Map<String, Int> {
        val bas = sinirlarTs.indexOf("export const SINIRLAR = {")
        val son = sinirlarTs.indexOf("} as const;", bas)
        val govde = sinirlarTs.substring(bas, son)
        val harita = LinkedHashMap<String, Int>()
        for (m in Regex("""^\s*([A-Z0-9_]+):\s*([0-9_* ]+?),""", RegexOption.MULTILINE).findAll(govde)) {
            val ad = m.groupValues[1]
            val ifade = m.groupValues[2].replace("_", "").replace(" ", "")
            val deger = ifade.split("*").map { it.toInt() }.reduce(Int::times)
            harita[ad] = deger
        }
        return harita
    }

    private fun sinirlarHaritasi(): Map<String, Int> = linkedMapOf(
        "OPAK_ID" to Sinirlar.OPAK_ID,
        "JETON_MIN" to Sinirlar.JETON_MIN,
        "JETON_MAX" to Sinirlar.JETON_MAX,
        "NONCE_MIN" to Sinirlar.NONCE_MIN,
        "NONCE_MAX" to Sinirlar.NONCE_MAX,
        "ACIK_ANAHTAR_MAX" to Sinirlar.ACIK_ANAHTAR_MAX,
        "IMZA_MAX" to Sinirlar.IMZA_MAX,
        "ESLESTIRME_KODU_MIN" to Sinirlar.ESLESTIRME_KODU_MIN,
        "ESLESTIRME_KODU_MAX" to Sinirlar.ESLESTIRME_KODU_MAX,
        "CIHAZ_ETIKETI" to Sinirlar.CIHAZ_ETIKETI,
        "HATA_DETAYI" to Sinirlar.HATA_DETAYI,
        "YOL_SAYISI" to Sinirlar.YOL_SAYISI,
        "YOL_UZUNLUGU" to Sinirlar.YOL_UZUNLUGU,
        "KULLANICI_METNI" to Sinirlar.KULLANICI_METNI,
        "ASISTAN_METNI" to Sinirlar.ASISTAN_METNI,
        "DELTA_METNI" to Sinirlar.DELTA_METNI,
        "SISTEM_NOTU" to Sinirlar.SISTEM_NOTU,
        "PLAN_BASLIK" to Sinirlar.PLAN_BASLIK,
        "PLAN_CWD" to Sinirlar.PLAN_CWD,
        "GOREV_METNI" to Sinirlar.GOREV_METNI,
        "PLAN_MADDE" to Sinirlar.PLAN_MADDE,
        "PLAN_MADDE_ADET" to Sinirlar.PLAN_MADDE_ADET,
        "PLAN_UYGULAMA_ADET" to Sinirlar.PLAN_UYGULAMA_ADET,
        "IZINLI_METIN" to Sinirlar.IZINLI_METIN,
        "IZINLI_METIN_ADET" to Sinirlar.IZINLI_METIN_ADET,
        "KIRLI_KAYNAK_ADET" to Sinirlar.KIRLI_KAYNAK_ADET,
        "RAPOR_MADDE" to Sinirlar.RAPOR_MADDE,
        "RAPOR_MADDE_ADET" to Sinirlar.RAPOR_MADDE_ADET,
        "RAPOR_DOSYA_YOLU" to Sinirlar.RAPOR_DOSYA_YOLU,
        "RAPOR_DOSYA_ADET" to Sinirlar.RAPOR_DOSYA_ADET,
        "RAPOR_GOVDE" to Sinirlar.RAPOR_GOVDE,
        "SORU_METNI" to Sinirlar.SORU_METNI,
        "SECENEK_METNI" to Sinirlar.SECENEK_METNI,
        "SECENEK_ADET" to Sinirlar.SECENEK_ADET,
        "CEVAP_METNI" to Sinirlar.CEVAP_METNI,
        "PAKET_ADI" to Sinirlar.PAKET_ADI,
        "UYGULAMA_ADI" to Sinirlar.UYGULAMA_ADI,
        "UYGULAMA_LISTESI_ADET" to Sinirlar.UYGULAMA_LISTESI_ADET,
        "ELEMENT_ROL" to Sinirlar.ELEMENT_ROL,
        "ELEMENT_METIN" to Sinirlar.ELEMENT_METIN,
        "ELEMENT_SATIR_METIN" to Sinirlar.ELEMENT_SATIR_METIN,
        "ELEMENT_ADET" to Sinirlar.ELEMENT_ADET,
        "ELEMENT_SORGU" to Sinirlar.ELEMENT_SORGU,
        "ON_PLAN_BASLIK" to Sinirlar.ON_PLAN_BASLIK,
        "YAZILAN_METIN" to Sinirlar.YAZILAN_METIN,
        "KOORDINAT_MAX" to Sinirlar.KOORDINAT_MAX,
        "TEKRAR_MAX" to Sinirlar.TEKRAR_MAX,
        "KAYDIRMA_MAX" to Sinirlar.KAYDIRMA_MAX,
        "BEKLEME_SANIYE_MAX" to Sinirlar.BEKLEME_SANIYE_MAX,
        "EKRAN_BASE64" to Sinirlar.EKRAN_BASE64,
        "BILDIRIM_BASLIK" to Sinirlar.BILDIRIM_BASLIK,
        "BILDIRIM_METIN" to Sinirlar.BILDIRIM_METIN,
        "PROJE_ADI" to Sinirlar.PROJE_ADI,
        "PROJE_NOTU" to Sinirlar.PROJE_NOTU,
        "PROJE_ADET" to Sinirlar.PROJE_ADET,
        "OTURUM_ADET" to Sinirlar.OTURUM_ADET,
        "DEVIR_OZETI" to Sinirlar.DEVIR_OZETI,
    )

    @Test
    fun `cekirdek tipleri kurulur`() {
        // Derleme kanıtı: Portlar.kt ve Sozlesme.kt tiplerinden örnekler.
        val izin = IzinKaydi(
            grantId = "g1",
            planId = "plan-1",
            planHash = "a".repeat(64),
            token = "x".repeat(40),
            mod = IzinModu.OKU,
            uygulamalar = listOf(IzinliUygulama("com.ornek.mesaj", "Mesajlar")),
            izinliMetin = emptyList(),
            serbestMetin = false,
            bitisMonotonikMs = 1_000L,
            kalanButce = 100,
        )
        val cmd = Cmd("c1", izin.grantId, izin.token, 1_000L, CmdArg.Click(12, null, 1, false))
        val karar: Karar = Karar.Reddedildi(DeniedNeden.HASSAS_UYGULAMA)
        val sonuc = CmdSonucu(
            ok = false,
            foreground = OnPlan("", "com.ornek.banka"),
            payload = null,
            denied = (karar as Karar.Reddedildi).neden,
            hata = null,
        )
        val anlik = AnlikDurum(
            aktifKokPaketi = "com.ornek.mesaj",
            sonOlayPaketi = null,
            odakPaketi = "com.ornek.mesaj",
            baslik = "Mesajlar",
            pencereler = listOf(
                Pencere(PencereTuru.UYGULAMA, "com.ornek.mesaj", 1, Dikdortgen(0, 0, 720, 1600), true, true),
            ),
            ekranGenisligi = 720,
            ekranYuksekligi = 1600,
            alinmaMonotonikMs = 500L,
        )
        assertEquals(CmdAdi.CLICK, cmd.arg.ad)
        assertEquals("com.ornek.banka", sonuc.foreground?.paket)
        assertEquals(1, anlik.pencereler.size)
        assertTrue(sonuc.denied == DeniedNeden.HASSAS_UYGULAMA)
    }
}
