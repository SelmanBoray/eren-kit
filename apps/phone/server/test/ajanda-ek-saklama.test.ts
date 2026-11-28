/**
 * Ek yedeği saklama güvenliği (inceleme bulguları E1, E2, E3; `src/ajanda-ekler.ts`). Geri alınabilir
 * fotoğraf (silinmiş kaydın eki, saklama penceresinde) şu yollarda kaybolmamalı: kota baskısı (E1), PC
 * kapalıyken geçen süre ya da saat sıçraması (E2), turlar arasında kısa yeniden başvuru (E3).
 *
 * Disk bellekte sahtedir, kayıtlar sahte depodadır (her `kayitKoy` revizyonu tek sayaçtan artırır), saat
 * sahtedir; `kayma` duvar saatini sahte zamandan kaydırır (yanlış ayarlı saat taklidi). Servisin çalışırken
 * geçirdiği süre `calis` ile saatlik turlarla taklit edilir.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AJANDA_SINIRLARI, AJANDA_SURUMU, sha256Hex } from "@eren/protocol";
import type { AjandaKaydi } from "@eren/protocol";
import { AJANDA_EK_SINIRLARI, ajandaEkleriKur } from "../src/ajanda-ekler.ts";
import type { AjandaEkCercevesi, AjandaEkIsareti, AjandaEkleri, AjandaEkleriBagimliliklari, AjandaEkYaniti } from "../src/ajanda-ekler.ts";
import { sahteEkDiski } from "./sahte-ek-diski.ts";
import { sahteGunluk, sahteZaman } from "./sahte.ts";

const BASLANGIC = 1_700_000_000_000;
const SAAT = 60 * 60 * 1000;
const GUN = 24 * SAAT;
const SAKLAMA = AJANDA_SINIRLARI.EK_SAKLAMA_GUN * GUN;
const BLOK = AJANDA_EK_SINIRLARI.BLOK_BAYT;

type Msg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const baytlar = (n: number, tohum = 1): Uint8Array => {
  const v = new Uint8Array(n);
  let x = tohum * 2654435761;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    v[i] = x >>> 24;
  }
  return v;
};

interface Ek {
  ek_id: string;
  veri: Uint8Array;
  ozet: string;
  bayt: number;
}

const ekUret = (ek_id: string, n: number, tohum = 1): Ek => {
  const veri = baytlar(n, tohum);
  return { ek_id, veri, ozet: sha256Hex(veri), bayt: n };
};

const kayit = (kayit_id: string, ekler: Ek[], ek: Partial<AjandaKaydi> = {}): AjandaKaydi =>
  ({
    kayit_id,
    revizyon: 1,
    tur: "gorev",
    baslik: "Fotoğraflı kayıt",
    hatirlatmalar: [],
    ornekler: [],
    durum: "acik",
    taslak: false,
    silindi: false,
    elle_alanlar: [],
    kaynak: { yol: "elle", tur_kokeni: "insan", device_id: "aj-1" },
    olusturma_ms: BASLANGIC,
    guncelleme_ms: BASLANGIC,
    ...(ekler.length > 0 && {
      ekler: ekler.map((e) => ({ ek_id: e.ek_id, mime: "image/jpeg", bayt: e.bayt, ozet: e.ozet, olusturma_ms: BASLANGIC })),
    }),
    ...ek,
  }) as AjandaKaydi;

function kur(sec: { kotaBayt?: number } = {}) {
  const zaman = sahteZaman(BASLANGIC);
  /** Duvar saatinin sahte zamandan farkı (ms); yanlış ayarlı ya da sıçrayan saat. */
  const kayma = { ms: 0 };
  const saat = { simdiMs: () => zaman.saat.simdiMs() + kayma.ms };
  const gunluk = sahteGunluk();
  const sd = sahteEkDiski(() => saat.simdiMs());
  const kayitlar = new Map<string, AjandaKaydi>();
  const sayac = { rev: 0 };
  const depo = {
    ajandaKaydiGetir: (id: string) => kayitlar.get(id) ?? null,
    ajandaKayitlari: (s: { silinmislerDahil?: boolean } = {}) =>
      [...kayitlar.values()].filter((k) => s.silinmislerDahil === true || !k.silindi),
    ajandaBasRev: () => sayac.rev,
    ajandaRevAraligi: (g: { sonRev: number; ustRev: number; adet: number }) =>
      [...kayitlar.values()]
        .filter((k) => k.revizyon > g.sonRev && k.revizyon <= g.ustRev)
        .sort((a, b) => a.revizyon - b.revizyon)
        .slice(0, g.adet),
  } as unknown as AjandaEkleriBagimliliklari["depo"];
  const modul = (): AjandaEkleri =>
    ajandaEkleriKur({
      disk: sd.disk,
      depo,
      saat,
      zamanlayici: zaman.zamanlayici,
      gunluk,
      ...(sec.kotaBayt !== undefined && { kotaBayt: sec.kotaBayt }),
    });
  const t = {
    zaman,
    kayma,
    gunluk,
    sd,
    kayitlar,
    ekler: modul(),
    /** Kayıt yazımı: revizyon tek sayaçtan artar (depo gibi). */
    kayitKoy: (k: AjandaKaydi): void => {
      sayac.rev += 1;
      kayitlar.set(k.kayit_id, { ...k, revizyon: sayac.rev });
    },
    /** Servis kapandı ve yeniden açıldı: bellekteki durum gider, disk ve kayıtlar kalır. */
    yenidenAc: async (): Promise<void> => {
      await t.ekler.kapat();
      t.ekler = modul();
    },
    oturum: () => {
      const gelen: Msg[] = [];
      const o = t.ekler.oturumAc({ gonder: (m: AjandaEkYaniti) => gelen.push(m as Msg) });
      const gonder = async (m: Msg): Promise<Msg[]> => {
        const once = gelen.length;
        o.cerceve({ v: AJANDA_SURUMU, ...m } as AjandaEkCercevesi);
        await t.ekler.bekle();
        return gelen.slice(once);
      };
      return {
        o,
        yukle: (k: string, e: Ek) => gonder({ type: "ek_yukle", istek_id: "i1", kayit_id: k, ek_id: e.ek_id, ozet: e.ozet, bayt: e.bayt }),
      };
    },
  };
  return t;
}

type Ortam = ReturnType<typeof kur>;

/** Servis çalışırken `ms` geçer: saatlik temizlik turları (periyot gibi). Son turun sonucunu döner. */
async function calis(t: Ortam, ms: number) {
  let kalan = ms;
  let son = null;
  while (kalan > 0) {
    const adim = Math.min(kalan, AJANDA_EK_SINIRLARI.TEMIZLIK_ARALIGI_MS);
    t.zaman.ilerlet(adim);
    kalan -= adim;
    son = await t.ekler.temizle();
  }
  return son;
}

/** Silinmiş kaydın eki diskte: geri alınabilir fotoğraf. İlk tur işaretler. */
async function geriAlinabilir(t: Ortam, ek_id = "ek_g", bayt = 100, tohum = 1): Promise<Ek> {
  const e = ekUret(ek_id, bayt, tohum);
  t.sd.tamlar.set(e.ozet, e.veri);
  t.kayitKoy(kayit(`k_${ek_id}`, [e], { silindi: true }));
  const s = await t.ekler.temizle();
  assert.ok(s.isaretlenen >= 1);
  return e;
}

const ret = (ek_id: string, code: string) => ({ v: AJANDA_SURUMU, type: "ek_ret", ek_id, code });

describe("E1: kota baskısı saklama penceresindeki dosyayı silmez", () => {
  it("kota dolu: penceredeki başvurusuz dosya yazılmamış bayt uğruna silinmez, yükleme kota_asildi alır", async () => {
    const t = kur({ kotaBayt: 10 * BLOK });
    const g = await geriAlinabilir(t, "ek_g", 6 * BLOK);
    await calis(t, 5 * GUN);
    const n = ekUret("ek_n", 6 * BLOK, 2);
    t.kayitKoy(kayit("k_n", [n]));
    assert.deepEqual(await t.oturum().yukle("k_n", n), [ret("ek_n", "kota_asildi")]);
    assert.ok(t.sd.tamlar.has(g.ozet), "geri alınabilir fotoğraf duruyor");
    assert.equal(t.gunluk.bul("ek_kota_temizligi").length, 0);
  });

  it("senaryo: ek_yukle + parçasız kapanış yinelenir; penceredeki dosyalar gitmez", async () => {
    const t = kur({ kotaBayt: 12 * BLOK });
    const g1 = await geriAlinabilir(t, "ek_g1", 4 * BLOK, 1);
    const g2 = await geriAlinabilir(t, "ek_g2", 4 * BLOK, 2);
    await calis(t, 2 * GUN);
    const uydurma = ekUret("ek_u", 6 * BLOK, 3);
    t.kayitKoy(kayit("k_u", [uydurma]));
    for (let i = 0; i < 5; i++) {
      const b = t.oturum();
      await b.yukle("k_u", uydurma);
      b.o.kapat();
    }
    assert.ok(t.sd.tamlar.has(g1.ozet));
    assert.ok(t.sd.tamlar.has(g2.ozet));
  });
});

describe("E2: saklama süresi servisin gözlediği zamanla sayılır", () => {
  it("(a) PC 40 gün kapalı: açılıştaki tur silmez; telefonun geri_yukle'si gelince işaret kalkar", async () => {
    const t = kur();
    const g = await geriAlinabilir(t);
    await t.ekler.kapat();
    // Telefon 10. gün çevrimdışı geri aldı; PC 40. gün açıldı, telefon henüz bağlanmadı.
    t.zaman.ilerlet(40 * GUN);
    await t.yenidenAc();
    assert.equal((await t.ekler.temizle()).silinen, 0);
    assert.equal((await calis(t, 3 * SAAT))!.silinen, 0);
    assert.ok(t.sd.tamlar.has(g.ozet));
    t.kayitKoy(kayit("k_ek_g", [g]));
    await t.ekler.temizle();
    assert.equal(t.sd.isaretler.size, 0, "yeniden başvurulan dosyanın işareti kalktı");
  });

  it("(a) kapalı geçen süre sayılmaz, çalışılan süre yeniden açılışta korunur", async () => {
    const t = kur();
    const g = await geriAlinabilir(t);
    await calis(t, 20 * GUN);
    await t.yenidenAc();
    t.zaman.ilerlet(15 * GUN);
    await t.yenidenAc();
    await t.ekler.temizle();
    assert.equal((await calis(t, 10 * GUN - 2 * SAAT))!.silinen, 0, "toplam gözlenen 30 günün altında");
    assert.ok(t.sd.tamlar.has(g.ozet));
    await calis(t, 3 * SAAT);
    assert.equal(t.sd.tamlar.has(g.ozet), false, "30 gün gözlendi: silindi");
  });

  it("(b) saat ileri sıçradı: tek turda silinmez", async () => {
    const t = kur();
    const g = await geriAlinabilir(t);
    await calis(t, 2 * SAAT);
    t.kayma.ms = 31 * GUN;
    assert.equal((await t.ekler.temizle()).silinen, 0);
    assert.equal((await calis(t, 2 * SAAT))!.silinen, 0);
    assert.ok(t.sd.tamlar.has(g.ozet));
  });

  it("(b) işaret geride kalmış saatle kondu, saat düzeldi: tek turda silinmez", async () => {
    const t = kur();
    t.kayma.ms = -40 * GUN;
    const g = await geriAlinabilir(t);
    await calis(t, 2 * SAAT);
    t.kayma.ms = 0;
    assert.equal((await t.ekler.temizle()).silinen, 0);
    assert.ok(t.sd.tamlar.has(g.ozet));
  });

  it("(b) işaret ileride kalmış saatle kondu, saat düzeldi: saklama bir yıl uzamaz, 30 gözlenen günde silinir", async () => {
    const t = kur();
    t.kayma.ms = 365 * GUN;
    const g = await geriAlinabilir(t);
    t.kayma.ms = 0;
    await calis(t, SAKLAMA - 2 * SAAT);
    assert.ok(t.sd.tamlar.has(g.ozet));
    await calis(t, 3 * SAAT);
    assert.equal(t.sd.tamlar.has(g.ozet), false);
  });
});

describe("E3: turlar arasında yeniden başvurulan dosyanın süresi baştan", () => {
  it("29,9. gün geri_yukle, aynı saat içinde yeniden sil: sonraki tur eski işaretle silmez", async () => {
    const t = kur();
    const g = await geriAlinabilir(t);
    await calis(t, SAKLAMA - 3 * SAAT);
    // Tur arasında: geri yükle ve yeniden sil (iki kayıt yazımı, hiçbir tur görmedi).
    t.zaman.ilerlet(10 * 60 * 1000);
    t.kayitKoy(kayit("k_ek_g", [g]));
    t.kayitKoy(kayit("k_ek_g", [g], { silindi: true }));
    assert.equal((await calis(t, 5 * SAAT))!.silinen, 0);
    assert.ok(t.sd.tamlar.has(g.ozet), "süre yeniden silmeden başladı");
    await calis(t, SAKLAMA - 6 * SAAT);
    assert.ok(t.sd.tamlar.has(g.ozet));
    await calis(t, 3 * SAAT);
    assert.equal(t.sd.tamlar.has(g.ozet), false);
  });
});

describe("İkinci tur (1): kısa ömürlü süreçte gözlenen süre ilerler (PC kapalı süre yine sayılmaz)", () => {
  it("süreç her açılışta 50 dk yaşar: kapanış son turdan beri gözleneni yazar, 30 gözlenen günde silinir", async () => {
    const t = kur();
    const g = await geriAlinabilir(t);
    const OMUR = 50 * 60 * 1000;
    const KAPALI = 10 * 60 * 1000;
    const adet = SAKLAMA / OMUR;
    for (let i = 1; i <= adet; i++) {
      t.zaman.ilerlet(OMUR);
      await t.yenidenAc(); // kapanış: son turdan bu yana 50 dk
      t.zaman.ilerlet(KAPALI); // PC kapalı: sayılmaz
      const s = await t.ekler.temizle(); // açılış turu: 0 sayar
      if (i < adet) {
        assert.equal(s.silinen, 0, `açılış ${i}`);
        assert.equal(t.sd.isaretler.get(g.ozet)?.gozlenen_ms, i * OMUR, `açılış ${i}: yalnız çalışılan süre`);
      } else {
        assert.equal(s.silinen, 1);
      }
    }
    assert.equal(t.sd.tamlar.has(g.ozet), false);
  });

  it("kapanışta sayım da tur adımıyla sınırlı; turu olmamış süreç ve geri giden saat hiç saymaz", async () => {
    const t = kur();
    const g = await geriAlinabilir(t);
    // Son turdan 10 sa sonra kapanış (uyku, askıya alma): en çok GOZLEM_ADIMI_MS.
    t.zaman.ilerlet(10 * SAAT);
    await t.yenidenAc();
    assert.equal(t.sd.isaretler.get(g.ozet)?.gozlenen_ms, AJANDA_EK_SINIRLARI.GOZLEM_ADIMI_MS);
    // Bu süreçte hiç tur olmadı: kapanış saymaz.
    t.zaman.ilerlet(SAAT);
    await t.yenidenAc();
    assert.equal(t.sd.isaretler.get(g.ozet)?.gozlenen_ms, AJANDA_EK_SINIRLARI.GOZLEM_ADIMI_MS);
    // Saat geri gitti: kapanış saymaz.
    await t.ekler.temizle();
    t.kayma.ms = -5 * SAAT;
    await t.yenidenAc();
    assert.equal(t.sd.isaretler.get(g.ozet)?.gozlenen_ms, AJANDA_EK_SINIRLARI.GOZLEM_ADIMI_MS);
    // Kapanış yinelenirse yeniden saymaz.
    t.kayma.ms = 0;
    await t.ekler.temizle();
    t.zaman.ilerlet(30 * 60 * 1000);
    await t.ekler.kapat();
    await t.ekler.kapat();
    assert.equal(t.sd.isaretler.get(g.ozet)?.gozlenen_ms, AJANDA_EK_SINIRLARI.GOZLEM_ADIMI_MS + 30 * 60 * 1000);
  });
});

describe("İkinci tur (2): yarım silme kararı parçadan sonra yeniden denetlenir", () => {
  it("tur başlamadan sıraya girmiş parça listeden sonra biterse yeni yazılan yarım silinmez", async () => {
    const t = kur();
    const e = ekUret("ek_y", 300);
    t.kayitKoy(kayit("k_y", [e]));
    const gelen: Msg[] = [];
    const o = t.ekler.oturumAc({ gonder: (m: AjandaEkYaniti) => gelen.push(m as Msg) });
    const cerceve = (m: Msg): void => o.cerceve({ v: AJANDA_SURUMU, ...m } as AjandaEkCercevesi);
    const yukle = { type: "ek_yukle", istek_id: "i", kayit_id: "k_y", ek_id: e.ek_id, ozet: e.ozet, bayt: e.bayt };
    const parca = (ofset: number, n: number) => ({
      type: "ek_parca",
      ek_id: e.ek_id,
      ofset,
      veri: Buffer.from(e.veri.slice(ofset, ofset + n)).toString("base64"),
    });
    cerceve(yukle);
    await t.ekler.bekle();
    cerceve(parca(0, 100));
    await t.ekler.bekle();
    // Yarım bir günden eski; istemci kaldığı yerden sürer.
    t.zaman.ilerlet(25 * SAAT);
    cerceve(yukle);
    await t.ekler.bekle();
    assert.equal(gelen.at(-1)?.alinan, 100);

    // Parça diske yazılırken (sırada, turdan önce) bekletilir.
    let birak = (): void => {};
    const kapi = new Promise<void>((coz) => (birak = coz));
    let ulasti = false;
    const asil = t.sd.disk.yarimaEkle;
    t.sd.disk.yarimaEkle = async (ozet, ofset, veri) => {
      ulasti = true;
      await kapi;
      return asil(ozet, ofset, veri);
    };
    const tik = () => new Promise<void>((coz) => setImmediate(coz));
    cerceve(parca(100, 100));
    while (!ulasti) await tik();
    t.zaman.ilerlet(1);
    const listeler = () => t.sd.cagrilar.filter((c) => c === "tamListesi").length;
    const once = listeler();
    const tur = t.ekler.temizle();
    while (listeler() === once) await tik();
    for (let i = 0; i < 10; i++) await tik();
    birak();
    const s = await tur;
    await t.ekler.bekle();
    assert.equal(s.yarim_silinen, 0);
    assert.equal(t.sd.yarimlar.get(e.ozet)?.onay, 200, "parçanın yazdığı ilerleme duruyor");
    assert.equal(gelen.at(-1)?.alinan, 200);
  });
});

describe("İkinci tur (4): silme döngüsü işaretleri her dosyada baştan dolaşmaz", () => {
  it("her silmede kayıtlar değişse de dolaşma sabit; arada geri yüklenip yeniden silinen dosya korunur", async () => {
    const t = kur();
    const N = 60;
    const dosyalar: Ek[] = [];
    for (let i = 0; i < N; i++) {
      const e = ekUret(`ek_${i}`, 10, i + 1);
      dosyalar.push(e);
      t.sd.tamlar.set(e.ozet, e.veri);
      t.kayitKoy(kayit(`k_${i}`, [e], { silindi: true }));
    }
    assert.equal((await t.ekler.temizle()).isaretlenen, N);
    // Süresi dolmuş say (duvar saati ve gözlenen süre).
    const simdi = t.zaman.saat.simdiMs();
    for (const [ozet, i] of t.sd.isaretler) t.sd.isaretler.set(ozet, { ...i, ilk_ms: simdi - SAKLAMA, gozlenen_ms: SAKLAMA });

    // Turun okuduğu işaret kümesinin kaç kez baştan dolaşıldığı.
    const sayim = { dolasma: 0, okuma: 0 };
    class SayanMap<K, V> extends Map<K, V> {
      override [Symbol.iterator](): MapIterator<[K, V]> {
        sayim.dolasma += 1;
        return super[Symbol.iterator]();
      }
    }
    t.sd.disk.isaretleriOku = async () => {
      sayim.okuma += 1;
      return new SayanMap(t.sd.isaretler);
    };
    const z = dosyalar[N - 1]!;
    const asilSil = t.sd.disk.tamSil;
    let ilk = true;
    t.sd.disk.tamSil = async (ozet) => {
      await asilSil(ozet);
      // Her silmede kayıtlar değişir (başka cihaz yazıyor); ilk silmede son dosya geri yüklenip yeniden silinir.
      t.kayitKoy(kayit(`k_baska_${ozet.slice(0, 8)}`, []));
      if (ilk) {
        ilk = false;
        t.kayitKoy(kayit(`k_${N - 1}`, [z]));
        t.kayitKoy(kayit(`k_${N - 1}`, [z], { silindi: true }));
      }
    };
    const s = await t.ekler.temizle();
    assert.equal(s.silinen, N - 1);
    assert.ok(t.sd.tamlar.has(z.ozet), "arada yeniden başvurulan dosyanın süresi baştan");
    assert.equal(sayim.okuma, 1);
    assert.ok(sayim.dolasma < 10, `dolaşma ${sayim.dolasma}`);
  });
});

describe("İkinci tur (7): sahte disk gerçek port gibi geçersiz işareti reddeder", () => {
  it("eksi ya da tam sayı olmayan rev, eksi gözlenen süre atar; hiçbir şey yazılmaz", async () => {
    const t = kur();
    const a = "a".repeat(64);
    for (const i of [
      { ilk_ms: 1, gozlenen_ms: 0, rev: -1 },
      { ilk_ms: 1, gozlenen_ms: 0, rev: 1.5 },
      { ilk_ms: 1, gozlenen_ms: -1, rev: 0 },
    ]) {
      await assert.rejects(t.sd.disk.isaretleriYaz(new Map([[a, i]])), /gecersiz_isaret/, JSON.stringify(i));
    }
    assert.equal(t.sd.isaretler.size, 0);
  });
});
