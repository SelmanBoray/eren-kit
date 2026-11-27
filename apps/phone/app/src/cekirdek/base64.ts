/**
 * Standart base64 kodlayıcı (RFC 4648 §4: `A-Z a-z 0-9 + /`, `=` dolgulu). Hermes'te `Buffer` yok,
 * `btoa` ikili dizgi ister ve 512 KiB'lık parçada yavaştır; bu yüzden elle kodlanır. Düzenli ifade ve
 * karakter karakter dizgi birleştirme yoktur: çıktı karakter kodları sabit boyutlu bir tampona yazılır,
 * tampon dolunca `String.fromCharCode.apply` ile tek seferde dizgiye çevrilir, dilimler sonda birleşir.
 * Çağıran (yükleyici) en çok `PARCA_BAYT` baytlık parçalar verir: iş parça başına sınırlıdır, iki
 * parça arasında olay döngüsü döner. Sözleşme: `sozlesme.ts` `Base64Kodla`.
 */
import type { Base64Kodla } from "./sozlesme.ts";

const ALFABE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DOLGU = 0x3d; // "="

/** 6 bitlik değer → karakter kodu. */
const KOD = new Uint8Array(64);
for (let i = 0; i < 64; i++) KOD[i] = ALFABE.charCodeAt(i);

/**
 * Tek `fromCharCode.apply` çağrısının karakter sayısı (4'ün katı). Argüman sayısı yığın sınırına
 * yaklaşmasın diye küçük tutulur; 3 bayt → 4 karakter olduğundan bir dilim 6144 girdi baytıdır.
 */
const DILIM_KARAKTER = 8192;
const DILIM_BAYT = (DILIM_KARAKTER / 4) * 3;

const dizgiyeCevir = (kodlar: Uint8Array): string =>
  String.fromCharCode.apply(null, kodlar as unknown as number[]);

export const base64Kodla: Base64Kodla = (baytlar) => {
  const n = baytlar.length;
  if (n === 0) return "";
  const tampon = new Uint8Array(Math.min(DILIM_KARAKTER, 4 * Math.ceil(n / 3)));
  const dilimler: string[] = [];
  const tamUc = n - (n % 3);
  let i = 0;
  while (i < tamUc) {
    const son = Math.min(tamUc, i + DILIM_BAYT);
    let k = 0;
    for (; i < son; i += 3) {
      const ucluk = (baytlar[i]! << 16) | (baytlar[i + 1]! << 8) | baytlar[i + 2]!;
      tampon[k++] = KOD[ucluk >>> 18]!;
      tampon[k++] = KOD[(ucluk >>> 12) & 0x3f]!;
      tampon[k++] = KOD[(ucluk >>> 6) & 0x3f]!;
      tampon[k++] = KOD[ucluk & 0x3f]!;
    }
    dilimler.push(dizgiyeCevir(k === tampon.length ? tampon : tampon.subarray(0, k)));
  }
  const kalan = n - tamUc;
  if (kalan > 0) {
    const a = baytlar[tamUc]!;
    const b = kalan === 2 ? baytlar[tamUc + 1]! : 0;
    const son = new Uint8Array(4);
    son[0] = KOD[a >>> 2]!;
    son[1] = KOD[((a & 0x03) << 4) | (b >>> 4)]!;
    son[2] = kalan === 2 ? KOD[(b & 0x0f) << 2]! : DOLGU;
    son[3] = DOLGU;
    dilimler.push(dizgiyeCevir(son));
  }
  return dilimler.length === 1 ? dilimler[0]! : dilimler.join("");
};
