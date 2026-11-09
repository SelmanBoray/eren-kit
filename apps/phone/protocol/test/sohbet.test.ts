import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  ANA_SOHBET_ADI,
  ANA_SOHBET_ID,
  EslestirmeQr,
  kimlikImzaMetni,
  Olay,
  OLAY_TURLERI,
  planHash,
  PROTOKOL_SURUMU,
  SILINMEZ_OLAY_TURLERI,
  SINIRLAR,
  SOHBET_EREN_DURUMLARI,
  SOHBET_SINIRLARI,
  SOHBET_SURUMU,
  SOHBET_V1_TURLERI,
  SOHBET_YASAM_OLAYLARI,
  sohbetAnahtari,
  SohbetAdi,
  SohbetAsagi,
  SohbetId,
  sohbetSurumu,
  SohbetYukari,
  VARSAYILAN_SOHBET_ADI,
} from "../src/index.ts";
import { ANAHTAR, HASH, IMZA, NONCE, PLAN_PC, RAPOR } from "./ornekler.ts";

// `/sohbet` `SOHBET_SURUMU` (4) konuşur; eşleştirme (`pair_request`, `pair_result`) ve QR Kotlin'e bağlı
// olduğu için v1 kalır.
const v = SOHBET_SURUMU;
const v1 = PROTOKOL_SURUMU;
const SERVIS = { surum: null, baslangic_ms: 1000 };
const s = "ana";
const SOHBETLER = [{ sohbet_id: "ana", eren: "hazir" }];
const durum = { v, type: "server_status", sohbetler: SOHBETLER, kilitli: false, aktif_is: 2, ram_bos_mb: 8000, ram_toplam_mb: 32000, ram_dusuk: false, servis: SERVIS };

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
      { v: v1, type: "pair_request", kod: "ABC123", public_key: ANAHTAR, platform: "android" },
      { v: v1, type: "pair_request", kod: "ABC123", public_key: ANAHTAR, platform: "ipad", etiket: "x" },
    ],
    gecersiz: [
      ["küçük harf kod", { v: v1, type: "pair_request", kod: "abc123", public_key: ANAHTAR, platform: "android" }],
      ["bilinmeyen platform", { v: v1, type: "pair_request", kod: "ABC123", public_key: ANAHTAR, platform: "web" }],
    ],
  },
  auth_response: {
    gecerli: [{ v, type: "auth_response", signature: IMZA }],
    gecersiz: [["base64 değil", { v, type: "auth_response", signature: "!!!" }]],
  },
  user_message: {
    gecerli: [
      { v, type: "user_message", client_msg_id: "m1", sohbet_id: s, input: "yazi", text: "Merhaba" },
      { v, type: "user_message", client_msg_id: "m2", sohbet_id: "s-7f3a", input: "dikte", text: "Şurayı düzelt" },
      { v, type: "user_message", client_msg_id: "m4", sohbet_id: s, input: "kisayol", text: "Bunu özetle" },
      { v, type: "user_message", client_msg_id: "m5", sohbet_id: s, input: "kisayol", text: "x", baglam: { paket: "com.android.chrome", ad: "Chrome" } },
      { v, type: "user_message", client_msg_id: "m6", sohbet_id: s, input: "kisayol", text: "x", baglam: { paket: "a.b", ad: "a".repeat(80) } },
    ],
    gecersiz: [
      ["sohbet_id yok", { v, type: "user_message", client_msg_id: "m1", input: "yazi", text: "x" }],
      ["boş sohbet_id", { v, type: "user_message", client_msg_id: "m1", sohbet_id: "", input: "yazi", text: "x" }],
      ["opak olmayan sohbet_id", { v, type: "user_message", client_msg_id: "m1", sohbet_id: "../ana", input: "yazi", text: "x" }],
      ["kisayol dışı input ile baglam", { v, type: "user_message", client_msg_id: "m1", sohbet_id: s, input: "yazi", text: "x", baglam: { paket: "com.a.b", ad: "A" } }],
      ["baglam paket deseni", { v, type: "user_message", client_msg_id: "m1", sohbet_id: s, input: "kisayol", text: "x", baglam: { paket: "yok", ad: "A" } }],
      ["baglam paket sınırı", { v, type: "user_message", client_msg_id: "m1", sohbet_id: s, input: "kisayol", text: "x", baglam: { paket: `a.${"b".repeat(254)}`, ad: "A" } }],
      ["baglam boş ad", { v, type: "user_message", client_msg_id: "m1", sohbet_id: s, input: "kisayol", text: "x", baglam: { paket: "com.a.b", ad: "" } }],
      ["baglam ad sınırı", { v, type: "user_message", client_msg_id: "m1", sohbet_id: s, input: "kisayol", text: "x", baglam: { paket: "com.a.b", ad: "a".repeat(81) } }],
      ["baglam ad C0", { v, type: "user_message", client_msg_id: "m1", sohbet_id: s, input: "kisayol", text: "x", baglam: { paket: "com.a.b", ad: "a\u0007b" } }],
      ["baglam ad C1", { v, type: "user_message", client_msg_id: "m1", sohbet_id: s, input: "kisayol", text: "x", baglam: { paket: "com.a.b", ad: "a\u0085b" } }],
      ["baglam fazla alan", { v, type: "user_message", client_msg_id: "m1", sohbet_id: s, input: "kisayol", text: "x", baglam: { paket: "com.a.b", ad: "A", x: 1 } }],
      ["v3 sürümlü mesaj", { v: 3, type: "user_message", client_msg_id: "m1", sohbet_id: s, input: "yazi", text: "x" }],
      ["bilinmeyen girdi yolu", { v, type: "user_message", client_msg_id: "m1", sohbet_id: s, input: "ses", text: "x" }],
      ["boş metin", { v, type: "user_message", client_msg_id: "m1", sohbet_id: s, input: "yazi", text: "" }],
      ["origin taşıyamaz", { v, type: "user_message", client_msg_id: "m1", sohbet_id: s, input: "yazi", text: "x", origin: { kind: "human" } }],
      ["isSynthetic taşıyamaz", { v, type: "user_message", client_msg_id: "m1", sohbet_id: s, input: "yazi", text: "x", isSynthetic: false }],
    ],
  },
  interrupt: {
    gecerli: [
      { v, type: "interrupt", client_msg_id: "m3", sohbet_id: s },
      { v, type: "interrupt", client_msg_id: "m3", sohbet_id: "s2", turn_id: "t1" },
    ],
    gecersiz: [
      ["client_msg_id yok", { v, type: "interrupt", sohbet_id: s }],
      ["sohbet_id yok", { v, type: "interrupt", client_msg_id: "m3" }],
      ["sohbet_id yok, tur var", { v, type: "interrupt", client_msg_id: "m3", turn_id: "t1" }],
    ],
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
      // Plan, soru ve iş kimlikleri küresel tekildir: bu üç mesaj `sohbet_id` taşımaz.
      ["sohbet_id taşımaz", { v, type: "job_cancel", client_msg_id: "m6", is_id: 7, sohbet_id: s }],
    ],
  },
  chat_clear: {
    gecerli: [
      { v, type: "chat_clear", client_msg_id: "m7", sohbet_id: s },
      { v, type: "chat_clear", client_msg_id: "m7", sohbet_id: "s2" },
    ],
    gecersiz: [
      ["sohbet_id yok (v2 biçimi)", { v, type: "chat_clear", client_msg_id: "m7" }],
      ["client_msg_id yok", { v, type: "chat_clear", sohbet_id: s }],
    ],
  },
  chat_create: {
    gecerli: [
      { v, type: "chat_create", client_msg_id: "m8", sohbet_id: "s2", ad: VARSAYILAN_SOHBET_ADI },
      { v, type: "chat_create", client_msg_id: "m8", sohbet_id: "s2", ad: "Tez 🎓 notları" },
    ],
    gecersiz: [
      ["ad yok", { v, type: "chat_create", client_msg_id: "m8", sohbet_id: "s2" }],
      ["boş ad", { v, type: "chat_create", client_msg_id: "m8", sohbet_id: "s2", ad: "" }],
      ["sohbet_id yok", { v, type: "chat_create", client_msg_id: "m8", ad: "x" }],
      ["opak olmayan sohbet_id", { v, type: "chat_create", client_msg_id: "m8", sohbet_id: "a b", ad: "x" }],
      ["iki satır ad", { v, type: "chat_create", client_msg_id: "m8", sohbet_id: "s2", ad: "a\nb" }],
    ],
  },
  chat_rename: {
    gecerli: [
      { v, type: "chat_rename", client_msg_id: "m9", sohbet_id: s, ad: "Ana sohbet" },
      { v, type: "chat_rename", client_msg_id: "m9", sohbet_id: "s2", ad: "x" },
    ],
    gecersiz: [
      ["boş ad", { v, type: "chat_rename", client_msg_id: "m9", sohbet_id: s, ad: "" }],
      ["ad yok", { v, type: "chat_rename", client_msg_id: "m9", sohbet_id: s }],
      ["sohbet_id yok", { v, type: "chat_rename", client_msg_id: "m9", ad: "x" }],
    ],
  },
  chat_delete: {
    // `ana` kablo düzeyinde geçerlidir; servis `sohbet_silinemez` döner.
    gecerli: [
      { v, type: "chat_delete", client_msg_id: "m10", sohbet_id: "s2" },
      { v, type: "chat_delete", client_msg_id: "m10", sohbet_id: s },
    ],
    gecersiz: [
      ["sohbet_id yok", { v, type: "chat_delete", client_msg_id: "m10" }],
      ["ad taşımaz", { v, type: "chat_delete", client_msg_id: "m10", sohbet_id: "s2", ad: "x" }],
    ],
  },
};

const ev = { seq: 5, ts_ms: 1000 };

const OLAYLAR: Record<string, Ornek> = {
  user_echo: {
    gecerli: [
      { ...ev, type: "user_echo", client_msg_id: "m1", input: "yazi", text: "Merhaba" },
      { ...ev, type: "user_echo", client_msg_id: "m1", input: "kisayol", text: "x", baglam: { paket: "com.a.b", ad: "A" } },
    ],
    gecersiz: [
      ["kisayol dışı input ile baglam", { ...ev, type: "user_echo", client_msg_id: "m1", input: "dikte", text: "x", baglam: { paket: "com.a.b", ad: "A" } }],
      ["baglam ad C0", { ...ev, type: "user_echo", client_msg_id: "m1", input: "kisayol", text: "x", baglam: { paket: "com.a.b", ad: "a\u0000" } }],["girdi yolu yok", { ...ev, type: "user_echo", client_msg_id: "m1", text: "x" }]],
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
  chat_cleared: {
    gecerli: [
      { ...ev, type: "chat_cleared", sohbet_id: "s2", sinir_seq: 4 },
      // v2 mezar taşı: alansız, `ana`'nındır.
      { ...ev, type: "chat_cleared", sinir_seq: 4 },
    ],
    gecersiz: [
      ["sinir_seq yok", { ...ev, type: "chat_cleared", sohbet_id: s }],
      ["opak olmayan sohbet_id", { ...ev, type: "chat_cleared", sohbet_id: "a/b", sinir_seq: 4 }],
    ],
  },
  chat_created: {
    gecerli: [{ ...ev, type: "chat_created", sohbet_id: "s2", ad: VARSAYILAN_SOHBET_ADI }],
    gecersiz: [
      ["sohbet_id yok", { ...ev, type: "chat_created", ad: "x" }],
      ["boş ad", { ...ev, type: "chat_created", sohbet_id: "s2", ad: "" }],
      ["ad yok", { ...ev, type: "chat_created", sohbet_id: "s2" }],
    ],
  },
  chat_renamed: {
    gecerli: [
      { ...ev, type: "chat_renamed", sohbet_id: "s2", ad: "Yeni ad" },
      { ...ev, type: "chat_renamed", sohbet_id: s, ad: "Ana" },
    ],
    gecersiz: [
      ["sohbet_id yok", { ...ev, type: "chat_renamed", ad: "x" }],
      ["sondaki boşluk", { ...ev, type: "chat_renamed", sohbet_id: "s2", ad: "x " }],
    ],
  },
  chat_deleted: {
    gecerli: [{ ...ev, type: "chat_deleted", sohbet_id: "s2" }],
    gecersiz: [
      ["sohbet_id yok", { ...ev, type: "chat_deleted" }],
      ["sinir_seq taşımaz", { ...ev, type: "chat_deleted", sohbet_id: "s2", sinir_seq: 4 }],
    ],
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
      { v: v1, type: "pair_result", ok: true, device_id: "tel-1", server_public_key: ANAHTAR },
      { v: v1, type: "pair_result", ok: false, code: "eslestirme_kapali" },
    ],
    gecersiz: [
      ["başarılı ama kimliksiz", { v: v1, type: "pair_result", ok: true }],
      ["başarısız ama kodsuz", { v: v1, type: "pair_result", ok: false }],
      ["başarısız ama anahtarlı", { v: v1, type: "pair_result", ok: false, code: "yetkisiz", server_public_key: ANAHTAR }],
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
    gecerli: [{ v, type: "assistant_delta", sohbet_id: s, turn_id: "t1", offset: 0, text: "Mer" }],
    gecersiz: [
      ["sohbet_id yok", { v, type: "assistant_delta", turn_id: "t1", offset: 0, text: "x" }],
      ["offset yok", { v, type: "assistant_delta", sohbet_id: s, turn_id: "t1", text: "x" }],
      ["negatif offset", { v, type: "assistant_delta", sohbet_id: s, turn_id: "t1", offset: -1, text: "x" }],
    ],
  },
  stream_snapshot: {
    gecerli: [{ v, type: "stream_snapshot", sohbet_id: "s2", turn_id: "t1", text: "Merhaba" }],
    gecersiz: [
      ["sohbet_id yok", { v, type: "stream_snapshot", turn_id: "t1", text: "x" }],
      ["metin yok", { v, type: "stream_snapshot", sohbet_id: s, turn_id: "t1" }],
    ],
  },
  server_status: {
    gecerli: [
      durum,
      { ...durum, limit: { bes_saat: 0.4, bes_saat_sifirlanma_ms: 1762500000000, haftalik: 1 } },
      { ...durum, limit: {} },
      {
        ...durum,
        sohbetler: [
          { sohbet_id: "s2", eren: "tur_suruyor" },
          { sohbet_id: "ana", eren: "uyuyor" },
          { sohbet_id: "s3", eren: "sirada" },
          { sohbet_id: "s4", eren: "baslatiliyor" },
          { sohbet_id: "s5", eren: "kapali" },
        ],
      },
    ],
    gecersiz: [
      ["limit 1'den büyük", { ...durum, limit: { bes_saat: 1.5 } }],
      ["limit bilinmeyen alan", { ...durum, limit: { x: 1 } }],
      ["bilinmeyen durum", { ...durum, sohbetler: [{ sohbet_id: "ana", eren: "x" }] }],
      ["v2 eren alanı", { ...durum, eren: "hazir" }],
      ["sohbetler yok", { ...durum, sohbetler: undefined }],
      ["boş sohbetler", { ...durum, sohbetler: [] }],
      ["ana yok", { ...durum, sohbetler: [{ sohbet_id: "s2", eren: "hazir" }] }],
      ["yinelenen sohbet", { ...durum, sohbetler: [{ sohbet_id: "ana", eren: "hazir" }, { sohbet_id: "ana", eren: "uyuyor" }] }],
      ["öğede bilinmeyen alan", { ...durum, sohbetler: [{ sohbet_id: "ana", eren: "hazir", ad: "Ad" }] }],
      ["servis yok", { ...durum, servis: undefined }],
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
  for (const ad of [
    "hello", "auth_response", "user_message", "interrupt", "plan_decision", "question_answer", "job_cancel",
    "chat_clear", "chat_create", "chat_rename", "chat_delete",
  ]) {
    assert.ok(YUKARI[ad], ad);
  }
  for (const ad of ["auth_challenge", "welcome", "assistant_delta", "stream_snapshot", "server_status"]) {
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
  const taban = { type: "interrupt", client_msg_id: "m", sohbet_id: s };
  assert.equal(SohbetYukari.safeParse({ ...taban, v }).success, true);
  assert.equal(SohbetYukari.safeParse(taban).success, false);
  assert.equal(SohbetYukari.safeParse({ ...taban, v: v + 1 }).success, false);
  assert.equal(SohbetYukari.safeParse({ ...taban, v: String(v) }).success, false);
});

test("yukarı ve aşağı türler birbirine karışmaz", () => {
  assert.equal(SohbetYukari.safeParse({ v, type: "welcome", head_seq: 1, server_time_ms: 1 }).success, false);
  assert.equal(SohbetAsagi.safeParse({ v, type: "user_message", client_msg_id: "m", sohbet_id: s, input: "yazi", text: "x" }).success, false);
  assert.equal(SohbetAsagi.safeParse({ v, type: "chat_create", client_msg_id: "m", sohbet_id: "s2", ad: "x" }).success, false);
  assert.equal(SohbetYukari.safeParse({ v, type: "event", event: { ...ev, type: "chat_deleted", sohbet_id: "s2" } }).success, false);
});

test("sohbet boyut sınırları", () => {
  const mesaj = (text: string) => ({ v, type: "user_message", client_msg_id: "m", sohbet_id: s, input: "yazi", text });
  assert.equal(SohbetYukari.safeParse(mesaj("x".repeat(SINIRLAR.KULLANICI_METNI))).success, true);
  assert.equal(SohbetYukari.safeParse(mesaj("x".repeat(SINIRLAR.KULLANICI_METNI + 1))).success, false);

  const delta = (text: string) => ({ v, type: "assistant_delta", sohbet_id: s, turn_id: "t", offset: 0, text });
  assert.equal(SohbetAsagi.safeParse(delta("x".repeat(SINIRLAR.DELTA_METNI))).success, true);
  assert.equal(SohbetAsagi.safeParse(delta("x".repeat(SINIRLAR.DELTA_METNI + 1))).success, false);

  assert.equal(
    SohbetYukari.safeParse({ v, type: "interrupt", client_msg_id: "x".repeat(SINIRLAR.OPAK_ID + 1), sohbet_id: s }).success,
    false,
  );
  const kesme = (sohbet_id: string) => ({ v, type: "interrupt", client_msg_id: "m", sohbet_id });
  assert.equal(SohbetYukari.safeParse(kesme("x".repeat(SINIRLAR.OPAK_ID))).success, true);
  assert.equal(SohbetYukari.safeParse(kesme("x".repeat(SINIRLAR.OPAK_ID + 1))).success, false);
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
  const qr = { v: v1, port: 8765, kod: "ABC123", server_public_key: ANAHTAR };
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

// v3: çoklu sohbet

test("sürüm 4'tür; eşleştirme dışındaki her tür, yeniler dahil, bu sürümü bekler", () => {
  assert.equal(SOHBET_SURUMU, 4);
  assert.equal(PROTOKOL_SURUMU, 1);
  assert.deepEqual([...SOHBET_V1_TURLERI], ["pair_request", "pair_result"]);
  for (const t of ["chat_create", "chat_rename", "chat_delete", "chat_clear", "user_message", "server_status", "event"]) {
    assert.equal(sohbetSurumu(t), 4, t);
  }
  assert.equal(sohbetSurumu("pair_request"), 1);
  assert.equal(sohbetSurumu("pair_result"), 1);
});

test("kurulum sürümü sinirlar.ts satırından okuyabilir", () => {
  // kurulum/kur.ts aynı deseni kullanır: satır biçimi değişirse kurulum sürümü okuyamaz.
  const metin = readFileSync(new URL("../src/sinirlar.ts", import.meta.url), "utf8");
  const m = /^export const SOHBET_SURUMU\s*=\s*(\d+)/m.exec(metin);
  assert.ok(m);
  assert.equal(Number(m[1]), SOHBET_SURUMU);
});

test("sohbet kimliği opak kimliktir, ana da geçerlidir", () => {
  assert.equal(ANA_SOHBET_ID, "ana");
  assert.equal(ANA_SOHBET_ADI, "Claude");
  for (const id of ["ana", "s2", "Zx_9-a", "x".repeat(SINIRLAR.OPAK_ID)]) {
    assert.equal(SohbetId.safeParse(id).success, true, id);
  }
  for (const id of ["", "a b", "../x", "ş", "x".repeat(SINIRLAR.OPAK_ID + 1), 1, null]) {
    assert.equal(SohbetId.safeParse(id).success, false, String(id));
  }
});

test("sohbet adı: tek satır, 1-60 UTF-16 birimi, kırpılmış", () => {
  assert.equal(SOHBET_SINIRLARI.SOHBET_ADI, 60);
  const sinir = SOHBET_SINIRLARI.SOHBET_ADI;
  for (const ad of ["x", "ş".repeat(sinir), "a b", VARSAYILAN_SOHBET_ADI, "🎓".repeat(sinir / 2)]) {
    assert.equal(SohbetAdi.safeParse(ad).success, true, ad);
  }
  const gecersiz: [string, unknown][] = [
    ["boş", ""],
    ["çok uzun", "x".repeat(sinir + 1)],
    // Emoji iki UTF-16 birimidir.
    ["çok uzun emoji", "🎓".repeat(sinir / 2) + "x"],
    ["satır sonu", "a\nb"],
    ["satır başı", "a\rb"],
    ["sekme", "a\tb"],
    ["baştaki boşluk", " a"],
    ["sondaki boşluk", "a "],
    ["yalnız boşluk", "   "],
    ["bölünemez boşlukla biten", "a\u00a0"],
    ["sıfır genişlik", "a\u200bb"],
    ["yön işareti", "a\u202eb"],
    ["bozuk vekil", "a\ud800"],
    ["metin değil", 5],
  ];
  for (const [neden, ad] of gecersiz) assert.equal(SohbetAdi.safeParse(ad).success, false, neden);

  const yarat = (ad: string) => ({ v, type: "chat_create", client_msg_id: "m", sohbet_id: "s2", ad });
  assert.equal(SohbetYukari.safeParse(yarat("x".repeat(sinir))).success, true);
  assert.equal(SohbetYukari.safeParse(yarat("x".repeat(sinir + 1))).success, false);
  const adlandir = (ad: string) => ({ v, type: "chat_rename", client_msg_id: "m", sohbet_id: "s2", ad });
  assert.equal(SohbetYukari.safeParse(adlandir("x".repeat(sinir))).success, true);
  assert.equal(SohbetYukari.safeParse(adlandir("x".repeat(sinir + 1))).success, false);
  const olay = (ad: string) => ({ ...ev, type: "chat_renamed", sohbet_id: "s2", ad });
  assert.equal(olayMesaji.safeParse(olay("x".repeat(sinir))).success, true);
  assert.equal(olayMesaji.safeParse(olay("x".repeat(sinir + 1))).success, false);
});

test("server_status.sohbetler en çok SOHBET_ADET öğedir", () => {
  assert.equal(SOHBET_SINIRLARI.SOHBET_ADET, 8);
  const liste = (n: number) => [
    { sohbet_id: "ana", eren: "hazir" },
    ...Array.from({ length: n - 1 }, (_, i) => ({ sohbet_id: `s${i + 2}`, eren: "uyuyor" })),
  ];
  assert.equal(SohbetAsagi.safeParse({ ...durum, sohbetler: liste(1) }).success, true);
  assert.equal(SohbetAsagi.safeParse({ ...durum, sohbetler: liste(SOHBET_SINIRLARI.SOHBET_ADET) }).success, true);
  assert.equal(SohbetAsagi.safeParse({ ...durum, sohbetler: liste(SOHBET_SINIRLARI.SOHBET_ADET + 1) }).success, false);
});

test("sohbet başına ana oturum durumu kapalı listedir", () => {
  assert.deepEqual([...SOHBET_EREN_DURUMLARI], ["baslatiliyor", "hazir", "tur_suruyor", "kapali", "uyuyor", "sirada"]);
  for (const eren of SOHBET_EREN_DURUMLARI) {
    assert.equal(SohbetAsagi.safeParse({ ...durum, sohbetler: [{ sohbet_id: "ana", eren }] }).success, true, eren);
  }
});

test("olay zarfı her türde isteğe bağlı sohbet_id alır", () => {
  for (const [ad, ornek] of Object.entries(OLAYLAR)) {
    const g = ornek.gecerli[0] as Record<string, unknown>;
    assert.equal(olayMesaji.safeParse({ ...g, sohbet_id: "s9" }).success, true, ad);
    assert.equal(olayMesaji.safeParse({ ...g, sohbet_id: "" }).success, false, ad);
    const alansiz = { ...g };
    delete alansiz.sohbet_id;
    const yasam = (SOHBET_YASAM_OLAYLARI as readonly string[]).includes(ad);
    assert.equal(olayMesaji.safeParse(alansiz).success, !yasam, ad);
  }
});

// Tip düzeyi (yalnız `npm run typecheck` yakalar): `olay()` zarfının isteğe bağlı `sohbet_id`'si
// yaşam döngüsü olaylarının zorunlu `sohbet_id`'siyle kesişip tipi `undefined`'a çökertmişti.
// `[A] extends [B]` iki yönlü: dağılmadan karşılıklı atanabilirlik. `{} extends Pick<..>`: alan isteğe bağlı mı.
type AyniTip<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type OlayTuru<T extends Olay["type"]> = Extract<Olay, { type: T }>;
type SohbetIdZorunluString<O> = "sohbet_id" extends keyof O
  ? {} extends Pick<O, "sohbet_id" & keyof O>
    ? false
    : AyniTip<O["sohbet_id" & keyof O], string>
  : false;
type SohbetIdIstegeBagliString<O> = "sohbet_id" extends keyof O
  ? {} extends Pick<O, "sohbet_id" & keyof O>
    ? AyniTip<O["sohbet_id" & keyof O], string | undefined>
    : false
  : false;
type YasamSohbetIdZorunlu = {
  [T in (typeof SOHBET_YASAM_OLAYLARI)[number]]: SohbetIdZorunluString<OlayTuru<T>>;
};
type DigerSohbetIdIstegeBagli = {
  [T in Exclude<Olay["type"], (typeof SOHBET_YASAM_OLAYLARI)[number]>]: SohbetIdIstegeBagliString<OlayTuru<T>>;
};
const yasamSohbetIdZorunlu: YasamSohbetIdZorunlu = { chat_created: true, chat_renamed: true, chat_deleted: true };
const digerSohbetIdIstegeBagli: DigerSohbetIdIstegeBagli = {
  user_echo: true,
  assistant_message: true,
  turn_aborted: true,
  plan_proposed: true,
  plan_resolved: true,
  job_started: true,
  job_finished: true,
  question_asked: true,
  question_resolved: true,
  eren_handover: true,
  system_notice: true,
  chat_cleared: true,
};

test("yaşam döngüsü olaylarının çıkarılan tipinde sohbet_id zorunlu string'dir", () => {
  // Derleme zamanı sınaması yukarıdaki iki atamadır; burada yalnız çalışma anı karşılığı.
  assert.equal(Object.keys(yasamSohbetIdZorunlu).length, SOHBET_YASAM_OLAYLARI.length);
  assert.equal(Object.keys(digerSohbetIdIstegeBagli).length, OLAY_TURLERI.length - SOHBET_YASAM_OLAYLARI.length);
  const silindi = Olay.parse({ ...ev, type: "chat_deleted", sohbet_id: "s2" });
  if (silindi.type !== "chat_deleted") assert.fail(silindi.type);
  const id: string = silindi.sohbet_id;
  assert.equal(id, "s2");
});

test("sohbetAnahtari: alansız ya da küresel kayıt ana'dır", () => {
  const eski = Olay.parse({ ...ev, type: "user_echo", client_msg_id: "m1", input: "yazi", text: "x" });
  assert.equal(sohbetAnahtari(eski), "ana");
  const mezar = Olay.parse({ ...ev, type: "chat_cleared", sinir_seq: 4 });
  assert.equal(sohbetAnahtari(mezar), "ana");
  const kuresel = Olay.parse({ ...ev, type: "system_notice", seviye: "uyari", kod: "ram_dusuk", metin: "x" });
  assert.equal(sohbetAnahtari(kuresel), "ana");
  const yeni = Olay.parse({ ...ev, type: "assistant_message", sohbet_id: "s2", turn_id: "t1", text: "x" });
  assert.equal(sohbetAnahtari(yeni), "s2");
  assert.equal(sohbetAnahtari({ sohbet_id: "ana" }), "ana");
  assert.equal(sohbetAnahtari({}), "ana");
  // Mesajlar da aynı işlevle okunur.
  assert.equal(sohbetAnahtari({ v, type: "chat_clear", client_msg_id: "m", sohbet_id: "s3" }), "s3");
});

test("silinmez olay türleri: mezar taşı ve yaşam döngüsü olayları", () => {
  assert.deepEqual([...SILINMEZ_OLAY_TURLERI].sort(), ["chat_cleared", "chat_created", "chat_deleted", "chat_renamed"]);
  assert.deepEqual([...SOHBET_YASAM_OLAYLARI].sort(), ["chat_created", "chat_deleted", "chat_renamed"]);
  for (const t of SILINMEZ_OLAY_TURLERI) assert.ok((OLAY_TURLERI as readonly string[]).includes(t), t);
  for (const t of SOHBET_YASAM_OLAYLARI) assert.ok((SILINMEZ_OLAY_TURLERI as readonly string[]).includes(t), t);
});

test("plan, soru ve iş mesajları v2 biçimindedir", () => {
  assert.equal(SohbetYukari.safeParse({ v, type: "plan_decision", client_msg_id: "m", plan_id: "p", plan_hash: HASH, karar: "onay", sohbet_id: s }).success, false);
  assert.equal(SohbetYukari.safeParse({ v, type: "question_answer", client_msg_id: "m", soru_id: "q", cevap: "x", sohbet_id: s }).success, false);
});

test("v3 ile gelen hata kodları ack ve error'da geçer", () => {
  for (const code of ["sohbet_mesgul", "sohbet_bulunamadi", "sohbet_siniri", "sohbet_silinemez"]) {
    assert.equal(SohbetAsagi.safeParse({ v, type: "ack", client_msg_id: "m", ok: false, code }).success, true, code);
    assert.equal(SohbetAsagi.safeParse({ v, type: "error", code }).success, true, code);
  }
});
