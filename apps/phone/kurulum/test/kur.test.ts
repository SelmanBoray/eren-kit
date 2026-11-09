/**
 * kur.ts testleri: ortak sözleşmenin "Kurulum dizini düzeni" ve "kurulum/kur.ts" bölümlerinden
 * yazıldı. Gerçek repoya ya da %LOCALAPPDATA%'ya dokunmaz; her test os.tmpdir() altında sahte ağaç kurar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  uygulamaKoku,
  surumKopyala,
  guncelYap,
  guncelSha,
  oncekiSha,
  eskileriTemizle,
  bekciIstegi,
} from "../kur.ts";
import type { SurumBilgisi } from "../kur.ts";

const kokleri: string[] = [];

function gecici(onek: string): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `eren-kur-${onek}-`)));
  kokleri.push(d);
  return d;
}

function yaz(kok: string, goreli: string, icerik: string): void {
  const p = path.join(kok, goreli);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, icerik);
}

function sahteKaynak(): string {
  const k = gecici("kaynak");
  yaz(k, "package.json", '{"name":"kok"}');
  yaz(k, "server/package.json", '{"name":"server"}');
  yaz(k, "server/src/a.ts", "export const a = 1;\n");
  yaz(k, "server/src/alt/b.ts", "export const b = 2;\n");
  yaz(k, "server/test/x.test.ts", "// test\n");
  yaz(k, "protocol/package.json", '{"name":"@eren/protocol"}');
  yaz(k, "protocol/src/index.ts", "export const p = 3;\n");
  yaz(k, "kurulum/kur.ts", "export const k = 4;\n");
  yaz(k, "kurulum/test/y.test.ts", "// test\n");
  yaz(k, "node_modules/zod/package.json", '{"name":"zod"}');
  yaz(k, "node_modules/typescript/package.json", '{"name":"typescript"}');
  yaz(k, "node_modules/@types/node/package.json", '{"name":"@types/node"}');
  yaz(k, "node_modules/.bin/z", "#!/bin/sh\n");
  yaz(k, "node_modules/@eren/protocol/package.json", '{"name":"@eren/protocol"}');
  return k;
}

function bilgi(sha: string, tarih_ms = 1_700_000_000_000): SurumBilgisi {
  return { sha, dal: "yapim", tarih_ms };
}

function kopyala(kaynakKok: string, hedefKok: string, sha: string, tarih_ms?: number): string {
  return surumKopyala({ kaynakKok, hedefKok, bilgi: bilgi(sha, tarih_ms) });
}

function temizle(): void {
  while (kokleri.length > 0) {
    const d = kokleri.pop() as string;
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // geçici dizin silinemezse test sonucunu bozma
    }
  }
}

const A = "aaaaaaaaaa";
const B = "bbbbbbbbbb";

test("uygulamaKoku: <veri kökü>\\uygulama", () => {
  assert.equal(uygulamaKoku("C:\\X"), path.win32.join("C:\\X", "uygulama"));
  assert.equal(uygulamaKoku("C:\\X\\eren-kit"), "C:\\X\\eren-kit\\uygulama");
});

test("surumKopyala: düzen, surum.json, hariç tutulanlar, junction", () => {
  try {
    const kaynak = sahteKaynak();
    const hedef = gecici("hedef");
    const b = bilgi(A);
    const yol = surumKopyala({ kaynakKok: kaynak, hedefKok: hedef, bilgi: b });

    assert.equal(path.resolve(yol), path.resolve(hedef, "surumler", A));
    assert.ok(path.isAbsolute(yol));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(yol, "surum.json"), "utf8")), b);

    assert.ok(fs.existsSync(path.join(yol, "package.json")));
    assert.ok(fs.existsSync(path.join(yol, "server", "package.json")));
    assert.equal(fs.readFileSync(path.join(yol, "server", "src", "a.ts"), "utf8"), "export const a = 1;\n");
    assert.ok(fs.existsSync(path.join(yol, "server", "src", "alt", "b.ts")));
    assert.ok(fs.existsSync(path.join(yol, "protocol", "package.json")));
    assert.ok(fs.existsSync(path.join(yol, "protocol", "src", "index.ts")));
    assert.ok(fs.existsSync(path.join(yol, "kurulum", "kur.ts")));

    assert.ok(!fs.existsSync(path.join(yol, "server", "test")), "server\\test kopyalanmamalı");
    assert.ok(!fs.existsSync(path.join(yol, "kurulum", "test")), "kurulum\\test kopyalanmamalı");

    assert.ok(fs.existsSync(path.join(yol, "node_modules", "zod", "package.json")));
    assert.ok(!fs.existsSync(path.join(yol, "node_modules", "typescript")));
    assert.ok(!fs.existsSync(path.join(yol, "node_modules", "@types")));
    assert.ok(!fs.existsSync(path.join(yol, "node_modules", ".bin")));

    const baglanti = path.join(yol, "node_modules", "@eren", "protocol");
    assert.ok(fs.lstatSync(baglanti).isSymbolicLink(), "@eren/protocol junction/symlink olmalı");
    assert.equal(fs.realpathSync(baglanti), fs.realpathSync(path.join(yol, "protocol")));
    assert.ok(fs.existsSync(path.join(baglanti, "src", "index.ts")));

    assert.ok(!fs.existsSync(path.join(hedef, "surumler", `${A}.yeni`)), ".yeni artığı kalmamalı");
  } finally {
    temizle();
  }
});

test("surumKopyala: aynı sha ikinci çağrıda var olanı bozmadan aynı yolu döner", () => {
  try {
    const kaynak = sahteKaynak();
    const hedef = gecici("hedef");
    const y1 = kopyala(kaynak, hedef, A);
    const iz = path.join(y1, "server", "src", "iz.txt");
    fs.writeFileSync(iz, "dokunma");
    const y2 = kopyala(kaynak, hedef, A);
    assert.equal(y2, y1);
    assert.equal(fs.readFileSync(iz, "utf8"), "dokunma");
    assert.ok(fs.existsSync(path.join(y1, "surum.json")));
    assert.ok(!fs.existsSync(path.join(hedef, "surumler", `${A}.yeni`)));
  } finally {
    temizle();
  }
});

test("guncelYap: guncel junction'ı sürümü gösterir, eski sürüm silinmez, gecmis.json iki kayıt", () => {
  try {
    const kaynak = sahteKaynak();
    const hedef = gecici("hedef");
    const ya = kopyala(kaynak, hedef, A, 1000);
    const yb = kopyala(kaynak, hedef, B, 2000);

    guncelYap(hedef, A);
    assert.equal(fs.realpathSync(path.join(hedef, "guncel")), fs.realpathSync(ya));

    guncelYap(hedef, B);
    assert.equal(fs.realpathSync(path.join(hedef, "guncel")), fs.realpathSync(yb));

    assert.ok(fs.existsSync(ya), "eski sürüm dizini durmalı");
    assert.ok(fs.existsSync(path.join(ya, "surum.json")));
    assert.ok(fs.existsSync(path.join(ya, "server", "src", "a.ts")));
    assert.ok(fs.existsSync(path.join(ya, "node_modules", "zod", "package.json")));

    const gecmis = JSON.parse(fs.readFileSync(path.join(hedef, "gecmis.json"), "utf8")) as {
      sha: string;
      tarih_ms: number;
    }[];
    assert.equal(gecmis.length, 2);
    assert.equal(gecmis[0]?.sha, A);
    assert.equal(gecmis[1]?.sha, B);
    assert.equal(typeof gecmis[1]?.tarih_ms, "number");
  } finally {
    temizle();
  }
});

test("guncelYap: surum.json'u olmayan sha'da hata fırlatır", () => {
  try {
    const hedef = gecici("hedef");
    fs.mkdirSync(path.join(hedef, "surumler", "cccccccccc"), { recursive: true });
    assert.throws(() => guncelYap(hedef, "cccccccccc"));
    assert.throws(() => guncelYap(hedef, "yokyokyok0"));
    assert.equal(guncelSha(hedef), null);
  } finally {
    temizle();
  }
});

test("guncelSha: kurulum yokken null, sonra doğru sha", () => {
  try {
    const kaynak = sahteKaynak();
    const hedef = gecici("hedef");
    assert.equal(guncelSha(hedef), null);
    kopyala(kaynak, hedef, A, 1000);
    assert.equal(guncelSha(hedef), null);
    guncelYap(hedef, A);
    assert.equal(guncelSha(hedef), A);
    kopyala(kaynak, hedef, B, 2000);
    guncelYap(hedef, B);
    assert.equal(guncelSha(hedef), B);
  } finally {
    temizle();
  }
});

test("oncekiSha: tek sürümde null; A->B sonrası A; A->B->B sonrası yine A", () => {
  try {
    const kaynak = sahteKaynak();
    const hedef = gecici("hedef");
    assert.equal(oncekiSha(hedef), null);
    kopyala(kaynak, hedef, A, 1000);
    kopyala(kaynak, hedef, B, 2000);
    guncelYap(hedef, A);
    assert.equal(oncekiSha(hedef), null);
    guncelYap(hedef, B);
    assert.equal(oncekiSha(hedef), A);
    guncelYap(hedef, B);
    assert.equal(guncelSha(hedef), B);
    assert.equal(oncekiSha(hedef), A);
  } finally {
    temizle();
  }
});

test("eskileriTemizle: güncel ve önceki kalır, en yeniler tutulur, .yeni artığı silinir", () => {
  try {
    const kaynak = sahteKaynak();
    const hedef = gecici("hedef");
    const shalar = ["s1aaaaaaaa", "s2aaaaaaaa", "s3aaaaaaaa", "s4aaaaaaaa", "s5aaaaaaaa"];
    shalar.forEach((s, i) => kopyala(kaynak, hedef, s, 1000 * (i + 1)));
    // güncel = s2, önceki = s1 (ikisi de en eski)
    guncelYap(hedef, shalar[0] as string);
    guncelYap(hedef, shalar[1] as string);
    const artik = path.join(hedef, "surumler", "zzzzzzzzzz.yeni");
    fs.mkdirSync(path.join(artik, "server"), { recursive: true });
    fs.writeFileSync(path.join(artik, "server", "yarim.txt"), "yarim");

    const silinen = eskileriTemizle(hedef, 2);

    const kalan = fs.readdirSync(path.join(hedef, "surumler")).sort();
    assert.deepEqual(kalan, ["s1aaaaaaaa", "s2aaaaaaaa", "s4aaaaaaaa", "s5aaaaaaaa"]);
    assert.ok(!fs.existsSync(artik), ".yeni artığı silinmeli");
    assert.ok(silinen.includes("s3aaaaaaaa"));
    for (const k of kalan) assert.ok(!silinen.includes(k), `${k} tutulmalıydı`);
    assert.equal(guncelSha(hedef), "s2aaaaaaaa");
    assert.ok(fs.existsSync(path.join(hedef, "guncel", "server", "src", "a.ts")));
  } finally {
    temizle();
  }
});

test("bekciIstegi: Promise döner, zaman aşımı+1sn içinde çözülür, sonuç null ya da nesne", async () => {
  const zamanAsimi = 500;
  const bas = Date.now();
  const p = bekciIstegi("durum", zamanAsimi);
  assert.ok(p instanceof Promise);
  const sonuc = await p;
  const gecen = Date.now() - bas;
  assert.ok(gecen <= zamanAsimi + 1000, `çok uzun sürdü: ${gecen} ms`);
  assert.ok(sonuc === null || (typeof sonuc === "object" && !Array.isArray(sonuc)));
});

test("içe aktarma yan etkisiz: temiz süreçte hızlı, hatasız, çıktısız, dizin boş", () => {
  const cwd = gecici("iceaktar");
  try {
    const kurYolu = path.resolve(import.meta.dirname, "..", "kur.ts");
    const url = new URL(`file:///${kurYolu.replace(/\\/g, "/")}`).href;
    const bas = Date.now();
    const r = spawnSync(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", `await import(${JSON.stringify(url)});`],
      { cwd, encoding: "utf8", timeout: 15_000, windowsHide: true },
    );
    const gecen = Date.now() - bas;
    assert.equal(r.status, 0, `içe aktarma düştü: ${r.stderr}`);
    assert.equal(r.stdout, "");
    assert.deepEqual(fs.readdirSync(cwd), []);
    assert.ok(gecen < 10_000, `içe aktarma yavaş: ${gecen} ms`);
  } finally {
    temizle();
  }
});
