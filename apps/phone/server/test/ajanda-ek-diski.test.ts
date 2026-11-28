/**
 * Ek yedeğinin gerçek dosya portu (`dis-dunya.ts` `ajandaEkDiskiKur`): geçici dizinde gerçek dosyalarla.
 * Yerleşim, onaylı uzunluk ve çökme tutarlılığı, atomik tamamlama, özet doğrulaması (yol enjeksiyonu),
 * bağ izlememe, işaret dosyası.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { AjandaEkIsareti } from "../src/ajanda-ekler.ts";
import { ajandaEkDiskiKur } from "../src/dis-dunya.ts";

const temizlenecek: string[] = [];
afterEach(() => {
  for (const d of temizlenecek.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ortam = () => {
  const ust = mkdtempSync(join(tmpdir(), "eren-ek-"));
  temizlenecek.push(ust);
  const kok = join(ust, "ajanda-ekler");
  return { ust, kok, disk: ajandaEkDiskiKur(kok) };
};

const sha = (v: Uint8Array): string => createHash("sha256").update(v).digest("hex");
const isaret = (ilk_ms: number, gozlenen_ms = 0, rev: number | null = 0): AjandaEkIsareti => ({ ilk_ms, gozlenen_ms, rev });
const veri = (n: number, t = 3): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + t) & 0xff);

describe("ajandaEkDiskiKur", () => {
  it("yükleme: onaylı uzunluk, yanlış ofset atar, sha256, atomik tamamlama ve içerik adresli yerleşim", async () => {
    const { kok, disk } = ortam();
    const v = veri(1000);
    const ozet = sha(v);
    assert.equal(await disk.yarimDurumu(ozet), null);
    assert.equal(await disk.yarimaEkle(ozet, 0, v.slice(0, 600)), 600);
    assert.equal(await disk.yarimDurumu(ozet), 600);
    await assert.rejects(disk.yarimaEkle(ozet, 0, v.slice(0, 10)), /ofset_uyusmuyor/);
    assert.equal(await disk.yarimaEkle(ozet, 600, v.slice(600)), 1000);
    assert.deepEqual(await disk.yarimOzeti(ozet), { bayt: 1000, ozet });
    assert.deepEqual((await disk.yarimListesi()).map((y) => [y.ozet, y.bayt]), [[ozet, 1000]]);

    await disk.yarimiTamamla(ozet);
    const yol = join(kok, ozet.slice(0, 2), ozet);
    assert.deepEqual(new Uint8Array(readFileSync(yol)), v);
    assert.deepEqual(readdirSync(join(kok, "yarim")), []);
    assert.equal(await disk.tamBoyutu(ozet), 1000);
    assert.deepEqual(await disk.tamOku(ozet, 990, 100), v.slice(990));
    assert.deepEqual(await disk.tamOku(ozet, 1000, 100), new Uint8Array(0));
    assert.deepEqual(await disk.tamListesi(), [{ ozet, bayt: 1000 }]);
    await disk.tamSil(ozet);
    assert.equal(await disk.tamBoyutu(ozet), null);
    await disk.tamSil(ozet);
  });

  it("çökme tutarlılığı: onayın ötesindeki kuyruk kesilir; onay diskteki boydan büyükse yarım baştan", async () => {
    const { kok, disk } = ortam();
    const v = veri(500);
    const ozet = sha(v);
    await disk.yarimaEkle(ozet, 0, v.slice(0, 200));
    const yarim = join(kok, "yarim", ozet);
    appendFileSync(yarim, Buffer.alloc(77, 0xee));
    assert.equal(await disk.yarimDurumu(ozet), 200);
    assert.equal(readFileSync(yarim).length, 200);
    assert.equal(await disk.yarimaEkle(ozet, 200, v.slice(200)), 500);
    assert.deepEqual(await disk.yarimOzeti(ozet), { bayt: 500, ozet });

    // Onay 500 ama dosya kısalmış: onaylı bayt kaybolmuş, güvenilmez.
    writeFileSync(yarim, v.slice(0, 100));
    assert.equal(await disk.yarimDurumu(ozet), 0);
    assert.equal(readFileSync(yarim).length, 0);
    // Onaysız yarım (ilk parçanın onayı yazılmadan çökme): 0.
    rmSync(join(kok, "yarim", `${ozet}.onay`), { force: true });
    writeFileSync(yarim, v.slice(0, 50));
    assert.equal(await disk.yarimDurumu(ozet), 0);
  });

  it("tamamlarken son ad zaten varsa yarım atılır; yarimSil yarımı ve onayını kaldırır, sahipsiz onay listelenir", async () => {
    const { kok, disk } = ortam();
    const v = veri(64);
    const ozet = sha(v);
    await disk.yarimaEkle(ozet, 0, v);
    await disk.yarimiTamamla(ozet);
    await disk.yarimaEkle(ozet, 0, v);
    await disk.yarimiTamamla(ozet);
    assert.deepEqual(readdirSync(join(kok, "yarim")), []);
    assert.deepEqual(await disk.tamListesi(), [{ ozet, bayt: 64 }]);

    const baska = sha(veri(10, 9));
    writeFileSync(join(kok, "yarim", `${baska}.onay`), "5");
    assert.deepEqual((await disk.yarimListesi()).map((y) => [y.ozet, y.bayt]), [[baska, 0]]);
    await disk.yarimSil(baska);
    assert.deepEqual(await disk.yarimListesi(), []);
  });

  it("yol enjeksiyonu: özet olmayan değer her yöntemde atar, hiçbir dosya ya da dizin oluşmaz", async () => {
    const { ust, disk } = ortam();
    const kotu = ["..\\..\\kacak", "../kacak", "a".repeat(63), "A".repeat(64), `${"a".repeat(63)}\\`, "", "C:\\kacak"];
    for (const o of kotu) {
      for (const f of [
        () => disk.tamBoyutu(o),
        () => disk.tamOku(o, 0, 10),
        () => disk.tamSil(o),
        () => disk.yarimDurumu(o),
        () => disk.yarimaEkle(o, 0, veri(4)),
        () => disk.yarimOzeti(o),
        () => disk.yarimiTamamla(o),
        () => disk.yarimSil(o),
        () => disk.tamOzeti(o),
        () => disk.isaretleriYaz(new Map([[o, isaret(1)]])),
      ]) {
        await assert.rejects(f(), /gecersiz_ozet/, JSON.stringify(o));
      }
    }
    // Kök bile kurulmaz: doğrulama her dosya işleminden önce.
    assert.deepEqual(readdirSync(ust), []);
    assert.equal(existsSync(join(ust, "kacak")), false);
  });

  it("bağ izlenmez: önek dizini junction ise okuma atar, listede atlanır", { skip: process.platform !== "win32" }, async () => {
    const { ust, kok, disk } = ortam();
    const v = veri(32);
    const ozet = sha(v);
    const dis = join(ust, "dis");
    mkdirSync(dis);
    writeFileSync(join(dis, ozet), v);
    mkdirSync(kok, { recursive: true });
    symlinkSync(dis, join(kok, ozet.slice(0, 2)), "junction");
    await assert.rejects(disk.tamBoyutu(ozet), /ek_dizini_guvensiz/);
    await assert.rejects(disk.yarimiTamamla(ozet));
    assert.deepEqual(await disk.tamListesi(), []);
    assert.ok(existsSync(join(dis, ozet)));
  });

  it("bağ izlenmez: kök (ajanda-ekler) junction ise her yöntem atar, hedefe hiçbir şey yazılmaz", { skip: process.platform !== "win32" }, async () => {
    const { ust, kok, disk } = ortam();
    const v = veri(32);
    const ozet = sha(v);
    const dis = join(ust, "dis");
    mkdirSync(join(dis, ozet.slice(0, 2)), { recursive: true });
    writeFileSync(join(dis, ozet.slice(0, 2), ozet), v);
    symlinkSync(dis, kok, "junction");
    for (const f of [
      () => disk.tamBoyutu(ozet),
      () => disk.tamOku(ozet, 0, 10),
      () => disk.tamSil(ozet),
      () => disk.tamListesi(),
      () => disk.yarimDurumu(ozet),
      () => disk.yarimaEkle(ozet, 0, v),
      () => disk.yarimiTamamla(ozet),
      () => disk.yarimSil(ozet),
      () => disk.yarimListesi(),
      () => disk.isaretleriOku(),
      () => disk.tamOzeti(ozet),
      () => disk.isaretleriYaz(new Map([[ozet, isaret(1)]])),
    ]) {
      await assert.rejects(f(), /ek_dizini_guvensiz/);
    }
    // Hedef olduğu gibi: yalnız önceden konan dosya, ne yarım ne işaret dosyası.
    assert.deepEqual(readdirSync(dis), [ozet.slice(0, 2)]);
    assert.ok(existsSync(join(dis, ozet.slice(0, 2), ozet)));
  });

  it("bağ izlenmez: yarim dizini junction ise yarım yöntemleri atar, hedefe yazılmaz; tam dosyalar etkilenmez", { skip: process.platform !== "win32" }, async () => {
    const { ust, kok, disk } = ortam();
    const v = veri(32);
    const ozet = sha(v);
    const dis = join(ust, "dis");
    mkdirSync(dis);
    writeFileSync(join(dis, ozet), v);
    writeFileSync(join(dis, `${ozet}.onay`), String(v.length));
    mkdirSync(kok, { recursive: true });
    symlinkSync(dis, join(kok, "yarim"), "junction");
    for (const f of [
      () => disk.yarimDurumu(ozet),
      () => disk.yarimaEkle(ozet, 0, v),
      () => disk.yarimOzeti(ozet),
      () => disk.yarimSil(ozet),
      () => disk.yarimListesi(),
    ]) {
      await assert.rejects(f(), /ek_dizini_guvensiz/);
    }
    // Junction'daki "yarım" tamamlanamaz (dışarıdaki dosya içeri taşınmaz).
    await assert.rejects(disk.yarimiTamamla(ozet), /ek_dizini_guvensiz/);
    assert.equal(await disk.tamBoyutu(ozet), null);
    assert.deepEqual(readdirSync(dis).sort(), [ozet, `${ozet}.onay`].sort());
    assert.deepEqual(await disk.tamListesi(), []);
  });

  it("işaretler: atomik yazılır ve okunur (gözlenen süre ve revizyon dahil); bozuk dosya ve geçersiz girdiler yok sayılır", async () => {
    const { kok, disk } = ortam();
    assert.deepEqual(await disk.isaretleriOku(), new Map());
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    await disk.isaretleriYaz(new Map([[b, isaret(2, 7, 3)], [a, isaret(1, 0, null)]]));
    assert.deepEqual(await disk.isaretleriOku(), new Map([[a, isaret(1, 0, null)], [b, isaret(2, 7, 3)]]));
    // Üst düzey `<ozet>: ilk_ms` eski biçimdir (eski servis de okur); gözlem ayrı anahtarda.
    assert.equal(
      readFileSync(join(kok, "basvurusuz.json"), "utf8"),
      JSON.stringify({ [a]: 1, [b]: 2, gozlem: { [a]: { ms: 0 }, [b]: { ms: 7, rev: 3 } }, gozlem_baz: 0 }),
    );
    writeFileSync(join(kok, "basvurusuz.json"), JSON.stringify({ [a]: 5, "../x": 1, [b]: "2" }));
    assert.deepEqual(await disk.isaretleriOku(), new Map([[a, isaret(5, 0, null)]]), "eski biçim: gözlenen 0, revizyon yok");
    writeFileSync(
      join(kok, "basvurusuz.json"),
      JSON.stringify({ [a]: 5, [b]: 6, gozlem: { [a]: { ms: -1, rev: 1.5 }, [b]: "x", ["c".repeat(64)]: { ms: 9 } } }),
    );
    assert.deepEqual(await disk.isaretleriOku(), new Map([[a, isaret(5, 0, null)], [b, isaret(6, 0, null)]]));
    writeFileSync(join(kok, "basvurusuz.json"), "{bozuk");
    assert.deepEqual(await disk.isaretleriOku(), new Map());
    await assert.rejects(disk.isaretleriYaz(new Map([[a, isaret(Number.NaN)]])), /gecersiz_isaret/);
  });

  it("işaretler: okuyucunun 0/null sayacağı değer yazılmaz (eksi gözlenen süre, eksi ya da kesirli rev atar)", async () => {
    const { kok, disk } = ortam();
    const a = "a".repeat(64);
    for (const i of [isaret(1, 0, -1), isaret(1, 0, 1.5), isaret(1, -1, 0)]) {
      await assert.rejects(disk.isaretleriYaz(new Map([[a, i]])), /gecersiz_isaret/, JSON.stringify(i));
    }
    assert.equal(existsSync(join(kok, "basvurusuz.json")), false);
  });

  it("işaretler: yalnız gözlenen süre hepsinde aynı kadar arttıysa büyük dosya yeniden yazılmaz, küçük sayaç yazılır", async () => {
    const { kok, disk } = ortam();
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    const c = "c".repeat(64);
    const dosya = join(kok, "basvurusuz.json");
    const sayac = join(kok, "basvurusuz-gozlem.json");
    await disk.isaretleriYaz(new Map([[a, isaret(1, 0, 2)], [b, isaret(2, 5, null)]]));
    const ilk = readFileSync(dosya, "utf8");
    const arttir = (m: Map<string, AjandaEkIsareti>, d: number) =>
      new Map([...m].map(([o, i]) => [o, { ...i, gozlenen_ms: i.gozlenen_ms + d }] as const));
    // Saatlik turlar: okunur, hepsine aynı adım eklenir, yazılır.
    let m = await disk.isaretleriOku();
    for (let tur = 0; tur < 3; tur++) {
      m = arttir(m, 3600);
      await disk.isaretleriYaz(m);
      assert.equal(readFileSync(dosya, "utf8"), ilk, "büyük dosya olduğu gibi");
      assert.deepEqual(await disk.isaretleriOku(), m);
    }
    assert.deepEqual(m, new Map([[a, isaret(1, 3 * 3600, 2)], [b, isaret(2, 5 + 3 * 3600, null)]]));
    assert.ok(readFileSync(sayac, "utf8").length < 64);
    // Yeni süreç (önbelleksiz port) aynı değeri okur; yazmadan önce okumadıysa tam yazar.
    assert.deepEqual(await ajandaEkDiskiKur(kok).isaretleriOku(), m);
    // Küme değişince (yeni işaret) tam yazım; değerler korunur, sonra yine yalnız sayaç.
    const yeni = new Map([...m, [c, isaret(9, 0, 4)] as const]);
    await disk.isaretleriYaz(yeni);
    assert.notEqual(readFileSync(dosya, "utf8"), ilk);
    assert.deepEqual(await ajandaEkDiskiKur(kok).isaretleriOku(), yeni);
    const ikinci = readFileSync(dosya, "utf8");
    await disk.isaretleriYaz(arttir(yeni, 7));
    assert.equal(readFileSync(dosya, "utf8"), ikinci);
    assert.deepEqual(await ajandaEkDiskiKur(kok).isaretleriOku(), arttir(yeni, 7));
    // Yalnız bir işaret değişirse (tazeleme) tam yazım.
    const bir = new Map(arttir(yeni, 7));
    bir.set(a, isaret(50, 0, 6));
    await disk.isaretleriYaz(bir);
    assert.deepEqual(await ajandaEkDiskiKur(kok).isaretleriOku(), bir);
  });

  it("işaretler: sayaç bozuk, yok ya da tabandan geride ya da dosyayı tabanı bilmeyen eski servis yazdıysa yalnız dosyadaki süre okunur (saklama uzar, kısalmaz)", async () => {
    const { kok, disk } = ortam();
    const a = "a".repeat(64);
    const dosya = join(kok, "basvurusuz.json");
    const sayac = join(kok, "basvurusuz-gozlem.json");
    await disk.isaretleriYaz(new Map([[a, isaret(1, 10, 0)]]));
    await disk.isaretleriOku();
    await disk.isaretleriYaz(new Map([[a, isaret(1, 110, 0)]]));
    assert.deepEqual(await disk.isaretleriOku(), new Map([[a, isaret(1, 110, 0)]]));
    // Sayaç bozuk: yalnız büyük dosyadaki değer (saklama uzar).
    writeFileSync(sayac, "{bozuk");
    assert.deepEqual(await disk.isaretleriOku(), new Map([[a, isaret(1, 10, 0)]]));
    // Bozuk sayaçla sürer: sonraki artış yine doğru birikir.
    await disk.isaretleriYaz(new Map([[a, isaret(1, 20, 0)]]));
    assert.deepEqual(await ajandaEkDiskiKur(kok).isaretleriOku(), new Map([[a, isaret(1, 20, 0)]]));
    // Sayaç yok.
    rmSync(sayac);
    assert.deepEqual(await disk.isaretleriOku(), new Map([[a, isaret(1, 10, 0)]]));
    // Sayaç tabandan geride (yedekten dönmüş): fark sayılmaz, sonraki yazım tamdır.
    writeFileSync(dosya, JSON.stringify({ [a]: 1, gozlem: { [a]: { ms: 10, rev: 0 } }, gozlem_baz: 500 }));
    writeFileSync(sayac, JSON.stringify({ toplam: 100 }));
    assert.deepEqual(await disk.isaretleriOku(), new Map([[a, isaret(1, 10, 0)]]));
    await disk.isaretleriYaz(new Map([[a, isaret(1, 15, 0)]]));
    assert.deepEqual(await ajandaEkDiskiKur(kok).isaretleriOku(), new Map([[a, isaret(1, 15, 0)]]));
    // Dosyayı tabanı bilmeyen eski servis yazdı (sayaç duruyor): fark sayılmaz, sonraki yazım tamdır.
    writeFileSync(dosya, JSON.stringify({ [a]: 1, gozlem: { [a]: { ms: 40, rev: 0 } } }));
    writeFileSync(sayac, JSON.stringify({ toplam: 900 }));
    assert.deepEqual(await disk.isaretleriOku(), new Map([[a, isaret(1, 40, 0)]]));
    await disk.isaretleriYaz(new Map([[a, isaret(1, 45, 0)]]));
    assert.deepEqual(await ajandaEkDiskiKur(kok).isaretleriOku(), new Map([[a, isaret(1, 45, 0)]]));
  });

  it("okunamayan tek önek dizini taramayı düşürmez: öteki dosyalar listelenir", { skip: process.platform !== "win32" }, async () => {
    const { kok, disk } = ortam();
    const v1 = veri(10, 1);
    const v2 = veri(10, 2);
    const o1 = sha(v1);
    let o2 = sha(v2);
    let t = 3;
    while (o2.slice(0, 2) === o1.slice(0, 2)) o2 = sha(veri(10, t++));
    for (const o of [o1, o2]) {
      mkdirSync(join(kok, o.slice(0, 2)), { recursive: true });
      writeFileSync(join(kok, o.slice(0, 2), o), v1);
    }
    const kapali = join(kok, o1.slice(0, 2));
    execFileSync("icacls", [kapali, "/deny", "*S-1-1-0:(RD)"]);
    try {
      assert.deepEqual(await disk.tamListesi(), [{ ozet: o2, bayt: 10 }]);
    } finally {
      execFileSync("icacls", [kapali, "/remove:d", "*S-1-1-0"]);
    }
    assert.deepEqual((await disk.tamListesi()).map((f) => f.ozet).sort(), [o1, o2].sort());
  });

  it("tamOzeti: tam dosyanın boyu ve sha256'sı; dosya yoksa atar; diskte bozulan dosya adıyla tutmaz", async () => {
    const { kok, disk } = ortam();
    const v = veri(300_000);
    const ozet = sha(v);
    await assert.rejects(disk.tamOzeti(ozet), /tam_yok/);
    await disk.yarimaEkle(ozet, 0, v);
    await disk.yarimiTamamla(ozet);
    assert.deepEqual(await disk.tamOzeti(ozet), { bayt: v.length, ozet });
    appendFileSync(join(kok, ozet.slice(0, 2), ozet), "x");
    const h = await disk.tamOzeti(ozet);
    assert.equal(h.bayt, v.length + 1);
    assert.notEqual(h.ozet, ozet);
  });
});
