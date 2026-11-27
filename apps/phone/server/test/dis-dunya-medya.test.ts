// Medya dosya portu (S2) gerçek dosya sistemiyle, geçici dizinde: yol geçişi, bağ (junction, sembolik,
// sabit bağ) saldırıları, ofset kuralı, taşıma, silme. Windows'a özgü (win32 yolları, junction).
import { after, before, describe, test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MedyaBicimi, MedyaDosyaAdi, MedyaDosyaPortu } from "../src/sozlesme.ts";
import { medyaDosyaKur } from "../src/dis-dunya.ts";

const win = process.platform === "win32";
const BICIMLER: MedyaBicimi[] = ["jpg", "png", "webp", "heic", "mp4", "mov", "3gp", "webm"];
const ADLAR: MedyaDosyaAdi[] = [
  ...BICIMLER.map((b) => `asil.${b}` as const),
  "gorsel.jpg",
  ...([1, 2, 3, 4, 5, 6, 7, 8] as const).map((i) => `kare-0${i}.jpg` as const),
  "dokum.srt",
  "dokum.txt",
];
const b = (s: string): Uint8Array => new TextEncoder().encode(s);
const metin = (u: Uint8Array | null): string | null => (u === null ? null : Buffer.from(u).toString());

describe("medyaDosyaKur (gerçek dosya sistemi)", { skip: !win }, () => {
  let ust = "";
  let kok = "";
  let disari = ""; // kökün dışında, saldırının hedefi
  let p: MedyaDosyaPortu;
  let sayac = 0;

  /** Her test kendi kökünü alır: `<geçici>\<n>\medya`. */
  const yeniKok = (): { kok: string; p: MedyaDosyaPortu } => {
    sayac += 1;
    const k = join(ust, `k${sayac}`, "medya");
    return { kok: k, p: medyaDosyaKur({ kok: k }) };
  };
  const junction = (ctx: TestContext, hedef: string, bag: string): boolean => {
    try {
      symlinkSync(hedef, bag, "junction");
      return true;
    } catch {
      ctx.skip("junction kurulamadı");
      return false;
    }
  };
  /** Dış hedef dizin: içinde dokunulmaması gereken dosyalar. */
  const disHedef = (ad: string): string => {
    const d = join(disari, ad);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "dokunma.txt"), "gizli");
    writeFileSync(join(d, "asil.jpg"), "gizli");
    writeFileSync(join(d, "5.part"), "gizli");
    return d;
  };
  const dokunulmadi = (d: string, adlar: string[]): void => {
    assert.deepEqual(readdirSync(d).sort(), adlar.sort(), "hedef dizine yeni dosya girmedi");
    for (const a of adlar) assert.equal(readFileSync(join(d, a), "utf8"), "gizli", a);
  };

  before(() => {
    ust = mkdtempSync(join(tmpdir(), "eren-medya-"));
    disari = join(ust, "disari");
    mkdirSync(disari);
    ({ kok, p } = yeniKok());
  });
  after(() => {
    rmSync(ust, { recursive: true, force: true });
  });

  describe("kurulum ve saf yollar", () => {
    test("kök mutlak olmalı ve adı medya olmalı", () => {
      assert.throws(() => medyaDosyaKur({ kok: "medya" }), RangeError);
      assert.throws(() => medyaDosyaKur({ kok: ".\\veri\\medya" }), RangeError);
      assert.throws(() => medyaDosyaKur({ kok: join(ust, "baska") }), RangeError);
      assert.throws(() => medyaDosyaKur({ kok: join(ust, "medya", "..") }), RangeError, "normalleşince adı medya değil");
      assert.doesNotThrow(() => medyaDosyaKur({ kok: join(ust, "MEDYA") }));
    });

    test("yol, dizinYolu, goreliYol: kapalı listedeki her ad kökün altında", () => {
      assert.equal(p.dizinYolu(7), `${kok}\\7`);
      for (const ad of ADLAR) {
        assert.equal(p.yol(7, ad), `${kok}\\7\\${ad}`);
        assert.equal(p.goreliYol(7, ad), `medya/7/${ad}`);
      }
      assert.equal(p.yol(Number.MAX_SAFE_INTEGER, "gorsel.jpg"), `${kok}\\9007199254740991\\gorsel.jpg`);
      // dosyaya dokunmaz
      assert.equal(existsSync(kok), false);
    });

    test("geçersiz no atar (yol geçişi dahil)", () => {
      const kotu: unknown[] = [0, -1, 1.5, Number.NaN, Infinity, 2 ** 53, "1", "..", "..\\..\\x", "1\\..\\..", null, 1n];
      for (const no of kotu) {
        assert.throws(() => p.dizinYolu(no as number), RangeError, String(no));
        assert.throws(() => p.yol(no as number, "gorsel.jpg"), RangeError, String(no));
        assert.throws(() => p.goreliYol(no as number, "gorsel.jpg"), RangeError, String(no));
      }
    });

    test("kapalı liste dışı ad atar (yol geçişi, büyük harf, ADS, ayrılmış ad)", () => {
      const kotu = [
        "",
        "..",
        "..\\x",
        "../x",
        "gorsel.jpg\\..\\..\\x",
        "C:\\Windows\\win.ini",
        "\\\\?\\C:\\x",
        "asil.exe",
        "asil.JPG",
        "ASIL.jpg",
        "asil.jpg ",
        "asil.jpg.",
        "asil.jpg:gizli",
        "asil.part",
        "kare-00.jpg",
        "kare-09.jpg",
        "kare-1.jpg",
        "dokum.txt\u0000",
        "CON",
        "NUL.txt",
      ];
      for (const ad of kotu) {
        assert.throws(() => p.yol(1, ad as MedyaDosyaAdi), RangeError, JSON.stringify(ad));
        assert.throws(() => p.goreliYol(1, ad as MedyaDosyaAdi), RangeError, JSON.stringify(ad));
      }
    });

    test("geçersiz ad ve no dosya işlemlerinde de atar, diske dokunmaz", async () => {
      const { kok: k, p: q } = yeniKok();
      await assert.rejects(q.boyut(1, "../x" as MedyaDosyaAdi), RangeError);
      await assert.rejects(q.oku(1, "asil.exe" as MedyaDosyaAdi, 10), RangeError);
      await assert.rejects(q.yaz(1, "..\\..\\x" as MedyaDosyaAdi, b("x")), RangeError);
      await assert.rejects(q.tasi(1, "exe" as MedyaBicimi), RangeError);
      await assert.rejects(q.tasi(1, "jpg\\..\\..\\x" as MedyaBicimi), RangeError);
      await assert.rejects(q.parcaEkle(0, 0, b("x")), RangeError);
      await assert.rejects(q.parcaEkle(-3, 0, b("x")), RangeError);
      await assert.rejects(q.parcaBoyutu(1.5), RangeError);
      await assert.rejects(q.parcaOku(Number.NaN, 0, 1), RangeError);
      await assert.rejects(q.parcaSil("..\\x" as unknown as number), RangeError);
      assert.equal(existsSync(k), false);
    });
  });

  describe("parçalar (gelen\\<no>.part)", () => {
    test("sıralı ekleme, boyut, aralıklı okuma, silme", async () => {
      const { kok: k, p: q } = yeniKok();
      assert.equal(await q.parcaBoyutu(5), null);
      assert.deepEqual(await q.parcaOku(5, 0, 10), new Uint8Array(0));
      assert.equal(await q.parcaEkle(5, 0, b("merhaba ")), 8);
      assert.equal(await q.parcaEkle(5, 8, b("dünya")), 14);
      assert.equal(await q.parcaEkle(5, 14, new Uint8Array(0)), 14, "boş parça");
      assert.equal(await q.parcaBoyutu(5), 14);
      assert.equal(readFileSync(join(k, "gelen", "5.part"), "utf8"), "merhaba dünya");
      assert.equal(metin(await q.parcaOku(5, 0, 7)), "merhaba");
      assert.equal(metin(await q.parcaOku(5, 8, 100)), "dünya");
      assert.equal((await q.parcaOku(5, 14, 10)).length, 0);
      assert.equal((await q.parcaOku(5, 1000, 10)).length, 0);
      await assert.rejects(q.parcaOku(5, -1, 10), RangeError);
      await assert.rejects(q.parcaOku(5, 0, -1), RangeError);
      assert.deepEqual(await q.parcalar(), [5]);
      await q.parcaSil(5);
      assert.equal(await q.parcaBoyutu(5), null);
      await assert.doesNotReject(q.parcaSil(5), "yoksa sessiz");
      await assert.doesNotReject(q.parcaSil(6));
    });

    test("ofset dosya boyuyla uyuşmuyorsa hiç yazmaz ve atar", async () => {
      const { kok: k, p: q } = yeniKok();
      await assert.rejects(q.parcaEkle(3, 4, b("x")), /ofset/, "dosya yokken ofset 0 olmalı");
      assert.equal(existsSync(join(k, "gelen", "3.part")), false, "yokken ofset yanlışsa dosya kurulmaz");
      await q.parcaEkle(3, 0, b("abcd"));
      for (const ofset of [0, 3, 5, 1000]) {
        await assert.rejects(q.parcaEkle(3, ofset, b("ZZZZ")), /ofset/, String(ofset));
      }
      await assert.rejects(q.parcaEkle(3, -1, b("Z")), RangeError);
      await assert.rejects(q.parcaEkle(3, 1.5, b("Z")), RangeError);
      assert.equal(readFileSync(join(k, "gelen", "3.part"), "utf8"), "abcd", "hiçbir bayt yazılmadı");
      assert.equal(await q.parcaEkle(3, 4, b("e")), 5);
    });

    test("aynı ofsete eşzamanlı iki ekleme: biri yazar, öteki atar", async () => {
      const { kok: k, p: q } = yeniKok();
      const sonuc = await Promise.allSettled([q.parcaEkle(9, 0, b("AAAA")), q.parcaEkle(9, 0, b("BBBBBB"))]);
      assert.deepEqual(
        sonuc.map((s) => s.status),
        ["fulfilled", "rejected"],
      );
      assert.equal(readFileSync(join(k, "gelen", "9.part"), "utf8"), "AAAA");
    });

    test("parcalar yalnız <tam sayı>.part düz dosyalarını sayar", async (ctx) => {
      const { kok: k, p: q } = yeniKok();
      assert.deepEqual(await q.parcalar(), [], "gelen yokken boş");
      await q.parcaEkle(12, 0, b("x"));
      await q.parcaEkle(3, 0, b("x"));
      const g = join(k, "gelen");
      for (const ad of ["abc.part", "0.part", "01.part", "-1.part", "5.tmp", "5", "1e3.part", "99999999999999999999.part"]) {
        writeFileSync(join(g, ad), "x");
      }
      mkdirSync(join(g, "7.part"));
      if (junction(ctx, disHedef("parcalar"), join(g, "8.part"))) {
        assert.deepEqual(await q.parcalar(), [3, 12]);
      }
    });
  });

  describe("taşıma, boyut, okuma, yazma, dizinler", () => {
    test("tasi: gelen\\<no>.part → <no>\\asil.<bicim>", async () => {
      const { kok: k, p: q } = yeniKok();
      await assert.rejects(q.tasi(4, "mp4"), /parça yok/, "kaynak yokken");
      await q.parcaEkle(4, 0, b("video"));
      await q.tasi(4, "mp4");
      assert.equal(await q.parcaBoyutu(4), null);
      assert.equal(readFileSync(join(k, "4", "asil.mp4"), "utf8"), "video");
      assert.equal(await q.boyut(4, "asil.mp4"), 5);

      await q.parcaEkle(4, 0, b("ikinci"));
      await assert.rejects(q.tasi(4, "mp4"), /zaten var/, "hedef varsa");
      assert.equal(await q.parcaBoyutu(4), 6, "kaynak yerinde kaldı");
      assert.equal(readFileSync(join(k, "4", "asil.mp4"), "utf8"), "video", "hedef ezilmedi");
    });

    test("boyut, oku (azami bayt), yaz (dizin yoksa atar, geçici dosya kalmaz)", async () => {
      const { kok: k, p: q } = yeniKok();
      assert.equal(await q.boyut(2, "gorsel.jpg"), null);
      assert.equal(await q.oku(2, "gorsel.jpg", 100), null);
      await assert.rejects(q.yaz(2, "dokum.txt", b("x")), /dizin yok/);
      assert.equal(existsSync(join(k, "2")), false);

      await q.parcaEkle(2, 0, b("foto"));
      await q.tasi(2, "jpg");
      await q.yaz(2, "dokum.txt", b("[00:01] selam"));
      await q.yaz(2, "dokum.txt", b("[00:02] ikinci"));
      assert.equal(metin(await q.oku(2, "dokum.txt", 1000)), "[00:02] ikinci");
      assert.equal(await q.boyut(2, "dokum.txt"), 14);
      assert.deepEqual(readdirSync(join(k, "2")).sort(), ["asil.jpg", "dokum.txt"], "geçici dosya kalmadı");
      assert.equal(metin(await q.oku(2, "asil.jpg", 4)), "foto", "tam sınırda okunur");
      await assert.rejects(q.oku(2, "asil.jpg", 3), RangeError, "sınırdan büyükse atar");
      await assert.rejects(q.oku(2, "asil.jpg", -1), RangeError);
    });

    test("dizinler: yalnız kökün altındaki tam sayı adlı gerçek dizinler", async (ctx) => {
      const { kok: k, p: q } = yeniKok();
      assert.deepEqual(await q.dizinler(), [], "kök yokken boş");
      await q.parcaEkle(10, 0, b("x"));
      await q.tasi(10, "png");
      mkdirSync(join(k, "2"));
      for (const ad of ["abc", "01", "0", "-4", "3.5", "99999999999999999999"]) mkdirSync(join(k, ad));
      writeFileSync(join(k, "9"), "dosya");
      if (junction(ctx, disHedef("dizinler"), join(k, "8"))) {
        assert.deepEqual(await q.dizinler(), [2, 10], "gelen, adı tam sayı olmayan, dosya ve junction yok sayıldı");
      }
    });
  });

  describe("bağ saldırıları", () => {
    test("gelen\\ bir junction ise parça işlemleri atar, hedefe yazılmaz/silinmez", async (ctx) => {
      const { kok: k, p: q } = yeniKok();
      const hedef = disHedef("gelen-hedef");
      mkdirSync(k, { recursive: true });
      if (!junction(ctx, hedef, join(k, "gelen"))) return;
      await assert.rejects(q.parcaEkle(5, 0, b("saldiri")), /bağ/);
      await assert.rejects(q.parcaEkle(5, 5, b("saldiri")), /bağ/, "var olan dosyaya ekleme");
      await assert.rejects(q.parcaEkle(6, 0, b("saldiri")), /bağ/, "yeni dosya");
      await assert.rejects(q.parcaBoyutu(5), /bağ/);
      await assert.rejects(q.parcaOku(5, 0, 100), /bağ/);
      await assert.rejects(q.parcaSil(5), /bağ/);
      await assert.rejects(q.tasi(5, "jpg"), /bağ/);
      await assert.rejects(q.parcalar(), /bağ/);
      dokunulmadi(hedef, ["dokunma.txt", "asil.jpg", "5.part"]);
    });

    test("<no>\\ bir junction ise dosya işlemleri atar; dizinSil yalnız bağı kaldırır", async (ctx) => {
      const { kok: k, p: q } = yeniKok();
      const hedef = disHedef("no-hedef");
      mkdirSync(k, { recursive: true });
      if (!junction(ctx, hedef, join(k, "5"))) return;
      await assert.rejects(q.boyut(5, "asil.jpg"), /bağ/);
      await assert.rejects(q.oku(5, "asil.jpg", 1000), /bağ/);
      await assert.rejects(q.yaz(5, "dokum.txt", b("saldiri")), /bağ/);
      await q.parcaEkle(5, 0, b("saldiri"));
      await assert.rejects(q.tasi(5, "png"), /bağ/);
      assert.equal(await q.parcaBoyutu(5), 7, "taşınmadı, parça yerinde");
      dokunulmadi(hedef, ["dokunma.txt", "asil.jpg", "5.part"]);

      assert.equal(await q.dizinSil(5), true);
      assert.equal(existsSync(join(k, "5")), false, "bağ kalktı");
      dokunulmadi(hedef, ["dokunma.txt", "asil.jpg", "5.part"]);
    });

    test("gerçek <no>\\ içindeki junction: dizinSil hedefine girmez", async (ctx) => {
      const { kok: k, p: q } = yeniKok();
      const hedef = disHedef("ic-hedef");
      await q.parcaEkle(6, 0, b("x"));
      await q.tasi(6, "jpg");
      mkdirSync(join(k, "6", "alt", "derin"), { recursive: true });
      writeFileSync(join(k, "6", "alt", "derin", "a.txt"), "x");
      if (!junction(ctx, hedef, join(k, "6", "alt", "bag"))) return;
      assert.equal(await q.dizinSil(6), true);
      assert.equal(existsSync(join(k, "6")), false);
      dokunulmadi(hedef, ["dokunma.txt", "asil.jpg", "5.part"]);
    });

    test("kökteki dosya adı bir dizine junction ise (asil.jpg → dış dizin) okunmaz", async (ctx) => {
      const { kok: k, p: q } = yeniKok();
      const hedef = disHedef("ad-junction");
      mkdirSync(join(k, "3"), { recursive: true });
      if (!junction(ctx, hedef, join(k, "3", "asil.jpg"))) return;
      await assert.rejects(q.boyut(3, "asil.jpg"), /bağ/);
      await assert.rejects(q.oku(3, "asil.jpg", 1000), /bağ/);
      await assert.rejects(q.yaz(3, "asil.jpg", b("x")), /bağ/);
      assert.equal(await q.dizinSil(3), true);
      dokunulmadi(hedef, ["dokunma.txt", "asil.jpg", "5.part"]);
    });

    test("dosya sembolik bağı izlenmez (ayrıcalık yoksa atlanır)", async (ctx) => {
      const { kok: k, p: q } = yeniKok();
      const hedef = disHedef("sembolik");
      mkdirSync(join(k, "4"), { recursive: true });
      mkdirSync(join(k, "gelen"), { recursive: true });
      try {
        symlinkSync(join(hedef, "asil.jpg"), join(k, "4", "gorsel.jpg"), "file");
        symlinkSync(join(hedef, "5.part"), join(k, "gelen", "4.part"), "file");
      } catch {
        ctx.skip("sembolik bağ kurulamadı (ayrıcalık yok)");
        return;
      }
      await assert.rejects(q.oku(4, "gorsel.jpg", 1000), /bağ/);
      await assert.rejects(q.boyut(4, "gorsel.jpg"), /bağ/);
      await assert.rejects(q.yaz(4, "gorsel.jpg", b("saldiri")), /bağ/);
      await assert.rejects(q.parcaEkle(4, 5, b("saldiri")), /bağ/);
      await assert.rejects(q.parcaOku(4, 0, 100), /bağ/);
      await assert.rejects(q.tasi(4, "jpg"), /bağ/);
      await q.parcaSil(4);
      assert.equal(existsSync(join(k, "gelen", "4.part")), false, "yalnız bağ kalktı");
      assert.equal(await q.dizinSil(4), true);
      dokunulmadi(hedef, ["dokunma.txt", "asil.jpg", "5.part"]);
    });

    test("sabit bağ (hard link) üzerinden okunmaz ve yazılmaz", async () => {
      const { kok: k, p: q } = yeniKok();
      const hedef = disHedef("sabit");
      mkdirSync(join(k, "2"), { recursive: true });
      mkdirSync(join(k, "gelen"), { recursive: true });
      linkSync(join(hedef, "asil.jpg"), join(k, "2", "asil.jpg"));
      linkSync(join(hedef, "5.part"), join(k, "gelen", "2.part"));
      assert.equal(lstatSync(join(k, "2", "asil.jpg")).nlink, 2);
      await assert.rejects(q.oku(2, "asil.jpg", 1000), /bağ/);
      await assert.rejects(q.boyut(2, "asil.jpg"), /bağ/);
      await assert.rejects(q.yaz(2, "asil.jpg", b("saldiri")), /bağ/);
      await assert.rejects(q.parcaEkle(2, 5, b("saldiri")), /bağ/);
      await assert.rejects(q.parcaOku(2, 0, 100), /bağ/);
      await assert.rejects(q.parcaBoyutu(2), /bağ/);
      await assert.rejects(q.tasi(2, "png"), /bağ/);
      assert.deepEqual(await q.parcalar(), [2], "listelenir; silinince yalnız kendi adı gider");
      await q.parcaSil(2);
      assert.equal(await q.dizinSil(2), true);
      dokunulmadi(hedef, ["dokunma.txt", "asil.jpg", "5.part"]);
    });
  });

  describe("dizinSil", () => {
    test("olmayan dizin true; geçersiz no atmaz, false", async () => {
      const { p: q } = yeniKok();
      assert.equal(await q.dizinSil(77), true);
      assert.equal(await q.dizinSil(0), false);
      assert.equal(await q.dizinSil(-1), false);
      assert.equal(await q.dizinSil("..\\.." as unknown as number), false);
      assert.equal(await q.dizinSil(Number.NaN), false);
      assert.equal(existsSync(ust), true);
    });

    test("kilitli dosyada false, kilit kalkınca true", async (ctx) => {
      const { kok: k, p: q } = yeniKok();
      await q.parcaEkle(8, 0, b("x"));
      await q.tasi(8, "webm");
      await q.yaz(8, "dokum.txt", b("x"));
      const kilitli = join(k, "8", "asil.webm");
      const cocuk = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$f=[IO.File]::Open('${kilitli}','Open','Read','None'); [Console]::Out.WriteLine('hazir'); [Console]::Out.Flush(); Start-Sleep -Seconds 60`,
        ],
        { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
      );
      const hazir = await new Promise<boolean>((coz) => {
        const sure = setTimeout(() => coz(false), 20_000);
        cocuk.stdout.on("data", (d: Buffer) => {
          if (d.toString().includes("hazir")) {
            clearTimeout(sure);
            coz(true);
          }
        });
        cocuk.on("error", () => coz(false));
        cocuk.on("exit", () => coz(false));
      });
      try {
        if (!hazir) {
          ctx.skip("kilit tutan süreç başlamadı");
          return;
        }
        assert.equal(await q.dizinSil(8), false);
        assert.equal(existsSync(kilitli), true);
      } finally {
        const bitti = new Promise((coz) => cocuk.once("exit", coz));
        cocuk.kill();
        if (cocuk.exitCode === null) await bitti;
      }
      assert.equal(await q.dizinSil(8), true);
      assert.equal(existsSync(join(k, "8")), false);
      assert.deepEqual(await q.dizinler(), []);
    });
  });
});
