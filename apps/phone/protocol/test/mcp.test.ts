import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EREN_ARACLARI,
  jsonSemasi,
  KullaniciyaSorCikti,
  KullaniciyaSorGirdi,
  SINIRLAR,
  SORU_ARACLARI,
  TELEFON_ARACLARI,
} from "../src/index.ts";
import { HASH, PLAN_PC, RAPOR } from "./ornekler.ts";

const { plan_id: _planId, ...taslak } = PLAN_PC;
const CIT = "abcdefghij012345";
const OZET = { is_id: 7, baslik: "İş", tur: "pc", durum: "calisiyor", baslangic_ms: 1, kirli: false };

const TABLO = {
  plan_oner: {
    arac: EREN_ARACLARI.plan_oner,
    girdi: [taslak, { ...taslak, dayandigi_isler: [1] }],
    kotuGirdi: [{}, { ...taslak, plan_id: "x" }, { ...taslak, kirli_kaynak: [1] }],
    cikti: [
      { plan_id: "p1", plan_hash: HASH, durum: "onay_bekliyor" },
      { plan_id: "p1", plan_hash: HASH, durum: "basladi", is_id: 7 },
      { plan_id: "p1", plan_hash: HASH, durum: "basladi" },
      { plan_id: "p1", plan_hash: HASH, durum: "telefonda_baslatiliyor" },
      ...["tam_yetki_kapali", "kirli_kaynak", "tur_bitti", "limit_kilitli", "baslatma_hatasi"].map((neden) => ({
        plan_id: "p1",
        plan_hash: HASH,
        durum: "onay_bekliyor",
        neden,
      })),
    ],
    kotuCikti: [
      { plan_id: "p1", plan_hash: HASH, durum: "uyduruk" },
      { plan_id: "p1", plan_hash: HASH, durum: "basladi", is_id: 0 },
      { plan_id: "p1", plan_hash: HASH, durum: "basladi", is_id: "7" },
      { plan_id: "p1", plan_hash: HASH, durum: "onay_bekliyor", is_id: 7 },
      { plan_id: "p1", plan_hash: HASH, durum: "telefonda_baslatiliyor", is_id: 7 },
      { plan_id: "p1", plan_hash: HASH, durum: "basladi", neden: "tur_bitti" },
      { plan_id: "p1", plan_hash: HASH, durum: "telefonda_baslatiliyor", neden: "tam_yetki_kapali" },
      { plan_id: "p1", plan_hash: HASH, durum: "onay_bekliyor", neden: "uyduruk" },
      { plan_id: "p1", plan_hash: HASH, durum: "onay_bekliyor", fazla: 1 },
      { plan_id: "p1", durum: "onay_bekliyor" },
    ],
  },
  oturumlar: {
    arac: EREN_ARACLARI.oturumlar,
    girdi: [{}, { yalniz_aktif: true }],
    kotuGirdi: [{ yalniz_aktif: "evet" }],
    cikti: [
      { oturumlar: [], ram_bos_mb: 1, ram_toplam_mb: 2, ram_dusuk: false },
      { oturumlar: [OZET, { ...OZET, durum: "limit_durdu", bitis_ms: 9, kirli: true }], ram_bos_mb: 1, ram_toplam_mb: 2, ram_dusuk: true },
    ],
    kotuCikti: [
      { oturumlar: [{ ...OZET, durum: "uyduruk" }], ram_bos_mb: 1, ram_toplam_mb: 2, ram_dusuk: false },
      { oturumlar: Array(SINIRLAR.OTURUM_ADET + 1).fill(OZET), ram_bos_mb: 1, ram_toplam_mb: 2, ram_dusuk: false },
    ],
  },
  rapor_oku: {
    arac: EREN_ARACLARI.rapor_oku,
    girdi: [{ id: 7 }],
    kotuGirdi: [{}, { id: "7" }, { id: -1 }, { is_id: 7 }],
    cikti: [{ is_id: 7, durum: "tamam", kirli: false, cit: CIT, govde: "metin", kirpildi: false }],
    kotuCikti: [
      { is_id: 7, durum: "tamam", kirli: false, cit: "kisa", govde: "metin", kirpildi: false },
      { is_id: 7, durum: "tamam", kirli: false, cit: CIT, govde: "x".repeat(SINIRLAR.RAPOR_GOVDE + 1), kirpildi: true },
    ],
  },
  projeler: {
    arac: EREN_ARACLARI.projeler,
    girdi: [{}],
    kotuGirdi: [{ filtre: "x" }],
    cikti: [{ projeler: [{ ad: "Örnek", yol: "C:\\Proje", not: "not" }] }],
    kotuCikti: [{ projeler: [{ ad: "Örnek" }] }],
  },
  uygulamalar: {
    arac: EREN_ARACLARI.uygulamalar,
    girdi: [{}],
    kotuGirdi: [{ filtre: "x" }],
    cikti: [{ telefon_bagli: true, uygulamalar: [{ paket: "com.a.b", ad: "A", durum: "hassas" }] }],
    kotuCikti: [{ telefon_bagli: true, uygulamalar: [{ paket: "bozuk", ad: "A", durum: "hassas" }] }],
  },
  oturum_durdur: {
    arac: EREN_ARACLARI.oturum_durdur,
    girdi: [{ id: 3 }],
    kotuGirdi: [{}, { id: 1.5 }],
    cikti: [{ is_id: 3, sonuc: "durduruldu" }, { is_id: 3, sonuc: "zaten_bitmis" }],
    kotuCikti: [{ is_id: 3, sonuc: "uyduruk" }],
  },
  devir_ozeti: {
    arac: EREN_ARACLARI.devir_ozeti,
    girdi: [{ ozet: "özet" }],
    kotuGirdi: [{}, { ozet: "" }, { ozet: "x".repeat(SINIRLAR.DEVIR_OZETI + 1) }],
    cikti: [{ kabul: true }, { kabul: false }],
    kotuCikti: [{}, { kabul: "evet" }],
  },
  kullaniciya_sor: {
    arac: SORU_ARACLARI.kullaniciya_sor,
    girdi: [{ soru: "Devam?" }, { soru: "Hangisi?", secenekler: ["a", "b"] }],
    kotuGirdi: [{}, { soru: "" }, { soru: "x", soru_id: "s1" }, { soru: "x", secenekler: ["a"] }],
    cikti: [{ durum: "cevaplandi", cevap: "Evet" }, { durum: "zaman_asimi" }, { durum: "iptal" }],
    kotuCikti: [{ durum: "cevaplandi" }, { durum: "iptal", cevap: "x" }, { durum: "uyduruk" }],
  },
  rapor_ver: {
    arac: TELEFON_ARACLARI.rapor_ver,
    girdi: [RAPOR],
    kotuGirdi: [{}, { ...RAPOR, fazla: 1 }],
    cikti: [{ kabul: true }],
    kotuCikti: [{ kabul: false }],
  },
};

for (const [ad, t] of Object.entries(TABLO)) {
  test(`araç ${ad}: giriş ve çıkış`, () => {
    for (const g of t.girdi) assert.equal(t.arac.girdi.safeParse(g).success, true, JSON.stringify(g));
    for (const g of t.kotuGirdi) assert.equal(t.arac.girdi.safeParse(g).success, false, JSON.stringify(g).slice(0, 80));
    for (const c of t.cikti) assert.equal(t.arac.cikti.safeParse(c).success, true, JSON.stringify(c));
    for (const c of t.kotuCikti) assert.equal(t.arac.cikti.safeParse(c).success, false, JSON.stringify(c).slice(0, 80));
  });
}

test("istenen bütün araçlar tanımlıdır", () => {
  assert.deepEqual(Object.keys(EREN_ARACLARI).sort(), [
    "devir_ozeti", "oturum_durdur", "oturumlar", "plan_oner", "projeler", "rapor_oku", "uygulamalar",
  ]);
  assert.deepEqual(Object.keys(SORU_ARACLARI), ["kullaniciya_sor"]);
  assert.ok("rapor_ver" in TELEFON_ARACLARI);
});

test("telefon aracı sonucu komut sonucudur, bilinmeyen alanı reddeder", () => {
  const sonuc = { ok: true, foreground: { baslik: "A", paket: "com.a.b" } };
  assert.equal(TELEFON_ARACLARI.click.cikti.safeParse(sonuc).success, true);
  assert.equal(TELEFON_ARACLARI.click.cikti.safeParse({ ...sonuc, fazla: 1 }).success, false);
});

test("bütün araç girdileri MCP'nin istediği nesne biçiminde JSON Schema üretir", () => {
  const araclar = { ...EREN_ARACLARI, ...SORU_ARACLARI, ...TELEFON_ARACLARI };
  assert.equal(Object.keys(araclar).length, 7 + 1 + 12);
  for (const [ad, arac] of Object.entries(araclar)) {
    const sema = jsonSemasi(arac.girdi);
    assert.equal(sema.type, "object", ad);
    assert.equal(sema.additionalProperties, false, ad);
    assert.equal("$schema" in sema, false, ad);
    const cikti = jsonSemasi(arac.cikti);
    assert.equal(cikti.type, "object", ad);
  }
});

test("kullaniciya_sor yalnız soru alır, kimliği köprü üretir", () => {
  const sema = jsonSemasi(KullaniciyaSorGirdi);
  assert.deepEqual(Object.keys(sema.properties as object).sort(), ["secenekler", "soru"]);
  assert.deepEqual(sema.required, ["soru"]);
  assert.equal(KullaniciyaSorCikti.safeParse({ durum: "cevaplandi", cevap: "x" }).success, true);
});
