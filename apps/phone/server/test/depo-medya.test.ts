/**
 * Depo, medya dalgası (ek göç 8, S1): `medya`, `kuyruk_medyalari`, `nesil_gorselleri`; `MedyaDeposu`
 * yüzeyi; "geçmişi sil", "sohbeti sil" ve `kuyruktanSil`'in medya adımları; `sonKonusma` ekleri.
 * Gerçek depo (`:memory:` ya da geçici dosya). MODULLER.md "Medya dalgası" > "S1 depo".
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, afterEach, describe, it } from "node:test";
import { ANA_SOHBET_ID, MEDYA_SINIRLARI } from "@eren/protocol";
import type { EkListesi, SohbetId } from "@eren/protocol";
import { depoAc, depoKur } from "../src/depo.ts";
import type { CihazYonetimliDepo } from "../src/depo.ts";
import type { MedyaKaydi, MedyaliDepo, MedyaliDepoFabrikasi, SohbetSecimi } from "../src/sozlesme.ts";
import { sahteGunluk, sahteZaman } from "./sahte.ts";

// ---------------------------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------------------------

const kok = mkdtempSync(join(tmpdir(), "eren-depo-medya-test-"));
after(() => rmSync(kok, { recursive: true, force: true }));
let sayac = 0;
const yeniYol = (): string => join(kok, `vt-${++sayac}.db`);

const ANA: SohbetSecimi = { sohbet_id: ANA_SOHBET_ID };
const A_ID: SohbetId = "sohbet-a";
const B_ID: SohbetId = "sohbet-b";
const A: SohbetSecimi = { sohbet_id: A_ID };
const B: SohbetSecimi = { sohbet_id: B_ID };
const TEL = "cihaz-tel";

const MEDYA_TABLOLARI = ["medya", "kuyruk_medyalari", "nesil_gorselleri"] as const;

const acilanlar: CihazYonetimliDepo[] = [];
afterEach(() => {
  for (const d of acilanlar.splice(0)) {
    try {
      d.kapat();
    } catch {
      // zaten kapalı
    }
  }
});

const kur = (yol = ":memory:") => {
  const zaman = sahteZaman();
  const gunluk = sahteGunluk();
  const depo = depoAc({ yol, saat: zaman.saat, gunluk });
  acilanlar.push(depo);
  return { depo, zaman, gunluk };
};

/** `A` ve `B` sohbetleri açılmış depo. */
const sohbetli = (yol = ":memory:") => {
  const k = kur(yol);
  k.depo.sohbetEkle({ sohbet_id: A_ID, ad: "A", olusturma_ms: 1, son_etkinlik_ms: 1 });
  k.depo.sohbetEkle({ sohbet_id: B_ID, ad: "B", olusturma_ms: 2, son_etkinlik_ms: 2 });
  return k;
};

const hamAc = <T>(yol: string, f: (h: DatabaseSync) => T): T => {
  const h = new DatabaseSync(yol);
  try {
    return f(h);
  } finally {
    h.close();
  }
};

type AcGirdisi = Parameters<MedyaliDepo["medyaKaydiAc"]>[0];

const foto = (medya_id: string, ek: Partial<AcGirdisi> = {}): AcGirdisi => ({
  device_id: TEL,
  medya_id,
  sohbet_id: ANA_SOHBET_ID,
  tur: "foto",
  mime: "image/jpeg",
  boyut: 1000,
  olusturma_ms: 100,
  ...ek,
});
const video = (medya_id: string, ek: Partial<AcGirdisi> = {}): AcGirdisi =>
  foto(medya_id, { tur: "video", mime: "video/mp4", boyut: 5000, ...ek });

/** Kaydı açar ve `kabul` yapar (bağlanabilir). */
const kabulAc = (depo: MedyaliDepo, g: AcGirdisi): MedyaKaydi => {
  const k = depo.medyaKaydiAc(g);
  depo.medyaGuncelle(k.no, { durum: "kabul", alinan: g.boyut, bicim: "jpg", guncelleme_ms: g.olusturma_ms + 1 });
  return depo.medyaKaydiGetir(k.no)!;
};

/** Kuyruk satırı + bağ, `konusma`'nın işlemindeki gibi tek işlemde. */
const kuyrugaBagli = (depo: MedyaliDepo, sohbet: SohbetSecimi, nolar: number[], msg = "msg-1"): number =>
  depo.islem(() => {
    const kuyruk_id = depo.kuyrugaEkle("insan", "bak", 500, sohbet);
    depo.medyaKuyrugaBagla({ kuyruk_id, client_msg_id: msg, nolar, ms: 600 });
    return kuyruk_id;
  });

const nolar = (l: readonly MedyaKaydi[]): number[] => l.map((k) => k.no);

// ---------------------------------------------------------------------------------------------
// Tip: depoKur MedyaliDepoFabrikasi
// ---------------------------------------------------------------------------------------------

describe("depo medya: fabrika tipi", () => {
  it("depoKur MedyaliDepoFabrikasi'dır ve medya yüzeyini verir", () => {
    const fabrika: MedyaliDepoFabrikasi = depoKur;
    const zaman = sahteZaman();
    const depo = fabrika({ yol: ":memory:", saat: zaman.saat, gunluk: sahteGunluk() });
    try {
      assert.equal(depo.medyaDiskBayti(), 0);
      assert.deepEqual(depo.medyaKayitlari(), []);
    } finally {
      depo.kapat();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Göç
// ---------------------------------------------------------------------------------------------

/** Medya tabloları dışındaki her tablonun şeması ve içeriği. */
const eskiDokum = (yol: string): { sema: unknown[]; veri: Record<string, unknown[]> } =>
  hamAc(yol, (h) => {
    const sema = (
      h
        .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ type: string; name: string; tbl_name: string; sql: string | null }>
    ).filter((s) => !(MEDYA_TABLOLARI as readonly string[]).includes(s.tbl_name));
    const tablolar = sema.filter((s) => s.type === "table").map((s) => s.name);
    const veri = Object.fromEntries(
      tablolar.filter((t) => t !== "sema_ek").map((t) => [t, h.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]),
    );
    return { sema, veri };
  });

const medyaTablolariniDusur = (yol: string, ekSurum: number): void =>
  hamAc(yol, (h) => {
    for (const t of MEDYA_TABLOLARI) h.exec(`DROP TABLE IF EXISTS ${t}`);
    h.exec(`UPDATE sema_ek SET deger = ${ekSurum} WHERE anahtar = 'ek_surum'`);
  });

describe("depo medya: göç (ek göç 8)", () => {
  it("boş dosya: ek_surum 8, user_version 1, medya tabloları STRICT, ikinci açılış yinelemez", () => {
    const yol = yeniYol();
    const a = kur(yol).depo;
    assert.deepEqual(a.semaBilgisi(), { user_version: 1, ek_surum: 8 });
    a.kapat();
    hamAc(yol, (h) => {
      const tablolar = h.prepare("PRAGMA table_list").all() as Array<{ name: string; strict: number }>;
      for (const t of MEDYA_TABLOLARI) assert.equal(tablolar.find((x) => x.name === t)?.strict, 1, t);
      const dizinler = (h.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map(
        (r) => r.name,
      );
      for (const d of ["medya_durum", "medya_sohbet", "kuyruk_medyalari_medya"]) assert.ok(dizinler.includes(d), d);
    });
    const b = kur(yol).depo;
    assert.deepEqual(b.semaBilgisi(), { user_version: 1, ek_surum: 8 });
  });

  it("ek sürüm 7 dosyası: göç eski tabloların şemasına ve satırlarına dokunmaz", () => {
    const yol = yeniYol();
    const a = sohbetli(yol).depo;
    a.kuyrugaEkle("insan", "merhaba", 5, A);
    a.olayEkle({ type: "user_echo", sohbet_id: A_ID, client_msg_id: "m0", input: "yazi", text: "eski" });
    a.tuketimEkle([]);
    a.kapat();
    medyaTablolariniDusur(yol, 7);
    const once = eskiDokum(yol);

    const b = kur(yol).depo;
    assert.deepEqual(b.semaBilgisi(), { user_version: 1, ek_surum: 8 });
    b.kapat();
    assert.deepEqual(eskiDokum(yol), once, "eski tablolar aynı");
    hamAc(yol, (h) => {
      for (const t of MEDYA_TABLOLARI) {
        assert.equal((h.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, 0, t);
      }
    });
    const c = kur(yol).depo;
    assert.equal(c.kuyrukBasi(A)?.metin, "merhaba");
    assert.equal(c.medyaKaydiAc(foto("md1")).no, 1);
  });

  it("sayacı geri kalmış dosyada göç 8 yeniden uygulanabilir (yalnız IF NOT EXISTS), medya verisi durur", () => {
    const yol = yeniYol();
    const a = kur(yol).depo;
    const k = kabulAc(a, foto("md1"));
    a.nesilGorselEkle(3, 2);
    const kuyruk_id = kuyrugaBagli(a, ANA, [k.no]);
    a.kapat();
    const medyaDokumu = () =>
      hamAc(yol, (h) => Object.fromEntries(MEDYA_TABLOLARI.map((t) => [t, h.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()])));
    const once = medyaDokumu();
    hamAc(yol, (h) => h.exec("UPDATE sema_ek SET deger = 7 WHERE anahtar = 'ek_surum'"));
    const b = kur(yol).depo;
    assert.deepEqual(b.semaBilgisi(), { user_version: 1, ek_surum: 8 });
    assert.deepEqual(nolar(b.kuyrukMedyalari(kuyruk_id)), [k.no]);
    assert.equal(b.nesilGorselSayisi(3), 2);
    b.kapat();
    assert.deepEqual(medyaDokumu(), once);
  });

  it("geri alma: ek sürüm 7 kodunun SQL'i yeni şemada çalışır (user_version 1, kuyruk silmesi)", () => {
    const yol = yeniYol();
    const a = kur(yol).depo;
    const k = kabulAc(a, foto("md1"));
    const kuyruk_id = kuyrugaBagli(a, ANA, [k.no]);
    a.kapat();
    hamAc(yol, (h) => {
      assert.equal((h.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 1);
      // Eski `kuyruktanSil`: bağı bilmez, yalnız satırı siler; bağ yetim kalır.
      h.prepare("DELETE FROM kuyruk_ekleri WHERE kuyruk_id = ?").run(kuyruk_id);
      h.prepare("DELETE FROM eren_kuyrugu WHERE id = ?").run(kuyruk_id);
    });
    const b = kur(yol).depo;
    assert.equal(b.medyaYetimBaglariSil(), 1);
    assert.deepEqual(b.kuyrukMedyalari(kuyruk_id), []);
    assert.equal(b.medyaYetimBaglariSil(), 0);
    assert.deepEqual(nolar(b.medyaTahliyeAdaylari()), [k.no], "bağı giden gönderilmiş kayıt aday");
  });
});

// ---------------------------------------------------------------------------------------------
// Kayıt aç, bul, güncelle
// ---------------------------------------------------------------------------------------------

describe("depo medya: kayıt", () => {
  it("medyaKaydiAc: yukleniyor, alinan 0, guncelleme_ms = olusturma_ms, öteki alanlar null; no artar", () => {
    const { depo } = kur();
    const k = depo.medyaKaydiAc(foto("md1", { sohbet_id: A_ID }));
    assert.deepEqual(k, {
      no: 1,
      device_id: TEL,
      medya_id: "md1",
      sohbet_id: A_ID,
      tur: "foto",
      mime: "image/jpeg",
      boyut: 1000,
      alinan: 0,
      durum: "yukleniyor",
      red_kodu: null,
      bicim: null,
      isleme: null,
      isleme_nedeni: null,
      sure_ms: null,
      genislik: null,
      yukseklik: null,
      kare_adet: null,
      olusturma_ms: 100,
      guncelleme_ms: 100,
      bagli_msg_id: null,
    });
    assert.deepEqual(depo.medyaKaydiBul(TEL, "md1"), k);
    assert.deepEqual(depo.medyaKaydiGetir(1), k);
    assert.equal(depo.medyaKaydiAc(foto("md2")).no, 2);
    assert.equal(depo.medyaKaydiAc(foto("md1", { device_id: "baska-tel" })).no, 3, "medya_id cihaz başına tekil");
    assert.equal(depo.medyaKaydiBul(TEL, "yok"), null);
    assert.equal(depo.medyaKaydiGetir(99), null);
  });

  it("silinen kaydın no'su bir daha verilmez (AUTOINCREMENT: dizin adı tekrar etmez)", () => {
    const { depo } = kur();
    const k = depo.medyaKaydiAc(foto("md1"));
    depo.medyaKaydiSil(k.no);
    assert.equal(depo.medyaKaydiAc(foto("md2")).no, k.no + 1);
  });

  it("medyaKaydiAc: aynı (device_id, medya_id) silinecek dahil atar, hiçbir şey yazılmaz", () => {
    const { depo } = kur();
    depo.medyaKaydiAc(foto("md1"));
    assert.throws(() => depo.medyaKaydiAc(foto("md1")), /zaten var/);
    depo.medyaGuncelle(1, { durum: "silinecek" });
    assert.throws(() => depo.medyaKaydiAc(foto("md1")), /zaten var/);
    assert.equal(depo.medyaKayitlari().length, 1);
  });

  it("medyaKaydiAc: geçersiz beyan atar", () => {
    const { depo } = kur();
    assert.throws(() => depo.medyaKaydiAc(foto("md1", { mime: "video/mp4" })), /mime/);
    assert.throws(() => depo.medyaKaydiAc(foto("md1", { boyut: 0 })), /boyut/);
    assert.throws(() => depo.medyaKaydiAc(foto("md1", { boyut: MEDYA_SINIRLARI.FOTO_BAYT + 1 })), /boyut/);
    assert.throws(() => depo.medyaKaydiAc(foto("md1", { tur: "ses" as never })));
    assert.throws(() => depo.medyaKaydiAc(foto("")));
    assert.equal(depo.medyaKaydiAc(video("v1", { boyut: MEDYA_SINIRLARI.VIDEO_BAYT })).boyut, MEDYA_SINIRLARI.VIDEO_BAYT);
    assert.equal(depo.medyaKayitlari().length, 1);
  });

  it("medyaGuncelle: işleme alanlarını yazar; verilmeyen alan değişmez; null yazılabilir", () => {
    const { depo } = kur();
    const k = depo.medyaKaydiAc(video("v1"));
    depo.medyaGuncelle(k.no, { alinan: 2048, guncelleme_ms: 150 });
    depo.medyaGuncelle(k.no, {
      durum: "kabul",
      alinan: 5000,
      bicim: "mp4",
      isleme: "kismi",
      isleme_nedeni: "ses_yok",
      sure_ms: 61000,
      genislik: 1920,
      yukseklik: 1080,
      kare_adet: 7,
      guncelleme_ms: 200,
    });
    const g = depo.medyaKaydiGetir(k.no)!;
    assert.deepEqual(
      { ...g },
      {
        ...k,
        durum: "kabul",
        alinan: 5000,
        bicim: "mp4",
        isleme: "kismi",
        isleme_nedeni: "ses_yok",
        sure_ms: 61000,
        genislik: 1920,
        yukseklik: 1080,
        kare_adet: 7,
        guncelleme_ms: 200,
      },
    );
    depo.medyaGuncelle(k.no, { isleme: "hazir", isleme_nedeni: null });
    assert.equal(depo.medyaKaydiGetir(k.no)!.isleme_nedeni, null);
    assert.equal(depo.medyaKaydiGetir(k.no)!.isleme, "hazir");
    depo.medyaGuncelle(k.no, {});
    assert.equal(depo.medyaKaydiGetir(k.no)!.guncelleme_ms, 200);
  });

  it("medyaGuncelle: reddedildi + red_kodu", () => {
    const { depo } = kur();
    const k = depo.medyaKaydiAc(foto("md1"));
    depo.medyaGuncelle(k.no, { durum: "reddedildi", red_kodu: "medya_reddedildi", guncelleme_ms: 300 });
    const g = depo.medyaKaydiGetir(k.no)!;
    assert.equal(g.durum, "reddedildi");
    assert.equal(g.red_kodu, "medya_reddedildi");
  });

  it("medyaGuncelle: olmayan no, kimlik/beyan alanı ve geçersiz değer atar; hiçbir alan yazılmaz", () => {
    const { depo } = kur();
    const k = depo.medyaKaydiAc(foto("md1"));
    assert.throws(() => depo.medyaGuncelle(99, { alinan: 1 }), /yok/);
    for (const alan of ["no", "device_id", "medya_id", "sohbet_id", "tur", "mime", "boyut", "olusturma_ms", "bilinmeyen"]) {
      assert.throws(() => depo.medyaGuncelle(k.no, { alinan: 7, [alan]: "x" } as never), /yazılamaz/, alan);
    }
    assert.throws(() => depo.medyaGuncelle(k.no, { alinan: 7, durum: "bitti" as never }), /durum/);
    assert.throws(() => depo.medyaGuncelle(k.no, { alinan: -1 }), /alinan/);
    assert.throws(() => depo.medyaGuncelle(k.no, { alinan: 1.5 }), /alinan/);
    assert.throws(() => depo.medyaGuncelle(k.no, { bicim: "exe" as never }), /bicim/);
    assert.throws(() => depo.medyaGuncelle(k.no, { red_kodu: "ic_hata" as never }), /red_kodu/);
    assert.throws(() => depo.medyaGuncelle(k.no, { isleme: "bitti" as never }), /isleme/);
    assert.throws(() => depo.medyaGuncelle(k.no, { isleme_nedeni: "x" as never }), /isleme_nedeni/);
    assert.throws(() => depo.medyaGuncelle(k.no, { durum: null as never }), /durum/);
    assert.deepEqual(depo.medyaKaydiGetir(k.no), k);
  });

  it("medyaGuncelle: silinecek geri dönmez (geç gelen kabul diriltmez), öteki alanlar yazılır", () => {
    const { depo, gunluk } = kur();
    const k = depo.medyaKaydiAc(foto("md1"));
    depo.medyaGuncelle(k.no, { durum: "silinecek", guncelleme_ms: 150 });
    depo.medyaGuncelle(k.no, { durum: "kabul", isleme: "hazir", guncelleme_ms: 160 });
    const g = depo.medyaKaydiGetir(k.no)!;
    assert.equal(g.durum, "silinecek");
    assert.equal(g.isleme, "hazir");
    assert.equal(g.guncelleme_ms, 160);
    assert.equal(gunluk.bul("silinecek_medya_durumu_korundu", "uyari").length, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// Süzgeç, bekleyen, disk, tahliye
// ---------------------------------------------------------------------------------------------

describe("depo medya: sorgular", () => {
  it("medyaKayitlari: süzgeç alanları birlikte uygulanır, no artan; boş durum listesi boş döner", () => {
    const { depo } = sohbetli();
    const a1 = depo.medyaKaydiAc(foto("a1", { sohbet_id: A_ID, olusturma_ms: 10 }));
    const a2 = kabulAc(depo, foto("a2", { sohbet_id: A_ID, olusturma_ms: 20 }));
    const b1 = kabulAc(depo, foto("b1", { sohbet_id: B_ID, olusturma_ms: 30 }));
    const d1 = depo.medyaKaydiAc(foto("d1", { sohbet_id: A_ID, device_id: "tel-2", olusturma_ms: 40 }));
    kuyrugaBagli(depo, B, [b1.no]);
    assert.deepEqual(nolar(depo.medyaKayitlari()), [a1.no, a2.no, b1.no, d1.no]);
    assert.deepEqual(nolar(depo.medyaKayitlari({ sohbet: A })), [a1.no, a2.no, d1.no]);
    assert.deepEqual(nolar(depo.medyaKayitlari({ durumlar: ["kabul"] })), [a2.no, b1.no]);
    assert.deepEqual(nolar(depo.medyaKayitlari({ durumlar: ["kabul", "yukleniyor"], sohbet: A, device_id: TEL })), [
      a1.no,
      a2.no,
    ]);
    assert.deepEqual(nolar(depo.medyaKayitlari({ bagli: true })), [b1.no]);
    assert.deepEqual(nolar(depo.medyaKayitlari({ bagli: false, durumlar: ["kabul"] })), [a2.no]);
    assert.deepEqual(nolar(depo.medyaKayitlari({ guncellemeOnce: 21 })), [a1.no]);
    assert.deepEqual(depo.medyaKayitlari({ durumlar: [] }), []);
  });

  it("medyaBekleyenSayisi: cihazın yukleniyor + bağlanmamış kabul kayıtları", () => {
    const { depo } = kur();
    depo.medyaKaydiAc(foto("y1"));
    kabulAc(depo, foto("k1"));
    const bagli = kabulAc(depo, foto("k2"));
    kuyrugaBagli(depo, ANA, [bagli.no]);
    const red = depo.medyaKaydiAc(foto("r1"));
    depo.medyaGuncelle(red.no, { durum: "reddedildi", red_kodu: "medya_reddedildi" });
    const sil = depo.medyaKaydiAc(foto("s1"));
    depo.medyaGuncelle(sil.no, { durum: "silinecek" });
    depo.medyaKaydiAc(foto("x1", { device_id: "tel-2" }));
    assert.equal(depo.medyaBekleyenSayisi(TEL), 2);
    assert.equal(depo.medyaBekleyenSayisi("tel-2"), 1);
    assert.equal(depo.medyaBekleyenSayisi("yok"), 0);
  });

  it("medyaDiskBayti: yukleniyor + kabul + silinecek boyutları; reddedildi sayılmaz", () => {
    const { depo } = kur();
    assert.equal(depo.medyaDiskBayti(), 0);
    depo.medyaKaydiAc(foto("y1", { boyut: 100 }));
    kabulAc(depo, foto("k1", { boyut: 200 }));
    const sil = depo.medyaKaydiAc(foto("s1", { boyut: 400 }));
    depo.medyaGuncelle(sil.no, { durum: "silinecek" });
    const red = depo.medyaKaydiAc(foto("r1", { boyut: 800 }));
    depo.medyaGuncelle(red.no, { durum: "reddedildi", red_kodu: "medya_siniri" });
    assert.equal(depo.medyaDiskBayti(), 700);
  });

  it("medyaDiskBayti 10 GB üstünü taşmadan toplar (kota: 10240 MiB)", () => {
    const { depo } = kur();
    for (let i = 0; i < 45; i++) kabulAc(depo, video(`v${i}`, { boyut: MEDYA_SINIRLARI.VIDEO_BAYT }));
    assert.equal(depo.medyaDiskBayti(), 45 * MEDYA_SINIRLARI.VIDEO_BAYT);
    assert.ok(depo.medyaDiskBayti() > 10240 * 1024 * 1024);
  });

  it("medyaTahliyeAdaylari: yalnız gönderilmiş kabul kayıtları, en eskiden; kuyruktaki ve bağsız dönmez", () => {
    const { depo } = sohbetli();
    const yeni = kabulAc(depo, foto("yeni", { olusturma_ms: 300 }));
    const eski = kabulAc(depo, foto("eski", { sohbet_id: A_ID, olusturma_ms: 100 }));
    const orta = kabulAc(depo, foto("orta", { olusturma_ms: 200 }));
    const kuyrukta = kabulAc(depo, foto("kuyrukta", { olusturma_ms: 50 }));
    const bagsiz = kabulAc(depo, foto("bagsiz", { olusturma_ms: 10 }));
    const yarim = depo.medyaKaydiAc(foto("yarim", { olusturma_ms: 5 }));
    const q1 = kuyrugaBagli(depo, ANA, [yeni.no, orta.no], "m1");
    const q2 = kuyrugaBagli(depo, A, [eski.no], "m2");
    kuyrugaBagli(depo, ANA, [kuyrukta.no], "m3");
    assert.deepEqual(depo.medyaTahliyeAdaylari(), [], "hepsi kuyrukta ya da bağsız");
    // Satırlar ana oturuma gitti: `konusma` kuyruktan siler, bağ gider, kayıt gönderilmiş olur.
    depo.kuyruktanSil([q1, q2]);
    assert.deepEqual(nolar(depo.medyaTahliyeAdaylari()), [eski.no, orta.no, yeni.no]);
    const s = depo.medyaKaydiGetir(eski.no)!;
    assert.equal(s.bagli_msg_id, "m2", "kayıt kalır, bağlı sayılır");
    assert.ok(!nolar(depo.medyaTahliyeAdaylari()).includes(bagsiz.no));
    assert.ok(!nolar(depo.medyaTahliyeAdaylari()).includes(yarim.no));
    assert.ok(!nolar(depo.medyaTahliyeAdaylari()).includes(kuyrukta.no));
    // Tahliye: `silinecek` yapılan aday listeden çıkar, disk baytında kalır (dizin silinene dek).
    depo.medyaGuncelle(eski.no, { durum: "silinecek" });
    assert.deepEqual(nolar(depo.medyaTahliyeAdaylari()), [orta.no, yeni.no]);
  });
});

// ---------------------------------------------------------------------------------------------
// Bağlama
// ---------------------------------------------------------------------------------------------

describe("depo medya: medyaKuyrugaBagla", () => {
  it("tek işlemde bağlar: sıra dizideki sıra, bagli_msg_id ve guncelleme_ms yazılır", () => {
    const { depo } = kur();
    const f1 = kabulAc(depo, foto("f1"));
    const v1 = kabulAc(depo, video("v1"));
    const f2 = kabulAc(depo, foto("f2"));
    const q = kuyrugaBagli(depo, ANA, [v1.no, f2.no, f1.no], "msg-7");
    const bagli = depo.kuyrukMedyalari(q);
    assert.deepEqual(nolar(bagli), [v1.no, f2.no, f1.no]);
    for (const k of bagli) {
      assert.equal(k.bagli_msg_id, "msg-7");
      assert.equal(k.guncelleme_ms, 600);
    }
    assert.deepEqual(depo.kuyrukMedyalari(q + 100), []);
  });

  it("ikinci bağlama atar ve hiçbir şey değişmez (aynı ya da başka kuyruk satırı)", () => {
    const { depo } = kur();
    const f1 = kabulAc(depo, foto("f1"));
    const f2 = kabulAc(depo, foto("f2"));
    const q = kuyrugaBagli(depo, ANA, [f1.no], "msg-1");
    const once = depo.medyaKayitlari();
    assert.throws(() => depo.medyaKuyrugaBagla({ kuyruk_id: q, client_msg_id: "msg-1", nolar: [f1.no], ms: 700 }));
    assert.throws(() => depo.medyaKuyrugaBagla({ kuyruk_id: q, client_msg_id: "msg-1", nolar: [f2.no], ms: 700 }), /zaten bağlı/);
    const q2 = depo.kuyrugaEkle("insan", "yine", 800, ANA);
    assert.throws(() => depo.medyaKuyrugaBagla({ kuyruk_id: q2, client_msg_id: "msg-2", nolar: [f1.no], ms: 700 }), /zaten bağlı/);
    assert.deepEqual(depo.medyaKayitlari(), once);
    assert.deepEqual(nolar(depo.kuyrukMedyalari(q)), [f1.no]);
    assert.deepEqual(depo.kuyrukMedyalari(q2), []);
  });

  it("koşul tutmayan tek kayıt bütün bağlamayı geri alır", () => {
    const { depo } = sohbetli();
    const ok1 = kabulAc(depo, foto("ok1"));
    const yarim = depo.medyaKaydiAc(foto("yarim"));
    const red = depo.medyaKaydiAc(foto("red"));
    depo.medyaGuncelle(red.no, { durum: "reddedildi", red_kodu: "medya_reddedildi" });
    const sil = kabulAc(depo, foto("sil"));
    depo.medyaGuncelle(sil.no, { durum: "silinecek" });
    const baska = kabulAc(depo, foto("baska", { sohbet_id: A_ID }));
    const q = depo.kuyrugaEkle("insan", "bak", 500, ANA);
    const once = depo.medyaKayitlari();
    const dene = (ikinci: number, desen: RegExp) =>
      assert.throws(
        () => depo.medyaKuyrugaBagla({ kuyruk_id: q, client_msg_id: "msg-1", nolar: [ok1.no, ikinci], ms: 700 }),
        desen,
      );
    dene(yarim.no, /kabul değil/);
    dene(red.no, /kabul değil/);
    dene(sil.no, /kabul değil/);
    dene(baska.no, /başka sohbetin/);
    dene(999, /yok/);
    assert.throws(() => depo.medyaKuyrugaBagla({ kuyruk_id: q, client_msg_id: "msg-1", nolar: [ok1.no, ok1.no], ms: 7 }), /yinelenmiş/);
    assert.throws(() => depo.medyaKuyrugaBagla({ kuyruk_id: q, client_msg_id: "msg-1", nolar: [], ms: 7 }), /sayısı/);
    const fazla = Array.from({ length: MEDYA_SINIRLARI.EK_ADET + 1 }, (_, i) => i + 1);
    assert.throws(() => depo.medyaKuyrugaBagla({ kuyruk_id: q, client_msg_id: "msg-1", nolar: fazla, ms: 7 }), /sayısı/);
    assert.throws(() => depo.medyaKuyrugaBagla({ kuyruk_id: 9999, client_msg_id: "msg-1", nolar: [ok1.no], ms: 7 }), /kuyruk satırı yok/);
    assert.throws(() => depo.medyaKuyrugaBagla({ kuyruk_id: q, client_msg_id: "", nolar: [ok1.no], ms: 7 }));
    assert.deepEqual(depo.medyaKayitlari(), once);
    assert.deepEqual(depo.kuyrukMedyalari(q), []);
    // Koşul tutunca aynı kayıt bağlanabilir (önceki denemeler iz bırakmadı).
    depo.medyaKuyrugaBagla({ kuyruk_id: q, client_msg_id: "msg-1", nolar: [ok1.no], ms: 700 });
    assert.deepEqual(nolar(depo.kuyrukMedyalari(q)), [ok1.no]);
  });

  it("konusma işleminde bağlama atarsa kuyruk satırı da geri alınır; dış işlem yakalayıp sürerse kuyruk satırı kalır, bağ yok", () => {
    const { depo } = kur();
    const ok1 = kabulAc(depo, foto("ok1"));
    const yarim = depo.medyaKaydiAc(foto("yarim"));
    assert.throws(() =>
      depo.islem(() => {
        const q = depo.kuyrugaEkle("insan", "bak", 500, ANA);
        depo.medyaKuyrugaBagla({ kuyruk_id: q, client_msg_id: "msg-1", nolar: [ok1.no, yarim.no], ms: 600 });
      }),
    );
    assert.equal(depo.kuyrukBasi(ANA), null);
    assert.equal(depo.medyaKaydiGetir(ok1.no)!.bagli_msg_id, null);
    const q = depo.islem(() => {
      const id = depo.kuyrugaEkle("insan", "bak", 500, ANA);
      try {
        depo.medyaKuyrugaBagla({ kuyruk_id: id, client_msg_id: "msg-1", nolar: [ok1.no, yarim.no], ms: 600 });
      } catch {
        // kayıt noktası yarım yazımı geri aldı
      }
      return id;
    });
    assert.equal(depo.kuyrukBasi(ANA)?.id, q);
    assert.deepEqual(depo.kuyrukMedyalari(q), []);
    assert.equal(depo.medyaKaydiGetir(ok1.no)!.bagli_msg_id, null);
  });

  it("kuyruktanSil bağları siler, kaydı bırakır; medyaKaydiSil bağıyla siler, yoksa sessiz", () => {
    const { depo } = kur();
    const f1 = kabulAc(depo, foto("f1"));
    const f2 = kabulAc(depo, foto("f2"));
    const q1 = kuyrugaBagli(depo, ANA, [f1.no], "m1");
    const q2 = kuyrugaBagli(depo, ANA, [f2.no], "m2");
    depo.kuyruktanSil([q1]);
    assert.deepEqual(depo.kuyrukMedyalari(q1), []);
    assert.equal(depo.medyaKaydiGetir(f1.no)!.durum, "kabul");
    depo.medyaKaydiSil(f2.no);
    assert.equal(depo.medyaKaydiGetir(f2.no), null);
    assert.deepEqual(depo.kuyrukMedyalari(q2), []);
    assert.equal(depo.medyaYetimBaglariSil(), 0);
    depo.medyaKaydiSil(12345);
  });
});

// ---------------------------------------------------------------------------------------------
// Nesil görsel sayacı
// ---------------------------------------------------------------------------------------------

describe("depo medya: nesil görselleri", () => {
  it("yoksa 0; ekle satırı açar ve artırır; nesiller ayrı", () => {
    const { depo } = kur();
    assert.equal(depo.nesilGorselSayisi(1), 0);
    depo.nesilGorselEkle(1, 3);
    depo.nesilGorselEkle(1, 2);
    depo.nesilGorselEkle(2, 0);
    assert.equal(depo.nesilGorselSayisi(1), 5);
    assert.equal(depo.nesilGorselSayisi(2), 0);
    assert.throws(() => depo.nesilGorselEkle(1, -1));
    assert.throws(() => depo.nesilGorselEkle(1, 1.5));
    assert.equal(depo.nesilGorselSayisi(1), 5);
  });

  it("geçmişi sil sayaca dokunmaz", () => {
    const { depo } = kur();
    depo.nesilGorselEkle(4, 7);
    depo.gecmisiTemizle(ANA);
    assert.equal(depo.nesilGorselSayisi(4), 7);
  });
});

// ---------------------------------------------------------------------------------------------
// Geçmişi sil / sohbeti sil
// ---------------------------------------------------------------------------------------------

/** A'da her durumdan kayıt, B'de ve ANA'da birer kayıt; A'nın biri kuyrukta, biri gönderilmiş. */
const karisik = () => {
  const k = sohbetli();
  const { depo } = k;
  const aYarim = depo.medyaKaydiAc(foto("a-yarim", { sohbet_id: A_ID }));
  const aKuyruk = kabulAc(depo, foto("a-kuyruk", { sohbet_id: A_ID }));
  const aGitmis = kabulAc(depo, foto("a-gitmis", { sohbet_id: A_ID }));
  const aRed = depo.medyaKaydiAc(foto("a-red", { sohbet_id: A_ID }));
  depo.medyaGuncelle(aRed.no, { durum: "reddedildi", red_kodu: "medya_reddedildi" });
  const aSil = depo.medyaKaydiAc(foto("a-sil", { sohbet_id: A_ID }));
  depo.medyaGuncelle(aSil.no, { durum: "silinecek", guncelleme_ms: 111 });
  const bKuyruk = kabulAc(depo, foto("b-kuyruk", { sohbet_id: B_ID }));
  const anaKuyruk = kabulAc(depo, foto("ana-kuyruk"));
  const qA = kuyrugaBagli(depo, A, [aKuyruk.no], "ma");
  const qGitmis = kuyrugaBagli(depo, A, [aGitmis.no], "mg");
  depo.kuyruktanSil([qGitmis]);
  const qB = kuyrugaBagli(depo, B, [bKuyruk.no], "mb");
  const qAna = kuyrugaBagli(depo, ANA, [anaKuyruk.no], "mana");
  return { ...k, aYarim, aKuyruk, aGitmis, aRed, aSil, bKuyruk, anaKuyruk, qA, qB, qAna };
};

describe("depo medya: geçmişi sil ve sohbeti sil", () => {
  it("gecmisiTemizle: o sohbetin silinecek olmayan bütün satırları silinecek, bağları gider; başka sohbete dokunulmaz", () => {
    const { depo, zaman, aYarim, aKuyruk, aGitmis, aRed, aSil, qA, qB, qAna } = karisik();
    const baskalari = () => [...depo.medyaKayitlari({ sohbet: B }), ...depo.medyaKayitlari({ sohbet: ANA })];
    const baskaOnce = baskalari();
    zaman.ilerlet(5000);
    const simdi = zaman.saat.simdiMs();
    const s = depo.gecmisiTemizle(A);
    assert.equal(s.silinecek_medya, 4, "yarım, kuyrukta, gönderilmiş, reddedilmiş; zaten silinecek sayılmaz");
    for (const k of [aYarim, aKuyruk, aGitmis, aRed]) {
      const g = depo.medyaKaydiGetir(k.no)!;
      assert.equal(g.durum, "silinecek", k.medya_id);
      assert.equal(g.guncelleme_ms, simdi, k.medya_id);
    }
    assert.equal(depo.medyaKaydiGetir(aSil.no)!.guncelleme_ms, 111, "zaten silinecek olana dokunulmaz");
    assert.deepEqual(depo.kuyrukMedyalari(qA), []);
    assert.deepEqual(baskalari(), baskaOnce);
    assert.equal(depo.kuyrukMedyalari(qB).length, 1);
    assert.equal(depo.kuyrukMedyalari(qAna).length, 1);
    assert.deepEqual(depo.medyaKayitlari({ sohbet: A, durumlar: ["yukleniyor", "kabul", "reddedildi"] }), []);
    assert.deepEqual(depo.medyaTahliyeAdaylari(), [], "silinecek kayıt tahliye adayı değil");
    assert.equal(depo.medyaBekleyenSayisi(TEL), 0);
    assert.equal(depo.gecmisiTemizle(A).silinecek_medya, 0, "ikinci temizlik sayı vermez");
  });

  it("gecmisiTemizle(ana) yalnız ana'nın medyasını silinecek yapar", () => {
    const { depo, anaKuyruk, bKuyruk, aKuyruk, qAna } = karisik();
    const s = depo.gecmisiTemizle(ANA);
    assert.equal(s.silinecek_medya, 1);
    assert.equal(depo.medyaKaydiGetir(anaKuyruk.no)!.durum, "silinecek");
    assert.equal(depo.medyaKaydiGetir(bKuyruk.no)!.durum, "kabul");
    assert.equal(depo.medyaKaydiGetir(aKuyruk.no)!.durum, "kabul");
    assert.deepEqual(depo.kuyrukMedyalari(qAna), []);
  });

  it("medyasız depoda sonuçta silinecek_medya 0", () => {
    const { depo } = sohbetli();
    assert.equal(depo.gecmisiTemizle(ANA).silinecek_medya, 0);
    assert.equal(depo.sohbetiSil(A, 900).silinecek_medya, 0);
  });

  it("sohbetiSil: aynı medya adımı, guncelleme_ms = ms; başka sohbete dokunulmaz", () => {
    const { depo, aYarim, aKuyruk, aGitmis, aRed, qA, qB, qAna } = karisik();
    const bOnce = depo.medyaKayitlari({ sohbet: B });
    const anaOnce = depo.medyaKayitlari({ sohbet: ANA });
    const s = depo.sohbetiSil(A, 4242);
    assert.equal(s.silinecek_medya, 4);
    for (const k of [aYarim, aKuyruk, aGitmis, aRed]) {
      const g = depo.medyaKaydiGetir(k.no)!;
      assert.equal(g.durum, "silinecek");
      assert.equal(g.guncelleme_ms, 4242);
    }
    assert.deepEqual(depo.kuyrukMedyalari(qA), []);
    assert.deepEqual(depo.medyaKayitlari({ sohbet: B }), bOnce);
    assert.deepEqual(depo.medyaKayitlari({ sohbet: ANA }), anaOnce);
    assert.equal(depo.kuyrukMedyalari(qB).length, 1);
    assert.equal(depo.kuyrukMedyalari(qAna).length, 1);
    // Disk baytı dizin silinene dek silinecek'i sayar; satır kalkınca düşer.
    const once = depo.medyaDiskBayti();
    depo.medyaKaydiSil(aKuyruk.no);
    assert.equal(depo.medyaDiskBayti(), once - aKuyruk.boyut);
  });

  it("sohbetiSil ön koşulu tutmazsa medya değişmez", () => {
    const { depo } = karisik();
    const once = depo.medyaKayitlari();
    assert.throws(() => depo.sohbetiSil(ANA, 10));
    assert.throws(() => depo.sohbetiSil({ sohbet_id: "yok" }, 10));
    depo.sohbetiSil(B, 10);
    const sonra = depo.medyaKayitlari({ sohbet: A });
    assert.throws(() => depo.sohbetiSil(B, 11), /zaten/);
    assert.deepEqual(depo.medyaKayitlari({ sohbet: A }), sonra);
    assert.deepEqual(
      depo.medyaKayitlari({ sohbet: A }),
      once.filter((k) => k.sohbet_id === A_ID),
    );
  });

  it("dış işlem geri alınırsa medya adımı da geri alınır", () => {
    const { depo } = karisik();
    const once = depo.medyaKayitlari();
    assert.throws(() =>
      depo.islem(() => {
        depo.gecmisiTemizle(A);
        throw new Error("sonra patladı");
      }),
    );
    assert.deepEqual(depo.medyaKayitlari(), once);
  });
});

// ---------------------------------------------------------------------------------------------
// sonKonusma: ekler
// ---------------------------------------------------------------------------------------------

describe("depo medya: sonKonusma ekleri", () => {
  it("ekli user_echo satırında KonusmaSatiri.ekler aynen; eksiz satırda alan yok", () => {
    const { depo, zaman } = sohbetli();
    const ekler: EkListesi = [
      { medya_id: "md1", tur: "foto", mime: "image/jpeg", boyut: 1200, genislik: 800, yukseklik: 600 },
      { medya_id: "md2", tur: "video", mime: "video/mp4", boyut: 9000, sure_ms: 12000 },
    ];
    depo.olayEkle({ type: "user_echo", sohbet_id: A_ID, client_msg_id: "m1", input: "yazi", text: "", ekler });
    zaman.ilerlet(10);
    depo.olayEkle({ type: "assistant_message", sohbet_id: A_ID, turn_id: "t1", text: "gördüm" });
    zaman.ilerlet(10);
    depo.olayEkle({ type: "user_echo", sohbet_id: A_ID, client_msg_id: "m2", input: "yazi", text: "düz" });
    const satirlar = depo.sonKonusma(10, A);
    assert.equal(satirlar.length, 3);
    assert.deepEqual(satirlar[0], { rol: "kullanici", metin: "", ts_ms: satirlar[0]!.ts_ms, ekler });
    assert.deepEqual(Object.keys(satirlar[1]!).sort(), ["metin", "rol", "ts_ms"]);
    assert.deepEqual(Object.keys(satirlar[2]!).sort(), ["metin", "rol", "ts_ms"]);
    assert.deepEqual(depo.sonKonusma(10, B), []);
  });

  it("bozuk ekler satırı düşürmez, yalnız alan yazılmaz", () => {
    const yol = yeniYol();
    const a = sohbetli(yol).depo;
    a.olayEkle({
      type: "user_echo",
      sohbet_id: A_ID,
      client_msg_id: "m1",
      input: "yazi",
      text: "bak",
      ekler: [{ medya_id: "md1", tur: "foto", mime: "image/jpeg", boyut: 10 }],
    });
    a.kapat();
    hamAc(yol, (h) => h.exec(`UPDATE events SET veri = json_set(veri, '$.ekler', json('[{"medya_id":"md1"}]')) WHERE type = 'user_echo'`));
    const b = kur(yol).depo;
    assert.deepEqual(
      b.sonKonusma(10, A).map((s) => Object.keys(s).sort()),
      [["metin", "rol", "ts_ms"]],
    );
  });
});
