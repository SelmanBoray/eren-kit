package dev.eren.ajanda.ekran.sahne.bugun

import android.app.Application
import android.graphics.Bitmap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeRight
import androidx.compose.ui.test.hasScrollAction
import dev.eren.ajanda.ekran.an
import dev.eren.ajanda.ekran.gun
import dev.eren.ajanda.ekran.kayit
import dev.eren.ajanda.ekran.sahne.TELEFON
import dev.eren.ajanda.ekran.sahne.TestEtkinligi
import dev.eren.ajanda.ekran.sahne.ekranlar.BugunEkrani
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import dev.eren.ajanda.ekran.sahne.tema.SahneTema
import dev.eren.ajanda.ekran.sahne.veri.BugunDeposu
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Bugün ekranının etkileşimleri sahte çekirdekle: tamamlama (daire, sağa çekme, TalkBack eylemi), geri alma
 * tostu, taslak onayı ve vazgeç, hareket süreleri ve "hareketi azalt"ta her şeyin anında bitmesi.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = TELEFON)
class BugunEkranTest {
    private val etkinlik = TestEtkinligi()

    @get:Rule
    val kurallar = etkinlik.zincir
    private val kural get() = etkinlik.compose

    private val c = BugunCekirdegi()
    private val DIKEY_LISTE = hasScrollAction().and(SemanticsMatcher.keyIsDefined(SemanticsProperties.CollectionInfo))
    private lateinit var depo: BugunDeposu
    private var acilan: String? = null

    private fun ornekGun() {
        c.ekle(
            kayit("kahve", "Kahve molası", an(GUN.toString(), "15:30")),
            kayit("dis", "Diş kontrolü", an(GUN.toString(), "17:00")),
            kayit("market", "Market", an(GUN.toString(), "18:00")),
            kayit("eczane", "Eczaneden ilaç al", gun(GUN.toString()), taslak = true),
            kayit("kitap", "Kitap iadesi", an(gunSonra(1), "11:00")),
        )
    }

    private fun ac(hareket: SahneHareket = SahneHareket.Tam, acilis: Boolean = false, saatDursun: Boolean = false) {
        depo = sahteDepo(c).also { it.acilisOynadi = !acilis; it.basla() }
        if (saatDursun) kural.mainClock.autoAdvance = false
        kural.setContent {
            SahneTema(koyu = false, hareket = hareket) {
                BugunEkrani(depo, GUN, onKayit = { acilan = it }, onAyarlar = {})
            }
        }
        if (!saatDursun) kural.waitForIdle()
    }

    private fun durumCagrilari() = c.cagrilar.filter { it.startsWith("durum:") || it.startsWith("onayla:") || it.startsWith("sil:") || it.startsWith("geriYukle:") }

    private fun ozelEylem(n: SemanticsNodeInteraction, ad: String) {
        val eylemler = n.fetchSemanticsNode().config[SemanticsActions.CustomActions]
        kural.runOnUiThread { eylemler.single { it.label == ad }.action() }
    }

    private fun levha(baslangic: String) = kural.onNode(hasContentDescription(baslangic, substring = true).and(SemanticsMatcher.keyIsDefined(SemanticsActions.OnClick)).and(SemanticsMatcher.keyIsDefined(SemanticsActions.CustomActions)))

    @Test
    fun levhaTekAnlamliAciklamaVeOzelEylemTasir() {
        ornekGun()
        ac()
        val n = levha("Kahve molası, 15:30")
        val d = n.fetchSemanticsNode().config
        assertEquals(listOf("Kahve molası, 15:30, sıradaki iş"), d[SemanticsProperties.ContentDescription])
        assertEquals(listOf("Tamamla"), d[SemanticsActions.CustomActions].map { it.label })
        // Taslak: durum ve iki özel eylem.
        val t = levha("Eczaneden ilaç al").fetchSemanticsNode().config
        assertEquals("asistan önerisi, onay bekliyor", t[SemanticsProperties.StateDescription])
        assertEquals(listOf("Onayla", "Vazgeç"), t[SemanticsActions.CustomActions].map { it.label })
        // Daire ayrı hedef; levhaya dokunmak ayrıntıyı açar.
        kural.onNodeWithContentDescription("Tamamla: Diş kontrolü").assertIsDisplayed()
        n.performClick()
        assertEquals("kahve", acilan)
    }

    @Test
    fun daireyleTamamlama720msSonraCekirdegeGiderTostlaGeriAlinir() {
        ornekGun()
        ac()
        kural.mainClock.autoAdvance = false
        kural.onNodeWithContentDescription("Tamamla: Kahve molası").performClick()
        kural.mainClock.advanceTimeBy(500)
        assertTrue("hareket sürerken çekirdeğe gidilmez", durumCagrilari().isEmpty())
        kural.mainClock.advanceTimeBy(400)
        assertEquals(listOf("durum:kahve:TAMAM"), durumCagrilari())
        kural.mainClock.autoAdvance = true
        kural.waitForIdle()
        kural.onNodeWithText("Bitti: Kahve molası").assertIsDisplayed()
        assertEquals("dis", depo.model.value.siradaki)
        kural.onNodeWithText("Geri al").performClick()
        kural.waitForIdle()
        assertEquals(listOf("durum:kahve:TAMAM", "durum:kahve:ACIK"), durumCagrilari())
        assertEquals("kahve", depo.model.value.siradaki)
    }

    @Test
    fun talkBackOzelEylemiyleTamamlamaVeOnay() {
        ornekGun()
        ac()
        ozelEylem(levha("Market"), "Tamamla")
        kural.waitForIdle()
        assertTrue(durumCagrilari().contains("durum:market:TAMAM"))
        ozelEylem(levha("Eczaneden ilaç al"), "Onayla")
        // Test saati yalnız kare beklenirken kendiliğinden ilerler; hareketten sonraki bekleme elle geçilir.
        kural.mainClock.advanceTimeBy(1000)
        kural.waitForIdle()
        assertTrue(durumCagrilari().contains("onayla:eczane"))
        kural.onNodeWithText("Onaylandı").assertIsDisplayed()
        assertTrue(depo.model.value.taslaklar.isEmpty())
        assertTrue(depo.model.value.acikler.any { it.kayitId == "eczane" })
    }

    @Test
    fun onayKarakalemdenBoyamaya900msSonra() {
        ornekGun()
        ac()
        kural.mainClock.autoAdvance = false
        kural.onNodeWithText("Onayla").performClick()
        kural.mainClock.advanceTimeBy(600)
        assertFalse(durumCagrilari().contains("onayla:eczane"))
        kural.mainClock.advanceTimeBy(400)
        assertTrue(durumCagrilari().contains("onayla:eczane"))
    }

    @Test
    fun vazgecSilerTostlaGeriYuklenir() {
        ornekGun()
        ac()
        kural.onNodeWithText("Vazgeç").performClick()
        kural.waitForIdle()
        assertEquals(listOf("sil:eczane"), durumCagrilari())
        kural.onNodeWithText("Öneriden vazgeçildi").assertIsDisplayed()
        kural.onNodeWithText("Geri al").performClick()
        kural.waitForIdle()
        assertEquals(listOf("sil:eczane", "geriYukle:eczane"), durumCagrilari())
        assertEquals(listOf("eczane"), depo.model.value.taslaklar.map { it.kayitId })
    }

    @Test
    fun yaklasanSatiriSagaCekerekTamamlanir() {
        ornekGun()
        ac()
        kural.onNode(DIKEY_LISTE).performScrollToNode(hasContentDescription("Kitap iadesi", substring = true))
        levha("Kitap iadesi").performTouchInput { swipeRight(startX = left + 20f, endX = left + 20f + 260f, durationMillis = 250) }
        kural.mainClock.advanceTimeBy(400)
        kural.waitForIdle()
        assertEquals(listOf("durum:kitap:TAMAM"), durumCagrilari())
    }

    @Test
    fun bitenlerGizlenirVeGosterilir() {
        ornekGun()
        c.ekle(kayit("vitamin", "Vitamin", an(GUN.toString(), "09:00"), durum = dev.eren.ajanda.cekirdek.KayitDurumu.TAMAM))
        ac()
        kural.onNode(DIKEY_LISTE).performScrollToNode(hasContentDescription("Vitamin", substring = true))
        kural.onNodeWithText("Gizle").performClick()
        kural.waitForIdle()
        assertTrue(depo.model.value.bitenleriGizle)
        assertTrue(kural.onAllNodes(hasContentDescription("Vitamin", substring = true)).fetchSemanticsNodes().isEmpty())
        kural.onNodeWithText("Göster").performClick()
        kural.waitForIdle()
        assertFalse(depo.model.value.bitenleriGizle)
    }

    // ---------------------------------------------------------------------------------------------
    // Hareketi azalt: her hareket anında biter (SAHNE.md §6)
    // ---------------------------------------------------------------------------------------------

    /** Pencerenin o anki çizimi. `captureToImage` boşta olmayı beklerdi; saat dururken doğrudan çizilir. */
    private fun goruntu(): Bitmap {
        lateinit var b: Bitmap
        kural.runOnUiThread {
            val v = kural.activity.window.decorView
            b = Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888)
            v.draw(android.graphics.Canvas(b))
        }
        return b
    }

    /** Bir kare sonraki görüntü ile [sonra] ms sonraki görüntü aynı mı (hareket sürmüyor mu). */
    private fun hemenSonHalinde(sonra: Long = 1500): Boolean {
        kural.mainClock.advanceTimeByFrame()
        kural.mainClock.advanceTimeByFrame()
        val a = goruntu()
        kural.mainClock.advanceTimeBy(sonra)
        val b = goruntu()
        return a.sameAs(b)
    }

    @Test
    fun hareketiAzaltHerSeyAnindaBiter() {
        ornekGun()
        ac(SahneHareket.Azaltilmis, acilis = true, saatDursun = true)
        assertTrue("açılış (§5.1) anında son hâlinde", hemenSonHalinde())

        // Tamamlama: 720 ms bekleme yok; çekirdeğe aynı karede gidilir, kayıt hemen Bitenler'e geçer, tost belirir.
        kural.onNodeWithContentDescription("Tamamla: Kahve molası").performClick()
        kural.mainClock.advanceTimeByFrame()
        assertEquals(listOf("durum:kahve:TAMAM"), durumCagrilari())
        assertTrue("tamamlama (§5.2) anında", hemenSonHalinde(1000))
        kural.onNodeWithText("Bitti: Kahve molası").assertIsDisplayed()

        // Onay: daire yok, boyalı hâl ve yeniden diz anında.
        kural.onNodeWithText("Onayla").performClick()
        kural.mainClock.advanceTimeByFrame()
        assertTrue(durumCagrilari().contains("onayla:eczane"))
        assertTrue("onay (§5.4) anında", hemenSonHalinde(1000))
    }

    @Test
    fun hareketiAzaltVazgecAninda() {
        ornekGun()
        ac(SahneHareket.Azaltilmis, saatDursun = true)
        kural.mainClock.advanceTimeByFrame()
        kural.onNodeWithText("Vazgeç").performClick()
        kural.mainClock.advanceTimeByFrame()
        assertEquals(listOf("sil:eczane"), durumCagrilari())
        assertTrue("vazgeç (§5.5) anında", hemenSonHalinde(1000))
    }

    @Test
    fun tamHareketteAcilisZamanAlir() {
        // Karşılaştırma: aynı ölçüm tam harekette açılışın sürdüğünü görür (ölçümün kendisi doğru).
        ornekGun()
        ac(SahneHareket.Tam, acilis = true, saatDursun = true)
        assertFalse(hemenSonHalinde())
    }
}
