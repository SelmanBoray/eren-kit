import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HATA_KODLARI,
  HataKodu,
  HataKoduV1,
  MEDYA_HATA_KODLARI,
  MEDYA_SINIRLARI,
  SINIRLAR,
  SOHBET_HATA_KODLARI,
  SOHBET_SINIRLARI,
} from "../src/index.ts";

test("hata listesi kapalıdır ve yinelenmez", () => {
  assert.equal(new Set(HATA_KODLARI).size, HATA_KODLARI.length);
  for (const kod of HATA_KODLARI) assert.equal(HataKodu.safeParse(kod).success, true, kod);
  assert.equal(HataKodu.safeParse("uyduruk").success, false);
  assert.equal(HataKodu.safeParse("").success, false);
  assert.equal(HataKodu.safeParse(1).success, false);
});

test("kararlardaki kodlar listededir", () => {
  for (const kod of ["telefon_bagli_degil", "belirsiz"]) {
    assert.ok((HATA_KODLARI as readonly string[]).includes(kod), kod);
  }
});

test("kodlar kablo biçimindedir", () => {
  for (const kod of HATA_KODLARI) assert.match(kod, /^[a-z][a-z_]*$/);
});

// Kotlin `HataKodu` (IcSozlesme.kt) bu kümeyi birebir kopyalar: değişirse Kotlin de değişmelidir.
const V1_KODLARI = [
  "protokol_uyumsuz", "gecersiz_mesaj", "mesaj_cok_buyuk", "zaman_asimi", "ic_hata",
  "yetkisiz", "imza_gecersiz", "ip_uyusmuyor", "cihaz_bilinmiyor", "kanal_desteklenmiyor",
  "eslestirme_kapali", "eslestirme_kodu_gecersiz", "telefon_bagli_degil", "belirsiz",
  "plan_gecersiz", "plan_bulunamadi", "plan_hash_uyusmuyor", "plan_zaten_sonuclandi", "izin_bekleniyor",
  "is_bulunamadi", "is_zaten_bitti", "rapor_yok", "rapor_zaten_verildi",
  "soru_bulunamadi", "soru_zaten_cevaplandi", "tur_gecersiz", "eren_hazir_degil", "limit_kilitli",
  "jeton_gecersiz", "rol_fiil_izinsiz", "yinelenen_istek", "ozet_reddedildi",
];

test("v1 kod kümesi değişmedi, sırası aynı", () => {
  assert.deepEqual([...HataKoduV1.options], V1_KODLARI);
  for (const kod of [...SOHBET_HATA_KODLARI, ...MEDYA_HATA_KODLARI]) assert.equal(HataKoduV1.safeParse(kod).success, false, kod);
});

test("/sohbet'e özgü kodlar listenin sonundadır", () => {
  assert.deepEqual([...SOHBET_HATA_KODLARI], ["sohbet_mesgul", "sohbet_bulunamadi", "sohbet_siniri", "sohbet_silinemez"]);
  // Medya kodları (yetenek `medya1`) en sondadır.
  assert.deepEqual([...HATA_KODLARI], [...V1_KODLARI, ...SOHBET_HATA_KODLARI, ...MEDYA_HATA_KODLARI]);
});

test("/sohbet sınırları Kotlin'in kopyaladığı SINIRLAR'a girmez", () => {
  for (const ad of Object.keys(SOHBET_SINIRLARI)) assert.equal(ad in SINIRLAR, false, ad);
});

test("medya kodları (medya1) listenin en sonundadır, v1 kümesine girmez, ama /sohbet'te geçer", () => {
  assert.deepEqual([...MEDYA_HATA_KODLARI], ["medya_yok", "medya_reddedildi", "medya_siniri"]);
  assert.deepEqual(HATA_KODLARI.slice(-MEDYA_HATA_KODLARI.length), [...MEDYA_HATA_KODLARI]);
  for (const kod of MEDYA_HATA_KODLARI) {
    assert.equal(HataKodu.safeParse(kod).success, true, kod);
    assert.equal(HataKoduV1.safeParse(kod).success, false, kod);
  }
});

test("medya sınırları Kotlin'in kopyaladığı SINIRLAR'a girmez", () => {
  for (const ad of Object.keys(MEDYA_SINIRLARI)) assert.equal(ad in SINIRLAR, false, ad);
});
