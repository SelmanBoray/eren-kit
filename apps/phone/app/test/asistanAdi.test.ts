import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { yapilandirmaKur } from "../app.config.ts";
import {
  asistanAdiOku,
  asistanAdiUret,
  uygulamaAdiUret,
  VARSAYILAN_ASISTAN_ADI,
  VARSAYILAN_UYGULAMA_ADI,
} from "../src/asistanAdi.ts";

const DURAGAN = {
  name: "eren-kit",
  slug: "eren-kit",
  android: { package: "dev.eren.app" },
  extra: { baska: 1 },
};

describe("asistan adı: derleme anı yapılandırması (app.config.ts)", () => {
  it("ortamsız: asistan adı Claude, launcher adı eren-kit", () => {
    const c = yapilandirmaKur(DURAGAN, {});
    assert.equal(c.name, "eren-kit");
    assert.deepEqual(c.extra, { baska: 1, asistanAdi: "Claude" });
  });

  it("ortamlı: asistan adı ve launcher adı ortamdaki ad", () => {
    const c = yapilandirmaKur(DURAGAN, { EREN_KIT_ASSISTANT_NAME: "Örnek Asistan" });
    assert.equal(c.name, "Örnek Asistan");
    assert.equal(c.extra?.["asistanAdi"], "Örnek Asistan");
  });

  it("ortam yalnız boşluk/yazdırılamaz karakterse ortamsız gibi", () => {
    const c = yapilandirmaKur(DURAGAN, { EREN_KIT_ASSISTANT_NAME: " ​\t " });
    assert.equal(c.name, "eren-kit");
    assert.equal(c.extra?.["asistanAdi"], "Claude");
  });

  it("Android paketi ve slug değişmez", () => {
    const c = yapilandirmaKur(DURAGAN, { EREN_KIT_ASSISTANT_NAME: "Nova" });
    assert.equal(c.android?.package, "dev.eren.app");
    assert.equal(c.slug, "eren-kit");
  });
});

describe("asistan adı: temizleme (server/src/ayar.ts asistanAdiUret ile aynı kural)", () => {
  it("varsayılanlar", () => {
    assert.equal(VARSAYILAN_ASISTAN_ADI, "Claude");
    assert.equal(VARSAYILAN_UYGULAMA_ADI, "eren-kit");
    assert.equal(asistanAdiUret(undefined), "Claude");
    assert.equal(uygulamaAdiUret(undefined), "eren-kit");
    assert.equal(uygulamaAdiUret(""), "eren-kit");
  });

  it("yazdırılamaz karakterler atılır, boşluklar teklenir, kırpılır", () => {
    assert.equal(asistanAdiUret("  Nova\u0000   Yardımcı​ \n"), "Nova Yardımcı");
    assert.equal(uygulamaAdiUret("  Nova   Yardımcı "), "Nova Yardımcı");
  });

  it("en çok 40 karakter; kesimden sonra sondaki boşluk atılır", () => {
    assert.equal(asistanAdiUret("a".repeat(50)), "a".repeat(40));
    assert.equal(asistanAdiUret(`${"a".repeat(39)} b`), "a".repeat(39));
  });
});

describe("asistan adı: çalışma anı okuma (extra.asistanAdi)", () => {
  it("extra yoksa ya da alan metin değilse Claude", () => {
    assert.equal(asistanAdiOku(undefined), "Claude");
    assert.equal(asistanAdiOku(null), "Claude");
    assert.equal(asistanAdiOku({}), "Claude");
    assert.equal(asistanAdiOku({ asistanAdi: 5 }), "Claude");
  });

  it("extra.asistanAdi varsa o (temizlenmiş)", () => {
    assert.equal(asistanAdiOku({ asistanAdi: "Örnek Asistan" }), "Örnek Asistan");
    assert.equal(asistanAdiOku({ asistanAdi: "  Nova  " }), "Nova");
  });
});
