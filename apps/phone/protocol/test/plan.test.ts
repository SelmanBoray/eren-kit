import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { kanonikJson, Plan, planHash, PlanTaslagi, SINIRLAR, TelefonIzinIstegi } from "../src/index.ts";
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
  ["yapılacaklar boş", { ...PLAN_PC, kesin_yapilacaklar: [] }],
  ["satır sonlu madde", { ...PLAN_PC, kesin_yapilacaklar: ["a\n- sahte madde"] }],
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
  const madde = "x".repeat(SINIRLAR.PLAN_MADDE);
  const ornekler: [string, unknown, boolean][] = [
    ["başlık sınırda", { ...PLAN_PC, baslik: "x".repeat(SINIRLAR.PLAN_BASLIK) }, true],
    ["başlık aşan", { ...PLAN_PC, baslik: "x".repeat(SINIRLAR.PLAN_BASLIK + 1) }, false],
    ["görev sınırda", { ...PLAN_PC, gorev_metni: "x".repeat(SINIRLAR.GOREV_METNI) }, true],
    ["görev aşan", { ...PLAN_PC, gorev_metni: "x".repeat(SINIRLAR.GOREV_METNI + 1) }, false],
    ["madde aşan", { ...PLAN_PC, kesin_yapilacaklar: [madde + "x"] }, false],
    [
      "madde adedi sınırda",
      { ...PLAN_PC, kesin_yapilmayacaklar: Array(SINIRLAR.PLAN_MADDE_ADET).fill(madde) },
      true,
    ],
    [
      "madde adedi aşan",
      { ...PLAN_PC, kesin_yapilmayacaklar: Array(SINIRLAR.PLAN_MADDE_ADET + 1).fill(madde) },
      false,
    ],
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
    "pc-turkce": "3f975f2aa322634dcb0345def656168012826fb324f4ae753cbfbfb0d7000e2c",
    "telefon-yaz": "129b9b4b302dbdc90902ac800cc22b92f4cb0cbdcaaf9102b980b51a824c0bb3",
    "ayrisik-unicode": "ba65b23662434b578595874f849000c7b04b0a77ac5695a0953aee47008ab773",
    "birlesik-unicode": "fc00f26967de446b64e5f2323d017552f34251da53668ebc33a93d9b975f7d22",
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
    { ...PLAN_PC, kesin_yapilacaklar: ["Başka"] },
    { ...PLAN_PC, kesin_yapilmayacaklar: [] },
    { ...PLAN_PC, mcp_profili: "rea" },
    { ...PLAN_PC, kirli_kaynak: [1] },
    { ...PLAN_PC, kesin_yapilacaklar: ["b", "a"] },
  ];
  const gorulen = new Set([taban]);
  for (const plan of degisimler) {
    const ozet = planHash(plan);
    assert.equal(gorulen.has(ozet), false, plan.plan_id);
    gorulen.add(ozet);
  }
  assert.notEqual(
    planHash({ ...PLAN_PC, kesin_yapilacaklar: ["a", "b"] }),
    planHash({ ...PLAN_PC, kesin_yapilacaklar: ["b", "a"] }),
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
