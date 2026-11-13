import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AkisEtkinligi } from "@eren/protocol";
import { etkinlikMetni } from "../../src/ekranlar/etkinlikMetni.ts";

describe("etkinlikMetni etiketleri", () => {
  const beklenen: Array<[AkisEtkinligi, string]> = [
    ["dusunuyor", "düşünüyor"],
    ["yaziyor", "yazıyor"],
    ["komut", "komut çalıştırıyor"],
    ["dosya_okuma", "dosyalara bakıyor"],
    ["dosya_yazma", "dosya düzenliyor"],
    ["web", "internette arıyor"],
    ["plan", "iş başlatıyor"],
    ["is_bilgisi", "işlere bakıyor"],
    ["ekran", "bilgisayarı kullanıyor"],
    ["arac", "araç kullanıyor"],
  ];
  for (const [e, m] of beklenen) {
    it(`${e} etiketi`, () => {
      assert.equal(etkinlikMetni(e, 0), m);
    });
  }
});

describe("etkinlikMetni süre eki", () => {
  it("eşiğin altında ek yok", () => {
    assert.equal(etkinlikMetni("komut", 0), "komut çalıştırıyor");
    assert.equal(etkinlikMetni("komut", 4999), "komut çalıştırıyor");
  });
  it("saniye aşağı yuvarlanır", () => {
    assert.equal(etkinlikMetni("komut", 5000), "komut çalıştırıyor · 5 sn");
    assert.equal(etkinlikMetni("komut", 42900), "komut çalıştırıyor · 42 sn");
    assert.equal(etkinlikMetni("dusunuyor", 7000), "düşünüyor · 7 sn");
  });
  it("dakika biçimi", () => {
    assert.equal(etkinlikMetni("komut", 60000), "komut çalıştırıyor · 1 dk");
    assert.equal(etkinlikMetni("komut", 125000), "komut çalıştırıyor · 2 dk 5 sn");
  });
  it("yazıyor için süre eki yok", () => {
    assert.equal(etkinlikMetni("yaziyor", 90000), "yazıyor");
  });
  it("negatif ve sonlu olmayan süre ek almaz", () => {
    assert.equal(etkinlikMetni("plan", -5), "iş başlatıyor");
    assert.equal(etkinlikMetni("arac", NaN), "araç kullanıyor");
    assert.equal(etkinlikMetni("arac", Infinity), "araç kullanıyor");
  });
});
