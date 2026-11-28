import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AJANDA_EMOJI_BIRLESTIRICILERI,
  AJANDA_GORUNMEZ_ARALIKLARI,
  AJANDA_SINIRLARI,
  AjandaAciklama,
  AjandaBaslik,
  AjandaEslestirmeQr,
  ajandaAsagiCoz,
  ajandaDegisikligiUygula,
  ajandaEsDegisikligi,
  ajandaEsitlemeAdimi,
  ajandaGorunmezMi,
  ajandaGorunmezVarMi,
  ajandaHelloAlanlari,
  AjandaKaydi,
  type AjandaKopya,
  type AjandaKopyaKaydi,
  type AjandaKuyrukKarari,
  type AjandaKuyrukOlayi,
  ajandaKuyrukKarari,
  ajandaKimlikImzaMetni,
  ajandaMetniTemizle,
  ajandaOrnekDurumuUygula,
  type KacirilanHatirlatma,
  kacirilanHatirlatmalar,
  type YerelAn,
  ajandaTekilAnahtari,
  ajandaTekilKarari,
  ajandaTelafiTamMi,
  ajandaYukariCoz,
  AJANDA_ARACLARI,
  type AjandaFiili,
  AJANDA_SURUMLERI,
  AJANDA_SURUMU,
  type AjandaSurumNo,
  GUN_BOLUMLERI,
  GUN_HATIRLATMA_SAATLERI,
  GUN_HATIRLATMA_VARSAYILAN_SAATI,
  geceTeyidiEksikMi,
  type GunBolumu,
  gunHatirlatmasiYereli,
  kanonikJson,
  sha256Hex,
  utf8Bayt,
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

type Oge = { ad: string; ham: string; gecerli: boolean; tur?: string; kod?: string; islem_id?: string };
type KopyaVektoru = { depo_id?: string; son_rev: number; kayitlar: AjandaKopyaKaydi[] };
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
  tekil_anahtar: { ad: string; girdi: Parameters<typeof ajandaTekilAnahtari>[0]; anahtar: string }[];
  es_degisikligi: { ad: string; es: Pick<AjandaKaydi, "zaman">; girdi: Parameters<typeof ajandaEsDegisikligi>[1]; degisiklik: Record<string, unknown> }[];
  gorunmez: {
    araliklar: [number, number][];
    emoji_birlestiricileri: number[];
    ornekler: { kod_noktasi: number; gorunmez: boolean }[];
    metinler: { ad: string; kod_noktalari: number[]; gecerli: boolean; temiz: number[] }[];
  };
  kuyruk_karari: { ad: string; olay: AjandaKuyrukOlayi; deneme: number; karar: AjandaKuyrukKarari }[];
  esitleme: {
    ad: string;
    baslangic: KopyaVektoru;
    olaylar: ({ olay: "welcome"; depo_id: string; tam: boolean } | { olay: "kayit"; kayit: AjandaKopyaKaydi } | { olay: "esitlendi" } | { olay: "kopma" })[];
    beklenen: KopyaVektoru & { tam_suruyor: boolean; hello: ReturnType<typeof ajandaHelloAlanlari> };
  }[];
  tekil_karar: {
    ad: string;
    esler: { silindi: boolean; durum: "acik" | "tamam" | "iptal"; taslak: boolean }[];
    yazar: { yol: KaynakYolu; tur_kokeni: TurKokeni };
    karar: string;
    sira?: number;
  }[];
  telafi: (Parameters<typeof ajandaTelafiTamMi>[0] & { ad: string; tam: boolean })[];
  dayanak: { ad: string; dayanak: Parameters<typeof dayanakGecerliMi>[0]; mesaj_ani: YerelAn; gecerli: boolean }[];
  tekrar_ornekleri: { ad: string; capa: string; tekrar: unknown; en_az?: string; beklenen: string[]; devami: boolean }[];
  hatirlatma_plani: {
    ofset_dk: Record<string, number>;
    vakalar: { ad: string; kayit: unknown; simdi_ms: number; haller: HatirlatmaHali[]; ozet: ReturnType<typeof hatirlatmaOzeti> }[];
    kacirilan: { ad: string; kayit: unknown; simdi_ms: number; kurulanlar: number[]; beklenen: KacirilanHatirlatma[] }[];
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
  gun_hatirlatmasi: {
    saatler: Record<string, string>;
    varsayilan: string;
    vakalar: { ad: string; gun: string; dk: number; gun_bolumu?: GunBolumu; beklenen: { tarih: string; saat: string } }[];
  };
  gece_teyidi: { ad: string; fiil: AjandaFiili; girdi: unknown; mesaj_ani: YerelAn; tur_kokeni: TurKokeni; eksik: boolean }[];
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

function dene(yon: Oge[], coz: (ham: string) => { ok: boolean; mesaj?: { type: string }; kod?: string; islem_id?: string }) {
  assert.ok(yon.length > 0);
  for (const o of yon) {
    const s = coz(o.ham);
    if (o.gecerli) {
      assert.equal(s.ok, true, o.ad);
      assert.equal(s.mesaj?.type, o.tur, o.ad);
    } else {
      assert.equal(s.ok, false, o.ad);
      assert.equal(s.kod, o.kod, o.ad);
      assert.equal(s.islem_id, o.islem_id, `${o.ad}: islem_id`);
    }
  }
}

function kopyaAc(v: KopyaVektoru): AjandaKopya<AjandaKopyaKaydi> {
  const k: AjandaKopya<AjandaKopyaKaydi> = { son_rev: v.son_rev, kayitlar: new Map(v.kayitlar.map((x) => [x.kayit_id, x])) };
  if (v.depo_id !== undefined) k.depo_id = v.depo_id;
  return k;
}

/**
 * `ajanda-mesaj.json` ve `ajanda-kurallar.json` v2 dosyalarıdır (`surum` 2): v2 çerçeveleri v2 bağlantıda
 * çözülür, kurallar v3'te de aynen geçerlidir (v3 alanı taşımayan kayıtta v3 kuralları boş geçer, tekil
 * anahtar baytları aynı). v3'ün yeni vektörleri ayrı dosyalardadır (`ajanda-mesaj-v3.json`,
 * `ajanda-v3.json`): uygulamanın düzeneği bilmediği bölüm görünce kırılmasın.
 */
test("ajanda v2 vektör dosyaları: sürüm 2, kümede, adlar tekil", () => {
  assert.equal(AJANDA_SURUMU, 3);
  assert.equal(mesajlar.surum, 2);
  assert.equal(kurallar.surum, 2);
  assert.ok((AJANDA_SURUMLERI as readonly number[]).includes(mesajlar.surum));
  for (const yon of [mesajlar.asagi, mesajlar.yukari]) assert.equal(new Set(yon.map((o) => o.ad)).size, yon.length);
});

const baglanti = mesajlar.surum as AjandaSurumNo;
test("/ajanda aşağı vektörleri v2 bağlantıda çözücüyle aynı sonucu verir", () => dene(mesajlar.asagi, (h) => ajandaAsagiCoz(h, baglanti)));
test("/ajanda yukarı vektörleri v2 bağlantıda çözücüyle aynı sonucu verir", () => dene(mesajlar.yukari, (h) => ajandaYukariCoz(h, baglanti)));

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

test("tekilleştirme anahtarı vektörü: ifade ve süre anahtara girmez", () => {
  assert.ok(kurallar.tekil_anahtar.length >= 6);
  for (const v of kurallar.tekil_anahtar) {
    assert.match(v.anahtar, /^t1:[0-9a-f]{64}$/);
    assert.equal(ajandaTekilAnahtari(v.girdi), v.anahtar, v.ad);
  }
  const anahtar = (ad: string) => kurallar.tekil_anahtar.find((v) => v.ad === ad)!.anahtar;
  assert.equal(anahtar("yarın 3'te"), anahtar("ertesi gün bugün 3'te"));
  assert.equal(anahtar("yarın 3'te"), anahtar("ifadesiz"));
  assert.equal(anahtar("yarın 3'te"), anahtar("süre eklenmiş"));
  assert.notEqual(anahtar("yarın 3'te"), anahtar("saat farklı"));
  // v2: gün bölümü "ne zaman"dır, anahtara girer; bölümsüz gün kaydının anahtarı v1 formülüyle aynıdır.
  assert.equal(anahtar("saatsiz gün akşam"), anahtar("saatsiz gün akşam başka söz"));
  assert.notEqual(anahtar("saatsiz gün akşam"), anahtar("saatsiz gün sabah"));
  assert.notEqual(anahtar("saatsiz gün akşam"), anahtar("saatsiz gün bölümsüz (v1 biçimi)"));
  const v1 = kurallar.tekil_anahtar.find((v) => v.ad === "saatsiz gün bölümsüz (v1 biçimi)")!;
  const { ifade: _ifade, ...cekirdek } = v1.girdi.zaman as { ifade?: string };
  const v1Govde = { kapsam: v1.girdi.kapsam, tur: v1.girdi.tur, baslik: v1.girdi.baslik, zaman: cekirdek };
  assert.equal(v1.anahtar, "t1:" + sha256Hex(utf8Bayt(kanonikJson(v1Govde))));
  assert.equal(Object.keys(cekirdek).includes("gun_bolumu"), false);
});

test("gün hatırlatması vektörü: saat tablosu birebir, yerel tetik günü ve saati", () => {
  assert.deepEqual(Object.keys(kurallar.gun_hatirlatmasi.saatler), [...GUN_BOLUMLERI]);
  assert.deepEqual(kurallar.gun_hatirlatmasi.saatler, { ...GUN_HATIRLATMA_SAATLERI });
  assert.equal(kurallar.gun_hatirlatmasi.varsayilan, GUN_HATIRLATMA_VARSAYILAN_SAATI);
  assert.ok(kurallar.gun_hatirlatmasi.vakalar.length >= 6);
  for (const v of kurallar.gun_hatirlatmasi.vakalar) {
    assert.deepEqual(gunHatirlatmasiYereli(v.gun, v.dk, v.gun_bolumu), v.beklenen, v.ad);
  }
});

test("gece teyidi vektörü: girdi araç şemasından geçer, karar geceTeyidiEksikMi ile aynı", () => {
  assert.ok(kurallar.gece_teyidi.length >= 12);
  for (const v of kurallar.gece_teyidi) {
    const p = AJANDA_ARACLARI[v.fiil].girdi.safeParse(v.girdi);
    assert.equal(p.success, true, `${v.ad}: girdi geçerli`);
    assert.equal(geceTeyidiEksikMi(p.data as Parameters<typeof geceTeyidiEksikMi>[0], v.mesaj_ani, v.tur_kokeni), v.eksik, v.ad);
  }
});

test("eş değişikliği vektörü: kullanıcının bu turda söylediği alanlar", () => {
  assert.ok(kurallar.es_degisikligi.length >= 4);
  for (const v of kurallar.es_degisikligi) assert.deepEqual(ajandaEsDegisikligi(v.es, v.girdi), v.degisiklik, v.ad);
});

test("görünmez kod noktası vektörü: tablo birebir, örnekler ajandaGorunmezMi ile aynı, emoji bağlamı", () => {
  assert.deepEqual(AJANDA_GORUNMEZ_ARALIKLARI.map((a) => [...a]), kurallar.gorunmez.araliklar);
  assert.deepEqual([...AJANDA_EMOJI_BIRLESTIRICILERI], kurallar.gorunmez.emoji_birlestiricileri);
  for (const o of kurallar.gorunmez.ornekler) {
    assert.equal(ajandaGorunmezMi(o.kod_noktasi), o.gorunmez, o.kod_noktasi.toString(16));
    const metin = "a" + String.fromCodePoint(o.kod_noktasi) + "b";
    const baglamli = kurallar.gorunmez.emoji_birlestiricileri.includes(o.kod_noktasi);
    if (o.kod_noktasi !== 0x0a && o.kod_noktasi !== 0x0d && o.kod_noktasi !== 0x09) {
      assert.equal(AjandaBaslik.safeParse(metin).success, !o.gorunmez || baglamli, o.kod_noktasi.toString(16));
    }
  }
  assert.ok(kurallar.gorunmez.metinler.length >= 10);
  for (const m of kurallar.gorunmez.metinler) {
    const metin = String.fromCodePoint(...m.kod_noktalari);
    assert.equal(ajandaGorunmezVarMi(metin), !m.gecerli, m.ad);
    assert.equal(AjandaAciklama.safeParse(metin).success, m.gecerli, m.ad);
    assert.deepEqual(Array.from(ajandaMetniTemizle(metin), (c) => c.codePointAt(0)), m.temiz, `${m.ad}: temiz`);
  }
});

test("kuyruk kararı vektörü", () => {
  assert.ok(kurallar.kuyruk_karari.length >= 8);
  for (const v of kurallar.kuyruk_karari) assert.deepEqual(ajandaKuyrukKarari(v.olay, v.deneme), v.karar, v.ad);
});

test("eşitleme vektörü: olay dizisi, görünen kopya ve hello alanları", () => {
  assert.ok(kurallar.esitleme.length >= 5);
  for (const v of kurallar.esitleme) {
    let d = kopyaAc(v.baslangic);
    for (const o of v.olaylar) d = ajandaEsitlemeAdimi(d, o);
    assert.equal(d.depo_id, v.beklenen.depo_id, `${v.ad}: depo_id`);
    assert.equal(d.son_rev, v.beklenen.son_rev, `${v.ad}: son_rev`);
    const kayitlar = [...d.kayitlar.values()].sort((a, b) => (a.kayit_id < b.kayit_id ? -1 : 1));
    assert.deepEqual(kayitlar, v.beklenen.kayitlar, `${v.ad}: kayitlar`);
    assert.equal(d.tam !== undefined, v.beklenen.tam_suruyor, `${v.ad}: tam`);
    assert.deepEqual(ajandaHelloAlanlari(d), v.beklenen.hello, `${v.ad}: hello`);
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

test("dayanak vektörü: turun mesaj anı, aynı yerel gün", () => {
  assert.ok(kurallar.dayanak.length >= 8);
  for (const v of kurallar.dayanak) assert.equal(dayanakGecerliMi(v.dayanak, v.mesaj_ani), v.gecerli, v.ad);
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
    // Gün hatırlatmasının tetiği, yerel gününün ve saatinin kaydın dilimindeki anıdır; kayıt saatsiz kalır.
    for (const h of v.haller) {
      if (h.hal === "saatsiz" || h.gun_hatirlatmasi === undefined) continue;
      assert.equal(kayit.zaman?.kesinlik, "gun", v.ad);
      const dilim = (kayit.zaman as { saat_dilimi: string }).saat_dilimi;
      if (h.hal === "kurulur") assert.equal(h.tetik_ms, anCevir(h.gun_hatirlatmasi.tarih, h.gun_hatirlatmasi.saat, dilim), v.ad);
    }
  }
  assert.ok(kurallar.hatirlatma_plani.kacirilan.length >= 6);
  for (const v of kurallar.hatirlatma_plani.kacirilan) {
    const kayit = AjandaKaydi.parse(v.kayit);
    const k = kacirilanHatirlatmalar(kayit, v.simdi_ms, anCevir, v.kurulanlar);
    assert.deepEqual(k, v.beklenen, v.ad);
    for (const h of k) assert.ok(h.tetik_ms <= v.simdi_ms && v.simdi_ms - h.tetik_ms < AJANDA_SINIRLARI.KACIRILAN_PENCERE_DK * 60_000, v.ad);
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
