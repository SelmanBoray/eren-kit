/**
 * Medya yöneticisi (S4): yükleme durum makinesi, doğrulama, tek işçili işleme, içerik önbelleği, kota ve
 * tahliye, süpürme, açılış uzlaştırması, silme ve kapanış. Sahte dosya portu ve işleyici, gerçek `:memory:`
 * depo, gerçek `veriyolu` ve `medya-metin`. MODULLER.md "Medya dalgası" > "S4 yönetici".
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MEDYA_SINIRLARI } from "@eren/protocol";
import type { EkBilgisi, MedyaMime, MedyaTuru, SohbetId } from "@eren/protocol";
import { depoKur } from "../src/depo.ts";
import { medyaKur } from "../src/medya.ts";
import type {
  AracCalismasi,
  MedyaAyari,
  MedyaBicimi,
  MedyaIcerigiDurumu,
  MedyaKaydi,
  MedyaYoneticisi,
  ServisOlaylari,
  SohbetSecimi,
} from "../src/sozlesme.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import {
  SAHTE_MEDYA_SINIRLARI,
  sahteGunluk,
  sahteMedyaAyari,
  sahteMedyaBaytlari,
  sahteMedyaDosya,
  sahteMedyaIsleyici,
  sahteRastgele,
  sahteSistem,
  sahteZaman,
} from "./sahte.ts";

// ---------------------------------------------------------------------------------------------
// Kurulum
// ---------------------------------------------------------------------------------------------

const A_ID: SohbetId = "sohbet-a";
const B_ID: SohbetId = "sohbet-b";
const A: SohbetSecimi = { sohbet_id: A_ID };
const TEL = "cihaz-tel";
const PARCA = 512;

const yoneticiler: MedyaYoneticisi[] = [];
afterEach(async () => {
  for (const m of yoneticiler.splice(0)) await m.kapat();
});

const kur = (ayar: Partial<MedyaAyari> = {}) => {
  const zaman = sahteZaman();
  const gunluk = sahteGunluk();
  const depo = depoKur({ yol: ":memory:", saat: zaman.saat, gunluk });
  depo.sohbetEkle({ sohbet_id: A_ID, ad: "A", olusturma_ms: 1, son_etkinlik_ms: 1 });
  depo.sohbetEkle({ sohbet_id: B_ID, ad: "B", olusturma_ms: 2, son_etkinlik_ms: 2 });
  const dosya = sahteMedyaDosya();
  const isleyici = sahteMedyaIsleyici(dosya);
  const veriyolu = veriyoluKur({ gunluk });
  const olaylar: ServisOlaylari["medya_durumu"][] = [];
  veriyolu.dinle("medya_durumu", (o) => olaylar.push(o));
  const sistem = sahteSistem();
  const rastgele = sahteRastgele();
  const medyaAyari = sahteMedyaAyari(ayar);
  const yeni = (): MedyaYoneticisi => {
    const m = medyaKur({
      ayar: medyaAyari,
      ramDusukMb: 500,
      depo,
      dosya,
      isleyici,
      saat: zaman.saat,
      zamanlayici: zaman.zamanlayici,
      rastgele,
      sistem,
      veriyolu,
      gunluk,
    });
    yoneticiler.push(m);
    return m;
  };
  return { zaman, gunluk, depo, dosya, isleyici, veriyolu, olaylar, sistem, yeni, medya: yeni() };
};
type Kurulum = ReturnType<typeof kur>;

const MIME: Readonly<Record<MedyaBicimi, MedyaMime>> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  "3gp": "video/3gpp",
  webm: "video/webm",
};
const turu = (bicim: MedyaBicimi): MedyaTuru => (MIME[bicim].startsWith("image/") ? "foto" : "video");

const ek = (medya_id: string, bicim: MedyaBicimi, boyut: number): EkBilgisi => ({
  medya_id,
  tur: turu(bicim),
  mime: MIME[bicim],
  boyut,
});

const baslat = (t: Kurulum, medya_id: string, bicim: MedyaBicimi, boyut: number, sohbet_id: SohbetId = A_ID) =>
  t.medya.yuklemeBaslat(TEL, { ...ek(medya_id, bicim, boyut), sohbet_id });

const b64 = (b: Uint8Array): string => Buffer.from(b).toString("base64");
const parca = (t: Kurulum, medya_id: string, ofset: number, bayt: Uint8Array) =>
  t.medya.parca(TEL, { medya_id, ofset, veri: b64(bayt) });

/** Baştan sona yükler; son parçanın yanıtını döner. */
const yukle = async (t: Kurulum, medya_id: string, bicim: MedyaBicimi, boyut = 1000, sohbet_id: SohbetId = A_ID) => {
  const icerik = sahteMedyaBaytlari(bicim, boyut);
  const b = await baslat(t, medya_id, bicim, boyut, sohbet_id);
  assert.equal(b.durum, "yukleniyor");
  let son = b;
  for (let o = 0; o < boyut; o += PARCA) son = await parca(t, medya_id, o, icerik.subarray(o, Math.min(boyut, o + PARCA)));
  return son;
};

const kayit = (t: Kurulum, medya_id: string): MedyaKaydi => {
  const k = t.depo.medyaKaydiBul(TEL, medya_id);
  assert.ok(k, `kayıt yok: ${medya_id}`);
  return k;
};

/** `konusma.insanMesajiAl`'ın işlemi gibi: kuyruk satırı + bağlama tek işlemde. */
const bagla = (t: Kurulum, ekler: EkBilgisi[], msg = "msg-1", sohbet: SohbetSecimi = A): number =>
  t.depo.islem(() => {
    const kuyruk_id = t.depo.kuyrugaEkle("insan", "bak", t.zaman.simdi(), sohbet);
    t.medya.ekleriBagla({ device_id: TEL, sohbet, ekler: [...ekler], kuyruk_id, client_msg_id: msg });
    return kuyruk_id;
  });

/** `icerik` `hazir` olana dek arka okumayı bekler. */
const hazirIcerik = async (t: Kurulum, kuyruk_id: number, kullanici_metni = "bak") => {
  let d: MedyaIcerigiDurumu = t.medya.icerik({ kuyruk_id, kullanici_metni });
  for (let i = 0; i < 5 && d.durum === "bekliyor"; i++) {
    await t.medya.bekle();
    d = t.medya.icerik({ kuyruk_id, kullanici_metni });
  }
  return d;
};

/** Elle çözülen söz. */
const kapi = () => {
  let ac!: () => void;
  const p = new Promise<void>((r) => {
    ac = r;
  });
  return { p, ac };
};
const birkacTur = async (n = 20): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r));
};

// ---------------------------------------------------------------------------------------------
// Yükleme
// ---------------------------------------------------------------------------------------------

describe("medya: yükleme", () => {
  it("sıralı parçalar yazılır, son parçada doğrulanır ve kabul edilir (fotoğraf hemen hazır)", async () => {
    const t = kur();
    await t.medya.baslat();
    const b = await baslat(t, "m-1", "jpg", 1000);
    assert.deepEqual(b, { medya_id: "m-1", durum: "yukleniyor", alinan: 0 });
    const icerik = sahteMedyaBaytlari("jpg", 1000);
    assert.deepEqual(await parca(t, "m-1", 0, icerik.subarray(0, 512)), {
      medya_id: "m-1",
      durum: "yukleniyor",
      alinan: 512,
    });
    const son = await parca(t, "m-1", 512, icerik.subarray(512));
    assert.deepEqual(son, { medya_id: "m-1", durum: "kabul", isleme: "hazir" });
    const k = kayit(t, "m-1");
    assert.equal(k.durum, "kabul");
    assert.equal(k.alinan, 1000);
    assert.equal(k.bicim, "jpg");
    assert.deepEqual(t.dosya.icerik(k.no, "asil.jpg"), icerik);
    assert.equal(t.dosya.parcaIcerigi(k.no), null);
    assert.ok((t.dosya.icerik(k.no, "gorsel.jpg")?.length ?? 0) > 0);
    // Kabul olayı ilgili cihaza ve sohbete.
    assert.deepEqual(t.olaylar.at(-1), {
      device_id: TEL,
      sohbet_id: A_ID,
      durum: { medya_id: "m-1", durum: "kabul", isleme: "hazir" },
    });
  });

  it("media_begin idempotent: aynı kimlik güncel durumu, farklı beyan medya_reddedildi döner", async () => {
    const t = kur();
    await t.medya.baslat();
    await baslat(t, "m-1", "mp4", 1000);
    await parca(t, "m-1", 0, sahteMedyaBaytlari("mp4", 1000).subarray(0, 512));
    assert.deepEqual(await baslat(t, "m-1", "mp4", 1000), { medya_id: "m-1", durum: "yukleniyor", alinan: 512 });
    assert.deepEqual(await baslat(t, "m-1", "mp4", 999), { medya_id: "m-1", durum: "reddedildi", code: "medya_reddedildi" });
    assert.deepEqual(await baslat(t, "m-1", "mp4", 1000, B_ID), {
      medya_id: "m-1",
      durum: "reddedildi",
      code: "medya_reddedildi",
    });
    // Kayda dokunulmadı.
    assert.equal(kayit(t, "m-1").durum, "yukleniyor");
    assert.equal(t.depo.medyaKayitlari().length, 1);
  });

  it("bilinmeyen ya da silinmiş sohbet medya_yok", async () => {
    const t = kur();
    await t.medya.baslat();
    assert.deepEqual(await baslat(t, "m-1", "jpg", 100, "yok-sohbet"), { medya_id: "m-1", durum: "reddedildi", code: "medya_yok" });
    t.depo.sohbetiSil({ sohbet_id: B_ID }, 5);
    assert.equal((await baslat(t, "m-2", "jpg", 100, B_ID)).code, "medya_yok");
    assert.equal(t.depo.medyaKayitlari().length, 0);
  });

  it("yinelenen ve ileri ofset yazılmaz, güncel alinan döner", async () => {
    const t = kur();
    await t.medya.baslat();
    const icerik = sahteMedyaBaytlari("mp4", 1500);
    await baslat(t, "m-1", "mp4", 1500);
    await parca(t, "m-1", 0, icerik.subarray(0, 512));
    // Yinelenen (pencere yeniden gönderdi) ve ileri ofset.
    assert.deepEqual(await parca(t, "m-1", 0, icerik.subarray(0, 512)), { medya_id: "m-1", durum: "yukleniyor", alinan: 512 });
    assert.deepEqual(await parca(t, "m-1", 1024, icerik.subarray(1024)), { medya_id: "m-1", durum: "yukleniyor", alinan: 512 });
    assert.equal(t.dosya.cagrilar.say("parcaEkle"), 1);
    assert.equal(t.dosya.parcaIcerigi(kayit(t, "m-1").no)?.length, 512);
    // Telefon alinan'dan sürer.
    await parca(t, "m-1", 512, icerik.subarray(512, 1024));
    const son = await parca(t, "m-1", 1024, icerik.subarray(1024));
    assert.equal(son.durum, "kabul");
  });

  it("aynı kaydın eşzamanlı iki parçası sırayla işlenir (pencere 2)", async () => {
    const t = kur();
    await t.medya.baslat();
    const icerik = sahteMedyaBaytlari("mp4", 1024);
    await baslat(t, "m-1", "mp4", 1024);
    const [p1, p2] = await Promise.all([
      parca(t, "m-1", 0, icerik.subarray(0, 512)),
      parca(t, "m-1", 512, icerik.subarray(512)),
    ]);
    assert.deepEqual(p1, { medya_id: "m-1", durum: "yukleniyor", alinan: 512 });
    assert.equal(p2.durum, "kabul");
  });

  it("boyutu aşan parça kaydı reddeder ve .part silinir; aynı begin aynı kodu alır", async () => {
    const t = kur();
    await t.medya.baslat();
    const icerik = sahteMedyaBaytlari("mp4", 1200);
    await baslat(t, "m-1", "mp4", 1000);
    await parca(t, "m-1", 0, icerik.subarray(0, 512));
    const no = kayit(t, "m-1").no;
    const r = await parca(t, "m-1", 512, icerik.subarray(512, 1100));
    assert.deepEqual(r, { medya_id: "m-1", durum: "reddedildi", code: "medya_reddedildi" });
    assert.equal(t.dosya.parcaIcerigi(no), null);
    assert.equal(kayit(t, "m-1").red_kodu, "medya_reddedildi");
    assert.deepEqual(await baslat(t, "m-1", "mp4", 1000), r);
    assert.deepEqual(await parca(t, "m-1", 512, icerik.subarray(512, 1000)), r);
    assert.equal(t.olaylar.at(-1)?.durum.durum, "reddedildi");
  });

  it("disk yazma hatası medya_reddedildi", async () => {
    const t = kur();
    await t.medya.baslat();
    await baslat(t, "m-1", "jpg", 100);
    t.dosya.hataVer("parcaEkle", new Error("disk dolu"));
    const r = await parca(t, "m-1", 0, sahteMedyaBaytlari("jpg", 100));
    assert.deepEqual(r, { medya_id: "m-1", durum: "reddedildi", code: "medya_reddedildi" });
  });

  it("doğrulama: koklanamayan içerik, uyuşmayan beyan, üretilemeyen görsel ve uzun video reddedilir", async () => {
    const t = kur();
    await t.medya.baslat();
    // Koklanamayan (metin).
    await baslat(t, "m-1", "jpg", 64);
    const metin = new TextEncoder().encode("#EXTM3U\n".padEnd(64, "x"));
    assert.equal((await parca(t, "m-1", 0, metin)).code, "medya_reddedildi");
    // Beyan video, içerik JPEG.
    await baslat(t, "m-2", "mp4", 100);
    assert.equal((await parca(t, "m-2", 0, sahteMedyaBaytlari("jpg", 100))).code, "medya_reddedildi");
    // gorsel.jpg üretilemedi.
    t.isleyici.adimDavranisi("gorselUret", "zaman_asimi");
    assert.equal((await yukle(t, "m-3", "png", 100)).code, "medya_reddedildi");
    t.isleyici.adimDavranisi("gorselUret", "basarili");
    // Süre VIDEO_SURE_MS * 1,1'i aşıyor.
    t.isleyici.olcum = { sure_ms: MEDYA_SINIRLARI.VIDEO_SURE_MS * 1.1 + 1, genislik: 10, yukseklik: 10, video_akisi: true, ses_akisi: true };
    assert.equal((await yukle(t, "m-4", "mp4", 100)).code, "medya_reddedildi");
    // Video akışı yok.
    t.isleyici.olcum = { sure_ms: 1000, genislik: null, yukseklik: null, video_akisi: false, ses_akisi: true };
    assert.equal((await yukle(t, "m-5", "mp4", 100)).code, "medya_reddedildi");
    // Reddedilenlerin dizini kalmadı.
    for (const k of t.depo.medyaKayitlari()) {
      assert.equal(k.durum, "reddedildi");
      assert.equal(t.dosya.dizinVarMi(k.no), false);
      assert.equal(t.dosya.parcaIcerigi(k.no), null);
    }
  });

  it("iptal yarım ve bağlanmamış kaydı siler; bağlı kayıtta sessiz", async () => {
    const t = kur();
    await t.medya.baslat();
    await baslat(t, "m-1", "mp4", 1000);
    await parca(t, "m-1", 0, sahteMedyaBaytlari("mp4", 1000).subarray(0, 512));
    const no = kayit(t, "m-1").no;
    t.medya.iptal(TEL, { medya_id: "m-1" });
    await t.medya.bekle();
    assert.equal(t.depo.medyaKaydiBul(TEL, "m-1"), null);
    assert.equal(t.dosya.parcaIcerigi(no), null);
    // Yeniden başlatma sıfırdan.
    assert.deepEqual(await baslat(t, "m-1", "mp4", 1000), { medya_id: "m-1", durum: "yukleniyor", alinan: 0 });
    assert.notEqual(kayit(t, "m-1").no, no);

    // Kabul edilmiş, bağlanmamış: silinir.
    await yukle(t, "m-2", "jpg", 100);
    const no2 = kayit(t, "m-2").no;
    t.medya.iptal(TEL, { medya_id: "m-2" });
    await t.medya.bekle();
    assert.equal(t.depo.medyaKaydiBul(TEL, "m-2"), null);
    assert.equal(t.dosya.dizinVarMi(no2), false);

    // Bağlı: dokunulmaz. Bilinmeyen: sessiz.
    await yukle(t, "m-3", "jpg", 100);
    bagla(t, [ek("m-3", "jpg", 100)]);
    t.medya.iptal(TEL, { medya_id: "m-3" });
    t.medya.iptal(TEL, { medya_id: "yok" });
    await t.medya.bekle();
    assert.equal(kayit(t, "m-3").durum, "kabul");
  });

  it("bekleyen kayıt sınırı: cihaz başına BEKLEYEN_YUKLEME, aşan medya_siniri", async () => {
    const t = kur();
    await t.medya.baslat();
    for (let i = 0; i < MEDYA_SINIRLARI.BEKLEYEN_YUKLEME; i++) {
      assert.equal((await baslat(t, `m-${i}`, "jpg", 100)).durum, "yukleniyor");
    }
    assert.deepEqual(await baslat(t, "m-fazla", "jpg", 100), { medya_id: "m-fazla", durum: "reddedildi", code: "medya_siniri" });
    // Başka cihaz etkilenmez.
    const o = await t.medya.yuklemeBaslat("baska-cihaz", { ...ek("m-x", "jpg", 100), sohbet_id: A_ID });
    assert.equal(o.durum, "yukleniyor");
    // Biri bağlanınca yer açılır.
    const icerik = sahteMedyaBaytlari("jpg", 100);
    await parca(t, "m-0", 0, icerik);
    bagla(t, [ek("m-0", "jpg", 100)]);
    assert.equal((await baslat(t, "m-fazla", "jpg", 100)).durum, "yukleniyor");
  });
});

// ---------------------------------------------------------------------------------------------
// Kota ve tahliye
// ---------------------------------------------------------------------------------------------

describe("medya: kota ve tahliye", () => {
  /** Kabul + bağla + kuyruk satırını sil (gönderilmiş ek: tahliye adayı). */
  const gonderilmis = async (t: Kurulum, medya_id: string, boyut: number) => {
    await yukle(t, medya_id, "jpg", boyut);
    const kuyruk_id = bagla(t, [ek(medya_id, "jpg", boyut)], `msg-${medya_id}`);
    t.depo.kuyruktanSil([kuyruk_id]);
    return kayit(t, medya_id).no;
  };

  it("kotayı aşan begin en eski gönderilmiş medyayı siler, yetecek kadarını", async () => {
    const t = kur({ kotaBayt: 3000 });
    await t.medya.baslat();
    const eski = await gonderilmis(t, "m-1", 1000);
    t.zaman.ilerlet(1000);
    const orta = await gonderilmis(t, "m-2", 1000);
    t.zaman.ilerlet(1000);
    // Kuyrukta bekleyen (bağı duran) ve bağlanmamış kayıt aday değildir.
    await yukle(t, "m-3", "jpg", 500);
    bagla(t, [ek("m-3", "jpg", 500)], "msg-3");

    // 2500 + 1400 > 3000: yalnız en eski (1000) silinir → 1500 + 1400 ≤ 3000.
    const r = await baslat(t, "m-yeni", "mp4", 1400);
    assert.equal(r.durum, "yukleniyor");
    await t.medya.bekle();
    assert.equal(t.depo.medyaKaydiGetir(eski), null);
    assert.equal(t.dosya.dizinVarMi(eski), false);
    assert.equal(t.depo.medyaKaydiGetir(orta)?.durum, "kabul");
    assert.equal(kayit(t, "m-3").durum, "kabul");
    assert.ok(t.gunluk.bul("medya_tahliye").length === 1);
  });

  it("tahliye de yetmeyecekse hiçbir şey silinmez, medya_siniri", async () => {
    const t = kur({ kotaBayt: 3000 });
    await t.medya.baslat();
    const eski = await gonderilmis(t, "m-1", 1000);
    await yukle(t, "m-2", "jpg", 1500); // bağlanmamış: aday değil
    // 2500 - 1000 + 2000 > 3000
    assert.deepEqual(await baslat(t, "m-yeni", "mp4", 2000), { medya_id: "m-yeni", durum: "reddedildi", code: "medya_siniri" });
    assert.equal(t.depo.medyaKaydiGetir(eski)?.durum, "kabul");
    assert.equal(t.depo.medyaKaydiBul(TEL, "m-yeni"), null);
  });

  it("silinemeyen aday yer açmaz: kilitliyse medya_siniri, satır silinecek kalır", async () => {
    const t = kur({ kotaBayt: 2000 });
    await t.medya.baslat();
    const eski = await gonderilmis(t, "m-1", 1000);
    t.dosya.kilitle(eski);
    assert.equal((await baslat(t, "m-yeni", "mp4", 1500)).code, "medya_siniri");
    assert.equal(t.depo.medyaKaydiGetir(eski)?.durum, "silinecek");
    // Kilit kalkınca süpürme siler; sonra yer var.
    t.dosya.kilitle(eski, false);
    t.zaman.ilerlet(SAHTE_MEDYA_SINIRLARI.supurmeAraligiMs);
    await t.medya.bekle();
    assert.equal(t.depo.medyaKaydiGetir(eski), null);
    assert.equal((await baslat(t, "m-yeni", "mp4", 1500)).durum, "yukleniyor");
  });
});

// ---------------------------------------------------------------------------------------------
// Süpürme
// ---------------------------------------------------------------------------------------------

describe("medya: süpürme", () => {
  it("yarimOmurMs'i dolan yarım yükleme ve bağlanmamış kabul silinir; bağlı ve taze kalır", async () => {
    const t = kur();
    await t.medya.baslat();
    await baslat(t, "m-yarim", "mp4", 1000);
    await parca(t, "m-yarim", 0, sahteMedyaBaytlari("mp4", 1000).subarray(0, 512));
    await yukle(t, "m-bagsiz", "jpg", 100);
    await yukle(t, "m-bagli", "jpg", 100);
    bagla(t, [ek("m-bagli", "jpg", 100)]);
    const yarimNo = kayit(t, "m-yarim").no;
    const bagsizNo = kayit(t, "m-bagsiz").no;

    t.zaman.ilerlet(SAHTE_MEDYA_SINIRLARI.yarimOmurMs - SAHTE_MEDYA_SINIRLARI.supurmeAraligiMs);
    await t.medya.bekle();
    await baslat(t, "m-taze", "jpg", 100);
    assert.equal(t.depo.medyaKayitlari().length, 4, "süre dolmadan dokunulmaz");

    // Sahte saat ilerlerken süren bir süpürme varsa sonraki tetik ona katılır: adım adım ilerlenir.
    for (let i = 0; i < 2; i++) {
      t.zaman.ilerlet(SAHTE_MEDYA_SINIRLARI.supurmeAraligiMs);
      await t.medya.bekle();
    }
    assert.equal(t.depo.medyaKaydiBul(TEL, "m-yarim"), null);
    assert.equal(t.depo.medyaKaydiBul(TEL, "m-bagsiz"), null);
    assert.equal(t.dosya.parcaIcerigi(yarimNo), null);
    assert.equal(t.dosya.dizinVarMi(bagsizNo), false);
    assert.equal(kayit(t, "m-bagli").durum, "kabul");
    assert.equal(kayit(t, "m-taze").durum, "yukleniyor");
    // Süresi dolan yükleme sıfırdan başlar.
    assert.deepEqual(await baslat(t, "m-yarim", "mp4", 1000), { medya_id: "m-yarim", durum: "yukleniyor", alinan: 0 });
  });

  it("eski reddedildi satırı süpürülür", async () => {
    const t = kur();
    await t.medya.baslat();
    await baslat(t, "m-1", "jpg", 64);
    await parca(t, "m-1", 0, new Uint8Array(64));
    assert.equal(kayit(t, "m-1").durum, "reddedildi");
    t.zaman.ilerlet(SAHTE_MEDYA_SINIRLARI.yarimOmurMs);
    await t.medya.bekle();
    assert.ok(t.depo.medyaKaydiBul(TEL, "m-1"));
    t.zaman.ilerlet(SAHTE_MEDYA_SINIRLARI.supurmeAraligiMs);
    await t.medya.bekle();
    assert.equal(t.depo.medyaKaydiBul(TEL, "m-1"), null);
  });
});

// ---------------------------------------------------------------------------------------------
// Açılış uzlaştırması
// ---------------------------------------------------------------------------------------------

describe("medya: açılış uzlaştırması", () => {
  it("yeniden başlatmada alinan diskten okunur; tamamlanmış .part doğrulanır; sahipsizler silinir", async () => {
    const t = kur();
    await t.medya.baslat();
    await baslat(t, "m-1", "mp4", 1000);
    await parca(t, "m-1", 0, sahteMedyaBaytlari("mp4", 1000).subarray(0, 512));
    await baslat(t, "m-2", "mp4", 1000);
    await baslat(t, "m-3", "jpg", 100);
    await t.medya.kapat();
    const [k1, k2, k3] = [kayit(t, "m-1"), kayit(t, "m-2"), kayit(t, "m-3")];
    // Disk depodan farklı: m-1'in .part'ı kısaldı (yazım yarıda), m-2'ninki yok, m-3'ünki tamamlandı.
    t.dosya.parcaKoy(k1.no, sahteMedyaBaytlari("mp4", 300));
    t.depo.medyaGuncelle(k2.no, { alinan: 700 });
    t.dosya.parcaKoy(k3.no, sahteMedyaBaytlari("jpg", 100));
    // Sahipsizler: satırsız dizin ve .part.
    t.dosya.dizinKoy(9001);
    t.dosya.parcaKoy(9002, new Uint8Array(10));

    const m = t.yeni();
    await m.baslat();
    assert.equal(t.depo.medyaKaydiGetir(k1.no)?.alinan, 300);
    assert.equal(t.depo.medyaKaydiGetir(k2.no)?.alinan, 0);
    assert.equal(t.depo.medyaKaydiGetir(k3.no)?.durum, "kabul");
    assert.equal(t.dosya.dizinVarMi(9001), false);
    assert.equal(t.dosya.parcaIcerigi(9002), null);
    assert.deepEqual(await m.yuklemeBaslat(TEL, { ...ek("m-1", "mp4", 1000), sohbet_id: A_ID }), {
      medya_id: "m-1",
      durum: "yukleniyor",
      alinan: 300,
    });
  });

  it("işlemesi bitmemiş video yeniden kuyruğa; eski çıktı başarı sayılmaz", async () => {
    const t = kur();
    const { kareUret } = t.isleyici;
    t.isleyici.kareUret = () => new Promise<AracCalismasi>(() => {}); // ilk süreçte işleme hiç bitmez
    await t.medya.baslat();
    await yukle(t, "m-1", "mp4", 1000);
    await birkacTur();
    const no = kayit(t, "m-1").no;
    assert.equal(kayit(t, "m-1").isleme, "isleniyor");
    // Servis yarıda öldü: süren araç bırakıldı (afterEach'in kapat'ı onu beklemesin).
    yoneticiler.splice(yoneticiler.indexOf(t.medya), 1);
    t.isleyici.kareUret = kareUret;
    // Önceki çalışmadan kalan çıktılar.
    t.dosya.koy(no, "kare-01.jpg", sahteMedyaBaytlari("jpg", 64));
    t.dosya.koy(no, "kare-02.jpg", sahteMedyaBaytlari("jpg", 64));
    t.dosya.koy(no, "dokum.srt", "1\n00:00:01,000 --> 00:00:02,000\neski\n");
    t.isleyici.adimDavranisi("kareUret", "bos");

    const m = t.yeni();
    await m.baslat();
    await m.bekle();
    const k = t.depo.medyaKaydiGetir(no);
    assert.equal(k?.isleme, "hata");
    assert.equal(k?.isleme_nedeni, "hata");
    assert.equal(k?.kare_adet, 0);
    assert.equal(t.dosya.icerik(no, "kare-01.jpg")?.length, 0);
    assert.equal(t.dosya.icerik(no, "kare-02.jpg")?.length, 0);
    assert.equal(t.isleyici.cagrilar.say("dokumUret"), 0);
  });

  it("silinecek kayıtların silmesi açılışta yeniden denenir; yetim bağlar silinir", async () => {
    const t = kur();
    await t.medya.baslat();
    await yukle(t, "m-1", "jpg", 100);
    const no = kayit(t, "m-1").no;
    t.depo.medyaGuncelle(no, { durum: "silinecek" });
    await t.medya.kapat();
    const m = t.yeni();
    await m.baslat();
    assert.equal(t.depo.medyaKaydiGetir(no), null);
    assert.equal(t.dosya.dizinVarMi(no), false);
  });
});

// ---------------------------------------------------------------------------------------------
// İşleme ve içerik
// ---------------------------------------------------------------------------------------------

describe("medya: işleme kuyruğu ve içerik", () => {
  it("video: kareler ve döküm, isleme olayları, hazır içerik ve hazır olayı", async () => {
    const t = kur();
    await t.medya.baslat();
    const r = await yukle(t, "m-1", "mp4", 1000);
    assert.deepEqual(r, { medya_id: "m-1", durum: "kabul" });
    await t.medya.bekle();
    const k = kayit(t, "m-1");
    assert.equal(k.isleme, "hazir");
    assert.equal(k.isleme_nedeni, null);
    assert.equal(k.kare_adet, 3);
    assert.equal(k.sure_ms, 20_000);
    assert.equal(new TextDecoder().decode(t.dosya.icerik(k.no, "dokum.txt") ?? new Uint8Array()), "[00:01] merhaba\n[00:04] nasılsın");
    assert.deepEqual(
      t.olaylar.map((o) => o.durum),
      [
        { medya_id: "m-1", durum: "kabul" },
        { medya_id: "m-1", durum: "kabul", isleme: "isleniyor" },
        { medya_id: "m-1", durum: "kabul", isleme: "hazir" },
      ],
    );

    // İçerik: bağ yokken `yok`, bağlanınca önce arka okuma (`bekliyor`), sonra `hazir` ve olay.
    assert.deepEqual(t.medya.icerik({ kuyruk_id: 999, kullanici_metni: "x" }), { durum: "yok" });
    const kuyruk_id = bagla(t, [ek("m-1", "mp4", 1000)]);
    const olaySayisi = t.olaylar.length;
    assert.deepEqual(t.medya.icerik({ kuyruk_id, kullanici_metni: "bak" }), { durum: "bekliyor" });
    await t.medya.bekle();
    assert.equal(t.olaylar.length, olaySayisi + 1, "önbellek hazır olunca medya_durumu");
    const d = t.medya.icerik({ kuyruk_id, kullanici_metni: "bak" });
    assert.equal(d.durum, "hazir");
    if (d.durum !== "hazir") return;
    assert.equal(d.gorsel_adet, 3);
    assert.equal(d.icerik[0]?.tur, "metin");
    const son = d.icerik.at(-1);
    assert.ok(son?.tur === "metin" && son.metin.endsWith("bak"));
    const metin = d.icerik.flatMap((b) => (b.tur === "metin" ? [b.metin] : [])).join("\n");
    assert.ok(metin.includes(t.dosya.yol(k.no, "asil.mp4")));
    assert.ok(metin.includes("merhaba"));
    // Tutarlı: yeniden sorulunca yine hazır; bırakılınca yeniden okunur.
    assert.equal(t.medya.icerik({ kuyruk_id, kullanici_metni: "bak" }).durum, "hazir");
    t.medya.icerikBirak(kuyruk_id);
    assert.equal(t.medya.icerik({ kuyruk_id, kullanici_metni: "bak" }).durum, "bekliyor");
  });

  it("işleme bitmeden içerik bekliyor; fotoğraf ve video birlikte", async () => {
    const t = kur();
    const kapisi = kapi();
    const { kareUret } = t.isleyici;
    t.isleyici.kareUret = async (...a) => {
      await kapisi.p; // işçinin kare aracı bekler
      return kareUret(...a);
    };
    await t.medya.baslat();
    await yukle(t, "m-f", "jpg", 100);
    await yukle(t, "m-v", "mp4", 1000);
    await birkacTur();
    const kuyruk_id = bagla(t, [ek("m-f", "jpg", 100), ek("m-v", "mp4", 1000)]);
    assert.deepEqual(t.medya.icerik({ kuyruk_id, kullanici_metni: "" }), { durum: "bekliyor" });
    await birkacTur();
    assert.deepEqual(t.medya.icerik({ kuyruk_id, kullanici_metni: "" }), { durum: "bekliyor" });
    kapisi.ac();
    const d = await hazirIcerik(t, kuyruk_id, "");
    assert.equal(d.durum, "hazir");
    if (d.durum !== "hazir") return;
    assert.equal(d.gorsel_adet, 4); // 1 fotoğraf + 3 kare
    const son = d.icerik.at(-1);
    assert.ok(son?.tur === "metin" && son.metin.includes("Kullanıcı metin yazmadı."));
  });

  it("tek işçi: iki videonun araçları üst üste binmez, bir anda tek döküm", async () => {
    const t = kur();
    await t.medya.baslat();
    let suren = 0;
    let enCok = 0;
    const sar = <A extends unknown[]>(f: (...a: A) => Promise<AracCalismasi>) => async (...a: A) => {
      suren++;
      enCok = Math.max(enCok, suren);
      await birkacTur(2);
      try {
        return await f(...a);
      } finally {
        suren--;
      }
    };
    const { kareUret, dokumUret } = t.isleyici;
    t.isleyici.kareUret = sar(kareUret);
    t.isleyici.dokumUret = sar(dokumUret);
    await Promise.all([yukle(t, "m-1", "mp4", 1000), yukle(t, "m-2", "webm", 1000)]);
    await t.medya.bekle();
    assert.equal(enCok, 1);
    assert.equal(kayit(t, "m-1").isleme, "hazir");
    assert.equal(kayit(t, "m-2").isleme, "hazir");
    const sira = t.isleyici.cagrilar.liste.filter((c) => c.ad === "kareUret" || c.ad === "dokumUret").map((c) => c.args[0]);
    // Bir kaydın bütün araçları ötekininkinden önce biter (kim önce kabul aldıysa).
    const [ilk, ikinci] = [sira[0], sira[4]];
    assert.notEqual(ilk, ikinci);
    assert.deepEqual(sira, [ilk, ilk, ilk, ilk, ikinci, ikinci, ikinci, ikinci]);
  });

  it("model yok, ses yok, RAM düşük: kismi ve neden; kare yok: hata", async () => {
    const durum = async (ayar: Partial<MedyaAyari>, hazirla: (t: Kurulum) => void) => {
      const t = kur(ayar);
      hazirla(t);
      await t.medya.baslat();
      await yukle(t, "m-1", "mp4", 1000);
      await t.medya.bekle();
      const k = kayit(t, "m-1");
      return [k.isleme, k.isleme_nedeni, k.kare_adet];
    };
    assert.deepEqual(await durum({ dokumModeli: null }, () => {}), ["kismi", "model_yok", 3]);
    assert.deepEqual(
      await durum({}, (t) => {
        t.isleyici.olcum = { sure_ms: 20_000, genislik: 10, yukseklik: 10, video_akisi: true, ses_akisi: false };
      }),
      ["kismi", "ses_yok", 3],
    );
    assert.deepEqual(
      await durum({}, (t) => {
        t.sistem.ram = { bosMb: 100, toplamMb: 16000 };
      }),
      ["kismi", "hata", 3],
    );
    assert.deepEqual(await durum({}, (t) => t.isleyici.adimDavranisi("dokumUret", "bos")), ["kismi", "hata", 3]);
    assert.deepEqual(await durum({}, (t) => t.isleyici.adimDavranisi("kareUret", "bos")), ["hata", "hata", 0]);
  });

  it("kare dosyası çıkmayan kare atlanır, kare_adet üretilenlerin sayısıdır", async () => {
    const t = kur();
    const { kareUret } = t.isleyici;
    t.isleyici.kareUret = async (no, bicim, sira, z) => (sira === 2 ? { zamanAsimi: false } : kareUret(no, bicim, sira, z));
    await t.medya.baslat();
    await yukle(t, "m-1", "mp4", 1000);
    await t.medya.bekle();
    assert.equal(kayit(t, "m-1").kare_adet, 2);
    const kuyruk_id = bagla(t, [ek("m-1", "mp4", 1000)]);
    const d = await hazirIcerik(t, kuyruk_id);
    assert.ok(d.durum === "hazir" && d.gorsel_adet === 2);
  });

  it("zaman aşımında yarım çıktı başarı sayılmaz ve boşaltılır", async () => {
    const t = kur();
    // Araç zaman aşımına uğradı ama yarım bir dosya bıraktı.
    t.isleyici.kareUret = async (no, _bicim, sira) => {
      t.dosya.koy(no, `kare-0${sira}.jpg`, sahteMedyaBaytlari("jpg", 32));
      return { zamanAsimi: true };
    };
    await t.medya.baslat();
    await yukle(t, "m-1", "mp4", 1000);
    await t.medya.bekle();
    const k = kayit(t, "m-1");
    assert.equal(k.isleme, "hata");
    assert.equal(k.isleme_nedeni, "zaman_asimi");
    assert.equal(k.kare_adet, 0);
    for (const s of [1, 2, 3] as const) assert.equal(t.dosya.icerik(k.no, `kare-0${s}.jpg`)?.length, 0);
    // Döküm de: zaman aşımında yazılan SRT kullanılmaz.
    const t2 = kur();
    t2.isleyici.dokumUret = async (no) => {
      t2.dosya.koy(no, "dokum.srt", "1\n00:00:01,000 --> 00:00:02,000\nyarım\n");
      return { zamanAsimi: true };
    };
    await t2.medya.baslat();
    await yukle(t2, "m-1", "mp4", 1000);
    await t2.medya.bekle();
    const k2 = kayit(t2, "m-1");
    assert.deepEqual([k2.isleme, k2.isleme_nedeni], ["kismi", "zaman_asimi"]);
    assert.equal(t2.dosya.icerik(k2.no, "dokum.srt")?.length, 0);
  });

  it("islemeAzamiMs dolunca elde olanla kismi; geç biten dökümün çıktısı alınmaz", async () => {
    const t = kur();
    const dokumKapisi = kapi();
    const { dokumUret } = t.isleyici;
    t.isleyici.dokumUret = async (no, bicim, sure) => {
      await dokumKapisi.p;
      return dokumUret(no, bicim, sure);
    };
    await t.medya.baslat();
    await yukle(t, "m-1", "mp4", 1000);
    await birkacTur();
    const kuyruk_id = bagla(t, [ek("m-1", "mp4", 1000)]);
    assert.equal(t.medya.icerik({ kuyruk_id, kullanici_metni: "bak" }).durum, "bekliyor");
    assert.equal(kayit(t, "m-1").isleme, "isleniyor");

    t.zaman.ilerlet(SAHTE_MEDYA_SINIRLARI.islemeAzamiMs);
    const k = kayit(t, "m-1");
    assert.deepEqual([k.isleme, k.isleme_nedeni, k.kare_adet], ["kismi", "zaman_asimi", 3]);
    assert.deepEqual(t.olaylar.at(-1)?.durum, { medya_id: "m-1", durum: "kabul", isleme: "kismi" });

    // Kullanıcı mesajı düşmez: kareler ve "döküm süresi doldu" notuyla hazır.
    let d = t.medya.icerik({ kuyruk_id, kullanici_metni: "bak" });
    assert.equal(d.durum, "bekliyor");
    for (let i = 0; i < 20 && d.durum !== "hazir"; i++) {
      await birkacTur();
      d = t.medya.icerik({ kuyruk_id, kullanici_metni: "bak" });
    }
    assert.equal(d.durum, "hazir");
    if (d.durum !== "hazir") return;
    assert.equal(d.gorsel_adet, 3);
    assert.ok(d.icerik.some((b) => b.tur === "metin" && b.metin.includes("Ses dökümü yok: döküm süresi doldu")));

    // Geç biten döküm: SRT yazılır ama boşaltılır, durum değişmez.
    dokumKapisi.ac();
    await t.medya.bekle();
    assert.equal(kayit(t, "m-1").isleme, "kismi");
    assert.equal(t.dosya.icerik(k.no, "dokum.srt")?.length, 0);
  });

  it("kuyrukta beklerken süresi dolan kayıt hata + zaman_asimi", async () => {
    const t = kur();
    const kapisi = kapi();
    const { kareUret } = t.isleyici;
    t.isleyici.kareUret = async (...a) => {
      await kapisi.p;
      return kareUret(...a);
    };
    await t.medya.baslat();
    await yukle(t, "m-1", "mp4", 1000);
    await yukle(t, "m-2", "mp4", 1000);
    t.zaman.ilerlet(SAHTE_MEDYA_SINIRLARI.islemeAzamiMs);
    assert.deepEqual([kayit(t, "m-2").isleme, kayit(t, "m-2").isleme_nedeni], ["hata", "zaman_asimi"]);
    assert.equal(kayit(t, "m-1").isleme, "hata");
    kapisi.ac();
    await t.medya.bekle();
    assert.equal(kayit(t, "m-2").isleme, "hata");
    assert.ok(!t.isleyici.cagrilar.hepsi("kareUret").some((c) => c.args[0] === kayit(t, "m-2").no));
  });
});

// ---------------------------------------------------------------------------------------------
// Ek denetimi ve bağlama
// ---------------------------------------------------------------------------------------------

describe("medya: ekleriDenetle ve ekleriBagla", () => {
  it("kodlar: yok, yükleniyor, reddedildi, başka sohbet, bağlı, beyan farkı", async () => {
    const t = kur();
    await t.medya.baslat();
    await yukle(t, "m-ok", "jpg", 100);
    await baslat(t, "m-yarim", "jpg", 100);
    await baslat(t, "m-red", "jpg", 64);
    await parca(t, "m-red", 0, new Uint8Array(64));
    await yukle(t, "m-b", "jpg", 100, B_ID);
    await yukle(t, "m-bagli", "jpg", 100);
    bagla(t, [ek("m-bagli", "jpg", 100)]);
    const d = (e: EkBilgisi) => t.medya.ekleriDenetle(TEL, A, [e]);
    assert.deepEqual(d(ek("m-ok", "jpg", 100)), { ok: true, deger: undefined });
    assert.deepEqual(d(ek("yok", "jpg", 100)), { ok: false, code: "medya_yok" });
    assert.deepEqual(d(ek("m-yarim", "jpg", 100)), { ok: false, code: "medya_yok" });
    assert.deepEqual(d(ek("m-red", "jpg", 64)), { ok: false, code: "medya_reddedildi" });
    assert.deepEqual(d(ek("m-b", "jpg", 100)), { ok: false, code: "medya_yok" });
    assert.deepEqual(d(ek("m-bagli", "jpg", 100)), { ok: false, code: "medya_yok" });
    assert.deepEqual(d(ek("m-ok", "jpg", 99)), { ok: false, code: "medya_yok" });
    assert.deepEqual(d(ek("m-ok", "png", 100)), { ok: false, code: "medya_yok" });
    assert.deepEqual(t.medya.ekleriDenetle("baska", A, [ek("m-ok", "jpg", 100)]), { ok: false, code: "medya_yok" });
    // Bağlama aynı koşulla atar ve işlem geri alınır.
    assert.throws(() => bagla(t, [ek("m-ok", "jpg", 100), ek("m-yarim", "jpg", 100)], "msg-2"));
    assert.equal(kayit(t, "m-ok").bagli_msg_id, null);
  });

  it("ekDizinleri: bağlı, silinecek olmayan kayıtların dizinleri, verilen sırayla", async () => {
    const t = kur();
    await t.medya.baslat();
    await yukle(t, "m-1", "jpg", 100);
    await yukle(t, "m-2", "jpg", 100);
    await yukle(t, "m-3", "jpg", 100);
    bagla(t, [ek("m-1", "jpg", 100), ek("m-2", "jpg", 100)]);
    const [n1, n2] = [kayit(t, "m-1").no, kayit(t, "m-2").no];
    assert.deepEqual(t.medya.ekDizinleri(A, ["m-2", "m-3", "yok", "m-1"]), [t.dosya.dizinYolu(n2), t.dosya.dizinYolu(n1)]);
  });
});

// ---------------------------------------------------------------------------------------------
// Silme ve kapanış
// ---------------------------------------------------------------------------------------------

describe("medya: silme ve kapanış", () => {
  it("sohbet silinince medya silinir; süren işleme varsa bitince", async () => {
    const t = kur();
    const kapisi = kapi();
    const { kareUret } = t.isleyici;
    t.isleyici.kareUret = async (...a) => {
      await kapisi.p;
      return kareUret(...a);
    };
    await t.medya.baslat();
    await yukle(t, "m-f", "jpg", 100);
    await yukle(t, "m-v", "mp4", 1000);
    await birkacTur();
    const [nf, nv] = [kayit(t, "m-f").no, kayit(t, "m-v").no];
    const kuyruk_id = bagla(t, [ek("m-f", "jpg", 100)]);
    assert.equal(t.medya.icerik({ kuyruk_id, kullanici_metni: "x" }).durum, "bekliyor");
    await birkacTur();

    const sonuc = t.depo.sohbetiSil(A, t.zaman.simdi());
    assert.equal(sonuc.silinecek_medya, 2);
    let bitti = false;
    const sil = t.medya.sohbetMedyasiniSil(A).then(() => {
      bitti = true;
    });
    await birkacTur();
    assert.equal(t.depo.medyaKaydiGetir(nf), null, "işlemesi olmayan hemen silinir");
    assert.equal(bitti, false, "süren işleme bitmeden söz çözülmez");
    assert.equal(t.dosya.dizinVarMi(nv), true);
    kapisi.ac();
    await sil;
    assert.equal(t.depo.medyaKaydiGetir(nv), null);
    assert.equal(t.dosya.dizinVarMi(nv), false);
    // Silinen kayıt bir daha işlenmez; içeriği gitmez.
    assert.deepEqual(t.medya.icerik({ kuyruk_id, kullanici_metni: "x" }), { durum: "yok" });
  });

  it("yükleme sürerken sohbet silinirse parça medya_yok alır, kayıt diriltilmez", async () => {
    const t = kur();
    await t.medya.baslat();
    const icerik = sahteMedyaBaytlari("mp4", 1000);
    await baslat(t, "m-1", "mp4", 1000);
    await parca(t, "m-1", 0, icerik.subarray(0, 512));
    const no = kayit(t, "m-1").no;
    t.depo.gecmisiTemizle(A);
    assert.deepEqual(await parca(t, "m-1", 512, icerik.subarray(512)), { medya_id: "m-1", durum: "reddedildi", code: "medya_yok" });
    await t.medya.sohbetMedyasiniSil(A);
    assert.equal(t.depo.medyaKaydiGetir(no), null);
    assert.equal(t.dosya.parcaIcerigi(no), null);
  });

  it("silinemeyen dizin kalır, süpürmede yeniden denenir; sohbetMedyasiniSil hiç reddetmez", async () => {
    const t = kur();
    await t.medya.baslat();
    await yukle(t, "m-1", "jpg", 100);
    const no = kayit(t, "m-1").no;
    t.depo.gecmisiTemizle(A);
    t.dosya.kilitle(no);
    await t.medya.sohbetMedyasiniSil(A);
    assert.equal(t.depo.medyaKaydiGetir(no)?.durum, "silinecek");
    t.dosya.kilitle(no, false);
    t.zaman.ilerlet(SAHTE_MEDYA_SINIRLARI.supurmeAraligiMs);
    await t.medya.bekle();
    assert.equal(t.depo.medyaKaydiGetir(no), null);
  });

  it("kapat süren aracı bekler; sonra yükleme ve parça medya_yok, öteki çağrılar etkisiz", async () => {
    const t = kur();
    const kapisi = kapi();
    const { kareUret } = t.isleyici;
    t.isleyici.kareUret = async (...a) => {
      await kapisi.p;
      return kareUret(...a);
    };
    await t.medya.baslat();
    await yukle(t, "m-1", "mp4", 1000);
    await birkacTur();
    let kapandi = false;
    const k = t.medya.kapat().then(() => {
      kapandi = true;
    });
    await birkacTur();
    assert.equal(kapandi, false);
    kapisi.ac();
    await k;
    assert.equal(kapandi, true);
    assert.deepEqual(await baslat(t, "m-2", "jpg", 100), { medya_id: "m-2", durum: "reddedildi", code: "medya_yok" });
    assert.deepEqual(await parca(t, "m-1", 0, new Uint8Array(4)), { medya_id: "m-1", durum: "reddedildi", code: "medya_yok" });
    assert.deepEqual(t.medya.ekleriDenetle(TEL, A, [ek("m-1", "mp4", 1000)]), { ok: false, code: "medya_yok" });
    t.medya.iptal(TEL, { medya_id: "m-1" });
    await t.medya.sohbetMedyasiniSil(A);
    assert.ok(t.depo.medyaKaydiBul(TEL, "m-1"));
    assert.equal(t.zaman.bekleyenSayisi(), 0, "zamanlayıcılar durdu");
  });
});
