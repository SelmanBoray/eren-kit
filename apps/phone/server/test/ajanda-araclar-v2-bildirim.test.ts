/**
 * v3 araç yüzü kapalıyken (ayar `ajanda_arac_v3` verilmez) v3 telefonun yazdığı varışlı kaydın özeti `varis`
 * taşımaz. Zaman hatırlatmalarından hiçbiri kurulmayacaksa v2 metni "hiçbir bildirim gelmeyecek" derdi; oysa
 * telefon varışta bildirim verir. Ölçütler:
 * - varışlı kayıtta metin bu iddiayı taşımaz, v3 alanı anmaz, çıktı v2 şemasından geçer;
 * - aynı kayıt varışsızken metin ve çıktı eskisi gibidir (uyarı durur);
 * - açık yüzde (v3) özet değişmez (gerçek sayılar, `varis` notu).
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AJANDA_ARACLARI, AJANDA_ARACLARI_V2, type AjandaFiili, type AjandaIslem, ajandaMcpSonucu } from "@eren/protocol";
import { ajandaKur } from "../src/ajanda.ts";
import { depoAc } from "../src/depo.ts";
import type { CihazYonetimliDepo } from "../src/depo.ts";
import type { AjandaKopruBaglami, Veriyolu } from "../src/sozlesme.ts";
import { sahteGunluk, sahteRastgele, sahteTakvim, sahteZaman } from "./sahte.ts";

// 2026-11-25 14:30 Europe/Istanbul.
const T0 = 1_795_606_200_000;
const DILIM = "Europe/Istanbul";
const BAGLAM: AjandaKopruBaglami = { rol: "ana_oturum", sohbet_id: "ana", nesil: 3 };
const MESAJ_ANI = { tarih: "2026-11-25", saat: "14:30", saat_dilimi: DILIM };
const BILDIRIM_YOK = "hiçbir bildirim gelmeyecek";

const acik: CihazYonetimliDepo[] = [];
afterEach(() => {
  for (const d of acik.splice(0)) d.kapat();
});

const kur = (aracV3?: boolean) => {
  const zaman = sahteZaman(T0);
  const gunluk = sahteGunluk();
  const veriyolu: Veriyolu = { yayinla: () => {}, dinle: () => () => {} };
  const depo = depoAc({ yol: ":memory:", saat: zaman.saat, veriyolu, gunluk });
  acik.push(depo);
  const ajanda = ajandaKur({
    depo,
    takvim: sahteTakvim(DILIM),
    saat: zaman.saat,
    rastgele: sahteRastgele(),
    gunluk,
    turBaglami: () => ({ tur_kokeni: "insan", turn_id: "tur_insan", mesaj_ani: MESAJ_ANI, insan_metni: "başlığı değiştir", kaynak_msg_id: "m_0001" }),
    ...(aracV3 === undefined ? {} : { aracV3 }),
  });
  ajanda.baslat();
  let no = 0;
  /** Telefonun kanal işlemi (`/ajanda`, v3 telefon). */
  const islem = (i: AjandaIslem) => assert.equal(ajanda.islemUygula("cihaz_ajanda01", `i_${++no}`, i).ok, true);
  /** Çağrı; çıktı seçilen yüzün katı şemasından geçer, metin köprünün tek yolundan (`ajandaMcpSonucu`). */
  const cagir = async (fiil: AjandaFiili, girdi: unknown) => {
    const s = (await (ajanda.araclar[fiil] as (g: unknown, b: AjandaKopruBaglami, s: AbortSignal) => Promise<{ ok: boolean; deger?: unknown }>)(
      girdi,
      BAGLAM,
      new AbortController().signal,
    )) as { ok: true; deger: unknown };
    assert.ok(s.ok);
    const cikti = (aracV3 === true ? AJANDA_ARACLARI : AJANDA_ARACLARI_V2)[fiil].cikti.parse(s.deger) as Record<string, unknown>;
    const metin = ajandaMcpSonucu({ fiil, cikti } as never, () => "c".repeat(32)).content[0].text;
    return { cikti, metin };
  };
  return { islem, cagir };
};

/** Bugün 15:00, 60 dk önce hatırlatma (14:00, geçti): zaman hatırlatması kurulmayacak. */
const kayit = (varisli: boolean): AjandaIslem =>
  ({
    islem: "ekle",
    kayit_id: "k_tel",
    tur: "gorev",
    baslik: "Kart okut",
    zaman: { kesinlik: "an", tarih: "2026-11-25", saat: "15:00", saat_dilimi: DILIM },
    hatirlatmalar: [{ tur: "once", dk: 60 }],
    girdi_yolu: "elle",
    ...(varisli ? { bolge: "iş yeri", varis: {} } : {}),
  }) as AjandaIslem;

const GUNCELLE = { kayit_id: "k_tel", degisiklik: { baslik: "Kart okut (yeni)" } };
describe("v3 kapalı: varışlı kayıtta yanlış 'bildirim yok' iddiası yok", () => {
  it("güncelleme: varışlı v3 kaydında iddia yok, hatırlatma=yok; v3 alanı anılmaz", async () => {
    const o = kur();
    o.islem(kayit(true));
    const { cikti, metin } = await o.cagir("ajanda_guncelle", GUNCELLE);
    assert.equal(cikti.sonuc, "guncellendi");
    assert.equal(metin.includes(BILDIRIM_YOK), false, metin);
    assert.match(metin, / hatirlatma=yok\. /);
    for (const s of ["varis", "bolge", "iş yeri"]) assert.equal(metin.includes(s), false, s);
    assert.deepEqual((cikti.kayit as { hatirlatma: unknown }).hatirlatma, { toplam: 0, kurulacak: 0, saatsiz: 0, gecmis: 0 });
  });

  it("varışsız aynı kayıt: uyarı ve gerçek sayılar durur (v2 davranışı)", async () => {
    const o = kur();
    o.islem(kayit(false));
    const { cikti, metin } = await o.cagir("ajanda_guncelle", GUNCELLE);
    assert.ok(metin.includes(BILDIRIM_YOK), metin);
    assert.match(metin, / hatirlatma=1 kurulacak=0 gecmis=1 /);
    assert.deepEqual((cikti.kayit as { hatirlatma: unknown }).hatirlatma, { toplam: 1, kurulacak: 0, saatsiz: 0, gecmis: 1 });
  });

  it("açık yüz (v3): özet gerçek sayılarla, varış notuyla; iddia yok", async () => {
    const o = kur(true);
    o.islem(kayit(true));
    const { cikti, metin } = await o.cagir("ajanda_guncelle", GUNCELLE);
    assert.equal(metin.includes(BILDIRIM_YOK), false, metin);
    assert.match(metin, / hatirlatma=1 kurulacak=0 gecmis=1 .*varis=giris: kullanıcı bölgeye girince telefon bildirim verir/);
    assert.deepEqual((cikti.kayit as { hatirlatma: unknown }).hatirlatma, { toplam: 1, kurulacak: 0, saatsiz: 0, gecmis: 1 });
  });
});

/**
 * S4(c): kapalı yüzün özeti ile `onceki_gun_hatirlatmasi` aynı yüzden hesaplanır. Varışlı kayıtta hiçbir zaman
 * hatırlatması kurulmayacaksa özet "hatirlatma=yok" der (yanlış "bildirim gelmeyecek" iddiası yerine; v2 yüzü
 * varışı söyleyemez); gün hatırlatmasının değişim notu da bu yüze göredir: önce görünen hatırlatma artık
 * görünmüyorsa not verilir, iki yanda da görünmüyorsa (gerçek saat değişse de) verilmez. Varışsız kayıt ve
 * açık yüz gerçek özetle hesaplar (bugünkü kural, baytlar değişmez).
 */
describe("v3 kapalı: varışlı kayıtta gün hatırlatması notu özetle çelişmez", () => {
  const DAYANAK = { tarih: "2026-11-25", saat: "14:30" };
  /** Saatsiz gün kaydı (gün hatırlatması 09:00), bir `once` hatırlatmalı. */
  const gunKaydi = (tarih: string, varisli: boolean): AjandaIslem =>
    ({
      islem: "ekle",
      kayit_id: "k_gun",
      tur: "gorev",
      baslik: "Fatura",
      zaman: { kesinlik: "gun", tarih, saat_dilimi: DILIM },
      hatirlatmalar: [{ tur: "once", dk: 60 }],
      girdi_yolu: "elle",
      ...(varisli ? { bolge: "banka", varis: {} } : {}),
    }) as AjandaIslem;
  const tasi = (zaman: Record<string, unknown>) => ({ kayit_id: "k_gun", dayanak: DAYANAK, degisiklik: { zaman: { kesinlik: "gun", ...zaman } } });

  it("yarından bugüne (aynı saat, artık geçti): görünen hatırlatma kalktı, not verilir", async () => {
    const o = kur();
    o.islem(gunKaydi("2026-11-26", true));
    const { cikti, metin } = await o.cagir("ajanda_guncelle", tasi({ tarih: "2026-11-25" }));
    assert.equal(cikti.sonuc, "guncellendi");
    assert.match(metin, / hatirlatma=yok\. /);
    assert.deepEqual(cikti.onceki_gun_hatirlatmasi, { tarih: "2026-11-26", saat: "09:00", gecti: false });
    assert.match(metin, /Hatırlatma saati değişti: önceden 09:00, şimdi gün hatırlatması yok/);
    assert.equal(metin.includes(BILDIRIM_YOK), false);
  });

  it("geçmiş hatırlatmanın saati değişti (iki yanda da görünmüyor): not yok", async () => {
    const o = kur();
    o.islem(gunKaydi("2026-11-25", true));
    const { cikti, metin } = await o.cagir("ajanda_guncelle", tasi({ tarih: "2026-11-25", gun_bolumu: "ogle" }));
    assert.equal(cikti.sonuc, "guncellendi");
    assert.match(metin, / hatirlatma=yok\. /);
    assert.equal("onceki_gun_hatirlatmasi" in cikti, false, metin);
    assert.equal(metin.includes("Hatırlatma saati değişti"), false);
  });

  it("varışsız aynı kayıtlar ve açık yüz: gerçek özetle bugünkü kural", async () => {
    const yarindan = kur();
    yarindan.islem(gunKaydi("2026-11-26", false));
    const a = await yarindan.cagir("ajanda_guncelle", tasi({ tarih: "2026-11-25" }));
    assert.equal("onceki_gun_hatirlatmasi" in a.cikti, false, "saat aynı: not yok");
    assert.match(a.metin, /gun_hatirlatmasi=2026-11-25 Çarşamba 09:00 \(geçti\)/);
    const ogle = kur();
    ogle.islem(gunKaydi("2026-11-25", false));
    const b = await ogle.cagir("ajanda_guncelle", tasi({ tarih: "2026-11-25", gun_bolumu: "ogle" }));
    assert.deepEqual(b.cikti.onceki_gun_hatirlatmasi, { tarih: "2026-11-25", saat: "09:00", gecti: true });
    const v3 = kur(true);
    v3.islem(gunKaydi("2026-11-25", true));
    const c = await v3.cagir("ajanda_guncelle", tasi({ tarih: "2026-11-25", gun_bolumu: "ogle" }));
    assert.deepEqual(c.cikti.onceki_gun_hatirlatmasi, { tarih: "2026-11-25", saat: "09:00", gecti: true });
    assert.match(c.metin, /gun_hatirlatmasi=2026-11-25 Çarşamba 11:00 \(geçti\)/);
  });
});
