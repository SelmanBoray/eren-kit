package dev.eren.ajanda.ekran.sahne.takvim

import android.app.Application
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollToIndex
import com.github.takahirom.roborazzi.captureRoboImage
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.GunBolumu
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.ekran.an
import dev.eren.ajanda.ekran.gun
import dev.eren.ajanda.ekran.kayit
import dev.eren.ajanda.ekran.sahne.SahneKok
import dev.eren.ajanda.ekran.sahne.TELEFON
import dev.eren.ajanda.ekran.sahne.TestEtkinligi
import dev.eren.ajanda.ekran.sahne.bugun.DILIM
import dev.eren.ajanda.ekran.sahne.bugun.GUN
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
import java.time.LocalDate

/**
 * Takvim sekmesinin cihazsız ekran görüntüleri: dört gün (normal ay, yoğun gün, dönemli ve tekrarlı, boş gün) ×
 * açık, koyu, büyük yazı (2.0) ve küçük ekran (320 × 568 dp, yazı 1.3). Sahte çekirdek, sabit an: 12 Mart 2026
 * 14:20. Yoğun ve dönemli günde ayrıca sayfanın aşağısı (gün listesi).
 *
 * Kaydet:  gradlew recordRoborazziDebug --tests "dev.eren.ajanda.ekran.sahne.takvim.TakvimGoruntuTest"
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = TELEFON)
class TakvimGoruntuTest {
    private val etkinlik = TestEtkinligi()

    @get:Rule
    val kurallar = etkinlik.zincir
    private val kural get() = etkinlik.compose

    enum class Gun { NORMAL, YOGUN, DONEMLI, BOS }

    private fun t(n: Long) = GUN.plusDays(n).toString()
    private fun donem(bas: String, bit: String) = AjandaZamani.Donem(bas, bit, DILIM.id, null)

    private fun TakvimCekirdegi.kur(g: Gun) {
        // Ayın geri kalanı: her senaryoda aynı birkaç kayıt (noktalar).
        val ay = listOf(
            kayit("fatura", "Su faturası", gun(t(-2)), durum = KayitDurumu.TAMAM),
            kayit("kitap", "Kitap iadesi", an(t(1), "11:00")),
            kayit("anne", "Anneyi ara", an(t(1), "19:00"), taslak = true),
            kayit("bisiklet", "Bisiklet bakımı", gun(t(4), bolum = GunBolumu.SABAH)),
            kayit("dis2", "Diş kontrolü", an(t(8), "10:00")),
            kayit("kargo", "Kargo teslimi", gun(t(-7))),
            kayit("kahve2", "Kahve buluşması", an(t(-5), "16:00")),
            kayit("ilac", "İlaç al", gun(t(15))),
        )
        when (g) {
            Gun.NORMAL -> {
                ekle(*ay.toTypedArray())
                ekle(
                    kayit("araba", "Arabayı yıkat", an(t(0), "14:45")),
                    kayit("toplanti", "Ekip toplantısı", an(t(0), "09:30")),
                    kayit("market", "Market alışverişi", gun(t(0), bolum = GunBolumu.AKSAM)),
                )
            }
            Gun.YOGUN -> {
                ekle(*ay.toTypedArray())
                val adlar = listOf("Sabah koşusu", "Ekip toplantısı", "Kahve molası", "Diş kontrolü", "Market alışverişi", "Kargo teslimi", "Akşam yemeği")
                adlar.forEachIndexed { i, ad ->
                    val s = String.format(java.util.Locale.ROOT, "%02d:%02d", 8 + i * 2, if (i % 2 == 0) 0 else 30)
                    ekle(kayit("y$i", ad, an(t(0), s), durum = if (i < 2) KayitDurumu.TAMAM else KayitDurumu.ACIK))
                }
                ekle(kayit("t1", "Eczaneden ilaç al", gun(t(0)), taslak = true))
            }
            Gun.DONEMLI -> {
                ekle(*ay.toTypedArray())
                ekle(
                    kayit("kamp", "Kamp tatili", donem(t(2), t(6))),
                    kayit("fuar", "Kitap fuarı", donem(t(-3), t(0))),
                    kayit("konferans", "Konferans", donem(t(11), t(13))),
                    kayit("sergi", "Sergi kurulumu", donem(t(3), t(4)), taslak = true),
                    kayit("ders", "Piyano dersi", an(t(-7), "18:00")).copy(tekrar = GUNLUK),
                )
                ornekGunleri["ders"] = listOf(t(-7), t(0), t(4), t(7), t(14))
                ornekDurumlari["ders"] = mutableMapOf(t(-7) to KayitDurumu.TAMAM)
            }
            Gun.BOS -> ekle(*ay.toTypedArray())
        }
    }

    private fun ciz(g: Gun, ad: String, asagi: Boolean = false) {
        val c = TakvimCekirdegi().apply { kur(g) }
        val depo = takvimDeposu(c).also { it.acilisOynadi = true; it.basla() }
        if (g == Gun.DONEMLI) depo.takvim.gunSec(LocalDate.parse(t(4)))
        kural.setContent {
            SahneTema(hareket = SahneHareket.Tam) {
                SahneKok(bugun = GUN, gezgin = rememberGezgin(Hedef.Sekme.TAKVIM), bugunDeposu = depo)
            }
        }
        kural.waitForIdle()
        kural.onRoot().captureRoboImage("src/test/screenshots/sahne/$ad.png")
        if (asagi) {
            val liste = kural.onNode(hasScrollAction().and(SemanticsMatcher.keyIsDefined(SemanticsProperties.CollectionInfo)).and(SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)))
            val son = liste.fetchSemanticsNode().config[SemanticsProperties.CollectionInfo].rowCount - 1
            liste.performScrollToIndex(son)
            kural.waitForIdle()
            kural.onRoot().captureRoboImage("src/test/screenshots/sahne/${ad}_asagi.png")
        }
    }

    @Test fun normalAcik() = ciz(Gun.NORMAL, "takvim_normal_acik", asagi = true)
    @Test fun yogunAcik() = ciz(Gun.YOGUN, "takvim_yogun_acik", asagi = true)
    @Test fun donemliAcik() = ciz(Gun.DONEMLI, "takvim_donemli_acik", asagi = true)
    @Test fun bosAcik() = ciz(Gun.BOS, "takvim_bos_acik")

    @Config(qualifiers = "+night") @Test fun normalKoyu() = ciz(Gun.NORMAL, "takvim_normal_koyu")
    @Config(qualifiers = "+night") @Test fun yogunKoyu() = ciz(Gun.YOGUN, "takvim_yogun_koyu", asagi = true)
    @Config(qualifiers = "+night") @Test fun donemliKoyu() = ciz(Gun.DONEMLI, "takvim_donemli_koyu")
    @Config(qualifiers = "+night") @Test fun bosKoyu() = ciz(Gun.BOS, "takvim_bos_koyu")

    @Config(fontScale = 2f) @Test fun normalBuyukYazi() = ciz(Gun.NORMAL, "takvim_normal_buyuk_yazi", asagi = true)
    @Config(fontScale = 2f) @Test fun yogunBuyukYazi() = ciz(Gun.YOGUN, "takvim_yogun_buyuk_yazi", asagi = true)
    @Config(fontScale = 2f) @Test fun donemliBuyukYazi() = ciz(Gun.DONEMLI, "takvim_donemli_buyuk_yazi", asagi = true)
    @Config(fontScale = 2f) @Test fun bosBuyukYazi() = ciz(Gun.BOS, "takvim_bos_buyuk_yazi", asagi = true)

    @Config(qualifiers = KUCUK, fontScale = 1.3f) @Test fun normalKucukEkran() = ciz(Gun.NORMAL, "takvim_normal_kucuk_ekran", asagi = true)
    @Config(qualifiers = KUCUK, fontScale = 1.3f) @Test fun yogunKucukEkran() = ciz(Gun.YOGUN, "takvim_yogun_kucuk_ekran", asagi = true)
    @Config(qualifiers = KUCUK, fontScale = 1.3f) @Test fun donemliKucukEkran() = ciz(Gun.DONEMLI, "takvim_donemli_kucuk_ekran", asagi = true)
    @Config(qualifiers = KUCUK, fontScale = 1.3f) @Test fun bosKucukEkran() = ciz(Gun.BOS, "takvim_bos_kucuk_ekran", asagi = true)

    companion object {
        const val KUCUK = "w320dp-h568dp-port-xhdpi"
    }
}
