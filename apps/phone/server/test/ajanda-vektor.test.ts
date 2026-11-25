/**
 * Protokol kural vektörleri (`protocol/vektorler/ajanda-kurallar.json`) servis yolundan: her vektör
 * kayıt depoya konup ajanda modülünün kendi girişinden (`islemUygula`, `araclar`, `karsila`) sürülür ve
 * sonuç vektörün beklediğiyle karşılaştırılır. Servis yolu olmayan yazarlar (`arka_plan`: ilk dilimde
 * üreten yok) atlanır ve sayıları sabitlenir. Bölümler: birlestirme, tekil_anahtar, es_degisikligi,
 * tekil_karar, telafi, dayanak, ornek_durumu, hatirlatma_plani (özet).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AJANDA_ALANLARI,
  AJANDA_ARACLARI,
  type AjandaAlani,
  type AjandaAlanDegisikligi,
  type AjandaKaydi,
  type AjandaYerelAn,
  type AjandaZamani,
  ajandaTekilAnahtari,
  gunNoTarih,
  type Hatirlatma,
  type KaynakYolu,
  tarihGunNo,
  type TurKokeni,
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
} from "../src/sozlesme.ts";
import { SAHTE_DILIMLER, sahteGunluk, sahteRastgele, sahteTakvim, sahteZaman } from "./sahte.ts";

const VEKTOR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "protocol", "vektorler", "ajanda-kurallar.json");
const V = JSON.parse(readFileSync(VEKTOR, "utf8")) as Record<string, unknown>;

const T0 = 1_795_606_200_000;
const DILIM = "Europe/Istanbul";
const CIHAZ = "cihaz_vektor01";
const BAGLAM: AjandaKopruBaglami = { rol: "ana_oturum", sohbet_id: "ana", nesil: 1 };
const MESAJ_ANI: AjandaYerelAn = { tarih: "2026-11-25", saat: "14:30", saat_dilimi: DILIM };
const DILIMLER = { ...SAHTE_DILIMLER, "Etc/GMT-3": 180 };

type Yazar = { yol: KaynakYolu; tur_kokeni: TurKokeni };

const acik: CihazYonetimliDepo[] = [];
afterEach(() => {
  for (const d of acik.splice(0)) d.kapat();
});

const kur = (sec: { simdi?: number; tur?: AjandaTurBaglami; kullaniciDilimi?: string } = {}) => {
  const zaman = sahteZaman(sec.simdi ?? T0);
  const gunluk = sahteGunluk();
  const depo = depoAc({ yol: ":memory:", saat: zaman.saat, gunluk });
  acik.push(depo);
  const takvim = sahteTakvim(sec.kullaniciDilimi ?? DILIM, DILIMLER);
  const durum = { tur: sec.tur ?? insanTuru() };
  const ajanda = ajandaKur({ depo, takvim, saat: zaman.saat, rastgele: sahteRastgele(), gunluk, turBaglami: () => durum.tur });
  ajanda.baslat();
  /** Vektör kaydını depoya olduğu gibi koyar (revizyon ve güncelleme anını depo verir). */
  const tohum = (k: AjandaKaydi): AjandaKaydi => {
    const { revizyon: _r, guncelleme_ms: _g, ...govde } = k;
    return depo.ajandaDegisiklikYaz({
      kayit: govde,
      girdi: { islem: "ekle", yazar: { yol: "elle", tur_kokeni: "insan" }, onceki: {}, sonraki: {} },
      ts_ms: k.olusturma_ms,
    });
  };
  const cagir = async <F extends "ajanda_ekle" | "ajanda_guncelle">(fiil: F, girdi: AjandaFiilGirdisi<F>): Promise<AjandaFiilCiktisi<F>> => {
    const f = ajanda.araclar[fiil] as (g: unknown, b: AjandaKopruBaglami, s: AbortSignal) => Promise<
      { ok: true; deger: AjandaFiilCiktisi<F> } | { ok: false; code: string }
    >;
    const s = await f(girdi, BAGLAM, new AbortController().signal);
    assert.ok(s.ok);
    AJANDA_ARACLARI[fiil].cikti.parse(s.deger);
    return s.deger;
  };
  return { zaman, depo, takvim, ajanda, durum, tohum, cagir };
};

function insanTuru(mesaj_ani: AjandaYerelAn = MESAJ_ANI): AjandaTurBaglami {
  return { tur_kokeni: "insan", turn_id: "tur_v", mesaj_ani, insan_metni: "vektör" };
}
const turKur = (kokeni: TurKokeni, mesaj_ani: AjandaYerelAn = MESAJ_ANI): AjandaTurBaglami =>
  kokeni === "insan" ? insanTuru(mesaj_ani) : { tur_kokeni: "sentetik", turn_id: "tur_v", mesaj_ani };

const DAYANAK = { tarih: MESAJ_ANI.tarih, saat: MESAJ_ANI.saat };

/** Bir ekleme çıktısının kaydının kimliği. */
const kimlik = (c: AjandaFiilCiktisi<"ajanda_ekle">): string | undefined => ("kayit" in c ? c.kayit.kayit_id : undefined);

/** Yeni geçmiş satırlarında değişen kayıt alanları (kanonik sırada). */
const degisenAlanlar = (o: ReturnType<typeof kur>, kayit_id: string, sonrakiRevden: number): AjandaAlani[] => {
  const satirlar = o.depo.ajandaGecmisi({ kayit_id, adet: 100 }).filter((g) => g.rev > sonrakiRevden);
  return AJANDA_ALANLARI.filter((a) => satirlar.some((g) => a in g.sonraki));
};

describe("vektörler servis yolundan: birlestirme (ajandaDegisikligiUygula)", () => {
  const vakalar = V.birlestirme as {
    ad: string;
    kayit: AjandaKaydi;
    degisiklik: AjandaAlanDegisikligi;
    yazar: Yazar;
    beklenen: {
      uygulanan: AjandaAlani[];
      korunan: AjandaAlani[];
      elle_alanlar: AjandaAlani[];
      kaldirilan?: AjandaAlani[];
      hatirlatmalar?: Hatirlatma[];
      ornekler?: AjandaKaydi["ornekler"];
      budanan_ornekler?: AjandaKaydi["ornekler"];
    };
  }[];
  const servisYolu = vakalar.filter((v) => v.yazar.yol !== "arka_plan");

  it("servis yolu olmayan yazar yalnız arka_plan (ilk dilimde üreten yok)", () => {
    assert.equal(vakalar.length - servisYolu.length, 2);
    assert.ok(servisYolu.length >= 11);
  });

  for (const v of servisYolu) {
    it(v.ad, async () => {
      const o = kur({ tur: turKur(v.yazar.tur_kokeni) });
      // Sentetik tur yalnız taslağa dokunabilir: birleştirme kuralını sınamak için kayıt taslak konur.
      const tohum = o.tohum(v.yazar.tur_kokeni === "sentetik" ? { ...v.kayit, taslak: true } : v.kayit);
      const id = tohum.kayit_id;
      let korunan: AjandaAlani[] = [];
      if (v.yazar.yol === "elle") {
        const { durum, ...alanlar } = v.degisiklik;
        if (Object.keys(alanlar).length > 0) {
          const s = o.ajanda.islemUygula(CIHAZ, "i_g", {
            islem: "guncelle",
            kayit_id: id,
            temel_revizyon: tohum.revizyon,
            degisiklik: alanlar as Extract<Parameters<typeof o.ajanda.islemUygula>[2], { islem: "guncelle" }>["degisiklik"],
          });
          assert.equal(s.ok, true, JSON.stringify(s));
          assert.equal(s.korunan_alanlar, undefined);
        }
        if (durum !== undefined) assert.equal(o.ajanda.islemUygula(CIHAZ, "i_d", { islem: "durum", kayit_id: id, durum }).ok, true);
      } else {
        assert.equal(v.degisiklik.tekrar, undefined, "araçta tekrar yok");
        const c = await o.cagir("ajanda_guncelle", {
          kayit_id: id,
          dayanak: DAYANAK,
          degisiklik: v.degisiklik as AjandaFiilGirdisi<"ajanda_guncelle">["degisiklik"],
        });
        assert.notEqual(c.sonuc, "ret", JSON.stringify(c));
        korunan = "korunan_alanlar" in c ? c.korunan_alanlar : [];
      }
      const k = o.depo.ajandaKaydiGetir(id) as AjandaKaydi;
      assert.deepEqual(degisenAlanlar(o, id, tohum.revizyon), v.beklenen.uygulanan, "uygulanan");
      assert.deepEqual(korunan, v.beklenen.korunan, "korunan");
      assert.deepEqual(k.elle_alanlar, v.beklenen.elle_alanlar, "elle_alanlar");
      for (const a of v.beklenen.kaldirilan ?? []) assert.equal(k[a], undefined, `kaldırılan ${a}`);
      if (v.beklenen.hatirlatmalar !== undefined) assert.deepEqual(k.hatirlatmalar, v.beklenen.hatirlatmalar);
      if (v.beklenen.ornekler !== undefined) assert.deepEqual(k.ornekler, v.beklenen.ornekler);
      if (v.beklenen.budanan_ornekler !== undefined) {
        const g = o.depo.ajandaGecmisi({ kayit_id: id, adet: 1 })[0];
        const kalan = new Set((g?.sonraki.ornekler ?? []).map((x) => x.tarih));
        assert.deepEqual(
          (g?.onceki.ornekler ?? []).filter((x) => !kalan.has(x.tarih)),
          v.beklenen.budanan_ornekler,
          "budananlar geçmişte",
        );
      }
    });
  }
});

describe("vektörler servis yolundan: tekil_anahtar (araçla doğan kaydın kaynak.tekil_anahtar'ı)", () => {
  const vakalar = V.tekil_anahtar as {
    ad: string;
    girdi: { kapsam: string; tur: AjandaKaydi["tur"]; baslik: string; zaman?: AjandaZamani };
    anahtar: string;
  }[];
  for (const v of vakalar) {
    it(v.ad, async () => {
      assert.ok(v.girdi.kapsam.startsWith("sohbet:"));
      const sohbet_id = v.girdi.kapsam.slice("sohbet:".length);
      assert.equal(sohbet_id, BAGLAM.sohbet_id);
      // Dilimli ve (mesaj anının dilimiyle aynıysa) dilimsiz verilen zaman aynı anahtarı verir.
      const zamanlar: (AjandaZamani | undefined)[] = [v.girdi.zaman];
      if (v.girdi.zaman !== undefined && v.girdi.zaman.kesinlik !== "belirsiz" && v.girdi.zaman.saat_dilimi === DILIM) {
        const { saat_dilimi: _d, ...dilimsiz } = v.girdi.zaman;
        zamanlar.push(dilimsiz as AjandaZamani);
      }
      for (const zaman of zamanlar) {
        const o = kur();
        const c = await o.cagir("ajanda_ekle", {
          tur: v.girdi.tur,
          baslik: v.girdi.baslik,
          dayanak: DAYANAK,
          ...(zaman === undefined ? {} : { zaman: zaman as AjandaFiilGirdisi<"ajanda_ekle">["zaman"] }),
        });
        assert.equal(c.sonuc, "eklendi");
        const k = o.depo.ajandaKaydiGetir(kimlik(c) as string) as AjandaKaydi;
        assert.equal(k.kaynak.tekil_anahtar, v.anahtar);
      }
    });
  }
});

describe("vektörler servis yolundan: es_degisikligi (emirde açık eşe yansıyan)", () => {
  const vakalar = V.es_degisikligi as {
    ad: string;
    es: { zaman: AjandaZamani };
    girdi: { aciklama?: string; zaman?: AjandaZamani; hatirlatmalar?: Hatirlatma[] };
    degisiklik: AjandaAlanDegisikligi;
  }[];
  const TOHUM_HATIRLATMA: Hatirlatma[] = [{ tur: "once", dk: 60 }];

  for (const v of vakalar) {
    for (const taslak of [false, true]) {
      it(`${v.ad}${taslak ? " (taslak eş: onaylandi)" : ""}`, async () => {
        const o = kur();
        const es = o.tohum({
          kayit_id: "k_es",
          revizyon: 1,
          tur: "randevu",
          baslik: "Dişçi",
          zaman: v.es.zaman,
          hatirlatmalar: TOHUM_HATIRLATMA,
          ornekler: [],
          durum: "acik",
          taslak,
          silindi: false,
          elle_alanlar: [],
          kaynak: {
            yol: "sohbet_araci",
            tur_kokeni: taslak ? "sentetik" : "insan",
            sohbet_id: "ana",
            tekil_anahtar: ajandaTekilAnahtari({ kapsam: "sohbet:ana", tur: "randevu", baslik: "Dişçi", zaman: v.es.zaman }),
          },
          olusturma_ms: T0 - 60_000,
          guncelleme_ms: T0 - 60_000,
        });
        // Eşi bulmak için aynı gün ve saat gerekir: girdide zaman yoksa eşinki söylenir (çekirdek aynı, süre aynı).
        const c = await o.cagir("ajanda_ekle", {
          tur: "randevu",
          baslik: "Dişçi",
          dayanak: DAYANAK,
          zaman: (v.girdi.zaman ?? v.es.zaman) as AjandaFiilGirdisi<"ajanda_ekle">["zaman"],
          ...(v.girdi.aciklama === undefined ? {} : { aciklama: v.girdi.aciklama }),
          ...(v.girdi.hatirlatmalar === undefined ? {} : { hatirlatmalar: v.girdi.hatirlatmalar }),
        });
        assert.equal(c.sonuc, taslak ? "onaylandi" : "zaten_var", JSON.stringify(c));
        assert.equal(kimlik(c), "k_es");
        const k = o.depo.ajandaKaydiGetir("k_es") as AjandaKaydi;
        const beklenenAlanlar = AJANDA_ALANLARI.filter(
          (a) => a in v.degisiklik && JSON.stringify(v.degisiklik[a]) !== JSON.stringify(es[a]),
        );
        assert.deepEqual("uygulanan_alanlar" in c ? c.uygulanan_alanlar : null, beklenenAlanlar);
        for (const a of AJANDA_ALANLARI) {
          if (a in v.degisiklik) assert.deepEqual(k[a], v.degisiklik[a], a);
          else assert.deepEqual(k[a], es[a], `${a} değişmedi`);
        }
        assert.equal(k.taslak, false);
        assert.equal(o.depo.ajandaKayitSayisi(), 1);
      });
    }
  }
});

describe("vektörler servis yolundan: tekil_karar", () => {
  const vakalar = V.tekil_karar as {
    ad: string;
    esler: { durum: AjandaKaydi["durum"]; taslak: boolean; silindi: boolean }[];
    yazar: Yazar;
    karar: "ekle" | "zaten_var" | "onayla";
    sira?: number;
  }[];
  const servisYolu = vakalar.filter((v) => v.yazar.yol === "sohbet_araci");

  it("araç yolu dışındaki yazarlar: elle (uygulamanın eklemesi tekilleşmez) ve arka_plan (üreten yok)", () => {
    assert.deepEqual([...new Set(vakalar.filter((v) => !servisYolu.includes(v)).map((v) => v.yazar.yol))].sort(), ["arka_plan", "elle"]);
    assert.ok(servisYolu.length >= 8);
  });

  for (const v of servisYolu) {
    it(v.ad, async () => {
      const o = kur({ tur: turKur(v.yazar.tur_kokeni) });
      const zaman: AjandaZamani = { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", saat_dilimi: DILIM };
      const tekil_anahtar = ajandaTekilAnahtari({ kapsam: "sohbet:ana", tur: "randevu", baslik: "Dişçi", zaman });
      const esler = v.esler.map((e, i) =>
        o.tohum({
          kayit_id: `k_es${i}`,
          revizyon: 1,
          tur: "randevu",
          baslik: "Dişçi",
          zaman,
          hatirlatmalar: [],
          ornekler: [],
          ...e,
          elle_alanlar: [],
          kaynak: { yol: "sohbet_araci", tur_kokeni: "insan", sohbet_id: "ana", tekil_anahtar },
          olusturma_ms: T0 - 60_000,
          guncelleme_ms: T0 - 60_000,
        }),
      );
      const c = await o.cagir("ajanda_ekle", { tur: "randevu", baslik: "Dişçi", zaman, dayanak: DAYANAK });
      const sonuc = { ekle: "eklendi", zaten_var: "zaten_var", onayla: "onaylandi" }[v.karar];
      assert.equal(c.sonuc, sonuc);
      if (v.karar === "ekle") {
        assert.ok(!esler.some((e) => e.kayit_id === kimlik(c)));
        assert.equal(o.depo.ajandaKayitSayisi(), esler.length + 1);
      } else {
        assert.equal(kimlik(c), esler[v.sira as number]?.kayit_id);
        assert.equal(o.depo.ajandaKayitSayisi(), esler.length);
      }
    });
  }
});

describe("vektörler servis yolundan: telafi (karsila → ajandaTelafiTamMi)", () => {
  const vakalar = V.telafi as {
    ad: string;
    hello: { son_rev: number; depo_id?: string; son_rev_izi?: { kayit_id: string; guncelleme_ms: number } };
    depo_id: string;
    bas_rev: number;
    izdeki?: { kayit_id: string; ts_ms: number };
    tam: boolean;
  }[];
  for (const v of vakalar) {
    it(v.ad, () => {
      const istenenRevler: number[] = [];
      // Depo yüzünün yalnız telafinin okuduğu kısmı: geri kalanı çağrılırsa atar.
      const yuz = new Proxy(
        {
          islem: <T>(f: () => T): T => f(),
          ajandaDepoKimligi: () => v.depo_id,
          ajandaBasRev: () => v.bas_rev,
          ajandaGecmisSatiri: (rev: number) => {
            istenenRevler.push(rev);
            return rev === v.hello.son_rev && v.izdeki !== undefined ? v.izdeki : null;
          },
        } as Record<string, unknown>,
        {
          get: (t, k) => {
            if (k in t) return t[k as string];
            return () => {
              throw new Error(`telafide beklenmeyen depo çağrısı: ${String(k)}`);
            };
          },
        },
      ) as unknown as AjandaBagimliliklari["depo"];
      const ajanda = ajandaKur({
        depo: yuz,
        takvim: sahteTakvim(),
        saat: sahteZaman(T0).saat,
        rastgele: sahteRastgele(),
        gunluk: sahteGunluk(),
        turBaglami: () => null,
      });
      assert.deepEqual(ajanda.karsila(v.hello), { depo_id: v.depo_id, bas_rev: v.bas_rev, tam: v.tam });
      assert.deepEqual(istenenRevler, v.hello.son_rev > 0 ? [v.hello.son_rev] : []);
    });
  }
});

describe("vektörler servis yolundan: dayanak (ekleme ve güncellemede dayanakGecerliMi)", () => {
  const vakalar = V.dayanak as {
    ad: string;
    dayanak: { tarih: string; saat: string; saat_dilimi?: string };
    mesaj_ani: AjandaYerelAn;
    gecerli: boolean;
  }[];
  for (const v of vakalar) {
    it(v.ad, async () => {
      const o = kur({ tur: insanTuru(v.mesaj_ani) });
      const zaman = { kesinlik: "gun" as const, tarih: "2026-12-01" };
      const e = await o.cagir("ajanda_ekle", { tur: "gorev", baslik: "Vektör", zaman, dayanak: v.dayanak });
      if (v.gecerli) assert.equal(e.sonuc, "eklendi");
      else assert.deepEqual(e, { sonuc: "ret", mesaj_ani: v.mesaj_ani, neden: "dayanak_uyusmuyor" });
      // Güncellemede de: belirsiz kayıt takvime bağlanır.
      const temel = await o.cagir("ajanda_ekle", { tur: "gorev", baslik: "Temel", zaman: { kesinlik: "belirsiz", ifade: "bir ara" } });
      const g = await o.cagir("ajanda_guncelle", { kayit_id: kimlik(temel) as string, dayanak: v.dayanak, degisiklik: { zaman } });
      if (v.gecerli) assert.equal(g.sonuc, "guncellendi");
      else assert.deepEqual(g, { sonuc: "ret", mesaj_ani: v.mesaj_ani, neden: "dayanak_uyusmuyor" });
    });
  }
});

describe("vektörler servis yolundan: ornek_durumu (durum işlemi, bugun kaydın diliminde)", () => {
  type Gunluk = { bas: string; adet: number; durum: "tamam" | "iptal" };
  const vakalar = V.ornek_durumu as {
    ad: string;
    kayit: AjandaKaydi & { ornekler_gunluk?: Gunluk };
    ornek_tarihi: string;
    durum: AjandaKaydi["durum"];
    bugun: string;
    sonuc:
      | { ok: false; neden: "ornek_gecersiz" }
      | {
          ok: true;
          degisti: boolean;
          atilan: AjandaKaydi["ornekler"];
          ornekler?: AjandaKaydi["ornekler"];
          ornek_sayisi?: number;
          ilk?: string;
          son?: string;
        };
  }[];
  const ac = (g: Gunluk): AjandaKaydi["ornekler"] =>
    Array.from({ length: g.adet }, (_, i) => ({ tarih: gunNoTarih(tarihGunNo(g.bas) + i), durum: g.durum }));

  for (const v of vakalar) {
    it(v.ad, () => {
      const { ornekler_gunluk, ...kayit } = v.kayit;
      const tam: AjandaKaydi = { ...kayit, ornekler: ornekler_gunluk === undefined ? kayit.ornekler : ac(ornekler_gunluk) };
      const dilim = tam.zaman !== undefined && tam.zaman.kesinlik !== "belirsiz" ? tam.zaman.saat_dilimi : DILIM;
      // Kaydın diliminde `bugun` 01:00; kullanıcının dilimi (São Paulo) o an hâlâ önceki gün: bugun kaydın dilimindendir.
      const simdi = sahteTakvim(DILIM, DILIMLER).anCevir(v.bugun, "01:00", dilim);
      const o = kur({ simdi, kullaniciDilimi: "America/Sao_Paulo" });
      const tohum = o.tohum(tam);
      const s = o.ajanda.islemUygula(CIHAZ, "i_ornek", {
        islem: "durum",
        kayit_id: tam.kayit_id,
        durum: v.durum,
        ornek_tarihi: v.ornek_tarihi,
      });
      const k = o.depo.ajandaKaydiGetir(tam.kayit_id) as AjandaKaydi;
      if (!v.sonuc.ok) {
        assert.deepEqual(s, { ok: false, kayit_id: tam.kayit_id, code: v.sonuc.neden });
        assert.equal(k.revizyon, tohum.revizyon);
        return;
      }
      if (!v.sonuc.degisti) {
        assert.deepEqual(s, { ok: true, kayit_id: tam.kayit_id });
        assert.equal(k.revizyon, tohum.revizyon);
        return;
      }
      assert.equal(s.ok, true);
      assert.equal(s.rev, tohum.revizyon + 1);
      if (v.sonuc.ornekler !== undefined) assert.deepEqual(k.ornekler, v.sonuc.ornekler);
      if (v.sonuc.ornek_sayisi !== undefined) assert.equal(k.ornekler.length, v.sonuc.ornek_sayisi);
      if (v.sonuc.ilk !== undefined) assert.equal(k.ornekler[0]?.tarih, v.sonuc.ilk);
      if (v.sonuc.son !== undefined) assert.equal(k.ornekler.at(-1)?.tarih, v.sonuc.son);
      const g = o.depo.ajandaGecmisi({ kayit_id: tam.kayit_id, adet: 1 })[0];
      assert.equal(g?.ornek_tarihi, v.ornek_tarihi);
      if (v.sonuc.atilan.length > 0) {
        // Atılanlar geçmişte: öncesi tam liste, sonrası atılanlar olmadan.
        const sonra = new Set((g?.sonraki.ornekler ?? []).map((x) => x.tarih));
        assert.deepEqual(
          (g?.onceki.ornekler ?? []).filter((x) => !sonra.has(x.tarih)),
          v.sonuc.atilan,
        );
      } else {
        assert.equal(g?.onceki.ornekler, undefined);
      }
    });
  }
});

describe("vektörler servis yolundan: hatirlatma_plani (araç çıktısının hatırlatma özeti)", () => {
  const plan = V.hatirlatma_plani as {
    ofset_dk: Record<string, number>;
    vakalar: { ad: string; kayit: AjandaKaydi; simdi_ms: number; ozet: unknown }[];
  };
  it("vektörün ofset tablosu sahte takvimin dilimleriyle uyumlu", () => {
    for (const [d, dk] of Object.entries(plan.ofset_dk)) assert.equal(DILIMLER[d as keyof typeof DILIMLER], dk);
  });
  for (const v of plan.vakalar) {
    it(v.ad, async () => {
      const o = kur({ simdi: v.simdi_ms });
      o.tohum(v.kayit);
      // Aynı durumu yazmak yan etkisizdir: çıktı `degismedi` ve kaydın özetini taşır.
      const c = await o.cagir("ajanda_guncelle", { kayit_id: v.kayit.kayit_id, degisiklik: { durum: v.kayit.durum } });
      assert.ok(c.sonuc === "degismedi", JSON.stringify(c));
      assert.deepEqual(c.kayit.hatirlatma, v.ozet);
      assert.equal(c.kayit.taslak, v.kayit.taslak);
    });
  }
});
