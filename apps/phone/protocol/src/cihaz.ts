import { z } from "zod";
import { SINIRLAR } from "./sinirlar.ts";
import { AuthChallenge, AuthResponse, ErrorMesaji } from "./sohbet.ts";
import {
  IzinModu,
  Jeton,
  mesaj,
  Nonce,
  OpakId,
  PaketAdi,
  PlanHash,
  ZamanMs,
} from "./temel.ts";

/** `/cihaz` sözleşmesinin alan alan anlatımı: CIHAZ.md. Komut adları ve denied listesi kapalıdır. */

export const CMD_ADLARI = [
  "foreground",
  "elements",
  "screenshot",
  "zoom",
  "click",
  "type_text",
  "key",
  "scroll",
  "drag",
  "wait",
  "open_app",
] as const;
export const CmdAdi = z.enum(CMD_ADLARI);
export type CmdAdi = z.infer<typeof CmdAdi>;

export const KEY_ADLARI = [
  "back",
  "home",
  "enter",
  "dpad_up",
  "dpad_down",
  "dpad_left",
  "dpad_right",
  "dpad_center",
] as const;

export const SCROLL_YONLERI = ["up", "down", "left", "right"] as const;

const Koordinat = z.number().int().min(0).max(SINIRLAR.KOORDINAT_MAX);

/** İkili koordinat: ikisi birlikte verilir ya da ikisi de verilmez. */
function ciftKuralli(x: number | undefined, y: number | undefined): boolean {
  return (x === undefined) === (y === undefined);
}

export const CMD_ARG_SEMALARI = {
  foreground: z.strictObject({}),
  elements: z.strictObject({ query: z.string().max(SINIRLAR.ELEMENT_SORGU).optional() }),
  screenshot: z.strictObject({}),
  zoom: z
    .strictObject({ x0: Koordinat, y0: Koordinat, x1: Koordinat, y1: Koordinat })
    .refine((a) => a.x1 > a.x0 && a.y1 > a.y0, { message: "bölge boş" }),
  click: z
    .strictObject({
      element: z.number().int().min(0).optional(),
      x: Koordinat.optional(),
      y: Koordinat.optional(),
      clicks: z.number().int().min(1).max(2).optional(),
      long_press: z.boolean().optional(),
    })
    .refine(
      (a) => ciftKuralli(a.x, a.y) && (a.element !== undefined) !== (a.x !== undefined),
      { message: "ya element ya x ile y" },
    ),
  type_text: z.strictObject({ text: z.string().min(1).max(SINIRLAR.YAZILAN_METIN) }),
  key: z.strictObject({
    keys: z.enum(KEY_ADLARI),
    repeat: z.number().int().min(1).max(SINIRLAR.TEKRAR_MAX).optional(),
  }),
  scroll: z
    .strictObject({
      direction: z.enum(SCROLL_YONLERI),
      amount: z.number().int().min(1).max(SINIRLAR.KAYDIRMA_MAX).optional(),
      x: Koordinat.optional(),
      y: Koordinat.optional(),
    })
    .refine((a) => ciftKuralli(a.x, a.y), { message: "x ile y birlikte verilir" }),
  drag: z.strictObject({ x0: Koordinat, y0: Koordinat, x1: Koordinat, y1: Koordinat }),
  wait: z.strictObject({ seconds: z.number().gt(0).max(SINIRLAR.BEKLEME_SANIYE_MAX) }),
  open_app: z.strictObject({ package: PaketAdi }),
} as const;

/** Telefon kapısının kapalı ret listesi. Yeni neden sürüm artışı gerektirir. */
export const DENIED_NEDENLERI = [
  // İzin
  "izin_yok",
  "izin_geri_cekildi",
  "izin_suresi_bitti",
  "jeton_yanlis",
  "butce_doldu",
  "deadline_gecti",
  // Ön plan ve uygulama listeleri
  "on_plan_izin_disi",
  "hassas_uygulama",
  "yeni_uygulama",
  "degismez_ret",
  "izin_disi_pencere",
  "kilit_ekrani",
  // Metin ve yazma
  "parola_alani",
  "yalniz_oku_yazma",
  "yalniz_oku_ham_dokunma",
  "yalniz_oku_etiket",
  "metin_kilidi",
  // Açma
  "url_intent_yasak",
  // Durum
  "erisilebilirlik_kapali",
  "ekran_korumali",
  "mesgul",
  "desteklenmeyen_komut",
  "gecersiz_arg",
] as const;
export const DeniedNeden = z.enum(DENIED_NEDENLERI);
export type DeniedNeden = z.infer<typeof DeniedNeden>;

/** Kapı izin verdi ama eylem yapılamadı. Bir eylem denenmiş olabilir, yeniden denenmez. */
export const CIHAZ_HATALARI = [
  "element_bulunamadi",
  "uygulama_bulunamadi",
  "ekran_alinamadi",
  "eylem_basarisiz",
  "zaman_asimi",
] as const;
export const CihazHatasi = z.enum(CIHAZ_HATALARI);
export type CihazHatasi = z.infer<typeof CihazHatasi>;

export const OnPlan = z.strictObject({
  /** İzin dışı pakette boş metin yollanır: başlık okunmamış içerik taşıyabilir. */
  baslik: z.string().max(SINIRLAR.ON_PLAN_BASLIK),
  paket: PaketAdi,
});
export type OnPlan = z.infer<typeof OnPlan>;

export const Element = z.strictObject({
  id: z.number().int().min(0),
  rol: z
    .string()
    .min(1)
    .max(SINIRLAR.ELEMENT_ROL)
    .regex(/^[A-Za-z0-9_.-]+$/),
  ad: z.string().max(SINIRLAR.ELEMENT_METIN),
  /** Parola alanında hiçbir zaman yollanmaz. */
  deger: z.string().max(SINIRLAR.ELEMENT_METIN).optional(),
  x: Koordinat,
  y: Koordinat,
  disabled: z.boolean().optional(),
  password: z.boolean().optional(),
});
export type Element = z.infer<typeof Element>;

export const CmdPayload = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("elements"),
    /** Eleman sayısı üst sınıra takıldıysa doğru. */
    truncated: z.boolean(),
    elements: z.array(Element).max(SINIRLAR.ELEMENT_ADET),
  }),
  z.strictObject({
    kind: z.literal("image"),
    mime: z.enum(["image/jpeg", "image/png"]),
    image_base64: z
      .string()
      .min(1)
      .max(SINIRLAR.EKRAN_BASE64)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    width: z.number().int().min(1).max(SINIRLAR.KOORDINAT_MAX),
    height: z.number().int().min(1).max(SINIRLAR.KOORDINAT_MAX),
    /** Koordinatlar bu resmin pikselidir: gerçek = resim * scale. */
    scale: z.number().gt(0).max(16),
  }),
]);
export type CmdPayload = z.infer<typeof CmdPayload>;

const CMD_SONUC_ALANLARI = {
  ok: z.boolean(),
  foreground: OnPlan.nullable(),
  payload: CmdPayload.optional(),
  denied: DeniedNeden.optional(),
  hata: CihazHatasi.optional(),
};

function sonucTutarliMi(s: {
  ok: boolean;
  payload?: unknown;
  denied?: unknown;
  hata?: unknown;
}): boolean {
  if (s.ok) return s.denied === undefined && s.hata === undefined;
  return s.payload === undefined && (s.denied === undefined) !== (s.hata === undefined);
}

const SONUC_TUTARSIZ = { message: "ok, denied, hata ve payload tutarsız" };

/** Bir komutun zarfsız sonucu. Köprü aracın dönüş metnini bundan kurar. */
export const CmdSonucu = z.strictObject(CMD_SONUC_ALANLARI).refine(sonucTutarliMi, SONUC_TUTARSIZ);
export type CmdSonucu = z.infer<typeof CmdSonucu>;

export const CmdResult = mesaj("cmd_result", {
  cmd_id: OpakId,
  ...CMD_SONUC_ALANLARI,
}).refine(sonucTutarliMi, SONUC_TUTARSIZ);
export type CmdResult = z.infer<typeof CmdResult>;

const GRANT_NEDENLERI = [
  "kullanici_durdurdu",
  "suresi_bitti",
  "butce_bitti",
  "is_bitti",
  "is_iptal",
  "limit_kilit",
  "erisilebilirlik_kapandi",
] as const;
export const GrantNedeni = z.enum(GRANT_NEDENLERI);
export type GrantNedeni = z.infer<typeof GrantNedeni>;

export const UYGULAMA_DURUMLARI = ["acik", "hassas", "yeni", "degismez"] as const;
export const UygulamaBilgisi = z.strictObject({
  paket: PaketAdi,
  /** PackageManager'dan gelir. Uygulama kendi adını seçer, güvenilmez metindir. */
  ad: z.string().max(SINIRLAR.UYGULAMA_ADI),
  durum: z.enum(UYGULAMA_DURUMLARI),
});
export type UygulamaBilgisi = z.infer<typeof UygulamaBilgisi>;

// Yukarı: telefon -> bilgisayar

export const CihazHello = mesaj("hello", { device_id: OpakId, client_nonce: Nonce });
export const GrantIssued = mesaj("grant_issued", {
  grant_id: OpakId,
  token: Jeton,
  plan_id: OpakId,
  plan_hash: PlanHash,
  mod: IzinModu,
  uygulamalar: z.array(PaketAdi).min(1).max(SINIRLAR.PLAN_UYGULAMA_ADET),
  /** Telefonun onay ekranında belirlediği kalan süre ve eylem bütçesi. */
  kalan_ms: z.number().int().min(1),
  butce: z.number().int().min(1),
});
export const GrantRevoked = mesaj("grant_revoked", {
  grant_id: OpakId,
  neden: GrantNedeni,
});
export const DeviceState = mesaj("device_state", {
  a11y: z.boolean(),
  adb_enabled: z.boolean(),
  kilitli: z.boolean(),
});
export const AppList = mesaj("app_list", {
  uygulamalar: z.array(UygulamaBilgisi).max(SINIRLAR.UYGULAMA_LISTESI_ADET),
});
export const NotifyAck = mesaj("notify_ack", { notify_id: OpakId });

export const CihazYukari = z.discriminatedUnion("type", [
  CihazHello,
  AuthResponse,
  CmdResult,
  GrantIssued,
  GrantRevoked,
  DeviceState,
  AppList,
  NotifyAck,
]);
export type CihazYukari = z.infer<typeof CihazYukari>;

// Aşağı: bilgisayar -> telefon

const CMD_ZARFI = {
  cmd_id: OpakId,
  grant_id: OpakId,
  token: Jeton,
  /** Mutlak an, bilgisayar saati, epoch ms. Hesap: CIHAZ.md, "Saat". */
  deadline_ms: ZamanMs,
};

export const Cmd = z.discriminatedUnion("name", [
  mesaj("cmd", { ...CMD_ZARFI, name: z.literal("foreground"), args: CMD_ARG_SEMALARI.foreground }),
  mesaj("cmd", { ...CMD_ZARFI, name: z.literal("elements"), args: CMD_ARG_SEMALARI.elements }),
  mesaj("cmd", { ...CMD_ZARFI, name: z.literal("screenshot"), args: CMD_ARG_SEMALARI.screenshot }),
  mesaj("cmd", { ...CMD_ZARFI, name: z.literal("zoom"), args: CMD_ARG_SEMALARI.zoom }),
  mesaj("cmd", { ...CMD_ZARFI, name: z.literal("click"), args: CMD_ARG_SEMALARI.click }),
  mesaj("cmd", { ...CMD_ZARFI, name: z.literal("type_text"), args: CMD_ARG_SEMALARI.type_text }),
  mesaj("cmd", { ...CMD_ZARFI, name: z.literal("key"), args: CMD_ARG_SEMALARI.key }),
  mesaj("cmd", { ...CMD_ZARFI, name: z.literal("scroll"), args: CMD_ARG_SEMALARI.scroll }),
  mesaj("cmd", { ...CMD_ZARFI, name: z.literal("drag"), args: CMD_ARG_SEMALARI.drag }),
  mesaj("cmd", { ...CMD_ZARFI, name: z.literal("wait"), args: CMD_ARG_SEMALARI.wait }),
  mesaj("cmd", { ...CMD_ZARFI, name: z.literal("open_app"), args: CMD_ARG_SEMALARI.open_app }),
]);
export type Cmd = z.infer<typeof Cmd>;

export const CihazWelcome = mesaj("welcome", { server_time_ms: ZamanMs });
export const Notify = mesaj("notify", {
  notify_id: OpakId,
  tur: z.enum(["plan", "soru", "is_bitti", "sistem"]),
  baslik: z.string().max(SINIRLAR.BILDIRIM_BASLIK),
  metin: z.string().max(SINIRLAR.BILDIRIM_METIN),
});
export const GrantRevoke = mesaj("grant_revoke", {
  /** `null`: telefondaki bütün izinler. */
  grant_id: OpakId.nullable(),
  neden: GrantNedeni,
});

export const CihazAsagi = z.discriminatedUnion("type", [
  AuthChallenge,
  CihazWelcome,
  Cmd,
  Notify,
  GrantRevoke,
  ErrorMesaji,
]);
export type CihazAsagi = z.infer<typeof CihazAsagi>;
