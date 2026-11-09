import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  jsonSemasi,
  kanonikJson,
  Plan,
  PLAN_CWD_ACIKLAMASI,
  planHash,
  PlanOnerGirdi,
  PlanTaslagi,
  SINIRLAR,
  SOHBET_SURUMU,
  SohbetAsagi,
  TelefonIzinIstegi,
} from "../src/index.ts";
import { PLAN_PC, PLAN_TELEFON } from "./ornekler.ts";

type Vektor = { ad: string; plan: Plan; kanonik: string; plan_hash: string };
const vektorler = (
  JSON.parse(readFileSync(new URL("../vektorler/plan-hash.json", import.meta.url), "utf8")) as {
    vektorler: Vektor[];
  }
).vektorler;

function vektor(ad: string): Vektor {
  const v = vektorler.find((x) => x.ad === ad);
  assert.ok(v, ad);
  return v;
}

test("geçerli pc ve telefon planı kabul edilir", () => {
  assert.equal(Plan.safeParse(PLAN_PC).success, true);
  assert.equal(Plan.safeParse(PLAN_TELEFON).success, true);
  assert.equal(Plan.safeParse({ ...PLAN_PC, mcp_profili: "rea", kirli_kaynak: [3] }).success, true);
});

const GECERSIZ_PLANLAR: [string, unknown][] = [
  ["bilinmeyen alan", { ...PLAN_PC, fazla: 1 }],
  ["plan_hash planın alanı değildir", { ...PLAN_PC, plan_hash: "a".repeat(64) }],
  ["eksik plan_id", { ...PLAN_PC, plan_id: undefined }],
  ["bozuk plan_id", { ...PLAN_PC, plan_id: "../kaçış" }],
  ["bilinmeyen tür", { ...PLAN_PC, tur: "sunucu" }],
  ["boş başlık", { ...PLAN_PC, baslik: "" }],
  ["boş görev", { ...PLAN_PC, gorev_metni: "" }],
  ["pc planında göreli yol", { ...PLAN_PC, cwd: "proje" }],
  ["pc planında boş yol", { ...PLAN_PC, cwd: "" }],
  ["pc planında telefon izni", { ...PLAN_PC, telefon_izin_istegi: PLAN_TELEFON.telefon_izin_istegi }],
  ["telefon planında cwd", { ...PLAN_TELEFON, cwd: "C:\\Proje" }],
  ["telefon planında izin yok", { ...PLAN_TELEFON, telefon_izin_istegi: undefined }],
  ["telefon planında mcp profili", { ...PLAN_TELEFON, mcp_profili: "rea" }],
  ["bilinmeyen mcp profili", { ...PLAN_PC, mcp_profili: "adb" }],
  ["kaldırılan alan: kesin_yapilacaklar", { ...PLAN_PC, kesin_yapilacaklar: ["Testleri çalıştır"] }],
  ["kaldırılan alan: kesin_yapilmayacaklar", { ...PLAN_PC, kesin_yapilmayacaklar: [] }],
  ["satır sonlu başlık", { ...PLAN_PC, baslik: "a\nb" }],
  ["boş kirli kaynak", { ...PLAN_PC, kirli_kaynak: [] }],
  ["ondalık kirli kaynak", { ...PLAN_PC, kirli_kaynak: [1.5] }],
];

for (const [ad, deger] of GECERSIZ_PLANLAR) {
  test(`geçersiz plan: ${ad}`, () => {
    assert.equal(Plan.safeParse(deger).success, false);
  });
}

test("görünmez karakterler plan metninde reddedilir", () => {
  const birimler = [0x00, 0x1b, 0x7f, 0x9f, 0xad, 0x200b, 0x200e, 0x2028, 0x202e, 0x2066, 0x061c, 0xfeff];
  for (const birim of birimler) {
    const karakter = String.fromCharCode(birim);
    assert.equal(
      Plan.safeParse({ ...PLAN_PC, gorev_metni: `a${karakter}b` }).success,
      false,
      birim.toString(16),
    );
    assert.equal(Plan.safeParse({ ...PLAN_PC, baslik: `a${karakter}b` }).success, false);
  }
  assert.equal(Plan.safeParse({ ...PLAN_PC, gorev_metni: "a\tb\r\nc" }).success, true);
  assert.equal(Plan.safeParse({ ...PLAN_PC, baslik: "a\tb" }).success, false);
});

test("eşi olmayan vekil plan metninde reddedilir", () => {
  const yarim = String.fromCharCode(0xd83d);
  assert.equal(Plan.safeParse({ ...PLAN_PC, gorev_metni: yarim }).success, false);
});

test("telefon izin isteği kuralları", () => {
  const gecerli = [
    { uygulamalar: ["com.a.b", "com.c.d"], mod: "oku" },
    { uygulamalar: ["com.a.b"], mod: "yaz", izinli_metin: ["selam"] },
    { uygulamalar: ["com.a.b"], mod: "yaz", serbest_metin: true },
    { uygulamalar: ["com.a.b"], mod: "yaz" },
  ];
  for (const izin of gecerli) assert.equal(TelefonIzinIstegi.safeParse(izin).success, true);

  const gecersiz = [
    { uygulamalar: [], mod: "oku" },
    { uygulamalar: ["com.a.b"], mod: "sil" },
    { uygulamalar: ["gecersiz paket"], mod: "oku" },
    { uygulamalar: ["tekparca"], mod: "oku" },
    { uygulamalar: ["com.a.b", "com.a.b"], mod: "oku" },
    { uygulamalar: ["com.a.b", "com.c.d"], mod: "yaz", izinli_metin: ["x"] },
    { uygulamalar: ["com.a.b"], mod: "oku", izinli_metin: ["x"] },
    { uygulamalar: ["com.a.b"], mod: "oku", serbest_metin: true },
    { uygulamalar: ["com.a.b"], mod: "yaz", izinli_metin: ["x"], serbest_metin: true },
    { uygulamalar: ["com.a.b"], mod: "yaz", izinli_metin: [] },
    { uygulamalar: ["com.a.b"], mod: "oku", fazla: true },
  ];
  for (const izin of gecersiz) {
    assert.equal(TelefonIzinIstegi.safeParse(izin).success, false, JSON.stringify(izin));
  }
});

test("plan boyut sınırları reddedilir", () => {
  const ornekler: [string, unknown, boolean][] = [
    ["başlık sınırda", { ...PLAN_PC, baslik: "x".repeat(SINIRLAR.PLAN_BASLIK) }, true],
    ["başlık aşan", { ...PLAN_PC, baslik: "x".repeat(SINIRLAR.PLAN_BASLIK + 1) }, false],
    ["görev sınırda", { ...PLAN_PC, gorev_metni: "x".repeat(SINIRLAR.GOREV_METNI) }, true],
    ["görev aşan", { ...PLAN_PC, gorev_metni: "x".repeat(SINIRLAR.GOREV_METNI + 1) }, false],
    ["cwd aşan", { ...PLAN_PC, cwd: "C:\\" + "x".repeat(SINIRLAR.PLAN_CWD) }, false],
  ];
  for (const [ad, deger, beklenen] of ornekler) {
    assert.equal(Plan.safeParse(deger).success, beklenen, ad);
  }
});

test("plan_hash sabit vektörleri: kanonik metin ve özet", () => {
  assert.ok(vektorler.length >= 4);
  for (const v of vektorler) {
    assert.equal(kanonikJson(Plan.parse(v.plan)), v.kanonik, v.ad);
    assert.equal(planHash(v.plan), v.plan_hash, v.ad);
  }
});

test("plan_hash sabit test vektörü", () => {
  // Bu değerler node:crypto ve sıralı JSON.stringify ile, bu paketin kodu kullanılmadan üretildi.
  const beklenen: Record<string, string> = {
    "pc-turkce": "d6d4f9f222b6f56056f04c949d2cbaf55623e00922860fd96843cef9577ac914",
    "telefon-yaz": "1d5a8f1739832c213223335f51a6e0d17ed839e83b7b7a7619add627096a774a",
    "ayrisik-unicode": "43924f6e239a906a3a921bad9fe42b4317107bfed2693c657a792da8071b28b0",
    "birlesik-unicode": "80bc95e7a657c9ababc2574d3a2b1e84500e5596d3d9cd2a5354695d4e4a697b",
  };
  for (const [ad, ozet] of Object.entries(beklenen)) {
    assert.equal(vektor(ad).plan_hash, ozet, ad);
    assert.equal(planHash(vektor(ad).plan), ozet, ad);
  }
});

test("plan_hash alan sırasından bağımsızdır", () => {
  const ters = Object.fromEntries(Object.entries(PLAN_PC).reverse()) as Plan;
  assert.notEqual(JSON.stringify(ters), JSON.stringify(PLAN_PC));
  assert.equal(planHash(ters), planHash(PLAN_PC));

  const izin = PLAN_TELEFON.telefon_izin_istegi!;
  const icTers = {
    ...PLAN_TELEFON,
    telefon_izin_istegi: { mod: izin.mod, uygulamalar: izin.uygulamalar },
  };
  assert.equal(planHash(icTers), planHash(PLAN_TELEFON));
});

test("plan_hash Türkçe metinde normalleştirme yapmaz", () => {
  const ayrisik = vektor("ayrisik-unicode");
  const birlesik = vektor("birlesik-unicode");
  assert.notEqual(ayrisik.plan.baslik, birlesik.plan.baslik);
  assert.equal(ayrisik.plan.baslik.normalize("NFC"), birlesik.plan.baslik);
  assert.notEqual(ayrisik.plan_hash, birlesik.plan_hash);
  assert.ok(vektor("pc-turkce").kanonik.includes("şçğüöıİ"));
});

test("plan_hash her alanın değişimini yakalar", () => {
  const taban = planHash(PLAN_PC);
  const degisimler: Plan[] = [
    { ...PLAN_PC, plan_id: "plan-9" },
    { ...PLAN_PC, baslik: "Başka" },
    { ...PLAN_PC, cwd: "C:\\Baska" },
    { ...PLAN_PC, gorev_metni: "Başka görev" },
    { ...PLAN_PC, mcp_profili: "rea" },
    { ...PLAN_PC, kirli_kaynak: [1] },
    { ...PLAN_PC, kirli_kaynak: [2, 1] },
  ];
  const gorulen = new Set([taban]);
  for (const plan of degisimler) {
    const ozet = planHash(plan);
    assert.equal(gorulen.has(ozet), false, plan.plan_id);
    gorulen.add(ozet);
  }
  assert.notEqual(
    planHash({ ...PLAN_PC, kirli_kaynak: [1, 2] }),
    planHash({ ...PLAN_PC, kirli_kaynak: [2, 1] }),
  );
});

test("planHash geçersiz planı atar", () => {
  assert.throws(() => planHash({ ...PLAN_PC, fazla: 1 } as Plan));
  assert.throws(() => planHash({ ...PLAN_PC, cwd: "" }));
});

test("plan taslağı servis alanlarını kabul etmez", () => {
  const { plan_id: _id, ...taslak } = PLAN_PC;
  assert.equal(PlanTaslagi.safeParse(taslak).success, true);
  assert.equal(PlanTaslagi.safeParse({ ...taslak, dayandigi_isler: [4] }).success, true);
  assert.equal(PlanTaslagi.safeParse(PLAN_PC).success, false, "plan_id servisindir");
  assert.equal(PlanTaslagi.safeParse({ ...taslak, kirli_kaynak: [1] }).success, false);
  assert.equal(PlanTaslagi.safeParse({ ...taslak, cwd: "" }).success, false);
});

test("kaldırılan plan maddeleri (kesin yapılacaklar/yapılmayacaklar) her plan şemasında reddedilir", () => {
  const { plan_id: _id, ...taslak } = PLAN_PC;
  const { plan_id: _id2, ...telefonTaslak } = PLAN_TELEFON;
  const eskiAlanlar = [
    { kesin_yapilacaklar: ["Testleri çalıştır"] },
    { kesin_yapilmayacaklar: [] },
    { kesin_yapilacaklar: ["a"], kesin_yapilmayacaklar: ["b"] },
  ];
  for (const eski of eskiAlanlar) {
    const ad = JSON.stringify(eski);
    assert.equal(Plan.safeParse({ ...PLAN_PC, ...eski }).success, false, `Plan ${ad}`);
    assert.equal(Plan.safeParse({ ...PLAN_TELEFON, ...eski }).success, false, `Plan telefon ${ad}`);
    assert.equal(PlanTaslagi.safeParse({ ...taslak, ...eski }).success, false, `PlanTaslagi ${ad}`);
    assert.equal(PlanOnerGirdi.safeParse({ ...taslak, ...eski }).success, false, `PlanOnerGirdi ${ad}`);
    assert.equal(PlanOnerGirdi.safeParse({ ...telefonTaslak, ...eski }).success, false, `telefon girdisi ${ad}`);
    assert.throws(() => planHash({ ...PLAN_PC, ...eski } as Plan), ad);
    const olay = { seq: 1, ts_ms: 1, type: "plan_proposed", plan: { ...PLAN_PC, ...eski }, plan_hash: "a".repeat(64) };
    assert.equal(SohbetAsagi.safeParse({ v: SOHBET_SURUMU, type: "event", event: olay }).success, false, `plan_proposed ${ad}`);
  }
  // Alanlar olmadan plan tam ve geçerlidir; şemada ve kanonik metinde iz kalmaz.
  assert.equal(PlanOnerGirdi.safeParse(taslak).success, true);
  assert.equal(PlanOnerGirdi.safeParse(telefonTaslak).success, true);
  for (const sema of [Plan, PlanTaslagi, PlanOnerGirdi]) {
    assert.doesNotMatch(JSON.stringify(jsonSemasi(sema)), /kesin_yapil/);
  }
  assert.doesNotMatch(kanonikJson(Plan.parse(PLAN_PC)), /kesin_yapil/);
  for (const v of vektorler) assert.doesNotMatch(JSON.stringify(v), /kesin_yapil/, v.ad);
});

test("plan_oner cwd açıklaması telefon planında boş bırakılacağını söyler; kural aynen kalır", () => {
  const sema = jsonSemasi(PlanOnerGirdi) as { properties: { cwd: { description?: string } } };
  assert.equal(sema.properties.cwd.description, PLAN_CWD_ACIKLAMASI);
  assert.match(PLAN_CWD_ACIKLAMASI, /Telefon planında boş bırakılır/);
  const { plan_id: _id, ...telefonTaslak } = PLAN_TELEFON;
  assert.equal(PlanOnerGirdi.safeParse({ ...telefonTaslak, cwd: "C:\Proje" }).success, false);
  assert.equal(PlanOnerGirdi.safeParse({ ...telefonTaslak, cwd: "" }).success, true);
  // Açıklama plana ve özete girmez: Plan şemasının cwd'si açıklamasızdır.
  const planSemasi = jsonSemasi(Plan) as { properties: { cwd: { description?: string } } };
  assert.equal(planSemasi.properties.cwd.description, undefined);
});
