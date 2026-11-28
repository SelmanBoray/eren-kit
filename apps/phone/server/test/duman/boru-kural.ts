/**
 * Duman koşusunun boru adı kuralı (saf; `boru-yonlendir.ts` önyüklemesi ve `duzenek-sinama.ts` kullanır).
 *
 * Bir boru adı (`\\.\pipe\` ya da `\\?\pipe\`; büyük/küçük harf ve `/`↔`\` farkı yok sayılır) şöyle çözülür:
 * - `eren-duman-<bu belirteç>-*`: olduğu gibi (zaten yönlendirilmiş).
 * - Canlı ad alanı `eren-*` (başka belirteçli `eren-duman-*` hariç): `eren-duman-<belirteç>-*`.
 * - Başka her boru adı: `BoruYonlendirmeHatasi`.
 * - Adında `\` geçen boru (`eren-duman-<b>-x\..\eren-ajanda`): hata. `\\.\` yolunu Windows normalleştirir,
 *   `..` canlı ada inerdi.
 * Tanınmayan boru biçimi de hata: `\\` ile başlayan her başka yol (UNC `\\localhost\pipe\...`, `\\?\UNC\...`,
 * `\\.\GLOBALROOT\Device\NamedPipe\...`), NT yolu `\??\...` ve içinde `\pipe\` ya da `namedpipe` geçen yol.
 * Bunlar kuraldan kaçıp canlı boruya ulaşabilirdi; tanınmadıkları için reddedilir (kapalı başarısızlık).
 * Boru olmayan hedef (TCP, sürücü harfli dosya yolu) `null` döner: kural yalnız borulara uygulanır.
 */

export const BORU_ONEKI = "\\\\.\\pipe\\";
const CANLI = "eren-";
const DUMAN = "eren-duman-";
const ONEKLER = ["\\\\.\\pipe\\", "\\\\?\\pipe\\"] as const;

export class BoruYonlendirmeHatasi extends Error {
  readonly code = "EREN_DUMAN_BORU_RED";
}

const normalle = (yol: string): string => yol.replace(/\//g, "\\").toLowerCase();

/** Boruysa borunun adı (küçük harf, `\` ayraç); değilse `null`. Yalnız tanınan iki önek. */
export function boruAdi(yol: string): string | null {
  const n = normalle(yol);
  for (const on of ONEKLER) if (n.startsWith(on)) return n.slice(on.length);
  return null;
}

/**
 * Tanınan öneki olmayan ama boruya (ya da UNC/aygıt ad alanına) benzeyen yol: `\\` ile başlayan, `\??\` ile
 * başlayan, `\pipe\` ya da `namedpipe` içeren. Tanınan önekli yol için `false`.
 */
export function taninmayanBoruMu(yol: string): boolean {
  const n = normalle(yol);
  if (ONEKLER.some((on) => n.startsWith(on))) return false;
  return n.startsWith("\\\\") || n.startsWith("\\??\\") || n.includes("\\pipe\\") || n.endsWith("\\pipe") || n.includes("namedpipe");
}

/** `\\.\pipe\eren-duman-<belirteç>-` (küçük harf). */
export const dumanBoruOneki = (belirtec: string): string => `${BORU_ONEKI}${DUMAN}${belirtec.toLowerCase()}-`;

/**
 * Canlı ad alanındaki (yönlendirilmemiş) bir boru adı mı: `eren-*`, `eren-duman-*` değil. Tanınmayan biçimde
 * `eren-` geçiyorsa da `true` (temkinli: kanıt adımı onu canlı sayar).
 */
export const canliBoruMu = (yol: string): boolean => {
  const ad = boruAdi(yol);
  if (ad === null) return taninmayanBoruMu(yol) && normalle(yol).includes(CANLI) && !normalle(yol).includes(DUMAN);
  return (ad.startsWith(CANLI) && !ad.startsWith(DUMAN)) || (ad.includes("\\") && ad.includes(CANLI));
};

/** Boru değilse `null`; boruysa çözülen tam ad. Kurala takılırsa atar. */
export function hedefCoz(yol: string, belirtec: string): string | null {
  const ad = boruAdi(yol);
  if (ad === null) {
    if (taninmayanBoruMu(yol)) throw new BoruYonlendirmeHatasi(`boru-yonlendir: taninmayan boru bicimi reddedildi: ${normalle(yol)}`);
    return null;
  }
  if (ad.includes("\\")) throw new BoruYonlendirmeHatasi(`boru-yonlendir: alt yollu boru adi reddedildi: ${ad}`);
  const bizim = `${DUMAN}${belirtec.toLowerCase()}-`;
  if (ad.startsWith(bizim)) return BORU_ONEKI + ad;
  if (ad.startsWith(DUMAN)) throw new BoruYonlendirmeHatasi(`boru-yonlendir: baska belirtecli duman borusu reddedildi: ${ad}`);
  if (ad.startsWith(CANLI)) return BORU_ONEKI + bizim + ad.slice(CANLI.length);
  throw new BoruYonlendirmeHatasi(`boru-yonlendir: eren disi boru reddedildi: ${ad}`);
}
