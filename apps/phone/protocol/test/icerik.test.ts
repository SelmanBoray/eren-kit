import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const kok = new URL("../", import.meta.url);

function dosyalar(altKlasor: string): string[] {
  const klasor = new URL(`${altKlasor}/`, kok);
  return readdirSync(klasor, { recursive: true, encoding: "utf8" })
    .filter((ad) => /\.(ts|md|json)$/.test(ad))
    .map((ad) => `${altKlasor}/${ad.replaceAll("\\", "/")}`);
}

function oku(yol: string): string {
  return readFileSync(new URL(yol, kok), "utf8");
}

const kaynaklar = dosyalar("src");

test("kaynak klasörü boş değildir", () => {
  assert.ok(kaynaklar.length >= 10);
  assert.ok(kaynaklar.includes("src/index.ts"));
});

test("kaynak node: modülü ve Node'a özgü modül içe aktarmaz", () => {
  const ICE_AKTARMA = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|^import\s+)["']([^"']+)["']/gm;
  const NODE_MODULLERI = /^(?:node:|fs$|path$|crypto$|os$|net$|buffer$|stream$|util$|child_process$)/;
  let toplam = 0;
  for (const yol of kaynaklar) {
    for (const eslesme of oku(yol).matchAll(ICE_AKTARMA)) {
      toplam++;
      const modul = eslesme[1]!;
      assert.equal(NODE_MODULLERI.test(modul), false, `${yol}: ${modul}`);
      assert.ok(modul === "zod" || /^\.\/[a-z-]+\.ts$/.test(modul), `${yol}: ${modul}`);
    }
  }
  assert.ok(toplam > 10, "içe aktarma deseni hiçbir şey bulmadı");
});

test("kaynak Node ya da tarayıcı genel nesnesi kullanmaz", () => {
  const YASAK = /\b(?:Buffer|process|require|__dirname|__filename|TextEncoder|TextDecoder|crypto|globalThis)\b(?!["'])/;
  for (const yol of kaynaklar) {
    const yorumsuz = oku(yol)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.equal(YASAK.test(yorumsuz), false, yol);
  }
});

test("kaynak Hermes'te güvenilmeyen ortam işlevlerini kullanmaz", () => {
  const YASAK = /\.normalize\(|localeCompare|Intl\.|\beval\(|new Function|\bBigInt\b|\.isWellFormed\(/;
  for (const yol of kaynaklar) {
    assert.equal(YASAK.test(oku(yol)), false, yol);
  }
});

test("package.json yalnız zod'a bağımlıdır ve kaynaktan tüketilir", () => {
  const paket = JSON.parse(oku("package.json")) as {
    dependencies: Record<string, string>;
    devDependencies?: Record<string, string>;
    exports: Record<string, string>;
    main: string;
  };
  assert.deepEqual(Object.keys(paket.dependencies), ["zod"]);
  assert.equal(paket.devDependencies, undefined);
  assert.equal(paket.main, "./src/index.ts");
  assert.equal(paket.exports["."], "./src/index.ts");
});

test("paket kişisel yol ya da makine bilgisi içermez", () => {
  const YASAK = /C:\\Users|C:\/Users|\/home\/|AppData|@[a-z0-9-]+\.[a-z]{2,}|\b(?:192\.168|10\.\d+\.\d+)\.\d+/i;
  const hepsi = [...kaynaklar, ...dosyalar("test"), ...dosyalar("vektorler"), "README.md", "CIHAZ.md"];
  for (const yol of hepsi) {
    if (yol === "test/icerik.test.ts") continue;
    assert.equal(YASAK.test(oku(yol)), false, yol);
  }
});
