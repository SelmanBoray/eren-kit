import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GECICI_HATALAR,
  altBaslikHesapla,
  basHarfBuyuk,
  etkinlikEtiketiHesapla,
  etkinlikGecenMs,
  etkinlikSayaciGerekli,
  gorunenEtkinlik,
  hatHesapla,
  kaliciHataVar,
  turSuruyor,
} from "../../src/ekranlar/baglantiDurumu.ts";
import type {
  AkisDurumu,
  BaglantiOzeti,
  EtkinlikDurumu,
  SohbetErenDurumu,
  SohbetHatasi,
} from "../../src/cekirdek/index.ts";

const ozet = (o: Partial<BaglantiOzeti> = {}): BaglantiOzeti => ({
  baglanti: "bagli",
  sonrakiDenemeMs: null,
  hata: null,
  esitleniyor: false,
  sunucu: null,
  ...o,
});

const AKIS: AkisDurumu = { turn_id: "t1", metin: "mer" };
const KALICI: SohbetHatasi[] = ["eslesme_yok", "pc_imzasi_gecersiz", "depo_hatasi"];

describe("GECICI_HATALAR / kaliciHataVar", () => {
  it("geçici hatalar kalıcı sayılmaz", () => {
    for (const h of GECICI_HATALAR) {
      assert.equal(kaliciHataVar(ozet({ baglanti: "kapali", hata: h })), false, h);
    }
    for (const h of ["baglanti_kapandi", "el_sikisma_zaman_asimi", "oturum_yok", "zaman_asimi"] as const) {
      assert.ok(GECICI_HATALAR.has(h), h);
    }
  });
  it("kalıcı hatalar kalıcı sayılır; bağlıyken ya da hatasızken sayılmaz", () => {
    for (const h of KALICI) {
      assert.equal(kaliciHataVar(ozet({ baglanti: "kapali", hata: h })), true, h);
      assert.equal(kaliciHataVar(ozet({ baglanti: "bagli", hata: h })), false, h);
    }
    assert.equal(kaliciHataVar(ozet({ baglanti: "kapali" })), false);
  });
});

describe("hatHesapla", () => {
  it("kalıcı hata: hata", () => {
    assert.equal(hatHesapla(ozet({ baglanti: "kapali", hata: "eslesme_yok" })), "hata");
  });
  it("bağlı: eşitleniyorsa baglaniyor, değilse bagli", () => {
    assert.equal(hatHesapla(ozet()), "bagli");
    assert.equal(hatHesapla(ozet({ esitleniyor: true })), "baglaniyor");
  });
  it("kapalı: kopuk (geçici hata dahil)", () => {
    assert.equal(hatHesapla(ozet({ baglanti: "kapali" })), "kopuk");
    assert.equal(hatHesapla(ozet({ baglanti: "kapali", hata: "baglanti_kapandi" })), "kopuk");
  });
  it("bağlanıyor ve kimlik: baglaniyor", () => {
    assert.equal(hatHesapla(ozet({ baglanti: "baglaniyor" })), "baglaniyor");
    assert.equal(hatHesapla(ozet({ baglanti: "el_sikisma" })), "baglaniyor");
  });
});

describe("altBaslikHesapla: bağlantı satırları", () => {
  it("kalıcı hata: Bağlantı yok, hata/hata", () => {
    assert.deepEqual(altBaslikHesapla(ozet({ baglanti: "kapali", hata: "depo_hatasi" })), {
      metin: "Bağlantı yok",
      renk: "hata",
      metinRenk: "hata",
    });
  });
  it("kalıcı hata, kapalı satırından önce gelir (sonrakiDenemeMs olsa da)", () => {
    const b = altBaslikHesapla(ozet({ baglanti: "kapali", hata: "eslesme_yok", sonrakiDenemeMs: 5 }));
    assert.equal(b.renk, "hata");
  });
  it("kapalı, deneme planlı", () => {
    assert.deepEqual(altBaslikHesapla(ozet({ baglanti: "kapali", sonrakiDenemeMs: 1000 })), {
      metin: "Bağlantı yok, yeniden denenecek",
      renk: "uyari",
    });
  });
  it("kapalı, deneme yok; geçici hata da aynı", () => {
    assert.deepEqual(altBaslikHesapla(ozet({ baglanti: "kapali" })), { metin: "Bağlantı yok", renk: "uyari" });
    assert.deepEqual(altBaslikHesapla(ozet({ baglanti: "kapali", hata: "zaman_asimi" })), {
      metin: "Bağlantı yok",
      renk: "uyari",
    });
  });
  it("bağlanıyor", () => {
    assert.deepEqual(altBaslikHesapla(ozet({ baglanti: "baglaniyor" })), { metin: "Bağlanıyor", renk: "bilgi" });
  });
  it("kimlik doğrulanıyor", () => {
    assert.deepEqual(altBaslikHesapla(ozet({ baglanti: "el_sikisma" })), {
      metin: "Kimlik doğrulanıyor",
      renk: "bilgi",
    });
  });
  it("eşitleniyor; sohbet asistan satırlarından önce gelir", () => {
    const beklenen = { metin: "Eksik mesajlar alınıyor", renk: "bilgi" };
    assert.deepEqual(altBaslikHesapla(ozet({ esitleniyor: true })), beklenen);
    assert.deepEqual(altBaslikHesapla(ozet({ esitleniyor: true }), { akis: AKIS, eren: "tur_suruyor" }), beklenen);
  });
});

describe("altBaslikHesapla: asistan satırları", () => {
  const g = (akis: AkisDurumu | null, eren: SohbetErenDurumu | null) => altBaslikHesapla(ozet(), { akis, eren });
  const yaziyor = { metin: "Claude yazıyor", renk: "basari" };
  const bagli = { metin: "Bağlı", renk: "basari" };

  it("tur_suruyor ve/veya akış: Claude yazıyor (varsayılan ad)", () => {
    assert.deepEqual(g(null, "tur_suruyor"), yaziyor);
    assert.deepEqual(g(AKIS, "tur_suruyor"), yaziyor);
    assert.deepEqual(g(AKIS, null), yaziyor);
    assert.deepEqual(g(AKIS, "hazir"), yaziyor);
    assert.deepEqual(g(AKIS, "kapali"), yaziyor);
  });
  it("baslatiliyor", () => {
    assert.deepEqual(g(null, "baslatiliyor"), { metin: "Claude başlatılıyor", renk: "basari" });
  });
  it("sirada", () => {
    assert.deepEqual(g(null, "sirada"), { metin: "Claude sırada, mesajın bekliyor", renk: "uyari" });
  });
  it("kapali", () => {
    assert.deepEqual(g(null, "kapali"), { metin: "Bağlı, Claude kapalı", renk: "uyari" });
  });
  it("hazir, uyuyor, null: düz Bağlı", () => {
    assert.deepEqual(g(null, "hazir"), bagli);
    assert.deepEqual(g(null, "uyuyor"), bagli);
    assert.deepEqual(g(null, null), bagli);
  });
  it("sohbet verilmezse (undefined/null) asistan satırları atlanır", () => {
    assert.deepEqual(altBaslikHesapla(ozet()), bagli);
    assert.deepEqual(altBaslikHesapla(ozet(), null), bagli);
  });
  it("bağlantı satırları asistan durumundan önce gelir", () => {
    const b = altBaslikHesapla(ozet({ baglanti: "kapali" }), { akis: AKIS, eren: "tur_suruyor" });
    assert.equal(b.metin, "Bağlantı yok");
  });
  it("verilen asistan adı bütün asistan satırlarında kullanılır", () => {
    const a = (akis: AkisDurumu | null, eren: SohbetErenDurumu | null) =>
      altBaslikHesapla(ozet(), { akis, eren }, "Örnek Asistan").metin;
    assert.equal(a(AKIS, null), "Örnek Asistan yazıyor");
    assert.equal(a(null, "baslatiliyor"), "Örnek Asistan başlatılıyor");
    assert.equal(a(null, "sirada"), "Örnek Asistan sırada, mesajın bekliyor");
    assert.equal(a(null, "kapali"), "Bağlı, Örnek Asistan kapalı");
    assert.equal(a(null, "hazir"), "Bağlı");
  });
});

describe("etkinlik: gösterilecek etkinlik kararı", () => {
  const E: EtkinlikDurumu = { turn_id: "t1", etkinlik: "komut", baslangic_ms: 10_000 };

  it("turSuruyor: akış var ya da tur_suruyor", () => {
    assert.equal(turSuruyor({ akis: AKIS, eren: null }), true);
    assert.equal(turSuruyor({ akis: null, eren: "tur_suruyor" }), true);
    for (const eren of ["hazir", "uyuyor", "baslatiliyor", "sirada", "kapali", null] as const) {
      assert.equal(turSuruyor({ akis: null, eren }), false, String(eren));
    }
  });
  it("tur sürerken etkinlik gösterilir (akışlı ya da akışsız)", () => {
    assert.equal(gorunenEtkinlik({ akis: null, eren: "tur_suruyor", etkinlik: E }), E);
    assert.equal(gorunenEtkinlik({ akis: AKIS, eren: "tur_suruyor", etkinlik: E }), E);
    assert.equal(gorunenEtkinlik({ akis: AKIS, eren: null, etkinlik: E }), E);
  });
  it("etkinlik yoksa (null/undefined) ya da tur sürmüyorsa gösterilmez", () => {
    assert.equal(gorunenEtkinlik({ akis: AKIS, eren: "tur_suruyor", etkinlik: null }), null);
    assert.equal(gorunenEtkinlik({ akis: AKIS, eren: "tur_suruyor" }), null);
    for (const eren of ["hazir", "baslatiliyor", "sirada", "kapali", null] as const) {
      assert.equal(gorunenEtkinlik({ akis: null, eren, etkinlik: E }), null, String(eren));
    }
  });
  it("akıştan başka tura ait etkinlik gösterilmez", () => {
    assert.equal(gorunenEtkinlik({ akis: { turn_id: "t2", metin: "x" }, eren: "tur_suruyor", etkinlik: E }), null);
  });
  it("sayaç yalnız süreli etkinlik gösterilirken gerekir", () => {
    assert.equal(etkinlikSayaciGerekli({ akis: null, eren: "tur_suruyor", etkinlik: E }), true);
    const yaz: EtkinlikDurumu = { ...E, etkinlik: "yaziyor" };
    assert.equal(etkinlikSayaciGerekli({ akis: AKIS, eren: "tur_suruyor", etkinlik: yaz }), false);
    assert.equal(etkinlikSayaciGerekli({ akis: null, eren: "hazir", etkinlik: E }), false);
    assert.equal(etkinlikSayaciGerekli({ akis: AKIS, eren: "tur_suruyor", etkinlik: null }), false);
  });
});

describe("etkinlik: geçen süre", () => {
  const E: EtkinlikDurumu = { turn_id: "t1", etkinlik: "komut", baslangic_ms: 10_000 };
  it("şimdi − başlangıç", () => {
    assert.equal(etkinlikGecenMs(E, 10_000), 0);
    assert.equal(etkinlikGecenMs(E, 52_500), 42_500);
  });
  it("eksi süre, sayı olmayan şimdi ve verilmeyen şimdi 0", () => {
    assert.equal(etkinlikGecenMs(E, 9_000), 0);
    assert.equal(etkinlikGecenMs(E, Number.NaN), 0);
    assert.equal(etkinlikGecenMs(E, undefined), 0);
  });
});

describe("altBaslikHesapla: etkinlik", () => {
  const E: EtkinlikDurumu = { turn_id: "t1", etkinlik: "komut", baslangic_ms: 10_000 };
  const m = (o: Parameters<typeof altBaslikHesapla>[1]) => altBaslikHesapla(ozet(), o).metin;

  it("tur sürerken yazıyor yerine etkinlik; renk aynı", () => {
    assert.deepEqual(altBaslikHesapla(ozet(), { akis: null, eren: "tur_suruyor", etkinlik: E, simdiMs: 10_000 }), {
      metin: "Claude komut çalıştırıyor",
      renk: "basari",
    });
    const dus: EtkinlikDurumu = { ...E, etkinlik: "dusunuyor" };
    assert.equal(m({ akis: null, eren: "tur_suruyor", etkinlik: dus, simdiMs: 11_000 }), "Claude düşünüyor");
  });
  it("süre geçişleri: 5 sn altı eksiz, sonra sn, sonra dk", () => {
    const g = (simdiMs: number) => m({ akis: AKIS, eren: "tur_suruyor", etkinlik: E, simdiMs });
    assert.equal(g(14_999), "Claude komut çalıştırıyor");
    assert.equal(g(15_000), "Claude komut çalıştırıyor · 5 sn");
    assert.equal(g(52_000), "Claude komut çalıştırıyor · 42 sn");
    assert.equal(g(70_000), "Claude komut çalıştırıyor · 1 dk");
    assert.equal(g(135_000), "Claude komut çalıştırıyor · 2 dk 5 sn");
  });
  it("eksi süre ve verilmeyen şimdi: süresiz", () => {
    assert.equal(m({ akis: AKIS, eren: "tur_suruyor", etkinlik: E, simdiMs: 0 }), "Claude komut çalıştırıyor");
    assert.equal(m({ akis: AKIS, eren: "tur_suruyor", etkinlik: E }), "Claude komut çalıştırıyor");
  });
  it("yaziyor etkinliği süre almaz", () => {
    const yaz: EtkinlikDurumu = { ...E, etkinlik: "yaziyor" };
    assert.equal(m({ akis: AKIS, eren: "tur_suruyor", etkinlik: yaz, simdiMs: 99_000 }), "Claude yazıyor");
  });
  it("etkinlik null ya da başka tura aitse bugünkü yazıyor", () => {
    assert.equal(m({ akis: AKIS, eren: "tur_suruyor", etkinlik: null, simdiMs: 99_000 }), "Claude yazıyor");
    const baska = { turn_id: "t2", metin: "x" };
    assert.equal(m({ akis: baska, eren: "tur_suruyor", etkinlik: E, simdiMs: 99_000 }), "Claude yazıyor");
  });
  it("tur öncesi ve sonrası durumlar etkinlikten etkilenmez", () => {
    assert.equal(m({ akis: null, eren: "baslatiliyor", etkinlik: E, simdiMs: 99_000 }), "Claude başlatılıyor");
    assert.equal(m({ akis: null, eren: "sirada", etkinlik: E, simdiMs: 99_000 }), "Claude sırada, mesajın bekliyor");
    assert.equal(m({ akis: null, eren: "hazir", etkinlik: E, simdiMs: 99_000 }), "Bağlı");
  });
  it("bağlantı satırları etkinlikten önce gelir", () => {
    const b = altBaslikHesapla(ozet({ esitleniyor: true }), { akis: AKIS, eren: "tur_suruyor", etkinlik: E, simdiMs: 99_000 });
    assert.equal(b.metin, "Eksik mesajlar alınıyor");
  });
  it("verilen asistan adı kullanılır", () => {
    const b = altBaslikHesapla(ozet(), { akis: null, eren: "tur_suruyor", etkinlik: E, simdiMs: 10_000 }, "Örnek Asistan");
    assert.equal(b.metin, "Örnek Asistan komut çalıştırıyor");
  });
});

describe("etkinlikEtiketiHesapla (akış balonu altı)", () => {
  const E: EtkinlikDurumu = { turn_id: "t1", etkinlik: "komut", baslangic_ms: 10_000 };

  it("görünen metin büyük harfle başlar ve süre taşır; erişim etiketi süresiz ve adlı", () => {
    assert.deepEqual(etkinlikEtiketiHesapla({ akis: AKIS, eren: "tur_suruyor", etkinlik: E, simdiMs: 52_000 }), {
      metin: "Komut çalıştırıyor · 42 sn",
      erisim: "Claude komut çalıştırıyor",
    });
    const web: EtkinlikDurumu = { ...E, etkinlik: "web" };
    assert.deepEqual(etkinlikEtiketiHesapla({ akis: null, eren: "tur_suruyor", etkinlik: web, simdiMs: 10_000 }, "Örnek"), {
      metin: "İnternette arıyor",
      erisim: "Örnek internette arıyor",
    });
  });
  it("eksi süre: süresiz", () => {
    assert.equal(etkinlikEtiketiHesapla({ akis: AKIS, eren: null, etkinlik: E, simdiMs: 1 })?.metin, "Komut çalıştırıyor");
  });
  it("gösterilecek etkinlik yoksa null", () => {
    assert.equal(etkinlikEtiketiHesapla({ akis: AKIS, eren: "tur_suruyor", etkinlik: null, simdiMs: 1 }), null);
    assert.equal(etkinlikEtiketiHesapla({ akis: null, eren: "hazir", etkinlik: E, simdiMs: 1 }), null);
    assert.equal(etkinlikEtiketiHesapla({ akis: { turn_id: "t2", metin: "" }, eren: null, etkinlik: E, simdiMs: 1 }), null);
  });
  it("basHarfBuyuk: Türkçe i/ı", () => {
    assert.equal(basHarfBuyuk("iş başlatıyor"), "İş başlatıyor");
    assert.equal(basHarfBuyuk("ılık"), "Ilık");
    assert.equal(basHarfBuyuk("düşünüyor"), "Düşünüyor");
    assert.equal(basHarfBuyuk(""), "");
  });
});
