// Yapısal değişmezler: Kotlin kaynaklarını tarar (çekirdek ve adaptör aynı modülde derlendiği için
// derleyici bu kuralları korumaz). Kaynak: TASARIM.md "Köprü API ve yapısal sınırlar" ve
// AdaptorSozlesmesi.kt başındaki "YAPISAL DEĞİŞMEZLER". Yorumlar atlanır, dizge içerikleri boşaltılır.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const UYGULAMA = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODUL = join(UYGULAMA, "modules", "eren-device");
const ADAPTOR_KOK = join(MODUL, "android", "src", "main", "java", "dev", "eren", "cihaz", "adaptor");
const CEKIRDEK_KOK = join(MODUL, "cekirdek", "src", "main", "kotlin");
const KOPRU_TS = join(MODUL, "src", "ErenDevice.types.ts");

/** Değişmez 1: `izinler.ekle(` çağrısına izinli adaptör dosyaları (ileride genişler). */
const IZINLER_EKLE_IZINLI = ["OnayActivity.kt", "OtoIzinKapisi.kt"];
/** Değişmez 5: `Settings.Secure/Global/System.put*` çağrısına izinli dosyalar. */
const SETTINGS_PUT_IZINLI = ["ErisimAnahtari.kt"];
/** Değişmez 2: adaptörde `Kanal.CIHAZ`'a izinli dosyalar. */
const KANAL_CIHAZ_IZINLI = ["Baglanti.kt"];
/** Değişmez 4: `TamYetki.ac(` çağrısına izinli dosya (tanım `fun ac(` olduğundan çağrı sayılmaz). */
const TAM_YETKI_AC_IZINLI = ["TamYetkiActivity.kt"];
/** Değişmez 6: `KisayolDeposu.koy(` çağrısına izinli dosya. */
const KISAYOL_KOY_IZINLI = ["KisayolActivity.kt"];
/** Değişmez 3: köprünün taşıyamayacağı adlar. */
const YASAK_KOPRU_ADLARI = ["cmd", "cmd_result", "token"];

interface Ihlal {
  dosya: string;
  satir: number;
  metin: string;
}

/**
 * Yorumları (// ve iç içe geçebilen Kotlin blok yorumları) atar; satır yapısını korur.
 * `dizgeIcerigi: false` ise dizge/karakter sabitlerinin içini boşluğa çevirir (tırnaklar kalır).
 */
function yorumsuz(kaynak: string, dizgeIcerigi: boolean): string {
  let cikti = "";
  let i = 0;
  const n = kaynak.length;
  const koru = (c: string) => (c === "\n" ? "\n" : " ");
  while (i < n) {
    const c = kaynak[i];
    const s = kaynak[i + 1];
    if (c === "/" && s === "/") {
      while (i < n && kaynak[i] !== "\n") i++;
    } else if (c === "/" && s === "*") {
      let derin = 1;
      i += 2;
      cikti += "  ";
      while (i < n && derin > 0) {
        if (kaynak[i] === "/" && kaynak[i + 1] === "*") {
          derin++;
          cikti += "  ";
          i += 2;
        } else if (kaynak[i] === "*" && kaynak[i + 1] === "/") {
          derin--;
          cikti += "  ";
          i += 2;
        } else {
          cikti += koru(kaynak[i]);
          i++;
        }
      }
    } else if (c === '"' && kaynak.startsWith('"""', i)) {
      const son = kaynak.indexOf('"""', i + 3);
      const bitis = son < 0 ? n : son + 3;
      const parca = kaynak.slice(i, bitis);
      cikti += dizgeIcerigi ? parca : `"""${[...parca.slice(3, -3)].map(koru).join("")}"""`;
      i = bitis;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && kaynak[j] !== c && kaynak[j] !== "\n") j += kaynak[j] === "\\" ? 2 : 1;
      const parca = kaynak.slice(i, j + 1);
      cikti += dizgeIcerigi ? parca : `${c}${[...parca.slice(1, -1)].map(koru).join("")}${c}`;
      i = j + 1;
    } else {
      cikti += c;
      i++;
    }
  }
  return cikti;
}

function kotlinDosyalari(kok: string): string[] {
  let adlar: string[];
  try {
    adlar = readdirSync(kok);
  } catch {
    return [];
  }
  const sonuc: string[] = [];
  for (const ad of adlar) {
    const yol = join(kok, ad);
    if (statSync(yol).isDirectory()) sonuc.push(...kotlinDosyalari(yol));
    else if (ad.endsWith(".kt")) sonuc.push(yol);
  }
  return sonuc.sort();
}

/** Saf tarama: `{dosyaAdi: metin}` verilir; desene uyan ve izinli olmayan dosyalardaki geçişleri döner. */
function tara(dosyalar: Record<string, string>, desen: RegExp, izinli: readonly string[]): Ihlal[] {
  const ihlaller: Ihlal[] = [];
  const g = new RegExp(desen.source, desen.flags.includes("g") ? desen.flags : desen.flags + "g");
  for (const [dosya, metin] of Object.entries(dosyalar)) {
    const ad = dosya.split(/[\\/]/).pop() ?? dosya;
    if (izinli.includes(ad)) continue;
    const temiz = yorumsuz(metin, false);
    for (const m of temiz.matchAll(g)) {
      const satir = temiz.slice(0, m.index).split("\n").length;
      ihlaller.push({ dosya, satir, metin: metin.split("\n")[satir - 1].trim() });
    }
  }
  return ihlaller;
}

const IZINLER_EKLE = /\bizinler\b\s*\??\.\s*ekle\s*\(/;
const SETTINGS_PUT = /\b(?:Settings\s*\.\s*)?(?:Secure|Global|System)\s*\.\s*put\w*\s*\(/;
const TAM_YETKI_AC = /\bTamYetki\s*\??\.\s*ac\s*\(/;
const KISAYOL_KOY = /\bKisayolDeposu\s*\??\.\s*koy\s*\(/;
const KANAL_CIHAZ = /\bKanal\s*\.\s*CIHAZ\b/;

/** Köprü kaynağındaki yasak adlar: tanımlayıcı olarak ya da tam dizge sabiti olarak. */
function kopruYasakAdlari(metin: string, yasak: readonly string[]): string[] {
  const bulunan = new Set<string>();
  const kod = yorumsuz(metin, false);
  const dizgeli = yorumsuz(metin, true);
  for (const ad of yasak) {
    if (new RegExp(`\\b${ad}\\b`).test(kod)) bulunan.add(ad);
    if (new RegExp(`"${ad}"`).test(dizgeli)) bulunan.add(ad);
  }
  return [...bulunan];
}

/** Köprünün `Function`/`AsyncFunction` adları ve `Events` adları. */
function kopruYuzeyi(metin: string): { islevler: string[]; olaylar: string[] } {
  const kod = yorumsuz(metin, true);
  const islevler = [...kod.matchAll(/\b(?:Async)?Function\s*\(\s*"([^"]+)"/g)].map((m) => m[1]);
  const olaylar: string[] = [];
  for (const m of kod.matchAll(/\bEvents\s*\(([^)]*)\)/g)) {
    for (const d of m[1].matchAll(/"([^"]+)"/g)) olaylar.push(d[1]);
  }
  return { islevler: islevler.sort(), olaylar: olaylar.sort() };
}

/** `ErenDevice.types.ts`: `ErenDeviceModulu` yöntemleri (addListener hariç) ve `ErenDeviceOlaylari` anahtarları. */
function tsYuzeyi(metin: string): { islevler: string[]; olaylar: string[] } {
  const kod = yorumsuz(metin, true);
  const govde = (ad: string): string => {
    const bas = kod.search(new RegExp(`interface\\s+${ad}\\b`));
    if (bas < 0) return "";
    const ac = kod.indexOf("{", bas);
    let derin = 0;
    for (let i = ac; i < kod.length; i++) {
      if (kod[i] === "{") derin++;
      else if (kod[i] === "}" && --derin === 0) return kod.slice(ac + 1, i);
    }
    return "";
  };
  // Yalnız en üst düzeyi bırakır; iç içe (), <>, {}, [] içeriklerini atar, açılış işaretini tutar.
  const ustSeviye = (g: string): string => {
    let derin = 0;
    let cikti = "";
    for (const c of g) {
      if ("({<[".includes(c)) {
        if (derin === 0) cikti += c;
        derin++;
      } else if (")}>]".includes(c) && derin > 0) {
        derin--;
      } else if (derin === 0) {
        cikti += c;
      }
    }
    return cikti;
  };
  const islevler = [...ustSeviye(govde("ErenDeviceModulu")).matchAll(/(\w+)\s*<?\s*\(/g)]
    .map((m) => m[1])
    .filter((a) => a !== "addListener");
  const olaylar = [...ustSeviye(govde("ErenDeviceOlaylari")).matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
  return { islevler: [...new Set(islevler)].sort(), olaylar: olaylar.sort() };
}

function oku(yol: string): string {
  return readFileSync(yol, "utf8");
}
function dosyaHaritasi(kok: string): Record<string, string> {
  return Object.fromEntries(kotlinDosyalari(kok).map((y) => [y, oku(y)]));
}

const adaptor = dosyaHaritasi(ADAPTOR_KOK);
const cekirdek = dosyaHaritasi(CEKIRDEK_KOK);

function ozet(i: Ihlal[]): string {
  return i.map((x) => `${x.dosya}:${x.satir}: ${x.metin}`).join("\n");
}

describe("yapısal değişmez 1: izinler.ekle yalnız onay akışında", () => {
  it("adaptörde yalnız izinli dosyalarda geçer", () => {
    assert.ok(Object.keys(adaptor).length > 0, "adaptör kaynakları bulunamadı");
    const ihlal = tara(adaptor, IZINLER_EKLE, IZINLER_EKLE_IZINLI);
    assert.deepEqual(ihlal, [], ozet(ihlal));
  });
  it("sahte ihlal: başka dosyada çağrı yakalanır; yorum ve dizge sayılmaz", () => {
    const kotu = { "Eylemci.kt": "fun f() {\n  Adaptor.izinler?.ekle(kayit)\n}" };
    assert.equal(tara(kotu, IZINLER_EKLE, IZINLER_EKLE_IZINLI).length, 1);
    assert.equal(tara({ "OnayActivity.kt": "izinler.ekle(k)" }, IZINLER_EKLE, IZINLER_EKLE_IZINLI).length, 0);
    const masum = {
      "X.kt": '// izinler.ekle(a)\n/* izinler.ekle(b) /* ic */ izinler.ekle(c) */\nval s = "izinler.ekle(d)"',
    };
    assert.equal(tara(masum, IZINLER_EKLE, IZINLER_EKLE_IZINLI).length, 0);
  });
});

describe("yapısal değişmez 5: Settings.Secure/Global/System.put yalnız ErisimAnahtari'nda", () => {
  it("adaptör ve çekirdekte başka dosyada geçmez (dosya yoksa da geçer)", () => {
    const ihlal = tara({ ...adaptor, ...cekirdek }, SETTINGS_PUT, SETTINGS_PUT_IZINLI);
    assert.deepEqual(ihlal, [], ozet(ihlal));
  });
  it("sahte ihlal: Secure/Global/System put* yakalanır", () => {
    const kotu = {
      "A.kt": 'Settings.Secure.putString(cr, "k", "v")',
      "B.kt": 'Settings.Secure\n  .putInt(cr, "k", 1)',
      "D.kt": 'Settings.Global.putInt(cr, "k", 1)',
      "E.kt": 'Settings.System.putString(cr, "k", "v")',
      "F.kt": 'Settings.Global\n  .putString(cr, "k", "v")',
    };
    assert.equal(tara(kotu, SETTINGS_PUT, SETTINGS_PUT_IZINLI).length, 5);
    const izinli = { "ErisimAnahtari.kt": "Settings.Secure.putString(a,b,c)\nSettings.Global.putInt(a,b,c)\nSettings.System.putInt(a,b,c)" };
    assert.equal(tara(izinli, SETTINGS_PUT, SETTINGS_PUT_IZINLI).length, 0);
    assert.equal(tara({ "G.kt": 'val x = Settings.Global.getInt(cr, "k")' }, SETTINGS_PUT, SETTINGS_PUT_IZINLI).length, 0);
    assert.equal(
      tara({ "C.kt": '// Settings.Global.putInt(a)\nval s = "Settings.Secure.putInt("' }, SETTINGS_PUT, SETTINGS_PUT_IZINLI).length,
      0,
    );
  });
});

describe("yapısal değişmez 2: /cihaz kablosunu yalnız Baglanti sürer", () => {
  it("Kanal.CIHAZ adaptörde yalnız Baglanti.kt'de geçer", () => {
    const ihlal = tara(adaptor, KANAL_CIHAZ, KANAL_CIHAZ_IZINLI);
    assert.deepEqual(ihlal, [], ozet(ihlal));
  });
  it("sahte ihlal: başka dosyada Kanal.CIHAZ yakalanır", () => {
    const kotu = { "Eylemci.kt": "val imza = imzala(Kanal.CIHAZ, bayt)" };
    assert.equal(tara(kotu, KANAL_CIHAZ, KANAL_CIHAZ_IZINLI).length, 1);
    assert.equal(tara({ "Baglanti.kt": "Kanal.CIHAZ" }, KANAL_CIHAZ, KANAL_CIHAZ_IZINLI).length, 0);
    assert.equal(tara({ "Z.kt": '// Kanal.CIHAZ\nval s = "Kanal.CIHAZ"' }, KANAL_CIHAZ, KANAL_CIHAZ_IZINLI).length, 0);
  });
});

describe("yapısal değişmez 3: köprü yüzeyi", () => {
  const kopru = adaptor[join(ADAPTOR_KOK, "ErenDeviceModule.kt")] ?? "";

  it("köprü cmd, cmd_result, token taşımaz", () => {
    assert.ok(kopru.length > 0, "ErenDeviceModule.kt bulunamadı");
    assert.deepEqual(kopruYasakAdlari(kopru, YASAK_KOPRU_ADLARI), []);
  });
  it("işlev ve olay adları ErenDevice.types.ts ile birebir aynı", () => {
    const kt = kopruYuzeyi(kopru);
    const ts = tsYuzeyi(oku(KOPRU_TS));
    assert.ok(ts.islevler.length > 0, "TS yüzeyi çıkarılamadı (eşleşme 0)");
    assert.ok(kt.islevler.length > 0, "Kotlin yüzeyi çıkarılamadı (eşleşme 0)");
    assert.deepEqual(kt.islevler, ts.islevler);
    assert.deepEqual(kt.olaylar, ts.olaylar);
  });
  it("sahte ihlal: yasak ad ve fazladan işlev yakalanır", () => {
    assert.deepEqual(kopruYasakAdlari('AsyncFunction("x") { cmd }', YASAK_KOPRU_ADLARI), ["cmd"]);
    assert.deepEqual(kopruYasakAdlari('mapOf("token" to t)', YASAK_KOPRU_ADLARI), ["token"]);
    assert.deepEqual(kopruYasakAdlari('// token\nval s = "cmd_result geldi"', YASAK_KOPRU_ADLARI), []);
    const ts = tsYuzeyi(
      "export interface ErenDeviceModulu {\n  durum(): Promise<X>;\n  addListener<E>(o: E): void;\n}\nexport interface ErenDeviceOlaylari { a: X; }",
    );
    assert.deepEqual(ts, { islevler: ["durum"], olaylar: ["a"] });
    const kt = kopruYuzeyi('Events("a")\nAsyncFunction("durum") { -> 1 }\nAsyncFunction("cmdGonder") { -> 1 }');
    assert.notDeepEqual(kt.islevler, ts.islevler);
  });
});

describe("yapısal değişmez 4: TamYetki.ac yalnız TamYetkiActivity'de", () => {
  it("adaptör ve çekirdekte başka dosyada geçmez", () => {
    const ihlal = tara({ ...adaptor, ...cekirdek }, TAM_YETKI_AC, TAM_YETKI_AC_IZINLI);
    assert.deepEqual(ihlal, [], ozet(ihlal));
  });
  it("sahte ihlal: başka dosyada çağrı yakalanır; tanım, yorum ve dizge sayılmaz", () => {
    assert.equal(tara({ "Eylemci.kt": "fun f() { TamYetki.ac(ctx) }" }, TAM_YETKI_AC, TAM_YETKI_AC_IZINLI).length, 1);
    assert.equal(tara({ "TamYetkiActivity.kt": "TamYetki.ac(ctx)" }, TAM_YETKI_AC, TAM_YETKI_AC_IZINLI).length, 0);
    const masum = { "TamYetki.kt": 'object TamYetki {\n  fun ac(c: Context) {}\n}\n// TamYetki.ac(x)\nval s = "TamYetki.ac("' };
    assert.equal(tara(masum, TAM_YETKI_AC, TAM_YETKI_AC_IZINLI).length, 0);
  });
});

describe("yapısal değişmez 6: KisayolDeposu.koy yalnız KisayolActivity'de", () => {
  it("adaptör ve çekirdekte başka dosyada geçmez", () => {
    const ihlal = tara({ ...adaptor, ...cekirdek }, KISAYOL_KOY, KISAYOL_KOY_IZINLI);
    assert.deepEqual(ihlal, [], ozet(ihlal));
  });
  it("sahte ihlal: başka dosyada çağrı yakalanır; tanım, yorum ve dizge sayılmaz", () => {
    assert.equal(tara({ "Eylemci.kt": "KisayolDeposu.koy(k, v)" }, KISAYOL_KOY, KISAYOL_KOY_IZINLI).length, 1);
    assert.equal(tara({ "KisayolActivity.kt": "KisayolDeposu.koy(k, v)" }, KISAYOL_KOY, KISAYOL_KOY_IZINLI).length, 0);
    const masum = { "KisayolDeposu.kt": 'class KisayolDeposu {\n  fun koy(k: String) {}\n}\n// KisayolDeposu.koy(x)\nval s = "KisayolDeposu.koy("' };
    assert.equal(tara(masum, KISAYOL_KOY, KISAYOL_KOY_IZINLI).length, 0);
  });
});
