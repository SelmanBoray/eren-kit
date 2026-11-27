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
 * Köprü kapanışı → PC defteri (`PcKancaIsleyicileri.kopruKapandi`, ajanda-pc `kopruKapandi`): gerçek defter,
 * gerçek kapanış yolları. Kapanış bildirilmezse süreç ölü köprüye bağlı kalır ve servis yeniden başlayana
 * dek her çağrısı taslak olurdu (canlı gerileme: /clear → /mcp → çağrısız /clear). Köprü portu sunucunun
 * kendi kapatmasını geri yansıtmaz (bildirim `temizle`'den gelmeli, portun kapanış olayından değil);
 * uzak uç kapanışı portun kapanış olayıdır.
 */
describe("ajanda borusu, PC: köprü kapanışı defterin T5 bağını bırakır (gerçek defter)", () => {
  const A1 = OTURUM;
  const A2 = "6e7f8091-2b3c-4d5e-9f0a-b1c2d3e4f506";
  const A3 = "7f8091a2-3c4d-4e5f-8a1b-c2d3e4f50617";
  const B = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
  const SUREC = "3060";
  const YENI_JETON = "q".repeat(43);

  const defterli = async () => {
    const boru = sahteBoru();
    const gunluk = sahteGunluk();
    const zaman = sahteZaman();
    const depo = depoKur({ yol: ":memory:", saat: zaman.saat, gunluk: sahteGunluk() });
    acilanlar.push(depo);
    depo.ajandaPcAnahtariYaz(ozetle(PC_JETON), 1);
    const pc = pcDefteriKur({ takvim: sahteTakvim(IST), saat: zaman.saat, rastgele: sahteRastgele(5), gunluk });
    // Gözlemci: bildirimleri sayar, defterin kendi işleyicisine aynen iletir (alanı yoksa bağ bırakılmaz, test düşer).
    const kapananlar: string[] = [];
    const kanca: PcKancaIsleyicileri = {
      pc_arac: (g) => pc.kanca.pc_arac(g),
      kopruKapandi: (id) => {
        kapananlar.push(id);
        pc.kanca.kopruKapandi?.(id);
      },
    };
    const nesne: Record<string, unknown> = {};
    for (const fiil of AJANDA_FIILLERI) {
      nesne[fiil] = async (_g: unknown, baglam: AjandaKopruBaglami) =>
        baglam.rol === "pc_oturumu" ? { ok: true, deger: LISTE, pc_karar: pc.tur(baglam, zaman.simdi()).karar } : { ok: true, deger: LISTE };
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
    /** Claude Code'un araç öncesi kancası: kendi bağlantısı, tek tasdik, sonra kapanır (kanca kapanışı bağa dokunmaz). */
    const tasdik = async (oturum: string, surec?: string, jeton = PC_JETON): Promise<string> => {
      const cagri_id = `toolu_k${++no}`;
      const b = boru.baglan(AJANDA_BORU_ADI);
      gonder(b, hello("pc_kanca", jeton));
      const girdi = {
        uyarlayici: { ad: "claude-code", surum: 1 },
        cagri_id,
        oturum_id: oturum,
        istem_id: "istem-1",
        aktor: "ana",
        etkilesim: "etkilesimli",
        ...(surec === undefined ? {} : { surec_id: surec }),
      };
      gonder(b, istek(`k${no}`, "pc_arac", girdi));
      await bosalt();
      assert.deepEqual(cikanlar(b).at(-1), { v: PROTOKOL_SURUMU, type: "yanit", istek_id: `k${no}`, ok: true, sonuc: {} });
      b.istemciKopar();
      await bosalt();
      return cagri_id;
    };

    /** Köprü bağlantısı. `kopar`: uzak uç kapandı; sunucunun `kapat`'ı yalnız işaretler (geri yansıtmaz). */
    const kopru = async (jeton = PC_JETON) => {
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
      gonderHam(JSON.stringify(hello("pc_oturumu", jeton)));
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
    const cagri = async (u: Kopru, cagri_id: string, oturum: string | undefined): Promise<string> => {
      const istek_id = `i${++istekNo}`;
      u.gonder(istek(istek_id, "ajanda_listele", {}, { cagri: { arac_cagri_id: cagri_id, ...(oturum === undefined ? {} : { oturum_id: oturum }) } }));
      await bosalt();
      const y = u.cikanlar().at(-1) as { type: string; istek_id: string; ok: boolean; sonuc?: { karar: string } } | undefined;
      assert.ok(y?.type === "yanit" && y.istek_id === istek_id && y.ok, JSON.stringify(y));
      return y.sonuc?.karar ?? "?";
    };
    const olay = (ad: string) => gunluk.girdiler.filter((g) => g.olay === ad).map((g) => g.alanlar);
    return { boru, gunluk, zaman, depo, sunucu, kapananlar, tasdik, kopru, cagri, olay };
  };
  type Kopru = Awaited<ReturnType<Awaited<ReturnType<typeof defterli>>["kopru"]>>;

  /** Köprü kimliği değişen yollar: eski köprünün bildirdiği, yenisininki, yeni tasdiklerin oturumu. */
  const KOPRULER: ReadonlyArray<{ ad: string; eski: string | undefined; yeni: string | undefined; oturum: string }> = [
    { ad: "/clear → /mcp → çağrısız /clear (köprü oturum bildirir)", eski: A1, yeni: A2, oturum: A3 },
    { ad: "oturum kimliği gelmedi (pck_bir → pck_iki)", eski: "pck_bir", yeni: "pck_iki", oturum: A1 },
    { ad: "oturum bildirmeyen köprü, boruya yeniden bağlanma (b:<bağlantı>)", eski: undefined, yeni: undefined, oturum: A1 },
  ];
  const KAPANISLAR: ReadonlyArray<{ ad: string; kapat(u: Kopru): void }> = [
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
  ];

  for (const kp of KOPRULER) {
    for (const ks of KAPANISLAR) {
      it(`${kp.ad}; ${ks.ad}: kapanıştan önce yeni köprü taslak, sonra her çağrısı insan`, async () => {
        const k = await defterli();
        const eski = await k.kopru();
        assert.equal(await k.cagri(eski, await k.tasdik(A1, SUREC), kp.eski), "insan");
        const yeni = await k.kopru();
        assert.equal(await k.cagri(yeni, await k.tasdik(kp.oturum, SUREC), kp.yeni), "tasdik_yok", "kapanış gelmeden: süreç eski köprüye bağlı");
        ks.kapat(eski);
        await bosalt();
        assert.equal(eski.d.kapandi, true);
        assert.deepEqual(k.kapananlar, [eski.baglanti_id], "tek bildirim, yalnız eski köprü");
        for (let i = 0; i < 3; i++) assert.equal(await k.cagri(yeni, await k.tasdik(kp.oturum, SUREC), kp.yeni), "insan", `çağrı ${i}`);
        assert.equal(k.olay("pc_bag_birakildi").length, 1);
      });
    }
  }

  it("süre dolması: anahtarı düşen köprüyü servis PC_RET_KAPANIS_MS sonra kapatır; bağ bırakılır, yeni anahtarla yeni köprü insan", async () => {
    const k = await defterli();
    const eski = await k.kopru();
    assert.equal(await k.cagri(eski, await k.tasdik(A1, SUREC), "pck_bir"), "insan");
    k.depo.ajandaPcAnahtariYaz(ozetle(YENI_JETON), 2);
    eski.gonder(istek("id", "ajanda_listele", {}));
    await bosalt();
    assert.deepEqual(eski.cikanlar().at(-1), { v: PROTOKOL_SURUMU, type: "yanit", istek_id: "id", ok: false, code: "jeton_gecersiz" });
    assert.deepEqual(k.kapananlar, [], "kapanış bekleniyor");
    k.zaman.ilerlet(2_000);
    await bosalt();
    assert.equal(eski.d.kapandi, true);
    assert.deepEqual(k.kapananlar, [eski.baglanti_id]);
    const yeni = await k.kopru(YENI_JETON);
    assert.equal(await k.cagri(yeni, await k.tasdik(A1, SUREC, YENI_JETON), "pck_iki"), "insan");
  });

  it("servisin toplu kapatması (jetonlariniSil, kapat): her köprü bir kez bildirilir; yeniden bağlanan köprü insan", async () => {
    const k = await defterli();
    const a = await k.kopru();
    const b = await k.kopru();
    assert.equal(await k.cagri(a, await k.tasdik(A1, "100"), "pck_a"), "insan");
    assert.equal(await k.cagri(b, await k.tasdik(B, "200"), "pck_b"), "insan");
    k.sunucu.jetonlariniSil();
    await bosalt();
    assert.deepEqual([...k.kapananlar].sort(), [a.baglanti_id, b.baglanti_id].sort());
    const a2 = await k.kopru();
    assert.equal(await k.cagri(a2, await k.tasdik(A1, "100"), "pck_a2"), "insan");
    await k.sunucu.kapat();
    assert.equal(k.kapananlar.length, 3);
    assert.equal(k.kapananlar.at(-1), a2.baglanti_id);
  });

  it("sunucunun kapatmasını port geri yansıtsa da (sahte boru) bildirim bir kez; kanca ve ana_oturum kapanışı bildirilmez", async () => {
    const k = await defterli();
    await k.tasdik(A1, SUREC);
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

  it("boruya yeniden bağlanma, aynı köprü kimliği: kapanıştan önce de insan; son bağlantı kapanınca bağ bırakılır", async () => {
    const k = await defterli();
    const eski = await k.kopru();
    assert.equal(await k.cagri(eski, await k.tasdik(A1, SUREC), A1), "insan");
    const yeni = await k.kopru();
    assert.equal(await k.cagri(yeni, await k.tasdik(A2, SUREC), A1), "insan", "aynı köprü kimliği");
    eski.kopar();
    await bosalt();
    assert.equal(k.olay("pc_bag_birakildi").length, 0, "bağ açık bağlantıda");
    assert.equal(await k.cagri(yeni, await k.tasdik(A2, SUREC), A1), "insan");
    yeni.kopar();
    await bosalt();
    assert.equal(k.olay("pc_bag_birakildi").length, 1);
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

  describe("yarış: eski köprünün kapanışı ile yeni köprünün ilk çağrısı", () => {
    it("kapanış önce, tasdik ve çağrı sonra: insan", async () => {
      const k = await defterli();
      const eski = await k.kopru();
      assert.equal(await k.cagri(eski, await k.tasdik(A1, SUREC), A1), "insan");
      const yeni = await k.kopru();
      eski.kopar();
      assert.equal(await k.cagri(yeni, await k.tasdik(A3, SUREC), A2), "insan");
      assert.equal(await k.cagri(yeni, await k.tasdik(A3, SUREC), A2), "insan");
    });

    it("tasdik kapanıştan önce, çağrı sonra (aynı tikte): güvenli yönde taslak (tasdik bağla birlikte silinir); sonraki insan", async () => {
      const k = await defterli();
      const eski = await k.kopru();
      assert.equal(await k.cagri(eski, await k.tasdik(A1, SUREC), A1), "insan");
      const yeni = await k.kopru();
      const id = await k.tasdik(A3, SUREC);
      eski.kopar();
      const karar = await k.cagri(yeni, id, A2);
      assert.ok(karar === "insan" || karar === "tasdik_yok", karar);
      assert.equal(karar, "tasdik_yok", "bugünkü davranış: bekleyen tasdik silinir");
      assert.equal(await k.cagri(yeni, await k.tasdik(A3, SUREC), A2), "insan", "kilitlenmez");
    });

    it("çağrı kapanıştan önce: taslak; kapanışta bekleyen tasdik silinir, başka sürecin köprüsü onu tüketemez; sonraki insan", async () => {
      const k = await defterli();
      const eski = await k.kopru();
      const baskasi = await k.kopru();
      assert.equal(await k.cagri(eski, await k.tasdik(A1, "100"), A1), "insan");
      assert.equal(await k.cagri(baskasi, await k.tasdik(B, "200"), B), "insan");
      const yeni = await k.kopru();
      const id = await k.tasdik(A3, "100");
      assert.equal(await k.cagri(yeni, id, A2), "tasdik_yok");
      eski.kopar();
      await bosalt();
      assert.deepEqual(k.olay("pc_bag_birakildi"), [{ baglanti_id: eski.baglanti_id, adet: 1, tasdik: 1 }]);
      assert.equal(await k.cagri(baskasi, id, B), "tasdik_yok", "A'nın kalan tasdikini B'nin köprüsü alamaz");
      assert.equal(await k.cagri(yeni, id, A2), "tasdik_yok", "silindi");
      assert.equal(await k.cagri(yeni, await k.tasdik(A3, "100"), A2), "insan", "kilitlenmez");
      assert.equal(await k.cagri(baskasi, await k.tasdik(A3, "100"), B), "tasdik_yok", "A artık yeni köprüye bağlı");
      assert.equal(await k.cagri(baskasi, await k.tasdik(B, "200"), B), "insan", "B'nin bağı yerinde");
    });
  });

  it("T5: aynı anda açık iki köprüde A'nın tasdikini B tüketemez; B'nin kapanışı A'nın bağını bırakmaz", async () => {
    const k = await defterli();
    const a = await k.kopru();
    const b = await k.kopru();
    assert.equal(await k.cagri(a, await k.tasdik(A1, "100"), A1), "insan");
    assert.equal(await k.cagri(b, await k.tasdik(B, "200"), B), "insan");
    const id = await k.tasdik(A3, "100");
    assert.equal(await k.cagri(b, id, B), "tasdik_yok", "B'nin köprüsü A'nın tasdikini tüketemez");
    b.kopar();
    await bosalt();
    const c = await k.kopru();
    assert.equal(await k.cagri(c, id, "pck_c"), "tasdik_yok", "A'nın köprüsü açık: bağ yerinde, tasdik silinmedi");
    assert.equal(await k.cagri(a, id, A1), "insan", "tasdik sahibine kaldı");
  });
});
