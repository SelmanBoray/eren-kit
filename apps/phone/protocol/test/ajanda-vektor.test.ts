import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AjandaEslestirmeQr,
  ajandaAsagiCoz,
  ajandaDegisikligiUygula,
  AjandaKaydi,
  ajandaKimlikImzaMetni,
  ajandaTekilAnahtari,
  ajandaYukariCoz,
  type CihazKapsami,
  type KaynakYolu,
  type TurKokeni,
  EslestirmeQr,
  hatirlatmaEtkinMi,
  kanalKapsamdaMi,
} from "../src/index.ts";

type Oge = { ad: string; ham: string; gecerli: boolean; tur?: string; kod?: string };
const oku = (ad: string) => JSON.parse(readFileSync(new URL(`../vektorler/${ad}`, import.meta.url), "utf8"));
const mesajlar = oku("ajanda-mesaj.json") as { surum: number; asagi: Oge[]; yukari: Oge[] };
const kurallar = oku("ajanda-kurallar.json") as {
  surum: number;
  imza_metni: { ad: string; girdi: { rol: "pc" | "telefon"; device_id: string; client_nonce: string; server_nonce: string }; metin: string; utf8_hex: string }[];
  imza: { public_key: string; signature: string; dogru_metin: string; yanlis_metin: string };
  kapsam: { kapsam: CihazKapsami; kanal: string; izinli: boolean }[];
  qr: { gecerli: unknown[]; gecersiz: { ad: string; qr: unknown }[] };
  birlestirme: {
    ad: string;
    kayit: unknown;
    degisiklik: Record<string, unknown>;
    yazar: { yol: KaynakYolu; tur_kokeni: TurKokeni };
    beklenen: { uygulanan: string[]; korunan: string[]; elle_alanlar: string[]; kaldirilan?: string[] };
  }[];
  hatirlatma_etkin: { taslak: boolean; silindi: boolean; durum: "acik" | "tamam" | "iptal"; etkin: boolean }[];
  tekil_anahtar: { girdi: Parameters<typeof ajandaTekilAnahtari>[0]; anahtar: string }[];
};

function dene(yon: Oge[], coz: (ham: string) => { ok: boolean; mesaj?: { type: string }; kod?: string }) {
  assert.ok(yon.length > 0);
  for (const o of yon) {
    const s = coz(o.ham);
    if (o.gecerli) {
      assert.equal(s.ok, true, o.ad);
      assert.equal(s.mesaj?.type, o.tur, o.ad);
    } else {
      assert.equal(s.ok, false, o.ad);
      assert.equal(s.kod, o.kod, o.ad);
    }
  }
}

test("ajanda vektör dosyaları sürüm 1, adlar tekil", () => {
  assert.equal(mesajlar.surum, 1);
  assert.equal(kurallar.surum, 1);
  for (const yon of [mesajlar.asagi, mesajlar.yukari]) assert.equal(new Set(yon.map((o) => o.ad)).size, yon.length);
});

test("/ajanda aşağı vektörleri çözücüyle aynı sonucu verir", () => dene(mesajlar.asagi, ajandaAsagiCoz));
test("/ajanda yukarı vektörleri çözücüyle aynı sonucu verir", () => dene(mesajlar.yukari, ajandaYukariCoz));

test("her /ajanda çerçeve türünden ve her işlemden geçerli örnek var", () => {
  const tur = (yon: Oge[]) => new Set(yon.filter((o) => o.gecerli).map((o) => o.tur));
  const asagi = tur(mesajlar.asagi);
  for (const t of ["pair_result", "auth_challenge", "welcome", "kayit", "esitlendi", "islem_sonucu", "gecmis", "error"]) {
    assert.ok(asagi.has(t), t);
  }
  const yukari = tur(mesajlar.yukari);
  for (const t of ["pair_request", "hello", "auth_response", "islem", "gecmis_iste"]) assert.ok(yukari.has(t), t);
  const islemler = new Set(
    mesajlar.yukari
      .filter((o) => o.gecerli && o.tur === "islem")
      .map((o) => (JSON.parse(o.ham) as { islem: { islem: string } }).islem.islem),
  );
  for (const i of ["ekle", "guncelle", "durum", "onayla", "sil", "geri_yukle"]) assert.ok(islemler.has(i), i);
});

test("imza metni vektörü: metin ve UTF-8 baytları", () => {
  assert.equal(kurallar.imza_metni.length, 2);
  for (const v of kurallar.imza_metni) {
    const metin = ajandaKimlikImzaMetni(v.girdi);
    assert.equal(metin, v.metin, v.ad);
    assert.equal(Buffer.from(metin, "utf8").toString("hex"), v.utf8_hex, v.ad);
  }
});

test("imza vektörü: P-256 DER imza yalnız kendi metniyle doğrulanır", () => {
  const anahtar = createPublicKey({ key: Buffer.from(kurallar.imza.public_key, "base64"), format: "der", type: "spki" });
  const imza = Buffer.from(kurallar.imza.signature, "base64");
  const metin = (ad: string) => Buffer.from(kurallar.imza_metni.find((v) => v.ad === ad)!.metin, "utf8");
  assert.equal(verify("sha256", metin(kurallar.imza.dogru_metin), { key: anahtar, dsaEncoding: "der" }, imza), true);
  assert.equal(verify("sha256", metin(kurallar.imza.yanlis_metin), { key: anahtar, dsaEncoding: "der" }, imza), false);
});

test("kapsam vektörü kanalKapsamdaMi ile aynıdır", () => {
  assert.equal(kurallar.kapsam.length, 6);
  for (const k of kurallar.kapsam) assert.equal(kanalKapsamdaMi(k.kapsam, k.kanal), k.izinli, `${k.kapsam} ${k.kanal}`);
});

test("QR vektörü: ajanda QR'ı yalnız ajanda şemasına uyar", () => {
  for (const q of kurallar.qr.gecerli) {
    assert.equal(AjandaEslestirmeQr.safeParse(q).success, true);
    assert.equal(EslestirmeQr.safeParse(q).success, false, "eski uygulama ajanda QR'ını reddetmeli");
  }
  for (const q of kurallar.qr.gecersiz) assert.equal(AjandaEslestirmeQr.safeParse(q.qr).success, false, q.ad);
});

test("birleştirme vektörü ajandaDegisikligiUygula ile aynıdır ve sonuç geçerli kayıttır", () => {
  for (const v of kurallar.birlestirme) {
    const kayit = AjandaKaydi.parse(v.kayit);
    const once = JSON.stringify(kayit);
    const s = ajandaDegisikligiUygula(kayit, v.degisiklik, v.yazar);
    assert.deepEqual(s.uygulanan, v.beklenen.uygulanan, v.ad);
    assert.deepEqual(s.korunan, v.beklenen.korunan, v.ad);
    assert.deepEqual(s.kayit.elle_alanlar, v.beklenen.elle_alanlar, v.ad);
    for (const alan of v.beklenen.kaldirilan ?? []) assert.equal(alan in s.kayit, false, v.ad);
    assert.equal(JSON.stringify(kayit), once, `${v.ad}: girdi değişmemeli`);
    assert.equal(AjandaKaydi.safeParse(s.kayit).success, true, v.ad);
  }
});

test("hatırlatma etkinliği vektörü", () => {
  for (const v of kurallar.hatirlatma_etkin) assert.equal(hatirlatmaEtkinMi(v), v.etkin, JSON.stringify(v));
});

test("tekilleştirme anahtarı vektörü", () => {
  assert.ok(kurallar.tekil_anahtar.length >= 2);
  for (const v of kurallar.tekil_anahtar) {
    assert.match(v.anahtar, /^t1:[0-9a-f]{64}$/);
    assert.equal(ajandaTekilAnahtari(v.girdi), v.anahtar);
  }
});
