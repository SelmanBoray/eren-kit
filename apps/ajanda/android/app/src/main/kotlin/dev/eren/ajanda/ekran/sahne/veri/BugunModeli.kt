package dev.eren.ajanda.ekran.sahne.veri

import androidx.compose.runtime.Immutable
import dev.eren.ajanda.ekran.DurumGostergesi
import dev.eren.ajanda.ekran.HatirlatmaUyarilari
import dev.eren.ajanda.ekran.RetListesi
import dev.eren.ajanda.ekran.sahne.cizim.CizimOnerisi
import dev.eren.ajanda.ekran.sahne.cizim.cizimAnahtari
import dev.eren.ajanda.ekran.sahne.cizim.varsayilanLevhaRengi
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi
import java.time.LocalDate

/** Levhanın (ya da satırın) hâli. */
enum class LevhaHali { ACIK, BITTI, TASLAK }

/**
 * Bugün ekranının bir kaydı: levha, kompakt satır, kalan kartı ya da biten hap'ı aynı veriden çizilir.
 * Saf veri; çekirdekten [BugunDenetleyici] kurar.
 *
 * - [anahtar] ekranda benzersizdir: tekrarın örneği aynı kaydın başka günü olabilir (`kayitId@ornekTarihi`).
 * - [cizim]: çizim anahtarı ([Gorunus.cizim]: kaydın simgesi, yoksa başlıktan öneri, yoksa `genel`).
 * - [renk]: levha takımı; anahtarın varsayılanı, komşusuyla çakışırsa yakın bir takım ([KomsuRenk]).
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
     * Kimlikten sabit bir takım. Bugün levhaları bunu kullanmaz (renk çizim anahtarından gelir, [cizim]);
     * yalnız anahtarı bilinmeyen eski yer tutucuların yedeği.
     */
    fun renk(kayitId: String): LevhaRengi {
        var h = 0x811C9DC5.toInt()
        for (ch in kayitId) {
            h = h xor ch.code
            h *= 0x01000193
        }
        return LevhaRengi.entries[Math.floorMod(h, LevhaRengi.entries.size)]
    }

    /**
     * Kaydın çizim anahtarı. Sıra: kaydın kendi [simge]'si (sözleşme v3; bilinmeyen anahtar `genel`),
     * yoksa başlıktan öneri ([CizimOnerisi.oner]), o da yoksa `genel`.
     *
     * v3 BAĞLANTI NOKTASI: kaydın simge alanı geldiğinde tek değişiklik `BugunDenetleyici.kaydet` içindeki
     * `simge = null` satırıdır (`simge = k.simge`). Öneri o zaman yalnız simgesi boş kayıtlarda çalışır.
     */
    fun cizim(simge: String?, baslik: String): String {
        val s = simge?.trim()
        if (!s.isNullOrEmpty()) return cizimAnahtari(s)
        return cizimAnahtari(CizimOnerisi.oner(baslik) ?: CizimOnerisi.GENEL)
    }

    /** Anahtarın varsayılan takımı (kayıtta renk seçimi yok); komşu kuralı sonra uygulanır ([KomsuRenk]). */
    fun renkAnahtardan(cizim: String): LevhaRengi = varsayilanLevhaRengi(cizim)

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

/**
 * Komşu levhalar aynı takıma düşmesin (renk anahtardan geldiği için iki kahve, ya da kahve ile market
 * — ikisi de hardal — yan yana gelebilir). Kural, ekranın okuma sırasıyla verilen bir listede:
 *
 * - Her kayıt önceki [PENCERE] kaydın takımından farklı olur. Mozaikte iki sütunlu sırada bu, yan yana
 *   ve üst üste her komşuyu kapsar (büyük → kare, kare | kare, kare ↓ kare); satırda ve şeritte ardışık
 *   kayıtları.
 * - Çakışan kayıt önce anahtarının kendi takımını ister, olmazsa [YAKIN] sırasıyla ona en yakın takıma kayar
 *   (kobalt → gece → gök …): kaydın "rengi" tanınır kalır. Seçim belirlenimci: aynı liste aynı renkleri verir.
 * - Kaymayı yalnız çakışan kayıt yapar; ilk kayıt (sıradaki iş) her zaman kendi takımındadır.
 */
object KomsuRenk {
    const val PENCERE = 2

    /** Her takım için yakınlık sırası (ton ve sıcaklık): ilk uygun olan seçilir. */
    val YAKIN: Map<LevhaRengi, List<LevhaRengi>> = mapOf(
        LevhaRengi.KOBALT to listOf(LevhaRengi.GECE, LevhaRengi.GOK, LevhaRengi.CAM),
        LevhaRengi.CAM to listOf(LevhaRengi.GOK, LevhaRengi.GECE, LevhaRengi.KOBALT),
        LevhaRengi.HARDAL to listOf(LevhaRengi.DOMATES, LevhaRengi.KUM, LevhaRengi.PEMBE),
        LevhaRengi.PEMBE to listOf(LevhaRengi.DOMATES, LevhaRengi.KUM, LevhaRengi.HARDAL),
        LevhaRengi.DOMATES to listOf(LevhaRengi.PEMBE, LevhaRengi.HARDAL, LevhaRengi.KUM),
        LevhaRengi.GOK to listOf(LevhaRengi.KOBALT, LevhaRengi.CAM, LevhaRengi.KUM),
        LevhaRengi.KUM to listOf(LevhaRengi.HARDAL, LevhaRengi.GOK, LevhaRengi.PEMBE),
        LevhaRengi.GECE to listOf(LevhaRengi.KOBALT, LevhaRengi.CAM, LevhaRengi.GOK),
    )

    /** [istenen] ya da [yasak]ta olmayan en yakın takım. */
    fun sec(istenen: LevhaRengi, yasak: Set<LevhaRengi>): LevhaRengi =
        sequenceOf(istenen).plus(YAKIN.getValue(istenen)).plus(LevhaRengi.entries).first { it !in yasak }

    /** Okuma sırasındaki [liste]nin renklerini kurala göre düzeltir; değişmeyen kayıt aynı nesne kalır. */
    fun ayir(liste: List<BugunKaydi>): List<BugunKaydi> {
        if (liste.size < 2) return liste
        val sonuc = ArrayList<BugunKaydi>(liste.size)
        val yasak = HashSet<LevhaRengi>(PENCERE)
        for (k in liste) {
            yasak.clear()
            for (i in maxOf(0, sonuc.size - PENCERE) until sonuc.size) yasak += sonuc[i].renk
            val r = sec(k.renk, yasak)
            sonuc += if (r == k.renk) k else k.copy(renk = r)
        }
        return sonuc
    }
}

/**
 * Modelin bütün görünür sıralarına komşu kuralını uygular: taslaklar ve günün mozaiği tek sıra (ekranda öyle
 * dizilir), kalanlar şeridi, bitenler ve her yaklaşan gün ayrı sıra.
 */
fun BugunModeli.komsuRenkleriAyir(): BugunModeli {
    val sahne = KomsuRenk.ayir(taslaklar + acikler)
    return copy(
        kalanlar = KomsuRenk.ayir(kalanlar),
        taslaklar = sahne.subList(0, taslaklar.size).toList(),
        acikler = sahne.subList(taslaklar.size, sahne.size).toList(),
        bitenler = KomsuRenk.ayir(bitenler),
        yaklasanlar = yaklasanlar.map { g -> KomsuRenk.ayir(g.kayitlar).let { if (it === g.kayitlar) g else g.copy(kayitlar = it) } },
    )
}
