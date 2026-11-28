package dev.eren.ajanda.ekran.sahne.takvim

import android.app.Application
import android.graphics.Bitmap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.ekran.an
import dev.eren.ajanda.ekran.gun
import dev.eren.ajanda.ekran.kayit
import dev.eren.ajanda.ekran.sahne.TELEFON
import dev.eren.ajanda.ekran.sahne.TestEtkinligi
import dev.eren.ajanda.ekran.sahne.bugun.GUN
import dev.eren.ajanda.ekran.sahne.ekranlar.TakvimEkrani
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import dev.eren.ajanda.ekran.sahne.tema.SahneTema
import dev.eren.ajanda.ekran.sahne.veri.BugunDeposu
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.LocalDate
import java.time.YearMonth

/**
 * Takvim ekranının etkileşimleri sahte çekirdekle: tamamla ve tost ile geri al, sağa çekme (yoğun gün), taslak
 * onayı, ay geçişi (düğme ve sürükleme) ve "Bugün"e dönüş, gün seçimi, TalkBack (hücre okunuşu ve seçili durum),
 * okuma hatası ve "hareketi azalt"ta her şeyin anında bitmesi.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = TELEFON)
class TakvimEkranTest {
    private val etkinlik = TestEtkinligi()

    @get:Rule
    val kurallar = etkinlik.zincir
    private val kural get() = etkinlik.compose

    private val c = TakvimCekirdegi()
    private lateinit var depo: BugunDeposu
    private var acilan: String? = null
    private val DIKEY_LISTE = hasScrollAction().and(SemanticsMatcher.keyIsDefined(SemanticsProperties.CollectionInfo)).and(SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange))

    private fun t(n: Long) = GUN.plusDays(n).toString()

    private fun ornekGun() {
        c.ekle(
            kayit("kahve", "Kahve molası", an(t(0), "15:30")),
            kayit("dis", "Diş kontrolü", an(t(0), "17:00")),
            kayit("eczane", "Eczaneden ilaç al", gun(t(0)), taslak = true),
            kayit("kitap", "Kitap iadesi", an(t(1), "11:00")),
        )
    }

    private fun ac(hareket: SahneHareket = SahneHareket.Tam, saatDursun: Boolean = false) {
        depo = takvimDeposu(c).also { it.acilisOynadi = true; it.basla() }
        if (saatDursun) kural.mainClock.autoAdvance = false
        kural.setContent {
            SahneTema(koyu = false, hareket = hareket) {
                TakvimEkrani(depo.takvim, GUN, onKayit = { acilan = it })
            }
        }
        if (!saatDursun) kural.waitForIdle() else repeat(3) { kural.mainClock.advanceTimeByFrame() }
    }

    private fun durumCagrilari() = c.cagrilar.filter { it.startsWith("durum:") || it.startsWith("onayla:") || it.startsWith("sil:") }

    private fun hucre(okunusBasi: String) = kural.onNode(hasContentDescription(okunusBasi, substring = true).and(SemanticsMatcher.keyIsDefined(SemanticsProperties.Selected)))

    private fun levha(bas: String) = kural.onNode(
        hasContentDescription(bas, substring = true).and(SemanticsMatcher.keyIsDefined(SemanticsActions.OnClick)).and(SemanticsMatcher.keyIsDefined(SemanticsActions.CustomActions)),
    )

    private fun ozelEylem(n: SemanticsNodeInteraction, ad: String) {
        val eylemler = n.fetchSemanticsNode().config[SemanticsActions.CustomActions]
        kural.runOnUiThread { eylemler.single { it.label == ad }.action() }
    }

    @Test
    fun gunListesiSiraylaSeritKartlariTaslakKarakalem() {
        ornekGun()
        ac()
        kural.onNodeWithText("Bugün, 12 Mart").assertIsDisplayed()
        val sira = depo.takvim.model.value.gun!!.kayitlar!!.map { it.kayitId }
        assertEquals(listOf("eczane", "kahve", "dis"), sira)
        val taslak = levha("Eczaneden ilaç al").fetchSemanticsNode().config
        assertEquals("asistan önerisi, onay bekliyor", taslak[SemanticsProperties.StateDescription])
        assertEquals(listOf("Onayla", "Vazgeç"), taslak[SemanticsActions.CustomActions].map { it.label })
        levha("Kahve molası").performClick()
        assertEquals("kahve", acilan)
    }

    @Test
    fun daireyleTamamlaTostlaGeriAl() {
        ornekGun()
        ac()
        kural.onNodeWithContentDescription("Tamamla: Kahve molası").performScrollTo()
        kural.waitForIdle()
        kural.mainClock.autoAdvance = false
        kural.onNodeWithContentDescription("Tamamla: Kahve molası").performClick()
        assertEquals("çekirdeğe dokunuş anında", listOf("durum:kahve:TAMAM"), durumCagrilari())
        kural.mainClock.advanceTimeBy(1000)
        kural.mainClock.autoAdvance = true
        kural.waitForIdle()
        kural.onNodeWithText("Bitti: Kahve molası").assertIsDisplayed()
        // Tamamlanan iş görünür kalır, solar ve sona iner.
        val sira = depo.takvim.model.value.gun!!.kayitlar!!
        assertEquals("kahve", sira.last().kayitId)
        assertEquals(dev.eren.ajanda.ekran.sahne.veri.LevhaHali.BITTI, sira.last().hal)
        kural.onNodeWithText("Geri al").performClick()
        kural.waitForIdle()
        assertEquals(listOf("durum:kahve:TAMAM", "durum:kahve:ACIK"), durumCagrilari())
        assertEquals("kahve", depo.takvim.model.value.gun!!.kayitlar!![1].kayitId)
    }

    @Test
    fun talkBackOzelEylemiyleTamamlaVeOnay() {
        ornekGun()
        ac()
        ozelEylem(levha("Kahve molası"), "Tamamla")
        kural.mainClock.advanceTimeBy(1000)
        kural.waitForIdle()
        assertTrue(durumCagrilari().contains("durum:kahve:TAMAM"))
        ozelEylem(levha("Eczaneden ilaç al"), "Onayla")
        kural.mainClock.advanceTimeBy(1000)
        kural.waitForIdle()
        assertTrue(durumCagrilari().contains("onayla:eczane"))
        assertEquals(listOf("Tamamla"), levha("Eczaneden ilaç al").fetchSemanticsNode().config[SemanticsActions.CustomActions].map { it.label })
    }

    @Test
    fun yogunGundeSatirlarSagaCekerekTamamlanir() {
        for (i in 0 until 6) c.ekle(kayit("k$i", "Fırın $i", an(t(0), String.format(java.util.Locale.ROOT, "%02d:00", 15 + i))))
        ac()
        // Beşten çok iş: kompakt satırlar (şerit değil).
        kural.onNode(DIKEY_LISTE).performScrollToNode(hasContentDescription("Fırın 3", substring = true))
        levha("Fırın 3").performTouchInput { swipeRight(startX = left + 20f, endX = left + 20f + 260f, durationMillis = 250) }
        kural.mainClock.advanceTimeBy(400)
        kural.waitForIdle()
        assertEquals(listOf("durum:k3:TAMAM"), durumCagrilari())
    }

    @Test
    fun gunHucresiTalkBackOkunusuVeSeciliDurum() {
        ornekGun()
        ac()
        val n = hucre("Perşembe, 12 Mart, bugün.")
        n.assertIsSelected()
        val okunus = n.fetchSemanticsNode().config[SemanticsProperties.ContentDescription].single()
        assertEquals("Perşembe, 12 Mart, bugün. 3 kayıt: 1 taslak.", okunus)
        assertEquals(false, hucre("Cuma, 13 Mart").fetchSemanticsNode().config[SemanticsProperties.Selected])
        assertTrue(hucre("Cuma, 13 Mart").fetchSemanticsNode().config[SemanticsProperties.ContentDescription].single().contains("1 kayıt"))
    }

    @Test
    fun gunSecimiAyGecisiVeBugune() {
        ornekGun()
        ac()
        hucre("Cuma, 13 Mart").performClick()
        kural.waitForIdle()
        kural.onNodeWithText("Yarın, 13 Mart").assertIsDisplayed()
        levha("Kitap iadesi").assertIsDisplayed()
        hucre("Cuma, 13 Mart").assertIsSelected()
        // Sonraki ay: ayın 1'i seçilir, "Bugün" düğmesi çıkar; ona dokununca bugüne dönülür.
        kural.onNodeWithContentDescription("Sonraki ay").performClick()
        kural.waitForIdle()
        assertEquals(YearMonth.of(2026, 4), depo.takvim.secim.value.ay)
        hucre("Çarşamba, 1 Nisan").assertIsSelected()
        kural.onNodeWithContentDescription("Bugüne dön").performClick()
        kural.waitForIdle()
        assertEquals(GUN, depo.takvim.secim.value.secili)
        assertTrue(kural.onAllNodes(hasContentDescription("Bugüne dön")).fetchSemanticsNodes().isEmpty())
        // Önceki ay ve ay dışı güne dokunma.
        kural.onNodeWithContentDescription("Önceki ay").performClick()
        kural.waitForIdle()
        assertEquals(YearMonth.of(2026, 2), depo.takvim.secim.value.ay)
        hucre("Pazar, 1 Mart").performClick()
        kural.waitForIdle()
        assertEquals(LocalDate.of(2026, 3, 1), depo.takvim.secim.value.secili)
        assertEquals(YearMonth.of(2026, 3), depo.takvim.secim.value.ay)
    }

    @Test
    fun izgaraSuruklenerekAyDegisir() {
        ornekGun()
        ac()
        hucre("Perşembe, 12 Mart, bugün.").performTouchInput { swipeLeft(startX = centerX + 150f, endX = centerX - 250f, durationMillis = 200) }
        kural.waitForIdle()
        assertEquals(YearMonth.of(2026, 4), depo.takvim.secim.value.ay)
    }

    @Test
    fun okumaHatasiYenidenDenenir() {
        ornekGun()
        c.gunHatasi = IllegalStateException("okunamadı")
        ac()
        kural.onNodeWithText("Bu günün kayıtları okunamadı.").assertIsDisplayed()
        c.gunHatasi = null
        kural.onAllNodes(hasText("Yeniden dene")).fetchSemanticsNodes().let { assertTrue(it.isNotEmpty()) }
        kural.onAllNodes(hasText("Yeniden dene"))[0].performClick()
        kural.waitForIdle()
        levha("Kahve molası").assertIsDisplayed()
    }

    @Test
    fun bosGunVeBitenlerGizlenir() {
        ornekGun()
        c.ekle(kayit("vit", "Vitamin", an(t(0), "09:00"), durum = KayitDurumu.TAMAM))
        ac()
        kural.onNode(DIKEY_LISTE).performScrollToNode(hasText("1 iş bitti"))
        kural.onNodeWithText("Gizle").performClick()
        kural.waitForIdle()
        assertTrue(depo.model.value.bitenleriGizle)
        assertTrue(depo.takvim.model.value.gun!!.kayitlar!!.none { it.kayitId == "vit" })
        kural.onNodeWithText("Göster").performClick()
        kural.waitForIdle()
        assertTrue(depo.takvim.model.value.gun!!.kayitlar!!.any { it.kayitId == "vit" })
        hucre("Salı, 17 Mart").performClick()
        kural.waitForIdle()
        kural.onNodeWithText("Bu gün boş.").assertIsDisplayed()
    }

    // ---------------------------------------------------------------------------------------------
    // Hareketi azalt: her hareket anında biter (SAHNE.md §6)
    // ---------------------------------------------------------------------------------------------

    private fun goruntu(): Bitmap {
        lateinit var b: Bitmap
        kural.runOnUiThread {
            val v = kural.activity.window.decorView
            b = Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888)
            v.draw(android.graphics.Canvas(b))
        }
        return b
    }

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
        ac(SahneHareket.Azaltilmis, saatDursun = true)
        assertTrue("açılış anında", hemenSonHalinde())
        hucre("Cuma, 13 Mart").performClick()
        assertTrue("gün seçimi (leke, renk, kartlar) anında", hemenSonHalinde())
        kural.onNodeWithContentDescription("Sonraki ay").performClick()
        assertTrue("ay değişimi anında", hemenSonHalinde())
        kural.onNodeWithContentDescription("Bugüne dön").performClick()
        assertTrue("bugüne dönüş anında", hemenSonHalinde())
        // Saat dururken kaydırma beklenemez (boşta olmaz): şeridin ikinci kartını TalkBack eylemiyle tamamla.
        ozelEylem(levha("Kahve molası"), "Tamamla")
        kural.mainClock.advanceTimeByFrame()
        assertEquals(listOf("durum:kahve:TAMAM"), durumCagrilari())
        assertTrue("tamamlama anında", hemenSonHalinde(1000))
    }

    @Test
    fun tamHareketteGunSecimiZamanAlir() {
        // Karşılaştırma: aynı ölçüm tam harekette gün seçiminin sürdüğünü görür.
        ornekGun()
        ac(SahneHareket.Tam, saatDursun = true)
        kural.mainClock.advanceTimeBy(2000)
        hucre("Cuma, 13 Mart").performClick()
        assertTrue(!hemenSonHalinde())
    }
}
