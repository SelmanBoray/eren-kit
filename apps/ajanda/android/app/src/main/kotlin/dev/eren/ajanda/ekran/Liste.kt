package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.AjandaKaydi
import dev.eren.ajanda.cekirdek.AjandaKaynagi
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitGorunumu
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.KaynakYolu
import dev.eren.ajanda.cekirdek.TurKokeni
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters

/**
 * Listelerin görünüm mantığı (saf; Android'siz birim testli): tarihlilerin gruplanması ve sırası,
 * tarihsizlerin sırası, satırın metinleri ve işaretleri.
 *
 * Gün sınırı: "bugün" cihazın şimdiki diliminde hesaplanır (kullanıcının takvimi). Saatli kayıt (`an`)
 * kendi diliminden cihaz dilimine çevrilir (İstanbul'da 01:30'daki randevu Londra'daki telefonda önceki
 * günün 22:30'udur); saatsiz gün ve dönem takvim günüdür, çevrilmez. Kaydın dilimi cihazınkiyle aynı
 * anda farklı ofsetteyse satırda kaydın kendi saati de yazılır.
 */
object Liste {

    enum class Grup(val baslik: String) {
        GECIKMIS("Gecikmiş"),
        BUGUN("Bugün"),
        YARIN("Yarın"),
        BU_HAFTA("Bu hafta"),
        SONRASI("Sonrası"),
        TEKRARLAYAN("Tekrarlayanlar"),
        GECMIS("Geçmiş"),
        YAPILACAK("Yapılacaklar"),
        NOTLAR("Notlar ve mevzular"),
        KAPALI("Tamamlananlar"),
        TASLAK("Onay bekleyen taslaklar"),
        SILINEN("Silinenler"),
    }

    /** Kaydın takvimdeki yeri (cihaz diliminde). */
    data class Konum(
        val ilkGun: LocalDate,
        val sonGun: LocalDate,
        /** Saatli kayıtta cihaz dilimindeki saat; gün ve dönemde null. */
        val saat: LocalTime?,
        /** Kaydın dilimi farklı ofsetteyse kendi yerel saati ve dilimi ("15:00 Europe/Istanbul"). */
        val kendiSaati: String?,
    )

    fun konum(z: AjandaZamani?, cihaz: ZoneId): Konum? = try {
        when (z) {
            is AjandaZamani.An -> {
                val kendi = dilimVeya(z.saatDilimi, cihaz)
                val yerel = ZonedDateTime.of(LocalDate.parse(z.tarih), LocalTime.parse(z.saat), kendi)
                val burada = yerel.withZoneSameInstant(cihaz)
                val farkli = yerel.offset != burada.offset
                Konum(
                    burada.toLocalDate(), burada.toLocalDate(), burada.toLocalTime(),
                    if (farkli) "${z.saat} ${z.saatDilimi}" else null,
                )
            }
            is AjandaZamani.Gun -> LocalDate.parse(z.tarih).let { Konum(it, it, null, null) }
            is AjandaZamani.Donem -> Konum(LocalDate.parse(z.baslangic), LocalDate.parse(z.bitis), null, null)
            is AjandaZamani.Belirsiz, null -> null
        }
    } catch (_: Exception) {
        null
    }

    private fun dilimVeya(id: String, yedek: ZoneId): ZoneId = try {
        ZoneId.of(id)
    } catch (_: Exception) {
        yedek
    }

    /** Pazartesi başlayan haftanın pazarı. */
    fun haftaSonu(bugun: LocalDate): LocalDate = bugun.with(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY))

    fun acik(k: AjandaKaydi) = k.durum == KayitDurumu.ACIK

    /** Tarihli kaydın grubu ve grup içi sıralamada kullanılan günü. */
    fun tarihliGrup(k: AjandaKaydi, konum: Konum, bugun: LocalDate): Pair<Grup, LocalDate> {
        if (!acik(k)) {
            return if (konum.sonGun < bugun) Grup.GECMIS to konum.sonGun else gelecekGrubu(konum, bugun)
        }
        if (konum.sonGun < bugun) {
            // Seri devam ediyor olabilir: sıradaki örneğin günü köprüde yok, gecikmiş sayılmaz.
            // Gecikmiş, gecikmeye başladığı güne (dönemde bitişe) göre sıralanır; "N gün geçti" de oradan.
            return if (k.tekrar != null) Grup.TEKRARLAYAN to konum.ilkGun else Grup.GECIKMIS to konum.sonGun
        }
        return gelecekGrubu(konum, bugun)
    }

    private fun gelecekGrubu(konum: Konum, bugun: LocalDate): Pair<Grup, LocalDate> {
        // Süren dönem bugündedir.
        val gun = if (konum.ilkGun < bugun && konum.sonGun >= bugun) bugun else konum.ilkGun
        val grup = when {
            gun <= bugun -> Grup.BUGUN
            gun == bugun.plusDays(1) -> Grup.YARIN
            gun <= haftaSonu(bugun) -> Grup.BU_HAFTA
            else -> Grup.SONRASI
        }
        return grup to gun
    }

    /** Liste öğesi: başlık, kayıt satırı ya da boş grup bilgisi. */
    sealed class Oge {
        data class Baslik(val grup: Grup, val sayi: Int, val ek: String? = null) : Oge()
        data class Satir(val satir: KayitSatiri) : Oge()
        data class Bos(val metin: String) : Oge()
    }

    /**
     * Tarihliler: Gecikmiş, Bugün (boşsa da görünür), Yarın, Bu hafta, Sonrası, Tekrarlayanlar, Geçmiş
     * (yalnız kapalılar dahilken dolar). Grup içinde gün, sonra tüm gün olanlar, sonra saat; eşitlikte
     * çekirdeğin sırası. Geçmiş en yeni üstte.
     */
    fun tarihliler(kayitlar: List<KayitGorunumu>, simdi: ZonedDateTime, gonderim: Gonderim = Gonderim.GONDERILIYOR): List<Oge> {
        val bugun = simdi.toLocalDate()
        val cihaz = simdi.zone
        data class Yer(val g: KayitGorunumu, val konum: Konum, val grup: Grup, val gun: LocalDate, val sira: Int)
        val yerler = kayitlar.mapIndexedNotNull { i, g ->
            val konum = konum(g.kayit.zaman, cihaz) ?: return@mapIndexedNotNull null
            val (grup, gun) = tarihliGrup(g.kayit, konum, bugun)
            Yer(g, konum, grup, gun, i)
        }
        val artan = compareBy<Yer>({ it.gun }, { if (it.konum.saat == null) 0 else 1 }, { it.konum.saat }, { it.sira })
        val cikti = mutableListOf<Oge>()
        for (grup in listOf(Grup.GECIKMIS, Grup.BUGUN, Grup.YARIN, Grup.BU_HAFTA, Grup.SONRASI, Grup.TEKRARLAYAN, Grup.GECMIS)) {
            val bu = yerler.filter { it.grup == grup }
                .sortedWith(if (grup == Grup.GECMIS) artan.reversed() else artan)
            if (bu.isEmpty()) {
                if (grup == Grup.BUGUN) {
                    cikti += Oge.Baslik(grup, 0)
                    cikti += Oge.Bos("Bugün için kayıt yok.")
                }
                continue
            }
            // Bugünün tarihi üst çubukta yazar; yarınınki başlıkta.
            val ek = if (grup == Grup.YARIN) EkranMetinleri.uzunTarih(bugun.plusDays(1), bugun) else null
            cikti += Oge.Baslik(grup, bu.size, ek)
            bu.forEach { cikti += Oge.Satir(satir(it.g, simdi, grup, it.konum, gonderim)) }
        }
        return cikti
    }

    /**
     * Tarihsizler: açık görev ve randevular (Yapılacaklar), açık notlar (Notlar ve mevzular), sonra
     * kapalılar. Grup içinde çekirdeğin sırası (en yeni üstte).
     */
    fun tarihsizler(kayitlar: List<KayitGorunumu>, simdi: ZonedDateTime, gonderim: Gonderim = Gonderim.GONDERILIYOR): List<Oge> {
        val (acikler, kapalilar) = kayitlar.partition { acik(it.kayit) }
        val (notlar, yapilacak) = acikler.partition { it.kayit.tur == KayitTuru.NOT }
        val cikti = mutableListOf<Oge>()
        fun ekle(grup: Grup, l: List<KayitGorunumu>) {
            if (l.isEmpty()) return
            cikti += Oge.Baslik(grup, l.size)
            l.forEach { cikti += Oge.Satir(satir(it, simdi, grup, null, gonderim)) }
        }
        ekle(Grup.YAPILACAK, yapilacak)
        ekle(Grup.NOTLAR, notlar)
        ekle(Grup.KAPALI, kapalilar)
        if (cikti.isEmpty()) cikti += Oge.Bos("Tarihsiz kayıt yok. Görevler ve notlar burada durur.")
        return cikti
    }

    /** Yardımcı görünümler (taslaklar, silinenler): tek grup, çekirdeğin sırası. */
    fun duz(kayitlar: List<KayitGorunumu>, simdi: ZonedDateTime, grup: Grup, bosMetin: String, gonderim: Gonderim = Gonderim.GONDERILIYOR): List<Oge> {
        if (kayitlar.isEmpty()) return listOf(Oge.Bos(bosMetin))
        return listOf(Oge.Baslik(grup, kayitlar.size)) +
            kayitlar.map { Oge.Satir(satir(it, simdi, grup, konum(it.kayit.zaman, simdi.zone), gonderim)) }
    }

    // ---------------------------------------------------------------------------------------------
    // Satır
    // ---------------------------------------------------------------------------------------------

    enum class Isaret(val metin: String) {
        TASLAK("Taslak"),
        ASISTAN("Asistan"),
        GONDERILIYOR("Gönderiliyor"),
        /** Eşleşmiş ama PC'ye bağlı değil: değişiklik telefonda, bağlanınca gider. */
        BEKLIYOR("PC'yi bekliyor"),
        TEKRAR("Tekrar"),
        SILINDI("Silindi"),
    }

    /**
     * Kuyruktaki (henüz PC'ye ulaşmamış) değişikliğin gerçek durumu: rozet ve ekran okuyucu metni bunu
     * söyler, gönderim iddiası yalnız gerçekten gönderilirken yapılır.
     */
    enum class Gonderim(val isaret: Isaret?, val okunus: String?) {
        /** Eşleşme yok: gönderilecek yer yok; değişiklik yalnız bu telefonda (rozet yok). */
        YEREL(null, null),

        /** Eşleşmiş, PC'ye bağlı değil ya da bağlanıyor: bağlanınca gider. */
        BEKLIYOR(Isaret.BEKLIYOR, "PC'ye gönderilmeyi bekliyor"),

        /** PC'ye bağlı (canlı): kuyruk sırayla gidiyor. */
        GONDERILIYOR(Isaret.GONDERILIYOR, "PC'ye gönderiliyor"),
        ;

        companion object {
            /** [adresVar]: `baglantiAdresi() != null` (eşleşme ya da süren eşleştirme var). */
            fun hesapla(adresVar: Boolean, asama: BaglantiAsamasi?): Gonderim = when {
                !adresVar -> YEREL
                asama == BaglantiAsamasi.CANLI -> GONDERILIYOR
                else -> BEKLIYOR
            }
        }
    }

    fun otomatikMi(k: AjandaKaynagi) = k.yol != KaynakYolu.ELLE && k.yol != KaynakYolu.SESLI_NOT

    /** Kaynağın tek satırlık açıklaması (ayrıntı ekranı). */
    fun kaynakMetni(k: AjandaKaynagi): String = when (k.yol) {
        KaynakYolu.ELLE -> "Elle eklendi"
        KaynakYolu.SESLI_NOT -> "Sesli notla eklendi"
        KaynakYolu.SOHBET_ARACI ->
            if (k.turKokeni == TurKokeni.INSAN) "Asistan, sohbette söylediğiniz üzerine ekledi"
            else "Asistan kendiliğinden ekledi (sizin yazmadığınız bir turda)"
        KaynakYolu.PC_ARACI ->
            if (k.turKokeni == TurKokeni.INSAN) "PC'deki oturum, isteğiniz üzerine ekledi"
            else "PC'deki oturum kendiliğinden ekledi"
        KaynakYolu.ARKA_PLAN -> "Konuşmalardan otomatik çıkarıldı"
    }

    data class KayitSatiri(
        val kayitId: String,
        val baslik: String,
        /** Zaman ve kısa bilgi satırı ("15:00 · 45 dk", "Pzt 1 Ara", "“haftaya bir ara”"). */
        val alt: String?,
        val isaretler: List<Isaret>,
        val tur: KayitTuru,
        val kapali: Boolean,
        val gecikmis: Boolean,
        val taslak: Boolean,
        val silindi: Boolean,
        /** Tamamlama kutusu gösterilir mi (notlarda ve silinmişte yok). */
        val tamamlanabilir: Boolean,
        /** Ekran okuyucu için tam cümle. */
        val aciklama: String,
    )

    fun satir(g: KayitGorunumu, simdi: ZonedDateTime, grup: Grup, konum: Konum?, gonderim: Gonderim = Gonderim.GONDERILIYOR): KayitSatiri {
        val bekleyen = gonderim.isaret.takeIf { g.bekleyen }
        val k = g.kayit
        val bugun = simdi.toLocalDate()
        val isaretler = buildList {
            if (k.taslak) add(Isaret.TASLAK)
            if (otomatikMi(k.kaynak)) add(Isaret.ASISTAN)
            bekleyen?.let { add(it) }
            if (k.tekrar != null) add(Isaret.TEKRAR)
            if (k.silindi) add(Isaret.SILINDI)
        }
        val zamanMetni = zamanMetni(k, konum, grup, simdi)
        val alt = listOfNotNull(
            EkranMetinleri.tur(k.tur).takeIf { k.tur != KayitTuru.GOREV },
            zamanMetni,
            if (zamanMetni == null) ilkSatir(k.aciklama) else null,
        ).joinToString(" · ").ifEmpty { null }
        val kapali = k.durum != KayitDurumu.ACIK
        val gecikmis = grup == Grup.GECIKMIS
        val aciklama = buildString {
            append(EkranMetinleri.tur(k.tur)).append(": ").append(k.baslik)
            zamanMetni?.let { append(", ").append(it) }
            if (k.durum == KayitDurumu.TAMAM) append(", tamamlandı")
            if (k.durum == KayitDurumu.IPTAL) append(", iptal edildi")
            if (gecikmis) append(", gecikmiş")
            if (k.taslak) append(", taslak, onay bekliyor")
            if (otomatikMi(k.kaynak)) append(", asistan ekledi")
            if (g.bekleyen) gonderim.okunus?.let { append(", ").append(it) }
            if (k.silindi) append(", silindi")
        }
        return KayitSatiri(
            kayitId = k.kayitId,
            baslik = k.baslik,
            alt = alt,
            isaretler = isaretler,
            tur = k.tur,
            kapali = kapali,
            gecikmis = gecikmis,
            taslak = k.taslak,
            silindi = k.silindi,
            tamamlanabilir = !k.silindi && k.tur != KayitTuru.NOT,
            aciklama = aciklama,
        )
    }

    private fun ilkSatir(s: String?): String? =
        s?.lineSequence()?.firstOrNull { it.isNotBlank() }?.trim()?.let { if (it.length > 80) it.take(79) + "…" else it }

    /** Satırın zaman metni; grubun başlığı zaten söylediğini tekrarlamaz. */
    fun zamanMetni(k: AjandaKaydi, konum: Konum?, grup: Grup, simdi: ZonedDateTime): String? {
        val z = k.zaman ?: return null
        if (z is AjandaZamani.Belirsiz) return "“${z.ifade}”"
        val bugun = simdi.toLocalDate()
        val kn = konum ?: return null
        val parcalar = mutableListOf<String>()
        val donem = z is AjandaZamani.Donem
        if (donem) {
            parcalar += "${EkranMetinleri.kisaTarih(kn.ilkGun, bugun)} – ${EkranMetinleri.kisaTarih(kn.sonGun, bugun)}"
        } else {
            when (grup) {
                Grup.BUGUN, Grup.YARIN -> Unit
                Grup.BU_HAFTA -> parcalar += EkranMetinleri.gunAdi(kn.ilkGun.dayOfWeek)
                else -> parcalar += EkranMetinleri.gunluTarih(kn.ilkGun, bugun)
            }
            val s = kn.saat
            when {
                s != null -> parcalar += EkranMetinleri.saat(s)
                grup == Grup.BUGUN || grup == Grup.YARIN -> parcalar += "Tüm gün"
            }
            if (z is AjandaZamani.An) z.sureDk?.let { parcalar += EkranMetinleri.sure(it) }
            kn.kendiSaati?.let { parcalar += "($it)" }
            if (grup == Grup.BUGUN && s != null && acik(k) && kn.ilkGun == bugun && s < simdi.toLocalTime()) parcalar += "geçti"
        }
        if (grup == Grup.GECIKMIS) parcalar += EkranMetinleri.gecenSure(ChronoUnit.DAYS.between(kn.sonGun, bugun))
        return parcalar.joinToString(" · ").ifEmpty { null }
    }
}
