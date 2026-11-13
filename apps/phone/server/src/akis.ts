/**
 * `claude` stream-json çıktısının saf çözücüsü: satır -> `AkisOlayi`, bayttan satır, tur sınıfı,
 * doluluk ve devir eşiği. Girdi bizim değil, bu yüzden hiçbir yol atmaz. MODULLER.md, "akis".
 */
import type {
  AkisFabrikasi,
  AkisOlayi,
  LimitPenceresi,
  McpSunucuDurumu,
  MesajKullanimi,
  ModelKullanimi,
  SatirAyirici,
  TurSonucuSinifi,
} from "./sozlesme.ts";

type Nesne = Readonly<Record<string, unknown>>;

const DEVIR_USTSINIR = 200000;

const nesneMi = (d: unknown): d is Nesne => typeof d === "object" && d !== null && !Array.isArray(d);

const sayiMi = (d: unknown): d is number => typeof d === "number" && Number.isFinite(d);

const metinOku = (d: unknown): string | null => (typeof d === "string" ? d : null);

const altNesne = (ust: Nesne, ad: string): Nesne | null => {
  const d = ust[ad];
  return nesneMi(d) ? d : null;
};

const sayiOku = (d: unknown): number => (sayiMi(d) ? d : 0);

const kullanimOku = (d: unknown): MesajKullanimi | null => {
  if (!nesneMi(d)) return null;
  return {
    input_tokens: sayiOku(d["input_tokens"]),
    cache_creation_input_tokens: sayiOku(d["cache_creation_input_tokens"]),
    cache_read_input_tokens: sayiOku(d["cache_read_input_tokens"]),
  };
};

/** `utilization` 0-1 -> yüzde; `resetsAt` epoch saniye -> ms. Doluluk yoksa pencere yok. */
const pencereOku = (d: unknown): LimitPenceresi | null => {
  if (!nesneMi(d) || !sayiMi(d["utilization"])) return null;
  const sifirlama = d["resetsAt"];
  return {
    yuzde: d["utilization"] * 100,
    sifirlanmaMs: sayiMi(sifirlama) ? sifirlama * 1000 : 0,
  };
};

const mcpSunuculariOku = (d: unknown): McpSunucuDurumu[] => {
  if (!Array.isArray(d)) return [];
  const cikti: McpSunucuDurumu[] = [];
  for (const oge of d) {
    if (!nesneMi(oge)) continue;
    const name = metinOku(oge["name"]);
    if (name === null) continue;
    cikti.push({ name, status: metinOku(oge["status"]) ?? "" });
  }
  return cikti;
};

const pencerelerOku = (d: unknown): Record<string, number> => {
  const cikti: Record<string, number> = {};
  if (!nesneMi(d)) return cikti;
  for (const [model, kullanim] of Object.entries(d)) {
    if (!nesneMi(kullanim)) continue;
    const pencere = kullanim["contextWindow"];
    if (sayiMi(pencere) && pencere > 0) cikti[model] = pencere;
  }
  return cikti;
};

/** Tüketim sayısı: her zaman 0..MAX_SAFE_INTEGER tam sayı. Kesir aşağı yuvarlanır; bozuk, negatif, sonsuz ya da güvenli aralığı aşan 0. */
const tuketimSayisi = (d: unknown): number => {
  if (!sayiMi(d) || d < 0) return 0;
  const t = Math.floor(d);
  return t <= Number.MAX_SAFE_INTEGER ? t : 0;
};

/** `model_usage_since_last_result`: alan yoksa/nesne değilse `null`, `{}` ise `[]`. Nesne olmayan model satırı atlanır. */
const modelKullanimlariOku = (d: unknown): ModelKullanimi[] | null => {
  if (!nesneMi(d)) return null;
  const cikti: ModelKullanimi[] = [];
  for (const [model, k] of Object.entries(d)) {
    if (!nesneMi(k)) continue;
    const maliyet = k["costUSD"];
    cikti.push({
      model,
      girdi: tuketimSayisi(k["inputTokens"]),
      cache_yazma: tuketimSayisi(k["cacheCreationInputTokens"]),
      cache_okuma: tuketimSayisi(k["cacheReadInputTokens"]),
      cikti: tuketimSayisi(k["outputTokens"]),
      maliyet_usd: sayiMi(maliyet) && maliyet >= 0 ? maliyet : null,
    });
  }
  return cikti;
};

/** `usage` (yalnız ana döngü): nesne değilse `null`. */
const anaKullanimOku = (d: unknown): Omit<ModelKullanimi, "model" | "maliyet_usd"> | null => {
  if (!nesneMi(d)) return null;
  return {
    girdi: tuketimSayisi(d["input_tokens"]),
    cache_yazma: tuketimSayisi(d["cache_creation_input_tokens"]),
    cache_okuma: tuketimSayisi(d["cache_read_input_tokens"]),
    cikti: tuketimSayisi(d["output_tokens"]),
  };
};

/** Alt ajan satırı (`parent_tool_use_id` dolu): canlı etkinlik üretmez. */
const altAjanMi = (o: Nesne): boolean => {
  const ebeveyn = o["parent_tool_use_id"];
  return ebeveyn !== null && ebeveyn !== undefined;
};

/** `message.content` içindeki `tool_use` blokları; `id`/`name` dizge değilse o blok atlanır. */
const araclarOku = (icerik: unknown): { id: string; ad: string }[] => {
  if (!Array.isArray(icerik)) return [];
  const cikti: { id: string; ad: string }[] = [];
  for (const blok of icerik) {
    if (!nesneMi(blok) || blok["type"] !== "tool_use") continue;
    const id = metinOku(blok["id"]);
    const ad = metinOku(blok["name"]);
    if (id === null || ad === null) continue;
    cikti.push({ id, ad });
  }
  return cikti;
};

/** `event.content_block` -> `blok_basladi`; tanınmayan ya da bozuk blok `null`. */
const blokBasladi = (olay: Nesne): AkisOlayi | null => {
  const blok = altNesne(olay, "content_block");
  if (!blok) return null;
  switch (blok["type"]) {
    case "thinking":
    case "redacted_thinking":
      return { tur: "blok_basladi", blok: "dusunme" };
    case "text":
      return { tur: "blok_basladi", blok: "metin" };
    case "tool_use": {
      const id = metinOku(blok["id"]);
      const ad = metinOku(blok["name"]);
      if (id === null || ad === null) return null;
      return { tur: "blok_basladi", blok: "arac", arac_id: id, arac_adi: ad };
    }
    default:
      return null;
  }
};

/** `tool_result` taşıyan `user` satırı -> `arac_sonucu`; yeniden oynatma, alt ajan ve düz metin `null`. */
const aracSonucu = (o: Nesne): AkisOlayi | null => {
  if (o["isReplay"] === true || altAjanMi(o)) return null;
  const mesaj = altNesne(o, "message");
  const icerik = mesaj ? mesaj["content"] : null;
  if (!Array.isArray(icerik)) return null;
  const idler: string[] = [];
  for (const blok of icerik) {
    if (!nesneMi(blok) || blok["type"] !== "tool_result") continue;
    const id = metinOku(blok["tool_use_id"]);
    if (id !== null) idler.push(id);
  }
  return idler.length > 0 ? { tur: "arac_sonucu", arac_idler: idler } : null;
};

const olayaCevir = (o: Nesne): AkisOlayi => {
  const type = metinOku(o["type"]) ?? "";
  switch (type) {
    case "system": {
      const altTur = o["subtype"];
      if (altTur === "init") {
        const tools = Array.isArray(o["tools"])
          ? o["tools"].filter((t): t is string => typeof t === "string")
          : [];
        return {
          tur: "init",
          session_id: metinOku(o["session_id"]) ?? "",
          tools,
          mcp_servers: mcpSunuculariOku(o["mcp_servers"]),
          apiKeySource: metinOku(o["apiKeySource"]),
          model: metinOku(o["model"]),
        };
      }
      if (altTur === "hook_response") {
        return { tur: "hook_response", cikti: metinOku(o["output"]) ?? "" };
      }
      return { tur: "diger", type };
    }
    case "assistant": {
      const mesaj = altNesne(o, "message");
      return {
        tur: "assistant",
        message_id: mesaj ? (metinOku(mesaj["id"]) ?? "") : "",
        model: mesaj ? metinOku(mesaj["model"]) : null,
        kullanim: mesaj ? kullanimOku(mesaj["usage"]) : null,
        // Alt ajanın araçları ana konuşmanın etkinliği değildir.
        araclar: mesaj && !altAjanMi(o) ? araclarOku(mesaj["content"]) : [],
      };
    }
    case "user":
      return aracSonucu(o) ?? { tur: "diger", type };
    case "stream_event": {
      // Alt ajanın akışı ana konuşma metni değildir.
      if (altAjanMi(o)) return { tur: "diger", type };
      const olay = altNesne(o, "event");
      const delta = olay ? altNesne(olay, "delta") : null;
      if (delta && delta["type"] === "text_delta" && typeof delta["text"] === "string") {
        return { tur: "metin_parcasi", text: delta["text"] };
      }
      if (olay && olay["type"] === "message_start") return { tur: "model_basladi" };
      if (olay && olay["type"] === "content_block_start") {
        return blokBasladi(olay) ?? { tur: "diger", type };
      }
      return { tur: "diger", type };
    }
    case "rate_limit_event": {
      const bilgi = altNesne(o, "rate_limit_info");
      const pencereler = bilgi ? altNesne(bilgi, "unifiedWindows") : null;
      return {
        tur: "rate_limit",
        besSaat: pencereler ? pencereOku(pencereler["five_hour"]) : null,
        yediGun: pencereler ? pencereOku(pencereler["seven_day"]) : null,
      };
    }
    case "result": {
      return {
        tur: "result",
        session_id: metinOku(o["session_id"]),
        // Boolean değilse en kötüsü varsayılır: hatayı tamam saymayız.
        is_error: typeof o["is_error"] === "boolean" ? o["is_error"] : true,
        terminal_reason: metinOku(o["terminal_reason"]),
        stop_reason: metinOku(o["stop_reason"]),
        metin: metinOku(o["result"]) ?? "",
        structured_output: o["structured_output"],
        pencereler: pencerelerOku(o["modelUsage"]),
        model_kullanimlari: modelKullanimlariOku(o["model_usage_since_last_result"]),
        ana_kullanim: anaKullanimOku(o["usage"]),
      };
    }
    case "control_response": {
      const yanit = altNesne(o, "response");
      return {
        tur: "control_response",
        request_id: yanit ? (metinOku(yanit["request_id"]) ?? "") : "",
        basarili: yanit ? yanit["subtype"] === "success" : false,
      };
    }
    default:
      return { tur: "diger", type };
  }
};

const satirCoz = (satir: string): AkisOlayi | null => {
  try {
    if (typeof satir !== "string") return null;
    const temiz = satir.replace(/^﻿/, "").trim();
    if (temiz === "") return null;
    const d: unknown = JSON.parse(temiz);
    if (!nesneMi(d)) return null;
    return olayaCevir(d);
  } catch {
    return null;
  }
};

const LF = 0x0a;
const CR = 0x0d;

/**
 * Durumsuz: çağıran kalıcı ofsetten okur, `tuketilen`'i ofsete ekler, yarım satır bir sonraki
 * okumada baştan gelir. Bölme bayt 0x0A'dadır; UTF-8'de çok baytlı karakterin hiçbir baytı 0x0A
 * olamaz, bu yüzden karakter bölünmesi satır sınırını bozmaz.
 */
const satirAyiriciKur = (): SatirAyirici => ({
  ayir(baytlar) {
    const cozucu = new TextDecoder("utf-8");
    const satirlar: string[] = [];
    let bas = 0;
    let tuketilen = 0;
    for (let i = 0; i < baytlar.length; i++) {
      if (baytlar[i] !== LF) continue;
      let son = i;
      if (son > bas && baytlar[son - 1] === CR) son--;
      if (son > bas) satirlar.push(cozucu.decode(baytlar.subarray(bas, son)));
      bas = i + 1;
      tuketilen = bas;
    }
    return { satirlar, tuketilen };
  },
});

const turSonucuSinifla = (sonuc: Extract<AkisOlayi, { tur: "result" }>): TurSonucuSinifi => {
  if (sonuc.terminal_reason !== null && sonuc.terminal_reason.startsWith("aborted_")) return "kesildi";
  return sonuc.is_error ? "hata" : "tamam";
};

const dolulukHesapla = (k: MesajKullanimi): number =>
  k.input_tokens + k.cache_creation_input_tokens + k.cache_read_input_tokens;

const devirEsigi = (pencere: number): number => Math.min(pencere * 0.5, DEVIR_USTSINIR);

const pencereSec = (
  pencereler: Readonly<Record<string, number>>,
  model: string | null,
): number | null => {
  const girdiler = Object.entries(pencereler).filter(([, p]) => sayiMi(p) && p > 0);
  if (girdiler.length === 0) return null;
  if (model !== null && model !== "") {
    const tam = girdiler.find(([ad]) => ad === model);
    if (tam) return tam[1];
    // `modelUsage` anahtarı sonek taşıyabilir (`[1m]` gibi).
    const onek = girdiler.find(([ad]) => ad.startsWith(model) || model.startsWith(ad));
    if (onek) return onek[1];
  }
  return Math.min(...girdiler.map(([, p]) => p));
};

export const akisKur: AkisFabrikasi = () => ({
  satirCoz,
  satirAyirici: satirAyiriciKur,
  turSonucuSinifla,
  dolulukHesapla,
  devirEsigi,
  pencereSec,
});
