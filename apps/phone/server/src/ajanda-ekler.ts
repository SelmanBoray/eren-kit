/**
 * Ajanda ek yedeği (`ek_yedegi`; `docs/AJANDA.md` "Sürüm 3" > "Ek yedeği"; kullanıcı kararı: fotoğraflar
 * PC'de de yedeklenir). Telefonun kayıt eklerinin baytlarını PC'de içerik adresli saklar, geri verir,
 * süresi geçeni temizler. Çekirdek mantıktır: dosya sistemine yalnız `AjandaEkDiski` portundan dokunur
 * (gerçeği `dis-dunya.ts` `ajandaEkDiskiKur`; testte bellekte sahte disk). Çerçeveleri `gateway-ajanda.ts`
 * verir: yalnız v3 bağlantıda, kimlik sonrası, `esitlendi`'den sonra ve kesişimde `ek_yedegi` varken.
 *
 * Kurallar:
 * - Önce üstveri. `ek_yukle` yalnız silinmemiş `kayit_id` kaydının `ekler`'inde aynı `ek_id`, `ozet` ve
 *   `bayt` geçiyorsa kabul edilir (`ek_bilinmiyor`); dosya tamamlanırken aynı denetim yinelenir.
 * - Yükleme dur-bekle. Parça yalnız `ofset == alinan` ise yazılır, her parçaya `ek_durum` döner. `alinan`
 *   diskte onaylanmış (kalıcı) uzunluktur: port parçayı yazar, diske indirir, sonra onaylar; çökmeden sonra
 *   onaysız kuyruk kesilir. Son parçada uzunluk ve sha256 doğrulanır; tutmazsa yarım silinir
 *   (`ozet_uyusmuyor`). Doğrulanan yarım tek adımda son adına taşınır (atomik).
 * - İndirme de üstveriye bağlıdır: `ek_iste` yalnız istenen `ek_id` ve `ozet` silinmemiş bir kaydın `ekler`'inde
 *   aynı öğede geçiyor ve öğenin `bayt`'ı dosyanın boyuna eşitse karşılanır (yüklemenin kabul ölçütü).
 *   Öteki her durum (kayıt silinmiş, ek listeden çıkmış, `ek_id` başka özetle, hiç geçmiyor) `ek_yok`'tur ve
 *   diske, özetin sırasına dokunulmadan döner: yanıt (kod ve zamanlama) özetin diskte olup olmadığını
 *   söylemez. Denetim revizyonla tazelenen bellek dizinindendir (`basvuruDizini`), çağrı başına tarama yok.
 * - İndirme penceredir: `ek_iste` → en çok `EK_PENCERE` `ek_parca`, sonra `ek_durum{gonderilen}`. Bağlantının
 *   gönderim tamponunda `INDIRME_TAMPONU`'ndan fazla bayt bekliyorsa (okumayan istemci) pencere orada kesilir:
 *   hiç parça gitmediyse `ek_ret{ic_hata}` (geçici), gittiyse `ek_durum{gonderilen}` gidene kadarını söyler.
 * - Kota bellekte artımlı tutulur (açılışta ve her temizlik turunda bir tarama; `ek_yukle` diski taramaz).
 *   Her dosya en az `BLOK_BAYT`, yukarı yuvarlanmış sayılır; dosya sayısı `DOSYA_ADET`'le sınırlıdır. Kabul
 *   edilen yüklemenin bildirilen boyu yükleme bitene ya da unutulana dek ayrılır: eşzamanlı yüklemeler kotayı
 *   ve `YARIM_ADET`'i aşamaz. `AYRIM_SURE_MS` boyunca hiç parça yazılmayan yükleme, yer isteyen yeni bir
 *   yükleme geldiğinde unutulur (ayrımı düşer). Kota dolunca yalnız saklama süresi DOLMUŞ başvurusuz dosyalar
 *   (bir sonraki turu beklemeden) silinir; saklama penceresindeki geri alınabilir dosya yazılmamış bayt
 *   uğruna silinmez: yetmezse `kota_asildi`.
 * - Aynı özete her işlem tek sırada (`sirada`): iki bağlantı aynı yarıma birlikte yazamaz, temizlik o an
 *   okunan ya da az önce "tamam" denen dosyayı silemez. Silmeden hemen önce başvuru yeniden denetlenir
 *   (kayıtlar anlık görüntüden sonra değiştiyse yeniden okunur).
 * - Retler yalnız `ek_ret`, bağlantı kapanmaz. İşleyici hiç atmaz: beklenmeyen hata `ic_hata` (geçici).
 * - Saklama: bir özet silinmemiş bir kaydın `ekler`'inde geçtiği sürece tutulur. Başvurusuzluk periyodik
 *   taramayla izlenir (`temizle`): kayıtlarda geçmeyen dosya ilk görüldüğü an işaretlenir (portun kalıcı
 *   işaret kümesi). Silme için iki koşul birlikte gerekir: servisin işaretten beri ÇALIŞIRKEN gözlediği süre
 *   (`gozlenen_ms`: ardışık turlar arası ve son turdan nazik kapanışa, adım başına en çok
 *   `GOZLEM_ADIMI_MS`; tekdüze saatle ölçülür, duvar saati düzeltmesi hayali süre eklemez) ve duvar saatinde
 *   geçen süre en az `EK_SAKLAMA_GUN`. PC kapalıyken, uykudayken ya da saat sıçradığında geçen süre
 *   sayılmaz: telefonun çevrimdışı kuyruğundaki `geri_yukle`'nin PC açıldıktan sonra gelmesine yer kalır.
 *   Geleceğe düşen işaret anı şimdiye kırpılır. Yeniden başvurulursa işaret kalkar; turlar arasında yeniden başvurulup yine
 *   silinen kayıt da (mezar taşının revizyonu işaretinkinden büyük) süreyi baştan başlatır. Tarama kaydın
 *   değiştiği yoldan (araç, uygulama, geri yükleme) bağımsızdır, göç gerektirmez.
 * - Bozuk tam dosya kendini onarır: tam dosyanın sha256'sı süreç başına bir kez (yüklemede ya da indirmede)
 *   doğrulanır; adıyla tutmayan dosya silinir, sonraki yükleme yerine koyar.
 * - Temizlikte tek dosyanın silinememesi turu düşürmez: hata sayılır (`hatali`), dosya sonraki turda yeniden
 *   denenir.
 * - Günlüğe yalnız `ek_id`, bayt, sayı ve kod girer; içerik, özet ve yol hiç girmez (hata yalnız türüyle).
 * - Servis görseli açmaz, çözmez, küçültmez; `mime` okunmaz.
 */
import { AJANDA_SINIRLARI, AJANDA_SURUMU } from "@eren/protocol";
import type { AjandaAsagi, AjandaEkRetKodu, AjandaKaydi, AjandaSurumluYukari } from "@eren/protocol";
import type { Depo, Gunluk, GunlukAlanlari, IptalEt, SaatPortu, ZamanlayiciPortu } from "./sozlesme.ts";

const MODUL = "ajanda_ekler";

/** `welcome.yetenekler`'deki ad: servis bunu yalnız bu modül kuruluyken sunar (`ana`). */
export const AJANDA_EK_YETENEGI = "ek_yedegi";

/** Veri kökü altındaki klasör (`<veri kökü>\ajanda-ekler`). */
export const AJANDA_EK_KLASORU = "ajanda-ekler";

const GUN_MS = 24 * 60 * 60 * 1000;

/**
 * Servisin kendi sınırları (kablo sınırı değildir; kablonunkiler `AJANDA_SINIRLARI.EK_*`). Amaç: hatalı ya
 * da kötü niyetli bir istemci diski dolduramasın, belleği şişiremesin.
 */
export const AJANDA_EK_SINIRLARI = {
  /**
   * Bir kaydın eklerine (üstverideki `bayt` toplamı) ayrılan en çok bayt. Şemanın tavanı (`EK_ADET` ×
   * `EK_BAYT` = 32 MiB) burada açıkça denetlenir: şema genişlese de kayıt başına sınır kalır. Kayıt başına
   * ek sayısı şemadan (`EK_ADET`, `ek_id` tekil); kabul edilen her dosya üstveriyle eşleşmek zorunda.
   */
  KAYIT_BAYT: AJANDA_SINIRLARI.EK_ADET * AJANDA_SINIRLARI.EK_BAYT,
  /**
   * Aynı anda duran en çok yarım dosya (bütün bağlantılar; diskteki yarımlar ve kabul edilmiş ama henüz
   * yazılmamış yüklemeler). Üst sınır 32 × `EK_BAYT` = 128 MiB; yarımlar kotaya da sayılır. Dolduğunda yeni
   * yükleme `ic_hata` (geçici) alır, sürenler etkilenmez.
   */
  YARIM_ADET: 32,
  /**
   * Kotada bir dosyanın en küçük ve yuvarlama birimi (NTFS'in olağan küme boyu): 1 baytlık dosya da 4 KiB
   * sayılır. Çok sayıda küçük dosya kotayı gerçekte kapladığından az gösteremez.
   */
  BLOK_BAYT: 4096,
  /**
   * En çok ek dosyası (tam ve yarım, bütün kayıtlar). Aşılırsa yeni yükleme `kota_asildi`. Varsayılan kotada
   * (2 GiB) ortalama 42 KiB'lık dosyaya denk gelir; dizin taraması (açılış, saatlik temizlik) bununla sınırlı.
   */
  DOSYA_ADET: 50_000,
  /**
   * İndirmede bağlantının gönderim tamponunda (gönderilmiş ama sokete yazılamamış) bekleyebilecek en çok
   * bayt; denetim her parçadan önce, tampon en çok bu kadar + bir parça (~342 KiB) büyür. Bir tam pencere
   * (~1,4 MB) sığar: dur-bekle istemci hiç takılmaz. Kayıt telafisi bu sınırdan etkilenmez.
   */
  INDIRME_TAMPONU: 2 * 1024 * 1024,
  /** Dokunulmayan yarımın silindiği süre. */
  YARIM_SURE_MS: GUN_MS,
  /**
   * Bağlantı başına açık yükleme. Dur-bekle istemci bir tane tutar; aşılırsa en eski unutulur (yarımı
   * diskte kalır, `ek_yukle` ile kaldığı yerden sürer). Unutulan yüklemenin parçası `ic_hata` alır.
   */
  BAGLANTI_YUKLEME: 2,
  /**
   * Bağlantı başına işlenmeyi bekleyen ek çerçevesi (bellekte en çok bu kadar parça, ~342 KiB'lık). Dur-bekle
   * istemci 1'i aşmaz; aşan çerçeve işlenmeden `ic_hata` alır.
   */
  BAGLANTI_BEKLEYEN: 4,
  /** Periyodik temizliğin aralığı; saklama ve yarım süreleri bu kadar geç kalabilir (erken değil). */
  TEMIZLIK_ARALIGI_MS: 60 * 60 * 1000,
  /**
   * Hiçbir silinmemiş kayıtta geçmeyen dosyanın tutulduğu süre (işaretten): hem servisin gözlediği süre hem
   * duvar saati en az bu kadar olmalı.
   */
  SAKLAMA_MS: AJANDA_SINIRLARI.EK_SAKLAMA_GUN * GUN_MS,
  /**
   * İki tur arasında gözlenen süreye eklenebilecek en çok süre (iki temizlik aralığı: zamanlayıcının
   * gecikmesine pay). Turlar arası daha uzun boşluk (uyku, askıya alma, saat ileri sıçradı) yalnız bu kadar
   * sayılır; geri giden saat hiç saymaz. Süreç başındaki ilk tur 0 sayar (PC kapalı geçen süre girmez);
   * kapanış son turdan beri geçeni aynı sınırla ekler (kısa ömürlü süreçte de sayaç ilerler).
   */
  GOZLEM_ADIMI_MS: 2 * 60 * 60 * 1000,
  /**
   * Kabul edilmiş ama bu süre boyunca hiç parçası yazılmamış yükleme, yer isteyen (yarım sınırı ya da kota)
   * yeni bir yükleme geldiğinde unutulur: parça göndermeyen bağlantı ayrımı süresiz tutamaz. Dur-bekle
   * istemci parçalar arasında bu kadar beklemez; unutulan yükleme `ek_yukle` ile yarımdan sürer.
   */
  AYRIM_SURE_MS: 5 * 60 * 1000,
  /** Mezar taşı taramasında (`ajandaRevAraligi`) sayfa boyu. */
  REV_SAYFASI: 1000,
} as const;

/** Yol yalnız bundan kurulur: 64 küçük harf onaltılık (sha256). */
const OZET_DESENI = /^[0-9a-f]{64}$/;
export const ajandaEkOzetiMi = (s: unknown): s is string => typeof s === "string" && OZET_DESENI.test(s);

// ---------------------------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------------------------

export interface AjandaEkDosyasi {
  readonly ozet: string;
  readonly bayt: number;
}

export interface AjandaEkYarimi {
  readonly ozet: string;
  /** Diskteki uzunluk (onaylanmamış kuyruk dahil olabilir; kota için üst kestirim). */
  readonly bayt: number;
  /** Son yazımın anı (dosya sisteminin saati). */
  readonly degisme_ms: number;
}

/** Bir başvurusuz dosyanın işareti (`isaretleriOku`/`isaretleriYaz`). */
export interface AjandaEkIsareti {
  /** İlk görüldüğü an (duvar saati, ms). Çekirdek geleceğe düşeni okurken şimdiye kırpar. */
  readonly ilk_ms: number;
  /**
   * İşaretten beri servisin çalışırken gözlediği süre (ms; `GOZLEM_ADIMI_MS`). Kalıcıdır: yeniden açılışta
   * kaldığı yerden birikir. Dosyada yoksa 0 (saklama uzar, kısalmaz).
   */
  readonly gozlenen_ms: number;
  /**
   * İşaretlendiği turdaki baş revizyon (`ajandaBasRev`): ondan sonra yazılmış bir mezar taşı bu özeti
   * taşıyorsa dosya arada yeniden başvurulmuştur. Dosyada yoksa `null` (çekirdek işareti baştan başlatır).
   */
  readonly rev: number | null;
}

/**
 * Ek dosyalarının tek kapısı. Her yöntem `ozet`'i yeniden doğrular (64 onaltılık değilse atar, hiçbir
 * yola dokunmaz); yol yalnız özetten kurulur, istemci metni girmez. Bağ (junction, sembolik) izlenmez.
 * Gerçeği `dis-dunya.ts` `ajandaEkDiskiKur(<veri kökü>\ajanda-ekler)`.
 */
export interface AjandaEkDiski {
  /** Tamamlanmış dosyanın (`<ozet[0:2]>\<ozet>`) uzunluğu; yoksa `null`. */
  tamBoyutu(ozet: string): Promise<number | null>;
  /** `ofset`'ten en çok `azamiBayt`; sonundaysa boş. */
  tamOku(ozet: string, ofset: number, azamiBayt: number): Promise<Uint8Array>;
  /** Tamamlanmış dosyanın uzunluğu ve sha256'sı (küçük harf onaltılık); yoksa atar. */
  tamOzeti(ozet: string): Promise<{ bayt: number; ozet: string }>;
  /** Yoksa sessizce döner. */
  tamSil(ozet: string): Promise<void>;
  /**
   * Okunamayan önek dizini (izin, paylaşım ihlali) taramayı düşürmez: atlanır, `okunamadi` her biri için
   * hatayla bir kez çağrılır (o dizinin dosyaları listede yoktur: kota eksik sayılır).
   */
  tamListesi(okunamadi?: (e: unknown) => void): Promise<AjandaEkDosyasi[]>;
  /**
   * Yarımın (`yarim\<ozet>`) kalıcı olarak onaylanmış uzunluğu; yarım yoksa `null`. Onaylanmamış kuyruğu
   * (çökmede yarım kalan yazım) keser: dönen değer diskte doğru ve kalıcı bayttır.
   */
  yarimDurumu(ozet: string): Promise<number | null>;
  /**
   * `ofset` onaylı uzunluğa eşit olmalı (değilse atar, yazmaz). Parçayı yazar, diske indirir, SONRA yeni
   * uzunluğu onaylar; döner: yeni onaylı uzunluk. Yarım yoksa (`ofset` 0) oluşturur.
   */
  yarimaEkle(ozet: string, ofset: number, veri: Uint8Array): Promise<number>;
  /** Yarımın onaylı kısmının uzunluğu ve sha256'sı (küçük harf onaltılık). */
  yarimOzeti(ozet: string): Promise<{ bayt: number; ozet: string }>;
  /** Yarımı son adına tek adımda taşır (aynı birim); son ad zaten varsa yarımı siler. */
  yarimiTamamla(ozet: string): Promise<void>;
  /** Yarımı ve onayını siler; yoksa sessizce döner. */
  yarimSil(ozet: string): Promise<void>;
  yarimListesi(): Promise<AjandaEkYarimi[]>;
  /** Başvurusuzluk işaretleri: özet → işaret. Bozuk ya da yoksa boş (saklama uzar, kısalmaz). */
  isaretleriOku(): Promise<Map<string, AjandaEkIsareti>>;
  /** Bütün kümeyi atomik yazar. */
  isaretleriYaz(isaretler: ReadonlyMap<string, AjandaEkIsareti>): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Modül yüzü
// ---------------------------------------------------------------------------------------------

type EkYukle = Extract<AjandaSurumluYukari, { type: "ek_yukle" }>;
type EkParcaYukari = Extract<AjandaSurumluYukari, { type: "ek_parca" }>;
type EkIste = Extract<AjandaSurumluYukari, { type: "ek_iste" }>;

/** Gateway'in bu modüle verdiği çerçeveler (çözücüden geçmiş). */
export type AjandaEkCercevesi = EkYukle | EkParcaYukari | EkIste;
/** Bu modülün ürettiği aşağı çerçeveler (en yeni sürümde; gateway bağlantı sürümüne uyarlar). */
export type AjandaEkYaniti = Extract<AjandaAsagi, { type: "ek_durum" | "ek_parca" | "ek_ret" }>;

export interface AjandaEkOturumuGirdisi {
  /** Yanıt çerçevesi. Bağlantı kapandıysa çağıran yok sayar; atmamalı. */
  gonder(m: AjandaEkYaniti): void;
  /**
   * Bağlantının gönderim tamponunda bekleyen bayt (gerçeği `ws` `bufferedAmount`). Verilmezse 0 sayılır
   * (indirme tampon sınırı uygulanmaz); atarsa da 0.
   */
  bekleyenBayt?(): number;
}

/** Bağlantı başına durum: açık yüklemeler ve bekleyen çerçeve sayacı. */
export interface AjandaEkOturumu {
  /** Çerçeveyi sıraya alır; yanıtlar `gonder` ile, sonra. Hiç atmaz. */
  cerceve(m: AjandaEkCercevesi): void;
  /** Bağlantı kapandı: açık yüklemeler unutulur (yarımlar diskte kalır), yanıt gitmez. */
  kapat(): void;
}

export interface AjandaEkTemizlikSonucu {
  silinen: number;
  silinen_bayt: number;
  yarim_silinen: number;
  isaretlenen: number;
  tutulan: number;
  /** Silinemeyen dosya (tam ya da yarım); sonraki turda yeniden denenir. */
  hatali: number;
  /** Turun taramasında okunamayan önek dizini: o dizinin dosyaları sayılmadı (kota eksik sayıldı). */
  eksik_onek: number;
}

/** Bellekteki kullanım (gözlem ve test için; özet içermez). */
export interface AjandaEkOlcumu {
  /** İlk tarama yapıldı mı (yapılmadıysa sayılar 0). */
  hazir: boolean;
  /** Kotaya sayılan bayt: dosyalar (`BLOK_BAYT`'a yuvarlanmış) ve açık yüklemelerin ayrılan boyu. */
  kullanilan_bayt: number;
  /** Kotaya sayılan dosya (tam, yarım, ayrılmış yükleme). */
  dosya_adet: number;
  /** Açık yüklemesi olan özet. */
  ayrilan_adet: number;
  /** Son temizlik turundan beri dokunulan özet (temizlik koruması). */
  dokunulan_adet: number;
  kota_bayt: number;
  /** Son taramada okunamayan önek dizini; 0 değilse kullanım eksik sayılıyor (sonraki taramaya dek). */
  eksik_onek: number;
}

export interface AjandaEkleri {
  oturumAc(g: AjandaEkOturumuGirdisi): AjandaEkOturumu;
  olcum(): AjandaEkOlcumu;
  /** Bir temizlik turu (süren varsa onu bekler). Atar yalnız tarama okunamazsa; o zaman hiçbir şey silinmez. */
  temizle(): Promise<AjandaEkTemizlikSonucu>;
  /** Periyodik temizliği kurar ve ilk turu arkada başlatır. */
  baslat(): void;
  /** Süren bütün işler bitince çözülür. Atmaz. */
  bekle(): Promise<void>;
  /**
   * Yeni çerçeveyi `ic_hata` ile reddeder, periyodu keser, süren işleri bekler, son turdan beri gözlenen
   * süreyi işaretlere yazar (yazamazsa günlüğe yazar). Atmaz.
   */
  kapat(): Promise<void>;
}

export interface AjandaEkleriBagimliliklari {
  disk: AjandaEkDiski;
  /**
   * `ajandaBasRev`: silmeden önceki yeniden denetimde kayıtların değişip değişmediği (tek artan sayaç).
   * `ajandaRevAraligi` (gerçek depoda hep var): başvuru dizininin artımlı güncellenmesi ve işaretten sonra
   * yazılmış mezar taşları (turlar arası yeniden başvuru). Verilmezse dizin her değişiklikte baştan kurulur
   * ve turlar arası yeniden başvuru görülmez (yalnız eski, dar sahte depolar için).
   */
  depo: Pick<Depo, "ajandaKaydiGetir" | "ajandaKayitlari" | "ajandaBasRev"> & Partial<Pick<Depo, "ajandaRevAraligi">>;
  saat: SaatPortu;
  /**
   * Tekdüze saat (gerçeği `dis-dunya.ts` `tekduzeSaatKur`, `performance.now`): gözlenen süre yalnız bununla
   * ölçülür; duvar saati düzeltmesi (NTP, elle) adıma girmez. Verilmezse `saat` (eski çağıranlar ve testler).
   */
  tekduze?: SaatPortu;
  zamanlayici: Pick<ZamanlayiciPortu, "herAralik">;
  gunluk: Gunluk;
  /** Bütün eklere ayrılan alan (tam + yarım + ayrılan). Verilmezse `EK_TOPLAM_BAYT` (`ayar.ts` `ajanda_ek_kota_mb`). */
  kotaBayt?: number;
}

interface Yukleme {
  readonly ek_id: string;
  readonly kayit_id: string;
  readonly ozet: string;
  readonly bayt: number;
  /** Kabulün ya da diske yazılan son parçanın anı; `AYRIM_SURE_MS` ilerlemesizlikte ayrım düşebilir. */
  ilerleme_ms: number;
}

interface OturumDurumu {
  readonly gonder: (m: AjandaEkYaniti) => void;
  readonly bekleyenBayt: () => number;
  /**
   * Ekleme sırası en eskiden en yeniye (son dokunulan sona taşınır). Her girdinin boyu kotada ayrılmıştır:
   * girdi yalnız `yuklemeKaydet`/`yuklemeBirak` ile girer ve çıkar, ayrım onlarla birlikte.
   */
  readonly yuklemeler: Map<string, Yukleme>;
  bekleyen: number;
  kapali: boolean;
  /** Tampon sınırı bu dolulukta günlüğe yazıldı (sel günlüğü şişirmesin; boşalınca yeniden). */
  tamponUyarildi: boolean;
}

/**
 * Bellekteki kullanım. `tamlar` ve `yarimlar` diskin görüntüsüdür (tarama ve her değişiklikle güncel),
 * `ayrilan` açık yüklemelerin bildirdiği boy. Bir özetin maliyeti: tamı varsa onun alanı, yarımı ya da
 * ayrımı varsa ikisinden büyüğünün alanı. `bayt` ve `adet` bütün özetlerin toplamıdır, `degistir` korur.
 */
interface Kullanim {
  hazir: boolean;
  readonly tamlar: Map<string, number>;
  readonly yarimlar: Map<string, number>;
  readonly ayrilan: Map<string, { bayt: number; sahip: number }>;
  bayt: number;
  adet: number;
}

/** Kotaya sığmayan yüklemenin istediği ek alan. */
interface Eksik {
  readonly bayt: number;
  readonly adet: number;
}

/** Bakım işlerinin (temizlik turu, kota için yer açma) sıra anahtarı; özet olamaz (64 onaltılık değil). */
const BAKIM = "bakim";

const hataTuru = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

const toplam = (l: ReadonlyArray<{ bayt: number }>): number => l.reduce((a, f) => a + f.bayt, 0);

export const ajandaEkleriKur = (d: AjandaEkleriBagimliliklari): AjandaEkleri => {
  const { disk, depo, saat, gunluk } = d;
  const tekduze = d.tekduze ?? saat;
  const kota = d.kotaBayt ?? AJANDA_SINIRLARI.EK_TOPLAM_BAYT;
  const S = AJANDA_EK_SINIRLARI;

  let kapali = false;
  let periyot: IptalEt | null = null;
  const surenler = new Set<Promise<void>>();
  const siralar = new Map<string, Promise<void>>();
  /**
   * Bir ek çerçevesinin bu özete son dokunduğu an: temizlik tur başından sonra dokunulanı silmez. Yalnız
   * var olan dosyaya ya da kabul edilen yüklemeye dokunulur; her temizlik turunun sonunda (tur atsa da)
   * turdan önceki girdiler düşer: boyu dosya sayısıyla sınırlıdır.
   */
  const dokunulan = new Map<string, number>();
  let surenTemizlik: Promise<AjandaEkTemizlikSonucu> | null = null;
  const k: Kullanim = { hazir: false, tamlar: new Map(), yarimlar: new Map(), ayrilan: new Map(), bayt: 0, adet: 0 };
  /** Süren taramalar: tarama sürerken değişen özetler (bellekteki değer taramadan tazedir). */
  const taramalar = new Set<Set<string>>();
  let ilkTarama: Promise<unknown> | null = null;
  /**
   * Son başarılı temizlik turunun başı ya da son kapanış kaydı (tekdüze saat): gözlenen süre bundan sayılır.
   * Süreç başında yok.
   */
  let sonGozlem: number | null = null;
  /**
   * `sonGozlem`'den sonra baştan başlatılan işaretler (yer açmada ya da silme öncesi denetimde yeniden
   * başvuru, depo değişimi): özet → sıfırlandığı an (tekdüze). Sonraki adım bunlara yalnız o andan beri
   * geçeni ekler; adım yazılınca boşalır. Boyu işaret sayısıyla sınırlı.
   */
  const sifirlanan = new Map<string, number>();
  /** Son taramada okunamayan önek dizini (`olcum`, tur sonucu). */
  let eksikOnek = 0;
  let kapanis: Promise<void> | null = null;
  /** Mezar taşları bu revizyona kadar işaretlerle karşılaştırıldı (süreç başında yok: en eski işaretten). */
  let sonTaranRev: number | null = null;
  /** Bu süreçte sha256'sı adıyla tutan tam dosyalar (silinince düşer; boyu dosya sayısıyla sınırlı). */
  const dogrulanan = new Set<string>();
  /** Açık bağlantılar: ilerlemesiz yüklemelerin ayrımı yer isteyen yükleme gelince düşer. */
  const oturumlar = new Set<OturumDurumu>();

  // Günlük atsa bile işleyici düşmesin.
  const yaz = (seviye: "bilgi" | "uyari" | "hata", olay: string, alanlar?: GunlukAlanlari): void => {
    try {
      gunluk[seviye](MODUL, olay, alanlar);
    } catch {
      // günlük yazılamadı; yapılacak başka şey yok
    }
  };

  /** Arka işi izler (`bekle`/`kapat` bekler); iş hiç reddedilmez. */
  const izle = (f: () => Promise<void>): void => {
    const p = f().catch((e: unknown) => yaz("hata", "ek_arka_hatasi", { hata_turu: hataTuru(e) }));
    surenler.add(p);
    void p.then(() => surenler.delete(p));
  };

  /** Aynı anahtara işlemler gelme sırasıyla, biri bitmeden öteki başlamaz. Sıra hata yüzünden tıkanmaz. */
  const sirada = <T>(anahtar: string, f: () => Promise<T>): Promise<T> => {
    const onceki = siralar.get(anahtar) ?? Promise.resolve();
    const sonuc = onceki.then(f);
    const kuyruk = sonuc.then(
      () => undefined,
      () => undefined,
    );
    siralar.set(anahtar, kuyruk);
    void kuyruk.then(() => {
      if (siralar.get(anahtar) === kuyruk) siralar.delete(anahtar);
    });
    return sonuc;
  };

  const dokun = (ozet: string): void => {
    dokunulan.set(ozet, saat.simdiMs());
  };

  // ------------------------------------------------------------------------------------------
  // Kullanım (kota)
  // ------------------------------------------------------------------------------------------

  /** Dosyanın kotadaki alanı: en az bir blok, bloğa yukarı yuvarlanmış. */
  const alan = (bayt: number): number => Math.max(1, Math.ceil(bayt / S.BLOK_BAYT)) * S.BLOK_BAYT;

  /** Özetin maliyeti; `ekAyrim` verilirse o boyda bir ayrım daha varmış gibi (durum değişmez). */
  const maliyet = (ozet: string, ekAyrim?: number): Eksik => {
    let bayt = 0;
    let adet = 0;
    const tam = k.tamlar.get(ozet);
    if (tam !== undefined) {
      bayt += alan(tam);
      adet += 1;
    }
    const yarim = k.yarimlar.get(ozet);
    const ayrim = k.ayrilan.get(ozet)?.bayt;
    if (yarim !== undefined || ayrim !== undefined || ekAyrim !== undefined) {
      bayt += alan(Math.max(yarim ?? 0, ayrim ?? 0, ekAyrim ?? 0));
      adet += 1;
    }
    return { bayt, adet };
  };

  /** Bir özetin kullanımını değiştirir, toplamları korur. Süren taramaya özetin bellekte tazelendiğini bildirir. */
  const degistir = (ozet: string, f: () => void): void => {
    for (const t of taramalar) t.add(ozet);
    const once = maliyet(ozet);
    f();
    const sonra = maliyet(ozet);
    k.bayt += sonra.bayt - once.bayt;
    k.adet += sonra.adet - once.adet;
  };

  const tamYaz = (ozet: string, bayt: number | null): void =>
    degistir(ozet, () => (bayt === null ? k.tamlar.delete(ozet) : k.tamlar.set(ozet, bayt)));
  const yarimYaz = (ozet: string, bayt: number | null): void =>
    degistir(ozet, () => (bayt === null ? k.yarimlar.delete(ozet) : k.yarimlar.set(ozet, bayt)));

  const toplamlariKur = (): void => {
    k.bayt = 0;
    k.adet = 0;
    for (const ozet of new Set([...k.tamlar.keys(), ...k.yarimlar.keys(), ...k.ayrilan.keys()])) {
      const m = maliyet(ozet);
      k.bayt += m.bayt;
      k.adet += m.adet;
    }
  };

  /** Yarımı ya da ayrımı olan özet sayısı (`ozet` hariç). */
  const yarimAdedi = (haric: string): number => {
    let n = 0;
    for (const ozet of k.yarimlar.keys()) if (ozet !== haric) n += 1;
    for (const ozet of k.ayrilan.keys()) if (ozet !== haric && !k.yarimlar.has(ozet)) n += 1;
    return n;
  };

  /**
   * Diski bir kez tarar, kullanımı ondan kurar. Tarama sürerken değişen özetlerde bellekteki değer kalır
   * (tarama onları eski görmüş olabilir). Atarsa kullanım değişmez.
   */
  const tara = async (): Promise<{ tamlar: AjandaEkDosyasi[]; yarimlar: AjandaEkYarimi[] }> => {
    const degisen = new Set<string>();
    taramalar.add(degisen);
    try {
      const yarimlar = await disk.yarimListesi();
      let okunamayan = 0;
      let ilkHata: unknown = null;
      const tamlar = await disk.tamListesi((e) => {
        if (okunamayan === 0) ilkHata = e;
        okunamayan += 1;
      });
      eksikOnek = okunamayan;
      // Yalnız sayı ve hata türü (önek özetin parçasıdır, yazılmaz). Sonraki taramaya dek kota bu dizinin
      // dosyaları kadar eksik sayılır.
      if (okunamayan > 0) yaz("uyari", "ek_onek_okunamadi", { adet: okunamayan, hata_turu: hataTuru(ilkHata) });
      const tazeTam = new Map(tamlar.map((f) => [f.ozet, f.bayt]));
      const tazeYarim = new Map(yarimlar.map((y) => [y.ozet, y.bayt]));
      if (k.hazir) {
        for (const ozet of degisen) {
          const t = k.tamlar.get(ozet);
          const y = k.yarimlar.get(ozet);
          if (t === undefined) tazeTam.delete(ozet);
          else tazeTam.set(ozet, t);
          if (y === undefined) tazeYarim.delete(ozet);
          else tazeYarim.set(ozet, y);
        }
      }
      k.tamlar.clear();
      for (const [o, b] of tazeTam) k.tamlar.set(o, b);
      k.yarimlar.clear();
      for (const [o, b] of tazeYarim) k.yarimlar.set(o, b);
      toplamlariKur();
      k.hazir = true;
      return { tamlar, yarimlar };
    } finally {
      taramalar.delete(degisen);
    }
  };

  /** İlk taramayı bekler (açılış turu henüz bitmediyse yükleme kendi başlatır). */
  const kullanimiHazirla = async (): Promise<void> => {
    if (k.hazir) return;
    ilkTarama ??= tara().finally(() => {
      ilkTarama = null;
    });
    await ilkTarama;
  };

  const ayir = (y: Yukleme): void =>
    degistir(y.ozet, () => {
      const a = k.ayrilan.get(y.ozet);
      if (a === undefined) k.ayrilan.set(y.ozet, { bayt: y.bayt, sahip: 1 });
      else {
        a.sahip += 1;
        a.bayt = Math.max(a.bayt, y.bayt);
      }
    });

  const ayrimiBirak = (y: Yukleme): void =>
    degistir(y.ozet, () => {
      const a = k.ayrilan.get(y.ozet);
      if (a === undefined) return;
      a.sahip -= 1;
      if (a.sahip <= 0) k.ayrilan.delete(y.ozet);
    });

  /** Dizin anahtarı: `ek_id` ve `ozet` birlikte (`ek_id` şemada denetimli; ayraç ikisinde de geçemez). */
  const ekAnahtari = (ek_id: string, ozet: string): string => `${ek_id}
${ozet}`;

  /** Anahtar → `bayt` → kaç öğe (artımlı güncellemede çıkarılabilsin diye sayılı). */
  type Sayim = Map<string, Map<number, number>>;

  interface BasvuruDizini {
    /** Silinmemiş kayıtların eklerindeki özetler → o öğelerin `bayt`'ları (saklama; tamamlamada başka kayıt). */
    readonly ozetler: Sayim;
    /** `ekAnahtari(ek_id, ozet)` → o öğelerin `bayt`'ları (indirme). */
    readonly ekler: Sayim;
    /** Silinmemiş her kaydın dizine kattığı ekler: kayıt değişince eskisi çıkarılır. */
    readonly katki: Map<string, ReadonlyArray<{ readonly ek_id: string; readonly ozet: string; readonly bayt: number }>>;
  }

  const say = (m: Sayim, anahtar: string, bayt: number, fark: 1 | -1): void => {
    let b = m.get(anahtar);
    if (b === undefined) {
      if (fark < 0) return;
      b = new Map();
      m.set(anahtar, b);
    }
    const n = (b.get(bayt) ?? 0) + fark;
    if (n > 0) b.set(bayt, n);
    else b.delete(bayt);
    if (b.size === 0) m.delete(anahtar);
  };

  /** Kaydın son halini dizine yansıtır: önceki katkısı çıkar, silinmemişse yenisi girer. */
  const kaydiYansit = (d: BasvuruDizini, kayit: AjandaKaydi): void => {
    for (const e of d.katki.get(kayit.kayit_id) ?? []) {
      say(d.ozetler, e.ozet, e.bayt, -1);
      say(d.ekler, ekAnahtari(e.ek_id, e.ozet), e.bayt, -1);
    }
    d.katki.delete(kayit.kayit_id);
    const ekler = kayit.silindi ? [] : (kayit.ekler ?? []);
    if (ekler.length === 0) return;
    const katki = ekler.map((e) => ({ ek_id: e.ek_id, ozet: e.ozet, bayt: e.bayt }));
    for (const e of katki) {
      say(d.ozetler, e.ozet, e.bayt, 1);
      say(d.ekler, ekAnahtari(e.ek_id, e.ozet), e.bayt, 1);
    }
    d.katki.set(kayit.kayit_id, katki);
  };

  /** Silinmemiş kayıtların eklerinden dizin kurar. Eşzamanlı okuma; atarsa çağıran hiçbir şey silmeden düşer. */
  const dizinKur = (): BasvuruDizini => {
    const d: BasvuruDizini = { ozetler: new Map(), ekler: new Map(), katki: new Map() };
    for (const kayit of depo.ajandaKayitlari()) kaydiYansit(d, kayit);
    return d;
  };

  /**
   * Başvuru dizini (modül başına tek). İlk kullanımda bütün kayıtlardan kurulur; sonra kayıtlar değiştikçe
   * (`ajandaBasRev`, tek artan sayaç; her değişiklik kaydın `revizyon`'unu ona taşır) yalnız arada değişen
   * kayıtlar (`ajandaRevAraligi`) yansıtılır: kayıt yazımıyla `ek_iste`'yi dönüşümlü gönderen istemci 50 000
   * kaydın yeniden okunmasını tetikleyemez. Sayaç geri gittiyse (depo yedekten döndü) baştan kurulur.
   * Sorgu O(1). Temizlik (silmeden hemen önce) ve indirme (her `ek_iste`) bunu okur: anlık görüntüden sonra
   * yeniden başvurulan dosya silinmez, silinen kaydın eki indirilmez. Okuma eşzamanlıdır; denetimle işlem
   * arasında iş girmez. Güncelleme yarıda atarsa dizin düşer, sonraki çağrı baştan kurar.
   */
  let dizin: { rev: number; d: BasvuruDizini } | null = null;
  const basvuruDizini = (): BasvuruDizini => {
    const rev = depo.ajandaBasRev();
    if (dizin !== null && dizin.rev === rev) return dizin.d;
    const aralik = depo.ajandaRevAraligi?.bind(depo);
    if (dizin === null || rev < dizin.rev || aralik === undefined) {
      dizin = null;
      dizin = { rev, d: dizinKur() };
      return dizin.d;
    }
    const g = dizin;
    dizin = null;
    let sonRev = g.rev;
    while (sonRev < rev) {
      const sayfa = aralik({ sonRev, ustRev: rev, adet: S.REV_SAYFASI });
      for (const kayit of sayfa) kaydiYansit(g.d, kayit);
      const son = sayfa.at(-1);
      if (sayfa.length < S.REV_SAYFASI || son === undefined) break;
      sonRev = son.revizyon;
    }
    dizin = { rev, d: g.d };
    return g.d;
  };

  /** Saklama denetleyicisi: özet silinmemiş bir kaydın eklerinde geçiyor mu (her çağrıda revizyon denetimi). */
  const basvuruDenetleyicisi = (): ((ozet: string) => boolean) => (ozet) => basvuruDizini().ozetler.has(ozet);

  /**
   * İndirme denetimi: `ek_id` ve `ozet` silinmemiş bir kaydın eklerinde aynı öğede geçiyor mu; `bayt`
   * verilirse öğenin boyu da tutmalı (yüklemenin `ek_id`, `ozet`, `bayt` ölçütü).
   */
  const indirilebilir = (ek_id: string, ozet: string, bayt?: number): boolean => {
    const b = basvuruDizini().ekler.get(ekAnahtari(ek_id, ozet));
    return b !== undefined && (bayt === undefined || b.has(bayt));
  };

  /** Herhangi bir silinmemiş kayıt bu özeti bu boyla taşıyor mu (`ek_id`'den bağımsız). */
  const ozetBaytiBasvuruda = (ozet: string, bayt: number): boolean => basvuruDizini().ozetler.get(ozet)?.has(bayt) === true;

  // ------------------------------------------------------------------------------------------
  // İşaretler (saklama)
  // ------------------------------------------------------------------------------------------

  /** İşaret baştan başlar; sıfırlandığı an sonraki gözlem adımı için tutulur (`sifirlanan`). */
  const sifirla = (isaretler: Map<string, AjandaEkIsareti>, ozet: string, yeni: AjandaEkIsareti): void => {
    isaretler.set(ozet, yeni);
    sifirlanan.set(ozet, tekduze.simdiMs());
  };

  /** Saklama süresi doldu mu: hem gözlenen süre hem duvar saati (`ilk_ms` tazelemede kırpılmıştır). */
  const suresiDoldu = (i: AjandaEkIsareti, simdi: number): boolean =>
    i.gozlenen_ms >= S.SAKLAMA_MS && simdi - i.ilk_ms >= S.SAKLAMA_MS;

  /**
   * Okunan işaretleri tutarlı kılar (yerinde). `taranmis`: mezar taşları bu revizyona kadar bu işaretlerle
   * zaten karşılaştırıldı (yoksa en eski işaretten taranır). Döner: değişti mi ve hangi revizyona kadar
   * tarandığı (çağıran işaretleri yazdıktan sonra `sonTaranRev`'e koyar). Eşzamanlıdır; depo atarsa çağıran
   * hiçbir şey silmez.
   * - `ilk_ms` gelecekteyse şimdiye kırpılır (saat ileride işaretlemişti, sonra düzeldi).
   * - `rev`'i yoksa ya da baş revizyondan büyükse (depo yedekten döndü) işaret baştan başlar.
   * - İşaretten sonra yazılmış bir mezar taşı bu özeti taşıyorsa dosya turlar arasında yeniden başvurulmuştur
   *   (geri yükleme ya da ekleme, sonra yeniden silme): işaret baştan başlar. Mezar taşı yalnız `geri_yukle`
   *   ile değişir; revizyonu işaretinkinden büyükse arada canlıydı.
   */
  const isaretleriTazele = (
    isaretler: Map<string, AjandaEkIsareti>,
    simdi: number,
    taranmis: number | null,
  ): { degisti: boolean; taranan: number } => {
    const basRev = depo.ajandaBasRev();
    const yeni: AjandaEkIsareti = { ilk_ms: simdi, gozlenen_ms: 0, rev: basRev };
    let degisti = false;
    let enEski = Infinity;
    for (const [ozet, i] of isaretler) {
      if (i.rev === null || i.rev > basRev) {
        sifirla(isaretler, ozet, yeni);
        degisti = true;
        continue;
      }
      if (i.ilk_ms > simdi) {
        isaretler.set(ozet, { ...i, ilk_ms: simdi });
        degisti = true;
      }
      enEski = Math.min(enEski, i.rev);
    }
    if (enEski === Infinity) return { degisti, taranan: basRev };
    // Daha önce taranan aralık yeniden taranmaz: ondan önceki işaretler oraya kadar karşılaştırıldı.
    const sonRev = taranmis !== null && taranmis <= basRev ? Math.max(enEski, taranmis) : enEski;
    if (mezarTaslariniTara(isaretler, sonRev, basRev, yeni)) degisti = true;
    return { degisti, taranan: basRev };
  };

  /**
   * `(sonRev, basRev]` aralığında yazılmış mezar taşları: taşıdıkları özetin işareti mezar taşından eskiyse
   * işaret `yeni` olur (turlar arası yeniden başvuru). Yalnız aralığı okur, işaretleri dolaşmaz. Döner:
   * değişti mi. `ajandaRevAraligi` yoksa bir şey yapmaz.
   */
  const mezarTaslariniTara = (
    isaretler: Map<string, AjandaEkIsareti>,
    baslangic: number,
    basRev: number,
    yeni: AjandaEkIsareti,
  ): boolean => {
    const aralik = depo.ajandaRevAraligi?.bind(depo);
    if (aralik === undefined) return false;
    let degisti = false;
    let sonRev = baslangic;
    while (sonRev < basRev) {
      const sayfa = aralik({ sonRev, ustRev: basRev, adet: S.REV_SAYFASI });
      for (const kayit of sayfa) {
        if (!kayit.silindi) continue;
        for (const e of kayit.ekler ?? []) {
          const i = isaretler.get(e.ozet);
          if (i === undefined || i.rev === null || kayit.revizyon <= i.rev) continue;
          sifirla(isaretler, e.ozet, yeni);
          degisti = true;
        }
      }
      const son = sayfa.at(-1);
      if (sayfa.length < S.REV_SAYFASI || son === undefined) break;
      sonRev = son.revizyon;
    }
    return degisti;
  };

  // ------------------------------------------------------------------------------------------
  // Yanıtlar
  // ------------------------------------------------------------------------------------------

  const yolla = (o: OturumDurumu, m: AjandaEkYaniti): void => {
    if (o.kapali) return;
    try {
      o.gonder(m);
    } catch (e) {
      yaz("hata", "ek_gonderim_hatasi", { hata_turu: hataTuru(e) });
    }
  };

  const ret = (o: OturumDurumu, ek_id: string, code: AjandaEkRetKodu): void => {
    yaz(code === "ic_hata" ? "hata" : "uyari", "ek_ret", { ek_id, code });
    yolla(o, { v: AJANDA_SURUMU, type: "ek_ret", ek_id, code });
  };

  const alindi = (o: OturumDurumu, ek_id: string, alinan: number, tamam: boolean): void => {
    yolla(o, { v: AJANDA_SURUMU, type: "ek_durum", ek_id, alinan, tamam });
  };

  // ------------------------------------------------------------------------------------------
  // Üstveri ve yükleme
  // ------------------------------------------------------------------------------------------

  /** Kayıt bu eki aynı üstveriyle taşıyor mu ve kayıt başına sınır içinde mi; tutmazsa ret kodu. */
  const ustveriDenetle = (y: Yukleme): AjandaEkRetKodu | null => {
    const kayit = depo.ajandaKaydiGetir(y.kayit_id);
    if (kayit === null || kayit.silindi) return "ek_bilinmiyor";
    const ekler = kayit.ekler ?? [];
    const ek = ekler.find((e) => e.ek_id === y.ek_id);
    if (ek === undefined || ek.ozet !== y.ozet || ek.bayt !== y.bayt) return "ek_bilinmiyor";
    if (y.bayt > AJANDA_SINIRLARI.EK_BAYT || ekler.length > AJANDA_SINIRLARI.EK_ADET || toplam(ekler) > S.KAYIT_BAYT) {
      return "ek_cok_buyuk";
    }
    return null;
  };

  /** Bağlantının açık yüklemesini bırakır (ayrımıyla); yoksa bir şey yapmaz. */
  const yuklemeBirak = (o: OturumDurumu, ek_id: string): void => {
    const y = o.yuklemeler.get(ek_id);
    if (y === undefined) return;
    o.yuklemeler.delete(ek_id);
    ayrimiBirak(y);
  };

  const yuklemeleriBirak = (o: OturumDurumu): void => {
    for (const ek_id of [...o.yuklemeler.keys()]) yuklemeBirak(o, ek_id);
  };

  /** Bağlantının açık yüklemesi (boyu ayrılır); en eskisi sınırda unutulur. Aynı `ek_id`'nin eskisi yerini bırakır. */
  const yuklemeKaydet = (o: OturumDurumu, y: Yukleme): void => {
    // Bağlantı, `ek_yukle` diskte beklerken kapandıysa `kapat` ayrımları çoktan bıraktı: yeni ayrım
    // kimsenin bırakmayacağı bir sızıntı olurdu.
    if (o.kapali) return;
    // Yinelenen `ek_yukle` ilerleme sayılmaz: parçasız tutulan ayrım böyle tazelenemez.
    const eski = o.yuklemeler.get(y.ek_id);
    if (eski !== undefined && eski.ozet === y.ozet) y.ilerleme_ms = Math.min(y.ilerleme_ms, eski.ilerleme_ms);
    yuklemeBirak(o, y.ek_id);
    o.yuklemeler.set(y.ek_id, y);
    ayir(y);
    while (o.yuklemeler.size > S.BAGLANTI_YUKLEME) {
      const en_eski = o.yuklemeler.keys().next().value;
      if (en_eski === undefined) break;
      yuklemeBirak(o, en_eski);
    }
  };

  /** Dokunulan yükleme sona taşınır (ayrım değişmez). */
  const yuklemeTazele = (o: OturumDurumu, y: Yukleme): void => {
    o.yuklemeler.delete(y.ek_id);
    o.yuklemeler.set(y.ek_id, y);
  };

  /**
   * İlerlemesiz yüklemeleri unutur (bütün bağlantılar): `AYRIM_SURE_MS` boyunca parçası yazılmamış yüklemenin
   * ayrımı düşer, yarımı diskte kalır. Her yükleme denemesi (yarım sınırı ve kota denetiminden önce) çağırır;
   * unutulan yüklemenin sonraki parçası `ic_hata` alır, istemci `ek_yukle` ile yarımdan sürer.
   */
  const bayatAyrimlariBirak = (simdi: number): void => {
    let adet = 0;
    for (const o of oturumlar) {
      for (const y of [...o.yuklemeler.values()]) {
        if (simdi - y.ilerleme_ms < S.AYRIM_SURE_MS) continue;
        yuklemeBirak(o, y.ek_id);
        adet += 1;
      }
    }
    if (adet > 0) yaz("uyari", "ek_ayrim_dustu", { adet });
  };

  const yarimiSil = async (ozet: string): Promise<void> => {
    await disk.yarimSil(ozet);
    yarimYaz(ozet, null);
  };

  const tamiSil = async (ozet: string): Promise<void> => {
    await disk.tamSil(ozet);
    tamYaz(ozet, null);
    dogrulanan.delete(ozet);
  };

  /**
   * Tam dosyanın içeriği adıyla (sha256) tutuyor mu; süreç başına bir kez hesaplanır. Tutmuyorsa dosya
   * bozuktur (içerik adresli adın baytı olamaz) ve silinir: sonraki yükleme yerine koyar. Sırada çağrılır.
   */
  const tamSaglam = async (ozet: string): Promise<boolean> => {
    if (dogrulanan.has(ozet)) return true;
    const h = await disk.tamOzeti(ozet);
    if (h.ozet === ozet) {
      dogrulanan.add(ozet);
      return true;
    }
    await tamiSil(ozet);
    yaz("uyari", "ek_bozuk_dosya", { bayt: h.bayt });
    return false;
  };

  /** Sırada çağrılır: yarımın tam boyda olduğu bilinir. Doğrular, taşır, yanıtlar. */
  const tamamla = async (o: OturumDurumu, y: Yukleme): Promise<void> => {
    yuklemeBirak(o, y.ek_id);
    const h = await disk.yarimOzeti(y.ozet);
    if (h.bayt !== y.bayt || h.ozet !== y.ozet) {
      await yarimiSil(y.ozet);
      return ret(o, y.ek_id, "ozet_uyusmuyor");
    }
    // Yükleme sürerken ek kayıttan çıkmış ya da kayıt silinmiş olabilir: gelişigüzel dosya kalmasın. Aynı
    // görseli (özet ve boy) başka bir silinmemiş kayıt taşıyorsa doğrulanmış baytlar o kayıt için saklanır.
    const red = ustveriDenetle(y);
    if (red !== null && !(red === "ek_bilinmiyor" && ozetBaytiBasvuruda(y.ozet, y.bayt))) {
      await yarimiSil(y.ozet);
      return ret(o, y.ek_id, red);
    }
    await disk.yarimiTamamla(y.ozet);
    degistir(y.ozet, () => {
      k.yarimlar.delete(y.ozet);
      k.tamlar.set(y.ozet, y.bayt);
    });
    dogrulanan.add(y.ozet);
    yaz("bilgi", "ek_saklandi", { ek_id: y.ek_id, bayt: y.bayt });
    alindi(o, y.ek_id, y.bayt, true);
  };

  /**
   * Sırada bir yükleme denemesi. Yanıtladıysa `null`; kota (bayt ya da dosya sayısı) yetmediyse yanıtlamadan
   * eksik alanı döner (çağıran yer açıp bir kez yeniden dener). Kota denetimi ile ayırma arasında bekleme
   * yoktur: eşzamanlı yüklemeler birbirinin ayrımını görür.
   */
  const yukleDene = async (o: OturumDurumu, y: Yukleme): Promise<Eksik | null> => {
    const tam = await disk.tamBoyutu(y.ozet);
    if (tam !== null) {
      dokun(y.ozet);
      // İçerik adresli: aynı görsel başka kayıttan zaten gelmiş, yükleme yapılmaz. Dosya bozuksa (adıyla
      // tutmuyor) silindi: aşağıda baştan yüklenir.
      if (await tamSaglam(y.ozet)) {
        yuklemeBirak(o, y.ek_id);
        if (tam !== y.bayt) ret(o, y.ek_id, "ozet_uyusmuyor");
        else alindi(o, y.ek_id, y.bayt, true);
        return null;
      }
    }
    let alinan = await disk.yarimDurumu(y.ozet);
    if (alinan !== null && alinan > y.bayt) {
      // Bildirilenden uzun yarım bu ekin olamaz (özet aynıysa boy da aynıdır): baştan.
      await disk.yarimSil(y.ozet);
      alinan = null;
    }
    // Disk onaysız kuyruğu kesmiş olabilir: bellekteki boy diskle eşitlenir.
    yarimYaz(y.ozet, alinan);
    // Parça göndermeyen bağlantılar yeri süresiz tutmasın (yarım sınırı ve kota bundan sonra sayılır).
    bayatAyrimlariBirak(saat.simdiMs());
    const acik = alinan !== null || k.ayrilan.has(y.ozet);
    if (!acik) {
      const adet = yarimAdedi(y.ozet);
      if (adet >= S.YARIM_ADET) {
        yaz("uyari", "ek_yarim_siniri", { ek_id: y.ek_id, adet });
        ret(o, y.ek_id, "ic_hata");
        return null;
      }
    }
    // Kota: bu ekin bildirilen boyu ayrılırsa toplam ne olur (ayrım varsa ya da yarım tam boydaysa artış 0).
    const once = maliyet(y.ozet);
    const sonra = maliyet(y.ozet, y.bayt);
    const eksik: Eksik = { bayt: sonra.bayt - once.bayt, adet: sonra.adet - once.adet };
    if (k.bayt + eksik.bayt > kota || k.adet + eksik.adet > S.DOSYA_ADET) return eksik;
    yuklemeKaydet(o, y);
    dokun(y.ozet);
    // Çökmeden önce son parçası onaylanmış ama doğrulanmamış yarım: şimdi tamamlanır.
    if (alinan === y.bayt) await tamamla(o, y);
    else alindi(o, y.ek_id, alinan ?? 0, false);
    return null;
  };

  const yukleAl = async (o: OturumDurumu, m: EkYukle): Promise<void> => {
    const y: Yukleme = { ek_id: m.ek_id, kayit_id: m.kayit_id, ozet: m.ozet, bayt: m.bayt, ilerleme_ms: saat.simdiMs() };
    // Savunma: şema zaten denetler; özet olmayan değer hiçbir yola, porta ulaşmaz.
    if (!ajandaEkOzetiMi(y.ozet)) return ret(o, y.ek_id, "ek_bilinmiyor");
    const red = ustveriDenetle(y);
    if (red !== null) return ret(o, y.ek_id, red);
    await kullanimiHazirla();
    const eksik = await sirada(y.ozet, () => yukleDene(o, y));
    if (eksik === null) return;
    // Kota dolu: önce başvurusuz işaretli en eski dosyalar silinir, sonra bir kez daha denenir.
    const silinen = await sirada(BAKIM, () => yerAc(eksik));
    if (silinen > 0 && (await sirada(y.ozet, () => yukleDene(o, y))) === null) return;
    ret(o, y.ek_id, "kota_asildi");
  };

  const parcaAl = async (o: OturumDurumu, m: EkParcaYukari): Promise<void> => {
    const y = o.yuklemeler.get(m.ek_id);
    // `ek_yukle` yok (ya da unutuldu): istemci `ek_yukle` ile yeniden başlar.
    if (y === undefined) return ret(o, m.ek_id, "ic_hata");
    yuklemeTazele(o, y);
    const veri = Buffer.from(m.veri, "base64");
    await sirada(y.ozet, async () => {
      // Sırada beklerken yükleme unutulmuş (ayrımı düşmüş) olabilir: ayrımsız yazılmaz. Bağlantı kapandıysa
      // ayrım bu parça bitene dek tutulur (`kapat`).
      if (o.yuklemeler.get(y.ek_id) !== y) return ret(o, y.ek_id, "ic_hata");
      dokun(y.ozet);
      const tam = await disk.tamBoyutu(y.ozet);
      if (tam !== null && (await tamSaglam(y.ozet))) {
        yuklemeBirak(o, y.ek_id);
        if (tam !== y.bayt) return ret(o, y.ek_id, "ozet_uyusmuyor");
        return alindi(o, y.ek_id, y.bayt, true);
      }
      const durum = await disk.yarimDurumu(y.ozet);
      yarimYaz(y.ozet, durum);
      const alinan = durum ?? 0;
      // Yanlış ofset: yazılmaz, istemci `alinan`'dan sürer.
      if (m.ofset !== alinan) return alindi(o, y.ek_id, alinan, false);
      if (alinan + veri.length > y.bayt) {
        yuklemeBirak(o, y.ek_id);
        await yarimiSil(y.ozet);
        return ret(o, y.ek_id, "ozet_uyusmuyor");
      }
      const yeni = await disk.yarimaEkle(y.ozet, alinan, veri);
      // Yazım bitince de dokunulur: tur, yazım sürerken (eski değişme anıyla) listelemiş olabilir; yarımın
      // silinmesi bu parçanın arkasında sıradadır ve az önce yazılan ilerlemeyi silmemeli.
      dokun(y.ozet);
      yarimYaz(y.ozet, yeni);
      if (yeni > alinan) y.ilerleme_ms = saat.simdiMs();
      if (yeni < y.bayt) return alindi(o, y.ek_id, yeni, false);
      return tamamla(o, y);
    });
  };

  // ------------------------------------------------------------------------------------------
  // İndirme
  // ------------------------------------------------------------------------------------------

  /**
   * Gönderim tamponu dolu mu. Okumayan istemcinin her `ek_iste`'si ~1,4 MB'yi belleğe yığamasın: dolulukta
   * yeni parça gitmez. Uyarı her dolulukta bir kez yazılır.
   */
  const tamponDolu = (o: OturumDurumu, ek_id: string): boolean => {
    let bekleyen: number;
    try {
      bekleyen = o.bekleyenBayt();
    } catch {
      bekleyen = 0;
    }
    if (!(bekleyen > S.INDIRME_TAMPONU)) {
      o.tamponUyarildi = false;
      return false;
    }
    if (!o.tamponUyarildi) {
      o.tamponUyarildi = true;
      yaz("uyari", "ek_tampon_siniri", { ek_id, bayt: bekleyen });
    }
    return true;
  };

  const isteAl = async (o: OturumDurumu, m: EkIste): Promise<void> => {
    // Başvurusuz istek diske ve özetin sırasına hiç ulaşmaz: var olan ve olmayan özet aynı yoldan, aynı
    // kodla, beklemeden döner (sıra beklemesi de özetin varlığını sızdırırdı).
    if (!ajandaEkOzetiMi(m.ozet) || !indirilebilir(m.ek_id, m.ozet)) return ret(o, m.ek_id, "ek_yok");
    await sirada(m.ozet, async () => {
      const boyut = await disk.tamBoyutu(m.ozet);
      // Sırada beklerken kayıt silinmiş ya da ek çıkarılmış olabilir.
      if (boyut === null || !indirilebilir(m.ek_id, m.ozet)) return ret(o, m.ek_id, "ek_yok");
      dokun(m.ozet);
      // Boy da üstveriyle tutmalı; tutmayan ya da adıyla tutmayan dosya bozuktur: silinir (yeniden yükleme
      // yerine koyar), istek `ek_yok` alır.
      if (!indirilebilir(m.ek_id, m.ozet, boyut)) {
        await tamSaglam(m.ozet);
        return ret(o, m.ek_id, "ek_yok");
      }
      if (!(await tamSaglam(m.ozet))) return ret(o, m.ek_id, "ek_yok");
      // İstemcinin bildiği dosya bu değil (ofset sonun ötesinde).
      if (m.ofset > boyut) return ret(o, m.ek_id, "ozet_uyusmuyor");
      let ofset = m.ofset;
      for (let i = 0; i < AJANDA_SINIRLARI.EK_PENCERE && ofset < boyut; i++) {
        if (o.kapali) return;
        if (tamponDolu(o, m.ek_id)) {
          // Hiç parça gitmediyse geçici ret (istemci bekleyip yeniden ister; günlüğe ayrıca yazılmaz, sel
          // günlüğü şişirmesin); gittiyse pencere kısa kapanır, `gonderilen` gidene kadarını söyler.
          if (i === 0) return yolla(o, { v: AJANDA_SURUMU, type: "ek_ret", ek_id: m.ek_id, code: "ic_hata" });
          break;
        }
        const parca = await disk.tamOku(m.ozet, ofset, Math.min(AJANDA_SINIRLARI.EK_PARCA, boyut - ofset));
        if (parca.length === 0) return ret(o, m.ek_id, "ic_hata");
        yolla(o, {
          v: AJANDA_SURUMU,
          type: "ek_parca",
          ek_id: m.ek_id,
          ofset,
          veri: Buffer.from(parca.buffer, parca.byteOffset, parca.length).toString("base64"),
        });
        ofset += parca.length;
      }
      yolla(o, { v: AJANDA_SURUMU, type: "ek_durum", ek_id: m.ek_id, gonderilen: ofset, tamam: ofset === boyut });
    });
  };

  // ------------------------------------------------------------------------------------------
  // Temizlik ve yer açma
  // ------------------------------------------------------------------------------------------

  /** Bir dosya silinemedi (Windows paylaşım ihlali, izin): tur düşmez, dosya sonraki turda yeniden denenir. */
  const silmeHatasi = (e: unknown): void => yaz("uyari", "ek_silme_hatasi", { hata_turu: hataTuru(e) });

  /**
   * Silmeden hemen önce (özetin sırasında): işaretler tazelendikten sonra kayıtlar değiştiyse yalnız arada
   * yazılan kayıtlar taranır (turlar arası yeniden başvuru); işaretler yeniden dolaşılmaz (kayıtlar her
   * silmede değişse de silme döngüsü O(işaret × dosya) olmaz). Saat aynı (`simdi`), kırpma zaten yapıldı.
   * Baş revizyon geri gittiyse (depo yedekten döndü) işaretler baştan tazelenir. Döner: dosya hâlâ silinebilir
   * mi; değişiklik `taranan`'a.
   */
  const halaSilinebilir = (
    isaretler: Map<string, AjandaEkIsareti>,
    ozet: string,
    simdi: number,
    taranan: { rev: number; degisti: boolean },
  ): boolean => {
    const basRev = depo.ajandaBasRev();
    if (basRev < taranan.rev) {
      const t = isaretleriTazele(isaretler, simdi, taranan.rev);
      taranan.rev = t.taranan;
      if (t.degisti) taranan.degisti = true;
    } else if (basRev > taranan.rev) {
      const yeni: AjandaEkIsareti = { ilk_ms: simdi, gozlenen_ms: 0, rev: basRev };
      if (mezarTaslariniTara(isaretler, taranan.rev, basRev, yeni)) taranan.degisti = true;
      taranan.rev = basRev;
    }
    const i = isaretler.get(ozet);
    return i !== undefined && suresiDoldu(i, simdi);
  };

  /**
   * Kota dolu (`BAKIM` sırasında çağrılır): yalnız saklama süresi DOLMUŞ başvurusuz dosyalar (turu
   * beklemeden), işaretin en eskisinden başlayarak, yüklemeye yer açılana dek silinir; hepsi silinse de
   * yetmeyecekse hiçbiri silinmez. Saklama penceresindeki dosya hiçbir yükleme uğruna silinmez. Silmeden
   * hemen önce başvuru, dokunma ve yeniden başvuru denetlenir. Döner: silinen dosya sayısı.
   */
  const yerAc = async (eksik: Eksik): Promise<number> => {
    const yeter = (): boolean => k.bayt + eksik.bayt <= kota && k.adet + eksik.adet <= S.DOSYA_ADET;
    if (yeter()) return 1; // arada başka iş yer açtı: yeniden denensin
    const simdi = saat.simdiMs();
    const isaretler = await disk.isaretleriOku();
    const ilk = isaretleriTazele(isaretler, simdi, sonTaranRev);
    const taranan = { rev: ilk.taranan, degisti: ilk.degisti };
    const basvuruda = basvuruDenetleyicisi();
    for (const ozet of [...isaretler.keys()]) {
      if (!basvuruda(ozet)) continue;
      isaretler.delete(ozet);
      taranan.degisti = true;
    }
    const adaylar = [...isaretler]
      .filter(([ozet, i]) => k.tamlar.has(ozet) && suresiDoldu(i, simdi) && !dokunulan.has(ozet) && !basvuruda(ozet))
      .sort((a, b) => a[1].ilk_ms - b[1].ilk_ms || (a[0] < b[0] ? -1 : 1));
    // Hepsi silinse de yetmeyecekse hiçbiri silinmez: başarısız yükleme uğruna dosya gitmesin.
    let acilabilir = 0;
    for (const [ozet] of adaylar) acilabilir += alan(k.tamlar.get(ozet) ?? 0);
    const yetecek = k.bayt - acilabilir + eksik.bayt <= kota && k.adet - adaylar.length + eksik.adet <= S.DOSYA_ADET;
    let silinen = 0;
    let silinen_bayt = 0;
    for (const [ozet] of yetecek ? adaylar : []) {
      if (yeter()) break;
      try {
        await sirada(ozet, async () => {
          const bayt = k.tamlar.get(ozet);
          if (bayt === undefined || dokunulan.has(ozet)) return;
          if (basvuruda(ozet)) {
            isaretler.delete(ozet);
            taranan.degisti = true;
            return;
          }
          if (!halaSilinebilir(isaretler, ozet, simdi, taranan)) return;
          await tamiSil(ozet);
          isaretler.delete(ozet);
          taranan.degisti = true;
          silinen += 1;
          silinen_bayt += bayt;
        });
      } catch (e) {
        silmeHatasi(e);
      }
    }
    if (taranan.degisti) await disk.isaretleriYaz(isaretler);
    sonTaranRev = taranan.rev;
    if (silinen > 0) yaz("bilgi", "ek_kota_temizligi", { silinen, silinen_bayt });
    return silinen;
  };

  /**
   * Önceki başarılı turdan (ya da kapanış kaydından) beri gözlenen süre, tekdüze saatle (`simdiT`): süreçte
   * henüz tur yoksa 0, uzun boşlukta en çok `GOZLEM_ADIMI_MS` (uyku, zamanlayıcı gecikmesi). Duvar saati
   * düzeltmesi adıma girmez: geride kalmış saatte koşan turdan sonra saat ileri alınsa da hayali süre eklenmez.
   */
  const gozlemAdimi = (simdiT: number): number =>
    sonGozlem === null ? 0 : Math.min(Math.max(simdiT - sonGozlem, 0), S.GOZLEM_ADIMI_MS);

  /** Bir işaretin bu adımdaki payı: `sonGozlem`'den sonra sıfırlandıysa yalnız sıfırlamadan beri geçen. */
  const isaretAdimi = (ozet: string, adim: number, simdiT: number): number => {
    const t = sifirlanan.get(ozet);
    return t === undefined ? adim : Math.min(adim, Math.max(simdiT - t, 0));
  };

  /**
   * Kapanışta (`BAKIM` sırasında): son turdan beri gözlenen süre işaretlere yazılır. Yoksa hep bir turdan
   * kısa yaşayan süreçte (açılış turu 0 sayar, sonraki tur hiç gelmez) saklama sayacı hiç ilerlemezdi.
   * Süreç başından ilk tura kadarki süre sayılmaz (ilk tur açılışta hemen koşar); kapanış PC'nin kapalı
   * geçireceği süreyi bilmez, yalnız çalışırken geçeni yazar. Ani ölümde (kapanış yok) en çok bir tur aralığı
   * kaybolur: saklama uzar, kısalmaz.
   */
  const gozlemiKaydet = async (): Promise<void> => {
    const simdiT = tekduze.simdiMs();
    const adim = gozlemAdimi(simdiT);
    if (adim === 0) return;
    const isaretler = await disk.isaretleriOku();
    if (isaretler.size > 0) {
      for (const [ozet, i] of [...isaretler]) {
        isaretler.set(ozet, { ...i, gozlenen_ms: i.gozlenen_ms + isaretAdimi(ozet, adim, simdiT) });
      }
      await disk.isaretleriYaz(isaretler);
    }
    sonGozlem = simdiT;
    sifirlanan.clear();
  };

  const temizlikTuru = async (): Promise<AjandaEkTemizlikSonucu> => {
    const bas = saat.simdiMs();
    const basT = tekduze.simdiMs();
    const adim = gozlemAdimi(basT);
    const sonuc: AjandaEkTemizlikSonucu = {
      silinen: 0,
      silinen_bayt: 0,
      yarim_silinen: 0,
      isaretlenen: 0,
      tutulan: 0,
      hatali: 0,
      eksik_onek: 0,
    };
    // Tur başından sonra bir çerçevenin dokunduğu özet bu turda silinmez.
    const dokunuldu = (ozet: string): boolean => (dokunulan.get(ozet) ?? -Infinity) >= bas;
    try {
      // Turun tek taraması; kullanım da bundan tazelenir.
      const { tamlar, yarimlar } = await tara();
      sonuc.eksik_onek = eksikOnek;

      for (const y of yarimlar) {
        // Boş yarım (sahipsiz onay, baytsız dosya) korunacak bir şey taşımaz: süresi beklenmez.
        if (y.bayt > 0 && bas - y.degisme_ms < S.YARIM_SURE_MS) continue;
        try {
          await sirada(y.ozet, async () => {
            if (dokunuldu(y.ozet)) return;
            await yarimiSil(y.ozet);
            sonuc.yarim_silinen += 1;
          });
        } catch (e) {
          sonuc.hatali += 1;
          silmeHatasi(e);
        }
      }

      const isaretler = await disk.isaretleriOku();
      let degisti = false;
      const mevcut = new Set(tamlar.map((f) => f.ozet));
      for (const [ozet, i] of [...isaretler]) {
        if (!mevcut.has(ozet)) {
          isaretler.delete(ozet);
          degisti = true;
        } else if (adim > 0) {
          isaretler.set(ozet, { ...i, gozlenen_ms: i.gozlenen_ms + isaretAdimi(ozet, adim, basT) });
          degisti = true;
        }
      }
      const ilk = isaretleriTazele(isaretler, bas, sonTaranRev);
      const taranan = { rev: ilk.taranan, degisti: false };
      if (ilk.degisti) degisti = true;
      const yeni: AjandaEkIsareti = { ilk_ms: bas, gozlenen_ms: 0, rev: ilk.taranan };
      // Ek yoksa kayıtlar taranmaz (eki olmayan kurulumda maliyet yok).
      const basvuruda = basvuruDenetleyicisi();
      const silinecek: AjandaEkDosyasi[] = [];
      for (const f of tamlar) {
        if (basvuruda(f.ozet)) {
          sonuc.tutulan += 1;
          if (isaretler.delete(f.ozet)) degisti = true;
          continue;
        }
        const i = isaretler.get(f.ozet);
        if (i === undefined) {
          isaretler.set(f.ozet, yeni);
          degisti = true;
          sonuc.isaretlenen += 1;
        } else if (suresiDoldu(i, bas)) {
          silinecek.push(f);
        } else {
          sonuc.tutulan += 1;
        }
      }
      // İşaretler silmeden önce yazılır: çökme olursa silinmemiş dosyanın işareti kalır, sonraki tur siler.
      // Gözlenen süre ve taranan revizyon yalnız yazıldıktan sonra ilerler.
      if (degisti) await disk.isaretleriYaz(isaretler);
      // Bu turda sıfırlananlar tur başında (adımdan sonra) sıfırlandı: sonraki adım `basT`'den sayılır.
      sonGozlem = basT;
      sifirlanan.clear();
      sonTaranRev = taranan.rev;
      degisti = false;
      for (const f of silinecek) {
        try {
          await sirada(f.ozet, async () => {
            if (dokunuldu(f.ozet)) {
              sonuc.tutulan += 1;
              return;
            }
            // Anlık görüntüden sonra yeniden başvurulmuş olabilir (geri yükleme, ek yeniden eklendi).
            if (basvuruda(f.ozet)) {
              sonuc.tutulan += 1;
              isaretler.delete(f.ozet);
              degisti = true;
              return;
            }
            // Arada geri yüklenip yeniden silinmiş olabilir: işaret baştan başlar.
            if (!halaSilinebilir(isaretler, f.ozet, bas, taranan)) {
              sonuc.tutulan += 1;
              return;
            }
            await tamiSil(f.ozet);
            isaretler.delete(f.ozet);
            degisti = true;
            sonuc.silinen += 1;
            sonuc.silinen_bayt += f.bayt;
          });
        } catch (e) {
          sonuc.hatali += 1;
          silmeHatasi(e);
        }
      }
      if (degisti || taranan.degisti) await disk.isaretleriYaz(isaretler);
      sonTaranRev = taranan.rev;
      yaz("bilgi", "ek_temizlik", { ...sonuc });
      return sonuc;
    } finally {
      for (const [ozet, ms] of dokunulan) if (ms < bas) dokunulan.delete(ozet);
    }
  };

  const temizle = (): Promise<AjandaEkTemizlikSonucu> => {
    surenTemizlik ??= sirada(BAKIM, temizlikTuru).finally(() => {
      surenTemizlik = null;
    });
    return surenTemizlik;
  };

  const temizleArkada = (): void => {
    if (kapali) return;
    izle(async () => {
      try {
        await temizle();
      } catch (e) {
        yaz("hata", "ek_temizlik_hatasi", { hata_turu: hataTuru(e) });
      }
    });
  };

  // ------------------------------------------------------------------------------------------
  // Yüz
  // ------------------------------------------------------------------------------------------

  const isle = (o: OturumDurumu, m: AjandaEkCercevesi): Promise<void> => {
    switch (m.type) {
      case "ek_yukle":
        return yukleAl(o, m);
      case "ek_parca":
        return parcaAl(o, m);
      case "ek_iste":
        return isteAl(o, m);
    }
  };

  const bekle = async (): Promise<void> => {
    while (surenler.size > 0) await Promise.all([...surenler]);
  };

  return {
    oturumAc: (g) => {
      const o: OturumDurumu = {
        gonder: (m) => g.gonder(m),
        bekleyenBayt: () => g.bekleyenBayt?.() ?? 0,
        yuklemeler: new Map(),
        bekleyen: 0,
        kapali: false,
        tamponUyarildi: false,
      };
      oturumlar.add(o);
      return {
        cerceve: (m) => {
          if (o.kapali) return;
          if (kapali || o.bekleyen >= S.BAGLANTI_BEKLEYEN) {
            if (!kapali) yaz("uyari", "ek_bekleyen_siniri", { ek_id: m.ek_id });
            return ret(o, m.ek_id, "ic_hata");
          }
          o.bekleyen += 1;
          izle(async () => {
            try {
              await isle(o, m);
            } catch (e) {
              yaz("hata", "ek_hatasi", { ek_id: m.ek_id, hata_turu: hataTuru(e) });
              ret(o, m.ek_id, "ic_hata");
            } finally {
              o.bekleyen -= 1;
              if (o.kapali && o.bekleyen === 0) yuklemeleriBirak(o);
            }
          });
        },
        kapat: () => {
          o.kapali = true;
          oturumlar.delete(o);
          // Kapanmadan önce alınmış, sırada bekleyen parçalar ayrımlarıyla yazılır (yeni bağlantı kaldığı
          // yerden sürer, kota aşılmaz); ayrımlar onlar bitince bırakılır. Yanıt gitmez.
          if (o.bekleyen === 0) yuklemeleriBirak(o);
        },
      };
    },
    olcum: () => ({
      hazir: k.hazir,
      kullanilan_bayt: k.bayt,
      dosya_adet: k.adet,
      ayrilan_adet: k.ayrilan.size,
      dokunulan_adet: dokunulan.size,
      kota_bayt: kota,
      eksik_onek: eksikOnek,
    }),
    temizle,
    baslat: () => {
      if (kapali || periyot !== null) return;
      periyot = d.zamanlayici.herAralik(S.TEMIZLIK_ARALIGI_MS, temizleArkada);
      temizleArkada();
    },
    bekle,
    // Yinelenen `kapat` aynı kapanışı bekler: gözlenen süre bir kez yazılır.
    kapat: () =>
      (kapanis ??= (async (): Promise<void> => {
        kapali = true;
        periyot?.();
        periyot = null;
        await bekle();
        try {
          await sirada(BAKIM, gozlemiKaydet);
        } catch (e) {
          yaz("hata", "ek_gozlem_hatasi", { hata_turu: hataTuru(e) });
        }
      })()),
  };
};
