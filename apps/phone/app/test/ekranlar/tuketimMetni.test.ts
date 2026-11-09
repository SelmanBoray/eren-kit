import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTuketimi, maliyetMetni, tokenKisalt, toplamToken } from "../../src/ekranlar/tuketimMetni.ts";

const T = (o: Record<string, unknown> = {}) => ({
  girdi: 0,
  cache_yazma: 0,
  cache_okuma: 0,
  cikti: 0,
  sonuc_adet: 0,
  ...o,
});

describe("tokenKisalt", () => {
  it("1000 altı tam sayı", () => {
    assert.equal(tokenKisalt(0), "0");
    assert.equal(tokenKisalt(850), "850");
    assert.equal(tokenKisalt(999), "999");
  });
  it("bin biriminde bir ondalık, sondaki ,0 atılır", () => {
    assert.equal(tokenKisalt(1000), "1 bin");
    assert.equal(tokenKisalt(12300), "12,3 bin");
    assert.equal(tokenKisalt(999900), "999,9 bin");
    assert.equal(tokenKisalt(999949), "999,9 bin");
  });
  it("Mn biriminde iki ondalık, sondaki sıfırlar atılır", () => {
    assert.equal(tokenKisalt(1000000), "1 Mn");
    assert.equal(tokenKisalt(1240000), "1,24 Mn");
    assert.equal(tokenKisalt(1500000), "1,5 Mn");
    assert.equal(tokenKisalt(12345678), "12,35 Mn");
  });
  it("yuvarlama üst birime taşırsa üst birim yazılır", () => {
    assert.equal(tokenKisalt(999950), "1 Mn");
  });
});

describe("tokenKisalt Mr birimi", () => {
  it("milyar ve üstü iki ondalıkla Mr, sondaki sıfırlar atılır", () => {
    assert.equal(tokenKisalt(1000000000), "1 Mr");
    assert.equal(tokenKisalt(1234567890), "1,23 Mr");
    assert.equal(tokenKisalt(2000000000), "2 Mr");
  });
  it("Mn aralığında yuvarlama üst birime taşırsa Mr yazılır", () => {
    assert.equal(tokenKisalt(999995000), "1 Mr");
    assert.equal(tokenKisalt(999994999), "999,99 Mn");
  });
});

describe("maliyetMetni", () => {
  it("undefined ve null için null", () => {
    assert.equal(maliyetMetni(undefined), null);
    assert.equal(maliyetMetni(null as unknown as undefined), null);
  });
  it("sıfır", () => {
    assert.equal(maliyetMetni(0), "$0");
  });
  it("çok küçük tutar", () => {
    assert.equal(maliyetMetni(0.004), "< $0,01");
  });
  it("normal tutarlar", () => {
    assert.equal(maliyetMetni(2.344), "≈ $2,34");
    assert.equal(maliyetMetni(0.01), "≈ $0,01");
    assert.equal(maliyetMetni(12), "≈ $12,00");
  });
});

describe("toplamToken", () => {
  it("dört sayacı toplar, sonuc_adet ve maliyet dahil değil", () => {
    const t = T({ girdi: 1, cache_yazma: 20, cache_okuma: 300, cikti: 4000, sonuc_adet: 99, maliyet_usd: 5 });
    assert.equal(toplamToken(t as never), 4321);
  });
  it("hepsi sıfırsa sıfır", () => {
    assert.equal(toplamToken(T() as never), 0);
  });
});

describe("isTuketimi", () => {
  const rapor = {
    isler: [
      { is_id: 1, toplam: T({ girdi: 5 }) },
      { is_id: 2, toplam: T({ girdi: 7 }) },
    ],
  };
  it("rapor null ise null", () => {
    assert.equal(isTuketimi(null, 1), null);
  });
  it("iş listede yoksa null", () => {
    assert.equal(isTuketimi(rapor as never, 999), null);
  });
  it("iş listedeyse o toplam", () => {
    const s = isTuketimi(rapor as never, 2);
    assert.ok(s);
    assert.equal(s.girdi, 7);
  });
});
