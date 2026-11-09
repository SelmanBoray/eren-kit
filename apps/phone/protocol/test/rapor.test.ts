import assert from "node:assert/strict";
import { test } from "node:test";
import { IsRaporu, isRaporuJsonSemasi, SINIRLAR } from "../src/index.ts";
import { RAPOR } from "./ornekler.ts";

test("geçerli rapor kabul edilir", () => {
  assert.equal(IsRaporu.safeParse(RAPOR).success, true);
  assert.equal(IsRaporu.safeParse({ yapildi: [], yapilmadi: [], dosyalar: [], acik_noktalar: [] }).success, true);
});

test("geçersiz rapor reddedilir", () => {
  const kotuler: [string, unknown][] = [
    ["alan eksik", { yapildi: [], yapilmadi: [], dosyalar: [] }],
    ["bilinmeyen alan", { ...RAPOR, fazla: 1 }],
    ["metin dizi yerine", { ...RAPOR, yapildi: "hepsi" }],
    ["sayı madde", { ...RAPOR, dosyalar: [1] }],
    ["madde sınırı", { ...RAPOR, yapildi: ["x".repeat(SINIRLAR.RAPOR_MADDE + 1)] }],
    ["adet sınırı", { ...RAPOR, yapilmadi: Array(SINIRLAR.RAPOR_MADDE_ADET + 1).fill("x") }],
    ["yol sınırı", { ...RAPOR, dosyalar: ["x".repeat(SINIRLAR.RAPOR_DOSYA_YOLU + 1)] }],
    ["yol adedi", { ...RAPOR, dosyalar: Array(SINIRLAR.RAPOR_DOSYA_ADET + 1).fill("x") }],
  ];
  for (const [ad, deger] of kotuler) assert.equal(IsRaporu.safeParse(deger).success, false, ad);
});

test("--json-schema metni dört alanı zorunlu ve kapalı verir", () => {
  const metin = isRaporuJsonSemasi();
  const sema = JSON.parse(metin) as {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, { type: string; maxItems: number; items: { type: string; maxLength: number } }>;
    $schema?: string;
  };
  assert.equal(sema.type, "object");
  assert.equal(sema.additionalProperties, false);
  assert.deepEqual(sema.required, ["yapildi", "yapilmadi", "dosyalar", "acik_noktalar"]);
  assert.deepEqual(Object.keys(sema.properties), ["yapildi", "yapilmadi", "dosyalar", "acik_noktalar"]);
  assert.equal(sema.$schema, undefined);
  for (const alan of Object.values(sema.properties)) {
    assert.equal(alan.type, "array");
    assert.equal(alan.items.type, "string");
    assert.ok(alan.maxItems > 0);
    assert.ok(alan.items.maxLength > 0);
  }
  assert.equal(sema.properties.yapildi!.maxItems, SINIRLAR.RAPOR_MADDE_ADET);
  assert.equal(sema.properties.dosyalar!.items.maxLength, SINIRLAR.RAPOR_DOSYA_YOLU);
});

test("--json-schema metni komut satırına sığacak kadar kısadır", () => {
  assert.ok(isRaporuJsonSemasi().length < 1024);
});
