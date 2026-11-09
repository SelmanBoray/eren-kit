/**
 * Servis modüllerinin sözleşmesi: yalnız tipler ve arayüzler, gövde yok, çalışma anında hiçbir şey.
 * Modül başına kural ve bitti tanımı: ../MODULLER.md. Kablo tipleri `@eren/protocol`'dedir,
 * burada kopyalanmaz. Her modül kendi fabrikasını `export const <ad>Kur: <Ad>Fabrikasi` diye verir,
 * bağımlılıklarını parametre alır, başka modülün dosyasını çalışma anında içe aktarmaz.
 */
import type { z } from "zod";
import type {
  CmdAdi,
  CmdSonucu,
  CMD_ARG_SEMALARI,
  DeviceState,
  DevirOzetiCikti,
  EslestirmeQr,
  GirdiYolu,
  GrantIssued,
  GrantNedeni,
  HataKodu,
  Interrupt,
  IsBitisDurumu,
  IsId,
  IsRaporu,
  IsTuru,
  IzinModu,
  JobCancel,
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
  SoruBoruGirdi,
  SoruBekleGirdi,
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
  /** Ana oturum süreci için boş çalışma dizini. */
  erenCwd: string;
  erenMcp: string;
  anahtar: string;
  kimlikEki: string;
  projeler: string;
  yerelAyar: string;
  /** Limit modunun `kilit.json`'u. Salt okunur. */
  limitKilit: string;
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
}

export type AyarFabrikasi = (b: AyarBagimliliklari) => Promise<Ayar>;

// ---------------------------------------------------------------------------------------------
// veriyolu: modüller arası tipli olaylar
// ---------------------------------------------------------------------------------------------

export type ErenDurumu = ServerStatusMesaji["eren"];

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

export interface ServisOlaylari {
  /** Kalıcı olay kaydedildi. Yalnız `Depo.olayEkle` yayınlar, işlem bitince. */
  olay_yazildi: { olay: Olay };
  /** Kalıcı değil. Yalnız `konusma` yayınlar, tamponlanmış. */
  tur_delta: { turn_id: string; offset: number; text: string };
  tur_basladi: { turn_id: string };
  tur_bitti: { turn_id: string };
  eren_durumu: { durum: ErenDurumu };
  limit_dolulugu: { doluluk: LimitDolulugu };
  kilit_degisti: { durum: LimitKilitDurumu };
  ram_degisti: { ram: RamOzeti };
  is_sayisi_degisti: { aktif: number };
  is_basladi: { is_id: IsNo; plan_id: string; tur: IsTuru };
  is_bitti: { is_id: IsNo; plan_id: string; tur: IsTuru; durum: IsBitisDurumu; kirli: boolean };
  /** `is_uzlastirildi` notundan sonra. Metin yok, yalnız sayılar. */
  isler_uzlastirildi: { sahiplenilen: number; biten: number };
  /** Soru metni ve cevap BU OLAYDA YOK: ana oturuma gidemesin diye. */
  soru_durumu: {
    soru_id: string;
    is_id: IsNo;
    durum: "soruldu" | "cevaplandi" | "zaman_asimi" | "iptal";
  };
  /** Kirli raporu ana oturum okudu: bir sonraki planın `kirli_kaynak`'ına girer. */
  kirli_okundu: { is_id: IsNo };
  plan_onerildi: { plan_id: string };
  plan_sonuclandi: {
    plan_id: string;
    sonuc: "onaylandi" | "reddedildi" | "iptal";
    is_id?: IsNo;
  };
  izin_geldi: { izin: IzinKaydi };
  izin_gitti: { grant_id: string; plan_id: string; neden: GrantNedeni };
  cihaz_baglantisi: { bagli: boolean };
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
  | { tur: "assistant"; message_id: string; model: string | null; kullanim: MesajKullanimi | null }
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
  nesil: number;
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
}

export type RaporKaynagi = "result" | "rapor_ver";

export interface IsKaydi {
  is_id: IsNo;
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
}

export type JetonKapsami =
  | { rol: "eren"; nesil: number }
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
  nesil: number;
  ts_ms: number;
}

/** Eşzamanlı (`node:sqlite`). Kırılabilecek her çoklu yazım `islem` içinde. */
export interface Depo {
  islem<T>(f: () => T): T;
  kapat(): void;

  olayEkle(girdi: OlayGirdisi): Olay;
  /** `sonSeq`'ten büyükler, artan. */
  olaylariGetir(sonSeq: number, adet: number): Olay[];
  basSeq(): number;
  /** `user_echo` ve `assistant_message`, eskiden yeniye. Rapor ve soru cevabı içermez. */
  sonKonusma(adet: number): KonusmaSatiri[];

  ackBul(device_id: string, client_msg_id: string): AckGovdesi | null;
  ackYaz(device_id: string, client_msg_id: string, ack: AckGovdesi): void;

  turEkle(tur: TurKaydi): void;
  /** Telefonda görünen yarım metin. Saniyede en çok bir kez çağrılır. */
  turKismiYaz(turn_id: string, kismi_metin: string): void;
  turBitir(turn_id: string, bitis: TurBitisi, kismi_metin: string, ms: number): void;
  turGetir(turn_id: string): TurKaydi | null;
  acikTurlar(): TurKaydi[];

  nesilEkle(nesil: NesilKaydi): void;
  nesilGuncelle(nesil: number, alanlar: Partial<Omit<NesilKaydi, "nesil">>): void;
  sonNesil(): NesilKaydi | null;

  planEkle(kayit: PlanKaydi): void;
  planGetir(plan_id: string): PlanKaydi | null;
  planGuncelle(plan_id: string, durum: PlanDurumu, is_id: IsNo | null): void;
  bekleyenPlanlar(): PlanKaydi[];

  /** Tek artan tam sayı verir: `isler\<id>`. */
  isEkle(kayit: Omit<IsKaydi, "is_id">): IsNo;
  isGuncelle(is_id: IsNo, alanlar: Partial<Omit<IsKaydi, "is_id">>): void;
  isGetir(is_id: IsNo): IsKaydi | null;
  isPlanaGore(plan_id: string): IsKaydi | null;
  isListele(yalnizAktif: boolean, adet: number): IsKaydi[];

  isPidEkle(kayit: IsPidKaydi): void;
  isPidleri(is_id: IsNo): IsPidKaydi[];

  soruEkle(kayit: SoruKaydi): void;
  soruGetir(soru_id: string): SoruKaydi | null;
  soruGuncelle(soru_id: string, durum: SoruDurumu, cevap: string | null): void;
  bekleyenSorular(is_id?: IsNo): SoruKaydi[];

  kuyrugaEkle(kaynak: ErenKuyrukKaynagi, metin: string, ms: number): number;
  kuyrukBasi(): ErenKuyrukSatiri | null;
  /** Bastan gelen ardışık `sentetik` satırlar: tek satırda birleştirmek için. */
  kuyrukSentetikBasi(adet: number): ErenKuyrukSatiri[];
  kuyruktanSil(idler: readonly number[]): void;

  cihazEkle(kayit: CihazKaydi): void;
  cihazGetir(device_id: string): CihazKaydi | null;
  cihazlar(): CihazKaydi[];

  eslestirmeYaz(kayit: EslestirmeKaydi): void;
  eslestirmeOku(): EslestirmeKaydi | null;
  eslestirmeYanlisSay(): void;
  eslestirmeSil(): void;

  jetonEkle(kayit: JetonKaydi): void;
  jetonBul(ozet: string): JetonKaydi | null;
  jetonlariSil(kapsam: JetonKapsami): void;

  kirliOkumaEkle(kayit: KirliOkumaKaydi): void;
  /** `nesil >= enAzNesil`, yeniden eskiye, yinelenmesiz. */
  kirliOkumalar(enAzNesil: number): IsNo[];
}

export interface DepoBagimliliklari {
  /** `:memory:` testlerde. */
  yol: string;
  saat: SaatPortu;
  /** CLI gibi yayıncısız kullanımda yok: `olay_yazildi` yayınlanmaz. */
  veriyolu?: Veriyolu;
  gunluk: Gunluk;
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
  jetonlariIptalEt(kapsam: JetonKapsami): void;
  /** İşleyiciler geç bağlanır: modüller jeton için bu nesneye, köprü işleyici için onlara muhtaç. */
  baslat(isleyiciler: FiilIsleyiciler): Promise<void>;
  kapat(): Promise<void>;
}

export interface KopruSunucuBagimliliklari {
  boru: BoruSunucuPortu;
  depo: Pick<Depo, "jetonEkle" | "jetonBul" | "jetonlariSil">;
  rastgele: RastgelePortu;
  anahtar: Pick<AnahtarPortu, "sabitZamanEsit">;
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
  durdur(
    is_id: IsNo,
    neden: Exclude<BitisNedeni, "dogal">,
  ): Promise<Sonuc<z.infer<typeof OturumDurdurCikti>, "is_bulunamadi">>;
  oturumlar(girdi: z.infer<typeof OturumlarGirdi>): z.infer<typeof OturumlarCikti>;
  raporOku(is_id: IsNo): Sonuc<z.infer<typeof RaporOkuCikti>, "is_bulunamadi" | "rapor_yok">;
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
  aktifSayisi(): number;
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
  planOner(taslak: PlanTaslagi): Promise<Sonuc<z.infer<typeof PlanOnerCikti>, PlanOnerHatasi>>;
  karar(mesaj: PlanDecisionMesaji): Promise<Sonuc<void, PlanKararHatasi>>;
  kapat(): void;
}

export interface PlanlarBagimliliklari {
  depo: Depo;
  isler: Pick<IsYoneticisi, "baslat">;
  kilit: Pick<LimitKilidi, "baslatmaSerbestMi">;
  cihaz: Pick<CihazYoneticisi, "izinBul" | "izinGeriCek">;
  /** Etkin nesil: kirli okumaların süresi buna bağlıdır. */
  nesil: () => number;
  dosya: Pick<DosyaPortu, "dizinVarMi">;
  rastgele: Pick<RastgelePortu, "opakId">;
  saat: SaatPortu;
  veriyolu: Veriyolu;
  gunluk: Gunluk;
}

export type PlanlarFabrikasi = (b: PlanlarBagimliliklari) => PlanYoneticisi;

// ---------------------------------------------------------------------------------------------
// konusma: ana oturum süreci
// ---------------------------------------------------------------------------------------------

/**
 * Doğrulanmış `/sohbet` bağlantısından gelen kullanıcı mesajı. Yalnız `gateway` üretir, kimlik
 * doğrulama bittikten sonra. İnsan kökenli satırın tek kaynağı budur: MODULLER.md, `konusma`.
 */
export type DogrulanmisInsanMesaji = Markali<
  { device_id: string; client_msg_id: string; input: GirdiYolu; text: string },
  "dogrulanmis-insan"
>;

export type KesmeHatasi = Extract<HataKodu, "tur_gecersiz" | "eren_hazir_degil">;

export interface AktifTur {
  turn_id: string;
  /** Telefonda görünmüş metin. */
  text: string;
}

/**
 * Metin alan tek giriş `insanMesajiAl`dır. Sentetik metni `konusma` kendi kalıplarıyla, veriyolu
 * olaylarından kurar: başka modül ana oturuma metin yazamaz.
 */
export interface Konusma {
  /** Kurtarma dahil. `kilit` serbest değilse süreç başlatmaz, açılınca kendisi başlar. */
  baslat(): Promise<void>;
  durum(): ErenDurumu;
  aktifTur(): AktifTur | null;
  nesil(): number;
  /** `user_echo` + kuyruk tek işlemde. Ana oturum kapalı ya da kilitliyken de kabul eder. */
  insanMesajiAl(mesaj: DogrulanmisInsanMesaji): { seq: number };
  kes(turn_id?: string): Sonuc<void, KesmeHatasi>;
  devirOzetiAl(ozet: string): z.infer<typeof DevirOzetiCikti>;
  kapat(): Promise<void>;
}

export interface KonusmaBagimliliklari {
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

export type KonusmaFabrikasi = (b: KonusmaBagimliliklari) => Konusma;

// ---------------------------------------------------------------------------------------------
// bildirim
// ---------------------------------------------------------------------------------------------

export interface Bildirim {
  baslat(): void;
  kapat(): void;
}

export interface BildirimBagimliliklari {
  ayar: Pick<Ayar, "telegram" | "sureler">;
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

export interface GatewayBagimliliklari {
  ayar: Pick<Ayar, "wsPort" | "sureler">;
  depo: Depo;
  konusma: Pick<Konusma, "insanMesajiAl" | "kes" | "aktifTur" | "durum">;
  planlar: Pick<PlanYoneticisi, "karar">;
  isler: Pick<IsYoneticisi, "soruCevapla" | "durdur" | "aktifSayisi" | "ram">;
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
