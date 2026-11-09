import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  KOPRU_BORU_ADI,
  KOPRU_FIIL_SEMALARI,
  KOPRU_FIILLERI,
  KOPRU_ROLLERI,
  PROTOKOL_SURUMU,
  ROL_FIILLERI,
  kopruAsagiCoz,
  sha256Hex,
} from "@eren/protocol";
import type { KopruAsagi, KopruFiili, KopruRolu } from "@eren/protocol";
import { depoKur } from "../src/depo.ts";
import { kopruSunucuKur } from "../src/kopru-sunucu.ts";
import type {
  Depo,
  FiilIsleyiciler,
  JetonKapsami,
  KopruBaglami,
  KopruSunucu,
  Sonuc,
} from "../src/sozlesme.ts";
import { sahteBoru, sahteGunluk, sahteRastgele, sahteZaman } from "./sahte.ts";
import type { SahteBoruBaglantisi } from "./sahte.ts";

// ---------------------------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------------------------

const kok = mkdtempSync(join(tmpdir(), "eren-kopru-sunucu-test-"));
after(() => rmSync(kok, { recursive: true, force: true }));

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

const HASH = "a".repeat(64);
const KAPSAM_EREN: JetonKapsami = { rol: "eren", sohbet_id: "ana", nesil: 1 };
const KAPSAM_SORU: JetonKapsami = { rol: "soru", is_id: 7 };
const KAPSAM_TELEFON: JetonKapsami = { rol: "telefon", is_id: 9, plan_id: "plan1", plan_hash: HASH };
const KAPSAMLAR: Record<KopruRolu, JetonKapsami> = {
  eren: KAPSAM_EREN,
  soru: KAPSAM_SORU,
  telefon: KAPSAM_TELEFON,
};

/** Her fiil için şemadan geçen örnek girdi: tablo, `Record` olduğu için fiil eksikse tip hatası verir. */
const GIRDI: Record<KopruFiili, unknown> = {
  plan_oner: {
    baslik: "Ornek is",
    tur: "pc",
    cwd: "C:\\ornek\\",
    gorev_metni: "Ornek gorev",
  },
  oturumlar: {},
  rapor_oku: { id: 1 },
  projeler: {},
  uygulamalar: {},
  oturum_durdur: { id: 1 },
  devir_ozeti: { ozet: "ozet" },
  kullaniciya_sor: { soru_id: "soru1", soru: "Hangisi?" },
  soru_bekle: { soru_id: "soru1" },
  foreground: {},
  elements: {},
  screenshot: {},
  zoom: { x0: 0, y0: 0, x1: 10, y1: 10 },
  click: { x: 1, y: 2 },
  type_text: { text: "a" },
  key: { keys: "home" },
  scroll: { direction: "up" },
  drag: { x0: 0, y0: 0, x1: 5, y1: 5 },
  wait: { seconds: 1 },
  open_app: { package: "com.ornek.uygulama" },
  rapor_ver: { yapildi: [], yapilmadi: [], dosyalar: [], acik_noktalar: [] },
};

const CMD_TAMAM = { ok: true, foreground: null };
const CIKTI: Record<KopruFiili, unknown> = {
  plan_oner: { plan_id: "plan1", plan_hash: HASH, durum: "onay_bekliyor" },
  oturumlar: { oturumlar: [], ram_bos_mb: 1, ram_toplam_mb: 2, ram_dusuk: false },
  rapor_oku: { is_id: 1, durum: "tamam", kirli: false, cit: "c".repeat(16), govde: "g", kirpildi: false },
  projeler: { projeler: [] },
  uygulamalar: { telefon_bagli: true, uygulamalar: [] },
  oturum_durdur: { is_id: 1, sonuc: "durduruldu" },
  devir_ozeti: { kabul: true },
  kullaniciya_sor: { durum: "iptal" },
  soru_bekle: { durum: "iptal" },
  foreground: CMD_TAMAM,
  elements: CMD_TAMAM,
  screenshot: CMD_TAMAM,
  zoom: CMD_TAMAM,
  click: CMD_TAMAM,
  type_text: CMD_TAMAM,
  key: CMD_TAMAM,
  scroll: CMD_TAMAM,
  drag: CMD_TAMAM,
  wait: CMD_TAMAM,
  open_app: CMD_TAMAM,
  rapor_ver: { kabul: true },
};

type Cagri = { fiil: KopruFiili; girdi: unknown; baglam: KopruBaglami; sinyal: AbortSignal };
type OzelIsleyici = (girdi: unknown, baglam: KopruBaglami, sinyal: AbortSignal) => Promise<Sonuc<unknown>>;

/** Her fiili kaydeden, varsayılan olarak geçerli çıktı dönen işleyici seti. */
const isleyicilerKur = (ozel: Partial<Record<KopruFiili, OzelIsleyici>> = {}) => {
  const cagrilar: Cagri[] = [];
  const nesne: Record<string, unknown> = {};
  for (const fiil of KOPRU_FIILLERI) {
    nesne[fiil] = async (girdi: unknown, baglam: KopruBaglami, sinyal: AbortSignal) => {
      cagrilar.push({ fiil, girdi, baglam, sinyal });
      const o = ozel[fiil];
      return o ? o(girdi, baglam, sinyal) : { ok: true, deger: CIKTI[fiil] };
    };
  }
  return { isleyiciler: nesne as unknown as FiilIsleyiciler, cagrilar };
};

/** Asılı kalan işleyici: sinyali yakalar, elle çözülür. */
const asili = () => {
  const sinyaller: AbortSignal[] = [];
  const cozuculer: Array<() => void> = [];
  const isleyici: OzelIsleyici = (_g, _b, sinyal) =>
    new Promise((coz) => {
      sinyaller.push(sinyal);
      cozuculer.push(() => coz({ ok: true, deger: { durum: "iptal" } }));
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
  rastgele: ReturnType<typeof sahteRastgele>;
  zaman: ReturnType<typeof sahteZaman>;
  sunucu: KopruSunucu;
}

const kur = async (
  opsiyon: { depo?: Depo; tohum?: number; isleyiciler?: FiilIsleyiciler; baslat?: boolean } = {},
): Promise<Kurulum> => {
  const boru = sahteBoru();
  const gunluk = sahteGunluk();
  const zaman = sahteZaman();
  const rastgele = sahteRastgele(opsiyon.tohum ?? 777 + ++sayac);
  const depo =
    opsiyon.depo ??
    depoKur({ yol: ":memory:", saat: sahteZaman().saat, gunluk: sahteGunluk() });
  if (!opsiyon.depo) acilanlar.push(depo);
  const sunucu = kopruSunucuKur({
    boru,
    depo,
    rastgele,
    anahtar: { sabitZamanEsit: (a: string, b: string) => a === b },
    zamanlayici: zaman.zamanlayici,
    gunluk,
  });
  if (opsiyon.baslat !== false) await sunucu.baslat(opsiyon.isleyiciler ?? isleyicilerKur().isleyiciler);
  return { boru, depo, gunluk, rastgele, zaman, sunucu };
};

const gonder = (b: SahteBoruBaglantisi, mesaj: unknown): void => {
  b.satirGonder(typeof mesaj === "string" ? mesaj : JSON.stringify(mesaj));
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

/** Giden her satır protokolün aşağı şemasından geçmek zorundadır. */
const cikanlar = (b: SahteBoruBaglantisi): KopruAsagi[] =>
  b.yazilanlar.map((s) => {
    const c = kopruAsagiCoz(s);
    assert.ok(c.ok, `giden satir semaya uymuyor: ${s.slice(0, 120)}`);
    return c.mesaj;
  });

const sonYanit = (b: SahteBoruBaglantisi) => {
  const l = cikanlar(b);
  const y = l[l.length - 1];
  assert.ok(y && y.type === "yanit", "son cikan satir yanit degil");
  return y;
};

/** Bağlan, el sıkış, `welcome` bekle. */
const baglan = async (k: Kurulum, rol: KopruRolu, jeton: string): Promise<SahteBoruBaglantisi> => {
  const b = k.boru.baglan();
  gonder(b, hello(rol, jeton));
  await bosalt();
  return b;
};

const yetkiliBaglan = async (k: Kurulum, kapsam: JetonKapsami) => {
  const jeton = k.sunucu.jetonUret(kapsam);
  const b = await baglan(k, kapsam.rol, jeton);
  assert.equal(cikanlar(b)[0]?.type, "kopru_welcome");
  return { b, jeton };
};

// ---------------------------------------------------------------------------------------------
// Dinleme
// ---------------------------------------------------------------------------------------------

describe("kopru-sunucu: dinleme", () => {
  it("KOPRU_BORU_ADI uzerinde dinler, satir siniri verir", async () => {
    const k = await kur();
    const i = k.boru.istek();
    assert.ok(i);
    assert.equal(i.ad, KOPRU_BORU_ADI);
    assert.ok(i.azamiSatir > 0);
  });

  it("kapat boru sunucusunu kapatir", async () => {
    const k = await kur();
    await k.sunucu.kapat();
    assert.equal(k.boru.kapatildi, true);
  });
});

// ---------------------------------------------------------------------------------------------
// El sıkışma ve kopru_ret dalları
// ---------------------------------------------------------------------------------------------

describe("kopru-sunucu: el sikisma", () => {
  it("gecerli jeton ve dogru rol: kopru_welcome{rol}", async () => {
    const k = await kur();
    const { b } = await yetkiliBaglan(k, KAPSAM_EREN);
    assert.deepEqual(cikanlar(b)[0], { v: PROTOKOL_SURUMU, type: "kopru_welcome", rol: "eren" });
    assert.equal(b.kapandi, false);
  });

  it("her rol kendi jetonuyla kabul edilir", async () => {
    const k = await kur();
    for (const rol of KOPRU_ROLLERI) {
      const { b } = await yetkiliBaglan(k, KAPSAMLAR[rol]);
      assert.deepEqual(cikanlar(b)[0], { v: PROTOKOL_SURUMU, type: "kopru_welcome", rol });
    }
  });

  it("ilk mesaj kopru_hello degilse: yetkisiz + kapat, isleyici calismaz", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    const b = k.boru.baglan();
    gonder(b, istek("i1", "oturumlar", {}));
    await bosalt();
    assert.deepEqual(cikanlar(b), [{ v: PROTOKOL_SURUMU, type: "kopru_ret", code: "yetkisiz" }]);
    assert.equal(b.kapandi, true);
    assert.equal(m.cagrilar.length, 0);
  });

  it("ilk mesaj iptal ise de yetkisiz + kapat", async () => {
    const k = await kur();
    const b = k.boru.baglan();
    gonder(b, iptal("i1"));
    await bosalt();
    assert.deepEqual(cikanlar(b), [{ v: PROTOKOL_SURUMU, type: "kopru_ret", code: "yetkisiz" }]);
    assert.equal(b.kapandi, true);
  });

  it("depoda olmayan jeton: jeton_gecersiz", async () => {
    const k = await kur();
    const b = await baglan(k, "eren", "x".repeat(43));
    assert.deepEqual(cikanlar(b), [{ v: PROTOKOL_SURUMU, type: "kopru_ret", code: "jeton_gecersiz" }]);
  });

  it("yanlis rolle dogru jeton: jeton_gecersiz (rol yalniz jetondan turer)", async () => {
    const k = await kur();
    const jeton = k.sunucu.jetonUret(KAPSAM_EREN);
    for (const rol of KOPRU_ROLLERI) {
      if (rol === "eren") continue;
      const b = await baglan(k, rol, jeton);
      assert.deepEqual(
        cikanlar(b),
        [{ v: PROTOKOL_SURUMU, type: "kopru_ret", code: "jeton_gecersiz" }],
        `rol=${rol}`,
      );
    }
  });

  it("reddedilen el sikismadan sonra gelen istek isleyiciye ulasmaz", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    const jeton = k.sunucu.jetonUret(KAPSAM_EREN);
    const b = await baglan(k, "soru", jeton);
    gonder(b, istek("i1", "kullaniciya_sor", GIRDI.kullaniciya_sor));
    gonder(b, istek("i2", "oturumlar", {}));
    await bosalt();
    assert.equal(m.cagrilar.length, 0);
    assert.equal(cikanlar(b).filter((x) => x.type === "yanit").length, 0);
  });

  it("isleyiciye giden baglam yalniz jetondan gelir (kapsamin aynisi)", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    for (const rol of KOPRU_ROLLERI) {
      const { b } = await yetkiliBaglan(k, KAPSAMLAR[rol]);
      const fiil = ROL_FIILLERI[rol][0];
      gonder(b, istek(`i-${rol}`, fiil, GIRDI[fiil]));
      await bosalt();
    }
    assert.equal(m.cagrilar.length, 3);
    for (const c of m.cagrilar) {
      const rol = c.baglam.rol;
      assert.deepEqual(c.baglam, KAPSAMLAR[rol]);
    }
  });

  it("gecersiz hello cercevesi (kisa jeton, bilinmeyen rol, ek alan, yanlis surum): kapatir, isleyici yok", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    const kotu: unknown[] = [
      hello("eren", "kisa"),
      hello("yonetici", "x".repeat(43)),
      { ...hello("eren", "x".repeat(43)), fazla: 1 },
      { v: 2, type: "kopru_hello", rol: "eren", jeton: "x".repeat(43) },
      "bu json degil",
      "{}",
    ];
    for (const c of kotu) {
      const b = k.boru.baglan();
      gonder(b, c as string);
      await bosalt();
      assert.equal(b.kapandi, true, `kapanmadi: ${JSON.stringify(c)}`);
    }
    assert.equal(m.cagrilar.length, 0);
  });
});

describe("kopru-sunucu: hello zaman asimi", () => {
  it("hello gelmezse 9.999 ms'de acik, 10.000 ms'de yetkisiz + kapali", async () => {
    const k = await kur();
    const b = k.boru.baglan();
    k.zaman.ilerlet(9_999);
    assert.equal(b.kapandi, false);
    assert.deepEqual(cikanlar(b), []);
    k.zaman.ilerlet(1);
    assert.deepEqual(cikanlar(b), [{ v: PROTOKOL_SURUMU, type: "kopru_ret", code: "yetkisiz" }]);
    assert.equal(b.kapandi, true);
  });

  it("hello sure dolmadan gelirse sure dolunca kapanmaz", async () => {
    const k = await kur();
    const jeton = k.sunucu.jetonUret(KAPSAM_EREN);
    const b = k.boru.baglan();
    k.zaman.ilerlet(5_000);
    gonder(b, hello("eren", jeton));
    await bosalt();
    k.zaman.ilerlet(20_000);
    assert.equal(b.kapandi, false);
    assert.deepEqual(cikanlar(b), [{ v: PROTOKOL_SURUMU, type: "kopru_welcome", rol: "eren" }]);
  });
});

// ---------------------------------------------------------------------------------------------
// Rol denetimi
// ---------------------------------------------------------------------------------------------

describe("kopru-sunucu: rol-fiil denetimi", () => {
  it("rol disi fiil: yanit{ok:false, code:rol_fiil_izinsiz}, isleyici cagrilmaz, baglanti acik kalir", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k, KAPSAM_EREN);
    gonder(b, istek("i1", "click", GIRDI.click));
    await bosalt();
    assert.deepEqual(sonYanit(b), {
      v: PROTOKOL_SURUMU,
      type: "yanit",
      istek_id: "i1",
      ok: false,
      code: "rol_fiil_izinsiz",
    });
    assert.equal(m.cagrilar.length, 0);
    assert.equal(b.kapandi, false);
    // sonraki izinli istek yine calisir
    gonder(b, istek("i2", "oturumlar", {}));
    await bosalt();
    assert.equal(m.cagrilar.length, 1);
  });

  it("her rol icin, rolun disindaki her fiil reddedilir", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    for (const rol of KOPRU_ROLLERI) {
      const { b } = await yetkiliBaglan(k, KAPSAMLAR[rol]);
      const izinli = new Set<string>(ROL_FIILLERI[rol]);
      let n = 0;
      for (const fiil of KOPRU_FIILLERI) {
        if (izinli.has(fiil)) continue;
        gonder(b, istek(`d${n++}`, fiil, GIRDI[fiil]));
        await bosalt();
        const y = sonYanit(b);
        assert.equal(y.ok, false, `${rol}/${fiil}`);
        assert.equal(y.code, "rol_fiil_izinsiz", `${rol}/${fiil}`);
        assert.equal(y.istek_id, `d${n - 1}`);
      }
      assert.ok(n > 0);
    }
    assert.equal(m.cagrilar.length, 0);
  });

  it("ROL_FIILLERI uzerinde dongu: her fiil kendi rolunde isleyiciye ulasir ve gecerli sonuc doner", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    let toplam = 0;
    for (const rol of KOPRU_ROLLERI) {
      const { b } = await yetkiliBaglan(k, KAPSAMLAR[rol]);
      for (const fiil of ROL_FIILLERI[rol]) {
        // tablo kendi icinde tutarli mi
        assert.ok(KOPRU_FIIL_SEMALARI[fiil].girdi.safeParse(GIRDI[fiil]).success, `girdi tablosu: ${fiil}`);
        assert.ok(KOPRU_FIIL_SEMALARI[fiil].cikti.safeParse(CIKTI[fiil]).success, `cikti tablosu: ${fiil}`);

        const onceki = m.cagrilar.length;
        const id = `istek-${rol}-${fiil}`;
        gonder(b, istek(id, fiil, GIRDI[fiil]));
        await bosalt();

        assert.equal(m.cagrilar.length, onceki + 1, `isleyici cagrilmadi: ${fiil}`);
        const c = m.cagrilar[m.cagrilar.length - 1]!;
        assert.equal(c.fiil, fiil);
        assert.deepEqual(c.girdi, GIRDI[fiil], `girdi aynen iletilmeli: ${fiil}`);
        assert.deepEqual(c.baglam, KAPSAMLAR[rol]);
        assert.equal(c.sinyal.aborted, false);
        assert.deepEqual(sonYanit(b), {
          v: PROTOKOL_SURUMU,
          type: "yanit",
          istek_id: id,
          ok: true,
          sonuc: CIKTI[fiil],
        });
        toplam++;
      }
    }
    assert.equal(toplam, KOPRU_FIILLERI.length);
    assert.equal(m.cagrilar.length, KOPRU_FIILLERI.length);
  });

  it("boruda kullanici mesaji gonderen fiil yok: sozlesme ve kablo", async () => {
    for (const fiil of KOPRU_FIILLERI) {
      assert.doesNotMatch(fiil, /mesaj|message|user|kullanici_mesaj|sohbet/i, fiil);
    }
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    for (const ad of ["kullanici_mesaji", "user_message", "insan_mesaji", "mesaj_gonder"]) {
      const { b } = await yetkiliBaglan(k, KAPSAM_EREN);
      gonder(b, istek("i1", ad, { text: "merhaba" }));
      await bosalt();
      assert.equal(b.kapandi, true, ad);
    }
    assert.equal(m.cagrilar.length, 0);
  });

  it("isleyici sonucu ok:false ise kod aynen yanita gecer", async () => {
    const m = isleyicilerKur({
      rapor_oku: async () => ({ ok: false, code: "is_bulunamadi" }),
    });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k, KAPSAM_EREN);
    gonder(b, istek("i1", "rapor_oku", { id: 5 }));
    await bosalt();
    assert.deepEqual(sonYanit(b), {
      v: PROTOKOL_SURUMU,
      type: "yanit",
      istek_id: "i1",
      ok: false,
      code: "is_bulunamadi",
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Sema, sonuc dogrulama
// ---------------------------------------------------------------------------------------------

describe("kopru-sunucu: cerceve ve sonuc dogrulama", () => {
  it("semaya uymayan cerceve baglantiyi kapatir (el sikisma sonrasi)", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    const kotu: unknown[] = [
      "json degil",
      "[]",
      { v: PROTOKOL_SURUMU, type: "bilinmeyen" },
      { v: 2, type: "iptal", istek_id: "i1" },
      istek("i1", "oturum_durdur", { id: "bir" }), // girdi semasina uymuyor
      istek("i1", "oturumlar", { yalniz_aktif: true, fazla: 1 }),
      { ...istek("i1", "oturumlar", {}), fazla: 1 },
      istek("bosluk var", "oturumlar", {}),
    ];
    for (const c of kotu) {
      const { b } = await yetkiliBaglan(k, KAPSAM_EREN);
      gonder(b, c as string);
      await bosalt();
      assert.equal(b.kapandi, true, `kapanmadi: ${JSON.stringify(c)}`);
    }
    assert.equal(m.cagrilar.length, 0);
  });

  it("sonuc fiilin cikti semasina uymuyorsa ic_hata, sonuc yok, detail yok", async () => {
    const m = isleyicilerKur({
      rapor_ver: async () => ({ ok: true, deger: { kabul: false } }), // literal true
      kullaniciya_sor: async () => ({ ok: true, deger: { durum: "cevaplandi" } }), // cevap eksik
      oturumlar: async () => ({ ok: true, deger: { oturumlar: [] } }), // alanlar eksik
      devir_ozeti: async () => ({ ok: true, deger: { kabul: true, gizli: "x" } }), // strict
    });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const olay: Array<[KopruRolu, KopruFiili]> = [
      ["telefon", "rapor_ver"],
      ["soru", "kullaniciya_sor"],
      ["eren", "oturumlar"],
      ["eren", "devir_ozeti"],
    ];
    let nesilNo = 0;
    for (const [rol, fiil] of olay) {
      // eren icin her olay ayri kapsam: ayni kapsamla ikinci eszamanli baglanti reddedilir
      const kapsam: JetonKapsami =
        rol === "eren" ? { rol: "eren", sohbet_id: "ana", nesil: ++nesilNo } : KAPSAMLAR[rol];
      const { b } = await yetkiliBaglan(k, kapsam);
      gonder(b, istek("i1", fiil, GIRDI[fiil]));
      await bosalt();
      const y = sonYanit(b);
      assert.equal(y.ok, false, fiil);
      assert.equal(y.code, "ic_hata", fiil);
      assert.equal("sonuc" in y, false, fiil);
      assert.equal("detail" in y, false, fiil);
      assert.equal(b.kapandi, false, fiil);
    }
  });

  it("isleyici atarsa ic_hata, detail yok; hata metni gunluge girmez", async () => {
    const GIZLI = "model-ciktisi-gizli-metin-12345";
    const m = isleyicilerKur({
      projeler: async () => {
        throw new Error(GIZLI);
      },
    });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k, KAPSAM_EREN);
    gonder(b, istek("i1", "projeler", {}));
    await bosalt();
    const y = sonYanit(b);
    assert.equal(y.ok, false);
    assert.equal(y.code, "ic_hata");
    assert.equal("detail" in y, false);
    assert.equal(b.yazilanlar.join("\n").includes(GIZLI), false);
    assert.equal(JSON.stringify(k.gunluk.girdiler).includes(GIZLI), false);
    // baglanti saglam
    gonder(b, istek("i2", "uygulamalar", {}));
    await bosalt();
    assert.equal(sonYanit(b).ok, true);
  });

  it("isleyici reddedilmis (asenkron) sozle de ic_hata verir", async () => {
    const m = isleyicilerKur({
      projeler: () => Promise.reject(new Error("x")),
    });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k, KAPSAM_EREN);
    gonder(b, istek("i1", "projeler", {}));
    await bosalt();
    assert.equal(sonYanit(b).code, "ic_hata");
  });
});

// ---------------------------------------------------------------------------------------------
// yinelenen_istek
// ---------------------------------------------------------------------------------------------

describe("kopru-sunucu: yinelenen_istek", () => {
  it("suren istek_id yeniden gelirse yinelenen_istek; ilk istek etkilenmez", async () => {
    const a = asili();
    const m = isleyicilerKur({ kullaniciya_sor: a.isleyici });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k, KAPSAM_SORU);
    gonder(b, istek("i1", "kullaniciya_sor", GIRDI.kullaniciya_sor));
    await bosalt();
    gonder(b, istek("i1", "kullaniciya_sor", GIRDI.kullaniciya_sor));
    await bosalt();

    assert.equal(m.cagrilar.length, 1, "ikinci kopya isleyiciye gitmemeli");
    assert.deepEqual(sonYanit(b), {
      v: PROTOKOL_SURUMU,
      type: "yanit",
      istek_id: "i1",
      ok: false,
      code: "yinelenen_istek",
    });
    assert.equal(a.sinyaller[0]?.aborted, false);
    assert.equal(b.kapandi, false);

    // ilk istek hala tamamlanabilir
    a.cozuculer[0]!();
    await bosalt();
    assert.deepEqual(sonYanit(b), {
      v: PROTOKOL_SURUMU,
      type: "yanit",
      istek_id: "i1",
      ok: true,
      sonuc: { durum: "iptal" },
    });
  });

  it("farkli istek_id'ler es zamanli surebilir", async () => {
    const a = asili();
    const m = isleyicilerKur({ soru_bekle: a.isleyici });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k, KAPSAM_SORU);
    gonder(b, istek("i1", "soru_bekle", GIRDI.soru_bekle));
    gonder(b, istek("i2", "soru_bekle", GIRDI.soru_bekle));
    await bosalt();
    assert.equal(m.cagrilar.length, 2);
    assert.equal(cikanlar(b).filter((x) => x.type === "yanit").length, 0);
  });

  it("biten istegin istek_id'si yeniden kullanilabilir", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k, KAPSAM_EREN);
    gonder(b, istek("i1", "projeler", {}));
    await bosalt();
    gonder(b, istek("i1", "projeler", {}));
    await bosalt();
    assert.equal(m.cagrilar.length, 2);
    assert.equal(sonYanit(b).ok, true);
  });

  it("ayni istek_id baska baglantida yinelenen sayilmaz", async () => {
    const a = asili();
    const m = isleyicilerKur({ soru_bekle: a.isleyici });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const x = await yetkiliBaglan(k, KAPSAM_SORU);
    const y = await yetkiliBaglan(k, { rol: "soru", is_id: 8 });
    gonder(x.b, istek("i1", "soru_bekle", GIRDI.soru_bekle));
    gonder(y.b, istek("i1", "soru_bekle", GIRDI.soru_bekle));
    await bosalt();
    assert.equal(m.cagrilar.length, 2);
  });
});

// ---------------------------------------------------------------------------------------------
// Iptal
// ---------------------------------------------------------------------------------------------

describe("kopru-sunucu: iptal nedenleri", () => {
  it("iptal{istek_id}: yalniz o istegin sinyali model_iptal ile kesilir", async () => {
    const a = asili();
    const m = isleyicilerKur({ kullaniciya_sor: a.isleyici });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k, KAPSAM_SORU);
    gonder(b, istek("i1", "kullaniciya_sor", GIRDI.kullaniciya_sor));
    gonder(b, istek("i2", "kullaniciya_sor", GIRDI.kullaniciya_sor));
    await bosalt();
    assert.equal(a.sinyaller.length, 2);

    gonder(b, iptal("i1"));
    await bosalt();
    assert.equal(a.sinyaller[0]!.aborted, true);
    assert.equal(a.sinyaller[0]!.reason, "model_iptal");
    assert.equal(a.sinyaller[1]!.aborted, false);
    assert.equal(b.kapandi, false, "model iptali baglantiyi kapatmaz");
  });

  it("bilinmeyen ya da bitmis istek_id icin iptal zararsizdir", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k, KAPSAM_EREN);
    gonder(b, iptal("yok"));
    gonder(b, istek("i1", "projeler", {}));
    await bosalt();
    gonder(b, iptal("i1"));
    await bosalt();
    assert.equal(b.kapandi, false);
    assert.equal(m.cagrilar[0]!.sinyal.aborted, false, "biten istek sonradan kesilmez");
    gonder(b, istek("i2", "projeler", {}));
    await bosalt();
    assert.equal(sonYanit(b).ok, true);
  });

  it("baglanti kopunca suren her istek baglanti_koptu ile kesilir", async () => {
    const a = asili();
    const m = isleyicilerKur({ kullaniciya_sor: a.isleyici, soru_bekle: a.isleyici });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k, KAPSAM_SORU);
    gonder(b, istek("i1", "kullaniciya_sor", GIRDI.kullaniciya_sor));
    gonder(b, istek("i2", "soru_bekle", GIRDI.soru_bekle));
    await bosalt();
    assert.equal(a.sinyaller.length, 2);

    b.istemciKopar();
    await bosalt();
    for (const s of a.sinyaller) {
      assert.equal(s.aborted, true);
      assert.equal(s.reason, "baglanti_koptu");
    }
  });

  it("iki neden birbirinden ayirt edilir", async () => {
    const a = asili();
    const m = isleyicilerKur({ soru_bekle: a.isleyici });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k, KAPSAM_SORU);
    gonder(b, istek("i1", "soru_bekle", GIRDI.soru_bekle));
    gonder(b, istek("i2", "soru_bekle", GIRDI.soru_bekle));
    await bosalt();
    gonder(b, iptal("i1"));
    await bosalt();
    b.istemciKopar();
    await bosalt();
    assert.equal(a.sinyaller[0]!.reason, "model_iptal", "once model iptal ettiyse neden degismez");
    assert.equal(a.sinyaller[1]!.reason, "baglanti_koptu");
  });

  it("biten istegin sinyali baglanti kopunca kesilmez", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k, KAPSAM_EREN);
    gonder(b, istek("i1", "projeler", {}));
    await bosalt();
    b.istemciKopar();
    await bosalt();
    assert.equal(m.cagrilar[0]!.sinyal.aborted, false);
  });

  it("baglanti kopunca baska baglantinin istekleri etkilenmez", async () => {
    const a = asili();
    const m = isleyicilerKur({ soru_bekle: a.isleyici });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const x = await yetkiliBaglan(k, KAPSAM_SORU);
    const y = await yetkiliBaglan(k, { rol: "soru", is_id: 8 });
    gonder(x.b, istek("i1", "soru_bekle", GIRDI.soru_bekle));
    gonder(y.b, istek("i1", "soru_bekle", GIRDI.soru_bekle));
    await bosalt();
    x.b.istemciKopar();
    await bosalt();
    assert.equal(a.sinyaller[0]!.aborted, true);
    assert.equal(a.sinyaller[1]!.aborted, false);
  });

  it("el sikismadan once kopan baglanti hata vermez", async () => {
    const k = await kur();
    const b = k.boru.baglan();
    b.istemciKopar();
    await bosalt();
    assert.equal(b.kapandi, true);
  });
});

// ---------------------------------------------------------------------------------------------
// Jeton: uretim, iptal, kalicilik, gizlilik
// ---------------------------------------------------------------------------------------------

describe("kopru-sunucu: jeton", () => {
  it("jetonUret depoya yalniz ozeti yazar ve kapsami baglar", async () => {
    const k = await kur();
    const jeton = k.sunucu.jetonUret(KAPSAM_TELEFON);
    assert.match(jeton, /^[A-Za-z0-9_-]{32,128}$/);
    const kayit = k.depo.jetonBul(ozetle(jeton));
    assert.ok(kayit);
    assert.equal(kayit.ozet, ozetle(jeton));
    assert.deepEqual(kayit.kapsam, KAPSAM_TELEFON);
    assert.equal(k.depo.jetonBul(jeton), null, "duz jeton anahtar olarak bulunmamali");
  });

  it("her cagri farkli jeton uretir", async () => {
    const k = await kur();
    const a = k.sunucu.jetonUret(KAPSAM_EREN);
    const b = k.sunucu.jetonUret(KAPSAM_EREN);
    assert.notEqual(a, b);
  });

  it("jeton RastgelePortu.jeton() ile uretilir", async () => {
    const k = await kur();
    const once = k.rastgele.cagrilar.say("jeton");
    k.sunucu.jetonUret(KAPSAM_EREN);
    assert.equal(k.rastgele.cagrilar.say("jeton"), once + 1);
  });

  it("duz jeton gunluge girmez (kabul, ret, iptal yollari dahil)", async () => {
    const k = await kur();
    const jeton = k.sunucu.jetonUret(KAPSAM_EREN);
    const kotuJeton = "Z".repeat(43);
    const b1 = await baglan(k, "eren", jeton);
    await baglan(k, "eren", kotuJeton);
    await baglan(k, "soru", jeton);
    gonder(b1, istek("i1", "projeler", {}));
    await bosalt();
    k.sunucu.jetonlariIptalEt(KAPSAM_EREN);
    await bosalt();
    const gunluk = JSON.stringify(k.gunluk.girdiler);
    assert.equal(gunluk.includes(jeton), false, "gecerli jeton gunlukte");
    assert.equal(gunluk.includes(kotuJeton), false, "reddedilen jeton gunlukte");
  });

  it("duz jeton depoya hic girmez: depo cagrilari ve sqlite dosyasi", async () => {
    const yol = join(kok, `jeton-${++sayac}.db`);
    const gercek = depoKur({ yol, saat: sahteZaman().saat, gunluk: sahteGunluk() });
    acilanlar.push(gercek);
    const cagrilar: unknown[][] = [];
    const sarmal = new Proxy(gercek, {
      get(hedef, ad, alici) {
        const d = Reflect.get(hedef, ad, alici);
        if (typeof d !== "function") return d;
        return (...args: unknown[]) => {
          cagrilar.push([String(ad), ...args]);
          return (d as (...a: unknown[]) => unknown).apply(hedef, args);
        };
      },
    }) as Depo;

    const k = await kur({ depo: sarmal });
    const jeton = k.sunucu.jetonUret(KAPSAM_EREN);
    await baglan(k, "eren", jeton);
    k.sunucu.jetonlariIptalEt(KAPSAM_EREN);

    const jetonYazimi = cagrilar.filter((c) => c[0] === "jetonEkle");
    assert.equal(jetonYazimi.length, 1);
    assert.equal(JSON.stringify(cagrilar).includes(jeton), false, "depo cagrisinda duz jeton");

    // iptal oncesi durumu dosyada gormek icin yeniden uret
    const j2 = k.sunucu.jetonUret(KAPSAM_SORU);
    const db = new DatabaseSync(yol, { readOnly: true });
    try {
      const satirlar = db.prepare("SELECT * FROM kopru_jetonlari").all() as Array<Record<string, unknown>>;
      assert.equal(satirlar.length, 1);
      const metin = satirlar.map((s) => Object.values(s).map(String).join("|")).join("\n");
      assert.equal(metin.includes(j2), false, "duz jeton sqlite dosyasinda");
      assert.ok(metin.includes(ozetle(j2)), "ozet dosyada olmali");
    } finally {
      db.close();
    }
  });

  it("jetonlariIptalEt: depodan siler, o kapsamin acik baglantisini kapatir, jeton yeniden kabul edilmez", async () => {
    const k = await kur();
    const { b, jeton } = await yetkiliBaglan(k, KAPSAM_EREN);
    k.sunucu.jetonlariIptalEt(KAPSAM_EREN);
    assert.equal(k.depo.jetonBul(ozetle(jeton)), null);
    assert.equal(b.kapandi, true);
    const b2 = await baglan(k, "eren", jeton);
    assert.deepEqual(cikanlar(b2), [{ v: PROTOKOL_SURUMU, type: "kopru_ret", code: "jeton_gecersiz" }]);
  });

  it("jetonlariIptalEt: suren istekler baglanti_koptu ile kesilir", async () => {
    const a = asili();
    const m = isleyicilerKur({ soru_bekle: a.isleyici });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const { b } = await yetkiliBaglan(k, KAPSAM_SORU);
    gonder(b, istek("i1", "soru_bekle", GIRDI.soru_bekle));
    await bosalt();
    k.sunucu.jetonlariIptalEt(KAPSAM_SORU);
    await bosalt();
    assert.equal(a.sinyaller[0]!.aborted, true);
    assert.equal(a.sinyaller[0]!.reason, "baglanti_koptu");
  });

  it("jetonlariIptalEt: baska kapsamlara dokunmaz", async () => {
    const k = await kur();
    const eren1 = await yetkiliBaglan(k, { rol: "eren", sohbet_id: "ana", nesil: 1 });
    const eren2 = await yetkiliBaglan(k, { rol: "eren", sohbet_id: "ana", nesil: 2 });
    const soru = await yetkiliBaglan(k, KAPSAM_SORU);
    k.sunucu.jetonlariIptalEt({ rol: "eren", sohbet_id: "ana", nesil: 1 });
    assert.equal(eren1.b.kapandi, true);
    assert.equal(eren2.b.kapandi, false);
    assert.equal(soru.b.kapandi, false);
    assert.ok(k.depo.jetonBul(ozetle(eren2.jeton)));
    assert.ok(k.depo.jetonBul(ozetle(soru.jeton)));
  });

  it("jetonlariIptalEt: ayni kapsamin birden cok jetonunu siler", async () => {
    const k = await kur();
    const a = k.sunucu.jetonUret(KAPSAM_SORU);
    const b = k.sunucu.jetonUret(KAPSAM_SORU);
    k.sunucu.jetonlariIptalEt(KAPSAM_SORU);
    assert.equal(k.depo.jetonBul(ozetle(a)), null);
    assert.equal(k.depo.jetonBul(ozetle(b)), null);
  });

  it("telefon kapsami tum alanlariyla eslesir: baska plan_hash ya da is_id silinmez", async () => {
    const k = await kur();
    const digeri: JetonKapsami = { ...KAPSAM_TELEFON, plan_hash: "b".repeat(64) };
    const j1 = k.sunucu.jetonUret(KAPSAM_TELEFON);
    const j2 = k.sunucu.jetonUret(digeri);
    k.sunucu.jetonlariIptalEt(KAPSAM_TELEFON);
    assert.equal(k.depo.jetonBul(ozetle(j1)), null);
    assert.ok(k.depo.jetonBul(ozetle(j2)));
  });

  it("servis yeniden kurulunca ayni jeton kabul edilir", async () => {
    const depo = depoKur({ yol: ":memory:", saat: sahteZaman().saat, gunluk: sahteGunluk() });
    acilanlar.push(depo);
    const ilk = await kur({ depo, tohum: 1 });
    const jeton = ilk.sunucu.jetonUret(KAPSAM_TELEFON);
    await ilk.sunucu.kapat();

    const m = isleyicilerKur();
    const yeni = await kur({ depo, tohum: 2, isleyiciler: m.isleyiciler });
    const b = await baglan(yeni, "telefon", jeton);
    assert.deepEqual(cikanlar(b), [{ v: PROTOKOL_SURUMU, type: "kopru_welcome", rol: "telefon" }]);
    gonder(b, istek("i1", "foreground", {}));
    await bosalt();
    assert.deepEqual(m.cagrilar[0]?.baglam, KAPSAM_TELEFON);
    assert.equal(sonYanit(b).ok, true);
  });

  it("servis yeniden kurulunca iptal edilmis jeton kabul edilmez", async () => {
    const depo = depoKur({ yol: ":memory:", saat: sahteZaman().saat, gunluk: sahteGunluk() });
    acilanlar.push(depo);
    const ilk = await kur({ depo, tohum: 1 });
    const jeton = ilk.sunucu.jetonUret(KAPSAM_SORU);
    ilk.sunucu.jetonlariIptalEt(KAPSAM_SORU);
    await ilk.sunucu.kapat();
    const yeni = await kur({ depo, tohum: 2 });
    const b = await baglan(yeni, "soru", jeton);
    assert.deepEqual(cikanlar(b), [{ v: PROTOKOL_SURUMU, type: "kopru_ret", code: "jeton_gecersiz" }]);
  });

  it("depoda olmayan jeton, sabitZamanEsit her zaman true dondurse de reddedilir", async () => {
    // Zayif esitlik sahtesi: sabitZamanEsit her zaman false ise bilinen jeton bile reddedilmez
    // (ozet depodan aranir), ama ozet karsilastirmasi portu kullanir; port true dondururse
    // yanlis ozet kabul edilmemeli (depo aramasi dogruluk kaynagidir).
    const boru = sahteBoru();
    const depo = depoKur({ yol: ":memory:", saat: sahteZaman().saat, gunluk: sahteGunluk() });
    acilanlar.push(depo);
    const sunucu = kopruSunucuKur({
      boru,
      depo,
      rastgele: sahteRastgele(5),
      anahtar: { sabitZamanEsit: () => true },
      zamanlayici: sahteZaman().zamanlayici,
      gunluk: sahteGunluk(),
    });
    await sunucu.baslat(isleyicilerKur().isleyiciler);
    const b = boru.baglan();
    gonder(b, hello("eren", "q".repeat(43)));
    await bosalt();
    assert.deepEqual(cikanlar(b), [{ v: PROTOKOL_SURUMU, type: "kopru_ret", code: "jeton_gecersiz" }]);
  });
});

// ---------------------------------------------------------------------------------------------
// Dilim 2: eren kapsami {rol, sohbet_id, nesil}, tek baglanti, erenJetonlariniSil
// ---------------------------------------------------------------------------------------------

const eren = (sohbet_id: string, nesil: number): JetonKapsami => ({ rol: "eren", sohbet_id, nesil });
const RET_GECERSIZ = [{ v: PROTOKOL_SURUMU, type: "kopru_ret", code: "jeton_gecersiz" }];

describe("kopru-sunucu: eren kapsami ve tek baglanti (dilim 2)", () => {
  it("eren jetonu kapsami sohbet_id + nesil ile depoda ve isleyici baglaminda aynen durur", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    const kapsam = eren("sohbet-a", 4);
    const { b, jeton } = await yetkiliBaglan(k, kapsam);
    assert.deepEqual(k.depo.jetonBul(ozetle(jeton))?.kapsam, kapsam);
    gonder(b, istek("i1", "projeler", {}));
    await bosalt();
    assert.deepEqual(m.cagrilar[0]?.baglam, kapsam);
  });

  it("ayni kapsamla ikinci eszamanli eren baglantisi: jeton_gecersiz + kapat; ilki calismayi surdurur", async () => {
    const a = asili();
    const m = isleyicilerKur({ oturumlar: a.isleyici });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const kapsam = eren("ana", 1);
    const ilk = await yetkiliBaglan(k, kapsam);
    gonder(ilk.b, istek("i1", "oturumlar", {}));
    await bosalt();

    const ikinci = await baglan(k, "eren", k.sunucu.jetonUret(kapsam));
    assert.deepEqual(cikanlar(ikinci), RET_GECERSIZ);
    assert.equal(ikinci.kapandi, true);

    assert.equal(ilk.b.kapandi, false);
    assert.equal(a.sinyaller[0]!.aborted, false, "ilkin suren istegi kesilmemeli");
    a.cozuculer[0]!();
    await bosalt();
    assert.equal(sonYanit(ilk.b).type, "yanit");
    // ilkin kendi jetonuyla ikinci deneme de reddedilir
    const yine = await baglan(k, "eren", ilk.jeton);
    assert.deepEqual(cikanlar(yine), RET_GECERSIZ);
    assert.equal(ilk.b.kapandi, false);
  });

  it("reddedilen ikinci baglanti jetonu silmez: ilk kopunca ayni jetonla yeniden baglanma kabul", async () => {
    const k = await kur();
    const { b, jeton } = await yetkiliBaglan(k, eren("ana", 1));
    const red = await baglan(k, "eren", jeton);
    assert.deepEqual(cikanlar(red), RET_GECERSIZ);
    assert.ok(k.depo.jetonBul(ozetle(jeton)), "jeton depoda kalir");

    b.istemciKopar();
    await bosalt();
    const yeni = await baglan(k, "eren", jeton);
    assert.deepEqual(cikanlar(yeni), [{ v: PROTOKOL_SURUMU, type: "kopru_welcome", rol: "eren" }]);
    assert.equal(yeni.kapandi, false);
  });

  it("ilk baglanti kopunca baska jetonla ayni kapsam kabul edilir", async () => {
    const k = await kur();
    const kapsam = eren("ana", 1);
    const ilk = await yetkiliBaglan(k, kapsam);
    const ikinci = await baglan(k, "eren", k.sunucu.jetonUret(kapsam));
    assert.equal(ikinci.kapandi, true);
    ilk.b.istemciKopar();
    await bosalt();
    const ucuncu = await baglan(k, "eren", k.sunucu.jetonUret(kapsam));
    assert.equal(cikanlar(ucuncu)[0]?.type, "kopru_welcome");
  });

  it("jeton_kullanimda reddi isleyiciye ulasmaz, gunluge duz jeton girmez", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    const kapsam = eren("ana", 1);
    await yetkiliBaglan(k, kapsam);
    const j2 = k.sunucu.jetonUret(kapsam);
    const b2 = await baglan(k, "eren", j2);
    gonder(b2, istek("i9", "projeler", {}));
    await bosalt();
    assert.equal(m.cagrilar.length, 0);
    assert.equal(JSON.stringify(k.gunluk.girdiler).includes(j2), false);
  });

  it("ayni nesil, farkli sohbet: iki ayri baglanti birlikte kabul edilir", async () => {
    const k = await kur();
    const a = await yetkiliBaglan(k, eren("sohbet-a", 1));
    const b = await yetkiliBaglan(k, eren("sohbet-b", 1));
    assert.equal(a.b.kapandi, false);
    assert.equal(b.b.kapandi, false);
  });

  it("ayni sohbet, farkli nesil: iki ayri baglanti birlikte kabul edilir", async () => {
    const k = await kur();
    const a = await yetkiliBaglan(k, eren("ana", 1));
    const b = await yetkiliBaglan(k, eren("ana", 2));
    assert.equal(a.b.kapandi, false);
    assert.equal(b.b.kapandi, false);
  });

  it("jetonlariIptalEt yalniz tam kapsamin (sohbet_id + nesil) baglantisini kapatir", async () => {
    const a = asili();
    const m = isleyicilerKur({ oturumlar: a.isleyici });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const hedef = await yetkiliBaglan(k, eren("sohbet-a", 1));
    const digerSohbet = await yetkiliBaglan(k, eren("sohbet-b", 1));
    const digerNesil = await yetkiliBaglan(k, eren("sohbet-a", 2));
    gonder(hedef.b, istek("i1", "oturumlar", {}));
    gonder(digerSohbet.b, istek("i1", "oturumlar", {}));
    await bosalt();

    k.sunucu.jetonlariIptalEt(eren("sohbet-a", 1));
    await bosalt();
    assert.equal(hedef.b.kapandi, true);
    assert.equal(a.sinyaller[0]!.reason, "baglanti_koptu");
    assert.equal(digerSohbet.b.kapandi, false);
    assert.equal(digerNesil.b.kapandi, false);
    assert.equal(a.sinyaller[1]!.aborted, false);
    assert.equal(k.depo.jetonBul(ozetle(hedef.jeton)), null);
    assert.ok(k.depo.jetonBul(ozetle(digerSohbet.jeton)));
    assert.ok(k.depo.jetonBul(ozetle(digerNesil.jeton)));
  });
});

describe("kopru-sunucu: erenJetonlariniSil (dilim 2)", () => {
  it("butun eren jetonlarini siler, sayiyi doner; eski jetonla baglanti reddedilir", async () => {
    const k = await kur();
    const j1 = k.sunucu.jetonUret(eren("ana", 1));
    const j2 = k.sunucu.jetonUret(eren("sohbet-a", 3));
    const j3 = k.sunucu.jetonUret(eren("sohbet-a", 3));
    assert.equal(k.sunucu.erenJetonlariniSil(), 3);
    for (const j of [j1, j2, j3]) {
      assert.equal(k.depo.jetonBul(ozetle(j)), null);
      const b = await baglan(k, "eren", j);
      assert.deepEqual(cikanlar(b), RET_GECERSIZ);
    }
    assert.equal(k.sunucu.erenJetonlariniSil(), 0);
  });

  it("acik eren baglantilarini kapatir, surenlere baglanti_koptu verir", async () => {
    const a = asili();
    const m = isleyicilerKur({ oturumlar: a.isleyici });
    const k = await kur({ isleyiciler: m.isleyiciler });
    const e1 = await yetkiliBaglan(k, eren("ana", 1));
    const e2 = await yetkiliBaglan(k, eren("sohbet-a", 2));
    gonder(e1.b, istek("i1", "oturumlar", {}));
    gonder(e2.b, istek("i1", "oturumlar", {}));
    await bosalt();
    assert.equal(a.sinyaller.length, 2);

    k.sunucu.erenJetonlariniSil();
    await bosalt();
    assert.equal(e1.b.kapandi, true);
    assert.equal(e2.b.kapandi, true);
    for (const s of a.sinyaller) {
      assert.equal(s.aborted, true);
      assert.equal(s.reason, "baglanti_koptu");
    }
  });

  it("soru ve telefon baglantilari ile jetonlari kalir", async () => {
    const m = isleyicilerKur();
    const k = await kur({ isleyiciler: m.isleyiciler });
    await yetkiliBaglan(k, eren("ana", 1));
    const soru = await yetkiliBaglan(k, KAPSAM_SORU);
    const tel = await yetkiliBaglan(k, KAPSAM_TELEFON);
    k.sunucu.erenJetonlariniSil();
    await bosalt();
    assert.equal(soru.b.kapandi, false);
    assert.equal(tel.b.kapandi, false);
    assert.ok(k.depo.jetonBul(ozetle(soru.jeton)));
    assert.ok(k.depo.jetonBul(ozetle(tel.jeton)));

    gonder(soru.b, istek("i1", "soru_bekle", GIRDI.soru_bekle));
    gonder(tel.b, istek("i1", "foreground", {}));
    await bosalt();
    assert.equal(m.cagrilar.length, 2);
    const yeni = await baglan(k, "soru", soru.jeton);
    assert.equal(cikanlar(yeni)[0]?.type, "kopru_welcome");
  });

  it("silmeden sonra uretilen yeni eren jetonu kabul edilir", async () => {
    const k = await kur();
    k.sunucu.erenJetonlariniSil();
    const { b } = await yetkiliBaglan(k, eren("ana", 2));
    assert.equal(b.kapandi, false);
  });

  it("soru rolunde ikinci eszamanli baglanti kurali yok", async () => {
    const k = await kur();
    const a = await yetkiliBaglan(k, KAPSAM_SORU);
    const b = await yetkiliBaglan(k, KAPSAM_SORU);
    assert.equal(a.b.kapandi, false);
    assert.equal(b.b.kapandi, false);
  });

  it("gunluge duz jeton girmez", async () => {
    const k = await kur();
    const j = k.sunucu.jetonUret(eren("ana", 1));
    await baglan(k, "eren", j);
    k.sunucu.erenJetonlariniSil();
    await bosalt();
    assert.equal(JSON.stringify(k.gunluk.girdiler).includes(j), false);
  });
});
