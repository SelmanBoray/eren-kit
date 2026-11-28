/**
 * Duman koşusunun boru adı kuralı (saf; `boru-yonlendir.ts` önyüklemesi ve `oz-sinama.ts` kullanır).
 *
 * Bir boru adı (`\\.\pipe\` ya da `\\?\pipe\`; büyük/küçük harf ve `/`↔`\` farkı yok sayılır) şöyle çözülür:
 * - `eren-duman-<bu belirteç>-*`: olduğu gibi (zaten yönlendirilmiş).
 * - Canlı ad alanı `eren-*` (başka belirteçli `eren-duman-*` hariç): `eren-duman-<belirteç>-*`.
 * - Başka her boru adı: `BoruYonlendirmeHatasi`.
 * Boru olmayan hedef (TCP, dosya yolu) `null` döner: kural yalnız borulara uygulanır.
 */

export const BORU_ONEKI = "\\\\.\\pipe\\";
const CANLI = "eren-";
const DUMAN = "eren-duman-";

export class BoruYonlendirmeHatasi extends Error {
  readonly code = "EREN_DUMAN_BORU_RED";
}

/** Boruysa borunun adı (küçük harf, `\` ayraç); değilse `null`. */
export function boruAdi(yol: string): string | null {
  const n = yol.replace(/\//g, "\\").toLowerCase();
  for (const on of ["\\\\.\\pipe\\", "\\\\?\\pipe\\"]) if (n.startsWith(on)) return n.slice(on.length);
  return null;
}

/** `\\.\pipe\eren-duman-<belirteç>-` (küçük harf). */
export const dumanBoruOneki = (belirtec: string): string => `${BORU_ONEKI}${DUMAN}${belirtec.toLowerCase()}-`;

/** Canlı ad alanındaki (yönlendirilmemiş) bir boru adı mı: `eren-*`, `eren-duman-*` değil. */
export const canliBoruMu = (yol: string): boolean => {
  const ad = boruAdi(yol);
  return ad !== null && ad.startsWith(CANLI) && !ad.startsWith(DUMAN);
};

/** Boru değilse `null`; boruysa çözülen tam ad. Kurala takılırsa atar. */
export function hedefCoz(yol: string, belirtec: string): string | null {
  const ad = boruAdi(yol);
  if (ad === null) return null;
  const bizim = `${DUMAN}${belirtec.toLowerCase()}-`;
  if (ad.startsWith(bizim)) return BORU_ONEKI + ad;
  if (ad.startsWith(DUMAN)) throw new BoruYonlendirmeHatasi(`boru-yonlendir: baska belirtecli duman borusu reddedildi: ${ad}`);
  if (ad.startsWith(CANLI)) return BORU_ONEKI + bizim + ad.slice(CANLI.length);
  throw new BoruYonlendirmeHatasi(`boru-yonlendir: eren disi boru reddedildi: ${ad}`);
}
