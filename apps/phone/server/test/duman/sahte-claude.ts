/**
 * Duman koşusunun prova kipi (`kosu.ts --sahte-claude`) için sahte `claude`: model çağrısı yapmaz, ağa
 * çıkmaz. Kaydedicinin "gerçek claude"u yerine başlatıcı (`baslatici.cs`) üzerinden çalışır:
 *
 *   node sahte-claude.ts <yok sayılan> <claude argv'si...>
 *
 * Amaç düzeneğin kendisini sınamak: servisin açılışı, boru yönlendirmesi, eşleştirme, senaryo sırası,
 * kayıt toplama, karşılaştırma ve temizlik. Servisin ürettiği argv/ortam/stdin gerçektir (karşılaştırma
 * anlamlıdır); model çıktısı sahtedir, bu yüzden davranış denetimleri (`gozlemle`) bu kipte model kanıtı değildir.
 *
 * MCP sunucuları GERÇEKTEN başlatılır (`--mcp-config`, kaydedicinin yönlendirilmiş kopyası): her stdio sunucusu
 * gerçek claude gibi `{...ortam, ...env}` ile açılır, MCP `initialize` + `tools/list` yapılır. `init`'teki
 * `mcp_servers[].status` bu el sıkışmanın sonucudur (`connected` ya da `failed`), beyan değil. Köprünün
 * stderr'indeki `boru_baglandi` (servisin jetonu kabul ettiği el sıkışma) ayrıca izlenir. Sonuç stderr'e bir
 * satır olarak yazılır (`sahte-claude: mcp ...`; kaydedici kaydeder). Önlem: argv'sinde `kopru.ts` olup
 * `--import ...?onek=` taşımayan sunucu (yönlendirmesiz köprü) hiç başlatılmaz, `failed` sayılır.
 *
 * - Ana oturum (`--input-format`): sunucular açılır, `init`; her kullanıcı satırına 300 ms arayla 10 metin
 *   parçası ve `result`; `control_request/interrupt` süren turu `aborted_streaming` ile bitirir. stdin
 *   kapanınca sunucuların stdin'i kapanır (köprü stdin bitişinde çıkar), sonra süreç çıkar.
 * - İş (`-p`): sunucular (varsa) açılır, `init`, `result` (structured_output dolu), sunucular kapanır, çıkış 0.
 *
 * Bu dosya içe aktarılınca hiçbir şey yapmaz; giriş `import.meta.main` ile korunur.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const KULLANIM = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 };
const INIT_SURESI_MS = 15_000;
const BORU_BEKLEME_MS = 8_000;

export interface SahteMcpSonucu {
  ad: string;
  status: "connected" | "failed";
  pid: number | null;
  araclar: number;
  boruBaglandi: boolean;
  neden: string | null;
}

interface AcikSunucu {
  sonuc: SahteMcpSonucu;
  surec: ChildProcess | null;
}

/** Yönlendirmesiz köprü: argv'de `kopru.ts` var, `--import <...onek=...>` yok. */
export const yonlendirmesizKopruMu = (args: readonly string[]): boolean => {
  if (!args.some((a) => /(^|[\\/])kopru\.ts$/i.test(a))) return false;
  const i = args.indexOf("--import");
  return !(i >= 0 && (args[i + 1] ?? "").includes("onek="));
};

/** Bir stdio MCP sunucusunu başlatır, `initialize` + `tools/list` yapar; süreç açık kalır. */
function sunucuAc(ad: string, tanim: { command?: unknown; args?: unknown; env?: unknown; type?: unknown }): Promise<AcikSunucu> {
  const sonuc: SahteMcpSonucu = { ad, status: "failed", pid: null, araclar: 0, boruBaglandi: false, neden: null };
  const args = Array.isArray(tanim.args) ? tanim.args.filter((a): a is string => typeof a === "string") : [];
  if (typeof tanim.command !== "string" || (tanim.type !== undefined && tanim.type !== "stdio")) {
    sonuc.neden = "stdio komutu yok";
    return Promise.resolve({ sonuc, surec: null });
  }
  if (yonlendirmesizKopruMu(args)) {
    sonuc.neden = "yonlendirmesiz kopru baslatilmadi";
    return Promise.resolve({ sonuc, surec: null });
  }
  const env = { ...process.env, ...((tanim.env ?? {}) as Record<string, string>) };
  const surec = spawn(tanim.command, args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  sonuc.pid = surec.pid ?? null;
  surec.stdin?.on("error", () => {});
  return new Promise((coz) => {
    let bitti = false;
    let initOk = false;
    const bitir = (neden: string | null): void => {
      if (bitti) return;
      bitti = true;
      clearTimeout(zaman);
      sonuc.status = initOk ? "connected" : "failed";
      sonuc.neden = neden;
      coz({ sonuc, surec });
    };
    const zaman = setTimeout(() => bitir(initOk ? "boru_baglandi gelmedi" : "initialize zaman asimi"), INIT_SURESI_MS);
    const kopru = args.some((a) => /kopru\.ts$/i.test(a));
    const belki = (): void => {
      if (initOk && (!kopru || sonuc.boruBaglandi)) bitir(null);
    };
    createInterface({ input: surec.stderr! }).on("line", (s) => {
      if (s.includes('"olay":"boru_baglandi"')) {
        sonuc.boruBaglandi = true;
        belki();
      }
    });
    const gonder = (o: unknown): void => {
      surec.stdin?.write(`${JSON.stringify(o)}\n`);
    };
    createInterface({ input: surec.stdout! }).on("line", (s) => {
      let o: { id?: unknown; result?: { tools?: unknown[] }; error?: unknown };
      try {
        o = JSON.parse(s) as typeof o;
      } catch {
        return;
      }
      if (o.id === 1) {
        if (o.error !== undefined) return bitir("initialize hatasi");
        gonder({ jsonrpc: "2.0", method: "notifications/initialized" });
        gonder({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      } else if (o.id === 2) {
        sonuc.araclar = Array.isArray(o.result?.tools) ? o.result.tools.length : 0;
        initOk = o.error === undefined;
        if (!initOk) return bitir("tools/list hatasi");
        if (kopru && !sonuc.boruBaglandi) {
          clearTimeout(zaman);
          setTimeout(() => bitir(sonuc.boruBaglandi ? null : "boru_baglandi gelmedi"), BORU_BEKLEME_MS);
        }
        belki();
      }
    });
    surec.once("error", () => bitir("baslatilamadi"));
    surec.once("exit", (kod) => bitir(`erken cikti (${kod})`));
    gonder({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "sahte-claude", version: "0" } },
    });
  });
}

async function sunuculariAc(argv: readonly string[]): Promise<AcikSunucu[]> {
  const i = argv.indexOf("--mcp-config");
  const yol = i >= 0 ? argv[i + 1] : undefined;
  if (yol === undefined || !existsSync(yol)) return [];
  let j: { mcpServers?: Record<string, Record<string, unknown>> };
  try {
    j = JSON.parse(readFileSync(yol, "utf8")) as typeof j;
  } catch {
    return [];
  }
  const acik = await Promise.all(Object.entries(j.mcpServers ?? {}).map(([ad, t]) => sunucuAc(ad, t)));
  for (const { sonuc: s } of acik) {
    process.stderr.write(
      `sahte-claude: mcp ${s.ad} status=${s.status} pid=${s.pid ?? "-"} araclar=${s.araclar} boru_baglandi=${s.boruBaglandi}${s.neden === null ? "" : ` neden=${s.neden}`}\n`,
    );
  }
  return acik;
}

/** Sunucuların stdin'ini kapatır (köprü stdin bitişinde çıkar); 3 sn içinde çıkmayanı öldürür. */
async function sunuculariKapat(acik: readonly AcikSunucu[]): Promise<void> {
  await Promise.all(
    acik.map(
      ({ surec }) =>
        new Promise<void>((coz) => {
          if (surec === null || surec.exitCode !== null) return coz();
          const t = setTimeout(() => {
            surec.kill();
            coz();
          }, 3000);
          surec.once("exit", () => {
            clearTimeout(t);
            coz();
          });
          surec.stdin?.end();
        }),
    ),
  );
}

async function calistir(): Promise<void> {
  const argv = process.argv.slice(3);
  const deger = (b: string): string | null => {
    const i = argv.indexOf(b);
    return i >= 0 && i + 1 < argv.length ? (argv[i + 1] ?? null) : null;
  };
  const oturum = deger("--session-id") ?? deger("--resume") ?? "sahte";
  const yaz = (o: unknown): void => {
    process.stdout.write(`${JSON.stringify(o)}\n`);
  };
  const acik = await sunuculariAc(argv);
  const mcpServers = acik.map(({ sonuc }) => ({ name: sonuc.ad, status: sonuc.status }));

  if (!argv.includes("--input-format")) {
    yaz({ type: "system", subtype: "init", session_id: oturum, tools: ["Bash", "Read"], mcp_servers: mcpServers, apiKeySource: "none", model: "sahte" });
    yaz({
      type: "result",
      subtype: "success",
      is_error: false,
      terminal_reason: "completed",
      result: "tamam",
      session_id: oturum,
      structured_output: { yapildi: ["tamam"], yapilmadi: [], dosyalar: [], acik_noktalar: [] },
      usage: KULLANIM,
      total_cost_usd: 0,
    });
    await sunuculariKapat(acik);
    process.exitCode = 0;
    return;
  }

  yaz({
    type: "system",
    subtype: "init",
    session_id: oturum,
    tools: ["PowerShell", "Read", "mcp__eren__plan_oner"],
    mcp_servers: mcpServers,
    apiKeySource: "none",
    model: "sahte",
  });
  let zamanlayici: NodeJS.Timeout | null = null;
  let mesajNo = 0;
  const bitir = (sonuc: Record<string, unknown>): void => {
    if (zamanlayici !== null) clearInterval(zamanlayici);
    zamanlayici = null;
    yaz({ type: "result", session_id: oturum, usage: KULLANIM, total_cost_usd: 0, modelUsage: { sahte: { contextWindow: 200_000 } }, ...sonuc });
  };
  createInterface({ input: process.stdin })
    .on("line", (s) => {
      let o: { type?: unknown; request?: { subtype?: unknown }; request_id?: unknown };
      try {
        o = JSON.parse(s) as typeof o;
      } catch {
        return;
      }
      if (o.type === "control_request" && o.request?.subtype === "interrupt") {
        yaz({ type: "control_response", response: { subtype: "success", request_id: o.request_id } });
        if (zamanlayici !== null) bitir({ subtype: "error_during_execution", is_error: true, terminal_reason: "aborted_streaming", result: "" });
        return;
      }
      if (o.type !== "user") return;
      const id = `sahte_m${++mesajNo}`;
      yaz({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id } } });
      yaz({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", index: 0, content_block: { type: "text" } } });
      let n = 0;
      zamanlayici = setInterval(() => {
        n++;
        yaz({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `parca${n} ` } } });
        if (n >= 10) {
          yaz({ type: "assistant", parent_tool_use_id: null, message: { id, model: "sahte", content: [{ type: "text", text: "sahte cevap" }], usage: KULLANIM } });
          bitir({ subtype: "success", is_error: false, terminal_reason: "completed", result: "sahte cevap" });
        }
      }, 300);
    })
    .on("close", () => {
      if (zamanlayici !== null) clearInterval(zamanlayici);
      void sunuculariKapat(acik).finally(() => process.exit(0));
    });
}

if (import.meta.main) {
  calistir().catch((e: unknown) => {
    process.stderr.write(`sahte-claude: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
