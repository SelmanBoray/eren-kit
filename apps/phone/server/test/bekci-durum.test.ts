// Bekçi kontrol borusunun `durum` cevabı: kurulum (kurulum/kur.ts) yeni sürümün beklenen veri kökünde
// çalıştığını bu cevaptaki `veri_koku` ile doğrular. Boru açılmaz (canlı bekçiyle aynı ad): saf yardımcı sınanır.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { durumCevabiYap } from "../src/bekci-ana.ts";
import type { BekciDurumu } from "../src/bekci.ts";

const DURUM: BekciDurumu = {
  durum: "calisiyor",
  anaPid: 4242,
  anaBaslangicMs: 2_000,
  yenidenBaslatma: 0,
  sonCikisKodu: null,
  sonNabizMs: 3_000,
};

describe("bekçi durum cevabı", () => {
  it("veri kökünü bildirir; önceki alanlar korunur", () => {
    const c = durumCevabiYap({
      bekciPid: 7,
      baslangicMs: 1_000,
      durum: DURUM,
      surum: "aaaaaaaaaa",
      anaYolu: "C:\\ornek\\veri\\uygulama\\guncel\\server\\src\\ana.ts",
      veriKoku: "C:\\ornek\\veri",
    });
    assert.deepEqual(c, {
      ok: true,
      bekci_pid: 7,
      bekci_baslangic_ms: 1_000,
      durum: "calisiyor",
      ana_pid: 4242,
      ana_baslangic_ms: 2_000,
      yeniden_baslatma: 0,
      son_cikis_kodu: null,
      son_nabiz_ms: 3_000,
      surum: "aaaaaaaaaa",
      ana_yolu: "C:\\ornek\\veri\\uygulama\\guncel\\server\\src\\ana.ts",
      veri_koku: "C:\\ornek\\veri",
    });
  });

  it("kök çözülemezse veri_koku null (alan yine var)", () => {
    const c = durumCevabiYap({ bekciPid: 7, baslangicMs: 1, durum: DURUM, surum: null, anaYolu: "x", veriKoku: null });
    assert.ok("veri_koku" in c);
    assert.equal(c["veri_koku"], null);
  });
});
