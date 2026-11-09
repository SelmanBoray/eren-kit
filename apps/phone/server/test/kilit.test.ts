import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { KilitBagimliliklari, LimitKilitDurumu, OlayGirdisi, ServisOlaylari } from "../src/sozlesme.ts";
import { kilitKur } from "../src/kilit.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import { sahteDosya, sahteGunluk, sahteZaman } from "./sahte.ts";

const YOL = "C:\\ornek\\ClaudeLimitKilit\\kilit.json";
const BASLANGIC = 1_700_000_000_000;
const SAAT = 3_600_000;

const gecerli = (ek: Record<string, unknown> = {}): Record<string, unknown> => ({
  surum: 1,
  esik: 95,
  yuzde: 97.5,
  sifirlanma: new Date(BASLANGIC + SAAT).toISOString(),
  kilitlendi: new Date(BASLANGIC - 1000).toISOString(),
  oturum: "oturum-1",
  acildi: null,
  ...ek,
});

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r));
};

const kur = () => {
  const zaman = sahteZaman(BASLANGIC);
  const dosya = sahteDosya();
  const gunluk = sahteGunluk();
  const veriyolu = veriyoluKur({ gunluk });
  const notlar: OlayGirdisi[] = [];
  const depo = {
    olayEkle: (g: OlayGirdisi) => {
      notlar.push(g);
      return { ...g, seq: notlar.length, ts_ms: zaman.simdi() } as never;
    },
  };
  const degisimler: LimitKilitDurumu[] = [];
  veriyolu.dinle("kilit_degisti", (v: ServisOlaylari["kilit_degisti"]) => degisimler.push(v.durum));
  const b = {
    ayar: { yollar: { limitKilit: YOL }, sureler: { kilitYoklamaMs: 5000 } },
    depo,
    dosya,
    saat: zaman.saat,
    zamanlayici: zaman.zamanlayici,
    veriyolu,
    gunluk,
  } as unknown as KilitBagimliliklari;
  const kilit = kilitKur(b);
  /** Zamanı ilerletir; her adımdan önce ve sonra bekleyen zaman uyumsuz işleri boşaltır. */
  const ilerlet = async (ms: number): Promise<void> => {
    await bosalt();
    zaman.ilerlet(ms);
    await bosalt();
  };
  const baslat = async (): Promise<void> => {
    const p = kilit.baslat();
    await bosalt();
    await p;
  };
  return { zaman, dosya, gunluk, notlar, degisimler, kilit, ilerlet, baslat };
};

const yaz = (d: ReturnType<typeof kur>, icerik: unknown): void =>
  d.dosya.yaz(YOL, typeof icerik === "string" ? icerik : JSON.stringify(icerik));

describe("kilit: okuma kuralı", () => {
  it("dosya yok: serbest", async () => {
    const d = kur();
    await d.baslat();
    assert.deepEqual(d.kilit.durum(), { tur: "serbest" });
    assert.equal(d.kilit.baslatmaSerbestMi(), true);
  });

  it("geçerli, acildi null, sıfırlanma ileride: aktif", async () => {
    const d = kur();
    yaz(d, gecerli());
    await d.baslat();
    assert.deepEqual(d.kilit.durum(), { tur: "aktif", sifirlanmaMs: BASLANGIC + SAAT, yuzde: 97.5 });
    assert.equal(d.kilit.baslatmaSerbestMi(), false);
  });

  it("acildi metin: serbest", async () => {
    const d = kur();
    yaz(d, gecerli({ acildi: new Date(BASLANGIC).toISOString() }));
    await d.baslat();
    assert.deepEqual(d.kilit.durum(), { tur: "serbest" });
  });

  it("acildi metin ve sıfırlanma geçersiz olsa da acildi önce bakılır: serbest", async () => {
    const d = kur();
    yaz(d, gecerli({ acildi: "x", sifirlanma: "tarih-degil" }));
    await d.baslat();
    assert.deepEqual(d.kilit.durum(), { tur: "serbest" });
  });

  it("sıfırlanma geçmiş: serbest", async () => {
    const d = kur();
    yaz(d, gecerli({ sifirlanma: new Date(BASLANGIC - 1000).toISOString() }));
    await d.baslat();
    assert.deepEqual(d.kilit.durum(), { tur: "serbest" });
  });

  it("sıfırlanma geçersiz tarih: belirsiz", async () => {
    const d = kur();
    yaz(d, gecerli({ sifirlanma: "dun degil" }));
    await d.baslat();
    assert.equal(d.kilit.durum().tur, "belirsiz");
    assert.equal(d.kilit.baslatmaSerbestMi(), false);
  });

  const bozuklar: [string, Record<string, unknown>][] = [
    ["surum 2", { surum: 2 }],
    ["surum metin", { surum: "1" }],
    ["surum yok", { surum: undefined }],
    ["esik metin", { esik: "95" }],
    ["esik NaN olamaz, null", { esik: null }],
    ["esik yok", { esik: undefined }],
    ["yuzde metin", { yuzde: "97" }],
    ["yuzde null", { yuzde: null }],
    ["yuzde yok", { yuzde: undefined }],
    ["sifirlanma sayı", { sifirlanma: 1700000000000 }],
    ["sifirlanma yok", { sifirlanma: undefined }],
    ["kilitlendi sayı", { kilitlendi: 5 }],
    ["kilitlendi yok", { kilitlendi: undefined }],
    ["oturum sayı", { oturum: 7 }],
    ["oturum yok", { oturum: undefined }],
    ["acildi sayı", { acildi: 5 }],
    ["acildi nesne", { acildi: {} }],
    ["acildi yok", { acildi: undefined }],
  ];
  for (const [ad, ek] of bozuklar) {
    it(`şema ihlali (${ad}): belirsiz`, async () => {
      const d = kur();
      yaz(d, gecerli(ek));
      await d.baslat();
      assert.equal(d.kilit.durum().tur, "belirsiz");
      assert.equal(d.kilit.baslatmaSerbestMi(), false);
    });
  }

  for (const [ad, icerik] of [
    ["dizi", "[]"],
    ["null", "null"],
    ["sayı", "42"],
    ["metin", '"kilit"'],
  ] as const) {
    it(`kök nesne değil (${ad}): belirsiz`, async () => {
      const d = kur();
      yaz(d, icerik);
      await d.baslat();
      assert.equal(d.kilit.durum().tur, "belirsiz");
    });
  }

  it("belirsiz durumun nedeni boş olmayan metin", async () => {
    const d = kur();
    yaz(d, gecerli({ surum: 9 }));
    await d.baslat();
    const durum = d.kilit.durum();
    assert.equal(durum.tur, "belirsiz");
    if (durum.tur === "belirsiz") assert.ok(durum.neden.length > 0);
  });

  it("dosya okuma hatası atarsa belirsiz, kimse öldürülmez, modül atmaz", async () => {
    const d = kur();
    d.dosya.hataVer("oku", new Error("erisim reddedildi"));
    await d.baslat();
    assert.equal(d.kilit.durum().tur, "belirsiz");
    assert.equal(d.kilit.baslatmaSerbestMi(), false);
  });
});

describe("kilit: BOM ve boşluk", () => {
  it("baştaki BOM atılır", async () => {
    const d = kur();
    yaz(d, "\uFEFF" + JSON.stringify(gecerli()));
    await d.baslat();
    assert.equal(d.kilit.durum().tur, "aktif");
  });

  it("baş ve sondaki BOM ile boşluk atılır", async () => {
    const d = kur();
    yaz(d, "\uFEFF \r\n\t" + JSON.stringify(gecerli()) + "\n \uFEFF\r\n");
    await d.baslat();
    assert.equal(d.kilit.durum().tur, "aktif");
  });

  it("BOM'lu serbest içerik de çözülür", async () => {
    const d = kur();
    yaz(d, "\uFEFF" + JSON.stringify(gecerli({ acildi: "2026-01-01T00:00:00Z" })));
    await d.baslat();
    assert.deepEqual(d.kilit.durum(), { tur: "serbest" });
  });
});

describe("kilit: yarım yazım yeniden denemesi", () => {
  it("ilk okuma bozuk, 300 ms sonra düzelir: yalnız 2 okuma, aktif", async () => {
    const d = kur();
    yaz(d, '{"surum":1,"esik":9');
    const p = d.kilit.baslat();
    await bosalt();
    assert.equal(d.dosya.cagrilar.say("oku"), 1);
    yaz(d, gecerli());
    await d.ilerlet(299);
    assert.equal(d.dosya.cagrilar.say("oku"), 1, "300 ms dolmadan yeniden okunmaz");
    await d.ilerlet(1);
    await p;
    assert.equal(d.dosya.cagrilar.say("oku"), 2);
    assert.equal(d.kilit.durum().tur, "aktif");
  });

  it("iki kez bozuk, üçüncüde düzelir: 3 okuma, 300 ms arayla", async () => {
    const d = kur();
    yaz(d, "{");
    const p = d.kilit.baslat();
    await bosalt();
    await d.ilerlet(300);
    assert.equal(d.dosya.cagrilar.say("oku"), 2);
    yaz(d, gecerli());
    await d.ilerlet(300);
    await p;
    assert.equal(d.dosya.cagrilar.say("oku"), 3);
    assert.equal(d.kilit.durum().tur, "aktif");
  });

  it("üç okumada da bozuk: belirsiz, en çok 3 okuma", async () => {
    const d = kur();
    yaz(d, "{bozuk");
    const p = d.kilit.baslat();
    await bosalt();
    await d.ilerlet(300);
    await d.ilerlet(300);
    await p;
    assert.equal(d.dosya.cagrilar.say("oku"), 3);
    assert.equal(d.kilit.durum().tur, "belirsiz");
    await d.ilerlet(1000);
    assert.equal(d.dosya.cagrilar.say("oku"), 3, "aynı yoklamada dördüncü deneme yok");
  });

  it("yarım yazımdan sonra dosya silinmişse serbest", async () => {
    const d = kur();
    yaz(d, "{");
    const p = d.kilit.baslat();
    await bosalt();
    d.dosya.sil(YOL);
    await d.ilerlet(300);
    await p;
    assert.deepEqual(d.kilit.durum(), { tur: "serbest" });
  });

  it("şema ihlali (geçerli JSON) yeniden denenmez", async () => {
    const d = kur();
    yaz(d, gecerli({ surum: 2 }));
    await d.baslat();
    assert.equal(d.dosya.cagrilar.say("oku"), 1);
    assert.equal(d.kilit.durum().tur, "belirsiz");
  });
});

describe("kilit: 5 sn yoklama (sahte saat)", () => {
  it("baslat ilk okumayı yapar, sonra 5 sn arayla yoklar", async () => {
    const d = kur();
    await d.baslat();
    assert.equal(d.dosya.cagrilar.say("oku"), 1);
    assert.deepEqual(d.dosya.cagrilar.son("oku")?.args, [YOL]);
    await d.ilerlet(4999);
    assert.equal(d.dosya.cagrilar.say("oku"), 1);
    await d.ilerlet(1);
    assert.equal(d.dosya.cagrilar.say("oku"), 2);
    await d.ilerlet(5000);
    assert.equal(d.dosya.cagrilar.say("oku"), 3);
    for (let i = 0; i < 3; i++) await d.ilerlet(5000);
    assert.equal(d.dosya.cagrilar.say("oku"), 6);
  });

  it("yoklama aralığı ayar.sureler.kilitYoklamaMs'ten gelir", async () => {
    const zaman = sahteZaman(BASLANGIC);
    const dosya = sahteDosya();
    const gunluk = sahteGunluk();
    const kilit = kilitKur({
      ayar: { yollar: { limitKilit: YOL }, sureler: { kilitYoklamaMs: 2000 } },
      depo: { olayEkle: () => ({}) as never },
      dosya,
      saat: zaman.saat,
      zamanlayici: zaman.zamanlayici,
      veriyolu: veriyoluKur({ gunluk }),
      gunluk,
    } as unknown as KilitBagimliliklari);
    const p = kilit.baslat();
    await bosalt();
    await p;
    zaman.ilerlet(2000);
    await bosalt();
    assert.equal(dosya.cagrilar.say("oku"), 2);
    kilit.kapat();
  });

  it("dosya sonradan oluşunca bir sonraki yoklamada aktif olur", async () => {
    const d = kur();
    await d.baslat();
    yaz(d, gecerli());
    assert.equal(d.kilit.durum().tur, "serbest", "yoklama gelmeden değişmez");
    await d.ilerlet(5000);
    assert.equal(d.kilit.durum().tur, "aktif");
    assert.equal(d.kilit.baslatmaSerbestMi(), false);
  });

  it("sıfırlanma anı geçince dosya değişmese de serbest olur", async () => {
    const d = kur();
    yaz(d, gecerli());
    await d.baslat();
    assert.equal(d.kilit.durum().tur, "aktif");
    await d.ilerlet(SAAT - 5000);
    assert.equal(d.kilit.durum().tur, "aktif");
    await d.ilerlet(5000 + 5000);
    assert.deepEqual(d.kilit.durum(), { tur: "serbest" });
  });

  it("kapat yoklamayı durdurur, tekrar kapat zararsız", async () => {
    const d = kur();
    await d.baslat();
    d.kilit.kapat();
    d.kilit.kapat();
    const once = d.dosya.cagrilar.say("oku");
    await d.ilerlet(60000);
    assert.equal(d.dosya.cagrilar.say("oku"), once);
    assert.equal(d.zaman.bekleyenSayisi(), 0);
  });
});

describe("kilit: geçişler ve bildirimler", () => {
  it("aynı tür sürdükçe kilit_degisti yayınlanmaz", async () => {
    const d = kur();
    await d.baslat();
    d.degisimler.length = 0;
    await d.ilerlet(50000);
    assert.equal(d.degisimler.length, 0);
    yaz(d, gecerli());
    await d.ilerlet(5000);
    assert.equal(d.degisimler.length, 1);
    await d.ilerlet(20000);
    assert.equal(d.degisimler.length, 1);
  });

  it("serbest -> aktif: kilit_degisti ve kritik limit_kilit_aktif", async () => {
    const d = kur();
    await d.baslat();
    d.degisimler.length = 0;
    d.notlar.length = 0;
    yaz(d, gecerli());
    await d.ilerlet(5000);
    assert.deepEqual(d.degisimler, [{ tur: "aktif", sifirlanmaMs: BASLANGIC + SAAT, yuzde: 97.5 }]);
    assert.equal(d.notlar.length, 1);
    const n = d.notlar[0] as Record<string, unknown>;
    assert.equal(n["type"], "system_notice");
    assert.equal(n["seviye"], "kritik");
    assert.equal(n["kod"], "limit_kilit_aktif");
    assert.equal(typeof n["metin"], "string");
  });

  it("aktif -> serbest (mod elle açtı): kilit_degisti ve limit_kilit_bitti", async () => {
    const d = kur();
    yaz(d, gecerli());
    await d.baslat();
    d.degisimler.length = 0;
    d.notlar.length = 0;
    yaz(d, gecerli({ acildi: new Date(BASLANGIC).toISOString() }));
    await d.ilerlet(5000);
    assert.deepEqual(d.degisimler, [{ tur: "serbest" }]);
    assert.equal(d.notlar.length, 1);
    const n = d.notlar[0] as Record<string, unknown>;
    assert.equal(n["type"], "system_notice");
    assert.equal(n["kod"], "limit_kilit_bitti");
    assert.equal(n["seviye"], "bilgi");
  });

  it("aktif -> serbest (dosya silindi): limit_kilit_bitti", async () => {
    const d = kur();
    yaz(d, gecerli());
    await d.baslat();
    d.notlar.length = 0;
    d.dosya.sil(YOL);
    await d.ilerlet(5000);
    assert.equal(d.kilit.durum().tur, "serbest");
    assert.equal((d.notlar[0] as Record<string, unknown>)["kod"], "limit_kilit_bitti");
  });

  it("aktif -> serbest (sıfırlanma geçti): limit_kilit_bitti", async () => {
    const d = kur();
    yaz(d, gecerli());
    await d.baslat();
    d.notlar.length = 0;
    d.degisimler.length = 0;
    await d.ilerlet(SAAT + 5000);
    assert.deepEqual(d.degisimler, [{ tur: "serbest" }]);
    assert.equal(d.notlar.length, 1);
    assert.equal((d.notlar[0] as Record<string, unknown>)["kod"], "limit_kilit_bitti");
  });

  it("serbest -> belirsiz: uyarı seviyesinde diger", async () => {
    const d = kur();
    await d.baslat();
    d.degisimler.length = 0;
    d.notlar.length = 0;
    yaz(d, gecerli({ surum: 3 }));
    await d.ilerlet(5000);
    assert.equal(d.degisimler.length, 1);
    assert.equal(d.degisimler[0]?.tur, "belirsiz");
    assert.equal(d.notlar.length, 1);
    const n = d.notlar[0] as Record<string, unknown>;
    assert.equal(n["type"], "system_notice");
    assert.equal(n["seviye"], "uyari");
    assert.equal(n["kod"], "diger");
  });

  it("aktif -> belirsiz: uyarı diger, kilit_degisti belirsiz", async () => {
    const d = kur();
    yaz(d, gecerli());
    await d.baslat();
    d.degisimler.length = 0;
    d.notlar.length = 0;
    yaz(d, "{");
    await d.ilerlet(5000);
    await d.ilerlet(300);
    await d.ilerlet(300);
    assert.equal(d.degisimler.length, 1);
    assert.equal(d.degisimler[0]?.tur, "belirsiz");
    assert.equal(d.notlar.length, 1);
    assert.equal((d.notlar[0] as Record<string, unknown>)["kod"], "diger");
    assert.equal((d.notlar[0] as Record<string, unknown>)["seviye"], "uyari");
  });

  it("belirsiz -> aktif: kilit_degisti ve limit_kilit_aktif", async () => {
    const d = kur();
    yaz(d, gecerli({ surum: 3 }));
    await d.baslat();
    d.degisimler.length = 0;
    d.notlar.length = 0;
    yaz(d, gecerli());
    await d.ilerlet(5000);
    assert.equal(d.degisimler[0]?.tur, "aktif");
    assert.equal((d.notlar[0] as Record<string, unknown>)["kod"], "limit_kilit_aktif");
  });

  it("belirsiz -> serbest: kilit_degisti yayınlanır, aktif bildirimi yok", async () => {
    const d = kur();
    yaz(d, gecerli({ surum: 3 }));
    await d.baslat();
    d.degisimler.length = 0;
    d.notlar.length = 0;
    d.dosya.sil(YOL);
    await d.ilerlet(5000);
    assert.deepEqual(d.degisimler, [{ tur: "serbest" }]);
    // Kilit hiç aktif olmadığı için "bitti" bildirimi sözleşmeden çıkmaz; belge yalnız aktiften çıkışı sayar.
    assert.ok(d.notlar.every((n) => (n as Record<string, unknown>)["kod"] !== "limit_kilit_aktif"));
  });

  it("aktif iken yuzde ya da sıfırlanma değişir ama tür aynı: yayın yok", async () => {
    const d = kur();
    yaz(d, gecerli());
    await d.baslat();
    d.degisimler.length = 0;
    d.notlar.length = 0;
    yaz(d, gecerli({ yuzde: 99, sifirlanma: new Date(BASLANGIC + 2 * SAAT).toISOString() }));
    await d.ilerlet(5000);
    assert.equal(d.degisimler.length, 0);
    assert.equal(d.notlar.length, 0);
    assert.deepEqual(d.kilit.durum(), { tur: "aktif", sifirlanmaMs: BASLANGIC + 2 * SAAT, yuzde: 99 });
  });

  it("bildirim metni dosya içeriğini (oturum kimliği) taşımaz", async () => {
    const d = kur();
    await d.baslat();
    d.notlar.length = 0;
    yaz(d, gecerli({ oturum: "gizli-oturum-kimligi" }));
    await d.ilerlet(5000);
    assert.ok(!JSON.stringify(d.notlar).includes("gizli-oturum-kimligi"));
    for (const g of d.gunluk.girdiler) assert.ok(!JSON.stringify(g).includes("gizli-oturum-kimligi"));
  });

  it("depo.olayEkle atarsa yoklama sürer ve durum yine de güncellenir", async () => {
    const zaman = sahteZaman(BASLANGIC);
    const dosya = sahteDosya();
    const gunluk = sahteGunluk();
    const veriyolu = veriyoluKur({ gunluk });
    const kilit = kilitKur({
      ayar: { yollar: { limitKilit: YOL }, sureler: { kilitYoklamaMs: 5000 } },
      depo: {
        olayEkle: () => {
          throw new Error("depo kapali");
        },
      },
      dosya,
      saat: zaman.saat,
      zamanlayici: zaman.zamanlayici,
      veriyolu,
      gunluk,
    } as unknown as KilitBagimliliklari);
    const p = kilit.baslat();
    await bosalt();
    await p;
    dosya.yaz(YOL, JSON.stringify(gecerli()));
    zaman.ilerlet(5000);
    await bosalt();
    assert.equal(kilit.durum().tur, "aktif");
    dosya.sil(YOL);
    zaman.ilerlet(5000);
    await bosalt();
    assert.equal(kilit.durum().tur, "serbest");
    kilit.kapat();
  });
});

describe("kilit: baslatmaSerbestMi üç durumda", () => {
  it("serbest: true", async () => {
    const d = kur();
    await d.baslat();
    assert.equal(d.kilit.durum().tur, "serbest");
    assert.equal(d.kilit.baslatmaSerbestMi(), true);
  });

  it("aktif: false", async () => {
    const d = kur();
    yaz(d, gecerli());
    await d.baslat();
    assert.equal(d.kilit.durum().tur, "aktif");
    assert.equal(d.kilit.baslatmaSerbestMi(), false);
  });

  it("belirsiz: false", async () => {
    const d = kur();
    yaz(d, "bozuk");
    const p = d.kilit.baslat();
    await bosalt();
    await d.ilerlet(300);
    await d.ilerlet(300);
    await p;
    assert.equal(d.kilit.durum().tur, "belirsiz");
    assert.equal(d.kilit.baslatmaSerbestMi(), false);
  });

  it("kapıyı her durum geçişinde durumla birlikte izler", async () => {
    const d = kur();
    await d.baslat();
    assert.equal(d.kilit.baslatmaSerbestMi(), true);
    yaz(d, gecerli());
    await d.ilerlet(5000);
    assert.equal(d.kilit.baslatmaSerbestMi(), false);
    yaz(d, gecerli({ surum: 5 }));
    await d.ilerlet(5000);
    assert.equal(d.kilit.baslatmaSerbestMi(), false);
    d.dosya.sil(YOL);
    await d.ilerlet(5000);
    assert.equal(d.kilit.baslatmaSerbestMi(), true);
  });
});

describe("kilit: yazma çağrısı sıfır", () => {
  it("tüm geçişlerde dosya portunda yalnız oku çağrılır", async () => {
    const d = kur();
    await d.baslat();
    yaz(d, gecerli());
    await d.ilerlet(5000);
    yaz(d, gecerli({ surum: 4 }));
    await d.ilerlet(5000);
    yaz(d, "{");
    await d.ilerlet(5000);
    await d.ilerlet(600);
    yaz(d, gecerli({ acildi: "2026-01-01T00:00:00Z" }));
    await d.ilerlet(5000);
    d.dosya.sil(YOL);
    await d.ilerlet(5000);
    d.kilit.kapat();
    const adlar = new Set(d.dosya.cagrilar.liste.map((c) => c.ad));
    assert.deepEqual([...adlar], ["oku"]);
    assert.equal(d.dosya.cagrilar.say("atomikYaz"), 0);
    assert.equal(d.dosya.cagrilar.say("dizinOlustur"), 0);
  });

  it("ack dosyası ya da başka dosya oluşmaz: dosya sistemi test başındaki gibi kalır", async () => {
    const d = kur();
    yaz(d, gecerli());
    const once = JSON.stringify(d.dosya.dosyalar());
    await d.baslat();
    await d.ilerlet(30000);
    d.kilit.kapat();
    assert.equal(JSON.stringify(d.dosya.dosyalar()), once);
    assert.deepEqual(d.dosya.dizinler(), []);
  });

  it("yalnız limitKilit yolu okunur", async () => {
    const d = kur();
    yaz(d, gecerli());
    await d.baslat();
    await d.ilerlet(20000);
    for (const c of d.dosya.cagrilar.hepsi("oku")) assert.deepEqual(c.args, [YOL]);
  });
});
