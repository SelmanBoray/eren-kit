package dev.eren.cihaz.cekirdek

/*
 * Çekirdek birimlerinin birbirine açtığı iç yüzey. Gövdesizdir: her birim yalnız bu dosyaya,
 * `Portlar.kt`, `Sozlesme.kt` ve `Sinirlar.kt`'ye karşı, ötekini görmeden yazılır.
 *
 * Giriş adları sabittir ve birimin kendi dosyasında tanımlanır:
 *   durumsuz birim  -> `object <Ad> : <Ad>Islemi`           (Json, Kanonik, PlanHash, Etiket,
 *                                                            KimlikMetni, Sema, Kapi, DenetimBicimi)
 *   durumlu birim   -> `val <ad>Kur: <Ad>Fabrikasi`         (izinlerKur, listelerKur, denetimKaydiKur,
 *                                                            cihazOturumuKur, komutIsleyiciKur)
 * Fabrika bağımlılıklarını parametre alır; modül düzeyinde değişken durum yok. Hiçbir işlem dışarı
 * istisna sızdırmaz: sonuç kapalı liste ya da `sealed` tiptir. Durumlu nesneler iş parçacığı
 * güvenlidir (WS, komut işçisi, onay ekranı ve zamanlayıcı aynı anda çağırır).
 *
 * `-Pbirim` süzgeci yalnız `Portlar.kt` ve `Sozlesme.kt`'yi ekler: her birim `IcSozlesme`'yi,
 * `Sinirlar` kullanan `Sinirlar`'ı da listeye yazar (ör. `-Pbirim=Sema,Json,Sinirlar,IcSozlesme`).
 */

// ---------------------------------------------------------------------------------------------
// Sozlesme.kt'de olmayan kapalı listeler (protocol/src/hatalar.ts, cihaz.ts, plan.ts, temel.ts)
// ---------------------------------------------------------------------------------------------

/** `error.code`: `hatalar.ts` `HATA_KODLARI` ile aynı sıra. Gelen `error` bunların dışındaysa geçersizdir. */
enum class HataKodu(val kablo: String) {
    PROTOKOL_UYUMSUZ("protokol_uyumsuz"),
    GECERSIZ_MESAJ("gecersiz_mesaj"),
    MESAJ_COK_BUYUK("mesaj_cok_buyuk"),
    ZAMAN_ASIMI("zaman_asimi"),
    IC_HATA("ic_hata"),
    YETKISIZ("yetkisiz"),
    IMZA_GECERSIZ("imza_gecersiz"),
    IP_UYUSMUYOR("ip_uyusmuyor"),
    CIHAZ_BILINMIYOR("cihaz_bilinmiyor"),
    KANAL_DESTEKLENMIYOR("kanal_desteklenmiyor"),
    ESLESTIRME_KAPALI("eslestirme_kapali"),
    ESLESTIRME_KODU_GECERSIZ("eslestirme_kodu_gecersiz"),
    TELEFON_BAGLI_DEGIL("telefon_bagli_degil"),
    BELIRSIZ("belirsiz"),
    PLAN_GECERSIZ("plan_gecersiz"),
    PLAN_BULUNAMADI("plan_bulunamadi"),
    PLAN_HASH_UYUSMUYOR("plan_hash_uyusmuyor"),
    PLAN_ZATEN_SONUCLANDI("plan_zaten_sonuclandi"),
    IZIN_BEKLENIYOR("izin_bekleniyor"),
    IS_BULUNAMADI("is_bulunamadi"),
    IS_ZATEN_BITTI("is_zaten_bitti"),
    RAPOR_YOK("rapor_yok"),
    RAPOR_ZATEN_VERILDI("rapor_zaten_verildi"),
    SORU_BULUNAMADI("soru_bulunamadi"),
    SORU_ZATEN_CEVAPLANDI("soru_zaten_cevaplandi"),
    TUR_GECERSIZ("tur_gecersiz"),
    EREN_HAZIR_DEGIL("eren_hazir_degil"),
    LIMIT_KILITLI("limit_kilitli"),
    JETON_GECERSIZ("jeton_gecersiz"),
    ROL_FIIL_IZINSIZ("rol_fiil_izinsiz"),
    YINELENEN_ISTEK("yinelenen_istek"),
    OZET_REDDEDILDI("ozet_reddedildi"),
}

/** `notify.tur` (cihaz.ts `Notify`). */
enum class BildirimTuru(val kablo: String) {
    PLAN("plan"),
    SORU("soru"),
    IS_BITTI("is_bitti"),
    SISTEM("sistem"),
}

/** `plan.tur` (temel.ts `IS_TURLERI`). */
enum class IsTuru(val kablo: String) {
    PC("pc"),
    TELEFON("telefon"),
}

/** `plan.mcp_profili` (plan.ts `MCP_PROFILLERI`). */
enum class McpProfili(val kablo: String) {
    REA("rea"),
}

/** İmza metnindeki rol (temel.ts `ImzaRolu`). */
enum class ImzaRolu(val kablo: String) {
    PC("pc"),
    TELEFON("telefon"),
}

/** İmza metnindeki kanal (temel.ts `Kanal`). `CIHAZ`'ı yalnız `CihazOturumu` kullanır. */
enum class Kanal(val kablo: String) {
    SOHBET("sohbet"),
    CIHAZ("cihaz"),
}

// ---------------------------------------------------------------------------------------------
// Kararlardaki sayılar (protocol'de olmadıkları için Sinirlar.kt'de değiller)
// ---------------------------------------------------------------------------------------------

object CekirdekSinirlari {
    const val OKUMA_SURESI_MS: Long = 30 * 60_000L
    const val OKUMA_BUTCESI: Int = 100
    const val YAZMA_SURESI_MS: Long = 10 * 60_000L
    const val YAZMA_BUTCESI: Int = 30
    const val AZAMI_SURE_MS: Long = 60 * 60_000L
    const val AZAMI_BUTCE: Int = 300
    const val EYLEM_ARASI_MS: Long = 250
    const val GORUNTU_ARASI_MS: Long = 1_000

    /** `siyahOrani` bu değer ya da üstündeyse `ekran_korumali`. */
    const val SIYAH_ESIGI: Double = 0.99

    /** `hello.client_nonce` ve jeton için `RastgelePortu`'ndan alınan bayt (CIHAZ.md: 32). */
    const val NONCE_BAYT: Int = 32
    const val JETON_BAYT: Int = 32

    /** Bütçeden düşen komutlar (CIHAZ.md "Denetim sırası"); kural 10 yalnız bunlara uygulanır. */
    val EYLEM_KOMUTLARI: Set<CmdAdi> = setOf(
        CmdAdi.CLICK,
        CmdAdi.TYPE_TEXT,
        CmdAdi.KEY,
        CmdAdi.SCROLL,
        CmdAdi.DRAG,
        CmdAdi.OPEN_APP,
    )
}

// ---------------------------------------------------------------------------------------------
// Json: katı ayrıştırıcı + kanonik olmayan yazıcı
// ---------------------------------------------------------------------------------------------

/**
 * Sayılar JS `JSON.parse`'ın verdiği değere göre ayrılır (Zod ile aynı görünsün diye): tam ve
 * güvenli (|n| <= 2^53-1) değer `Tam` (`7`, `1e2`, `1.0`), tam olmayan sonlu değer `Ondalik` (`1.5`).
 */
sealed interface JsonDeger {
    data object Bos : JsonDeger

    data class Mantik(val deger: Boolean) : JsonDeger

    data class Tam(val deger: Long) : JsonDeger

    /** Tam sayı isteyen alan bunu kabul etmez (`12.5` geçersiz); kanonik JSON hiç kabul etmez. */
    data class Ondalik(val deger: Double) : JsonDeger

    /** Çözümden gelen metin iyi biçimli UTF-16'dır; giden metindeki eşsiz vekili `yaz` kaçırır. */
    data class Metin(val deger: String) : JsonDeger

    data class Dizi(val ogeler: List<JsonDeger>) : JsonDeger

    /** Anahtarlar tekil. Sıra metindeki ya da kurulumdaki sıradır; `yaz` korur, `kanonik` sıralar. */
    data class Nesne(val alanlar: Map<String, JsonDeger>) : JsonDeger
}

enum class JsonHatasi {
    /** Dilbilgisi: boş metin, sondaki virgül, yorum, kaçışsız kontrol karakteri, artık metin. */
    BOZUK,
    YINELENEN_ANAHTAR,

    /** Kök derinlik 0; derinliği 32'yi aşan değer (kanonik.ts `AZAMI_DERINLIK` sayımı). */
    COK_DERIN,

    /** Güvenli aralık dışı tam değer, taşan (`1e400`) ya da eksi sıfır (`-0`; Zod kabul eder, çekirdek reddeder). */
    GUVENSIZ_SAYI,

    /** `"\ud800"` gibi eşsiz vekil: cihaz-mesaj.json'un "Kotlin kararını uydurmalı" vektörleri reddedilir. */
    ESSIZ_VEKIL,
}

sealed interface JsonSonucu {
    data class Tamam(val deger: JsonDeger) : JsonSonucu

    data class Hata(val neden: JsonHatasi) : JsonSonucu
}

interface JsonIslemi {
    /** RFC 8259 + `JsonHatasi` katılığı. Kök her türden olabilir. */
    fun coz(metin: String): JsonSonucu

    /**
     * Boşluksuz, nesne sırası korunur, ASCII dışı ham kalır; `"`, `\` ve 0x20 altı kaçırılır, eşsiz
     * vekil `\uXXXX` olur (çıktı her zaman geçerli UTF-8). Sonlu olmayan `Ondalik` `null` yazılır.
     */
    fun yaz(deger: JsonDeger): String
}

// ---------------------------------------------------------------------------------------------
// Kanonik + PlanHash (protocol/src/kanonik.ts, plan.ts)
// ---------------------------------------------------------------------------------------------

enum class KanonikHatasi {
    /** `Ondalik`: kanonik.ts yalnız güvenli tam sayı kabul eder. */
    ONDALIK,
    ESSIZ_VEKIL,
    COK_DERIN,

    /** `__proto__` anahtarı (kanonik.ts ile aynı). */
    YASAK_ANAHTAR,
}

sealed interface KanonikSonucu {
    data class Tamam(val metin: String) : KanonikSonucu

    data class Hata(val neden: KanonikHatasi) : KanonikSonucu
}

interface KanonikIslemi {
    /** `kanonikJson`: anahtarlar UTF-16 birim sırasıyla, kaçış kuralları aynı, normalizasyon yok. */
    fun kanonik(deger: JsonDeger): KanonikSonucu

    /** Saf Kotlin SHA-256 (`java.security` yok); küçük harfli 64 karakter onaltılık. */
    fun sha256Hex(bayt: ByteArray): String
}

interface PlanHashIslemi {
    /**
     * plan.ts `planHash`: `sha256Hex(UTF-8(kanonik(plan)))`. Şemayı denetlemez: girdi
     * `Sema.planCoz`'dan geçmiş `Plan.ham`'dır. Kanonikleşmeyen değerde null.
     */
    fun planHash(plan: JsonDeger): String?
}

// ---------------------------------------------------------------------------------------------
// Etiket: gönder/sil/öde ve parola ipucu sözlükleri
// ---------------------------------------------------------------------------------------------

interface EtiketIslemi {
    /** temel.ts `gorunmezBirimMi` kümesini atar; büyük/küçük harfi ve İ/I/ı/i'yi tek harfe katlar. */
    fun katla(metin: String): String

    /** Katlanmış metin gönder/sil/öde sözlüğüyle eşleşiyor mu. */
    fun eslesir(metin: String): Boolean

    /** `yalniz_oku_etiket`: düğüm, en yakın tıklanabilir atası ya da `torunlar`'dan biri eşleşiyor. */
    fun etiketli(baglam: DugumBaglami): Boolean

    /** `parola_alani`: `parola` doğru ya da `ipucu`/`kaynakId` şifre, PIN, OTP gösteriyor. */
    fun parolaAlani(dugum: Dugum): Boolean
}

// ---------------------------------------------------------------------------------------------
// Listeler: paketin durumu
// ---------------------------------------------------------------------------------------------

/** `app_list` elemanı (cihaz.ts `UygulamaBilgisi`). `ad` PackageManager'dan, güvenilmez metin. */
data class UygulamaBilgisi(val paket: String, val ad: String, val durum: UygulamaDurumu)

data class KuruluUygulama(val paket: String, val ad: String, val imzaOzeti: String)

/** Kullanıcının Uygulamalar ekranındaki kararı: yalnız `ACIK` ya da `HASSAS`; imza özeti karar anındaki. */
data class KullaniciKarari(val durum: UygulamaDurumu, val imzaOzeti: String)

/** Adaptörün verdiği tam girdi; kalıcı saklama adaptördedir. */
data class ListeGirdisi(
    val kurulu: List<KuruluUygulama>,
    val kararlar: Map<String, KullaniciKarari>,
    /** Intent çözümüyle bulunanlar: Ayarlar, kurucu, Play, izin denetleyicisi, ev/kilit ekranı. */
    val cozulenDegismez: Set<String>,
)

interface Listeler {
    /**
     * Sırayla: 1) `DEGISMEZ` (sabit adlar: Ayarlar, kurucu, Play, izin denetleyicisi, üretici güvenlik
     * uygulaması, Tailscale, kilit ekranı, systemui; `kendiPaketi`; `cozulenDegismez`). 2) Kurulu değilse
     * (imza bilgisi yok) `YENI`. 3) Kullanıcı kararı `HASSAS` ise `HASSAS`, imza değişmiş olsa bile.
     * 4) Kullanıcı kararı `ACIK` ve imza özeti şimdikiyle aynıysa `ACIK`. 5) Aksi halde (karar yok ya da
     * `ACIK` kararının imzası değişmiş) `HassasUygulamalar.otomatikHassasMi(paket, ad)` ise `HASSAS`,
     * değilse `ACIK`; `ad` kurulu listesindeki görünen addır.
     */
    fun durum(paket: String): UygulamaDurumu

    /** `app_list` için kurulu uygulamalar ve durumları. */
    fun uygulamalar(): List<UygulamaBilgisi>

    /** Kurulum ya da kullanıcı kararı değişince adaptör bütün girdiyi yeniden verir. */
    fun guncelle(girdi: ListeGirdisi)
}

fun interface ListelerFabrikasi {
    fun kur(kendiPaketi: String, girdi: ListeGirdisi): Listeler
}

// ---------------------------------------------------------------------------------------------
// KimlikMetni (temel.ts kimlikImzaMetni)
// ---------------------------------------------------------------------------------------------

interface KimlikMetniIslemi {
    /**
     * `eren-auth-v<PROTOKOL_SURUMU>`, rol, kanal, deviceId, clientNonce, serverNonce; `\n` ile, sonda
     * satır sonu yok. `deviceId` kimlik biçiminde, nonce'lar `Nonce` biçiminde (standart base64,
     * 24-88) değilse null: imzalanacak metin yalnız doğrulanmış alanlardan kurulur.
     */
    fun metin(
        rol: ImzaRolu,
        kanal: Kanal,
        deviceId: String,
        clientNonce: String,
        serverNonce: String,
    ): String?
}

// ---------------------------------------------------------------------------------------------
// Sema: gelen çerçevenin sınıfı, plan çözümü, giden çerçeve kurucuları
// ---------------------------------------------------------------------------------------------

/** Çözülemeyen çerçeve: telefon `error{kod}` yollar ve kapatır (cozumle.ts `CozumHatasi`). */
enum class CerceveHatasi(val kod: HataKodu) {
    COK_BUYUK(HataKodu.MESAJ_COK_BUYUK),
    BOZUK(HataKodu.GECERSIZ_MESAJ),
    SURUM(HataKodu.PROTOKOL_UYUMSUZ),
}

/** Bilgisayardan gelen `/cihaz` çerçevesi (cihaz.ts `CihazAsagi`). */
sealed interface GelenCerceve {
    data class AuthChallenge(val serverNonce: String, val serverImza: String) : GelenCerceve

    data class Welcome(val sunucuZamaniMs: Long) : GelenCerceve

    data class Komut(val cmd: Cmd) : GelenCerceve

    /**
     * `v`, `type` ve `cmd_id` geçerli ama kapı adım 0'dan geçmedi; yanıt `cmd_result{ok:false,
     * foreground:null, denied}`. İlk takılan, bu sırayla: zarf alanı ya da fazla alan `GECERSIZ_ARG`;
     * `name` listede yok `DESTEKLENMEYEN_KOMUT`; `args` `GECERSIZ_ARG`; `open_app.package` paket
     * biçiminde değil `URL_INTENT_YASAK`. `cmd_id` okunamıyorsa `Gecersiz(BOZUK)`.
     */
    data class KomutReddi(val cmdId: String, val neden: DeniedNeden) : GelenCerceve

    /** `baslik`, `metin` güvenilmez metin: yalnız bildirimde gösterilir, günlüğe girmez. */
    data class Bildirim(
        val notifyId: String,
        val tur: BildirimTuru,
        val baslik: String,
        val metin: String,
    ) : GelenCerceve

    /** `grantId` null: bütün izinler. */
    data class IzinGeriCek(val grantId: String?, val neden: GrantNedeni) : GelenCerceve

    /** Bilgisayarın `error`'u. `detail` güvenilmez metindir, alınmaz. */
    data class PcHatasi(val kod: HataKodu) : GelenCerceve

    /** Yukarı yön türleri (`grant_issued`, `hello`...) ve bilinmeyen `type` de buraya düşer. */
    data class Gecersiz(val neden: CerceveHatasi) : GelenCerceve
}

/** plan.ts `TelefonIzinIstegi`, `superRefine` kuralları dahil. */
data class TelefonIzinIstegi(
    val uygulamalar: List<String>,
    val mod: IzinModu,
    /** Alan yoksa boş. */
    val izinliMetin: List<String>,
    /** Alan yoksa false. */
    val serbestMetin: Boolean,
)

/** plan.ts `Plan`, tür kuralları dahil. Metin alanları güvenilmez: yalnız onay ekranında görünür. */
data class Plan(
    val planId: String,
    val baslik: String,
    val tur: IsTuru,
    val cwd: String,
    val gorevMetni: String,
    val kesinYapilacaklar: List<String>,
    val kesinYapilmayacaklar: List<String>,
    val mcpProfili: McpProfili?,
    /** `TELEFON` planında dolu, `PC` planında null. */
    val telefonIzinIstegi: TelefonIzinIstegi?,
    /** Alan yoksa boş. */
    val kirliKaynak: List<Long>,
    /** Şemadan geçmiş ham nesne; `PlanHash.planHash` bunu özetler. */
    val ham: JsonDeger.Nesne,
)

interface SemaIslemi {
    /**
     * cozumle.ts sırası: `ham.length` (UTF-16) > `AzamiCerceve.CIHAZ` -> `COK_BUYUK`; `Json.coz`
     * hatası -> `BOZUK`; kök nesnede `v` sayı ve 1 değilse -> `SURUM`; sonra cihaz.ts şeması,
     * bilinmeyen alan hatadır. Eksik isteğe bağlılar: `clicks` 1, `long_press` false, `repeat` 1.
     */
    fun gelen(ham: String): GelenCerceve

    /** Köprüden gelen `plan_json`: Json + plan.ts `Plan` (`planMetni`/`planSatiri` dahil). Geçersizse null. */
    fun planCoz(ham: String): Plan?

    /*
     * Giden kurucular: her biri tam bir JSON metni verir ve çıktı her zaman `cihazYukariCoz`'dan
     * geçer. Bunun için güvenilmez metni sınıra kırpar (başlık 256, `ad`/`deger` 2000, uygulama
     * adı 120), koordinatı 0..KOORDINAT_MAX'a sıkıştırır, `rol`'ü `[A-Za-z0-9_.-]`'e indirir (boş
     * kalırsa `node`), listeyi keser (`elements` 500 ve `truncated:true`, `app_list` 2000) ve paket
     * biçiminde olmayan `OnPlan`'ı `foreground:null` yazar. Süzme (izin dışı düğüm, parola değeri,
     * izin dışı başlık) ve `ok`/`denied`/`hata` tutarlılığı çağıranındır.
     */

    fun hello(deviceId: String, clientNonce: String): String

    fun authResponse(imza: String): String

    fun cmdResult(cmdId: String, sonuc: CmdSonucu): String

    /** `butce` = `izin.kalanButce`; çağıran yalnız `kalanMs >= 1` ve `kalanButce >= 1` iken çağırır. */
    fun grantIssued(izin: IzinKaydi, kalanMs: Long): String

    fun grantRevoked(grantId: String, neden: GrantNedeni): String

    fun deviceState(durum: CihazDurumu): String

    fun appList(uygulamalar: List<UygulamaBilgisi>): String

    fun notifyAck(notifyId: String): String

    /** Telefonun `error` çerçevesi; `detail` yollanmaz. */
    fun hata(kod: HataKodu): String
}

// ---------------------------------------------------------------------------------------------
// Izinler: bellekteki izin kümesi
// ---------------------------------------------------------------------------------------------

/**
 * Onay ekranında kullanıcının onayladığı (`ONAY`) ya da tam yetki altında `OtoIzinKapisi`'nin
 * onay ekranı olmadan verdiği (`OTO`) izin; `Izinler.ekle`'nin tek girdisi. Sınır denetimi ikisinde
 * de aynıdır; `kaynak` yalnız kayda ve denetim satırına geçer.
 */
data class OnayliIzin(
    val planId: String,
    val planHash: String,
    val mod: IzinModu,
    val uygulamalar: List<IzinliUygulama>,
    val izinliMetin: List<String>,
    val serbestMetin: Boolean,
    val sureMs: Long,
    val butce: Int,
    val kaynak: IzinKaynagi = IzinKaynagi.ONAY,
)

sealed interface IzinBulgusu {
    /** `kullanilanMaddeler`: `izin.izinliMetin` içinde harcanmış dizinler. */
    data class Gecerli(val izin: IzinKaydi, val kullanilanMaddeler: Set<Int>) : IzinBulgusu

    /** Kural 3-5, bu sırayla: `IZIN_YOK` / `IZIN_GERI_CEKILDI` (mezar taşı), `JETON_YANLIS`, `IZIN_SURESI_BITTI`. */
    data class Gecersiz(val neden: DeniedNeden) : IzinBulgusu
}

sealed interface Harcama {
    data class Tamam(val kalanButce: Int) : Harcama

    /** Kural 3-5 nedenleri, `BUTCE_DOLDU` ya da `METIN_KILIDI`; bu durumda hiçbir şey düşmez. */
    data class Ret(val neden: DeniedNeden) : Harcama
}

data class AktifIzin(val kayit: IzinKaydi, val kalanMs: Long)

/**
 * Jeton yalnız bellekte durur. Değişiklikleri `DenetimKaydi`'ne, aktif kimlikleri
 * `DenetimPortu.izinKimlikleriniYaz`'a kendisi yazar.
 */
interface Izinler {
    /**
     * Çağıranı yalnız onay akışı (onay ekranı ve `OtoIzinKapisi`). `grant_id` ve jeton (`JETON_BAYT`)
     * `RastgelePortu`'ndan, bitiş monotonik saatten; `kaynak` `onay.kaynak`'tan kayda ve
     * `DenetimKaydi.izinVerildi`'ye geçer. Süre ya da bütçe 1..AZAMI dışında, uygulama listesi boş ya
     * da `yaz`'da tek paket değilse null.
     */
    fun ekle(onay: OnayliIzin): IzinKaydi?

    /** Kural 3-5; jeton sabit zamanlı karşılaştırılır. Okumadır, hiçbir şey düşmez. */
    fun bul(grantId: String, token: String): IzinBulgusu

    /**
     * Bütün denetimler geçtikten sonra, eylem portundan hemen önce, atomik: bütçe 1 düşer;
     * `metinMaddesi` doluysa ve izin serbest metin değilse birebir eşleşen ilk kullanılmamış madde
     * harcanır.
     */
    fun harca(grantId: String, metinMaddesi: String?): Harcama

    /** `grantId` null: hepsi. Kaldırılanlar mezar taşına girer; dönen liste geri çekilen kimliklerdir. */
    fun geriCek(grantId: String?, neden: GrantNedeni): List<String>

    /** Bu çağrıya kadar süresi dolmuş ve henüz bildirilmemiş izinler; her kimlik bir kez döner. */
    fun suresiGecenler(): List<String>

    fun aktifler(): List<AktifIzin>

    /** Kuruluşta `DenetimPortu.izinKimlikleri()`'nden okunan, önceki süreçten kalan kimlikler. */
    fun eskiSurectenKalanlar(): List<String>
}

fun interface IzinlerFabrikasi {
    fun kur(
        saat: SaatPortu,
        rastgele: RastgelePortu,
        denetimPortu: DenetimPortu,
        denetim: DenetimKaydi,
    ): Izinler
}

// ---------------------------------------------------------------------------------------------
// Kapi: saf karar (TASARIM.md "Kapı kural sırası")
// ---------------------------------------------------------------------------------------------

/** Kural 8-12 girdisi; `anlik` ve `hedef` aynı tazelemeden. */
data class EkranDenetimGirdisi(
    val cmd: Cmd,
    val izin: IzinKaydi,
    val kullanilanMaddeler: Set<Int>,
    val anlik: AnlikDurum,
    /**
     * `click{element}`: `ekran.dugum(no)`; `type_text`: `ekran.odak()`; diğerlerinde null. Gerekip
     * null ise çağıran `element_bulunamadi` döner, kapıyı çağırmaz.
     */
    val hedef: DugumBaglami?,
    val listeler: Listeler,
)

/** Port çağırmaz. Çağıran aşamaları sırayla çağırır; ilk `Reddedildi` döner, sonrası çağrılmaz. */
interface KapiIslemi {
    /** Kural 1-5: yalnız bellek ve saat, ekran okunmadan. `pcSimdiMs` null ise `DEADLINE_GECTI`. */
    fun izinDenetimi(
        cmd: Cmd,
        baskaKomutCalisiyor: Boolean,
        pcSimdiMs: Long?,
        izin: IzinBulgusu,
    ): Karar

    /** Kural 6-7, `EkranPortu.durum()` ile. */
    fun durumDenetimi(durum: CihazDurumu): Karar

    /** Kural 8-10. Kural 11: eylemden hemen önce taze `anlik`/`hedef` ile yeniden çağrılır. */
    fun ekranDenetimi(girdi: EkranDenetimGirdisi): Karar

    /**
     * Kural 12, `girdi.anlik` görüntüden önceki, `sonraki` sonraki anlık: değişim
     * `ON_PLAN_IZIN_DISI`; `Korumali` ya da `SIYAH_ESIGI` `EKRAN_KORUMALI`. `Basarisiz` buraya gelmez.
     */
    fun goruntuDenetimi(
        girdi: EkranDenetimGirdisi,
        sonraki: AnlikDurum,
        goruntu: GoruntuSonucu,
    ): Karar
}

// ---------------------------------------------------------------------------------------------
// DenetimKaydi: satır üretimi ve dosya biçimi
// ---------------------------------------------------------------------------------------------

/** Denetim satırlarının tek üreticisi. Güvenilmez metni parametre olarak bile almaz; zamanı `SaatPortu.duvarMs`. */
interface DenetimKaydi {
    /** `paket`: o anki ön plan paketi; adım 0 reddinde `grantId`/`komut` null olabilir. */
    fun komut(
        cmdId: String,
        grantId: String?,
        komut: CmdAdi?,
        denied: DeniedNeden?,
        hata: CihazHatasi?,
        paket: String?,
    )

    /** Her izinli paket için bir satır; her satır `kaynak`'ı taşır. */
    fun izinVerildi(grantId: String, paketler: List<String>, kaynak: IzinKaynagi)

    fun izinGeriCekildi(grantId: String, neden: GrantNedeni)

    fun baglantiAcildi()

    fun baglantiKoptu()
}

fun interface DenetimKaydiFabrikasi {
    fun kur(port: DenetimPortu, saat: SaatPortu): DenetimKaydi
}

/** `DenetimSatiri`'nin dosya biçimi; adaptörün `DenetimDosyasi`'sı ve `DenetimActivity`'si kullanır. */
interface DenetimBicimIslemi {
    /** Tek satır, satır sonu içermez. */
    fun yaz(satir: DenetimSatiri): String

    /** `coz(yaz(s)) == s`; bozuk satırda null. */
    fun coz(metin: String): DenetimSatiri?
}

// ---------------------------------------------------------------------------------------------
// CihazOturumu: el sıkışma durum makinesi ve oturum çerçeveleri
// ---------------------------------------------------------------------------------------------

/** Eşleştirmeden gelen sabit girdiler; kalıcı saklama adaptördedir. */
data class Eslesme(val deviceId: String, val pcAcikAnahtar: String)

enum class OturumDurumu {
    /** Bağlantı yok ya da kapandı. */
    KAPALI,

    /** `hello` yollandı, `auth_challenge` bekleniyor. */
    SINAMA_BEKLENIYOR,

    /** `auth_response` yollandı, `welcome` bekleniyor. */
    KARSILAMA_BEKLENIYOR,

    /** `welcome` alındı; `cmd`, `notify`, `grant_revoke` kabul edilir. */
    DOGRULANDI,
}

sealed interface OturumOlayi {
    data object Dogrulandi : OturumOlayi

    /** Adaptör gösterir, sonra `bildirimGosterildi` çağırır. */
    data class Bildirim(
        val notifyId: String,
        val tur: BildirimTuru,
        val baslik: String,
        val metin: String,
    ) : OturumOlayi

    /** Kalıcı bildirim ve köprünün `izinlerDegisti` olayı için. */
    data object IzinlerDegisti : OturumOlayi

    /** Bağlantı kapanıyor. `pcden` doğruysa `kod` bilgisayarın `error`'undan; tanılama içindir. */
    data class Kapaniyor(val kod: HataKodu, val pcden: Boolean) : OturumOlayi
}

data class OturumCiktisi(
    /** Sırayla yollanacak tam JSON metinleri. */
    val giden: List<String>,
    val olaylar: List<OturumOlayi>,
    /**
     * Doğrulanmış oturumda gelen ham `cmd` çerçevesi (`Komut` ya da `KomutReddi`): adaptör bunu
     * işçi ipliğinde `KomutIsleyici.isle`'ye verir, kuyruklamaz.
     */
    val komut: String?,
    /** `giden` yollandıktan sonra bağlantı kapatılır. */
    val kapat: Boolean,
)

/** `CihazOturumu`'nun komut işleyiciye açtığı dar görünüm. */
interface OturumBilgisi {
    /** Telefon duvar saati + `welcome` farkı; doğrulanmış bağlantı yoksa null. */
    fun pcSimdiMs(): Long?

    /** Her `welcome`'da ve her kopmada artar. Komut başındakiyle aynı değilse eylem yapılmaz, sonuç atılır. */
    fun baglantiNo(): Long
}

/**
 * Ekran içeriği okumaz, eylem yapmaz; `cmd`'yi yalnız `OturumCiktisi.komut` ile dışarı verir.
 * Sıra dışı çerçeve `error{yetkisiz}` + kapat; `GelenCerceve.Gecersiz` `error{neden.kod}` + kapat;
 * PC imzası tutmazsa hiçbir şey yollamadan kapat. `welcome`'dan sonra sırayla `device_state`,
 * `app_list`, her aktif izin için `grant_issued`, `eskiSurectenKalanlar` için
 * `grant_revoked{suresi_bitti}`. Doğrulanmamışken izin/durum çağrıları yan etkisini yapar, çerçeve
 * üretmez.
 */
interface CihazOturumu : OturumBilgisi {
    fun durum(): OturumDurumu

    /** Yeni bağlantı: `hello` (`NONCE_BAYT` rastgele bayt, standart base64). */
    fun baglandi(): OturumCiktisi

    fun gelen(ham: String): OturumCiktisi

    fun koptu()

    /** Onay akışı `Izinler.ekle`'den sonra çağırır: `grant_issued`. */
    fun izinEklendi(izin: IzinKaydi): OturumCiktisi

    /** Durdur düğmesi, erişilebilirlik kopması: `Izinler.geriCek` + her kimlik için `grant_revoked`. */
    fun izinGeriCek(grantId: String?, neden: GrantNedeni): OturumCiktisi

    /** Adaptör saniyede bir çağırır: `Izinler.suresiGecenler` için `grant_revoked{suresi_bitti}`. */
    fun tik(): OturumCiktisi

    /** `EkranPortu.durum()` ile `device_state`. */
    fun cihazDurumuDegisti(): OturumCiktisi

    /** `Listeler.uygulamalar()` ile `app_list`. */
    fun uygulamalarDegisti(): OturumCiktisi

    fun bildirimGosterildi(notifyId: String): OturumCiktisi
}

fun interface CihazOturumuFabrikasi {
    fun kur(
        eslesme: Eslesme,
        anahtar: AnahtarPortu,
        rastgele: RastgelePortu,
        saat: SaatPortu,
        ekran: EkranPortu,
        izinler: Izinler,
        listeler: Listeler,
        denetim: DenetimKaydi,
    ): CihazOturumu
}

// ---------------------------------------------------------------------------------------------
// KomutIsleyici: Sozlesme.kt'deki arayüzün kurucusu
// ---------------------------------------------------------------------------------------------

/**
 * `isle(ham)` yalnız `cmd` çerçevesi alır: `Sema.gelen` (adım 0) -> `Izinler.bul` -> `Kapi`
 * aşamaları -> port -> `Izinler.harca` -> eylem -> `cmd_result` (+ gerekirse `grant_revoked`).
 * Eşzamanlı çağrılabilir: çalışan komut varken ikinci çağrı beklemeden `mesgul` alır. Her komut
 * `DenetimKaydi.komut` ile bir satır yazar. Bağlantı no değiştiyse boş liste döner.
 */
fun interface KomutIsleyiciFabrikasi {
    fun kur(
        ekran: EkranPortu,
        eylem: EylemPortu,
        saat: SaatPortu,
        izinler: Izinler,
        listeler: Listeler,
        denetim: DenetimKaydi,
        oturum: OturumBilgisi,
    ): KomutIsleyici
}
