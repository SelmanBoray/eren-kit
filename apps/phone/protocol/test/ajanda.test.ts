import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AJANDA_AZAMI_CERCEVE,
  AJANDA_IMZA_ONEKI,
  AJANDA_KANAL_HATALARI,
  AJANDA_RET_NEDENLERI,
  AJANDA_SINIRLARI,
  AJANDA_SURUMU,
  AjandaAsagi,
  ajandaAsagiCoz,
  ajandaDegisikligiUygula,
  AjandaEslestirmeQr,
  AjandaKaydi,
  ajandaKimlikImzaMetni,
  AjandaYukari,
  ajandaYukariCoz,
  CIHAZ_KANALLARI,
  CIHAZ_KAPSAMLARI,
  cihazYukariCoz,
  type CozumSonucu,
  EslestirmeQr,
  ESKI_CIHAZ_KAPSAMI,
  HATA_KODLARI,
  HataKoduV1,
  KAPSAM_ESLESTIRME_KANALI,
  KAPSAM_KANALLARI,
  kanalKapsamdaMi,
  kimlikImzaMetni,
  PairRequest,
  PROTOKOL_SURUMU,
  SINIRLAR,
  SOHBET_SURUMU,
  sohbetYukariCoz,
} from "../src/index.ts";
import { ANAHTAR, IMZA, NONCE } from "./ornekler.ts";

const kodu = (s: CozumSonucu<unknown>) => (s.ok ? null : s.kod);
const v = AJANDA_SURUMU;
const IST = "Europe/Istanbul";

/** En büyük geçerli kayıt: her metin sınırında, üç baytlık karakterlerle. */
function enBuyukKayit(): AjandaKaydi {
  const uc = (n: number) => "ş".repeat(n);
  return AjandaKaydi.parse({
    kayit_id: "k".repeat(SINIRLAR.OPAK_ID),
    revizyon: Number.MAX_SAFE_INTEGER,
    tur: "randevu",
    baslik: uc(AJANDA_SINIRLARI.BASLIK),
    aciklama: uc(AJANDA_SINIRLARI.ACIKLAMA),
    zaman: { kesinlik: "an", tarih: "2026-01-01", saat: "10:00", sure_dk: 60, saat_dilimi: "A".repeat(AJANDA_SINIRLARI.SAAT_DILIMI - 2) + "/B", ifade: uc(AJANDA_SINIRLARI.ZAMAN_IFADESI) },
    hatirlatmalar: Array.from({ length: AJANDA_SINIRLARI.HATIRLATMA_ADET }, (_, i) => ({ tur: "mutlak", tarih: "2026-01-01", saat: `0${i}:00`, saat_dilimi: "A".repeat(62) + "/B" })),
    tekrar: { siklik: "gunluk", aralik: 1, adet: AJANDA_SINIRLARI.TEKRAR_ADET },
    ornekler: Array.from({ length: AJANDA_SINIRLARI.ORNEK_ADET }, (_, i) => {
      const t = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
      return { tarih: t, durum: "tamam" };
    }),
    durum: "acik",
    taslak: false,
    silindi: false,
    elle_alanlar: ["tur", "baslik", "aciklama", "zaman", "hatirlatmalar", "tekrar", "durum"],
    kaynak: {
      yol: "sohbet_araci",
      tur_kokeni: "insan",
      sohbet_id: "s".repeat(64),
      kaynak_msg_id: "m".repeat(64),
      alinti: uc(AJANDA_SINIRLARI.ALINTI),
      tekil_anahtar: "t".repeat(AJANDA_SINIRLARI.TEKIL_ANAHTAR),
    },
    olusturma_ms: Number.MAX_SAFE_INTEGER,
    guncelleme_ms: Number.MAX_SAFE_INTEGER,
  });
}

test("mevcut imza metinlerinin baytları değişmedi, ajanda metni ayrı önek taşır", () => {
  const g = { device_id: "d1", client_nonce: NONCE, server_nonce: NONCE };
  assert.equal(kimlikImzaMetni({ rol: "pc", kanal: "sohbet", ...g }), `eren-auth-v1\npc\nsohbet\nd1\n${NONCE}\n${NONCE}`);
  assert.equal(kimlikImzaMetni({ rol: "telefon", kanal: "cihaz", ...g }), `eren-auth-v1\ntelefon\ncihaz\nd1\n${NONCE}\n${NONCE}`);
  assert.equal(AJANDA_IMZA_ONEKI, "eren-ajanda-auth-v1");
  const ajanda = ajandaKimlikImzaMetni({ rol: "telefon", ...g });
  assert.equal(ajanda, `eren-ajanda-auth-v1\ntelefon\nkanal:ajanda\nkapsam:ajanda\nd1\n${NONCE}\n${NONCE}`);
  for (const kanal of ["sohbet", "cihaz"] as const) {
    for (const rol of ["pc", "telefon"] as const) assert.notEqual(ajanda, kimlikImzaMetni({ rol, kanal, ...g }));
  }
  assert.notEqual(ajanda, ajandaKimlikImzaMetni({ rol: "pc", ...g }));
});

test("sürüm sabitleri bağımsız; mevcutlar değişmedi", () => {
  assert.equal(PROTOKOL_SURUMU, 1);
  assert.equal(SOHBET_SURUMU, 5);
  assert.equal(AJANDA_SURUMU, 1);
});

test("kapsamlar kanalları ayrık paylaşır; eski cihaz sohbet kapsamındadır", () => {
  assert.deepEqual([...CIHAZ_KAPSAMLARI], ["sohbet", "ajanda"]);
  assert.equal(ESKI_CIHAZ_KAPSAMI, "sohbet");
  const hepsi = CIHAZ_KAPSAMLARI.flatMap((k) => [...KAPSAM_KANALLARI[k]]);
  assert.deepEqual([...hepsi].sort(), [...CIHAZ_KANALLARI].sort(), "her kanal tam bir kapsamda");
  assert.equal(kanalKapsamdaMi("ajanda", "sohbet"), false);
  assert.equal(kanalKapsamdaMi("ajanda", "cihaz"), false);
  assert.equal(kanalKapsamdaMi("sohbet", "ajanda"), false);
  assert.equal(kanalKapsamdaMi("ajanda", "bilinmeyen"), false);
  for (const k of CIHAZ_KAPSAMLARI) assert.equal(kanalKapsamdaMi(k, KAPSAM_ESLESTIRME_KANALI[k]), true, k);
});

test("ajanda eşleştirmesi kapsam beyan edemez; ayrımı PC'deki pencere yapar", () => {
  const istek = { v, type: "pair_request", kod: "ABCD2345", public_key: ANAHTAR, platform: "android" };
  assert.equal(ajandaYukariCoz(JSON.stringify(istek)).ok, true);
  assert.equal(ajandaYukariCoz(JSON.stringify({ ...istek, kapsam: "ajanda" })).ok, false);
  // Bilinen gerçek: aynı çerçeve /sohbet'in v1 PairRequest şemasına da uyar. Bu yüzden servis,
  // açık pencerenin kapsamı o kanalın kapsamı değilse `eslestirme_kapali` döner (docs/AJANDA.md).
  assert.equal(PairRequest.safeParse(istek).success, true);
});

test("/ajanda çerçeveleri öteki kanallarda, öteki kanalların çerçeveleri /ajanda'da çözülmez", () => {
  const hello = { v, type: "hello", device_id: "d1", son_rev: 0, client_nonce: NONCE };
  assert.equal(ajandaYukariCoz(JSON.stringify(hello)).ok, true);
  assert.deepEqual(sohbetYukariCoz(JSON.stringify(hello)), { ok: false, kod: "protokol_uyumsuz", yollar: ["v"] });
  assert.equal(cihazYukariCoz(JSON.stringify(hello)).ok, false);
  const islem = { v, type: "islem", islem_id: "i1", islem: { islem: "sil", kayit_id: "k1" } };
  assert.equal(ajandaYukariCoz(JSON.stringify(islem)).ok, true);
  assert.equal(cihazYukariCoz(JSON.stringify(islem)).ok, false);
  assert.equal(sohbetYukariCoz(JSON.stringify({ ...islem, v: SOHBET_SURUMU })).ok, false);
  const sohbetHello = { v: SOHBET_SURUMU, type: "hello", device_id: "d1", last_seq: 0, client_nonce: NONCE };
  assert.equal(kodu(ajandaYukariCoz(JSON.stringify(sohbetHello))), "protokol_uyumsuz");
  const cihazHello = { v: PROTOKOL_SURUMU, type: "hello", device_id: "d1", client_nonce: NONCE };
  assert.equal(kodu(ajandaYukariCoz(JSON.stringify(cihazHello))), "gecersiz_mesaj");
  const kimlik = { v, type: "auth_challenge", server_nonce: NONCE, server_signature: IMZA };
  assert.equal(AjandaAsagi.safeParse(kimlik).success, true);
});

test("QR: eski ve ajanda QR'ı birbirinin şemasına uymaz", () => {
  const eski = { v: 1, host: "100.64.0.1", port: 1, kod: "ABCD2345", server_public_key: ANAHTAR };
  assert.equal(EslestirmeQr.safeParse(eski).success, true);
  assert.equal(AjandaEslestirmeQr.safeParse(eski).success, false);
  assert.equal(AjandaEslestirmeQr.safeParse({ ...eski, kanal: "ajanda" }).success, true);
  assert.equal(EslestirmeQr.safeParse({ ...eski, kanal: "ajanda" }).success, false);
});

test("kanal hataları v1 kümesinin altkümesidir; ret nedenleri HATA_KODLARI'na girmez", () => {
  for (const k of AJANDA_KANAL_HATALARI) assert.equal(HataKoduV1.safeParse(k).success, true, k);
  for (const k of AJANDA_RET_NEDENLERI) {
    if (k === "ic_hata") continue;
    assert.equal((HATA_KODLARI as readonly string[]).includes(k), false, k);
  }
  assert.equal(new Set(AJANDA_RET_NEDENLERI).size, AJANDA_RET_NEDENLERI.length);
  for (const k of [...AJANDA_KANAL_HATALARI, ...AJANDA_RET_NEDENLERI]) assert.match(k, /^[a-z][a-z_]*$/);
});

test("uzunluk UTF-16 birimiyle ölçülür (emoji iki birim)", () => {
  const kayit = enBuyukKayit();
  const emoji = (n: number) => "😀".repeat(n);
  const yama = (baslik: string) => AjandaKaydi.safeParse({ ...kayit, baslik }).success;
  assert.equal(yama(emoji(AJANDA_SINIRLARI.BASLIK / 2)), true);
  assert.equal(yama(emoji(AJANDA_SINIRLARI.BASLIK / 2) + "a"), false);
  assert.equal(yama("\uD83D"), false, "eşsiz vekil");
});

test("en büyük kayıt, geçmiş sayfası ve kimlik öncesi çerçeveler sınırlara sığar", () => {
  const kayit = enBuyukKayit();
  const kayitCercevesi = JSON.stringify({ v, type: "kayit", kayit });
  assert.ok(Buffer.byteLength(kayitCercevesi) < AJANDA_AZAMI_CERCEVE.KANAL / 8, String(Buffer.byteLength(kayitCercevesi)));
  assert.equal(ajandaAsagiCoz(kayitCercevesi).ok, true);

  const parca = { tur: kayit.tur, baslik: kayit.baslik, aciklama: kayit.aciklama, zaman: kayit.zaman, hatirlatmalar: kayit.hatirlatmalar, tekrar: kayit.tekrar, durum: kayit.durum, taslak: false, silindi: false };
  const girdiler = Array.from({ length: AJANDA_SINIRLARI.GECMIS_SAYFA }, (_, i) => ({
    rev: 1000 - i,
    ts_ms: 1,
    islem: "guncelle",
    yazar: { yol: "sohbet_araci", tur_kokeni: "insan", sohbet_id: "s".repeat(64) },
    temel_revizyon: 1,
    korunan_alanlar: ["tur", "baslik", "aciklama", "zaman", "hatirlatmalar", "tekrar", "durum"],
    onceki: parca,
    sonraki: parca,
  }));
  const gecmis = JSON.stringify({ v, type: "gecmis", istek_id: "g".repeat(64), kayit_id: kayit.kayit_id, girdiler, devami: true });
  assert.ok(Buffer.byteLength(gecmis) < AJANDA_AZAMI_CERCEVE.KANAL, String(Buffer.byteLength(gecmis)));
  assert.equal(ajandaAsagiCoz(gecmis).ok, true);

  // Gateway'in kimlik öncesi bayt sınırı (16 KiB) bu üç çerçevenin her birinden çok büyüktür.
  const oncesi = [
    { v, type: "pair_request", kod: "A".repeat(SINIRLAR.ESLESTIRME_KODU_MAX), public_key: "A".repeat(SINIRLAR.ACIK_ANAHTAR_MAX), platform: "android", etiket: "ğ".repeat(SINIRLAR.CIHAZ_ETIKETI) },
    { v, type: "hello", device_id: "d".repeat(64), son_rev: Number.MAX_SAFE_INTEGER, depo_id: "e".repeat(64), client_nonce: "A".repeat(SINIRLAR.NONCE_MAX) },
    { v, type: "auth_response", signature: "A".repeat(SINIRLAR.IMZA_MAX) },
  ];
  for (const m of oncesi) {
    assert.equal(AjandaYukari.safeParse(m).success, true, m.type);
    assert.ok(Buffer.byteLength(JSON.stringify(m)) < 1024, m.type);
  }
});

test("büyük çerçeve ayrıştırmadan önce reddedilir", () => {
  assert.equal(kodu(ajandaYukariCoz(" ".repeat(AJANDA_AZAMI_CERCEVE.KANAL + 1))), "mesaj_cok_buyuk");
  assert.equal(kodu(ajandaAsagiCoz(" ".repeat(AJANDA_AZAMI_CERCEVE.KANAL + 1))), "mesaj_cok_buyuk");
});

test("çözücü hata çıktısında gelen değeri yankılamaz", () => {
  const gizli = "GIZLI_DEGER_123";
  const s = ajandaYukariCoz(JSON.stringify({ v, type: "islem", islem_id: "i1", islem: { islem: "ekle", kayit_id: "k1", tur: "not", baslik: gizli + "‮", hatirlatmalar: [], girdi_yolu: "elle" } }));
  assert.equal(s.ok, false);
  assert.equal(JSON.stringify(s).includes(gizli), false);
});

test("birleştirme: insan uygulanan alanı izler, otomasyon izi değiştirmez, girdi kopyalanır", () => {
  const kayit = AjandaKaydi.parse({
    kayit_id: "k1",
    revizyon: 1,
    tur: "gorev",
    baslik: "Ekmek al",
    hatirlatmalar: [],
    ornekler: [],
    durum: "acik",
    taslak: false,
    silindi: false,
    elle_alanlar: [],
    kaynak: { yol: "sohbet_araci", tur_kokeni: "insan", sohbet_id: "ana" },
    olusturma_ms: 1,
    guncelleme_ms: 1,
  });
  const insan = ajandaDegisikligiUygula(kayit, { durum: "tamam", baslik: "Süt al" }, false);
  assert.deepEqual(insan.uygulanan, ["baslik", "durum"]);
  assert.deepEqual(insan.kayit.elle_alanlar, ["baslik", "durum"]);
  const oto = ajandaDegisikligiUygula(insan.kayit, { durum: "acik", aciklama: "x", zaman: { kesinlik: "gun", tarih: "2026-11-30", saat_dilimi: IST } }, true);
  assert.deepEqual(oto.korunan, ["durum"]);
  assert.deepEqual(oto.uygulanan, ["aciklama", "zaman"]);
  assert.deepEqual(oto.kayit.elle_alanlar, ["baslik", "durum"]);
  assert.equal(oto.kayit.durum, "tamam");
  assert.notEqual(oto.kayit.elle_alanlar, insan.kayit.elle_alanlar);
  // Tutarsız birleşimi şema yakalar: `once` hatırlatmalı kayıt `gun`a çekilirse servis `tutarsiz_kayit` döner.
  const anli = AjandaKaydi.parse({ ...kayit, zaman: { kesinlik: "an", tarih: "2026-11-30", saat: "10:00", saat_dilimi: IST }, hatirlatmalar: [{ tur: "once", dk: 10 }] });
  const bozuk = ajandaDegisikligiUygula(anli, { zaman: { kesinlik: "gun", tarih: "2026-11-30", saat_dilimi: IST } }, false);
  assert.equal(AjandaKaydi.safeParse(bozuk.kayit).success, false);
});
