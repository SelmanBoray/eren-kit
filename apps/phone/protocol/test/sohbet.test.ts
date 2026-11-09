import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EslestirmeQr,
  kimlikImzaMetni,
  OLAY_TURLERI,
  planHash,
  PROTOKOL_SURUMU,
  SINIRLAR,
  SohbetAsagi,
  SohbetYukari,
} from "../src/index.ts";
import { ANAHTAR, HASH, IMZA, NONCE, PLAN_PC, RAPOR } from "./ornekler.ts";

const v = PROTOKOL_SURUMU;

type Ornek = { gecerli: object[]; gecersiz: [string, object][] };

const YUKARI: Record<string, Ornek> = {
  hello: {
    gecerli: [{ v, type: "hello", device_id: "tel-1", last_seq: 0, client_nonce: NONCE }],
    gecersiz: [
      ["eksik last_seq", { v, type: "hello", device_id: "tel-1", client_nonce: NONCE }],
      ["negatif seq", { v, type: "hello", device_id: "tel-1", last_seq: -1, client_nonce: NONCE }],
      ["kısa nonce", { v, type: "hello", device_id: "tel-1", last_seq: 0, client_nonce: "abc" }],
    ],
  },
  pair_request: {
    gecerli: [
      { v, type: "pair_request", kod: "ABC123", public_key: ANAHTAR, platform: "android" },
      { v, type: "pair_request", kod: "ABC123", public_key: ANAHTAR, platform: "ipad", etiket: "x" },
    ],
    gecersiz: [
      ["küçük harf kod", { v, type: "pair_request", kod: "abc123", public_key: ANAHTAR, platform: "android" }],
      ["bilinmeyen platform", { v, type: "pair_request", kod: "ABC123", public_key: ANAHTAR, platform: "web" }],
    ],
  },
  auth_response: {
    gecerli: [{ v, type: "auth_response", signature: IMZA }],
    gecersiz: [["base64 değil", { v, type: "auth_response", signature: "!!!" }]],
  },
  user_message: {
    gecerli: [
      { v, type: "user_message", client_msg_id: "m1", input: "yazi", text: "Merhaba" },
      { v, type: "user_message", client_msg_id: "m2", input: "dikte", text: "Şurayı düzelt" },
    ],
    gecersiz: [
      ["bilinmeyen girdi yolu", { v, type: "user_message", client_msg_id: "m1", input: "ses", text: "x" }],
      ["boş metin", { v, type: "user_message", client_msg_id: "m1", input: "yazi", text: "" }],
      ["origin taşıyamaz", { v, type: "user_message", client_msg_id: "m1", input: "yazi", text: "x", origin: { kind: "human" } }],
      ["isSynthetic taşıyamaz", { v, type: "user_message", client_msg_id: "m1", input: "yazi", text: "x", isSynthetic: false }],
    ],
  },
  interrupt: {
    gecerli: [
      { v, type: "interrupt", client_msg_id: "m3" },
      { v, type: "interrupt", client_msg_id: "m3", turn_id: "t1" },
    ],
    gecersiz: [["client_msg_id yok", { v, type: "interrupt" }]],
  },
  plan_decision: {
    gecerli: [
      { v, type: "plan_decision", client_msg_id: "m4", plan_id: "plan-1", plan_hash: HASH, karar: "onay" },
      { v, type: "plan_decision", client_msg_id: "m4", plan_id: "plan-1", plan_hash: HASH, karar: "ret" },
    ],
    gecersiz: [
      ["karar yok", { v, type: "plan_decision", client_msg_id: "m4", plan_id: "plan-1", plan_hash: HASH }],
      ["büyük harf hash", { v, type: "plan_decision", client_msg_id: "m4", plan_id: "plan-1", plan_hash: "A".repeat(64), karar: "onay" }],
      ["kısa hash", { v, type: "plan_decision", client_msg_id: "m4", plan_id: "plan-1", plan_hash: "abc", karar: "onay" }],
    ],
  },
  question_answer: {
    gecerli: [{ v, type: "question_answer", client_msg_id: "m5", soru_id: "s1", cevap: "Evet" }],
    gecersiz: [["boş cevap", { v, type: "question_answer", client_msg_id: "m5", soru_id: "s1", cevap: "" }]],
  },
  job_cancel: {
    gecerli: [{ v, type: "job_cancel", client_msg_id: "m6", is_id: 7 }],
    gecersiz: [
      ["metin iş kimliği", { v, type: "job_cancel", client_msg_id: "m6", is_id: "7" }],
      ["sıfır iş kimliği", { v, type: "job_cancel", client_msg_id: "m6", is_id: 0 }],
    ],
  },
};

const ev = { seq: 5, ts_ms: 1000 };

const OLAYLAR: Record<string, Ornek> = {
  user_echo: {
    gecerli: [{ ...ev, type: "user_echo", client_msg_id: "m1", input: "yazi", text: "Merhaba" }],
    gecersiz: [["girdi yolu yok", { ...ev, type: "user_echo", client_msg_id: "m1", text: "x" }]],
  },
  assistant_message: {
    gecerli: [{ ...ev, type: "assistant_message", turn_id: "t1", text: "Tamam" }],
    gecersiz: [["turn_id yok", { ...ev, type: "assistant_message", text: "x" }]],
  },
  turn_aborted: {
    gecerli: [
      { ...ev, type: "turn_aborted", turn_id: "t1", neden: "kullanici_kesti" },
      { ...ev, type: "turn_aborted", turn_id: "t1", neden: "surec_oldu", kismi_metin: "yarım" },
    ],
    gecersiz: [["bilinmeyen neden", { ...ev, type: "turn_aborted", turn_id: "t1", neden: "x" }]],
  },
  plan_proposed: {
    gecerli: [{ ...ev, type: "plan_proposed", plan: PLAN_PC, plan_hash: planHash(PLAN_PC) }],
    gecersiz: [
      ["bozuk plan", { ...ev, type: "plan_proposed", plan: { ...PLAN_PC, cwd: "" }, plan_hash: HASH }],
      ["hash yok", { ...ev, type: "plan_proposed", plan: PLAN_PC }],
    ],
  },
  plan_resolved: {
    gecerli: [
      { ...ev, type: "plan_resolved", plan_id: "p", plan_hash: HASH, sonuc: "onaylandi", is_id: 7 },
      { ...ev, type: "plan_resolved", plan_id: "p", plan_hash: HASH, sonuc: "reddedildi" },
    ],
    gecersiz: [["bilinmeyen sonuç", { ...ev, type: "plan_resolved", plan_id: "p", plan_hash: HASH, sonuc: "x" }]],
  },
  job_started: {
    gecerli: [{ ...ev, type: "job_started", is_id: 7, plan_id: "p", plan_hash: HASH, baslik: "b", tur: "pc" }],
    gecersiz: [["tür yok", { ...ev, type: "job_started", is_id: 7, plan_id: "p", plan_hash: HASH, baslik: "b" }]],
  },
  job_finished: {
    gecerli: [
      { ...ev, type: "job_finished", is_id: 7, durum: "tamam", kirli: false, rapor: RAPOR },
      { ...ev, type: "job_finished", is_id: 7, durum: "yarim", kirli: true },
      { ...ev, type: "job_finished", is_id: 7, durum: "limit_durdu", kirli: false },
    ],
    gecersiz: [
      ["bilinmeyen durum", { ...ev, type: "job_finished", is_id: 7, durum: "bitti", kirli: false }],
      ["kirli yok", { ...ev, type: "job_finished", is_id: 7, durum: "tamam" }],
      ["bozuk rapor", { ...ev, type: "job_finished", is_id: 7, durum: "tamam", kirli: false, rapor: { yapildi: [] } }],
    ],
  },
  question_asked: {
    gecerli: [
      { ...ev, type: "question_asked", soru_id: "s1", is_id: 7, soru: "Devam?" },
      { ...ev, type: "question_asked", soru_id: "s1", is_id: 7, soru: "Hangisi?", secenekler: ["a", "b"] },
    ],
    gecersiz: [["boş soru", { ...ev, type: "question_asked", soru_id: "s1", is_id: 7, soru: "" }]],
  },
  question_resolved: {
    gecerli: [
      { ...ev, type: "question_resolved", soru_id: "s1", is_id: 7, sonuc: "cevaplandi", cevap: "Evet" },
      { ...ev, type: "question_resolved", soru_id: "s1", is_id: 7, sonuc: "iptal" },
    ],
    gecersiz: [["sonuç yok", { ...ev, type: "question_resolved", soru_id: "s1", is_id: 7 }]],
  },
  eren_handover: {
    gecerli: [{ ...ev, type: "eren_handover", nesil: 2, ozet_kabul: true }],
    gecersiz: [["sıfır nesil", { ...ev, type: "eren_handover", nesil: 0, ozet_kabul: true }]],
  },
  system_notice: {
    gecerli: [{ ...ev, type: "system_notice", seviye: "uyari", kod: "ram_dusuk", metin: "RAM düşük" }],
    gecersiz: [["bilinmeyen kod", { ...ev, type: "system_notice", seviye: "uyari", kod: "x", metin: "y" }]],
  },
};

const ASAGI: Record<string, Ornek> = {
  auth_challenge: {
    gecerli: [{ v, type: "auth_challenge", server_nonce: NONCE, server_signature: IMZA }],
    gecersiz: [["imza yok", { v, type: "auth_challenge", server_nonce: NONCE }]],
  },
  welcome: {
    gecerli: [{ v, type: "welcome", head_seq: 12, server_time_ms: 1000 }],
    gecersiz: [["head_seq yok", { v, type: "welcome", server_time_ms: 1000 }]],
  },
  pair_result: {
    gecerli: [
      { v, type: "pair_result", ok: true, device_id: "tel-1", server_public_key: ANAHTAR },
      { v, type: "pair_result", ok: false, code: "eslestirme_kapali" },
    ],
    gecersiz: [
      ["başarılı ama kimliksiz", { v, type: "pair_result", ok: true }],
      ["başarısız ama kodsuz", { v, type: "pair_result", ok: false }],
      ["başarısız ama anahtarlı", { v, type: "pair_result", ok: false, code: "yetkisiz", server_public_key: ANAHTAR }],
    ],
  },
  ack: {
    gecerli: [
      { v, type: "ack", client_msg_id: "m1", ok: true, seq: 3 },
      { v, type: "ack", client_msg_id: "m2", ok: true },
      { v, type: "ack", client_msg_id: "m3", ok: false, code: "plan_hash_uyusmuyor" },
    ],
    gecersiz: [
      ["başarısız ama kodsuz", { v, type: "ack", client_msg_id: "m1", ok: false }],
      ["başarılı ama kodlu", { v, type: "ack", client_msg_id: "m1", ok: true, code: "ic_hata" }],
      ["bilinmeyen kod", { v, type: "ack", client_msg_id: "m1", ok: false, code: "uyduruk" }],
    ],
  },
  assistant_delta: {
    gecerli: [{ v, type: "assistant_delta", turn_id: "t1", offset: 0, text: "Mer" }],
    gecersiz: [
      ["offset yok", { v, type: "assistant_delta", turn_id: "t1", text: "x" }],
      ["negatif offset", { v, type: "assistant_delta", turn_id: "t1", offset: -1, text: "x" }],
    ],
  },
  stream_snapshot: {
    gecerli: [{ v, type: "stream_snapshot", turn_id: "t1", text: "Merhaba" }],
    gecersiz: [["metin yok", { v, type: "stream_snapshot", turn_id: "t1" }]],
  },
  server_status: {
    gecerli: [{ v, type: "server_status", eren: "hazir", kilitli: false, aktif_is: 2, ram_bos_mb: 8000, ram_toplam_mb: 32000, ram_dusuk: false },
      { v, type: "server_status", eren: "hazir", kilitli: false, aktif_is: 2, ram_bos_mb: 8000, ram_toplam_mb: 32000, ram_dusuk: false, limit: { bes_saat: 0.4, bes_saat_sifirlanma_ms: 1762500000000, haftalik: 1 } },
      { v, type: "server_status", eren: "hazir", kilitli: false, aktif_is: 2, ram_bos_mb: 8000, ram_toplam_mb: 32000, ram_dusuk: false, limit: {} },
    ],
    gecersiz: [
      ["limit 1'den büyük", { v, type: "server_status", eren: "hazir", kilitli: false, aktif_is: 2, ram_bos_mb: 1, ram_toplam_mb: 1, ram_dusuk: false, limit: { bes_saat: 1.5 } }],
      ["limit bilinmeyen alan", { v, type: "server_status", eren: "hazir", kilitli: false, aktif_is: 2, ram_bos_mb: 1, ram_toplam_mb: 1, ram_dusuk: false, limit: { x: 1 } }],
      ["bilinmeyen durum", { v, type: "server_status", eren: "x", kilitli: false, aktif_is: 2, ram_bos_mb: 1, ram_toplam_mb: 1, ram_dusuk: false }],
    ],
  },
  error: {
    gecerli: [
      { v, type: "error", code: "telefon_bagli_degil" },
      { v, type: "error", code: "belirsiz", detail: "bağlantı koptu" },
    ],
    gecersiz: [["bilinmeyen kod", { v, type: "error", code: "uyduruk" }]],
  },
};

function denetle(sema: { safeParse(d: unknown): { success: boolean } }, tablo: Record<string, Ornek>, on: string) {
  for (const [ad, ornek] of Object.entries(tablo)) {
    test(`${on} ${ad}: geçerli örnekler`, () => {
      assert.ok(ornek.gecerli.length > 0);
      for (const g of ornek.gecerli) {
        const sonuc = sema.safeParse(g);
        assert.equal(sonuc.success, true, JSON.stringify(sonuc));
      }
    });
    test(`${on} ${ad}: geçersiz örnekler ve bilinmeyen alan`, () => {
      assert.ok(ornek.gecersiz.length > 0);
      for (const [neden, g] of ornek.gecersiz) {
        assert.equal(sema.safeParse(g).success, false, neden);
      }
      assert.equal(sema.safeParse({ ...ornek.gecerli[0], bilinmeyen: 1 }).success, false);
    });
  }
}

denetle(SohbetYukari, YUKARI, "/sohbet yukarı");
denetle(SohbetAsagi, ASAGI, "/sohbet aşağı");

const olayMesaji = { safeParse: (d: unknown) => SohbetAsagi.safeParse({ v, type: "event", event: d }) };
denetle(olayMesaji, OLAYLAR, "/sohbet event");

test("her olay türünün tablo karşılığı vardır", () => {
  assert.deepEqual(Object.keys(OLAYLAR).sort(), [...OLAY_TURLERI].sort());
});

test("kararlar listesindeki adların hepsi vardır", () => {
  for (const ad of ["hello", "auth_response", "user_message", "interrupt", "plan_decision", "question_answer", "job_cancel"]) {
    assert.ok(YUKARI[ad], ad);
  }
  for (const ad of ["auth_challenge", "welcome", "assistant_delta", "stream_snapshot"]) {
    assert.ok(ASAGI[ad], ad);
  }
});

test("olay zarfı seq ve ts_ms ister", () => {
  const olay = { type: "assistant_message", turn_id: "t1", text: "x" };
  assert.equal(olayMesaji.safeParse({ ...olay, seq: 1, ts_ms: 1 }).success, true);
  assert.equal(olayMesaji.safeParse({ ...olay, ts_ms: 1 }).success, false);
  assert.equal(olayMesaji.safeParse({ ...olay, seq: 1 }).success, false);
  assert.equal(olayMesaji.safeParse({ ...olay, seq: 0, ts_ms: 1 }).success, false);
});

test("sürüm her mesajda zorunludur ve tam eşleşir", () => {
  const taban = { type: "interrupt", client_msg_id: "m" };
  assert.equal(SohbetYukari.safeParse({ ...taban, v }).success, true);
  assert.equal(SohbetYukari.safeParse(taban).success, false);
  assert.equal(SohbetYukari.safeParse({ ...taban, v: v + 1 }).success, false);
  assert.equal(SohbetYukari.safeParse({ ...taban, v: String(v) }).success, false);
});

test("yukarı ve aşağı türler birbirine karışmaz", () => {
  assert.equal(SohbetYukari.safeParse({ v, type: "welcome", head_seq: 1, server_time_ms: 1 }).success, false);
  assert.equal(SohbetAsagi.safeParse({ v, type: "user_message", client_msg_id: "m", input: "yazi", text: "x" }).success, false);
});

test("sohbet boyut sınırları", () => {
  const mesaj = (text: string) => ({ v, type: "user_message", client_msg_id: "m", input: "yazi", text });
  assert.equal(SohbetYukari.safeParse(mesaj("x".repeat(SINIRLAR.KULLANICI_METNI))).success, true);
  assert.equal(SohbetYukari.safeParse(mesaj("x".repeat(SINIRLAR.KULLANICI_METNI + 1))).success, false);

  const delta = (text: string) => ({ v, type: "assistant_delta", turn_id: "t", offset: 0, text });
  assert.equal(SohbetAsagi.safeParse(delta("x".repeat(SINIRLAR.DELTA_METNI))).success, true);
  assert.equal(SohbetAsagi.safeParse(delta("x".repeat(SINIRLAR.DELTA_METNI + 1))).success, false);

  assert.equal(
    SohbetYukari.safeParse({ v, type: "interrupt", client_msg_id: "x".repeat(SINIRLAR.OPAK_ID + 1) }).success,
    false,
  );
  assert.equal(
    SohbetYukari.safeParse({ v, type: "question_answer", client_msg_id: "m", soru_id: "s", cevap: "x".repeat(SINIRLAR.CEVAP_METNI + 1) }).success,
    false,
  );
  const secenekler = Array(SINIRLAR.SECENEK_ADET + 1).fill("a");
  assert.equal(
    olayMesaji.safeParse({ ...ev, type: "question_asked", soru_id: "s", is_id: 1, soru: "?", secenekler }).success,
    false,
  );
});

test("QR yalnız Tailscale aralığını kabul eder", () => {
  const qr = { v, port: 8765, kod: "ABC123", server_public_key: ANAHTAR };
  assert.equal(EslestirmeQr.safeParse({ ...qr, host: "100.64.0.1" }).success, true);
  assert.equal(EslestirmeQr.safeParse({ ...qr, host: "100.127.255.255" }).success, true);
  for (const host of ["100.63.0.1", "100.128.0.1", "172.16.1.5", "8.8.8.8", "100.64.0.256", "ornek.net", "100.64.0"]) {
    assert.equal(EslestirmeQr.safeParse({ ...qr, host }).success, false, host);
  }
  assert.equal(EslestirmeQr.safeParse({ ...qr, host: "100.64.0.1", port: 0 }).success, false);
  assert.equal(EslestirmeQr.safeParse({ ...qr, host: "100.64.0.1", fazla: 1 }).success, false);
});

test("kimlik imzası metni rol ve kanala bağlıdır", () => {
  const taban = { device_id: "tel-1", client_nonce: "c", server_nonce: "s" };
  assert.equal(
    kimlikImzaMetni({ rol: "telefon", kanal: "sohbet", ...taban }),
    "eren-auth-v1\ntelefon\nsohbet\ntel-1\nc\ns",
  );
  assert.notEqual(
    kimlikImzaMetni({ rol: "telefon", kanal: "sohbet", ...taban }),
    kimlikImzaMetni({ rol: "pc", kanal: "sohbet", ...taban }),
  );
  assert.notEqual(
    kimlikImzaMetni({ rol: "telefon", kanal: "sohbet", ...taban }),
    kimlikImzaMetni({ rol: "telefon", kanal: "cihaz", ...taban }),
  );
});
