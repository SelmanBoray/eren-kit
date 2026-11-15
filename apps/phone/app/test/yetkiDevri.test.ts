// Yetki devri ve kullanıcıya söylenen metin: Kotlin adaptörü cihazsız test edilemediği için kaynak taranır.
// - Yeni eşleşme kaydı tam yetkiyi kapatır (önceki PC'ye verilen yetki yeni PC'ye geçmez).
// - Ses tuşu kısayolu önceki kısayol hedeflerini silmez, sistemin onay penceresini bastırmaz.
// - Tam yetki ve erişilebilirlik metinleri, varsayılanı açık ve tahmine dayalı hassas listeyi doğru anlatır.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const MODUL = join(dirname(fileURLToPath(import.meta.url)), "..", "modules", "eren-device");
const ADAPTOR = join(MODUL, "android", "src", "main", "java", "dev", "eren", "cihaz", "adaptor");
const STRINGS = join(MODUL, "android", "src", "main", "res", "values", "strings.xml");

const oku = (ad: string): string => readFileSync(join(ADAPTOR, ad), "utf8");

/** Satır yorumlarını ve KDoc/blok yorumlarını atar (kod tarama için; dizgeler kalır). */
function yorumsuz(kaynak: string): string {
  return kaynak.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** `fun ad(` ile başlayan üst düzey (4 boşluk girintili) fonksiyonun gövdesi. */
function fonksiyon(kaynak: string, ad: string): string {
  const bas = kaynak.indexOf(`fun ${ad}(`);
  assert.ok(bas >= 0, `fun ${ad} bulunamadı`);
  const son = kaynak.indexOf("\n    }\n", bas);
  assert.ok(son > bas, `fun ${ad} sonu bulunamadı`);
  return kaynak.slice(bas, son);
}

describe("yeniden eşleştirme tam yetkiyi devretmez", () => {
  const kaynak = yorumsuz(oku("EslestirmeActivity.kt"));

  it("kaydetVeBitir eşleşmeyi yazmadan önce tam yetkiyi kapatır", () => {
    const govde = fonksiyon(kaynak, "kaydetVeBitir");
    const kapat = govde.indexOf("TamYetki.kapat(this)");
    const kaydet = govde.indexOf(".kaydet(kayit)");
    assert.ok(kapat >= 0, "TamYetki.kapat çağrısı yok");
    assert.ok(kaydet >= 0, "eşleşme kaydı yok");
    assert.ok(kapat < kaydet, "tam yetki kayıttan önce kapanmalı");
  });

  it("eşleşme kaydını yalnız kaydetVeBitir yazar", () => {
    const yazanlar: string[] = [];
    for (const ad of readdirSync(ADAPTOR).filter((d) => d.endsWith(".kt"))) {
      const k = yorumsuz(oku(ad));
      const sayi = (k.match(/EslesmeDeposu\([^)]*\)\s*\.kaydet\(/g) ?? []).length;
      for (let i = 0; i < sayi; i++) yazanlar.push(ad);
    }
    assert.deepEqual(yazanlar, ["EslestirmeActivity.kt"]);
    assert.equal((kaynak.match(/\.kaydet\(kayit\)/g) ?? []).length, 1);
  });

  it("yeniden eşleştirme istemi tam yetkinin kapanacağını söyler", () => {
    assert.match(kaynak, /setSubtitle\("[^"]*tam yetki açıksa kapanır"\)/);
  });
});

describe("ses tuşu kısayolu önceki kısayolu korur", () => {
  const kaynak = yorumsuz(oku("ErisimAnahtari.kt"));

  it("sistemin ilk kullanım onay penceresi bastırılmaz", () => {
    assert.doesNotMatch(kaynak, /accessibility_shortcut_dialog_shown/);
  });

  it("hedef ayarı yalnız KisayolHedefleri.ekle sonucuyla yazılır", () => {
    const govde = fonksiyon(kaynak, "sesKisayoluKur");
    assert.match(govde, /KisayolHedefleri\.ekle\(Settings\.Secure\.getString\(cr, KISAYOL_HEDEF\), hedef\)/);
    const yazimlar = [...kaynak.matchAll(/Settings\.Secure\.put\w+\(\s*cr,\s*KISAYOL_HEDEF,\s*([^)]+)\)/g)];
    assert.equal(yazimlar.length, 1);
    assert.equal(yazimlar[0][1].trim(), "ekleme.yeniDeger");
  });
});

describe("tam yetki ve erişilebilirlik metinleri doğruyu söyler", () => {
  const metinler: [string, string][] = [
    ["TamYetkiActivity.kt", oku("TamYetkiActivity.kt")],
    ["UygulamaListesiActivity.kt", oku("UygulamaListesiActivity.kt")],
    ["strings.xml", readFileSync(STRINGS, "utf8")],
  ];

  for (const [ad, metin] of metinler) {
    it(`${ad}: yanıltıcı kalıp yok, tahmin ve varsayılan açık anlatılıyor`, () => {
      assert.doesNotMatch(metin, /her zaman yasak/i);
      assert.doesNotMatch(metin, /Yalnız Uygulamalar ekranında açtığınız/);
      assert.doesNotMatch(metin, /işaretlediğiniz uygulamalar \(banka/);
      assert.match(metin, /tahmin/);
      assert.match(metin, /her uygulamayı yakalamaz/);
      assert.match(metin, /varsayılan olarak açık|açık başlar/);
    });
  }
});
