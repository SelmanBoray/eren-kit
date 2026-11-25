/**
 * ajanda modülü, telefon yolu (`islemUygula`, `gecersizIslem`), telafi (`karsila`, `telafiSayfasi`),
 * geçmiş (`gecmis`), tekrarsızlık, tek sayaç ve günlük. Araç yolu `ajanda-araclar.test.ts`'te,
 * protokol vektörlerinin servis yolu `ajanda-vektor.test.ts`'te. Gerçek depo (`:memory:`), sahte saat
 * ve sahte takvim. MODULLER.md "Ajanda dalgası" > "takvim ve ajanda"; `docs/AJANDA.md` "Servis: ajanda modülü".
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  AJANDA_SINIRLARI,
  type AjandaIslem,
  AjandaIslemSonucu,
  type AjandaKaydi,
  AjandaKaydi as AjandaKaydiSemasi,
  AJANDA_SURUMU,
} from "@eren/protocol";
import { ajandaKur } from "../src/ajanda.ts";
import { depoAc } from "../src/depo.ts";
import type { CihazYonetimliDepo } from "../src/depo.ts";
import type { AjandaBagimliliklari, AjandaIslemSonucuGovdesi, AjandaTurBaglami, ServisOlaylari, Veriyolu } from "../src/sozlesme.ts";
import { sahteGunluk, sahteRastgele, sahteTakvim, sahteZaman } from "./sahte.ts";

// 2026-11-25 14:30 Europe/Istanbul.
const T0 = 1_795_606_200_000;
const DILIM = "Europe/Istanbul";
const CIHAZ = "cihaz_ajanda01";
const CIHAZ2 = "cihaz_ajanda02";
const DAKIKA = 60_000;

const acik: CihazYonetimliDepo[] = [];
afterEach(() => {
  for (const d of acik.splice(0)) d.kapat();
});

type DepoYuzu = AjandaBagimliliklari["depo"];

const kur = (sec: { depo?: (d: CihazYonetimliDepo) => DepoYuzu; tur?: AjandaTurBaglami | null } = {}) => {
  const zaman = sahteZaman(T0);
  const gunluk = sahteGunluk();
  const yayinlar: AjandaKaydi[] = [];
  const veriyolu: Veriyolu = {
    yayinla: (ad, veri) => {
      if (ad === "ajanda_kayit_yazildi") yayinlar.push((veri as ServisOlaylari["ajanda_kayit_yazildi"]).kayit);
    },
    dinle: () => () => {},
  };
  const depo = depoAc({ yol: ":memory:", saat: zaman.saat, veriyolu, gunluk });
  acik.push(depo);
  const takvim = sahteTakvim(DILIM);
  const o = { tur: sec.tur ?? null };
  const ajanda = ajandaKur({
    depo: sec.depo === undefined ? depo : sec.depo(depo),
    takvim,
    saat: zaman.saat,
    rastgele: sahteRastgele(),
    gunluk,
    turBaglami: () => o.tur,
  });
  ajanda.baslat();
  const islem = (islem_id: string, i: AjandaIslem, cihaz = CIHAZ): AjandaIslemSonucuGovdesi => {
    const s = ajanda.islemUygula(cihaz, islem_id, i);
    // Her sonuç kablonun `islem_sonucu` şemasından geçer.
    AjandaIslemSonucu.parse({ v: AJANDA_SURUMU, type: "islem_sonucu", islem_id, ...s });
    return s;
  };
  const kayit = (id: string): AjandaKaydi => {
    const k = depo.ajandaKaydiGetir(id);
    assert.ok(k !== null, `kayıt yok: ${id}`);
    return k;
  };
  const gecmisi = (id: string) => depo.ajandaGecmisi({ kayit_id: id, adet: 1000 });
  return { zaman, gunluk, yayinlar, depo, takvim, ajanda, islem, kayit, gecmisi, o };
};

let islemSayaci = 0;
const yeniIslemId = (): string => `i_${++islemSayaci}`;

const disci = (kayit_id = "k_dis01", ek: Partial<Extract<AjandaIslem, { islem: "ekle" }>> = {}): AjandaIslem => ({
  islem: "ekle",
  kayit_id,
  tur: "randevu",
  baslik: "Dişçi ☕️",
  zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", saat_dilimi: DILIM, ifade: "yarın 3'te" },
  hatirlatmalar: [{ tur: "once", dk: 60 }],
  girdi_yolu: "elle",
  ...ek,
});

const haftalik = (kayit_id = "k_hafta"): AjandaIslem => ({
  islem: "ekle",
  kayit_id,
  tur: "gorev",
  baslik: "Haftalık rapor",
  zaman: { kesinlik: "an", tarih: "2026-11-02", saat: "10:00", saat_dilimi: DILIM },
  hatirlatmalar: [],
  tekrar: { siklik: "haftalik", aralik: 1 },
  girdi_yolu: "elle",
});

describe("ajanda: elle ekleme", () => {
  it("kayıt doğar: kaynak izi, elle_alanlar, ilk revizyon, geçmiş satırı ve yayın", () => {
    const o = kur();
    const s = o.islem("i_ekle", disci());
    assert.deepEqual(s, { ok: true, kayit_id: "k_dis01", rev: 1 });
    const k = o.kayit("k_dis01");
    AjandaKaydiSemasi.parse(k);
    assert.deepEqual(k.kaynak, { yol: "elle", tur_kokeni: "insan", device_id: CIHAZ });
    // Karar: elle eklemede verilen bütün alanlar (durum hariç) kullanıcının emridir.
    assert.deepEqual(k.elle_alanlar, ["tur", "baslik", "zaman", "hatirlatmalar"]);
    assert.equal(k.taslak, false);
    assert.equal(k.durum, "acik");
    assert.equal(k.kaynak.tekil_anahtar, undefined, "elle ekleme tekilleştirilmez");
    assert.equal(k.olusturma_ms, T0);
    assert.equal(k.guncelleme_ms, T0);
    const g = o.gecmisi("k_dis01");
    assert.equal(g.length, 1);
    assert.equal(g[0]?.islem, "ekle");
    assert.equal(g[0]?.rev, 1);
    assert.deepEqual(g[0]?.yazar, { yol: "elle", tur_kokeni: "insan", device_id: CIHAZ });
    assert.deepEqual(g[0]?.onceki, {});
    assert.equal(g[0]?.sonraki.baslik, "Dişçi ☕️");
    assert.equal(g[0]?.sonraki.taslak, false);
    assert.deepEqual(o.yayinlar.map((y) => y.revizyon), [1]);
  });

  it("sesli not yolu kaynağa ve yazara geçer; açıklamalı ve tekrarlı ekleme alanları izler", () => {
    const o = kur();
    o.islem("i1", disci("k_ses", { girdi_yolu: "sesli_not", aciklama: "Dolgu" }));
    assert.equal(o.kayit("k_ses").kaynak.yol, "sesli_not");
    assert.equal(o.gecmisi("k_ses")[0]?.yazar.yol, "sesli_not");
    assert.deepEqual(o.kayit("k_ses").elle_alanlar, ["tur", "baslik", "aciklama", "zaman", "hatirlatmalar"]);
    o.islem("i2", haftalik());
    assert.deepEqual(o.kayit("k_hafta").elle_alanlar, ["tur", "baslik", "zaman", "hatirlatmalar", "tekrar"]);
  });

  it("aynı kimlik başka işlemle: kimlik_cakisiyor; kayıt değişmez", () => {
    const o = kur();
    o.islem("i1", disci());
    const s = o.islem("i2", disci("k_dis01", { baslik: "Başka" }));
    assert.deepEqual(s, { ok: false, kayit_id: "k_dis01", code: "kimlik_cakisiyor" });
    assert.equal(o.kayit("k_dis01").baslik, "Dişçi ☕️");
    assert.equal(o.depo.ajandaBasRev(), 1);
  });

  it("dilim veritabanında olmayan dilim: saat_dilimi_bilinmiyor (zaman ve mutlak hatırlatma)", () => {
    const o = kur();
    const s1 = o.islem("i1", disci("k_a", { zaman: { kesinlik: "gun", tarih: "2026-11-26", saat_dilimi: "Mars/Phobos" } }));
    assert.equal(s1.code, "saat_dilimi_bilinmiyor");
    const s2 = o.islem(
      "i2",
      disci("k_b", { hatirlatmalar: [{ tur: "mutlak", tarih: "2026-11-26", saat: "09:00", saat_dilimi: "Mars/Phobos" }] }),
    );
    assert.equal(s2.code, "saat_dilimi_bilinmiyor");
    assert.equal(o.depo.ajandaKayitSayisi(), 0);
  });

  it("KAYIT_ADET dolunca kayit_siniri (silinmişler dahil sayılır)", () => {
    let sayi = AJANDA_SINIRLARI.KAYIT_ADET;
    const o = kur({
      depo: (d) => new Proxy(d, { get: (t, k) => (k === "ajandaKayitSayisi" ? () => sayi : Reflect.get(t, k)) }),
    });
    assert.deepEqual(o.islem("i1", disci()), { ok: false, kayit_id: "k_dis01", code: "kayit_siniri" });
    sayi = AJANDA_SINIRLARI.KAYIT_ADET - 1;
    assert.equal(o.islem("i2", disci()).ok, true);
  });
});

describe("ajanda: elle güncelleme, durum, onay, silme", () => {
  it("guncelle: alan uygulanır, elle_alanlar'a girer; temel_revizyon geçmişte; korunan alan doğmaz", () => {
    const o = kur();
    o.islem("i1", disci());
    o.zaman.ilerlet(DAKIKA);
    const s = o.islem("i2", {
      islem: "guncelle",
      kayit_id: "k_dis01",
      temel_revizyon: 1,
      degisiklik: { aciklama: "Dolgu kontrolü", baslik: "Dişçi ☕️" },
    });
    assert.deepEqual(s, { ok: true, kayit_id: "k_dis01", rev: 2 });
    const k = o.kayit("k_dis01");
    assert.equal(k.aciklama, "Dolgu kontrolü");
    assert.deepEqual(k.elle_alanlar, ["tur", "baslik", "aciklama", "zaman", "hatirlatmalar"]);
    assert.equal(k.guncelleme_ms, T0 + DAKIKA);
    assert.equal(k.olusturma_ms, T0);
    const g = o.gecmisi("k_dis01")[0];
    assert.equal(g?.islem, "guncelle");
    assert.equal(g?.temel_revizyon, 1);
    assert.equal(g?.ts_ms, k.guncelleme_ms);
    // Yalnız değişen alan: aynı başlık geçmişe girmez.
    assert.deepEqual(g?.onceki, { aciklama: null });
    assert.deepEqual(g?.sonraki, { aciklama: "Dolgu kontrolü" });
    assert.equal(g?.korunan_alanlar, undefined);
    assert.equal("korunan_alanlar" in s, false);
  });

  it("aynı değer ya da olmayan alanı kaldırmak yan etkisiz: ok, rev yok, geçmiş ve yayın yok", () => {
    const o = kur();
    o.islem("i1", disci());
    const s1 = o.islem("i2", { islem: "guncelle", kayit_id: "k_dis01", temel_revizyon: 1, degisiklik: { baslik: "Dişçi ☕️" } });
    const s2 = o.islem("i3", { islem: "guncelle", kayit_id: "k_dis01", temel_revizyon: 1, degisiklik: { aciklama: null } });
    assert.deepEqual(s1, { ok: true, kayit_id: "k_dis01" });
    assert.deepEqual(s2, { ok: true, kayit_id: "k_dis01" });
    assert.equal(o.gecmisi("k_dis01").length, 1);
    assert.equal(o.yayinlar.length, 1);
  });

  it("varış sırası kazanır: eski temel_revizyon reddedilmez", () => {
    const o = kur();
    o.islem("i1", disci());
    o.islem("i2", { islem: "guncelle", kayit_id: "k_dis01", temel_revizyon: 1, degisiklik: { baslik: "A" } });
    const s = o.islem("i3", { islem: "guncelle", kayit_id: "k_dis01", temel_revizyon: 1, degisiklik: { baslik: "B" } });
    assert.equal(s.rev, 3);
    assert.equal(o.kayit("k_dis01").baslik, "B");
  });

  it("kuralı bozan birleşim tutarsiz_kayit: hiçbir şey yazılmaz", () => {
    const o = kur();
    o.islem("i1", haftalik());
    // Tekrar an ya da gun ister: zamanı kaldırmak kaydı bozar.
    const s = o.islem("i2", { islem: "guncelle", kayit_id: "k_hafta", temel_revizyon: 1, degisiklik: { zaman: null } });
    assert.deepEqual(s, { ok: false, kayit_id: "k_hafta", code: "tutarsiz_kayit" });
    assert.equal(o.kayit("k_hafta").revizyon, 1);
    assert.equal(o.gecmisi("k_hafta").length, 1);
    // Kalıcı ret: tekrarsızlık kaydına yazıldı.
    assert.deepEqual(o.depo.ajandaIslemSonucuBul(CIHAZ, "i2"), s);
  });

  it("tekrar kaldırılınca örnek satırları budanır ve geçmişe tam liste olarak yazılır", () => {
    const o = kur();
    o.islem("i1", haftalik());
    o.islem("i2", { islem: "durum", kayit_id: "k_hafta", durum: "tamam", ornek_tarihi: "2026-11-09" });
    assert.deepEqual(o.kayit("k_hafta").ornekler, [{ tarih: "2026-11-09", durum: "tamam" }]);
    const s = o.islem("i3", { islem: "guncelle", kayit_id: "k_hafta", temel_revizyon: 2, degisiklik: { tekrar: null } });
    assert.equal(s.ok, true);
    const k = o.kayit("k_hafta");
    assert.equal(k.tekrar, undefined);
    assert.deepEqual(k.ornekler, []);
    const g = o.gecmisi("k_hafta")[0];
    assert.deepEqual(g?.onceki.ornekler, [{ tarih: "2026-11-09", durum: "tamam" }]);
    assert.deepEqual(g?.sonraki.ornekler, []);
    assert.deepEqual(g?.onceki.tekrar, { siklik: "haftalik", aralik: 1 });
    assert.equal(g?.sonraki.tekrar, null);
  });

  it("durum: tamam ve geri alma (acik); durum alanı elle izine girer", () => {
    const o = kur();
    o.islem("i1", disci());
    assert.equal(o.islem("i2", { islem: "durum", kayit_id: "k_dis01", durum: "tamam" }).rev, 2);
    assert.equal(o.kayit("k_dis01").durum, "tamam");
    assert.ok(o.kayit("k_dis01").elle_alanlar.includes("durum"));
    assert.deepEqual(o.islem("i3", { islem: "durum", kayit_id: "k_dis01", durum: "tamam" }), { ok: true, kayit_id: "k_dis01" });
    assert.equal(o.islem("i4", { islem: "durum", kayit_id: "k_dis01", durum: "acik" }).rev, 3);
    const g = o.gecmisi("k_dis01");
    assert.deepEqual(
      g.map((x) => [x.islem, x.onceki.durum, x.sonraki.durum]),
      [
        ["durum", "tamam", "acik"],
        ["durum", "acik", "tamam"],
        ["ekle", undefined, "acik"],
      ],
    );
  });

  it("örnek durumu: bugun kaydın dilimindeki gündür; geçmiş ornek_durumu taşır; tekrarsız kayıtta ornek_gecersiz", () => {
    const o = kur();
    o.islem("i1", haftalik());
    o.islem("i0", disci());
    // Kullanıcının dilimi başka: bugün yine kaydın dilimiyle hesaplanır.
    o.takvim.dilim = "America/Sao_Paulo";
    const s = o.islem("i2", { islem: "durum", kayit_id: "k_hafta", durum: "iptal", ornek_tarihi: "2026-11-16" });
    assert.equal(s.rev, 3);
    const g = o.gecmisi("k_hafta")[0];
    assert.equal(g?.ornek_tarihi, "2026-11-16");
    assert.deepEqual(g?.onceki, { ornek_durumu: null });
    assert.deepEqual(g?.sonraki, { ornek_durumu: "iptal" });
    // Kaydın dilimi bugün için okunur.
    assert.deepEqual(o.takvim.cagrilar.son("yerelAn")?.args, [T0, DILIM]);
    assert.deepEqual(o.islem("i3", { islem: "durum", kayit_id: "k_dis01", durum: "tamam", ornek_tarihi: "2026-11-26" }), {
      ok: false,
      kayit_id: "k_dis01",
      code: "ornek_gecersiz",
    });
    assert.deepEqual(o.islem("i4", { islem: "durum", kayit_id: "k_hafta", durum: "acik", ornek_tarihi: "2026-11-23" }), {
      ok: true,
      kayit_id: "k_hafta",
    });
  });

  it("silme: mezar taşı; ikinci sil yan etkisiz; mezar taşına geri_yukle dışında her işlem kayit_silinmis", () => {
    const o = kur();
    o.islem("i1", disci());
    assert.equal(o.islem("i2", { islem: "sil", kayit_id: "k_dis01" }).rev, 2);
    assert.equal(o.kayit("k_dis01").silindi, true);
    assert.deepEqual(o.islem("i3", { islem: "sil", kayit_id: "k_dis01" }), { ok: true, kayit_id: "k_dis01" });
    for (const i of [
      { islem: "guncelle", kayit_id: "k_dis01", temel_revizyon: 2, degisiklik: { baslik: "X" } },
      { islem: "durum", kayit_id: "k_dis01", durum: "tamam" },
      { islem: "onayla", kayit_id: "k_dis01" },
    ] as AjandaIslem[]) {
      assert.deepEqual(o.islem(yeniIslemId(), i), { ok: false, kayit_id: "k_dis01", code: "kayit_silinmis" }, i.islem);
    }
    assert.equal(o.islem("i4", { islem: "geri_yukle", kayit_id: "k_dis01" }).rev, 3);
    assert.equal(o.kayit("k_dis01").silindi, false);
    assert.deepEqual(o.islem("i5", { islem: "geri_yukle", kayit_id: "k_dis01" }), { ok: true, kayit_id: "k_dis01" });
    assert.deepEqual(
      o.gecmisi("k_dis01").slice(0, 2).map((g) => [g.islem, g.onceki, g.sonraki]),
      [
        ["geri_yukle", { silindi: true }, { silindi: false }],
        ["sil", { silindi: false }, { silindi: true }],
      ],
    );
  });

  it("olmayan kayda her işlem kayit_bulunamadi", () => {
    const o = kur();
    for (const i of [
      { islem: "guncelle", kayit_id: "k_yok", temel_revizyon: 1, degisiklik: { baslik: "X" } },
      { islem: "durum", kayit_id: "k_yok", durum: "tamam" },
      { islem: "onayla", kayit_id: "k_yok" },
      { islem: "sil", kayit_id: "k_yok" },
      { islem: "geri_yukle", kayit_id: "k_yok" },
    ] as AjandaIslem[]) {
      assert.deepEqual(o.islem(yeniIslemId(), i), { ok: false, kayit_id: "k_yok", code: "kayit_bulunamadi" }, i.islem);
    }
  });

  it("onayla: taslak olmayan kayıtta yan etkisiz", () => {
    const o = kur();
    o.islem("i1", disci());
    assert.deepEqual(o.islem("i2", { islem: "onayla", kayit_id: "k_dis01" }), { ok: true, kayit_id: "k_dis01" });
  });
});

describe("ajanda: tekrarsızlık (device_id, islem_id)", () => {
  it("aynı kimlik aynı sonucu alır, ikinci kez uygulanmaz", () => {
    const o = kur();
    const s1 = o.islem("i1", disci());
    const s2 = o.islem("i1", disci());
    assert.deepEqual(s2, s1);
    o.islem("i2", { islem: "guncelle", kayit_id: "k_dis01", temel_revizyon: 1, degisiklik: { baslik: "A" } });
    const once = o.depo.ajandaBasRev();
    // Aynı kimlikle başka içerik gelse de ilk sonuç döner, uygulanmaz.
    const s3 = o.islem("i2", { islem: "guncelle", kayit_id: "k_dis01", temel_revizyon: 1, degisiklik: { baslik: "B" } });
    assert.equal(s3.rev, 2);
    assert.equal(o.depo.ajandaBasRev(), once);
    assert.equal(o.kayit("k_dis01").baslik, "A");
    assert.equal(o.gunluk.bul("islem_tekrari").length, 2);
  });

  it("kalıcı ret de yazılır: kayıt sonradan doğsa da aynı kimlik aynı reddi alır", () => {
    const o = kur();
    const s1 = o.islem("i_sil", { islem: "sil", kayit_id: "k_dis01" });
    assert.equal(s1.code, "kayit_bulunamadi");
    o.islem("i_ekle", disci());
    assert.deepEqual(o.islem("i_sil", { islem: "sil", kayit_id: "k_dis01" }), s1);
    assert.equal(o.kayit("k_dis01").silindi, false);
  });

  it("başka cihazın aynı islem_id'si ayrı işlemdir", () => {
    const o = kur();
    o.islem("i1", disci());
    const s = o.islem("i1", disci("k_iki"), CIHAZ2);
    assert.deepEqual(s, { ok: true, kayit_id: "k_iki", rev: 2 });
  });

  it("geçici ret (ic_hata) yazılmaz: değişiklik geri alınır, aynı kimlik yeniden denenince uygulanır", () => {
    let boz = true;
    const o = kur({
      depo: (d) =>
        new Proxy(d, {
          get: (t, k) =>
            k === "ajandaDegisiklikYaz" && boz
              ? () => {
                  throw new Error("vt kilitli");
                }
              : Reflect.get(t, k),
        }),
    });
    assert.deepEqual(o.islem("i1", disci()), { ok: false, code: "ic_hata" });
    assert.equal(o.depo.ajandaIslemSonucuBul(CIHAZ, "i1"), null);
    assert.equal(o.depo.ajandaKayitSayisi(), 0);
    assert.equal(o.gunluk.bul("islem_hatasi", "hata").length, 1);
    boz = false;
    assert.deepEqual(o.islem("i1", disci()), { ok: true, kayit_id: "k_dis01", rev: 1 });
  });

  it("sonuç yazımı atarsa değişiklik de geri alınır (tek depo işlemi)", () => {
    const o = kur({
      depo: (d) =>
        new Proxy(d, {
          get: (t, k) =>
            k === "ajandaIslemSonucuYaz"
              ? () => {
                  throw new Error("disk dolu");
                }
              : Reflect.get(t, k),
        }),
    });
    assert.equal(o.islem("i1", disci()).code, "ic_hata");
    assert.equal(o.depo.ajandaKayitSayisi(), 0);
    assert.equal(o.depo.ajandaBasRev(), 0);
    assert.equal(o.yayinlar.length, 0);
  });

  it("gecersizIslem: gecersiz_islem yazılır ve hep aynı döner; kimliğin önceki sonucu varsa o döner", () => {
    const o = kur();
    const s = o.ajanda.gecersizIslem(CIHAZ, "i_bozuk");
    assert.deepEqual(s, { ok: false, code: "gecersiz_islem" });
    assert.deepEqual(o.depo.ajandaIslemSonucuBul(CIHAZ, "i_bozuk"), s);
    // Aynı kimlik geçerli gövdeyle gelse de uygulanmaz.
    assert.deepEqual(o.islem("i_bozuk", disci()), s);
    assert.equal(o.depo.ajandaKayitSayisi(), 0);
    o.islem("i_iyi", disci());
    assert.deepEqual(o.ajanda.gecersizIslem(CIHAZ, "i_iyi"), { ok: true, kayit_id: "k_dis01", rev: 1 });
  });

  it("şemadan geçmeyen gövde islemUygula'ya ulaşırsa da gecersiz_islem (savunma)", () => {
    const o = kur();
    const bozuk = { islem: "ekle", kayit_id: "k_x", tur: "randevu", baslik: " boşluk ", hatirlatmalar: [], girdi_yolu: "elle" };
    assert.deepEqual(o.ajanda.islemUygula(CIHAZ, "i1", bozuk as AjandaIslem), { ok: false, code: "gecersiz_islem" });
    assert.equal(o.depo.ajandaKayitSayisi(), 0);
  });
});

describe("ajanda: tek sayaç, geçmiş sayfası, telafi", () => {
  it("revizyon kayıtlar arası tek sayaçtan kesin artar; guncelleme_ms geçmiş satırının ts_ms'i", () => {
    const o = kur();
    o.islem("i1", disci("k_a"));
    o.zaman.ilerlet(DAKIKA);
    o.islem("i2", disci("k_b"));
    o.zaman.ilerlet(DAKIKA);
    o.islem("i3", { islem: "durum", kayit_id: "k_a", durum: "tamam" });
    assert.deepEqual([o.kayit("k_a").revizyon, o.kayit("k_b").revizyon], [3, 2]);
    assert.deepEqual(o.yayinlar.map((k) => [k.kayit_id, k.revizyon]), [
      ["k_a", 1],
      ["k_b", 2],
      ["k_a", 3],
    ]);
    for (const id of ["k_a", "k_b"]) {
      const k = o.kayit(id);
      assert.equal(o.depo.ajandaGecmisSatiri(k.revizyon)?.ts_ms, k.guncelleme_ms);
    }
  });

  it("saat geri alınsa da güncelleme anı kaydın son güncellemesinden geri gitmez", () => {
    const o = kur();
    o.islem("i1", disci());
    // Aynı depoya saati 10 dakika geride bir modül yazar.
    const zaman = { simdi: T0 - 10 * DAKIKA };
    const a2 = ajandaKur({
      depo: o.depo,
      takvim: o.takvim,
      saat: { simdiMs: () => zaman.simdi },
      rastgele: sahteRastgele(),
      gunluk: o.gunluk,
      turBaglami: () => null,
    });
    const s = a2.islemUygula(CIHAZ, "i2", { islem: "durum", kayit_id: "k_dis01", durum: "tamam" });
    assert.equal(s.ok, true);
    const k = o.kayit("k_dis01");
    assert.equal(k.guncelleme_ms, T0);
    assert.ok(k.guncelleme_ms >= k.olusturma_ms);
  });

  it("gecmis: rev azalan, GECMIS_SAYFA'lık sayfa, devami ve once_rev; kayıt yoksa kayit_bulunamadi", () => {
    const o = kur();
    o.islem("i0", disci());
    for (let i = 1; i <= 24; i++) {
      o.islem(`g${i}`, { islem: "guncelle", kayit_id: "k_dis01", temel_revizyon: i, degisiklik: { baslik: `Başlık ${i}` } });
    }
    const s1 = o.ajanda.gecmis("k_dis01");
    assert.equal(s1.girdiler.length, AJANDA_SINIRLARI.GECMIS_SAYFA);
    assert.equal(s1.devami, true);
    assert.equal(s1.code, undefined);
    assert.deepEqual(
      s1.girdiler.map((g) => g.rev),
      Array.from({ length: 20 }, (_, i) => 25 - i),
    );
    const s2 = o.ajanda.gecmis("k_dis01", s1.girdiler.at(-1)?.rev);
    assert.deepEqual(
      s2.girdiler.map((g) => g.rev),
      [5, 4, 3, 2, 1],
    );
    assert.equal(s2.devami, false);
    assert.deepEqual(o.ajanda.gecmis("k_yok"), { kayit_id: "k_yok", girdiler: [], devami: false, code: "kayit_bulunamadi" });
    // Tam 20 girdide devami yanlış.
    const o2 = kur();
    o2.islem("i0", disci());
    for (let i = 1; i < 20; i++) {
      o2.islem(`g${i}`, { islem: "guncelle", kayit_id: "k_dis01", temel_revizyon: i, degisiklik: { baslik: `B ${i}` } });
    }
    assert.equal(o2.ajanda.gecmis("k_dis01").devami, false);
  });

  it("karsila: depo kimliği sabit; ilk bağlantı, artımlı, iz tutmaz, ileride, depo kimliği yenilendi", () => {
    const o = kur();
    const ilk = o.ajanda.karsila({ son_rev: 0 });
    assert.equal(ilk.tam, true);
    assert.equal(ilk.bas_rev, 0);
    assert.equal(o.ajanda.karsila({ son_rev: 0 }).depo_id, ilk.depo_id);
    o.islem("i1", disci("k_a"));
    o.zaman.ilerlet(DAKIKA);
    o.islem("i2", disci("k_b"));
    const k = o.kayit("k_a");
    const iz = { kayit_id: k.kayit_id, guncelleme_ms: k.guncelleme_ms };
    assert.deepEqual(o.ajanda.karsila({ son_rev: 1, depo_id: ilk.depo_id, son_rev_izi: iz }), { depo_id: ilk.depo_id, bas_rev: 2, tam: false });
    assert.equal(o.ajanda.karsila({ son_rev: 0, depo_id: ilk.depo_id }).tam, false);
    assert.equal(o.ajanda.karsila({ son_rev: 1, depo_id: ilk.depo_id }).tam, true, "iz yok");
    assert.equal(o.ajanda.karsila({ son_rev: 1, depo_id: ilk.depo_id, son_rev_izi: { ...iz, guncelleme_ms: 1 } }).tam, true);
    assert.equal(o.ajanda.karsila({ son_rev: 1, depo_id: ilk.depo_id, son_rev_izi: { ...iz, kayit_id: "k_b" } }).tam, true);
    assert.equal(o.ajanda.karsila({ son_rev: 9, depo_id: ilk.depo_id, son_rev_izi: iz }).tam, true, "telefon ileride");
    assert.equal(o.ajanda.karsila({ son_rev: 1, depo_id: "d_baska", son_rev_izi: iz }).tam, true);
    // Geri yükleme ya da içe aktarmada depo kimliği yenilenir: eski kimlikli telefon tam telafi alır.
    o.depo.ajandaDepoKimligiYenile("d_yeni");
    const y = o.ajanda.karsila({ son_rev: 1, depo_id: ilk.depo_id, son_rev_izi: iz });
    assert.deepEqual(y, { depo_id: "d_yeni", bas_rev: 2, tam: true });
  });

  it("telafiSayfasi: son haller, revizyon artan, mezar taşı dahil, adet ve üst sınır", () => {
    const o = kur();
    o.islem("i1", disci("k_a"));
    o.islem("i2", disci("k_b"));
    o.islem("i3", disci("k_c"));
    o.islem("i4", { islem: "sil", kayit_id: "k_a" });
    o.islem("i5", { islem: "durum", kayit_id: "k_c", durum: "tamam" });
    const bas = o.ajanda.karsila({ son_rev: 0 }).bas_rev;
    assert.equal(bas, 5);
    o.islem("i6", { islem: "durum", kayit_id: "k_b", durum: "iptal" });
    const tam = o.ajanda.telafiSayfasi({ sonRev: 0, ustRev: bas, adet: 100 });
    assert.deepEqual(
      tam.map((k) => [k.kayit_id, k.revizyon]),
      [
        ["k_a", 4],
        ["k_c", 5],
      ],
      "k_b ustRev'den sonra değişti: canlıda gelir",
    );
    assert.equal(tam[0]?.silindi, true);
    assert.deepEqual(
      o.ajanda.telafiSayfasi({ sonRev: 0, ustRev: 6, adet: 2 }).map((k) => k.revizyon),
      [4, 5],
    );
    assert.deepEqual(
      o.ajanda.telafiSayfasi({ sonRev: 5, ustRev: 6, adet: 10 }).map((k) => k.kayit_id),
      ["k_b"],
    );
  });
});

describe("ajanda: günlük", () => {
  it("kayıt metni (başlık, açıklama, ifade) günlüğe girmez; yalnız kimlik, sayı, kapalı liste değeri", async () => {
    const tur: AjandaTurBaglami = {
      tur_kokeni: "insan",
      turn_id: "tur_1",
      mesaj_ani: { tarih: "2026-11-25", saat: "14:30", saat_dilimi: DILIM },
      insan_metni: "yarın 3'te GIZLIBASLIK",
    };
    const o = kur({ tur });
    o.islem("i1", disci("k_a", { baslik: "GIZLIBASLIK", aciklama: "GIZLIACIKLAMA" }));
    o.islem("i2", { islem: "guncelle", kayit_id: "k_a", temel_revizyon: 1, degisiklik: { baslik: "GIZLIYENI" } });
    o.islem("i3", { islem: "guncelle", kayit_id: "k_yok", temel_revizyon: 1, degisiklik: { baslik: "GIZLIRET" } });
    const arac = await o.ajanda.araclar.ajanda_ekle(
      {
        tur: "gorev",
        baslik: "GIZLIARAC",
        alinti: "GIZLIBASLIK",
        zaman: { kesinlik: "belirsiz", ifade: "GIZLIIFADE" },
      },
      { rol: "ana_oturum", sohbet_id: "ana", nesil: 1 },
      new AbortController().signal,
    );
    assert.equal(arac.ok && arac.deger.sonuc, "eklendi");
    const metin = JSON.stringify(o.gunluk.girdiler);
    assert.ok(o.gunluk.girdiler.length > 0);
    assert.doesNotMatch(metin, /GIZLI/);
    for (const g of o.gunluk.girdiler) {
      for (const deger of Object.values(g.alanlar ?? {})) {
        assert.ok(deger === null || ["string", "number", "boolean"].includes(typeof deger));
      }
    }
  });
});
