package dev.eren.cihaz.adaptor

import android.accessibilityservice.AccessibilityService
import dev.eren.cihaz.cekirdek.AnahtarPortu
import dev.eren.cihaz.cekirdek.BildirimTuru
import dev.eren.cihaz.cekirdek.DenetimBicimIslemi
import dev.eren.cihaz.cekirdek.DenetimKaydi
import dev.eren.cihaz.cekirdek.DenetimPortu
import dev.eren.cihaz.cekirdek.DenetimSatiri
import dev.eren.cihaz.cekirdek.EkranPortu
import dev.eren.cihaz.cekirdek.EylemPortu
import dev.eren.cihaz.cekirdek.GrantNedeni
import dev.eren.cihaz.cekirdek.IzinKaydi
import dev.eren.cihaz.cekirdek.Izinler
import dev.eren.cihaz.cekirdek.KomutIsleyici
import dev.eren.cihaz.cekirdek.ListeGirdisi
import dev.eren.cihaz.cekirdek.Listeler
import dev.eren.cihaz.cekirdek.RastgelePortu
import dev.eren.cihaz.cekirdek.SaatPortu

/*
 * =================================================================================================
 * Android adaptörünün iç sözleşmesi (gövdesiz). Çekirdeğin `IcSozlesme.kt`'si neyse, bu da Android
 * katmanının öyle: davranış dosyaları (sahiplik haritası, dosya sonu) birbirini görmeden, yalnız
 * bu dosyaya, çekirdeğin donmuş sözleşmesine (`Portlar.kt`, `Sozlesme.kt`, `IcSozlesme.kt`,
 * `Sinirlar.kt`) ve `ErenDevice.types.ts`'e karşı yazılır. Davranış buraya yazılmaz; yalnız `object Adaptor` (süreç
 * içi bağ noktası) somuttur, ötekiler paralel agent'ların dosyalarıdır. Kurallar: `app/TASARIM.md`.
 *
 * KATMAN SINIRI. Çekirdek saf Kotlin'dir ve `android.`/`androidx.`/`expo.`/`okhttp` görmez; adaptör
 * çekirdeği içe aktarır, çekirdek adaptörü aktarmaz. Çekirdek bu modüle `sourceSets` ile derlenir
 * (bkz. `android/build.gradle`); porttan gelmeyen hiçbir dış dünya (saat, rastgelelik, dosya, ağ,
 * erişilebilirlik, Keystore) çekirdeğe sızmaz.
 *
 * TEK ÇEKİRDEK ÖRNEĞİ. Süreçte çekirdeğin durumlu nesneleri (`Izinler`, `Listeler`, `DenetimKaydi`,
 * `CihazOturumu`, `KomutIsleyici`) ve altı port tam bir kez kurulur. Kuran: `CihazServisi.onCreate`
 * (ön plan servisi; Expo/React bağlamından bağımsız, `BOOT_COMPLETED` ile RN olmadan kalkar). Kuran,
 * `CekirdekErisimi`'ni gerçekleyen tek bir nesne (servisin kendi sarmalayıcısı) üretir ve
 * `Adaptor.cekirdek`'e yazar; `onDestroy`'da `null`'lar. Fabrikalar (`izinlerKur`, `listelerKur`,
 * `denetimKaydiKur`, `cihazOturumuKur`, `komutIsleyiciKur`) çekirdekten gelir. `SaatPortu`
 * (`SystemClock.elapsedRealtime`/`currentTimeMillis`/`sleep`) ve `RastgelePortu` (`SecureRandom`)
 * ayrı dosya değildir; bu sarmalayıcının içinde kurulur ve `CekirdekErisimi` ile açılır.
 * `CihazOturumu`'nun TAMAMI yalnız `Baglanti`'ya enjekte edilir, paylaşılan yüzeyde durmaz.
 *
 * ERİŞİM. Her bileşen çekirdeğe `Adaptor` üzerinden ulaşır: `Adaptor.cekirdek` (örnekler + portlar),
 * `Adaptor.oturumGuncelle` (/cihaz oturumunu değiştiren istekler; yalnız `Baglanti` gerçekler),
 * `Adaptor.olaylar` (köprü olayları; yalnız `ErenDeviceModule` gerçekler). İş parçacığı: çekirdeğin
 * durumlu nesneleri iş-parçacığı güvenlidir; WS okuması, komut işçisi, onay ekranı ve saniyelik tik
 * aynı anda çağırır. `Adaptor` alanları `@Volatile`; her alanı yalnız sahibi yazar, okuması serbest.
 *
 * YAPISAL DEĞİŞMEZLER (TASARIM §"Köprü API ve yapısal sınırlar"; JS tarafındaki tarama testinin
 * (`app/test/yapisal.test.ts`) Kotlin karşılığı — gözden geçirmede korunur):
 *   (1) `Izinler.ekle`'nin yalnız iki çağıranı vardır: `OnayActivity.kt` ve `OtoIzinKapisi.kt`.
 *       Başka hiçbir dosya `izinler.ekle`'yi çağırmaz. Gerekçe: 2026-11-09 tam yetki kararı
 *       ("telefonda da serbest"): asistan telefonda onay ekranı beklemeden okuyup yazabilsin.
 *       Bu yüzden izin iki yoldan doğar: kullanıcı onayıyla `OnayActivity`'den (`kaynak = ONAY`) ya
 *       da yalnız `TamYetki.acik` iken `OtoIzinKapisi`'nden (`kaynak = OTO`; plan aynı sıkılıkla
 *       çözülüp özeti doğrulandıktan, her paket listede açık olduktan ve erişilebilirlik açıldıktan
 *       sonra). İki yolda da izin `ErisimAnahtari.ac` → `ACIK`'tan sonra doğar; denetim günlüğü
 *       kaynağı gösterir. Kalan sınırlar (değişmez ret, hassas liste, parola alanı, URL/intent yasağı,
 *       süre/bütçe, kalıcı bildirim + Durdur) iki yolda da aynen geçerlidir.
 *   (2) `/cihaz` kablosunu (ve dolayısıyla `Kanal.CIHAZ` imzalı el sıkışmayı taşıyan `CihazOturumu`'nu)
 *       yalnız `Baglanti` sürer: `baglandi()`/`gelen()`/`koptu()`/`tik()` ve giden çerçevelerin ağa
 *       yazılması yalnız orada. Başka bileşen `/cihaz` soketi açmaz, `Kanal.CIHAZ` ile imzalamaz.
 *       Oturumu değiştiren istekler `Adaptor.oturumGuncelle` arayüzünden `Baglanti`'ya gider.
 *   (3) `ErenDeviceModule`'ün (köprü) hiçbir işlevi `cmd`, `cmd_result`, `token` ya da ham `/cihaz`
 *       çerçevesi taşımaz; yüzeyi birebir `ErenDevice.types.ts`'tir. `/sohbet` el sıkışmasında bile
 *       yalnız imza döner (imzalanan baytlar Kotlin'de kurulur). `izinIste`/`otoIzin`'in aldığı
 *       `plan_json`/`plan_hash` plandır, `/cihaz` çerçevesi değildir; `OnayActivity` ve
 *       `OtoIzinKapisi` planı `Sema.planCoz` ile sıkı çözer, özeti `PlanHash.planHash` ile yeniden
 *       hesaplar. İki işlev de yalnız opak `grant_id` döndürür; jeton asla.
 *   (4) `TamYetki.ac(`'ın tek çağıranı `TamYetkiActivity.kt`'dir (BIOMETRIC_STRONG | DEVICE_CREDENTIAL
 *       başarısından sonra). PC ve JS tam yetkiyi açamaz; köprü yalnız o ekranı gösterir.
 *       `TamYetki.kapat` her yerden serbesttir.
 *   (5) `Settings.Secure.put*` yalnız `ErisimAnahtari.kt`'de (erişilebilirlik servisini açıp kapatmak).
 *   (6) `KisayolDeposu.koy(`'un tek çağıranı `KisayolActivity.kt`'dir: kısayol mesajı yalnız
 *       kullanıcının o ekranda sesle söylemesiyle doğar (0.4.3'ten beri onay sorulmaz: boş olmayan
 *       dikte hemen konur; iptal ya da boş dikte hiçbir şey koymaz).
 * =================================================================================================
 */

// -------------------------------------------------------------------------------------------------
// Süreç içi bağ noktası: tek somut tutkal. Sahipleri aşağıda; gerisi davranış dosyalarındadır.
// -------------------------------------------------------------------------------------------------

/**
 * Süreç-global servis bulucu. Her alanı yalnız açıklamadaki sahip yazar; okuyan `?.` ile korunur
 * (servis ayakta değilken `null` olabilir). Durum ya da davranış tutmaz; yalnız referans taşır.
 */
object Adaptor {
    /** `CihazServisi.onCreate` yazar, `onDestroy` `null`'lar. Çekirdek örnekleri ve portlar. */
    @Volatile
    @JvmStatic
    var cekirdek: CekirdekErisimi? = null

    /** `Baglanti.baslat` kendini yazar, `durdur` `null`'lar. Oturumu değiştiren istekler buradan. */
    @Volatile
    @JvmStatic
    var oturumGuncelle: OturumGuncelle? = null

    /** `ErenDeviceModule` ömrü boyunca kendini yazar; modül yoksa olaylar yalnız düşer (durum `durum()` ile çekilir). */
    @Volatile
    @JvmStatic
    var olaylar: AdaptorOlaylari? = null
}

// -------------------------------------------------------------------------------------------------
// Paylaşılan yüzeyler (gövdesiz). Gerçekleyenleri parantez içinde.
// -------------------------------------------------------------------------------------------------

/**
 * Tek çekirdek örneğinin paylaşılan okuma yüzeyi. Gerçekleyeni `CihazServisi`'nin kurduğu
 * sarmalayıcıdır. Portlar burada çekirdek arayüz tipleriyle (gerçekleme sınıfı gizli) açılır.
 */
interface CekirdekErisimi {
    val ekran: EkranPortu
    val eylem: EylemPortu
    val anahtar: AnahtarPortu
    val saat: SaatPortu
    val rastgele: RastgelePortu
    val denetimPortu: DenetimPortu

    /** `DenetimActivity` için okuma yüzeyi (aynı nesne `DenetimPortu`'yu da gerçekler). */
    val denetimKapisi: DenetimKapisi
    val izinler: Izinler
    val listeler: Listeler
    val denetim: DenetimKaydi
    val paket: PaketKapisi

    /** `Baglanti`, doğrulanmış oturumda gelen ham `cmd`'yi işçi ipliğinde buna verir. */
    val komutIsleyici: KomutIsleyici

    /**
     * `ErisimServisi.onServiceConnected` (çekirdek kuruluysa) ya da servis çekirdekten önce
     * bağlandıysa `CihazServisi` (çekirdek kurulunca `ErisimAnahtari.canliServis()` ile) çağırır:
     * `EkranOkuyucu`/`Eylemci` canlı servise bağlanır, durum değişimi köprüye bildirilir.
     */
    fun erisilebilirlikBaglandi(servis: AccessibilityService)

    /**
     * Gerçek kopuş: `ErisimServisi.onUnbind`/`onDestroy` (bağlanma başına en çok bir kez;
     * `onInterrupt` kopuş DEĞİLDİR, servis bağlı kalır). Portlar koparılır, `Adaptor.oturumGuncelle`
     * ile tüm izinler `ERISILEBILIRLIK_KAPANDI` geri çekilir, durum köprüye bildirilir.
     */
    fun erisilebilirlikKoptu()
}

/**
 * `/cihaz` oturumunu değiştiren istekler. Tek gerçekleyeni `Baglanti`'dır: çağrıyı WS ipliğine alır,
 * ilgili `CihazOturumu` yöntemini çalıştırır, `OturumCiktisi.giden`'i bağlıyken yollar (bağlı değilse
 * çekirdek durumu yine güncellenir, çerçeve düşer; PC sonraki `welcome`'da eşitler), olayları işler.
 */
interface OturumGuncelle {
    /** `OnayActivity` ya da `OtoIzinKapisi`, `izinler.ekle` başarıyla döndükten HEMEN sonra: `grant_issued`. */
    fun izinEklendi(izin: IzinKaydi)

    /** `DurdurAlici` (hepsi), `UygulamaListesiActivity`/erişilebilirlik kaybı: `Izinler.geriCek` + `grant_revoked`. */
    fun izinGeriCek(grantId: String?, neden: GrantNedeni)

    /** `PaketBilgisi` (PACKAGE_ADDED), `UygulamaListesiActivity`: `app_list`. */
    fun uygulamalarDegisti()

    /** Erişilebilirlik/kilit/ADB durumu değişince: `device_state`. */
    fun cihazDurumuDegisti()
}

/**
 * Köprü olayları (yalnız hızlandırıcı; gerçeklik `durum()`/`izinler()` ile çekilir). Tek gerçekleyeni
 * `ErenDeviceModule`'dür; `sendEvent` ile JS'e iletir.
 */
interface AdaptorOlaylari {
    fun durumDegisti()
    fun izinlerDegisti()
    fun bildirimAcildi(tur: BildirimTuru)

    /**
     * `KisayolDeposu.koy` yuvaya yeni mesaj koyunca: köprü olayı `kisayolGeldi{id}`. Yalnız kimlik
     * gider; metin ve bağlam JS'e `kisayolAl()` ile çekilir (olay düşerse açılışta yine çekilir).
     */
    fun kisayolGeldi(id: String)
}

/**
 * Erişilebilirlik servisinin canlı örneğine bağlanan/kopan port gerçeklemeleri (`EkranOkuyucu`,
 * `Eylemci`). Bağlı değilken `EkranPortu.durum()` `a11y=false` verir, eylem/okuma `erisilebilirlik_*`
 * ile düşer. `CekirdekErisimi.erisilebilirlikBaglandi/Koptu` bu yüzeyi sürer.
 */
interface A11yBagi {
    fun bagla(servis: AccessibilityService)
    fun kopar()
}

/**
 * `PaketBilgisi`'nin dışa açtığı yüzey. Kurulu uygulamalar, imza özeti ve görünen ad (güvenilmez
 * metin; yalnız onay/liste ekranlarında ve `app_list`'te). `Listeler.guncelle` girdisini üretir.
 */
interface PaketKapisi {
    /** Kurulu uygulamalar + çözülen değişmezler + o anki kullanıcı kararları. */
    fun listeGirdisi(): ListeGirdisi

    /** SHA-256 imza özeti; paket yoksa `null`. */
    fun imzaOzeti(paket: String): String?

    /** PackageManager'dan görünen ad; okunamazsa paket adının kendisi. */
    fun ad(paket: String): String
}

/** `DenetimDosyasi`'nın `DenetimActivity` için açtığı okuma yüzeyi; satırlar `DenetimBicimi.coz`'dan geçer. */
interface DenetimKapisi {
    /** Son `sonN` satır, eskiden yeniye; bozuk satır atlanır. `grantId` verilirse yalnız o izin. */
    fun satirlar(sonN: Int, grantId: String?): List<DenetimSatiri>
    val bicim: DenetimBicimIslemi
}

// -------------------------------------------------------------------------------------------------
// 24 davranış dosyasının sahiplik haritası (sınıf adı + dışa açtığı imzalar; gövde paralel agent'ta).
// Her satır o dosyanın brief'ine aynen girer.
// -------------------------------------------------------------------------------------------------
/*
 * SERVİS VE BAĞLANTI
 * ------------------
 * CihazServisi : android.app.Service
 *   Ön plan (specialUse) servisi; tek çekirdek örneğini kurar, `Adaptor.cekirdek`'e yazar. `Baglanti`,
 *   `Bildirimler`, `PaketBilgisi` ve Saat/Rastgele portlarını kurar; `CihazOturumu`'nu `cihazOturumuKur`
 *   ile üretip `Baglanti`'ya enjekte eder. Saniyede bir `Baglanti` üzerinden tik ettirir, izin aktifken
 *   bildirim sayacını güncatır. Companion: `baslat(ctx: Context)`, `durdur(ctx: Context)`.
 *
 * Baglanti  (OturumGuncelle gerçekler)
 *   OkHttp WebSocket /cihaz istemcisi (pingInterval OkHttp düzeyinde; protokolde ping mesajı yok). Tek
 *   `/cihaz` sürücüsü ve `Kanal.CIHAZ`'ın tek kullanıcısı. `CihazOturumu`'nu enjekte alır. Açılış:
 *   `baglandi()`; gelen metin: `oturum.gelen(ham)` → `giden`'i yolla, `olaylar`'ı işle, `komut != null`
 *   ise `cekirdek.komutIsleyici.isle` işçi ipliğinde → sonuçları yolla. `OturumCiktisi.kapat`'ta kapat.
 *   `baslat()`, `durdur()`, `baglimi(): Boolean`; `Adaptor.oturumGuncelle = this` (durdur → null).
 *
 * AcilisAlici : android.content.BroadcastReceiver
 *   BOOT_COMPLETED / MY_PACKAGE_REPLACED → `CihazServisi.baslat(context)` (RN başlatmadan).
 *
 * DurdurAlici : android.content.BroadcastReceiver
 *   Kalıcı bildirimdeki "Durdur" PendingIntent'i → `Adaptor.oturumGuncelle?.izinGeriCek(null,
 *   KULLANICI_DURDURDU)` (bağlantı yoksa doğrudan `cekirdek.izinler.geriCek`), `ErisimAnahtari.kapat`,
 *   sonra `CihazServisi.durdur(context)`. İlk adım `TamYetki.kapat` (acil durdurma: tam yetki kapanır,
 *   gecikme penceresinde gelen otomatik izin servisi yeniden açamaz; yeniden açmak biyometrili
 *   `TamYetkiActivity` ister). Köprü `otoIzin` de tam yetki kapalıyken servisi kaldırmadan hemen reddeder.
 *
 * Bildirimler
 *   Kalıcı ön plan bildirimi + kanallar; izin aktifken kalan süre/bütçe sayacı; `OturumOlayi.Bildirim`
 *   için plan/soru/is_bitti/sistem bildirimleri (güvenilmez başlık/metin yalnız bildirimde, günlüğe
 *   girmez). Bildirime dokunma `Adaptor.olaylar?.bildirimAcildi(tur)`. Kalıcı bildirimde her zaman
 *   "<ad> ile konuş" eylemi (`asistanAdi()`) → `KisayolActivity` (`PendingIntent.getActivity`, IMMUTABLE). `kanallariKur()`,
 *   `onPlan(): Notification`, `olay(notifyId, tur, baslik, metin)`, `sayac(kalanMs, kalanButce)`.
 *
 * ERİŞİLEBİLİRLİK VE PORTLAR
 * --------------------------
 * ErisimServisi : android.accessibilityservice.AccessibilityService
 *   İnce bağlantı servisi. onServiceConnected → önce `ErisimAnahtari.servisBaglandi(this)`; çekirdek
 *   varsa `Adaptor.cekirdek.erisilebilirlikBaglandi(this)`, yoksa `CihazServisi.baslat` (yetki varsa
 *   `ErisimAnahtari.kapat`: çekirdeksiz aktif izin olamaz). Gerçek kopuş yalnız onUnbind/onDestroy
 *   (bağlanma başına en çok bir kez) → `ErisimAnahtari.servisKoptu()` + `Adaptor.cekirdek?.
 *   erisilebilirlikKoptu()`. onInterrupt kopuş DEĞİLDİR (Android geri bildirimi kesmek ister, servis
 *   bağlı kalır); hiçbir şey yapmaz. typeWindowStateChanged olayının paketini `EkranOkuyucu`'ya
 *   son-olay olarak verir; aktif izin yokken erişilebilirlik olayı işlenmez. Canlı örnek
 *   `EkranOkuyucu`/`Eylemci`'ye `erisilebilirlikBaglandi` ile ulaşır (gesture, getWindows, rootInActiveWindow).
 *
 * ErisimAnahtari  (object; `enum class AcmaSonucu { ACIK, YETKI_YOK, ZAMAN_ASIMI }`)
 *   Erişilebilirlik servisini açıp kapatan süreçte tek nesne ve `Settings.Secure.put*`'un TEK yeri
 *   (DEĞİŞMEZ 5). Servis yalnız aktif izin varken açık; kurulumda bir kez `adb shell pm grant <paket>
 *   android.permission.WRITE_SECURE_SETTINGS`. `yetkiVar(ctx)`; `ac(ctx, sonuc: (AcmaSonucu) -> Unit)`
 *   (bağlıysa hemen `ACIK`; değilse listeye yalnız kendi bileşenini ekler, bağlanınca `ACIK`, ~4 sn'de
 *   `ZAMAN_ASIMI`; sonuç ana iplikte tam bir kez); `kapat(ctx)` (`disableSelf` + listeden yalnız kendi
 *   bileşeni); `uzlastir(ctx, aktifIzinVar)` (`CihazServisi` tikinde; izin yoksa 10 sn sonra kapatır);
 *   `servisBaglandi/servisKoptu` (`ErisimServisi`); `canliServis()`, `bekleniyor()`. Çağıranlar:
 *   `OnayActivity`/`OtoIzinKapisi` (`ac`), `DurdurAlici`/`CihazServisi.onDestroy` (`kapat`).
 *
 * KisayolErisimServisi : android.accessibilityservice.AccessibilityService
 *   Yeteneksiz tetik servisi: ses tuşu erişilebilirlik kısayoluna bağlıdır (iki ses tuşunu basılı
 *   tutmak). Sistem onu bağlayınca cihaz kilitli DEĞİLSE `KisayolActivity`'yi açar; kilitliyse açmaz
 *   (kilit `KeyguardManager.isKeyguardLocked` ile okunur, `KeyguardManager` alınamazsa kilitli sayılır).
 *   Her yolda `disableSelf` çağırır. Koruma ayara değil buraya konmuştur: ölçümde
 *   `accessibility_shortcut_on_lock_screen`=0 iken de kısayol kilitliyken tetiklendi. Kilit ekranında
 *   sistemin kısa kısayol geri bildirimi (titreşim/ses) servis kodundan engellenemez. Olay işlemez,
 *   ekran içeriği okumaz, eylem yapmaz; `ErisimServisi` ile ilgisi yoktur.
 *
 * EkranOkuyucu  (EkranPortu, A11yBagi gerçekler)
 *   Erişilebilirlik ağacından okur; hiçbir okuma ekranı değiştirmez. `durum/anlik/elementler/dugum/
 *   odak/goruntu`. PencereTuru'nu üretici arayüzünün pencere türlerinden eşler; `rol`'ü sınıf adından türetir. Bağlı
 *   değilken `durum().a11y=false`, okuma çağrıları `EYLEM_BASARISIZ`/boş döner.
 *
 * Eylemci  (EylemPortu, A11yBagi gerçekler)
 *   Ekranı değiştiren her şey (yalnız kapı geçtikten sonra çağrılır): `dugumeDokun/noktayaDokun/
 *   metinYaz(ACTION_SET_TEXT)/tus/kaydir/surukle/uygulamaAc(getLaunchIntentForPackage)`. `Gonderildi`
 *   yalnız "sisteme verildi"; sonucu kanıtlamaz.
 *
 * PaketBilgisi  (PaketKapisi gerçekler)
 *   İmza özeti (SHA-256), PackageManager görünen ad, çözülen değişmezler (Ayarlar, kurucu, Play, izin
 *   denetleyicisi, ev/kilit ekranı — intent çözümüyle). PACKAGE_ADDED/REMOVED/REPLACED dinler, kullanıcı
 *   kararı deposunu okuyup `ListeGirdisi` üretir ve `listeler.guncelle` + `oturumGuncelle.uygulamalarDegisti`.
 *
 * AnahtarDeposu  (AnahtarPortu gerçekler)
 *   AndroidKeyStore P-256; özel anahtar dışarı çıkmaz. `acikAnahtar(): String` (SPKI DER b64),
 *   `imzala(metin)` (SHA256withECDSA DER b64), `dogrula(acikAnahtar, metin, imza)`.
 *
 * DenetimDosyasi  (DenetimPortu, DenetimKapisi gerçekler)
 *   Sona-ekli denetim günlüğü dosyası (`DenetimBicimi.yaz`); atomik jetonsuz izin-kimliği listesi
 *   (`izinKimlikleri`/`izinKimlikleriniYaz`). `DenetimKapisi.satirlar` ile `DenetimActivity`'ye okutur.
 *
 * TAM YETKİ VE OTO İZİN
 * ---------------------
 * TamYetki  (object)
 *   Telefon tarafındaki tam yetki bayrağı; kalıcı (uygulama içi SharedPreferences), varsayılan kapalı.
 *   `acik(ctx): Boolean` (ucuz, önbellekli), `ac(ctx)` (DEĞİŞMEZ 4: tek çağıran `TamYetkiActivity`),
 *   `kapat(ctx)` (her yerden serbest; köprü `tamYetkiKapat`). Değişince `Adaptor.olaylar?.durumDegisti()`.
 *   PC'nin bağımsız anahtarı (`ayar.local.json` `tam_yetki`) ayrıdır; ikisi birbirini açmaz.
 *
 * OtoIzinKapisi  (object; `sealed interface OtoIzinSonucu { Verildi(grantId); OnayGerekli(neden) }`)
 *   Tam yetki açıkken onay ekranı olmadan izin üreten yer (DEĞİŞMEZ 1'in ikinci çağıranı).
 *   `dene(ctx, planJson, planHash, sonuc: (OtoIzinSonucu) -> Unit)`: ana iplikte koşar (başka iplikten
 *   çağrılırsa kendini aktarır), sonuç ana iplikte tam bir kez. Sıra: `TamYetki.acik` (değilse
 *   `tam_yetki_kapali`) → plan `Sema.planCoz` ile sıkı çözülür, özet `PlanHash.planHash` ile yeniden
 *   hesaplanıp karşılaştırılır, tur telefon değilse `gecersiz` → çekirdek yoksa `cekirdek_yok` →
 *   plandaki her paket listede `acik` olmalı (`YENI`, yani kurulu olmayan paket →
 *   `uygulama_listede_degil`; hassas/
 *   değişmez → `hassas`) → `ErisimAnahtari.ac`, `ACIK` değilse `erisim_acilamadi` →
 *   `izinler.ekle(OnayliIzin(..., kaynak = OTO))` (süre/bütçe/mod OnayActivity'nin önceden seçili
 *   varsayılanlarıyla; biyometri yok) → `Adaptor.oturumGuncelle?.izinEklendi(izin)` → ön plan plandaki
 *   bir paketse `EkranOkuyucu.pencereOlayi` ile son-olay tohumlanır → `Verildi`. Köprü olayı
 *   `izinlerDegisti`'yi köprü gönderir. Tekilleştirme: aynı `plan_id` + `plan_hash` için etkin izin varsa
 *   yenisi doğmaz, mevcut `grant_id` ile `Verildi` döner. İplik: denetimler, etkin izin araması ve
 *   `izinler.ekle` ana iplikte; yalnız tohumun ekran okuması (`anlik()`, erişilebilirlik IPC'si) işçi ipliğinde.
 *
 * KISAYOL
 * -------
 * KisayolDeposu  (object; `data class KisayolMesaji(id, metin, paket?, ad?, zamanMs)`)
 *   Kısayoldan söylenen mesajın bellekteki tek yuvası; iş-parçacığı güvenli. `onPlan(ctx): String?`
 *   (UsageStatsManager, son 60 sn'deki en son ACTIVITY_RESUMED; kendi paketimiz, systemui ve varsayılan
 *   başlatıcı hariç; en son olay başlatıcı ya da kendi paketimizse `null`: bayat ön plan gönderilmez;
 *   yetki yoksa `null`), `koy(ctx, metin, paket?): String` (DEĞİŞMEZ 6: tek çağıran
 *   `KisayolActivity`; paket hassas/değişmez ya da çekirdek yok/durum okunamıyorsa paket ve ad `null`; ad
 *   PackageManager etiketinden, en çok 80, kontrol karakterleri ayıklanmış; yeni mesaj eskisini siler;
 *   `Adaptor.olaylar?.kisayolGeldi(id)`), `al(): KisayolMesaji?`, `tuket(id)` (yalnız id eşleşirse).
 *
 * KisayolKutucugu : android.service.quicksettings.TileService
 *   Hızlı Ayarlar kutucuğu, etiket `asistanAdi()` (manifestte label yok), simge `@drawable/ic_eren_kutucuk`. onClick → `KisayolActivity`
 *   (API 34+ PendingIntent ile `startActivityAndCollapse`, altı Intent); kilitliyse `unlockAndRun` içinde.
 *   Köprü `kisayolKutucuguEkle` ile sistemden eklenmesini ister (API 33+).
 *
 * AKTİVİTELER (hepsi exported=false; modülden startActivityForResult, KisayolActivity hariç)
 * -----------------------------------------------------------------------------------------
 * OnayActivity : android.app.Activity
 *   KULLANICI ONAYLI İZNİ ÜRETEN YER. FLAG_SECURE, filterTouchesWhenObscured, gizlenmiş dokunuş reddi,
 *   API 34+ setAccessibilityDataSensitive; başka erişilebilirlik servisi etkinse uyarı. Extra:
 *   `plan_json`, `plan_hash`. `Sema.planCoz` ile sıkı çözer, `PlanHash.planHash`'i yeniden hesaplar;
 *   `yaz`/`serbest_metin` için BIOMETRIC_STRONG|DEVICE_CREDENTIAL. Onayda: `ErisimAnahtari.ac` →
 *   `ACIK` → `cekirdek.izinler.ekle(OnayliIzin(..., kaynak = ONAY))` (DEĞİŞMEZ 1: iki çağırandan biri)
 *   → `Adaptor.oturumGuncelle?.izinEklendi(izin)` → result `IzinIsteSonucu{onaylandi, grant_id}`.
 *   Kendi paketimiz değişmez rette.
 *
 * TamYetkiActivity : android.app.Activity
 *   FLAG_SECURE, filterTouchesWhenObscured. Tam yetkinin ne demek olduğunu Türkçe anlatır.
 *   BIOMETRIC_STRONG | DEVICE_CREDENTIAL başarısında `TamYetki.ac` (DEĞİŞMEZ 4: tek çağıran burası).
 *   Köprü `tamYetkiAc` ile açar (OnayActivity deseni). Result: RESULT_OK + extra `sonuc`
 *   (`"acildi"` | `"iptal"`); RESULT_CANCELED ya da extra yoksa köprü `iptal` sayar.
 *
 * KisayolActivity : android.app.Activity
 *   Saydam tema `@style/Eren.Saydam`, `taskAffinity=""`, excludeFromRecents; manifestte noHistory
 *   BİLEREK YOK (tanıyıcı opak gelirse sonuç kaybolur). Kutucuk, bildirim ve ses tuşu kısayolundan
 *   (`KisayolErisimServisi`) açılır (köprüden değil). Açılır açılmaz `KisayolDeposu.onPlan`; sonra
 *   RecognizerIntent (tr-TR; RECORD_AUDIO yok; köprüdeki `dikte()` ile aynı yol). Kart, geri sayım,
 *   Gönder/İptal düğmesi YOKTUR: boş olmayan metin gelince onay sormadan hemen `KisayolDeposu.koy`
 *   (DEĞİŞMEZ 6: tek çağıran burası; yanlış tanınan dikte de gider); kısa Toast ("<asistanAdi()>
 *   oturumuna gönderildi · <bağlam adı>"); JS ayakta değilse (`Adaptor.olaylar == null`) uygulamanın
 *   başlatıcı etkinliğini başlatır; sonra kapanır. Dikte iptal ya da boşsa hiçbir şey göndermeden kapanır.
 *
 * EslestirmeActivity : android.app.Activity
 *   FLAG_SECURE. QR'ı Google kod tarayıcı okur (CAMERA izni yok) ya da elle kod girişi. `EslestirmeQr`
 *   doğrulanır; host/port/PC anahtar parmak izi gösterilir; `pair_request` Kotlin'de yollanır; PC
 *   anahtarı JS'ten geçmez; `Eslesme(deviceId, pcAcikAnahtar)` kalıcı saklanır. Yeniden eşleştirme
 *   biyometri. Result `EslestirSonucu{sonuc, kod?}`.
 *
 * UygulamaListesiActivity : android.app.Activity
 *   Uygulamalar ekranı, iki durumlu: Açık / Kapalı (`acik`/`hassas`); değişmezler "Kilitli" ve
 *   düğmesizdir. Varsayılan açıktır; banka/para/kimlik uygulamaları `HassasUygulamalar` ile otomatik
 *   kapalı başlar (notla gösterilir). "Açık" biyometri ya da ekran kilidi ister, "Kapalı" istemez; ikisi
 *   de imza özetini karar anında alır. "Yeni" ve kararı silme seçeneği yoktur. `KullaniciKarari` (durum +
 *   o anki imza özeti) deposunu yazar; `cekirdek.listeler.guncelle` + `oturumGuncelle.uygulamalarDegisti`.
 *
 * DenetimActivity : android.app.Activity
 *   Denetim günlüğünü gösterir; `cekirdek.denetimKapisi.satirlar(...)` (+`.bicim`). İsteğe bağlı `grant_id`.
 *
 * TanilamaActivity : android.app.Activity
 *   Tanılama: çıkış nedenleri (ApplicationExitInfo), son hatalar, yakalanmamış istisna dosyası. Salt okuma.
 *
 * KÖPRÜ
 * -----
 * ErenDeviceModule : expo.modules.kotlin.modules.Module  (AdaptorOlaylari gerçekler)
 *   Definition { Name("ErenDevice") ... }. Yüzeyi birebir `ErenDevice.types.ts` (DEĞİŞMEZ 3). Eşleme:
 *     durum()           → EkranPortu.durum() + eşleşme/VPN/pil/bildirim/biyometri bayrakları +
 *                         erisim_yetkisi (`ErisimAnahtari.yetkiVar`), kullanim_erisimi (AppOps
 *                         GET_USAGE_STATS izinli mi), tam_yetki (`TamYetki.acik`), ses_kisayolu
 *                         (`ErisimAnahtari.sesKisayoluKurulu`)
 *     eslesme()         → kalıcı `Eslesme` → {device_id, host, port} | null
 *     eslestir()        → EslestirmeActivity (startActivityForResult)
 *     sohbetHello()     → client_nonce = rastgele; `oturum` 30 sn tek kullanım (Kanal.SOHBET, /cihaz DEĞİL)
 *     sohbetSinama(...) → PC `pc/sohbet` imzası `anahtar.dogrula`; sonra yalnız `telefon/sohbet` imzalanır
 *     izinIste(j,h)     → OnayActivity (plan/plan_hash extra) → IzinIsteSonucu; jeton JS'e DÖNMEZ
 *     otoIzin(j,h)      → OtoIzinKapisi.dene → {verildi, grant_id} | {onay_gerekli, neden}; jeton DÖNMEZ;
 *                         verildi'de `izinlerDegisti`
 *     izinler()         → cekirdek.izinler.aktifler() → IzinKaydiGorunumu[] (jeton yok)
 *     izinGeriCek(id)   → Adaptor.oturumGuncelle?.izinGeriCek(id, KULLANICI_DURDURDU) (yalnız kapatır)
 *     uygulamaListesiAc/denetimAc(grant?)/tanilamaAc/ayarAc(hedef) → ilgili Activity / sabit intent
 *     dikte()           → RecognizerIntent (RECORD_AUDIO yok)
 *     tamYetkiAc()      → TamYetkiActivity (startActivityForResult) → "acildi" | "iptal" (bayrağı açamaz)
 *     tamYetkiKapat()   → TamYetki.kapat
 *     kisayolAl()       → KisayolDeposu.al → {id, metin, paket, ad, zaman_ms} | null
 *     kisayolTuket(id)  → KisayolDeposu.tuket
 *     kisayolKutucuguEkle() → StatusBarManager.requestAddTileService(KisayolKutucugu) (API 33+;
 *                         altı "desteklenmiyor") → "eklendi" | "zaten" | "reddedildi" | "desteklenmiyor"
 *     sesKisayoluKur()  → ErisimAnahtari.sesKisayoluKur → "kuruldu" | "yetki_yok" | "hata" (bağlam yoksa hata)
 *   Olaylar: durumDegisti/izinlerDegisti/bildirimAcildi{tur}/kisayolGeldi{id} → `AdaptorOlaylari` ile
 *   `sendEvent`. `Adaptor.olaylar = this` (modül yıkımında null). Bu modülde cmd/cmd_result/token/ham
 *   çerçeve YOK.
 */
