/**
 * Telefon uygulaması ve servis pakete böyle bağlanır: paket adıyla, derleme adımı olmadan.
 * Değerler ve tipler aynı addan gelir.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CihazAsagi,
  cmdSonucuMetni,
  type CmdSonucu,
  HATA_KODLARI,
  type HataKodu,
  type IsRaporu,
  isRaporuJsonSemasi,
  type KopruFiili,
  type KopruRolu,
  Plan,
  planHash,
  SOHBET_SURUMU,
  type SohbetAsagi,
  sohbetYukariCoz,
  type SohbetYukari,
} from "@eren/protocol";

test("paket adıyla içe aktarılır, şema hem değer hem tiptir", () => {
  const plan: Plan = {
    plan_id: "p1",
    baslik: "Başlık",
    tur: "pc",
    cwd: "C:\\Proje",
    gorev_metni: "Görev",
  };
  assert.equal(Plan.parse(plan).plan_id, "p1");
  assert.match(planHash(plan), /^[0-9a-f]{64}$/);
});

test("tipler servis ve uygulama tarafında aynı şekilde kullanılır", () => {
  // `/sohbet` iş mesajları `SOHBET_SURUMU` taşır.
  const yukari: SohbetYukari = {
    v: SOHBET_SURUMU,
    type: "user_message",
    client_msg_id: "m1",
    sohbet_id: "ana",
    input: "yazi",
    text: "Merhaba",
  };
  const asagi: SohbetAsagi = {
    v: SOHBET_SURUMU,
    type: "ack",
    client_msg_id: "m1",
    ok: true,
    seq: 1,
  };
  const sonuc = sohbetYukariCoz(JSON.stringify(yukari));
  assert.equal(sonuc.ok, true);
  assert.equal(asagi.type, "ack");

  const rol: KopruRolu = "soru";
  const fiil: KopruFiili = "kullaniciya_sor";
  const kod: HataKodu = "telefon_bagli_degil";
  const rapor: IsRaporu = { yapildi: [], yapilmadi: [], dosyalar: [], acik_noktalar: [] };
  const komut: CmdSonucu = { ok: true, foreground: null };
  assert.equal(rol, "soru");
  assert.equal(fiil, "kullaniciya_sor");
  assert.ok(HATA_KODLARI.includes(kod));
  assert.equal(rapor.yapildi.length, 0);
  assert.equal(cmdSonucuMetni(komut), "ok | foreground: none");
  assert.ok(isRaporuJsonSemasi().includes("acik_noktalar"));
  assert.equal(CihazAsagi.safeParse({}).success, false);
});
