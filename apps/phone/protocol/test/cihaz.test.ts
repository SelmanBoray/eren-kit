import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CIHAZ_HATALARI,
  CihazAsagi,
  CihazYukari,
  CMD_ADLARI,
  CMD_ARG_SEMALARI,
  cmdSonucuMetni,
  CmdSonucu,
  DENIED_NEDENLERI,
  DeniedNeden,
  KEY_ADLARI,
  PROTOKOL_SURUMU,
  SINIRLAR,
} from "../src/index.ts";
import { HASH, IMZA, JETON, NONCE } from "./ornekler.ts";

const v = PROTOKOL_SURUMU;
const zarf = { v, type: "cmd", cmd_id: "c1", grant_id: "g1", token: JETON, deadline_ms: 1000 };
const onPlan = { baslik: "Mesajlar", paket: "com.example.mesaj" };

const KOMUTLAR: Record<(typeof CMD_ADLARI)[number], { gecerli: object[]; gecersiz: object[] }> = {
  foreground: { gecerli: [{}], gecersiz: [{ a: 1 }] },
  elements: {
    gecerli: [{}, { query: "gönder" }],
    gecersiz: [{ query: "x".repeat(SINIRLAR.ELEMENT_SORGU + 1) }, { query: 1 }],
  },
  screenshot: { gecerli: [{}], gecersiz: [{ monitor: 1 }] },
  zoom: {
    gecerli: [{ x0: 0, y0: 0, x1: 10, y1: 10 }],
    gecersiz: [{ x0: 10, y0: 0, x1: 10, y1: 10 }, { x0: 0, y0: 0, x1: 10 }, { x0: -1, y0: 0, x1: 10, y1: 10 }],
  },
  click: {
    gecerli: [{ element: 3 }, { x: 1, y: 2 }, { element: 0, clicks: 2 }, { x: 1, y: 2, long_press: true }],
    gecersiz: [{}, { x: 1 }, { y: 1 }, { element: 1, x: 1, y: 1 }, { element: 1.5 }, { element: 1, clicks: 3 }],
  },
  type_text: {
    gecerli: [{ text: "Geliyorum" }],
    gecersiz: [{}, { text: "" }, { text: "x".repeat(SINIRLAR.YAZILAN_METIN + 1) }],
  },
  key: {
    gecerli: [{ keys: "back" }, { keys: "enter", repeat: 2 }],
    gecersiz: [{ keys: "ctrl+a" }, { keys: "back", repeat: 0 }, { keys: "back", repeat: SINIRLAR.TEKRAR_MAX + 1 }],
  },
  scroll: {
    gecerli: [{ direction: "down" }, { direction: "up", amount: 3, x: 1, y: 2 }],
    gecersiz: [{ direction: "yan" }, { direction: "up", x: 1 }, { direction: "up", amount: 0 }],
  },
  drag: {
    gecerli: [{ x0: 0, y0: 0, x1: 5, y1: 5 }],
    gecersiz: [{ x0: 0, y0: 0, x1: 5 }, { x0: 0, y0: 0, x1: 5, y1: SINIRLAR.KOORDINAT_MAX + 1 }],
  },
  wait: {
    gecerli: [{ seconds: 0.5 }, { seconds: SINIRLAR.BEKLEME_SANIYE_MAX }],
    gecersiz: [{ seconds: 0 }, { seconds: SINIRLAR.BEKLEME_SANIYE_MAX + 1 }, {}],
  },
  open_app: {
    gecerli: [{ package: "com.example.mesaj" }],
    gecersiz: [
      { package: "https://ornek.net" },
      { package: "intent://x" },
      { package: "com" },
      { package: "com.example.mesaj/.Ana" },
      { url: "https://ornek.net" },
    ],
  },
};

for (const ad of CMD_ADLARI) {
  test(`cmd ${ad}: geçerli ve geçersiz argümanlar`, () => {
    for (const args of KOMUTLAR[ad].gecerli) {
      const sonuc = CihazAsagi.safeParse({ ...zarf, name: ad, args });
      assert.equal(sonuc.success, true, JSON.stringify(args));
    }
    for (const args of KOMUTLAR[ad].gecersiz) {
      assert.equal(CihazAsagi.safeParse({ ...zarf, name: ad, args }).success, false, JSON.stringify(args));
    }
  });
}

test("komut listesi kapalıdır ve argüman şemasıyla bire birdir", () => {
  assert.deepEqual(Object.keys(CMD_ARG_SEMALARI).sort(), [...CMD_ADLARI].sort());
  assert.equal(CihazAsagi.safeParse({ ...zarf, name: "shell", args: {} }).success, false);
  assert.equal(CihazAsagi.safeParse({ ...zarf, name: "adb", args: {} }).success, false);
  assert.equal(CihazAsagi.safeParse({ ...zarf, name: "open_url", args: { url: "x" } }).success, false);
});

test("cmd zarfı alanları zorunludur", () => {
  const tam = { ...zarf, name: "foreground", args: {} };
  assert.equal(CihazAsagi.safeParse(tam).success, true);
  for (const alan of ["cmd_id", "grant_id", "token", "deadline_ms", "name", "args", "v"]) {
    const eksik: Record<string, unknown> = { ...tam };
    delete eksik[alan];
    assert.equal(CihazAsagi.safeParse(eksik).success, false, alan);
  }
  assert.equal(CihazAsagi.safeParse({ ...tam, token: "kisa" }).success, false);
  assert.equal(CihazAsagi.safeParse({ ...tam, fazla: 1 }).success, false);
});

const YUKARI: [string, object, object[]][] = [
  ["hello", { v, type: "hello", device_id: "tel-1", client_nonce: NONCE }, [{ v, type: "hello", device_id: "tel-1" }]],
  ["auth_response", { v, type: "auth_response", signature: IMZA }, [{ v, type: "auth_response" }]],
  [
    "cmd_result ok",
    { v, type: "cmd_result", cmd_id: "c1", ok: true, foreground: onPlan },
    [
      { v, type: "cmd_result", cmd_id: "c1", ok: true },
      { v, type: "cmd_result", cmd_id: "c1", ok: true, foreground: onPlan, denied: "izin_yok" },
      { v, type: "cmd_result", cmd_id: "c1", ok: true, foreground: { baslik: "x", paket: "bozuk paket" } },
    ],
  ],
  [
    "cmd_result denied",
    { v, type: "cmd_result", cmd_id: "c1", ok: false, foreground: null, denied: "on_plan_izin_disi" },
    [
      { v, type: "cmd_result", cmd_id: "c1", ok: false, foreground: null },
      { v, type: "cmd_result", cmd_id: "c1", ok: false, foreground: null, denied: "uyduruk" },
      { v, type: "cmd_result", cmd_id: "c1", ok: false, foreground: null, denied: "izin_yok", hata: "zaman_asimi" },
      { v, type: "cmd_result", cmd_id: "c1", ok: false, foreground: null, denied: "izin_yok", payload: { kind: "elements", truncated: false, elements: [] } },
    ],
  ],
  [
    "cmd_result hata",
    { v, type: "cmd_result", cmd_id: "c1", ok: false, foreground: onPlan, hata: "element_bulunamadi" },
    [{ v, type: "cmd_result", cmd_id: "c1", ok: false, foreground: onPlan, hata: "uyduruk" }],
  ],
  [
    "cmd_result elements",
    {
      v, type: "cmd_result", cmd_id: "c1", ok: true, foreground: onPlan,
      payload: { kind: "elements", truncated: false, elements: [{ id: 1, rol: "button", ad: "Gönder", x: 10, y: 20 }] },
    },
    [
      { v, type: "cmd_result", cmd_id: "c1", ok: true, foreground: onPlan, payload: { kind: "elements", truncated: false, elements: [{ id: 1, rol: "çok kötü rol", ad: "x", x: 1, y: 1 }] } },
      { v, type: "cmd_result", cmd_id: "c1", ok: true, foreground: onPlan, payload: { kind: "elements", elements: [] } },
    ],
  ],
  [
    "cmd_result image",
    {
      v, type: "cmd_result", cmd_id: "c1", ok: true, foreground: onPlan,
      payload: { kind: "image", mime: "image/jpeg", image_base64: "QUJD", width: 720, height: 1600, scale: 1.5 },
    },
    [
      { v, type: "cmd_result", cmd_id: "c1", ok: true, foreground: onPlan, payload: { kind: "image", mime: "image/gif", image_base64: "QUJD", width: 1, height: 1, scale: 1 } },
      { v, type: "cmd_result", cmd_id: "c1", ok: true, foreground: onPlan, payload: { kind: "image", mime: "image/png", image_base64: "boşluklu metin", width: 1, height: 1, scale: 1 } },
    ],
  ],
  [
    "grant_issued",
    { v, type: "grant_issued", grant_id: "g1", token: JETON, plan_id: "p1", plan_hash: HASH, mod: "oku", uygulamalar: ["com.a.b"], kalan_ms: 60000, butce: 100 },
    [
      { v, type: "grant_issued", grant_id: "g1", plan_id: "p1", plan_hash: HASH, mod: "oku", uygulamalar: ["com.a.b"], kalan_ms: 60000, butce: 100 },
      { v, type: "grant_issued", grant_id: "g1", token: JETON, plan_id: "p1", plan_hash: "x", mod: "oku", uygulamalar: ["com.a.b"], kalan_ms: 60000, butce: 100 },
      { v, type: "grant_issued", grant_id: "g1", token: JETON, plan_id: "p1", plan_hash: HASH, mod: "oku", uygulamalar: [], kalan_ms: 60000, butce: 100 },
    ],
  ],
  [
    "grant_revoked",
    { v, type: "grant_revoked", grant_id: "g1", neden: "kullanici_durdurdu" },
    [{ v, type: "grant_revoked", grant_id: "g1", neden: "uyduruk" }],
  ],
  [
    "device_state",
    { v, type: "device_state", a11y: true, adb_enabled: false, kilitli: false },
    [{ v, type: "device_state", a11y: "evet", adb_enabled: false, kilitli: false }, { v, type: "device_state", a11y: true }],
  ],
  [
    "app_list",
    { v, type: "app_list", uygulamalar: [{ paket: "com.a.b", ad: "A", durum: "acik" }] },
    [{ v, type: "app_list", uygulamalar: [{ paket: "com.a.b", ad: "A", durum: "uyduruk" }] }],
  ],
  ["notify_ack", { v, type: "notify_ack", notify_id: "n1" }, [{ v, type: "notify_ack" }]],
];

for (const [ad, gecerli, gecersizler] of YUKARI) {
  test(`/cihaz yukarı ${ad}`, () => {
    const sonuc = CihazYukari.safeParse(gecerli);
    assert.equal(sonuc.success, true, JSON.stringify(sonuc));
    assert.equal(CihazYukari.safeParse({ ...gecerli, fazla: 1 }).success, false, "bilinmeyen alan");
    assert.ok(gecersizler.length > 0);
    for (const g of gecersizler) {
      assert.equal(CihazYukari.safeParse(g).success, false, JSON.stringify(g));
    }
  });
}

const ASAGI: [string, object, object[]][] = [
  ["auth_challenge", { v, type: "auth_challenge", server_nonce: NONCE, server_signature: IMZA }, [{ v, type: "auth_challenge", server_nonce: NONCE }]],
  ["welcome", { v, type: "welcome", server_time_ms: 1 }, [{ v, type: "welcome" }, { v, type: "welcome", server_time_ms: 1, head_seq: 1 }]],
  [
    "notify",
    { v, type: "notify", notify_id: "n1", tur: "soru", baslik: "Soru var", metin: "İş 7 soruyor" },
    [
      { v, type: "notify", notify_id: "n1", tur: "x", baslik: "b", metin: "m" },
      { v, type: "notify", notify_id: "n1", tur: "soru", baslik: "b", metin: "m".repeat(SINIRLAR.BILDIRIM_METIN + 1) },
    ],
  ],
  [
    "grant_revoke",
    { v, type: "grant_revoke", grant_id: "g1", neden: "is_bitti" },
    [{ v, type: "grant_revoke", neden: "is_bitti" }, { v, type: "grant_revoke", grant_id: "g1", neden: "uyduruk" }],
  ],
  ["error", { v, type: "error", code: "imza_gecersiz" }, [{ v, type: "error", code: "uyduruk" }]],
];

for (const [ad, gecerli, gecersizler] of ASAGI) {
  test(`/cihaz aşağı ${ad}`, () => {
    const sonuc = CihazAsagi.safeParse(gecerli);
    assert.equal(sonuc.success, true, JSON.stringify(sonuc));
    assert.equal(CihazAsagi.safeParse({ ...gecerli, fazla: 1 }).success, false, "bilinmeyen alan");
    for (const g of gecersizler) {
      assert.equal(CihazAsagi.safeParse(g).success, false, JSON.stringify(g));
    }
  });
}

test("grant_revoke null ile bütün izinleri hedefler", () => {
  assert.equal(CihazAsagi.safeParse({ v, type: "grant_revoke", grant_id: null, neden: "limit_kilit" }).success, true);
});

test("kapalı listeler dışındaki denied nedeni reddedilir", () => {
  for (const neden of DENIED_NEDENLERI) assert.equal(DeniedNeden.safeParse(neden).success, true);
  assert.equal(DeniedNeden.safeParse("baska").success, false);
  assert.equal(new Set(DENIED_NEDENLERI).size, DENIED_NEDENLERI.length);
});

test("kararlardaki ret durumlarının her birinin kodu vardır", () => {
  const beklenen = [
    "izin_yok", "izin_suresi_bitti", "jeton_yanlis", "butce_doldu", "on_plan_izin_disi",
    "hassas_uygulama", "yeni_uygulama", "degismez_ret", "parola_alani", "yalniz_oku_yazma",
    "yalniz_oku_ham_dokunma", "yalniz_oku_etiket", "url_intent_yasak", "izin_disi_pencere",
    "metin_kilidi",
  ];
  for (const ad of beklenen) assert.ok((DENIED_NEDENLERI as readonly string[]).includes(ad), ad);
});

test("/cihaz boyut sınırları", () => {
  const eleman = { id: 1, rol: "text", ad: "a", x: 1, y: 1 };
  const sonuc = (elements: object[]) => ({
    v, type: "cmd_result", cmd_id: "c", ok: true, foreground: onPlan,
    payload: { kind: "elements", truncated: true, elements },
  });
  assert.equal(CihazYukari.safeParse(sonuc(Array(SINIRLAR.ELEMENT_ADET).fill(eleman))).success, true);
  assert.equal(CihazYukari.safeParse(sonuc(Array(SINIRLAR.ELEMENT_ADET + 1).fill(eleman))).success, false);
  assert.equal(CihazYukari.safeParse(sonuc([{ ...eleman, ad: "x".repeat(SINIRLAR.ELEMENT_METIN + 1) }])).success, false);
  assert.equal(CihazYukari.safeParse(sonuc([{ ...eleman, deger: "x".repeat(SINIRLAR.ELEMENT_METIN + 1) }])).success, false);

  const liste = (n: number) => ({ v, type: "app_list", uygulamalar: Array(n).fill({ paket: "com.a.b", ad: "A", durum: "acik" }) });
  assert.equal(CihazYukari.safeParse(liste(SINIRLAR.UYGULAMA_LISTESI_ADET)).success, true);
  assert.equal(CihazYukari.safeParse(liste(SINIRLAR.UYGULAMA_LISTESI_ADET + 1)).success, false);

  const resim = (uzunluk: number) => ({
    v, type: "cmd_result", cmd_id: "c", ok: true, foreground: onPlan,
    payload: { kind: "image", mime: "image/png", image_base64: "A".repeat(uzunluk), width: 1, height: 1, scale: 1 },
  });
  assert.equal(CihazYukari.safeParse(resim(4)).success, true);
  assert.equal(CihazYukari.safeParse(resim(SINIRLAR.EKRAN_BASE64 + 1)).success, false);
});

test("CmdSonucu zarfsız sonucu doğrular", () => {
  assert.equal(CmdSonucu.safeParse({ ok: true, foreground: null }).success, true);
  assert.equal(CmdSonucu.safeParse({ ok: false, foreground: null }).success, false);
  assert.equal(CmdSonucu.safeParse({ ok: true, foreground: null, v }).success, false);
});

const belge = readFileSync(new URL("../CIHAZ.md", import.meta.url), "utf8");

test("CIHAZ.md bütün kapalı listeleri içerir", () => {
  const adlar = [...CMD_ADLARI, ...DENIED_NEDENLERI, ...CIHAZ_HATALARI, ...KEY_ADLARI];
  for (const ad of adlar) assert.ok(belge.includes(`\`${ad}\``), ad);
});

test("CIHAZ.md örnek JSON'ları şemadan geçer", () => {
  const bloklar = [...belge.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((m) => m[1]!);
  assert.ok(bloklar.length >= 15, String(bloklar.length));
  const gorulen = new Set<string>();
  for (const blok of bloklar) {
    const deger = JSON.parse(blok) as { type: string; name?: string };
    const yukari = CihazYukari.safeParse(deger);
    const asagi = CihazAsagi.safeParse(deger);
    assert.ok(yukari.success || asagi.success, blok);
    gorulen.add(deger.type);
    if (deger.name) gorulen.add(`cmd:${deger.name}`);
  }
  const beklenen = [
    "hello", "auth_challenge", "auth_response", "welcome", "cmd", "cmd_result", "grant_issued",
    "grant_revoked", "grant_revoke", "device_state", "app_list", "notify", "notify_ack", "error",
    ...CMD_ADLARI.map((ad) => `cmd:${ad}`),
  ];
  for (const tur of beklenen) assert.ok(gorulen.has(tur), tur);
});

test("CIHAZ.md dönüş satırı örnekleri koddan üretilenle aynıdır", () => {
  const ornekler = [
    cmdSonucuMetni({ ok: true, foreground: { baslik: "Mesajlar", paket: "com.example.mesaj" } }),
    cmdSonucuMetni({ ok: false, foreground: { baslik: "", paket: "com.example.banka" }, denied: "hassas_uygulama" }),
    cmdSonucuMetni({ ok: false, foreground: { baslik: "Mesajlar", paket: "com.example.mesaj" }, hata: "element_bulunamadi" }),
    cmdSonucuMetni({
      ok: true,
      foreground: { baslik: "Mesajlar", paket: "com.example.mesaj" },
      payload: {
        kind: "elements",
        truncated: false,
        elements: [
          { id: 1, rol: "button", ad: "Gönder", x: 980, y: 2210 },
          { id: 2, rol: "edit", ad: "Mesaj", deger: "Merhaba", x: 500, y: 2210 },
        ],
      },
    }),
  ];
  for (const ornek of ornekler) assert.ok(belge.includes(ornek), ornek);
});
