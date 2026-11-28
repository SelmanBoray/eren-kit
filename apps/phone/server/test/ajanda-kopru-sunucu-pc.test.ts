/**
 * Ajanda borusunun PC rolleri (`docs/AJANDA.md` "PC oturumları"): `pc_oturumu` (MCP köprüsü) ve
 * `pc_kanca` (Claude Code'un araç öncesi kancası) PC anahtarıyla bağlanır; anahtar her istekte yeniden denetlenir.
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
import { ajandaKur } from "../src/ajanda.ts";
import { pcDefteriKur } from "../src/ajanda-pc.ts";
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
import { sahteBoru, sahteGunluk, sahteRastgele, sahteTakvim, sahteZaman } from "./sahte.ts";
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
/** `pc_arac` girdisi (araç öncesi kanca tasdiki). */
const TASDIK = (arac_cagri_id: string, ek: Record<string, unknown> = {}) => ({ oturum_id: OTURUM, arac_cagri_id, alt_agent: false, etkilesimsiz: false, ...ek });

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
  const pcKarar: { deger: string | null } = { deger: "tasdik_yok" };
  const nesne: Record<string, unknown> = {};
  for (const fiil of AJANDA_FIILLERI) {
    nesne[fiil] = async (girdi: unknown, baglam: AjandaKopruBaglami) => {
      cagrilar.push({ fiil, girdi, baglam });
      // Ajanda modülü PC çağrısında defterin kararını da döner (`pc_karar`); `kararsiz` sözleşme bozukluğunu dener.
      if (baglam.rol !== "pc_oturumu" || pcKarar.deger === null) return { ok: true, deger: LISTE };
      return { ok: true, deger: LISTE, pc_karar: pcKarar.deger };
    };
  }
  const kancalar: Array<{ fiil: string; girdi: unknown }> = [];
  const pcKanca: PcKancaIsleyicileri = {
    pc_arac: (g) => (kancalar.push({ fiil: "pc_arac", girdi: g }), {}),
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
  return { boru, depo, gunluk, zaman, sunucu, cagrilar, kancalar, pcKarar };
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

  it("pcKanca verilmeden başlatılan sunucu PC rollerini rol_fiil_izinsiz ile reddeder (yetkisiz değil: köprü yetkisizi katı şemanın reddi sayıp hello merdiveninden iner); neden günlükte pc_kapali", async () => {
    const k = await kur({ pcKanca: null });
    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    for (const rol of ["pc_oturumu", "pc_kanca"]) {
      const b = await baglan(k, rol);
      assert.deepEqual(cikanlar(b), [RET("rol_fiil_izinsiz")], rol);
      // PC reddi gibi kapanış köprüye bırakılır (ret satırı düşmesin); en geç 2 sn sonra servis kapatır.
      assert.equal(b.kapandi, false, rol);
    }
    // Zengin hello da (bugünkü köprü) aynı kodu alır: alanla ilgili değildir.
    const zengin = k.boru.baglan(AJANDA_BORU_ADI);
    gonder(zengin, { ...hello("pc_oturumu", PC_JETON), surec_id: "3060", arac_v3: true, uyarlayici: "codex" });
    await bosalt();
    assert.deepEqual(cikanlar(zengin), [RET("rol_fiil_izinsiz")]);
    assert.deepEqual(
      k.gunluk.bul("el_sikisma_ret").map((g) => g.alanlar),
      ["pc_oturumu", "pc_kanca", "pc_oturumu"].map((rol) => ({ code: "rol_fiil_izinsiz", neden: "pc_kapali", rol })),
    );
    // Şemadan geçmeyen hello yine yetkisiz (katı şemanın reddi; köprünün indiği tek ret).
    const bozuk = k.boru.baglan(AJANDA_BORU_ADI);
    gonder(bozuk, { ...hello("pc_oturumu", PC_JETON), bilinmeyen: true });
    await bosalt();
    assert.deepEqual(cikanlar(bozuk), [RET("yetkisiz")]);
  });

  it("aynı anahtarla çok bağlantı açılır (çok oturum), sayısı sınırlıdır; sınırda geçici ret", async () => {
    const k = await kur();
    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    const acikBaglantilar: SahteBoruBaglantisi[] = [];
    for (let i = 0; i < AJANDA_PC_SINIRLARI.BAGLANTI_ADET; i++) acikBaglantilar.push(await baglan(k, "pc_oturumu"));
    for (const b of acikBaglantilar) assert.deepEqual(cikanlar(b), [WELCOME("pc_oturumu")]);
    assert.deepEqual(cikanlar(await baglan(k, "pc_oturumu")), [RET("ic_hata")]);
    acikBaglantilar[0]!.istemciKopar();
    await bosalt();
    assert.deepEqual(cikanlar(await baglan(k, "pc_oturumu")), [WELCOME("pc_oturumu")]);
  });

  it("köprü sınırı dolu olsa da kanca el sıkışır ve tasdik işlenir (sınırlar ayrı)", async () => {
    const k = await kur();
    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    for (let i = 0; i < AJANDA_PC_SINIRLARI.BAGLANTI_ADET; i++) await baglan(k, "pc_oturumu");
    assert.deepEqual(cikanlar(await baglan(k, "pc_oturumu")), [RET("ic_hata")], "köprü sınırı doldu");
    const kanca = await baglan(k, "pc_kanca");
    assert.deepEqual(cikanlar(kanca), [WELCOME("pc_kanca")]);
    gonder(kanca, istek("i1", "pc_arac", TASDIK("toolu_01")));
    await bosalt();
    assert.equal(k.kancalar.length, 1);
  });

  it("kanca bağlantıları kendi sınırıyla sayılır; sınırda ret nedeni ayrıdır; takılan kanca bağlantısı servisçe kapatılır", async () => {
    const k = await kur();
    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    const kancalar: SahteBoruBaglantisi[] = [];
    for (let i = 0; i < AJANDA_PC_SINIRLARI.KANCA_BAGLANTI_ADET; i++) kancalar.push(await baglan(k, "pc_kanca"));
    for (const b of kancalar) assert.deepEqual(cikanlar(b), [WELCOME("pc_kanca")]);
    assert.deepEqual(cikanlar(await baglan(k, "pc_kanca")), [RET("ic_hata")]);
    const ret = k.gunluk.girdiler.filter((g) => g.olay === "el_sikisma_ret").at(-1);
    assert.deepEqual(ret?.alanlar, { code: "ic_hata", neden: "pc_kanca_siniri", rol: "pc_kanca" });
    // Kanca sınırı köprüyü etkilemez.
    assert.deepEqual(cikanlar(await baglan(k, "pc_oturumu")), [WELCOME("pc_oturumu")]);
    // Kancanın bütün işi KANCA_SURESI_MS'tir: el sıkışmadan +1 sn sonra servis kapatır, sınır boşalır.
    k.zaman.ilerlet(AJANDA_PC_SINIRLARI.KANCA_SURESI_MS + 999);
    await bosalt();
    assert.equal(kancalar[0]!.kapandi, false);
    k.zaman.ilerlet(1);
    await bosalt();
    for (const b of kancalar) assert.equal(b.kapandi, true);
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
    gonder(kanca, istek("i3", "pc_arac", TASDIK("toolu_09")));
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

  it("pc_oturumu yanıtı çıktı + tur kararıdır (PcAracSonucu); karar yoksa ic_hata; ana_oturum yanıtı yalnız çıktı", async () => {
    const k = await kur();
    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    const b = await baglan(k, "pc_oturumu");
    gonder(b, istek("i1", "ajanda_listele", {}));
    await bosalt();
    assert.deepEqual(cikanlar(b).at(-1), { v: PROTOKOL_SURUMU, type: "yanit", istek_id: "i1", ok: true, sonuc: { cikti: LISTE, karar: "tasdik_yok" } });
    k.pcKarar.deger = null;
    gonder(b, istek("i2", "ajanda_listele", {}));
    await bosalt();
    assert.deepEqual(cikanlar(b).at(-1), { v: PROTOKOL_SURUMU, type: "yanit", istek_id: "i2", ok: false, code: "ic_hata" });
    k.pcKarar.deger = "insanmis";
    gonder(b, istek("i3", "ajanda_listele", {}));
    await bosalt();
    assert.deepEqual(cikanlar(b).at(-1), { v: PROTOKOL_SURUMU, type: "yanit", istek_id: "i3", ok: false, code: "ic_hata" });
    const ana = await baglan(k, "ana_oturum", k.sunucu.jetonUret(KAPSAM));
    gonder(ana, istek("i4", "ajanda_listele", {}));
    await bosalt();
    assert.deepEqual(cikanlar(ana).at(-1), { v: PROTOKOL_SURUMU, type: "yanit", istek_id: "i4", ok: true, sonuc: LISTE });
  });

  it("pc_oturumu kanca fiilini çağıramaz (rol_fiil_izinsiz, bağlantı açık); pc_kanca araç çağıramaz (kapanır)", async () => {
    const k = await kur();
    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    const kopru = await baglan(k, "pc_oturumu");
    gonder(kopru, istek("i1", "pc_arac", TASDIK("toolu_01")));
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

  it("pc_kanca: araç öncesi tasdik işleyiciye gider, yanıt şemadan geçer; istem/tur sonu çerçevesi bağlantıyı kapatır; atan işleyici ic_hata", async () => {
    const k = await kur();
    k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    const kanca = await baglan(k, "pc_kanca");
    gonder(kanca, istek("i1", "pc_arac", TASDIK("toolu_01", { alt_agent: true, istem_id: "p-1" })));
    gonder(kanca, istek("i2", "pc_arac", TASDIK("toolu_02", { etkilesimsiz: true })));
    // Normalize çerçeve (H1) de aynı borudan geçer; eski çerçeve (yukarıdakiler) de geçmeye devam eder.
    const NORMAL = {
      uyarlayici: { ad: "claude-code", surum: 1 },
      cagri_id: "toolu_03",
      oturum_id: OTURUM,
      aktor: "ana",
      etkilesim: "etkilesimli",
      surec_id: "3060",
    };
    gonder(kanca, istek("i3", "pc_arac", NORMAL));
    await bosalt();
    assert.deepEqual(k.kancalar, [
      { fiil: "pc_arac", girdi: TASDIK("toolu_01", { alt_agent: true, istem_id: "p-1" }) },
      { fiil: "pc_arac", girdi: TASDIK("toolu_02", { etkilesimsiz: true }) },
      { fiil: "pc_arac", girdi: NORMAL },
    ]);
    const yanitlar = cikanlar(kanca).filter((m) => m.type === "yanit");
    assert.deepEqual(
      yanitlar.map((m) => (m.type === "yanit" ? [m.istek_id, m.ok, m.sonuc] : null)),
      [
        ["i1", true, {}],
        ["i2", true, {}],
        ["i3", true, {}],
      ],
    );
    // Yalın yol: istem metni servise gelemez (eski kancanın çerçevesi geçersizdir, bağlantı kapanır).
    gonder(kanca, istek("i3", "pc_istem", { oturum_id: OTURUM, kaynak: "user", metin: "yarın 3'te dişçi" }));
    await bosalt();
    assert.equal(kanca.kapandi, true);
    assert.equal(k.kancalar.length, 3);
    assert.ok(!JSON.stringify(k.gunluk.girdiler).includes("dişçi"), "istem metni günlükte");

    const atan = await kur({
      pcKanca: {
        pc_arac: () => {
          throw new Error("x");
        },
      },
    });
    atan.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    const b = await baglan(atan, "pc_kanca");
    gonder(b, istek("i1", "pc_arac", TASDIK("toolu_01")));
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
    gonder(b, istek("i2", "pc_arac", TASDIK("toolu_02")));
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

/**
 * T5 boru sunucusu düzeyinde, gerçek defterle ve gerçek kapanış yollarıyla (`docs/HARNESS.md` 4.2): yeni köprü
 * hello'da harness sürecini bildirir (`surec_id`), servis onu bağlantıya yazar ve her isteğin bağlamına
 * (`kopru_surec_id`) geçirir; tasdik yalnız sürecine eşit köprüce tüketilir. Eski köprü (hello'da süreç yok)
 * bağlantı başına ilk görüşle bağlanır. Bağlantılar arası durum yoktur: hiçbir kapanış yolu, kapanış
 * bildiriminin hiç gelmemesi (yetim köprü) ya da sıra yarışı bir pencereyi kilitleyemez. Köprü portu
 * sunucunun kendi kapatmasını geri yansıtmaz (bildirim `temizle`'den gelir); uzak uç kapanışı portun kapanış olayıdır.
 */
describe("ajanda borusu, PC: T5 süreç eşitliği ve kilit yok (gerçek defter, gerçek kapanış)", () => {
  const A1 = OTURUM;
  const A2 = "6e7f8091-2b3c-4d5e-9f0a-b1c2d3e4f506";
  const A3 = "7f8091a2-3c4d-4e5f-8a1b-c2d3e4f50617";
  const B = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
  const P = "3060";
  const Q = "4170";
  const YENI_JETON = "q".repeat(43);
  /** Köprü türleri: yeni köprü hello'da ebeveynini bildirir, eski köprü bildirmez. */
  const TURLER = ["yeni", "eski"] as const;
  type Tur = (typeof TURLER)[number];

  const defterli = async () => {
    const boru = sahteBoru();
    const gunluk = sahteGunluk();
    const zaman = sahteZaman();
    // Defterin saati iki yöne gider (saatin geri gitmesi); boru sunucusunun zamanlayıcısı sahte saatte.
    let an = zaman.simdi();
    const saat = { simdiMs: () => an, ilerlet: (ms: number) => void (an += ms) };
    const depo = depoKur({ yol: ":memory:", saat: zaman.saat, gunluk: sahteGunluk() });
    acilanlar.push(depo);
    depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    const pc = pcDefteriKur({ takvim: sahteTakvim(IST), saat, rastgele: sahteRastgele(5), gunluk });
    // Gözlemci: bildirimleri sayar, defterin kendi işleyicisine aynen iletir.
    const kapananlar: string[] = [];
    const kanca: PcKancaIsleyicileri = {
      pc_arac: (g) => pc.kanca.pc_arac(g),
      kopruKapandi: (id) => {
        kapananlar.push(id);
        pc.kanca.kopruKapandi?.(id);
      },
    };
    const baglamlar: AjandaKopruBaglami[] = [];
    const nesne: Record<string, unknown> = {};
    for (const fiil of AJANDA_FIILLERI) {
      nesne[fiil] = async (_g: unknown, baglam: AjandaKopruBaglami) => {
        baglamlar.push(baglam);
        return baglam.rol === "pc_oturumu" ? { ok: true, deger: LISTE, pc_karar: pc.tur(baglam, an).karar } : { ok: true, deger: LISTE };
      };
    }
    const sunucu = ajandaKopruSunucuKur({
      boru,
      depo,
      rastgele: sahteRastgele(77),
      anahtar: { sabitZamanEsit: (a: string, b: string) => a === b },
      zamanlayici: zaman.zamanlayici,
      gunluk,
    });
    await sunucu.baslat(nesne as unknown as AjandaFiilIsleyiciler, kanca);

    let no = 0;
    /** Claude Code'un araç öncesi kancası: kendi bağlantısı, tek tasdik, sonra kapanır. `surec` CLAUDE_PID. */
    const tasdik = async (oturum: string, surec: string, jeton = PC_JETON): Promise<string> => {
      const cagri_id = `toolu_k${++no}`;
      const b = boru.baglan(AJANDA_BORU_ADI);
      gonder(b, hello("pc_kanca", jeton));
      const girdi = { uyarlayici: { ad: "claude-code", surum: 1 }, cagri_id, oturum_id: oturum, istem_id: "istem-1", aktor: "ana", etkilesim: "etkilesimli", surec_id: surec };
      gonder(b, istek(`k${no}`, "pc_arac", girdi));
      await bosalt();
      assert.deepEqual(cikanlar(b).at(-1), { v: PROTOKOL_SURUMU, type: "yanit", istek_id: `k${no}`, ok: true, sonuc: {} });
      b.istemciKopar();
      await bosalt();
      return cagri_id;
    };

    /**
     * Köprü bağlantısı: `tur` yeni ise hello `surec_id: ebeveyn` taşır. `kopar`: uzak uç kapandı; sunucunun
     * `kapat`'ı yalnız işaretler (geri yansıtmaz).
     */
    const kopru = async (tur: Tur, ebeveyn: string, jeton = PC_JETON, ek: Record<string, unknown> = {}) => {
      const satirlar: Array<(s: string) => void> = [];
      const kapanislar: Array<() => void> = [];
      const yazilanlar: string[] = [];
      const d = { kapandi: false, yazmaBozuk: false };
      const sunucuIstegi = boru.istek(AJANDA_BORU_ADI);
      assert.ok(sunucuIstegi !== null);
      sunucuIstegi.baglanti({
        satirYaz: (s) => {
          if (d.yazmaBozuk) throw new Error("EPIPE");
          if (!d.kapandi) yazilanlar.push(s);
        },
        kapat: () => {
          d.kapandi = true;
        },
        satirDinle: (f) => void satirlar.push(f),
        kapanisDinle: (f) => void kapanislar.push(f),
      });
      const gonderHam = (s: string): void => {
        if (!d.kapandi) for (const f of [...satirlar]) f(s);
      };
      const cik = (): AjandaKopruAsagi[] =>
        yazilanlar.map((s) => {
          const c = ajandaKopruAsagiCoz(s);
          assert.ok(c.ok, s);
          return c.mesaj;
        });
      gonderHam(JSON.stringify({ ...hello("pc_oturumu", jeton), ...(tur === "yeni" ? { surec_id: ebeveyn } : {}), ...ek }));
      await bosalt();
      assert.deepEqual(cik(), [WELCOME("pc_oturumu")]);
      const el = gunluk.girdiler.filter((g) => g.olay === "el_sikisma" && g.alanlar?.["rol"] === "pc_oturumu").at(-1);
      return {
        baglanti_id: String(el?.alanlar?.["baglanti_id"]),
        d,
        gonder: (m: unknown) => gonderHam(JSON.stringify(m)),
        gonderHam,
        cikanlar: cik,
        kopar: () => {
          d.kapandi = true;
          for (const f of [...kapanislar]) f();
        },
      };
    };
    type Kopru = Awaited<ReturnType<typeof kopru>>;

    let istekNo = 0;
    /** Köprünün çağrısı (`oturum`: köprünün bildirdiği; yoksa bildirmez): defterin kararı. */
    const cagri = async (u: Kopru, cagri_id: string, oturum?: string): Promise<string> => {
      const istek_id = `i${++istekNo}`;
      u.gonder(istek(istek_id, "ajanda_listele", {}, { cagri: { arac_cagri_id: cagri_id, ...(oturum === undefined ? {} : { oturum_id: oturum }) } }));
      await bosalt();
      const y = u.cikanlar().at(-1) as { type: string; istek_id: string; ok: boolean; sonuc?: { karar: string } } | undefined;
      assert.ok(y?.type === "yanit" && y.istek_id === istek_id && y.ok, JSON.stringify(y));
      return y.sonuc?.karar ?? "?";
    };
    const olay = (ad: string) => gunluk.girdiler.filter((g) => g.olay === ad).map((g) => g.alanlar);
    return { boru, gunluk, zaman, saat, depo, sunucu, kapananlar, baglamlar, tasdik, kopru, cagri, olay };
  };
  type Kopru = Awaited<ReturnType<Awaited<ReturnType<typeof defterli>>["kopru"]>>;

  it("hello'nun surec_id'si bağlantıya yazılır, her isteğin bağlamına geçer (kopru_surec_id); eski köprüde yok; cagri'ya konamaz", async () => {
    const k = await defterli();
    const yeni = await k.kopru("yeni", P);
    const eski = await k.kopru("eski", P);
    await k.cagri(yeni, "toolu_x1", A1);
    await k.cagri(eski, "toolu_x2", A1);
    assert.deepEqual(k.baglamlar.map((b) => ({ ...b, baglanti_id: "?" })), [
      { rol: "pc_oturumu", baglanti_id: "?", arac_cagri_id: "toolu_x1", oturum_id: A1, kopru_surec_id: P },
      { rol: "pc_oturumu", baglanti_id: "?", arac_cagri_id: "toolu_x2", oturum_id: A1 },
    ]);
    // Süreç yalnız hello'dadır: `cagri`'daki süreç alanı çerçeveyi bozar (katı `AjandaPcCagri`), bağlantı kapanır.
    yeni.gonder(istek("iz", "ajanda_listele", {}, { cagri: { arac_cagri_id: "toolu_x3", surec_id: Q } }));
    await bosalt();
    assert.equal(yeni.d.kapandi, true);
    assert.equal(k.baglamlar.length, 2);
    // Öbür roller hello'da süreç taşıyamaz: el sıkışma reddedilir.
    for (const [rol, jeton] of [["pc_kanca", PC_JETON], ["ana_oturum", k.sunucu.jetonUret(KAPSAM)]] as const) {
      const b = k.boru.baglan(AJANDA_BORU_ADI);
      gonder(b, { ...hello(rol, jeton), surec_id: P });
      await bosalt();
      assert.deepEqual(cikanlar(b), [RET("yetkisiz")], rol);
    }
    // Geçersiz biçimli süreç de reddedilir.
    const bozuk = k.boru.baglan(AJANDA_BORU_ADI);
    gonder(bozuk, { ...hello("pc_oturumu", PC_JETON), surec_id: "12 34" });
    await bosalt();
    assert.deepEqual(cikanlar(bozuk), [RET("yetkisiz")]);
  });

  it("hello'nun uyarlayici'si bağlantıya yazılır, her isteğin bağlamına geçer; kapalı listede olmayan değer bağlantıyı düşürmez, bağlama ve günlüğe girmez; tur kararını değiştirmez", async () => {
    const k = await defterli();
    const adlar = [undefined, "claude-code", "codex", "gemini-cli", ""] as const;
    const kararlar: string[] = [];
    for (const [i, ad] of adlar.entries()) {
      const u = await k.kopru("yeni", P, PC_JETON, ad === undefined ? {} : { uyarlayici: ad });
      // Aynı tasdik her köprüde aynı kararı verir: alan karara girmez (Codex'i taslakta tutan, köprünün çağrı kimliğini okumamasıdır).
      kararlar.push(await k.cagri(u, await k.tasdik(A1, P), A1));
      kararlar.push(await k.cagri(u, `toolu_yok${i}`, A1));
    }
    assert.deepEqual(kararlar, adlar.flatMap(() => ["insan", "tasdik_yok"]));
    const pcBaglamlari = k.baglamlar.filter((b) => b.rol === "pc_oturumu");
    assert.deepEqual(
      pcBaglamlari.map((b) => ("uyarlayici" in b ? b.uyarlayici : "(yok)")),
      ["(yok)", "(yok)", "claude-code", "claude-code", "codex", "codex", "(yok)", "(yok)", "(yok)", "(yok)"],
    );
    assert.equal(JSON.stringify(k.gunluk.girdiler).includes("gemini"), false, "bilinmeyen değer günlükte");
    // Uzun ya da dizge olmayan değer şemadan geçmez (yetkisiz: köprü bir basamak iner); öbür roller taşıyamaz.
    for (const kotu of ["a".repeat(65), 1, null]) {
      const b = k.boru.baglan(AJANDA_BORU_ADI);
      gonder(b, { ...hello("pc_oturumu", PC_JETON), uyarlayici: kotu });
      await bosalt();
      assert.deepEqual(cikanlar(b), [RET("yetkisiz")], String(kotu));
    }
    for (const [rol, jeton] of [["pc_kanca", PC_JETON], ["ana_oturum", k.sunucu.jetonUret(KAPSAM)]] as const) {
      const b = k.boru.baglan(AJANDA_BORU_ADI);
      gonder(b, { ...hello(rol, jeton), uyarlayici: "codex" });
      await bosalt();
      assert.deepEqual(cikanlar(b), [RET("yetkisiz")], rol);
    }
  });

  for (const tur of TURLER) {
    it(`A'nın tasdikini B tüketemez: B'nin çağrısı taslak, tasdik sahibine kalır, B'nin kapanışı A'yı etkilemez; ${tur} köprü`, async () => {
      const k = await defterli();
      const a = await k.kopru(tur, P);
      const b = await k.kopru(tur, Q);
      assert.equal(await k.cagri(a, await k.tasdik(A1, P), A1), "insan");
      assert.equal(await k.cagri(b, await k.tasdik(B, Q), B), "insan");
      const id = await k.tasdik(A3, P);
      assert.equal(await k.cagri(b, id, B), "tasdik_yok", "B'nin köprüsü A'nın tasdikini tüketemez");
      assert.deepEqual(k.olay("pc_surec_uyusmuyor").map((x) => x?.["kopru_surec"]), [tur === "yeni" ? "bildirildi" : "ilk_gorus"]);
      b.kopar();
      await bosalt();
      assert.equal(await k.cagri(a, id, A1), "insan", "tasdik sahibine kaldı");
    });

    it(`kilit yok, /clear ve tek süreçte birden çok oturum: iki köprü aynı süreçte defalarca /clear; ${tur} köprü`, async () => {
      const k = await defterli();
      const a = await k.kopru(tur, P);
      const b = await k.kopru(tur, P);
      // B'nin ilk çağrısı /clear'dan sonra (kancanın oturumu köprününkinden farklı).
      for (const [ao, bo] of [[A1, A3], [A2, B], [A3, A2], [B, A1]] as const) {
        assert.equal(await k.cagri(a, await k.tasdik(ao, P), A1), "insan", `A ${ao}`);
        assert.equal(await k.cagri(b, await k.tasdik(bo, P), B), "insan", `B ${bo}`);
      }
    });

    it(`kilit yok, --resume / --continue ile ikinci pencere + /clear: iki süreç ayrı, ikisi de insan; ${tur} köprü`, async () => {
      const k = await defterli();
      const p1 = await k.kopru(tur, P);
      assert.equal(await k.cagri(p1, await k.tasdik(A1, P), A1), "insan");
      // İkinci pencere aynı oturumu sürdürür (--resume: köprü A1 bildirir; --continue: geçici A2), sonra /clear (A3).
      for (const kopruOturumu of [A1, A2]) {
        const p2 = await k.kopru(tur, Q);
        for (const o of [A1, A3, A3]) assert.equal(await k.cagri(p2, await k.tasdik(o, Q), kopruOturumu), "insan", `pencere 2, ${o}`);
        assert.equal(await k.cagri(p2, await k.tasdik(A1, P), kopruOturumu), "tasdik_yok", "pencere 1'in tasdiki");
      }
      for (const o of [A1, A3]) assert.equal(await k.cagri(p1, await k.tasdik(o, P), A1), "insan", `pencere 1, ${o}`);
    });

    it(`kilit yok, boruya yeniden bağlanma ve saatin geri gitmesi; oturum kimliği gelmemesi; ${tur} köprü`, async () => {
      const k = await defterli();
      const ilk = await k.kopru(tur, P);
      assert.equal(await k.cagri(ilk, await k.tasdik(A1, P)), "insan", "oturum kimliği yok");
      // Aynı köprü süreci yeniden bağlandı (anahtar yenilendi ya da servis kısa koptu); eski bağlantı sonra kapanır.
      const yeni = await k.kopru(tur, P);
      assert.equal(await k.cagri(yeni, await k.tasdik(A2, P), "pck_rastgele"), "insan");
      ilk.kopar();
      await bosalt();
      assert.equal(await k.cagri(yeni, await k.tasdik(A2, P), "pck_rastgele"), "insan");
      const id = await k.tasdik(A3, P);
      k.saat.ilerlet(-5 * 60_000);
      assert.equal(await k.cagri(yeni, id), "tasdik_yok", "tasdik çağrıdan sonraki bir ana ait: güvenli yön");
      for (let i = 0; i < 2; i++) assert.equal(await k.cagri(yeni, await k.tasdik(A3, P)), "insan", `saat geri gittikten sonra ${i}`);
    });
  }

  /** Köprünün kapanış yolları (/mcp, köprü çökmesi, servisin kapatması). */
  const KAPANISLAR: ReadonlyArray<{ ad: string; kapat(u: Kopru): void; yetim?: true }> = [
    { ad: "uzak uç kapandı (köprü çöktü ya da /mcp)", kapat: (u) => u.kopar() },
    { ad: "sunucu kapattı (ikinci hello)", kapat: (u) => u.gonder(hello("pc_oturumu", PC_JETON)) },
    { ad: "sunucu kapattı (geçersiz çerçeve)", kapat: (u) => u.gonderHam("{bozuk") },
    {
      ad: "hata (yanıt yazılamadı)",
      kapat: (u) => {
        u.d.yazmaBozuk = true;
        u.gonder(istek("iy", "ajanda_listele", {}));
      },
    },
    { ad: "kapanış hiç gelmedi (yetim köprü)", kapat: () => {}, yetim: true },
  ];

  for (const tur of TURLER) {
    for (const ks of KAPANISLAR) {
      it(`kilit yok, /mcp (köprü yenilenir) → çağrısız /clear; ${ks.ad}: yeni köprünün ilk çağrısı kapanıştan önce de sonra da insan; ${tur} köprü`, async () => {
        const k = await defterli();
        const eski = await k.kopru(tur, P);
        assert.equal(await k.cagri(eski, await k.tasdik(A1, P), A1), "insan");
        const yeni = await k.kopru(tur, P);
        assert.equal(await k.cagri(yeni, await k.tasdik(A3, P), A2), "insan", "kapanıştan önce");
        const bekleyen = await k.tasdik(A3, P);
        ks.kapat(eski);
        await bosalt();
        const yetim = ks.yetim === true;
        assert.equal(eski.d.kapandi, !yetim);
        assert.deepEqual(k.kapananlar, yetim ? [] : [eski.baglanti_id], "tek bildirim, yalnız eski köprü");
        assert.equal(await k.cagri(yeni, bekleyen, A2), "insan", "kapanış bekleyen tasdiki silmez");
        for (let i = 0; i < 3; i++) assert.equal(await k.cagri(yeni, await k.tasdik(A3, P), A2), "insan", `çağrı ${i}`);
        // Kaldırılan olaylar hiç yazılmaz.
        for (const ad of ["pc_oturum_uyusmuyor", "pc_bag_birakildi", "pc_bag_katildi", "pc_surec_uyusmuyor"]) assert.equal(k.olay(ad).length, 0, ad);
      });
    }
  }

  it("süre dolması: anahtarı düşen köprüyü servis PC_RET_KAPANIS_MS sonra kapatır; yeni anahtarla yeni köprü insan", async () => {
    const k = await defterli();
    const eski = await k.kopru("yeni", P);
    assert.equal(await k.cagri(eski, await k.tasdik(A1, P), "pck_bir"), "insan");
    k.depo.ajandaPcAnahtariYaz(ozetle(YENI_JETON), 2);
    eski.gonder(istek("id", "ajanda_listele", {}));
    await bosalt();
    assert.deepEqual(eski.cikanlar().at(-1), { v: PROTOKOL_SURUMU, type: "yanit", istek_id: "id", ok: false, code: "jeton_gecersiz" });
    assert.deepEqual(k.kapananlar, [], "kapanış bekleniyor");
    k.zaman.ilerlet(2_000);
    await bosalt();
    assert.equal(eski.d.kapandi, true);
    assert.deepEqual(k.kapananlar, [eski.baglanti_id]);
    const yeni = await k.kopru("yeni", P, YENI_JETON);
    assert.equal(await k.cagri(yeni, await k.tasdik(A1, P, YENI_JETON), "pck_iki"), "insan");
  });

  it("servisin toplu kapatması (jetonlariniSil, kapat): her köprü bir kez bildirilir; yeniden bağlanan köprü insan", async () => {
    const k = await defterli();
    const a = await k.kopru("yeni", P);
    const b = await k.kopru("eski", Q);
    assert.equal(await k.cagri(a, await k.tasdik(A1, P), "pck_a"), "insan");
    assert.equal(await k.cagri(b, await k.tasdik(B, Q), "pck_b"), "insan");
    k.sunucu.jetonlariniSil();
    await bosalt();
    assert.deepEqual([...k.kapananlar].sort(), [a.baglanti_id, b.baglanti_id].sort());
    const a2 = await k.kopru("eski", P);
    assert.equal(await k.cagri(a2, await k.tasdik(A1, P), "pck_a2"), "insan");
    await k.sunucu.kapat();
    assert.equal(k.kapananlar.length, 3);
    assert.equal(k.kapananlar.at(-1), a2.baglanti_id);
  });

  it("sunucunun kapatmasını port geri yansıtsa da (sahte boru) bildirim bir kez; kanca ve ana_oturum kapanışı bildirilmez", async () => {
    const k = await defterli();
    await k.tasdik(A1, P);
    const ana = k.boru.baglan(AJANDA_BORU_ADI);
    gonder(ana, hello("ana_oturum", k.sunucu.jetonUret(KAPSAM)));
    await bosalt();
    ana.istemciKopar();
    await bosalt();
    assert.deepEqual(k.kapananlar, [], "kanca ve ana_oturum");
    const b = k.boru.baglan(AJANDA_BORU_ADI);
    gonder(b, hello("pc_oturumu", PC_JETON));
    await bosalt();
    gonder(b, hello("pc_oturumu", PC_JETON));
    await bosalt();
    assert.equal(b.kapandi, true);
    b.istemciKopar();
    await bosalt();
    assert.equal(k.kapananlar.length, 1);
  });

  it("kopruKapandi atarsa bağlantı yine temizlenir, sunucu sürer; alanı olmayan (eski) kanca işleyicisi zararsız", async () => {
    const atan: PcKancaIsleyicileri = {
      pc_arac: () => ({}),
      kopruKapandi: () => {
        throw new Error("x");
      },
    };
    const eskiTip: PcKancaIsleyicileri = { pc_arac: () => ({}) };
    for (const pcKanca of [atan, eskiTip]) {
      const k = await kur({ pcKanca });
      k.depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
      for (let i = 0; i < AJANDA_PC_SINIRLARI.BAGLANTI_ADET + 2; i++) {
        const b = await baglan(k, "pc_oturumu");
        assert.deepEqual(cikanlar(b), [WELCOME("pc_oturumu")], "sınır sızmadı");
        b.istemciKopar();
        await bosalt();
      }
      const atti = k.gunluk.girdiler.filter((g) => g.olay === "isleyici_atti");
      assert.equal(atti.length, pcKanca === atan ? AJANDA_PC_SINIRLARI.BAGLANTI_ADET + 2 : 0);
    }
  });

  describe("yarış: eski köprünün kapanışı ile yeni köprünün ilk çağrısı (sıra karara girmez)", () => {
    for (const tur of TURLER) {
      it(`kapanış önce / tasdik kapanıştan önce / çağrı kapanıştan önce: hepsi insan; başka süreç tüketemez; ${tur} köprü`, async () => {
        for (const sira of ["kapanis_once", "tasdik_once", "cagri_once"] as const) {
          const k = await defterli();
          const eski = await k.kopru(tur, P);
          const baskasi = await k.kopru("yeni", Q);
          assert.equal(await k.cagri(eski, await k.tasdik(A1, P), A1), "insan");
          const yeni = await k.kopru(tur, P);
          if (sira === "kapanis_once") eski.kopar();
          const id = await k.tasdik(A3, P);
          if (sira === "tasdik_once") eski.kopar();
          assert.equal(await k.cagri(baskasi, id, B), "tasdik_yok", `${sira}: başka süreç`);
          assert.equal(await k.cagri(yeni, id, A2), "insan", sira);
          if (sira === "cagri_once") eski.kopar();
          await bosalt();
          assert.equal(await k.cagri(yeni, await k.tasdik(A3, P), A2), "insan", `${sira}: sonraki`);
        }
      });
    }
  });
});

// --- K1 servis tarafı: işlemden SONRA düşen yazma "yazılmadı" demez -----------------------------------

describe("ajanda borusu, işlemden sonra düşen yazma (gerçek ajanda modülü, gerçek depo)", () => {
  /**
   * Gerçek `ajandaKur` (araçlar ve PC defteri) + gerçek boru sunucusu. `boz.gunluk`: modülün `arac` günlük olayı
   * (işlemden sonra yazılır) atar; `boz.cikti`: işleyicinin başarı çıktısına sunucunun katı şemasının tanımadığı alan
   * eklenir (işlem bitti, çıktı denetimi düşer). İkisi de işleyicinin `depo.islem`'inden SONRADIR: kayıt depodadır.
   */
  const gercekKur = async () => {
    const zaman = sahteZaman();
    const depo = depoKur({ yol: ":memory:", saat: zaman.saat, gunluk: sahteGunluk() });
    acilanlar.push(depo);
    const boz = { gunluk: false, cikti: false };
    const g = sahteGunluk();
    const ajanda = ajandaKur({
      depo,
      takvim: sahteTakvim("Europe/Istanbul"),
      saat: zaman.saat,
      rastgele: sahteRastgele(5),
      gunluk: {
        ...g,
        bilgi: (modul, olay, alanlar) => {
          if (boz.gunluk && olay === "arac") throw new Error("günlük yazılamadı");
          g.bilgi(modul, olay, alanlar);
        },
      },
      turBaglami: () => null,
    });
    ajanda.baslat();
    const araclar: Record<string, unknown> = {};
    for (const fiil of AJANDA_FIILLERI) {
      const asil = ajanda.araclar[fiil] as unknown as (...a: unknown[]) => Promise<{ ok: boolean; deger?: object }>;
      araclar[fiil] = async (...a: unknown[]) => {
        const s = await asil(...a);
        return boz.cikti && s.ok ? { ...s, deger: { ...s.deger, yeni_alan: 1 } } : s;
      };
    }
    const boru = sahteBoru();
    const sunucuGunlugu = sahteGunluk();
    const sunucu = ajandaKopruSunucuKur({
      boru,
      depo,
      rastgele: sahteRastgele(77),
      anahtar: { sabitZamanEsit: (a: string, b: string) => a === b },
      zamanlayici: zaman.zamanlayici,
      gunluk: sunucuGunlugu,
    });
    await sunucu.baslat(araclar as unknown as AjandaFiilIsleyiciler, ajanda.pcKanca);
    depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    const b = boru.baglan(AJANDA_BORU_ADI);
    gonder(b, hello("pc_oturumu", PC_JETON));
    await bosalt();
    assert.deepEqual(cikanlar(b), [WELCOME("pc_oturumu")]);
    let n = 0;
    const cagir = async (fiil: AjandaFiili, girdi: unknown): Promise<AjandaKopruAsagi> => {
      const istek_id = `i${++n}`;
      gonder(b, istek(istek_id, fiil, girdi));
      await bosalt();
      const y = cikanlar(b).at(-1)!;
      assert.ok(y.type === "yanit" && y.istek_id === istek_id, JSON.stringify(y));
      return y;
    };
    return { depo, boz, b, cagir, sunucuGunlugu };
  };
  const BELIRSIZ = (istek_id: string) => ({ v: PROTOKOL_SURUMU, type: "yanit", istek_id, ok: false, code: "belirsiz" });
  const IC_HATA = (istek_id: string) => ({ v: PROTOKOL_SURUMU, type: "yanit", istek_id, ok: false, code: "ic_hata" });
  const NOT = { tur: "not", baslik: "Süt al" };

  for (const yol of ["gunluk", "cikti"] as const) {
    const ad = yol === "gunluk" ? "işleyici işlemden sonra düştü (arac günlüğü attı)" : "işlem bitti, sunucunun çıktı denetimi düştü";
    it(`${ad}: kayıt depoda, yanıt belirsiz (ic_hata değil: köprü 'yazılmadı' der, model yeniden dener, kayıt çift olur); bağlantı açık`, async () => {
      const k = await gercekKur();
      k.boz[yol] = true;
      assert.deepEqual(await k.cagir("ajanda_ekle", NOT), BELIRSIZ("i1"));
      assert.equal(k.depo.ajandaKayitSayisi(), 1, "kayıt yazıldı");
      const kayit = k.depo.ajandaKayitlari()[0]!;
      assert.deepEqual(await k.cagir("ajanda_guncelle", { kayit_id: kayit.kayit_id, degisiklik: { aciklama: "Yarım litre" } }), BELIRSIZ("i2"));
      assert.equal(k.depo.ajandaKaydiGetir(kayit.kayit_id)?.aciklama, "Yarım litre", "güncelleme yazıldı");
      // Liste hiçbir şey yazmaz: işlem sonrası düşse de "yazılmadı" doğrudur.
      assert.deepEqual(await k.cagir("ajanda_listele", {}), IC_HATA("i3"));
      assert.equal(k.b.kapandi, false);
      // Çerçevede ayrıntı yok (detail modele gitmez, işaret yalnız servis içinde).
      assert.ok(k.b.yazilanlar.every((s) => !s.includes("islem_sonrasi")));
      k.boz[yol] = false;
      const y = await k.cagir("ajanda_listele", {});
      assert.ok(y.type === "yanit" && y.ok);
    });
  }

  it("işlemden önce düşen (v2 yüzünde v3 alanı: bilinmeyen alan) hâlâ ic_hata: hiçbir şey yazılmadı (kesin)", async () => {
    const k = await gercekKur();
    assert.deepEqual(await k.cagir("ajanda_ekle", { ...NOT, bolge: "market" }), IC_HATA("i1"));
    assert.equal(k.depo.ajandaKayitSayisi(), 0);
  });
});
