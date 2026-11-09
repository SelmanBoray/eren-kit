import { z } from "zod";
import { kanonikJson, sha256Hex, utf8Bayt } from "./kanonik.ts";
import { SINIRLAR } from "./sinirlar.ts";
import { IsId, IsTuru, IzinModu, OpakId, PaketAdi, planMetni, planSatiri } from "./temel.ts";

/** Plandaki `mcp_profili` değerleri. PC oturumuna eklenecek isteğe bağlı sunucuyu seçer. */
export const MCP_PROFILLERI = ["rea"] as const;
export const McpProfili = z.enum(MCP_PROFILLERI);
export type McpProfili = z.infer<typeof McpProfili>;

/**
 * PC iş oturumunun profili. Güvenlik sınırı değildir (iki profil de PC'de tam yetkili), maliyet ve
 * hız seçimidir. Plan nesnesine, `plan_hash`'e ve telefona giden plana GİRMEZ: yalnız `plan_oner`
 * girdisinde (`PlanOnerGirdi`) ve `job_started` olayında durur. Telefon planında yok sayılır.
 */
export const IS_PROFILLERI = ["hafif", "tam"] as const;
export const IsProfili = z.enum(IS_PROFILLERI);
export type IsProfili = z.infer<typeof IsProfili>;
export const VARSAYILAN_IS_PROFILI: IsProfili = "tam";

/** `plan_oner` girdisindeki `profil` alanının modele giden açıklaması (JSON Schema `description`). */
export const IS_PROFILI_ACIKLAMASI =
  "Yalnız pc planında; telefon planında yok sayılır. Verilmezse tam. " +
  "hafif: dosya oluşturma ya da taşıma, sistem bilgisi, kısa komutlar, tek adımlı iş; " +
  "kullanıcı ayarları, hook'lar ve eklentiler yüklenmez, model sonnet. " +
  "tam: kod yazma ya da düzenleme, çok adımlı iş, araştırma, kullanıcının ayarlarını ve " +
  "orkestrasını gerektiren her iş. Emin değilsen tam.";

export const TelefonIzinIstegi = z
  .strictObject({
    uygulamalar: z.array(PaketAdi).min(1).max(SINIRLAR.PLAN_UYGULAMA_ADET),
    mod: IzinModu,
    izinli_metin: z
      .array(planMetni(1, SINIRLAR.IZINLI_METIN))
      .min(1)
      .max(SINIRLAR.IZINLI_METIN_ADET)
      .optional(),
    serbest_metin: z.boolean().optional(),
  })
  .superRefine((izin, ctx) => {
    if (new Set(izin.uygulamalar).size !== izin.uygulamalar.length) {
      ctx.addIssue({ code: "custom", path: ["uygulamalar"], message: "yinelenen paket" });
    }
    if (izin.mod === "oku" && (izin.izinli_metin !== undefined || izin.serbest_metin === true)) {
      ctx.addIssue({ code: "custom", path: ["mod"], message: "okuma izni metin taşımaz" });
    }
    if (izin.mod === "yaz" && izin.uygulamalar.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["uygulamalar"], message: "yazma izni tek paket içindir" });
    }
    if (izin.izinli_metin !== undefined && izin.serbest_metin === true) {
      ctx.addIssue({
        code: "custom",
        path: ["serbest_metin"],
        message: "izinli metin ile serbest metin birlikte olmaz",
      });
    }
  });
export type TelefonIzinIstegi = z.infer<typeof TelefonIzinIstegi>;

const PLAN_ALANLARI = {
  baslik: planSatiri(1, SINIRLAR.PLAN_BASLIK),
  tur: IsTuru,
  /** `pc`: mutlak Windows yolu. `telefon`: boş metin; servis boş bir klasör kullanır. */
  cwd: planSatiri(0, SINIRLAR.PLAN_CWD),
  gorev_metni: planMetni(1, SINIRLAR.GOREV_METNI),
  kesin_yapilacaklar: z
    .array(planSatiri(1, SINIRLAR.PLAN_MADDE))
    .min(1)
    .max(SINIRLAR.PLAN_MADDE_ADET),
  kesin_yapilmayacaklar: z.array(planSatiri(1, SINIRLAR.PLAN_MADDE)).max(SINIRLAR.PLAN_MADDE_ADET),
  mcp_profili: McpProfili.optional(),
  telefon_izin_istegi: TelefonIzinIstegi.optional(),
};

type TurAlanlari = {
  tur: IsTuru;
  cwd: string;
  mcp_profili?: McpProfili | undefined;
  telefon_izin_istegi?: TelefonIzinIstegi | undefined;
};

function turKurallari(plan: TurAlanlari, ctx: z.RefinementCtx): void {
  if (plan.tur === "pc") {
    if (!/^[A-Za-z]:[\\/]/.test(plan.cwd)) {
      ctx.addIssue({ code: "custom", path: ["cwd"], message: "pc planı mutlak yol ister" });
    }
    if (plan.telefon_izin_istegi !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["telefon_izin_istegi"],
        message: "pc planı telefon izni taşımaz",
      });
    }
  } else {
    if (plan.cwd !== "") {
      ctx.addIssue({ code: "custom", path: ["cwd"], message: "telefon planında cwd boş olur" });
    }
    if (plan.telefon_izin_istegi === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["telefon_izin_istegi"],
        message: "telefon planı izin isteği ister",
      });
    }
    if (plan.mcp_profili !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["mcp_profili"],
        message: "telefon oturumunda ek sunucu yok",
      });
    }
  }
}

export const Plan = z
  .strictObject({
    plan_id: OpakId,
    ...PLAN_ALANLARI,
    /** Bu planın dayandığı kirli raporların işleri. Servis doldurur, onay ekranı gösterir. */
    kirli_kaynak: z.array(IsId).min(1).max(SINIRLAR.KIRLI_KAYNAK_ADET).optional(),
  })
  .superRefine(turKurallari);
export type Plan = z.infer<typeof Plan>;

const TASLAK_ALANLARI = {
  ...PLAN_ALANLARI,
  /** Planın dayandığı işler. Servis kendi kaydıyla birleştirir, kirli olanları etiketler. */
  dayandigi_isler: z.array(IsId).max(SINIRLAR.KIRLI_KAYNAK_ADET).optional(),
};

/**
 * Planın ana oturumun yazdığı kısmı. `plan_id` ve `kirli_kaynak` servisindir; kandırılmış bir ana
 * oturum kirli etiketini düşüremesin diye girdide yer almaz. Plan buradan kurulur (`dayandigi_isler`
 * çıkarılarak); bu yüzden plana girmeyen `profil` burada YOKTUR, `PlanOnerGirdi`'dedir.
 */
export const PlanTaslagi = z.strictObject(TASLAK_ALANLARI).superRefine(turKurallari);
export type PlanTaslagi = z.infer<typeof PlanTaslagi>;

/**
 * `plan_oner` MCP girdisi: `PlanTaslagi` + plan dışı `profil`. Servis `profil`'i taslaktan ayırıp
 * planla birlikte saklar; plana, `plan_hash`'e ve `plan_proposed`'a koymaz.
 */
export const PlanOnerGirdi = z
  .strictObject({
    ...TASLAK_ALANLARI,
    profil: IsProfili.optional().describe(IS_PROFILI_ACIKLAMASI),
  })
  .superRefine(turKurallari);
export type PlanOnerGirdi = z.infer<typeof PlanOnerGirdi>;

/**
 * Kanonik JSON'un UTF-8 baytları üzerinden SHA-256. Geçersiz planı atar: onaylanabilecek her
 * özet şemadan geçmiş bir plana aittir. `plan_hash` planın alanı değildir, yanında taşınır.
 */
export function planHash(plan: Plan): string {
  return sha256Hex(utf8Bayt(kanonikJson(Plan.parse(plan))));
}
