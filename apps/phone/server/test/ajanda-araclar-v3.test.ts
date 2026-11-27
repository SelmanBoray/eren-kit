/**
 * Sürüm 3 araç yolu (`ajanda-araclar.ts`): bölge (yalnız ad), varış, bağlantı, simge, dar tekrar
 * ("her iş günü imza"), `bolge_yeni`, sentetik turda taslak, liste süzgeci ve bölge adları; birleşmiş
 * kayıttaki araç kuralları (`tutarsiz_kayit` + `kural`). Gizlilik: işaret koordinatıyla (uygulamadan)
 * yazılan kayıt hiçbir araç yanıtında (boru satırı), model metninde ve günlükte görünmez; ek
 * üstverisi de görünmez, yalnız `ek_sayisi`. v3 alanı olmayan kayıtların liste çıktısı kaydın kendisidir.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  AJANDA_ARACLARI,
  AJANDA_BORU_ADI,
  PROTOKOL_SURUMU,
  type AjandaFiili,
  type AjandaIslem,
  type AjandaKaydi,
  AjandaKaydi as AjandaKaydiSemasi,
  ajandaEkleMetni,
  ajandaGuncelleMetni,
  ajandaKopruAsagiCoz,
  ajandaMcpSonucu,
} from "@eren/protocol";
import { ajandaKopruSunucuKur } from "../src/ajanda-kopru-sunucu.ts";
import { ajandaKur } from "../src/ajanda.ts";
import { depoAc } from "../src/depo.ts";
import type { CihazYonetimliDepo } from "../src/depo.ts";
import type { AjandaFiilCiktisi, AjandaFiilGirdisi, AjandaKopruBaglami, AjandaTurBaglami, Veriyolu } from "../src/sozlesme.ts";
import { sahteBoru, sahteGunluk, sahteRastgele, sahteTakvim, sahteZaman } from "./sahte.ts";

// 2026-11-25 14:30 Europe/Istanbul.
const T0 = 1_795_606_200_000;
const DILIM = "Europe/Istanbul";
const BAGLAM: AjandaKopruBaglami = { rol: "ana_oturum", sohbet_id: "ana", nesil: 3 };
const MESAJ_ANI = { tarih: "2026-11-25", saat: "14:30", saat_dilimi: DILIM };
const DAYANAK = { tarih: "2026-11-25", saat: "14:30" };
const CIHAZ = "cihaz_ajanda01";
/** İşaret koordinatı: hiçbir araç yanıtında, model metninde ve günlükte geçmemeli. */
const KONUM = { enlem_e6: 41_012_345, boylam_e6: 28_976_543, yaricap_m: 150 };
const EK_OZETI = "cd".repeat(32);
const EK = { ek_id: "ek_1", mime: "image/jpeg", bayt: 54_321, genislik: 800, yukseklik: 600, ozet: EK_OZETI, olusturma_ms: 5 };

const insanTuru = (insan_metni = "her iş günü iş yerine varınca imza hatırlat"): AjandaTurBaglami => ({
  tur_kokeni: "insan",
  turn_id: "tur_insan",
  mesaj_ani: MESAJ_ANI,
  insan_metni,
  kaynak_msg_id: "m_0001",
});
const sentetikTur = (): AjandaTurBaglami => ({ tur_kokeni: "sentetik", turn_id: "tur_sentetik", mesaj_ani: MESAJ_ANI });

const acik: CihazYonetimliDepo[] = [];
afterEach(() => {
  for (const d of acik.splice(0)) d.kapat();
});

const kur = () => {
  const zaman = sahteZaman(T0);
  const gunluk = sahteGunluk();
  const veriyolu: Veriyolu = { yayinla: () => {}, dinle: () => () => {} };
  const depo = depoAc({ yol: ":memory:", saat: zaman.saat, veriyolu, gunluk });
  acik.push(depo);
  const durum: { tur: AjandaTurBaglami | null } = { tur: insanTuru() };
  const ajanda = ajandaKur({
    depo,
    takvim: sahteTakvim(DILIM),
    saat: zaman.saat,
    rastgele: sahteRastgele(),
    gunluk,
    turBaglami: () => durum.tur,
    // Bu dosya v3 araç yüzünü sınar (ayar `ajanda_arac_v3` açık); kapalı yüz `ajanda-araclar-v2-yuz.test.ts`.
    aracV3: true,
  });
  ajanda.baslat();
  const cagir = async <F extends AjandaFiili>(fiil: F, girdi: AjandaFiilGirdisi<F>): Promise<AjandaFiilCiktisi<F>> => {
    const isleyici = ajanda.araclar[fiil] as (g: unknown, b: AjandaKopruBaglami, s: AbortSignal) => Promise<
      { ok: true; deger: AjandaFiilCiktisi<F> } | { ok: false; code: string }
    >;
    const s = await isleyici(girdi, BAGLAM, new AbortController().signal);
    assert.ok(s.ok, `boru hatası: ${s.ok ? "" : s.code}`);
    AJANDA_ARACLARI[fiil].cikti.parse(s.deger);
    return s.deger;
  };
  const ekle = (g: AjandaFiilGirdisi<"ajanda_ekle">) => cagir("ajanda_ekle", g);
  const guncelle = (g: AjandaFiilGirdisi<"ajanda_guncelle">) => cagir("ajanda_guncelle", g);
  const listele = (g: AjandaFiilGirdisi<"ajanda_listele"> = {}) => cagir("ajanda_listele", g);
  const kayit = (id: string): AjandaKaydi => {
    const k = depo.ajandaKaydiGetir(id);
    assert.ok(k !== null);
    AjandaKaydiSemasi.parse(k);
    return k;
  };
  let no = 0;
  const islem = (i: AjandaIslem) => {
    const s = ajanda.islemUygula(CIHAZ, `i_${++no}`, i);
    assert.equal(s.ok, true, JSON.stringify(s));
    return s;
  };
  return { zaman, gunluk, depo, ajanda, durum, ekle, guncelle, listele, kayit, islem };
};

const kimlik = (c: AjandaFiilCiktisi<"ajanda_ekle">): string => {
  assert.notEqual(c.sonuc, "ret", JSON.stringify(c));
  return (c as Extract<AjandaFiilCiktisi<"ajanda_ekle">, { kayit: unknown }>).kayit.kayit_id;
};

const IMZA: AjandaFiilGirdisi<"ajanda_ekle"> = {
  tur: "gorev",
  baslik: "İmza",
  zaman: { kesinlik: "gun", tarih: "2026-11-30" },
  bolge: "İş yeri",
  varis: { cikista: true },
  tekrar: { siklik: "haftalik", gunler: ["pzt", "sal", "car", "per", "cum"] },
  simge: "is",
  dayanak: DAYANAK,
};

/** Uygulamadan (elle) konum ve ekle yazılmış kayıt. */
const konumluKayit = (o: ReturnType<typeof kur>, kayit_id = "k_konum", bolge = "iş yeri") =>
  o.islem({
    islem: "ekle",
    kayit_id,
    tur: "gorev",
    baslik: "Kart okut",
    hatirlatmalar: [],
    girdi_yolu: "elle",
    simge: "is",
    bolge,
    bolge_konumu: KONUM,
    varis: {},
    baglantilar: [{ url: "https://ornek.com/kart", baslik: "Kart" }],
    ekler: [EK, { ...EK, ek_id: "ek_2" }],
  });

const sizmaz = (metin: string, ad: string) => {
  for (const s of [String(KONUM.enlem_e6), String(KONUM.boylam_e6), "bolge_konumu", "enlem_e6", "yaricap_m", EK_OZETI, "image/jpeg", String(EK.bayt)]) {
    assert.equal(metin.includes(s), false, `${ad}: ${s} sızdı`);
  }
};

describe("ajanda araçları v3: yazma", () => {
  it("her iş günü imza: haftalık bitişsiz tekrar, bölge, varış, simge; saatle hatırlatma yok; bolge_yeni", async () => {
    const o = kur();
    const c = await o.ekle(IMZA);
    assert.equal(c.sonuc, "eklendi");
    const k = o.kayit(kimlik(c));
    assert.deepEqual(k.tekrar, { siklik: "haftalik", aralik: 1, gunler: ["pzt", "sal", "car", "per", "cum"] });
    assert.equal(k.bolge, "İş yeri");
    assert.deepEqual(k.varis, { cikista: true });
    assert.equal(k.simge, "is");
    assert.equal(k.bolge_konumu, undefined);
    assert.deepEqual(k.hatirlatmalar, [], "varışlı kayıtta varsayılan saatli hatırlatma yok");
    assert.equal(k.taslak, false);
    assert.deepEqual(k.elle_alanlar, ["tur", "baslik", "zaman", "tekrar", "simge", "bolge", "varis"]);
    assert.ok(c.sonuc === "eklendi" && c.bolge_yeni === true);
    assert.ok(c.sonuc === "eklendi" && c.kayit.varis !== undefined);
    const m = ajandaEkleMetni(c);
    assert.match(m, /varis=giris,cikista/);
    assert.match(m, /konumunu telefondaki ajanda uygulamasında kaydetmesini söyle/);
    assert.equal(m.includes("İş yeri"), false, "özet metni bölge adı taşımaz");
  });

  it("markete gidince süt al: zamansız varışlı görev; bağlantı eklenir", async () => {
    const o = kur();
    o.durum.tur = insanTuru("markete gidince süt al");
    const c = await o.ekle({ tur: "gorev", baslik: "Süt al", bolge: "market", varis: {}, baglantilar: [{ url: "https://ornek.com/liste" }] });
    const k = o.kayit(kimlik(c));
    assert.deepEqual(k.varis, {});
    assert.deepEqual(k.baglantilar, [{ url: "https://ornek.com/liste" }]);
    assert.deepEqual(k.hatirlatmalar, []);
    assert.equal(k.tekrar, undefined);
  });

  it("sentetik turda varışlı kayıt taslak doğar; metin taslağı söyler", async () => {
    const o = kur();
    o.durum.tur = sentetikTur();
    const c = await o.ekle(IMZA);
    const k = o.kayit(kimlik(c));
    assert.equal(k.taslak, true);
    assert.equal(k.kaynak.tur_kokeni, "sentetik");
    assert.deepEqual(k.elle_alanlar, []);
    assert.match(ajandaEkleMetni(c), /Taslak: onaylanmadı/);
  });

  it("bolge_yeni: konumu olan, silinmemiş, aynı eşleşme anahtarlı kayıt varsa yok; silinmiş sayılmaz", async () => {
    const o = kur();
    konumluKayit(o, "k_konum", "İŞ  YERİ");
    const c = await o.ekle(IMZA);
    assert.ok(c.sonuc === "eklendi" && c.bolge_yeni === undefined, JSON.stringify(c));
    o.islem({ islem: "sil", kayit_id: "k_konum" });
    const d = await o.ekle({ ...IMZA, baslik: "İmza 2" });
    assert.ok(d.sonuc === "eklendi" && d.bolge_yeni === true);
    // Bölge vermeyen çağrıda bayrak yok.
    const e = await o.ekle({ tur: "gorev", baslik: "Bölgesiz" });
    assert.ok(e.sonuc === "eklendi" && e.bolge_yeni === undefined);
  });

  it("tekil anahtara bölge girer; aynı yer aynı kayıttır, başka yer yeni kayıt; eşe varış işlenir", async () => {
    const o = kur();
    const temel = { tur: "gorev" as const, baslik: "Süt al" };
    const a = kimlik(await o.ekle({ ...temel, bolge: "Market" }));
    const es = await o.ekle({ ...temel, bolge: "MARKET", varis: {} });
    assert.equal(es.sonuc, "zaten_var");
    assert.ok(es.sonuc === "zaten_var" && es.uygulanan_alanlar.includes("varis"));
    assert.deepEqual(o.kayit(a).varis, {});
    const b = kimlik(await o.ekle({ ...temel, bolge: "Eczane" }));
    assert.notEqual(a, b);
  });

  it("güncelleme: bölge, varış, tekrar, simge, bağlantı; birleşmiş kayıt kuralları tutarsiz_kayit + kural", async () => {
    const o = kur();
    const id = kimlik(await o.ekle({ tur: "gorev", baslik: "İmza", zaman: { kesinlik: "gun", tarih: "2026-11-30" }, dayanak: DAYANAK }));
    // Varışsız kayda tekrar: kural.
    const t = await o.guncelle({ kayit_id: id, degisiklik: { tekrar: { siklik: "gunluk" } } });
    assert.deepEqual(t, { sonuc: "ret", mesaj_ani: MESAJ_ANI, neden: "tutarsiz_kayit", kural: "tekrar_varis_ister" });
    assert.match(ajandaGuncelleMetni(t), /tekrar yalnız varışlı kayıtta olur/);
    // Bölgesiz varış: kural.
    const v = await o.guncelle({ kayit_id: id, degisiklik: { varis: {} } });
    assert.ok(v.sonuc === "ret" && v.kural === "varis_bolge_ister");
    // Hepsi birlikte: olur.
    const g = await o.guncelle({ kayit_id: id, degisiklik: { bolge: "iş yeri", varis: {}, tekrar: { siklik: "gunluk" }, simge: "is", baglantilar: [{ url: "http://a.b" }] } });
    assert.equal(g.sonuc, "guncellendi");
    assert.ok(g.sonuc === "guncellendi" && g.bolge_yeni === true);
    assert.deepEqual(o.kayit(id).tekrar, { siklik: "gunluk", aralik: 1 });
    // Varışı kaldırıp tekrarı bırakmak: kural; birlikte kaldırmak olur.
    const r = await o.guncelle({ kayit_id: id, degisiklik: { varis: null } });
    assert.ok(r.sonuc === "ret" && r.kural === "tekrar_varis_ister");
    // Bölgeyi kaldırıp varışı bırakmak: kural.
    const b = await o.guncelle({ kayit_id: id, degisiklik: { bolge: null } });
    assert.ok(b.sonuc === "ret" && b.kural === "varis_bolge_ister");
    const hepsi = await o.guncelle({ kayit_id: id, degisiklik: { bolge: null, varis: null, tekrar: null, simge: null, baglantilar: null } });
    assert.equal(hepsi.sonuc, "guncellendi");
    const k = o.kayit(id);
    for (const a of ["bolge", "varis", "tekrar", "simge", "baglantilar"] as const) assert.equal(k[a], undefined, a);
  });

  it("güncelleme: bölge başka yere değişince uygulamanın koyduğu konum düşer; aynı yer kalır", async () => {
    const o = kur();
    konumluKayit(o);
    const ayni = await o.guncelle({ kayit_id: "k_konum", degisiklik: { bolge: "İş Yeri" } });
    assert.equal(ayni.sonuc, "guncellendi");
    assert.ok(ayni.sonuc === "guncellendi" && ayni.bolge_yeni === undefined);
    assert.deepEqual(o.kayit("k_konum").bolge_konumu, KONUM);
    const baska = await o.guncelle({ kayit_id: "k_konum", degisiklik: { bolge: "okul" } });
    assert.ok(baska.sonuc === "guncellendi" && baska.bolge_yeni === true);
    assert.equal(o.kayit("k_konum").bolge_konumu, undefined);
  });
});

describe("ajanda araçları v3: varışlı kayıtta varsayılan hatırlatma kaydın zamanına göre", () => {
  const VARSAYILAN = [{ tur: "once", dk: 60 }];

  it("saatli kayıt + varış (1'de iş yerinde): saatle hatırlatma da kurulur, varış ona eklenir; varsayılan elle_alanlar'a girmez", async () => {
    const o = kur();
    o.durum.tur = insanTuru("1'de iş yerinde olmak lazım; önceden bildir, varınca imza hatırlat");
    // Mesaj anı 25 Kasım 14:30: "yarın 1'de".
    const d = await o.ekle({
      tur: "randevu",
      baslik: "İş yeri",
      zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "13:00" },
      bolge: "iş yeri",
      varis: {},
      dayanak: DAYANAK,
    });
    const k = o.kayit(kimlik(d));
    assert.deepEqual(k.hatirlatmalar, VARSAYILAN);
    assert.deepEqual(k.varis, {});
    assert.deepEqual(k.elle_alanlar, ["tur", "baslik", "zaman", "bolge", "varis"]);
    assert.ok(d.sonuc === "eklendi" && d.kayit.hatirlatma.kurulacak === 1, JSON.stringify(d));
  });

  it("saatsiz tarihli tek seferlik + varış: olağan varsayılan (gün hatırlatması)", async () => {
    const o = kur();
    const c = await o.ekle({ tur: "gorev", baslik: "İmza", zaman: { kesinlik: "gun", tarih: "2026-11-30" }, bolge: "iş yeri", varis: {}, dayanak: DAYANAK });
    const k = o.kayit(kimlik(c));
    assert.deepEqual(k.hatirlatmalar, VARSAYILAN);
    assert.ok(c.sonuc === "eklendi" && c.kayit.hatirlatma.gun_hatirlatmasi !== undefined, JSON.stringify(c));
  });

  it("zamansız + varış ve varışlı tekrar: []; kullanıcı açıkça istemezse verilen [] yazılır; varışsız kayıt değişmedi", async () => {
    const o = kur();
    const sut = o.kayit(kimlik(await o.ekle({ tur: "gorev", baslik: "Süt al", bolge: "market", varis: {} })));
    assert.deepEqual(sut.hatirlatmalar, []);
    const imza = o.kayit(kimlik(await o.ekle(IMZA)));
    assert.deepEqual(imza.hatirlatmalar, [], "her iş günü: her sabah zaman bildirimi yok");
    const yalnizVaris = o.kayit(
      kimlik(await o.ekle({ tur: "gorev", baslik: "Yalnız varınca", zaman: { kesinlik: "gun", tarih: "2026-11-30" }, bolge: "iş yeri", varis: {}, hatirlatmalar: [], dayanak: DAYANAK })),
    );
    assert.deepEqual(yalnizVaris.hatirlatmalar, []);
    assert.ok(yalnizVaris.elle_alanlar.includes("hatirlatmalar"));
    const varissiz = o.kayit(kimlik(await o.ekle({ tur: "gorev", baslik: "Zamansız varışsız" })));
    assert.deepEqual(varissiz.hatirlatmalar, VARSAYILAN);
  });

  it("eşe işlenen değişiklikte aynı kural: varsayılanlı tarihli eşe varış ve tekrar → []; saatli eşe varış → varsayılan kalır", async () => {
    const o = kur();
    const temel = { tur: "gorev" as const, baslik: "İmza", zaman: { kesinlik: "gun" as const, tarih: "2026-11-30" }, bolge: "iş yeri", dayanak: DAYANAK };
    const id = kimlik(await o.ekle(temel));
    assert.deepEqual(o.kayit(id).hatirlatmalar, VARSAYILAN);
    const es = await o.ekle({ ...temel, varis: {}, tekrar: { siklik: "haftalik", gunler: ["pzt", "sal", "car", "per", "cum"] } });
    assert.ok(es.sonuc === "zaten_var", JSON.stringify(es));
    assert.deepEqual(es.uygulanan_alanlar, ["tekrar", "varis"], "varsayılan söylenen alan değildir");
    const k = o.kayit(id);
    assert.deepEqual(k.hatirlatmalar, []);
    assert.equal(k.elle_alanlar.includes("hatirlatmalar"), false);
    const g = o.depo.ajandaGecmisi({ kayit_id: id, adet: 1 })[0];
    assert.deepEqual(g?.onceki.hatirlatmalar, VARSAYILAN);
    assert.deepEqual(g?.sonraki.hatirlatmalar, []);

    const saatli = { tur: "randevu" as const, baslik: "Toplantı", zaman: { kesinlik: "an" as const, tarih: "2026-11-26", saat: "13:00" }, bolge: "iş yeri", dayanak: DAYANAK };
    const sid = kimlik(await o.ekle(saatli));
    const s2 = await o.ekle({ ...saatli, varis: {} });
    assert.ok(s2.sonuc === "zaten_var" && s2.uygulanan_alanlar.join() === "varis", JSON.stringify(s2));
    assert.deepEqual(o.kayit(sid).hatirlatmalar, VARSAYILAN);
  });
});

describe("ajanda araçları v3: telefon sohbetinde eş taslak", () => {
  it("aynı sohbetin sentetik taslağı insanın eklemesiyle onaylanır ve alanlarını taşır (davranış değişmedi)", async () => {
    const o = kur();
    o.durum.tur = sentetikTur();
    const temel = { tur: "gorev" as const, baslik: "Süt al", bolge: "market" };
    const id = kimlik(await o.ekle({ ...temel, aciklama: "taslak açıklaması", varis: {}, simge: "market", hatirlatmalar: [{ tur: "once", dk: 5 }] }));
    o.durum.tur = insanTuru("markete gidince süt al");
    const c = await o.ekle(temel);
    assert.equal(c.sonuc, "onaylandi");
    assert.ok(c.sonuc === "onaylandi" && c.uygulanan_alanlar.length === 0);
    const k = o.kayit(id);
    assert.equal(k.taslak, false);
    assert.equal(k.aciklama, "taslak açıklaması");
    assert.deepEqual(k.varis, {});
    assert.equal(k.simge, "market");
    assert.deepEqual(k.hatirlatmalar, [{ tur: "once", dk: 5 }]);
    assert.deepEqual(o.depo.ajandaGecmisi({ kayit_id: id, adet: 1 })[0]?.sonraki, { taslak: false });
  });
});

describe("ajanda araçları v3: liste", () => {
  it("bölge süzgeci eşleşme anahtarıyla; bölge adları en son kullanılan önce, anahtar başına bir ad", async () => {
    const o = kur();
    await o.ekle({ tur: "gorev", baslik: "Süt", bolge: "market", varis: {} });
    o.zaman.ilerlet(60_000);
    await o.ekle({ tur: "gorev", baslik: "Ekmek", bolge: "MARKET", varis: {} });
    o.zaman.ilerlet(60_000);
    await o.ekle({ tur: "gorev", baslik: "Ödev", bolge: "okul" });
    await o.ekle({ tur: "gorev", baslik: "Bölgesiz" });
    const l = await o.listele({ bolge: "Market" });
    assert.deepEqual(l.kayitlar.map((k) => k.baslik), ["Süt", "Ekmek"]);
    assert.equal(l.toplam, 2);
    assert.deepEqual(l.bolgeler, ["okul", "MARKET"]);
    const metin = ajandaMcpSonucu({ fiil: "ajanda_listele", cikti: l }, () => "c".repeat(32)).content[0].text;
    assert.match(metin, /\nbolgeler: "okul", "MARKET"\n<<<okunan-metin-sonu c{32}>>>$/);
  });

  it("v3 alanı olmayan kayıtlar: liste çıktısı depodaki kaydın kendisidir (bayt bayt), bölge alanı yok", async () => {
    const o = kur();
    o.durum.tur = insanTuru("yarın 3'te dişçi");
    const a = kimlik(await o.ekle({ tur: "randevu", baslik: "Dişçi", zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00" }, dayanak: DAYANAK }));
    const b = kimlik(await o.ekle({ tur: "gorev", baslik: "Fatura" }));
    assert.deepEqual(o.kayit(b).hatirlatmalar, [{ tur: "once", dk: 60 }], "v2 varsayılanı değişmedi");
    const l = await o.listele();
    assert.equal("bolgeler" in l, false);
    const parsed = AJANDA_ARACLARI.ajanda_listele.cikti.parse(l);
    assert.equal(
      JSON.stringify(parsed),
      JSON.stringify({ mesaj_ani: MESAJ_ANI, kayitlar: [AjandaKaydiSemasi.parse(o.kayit(a)), AjandaKaydiSemasi.parse(o.kayit(b))], toplam: 2 }),
    );
  });
});

describe("ajanda araçları v3: gizlilik (konum ve ek üstverisi)", () => {
  it("işaret koordinatlı kayıt hiçbir boru yanıtında, model metninde ve günlükte görünmez", async () => {
    const o = kur();
    const boru = sahteBoru();
    const sunucu = ajandaKopruSunucuKur({
      boru,
      depo: o.depo,
      rastgele: sahteRastgele(77),
      anahtar: { sabitZamanEsit: (a: string, b: string) => a === b },
      zamanlayici: o.zaman.zamanlayici,
      gunluk: o.gunluk,
      aracV3: true,
    });
    await sunucu.baslat(o.ajanda.araclar);
    const jeton = sunucu.jetonUret({ rol: "ana_oturum", sohbet_id: "ana", nesil: 3 });
    const b = boru.baglan(AJANDA_BORU_ADI);
    const bosalt = async () => {
      for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r));
    };
    b.satirGonder(JSON.stringify({ v: PROTOKOL_SURUMU, type: "kopru_hello", rol: "ana_oturum", jeton }));
    await bosalt();

    konumluKayit(o);
    const istekler: [AjandaFiili, unknown][] = [
      ["ajanda_listele", {}],
      ["ajanda_listele", { bolge: "İŞ YERİ" }],
      ["ajanda_listele", { durumlar: ["acik", "tamam", "iptal"], ara: "Kart" }],
      ["ajanda_ekle", { tur: "gorev", baslik: "Kart okut", bolge: "iş yeri" }],
      ["ajanda_ekle", { tur: "gorev", baslik: "Başka", bolge: "İş yeri", varis: {} }],
      ["ajanda_guncelle", { kayit_id: "k_konum", degisiklik: { simge: "kahve" } }],
      ["ajanda_guncelle", { kayit_id: "k_konum", degisiklik: { simge: "kahve" } }],
      ["ajanda_guncelle", { kayit_id: "k_konum", degisiklik: { bolge: null } }],
    ];
    const yanitlar: unknown[] = [];
    for (const [i, [fiil, girdi]] of istekler.entries()) {
      b.satirGonder(JSON.stringify({ v: PROTOKOL_SURUMU, type: "istek", istek_id: `i${i}`, fiil, girdi }));
      await bosalt();
      const satir = b.yazilanlar.at(-1)!;
      sizmaz(satir, `boru ${fiil} ${i}`);
      const c = ajandaKopruAsagiCoz(satir);
      assert.ok(c.ok && c.mesaj.type === "yanit" && c.mesaj.ok === true, satir.slice(0, 200));
      const sonuc = (c.mesaj as { sonuc: unknown }).sonuc;
      yanitlar.push(sonuc);
      const mcp = ajandaMcpSonucu({ fiil, cikti: AJANDA_ARACLARI[fiil].cikti.parse(sonuc) } as never, () => "d".repeat(32));
      sizmaz(JSON.stringify(mcp), `model metni ${fiil} ${i}`);
    }
    // Liste kaydı adı, varışı, bağlantıyı ve ek sayısını gösterir; konumu ve ek üstverisini göstermez.
    const liste = yanitlar[0] as { kayitlar: Record<string, unknown>[]; bolgeler: string[] };
    const k = liste.kayitlar.find((x) => x.kayit_id === "k_konum")!;
    assert.equal(k.bolge, "iş yeri");
    assert.equal(k.ek_sayisi, 2);
    assert.equal("ekler" in k, false);
    assert.equal("bolge_konumu" in k, false);
    assert.deepEqual(k.elle_alanlar, ["tur", "baslik", "hatirlatmalar", "simge", "bolge", "varis", "baglantilar"]);
    assert.deepEqual(liste.bolgeler, ["iş yeri"]);
    assert.equal((yanitlar[1] as { kayitlar: unknown[] }).kayitlar.length, 1, "bölge süzgeci anahtarla");
    // Konum zaten kayıtlı: aynı yer için bolge_yeni yok.
    assert.equal((yanitlar[4] as { bolge_yeni?: true }).bolge_yeni, undefined);
    // Bölge kaldırılınca varış bölgesiz kalır: kural reddi, kayıt (ve konum) değişmez.
    assert.equal((yanitlar[7] as { kural?: string }).kural, "varis_bolge_ister");
    assert.deepEqual(o.kayit("k_konum").bolge_konumu, KONUM, "konum depoda yedek olarak durur");
    // Günlük: hiçbir satır koordinat, ek üstverisi ya da bölge adı taşımaz.
    const gunlukMetni = JSON.stringify(o.gunluk.girdiler);
    sizmaz(gunlukMetni, "günlük");
    assert.equal(gunlukMetni.includes("iş yeri"), false, "bölge adı günlüğe girmez");
    assert.ok(o.gunluk.bul("arac").length >= istekler.length);
    await sunucu.kapat();
  });

  it("süzgeci atlayan çıktı boru sınırında ic_hata olur, konum sızmaz", async () => {
    const o = kur();
    konumluKayit(o);
    const boru = sahteBoru();
    const ham = o.kayit("k_konum");
    const sunucu = ajandaKopruSunucuKur({
      boru,
      depo: o.depo,
      rastgele: sahteRastgele(78),
      anahtar: { sabitZamanEsit: (a: string, b: string) => a === b },
      zamanlayici: o.zaman.zamanlayici,
      gunluk: o.gunluk,
      aracV3: true,
    });
    // Süzgeçsiz (eski) bir işleyici: tam kaydı döner.
    const isleyiciler = { ...o.ajanda.araclar, ajanda_listele: async () => ({ ok: true, deger: { mesaj_ani: MESAJ_ANI, kayitlar: [ham], toplam: 1 } }) };
    await sunucu.baslat(isleyiciler as unknown as typeof o.ajanda.araclar);
    const jeton = sunucu.jetonUret({ rol: "ana_oturum", sohbet_id: "ana", nesil: 3 });
    const b = boru.baglan(AJANDA_BORU_ADI);
    b.satirGonder(JSON.stringify({ v: PROTOKOL_SURUMU, type: "kopru_hello", rol: "ana_oturum", jeton }));
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
    b.satirGonder(JSON.stringify({ v: PROTOKOL_SURUMU, type: "istek", istek_id: "i1", fiil: "ajanda_listele", girdi: {} }));
    for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r));
    const satir = b.yazilanlar.at(-1)!;
    assert.deepEqual(JSON.parse(satir), { v: PROTOKOL_SURUMU, type: "yanit", istek_id: "i1", ok: false, code: "ic_hata" });
    sizmaz(b.yazilanlar.join("\n") + JSON.stringify(o.gunluk.girdiler), "sınır");
    await sunucu.kapat();
  });
});
