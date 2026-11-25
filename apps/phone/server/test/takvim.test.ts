/**
 * takvim (`TakvimPortu`): dilim veritabanı `Intl`; duvar saatinden ana çeviri java.time
 * `ZonedDateTime.of` kuralı (yaz saati boşluğunda ileri, çakışmada önceki ofset); `yerelAn` saniyeyi
 * keser; `kullaniciDilimi` her çağrıda yeniden okunur. Protokol vektörlerinin hatırlatma planı gerçek
 * takvimle de aynı sonucu verir. MODULLER.md "Ajanda dalgası" > "takvim ve ajanda".
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type AjandaKaydi, hatirlatmaHalleri, hatirlatmaOzeti, kurulacakHatirlatmalar } from "@eren/protocol";
import { takvimKur } from "../src/takvim.ts";
import { sahteTakvim } from "./sahte.ts";

const VEKTOR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "protocol", "vektorler", "ajanda-kurallar.json");

const kur = (dilim = "Europe/Istanbul") => takvimKur({ sistemDilimi: () => dilim });
const utc = (iso: string): number => Date.parse(iso);

describe("takvim: anCevir (java.time ZonedDateTime.of kuralı)", () => {
  const t = kur();

  it("olağan an: sabit ofsetli ve yaz saatsiz dilimler", () => {
    assert.equal(t.anCevir("2026-11-26", "15:00", "Europe/Istanbul"), utc("2026-11-26T12:00:00Z"));
    assert.equal(t.anCevir("2026-11-26", "15:00", "UTC"), utc("2026-11-26T15:00:00Z"));
    // POSIX işaret tersliği: Etc/GMT-3 = UTC+3.
    assert.equal(t.anCevir("2026-11-26", "15:00", "Etc/GMT-3"), utc("2026-11-26T12:00:00Z"));
    assert.equal(t.anCevir("2026-07-01", "09:30", "Asia/Tokyo"), utc("2026-07-01T00:30:00Z"));
    assert.equal(t.anCevir("2026-01-15", "09:00", "America/New_York"), utc("2026-01-15T14:00:00Z"));
    assert.equal(t.anCevir("2026-07-15", "09:00", "America/New_York"), utc("2026-07-15T13:00:00Z"));
  });

  it("yaz saati boşluğu: duvar saati boşluk kadar ileri (New York, Berlin)", () => {
    // 02:30 yok: 03:30 EDT = 07:30Z.
    assert.equal(t.anCevir("2026-03-08", "02:30", "America/New_York"), utc("2026-03-08T07:30:00Z"));
    assert.deepEqual(t.yerelAn(t.anCevir("2026-03-08", "02:30", "America/New_York"), "America/New_York"), {
      tarih: "2026-03-08",
      saat: "03:30",
      saat_dilimi: "America/New_York",
    });
    // Boşluğun ilk dakikası ve hemen öncesi.
    assert.equal(t.anCevir("2026-03-08", "02:00", "America/New_York"), utc("2026-03-08T07:00:00Z"));
    assert.equal(t.anCevir("2026-03-08", "01:59", "America/New_York"), utc("2026-03-08T06:59:00Z"));
    assert.equal(t.anCevir("2026-03-08", "03:00", "America/New_York"), utc("2026-03-08T07:00:00Z"));
    // Berlin: 02:30 yok, 03:30 CEST = 01:30Z.
    assert.equal(t.anCevir("2026-03-29", "02:30", "Europe/Berlin"), utc("2026-03-29T01:30:00Z"));
  });

  it("yaz saati çakışması: önceki (yaz) ofset, yani erken an", () => {
    // 01:30 iki kez: EDT (-4) ile 05:30Z.
    assert.equal(t.anCevir("2026-11-01", "01:30", "America/New_York"), utc("2026-11-01T05:30:00Z"));
    assert.equal(t.anCevir("2026-11-01", "02:00", "America/New_York"), utc("2026-11-01T07:00:00Z"));
    assert.equal(t.anCevir("2026-11-01", "00:59", "America/New_York"), utc("2026-11-01T04:59:00Z"));
    // Berlin: 02:30 iki kez, CEST (+2) ile 00:30Z.
    assert.equal(t.anCevir("2026-10-25", "02:30", "Europe/Berlin"), utc("2026-10-25T00:30:00Z"));
    assert.equal(t.anCevir("2026-10-25", "03:00", "Europe/Berlin"), utc("2026-10-25T02:00:00Z"));
  });

  it("saniyeli tarihsel ofset (yerel ortalama saat) korunur", () => {
    // 1900'de İstanbul +01:56:56.
    assert.equal(t.anCevir("1900-01-01", "12:00", "Europe/Istanbul"), utc("1900-01-01T10:03:04Z"));
  });

  it("bilinmeyen dilim ve bozuk girdi atar", () => {
    assert.throws(() => t.anCevir("2026-11-26", "15:00", "Mars/Phobos"), RangeError);
    assert.throws(() => t.anCevir("2026-02-30", "15:00", "UTC"), RangeError);
    assert.throws(() => t.anCevir("2026-11-26", "24:00", "UTC"), RangeError);
    assert.throws(() => t.anCevir("26-11-2026", "15:00", "UTC"), RangeError);
  });
});

describe("takvim: yerelAn, dilimBiliniyorMu, kullaniciDilimi", () => {
  it("yerelAn saniyeyi keser, yuvarlamaz", () => {
    const t = kur();
    assert.deepEqual(t.yerelAn(utc("2026-11-25T20:58:59.999Z"), "Europe/Istanbul"), {
      tarih: "2026-11-25",
      saat: "23:58",
      saat_dilimi: "Europe/Istanbul",
    });
    assert.deepEqual(t.yerelAn(utc("2026-11-25T21:01:00Z"), "Europe/Istanbul"), {
      tarih: "2026-11-26",
      saat: "00:01",
      saat_dilimi: "Europe/Istanbul",
    });
    assert.deepEqual(t.yerelAn(utc("2026-11-25T21:01:00Z"), "America/Sao_Paulo").tarih, "2026-11-25");
    assert.throws(() => t.yerelAn(0, "Mars/Phobos"), RangeError);
  });

  it("dilim veritabanı: bilinen adlar, takma adlar; ofset biçimi, harf farkı ve uydurma ad bilinmez", () => {
    const t = kur();
    for (const ad of ["UTC", "Etc/UTC", "Etc/GMT-3", "Europe/Istanbul", "America/Argentina/Buenos_Aires", "Europe/Kiev", "US/Eastern"]) {
      assert.equal(t.dilimBiliniyorMu(ad), true, ad);
    }
    for (const ad of ["", "Mars/Phobos", "europe/istanbul", "EUROPE/ISTANBUL", "+03:00", "-05:00", "Europe/Istanbul "]) {
      assert.equal(t.dilimBiliniyorMu(ad), false, JSON.stringify(ad));
    }
  });

  it("kullaniciDilimi her çağrıda sistemDilimi'ni yeniden okur", () => {
    let dilim = "Europe/Istanbul";
    let okuma = 0;
    const t = takvimKur({
      sistemDilimi: () => {
        okuma++;
        return dilim;
      },
    });
    assert.equal(t.kullaniciDilimi(), "Europe/Istanbul");
    dilim = "Asia/Tokyo";
    assert.equal(t.kullaniciDilimi(), "Asia/Tokyo");
    assert.equal(okuma, 2);
  });

  it("sabit ofsetli dilimlerde sahte takvimle aynı sonucu verir", () => {
    const t = kur();
    const s = sahteTakvim();
    for (const dilim of ["Europe/Istanbul", "UTC", "Asia/Tokyo", "America/Sao_Paulo"]) {
      for (const [tarih, saat] of [
        ["2026-11-25", "23:58"],
        ["2026-11-26", "00:01"],
        ["2027-02-28", "12:00"],
      ] as const) {
        const ms = t.anCevir(tarih, saat, dilim);
        assert.equal(ms, s.anCevir(tarih, saat, dilim), `${dilim} ${tarih} ${saat}`);
        assert.deepEqual(t.yerelAn(ms + 59_000, dilim), s.yerelAn(ms + 59_000, dilim));
      }
    }
  });
});

describe("takvim: protokol vektörleri (hatırlatma planı) gerçek dilim veritabanıyla", () => {
  const v = JSON.parse(readFileSync(VEKTOR, "utf8")) as {
    hatirlatma_plani: {
      ofset_dk: Record<string, number>;
      vakalar: { ad: string; kayit: AjandaKaydi; simdi_ms: number; haller: unknown[]; ozet: unknown }[];
    };
  };
  const t = kur();

  it("vektörün ofset tablosu gerçek dilimlerle aynı", () => {
    for (const [dilim, dk] of Object.entries(v.hatirlatma_plani.ofset_dk)) {
      assert.equal(t.anCevir("2026-11-25", "12:00", dilim), Date.UTC(2026, 10, 25, 12, 0) - dk * 60_000, dilim);
    }
  });

  for (const vaka of v.hatirlatma_plani.vakalar) {
    it(vaka.ad, () => {
      assert.deepEqual(hatirlatmaHalleri(vaka.kayit, vaka.simdi_ms, t.anCevir), vaka.haller);
      assert.deepEqual(hatirlatmaOzeti(vaka.kayit, vaka.simdi_ms, t.anCevir), vaka.ozet);
      const kurulan = kurulacakHatirlatmalar(vaka.kayit, vaka.simdi_ms, t.anCevir);
      assert.ok(kurulan.every((h) => h.tetik_ms > vaka.simdi_ms));
    });
  }
});
