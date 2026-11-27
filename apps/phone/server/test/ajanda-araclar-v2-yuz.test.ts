/**
 * v3 araç yüzü kapalı (`aracV3` verilmez ya da false; ayar `ajanda_arac_v3`, varsayılan kapalı):
 * `ajanda-araclar.ts` girdiyi v2 şemasıyla denetler ve her çıktıyı v2 yüzüne indirir. Ölçütler:
 * - araçla v3 alanlı kayıt doğmaz (telefon sohbeti ve PC oturumu), hiçbir şey yazılmaz;
 * - v2 girdisinin çıktısı v2 şemasından geçer ve açık yüzün çıktısının `ajandaAracCiktisiV2` halidir;
 * - v3 telefonun kanaldan (`islemUygula`) yazdığı v3 alanlı kayıt depoda saklanır, listede v2 görünümüyle
 *   (v3 alanları, ek sayısı, konum yok) çıkar; araçla güncellenince de eşe birleşince de v3 alanları kalır;
 *   boru satırı v2 şemasından geçer, model metninde v3 alanı yoktur;
 * - eş taslak ve varsayılan hatırlatma kuralı (9b85b09) kapalıyken de doğru.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  AJANDA_ARACLARI,
  AJANDA_ARACLARI_V2,
  AJANDA_BORU_ADI,
  PC_KANCA_ARACLARI,
  PROTOKOL_SURUMU,
  type AjandaFiili,
  type AjandaIslem,
  type AjandaKaydi,
  AjandaKaydi as AjandaKaydiSemasi,
  ajandaAracCiktisiV2,
  ajandaKopruAsagiCoz,
  ajandaMcpSonucu,
} from "@eren/protocol";
import { ajandaKopruSunucuKur } from "../src/ajanda-kopru-sunucu.ts";
import { ajandaKur } from "../src/ajanda.ts";
import { servisKur } from "../src/ana.ts";
import { ayarKur } from "../src/ayar.ts";
import { depoAc } from "../src/depo.ts";
import type { CihazYonetimliDepo } from "../src/depo.ts";
import type { AjandaKopruBaglami, AjandaTurBaglami, Veriyolu } from "../src/sozlesme.ts";
import { sahteBoru, sahteDunya, sahteGunluk, sahteRastgele, sahteTakvim, sahteZaman } from "./sahte.ts";

// 2026-11-25 14:30 Europe/Istanbul.
const T0 = 1_795_606_200_000;
const DILIM = "Europe/Istanbul";
const BAGLAM: AjandaKopruBaglami = { rol: "ana_oturum", sohbet_id: "ana", nesil: 3 };
const MESAJ_ANI = { tarih: "2026-11-25", saat: "14:30", saat_dilimi: DILIM };
const DAYANAK = { tarih: "2026-11-25", saat: "14:30" };
const CIHAZ = "cihaz_ajanda01";
const OTURUM = "3f1c2a9e-7b4d-4c1a-9e2f-0a1b2c3d4e5f";
const KONUM = { enlem_e6: 41_012_345, boylam_e6: 28_976_543, yaricap_m: 150 };
const EK = { ek_id: "ek_1", mime: "image/jpeg", bayt: 54_321, genislik: 800, yukseklik: 600, ozet: "cd".repeat(32), olusturma_ms: 5 };

const insanTuru = (insan_metni = "yarın 3'te dişçi"): AjandaTurBaglami => ({
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

type Sonuc = { ok: true; deger: unknown; pc_karar?: string } | { ok: false; code: string };

/** `aracV3`: `undefined` ayarın verilmediği hal (varsayılan kapalı). */
const kur = (aracV3?: boolean) => {
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
    ...(aracV3 === undefined ? {} : { aracV3 }),
  });
  ajanda.baslat();
  const ham = async (fiil: AjandaFiili, girdi: unknown, baglam: AjandaKopruBaglami = BAGLAM): Promise<Sonuc> =>
    (ajanda.araclar[fiil] as (g: unknown, b: AjandaKopruBaglami, s: AbortSignal) => Promise<Sonuc>)(girdi, baglam, new AbortController().signal);
  /** Başarılı çağrı; çıktı seçilen yüzün katı şemasından geçer. */
  const cagir = async (fiil: AjandaFiili, girdi: unknown, baglam?: AjandaKopruBaglami): Promise<Record<string, unknown>> => {
    const s = await ham(fiil, girdi, baglam);
    assert.ok(s.ok, `boru hatası: ${s.ok ? "" : s.code}`);
    (aracV3 === true ? AJANDA_ARACLARI : AJANDA_ARACLARI_V2)[fiil].cikti.parse(s.deger);
    return s.deger as Record<string, unknown>;
  };
  const kayit = (id: string): AjandaKaydi => {
    const k = depo.ajandaKaydiGetir(id);
    assert.ok(k !== null);
    return AjandaKaydiSemasi.parse(k);
  };
  let no = 0;
  /** Telefonun kanal işlemi (`/ajanda`, v3 telefon): ayardan etkilenmez. */
  const islem = (i: AjandaIslem) => {
    const s = ajanda.islemUygula(CIHAZ, `i_${++no}`, i);
    assert.equal(s.ok, true, JSON.stringify(s));
    return s;
  };
  return { zaman, gunluk, depo, ajanda, durum, ham, cagir, kayit, islem };
};

const kimlik = (c: Record<string, unknown>): string => (c.kayit as { kayit_id: string }).kayit_id;

const DISCI = {
  tur: "randevu",
  baslik: "Dişçi",
  zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", ifade: "yarın 3'te" },
  dayanak: DAYANAK,
};

/** v3 telefonun kanaldan yazdığı kayıt: bütün v3 alanları, elle (konum ve ekler dahil). */
const v3TelefonKaydi = (o: ReturnType<typeof kur>, kayit_id = "k_tel") =>
  o.islem({
    islem: "ekle",
    kayit_id,
    tur: "gorev",
    baslik: "Kart okut",
    zaman: { kesinlik: "gun", tarih: "2026-11-30", saat_dilimi: DILIM },
    hatirlatmalar: [],
    girdi_yolu: "elle",
    simge: "is",
    bolge: "iş yeri",
    bolge_konumu: KONUM,
    varis: { cikista: true },
    baglantilar: [{ url: "https://ornek.com/kart", baslik: "Kart" }],
    ekler: [EK, { ...EK, ek_id: "ek_2" }],
  });

const V3_ADLARI = ["simge", "bolge", "bolge_konumu", "varis", "baglantilar", "ekler", "ek_sayisi", "bolgeler", "bolge_yeni", "kural"];
const v3Yok = (metin: string, ad: string) => {
  for (const s of [...V3_ADLARI.map((a) => `"${a}"`), "iş yeri", "ornek.com", String(KONUM.enlem_e6), EK.ozet]) {
    assert.equal(metin.includes(s), false, `${ad}: ${s}`);
  }
};
const metinV3Yok = (metin: string, ad: string) => {
  for (const s of ["simge=", "bolge=", "varis=", "baglanti1", "ek_sayisi=", "bolgeler:", "iş yeri", "ornek.com", "konumu"]) {
    assert.equal(metin.includes(s), false, `${ad}: ${s}`);
  }
};

describe("ajanda araçları, v3 yüzü kapalı: girdi", () => {
  it("varsayılan kapalı: v3 alanlı girdi işleyiciye geçmez (ic_hata), hiçbir şey yazılmaz; telefon ve PC", async () => {
    for (const aracV3 of [undefined, false] as const) {
      const o = kur(aracV3);
      const pc = { rol: "pc_oturumu", baglanti_id: "pcb_1", oturum_id: OTURUM } as const;
      for (const baglam of [BAGLAM, pc] as AjandaKopruBaglami[]) {
        for (const [fiil, girdi] of [
          ["ajanda_ekle", { tur: "gorev", baslik: "Süt al", bolge: "market", varis: {} }],
          ["ajanda_ekle", { ...DISCI, simge: "saglik" }],
          ["ajanda_ekle", { ...DISCI, baglantilar: [{ url: "https://ornek.com" }] }],
          ["ajanda_guncelle", { kayit_id: "k_x", degisiklik: { bolge: "market", varis: {} } }],
          ["ajanda_listele", { bolge: "market" }],
        ] as const) {
          const s = await o.ham(fiil, girdi, baglam);
          assert.deepEqual(s, { ok: false, code: "ic_hata" }, `${baglam.rol} ${fiil}`);
        }
      }
      assert.equal(o.depo.ajandaKayitlari({}).length, 0);
      assert.ok(o.gunluk.bul("arac_girdisi_gecersiz").length >= 10);
    }
  });

  it("açıkken aynı girdi geçer (bugünkü v3 davranışı)", async () => {
    const o = kur(true);
    const c = await o.cagir("ajanda_ekle", { tur: "gorev", baslik: "Süt al", bolge: "market", varis: {} });
    assert.equal(c.sonuc, "eklendi");
    assert.equal(c.bolge_yeni, true);
    assert.equal(o.kayit(kimlik(c)).bolge, "market");
  });
});

describe("ajanda araçları, v3 yüzü kapalı: çıktı", () => {
  it("v2 akışı: kapalının çıktısı açığınkinin v2 indirgemesi, bayt bayt (ekleme, eş, güncelleme, liste, ret)", async () => {
    const adimlar: [AjandaFiili, unknown, AjandaTurBaglami][] = [
      ["ajanda_listele", {}, insanTuru()],
      ["ajanda_ekle", { ...DISCI, hatirlatmalar: undefined }, sentetikTur()],
      ["ajanda_ekle", DISCI, insanTuru()],
      ["ajanda_ekle", DISCI, insanTuru()],
      ["ajanda_guncelle", { kayit_id: "@0", degisiklik: { durum: "tamam" } }, insanTuru()],
      ["ajanda_guncelle", { kayit_id: "@0", degisiklik: { durum: "tamam" } }, insanTuru()],
      ["ajanda_guncelle", { kayit_id: "@0", dayanak: { tarih: "2026-11-24", saat: "10:00" }, degisiklik: { zaman: { kesinlik: "gun", tarih: "2026-11-27" } } }, insanTuru()],
      ["ajanda_listele", { durumlar: ["acik", "tamam"] }, insanTuru()],
    ];
    const yurut = async (aracV3: boolean) => {
      const o = kur(aracV3);
      const ciktilar: unknown[] = [];
      let ilk: string | undefined;
      for (const [fiil, girdi, tur] of adimlar) {
        o.durum.tur = tur;
        const g = JSON.parse(JSON.stringify(girdi).replace('"@0"', JSON.stringify(ilk ?? "k_yok"))) as unknown;
        const c = await o.cagir(fiil, g);
        if (ilk === undefined && c.kayit !== undefined) ilk = kimlik(c);
        ciktilar.push(c);
      }
      return ciktilar;
    };
    const kapali = await yurut(false);
    const acikC = await yurut(true);
    assert.equal(kapali.length, adimlar.length);
    for (const [i, [fiil]] of adimlar.entries()) {
      // Boru baytları: sınırın şemasından geçmiş hal (alan sırası şemanınki).
      const v2 = AJANDA_ARACLARI_V2[fiil].cikti;
      const beklenen = v2.parse(ajandaAracCiktisiV2({ fiil, cikti: acikC[i] } as never).cikti);
      assert.equal(JSON.stringify(v2.parse(kapali[i])), JSON.stringify(beklenen), `${i} ${fiil}`);
    }
    assert.deepEqual(
      kapali.map((c) => (c as { sonuc?: string }).sonuc ?? "liste"),
      ["liste", "eklendi", "onaylandi", "zaten_var", "guncellendi", "degismedi", "ret", "liste"],
    );
  });

  it("varsayılan hatırlatma kuralı (9b85b09) kapalıyken: verilmezse varsayılan (saatlide 1 saat önce, saatsiz günde gün hatırlatması), verilen [] hiç", async () => {
    const o = kur(false);
    const saatli = await o.cagir("ajanda_ekle", DISCI);
    assert.deepEqual(o.kayit(kimlik(saatli)).hatirlatmalar, [{ tur: "once", dk: 60 }]);
    const gun = await o.cagir("ajanda_ekle", { tur: "gorev", baslik: "Fatura", zaman: { kesinlik: "gun", tarih: "2026-11-27" }, dayanak: DAYANAK });
    assert.deepEqual(o.kayit(kimlik(gun)).hatirlatmalar, [{ tur: "once", dk: 60 }]);
    assert.ok((gun.kayit as { hatirlatma: { gun_hatirlatmasi?: unknown } }).hatirlatma.gun_hatirlatmasi !== undefined, "gün hatırlatması");
    const bos = await o.cagir("ajanda_ekle", { tur: "not", baslik: "Not", hatirlatmalar: [] });
    assert.deepEqual(o.kayit(kimlik(bos)).hatirlatmalar, []);
    // Varsayılan elle_alanlar'a girmez.
    assert.deepEqual(o.kayit(kimlik(saatli)).elle_alanlar, ["tur", "baslik", "zaman"]);
  });

  it("eş taslak kapalıyken: aynı sohbetin sentetik taslağını insanın eklemesi onaylar ve alanlarını taşır", async () => {
    const o = kur(false);
    o.durum.tur = sentetikTur();
    const t = await o.cagir("ajanda_ekle", { ...DISCI, aciklama: "taslağın notu" });
    assert.equal(o.kayit(kimlik(t)).taslak, true);
    o.durum.tur = insanTuru();
    const c = await o.cagir("ajanda_ekle", DISCI);
    assert.equal(c.sonuc, "onaylandi");
    assert.equal(kimlik(c), kimlik(t));
    const k = o.kayit(kimlik(c));
    assert.equal(k.taslak, false);
    assert.equal(k.aciklama, "taslağın notu");
    assert.deepEqual(k.hatirlatmalar, [{ tur: "once", dk: 60 }]);
  });
});

describe("ajanda araçları, v3 yüzü kapalı: v3 telefonun kaydı", () => {
  it("kanal v3 alanlarını saklar; liste v2 görünümüyle (v3 alanı, ek sayısı, konum yok); güncelleme ve eş birleşmesi v3 alanlarına dokunmaz", async () => {
    const o = kur(false);
    v3TelefonKaydi(o);
    const depoda = o.kayit("k_tel");
    assert.equal(depoda.bolge, "iş yeri");
    assert.deepEqual(depoda.bolge_konumu, KONUM);
    assert.equal(depoda.ekler?.length, 2);

    const liste = await o.cagir("ajanda_listele", {});
    const k = (liste.kayitlar as Record<string, unknown>[])[0]!;
    // v2 görünümü: kaydın v3 alansız hali, alan alan ve sırasıyla.
    const { simge: _s, bolge: _b, bolge_konumu: _bk, varis: _v, baglantilar: _bg, ekler: _e, ...v2 } = depoda;
    assert.equal(JSON.stringify(k), JSON.stringify({ ...v2, elle_alanlar: ["tur", "baslik", "zaman", "hatirlatmalar"] }));
    assert.equal("bolgeler" in liste, false);
    v3Yok(JSON.stringify(liste), "liste");
    metinV3Yok(ajandaMcpSonucu({ fiil: "ajanda_listele", cikti: liste } as never, () => "c".repeat(32)).content[0].text, "liste metni");
    // Açık yüzde aynı kayıt v3 alanlarıyla görünür (karşılaştırma).
    const ac = kur(true);
    v3TelefonKaydi(ac);
    const acikListe = await ac.cagir("ajanda_listele", {});
    assert.equal((acikListe.kayitlar as Record<string, unknown>[])[0]!.bolge, "iş yeri");
    assert.deepEqual(acikListe.bolgeler, ["iş yeri"]);

    // Araçla güncelleme (v2 alanı): v3 alanları kayıtta kalır, çıktı özeti varis taşımaz.
    const g = await o.cagir("ajanda_guncelle", { kayit_id: "k_tel", degisiklik: { baslik: "Kart okut (yeni)" } });
    assert.equal(g.sonuc, "guncellendi");
    assert.equal("varis" in (g.kayit as object), false);
    assert.equal("bolge_yeni" in g, false);
    const sonra = o.kayit("k_tel");
    assert.equal(sonra.baslik, "Kart okut (yeni)");
    for (const a of ["simge", "bolge", "bolge_konumu", "varis", "baglantilar", "ekler"] as const) {
      assert.deepEqual(sonra[a], depoda[a], `${a} korundu`);
    }
    v3Yok(JSON.stringify(g), "güncelleme");
    metinV3Yok(ajandaMcpSonucu({ fiil: "ajanda_guncelle", cikti: g } as never, () => "c".repeat(32)).content[0].text, "güncelleme metni");
    // Durum değişikliği de.
    const d = await o.cagir("ajanda_guncelle", { kayit_id: "k_tel", degisiklik: { durum: "tamam" } });
    assert.equal(d.sonuc, "guncellendi");
    assert.equal(o.kayit("k_tel").bolge, "iş yeri");
    assert.equal(o.depo.ajandaKayitlari({}).length, 1);
  });

  it("boru sınırı (ajanda-kopru-sunucu, kapalı): welcome arac_v3 taşımaz; her yanıt v2 şemasından geçer, v3 alanı ve konum satırda yok", async () => {
    const o = kur(false);
    const boru = sahteBoru();
    const sunucu = ajandaKopruSunucuKur({
      boru,
      depo: o.depo,
      rastgele: sahteRastgele(77),
      anahtar: { sabitZamanEsit: (a: string, b: string) => a === b },
      zamanlayici: o.zaman.zamanlayici,
      gunluk: o.gunluk,
    });
    await sunucu.baslat(o.ajanda.araclar);
    const jeton = sunucu.jetonUret({ rol: "ana_oturum", sohbet_id: "ana", nesil: 3 });
    const b = boru.baglan(AJANDA_BORU_ADI);
    const bosalt = async () => {
      for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r));
    };
    b.satirGonder(JSON.stringify({ v: PROTOKOL_SURUMU, type: "kopru_hello", rol: "ana_oturum", jeton }));
    await bosalt();
    assert.equal(b.yazilanlar[0], `{"v":${PROTOKOL_SURUMU},"type":"kopru_welcome","rol":"ana_oturum"}`);
    v3TelefonKaydi(o);
    const istekler: [AjandaFiili, unknown][] = [
      ["ajanda_listele", {}],
      ["ajanda_ekle", { tur: "gorev", baslik: "Kart okut", zaman: { kesinlik: "gun", tarih: "2026-11-30" }, dayanak: DAYANAK }],
      ["ajanda_guncelle", { kayit_id: "k_tel", degisiklik: { durum: "tamam" } }],
      ["ajanda_listele", { durumlar: ["acik", "tamam"] }],
    ];
    for (const [i, [fiil, girdi]] of istekler.entries()) {
      b.satirGonder(JSON.stringify({ v: PROTOKOL_SURUMU, type: "istek", istek_id: `i${i}`, fiil, girdi }));
      await bosalt();
      const satir = b.yazilanlar.at(-1)!;
      v3Yok(satir, `boru ${i} ${fiil}`);
      const c = ajandaKopruAsagiCoz(satir);
      assert.ok(c.ok && c.mesaj.type === "yanit" && c.mesaj.ok === true, satir.slice(0, 200));
      AJANDA_ARACLARI_V2[fiil].cikti.parse((c.mesaj as { sonuc: unknown }).sonuc);
    }
    // Kanal kaydı v3 alanlarıyla duruyor (telefona giden `kayit` çerçevesi depodan kurulur).
    assert.equal(o.kayit("k_tel").bolge, "iş yeri");
    assert.equal(o.kayit("k_tel").durum, "tamam");
    // Süzgeci atlayan (v3 alanlı) çıktı kapalı sınırda ic_hata olur.
    const kotu = { ...o.ajanda.araclar, ajanda_listele: async () => ({ ok: true, deger: { mesaj_ani: MESAJ_ANI, kayitlar: [], toplam: 0, bolgeler: ["iş yeri"] } }) };
    await sunucu.kapat();
    const boru2 = sahteBoru();
    const s2 = ajandaKopruSunucuKur({
      boru: boru2,
      depo: o.depo,
      rastgele: sahteRastgele(79),
      anahtar: { sabitZamanEsit: (a: string, b: string) => a === b },
      zamanlayici: o.zaman.zamanlayici,
      gunluk: o.gunluk,
    });
    await s2.baslat(kotu as never);
    const j2 = s2.jetonUret({ rol: "ana_oturum", sohbet_id: "ana", nesil: 4 });
    const b2 = boru2.baglan(AJANDA_BORU_ADI);
    b2.satirGonder(JSON.stringify({ v: PROTOKOL_SURUMU, type: "kopru_hello", rol: "ana_oturum", jeton: j2 }));
    await bosalt();
    b2.satirGonder(JSON.stringify({ v: PROTOKOL_SURUMU, type: "istek", istek_id: "x1", fiil: "ajanda_listele", girdi: {} }));
    await bosalt();
    assert.equal(b2.yazilanlar.at(-1), `{"v":${PROTOKOL_SURUMU},"type":"yanit","istek_id":"x1","ok":false,"code":"ic_hata"}`);
    await s2.kapat();
  });

  it("PC oturumu da kapalı yüzde: ekleme v2, liste v2 görünümü, karar döner", async () => {
    const o = kur(false);
    v3TelefonKaydi(o);
    const arac_cagri_id = "toolu_v2pc";
    PC_KANCA_ARACLARI.pc_arac.cikti.parse(
      o.ajanda.pcKanca.pc_arac(PC_KANCA_ARACLARI.pc_arac.girdi.parse({ oturum_id: OTURUM, arac_cagri_id, alt_agent: false, etkilesimsiz: false, istem_id: "istem-1" })),
    );
    const pc = { rol: "pc_oturumu", baglanti_id: "pcb_1", arac_cagri_id, oturum_id: OTURUM } as const;
    const s = await o.ham("ajanda_ekle", DISCI, pc);
    assert.ok(s.ok);
    assert.equal(s.pc_karar, "insan");
    AJANDA_ARACLARI_V2.ajanda_ekle.cikti.parse(s.deger);
    const l = await o.ham("ajanda_listele", {}, { rol: "pc_oturumu", baglanti_id: "pcb_1", oturum_id: OTURUM });
    assert.ok(l.ok);
    AJANDA_ARACLARI_V2.ajanda_listele.cikti.parse(l.deger);
    v3Yok(JSON.stringify(l.deger), "PC liste");
  });
});

describe("ayar → servis: ajanda_arac_v3 (giris'in yolu: ayarKur → servisKur)", () => {
  const YEREL = "C:\\ornek\\Yerel";
  const CLAUDE_EXE = "C:\\ornek\\bin\\claude.exe";

  /** Ayar dosyasıyla servisi kurar, ajanda borusuna `ana_oturum` olarak bağlanır; ilk satır (welcome) ve günlük. */
  /** `iste`: köprü hello'da `arac_v3` ister (bugünkü köprü); yanlışsa v3 öncesi köprü. */
  const kurVeKarsilan = async (yerel: Record<string, unknown>, iste = true) => {
    const d = sahteDunya({ baslangicMs: T0, servisPid: 4100 });
    d.dosya.yaz(CLAUDE_EXE, "");
    d.dosya.yaz(`${YEREL}\\eren-kit\\ayar.local.json`, JSON.stringify({ claude_exe: CLAUDE_EXE, ...yerel }));
    const ayar = await ayarKur({
      dosya: d.dosya,
      ortam: { LOCALAPPDATA: YEREL, USERPROFILE: "C:\\ornek\\Kullanici", PATH: "C:\\ornek\\bin" },
      execPath: "C:\\ornek\\node.exe",
      baslangicMs: T0 - 5_000,
    });
    const servis = servisKur({ dunya: d.dunya, ayar, depoYolu: ":memory:", ajanda: { sistemDilimi: () => DILIM }, ajandaAracV3: ayar.ajandaAracV3 });
    await servis.baslat();
    try {
      const istek = d.boru.istek(AJANDA_BORU_ADI);
      assert.ok(istek !== null, "ajanda borusu dinlenmiyor");
      const gelen: string[] = [];
      let dinleyici: ((s: string) => void) | null = null;
      istek.baglanti({
        satirYaz: (s) => void gelen.push(s),
        kapat: () => {},
        satirDinle: (f) => void (dinleyici = f),
        kapanisDinle: () => {},
      });
      const jeton = servis.ajandaKopru!.jetonUret({ rol: "ana_oturum", sohbet_id: "ana", nesil: 1 });
      dinleyici!(JSON.stringify({ v: PROTOKOL_SURUMU, type: "kopru_hello", rol: "ana_oturum", jeton, ...(iste ? { arac_v3: true } : {}) }));
      for (let i = 0; i < 8 && gelen.length === 0; i++) await new Promise<void>((r) => setImmediate(r));
      const satirlar = d.kayit.satirlar.map((x) => JSON.parse(x) as Record<string, unknown>);
      const yuz = satirlar.filter((x) => x["modul"] === "ana" && x["olay"] === "ajanda_arac_yuzu").map((x) => x["arac_v3"]);
      return { ayar, welcome: gelen[0], yuz };
    } finally {
      await servis.kapat();
    }
  };

  it("ayar yoksa kapalı: welcome bugünkü bayt; true ile açık: arac_v3; açılış günlüğü yüzü söyler", async () => {
    const kapali = await kurVeKarsilan({});
    assert.equal(kapali.ayar.ajandaAracV3, false);
    assert.equal(kapali.welcome, `{"v":${PROTOKOL_SURUMU},"type":"kopru_welcome","rol":"ana_oturum"}`);
    assert.deepEqual(kapali.yuz, [false]);
    const acikS = await kurVeKarsilan({ ajanda_arac_v3: true });
    assert.equal(acikS.welcome, `{"v":${PROTOKOL_SURUMU},"type":"kopru_welcome","rol":"ana_oturum","arac_v3":true}`);
    assert.deepEqual(acikS.yuz, [true]);
    // v3 öncesi köprü (hello'da istemez) açık serviste de alansız karşılama alır: katı şeması çözer.
    const eskiKopru = await kurVeKarsilan({ ajanda_arac_v3: true }, false);
    assert.equal(eskiKopru.welcome, `{"v":${PROTOKOL_SURUMU},"type":"kopru_welcome","rol":"ana_oturum"}`);
    const yanlis = await kurVeKarsilan({ ajanda_arac_v3: false });
    assert.equal(yanlis.welcome, `{"v":${PROTOKOL_SURUMU},"type":"kopru_welcome","rol":"ana_oturum"}`);
  });
});
