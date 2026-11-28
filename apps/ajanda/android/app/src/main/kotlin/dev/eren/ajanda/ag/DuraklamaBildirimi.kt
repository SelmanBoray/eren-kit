package dev.eren.ajanda.ag

import android.content.Context
import dev.eren.ajanda.CekirdekErisimi
import dev.eren.ajanda.alarm.Bildirimler
import dev.eren.ajanda.cekirdek.GecisOzeti
import dev.eren.ajanda.kimlik.GecisMetinleri
import dev.eren.ajanda.kimlik.GecisMetni

/**
 * K5: bağlı kipten yerel kipe geçtikten sonra (en çok servis farklı `depo_id` getirince, `GecisNedeni.DEPO_DEGISTI`)
 * eşleşme kalır ama her arka plan eşitlemesi `ArkaPlanSonucu.YEREL_KIP` ile biter; kullanıcı uygulamayı açana dek
 * eşitleme sessizce durur. Bu sınıf (saf; Android'e dokunan kısım arayüzlerin arkasında) bunu **geçiş başına bir
 * kez** bildirir:
 * - Yalnız `YEREL_KIP` sonucunda, `sonGecis()` varsa ve bu geçiş daha önce gösterilmediyse
 *   (`GecisMetinleri.gosterilmeli` + saklı `tsMs`). Geçiş yoksa (hiç bağlı olmamış kurulum) bildirim yok.
 * - Uygulama görünürken gösterilmez (arayüz durumu kendisi söyler; saklanmaz, uygulama gizlenince sonraki iş gösterir).
 * - Metin `GecisMetinleri.duraklama`: "onayınızı bekliyor" yalnız `birlestirmeOnizlemesi()` doluysa.
 * - Gösterilemediyse (bildirim izni ya da kanal kapalı) sessizce atlanır, saklanmaz; durum `sonGecis()`'te saklıdır.
 * - `ESITLENDI` ya da `ESLESME_YOK`: duraklama bitti, bildirim (varsa) kaldırılır.
 *
 * Arayüz aynı geçişi kendisi gösterdiyse [gecisGosterildi] ile işaretler (bildirim yinelenmez).
 * Çağrı `EsitlemeIsi`'nin iş parçacığında (çekirdek çağrısı; ana iş parçacığı değil). Hiçbir hata dışarı çıkmaz.
 */
class DuraklamaBildirimi(
    private val cekirdek: DuraklamaCekirdegi,
    private val gosterilen: GosterilenGecis,
    private val bildirici: DuraklamaBildiricisi,
    private val gorunur: () -> Boolean,
    private val gunluk: Gunluk,
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
        val g = cekirdek.sonGecis() ?: return
        if (!GecisMetinleri.gosterilmeli(g, gosterilen.oku())) return
        val metin = GecisMetinleri.duraklama(g, cekirdek.birlestirmeBekliyor())
        if (bildirici.goster(metin)) gosterilen.yaz(g.tsMs)
    }

    companion object {
        private const val TERCIHLER = "ajanda_durum_bildirimi"
        private const val GOSTERILEN_TS = "gosterilen_gecis_ts"

        /** Üretim örneği (her çağrıda kurulur: yalnız tercih ve çekirdek erişimi). */
        fun uretim(context: Context): DuraklamaBildirimi {
            val uygulama = context.applicationContext
            return DuraklamaBildirimi(
                cekirdek = object : DuraklamaCekirdegi {
                    override fun sonGecis(): GecisOzeti? = CekirdekErisimi.al(uygulama).sonGecis()
                    override fun birlestirmeBekliyor(): Boolean = CekirdekErisimi.al(uygulama).birlestirmeOnizlemesi() != null
                },
                gosterilen = TercihGosterilenGecis(uygulama),
                bildirici = object : DuraklamaBildiricisi {
                    override fun goster(m: GecisMetni): Boolean =
                        Bildirimler.durumGoster(uygulama, Bildirimler.DURUM_ESITLEME, m.baslik, m.govde)

                    override fun kaldir() = Bildirimler.durumKaldir(uygulama, Bildirimler.DURUM_ESITLEME)
                },
                gorunur = { BaglantiYoneticisi.arayuzGorunur },
                gunluk = LogGunluk,
            )
        }

        /** Arayüz bu geçişi (`GecisOzeti.tsMs`) kullanıcıya gösterdi: bildirimi gösterilmez, varsa kaldırılır. */
        fun gecisGosterildi(context: Context, tsMs: Long) {
            TercihGosterilenGecis(context.applicationContext).yaz(tsMs)
            Bildirimler.durumKaldir(context.applicationContext, Bildirimler.DURUM_ESITLEME)
        }

        /** Bildirimle ya da [gecisGosterildi] ile gösterilmiş son geçişin `tsMs`'i (yoksa `null`). */
        fun gosterilenGecis(context: Context): Long? = TercihGosterilenGecis(context.applicationContext).oku()

        private class TercihGosterilenGecis(context: Context) : GosterilenGecis {
            private val p = context.getSharedPreferences(TERCIHLER, Context.MODE_PRIVATE)
            override fun oku(): Long? = if (p.contains(GOSTERILEN_TS)) p.getLong(GOSTERILEN_TS, 0) else null
            override fun yaz(tsMs: Long) {
                p.edit().putLong(GOSTERILEN_TS, tsMs).commit()
            }
        }
    }
}

/** Duraklama bildiriminin çekirdekten okuduğu (üretimde `Cekirdek.sonGecis`, `birlestirmeOnizlemesi`). */
interface DuraklamaCekirdegi {
    fun sonGecis(): GecisOzeti?

    /** `birlestirmeOnizlemesi() != null`: onay gerçekten bekleniyor. */
    fun birlestirmeBekliyor(): Boolean
}

/** Gösterilmiş son geçişin `tsMs`'i (üretimde `SharedPreferences`). */
interface GosterilenGecis {
    fun oku(): Long?
    fun yaz(tsMs: Long)
}

/** Durum kanalında eşitleme bildirimi. `goster` `false`: izin ya da kanal kapalı, gösterilmedi. */
interface DuraklamaBildiricisi {
    fun goster(m: GecisMetni): Boolean
    fun kaldir()
}
