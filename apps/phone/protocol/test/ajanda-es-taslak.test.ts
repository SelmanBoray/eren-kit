/**
 * Asistan aracının iki saf kuralı (`ajanda.ts`), dil bağımsız vakalarla (Rust aynısını yazarsa bu tablolar
 * vektördür):
 * - `ajandaAracVarsayilanHatirlatmalari`: araç hatırlatma vermediyse varsayılan kaydın zamanına göredir.
 * - `ajandaEsBaskaBaglamdanMi` ve `ajandaAracEsBirlesimi`: emirle gelen eklemenin açık eşe birleşmesi; eş
 *   başka bir konuşma bağlamının (PC'de başka oturum) sentetik taslağıysa insanın vermediği alan taşınmaz.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AJANDA_VARSAYILAN_HATIRLATMALAR,
  type AjandaAracEsGirdisi,
  ajandaAracEsBirlesimi,
  ajandaAracVarsayilanHatirlatmalari,
  ajandaEsBaskaBaglamdanMi,
  ajandaEsDegisikligi,
  AjandaKaydi,
  type AjandaZamani,
  PC_TEKIL_KAPSAMI,
  ajandaTekilAnahtari,
} from "../src/index.ts";

const IST = "Europe/Istanbul";
const VARSAYILAN = [...AJANDA_VARSAYILAN_HATIRLATMALAR];
const SAATLI: AjandaZamani = { kesinlik: "an", tarih: "2026-11-26", saat: "13:00", saat_dilimi: IST };
const GUN: AjandaZamani = { kesinlik: "gun", tarih: "2026-11-26", saat_dilimi: IST };
const DONEM: AjandaZamani = { kesinlik: "donem", baslangic: "2026-12-01", bitis: "2026-12-07", saat_dilimi: IST };
const BELIRSIZ: AjandaZamani = { kesinlik: "belirsiz", ifade: "bir ara" };
const IS_GUNU = { siklik: "haftalik", aralik: 1, gunler: ["pzt", "sal", "car", "per", "cum"] } as const;

test("varsayılan hatırlatma kaydın zamanına göre: saatli ve tarihli tek seferlik varışlıda olağan, zamansız ve tekrarda []", () => {
  const vakalar: { ad: string; k: Parameters<typeof ajandaAracVarsayilanHatirlatmalari>[0]; beklenen: unknown[] }[] = [
    { ad: "varışsız saatli", k: { zaman: SAATLI }, beklenen: VARSAYILAN },
    { ad: "varışsız zamansız", k: {}, beklenen: VARSAYILAN },
    { ad: "varışsız belirsiz", k: { zaman: BELIRSIZ }, beklenen: VARSAYILAN },
    { ad: "saatli + varış (1'de iş yerinde)", k: { zaman: SAATLI, varis: {} }, beklenen: VARSAYILAN },
    { ad: "saatsiz tarihli + varış", k: { zaman: GUN, varis: { cikista: true } }, beklenen: VARSAYILAN },
    { ad: "dönem + varış (tarihli)", k: { zaman: DONEM, varis: {} }, beklenen: VARSAYILAN },
    { ad: "zamansız + varış (markete gidince)", k: { varis: {} }, beklenen: [] },
    { ad: "belirsiz + varış", k: { zaman: BELIRSIZ, varis: {} }, beklenen: [] },
    { ad: "tekrar + varış (her iş günü imza)", k: { zaman: GUN, tekrar: { ...IS_GUNU, gunler: [...IS_GUNU.gunler] }, varis: {} }, beklenen: [] },
    { ad: "günlük tekrar + varış", k: { zaman: GUN, tekrar: { siklik: "gunluk", aralik: 1 }, varis: {} }, beklenen: [] },
  ];
  for (const v of vakalar) assert.deepEqual(ajandaAracVarsayilanHatirlatmalari(v.k), v.beklenen, v.ad);
  // Dönen liste kopyadır: çağıranın değiştirmesi sabiti bozmaz.
  const l = ajandaAracVarsayilanHatirlatmalari({});
  l.push({ tur: "once", dk: 5 });
  assert.deepEqual(AJANDA_VARSAYILAN_HATIRLATMALAR, [{ tur: "once", dk: 60 }]);
});

const OT_A = "3f1c2a9e-7b4d-4c1a-9e2f-0a1b2c3d4e5f";
const OT_B = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const pcSentetik = (oturum_id: string) => ({ yol: "pc_araci", tur_kokeni: "sentetik", oturum_id }) as const;
const pcInsan = (oturum_id: string) => ({ yol: "pc_araci", tur_kokeni: "insan", oturum_id }) as const;
const telSentetik = (sohbet_id: string) => ({ yol: "sohbet_araci", tur_kokeni: "sentetik", sohbet_id }) as const;
const telInsan = (sohbet_id: string) => ({ yol: "sohbet_araci", tur_kokeni: "insan", sohbet_id }) as const;

test("eş taslak başka bağlamdan mı: PC'de oturum, telefonda sohbet; taslak olmayan ve emirle doğan eş hiç", () => {
  const vakalar: { ad: string; taslak: boolean; kaynak: Parameters<typeof ajandaEsBaskaBaglamdanMi>[0]["kaynak"]; yazar: Parameters<typeof ajandaEsBaskaBaglamdanMi>[1]; beklenen: boolean }[] = [
    { ad: "PC başka oturumun alt agent taslağı", taslak: true, kaynak: pcSentetik(OT_A), yazar: pcInsan(OT_B), beklenen: true },
    { ad: "PC aynı oturumun alt agent taslağı", taslak: true, kaynak: pcSentetik(OT_A), yazar: pcInsan(OT_A), beklenen: false },
    { ad: "PC başka oturum ama eş taslak değil", taslak: false, kaynak: pcSentetik(OT_A), yazar: pcInsan(OT_B), beklenen: false },
    { ad: "PC başka oturum, eş insan kökenli taslak", taslak: true, kaynak: pcInsan(OT_A), yazar: pcInsan(OT_B), beklenen: false },
    { ad: "PC yazarı, telefon sohbetinin taslağı (oturum yok)", taslak: true, kaynak: telSentetik("ana"), yazar: pcInsan(OT_B), beklenen: true },
    { ad: "PC aynı oturumun arka plan taslağı", taslak: true, kaynak: { yol: "arka_plan", tur_kokeni: "sentetik", oturum_id: OT_A }, yazar: pcInsan(OT_A), beklenen: false },
    { ad: "telefon aynı sohbetin sentetik taslağı", taslak: true, kaynak: telSentetik("ana"), yazar: telInsan("ana"), beklenen: false },
    { ad: "telefon aynı sohbetin arka plan taslağı", taslak: true, kaynak: { yol: "arka_plan", tur_kokeni: "sentetik", sohbet_id: "ana" }, yazar: telInsan("ana"), beklenen: false },
    { ad: "telefon başka sohbetin taslağı", taslak: true, kaynak: telSentetik("eski"), yazar: telInsan("ana"), beklenen: true },
    { ad: "uygulama yazarı (kimlik yok)", taslak: true, kaynak: pcSentetik(OT_A), yazar: { yol: "elle", tur_kokeni: "insan" }, beklenen: false },
  ];
  for (const v of vakalar) assert.equal(ajandaEsBaskaBaglamdanMi({ taslak: v.taslak, kaynak: v.kaynak }, v.yazar), v.beklenen, v.ad);
});

/** PC kapsamında doğmuş eş kayıt (anahtar `girdi`yle aynı). */
const esKaydi = (g: AjandaAracEsGirdisi, ek: Partial<AjandaKaydi> = {}): AjandaKaydi => ({
  kayit_id: "k_es",
  revizyon: 1,
  tur: g.tur,
  baslik: g.baslik,
  ...(g.zaman === undefined ? {} : { zaman: g.zaman }),
  ...(g.bolge === undefined ? {} : { bolge: g.bolge }),
  hatirlatmalar: [],
  ornekler: [],
  durum: "acik",
  taslak: true,
  silindi: false,
  elle_alanlar: [],
  kaynak: {
    ...pcSentetik(OT_A),
    tekil_anahtar: ajandaTekilAnahtari({ kapsam: PC_TEKIL_KAPSAMI, tur: g.tur, baslik: g.baslik, zaman: g.zaman, bolge: g.bolge }),
  },
  olusturma_ms: 1_000,
  guncelleme_ms: 1_000,
  ...ek,
});

/** Alt agent'ın taslağı: açıklama, hatırlatma, bağlantı, simge, varış ve sözü kendisinin. */
const ALT_TASLAGI = {
  aciklama: "ALT-AGENT-ACIKLAMASI",
  hatirlatmalar: [{ tur: "once", dk: 15 }],
  baglantilar: [{ url: "https://alt-agent.example/x" }],
  simge: "is",
  varis: { cikista: true },
} satisfies Partial<AjandaKaydi>;

test("başka oturumun taslağı: insanın vermediği alan taşınmaz; sonuç insanın çağrısının doğuracağı kayıt, kimlik korunur", () => {
  // İnsan: "yarın 1'de iş yerinde olmak lazım" (bölge yazılışı farklı, aynı yer; söz farklı).
  const girdi: AjandaAracEsGirdisi = {
    tur: "randevu",
    baslik: "İş yeri",
    zaman: { ...SAATLI, ifade: "yarın 1'de" },
    bolge: "iş yeri",
  };
  const es = esKaydi(
    { ...girdi, zaman: { ...SAATLI, ifade: "26'sı 13:00" }, bolge: "İŞ YERİ" },
    { ...ALT_TASLAGI, zaman: { ...SAATLI, ifade: "26'sı 13:00" }, bolge: "İŞ YERİ" },
  );
  const s = ajandaAracEsBirlesimi(es, girdi, pcInsan(OT_B));
  assert.equal(s.baska_baglam, true);
  const onaylanan = { ...s.kayit, taslak: false };
  assert.equal(AjandaKaydi.safeParse(onaylanan).success, true);
  // İnsanın çağrısı tek başına: varışsız saatli randevu, olağan varsayılan hatırlatma.
  const tekBasina = {
    tur: "randevu",
    baslik: "İş yeri",
    zaman: { ...SAATLI, ifade: "yarın 1'de" },
    bolge: "iş yeri",
    hatirlatmalar: VARSAYILAN,
    elle_alanlar: ["tur", "baslik", "zaman", "bolge"],
  };
  for (const [a, v] of Object.entries(tekBasina)) assert.deepEqual(onaylanan[a as keyof AjandaKaydi], v, a);
  for (const a of ["aciklama", "baglantilar", "simge", "varis", "tekrar"] as const) assert.equal(onaylanan[a], undefined, a);
  // Kimlik, kaynak izi (taslağın yazarı), oluşturma anı korunur.
  assert.equal(onaylanan.kayit_id, "k_es");
  assert.deepEqual(onaylanan.kaynak, es.kaynak);
  assert.equal(onaylanan.olusturma_ms, 1_000);
  assert.deepEqual(s.tasinmayan, ["aciklama", "hatirlatmalar", "simge", "varis", "baglantilar"]);
  assert.deepEqual(s.soylenen, ["zaman", "bolge"], "yalnız insanın söylediği ve eşte farklı olan");
  assert.deepEqual(s.uygulanan, ["aciklama", "zaman", "hatirlatmalar", "simge", "bolge", "varis", "baglantilar"]);
});

test("başka oturumun taslağı: insanın verdiği alan alınır (aynı değer de elle_alanlar'a girer); varışlıda varsayılan zamana göre", () => {
  // "markete gidince süt al": zamansız, varışlı; taslakta aynı varış ve açıklama vardı.
  const girdi: AjandaAracEsGirdisi = { tur: "gorev", baslik: "Süt al", bolge: "market", varis: { cikista: true } };
  const es = esKaydi(girdi, { ...ALT_TASLAGI });
  const s = ajandaAracEsBirlesimi(es, girdi, pcInsan(OT_B));
  assert.deepEqual(s.kayit.varis, { cikista: true });
  assert.deepEqual(s.kayit.hatirlatmalar, [], "zamansız varışlı: varsayılan []");
  assert.equal(s.kayit.aciklama, undefined);
  assert.deepEqual(s.kayit.elle_alanlar, ["tur", "baslik", "bolge", "varis"]);
  assert.deepEqual(s.soylenen, []);
  assert.deepEqual(s.tasinmayan, ["aciklama", "hatirlatmalar", "simge", "baglantilar"]);
  // Her iş günü imza: tekrar ve varış verildi, taslağın hatırlatması [] olur.
  const imza: AjandaAracEsGirdisi = { tur: "gorev", baslik: "İmza", zaman: GUN, bolge: "iş yeri", varis: {}, tekrar: { ...IS_GUNU, gunler: [...IS_GUNU.gunler] } };
  const s2 = ajandaAracEsBirlesimi(esKaydi(imza, { hatirlatmalar: VARSAYILAN }), imza, pcInsan(OT_B));
  assert.deepEqual(s2.kayit.hatirlatmalar, []);
  assert.deepEqual(s2.tasinmayan, ["hatirlatmalar"]);
  assert.deepEqual(s2.soylenen, ["tekrar", "varis"]);
  // İnsan hatırlatma verdiyse o yazılır, taşınmayan sayılmaz.
  const s3 = ajandaAracEsBirlesimi(es, { ...girdi, hatirlatmalar: [] }, pcInsan(OT_B));
  assert.deepEqual(s3.kayit.hatirlatmalar, []);
  assert.equal(s3.tasinmayan.includes("hatirlatmalar"), false);
  assert.deepEqual(s3.kayit.elle_alanlar, ["tur", "baslik", "hatirlatmalar", "bolge", "varis"]);
});

test("başka oturumun taslağı: eşin elle_alanlar'ındaki alan (kullanıcının ya da uygulamanın koyduğu) kalır", () => {
  const girdi: AjandaAracEsGirdisi = { tur: "gorev", baslik: "Süt al", bolge: "market" };
  const KONUM = { enlem_e6: 41_000_000, boylam_e6: 29_000_000, yaricap_m: 150 };
  const es = esKaydi(girdi, { ...ALT_TASLAGI, bolge_konumu: KONUM, elle_alanlar: ["aciklama", "bolge_konumu"] });
  const s = ajandaAracEsBirlesimi(es, girdi, pcInsan(OT_B));
  assert.equal(s.kayit.aciklama, "ALT-AGENT-ACIKLAMASI");
  assert.deepEqual(s.kayit.bolge_konumu, KONUM);
  assert.equal(s.kayit.varis, undefined);
  assert.deepEqual(s.kayit.elle_alanlar, ["tur", "baslik", "aciklama", "bolge", "bolge_konumu"]);
  assert.deepEqual(s.tasinmayan, ["hatirlatmalar", "simge", "varis", "baglantilar"]);
  // Taşınmayan konum (elle değil) da kalkar: taslağın konumu insanın çağrısından doğmaz.
  const s2 = ajandaAracEsBirlesimi(esKaydi(girdi, { bolge_konumu: KONUM }), girdi, pcInsan(OT_B));
  assert.equal(s2.kayit.bolge_konumu, undefined);
  assert.deepEqual(s2.tasinmayan, ["hatirlatmalar", "bolge_konumu"]);
});

test("aynı bağlamın taslağı (aynı oturum, telefonda aynı sohbet) ve taslak olmayan eş: bugünkü birleşme, taslak alanları kalır", () => {
  const girdi: AjandaAracEsGirdisi = { tur: "randevu", baslik: "Dişçi", zaman: { ...SAATLI, ifade: "yarın 1'de" }, hatirlatmalar: [{ tur: "once", dk: 30 }] };
  for (const [ad, ek, yazar] of [
    ["PC aynı oturum", {}, pcInsan(OT_A)],
    ["PC başka oturum, taslak değil", { taslak: false }, pcInsan(OT_B)],
    ["telefon aynı sohbet", { kaynak: { ...telSentetik("ana"), tekil_anahtar: "t1:x" } }, telInsan("ana")],
  ] as const) {
    const es = esKaydi({ ...girdi, zaman: SAATLI }, { ...ALT_TASLAGI, zaman: { ...SAATLI, ifade: "26'sı" }, ...ek });
    const s = ajandaAracEsBirlesimi(es, girdi, yazar);
    assert.equal(s.baska_baglam, false, ad);
    assert.equal(s.kayit.aciklama, "ALT-AGENT-ACIKLAMASI", ad);
    assert.deepEqual(s.kayit.baglantilar, ALT_TASLAGI.baglantilar, ad);
    assert.deepEqual(s.kayit.varis, ALT_TASLAGI.varis, ad);
    assert.deepEqual(s.kayit.hatirlatmalar, [{ tur: "once", dk: 30 }], ad);
    assert.equal(s.kayit.zaman?.kesinlik === "an" && s.kayit.zaman.ifade, "26'sı", `${ad}: eşin sözü korunur`);
    assert.deepEqual(s.tasinmayan, [], ad);
    assert.deepEqual(s.soylenen, ["hatirlatmalar"], ad);
    // `ajandaEsDegisikligi` ile v3 alanlarının birleşmesi: bugünkü sonuçla aynı.
    assert.deepEqual(ajandaEsDegisikligi(es, girdi), { hatirlatmalar: [{ tur: "once", dk: 30 }] });
  }
});

test("olağan eşte varsayılan hatırlatma tutarlı: varsayılanlı eşe varış ve tekrar işlenince [], saatliye varış eklenince kalır", () => {
  // Tarihli, varsayılan hatırlatmalı kayıt; kullanıcı aynı kaydı "her iş günü varınca" diye yeniden ister.
  const imza: AjandaAracEsGirdisi = { tur: "gorev", baslik: "İmza", zaman: GUN, bolge: "iş yeri", varis: {}, tekrar: { ...IS_GUNU, gunler: [...IS_GUNU.gunler] } };
  const es = esKaydi(imza, { taslak: false, kaynak: { ...pcInsan(OT_A), tekil_anahtar: "t1:x" }, hatirlatmalar: VARSAYILAN });
  const s = ajandaAracEsBirlesimi(es, imza, pcInsan(OT_A));
  assert.deepEqual(s.kayit.hatirlatmalar, [], "her sabah zaman bildirimi gelmez");
  assert.deepEqual(s.soylenen, ["tekrar", "varis"], "varsayılan söylenen değildir");
  assert.deepEqual(s.kayit.elle_alanlar, ["tekrar", "varis"], "varsayılan elle_alanlar'a girmez");
  assert.deepEqual(s.uygulanan, ["hatirlatmalar", "tekrar", "varis"]);
  // Saatli kayda varış: varsayılan aynı kalır, varış ona eklenir.
  const randevu: AjandaAracEsGirdisi = { tur: "randevu", baslik: "İş", zaman: SAATLI, bolge: "iş yeri", varis: {} };
  const s2 = ajandaAracEsBirlesimi(esKaydi(randevu, { taslak: false, hatirlatmalar: VARSAYILAN }), randevu, pcInsan(OT_A));
  assert.deepEqual(s2.kayit.hatirlatmalar, VARSAYILAN);
  assert.deepEqual(s2.soylenen, ["varis"]);
  // Kullanıcının koyduğu hatırlatmaya (elle) ve varsayılan olmayana dokunulmaz.
  const elle = esKaydi(imza, { taslak: false, hatirlatmalar: VARSAYILAN, elle_alanlar: ["hatirlatmalar"] });
  assert.deepEqual(ajandaAracEsBirlesimi(elle, imza, pcInsan(OT_A)).kayit.hatirlatmalar, VARSAYILAN);
  const ozel = esKaydi(imza, { taslak: false, hatirlatmalar: [{ tur: "once", dk: 15 }] });
  assert.deepEqual(ajandaAracEsBirlesimi(ozel, imza, pcInsan(OT_A)).kayit.hatirlatmalar, [{ tur: "once", dk: 15 }]);
});
