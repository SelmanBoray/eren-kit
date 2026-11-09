/**
 * Uçtan uca düzeneğin ortak yardımcıları: süreç listesi, boş port, bekleme, dosya, salt okunur depo.
 * Yalnız düzenek kullanır; servis kodu bunları görmez.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";

export const uyu = (ms: number): Promise<void> => new Promise((coz) => setTimeout(coz, ms));

export const bosPort = (): Promise<number> =>
  new Promise((coz, reddet) => {
    const s = createServer();
    s.once("error", reddet);
    s.listen({ host: "127.0.0.1", port: 0 }, () => {
      const adres = s.address();
      const port = typeof adres === "object" && adres !== null ? adres.port : 0;
      s.close(() => coz(port));
    });
  });

export interface SurecSatiri {
  pid: number;
  ppid: number;
  ad: string;
  olusturmaMs: number;
  komut: string;
}

const SUREC_BETIGI = [
  "$ErrorActionPreference='Stop'",
  "$e=[datetime]'1970-01-01T00:00:00Z'",
  "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId; ad=[string]$_.Name; c=[int64](($_.CreationDate.ToUniversalTime()-$e.ToUniversalTime()).TotalMilliseconds); k=[string]$_.CommandLine } } | ConvertTo-Json -Compress -Depth 2",
].join("; ");

export function surecler(): SurecSatiri[] {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SUREC_BETIGI], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ham = (r.stdout ?? "").trim();
  if (ham === "") return [];
  const j = JSON.parse(ham) as unknown;
  const dizi = (Array.isArray(j) ? j : [j]) as Array<{ pid: number; ppid: number; ad: string; c: number; k: string | null }>;
  return dizi.map((x) => ({ pid: x.pid, ppid: x.ppid, ad: x.ad, olusturmaMs: x.c, komut: x.k ?? "" }));
}

/** Kökler ve onların bütün torunları (ppid zinciri, oluşma anı ebeveynden sonra). */
export function torunlar(liste: SurecSatiri[], kokler: ReadonlyArray<{ pid: number; olusturmaMs: number }>): SurecSatiri[] {
  const bulunan = new Map<number, SurecSatiri>();
  for (const k of kokler) {
    const s = liste.find((x) => x.pid === k.pid && Math.abs(x.olusturmaMs - k.olusturmaMs) <= 2000);
    if (s !== undefined) bulunan.set(s.pid, s);
  }
  let degisti = true;
  while (degisti) {
    degisti = false;
    for (const s of liste) {
      if (bulunan.has(s.pid)) continue;
      const ata = bulunan.get(s.ppid);
      if (ata !== undefined && s.olusturmaMs >= ata.olusturmaMs - 1000) {
        bulunan.set(s.pid, s);
        degisti = true;
      }
    }
  }
  return [...bulunan.values()];
}

export function tekOldur(pid: number): void {
  spawnSync("taskkill.exe", ["/F", "/PID", String(pid)], { windowsHide: true, encoding: "utf8" });
}

export function jsonSatirlari<T = Record<string, unknown>>(yol: string): T[] {
  if (!existsSync(yol)) return [];
  const cikti: T[] = [];
  for (const satir of readFileSync(yol, "utf8").split(/\r?\n/)) {
    if (satir.trim() === "") continue;
    try {
      cikti.push(JSON.parse(satir) as T);
    } catch {
      // yarım son satır
    }
  }
  return cikti;
}

export function satirEkle(yol: string, kayit: unknown): void {
  appendFileSync(yol, `${JSON.stringify(kayit)}\n`);
}

/** Servisin depo dosyasını salt okunur açar; WAL'de ikinci okuyucu güvenlidir. */
export function depoOku<T>(vt: string, sql: string, ...parametreler: Array<string | number>): T[] {
  const db = new DatabaseSync(vt, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=5000");
    return db.prepare(sql).all(...parametreler) as T[];
  } finally {
    db.close();
  }
}

/** `claude` stream-json `result` satırlarından maliyet. */
export interface Maliyet {
  sonuc: number;
  usd: number;
  girdi: number;
  cikti: number;
  onbellekYazma: number;
  onbellekOkuma: number;
}

export const bosMaliyet = (): Maliyet => ({ sonuc: 0, usd: 0, girdi: 0, cikti: 0, onbellekYazma: 0, onbellekOkuma: 0 });

export function maliyetEkle(m: Maliyet, r: Record<string, unknown>): void {
  m.sonuc += 1;
  m.usd += typeof r["total_cost_usd"] === "number" ? (r["total_cost_usd"] as number) : 0;
  const u = (r["usage"] ?? {}) as Record<string, unknown>;
  const sayi = (k: string): number => (typeof u[k] === "number" ? (u[k] as number) : 0);
  m.girdi += sayi("input_tokens");
  m.cikti += sayi("output_tokens");
  m.onbellekYazma += sayi("cache_creation_input_tokens");
  m.onbellekOkuma += sayi("cache_read_input_tokens");
}

export const kisalt = (metin: string, boy = 160): string =>
  metin.length <= boy ? metin : `${metin.slice(0, boy)}...[+${metin.length - boy}]`;
