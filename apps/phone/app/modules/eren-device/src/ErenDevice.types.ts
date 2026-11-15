/**
 * `eren-device` yerel (Expo) modülünün köprü API'sinin TS tipleri. Yalnız tip, gövde yok.
 * Kaynak karar: `runtime/uygulama-kararlar.md`, "Köprü API'si". Kotlin tarafı bu yüzeyi gerçekler;
 * JS tarafı `app/src/cihaz/erenDevice.ts` üzerinden çağırır.
 *
 * Yapısal sınır (karar): bu yüzeyde `cmd`, `cmd_result`, `payload`, `token` alanı ve genel bir
 * `imzala(bayt)` yoktur. `/cihaz` kablosu ve komutlar JS'e hiç geçmez; yalnız `/sohbet` için
 * `sohbetHello`/`sohbetSinama` vardır ve orada da yalnız imza döner, imzalanan baytlar Kotlin'de
 * kurulur. İzin yalnız iki yoldan doğar: `izinIste` ile onay ekranından ya da tam yetki açıkken
 * `otoIzin` ile Kotlin'deki oto izin kapısından; ikisinde de yalnız opak `grant_id` döner, jeton
 * JS'e dönmez. Tam yetkiyi JS açamaz: `tamYetkiAc` yalnız biyometrili ekranı gösterir.
 */
import type { IzinModu } from "@eren/protocol";

export type AbonelikKapat = () => void;

export type EslestirmeSonucu = "tamam" | "iptal" | "hata";
export type IzinIstegiSonucu = "onaylandi" | "reddedildi" | "iptal" | "gecersiz";
export type AyarHedefi = "erisilebilirlik" | "uygulama_bilgisi" | "pil" | "bildirim" | "vpn";
export type BildirimTuru = "plan" | "soru" | "is_bitti" | "sistem";
export type SesKisayoluSonucu = "kuruldu" | "kuruldu_digerleriyle" | "yetki_yok" | "hata";

/** Telefonun o anki durumu. Her alan `durum()` ile çekilir; olaylar yalnız hızlandırıcıdır. */
export interface CihazDurumu {
  eslesmis: boolean;
  cihaz_bagli: boolean;
  a11y: boolean;
  adb_enabled: boolean;
  kilitli: boolean;
  bildirim_izni: boolean;
  pil_muaf: boolean;
  vpn_aktif: boolean;
  biyometri: boolean;
  /** `WRITE_SECURE_SETTINGS` verilmiş mi (erişilebilirlik servisini uygulama kendi açıp kapatır). */
  erisim_yetkisi: boolean;
  /** `GET_USAGE_STATS` app-op'u izinli mi (kısayolda ön plandaki uygulamayı okumak için). */
  kullanim_erisimi: boolean;
  /** Telefondaki tam yetki bayrağı; yalnız biyometrili ekrandan açılır, kapatmak serbest. */
  tam_yetki: boolean;
  /** Ses tuşu erişilebilirlik kısayolu (`KisayolErisimServisi`) kurulu mu: sistemde hedef olarak seçili mi. */
  ses_kisayolu: boolean;
}

export interface EslesmeBilgisi {
  device_id: string;
  host: string;
  port: number;
}

/** `oturum` 30 sn tek kullanımlıktır; `client_nonce` Kotlin'de üretilir. */
export interface SohbetHelloSonucu {
  device_id: string;
  client_nonce: string;
  oturum: string;
}

/** Önce PC imzası (`pc/sohbet`) doğrulanır; ancak sonra yalnız `telefon/sohbet` imzalanır. */
export type SohbetSinamaSonucu =
  | { signature: string }
  | { hata: "imza_gecersiz" | "oturum_yok" };

export interface IzinUygulamasi {
  paket: string;
  ad: string;
}

/** `izinler()` öğesi. Jeton burada yoktur: PC yalnız opak kimliği görür. */
export interface IzinKaydiGorunumu {
  grant_id: string;
  plan_id: string;
  plan_hash: string;
  mod: IzinModu;
  uygulamalar: IzinUygulamasi[];
  kalan_ms: number;
  butce: number;
}

export type IzinIsteSonucu = {
  sonuc: IzinIstegiSonucu;
  /** Yalnız `sonuc === "onaylandi"` ile. */
  grant_id?: string;
};

export type EslestirSonucu = {
  sonuc: EslestirmeSonucu;
  /** Yalnız elle kod girişi akışında. */
  kod?: string;
};

export type DikteSonucu = { metin: string } | { iptal: true };

/** `otoIzin`'in onay ekranına bıraktığı durumun nedeni (kart kullanıcıya kalır, neden kartta not). */
export type OtoIzinNedeni =
  | "tam_yetki_kapali"
  | "gecersiz"
  | "uygulama_listede_degil"
  | "hassas"
  | "erisim_acilamadi"
  | "cekirdek_yok";

/** Jeton burada da yoktur: yalnız opak `grant_id`. */
export type OtoIzinSonucu =
  | { sonuc: "verildi"; grant_id: string }
  | { sonuc: "onay_gerekli"; neden: OtoIzinNedeni };

/**
 * Kısayoldan (Hızlı Ayarlar kutucuğu ya da bildirim) söylenen mesaj. `paket`/`ad`: o anki ön plan
 * uygulaması; bilinemiyorsa ya da hassas/değişmez listedeyse ikisi de `null`. `zaman_ms`: duvar saati.
 */
export interface KisayolMesaji {
  id: string;
  metin: string;
  paket: string | null;
  ad: string | null;
  zaman_ms: number;
}

/** Olay yükleri. `sendEvent` yalnız hızlandırıcıdır; gerçeklik `durum()`/`izinler()`/`kisayolAl()` ile çekilir. */
export interface ErenDeviceOlaylari {
  durumDegisti: CihazDurumu;
  izinlerDegisti: IzinKaydiGorunumu[];
  bildirimAcildi: { tur: BildirimTuru };
  kisayolGeldi: { id: string };
  /** Seslendirme başlayınca `konusuyor: true`, bitince ya da kesilince `false`. */
  seslendirmeDurumu: { konusuyor: boolean };
}

/**
 * Yerel modülün dışa açık yüzeyi. `izinIste` planın JSON metnini ve `plan_hash`'i alır; Kotlin
 * planı sıkı çözer, özeti yeniden hesaplar ve onay ekranını gösterir.
 */
export interface ErenDeviceModulu {
  durum(): Promise<CihazDurumu>;
  eslesme(): Promise<EslesmeBilgisi | null>;
  eslestir(): Promise<EslestirSonucu>;
  sohbetHello(): Promise<SohbetHelloSonucu>;
  sohbetSinama(
    oturum: string,
    server_nonce: string,
    server_signature: string,
  ): Promise<SohbetSinamaSonucu>;
  izinIste(plan_json: string, plan_hash: string): Promise<IzinIsteSonucu>;
  /**
   * Onay ekranı olmadan izin dener (tam yetki açıkken). Kotlin `izinIste` ile aynı sıkı çözümü ve
   * özet karşılaştırmasını yapar; her paket listede açık değilse ya da erişilebilirlik açılamazsa
   * `onay_gerekli` döner, izin doğmaz.
   */
  otoIzin(plan_json: string, plan_hash: string): Promise<OtoIzinSonucu>;
  izinler(): Promise<IzinKaydiGorunumu[]>;
  /** `null`: bütün izinler. Yalnız kapatır, yeni izin üretmez. */
  izinGeriCek(grant_id: string | null): Promise<void>;
  uygulamaListesiAc(): Promise<void>;
  denetimAc(grant_id?: string): Promise<void>;
  tanilamaAc(): Promise<void>;
  ayarAc(hedef: AyarHedefi): Promise<void>;
  dikte(): Promise<DikteSonucu>;
  /** Biyometrili tam yetki ekranını açar; bayrağı yalnız o ekran açar. */
  tamYetkiAc(): Promise<"acildi" | "iptal">;
  /** Her zaman serbest. Var olan izinlere dokunmaz. */
  tamYetkiKapat(): Promise<void>;
  /** Bekleyen kısayol mesajı (tek yuva) ya da `null`. Çekmek tüketmez. */
  kisayolAl(): Promise<KisayolMesaji | null>;
  /** Yalnız `id` yuvadakiyle eşleşirse siler; daha yeni bir mesaj ezilmez. */
  kisayolTuket(id: string): Promise<void>;
  /** Sistemden Hızlı Ayarlar'a asistan kutucuğunu ekleme ister (Android 13+; altında `desteklenmiyor`). */
  kisayolKutucuguEkle(): Promise<"eklendi" | "zaten" | "reddedildi" | "desteklenmiyor">;
  /**
   * Ses tuşu kısayolunu kurar (iki ses tuşunu basılı tutmak asistanı açar). Önceki kısayol hedefleri silinmez:
   * `kuruldu_digerleriyle` onlar korunup bizimki eklendi demektir (basışta Android hangisini açacağını sorar).
   * `yetki_yok`: `WRITE_SECURE_SETTINGS` verilmemiş; `hata`: kurulamadı ya da bağlam yok.
   */
  sesKisayoluKur(): Promise<SesKisayoluSonucu>;
  /** Metni verilen dilde (ör. `tr-TR`) okumaya başlar; okunamadıysa `false`. */
  seslendir(metin: string, dil: string): Promise<boolean>;
  /** Süren seslendirmeyi keser. */
  seslendirmeyiDurdur(): Promise<void>;
  addListener<E extends keyof ErenDeviceOlaylari>(
    olay: E,
    dinleyici: (veri: ErenDeviceOlaylari[E]) => void,
  ): AbonelikKapat;
}
