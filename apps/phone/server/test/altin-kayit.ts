/**
 * H4.0 altın kayıtları: kayıt biçimi, normalleştirme ve karşılaştırma (yalnız test).
 *
 * Kayıt `test/altin/claude-<ad>.json`'dadır. Test kaydı yeniden üretip DOSYA METNİYLE bayt bayt karşılaştırır.
 * Kayıt yalnız `EREN_ALTIN_YAZ=1` ile yeniden yazılır (`ALTIN_YENIDEN_URET` komutu). Kaydı değiştiren commit
 * davranış değişikliğidir (HARNESS-H4-PLAN.md "H4.0").
 *
 * Normalleştirme (kişisel yol, zaman, rastgele değer kayda girmez):
 * - Sahte rastgele portun ürettiği her değer (`uuid`, `opakId`, `jeton`, `hex64`) ilk görülme sırasıyla
 *   `<uuid:1>`, `<opak:tur:1>`... olur. Değerler sahte ve belirlidir; yer tutucu, rastgele çağrı sayısına
 *   bağlı olmayan okunur bir kayıt verir.
 * - Sahte saatin başlangıcından (`T0`) sonraki her ms değeri `<t+N>` olur.
 * - `server` dizininin gerçek yolu (yalnız `Ayar.kopruBetigi`'nde, `import.meta.url`'den) `<server>` olur;
 *   JSON içinde kaçışlı (`\\`) hali de.
 * Geri kalan bütün yollar sahtedir (`C:\ornek\...`).
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RastgelePortu } from "../src/sozlesme.ts";

export const ALTIN_ORTAMI = "EREN_ALTIN_YAZ";
export const ALTIN_YENIDEN_URET =
  "apps/phone/server içinde: PowerShell `$env:EREN_ALTIN_YAZ='1'; node --disable-warning=ExperimentalWarning --test test/surucu-altin.test.ts; Remove-Item Env:EREN_ALTIN_YAZ`" +
  " (bash: `EREN_ALTIN_YAZ=1 node --disable-warning=ExperimentalWarning --test test/surucu-altin.test.ts`)";

const TEST_DIZINI = dirname(fileURLToPath(import.meta.url));
export const ALTIN_DIZINI = join(TEST_DIZINI, "altin");
export const SERVER_DIZINI = join(TEST_DIZINI, "..");
export const KAYNAK_DIZINI = join(SERVER_DIZINI, "src");

/** 2026-11-25 Çarşamba 12:00 İstanbul (UTC+3): takvimli satırların damgası sabit. */
export const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);
/** `<t+N>` yalnız bu pencere içindeki sayılara uygulanır (sahte saat bundan uzağa gitmez). */
const ZAMAN_PENCERESI_MS = 1_000_000_000;

export const yazmaKipi = (): boolean => process.env[ALTIN_ORTAMI] === "1";

export const altinYolu = (ad: string): string => join(ALTIN_DIZINI, `claude-${ad}.json`);

// ---------------------------------------------------------------------------------------------
// Rastgele değerlerin yer tutucuları
// ---------------------------------------------------------------------------------------------

export class YerTutucular {
  private readonly harita = new Map<string, string>();
  private readonly sayac = new Map<string, number>();

  ad(deger: string, tur: string): string {
    const var_ = this.harita.get(deger);
    if (var_ !== undefined) return var_;
    const n = (this.sayac.get(tur) ?? 0) + 1;
    this.sayac.set(tur, n);
    const yer = `<${tur}:${n}>`;
    this.harita.set(deger, yer);
    return yer;
  }

  /** Uzundan kısaya: bir değer başkasının içinde geçse de önce uzunu değişir. */
  girdiler(): Array<[string, string]> {
    return [...this.harita.entries()].sort((a, b) => b[0].length - a[0].length);
  }
}

/** Sahte rastgele portu sarar: her üretilen değer yer tutucuya bağlanır. Değerin kendisi değişmez. */
export function izliRastgele(r: RastgelePortu, yt: YerTutucular): RastgelePortu {
  const kaydet = (deger: string, tur: string): string => {
    yt.ad(deger, tur);
    return deger;
  };
  return {
    baytlar: (n) => r.baytlar(n),
    uuid: () => kaydet(r.uuid(), "uuid"),
    opakId: (on) => kaydet(r.opakId(on), `opak:${on}`),
    jeton: () => kaydet(r.jeton(), "jeton"),
    hex64: () => kaydet(r.hex64(), "hex64"),
  };
}

// ---------------------------------------------------------------------------------------------
// Normalleştirme
// ---------------------------------------------------------------------------------------------

const KACISLI = (s: string): string => JSON.stringify(s).slice(1, -1);

export function normallestir(v: unknown, yt?: YerTutucular): unknown {
  const degisimler: Array<[string, string]> = [];
  const server = SERVER_DIZINI.replace(/[\\/]+$/, "");
  degisimler.push([KACISLI(server), "<server>"], [server, "<server>"], [server.replaceAll("\\", "/"), "<server>"]);
  for (const [deger, yer] of yt?.girdiler() ?? []) degisimler.push([deger, yer]);
  const metin = (s: string): string => {
    let c = s;
    for (const [a, b] of degisimler) if (a !== "" && c.includes(a)) c = c.split(a).join(b);
    return c;
  };
  const yuru = (x: unknown): unknown => {
    if (typeof x === "string") return metin(x);
    if (typeof x === "number") return x >= T0 && x < T0 + ZAMAN_PENCERESI_MS ? `<t+${x - T0}>` : x;
    if (Array.isArray(x)) return x.map(yuru);
    if (x !== null && typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, d] of Object.entries(x)) if (d !== undefined) o[metin(k)] = yuru(d);
      return o;
    }
    return x;
  };
  // Önce JSON'a uygun hale (undefined düşer, Map/Set yok).
  return yuru(JSON.parse(JSON.stringify(v ?? null)) as unknown);
}

/**
 * stdin satırı ya da dosya metni: sıkı JSON ise ayrıştırılmış nesne (anahtar sırası korunur, yeniden
 * dizgeleştirince aynı baytlar), değilse `{ ham }`. Kayıt okunur kalır, bayt bilgisi kaybolmaz.
 */
export function jsonKaydi(metin: string): unknown {
  try {
    const o: unknown = JSON.parse(metin);
    if (JSON.stringify(o) === metin) return o;
  } catch {
    // ham kalır
  }
  return { ham: metin };
}

// ---------------------------------------------------------------------------------------------
// Biçim: kısa değerler tek satırda, uzunlar açılır. Belirli; dosya metni bununla karşılaştırılır.
// ---------------------------------------------------------------------------------------------

const SATIR_SINIRI = 110;

export function bicimle(v: unknown, girinti = ""): string {
  const tek = JSON.stringify(v);
  if (v === null || typeof v !== "object" || girinti.length + tek.length <= SATIR_SINIRI) return tek;
  const ic = `${girinti}  `;
  if (Array.isArray(v)) {
    if (v.length === 0) return tek;
    return `[\n${v.map((x) => ic + bicimle(x, ic)).join(",\n")}\n${girinti}]`;
  }
  const g = Object.entries(v as Record<string, unknown>);
  if (g.length === 0) return tek;
  return `{\n${g.map(([k, x]) => `${ic}${JSON.stringify(k)}: ${k === "iz" ? izBicimi(x, ic) : bicimle(x, ic)}`).join(",\n")}\n${girinti}}`;
}

/** İz: her olay tek satırda (bir satır = bir port çağrısı; fark okunur kalır). */
function izBicimi(v: unknown, girinti: string): string {
  if (!Array.isArray(v) || v.length === 0) return bicimle(v, girinti);
  const ic = `${girinti}  `;
  return `[\n${v.map((x) => ic + JSON.stringify(x)).join(",\n")}\n${girinti}]`;
}

// ---------------------------------------------------------------------------------------------
// Karşılaştırma
// ---------------------------------------------------------------------------------------------

export interface AltinBasligi {
  /** Kaydın neyi tuttuğu (insan için). */
  aciklama: string;
}

/**
 * `kayit` (normalleştirilmiş) dosyadakiyle bayt bayt aynı olmalı. `EREN_ALTIN_YAZ=1` ise dosya yazılır.
 * Fark varsa önce senaryo senaryo `deepStrictEqual` (okunur fark), sonra metin eşitliği.
 */
export function altinDenetle(ad: string, baslik: AltinBasligi, senaryolar: Record<string, unknown>): void {
  kayitDenetle({ kayit: `claude-${ad}`, yenidenUret: ALTIN_YENIDEN_URET }, baslik, senaryolar);
}

/**
 * Bir kayıt dosyası: `test/altin/<kayit>.json` ve onu yeniden üreten komut (ipucu ve dosyadaki `yeniden_uret`).
 * H4.0 kayıtları `claude-<ad>` ile `ALTIN_YENIDEN_URET`'tir (`altinDenetle`, `altinOku`); başka test dosyası kendi
 * komutunu verir (H5.0 `kopru-araclar`).
 */
export interface KayitDosyasi {
  kayit: string;
  yenidenUret: string;
}

/** `altinDenetle`'nin genel hali: aynı biçim, aynı karşılaştırma; dosya adı ve komut parametre. */
export function kayitDenetle(d: KayitDosyasi, baslik: AltinBasligi, senaryolar: Record<string, unknown>): void {
  const yol = join(ALTIN_DIZINI, `${d.kayit}.json`);
  const govde = { kayit: d.kayit, aciklama: baslik.aciklama, yeniden_uret: d.yenidenUret, senaryolar };
  const metin = `${bicimle(govde)}\n`;
  if (yazmaKipi()) {
    mkdirSync(ALTIN_DIZINI, { recursive: true });
    writeFileSync(yol, metin, "utf8");
    return;
  }
  const ipucu = `Altın kayıt farklı: test/altin/${d.kayit}.json. Davranış bilerek değiştiyse yeniden üret: ${d.yenidenUret}`;
  assert.ok(existsSync(yol), `Altın kayıt yok: test/altin/${d.kayit}.json. Üret: ${d.yenidenUret}`);
  const eski = readFileSync(yol, "utf8").replaceAll("\r\n", "\n");
  if (eski === metin) return;
  const eskiGovde = JSON.parse(eski) as { senaryolar?: Record<string, unknown> };
  const eskiSenaryolar = eskiGovde.senaryolar ?? {};
  assert.deepStrictEqual(Object.keys(senaryolar), Object.keys(eskiSenaryolar), `${ipucu}\n(senaryo listesi)`);
  for (const [k, v] of Object.entries(senaryolar)) {
    assert.deepStrictEqual(v, eskiSenaryolar[k], `${ipucu}\n(senaryo: ${k})`);
  }
  assert.equal(metin, eski, `${ipucu}\n(biçim ya da başlık)`);
}

/** Kapsam denetimi için: kayıt dosyasının senaryoları (yoksa atar). */
export function altinOku(ad: string): Record<string, unknown> {
  return kayitOku({ kayit: `claude-${ad}`, yenidenUret: ALTIN_YENIDEN_URET });
}

/** `altinOku`'nun genel hali. */
export function kayitOku(d: KayitDosyasi): Record<string, unknown> {
  const yol = join(ALTIN_DIZINI, `${d.kayit}.json`);
  assert.ok(existsSync(yol), `Altın kayıt yok: test/altin/${d.kayit}.json. Üret: ${d.yenidenUret}`);
  const g = JSON.parse(readFileSync(yol, "utf8")) as { senaryolar: Record<string, unknown> };
  return g.senaryolar;
}
