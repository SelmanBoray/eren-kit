package dev.eren.ajanda.ekran.sahne.bugun

import android.app.Application
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.unit.Density
import com.github.takahirom.roborazzi.captureRoboImage
import dev.eren.ajanda.cekirdek.GunBolumu
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.ekran.an
import dev.eren.ajanda.ekran.gun
import dev.eren.ajanda.ekran.kayit
import dev.eren.ajanda.ekran.sahne.SahneKok
import dev.eren.ajanda.ekran.sahne.TELEFON
import dev.eren.ajanda.ekran.sahne.TestEtkinligi
import dev.eren.ajanda.ekran.sahne.gezinme.Gezgin
import dev.eren.ajanda.ekran.sahne.gezinme.Hedef
import dev.eren.ajanda.ekran.sahne.gezinme.rememberGezgin
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import dev.eren.ajanda.ekran.sahne.tema.SahneTema
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Bugün ekranının cihazsız ekran görüntüleri: beş gün (normal, yoğun, taslaklı, boş, bitenli) × açık, koyu,
 * büyük yazı (2.0) ve küçük ekran (320 × 568 dp, yazı 1.3). Sahte çekirdek, sabit an: 12 Mart 2026 14:20.
 * Yoğun ve bitenli günde ayrıca sayfanın aşağısı. Alt çubuğun dokunma hedefleri de burada ölçülür.
 *
 * Kaydet:  gradlew recordRoborazziDebug --tests "dev.eren.ajanda.ekran.sahne.bugun.BugunGoruntuTest"
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = TELEFON)
class BugunGoruntuTest {
    private val etkinlik = TestEtkinligi()

    @get:Rule
    val kurallar = etkinlik.zincir
    private val kural get() = etkinlik.compose

    enum class Gun { NORMAL, YOGUN, TASLAKLI, BOS, BITENLI }

    private fun BugunCekirdegi.kur(g: Gun) {
        val bugun = GUN.toString()
        when (g) {
            Gun.NORMAL -> {
                ekle(
                    kayit("toplanti", "Ekip toplantısı", an(bugun, "09:30")),
                    kayit("kahve", "Kahve molası", an(bugun, "15:30")),
                    kayit("dis", "Diş kontrolü", an(bugun, "17:00")),
                    kayit("market", "Market alışverişi", gun(bugun, bolum = GunBolumu.AKSAM)),
                    kayit("kargo", "Kargo teslimi", gun(bugun, bolum = GunBolumu.OGLEDEN_SONRA)),
                    kayit("fatura", "Su faturası", gun(gunSonra(-2))),
                    kayit("kitap", "Kitap iadesi", an(gunSonra(1), "11:00")),
                    kayit("bisiklet", "Bisiklet bakımı", gun(gunSonra(4), bolum = GunBolumu.SABAH)),
                )
            }
            Gun.YOGUN -> {
                val adlar = listOf(
                    "Sabah koşusu", "Ekip toplantısı", "Kahve molası", "Diş kontrolü", "Market alışverişi", "Kargo teslimi",
                    "İlaç al", "Formu imzala", "Fatura öde", "Kamp listesi", "Kapı zili", "Akşam yemeği", "Kitap oku",
                )
                adlar.forEachIndexed { i, ad ->
                    val s = String.format(java.util.Locale.ROOT, "%02d:%02d", 8 + i, if (i % 2 == 0) 0 else 30)
                    ekle(kayit("y$i", ad, an(bugun, s)))
                }
                ekle(
                    kayit("t1", "Eczaneden ilaç al", gun(bugun), taslak = true),
                    kayit("t2", "Anneyi ara", an(gunSonra(1), "19:00"), taslak = true),
                    kayit("t3", "Kira ödemesi", gun(gunSonra(3)), taslak = true),
                )
            }
            Gun.TASLAKLI -> {
                ekle(
                    kayit("t1", "Eczaneden ilaç al", gun(bugun, bolum = GunBolumu.OGLE), taslak = true),
                    kayit("t2", "Kargo paketini teslim et", an(gunSonra(1), "10:00"), taslak = true),
                    kayit("kahve", "Kahve molası", an(bugun, "15:30")),
                    kayit("dis", "Diş kontrolü", an(bugun, "17:00")),
                )
            }
            Gun.BOS -> Unit
            Gun.BITENLI -> {
                ekle(
                    kayit("dis", "Diş kontrolü", an(bugun, "17:00")),
                    kayit("market", "Market alışverişi", gun(bugun, bolum = GunBolumu.AKSAM)),
                    kayit("vitamin", "Vitamin", an(bugun, "08:00"), durum = KayitDurumu.TAMAM),
                    kayit("kahve", "Kahve molası", an(bugun, "10:30"), durum = KayitDurumu.TAMAM),
                    kayit("kargo", "Kargo teslimi", an(bugun, "12:00"), durum = KayitDurumu.TAMAM),
                    kayit("imza", "Formu imzala", gun(bugun), durum = KayitDurumu.TAMAM),
                )
            }
        }
    }

    private fun ciz(g: Gun, ad: String, asagi: Boolean = false) {
        val c = BugunCekirdegi().apply { kur(g) }
        val depo = sahteDepo(c).also { it.acilisOynadi = true; it.basla() }
        kural.setContent {
            SahneTema(hareket = SahneHareket.Tam) {
                SahneKok(bugun = GUN, bugunDeposu = depo)
            }
        }
        kural.waitForIdle()
        kural.onRoot().captureRoboImage("src/test/screenshots/sahne/$ad.png")
        if (asagi) {
            val liste = kural.onNode(hasScrollAction().and(SemanticsMatcher.keyIsDefined(SemanticsProperties.CollectionInfo)))
            val son = liste.fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.CollectionInfo].rowCount - 1
            liste.performScrollToIndex(son)
            kural.waitForIdle()
            kural.onRoot().captureRoboImage("src/test/screenshots/sahne/${ad}_asagi.png")
        }
    }

    @Test fun normalAcik() = ciz(Gun.NORMAL, "bugun_normal_acik", asagi = true)
    @Test fun yogunAcik() = ciz(Gun.YOGUN, "bugun_yogun_acik", asagi = true)
    @Test fun taslakliAcik() = ciz(Gun.TASLAKLI, "bugun_taslakli_acik")
    @Test fun bosAcik() = ciz(Gun.BOS, "bugun_bos_acik")
    @Test fun bitenliAcik() = ciz(Gun.BITENLI, "bugun_bitenli_acik", asagi = true)

    @Config(qualifiers = "+night") @Test fun normalKoyu() = ciz(Gun.NORMAL, "bugun_normal_koyu")
    @Config(qualifiers = "+night") @Test fun yogunKoyu() = ciz(Gun.YOGUN, "bugun_yogun_koyu", asagi = true)
    @Config(qualifiers = "+night") @Test fun taslakliKoyu() = ciz(Gun.TASLAKLI, "bugun_taslakli_koyu")
    @Config(qualifiers = "+night") @Test fun bosKoyu() = ciz(Gun.BOS, "bugun_bos_koyu")
    @Config(qualifiers = "+night") @Test fun bitenliKoyu() = ciz(Gun.BITENLI, "bugun_bitenli_koyu", asagi = true)

    @Config(fontScale = 2f) @Test fun normalBuyukYazi() = ciz(Gun.NORMAL, "bugun_normal_buyuk_yazi", asagi = true)
    @Config(fontScale = 2f) @Test fun yogunBuyukYazi() = ciz(Gun.YOGUN, "bugun_yogun_buyuk_yazi", asagi = true)
    @Config(fontScale = 2f) @Test fun taslakliBuyukYazi() = ciz(Gun.TASLAKLI, "bugun_taslakli_buyuk_yazi")
    @Config(fontScale = 2f) @Test fun bosBuyukYazi() = ciz(Gun.BOS, "bugun_bos_buyuk_yazi")
    @Config(fontScale = 2f) @Test fun bitenliBuyukYazi() = ciz(Gun.BITENLI, "bugun_bitenli_buyuk_yazi", asagi = true)

    @Config(qualifiers = KUCUK, fontScale = 1.3f) @Test fun normalKucukEkran() = ciz(Gun.NORMAL, "bugun_normal_kucuk_ekran")
    @Config(qualifiers = KUCUK, fontScale = 1.3f) @Test fun yogunKucukEkran() = ciz(Gun.YOGUN, "bugun_yogun_kucuk_ekran")
    @Config(qualifiers = KUCUK, fontScale = 1.3f) @Test fun taslakliKucukEkran() = ciz(Gun.TASLAKLI, "bugun_taslakli_kucuk_ekran")
    @Config(qualifiers = KUCUK, fontScale = 1.3f) @Test fun bosKucukEkran() = ciz(Gun.BOS, "bugun_bos_kucuk_ekran")
    @Config(qualifiers = KUCUK, fontScale = 1.3f) @Test fun bitenliKucukEkran() = ciz(Gun.BITENLI, "bugun_bitenli_kucuk_ekran")

    // ---------------------------------------------------------------------------------------------
    // Alt çubuk: her sekmede ve her yazı ölçeğinde dokunma hedefleri ≥ 48 dp (gözden geçirme bulgusu 7)
    // ---------------------------------------------------------------------------------------------

    private val hedefler = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)
        .or(hasContentDescription("Yeni kayıt"))

    @Config(qualifiers = KUCUK)
    @Test
    fun altCubukHedefleriHerSekmedeVeOlcekte48dpUstu() {
        lateinit var gezgin: Gezgin
        var olcek by mutableFloatStateOf(1f)
        kural.setContent {
            gezgin = rememberGezgin()
            val d = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(d.density, olcek)) {
                SahneTema(koyu = false, hareket = SahneHareket.Azaltilmis) { SahneKok(bugun = GUN, gezgin = gezgin) }
            }
        }
        val ekranGenisligi = kural.onRoot().fetchSemanticsNode().size.width
        val enAz = 48f * kural.density.density - 0.5f
        for (o in listOf(1f, 1.1f, 1.15f, 1.2f, 1.29f, 1.3f, 1.5f, 2f)) {
            for (s in Hedef.Sekme.entries) {
                kural.runOnUiThread {
                    olcek = o
                    gezgin.sekmeSec(s)
                }
                kural.waitForIdle()
                val dugumler = kural.onAllNodes(hedefler).fetchSemanticsNodes()
                assertTrue("ölçek $o, $s: 4 hedef", dugumler.size == 4)
                for (n in dugumler) {
                    val b = n.boundsInRoot
                    assertTrue("ölçek $o, $s: ${n.config} ${b.width}×${b.height}", b.width >= enAz && b.height >= enAz)
                    assertTrue("ölçek $o, $s: ekran dışında $b", b.left >= 0f && b.right <= ekranGenisligi)
                }
                if (s == Hedef.Sekme.TARIHSIZ && (o == 1.15f || o == 1.29f)) {
                    kural.onRoot().captureRoboImage("src/test/screenshots/sahne/bugun_cubuk_320_tarihsiz_${if (o == 1.15f) "115" else "129"}.png")
                }
            }
        }
    }

    companion object {
        const val KUCUK = "w320dp-h568dp-port-xhdpi"
    }
}
