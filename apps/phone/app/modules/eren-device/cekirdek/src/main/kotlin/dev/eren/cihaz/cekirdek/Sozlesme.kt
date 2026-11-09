package dev.eren.cihaz.cekirdek

/*
 * Çekirdeğin dışa açık sözleşmesi: kapalı listeler, gelen komutun çözülmüş biçimi (`Cmd`), kapının
 * kararı (`Karar`), bellekteki izin (`IzinKaydi`) ve komut işleyici arayüzü. Hepsi gövdesizdir:
 * davranış `Kapi.kt`, `KomutIsleyici.kt`, `CihazOturumu.kt` gibi ayrı dosyalarda. Kapalı listeler
 * `protocol/src/cihaz.ts` ile birebir aynıdır; `kablo` değerleri kablodaki dizelerdir. `SozlesmeTest`
 * bunu `protocol`'e karşı sınar. Kurallar: ../../../TASARIM.md.
 */

// ---------------------------------------------------------------------------------------------
// Kapalı listeler (protocol/src/cihaz.ts, temel.ts)
// ---------------------------------------------------------------------------------------------

enum class CmdAdi(val kablo: String) {
    FOREGROUND("foreground"),
    ELEMENTS("elements"),
    SCREENSHOT("screenshot"),
    ZOOM("zoom"),
    CLICK("click"),
    TYPE_TEXT("type_text"),
    KEY("key"),
    SCROLL("scroll"),
    DRAG("drag"),
    WAIT("wait"),
    OPEN_APP("open_app"),
}

enum class Tus(val kablo: String) {
    BACK("back"),
    HOME("home"),
    ENTER("enter"),
    DPAD_UP("dpad_up"),
    DPAD_DOWN("dpad_down"),
    DPAD_LEFT("dpad_left"),
    DPAD_RIGHT("dpad_right"),
    DPAD_CENTER("dpad_center"),
}

enum class KaydirmaYonu(val kablo: String) {
    UP("up"),
    DOWN("down"),
    LEFT("left"),
    RIGHT("right"),
}

enum class IzinModu(val kablo: String) {
    OKU("oku"),
    YAZ("yaz"),
}

enum class UygulamaDurumu(val kablo: String) {
    ACIK("acik"),
    HASSAS("hassas"),
    YENI("yeni"),
    DEGISMEZ("degismez"),
}

/** Kapının kapalı ret listesi. Yeni neden sürüm artışıdır. `cihaz.ts` `DENIED_NEDENLERI` ile aynı sıra. */
enum class DeniedNeden(val kablo: String) {
    IZIN_YOK("izin_yok"),
    IZIN_GERI_CEKILDI("izin_geri_cekildi"),
    IZIN_SURESI_BITTI("izin_suresi_bitti"),
    JETON_YANLIS("jeton_yanlis"),
    BUTCE_DOLDU("butce_doldu"),
    DEADLINE_GECTI("deadline_gecti"),
    ON_PLAN_IZIN_DISI("on_plan_izin_disi"),
    HASSAS_UYGULAMA("hassas_uygulama"),
    YENI_UYGULAMA("yeni_uygulama"),
    DEGISMEZ_RET("degismez_ret"),
    IZIN_DISI_PENCERE("izin_disi_pencere"),
    KILIT_EKRANI("kilit_ekrani"),
    PAROLA_ALANI("parola_alani"),
    YALNIZ_OKU_YAZMA("yalniz_oku_yazma"),
    YALNIZ_OKU_HAM_DOKUNMA("yalniz_oku_ham_dokunma"),
    YALNIZ_OKU_ETIKET("yalniz_oku_etiket"),
    METIN_KILIDI("metin_kilidi"),
    URL_INTENT_YASAK("url_intent_yasak"),
    ERISILEBILIRLIK_KAPALI("erisilebilirlik_kapali"),
    EKRAN_KORUMALI("ekran_korumali"),
    MESGUL("mesgul"),
    DESTEKLENMEYEN_KOMUT("desteklenmeyen_komut"),
    GECERSIZ_ARG("gecersiz_arg"),
}

/** Kapı izin verdi ama eylem olmadı. `cihaz.ts` `CIHAZ_HATALARI`. */
enum class CihazHatasi(val kablo: String) {
    ELEMENT_BULUNAMADI("element_bulunamadi"),
    UYGULAMA_BULUNAMADI("uygulama_bulunamadi"),
    EKRAN_ALINAMADI("ekran_alinamadi"),
    EYLEM_BASARISIZ("eylem_basarisiz"),
    ZAMAN_ASIMI("zaman_asimi"),
}

/** İznin bitiş nedeni. `cihaz.ts` `GRANT_NEDENLERI`. */
enum class GrantNedeni(val kablo: String) {
    KULLANICI_DURDURDU("kullanici_durdurdu"),
    SURESI_BITTI("suresi_bitti"),
    BUTCE_BITTI("butce_bitti"),
    IS_BITTI("is_bitti"),
    IS_IPTAL("is_iptal"),
    LIMIT_KILIT("limit_kilit"),
    ERISILEBILIRLIK_KAPANDI("erisilebilirlik_kapandi"),
}

// ---------------------------------------------------------------------------------------------
// Gelen komut: `cmd` çerçevesinin çözülmüş, şemadan geçmiş biçimi
// ---------------------------------------------------------------------------------------------

/** Komuta özel argümanlar. `Json`/`Sema` ham JSON'u bu biçime çözer; kapı bunu okur. */
sealed interface CmdArg {
    val ad: CmdAdi

    data object Foreground : CmdArg {
        override val ad: CmdAdi get() = CmdAdi.FOREGROUND
    }

    data class Elements(val sorgu: String?) : CmdArg {
        override val ad: CmdAdi get() = CmdAdi.ELEMENTS
    }

    data object Screenshot : CmdArg {
        override val ad: CmdAdi get() = CmdAdi.SCREENSHOT
    }

    data class Zoom(val x0: Int, val y0: Int, val x1: Int, val y1: Int) : CmdArg {
        override val ad: CmdAdi get() = CmdAdi.ZOOM
    }

    /** `element` ile (`x`,`y`) tam olarak birinden biri doludur. */
    data class Click(
        val element: Int?,
        val nokta: Nokta?,
        val tiklama: Int,
        val uzunBasma: Boolean,
    ) : CmdArg {
        override val ad: CmdAdi get() = CmdAdi.CLICK
    }

    data class TypeText(val metin: String) : CmdArg {
        override val ad: CmdAdi get() = CmdAdi.TYPE_TEXT
    }

    data class Key(val tus: Tus, val tekrar: Int) : CmdArg {
        override val ad: CmdAdi get() = CmdAdi.KEY
    }

    data class Scroll(val yon: KaydirmaYonu, val miktar: Int?, val nokta: Nokta?) : CmdArg {
        override val ad: CmdAdi get() = CmdAdi.SCROLL
    }

    data class Drag(val x0: Int, val y0: Int, val x1: Int, val y1: Int) : CmdArg {
        override val ad: CmdAdi get() = CmdAdi.DRAG
    }

    data class Wait(val saniye: Double) : CmdArg {
        override val ad: CmdAdi get() = CmdAdi.WAIT
    }

    data class OpenApp(val paket: String) : CmdArg {
        override val ad: CmdAdi get() = CmdAdi.OPEN_APP
    }
}

/** Zarf alanları + çözülmüş argüman. `deadlineMs` bilgisayar saatinde mutlak andır. */
data class Cmd(
    val cmdId: String,
    val grantId: String,
    val token: String,
    val deadlineMs: Long,
    val arg: CmdArg,
)

// ---------------------------------------------------------------------------------------------
// Kapının kararı
// ---------------------------------------------------------------------------------------------

/** Saf kapının sonucu: ya eylem/okuma yapılır ya da bir nedenle reddedilir. */
sealed interface Karar {
    /** Bütün denetimler geçti; çağıran portu çağırabilir. */
    data object Izinli : Karar

    /** İlk takılan denetim. Kapıdan sonra port çağrılmaz. */
    data class Reddedildi(val neden: DeniedNeden) : Karar
}

// ---------------------------------------------------------------------------------------------
// Bellekteki izin (telefonda, onay ekranında üretilir)
// ---------------------------------------------------------------------------------------------

data class IzinliUygulama(val paket: String, val ad: String)

/**
 * İznin nereden doğduğu. `ONAY`: kullanıcı onay ekranında onayladı. `OTO`: telefonda tam yetki
 * açıkken `OtoIzinKapisi` onay ekranı göstermeden verdi. Kabloya girmez (`grant_issued` taşımaz,
 * kapı bakmaz); yalnız bellekteki kayıtta ve yerel denetim günlüğünün `IZIN_VERILDI` satırında durur.
 */
enum class IzinKaynagi { ONAY, OTO }

/**
 * Onay akışının (`ONAY` ya da `OTO`, bkz. `kaynak`) ürettiği izin. Yalnız bellekte durur; jeton
 * diske ve denetim günlüğüne girmez.
 * `bitisMonotonikMs` telefonun monotonik saatindedir: bilgisayar saati süreyi uzatamaz.
 * `kalanButce` ve kalan süre eylem başına azalır; azalma davranış katmanındadır, bu tip anlıktır.
 */
data class IzinKaydi(
    val grantId: String,
    val planId: String,
    val planHash: String,
    val token: String,
    val mod: IzinModu,
    val uygulamalar: List<IzinliUygulama>,
    /** `yaz` modunda birebir yazılabilecek metinler; `oku` modunda boş. */
    val izinliMetin: List<String>,
    val serbestMetin: Boolean,
    val bitisMonotonikMs: Long,
    val kalanButce: Int,
    /** `Izinler.ekle` `OnayliIzin.kaynak`'ı aynen taşır. */
    val kaynak: IzinKaynagi = IzinKaynagi.ONAY,
)

// ---------------------------------------------------------------------------------------------
// Giden sonuç (cmd_result'un zarfsız gövdesi)
// ---------------------------------------------------------------------------------------------

/** İzin dışı pakette `baslik` boş yollanır: başlık okunmamış içerik taşıyabilir. */
data class OnPlan(val baslik: String, val paket: String)

/** `cmd_result.payload`: yalnız `elements`, `screenshot`, `zoom` başarıyla döndüğünde. */
sealed interface CmdPayload {
    data class Elementler(val kirpildi: Boolean, val elementler: List<Element>) : CmdPayload

    data class Goruntu(
        val mime: String,
        val base64: String,
        val genislik: Int,
        val yukseklik: Int,
        val olcek: Double,
    ) : CmdPayload
}

/** Kablo `elements` elemanı. Parola alanında `deger` asla doldurulmaz, `parola` doğrudur. */
data class Element(
    val id: Int,
    val rol: String,
    val ad: String,
    val deger: String?,
    val x: Int,
    val y: Int,
    val etkinDegil: Boolean,
    val parola: Boolean,
)

/**
 * Bir komutun sonucu. `ok:true` ise `denied` ve `hata` yoktur; `ok:false` ise `denied` ile
 * `hata`'dan tam olarak biri vardır ve `payload` yoktur. `ok:true` eylemin sonucunu kanıtlamaz.
 */
data class CmdSonucu(
    val ok: Boolean,
    val foreground: OnPlan?,
    val payload: CmdPayload?,
    val denied: DeniedNeden?,
    val hata: CihazHatasi?,
)

// ---------------------------------------------------------------------------------------------
// Komut işleyici arayüzü
// ---------------------------------------------------------------------------------------------

/**
 * `/cihaz` kablosunun saf işleyicisi. Bir gelen metin çerçevesini alır, gönderilecek çerçeveleri
 * (her biri tam JSON metin) döndürür; ağ, iplik ve zamanlama çağıranındır. El sıkışma durumunu
 * da taşır (`CihazOturumu`). Gövdeli gerçekleme ayrı dosyadadır.
 */
interface KomutIsleyici {
    fun isle(ham: String): List<String>
}
