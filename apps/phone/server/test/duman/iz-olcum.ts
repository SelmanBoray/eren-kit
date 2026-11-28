/**
 * Duman koşusunun `~/.claude` ve `~/.claude.json` iz ölçümü (HARNESS-H4-PLAN.md bölüm 8, "İzler").
 *
 * SALT OKUMA. `~/.claude` altındaki her girdinin göreli yolu, boyutu ve değiştirilme zamanı; `~/.claude.json`'ın
 * anahtar yolları (üç düzeye kadar). Değerler yalnız bellekte özetlenir (sha256, dosyaya ve rapora yazılmaz);
 * raporda yalnız "eklendi / silindi / değişti" ve anahtar ya da dosya adı görünür. Dosya içeriği okunmaz
 * (`~/.claude.json` hariç: anahtarları için ayrıştırılır, değeri yazılmaz). Ev dizini raporda `~` olur.
 *
 * Koşu bu farkı yalnız raporlar; hiçbir şeyi geri yüklemez. `kendiIzleriniSil` istenirse (`--izleri-sil`)
 * yalnız koşudan ÖNCEKİ anlıkta olmayan ve adında koşunun belirteci ya da oturum kimliği geçen girdileri siler
 * ve listesini döndürür.
 *
 *   node --disable-warning=ExperimentalWarning test/duman/iz-olcum.ts      bugünkü durumun özeti + kısa taban fark
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";

export interface GirdiIzi {
  boyut: number;
  mtimeMs: number;
  dizin: boolean;
}

export interface IzAnligi {
  ms: number;
  ev: string;
  /** `~/.claude`'a göreli yol (`/` ayraçlı) → iz. */
  girdiler: Map<string, GirdiIzi>;
  okunamayan: number;
  claudeJson: { var: boolean; boyut: number; mtimeMs: number; anahtarlar: Map<string, string>; hata: string | null };
  sureMs: number;
}

const ozet = (v: unknown): string => createHash("sha256").update(JSON.stringify(v) ?? "undefined").digest("hex");

/** Nesneleri `derinlik` düzeyine kadar açar; daha derini ve diziler tek yaprak (özetlenmiş değer). */
function anahtarYollari(v: unknown, derinlik: number, on: string[], cikti: Map<string, string>): void {
  if (derinlik > 0 && v !== null && typeof v === "object" && !Array.isArray(v)) {
    const girdiler = Object.entries(v as Record<string, unknown>);
    if (girdiler.length === 0) cikti.set(JSON.stringify(on), ozet(v));
    for (const [k, alt] of girdiler) anahtarYollari(alt, derinlik - 1, [...on, k], cikti);
    return;
  }
  cikti.set(JSON.stringify(on), ozet(v));
}

/**
 * .NET (pwsh 7) ile tarama: `FindFirstFile` verisinden boyut ve zaman, dosya başına `stat` yok. Ölçüm
 * (2026-11-28, ~36 bin girdi): node `lstat` yürüyüşü 26 sn, bu 4,5 sn. pwsh yoksa `null` (node yürüyüşü).
 */
const PWSH_TARAMA = [
  "$ErrorActionPreference='Stop'",
  "$o=New-Object System.IO.EnumerationOptions",
  "$o.RecurseSubdirectories=$true; $o.IgnoreInaccessible=$true; $o.AttributesToSkip=0",
  "$sb=New-Object System.Text.StringBuilder",
  "foreach($f in [System.IO.DirectoryInfo]::new($env:IZ_KOK).EnumerateFileSystemInfos('*',$o)){ $d=[int](($f.Attributes -band [System.IO.FileAttributes]::Directory) -ne 0); $l=0; if($d -eq 0){$l=$f.Length}; [void]$sb.Append($d).Append([char]9).Append($l).Append([char]9).Append($f.LastWriteTimeUtc.Ticks).Append([char]9).Append($f.FullName).Append([char]10) }",
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::Out.Write($sb.ToString())",
].join("; ");
const EPOK_TIK = 621_355_968_000_000_000n;

function pwshTara(kok: string, girdiler: Map<string, GirdiIzi>): boolean {
  if (process.platform !== "win32") return false;
  const r = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", PWSH_TARAMA], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, IZ_KOK: kok },
  });
  if (r.status !== 0 || typeof r.stdout !== "string") return false;
  const on = `${kok.replace(/[\\/]+$/, "")}\\`.toLowerCase();
  for (const satir of r.stdout.split("\n")) {
    if (satir === "") continue;
    const [d, l, tik, ...ad] = satir.split("\t");
    const tam = ad.join("\t");
    if (d === undefined || l === undefined || tik === undefined || !tam.toLowerCase().startsWith(on)) continue;
    girdiler.set(tam.slice(on.length).split("\\").join("/"), {
      boyut: Number(l),
      mtimeMs: Number((BigInt(tik) - EPOK_TIK) / 10_000n),
      dizin: d === "1",
    });
  }
  return true;
}

export function izAnligiAl(ev = homedir()): IzAnligi {
  const bas = performance.now();
  const kok = join(ev, ".claude");
  const girdiler = new Map<string, GirdiIzi>();
  let okunamayan = 0;
  const gez = (dizin: string): void => {
    let adlar: string[];
    try {
      adlar = readdirSync(dizin);
    } catch {
      okunamayan++;
      return;
    }
    for (const ad of adlar) {
      const tam = join(dizin, ad);
      let s;
      try {
        s = lstatSync(tam);
      } catch {
        okunamayan++;
        continue;
      }
      const dizinMi = s.isDirectory();
      girdiler.set(relative(kok, tam).split(sep).join("/"), { boyut: dizinMi ? 0 : s.size, mtimeMs: Math.trunc(s.mtimeMs), dizin: dizinMi });
      if (dizinMi) gez(tam);
    }
  };
  if (existsSync(kok) && !pwshTara(kok, girdiler)) gez(kok);

  const jsonYolu = join(ev, ".claude.json");
  const claudeJson: IzAnligi["claudeJson"] = { var: false, boyut: 0, mtimeMs: 0, anahtarlar: new Map(), hata: null };
  if (existsSync(jsonYolu)) {
    claudeJson.var = true;
    try {
      const s = statSync(jsonYolu);
      claudeJson.boyut = s.size;
      claudeJson.mtimeMs = Math.trunc(s.mtimeMs);
      anahtarYollari(JSON.parse(readFileSync(jsonYolu, "utf8")) as unknown, 3, [], claudeJson.anahtarlar);
    } catch (e) {
      // Eşzamanlı yazımın ortasında okunmuş olabilir; değer yazılmaz, yalnız hatanın türü.
      claudeJson.hata = e instanceof Error ? e.name : "okunamadi";
    }
  }
  return { ms: Date.now(), ev, girdiler, okunamayan, claudeJson, sureMs: Math.round(performance.now() - bas) };
}

export interface IzFarki {
  eklenen: string[];
  silinen: string[];
  degisen: string[];
  json: { dosyaDegisti: boolean; eklenen: string[][]; silinen: string[][]; degisen: string[][]; hata: string | null };
}

export function izFarki(once: IzAnligi, sonra: IzAnligi): IzFarki {
  const eklenen: string[] = [];
  const silinen: string[] = [];
  const degisen: string[] = [];
  for (const [y, s] of sonra.girdiler) {
    const o = once.girdiler.get(y);
    if (o === undefined) eklenen.push(y);
    else if (!s.dizin && (o.boyut !== s.boyut || o.mtimeMs !== s.mtimeMs)) degisen.push(y);
  }
  for (const y of once.girdiler.keys()) if (!sonra.girdiler.has(y)) silinen.push(y);
  const ja = once.claudeJson.anahtarlar;
  const jb = sonra.claudeJson.anahtarlar;
  const cozul = (k: string): string[] => JSON.parse(k) as string[];
  return {
    eklenen: eklenen.sort(),
    silinen: silinen.sort(),
    degisen: degisen.sort(),
    json: {
      dosyaDegisti: once.claudeJson.boyut !== sonra.claudeJson.boyut || once.claudeJson.mtimeMs !== sonra.claudeJson.mtimeMs,
      eklenen: [...jb.keys()].filter((k) => !ja.has(k)).sort().map(cozul),
      silinen: [...ja.keys()].filter((k) => !jb.has(k)).sort().map(cozul),
      degisen: [...jb.keys()].filter((k) => ja.has(k) && ja.get(k) !== jb.get(k)).sort().map(cozul),
      hata: once.claudeJson.hata ?? sonra.claudeJson.hata,
    },
  };
}

/** Rapor için ad maskesi: ev dizini `~`, `\` → `/`. */
const maskele = (s: string, ev: string): string => {
  const e = ev.replace(/\\/g, "/");
  const n = s.replace(/\\/g, "/");
  return n.toLowerCase().startsWith(e.toLowerCase()) ? `~${n.slice(e.length)}` : n;
};

/**
 * Farkın raporu. `isaretler`: koşuya ait adlar (belirteç, oturum kimlikleri). Bunlardan birini taşıyan girdi
 * "bizim"; ötekiler "başka" (eşzamanlı canlı oturumlar olabilir, koşuya atfedilmez). `azami` kategori başına satır.
 */
export function izRaporu(f: IzFarki, ev: string, isaretler: readonly string[], azami = 40): string[] {
  const bizimMi = (s: string): boolean => isaretler.some((i) => i !== "" && s.toLowerCase().includes(i.toLowerCase()));
  const satirlar: string[] = [];
  const bolum = (baslik: string, liste: readonly string[]): void => {
    const b = liste.filter(bizimMi);
    const d = liste.filter((x) => !bizimMi(x));
    satirlar.push(`  ${baslik}: ${liste.length} (koşuya ait ${b.length}, başka ${d.length})`);
    for (const x of b.slice(0, azami)) satirlar.push(`    bizim  ${maskele(x, ev)}`);
    if (b.length > azami) satirlar.push(`    ... ${b.length - azami} bizim daha`);
    const ust = new Map<string, number>();
    for (const x of d) ust.set(x.split("/")[0] ?? x, (ust.get(x.split("/")[0] ?? x) ?? 0) + 1);
    for (const [k, n] of [...ust].sort((a, c) => c[1] - a[1]).slice(0, 12)) satirlar.push(`    başka  ${k}/… ${n}`);
  };
  satirlar.push("~/.claude:");
  bolum("eklenen", f.eklenen);
  bolum("değişen", f.degisen);
  bolum("silinen", f.silinen);
  const yol = (p: string[]): string => p.map((x) => maskele(x, ev)).join(" › ");
  satirlar.push(`~/.claude.json: dosya ${f.json.dosyaDegisti ? "DEĞİŞTİ" : "değişmedi"}${f.json.hata === null ? "" : ` (okuma hatası: ${f.json.hata})`}`);
  for (const [baslik, liste] of [
    ["eklenen anahtar", f.json.eklenen],
    ["değişen anahtar", f.json.degisen],
    ["silinen anahtar", f.json.silinen],
  ] as const) {
    satirlar.push(`  ${baslik}: ${liste.length}`);
    const sirali = [...liste].sort((a, c) => Number(bizimMi(c.join("/"))) - Number(bizimMi(a.join("/"))));
    for (const p of sirali.slice(0, azami)) satirlar.push(`    ${bizimMi(p.join("/")) ? "bizim " : "başka "} ${yol(p)}`);
    if (liste.length > azami) satirlar.push(`    ... ${liste.length - azami} daha`);
  }
  return satirlar;
}

/** Bugünkü durumun özeti (kuru kip): sayılar, bilinen iz klasörleri, önceki duman koşularından kalanlar. */
export function izOzeti(a: IzAnligi, sonDakikaMs = 120_000): string[] {
  let toplam = 0;
  let dosya = 0;
  const ust = new Map<string, { adet: number; bayt: number }>();
  const yakin: string[] = [];
  const duman: string[] = [];
  for (const [y, g] of a.girdiler) {
    if (!g.dizin) {
      dosya++;
      toplam += g.boyut;
    }
    const k = y.split("/")[0] ?? y;
    const u = ust.get(k) ?? { adet: 0, bayt: 0 };
    u.adet++;
    u.bayt += g.boyut;
    ust.set(k, u);
    if (!g.dizin && a.ms - g.mtimeMs <= sonDakikaMs) yakin.push(y);
    if (/eren-duman-/i.test(y) && !/eren-duman-/i.test(y.split("/").slice(0, -1).join("/"))) duman.push(y);
  }
  const bilinen = ["projects", "todos", "shell-snapshots", "session-env", "file-history", "debug", "backups", "sessions", "statsig", "logs", "ide", "history.jsonl", "paste-cache", "telemetry"];
  const satirlar = [
    `~/.claude: ${a.girdiler.size} girdi (${dosya} dosya, ${(toplam / 1_048_576).toFixed(1)} MB), okunamayan ${a.okunamayan}, tarama ${a.sureMs} ms`,
    `  bilinen iz yerleri: ${bilinen.map((b) => `${b} ${ust.get(b)?.adet ?? 0}`).join(", ")}`,
    `  son ${Math.round(sonDakikaMs / 1000)} sn içinde değişen dosya: ${yakin.length} (canlı oturumlar yazıyor demektir; koşu farkı bunlarla karışır)`,
    `  önceki duman koşularından kalan (adında eren-duman-): ${duman.length}${duman.length > 0 ? ` → ${duman.slice(0, 8).join(", ")}` : ""}`,
  ];
  const j = a.claudeJson;
  const ustAnahtar = new Set([...j.anahtarlar.keys()].map((k) => (JSON.parse(k) as string[])[0]));
  const projeler = new Set(
    [...j.anahtarlar.keys()].map((k) => JSON.parse(k) as string[]).filter((p) => p[0] === "projects" && p[1] !== undefined).map((p) => p[1]),
  );
  const dumanProje = [...projeler].filter((p) => p !== undefined && /eren-duman-/i.test(p));
  satirlar.push(
    `~/.claude.json: ${j.var ? `${(j.boyut / 1024).toFixed(0)} KB, ${ustAnahtar.size} üst anahtar, ${projeler.size} proje girdisi, adında eren-duman- geçen proje ${dumanProje.length}` : "yok"}${j.hata === null ? "" : ` (okuma hatası: ${j.hata})`}`,
  );
  return satirlar;
}

/**
 * Koşunun kendi izlerini siler: `sonra`da olup `once`da olmayan ve göreli yolunda bir işaret (belirteç ya da
 * oturum kimliği) geçen en sığ girdi. `once` yoksa (`--temizle`) yalnız belirteç işareti kullanılmalı: rastgele
 * belirteç başka bir oturumun adında geçmez. `~/.claude.json`'a dokunmaz. Silinenlerin listesini döndürür.
 */
export function kendiIzleriniSil(once: IzAnligi | null, sonra: IzAnligi, isaretler: readonly string[]): string[] {
  const kok = join(sonra.ev, ".claude");
  const adaylar = new Set<string>();
  for (const y of sonra.girdiler.keys()) {
    const parcalar = y.split("/");
    const i = parcalar.findIndex((p) => isaretler.some((s) => s !== "" && p.toLowerCase().includes(s.toLowerCase())));
    if (i < 0) continue;
    const aday = parcalar.slice(0, i + 1).join("/");
    if (once !== null && once.girdiler.has(aday)) continue;
    adaylar.add(aday);
  }
  const silinen: string[] = [];
  for (const a of [...adaylar].sort()) {
    if ([...adaylar].some((b) => b !== a && a.startsWith(`${b}/`))) continue;
    try {
      rmSync(join(kok, ...a.split("/")), { recursive: true, force: true });
      silinen.push(`~/.claude/${a}`);
    } catch (e) {
      silinen.push(`~/.claude/${a} SİLİNEMEDİ (${e instanceof Error ? e.name : "hata"})`);
    }
  }
  return silinen;
}

if (import.meta.main) {
  const a = izAnligiAl();
  for (const s of izOzeti(a)) process.stdout.write(`${s}\n`);
  const b = izAnligiAl();
  process.stdout.write(`\nTaban fark (iki salt okuma anlığı arasında, ${Math.round((b.ms - a.ms) / 1000)} sn; koşu yok):\n`);
  for (const s of izRaporu(izFarki(a, b), a.ev, [], 5)) process.stdout.write(`${s}\n`);
}
