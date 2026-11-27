import type { z } from "zod";
import { CihazAsagi, CihazYukari } from "./cihaz.ts";
import type { HataKodu } from "./hatalar.ts";
import { KopruAsagi, KopruYukari } from "./kopru.ts";
import { AZAMI_CERCEVE, PROTOKOL_SURUMU, SINIRLAR } from "./sinirlar.ts";
import { SohbetAsagi, sohbetSurumu, SohbetYukari } from "./sohbet.ts";

export type CozumHatasi = Extract<
  HataKodu,
  "mesaj_cok_buyuk" | "gecersiz_mesaj" | "protokol_uyumsuz"
>;

export type CozumSonucu<T> =
  | { ok: true; mesaj: T }
  /** `yollar` yalnız alan yollarıdır, gelen değeri içermez: günlüğe yazılabilir. */
  | { ok: false; kod: CozumHatasi; yollar: string[] };

/**
 * Çözücünün beklediği `v`: kanalın tek sürümü ya da çerçevenin `type`'ına göre seçen işlev
 * (`/sohbet`: `sohbetSurumu`). `type` güvenilmez ham değerdir, seçici hiç atmamalıdır.
 */
export type SurumBeklentisi = number | ((type: unknown) => number);

/**
 * Ham çerçeveyi sırayla boyut, JSON, sürüm ve şema denetiminden geçirir. Hiçbir zaman atmaz.
 * Sayı olan ama beklenmeyen `v` şemadan önce `protokol_uyumsuz` olur; sayı olmayan `v` şemada
 * `gecersiz_mesaj`. Taşıma katmanı aynı sınırı baytta da uygulamalıdır, örneğin `ws` için `maxPayload`.
 */
export function cozumle<S extends z.ZodType>(
  sema: S,
  ham: string,
  sinir: number,
  surum: SurumBeklentisi = PROTOKOL_SURUMU,
): CozumSonucu<z.infer<S>> {
  const acik = jsonAc(ham, sinir);
  if (!acik.ok) return acik;
  const deger = acik.deger;
  const v = sayiSurumu(deger);
  if (v !== undefined) {
    const beklenen = typeof surum === "number" ? surum : surum((deger as { type?: unknown }).type);
    if (v !== beklenen) return { ok: false, kod: "protokol_uyumsuz", yollar: ["v"] };
  }
  return semaylaDenetle(sema, deger);
}

/**
 * Çok sürümlü kanal (`/ajanda`): `kabul` (boş olmayan) bağlantının kabul ettiği sürümler, `sema(v)`
 * o sürümün şeması. Sayı olan `v` kümede değilse şemadan önce `protokol_uyumsuz`; kümedeyse çerçeve
 * yalnız o sürümün şemasıyla denetlenir (her sürüm kendi içinde katı). Sayı olmayan ya da eksik `v`
 * kümenin en büyüğünün şemasında `gecersiz_mesaj` olur. Sıra ve hatalar `cozumle` ile aynıdır.
 */
export function surumluCozumle<T>(
  ham: string,
  sinir: number,
  kabul: readonly number[],
  sema: (v: number) => z.ZodType<T>,
): CozumSonucu<T> {
  const acik = jsonAc(ham, sinir);
  if (!acik.ok) return acik;
  const v = sayiSurumu(acik.deger);
  if (v !== undefined && !kabul.includes(v)) return { ok: false, kod: "protokol_uyumsuz", yollar: ["v"] };
  return semaylaDenetle(sema(v ?? Math.max(...kabul)), acik.deger);
}

/**
 * Değeri şemadan geçirir; hata yolları `cozumle`'deki gibi kırpılır ve gelen değeri içermez. Kodlayıcılar
 * da kullanır (servis yollayacağı çerçeveyi bağlantı sürümünün şemasıyla denetler).
 */
export function semaylaDenetle<S extends z.ZodType>(sema: S, deger: unknown): CozumSonucu<z.infer<S>> {
  const sonuc = sema.safeParse(deger);
  if (sonuc.success) return { ok: true, mesaj: sonuc.data };
  const yollar = sonuc.error.issues
    .slice(0, SINIRLAR.YOL_SAYISI)
    .map((sorun) => sorun.path.map(String).join(".").slice(0, SINIRLAR.YOL_UZUNLUGU));
  return { ok: false, kod: "gecersiz_mesaj", yollar };
}

function jsonAc(ham: string, sinir: number): { ok: true; deger: unknown } | { ok: false; kod: CozumHatasi; yollar: string[] } {
  if (ham.length > sinir) return { ok: false, kod: "mesaj_cok_buyuk", yollar: [] };
  try {
    return { ok: true, deger: JSON.parse(ham) };
  } catch {
    return { ok: false, kod: "gecersiz_mesaj", yollar: [] };
  }
}

/** Çerçevenin `v`'si sayıysa o; değilse (yok, sayı değil, nesne değil) `undefined`. */
function sayiSurumu(deger: unknown): number | undefined {
  if (typeof deger !== "object" || deger === null || !("v" in deger)) return undefined;
  const v = (deger as { v: unknown }).v;
  return typeof v === "number" ? v : undefined;
}

/** `/sohbet`: eşleştirme v1, geri kalan `SOHBET_SURUMU` (`sohbetSurumu`). */
export const sohbetYukariCoz = (ham: string) =>
  cozumle(SohbetYukari, ham, AZAMI_CERCEVE.SOHBET, sohbetSurumu);
export const sohbetAsagiCoz = (ham: string) =>
  cozumle(SohbetAsagi, ham, AZAMI_CERCEVE.SOHBET, sohbetSurumu);
/** `/cihaz` ve boru: yalnız v1. */
export const cihazYukariCoz = (ham: string) =>
  cozumle(CihazYukari, ham, AZAMI_CERCEVE.CIHAZ, PROTOKOL_SURUMU);
export const cihazAsagiCoz = (ham: string) =>
  cozumle(CihazAsagi, ham, AZAMI_CERCEVE.CIHAZ, PROTOKOL_SURUMU);
export const kopruYukariCoz = (ham: string) =>
  cozumle(KopruYukari, ham, AZAMI_CERCEVE.KOPRU, PROTOKOL_SURUMU);
export const kopruAsagiCoz = (ham: string) =>
  cozumle(KopruAsagi, ham, AZAMI_CERCEVE.KOPRU, PROTOKOL_SURUMU);
