import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { planHash } from "@eren/protocol";
import type { Plan } from "@eren/protocol";
import type { IsNo, JetonKapsami, LimitKilitDurumu, TuketimKaydi } from "../src/sozlesme.ts";
import { akisKur } from "../src/akis.ts";
import { ayarKur } from "../src/ayar.ts";
import { depoKur } from "../src/depo.ts";
import { islerKur } from "../src/isler.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import { sahteDunya } from "./sahte.ts";

// Sözleşme: sozlesme-tuketim.md, "İş (`isler.ts` `partiIsle`)" ve ST4. Her `result` için tüketim satırları
// `depo.tuketimEkle` ile, `out_ofset` güncellemesiyle aynı `depo.islem` içinde: tam bir kez.
// Depo gerçek (geçici dosya): işlem bütünlüğü ve yeniden başlatma gerçekten sınanır.

const kok = mkdtempSync(join(tmpdir(), "eren-isler-tuketim-test-"));
const kapanacaklar: Array<() => void> = [];
after(() => {
  for (const k of kapanacaklar.splice(0)) {
    try {
      k();
    } catch {
      // zaten kapalı
    }
  }
  rmSync(kok, { recursive: true, force: true });
});
let sayac = 0;

const T0 = 1_700_000_000_000;
const YEREL = "C:\\ornek\\Yerel";
const CLAUDE_EXE = "C:\\ornek\\bin\\claude.exe";
const YEREL_AYAR = "C:\\ornek\\Yerel\\eren-kit\\ayar.local.json";
const ANA = "ana";
const INIT_MODELI = "claude-ornek";

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(r));
};
const satir = (o: unknown): string => JSON.stringify(o) + "\n";

const pcPlan = (no = 1): Plan =>
  ({
    plan_id: `plan_pc${no}`,
    baslik: "Ornek is",
    tur: "pc",
    cwd: "C:\\ornek\\proje",
    gorev_metni: "Ornek gorev.",
    kesin_yapilacaklar: ["Bir sey yap"],
    kesin_yapilmayacaklar: ["Yasak"],
  }) as Plan;

const telPlan = (no = 1): Plan =>
  ({
    plan_id: `plan_tel${no}`,
    baslik: "Telefon isi",
    tur: "telefon",
    cwd: "",
    gorev_metni: "Telefonda oku.",
    kesin_yapilacaklar: ["Ekrani oku"],
    kesin_yapilmayacaklar: ["Yazma"],
    telefon_izin_istegi: { uygulamalar: ["com.ornek.uygulama"], mod: "oku" },
  }) as Plan;

async function kur() {
  const d = sahteDunya({ baslangicMs: T0, servisPid: 4000 });
  d.dosya.yaz(CLAUDE_EXE, "");
  d.dosya.yaz(YEREL_AYAR, JSON.stringify({ kullanici_adi: "Deneme", claude_exe: CLAUDE_EXE }));
  const ayar = await ayarKur({
    dosya: d.dosya,
    ortam: { LOCALAPPDATA: YEREL, USERPROFILE: "C:\\ornek\\Kullanici", PATH: "C:\\ornek\\bin" },
    execPath: "C:\\ornek\\node.exe",
    baslangicMs: T0,
  });
  const gunluk = d.gunluk;
  const veriyolu = veriyoluKur({ gunluk });
  const yol = join(kok, `vt-${++sayac}.db`);
  const depo = depoKur({ yol, saat: d.saat, veriyolu, gunluk });
  kapanacaklar.push(() => h.isler.kapat(), () => depo.kapat());
  const akis = akisKur();
  const kilit = {
    durum: (): LimitKilitDurumu => ({ tur: "serbest" }),
    baslatmaSerbestMi: (): boolean => true,
  };
  let jetonNo = 0;
  const kopru = {
    jetonUret: (kapsam: JetonKapsami): string => `jeton-${kapsam.rol}-${++jetonNo}-`.padEnd(48, "x"),
    jetonlariIptalEt: (_k: JetonKapsami): void => {},
  };
  const yeniIsler = () =>
    islerKur({
      ayar,
      depo,
      kilit,
      kopru,
      akis,
      surec: d.surec,
      dosya: d.dosya,
      sistem: d.sistem,
      saat: d.saat,
      zamanlayici: d.zamanlayici,
      rastgele: d.rastgele,
      veriyolu,
      gunluk,
    });

  const h = {
    d,
    depo,
    yol,
    isler: yeniIsler(),
    yokla: async (ms = 2000): Promise<void> => {
      await bosalt();
      d.zaman.ilerlet(ms);
      await bosalt();
    },
    outEkle: (id: IsNo, ...parcalar: string[]): void => {
      d.dosya.ekle(ayar.isYollari(id).out, parcalar.join(""));
    },
    surecOf: (id: IsNo) => {
      const pid = depo.isGetir(id)?.pid;
      const s = d.surec.ayriklar().find((x) => x.pid === pid);
      if (!s) throw new Error("sahte süreç yok");
      return s;
    },
    baslat: async (plan: Plan): Promise<IsNo> => {
      depo.planEkle({
        plan,
        plan_hash: planHash(plan),
        durum: "onaylandi",
        profil: "tam",
        is_id: null,
        olusturma_ms: d.zaman.simdi(),
        sohbet_id: ANA,
      });
      const r = await h.isler.baslat({ plan, plan_hash: planHash(plan), profil: "tam", sohbet_id: ANA });
      assert.ok(r.ok, `baslat başarısız: ${JSON.stringify(r)}`);
      return r.deger;
    },
    initSatiri: (id: IsNo, sunucular: string[]): string =>
      satir({
        type: "system",
        subtype: "init",
        session_id: depo.isGetir(id)?.session_id,
        tools: [],
        mcp_servers: sunucular.map((name) => ({ name, status: "connected" })),
        apiKeySource: "none",
        model: INIT_MODELI,
      }),
    /** Servis yeniden başlar: eski modül kapanır, yeni modül aynı depo ve dosyayla kurulup uzlaştırır. */
    yenidenBaslat: async (): Promise<void> => {
      h.isler.kapat();
      h.isler = yeniIsler();
      await h.isler.uzlastir();
      await bosalt();
    },
    /** Ham tüketim satırları (`id` sırasıyla), ayrı bağlantıdan. */
    satirlar: (): Array<Record<string, unknown>> => {
      const ham = new DatabaseSync(h.yol);
      try {
        return (ham.prepare("SELECT * FROM tuketim ORDER BY id").all() as Array<Record<string, unknown>>).map((r) => ({
          ...r,
        }));
      } finally {
        ham.close();
      }
    },
  };
  return h;
}

type H = Awaited<ReturnType<typeof kur>>;

// --- Uydurma akış: beş result ------------------------------------------------------------------
// Maliyetler ikili kesirde tam: toplam karşılaştırması birebir.

const OPUS = "claude-opus-ornek";
const HAIKU = "claude-haiku-ornek";

const mu = (girdi: number, cikti: number, okuma: number, yazma: number, maliyet: number) => ({
  inputTokens: girdi,
  outputTokens: cikti,
  cacheReadInputTokens: okuma,
  cacheCreationInputTokens: yazma,
  webSearchRequests: 0,
  costUSD: maliyet,
  contextWindow: 200_000,
});
const usage = (girdi: number, yazma: number, okuma: number, cikti: number) => ({
  input_tokens: girdi,
  cache_creation_input_tokens: yazma,
  cache_read_input_tokens: okuma,
  output_tokens: cikti,
});

const resultSatiri = (h: H, id: IsNo, ek: Record<string, unknown>): string =>
  satir({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Tamam.",
    terminal_reason: "completed",
    session_id: h.depo.isGetir(id)?.session_id,
    total_cost_usd: 99,
    modelUsage: { [OPUS]: mu(9999, 9999, 9999, 9999, 99) },
    ...ek,
  });

/** R1 iki modelli, R2 tek modelli, R3 `{}` (toplu yayın), R4 fark alanı yok (`usage` yedeği), R5 tek modelli. */
const sonuclar = (h: H, id: IsNo): string[] => [
  resultSatiri(h, id, {
    usage: usage(1, 2, 3, 4),
    model_usage_since_last_result: { [OPUS]: mu(100, 200, 3000, 400, 0.5), [HAIKU]: mu(10, 20, 30, 40, 0.015625) },
  }),
  resultSatiri(h, id, { usage: usage(1, 1, 1, 1), model_usage_since_last_result: { [OPUS]: mu(5, 6, 7, 8, 0.25) } }),
  resultSatiri(h, id, { usage: usage(50, 60, 70, 80), model_usage_since_last_result: {} }),
  resultSatiri(h, id, { usage: usage(11, 12, 13, 14) }),
  resultSatiri(h, id, { usage: usage(2, 2, 2, 2), model_usage_since_last_result: { [OPUS]: mu(1, 2, 3, 4, 0.125) } }),
];

type Beklenen = Omit<TuketimKaydi, "ts_ms">;

/** Beş sonucun beklenen satırları, sırasıyla. `anaModel`: R4'ün (`ana_usage`) modeli. */
const beklenenSatirlar = (id: IsNo, anaModel: string): Beklenen[] => {
  const ortak = { kaynak: "is" as const, sohbet_id: ANA, is_id: id, turn_id: null, nesil: null, rol: null };
  const fark = (model: string, girdi: number, yazma: number, okuma: number, cikti: number, maliyet: number): Beklenen => ({
    ...ortak,
    model,
    girdi,
    cache_yazma: yazma,
    cache_okuma: okuma,
    cikti,
    maliyet_usd: maliyet,
    olcum: "model_farki",
  });
  return [
    fark(OPUS, 100, 400, 3000, 200, 0.5),
    fark(HAIKU, 10, 40, 30, 20, 0.015625),
    fark(OPUS, 5, 8, 7, 6, 0.25),
    {
      ...ortak,
      model: anaModel,
      girdi: 11,
      cache_yazma: 12,
      cache_okuma: 13,
      cikti: 14,
      maliyet_usd: null,
      olcum: "ana_usage",
    },
    fark(OPUS, 1, 4, 3, 2, 0.125),
  ];
};

const BEKLENEN_TOPLAM = {
  girdi: 100 + 10 + 5 + 11 + 1,
  cache_yazma: 400 + 40 + 8 + 12 + 4,
  cache_okuma: 3000 + 30 + 7 + 13 + 3,
  cikti: 200 + 20 + 6 + 14 + 2,
  maliyet_usd: 0.5 + 0.015625 + 0.25 + 0.125,
};

/** Ham satırlar beklenenle birebir (`id`, `ts_ms` hariç); `ts_ms` sayı. Toplamlar özetten de birebir. */
const satirlarDogrula = (h: H, id: IsNo, anaModel: string): void => {
  const ham = h.satirlar();
  for (const r of ham) assert.equal(typeof r["ts_ms"], "number");
  const sade = ham.map(({ id: _id, ts_ms: _ts, ...geri }) => geri);
  assert.deepEqual(sade, beklenenSatirlar(id, anaModel));

  const ozet = h.depo.tuketimOzeti({ gunBaslangicMs: 0, yediGunBaslangicMs: 0, isAdet: 10 });
  const isToplam = ozet.isler.find((i) => i.is_id === id)?.toplam;
  assert.ok(isToplam !== undefined, "özette iş yok");
  const { sonuc_adet: _adet, ...toplam } = isToplam;
  assert.deepEqual(toplam, BEKLENEN_TOPLAM);
  const { sonuc_adet: _a2, ...tumIs } = ozet.son_7_gun.is;
  assert.deepEqual(tumIs, BEKLENEN_TOPLAM);
  assert.equal(ozet.son_7_gun.sohbet.girdi, 0, "iş tüketimi sohbet kaynağına yazılmaz");
};

// -----------------------------------------------------------------------------------------------

describe("isler tüketim: beş sonuçlu akış tam bir kez (ST4)", () => {
  it("tek partide: beklenen satır kümesi bir kez, toplamlar birebir; R3 `{}` satır üretmez", async () => {
    const h = await kur();
    const id = await h.baslat(pcPlan());
    h.outEkle(id, h.initSatiri(id, ["eren-soru"]), ...sonuclar(h, id));
    await h.yokla();
    satirlarDogrula(h, id, INIT_MODELI);
    // Sonraki yoklamalar ve doğal çıkış yeniden saymaz.
    await h.yokla();
    h.surecOf(id).cik(0);
    await h.yokla();
    await h.yokla();
    assert.notEqual(h.depo.isGetir(id)?.durum, "calisiyor", "iş bitti");
    satirlarDogrula(h, id, INIT_MODELI);
  });

  it("tek partide: sonuçların ts_ms'i ayrık ve artan, bir sonucun model satırları aynı ts_ms'te; sonuc_adet 4", async () => {
    const h = await kur();
    const id = await h.baslat(pcPlan());
    h.outEkle(id, h.initSatiri(id, ["eren-soru"]), ...sonuclar(h, id));
    await h.yokla();
    const ts = h.satirlar().map((r) => r["ts_ms"] as number);
    assert.equal(ts.length, 5);
    // Satır sırası: R1 (iki model), R2, R4, R5.
    assert.equal(ts[0], ts[1], "iki modelli sonucun satırları aynı ts_ms'te");
    const sonucTs = [ts[0]!, ts[2]!, ts[3]!, ts[4]!];
    for (let i = 1; i < sonucTs.length; i++) {
      assert.ok(sonucTs[i]! > sonucTs[i - 1]!, `ts_ms kesin artan değil: ${JSON.stringify(sonucTs)}`);
    }
    const ozet = h.depo.tuketimOzeti({ gunBaslangicMs: 0, yediGunBaslangicMs: 0, isAdet: 10 });
    assert.equal(ozet.isler.find((i) => i.is_id === id)?.toplam.sonuc_adet, 4, "`{}` sonuç sayılmaz");
  });

  it("iki partide: sonuç aynı", async () => {
    const h = await kur();
    const id = await h.baslat(pcPlan());
    const r = sonuclar(h, id);
    h.outEkle(id, h.initSatiri(id, ["eren-soru"]), r[0]!, r[1]!);
    await h.yokla();
    assert.equal(h.satirlar().length, 3, "ilk parti: R1 iki satır + R2 bir satır");
    h.outEkle(id, r[2]!, r[3]!, r[4]!);
    await h.yokla();
    h.surecOf(id).cik(0);
    await h.yokla();
    satirlarDogrula(h, id, INIT_MODELI);
  });

  it("yarım satır sayılmaz; tamamlanınca bir kez sayılır", async () => {
    const h = await kur();
    const id = await h.baslat(pcPlan());
    const r = sonuclar(h, id);
    h.outEkle(id, h.initSatiri(id, ["eren-soru"]), r[0]!, r[1]!, r[2]!, r[3]!, r[4]!.slice(0, 30));
    await h.yokla();
    assert.equal(h.satirlar().length, 4);
    h.outEkle(id, r[4]!.slice(30));
    await h.yokla();
    satirlarDogrula(h, id, INIT_MODELI);
  });
});

describe("isler tüketim: yeniden başlatma çift saymaz (ST4)", () => {
  it("ilk parti işlendi, servis yeniden başladı, akış kalan yerden sürdü: hiçbiri iki kez, hiçbiri atlanmaz", async () => {
    const h = await kur();
    const id = await h.baslat(pcPlan());
    const r = sonuclar(h, id);
    h.outEkle(id, h.initSatiri(id, ["eren-soru"]), r[0]!, r[1]!);
    await h.yokla();
    assert.equal(h.satirlar().length, 3);
    const ofset = h.depo.isGetir(id)!.out_ofset;

    // Servis kapalıyken süreç yazmayı sürdürdü (R3); yeni modül kayıtlı ofsetten okur.
    h.outEkle(id, r[2]!);
    await h.yenidenBaslat();
    assert.ok(h.depo.isGetir(id)!.out_ofset > ofset, "uzlaştırma kalan satırı okudu");
    assert.equal(h.satirlar().length, 3, "R3 `{}` satır üretmez, ilk parti yeniden sayılmaz");

    h.outEkle(id, r[3]!, r[4]!);
    await h.yokla();
    h.surecOf(id).cik(0);
    await h.yokla();
    // Yeni modül init'i görmedi (ofsetin gerisinde): `ana_usage` modeli "bilinmiyor" (sözleşme: model null).
    satirlarDogrula(h, id, "bilinmiyor");
  });

  it("tuketimEkle işlem içinde atarsa ofset de yazılmaz; yeniden başlayan servis o partiyi bir kez sayar", async () => {
    const h = await kur();
    const id = await h.baslat(pcPlan());
    const r = sonuclar(h, id);
    h.outEkle(id, h.initSatiri(id, ["eren-soru"]), r[0]!, r[1]!);
    await h.yokla();
    const ofset = h.depo.isGetir(id)!.out_ofset;

    // Satırları gerçekten yazıp sonra atan sarmalayıcı: işlem geri alınmalı (satırlar da ofset de).
    const gercek = h.depo.tuketimEkle.bind(h.depo);
    let atti = 0;
    (h.depo as { tuketimEkle: unknown }).tuketimEkle = (k: readonly TuketimKaydi[]): void => {
      gercek(k);
      if (k.length > 0 && atti === 0) {
        atti++;
        throw new Error("yazma sonrası çöküş");
      }
    };
    h.outEkle(id, r[2]!, r[3]!, r[4]!);
    await h.yokla();
    assert.equal(atti, 1, "sarmalayıcı devreye girdi");
    assert.equal(h.depo.isGetir(id)!.out_ofset, ofset, "ofset ilerlemedi");
    assert.equal(h.satirlar().length, 3, "atılan partinin satırları geri alındı");

    (h.depo as { tuketimEkle: unknown }).tuketimEkle = gercek;
    await h.yenidenBaslat();
    h.surecOf(id).cik(0);
    await h.yokla();
    satirlarDogrula(h, id, "bilinmiyor");
  });
});

describe("isler tüketim: sonuçsuz iş ve telefon işi", () => {
  it("result içermeyen akış (öldürülen iş) tüketim satırı üretmez", async () => {
    const h = await kur();
    const id = await h.baslat(pcPlan());
    h.outEkle(
      id,
      h.initSatiri(id, ["eren-soru"]),
      satir({
        type: "assistant",
        session_id: h.depo.isGetir(id)?.session_id,
        message: { id: "m1", model: INIT_MODELI, role: "assistant", usage: usage(100, 200, 300, 400), content: [] },
      }),
    );
    await h.yokla();
    const r = await h.isler.durdur(id, "kullanici");
    assert.ok(r.ok);
    await h.yokla();
    assert.notEqual(h.depo.isGetir(id)?.durum, "calisiyor");
    assert.equal(h.satirlar().length, 0);
  });

  it("telefon işinin sonuçları da işin kimliği ve sohbetiyle kaydedilir", async () => {
    const h = await kur();
    const id = await h.baslat(telPlan());
    assert.equal(h.depo.isGetir(id)?.tur, "telefon");
    h.outEkle(id, h.initSatiri(id, ["eren-telefon", "eren-soru"]), ...sonuclar(h, id));
    await h.yokla();
    h.surecOf(id).cik(0);
    await h.yokla();
    satirlarDogrula(h, id, INIT_MODELI);
  });

  it("iki işin tüketimi birbirine karışmaz", async () => {
    const h = await kur();
    const a = await h.baslat(pcPlan(1));
    const b = await h.baslat(pcPlan(2));
    h.outEkle(a, h.initSatiri(a, ["eren-soru"]), ...sonuclar(h, a));
    h.outEkle(b, h.initSatiri(b, ["eren-soru"]), sonuclar(h, b)[1]!);
    await h.yokla();
    const ham = h.satirlar();
    assert.equal(ham.filter((r) => r["is_id"] === a).length, 5);
    assert.deepEqual(
      ham.filter((r) => r["is_id"] === b).map(({ id: _i, ts_ms: _t, ...g }) => g),
      [beklenenSatirlar(b, INIT_MODELI)[2]],
    );
  });
});
