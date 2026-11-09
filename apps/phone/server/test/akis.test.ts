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
  assert.deepEqual(o, { tur: "assistant", message_id: "msg_x", model: null, kullanim: null });
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
  const m = coz({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_start" } });
  assert.equal(m?.tur, "diger");
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
