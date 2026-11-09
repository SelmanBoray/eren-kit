import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// MODULLER.md genel kural 3 ve 7, "ana" bölümü: mimari taraması.
const KAYNAK_DIZINI = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// [karar] Bu dosyalar yasak içe aktarma ve API'lerden muaftır.
const MUAF = new Set(["dis-dunya.ts", "ana.ts", "kopru.ts", "eslestir.ts", "bekci-ana.ts"]);
const SOZLESME = "sozlesme.ts";

const dosyalar = (): string[] =>
  readdirSync(KAYNAK_DIZINI, { recursive: true, encoding: "utf8" })
    .map((y) => y.replaceAll("\\", "/"))
    .filter((y) => y.endsWith(".ts"))
    .sort();

const oku = (yol: string): string => readFileSync(join(KAYNAK_DIZINI, yol), "utf8");
const ad = (yol: string): string => yol.slice(yol.lastIndexOf("/") + 1);

// Yorumları boşlukla değiştirir, satırlar korunur. Dizge içeriği isteğe bağlı boşaltılır.
// Düzenli ifade değişmezleri ele alınmaz.
const ayikla = (kod: string, dizgeBosalt: boolean): string => {
  let s = "";
  let i = 0;
  const yigin: number[] = []; // açık `${` başına küme parantezi derinliği
  const bos = (c: string): string => (c === "\n" ? "\n" : " ");
  const dizge = (kapan: string): void => {
    s += kapan;
    i++;
    while (i < kod.length && kod[i] !== kapan) {
      if (kod[i] === "\\") {
        s += dizgeBosalt ? "  " : kod.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (kod[i] === "\n") break;
      s += dizgeBosalt ? " " : (kod[i] as string);
      i++;
    }
    if (i < kod.length) {
      s += kod[i];
      i++;
    }
  };
  const sablon = (): void => {
    while (i < kod.length) {
      const c = kod[i] as string;
      if (c === "\\") {
        s += dizgeBosalt ? "  " : kod.slice(i, i + 2);
        i += 2;
      } else if (c === "`") {
        s += c;
        i++;
        return;
      } else if (c === "$" && kod[i + 1] === "{") {
        s += "${";
        i += 2;
        yigin.push(0);
        return;
      } else {
        s += dizgeBosalt ? bos(c) : c;
        i++;
      }
    }
  };
  while (i < kod.length) {
    const c = kod[i] as string;
    const sonraki = kod[i + 1];
    if (c === "/" && sonraki === "/") {
      while (i < kod.length && kod[i] !== "\n") {
        s += " ";
        i++;
      }
    } else if (c === "/" && sonraki === "*") {
      while (i < kod.length && !(kod[i] === "*" && kod[i + 1] === "/")) {
        s += bos(kod[i] as string);
        i++;
      }
      s += "  ";
      i += 2;
    } else if (c === '"' || c === "'") {
      dizge(c);
    } else if (c === "`") {
      s += c;
      i++;
      sablon();
    } else {
      if (yigin.length > 0) {
        const son = yigin.length - 1;
        if (c === "{") yigin[son] = (yigin[son] as number) + 1;
        else if (c === "}") {
          if (yigin[son] === 0) {
            yigin.pop();
            s += c;
            i++;
            sablon();
            continue;
          }
          yigin[son] = (yigin[son] as number) - 1;
        }
      }
      s += c;
      i++;
    }
  }
  return s;
};

const satir = (kod: string, indeks: number): number => {
  let n = 1;
  for (let i = 0; i < indeks; i++) if (kod[i] === "\n") n++;
  return n;
};

const bildir = (ihlaller: string[], aciklama: string): void => {
  assert.equal(ihlaller.length, 0, `${aciklama}:\n${ihlaller.join("\n")}`);
};

const YASAK_MODULLER = ["child_process", "fs", "net", "os", "crypto", "ws"];
const modulAdi = (m: string): string => (m.startsWith("node:") ? m.slice(5) : m);

// `from "x"`, çıplak `import "x"`, `import("x")`, `require("x")` belirteçleri.
const BELIRTEC = /\b(?:from|import|require)\s*\(?\s*(["'])([^"'\n]+)\1/g;

const YASAK_API: ReadonlyArray<readonly [string, RegExp]> = [
  ["fetch", /(?<![\w$.])(?:globalThis\.)?fetch\b/g],
  ["Date.now", /(?<![\w$.])(?:globalThis\.)?Date\s*\.\s*now\b/g],
  ["Math.random", /(?<![\w$.])(?:globalThis\.)?Math\s*\.\s*random\b/g],
  ["setTimeout", /(?<![\w$.])(?:globalThis\.)?setTimeout\b/g],
  ["setInterval", /(?<![\w$.])(?:globalThis\.)?setInterval\b/g],
  ["console.*", /(?<![\w$.])(?:globalThis\.)?console\s*\./g],
  ["process.env", /(?<![\w$.])(?:globalThis\.)?process\s*\.\s*env\b/g],
];

describe("mimari tarama (genel kural 3, 7)", () => {
  const liste = dosyalar();

  it("kaynak dizini dinamik listelenir ve sözleşme vardır", () => {
    assert.ok(liste.includes(SOZLESME), "sozlesme.ts bulunamadı");
    assert.ok(liste.length > 1);
  });

  it("yasak modülleri içe aktaran yok (istisnalar dışında)", () => {
    const ihlaller: string[] = [];
    for (const yol of liste) {
      if (MUAF.has(ad(yol))) continue;
      const kod = ayikla(oku(yol), false);
      for (const e of kod.matchAll(BELIRTEC)) {
        const b = e[2] as string;
        const m = modulAdi(b);
        if (YASAK_MODULLER.includes(m) || m.startsWith("fs/")) {
          ihlaller.push(`${yol}:${satir(kod, e.index)}: yasak içe aktarma "${b}"`);
        }
      }
    }
    bildir(ihlaller, "Yasak içe aktarma");
  });

  it("node:sqlite yalnız depo.ts'te; depo.ts'te yalnız node:sqlite ve saf node:path", () => {
    const ihlaller: string[] = [];
    for (const yol of liste) {
      const dosyaAdi = ad(yol);
      if (MUAF.has(dosyaAdi)) continue;
      const kod = ayikla(oku(yol), false);
      for (const e of kod.matchAll(BELIRTEC)) {
        const b = e[2] as string;
        if (b === "node:sqlite" && dosyaAdi !== "depo.ts") {
          ihlaller.push(`${yol}:${satir(kod, e.index)}: node:sqlite yalnız depo.ts'te`);
        }
        if (dosyaAdi === "depo.ts" && b.startsWith("node:") && b !== "node:sqlite" && !b.startsWith("node:path")) {
          ihlaller.push(`${yol}:${satir(kod, e.index)}: depo.ts'te "${b}" (yalnız node:sqlite)`);
        }
      }
    }
    bildir(ihlaller, "node:sqlite kuralı");
  });

  it("yasak API'ler kullanılmaz (istisnalar dışında)", () => {
    const ihlaller: string[] = [];
    for (const yol of liste) {
      if (MUAF.has(ad(yol))) continue;
      const kod = ayikla(oku(yol), true);
      for (const [etiket, desen] of YASAK_API) {
        for (const e of kod.matchAll(desen)) {
          ihlaller.push(`${yol}:${satir(kod, e.index)}: yasak API ${etiket}`);
        }
      }
    }
    bildir(ihlaller, "Yasak API");
  });

  it("sozlesme.ts dışındaki dosyalar sözleşmeyi yalnız `import type` ile alır", () => {
    const ihlaller: string[] = [];
    // `import X from`, `import { type X } from`, çıplak `import "..."`, `export ... from`
    const degerImport = /\bimport\s+(?!type\s)[^;"'`]*?\bfrom\s*["'][^"'\n]*sozlesme[^"'\n]*["']/g;
    const cuplakImport = /\bimport\s*["'][^"'\n]*sozlesme[^"'\n]*["']/g;
    const disaAktar = /\bexport\s+(?!type\s)[^;"'`]*?\bfrom\s*["'][^"'\n]*sozlesme[^"'\n]*["']/g;
    const dinamik = /\bimport\s*\(\s*["'][^"'\n]*sozlesme/g;
    for (const yol of liste) {
      if (ad(yol) === SOZLESME) continue;
      const kod = ayikla(oku(yol), false);
      for (const [desen, etiket] of [
        [degerImport, "değer olarak içe aktarılmış"],
        [cuplakImport, "çıplak içe aktarma"],
        [disaAktar, "yeniden dışa aktarılmış (export type olmalı)"],
        [dinamik, "dinamik içe aktarma"],
      ] as const) {
        for (const e of kod.matchAll(desen)) {
          ihlaller.push(`${yol}:${satir(kod, e.index)}: sözleşme ${etiket}`);
        }
      }
      for (const e of kod.matchAll(/\bimport\s+type\b[^;"'`]*?\bfrom\s*["']([^"'\n]*sozlesme[^"'\n]*)["']/g)) {
        if (e[1] !== "./sozlesme.ts") {
          ihlaller.push(`${yol}:${satir(kod, e.index)}: sözleşme yolu "./sozlesme.ts" olmalı, "${e[1]}" bulundu`);
        }
      }
    }
    bildir(ihlaller, "Sözleşme içe aktarması");
  });

  it("sozlesme.ts'te gövdeli işlev ve çalışma anı değeri yok", () => {
    const soyulmus = stripTypeScriptTypes(oku(SOZLESME), { mode: "strip" });
    let kalan = ayikla(soyulmus, false);
    kalan = kalan.replace(/\bimport\s[^;]*?\bfrom\s*["'][^"'\n]*["']\s*;?/g, "");
    kalan = kalan.replace(/\bimport\s*["'][^"'\n]*["']\s*;?/g, "");
    kalan = kalan.replace(/\bexport\s*\{\s*\}\s*;?/g, "");
    const kirpilmis = kalan.replace(/\s+/g, " ").trim();
    assert.equal(kirpilmis, "", `sozlesme.ts'te çalışma anı kodu kalıyor: ${kirpilmis.slice(0, 200)}`);
  });

  it("kaynakta kişisel yol kalıbı yok", () => {
    const desenler: ReadonlyArray<readonly [string, RegExp]> = [
      ["Windows kullanıcı yolu", /[A-Za-z]:[\\/]+Users[\\/]/gi],
      ["Git Bash/WSL kullanıcı yolu", /(?:^|[^\w])\/(?:mnt\/)?[a-z]\/Users\//gi],
      ["POSIX/mac kullanıcı yolu", /(?:^|[\s"'`(=])\/(?:home|Users)\/[^\s"'`/]+/g],
    ];
    const ihlaller: string[] = [];
    for (const yol of liste) {
      const kod = oku(yol);
      for (const [etiket, desen] of desenler) {
        for (const e of kod.matchAll(desen)) ihlaller.push(`${yol}:${satir(kod, e.index)}: ${etiket}`);
      }
    }
    bildir(ihlaller, "Kişisel yol");
  });
});
