/**
 * H4.0 bayatlama denetiminin kaynak taraması: küçük bir TypeScript sözcük çözümleyicisi (yorum, dizge,
 * şablon dizgesi, düzenli ifade değişmezi ayrılır). Amaç tam ayrıştırma değil: dizge değişmezlerini,
 * adları ve `a.b` erişimlerini yorumlardan ve düzenli ifadelerden ayırarak okumak.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KAYNAK_DIZINI } from "./altin-kayit.ts";

export interface Belirtec {
  tur: "dizge" | "ad" | "isaret";
  deger: string;
}

const ANAHTAR_SOZCUKLER = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
  "instanceof",
]);

const AD_BASI = /[\p{L}_$]/u;
const AD_ICI = /[\p{L}\p{N}_$]/u;

/** Kaçışları basitçe çözer (`\x` → `x`, `\n` → satır sonu): karşılaştırma için yeterli. */
const kacisCoz = (s: string): string => s.replace(/\\(.)/gs, (_, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c));

export function belirtecler(kod: string): Belirtec[] {
  const t: Belirtec[] = [];
  const n = kod.length;
  let i = 0;
  let derinlik = 0;
  const sablonDerinlikleri: number[] = [];

  const regexOlabilir = (): boolean => {
    const p = t[t.length - 1];
    if (p === undefined) return true;
    if (p.tur === "dizge") return false;
    if (p.tur === "ad") return ANAHTAR_SOZCUKLER.has(p.deger);
    return !(p.deger === ")" || p.deger === "]" || p.deger === "}" || p.deger === "sayi" || p.deger === "regex");
  };

  /** `i` şablonun içinde: kapanışa ya da `${`'e kadar okur. */
  const sablonOku = (): void => {
    let parca = "";
    while (i < n) {
      const c = kod[i]!;
      if (c === "\\") {
        parca += kod.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === "`") {
        i++;
        t.push({ tur: "dizge", deger: kacisCoz(parca) });
        return;
      }
      if (c === "$" && kod[i + 1] === "{") {
        i += 2;
        t.push({ tur: "dizge", deger: kacisCoz(parca) });
        sablonDerinlikleri.push(derinlik);
        derinlik++;
        return;
      }
      parca += c;
      i++;
    }
  };

  while (i < n) {
    const c = kod[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && kod[i + 1] === "/") {
      const s = kod.indexOf("\n", i);
      i = s < 0 ? n : s;
      continue;
    }
    if (c === "/" && kod[i + 1] === "*") {
      const s = kod.indexOf("*/", i + 2);
      i = s < 0 ? n : s + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < n && kod[j] !== c && kod[j] !== "\n") {
        if (kod[j] === "\\") {
          s += kod.slice(j, j + 2);
          j += 2;
          continue;
        }
        s += kod[j];
        j++;
      }
      i = j + 1;
      t.push({ tur: "dizge", deger: kacisCoz(s) });
      continue;
    }
    if (c === "`") {
      i++;
      sablonOku();
      continue;
    }
    if (c === "/" && regexOlabilir()) {
      let j = i + 1;
      let sinif = false;
      while (j < n && kod[j] !== "\n") {
        const d = kod[j];
        if (d === "\\") {
          j += 2;
          continue;
        }
        if (d === "[") sinif = true;
        else if (d === "]") sinif = false;
        else if (d === "/" && !sinif) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(kod[j]!)) j++;
      i = j;
      t.push({ tur: "isaret", deger: "regex" });
      continue;
    }
    if (AD_BASI.test(c)) {
      let j = i + 1;
      while (j < n && AD_ICI.test(kod[j]!)) j++;
      t.push({ tur: "ad", deger: kod.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(kod[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && /[0-9a-zA-Z_.]/.test(kod[j]!)) j++;
      t.push({ tur: "isaret", deger: "sayi" });
      i = j;
      continue;
    }
    if (c === "?" && kod[i + 1] === "." && !/[0-9]/.test(kod[i + 2] ?? "")) {
      t.push({ tur: "isaret", deger: "?." });
      i += 2;
      continue;
    }
    if (c === "{") derinlik++;
    if (c === "}") {
      if (sablonDerinlikleri.length > 0 && sablonDerinlikleri[sablonDerinlikleri.length - 1] === derinlik - 1) {
        sablonDerinlikleri.pop();
        derinlik--;
        i++;
        sablonOku();
        continue;
      }
      derinlik--;
    }
    t.push({ tur: "isaret", deger: c });
    i++;
  }
  return t;
}

// ---------------------------------------------------------------------------------------------
// Kaynak dosyaları
// ---------------------------------------------------------------------------------------------

export interface KaynakDosyasi {
  /** `src`'ye göre, `/` ile. */
  ad: string;
  metin: string;
  belirtecler: Belirtec[];
}

let onbellek: KaynakDosyasi[] | null = null;

export function kaynaklar(): KaynakDosyasi[] {
  if (onbellek !== null) return onbellek;
  onbellek = readdirSync(KAYNAK_DIZINI, { recursive: true, encoding: "utf8" })
    .map((y) => y.replaceAll("\\", "/"))
    .filter((y) => y.endsWith(".ts"))
    .sort()
    .map((ad) => {
      const metin = readFileSync(join(KAYNAK_DIZINI, ad), "utf8");
      return { ad, metin, belirtecler: belirtecler(metin) };
    });
  return onbellek;
}

/** Dosya adı desenine uyan kaynaklar (`konusma` → `konusma.ts`, `konusma-metin.ts`...). */
export function secilenler(onekler: readonly string[]): KaynakDosyasi[] {
  return kaynaklar().filter((k) => {
    const ad = k.ad.slice(k.ad.lastIndexOf("/") + 1);
    return onekler.some((o) => ad === `${o}.ts` || ad.startsWith(`${o}-`) || ad.startsWith(`${o}.`));
  });
}

export interface Bulgu {
  deger: string;
  dosya: string;
}

/** Bütün dizge değişmezleri (şablon parçaları dahil). */
export function dizgeler(dosyalar: readonly KaynakDosyasi[], suzgec: RegExp): Bulgu[] {
  const b: Bulgu[] = [];
  for (const d of dosyalar) for (const x of d.belirtecler) if (x.tur === "dizge" && suzgec.test(x.deger)) b.push({ deger: x.deger, dosya: d.ad });
  return b;
}

/** `ad :` (nesne anahtarı ya da tip alanı; üçlü işleçteki `a ? b : c` de düşer, desenle süzülür). */
export function anahtarAdlari(dosyalar: readonly KaynakDosyasi[], suzgec: RegExp): Bulgu[] {
  const b: Bulgu[] = [];
  for (const d of dosyalar) {
    const t = d.belirtecler;
    for (let i = 0; i + 1 < t.length; i++) {
      const x = t[i]!;
      if ((x.tur === "ad" || x.tur === "dizge") && suzgec.test(x.deger) && t[i + 1]!.deger === ":") b.push({ deger: x.deger, dosya: d.ad });
    }
  }
  return b;
}

/** `nesne.X` ya da `nesne?.X`: X'ler. */
export function uyeler(dosyalar: readonly KaynakDosyasi[], nesne: string): Bulgu[] {
  const b: Bulgu[] = [];
  for (const d of dosyalar) {
    const t = d.belirtecler;
    for (let i = 0; i + 2 < t.length; i++) {
      const a = t[i]!;
      const nokta = t[i + 1]!;
      const u = t[i + 2]!;
      if (a.tur === "ad" && a.deger === nesne && nokta.tur === "isaret" && (nokta.deger === "." || nokta.deger === "?.") && u.tur === "ad") {
        // `x.nesne.X` değil: önceki belirteç nokta olmamalı.
        const once = t[i - 1];
        if (once !== undefined && once.tur === "isaret" && (once.deger === "." || once.deger === "?.")) continue;
        b.push({ deger: u.deger, dosya: d.ad });
      }
    }
  }
  return b;
}

/** `nesne.yontem("X"`: X'ler. */
export function cagriDizgeleri(dosyalar: readonly KaynakDosyasi[], nesne: string, yontem: string): Bulgu[] {
  const b: Bulgu[] = [];
  for (const d of dosyalar) {
    const t = d.belirtecler;
    for (let i = 0; i + 4 < t.length; i++) {
      if (t[i]!.deger === nesne && t[i + 1]!.deger === "." && t[i + 2]!.deger === yontem && t[i + 3]!.deger === "(" && t[i + 4]!.tur === "dizge") {
        b.push({ deger: t[i + 4]!.deger, dosya: d.ad });
      }
    }
  }
  return b;
}

/** `case "X"`: X'ler. */
export function caseDizgeleri(dosyalar: readonly KaynakDosyasi[]): Bulgu[] {
  const b: Bulgu[] = [];
  for (const d of dosyalar) {
    const t = d.belirtecler;
    for (let i = 0; i + 1 < t.length; i++) if (t[i]!.deger === "case" && t[i + 1]!.tur === "dizge") b.push({ deger: t[i + 1]!.deger, dosya: d.ad });
  }
  return b;
}

/** `export interface Ad {` ... eşleşen `}`: üst düzey alan adları (`ad:`, `ad?:`, `ad(`). */
export function arayuzAlanlari(dosya: KaynakDosyasi, ad: string): string[] {
  const t = dosya.belirtecler;
  for (let i = 0; i + 2 < t.length; i++) {
    if (t[i]!.deger !== "interface" || t[i + 1]!.deger !== ad) continue;
    let j = i + 2;
    while (j < t.length && t[j]!.deger !== "{") j++;
    let d = 0;
    const alanlar: string[] = [];
    for (; j < t.length; j++) {
      const x = t[j]!;
      if (x.deger === "{") d++;
      else if (x.deger === "}") {
        d--;
        if (d === 0) break;
      } else if (d === 1 && x.tur === "ad") {
        const sonraki = t[j + 1]?.deger;
        const once = t[j - 1]?.deger;
        const basta = once === "{" || once === ";" || once === "}" || once === "readonly" || once === ",";
        if (basta && (sonraki === ":" || sonraki === "?" || sonraki === "(" || sonraki === "<")) alanlar.push(x.deger);
      }
    }
    return alanlar;
  }
  throw new Error(`arayüz bulunamadı: ${ad} (${dosya.ad})`);
}

/** `export type Ad =` ... sonraki üst düzey `;`: içindeki `tur: "X"` değerleri. */
export function birlesimTurleri(dosya: KaynakDosyasi, ad: string, alan: string): string[] {
  const t = dosya.belirtecler;
  for (let i = 0; i + 2 < t.length; i++) {
    if (t[i]!.deger !== "type" || t[i + 1]!.deger !== ad || t[i + 2]!.deger !== "=") continue;
    const degerler: string[] = [];
    let d = 0;
    for (let j = i + 3; j < t.length; j++) {
      const x = t[j]!;
      if (x.deger === "{" || x.deger === "(" || x.deger === "[" || x.deger === "<") d++;
      else if (x.deger === "}" || x.deger === ")" || x.deger === "]" || x.deger === ">") d--;
      else if (x.deger === ";" && d === 0) break;
      if (x.tur === "ad" && x.deger === alan && t[j + 1]?.deger === ":" && t[j + 2]?.tur === "dizge") degerler.push(t[j + 2]!.deger);
    }
    return degerler;
  }
  throw new Error(`tip bulunamadı: ${ad} (${dosya.ad})`);
}
