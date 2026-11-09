import assert from "node:assert/strict";
import { test } from "node:test";
import type { AkisOlayi, ModelKullanimi } from "../src/sozlesme.ts";
import { gunSinirlari, tuketimKayitlari } from "../src/tuketim.ts";

type Sonuc = Extract<AkisOlayi, { tur: "result" }>;
type Bagi = Parameters<typeof tuketimKayitlari>[1];

function sonuc(
  model_kullanimlari: readonly ModelKullanimi[] | null,
  ana_kullanim: Sonuc["ana_kullanim"] = null,
): Sonuc {
  return {
    tur: "result",
    session_id: "s1",
    is_error: false,
    terminal_reason: null,
    stop_reason: null,
    metin: "",
    structured_output: null,
    pencereler: {},
    model_kullanimlari,
    ana_kullanim,
  };
}

function bagi(model: string | null = null): Bagi {
  return {
    ts_ms: 1_700_000_000_000,
    kaynak: "sohbet",
    sohbet_id: "ana",
    is_id: null,
    turn_id: "t-1",
    nesil: 3,
    rol: "normal",
    model,
  };
}

const opus: ModelKullanimi = {
  model: "claude-opus-x",
  girdi: 10,
  cache_yazma: 20,
  cache_okuma: 30,
  cikti: 40,
  maliyet_usd: 0.5,
};
const haiku: ModelKullanimi = {
  model: "claude-haiku-y",
  girdi: 1,
  cache_yazma: 2,
  cache_okuma: 3,
  cikti: 4,
  maliyet_usd: 0.01,
};

test("iki model iki satir, model_farki, sayilar ve baglam alanlari birebir", () => {
  const k = tuketimKayitlari(sonuc([opus, haiku]), bagi("claude-opus-x"));
  assert.equal(k.length, 2);
  assert.deepEqual(
    k.map((s) => s.model),
    ["claude-opus-x", "claude-haiku-y"],
  );
  for (const [i, m] of [opus, haiku].entries()) {
    const s = k[i]!;
    assert.equal(s.olcum, "model_farki");
    assert.equal(s.girdi, m.girdi);
    assert.equal(s.cache_yazma, m.cache_yazma);
    assert.equal(s.cache_okuma, m.cache_okuma);
    assert.equal(s.cikti, m.cikti);
    assert.equal(s.maliyet_usd, m.maliyet_usd);
    assert.equal(s.ts_ms, 1_700_000_000_000);
    assert.equal(s.kaynak, "sohbet");
    assert.equal(s.sohbet_id, "ana");
    assert.equal(s.is_id, null);
    assert.equal(s.turn_id, "t-1");
    assert.equal(s.nesil, 3);
    assert.equal(s.rol, "normal");
  }
});

test("is kaynagi: is_id tasinir", () => {
  const b: Bagi = { ...bagi(), kaynak: "is", is_id: 8 as Bagi["is_id"], turn_id: null, nesil: null, rol: null };
  const k = tuketimKayitlari(sonuc([opus]), b);
  assert.equal(k.length, 1);
  assert.equal(k[0]!.kaynak, "is");
  assert.equal(k[0]!.is_id, 8);
  assert.equal(k[0]!.turn_id, null);
  assert.equal(k[0]!.nesil, null);
  assert.equal(k[0]!.rol, null);
});

test("bos model_kullanimlari sifir satir, yedege dusmez", () => {
  const ana = { girdi: 5, cache_yazma: 5, cache_okuma: 5, cikti: 5 };
  assert.deepEqual(tuketimKayitlari(sonuc([], ana), bagi("m")), []);
});

test("dort sayisi sifir olan model satiri uretilmez", () => {
  const sifir: ModelKullanimi = { model: "bos", girdi: 0, cache_yazma: 0, cache_okuma: 0, cikti: 0, maliyet_usd: 0 };
  const k = tuketimKayitlari(sonuc([sifir, haiku]), bagi());
  assert.equal(k.length, 1);
  assert.equal(k[0]!.model, "claude-haiku-y");
  assert.deepEqual(tuketimKayitlari(sonuc([sifir]), bagi()), []);
});

test("tek sayisi sifir olmayan satir uretilir", () => {
  const m: ModelKullanimi = { model: "x", girdi: 0, cache_yazma: 0, cache_okuma: 0, cikti: 1, maliyet_usd: null };
  const k = tuketimKayitlari(sonuc([m]), bagi());
  assert.equal(k.length, 1);
  assert.equal(k[0]!.maliyet_usd, null);
});

test("model_kullanimlari null: ana_usage yedegi, maliyet null, model b.model", () => {
  const ana = { girdi: 7, cache_yazma: 8, cache_okuma: 9, cikti: 10 };
  const k = tuketimKayitlari(sonuc(null, ana), bagi("claude-opus-x"));
  assert.equal(k.length, 1);
  const s = k[0]!;
  assert.equal(s.olcum, "ana_usage");
  assert.equal(s.maliyet_usd, null);
  assert.equal(s.model, "claude-opus-x");
  assert.equal(s.girdi, 7);
  assert.equal(s.cache_yazma, 8);
  assert.equal(s.cache_okuma, 9);
  assert.equal(s.cikti, 10);
  assert.equal(s.turn_id, "t-1");
  assert.equal(s.nesil, 3);
  assert.equal(s.rol, "normal");
});

test("ana_usage yedeginde b.model null ise bilinmiyor", () => {
  const ana = { girdi: 1, cache_yazma: 0, cache_okuma: 0, cikti: 1 };
  const k = tuketimKayitlari(sonuc(null, ana), bagi(null));
  assert.equal(k.length, 1);
  assert.equal(k[0]!.model, "bilinmiyor");
});

test("ikisi de null sifir satir", () => {
  assert.deepEqual(tuketimKayitlari(sonuc(null, null), bagi("m")), []);
});

// Beklentiler yerel bilesenlerden kurulur: makinenin saat diliminden bagimsiz.
test("gunSinirlari: gun ortasi", () => {
  const an = new Date(2026, 10, 9, 14, 35, 12, 345).getTime();
  const g = gunSinirlari(an);
  assert.equal(g.gunBaslangicMs, new Date(2026, 10, 9, 0, 0, 0, 0).getTime());
  assert.equal(g.yediGunBaslangicMs, new Date(2026, 10, 3, 0, 0, 0, 0).getTime());
});

test("gunSinirlari: tam gece yarisi kendisi", () => {
  const an = new Date(2026, 10, 9, 0, 0, 0, 0).getTime();
  const g = gunSinirlari(an);
  assert.equal(g.gunBaslangicMs, an);
  assert.equal(g.yediGunBaslangicMs, new Date(2026, 10, 3, 0, 0, 0, 0).getTime());
});

test("gunSinirlari: gece yarisindan 1 ms once onceki gunu verir", () => {
  const an = new Date(2026, 10, 9, 0, 0, 0, 0).getTime() - 1;
  const g = gunSinirlari(an);
  assert.equal(g.gunBaslangicMs, new Date(2026, 10, 8, 0, 0, 0, 0).getTime());
});

test("gunSinirlari: ay ve yil sinirini asar, bugun dahil 7 takvim gunu", () => {
  const an = new Date(2026, 0, 3, 23, 59, 59, 999).getTime();
  const g = gunSinirlari(an);
  assert.equal(g.gunBaslangicMs, new Date(2026, 0, 3, 0, 0, 0, 0).getTime());
  assert.equal(g.yediGunBaslangicMs, new Date(2025, 11, 28, 0, 0, 0, 0).getTime());
});
