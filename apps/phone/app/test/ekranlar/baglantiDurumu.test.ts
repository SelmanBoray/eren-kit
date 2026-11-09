import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GECICI_HATALAR,
  altBaslikHesapla,
  hatHesapla,
  kaliciHataVar,
} from "../../src/ekranlar/baglantiDurumu.ts";
import type { AkisDurumu, BaglantiOzeti, SohbetErenDurumu, SohbetHatasi } from "../../src/cekirdek/index.ts";

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
