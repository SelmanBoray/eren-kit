/**
 * gunluk testleri: MODULLER.md "gunluk" değişmezlerinden yazıldı (gizli alan, kırpma, döndürme,
 * atan port). Üretim koduna bakılarak uydurulmadı.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gunlukKur } from "../src/gunluk.ts";
import type { GunlukBagimliliklari, KayitPortu, SaatPortu } from "../src/sozlesme.ts";
import { sahteKayit, sahteZaman } from "./sahte.ts";

const GIZLI_ANAHTARLAR = [
  "jeton",
  "token",
  "signature",
  "imza",
  "text",
  "metin",
  "cevap",
  "ozet",
  "gorev",
  "gorev_metni",
  "soru",
  "rapor",
  "kod",
] as const;

const ESIK = 500;

function kur(sec: Partial<GunlukBagimliliklari> = {}) {
  const zaman = sahteZaman(1_700_000_000_000);
  const kayit = sahteKayit();
  const g = gunlukKur({
    kayit,
    saat: zaman.saat,
    azamiBayt: 10 * 1024 * 1024,
    azamiDosya: 5,
    ...sec,
  });
  return { g, kayit, zaman };
}

function sonSatir(kayit: { satirlar: string[] }): Record<string, unknown> {
  const s = kayit.satirlar[kayit.satirlar.length - 1];
  assert.ok(s !== undefined, "satır yazılmadı");
  return JSON.parse(s) as Record<string, unknown>;
}

function buyukKucukVaryantlari(ad: string): string[] {
  const kume = new Set<string>([
    ad,
    ad.toUpperCase(),
    ad.toLowerCase(),
    ad[0]!.toUpperCase() + ad.slice(1),
    ad
      .split("")
      .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
      .join(""),
    ad
      .split("")
      .map((c, i) => (i % 2 === 1 ? c.toUpperCase() : c.toLowerCase()))
      .join(""),
  ]);
  return [...kume];
}

// ---------------------------------------------------------------------------------------------
// Biçim
// ---------------------------------------------------------------------------------------------

test("satır tek JSON nesnesi: ts_ms, seviye, modul, olay ve alanlar", () => {
  const { g, kayit, zaman } = kur();
  g.bilgi("konusma", "tur_basladi", { turn_id: "t1", sayi: 3, acik: true, bos: null });
  assert.equal(kayit.satirlar.length, 1);
  const s = kayit.satirlar[0]!;
  assert.ok(!s.trim().includes("\n"), "satır içinde ham satır sonu olmamalı");
  const o = sonSatir(kayit);
  assert.equal(o["ts_ms"], zaman.simdi());
  assert.equal(o["seviye"], "bilgi");
  assert.equal(o["modul"], "konusma");
  assert.equal(o["olay"], "tur_basladi");
  assert.equal(o["turn_id"], "t1");
  assert.equal(o["sayi"], 3);
  assert.equal(o["acik"], true);
  assert.equal(o["bos"], null);
});

test("üç seviye ayrı adla yazılır", () => {
  const { g, kayit } = kur();
  g.bilgi("m", "a");
  g.uyari("m", "b");
  g.hata("m", "c");
  assert.deepEqual(
    kayit.satirlar.map((s) => (JSON.parse(s) as Record<string, unknown>)["seviye"]),
    ["bilgi", "uyari", "hata"],
  );
});

test("ts_ms her çağrıda saatten okunur", () => {
  const { g, kayit, zaman } = kur();
  g.bilgi("m", "bir");
  zaman.ilerlet(2500);
  g.bilgi("m", "iki");
  const [a, b] = kayit.satirlar.map((s) => (JSON.parse(s) as { ts_ms: number }).ts_ms);
  assert.equal(b! - a!, 2500);
});

test("alanlar verilmeyince de geçerli satır yazılır", () => {
  const { g, kayit } = kur();
  g.hata("m", "yalin");
  const o = sonSatir(kayit);
  assert.equal(o["olay"], "yalin");
});

test("satır sonu içeren değer tek satırda kalır", () => {
  const { g, kayit } = kur();
  g.bilgi("m", "o", { not: "a\nb\r\nc" });
  assert.ok(!kayit.satirlar[0]!.trim().includes("\n"));
  assert.equal(sonSatir(kayit)["not"], "a\nb\r\nc");
});

test("gizli olmayan alan olduğu gibi geçer", () => {
  const { g, kayit } = kur();
  g.bilgi("m", "o", { is_id: 7, plan_id: "p-abc", durum: "bitti" });
  const o = sonSatir(kayit);
  assert.equal(o["is_id"], 7);
  assert.equal(o["plan_id"], "p-abc");
  assert.equal(o["durum"], "bitti");
});

// ---------------------------------------------------------------------------------------------
// stdout'a asla
// ---------------------------------------------------------------------------------------------

test("stdout ve stderr'e hiçbir şey yazılmaz, console çağrılmaz", () => {
  const { g } = kur();
  const yazilan: unknown[] = [];
  const oStdout = process.stdout.write.bind(process.stdout);
  const oStderr = process.stderr.write.bind(process.stderr);
  const konsol: Record<string, unknown> = {};
  const adlar = ["log", "info", "warn", "error", "debug"] as const;
  const eskiler = adlar.map((a) => console[a]);
  process.stdout.write = ((c: unknown) => {
    yazilan.push(c);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((c: unknown) => {
    yazilan.push(c);
    return true;
  }) as typeof process.stderr.write;
  for (const a of adlar) {
    console[a] = ((...x: unknown[]) => {
      konsol[a] = x;
    }) as never;
  }
  try {
    g.bilgi("m", "a", { x: 1 });
    g.uyari("m", "b", { jeton: "x" });
    g.hata("m", "c", { uzun: "z".repeat(1000) });
  } finally {
    process.stdout.write = oStdout;
    process.stderr.write = oStderr;
    adlar.forEach((a, i) => {
      console[a] = eskiler[i] as never;
    });
  }
  assert.deepEqual(yazilan, []);
  assert.deepEqual(konsol, {});
});

test("kayıt portu bozukken de stdout'a yazılmaz", () => {
  const yazilan: unknown[] = [];
  const oStdout = process.stdout.write.bind(process.stdout);
  const oErr = console.error;
  const oLog = console.log;
  process.stdout.write = ((c: unknown) => {
    yazilan.push(c);
    return true;
  }) as typeof process.stdout.write;
  console.error = (() => yazilan.push("error")) as never;
  console.log = (() => yazilan.push("log")) as never;
  try {
    const kayit: KayitPortu = {
      satirEkle: () => {
        throw new Error("EPIPE");
      },
      boyut: () => 0,
      dondur: () => {},
    };
    const { g } = kur({ kayit });
    g.hata("m", "o");
  } finally {
    process.stdout.write = oStdout;
    console.error = oErr;
    console.log = oLog;
  }
  assert.deepEqual(yazilan, []);
});

// ---------------------------------------------------------------------------------------------
// Gizli alanlar
// ---------------------------------------------------------------------------------------------

for (const ad of GIZLI_ANAHTARLAR) {
  test(`gizli anahtar "${ad}": her büyük/küçük harf biçimi "[gizli]" olur`, () => {
    for (const v of buyukKucukVaryantlari(ad)) {
      const { g, kayit } = kur();
      g.bilgi("m", "o", { [v]: "cok-gizli-deger", yan: "gorunur" });
      const o = sonSatir(kayit);
      assert.equal(o[v], "[gizli]", `anahtar ${v}`);
      assert.equal(o["yan"], "gorunur");
      assert.ok(!kayit.satirlar[0]!.includes("cok-gizli-deger"), `sızıntı: ${v}`);
    }
  });

  test(`gizli anahtar "${ad}": sayı, boolean, null ve uzun metin değeri de maskelenir`, () => {
    const degerler = [12345, true, false, null, "x".repeat(ESIK * 3), ""];
    for (const d of degerler) {
      const { g, kayit } = kur();
      g.uyari("m", "o", { [ad]: d });
      assert.equal(sonSatir(kayit)[ad], "[gizli]", `değer ${String(d).slice(0, 10)}`);
    }
  });

  test(`gizli anahtar "${ad}": üç seviyede de maskelenir`, () => {
    for (const sev of ["bilgi", "uyari", "hata"] as const) {
      const { g, kayit } = kur();
      g[sev]("m", "o", { [ad.toUpperCase()]: "sir" });
      assert.equal(sonSatir(kayit)[ad.toUpperCase()], "[gizli]");
    }
  });
}

test("gizli alanlar tek çağrıda birlikte maskelenir, diğerleri kalır", () => {
  const { g, kayit } = kur();
  const alanlar: Record<string, string> = { serbest: "acik" };
  for (const ad of GIZLI_ANAHTARLAR) alanlar[ad.toUpperCase()] = `sir-${ad}`;
  g.bilgi("m", "o", alanlar);
  const o = sonSatir(kayit);
  for (const ad of GIZLI_ANAHTARLAR) assert.equal(o[ad.toUpperCase()], "[gizli]");
  assert.equal(o["serbest"], "acik");
  assert.ok(!kayit.satirlar[0]!.includes("sir-"));
});

// ---------------------------------------------------------------------------------------------
// Kırpma
// ---------------------------------------------------------------------------------------------

test("tam 500 karakterlik metin kırpılmaz", () => {
  const { g, kayit } = kur();
  const m = "a".repeat(ESIK);
  g.bilgi("m", "o", { not: m });
  assert.equal(sonSatir(kayit)["not"], m);
});

test("500'den kısa metin kırpılmaz", () => {
  const { g, kayit } = kur();
  g.bilgi("m", "o", { not: "kisa", bir_eksik: "b".repeat(ESIK - 1) });
  const o = sonSatir(kayit);
  assert.equal(o["not"], "kisa");
  assert.equal(o["bir_eksik"], "b".repeat(ESIK - 1));
});

for (const boy of [ESIK + 1, ESIK * 2, 100_000]) {
  test(`${boy} karakterlik metin kırpılır: ilk 500 karakter korunur, kalanı sızmaz`, () => {
    const { g, kayit } = kur();
    const m = Array.from({ length: boy }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");
    g.bilgi("m", "o", { not: m });
    const v = sonSatir(kayit)["not"];
    assert.equal(typeof v, "string");
    assert.ok((v as string).startsWith(m.slice(0, ESIK)), "ilk 500 karakter korunmalı");
    assert.notEqual(v, m, "kırpılmamış");
    assert.ok(!(v as string).includes(m.slice(0, ESIK + 1)), "501. karakter sızmamalı");
    assert.ok(kayit.satirlar[0]!.length < ESIK + 400, "satır uzun kalmamalı");
  });
}

test("kırpma yalnız metne uygulanır: sayı, boolean ve null aynen kalır", () => {
  const { g, kayit } = kur();
  g.bilgi("m", "o", { n: 123456789012, b: true, z: null, e: -1.5 });
  const o = sonSatir(kayit);
  assert.equal(o["n"], 123456789012);
  assert.equal(o["b"], true);
  assert.equal(o["z"], null);
  assert.equal(o["e"], -1.5);
});

test("kırpma her metin alanına ayrı uygulanır", () => {
  const { g, kayit } = kur();
  g.bilgi("m", "o", { a: "x".repeat(2000), b: "y".repeat(2000), c: "kisa" });
  const o = sonSatir(kayit);
  assert.ok((o["a"] as string).startsWith("x".repeat(ESIK)));
  assert.ok((o["b"] as string).startsWith("y".repeat(ESIK)));
  assert.equal(o["c"], "kisa");
});

// ---------------------------------------------------------------------------------------------
// Döndürme
// ---------------------------------------------------------------------------------------------

test("boyut azamiBayt'ı aşınca dondur(azamiDosya) çağrılır", () => {
  const { g, kayit } = kur({ azamiBayt: 1000, azamiDosya: 4 });
  kayit.boyutuZorla(1001);
  g.bilgi("m", "o");
  assert.ok(kayit.dondurmeler.length >= 1, "döndürülmedi");
  assert.ok(kayit.dondurmeler.every((d) => d === 4), "azamiDosya iletilmeli");
});

test("boyut azamiBayt'a eşit ya da altındaysa döndürülmez", () => {
  const { g, kayit } = kur({ azamiBayt: 1000, azamiDosya: 4 });
  kayit.boyutuZorla(1000);
  g.bilgi("m", "a");
  kayit.boyutuZorla(0);
  g.bilgi("m", "b");
  kayit.boyutuZorla(999);
  g.bilgi("m", "c");
  assert.deepEqual(kayit.dondurmeler, []);
});

test("azamiDosya değeri olduğu gibi iletilir", () => {
  for (const n of [1, 2, 5, 9]) {
    const { g, kayit } = kur({ azamiBayt: 10, azamiDosya: n });
    kayit.boyutuZorla(11);
    g.hata("m", "o");
    assert.ok(kayit.dondurmeler.includes(n), `azamiDosya=${n}`);
  }
});

test("satırlar gerçek boyuttan birikince döndürme tetiklenir ve satırlar kaybolmaz", () => {
  const { g, kayit } = kur({ azamiBayt: 400, azamiDosya: 3 });
  for (let i = 0; i < 20; i++) g.bilgi("m", "olay_" + i, { i });
  assert.ok(kayit.dondurmeler.length >= 1, "birikmiş boyutla döndürülmeli");
  assert.equal(kayit.satirlar.length, 20, "sahte kayıt satırları saklar; hiçbiri atlanmamalı");
});

test("varsayılan sınıra yetişmeyen küçük günlük döndürülmez", () => {
  const { g, kayit } = kur();
  for (let i = 0; i < 50; i++) g.bilgi("m", "o", { i });
  assert.deepEqual(kayit.dondurmeler, []);
});

test("döndürülen çağrıdaki satır da yazılır", () => {
  const { g, kayit } = kur({ azamiBayt: 100, azamiDosya: 2 });
  kayit.boyutuZorla(5000);
  g.hata("m", "kritik", { x: 1 });
  assert.ok(kayit.satirlar.some((s) => (JSON.parse(s) as { olay: string }).olay === "kritik"));
});

// ---------------------------------------------------------------------------------------------
// Atan port: hiç atmaz
// ---------------------------------------------------------------------------------------------

function patlayanKayit(hangisi: "satirEkle" | "boyut" | "dondur" | "hepsi"): KayitPortu & { cagri: string[] } {
  const cagri: string[] = [];
  const at = (ad: string) => (): never => {
    cagri.push(ad);
    throw new Error("EPIPE " + ad);
  };
  const tamam = (ad: string, d?: number) => () => {
    cagri.push(ad);
    return d as never;
  };
  return {
    cagri,
    satirEkle: hangisi === "satirEkle" || hangisi === "hepsi" ? at("satirEkle") : (tamam("satirEkle") as never),
    boyut: hangisi === "boyut" || hangisi === "hepsi" ? at("boyut") : (tamam("boyut", 999_999_999) as never),
    dondur: hangisi === "dondur" || hangisi === "hepsi" ? at("dondur") : (tamam("dondur") as never),
  };
}

for (const hangisi of ["satirEkle", "boyut", "dondur", "hepsi"] as const) {
  test(`kayıt portu ${hangisi} atınca günlük atmaz (üç seviye)`, () => {
    const kayit = patlayanKayit(hangisi);
    const { g } = kur({ kayit, azamiBayt: 10, azamiDosya: 2 });
    assert.doesNotThrow(() => g.bilgi("m", "o", { a: 1 }));
    assert.doesNotThrow(() => g.uyari("m", "o", { jeton: "x" }));
    assert.doesNotThrow(() => g.hata("m", "o"));
    assert.ok(kayit.cagri.length > 0, "port hiç çağrılmadı: test anlamsız");
  });
}

test("satirEkle atınca sonraki çağrılar da çalışmaya devam eder", () => {
  const satirlar: string[] = [];
  let at = true;
  const kayit: KayitPortu = {
    satirEkle: (s) => {
      if (at) throw new Error("EPIPE");
      satirlar.push(s);
    },
    boyut: () => 0,
    dondur: () => {},
  };
  const { g } = kur({ kayit });
  assert.doesNotThrow(() => g.bilgi("m", "ilk"));
  at = false;
  g.bilgi("m", "ikinci");
  assert.equal(satirlar.length, 1);
  assert.equal((JSON.parse(satirlar[0]!) as { olay: string }).olay, "ikinci");
});

test("saat portu atınca günlük atmaz", () => {
  const saat: SaatPortu = {
    simdiMs: () => {
      throw new Error("saat bozuk");
    },
  };
  const { g } = kur({ saat });
  assert.doesNotThrow(() => g.bilgi("m", "o"));
  assert.doesNotThrow(() => g.hata("m", "o", { a: 1 }));
});

test("boyut() sayı olmayan değer dönerse de atmaz", () => {
  const kayit: KayitPortu = {
    satirEkle: () => {},
    boyut: () => Number.NaN,
    dondur: () => {},
  };
  const { g } = kur({ kayit, azamiBayt: 10 });
  assert.doesNotThrow(() => g.bilgi("m", "o"));
});

test("döndürme atarsa satır yine de yazılmaya çalışılır", () => {
  const satirlar: string[] = [];
  const kayit: KayitPortu = {
    satirEkle: (s) => void satirlar.push(s),
    boyut: () => 10_000,
    dondur: () => {
      throw new Error("kilitli dosya");
    },
  };
  const { g } = kur({ kayit, azamiBayt: 100, azamiDosya: 2 });
  assert.doesNotThrow(() => g.bilgi("m", "o"));
  assert.equal(satirlar.length, 1, "döndürme hatası satırı yutmamalı");
});

test("alan değeri tuhaf olsa da atmaz (döngüsel olmayan uç değerler)", () => {
  const { g } = kur();
  assert.doesNotThrow(() =>
    g.bilgi("m", "o", {
      nan: Number.NaN,
      sonsuz: Number.POSITIVE_INFINITY,
      bos_anahtar_degeri: "",
      "": "bos-anahtar",
    }),
  );
});
