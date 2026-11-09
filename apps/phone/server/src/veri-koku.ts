/**
 * Veri kökü kuralının tek tanımı: `EREN_KIT_DATA_DIR` (mutlak yol zorunlu) varsa o, yoksa
 * `%LOCALAPPDATA%\eren-kit`. Saf ve bağımlılıksız: `ayar.ts`, `bekci-ana.ts` (`@eren/protocol`'e
 * bağlanmadan) ve e2e aynı kuralı buradan alır. Eski kurulumun klasörü bu değişkenle verilir.
 */
import win32 from "node:path/win32";

/** Veri kökünü belirleyen ortam değişkeni. */
export const VERI_KOKU_ORTAMI = "EREN_KIT_DATA_DIR";
/** Ortam değişkeni yokken `%LOCALAPPDATA%` altındaki klasör adı. */
export const VARSAYILAN_VERI_KLASORU = "eren-kit";

/** Büyük küçük harf duyarsız ortam okuması; boş değer yok sayılır (Windows ortamı gibi). */
export function ortamDegeri(ortam: Readonly<Record<string, string | undefined>>, ad: string): string | undefined {
  const hedef = ad.toUpperCase();
  for (const [k, v] of Object.entries(ortam)) {
    if (k.toUpperCase() === hedef && typeof v === "string" && v !== "") return v;
  }
  return undefined;
}

export type VeriKokuSonucu =
  | { readonly ok: true; readonly kok: string }
  | { readonly ok: false; readonly hata: "ozel_kok_goreli" | "localappdata_yok" };

/**
 * Kökü çözer, atmaz. `EREN_KIT_DATA_DIR` göreli ise `ozel_kok_goreli`; yoksa ve `LOCALAPPDATA`
 * tanımsız ya da göreli ise `localappdata_yok`.
 */
export function veriKokuCoz(ortam: Readonly<Record<string, string | undefined>>): VeriKokuSonucu {
  const ozel = ortamDegeri(ortam, VERI_KOKU_ORTAMI);
  if (ozel !== undefined) {
    return win32.isAbsolute(ozel) ? { ok: true, kok: win32.normalize(ozel) } : { ok: false, hata: "ozel_kok_goreli" };
  }
  const la = ortamDegeri(ortam, "LOCALAPPDATA");
  if (la === undefined || !win32.isAbsolute(la)) return { ok: false, hata: "localappdata_yok" };
  return { ok: true, kok: win32.join(la, VARSAYILAN_VERI_KLASORU) };
}
