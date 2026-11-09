import assert from "node:assert/strict";
import { test } from "node:test";
import { HATA_KODLARI, HataKodu } from "../src/index.ts";

test("hata listesi kapalıdır ve yinelenmez", () => {
  assert.equal(new Set(HATA_KODLARI).size, HATA_KODLARI.length);
  for (const kod of HATA_KODLARI) assert.equal(HataKodu.safeParse(kod).success, true, kod);
  assert.equal(HataKodu.safeParse("uyduruk").success, false);
  assert.equal(HataKodu.safeParse("").success, false);
  assert.equal(HataKodu.safeParse(1).success, false);
});

test("kararlardaki kodlar listededir", () => {
  for (const kod of ["telefon_bagli_degil", "belirsiz"]) {
    assert.ok((HATA_KODLARI as readonly string[]).includes(kod), kod);
  }
});

test("kodlar kablo biçimindedir", () => {
  for (const kod of HATA_KODLARI) assert.match(kod, /^[a-z][a-z_]*$/);
});
