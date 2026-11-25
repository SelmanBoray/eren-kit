package dev.eren.ajanda.alarm

import dev.eren.ajanda.cekirdek.YenidenKurmaNedeni
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class YenidenKurmaTest {
    @Test
    fun sistem_olaylari_nedene_cevrilir() {
        val beklenen = mapOf(
            "android.intent.action.BOOT_COMPLETED" to YenidenKurmaNedeni.ACILIS,
            "android.intent.action.QUICKBOOT_POWERON" to YenidenKurmaNedeni.ACILIS,
            "com.htc.intent.action.QUICKBOOT_POWERON" to YenidenKurmaNedeni.ACILIS,
            "android.intent.action.MY_PACKAGE_REPLACED" to YenidenKurmaNedeni.PAKET_GUNCELLENDI,
            "android.intent.action.TIME_SET" to YenidenKurmaNedeni.SAAT_DEGISTI,
            "android.intent.action.TIMEZONE_CHANGED" to YenidenKurmaNedeni.DILIM_DEGISTI,
            AlarmYenidenKurma.EYLEM_KESIN_IZIN to YenidenKurmaNedeni.PERIYODIK,
        )
        for ((eylem, neden) in beklenen) assertEquals(eylem, neden, AlarmYenidenKurma.nedenAl(eylem))
        assertNull(AlarmYenidenKurma.nedenAl(null))
        assertNull(AlarmYenidenKurma.nedenAl("android.intent.action.SCREEN_ON"))
        assertNull(AlarmYenidenKurma.nedenAl(AlarmAlici.EYLEM))
    }

    /** Manifestte AcilisAlici'ya kayıtlı her eylem bir yeniden kurmaya varır (kayıt ile kod ayrışmasın). */
    @Test
    fun manifestteki_her_eylem_taninir() {
        val manifest = listOf(File("src/main/AndroidManifest.xml"), File("app/src/main/AndroidManifest.xml"))
            .first { it.isFile }.readText()
        val alici = Regex("""<receiver\s+android:name="\.alarm\.AcilisAlici".*?</receiver>""", RegexOption.DOT_MATCHES_ALL)
            .find(manifest)
        assertNotNull("AcilisAlici manifestte yok", alici)
        val eylemler = Regex("""<action android:name="([^"]+)"""").findAll(alici!!.value).map { it.groupValues[1] }.toList()
        assertTrue(eylemler.size >= 6)
        for (e in eylemler) assertNotNull(e, AlarmYenidenKurma.nedenAl(e))
    }

    @Test
    fun yeniden_kurma_cekirdegi_nedenle_cagirir() {
        val sorunlar = BellekSorunKaydi()
        for (neden in YenidenKurmaNedeni.entries) {
            val cagrilar = mutableListOf<String>()
            val ok = AlarmYenidenKurma.isle(
                neden,
                yenidenKur = { cagrilar += "kur $it" },
                sorunlar = sorunlar,
                dilimiTazele = { cagrilar += "dilim" },
            )
            assertTrue(ok)
            val beklenen = if (neden == YenidenKurmaNedeni.DILIM_DEGISTI) listOf("dilim", "kur $neden") else listOf("kur $neden")
            assertEquals(beklenen, cagrilar)
        }
        assertTrue(sorunlar.oku().bos)
    }

    @Test
    fun cekirdek_hatasi_yutulmaz_kaydedilir() {
        val sorunlar = BellekSorunKaydi()
        val ok = AlarmYenidenKurma.isle(
            YenidenKurmaNedeni.ACILIS,
            yenidenKur = { throw IllegalStateException("veritabanı") },
            sorunlar = sorunlar,
            dilimiTazele = {},
        )
        assertFalse(ok)
        assertEquals(1, sorunlar.oku().cekirdekHatasiSayisi)
        assertTrue(sorunlar.oku().sonCekirdekHatasi!!.contains("ACILIS"))
        assertEquals(
            listOf(HatirlatmaSorunu.CEKIRDEK_HATASI),
            HatirlatmaDurumu.hesapla(iyiOlgular(), sorunlar.oku()).sorunlar,
        )
    }
}
