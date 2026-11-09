import { z } from "zod";
import { SINIRLAR } from "./sinirlar.ts";

const RaporMaddeleri = z.array(z.string().max(SINIRLAR.RAPOR_MADDE)).max(SINIRLAR.RAPOR_MADDE_ADET);

/** İş raporu. Güvenilmez veridir: oturumun yazdığı metindir, komut sayılmaz. */
export const IsRaporu = z.strictObject({
  yapildi: RaporMaddeleri,
  yapilmadi: RaporMaddeleri,
  dosyalar: z.array(z.string().max(SINIRLAR.RAPOR_DOSYA_YOLU)).max(SINIRLAR.RAPOR_DOSYA_ADET),
  acik_noktalar: RaporMaddeleri,
});
export type IsRaporu = z.infer<typeof IsRaporu>;

/** Şemayı JSON Schema nesnesine çevirir. Bilgisayar tarafı içindir, telefonda gerekmez. */
export function jsonSemasi(sema: z.ZodType): Record<string, unknown> {
  const { $schema: _surum, ...govde } = z.toJSONSchema(sema) as Record<string, unknown>;
  return govde;
}

/** `claude --json-schema` bayrağına verilecek metin. */
export function isRaporuJsonSemasi(): string {
  return JSON.stringify(jsonSemasi(IsRaporu));
}
