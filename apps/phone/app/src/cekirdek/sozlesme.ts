/**
 * JS çekirdeğinin sözleşmesi: yalnız portlar ve dışa açık tipler, gövde yok, çalışma anında hiçbir
 * şey. `cekirdek/` saf TS'tir; React Native'i içe aktarmaz ve `node --test` ile koşar. Platforma
 * bağlı her şey (WebSocket, Keystore köprüsü, dosya sistemi, saat) porttan gelir; gerçekleri
 * `app/src/depo/`, `app/src/cihaz/` adaptörlerindedir, sahteleri testlerde.
 *
 * Kurallar ve her modülün sorumluluğu: ../../TASARIM.md. Kablo tipleri `@eren/protocol`'dedir,
 * burada kopyalanmaz. Her modül kendi fabrikasını `export const <ad>Kur: <Ad>Fabrikasi` diye verir
 * ve yalnız bu dosyadan tip, `@eren/protocol`'den değer içe aktarır.
 *
 * Dilim 2 (çoklu sohbet): modüller arası değişen her yüzey burada donar (TASARIM.md "Dilim 2").
 * Bu dosya yalnız iki modülden tip alır ve onları dondurulmuş sayar: `baglanti.ts`'ten
 * `BaglantiHatasi`, `olaylar.ts`'ten görünüm öğeleri (`GorunumOgesi` ailesi). Dilim 2'de ikisi de
 * değişmez; değişmesi gerekirse bu sözleşme yeniden dondurulur.
 *
 * Medya dalgası (fotoğraf/video ekleri, yetenek `medya1`): yeni portlar ve yükleyici dosyanın sonundaki
 * "Medya" bloğundadır (TASARIM.md "Medya"). Bu dalgada `olaylar.ts`'in `KullaniciBalonu`'na tek alan
 * eklenir (`ekler?`, U3); `GorunumOgesi` ailesinin geri kalanı ve `BaglantiHatasi` değişmez.
 */
import type {
  EkBilgisi,
  GirdiYolu,
  HataKodu,
  KisayolBaglami,
  MediaBegin,
  MediaCancel,
  MediaChunk,
  MedyaId,
  MedyaIslemeDurumu,
  MedyaMime,
  MedyaTuru,
  Olay,
  SohbetAdi,
  SohbetAsagi,
  SohbetDurumu as SunucuSohbetDurumu,
  SohbetErenDurumu,
  SohbetId,
  SohbetYukari,
  UsageReport,
} from "@eren/protocol";
import type { BaglantiHatasi } from "./baglanti.ts";
import type { EtkinlikDurumu } from "./etkinlik.ts";
import type { GorunumOgesi, IsKarti } from "./olaylar.ts";

export type { EtkinlikDurumu } from "./etkinlik.ts";

// ---------------------------------------------------------------------------------------------
// Ortak yardımcılar
// ---------------------------------------------------------------------------------------------

export type IptalEt = () => void;

export type BaglantiDurumu = "kapali" | "baglaniyor" | "el_sikisma" | "bagli";

// ---------------------------------------------------------------------------------------------
// Saat portu: monotonik olmayan duvar saati yeterli; yalnız yeniden bağlanma geri çekilmesi için.
// ---------------------------------------------------------------------------------------------

export interface SaatPortu {
  simdiMs(): number;
  /** `setTimeout` yerine: testte ilerletilebilir. */
  sonra(ms: number, f: () => void): IptalEt;
}

// ---------------------------------------------------------------------------------------------
// Ws portu: tek `/sohbet` WebSocket'i. Telefon her zaman arayan taraftır.
// ---------------------------------------------------------------------------------------------

export interface WsDinleyici {
  acildi(): void;
  /** Bir metin çerçevesi. Çözme ve şema doğrulama çağırana aittir (`sohbetAsagiCoz`). */
  mesaj(metin: string): void;
  kapandi(kod: number): void;
  hata(): void;
}

export interface WsBaglantisi {
  gonder(metin: string): void;
  kapat(): void;
}

export interface WsPortu {
  /** `maxPayload` taşıma katmanında `AZAMI_CERCEVE.SOHBET`'e sabitlenir. */
  ac(url: string, dinleyici: WsDinleyici): WsBaglantisi;
}

// ---------------------------------------------------------------------------------------------
// Kimlik portu: /sohbet el sıkışmasının kimlik adımları. Yerel modüle (Kotlin) köprülenir.
// Özel anahtar ve imzalanan baytlar JS'e geçmez; port yalnız sonucu verir.
// ---------------------------------------------------------------------------------------------

export interface EslesmeBilgisi {
  device_id: string;
  host: string;
  port: number;
}

/** `oturum` 30 sn tek kullanımlıktır; `client_nonce` Kotlin'de üretilmiştir. */
export interface SohbetKimlikBaslangici {
  device_id: string;
  client_nonce: string;
  oturum: string;
}

/** Önce PC imzası doğrulanır; ancak sonra telefon imzası döner. */
export type SohbetImzaSonucu =
  | { signature: string }
  | { hata: "imza_gecersiz" | "oturum_yok" };

export interface KimlikPortu {
  eslesme(): Promise<EslesmeBilgisi | null>;
  sohbetHello(): Promise<SohbetKimlikBaslangici>;
  sohbetSinama(
    oturum: string,
    server_nonce: string,
    server_signature: string,
  ): Promise<SohbetImzaSonucu>;
}

// ---------------------------------------------------------------------------------------------
// Depo portu: kalıcı yerel durum. Atomik yazım (geçici dosya + taşıma); okuyan yarım görmez.
// `telafi` olayı diske yazıp sonra `last_seq`'i ilerletir; `outbox` kalıcı sayaç ve kuyruk tutar.
// ---------------------------------------------------------------------------------------------

export interface DepoPortu {
  /** Yoksa `null`. */
  oku(anahtar: string): Promise<string | null>;
  /** Atomik: geçici dosya + yeniden adlandırma. */
  yaz(anahtar: string, deger: string): Promise<void>;
  /** Olay günlüğüne tek satır ekler (çökmeye dayanıklı sıralı yazım). */
  ekle(anahtar: string, satir: string): Promise<void>;
  satirlar(anahtar: string): Promise<string[]>;
  sil(anahtar: string): Promise<void>;
  /**
   * Dilim 1. Uygulama: app/src/depo/dosyaDepo.ts, sahte: app/test/cekirdek/sahte.ts. Satır günlüğünü
   * verilen satırlarla ATOMİK değiştirir (geçici dosya + yeniden adlandırma): okuyan ya eskisini ya
   * yenisini görür, yarımını görmez. Sonra `satirlar` tam bunları, `ekle` bunların ardına yazar. Aynı
   * anahtarın `ekle`'leriyle sıralıdır. Mezar taşı (`chat_cleared`) olay günlüğünü kırparken kullanılır.
   */
  satirlariYaz(anahtar: string, satirlar: readonly string[]): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Ses portu: cihazın metin seslendirmesi. Gerçeği `app/src/cihaz/erenDevice.ts` (`sesPortu()`),
// sarmalayıcısı `seslendirici.ts`. İsteğe bağlıdır: verilmezse çekirdek hiçbir şey okumaz.
// ---------------------------------------------------------------------------------------------

export interface SesPortu {
  /** Metni okumaya başlar; okunamadıysa false. Asla reddetmez. */
  seslendir(metin: string): Promise<boolean>;
  /** Süren okumayı keser. Asla reddetmez. */
  durdur(): Promise<void>;
  /** Okuma başlayınca true, bitince/kesilince false. Kapatıcı döner. */
  durumDinle(f: (konusuyor: boolean) => void): () => void;
}

// ---------------------------------------------------------------------------------------------
// Dışa açık veri tipleri: modüller arası ortak sözcük dağarı
// ---------------------------------------------------------------------------------------------

/** `outbox` ögesi: kimlikten sonra sırayla yollanır, `ack` gelince silinir, `ok:false` yeniden yollanmaz. */
export interface GidenOgesi {
  /** Kalıcı sayaçtan üretilmiş `client_msg_id`. */
  client_msg_id: string;
  mesaj: SohbetYukari;
  yollandi: boolean;
}

/** `akis`: snapshot + offset'li delta ile kurulan, süren turun metni. */
export interface AkisDurumu {
  turn_id: string;
  metin: string;
}

/** Çözülmüş aşağı çerçeve: taşıma katmanından `akis`/`olaylar`/`baglanti`'ya geçen tip. */
export type GelenCerceve = SohbetAsagi;

/** `olaylar` girdisi: kalıcı olay. Görünüm modeli `olaylar.ts`'te kurulur. */
export type KaliciOlay = Olay;

/**
 * Mezar taşı olayı: o sohbetin (`sohbetAnahtari`) `seq <= sinir_seq` olan, yaşam döngüsü dışındaki
 * olayları silindi. Dilim 2: başka sohbetin olaylarına ve hiçbir yaşam döngüsü olayına dokunmaz.
 */
export type MezarTasi = Extract<Olay, { type: "chat_cleared" }>;

/**
 * Dilim 1. Uygulama: olaylar.ts (`GorunumOgesi` birleşimine girer), index.ts (dışa açar). Mezar taşı
 * uygulanınca görünümdeki tek öğe: önceki bütün öğeler (eski "geçmiş silindi" notları dahil) kalkar,
 * yerine bu not gelir. Ekranda tek satır "Geçmiş silindi". İçerik taşımaz.
 */
export interface GecmisSilindiNotu {
  tur: "gecmis_silindi";
  /** Mezar taşının `seq`'i; liste içinde benzersizdir. */
  seq: number;
  ts_ms: number;
  sinir_seq: number;
}

// =============================================================================================
// Dilim 2: çoklu sohbet. Kurallar ve iş listesi: ../../TASARIM.md "Dilim 2: çoklu sohbet".
// Kablo: `protocol/src/sohbet.ts` (SOHBET_SURUMU 3). Sohbet anahtarı her yerde `sohbetAnahtari`
// (`@eren/protocol`) ile okunur; elle `"ana"` yazılmaz.
// =============================================================================================

// ---------------------------------------------------------------------------------------------
// Olay sınıfları (telafi ve yönlendirme)
// ---------------------------------------------------------------------------------------------

/**
 * Dilim 2. Sohbet yaşam döngüsü olayı (`SOHBET_YASAM_OLAYLARI`). Görünüme (`olaylar`, `akis`) gitmez,
 * `SohbetDefteri`'ne gider. Telafi bunları hiçbir kırpmada silmez (silinmiş sohbetinkiler dahil).
 */
export type SohbetYasamOlayi = Extract<Olay, { type: "chat_created" | "chat_renamed" | "chat_deleted" }>;

/** Dilim 2. Silinen sohbet: telafi o sohbetin yaşam döngüsü dışındaki bütün satırlarını kırpar. */
export type SohbetSilindiOlayi = Extract<Olay, { type: "chat_deleted" }>;

/**
 * Dilim 2. Görünüm olayı: yaşam döngüsü dışındaki her kalıcı olay. `index` bunu
 * `sohbetAnahtari(o)` sohbetinin `olaylar` ve `akis` örneğine verir (sohbet başına bir örnek).
 */
export type GorunumOlayi = Exclude<KaliciOlay, SohbetYasamOlayi>;

// ---------------------------------------------------------------------------------------------
// Outbox (yukarı iş mesajları). Gerçekleyen: outbox.ts. Bu tipler outbox.ts'te yeniden
// tanımlanmaz; outbox.ts bunları buradan alır ve isterse yeniden dışa açar (`export type {...}`).
// ---------------------------------------------------------------------------------------------

/**
 * Dilim 2. Kimlik sonrası yukarı mesajların türleri: hepsi `client_msg_id` taşır ve `ack` alır.
 * `outbox.ts` ve `baglanti.ts`'teki çalışma anı kümeleri tam bu türleri içerir (eksiksizliği
 * `Record<IsMesajiTuru, true>` gibi bir yapıyla tipe bağlanır).
 */
export type IsMesajiTuru =
  | "user_message"
  | "interrupt"
  | "plan_decision"
  | "question_answer"
  | "job_cancel"
  | "chat_clear"
  | "chat_create"
  | "chat_rename"
  | "chat_delete";

export type IsMesaji = Extract<SohbetYukari, { type: IsMesajiTuru }>;

/**
 * Dilim 2. Geçici türler: yalnız bağlıyken gider, kopunca yeniden yollanmaz, önceki süreçten kalanı
 * yüklemede atılır, sonucu yalnız çağıranın sözünden döner (`bekleyenler`/`hatalar`'da görünmez).
 */
export type GeciciIsTuru = "chat_clear" | "chat_delete";

/** Dilim 2. Sohbet yönetim mesajları: görünümde balon değil, sohbet listesinde etki. */
export type SohbetYonetimMesaji = Extract<
  IsMesaji,
  { type: "chat_create" | "chat_rename" | "chat_delete" | "chat_clear" }
>;

type GovdeOf<M> = M extends unknown ? Omit<M, "v" | "client_msg_id"> : never;
/** `Outbox.ekle` girdisi: `v` ve `client_msg_id` kuyruğundur. */
export type GidenGovde = GovdeOf<IsMesaji>;

/** `outbox` öğesi (`GidenOgesi`'nin iş mesajlı hali). */
export interface OutboxOgesi extends GidenOgesi {
  mesaj: IsMesaji;
}

/**
 * `baglanti_koptu`: geçici öğe yollanamadan ya da `ack` gelmeden bağlantı gitti.
 * `ek_bulunamadi` (Medya): mesajın bir ekinin yerel kopyası telefonda yok (silinmiş, okunamıyor);
 * outbox öğeyi `hazirlik` sonucuyla hatalara taşır, yeniden yollanmaz. Diske yazılır ve yüklemede tanınır.
 */
export type GidenHataKodu = HataKodu | "baglanti_koptu" | "ek_bulunamadi";

export interface GidenHatasi {
  client_msg_id: string;
  mesaj: IsMesaji;
  kod: GidenHataKodu;
}

export type EkleSonucu =
  | { ok: true; client_msg_id: string }
  | { ok: false; neden: "gecersiz" | "depo_hatasi" };

export type AckCercevesi = Extract<GelenCerceve, { type: "ack" }>;

export type AckSonucu =
  | { ok: true; mesaj: IsMesaji; seq: number | null }
  | { ok: false; mesaj: IsMesaji; kod: HataKodu };

export interface EkleSecenekleri {
  /**
   * Diske yazılır ama bağlantı koparsa yeniden yollanmaz, `baglanti_koptu` hatası olur (hedefsiz
   * kesme). `GeciciIsTuru` bu seçenekten bağımsız hep geçicidir.
   */
  gecici?: boolean;
}

/** `yukle` sonucu: diskteki kuyruk ve hata öğelerinin toplamı. */
export interface YuklemeOzeti {
  /**
   * Dilim 2. v1 ya da v2 diskten v3'e çevrilip korunan öğe: `v` `SOHBET_SURUMU` olur;
   * `user_message`/`interrupt`/`chat_clear`'a `sohbet_id` yoksa `"ana"` (`ANA_SOHBET_ID`) eklenir.
   * Kimlik ve sıra değişmez; bir sonraki yazımda güncel sürüm yazılır. Dilim 3: v3 öğe de yükseltilir
   * (yalnız `v` güncel olur); v1/v2/v3 kayıtta `input: "kisayol"` ya da `baglam` varsa bozuktur, atılır.
   * 0.5.0: v4 öğe de yalnız `v`'si değişerek yükseltilir.
   */
  yukseltilen: number;
  /**
   * Korunmayan öğe: (yükseltilmiş hali de) şemadan geçmeyen, kuyrukta kimliği yinelenen, hata kodu
   * bilinmeyen ya da önceki süreçten kalan `GeciciIsTuru`.
   */
  atilan: number;
}

/** Dilim 2. Telefonun ürettiği sohbet kimliği: `s-<donem>-<sayac>` (`SohbetId` biçimi, hiç `"ana"` değil). */
export type SohbetIdUreticisi = () => SohbetId;

export interface Outbox {
  /** Kalıcı kuyruğu okur. Başka çağrıdan önce bir kez. Diske yazmaz. */
  yukle(): Promise<YuklemeOzeti>;
  /** Doğrular, kimlik verir, diske yazar; bağlıysa yazımdan sonra yollar. */
  ekle(govde: GidenGovde, secenek?: EkleSecenekleri): Promise<EkleSonucu>;
  /** Kimlik bitti: bekleyenler sırayla yollanır. `gonder` yollayamazsa `false` döner. */
  kimlikTamam(gonder: (m: SohbetYukari) => boolean): void;
  koptu(): void;
  /** Bilinmeyen `client_msg_id` için `null`. */
  ack(a: AckCercevesi): AckSonucu | null;
  /** Değişmedikçe aynı dizi döner. */
  ogeler(): readonly OutboxOgesi[];
  hatalar(): readonly GidenHatasi[];
  hataKapat(client_msg_id: string): Promise<void>;
  /**
   * Dilim 2. Yeni sohbet kimliği: `client_msg_id` ile AYNI kalıcı sayaçtan (`s-<donem>-<sayac+1>`,
   * sayaç artar). `yukle`'den sonra çağrılır (öncesinde atar); eşzamanlıdır. Sayaç ardından gelen `ekle`'nin
   * yazımıyla diske girer; yazım olmadan süreç ölürse kimlik hiçbir yere yazılmamıştır, yeniden
   * üretilmesi zararsızdır. Böylece cihazda bir kimlik iki sohbete verilmez, silinen kimlik dönmez.
   */
  sohbetIdUret: SohbetIdUreticisi;
  /**
   * Dilim 2. `kosul`'a uyan kuyruk öğelerini (yollanmış olsa da) ve hata öğelerini kaldırır, tek
   * yazımla diske yazar, kaldırılan sayısını döner. `kosul` çağrı anında, eşzamanlı değerlendirilir
   * ve bellekteki listeler hemen değişir (`degisti` çağrılır); söz yalnız yazımı bekler. `GeciciIsTuru` öğelerine dokunmaz (sonuçları
   * çağıranın sözündedir). Kaldırılan yollanmış öğenin geç gelen `ack`'i bilinmeyen `ack` gibi
   * zararsızdır (`null`). Yazım başarısızsa bellekte yine kaldırılmıştır; söz reddedilir.
   * `ack ok` almış, olayı henüz günlüğe yazılmamış `chat_create`'in diskte tutulan kopyası da
   * (görünür listelerde olmasa da) `kosul`'a uyuyorsa silinir.
   * Kullanım: kurulamamış sohbetin yerel kaldırılması, silinen sohbetin artıkları.
   */
  kaldir(kosul: (m: IsMesaji) => boolean): Promise<number>;
  bosalt(): Promise<void>;
  /**
   * Medya (U2). Yeni ek kimliği `m-<donem>-<sayac+1>`: `sohbetIdUret` ile AYNI kalıcı sayaç ve aynı
   * kurallar (`yukle`'den sonra, eşzamanlı, öncesinde atar; sayaç sonraki yazımla diske girer). Bir
   * cihazda bir kimlik iki eke verilmez. Medya dalgası boyunca isteğe bağlıdır (TASARIM.md "Medya"),
   * `outboxKur` her zaman verir.
   */
  medyaIdUret?: () => MedyaId;
  /**
   * Medya (U2). `hazirlik`'in sonucu değişmiş olabilir (yükleyici `degisti`): kimlik bitmişse
   * bekleyenler `kimlikTamam`'daki kurallarla yeniden denenir (zaten yollanmış öğe ikinci kez gitmez);
   * değilse hiçbir şey yapmaz. Eşzamanlıdır. Medya dalgası boyunca isteğe bağlıdır, `outboxKur` her zaman verir.
   */
  hazirlikDegisti?(): void;
}

export interface OutboxBagimliliklari {
  depo: DepoPortu;
  /** Yalnız ilk açılışta kimlik dönemi için. */
  saat: SaatPortu;
  /** `ogeler` ya da `hatalar` değişti. */
  degisti(): void;
  /**
   * Medya (U2 uygular, U3 verir). Yollanmamış her öğe yollanmadan hemen önce sorulur (eşzamanlı, atmaz).
   * Verilmezse her öğe `"hazir"` sayılır (bugünkü davranış).
   * - `"hazir"`: öğe yollanır.
   * - `"bekliyor"`: öğe yollanmaz, kuyrukta kalır; aynı `sohbet_id`'nin SONRAKİ `user_message`'ları da bu
   *   geçişte atlanır (sohbetin sırası korunur). Öteki sohbetler, sohbetsiz öğeler (`plan_decision`,
   *   `question_answer`, `job_cancel`) ve aynı sohbetin `interrupt`/`chat_*` öğeleri yürür.
   * - `{ hata }`: öğe kuyruktan hatalara taşınır (`GidenHatasi.kod = hata`, kalıcı, yeniden yollanmaz);
   *   sohbet tıkanmaz, geçiş sürer.
   * Ek taşımayan öğe için gerçek bağımlılık hep `"hazir"` döner. `kalici`/`gecici` kuralları aynen.
   */
  hazirlik?(m: IsMesaji): MesajHazirligi;
}

export type OutboxFabrikasi = (b: OutboxBagimliliklari) => Outbox;

// ---------------------------------------------------------------------------------------------
// Sohbet defteri ve liste özeti. Gerçekleyen: sohbetler.ts (saf, port yok).
// ---------------------------------------------------------------------------------------------

/** Dilim 2. Bilinen, silinmemiş bir sohbetin yaşam döngüsü olaylarından kurulan kaydı. */
export interface SohbetKaydi {
  sohbet_id: SohbetId;
  /**
   * En yeni `chat_renamed`'in adı; yoksa `chat_created`'ınki; `ana` için defterin `anaAdi`'si
   * (görünen asistan adı, verilmezse `ANA_SOHBET_ADI`).
   */
  ad: SohbetAdi;
  /** `chat_created.seq`; `ana` için 0 (göçle vardır, olayı yoktur). */
  olusturma_seq: number;
  /** `chat_created.ts_ms`; `ana` için 0. */
  olusturma_ms: number;
}

/**
 * Dilim 2. Yaşam döngüsü olaylarından sohbet kayıtları. `ana` her zaman vardır ve silinemez.
 * Olaylar `seq` sırasıyla gelir; `seq`'i son uygulanandan büyük olmayan olay yok sayılır.
 */
export interface SohbetDefteri {
  /**
   * `chat_created`: kayıt eklenir (zaten varsa ya da silinmişse yok sayılır). `chat_renamed`:
   * bilinen kaydın adı değişir (bilinmeyen, silinmiş kimlik yok sayılır; `ana` adlandırılabilir).
   * `chat_deleted`: kayıt kalkar, kimlik silinmişlere girer (`ana` için yok sayılır). Görünür bir
   * şey değiştiyse `true`.
   */
  olay(o: SohbetYasamOlayi): boolean;
  /** Yalnız `ana` (adı `anaAdi`) kalır, silinmişler boşalır, `seq` sınırı 0 olur. */
  sifirla(): void;
  /** Silinmemiş kayıtlar, `ana` dahil. Değişmedikçe aynı nesne. */
  kayitlar(): ReadonlyMap<SohbetId, SohbetKaydi>;
  /** `chat_deleted` görüldü mü. */
  silindiMi(sohbet_id: SohbetId): boolean;
}

/**
 * `anaAdi`: `ana`'nın yer tutucu adı (sunucudan `chat_renamed` gelene dek). Verilmezse ya da
 * `SohbetAdi`'ndan geçmezse `ANA_SOHBET_ADI`. Sunucudan gelen ad her zaman önceliklidir.
 */
export type SohbetDefteriFabrikasi = (anaAdi?: string) => SohbetDefteri;

/**
 * Dilim 2. `kuruldu`: servis biliyor (defterde ya da `chat_create`'i `ack ok` aldı). `bekliyor`:
 * `chat_create` kuyrukta (çevrimdışı yaratıldı). `kurulamadi`: `chat_create` `ok:false` aldı
 * (ör. `sohbet_siniri`); yalnız yerel kaldırılabilir.
 */
export type SohbetKurulumu = "kuruldu" | "bekliyor" | "kurulamadi";

/** Dilim 2. Listede önizleme: son kullanıcı ya da asistan balonunun ham metni (ekran kırpar). */
export interface SonMesaj {
  kim: "kullanici" | "asistan";
  metin: string;
}

/** Dilim 2. Sohbet listesinin (çekmece) bir satırı. */
export interface SohbetOzeti {
  sohbet_id: SohbetId;
  /** Geçerli ad: kuyruktaki ya da teslim edilmiş son `chat_rename` defterdekinden önce gelir. */
  ad: SohbetAdi;
  /** `sohbet_id === ANA_SOHBET_ID`: silinemez. */
  ana: boolean;
  kurulum: SohbetKurulumu;
  /** Son `server_status.sohbetler`'deki durum; bağlı değilken ya da listede yoksa `null`. */
  eren: SohbetErenDurumu | null;
  /** Bu sohbette akış var ya da `eren === "tur_suruyor"`. */
  yaziyor: boolean;
  /** TASARIM.md "Okunmamış": okunmuş sınırından sonraki asistan kaynaklı görünüm öğeleri. */
  okunmamis: number;
  /** Görünümdeki `durum: "suruyor"` iş kartı sayısı. */
  calisanIs: number;
  sonMesaj: SonMesaj | null;
  /**
   * Son görünüm öğesinin `ts_ms`'i ile `olusturma_ms`'in büyüğü. Defterde kaydı yoksa (`bekliyor`,
   * `kurulamadi` ya da olayı henüz gelmemiş teslim edilmiş kurulum) `null`: bunlar listenin başındadır.
   */
  sonEtkinlikMs: number | null;
}

/** Dilim 2. `OzetGirdisi.gorunum`'un döndüğü: bir sohbetin `olaylar` ve `akis` örneğinin anlık hali. */
export interface SohbetGorunumu {
  ogeler: readonly GorunumOgesi[];
  akis: AkisDurumu | null;
}

/** Dilim 2. Liste özetinin girdileri; `index` biri değişince yeniden kurar. */
export interface OzetGirdisi {
  kayitlar: ReadonlyMap<SohbetId, SohbetKaydi>;
  kuyruk: readonly OutboxOgesi[];
  hatalar: readonly GidenHatasi[];
  /**
   * `ack ok` almış ama yaşam döngüsü olayı henüz uygulanmamış `chat_create`/`chat_rename`'ler,
   * teslim sırasıyla (`ack` ile olay arasında ad ya da sohbet geri gidip gelmesin).
   */
  teslimler: readonly SohbetYonetimMesaji[];
  /** Son `server_status.sohbetler`; bağlı değilken `null`. */
  sunucu: readonly SunucuSohbetDurumu[] | null;
  /** Sohbetin görünümü; hiç olayı yoksa `null` (boş sayılır). */
  gorunum(sohbet_id: SohbetId): SohbetGorunumu | null;
  /** Okunmuş sınırı: `max(taban_seq, okundu[sohbet_id] ?? 0)`. */
  okunduSeq(sohbet_id: SohbetId): number;
  /** `kayitlar`'da `ana` yoksa eklenen yer tutucunun adı; verilmezse `ANA_SOHBET_ADI`. */
  anaAdi?: string;
}

/** Dilim 2. Saf: listeyi TASARIM.md "Sohbet listesi" kurallarıyla ve sırasıyla kurar. */
export type OzetleriKur = (g: OzetGirdisi) => readonly SohbetOzeti[];

/**
 * Dilim 2. Saf: kullanıcının yazdığı adı kabloya hazırlar. Baş/son boşluk kırpılır; boşsa ya da
 * `SohbetAdi`'ndan geçmezse (satır sonu, görünmez karakter, 60 UTF-16 birimini aşan) `null`.
 */
export type AdHazirla = (ham: string) => SohbetAdi | null;

/**
 * Dilim 2. Saf: ilk mesajdan otomatik ad önerisi. Boşluk dizileri (satır sonu dahil) tek boşluk,
 * görünmez/yön karakterleri atılır, kırpılır; 40 UTF-16 birimini aşarsa sözcük ortasından
 * kesilmeden kısaltılıp sonuna "…" eklenir (tek sözcük 40'ı aşıyorsa 40'ta kesilir). Sonuç
 * `SohbetAdi` değilse ya da `VARSAYILAN_SOHBET_ADI`'na eşitse `null`.
 */
export type OtomatikAdUret = (metin: string) => SohbetAdi | null;

/** Dilim 2. Saf: TASARIM.md "Okunmamış" tanımındaki asistan kaynaklı öğe mi. */
export type ErenKaynakliMi = (o: GorunumOgesi) => boolean;

// ---------------------------------------------------------------------------------------------
// Seçim deposu: en son açık sohbet ve okunmuş sınırları. Gerçekleyen: secim.ts (DepoPortu üstünde).
// Ayrı platform portu yoktur; yeni bir depo anahtarı kullanır.
// ---------------------------------------------------------------------------------------------

/** Dilim 2. Kalıcı seçim kaydı. Kişisel metin taşımaz (yalnız kimlik ve `seq`). */
export interface SecimKaydi {
  /** En son açık (seçili) sohbet. */
  acik: SohbetId;
  /**
   * Bu `seq`'e kadarki her şey bütün sohbetlerde okunmuş sayılır. İlk Dilim 2 açılışında yüklemeden
   * sonraki `telafi.sonSeq()`; yerel sıfırlamadan sonra ilk `welcome.head_seq`.
   */
  taban_seq: number;
  /** Sohbet başına okunmuş sınırı (`okundu()` anındaki `telafi.sonSeq()`). Silinen sohbetinki kalkar. */
  okundu: Readonly<Record<SohbetId, number>>;
}

export interface SecimDeposu {
  /** Kayıt yoksa, bozuksa ya da okunamazsa `null` (atmaz: tercih açılışı durdurmaz). */
  yukle(): Promise<SecimKaydi | null>;
  /** Arkadan, sırayla; son yazılan kazanır. Hata yutulur (en kötü: seçim ya da okundu bilgisi eskir). */
  yaz(k: SecimKaydi): void;
  /** Sıradaki yazımlar bitince çözülür. */
  bosalt(): Promise<void>;
}

export type SecimDeposuFabrikasi = (b: { depo: DepoPortu }) => SecimDeposu;

// ---------------------------------------------------------------------------------------------
// Çekirdeğin ekranlara açtığı yüzey. Gerçekleyen: index.ts (`cekirdekKur`), yalnız o birleştirir.
// Ekranlar bu tipleri `cekirdek/index.ts`'ten alır (index bunları yeniden dışa açar).
// React: `useSyncExternalStore(cekirdek.abone, cekirdek.durum)` ve sohbet başına
// `useSyncExternalStore(s.abone, s.durum)`; ikisi de değişmedikçe aynı nesneyi döner.
// ---------------------------------------------------------------------------------------------

export interface CekirdekPortlari {
  ws: WsPortu;
  kimlik: KimlikPortu;
  depo: DepoPortu;
  saat: SaatPortu;
  /**
   * Verilirse bu çalışmada sesle (`dikte`, `kisayol`) gönderilen mesajın cevabı tamamlanınca bir kez
   * okunur (`sesliYanit.ts`); herhangi bir yolla yeni mesaj gönderilince süren okuma kesilir.
   */
  ses?: SesPortu;
  /**
   * Medya. Verilirse yükleyici kurulur ve servis `medya1` dediğinde ekli gönderim açılır. Verilmezse
   * `medyaDestekli` hep `false`, ekli `mesajYolla` `medya_desteklenmiyor` döner, `media_state` yok
   * sayılır (özellik bayrağı: bugünkü davranış). Gerçeği `platform/medyaDosya.ts` (U4).
   */
  medya?: MedyaDosyaPortu;
}

/** Son `server_status`, `v`/`type` olmadan. Dilim 2: `eren` yok, `sohbetler` var. Bağlantı yokken `null`. */
export type SunucuDurumu = Omit<Extract<GelenCerceve, { type: "server_status" }>, "v" | "type">;

/** `depo_hatasi`: yerel kalıcı depo okunamadı ya da yazılamadı. */
export type SohbetHatasi = BaglantiHatasi | "depo_hatasi";

/** Bütün sohbetlerde ortak bağlantı durumu (tek WebSocket, tek telafi). */
export interface BaglantiOzeti {
  baglanti: BaglantiDurumu;
  /** Bekleyen yeniden denemenin zamanı (`saat.simdiMs` cinsinden). */
  sonrakiDenemeMs: number | null;
  /** Son bağlantı ya da depo hatası; kimlik tamamlanınca temizlenir. */
  hata: SohbetHatasi | null;
  /** `welcome.head_seq`'e kadar eksik olaylar geliyor. */
  esitleniyor: boolean;
  sunucu: SunucuDurumu | null;
}

/** Dilim 2. Çalışan iş ve sohbeti (iş hapı, "Çalışan işler" alt sayfası). */
export interface CalisanIs {
  sohbet_id: SohbetId;
  is: IsKarti;
}

/** Tüketim raporu: `usage_report` çerçevesi, `v`/`type`/`istek_id` olmadan (`istek_id` yalnız eşleşme içindir). */
export type TuketimRaporu = Omit<UsageReport, "v" | "type" | "istek_id">;

/**
 * Tüketim raporunun ekran durumu. `yok`: hiç istenmedi. `bekleniyor`: istek yolda (`rapor` önceki
 * rapor, yoksa `null`). `hazir`: rapor geldi, `alindiMs` `saat.simdiMs` cinsinden. `hata`: zaman
 * aşımı (15 sn); `rapor` önceki rapor, yoksa `null`.
 */
export type TuketimDurumu =
  | { durum: "yok" }
  | { durum: "bekleniyor"; rapor: TuketimRaporu | null }
  | { durum: "hazir"; rapor: TuketimRaporu; alindiMs: number }
  | { durum: "hata"; rapor: TuketimRaporu | null };

export interface CekirdekDurumu extends BaglantiOzeti {
  /** `baslat`'ın yüklemesi bitti. Öncesinde liste yalnız `ana`'dır. */
  yuklendi: boolean;
  /** Bilinen ve yerel bekleyen sohbetler, TASARIM.md "Sohbet listesi" sırasıyla; `ana` hep içinde. */
  sohbetler: readonly SohbetOzeti[];
  /** Seçili (açık) sohbet; her zaman `sohbetler`'de olan bir kimlik. Kalıcıdır. */
  secili: SohbetId;
  /** Bütün sohbetlerdeki `suruyor` iş kartları, `seq` sırasıyla. */
  calisanIsler: readonly CalisanIs[];
  /** Token tüketim raporu (BaglantiOzeti'nde değil: sohbet durumlarına yayılmaz). */
  tuketim: TuketimDurumu;
  /**
   * Sesli yanıt okunuyor (ses portunun `durumDinle` bildirimi); `sustur()` keser. Gerçek çekirdek
   * her zaman yazar (port yoksa `false`); isteğe bağlılık yalnız elle kurulan durum nesneleri içindir.
   */
  seslendiriyor?: boolean;
  /**
   * Medya. Ek düğmesi açık mı: `medya` portu verildi VE bu süreçte görülen son `welcome`'ın
   * `yetenekler`'inde `SOHBET_YETENEKLERI.MEDYA` var. İlk `welcome`'a dek `false`; bağlantı kopunca son
   * değer korunur (çevrimdışı ekli mesaj kuyruğa girebilir), sonraki `welcome` yeniden yazar. Eski servis
   * alanı hiç yazmaz: `false`. Gerçek çekirdek her zaman yazar; isteğe bağlılık `seslendiriyor` gibidir.
   */
  medyaDestekli?: boolean;
}

/**
 * `kuyrukta`: diskte, henüz bu bağlantıda yollanmadı. `yollandi`: `ack` bekliyor.
 * `teslim_edildi`: `ack` geldi, `user_echo` olayı henüz gelmedi (`user_message`); karar gönderimleri
 * (`plan_decision`, `question_answer`, `job_cancel`) için de kullanılır: `ack ok` geldi, kart hâlâ bekliyor.
 */
export type BekleyenDurumu = "kuyrukta" | "yollandi" | "teslim_edildi";

/** Dilim 2: `mesaj` yalnız `user_message`, `interrupt`, `plan_decision`, `question_answer`, `job_cancel`. */
export interface BekleyenOge {
  client_msg_id: string;
  mesaj: IsMesaji;
  durum: BekleyenDurumu;
}

/** Dilim 2. Tek sohbetin ekran durumu (bağlantı alanları bütün sohbetlerde aynıdır). */
export interface SohbetDurumu extends BaglantiOzeti {
  sohbet_id: SohbetId;
  /** Listede yoksa (silindi, yerel kaldırıldı, hiç olmadı) `null`. */
  ozet: SohbetOzeti | null;
  /** Bu sohbetin kalıcı olaylarından zaman çizelgesi; `seq` sırasıyla. */
  ogeler: readonly GorunumOgesi[];
  /** Bu sohbetin süren turu; `ogeler`'in sonunda gösterilir. */
  akis: AkisDurumu | null;
  /**
   * Asistanın bu sohbette o anki etkinliği (`assistant_activity`); turu bitiren olayla, kopukta ve
   * sıfırlamada `null`. Servis bu çerçeveyi yollamıyorsa hep `null`.
   */
  etkinlik: EtkinlikDurumu | null;
  /** Bu sohbetin henüz olayı gelmemiş yukarı mesajları, yollanış sırasıyla. */
  bekleyenler: readonly BekleyenOge[];
  /**
   * Bu sohbetin `ok:false` gelen ya da bağlantıyla düşen mesajları; yeniden yollanmaz, `hataKapat`
   * ile kalkar. `chat_create`/`chat_rename` hataları da buradadır; `GeciciIsTuru` hiç görünmez.
   * `plan_decision` + `izin_bekleniyor` hata değildir: karar alındı, telefon izni bekleniyor.
   */
  hatalar: readonly GidenHatasi[];
  /**
   * Medya. Bu sohbetin `ogeler`'indeki `KullaniciBalonu.ekler`'inde, `bekleyenler`'inde ve `hatalar`'ındaki
   * `user_message.ekler`'de geçen her `medya_id` için yükleyicinin `gorunum`'ü; yükleyici `null`
   * dönerse anahtar yazılmaz (ekran "bu cihazda yok" yer tutucusunu gösterir). İçerik değişmedikçe aynı
   * nesne. Gerçek çekirdek her zaman yazar (port yoksa boş); isteğe bağlılık `seslendiriyor` gibidir.
   */
  ekGorunumleri?: ReadonlyMap<MedyaId, EkGorunumu>;
}

export type GonderRedNedeni =
  /** `baslat` hiç başarmadı. */
  | "baslamadi"
  /** Kablo şemasına uymuyor (boş ya da çok uzun metin, geçersiz ad gibi). */
  | "gecersiz"
  | "depo_hatasi"
  /** Kart yok ya da özet bu kartın değil (kart bu sohbette değilse de). */
  | "plan_yok"
  | "plan_sonuclandi"
  | "soru_yok"
  | "soru_sonuclandi"
  | "is_yok"
  | "is_bitti"
  /** Aynı karta ait bir mesaj zaten kuyrukta. */
  | "zaten_yollandi"
  /** Hedef turu bilinmeyen kesme yalnız bağlıyken yollanır. */
  | "bagli_degil"
  /** Dilim 2. Sohbet listede yok ya da `kurulamadi`: hiçbir şey kuyruğa girmez. */
  | "sohbet_bulunamadi"
  /** Medya. Ek verildi ama `medyaDestekli` değil (port yok ya da servis `medya1` demedi). */
  | "medya_desteklenmiyor"
  /** Medya. Bir ek kopyalanamadı/küçültülemedi ya da hazırlanınca türünün bayt sınırını aştı. */
  | "ek_hazirlanamadi"
  /** Medya. Yükleyicideki bekleyen ekler + yeniler `MEDYA_SINIRLARI.BEKLEYEN_YUKLEME`'yi aşıyor. */
  | "ek_siniri";

export type GonderSonucu =
  | { ok: true; client_msg_id: string }
  | { ok: false; neden: GonderRedNedeni };

/**
 * Dilim 3. Kısayol bağlamı (`/sohbet` v4 `user_message.baglam`, `user_echo.baglam`): kullanıcının
 * kısayolu açtığı an baktığı uygulama. `paket` Android paket adı, `ad` 1-80 UTF-16 birimi, kontrol
 * karakteri yok (`KisayolBaglami`, `@eren/protocol`). Yalnız `input === "kisayol"` ile.
 */
export type MesajBaglami = KisayolBaglami;

export type PlanKarari = Extract<IsMesaji, { type: "plan_decision" }>["karar"];

/**
 * Dilim 2. `adlandir` sonucu. `degisti: false`: ad geçerli adla aynıydı, hiçbir şey yollanmadı.
 * `ok:true` adın kuyruğa (diske) girdiği demektir; servis reddederse hata sohbetin `hatalar`'ına düşer.
 */
export type AdlandirSonucu =
  | { ok: true; degisti: boolean }
  | { ok: false; neden: "baslamadi" | "gecersiz" | "depo_hatasi" | "sohbet_bulunamadi" };

/**
 * Dilim 1 (Dilim 2'de sohbet başına). `gecmisiSil` ve `sil` başarısızlığı. Yerel ret de kablo
 * kodunu kullanır: `ana` silinmek istenirse `sohbet_silinemez`, listede olmayan sohbet
 * `sohbet_bulunamadi`.
 */
export type GecmisSilHatasi =
  /** `baslat` hiç başarmadı. */
  | "baslamadi"
  /** Yalnız bağlıyken; istek kuyruğa girmez. */
  | "bagli_degil"
  /** Bir silme (geçmiş ya da sohbet, herhangi bir sohbette) zaten yolda, `ack` bekleniyor. */
  | "zaten_yollandi"
  | "depo_hatasi"
  /**
   * İstek yollandı ama `ack` gelmeden bağlantı koptu: servis silmiş de olabilir, silmemiş de.
   * Silmişse olay yeniden bağlanınca telafiyle gelir ve görünüm kendiliğinden değişir.
   */
  | "baglanti_koptu"
  /**
   * Servisin `ack.code`'u ya da yerel ret. `sohbet_mesgul`: o sohbette asistan konuşuyor ya da
   * devrediyor, iş çalışıyor ya da soru bekliyor; hiçbir şey silinmedi.
   */
  | HataKodu;

export type GecmisSilSonucu = { ok: true } | { ok: false; kod: GecmisSilHatasi };

/** Dilim 2. `Sohbet.sil` başarısızlığı: `gecmisiSil` ile aynı küme ve anlam. */
export type SohbetSilHatasi = GecmisSilHatasi;
export type SohbetSilSonucu = GecmisSilSonucu;

/**
 * Dilim 2. `sohbetAc` sonucu. `sohbet_siniri`: silinmemiş + bekleyen (kurulamamışlar hariç) sohbet
 * sayısı `SOHBET_SINIRLARI.SOHBET_ADET`; hiçbir şey yazılmaz.
 */
export type SohbetAcSonucu =
  | { ok: true; sohbet_id: SohbetId }
  | { ok: false; neden: "baslamadi" | "gecersiz" | "sohbet_siniri" | "depo_hatasi" };

/**
 * Dilim 2. Tek sohbetin tutamacı. `Cekirdek.sohbet(id)` aynı kimliğe hep aynı nesneyi verir; kimlik
 * listede değilse de verir (`durum().ozet === null`, eylemler `sohbet_bulunamadi`). Dilim 1'deki
 * `Sohbet`'in eylemleri aynen burada, bu sohbet için.
 */
export interface Sohbet {
  readonly sohbet_id: SohbetId;
  /** Değişmedikçe aynı nesne döner. */
  durum(): SohbetDurumu;
  /** Çekirdekteki her değişiklikte çağrılır; ilk çağrı hemen, o anki durumla. */
  abone(dinleyici: (durum: SohbetDurumu) => void): IptalEt;
  /**
   * `user_message{sohbet_id}`; diske yazılınca çözülür, bağlantı yoksa kimlikten sonra yollanır.
   * Sohbetin geçerli adı `VARSAYILAN_SOHBET_ADI` ve bu ilk kullanıcı mesajıysa ardından
   * `chat_rename{otomatikAd(metin)}` kuyruğa girer (`null` ise girmez; sonucu döndürülmez).
   * Dilim 3: `baglam` (kısayolun açıldığı an bakılan uygulama) yalnız `input === "kisayol"` ile
   * kabul edilir ve `user_message.baglam` olarak gider; başka girdi yoluyla verilirse ya da
   * `KisayolBaglami` şemasından geçmezse hiçbir şey kuyruğa girmez, `gecersiz` döner. Kısayolda da
   * isteğe bağlıdır.
   *
   * Medya (U3). `ekler` boş değilse: yalnız `input === "yazi"` ve `baglam` yokken (değilse `gecersiz`);
   * `metin` boş olabilir (otomatik ad o zaman üretilmez). Sıra, ilk tutmayan döner, hiçbir şey kuyruğa
   * girmez: `gecersiz` (girdi yolu, bağlam) → `baslamadi` → `sohbet_bulunamadi` → `gecersiz` (adet,
   * tekillik, tek video) → `medya_desteklenmiyor` → `ek_siniri` → her ek için `Outbox.medyaIdUret` + `MedyaDosyaPortu.hazirla`
   * (biri düşerse hazırlananlar silinir, `ek_hazirlanamadi`) → `EkBilgisi` şeması (`gecersiz`) →
   * `Yukleyici.ekle` (tek yazım; `depo_hatasi`) → `Outbox.ekle(user_message{ekler})` (düşerse
   * `Yukleyici.iptal`). `ekler` boş ya da verilmemişse bugünkü davranış.
   */
  mesajYolla(
    metin: string,
    input: GirdiYolu,
    baglam?: MesajBaglami,
    ekler?: readonly SeciliEk[],
  ): Promise<GonderSonucu>;
  /** Yalnız bu sohbetin, özeti doğrulanmış, sonuçlanmamış plan kartı için. */
  planKarari(plan_id: string, plan_hash: string, karar: PlanKarari): Promise<GonderSonucu>;
  soruCevapla(soru_id: string, cevap: string): Promise<GonderSonucu>;
  isIptal(is_id: number): Promise<GonderSonucu>;
  /** `interrupt{sohbet_id}`. `turn_id` verilmezse bu sohbetin akışının turu; o da yoksa hedefsiz, yalnız bağlıyken. */
  kes(turn_id?: string): Promise<GonderSonucu>;
  /**
   * Hata satırını kaldırır. `chat_create` hatasıysa sohbetin bütün yerel artıklarını da (`sil` gibi).
   * Medya: `ekler`'li `user_message` hatasıysa eklerini `Yukleyici.iptal` eder ("Kaldır").
   */
  hataKapat(client_msg_id: string): Promise<void>;
  /** `chat_clear{sohbet_id}`; Dilim 1 kuralları (yalnız bağlıyken, geçici, `ack`'le çözülür, 20 sn). */
  gecmisiSil(): Promise<GecmisSilSonucu>;
  /** `chat_rename{sohbet_id, adHazirla(ad)}`; kuyrukta bekleyebilir. */
  adlandir(ad: string): Promise<AdlandirSonucu>;
  /**
   * Sohbeti siler. `ana` → `sohbet_silinemez`; listede yoksa `sohbet_bulunamadi`; `kurulamadi`
   * ise kablo yok: yerel artıklar `Outbox.kaldir` ile kalkar, `{ok:true}`. Değilse `gecmisiSil` gibi
   * `chat_delete` (geçici, yalnız bağlıyken, `ack`'le çözülür, 20 sn). İki adımlı onayı ekran ister.
   */
  sil(): Promise<SohbetSilSonucu>;
  /** Bu sohbet şu ana dek okundu: `okundu[sohbet_id] = telafi.sonSeq()` (değişmediyse yazmaz). */
  okundu(): void;
}

export interface Cekirdek {
  /** Kalıcı geçmişi, kuyruğu ve seçimi okur, bağlanmaya başlar. Depo okunamazsa atar; yeniden çağrılabilir. */
  baslat(): Promise<void>;
  /** Bağlantıyı kapatır, yeniden denemez. Kuyruk diskte kalır. */
  kapat(): void;
  /** Bekleyen yeniden denemeyi hemen yapar (ağ geri geldi, eşleşme bitti). */
  simdiBaglan(): void;
  /** Değişmedikçe aynı nesne döner. */
  durum(): CekirdekDurumu;
  /** Her değişiklikte çağrılır; ilk çağrı hemen, o anki durumla. */
  abone(dinleyici: (durum: CekirdekDurumu) => void): IptalEt;
  /** Kimliğe göre tutamaç; aynı kimliğe aynı nesne. */
  sohbet(sohbet_id: SohbetId): Sohbet;
  /**
   * Yeni sohbet: `Outbox.sohbetIdUret` ile kimlik, `chat_create{sohbet_id, ad}` kuyruğa (çevrimdışı
   * bekleyebilir), diske yazılınca seçilir ve çözülür. `ad` verilmez ya da kırpılınca boşsa
   * `VARSAYILAN_SOHBET_ADI`; verilip `adHazirla`'dan geçmezse `gecersiz`.
   */
  sohbetAc(ad?: string): Promise<SohbetAcSonucu>;
  /** Seçili sohbeti değiştirir ve kalıcı yazar. Kimlik listede yoksa `false`, hiçbir şey değişmez. */
  sec(sohbet_id: SohbetId): boolean;
  /**
   * `usage_request` yollar ve `tuketim`'i `bekleniyor` yapar. Bağlı değilse, bekleyen istek varsa ya
   * da son rapor 10 sn'den yeniyse hiçbir şey yollamaz ve `false` döner.
   */
  tuketimIste(): boolean;
  /** Süren (ya da başlamak üzere olan) sesli okumayı keser. Ses portu yoksa hiçbir şey yapmaz. */
  sustur(): void;
}

/** Port olmayan kurulum seçenekleri. */
export interface CekirdekSecenekleri {
  /**
   * Görünen asistan adı (derleme anında `EREN_KIT_ASSISTANT_NAME`); `ana`'nın yer tutucu adı olur.
   * Verilmezse `ANA_SOHBET_ADI`. Sunucudan gelen ad (`chat_renamed`) her zaman önceliklidir.
   */
  asistanAdi?: string;
}

export type CekirdekFabrikasi = (portlar: CekirdekPortlari, secenekler?: CekirdekSecenekleri) => Cekirdek;

// =============================================================================================
// Medya dalgası: fotoğraf ve video ekleri. Kurallar, paketler (U1-U5b) ve dosya sahipliği:
// ../../TASARIM.md "Medya". Kablo: `protocol/src/medya.ts` (yetenek `medya1`, `SOHBET_SURUMU` aynı),
// sınırlar `MEDYA_SINIRLARI`. Var olan arayüzlere bu dalgada eklenen üyeler (`Outbox.medyaIdUret`,
// `Outbox.hazirlikDegisti`, `OutboxBagimliliklari.hazirlik`, `CekirdekPortlari.medya`,
// `CekirdekDurumu.medyaDestekli`, `SohbetDurumu.ekGorunumleri`) isteğe bağlıdır: ara commit'ler tip
// denetiminden geçsin diye. Gerçekleyen her zaman verir; dalga bitince sözleşme sahibi zorunlu yapar.
// Akış: seçici (`MedyaSeciciPortu`, ekran) → `ekleriDenetle` (saf) → şerit (`SeciliEk`) →
// `Sohbet.mesajYolla(..., ekler)` → `MedyaDosyaPortu.hazirla` → `Yukleyici.ekle` + `Outbox.ekle` →
// yükleme (`media_*`) → `kabul` → outbox `hazirlik` `"hazir"` → `user_message{ekler}`.
// =============================================================================================

// ---------------------------------------------------------------------------------------------
// Seçim (ekran tarafı). Çekirdek seçiciyi çağırmaz; `SohbetEkrani` çağırır, sonucu `ekleriDenetle`'den
// geçirir ve şeritte tutar.
// ---------------------------------------------------------------------------------------------

/** Medya. Ekin kaynağı ("Ekle" alt sayfasının üç seçeneği). */
export type MedyaKaynagi = "galeri" | "foto_cek" | "video_cek";

/**
 * Medya. Seçicinin döndürdüğü bir öğe: beyan, doğrulanmamış. Bilinmeyen alan `null`. Platform
 * `boyut`'u seçici vermezse dosyadan okur; `sure_ms`'i tam sayı ms'ye yuvarlar (0 ya da yoksa `null`);
 * `mime`'ı seçici vermezse uzantıdan çıkarır, yine bilinmiyorsa `null`. `tur` seçicinin `image`/`video`
 * türüdür, başka bir şeyse `null`.
 */
export interface HamMedya {
  /** Seçici önbelleğindeki yerel adres. Silinebilir: gönderimde `hazirla` kopyalar. */
  uri: string;
  tur: MedyaTuru | null;
  mime: string | null;
  boyut: number | null;
  sure_ms: number | null;
  genislik: number | null;
  yukseklik: number | null;
}

/**
 * Medya. `ok: true` + boş `ogeler`: kullanıcı vazgeçti. `izin_yok`: kamera izni verilmedi (galeri yolu
 * çalışmaya devam eder). `hata`: seçici açılamadı ya da düştü.
 */
export type MedyaSecimSonucu =
  | { ok: true; ogeler: readonly HamMedya[] }
  | { ok: false; neden: "izin_yok" | "hata" };

/**
 * Medya (U4 gerçekler: `platform/medyaSecici.ts`, `expo-image-picker`; sahtesi `SahteMedyaSecici`).
 * - `galeri`: Android Photo Picker (depolama izni istemez); fotoğraf ve video, çoklu seçim, en çok
 *   `kalan` öğe; EXIF ve base64 istenmez.
 * - `foto_cek`: kamera, tek fotoğraf. `video_cek`: kamera, tek video; kayıt üst sınırı
 *   `KAMERA_VIDEO_AZAMI_SN` = 295 sn (`medyaSecici.ts`'te tanımlanır): `MEDYA_SINIRLARI.VIDEO_SURE_MS`
 *   (300 sn) kameranın birkaç ms taşmasıyla aşılmasın diye 5 sn altında.
 * - Kamera izni yalnız kamera kaynağında, çalışma anında istenir; reddedilirse `izin_yok`.
 * Sınır denetimi yapmaz: her öğe `ekleriDenetle`'den geçer (galeriden gelen 5 dk'yı aşan video orada
 * `video_uzun` ile reddedilir). Söz hiç reddedilmez. `kalan < 1` ise seçici açılmaz, boş döner.
 */
export interface MedyaSeciciPortu {
  sec(kaynak: MedyaKaynagi, kalan: number): Promise<MedyaSecimSonucu>;
}

/**
 * Medya. `ekleriDenetle`'den geçmiş, şeritteki ek. Henüz kopyalanmadı, `medya_id`'si yok. `mime`
 * `MEDYA_MIME[tur]` içindedir; `sure_ms` yalnız videoda olabilir (fotoğrafta hep `null`).
 */
export interface SeciliEk {
  /** Seçicinin adresi; şeritte anahtar (aynı adres iki kez eklenmez) ve şeritteki küçük resim. */
  uri: string;
  tur: MedyaTuru;
  mime: MedyaMime;
  /** Seçilen dosyanın baytı (fotoğrafta özgün; hazırlama küçültür). */
  boyut: number;
  sure_ms: number | null;
  genislik: number | null;
  yukseklik: number | null;
}

/**
 * Medya. Seçimde ekin reddedilme nedeni (ekran metni U5a `medyaMetni.ts`). Kural sırası `EkleriDenetle`'de.
 * - `tur_desteklenmiyor`: `tur` ya da `mime` yok, `mime` `MEDYA_MIME[tur]`'da değil.
 * - `okunamadi`: `boyut` bilinmiyor ya da 1'den küçük.
 * - `zaten_ekli`: aynı `uri` şeritte (ya da bu çağrıda daha önce) var.
 * - `video_uzun`: `sure_ms > MEDYA_SINIRLARI.VIDEO_SURE_MS` (süre bilinmiyorsa geçer; PC ölçer).
 * - `cok_buyuk`: video `boyut > VIDEO_BAYT`. Fotoğrafın seçimde bayt denetimi yoktur (küçültülür;
 *   hazırlama sonrası `FOTO_BAYT`'ı aşarsa gönderim `ek_hazirlanamadi` alır).
 * - `ikinci_video`: şeritte zaten bir video var (mesaj başına en çok bir video).
 * - `adet_asildi`: şerit `EK_ADET`'e ulaştı.
 */
export type EkRedNedeni =
  | "tur_desteklenmiyor"
  | "okunamadi"
  | "zaten_ekli"
  | "video_uzun"
  | "cok_buyuk"
  | "ikinci_video"
  | "adet_asildi";

export interface EkRedi {
  uri: string;
  neden: EkRedNedeni;
}

/** `ekler`: `mevcut` aynen ve sırasıyla, ardından kabul edilen yeniler geliş sırasıyla. */
export interface EkDenetimi {
  ekler: readonly SeciliEk[];
  reddedilenler: readonly EkRedi[];
}

/**
 * Medya. Saf (U1 `cekirdek/medya.ts` `ekleriDenetle`; U3 `index.ts` yeniden dışa açar, ekran oradan
 * alır). `yeni` sırayla denenir, her öğede `EkRedNedeni`'ndeki sırayla ilk tutmayan kural reddeder;
 * kabul edilen öğe sonraki öğelerin `zaten_ekli`/`ikinci_video`/`adet_asildi` denetimine girer. Fotoğrafın
 * `sure_ms`'i `null` yapılır. Girdiyi değiştirmez, atmaz.
 */
export type EkleriDenetle = (mevcut: readonly SeciliEk[], yeni: readonly HamMedya[]) => EkDenetimi;

// ---------------------------------------------------------------------------------------------
// Dosya portu (çekirdek): hazırlama, parça okuma, silme. Gerçeği `platform/medyaDosya.ts` (U4,
// `expo-file-system`, `expo-image-manipulator`, `expo-video-thumbnails`), sahtesi `SahteMedyaDosya`.
// Adresler opaktır: çekirdek yalnız saklar ve porta geri verir, hiçbir zaman kurmaz ya da ayrıştırmaz.
// ---------------------------------------------------------------------------------------------

/** Medya. Uygulama klasörüne alınmış, yüklenmeye hazır ek. */
export interface HazirEk {
  /** Yüklenecek kopya: `Paths.document/eren-medya/<medya_id>.<uzantı>`. */
  uri: string;
  /** Kopyanın gerçek türü: küçültülen fotoğraf `image/jpeg`; video ve düşen küçültmede seçicinin `mime`'ı. */
  mime: MedyaMime;
  /** Kopyanın gerçek bayt sayısı (1..türün sınırı). */
  boyut: number;
  /** Fotoğrafta küçültme sonrası piksel; videoda seçicinin beyanı; bilinmiyorsa `null`. */
  genislik: number | null;
  yukseklik: number | null;
  /** Yalnız video: seçicinin beyanı; fotoğrafta `null`. */
  sure_ms: number | null;
  /**
   * Balondaki yerel görsel: fotoğrafta kopyanın kendisi (`uri` ile aynı), videoda kapak
   * (`expo-video-thumbnails`, `eren-medya/<medya_id>.kapak.jpg`). Kapak alınamadıysa `null` (hata değil).
   */
  onizleme_uri: string | null;
}

export type HazirlaSonucu =
  | { ok: true; ek: HazirEk }
  /** `okunamadi`: kaynak yok/okunamıyor. `cok_buyuk`: kopya türün bayt sınırını aşıyor. `hata`: yer yok, yazılamadı. */
  | { ok: false; neden: "okunamadi" | "cok_buyuk" | "hata" };

/**
 * Medya (U4 gerçekler; U1 ve U3 kullanır). Hiçbir yöntem kişisel içerik ya da adres günlüğe yazmaz.
 */
export interface MedyaDosyaPortu {
  /**
   * Seçilen eki uygulama klasörüne alır. Fotoğraf: uzun kenar `FOTO_UZUN_KENAR`'ı aşıyorsa küçültülür,
   * JPEG kalite 0,8 ile yeniden kodlanır (EXIF/GPS düşer, yön piksele işlenir); küçültücü düşerse özgün
   * dosya kopyalanır (`FOTO_BAYT` sınırıyla). Video: olduğu gibi kopyalanır, kapak alınmaya çalışılır.
   * Başarısızlıkta yarım dosya bırakmaz. Söz hiç reddedilmez.
   */
  hazirla(ek: SeciliEk, medya_id: MedyaId): Promise<HazirlaSonucu>;
  /** Dosyanın bayt sayısı; yoksa ya da okunamıyorsa `null`. Hiç reddetmez. */
  boyut(uri: string): Promise<number | null>;
  /**
   * `ofset`'ten en çok `uzunluk` bayt (dosya sonunda daha kısa, sonrasında boş dizi). Dosya yoksa ya da
   * okunamıyorsa reddeder. Çağıran `uzunluk`'u `PARCA_BAYT` ile sınırlar.
   */
  oku(uri: string, ofset: number, uzunluk: number): Promise<Uint8Array>;
  /** Siler; yoksa sessizce çözülür. Silinemezse reddeder. */
  sil(uri: string): Promise<void>;
  /** `eren-medya` altındaki bütün dosyaların adresleri (açılış süpürmesi: kaydı olmayan dosya silinir). */
  listele(): Promise<readonly string[]>;
}

/** Medya. Saf (U1 `cekirdek/base64.ts`): baytları standart base64'e (dolgulu, `+` `/`) çevirir. Hermes'te `Buffer` yok. */
export type Base64Kodla = (baytlar: Uint8Array) => string;

// ---------------------------------------------------------------------------------------------
// Yükleyici (U1 `cekirdek/medya.ts` `yukleyiciKur`). Platformsuz: dosyayı porttan, kaydı `DepoPortu`'ndan
// okur. Kalıcı anahtarlar: `medya_yuklemeleri` (bağlanmamış kayıtlar) ve `medya_onizlemeleri`
// (mesaja bağlanmış eklerin önizleme dizini). İkisi de yalnız kimlik, tür, boyut ve opak adres taşır.
// ---------------------------------------------------------------------------------------------

/** Medya. Yükleyicinin yolladığı çerçeveler (`client_msg_id` yok, `ack` yok, outbox'a girmez). */
export type MedyaYukari = MediaBegin | MediaChunk | MediaCancel;

/** Medya. `Yukleyici.ekle` girdisi: hazırlanmış bir ek ve kablo bilgisi. */
export interface YeniYukleme {
  sohbet_id: SohbetId;
  /** `user_message.ekler`'e giden bilginin aynısı; `media_begin` bunun alanlarıyla kurulur. */
  bilgi: EkBilgisi;
  /** `HazirEk.uri`. */
  uri: string;
  /** `HazirEk.onizleme_uri`. */
  onizleme_uri: string | null;
}

/**
 * Medya. Bir ekin ekrandaki durumu (yalnız canlı, kalıcı değil; yeniden açılışta kayıt `bekliyor`'dan
 * başlar).
 * - `bekliyor`: sırada, ya da bağlantı veya `medya1` bekleniyor.
 * - `yukleniyor`: `alinan` servisin son bildirdiği bayt, `boyut` toplam.
 * - `kabul`: servis doğruladı; `isleme` son `media_state.isleme` (henüz gelmediyse `null`).
 * - `reddedildi`: `kod` `media_state.code`.
 * - `yerel_yok`: yerel kopya okunamadı ("Ek telefonda bulunamadı").
 */
export type EkIlerlemesi =
  | { durum: "bekliyor" }
  | { durum: "yukleniyor"; alinan: number; boyut: number }
  | { durum: "kabul"; isleme: MedyaIslemeDurumu | null }
  | { durum: "reddedildi"; kod: HataKodu }
  | { durum: "yerel_yok" };

/** Medya. Balonun bir ek için gösterdiği. */
export interface EkGorunumu {
  /** `HazirEk.onizleme_uri`; yoksa `null` (video yer tutucusu ya da "bu cihazda yok"). */
  onizleme_uri: string | null;
  /** Yükleme ya da işleme durumu; bilinmiyorsa (mesaja bağlanmış, işleme bildirimi gelmemiş) `null`. */
  ilerleme: EkIlerlemesi | null;
}

/** Medya. `OutboxBagimliliklari.hazirlik` sonucu. */
export type MesajHazirligi = "hazir" | "bekliyor" | { hata: GidenHataKodu };

/**
 * Medya (U1). Kurallar:
 * - Kayıtlar `ekle` sırasıyla yüklenir; aynı anda tek ek; parça en çok `PARCA_BAYT` ham bayt
 *   (`Base64Kodla` ile), pencere 2 parça (yanıtsız üçüncü parça yollanmaz). Servis yalnız
 *   `ofset == alinan` parçayı yazar; yükleyici her zaman son `alinan`'dan sürer.
 * - `baglandi`'dan sonra `reddedildi`/`yerel_yok` olmayan bütün bağlanmamış kayıtlar (`kabul` dahil) için
 *   `media_begin` yollanır; servis güncel durumu döner (sildiyse `alinan: 0`, baştan yüklenir).
 * - Yerel kopya okunamazsa kayıt `yerel_yok` olur, bağlıysa `media_cancel` gider.
 * - Kalıcı yazım atomiktir (`DepoPortu.yaz`); bozuk kayıt yüklemede atılır, atmaz.
 * - Her ilerleme ya da durum değişikliğinde `degisti` çağrılır.
 */
export interface Yukleyici {
  /** Kalıcı kayıtları okur. Başka çağrıdan önce bir kez; okunamazsa reddeder. Kaydı olmayan dosyaları arkadan siler. */
  yukle(): Promise<void>;
  /**
   * Kayıtları tek yazımla diske ekler (hepsi ya da hiçbiri; yazılamazsa reddeder, bellek değişmez).
   * Bağlıysa yüklemeye hemen başlayabilir. Aynı `medya_id` ikinci kez eklenmez (yok sayılır).
   */
  ekle(kayitlar: readonly YeniYukleme[]): Promise<void>;
  /** Kimliği bitmiş, `medya1` desteklenen bağlantı. `gonder` yazamazsa `false` döner (yükleme durur, kopma beklenir). */
  baglandi(gonder: (m: MedyaYukari) => boolean): void;
  /** Bağlantı gitti ya da `medya1` desteklenmiyor: yükleme durur, yanıtsız parçalar unutulur. */
  koptu(): void;
  /** Aşağı `media_state`. Bilinmeyen `medya_id`'nin yalnız `isleme`'si bellekte tutulur (en çok 64). */
  durum(s: Extract<GelenCerceve, { type: "media_state" }>): void;
  /**
   * Mesajın eklerine göre outbox kararı (eşzamanlı): hepsi `kabul` ise `"hazir"`; biri `reddedildi` ise
   * `{hata: kod}`; biri `yerel_yok` ise `{hata: "ek_bulunamadi"}`; değilse `"bekliyor"`. Kaydı olmayan
   * (mesaja zaten bağlanmış ya da hiç bilinmeyen) kimlik `"hazir"` sayılır: son söz servisindir (`medya_yok`).
   */
  hazirlik(medya_idler: readonly MedyaId[]): MesajHazirligi;
  /**
   * Bu cihazın `user_echo`'su ekiyle görüldü (`seq` olayınki): kayıt kalkar, önizleme dizinine
   * `{sohbet_id, seq, onizleme_uri}` girer, `uri` önizleme değilse (video kopyası) silinir. Bilinmeyen kimlik yok sayılır.
   */
  mesajaBaglandi(medya_id: MedyaId, seq: number): Promise<void>;
  /** "Kaldır": kayıtlar ve yerel dosyaları silinir; bağlıysa her biri için `media_cancel`. Bilinmeyen kimlik yok sayılır. */
  iptal(medya_idler: readonly MedyaId[]): Promise<void>;
  /** Mezar taşı: o sohbetin `seq <= sinir_seq` önizlemeleri ve dosyaları silinir; bağlanmamış kayıtlar kalır. */
  sohbetiTemizle(sohbet_id: SohbetId, sinir_seq: number): Promise<void>;
  /** Sohbet silindi: o sohbetin bütün önizlemeleri silinir, bağlanmamış kayıtları `iptal` edilir. */
  sohbetSilindi(sohbet_id: SohbetId): Promise<void>;
  /** Yerel geçmiş sıfırlandı: bütün önizlemeler silinir; bağlanmamış kayıtlar kalır. */
  sifirla(): Promise<void>;
  /** Eşzamanlı; kayıt da önizleme de, canlı işleme bilgisi de yoksa `null`. */
  gorunum(medya_id: MedyaId): EkGorunumu | null;
  /** Bağlanmamış ve `reddedildi`/`yerel_yok` olmayan kayıt sayısı (`ek_siniri` denetimi). */
  bekleyenSayisi(): number;
  /** Sıradaki kalıcı yazımlar bitince çözülür. */
  bosalt(): Promise<void>;
}

export interface YukleyiciBagimliliklari {
  depo: DepoPortu;
  dosya: MedyaDosyaPortu;
  /** Herhangi bir ilerleme, durum ya da `hazirlik` değişikliği. */
  degisti(): void;
}

export type YukleyiciFabrikasi = (b: YukleyiciBagimliliklari) => Yukleyici;
