/**
 * `depo/dosyaDepo.ts` birim testleri. `expo-file-system` Node'da yüklenemez (yerel modül); bu yüzden
 * modül çözümleme kancasıyla bellek içi sahte dosya sistemine yönlendirilir. Sahte, deponun kullandığı
 * yüzeyi (`File`: exists/create/delete/write/text/move/open, `FileHandle`: size/offset/readBytesSync/close,
 * `Directory`: exists/create) gerçekteki anlamıyla taklit eder ve her dosya işlemini sayar.
 * Çökme benzetimi: bir `write` verinin yalnız ilk N baytını diske bırakıp hata atar; ardından depo
 * yeniden kurulur (süreç yeniden başlar, bellekteki durum gider, disk kalır).
 *
 * `DOSYA_DEPO_YOLU` ortam değişkeni verilirse o dosya sınanır (düzeltme öncesi sürümü koşturmak için).
 */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, it } from "node:test";

const kodla = new TextEncoder();
const coz = new TextDecoder();

// ------------------------------------------------------------------------------------------------
// Sahte dosya sistemi
// ------------------------------------------------------------------------------------------------

const disk = new Map<string, Uint8Array>();
const dizinler = new Set<string>();
const sayac = new Map<string, number>();
/** Bir sonraki `write` yalnız bu kadar bayt bırakıp ölür. */
let olumNoktasi: number | null = null;

const say = (islem: string): void => {
  sayac.set(islem, (sayac.get(islem) ?? 0) + 1);
};
const toplamIslem = (): number => [...sayac.values()].reduce((a, b) => a + b, 0);

class SahteDizin {
  readonly uri: string;
  constructor(ust: string | SahteDizin, ad: string) {
    this.uri = `${typeof ust === "string" ? ust : ust.uri}/${ad}`;
  }
  get exists(): boolean {
    say("exists");
    return dizinler.has(this.uri);
  }
  create(): void {
    say("create");
    dizinler.add(this.uri);
  }
}

class SahteTutamac {
  offset: number | null = 0;
  size: number | null;
  #veri: Uint8Array;
  constructor(veri: Uint8Array) {
    this.#veri = veri;
    this.size = veri.length;
  }
  readBytesSync(n: number): Uint8Array {
    say("read");
    const bas = this.offset ?? 0;
    const parca = this.#veri.slice(bas, bas + n);
    this.offset = bas + parca.length;
    return parca;
  }
  close(): void {
    say("close");
    this.offset = null;
    this.size = null;
  }
}

class SahteDosya {
  readonly uri: string;
  constructor(dizin: SahteDizin, ad: string) {
    this.uri = `${dizin.uri}/${ad}`;
  }
  get exists(): boolean {
    say("exists");
    return disk.has(this.uri);
  }
  create(secenek?: { overwrite?: boolean }): void {
    say("create");
    if (disk.has(this.uri) && !secenek?.overwrite) throw new Error("dosya var");
    disk.set(this.uri, new Uint8Array());
  }
  delete(): void {
    say("delete");
    if (!disk.delete(this.uri)) throw new Error("dosya yok");
  }
  async write(icerik: string, secenek?: { append?: boolean }): Promise<void> {
    say("write");
    const yeni = kodla.encode(icerik);
    const onceki = secenek?.append ? (disk.get(this.uri) ?? new Uint8Array()) : new Uint8Array();
    const kalan = olumNoktasi === null ? yeni.length : Math.min(olumNoktasi, yeni.length);
    const sonuc = new Uint8Array(onceki.length + kalan);
    sonuc.set(onceki);
    sonuc.set(yeni.subarray(0, kalan), onceki.length);
    disk.set(this.uri, sonuc);
    if (olumNoktasi !== null) {
      olumNoktasi = null;
      throw new Error("süreç öldü");
    }
  }
  async text(): Promise<string> {
    say("text");
    const v = disk.get(this.uri);
    if (v === undefined) throw new Error("dosya yok");
    return coz.decode(v);
  }
  async move(hedef: SahteDosya, secenek?: { overwrite?: boolean }): Promise<void> {
    say("move");
    const v = disk.get(this.uri);
    if (v === undefined) throw new Error("dosya yok");
    if (disk.has(hedef.uri) && !secenek?.overwrite) throw new Error("hedef var");
    disk.delete(this.uri);
    disk.set(hedef.uri, v);
  }
  open(): SahteTutamac {
    say("open");
    const v = disk.get(this.uri);
    if (v === undefined) throw new Error("dosya yok");
    return new SahteTutamac(v);
  }
}

(globalThis as Record<string, unknown>)["__sahteExpoFs"] = {
  File: SahteDosya,
  Directory: SahteDizin,
  Paths: { document: "belge" },
  FileMode: { ReadWrite: "rw", ReadOnly: "r", WriteOnly: "w", Append: "wa", Truncate: "wt" },
};

const SAHTE_MODUL =
  "data:text/javascript," +
  encodeURIComponent(
    "const s = globalThis.__sahteExpoFs;" +
      "export const File = s.File, Directory = s.Directory, Paths = s.Paths, FileMode = s.FileMode;",
  );

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "expo-file-system") return { url: SAHTE_MODUL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const yol = process.env["DOSYA_DEPO_YOLU"];
const modulUrl = yol ? pathToFileURL(yol).href : new URL("../../src/depo/dosyaDepo.ts", import.meta.url).href;
const { dosyaDepoKur, kurtarmaKarari } = (await import(modulUrl)) as typeof import("../../src/depo/dosyaDepo.ts");

// ------------------------------------------------------------------------------------------------
// Yardımcılar
// ------------------------------------------------------------------------------------------------

const ANAHTAR = "olaylar";
const GUNLUK = "belge/eren-depo/olaylar";
const olay = (seq: number): string => JSON.stringify({ seq, type: "assistant_text", text: `metin ${seq} ğüş` });

const diskMetni = (uri = GUNLUK): string | undefined => {
  const v = disk.get(uri);
  return v === undefined ? undefined : coz.decode(v);
};
/** Çözümlenebilen satırlar: okuyanın (telafi) göreceği kayıtlar. */
const saglamlar = (satirlar: string[]): string[] =>
  satirlar.filter((s) => {
    try {
      JSON.parse(s);
      return true;
    } catch {
      return false;
    }
  });
/** `satir` yazılırken süreç `bayt` bayt sonra ölür. */
const olerekEkle = async (depo: ReturnType<typeof dosyaDepoKur>, satir: string, bayt: number): Promise<void> => {
  olumNoktasi = bayt;
  await assert.rejects(depo.ekle(ANAHTAR, satir), /süreç öldü/);
};

beforeEach(() => {
  disk.clear();
  dizinler.clear();
  sayac.clear();
  olumNoktasi = null;
});

// ------------------------------------------------------------------------------------------------
// Testler
// ------------------------------------------------------------------------------------------------

describe("kurtarmaKarari: her dal", () => {
  it("ana dosya varsa geçici ve işaretten bağımsız: ana", () => {
    for (const tmp of [false, true]) {
      for (const isaret of [false, true]) assert.equal(kurtarmaKarari(true, tmp, isaret), "ana");
    }
  });
  it("ana yok, geçici ve işaret var: kurtar", () => {
    assert.equal(kurtarmaKarari(false, true, true), "kurtar");
  });
  it("ana yok, işaretsiz geçici (yarım yazım olabilir): yok", () => {
    assert.equal(kurtarmaKarari(false, true, false), "yok");
  });
  it("ana yok, geçici yok, yalnız işaret: yok", () => {
    assert.equal(kurtarmaKarari(false, false, true), "yok");
  });
  it("hiçbiri yok: yok", () => {
    assert.equal(kurtarmaKarari(false, false, false), "yok");
  });
});

describe("kurtarma: depo içinde", () => {
  it("işaretli geçici dosya ana dosya yapılır, işaret silinir", async () => {
    disk.set("belge/eren-depo/a.tmp", kodla.encode("yeni"));
    disk.set("belge/eren-depo/a.tamam", new Uint8Array());
    dizinler.add("belge/eren-depo");
    const depo = dosyaDepoKur();
    assert.equal(await depo.oku("a"), "yeni");
    assert.equal(disk.has("belge/eren-depo/a.tamam"), false);
    assert.equal(disk.has("belge/eren-depo/a.tmp"), false);
  });
  it("işaretsiz geçici dosya yok sayılır", async () => {
    disk.set("belge/eren-depo/a.tmp", kodla.encode("yarı"));
    dizinler.add("belge/eren-depo");
    const depo = dosyaDepoKur();
    assert.equal(await depo.oku("a"), null);
  });
});

describe("ekle: yarım satırdan sonra", () => {
  it("(a) yeni satırla bitmeyen dosyaya eklenen kayıt okunur, yarım kayıt yalnız kendini kaybettirir", async () => {
    const depo1 = dosyaDepoKur();
    await depo1.ekle(ANAHTAR, olay(1));
    await olerekEkle(depo1, olay(2), 10);
    assert.equal(diskMetni(), `${olay(1)}\n${olay(2).slice(0, 10)}`);

    const depo2 = dosyaDepoKur(); // yeniden başlatma
    await depo2.ekle(ANAHTAR, olay(3));
    const satirlar = await depo2.satirlar(ANAHTAR);
    assert.deepEqual(saglamlar(satirlar), [olay(1), olay(3)]);
    assert.deepEqual(satirlar, [olay(1), olay(2).slice(0, 10), olay(3)]);
  });

  it("(a) dosya doğrudan yarım satırla bitiyor (çok baytlı karakterin ortası dahil)", async () => {
    const tam = kodla.encode(`${olay(1)}\n${olay(2)}`);
    dizinler.add("belge/eren-depo");
    disk.set(GUNLUK, tam.slice(0, tam.length - 5)); // "ğüş" içinde bir yerde kesilir
    const depo = dosyaDepoKur();
    await depo.ekle(ANAHTAR, olay(3));
    await depo.ekle(ANAHTAR, olay(4));
    assert.deepEqual(saglamlar(await depo.satirlar(ANAHTAR)), [olay(1), olay(3), olay(4)]);
  });

  it("(b) sağlam dosyada içerik bayt düzeyinde aynı (yeniden başlatma, satirlariYaz ve sil sonrası)", async () => {
    const depo1 = dosyaDepoKur();
    await depo1.ekle(ANAHTAR, olay(1));
    await depo1.ekle(ANAHTAR, olay(2));
    const depo2 = dosyaDepoKur();
    await depo2.ekle(ANAHTAR, olay(3));
    assert.equal(diskMetni(), `${olay(1)}\n${olay(2)}\n${olay(3)}\n`);

    await depo2.satirlariYaz(ANAHTAR, [olay(2)]);
    await depo2.ekle(ANAHTAR, olay(4));
    assert.equal(diskMetni(), `${olay(2)}\n${olay(4)}\n`);

    await depo2.satirlariYaz(ANAHTAR, []);
    await depo2.ekle(ANAHTAR, olay(5));
    assert.equal(diskMetni(), `${olay(5)}\n`);

    await depo2.sil(ANAHTAR);
    await depo2.ekle(ANAHTAR, olay(6));
    assert.equal(diskMetni(), `${olay(6)}\n`);
  });

  it("`yaz` satır sonsuz içerik bırakırsa ardından gelen `ekle` yine yeni satırda başlar", async () => {
    const depo = dosyaDepoKur();
    await depo.yaz(ANAHTAR, olay(7));
    await depo.ekle(ANAHTAR, olay(8));
    assert.deepEqual(saglamlar(await depo.satirlar(ANAHTAR)), [olay(7), olay(8)]);
  });

  it("(c) art arda iki çökme: araya ve sona yazılan sağlam kayıtlar kaybolmaz", async () => {
    const depo1 = dosyaDepoKur();
    await depo1.ekle(ANAHTAR, olay(1));
    await olerekEkle(depo1, olay(2), 7);

    const depo2 = dosyaDepoKur();
    await olerekEkle(depo2, olay(3), 12); // "\n" + olay(3)'ün 11 baytı

    const depo3 = dosyaDepoKur();
    await depo3.ekle(ANAHTAR, olay(4));
    await depo3.ekle(ANAHTAR, olay(5));
    assert.deepEqual(saglamlar(await depo3.satirlar(ANAHTAR)), [olay(1), olay(4), olay(5)]);
  });

  it("(c) ikinci çökme yalnız satır kapatmayı yazıp ölürse de kayıp yok", async () => {
    const depo1 = dosyaDepoKur();
    await depo1.ekle(ANAHTAR, olay(1));
    await olerekEkle(depo1, olay(2), 3);
    const depo2 = dosyaDepoKur();
    await olerekEkle(depo2, olay(3), 1);
    const depo3 = dosyaDepoKur();
    await depo3.ekle(ANAHTAR, olay(4));
    assert.deepEqual(saglamlar(await depo3.satirlar(ANAHTAR)), [olay(1), olay(4)]);
  });

  it("aynı süreçte başarısız yazımdan sonraki ekleme de yarım satıra yapışmaz", async () => {
    const depo = dosyaDepoKur();
    await depo.ekle(ANAHTAR, olay(1));
    await olerekEkle(depo, olay(2), 5);
    await depo.ekle(ANAHTAR, olay(3));
    assert.deepEqual(saglamlar(await depo.satirlar(ANAHTAR)), [olay(1), olay(3)]);
  });
});

describe("ekle: dosya işlemi sayısı", () => {
  it("kalıcı durumda ekleme başına işlem sayısı artmaz; yeniden başlatmadan sonraki ilk eklemede son bayt bir kez okunur", async () => {
    const depo1 = dosyaDepoKur();
    await depo1.ekle(ANAHTAR, olay(1));
    await depo1.ekle(ANAHTAR, olay(2));
    sayac.clear();
    await depo1.ekle(ANAHTAR, olay(3));
    const kalici = toplamIslem();
    const kaliciAyrinti = Object.fromEntries(sayac);

    const depo2 = dosyaDepoKur();
    sayac.clear();
    await depo2.ekle(ANAHTAR, olay(4));
    const ilk = toplamIslem();
    const ilkAyrinti = Object.fromEntries(sayac);

    console.log(`ekleme başına işlem: kalıcı=${kalici} ${JSON.stringify(kaliciAyrinti)}; ` +
      `yeniden başlatma sonrası ilk=${ilk} ${JSON.stringify(ilkAyrinti)}`);
    // Düzeltme öncesi ölçüm: klasör exists + kurtar'da 4 exists (ana, tmp, işaret, işaret yine)
    // + dosya exists + write = 7.
    assert.equal(kalici, 7);
    assert.equal(sayac.get("write"), 1);
    assert.ok(ilk <= kalici + 3, "ilk ekleme en çok open + 1 bayt read + close fazlası");
  });
});
