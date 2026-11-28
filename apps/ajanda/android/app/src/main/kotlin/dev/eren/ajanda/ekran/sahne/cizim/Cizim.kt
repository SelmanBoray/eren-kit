package dev.eren.ajanda.ekran.sahne.cizim

import androidx.compose.runtime.Immutable
import dev.eren.ajanda.ekran.sahne.cizim.takim.GenelCizimi
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/**
 * Kayıt çizimlerinin veri biçimi (SAHNE.md §7). Bir çizim, 240 × 160 birimlik bir kutuda (SVG viewBox) sırayla
 * çizilen [Parca]'lardan oluşur. Parça rengini kendisi taşımaz, bir [Rol] taşır; renk çizim anında kaydın levha
 * takımından gelir. Böylece aynı çizim her takımda, açık ve koyu temada, karakalem ve boyalı hâlde çizilir.
 *
 * Yeni çizim [cizim] yazıcısıyla yazılır (bkz. `takim/` altındaki dosyalar ve SAHNE.md §7.5).
 */

/** Parçanın renk rolü (SAHNE.md §1.2). */
enum class Rol {
    /** Figür: çizimin ana gövdesi (takımın `f` rengi). */
    F,

    /** Açık ayrıntı: cam, ışık, köpük (takımın `l` rengi). */
    L,

    /** Koyu ayrıntı: teker, gölge, çizgi (takımın `d` rengi). */
    D,

    /** Zemin rengi: figürün üstüne "oyulmuş" görünen parça (takımın `b` rengi). */
    B,
}

/**
 * Canlanan parça türü (SAHNE.md §5.15). Bir çizimde en çok bir tür bulunur; [IMZA] ile [KALEM] birlikte tek
 * tür sayılır ("bir kez çizilen çizgi").
 */
enum class Canlanma(val surekli: Boolean) {
    /** Dikeyde 7 birim süzülür, 3.2 s; köpükler sırayla kaydırmalı. Tamamlanınca patlar. */
    KOPUK(surekli = true),

    /** 6 birim yükselip yarı saydamlaşır, 2.8 s. */
    BUHAR(surekli = true),

    /** Kendi merkezinde 0.6'ya küçülüp 20° döner, 2.6 s. */
    PIRILTI(surekli = true),

    /** Çizgi baştan sona bir kez çizilir: 0.5 s bekleme, 1.5 s. */
    IMZA(surekli = false),

    /** İmzayla eş zamanlı yazan kalem: (−60, 9) → (0, 0), bir kez. */
    KALEM(surekli = false),
}

/**
 * Çizimin bir parçası.
 *
 * @property yol SVG yol verisi (`d`), viewBox biriminde.
 * @property alfa boyalı hâldeki saydamlık (karakalemde yok sayılır, çizgi tam opaktır).
 * @property cizgi `null` ise dolgu; değilse çizgi kalınlığı (viewBox birimi; uçlar ve köşeler yuvarlak).
 * @property canli canlanma türü; `null` durağan.
 * @property sira aynı türden canlı parçalar arasındaki sıra (köpüklerin kaydırması bundan gelir).
 * @property donus yola ayrıştırılırken uygulanan dönme (SVG `rotate(aci cx cy)`).
 */
@Immutable
class Parca internal constructor(
    val yol: String,
    val rol: Rol,
    val alfa: Float,
    val cizgi: Float?,
    val canli: Canlanma?,
    val sira: Int,
    val donus: Donus?,
)

/** SVG `rotate(aci cx cy)`: derece, saat yönünde (SVG ekseninde y aşağı). */
@Immutable
data class Donus(val aci: Float, val cx: Float, val cy: Float)

/**
 * Bir kayıt çizimi.
 *
 * @property anahtar sözleşmedeki simge anahtarı (`^[a-z][a-z0-9_]{0,31}$`).
 * @property renk anahtarın varsayılan levha takımı.
 * @property yerTutucu çizimi henüz yapılmamış anahtar: şimdilik `genel`in parçalarını çizer.
 */
@Immutable
class Cizim internal constructor(
    val anahtar: String,
    val renk: LevhaRengi,
    val parcalar: List<Parca>,
    val yerTutucu: Boolean = false,
) {
    /** Yolların ayrıştırılmış ve önbelleğe alınmış hâli; ilk çizimde bir kez kurulur (ana iş parçacığında). */
    internal val hazir: HazirCizim by lazy(LazyThreadSafetyMode.NONE) { HazirCizim.kur(this) }

    override fun toString() = "Cizim($anahtar${if (yerTutucu) ", yer tutucu" else ""})"
}

/** viewBox genişliği ve yüksekliği. */
const val CIZIM_GENISLIK = 240f
const val CIZIM_YUKSEKLIK = 160f

/**
 * Çizim yazıcısı. Rol işlevlerinin adları prototipteki sınıf adlarıdır (SAHNE.md §7.2), böylece
 * `tasarim/cizim/` altındaki SVG dosyalarındaki `data-rol` ve `id` önekleri birebir çevrilir:
 *
 * | İşlev | Boyalı hâl | SVG karşılığı |
 * |---|---|---|
 * | [pf] | dolgu `f` | `id="pf_n"` |
 * | [pl] | dolgu `l` | `id="pl_n"` |
 * | [pd] | dolgu `d`, isteğe bağlı saydamlık | `id="pd_n"` (`fill-opacity`) |
 * | [pb2] | dolgu `b`, %45 | `id="pb2_n"` |
 * | [zemin] | dolgu `d`, %28 (yer gölgesi) | `id="zemin_n"` |
 * | [ps] | çizgi `d`, 4 birim, %22 | `id="ps_n"` |
 * | [ps2] | çizgi `d`, 7 birim | `id="ps2_n"` |
 * | [ps3] | çizgi `l`, 4 birim, %55 | `id="ps3_n"` |
 * | [kopuk] | dolgu `l`, %92, canlı köpük | `id="kopuk_n"` |
 * | [imza] | çizgi `d`, 4 birim, bir kez çizilir | `id="imza_cizgi_n"` |
 *
 * Pırıltı, buhar ve kalem rol işlevine `canli =` verilerek yazılır: `pf(yol, canli = Canlanma.PIRILTI)`.
 * Döndürülmüş grup [donuk] ile.
 */
class CizimYazici internal constructor() {
    private val liste = mutableListOf<Parca>()
    private var donus: Donus? = null
    private val sayac = IntArray(Canlanma.entries.size)

    private fun ekle(yol: String, rol: Rol, alfa: Float, cizgi: Float?, canli: Canlanma?) {
        val sira = if (canli != null) sayac[canli.ordinal]++ else 0
        liste += Parca(yol, rol, alfa, cizgi, canli, sira, donus)
    }

    fun pf(yol: String, canli: Canlanma? = null) = ekle(yol, Rol.F, 1f, null, canli)
    fun pl(yol: String, canli: Canlanma? = null) = ekle(yol, Rol.L, 1f, null, canli)
    fun pd(yol: String, alfa: Float = 1f, canli: Canlanma? = null) = ekle(yol, Rol.D, alfa, null, canli)
    fun pb2(yol: String) = ekle(yol, Rol.B, 0.45f, null, null)
    fun zemin(yol: String) = ekle(yol, Rol.D, 0.28f, null, null)
    fun ps(yol: String, canli: Canlanma? = null) = ekle(yol, Rol.D, 0.22f, 4f, canli)
    fun ps2(yol: String, canli: Canlanma? = null) = ekle(yol, Rol.D, 1f, 7f, canli)
    fun ps3(yol: String, canli: Canlanma? = null) = ekle(yol, Rol.L, 0.55f, 4f, canli)
    fun kopuk(yol: String) = ekle(yol, Rol.L, 0.92f, null, Canlanma.KOPUK)
    fun imza(yol: String) = ekle(yol, Rol.D, 1f, 4f, Canlanma.IMZA)

    /** İçindeki parçalar ([aci] derece, ([cx], [cy]) çevresinde) döndürülmüş çizilir. İç içe kullanılmaz. */
    fun donuk(aci: Float, cx: Float, cy: Float, blok: CizimYazici.() -> Unit) {
        check(donus == null) { "donuk iç içe kullanılamaz" }
        donus = Donus(aci, cx, cy)
        try { blok() } finally { donus = null }
    }

    internal fun bitir(): List<Parca> = liste.toList()
}

/** Yeni çizim. Örnek: `internal val KahveCizimi = cizim("kahve", LevhaRengi.HARDAL) { pf("M68 62h104…") }`. */
fun cizim(anahtar: String, renk: LevhaRengi, blok: CizimYazici.() -> Unit): Cizim =
    Cizim(anahtar, renk, CizimYazici().apply(blok).bitir())

/**
 * Çizimi henüz yapılmamış anahtar: `genel`in parçalarını kendi varsayılan rengiyle çizer. Çizim yapılınca
 * dosyadaki `yerTutucu(...)` çağrısı `cizim(...) { … }` ile değiştirilir; başka hiçbir dosya değişmez.
 */
fun yerTutucu(anahtar: String, renk: LevhaRengi): Cizim =
    Cizim(anahtar, renk, GenelCizimi.parcalar, yerTutucu = true)

/** SVG `circle` karşılığı yol (prototipteki dönüşümle aynı: iki yay). */
fun daire(cx: Float, cy: Float, r: Float): String =
    "M${s(cx - r)} ${s(cy)}a${s(r)} ${s(r)} 0 1 0 ${s(2 * r)} 0a${s(r)} ${s(r)} 0 1 0 ${s(-2 * r)} 0z"

/** SVG `rect` karşılığı yol: sol üst ([x], [y]), genişlik [g], yükseklik [h], köşe yarıçapı [r] (0: keskin). */
fun kutu(x: Float, y: Float, g: Float, h: Float, r: Float = 0f): String {
    val rr = minOf(r, g / 2, h / 2)
    if (rr <= 0f) return "M${s(x)} ${s(y)}h${s(g)}v${s(h)}h${s(-g)}z"
    return "M${s(x + rr)} ${s(y)}h${s(g - 2 * rr)}a${s(rr)} ${s(rr)} 0 0 1 ${s(rr)} ${s(rr)}" +
        "v${s(h - 2 * rr)}a${s(rr)} ${s(rr)} 0 0 1 ${s(-rr)} ${s(rr)}" +
        "h${s(-(g - 2 * rr))}a${s(rr)} ${s(rr)} 0 0 1 ${s(-rr)} ${s(-rr)}" +
        "v${s(-(h - 2 * rr))}a${s(rr)} ${s(rr)} 0 0 1 ${s(rr)} ${s(-rr)}z"
}

private fun s(v: Float): String = if (v == v.toInt().toFloat()) v.toInt().toString() else v.toString()
