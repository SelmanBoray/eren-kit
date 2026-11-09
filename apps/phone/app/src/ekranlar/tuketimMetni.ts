/**
 * Tüketim metni yardımcıları: sayıları ve maliyeti Türkçe kısa metne çeviren saf işlevler.
 * `Intl`/yerel ayar kullanılmaz (Hermes'te tutarsız); biçimlendirme elle yapılır, ondalık ayırıcı virgüldür.
 */
import type { TuketimToplami } from "@eren/protocol";
import type { TuketimRaporu } from "../cekirdek/sozlesme.ts";

/** `birim` kesirli basamaklı tam sayıyı ("123", 1 → "12,3") yazar; sondaki sıfırlar atılır. */
const ondalikliYaz = (tamSayi: number, basamak: number): string => {
  const kat = 10 ** basamak;
  const tam = Math.floor(tamSayi / kat);
  const kesir = String(tamSayi % kat).padStart(basamak, "0").replace(/0+$/, "");
  return kesir === "" ? String(tam) : `${tam},${kesir}`;
};

/** 850 → "850", 12.345 → "12,3 bin", 1.240.000 → "1,24 Mn". Yuvarlama üst birime taşarsa üst birim yazılır. */
export const tokenKisalt = (n: number): string => {
  const x = Number.isFinite(n) && n > 0 ? n : 0;
  if (x < 1000) return String(Math.round(x));
  const onda = Math.round(x / 100);
  if (x < 1_000_000 && onda < 10_000) return `${ondalikliYaz(onda, 1)} bin`;
  return `${ondalikliYaz(Math.round(x / 10_000), 2)} Mn`;
};

/** Yoksa `null`; 0 → "$0"; 0 < x < 0,01 → "< $0,01"; aksi "≈ $2,34". */
export const maliyetMetni = (usd: number | undefined | null): string | null => {
  if (usd === undefined || usd === null || !Number.isFinite(usd)) return null;
  if (usd <= 0) return "$0";
  if (usd < 0.01) return "< $0,01";
  return `≈ $${usd.toFixed(2).replace(".", ",")}`;
};

/** Dört sayacın (girdi, cache yazma, cache okuma, çıktı) toplamı. */
export const toplamToken = (t: TuketimToplami): number => t.girdi + t.cache_yazma + t.cache_okuma + t.cikti;

/** Raporun `isler` listesinde o iş varsa toplamı, yoksa `null`. */
export const isTuketimi = (rapor: TuketimRaporu | null, is_id: number): TuketimToplami | null =>
  rapor?.isler.find((i) => i.is_id === is_id)?.toplam ?? null;
