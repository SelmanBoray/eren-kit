import { z } from "zod";
import { HataKodu } from "./hatalar.ts";
import { Plan } from "./plan.ts";
import { IsRaporu } from "./rapor.ts";
import { SINIRLAR } from "./sinirlar.ts";
import {
  AcikAnahtar,
  Imza,
  IsBitisDurumu,
  IsId,
  IsTuru,
  mesaj,
  Nonce,
  OpakId,
  PlanHash,
  SeqNo,
  Surum,
  ZamanMs,
} from "./temel.ts";

export const GIRDI_YOLLARI = ["yazi", "dikte"] as const;
export const GirdiYolu = z.enum(GIRDI_YOLLARI);
export type GirdiYolu = z.infer<typeof GirdiYolu>;

const EslestirmeKodu = z
  .string()
  .min(SINIRLAR.ESLESTIRME_KODU_MIN)
  .max(SINIRLAR.ESLESTIRME_KODU_MAX)
  .regex(/^[A-Z0-9]+$/);

function tailscaleAdresiMi(adres: string): boolean {
  const eslesme = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(adres);
  if (eslesme === null) return false;
  const ikinci = Number(eslesme[1]);
  return ikinci >= 64 && ikinci <= 127 && Number(eslesme[2]) <= 255 && Number(eslesme[3]) <= 255;
}

/** QR kodun içeriği. Adres yalnız Tailscale aralığından (100.64.0.0/10) olabilir. */
export const EslestirmeQr = z.strictObject({
  v: Surum,
  host: z.string().max(15).refine(tailscaleAdresiMi, "Tailscale adresi değil"),
  port: z.number().int().min(1).max(65535),
  kod: EslestirmeKodu,
  server_public_key: AcikAnahtar,
});
export type EslestirmeQr = z.infer<typeof EslestirmeQr>;

// Yukarı: telefon -> bilgisayar

export const Hello = mesaj("hello", {
  device_id: OpakId,
  last_seq: SeqNo,
  client_nonce: Nonce,
});
export const PairRequest = mesaj("pair_request", {
  kod: EslestirmeKodu,
  public_key: AcikAnahtar,
  platform: z.enum(["android", "ipad"]),
  /** Yalnız listede ayırt etmek için. Güvenilmez etiket, hiçbir karara girmez. */
  etiket: z.string().max(SINIRLAR.CIHAZ_ETIKETI).optional(),
});
export const AuthResponse = mesaj("auth_response", { signature: Imza });
export const UserMessage = mesaj("user_message", {
  client_msg_id: OpakId,
  input: GirdiYolu,
  text: z.string().min(1).max(SINIRLAR.KULLANICI_METNI),
});
export const Interrupt = mesaj("interrupt", {
  client_msg_id: OpakId,
  /** Verilirse yalnız bu tur kesilir; outbox'tan geç gelen kesme yeni turu öldüremez. */
  turn_id: OpakId.optional(),
});
export const PlanDecision = mesaj("plan_decision", {
  client_msg_id: OpakId,
  plan_id: OpakId,
  plan_hash: PlanHash,
  karar: z.enum(["onay", "ret"]),
});
export const QuestionAnswer = mesaj("question_answer", {
  client_msg_id: OpakId,
  soru_id: OpakId,
  cevap: z.string().min(1).max(SINIRLAR.CEVAP_METNI),
});
export const JobCancel = mesaj("job_cancel", { client_msg_id: OpakId, is_id: IsId });

export const SohbetYukari = z.discriminatedUnion("type", [
  Hello,
  PairRequest,
  AuthResponse,
  UserMessage,
  Interrupt,
  PlanDecision,
  QuestionAnswer,
  JobCancel,
]);
export type SohbetYukari = z.infer<typeof SohbetYukari>;

// Kalıcı olaylar: `events` tablosunun satırları

function olay<T extends string, S extends z.ZodRawShape>(type: T, alanlar: S) {
  return z.strictObject({
    seq: z.number().int().min(1),
    ts_ms: ZamanMs,
    type: z.literal(type),
    ...alanlar,
  });
}

export const OLAY_TURLERI = [
  "user_echo",
  "assistant_message",
  "turn_aborted",
  "plan_proposed",
  "plan_resolved",
  "job_started",
  "job_finished",
  "question_asked",
  "question_resolved",
  "eren_handover",
  "system_notice",
] as const;

export const Olay = z.discriminatedUnion("type", [
  olay("user_echo", {
    client_msg_id: OpakId,
    input: GirdiYolu,
    text: z.string().max(SINIRLAR.KULLANICI_METNI),
  }),
  olay("assistant_message", {
    turn_id: OpakId,
    text: z.string().max(SINIRLAR.ASISTAN_METNI),
  }),
  olay("turn_aborted", {
    turn_id: OpakId,
    neden: z.enum(["kullanici_kesti", "surec_oldu", "limit_kilit", "hata"]),
    /** Telefonda görünmüş yarım metin. */
    kismi_metin: z.string().max(SINIRLAR.ASISTAN_METNI).optional(),
  }),
  olay("plan_proposed", { plan: Plan, plan_hash: PlanHash }),
  olay("plan_resolved", {
    plan_id: OpakId,
    plan_hash: PlanHash,
    sonuc: z.enum(["onaylandi", "reddedildi", "iptal"]),
    is_id: IsId.optional(),
  }),
  olay("job_started", {
    is_id: IsId,
    plan_id: OpakId,
    plan_hash: PlanHash,
    baslik: z.string().max(SINIRLAR.PLAN_BASLIK),
    tur: IsTuru,
  }),
  olay("job_finished", {
    is_id: IsId,
    durum: IsBitisDurumu,
    /** Telefon işinin raporu her zaman kirlidir. */
    kirli: z.boolean(),
    rapor: IsRaporu.optional(),
  }),
  olay("question_asked", {
    soru_id: OpakId,
    is_id: IsId,
    soru: z.string().min(1).max(SINIRLAR.SORU_METNI),
    secenekler: z
      .array(z.string().max(SINIRLAR.SECENEK_METNI))
      .max(SINIRLAR.SECENEK_ADET)
      .optional(),
  }),
  olay("question_resolved", {
    soru_id: OpakId,
    is_id: IsId,
    sonuc: z.enum(["cevaplandi", "zaman_asimi", "iptal"]),
    cevap: z.string().max(SINIRLAR.CEVAP_METNI).optional(),
  }),
  olay("eren_handover", {
    nesil: z.number().int().min(1),
    /** Yanlışsa devir yalnız veritabanı bilgisiyle yapılmıştır. */
    ozet_kabul: z.boolean(),
  }),
  olay("system_notice", {
    seviye: z.enum(["bilgi", "uyari", "kritik"]),
    kod: z.enum([
      "ram_dusuk",
      "limit_kilit_aktif",
      "limit_kilit_bitti",
      "eren_yeniden_basladi",
      "servis_yeniden_basladi",
      "is_uzlastirildi",
      "diger",
    ]),
    metin: z.string().max(SINIRLAR.SISTEM_NOTU),
  }),
]);
export type Olay = z.infer<typeof Olay>;

// Aşağı: bilgisayar -> telefon

export const AuthChallenge = mesaj("auth_challenge", {
  server_nonce: Nonce,
  /** Bilgisayarın `kimlikImzaMetni({ rol: "pc", ... })` imzası. */
  server_signature: Imza,
});
export const Welcome = mesaj("welcome", { head_seq: SeqNo, server_time_ms: ZamanMs });
export const PairResult = mesaj("pair_result", {
  ok: z.boolean(),
  device_id: OpakId.optional(),
  server_public_key: AcikAnahtar.optional(),
  code: HataKodu.optional(),
}).refine(
  (s) =>
    s.ok
      ? s.device_id !== undefined && s.server_public_key !== undefined && s.code === undefined
      : s.code !== undefined && s.device_id === undefined && s.server_public_key === undefined,
  { message: "ok ile alanlar uyuşmuyor" },
);
export const Ack = mesaj("ack", {
  client_msg_id: OpakId,
  ok: z.boolean(),
  /** `user_message` için `user_echo` olayının numarası. */
  seq: z.number().int().min(1).optional(),
  code: HataKodu.optional(),
}).refine((s) => (s.ok ? s.code === undefined : s.code !== undefined), {
  message: "ok ile code uyuşmuyor",
});
export const AssistantDelta = mesaj("assistant_delta", {
  turn_id: OpakId,
  /** Bu parçanın turun metnindeki başlangıcı, UTF-16 birimi. */
  offset: z.number().int().min(0),
  text: z.string().max(SINIRLAR.DELTA_METNI),
});
export const StreamSnapshot = mesaj("stream_snapshot", {
  turn_id: OpakId,
  /** Turun şu ana kadarki metni. Sonraki `assistant_delta.offset` bu metnin üzerine oturur. */
  text: z.string().max(SINIRLAR.ASISTAN_METNI),
});
export const EventMesaji = mesaj("event", { event: Olay });
export const ServerStatus = mesaj("server_status", {
  eren: z.enum(["baslatiliyor", "hazir", "tur_suruyor", "kapali"]),
  kilitli: z.boolean(),
  aktif_is: z.number().int().min(0),
  ram_bos_mb: z.number().int().min(0),
  ram_toplam_mb: z.number().int().min(0),
  ram_dusuk: z.boolean(),
  limit: z
    .strictObject({
      bes_saat: z.number().min(0).max(1).optional(),
      bes_saat_sifirlanma_ms: z.number().int().min(0).optional(),
      haftalik: z.number().min(0).max(1).optional(),
      haftalik_sifirlanma_ms: z.number().int().min(0).optional(),
    })
    .optional(),
});
export const ErrorMesaji = mesaj("error", {
  code: HataKodu,
  detail: z.string().max(SINIRLAR.HATA_DETAYI).optional(),
});

export const SohbetAsagi = z.discriminatedUnion("type", [
  AuthChallenge,
  Welcome,
  PairResult,
  Ack,
  AssistantDelta,
  StreamSnapshot,
  EventMesaji,
  ServerStatus,
  ErrorMesaji,
]);
export type SohbetAsagi = z.infer<typeof SohbetAsagi>;
