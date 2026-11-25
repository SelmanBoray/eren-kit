package dev.eren.ajanda.alarm

import android.content.Context

/**
 * Hatırlatma yolunda olan ama o an kimseye söylenemeyen sorunların kalıcı izi (alıcılarda arayüz yok).
 * Ekran `HatirlatmaDurumu.oku` ile okur, kullanıcı görünce `HatirlatmaDurumu.goruldu` siler.
 * Kişisel veri tutmaz: başlık değil, yalnız opak kayıt kimlikleri, sayılar, zaman ve istisna sınıfı.
 */
interface SorunKaydi {
    /** Alarm Android'e kurulamadı (çekirdek satırı silip sonraki yeniden kurulumda dener). */
    fun kurulamadi(neden: String)

    /** Çalan ya da kaçırılan hatırlatma gösterilemedi (bildirim izni/kanalı kapalı); çekirdek teslim saydı. */
    fun gosterilemedi(kayitIdleri: List<String>)

    /** Alıcıda çekirdek çağrısı başarısız (alarm çaldı ya da yeniden kurulum). */
    fun cekirdekHatasi(neden: String)

    fun oku(): KayitliSorunlar

    fun temizle()
}

data class KayitliSorunlar(
    val kurulamayanSayisi: Int = 0,
    val sonKurulamamaNedeni: String? = null,
    /** Gösterilemeyen hatırlatmaların kayıt kimlikleri, en yenisi sonda, en çok `GOSTERILEMEYEN_SINIRI`. */
    val gosterilemeyenKayitlar: List<String> = emptyList(),
    /** Sınırdan taşanlar dahil gösterilemeyen hatırlatma sayısı. */
    val gosterilemeyenSayisi: Int = 0,
    val cekirdekHatasiSayisi: Int = 0,
    val sonCekirdekHatasi: String? = null,
    val sonSorunMs: Long? = null,
) {
    val bos: Boolean get() = kurulamayanSayisi == 0 && gosterilemeyenSayisi == 0 && cekirdekHatasiSayisi == 0

    companion object {
        const val GOSTERILEMEYEN_SINIRI = 20
    }
}

/** Saf birleştirme kuralları (bellek ve SharedPreferences uygulaması aynısını kullanır). */
internal object SorunKurallari {
    fun kurulamadi(s: KayitliSorunlar, neden: String, an: Long) =
        s.copy(kurulamayanSayisi = s.kurulamayanSayisi + 1, sonKurulamamaNedeni = neden, sonSorunMs = an)

    fun gosterilemedi(s: KayitliSorunlar, kayitIdleri: List<String>, an: Long): KayitliSorunlar {
        val sayi = kayitIdleri.size.coerceAtLeast(1)
        val liste = (s.gosterilemeyenKayitlar + kayitIdleri).takeLast(KayitliSorunlar.GOSTERILEMEYEN_SINIRI)
        return s.copy(gosterilemeyenKayitlar = liste, gosterilemeyenSayisi = s.gosterilemeyenSayisi + sayi, sonSorunMs = an)
    }

    fun cekirdekHatasi(s: KayitliSorunlar, neden: String, an: Long) =
        s.copy(cekirdekHatasiSayisi = s.cekirdekHatasiSayisi + 1, sonCekirdekHatasi = neden, sonSorunMs = an)
}

/** Bellekte (testler; süreç ölünce kaybolur). */
class BellekSorunKaydi(private val saat: () -> Long = System::currentTimeMillis) : SorunKaydi {
    private var durum = KayitliSorunlar()

    @Synchronized override fun kurulamadi(neden: String) { durum = SorunKurallari.kurulamadi(durum, neden, saat()) }

    @Synchronized override fun gosterilemedi(kayitIdleri: List<String>) {
        durum = SorunKurallari.gosterilemedi(durum, kayitIdleri, saat())
    }

    @Synchronized override fun cekirdekHatasi(neden: String) { durum = SorunKurallari.cekirdekHatasi(durum, neden, saat()) }

    @Synchronized override fun oku(): KayitliSorunlar = durum

    @Synchronized override fun temizle() { durum = KayitliSorunlar() }
}

/** Üretim: SharedPreferences (süreç ölümüne ve yeniden başlatmaya dayanır). */
internal class TercihSorunKaydi(private val context: Context) : SorunKaydi {
    private val tercih by lazy { context.getSharedPreferences(DOSYA, Context.MODE_PRIVATE) }

    override fun kurulamadi(neden: String) = degistir { SorunKurallari.kurulamadi(it, neden, System.currentTimeMillis()) }

    override fun gosterilemedi(kayitIdleri: List<String>) =
        degistir { SorunKurallari.gosterilemedi(it, kayitIdleri, System.currentTimeMillis()) }

    override fun cekirdekHatasi(neden: String) =
        degistir { SorunKurallari.cekirdekHatasi(it, neden, System.currentTimeMillis()) }

    override fun oku(): KayitliSorunlar = synchronized(KILIT) {
        val t = tercih
        KayitliSorunlar(
            kurulamayanSayisi = t.getInt("kurulamayan", 0),
            sonKurulamamaNedeni = t.getString("kurulamama_nedeni", null),
            gosterilemeyenKayitlar = t.getString("gosterilemeyen_kayitlar", null)
                ?.split('\n')?.filter { it.isNotEmpty() }.orEmpty(),
            gosterilemeyenSayisi = t.getInt("gosterilemeyen", 0),
            cekirdekHatasiSayisi = t.getInt("cekirdek_hatasi", 0),
            sonCekirdekHatasi = t.getString("cekirdek_hatasi_nedeni", null),
            sonSorunMs = if (t.contains("son_sorun_ms")) t.getLong("son_sorun_ms", 0) else null,
        )
    }

    override fun temizle() = synchronized(KILIT) { tercih.edit().clear().apply() }

    private fun degistir(f: (KayitliSorunlar) -> KayitliSorunlar) = synchronized(KILIT) {
        val s = f(oku())
        tercih.edit()
            .putInt("kurulamayan", s.kurulamayanSayisi)
            .putString("kurulamama_nedeni", s.sonKurulamamaNedeni)
            .putString("gosterilemeyen_kayitlar", s.gosterilemeyenKayitlar.joinToString("\n"))
            .putInt("gosterilemeyen", s.gosterilemeyenSayisi)
            .putInt("cekirdek_hatasi", s.cekirdekHatasiSayisi)
            .putString("cekirdek_hatasi_nedeni", s.sonCekirdekHatasi)
            .putLong("son_sorun_ms", s.sonSorunMs ?: 0)
            .apply()
    }

    companion object {
        private const val DOSYA = "ajanda_alarm_sorunlari"
        private val KILIT = Any()
    }
}
