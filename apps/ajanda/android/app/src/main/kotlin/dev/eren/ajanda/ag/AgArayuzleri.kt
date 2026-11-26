package dev.eren.ajanda.ag

import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.Gozlemci
import dev.eren.ajanda.cekirdek.Tasima
import java.util.concurrent.Executor
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

/*
 * Ağ paketinin dış dünyaya açılan yüzleri. Mantık (`AjandaSoketi`, `BaglantiDenetcisi`, `ArkaPlanEsitleme`)
 * yalnız bunları görür: Android çerçevesi gerektirmez, JVM birim testinde sahteleriyle sınanır. Gerçek
 * uygulamalar: `OkHttpSoketAcici`, `CekirdekKanali`, `YurutucuZamanlayici`, `AndroidAg.kt`.
 */

/** Çekirdeğin ağ parçasının kullandığı yüzü. Çağrılar eşzamanlıdır: ana iş parçacığından yapılmaz. */
interface KanalCekirdegi {
    fun baglantiAdresi(): String?
    fun baglantiAcildi(tasima: Tasima): ULong
    fun cerceveGeldi(nesil: ULong, metin: String)
    /** [kod]: karşı tarafın kapanış çerçevesindeki kod (geldiyse); 1002 sürüm uyuşmazlığıdır. */
    fun baglantiKapandi(nesil: ULong, kod: Int?)
    fun baglantiDurumu(): BaglantiDurumu
    fun gozlemciEkle(gozlemci: Gozlemci): ULong
}

class CekirdekKanali(private val c: Cekirdek) : KanalCekirdegi {
    override fun baglantiAdresi(): String? = c.baglantiAdresi()
    override fun baglantiAcildi(tasima: Tasima): ULong = c.baglantiAcildi(tasima)
    override fun cerceveGeldi(nesil: ULong, metin: String) = c.cerceveGeldi(nesil, metin)
    override fun baglantiKapandi(nesil: ULong, kod: Int?) = c.baglantiKapandi(nesil, kod)
    override fun baglantiDurumu(): BaglantiDurumu = c.baglantiDurumu()
    override fun gozlemciEkle(gozlemci: Gozlemci): ULong = c.gozlemciEkle(gozlemci)
}

/** Ham WebSocket'in yazma ucu. Hiçbiri bloklamaz, hiçbiri atmaz. */
interface HamSoket {
    /** Metin çerçevesini sıraya koyar; `false`: soket kapanıyor ya da kuyruk dolu. */
    fun gonder(metin: String): Boolean

    /** Kapanış el sıkışmasını başlatır (karşıya kapanış çerçevesi). */
    fun kapat(kod: Int)

    /** El sıkışmasız hemen keser (açılmamış bağlantıda da). */
    fun iptal()
}

/**
 * Ham soketin olayları. `acildi`, `mesaj`, `ikiliMesaj`, `kapaniyor` okuma iş parçacığında sırayla gelir;
 * `kapandi` herhangi bir iş parçacığından ve birden çok kez gelebilir (ör. `kapaniyor` + `kapandi`).
 */
interface HamDinleyici {
    /** Yükseltme tamam. `soket`, `SoketAcici.ac`'ın döndürdüğüyle aynıdır (açılış ondan önce gelebilir). */
    fun acildi(soket: HamSoket)
    fun mesaj(metin: String)

    /** İkili çerçeve: `/ajanda` metin protokolüdür. */
    fun ikiliMesaj()

    /** Karşı taraf kapanış çerçevesi yolladı. */
    fun kapaniyor(kod: Int)

    /** Bağlantı bitti (açılamadı, koptu, kapanış tamamlandı). */
    fun kapandi(tur: KapanisTuru)
}

fun interface SoketAcici {
    /** Hemen döner; açılış ve sonraki olaylar [dinleyici]'ye gelir. Adres biçimi bozuksa atabilir. */
    fun ac(adres: String, dinleyici: HamDinleyici): HamSoket
}

/** Bir bağlantının neden bittiği (günlük ve yeniden deneme kararı için; çekirdeğe gitmez). */
enum class KapanisTuru {
    /** Karşı taraf kapanış çerçevesi yolladı. */
    KARSI_KAPATTI,

    /** Ağ hatası, açılamama, beklenmeyen kopma. */
    HATA,

    /** Ping yanıtsız kaldı ya da açılış/TCP süresi doldu. */
    ZAMAN_ASIMI,

    /** Yönetici bıraktı (arayüz kapandı, arka plan oturumu bitti). Yeniden denenmez. */
    BIZ_KAPATTIK,

    /** Çekirdek `Tasima.kapat` dedi (protokol hatası, kimlik reddi, eşleşme değişimi). */
    CEKIRDEK_KAPATTI,

    /** Gelen ya da giden çerçeve `AZAMI_CERCEVE`'yi aştı (kapanış kodu 1009). */
    CERCEVE_SINIRI,

    /** İkili çerçeve geldi (kapanış kodu 1003). */
    PROTOKOL,

    /** Soket açıldı ama çekirdek kabul etmedi (`baglantiAcildi` hata): çekirdeğe kapanış bildirilmez. */
    ACILAMADI,
}

fun interface Iptal {
    fun iptal()
}

/**
 * Yöneticinin TEK sıralı iş parçacığı ve zamanlayıcısı: `execute` ve `sonra` aynı sıraya girer
 * (FIFO; aynı anda olgunlaşanlar veriliş sırasıyla). Yöneticinin bütün durumu yalnız burada değişir.
 */
interface Zamanlayici : Executor {
    /** Tekdüze saat (ms); duvar saati değil. */
    fun simdiMs(): Long
    fun sonra(gecikmeMs: Long, is_: Runnable): Iptal
}

/** Gerçek zamanlayıcı: tek artalan iş parçacığı. Android'e bağlı değil (JVM testinde de kullanılır). */
class YurutucuZamanlayici(ad: String) : Zamanlayici {
    private val yurutucu = ScheduledThreadPoolExecutor(1) { r -> Thread(r, ad).apply { isDaemon = true } }.apply {
        removeOnCancelPolicy = true
    }

    override fun simdiMs(): Long = System.nanoTime() / 1_000_000

    override fun execute(command: Runnable) {
        yurutucu.execute(command)
    }

    override fun sonra(gecikmeMs: Long, is_: Runnable): Iptal {
        val f = yurutucu.schedule(is_, gecikmeMs.coerceAtLeast(0), TimeUnit.MILLISECONDS)
        return Iptal { f.cancel(false) }
    }

    /** Yalnız test: iş parçacığını durdurur. */
    fun kapat() {
        yurutucu.shutdownNow()
    }
}

/** Varsayılan ağın durumu. */
interface AgIzleyici {
    /**
     * Bir kez çağrılır: [dinleyici]'yi kaydeder ve şimdiki durumu döner. [dinleyici] herhangi bir iş
     * parçacığından çağrılır: `true` yeni bir varsayılan ağ kullanılabilir oldu (ilk ya da değişen),
     * `false` ağ kalmadı ya da uygulamaya engellendi.
     */
    fun baslat(dinleyici: (agVar: Boolean) -> Unit): Boolean
}

/** JobScheduler işlerinin kurulumu (`EsitlemeIsi`). Hepsi tekrarlı çağrıya dayanıklı. */
interface IsPlanlayici {
    /** Periyodik eşitleme işi yoksa kurar (varsa dönemini sıfırlamamak için dokunmaz). */
    fun periyodikKur()

    /** Eşleşme kalmadı: periyodik işi kaldırır. */
    fun periyodikIptal()

    /** Arayüz kapanırken kuyrukta işlem kaldı: ağ gelince bir kez çalışacak iş. */
    fun kuyrukIsiKur()
}

/** Günlük. Çerçeve içeriği, kayıt metni, adres ve anahtar malzemesi YAZILMAZ; istisnanın yalnız türü. */
interface Gunluk {
    fun bilgi(mesaj: String)
    fun uyari(mesaj: String, hata: Throwable? = null)
}

/** İstisnanın günlüğe girebilecek tek parçası: sınıf adı (mesajı veriden türemiş olabilir). */
internal fun Throwable.tur(): String = javaClass.simpleName
