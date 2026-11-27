/**
 * Ek yedeğinin gerçek dosya portu (`dis-dunya.ts` `ajandaEkDiskiKur`): geçici dizinde gerçek dosyalarla.
 * Yerleşim, onaylı uzunluk ve çökme tutarlılığı, atomik tamamlama, özet doğrulaması (yol enjeksiyonu),
 * bağ izlememe, işaret dosyası.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
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
        () => disk.isaretleriYaz(new Map([[o, 1]])),
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

  it("işaretler: atomik yazılır ve okunur; bozuk dosya ve geçersiz girdiler yok sayılır", async () => {
    const { kok, disk } = ortam();
    assert.deepEqual(await disk.isaretleriOku(), new Map());
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    await disk.isaretleriYaz(new Map([[b, 2], [a, 1]]));
    assert.deepEqual(await disk.isaretleriOku(), new Map([[a, 1], [b, 2]]));
    assert.equal(readFileSync(join(kok, "basvurusuz.json"), "utf8"), JSON.stringify({ [a]: 1, [b]: 2 }));
    writeFileSync(join(kok, "basvurusuz.json"), JSON.stringify({ [a]: 5, "../x": 1, [b]: "2" }));
    assert.deepEqual(await disk.isaretleriOku(), new Map([[a, 5]]));
    writeFileSync(join(kok, "basvurusuz.json"), "{bozuk");
    assert.deepEqual(await disk.isaretleriOku(), new Map());
  });
});
