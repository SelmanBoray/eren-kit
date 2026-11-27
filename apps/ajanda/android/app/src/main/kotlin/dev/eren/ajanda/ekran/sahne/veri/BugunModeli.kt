package dev.eren.ajanda.ekran.sahne.veri

import androidx.compose.runtime.Immutable
import dev.eren.ajanda.ekran.DurumGostergesi
import dev.eren.ajanda.ekran.HatirlatmaUyarilari
import dev.eren.ajanda.ekran.RetListesi
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import java.time.LocalDate

/** Levhanın (ya da satırın) hâli. */
enum class LevhaHali { ACIK, BITTI, TASLAK }

/**
 * Bugün ekranının bir kaydı: levha, kompakt satır, kalan kartı ya da biten hap'ı aynı veriden çizilir.
 * Saf veri; çekirdekten [BugunDenetleyici] kurar.
 *
 * - [anahtar] ekranda benzersizdir: tekrarın örneği aynı kaydın başka günü olabilir (`kayitId@ornekTarihi`).
 * - [cizim]: çizim anahtarı. Kayıtta simge alanı sözleşme v3 ile gelecek; o gelene dek başlıktan tahmin
 *   edilir ([Gorunus.cizimTahmini]). v3 gelince yalnız orası değişir.
 * - [aciklama]: TalkBack'in levha için okuduğu tek cümle.
 */
@Immutable
data class BugunKaydi(
    val anahtar: String,
    val kayitId: String,
    val baslik: String,
    val zaman: String?,
    val renk: LevhaRengi,
    val cizim: String?,
    val hal: LevhaHali,
    /** Bugün, saati geçmiş ve açık. Solmaz; levhada "Geçti" işareti taşır. */
    val gecti: Boolean = false,
    /** Görev ve randevu tamamlanır; not tamamlanmaz. */
    val tamamlanabilir: Boolean = true,
    /** Tekrarın örneği: durum yalnız o güne (`durumDegistir(…, ornekTarihi)`). */
    val ornekTarihi: String? = null,
    /** Değişikliği PC'ye henüz ulaşmadı (rozet yerine okunuşta). */
    val bekleyen: String? = null,
    val tekrar: Boolean = false,
    val asistan: Boolean = false,
    val aciklama: String = baslik,
)

/** Yaklaşan günlerden biri ya da "Sonrası" / "Tekrarlayanlar" kümesi. */
@Immutable
data class GunGrubu(val anahtar: String, val baslik: String, val kayitlar: List<BugunKaydi>)

/** Bağlantı, eşitleme, gönderilemeyenler ve hatırlatma sorunları (eski ana ekranın çubuğu ve şeritleri). */
@Immutable
data class DurumOzeti(
    val gosterge: DurumGostergesi.Gosterge,
    /** Eşleşme var ya da sürüyor; yoksa "PC ile eşleşmedi" şeridi. */
    val eslesmeVar: Boolean,
    val retler: List<RetListesi.RetSatiri>,
    /** Hatırlatmaların bütün sorunları (bilgi düzeyi dahil); şeritte yalnız ilk engel. */
    val hatirlatma: List<HatirlatmaUyarilari.Uyari>,
    val hatirlatmaSeridi: HatirlatmaUyarilari.Uyari?,
    val hatirlatmaSeritMetni: String?,
) {
    companion object {
        val Okunuyor = DurumOzeti(
            DurumGostergesi.Gosterge("…", "Durum okunuyor.", DurumGostergesi.Ton.SURUYOR, DurumGostergesi.Eylem.YOK),
            eslesmeVar = true, retler = emptyList(), hatirlatma = emptyList(), hatirlatmaSeridi = null, hatirlatmaSeritMetni = null,
        )
    }
}

/**
 * Bugün ekranının bir anlık modeli (SAHNE.md §3.2, §9). Arka iş parçacığında kurulur, Compose'da çizilir.
 *
 * Yukarıdan aşağı: baş (tarih, gün cümlesi, alt satır), [kalanlar] şeridi, [taslaklar], günün mozaiği
 * ([acikler]; ilk eleman sıradaki iş), [bitenler], [yaklasanlar].
 */
@Immutable
data class BugunModeli(
    val yuklendi: Boolean,
    val bugun: LocalDate,
    val tarih: String,
    val cumle: String,
    val alt: String,
    /** Önceki günlerden kalan açık işler (eski "Gecikmiş"). */
    val kalanlar: List<BugunKaydi>,
    /** Asistanın önerdiği, onay bekleyen kayıtlar (tarihli ya da değil). */
    val taslaklar: List<BugunKaydi>,
    /** Bugünün açık işleri; [siradaki] varsa ilk odur, ötekiler gün sırasıyla. */
    val acikler: List<BugunKaydi>,
    val siradaki: String?,
    val bitenler: List<BugunKaydi>,
    val bitenleriGizle: Boolean,
    val yaklasanlar: List<GunGrubu>,
    val durum: DurumOzeti,
    /** Çekirdek okunamadıysa kısa neden (gösterge de söyler). */
    val okumaHatasi: String? = null,
) {
    /** Yoğun gün eşiğinin saydığı: açık iş + taslak (SAHNE.md §9). */
    val yogunlukSayisi: Int get() = acikler.size + taslaklar.size

    val bos: Boolean get() = kalanlar.isEmpty() && taslaklar.isEmpty() && acikler.isEmpty() && bitenler.isEmpty() && yaklasanlar.isEmpty()

    companion object {
        fun yukleniyor(bugun: LocalDate) = BugunModeli(
            yuklendi = false, bugun = bugun, tarih = Gorunus.uzunTarih(bugun), cumle = "", alt = "",
            kalanlar = emptyList(), taslaklar = emptyList(), acikler = emptyList(), siradaki = null,
            bitenler = emptyList(), bitenleriGizle = false, yaklasanlar = emptyList(), durum = DurumOzeti.Okunuyor,
        )
    }
}

/**
 * "Sahne + sıra" düzeni (SAHNE.md §9): gün kalabalıklaşınca sıradaki iş büyük, ardından iki kare kalır,
 * gerisi kompakt satır olur. Sınır çevresinde gidip gelmesin diye düzen eşikte sıkışır, eşiğin iki altına
 * inince açılır.
 */
object YogunGun {
    const val ESIK = 6
    const val BUYUK_YAZI_ESIGI = 4
    const val FARK = 2

    /** Sahnede resimli kalan levha sayısı: büyük + iki kare. */
    const val SAHNEDE = 3

    /** Bitenler bundan fazlaysa ilk [BITEN_SINIRI] - 1 hap + "ve N iş daha". */
    const val BITEN_SINIRI = 6

    fun esik(buyukYazi: Boolean) = if (buyukYazi) BUYUK_YAZI_ESIGI else ESIK

    /**
     * Düzen kararı. [onceki] `null`: gün ilk açılıyor. [buyukYazi]: yazı ölçeği 1.3'ü aşıyor.
     * Normalden yoğuna eşikte, yoğundan normale eşik − [FARK]'ta geçilir.
     */
    fun karar(onceki: Boolean?, sayi: Int, buyukYazi: Boolean): Boolean {
        val e = esik(buyukYazi)
        return when (onceki) {
            null -> sayi >= e
            true -> sayi > e - FARK
            false -> sayi >= e
        }
    }
}

/** Gösterim yardımcıları (saf). */
object Gorunus {
    private val TR = java.util.Locale.forLanguageTag("tr-TR")
    private val AYLAR = listOf("Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık")

    fun uzunTarih(t: LocalDate): String =
        "${dev.eren.ajanda.ekran.EkranMetinleri.gunAdi(t.dayOfWeek)}, ${t.dayOfMonth} ${AYLAR[t.monthValue - 1]}"

    /** "Yarın, 28 Kasım" / "Pazartesi, 30 Kasım". */
    fun gunBasligi(t: LocalDate, bugun: LocalDate): String =
        if (t == bugun.plusDays(1)) "Yarın, ${t.dayOfMonth} ${AYLAR[t.monthValue - 1]}" else uzunTarih(t)

    fun kucuk(s: String): String = s.lowercase(TR)

    /**
     * Kaydın levha rengi. Kayıtta renk alanı yok (sözleşme v3 simge anahtarıyla gelecek): kimlikten sabit
     * bir seçim; aynı kayıt her açılışta aynı renkte.
     */
    fun renk(kayitId: String): LevhaRengi {
        var h = 0x811C9DC5.toInt()
        for (ch in kayitId) {
            h = h xor ch.code
            h *= 0x01000193
        }
        return LevhaRengi.entries[Math.floorMod(h, LevhaRengi.entries.size)]
    }

    private val TAHMIN = listOf(
        listOf("kahve", "çay", "mola", "kahvaltı") to "fincan",
        listOf("diş") to "dis",
        listOf("market", "alışveriş", "manav", "pazar") to "sepet",
        listOf("kargo", "paket", "teslim", "posta") to "kutu",
        listOf("ilaç", "eczane", "vitamin", "doktor", "hastane") to "ilac",
        listOf("fatura", "ödeme", "kira", "aidat", "vergi") to "fatura",
        listOf("imza", "form", "dilekçe", "başvuru", "belge", "evrak") to "imza",
        listOf("kamp", "çadır", "tatil", "gezi") to "cadir",
        listOf("zil", "alarm", "hatırlat") to "zil",
    )

    /**
     * Geçici: kayıtta simge anahtarı yokken başlıktan çizim tahmini. Sözleşme v3'te kaydın kendi anahtarı
     * gelir; bu işlev o zaman yalnız anahtar boşken çalışır.
     */
    fun cizimTahmini(baslik: String): String {
        val b = kucuk(baslik)
        return TAHMIN.firstOrNull { (kelimeler, _) -> kelimeler.any { it in b } }?.second ?: "yildiz"
    }

    /** "20 dakika sonra" / "3 saat sonra" (SAHNE.md §3.2: 60 dakikadan azsa dakika, değilse yuvarlanmış saat). */
    fun kalanSure(dk: Long): String = when {
        dk <= 0 -> "Şimdi"
        dk < 60 -> "$dk dakika sonra"
        else -> "${(dk + 30) / 60} saat sonra"
    }

    /** Okunuş eki: rozetin yerine TalkBack cümlesine eklenenler. */
    fun isaretOkunusu(k: BugunKaydi): String = buildString {
        if (k.gecti) append(", saati geçti")
        if (k.tekrar) append(", tekrarlıyor")
        if (k.asistan) append(", asistan ekledi")
        k.bekleyen?.let { append(", ").append(it) }
    }
}
