import { z } from "zod";
import { CMD_ADLARI } from "./cihaz.ts";
import { HataKodu } from "./hatalar.ts";
import {
  EREN_ARACLARI,
  KullaniciyaSorCikti,
  SoruBekleGirdi,
  SoruBoruGirdi,
  TELEFON_ARACLARI,
} from "./mcp.ts";
import { SINIRLAR } from "./sinirlar.ts";
import { Jeton, mesaj, OpakId } from "./temel.ts";

/**
 * Stdio MCP köprüsü ile servis arasındaki adlandırılmış boru protokolü. Çerçeve: `\n` ile biten
 * tek satır JSON. İlk mesaj `kopru_hello`. Kullanıcı mesajı gönderen bir fiil burada YOKTUR:
 * Ana oturuma insan mesajı yalnız doğrulanmış `/sohbet` bağlantısından girer.
 */

export const KOPRU_BORU_ADI = "\\\\.\\pipe\\eren-kopru";

export const KOPRU_ROLLERI = ["eren", "soru", "telefon"] as const;
export const KopruRolu = z.enum(KOPRU_ROLLERI);
export type KopruRolu = z.infer<typeof KopruRolu>;

/** Rol başına izinli fiiller. Aynı fiil iki rolde bulunmaz. */
export const ROL_FIILLERI = {
  eren: [
    "plan_oner",
    "oturumlar",
    "rapor_oku",
    "projeler",
    "uygulamalar",
    "oturum_durdur",
    "devir_ozeti",
  ],
  soru: ["kullaniciya_sor", "soru_bekle"],
  telefon: [...CMD_ADLARI, "rapor_ver"],
} as const;

export type KopruFiili = (typeof ROL_FIILLERI)[KopruRolu][number];

export const KOPRU_FIILLERI: readonly KopruFiili[] = [
  ...ROL_FIILLERI.eren,
  ...ROL_FIILLERI.soru,
  ...ROL_FIILLERI.telefon,
];

export function fiilRoldeIzinliMi(rol: KopruRolu, fiil: string): boolean {
  return (ROL_FIILLERI[rol] as readonly string[]).includes(fiil);
}

/** Fiil başına boru girdi ve çıktı şemaları. */
export const KOPRU_FIIL_SEMALARI = {
  ...EREN_ARACLARI,
  ...TELEFON_ARACLARI,
  kullaniciya_sor: { girdi: SoruBoruGirdi, cikti: KullaniciyaSorCikti },
  soru_bekle: { girdi: SoruBekleGirdi, cikti: KullaniciyaSorCikti },
} as const;

function istek<F extends KopruFiili, G extends z.ZodType>(fiil: F, girdi: G) {
  return mesaj("istek", { istek_id: OpakId, fiil: z.literal(fiil), girdi });
}

export const KopruIstek = z.discriminatedUnion("fiil", [
  istek("plan_oner", KOPRU_FIIL_SEMALARI.plan_oner.girdi),
  istek("oturumlar", KOPRU_FIIL_SEMALARI.oturumlar.girdi),
  istek("rapor_oku", KOPRU_FIIL_SEMALARI.rapor_oku.girdi),
  istek("projeler", KOPRU_FIIL_SEMALARI.projeler.girdi),
  istek("uygulamalar", KOPRU_FIIL_SEMALARI.uygulamalar.girdi),
  istek("oturum_durdur", KOPRU_FIIL_SEMALARI.oturum_durdur.girdi),
  istek("devir_ozeti", KOPRU_FIIL_SEMALARI.devir_ozeti.girdi),
  istek("kullaniciya_sor", KOPRU_FIIL_SEMALARI.kullaniciya_sor.girdi),
  istek("soru_bekle", KOPRU_FIIL_SEMALARI.soru_bekle.girdi),
  istek("foreground", KOPRU_FIIL_SEMALARI.foreground.girdi),
  istek("elements", KOPRU_FIIL_SEMALARI.elements.girdi),
  istek("screenshot", KOPRU_FIIL_SEMALARI.screenshot.girdi),
  istek("zoom", KOPRU_FIIL_SEMALARI.zoom.girdi),
  istek("click", KOPRU_FIIL_SEMALARI.click.girdi),
  istek("type_text", KOPRU_FIIL_SEMALARI.type_text.girdi),
  istek("key", KOPRU_FIIL_SEMALARI.key.girdi),
  istek("scroll", KOPRU_FIIL_SEMALARI.scroll.girdi),
  istek("drag", KOPRU_FIIL_SEMALARI.drag.girdi),
  istek("wait", KOPRU_FIIL_SEMALARI.wait.girdi),
  istek("open_app", KOPRU_FIIL_SEMALARI.open_app.girdi),
  istek("rapor_ver", KOPRU_FIIL_SEMALARI.rapor_ver.girdi),
]);
export type KopruIstek = z.infer<typeof KopruIstek>;

/** İlk mesaj. Jeton role ve işe bağlıdır, servis başka hiçbir şeye güvenmez. */
export const KopruHello = mesaj("kopru_hello", { rol: KopruRolu, jeton: Jeton });
/** Model aracı iptal etti. Etkisi fiile göre değişir, kesilmiş eylem geri alınmaz. */
export const KopruIptal = mesaj("iptal", { istek_id: OpakId });

export const KopruYukari = z.discriminatedUnion("type", [KopruHello, KopruIstek, KopruIptal]);
export type KopruYukari = z.infer<typeof KopruYukari>;

export const KopruWelcome = mesaj("kopru_welcome", { rol: KopruRolu });
export const KopruRet = mesaj("kopru_ret", { code: HataKodu });
/**
 * `ok: true` ise `sonuc`, fiilin `KOPRU_FIIL_SEMALARI[fiil].cikti` şemasıyla doğrulanır.
 * Köprü isteği hangi fiille yolladığını bilir; yanıt bu yüzden fiili tekrarlamaz.
 */
export const KopruYanit = mesaj("yanit", {
  istek_id: OpakId,
  ok: z.boolean(),
  sonuc: z.unknown().optional(),
  code: HataKodu.optional(),
  detail: z.string().max(SINIRLAR.HATA_DETAYI).optional(),
}).refine(
  (y) =>
    y.ok ? y.sonuc !== undefined && y.code === undefined : y.sonuc === undefined && y.code !== undefined,
  { message: "ok, sonuc ve code tutarsız" },
);
export type KopruYanit = z.infer<typeof KopruYanit>;

export const KopruAsagi = z.discriminatedUnion("type", [KopruWelcome, KopruRet, KopruYanit]);
export type KopruAsagi = z.infer<typeof KopruAsagi>;
