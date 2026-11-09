import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { stripTypeScriptTypes } from "node:module";

// Cekmece.tsx react-native içe aktardığı ve Node .tsx yükleyemediği için saf zaman bölümünü
// (AYLAR .. zamanMetni sonu) kaynaktan çıkarıp ayrı modül olarak çalıştırırız.
const kaynak = readFileSync(new URL("../../src/ekranlar/Cekmece.tsx", import.meta.url), "utf8");
const bas = kaynak.indexOf("const AYLAR");
const son = kaynak.indexOf("function Rozet");
assert.ok(bas >= 0 && son > bas, "zaman bölümü bulunamadı");
const js = stripTypeScriptTypes(kaynak.slice(bas, son), { mode: "strip" });
const { zamanMetni } = (await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
)) as { zamanMetni: (ms: number, simdi?: number) => string };

const SIMDI = new Date(2026, 10, 9, 15, 0).getTime();

describe("zamanMetni", () => {
  it("etkinlik zamanı yoksa (0, NaN, negatif) boş döner; satırda zaman gösterilmez", () => {
    assert.equal(zamanMetni(0, SIMDI), "");
    assert.equal(zamanMetni(Number.NaN, SIMDI), "");
    assert.equal(zamanMetni(-5, SIMDI), "");
  });

  it("gerçek zamanların biçimi değişmez", () => {
    assert.equal(zamanMetni(new Date(2026, 10, 9, 14, 32).getTime(), SIMDI), "14:32");
    assert.equal(zamanMetni(new Date(2026, 10, 8, 9, 0).getTime(), SIMDI), "Dün");
    assert.equal(zamanMetni(new Date(2026, 10, 6, 9, 0).getTime(), SIMDI), "Cuma");
    assert.equal(zamanMetni(new Date(2026, 9, 3, 9, 0).getTime(), SIMDI), "3 Eki");
  });
});
