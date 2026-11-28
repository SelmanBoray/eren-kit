package dev.eren.ajanda.ekran.sahne.cizim

import android.app.Application
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * SAHNE.md §7.5 kurallarının denetimi: her çizim (yeni eklenenler de) bu testten geçmeli. Yollar gerçekten
 * ayrıştırılır (Robolectric yerel grafik), sınırlar dönüş uygulanmış hâlde ölçülür.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class)
class CizimKurallariTest {

    @Test
    fun herYolAyristirilirVeBosDegil() {
        for (c in TUM_CIZIMLER) for (hp in c.hazir.parcalar) {
            assertTrue("${c.anahtar}: boş yol ${hp.parca.yol.take(30)}", !hp.yol.isEmpty && hp.sinir.width + hp.sinir.height > 0f)
        }
    }

    /** Şekil 240 × 160 kutusunun içinde, kenarlardan en az 4 birim içeride (çizgi kalınlığı dahil). */
    @Test
    fun sekilKutununIcinde() {
        for (c in TUM_CIZIMLER) for (hp in c.hazir.parcalar) {
            val k = (hp.parca.cizgi ?: 0f) / 2f
            val s = hp.sinir
            assertTrue(
                "${c.anahtar}: kutu dışına taşan parça ${hp.parca.yol.take(30)} → $s",
                s.left - k >= 4f && s.top - k >= 4f && s.right + k <= CIZIM_GENISLIK - 4f && s.bottom + k <= CIZIM_YUKSEKLIK - 4f,
            )
        }
    }

    @Test
    fun parcaSayisiIkiIleOnAltiArasi() {
        for (c in TUM_CIZIMLER) assertTrue("${c.anahtar}: ${c.parcalar.size} parça", c.parcalar.size in 2..16)
    }

    /** Karakalemde okunurluk: her parçanın uzun kenarı en az 6 birim (daha küçüğü kesik çizgide kaybolur). */
    @Test
    fun cokKucukParcaYok() {
        for (c in TUM_CIZIMLER) for (hp in c.hazir.parcalar) {
            val s = hp.sinir
            assertTrue("${c.anahtar}: küçük parça $s", maxOf(s.width, s.height) >= 6f)
        }
    }

    /** En çok bir canlanma türü; imza ve kalem birlikte tek tür sayılır ve kalem imzasız olmaz. */
    @Test
    fun enCokBirCanlanmaTuru() {
        for (c in TUM_CIZIMLER) {
            val turler = c.parcalar.mapNotNull { it.canli }.map { if (it == Canlanma.KALEM) Canlanma.IMZA else it }.toSet()
            assertTrue("${c.anahtar}: birden çok canlanma türü $turler", turler.size <= 1)
            if (c.parcalar.any { it.canli == Canlanma.KALEM }) {
                assertTrue("${c.anahtar}: kalem var, imza yok", c.parcalar.any { it.canli == Canlanma.IMZA })
            }
        }
    }

    /** Ana gövde figür renginde: her çizimde en az bir `pf` parçası. */
    @Test
    fun herCizimdeFigurVar() {
        for (c in TUM_CIZIMLER) assertTrue("${c.anahtar}: pf yok", c.parcalar.any { it.rol == Rol.F && it.cizgi == null })
    }

    /** Saydamlık ve çizgi kalınlıkları §7.5'teki küme dışına çıkmaz. */
    @Test
    fun saydamlikVeKalinlikKumesi() {
        for (c in TUM_CIZIMLER) for (p in c.parcalar) {
            assertTrue("${c.anahtar}: saydamlık ${p.alfa}", p.alfa > 0f && p.alfa <= 1f)
            assertTrue("${c.anahtar}: çizgi ${p.cizgi}", p.cizgi == null || p.cizgi == 4f || p.cizgi == 7f)
        }
    }
}
