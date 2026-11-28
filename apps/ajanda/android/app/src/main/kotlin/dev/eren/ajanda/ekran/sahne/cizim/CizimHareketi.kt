package dev.eren.ajanda.ekran.sahne.cizim

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing

/**
 * Canlı parçaların pozu (SAHNE.md §5.15): zamana bağlı saf işlevler. Çizim bunları her karede okur; testler
 * doğrudan sınar. Zaman milisaniyedir; [surekliMs] sürekli döngülerin saati (yalnız çizim görünür, uygulama ön
 * planda ve hareket azaltılmamışken ilerler), [tekSeferMs] bir kez oynayan imzanın saati (`0` başlangıç,
 * [TEK_SEFER_SURE_MS] ve üstü bitmiş hâl).
 *
 * Değerler prototipten (`parca/30-sahne.css` 20-33. satırlar).
 */
internal class Poz {
    var dx = 0f
    var dy = 0f
    var olcek = 1f
    var aci = 0f
    var alfa = 1f

    /** Yolun çizilen oranı (imza); 1 = tamamı. */
    var kirp = 1f

    fun sifirla() {
        dx = 0f; dy = 0f; olcek = 1f; aci = 0f; alfa = 1f; kirp = 1f
    }
}

internal object CizimHareketi {
    const val KOPUK_MS = 3200
    const val BUHAR_MS = 2800
    const val PIRILTI_MS = 2600
    const val IMZA_GECIKME_MS = 500
    const val IMZA_SURE_MS = 1500
    const val TEK_SEFER_SURE_MS = IMZA_GECIKME_MS + IMZA_SURE_MS

    /** Köpüklerin negatif gecikmeleri (`nth-child`): 1. köpük 0, sonra −0.8, −1.7, −2.3, −1.1 s. */
    private val KOPUK_KAYMA = intArrayOf(0, 800, 1700, 2300, 1100)

    /** CSS `ease-in-out`. */
    val ICE_DISA: Easing = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)

    /** İmza ve kalem eğrisi: `cubic-bezier(.5,0,.3,1)`. */
    val IMZA_EGRISI: Easing = CubicBezierEasing(0.5f, 0f, 0.3f, 1f)

    /** Köpük patlaması: `cubic-bezier(.2,.8,.2,1)`. */
    private val PATLAMA_EGRISI: Easing = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)

    /** Kalemin anahtar kareleri: (zaman oranı, dx, dy), viewBox birimi. */
    private val KALEM = arrayOf(
        floatArrayOf(0f, -60f, 9f),
        floatArrayOf(0.35f, -38f, -4f),
        floatArrayOf(0.70f, -16f, 5f),
        floatArrayOf(1f, 0f, 0f),
    )

    /** `0%,100% → 0; 50% → 1` biçimli gidiş-dönüş, her yarı [ICE_DISA] ile. */
    fun gidisDonus(evre: Float): Float {
        val e = evre - kotlin.math.floor(evre)
        return if (e < 0.5f) ICE_DISA.transform(e * 2f) else 1f - ICE_DISA.transform(e * 2f - 1f)
    }

    private fun evre(zamanMs: Long, sureMs: Int, kaymaMs: Int = 0): Float =
        ((zamanMs + kaymaMs) % sureMs).toFloat() / sureMs

    fun kopukKaymasi(sira: Int): Int =
        if (sira < KOPUK_KAYMA.size) KOPUK_KAYMA[sira] else (sira * 1300) % KOPUK_MS

    /** İmzanın çizilen oranı: 0.5 s bekler, 1.5 s'de çizilir. */
    fun imzaOrani(tekSeferMs: Float): Float {
        val t = ((tekSeferMs - IMZA_GECIKME_MS) / IMZA_SURE_MS).coerceIn(0f, 1f)
        return IMZA_EGRISI.transform(t)
    }

    /** Kalemin kayması; CSS'teki gibi eğri her anahtar kare aralığına ayrı uygulanır. */
    fun kalem(tekSeferMs: Float, poz: Poz) {
        val t = ((tekSeferMs - IMZA_GECIKME_MS) / IMZA_SURE_MS).coerceIn(0f, 1f)
        var i = 0
        while (i < KALEM.size - 2 && t > KALEM[i + 1][0]) i++
        val a = KALEM[i]
        val b = KALEM[i + 1]
        val yerel = IMZA_EGRISI.transform(((t - a[0]) / (b[0] - a[0])).coerceIn(0f, 1f))
        poz.dx = a[1] + (b[1] - a[1]) * yerel
        poz.dy = a[2] + (b[2] - a[2]) * yerel
    }

    /**
     * Köpük patlaması (tamamlanınca, SAHNE.md §5.2): [ilerleme] 0 → 1 (550 ms çağıranın saatinde). %40'ta 1.9 ölçek
     * ve %90 saydamlık, sonda 2.6 ölçek ve görünmez. [poz.alfa] parçanın kendi saydamlığının yerine geçer.
     */
    fun patlama(ilerleme: Float, taban: Float, poz: Poz) {
        if (ilerleme <= 0f) return
        val p = ilerleme.coerceIn(0f, 1f)
        if (p < 0.4f) {
            val y = PATLAMA_EGRISI.transform(p / 0.4f)
            poz.olcek *= 1f + 0.9f * y
            poz.alfa *= (taban + (0.9f - taban) * y) / taban
        } else {
            val y = PATLAMA_EGRISI.transform((p - 0.4f) / 0.6f)
            poz.olcek *= 1.9f + 0.7f * y
            poz.alfa *= 0.9f * (1f - y) / taban
        }
    }

    /** [parca]'nın verilen anlardaki pozu. Durağan parça ve azaltılmış hareket için poz değişmez (dinlenme karesi). */
    fun hesapla(parca: Parca, surekliMs: Long, tekSeferMs: Float, patlamaIlerleme: Float, poz: Poz) {
        poz.sifirla()
        when (parca.canli) {
            null -> Unit
            Canlanma.KOPUK -> {
                poz.dy = -7f * gidisDonus(evre(surekliMs, KOPUK_MS, kopukKaymasi(parca.sira)))
                patlama(patlamaIlerleme, parca.alfa, poz)
            }
            Canlanma.BUHAR -> {
                val g = gidisDonus(evre(surekliMs, BUHAR_MS))
                poz.dy = -6f * g
                poz.alfa = 1f - 0.5f * g
            }
            Canlanma.PIRILTI -> {
                val g = gidisDonus(evre(surekliMs, PIRILTI_MS))
                poz.olcek = 1f - 0.4f * g
                poz.aci = 20f * g
            }
            Canlanma.IMZA -> poz.kirp = imzaOrani(tekSeferMs)
            Canlanma.KALEM -> kalem(tekSeferMs, poz)
        }
    }
}
