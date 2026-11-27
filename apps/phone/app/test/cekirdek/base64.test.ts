import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { MEDYA_SINIRLARI, parcaVerisiGecerliMi } from "@eren/protocol";
import { base64Kodla } from "../../src/cekirdek/base64.ts";
import { icerik } from "./sahte.ts";

/** Belirlenimci sözde rastgele baytlar (xorshift32). */
const rastgele = (n: number, tohum: number): Uint8Array => {
  const b = new Uint8Array(n);
  let x = tohum >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    b[i] = x & 0xff;
  }
  return b;
};

const buffer = (b: Uint8Array) => Buffer.from(b).toString("base64");

describe("base64Kodla", () => {
  it("0-5 bayt Buffer ile aynı", () => {
    for (let n = 0; n <= 5; n++) {
      const b = rastgele(n, 7 + n);
      assert.equal(base64Kodla(b), buffer(b), `n=${n}`);
    }
    assert.equal(base64Kodla(new Uint8Array(0)), "");
  });

  it("bilinen RFC 4648 örnekleri", () => {
    const metin = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
    const ornekler: [string, string][] = [
      ["f", "Zg=="],
      ["fo", "Zm8="],
      ["foo", "Zm9v"],
      ["foob", "Zm9vYg=="],
      ["fooba", "Zm9vYmE="],
      ["foobar", "Zm9vYmFy"],
    ];
    for (const [girdi, beklenen] of ornekler) assert.equal(base64Kodla(metin(girdi)), beklenen);
  });

  it("bütün bayt değerleri ve 62/63 (+, /) karakterleri", () => {
    const b = new Uint8Array(256);
    for (let i = 0; i < 256; i++) b[i] = i;
    assert.equal(base64Kodla(b), buffer(b));
    const ucUc = new Uint8Array([0xfb, 0xff, 0xbf, 0xff, 0xff, 0xff]);
    assert.equal(base64Kodla(ucUc), buffer(ucUc));
    assert.ok(base64Kodla(ucUc).includes("+") && base64Kodla(ucUc).includes("/"));
  });

  it("dilim sınırlarının çevresi (6144 bayt dilim) Buffer ile aynı", () => {
    for (const n of [6142, 6143, 6144, 6145, 6146, 12288, 12290, 18433]) {
      const b = rastgele(n, n);
      assert.equal(base64Kodla(b), buffer(b), `n=${n}`);
    }
  });

  it("tam parça (512 KiB) ve parça - 1, - 2: Buffer ile aynı ve parcaVerisiGecerliMi'den geçer", () => {
    for (const n of [MEDYA_SINIRLARI.PARCA_BAYT, MEDYA_SINIRLARI.PARCA_BAYT - 1, MEDYA_SINIRLARI.PARCA_BAYT - 2]) {
      const b = icerik(n, n);
      const k = base64Kodla(b);
      assert.equal(k, buffer(b), `n=${n}`);
      assert.equal(parcaVerisiGecerliMi(k), true, `n=${n}`);
    }
  });

  it("rastgele uzunluk ve içerik (200 deneme)", () => {
    for (let d = 0; d < 200; d++) {
      const n = rastgele(2, d + 1).reduce((a, x) => a * 256 + x, 0) % 20000;
      const b = rastgele(n, 1000 + d);
      const k = base64Kodla(b);
      assert.equal(k, buffer(b), `deneme ${d}, n=${n}`);
      if (n > 0) assert.equal(parcaVerisiGecerliMi(k), true);
    }
  });

  it("alt dizi (subarray) görünümünü doğru kodlar: alttaki tamponun başka baytlarına bakmaz", () => {
    const tam = rastgele(1000, 3);
    const alt = tam.subarray(17, 17 + 500);
    assert.equal(base64Kodla(alt), buffer(alt));
  });

  it("girdiyi değiştirmez", () => {
    const b = rastgele(1001, 9);
    const kopya = b.slice();
    base64Kodla(b);
    assert.deepEqual(b, kopya);
  });

  it("512 KiB kodlama hızlı (Node'da < 250 ms; Hermes ölçümü cihazda)", () => {
    const b = rastgele(MEDYA_SINIRLARI.PARCA_BAYT, 5);
    const bas = performance.now();
    for (let i = 0; i < 5; i++) base64Kodla(b);
    const ort = (performance.now() - bas) / 5;
    assert.ok(ort < 250, `ortalama ${ort.toFixed(1)} ms`);
  });

  it("üretim kodu Buffer, btoa ve düzenli ifade kullanmaz", () => {
    const kaynak = readFileSync(new URL("../../src/cekirdek/base64.ts", import.meta.url), "utf8")
      .split("\n")
      .filter((s) => !/^\s*(\*|\/\/|\/\*\*)/.test(s))
      .join("\n");
    assert.doesNotMatch(kaynak, /\bBuffer\b/);
    assert.doesNotMatch(kaynak, /\batob\b|\bbtoa\b/);
    assert.doesNotMatch(kaynak, /\bRegExp\b|\.(test|match|replace)\(/);
  });
});
