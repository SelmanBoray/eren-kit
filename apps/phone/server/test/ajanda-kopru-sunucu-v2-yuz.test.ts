/**
 * Z2: ayar `ajanda_arac_v3` açıkken v2 yüzlü bağlantı (eski köprü ya da düz hello'ya düşmüş köprü) ayar
 * kapalıykenki v2 görünümünü aynen alır; yüzü bağlantı belirler (`bag.v3`), servisin ayarı değil. Ölçütler
 * (gerçek işleyiciler + boru sunucusu):
 * - ayar açık, v2 yüzlü bağlantı, varışlı ve geçmiş hatırlatmalı kayıt: metin "bildirim gelmeyecek" demez,
 *   çıktı ayar kapalıykenkiyle bayt bayt aynıdır (gün hatırlatması notu dahil);
 * - ayar açık, v3 yüzlü bağlantı: bugünkü v3 çıktısı (gerçek sayılar, varış notu).
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  AJANDA_ARACLARI,
  AJANDA_ARACLARI_V2,
  AJANDA_BORU_ADI,
  PROTOKOL_SURUMU,
  type AjandaFiili,
  type AjandaIslem,
  ajandaKopruAsagiCoz,
  ajandaMcpSonucu,
} from "@eren/protocol";
import { ajandaKur } from "../src/ajanda.ts";
import { ajandaKopruSunucuKur } from "../src/ajanda-kopru-sunucu.ts";
import { depoAc } from "../src/depo.ts";
import type { CihazYonetimliDepo } from "../src/depo.ts";
import type { AjandaJetonKapsami, AjandaKopruSunucu, Veriyolu } from "../src/sozlesme.ts";
import { sahteBoru, sahteGunluk, sahteRastgele, sahteTakvim, sahteZaman } from "./sahte.ts";

// 2026-11-25 14:30 Europe/Istanbul.
const T0 = 1_795_606_200_000;
const DILIM = "Europe/Istanbul";
const KAPSAM: AjandaJetonKapsami = { rol: "ana_oturum", sohbet_id: "ana", nesil: 3 };
const MESAJ_ANI = { tarih: "2026-11-25", saat: "14:30", saat_dilimi: DILIM };
const BILDIRIM_YOK = "bildirim gelmeyecek";

const acik: { depo: CihazYonetimliDepo; sunucu: AjandaKopruSunucu }[] = [];
afterEach(async () => {
  for (const { depo, sunucu } of acik.splice(0)) {
    await sunucu.kapat();
    depo.kapat();
  }
});

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
};

/** `ayar`: servisin `ajanda_arac_v3`'ü (işleyiciler ve boru sunucusu aynı ayarla). */
const kur = async (ayar: boolean) => {
  const zaman = sahteZaman(T0);
  const gunluk = sahteGunluk();
  const veriyolu: Veriyolu = { yayinla: () => {}, dinle: () => () => {} };
  const depo = depoAc({ yol: ":memory:", saat: zaman.saat, veriyolu, gunluk });
  const ajanda = ajandaKur({
    depo,
    takvim: sahteTakvim(DILIM),
    saat: zaman.saat,
    rastgele: sahteRastgele(),
    gunluk,
    turBaglami: () => ({ tur_kokeni: "insan", turn_id: "tur_insan", mesaj_ani: MESAJ_ANI, insan_metni: "başlığı değiştir", kaynak_msg_id: "m_0001" }),
    aracV3: ayar,
  });
  ajanda.baslat();
  const boru = sahteBoru();
  const sunucu = ajandaKopruSunucuKur({
    boru,
    depo,
    rastgele: sahteRastgele(77),
    anahtar: { sabitZamanEsit: (a: string, b: string) => a === b },
    zamanlayici: zaman.zamanlayici,
    gunluk,
    aracV3: ayar,
  });
  acik.push({ depo, sunucu });
  await sunucu.baslat(ajanda.araclar);
  let no = 0;
  /** Telefonun kanal işlemi (`/ajanda`, v3 telefon). */
  const islem = (i: AjandaIslem) => assert.equal(ajanda.islemUygula("cihaz_ajanda01", `i_${++no}`, i).ok, true);
  /**
   * Bağlantı açar (`v3İster`: hello'da `arac_v3:true`; düz hello v2 yüzüdür), tek istek yollar. Çıktı
   * bağlantının yüzünün katı şemasından geçer; metin köprünün tek yolundan (`ajandaMcpSonucu`).
   */
  const cagir = async (v3Ister: boolean, fiil: AjandaFiili, girdi: unknown) => {
    const b = boru.baglan(AJANDA_BORU_ADI);
    const jeton = sunucu.jetonUret(KAPSAM);
    b.satirGonder(JSON.stringify({ v: PROTOKOL_SURUMU, type: "kopru_hello", rol: KAPSAM.rol, jeton, ...(v3Ister ? { arac_v3: true } : {}) }));
    await bosalt();
    b.satirGonder(JSON.stringify({ v: PROTOKOL_SURUMU, type: "istek", istek_id: `r_${++no}`, fiil, girdi }));
    await bosalt();
    // Tek bağlantı kuralı: sonraki çağrı aynı kapsamla yeniden bağlanır.
    b.istemciKopar();
    await bosalt();
    const cikan = b.yazilanlar.map((s) => {
      const c = ajandaKopruAsagiCoz(s);
      assert.ok(c.ok, s);
      return c.mesaj;
    });
    const karsilama = cikan[0] as { type: string; arac_v3?: true };
    assert.equal(karsilama.type, "kopru_welcome");
    const v3 = karsilama.arac_v3 === true;
    const yanit = cikan.at(-1) as { type: string; ok: boolean; sonuc?: unknown };
    assert.equal(yanit.type, "yanit");
    assert.equal(yanit.ok, true, JSON.stringify(yanit));
    const cikti = (v3 ? AJANDA_ARACLARI : AJANDA_ARACLARI_V2)[fiil].cikti.parse(yanit.sonuc) as Record<string, unknown>;
    const metin = ajandaMcpSonucu({ fiil, cikti } as never, () => "c".repeat(32)).content[0].text;
    return { v3, ham: yanit.sonuc, cikti, metin };
  };
  return { islem, cagir };
};

/** Bugün 15:00, "iş yeri"ne varışla, 60 dk önce hatırlatma (14:00, geçti): zaman hatırlatması kurulmayacak. */
const VARISLI: AjandaIslem = {
  islem: "ekle",
  kayit_id: "k_tel",
  tur: "randevu",
  baslik: "Toplantı",
  zaman: { kesinlik: "an", tarih: "2026-11-25", saat: "15:00", saat_dilimi: DILIM },
  hatirlatmalar: [{ tur: "once", dk: 60 }],
  girdi_yolu: "elle",
  bolge: "iş yeri",
  varis: {},
} as AjandaIslem;
const BASLIK = { kayit_id: "k_tel", degisiklik: { baslik: "Toplantı (yeni)" } };

/** Bugün saatsiz gün kaydı (gün hatırlatması 09:00, geçti), varışlı: öğleye alınınca saati değişir. */
const GUN_VARISLI: AjandaIslem = {
  islem: "ekle",
  kayit_id: "k_gun",
  tur: "gorev",
  baslik: "Fatura",
  zaman: { kesinlik: "gun", tarih: "2026-11-25", saat_dilimi: DILIM },
  hatirlatmalar: [{ tur: "once", dk: 60 }],
  girdi_yolu: "elle",
  bolge: "banka",
  varis: {},
} as AjandaIslem;
const OGLE = {
  kayit_id: "k_gun",
  dayanak: { tarih: "2026-11-25", saat: "14:30" },
  degisiklik: { zaman: { kesinlik: "gun", tarih: "2026-11-25", gun_bolumu: "ogle" } },
};

describe("Z2: ayar açıkken v2 yüzlü bağlantı ayar kapalıykenki v2 görünümünü alır", () => {
  it("varışlı, geçmiş hatırlatmalı kayıt: 'bildirim gelmeyecek' yok, hatirlatma=yok; çıktı ayar kapalıyla aynı", async () => {
    const acikAyar = await kur(true);
    acikAyar.islem(VARISLI);
    const a = await acikAyar.cagir(false, "ajanda_guncelle", BASLIK);
    assert.equal(a.v3, false);
    assert.equal(a.cikti.sonuc, "guncellendi");
    assert.equal(a.metin.includes(BILDIRIM_YOK), false, a.metin);
    assert.match(a.metin, / hatirlatma=yok\. /);
    for (const s of ["varis", "bolge", "iş yeri"]) assert.equal(a.metin.includes(s), false, s);

    const kapali = await kur(false);
    kapali.islem(VARISLI);
    const k = await kapali.cagir(false, "ajanda_guncelle", BASLIK);
    assert.equal(k.v3, false);
    assert.equal(JSON.stringify(a.ham), JSON.stringify(k.ham));
    assert.equal(a.metin, k.metin);
  });

  it("gün hatırlatması notu da v2 yüzünden: iki yanda görünmeyen saat değişimi not doğurmaz; ayar kapalıyla aynı", async () => {
    const acikAyar = await kur(true);
    acikAyar.islem(GUN_VARISLI);
    const a = await acikAyar.cagir(false, "ajanda_guncelle", OGLE);
    assert.equal(a.cikti.sonuc, "guncellendi");
    assert.equal("onceki_gun_hatirlatmasi" in a.cikti, false, a.metin);
    assert.equal(a.metin.includes("Hatırlatma saati değişti"), false);

    const kapali = await kur(false);
    kapali.islem(GUN_VARISLI);
    const k = await kapali.cagir(false, "ajanda_guncelle", OGLE);
    assert.equal(JSON.stringify(a.ham), JSON.stringify(k.ham));
    assert.equal(a.metin, k.metin);
  });

  it("liste: v2 yüzlü bağlantıda ayar kapalıyla aynı", async () => {
    const acikAyar = await kur(true);
    acikAyar.islem(VARISLI);
    const a = await acikAyar.cagir(false, "ajanda_listele", {});
    const kapali = await kur(false);
    kapali.islem(VARISLI);
    const k = await kapali.cagir(false, "ajanda_listele", {});
    assert.equal(JSON.stringify(a.ham), JSON.stringify(k.ham));
  });

  it("ayar açık, v3 yüzlü bağlantı: bugünkü v3 çıktısı (gerçek sayılar, varış notu, gün notu)", async () => {
    const o = await kur(true);
    o.islem(VARISLI);
    const a = await o.cagir(true, "ajanda_guncelle", BASLIK);
    assert.equal(a.v3, true);
    assert.equal(a.metin.includes(BILDIRIM_YOK), false, a.metin);
    assert.match(a.metin, / hatirlatma=1 kurulacak=0 gecmis=1 .*varis=giris: kullanıcı bölgeye girince telefon bildirim verir/);
    assert.deepEqual((a.cikti.kayit as { hatirlatma: unknown }).hatirlatma, { toplam: 1, kurulacak: 0, saatsiz: 0, gecmis: 1 });

    o.islem(GUN_VARISLI);
    const g = await o.cagir(true, "ajanda_guncelle", OGLE);
    assert.deepEqual(g.cikti.onceki_gun_hatirlatmasi, { tarih: "2026-11-25", saat: "09:00", gecti: true });
  });
});
