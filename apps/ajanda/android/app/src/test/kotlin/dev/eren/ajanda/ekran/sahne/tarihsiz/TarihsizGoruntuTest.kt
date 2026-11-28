package dev.eren.ajanda.ekran.sahne.tarihsiz

import android.app.Application
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollToIndex
import com.github.takahirom.roborazzi.captureRoboImage
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.KaynakYolu
import dev.eren.ajanda.cekirdek.TurKokeni
import dev.eren.ajanda.ekran.kayit
import dev.eren.ajanda.ekran.sahne.SahneKok
import dev.eren.ajanda.ekran.sahne.TELEFON
import dev.eren.ajanda.ekran.sahne.TestEtkinligi
import dev.eren.ajanda.ekran.sahne.bugun.BugunCekirdegi
import dev.eren.ajanda.ekran.sahne.bugun.GUN
import dev.eren.ajanda.ekran.sahne.bugun.sahteDepo
import dev.eren.ajanda.ekran.sahne.gezinme.Hedef
import dev.eren.ajanda.ekran.sahne.gezinme.rememberGezgin
import dev.eren.ajanda.ekran.sahne.tema.SahneHareket
import dev.eren.ajanda.ekran.sahne.tema.SahneTema
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Tarihsizler sekmesinin cihazsız ekran görüntüleri: dolu ve boş × açık, koyu, büyük yazı (2.0) ve küçük ekran
 * (320 × 568 dp, yazı 1.3). Dolu listede ayrıca sayfanın aşağısı (notlar, bitenler).
 *
 * Kaydet:  gradlew recordRoborazziDebug --tests "dev.eren.ajanda.ekran.sahne.tarihsiz.TarihsizGoruntuTest"
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = TELEFON)
class TarihsizGoruntuTest {
    private val etkinlik = TestEtkinligi()

    @get:Rule
    val kurallar = etkinlik.zincir
    private val kural get() = etkinlik.compose

    private fun ciz(dolu: Boolean, ad: String, asagi: Boolean = false) {
        val c = BugunCekirdegi()
        if (dolu) {
            c.ekle(
                kayit("oneri", "Kamp listesini hazırla", taslak = true, yol = KaynakYolu.SOHBET_ARACI, kokeni = TurKokeni.SENTETIK),
                kayit("zil", "Kapı zilini değiştir"),
                kayit("imza", "Formu imzala"),
                kayit("ara", "Ustayı ara", AjandaZamani.Belirsiz("haftaya bir ara")),
                kayit("kargo", "Kargoyu geri gönder"),
                kayit("fikir", "Kitap fikri", tur = KayitTuru.NOT, aciklama = "Deniz feneri bekçisinin günlüğü"),
                kayit("vitamin", "Vitamin al", durum = KayitDurumu.TAMAM),
                kayit("fatura", "Fatura itirazı", durum = KayitDurumu.IPTAL),
            )
        }
        val depo = sahteDepo(c).also { it.acilisOynadi = true; it.basla() }
        kural.setContent {
            SahneTema(hareket = SahneHareket.Tam) {
                SahneKok(bugun = GUN, gezgin = rememberGezgin(Hedef.Sekme.TARIHSIZ), bugunDeposu = depo)
            }
        }
        kural.waitForIdle()
        kural.onRoot().captureRoboImage("src/test/screenshots/sahne/$ad.png")
        if (asagi) {
            val liste = kural.onNode(hasScrollAction().and(SemanticsMatcher.keyIsDefined(SemanticsProperties.CollectionInfo)))
            val son = liste.fetchSemanticsNode().config[SemanticsProperties.CollectionInfo].rowCount - 1
            liste.performScrollToIndex(son)
            kural.waitForIdle()
            kural.onRoot().captureRoboImage("src/test/screenshots/sahne/${ad}_asagi.png")
        }
    }

    @Test fun doluAcik() = ciz(true, "tarihsiz_dolu_acik", asagi = true)
    @Test fun bosAcik() = ciz(false, "tarihsiz_bos_acik")

    @Config(qualifiers = "+night") @Test fun doluKoyu() = ciz(true, "tarihsiz_dolu_koyu", asagi = true)
    @Config(qualifiers = "+night") @Test fun bosKoyu() = ciz(false, "tarihsiz_bos_koyu")

    @Config(fontScale = 2f) @Test fun doluBuyukYazi() = ciz(true, "tarihsiz_dolu_buyuk_yazi", asagi = true)
    @Config(fontScale = 2f) @Test fun bosBuyukYazi() = ciz(false, "tarihsiz_bos_buyuk_yazi")

    @Config(qualifiers = KUCUK, fontScale = 1.3f) @Test fun doluKucukEkran() = ciz(true, "tarihsiz_dolu_kucuk_ekran", asagi = true)
    @Config(qualifiers = KUCUK, fontScale = 1.3f) @Test fun bosKucukEkran() = ciz(false, "tarihsiz_bos_kucuk_ekran")

    companion object {
        const val KUCUK = "w320dp-h568dp-port-xhdpi"
    }
}
