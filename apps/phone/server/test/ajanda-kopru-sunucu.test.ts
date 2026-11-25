import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  AJANDA_ARACLARI,
  AJANDA_AZAMI_CERCEVE,
  AJANDA_BORU_ADI,
  AJANDA_FIILLERI,
  AJANDA_ROL_FIILLERI,
  KOPRU_BORU_ADI,
  PROTOKOL_SURUMU,
  ajandaKopruAsagiCoz,
  sha256Hex,
} from "@eren/protocol";
import type { AjandaFiili, AjandaKopruAsagi } from "@eren/protocol";
import { ajandaKopruSunucuKur } from "../src/ajanda-kopru-sunucu.ts";
import { depoKur } from "../src/depo.ts";
import { kopruSunucuKur } from "../src/kopru-sunucu.ts";
import type {
  AjandaFiilIsleyiciler,
  AjandaJetonKapsami,
  AjandaKopruBaglami,
  AjandaKopruSunucu,
  Depo,
  FiilIsleyiciler,
} from "../src/sozlesme.ts";
import { sahteBoru, sahteGunluk, sahteRastgele, sahteZaman } from "./sahte.ts";
import type { SahteBoruBaglantisi } from "./sahte.ts";

// ---------------------------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------------------------

const acilanlar: Depo[] = [];
afterEach(() => {
  for (const d of acilanlar.splice(0)) {
    try {
      d.kapat();
    } catch {
      // zaten kapalı
    }
  }
});

const enc = new TextEncoder();
const ozetle = (jeton: string): string => sha256Hex(enc.encode(jeton));

const KAPSAM: AjandaJetonKapsami = { rol: "ana_oturum", sohbet_id: "ana", nesil: 1 };
const KAPSAM_2: AjandaJetonKapsami = { rol: "ana_oturum", sohbet_id: "ana", nesil: 2 };
const KAPSAM_BASKA: AjandaJetonKapsami = { rol: "ana_oturum", sohbet_id: "s_baska", nesil: 1 };
const IST = "Europe/Istanbul";
const AN = { tarih: "2026-11-25", saat: "14:05", saat_dilimi: IST };
const DAYANAK = { tarih: "2026-11-25", saat: "14:05" };

/** Kullanıcı metni günlüğe girmemeli: testlerde bu iz aranır. */
const GIZLI_BASLIK = "GIZLI-BASLIK-ornek";

const GIRDI: Record<AjandaFiili, unknown> = {
  ajanda_ekle: {
    tur: "randevu",
    baslik: GIZLI_BASLIK,
    zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", ifade: "yarın 3'te" },
    dayanak: DAYANAK,
  },
  ajanda_guncelle: { kayit_id: "k_dis01", degisiklik: { durum: "tamam" } },
  ajanda_listele: { ara: GIZLI_BASLIK },
};

const OZET = {
  kayit_id: "k_dis01",
  revizyon: 3,
  durum: "acik",
  taslak: false,
  silindi: false,
  zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", saat_dilimi: IST },
  hatirlatma: { toplam: 1, kurulacak: 1, saatsiz: 0, gecmis: 0 },
};

const KAYIT = {
  kayit_id: "k_dis01",
  revizyon: 3,
  tur: "randevu",
  baslik: GIZLI_BASLIK,
  zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", saat_dilimi: IST, ifade: "yarın 3'te" },
  hatirlatmalar: [{ tur: "once", dk: 60 }],
  ornekler: [],
  durum: "acik",
  taslak: false,
  silindi: false,
  elle_alanlar: [],
  kaynak: { yol: "sohbet_araci", tur_kokeni: "insan", sohbet_id: "ana" },
  olusturma_ms: 1,
  guncelleme_ms: 1,
};

const CIKTI: Record<AjandaFiili, unknown> = {
  ajanda_ekle: { sonuc: "eklendi", mesaj_ani: AN, kayit: OZET },
  ajanda_guncelle: { sonuc: "guncellendi", mesaj_ani: AN, kayit: OZET, korunan_alanlar: [] },
  ajanda_listele: { mesaj_ani: AN, kayitlar: [KAYIT], toplam: 1 },
};

type Cagri = { fiil: AjandaFiili; girdi: unknown; baglam: AjandaKopruBaglami; sinyal: AbortSignal };
type OzelIsleyici = (girdi: unknown, baglam: AjandaKopruBaglami, sinyal: AbortSignal) => Promise<unknown>;

const isleyicilerKur = (ozel: Partial<Record<AjandaFiili, OzelIsleyici>> = {}) => {
  const cagrilar: Cagri[] = [];
  const nesne: Record<string, unknown> = {};
  for (const fiil of AJANDA_FIILLERI) {
    nesne[fiil] = async (girdi: unknown, baglam: AjandaKopruBaglami, sinyal: AbortSignal) => {
      cagrilar.push({ fiil, girdi, baglam, sinyal });
      const o = ozel[fiil];
      return o ? o(girdi, baglam, sinyal) : { ok: true, deger: CIKTI[fiil] };
    };
  }
  return { isleyiciler: nesne as unknown as AjandaFiilIsleyiciler, cagrilar };
};

const asili = () => {
  const sinyaller: AbortSignal[] = [];
  const cozuculer: Array<() => void> = [];
  const isleyici: OzelIsleyici = (_g, _b, sinyal) =>
    new Promise((coz) => {
      sinyaller.push(sinyal);
      cozuculer.push(() => coz({ ok: true, deger: CIKTI.ajanda_listele }));
    });
  return { sinyaller, cozuculer, isleyici };
};

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
};

let sayac = 0;

interface Kurulum {
  boru: ReturnType<typeof sahteBoru>;
  depo: Depo;
  gunluk: ReturnType<typeof sahteGunluk>;
  zaman: ReturnType<typeof sahteZaman>;
  sunucu: AjandaKopruSunucu;
}

const kur = async (
  o: {
    depo?: Depo;
    boru?: ReturnType<typeof sahteBoru>;
    isleyiciler?: AjandaFiilIsleyiciler;
    baslat?: boolean;
  } = {},
): Promise<Kurulum> => {
  const boru = o.boru ?? sahteBoru();
  const gunluk = sahteGunluk();
  const zaman = sahteZaman();
  const depo = o.depo ?? depoKur({ yol: ":memory:", saat: sahteZaman().saat, gunluk: sahteGunluk() });
  if (!o.depo) acilanlar.push(depo);
  const sunucu = ajandaKopruSunucuKur({
    boru,
    depo,
    rastgele: sahteRastgele(4242 + ++sayac),
    anahtar: { sabitZamanEsit: (a: string, b: string) => a === b },
    zamanlayici: zaman.zamanlayici,
    gunluk,
  });
  if (o.baslat !== false) await sunucu.baslat(o.isleyiciler ?? isleyicilerKur().isleyiciler);
  return { boru, depo, gunluk, zaman, sunucu };
};

const gonder = (b: SahteBoruBaglantisi, m: unknown): void => {
  b.satirGonder(typeof m === "string" ? m : JSON.stringify(m));
};

const hello = (rol: string, jeton: string) => ({ v: PROTOKOL_SURUMU, type: "kopru_hello", rol, jeton });
const istek = (istek_id: string, fiil: string, girdi: unknown) => ({
  v: PROTOKOL_SURUMU,
  type: "istek",
  istek_id,
  fiil,
  girdi,
});
const iptal = (istek_id: string) => ({ v: PROTOKOL_SURUMU, type: "iptal", istek_id });

/** Giden her satır ajanda borusunun aşağı şemasından geçmek zorundadır. */
const cikanlar = (b: SahteBoruBaglantisi): AjandaKopruAsagi[] =>
  b.yazilanlar.map((s) => {
    const c = ajandaKopruAsagiCoz(s);
    assert.ok(c.ok, `giden satir semaya uymuyor: ${s.slice(0, 120)}`);
    return c.mesaj;
  });

const sonYanit = (b: SahteBoruBaglantisi) => {
  const y = cikanlar(b).at(-1);
  assert.ok(y && y.type === "yanit", "son cikan satir yanit degil");
  return y;
};

const RET = (code: string) => [{ v: PROTOKOL_SURUMU, type: "kopru_ret", code }];
const WELCOME = { v: PROTOKOL_SURUMU, type: "kopru_welcome", rol: "ana_oturum" };

const baglan = async (k: Kurulum, rol: string, jeton: string): Promise<SahteBoruBaglantisi> => {
  const b = k.boru.baglan(AJANDA_BORU_ADI);
  gonder(b, hello(rol, jeton));
  await bosalt();
  return b;
};

const yetkiliBaglan = async (k: Kurulum, kapsam: AjandaJetonKapsami = KAPSAM) => {
  const jeton = k.sunucu.jetonUret(kapsam);
  const b = await baglan(k, kapsam.rol, jeton);
  assert.deepEqual(cikanlar(b)[0], WELCOME);
  return { b, jeton };
};

// ---------------------------------------------------------------------------------------------
// Dinleme ve jeton
// ---------------------------------------------------------------------------------------------

describe("ajanda-kopru-sunucu: dinleme ve jeton", () => {
  it("AJANDA_BORU_ADI uzerinde, AJANDA_AZAMI_CERCEVE.BORU sinirla dinler; kapat boruyu kapatir", async () => {
    const k = await kur();
    const i = k.boru.istek(AJANDA_BORU_ADI);
    assert.ok(i);
    assert.equal(i.ad, AJANDA_BORU_ADI);
    assert.notEqual(i.ad, KOPRU_BORU_ADI);
    assert.equal(i.azamiSatir, AJANDA_AZAMI_CERCEVE.BORU);
    await k.sunucu.kapat();
    assert.equal(k.boru.kapatildiMi(AJANDA_BORU_ADI), true);
  });

  it("ikinci baslat atar; dinleme hatasinda yeniden baslatilabilir", async () => {
    const k = await kur({ baslat: false });
    k.boru.sonrakiDinlemeHatasi(new Error("boru alinmis"));
    await assert.rejects(k.sunucu.baslat(isleyicilerKur().isleyiciler));
    await k.sunucu.baslat(isleyicilerKur().isleyiciler);
    await assert.rejects(k.sunucu.baslat(isleyicilerKur().isleyiciler));
  });

  it("jetonUret duz jetonu verir, depoya yalniz ozeti ve kapsami yazar; duz jeton gunluge girmez", async () => {
    const k = await kur();
    const jeton = k.sunucu.jetonUret(KAPSAM);
    assert.ok(jeton.length >= 43);
    assert.equal(k.depo.ajandaJetonBul(jeton), null);
    assert.deepEqual(k.depo.ajandaJetonBul(ozetle(jeton)), { ozet: ozetle(jeton), kapsam: KAPSAM });
    // `eren` borusunun jeton işlevi ajanda jetonunu görmez (ayrı tablo).
    assert.equal(k.depo.jetonBul(ozetle(jeton)), null);
    await yetkiliBaglan(k);
    assert.ok(!JSON.stringify(k.gunluk.girdiler).includes(jeton));
  });
});

// ---------------------------------------------------------------------------------------------
// El sıkışma
// ---------------------------------------------------------------------------------------------

describe("ajanda-kopru-sunucu: el sikisma", () => {
  it("gecerli jeton: kopru_welcome{rol:ana_oturum}, baglanti acik", async () => {
    const k = await kur();
    const { b } = await yetkiliBaglan(k);
    assert.deepEqual(cikanlar(b), [WELCOME]);
    assert.equal(b.kapandi, false);
  });

  it("ilk mesaj kopru_hello degilse (istek ya da iptal): yetkisiz + kapat, isleyici calismaz", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    for (const ilk of [istek("i1", "ajanda_listele", {}), iptal("i1")]) {
      const b = k.boru.baglan(AJANDA_BORU_ADI);
      gonder(b, ilk);
      await bosalt();
      assert.deepEqual(cikanlar(b), RET("yetkisiz"));
      assert.equal(b.kapandi, true);
    }
    assert.equal(m.cagrilar.length, 0);
  });

  it("depoda olmayan jeton: jeton_gecersiz", async () => {
    const k = await kur();
    const b = await baglan(k, "ana_oturum", "x".repeat(43));
    assert.deepEqual(cikanlar(b), RET("jeton_gecersiz"));
    assert.equal(b.kapandi, true);
  });

  it("iptal edilmis jeton: jeton_gecersiz; jetonlariIptalEt acik baglantiyi kapatir, ayni kapsamin disina dokunmaz", async () => {
    const m = asili();
    const k = await kur({ isleyiciler: isleyicilerKur({ ajanda_listele: m.isleyici }).isleyiciler });
    const { b, jeton } = await yetkiliBaglan(k, KAPSAM);
    const { b: baska } = await yetkiliBaglan(k, KAPSAM_BASKA);
    gonder(b, istek("i1", "ajanda_listele", {}));
    await bosalt();
    k.sunucu.jetonlariIptalEt(KAPSAM);
    assert.equal(b.kapandi, true);
    assert.equal(m.sinyaller[0]?.reason, "baglanti_koptu");
    assert.equal(baska.kapandi, false);
    const yeniden = await baglan(k, "ana_oturum", jeton);
    assert.deepEqual(cikanlar(yeniden), RET("jeton_gecersiz"));
  });

  it("jetonlariIptalEt baska neslin jetonunu silmez", async () => {
    const k = await kur();
    const j2 = k.sunucu.jetonUret(KAPSAM_2);
    k.sunucu.jetonUret(KAPSAM);
    k.sunucu.jetonlariIptalEt(KAPSAM);
    const b = await baglan(k, "ana_oturum", j2);
    assert.deepEqual(cikanlar(b), [WELCOME]);
  });

  it("jetonlariniSil: butun ajanda jetonlari ve acik baglantilar; silinen sayisi doner", async () => {
    const k = await kur();
    const { b, jeton } = await yetkiliBaglan(k, KAPSAM);
    k.sunucu.jetonUret(KAPSAM_BASKA);
    const bekleyen = k.boru.baglan(AJANDA_BORU_ADI); // henüz hello yok
    assert.equal(k.sunucu.jetonlariniSil(), 2);
    assert.equal(b.kapandi, true);
    assert.equal(bekleyen.kapandi, true);
    const yeniden = await baglan(k, "ana_oturum", jeton);
    assert.deepEqual(cikanlar(yeniden), RET("jeton_gecersiz"));
    assert.equal(k.sunucu.jetonlariniSil(), 0);
  });

  it("baska role ait jeton: eren jetonu ajanda borusunda, ajanda jetonu eren borusunda reddedilir (ayni surec, ayni depo)", async () => {
    const boru = sahteBoru();
    const k = await kur({ boru });
    const eren = kopruSunucuKur({
      boru,
      depo: k.depo,
      rastgele: sahteRastgele(99),
      anahtar: { sabitZamanEsit: (a: string, b: string) => a === b },
      zamanlayici: sahteZaman().zamanlayici,
      gunluk: sahteGunluk(),
    });
    await eren.baslat({} as FiilIsleyiciler);
    const erenJetonu = eren.jetonUret({ rol: "eren", sohbet_id: "ana", nesil: 1 });
    const ajandaJetonu = k.sunucu.jetonUret(KAPSAM);

    // eren jetonu, ajanda rolüyle ajanda borusunda
    const a = await baglan(k, "ana_oturum", erenJetonu);
    assert.deepEqual(cikanlar(a), RET("jeton_gecersiz"));
    // eren jetonu, eren rolüyle ajanda borusunda: rol ajanda borusunun şemasında yok
    const a2 = await baglan(k, "eren", erenJetonu);
    assert.deepEqual(cikanlar(a2), RET("yetkisiz"));
    // ajanda jetonu eren borusunda (her iki rol adıyla)
    for (const [rol, code] of [["eren", "jeton_gecersiz"], ["ana_oturum", "yetkisiz"]] as const) {
      const e = boru.baglan(KOPRU_BORU_ADI);
      gonder(e, hello(rol, ajandaJetonu));
      await bosalt();
      assert.equal(e.kapandi, true, rol);
      assert.deepEqual(e.yazilanlar.map((s) => JSON.parse(s) as unknown), RET(code), rol);
    }
    // ikisi de kendi borusunda geçerli
    const ok = await baglan(k, "ana_oturum", ajandaJetonu);
    assert.deepEqual(cikanlar(ok), [WELCOME]);
    await eren.kapat();
  });

  it("tek baglanti: ayni kapsam acikken ikinci hello jeton_gecersiz; ilki kopunca ayni jetonla yeniden baglanilir", async () => {
    const k = await kur();
    const { b, jeton } = await yetkiliBaglan(k);
    const ikinci = await baglan(k, "ana_oturum", jeton);
    assert.deepEqual(cikanlar(ikinci), RET("jeton_gecersiz"));
    assert.equal(b.kapandi, false);
    b.istemciKopar();
    const ucuncu = await baglan(k, "ana_oturum", jeton);
    assert.deepEqual(cikanlar(ucuncu), [WELCOME]);
  });

  it("gecersiz hello cercevesi (kisa jeton, bilinmeyen rol, ek alan, yanlis surum, json degil): kapatir", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    const kotu: unknown[] = [
      hello("ana_oturum", "kisa"),
      hello("yonetici", "x".repeat(43)),
      { ...hello("ana_oturum", "x".repeat(43)), sohbet_id: "ana" },
      { v: 2, type: "kopru_hello", rol: "ana_oturum", jeton: "x".repeat(43) },
      "bu json degil",
      "{}",
    ];
    for (const c of kotu) {
      const b = k.boru.baglan(AJANDA_BORU_ADI);
      gonder(b, c);
      await bosalt();
      assert.equal(b.kapandi, true, `kapanmadi: ${JSON.stringify(c)}`);
    }
    assert.equal(m.cagrilar.length, 0);
  });

  it("hello gelmezse 9.999 ms'de acik, 10.000 ms'de yetkisiz + kapali", async () => {
    const k = await kur();
    const b = k.boru.baglan(AJANDA_BORU_ADI);
    k.zaman.ilerlet(9_999);
    assert.equal(b.kapandi, false);
    k.zaman.ilerlet(1);
    assert.deepEqual(cikanlar(b), RET("yetkisiz"));
    assert.equal(b.kapandi, true);
  });

  it("servis yeniden kurulunca depodaki ayni jeton kabul edilir", async () => {
    const depo = depoKur({ yol: ":memory:", saat: sahteZaman().saat, gunluk: sahteGunluk() });
    acilanlar.push(depo);
    const k1 = await kur({ depo });
    const jeton = k1.sunucu.jetonUret(KAPSAM);
    await k1.sunucu.kapat();
    const k2 = await kur({ depo });
    const b = await baglan(k2, "ana_oturum", jeton);
    assert.deepEqual(cikanlar(b), [WELCOME]);
  });

  it("kapali sunucu yeni baglantiyi hemen kapatir", async () => {
    const k = await kur();
    const { b } = await yetkiliBaglan(k);
    await k.sunucu.kapat();
    assert.equal(b.kapandi, true);
  });
});

// ---------------------------------------------------------------------------------------------
// Fiiller
// ---------------------------------------------------------------------------------------------

describe("ajanda-kopru-sunucu: fiiller", () => {
  it("AJANDA_ROL_FIILLERI uzerinde dongu: her fiil isleyiciye girdi ve jetondan gelen baglamla ulasir, cikti dogrulanip doner", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k, KAPSAM_2);
    for (const fiil of AJANDA_ROL_FIILLERI.ana_oturum) {
      assert.ok(AJANDA_ARACLARI[fiil].girdi.safeParse(GIRDI[fiil]).success, `girdi tablosu: ${fiil}`);
      assert.ok(AJANDA_ARACLARI[fiil].cikti.safeParse(CIKTI[fiil]).success, `cikti tablosu: ${fiil}`);
      gonder(b, istek(`i-${fiil}`, fiil, GIRDI[fiil]));
      await bosalt();
      const c = m.cagrilar.at(-1)!;
      assert.equal(c.fiil, fiil);
      assert.deepEqual(c.girdi, GIRDI[fiil]);
      assert.deepEqual(c.baglam, KAPSAM_2);
      assert.ok(Object.isFrozen(c.baglam));
      assert.deepEqual(sonYanit(b), {
        v: PROTOKOL_SURUMU,
        type: "yanit",
        istek_id: `i-${fiil}`,
        ok: true,
        sonuc: CIKTI[fiil],
      });
    }
    assert.equal(m.cagrilar.length, AJANDA_FIILLERI.length);
    // Kayıt metni (başlık, arama metni) günlüğe girmez.
    assert.ok(!JSON.stringify(k.gunluk.girdiler).includes(GIZLI_BASLIK));
  });

  it("rolun izinli olmadigi fiil (eren borusunun fiilleri, bilinmeyen fiil): rol_fiil_izinsiz, isleyici yok, baglanti acik", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k);
    const disari = ["plan_oner", "kullaniciya_sor", "click", "ajanda_sil", "rapor_oku"];
    for (const [n, fiil] of disari.entries()) {
      gonder(b, istek(`d${n}`, fiil, {}));
      await bosalt();
      assert.deepEqual(sonYanit(b), {
        v: PROTOKOL_SURUMU,
        type: "yanit",
        istek_id: `d${n}`,
        ok: false,
        code: "rol_fiil_izinsiz",
      });
      assert.equal(b.kapandi, false, fiil);
    }
    assert.equal(m.cagrilar.length, 0);
    // Fiil adı (güvenilmez dizge) günlüğe yazılmaz.
    assert.ok(!JSON.stringify(k.gunluk.girdiler).includes("ajanda_sil"));
    gonder(b, istek("i-ok", "ajanda_listele", {}));
    await bosalt();
    assert.equal(m.cagrilar.length, 1);
  });

  it("izinli fiilin sema disi girdisi (servisin belirledigi alanlar dahil): baglanti kapanir, isleyici yok", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    const kotu: Array<[string, unknown]> = [
      ["ajanda_ekle", { ...(GIRDI.ajanda_ekle as object), kayit_id: "k_x" }],
      ["ajanda_ekle", { ...(GIRDI.ajanda_ekle as object), taslak: false }],
      ["ajanda_ekle", { ...(GIRDI.ajanda_ekle as object), kaynak: { yol: "elle" } }],
      ["ajanda_ekle", { ...(GIRDI.ajanda_ekle as object), tur_kokeni: "insan" }],
      ["ajanda_ekle", { ...(GIRDI.ajanda_ekle as object), sohbet_id: "s_baska" }],
      ["ajanda_ekle", { tur: "randevu", baslik: "x", zaman: { kesinlik: "gun", tarih: "2026-11-26" } }],
      ["ajanda_guncelle", { kayit_id: "k1", degisiklik: { taslak: false } }],
      ["ajanda_listele", { silinenler: true }],
    ];
    for (const [fiil, girdi] of kotu) {
      const { b } = await yetkiliBaglan(k, { rol: "ana_oturum", sohbet_id: "ana", nesil: 100 + sayac++ });
      gonder(b, istek("i1", fiil, girdi));
      await bosalt();
      assert.equal(b.kapandi, true, JSON.stringify(girdi));
      assert.equal(cikanlar(b).filter((x) => x.type === "yanit").length, 0);
    }
    assert.equal(m.cagrilar.length, 0);
  });

  it("ikinci hello baglantiyi kapatir, kimlik degismez", async () => {
    const k = await kur();
    const { b } = await yetkiliBaglan(k);
    const baska = k.sunucu.jetonUret(KAPSAM_BASKA);
    gonder(b, hello("ana_oturum", baska));
    await bosalt();
    assert.equal(b.kapandi, true);
    assert.equal(cikanlar(b).length, 1);
  });

  it("ayni baglantida suren istek_id yeniden gelirse yinelenen_istek; bitince ayni kimlik yeniden kullanilabilir", async () => {
    const a = asili();
    const m = isleyicilerKur({ ajanda_listele: a.isleyici });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k);
    gonder(b, istek("i1", "ajanda_listele", {}));
    gonder(b, istek("i1", "ajanda_listele", {}));
    await bosalt();
    assert.deepEqual(sonYanit(b), { v: PROTOKOL_SURUMU, type: "yanit", istek_id: "i1", ok: false, code: "yinelenen_istek" });
    assert.equal(m.cagrilar.length, 1);
    a.cozuculer[0]!();
    await bosalt();
    assert.equal(sonYanit(b).ok, true);
    gonder(b, istek("i1", "ajanda_ekle", GIRDI.ajanda_ekle));
    await bosalt();
    assert.equal(m.cagrilar.length, 2);
  });

  it("iptal{istek_id}: sinyal model_iptal; baglanti kopunca suren istekler baglanti_koptu", async () => {
    const a = asili();
    const k = await kur({ isleyiciler: isleyicilerKur({ ajanda_listele: a.isleyici }).isleyiciler });
    const { b } = await yetkiliBaglan(k);
    gonder(b, istek("i1", "ajanda_listele", {}));
    gonder(b, istek("i2", "ajanda_listele", {}));
    await bosalt();
    gonder(b, iptal("i1"));
    gonder(b, iptal("bilinmeyen"));
    await bosalt();
    assert.equal(a.sinyaller[0]!.reason, "model_iptal");
    assert.equal(a.sinyaller[1]!.aborted, false);
    b.istemciKopar();
    assert.equal(a.sinyaller[1]!.reason, "baglanti_koptu");
  });

  it("cikti dogrulamasi: sema disi cikti (ozette kayit metni, silinmis kayit, gorunmez karakter) ic_hata, detail yok", async () => {
    const kotuCiktilar: Array<[AjandaFiili, unknown]> = [
      ["ajanda_ekle", { sonuc: "eklendi", mesaj_ani: AN, kayit: { ...OZET, baslik: GIZLI_BASLIK } }],
      ["ajanda_ekle", { sonuc: "eklendi", mesaj_ani: AN, kayit: { ...OZET, zaman: { ...OZET.zaman, ifade: "yarın" } } }],
      ["ajanda_guncelle", { sonuc: "guncellendi", kayit: OZET, korunan_alanlar: [] }],
      ["ajanda_listele", { mesaj_ani: AN, kayitlar: [{ ...KAYIT, silindi: true }], toplam: 1 }],
      ["ajanda_listele", { mesaj_ani: AN, kayitlar: [{ ...KAYIT, baslik: "a​b" }], toplam: 1 }],
    ];
    for (const [fiil, deger] of kotuCiktilar) {
      const k = await kur({ isleyiciler: isleyicilerKur({ [fiil]: async () => ({ ok: true, deger }) }).isleyiciler });
      const { b } = await yetkiliBaglan(k);
      gonder(b, istek("i1", fiil, GIRDI[fiil]));
      await bosalt();
      assert.deepEqual(sonYanit(b), { v: PROTOKOL_SURUMU, type: "yanit", istek_id: "i1", ok: false, code: "ic_hata" });
      assert.equal(k.gunluk.bul("sonuc_gecersiz").length, 1);
      assert.ok(!JSON.stringify(k.gunluk.girdiler).includes(GIZLI_BASLIK));
    }
  });

  it("isleyici atarsa ic_hata; detail ve hata metni boruya gitmez", async () => {
    const k = await kur({
      isleyiciler: isleyicilerKur({
        ajanda_ekle: async () => {
          throw new Error("GIZLI-HATA");
        },
      }).isleyiciler,
    });
    const { b } = await yetkiliBaglan(k);
    gonder(b, istek("i1", "ajanda_ekle", GIRDI.ajanda_ekle));
    await bosalt();
    assert.deepEqual(sonYanit(b), { v: PROTOKOL_SURUMU, type: "yanit", istek_id: "i1", ok: false, code: "ic_hata" });
    assert.ok(!b.yazilanlar.join("").includes("GIZLI-HATA"));
  });

  it("acik tur yok: isleyicinin tur_gecersiz'i boru hatasi olarak gider, detail tasinmaz", async () => {
    const k = await kur({
      isleyiciler: isleyicilerKur({
        ajanda_ekle: async () => ({ ok: false, code: "tur_gecersiz", detail: "GIZLI-AYRINTI" }),
      }).isleyiciler,
    });
    const { b } = await yetkiliBaglan(k);
    gonder(b, istek("i1", "ajanda_ekle", GIRDI.ajanda_ekle));
    await bosalt();
    assert.deepEqual(sonYanit(b), { v: PROTOKOL_SURUMU, type: "yanit", istek_id: "i1", ok: false, code: "tur_gecersiz" });
    assert.ok(!b.yazilanlar.join("").includes("GIZLI-AYRINTI"));
  });

  it("sozlesme disi boru hata kodu (ornegin yetkisiz) ic_hata olur", async () => {
    const k = await kur({
      isleyiciler: isleyicilerKur({ ajanda_listele: async () => ({ ok: false, code: "yetkisiz" }) }).isleyiciler,
    });
    const { b } = await yetkiliBaglan(k);
    gonder(b, istek("i1", "ajanda_listele", {}));
    await bosalt();
    assert.equal(sonYanit(b).code, "ic_hata");
  });

  it("sinirdan buyuk satir baglantiyi kapatir", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k);
    gonder(b, "x".repeat(AJANDA_AZAMI_CERCEVE.BORU + 1));
    await bosalt();
    assert.equal(b.kapandi, true);
    assert.equal(m.cagrilar.length, 0);
  });
});
