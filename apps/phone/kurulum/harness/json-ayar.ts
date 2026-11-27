// Harness'ların JSON ayar dosyaları için güvenli okuyucu ve yazıcı (harness'tan bağımsız; bugün Claude Code
// `settings.json` kullanır). Kullanıcının dosyası hiçbir durumda bozulmaz: bozuk ya da UTF-16 dosyaya
// dokunulmaz, her yazmadan önce ezilmeyen zaman damgalı yedek alınır, sembolik bağ ve junction korunur
// (yazma hedefe yapılır), sabit bağlı dosya yerinde yazılır, BOM'lu dosya BOM'lu kalır. TOML gibi başka
// biçim kullanan harness kendi yazıcısını getirir ya da yalnız yönerge yazdırır (docs/HARNESS.md 4.3).
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import win32 from "node:path/win32";

export type Json = Record<string, unknown>;
export const nesneMi = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export class AyarHatasi extends Error {
  override name = "AyarHatasi";
}

export const BOM = "﻿";

/**
 * Ayar dosyası metni → nesne. Yoksa `{}`; bozuksa ya da nesne değilse atar (dosyaya dokunulmaz). Baştaki
 * UTF-8 BOM'u yok sayar: Claude Code BOM'lu ayarı okuyor (ölçüldü, 2.1.332), burada da geçerli sayılır.
 */
export function ayarCoz(metin: string | null): Json {
  const govde = metin?.startsWith(BOM) ? metin.slice(BOM.length) : metin;
  if (govde === null || govde === undefined || govde.trim() === "") return {};
  let j: unknown;
  try {
    j = JSON.parse(govde);
  } catch (e) {
    const ayrinti = e instanceof SyntaxError && e.message !== "" ? ` (${e.message})` : "";
    throw new AyarHatasi(`ayar dosyası geçerli JSON değil${ayrinti}; hiçbir şey değişmedi`);
  }
  if (!nesneMi(j)) throw new AyarHatasi("ayar dosyası bir JSON nesnesi değil; hiçbir şey değişmedi");
  return j;
}

/** Milisaniyeli UTC damga (`20261127T112835123Z`): yedek adının parçası. */
export const zamanDamgasi = (ms: number): string => new Date(ms).toISOString().replace(/[-:.]/g, "");

/** Yedek denemesi üst sınırı (aynı milisaniyede bu kadar işlem olmaz; olursa açık hata). */
const YEDEK_DENEME = 100;

/**
 * Özgün içeriğin yedeği `<yol>.yedek-<damga>[-n]`. Hiçbir yedeği ezmez (`COPYFILE_EXCL`): aynı damgada
 * yedek varsa (aynı anda ikinci işlem) sıradaki sayıyı dener. `kaynak` bağlantının hedefidir; yedek kullanıcının
 * baktığı yere, ayar yolunun yanına yazılır.
 */
export function yedekAl(yol: string, kaynak: string, simdiMs: number): string {
  const temel = `${yol}.yedek-${zamanDamgasi(simdiMs)}`;
  for (let n = 0; n < YEDEK_DENEME; n++) {
    const aday = n === 0 ? temel : `${temel}-${n}`;
    try {
      copyFileSync(kaynak, aday, constants.COPYFILE_EXCL);
      return aday;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new AyarHatasi(`yedek adı bulunamadı (${temel}…); hiçbir şey değişmedi`);
}

/**
 * Yedekle, yaz. Yedek yolunu döner (dosya yoksa `null`). Kullanıcının dosyası hiçbir durumda bozulmaz:
 * - Ayar yolu sembolik bağ ya da bir üst klasörü junction ise yazma bağın HEDEFİNE yapılır (`realpath`);
 *   bağ olduğu gibi kalır (yeniden adlandırma bağı düz dosyaya çevirirdi).
 * - Hedefin başka sabit bağı varsa (`nlink > 1`) yerinde yazılır (yeniden adlandırma bağları ayırırdı);
 *   yedek önceden alınmıştır. Öteki durumda geçici dosya + yeniden adlandırma (yarım dosya kalmaz).
 * - BOM'lu dosya BOM'lu kalır (Claude Code ikisini de okur; kullanıcının biçimi korunur).
 */
export function ayarYaz(yol: string, ayar: Json, simdiMs: number, bom: boolean): string | null {
  const metin = `${bom ? BOM : ""}${JSON.stringify(ayar, null, 2)}\n`;
  if (!existsSync(yol)) {
    mkdirSync(win32.dirname(yol), { recursive: true });
    writeFileSync(yol, metin, { encoding: "utf8", flag: "wx" });
    return null;
  }
  const hedef = realpathSync.native(yol);
  const yedek = yedekAl(yol, hedef, simdiMs);
  if (statSync(hedef).nlink > 1) {
    writeFileSync(hedef, metin, "utf8");
    return yedek;
  }
  const gecici = `${hedef}.yeni-${process.pid}-${zamanDamgasi(simdiMs)}`;
  writeFileSync(gecici, metin, { encoding: "utf8", flag: "wx" });
  try {
    renameSync(gecici, hedef);
  } catch (e) {
    rmSync(gecici, { force: true });
    throw e;
  }
  return yedek;
}

/**
 * Ayar dosyasının metni (`null`: yok) ve BOM'u. UTF-16 (PowerShell 5'in `Out-File` varsayılanı) ve kırık
 * bağlantı doğru nedenle reddedilir; dosyaya dokunulmaz.
 */
export function ayarOku(yol: string): { metin: string | null; bom: boolean } {
  if (!existsSync(yol)) {
    let bag = false;
    try {
      bag = lstatSync(yol).isSymbolicLink();
    } catch {
      bag = false;
    }
    if (bag) throw new AyarHatasi(`ayar yolu hedefi olmayan bir bağlantı (${yol}); elle bakılmalı, hiçbir şey değişmedi`);
    return { metin: null, bom: false };
  }
  const bayt = readFileSync(yol);
  if ((bayt[0] === 0xff && bayt[1] === 0xfe) || (bayt[0] === 0xfe && bayt[1] === 0xff)) {
    throw new AyarHatasi("ayar dosyası UTF-16 kodlanmış; UTF-8 olarak kaydedilmeli (ör. Set-Content -Encoding utf8). Hiçbir şey değişmedi");
  }
  const metin = bayt.toString("utf8");
  return { metin, bom: metin.startsWith(BOM) };
}
