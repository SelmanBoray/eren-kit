package dev.eren.ajanda.ekran.sahne.bugun

import android.app.Application
import android.graphics.Bitmap
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.ekran.sahne.SahneKok
import dev.eren.ajanda.ekran.sahne.gezinme.Hedef
import dev.eren.ajanda.ekran.sahne.gezinme.rememberGezgin
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
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

    /** Köpüklü çizim (araba): büyük levhada köpük süzülür; kare levhada çizim durağandır (SAHNE.md §5.15). */
    @Test
    fun canliParcalarYalnizBuyukLevhadaOynar() {
        c.ekle(
            kayit("araba", "Arabayı yıkat", an(GUN.toString(), "15:00")),
            kayit("kargo", "Kargo teslimi", an(GUN.toString(), "16:00")),
            kayit("kitap", "Kitap iadesi", an(GUN.toString(), "17:00")),
        )
        ac(SahneHareket.Tam, saatDursun = true)
        assertFalse("büyük levhada köpük oynar", hemenSonHalinde(800))
    }

    @Test
    fun kareLevhadaCizimDuragan() {
        c.ekle(
            kayit("kargo", "Kargo teslimi", an(GUN.toString(), "15:00")),
            kayit("araba", "Arabayı yıkat", an(GUN.toString(), "16:00")),
            kayit("kitap", "Kitap iadesi", an(GUN.toString(), "17:00")),
        )
        ac(SahneHareket.Tam, saatDursun = true)
        kural.mainClock.advanceTimeBy(100)
        assertTrue("kare levhada köpük oynamaz", hemenSonHalinde(800))
    }

    /** "Hareketi azalt": köpük durağan, tamamlamada patlama ve onayda boyama anında son hâlinde (§6). */
    @Test
    fun hareketiAzaltKopukluLevhadaPatlamaVeBoyamaAninda() {
        c.ekle(
            kayit("araba", "Arabayı yıkat", an(GUN.toString(), "15:00")),
            kayit("kitap", "Kitap iadesi", an(GUN.toString(), "17:00")),
            kayit("oto", "Oto yıkama randevusu", gun(GUN.toString()), taslak = true),
        )
        ac(SahneHareket.Azaltilmis, saatDursun = true)
        kural.mainClock.advanceTimeByFrame()
        assertTrue("köpük durağan", hemenSonHalinde())
        kural.onNodeWithContentDescription("Tamamla: Arabayı yıkat").performClick()
        kural.mainClock.advanceTimeByFrame()
        assertEquals(listOf("durum:araba:TAMAM"), durumCagrilari())
        assertTrue("tamamlama ve köpük patlaması anında", hemenSonHalinde(1000))
        kural.onNodeWithText("Onayla").performClick()
        kural.mainClock.advanceTimeByFrame()
        assertTrue(durumCagrilari().contains("onayla:oto"))
        assertTrue("karakalemden boyamaya anında", hemenSonHalinde(1000))
    }

    @Test
    fun tamHareketteAcilisZamanAlir() {
        // Karşılaştırma: aynı ölçüm tam harekette açılışın sürdüğünü görür (ölçümün kendisi doğru).
        ornekGun()
        ac(SahneHareket.Tam, acilis = true, saatDursun = true)
        assertFalse(hemenSonHalinde())
    }

    // ---------------------------------------------------------------------------------------------
    // Gözden geçirme düzeltmeleri
    // ---------------------------------------------------------------------------------------------

    /** Listeyi [i]. öğeye anında kaydırır (hareketsiz; saat dururken de). */
    private fun listeyiKaydir(i: Int) {
        val n = kural.onNode(DIKEY_LISTE).fetchSemanticsNode()
        kural.runOnUiThread { n.config[SemanticsActions.ScrollToIndex].action!!.invoke(i) }
    }

    private fun listeBoyu() = kural.onNode(DIKEY_LISTE).fetchSemanticsNode().config[SemanticsProperties.CollectionInfo].rowCount

    /** §5.1: açılış ekran başına bir kez; mozaik ve baş kaydırınca ekrandan çıkıp dönünce yeniden oynamaz. */
    @Test
    fun acilisKaydirincaYenidenOynamaz() {
        c.ekle(
            kayit("kargo", "Kargo teslimi", an(GUN.toString(), "15:00")),
            kayit("kitap", "Kitap iadesi", an(GUN.toString(), "17:00")),
        )
        for (i in 1..20) c.ekle(kayit("y$i", "Fırın $i", an(gunSonra(1), String.format(java.util.Locale.ROOT, "%02d:00", 8 + i / 2))))
        ac(SahneHareket.Tam, acilis = true)
        listeyiKaydir(listeBoyu() - 1)
        kural.waitForIdle()
        assertTrue("mozaik ekrandan çıktı", kural.onAllNodes(hasContentDescription("Kargo teslimi", substring = true)).fetchSemanticsNodes().isEmpty())
        kural.mainClock.autoAdvance = false
        listeyiKaydir(0)
        assertTrue("açılış yeniden oynamaz", hemenSonHalinde())
        levha("Kargo teslimi").assertIsDisplayed()
    }

    /** §5.13: "Geri al" bir kez çalışır; sönen tosta ikinci dokunuş ikinci kez geri almaz. */
    @Test
    fun geriAlIkiKezCalismaz() {
        ornekGun()
        ac()
        kural.onNodeWithContentDescription("Tamamla: Kahve molası").performClick()
        kural.mainClock.advanceTimeBy(1000)
        kural.waitForIdle()
        kural.mainClock.autoAdvance = false
        val g = kural.onNodeWithText("Geri al")
        // İkinci dokunuş aynı karede (tost sönerken hâlâ çizili).
        g.performClick()
        g.performClick()
        kural.mainClock.autoAdvance = true
        kural.waitForIdle()
        assertEquals(listOf("durum:kahve:TAMAM", "durum:kahve:ACIK"), durumCagrilari())
    }

    /** Tost, süresi dolana kadar ekrandan ayrılıp dönmekten (ayrıntı, döndürme) sağ çıkar; geri alma kaybolmaz. */
    @Test
    fun tostEkrandanAyrilipDonunceKalir() {
        ornekGun()
        depo = sahteDepo(c).also { it.acilisOynadi = true; it.basla() }
        var goster by mutableStateOf(true)
        kural.setContent {
            SahneTema(koyu = false, hareket = SahneHareket.Tam) {
                if (goster) BugunEkrani(depo, GUN, onKayit = {}, onAyarlar = {})
            }
        }
        kural.waitForIdle()
        kural.onNodeWithContentDescription("Tamamla: Kahve molası").performClick()
        kural.mainClock.advanceTimeBy(1000)
        kural.waitForIdle()
        kural.onNodeWithText("Bitti: Kahve molası").assertIsDisplayed()
        kural.runOnUiThread { goster = false }
        kural.waitForIdle()
        kural.runOnUiThread { goster = true }
        kural.waitForIdle()
        kural.onNodeWithText("Bitti: Kahve molası").assertIsDisplayed()
        kural.onNodeWithText("Geri al").performClick()
        kural.waitForIdle()
        assertEquals(listOf("durum:kahve:TAMAM", "durum:kahve:ACIK"), durumCagrilari())
        // Kullanılan ya da süresi dolan tost dönüşte yeniden çıkmaz.
        kural.mainClock.advanceTimeBy(5000)
        kural.runOnUiThread { goster = false }
        kural.waitForIdle()
        kural.runOnUiThread { goster = true }
        kural.waitForIdle()
        assertTrue(kural.onAllNodes(hasText("Geri al")).fetchSemanticsNodes().isEmpty())
    }

    /** Hareket ayarı hareket sürerken değişse de kilit korunur: ikinci dokunuş ikinci kez tamamlamaz. */
    @Test
    fun hareketAyariDegisinceKilitKorunur() {
        ornekGun()
        depo = sahteDepo(c).also { it.acilisOynadi = true; it.basla() }
        var hareket by mutableStateOf(SahneHareket.Tam)
        kural.setContent {
            SahneTema(koyu = false, hareket = hareket) {
                BugunEkrani(depo, GUN, onKayit = {}, onAyarlar = {})
            }
        }
        kural.waitForIdle()
        kural.mainClock.autoAdvance = false
        kural.onNodeWithContentDescription("Tamamla: Kahve molası").performClick()
        kural.mainClock.advanceTimeBy(100)
        kural.runOnUiThread { hareket = SahneHareket.Azaltilmis }
        kural.mainClock.advanceTimeByFrame()
        kural.mainClock.advanceTimeByFrame()
        kural.onNodeWithContentDescription("Tamamla: Kahve molası").performClick()
        kural.mainClock.advanceTimeBy(1500)
        kural.mainClock.autoAdvance = true
        kural.waitForIdle()
        assertEquals(listOf("durum:kahve:TAMAM"), durumCagrilari())
    }

    /** İptal edilmiş iş Bitenler'de "iptal edildi" durumunu okutur, "tamamlandı"yı değil. */
    @Test
    fun iptalEdilenHapIptalOlarakOkunur() {
        ornekGun()
        c.ekle(kayit("toplanti", "Toplantı", an(GUN.toString(), "10:00"), durum = KayitDurumu.IPTAL))
        ac()
        kural.onNode(DIKEY_LISTE).performScrollToNode(hasContentDescription("Toplantı", substring = true))
        val n = kural.onNode(hasContentDescription("Toplantı", substring = true).and(hasClickAction())).fetchSemanticsNode().config
        assertEquals("iptal edildi", n[SemanticsProperties.StateDescription])
    }

    /** Takvim okunamazsa "Boş bir gün" yerine hata görünür; yeniden denenince gün gelir. */
    @Test
    fun takvimOkunamazsaBosGunDegilHataGorunur() {
        ornekGun()
        c.sahte.takvimHatasi = IllegalStateException("okunamadı")
        ac()
        assertTrue(kural.onAllNodes(hasText("Boş bir gün.")).fetchSemanticsNodes().isEmpty())
        kural.onNodeWithText("Bugünün işleri okunamadı.").assertIsDisplayed()
        c.sahte.takvimHatasi = null
        kural.onNodeWithText("Yeniden dene").performClick()
        kural.waitForIdle()
        levha("Kahve molası").assertIsDisplayed()
    }

    /** Ayrıntı yer tutucusu gerçek kaydı gösterir (başlık, zaman, levhanın rengi); "Bitti" kaydı gerçekten tamamlar. */
    @Test
    fun ayrintiGercekKaydiGosterirVeGercektenTamamlar() {
        ornekGun()
        depo = sahteDepo(c).also { it.acilisOynadi = true; it.basla() }
        val k = depo.model.value.acikler.first { it.renk != LevhaRengi.KUM }
        kural.setContent {
            SahneTema(koyu = false, hareket = SahneHareket.Azaltilmis) {
                SahneKok(bugun = GUN, gezgin = rememberGezgin(Hedef.Sekme.BUGUN, Hedef.Ayrinti(k.kayitId)), bugunDeposu = depo)
            }
        }
        kural.waitForIdle()
        kural.onNode(hasText(k.baslik).and(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))).assertIsDisplayed()
        kural.onNodeWithText("Bugün, ${k.zaman}").assertIsDisplayed()
        // Kapağın sol kenarı (çizimin yan payı) levhanın takım zemini.
        val resim = goruntu()
        val beklenen = k.renk.takim(koyu = false).zemin.toArgb()
        assertEquals(beklenen, resim.getPixel((resim.width * 0.04f).toInt(), (resim.height * 0.2f).toInt()))
        kural.onNodeWithText("Bitti").performClick()
        kural.waitForIdle()
        assertEquals(listOf("durum:${k.kayitId}:TAMAM"), durumCagrilari())
    }
}
