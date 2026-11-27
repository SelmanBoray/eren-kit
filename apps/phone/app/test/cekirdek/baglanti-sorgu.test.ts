import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { baglantiKur } from "../../src/cekirdek/baglanti.ts";
import type { Baglanti, KimlikliCerceve, UsageRequest as UsageRequestTipi } from "../../src/cekirdek/baglanti.ts";
import { MediaBegin, MediaCancel, SOHBET_SURUMU, UsageRequest } from "@eren/protocol";
import type { MedyaYukari } from "../../src/cekirdek/sozlesme.ts";
import {
  bosalt,
  challenge,
  ekBilgisi,
  elSikis,
  mediaState,
  SahteKimlik,
  SahteSaat,
  SahteWs,
  welcome,
  welcomeMedyali,
} from "./sahte.ts";

const kur = (medya?: boolean) => {
  const ws = new SahteWs();
  const kimlik = new SahteKimlik();
  const saat = new SahteSaat();
  const cerceveler: KimlikliCerceve[] = [];
  const b: Baglanti = baglantiKur({
    ws,
    kimlik,
    saat,
    sonSeq: () => 0,
    ...(medya === undefined ? {} : { medya }),
    dinleyici: {
      durumDegisti: () => {},
      hata: () => {},
      kimlikTamam: () => {},
      cerceve: (c) => cerceveler.push(c),
      koptu: () => {},
    },
  });
  return { ws, saat, b, cerceveler };
};

const SORGU: UsageRequestTipi = { v: SOHBET_SURUMU, type: "usage_request", istek_id: "u-1" };
const IS_MESAJI = { v: SOHBET_SURUMU, type: "user_message", client_msg_id: "x-1", sohbet_id: "ana", input: "yazi", text: "merhaba" } as Parameters<Baglanti["gonder"]>[0];

describe("baglanti: sorguGonder (usage_request)", () => {
  it("bağlıyken true döner, sokete tam bir çerçeve yazılır, şemadan geçer, istek_id aynıdır", async () => {
    const { ws, b } = kur();
    b.baslat();
    await bosalt();
    await elSikis(ws.son());
    const once = ws.son().gidenler.length;
    assert.equal(b.sorguGonder(SORGU), true);
    const c = ws.son();
    assert.equal(c.gidenler.length, once + 1);
    const giden = c.giden().at(-1);
    const sonuc = UsageRequest.safeParse(giden);
    assert.ok(sonuc.success, "usage_request şemasından geçmeli");
    assert.equal(giden?.["type"], "usage_request");
    assert.equal(giden?.["v"], SOHBET_SURUMU);
    assert.equal(giden?.["istek_id"], SORGU.istek_id);
    assert.equal("client_msg_id" in (giden ?? {}), false);
  });

  it("bağlı değilken (bağlanıyor, açıldı, kimlik bekliyor, el sıkışma) false döner, hiçbir şey yazılmaz", async () => {
    const { ws, b } = kur();
    // Henüz başlamadı.
    assert.equal(b.sorguGonder(SORGU), false);
    b.baslat();
    assert.equal(b.sorguGonder(SORGU), false);
    await bosalt();
    const c = ws.son();
    assert.equal(b.sorguGonder(SORGU), false);
    assert.deepEqual(c.gidenler, []);
    c.acildi();
    await bosalt();
    assert.equal(b.sorguGonder(SORGU), false);
    c.gel(challenge());
    await bosalt();
    assert.equal(b.sorguGonder(SORGU), false);
    assert.deepEqual(c.tipler(), ["hello", "auth_response"]);
    c.gel(welcome(0));
    await bosalt();
    assert.equal(b.sorguGonder(SORGU), true);
  });

  it("kopuk bağlantıda false döner, sokete yazılmaz", async () => {
    const { ws, b } = kur();
    b.baslat();
    await bosalt();
    await elSikis(ws.son());
    const c = ws.son();
    c.kopsun();
    const once = c.gidenler.length;
    assert.equal(b.sorguGonder(SORGU), false);
    assert.equal(c.gidenler.length, once);
    b.durdur();
    assert.equal(b.sorguGonder(SORGU), false);
    assert.equal(c.gidenler.length, once);
  });

  it("gönderilen sorgu kuyruğa girmez: yeniden bağlanınca tekrar gönderilmez", async () => {
    const { ws, saat, b } = kur();
    b.baslat();
    await bosalt();
    await elSikis(ws.son());
    assert.equal(b.sorguGonder(SORGU), true);
    // Kopmadan önce bağlı değilken de bir sorgu denenir; o da bekletilmemeli.
    ws.son().kopsun();
    assert.equal(b.sorguGonder({ ...SORGU, istek_id: "u-2" }), false);
    saat.ilerlet(1000);
    await bosalt();
    assert.equal(ws.baglantilar.length, 2);
    await elSikis(ws.son());
    assert.equal(ws.son().tipler().includes("usage_request"), false);
    assert.deepEqual(ws.son().tipler(), ["hello", "auth_response"]);
  });

  it("sorguGonder olağan gonder davranışını bozmaz", async () => {
    const { ws, b } = kur();
    b.baslat();
    await bosalt();
    assert.equal(b.gonder(IS_MESAJI), false);
    assert.equal(b.sorguGonder(SORGU), false);
    await elSikis(ws.son());
    assert.equal(b.sorguGonder(SORGU), true);
    assert.equal(b.gonder(IS_MESAJI), true);
    assert.equal(b.sorguGonder({ ...SORGU, istek_id: "u-3" }), true);
    assert.deepEqual(ws.son().tipler(), ["hello", "auth_response", "usage_request", "user_message", "usage_request"]);
    assert.deepEqual(ws.son().giden()[3], IS_MESAJI);
  });
});

const BEGIN: MedyaYukari = { v: SOHBET_SURUMU, type: "media_begin", sohbet_id: "ana", ...ekBilgisi("m-a-1") } as MedyaYukari;
const IPTAL: MedyaYukari = { v: SOHBET_SURUMU, type: "media_cancel", medya_id: "m-a-1" };

/** Bağlantıyı verilen `welcome`'a kadar götürür. */
const elSikisW = async (c: ReturnType<SahteWs["son"]>, w: unknown): Promise<void> => {
  c.acildi();
  await bosalt();
  c.gel(challenge());
  await bosalt();
  c.gel(w);
  await bosalt();
};

describe("baglanti: medya (yetenek medya1)", () => {
  it("medya portu varsa sorgu etkinlik1,medya1 ister; yoksa yalnız etkinlik1 (bugünkü adres)", async () => {
    const m = kur(true);
    m.b.baslat();
    await bosalt();
    assert.equal(new URL(m.ws.son().url).searchParams.get("yetenek"), "etkinlik1,medya1");
    const y = kur();
    y.b.baslat();
    await bosalt();
    assert.equal(new URL(y.ws.son().url).search, "?yetenek=etkinlik1");
    const f = kur(false);
    f.b.baslat();
    await bosalt();
    assert.equal(new URL(f.ws.son().url).search, "?yetenek=etkinlik1");
  });

  it("medyaGonder yalnız bağlı ve welcome.yetenekler medya1 içerirken yazar; çerçeve şemadan geçer", async () => {
    const { ws, b } = kur(true);
    assert.equal(b.medyaGonder(BEGIN), false);
    b.baslat();
    await bosalt();
    const c = ws.son();
    assert.equal(b.medyaGonder(BEGIN), false);
    c.acildi();
    await bosalt();
    c.gel(challenge());
    await bosalt();
    assert.equal(b.medyaGonder(BEGIN), false, "welcome'dan önce yazılmaz");
    c.gel(welcomeMedyali(0));
    await bosalt();
    assert.equal(b.medyaGonder(BEGIN), true);
    assert.equal(b.medyaGonder(IPTAL), true);
    assert.deepEqual(c.tipler(), ["hello", "auth_response", "media_begin", "media_cancel"]);
    assert.ok(MediaBegin.safeParse(c.giden()[2]).success);
    assert.ok(MediaCancel.safeParse(c.giden()[3]).success);
    assert.equal("client_msg_id" in (c.giden()[2] ?? {}), false);
    // Aşağı `media_state` dinleyiciye gelir.
    c.gel(mediaState("m-a-1", "kabul"));
    await bosalt();
    c.kopsun();
    assert.equal(b.medyaGonder(BEGIN), false, "kopukta yazılmaz");
  });

  it("welcome'da yetenekler yoksa ya da medya1 yoksa medyaGonder false, hiçbir şey yazılmaz", async () => {
    for (const w of [welcome(0), welcomeMedyali(0, []), welcomeMedyali(0, ["baska1"])]) {
      const { ws, b } = kur(true);
      b.baslat();
      await bosalt();
      await elSikisW(ws.son(), w);
      assert.equal(b.medyaGonder(BEGIN), false);
      assert.deepEqual(ws.son().tipler(), ["hello", "auth_response"]);
    }
  });

  it("medya portu yoksa servis medya1 dese de medyaGonder false", async () => {
    const { ws, b } = kur();
    b.baslat();
    await bosalt();
    await elSikisW(ws.son(), welcomeMedyali(0));
    assert.equal(b.medyaGonder(BEGIN), false);
  });

  it("medyaGonder iş mesajı ya da sorgu yazmaz; gonder medya çerçevesi yazmaz", async () => {
    const { ws, b } = kur(true);
    b.baslat();
    await bosalt();
    await elSikisW(ws.son(), welcomeMedyali(0));
    assert.equal(b.medyaGonder(IS_MESAJI as unknown as MedyaYukari), false);
    assert.equal(b.medyaGonder(SORGU as unknown as MedyaYukari), false);
    assert.equal(b.gonder(BEGIN as unknown as Parameters<Baglanti["gonder"]>[0]), false);
    assert.deepEqual(ws.son().tipler(), ["hello", "auth_response"]);
  });

  it("media_state kimlikten sonra dinleyiciye gelir", async () => {
    const { ws, b, cerceveler } = kur(true);
    b.baslat();
    await bosalt();
    await elSikisW(ws.son(), welcomeMedyali(0));
    ws.son().gel(mediaState("m-a-1", "yukleniyor", { alinan: 10 }));
    await bosalt();
    assert.deepEqual(cerceveler.map((c) => c.type), ["media_state"]);
  });
});
