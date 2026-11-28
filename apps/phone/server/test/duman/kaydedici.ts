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
 *   Köprü canlı servisin borusuna değil, duman servisinin borusuna bağlanır. Bir köprü yönlendirilemiyorsa
 *   (`mcpYonlendir` → `hata`) kaydedici `baslat` + `cikis` yazar ve 91 ile çıkar; gerçek `claude` başlamaz.
 *
 * stdin: `--input-format` varsa (ana oturum) boru; satırlar kaydedilir ve aynen geçer. Yoksa (iş oturumu,
 * servis `ignore` verir) kaydedicinin stdin tanıtıcısı doğrudan devredilir: üretimdeki gibi.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { KaydediciAyari, KaydediciOlayi, SurecKaydi, YonlendirmeKaydi } from "./tipler.ts";
import { DEGER_YAZILMADI, DEGERI_YAZILAN, ORTAM_DEGERI_KAYDEDILEN } from "./tipler.ts";

const degerAl = (argv: readonly string[], bayrak: string): string | null => {
  const i = argv.indexOf(bayrak);
  return i >= 0 && i + 1 < argv.length ? (argv[i + 1] ?? null) : null;
};

/** Yönlendirme kapalı başarısızlığının çıkış kodu: gerçek `claude` hiç başlatılmaz. */
export const YONLENDIRME_HATASI_KODU = 91;

/** Bir sunucu tanımı köprü mü: tanımın herhangi bir yerinde `kopru.ts` ya da köprü jetonu anahtarı geçer. */
const kopruMu = (s: unknown): boolean => /kopru\.ts|EREN_KOPRU_JETON/i.test(JSON.stringify(s) ?? "");

/**
 * `--mcp-config` metninin yönlendirilmiş kopyası. Komutu node olan her sunucuya `--import <önyükleme>` eklenir.
 * Kapalı başarısızlık: metin ayrıştırılamazsa, `mcpServers` nesne değilse ya da bir köprü sunucusu (`kopru.ts`
 * ya da `EREN_KOPRU_JETON` geçen tanım) doğrudan `node.exe <...> kopru.ts` biçiminde değilse (sarmalayıcı,
 * adı değişmiş node, `args` dizi değil) `hata` döner; kaydedici o zaman gerçek `claude`'u başlatmaz. Köprüsüz
 * ve node'suz yapılandırma `aynen` döner (PC işinin boş `mcp.json`'ı).
 */
export type McpYonlendirme = { tur: "aynen" } | { tur: "kopya"; metin: string; koprular: string[] } | { tur: "hata"; neden: string };

export function mcpYonlendir(icerik: string, nodeExe: string, onyukleme: string): McpYonlendirme {
  let j: unknown;
  try {
    j = JSON.parse(icerik);
  } catch {
    return { tur: "hata", neden: "mcp metni ayrıştırılamadı" };
  }
  if (j === null || typeof j !== "object" || Array.isArray(j)) return { tur: "hata", neden: "mcp kökü nesne değil" };
  const sunucular = (j as { mcpServers?: unknown }).mcpServers;
  if (sunucular === undefined) return kopruMu(j) ? { tur: "hata", neden: "mcpServers yok ama köprü izi var" } : { tur: "aynen" };
  if (sunucular === null || typeof sunucular !== "object" || Array.isArray(sunucular)) return { tur: "hata", neden: "mcpServers nesne değil" };
  const koprular: string[] = [];
  let degisti = false;
  for (const [ad, s] of Object.entries(sunucular as Record<string, unknown>)) {
    const t = (s ?? {}) as { command?: unknown; args?: unknown };
    const kopru = kopruMu(s);
    const nodeMu =
      typeof t.command === "string" && (t.command.toLowerCase() === nodeExe.toLowerCase() || basename(t.command).toLowerCase() === "node.exe");
    const argsDizeMi = Array.isArray(t.args) && t.args.every((a) => typeof a === "string");
    if (kopru) {
      if (!nodeMu) return { tur: "hata", neden: `köprü ${ad}: komut node.exe değil` };
      if (!argsDizeMi) return { tur: "hata", neden: `köprü ${ad}: args dize dizisi değil` };
      if (!(t.args as string[]).some((a) => /(^|[\\/])kopru\.ts$/i.test(a))) return { tur: "hata", neden: `köprü ${ad}: kopru.ts argümanı yok` };
      koprular.push(ad);
    }
    if (!nodeMu) continue;
    if (!argsDizeMi && t.args !== undefined) return { tur: "hata", neden: `${ad}: args dize dizisi değil` };
    t.args = ["--import", onyukleme, ...((t.args as string[] | undefined) ?? [])];
    degisti = true;
  }
  return degisti ? { tur: "kopya", metin: JSON.stringify(j), koprular } : { tur: "aynen" };
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
          ...(o.yonlendirme === undefined ? {} : { yonlendirme: o.yonlendirme }),
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

  // Kapalı başarısızlık: yönlendirilemeyen köprü varsa gerçek claude hiç başlamaz (köprü canlı boruya gider).
  const mcpYolu = degerAl(argv, "--mcp-config");
  let mcp: { yol: string; icerik: string | null } | null = null;
  let yonlendirme: YonlendirmeKaydi = { tur: "mcp_yok" };
  const mcpAdedi = argv.filter((a) => a === "--mcp-config").length;
  if (mcpAdedi > 1) yonlendirme = { tur: "hata", neden: "birden çok --mcp-config" };
  else if (mcpAdedi === 1 && mcpYolu === null) yonlendirme = { tur: "hata", neden: "--mcp-config değeri yok" };
  else if (mcpYolu !== null) {
    const icerik = existsSync(mcpYolu) ? readFileSync(mcpYolu, "utf8") : null;
    mcp = { yol: mcpYolu, icerik };
    const y: McpYonlendirme = icerik === null ? { tur: "hata", neden: "mcp dosyası yok" } : mcpYonlendir(icerik, process.execPath, ayar.onyukleme);
    if (y.tur === "kopya") {
      const kopyaYolu = join(ayar.kayitDizini, `mcp-${process.pid}.json`);
      writeFileSync(kopyaYolu, y.metin, "utf8");
      gercekArgv[argv.indexOf("--mcp-config") + 1] = kopyaYolu;
      yonlendirme = { tur: "kopya", koprular: y.koprular, kopya: kopyaYolu };
    } else yonlendirme = y;
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
    yonlendirme,
  });
  if (yonlendirme.tur === "hata") {
    const s = `kaydedici: yonlendirme_hatasi (${yonlendirme.neden}); gercek claude baslatilmadi\n`;
    yaz({ t: "stderr", ms: Date.now(), s });
    yaz({ t: "cikis", ms: Date.now(), kod: YONLENDIRME_HATASI_KODU, sinyal: "yonlendirme_hatasi" });
    process.stderr.write(s);
    process.exit(YONLENDIRME_HATASI_KODU);
  }

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
