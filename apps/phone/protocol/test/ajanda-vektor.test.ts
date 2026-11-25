import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AJANDA_GORUNMEZ_ARALIKLARI,
  AjandaBaslik,
  AjandaEslestirmeQr,
  ajandaAsagiCoz,
  ajandaDegisikligiUygula,
  ajandaGorunmezMi,
  AjandaKaydi,
  ajandaKimlikImzaMetni,
  ajandaOrnekDurumuUygula,
  ajandaTekilAnahtari,
  ajandaTekilKarari,
  ajandaTelafiTamMi,
  ajandaYukariCoz,
  type AnCevirici,
  type CihazKapsami,
  dayanakGecerliMi,
  type KaynakYolu,
  type TurKokeni,
  EslestirmeQr,
  gunNoTarih,
  hatirlatmaEtkinMi,
  type HatirlatmaHali,
  hatirlatmaHalleri,
  hatirlatmaOzeti,
  kanalKapsamdaMi,
  kurulacakHatirlatmalar,
  ornekGunuMu,
  tarihGunNo,
  Tekrar,
  tekrarOrnekleri,
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
    beklenen: {
      uygulanan: string[];
      korunan: string[];
      elle_alanlar: string[];
      kaldirilan?: string[];
      hatirlatmalar?: unknown[];
      ornekler?: unknown[];
      budanan_ornekler?: unknown[];
    };
  }[];
  hatirlatma_etkin: { taslak: boolean; silindi: boolean; durum: "acik" | "tamam" | "iptal"; etkin: boolean }[];
  tekil_anahtar: { girdi: Parameters<typeof ajandaTekilAnahtari>[0]; anahtar: string }[];
  gorunmez: { araliklar: [number, number][]; ornekler: { kod_noktasi: number; gorunmez: boolean }[] };
  tekil_karar: {
    ad: string;
    esler: { silindi: boolean; durum: "acik" | "tamam" | "iptal"; taslak: boolean }[];
    yazar: { yol: KaynakYolu; tur_kokeni: TurKokeni };
    karar: string;
    sira?: number;
  }[];
  telafi: (Parameters<typeof ajandaTelafiTamMi>[0] & { ad: string; tam: boolean })[];
  dayanak: { ad: string; dayanak_ms: number; tur_baslangic_ms: number; cagri_ms: number; gecerli: boolean }[];
  tekrar_ornekleri: { ad: string; capa: string; tekrar: unknown; en_az?: string; beklenen: string[]; devami: boolean }[];
  hatirlatma_plani: {
    ofset_dk: Record<string, number>;
    vakalar: { ad: string; kayit: unknown; simdi_ms: number; haller: HatirlatmaHali[]; ozet: ReturnType<typeof hatirlatmaOzeti> }[];
  };
  ornek_durumu: {
    ad: string;
    kayit: Record<string, unknown>;
    ornek_tarihi: string;
    durum: "acik" | "tamam" | "iptal";
    bugun: string;
    sonuc: {
      ok: boolean;
      neden?: string;
      degisti?: boolean;
      atilan?: unknown[];
      ornekler?: unknown[];
      ornek_sayisi?: number;
      ilk?: string;
      son?: string;
    };
  }[];
};

/** `ornekler_gunluk {bas, adet, durum}`: `bas`'tan başlayan ardışık günlük örnek satırları. */
function kayitAc(ham: Record<string, unknown>): AjandaKaydi {
  const { ornekler_gunluk, ...kayit } = ham as { ornekler_gunluk?: { bas: string; adet: number; durum: string } };
  if (ornekler_gunluk !== undefined) {
    const bas = tarihGunNo(ornekler_gunluk.bas);
    (kayit as Record<string, unknown>).ornekler = Array.from({ length: ornekler_gunluk.adet }, (_, i) => ({
      tarih: gunNoTarih(bas + i),
      durum: ornekler_gunluk.durum,
    }));
  }
  return AjandaKaydi.parse(kayit);
}

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
    if (v.beklenen.hatirlatmalar !== undefined) assert.deepEqual(s.kayit.hatirlatmalar, v.beklenen.hatirlatmalar, v.ad);
    if (v.beklenen.ornekler !== undefined) assert.deepEqual(s.kayit.ornekler, v.beklenen.ornekler, v.ad);
    if (v.beklenen.budanan_ornekler !== undefined) assert.deepEqual(s.budanan_ornekler, v.beklenen.budanan_ornekler, v.ad);
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

test("görünmez kod noktası vektörü: tablo birebir, örnekler ajandaGorunmezMi ile aynı", () => {
  assert.deepEqual(AJANDA_GORUNMEZ_ARALIKLARI.map((a) => [...a]), kurallar.gorunmez.araliklar);
  for (const o of kurallar.gorunmez.ornekler) {
    assert.equal(ajandaGorunmezMi(o.kod_noktasi), o.gorunmez, o.kod_noktasi.toString(16));
    const metin = "a" + String.fromCodePoint(o.kod_noktasi) + "b";
    if (o.kod_noktasi !== 0x0a && o.kod_noktasi !== 0x0d && o.kod_noktasi !== 0x09) {
      assert.equal(AjandaBaslik.safeParse(metin).success, !o.gorunmez, o.kod_noktasi.toString(16));
    }
  }
});

test("tekil karar vektörü", () => {
  for (const v of kurallar.tekil_karar) {
    const k = ajandaTekilKarari(v.esler, v.yazar);
    assert.equal(k.karar, v.karar, v.ad);
    assert.equal("sira" in k ? k.sira : undefined, v.sira, v.ad);
  }
});

test("telafi vektörü", () => {
  for (const v of kurallar.telafi) assert.equal(ajandaTelafiTamMi(v), v.tam, v.ad);
});

test("dayanak vektörü", () => {
  for (const v of kurallar.dayanak) assert.equal(dayanakGecerliMi(v.dayanak_ms, v.tur_baslangic_ms, v.cagri_ms), v.gecerli, v.ad);
});

test("tekrar örnekleri vektörü", () => {
  for (const v of kurallar.tekrar_ornekleri) {
    const t = Tekrar.parse(v.tekrar);
    const gen = tekrarOrnekleri(v.capa, t, v.en_az);
    const gunler: string[] = [];
    for (const g of gen) {
      gunler.push(g);
      if (gunler.length === v.beklenen.length) break;
    }
    assert.deepEqual(gunler, v.beklenen, v.ad);
    const sonraki = [...tekrarOrneklerindenSonraki(v.capa, t, v.en_az, v.beklenen.length)];
    assert.equal(sonraki.length > 0, v.devami, `${v.ad}: devami`);
    for (const g of v.beklenen) assert.equal(ornekGunuMu(v.capa, t, g), true, `${v.ad}: ${g}`);
  }
});

function tekrarOrneklerindenSonraki(capa: string, t: Tekrar, enAz: string | undefined, atla: number): string[] {
  let i = 0;
  for (const g of tekrarOrnekleri(capa, t, enAz)) if (i++ === atla) return [g];
  return [];
}

test("hatırlatma planı vektörü: hal, kurulacaklar ve özet", () => {
  const { ofset_dk, vakalar } = kurallar.hatirlatma_plani;
  const anCevir: AnCevirici = (tarih, saat, dilim) => {
    const ofset = ofset_dk[dilim];
    assert.notEqual(ofset, undefined, dilim);
    return Date.parse(`${tarih}T${saat}:00Z`) - ofset! * 60_000;
  };
  for (const v of vakalar) {
    const kayit = AjandaKaydi.parse(v.kayit);
    assert.deepEqual(hatirlatmaHalleri(kayit, v.simdi_ms, anCevir), v.haller, v.ad);
    const beklenenKurulacak = hatirlatmaEtkinMi(kayit) ? v.haller.filter((h) => h.hal === "kurulur") : [];
    assert.deepEqual(kurulacakHatirlatmalar(kayit, v.simdi_ms, anCevir), beklenenKurulacak, v.ad);
    assert.deepEqual(hatirlatmaOzeti(kayit, v.simdi_ms, anCevir), v.ozet, v.ad);
    for (const h of kurulacakHatirlatmalar(kayit, v.simdi_ms, anCevir)) assert.ok(h.tetik_ms > v.simdi_ms, v.ad);
  }
});

test("örnek durumu vektörü", () => {
  for (const v of kurallar.ornek_durumu) {
    const kayit = kayitAc(v.kayit);
    const s = ajandaOrnekDurumuUygula(kayit, v.ornek_tarihi, v.durum, v.bugun);
    assert.equal(s.ok, v.sonuc.ok, v.ad);
    if (!s.ok) {
      assert.equal(s.neden, v.sonuc.neden, v.ad);
      continue;
    }
    assert.equal(s.degisti, v.sonuc.degisti, v.ad);
    assert.deepEqual(s.atilan, v.sonuc.atilan, v.ad);
    if (v.sonuc.ornekler !== undefined) assert.deepEqual(s.ornekler, v.sonuc.ornekler, v.ad);
    if (v.sonuc.ornek_sayisi !== undefined) {
      assert.equal(s.ornekler.length, v.sonuc.ornek_sayisi, v.ad);
      assert.equal(s.ornekler[0]!.tarih, v.sonuc.ilk, v.ad);
      assert.equal(s.ornekler.at(-1)!.tarih, v.sonuc.son, v.ad);
    }
    assert.equal(AjandaKaydi.safeParse({ ...kayit, ornekler: s.ornekler }).success, true, `${v.ad}: sonuç geçerli kayıt`);
  }
});
