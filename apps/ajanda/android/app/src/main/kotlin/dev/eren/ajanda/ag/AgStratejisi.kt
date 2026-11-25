package dev.eren.ajanda.ag

import kotlin.math.min
import kotlin.math.pow

/**
 * BAĞLANTI VE ARKA PLAN EŞİTLEME STRATEJİSİ — sayıların ve gerekçelerinin tek yeri.
 *
 * Telefon her zaman arayan taraftır; PC kapalı, Tailscale kopuk ya da telefon uykuda olabilir. PC'nin
 * telefonu uyandırma yolu yoktur (FCM yok, veri yalnız Tailscale'den geçer). Bu yüzden iki kip var:
 *
 * ÖN PLAN (`BaglantiYoneticisi.basla` .. `birak`): tek canlı WebSocket.
 * - Kopunca yeniden deneme: 1 s, 2 s, 4 s ... en çok 60 s, ±%20 sapma ([bekleme]). Sayaç bağlantı
 *   `CANLI`'ya ulaşınca sıfırlanır; yalnız açılmak yetmez: TCP'yi kabul edip el sıkışmayı reddeden ya da
 *   bozuk çerçeve yüzünden çekirdeğin kapattığı bağlantı sıkı döngü yaratmasın.
 * - Ağ yoksa (varsayılan ağ yok ya da uygulamaya engelli) hiç denenmez, bekleyen deneme iptal edilir;
 *   yeni bir varsayılan ağ gelince (ilk ya da değişen: Wi-Fi <-> mobil, Tailscale açıldı) sayaç sıfırlanır
 *   ve hemen denenir. Açık bağlantıya ağ değişiminde dokunulmaz: ölüyse ping en geç ~60 s'de bulur.
 * - `basla` kopukken beklemeyi atlayıp hemen dener (kullanıcı uygulamayı açtı); sayacı sıfırlamaz.
 * - Açılış (TCP + yükseltme) [acilisSuresiMs] içinde bitmezse kesilir: Tailscale uykudan uyanırken ilk
 *   paket birkaç saniye sürebilir, 20 s ondan bol; daha uzunu ölü adresi boşuna bekletir.
 * - Ping 30 s (OkHttp: yanıtsız bir sonraki pingte kopma sayılır). Servis de 30 s'de bir nabız yollar
 *   ve bir tam aralık sessiz kalan ucu keser (`server/src/dis-dunya.ts`); daha sık ping pil yer.
 * - `birak`: [birakmaGecikmesiMs] bekler (döndürme ya da kısa uygulama geçişi el sıkışmayı yinelemesin).
 *   Sonra kuyrukta yollanmamış işlem varsa ve bağlantı sürüyorsa en çok [bosaltmaSuresiMs] daha boşalmasını
 *   bekler; yine kalırsa ağ koşullu tek seferlik iş kurulur (`kuyrukIsiKur`). Daha uzun beklenmez: arka
 *   plandaki süreç dondurulur (Android 14+ önbellek dondurucusu) ve açık soket orada asılı kalır.
 *
 * ARKA PLAN (`EsitlemeIsi`, JobScheduler): uygulama hiç açılmasa da PC'de doğan kayıt telefona insin ve
 * alarmı kurulsun (ürünün vaadi).
 * - Periyodik [PERIYOT_MS] = 15 dk (platformun alt sınırı), ağ koşullu (`NETWORK_TYPE_ANY`), kalıcı
 *   (yeniden başlatmada sürer). Pil/şarj koşulu YOK: randevunun inmesi pilden önemli, oturum kısa.
 *   Kurulum: `basla` eşleşmeli adres görünce (süreçte bir kez; iş zaten varsa dönemini sıfırlamamak için
 *   dokunulmaz). Eşleşme kalmadıysa iş kendini kaldırır.
 * - Oturum: bağlan -> `asama == CANLI && kuyrukta == 0` olunca kapat. Üst sınır [arkaPlanSuresiMs] = 90 s
 *   (ilk tam eşitleme 20 000 kayıtta masaüstünde ~1,3 s; telefonda birkaç kat + Tailscale uyanışı) ve
 *   [arkaPlanDeneme] = 3 başarısız açılış (PC kapalıysa 1 + 2 s sonra bırakır, 90 s tutmaz). Sonra
 *   alarmlar yeniden kurdurulur (`AlarmYenidenKurma.simdi(PERIYODIK)`), `jobFinished(yeniden=false)`:
 *   PC kapalıyken geri çekilmeli yeniden deneme yerine sıradaki dönem beklenir.
 * - Sistem işi durdurursa (`onStopJob`: ağ gitti, süre, kova) bağlantı bırakılır, iş yeniden planlanır.
 *
 * REDDEDİLENLER: kalıcı bağlantılı ön plan hizmeti (sürekli bildirim, pil; Android 15'te `dataSync`
 * günde 6 saatle sınırlı); eşitleme için kesin alarm (USE_EXACT_ALARM yalnız alarm/takvim işlevi içindir,
 * Doze'da en sık ~9 dk, her uyanış radyo açar); WorkManager (AndroidX yok, altında yine JobScheduler);
 * FCM (Google hizmeti ve buluta açılan PC; "veri yalnız Tailscale" ilkesini bozar).
 *
 * ÖLÇÜM (`apps/ajanda-olcum`, "Periyodik iş, ağ koşullu" serisi) SONUCUNA GÖRE:
 * - Aralık ortancası ~15-30 dk: strateji kalır.
 * - Saatlerle ölçülüyor ama muafiyet döneminde ~15 dk: ekran paketi pil optimizasyonu muafiyeti +
 *   Xiaomi otomatik başlatma iznini istemeli (yalnız `PERIYOT_MS` değil, kullanıcı yönlendirmesi).
 * - Muafiyetle de saatler ya da kaydırıp atmada iş siliniyor: arka plan eşitlemesine güvenilmez;
 *   `basla`'nın kurduğu iş açılışta yenilenir, ürün vaadi "PC'de eklenen randevu uygulama açılınca
 *   iner" diye daraltılır (ya da PC tarafında hatırlatma kanalı düşünülür). Bu dosya dışında değişiklik
 *   gerekmez: periyot, süre ve deneme sayısı burada.
 */
data class AgAyarlari(
    val ilkBeklemeMs: Long = 1_000,
    val enCokBeklemeMs: Long = 60_000,
    /** Bekleme ±bu oranda kaydırılır (aynı anda kopan bağlantılar aynı anda dönmesin). */
    val sapma: Double = 0.2,
    val acilisSuresiMs: Long = 20_000,
    /** OkHttp TCP bağlanma ve yükseltme yanıtı süresi (yükseltmeden sonra okuma süresi yoktur, ping vardır). */
    val tcpSuresiMs: Long = 15_000,
    val pingAraligiMs: Long = 30_000,
    /** Bizim başlattığımız kapanışta karşı taraf yanıt vermezse ham soket bu kadar sonra kesilir. */
    val kapatmaBeklemeMs: Long = 5_000,
    val birakmaGecikmesiMs: Long = 3_000,
    val bosaltmaSuresiMs: Long = 10_000,
    val arkaPlanSuresiMs: Long = 90_000,
    val arkaPlanDeneme: Int = 3,
    /** `/ajanda` çerçeve sınırı (UTF-16 birimi = Kotlin `String.length`): `AJANDA_AZAMI_CERCEVE.KANAL`. */
    val azamiCerceve: Int = AZAMI_CERCEVE,
) {
    /**
     * [deneme] art arda başarısız denemeden sonraki bekleme. 0 -> hemen. [r] 0..1 (sapma için;
     * 0,5 = sapmasız). Üst sınır sapmadan sonra uygulanır.
     */
    fun bekleme(deneme: Int, r: Double): Long {
        if (deneme <= 0) return 0
        val taban = min(enCokBeklemeMs.toDouble(), ilkBeklemeMs * 2.0.pow(min(deneme - 1, 30)))
        val kaydirilmis = taban * (1 + sapma * (2 * r.coerceIn(0.0, 1.0) - 1))
        return min(enCokBeklemeMs.toDouble(), kaydirilmis).toLong().coerceAtLeast(0)
    }

    companion object {
        /** `cekirdek/src/model/sinirlar.rs` `AZAMI_CERCEVE_KANAL` (köprüye açık değil; protokolde sabit). */
        const val AZAMI_CERCEVE: Int = 2 * 1024 * 1024
        const val PERIYOT_MS: Long = 15 * 60 * 1000L
        val VARSAYILAN = AgAyarlari()
    }
}
