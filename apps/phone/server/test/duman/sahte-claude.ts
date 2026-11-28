/**
 * Duman koşusunun prova kipi (`kosu.ts --sahte-claude`) için sahte `claude`: model çağrısı yapmaz, ağa
 * çıkmaz. Kaydedicinin "gerçek claude"u yerine başlatıcı (`baslatici.cs`) üzerinden çalışır:
 *
 *   node sahte-claude.ts <yok sayılan> <claude argv'si...>
 *
 * Amaç düzeneğin kendisini sınamak: servisin açılışı, boru yönlendirmesi, eşleştirme, senaryo sırası,
 * kayıt toplama, karşılaştırma ve temizlik. Servisin ürettiği argv/ortam/stdin gerçektir (karşılaştırma
 * anlamlıdır); stdout sahtedir, bu yüzden davranış denetimleri (`gozlemle`) bu kipte kanıt değildir.
 *
 * - Ana oturum (`--input-format`): `init` (apiKeySource none, köprüler connected diye BEYAN edilir), her
 *   kullanıcı satırına 300 ms arayla 10 metin parçası ve `result`; `control_request/interrupt` süren turu
 *   `aborted_streaming` ile bitirir.
 * - İş (`-p`): `init`, `result` (structured_output dolu), çıkış 0.
 */
import { createInterface } from "node:readline";

const argv = process.argv.slice(3);
const deger = (b: string): string | null => {
  const i = argv.indexOf(b);
  return i >= 0 && i + 1 < argv.length ? (argv[i + 1] ?? null) : null;
};
const oturum = deger("--session-id") ?? deger("--resume") ?? "sahte";
const yaz = (o: unknown): void => {
  process.stdout.write(`${JSON.stringify(o)}\n`);
};
const KULLANIM = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 };

if (argv.includes("--input-format")) {
  yaz({
    type: "system",
    subtype: "init",
    session_id: oturum,
    tools: ["PowerShell", "Read", "mcp__eren__plan_oner"],
    mcp_servers: [
      { name: "eren", status: "connected" },
      { name: "eren-ajanda", status: "connected" },
    ],
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
    .on("close", () => process.exit(0));
} else {
  yaz({ type: "system", subtype: "init", session_id: oturum, tools: ["Bash", "Read"], mcp_servers: [], apiKeySource: "none", model: "sahte" });
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
  process.exit(0);
}
