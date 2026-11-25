import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AJANDA_SINIRLARI,
  AJANDA_VARSAYILAN_HATIRLATMALAR,
  AjandaZamani,
  AjandaZamaniGirdisi,
  gercekTarihMi,
  Hatirlatma,
  Hatirlatmalar,
  Saat,
  SaatDilimi,
  tarihGunNo,
  Tekrar,
} from "../src/index.ts";

test("takvim geçerliliği: artık yıl, ay sonları, yıl sınırları", () => {
  for (const t of ["2024-02-29", "2000-02-29", "2026-01-31", "2026-04-30", "1900-01-01", "2199-12-31"]) {
    assert.equal(gercekTarihMi(t), true, t);
  }
  for (const t of ["1900-02-29", "2100-02-29", "2026-02-29", "2026-04-31", "2026-00-10", "2026-01-00", "1899-12-31", "2200-01-01", "2026-1-01", "26-01-01", "2026-01-01T00:00", ""]) {
    assert.equal(gercekTarihMi(t), false, t);
  }
});

test("gün numarası Date.UTC ile aynıdır", () => {
  assert.equal(tarihGunNo("1970-01-01"), 0);
  for (let gun = Date.UTC(1900, 0, 1); gun <= Date.UTC(2199, 11, 31); gun += 86_400_000 * 37) {
    const tarih = new Date(gun).toISOString().slice(0, 10);
    assert.equal(tarihGunNo(tarih), gun / 86_400_000, tarih);
  }
  assert.throws(() => tarihGunNo("2026-02-30"));
});

test("saat ve saat dilimi biçimi", () => {
  for (const s of ["00:00", "09:05", "23:59"]) assert.equal(Saat.safeParse(s).success, true, s);
  for (const s of ["24:00", "9:05", "12:60", "12:00:00", "12.00"]) assert.equal(Saat.safeParse(s).success, false, s);
  for (const d of ["UTC", "Europe/Istanbul", "America/Argentina/Buenos_Aires", "Etc/GMT+3", "America/Port-au-Prince"]) {
    assert.equal(SaatDilimi.safeParse(d).success, true, d);
  }
  for (const d of ["", "utc", "Europe", "Europe/", "/Istanbul", "Europe/Istanbul/A/B", "Europe/Is tanbul", "+03:00", "A".repeat(AJANDA_SINIRLARI.SAAT_DILIMI) + "/B"]) {
    assert.equal(SaatDilimi.safeParse(d).success, false, d);
  }
});

test("araç zamanında dilim isteğe bağlı, kayıtta zorunlu; belirsiz yalnız ifade taşır", () => {
  const an = { kesinlik: "an", tarih: "2026-11-26", saat: "15:00" };
  assert.equal(AjandaZamaniGirdisi.safeParse(an).success, true);
  assert.equal(AjandaZamani.safeParse(an).success, false);
  assert.equal(AjandaZamani.safeParse({ ...an, saat_dilimi: "UTC" }).success, true);
  assert.equal(AjandaZamani.safeParse({ kesinlik: "belirsiz", ifade: "bir ara" }).success, true);
  assert.equal(AjandaZamani.safeParse({ kesinlik: "belirsiz", ifade: "bir ara", saat_dilimi: "UTC" }).success, false);
  assert.equal(AjandaZamani.safeParse({ ...an, saat_dilimi: "UTC", sure_dk: 0 }).success, false);
  assert.equal(AjandaZamani.safeParse({ ...an, saat_dilimi: "UTC", sure_dk: AJANDA_SINIRLARI.SURE_DK + 1 }).success, false);
  assert.equal(AjandaZamani.safeParse({ ...an, saat_dilimi: "UTC", ifade: "x".repeat(AJANDA_SINIRLARI.ZAMAN_IFADESI + 1) }).success, false);
});

test("hatırlatma listesi ve varsayılan", () => {
  assert.equal(Hatirlatmalar.safeParse(AJANDA_VARSAYILAN_HATIRLATMALAR).success, true);
  for (const h of AJANDA_VARSAYILAN_HATIRLATMALAR) assert.equal(Hatirlatma.parse(h).tur, "once");
  assert.equal(Hatirlatmalar.safeParse([]).success, true);
  assert.equal(Hatirlatma.safeParse({ tur: "once", dk: -1 }).success, false);
  assert.equal(Hatirlatma.safeParse({ tur: "once", dk: 1.5 }).success, false);
  assert.equal(Hatirlatma.safeParse({ tur: "mutlak", tarih: "2026-11-26", saat: "09:00" }).success, false);
  assert.equal(Hatirlatma.safeParse({ tur: "alarm", dk: 1 }).success, false);
});

test("tekrar kuralı", () => {
  assert.equal(Tekrar.safeParse({ siklik: "haftalik", aralik: 2, gunler: ["pzt", "car", "cum"], adet: 10 }).success, true);
  assert.equal(Tekrar.safeParse({ siklik: "aylik", aralik: 1, bitis_tarihi: "2027-12-31" }).success, true);
  assert.equal(Tekrar.safeParse({ siklik: "haftalik", aralik: 1, gunler: ["pzt", "pzt"] }).success, false);
  assert.equal(Tekrar.safeParse({ siklik: "haftalik", aralik: 1, gunler: [] }).success, false);
  assert.equal(Tekrar.safeParse({ siklik: "haftalik", aralik: 0 }).success, false);
  assert.equal(Tekrar.safeParse({ siklik: "haftalik", aralik: AJANDA_SINIRLARI.TEKRAR_ARALIK + 1 }).success, false);
  assert.equal(Tekrar.safeParse({ siklik: "saatlik", aralik: 1 }).success, false);
});
