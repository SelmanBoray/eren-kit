/**
 * Ajanda borusunun PC rolleri (`docs/AJANDA.md` "PC oturumları"): `pc_oturumu` (MCP köprüsü) ve
 * `pc_kanca` (Claude Code kancaları) PC anahtarıyla bağlanır; anahtar her istekte yeniden denetlenir.
 * `ana_oturum` yolu bugünkü gibidir (bağlamı yalnız jetonun kapsamı; `cagri` yok sayılır).
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  AJANDA_BORU_ADI,
  AJANDA_FIILLERI,
  AJANDA_PC_SINIRLARI,
  PROTOKOL_SURUMU,
  ajandaKopruAsagiCoz,
  sha256Hex,
} from "@eren/protocol";
import type { AjandaFiili, AjandaKopruAsagi } from "@eren/protocol";
import { ajandaKopruSunucuKur } from "../src/ajanda-kopru-sunucu.ts";
import { depoKur } from "../src/depo.ts";
import type {
  AjandaFiilIsleyiciler,
  AjandaJetonKapsami,
  AjandaKopruBaglami,
  AjandaKopruSunucu,
  Depo,
  PcKancaIsleyicileri,
} from "../src/sozlesme.ts";
import { sahteBoru, sahteGunluk, sahteRastgele, sahteZaman } from "./sahte.ts";
import type { SahteBoruBaglantisi } from "./sahte.ts";

const acilanlar: Depo[] = [];
afterEach(() => {
  for (const d of acilanlar.splice(0)) d.kapat();
});

const ozetle = (jeton: string): string => sha256Hex(new TextEncoder().encode(jeton));
const PC_JETON = "p".repeat(43);
const IST = "Europe/Istanbul";
const AN = { tarih: "2026-11-25", saat: "14:05", saat_dilimi: IST };
const OTURUM = "3f1c2a9e-7b4d-4c1a-9e2f-0a1b2c3d4e5f";
const KAPSAM: AjandaJetonKapsami = { rol: "ana_oturum", sohbet_id: "ana", nesil: 1 };
const LISTE = { mesaj_ani: AN, kayitlar: [], toplam: 0 };

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
};

const kur = async (sec: { pcKanca?: PcKancaIsleyicileri | null } = {}) => {
  const boru = sahteBoru();
  const gunluk = sahteGunluk();
  const zaman = sahteZaman();
  const depo = depoKur({ yol: ":memory:", saat: zaman.saat, gunluk: sahteGunluk() });
  acilanlar.push(depo);
  const cagrilar: Array<{ fiil: AjandaFiili; girdi: unknown; baglam: AjandaKopruBaglami }> = [];
  const nesne: Record<string, unknown> = {};
  for (const fiil of AJANDA_FIILLERI) {
    nesne[fiil] = async (girdi: unknown, baglam: AjandaKopruBaglami) => {
      cagrilar.push({ fiil, girdi, baglam });
      return { ok: true, deger: LISTE };
    };
  }
  const kancalar: Array<{ fiil: string; girdi: unknown }> = [];
  const pcKanca: PcKancaIsleyicileri = {
    pc_istem: (g) => (kancalar.push({ fiil: "pc_istem", girdi: g }), { mesaj_ani: AN }),
    pc_arac: (g) => (kancalar.push({ fiil: "pc_arac", girdi: g }), {}),
    pc_tur_sonu: (g) => (kancalar.push({ fiil: "pc_tur_sonu", girdi: g }), {}),
  };
  const sunucu: AjandaKopruSunucu = ajandaKopruSunucuKur({
    boru,
    depo,
    rastgele: sahteRastgele(77),
    anahtar: { sabitZamanEsit: (a: string, b: string) => a === b },
    zamanlayici: zaman.zamanlayici,
    gunluk,
  });
  await sunucu.baslat(nesne as unknown as AjandaFiilIsleyiciler, sec.pcKanca === null ? undefined : (sec.pcKanca ?? pcKanca));
  return { boru, depo, gunluk, zaman, sunucu, cagrilar, kancalar };
};
type Kurulum = Awaited<ReturnType<typeof kur>>;

const gonder = (b: SahteBoruBaglantisi, m: unknown): void => b.satirGonder(JSON.stringify(m));
const hello = (rol: string, jeton: string) => ({ v: PROTOKOL_SURUMU, type: "kopru_hello", rol, jeton });
const istek = (istek_id: string, fiil: string, girdi: unknown, ek: Record<string, unknown> = {}) => ({
  v: PROTOKOL_SURUMU,
  type: "istek",
  istek_id,
  fiil,
  girdi,
  ...ek,
});
const cikanlar = (b: SahteBoruBaglantisi): AjandaKopruAsagi[] =>
  b.yazilanlar.map((s) => {
    const c = ajandaKopruAsagiCoz(s);
    assert.ok(c.ok, `giden satır şemaya uymuyor: ${s.slice(0, 120)}`);
    return c.mesaj;
  });
const RET = (code: string) => ({ v: PROTOKOL_SURUMU, type: "kopru_ret", code });
const WELCOME = (rol: string) => ({ v: PROTOKOL_SURUMU, type: "kopru_welcome", rol });

const baglan = async (k: Kurulum, rol: string, jeton = PC_JETON): Promise<SahteBoruBaglantisi> => {
  const b = k.boru.baglan(AJANDA_BORU_ADI);
  gonder(b, hello(rol, jeton));
  await bosalt();
  return b;
};

describe("ajanda borusu, PC rolleri: kimlik", () => {
  it("etkin PC anahtarıyla iki rol de el sıkışır; anahtar yoksa, bilinmiyorsa ya da iptalse jeton_gecersiz", async () => {
    const k = await kur();
    const yok = await baglan(k, "pc_oturumu");
    assert.deepEqual(cikanlar(yok), [RET("jeton_gecersiz")]);
    // Ret yazılır, kapanış köprüye bırakılır (adlı boruda yaz + kapat yanıtı düşürebilir); en geç 2 sn sonra servis kapatır.
    assert.equal(yok.kapandi, false);
    gonder(yok, istek("i0", "ajanda_listele", {}));
    await bosalt();
    assert.equal(k.cagrilar.length, 0, "reddedilen bağlantının isteği işlendi");
    k.zaman.ilerlet(2_000);
    await bosalt();
    assert.equal(yok.kapandi, true);

    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    for (const rol of ["pc_oturumu", "pc_kanca"]) {
      const b = await baglan(k, rol);
      assert.deepEqual(cikanlar(b), [WELCOME(rol)], rol);
      assert.equal(b.kapandi, false);
    }
    assert.deepEqual(cikanlar(await baglan(k, "pc_oturumu", "x".repeat(43))), [RET("jeton_gecersiz")]);

    // Yenilenen anahtar eskisini geçersiz kılar.
    k.depo.ajandaPcAnahtariYaz(ozetle("y".repeat(43)), 2);
    assert.deepEqual(cikanlar(await baglan(k, "pc_oturumu")), [RET("jeton_gecersiz")]);
    assert.deepEqual(cikanlar(await baglan(k, "pc_oturumu", "y".repeat(43))), [WELCOME("pc_oturumu")]);
    assert.ok(!JSON.stringify(k.gunluk.girdiler).includes(PC_JETON), "düz anahtar günlükte");
  });

  it("PC anahtarı ana_oturum jetonu değildir, ana_oturum jetonu PC rolü açmaz", async () => {
    const k = await kur();
    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    assert.deepEqual(cikanlar(await baglan(k, "ana_oturum")), [RET("jeton_gecersiz")]);
    const anaJeton = k.sunucu.jetonUret(KAPSAM);
    assert.deepEqual(cikanlar(await baglan(k, "pc_oturumu", anaJeton)), [RET("jeton_gecersiz")]);
    assert.deepEqual(cikanlar(await baglan(k, "pc_kanca", anaJeton)), [RET("jeton_gecersiz")]);
    assert.deepEqual(cikanlar(await baglan(k, "ana_oturum", anaJeton)), [WELCOME("ana_oturum")]);
  });

  it("pcKanca verilmeden başlatılan sunucu PC rollerini yetkisiz reddeder (PC öncesi davranış)", async () => {
    const k = await kur({ pcKanca: null });
    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    for (const rol of ["pc_oturumu", "pc_kanca"]) assert.deepEqual(cikanlar(await baglan(k, rol)), [RET("yetkisiz")], rol);
  });

  it("aynı anahtarla çok bağlantı açılır (çok oturum), sayısı sınırlıdır; sınırda geçici ret", async () => {
    const k = await kur();
    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    const acikBaglantilar: SahteBoruBaglantisi[] = [];
    for (let i = 0; i < AJANDA_PC_SINIRLARI.BAGLANTI_ADET; i++) acikBaglantilar.push(await baglan(k, "pc_oturumu"));
    for (const b of acikBaglantilar) assert.deepEqual(cikanlar(b), [WELCOME("pc_oturumu")]);
    assert.deepEqual(cikanlar(await baglan(k, "pc_kanca")), [RET("ic_hata")]);
    acikBaglantilar[0]!.istemciKopar();
    await bosalt();
    assert.deepEqual(cikanlar(await baglan(k, "pc_kanca")), [WELCOME("pc_kanca")]);
  });

  it("anahtar iptal edilince açık PC bağlantısının sonraki isteği kopru_ret alır ve bağlantı kapanır", async () => {
    const k = await kur();
    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    const kopru = await baglan(k, "pc_oturumu");
    const kanca = await baglan(k, "pc_kanca");
    gonder(kopru, istek("i1", "ajanda_listele", {}));
    await bosalt();
    assert.equal(k.cagrilar.length, 1);
    assert.equal(k.depo.ajandaPcAnahtarlariniIptalEt(5), 1);
    gonder(kopru, istek("i2", "ajanda_listele", {}));
    gonder(kanca, istek("i3", "pc_tur_sonu", { oturum_id: OTURUM }));
    await bosalt();
    assert.equal(k.cagrilar.length, 1, "iptal edilen anahtarla işleyici çağrıldı");
    assert.equal(k.kancalar.length, 0);
    // İsteğin kendisi `jeton_gecersiz` yanıtı alır (köprü kesin metni verir), bağlantı gecikmeli kapanır.
    const ret = (b: SahteBoruBaglantisi, istek_id: string) => ({ v: PROTOKOL_SURUMU, type: "yanit", istek_id, ok: false, code: "jeton_gecersiz" });
    assert.deepEqual(cikanlar(kopru).at(-1), ret(kopru, "i2"));
    assert.deepEqual(cikanlar(kanca).at(-1), ret(kanca, "i3"));
    gonder(kopru, istek("i4", "ajanda_listele", {}));
    await bosalt();
    assert.deepEqual(cikanlar(kopru).at(-1), ret(kopru, "i4"));
    assert.equal(k.cagrilar.length, 1);
    k.zaman.ilerlet(2_000);
    await bosalt();
    assert.equal(kopru.kapandi, true);
    assert.equal(kanca.kapandi, true);
  });
});

describe("ajanda borusu, PC rolleri: istekler", () => {
  it("pc_oturumu: üç araç, bağlam rol + bağlantı + cagri; bağlam köprünün tur ilanını taşıyamaz", async () => {
    const k = await kur();
    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    const b = await baglan(k, "pc_oturumu");
    gonder(b, istek("i1", "ajanda_listele", {}, { cagri: { arac_cagri_id: "toolu_01", oturum_id: OTURUM } }));
    gonder(b, istek("i2", "ajanda_listele", {}));
    await bosalt();
    assert.equal(k.cagrilar.length, 2);
    const [b1, b2] = k.cagrilar.map((c) => c.baglam);
    assert.equal(b1!.rol, "pc_oturumu");
    assert.deepEqual({ ...b1, baglanti_id: "?" }, { rol: "pc_oturumu", baglanti_id: "?", arac_cagri_id: "toolu_01", oturum_id: OTURUM });
    assert.deepEqual({ ...b2, baglanti_id: "?" }, { rol: "pc_oturumu", baglanti_id: "?" });
    assert.equal((b1 as { baglanti_id: string }).baglanti_id, (b2 as { baglanti_id: string }).baglanti_id);
    // `cagri`'da fazladan alan (ör. tur_kokeni) çerçeveyi geçersiz kılar, bağlantı kapanır.
    gonder(b, istek("i3", "ajanda_listele", {}, { cagri: { tur_kokeni: "insan" } }));
    await bosalt();
    assert.equal(b.kapandi, true);
    assert.equal(k.cagrilar.length, 2);
  });

  it("pc_oturumu kanca fiilini çağıramaz (rol_fiil_izinsiz, bağlantı açık); pc_kanca araç çağıramaz (kapanır)", async () => {
    const k = await kur();
    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    const kopru = await baglan(k, "pc_oturumu");
    gonder(kopru, istek("i1", "pc_arac", { oturum_id: OTURUM, arac_cagri_id: "toolu_01", alt_agent: false }));
    await bosalt();
    const y = cikanlar(kopru).at(-1);
    assert.ok(y?.type === "yanit" && y.ok === false && y.code === "rol_fiil_izinsiz");
    assert.equal(kopru.kapandi, false);
    assert.equal(k.kancalar.length, 0);

    const kanca = await baglan(k, "pc_kanca");
    gonder(kanca, istek("i2", "ajanda_ekle", { tur: "not", baslik: "x" }));
    await bosalt();
    assert.equal(kanca.kapandi, true);
    assert.equal(k.cagrilar.length, 0);
  });

  it("pc_kanca: üç kanca isteği işleyiciye gider, yanıt şemadan geçer; atan işleyici ic_hata", async () => {
    const k = await kur();
    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    const kanca = await baglan(k, "pc_kanca");
    gonder(kanca, istek("i1", "pc_istem", { oturum_id: OTURUM, metin: "yarın 3'te dişçi" }));
    gonder(kanca, istek("i2", "pc_arac", { oturum_id: OTURUM, arac_cagri_id: "toolu_01", alt_agent: true }));
    gonder(kanca, istek("i3", "pc_tur_sonu", { oturum_id: OTURUM }));
    await bosalt();
    assert.deepEqual(
      k.kancalar.map((c) => c.fiil),
      ["pc_istem", "pc_arac", "pc_tur_sonu"],
    );
    const yanitlar = cikanlar(kanca).filter((m) => m.type === "yanit");
    assert.deepEqual(
      yanitlar.map((m) => (m.type === "yanit" ? [m.istek_id, m.ok, m.sonuc] : null)),
      [
        ["i1", true, { mesaj_ani: AN }],
        ["i2", true, {}],
        ["i3", true, {}],
      ],
    );
    assert.ok(!JSON.stringify(k.gunluk.girdiler).includes("dişçi"), "istem metni günlükte");

    const atan = await kur({
      pcKanca: {
        pc_istem: () => {
          throw new Error("x");
        },
        pc_arac: () => ({}),
        pc_tur_sonu: () => ({}),
      },
    });
    atan.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    const b = await baglan(atan, "pc_kanca");
    gonder(b, istek("i1", "pc_istem", { oturum_id: OTURUM, metin: "a" }));
    await bosalt();
    const y = cikanlar(b).at(-1);
    assert.ok(y?.type === "yanit" && y.ok === false && y.code === "ic_hata");
  });

  it("ana_oturum isteğinin cagri'sı yok sayılır: bağlam bugünkü gibi yalnız jetonun kapsamı", async () => {
    const k = await kur();
    const jeton = k.sunucu.jetonUret(KAPSAM);
    const b = await baglan(k, "ana_oturum", jeton);
    gonder(b, istek("i1", "ajanda_listele", {}, { cagri: { arac_cagri_id: "toolu_01", oturum_id: OTURUM } }));
    await bosalt();
    assert.equal(k.cagrilar.length, 1);
    assert.deepEqual(k.cagrilar[0]!.baglam, KAPSAM);
    // Ana oturum kancası yoktur.
    gonder(b, istek("i2", "pc_istem", { oturum_id: OTURUM, metin: "a" }));
    await bosalt();
    const y = cikanlar(b).at(-1);
    assert.ok(y?.type === "yanit" && y.code === "rol_fiil_izinsiz");
    assert.equal(k.kancalar.length, 0);
  });

  it("açılıştaki jetonlariniSil PC anahtarına dokunmaz (anahtar servis ömrüne bağlı değil)", async () => {
    const k = await kur();
    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    k.sunucu.jetonlariniSil();
    assert.equal(k.depo.ajandaPcAnahtariGecerliMi(ozetle(PC_JETON)), true);
    assert.deepEqual(cikanlar(await baglan(k, "pc_oturumu")), [WELCOME("pc_oturumu")]);
  });
});
