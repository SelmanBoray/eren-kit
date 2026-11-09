/**
 * En son açık sohbet ve sohbet başına okunmuş sınırlarının kalıcılığı (`DepoPortu` üstünde, tek
 * anahtar). Kayıt kişisel metin taşımaz. Okuma asla atmaz: eksik ya da bozuk kayıt `null` olur ve
 * çağıran güvenli varsayılana düşer. Yazım arkadan ve sırayladır, son yazılan kazanır, hata yutulur.
 * TASARIM.md "Dilim 2: çoklu sohbet" (Okunmamış, Seçili sohbet) ve Ç5.
 */
import { SohbetId } from "@eren/protocol";
import type { DepoPortu, SecimDeposuFabrikasi, SecimKaydi } from "./sozlesme.ts";

export const SECIM_ANAHTARI = "sohbet_secimi";

const SURUM = 1;

const gecerliSeq = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

const kimlikMi = (v: unknown): v is SohbetId => SohbetId.safeParse(v).success;

/** Diskteki metni kayda çevirir; geçersizse `null`. `okundu`'da bozuk girdiler tek tek atılır. */
const kayitCoz = (ham: string | null): SecimKaydi | null => {
  if (ham === null) return null;
  let j: unknown;
  try {
    j = JSON.parse(ham);
  } catch {
    return null;
  }
  if (typeof j !== "object" || j === null || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (o["surum"] !== SURUM) return null;
  const acik = o["acik"];
  const taban = o["taban_seq"];
  if (!kimlikMi(acik) || !gecerliSeq(taban)) return null;
  const girdiler: [SohbetId, number][] = [];
  const hamOkundu = o["okundu"];
  if (typeof hamOkundu === "object" && hamOkundu !== null && !Array.isArray(hamOkundu)) {
    for (const [k, v] of Object.entries(hamOkundu as Record<string, unknown>)) {
      if (kimlikMi(k) && gecerliSeq(v)) girdiler.push([k, v]);
    }
  }
  return { acik, taban_seq: taban, okundu: Object.fromEntries(girdiler) };
};

const kayitYaz = (k: SecimKaydi): string =>
  JSON.stringify({
    surum: SURUM,
    acik: k.acik,
    taban_seq: k.taban_seq,
    okundu: k.okundu,
  });

export const secimDeposuKur: SecimDeposuFabrikasi = (b: { depo: DepoPortu }) => {
  const { depo } = b;
  // Sırada bekleyen en son kayıt (eski bekleyen atlanır) ve çalışan döngü.
  let bekleyen: string | null = null;
  let dongu: Promise<void> | null = null;

  const bosalt = async (): Promise<void> => {
    while (bekleyen !== null) {
      const metin = bekleyen;
      bekleyen = null;
      try {
        await depo.yaz(SECIM_ANAHTARI, metin);
      } catch {
        // Yutulur: en kötü seçim ya da okundu bilgisi eskir.
      }
    }
    // Eşzamanlı: döngüden çıkış ile bu atama arasında `yaz` araya giremez.
    dongu = null;
  };

  return {
    yukle: async () => {
      try {
        return kayitCoz(await depo.oku(SECIM_ANAHTARI));
      } catch {
        return null;
      }
    },
    yaz: (k) => {
      let metin: string;
      try {
        metin = kayitYaz(k);
      } catch {
        return;
      }
      bekleyen = metin;
      if (dongu === null) {
        dongu = bosalt();
      }
    },
    bosalt: async () => {
      // Döngü biterken yeni yazım gelmiş olabilir: sıra boşalana dek bekler.
      while (dongu !== null) await dongu;
    },
  };
};
