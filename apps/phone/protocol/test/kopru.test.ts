import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  fiilRoldeIzinliMi,
  KOPRU_FIIL_SEMALARI,
  KOPRU_FIILLERI,
  KOPRU_ROLLERI,
  KopruAsagi,
  KopruIstek,
  KopruYukari,
  PROTOKOL_SURUMU,
  ROL_FIILLERI,
  SOHBET_SURUMU,
  SohbetYukari,
} from "../src/index.ts";
import { JETON, PLAN_PC, RAPOR } from "./ornekler.ts";

const v = PROTOKOL_SURUMU;

/** Kod tabanında bir fiil adı değiştiğinde bu tablo bilerek kırılır. */
const BEKLENEN_EREN = ["plan_oner", "oturumlar", "rapor_oku", "projeler", "uygulamalar", "oturum_durdur", "devir_ozeti"];
const BEKLENEN_SORU = ["kullaniciya_sor", "soru_bekle"];
const BEKLENEN_TELEFON = [
  "foreground", "elements", "screenshot", "zoom", "click", "type_text", "key", "scroll", "drag",
  "wait", "open_app", "rapor_ver",
];

const { plan_id: _planId, ...taslak } = PLAN_PC;

const GECERLI_GIRDILER: Record<string, object> = {
  plan_oner: taslak,
  oturumlar: {},
  rapor_oku: { id: 7 },
  projeler: {},
  uygulamalar: {},
  oturum_durdur: { id: 7 },
  devir_ozeti: { ozet: "Devir özeti" },
  kullaniciya_sor: { soru_id: "s1", soru: "Devam edeyim mi?" },
  soru_bekle: { soru_id: "s1" },
  foreground: {},
  elements: {},
  screenshot: {},
  zoom: { x0: 0, y0: 0, x1: 1, y1: 1 },
  click: { element: 1 },
  type_text: { text: "x" },
  key: { keys: "back" },
  scroll: { direction: "down" },
  drag: { x0: 0, y0: 0, x1: 1, y1: 1 },
  wait: { seconds: 1 },
  open_app: { package: "com.a.b" },
  rapor_ver: RAPOR,
};

test("rol-fiil eşlemesi tam olarak beklenendir", () => {
  assert.deepEqual([...ROL_FIILLERI.eren], BEKLENEN_EREN);
  assert.deepEqual([...ROL_FIILLERI.soru], BEKLENEN_SORU);
  assert.deepEqual([...ROL_FIILLERI.telefon], BEKLENEN_TELEFON);
  assert.deepEqual([...KOPRU_ROLLERI], ["eren", "soru", "telefon"]);
});

test("her fiil tek roldedir ve başka rolde izinli değildir", () => {
  assert.equal(new Set(KOPRU_FIILLERI).size, KOPRU_FIILLERI.length);
  for (const rol of KOPRU_ROLLERI) {
    for (const fiil of KOPRU_FIILLERI) {
      const beklenen = (ROL_FIILLERI[rol] as readonly string[]).includes(fiil);
      assert.equal(fiilRoldeIzinliMi(rol, fiil), beklenen, `${rol} ${fiil}`);
    }
  }
  assert.equal(fiilRoldeIzinliMi("telefon", "plan_oner"), false);
  assert.equal(fiilRoldeIzinliMi("soru", "type_text"), false);
  assert.equal(fiilRoldeIzinliMi("eren", "kullaniciya_sor"), false);
  assert.equal(fiilRoldeIzinliMi("eren", "click"), false);
  assert.equal(fiilRoldeIzinliMi("eren", "user_message"), false);
});

test("şema tablosu ve istek birleşimi fiil listesiyle bire birdir", () => {
  assert.deepEqual(Object.keys(KOPRU_FIIL_SEMALARI).sort(), [...KOPRU_FIILLERI].sort());
  assert.deepEqual(Object.keys(GECERLI_GIRDILER).sort(), [...KOPRU_FIILLERI].sort());
  for (const fiil of KOPRU_FIILLERI) {
    const sonuc = KopruIstek.safeParse({ v, type: "istek", istek_id: "i1", fiil, girdi: GECERLI_GIRDILER[fiil] });
    assert.equal(sonuc.success, true, fiil);
    assert.equal(
      KopruIstek.safeParse({ v, type: "istek", istek_id: "i1", fiil, girdi: GECERLI_GIRDILER[fiil], fazla: 1 }).success,
      false,
      fiil,
    );
  }
});

// Tek istisna soru aracının tam adı: o kullanıcıdan mesaj getirmez, kullanıcıya soru götürür.
const KULLANICI_MESAJI = /mesaj|message|kullanici(?!ya_sor$)|user|human|insan|origin|prompt|sohbet|chat/i;

test("kullanıcı mesajı gönderen fiil tanımlı değildir", () => {
  for (const ad of ["kullanici_yaz", "kullaniciya_yaz", "kullaniciya_sor_ve_yaz"]) {
    assert.equal(KULLANICI_MESAJI.test(ad), true, ad);
  }
  for (const fiil of KOPRU_FIILLERI) {
    assert.equal(KULLANICI_MESAJI.test(fiil), false, fiil);
  }
  const adaylar = [
    "user_message", "kullanici_mesaji", "mesaj_gonder", "send_message", "sohbet_yaz", "human_message",
    "prompt", "eren_mesaji", "enjekte",
  ];
  for (const fiil of adaylar) {
    assert.equal((KOPRU_FIILLERI as readonly string[]).includes(fiil), false, fiil);
    for (const rol of KOPRU_ROLLERI) assert.equal(fiilRoldeIzinliMi(rol, fiil), false);
    assert.equal(
      KopruYukari.safeParse({ v, type: "istek", istek_id: "i1", fiil, girdi: { text: "evet" } }).success,
      false,
      fiil,
    );
  }
});

test("hiçbir fiil girdisi kullanıcı mesajı alanı taşımaz", () => {
  function alanlar(deger: unknown, yol: string[], cikti: string[]): void {
    if (Array.isArray(deger)) {
      for (const oge of deger) alanlar(oge, yol, cikti);
    } else if (typeof deger === "object" && deger !== null) {
      for (const [anahtar, alt] of Object.entries(deger)) {
        if (anahtar === "properties") {
          for (const [ad, sema] of Object.entries(alt as object)) {
            cikti.push(ad);
            alanlar(sema, [...yol, ad], cikti);
          }
        } else {
          alanlar(alt, yol, cikti);
        }
      }
    }
  }
  for (const fiil of KOPRU_FIILLERI) {
    const cikti: string[] = [];
    alanlar(z.toJSONSchema(KOPRU_FIIL_SEMALARI[fiil].girdi), [], cikti);
    for (const alan of cikti) {
      assert.equal(KULLANICI_MESAJI.test(alan), false, `${fiil}.${alan}`);
    }
  }
});

test("/sohbet'in insan mesajı boruya girmez, boru mesajı /sohbet'e girmez", () => {
  // `/sohbet` `SOHBET_SURUMU`, boru v1: tür, sürümden bağımsız olarak da reddedilir.
  const mesaj = { v: SOHBET_SURUMU, type: "user_message", client_msg_id: "m", sohbet_id: "ana", input: "yazi", text: "evet" };
  assert.equal(SohbetYukari.safeParse(mesaj).success, true);
  assert.equal(KopruYukari.safeParse(mesaj).success, false);
  assert.equal(KopruYukari.safeParse({ ...mesaj, v }).success, false);
  const istek = { v, type: "istek", istek_id: "i1", fiil: "oturumlar", girdi: {} };
  assert.equal(KopruYukari.safeParse(istek).success, true);
  assert.equal(SohbetYukari.safeParse(istek).success, false);
  assert.equal(SohbetYukari.safeParse({ ...istek, v: SOHBET_SURUMU }).success, false);
});

test("istek zarfı origin ya da sentetik işareti taşıyamaz", () => {
  const taban = { v, type: "istek", istek_id: "i1", fiil: "oturumlar", girdi: {} };
  assert.equal(KopruYukari.safeParse({ ...taban, origin: { kind: "human" } }).success, false);
  assert.equal(KopruYukari.safeParse({ ...taban, isSynthetic: false }).success, false);
});

test("kopru_hello rol ve jeton ister", () => {
  assert.equal(KopruYukari.safeParse({ v, type: "kopru_hello", rol: "soru", jeton: JETON }).success, true);
  assert.equal(KopruYukari.safeParse({ v, type: "kopru_hello", rol: "soru" }).success, false);
  assert.equal(KopruYukari.safeParse({ v, type: "kopru_hello", rol: "soru", jeton: "kisa" }).success, false);
  assert.equal(KopruYukari.safeParse({ v, type: "kopru_hello", rol: "yonetici", jeton: JETON }).success, false);
  assert.equal(KopruYukari.safeParse({ v, type: "kopru_hello", rol: "soru", jeton: JETON, is_id: 1 }).success, false);
});

test("istek geçersiz girdiyi reddeder", () => {
  const kotu: [string, object][] = [
    ["plan_oner", {}],
    ["plan_oner", PLAN_PC],
    ["rapor_oku", { id: "../gizli" }],
    ["rapor_oku", { id: 0 }],
    ["kullaniciya_sor", { soru: "soru_id yok" }],
    ["kullaniciya_sor", { soru_id: "s1", soru: "x", secenekler: ["tek"] }],
    ["click", { x: 1 }],
    ["rapor_ver", { yapildi: [] }],
    ["devir_ozeti", { ozet: "" }],
  ];
  for (const [fiil, girdi] of kotu) {
    assert.equal(KopruIstek.safeParse({ v, type: "istek", istek_id: "i1", fiil, girdi }).success, false, `${fiil} ${JSON.stringify(girdi)}`);
  }
  assert.equal(KopruIstek.safeParse({ v, type: "istek", istek_id: "bozuk id", fiil: "oturumlar", girdi: {} }).success, false);
});

test("iptal ve servis yanıtları", () => {
  assert.equal(KopruYukari.safeParse({ v, type: "iptal", istek_id: "i1" }).success, true);
  const gecerli = [
    { v, type: "kopru_welcome", rol: "eren" },
    { v, type: "kopru_ret", code: "jeton_gecersiz" },
    { v, type: "yanit", istek_id: "i1", ok: true, sonuc: { kabul: true } },
    { v, type: "yanit", istek_id: "i1", ok: false, code: "telefon_bagli_degil" },
    { v, type: "yanit", istek_id: "i1", ok: false, code: "belirsiz", detail: "bağlantı koptu" },
  ];
  for (const m of gecerli) assert.equal(KopruAsagi.safeParse(m).success, true, JSON.stringify(m));
  const gecersiz = [
    { v, type: "kopru_ret", code: "uyduruk" },
    { v, type: "yanit", istek_id: "i1", ok: true },
    { v, type: "yanit", istek_id: "i1", ok: false },
    { v, type: "yanit", istek_id: "i1", ok: true, sonuc: 1, code: "ic_hata" },
    { v, type: "yanit", istek_id: "i1", ok: false, sonuc: 1, code: "ic_hata" },
    { v, type: "yanit", istek_id: "i1", ok: true, sonuc: 1, fazla: 1 },
  ];
  for (const m of gecersiz) assert.equal(KopruAsagi.safeParse(m).success, false, JSON.stringify(m));
});
