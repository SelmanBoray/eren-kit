package dev.eren.ajanda.ekran.sahne.gezinme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable

/**
 * Sahne'nin hedefleri. Üç sekme kökü ve üstlerine açılan üç katman.
 * Hedef kendini tek satırlık bir anahtara yazar ([anahtar]); geri yığını bu anahtarlarla saklanır
 * (döndürme, tema değişimi ve süreç ölümünden sonra aynı yere dönülür).
 */
sealed interface Hedef {
    val anahtar: String

    /** Alt çubuktaki sekmeler; sıraları çubuktaki sıradır. */
    enum class Sekme(override val anahtar: String, val ad: String) : Hedef {
        BUGUN("bugun", "Bugün"),
        TAKVIM("takvim", "Takvim"),
        TARIHSIZ("tarihsiz", "Tarihsizler"),
    }

    /** Kayıt ayrıntısı. Levhadan büyüyerek açılır (paylaşılan öğe anahtarı: [levhaAnahtari]). */
    data class Ayrinti(val kayitId: String) : Hedef {
        override val anahtar get() = "ayrinti:$kayitId"
    }

    /** Yeni kayıt ([kayitId] `null`) ya da düzenleme. */
    data class Duzenle(val kayitId: String?) : Hedef {
        override val anahtar get() = "duzenle:${kayitId.orEmpty()}"
    }

    data object Ayarlar : Hedef {
        override val anahtar = "ayarlar"
    }

    companion object {
        fun coz(a: String): Hedef? {
            Sekme.entries.firstOrNull { it.anahtar == a }?.let { return it }
            if (a == Ayarlar.anahtar) return Ayarlar
            val (tur, deger) = a.split(':', limit = 2).let { if (it.size == 2) it[0] to it[1] else return null }
            return when (tur) {
                "ayrinti" -> if (deger.isEmpty()) null else Ayrinti(deger)
                "duzenle" -> Duzenle(deger.ifEmpty { null })
                else -> null
            }
        }
    }
}

/** Levhayı ayrıntıya bağlayan paylaşılan öğe anahtarı: levha ve ayrıntının kapağı aynı anahtarı kullanır. */
fun levhaAnahtari(kayitId: String) = "levha:$kayitId"

/**
 * Geri yığını. Kökte her zaman tam bir sekme durur; sekme değiştirmek yığını o sekmeye indirir
 * (sekmeler arası geri yolculuk yok, Android'in alt gezinme kuralı). Bugün dışındaki bir sekmede geri,
 * önce Bugün'e döner; Bugün'de geri etkinliği kapatır.
 *
 * Bilinçli olarak küçük ve kitaplıksız: hedefler durumdan ibaret, geçişi [SahneGezinme] çizer.
 */
@Stable
class Gezgin internal constructor(baslangic: List<Hedef>) {
    private val yigin = mutableStateListOf<Hedef>().apply { addAll(baslangic) }

    val ust: Hedef get() = yigin.last()
    val sekme: Hedef.Sekme get() = yigin.first() as Hedef.Sekme
    val derinlik: Int get() = yigin.size

    /** Son hareket geriye miydi (geçiş yönü için). */
    var geriyeGitti: Boolean = false
        private set

    fun ac(h: Hedef) {
        require(h !is Hedef.Sekme) { "Sekmeye sekmeSec ile geçilir" }
        geriyeGitti = false
        if (ust != h) yigin.add(h)
    }

    fun sekmeSec(s: Hedef.Sekme) {
        if (yigin.size == 1 && sekme == s) return
        geriyeGitti = s.ordinal < sekme.ordinal
        yigin.clear()
        yigin.add(s)
    }

    /** Geri. Yapacak bir şey kalmadıysa `false` (etkinlik kapanır). */
    fun geri(): Boolean {
        geriyeGitti = true
        return when {
            yigin.size > 1 -> { yigin.removeAt(yigin.lastIndex); true }
            sekme != Hedef.Sekme.BUGUN -> { yigin[0] = Hedef.Sekme.BUGUN; true }
            else -> false
        }
    }

    fun geriGidilebilir(): Boolean = yigin.size > 1 || sekme != Hedef.Sekme.BUGUN

    /** Üstteki katmanın altındaki hedef (kökteyse `null`). */
    fun alttaki(): Hedef? = if (yigin.size > 1) yigin[yigin.lastIndex - 1] else null

    /** [once]'den [sonra]'ya geçiş geri yönde mi: [once] yığından çıktıysa ya da [sonra] onun altındaysa. */
    fun geriMi(once: Hedef, sonra: Hedef): Boolean {
        val i = yigin.indexOf(once)
        return i == -1 || yigin.indexOf(sonra) in 0 until i
    }

    internal fun anahtarlar(): List<String> = yigin.map { it.anahtar }

    private val acilmisKatmanlar = mutableSetOf<String>()

    /** Son çağrıdan beri kapanan katmanların anahtarları (saklanan durumları silinsin diye). Sekmeler hiç dönmez. */
    internal fun kapananlar(): List<String> {
        val simdi = yigin.filter { it !is Hedef.Sekme }.map { it.anahtar }.toSet()
        acilmisKatmanlar += simdi
        val kapanan = acilmisKatmanlar - simdi
        acilmisKatmanlar -= kapanan
        return kapanan.toList()
    }

    companion object {
        fun saklayici(): Saver<Gezgin, List<String>> = Saver(
            save = { it.anahtarlar() },
            restore = { a -> Gezgin(gecerliYigin(a.mapNotNull(Hedef::coz))) },
        )

        /** Kökü sekme olmayan ya da boş yığını onarır. */
        internal fun gecerliYigin(h: List<Hedef>): List<Hedef> {
            val ilk = h.firstOrNull() as? Hedef.Sekme
            val ustler = (if (ilk != null) h.drop(1) else h).filter { it !is Hedef.Sekme }
            return listOf(ilk ?: Hedef.Sekme.BUGUN) + ustler
        }
    }
}

@Composable
fun rememberGezgin(vararg baslangic: Hedef = arrayOf(Hedef.Sekme.BUGUN)): Gezgin =
    rememberSaveable(saver = Gezgin.saklayici()) { Gezgin(Gezgin.gecerliYigin(baslangic.toList())) }
