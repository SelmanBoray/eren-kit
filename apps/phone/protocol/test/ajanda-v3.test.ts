import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AJANDA_ALANLARI,
  AJANDA_CERCEVE_SEMALARI,
  AJANDA_EK_RET_KODLARI,
  AJANDA_GOVDE_SEMALARI,
  AJANDA_SIMGELERI,
  AJANDA_SINIRLARI,
  AJANDA_SURUM_ALANLARI,
  AJANDA_SURUMU,
  AJANDA_V3_ALANLARI,
  AJANDA_YETENEKLERI,
  type AjandaAsagi,
  ajandaAsagiCoz,
  ajandaAsagiSurume,
  ajandaBase64Boyu,
  ajandaBase64Bayti,
  ajandaBolgeAnahtari,
  ajandaBolgeYeriDegisirMi,
  ajandaDegisikligiUygula,
  AjandaKaydi,
  ajandaTekilAnahtari,
  ajandaUrlAlanAdi,
  ajandaUrlGecerliMi,
  ajandaYetenekKesisimi,
  AjandaYetenekler,
  ajandaYukariCoz,
  kanonikBase64Mi,
  type KaynakYolu,
  SIMGE_DESENI,
  type TurKokeni,
  YETENEK_DESENI,
} from "../src/index.ts";

/** Sözleşme v3: yeni kayıt alanları, yetenekler, ek yedeği çerçeveleri, saf yardımcılar ve vektörleri. */

type Oge = { ad: string; ham: string; gecerli: boolean; tur?: string; kod?: string; islem_id?: string };
const oku = (ad: string) => JSON.parse(readFileSync(new URL(`../vektorler/${ad}`, import.meta.url), "utf8"));
const mesaj3 = oku("ajanda-mesaj-v3.json") as { surum: number; asagi: Oge[]; yukari: Oge[] };
const mesaj2 = oku("ajanda-mesaj.json") as { surum: number; asagi: Oge[]; yukari: Oge[] };
const kurallar2 = oku("ajanda-kurallar.json") as {
  tekil_anahtar: { ad: string; girdi: Parameters<typeof ajandaTekilAnahtari>[0]; anahtar: string }[];
  birlestirme: { kayit: unknown }[];
};
const v3 = oku("ajanda-v3.json") as {
  surum: number;
  sinirlar: Record<string, number>;
  simgeler: string[];
  yetenekler: string[];
  ek_ret_kodlari: string[];
  bolge_anahtari: { ad: string; girdi: string; anahtar: string }[];
  url: { ad: string; url: string; gecerli: boolean; alan_adi: string | null }[];
  tekil_anahtar: { ad: string; girdi: Parameters<typeof ajandaTekilAnahtari>[0]; anahtar: string }[];
  bolge_konumu: {
    ad: string;
    kayit: unknown;
    degisiklik: Record<string, unknown>;
    yazar: { yol: KaynakYolu; tur_kokeni: TurKokeni };
    beklenen: { uygulanan: string[]; korunan: string[]; elle_alanlar: string[]; kaldirilan?: string[] } & Record<string, unknown>;
  }[];
  yetenek_kesisimi: { ad: string; istenen: string[] | null; sunulan: string[]; kesisim: string[] }[];
  asagi_uyarlama: { ad: string; surum: 2; girdi: unknown; cikti: unknown }[];
};

function dene(yon: Oge[], coz: (ham: string) => { ok: boolean; mesaj?: { type: string }; kod?: string; islem_id?: string }) {
  assert.ok(yon.length > 0);
  for (const o of yon) {
    const s = coz(o.ham);
    if (o.gecerli) {
      assert.equal(s.ok, true, o.ad);
      assert.equal(s.mesaj?.type, o.tur, o.ad);
      // Yeniden kodlama aynı JSON (Rust düzeneğinin "yeniden kodlama" denetimi).
      assert.deepEqual(JSON.parse(JSON.stringify(s.mesaj)), JSON.parse(o.ham), o.ad);
    } else {
      assert.equal(s.ok, false, o.ad);
      assert.equal(s.kod, o.kod, o.ad);
      assert.equal(s.islem_id, o.islem_id, `${o.ad}: islem_id`);
    }
  }
}

test("v3 vektör dosyaları: sürüm 3, adlar tekil", () => {
  assert.equal(AJANDA_SURUMU, 3);
  assert.equal(mesaj3.surum, 3);
  assert.equal(v3.surum, 3);
  for (const bolum of [mesaj3.asagi, mesaj3.yukari, v3.bolge_anahtari, v3.url, v3.tekil_anahtar, v3.bolge_konumu, v3.yetenek_kesisimi, v3.asagi_uyarlama]) {
    assert.equal(new Set(bolum.map((o) => o.ad)).size, bolum.length);
  }
});

test("v3 aşağı ve yukarı vektörleri v3 bağlantıda ve sürüm sabitlenmeden aynı sonucu verir", () => {
  for (const b of [3 as const, undefined]) {
    // Sabitlenmemiş bağlantıda v2 çerçevesi kendi sürümünde geçerlidir; yalnız v3 bağlantıda protokol_uyumsuz.
    const yalniz3 = (o: Oge) => b === 3 || o.kod !== "protokol_uyumsuz";
    dene(mesaj3.asagi.filter(yalniz3), (h) => ajandaAsagiCoz(h, b));
    dene(mesaj3.yukari.filter(yalniz3), (h) => ajandaYukariCoz(h, b));
  }
});

test("v3'te her çerçeve türünden geçerli örnek var (ek yedeği dahil)", () => {
  const tur = (yon: Oge[]) => new Set(yon.filter((o) => o.gecerli).map((o) => o.tur));
  const asagi = tur(mesaj3.asagi);
  for (const t of ["pair_result", "auth_challenge", "welcome", "kayit", "esitlendi", "islem_sonucu", "gecmis", "error", "ek_durum", "ek_parca", "ek_ret"]) {
    assert.ok(asagi.has(t), t);
  }
  const yukari = tur(mesaj3.yukari);
  for (const t of ["pair_request", "hello", "auth_response", "islem", "gecmis_iste", "ek_yukle", "ek_parca", "ek_iste"]) assert.ok(yukari.has(t), t);
  // Birleşimlerin üye kümesi: v2'nin hepsi + yalnız ek çerçeveleri.
  const turler = (s: { options: readonly { shape: { type: { value: string } } }[] }) => s.options.map((o) => o.shape.type.value).sort();
  const y2 = turler(AJANDA_CERCEVE_SEMALARI[2].Yukari as never);
  const y3 = turler(AJANDA_CERCEVE_SEMALARI[3].Yukari as never);
  const a2 = turler(AJANDA_CERCEVE_SEMALARI[2].Asagi as never);
  const a3 = turler(AJANDA_CERCEVE_SEMALARI[3].Asagi as never);
  assert.deepEqual(y3.filter((t) => !y2.includes(t)), ["ek_iste", "ek_parca", "ek_yukle"]);
  assert.deepEqual(a3.filter((t) => !a2.includes(t)), ["ek_durum", "ek_parca", "ek_ret"]);
  assert.deepEqual(y2.filter((t) => !y3.includes(t)), []);
  assert.deepEqual(a2.filter((t) => !a3.includes(t)), []);
});

test("v3, v2'nin üst kümesi: her geçerli v2 çerçevesi v'si 3 yapılınca (welcome'a yetenekler eklenince) v3'te geçerli", () => {
  for (const [yon, coz] of [
    [mesaj2.asagi, ajandaAsagiCoz],
    [mesaj2.yukari, ajandaYukariCoz],
  ] as const) {
    for (const o of yon.filter((x) => x.gecerli)) {
      const m: Record<string, unknown> = { ...(JSON.parse(o.ham) as Record<string, unknown>), v: 3 };
      if (m.type === "welcome") m.yetenekler = [];
      const s = coz(JSON.stringify(m), 3);
      assert.equal(s.ok, true, o.ad);
    }
  }
  // Kural vektörlerinin bütün kayıtları v3 kaydıdır.
  for (const b of kurallar2.birlestirme) assert.equal(AjandaKaydi.safeParse(b.kayit).success, true);
});

test("gövde şemaları sürüme bağlı: v2 şeması v3 alanını ve alan adını reddeder", () => {
  const k2 = AJANDA_GOVDE_SEMALARI[2].Kaydi;
  const k3 = AJANDA_GOVDE_SEMALARI[3].Kaydi;
  const temel = JSON.parse(mesaj2.asagi.find((o) => o.gecerli && o.tur === "kayit")!.ham).kayit as Record<string, unknown>;
  assert.equal(k2.safeParse(temel).success, true);
  assert.equal(k3.safeParse(temel).success, true);
  assert.equal(k2.safeParse({ ...temel, simge: "market" }).success, false);
  assert.equal(k3.safeParse({ ...temel, simge: "market" }).success, true);
  assert.equal(k2.safeParse({ ...temel, elle_alanlar: ["simge"] }).success, false);
  assert.equal(k3.safeParse({ ...temel, elle_alanlar: ["simge"] }).success, true);
  assert.equal(AJANDA_GOVDE_SEMALARI[2].Degisiklik.safeParse({ bolge: "ev" }).success, false);
  assert.equal(AJANDA_GOVDE_SEMALARI[3].Degisiklik.safeParse({ bolge: "ev" }).success, true);
  assert.equal(AJANDA_GOVDE_SEMALARI[3].Degisiklik.safeParse({ simge: undefined }).success, false, "boş değişiklik");
  assert.equal(AJANDA_GOVDE_SEMALARI[2].Parca.safeParse({ ekler: null }).success, false);
  assert.equal(AJANDA_GOVDE_SEMALARI[3].Parca.safeParse({ ekler: null }).success, true);
  // Alan kümeleri: v2 v3'ün öneki, yeni alanlar sonda.
  assert.deepEqual([...AJANDA_SURUM_ALANLARI[2], ...AJANDA_V3_ALANLARI], [...AJANDA_ALANLARI]);
  assert.deepEqual([...AJANDA_SURUM_ALANLARI[3]], [...AJANDA_ALANLARI]);
});

test("v3 sınırları, simge, yetenek ve ret kodu tabloları vektörle birebir", () => {
  for (const [k, deger] of Object.entries(v3.sinirlar)) assert.equal((AJANDA_SINIRLARI as Record<string, number>)[k], deger, k);
  assert.deepEqual([...AJANDA_SIMGELERI], v3.simgeler);
  assert.equal(AJANDA_SIMGELERI[0], "genel", "genel başta");
  const ilk21 = AJANDA_SIMGELERI.slice(1, 22);
  assert.deepEqual([...ilk21].sort(), [...ilk21], "bugünkü 21 anahtar ASCII sırasında");
  assert.equal(new Set(AJANDA_SIMGELERI).size, AJANDA_SIMGELERI.length, "tekil");
  for (const s of AJANDA_SIMGELERI) assert.match(s, SIMGE_DESENI);
  assert.ok(AJANDA_SIMGELERI.length === 29);
  assert.deepEqual([...AJANDA_YETENEKLERI], v3.yetenekler);
  for (const y of AJANDA_YETENEKLERI) assert.match(y, YETENEK_DESENI);
  assert.equal(AjandaYetenekler.safeParse([...AJANDA_YETENEKLERI]).success, true);
  assert.deepEqual([...AJANDA_EK_RET_KODLARI], v3.ek_ret_kodlari);
  assert.equal(ajandaBase64Boyu(AJANDA_SINIRLARI.EK_PARCA), 349_528);
  assert.ok(ajandaBase64Boyu(AJANDA_SINIRLARI.EK_PARCA) + 200 < 2 * 1024 * 1024, "parça çerçeve sınırına sığar");
});

test("bölge eşleşme anahtarı vektörü", () => {
  assert.ok(v3.bolge_anahtari.length >= 20);
  for (const o of v3.bolge_anahtari) assert.equal(ajandaBolgeAnahtari(o.girdi), o.anahtar, o.ad);
  // Anahtar sabit noktadır: anahtarın anahtarı kendisi.
  for (const o of v3.bolge_anahtari) assert.equal(ajandaBolgeAnahtari(o.anahtar), o.anahtar, `${o.ad}: sabit nokta`);
  assert.equal(ajandaBolgeYeriDegisirMi(undefined, "ev"), false);
  assert.equal(ajandaBolgeYeriDegisirMi("ev", undefined), true);
  assert.equal(ajandaBolgeYeriDegisirMi("İŞ YERİ", "iş yeri"), false);
  assert.equal(ajandaBolgeYeriDegisirMi("Işık", "işık"), true);
});

test("URL vektörü: alan adı ya da null; şema da aynı kararı verir", () => {
  assert.ok(v3.url.length >= 40);
  const dallar = new Set<boolean>();
  for (const o of v3.url) {
    assert.equal(ajandaUrlAlanAdi(o.url), o.alan_adi, o.ad);
    assert.equal(ajandaUrlGecerliMi(o.url), o.gecerli, o.ad);
    dallar.add(o.gecerli);
  }
  assert.equal(dallar.size, 2);
});

test("tekil anahtar: bölgesizse v2 baytları; bölge eşleşme anahtarıyla girer", () => {
  for (const o of v3.tekil_anahtar) {
    assert.match(o.anahtar, /^t1:[0-9a-f]{64}$/);
    assert.equal(ajandaTekilAnahtari(o.girdi), o.anahtar, o.ad);
  }
  // Bütün v2 tekil anahtar vektörleri değişmedi (bölge alanı `undefined` iken de).
  for (const o of kurallar2.tekil_anahtar) {
    assert.equal(ajandaTekilAnahtari(o.girdi), o.anahtar, o.ad);
    assert.equal(ajandaTekilAnahtari({ ...o.girdi, bolge: undefined }), o.anahtar, o.ad);
  }
  const a = (ad: string) => v3.tekil_anahtar.find((o) => o.ad === ad)!.anahtar;
  assert.equal(a("bölgeli"), a("bölge yazılışı farklı, aynı yer"));
  assert.notEqual(a("bölgeli"), a("başka bölge"));
  assert.notEqual(a("bölge ve gün"), a("bölgesiz gün"));
});

test("bölge konumu kuralı vektörü: ajandaDegisikligiUygula; sonuç geçerli kayıt, girdi değişmez", () => {
  assert.ok(v3.bolge_konumu.length >= 12);
  for (const o of v3.bolge_konumu) {
    const kayit = AjandaKaydi.parse(o.kayit);
    const once = JSON.stringify(kayit);
    const s = ajandaDegisikligiUygula(kayit, o.degisiklik, o.yazar);
    const { uygulanan, korunan, elle_alanlar, kaldirilan, ...degerler } = o.beklenen;
    assert.deepEqual(s.uygulanan, uygulanan, o.ad);
    assert.deepEqual(s.korunan, korunan, o.ad);
    assert.deepEqual(s.kayit.elle_alanlar, elle_alanlar, o.ad);
    for (const alan of kaldirilan ?? []) assert.equal(alan in s.kayit, false, `${o.ad}: ${alan}`);
    for (const [alan, deger] of Object.entries(degerler)) assert.deepEqual((s.kayit as Record<string, unknown>)[alan], deger, `${o.ad}: ${alan}`);
    assert.equal(JSON.stringify(kayit), once, `${o.ad}: girdi`);
    const sema = AjandaKaydi.safeParse(s.kayit);
    assert.equal(sema.success, true, `${o.ad}: geçerli kayıt`);
  }
});

test("bölge kaldırılıp varış bırakılırsa sonuç tutarsız kayıttır (varış kendiliğinden kalkmaz)", () => {
  const o = v3.bolge_konumu.find((x) => x.ad === "varış bölgeyle kalmaz ama kendiliğinden kalkmaz")!;
  const kayit = AjandaKaydi.parse(o.kayit);
  const s = ajandaDegisikligiUygula(kayit, { bolge: null }, { yol: "elle", tur_kokeni: "insan" });
  assert.deepEqual(s.uygulanan, ["bolge", "bolge_konumu"]);
  assert.equal(AjandaKaydi.safeParse(s.kayit).success, false);
  const iki = ajandaDegisikligiUygula(kayit, { bolge: null, varis: null }, { yol: "elle", tur_kokeni: "insan" });
  assert.deepEqual(iki.uygulanan, ["bolge", "bolge_konumu", "varis"]);
  assert.equal(AjandaKaydi.safeParse(iki.kayit).success, true);
});

test("yetenek kesişimi vektörü ve biçimi", () => {
  for (const o of v3.yetenek_kesisimi) {
    const k = ajandaYetenekKesisimi(o.istenen ?? undefined, o.sunulan);
    assert.deepEqual(k, o.kesisim, o.ad);
    assert.equal(AjandaYetenekler.safeParse(k).success, true, `${o.ad}: welcome'a yazılabilir`);
  }
  for (const ad of ["ek_yedegi", "a1", "a".repeat(32)]) assert.match(ad, YETENEK_DESENI);
  for (const ad of ["a", "1a", "A", "ek-yedegi", "a".repeat(33), ""]) assert.doesNotMatch(ad, YETENEK_DESENI);
});

test("aşağı uyarlama vektörü: girdi v3 şemasından geçer, çıktı alan sırasıyla birebir ve v2 şemasından geçer", () => {
  assert.ok(v3.asagi_uyarlama.length >= 10);
  for (const o of v3.asagi_uyarlama) {
    assert.equal(ajandaAsagiCoz(JSON.stringify(o.girdi), 3).ok, true, `${o.ad}: girdi v3`);
    const s = ajandaAsagiSurume(o.girdi as AjandaAsagi, o.surum);
    if (o.cikti === null) {
      assert.deepEqual(s, { ok: false, kod: "protokol_uyumsuz", yollar: ["type"] }, o.ad);
      continue;
    }
    assert.equal(s.ok, true, o.ad);
    assert.equal(JSON.stringify(s.ok && s.mesaj), JSON.stringify(o.cikti), `${o.ad}: baytlar`);
    assert.equal(ajandaAsagiCoz(JSON.stringify(o.cikti), o.surum).ok, true, `${o.ad}: v2 şeması`);
  }
});

test("base64: kanonik biçim ve bayt sayısı", () => {
  for (const [metin, bayt] of [
    ["QQ==", 1],
    ["QUI=", 2],
    ["QUJD", 3],
    ["QUJDRA==", 4],
  ] as const) {
    assert.equal(kanonikBase64Mi(metin), true, metin);
    assert.equal(ajandaBase64Bayti(metin), bayt, metin);
    assert.equal(Buffer.from(metin, "base64").length, bayt, metin);
    assert.equal(Buffer.from(metin, "base64").toString("base64"), metin, metin);
  }
  for (const metin of ["", "Q", "QQ", "QQ=", "QR==", "QUJ=", "====", "A===", "QQ==QQ==", "-_-_", "QU JD", "QUJD\n"]) {
    assert.equal(kanonikBase64Mi(metin), false, JSON.stringify(metin));
  }
  const tam = Buffer.alloc(AJANDA_SINIRLARI.EK_PARCA, 0xab).toString("base64");
  assert.equal(kanonikBase64Mi(tam), true);
  assert.equal(ajandaBase64Bayti(tam), AJANDA_SINIRLARI.EK_PARCA);
  // Sınırda: tam EK_PARCA son bayta kadar geçerli (vektörde yalnız bir bayt fazlası var, dosya küçük kalsın).
  const parca = (ofset: number, veri: string) => JSON.stringify({ v: 3, type: "ek_parca", ek_id: "ek_01", ofset, veri });
  assert.equal(ajandaAsagiCoz(parca(AJANDA_SINIRLARI.EK_BAYT - AJANDA_SINIRLARI.EK_PARCA, tam), 3).ok, true);
  assert.equal(ajandaYukariCoz(parca(AJANDA_SINIRLARI.EK_BAYT - AJANDA_SINIRLARI.EK_PARCA + 1, tam), 3).ok, false);
});
