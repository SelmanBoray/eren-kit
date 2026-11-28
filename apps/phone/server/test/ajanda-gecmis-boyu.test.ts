/**
 * Geçmiş sayfasının ve telafi `kayit` çerçevesinin boyu, gerçek yazım yoluyla (`islemUygula`, gerçek
 * depo `:memory:`). Protokoldeki ölçüm (`protocol/test/ajanda-cerceve-boyu.test.ts`) yirmi uç `guncelle`
 * girdisinin v3 sayfasının `AJANDA_AZAMI_CERCEVE.KANAL`'ı aştığını gösterir; burada aynı geçmiş telefonun
 * işlemleriyle gerçekten üretilir ve servisin sayfayı boyla kestiği, sayfalamanın hiçbir girdiyi
 * kaçırmadığı ya da yinelemediği, v2 ve v3 kablo halinin sınıra sığıp çözüldüğü sınanır.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  AJANDA_ALANLARI,
  AJANDA_AZAMI_CERCEVE,
  AJANDA_SINIRLARI as S,
  AJANDA_SURUMU,
  type AjandaAsagi,
  ajandaAsagiCoz,
  ajandaAsagiSurume,
  type AjandaGecmisGirdisi,
  type AjandaIslem,
  type AjandaSurumNo,
  SINIRLAR,
} from "@eren/protocol";
import { ajandaKur } from "../src/ajanda.ts";
import { depoAc } from "../src/depo.ts";
import type { CihazYonetimliDepo } from "../src/depo.ts";
import type { Veriyolu } from "../src/sozlesme.ts";
import { sahteGunluk, sahteRastgele, sahteTakvim, sahteZaman } from "./sahte.ts";

// 2026-11-25 14:30 Europe/Istanbul.
const T0 = 1_795_606_200_000;
const CIHAZ = "cihaz_boy01";
const KAYIT = "k".repeat(SINIRLAR.OPAK_ID);
const SINIR = AJANDA_AZAMI_CERCEVE.KANAL;
/** Sahte takvimin bildiği en uzun dilim adı. */
const DILIM = "America/Sao_Paulo";
const ENB = Number.MAX_SAFE_INTEGER;

const acik: CihazYonetimliDepo[] = [];
afterEach(() => {
  for (const d of acik.splice(0)) d.kapat();
});

function kur() {
  const zaman = sahteZaman(T0);
  const gunluk = sahteGunluk();
  const veriyolu: Veriyolu = { yayinla: () => {}, dinle: () => () => {} };
  const depo = depoAc({ yol: ":memory:", saat: zaman.saat, veriyolu, gunluk });
  acik.push(depo);
  const ajanda = ajandaKur({ depo, takvim: sahteTakvim(DILIM), saat: zaman.saat, rastgele: sahteRastgele(), gunluk, turBaglami: () => null });
  ajanda.baslat();
  let n = 0;
  const islem = (i: AjandaIslem): void => {
    const s = ajanda.islemUygula(CIHAZ, `i_${++n}`, i);
    assert.equal(s.ok, true, `${i.islem}: ${s.code ?? ""}`);
  };
  return { depo, ajanda, islem };
}

const gun = (i: number) => new Date(Date.UTC(2026, 11, 1) + i * 86_400_000).toISOString().slice(0, 10);

/** İki uç hal: her alan sınırında, iki halde farklı; metinler JSON'da iki birime çıkan kaçışlı karakterle. */
function uctaGovde(yan: 0 | 1, adet: number) {
  const c = yan === 0 ? '"' : "\\";
  const host = (yan === 0 ? "a" : "b").repeat(63) + ".example";
  return {
    tur: yan === 0 ? ("randevu" as const) : ("gorev" as const),
    baslik: c.repeat(S.BASLIK),
    aciklama: c.repeat(S.ACIKLAMA),
    zaman: { kesinlik: "an" as const, tarih: gun(0), saat: yan === 0 ? "10:00" : "11:00", sure_dk: S.SURE_DK - yan, saat_dilimi: DILIM, ifade: c.repeat(S.ZAMAN_IFADESI) },
    hatirlatmalar: Array.from({ length: S.HATIRLATMA_ADET }, (_, i) => ({ tur: "mutlak" as const, tarih: gun(0), saat: `${yan}${i}:00`, saat_dilimi: DILIM })),
    tekrar: { siklik: "gunluk" as const, aralik: 1, adet },
    simge: (yan === 0 ? "a" : "b") + "0".repeat(S.SIMGE - 1),
    bolge: c.repeat(S.BOLGE),
    bolge_konumu: { enlem_e6: -90_000_000 + yan, boylam_e6: -180_000_000, yaricap_m: S.BOLGE_YARICAP_MAX },
    varis: { pencere: { bas: "00:00", bit: yan === 0 ? "23:59" : "23:58" }, cikista: true as const },
    baglantilar: Array.from({ length: S.KAYIT_BAGLANTI_ADET }, (_, i) => {
      const bas = `https://${host}/${i}/`;
      return { url: bas + "x".repeat(S.BAGLANTI_URL - bas.length), baslik: c.repeat(S.BAGLANTI_BASLIK) };
    }),
    ekler: Array.from({ length: S.EK_ADET }, (_, i) => ({
      ek_id: `e${yan}${i}`.padEnd(SINIRLAR.OPAK_ID, "e"),
      mime: "image/" + "x".repeat(S.EK_MIME - 6),
      bayt: S.EK_BAYT,
      genislik: S.EK_KENAR,
      yukseklik: S.EK_KENAR,
      ozet: String(yan).repeat(64),
      ...(i === 0 ? { kapak: true as const } : {}),
      olusturma_ms: ENB,
    })),
  };
}

/** Kablodaki hali (`gateway-ajanda.ts` `cerceveYaz`): sürüme uyarla, `JSON.stringify`. */
function kablo(m: AjandaAsagi, v: AjandaSurumNo): string {
  const u = ajandaAsagiSurume(m, v);
  assert.ok(u.ok, `v${v} uyarlanamadı: ${u.ok ? "" : u.yollar.join(",")}`);
  return JSON.stringify(u.mesaj);
}

const gecmisCercevesi = (girdiler: AjandaGecmisGirdisi[], devami: boolean): AjandaAsagi =>
  ({ v: AJANDA_SURUMU, type: "gecmis", istek_id: "g".repeat(SINIRLAR.OPAK_ID), kayit_id: KAYIT, girdiler, devami }) as AjandaAsagi;

/**
 * Telefonun işlemleriyle en büyük geçmiş: uç kayıt (`adet` 520), 20..519. günlere 500 örnek, sonra yirmi
 * `guncelle` (her biri bütün alanları öteki uç hale çevirir ve `adet`'i bir azaltıp son örneği budar).
 */
function enBuyukGecmis(o: ReturnType<typeof kur>): void {
  o.islem({ islem: "ekle", kayit_id: KAYIT, ...uctaGovde(0, 520), girdi_yolu: "elle" });
  for (let i = 20; i < 520; i++) o.islem({ islem: "durum", kayit_id: KAYIT, durum: "tamam", ornek_tarihi: gun(i) });
  for (let k = 1; k <= S.GECMIS_SAYFA; k++) {
    const temel = o.depo.ajandaKaydiGetir(KAYIT)!.revizyon;
    const { tur, baslik, aciklama, zaman, hatirlatmalar, tekrar, simge, bolge, bolge_konumu, varis, baglantilar, ekler } = uctaGovde((k % 2) as 0 | 1, 520 - k);
    o.islem({
      islem: "guncelle",
      kayit_id: KAYIT,
      temel_revizyon: temel,
      degisiklik: { tur, baslik, aciklama, zaman, hatirlatmalar, tekrar, simge, bolge, bolge_konumu, varis, baglantilar, ekler },
    });
  }
}

describe("ajanda geçmiş sayfası ve kayıt çerçevesi boyu (v3 alanlarıyla)", () => {
  it("en büyük geçmiş gerçekten üretilir: son yirmi girdi iki yanda her alanı ve örnek listelerini taşır, tam sayfa sınırı aşar", () => {
    const o = kur();
    enBuyukGecmis(o);
    const son = o.depo.ajandaGecmisi({ kayit_id: KAYIT, adet: S.GECMIS_SAYFA });
    assert.equal(son.length, S.GECMIS_SAYFA);
    son.forEach((g, i) => {
      const k = S.GECMIS_SAYFA - i;
      assert.equal(g.islem, "guncelle");
      for (const alan of AJANDA_ALANLARI.filter((a) => a !== "durum")) {
        assert.ok(alan in g.onceki && alan in g.sonraki, `${k}. guncelle ${alan}`);
      }
      assert.equal(g.onceki.ornekler?.length, S.ORNEK_ADET + 1 - k);
      assert.equal(g.sonraki.ornekler?.length, S.ORNEK_ADET - k);
    });
    // Boyla kesilmeseydi: v3'te sınırın üstü (istemci `mesaj_cok_buyuk`), v2'de altı.
    const tam3 = kablo(gecmisCercevesi(son, true), 3);
    assert.ok(tam3.length > SINIR, String(tam3.length));
    assert.ok(kablo(gecmisCercevesi(son, true), 2).length < SINIR);
  });

  it("gecmis sayfayı boyla keser: GECMIS_SAYFA'dan az girdi ve devami; v2 ve v3 kablo hali sınıra sığar ve çözülür", () => {
    const o = kur();
    enBuyukGecmis(o);
    const s = o.ajanda.gecmis(KAYIT);
    assert.equal(s.code, undefined);
    assert.ok(s.girdiler.length > 0 && s.girdiler.length < S.GECMIS_SAYFA, String(s.girdiler.length));
    assert.equal(s.devami, true);
    const tam = o.depo.ajandaGecmisi({ kayit_id: KAYIT, adet: S.GECMIS_SAYFA });
    assert.deepEqual(s.girdiler, tam.slice(0, s.girdiler.length), "sayfa en yeni girdilerin önekidir");
    for (const v of [2, 3] as const) {
      const c = kablo(gecmisCercevesi(s.girdiler, s.devami), v);
      assert.ok(c.length <= SINIR, `v${v} ${c.length}`);
      const coz = ajandaAsagiCoz(c, v);
      assert.equal(coz.ok, true, `v${v}`);
    }
    // Sığan önek en uzunudur: bir girdi daha sınırı aşardı.
    const fazla = kablo(gecmisCercevesi(tam.slice(0, s.girdiler.length + 1), true), 3);
    assert.ok(fazla.length > SINIR, String(fazla.length));
  });

  it("once_rev ile sayfalama bütün geçmişi kaçırmadan ve yinelemeden verir; her sayfa sınıra sığar", () => {
    const o = kur();
    enBuyukGecmis(o);
    const hepsi = o.depo.ajandaGecmisi({ kayit_id: KAYIT, adet: 10_000 }).map((g) => g.rev);
    const gelen: number[] = [];
    let once: number | undefined;
    for (let tur = 0; tur < 1000; tur++) {
      const s = o.ajanda.gecmis(KAYIT, once);
      assert.ok(s.girdiler.length > 0 || !s.devami, "boş sayfa devami demez");
      assert.ok(kablo(gecmisCercevesi(s.girdiler, s.devami), 3).length <= SINIR);
      gelen.push(...s.girdiler.map((g) => g.rev));
      if (!s.devami) break;
      once = s.girdiler.at(-1)!.rev;
    }
    assert.deepEqual(gelen, hepsi);
    assert.equal(hepsi.length, 1 + 500 + S.GECMIS_SAYFA);
  });

  it("telafi `kayit` çerçevesi: en büyük v3 kaydı v2 ve v3'te sınıra geniş payla sığar", () => {
    const o = kur();
    o.islem({ islem: "ekle", kayit_id: KAYIT, ...uctaGovde(0, S.TEKRAR_ADET), girdi_yolu: "elle" });
    for (let i = 0; i < S.ORNEK_ADET; i++) o.islem({ islem: "durum", kayit_id: KAYIT, durum: "tamam", ornek_tarihi: gun(i) });
    const [kayit] = o.ajanda.telafiSayfasi({ sonRev: 0, ustRev: o.depo.ajandaBasRev(), adet: 1 });
    assert.ok(kayit !== undefined);
    assert.equal(kayit.ornekler.length, S.ORNEK_ADET);
    assert.equal(kayit.baglantilar?.length, S.KAYIT_BAGLANTI_ADET);
    assert.equal(kayit.ekler?.length, S.EK_ADET);
    for (const v of [2, 3] as const) {
      const c = kablo({ v: AJANDA_SURUMU, type: "kayit", kayit } as AjandaAsagi, v);
      assert.ok(c.length < SINIR / 16, `v${v} ${c.length}`);
      assert.equal(ajandaAsagiCoz(c, v).ok, true, `v${v}`);
    }
  });
});
