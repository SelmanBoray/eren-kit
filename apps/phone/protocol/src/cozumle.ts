import type { z } from "zod";
import { CihazAsagi, CihazYukari } from "./cihaz.ts";
import type { HataKodu } from "./hatalar.ts";
import { KopruAsagi, KopruYukari } from "./kopru.ts";
import { AZAMI_CERCEVE, PROTOKOL_SURUMU, SINIRLAR } from "./sinirlar.ts";
import { SohbetAsagi, SohbetYukari } from "./sohbet.ts";

export type CozumHatasi = Extract<
  HataKodu,
  "mesaj_cok_buyuk" | "gecersiz_mesaj" | "protokol_uyumsuz"
>;

export type CozumSonucu<T> =
  | { ok: true; mesaj: T }
  /** `yollar` yalnız alan yollarıdır, gelen değeri içermez: günlüğe yazılabilir. */
  | { ok: false; kod: CozumHatasi; yollar: string[] };

/**
 * Ham çerçeveyi sırayla boyut, JSON, sürüm ve şema denetiminden geçirir. Hiçbir zaman atmaz.
 * Taşıma katmanı aynı sınırı baytta da uygulamalıdır, örneğin `ws` için `maxPayload`.
 */
export function cozumle<S extends z.ZodType>(
  sema: S,
  ham: string,
  sinir: number,
): CozumSonucu<z.infer<S>> {
  if (ham.length > sinir) return { ok: false, kod: "mesaj_cok_buyuk", yollar: [] };
  let deger: unknown;
  try {
    deger = JSON.parse(ham);
  } catch {
    return { ok: false, kod: "gecersiz_mesaj", yollar: [] };
  }
  if (typeof deger === "object" && deger !== null && "v" in deger) {
    const surum = (deger as { v: unknown }).v;
    if (typeof surum === "number" && surum !== PROTOKOL_SURUMU) {
      return { ok: false, kod: "protokol_uyumsuz", yollar: ["v"] };
    }
  }
  const sonuc = sema.safeParse(deger);
  if (sonuc.success) return { ok: true, mesaj: sonuc.data };
  const yollar = sonuc.error.issues
    .slice(0, SINIRLAR.YOL_SAYISI)
    .map((sorun) => sorun.path.map(String).join(".").slice(0, SINIRLAR.YOL_UZUNLUGU));
  return { ok: false, kod: "gecersiz_mesaj", yollar };
}

export const sohbetYukariCoz = (ham: string) => cozumle(SohbetYukari, ham, AZAMI_CERCEVE.SOHBET);
export const sohbetAsagiCoz = (ham: string) => cozumle(SohbetAsagi, ham, AZAMI_CERCEVE.SOHBET);
export const cihazYukariCoz = (ham: string) => cozumle(CihazYukari, ham, AZAMI_CERCEVE.CIHAZ);
export const cihazAsagiCoz = (ham: string) => cozumle(CihazAsagi, ham, AZAMI_CERCEVE.CIHAZ);
export const kopruYukariCoz = (ham: string) => cozumle(KopruYukari, ham, AZAMI_CERCEVE.KOPRU);
export const kopruAsagiCoz = (ham: string) => cozumle(KopruAsagi, ham, AZAMI_CERCEVE.KOPRU);
