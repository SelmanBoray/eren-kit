package dev.eren.cihaz.cekirdek

/*
 * Çekirdeğin dış dünyası: altı port. Gerçekleri Android adaptöründedir (`android/`), sahteleri
 * `src/test/.../Sahte.kt`. Çekirdek bunların dışında hiçbir şeye dokunmaz: dosya, ağ, saat,
 * rastgelelik, Keystore, erişilebilirlik hep buradan gelir. Kurallar: ../../../TASARIM.md.
 *
 * Bütün portlar eşzamanlıdır (bloklar). Çekirdek kendi ipliğini açmaz; adaptör komutu bir işçi
 * ipliğinde çalıştırır. Koordinatlar bu dosyada her zaman ekranın gerçek pikselidir.
 */

// ---------------------------------------------------------------------------------------------
// Saat
// ---------------------------------------------------------------------------------------------

interface SaatPortu {
    /** Açılıştan beri, uyku dahil (`SystemClock.elapsedRealtime`). İzin süresi yalnız bununla ölçülür. */
    fun monotonikMs(): Long

    /** Telefonun duvar saati (`System.currentTimeMillis`). Yalnız `deadline_ms` farkı için. */
    fun duvarMs(): Long

    /** Eylem ve görüntü arası en kısa süre ile `wait` için. Sahtesi saati ilerletir, gerçekten uyumaz. */
    fun uyu(ms: Long)
}

// ---------------------------------------------------------------------------------------------
// Rastgele
// ---------------------------------------------------------------------------------------------

interface RastgelePortu {
    /** Güvenli üreteçten (`SecureRandom`). Jeton, nonce, `grant_id`, sohbet oturumu buradan. */
    fun baytlar(adet: Int): ByteArray
}

// ---------------------------------------------------------------------------------------------
// Anahtar: Keystore P-256. Özel anahtar portun dışına çıkmaz.
// ---------------------------------------------------------------------------------------------

interface AnahtarPortu {
    /** Telefonun açık anahtarı: SPKI DER, standart base64. */
    fun acikAnahtar(): String

    /**
     * `SHA256withECDSA`, DER, standart base64; metnin UTF-8 baytları imzalanır. Çekirdekte tek
     * çağıranlar `CihazOturumu` ve `SohbetSinamasi`'dır, metin her zaman `KimlikMetni`'nden gelir.
     */
    fun imzala(metin: String): String

    /** Bilgisayar imzası. Bozuk anahtar ya da imza atmaz, `false` döner. */
    fun dogrula(acikAnahtar: String, metin: String, imza: String): Boolean
}

// ---------------------------------------------------------------------------------------------
// Denetim: çekirdeğin tek kalıcı yazımı
// ---------------------------------------------------------------------------------------------

enum class DenetimOlayi { KOMUT, IZIN_VERILDI, IZIN_GERI_CEKILDI, BAGLANTI_ACILDI, BAGLANTI_KOPTU }

/**
 * Yerel denetim günlüğünün satırı. Okunan ekran metni, yazılan metin, jeton, başlık ve uygulama
 * adı **girmez**; yalnız kimlik, kapalı liste değeri ve paket adı.
 */
data class DenetimSatiri(
    val duvarMs: Long,
    val olay: DenetimOlayi,
    val grantId: String?,
    val cmdId: String?,
    val komut: CmdAdi?,
    val denied: DeniedNeden?,
    val hata: CihazHatasi?,
    val grantNedeni: GrantNedeni?,
    val paket: String?,
    /** İznin kaynağı: `DenetimKaydi` yalnız `IZIN_VERILDI` satırında doldurur; kaynaksız eski satırda null. */
    val kaynak: IzinKaynagi? = null,
)

interface DenetimPortu {
    /** Sona ekler. Hiç atmaz; yazılamazsa satır düşer. */
    fun ekle(satir: DenetimSatiri)

    /** Diskteki jetonsuz izin kimlikleri: önceki süreçten kalanlar. Dosya yoksa boş. */
    fun izinKimlikleri(): List<String>

    /** Aktif izinlerin kimlikleri, atomik yazım. Jeton hiçbir zaman diske gitmez. */
    fun izinKimlikleriniYaz(kimlikler: List<String>)
}

// ---------------------------------------------------------------------------------------------
// Ekran: erişilebilirlik ağacından okuma. Hiçbir okuma ekranı değiştirmez.
// ---------------------------------------------------------------------------------------------

data class Nokta(val x: Int, val y: Int)

/** Gerçek piksel, `sag` ve `alt` hariç. */
data class Dikdortgen(val sol: Int, val ust: Int, val sag: Int, val alt: Int)

data class CihazDurumu(
    /** Bizim erişilebilirlik servisimiz bağlı mı. */
    val a11y: Boolean,
    val kilitli: Boolean,
    /** USB hata ayıklama (`Settings.Global.ADB_ENABLED`). */
    val adbAcik: Boolean,
)

/**
 * Pencere sınıfı adaptörde belirlenir (üretici arayüzünün pencere türleri telefonda ölçülür). Çekirdek
 * yalnız `DURUM_CUBUGU` ve `GEZINTI_CUBUGU`'nu paketsiz kabul eder; `BILINMIYOR` reddedilir.
 */
enum class PencereTuru {
    UYGULAMA,
    DURUM_CUBUGU,
    GEZINTI_CUBUGU,
    PERDE,
    HEADS_UP,
    KLAVYE,
    BALON,
    PIP,
    ERISILEBILIRLIK_KATMANI,
    DIGER_SISTEM,
    BILINMIYOR,
}

data class Pencere(
    val tur: PencereTuru,
    /** Kök düğümün paketi; okunamıyorsa `null`. */
    val paket: String?,
    /** Büyük olan üstte. */
    val katman: Int,
    val sinir: Dikdortgen,
    val aktif: Boolean,
    val odakli: Boolean,
)

/** Ön plan denetiminin girdisi: tek okumada alınmış durum. */
data class AnlikDurum(
    /** `rootInActiveWindow.packageName`. */
    val aktifKokPaketi: String?,
    /** Son `TYPE_WINDOW_STATE_CHANGED` olayının paketi; izin yokken olay işlenmediği için `null` olabilir. */
    val sonOlayPaketi: String?,
    /** `isFocused` pencerenin kök paketi. */
    val odakPaketi: String?,
    /** Aktif pencere başlığı. Güvenilmez metin; izin dışı pakette dışarı çıkmaz. */
    val baslik: String?,
    /** Görünen bütün pencereler, katmana göre azalan. */
    val pencereler: List<Pencere>,
    val ekranGenisligi: Int,
    val ekranYuksekligi: Int,
    val alinmaMonotonikMs: Long,
)

data class Dugum(
    /** Son `elementler()` okumasına özel kimlik, 0 ve üzeri. `dugum(no)` bunu tazeler. */
    val no: Int,
    val paket: String?,
    /** Adaptörün sınıf adından eşlediği rol; çekirdek `[A-Za-z0-9_.-]` dışını değiştirir. */
    val rol: String,
    /** Metin ya da açıklama. Güvenilmez metin. */
    val ad: String,
    /** Düzenlenebilir alanın içeriği. Parola alanında adaptör hiç okumaz, `null` verir. */
    val deger: String?,
    /** `hintText`: şifre, PIN, OTP ipucu denetimi için. */
    val ipucu: String?,
    /** `viewIdResourceName`. */
    val kaynakId: String?,
    val sinir: Dikdortgen,
    val tiklanabilir: Boolean,
    val duzenlenebilir: Boolean,
    val etkin: Boolean,
    val parola: Boolean,
    val odakli: Boolean,
)

data class ElementOkumasi(
    /** Görünen bütün pencerelerden, en üst pencere önce. Paket süzmesi çekirdektedir. */
    val dugumler: List<Dugum>,
    /** Adaptörün gezinti sınırına takıldıysa doğru. */
    val kirpildi: Boolean,
)

/** Etiket denetimi için düğüm ve çevresi, hepsi aynı tazelemeden. */
data class DugumBaglami(
    val dugum: Dugum,
    /** Kökten düğüme değil, düğümden köke doğru. */
    val atalar: List<Dugum>,
    /** En çok üç kat aşağısı. */
    val torunlar: List<Dugum>,
)

sealed interface GoruntuSonucu {
    data class Tamam(
        /** `image/jpeg` ya da `image/png`. */
        val mime: String,
        /** Standart base64, en çok `Sinirlar.EKRAN_BASE64`. */
        val base64: String,
        val genislik: Int,
        val yukseklik: Int,
        /** Gerçek piksel = resim pikseli * olcek. */
        val olcek: Double,
        /** Siyah piksel oranı, 0-1. `FLAG_SECURE` hata vermeden siyah dönebilir. */
        val siyahOrani: Double,
    ) : GoruntuSonucu

    /** `ERROR_TAKE_SCREENSHOT_SECURE_WINDOW`. */
    data object Korumali : GoruntuSonucu

    data class Basarisiz(val hata: CihazHatasi) : GoruntuSonucu
}

interface EkranPortu {
    /** Ucuz; ekran içeriği okumaz. */
    fun durum(): CihazDurumu

    fun anlik(): AnlikDurum

    fun elementler(): ElementOkumasi

    /** Düğümü yeniden okur; artık yoksa `null`. */
    fun dugum(no: Int): DugumBaglami?

    /** Giriş odağındaki düzenlenebilir düğüm; yoksa `null`. */
    fun odak(): DugumBaglami?

    /** `bolge` gerçek piksel, `null` tam ekran. */
    fun goruntu(bolge: Dikdortgen?): GoruntuSonucu
}

// ---------------------------------------------------------------------------------------------
// Eylem: ekranı değiştiren her şey. Çekirdek yalnız kapı geçtikten sonra çağırır.
// ---------------------------------------------------------------------------------------------

sealed interface EylemSonucu {
    /** Eylem sisteme verildi. Sonucunu kanıtlamaz; `ok:true` yalnız bunu söyler. */
    data object Gonderildi : EylemSonucu

    data class Basarisiz(val hata: CihazHatasi) : EylemSonucu
}

interface EylemPortu {
    /** `ACTION_CLICK` / `ACTION_LONG_CLICK`; `tiklama` 1-2. */
    fun dugumeDokun(no: Int, tiklama: Int, uzun: Boolean): EylemSonucu

    fun noktayaDokun(nokta: Nokta, tiklama: Int, uzun: Boolean): EylemSonucu

    /** `ACTION_SET_TEXT`: alanı baştan yazar, eklemez. */
    fun metinYaz(no: Int, metin: String): EylemSonucu

    fun tus(tus: Tus, tekrar: Int): EylemSonucu

    /** `miktar` yoksa adaptörün varsayılanı; `nokta` yoksa ekranın ortası. */
    fun kaydir(yon: KaydirmaYonu, miktar: Int?, nokta: Nokta?): EylemSonucu

    fun surukle(bas: Nokta, son: Nokta): EylemSonucu

    /** Yalnız `PackageManager.getLaunchIntentForPackage`. URL ya da intent metni almaz. */
    fun uygulamaAc(paket: String): EylemSonucu
}
