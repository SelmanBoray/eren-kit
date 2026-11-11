import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ANA_SOHBET_ID, SOHBET_SINIRLARI, SOHBET_SURUMU, SohbetAsagi, UsageReport } from "@eren/protocol";
import type { SohbetId } from "@eren/protocol";
import { depoKur } from "../src/depo.ts";
import type { Depo, TuketimKaydi, TuketimOzeti } from "../src/sozlesme.ts";
import { sahteGunluk, sahteZaman } from "./sahte.ts";

// Sözleşme: sozlesme-tuketim.md (ek göç 4, `tuketim` tablosu, `tuketimEkle`, `tuketimOzeti`).

const kok = mkdtempSync(join(tmpdir(), "eren-depo-tuketim-test-"));
after(() => rmSync(kok, { recursive: true, force: true }));
let sayac = 0;
const yeniYol = (): string => join(kok, `vt-${++sayac}.db`);

const acilanlar: Depo[] = [];
afterEach(() => {
  for (const d of acilanlar.splice(0)) {
    try {
      d.kapat();
    } catch {
      // zaten kapalı
    }
  }
});
const kur = (yol = ":memory:"): Depo => {
  const zaman = sahteZaman();
  const depo = depoKur({ yol, saat: zaman.saat, gunluk: sahteGunluk() });
  acilanlar.push(depo);
  return depo;
};
const hamAc = <T>(yol: string, f: (ham: DatabaseSync) => T): T => {
  const ham = new DatabaseSync(yol);
  try {
    return f(ham);
  } finally {
    ham.close();
  }
};
const say = (yol: string, tablo: string): number =>
  hamAc(yol, (h) => (h.prepare(`SELECT COUNT(*) AS n FROM ${tablo}`).get() as { n: number }).n);
const tabloVar = (yol: string, ad: string): boolean =>
  hamAc(yol, (h) => h.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(ad) !== undefined);

const B_ID: SohbetId = "sohbet-b";
const C_ID: SohbetId = "sohbet-c";
const GUN = 1_000_000_000;
const YEDI = GUN - 6 * 86_400_000;

const sohbetKaydi = (ts_ms: number, ek: Partial<TuketimKaydi> = {}): TuketimKaydi => ({
  ts_ms,
  kaynak: "sohbet",
  sohbet_id: ANA_SOHBET_ID,
  is_id: null,
  turn_id: "tur1",
  nesil: 1,
  rol: "normal",
  model: "m1",
  girdi: 1,
  cache_yazma: 2,
  cache_okuma: 4,
  cikti: 8,
  maliyet_usd: null,
  olcum: "model_farki",
  ...ek,
});
const isKaydi = (ts_ms: number, is_id: number, ek: Partial<TuketimKaydi> = {}): TuketimKaydi =>
  sohbetKaydi(ts_ms, { kaynak: "is", is_id, turn_id: null, nesil: null, rol: null, ...ek });

const ozet = (d: Depo, isAdet = 50): TuketimOzeti =>
  d.tuketimOzeti({ gunBaslangicMs: GUN, yediGunBaslangicMs: YEDI, isAdet });
const bos = { girdi: 0, cache_yazma: 0, cache_okuma: 0, cikti: 0, sonuc_adet: 0 };

const sohbetEkle = (d: Depo, id: SohbetId): void =>
  d.sohbetEkle({ sohbet_id: id, ad: id, olusturma_ms: 1, son_etkinlik_ms: 1 });

const planEkle = (d: Depo, plan_id: string): void =>
  d.planEkle({
    plan: {
      plan_id,
      baslik: "b",
      tur: "pc",
      cwd: "C:\\ornek",
      gorev_metni: "g",
      mcp_profili: "rea",
    },
    plan_hash: "a".repeat(64),
    durum: "bekliyor",
    is_id: null,
    olusturma_ms: 1000,
    profil: "tam",
    sohbet_id: ANA_SOHBET_ID,
  });

const isEkle = (d: Depo, plan_id: string): number => {
  planEkle(d, plan_id);
  return d.isEkle({
    sohbet_id: ANA_SOHBET_ID,
    plan_id,
    plan_hash: "a".repeat(64),
    baslik: "b",
    tur: "pc",
    cwd: "C:\\ornek",
    durum: "calisiyor",
    kirli: false,
    session_id: "11111111-1111-4111-8111-111111111111",
    pid: null,
    olusturma_ms: null,
    baslangic_ms: 5000,
    bitis_ms: null,
    out_ofset: 0,
    rapor: null,
    rapor_kaynak: null,
    son_result: null,
    durdurma: null,
  });
};

describe("depo tüketim: şema", () => {
  it("boş dosyada tuketim tablosu ve ek_surum 5; yeniden açılışta göç yinelenmez", () => {
    const yol = yeniYol();
    const a = kur(yol);
    assert.equal(a.semaBilgisi().ek_surum, 5);
    a.tuketimEkle([sohbetKaydi(GUN)]);
    a.kapat();
    assert.equal(tabloVar(yol, "tuketim"), true);
    const b = kur(yol);
    assert.equal(b.semaBilgisi().ek_surum, 5);
    assert.equal(say(yol, "sema_ek"), 1);
    assert.equal(say(yol, "tuketim"), 1, "ikinci açılış tabloyu sıfırlamaz");
    assert.equal(ozet(b).bugun.sohbet.sonuc_adet, 1);
  });

  it("bellek veritabanında tablo var (tuketimEkle ve özet çalışır)", () => {
    const d = kur();
    d.tuketimEkle([sohbetKaydi(GUN)]);
    assert.equal(ozet(d).bugun.sohbet.sonuc_adet, 1);
  });

  it("ek sürüm 3'ten göç edilen dosyada tablo var, eski satırlar durur, ek_surum 5, ikinci açılışta yeniden çalışmaz", () => {
    const yol = yeniYol();
    const a = kur(yol);
    planEkle(a, "p1");
    a.kapat();
    hamAc(yol, (h) => {
      h.exec("DROP TABLE tuketim");
      h.exec("UPDATE sema_ek SET deger = 3 WHERE anahtar = 'ek_surum'");
    });
    assert.equal(tabloVar(yol, "tuketim"), false);
    const b = kur(yol);
    assert.equal(tabloVar(yol, "tuketim"), true);
    assert.equal(b.semaBilgisi().ek_surum, 5);
    assert.notEqual(b.planGetir("p1"), null, "eski veri korunur");
    b.tuketimEkle([sohbetKaydi(GUN)]);
    b.kapat();
    const c = kur(yol);
    assert.equal(c.semaBilgisi().ek_surum, 5);
    assert.equal(say(yol, "tuketim"), 1, "göç yinelenmedi, satır durur");
    assert.equal(say(yol, "sema_ek"), 1);
  });
});

describe("depo tüketim: tuketimEkle", () => {
  it("boş liste sessiz", () => {
    const d = kur();
    d.tuketimEkle([]);
    assert.deepEqual(ozet(d).bugun, { sohbet: bos, is: bos });
  });

  it("eklenen satırlar özet toplamlarına girer", () => {
    const d = kur();
    d.tuketimEkle([sohbetKaydi(GUN), sohbetKaydi(GUN + 5, { model: "m2" })]);
    assert.equal(ozet(d).bugun.sohbet.sonuc_adet, 2);
  });

  it("depo.islem içinde çağrılıp işlem geri alınırsa satır kalmaz; tamamlanırsa kalır", () => {
    const yol = yeniYol();
    const d = kur(yol);
    assert.throws(() =>
      d.islem(() => {
        d.tuketimEkle([sohbetKaydi(GUN), sohbetKaydi(GUN)]);
        throw new Error("geri al");
      }),
    );
    assert.equal(say(yol, "tuketim"), 0);
    assert.deepEqual(ozet(d).bugun, { sohbet: bos, is: bos });
    d.islem(() => d.tuketimEkle([sohbetKaydi(GUN)]));
    assert.equal(say(yol, "tuketim"), 1);
  });
});

describe("depo tüketim: tuketimOzeti toplamlar", () => {
  it("bugun ve son_7_gun sınırları: sınırın tam üstü girer, 1 ms altı girmez", () => {
    const d = kur();
    d.tuketimEkle([
      sohbetKaydi(GUN), // bugün + 7 gün
      sohbetKaydi(GUN - 1), // yalnız 7 gün
      sohbetKaydi(YEDI), // 7 gün (sınırın tam üstü)
      sohbetKaydi(YEDI - 1), // hiçbiri
    ]);
    const o = ozet(d);
    assert.equal(o.bugun.sohbet.sonuc_adet, 1);
    assert.equal(o.son_7_gun.sohbet.sonuc_adet, 3);
  });

  it("sohbet/is ayrımı ve dört sayaç toplamı", () => {
    const d = kur();
    d.tuketimEkle([
      sohbetKaydi(GUN, { girdi: 1, cache_yazma: 2, cache_okuma: 3, cikti: 4 }),
      sohbetKaydi(GUN + 1, { girdi: 10, cache_yazma: 20, cache_okuma: 30, cikti: 40, model: "m2" }),
      isKaydi(GUN + 2, 7, { girdi: 100, cache_yazma: 200, cache_okuma: 300, cikti: 400 }),
    ]);
    const o = ozet(d);
    assert.deepEqual(o.bugun.sohbet, { girdi: 11, cache_yazma: 22, cache_okuma: 33, cikti: 44, sonuc_adet: 2 });
    assert.deepEqual(o.bugun.is, { girdi: 100, cache_yazma: 200, cache_okuma: 300, cikti: 400, sonuc_adet: 1 });
    assert.deepEqual(o.son_7_gun.sohbet, o.bugun.sohbet);
    assert.deepEqual(o.son_7_gun.is, o.bugun.is);
  });

  it("maliyet_usd yalnız en az bir satırda maliyet varsa var; hiç yoksa alan yok", () => {
    const d = kur();
    d.tuketimEkle([sohbetKaydi(GUN), isKaydi(GUN, 1)]);
    let o = ozet(d);
    assert.equal("maliyet_usd" in o.bugun.sohbet, false);
    assert.equal("maliyet_usd" in o.bugun.is, false);
    assert.equal("maliyet_usd" in o.son_7_gun.sohbet, false);
    d.tuketimEkle([sohbetKaydi(GUN + 1, { maliyet_usd: 0.25 }), sohbetKaydi(GUN + 2, { maliyet_usd: 0.5 })]);
    o = ozet(d);
    assert.equal(o.bugun.sohbet.maliyet_usd, 0.75);
    assert.equal(o.bugun.sohbet.sonuc_adet, 3);
    assert.equal("maliyet_usd" in o.bugun.is, false, "iş tarafında maliyet yok");
  });

  it("sonuc_adet: aynı sonucun model satırları tek sonuç, farklı sonuçlar ayrı sayılır", () => {
    const d = kur();
    d.tuketimEkle([sohbetKaydi(GUN, { model: "m1", girdi: 1 }), sohbetKaydi(GUN, { model: "m2", girdi: 2 })]);
    let o = ozet(d);
    assert.equal(o.bugun.sohbet.sonuc_adet, 1);
    assert.equal(o.bugun.sohbet.girdi, 3);
    d.tuketimEkle([sohbetKaydi(GUN + 1, { turn_id: "tur2" })]);
    o = ozet(d);
    assert.equal(o.bugun.sohbet.sonuc_adet, 2);
  });

  it("sonuc_adet: ayrı sonuçlar (ayrı an) tek tek sayılır", () => {
    const d = kur();
    d.tuketimEkle(Array.from({ length: 5 }, (_, i) => sohbetKaydi(GUN + i)));
    assert.equal(ozet(d).bugun.sohbet.sonuc_adet, 5);
  });
});

describe("depo tüketim: sohbetler ve silinmiş birleşimi", () => {
  it("yalnız silinmemiş ve satırı olan sohbetler, tekil; işleri ayrık dahil; silinmiş alan yok", () => {
    const d = kur();
    sohbetEkle(d, B_ID);
    sohbetEkle(d, C_ID); // satırı yok: listede olmaz
    d.tuketimEkle([
      sohbetKaydi(GUN, { sohbet_id: B_ID }),
      sohbetKaydi(GUN + 1, { sohbet_id: B_ID, model: "m2" }),
      isKaydi(GUN + 2, 3, { sohbet_id: B_ID }),
      sohbetKaydi(YEDI - 100, { sohbet_id: ANA_SOHBET_ID }), // eski satır: tüm zaman toplamında
    ]);
    const o = ozet(d);
    const ids = o.sohbetler.map((s) => s.sohbet_id);
    assert.deepEqual([...ids].sort(), [ANA_SOHBET_ID, B_ID].sort());
    assert.equal(new Set(ids).size, ids.length);
    const b = o.sohbetler.find((s) => s.sohbet_id === B_ID)!;
    assert.equal(b.toplam.sohbet.sonuc_adet, 2);
    assert.equal(b.toplam.is.sonuc_adet, 1);
    const ana = o.sohbetler.find((s) => s.sohbet_id === ANA_SOHBET_ID)!;
    assert.equal(ana.toplam.sohbet.sonuc_adet, 1, "tüm zaman: 7 gün dışındaki satır da girer");
    assert.equal("silinmis_sohbetler" in o, false);
  });

  it("silinen sohbetin toplamı silinmis_sohbetler'e geçer, sohbetler'den çıkar; toplamlar durur", () => {
    const d = kur();
    sohbetEkle(d, B_ID);
    sohbetEkle(d, C_ID);
    d.tuketimEkle([
      sohbetKaydi(GUN, { sohbet_id: B_ID, girdi: 10 }),
      isKaydi(GUN, 2, { sohbet_id: B_ID, girdi: 20 }),
      sohbetKaydi(YEDI - 1, { sohbet_id: C_ID, girdi: 40 }),
      sohbetKaydi(GUN, { sohbet_id: ANA_SOHBET_ID, girdi: 1 }),
    ]);
    const once = ozet(d);
    d.sohbetiSil({ sohbet_id: B_ID }, GUN + 10);
    const o = ozet(d);
    assert.deepEqual(o.sohbetler.map((s) => s.sohbet_id).sort(), [ANA_SOHBET_ID, C_ID].sort());
    assert.ok(o.silinmis_sohbetler);
    assert.equal(o.silinmis_sohbetler.sohbet.girdi, 10);
    assert.equal(o.silinmis_sohbetler.sohbet.sonuc_adet, 1);
    assert.equal(o.silinmis_sohbetler.is.girdi, 20);
    assert.equal(o.silinmis_sohbetler.is.sonuc_adet, 1);
    assert.deepEqual(o.bugun, once.bugun, "bugün toplamı silmeyle değişmez");
    assert.deepEqual(o.son_7_gun, once.son_7_gun);
    // İkinci silinen: birleşim toplanır.
    d.sohbetiSil({ sohbet_id: C_ID }, GUN + 20);
    const o2 = ozet(d);
    assert.equal(o2.silinmis_sohbetler?.sohbet.girdi, 50);
    assert.equal(o2.silinmis_sohbetler?.sohbet.sonuc_adet, 2);
  });
});

describe("depo tüketim: isler", () => {
  it("en yeni isAdet iş, is_id kesin azalan; her iş kendi toplamıyla", () => {
    const d = kur();
    const idler = [1, 2, 3, 4, 5].map((n) => isEkle(d, `p${n}`));
    d.tuketimEkle([
      ...idler.map((id, i) => isKaydi(GUN + i, id, { girdi: id * 10 })),
      isKaydi(GUN + 9, idler[4] as number, { girdi: 1, model: "m2" }),
    ]);
    const o = ozet(d, 3);
    const sirali = [...idler].sort((a, b) => b - a);
    assert.deepEqual(
      o.isler.map((i) => i.is_id),
      sirali.slice(0, 3),
    );
    const enYeni = o.isler[0]!;
    assert.equal(enYeni.toplam.girdi, (idler[4] as number) * 10 + 1);
    assert.equal(enYeni.toplam.sonuc_adet, 2);
    const hepsi = ozet(d, 50).isler.map((i) => i.is_id);
    assert.deepEqual(hepsi, sirali);
    assert.ok(hepsi.every((id, i) => i === 0 || (hepsi[i - 1] as number) > id));
  });

  it("iş satırı yoksa isler boş; sohbet satırı işlere girmez", () => {
    const d = kur();
    d.tuketimEkle([sohbetKaydi(GUN)]);
    assert.deepEqual(ozet(d).isler, []);
  });
});

describe("depo tüketim: geçmiş temizleme ve sohbet silme tüketime dokunmaz", () => {
  it("gecmisiTemizle sonrası satırlar ve toplamlar durur", () => {
    const yol = yeniYol();
    const d = kur(yol);
    d.tuketimEkle([sohbetKaydi(GUN, { girdi: 5, maliyet_usd: 0.1 }), isKaydi(GUN, 1)]);
    const once = ozet(d);
    d.gecmisiTemizle({ sohbet_id: ANA_SOHBET_ID });
    assert.equal(say(yol, "tuketim"), 2);
    assert.deepEqual(ozet(d), once);
  });

  it("sohbetiSil sonrası satırlar durur", () => {
    const yol = yeniYol();
    const d = kur(yol);
    sohbetEkle(d, B_ID);
    d.tuketimEkle([sohbetKaydi(GUN, { sohbet_id: B_ID }), sohbetKaydi(GUN + 1, { sohbet_id: B_ID })]);
    d.sohbetiSil({ sohbet_id: B_ID }, GUN + 5);
    assert.equal(say(yol, "tuketim"), 2);
    assert.equal(ozet(d).bugun.sohbet.sonuc_adet, 2);
  });
});

describe("depo tüketim: tel şeması", () => {
  it("özetin tamamı, tel alanları eklenince UsageReport şemasından geçer (protokol çözücüsü)", () => {
    const d = kur();
    sohbetEkle(d, B_ID);
    sohbetEkle(d, C_ID);
    const i1 = isEkle(d, "p1");
    const i2 = isEkle(d, "p2");
    d.tuketimEkle([
      sohbetKaydi(GUN, { maliyet_usd: 0.125 }),
      sohbetKaydi(GUN - 5, { sohbet_id: B_ID, model: "bilinmiyor", olcum: "ana_usage", rol: null, turn_id: null }),
      sohbetKaydi(YEDI - 1, { sohbet_id: C_ID }),
      isKaydi(GUN, i1, { maliyet_usd: 1.5 }),
      isKaydi(GUN, i2),
    ]);
    d.sohbetiSil({ sohbet_id: C_ID }, GUN + 1);
    const o = ozet(d, SOHBET_SINIRLARI.TUKETIM_IS_ADET);
    assert.ok(o.silinmis_sohbetler);
    const tam = {
      v: SOHBET_SURUMU,
      type: "usage_report",
      istek_id: "istek1",
      olcum_ms: GUN + 100,
      gun_baslangic_ms: GUN,
      ...o,
    };
    assert.doesNotThrow(() => UsageReport.parse(tam));
    const cozulen = SohbetAsagi.parse(tam);
    assert.equal(cozulen.type, "usage_report");
  });

  it("boş veritabanının özeti de şemadan geçer (silinmis_sohbetler yok)", () => {
    const o = ozet(kur());
    assert.equal("silinmis_sohbetler" in o, false);
    UsageReport.parse({
      v: SOHBET_SURUMU,
      type: "usage_report",
      istek_id: "istek1",
      olcum_ms: GUN,
      gun_baslangic_ms: GUN,
      ...o,
    });
  });
});
