/**
 * Saf kanonik JSON, UTF-8 ve SHA-256. Çalışma ortamından hiçbir şey almaz:
 * Node, Hermes ve Kotlin aynı girdiden aynı baytları üretir.
 * Kanonikleştirme kuralı: README.md, "plan_hash" bölümü.
 */

const AZAMI_DERINLIK = 32;

export class KanonikHata extends Error {
  override name = "KanonikHata";
}

/** Eşi olmayan vekil (surrogate) birim yoksa doğrudur. */
export function iyiBicimliMi(metin: string): boolean {
  for (let i = 0; i < metin.length; i++) {
    const birim = metin.charCodeAt(i);
    if (birim >= 0xd800 && birim <= 0xdbff) {
      const sonraki = i + 1 < metin.length ? metin.charCodeAt(i + 1) : 0;
      if (sonraki < 0xdc00 || sonraki > 0xdfff) return false;
      i++;
    } else if (birim >= 0xdc00 && birim <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function kanonikMetin(metin: string): string {
  if (!iyiBicimliMi(metin)) throw new KanonikHata("eşi olmayan vekil karakter");
  let cikti = '"';
  for (let i = 0; i < metin.length; i++) {
    const birim = metin.charCodeAt(i);
    if (birim === 0x22) cikti += '\\"';
    else if (birim === 0x5c) cikti += "\\\\";
    else if (birim === 0x08) cikti += "\\b";
    else if (birim === 0x09) cikti += "\\t";
    else if (birim === 0x0a) cikti += "\\n";
    else if (birim === 0x0c) cikti += "\\f";
    else if (birim === 0x0d) cikti += "\\r";
    else if (birim < 0x20) cikti += "\\u00" + (birim < 0x10 ? "0" : "") + birim.toString(16);
    else cikti += metin.charAt(i);
  }
  return cikti + '"';
}

function kanonikDeger(deger: unknown, derinlik: number): string {
  if (derinlik > AZAMI_DERINLIK) throw new KanonikHata("çok derin yapı");
  if (deger === null) return "null";
  if (deger === true) return "true";
  if (deger === false) return "false";
  if (typeof deger === "string") return kanonikMetin(deger);
  if (typeof deger === "number") {
    if (!Number.isSafeInteger(deger)) throw new KanonikHata("yalnız güvenli tam sayı kabul edilir");
    return String(deger === 0 ? 0 : deger);
  }
  if (Array.isArray(deger)) {
    const parcalar: string[] = [];
    for (const oge of deger) {
      if (oge === undefined) throw new KanonikHata("dizide undefined");
      parcalar.push(kanonikDeger(oge, derinlik + 1));
    }
    return "[" + parcalar.join(",") + "]";
  }
  if (typeof deger === "object") {
    const ata: unknown = Object.getPrototypeOf(deger);
    if (ata !== Object.prototype && ata !== null) throw new KanonikHata("düz nesne değil");
    const nesne = deger as Record<string, unknown>;
    // Varsayılan sort UTF-16 birimlerini karşılaştırır, yerel ayara bağlı değildir.
    const anahtarlar = Object.keys(nesne).sort();
    const parcalar: string[] = [];
    for (const anahtar of anahtarlar) {
      if (anahtar === "__proto__") throw new KanonikHata("yasak anahtar");
      const alt = nesne[anahtar];
      if (alt === undefined) continue;
      parcalar.push(kanonikMetin(anahtar) + ":" + kanonikDeger(alt, derinlik + 1));
    }
    return "{" + parcalar.join(",") + "}";
  }
  throw new KanonikHata("desteklenmeyen tür: " + typeof deger);
}

export function kanonikJson(deger: unknown): string {
  if (deger === undefined) throw new KanonikHata("kök undefined");
  return kanonikDeger(deger, 0);
}

export function utf8Bayt(metin: string): Uint8Array {
  if (!iyiBicimliMi(metin)) throw new KanonikHata("eşi olmayan vekil karakter");
  let uzunluk = 0;
  for (let i = 0; i < metin.length; i++) {
    const birim = metin.charCodeAt(i);
    if (birim < 0x80) uzunluk += 1;
    else if (birim < 0x800) uzunluk += 2;
    else if (birim >= 0xd800 && birim <= 0xdbff) {
      uzunluk += 4;
      i++;
    } else uzunluk += 3;
  }
  const bayt = new Uint8Array(uzunluk);
  let k = 0;
  for (let i = 0; i < metin.length; i++) {
    const birim = metin.charCodeAt(i);
    if (birim < 0x80) {
      bayt[k++] = birim;
    } else if (birim < 0x800) {
      bayt[k++] = 0xc0 | (birim >> 6);
      bayt[k++] = 0x80 | (birim & 0x3f);
    } else if (birim >= 0xd800 && birim <= 0xdbff) {
      const kod = 0x10000 + ((birim - 0xd800) << 10) + (metin.charCodeAt(++i) - 0xdc00);
      bayt[k++] = 0xf0 | (kod >> 18);
      bayt[k++] = 0x80 | ((kod >> 12) & 0x3f);
      bayt[k++] = 0x80 | ((kod >> 6) & 0x3f);
      bayt[k++] = 0x80 | (kod & 0x3f);
    } else {
      bayt[k++] = 0xe0 | (birim >> 12);
      bayt[k++] = 0x80 | ((birim >> 6) & 0x3f);
      bayt[k++] = 0x80 | (birim & 0x3f);
    }
  }
  return bayt;
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function dondur(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** SHA-256 özetini küçük harfli 64 karakter onaltılık metin olarak verir. */
export function sha256Hex(veri: Uint8Array): string {
  const uzunluk = veri.length;
  const dolgulu = new Uint8Array(Math.ceil((uzunluk + 9) / 64) * 64);
  dolgulu.set(veri);
  dolgulu[uzunluk] = 0x80;
  const yuksek = Math.floor(uzunluk / 0x20000000);
  const dusuk = (uzunluk << 3) >>> 0;
  const son = dolgulu.length;
  dolgulu[son - 8] = (yuksek >>> 24) & 0xff;
  dolgulu[son - 7] = (yuksek >>> 16) & 0xff;
  dolgulu[son - 6] = (yuksek >>> 8) & 0xff;
  dolgulu[son - 5] = yuksek & 0xff;
  dolgulu[son - 4] = (dusuk >>> 24) & 0xff;
  dolgulu[son - 3] = (dusuk >>> 16) & 0xff;
  dolgulu[son - 2] = (dusuk >>> 8) & 0xff;
  dolgulu[son - 1] = dusuk & 0xff;

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Array<number>(64).fill(0);

  for (let blok = 0; blok < son; blok += 64) {
    for (let t = 0; t < 16; t++) {
      const i = blok + t * 4;
      w[t] =
        (dolgulu[i]! << 24) | (dolgulu[i + 1]! << 16) | (dolgulu[i + 2]! << 8) | dolgulu[i + 3]!;
    }
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15]!;
      const y = w[t - 2]!;
      const s0 = dondur(x, 7) ^ dondur(x, 18) ^ (x >>> 3);
      const s1 = dondur(y, 17) ^ dondur(y, 19) ^ (y >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) | 0;
    }
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let i = h[7]!;
    for (let t = 0; t < 64; t++) {
      const s1 = dondur(e, 6) ^ dondur(e, 11) ^ dondur(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (i + s1 + ch + SHA256_K[t]! + w[t]!) | 0;
      const s0 = dondur(a, 2) ^ dondur(a, 13) ^ dondur(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      i = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0;
    h[5] = (h[5]! + f) | 0;
    h[6] = (h[6]! + g) | 0;
    h[7] = (h[7]! + i) | 0;
  }

  let cikti = "";
  for (let n = 0; n < 8; n++) {
    const parca = (h[n]! >>> 0).toString(16);
    cikti += "00000000".slice(parca.length) + parca;
  }
  return cikti;
}
