package dev.eren.ajanda.ekran.sahne.cizim

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.layout
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.github.takahirom.roborazzi.captureRoboImage
import dev.eren.ajanda.ekran.sahne.TestEtkinligi
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import dev.eren.ajanda.ekran.sahne.tema.Metin
import dev.eren.ajanda.ekran.sahne.tema.Sahne
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import dev.eren.ajanda.ekran.sahne.tema.SahneTema
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.math.roundToInt

/**
 * Çizim takımının cihazsız görüntüleri ve davranışı.
 *
 * - `cizim_katalog`: 29 anahtarın hepsi; solda açık, sağda koyu tema; her temada karakalem, yarı geçiş, boyalı.
 * - `cizim_prototip_karsilastirma`: prototipin `goruntu/1-bugun-acik.png` ve `3-taslak-bitenler.png` karelerindeki
 *   dört levhanın çizim yerleşimi (levha bileşeni değil, yalnız çizim alanı), göz karşılaştırması için.
 *
 * Kaydet:  gradlew recordRoborazziDebug --tests "dev.eren.ajanda.ekran.sahne.cizim.CizimGoruntuTest"
 * Doğrula: gradlew verifyRoborazziDebug --tests "dev.eren.ajanda.ekran.sahne.cizim.CizimGoruntuTest"
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = "w360dp-h780dp-port-xhdpi")
class CizimGoruntuTest {
    private val etkinlik = TestEtkinligi()

    @get:Rule
    val kurallar = etkinlik.zincir
    private val kural get() = etkinlik.compose

    @Config(qualifiers = "w800dp-h2460dp-port-hdpi")
    @Test
    fun katalog() {
        kural.setContent {
            Row(Modifier.fillMaxSize()) {
                SahneTema(koyu = false, hareket = SahneHareket.Tam) { KatalogYarisi("açık", Modifier.weight(1f)) }
                SahneTema(koyu = true, hareket = SahneHareket.Tam) { KatalogYarisi("koyu", Modifier.weight(1f)) }
            }
        }
        kural.waitForIdle()
        kural.onRoot().captureRoboImage("src/test/screenshots/sahne/cizim_katalog.png")
    }

    @Test
    fun prototipKarsilastirma() {
        kural.setContent {
            SahneTema(koyu = false, hareket = SahneHareket.Tam) { ProtipYerlesimi() }
        }
        kural.waitForIdle()
        kural.onRoot().captureRoboImage("src/test/screenshots/sahne/cizim_prototip_karsilastirma.png")
    }

    /** Bilinmeyen anahtar `genel` ile birebir aynı çizilir. */
    @Test
    fun bilinmeyenAnahtarGenelCizer() {
        assertEquals(piksel("genel"), piksel("uzay_gemisi"))
        assertEquals(piksel("genel"), piksel(null))
        assertNotEquals(piksel("genel"), piksel("araba"))
    }

    /** 29 anahtarın hepsi çizilir; çizilmiş olanlar `genel`den farklı görünür. */
    @Test
    fun herAnahtarCizilir() {
        val genel = piksel("genel", renk = LevhaRengi.KUM)
        for (a in CIZIM_ANAHTARLARI) {
            val p = piksel(a, renk = LevhaRengi.KUM)
            if (cizimBul(a).yerTutucu || a == GENEL_ANAHTAR) assertEquals(a, genel, p) else assertNotEquals(a, genel, p)
        }
    }

    @Test
    fun karakalemYariVeBoyaliFarkli() {
        val k = piksel("araba", ilerleme = 0f)
        val y = piksel("araba", ilerleme = 0.5f)
        val b = piksel("araba", ilerleme = 1f)
        assertNotEquals(k, y); assertNotEquals(y, b); assertNotEquals(k, b)
    }

    /** Hareket azaltılmışken canlı çizim durağanla aynı: köpük dinlenmede, imza tamamen çizili. */
    @Test
    fun hareketAzaltilincaCanliDuraganla() {
        for (a in listOf("araba", "is", "kahve", "dis")) {
            assertEquals(a, piksel(a, canli = false), piksel(a, canli = true, hareket = SahneHareket.Azaltilmis))
        }
    }

    /** Canlı imza ilk karelerde çizilmemiştir; 2.5 s sonra tamamen çizilidir (durağan hâlle aynı). */
    @Test
    fun imzaBirKezCizilir() {
        kural.mainClock.autoAdvance = false
        kur(Girdi("is", 1f, LevhaRengi.CAM, canli = true, hareket = SahneHareket.Tam))
        kural.mainClock.advanceTimeByFrame()
        kural.mainClock.advanceTimeByFrame()
        val ilk = goruntu()
        kural.mainClock.advanceTimeBy(2500)
        val son = goruntu()
        girdi.value = girdi.value.copy(canli = false)
        kural.mainClock.advanceTimeByFrame()
        val duragan = goruntu()
        assertNotEquals(ilk, son)
        assertEquals(duragan, son)
    }

    // --- yardımcılar ---

    private data class Girdi(val anahtar: String?, val ilerleme: Float, val renk: LevhaRengi, val canli: Boolean, val hareket: SahneHareket)

    private val girdi = mutableStateOf(Girdi(null, 1f, LevhaRengi.KOBALT, false, SahneHareket.Tam))
    private var kuruldu = false

    /** Tek bir 240 × 160 dp çizim kurar; sonraki çağrılar yalnız girdiyi değiştirir. */
    private fun kur(g: Girdi) {
        girdi.value = g
        if (kuruldu) return
        kuruldu = true
        kural.setContent {
            val o = girdi.value
            SahneTema(koyu = false, hareket = o.hareket) {
                Box(Modifier.size(240.dp, 160.dp)) {
                    KayitCizimi(o.anahtar, o.ilerleme, Sahne.levha(o.renk), o.canli, Modifier.fillMaxSize())
                }
            }
        }
    }

    private fun piksel(
        anahtar: String?,
        ilerleme: Float = 1f,
        renk: LevhaRengi = LevhaRengi.KOBALT,
        canli: Boolean = false,
        hareket: SahneHareket = SahneHareket.Tam,
    ): List<Int> {
        kur(Girdi(anahtar, ilerleme, renk, canli, hareket))
        kural.waitForIdle()
        return goruntu()
    }

    /** Pencerenin yazılımla çizilmiş pikselleri (Robolectric'te captureToImage kare beklerken takılıyor). */
    private fun goruntu(): List<Int> {
        var px = IntArray(0)
        kural.runOnUiThread {
            val v = kural.activity.window.decorView
            val b = Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888)
            v.draw(Canvas(b))
            px = IntArray(b.width * b.height)
            b.getPixels(px, 0, b.width, 0, 0, b.width, b.height)
        }
        return px.toList()
    }
}

private val HUCRE_G = 112.dp
private val HUCRE_Y = 75.dp

@Composable
private fun KatalogYarisi(tema: String, modifier: Modifier) {
    val renk = Sahne.renk
    Column(modifier.background(renk.zemin).padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.height(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Metin(tema, Modifier.width(52.dp), stil = Sahne.yazi.levhaAlt.copy(fontSize = 11.sp))
            for (b in listOf("karakalem", "yarı", "boyalı")) {
                Metin(b, Modifier.width(HUCRE_G + 6.dp), stil = Sahne.yazi.levhaAlt.copy(fontSize = 11.sp), renk = renk.soluk)
            }
        }
        for (a in CIZIM_ANAHTARLARI) {
            val c = cizimBul(a)
            val takim = Sahne.levha(c.renk)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Metin(
                    if (c.yerTutucu) "$a\n(yer t.)" else a,
                    Modifier.width(46.dp),
                    stil = Sahne.yazi.levhaAlt.copy(fontSize = 9.sp, lineHeight = 11.sp),
                    renk = if (c.yerTutucu) renk.soluk else renk.murekkep,
                )
                for (ilerleme in listOf(0f, 0.5f, 1f)) {
                    val sekil = RoundedCornerShape(12.dp)
                    Box(
                        Modifier
                            .size(HUCRE_G, HUCRE_Y)
                            .clip(sekil)
                            .then(
                                if (ilerleme == 0f) Modifier.background(renk.zemin).border(1.dp, renk.soluk, sekil)
                                else Modifier.background(takim.zemin),
                            )
                            .padding(6.dp),
                    ) {
                        KayitCizimi(a, ilerleme, takim, canli = false, modifier = Modifier.fillMaxSize())
                    }
                }
            }
        }
    }
}

/**
 * Prototip karelerindeki yerleşim: büyük levha (`is`, cam), iki kare (`araba` kobalt, `market` hardal), geniş taslak
 * (`ilac`, karakalem). Çizim alanı Levha.kt'deki `figurAlani` yüzdeleriyle.
 */
@Composable
private fun ProtipYerlesimi() {
    val renk = Sahne.renk
    Column(Modifier.fillMaxSize().background(renk.zemin).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        LevhaKutusu("is", LevhaRengi.CAM, 0.84f, floatArrayOf(0.07f, 0.09f, 0.30f, 0.09f), 1f, Modifier.fillMaxWidth(), canli = false)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            val kare = floatArrayOf(0.25f, 0.06f, 0.33f, 0.06f)
            LevhaKutusu("araba", LevhaRengi.KOBALT, 1.2f, kare, 1f, Modifier.weight(1f), canli = false)
            LevhaKutusu("market", LevhaRengi.HARDAL, 1.2f, kare, 1f, Modifier.weight(1f), canli = false)
        }
        LevhaKutusu("ilac", LevhaRengi.GOK, 0.52f, floatArrayOf(0.10f, 0.03f, 0.10f, 0.50f), 0f, Modifier.fillMaxWidth(), canli = false)
    }
}

@Composable
private fun LevhaKutusu(anahtar: String, r: LevhaRengi, oran: Float, alan: FloatArray, ilerleme: Float, modifier: Modifier, canli: Boolean) {
    val renk = Sahne.renk
    val sekil = RoundedCornerShape(26.dp)
    Box(
        modifier
            .layout { m, c ->
                val g = c.maxWidth
                val y = (g * oran).roundToInt()
                val p = m.measure(Constraints.fixed(g, y))
                layout(g, y) { p.place(0, 0) }
            }
            .clip(sekil)
            .then(if (ilerleme == 0f) Modifier.border(2.dp, renk.soluk, sekil) else Modifier.background(Sahne.levha(r).zemin)),
    ) {
        Box(
            Modifier.layout { m, c ->
                val g = c.maxWidth
                val y = c.maxHeight
                val (ust, sag, alt, sol) = alan.toList()
                val p = m.measure(Constraints.fixed((g * (1 - sag - sol)).roundToInt(), (y * (1 - ust - alt)).roundToInt()))
                layout(g, y) { p.place((g * sol).roundToInt(), (y * ust).roundToInt()) }
            },
        ) {
            KayitCizimi(anahtar, ilerleme, Sahne.levha(r), canli = canli, modifier = Modifier.fillMaxSize())
        }
    }
}
