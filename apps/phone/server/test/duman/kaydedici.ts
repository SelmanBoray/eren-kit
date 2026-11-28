/**
 * Duman koşusunun kaydedici ara süreci. Servisin `claude_exe`'si başlatıcıdır (`baslatici.cs`, gerçek bir
 * `.exe`: `ayar.ts` `.cmd`/`.bat` kabul etmez); başlatıcı komut satırının geri kalanını DEĞİŞTİRMEDEN bu
 * betiğe verir:
 *
 *   node --disable-warning=ExperimentalWarning kaydedici.ts <kaydedici-ayari.json> <servisin argv'si...>
 *
 * Kaydedici süreç başına `<kayitDizini>\<pid>.jsonl`'a yazar: başlatma (argv, cwd, ortam anahtarları,
 * mcp dosyasının ham metni), stdin satırları, stdout satırları, stderr, çıkış. Her olay eşzamanlı
 * `appendFileSync`'tir: servis ağacı öldürse de o ana kadarki kayıt kalır.
 *
 * Gerçek `claude`'a giden argv'de iki şey değişebilir (kayıt servisin argv'sini tutar):
 * - `--model`: ayarda `model` doluysa (en ucuz modelle koşu).
 * - `--mcp-config`: komutu node olan sunuculara (köprüler) `--import <boru-yonlendir>` eklenmiş bir kopya.
 *   Köprü canlı servisin borusuna değil, duman servisinin borusuna bağlanır.
 *
 * stdin: `--input-format` varsa (ana oturum) boru; satırlar kaydedilir ve aynen geçer. Yoksa (iş oturumu,
 * servis `ignore` verir) kaydedicinin stdin tanıtıcısı doğrudan devredilir: üretimdeki gibi.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { KaydediciAyari, KaydediciOlayi, SurecKaydi } from "./tipler.ts";
import { DEGER_YAZILMADI, DEGERI_YAZILAN, ORTAM_DEGERI_KAYDEDILEN } from "./tipler.ts";

const degerAl = (argv: readonly string[], bayrak: string): string | null => {
  const i = argv.indexOf(bayrak);
  return i >= 0 && i + 1 < argv.length ? (argv[i + 1] ?? null) : null;
};

/** Köprü sunucularına önyükleme ekler; değişiklik yoksa `null`. Ayrıştırılamayan dosyaya dokunmaz. */
export function mcpKopyasi(icerik: string, nodeExe: string, onyukleme: string): string | null {
  let j: unknown;
  try {
    j = JSON.parse(icerik);
  } catch {
    return null;
  }
  const sunucular = (j as { mcpServers?: Record<string, { command?: unknown; args?: unknown }> }).mcpServers;
  if (sunucular === undefined || sunucular === null || typeof sunucular !== "object") return null;
  let degisti = false;
  for (const s of Object.values(sunucular)) {
    if (typeof s?.command !== "string") continue;
    const nodeMu = s.command.toLowerCase() === nodeExe.toLowerCase() || basename(s.command).toLowerCase() === "node.exe";
    if (!nodeMu) continue;
    const args = Array.isArray(s.args) ? (s.args as unknown[]) : [];
    s.args = ["--import", onyukleme, ...args];
    degisti = true;
  }
  return degisti ? JSON.stringify(j) : null;
}

/** Kayıt dizinindeki `<pid>.jsonl` dosyalarını sürecin kaydına toplar (başlama sırasıyla). */
export function kayitlariTopla(dizin: string): SurecKaydi[] {
  if (!existsSync(dizin)) return [];
  const cikti: SurecKaydi[] = [];
  for (const ad of readdirSync(dizin).filter((a) => /^\d+\.jsonl$/.test(a))) {
    let k: SurecKaydi | null = null;
    for (const satir of readFileSync(join(dizin, ad), "utf8").split("\n")) {
      if (satir.trim() === "") continue;
      let o: KaydediciOlayi;
      try {
        o = JSON.parse(satir) as KaydediciOlayi;
      } catch {
        continue; // öldürülen sürecin yarım son satırı
      }
      if (o.t === "baslat") {
        k = {
          pid: o.pid,
          baslangic_ms: o.ms,
          argv: o.argv,
          gercek_argv: o.gercek_argv,
          cwd: o.cwd,
          ortam: { anahtarlar: o.ortam_anahtarlari, degerler: o.ortam_degerleri },
          mcp: o.mcp,
          stdin: [],
          stdout: [],
          stderr: "",
          cikis: null,
        };
      } else if (k !== null) {
        if (o.t === "stdin") k.stdin.push(o.s);
        else if (o.t === "stdout") k.stdout.push(o.s);
        else if (o.t === "stderr") k.stderr += o.s;
        else if (o.t === "cikis") k.cikis = o.kod;
      }
    }
    if (k !== null) cikti.push(k);
  }
  return cikti.sort((a, b) => a.baslangic_ms - b.baslangic_ms || a.pid - b.pid);
}

/** Parça akışını satırlara böler (son yarım satır tamponda kalır). */
class SatirBolucu {
  private kalan = "";
  private readonly f: (satir: string) => void;
  constructor(f: (satir: string) => void) {
    this.f = f;
  }
  ekle(parca: string): void {
    const m = this.kalan + parca;
    const satirlar = m.split("\n");
    this.kalan = satirlar.pop() ?? "";
    for (const s of satirlar) this.f(s.endsWith("\r") ? s.slice(0, -1) : s);
  }
  bitir(): void {
    if (this.kalan !== "") this.f(this.kalan);
    this.kalan = "";
  }
}

function calistir(): void {
  const ayarYolu = process.argv[2];
  if (ayarYolu === undefined) {
    process.stderr.write("kaydedici: ayar yolu yok\n");
    process.exit(96);
  }
  const ayar = JSON.parse(readFileSync(ayarYolu, "utf8")) as KaydediciAyari;
  const argv = process.argv.slice(3);
  const yol = join(ayar.kayitDizini, `${process.pid}.jsonl`);
  const yaz = (o: KaydediciOlayi): void => appendFileSync(yol, `${JSON.stringify(o)}\n`);

  const gercekArgv = [...argv];
  const mi = gercekArgv.indexOf("--model");
  if (ayar.model !== null && mi >= 0 && mi + 1 < gercekArgv.length) gercekArgv[mi + 1] = ayar.model;

  const mcpYolu = degerAl(argv, "--mcp-config");
  let mcp: { yol: string; icerik: string | null } | null = null;
  if (mcpYolu !== null) {
    const icerik = existsSync(mcpYolu) ? readFileSync(mcpYolu, "utf8") : null;
    mcp = { yol: mcpYolu, icerik };
    const kopya = icerik === null ? null : mcpKopyasi(icerik, process.execPath, ayar.onyukleme);
    if (kopya !== null) {
      const kopyaYolu = join(ayar.kayitDizini, `mcp-${process.pid}.json`);
      writeFileSync(kopyaYolu, kopya, "utf8");
      gercekArgv[argv.indexOf("--mcp-config") + 1] = kopyaYolu;
    }
  }

  const anahtarlar = Object.keys(process.env);
  const degerler: Record<string, string> = {};
  for (const a of anahtarlar) {
    if (ORTAM_DEGERI_KAYDEDILEN.test(a)) degerler[a] = DEGERI_YAZILAN.test(a) ? (process.env[a] ?? "") : DEGER_YAZILMADI;
  }
  yaz({
    t: "baslat",
    ms: Date.now(),
    pid: process.pid,
    argv,
    gercek_argv: gercekArgv,
    cwd: process.cwd(),
    ortam_anahtarlari: anahtarlar,
    ortam_degerleri: degerler,
    mcp,
  });

  const boruluStdin = argv.includes("--input-format");
  const cocuk = spawn(ayar.gercekClaude, gercekArgv, {
    cwd: process.cwd(),
    env: process.env,
    stdio: [boruluStdin ? "pipe" : "inherit", "pipe", "pipe"],
    windowsHide: true,
  });

  if (boruluStdin && cocuk.stdin !== null) {
    const giris = new SatirBolucu((s) => yaz({ t: "stdin", ms: Date.now(), s }));
    cocuk.stdin.on("error", () => {});
    process.stdin.on("data", (p: Buffer) => {
      giris.ekle(p.toString("utf8"));
      cocuk.stdin?.write(p);
    });
    process.stdin.on("end", () => {
      giris.bitir();
      cocuk.stdin?.end();
    });
    process.stdin.on("error", () => cocuk.stdin?.end());
  }
  const cikis = new SatirBolucu((s) => yaz({ t: "stdout", ms: Date.now(), s }));
  cocuk.stdout?.on("data", (p: Buffer) => {
    cikis.ekle(p.toString("utf8"));
    process.stdout.write(p);
  });
  cocuk.stderr?.on("data", (p: Buffer) => {
    yaz({ t: "stderr", ms: Date.now(), s: p.toString("utf8") });
    process.stderr.write(p);
  });
  process.stdout.on("error", () => {});
  process.stderr.on("error", () => {});
  cocuk.once("error", (e) => {
    yaz({ t: "stderr", ms: Date.now(), s: `kaydedici: gercek claude baslatilamadi: ${e.message}\n` });
    yaz({ t: "cikis", ms: Date.now(), kod: null, sinyal: "baslatilamadi" });
    process.exit(95);
  });
  cocuk.once("close", (kod, sinyal) => {
    cikis.bitir();
    yaz({ t: "cikis", ms: Date.now(), kod, sinyal });
    process.exitCode = kod ?? 1;
    process.stdin.destroy();
  });
}

if (import.meta.main) calistir();
