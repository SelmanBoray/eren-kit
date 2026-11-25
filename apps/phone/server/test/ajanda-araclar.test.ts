/**
 * ajanda modülü, araç yolu (`araclar`: `ajanda_ekle`, `ajanda_guncelle`, `ajanda_listele`): tur bağlamı,
 * dayanak (23:58/00:01), dilim doldurma, varsayılan hatırlatma, alıntı ve kaynak izi, sentetik tur ve
 * taslak, korunan alanlar, tekilleştirme (emir/otomasyon; silinmiş ve bitmiş eş), kabul senaryosu,
 * liste süzgeci ve sırası. Her çıktı `AJANDA_ARACLARI[fiil].cikti` şemasından geçer (köprünün yaptığı gibi).
 * `docs/AJANDA.md` "Araç yolu", "Çakışma ve otomasyon kuralları", "Servis: ajanda modülü".
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  AJANDA_ARACLARI,
  AJANDA_SINIRLARI,
  type AjandaFiili,
  type AjandaIslem,
  type AjandaKaydi,
  AjandaKaydi as AjandaKaydiSemasi,
  ajandaTekilAnahtari,
  kurulacakHatirlatmalar,
} from "@eren/protocol";
import { ajandaKur } from "../src/ajanda.ts";
import { depoAc } from "../src/depo.ts";
import type { CihazYonetimliDepo } from "../src/depo.ts";
import type {
  AjandaBagimliliklari,
  AjandaFiilCiktisi,
  AjandaFiilGirdisi,
  AjandaKopruBaglami,
  AjandaTurBaglami,
  ServisOlaylari,
  SohbetSecimi,
  Veriyolu,
} from "../src/sozlesme.ts";
import { sahteGunluk, sahteRastgele, sahteTakvim, sahteZaman } from "./sahte.ts";

// 2026-11-25 14:30 Europe/Istanbul.
const T0 = 1_795_606_200_000;
const DILIM = "Europe/Istanbul";
const DAKIKA = 60_000;
const CIHAZ = "cihaz_ajanda01";
const BAGLAM: AjandaKopruBaglami = { rol: "ana_oturum", sohbet_id: "ana", nesil: 3 };
const MESAJ_ANI = { tarih: "2026-11-25", saat: "14:30", saat_dilimi: DILIM };
const DAYANAK = { tarih: "2026-11-25", saat: "14:30" };

const insanTuru = (insan_metni = "yarın 3'te dişçi ☕️", mesaj_ani = MESAJ_ANI): AjandaTurBaglami => ({
  tur_kokeni: "insan",
  turn_id: "tur_insan",
  mesaj_ani,
  insan_metni,
  kaynak_msg_id: "m_0001",
});
const sentetikTur = (mesaj_ani = MESAJ_ANI): AjandaTurBaglami => ({ tur_kokeni: "sentetik", turn_id: "tur_sentetik", mesaj_ani });

const acik: CihazYonetimliDepo[] = [];
afterEach(() => {
  for (const d of acik.splice(0)) d.kapat();
});

const kur = (sec: { depo?: (d: CihazYonetimliDepo) => AjandaBagimliliklari["depo"]; simdi?: number } = {}) => {
  const zaman = sahteZaman(sec.simdi ?? T0);
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
  const durum: { tur: AjandaTurBaglami | null; istenen: [SohbetSecimi, number][] } = { tur: insanTuru(), istenen: [] };
  const ajanda = ajandaKur({
    depo: sec.depo === undefined ? depo : sec.depo(depo),
    takvim,
    saat: zaman.saat,
    rastgele: sahteRastgele(),
    gunluk,
    turBaglami: (s, n) => {
      durum.istenen.push([s, n]);
      return durum.tur;
    },
  });
  ajanda.baslat();

  const cagir = async <F extends AjandaFiili>(fiil: F, girdi: AjandaFiilGirdisi<F>, baglam = BAGLAM): Promise<AjandaFiilCiktisi<F>> => {
    const isleyici = ajanda.araclar[fiil] as (g: unknown, b: AjandaKopruBaglami, s: AbortSignal) => Promise<
      { ok: true; deger: AjandaFiilCiktisi<F> } | { ok: false; code: string }
    >;
    const s = await isleyici(girdi, baglam, new AbortController().signal);
    assert.ok(s.ok, `boru hatası: ${s.ok ? "" : s.code}`);
    // Köprü çıktıyı şemayla doğrular; burada da geçmeli.
    AJANDA_ARACLARI[fiil].cikti.parse(s.deger);
    return s.deger;
  };
  const ekle = (girdi: AjandaFiilGirdisi<"ajanda_ekle">, baglam = BAGLAM) => cagir("ajanda_ekle", girdi, baglam);
  const guncelle = (girdi: AjandaFiilGirdisi<"ajanda_guncelle">) => cagir("ajanda_guncelle", girdi);
  const listele = (girdi: AjandaFiilGirdisi<"ajanda_listele"> = {}) => cagir("ajanda_listele", girdi);
  const kayit = (id: string): AjandaKaydi => {
    const k = depo.ajandaKaydiGetir(id);
    assert.ok(k !== null);
    AjandaKaydiSemasi.parse(k);
    return k;
  };
  let islemNo = 0;
  const islem = (i: AjandaIslem) => ajanda.islemUygula(CIHAZ, `i_${++islemNo}`, i);
  return { zaman, gunluk, yayinlar, depo, takvim, ajanda, durum, ekle, guncelle, listele, kayit, islem, cagir };
};

type Ortam = ReturnType<typeof kur>;

const DISCI: AjandaFiilGirdisi<"ajanda_ekle"> = {
  tur: "randevu",
  baslik: "Dişçi ☕️",
  zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", ifade: "yarın 3'te" },
  alinti: "yarın 3'te dişçi ☕️",
  dayanak: DAYANAK,
};

/** Ekleme çıktısının kayıt kimliği (ret değilse). */
const kimlik = (c: AjandaFiilCiktisi<"ajanda_ekle">): string => {
  assert.notEqual(c.sonuc, "ret", JSON.stringify(c));
  return (c as Extract<AjandaFiilCiktisi<"ajanda_ekle">, { kayit: unknown }>).kayit.kayit_id;
};

describe("ajanda araçları: tur bağlamı ve boru düzeyi sonuç", () => {
  it("tur yoksa tur_gecersiz ve hiçbir şey yazılmaz; tur bağlamı jetonun sohbeti ve nesliyle istenir", async () => {
    const o = kur();
    o.durum.tur = null;
    for (const fiil of ["ajanda_ekle", "ajanda_guncelle", "ajanda_listele"] as const) {
      const girdi = fiil === "ajanda_ekle" ? DISCI : fiil === "ajanda_guncelle" ? { kayit_id: "k_x", degisiklik: { durum: "tamam" } } : {};
      const s = await (o.ajanda.araclar[fiil] as (g: unknown, b: AjandaKopruBaglami, s: AbortSignal) => Promise<unknown>)(
        girdi,
        BAGLAM,
        new AbortController().signal,
      );
      assert.deepEqual(s, { ok: false, code: "tur_gecersiz" });
    }
    assert.deepEqual(o.durum.istenen[0], [{ sohbet_id: "ana" }, 3]);
    assert.equal(o.depo.ajandaKayitSayisi(), 0);
  });

  it("iptal edilmiş çağrı ve atan yazım ic_hata; hiçbir şey yazılmaz", async () => {
    const o = kur({
      depo: (d) =>
        new Proxy(d, {
          get: (t, k) =>
            k === "ajandaDegisiklikYaz"
              ? () => {
                  throw new Error("vt");
                }
              : Reflect.get(t, k),
        }),
    });
    const ac = new AbortController();
    ac.abort();
    assert.deepEqual(await o.ajanda.araclar.ajanda_ekle(DISCI, BAGLAM, ac.signal), { ok: false, code: "ic_hata" });
    assert.deepEqual(await o.ajanda.araclar.ajanda_ekle(DISCI, BAGLAM, new AbortController().signal), { ok: false, code: "ic_hata" });
    assert.equal(o.depo.ajandaKayitSayisi(), 0);
    assert.equal(o.yayinlar.length, 0);
    assert.equal(o.gunluk.bul("arac_hatasi", "hata").length, 1);
  });

  it("şemadan geçmeyen girdi (köprüyü atlayan çağrı) ic_hata", async () => {
    const o = kur();
    const s = await o.ajanda.araclar.ajanda_ekle(
      { tur: "randevu", baslik: "X", zaman: { kesinlik: "gun", tarih: "2026-11-26" } } as AjandaFiilGirdisi<"ajanda_ekle">,
      BAGLAM,
      new AbortController().signal,
    );
    assert.deepEqual(s, { ok: false, code: "ic_hata" });
  });
});

describe("ajanda araçları: kabul senaryosu ve dayanak", () => {
  it('"yarın 3\'te dişçi ☕️": insan turunda eklenir, 14:00 hatırlatması kurulur, kayit yayınlanır, uygulamadan tamam/acik', async () => {
    const o = kur();
    const c = await o.ekle(DISCI);
    assert.equal(c.sonuc, "eklendi");
    assert.deepEqual(c.mesaj_ani, MESAJ_ANI);
    const id = kimlik(c);
    const k = o.kayit(id);
    assert.equal(k.taslak, false);
    assert.equal(k.baslik, "Dişçi ☕️");
    // Dilimsiz araç zamanı mesaj anının dilimini alır; ifade birebir saklanır.
    assert.deepEqual(k.zaman, { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", ifade: "yarın 3'te", saat_dilimi: DILIM });
    assert.deepEqual(k.hatirlatmalar, [{ tur: "once", dk: 60 }]);
    assert.deepEqual(k.kaynak, {
      yol: "sohbet_araci",
      tur_kokeni: "insan",
      sohbet_id: "ana",
      kaynak_msg_id: "m_0001",
      alinti: "yarın 3'te dişçi ☕️",
      tekil_anahtar: ajandaTekilAnahtari({ kapsam: "sohbet:ana", tur: "randevu", baslik: "Dişçi ☕️", zaman: k.zaman }),
    });
    // Karar: emirle doğan kayıtta açıkça verilen alanlar elle izine girer; varsayılan hatırlatma girmez.
    assert.deepEqual(k.elle_alanlar, ["tur", "baslik", "zaman"]);
    assert.ok(c.sonuc === "eklendi");
    assert.deepEqual(c.kayit.zaman, { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", saat_dilimi: DILIM });
    assert.deepEqual(c.kayit.hatirlatma, { toplam: 1, kurulacak: 1, saatsiz: 0, gecmis: 0 });
    assert.deepEqual(
      kurulacakHatirlatmalar(k, T0, o.takvim.anCevir).map((h) => h.tetik_ms),
      [o.takvim.anCevir("2026-11-26", "14:00", DILIM)],
    );
    assert.deepEqual(o.yayinlar.map((y) => y.kayit_id), [id]);
    const g = o.depo.ajandaGecmisi({ kayit_id: id, adet: 5 })[0];
    assert.deepEqual(g?.yazar, { yol: "sohbet_araci", tur_kokeni: "insan", sohbet_id: "ana" });
    // Uygulamadan elle ekleme, tamam ve geri alma.
    assert.equal(o.islem({ islem: "durum", kayit_id: id, durum: "tamam" }).ok, true);
    assert.equal(o.islem({ islem: "durum", kayit_id: id, durum: "acik" }).ok, true);
    assert.equal(o.kayit(id).durum, "acik");
    assert.equal(o.yayinlar.length, 3);
  });

  it("23:58'de yazılıp 00:01'de iletilen mesaj: 00:01 dayanağı reddedilir, mesaj anı 23:58 döner; 23:58 dayanağı kabul", async () => {
    const o = kur({ simdi: Date.UTC(2026, 10, 25, 21, 5) });
    const an = { tarih: "2026-11-25", saat: "23:58", saat_dilimi: DILIM };
    o.durum.tur = insanTuru("yarın 3'te dişçi", an);
    const yarin = { kesinlik: "an" as const, tarih: "2026-11-27", saat: "15:00", ifade: "yarın 3'te" };
    const ret = await o.ekle({ tur: "randevu", baslik: "Dişçi", zaman: yarin, dayanak: { tarih: "2026-11-26", saat: "00:01" } });
    assert.deepEqual(ret, { sonuc: "ret", mesaj_ani: an, neden: "dayanak_uyusmuyor" });
    assert.equal(o.depo.ajandaKayitSayisi(), 0);
    const ok = await o.ekle({
      tur: "randevu",
      baslik: "Dişçi",
      zaman: { ...yarin, tarih: "2026-11-26" },
      dayanak: { tarih: "2026-11-25", saat: "23:58" },
    });
    assert.equal(ok.sonuc, "eklendi");
    const z = o.kayit(kimlik(ok)).zaman;
    assert.equal(z?.kesinlik === "an" ? z.tarih : null, "2026-11-26", "yarın, mesaj anının ertesi günü");
    // Sapma sınırı: 10 dk kabul, 11 dk ret; dilim farkı ret.
    assert.equal((await o.ekle({ tur: "gorev", baslik: "A", zaman: yarin, dayanak: { tarih: "2026-11-25", saat: "23:48" } })).sonuc, "eklendi");
    assert.equal((await o.ekle({ tur: "gorev", baslik: "B", zaman: yarin, dayanak: { tarih: "2026-11-25", saat: "23:47" } })).sonuc, "ret");
    assert.equal(
      (await o.ekle({ tur: "gorev", baslik: "C", zaman: yarin, dayanak: { tarih: "2026-11-25", saat: "23:58", saat_dilimi: "UTC" } }))
        .sonuc,
      "ret",
    );
  });

  it("dayanak yalnız takvime bağlı girdide istenir; güncellemede de denetlenir", async () => {
    const o = kur();
    const c = await o.ekle({ tur: "not", baslik: "Kitap önerisi", zaman: { kesinlik: "belirsiz", ifade: "bir ara" } });
    assert.equal(c.sonuc, "eklendi");
    const id = kimlik(c);
    const g = await o.guncelle({
      kayit_id: id,
      dayanak: { tarih: "2026-11-24", saat: "14:30" },
      degisiklik: { zaman: { kesinlik: "gun", tarih: "2026-11-30" } },
    });
    assert.deepEqual(g, { sonuc: "ret", mesaj_ani: MESAJ_ANI, neden: "dayanak_uyusmuyor" });
    const m = await o.guncelle({
      kayit_id: id,
      dayanak: DAYANAK,
      degisiklik: { hatirlatmalar: [{ tur: "mutlak", tarih: "2026-11-29", saat: "09:00" }] },
    });
    assert.equal(m.sonuc, "guncellendi");
    assert.deepEqual(o.kayit(id).hatirlatmalar, [{ tur: "mutlak", tarih: "2026-11-29", saat: "09:00", saat_dilimi: DILIM }]);
    assert.equal((await o.guncelle({ kayit_id: id, degisiklik: { durum: "tamam" } })).sonuc, "guncellendi");
  });
});

describe("ajanda araçları: ekleme kuralları", () => {
  it("varsayılan hatırlatma her kesinlikte; [] hiç kurmaz ve öyle kalır; saatsizde bekler", async () => {
    const o = kur();
    const gun = await o.ekle({ tur: "gorev", baslik: "Fatura", zaman: { kesinlik: "gun", tarih: "2026-11-30" }, dayanak: DAYANAK });
    assert.ok(gun.sonuc === "eklendi");
    assert.deepEqual(o.kayit(gun.kayit.kayit_id).hatirlatmalar, [{ tur: "once", dk: 60 }]);
    assert.deepEqual(gun.kayit.hatirlatma, { toplam: 1, kurulacak: 0, saatsiz: 1, gecmis: 0 });
    const yok = await o.ekle({ tur: "not", baslik: "Not" });
    assert.ok(yok.sonuc === "eklendi");
    assert.deepEqual(o.kayit(yok.kayit.kayit_id).hatirlatmalar, [{ tur: "once", dk: 60 }]);
    assert.equal(yok.kayit.zaman, undefined);
    const bos = await o.ekle({ ...DISCI, baslik: "Hatırlatmasız", hatirlatmalar: [] });
    assert.ok(bos.sonuc === "eklendi");
    assert.deepEqual(o.kayit(bos.kayit.kayit_id).hatirlatmalar, []);
    assert.deepEqual(o.kayit(bos.kayit.kayit_id).elle_alanlar, ["tur", "baslik", "zaman", "hatirlatmalar"]);
  });

  it("geçmişte kalan hatırlatma özetlenir: 14:30'da bugün 15:00, varsayılan 14:00 çalmaz", async () => {
    const o = kur();
    const c = await o.ekle({ tur: "randevu", baslik: "Kargo", zaman: { kesinlik: "an", tarih: "2026-11-25", saat: "15:00" }, dayanak: DAYANAK });
    assert.ok(c.sonuc === "eklendi");
    assert.deepEqual(c.kayit.hatirlatma, { toplam: 1, kurulacak: 0, saatsiz: 0, gecmis: 1 });
  });

  it("dilim: verilen dilim korunur, mutlak hatırlatma doldurulur, bilinmeyen dilim saat_dilimi_bilinmiyor", async () => {
    const o = kur();
    const c = await o.ekle({
      tur: "randevu",
      baslik: "Toplantı",
      zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "09:00", saat_dilimi: "Asia/Tokyo" },
      hatirlatmalar: [{ tur: "mutlak", tarih: "2026-11-25", saat: "20:00" }],
      dayanak: DAYANAK,
    });
    const k = o.kayit(kimlik(c));
    assert.equal(k.zaman?.kesinlik === "an" ? k.zaman.saat_dilimi : null, "Asia/Tokyo");
    assert.deepEqual(k.hatirlatmalar, [{ tur: "mutlak", tarih: "2026-11-25", saat: "20:00", saat_dilimi: DILIM }]);
    const r = await o.ekle({
      tur: "gorev",
      baslik: "X",
      zaman: { kesinlik: "gun", tarih: "2026-11-26", saat_dilimi: "Mars/Phobos" },
      dayanak: DAYANAK,
    });
    assert.deepEqual(r, { sonuc: "ret", mesaj_ani: MESAJ_ANI, neden: "saat_dilimi_bilinmiyor" });
    // Mesaj anının dilimi veritabanında yoksa dilimsiz zaman da bilinmez.
    o.durum.tur = insanTuru("x", { ...MESAJ_ANI, saat_dilimi: "Europe/Nowhere" });
    const r2 = await o.ekle({ tur: "gorev", baslik: "Y", zaman: { kesinlik: "gun", tarih: "2026-11-26" }, dayanak: DAYANAK });
    assert.equal(r2.sonuc === "ret" && r2.neden, "saat_dilimi_bilinmiyor");
  });

  it("alıntı yalnız turun insan mesajında birebir geçiyorsa; sentetik turda alıntı ve kaynak_msg_id yok", async () => {
    const o = kur();
    o.durum.tur = insanTuru("Yarın 3'te dişçi ☕️ var, unutma");
    const uymaz = await o.ekle({ ...DISCI, alinti: "yarın 3'te dişçi" });
    assert.equal(o.kayit(kimlik(uymaz)).kaynak.alinti, undefined);
    const uyar = await o.ekle({ ...DISCI, baslik: "Dişçi 2", alinti: "dişçi ☕️ var" });
    assert.equal(o.kayit(kimlik(uyar)).kaynak.alinti, "dişçi ☕️ var");
    o.durum.tur = sentetikTur();
    const s = await o.ekle({ ...DISCI, baslik: "Dişçi 3", alinti: "dişçi ☕️ var" });
    const k = o.kayit(kimlik(s));
    assert.equal(k.kaynak.alinti, undefined);
    assert.equal(k.kaynak.kaynak_msg_id, undefined);
    assert.equal(k.kaynak.tur_kokeni, "sentetik");
  });

  it("KAYIT_ADET dolunca yeni kayıt kayit_siniri; eşe yansıyan ekleme sınırdan etkilenmez", async () => {
    let sayi = 0;
    const o = kur({ depo: (d) => new Proxy(d, { get: (t, k) => (k === "ajandaKayitSayisi" ? () => sayi : Reflect.get(t, k)) }) });
    const c = await o.ekle(DISCI);
    sayi = AJANDA_SINIRLARI.KAYIT_ADET;
    assert.deepEqual(await o.ekle({ ...DISCI, baslik: "Yeni" }), { sonuc: "ret", mesaj_ani: MESAJ_ANI, neden: "kayit_siniri" });
    const es = await o.ekle({ ...DISCI, aciklama: "Dolgu" });
    assert.equal(es.sonuc, "zaten_var");
    assert.equal(kimlik(es), kimlik(c));
  });
});

describe("ajanda araçları: sentetik tur, taslak, korunan alanlar", () => {
  it("sentetik turda taslak doğar: hatırlatması kurulmaz, elle izi boş", async () => {
    const o = kur();
    o.durum.tur = sentetikTur();
    const c = await o.ekle(DISCI);
    assert.ok(c.sonuc === "eklendi");
    assert.equal(c.kayit.taslak, true);
    assert.equal(c.kayit.hatirlatma.kurulacak, 0);
    const k = o.kayit(c.kayit.kayit_id);
    assert.deepEqual(k.elle_alanlar, []);
    assert.deepEqual(kurulacakHatirlatmalar(k, T0, o.takvim.anCevir), []);
  });

  it("sentetik tur taslağı düzenleyebilir ama onaylayamaz; taslak olmayan kayda dokunamaz", async () => {
    const o = kur();
    const kesin = kimlik(await o.ekle(DISCI));
    o.durum.tur = sentetikTur();
    const taslak = kimlik(await o.ekle({ tur: "gorev", baslik: "Taslak iş" }));
    assert.equal((await o.guncelle({ kayit_id: taslak, degisiklik: { aciklama: "Ek bilgi" } })).sonuc, "guncellendi");
    for (const degisiklik of [{ onayla: true as const }, { onayla: true as const, aciklama: "x" }]) {
      assert.deepEqual(await o.guncelle({ kayit_id: taslak, degisiklik }), {
        sonuc: "ret",
        mesaj_ani: MESAJ_ANI,
        neden: "sentetik_turda_izinsiz",
      });
    }
    for (const degisiklik of [{ durum: "tamam" as const }, { baslik: "Değişti" }]) {
      assert.deepEqual(await o.guncelle({ kayit_id: kesin, degisiklik }), {
        sonuc: "ret",
        mesaj_ani: MESAJ_ANI,
        neden: "sentetik_turda_izinsiz",
      });
    }
    assert.equal(o.kayit(taslak).taslak, true);
    assert.equal(o.kayit(kesin).durum, "acik");
  });

  it("taslağı insan turunda onayla:true ya da uygulamadan onayla kesinleştirir", async () => {
    const o = kur();
    o.durum.tur = sentetikTur();
    const a = kimlik(await o.ekle({ tur: "gorev", baslik: "A" }));
    const b = kimlik(await o.ekle({ tur: "gorev", baslik: "B" }));
    o.durum.tur = insanTuru();
    const g = await o.guncelle({ kayit_id: a, degisiklik: { onayla: true } });
    assert.ok(g.sonuc === "guncellendi");
    assert.equal(g.kayit.taslak, false);
    assert.equal(g.kayit.hatirlatma.kurulacak, 0, "zamansız: saatsiz bekler");
    const gecmis = o.depo.ajandaGecmisi({ kayit_id: a, adet: 1 })[0];
    assert.equal(gecmis?.islem, "onayla");
    assert.deepEqual([gecmis?.onceki, gecmis?.sonraki], [{ taslak: true }, { taslak: false }]);
    // Onaylanmış kayda onayla: değişmedi.
    assert.equal((await o.guncelle({ kayit_id: a, degisiklik: { onayla: true } })).sonuc, "degismedi");
    assert.deepEqual(o.islem({ islem: "onayla", kayit_id: b }).ok, true);
    assert.equal(o.kayit(b).taslak, false);
  });

  it("elle alan otomasyona karşı korunur: korunan_alanlar çıktıda ve geçmişte; hepsi korunuyorsa degismedi", async () => {
    const o = kur();
    o.durum.tur = sentetikTur();
    const id = kimlik(await o.ekle({ tur: "gorev", baslik: "Fatura", zaman: { kesinlik: "gun", tarih: "2026-11-30" }, dayanak: DAYANAK }));
    // Kullanıcı başlığı uygulamadan düzeltir.
    o.islem({ islem: "guncelle", kayit_id: id, temel_revizyon: 1, degisiklik: { baslik: "Elektrik faturasını öde" } });
    assert.deepEqual(o.kayit(id).elle_alanlar, ["baslik"]);
    const g = await o.guncelle({ kayit_id: id, degisiklik: { baslik: "Fatura", aciklama: "Son gün" } });
    assert.ok(g.sonuc === "guncellendi");
    assert.deepEqual(g.korunan_alanlar, ["baslik"]);
    const k = o.kayit(id);
    assert.equal(k.baslik, "Elektrik faturasını öde");
    assert.equal(k.aciklama, "Son gün");
    assert.deepEqual(k.elle_alanlar, ["baslik"], "otomasyon elle izini genişletmez");
    const satir = o.depo.ajandaGecmisi({ kayit_id: id, adet: 1 })[0];
    assert.deepEqual(satir?.korunan_alanlar, ["baslik"]);
    assert.deepEqual(satir?.yazar, { yol: "sohbet_araci", tur_kokeni: "sentetik", sohbet_id: "ana" });
    const rev = k.revizyon;
    const d = await o.guncelle({ kayit_id: id, degisiklik: { baslik: "Fatura" } });
    assert.deepEqual(d.sonuc === "degismedi" && d.korunan_alanlar, ["baslik"]);
    assert.equal(o.kayit(id).revizyon, rev);
    // İnsan turundaki araç elle alanı değiştirir ve izler.
    o.durum.tur = insanTuru();
    const i = await o.guncelle({ kayit_id: id, degisiklik: { baslik: "Fatura", onayla: true } });
    assert.ok(i.sonuc === "guncellendi");
    assert.deepEqual(i.korunan_alanlar, []);
    assert.equal(o.kayit(id).baslik, "Fatura");
    assert.equal(o.kayit(id).taslak, false);
  });

  it("güncelleme retleri: kayit_bulunamadi, kayit_silinmis; aynı değer degismedi", async () => {
    const o = kur();
    const id = kimlik(await o.ekle(DISCI));
    assert.equal((await o.guncelle({ kayit_id: "k_yok", degisiklik: { durum: "tamam" } })).sonuc, "ret");
    assert.deepEqual(await o.guncelle({ kayit_id: "k_yok", degisiklik: { durum: "tamam" } }), {
      sonuc: "ret",
      mesaj_ani: MESAJ_ANI,
      neden: "kayit_bulunamadi",
    });
    const ayni = await o.guncelle({ kayit_id: id, degisiklik: { baslik: "Dişçi ☕️" } });
    assert.equal(ayni.sonuc, "degismedi");
    o.islem({ islem: "sil", kayit_id: id });
    assert.deepEqual(await o.guncelle({ kayit_id: id, degisiklik: { durum: "tamam" } }), {
      sonuc: "ret",
      mesaj_ani: MESAJ_ANI,
      neden: "kayit_silinmis",
    });
  });

  it("araçla tutarsız birleşim tutarsiz_kayit (tekrarlı kayıtta zamanı kaldırmak)", async () => {
    const o = kur();
    // Uygulamadan tekrarlı bir taslak olmayan kayıt; insan turundaki araç zamanı kaldırmak ister.
    o.islem({
      islem: "ekle",
      kayit_id: "k_seri",
      tur: "gorev",
      baslik: "Seri",
      zaman: { kesinlik: "gun", tarih: "2026-11-02", saat_dilimi: DILIM },
      hatirlatmalar: [],
      tekrar: { siklik: "haftalik", aralik: 1 },
      girdi_yolu: "elle",
    });
    assert.deepEqual(await o.guncelle({ kayit_id: "k_seri", degisiklik: { zaman: null } }), {
      sonuc: "ret",
      mesaj_ani: MESAJ_ANI,
      neden: "tutarsiz_kayit",
    });
    assert.equal(o.kayit("k_seri").revizyon, 1);
  });
});

describe("ajanda araçları: tekilleştirme", () => {
  const ozetKimligi = (c: AjandaFiilCiktisi<"ajanda_ekle">) => kimlik(c);

  it("emirde açık eş: zaten_var; kullanıcının bu turda söylediği eşe yansır, eşin ifadesi korunur", async () => {
    const o = kur();
    const ilk = ozetKimligi(await o.ekle(DISCI));
    o.zaman.ilerlet(DAKIKA);
    const ayni = await o.ekle({ ...DISCI, zaman: { ...DISCI.zaman!, ifade: "bugün 3'te" } as typeof DISCI.zaman });
    assert.ok(ayni.sonuc === "zaten_var");
    assert.equal(ayni.kayit.kayit_id, ilk);
    assert.deepEqual(ayni.uygulanan_alanlar, []);
    assert.equal(o.kayit(ilk).revizyon, 1);
    const ek = await o.ekle({
      ...DISCI,
      aciklama: "Dolgu kontrolü",
      hatirlatmalar: [{ tur: "once", dk: 30 }],
      zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", sure_dk: 45, ifade: "yarın 3'te, 45 dakika" },
    });
    assert.ok(ek.sonuc === "zaten_var");
    assert.deepEqual(ek.uygulanan_alanlar, ["aciklama", "zaman", "hatirlatmalar"]);
    const k = o.kayit(ilk);
    assert.equal(k.aciklama, "Dolgu kontrolü");
    assert.deepEqual(k.hatirlatmalar, [{ tur: "once", dk: 30 }]);
    assert.deepEqual(k.zaman, { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", saat_dilimi: DILIM, ifade: "yarın 3'te", sure_dk: 45 });
    assert.equal(o.depo.ajandaKayitSayisi(), 1);
    assert.equal(o.depo.ajandaGecmisi({ kayit_id: ilk, adet: 1 })[0]?.islem, "guncelle");
  });

  it("emirde taslak eş onaylanır (aynı yazımda, onaylandi), söylenen alan işlenir", async () => {
    const o = kur();
    o.durum.tur = sentetikTur();
    const taslak = ozetKimligi(await o.ekle(DISCI));
    assert.equal(o.kayit(taslak).taslak, true);
    o.durum.tur = insanTuru();
    const c = await o.ekle({ ...DISCI, hatirlatmalar: [{ tur: "once", dk: 30 }] });
    assert.ok(c.sonuc === "onaylandi");
    assert.equal(c.kayit.kayit_id, taslak);
    assert.equal(c.kayit.taslak, false);
    assert.deepEqual(c.uygulanan_alanlar, ["hatirlatmalar"]);
    assert.equal(c.kayit.revizyon, 2, "tek revizyon");
    const g = o.depo.ajandaGecmisi({ kayit_id: taslak, adet: 1 })[0];
    assert.equal(g?.islem, "onayla");
    assert.deepEqual(g?.sonraki, { hatirlatmalar: [{ tur: "once", dk: 30 }], taslak: false });
    assert.deepEqual(o.kayit(taslak).elle_alanlar, ["hatirlatmalar"]);
  });

  it("otomasyon: sentetik tur açık eşi onaylamaz ve değiştirmez", async () => {
    const o = kur();
    o.durum.tur = sentetikTur();
    const taslak = ozetKimligi(await o.ekle(DISCI));
    const c = await o.ekle({ ...DISCI, aciklama: "Yeni" });
    assert.ok(c.sonuc === "zaten_var");
    assert.equal(c.kayit.kayit_id, taslak);
    assert.equal(c.kayit.taslak, true);
    assert.deepEqual(c.uygulanan_alanlar, []);
    assert.equal(o.kayit(taslak).aciklama, undefined);
    assert.equal(o.kayit(taslak).revizyon, 1);
  });

  it("kullanıcının sildiği ya da bitirdiği kaydı otomasyon yeniden yaratmaz; kullanıcı emri yaratır", async () => {
    const o = kur();
    const silinen = ozetKimligi(await o.ekle(DISCI));
    const biten = ozetKimligi(await o.ekle({ ...DISCI, baslik: "Kargo" }));
    o.islem({ islem: "sil", kayit_id: silinen });
    o.islem({ islem: "durum", kayit_id: biten, durum: "tamam" });
    o.durum.tur = sentetikTur();
    const s1 = await o.ekle(DISCI);
    assert.ok(s1.sonuc === "zaten_var");
    assert.equal(s1.kayit.kayit_id, silinen);
    assert.equal(s1.kayit.silindi, true);
    const s2 = await o.ekle({ ...DISCI, baslik: "Kargo" });
    assert.ok(s2.sonuc === "zaten_var");
    assert.equal(s2.kayit.durum, "tamam");
    assert.equal(o.depo.ajandaKayitSayisi(), 2);
    o.durum.tur = insanTuru();
    const y1 = await o.ekle(DISCI);
    const y2 = await o.ekle({ ...DISCI, baslik: "Kargo" });
    assert.equal(y1.sonuc, "eklendi");
    assert.equal(y2.sonuc, "eklendi");
    assert.notEqual(kimlik(y1), silinen);
    assert.equal(o.depo.ajandaKayitSayisi(), 4);
    // Yeni kayıt aynı anahtarı taşır: eşler listesi oluşturma sırasıyla iki kayıt.
    const anahtar = o.kayit(silinen).kaynak.tekil_anahtar as string;
    assert.deepEqual(o.depo.ajandaTekilEsler(anahtar).map((k) => k.kayit_id), [silinen, kimlik(y1)]);
  });

  it("kapsam sohbettir: başka sohbetten aynı kayıt ayrı; başka saat ayrı; elle ekleme eş sayılmaz", async () => {
    const o = kur();
    const a = kimlik(await o.ekle(DISCI));
    const b = kimlik(await o.ekle(DISCI, { ...BAGLAM, sohbet_id: "is" }));
    assert.notEqual(a, b);
    const c = await o.ekle({ ...DISCI, zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "16:00" } });
    assert.equal(c.sonuc, "eklendi");
    o.islem({
      islem: "ekle",
      kayit_id: "k_elle",
      tur: "randevu",
      baslik: "Berber",
      zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", saat_dilimi: DILIM },
      hatirlatmalar: [],
      girdi_yolu: "elle",
    });
    assert.equal((await o.ekle({ ...DISCI, baslik: "Berber" })).sonuc, "eklendi");
  });
});

describe("ajanda araçları: liste", () => {
  const doldur = async (o: Ortam) => {
    const ekle = async (baslik: string, ek: Partial<AjandaFiilGirdisi<"ajanda_ekle">> = {}) =>
      kimlik(await o.ekle({ tur: "gorev", baslik, dayanak: DAYANAK, ...ek }));
    const ids = {
      tarihsiz: await ekle("Kitap oku"),
      belirsiz: await ekle("İstanbul gezisi", { zaman: { kesinlik: "belirsiz", ifade: "bir ara" }, aciklama: "Galata" }),
      ogle: await ekle("Öğle", { tur: "randevu", zaman: { kesinlik: "an", tarih: "2026-11-27", saat: "12:00" } }),
      sabah: await ekle("Sabah", { tur: "randevu", zaman: { kesinlik: "an", tarih: "2026-11-27", saat: "09:00" } }),
      gun: await ekle("Gün işi", { zaman: { kesinlik: "gun", tarih: "2026-11-27" } }),
      donem: await ekle("Tatil", { tur: "not", zaman: { kesinlik: "donem", baslangic: "2026-11-20", bitis: "2026-11-26" } }),
      sonra: await ekle("ISTANBUL toplantısı", { zaman: { kesinlik: "gun", tarih: "2026-12-05" } }),
      biten: await ekle("Biten", { zaman: { kesinlik: "gun", tarih: "2026-11-27" } }),
      silinen: await ekle("Silinen", { zaman: { kesinlik: "gun", tarih: "2026-11-27" } }),
    };
    o.islem({ islem: "durum", kayit_id: ids.biten, durum: "tamam" });
    o.islem({ islem: "sil", kayit_id: ids.silinen });
    return ids;
  };

  it("varsayılan: açıklar; tarihliler gün ve saate göre, sonra tarihsizler oluşturma sırasıyla; silinmiş yok", async () => {
    const o = kur();
    const ids = await doldur(o);
    const l = await o.listele();
    assert.deepEqual(l.mesaj_ani, MESAJ_ANI);
    assert.deepEqual(
      l.kayitlar.map((k) => k.kayit_id),
      [ids.donem, ids.gun, ids.sabah, ids.ogle, ids.sonra, ids.tarihsiz, ids.belirsiz],
    );
    assert.equal(l.toplam, 7);
    const hepsi = await o.listele({ durumlar: ["acik", "tamam", "iptal"] });
    assert.ok(hepsi.kayitlar.some((k) => k.kayit_id === ids.biten));
    assert.ok(!hepsi.kayitlar.some((k) => k.kayit_id === ids.silinen));
    assert.deepEqual(
      (await o.listele({ durumlar: ["tamam"] })).kayitlar.map((k) => k.kayit_id),
      [ids.biten],
    );
  });

  it("tarih süzgeci aralığa değeni verir (dönem kesişimi), tarihsizleri dışlar; tür süzgeci", async () => {
    const o = kur();
    const ids = await doldur(o);
    assert.deepEqual(
      (await o.listele({ baslangic: "2026-11-26", bitis: "2026-11-27" })).kayitlar.map((k) => k.kayit_id),
      [ids.donem, ids.gun, ids.sabah, ids.ogle],
    );
    assert.deepEqual(
      (await o.listele({ baslangic: "2026-11-28" })).kayitlar.map((k) => k.kayit_id),
      [ids.sonra],
    );
    assert.deepEqual(
      (await o.listele({ bitis: "2026-11-21" })).kayitlar.map((k) => k.kayit_id),
      [ids.donem],
    );
    assert.deepEqual(
      (await o.listele({ turler: ["randevu"] })).kayitlar.map((k) => k.kayit_id),
      [ids.sabah, ids.ogle],
    );
  });

  it("arama başlık ve açıklamada, büyük/küçük harf duyarsız (Türkçe İ/I dahil); en_fazla ve toplam", async () => {
    const o = kur();
    const ids = await doldur(o);
    assert.deepEqual(
      (await o.listele({ ara: "istanbul" })).kayitlar.map((k) => k.kayit_id),
      [ids.sonra, ids.belirsiz],
    );
    assert.deepEqual(
      (await o.listele({ ara: "GALATA" })).kayitlar.map((k) => k.kayit_id),
      [ids.belirsiz],
    );
    const kisa = await o.listele({ en_fazla: 2 });
    assert.equal(kisa.kayitlar.length, 2);
    assert.equal(kisa.toplam, 7);
  });

  it("en_fazla verilmezse LISTE_VARSAYILAN kadar, verilirse istenen kadar (LISTE_ADET'e dek) döner", async () => {
    const o = kur();
    const fazla = AJANDA_SINIRLARI.LISTE_ADET + 5;
    for (let i = 0; i < fazla; i++) assert.equal((await o.ekle({ tur: "not", baslik: `Not ${i}` })).sonuc, "eklendi");
    const varsayilan = await o.listele();
    assert.equal(varsayilan.kayitlar.length, AJANDA_SINIRLARI.LISTE_VARSAYILAN);
    assert.equal(varsayilan.toplam, fazla);
    assert.equal((await o.listele({ en_fazla: AJANDA_SINIRLARI.LISTE_VARSAYILAN + 3 })).kayitlar.length, AJANDA_SINIRLARI.LISTE_VARSAYILAN + 3);
    const tavan = await o.listele({ en_fazla: AJANDA_SINIRLARI.LISTE_ADET });
    assert.equal(tavan.kayitlar.length, AJANDA_SINIRLARI.LISTE_ADET);
    assert.equal(tavan.toplam, fazla);
  });

  it("liste yazmaz ve sentetik turda da çalışır", async () => {
    const o = kur();
    await doldur(o);
    const rev = o.depo.ajandaBasRev();
    o.durum.tur = sentetikTur();
    assert.equal((await o.listele()).toplam, 7);
    assert.equal(o.depo.ajandaBasRev(), rev);
  });
});
