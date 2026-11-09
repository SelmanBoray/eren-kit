import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { baglantiKur } from "../../src/cekirdek/baglanti.ts";
import type { Baglanti, KimlikliCerceve, UsageRequest as UsageRequestTipi } from "../../src/cekirdek/baglanti.ts";
import { SOHBET_SURUMU, UsageRequest } from "@eren/protocol";
import { bosalt, challenge, elSikis, SahteKimlik, SahteSaat, SahteWs, welcome } from "./sahte.ts";

const kur = () => {
  const ws = new SahteWs();
  const kimlik = new SahteKimlik();
  const saat = new SahteSaat();
  const cerceveler: KimlikliCerceve[] = [];
  const b: Baglanti = baglantiKur({
    ws,
    kimlik,
    saat,
    sonSeq: () => 0,
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
