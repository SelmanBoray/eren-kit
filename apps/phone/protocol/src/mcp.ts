import { z } from "zod";
import { CMD_ARG_SEMALARI, CmdSonucu, UygulamaBilgisi } from "./cihaz.ts";
import { PlanTaslagi } from "./plan.ts";
import { IsRaporu } from "./rapor.ts";
import { SINIRLAR } from "./sinirlar.ts";
import { IsBitisDurumu, IsId, IsTuru, OpakId, PlanHash } from "./temel.ts";

/** Okunan metin taşıyan araç sonuçlarının MCP `_meta` işareti. */
export const GUVENILMEZ_META = { "eren/untrusted_content": true } as const;

/** Çit: çağrıya özel rastgele değer. */
const Cit = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

// Ana oturum araçları (`--rol eren`)

export const PlanOnerCikti = z.strictObject({
  plan_id: OpakId,
  plan_hash: PlanHash,
  durum: z.literal("onay_bekliyor"),
});

export const OturumOzeti = z.strictObject({
  is_id: IsId,
  baslik: z.string().max(SINIRLAR.PLAN_BASLIK),
  tur: IsTuru,
  durum: z.union([z.enum(["baslatiliyor", "calisiyor", "soru_bekliyor"]), IsBitisDurumu]),
  baslangic_ms: z.number().int().min(0),
  bitis_ms: z.number().int().min(0).optional(),
  kirli: z.boolean(),
});
export type OturumOzeti = z.infer<typeof OturumOzeti>;

export const OturumlarGirdi = z.strictObject({ yalniz_aktif: z.boolean().optional() });
export const OturumlarCikti = z.strictObject({
  oturumlar: z.array(OturumOzeti).max(SINIRLAR.OTURUM_ADET),
  ram_bos_mb: z.number().int().min(0),
  ram_toplam_mb: z.number().int().min(0),
  ram_dusuk: z.boolean(),
});

export const RaporOkuGirdi = z.strictObject({ id: IsId });
export const RaporOkuCikti = z.strictObject({
  is_id: IsId,
  durum: IsBitisDurumu,
  kirli: z.boolean(),
  /** Gövdeyi saran çit. Gövde `citleSar` çıktısıdır, boyutu kırpılmıştır. */
  cit: Cit,
  govde: z.string().max(SINIRLAR.RAPOR_GOVDE),
  kirpildi: z.boolean(),
});

export const ProjelerGirdi = z.strictObject({});
export const ProjelerCikti = z.strictObject({
  projeler: z
    .array(
      z.strictObject({
        ad: z.string().max(SINIRLAR.PROJE_ADI),
        yol: z.string().max(SINIRLAR.PLAN_CWD),
        not: z.string().max(SINIRLAR.PROJE_NOTU).optional(),
      }),
    )
    .max(SINIRLAR.PROJE_ADET),
});

export const UygulamalarGirdi = z.strictObject({});
export const UygulamalarCikti = z.strictObject({
  telefon_bagli: z.boolean(),
  /** Son `app_list`. `ad` alanları `kacir` ile kaçırılmıştır. */
  uygulamalar: z.array(UygulamaBilgisi).max(SINIRLAR.UYGULAMA_LISTESI_ADET),
});

export const OturumDurdurGirdi = z.strictObject({ id: IsId });
export const OturumDurdurCikti = z.strictObject({
  is_id: IsId,
  sonuc: z.enum(["durduruldu", "zaten_bitmis"]),
});

export const DevirOzetiGirdi = z.strictObject({
  ozet: z.string().min(1).max(SINIRLAR.DEVIR_OZETI),
});
export const DevirOzetiCikti = z.strictObject({ kabul: z.boolean() });

/** `plan_oner` iş başlatmaz, yalnız onay kartını doğurur. */
export const EREN_ARACLARI = {
  plan_oner: { girdi: PlanTaslagi, cikti: PlanOnerCikti },
  oturumlar: { girdi: OturumlarGirdi, cikti: OturumlarCikti },
  rapor_oku: { girdi: RaporOkuGirdi, cikti: RaporOkuCikti },
  projeler: { girdi: ProjelerGirdi, cikti: ProjelerCikti },
  uygulamalar: { girdi: UygulamalarGirdi, cikti: UygulamalarCikti },
  oturum_durdur: { girdi: OturumDurdurGirdi, cikti: OturumDurdurCikti },
  devir_ozeti: { girdi: DevirOzetiGirdi, cikti: DevirOzetiCikti },
} as const;

// Soru aracı (`--rol soru`)

const SoruAlanlari = {
  soru: z.string().min(1).max(SINIRLAR.SORU_METNI),
  secenekler: z
    .array(z.string().min(1).max(SINIRLAR.SECENEK_METNI))
    .min(2)
    .max(SINIRLAR.SECENEK_ADET)
    .optional(),
};

export const KullaniciyaSorGirdi = z.strictObject(SoruAlanlari);
export const KullaniciyaSorCikti = z
  .strictObject({
    durum: z.enum(["cevaplandi", "zaman_asimi", "iptal"]),
    cevap: z.string().max(SINIRLAR.CEVAP_METNI).optional(),
  })
  .refine((c) => (c.durum === "cevaplandi") === (c.cevap !== undefined), {
    message: "cevap yalnız cevaplandı durumunda olur",
  });
export type KullaniciyaSorCikti = z.infer<typeof KullaniciyaSorCikti>;

export const SORU_ARACLARI = {
  kullaniciya_sor: { girdi: KullaniciyaSorGirdi, cikti: KullaniciyaSorCikti },
} as const;

/** Köprünün boruda kullandığı biçim: bekleme yeniden bağlanınca `soru_id` ile sürer. */
export const SoruBoruGirdi = z.strictObject({ soru_id: OpakId, ...SoruAlanlari });
export const SoruBekleGirdi = z.strictObject({ soru_id: OpakId });

// Telefon oturumu araçları (`--rol telefon`)

export const RaporVerCikti = z.strictObject({ kabul: z.literal(true) });

export const TELEFON_ARACLARI = {
  foreground: { girdi: CMD_ARG_SEMALARI.foreground, cikti: CmdSonucu },
  elements: { girdi: CMD_ARG_SEMALARI.elements, cikti: CmdSonucu },
  screenshot: { girdi: CMD_ARG_SEMALARI.screenshot, cikti: CmdSonucu },
  zoom: { girdi: CMD_ARG_SEMALARI.zoom, cikti: CmdSonucu },
  click: { girdi: CMD_ARG_SEMALARI.click, cikti: CmdSonucu },
  type_text: { girdi: CMD_ARG_SEMALARI.type_text, cikti: CmdSonucu },
  key: { girdi: CMD_ARG_SEMALARI.key, cikti: CmdSonucu },
  scroll: { girdi: CMD_ARG_SEMALARI.scroll, cikti: CmdSonucu },
  drag: { girdi: CMD_ARG_SEMALARI.drag, cikti: CmdSonucu },
  wait: { girdi: CMD_ARG_SEMALARI.wait, cikti: CmdSonucu },
  open_app: { girdi: CMD_ARG_SEMALARI.open_app, cikti: CmdSonucu },
  rapor_ver: { girdi: IsRaporu, cikti: RaporVerCikti },
} as const;
