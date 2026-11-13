/**
 * Servis modüllerinin sözleşmesi: yalnız tipler ve arayüzler, gövde yok, çalışma anında hiçbir şey.
 * Modül başına kural ve bitti tanımı: ../MODULLER.md. Kablo tipleri `@eren/protocol`'dedir,
 * burada kopyalanmaz. Her modül kendi fabrikasını `export const <ad>Kur: <Ad>Fabrikasi` diye verir,
 * bağımlılıklarını parametre alır, başka modülün dosyasını çalışma anında içe aktarmaz.
 */
import type { z } from "zod";
import type {
  AkisEtkinligi,
  ChatClear,
  ChatCreate,
  ChatDelete,
  ChatRename,
  CmdAdi,
  CmdSonucu,
  CMD_ARG_SEMALARI,
  DeviceState,
  DevirOzetiCikti,
  ErenDurumu as KabloErenDurumu,
  EslestirmeQr,
  GirdiYolu,
  GrantIssued,
  GrantNedeni,
  HataKodu,
  Interrupt,
  IsBitisDurumu,
  IsId,
  IsProfili,
  IsRaporu,
  IsTuru,
  IzinModu,
  JobCancel,
  KisayolBaglami,
  KOPRU_FIIL_SEMALARI,
  KopruFiili,
  KopruRolu,
  KullaniciyaSorCikti,
  McpProfili,
  Notify,
  Olay,
  OturumDurdurCikti,
  OturumlarCikti,
  OturumlarGirdi,
  OturumOzeti,
  PairRequest,
  PairResult,
  Plan,
  PlanDecision,
  PlanOnerCikti,
  PlanTaslagi,
  ProjelerCikti,
  QuestionAnswer,
  RaporOkuCikti,
  RaporVerCikti,
  ServerStatus,
  ServisBilgisi,
  SohbetDurumu,
  SohbetErenDurumu,
  SohbetId,
  SoruBoruGirdi,
  SoruBekleGirdi,
  UsageReport,
  UserMessage,
  UygulamalarCikti,
} from "@eren/protocol";

// ---------------------------------------------------------------------------------------------
// Ortak yardımcı tipler
// ---------------------------------------------------------------------------------------------

export type Markali<T, M extends string> = T & { readonly __marka: M };
export type DagitikOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type IptalEt = () => void;

/** Kablo şemasından türeyen tipler: protokol yalnız şemayı verdiği yerde. */
export type IsNo = z.infer<typeof IsId>;
export type ServerStatusMesaji = z.infer<typeof ServerStatus>;
export type UserMessageMesaji = z.infer<typeof UserMessage>;
export type InterruptMesaji = z.infer<typeof Interrupt>;
export type PlanDecisionMesaji = z.infer<typeof PlanDecision>;
export type QuestionAnswerMesaji = z.infer<typeof QuestionAnswer>;
export type JobCancelMesaji = z.infer<typeof JobCancel>;
/** Dilim 1. Uygulama: gateway.ts (`/sohbet` dalı), temizlik.ts (işleyici). */
export type ChatClearMesaji = z.infer<typeof ChatClear>;
/** Dilim 2. Uygulama: gateway.ts (`/sohbet` dalı), sohbetler.ts (işleyici: `SohbetYoneticisi.olustur`). */
export type ChatCreateMesaji = z.infer<typeof ChatCreate>;
/** Dilim 2. Uygulama: gateway.ts, sohbetler.ts (`SohbetYoneticisi.adlandir`). */
export type ChatRenameMesaji = z.infer<typeof ChatRename>;
/** Dilim 2. Uygulama: gateway.ts, temizlik.ts (`Temizlik.sohbetiSil`). */
export type ChatDeleteMesaji = z.infer<typeof ChatDelete>;
export type PairRequestMesaji = z.infer<typeof PairRequest>;
export type PairResultMesaji = z.infer<typeof PairResult>;
export type GrantIssuedMesaji = z.infer<typeof GrantIssued>;
export type DeviceStateMesaji = z.infer<typeof DeviceState>;
export type NotifyMesaji = z.infer<typeof Notify>;
export type OturumDurumu = OturumOzeti["durum"];

/** Fiil başına boru girdi ve çıktısı: `KOPRU_FIIL_SEMALARI`'ndan türer, elle yazılmaz. */
export type FiilGirdisi<F extends KopruFiili> = z.infer<(typeof KOPRU_FIIL_SEMALARI)[F]["girdi"]>;
export type FiilCiktisi<F extends KopruFiili> = z.infer<(typeof KOPRU_FIIL_SEMALARI)[F]["cikti"]>;
export type CmdArgumani<A extends CmdAdi> = z.infer<(typeof CMD_ARG_SEMALARI)[A]>;

/** Başarı ya da protokolün kapalı hata kodu. `K` o yolda dönebilecek kodları daraltır. */
export type Sonuc<T, K extends HataKodu = HataKodu> =
  | { ok: true; deger: T }
  | { ok: false; code: K; detail?: string };

export type Ortam = Readonly<Record<string, string>>;

/**
 * Dilim 2. İşlemin hangi sohbete ait olduğu (`SohbetId`, telefon üretir; varsayılan sohbet
 * `ANA_SOHBET_ID`). Sohbete bağlı her işlev bunu SON parametre olarak nesne biçiminde alır.
 *
 * - Parametre ZORUNLU ise (`sohbet: SohbetSecimi`): yalnız o sohbet. Yazan, silen ve tek sohbetin
 *   durumunu okuyan bütün işlevler böyledir.
 * - Parametre İSTEĞE BAĞLI ise (`sohbet?: SohbetSecimi`): yalnız okuma ve sayma işlevlerinde, ve
 *   verilmemesi "bütün sohbetler" (süzgeç yok) demektir, ASLA `"ana"` değil. Liste MODULLER.md
 *   "Dilim 2" > "`ana` varsayılanı".
 * - `"ana"` varsayılanı yalnız `sohbet_id`'si olmayan bir kayıt OKUNURKEN uygulanır: kablo ve olay
 *   için `sohbetAnahtari` (`@eren/protocol`), depoda `events.sohbet_id IS NULL` ve eski `eren`
 *   jeton satırı. Hiçbir işlev parametresi `"ana"`ya düşmez.
 *
 * Dilim 1'de alan isteğe bağlıydı ve yok sayılıyordu; dilim 2'de zorunlu oldu: unutulan çağrı tip
 * denetiminde görünsün.
 */
export interface SohbetSecimi {
  readonly sohbet_id: SohbetId;
}

// ---------------------------------------------------------------------------------------------
// Portlar: dış dünya. Birim testleri bunların sahtesiyle koşar, gerçek `claude` çalışmaz.
// Gerçekleri `dis-dunya.ts`, sahteleri `test/sahte.ts`.
// ---------------------------------------------------------------------------------------------

export interface SaatPortu {
  simdiMs(): number;
}

export interface ZamanlayiciPortu {
  sonra(ms: number, f: () => void): IptalEt;
  herAralik(ms: number, f: () => void): IptalEt;
}

export interface RastgelePortu {
  /** Güvenli üreteçten. */
  baytlar(adet: number): Uint8Array;
  /** `--session-id` için UUID v4. */
  uuid(): string;
  /** `OpakId` biçiminde, `on` ön ekli. */
  opakId(on: string): string;
  /** `Jeton` biçiminde, en az 32 rastgele bayt. */
  jeton(): string;
  /** 64 bit küçük harf hex: 16 karakter. Çit kimliği. */
  hex64(): string;
}

export interface DosyaPortu {
  /** UTF-8. Dosya yoksa `null`, başka hatada atar. */
  oku(yol: string): Promise<string | null>;
  /** Geçici dosya + yeniden adlandırma; okuyan yarım içerik görmez. */
  atomikYaz(yol: string, icerik: string): Promise<void>;
  /** `ofset`'ten en çok `azamiBayt`. Dosya yoksa ya da sonundaysa boş dizi. */
  aralikOku(yol: string, ofset: number, azamiBayt: number): Promise<Uint8Array>;
  boyut(yol: string): Promise<number | null>;
  dizinOlustur(yol: string): Promise<void>;
  dizinVarMi(yol: string): Promise<boolean>;
  /**
   * Dilim 2. Uygulama: dis-dunya.ts (gerçek), test/sahte.ts (sahte). Tek düz dosyayı siler: `lstat`
   * ile dizin ya da bağ (junction, sembolik) çıkarsa silmez ve atar; dosya yoksa sessizce döner;
   * başka hatada atar. Tek kullanıcısı `konusma`dır (nesil başına ana oturum mcp dosyası,
   * `Ayar.erenMcpYolu`); başka modülün kullanması sözleşme değişikliğidir.
   */
  dosyaSil(yol: string): Promise<void>;
}

/** Günlük dosyası. `gunluk` dışında kullanılmaz; hiçbir zaman atmaz, stdout'a yazmaz. */
export interface KayitPortu {
  satirEkle(satir: string): void;
  boyut(): number;
  /** `servis.log` -> `servis.1.log` -> ..., en eskisi silinir. */
  dondur(azamiDosya: number): void;
}

/** PID yeniden kullanılır: kimlik her zaman PID ile oluşma anının ikilisidir. */
export interface SurecKimligi {
  pid: number;
  olusturmaMs: number;
}

export interface SurecKaydi extends SurecKimligi {
  ppid: number;
  ad: string;
}

/** Yalnız ana oturum (konuşma) süreci. `windowsHide` + boru, `detached` YOK: gerçekleme bunu sabitler. */
export interface BoruluSurecIstegi {
  exe: string;
  argv: readonly string[];
  cwd: string;
  ortam: Ortam;
}

export interface BoruluSurec extends SurecKimligi {
  /** Satır sonunu çağıran eklemez. Kırık boruda atmaz, `false` döner. */
  satirYaz(satir: string): boolean;
  stdinKapat(): void;
  stdoutSatirDinle(f: (satir: string) => void): void;
  stderrDinle(f: (parca: string) => void): void;
  /** Çıkış kodu bilerek verilmez: `taskkill` sonrası kod anlamsızdır. */
  cikisDinle(f: () => void): void;
}

/** Yalnız iş oturumu. `detached` + `windowsHide` + dosya stdio + `unref`: gerçekleme sabitler. */
export interface AyrikSurecIstegi {
  exe: string;
  argv: readonly string[];
  cwd: string;
  ortam: Ortam;
  outYol: string;
  errYol: string;
}

export interface AyrikSurec extends SurecKimligi {
  /** Yalnız erken uyanma içindir, kesin bitiş `surecVarMi`dir. Çıkış kodu yoktur. */
  cikisDinle(f: () => void): void;
}

/** Kısa ömürlü yardımcı araç (`gh`, `tailscale`...). `windowsHide`, `detached` YOK. */
export interface AracIstegi {
  exe: string;
  argv: readonly string[];
  cwd?: string;
  ortam?: Ortam;
  zamanAsimiMs: number;
}

export interface AracSonucu {
  zamanAsimi: boolean;
  stdout: string;
  stderr: string;
}

export interface SurecPortu {
  /** Oluşma anı süreç listesinden okunur, bu yüzden Promise. Başlatılamazsa atar. */
  boruluBaslat(istek: BoruluSurecIstegi): Promise<BoruluSurec>;
  ayrikBaslat(istek: AyrikSurecIstegi): Promise<AyrikSurec>;
  aracCalistir(istek: AracIstegi): Promise<AracSonucu>;
  anlikGoruntu(): Promise<readonly SurecKaydi[]>;
  /** Yalnız PID + oluşma anı birlikte tutarsa `true`. */
  surecVarMi(kimlik: SurecKimligi): Promise<boolean>;
  /** `taskkill /T /F /PID`. Kod bilerek dönmez: başarıda bile 128 ölçüldü, sağlama `anlikGoruntu`. */
  agaciOldur(pid: number): Promise<void>;
  /** `taskkill /F /PID`, `/T` yok: yetim süpürmek için. */
  tekOldur(pid: number): Promise<void>;
}

export type MasaustuDurumu = "bagli" | "kopuk" | "bilinmiyor";

export interface RamOkumasi {
  bosMb: number;
  toplamMb: number;
}

export interface SistemPortu {
  ramOku(): RamOkumasi;
  /** 100.64.0.0/10 içindeki yerel adres, yoksa `null`. */
  tailscaleAdresi(): string | null;
  /** Oturumun `WTSConnectState` karşılığı. */
  masaustuDurumu(): Promise<MasaustuDurumu>;
}

export type WsYolu = "/sohbet" | "/cihaz";

export interface WsBaglantisi {
  readonly yol: WsYolu;
  readonly uzakIp: string;
  /** Canlı etkinlik. Bağlantının adres sorgusunda bildirdiği yetenek jetonları; bildirmediyse boş küme. */
  readonly yetenekler: ReadonlySet<string>;
  gonder(metin: string): void;
  kapat(kod: number, neden: string): void;
  mesajDinle(f: (metin: string) => void): void;
  kapanisDinle(f: () => void): void;
}

export interface WsSunucuIstegi {
  host: string;
  port: number;
  /** Bayt sınırı, `ws` `maxPayload`. */
  azamiCerceve: Readonly<Record<WsYolu, number>>;
  baglanti: (b: WsBaglantisi) => void;
}

export interface KapatilabilirSunucu {
  kapat(): Promise<void>;
}

export interface WsSunucuPortu {
  dinle(istek: WsSunucuIstegi): Promise<KapatilabilirSunucu>;
}

/** Gerçekleme `\n` ile çerçeveler. Sınırı aşan satırda bağlantıyı kapatır, satırı iletmez. */
export interface BoruBaglantisi {
  satirYaz(satir: string): void;
  kapat(): void;
  satirDinle(f: (satir: string) => void): void;
  kapanisDinle(f: () => void): void;
}

export interface BoruSunucuIstegi {
  ad: string;
  azamiSatir: number;
  baglanti: (b: BoruBaglantisi) => void;
}

export interface BoruSunucuPortu {
  dinle(istek: BoruSunucuIstegi): Promise<KapatilabilirSunucu>;
}

export interface HttpPortu {
  /** Ağ hatasında atar. URL günlüğe yazılmaz: Telegram jetonu URL'dedir. */
  postJson(url: string, govde: unknown, zamanAsimiMs: number): Promise<{ durum: number }>;
}

/** Bilgisayarın P-256 kimliği ve doğrulama. Özel anahtar bu portun dışına çıkmaz. */
export interface AnahtarPortu {
  /** SPKI DER, standart base64. */
  acikAnahtar(): string;
  /** ECDSA P-256 + SHA-256, DER, standart base64. Metin UTF-8 imzalanır. */
  imzala(metin: string): string;
  dogrula(acikAnahtar: string, metin: string, imza: string): boolean;
  sabitZamanEsit(a: string, b: string): boolean;
}

/** Servisin tekil örnek kilidi. Limit kilidi ile karıştırma: o `kilit` modülüdür. */
export interface TekilKilitPortu {
  /** Süreç ölünce kendiliğinden düşer. Başka örnek tutuyorsa `false`. */
  al(): Promise<boolean>;
}

/** `TranskriptPortu.sil` sayıları. Günlüğe yalnız bunlar yazılır, yol ve ad yazılmaz. */
export interface TranskriptSilmeSonucu {
  /** Silinen dosya ve dizin sayısı. */
  silinen: number;
  /** Kökte hiçbir eşleşmesi olmayan oturum sayısı. */
  bulunamayan: number;
  /** Eşleşen ama silinemeyen (kilitli, erişim yok) öğe sayısı. */
  silinemeyen: number;
  /** UUID biçiminde olmadığı için hiç bakılmayan girdi sayısı. */
  reddedilen: number;
}

/**
 * Dilim 1. Uygulama: dis-dunya.ts (gerçek), test/sahte.ts (sahte). Ana oturum nesillerinin Claude
 * transkriptlerini silen DAR port. Kök sabittir (`ErenYollari.claudeProjeleri`), çağıran yol
 * veremez; genel bir `sil(yol)` portu bilerek YOKTUR. Dilim 2'de her sohbet örneği aynen kullanır.
 */
export interface TranskriptPortu {
  /**
   * Her oturum kimliği için kökün doğrudan alt dizinlerinde (`<kök>\<proje>\`) şunlar silinir:
   * `<uuid>.jsonl`, `<uuid>\` dizini (içeriğiyle; junction ve sembolik bağ izlenmez, bağın kendisi
   * silinir) ve adı `<uuid>.` ile başlayan dosyalar (yedekler, ör. `<uuid>.jsonl.nesil1.bak`).
   * Kimlik büyük küçük harf duyarsız 8-4-4-4-12 hex UUID değilse dokunulmaz, `reddedilen`'e sayılır.
   * Kökün dışına çıkılmaz, kök yoksa her oturum `bulunamayan` olur. Hiç atmaz. Çağıran, dosyayı
   * tutan süreç çıktıktan SONRA çağırır (Windows kilidi).
   */
  sil(oturumlar: readonly string[]): Promise<TranskriptSilmeSonucu>;
}

/** Bütün portlar: `ana` gerçeklerini, testler sahtelerini verir. */
export interface DisDunya {
  saat: SaatPortu;
  zamanlayici: ZamanlayiciPortu;
  rastgele: RastgelePortu;
  dosya: DosyaPortu;
  kayit: KayitPortu;
  surec: SurecPortu;
  sistem: SistemPortu;
  ws: WsSunucuPortu;
  boru: BoruSunucuPortu;
  http: HttpPortu;
  anahtar: AnahtarPortu;
  tekilKilit: TekilKilitPortu;
  /** Dilim 1. Uygulama: dis-dunya.ts, test/sahte.ts. */
  transkript: TranskriptPortu;
}

export type DisDunyaFabrikasi = (girdi: { yollar: ErenYollari }) => Promise<DisDunya>;
/** Ayrı: `ayar` yolları üretmeden önce dosya okumak zorunda. */
export type DosyaPortuFabrikasi = () => DosyaPortu;

// ---------------------------------------------------------------------------------------------
// gunluk
// ---------------------------------------------------------------------------------------------

export type GunlukAlani = string | number | boolean | null;
export type GunlukAlanlari = Readonly<Record<string, GunlukAlani>>;

export interface Gunluk {
  bilgi(modul: string, olay: string, alanlar?: GunlukAlanlari): void;
  uyari(modul: string, olay: string, alanlar?: GunlukAlanlari): void;
  hata(modul: string, olay: string, alanlar?: GunlukAlanlari): void;
}

export interface GunlukBagimliliklari {
  kayit: KayitPortu;
  saat: SaatPortu;
  azamiBayt: number;
  azamiDosya: number;
}

export type GunlukFabrikasi = (b: GunlukBagimliliklari) => Gunluk;

// ---------------------------------------------------------------------------------------------
// ayar
// ---------------------------------------------------------------------------------------------

export interface ErenYollari {
  /** `EREN_KIT_DATA_DIR`, yoksa `%LOCALAPPDATA%\eren-kit`. */
  kok: string;
  vt: string;
  log: string;
  /** `isler\<id>\` üst dizini. */
  islerDizini: string;
  /** Ana oturum süreci için boş çalışma dizini. Bütün sohbetlerde ORTAK (resume uyumu, M1). */
  erenCwd: string;
  /**
   * Dilim 2 (dilim 1'deki tek `erenMcp` dosyasının yerine). `<veri kökü>\eren-mcp\`: nesil
   * başına ana oturum mcp dosyalarının dizini; dosya yolu yalnız `Ayar.erenMcpYolu`'dan. `ana` açılışta kurar.
   */
  erenMcpDizini: string;
  anahtar: string;
  kimlikEki: string;
  projeler: string;
  yerelAyar: string;
  /** Limit modunun `kilit.json`'u. Salt okunur. */
  limitKilit: string;
  /**
   * Dilim 1. Uygulama: ayar.ts. `%USERPROFILE%\.claude\projects`: `TranskriptPortu`'nun sabit kökü.
   * `USERPROFILE` yoksa ya da mutlak değilse başlangıçta atar (`LOCALAPPDATA` gibi).
   */
  claudeProjeleri: string;
}

/** Bir iş dizininin dosyaları. Kimlik tam sayı olduğu için dizin geçişi yoktur. */
export interface IsYollari {
  dizin: string;
  gorev: string;
  mcp: string;
  out: string;
  err: string;
  /** Telefon işinin boş `cwd`'si. */
  bosCwd: string;
}

export interface McpSunucuTanimi {
  command: string;
  args: readonly string[];
  env?: Ortam;
}

export interface Sureler {
  kilitYoklamaMs: number;
  torunYoklamaMs: number;
  isYoklamaMs: number;
  ramYoklamaMs: number;
  soruZamanAsimiMs: number;
  devirOzetiBeklemeMs: number;
  deltaTamponMs: number;
  bildirimAckMs: number;
  komutPayiMs: number;
  erenYenidenBaslatmaMs: number;
}

export interface Ayar {
  readonly yollar: ErenYollari;
  isYollari(is_id: IsNo): IsYollari;
  /**
   * Dilim 2. Uygulama: ayar.ts. `<erenMcpDizini>\<nesil>.json`. Nesil tüm sohbetlerde tekil olduğu
   * için iki ana oturum aynı dosyayı paylaşmaz (M1). `nesil` pozitif güvenli tam sayı değilse atar
   * (`isYollari` gibi). Sohbet kimliği dosya adına girmez (Windows'ta büyük küçük harf çakışır).
   */
  erenMcpYolu(nesil: number): string;
  /**
   * Dilim 2. Uygulama: ayar.ts (`ayar.local.json` `eren_canli_azami`, tam sayı 1-4, varsayılan 2;
   * aralık dışı `AyarHatasi`). Aynı anda süreci olan (açılan dahil) en çok ana oturum sayısı; devir adayı
   * sayılmaz (geçici +1). Kullanan: sohbetler.ts.
   */
  readonly erenCanliAzami: number;
  /**
   * Dilim 3b. Uygulama: ayar.ts (`ayar.local.json` `tam_yetki`, mantık değeri, yoksa `true`). PC'nin
   * tam yetki anahtarı: planlar, `rapor_oku` ve ana oturumun sistem istemi okur. Kurulumda bir kez okunur.
   */
  readonly tamYetki: boolean;
  /**
   * Dilim 2. Uygulama: ayar.ts (`eren_bosta_kapat_dk`, tam sayı 1-1440, varsayılan 30; aralık dışı
   * `AyarHatasi`), milisaniyeye çevrilmiş. Boşta ana oturum bu kadar sonra uyutulur. Kullanan: sohbetler.ts.
   */
  readonly erenBostaKapatMs: number;
  readonly claudeExe: string;
  /** `process.execPath`. */
  readonly nodeExe: string;
  /** Stdio köprünün giriş dosyası (`src/kopru.ts`), mutlak yol. */
  readonly kopruBetigi: string;
  readonly erenModeli: string;
  /** `null`: bayrak verilmez, kullanıcının varsayılanı. */
  readonly pcIsModeli: string | null;
  readonly telefonIsModeli: string;
  readonly wsPort: number;
  readonly ramDusukMb: number;
  readonly sureler: Sureler;
  /** Telefon güvenlik metnindeki ve bildirimlerdeki ad. Repo dışındaki ayardan. */
  readonly kullaniciAdi: string;
  /** Kullanıcıya görünen ve persona/sistem metinlerine giren asistan adı. `EREN_KIT_ASSISTANT_NAME`, yoksa "Claude". */
  readonly asistanAdi: string;
  readonly computerUse: McpSunucuTanimi | null;
  mcpProfilSunucusu(profil: McpProfili): McpSunucuTanimi | null;
  /** `CLAUDE*`/`ANTHROPIC*` silinmiş (büyük küçük harf duyarsız) + dört kapatma anahtarı. */
  erenOrtami(): Ortam;
  telefonIsOrtami(): Ortam;
  /** Yalnız `CLAUDE*`/`ANTHROPIC*` silinmiş. Kapatma anahtarları YOK. */
  pcIsOrtami(): Ortam;
  /** Repo dışı kişisel ek. Yoksa boş metin. */
  kimlikEki(): Promise<string>;
  projeler(): Promise<z.infer<typeof ProjelerCikti>>;
  telegram(): Promise<TelegramAyari | null>;
  /**
   * Dilim 1. Uygulama: ayar.ts. `server_status.servis` olduğu gibi buradan gider. `surum`: bu
   * dosyanın kendi konumundan (`import.meta.url`, `<sürüm>\server\src\` → `<sürüm>\surum.json`)
   * okunan `sha`; dosya yoksa, bozuksa ya da `sha` sürüm adı desenine uymuyorsa `null`
   * (geliştirme kopyası). `baslangic_ms`: `AyarBagimliliklari.baslangicMs`. Kurulumda bir kez okunur.
   */
  readonly servis: ServisBilgisi;
}

export interface TelegramAyari {
  jeton: string;
  sohbetId: string;
}

export interface AyarBagimliliklari {
  dosya: DosyaPortu;
  /** `process.env`'in kopyası. */
  ortam: Ortam;
  execPath: string;
  /** Dilim 1. Uygulama: ana.ts verir. Servis sürecinin başladığı an, epoch ms. */
  baslangicMs: number;
}

export type AyarFabrikasi = (b: AyarBagimliliklari) => Promise<Ayar>;

// ---------------------------------------------------------------------------------------------
// veriyolu: modüller arası tipli olaylar
// ---------------------------------------------------------------------------------------------

/** Süreci olan (ya da açılmaya çalışılan) ana oturumun dört durumu: protokoldeki `ErenDurumu`. */
export type ErenDurumu = KabloErenDurumu;
/**
 * Dilim 2. Sohbet başına ana oturum durumu: dördü + `uyuyor` (süreç yok, servis kararı) + `sirada` (süreç
 * gerekiyor, canlı sınırı ya da RAM kapısı bekletiyor). `Konusma.durum()` ve `eren_durumu` bunu taşır.
 */
export type SohbetErenDurumuTipi = SohbetErenDurumu;
/** Dilim 2. `server_status.sohbetler`: `SohbetYoneticisi.durumlar()` üretir, `gateway` olduğu gibi koyar. */
export type SohbetDurumlariTipi = ServerStatusMesaji["sohbetler"];
export type SohbetDurumuTipi = SohbetDurumu;

export type LimitKilitDurumu =
  /** Dosya yok, ya da geçerli ve (elle açılmış ya da sıfırlanma geçmiş). */
  | { tur: "serbest" }
  /** Geçerli, `acildi` null, sıfırlanma ileride. */
  | { tur: "aktif"; sifirlanmaMs: number; yuzde: number }
  /** Okunamadı ya da bozuk: yeni başlatma yok, kimse öldürülmez. */
  | { tur: "belirsiz"; neden: string };

export interface LimitPenceresi {
  /** 0-100 arası, `utilization * 100`. */
  yuzde: number;
  sifirlanmaMs: number;
}

/** `rate_limit_event`'ten. Alan yoksa `null`: belgesiz biçimdir, savunmacı okunur. */
export interface LimitDolulugu {
  besSaat: LimitPenceresi | null;
  yediGun: LimitPenceresi | null;
  /** Olayın geldiği an. */
  olcumMs: number;
}

/** Servisin işi neden bitirdiği. `dogal` kayıt dışıdır: `durdurma` boş kalır. */
export type BitisNedeni = "dogal" | "kullanici" | "eren" | "limit" | "izin_durduruldu";

/**
 * Dilim 2: sohbete bağlı her olay `sohbet_id` taşır (zorunlu alan: yayınlayan unutursa tip denetimi
 * yakalar; dinleyen yeni alanı okumazsa yakalamaz). Her `konusma` örneği yalnız kendi `sohbet_id`'li
 * olayına tepki verir. Küresel kalanlar: `olay_yazildi`, `limit_dolulugu`, `kilit_degisti`,
 * `ram_degisti`, `is_sayisi_degisti`, `izin_*`, `cihaz_baglantisi`.
 */
export interface ServisOlaylari {
  /** Kalıcı olay kaydedildi. Yalnız `Depo.olayEkle` yayınlar, işlem bitince. */
  olay_yazildi: { olay: Olay };
  /** Kalıcı değil. Yalnız `konusma` yayınlar, tamponlanmış. Dilim 2: `assistant_delta.sohbet_id` buradan. */
  tur_delta: { sohbet_id: SohbetId; turn_id: string; offset: number; text: string };
  /**
   * Canlı etkinlik. Kalıcı değil. Yalnız `konusma` yayınlar: turun o anki etkinliği değişti.
   * `baslangic_ms`: etkinliğin servis saatiyle (`SaatPortu`) başladığı an. `kaynak_msg_id`: bu turu başlatan
   * insan mesajının `client_msg_id`'si; tur insan mesajıyla başlamadıysa `null`.
   */
  tur_etkinligi: {
    sohbet_id: SohbetId;
    turn_id: string;
    etkinlik: AkisEtkinligi;
    baslangic_ms: number;
    kaynak_msg_id: string | null;
  };
  /**
   * Canlı etkinlik. Kalıcı değil. Yalnız `konusma` yayınlar: etkinliği tutulan (görünür) tur hangi yoldan
   * kapanırsa kapansın tam bir kez. Görünmeyen turda yayınlanmaz.
   */
  tur_etkinligi_bitti: { sohbet_id: SohbetId; turn_id: string };
  tur_basladi: { sohbet_id: SohbetId; turn_id: string };
  tur_bitti: { sohbet_id: SohbetId; turn_id: string };
  /** Dilim 2: sohbet başına; `durum` altı değerli. `gateway` her yayında bütün `server_status`'u yeniden kurar. */
  eren_durumu: { sohbet_id: SohbetId; durum: SohbetErenDurumuTipi };
  limit_dolulugu: { doluluk: LimitDolulugu };
  kilit_degisti: { durum: LimitKilitDurumu };
  ram_degisti: { ram: RamOzeti };
  /** Küresel: `server_status.aktif_is`. */
  is_sayisi_degisti: { aktif: number };
  /** Dilim 2: `sohbet_id` işin (= planın) sohbeti. */
  is_basladi: { is_id: IsNo; plan_id: string; tur: IsTuru; sohbet_id: SohbetId };
  is_bitti: { is_id: IsNo; plan_id: string; tur: IsTuru; durum: IsBitisDurumu; kirli: boolean; sohbet_id: SohbetId };
  /**
   * `is_uzlastirildi` notundan sonra, açılışta bir kez. Metin yok, yalnız sayılar. Dilim 2: toplamlar
   * küreseldir; `sohbetler` en az bir işi uzlaştırılan her sohbetin kendi sayıları (anahtar `sohbet_id`).
   * Her `konusma` örneği yalnız kendi girdisi varsa sentetik not yazar.
   */
  isler_uzlastirildi: {
    sahiplenilen: number;
    biten: number;
    sohbetler: Readonly<Record<SohbetId, UzlastirmaOzeti>>;
  };
  /** Soru metni ve cevap BU OLAYDA YOK: ana oturuma gidemesin diye. Dilim 2: `sohbet_id` işin sohbeti. */
  soru_durumu: {
    soru_id: string;
    is_id: IsNo;
    sohbet_id: SohbetId;
    durum: "soruldu" | "cevaplandi" | "zaman_asimi" | "iptal";
  };
  /**
   * Kirli raporu ana oturum okudu: bir sonraki planın `kirli_kaynak`'ına girer. Dilim 2: `sohbet_id` OKUYAN
   * ana oturumun sohbetidir (köprü jetonundan), işin sohbeti değil: kirlilik okuyanın bağlamına bulaşır.
   */
  kirli_okundu: { is_id: IsNo; sohbet_id: SohbetId };
  /** Dilim 2: `sohbet_id` planın (öneren ana oturumun) sohbeti. */
  plan_onerildi: { plan_id: string; sohbet_id: SohbetId };
  plan_sonuclandi: {
    plan_id: string;
    sohbet_id: SohbetId;
    sonuc: "onaylandi" | "reddedildi" | "iptal";
    is_id?: IsNo;
  };
  izin_geldi: { izin: IzinKaydi };
  izin_gitti: { grant_id: string; plan_id: string; neden: GrantNedeni };
  cihaz_baglantisi: { bagli: boolean };
  /**
   * Dilim 2. Yalnız `sohbetler` yayınlar: örnek eklendi (`chat_created` yazıldıktan sonra) ya da
   * kaldırıldı (`chat_deleted` yazıldıktan sonra). `gateway` `server_status`'u yeniden yayar. Ad yok.
   */
  sohbet_listesi_degisti: { sohbet_id: SohbetId; olay: "olusturuldu" | "silindi" };
}

export type ServisOlayAdi = keyof ServisOlaylari;

export interface Veriyolu {
  /** Dinleyiciler eşzamanlı ve kayıt sırasıyla çalışır; birinin hatası diğerini engellemez. */
  yayinla<K extends ServisOlayAdi>(ad: K, veri: ServisOlaylari[K]): void;
  dinle<K extends ServisOlayAdi>(ad: K, f: (veri: ServisOlaylari[K]) => void): IptalEt;
}

export type VeriyoluFabrikasi = (b: { gunluk: Gunluk }) => Veriyolu;

// ---------------------------------------------------------------------------------------------
// akis: `claude` stream-json çıktısının okunan kısmı (saf çözücü)
// ---------------------------------------------------------------------------------------------

export interface McpSunucuDurumu {
  name: string;
  status: string;
}

export interface MesajKullanimi {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

/**
 * Tüketim. Bir `result`'ta bir modelin sayıları. `model_usage_since_last_result.<m>`'den: önceki
 * `result`'tan bu yana FARK (`costUSD` dahil), birikimli `modelUsage`/`total_cost_usd` değil.
 * `maliyet_usd` `null`: bilinmiyor.
 */
export interface ModelKullanimi {
  model: string;
  girdi: number;
  cache_yazma: number;
  cache_okuma: number;
  cikti: number;
  maliyet_usd: number | null;
}

export type AkisOlayi =
  | {
      tur: "init";
      session_id: string;
      tools: readonly string[];
      mcp_servers: readonly McpSunucuDurumu[];
      apiKeySource: string | null;
      model: string | null;
    }
  | { tur: "hook_response"; cikti: string }
  /** Aynı `message_id` birden çok satırda gelebilir: toplanmaz, sonuncu alınır. */
  | {
      tur: "assistant";
      message_id: string;
      model: string | null;
      kullanim: MesajKullanimi | null;
      /** Canlı etkinlik. O asistan satırındaki `tool_use` blokları; yoksa boş dizi. */
      araclar: readonly { id: string; ad: string }[];
    }
  /** Canlı etkinlik. Yeni bir model çağrısı başladı (`stream_event`/`message_start`). */
  | { tur: "model_basladi" }
  /**
   * Canlı etkinlik. `content_block_start`. `arac_id` ve `arac_adi` yalnız `blok === "arac"` iken dolu.
   */
  | { tur: "blok_basladi"; blok: "dusunme" | "metin" | "arac"; arac_id?: string; arac_adi?: string }
  /** Canlı etkinlik. `tool_result` blokları taşıyan `user` satırı: bu araç çağrıları bitti. */
  | { tur: "arac_sonucu"; arac_idler: readonly string[] }
  | { tur: "metin_parcasi"; text: string }
  | { tur: "rate_limit"; besSaat: LimitPenceresi | null; yediGun: LimitPenceresi | null }
  | {
      tur: "result";
      session_id: string | null;
      is_error: boolean;
      terminal_reason: string | null;
      stop_reason: string | null;
      /** `subtype` bilerek yok: kesilmiş tur da `success` geliyor. */
      metin: string;
      structured_output: unknown;
      /** `modelUsage.<m>.contextWindow`, model başına. */
      pencereler: Readonly<Record<string, number>>;
      /**
       * Tüketim. `model_usage_since_last_result`, model başına fark (alt agent dahil). Alan yoksa
       * `null`, `{}` ise `[]` (toplu yayında ilkinden sonraki sonuçlar).
       */
      model_kullanimlari: readonly ModelKullanimi[] | null;
      /** Tüketim. `usage` (`output_tokens` dahil; yalnız ana döngü). Yoksa `null`. */
      ana_kullanim: Omit<ModelKullanimi, "model" | "maliyet_usd"> | null;
    }
  | { tur: "control_response"; request_id: string; basarili: boolean }
  | { tur: "diger"; type: string };

export interface AkisCozucu {
  /** Hiç atmaz. JSON değilse `null`. Bilinmeyen alan ve tür yok sayılır: biçim bizim değil. */
  satirCoz(satir: string): AkisOlayi | null;
}

/** Bayt akışından tam satır çıkarır. `tuketilen` kalıcı ofsete eklenir, yarım satır sayılmaz. */
export interface SatirAyirici {
  ayir(baytlar: Uint8Array): { satirlar: string[]; tuketilen: number };
}

export type TurSonucuSinifi = "tamam" | "kesildi" | "hata";

export interface AkisYardimcilari extends AkisCozucu {
  satirAyirici(): SatirAyirici;
  turSonucuSinifla(sonuc: Extract<AkisOlayi, { tur: "result" }>): TurSonucuSinifi;
  /** Üç giriş alanının toplamı. */
  dolulukHesapla(kullanim: MesajKullanimi): number;
  /** `min(pencere * 0.5, 200000)`. */
  devirEsigi(pencere: number): number;
  /** Modele ait pencere; model yoksa ya da eşleşmiyorsa en küçüğü; hiç yoksa `null`. */
  pencereSec(pencereler: Readonly<Record<string, number>>, model: string | null): number | null;
}

export type AkisFabrikasi = () => AkisYardimcilari;

// ---------------------------------------------------------------------------------------------
// depo: SQLite
// ---------------------------------------------------------------------------------------------

export type OlayGirdisi = DagitikOmit<Olay, "seq" | "ts_ms">;

export type TurKaynagi = "insan" | "sentetik" | "devir";
export type TurBitisi = "tamam" | "kesildi" | "surec_oldu" | "limit_kilit" | "hata";

export interface TurKaydi {
  turn_id: string;
  /** Dilim 2: turu açan örneğin sohbeti (`turns.sohbet_id`). */
  sohbet_id: SohbetId;
  nesil: number;
  kaynak: TurKaynagi;
  /** Telefona akar mı. Devir isteğinin turu görünmez. */
  gorunur: boolean;
  baslangic_ms: number;
  bitis_ms: number | null;
  bitis: TurBitisi | null;
  kismi_metin: string;
}

export interface NesilKaydi {
  /**
   * Dilim 2: TÜM sohbetlerde tekil (`nesiller` PK değişmez). Yeni numara yalnız
   * `KonusmaBagimliliklari.nesilAyir()`'dan gelir; aynı sohbetin önceki nesli `nesil - 1` DEĞİLDİR,
   * `Depo.sonNesil`/`nesiller` ile sohbet kapsamlı okunur.
   */
  nesil: number;
  /** Dilim 2 (`nesiller.sohbet_id`). */
  sohbet_id: SohbetId;
  session_id: string;
  baslangic_ms: number;
  bitis_ms: number | null;
  ozet_kabul: boolean | null;
  pid: number | null;
  olusturma_ms: number | null;
  son_dolu: number | null;
  pencere: number | null;
}

export type PlanDurumu = "bekliyor" | "izin_bekliyor" | "onaylandi" | "reddedildi" | "iptal";

export interface PlanKaydi {
  plan: Plan;
  plan_hash: string;
  durum: PlanDurumu;
  is_id: IsNo | null;
  olusturma_ms: number;
  /**
   * Dilim 1. Uygulama: depo.ts (`planlar.profil` sütunu, ek göç 1), planlar.ts (yazar). Plan JSON'una
   * ve `plan_hash`'e girmez. Sütundan önceki satırlar `tam` okunur (sütun varsayılanı). Telefon
   * planında hep `tam` yazılır, `isler` telefon profilini kullanır.
   */
  profil: IsProfili;
  /**
   * Dilim 2 (`planlar.sohbet_id`; plan JSON'una ve `plan_hash`'e GİRMEZ). Öneren ana oturumun sohbeti,
   * yalnız köprü jeton kapsamından (`planOner`'in `sohbet` parametresi); model seçemez (M4).
   */
  sohbet_id: SohbetId;
}

export type RaporKaynagi = "result" | "rapor_ver";

export interface IsKaydi {
  is_id: IsNo;
  /** Dilim 2 (`isler.sohbet_id`): planın sohbeti (`IsBaslatmaIstegi.sohbet_id`). Sorunun sohbeti de budur. */
  sohbet_id: SohbetId;
  plan_id: string;
  plan_hash: string;
  baslik: string;
  tur: IsTuru;
  cwd: string;
  durum: OturumDurumu;
  kirli: boolean;
  session_id: string;
  pid: number | null;
  olusturma_ms: number | null;
  baslangic_ms: number;
  bitis_ms: number | null;
  /** `out.jsonl`'de işlenmiş bayt. Yarım satır dahil değildir. */
  out_ofset: number;
  rapor: IsRaporu | null;
  rapor_kaynak: RaporKaynagi | null;
  /** Son `result`'ın özeti. Bitiş sınıflaması çıkışta bundan yapılır. */
  son_result: IsSonResult | null;
  durdurma: BitisNedeni | null;
}

export interface IsSonResult {
  is_error: boolean;
  metin_limit_onekli: boolean;
  structured_bos: boolean;
  structured_output: unknown;
}

export interface IsPidKaydi extends SurecKimligi {
  is_id: IsNo;
  ad: string;
  ilk_gorulme_ms: number;
}

export type SoruDurumu = "bekliyor" | "cevaplandi" | "zaman_asimi" | "iptal";

export interface SoruKaydi {
  soru_id: string;
  is_id: IsNo;
  soru: string;
  secenekler: readonly string[] | null;
  durum: SoruDurumu;
  cevap: string | null;
  olusturma_ms: number;
  son_ms: number;
}

export type ErenKuyrukKaynagi = "insan" | "sentetik";

export interface ErenKuyrukSatiri {
  id: number;
  /** Dilim 2 (`eren_kuyrugu.sohbet_id`). */
  sohbet_id: SohbetId;
  kaynak: ErenKuyrukKaynagi;
  metin: string;
  olusturma_ms: number;
}

export type CihazPlatformu = z.infer<typeof PairRequest>["platform"];

export interface CihazKaydi {
  device_id: string;
  /** SPKI DER, standart base64. Özel anahtar PC'ye hiç gelmez. */
  public_key: string;
  tailscale_ip: string;
  platform: CihazPlatformu;
  etiket: string | null;
  eslesme_ms: number;
}

export interface EslestirmeKaydi {
  kod_ozeti: string;
  son_ms: number;
  yanlis_deneme: number;
}

export interface KonusmaSatiri {
  rol: "kullanici" | "eren";
  metin: string;
  ts_ms: number;
  /** Yalnız kısayol kökenli kullanıcı satırında: ana oturuma önekli gitmişti (`input:"kisayol"`, `baglam` varsa). */
  kisayol?: { baglam?: { paket: string; ad: string } };
}

/**
 * Dilim 2: `eren` kapsamı `{rol, sohbet_id, nesil}` (M1). `kopru_jetonlari.sohbet_id` yalnız `eren`
 * satırında dolu; `sohbet_id`'si NULL eski `eren` satırı `ANA_SOHBET_ID` okunur. Kapsam eşitliği
 * (iptal, tek bağlantı) bütün alanlarla.
 */
export type JetonKapsami =
  | { rol: "eren"; sohbet_id: SohbetId; nesil: number }
  | { rol: "soru"; is_id: IsNo }
  | { rol: "telefon"; is_id: IsNo; plan_id: string; plan_hash: string };

export interface JetonKaydi {
  ozet: string;
  kapsam: JetonKapsami;
}

/** `ack` mesajının kalıcı gövdesi: aynı `client_msg_id` aynı cevabı alır. */
export interface AckGovdesi {
  ok: boolean;
  seq?: number;
  code?: HataKodu;
}

export interface KirliOkumaKaydi {
  is_id: IsNo;
  /** Dilim 2 (`kirli_okumalar.sohbet_id`): okuyan ana oturumun sohbeti (`kirli_okundu.sohbet_id`). */
  sohbet_id: SohbetId;
  nesil: number;
  ts_ms: number;
}

/** Mezar taşı olayı: geçmiş silindi. `sinir_seq < seq` her zaman. Dilim 2: `sohbet_id` hep dolu yazılır. */
export type MezarTasiOlayi = Extract<Olay, { type: "chat_cleared" }>;
/** Dilim 2. Sohbet silindi olayı (`chat_deleted`): `Depo.sohbetiSil` yazar, hiç silinmez. */
export type SohbetSilindiOlayi = Extract<Olay, { type: "chat_deleted" }>;

/** Dilim 1. `Depo.gecmisiTemizle` sonucu. Günlüğe yalnız sayılar yazılır. Dilim 2: sayılar o sohbetindir. */
export interface GecmisTemizlemeSonucu {
  /** Aynı işlemde yazılan mezar taşı; `mezar.seq` `ack.seq` olur. */
  mezar: MezarTasiOlayi;
  silinen_olay: number;
  /** Kısmi metni boşaltılan kapalı tur sayısı. */
  bosaltilan_tur: number;
  /** Silinen kuyruk satırı sayısı: o sohbetin `eren_kuyrugu` satırlarının tamamı (insan ve sentetik). */
  silinen_kuyruk: number;
}

/** Dilim 2. `Depo.sohbetiSil` sonucu. Günlüğe yalnız sayılar yazılır. */
export interface SohbetSilmeSonucu {
  /** Aynı işlemde yazılan `chat_deleted`; `silindi.seq` `ack.seq` olur. */
  silindi: SohbetSilindiOlayi;
  silinen_olay: number;
  bosaltilan_tur: number;
  silinen_kuyruk: number;
}

/** Dilim 2. `sohbetler` tablosunun satırı (ek göç 3). `ad` kullanıcı metnidir: günlüğe yazılmaz. */
export interface SohbetKaydi {
  sohbet_id: SohbetId;
  /** `SohbetAdi` (`@eren/protocol`); depo yazarken şemadan geçirir. */
  ad: string;
  olusturma_ms: number;
  /** Son insan mesajı ya da tur kapanışı. Açılışta hangi sohbetlerin süreci açılacağını sıralar. */
  son_etkinlik_ms: number;
  /** `null`: silinmemiş. Silinmiş kimlik bir daha kullanılmaz (satır kalır). */
  silinme_ms: number | null;
}

/** Tüketim. Satırın kaynağı: sohbet turu (`konusma.ts`) ya da iş (`isler.ts`). */
export type TuketimKaynagi = "sohbet" | "is";
/** `model_farki`: `ModelKullanimi` farkından; `ana_usage`: fark alanı yokken `usage` yedeği. */
export type TuketimOlcumu = "model_farki" | "ana_usage";

/**
 * Tüketim. `tuketim` tablosunun satırı (ek göç 4), `id` hariç: sonuç başına model başına bir satır.
 * Yalnız sayı ve kimlik, içerik yok: `gecmisiTemizle`/`sohbetiSil` dokunmaz.
 */
export interface TuketimKaydi {
  /** Servisin satırı işlediği an. */
  ts_ms: number;
  kaynak: TuketimKaynagi;
  sohbet_id: SohbetId;
  /** Yalnız `kaynak: "is"`. */
  is_id: IsNo | null;
  /** Yalnız `kaynak: "sohbet"`; tursuz sonuçta (arka plan bildirimi) `null`. */
  turn_id: string | null;
  /** Yalnız `kaynak: "sohbet"`. */
  nesil: number | null;
  rol: "normal" | "devir_istek" | "devir_ilk" | null;
  /** `"bilinmiyor"` olabilir. */
  model: string;
  girdi: number;
  cache_yazma: number;
  cache_okuma: number;
  cikti: number;
  /** `null`: bilinmiyor. */
  maliyet_usd: number | null;
  olcum: TuketimOlcumu;
}

/** Tüketim. `usage_report`'un servis tarafı: zarf ve istek alanları `gateway`'indir. */
export type TuketimOzeti = Omit<
  z.infer<typeof UsageReport>,
  "v" | "type" | "istek_id" | "olcum_ms" | "gun_baslangic_ms"
>;

/**
 * Dilim 1. `user_version` (`depo.ts` `SURUM`) 1'de kalır ve yalnız geriye uyumsuz göçte artar.
 * Geriye uyumlu (yalnız ekleme) göçler `sema_ek` tablosunda `anahtar='ek_surum'` ile sayılır.
 * Dilim 2: ek sürüm 3 = çoklu sohbet (MODULLER.md "Dilim 2" > "Şema").
 */
export interface SemaBilgisi {
  user_version: number;
  ek_surum: number;
}

/**
 * Eşzamanlı (`node:sqlite`). Kırılabilecek her çoklu yazım `islem` içinde.
 *
 * Dilim 2 kuralı: `sohbet: SohbetSecimi` zorunlu olan işlev yalnız o sohbetin satırlarına dokunur;
 * `sohbet?: SohbetSecimi` isteğe bağlı olan (yalnız okuma) verilmezse bütün sohbetleri okur. Kayıt
 * tiplerindeki `sohbet_id` zorunludur ve sütuna yazılır. `ANA_SOHBET_ID` için `events.sohbet_id IS NULL`
 * satırlar da o sohbetin sayılır (yalnız `gecmisiTemizle` ve `sonMezarTasi`).
 */
export interface Depo {
  islem<T>(f: () => T): T;
  kapat(): void;

  /**
   * Dilim 2: `events.sohbet_id` sütunu `girdi.sohbet_id ?? NULL` (JSON gövdesindeki alanla aynı).
   * Sohbete bağlı her olay `sohbet_id` ile yazılır, `ana` dahil; alansız yalnız `system_notice`
   * olabilir (küresel not). Başka türde `sohbet_id` yoksa ATAR: unutulan çağrı testte görünür.
   */
  olayEkle(girdi: OlayGirdisi): Olay;
  /** `sonSeq`'ten büyükler, artan. Küresel (tek `seq`, tek telafi). */
  olaylariGetir(sonSeq: number, adet: number): Olay[];
  /** Küresel `head_seq`. */
  basSeq(): number;
  /** `user_echo` ve `assistant_message`, eskiden yeniye, yalnız o sohbetin. Rapor ve soru cevabı içermez. */
  sonKonusma(adet: number, sohbet: SohbetSecimi): KonusmaSatiri[];

  ackBul(device_id: string, client_msg_id: string): AckGovdesi | null;
  ackYaz(device_id: string, client_msg_id: string, ack: AckGovdesi): void;

  /** `tur.sohbet_id` sütuna. */
  turEkle(tur: TurKaydi): void;
  /** Telefonda görünen yarım metin. Saniyede en çok bir kez çağrılır. */
  turKismiYaz(turn_id: string, kismi_metin: string): void;
  turBitir(turn_id: string, bitis: TurBitisi, kismi_metin: string, ms: number): void;
  turGetir(turn_id: string): TurKaydi | null;
  /** Dilim 2: yalnız o sohbetin açık turları. */
  acikTurlar(sohbet: SohbetSecimi): TurKaydi[];

  /** `nesil.sohbet_id` sütuna. */
  nesilEkle(nesil: NesilKaydi): void;
  nesilGuncelle(nesil: number, alanlar: Partial<Omit<NesilKaydi, "nesil" | "sohbet_id">>): void;
  /** Dilim 2: o sohbetin en büyük numaralı nesli. */
  sonNesil(sohbet: SohbetSecimi): NesilKaydi | null;
  /** Dilim 1; dilim 2'de o sohbetin bütün nesilleri, `nesil` artan: transkript silmede oturum kimlikleri. */
  nesiller(sohbet: SohbetSecimi): NesilKaydi[];
  /** Dilim 2. `COALESCE(MAX(nesil), 0)` bütün sohbetlerde: `nesilAyir` sayacının tohumu. */
  enBuyukNesil(): number;

  /** `kayit.profil` `planlar.profil`, `kayit.sohbet_id` `planlar.sohbet_id` sütununa; plan JSON'una değil. */
  planEkle(kayit: PlanKaydi): void;
  planGetir(plan_id: string): PlanKaydi | null;
  planGuncelle(plan_id: string, durum: PlanDurumu, is_id: IsNo | null): void;
  /** `bekliyor` ve `izin_bekliyor`. Dilim 2: `sohbet` verilirse yalnız o sohbetin, verilmezse hepsi. */
  bekleyenPlanlar(sohbet?: SohbetSecimi): PlanKaydi[];

  /** Tek artan tam sayı verir: `isler\<id>`. `kayit.sohbet_id` sütuna. */
  isEkle(kayit: Omit<IsKaydi, "is_id">): IsNo;
  isGuncelle(is_id: IsNo, alanlar: Partial<Omit<IsKaydi, "is_id" | "sohbet_id">>): void;
  isGetir(is_id: IsNo): IsKaydi | null;
  isPlanaGore(plan_id: string): IsKaydi | null;
  /** Dilim 2: `sohbet` verilirse yalnız o sohbetin işleri, verilmezse hepsi. */
  isListele(yalnizAktif: boolean, adet: number, sohbet?: SohbetSecimi): IsKaydi[];

  isPidEkle(kayit: IsPidKaydi): void;
  isPidleri(is_id: IsNo): IsPidKaydi[];

  soruEkle(kayit: SoruKaydi): void;
  soruGetir(soru_id: string): SoruKaydi | null;
  soruGuncelle(soru_id: string, durum: SoruDurumu, cevap: string | null): void;
  /**
   * `bekliyor` sorular. Süzgeç: sayı ise o işin; Dilim 2: `{sohbet_id}` ise işi o sohbete ait olanlar
   * (`sorular` ⋈ `isler.sohbet_id`; sorunun kendi sütunu yok); verilmezse hepsi.
   */
  bekleyenSorular(suzgec?: IsNo | SohbetSecimi): SoruKaydi[];

  /** Dilim 2: satır o sohbetin kuyruğuna. */
  kuyrugaEkle(kaynak: ErenKuyrukKaynagi, metin: string, ms: number, sohbet: SohbetSecimi): number;
  kuyrukBasi(sohbet: SohbetSecimi): ErenKuyrukSatiri | null;
  /** Bastan gelen ardışık `sentetik` satırlar: tek satırda birleştirmek için. Yalnız o sohbetin. */
  kuyrukSentetikBasi(adet: number, sohbet: SohbetSecimi): ErenKuyrukSatiri[];
  kuyruktanSil(idler: readonly number[]): void;

  cihazEkle(kayit: CihazKaydi): void;
  cihazGetir(device_id: string): CihazKaydi | null;
  cihazlar(): CihazKaydi[];

  eslestirmeYaz(kayit: EslestirmeKaydi): void;
  eslestirmeOku(): EslestirmeKaydi | null;
  eslestirmeYanlisSay(): void;
  eslestirmeSil(): void;

  /** Dilim 2: `eren` kapsamının `sohbet_id`'si `kopru_jetonlari.sohbet_id`'ye. */
  jetonEkle(kayit: JetonKaydi): void;
  /** Dilim 2: `eren` satırında `sohbet_id` NULL ise (eski satır) `ANA_SOHBET_ID`. */
  jetonBul(ozet: string): JetonKaydi | null;
  /** Kapsamın bütün alanları eşit satırlar; `eren`+`ana` kapsamı NULL `sohbet_id`'li eski satırları da siler. */
  jetonlariSil(kapsam: JetonKapsami): void;
  /** Dilim 2. Bütün `eren` satırları (her sohbet, her nesil); silinen sayısı. Yalnız `KopruSunucu.erenJetonlariniSil`. */
  erenJetonlariniSil(): number;

  kirliOkumaEkle(kayit: KirliOkumaKaydi): void;
  /** `nesil >= enAzNesil` ve (dilim 2) yalnız o sohbetin okumaları; yeniden eskiye, yinelenmesiz. */
  kirliOkumalar(enAzNesil: number, sohbet: SohbetSecimi): IsNo[];

  // Dilim 1: geçmişi sil. Uygulama: depo.ts. MODULLER.md "depo", "Dilim 1"; dilim 2: "Dilim 2" > "depo".

  /**
   * Tek işlem (`islem` içinden de çağrılabilir; en dıştaki işlem bitince yayın olur), YALNIZ o sohbet:
   * (1) `sinir_seq = basSeq()` (küresel), silmeden önce; (2) o sohbetin `SILINMEZ_OLAY_TURLERI` dışındaki
   * `seq <= sinir_seq` bütün `events` satırları silinir (`ana` için `sohbet_id IS NULL` satırlar da);
   * (3) o sohbetin kapalı turlarının (`bitis_ms` dolu) `kismi_metin`'i boşaltılır, satırları kalır;
   * (4) o sohbetin `eren_kuyrugu` satırlarının hepsi silinir (insan ve sentetik); (5)
   * `olayEkle({type:"chat_cleared", sohbet_id, sinir_seq})`. Başka sohbetlerin satırlarına ve `isler,
   * planlar, sorular, nesiller, acklar, is_pidleri, cihazlar, kopru_jetonlari, kirli_okumalar,
   * eren_oturumlari, sohbetler` tablolarına dokunulmaz. `seq` AUTOINCREMENT olduğu için mezar taşı her
   * zaman en yenidir, `head_seq` gerilemez. Hata atarsa işlem geri alınır, hiçbir şey silinmez.
   */
  gecmisiTemizle(sohbet: SohbetSecimi): GecmisTemizlemeSonucu;
  /**
   * O sohbetin (`ana` için `sohbet_id IS NULL` dahil) en büyük `seq`'li mezar taşı ya da `null`.
   * `konusma` her `--resume` kararında okur (`events(sohbet_id, seq)` / `events(type)` dizinli).
   */
  sonMezarTasi(sohbet: SohbetSecimi): MezarTasiOlayi | null;
  /**
   * `PRAGMA wal_checkpoint(TRUNCATE)`, sonra `VACUUM`, sonra yeniden `wal_checkpoint(TRUNCATE)`:
   * silinen içerik ne WAL'da ne veritabanı dosyasının boş sayfalarında ve sayfa boşluklarında kalsın
   * (`secure_delete` açılmadan önce yazılıp silinenler dahil). İşlem DIŞINDA çağrılır; işlem içindeyse
   * atar. Okuyucu ya da ikinci süreç yüzünden bir adım yapılamazsa atmaz, günlüğe yazar.
   */
  walDaralt(): void;
  /** `user_version` ve `sema_ek.ek_surum`. */
  semaBilgisi(): SemaBilgisi;

  /**
   * Ana oturum kimlikleri (`eren_oturumlari`, ek göç 2; dilim 2'de `sohbet_id` sütunu): transkripti
   * silinecek her ana oturum, nesil kaydı olmasa da (başarısız devir adayı). Servis yeniden başlasa da
   * unutulmaz. Uygulama: depo.ts; kullanan: konusma.ts (kaydeder, okur), temizlik.ts (siler).
   */
  /** İdempotent: aynı `session_id` ikinci kez yazılmaz, ilk `ts_ms` ve sohbet korunur. */
  oturumKaydet(session_id: string, ts_ms: number, sohbet: SohbetSecimi): void;
  /** O sohbetin kayıtlı oturum kimlikleri, `olusturma_ms` artan (eşitlikte yazılış sırası). */
  kayitliOturumlar(sohbet: SohbetSecimi): readonly string[];
  /** Verilenleri tek işlemde siler; kayıtlı olmayan kimlik ve boş liste sessizce geçer. */
  oturumKayitlariniSil(ids: readonly string[]): void;

  // Dilim 2: sohbetler tablosu. Uygulama: depo.ts. Yazan: sohbetler.ts (ekle, ad), konusma.ts
  // (etkinlik), temizlik.ts (sil). MODULLER.md "Dilim 2" > "depo".

  /**
   * `kayit.ad` `SohbetAdi.parse`'tan geçer (uymazsa atar). Kimlik varsa (silinmiş dahil) ATAR:
   * idempotentlik ve silinmiş kimlik kuralı çağıranındır (`SohbetYoneticisi.olustur`). Olay yazmaz.
   */
  sohbetEkle(kayit: Omit<SohbetKaydi, "silinme_ms">): void;
  /** Silinmiş dahil; yoksa `null`. */
  sohbetGetir(sohbet: SohbetSecimi): SohbetKaydi | null;
  /**
   * Silinmemiş sohbetler, `olusturma_ms` artan (eşitlikte yazılış sırası). Sınır sayımı bundan.
   * `silinenlerDahil`: silinmişler de (yalnız `sohbetler.baslat`'ın sahipsiz süreç taraması).
   */
  sohbetListesi(silinenlerDahil?: boolean): SohbetKaydi[];
  /** `ad` `SohbetAdi.parse`'tan geçer. Silinmiş ya da olmayan sohbette atar. Olay yazmaz. */
  sohbetAdiYaz(sohbet: SohbetSecimi, ad: string): void;
  /** `son_etkinlik_ms = max(eski, ms)`. Olmayan sohbette sessiz (günlükte uyarı). */
  sohbetEtkinlikYaz(sohbet: SohbetSecimi, ms: number): void;
  /**
   * Tek işlem (`islem` içinden de çağrılabilir), `gecmisiTemizle` gibi ama: (1) `ANA_SOHBET_ID`,
   * olmayan ya da zaten silinmiş sohbette ATAR (ön koşul çağıranındır, bu yalnız savunma); (2) o
   * sohbetin `SILINMEZ_OLAY_TURLERI` dışındaki BÜTÜN `events` satırları silinir; (3) kapalı turların
   * `kismi_metin`'i boşaltılır; (4) o sohbetin kuyruğu silinir; (5) `sohbetler.silinme_ms = ms`;
   * (6) `olayEkle({type:"chat_deleted", sohbet_id})`. `chat_cleared` YAZILMAZ. `isler, planlar,
   * sorular, nesiller, kirli_okumalar, eren_oturumlari` satırları kalır (iş kaydı ilkesi; oturum
   * kayıtları transkript silinince `temizlik` siler). Hata atarsa işlem geri alınır.
   */
  sohbetiSil(sohbet: SohbetSecimi, ms: number): SohbetSilmeSonucu;

  // Tüketim: `tuketim` tablosu (ek göç 4). Uygulama: depo.ts. Yazan: isler.ts, konusma.ts; okuyan:
  // gateway.ts (`usage_request`).

  /** Tek işlem; boş liste sessiz. `islem` içinden çağrılabilir (iş: `out_ofset` ile aynı işlemde). */
  tuketimEkle(kayitlar: readonly TuketimKaydi[]): void;
  /** Bugün, son 7 gün (bugün dahil), sohbet başına ve son `isAdet` iş toplamı. */
  tuketimOzeti(g: { gunBaslangicMs: number; yediGunBaslangicMs: number; isAdet: number }): TuketimOzeti;
}

export interface DepoBagimliliklari {
  /** `:memory:` testlerde. */
  yol: string;
  saat: SaatPortu;
  /** CLI gibi yayıncısız kullanımda yok: `olay_yazildi` yayınlanmaz. */
  veriyolu?: Veriyolu;
  gunluk: Gunluk;
  /**
   * `ana` sohbeti göçle YENİ oluşturulursa adı (servis: `Ayar.asistanAdi`). Verilmezse protokoldeki
   * `ANA_SOHBET_ADI`. Mevcut satırın adı değişmez.
   */
  anaSohbetAdi?: string;
}

export type DepoFabrikasi = (b: DepoBagimliliklari) => Depo;

// ---------------------------------------------------------------------------------------------
// kilit: limit kilidi dosyası
// ---------------------------------------------------------------------------------------------

export interface LimitKilidi {
  /** İlk okumayı yapar, sonra yoklar. Başlatma kararı veren her şeyden önce çağrılır. */
  baslat(): Promise<void>;
  durum(): LimitKilitDurumu;
  /** Yalnız `serbest` iken `true`. Ana oturum ve iş başlatmanın tek kapısı. */
  baslatmaSerbestMi(): boolean;
  kapat(): void;
}

export interface KilitBagimliliklari {
  ayar: Pick<Ayar, "yollar" | "sureler">;
  depo: Pick<Depo, "olayEkle">;
  dosya: DosyaPortu;
  saat: SaatPortu;
  zamanlayici: ZamanlayiciPortu;
  veriyolu: Veriyolu;
  gunluk: Gunluk;
}

export type KilitFabrikasi = (b: KilitBagimliliklari) => LimitKilidi;

// ---------------------------------------------------------------------------------------------
// kopru-sunucu: adlandırılmış boru
// ---------------------------------------------------------------------------------------------

/** `kopru_hello` sonrası bağlantıya bağlı kimlik. Yalnız jetondan türer. */
export type KopruBaglami = JetonKapsami;
/**
 * Dilim 2. Ana oturum köprüsünün bağlamı: `sohbet_id` ve `nesil` buradan okunur, planın, iş görünürlüğünün
 * ve devir özetinin sahibi budur (M4). Fiil girdisinden sohbet okunmaz.
 */
export type ErenKopruBaglami = Extract<KopruBaglami, { rol: "eren" }>;

export type FiilSonucu<F extends KopruFiili> = Sonuc<FiilCiktisi<F>>;

/** `sinyal.reason`: model `iptal` yolladı mı, boru mu koptu. Soru için fark eder. */
export type KopruIptalNedeni = "model_iptal" | "baglanti_koptu";

/** Köprü fiili başına işleyici. Boruda kullanıcı mesajı fiili yoktur, burada da yoktur. */
export type FiilIsleyici<F extends KopruFiili> = (
  girdi: FiilGirdisi<F>,
  baglam: KopruBaglami,
  sinyal: AbortSignal,
) => Promise<FiilSonucu<F>>;

export type FiilIsleyiciler = { readonly [F in KopruFiili]: FiilIsleyici<F> };

export interface KopruSunucu {
  /** Düz jetonu verir, depoya yalnız özetini yazar. Düz hali günlüğe ve depoya girmez. */
  jetonUret(kapsam: JetonKapsami): string;
  /** Depodan siler ve o kapsamın (bütün alanlar eşit) açık bağlantılarını kapatır. */
  jetonlariIptalEt(kapsam: JetonKapsami): void;
  /**
   * Dilim 2. Uygulama: kopru-sunucu.ts, çağıran sohbetler.ts (açılışta, hiçbir örnek süreç açmadan
   * önce). `depo.erenJetonlariniSil()` + açık her `eren` bağlantısını kapatır: önceki ömürden kalan
   * nesil mcp dosyalarındaki jetonlar ölü olsun. `soru`/`telefon` jetonlarına dokunmaz (servis yeniden
   * başlasa da geçerli kalırlar). Silinen sayısını döner (günlüğe yalnız sayı).
   *
   * Tek bağlantı kuralı (M1, gerçekleme `kopru_hello` işleyicisinde): `eren` rolünde, aynı kapsamla
   * (`sohbet_id` + `nesil`) el sıkışmış açık bir bağlantı varken gelen ikinci `kopru_hello`
   * `kopru_ret{code:"jeton_gecersiz"}` + kapat (günlük `neden:"jeton_kullanimda"`); açık olan sürer.
   */
  erenJetonlariniSil(): number;
  /** İşleyiciler geç bağlanır: modüller jeton için bu nesneye, köprü işleyici için onlara muhtaç. */
  baslat(isleyiciler: FiilIsleyiciler): Promise<void>;
  kapat(): Promise<void>;
}

export interface KopruSunucuBagimliliklari {
  boru: BoruSunucuPortu;
  depo: Pick<Depo, "jetonEkle" | "jetonBul" | "jetonlariSil" | "erenJetonlariniSil">;
  rastgele: RastgelePortu;
  anahtar: Pick<AnahtarPortu, "sabitZamanEsit">;
  /** İlk mesaj bekleme süresi (10 sn) için; `setTimeout` yasak. */
  zamanlayici: Pick<ZamanlayiciPortu, "sonra">;
  gunluk: Gunluk;
}

export type KopruSunucuFabrikasi = (b: KopruSunucuBagimliliklari) => KopruSunucu;

// ---------------------------------------------------------------------------------------------
// kopru: stdio MCP köprüsü (ayrı süreç) ve telefon metni sarma
// ---------------------------------------------------------------------------------------------

export interface KopruIstemciAyari {
  rol: KopruRolu;
  /** `EREN_KOPRU_JETON` ortam değişkeninden. Argümanda taşınmaz. */
  jeton: string;
  boruAdi: string;
}

export type EkranMetniKurucu = (
  sonuc: CmdSonucu,
  rastgele: Pick<RastgelePortu, "hex64">,
) => string;

// ---------------------------------------------------------------------------------------------
// cihaz: `/cihaz` kanalı
// ---------------------------------------------------------------------------------------------

/** Kimliği doğrulanmış `/cihaz` bağlantısı. Yalnız `gateway` üretir. */
export type DogrulanmisCihazBaglantisi = Markali<
  { baglanti: WsBaglantisi; device_id: string },
  "dogrulanmis-cihaz"
>;

/** Jeton dışı izin bilgisi. Jeton `cihaz` belleğinden çıkmaz. */
export interface IzinKaydi {
  grant_id: string;
  plan_id: string;
  plan_hash: string;
  mod: IzinModu;
  uygulamalar: readonly string[];
}

export type KomutHatasi = Extract<
  HataKodu,
  "telefon_bagli_degil" | "belirsiz" | "limit_kilitli" | "izin_bekleniyor"
>;

export interface CihazYoneticisi {
  baglandi(b: DogrulanmisCihazBaglantisi): void;
  bagliMi(): boolean;
  /** Tek deneme. Kuyruğa girmez, yeniden denenmez. Kapının reddi `ok:true`, `denied` taşır. */
  komut<A extends CmdAdi>(
    baglam: Extract<KopruBaglami, { rol: "telefon" }>,
    ad: A,
    args: CmdArgumani<A>,
    sinyal: AbortSignal,
  ): Promise<Sonuc<CmdSonucu, KomutHatasi>>;
  izinBul(plan_id: string, plan_hash: string): IzinKaydi | null;
  /** `grant_id: null`: telefondaki bütün izinler. Kopuksa belleği temizler, `false` döner. */
  izinGeriCek(grant_id: string | null, neden: GrantNedeni): boolean;
  uygulamalar(): UygulamalarCiktiTipi;
  /** Kopuksa `null`. Kuyruk yok. */
  bildir(girdi: Omit<NotifyMesaji, "v" | "type" | "notify_id">): string | null;
  /** `notify_ack` geldiyse `true`. */
  bildirimOnaylandiMi(notify_id: string): boolean;
  kapat(): void;
}

export type UygulamalarCiktiTipi = z.infer<typeof UygulamalarCikti>;

export interface CihazBagimliliklari {
  ayar: Pick<Ayar, "sureler">;
  saat: SaatPortu;
  zamanlayici: ZamanlayiciPortu;
  rastgele: RastgelePortu;
  veriyolu: Veriyolu;
  depo: Pick<Depo, "olayEkle">;
  gunluk: Gunluk;
}

export type CihazFabrikasi = (b: CihazBagimliliklari) => CihazYoneticisi;

// ---------------------------------------------------------------------------------------------
// isler: iş oturumları ve sorular
// ---------------------------------------------------------------------------------------------

export interface RamOzeti {
  bosMb: number;
  toplamMb: number;
  dusuk: boolean;
}

export interface IsBaslatmaIstegi {
  plan: Plan;
  plan_hash: string;
  /**
   * Dilim 1. Uygulama: planlar.ts verir (depodaki `PlanKaydi.profil`), isler.ts + isler-komut.ts
   * kullanır: PC komutunu seçer (`pcArgv`'ye profil girdisi) ve `job_started.profil`'e yazılır.
   * `tur:"telefon"` planında yok sayılır: telefon profili değişmez, `job_started`'ta alan yazılmaz.
   */
  profil: IsProfili;
  /**
   * Dilim 2. `planlar` depodaki `PlanKaydi.sohbet_id`'yi verir (bellekten değil). `isler` bunu
   * `IsKaydi.sohbet_id`'ye ve işin bütün olaylarına (`job_*`, `question_*`, `is_*`, `soru_durumu`) yazar.
   */
  sohbet_id: SohbetId;
}

export type IsBaslatmaHatasi = Extract<HataKodu, "limit_kilitli" | "ic_hata">;

export interface UzlastirmaOzeti {
  sahiplenilen: number;
  biten: number;
}

export interface IsYoneticisi {
  /** Açılışta bir kez, ana oturum başlamadan önce. */
  uzlastir(): Promise<UzlastirmaOzeti>;
  /** Yalnız `planlar` çağırır, onaylanan planın kendisiyle. Depodaki plan esastır. */
  baslat(istek: IsBaslatmaIstegi): Promise<Sonuc<IsNo, IsBaslatmaHatasi>>;
  /**
   * Dilim 2: `sahip` verilirse (ana oturumun `oturum_durdur`'u, jeton kapsamından) iş o sohbetin değilse
   * `is_bulunamadi`, hiçbir şey durmaz (M4). Verilmezse süzgeç YOK: kullanıcı (`job_cancel`), izin
   * geri çekme ve kilit tepkisi her işi durdurabilir. `"ana"` varsayılanı yoktur.
   */
  durdur(
    is_id: IsNo,
    neden: Exclude<BitisNedeni, "dogal">,
    sahip?: SohbetSecimi,
  ): Promise<Sonuc<z.infer<typeof OturumDurdurCikti>, "is_bulunamadi">>;
  /** Dilim 2: yalnız o sohbetin işleri (ana oturum kendi sohbetininkini görür, M4). Çağıran yalnız `ana` fiil eşlemesi. */
  oturumlar(girdi: z.infer<typeof OturumlarGirdi>, sohbet: SohbetSecimi): z.infer<typeof OturumlarCikti>;
  /**
   * Dilim 2: iş `sohbet`'in değilse `is_bulunamadi` (gövde okunmaz, `kirli_okundu` yayınlanmaz). Kirli
   * işte `kirli_okundu{is_id, sohbet_id: sohbet.sohbet_id}`: okuyanın sohbeti.
   */
  raporOku(is_id: IsNo, sohbet: SohbetSecimi): Sonuc<z.infer<typeof RaporOkuCikti>, "is_bulunamadi" | "rapor_yok">;
  raporVer(
    is_id: IsNo,
    rapor: IsRaporu,
  ): Sonuc<z.infer<typeof RaporVerCikti>, "is_bulunamadi" | "rapor_zaten_verildi" | "is_zaten_bitti">;
  soruSor(
    is_id: IsNo,
    girdi: z.infer<typeof SoruBoruGirdi>,
    sinyal: AbortSignal,
  ): Promise<Sonuc<KullaniciyaSorCikti, "is_zaten_bitti" | "limit_kilitli">>;
  soruBekle(
    is_id: IsNo,
    girdi: z.infer<typeof SoruBekleGirdi>,
    sinyal: AbortSignal,
  ): Promise<Sonuc<KullaniciyaSorCikti, "soru_bulunamadi">>;
  /** Cevap doğrudan bekleyen fiile gider. Metin `konusma`'ya hiçbir yoldan ulaşmaz. */
  soruCevapla(
    soru_id: string,
    cevap: string,
  ): Sonuc<void, "soru_bulunamadi" | "soru_zaten_cevaplandi">;
  /** Dilim 2: `sohbet` verilirse o sohbetin aktif işleri (`temizlik` ön koşulu), verilmezse hepsi (`server_status.aktif_is`). */
  aktifSayisi(sohbet?: SohbetSecimi): number;
  ram(): RamOzeti;
  kapat(): void;
}

export interface IslerBagimliliklari {
  ayar: Ayar;
  depo: Depo;
  kilit: Pick<LimitKilidi, "baslatmaSerbestMi" | "durum">;
  kopru: Pick<KopruSunucu, "jetonUret" | "jetonlariIptalEt">;
  akis: AkisYardimcilari;
  surec: SurecPortu;
  dosya: DosyaPortu;
  sistem: SistemPortu;
  saat: SaatPortu;
  zamanlayici: ZamanlayiciPortu;
  rastgele: RastgelePortu;
  veriyolu: Veriyolu;
  gunluk: Gunluk;
}

export type IslerFabrikasi = (b: IslerBagimliliklari) => IsYoneticisi;

// ---------------------------------------------------------------------------------------------
// planlar
// ---------------------------------------------------------------------------------------------

export type PlanOnerHatasi = Extract<HataKodu, "plan_gecersiz">;

export type PlanKararHatasi = Extract<
  HataKodu,
  | "plan_bulunamadi"
  | "plan_hash_uyusmuyor"
  | "plan_zaten_sonuclandi"
  | "izin_bekleniyor"
  | "limit_kilitli"
  | "ic_hata"
>;

export interface PlanYoneticisi {
  /**
   * Kart doğurur. PC planı tam yetkide ya da çağrı anında `insanTuru()` doluysa (ve plan kirli değilse)
   * kartla birlikte `karar`'ın onay yolundan başlatılır. 0.5.0: dönüş planın gerçek durumunu taşır
   * (`PlanOnerCikti`): `basladi` + `is_id`; telefon planında `telefonda_baslatiliyor`; başlamayan PC
   * planında `onay_bekliyor` + `neden` (`PLAN_BEKLEME_NEDENLERI`). Başlatma sonucu ne olursa olsun kart
   * yazılmıştır, öneri başarılıdır.
   * Dilim 1 (uygulama: planlar.ts, çağıran ana.ts): `profil` plan dışıdır. `ana` `plan_oner` girdisini
   * (`PlanOnerGirdi`) `{profil, ...taslak}` diye ayırır, `profil ?? "tam"` verir; `taslak`'ta `profil`
   * olmadığı için plana sızamaz. `planlar` onu `PlanKaydi.profil`'e yazar (telefon planında `tam`).
   *
   * Dilim 2: `sohbet` yalnız `ErenKopruBaglami.sohbet_id`'den (çağıran `ana` fiil eşlemesi); planın
   * sahibi olur (`PlanKaydi.sohbet_id`, `plan_proposed.sohbet_id`). İnsan turu `insanTuru(sohbet)` ile
   * yalnız BU sohbette aranır: A'nın insan turu B'nin önerisini onaysız başlatmaz (M4). Sohbet yoksa ya
   * da silinmişse `plan_gecersiz`, kayıt yok.
   */
  planOner(
    taslak: PlanTaslagi,
    profil: IsProfili,
    sohbet: SohbetSecimi,
  ): Promise<Sonuc<z.infer<typeof PlanOnerCikti>, PlanOnerHatasi>>;
  /**
   * `plan_decision` sohbet taşımaz (plan kimliği küresel tekil): planın sohbeti depodan okunur. Dilim 2:
   * başlatma `isler.baslat({..., sohbet_id: kayit.sohbet_id})`; izin yolu da aynı.
   */
  karar(mesaj: PlanDecisionMesaji): Promise<Sonuc<void, PlanKararHatasi>>;
  /**
   * Dilim 1. Uygulama: planlar.ts, çağıran temizlik.ts. Eşzamanlı, araya `await` girmez; çağıran
   * `depo.islem` içinde, geçmiş silinmeden ÖNCE çağırır. `bekliyor` ve `izin_bekliyor` her plan:
   * `planGuncelle(iptal)`, `plan_resolved{sonuc:"iptal"}`; `izinBul` bir izin verirse
   * `izinGeriCek(grant_id, "is_iptal")`. `plan_sonuclandi` YAYINLANMAZ: ana oturuma sentetik not gitmez,
   * yeni sayfa önceki planı bilmez. İşlem geri alınırsa geri çekilen izin geri gelmez (güvenli yön).
   * İptal edilen plan sayısını döner. Dilim 2: yalnız o sohbetin planları (`bekleyenPlanlar(sohbet)`);
   * çağıranlar `temizlik.gecmisiSil` ve `temizlik.sohbetiSil`.
   */
  bekleyenleriIptal(sohbet: SohbetSecimi): number;
  kapat(): void;
}

export interface PlanlarBagimliliklari {
  depo: Depo;
  isler: Pick<IsYoneticisi, "baslat">;
  kilit: Pick<LimitKilidi, "baslatmaSerbestMi">;
  cihaz: Pick<CihazYoneticisi, "izinBul" | "izinGeriCek">;
  /**
   * O sohbetin etkin nesli (yoksa 0): kirli okumaların süresi buna bağlıdır. Dilim 2: yalnız
   * `SohbetYoneticisi.nesil` bağlanır (`ana`).
   */
  nesil: (sohbet: SohbetSecimi) => number;
  /**
   * Dilim 2: yalnız `SohbetYoneticisi.insanTuru` bağlanır; o sohbetin örneğinin `insanTuru()`'su (örnek
   * yoksa `null`). Verilmezse hiçbir öneri insan turunda sayılmaz: kart onay bekler. Bilgi köprüden,
   * modelden ya da plan alanından gelmez.
   */
  insanTuru?: (sohbet: SohbetSecimi) => string | null;
  /**
   * Dilim 3b: PC tam yetki anahtarı (`ayar.tamYetki`; ana.ts bağlar). Doğruysa her PC planı karar
   * beklemeden başlar (limit kilidi aynen); telefon planları değişmez. Uygulama: planlar.ts.
   */
  readonly tamYetki: () => boolean;
  dosya: Pick<DosyaPortu, "dizinVarMi">;
  rastgele: Pick<RastgelePortu, "opakId">;
  saat: SaatPortu;
  veriyolu: Veriyolu;
  gunluk: Gunluk;
}

export type PlanlarFabrikasi = (b: PlanlarBagimliliklari) => PlanYoneticisi;

// ---------------------------------------------------------------------------------------------
// konusma: ana oturum süreci. Dilim 2: SOHBET BAŞINA BİR ÖRNEK; örnekleri yalnız `sohbetler` kurar ve
// tutar. MODULLER.md "konusma" ve "Dilim 2" > "konusma".
// ---------------------------------------------------------------------------------------------

/**
 * Doğrulanmış `/sohbet` bağlantısından gelen kullanıcı mesajı. Yalnız `gateway` üretir, kimlik
 * doğrulama bittikten sonra. İnsan kökenli satırın tek kaynağı budur: MODULLER.md, `konusma`.
 * Dilim 2: `sohbet_id` `user_message.sohbet_id`'dir; `gateway` mesajı yalnız o sohbetin örneğine verir,
 * örnek kendi `sohbet_id`'sinden farklı olanı ATAR (savunma: yanlış sohbete insan satırı yazılmaz).
 */
export type DogrulanmisInsanMesaji = Markali<
  {
    device_id: string;
    client_msg_id: string;
    sohbet_id: SohbetId;
    input: GirdiYolu;
    text: string;
    /**
     * v4: kısayolun bağlamı (kullanıcının o an baktığı uygulama). Protokol yalnız `input === "kisayol"`
     * iken geçirir; kısayolda da yokluğu geçerlidir. `user_echo`'ya aynen yazılır, ana oturuma önek olur.
     */
    baglam?: KisayolBaglami;
  },
  "dogrulanmis-insan"
>;

export type KesmeHatasi = Extract<HataKodu, "tur_gecersiz" | "eren_hazir_degil">;

export interface AktifTur {
  turn_id: string;
  /** Telefonda görünmüş metin. */
  text: string;
  /**
   * Canlı etkinlik. Turun o anki etkinliği, servis saatiyle başladığı an ve turu başlatan insan mesajının
   * `client_msg_id`'si (insan mesajıyla başlamadıysa `null`); henüz yoksa `null`.
   */
  etkinlik: { etkinlik: AkisEtkinligi; baslangic_ms: number; kaynak_msg_id: string | null } | null;
}

/** Dilim 2. Telafide her canlı tur için bir `stream_snapshot{sohbet_id, turn_id, text}`. */
export interface SohbetAktifTuru extends AktifTur {
  sohbet_id: SohbetId;
}

/** Dilim 2. `Konusma.sonlandir` sonucu; `YeniSayfaSonucu`'nun ortak kısmı. */
export interface SonlandirmaSonucu {
  /**
   * YALNIZ BU SOHBETİN eski ana oturumları: `depo.kayitliOturumlar(sohbet)` ∪ `depo.nesiller(sohbet)`
   * `session_id`'leri; transkriptleri silinir. Yeni neslinki (yeni sayfada) ve iş oturumlarınınki YOKTUR.
   */
  eski_oturumlar: readonly string[];
  /** Eski sürecin çıktığı doğrulandı (`surecVarMi` yanlış ya da süreç yoktu). */
  eski_surec_cikti: boolean;
}

/** Dilim 1. `Konusma.yeniSayfa` sonucu. */
export interface YeniSayfaSonucu extends SonlandirmaSonucu {
  /**
   * Yeni nesil `--session-id` ile açıldı. Kilit serbest değilse ya da (dilim 2) örnek yuva tutmuyorsa
   * (süreci yoktu: `uyuyor`/`sirada`) `false`: sonraki açılış `--session-id` ile yeni oturum açar.
   */
  yeni_nesil_acildi: boolean;
}

/**
 * Dilim 2. Canlı ana oturum sınırı (`Ayar.erenCanliAzami`) ve RAM kapısı. Gerçekleyen `sohbetler`, her örneğe
 * `KonusmaBagimliliklari.kapi` olarak verir. Hepsi eşzamanlı, hiç atmaz.
 *
 * "Yuva" SOHBET BAŞINADIR: örneğin süreci varken, açılırken ya da yeni sayfa/devir sürerken tuttuğu tek
 * birim. Kural: örnek her açılış denemesinden (ilk açılış, uyandırma, kuyruğa satır gelmesi, kilit
 * açılışı, süreç ölünce yeniden başlatma) ÖNCE `yuvaIste` der; süreci, adayı ve süren başlatması
 * kalmadığı an (bilinçli kapatma, ölüm, kilit, red, sonlandırma) `yuvaBirak` der. Yeni sayfa ve devir
 * yuvayı bırakmadan süreç değiştirir.
 */
export interface SurecKapisi {
  /**
   * `true`: açabilirsin, yuva bu sohbete ayrıldı (zaten tutuyorsa yine `true`). `false`: açma; örnek
   * `sirada` durumuna geçer ve bekler, yönetici yer açılınca (FIFO, yuva o sohbete ayrılmış olarak)
   * `Konusma.uyandir()` çağırır. Aynı sohbetin yinelenen isteği sırayı değiştirmez. Ret nedenleri: boş
   * RAM < `ramDusukMb + 768` MB, ya da yuvalar dolu (bu durumda yönetici en uzun süredir boşta olanı,
   * yoksa adaylar içinde en eski etkinlikli olanı `uyut()` ile boşaltmaya başlar; başlatılan ya da
   * yuvayı aldıktan sonra hiç tur tamamlamamış ve turu sürmeyen sohbet aday değildir, aday yoksa
   * isteyen sırada bekler).
   */
  yuvaIste(sohbet: SohbetSecimi): boolean;
  /**
   * Devir adayı açmadan önce. Canlı sınırından muaftır (devir sırasında sohbet geçici +1 kullanır, M1),
   * yalnız RAM kapısı: `false` ise devir başlamaz, sonraki tur sınırında yeniden denenir.
   */
  devirSerbestMi(): boolean;
  /** Yuva boşaldı. Tutmuyorsa etkisiz. Sıradaki sohbete ayrılır. */
  yuvaBirak(sohbet: SohbetSecimi): void;
}

/**
 * Bir sohbetin ana oturumu. Metin alan tek giriş `insanMesajiAl`dır. Sentetik metni `konusma` kendi
 * kalıplarıyla, veriyolu olaylarından kurar (dilim 2: yalnız kendi `sohbet_id`'li olaylardan): başka
 * modül ana oturuma metin yazamaz.
 */
export interface Konusma {
  /** Dilim 2. Bu örneğin sohbeti; kurulumdan (`KonusmaBagimliliklari.sohbet_id`) gelir, değişmez. */
  readonly sohbet_id: SohbetId;
  /**
   * Kurtarma: sahipsiz eski süreç (`sonNesil(sohbet)`), açık turlar `turn_aborted{surec_oldu}`, eski
   * nesil mcp dosyası. Dilim 2: süreç AÇMAZ (sohbet `uyuyor` ya da kuyruk doluysa `sirada`'ya geçmek
   * için yuva ister); süreci açılış sırasına göre `sohbetler` `uyandir()` ile açtırır.
   */
  baslat(): Promise<void>;
  /**
   * Dilim 2. Süreç açmayı dener: `baslat` bitmiş, kapanmamış, kilit serbest, red yok ve süreç (ya da
   * süren başlatma) yoksa `kapi.yuvaIste` EŞZAMANLI olarak, bu çağrının içinde sorulur; `true` ise açılış
   * arkada başlar (`--resume`; nesil yoksa ya da yeni sayfa/mezar taşı varsa `--session-id`). Koşullar
   * tutmuyorsa hiçbir şey yapmaz (yönetici `uyandir` döndüğünde kullanılmamış rezervasyonu düşürür).
   * `baslat` bitmeden çağrılırsa bitince bir kez yeniden dener. Hiç atmaz.
   */
  uyandir(): void;
  /**
   * Dilim 2. Bilinçli kapatma (boşta kalma ya da canlı sınırı). Boştaysa hemen; tur, devir, yeni sayfa ya
   * da başlatma sürüyorsa o bitince, sıradaki kuyruk satırı açılmadan. Servis kararıdır: resume hatası
   * sayılmaz, `eren_yeniden_basladi` yazılmaz, açık tur kalmaz; jeton iptal, nesil mcp dosyası silinir,
   * `yuvaBirak`. Sonra kuyruk boşsa `uyuyor`, doluysa yeniden yuva ister. Süreç çıkınca çözülür.
   */
  uyut(): Promise<void>;
  /**
   * Dilim 2. Süreç hazır ve boştaysa (tur yok, kuyruk boş, devir, yeni sayfa ve başlatma yok) boşa
   * düştüğü an (ms), değilse `null`. `sohbetler` boşta kapatma ve kurban seçimi için okur.
   */
  bostaBeri(): number | null;
  /** Dilim 2: altı değerli (`uyuyor`, `sirada` dahil); her değişimde `eren_durumu{sohbet_id, durum}`. */
  durum(): SohbetErenDurumuTipi;
  aktifTur(): AktifTur | null;
  /** Bu sohbetin etkin (son açılan) nesli; hiç yoksa 0. */
  nesil(): number;
  /**
   * Etkin sürecin açık turu kuyruğun `kaynak=="insan"` satırından başladıysa o turun `turn_id`'si, değilse
   * `null`. Sentetik, birleşik sentetik, kurtarma ve devir turları `null`dır; devir ve kapanış sırasında da.
   */
  insanTuru(): string | null;
  /**
   * `user_echo{sohbet_id}` + kuyruk satırı + `sohbetEtkinlikYaz` tek işlemde. Ana oturum kapalı, kilitli,
   * uyuyor ya da sıradayken de kabul eder; süreç yoksa ardından `uyandir()`. Dilim 2: `mesaj.sohbet_id`
   * bu örneğinkinden farklıysa atar, hiçbir şey yazmaz. Dilim 3b (v4): `user_echo` öneksiz metni ve
   * `baglam`'ı taşır; `input:"kisayol"` ise kuyruk satırına (yalnız ana oturuma) `[telefon kısayolu...]` öneki konur.
   */
  insanMesajiAl(mesaj: DogrulanmisInsanMesaji): { seq: number };
  kes(turn_id?: string): Sonuc<void, KesmeHatasi>;
  /**
   * Dilim 2: `nesil` köprü jetonunun nesli (`ErenKopruBaglami.nesil`). Devir özet beklemiyorsa ya da
   * `nesil` devredilen (eski) neslin numarası değilse `{kabul:false}`: başka sohbetin ya da eski neslin
   * Ana oturumu özet veremez.
   */
  devirOzetiAl(ozet: string, nesil: number): z.infer<typeof DevirOzetiCikti>;
  /**
   * Dilim 1. Uygulama: konusma.ts. Geçmiş şimdi silinebilir mi: açık tur yok (insan, sentetik,
   * birleşik, kurtarma, devir), devir sürmüyor, süreç başlatılmıyor, yeni sayfa, uyutma ya da
   * sonlandırma sürmüyorsa `true`. `hazir`, `kapali`, `uyuyor` ve `sirada` iken `true` olabilir.
   * Eşzamanlı. Dilim 2: yalnız bu sohbet (parametre kalktı).
   */
  temizlenebilirMi(): boolean;
  /**
   * Dilim 1. Uygulama: konusma.ts, çağıran temizlik.ts (geçmiş silindikten sonra). Çağrı anında,
   * ilk `await`'ten önce `sirada` bayrağı sıfırlanır (yuva beklemesi biter; yönetici durum olayından
   * sıradan çıkarır) ve kuyruk durur (sayfa bitene kadar tur açılmaz, `insanMesajiAl` kabul etmeye
   * devam eder) ve `insanTuru()` `null` olur. Sıra: (1) eski süreç yeni açılmadan ÖNCE kapatılır
   * (`stdinKapat`, sonra `agaciOldur`) ve eski neslin `eren` jetonu iptal edilir; (2) çıkışı
   * `surecVarMi` ile doğrulanır; (3) kilit serbestse ve (dilim 2) örnek yuva tutuyorsa yeni `uuid` +
   * `nesilAyir()` + yeni jeton, `--session-id` ile açılır: devir notu, özet ve yarım tur notu YOK, ilk
   * satır yok, kuyruk akar. Yuva tutmuyorsa açılmaz, sonraki açılış yeni oturumdur. Çökme güvenliği
   * `baslat`'tadır: o sohbetin son mezar taşı son neslinin `baslangic_ms`'inden yeniyse `--resume`
   * yapılmaz. Hiç atmaz; başarısızlık sonuçta ve günlükte görünür. Dilim 2: yalnız bu sohbet.
   */
  yeniSayfa(): Promise<YeniSayfaSonucu>;
  /**
   * Dilim 2. Uygulama: konusma.ts, çağıran temizlik.ts (`chat_delete`, `sohbetler.kaldir`'dan sonra).
   * Eşzamanlı ön ek (ilk `await`'ten önce): örnek kalıcı olarak kapanır (sonraki her çağrı `kapat()`
   * sonrası gibi; `insanMesajiAl` atar), veriyolu dinleyicileri iptal, `insanTuru()` `null`, süren devir
   * bırakılır, bütün canlı süreçler `yeniSayfa`'daki gibi kapatılır, etkin neslin (ve adayın) `eren`
   * jetonu iptal. Sonra çıkış doğrulanır, nesil mcp dosyaları silinir, `yuvaBirak`. Açık tur
   * yoktur (ön koşul); varsa `turn_aborted` YAZILMAZ (olaylar silindi). Hiç atmaz.
   */
  sonlandir(): Promise<SonlandirmaSonucu>;
  kapat(): Promise<void>;
}

export interface KonusmaBagimliliklari {
  /** Dilim 2. Bu örneğin sohbeti. Yazdığı her satır ve olay bunu taşır. */
  sohbet_id: SohbetId;
  /** Dilim 2. Canlı sınırı ve RAM kapısı: `sohbetler` verir. */
  kapi: SurecKapisi;
  /**
   * Dilim 2. Tüm sohbetlerde tekil yeni nesil numarası (M1: `MAX(nesil)+1`). `sohbetler` verir: bellek
   * sayacı `max(sayac, depo.enBuyukNesil()) + 1`. Örnek yeni nesil gerektiğinde (ilk açılış, devir,
   * yeni sayfa, resume yerine yeni oturum) TAM o an, eşzamanlı alır; kullanılmayan numara geri verilmez
   * (boşluk zararsız). Kendi `sonNesil + 1` hesabı YASAK: iki örnek aynı numarayı alırdı.
   */
  nesilAyir: () => number;
  ayar: Ayar;
  depo: Depo;
  kilit: Pick<LimitKilidi, "baslatmaSerbestMi">;
  kopru: Pick<KopruSunucu, "jetonUret" | "jetonlariIptalEt">;
  akis: AkisYardimcilari;
  surec: SurecPortu;
  dosya: DosyaPortu;
  saat: SaatPortu;
  zamanlayici: ZamanlayiciPortu;
  rastgele: RastgelePortu;
  veriyolu: Veriyolu;
  gunluk: Gunluk;
}

/** Dilim 2. Bütün örneklerin ortak bağımlılıkları: `sohbetler` bunlara sohbete özgü üçünü ekleyip `konusmaKur`'a verir. */
export type KonusmaOrtakBagimliliklari = Omit<KonusmaBagimliliklari, "sohbet_id" | "kapi" | "nesilAyir">;

export type KonusmaFabrikasi = (b: KonusmaBagimliliklari) => Konusma;

// ---------------------------------------------------------------------------------------------
// sohbetler: sohbet yöneticisi. Dilim 2. Uygulama: sohbetler.ts (`sohbetlerKur`),
// test/sohbetler.test.ts. MODULLER.md "Dilim 2" > "sohbetler".
// Sohbet listesinin, örneklerin, canlı ana oturum sınırının, RAM kapısının ve boşta kapatmanın tek sahibi.
// Kullanıcı mesajı ALMAZ: insan satırının yolu yalnız gateway → örnek; bu modülün dosyasında o yöntemin
// adı bile geçmez (`test/insan-noktasi.test.ts` (c) metin taraması).
// ---------------------------------------------------------------------------------------------

export type SohbetOlusturmaHatasi = Extract<HataKodu, "sohbet_siniri" | "sohbet_bulunamadi" | "ic_hata">;
export type SohbetAdlandirmaHatasi = Extract<HataKodu, "sohbet_bulunamadi" | "ic_hata">;

export interface SohbetIslemSonucu {
  /** Yazılan yaşam döngüsü olayının `seq`'i (`ack.seq`). Yan etkisiz `ok`'ta `null`: `ack`'te `seq` yok. */
  seq: number | null;
}

export interface SohbetYoneticisi {
  /**
   * `ana`'nın açılış adımlarında, dilim 1'deki `konusma.baslat()`'ın yerinde. Örnekler bundan ÖNCE,
   * fabrikada (eşzamanlı) silinmemiş her sohbet için kurulur; `ana` satırı yoksa orada eklenir
   * (`ANA_SOHBET_ADI`, olay yazmadan): açılışta erken yayınlanan `isler_uzlastirildi`/`is_bitti`
   * örneklere ulaşsın. Burada: `kopru.erenJetonlariniSil()`; silinmiş sohbetlerin
   * (`sohbetListesi(true)`) son neslinde sahipsiz süreç varsa (`surecVarMi`) `agaciOldur`, canlılık
   * okunamazsa dokunmaz; örneklerin `baslat()`'ı (kurtarma, paralel);
   * sonra açılış sırasına göre ilk `erenCanliAzami` örneği `uyandir()`. Sıra: kuyruğu dolu olanlar
   * önce, sonra `son_etkinlik_ms` yeniden eskiye. Kuyruğu dolu olup sınıra sığmayanlar da `uyandir()`
   * (kapı `sirada`'ya alır). Boşta yoklamasını kurar. Bir kez; kapanış sürerken çağrılırsa hiçbir şey yapmaz.
   */
  baslat(): Promise<void>;
  /**
   * Silinmemiş sohbetin örneği, yoksa `null` (bilinmeyen ya da silinmiş: çağıran `sohbet_bulunamadi`
   * der). `chat_create`'ten hemen sonra (aynı eşzamanlı akışta) da döner.
   */
  konusma(sohbet: SohbetSecimi): Konusma | null;
  /** `server_status.sohbetler`: silinmemiş her sohbet, `{sohbet_id, eren: örnek.durum()}`; `ana` her zaman var. */
  durumlar(): SohbetDurumlariTipi;
  /** Görünür açık turu olan her örnek (`aktifTur()` doluysa), sohbet başına en çok bir. */
  aktifTurlar(): readonly SohbetAktifTuru[];
  /**
   * `chat_create`. Eşzamanlı, tek `depo.islem`: kimlik silinmemiş bir sohbetinse (`ana` dahil) yan
   * etkisiz `{seq:null}` (ad değişmez); silinmişse `sohbet_bulunamadi`; silinmemiş sayı
   * `SOHBET_SINIRLARI.SOHBET_ADET` ise `sohbet_siniri`; değilse `sohbetEkle` + `chat_created{sohbet_id,
   * ad}`. İşlem bitince örnek kurulur (`baslat()` arkada; süreç açılmaz, ilk mesajda açılır) ve
   * `sohbet_listesi_degisti{olusturuldu}`. Veritabanı hatası `ic_hata`. Ad günlüğe yazılmaz.
   */
  olustur(sohbet: SohbetSecimi, ad: string): Sonuc<SohbetIslemSonucu, SohbetOlusturmaHatasi>;
  /**
   * `chat_rename`. Silinmiş ya da olmayan sohbet `sohbet_bulunamadi`; ad aynıysa `{seq:null}`; değilse tek
   * işlemde `sohbetAdiYaz` + `chat_renamed{sohbet_id, ad}`. `ana` da adlandırılabilir.
   */
  adlandir(sohbet: SohbetSecimi, ad: string): Sonuc<SohbetIslemSonucu, SohbetAdlandirmaHatasi>;
  /**
   * Yalnız `temizlik.sohbetiSil` çağırır, `depo.sohbetiSil` işlemi bittikten hemen sonra (araya `await`
   * girmez). Örneği haritadan ve sıradan çıkarır (bundan sonra `konusma()` `null`), ayrılmış yuvasını
   * kaldırır, `sohbet_listesi_degisti{silindi}` yayınlar ve örneği döner; sonlandırma çağıranındır.
   * Yoksa `null`. `ana` için `null` (savunma).
   */
  kaldir(sohbet: SohbetSecimi): Konusma | null;
  /** O sohbetin örneğinin `nesil()`'i; örnek yoksa 0. `planlar.nesil`'e bağlanır. */
  nesil(sohbet: SohbetSecimi): number;
  /** O sohbetin örneğinin `insanTuru()`'su; örnek yoksa `null`. `planlar.insanTuru`'na bağlanır. */
  insanTuru(sohbet: SohbetSecimi): string | null;
  /** `devir_ozeti` fiili: `baglam.sohbet_id`'nin örneğine `devirOzetiAl(ozet, baglam.nesil)`; örnek yoksa `{kabul:false}`. */
  devirOzetiAl(baglam: ErenKopruBaglami, ozet: string): z.infer<typeof DevirOzetiCikti>;
  /** Yoklamaları durdurur, bütün örnekleri `kapat()` eder (paralel), bekler. Sonra `uyandir` ve kapı isteği etkisiz. */
  kapat(): Promise<void>;
}

export interface SohbetlerBagimliliklari extends Omit<KonusmaOrtakBagimliliklari, "kopru"> {
  /** Örnek kurucu: `ana` `konusmaKur`'u verir (bu modül `konusma.ts`'i içe aktarmaz). */
  konusmaKur: KonusmaFabrikasi;
  kopru: Pick<KopruSunucu, "jetonUret" | "jetonlariIptalEt" | "erenJetonlariniSil">;
  /** RAM kapısı: `ramOku().bosMb < ayar.ramDusukMb + 768` iken yeni süreç açılmaz. */
  sistem: Pick<SistemPortu, "ramOku">;
}

export type SohbetlerFabrikasi = (b: SohbetlerBagimliliklari) => SohbetYoneticisi;

// ---------------------------------------------------------------------------------------------
// temizlik: "geçmişi sil" ve (dilim 2) "sohbeti sil" düzenleyicisi. Dilim 1. Uygulama: temizlik.ts
// (`temizlikKur`), test/temizlik.test.ts. MODULLER.md "temizlik"; dilim 2: "Dilim 2" > "temizlik".
// ---------------------------------------------------------------------------------------------

/** Dilim 2: `sohbet_bulunamadi` eklendi (bilinmeyen ya da silinmiş sohbet). */
export type TemizlikHatasi = Extract<HataKodu, "sohbet_mesgul" | "sohbet_bulunamadi" | "ic_hata">;
/** Dilim 2. `chat_delete`'in kodları. */
export type SohbetSilmeHatasi = Extract<
  HataKodu,
  "sohbet_mesgul" | "sohbet_bulunamadi" | "sohbet_silinemez" | "ic_hata"
>;

export interface TemizlikSonucu {
  /** Mezar taşının `seq`'i: `ack.seq`. */
  mezar_seq: number;
  sinir_seq: number;
}

/** Dilim 2. `Temizlik.sohbetiSil` sonucu. */
export interface SohbetSilmeCiktisi {
  /** `chat_deleted`'in `seq`'i: `ack.seq`. */
  seq: number;
}

export interface Temizlik {
  /**
   * `chat_clear`'ın tek işleyicisi. Dilim 2: yalnız o sohbet. Ön koşul, plan iptali ve veritabanı
   * temizliği EŞZAMANLIDIR (araya `await` girmez): dönüşte geçmiş silinmiş ve mezar taşı yazılmıştır,
   * `gateway` `ack`'i buna göre yazar. Örnek yoksa (`sohbetler.konusma(sohbet)` `null`)
   * `sohbet_bulunamadi`. Ön koşul tutmazsa (örneğin `temizlenebilirMi()` yanlış, `isler.aktifSayisi(sohbet)
   * > 0`, `depo.bekleyenSorular(sohbet)` dolu ya da bu sohbetin arka işi sürüyor) hiçbir şey değişmez,
   * `sohbet_mesgul`. Veritabanı hatası `ic_hata`, işlem geri alınır. Hemen sonra, işlem dışında:
   * `walDaralt` (atarsa yalnız günlüğe yazılır), sonra örneğin `yeniSayfa()`'sı çağrılır ama beklenmez.
   * Arkada, yeni sayfa bitince eski süreç çıktıysa `transkript.sil(eski_oturumlar)`; hepsi tam
   * silindiyse `depo.oturumKayitlariniSil`, değilse kayıtlar kalır. Arka işin sonucu `ack`'i beklemez,
   * yalnız sayılar günlüğe yazılır. Arka iş SOHBET BAŞINADIR: başka sohbetin temizliği beklemez.
   */
  gecmisiSil(sohbet: SohbetSecimi): Sonuc<TemizlikSonucu, TemizlikHatasi>;
  /**
   * Dilim 2. `chat_delete`'in tek işleyicisi; `gecmisiSil` ile aynı eşzamanlılık. Sıra: `ANA_SOHBET_ID`
   * → `sohbet_silinemez`; örnek yok → `sohbet_bulunamadi`; `gecmisiSil`'in ön koşulu → `sohbet_mesgul`;
   * `depo.islem(() => { planlar.bekleyenleriIptal(sohbet); return depo.sohbetiSil(sohbet, saat) })`
   * (atarsa `ic_hata`, geri alınır); `sohbetler.kaldir(sohbet)`; `walDaralt`; arkada
   * `örnek.sonlandir()`, sonra çıkış doğrulandıysa `transkript.sil(eski_oturumlar)` ve tam silmede
   * `oturumKayitlariniSil`. Dönüş `{seq: chat_deleted.seq}`; `ack` arka işi beklemez. İş kayıtları kalır.
   */
  sohbetiSil(sohbet: SohbetSecimi): Sonuc<SohbetSilmeCiktisi, SohbetSilmeHatasi>;
  /** Süren bütün arka işler (yeni sayfa, sonlandırma, transkript silme) bitince çözülür; yoksa hemen. Atmaz. */
  bekle(): Promise<void>;
  /** Yeni çağrıyı `ic_hata` ile reddeder, süren arka işleri bekler. */
  kapat(): Promise<void>;
}

/** Dilim 2. `temizlik`'in sohbet yöneticisinden gördüğü dar yüz. */
export interface TemizlikSohbetleri {
  konusma(sohbet: SohbetSecimi): Pick<Konusma, "temizlenebilirMi" | "yeniSayfa"> | null;
  kaldir(sohbet: SohbetSecimi): Pick<Konusma, "sonlandir"> | null;
}

export interface TemizlikBagimliliklari {
  depo: Pick<
    Depo,
    "islem" | "gecmisiTemizle" | "sohbetiSil" | "walDaralt" | "bekleyenSorular" | "oturumKayitlariniSil"
  >;
  /** Dilim 2 (dilim 1'deki `konusma`'nın yerine): örneğe yalnız buradan ulaşılır. */
  sohbetler: TemizlikSohbetleri;
  isler: Pick<IsYoneticisi, "aktifSayisi">;
  planlar: Pick<PlanYoneticisi, "bekleyenleriIptal">;
  transkript: TranskriptPortu;
  /** Dilim 2: `sohbetiSil`'in `silinme_ms`'i. */
  saat: SaatPortu;
  gunluk: Gunluk;
}

export type TemizlikFabrikasi = (b: TemizlikBagimliliklari) => Temizlik;

// ---------------------------------------------------------------------------------------------
// bildirim
// ---------------------------------------------------------------------------------------------

export interface Bildirim {
  baslat(): void;
  kapat(): void;
}

export interface BildirimBagimliliklari {
  ayar: Pick<Ayar, "telegram" | "sureler" | "asistanAdi">;
  cihaz: Pick<CihazYoneticisi, "bildir" | "bildirimOnaylandiMi">;
  http: HttpPortu;
  zamanlayici: ZamanlayiciPortu;
  veriyolu: Veriyolu;
  gunluk: Gunluk;
}

export type BildirimFabrikasi = (b: BildirimBagimliliklari) => Bildirim;

// ---------------------------------------------------------------------------------------------
// gateway: WebSocket, kimlik, `/sohbet`
// ---------------------------------------------------------------------------------------------

export interface Gateway {
  baslat(): Promise<void>;
  kapat(): Promise<void>;
}

/**
 * Dilim 2. `gateway`'in sohbet yöneticisinden gördüğü yüz. `konusma(sohbet)` yalnız `user_message`
 * (`insanMesajiAl`) ve `interrupt` (`kes`) için; `null` ise `ack{ok:false, code:"sohbet_bulunamadi"}`.
 */
export interface GatewaySohbetleri extends Pick<SohbetYoneticisi, "durumlar" | "aktifTurlar" | "olustur" | "adlandir"> {
  konusma(sohbet: SohbetSecimi): Pick<Konusma, "insanMesajiAl" | "kes"> | null;
}

export interface GatewayBagimliliklari {
  /** Dilim 1: `servis` `server_status.servis`'e olduğu gibi girer. */
  ayar: Pick<Ayar, "wsPort" | "sureler" | "servis">;
  depo: Depo;
  /**
   * Dilim 2 (dilim 1'deki tek `konusma`'nın yerine). `server_status.sohbetler = sohbetler.durumlar()`;
   * telafide `sohbetler.aktifTurlar()`'ın her öğesi için `stream_snapshot{sohbet_id, ...}`;
   * `chat_create` → `olustur`, `chat_rename` → `adlandir` (`ack.seq` yalnız `seq` doluysa).
   */
  sohbetler: GatewaySohbetleri;
  planlar: Pick<PlanYoneticisi, "karar">;
  isler: Pick<IsYoneticisi, "soruCevapla" | "durdur" | "aktifSayisi" | "ram">;
  /**
   * Dilim 1. Uygulama: gateway.ts. Kimliği bitmiş `/sohbet` `chat_clear` dalı yalnız bunu çağırır
   * (`ackBul`/`ackYaz` öteki iş mesajları gibi); `ok` ise `ack{ok:true, seq:mezar_seq}`. Dilim 2:
   * `gecmisiSil({sohbet_id})`; `chat_delete` → `sohbetiSil({sohbet_id})`, `ok` ise `ack{ok:true, seq}`.
   */
  temizlik: Pick<Temizlik, "gecmisiSil" | "sohbetiSil">;
  cihaz: Pick<CihazYoneticisi, "baglandi">;
  kilit: Pick<LimitKilidi, "durum">;
  sistem: Pick<SistemPortu, "tailscaleAdresi">;
  ws: WsSunucuPortu;
  anahtar: AnahtarPortu;
  rastgele: RastgelePortu;
  saat: SaatPortu;
  zamanlayici: ZamanlayiciPortu;
  veriyolu: Veriyolu;
  gunluk: Gunluk;
}

export type GatewayFabrikasi = (b: GatewayBagimliliklari) => Gateway;

// ---------------------------------------------------------------------------------------------
// eslestir: yerel `eren eslestir` komutu
// ---------------------------------------------------------------------------------------------

export interface EslestirmeBaslatma {
  qr: EslestirmeQr;
  /** Elle girilen kısa kod, QR içindekiyle aynı. */
  kod: string;
  sonMs: number;
}

export interface EslestirmeBagimliliklari {
  depo: Pick<Depo, "eslestirmeYaz">;
  anahtar: Pick<AnahtarPortu, "acikAnahtar">;
  sistem: Pick<SistemPortu, "tailscaleAdresi">;
  rastgele: Pick<RastgelePortu, "baytlar">;
  saat: SaatPortu;
  wsPort: number;
}

export type EslestirmeBaslatici = (b: EslestirmeBagimliliklari) => Sonuc<EslestirmeBaslatma, "ic_hata">;
