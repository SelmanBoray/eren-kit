import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BekciAyari, BekciEylemi, BekciOlayi } from "../src/bekci.ts";
import { bekciKur } from "../src/bekci.ts";

const T0 = 1_000_000;

type Gunluk = Extract<BekciEylemi, { tur: "gunluk" }>;

const turu = <T extends BekciEylemi["tur"]>(e: readonly BekciEylemi[], tur: T): Extract<BekciEylemi, { tur: T }>[] =>
  e.filter((x): x is Extract<BekciEylemi, { tur: T }> => x.tur === tur);

const gunlukOlay = (e: readonly BekciEylemi[], olay: string): Gunluk | undefined =>
  turu(e, "gunluk").find((g) => g.olay === olay);

// Zamanı olaylardaki `simdi` ile ilerleten küçük sürücü.
const sur = (ayar?: Partial<BekciAyari>) => {
  const b = bekciKur(ayar);
  const tum: BekciEylemi[] = [];
  let t = T0;
  const ver = (o: BekciOlayi): BekciEylemi[] => {
    const e = [...b.olay(o)];
    tum.push(...e);
    return e;
  };
  const h = {
    b,
    tum,
    zaman: () => t,
    git: (ms: number) => {
      t += ms;
    },
    basla: () => ver({ tur: "basla", simdi: t }),
    basladi: (pid = 100) => ver({ tur: "ana_basladi", simdi: t, pid }),
    baslatilamadi: () => ver({ tur: "ana_baslatilamadi", simdi: t }),
    cikti: (kod: number | null = 1) => ver({ tur: "ana_cikti", simdi: t, kod }),
    cevap: (n: number) => ver({ tur: "nabiz_cevap", simdi: t, n }),
    komut: (komut: "yenile" | "kapan") => ver({ tur: "komut", simdi: t, komut }),
    tik: (ilerle = 1000) => {
      t += ilerle;
      return ver({ tur: "tik", simdi: t });
    },
    // Çıkıştan sonra her 1 sn'de tik verir; ana_baslat çıkana kadar geçen süreyi döner (bulunamazsa -1).
    beklemeOlc: (sinir = 2_000_000): number => {
      const t0 = t;
      while (t - t0 < sinir) {
        if (turu(h.tik(), "ana_baslat").length > 0) return t - t0;
      }
      return -1;
    },
    // Başlat; her `yasam` ms ayakta kalıp istenmeden çık; her çıkıştan sonraki bekleme süresini döner.
    dongu: (yasamlar: readonly number[], kod: number | null = 1): number[] => {
      h.basla();
      h.basladi(100);
      const beklemeler: number[] = [];
      for (const y of yasamlar) {
        h.git(y);
        h.cikti(kod);
        beklemeler.push(h.beklemeOlc());
        h.basladi(100);
      }
      return beklemeler;
    },
  };
  return h;
};

// Nabızlar hiç sorun çıkarmasın istenen testlerde.
const NABIZSIZ: Partial<BekciAyari> = { nabizAraligiMs: 1e12 };

describe("bekci: başlangıç ve ana_basladi (madde 1-2)", () => {
  it("basla ana_baslat ve bekci_basladi günlüğü üretir, durum baslatiliyor", () => {
    const h = sur();
    const e = h.basla();
    assert.equal(turu(e, "ana_baslat").length, 1);
    assert.ok(gunlukOlay(e, "bekci_basladi"));
    assert.equal(h.b.durum().durum, "baslatiliyor");
  });

  it("ana_basladi durumu calisiyor yapar, pid ve başlangıcı doldurur", () => {
    const h = sur();
    h.basla();
    h.git(500);
    h.basladi(4242);
    const d = h.b.durum();
    assert.equal(d.durum, "calisiyor");
    assert.equal(d.anaPid, 4242);
    assert.equal(d.anaBaslangicMs, T0 + 500);
    assert.equal(d.yenidenBaslatma, 0);
  });
});

describe("bekci: nabız (madde 3)", () => {
  it("ilk nabız ana başlangıcından nabizAraligiMs sonra gider, bir önceki gönderimden sonra yenisi", () => {
    const h = sur();
    h.basla();
    h.basladi();
    assert.equal(turu(h.tik(29_999), "nabiz_gonder").length, 0);
    const ilk = turu(h.tik(1), "nabiz_gonder");
    assert.equal(ilk.length, 1);
    const n1 = ilk[0]!.n;
    h.cevap(n1);
    assert.equal(turu(h.tik(1000), "nabiz_gonder").length, 0);
    h.git(28_999);
    const ikinci = turu(h.tik(1), "nabiz_gonder");
    assert.equal(ikinci.length, 1);
    assert.ok(ikinci[0]!.n > n1, "n artmalı");
  });

  it("cevap gelince sonNabizMs cevabın simdi değerine güncellenir", () => {
    const h = sur();
    h.basla();
    h.basladi();
    h.git(30_000);
    const n = turu(h.tik(0), "nabiz_gonder")[0]!.n;
    h.git(250);
    h.cevap(n);
    assert.equal(h.b.durum().sonNabizMs, h.zaman());
  });

  it("her nabız cevaplanırsa ana hiç öldürülmez ve n artar", () => {
    const h = sur();
    h.basla();
    h.basladi();
    const ns: number[] = [];
    for (let i = 0; i < 300; i++) {
      const e = h.tik();
      for (const g of turu(e, "nabiz_gonder")) {
        ns.push(g.n);
        h.cevap(g.n);
      }
    }
    assert.ok(ns.length >= 5);
    for (let i = 1; i < ns.length; i++) assert.ok(ns[i]! > ns[i - 1]!);
    assert.equal(turu(h.tum, "zorla_oldur").length, 0);
    assert.equal(h.b.durum().durum, "calisiyor");
  });

  it("üst üste nabizKacirmaSiniri (3) cevapsız nabızdan sonra zorla_oldur ve ana_donmus uyarısı", () => {
    const h = sur();
    h.basla();
    h.basladi();
    let nabiz = 0;
    let oldu = false;
    for (let i = 0; i < 200 && !oldu; i++) {
      const e = h.tik();
      nabiz += turu(e, "nabiz_gonder").length;
      if (turu(e, "zorla_oldur").length > 0) {
        oldu = true;
        assert.ok(nabiz >= 3, `öldürmeden önce en az 3 nabız gitmeli, gitti: ${nabiz}`);
        const g = gunlukOlay(e, "ana_donmus");
        assert.ok(g, "ana_donmus günlüğü aynı tikte gelmeli");
        assert.equal(g.seviye, "uyari");
      }
    }
    assert.ok(oldu, "200 sn içinde zorla_oldur gelmeli");
  });

  it("eski n'li cevap kaçırma sayacını sıfırlamaz", () => {
    const h = sur();
    h.basla();
    h.basladi();
    let onceki: number | null = null;
    let oldu = false;
    for (let i = 0; i < 200 && !oldu; i++) {
      const e = h.tik();
      for (const g of turu(e, "nabiz_gonder")) {
        if (onceki !== null) h.cevap(onceki); // yeni nabız gittikten sonra eskisinin geç cevabı
        onceki = g.n;
      }
      if (turu(e, "zorla_oldur").length > 0) oldu = true;
    }
    assert.ok(oldu, "geç/eski cevaplar sayacı sıfırlamamalı");
  });

  it("en son gönderilen n'in cevabı sayacı sıfırlar", () => {
    const h = sur();
    h.basla();
    h.basladi();
    let gonderilen = 0;
    // iki nabız cevapsız, üçüncüsü gidince son n cevaplanır; sayaç sıfırlanmalı
    for (let i = 0; i < 100 && gonderilen < 3; i++) {
      const e = h.tik();
      for (const g of turu(e, "nabiz_gonder")) {
        gonderilen++;
        if (gonderilen === 3) h.cevap(g.n);
      }
    }
    assert.equal(gonderilen, 3);
    // sayaç sıfırlandı: sonraki iki cevapsız nabız öldürmemeli
    let nabiz = 0;
    for (let i = 0; i < 100 && nabiz < 2; i++) {
      const e = h.tik();
      nabiz += turu(e, "nabiz_gonder").length;
      assert.equal(turu(e, "zorla_oldur").length, 0);
    }
    assert.equal(nabiz, 2);
  });
});

describe("bekci: istenmemiş çıkış ve geri çekilme (madde 4-6)", () => {
  const AYAR: Partial<BekciAyari> = { geriCekilmeMs: [1000, 2000, 5000], firtinaSiniri: 1000, ...NABIZSIZ };

  it("çıkış yenidenBaslatma'yı artırır, kodu yazar, bekliyor yapar; bekleme bitince ilk tikte ana_baslat", () => {
    const h = sur(AYAR);
    h.basla();
    h.basladi();
    h.git(20_000);
    const e = h.cikti(7);
    const d = h.b.durum();
    assert.equal(d.durum, "bekliyor");
    assert.equal(d.yenidenBaslatma, 1);
    assert.equal(d.sonCikisKodu, 7);
    const g = gunlukOlay(e, "ana_cikti");
    assert.ok(g);
    assert.equal(g.alanlar["kod"], 7);
    assert.equal(g.alanlar["yasam_ms"], 20_000);
    assert.equal(g.alanlar["bekleme_ms"], 1000);
    assert.equal(turu(e, "ana_baslat").length, 0, "çıkışın kendisi başlatmaz");
    assert.equal(turu(h.tik(999), "ana_baslat").length, 0);
    assert.equal(turu(h.tik(1), "ana_baslat").length, 1);
  });

  it("geri çekilme dizisini izler ve son elemanda sabitlenir", () => {
    const h = sur(AYAR);
    const b = h.dongu([20_000, 20_000, 20_000, 20_000, 20_000]);
    assert.deepEqual(b, [1000, 2000, 5000, 5000, 5000]);
    assert.equal(h.b.durum().yenidenBaslatma, 5);
  });

  it("ana kararliMs boyunca ayakta kalırsa sayaç sıfırlanır; bir ms eksikse sıfırlanmaz", () => {
    const k = sur({ ...AYAR, kararliMs: 50_000 });
    assert.deepEqual(k.dongu([20_000, 20_000, 50_000, 20_000]), [1000, 2000, 1000, 2000]);
    const e = sur({ ...AYAR, kararliMs: 50_000 });
    assert.deepEqual(e.dongu([20_000, 20_000, 49_999]), [1000, 2000, 5000]);
  });

  it("erken çıkışta en az erkenCikisMinBeklemeMs beklenir ve ana_erken_cikti uyarısı gelir", () => {
    const h = sur({ ...AYAR, erkenCikisMs: 15_000, erkenCikisMinBeklemeMs: 30_000 });
    h.basla();
    h.basladi();
    h.git(2000);
    const e = h.cikti(1);
    const g = gunlukOlay(e, "ana_erken_cikti");
    assert.ok(g);
    assert.equal(g.seviye, "uyari");
    assert.equal(gunlukOlay(e, "ana_cikti")?.alanlar["bekleme_ms"], 30_000);
    assert.equal(h.beklemeOlc(), 30_000);
  });

  it("erken çıkışta geri çekilme en az süreden büyükse büyük olan seçilir", () => {
    const h = sur({ ...AYAR, geriCekilmeMs: [40_000], erkenCikisMs: 15_000, erkenCikisMinBeklemeMs: 30_000 });
    assert.deepEqual(h.dongu([2000]), [40_000]);
  });

  it("erken olmayan çıkışta ana_erken_cikti yok", () => {
    const h = sur(AYAR);
    h.basla();
    h.basladi();
    h.git(20_000);
    assert.equal(gunlukOlay(h.cikti(1), "ana_erken_cikti"), undefined);
  });

  it("fırtına: pencerede sınıra ulaşınca firtinaBeklemeMs beklenir, pencere boşalınca normale döner", () => {
    const h = sur({
      geriCekilmeMs: [1000],
      erkenCikisMs: 1000,
      firtinaPencereMs: 100_000,
      firtinaSiniri: 3,
      firtinaBeklemeMs: 70_000,
      ...NABIZSIZ,
    });
    const b = h.dongu([5000, 5000, 5000, 5000, 5000]);
    assert.deepEqual(b, [1000, 1000, 70_000, 70_000, 1000]);
    const firtinalar = turu(h.tum, "gunluk").filter((g) => g.olay === "firtina");
    assert.equal(firtinalar.length, 2);
    for (const g of firtinalar) assert.equal(g.seviye, "hata");
  });

  it("ana_baslatilamadi istenmemiş çıkış gibi geri çekilir, kod null", () => {
    const h = sur({ ...AYAR, erkenCikisMinBeklemeMs: 0 });
    h.basla();
    h.baslatilamadi();
    let d = h.b.durum();
    assert.equal(d.durum, "bekliyor");
    assert.equal(d.yenidenBaslatma, 1);
    assert.equal(d.sonCikisKodu, null);
    assert.equal(h.beklemeOlc(), 1000);
    h.baslatilamadi();
    d = h.b.durum();
    assert.equal(d.yenidenBaslatma, 2);
    assert.equal(h.beklemeOlc(), 2000);
  });
});

describe("bekci: yenile (madde 7)", () => {
  const AYAR: Partial<BekciAyari> = { geriCekilmeMs: [1000, 2000, 5000], firtinaSiniri: 1000, ...NABIZSIZ };

  it("çalışırken kapat_iste, kapaniyor; çıkınca beklemeden ana_baslat, yenidenBaslatma artmaz", () => {
    const h = sur(AYAR);
    h.basla();
    h.basladi();
    h.git(20_000);
    const e = h.komut("yenile");
    assert.equal(turu(e, "kapat_iste").length, 1);
    assert.equal(h.b.durum().durum, "kapaniyor");
    h.git(300);
    const c = h.cikti(0);
    assert.equal(turu(c, "ana_baslat").length, 1);
    assert.equal(turu(c, "cik").length, 0);
    assert.equal(h.b.durum().yenidenBaslatma, 0);
  });

  it("yenile ardışık başarısız sayacını sıfırlar", () => {
    const h = sur(AYAR);
    assert.deepEqual(h.dongu([20_000, 20_000]), [1000, 2000]);
    h.komut("yenile");
    h.git(100);
    assert.equal(turu(h.cikti(0), "ana_baslat").length, 1);
    assert.equal(h.b.durum().yenidenBaslatma, 2);
    h.basladi();
    h.git(20_000);
    h.cikti(1);
    assert.equal(h.beklemeOlc(), 1000, "sayaç 0'dan başlamalı (dizinin 3. elemanı 5000 olurdu)");
    assert.equal(h.b.durum().yenidenBaslatma, 3);
  });

  it("ana beklerken (bekliyor) yenile hemen ana_baslat verir ve sayacı sıfırlar", () => {
    const h = sur(AYAR);
    assert.deepEqual(h.dongu([20_000, 20_000]), [1000, 2000]);
    h.git(20_000);
    h.cikti(1);
    assert.equal(h.b.durum().durum, "bekliyor");
    const e = h.komut("yenile");
    assert.equal(turu(e, "ana_baslat").length, 1);
    assert.equal(h.b.durum().yenidenBaslatma, 3);
    h.basladi();
    h.git(20_000);
    h.cikti(1);
    assert.equal(h.beklemeOlc(), 1000);
  });

  it("kapanmaBeklemeMs dolunca zorla_oldur gelir (öncesinde gelmez)", () => {
    const h = sur({ ...AYAR, kapanmaBeklemeMs: 40_000 });
    h.basla();
    h.basladi();
    h.git(20_000);
    h.komut("yenile");
    assert.equal(turu(h.tik(39_000), "zorla_oldur").length, 0);
    assert.equal(turu(h.tik(1000), "zorla_oldur").length, 1);
    // zorla öldürmenin ardından gelen çıkış yine yenileme olarak sürer
    assert.equal(turu(h.cikti(null), "ana_baslat").length, 1);
    assert.equal(h.b.durum().yenidenBaslatma, 0);
  });
});

describe("bekci: kapan (madde 8)", () => {
  const AYAR: Partial<BekciAyari> = { firtinaSiniri: 1000, ...NABIZSIZ };

  it("çalışırken kapat_iste, kapaniyor; ana çıkınca cik kod 0, yeniden başlatma yok", () => {
    const h = sur(AYAR);
    h.basla();
    h.basladi();
    h.git(20_000);
    const e = h.komut("kapan");
    assert.equal(turu(e, "kapat_iste").length, 1);
    assert.equal(h.b.durum().durum, "kapaniyor");
    assert.equal(turu(e, "cik").length, 0, "ana çıkmadan cik gelmemeli");
    const c = h.cikti(0);
    assert.deepEqual(turu(c, "cik"), [{ tur: "cik", kod: 0 }]);
    assert.equal(turu(c, "ana_baslat").length, 0);
  });

  it("ana kapanış sırasında hata koduyla çıksa da cik kod 0", () => {
    const h = sur(AYAR);
    h.basla();
    h.basladi();
    h.komut("kapan");
    assert.deepEqual(turu(h.cikti(1), "cik"), [{ tur: "cik", kod: 0 }]);
  });

  it("ana yoksa (bekliyor) hemen cik kod 0", () => {
    const h = sur(AYAR);
    h.dongu([20_000]);
    h.git(20_000);
    h.cikti(1);
    assert.equal(h.b.durum().durum, "bekliyor");
    assert.deepEqual(turu(h.komut("kapan"), "cik"), [{ tur: "cik", kod: 0 }]);
  });

  it("kapanmaBeklemeMs dolunca zorla_oldur, ardından çıkış gelince cik kod 0", () => {
    const h = sur({ ...AYAR, kapanmaBeklemeMs: 40_000 });
    h.basla();
    h.basladi();
    h.git(20_000);
    h.komut("kapan");
    assert.equal(turu(h.tik(39_000), "zorla_oldur").length, 0);
    assert.equal(turu(h.tik(1000), "zorla_oldur").length, 1);
    assert.deepEqual(turu(h.cikti(null), "cik"), [{ tur: "cik", kod: 0 }]);
  });
});

describe("bekci: kapaniyor iken ikinci komut (madde 9)", () => {
  const AYAR: Partial<BekciAyari> = { firtinaSiniri: 1000, ...NABIZSIZ };

  it("yenile sonrası kapan: kapan kazanır, ana çıkınca cik, ana_baslat yok", () => {
    const h = sur(AYAR);
    h.basla();
    h.basladi();
    h.komut("yenile");
    h.git(100);
    h.komut("kapan");
    const c = h.cikti(0);
    assert.deepEqual(turu(c, "cik"), [{ tur: "cik", kod: 0 }]);
    assert.equal(turu(c, "ana_baslat").length, 0);
  });

  it("kapan sonrası yenile: kapan'ı ezmez, ana çıkınca cik, ana_baslat yok", () => {
    const h = sur(AYAR);
    h.basla();
    h.basladi();
    h.komut("kapan");
    h.git(100);
    h.komut("yenile");
    const c = h.cikti(0);
    assert.deepEqual(turu(c, "cik"), [{ tur: "cik", kod: 0 }]);
    assert.equal(turu(c, "ana_baslat").length, 0);
  });

  it("art arda yenile yenile tek yeniden başlatma yapar", () => {
    const h = sur(AYAR);
    h.basla();
    h.basladi();
    h.komut("yenile");
    h.komut("yenile");
    const c = h.cikti(0);
    assert.equal(turu(c, "ana_baslat").length, 1);
    assert.equal(turu(c, "cik").length, 0);
  });
});

describe("bekci: bağımsızlık ve saflık (madde 10)", () => {
  it("iki bekciKur örneği birbirini etkilemez", () => {
    const a = sur();
    const b = sur();
    a.dongu([20_000, 20_000]);
    a.komut("kapan");
    assert.equal(b.b.durum().yenidenBaslatma, 0);
    assert.equal(b.b.durum().anaPid, null);
    const e = b.basla();
    assert.equal(turu(e, "ana_baslat").length, 1);
    assert.equal(b.b.durum().durum, "baslatiliyor");
    assert.equal(a.b.durum().yenidenBaslatma, 2);
  });

  it("aynı olay dizisi iki örnekte aynı eylemleri üretir (saat/rastgelelik yok)", () => {
    const calistir = () => {
      const h = sur();
      h.dongu([2000, 20_000, 20_000]);
      for (let i = 0; i < 100; i++) h.tik();
      h.komut("yenile");
      h.cikti(0);
      return h.tum;
    };
    assert.deepEqual(calistir(), calistir());
  });

  it("gerçek saatten bağımsız: simdi çok eski ya da çok ileri olsa da aynı davranış", () => {
    const h = bekciKur({ geriCekilmeMs: [1000], ...NABIZSIZ });
    const uzak = 9_000_000_000_000;
    h.olay({ tur: "basla", simdi: uzak });
    h.olay({ tur: "ana_basladi", simdi: uzak, pid: 1 });
    h.olay({ tur: "ana_cikti", simdi: uzak + 20_000, kod: 1 });
    assert.equal(turu(h.olay({ tur: "tik", simdi: uzak + 20_999 }), "ana_baslat").length, 0);
    assert.equal(turu(h.olay({ tur: "tik", simdi: uzak + 21_000 }), "ana_baslat").length, 1);
  });
});

describe("bekci: günlük alanları (madde 11)", () => {
  it("alan değerleri yalnız sayı, boolean, null ya da kısa kapalı liste dizgesidir", () => {
    const h = sur({ firtinaSiniri: 3, firtinaPencereMs: 600_000 });
    // erken çıkış, normal çıkış, fırtına
    h.dongu([2000, 20_000, 20_000, 20_000]);
    // donma
    for (let i = 0; i < 200; i++) h.tik();
    // yenile, kapan
    h.komut("yenile");
    h.cikti(0);
    h.basladi();
    h.komut("kapan");
    h.cikti(0);
    const gunlukler = turu(h.tum, "gunluk");
    assert.ok(gunlukler.length >= 5);
    const olaylar = new Set(gunlukler.map((g) => g.olay));
    for (const beklenen of ["bekci_basladi", "ana_cikti", "ana_erken_cikti", "firtina", "ana_donmus"]) {
      assert.ok(olaylar.has(beklenen), `${beklenen} günlüğü üretilmeli`);
    }
    for (const g of gunlukler) {
      assert.ok(["bilgi", "uyari", "hata"].includes(g.seviye));
      assert.match(g.olay, /^[a-z0-9_]{1,40}$/);
      for (const [anahtar, v] of Object.entries(g.alanlar)) {
        assert.match(anahtar, /^[a-z0-9_]{1,40}$/);
        if (typeof v === "string") {
          assert.match(v, /^[a-z0-9_-]{1,32}$/, `${g.olay}.${anahtar} serbest metin/yol olamaz: ${v}`);
        } else {
          assert.ok(v === null || typeof v === "number" || typeof v === "boolean", `${g.olay}.${anahtar} tür dışı`);
        }
      }
    }
  });
});

describe("bekci: varsayılan değerler (sözleşmedeki sayılar)", () => {
  it("geri çekilme [1000,2000,5000,10000,30000,60000], son elemanda sabit; 8. yeniden başlatmada fırtına 300000", () => {
    const h = sur(NABIZSIZ);
    const b = h.dongu(Array.from({ length: 8 }, () => 20_000));
    assert.deepEqual(b, [1000, 2000, 5000, 10_000, 30_000, 60_000, 60_000, 300_000]);
    assert.ok(gunlukOlay(h.tum, "firtina"));
  });

  it("varsayılan: 7 yeniden başlatma fırtına sayılmaz", () => {
    const h = sur(NABIZSIZ);
    h.dongu(Array.from({ length: 7 }, () => 20_000));
    assert.equal(gunlukOlay(h.tum, "firtina"), undefined);
  });

  it("varsayılan kararlilik: 600000 ms ayakta kalan ana sayacı sıfırlar", () => {
    const h = sur(NABIZSIZ);
    assert.deepEqual(h.dongu([20_000, 20_000, 599_999, 20_000, 600_000, 20_000]), [1000, 2000, 5000, 10_000, 1000, 2000]);
  });

  it("varsayılan erken çıkış: 15000 ms altı erken (en az 30000 bekle), tam 15000 erken değil", () => {
    const h = sur(NABIZSIZ);
    assert.deepEqual(h.dongu([14_999]), [30_000]);
    const g = sur(NABIZSIZ);
    assert.deepEqual(g.dongu([15_000]), [1000]);
  });

  it("varsayılan nabız aralığı 30000 ms, kaçırma sınırı 3", () => {
    const h = sur();
    h.basla();
    h.basladi();
    assert.equal(turu(h.tik(29_999), "nabiz_gonder").length, 0);
    assert.equal(turu(h.tik(1), "nabiz_gonder").length, 1);
    // 2. ve 3. nabız da cevapsız; 3. nabızdan önce öldürme yok
    assert.equal(turu(h.tik(29_999), "zorla_oldur").length, 0);
    assert.equal(turu(h.tik(1), "nabiz_gonder").length, 1);
    assert.equal(turu(h.tik(29_999), "zorla_oldur").length, 0);
    const ucuncu = h.tik(1);
    assert.equal(turu(ucuncu, "nabiz_gonder").length, 1);
    let oldu = turu(ucuncu, "zorla_oldur").length > 0;
    for (let i = 0; i < 31 && !oldu; i++) oldu = turu(h.tik(), "zorla_oldur").length > 0;
    assert.ok(oldu, "3 cevapsız nabızdan sonra bir sonraki nabız aralığı içinde zorla_oldur");
  });

  it("varsayılan kapanmaBeklemeMs 40000", () => {
    const h = sur(NABIZSIZ);
    h.basla();
    h.basladi();
    h.komut("kapan");
    assert.equal(turu(h.tik(39_999), "zorla_oldur").length, 0);
    assert.equal(turu(h.tik(1), "zorla_oldur").length, 1);
  });
});
