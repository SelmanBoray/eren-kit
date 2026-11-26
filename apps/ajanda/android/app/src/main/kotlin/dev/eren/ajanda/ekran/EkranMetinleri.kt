package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.AjandaKanalHatasi
import dev.eren.ajanda.cekirdek.AjandaYazar
import dev.eren.ajanda.cekirdek.GecmisSatiri
import dev.eren.ajanda.cekirdek.GunBolumu
import dev.eren.ajanda.cekirdek.Hatirlatma
import dev.eren.ajanda.cekirdek.KaynakYolu
import dev.eren.ajanda.cekirdek.TurKokeni
import dev.eren.ajanda.cekirdek.IslemTuru
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.KuyrukRetNedeni
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * Ekranların bütün Türkçe metinleri ve tarih/saat biçimleri. Saf: Android'e ve cihaz diline bağlı
 * değil (ay ve gün adları sabit tablodan; `Locale` verisi cihazdan cihaza değişebilir).
 */
object EkranMetinleri {
    private val AYLAR = listOf(
        "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
        "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
    )
    private val KISA_AYLAR = listOf("Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara")
    private val GUNLER = listOf("Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar")
    private val KISA_GUNLER = listOf("Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz")

    fun gunAdi(g: DayOfWeek): String = GUNLER[g.value - 1]
    fun kisaGunAdi(g: DayOfWeek): String = KISA_GUNLER[g.value - 1]

    /** "Perşembe, 26 Kasım" (yıl farklıysa sonuna yıl). */
    fun uzunTarih(t: LocalDate, bugun: LocalDate): String {
        val yil = if (t.year != bugun.year) " ${t.year}" else ""
        return "${gunAdi(t.dayOfWeek)}, ${t.dayOfMonth} ${AYLAR[t.monthValue - 1]}$yil"
    }

    /** "26 Kasım". */
    fun gunVeAy(t: LocalDate): String = "${t.dayOfMonth} ${AYLAR[t.monthValue - 1]}"

    /** "26 Kas" (yıl farklıysa "26 Kas 2027"). */
    fun kisaTarih(t: LocalDate, bugun: LocalDate): String {
        val yil = if (t.year != bugun.year) " ${t.year}" else ""
        return "${t.dayOfMonth} ${KISA_AYLAR[t.monthValue - 1]}$yil"
    }

    /** "Pzt 1 Ara". */
    fun gunluTarih(t: LocalDate, bugun: LocalDate): String = "${kisaGunAdi(t.dayOfWeek)} ${kisaTarih(t, bugun)}"

    fun saat(s: LocalTime): String = String.format(Locale.ROOT, "%02d:%02d", s.hour, s.minute)

    /** Bugüne göre göreli gün adı: "bugün", "yarın", "dün", yoksa null. */
    fun goreliGun(t: LocalDate, bugun: LocalDate): String? = when (ChronoUnit.DAYS.between(bugun, t)) {
        0L -> "bugün"
        1L -> "yarın"
        -1L -> "dün"
        else -> null
    }

    /** Kısa tarih, göreliyse göreli ad: "bugün", "yarın", "Cuma", "1 Ara". */
    fun yakinTarih(t: LocalDate, bugun: LocalDate): String {
        goreliGun(t, bugun)?.let { return it }
        val fark = ChronoUnit.DAYS.between(bugun, t)
        return if (fark in 2..6) gunAdi(t.dayOfWeek) else kisaTarih(t, bugun)
    }

    /** Bir anın şimdiye göre metni: "az önce", "5 dk önce", "3 sa önce", "dün 14:05", "24 Kas 14:05". */
    fun goreliAn(anMs: Long, simdiMs: Long, dilim: ZoneId): String {
        val fark = (simdiMs - anMs).coerceAtLeast(0)
        val dk = fark / 60_000
        if (dk < 1) return "az önce"
        if (dk < 60) return "$dk dk önce"
        val an = Instant.ofEpochMilli(anMs).atZone(dilim)
        val simdi = Instant.ofEpochMilli(simdiMs).atZone(dilim)
        if (dk < 6 * 60 && an.toLocalDate() == simdi.toLocalDate()) return "${dk / 60} sa önce"
        val s = saat(an.toLocalTime())
        return when (val g = goreliGun(an.toLocalDate(), simdi.toLocalDate())) {
            null -> "${kisaTarih(an.toLocalDate(), simdi.toLocalDate())} $s"
            else -> "$g $s"
        }
    }

    /** "2 gün geçti", "3 hafta geçti". */
    fun gecenSure(gun: Long): String = when {
        gun <= 0 -> "bugün"
        gun == 1L -> "dün"
        gun < 14 -> "$gun gün geçti"
        gun < 60 -> "${gun / 7} hafta geçti"
        else -> "${gun / 30} ay geçti"
    }

    fun sure(dk: Int): String = when {
        dk % 1440 == 0 -> "${dk / 1440} gün"
        dk >= 60 && dk % 60 == 0 -> "${dk / 60} sa"
        dk > 60 -> "${dk / 60} sa ${dk % 60} dk"
        else -> "$dk dk"
    }

    fun tur(t: KayitTuru): String = when (t) {
        KayitTuru.GOREV -> "Görev"
        KayitTuru.RANDEVU -> "Randevu"
        KayitTuru.NOT -> "Not"
    }

    fun hatirlatma(h: Hatirlatma, bugun: LocalDate): String = when (h) {
        is Hatirlatma.Once -> onceMetni(h.dk)
        is Hatirlatma.Mutlak -> {
            val t = runCatching { LocalDate.parse(h.tarih) }.getOrNull()
            (if (t != null) kisaTarih(t, bugun) else h.tarih) + " " + h.saat
        }
    }

    fun onceMetni(dk: Int): String = when {
        dk == 0 -> "Tam zamanında"
        dk % 10080 == 0 -> "${dk / 10080} hafta önce"
        dk % 1440 == 0 -> "${dk / 1440} gün önce"
        dk % 60 == 0 -> "${dk / 60} saat önce"
        else -> "$dk dk önce"
    }

    /** Gün bölümünün adı (v2): "sabah", "öğle", "öğleden sonra", "akşam", "gece". */
    fun gunBolumu(b: GunBolumu): String = when (b) {
        GunBolumu.SABAH -> "sabah"
        GunBolumu.OGLE -> "öğle"
        GunBolumu.OGLEDEN_SONRA -> "öğleden sonra"
        GunBolumu.AKSAM -> "akşam"
        GunBolumu.GECE -> "gece"
    }

    /** Yongadaki ad: "Sabah", "Öğleden sonra". */
    fun gunBolumuBuyuk(b: GunBolumu): String = gunBolumu(b).replaceFirstChar { it.uppercase() }

    /** Hatırlatmanın günü: "bugün", "yarın", hafta içindeyse gün adı ("Cuma"), değilse "Cuma, 4 Aralık". */
    fun hatirlatmaGunu(t: LocalDate, bugun: LocalDate): String {
        goreliGun(t, bugun)?.let { return it }
        val fark = ChronoUnit.DAYS.between(bugun, t)
        return if (fark in 2..6) gunAdi(t.dayOfWeek) else uzunTarih(t, bugun)
    }

    /**
     * Saatin bulunma eki, okunuşun son sözüne göre ünlü ve ünsüz uyumuyla: "17:00'de" (on yedi), "09:00'da"
     * (dokuz), "13:00'te" (on üç), "14:30'da" (otuz), "10:40'ta" (kırk).
     */
    fun bulunmaEki(saat: String): String {
        val p = saat.split(":")
        val s = p.getOrNull(0)?.toIntOrNull() ?: return "'de"
        val d = p.getOrNull(1)?.toIntOrNull() ?: 0
        val son = when {
            d == 0 -> if (s % 10 == 0) (s / 10) * 10 else s % 10
            d % 10 == 0 -> d
            else -> d % 10
        }
        return when (son) {
            0 -> "'da" // sıfır
            1, 2, 7, 8, 20, 50 -> "'de" // bir, iki, yedi, sekiz, yirmi, elli
            3, 4, 5 -> "'te" // üç, dört, beş
            6, 9, 10, 30 -> "'da" // altı, dokuz, on, otuz
            40 -> "'ta" // kırk
            else -> "'de"
        }
    }

    fun islem(i: IslemTuru): String = when (i) {
        IslemTuru.EKLE -> "Ekleme"
        IslemTuru.GUNCELLE -> "Düzenleme"
        IslemTuru.DURUM -> "Durum değişikliği"
        IslemTuru.ONAYLA -> "Onay"
        IslemTuru.SIL -> "Silme"
        IslemTuru.GERI_YUKLE -> "Geri yükleme"
    }

    /** Ret listesindeki nedenin kullanıcı açıklaması. */
    fun retNedeni(n: KuyrukRetNedeni): String = when (n) {
        KuyrukRetNedeni.KAYIT_BULUNAMADI -> "Kayıt PC'de bulunamadı."
        KuyrukRetNedeni.KAYIT_SILINMIS -> "Kayıt PC'de silinmiş; önce geri yüklenmeli."
        KuyrukRetNedeni.KIMLIK_CAKISIYOR -> "Bu kayıt PC'de zaten var (büyük olasılıkla daha önce ulaştı)."
        KuyrukRetNedeni.TUTARSIZ_KAYIT -> "Değişiklik kaydı tutarsız bırakacaktı."
        KuyrukRetNedeni.SAAT_DILIMI_BILINMIYOR -> "PC saat dilimini tanımadı."
        KuyrukRetNedeni.ORNEK_GECERSIZ -> "Tekrarın o günü yok."
        KuyrukRetNedeni.KAYIT_SINIRI -> "PC'deki kayıt sınırı doldu."
        KuyrukRetNedeni.SENTETIK_TURDA_IZINSIZ -> "Otomatik bir turda bu değişikliğe izin yok."
        KuyrukRetNedeni.DAYANAK_UYUSMUYOR -> "Zaman dayanağı tutmadı."
        KuyrukRetNedeni.GECE_TEYIDI_GEREKLI -> "Gece yarısından sonra hangi günün kastedildiği teyit edilmedi."
        KuyrukRetNedeni.GECERSIZ_ISLEM -> "PC işlemi geçersiz buldu."
        KuyrukRetNedeni.IC_HATA -> "PC'de iç hata; birkaç kez denendi."
        KuyrukRetNedeni.TESLIM_EDILEMEDI -> "Bağlantı koptuğu için gönderilemedi; birkaç kez denendi."
    }

    /** Kanal hatasının kullanıcı açıklaması; ikinci değer: yeniden eşleştirme gerektiriyor mu. */
    fun kanalHatasi(h: AjandaKanalHatasi): Pair<String, Boolean> = when (h) {
        AjandaKanalHatasi.YETKISIZ, AjandaKanalHatasi.CIHAZ_BILINMIYOR ->
            "PC bu telefonu tanımıyor; yeniden eşleştirin." to true
        AjandaKanalHatasi.IMZA_GECERSIZ -> "Kimlik doğrulanamadı; yeniden eşleştirin." to true
        AjandaKanalHatasi.KANAL_DESTEKLENMIYOR -> "Bu eşleşme ajanda için değil; ajanda koduyla yeniden eşleştirin." to true
        AjandaKanalHatasi.IP_UYUSMUYOR -> "PC bağlantıyı adres uyuşmadığı için reddetti (Tailscale açık mı?)." to false
        AjandaKanalHatasi.PROTOKOL_UYUMSUZ -> "PC ile uygulama sürümü uyuşmuyor; eski olanı güncelleyin." to false
        AjandaKanalHatasi.ZAMAN_ASIMI -> "PC zamanında yanıt vermedi." to false
        AjandaKanalHatasi.IC_HATA -> "PC'de iç hata." to false
        AjandaKanalHatasi.GECERSIZ_MESAJ, AjandaKanalHatasi.MESAJ_COK_BUYUK -> "PC bir mesajı reddetti." to false
        AjandaKanalHatasi.ESLESTIRME_KAPALI -> "PC'de eşleştirme penceresi kapalı." to true
        AjandaKanalHatasi.ESLESTIRME_KODU_GECERSIZ -> "Eşleştirme kodu geçersiz." to true
    }

    fun yazar(y: AjandaYazar): String = when (y.yol) {
        KaynakYolu.ELLE -> "Elle"
        KaynakYolu.SESLI_NOT -> "Sesli not"
        KaynakYolu.SOHBET_ARACI -> if (y.turKokeni == TurKokeni.INSAN) "Asistan (isteğinizle)" else "Asistan (kendiliğinden)"
        KaynakYolu.PC_ARACI -> "PC oturumu"
        KaynakYolu.ARKA_PLAN -> "Otomatik"
    }

    private val ALAN_ADLARI = mapOf(
        "tur" to "tür", "baslik" to "başlık", "aciklama" to "açıklama", "zaman" to "zaman",
        "hatirlatmalar" to "hatırlatmalar", "tekrar" to "tekrar", "durum" to "durum", "taslak" to "onay",
        "silindi" to "silinme", "ornekler" to "tekrar günleri",
    )

    /** Geçmiş satırı: "26 Kas 14:05 · Asistan (isteğinizle) · eklendi" / "… · başlık, zaman değişti". */
    fun gecmisSatiri(s: GecmisSatiri, simdiMs: Long, dilim: ZoneId): String {
        val ne = when (s.islem) {
            IslemTuru.EKLE -> "eklendi"
            IslemTuru.SIL -> "silindi"
            IslemTuru.GERI_YUKLE -> "geri yüklendi"
            IslemTuru.ONAYLA -> "onaylandı"
            IslemTuru.DURUM, IslemTuru.GUNCELLE -> {
                val alanlar = s.alanlar.map { ALAN_ADLARI[it] ?: it }
                if (alanlar.isEmpty()) "değişti" else alanlar.joinToString(", ") + " değişti"
            }
        }
        val ornek = s.ornekTarihi?.let { " (${it} örneği)" } ?: ""
        return "${goreliAn(s.tsMs, simdiMs, dilim)} · ${yazar(s.yazar)} · $ne$ornek"
    }

    const val UYGULAMA = "Ajanda"
    const val TARIHLILER = "Tarihliler"
    const val TARIHSIZLER = "Tarihsizler"
    const val TASLAKLAR = "Taslaklar"
    const val SILINENLER = "Silinenler"
    const val GONDERILEMEYENLER = "Gönderilemeyenler"
}
