package dev.eren.ajanda.ag

import android.content.Context
import dev.eren.ajanda.CekirdekErisimi
import dev.eren.ajanda.alarm.Bildirimler
import dev.eren.ajanda.cekirdek.EslesmeDurumu
import dev.eren.ajanda.cekirdek.GecisOzeti
import dev.eren.ajanda.kimlik.GecisMetinleri
import dev.eren.ajanda.kimlik.GecisMetni

/**
 * K5: yerel kipte eşleşme varken her arka plan eşitlemesi `ArkaPlanSonucu.YEREL_KIP` ile biter (bağlanılmaz);
 * kullanıcı uygulamayı açana dek eşitleme sessizce durur. Bu sınıf (saf; Android'e dokunan kısım arayüzlerin
 * arkasında) bunu duraklama başına **bir kez** bildirir. Duraklamanın kimliği, öncelik sırasıyla:
 * 1. **Onay bekleyen plan** (`birlestirmeOnizlemesi()?.iz`): her yeni plan bir kez ("onayınızı bekliyor"); geçiş
 *    olsun olmasın, geçiş gösterilmiş olsun olmasın. Geçişin bildirim işaretine yazmaz (K7): metin geçişi
 *    anlatmaz; geçiş özeti uygulamada (ya da plan kalktıktan sonra 2. adımda) söylenir.
 * 2. **Henüz söylenmemiş geçiş** (`sonGecis()`; `GecisMetinleri.bildirimdeGosterilmeli` + saklı `tsMs`; arayüz
 *    [gecisGosterildi] ile işaretlediyse söylenmiş sayılır): geçiş başına bir kez, `GecisMetinleri.duraklama` metni.
 *    E3: bildirimin "söyledim" işareti ([gosterilen]) ile uygulamanın "gösterdim" işareti ([uygulamada]) iki ayrı
 *    kayıttır; bildirim yalnız kendininkine yazar, uygulamanın penceresi bu yüzden susmaz
 *    (`GecisMetinleri.uygulamadaGosterilmeli`; `DEPO_DEGISTI` uygulamada hep bir kez gösterilir).
 * 3. **Eşleşme** (`eslesmeDurumu()`): geçiş yoksa (ilk eşleşme) ya da söylendiyse (arayüz gösterdi; koparmadan sonra
 *    yeniden eşleşme): eşleşme başına bir kez, genel metin ([ESITLEME_BEKLIYOR]).
 * Plan ya da geçiş bildirildiyse o eşleşmenin duraklaması da söylenmiş sayılır (plan düşünce genel metin
 * yinelenmez; söylenmemiş geçiş varsa onun metni bir kez gelir).
 * - Uygulama görünürken gösterilmez (arayüz durumu kendisi söyler; saklanmaz, uygulama gizlenince sonraki iş gösterir).
 * - Gösterilemediyse (bildirim izni ya da kanal kapalı) sessizce atlanır, saklanmaz.
 * - `ESITLENDI` ya da `ESLESME_YOK`: duraklama bitti, bildirim (varsa) kaldırılır.
 *
 * Çağrı `EsitlemeIsi`'nin iş parçacığında (çekirdek çağrısı; ana iş parçacığı değil). Hiçbir hata dışarı çıkmaz.
 */
class DuraklamaBildirimi(
    private val cekirdek: DuraklamaCekirdegi,
    private val gosterilen: GosterilenGecis,
    private val bildirici: DuraklamaBildiricisi,
    private val gorunur: () -> Boolean,
    private val gunluk: Gunluk,
    private val duraklama: GosterilenDuraklama = GosterilenDuraklama.Yok,
    /** Uygulamanın "gösterdim" işareti (E3): yalnız okunur; bildirim ona hiç yazmaz. */
    private val uygulamada: GosterilenGecis = GosterilenGecis.Yok,
) {
    fun arkaPlanBitti(sonuc: ArkaPlanSonucu) {
        try {
            when (sonuc) {
                ArkaPlanSonucu.YEREL_KIP -> duraklamayiBildir()
                ArkaPlanSonucu.ESITLENDI, ArkaPlanSonucu.ESLESME_YOK -> bildirici.kaldir()
                else -> Unit
            }
        } catch (e: Exception) {
            gunluk.uyari("duraklama bildirimi başarısız", e)
        }
    }

    private fun duraklamayiBildir() {
        if (gorunur()) return
        val plan = cekirdek.bekleyenPlan()
        val g = cekirdek.sonGecis()
        val eslesme = cekirdek.eslesme()
        if (plan != null) {
            if (plan == duraklama.plan()) return
            val metin = if (g != null) GecisMetinleri.duraklama(g, birlestirmeBekliyor = true) else ONAY_BEKLIYOR
            if (bildirici.goster(metin)) {
                // Geçişin işaretine yazılmaz (K7): plan metni geçişi anlatmaz ("onayınızı bekliyor"). Yazsaydı
                // uygulama geçiş özetini (koparma, eşleşmeyi kaldırma) bir daha göstermezdi; uygulama onu
                // işaretlemeden süreç öldüyse özet hiç görünmezdi.
                duraklama.planYaz(plan)
                eslesme?.let(duraklama::eslesmeYaz)
            }
            return
        }
        if (g != null && GecisMetinleri.bildirimdeGosterilmeli(g, gosterilen.oku(), uygulamada.oku())) {
            // Henüz söylenmemiş geçiş: onun metni; o eşleşmenin duraklaması da söylenmiş sayılır.
            if (bildirici.goster(GecisMetinleri.duraklama(g, birlestirmeBekliyor = false))) {
                gosterilen.yaz(g.tsMs)
                eslesme?.let(duraklama::eslesmeYaz)
            }
            return
        }
        // Geçiş yok (ilk eşleşme) ya da söylendi (arayüz gösterdi; koparmadan sonra yeniden eşleşme): eşleşme başına bir kez.
        val e = eslesme ?: return
        if (e == duraklama.eslesme()) return
        if (bildirici.goster(ESITLEME_BEKLIYOR)) duraklama.eslesmeYaz(e)
    }

    companion object {
        private const val TERCIHLER = "ajanda_durum_bildirimi"
        /**
         * Bildirimin "söyledim" işareti. Eski kurulumlardaki tek ortak kayıt budur (E3 öncesi); geçişte olduğu gibi
         * bildirim işareti sayılır, uygulamanın işareti ([UYGULAMADA_GOSTERILEN_TS]) boş başlar: geçiş uygulamada
         * en çok bir kez yeniden görünür, hiçbir geçiş kaybolmaz.
         */
        private const val GOSTERILEN_TS = "gosterilen_gecis_ts"

        /** Uygulamanın "gösterdim" işareti (E3). */
        private const val UYGULAMADA_GOSTERILEN_TS = "uygulamada_gosterilen_gecis_ts"
        private const val GOSTERILEN_PLAN = "gosterilen_duraklama_plani"
        private const val GOSTERILEN_ESLESME = "gosterilen_duraklama_eslesmesi"

        /** Geçiş özeti yokken onay bekleyen plan (metin `GecisMetinleri.duraklama`'nınkiyle aynı). */
        internal val ONAY_BEKLIYOR = GecisMetni(
            "Birleştirme onayınızı bekliyor",
            listOf(
                "Eren servisiyle eşitleme, birleştirmeyi onaylayana ya da vazgeçene dek duruyor.",
                "Kayıtlarınız bu telefonda duruyor; onaylamadan servise gönderilmez.",
            ),
        )

        /** Söylenecek geçiş yokken (ilk eşleşme, yeniden eşleşme, arayüzün gösterdiği geçiş) duran eşitleme. */
        internal val ESITLEME_BEKLIYOR = GecisMetni(
            "Eşitleme bekliyor",
            listOf(
                "Eren servisiyle eşitleme arka planda yapılmıyor; bağlantı uygulama açıkken kurulur.",
                "Kayıtlarınız bu telefonda duruyor; sorulmadan servise gönderilmez.",
                "Uygulamayı açtığınızda bağlanır; gönderilecek bir şey varsa birleştirmeyi size sorar.",
            ),
        )

        /** Üretim örneği (her çağrıda kurulur: yalnız tercih ve çekirdek erişimi). */
        fun uretim(context: Context): DuraklamaBildirimi {
            val uygulama = context.applicationContext
            return DuraklamaBildirimi(
                cekirdek = object : DuraklamaCekirdegi {
                    override fun sonGecis(): GecisOzeti? = CekirdekErisimi.al(uygulama).sonGecis()
                    override fun bekleyenPlan(): String? = CekirdekErisimi.al(uygulama).birlestirmeOnizlemesi()?.iz
                    override fun eslesme(): String? = when (val d = CekirdekErisimi.al(uygulama).eslesmeDurumu()) {
                        is EslesmeDurumu.Eslesti -> "eslesti:${d.deviceId}"
                        is EslesmeDurumu.Bekliyor -> "bekliyor:${d.host}:${d.port}"
                        else -> null
                    }
                },
                duraklama = TercihGosterilenDuraklama(uygulama),
                gosterilen = TercihGosterilenGecis(uygulama, GOSTERILEN_TS),
                uygulamada = TercihGosterilenGecis(uygulama, UYGULAMADA_GOSTERILEN_TS),
                bildirici = object : DuraklamaBildiricisi {
                    override fun goster(m: GecisMetni): Boolean =
                        Bildirimler.durumGoster(uygulama, Bildirimler.DURUM_ESITLEME, m.baslik, m.govde)

                    override fun kaldir() = Bildirimler.durumKaldir(uygulama, Bildirimler.DURUM_ESITLEME)
                },
                gorunur = { BaglantiYoneticisi.arayuzGorunur },
                gunluk = LogGunluk,
            )
        }

        /**
         * Arayüz bu geçişi (`GecisOzeti.tsMs`) kullanıcıya gösterdi: uygulamanın işaretine yazılır (bildirimin
         * işaretine değil), bildirim artık onu söylemez, varsa kaldırılır.
         */
        fun gecisGosterildi(context: Context, tsMs: Long) {
            TercihGosterilenGecis(context.applicationContext, UYGULAMADA_GOSTERILEN_TS).yaz(tsMs)
            Bildirimler.durumKaldir(context.applicationContext, Bildirimler.DURUM_ESITLEME)
        }

        /**
         * Uygulama içi geçiş penceresi bu geçiş için açılmalı mı (`GecisMetinleri.uygulamadaGosterilmeli`; iki
         * işaretle). Gösterince [gecisGosterildi] çağrılır. Çekirdek çağrısı yok; tercih okur (ana iş parçacığında
         * kısa disk okuması olabilir).
         */
        fun uygulamadaGosterilmeli(context: Context, g: GecisOzeti?): Boolean {
            val u = context.applicationContext
            return GecisMetinleri.uygulamadaGosterilmeli(
                g,
                uygulamadaTsMs = TercihGosterilenGecis(u, UYGULAMADA_GOSTERILEN_TS).oku(),
                bildirimdeTsMs = TercihGosterilenGecis(u, GOSTERILEN_TS).oku(),
            )
        }

        /** Uygulamanın [gecisGosterildi] ile işaretlediği son geçişin `tsMs`'i (yoksa `null`). */
        fun uygulamadaGosterilenGecis(context: Context): Long? =
            TercihGosterilenGecis(context.applicationContext, UYGULAMADA_GOSTERILEN_TS).oku()

        /** Bildirimin söylediği son geçişin `tsMs`'i (eski kurulumun tek kaydı dahil; yoksa `null`). */
        fun bildirimdeGosterilenGecis(context: Context): Long? =
            TercihGosterilenGecis(context.applicationContext, GOSTERILEN_TS).oku()

        private class TercihGosterilenGecis(context: Context, private val anahtar: String) : GosterilenGecis {
            private val p = context.getSharedPreferences(TERCIHLER, Context.MODE_PRIVATE)
            override fun oku(): Long? = if (p.contains(anahtar)) p.getLong(anahtar, 0) else null
            override fun yaz(tsMs: Long) {
                p.edit().putLong(anahtar, tsMs).commit()
            }
        }

        private class TercihGosterilenDuraklama(context: Context) : GosterilenDuraklama {
            private val p = context.getSharedPreferences(TERCIHLER, Context.MODE_PRIVATE)
            override fun plan(): String? = p.getString(GOSTERILEN_PLAN, null)
            override fun planYaz(iz: String) {
                p.edit().putString(GOSTERILEN_PLAN, iz).commit()
            }
            override fun eslesme(): String? = p.getString(GOSTERILEN_ESLESME, null)
            override fun eslesmeYaz(kimlik: String) {
                p.edit().putString(GOSTERILEN_ESLESME, kimlik).commit()
            }
        }
    }
}

/** Duraklama bildiriminin çekirdekten okuduğu (üretimde `Cekirdek.sonGecis`, `birlestirmeOnizlemesi`, `eslesmeDurumu`). */
interface DuraklamaCekirdegi {
    fun sonGecis(): GecisOzeti?

    /** `birlestirmeOnizlemesi()?.iz`: onay gerçekten bekleyen planın izi; yoksa `null`. */
    fun bekleyenPlan(): String?

    /** Eşleşmenin kimliği (eşleşti: cihaz kimliği; QR okundu, bekliyor: adres); eşleşme yoksa `null`. */
    fun eslesme(): String?
}

/** Bildirimle söylenmiş son onay planı ve son eşleşme (üretimde `SharedPreferences`; içerik değil, yalnız iz ve kimlik). */
interface GosterilenDuraklama {
    fun plan(): String?
    fun planYaz(iz: String)
    fun eslesme(): String?
    fun eslesmeYaz(kimlik: String)

    /** Saklamayan (eski kurulum ve testler). */
    object Yok : GosterilenDuraklama {
        override fun plan(): String? = null
        override fun planYaz(iz: String) = Unit
        override fun eslesme(): String? = null
        override fun eslesmeYaz(kimlik: String) = Unit
    }
}

/** Gösterilmiş son geçişin `tsMs`'i (üretimde `SharedPreferences`; bildirimin ve uygulamanın ayrı ayrı). */
interface GosterilenGecis {
    fun oku(): Long?
    fun yaz(tsMs: Long)

    /** Saklamayan (testler; uygulama işareti verilmemiş kurulum). */
    object Yok : GosterilenGecis {
        override fun oku(): Long? = null
        override fun yaz(tsMs: Long) = Unit
    }
}

/** Durum kanalında eşitleme bildirimi. `goster` `false`: izin ya da kanal kapalı, gösterilmedi. */
interface DuraklamaBildiricisi {
    fun goster(m: GecisMetni): Boolean
    fun kaldir()
}
