import assert from "node:assert/strict";
import { test } from "node:test";
import type { AkisOlayi } from "../src/sozlesme.ts";
import { akisKur } from "../src/akis.ts";

type Sonuc = Extract<AkisOlayi, { tur: "result" }>;

const akis = akisKur();
const coz = (o: unknown): AkisOlayi | null => akis.satirCoz(JSON.stringify(o));

function sonucOlayi(ek: Record<string, unknown>): Sonuc {
  const o = coz({ type: "result", subtype: "success", is_error: false, result: "", ...ek });
  assert.ok(o !== null && o.tur === "result");
  return o;
}

// --- alan haritası ---------------------------------------------------------------------------

test("init: alanlar okunur, bilinmeyen alan yok sayılır", () => {
  const o = coz({
    type: "system",
    subtype: "init",
    session_id: "00000000-aaaa-bbbb-cccc-000000000001",
    tools: ["Bash", "Read", "mcp__ornek__rapor_oku"],
    mcp_servers: [{ name: "ornek", status: "connected" }],
    apiKeySource: "none",
    model: "claude-opus-ornek",
    permissionMode: "bypassPermissions",
    gelecekteki_alan: { a: 1 },
  });
  assert.deepEqual(o, {
    tur: "init",
    session_id: "00000000-aaaa-bbbb-cccc-000000000001",
    tools: ["Bash", "Read", "mcp__ornek__rapor_oku"],
    mcp_servers: [{ name: "ornek", status: "connected" }],
    apiKeySource: "none",
    model: "claude-opus-ornek",
  });
});

test("init: eksik alanlar güvenli varsayılana düşer", () => {
  const o = coz({ type: "system", subtype: "init" });
  assert.ok(o !== null && o.tur === "init");
  assert.deepEqual(o.tools, []);
  assert.deepEqual(o.mcp_servers, []);
  assert.equal(o.apiKeySource, null);
  assert.equal(o.model, null);
});

test("hook_response: output okunur", () => {
  const o = coz({
    type: "system",
    subtype: "hook_response",
    hook_name: "SessionStart:startup",
    output: "# KURAL (parça 1/3)",
    exit_code: 0,
  });
  assert.deepEqual(o, { tur: "hook_response", cikti: "# KURAL (parça 1/3)" });
});

test("hook_started gibi bilinmeyen system alt türü diger olur", () => {
  const o = coz({ type: "system", subtype: "hook_started", hook_name: "x" });
  assert.deepEqual(o, { tur: "diger", type: "system" });
});

test("assistant: message_id, model ve kullanım", () => {
  const o = coz({
    type: "assistant",
    message: {
      id: "msg_ornek_1",
      model: "claude-opus-ornek",
      role: "assistant",
      content: [{ type: "text", text: "merhaba" }],
      usage: {
        input_tokens: 6,
        cache_creation_input_tokens: 1200,
        cache_read_input_tokens: 500,
        output_tokens: 42,
      },
    },
    session_id: "00000000-aaaa-bbbb-cccc-000000000001",
  });
  assert.deepEqual(o, {
    tur: "assistant",
    message_id: "msg_ornek_1",
    model: "claude-opus-ornek",
    kullanim: { input_tokens: 6, cache_creation_input_tokens: 1200, cache_read_input_tokens: 500 },
    araclar: [],
  });
});

test("assistant: aynı message_id tekrarı toplanmaz, her satır kendi değerini taşır", () => {
  const satir = (cikti: number, girdi: number) => ({
    type: "assistant",
    message: {
      id: "msg_ayni",
      model: "claude-opus-ornek",
      usage: {
        input_tokens: girdi,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 100,
        output_tokens: cikti,
      },
    },
  });
  const a = coz(satir(1, 5));
  const b = coz(satir(30, 5));
  assert.ok(a?.tur === "assistant" && b?.tur === "assistant");
  assert.equal(a.message_id, b.message_id);
  // Çözücü her satır için bağımsız olay verir; sonuncuyu almak çağıranın işi.
  assert.equal(akis.dolulukHesapla(a.kullanim!), 105);
  assert.equal(akis.dolulukHesapla(b.kullanim!), 105);
});

test("assistant: usage yoksa kullanim null, model yoksa null", () => {
  const o = coz({ type: "assistant", message: { id: "msg_x" } });
  assert.deepEqual(o, { tur: "assistant", message_id: "msg_x", model: null, kullanim: null, araclar: [] });
});

test("metin_parcasi: text_delta okunur", () => {
  const o = coz({
    type: "stream_event",
    parent_tool_use_id: null,
    session_id: "s",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ıtayı bir" } },
  });
  assert.deepEqual(o, { tur: "metin_parcasi", text: "ıtayı bir" });
});

test("metin_parcasi: parent_tool_use_id doluysa diger", () => {
  const o = coz({
    type: "stream_event",
    parent_tool_use_id: "toolu_ornek",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "alt agent" } },
  });
  assert.equal(o?.tur, "diger");
});

test("stream_event: text_delta olmayan delta metin parçası değildir", () => {
  const o = coz({
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{" } },
  });
  assert.equal(o?.tur, "diger");
  // Canlı etkinlikten beri message_start `model_basladi` olur (aşağıdaki bölüm).
  const m = coz({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_stop", index: 0 } });
  assert.equal(m?.tur, "diger");
});

// --- canlı etkinlik sinyalleri (gerçek kayıtlardan kısaltılmış satırlar) -----------------------

const akisSatiri = (event: unknown, ebeveyn: string | null = null) => ({
  type: "stream_event",
  event,
  session_id: "1db8fd8d-69d3-4aeb-ae2d-9459b63062e7",
  parent_tool_use_id: ebeveyn,
  uuid: "fa7c5eb1-e291-44cb-ab5c-f4173d58edff",
  api_message_id: "msg_011Cgzpvr61mZFkEbgV1CHgz",
});

const ARAC_BLOK_BASLANGICI = {
  type: "content_block_start",
  index: 0,
  content_block: {
    type: "tool_use",
    id: "toolu_01HfhizYLz29JmFEKqkFTKUE",
    name: "Glob",
    input: {},
    caller: { type: "direct" },
  },
};

const ARAC_ASISTAN_SATIRI = {
  type: "assistant",
  message: {
    model: "claude-opus-5-5",
    id: "msg_011Cgzpvr61mZFkEbgV1CHgz",
    type: "message",
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_01HfhizYLz29JmFEKqkFTKUE",
        name: "Glob",
        input: { pattern: "*.md", path: "C:\\eren-kit\\docs" },
        caller: { type: "direct" },
      },
    ],
    stop_reason: null,
    usage: { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 8000, output_tokens: 60 },
  },
  parent_tool_use_id: null,
  session_id: "1db8fd8d-69d3-4aeb-ae2d-9459b63062e7",
  wire_tool_inputs: { toolu_01HfhizYLz29JmFEKqkFTKUE: { pattern: "*.md" } },
};

const ARAC_SONUCU_SATIRI = {
  type: "user",
  message: {
    role: "user",
    content: [
      { tool_use_id: "toolu_01HfhizYLz29JmFEKqkFTKUE", type: "tool_result", content: "C:\\eren-kit\\docs\\ONERILER.md" },
    ],
  },
  parent_tool_use_id: null,
  session_id: "1db8fd8d-69d3-4aeb-ae2d-9459b63062e7",
  tool_use_result: { filenames: ["C:\\eren-kit\\docs\\ONERILER.md"], numFiles: 1 },
};

test("model_basladi: message_start", () => {
  const o = coz({
    ...akisSatiri({
      type: "message_start",
      message: { model: "claude-opus-5-5", id: "msg_011CgzpsUUf69BvBnKWyiG2t", type: "message", role: "assistant", content: [] },
    }),
    ttft_ms: 627,
    thinking_display: "updates",
  });
  assert.deepEqual(o, { tur: "model_basladi" });
});

test("blok_basladi: thinking ve redacted_thinking -> dusunme", () => {
  const dusunme = coz({
    ...akisSatiri({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }),
    thinking_display: "updates",
  });
  assert.deepEqual(dusunme, { tur: "blok_basladi", blok: "dusunme" });
  // redacted_thinking kayıtlarda görülmedi; API biçimine göre yazıldı.
  const gizli = coz(akisSatiri({ type: "content_block_start", index: 0, content_block: { type: "redacted_thinking", data: "x" } }));
  assert.deepEqual(gizli, { tur: "blok_basladi", blok: "dusunme" });
});

test("blok_basladi: text -> metin", () => {
  const o = coz(akisSatiri({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
  assert.deepEqual(o, { tur: "blok_basladi", blok: "metin" });
});

test("blok_basladi: tool_use -> arac, id ve ad taşınır", () => {
  const o = coz(akisSatiri(ARAC_BLOK_BASLANGICI));
  assert.deepEqual(o, {
    tur: "blok_basladi",
    blok: "arac",
    arac_id: "toolu_01HfhizYLz29JmFEKqkFTKUE",
    arac_adi: "Glob",
  });
});

test("blok_basladi: metin/düşünme bloğunda araç alanları yok", () => {
  const o = coz(akisSatiri({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
  assert.ok(o !== null);
  assert.equal("arac_id" in o, false);
  assert.equal("arac_adi" in o, false);
});

test("blok_basladi: tanınmayan ya da bozuk blok olay üretmez (diger)", () => {
  const bozuklar: unknown[] = [
    { type: "content_block_start", index: 0, content_block: { type: "gelecekteki_blok" } },
    { type: "content_block_start", index: 0 },
    { type: "content_block_start", index: 0, content_block: "text" },
    { type: "content_block_start", index: 0, content_block: null },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: 5, name: "Glob" } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_x", name: null } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use" } },
  ];
  for (const b of bozuklar) {
    let o: AkisOlayi | null = null;
    assert.doesNotThrow(() => {
      o = coz(akisSatiri(b));
    }, JSON.stringify(b));
    assert.deepEqual(o, { tur: "diger", type: "stream_event" }, JSON.stringify(b));
  }
});

test("assistant: tool_use blokları araclar olur", () => {
  const o = coz(ARAC_ASISTAN_SATIRI);
  assert.ok(o?.tur === "assistant");
  assert.deepEqual(o.araclar, [{ id: "toolu_01HfhizYLz29JmFEKqkFTKUE", ad: "Glob" }]);
  assert.equal(o.message_id, "msg_011Cgzpvr61mZFkEbgV1CHgz");
  assert.deepEqual(o.kullanim, { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 8000 });
});

test("assistant: birden çok tool_use sırayla, diğer bloklar ve bozuk araçlar atlanır", () => {
  const o = coz({
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      id: "msg_c",
      content: [
        { type: "thinking", thinking: "", signature: "s" },
        { type: "text", text: "bakıyorum" },
        { type: "tool_use", id: "toolu_a", name: "Read", input: {} },
        { type: "tool_use", id: 7, name: "Bash" },
        { type: "tool_use", id: "toolu_b" },
        null,
        "tool_use",
        { type: "tool_use", id: "toolu_c", name: "mcp__beyin__beyin_ara", input: {} },
      ],
    },
  });
  assert.ok(o?.tur === "assistant");
  assert.deepEqual(o.araclar, [
    { id: "toolu_a", ad: "Read" },
    { id: "toolu_c", ad: "mcp__beyin__beyin_ara" },
  ]);
});

test("assistant: content dizi değilse araclar boş", () => {
  for (const content of [undefined, null, "metin", 5, { type: "tool_use", id: "t", name: "n" }]) {
    const o = coz({ type: "assistant", message: { id: "m", content } });
    assert.ok(o?.tur === "assistant", JSON.stringify(content));
    assert.deepEqual(o.araclar, [], JSON.stringify(content));
  }
});

test("arac_sonucu: tool_result taşıyan user satırı", () => {
  assert.deepEqual(coz(ARAC_SONUCU_SATIRI), {
    tur: "arac_sonucu",
    arac_idler: ["toolu_01HfhizYLz29JmFEKqkFTKUE"],
  });
});

test("arac_sonucu: satırdaki tüm tool_use_id değerleri, metin blokları ve bozuk id atlanır", () => {
  const o = coz({
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        { tool_use_id: "toolu_a", type: "tool_result", content: "a" },
        { type: "text", text: "not" },
        { tool_use_id: 9, type: "tool_result", content: "bozuk" },
        { type: "tool_result", content: "id yok" },
        { tool_use_id: "toolu_b", type: "tool_result", is_error: true, content: [{ type: "text", text: "hata" }] },
      ],
    },
  });
  assert.deepEqual(o, { tur: "arac_sonucu", arac_idler: ["toolu_a", "toolu_b"] });
});

test("arac_sonucu: araç sonucu taşımayan user satırı ve yeniden oynatma yankısı diger", () => {
  const durumlar: unknown[] = [
    { type: "user", parent_tool_use_id: null, message: { role: "user", content: "merhaba" } },
    { type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "text", text: "merhaba" }] } },
    { type: "user", isReplay: true, parent_tool_use_id: null, message: { role: "user", content: "merhaba 1" } },
    { ...ARAC_SONUCU_SATIRI, isReplay: true },
    { type: "user", message: "x" },
    { type: "user" },
    { type: "user", message: { content: [null, 5, { type: "tool_result", tool_use_id: null }] } },
  ];
  for (const d of durumlar) {
    let o: AkisOlayi | null = null;
    assert.doesNotThrow(() => {
      o = coz(d);
    }, JSON.stringify(d));
    assert.deepEqual(o, { tur: "diger", type: "user" }, JSON.stringify(d));
  }
});

test("parent_tool_use_id dolu satırlar canlı etkinlik üretmez", () => {
  const ebeveyn = "toolu_01ALTAJAN";
  for (const event of [
    { type: "message_start", message: { id: "msg_alt" } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ARAC_BLOK_BASLANGICI,
  ]) {
    assert.deepEqual(coz(akisSatiri(event, ebeveyn)), { tur: "diger", type: "stream_event" }, JSON.stringify(event));
  }
  assert.deepEqual(coz({ ...ARAC_SONUCU_SATIRI, parent_tool_use_id: ebeveyn }), { tur: "diger", type: "user" });
  // assistant olayı eskisi gibi üretilir (kullanım dahil) ama alt ajanın araçları taşınmaz.
  const a = coz({ ...ARAC_ASISTAN_SATIRI, parent_tool_use_id: ebeveyn });
  assert.ok(a?.tur === "assistant");
  assert.deepEqual(a.araclar, []);
  assert.notEqual(a.kullanim, null);
});

test("gerçek araçlı tur sırası: olay dizisi", () => {
  const satirlar = [
    akisSatiri({ type: "message_start", message: { id: "msg_1" } }),
    akisSatiri(ARAC_BLOK_BASLANGICI),
    akisSatiri({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "" } }),
    ARAC_ASISTAN_SATIRI,
    akisSatiri({ type: "content_block_stop", index: 0 }),
    akisSatiri({ type: "message_delta", delta: { stop_reason: "tool_use" } }),
    akisSatiri({ type: "message_stop" }),
    ARAC_SONUCU_SATIRI,
    akisSatiri({ type: "message_start", message: { id: "msg_2" } }),
    akisSatiri({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    akisSatiri({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Bir dosya var." } }),
    { type: "result", subtype: "success", is_error: false, result: "Bir dosya var." },
  ];
  assert.deepEqual(
    satirlar.map((s) => coz(s)?.tur ?? null),
    [
      "model_basladi",
      "blok_basladi",
      "diger",
      "assistant",
      "diger",
      "diger",
      "diger",
      "arac_sonucu",
      "model_basladi",
      "blok_basladi",
      "metin_parcasi",
      "result",
    ],
  );
});

test("rate_limit: utilization yüzdeye, resetsAt saniyeden ms'ye", () => {
  const o = coz({
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed",
      unifiedWindows: {
        five_hour: { utilization: 0.42, resetsAt: 1790000000 },
        seven_day: { utilization: 0.1, resetsAt: 1790500000 },
      },
    },
  });
  assert.ok(o !== null && o.tur === "rate_limit");
  assert.ok(o.besSaat !== null && o.yediGun !== null);
  assert.ok(Math.abs(o.besSaat.yuzde - 42) < 1e-9);
  assert.equal(o.besSaat.sifirlanmaMs, 1790000000000);
  assert.ok(Math.abs(o.yediGun.yuzde - 10) < 1e-9);
  assert.equal(o.yediGun.sifirlanmaMs, 1790500000000);
});

test("rate_limit: pencere yoksa ya da bozuksa null", () => {
  const yalniz5 = coz({
    type: "rate_limit_event",
    rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: 1790000000 } } },
  });
  assert.ok(yalniz5?.tur === "rate_limit");
  assert.notEqual(yalniz5.besSaat, null);
  assert.equal(yalniz5.yediGun, null);

  const bos = coz({ type: "rate_limit_event", rate_limit_info: {} });
  assert.deepEqual(bos, { tur: "rate_limit", besSaat: null, yediGun: null });

  const hic = coz({ type: "rate_limit_event" });
  assert.deepEqual(hic, { tur: "rate_limit", besSaat: null, yediGun: null });

  const bozuk = coz({
    type: "rate_limit_event",
    rate_limit_info: { unifiedWindows: { five_hour: { utilization: "yuksek" }, seven_day: null } },
  });
  assert.deepEqual(bozuk, { tur: "rate_limit", besSaat: null, yediGun: null });
});

test("result: alanlar okunur, subtype yansımaz", () => {
  const o = coz({
    type: "result",
    subtype: "success",
    is_error: false,
    terminal_reason: "completed",
    stop_reason: "end_turn",
    result: "Bitti.",
    structured_output: { a: 1 },
    session_id: "00000000-aaaa-bbbb-cccc-000000000001",
    usage: { input_tokens: 10 },
    modelUsage: {
      "claude-opus-ornek": { contextWindow: 1000000, inputTokens: 10 },
      "claude-sonnet-ornek": { contextWindow: 200000 },
    },
    total_cost_usd: 0.5,
  });
  assert.deepEqual(o, {
    tur: "result",
    session_id: "00000000-aaaa-bbbb-cccc-000000000001",
    is_error: false,
    terminal_reason: "completed",
    stop_reason: "end_turn",
    metin: "Bitti.",
    structured_output: { a: 1 },
    pencereler: { "claude-opus-ornek": 1000000, "claude-sonnet-ornek": 200000 },
    model_kullanimlari: null,
    ana_kullanim: { girdi: 10, cache_yazma: 0, cache_okuma: 0, cikti: 0 },
  });
  assert.equal("subtype" in (o as object), false);
});

test("result: eksik alanlar güvenli varsayılan", () => {
  const o = coz({ type: "result" });
  assert.ok(o !== null && o.tur === "result");
  assert.equal(o.session_id, null);
  assert.equal(o.terminal_reason, null);
  assert.equal(o.stop_reason, null);
  assert.equal(o.metin, "");
  assert.deepEqual(o.pencereler, {});
});

test("result: is_error boolean değilse true sayılır", () => {
  for (const bozuk of ["false", "evet", 0, 1, null, {}, []]) {
    const o = coz({ type: "result", subtype: "success", is_error: bozuk });
    assert.ok(o?.tur === "result");
    assert.equal(o.is_error, true, `is_error=${JSON.stringify(bozuk)}`);
  }
  // alan hiç yoksa da güvenli varsayılan: hata
  const yok = coz({ type: "result", subtype: "success" });
  assert.ok(yok?.tur === "result");
  assert.equal(yok.is_error, true);
  const dogru = coz({ type: "result", is_error: false });
  assert.ok(dogru?.tur === "result");
  assert.equal(dogru.is_error, false);
});

test("result: contextWindow sayı değilse o model atlanır", () => {
  const o = coz({
    type: "result",
    is_error: false,
    modelUsage: { a: { contextWindow: "büyük" }, b: { contextWindow: 200000 }, c: null },
  });
  assert.ok(o?.tur === "result");
  assert.deepEqual(o.pencereler, { b: 200000 });
});

test("control_response: request_id ve başarı", () => {
  const ok = coz({
    type: "control_response",
    response: { subtype: "success", request_id: "kes1", response: { still_queued: [] } },
  });
  assert.deepEqual(ok, { tur: "control_response", request_id: "kes1", basarili: true });
  const hata = coz({
    type: "control_response",
    response: { subtype: "error", request_id: "kes2", error: "yok" },
  });
  assert.deepEqual(hata, { tur: "control_response", request_id: "kes2", basarili: false });
});

test("bilinmeyen tür diger olur, type taşınır", () => {
  assert.deepEqual(coz({ type: "user", message: { role: "user", content: "x" } }), {
    tur: "diger",
    type: "user",
  });
  assert.deepEqual(coz({ type: "yeni_bir_tur_2027" }), { tur: "diger", type: "yeni_bir_tur_2027" });
});

// --- satirCoz hiç atmaz ----------------------------------------------------------------------

test("bozuk JSON null döner, atmaz", () => {
  for (const s of ["", "   ", "{", "{\"type\":", "yarım satır", "{'type':'result'}", "\u0000", "{\"type\":\"result\"}}"]) {
    assert.equal(akis.satirCoz(s), null, JSON.stringify(s));
  }
});

test("JSON olup nesne olmayan değerler atmaz", () => {
  for (const s of ["null", "42", "\"metin\"", "[]", "[1,2]", "true"]) {
    let o: AkisOlayi | null = null;
    assert.doesNotThrow(() => {
      o = akis.satirCoz(s);
    }, s);
    assert.ok(o === null || (o as AkisOlayi).tur === "diger", s);
  }
});

test("alan tipleri yanlışsa atmaz", () => {
  const bozuklar: unknown[] = [
    { type: 5 },
    { type: "system", subtype: "init", tools: "Bash", mcp_servers: 3, model: 7 },
    { type: "system", subtype: "init", tools: [1, null, "Bash"], mcp_servers: [null, "x", { name: 1 }] },
    { type: "assistant", message: "metin" },
    { type: "assistant", message: { id: 5, usage: "çok" } },
    { type: "assistant", message: { id: "m", usage: { input_tokens: "6" } } },
    { type: "stream_event", event: "x" },
    { type: "stream_event", parent_tool_use_id: null, event: { delta: { type: "text_delta", text: 5 } } },
    { type: "rate_limit_event", rate_limit_info: "x" },
    { type: "result", modelUsage: "x", result: 5, terminal_reason: 7 },
    { type: "control_response", response: "x" },
    { type: "control_response" },
  ];
  for (const b of bozuklar) {
    assert.doesNotThrow(() => akis.satirCoz(JSON.stringify(b)), JSON.stringify(b));
  }
});

// --- tur sınıflaması ---------------------------------------------------------------------------

test("subtype:success + aborted_streaming -> kesildi", () => {
  const s = sonucOlayi({ subtype: "success", is_error: false, terminal_reason: "aborted_streaming" });
  assert.equal(akis.turSonucuSinifla(s), "kesildi");
});

test("subtype:success + is_error -> hata", () => {
  const s = sonucOlayi({
    subtype: "success",
    is_error: true,
    stop_reason: "refusal",
    terminal_reason: "api_error",
  });
  assert.equal(akis.turSonucuSinifla(s), "hata");
});

test("temiz tur -> tamam", () => {
  assert.equal(
    akis.turSonucuSinifla(sonucOlayi({ is_error: false, terminal_reason: "completed" })),
    "tamam",
  );
  assert.equal(akis.turSonucuSinifla(sonucOlayi({ is_error: false })), "tamam");
});

test("sınıflama sırası: aborted_ önce gelir, is_error true olsa da kesildi", () => {
  // error_during_execution + is_error:true + aborted_streaming gerçek ölçümde görüldü
  const s = sonucOlayi({
    subtype: "error_during_execution",
    is_error: true,
    terminal_reason: "aborted_streaming",
  });
  assert.equal(akis.turSonucuSinifla(s), "kesildi");
  const t = sonucOlayi({ is_error: true, terminal_reason: "aborted_tools" });
  assert.equal(akis.turSonucuSinifla(t), "kesildi");
});

test("sınıflama subtype'a bakmaz", () => {
  const a = sonucOlayi({ subtype: "error_during_execution", is_error: false, terminal_reason: "completed" });
  assert.equal(akis.turSonucuSinifla(a), "tamam");
  const b = sonucOlayi({ subtype: "success", is_error: true, terminal_reason: null });
  assert.equal(akis.turSonucuSinifla(b), "hata");
});

test("aborted_ yalnız önek olarak sayılır", () => {
  assert.equal(
    akis.turSonucuSinifla(sonucOlayi({ is_error: false, terminal_reason: "not_aborted_x" })),
    "tamam",
  );
  assert.equal(
    akis.turSonucuSinifla(sonucOlayi({ is_error: true, terminal_reason: "not_aborted_x" })),
    "hata",
  );
});

// --- doluluk ve devir eşiği ------------------------------------------------------------------

test("dolulukHesapla üç giriş alanının toplamıdır", () => {
  assert.equal(
    akis.dolulukHesapla({ input_tokens: 3, cache_creation_input_tokens: 17, cache_read_input_tokens: 1700 }),
    1720,
  );
  assert.equal(
    akis.dolulukHesapla({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
    0,
  );
});

test("result.usage doluluk değildir: assistant kullanımı kullanılır", () => {
  // ölçüm: result.usage turdaki çağrıların toplamı (3359), gerçek doluluk 1720
  const asistan = coz({
    type: "assistant",
    message: {
      id: "msg_a",
      usage: { input_tokens: 4, cache_creation_input_tokens: 16, cache_read_input_tokens: 1700, output_tokens: 9 },
    },
  });
  const sonuc = coz({
    type: "result",
    is_error: false,
    usage: { input_tokens: 8, cache_creation_input_tokens: 32, cache_read_input_tokens: 3319, output_tokens: 18 },
    modelUsage: { m: { contextWindow: 1000000 } },
  });
  assert.ok(asistan?.tur === "assistant" && asistan.kullanim !== null);
  assert.ok(sonuc?.tur === "result");
  assert.equal(akis.dolulukHesapla(asistan.kullanim), 1720);
  // result olayı kullanım taşımaz: toplam sızmasın
  assert.equal("kullanim" in sonuc, false);
  assert.equal("usage" in sonuc, false);
});

test("devirEsigi = min(p * 0.5, 200000)", () => {
  assert.equal(akis.devirEsigi(1_000_000), 200_000);
  assert.equal(akis.devirEsigi(400_000), 200_000);
  assert.equal(akis.devirEsigi(399_998), 199_999);
  assert.equal(akis.devirEsigi(200_000), 100_000);
  assert.equal(akis.devirEsigi(100_000), 50_000);
  assert.equal(akis.devirEsigi(2_000_000), 200_000);
});

test("pencereSec: model eşleşirse onun penceresi, yoksa en küçük, hiç yoksa null", () => {
  const p = { "claude-opus-ornek": 1_000_000, "claude-haiku-ornek": 200_000, "claude-sonnet-ornek": 500_000 };
  assert.equal(akis.pencereSec(p, "claude-opus-ornek"), 1_000_000);
  assert.equal(akis.pencereSec(p, "claude-sonnet-ornek"), 500_000);
  assert.equal(akis.pencereSec(p, null), 200_000);
  assert.equal(akis.pencereSec(p, "bilinmeyen-model"), 200_000);
  assert.equal(akis.pencereSec({}, "claude-opus-ornek"), null);
  assert.equal(akis.pencereSec({}, null), null);
});

// --- satır ayırıcı ---------------------------------------------------------------------------

const kodla = (s: string) => new TextEncoder().encode(s);

test("SatirAyirici: tam satırlar, tuketilen bayt cinsinden", () => {
  const a = akis.satirAyirici();
  const girdi = kodla("{\"a\":1}\n{\"b\":2}\n");
  const r = a.ayir(girdi);
  assert.deepEqual(r.satirlar, ["{\"a\":1}", "{\"b\":2}"]);
  assert.equal(r.tuketilen, girdi.length);
});

// Ayırıcı durumsuzdur: çağıran `tuketilen` ofsetinden itibaren (yarım satır dahil) yeniden verir.
function ofsetliBesle(parcalar: Uint8Array[]): { satirlar: string[]; tuketilen: number } {
  const a = akis.satirAyirici();
  let birikim = new Uint8Array(0);
  let ofset = 0;
  const satirlar: string[] = [];
  for (const p of parcalar) {
    const yeni = new Uint8Array(birikim.length + p.length);
    yeni.set(birikim);
    yeni.set(p, birikim.length);
    birikim = yeni;
    const r = a.ayir(birikim.slice(ofset));
    satirlar.push(...r.satirlar);
    ofset += r.tuketilen;
  }
  return { satirlar, tuketilen: ofset };
}

test("SatirAyirici: yarım satır tuketilen'e katılmaz, kalan ofsetten sürünce tamamlanır", () => {
  const a = akis.satirAyirici();
  const r1 = a.ayir(kodla("{\"a\":1}\n{\"b\":"));
  assert.deepEqual(r1.satirlar, ["{\"a\":1}"]);
  assert.equal(r1.tuketilen, kodla("{\"a\":1}\n").length);
  const r2 = a.ayir(kodla("{\"b\":2}\n"));
  assert.deepEqual(r2.satirlar, ["{\"b\":2}"]);
  assert.equal(r1.tuketilen + r2.tuketilen, kodla("{\"a\":1}\n{\"b\":2}\n").length);
});

test("SatirAyirici: yeni satır gelmeyen girdi hiç satır vermez, tuketilen 0", () => {
  const a = akis.satirAyirici();
  const r = a.ayir(kodla("yarım"));
  assert.deepEqual(r.satirlar, []);
  assert.equal(r.tuketilen, 0);
});

test("SatirAyirici: CRLF temizlenir", () => {
  const a = akis.satirAyirici();
  const girdi = kodla("{\"a\":1}\r\n{\"b\":2}\r\n");
  const r = a.ayir(girdi);
  assert.deepEqual(r.satirlar, ["{\"a\":1}", "{\"b\":2}"]);
  assert.equal(r.tuketilen, girdi.length);
});

test("SatirAyirici: CR ile LF parçalar arasında bölünürse de temiz", () => {
  const r = ofsetliBesle([kodla("{\"a\":1}\r"), kodla("\n")]);
  assert.deepEqual(r.satirlar, ["{\"a\":1}"]);
  assert.equal(r.tuketilen, kodla("{\"a\":1}\r\n").length);
});

test("SatirAyirici: çok baytlı karakter parçalar arasında bölünse de doğru", () => {
  const metin = "{\"t\":\"İstanbul ışığı 日本語 😀\"}\n";
  const tum = kodla(metin);
  // her bayt sınırında böl: 2, 3 ve 4 baytlık karakterlerin her iç noktası denenir
  for (let k = 1; k < tum.length; k++) {
    const r = ofsetliBesle([tum.slice(0, k), tum.slice(k)]);
    assert.deepEqual(r.satirlar, [metin.slice(0, -1)], `kesim ${k}`);
    assert.equal(r.tuketilen, tum.length, `kesim ${k}`);
    assert.equal(r.satirlar.join("").includes("�"), false, `kesim ${k}`);
  }
});

test("SatirAyirici: bayt bayt beslemede de aynı sonuç", () => {
  const metin = "{\"a\":\"ğüşiöç 😀\"}\n{\"b\":\"ç\"}\n";
  const tum = kodla(metin);
  const r = ofsetliBesle([...tum].map((b) => Uint8Array.of(b)));
  assert.deepEqual(r.satirlar, ["{\"a\":\"ğüşiöç 😀\"}", "{\"b\":\"ç\"}"]);
  assert.equal(r.tuketilen, tum.length);
});

test("SatirAyirici: boş satır atlanır ya da boş döner, bozmaz", () => {
  const a = akis.satirAyirici();
  const girdi = kodla("{\"a\":1}\n\n{\"b\":2}\n");
  const r = a.ayir(girdi);
  assert.equal(r.tuketilen, girdi.length);
  assert.deepEqual(r.satirlar.filter((s) => s.length > 0), ["{\"a\":1}", "{\"b\":2}"]);
});

test("uçtan uca: parçalı bayt akışı -> satırlar -> olaylar, bozuk satır araya girse de", () => {
  const satirlar = [
    JSON.stringify({ type: "system", subtype: "init", session_id: "s", tools: [], mcp_servers: [], model: "m" }),
    "bozuk {",
    JSON.stringify({
      type: "stream_event",
      parent_tool_use_id: null,
      event: { delta: { type: "text_delta", text: "Çünkü 😀" } },
    }),
    JSON.stringify({ type: "result", subtype: "success", is_error: false, terminal_reason: "completed", result: "Çünkü 😀" }),
  ];
  const tum = kodla(satirlar.join("\r\n") + "\r\n");
  const parcalar: Uint8Array[] = [];
  for (let i = 0; i < tum.length; i += 7) parcalar.push(tum.slice(i, i + 7));
  const olaylar = ofsetliBesle(parcalar).satirlar.map((s) => akis.satirCoz(s));
  assert.deepEqual(
    olaylar.map((o) => o?.tur ?? null),
    ["init", null, "metin_parcasi", "result"],
  );
  const parca = olaylar[2];
  assert.ok(parca?.tur === "metin_parcasi");
  assert.equal(parca.text, "Çünkü 😀");
});

test("fabrika her çağrıda bağımsız ayırıcı verir", () => {
  const y = akisKur();
  const a = y.satirAyirici();
  const b = y.satirAyirici();
  a.ayir(kodla("yarım"));
  const r = b.ayir(kodla("tam\n"));
  assert.deepEqual(r.satirlar, ["tam"]);
});

// --- tüketim alanları --------------------------------------------------------------------------

test("result: model_usage_since_last_result birden çok modelle model başına ModelKullanimi", () => {
  const o = sonucOlayi({
    model_usage_since_last_result: {
      "model-a": {
        inputTokens: 11,
        outputTokens: 22,
        cacheReadInputTokens: 3300,
        cacheCreationInputTokens: 440,
        costUSD: 0.125,
        contextWindow: 1000000,
      },
      "model-b": {
        inputTokens: 5,
        outputTokens: 6,
        cacheReadInputTokens: 70,
        cacheCreationInputTokens: 8,
        costUSD: 0.0025,
      },
    },
  });
  assert.ok(o.model_kullanimlari !== null);
  assert.equal(o.model_kullanimlari.length, 2);
  const a = o.model_kullanimlari.find((m) => m.model === "model-a");
  const b = o.model_kullanimlari.find((m) => m.model === "model-b");
  assert.deepEqual(a, {
    model: "model-a",
    girdi: 11,
    cache_yazma: 440,
    cache_okuma: 3300,
    cikti: 22,
    maliyet_usd: 0.125,
  });
  assert.deepEqual(b, {
    model: "model-b",
    girdi: 5,
    cache_yazma: 8,
    cache_okuma: 70,
    cikti: 6,
    maliyet_usd: 0.0025,
  });
});

test("result: model_usage_since_last_result yoksa model_kullanimlari null", () => {
  const o = sonucOlayi({});
  assert.equal(o.model_kullanimlari, null);
});

test("result: model_usage_since_last_result {} ise model_kullanimlari boş dizi", () => {
  const o = sonucOlayi({ model_usage_since_last_result: {} });
  assert.deepEqual(o.model_kullanimlari, []);
});

test("result: usage ana_kullanim olur, output_tokens cikti'ya gider", () => {
  const o = sonucOlayi({
    usage: {
      input_tokens: 4,
      cache_creation_input_tokens: 16,
      cache_read_input_tokens: 1700,
      output_tokens: 9,
    },
  });
  assert.deepEqual(o.ana_kullanim, { girdi: 4, cache_yazma: 16, cache_okuma: 1700, cikti: 9 });
});

test("result: usage yoksa ana_kullanim null", () => {
  assert.equal(sonucOlayi({}).ana_kullanim, null);
});

test("result: ana_kullanim ve model_kullanimlari birbirinden bağımsız", () => {
  const yalnizUsage = sonucOlayi({ usage: { input_tokens: 1, output_tokens: 2 } });
  assert.equal(yalnizUsage.model_kullanimlari, null);
  assert.notEqual(yalnizUsage.ana_kullanim, null);
  const yalnizFark = sonucOlayi({
    model_usage_since_last_result: { m: { inputTokens: 1, costUSD: 0.5 } },
  });
  assert.equal(yalnizFark.ana_kullanim, null);
  assert.notEqual(yalnizFark.model_kullanimlari, null);
});

test("result: costUSD eksikse maliyet_usd null", () => {
  const o = sonucOlayi({
    model_usage_since_last_result: {
      m: { inputTokens: 3, outputTokens: 4, cacheReadInputTokens: 5, cacheCreationInputTokens: 6 },
    },
  });
  assert.ok(o.model_kullanimlari !== null);
  const m = o.model_kullanimlari.find((x) => x.model === "m");
  assert.ok(m !== undefined);
  assert.equal(m.maliyet_usd, null);
  assert.equal(m.girdi, 3);
  assert.equal(m.cikti, 4);
});

test("result: bozuk tüketim alt alanları çözücüyü atmaz", () => {
  const bozuklar: unknown[] = [
    { model_usage_since_last_result: "x" },
    { model_usage_since_last_result: [1, 2] },
    { model_usage_since_last_result: null },
    { model_usage_since_last_result: { m: null } },
    { model_usage_since_last_result: { m: "metin" } },
    { model_usage_since_last_result: { m: { inputTokens: "5", outputTokens: "6", costUSD: "ucuz" } } },
    { model_usage_since_last_result: { m: { inputTokens: -5, outputTokens: -1, costUSD: -0.5 } } },
    { model_usage_since_last_result: { m: { inputTokens: null, cacheReadInputTokens: {} } } },
    { model_usage_since_last_result: { m: {} } },
    { usage: "çok" },
    { usage: null },
    { usage: [] },
    { usage: { input_tokens: "6", output_tokens: -3 } },
    { usage: { input_tokens: null, cache_read_input_tokens: {} } },
    { usage: {} },
  ];
  for (const b of bozuklar) {
    const s = JSON.stringify({ type: "result", is_error: false, ...(b as object) });
    let o: AkisOlayi | null = null;
    assert.doesNotThrow(() => {
      o = akis.satirCoz(s);
    }, s);
    assert.ok(o !== null && (o as AkisOlayi).tur === "result", s);
  }
});

test("result: bozuk costUSD (dize) ve eksik costUSD maliyet_usd null verir", () => {
  const o = sonucOlayi({
    model_usage_since_last_result: {
      dize: { inputTokens: 1, costUSD: "0.5" },
      yok: { inputTokens: 1 },
    },
  });
  assert.ok(o.model_kullanimlari !== null);
  for (const m of o.model_kullanimlari) assert.equal(m.maliyet_usd, null, m.model);
});

// --- tüketim sayaçları: 0 ≤ n ≤ MAX_SAFE_INTEGER tam sayı ---------------------------------------

const MAX = Number.MAX_SAFE_INTEGER;
// [girdi değeri, beklenen]
const SAYAC_DURUMLARI: [string, unknown, number][] = [
  ["kesirli 1.5", 1.5, 1],
  ["kesirli 0.9", 0.9, 0],
  ["MAX_SAFE_INTEGER", MAX, MAX],
  ["2^53", 2 ** 53, 0],
  ["1e300", 1e300, 0],
  ["dize", "5", 0],
  ["negatif", -3, 0],
  ["negatif kesirli", -0.5, 0],
  ["eksik", undefined, 0],
  ["null", null, 0],
];

test("result: model_usage_since_last_result sayaçları güvenli tam sayıya indirgenir", () => {
  for (const [ad, v, beklenen] of SAYAC_DURUMLARI) {
    const alan = (k: string) => (v === undefined ? {} : { [k]: v });
    const o = sonucOlayi({
      model_usage_since_last_result: {
        m: {
          ...alan("inputTokens"),
          ...alan("cacheCreationInputTokens"),
          ...alan("cacheReadInputTokens"),
          ...alan("outputTokens"),
          costUSD: 0.5,
        },
      },
    });
    assert.ok(o.model_kullanimlari !== null, ad);
    assert.deepEqual(
      o.model_kullanimlari,
      [{ model: "m", girdi: beklenen, cache_yazma: beklenen, cache_okuma: beklenen, cikti: beklenen, maliyet_usd: 0.5 }],
      ad,
    );
  }
});

test("result: usage sayaçları güvenli tam sayıya indirgenir", () => {
  for (const [ad, v, beklenen] of SAYAC_DURUMLARI) {
    const alan = (k: string) => (v === undefined ? {} : { [k]: v });
    const o = sonucOlayi({
      usage: {
        ...alan("input_tokens"),
        ...alan("cache_creation_input_tokens"),
        ...alan("cache_read_input_tokens"),
        ...alan("output_tokens"),
      },
    });
    assert.deepEqual(
      o.ana_kullanim,
      { girdi: beklenen, cache_yazma: beklenen, cache_okuma: beklenen, cikti: beklenen },
      ad,
    );
  }
});

test("result: NaN ve sonsuz sayaç 0 sayılır (JSON'da null/dize olarak gelir)", () => {
  // JSON.stringify NaN/Infinity'yi null yapar; ham metinle de dene
  const ham = '{"type":"result","is_error":false,"usage":{"input_tokens":1e999,"output_tokens":-1e999,"cache_read_input_tokens":"NaN"}}';
  const o = akis.satirCoz(ham);
  assert.ok(o?.tur === "result");
  assert.deepEqual(o.ana_kullanim, { girdi: 0, cache_yazma: 0, cache_okuma: 0, cikti: 0 });
});

test("result: sayaçlar karışık değerlerde alan alan bağımsız indirgenir", () => {
  const o = sonucOlayi({
    usage: { input_tokens: 7.9, cache_creation_input_tokens: -1, cache_read_input_tokens: 2 ** 53, output_tokens: 3 },
  });
  assert.deepEqual(o.ana_kullanim, { girdi: 7, cache_yazma: 0, cache_okuma: 0, cikti: 3 });
});
