/**
 * Canlı etkinlik: araç kategorisi eşlemesi ve etkinlik durum makinesi (saf işlevler).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aracKategorisi, etkinlikBaslangici, etkinlikGecisi } from "../src/etkinlik.ts";
import type { EtkinlikDurumu } from "../src/etkinlik.ts";
import type { AkisOlayi } from "../src/sozlesme.ts";

const aracBlogu = (id: string | undefined, ad: string | undefined): AkisOlayi => ({
  tur: "blok_basladi",
  blok: "arac",
  ...(id === undefined ? {} : { arac_id: id }),
  ...(ad === undefined ? {} : { arac_adi: ad }),
});
const asistan = (araclar: readonly { id: string; ad: string }[]): AkisOlayi => ({
  tur: "assistant",
  message_id: "m1",
  model: null,
  kullanim: null,
  araclar,
});
const sonuc = (...idler: string[]): AkisOlayi => ({ tur: "arac_sonucu", arac_idler: idler });
const MODEL: AkisOlayi = { tur: "model_basladi" };
const METIN_BLOGU: AkisOlayi = { tur: "blok_basladi", blok: "metin" };
const DUSUNME_BLOGU: AkisOlayi = { tur: "blok_basladi", blok: "dusunme" };
const PARCA: AkisOlayi = { tur: "metin_parcasi", text: "merhaba" };

describe("etkinlik: araç kategorisi", () => {
  it("tam ad eşleşmeleri", () => {
    for (const ad of ["PowerShell", "Bash"]) assert.equal(aracKategorisi(ad), "komut");
    for (const ad of ["Read", "Glob", "Grep", "NotebookRead"]) assert.equal(aracKategorisi(ad), "dosya_okuma");
    for (const ad of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) assert.equal(aracKategorisi(ad), "dosya_yazma");
    for (const ad of ["WebFetch", "WebSearch"]) assert.equal(aracKategorisi(ad), "web");
  });

  it("servis köprüsü: plan_oner plan, diğer her mcp__eren__ adı is_bilgisi", () => {
    assert.equal(aracKategorisi("mcp__eren__plan_oner"), "plan");
    assert.equal(aracKategorisi("mcp__eren__rapor_oku"), "is_bilgisi");
    assert.equal(aracKategorisi("mcp__eren__xyz"), "is_bilgisi");
    assert.equal(aracKategorisi("mcp__eren__plan_oner_x"), "is_bilgisi");
  });

  it("bilgisayar kullanımı sunucusunun her aracı ekran", () => {
    assert.equal(aracKategorisi("mcp__computer-use-windows__screenshot"), "ekran");
    assert.equal(aracKategorisi("mcp__computer-use-windows__click"), "ekran");
  });

  it("bilinmeyen, boş, büyük küçük harf ve başka MCP adları arac", () => {
    assert.equal(aracKategorisi(""), "arac");
    assert.equal(aracKategorisi("Task"), "arac");
    assert.equal(aracKategorisi("bash"), "arac");
    assert.equal(aracKategorisi("Bash "), "arac");
    assert.equal(aracKategorisi("Reader"), "arac");
    assert.equal(aracKategorisi("mcp__baska__islem"), "arac");
    assert.equal(aracKategorisi("mcp__eren"), "arac");
    assert.equal(aracKategorisi("mcp__erenx__islem"), "arac");
  });
});

describe("etkinlik: başlangıç", () => {
  it("dusunuyor, verilen an, açık araç yok", () => {
    assert.deepEqual(etkinlikBaslangici(1000), { etkinlik: "dusunuyor", baslangic_ms: 1000, acikAraclar: [] });
  });
});

describe("etkinlik: model_basladi", () => {
  it("açık araç yoksa dusunuyor: yaziyor iken değişir", () => {
    const yaziyor = etkinlikGecisi(etkinlikBaslangici(0), PARCA, 10).durum;
    const g = etkinlikGecisi(yaziyor, MODEL, 20);
    assert.equal(g.degisti, true);
    assert.equal(g.durum.etkinlik, "dusunuyor");
    assert.equal(g.durum.baslangic_ms, 20);
  });

  it("zaten dusunuyor ise değişmez, başlangıç aynı", () => {
    const g = etkinlikGecisi(etkinlikBaslangici(5), MODEL, 99);
    assert.equal(g.degisti, false);
    assert.equal(g.durum.baslangic_ms, 5);
  });

  it("açık araç varsa görünen etkinlik değişmez", () => {
    const komut = etkinlikGecisi(etkinlikBaslangici(0), aracBlogu("a1", "Bash"), 10).durum;
    const g = etkinlikGecisi(komut, MODEL, 20);
    assert.equal(g.degisti, false);
    assert.equal(g.durum.etkinlik, "komut");
    assert.equal(g.durum.baslangic_ms, 10);
    assert.equal(g.durum.acikAraclar.length, 1);
  });
});

describe("etkinlik: blok_basladi", () => {
  it("dusunme ve metin blokları", () => {
    const y = etkinlikGecisi(etkinlikBaslangici(0), METIN_BLOGU, 10);
    assert.equal(y.durum.etkinlik, "yaziyor");
    assert.equal(y.degisti, true);
    const d = etkinlikGecisi(y.durum, DUSUNME_BLOGU, 20);
    assert.equal(d.durum.etkinlik, "dusunuyor");
    assert.equal(d.degisti, true);
    assert.equal(d.durum.baslangic_ms, 20);
  });

  it("arac kimlikli: açık araçlara eklenir, kategori görünür", () => {
    const g = etkinlikGecisi(etkinlikBaslangici(0), aracBlogu("a1", "Read"), 10);
    assert.equal(g.degisti, true);
    assert.equal(g.durum.etkinlik, "dosya_okuma");
    assert.equal(g.durum.baslangic_ms, 10);
    assert.deepEqual(g.durum.acikAraclar, [{ id: "a1", kategori: "dosya_okuma" }]);
  });

  it("arac adı yoksa kategori arac", () => {
    const g = etkinlikGecisi(etkinlikBaslangici(0), aracBlogu("a1", undefined), 10);
    assert.equal(g.durum.etkinlik, "arac");
    assert.deepEqual(g.durum.acikAraclar, [{ id: "a1", kategori: "arac" }]);
  });

  it("arac kimliksiz: yalnız görünen etkinlik geçer, açık araçlara eklenmez", () => {
    const g = etkinlikGecisi(etkinlikBaslangici(0), aracBlogu(undefined, "WebSearch"), 10);
    assert.equal(g.degisti, true);
    assert.equal(g.durum.etkinlik, "web");
    assert.deepEqual(g.durum.acikAraclar, []);
  });

  it("boş kimlik kimliksiz sayılır", () => {
    const g = etkinlikGecisi(etkinlikBaslangici(0), aracBlogu("", "Bash"), 10);
    assert.equal(g.durum.etkinlik, "komut");
    assert.deepEqual(g.durum.acikAraclar, []);
  });

  it("komut çalışırken ikinci komut aracı: değişmez, başlangıç eski, ama araç eklenir", () => {
    const bir = etkinlikGecisi(etkinlikBaslangici(0), aracBlogu("a1", "Bash"), 10).durum;
    const iki = etkinlikGecisi(bir, aracBlogu("a2", "PowerShell"), 50);
    assert.equal(iki.degisti, false);
    assert.equal(iki.durum.etkinlik, "komut");
    assert.equal(iki.durum.baslangic_ms, 10);
    assert.deepEqual(iki.durum.acikAraclar.map((a) => a.id), ["a1", "a2"]);
  });

  it("aynı kimlik ikinci kez gelirse eklenmez, hiçbir şey değişmez", () => {
    const bir = etkinlikGecisi(etkinlikBaslangici(0), aracBlogu("a1", "Bash"), 10).durum;
    const g = etkinlikGecisi(bir, aracBlogu("a1", "Read"), 50);
    assert.equal(g.degisti, false);
    assert.equal(g.durum.etkinlik, "komut");
    assert.equal(g.durum.acikAraclar.length, 1);
  });
});

describe("etkinlik: metin parçası", () => {
  it("yaziyor olur; zaten yaziyor ise değişmez", () => {
    const g = etkinlikGecisi(etkinlikBaslangici(0), PARCA, 10);
    assert.equal(g.durum.etkinlik, "yaziyor");
    assert.equal(g.degisti, true);
    const h = etkinlikGecisi(g.durum, PARCA, 30);
    assert.equal(h.degisti, false);
    assert.equal(h.durum.baslangic_ms, 10);
  });
});

describe("etkinlik: assistant", () => {
  it("yeni araçlar eklenir, görünen en son eklenenin kategorisi", () => {
    const g = etkinlikGecisi(
      etkinlikBaslangici(0),
      asistan([
        { id: "a1", ad: "Read" },
        { id: "a2", ad: "Edit" },
      ]),
      10,
    );
    assert.equal(g.degisti, true);
    assert.equal(g.durum.etkinlik, "dosya_yazma");
    assert.deepEqual(g.durum.acikAraclar, [
      { id: "a1", kategori: "dosya_okuma" },
      { id: "a2", kategori: "dosya_yazma" },
    ]);
  });

  it("önce blok_basladi sonra assistant: ikinci kez eklenmez, değişmez", () => {
    const bir = etkinlikGecisi(etkinlikBaslangici(0), aracBlogu("a1", "Bash"), 10).durum;
    const g = etkinlikGecisi(bir, asistan([{ id: "a1", ad: "Bash" }]), 40);
    assert.equal(g.degisti, false);
    assert.deepEqual(g.durum, bir);
  });

  it("karışık: bilinen atlanır, yalnız yeni eklenenin kategorisi görünür", () => {
    const bir = etkinlikGecisi(etkinlikBaslangici(0), aracBlogu("a1", "Bash"), 10).durum;
    const g = etkinlikGecisi(
      bir,
      asistan([
        { id: "a1", ad: "Bash" },
        { id: "a2", ad: "WebFetch" },
      ]),
      40,
    );
    assert.equal(g.durum.etkinlik, "web");
    assert.equal(g.degisti, true);
    assert.deepEqual(g.durum.acikAraclar.map((a) => a.id), ["a1", "a2"]);
  });

  it("araçsız assistant, aynı kimlik tekrarı ve boş kimlik değişiklik yapmaz", () => {
    const b = etkinlikBaslangici(0);
    assert.equal(etkinlikGecisi(b, asistan([]), 5).degisti, false);
    assert.equal(etkinlikGecisi(b, asistan([{ id: "", ad: "Bash" }]), 5).degisti, false);
    const g = etkinlikGecisi(
      b,
      asistan([
        { id: "x", ad: "Bash" },
        { id: "x", ad: "Read" },
      ]),
      5,
    );
    assert.deepEqual(g.durum.acikAraclar, [{ id: "x", kategori: "komut" }]);
    assert.equal(g.durum.etkinlik, "komut");
  });

  it("görünen etkinlik zaten aynıysa araç eklenir ama değişmez", () => {
    const bir = etkinlikGecisi(etkinlikBaslangici(0), aracBlogu(undefined, "Bash"), 10).durum;
    const g = etkinlikGecisi(bir, asistan([{ id: "a1", ad: "Bash" }]), 40);
    assert.equal(g.degisti, false);
    assert.equal(g.durum.baslangic_ms, 10);
    assert.equal(g.durum.acikAraclar.length, 1);
  });
});

describe("etkinlik: arac_sonucu", () => {
  const ikiAcik = (): EtkinlikDurumu => {
    let d = etkinlikBaslangici(0);
    d = etkinlikGecisi(d, aracBlogu("a1", "Read"), 10).durum;
    d = etkinlikGecisi(d, aracBlogu("a2", "WebFetch"), 20).durum;
    return d;
  };

  it("hepsi dönünce dusunuyor", () => {
    const g = etkinlikGecisi(ikiAcik(), sonuc("a1", "a2"), 30);
    assert.equal(g.degisti, true);
    assert.equal(g.durum.etkinlik, "dusunuyor");
    assert.equal(g.durum.baslangic_ms, 30);
    assert.deepEqual(g.durum.acikAraclar, []);
  });

  it("kalan varsa en son başlamış açık aracın kategorisi", () => {
    const g = etkinlikGecisi(ikiAcik(), sonuc("a2"), 30);
    assert.equal(g.degisti, true);
    assert.equal(g.durum.etkinlik, "dosya_okuma");
    assert.deepEqual(g.durum.acikAraclar, [{ id: "a1", kategori: "dosya_okuma" }]);
  });

  it("en eski araç dönerse görünen aynı kalır, araç düşer", () => {
    const g = etkinlikGecisi(ikiAcik(), sonuc("a1"), 30);
    assert.equal(g.degisti, false);
    assert.equal(g.durum.etkinlik, "web");
    assert.equal(g.durum.baslangic_ms, 20);
    assert.deepEqual(g.durum.acikAraclar.map((a) => a.id), ["a2"]);
  });

  it("bilinmeyen kimlikler yok sayılır; hiçbiri eşleşmezse hiçbir şey değişmez", () => {
    const d = ikiAcik();
    const g = etkinlikGecisi(d, sonuc("yok", "baska"), 30);
    assert.equal(g.degisti, false);
    assert.deepEqual(g.durum, d);
    const h = etkinlikGecisi(d, sonuc(), 30);
    assert.equal(h.degisti, false);
    assert.deepEqual(h.durum, d);
  });

  it("bilinmeyenle karışık: bilineni çıkarır", () => {
    const g = etkinlikGecisi(ikiAcik(), sonuc("yok", "a2"), 30);
    assert.equal(g.durum.etkinlik, "dosya_okuma");
    assert.deepEqual(g.durum.acikAraclar.map((a) => a.id), ["a1"]);
  });

  it("açık araç yokken dusunuyor iken değişmez", () => {
    const g = etkinlikGecisi(etkinlikBaslangici(0), sonuc("a1"), 30);
    assert.equal(g.degisti, false);
  });
});

describe("etkinlik: diğer olaylar, saflık ve sınır", () => {
  it("ilgisiz olay türleri değişiklik yapmaz", () => {
    const d = etkinlikGecisi(etkinlikBaslangici(0), aracBlogu("a1", "Bash"), 10).durum;
    const olaylar: AkisOlayi[] = [
      { tur: "diger", type: "system" },
      { tur: "hook_response", cikti: "x" },
      { tur: "rate_limit", besSaat: null, yediGun: null },
      { tur: "control_response", request_id: "r", basarili: true },
    ];
    for (const o of olaylar) {
      const g = etkinlikGecisi(d, o, 99);
      assert.equal(g.degisti, false);
      assert.deepEqual(g.durum, d);
    }
  });

  it("girdi durumunu değiştirmez", () => {
    const d = etkinlikGecisi(etkinlikBaslangici(0), aracBlogu("a1", "Bash"), 10).durum;
    const kopya = structuredClone(d);
    etkinlikGecisi(d, aracBlogu("a2", "Read"), 20);
    etkinlikGecisi(d, sonuc("a1"), 20);
    etkinlikGecisi(d, asistan([{ id: "a3", ad: "Edit" }]), 20);
    assert.deepEqual(d, kopya);
  });

  it("açık araçlar en çok 64: taşınca en eskisi düşer", () => {
    let d = etkinlikBaslangici(0);
    for (let i = 0; i < 70; i++) d = etkinlikGecisi(d, aracBlogu(`a${i}`, "Bash"), i).durum;
    assert.equal(d.acikAraclar.length, 64);
    assert.equal(d.acikAraclar[0]?.id, "a6");
    assert.equal(d.acikAraclar[63]?.id, "a69");
    // assistant yolu da aynı sınırı uygular
    const toplu = etkinlikGecisi(
      etkinlikBaslangici(0),
      asistan(Array.from({ length: 100 }, (_, i) => ({ id: `b${i}`, ad: "Read" }))),
      1,
    );
    assert.equal(toplu.durum.acikAraclar.length, 64);
    assert.equal(toplu.durum.acikAraclar[0]?.id, "b36");
  });

  it("bozuk girdide atmaz", () => {
    const d = etkinlikBaslangici(0);
    const bozuk = [
      { tur: "assistant", message_id: "m", model: null, kullanim: null },
      { tur: "arac_sonucu" },
      { tur: "blok_basladi", blok: "bilinmeyen" },
      { tur: "blok_basladi", blok: "arac", arac_id: 5, arac_adi: 7 },
    ] as unknown as AkisOlayi[];
    for (const o of bozuk) assert.doesNotThrow(() => etkinlikGecisi(d, o, 1));
    assert.doesNotThrow(() => aracKategorisi(undefined as unknown as string));
  });
});

describe("etkinlik: uçtan uca tur", () => {
  it("komut turu: başlangıç, araç, sonuç, yeni model, yazı", () => {
    let d = etkinlikBaslangici(100);
    assert.equal(d.etkinlik, "dusunuyor");

    let g = etkinlikGecisi(d, MODEL, 110);
    assert.equal(g.degisti, false);
    d = g.durum;
    assert.equal(d.baslangic_ms, 100);

    g = etkinlikGecisi(d, aracBlogu("a1", "PowerShell"), 120);
    assert.equal(g.degisti, true);
    assert.equal(g.durum.etkinlik, "komut");
    assert.equal(g.durum.baslangic_ms, 120);
    d = g.durum;

    g = etkinlikGecisi(d, asistan([{ id: "a1", ad: "PowerShell" }]), 130);
    assert.equal(g.degisti, false);
    assert.equal(g.durum.baslangic_ms, 120);
    assert.equal(g.durum.acikAraclar.length, 1);
    d = g.durum;

    g = etkinlikGecisi(d, sonuc("a1"), 140);
    assert.equal(g.degisti, true);
    assert.equal(g.durum.etkinlik, "dusunuyor");
    assert.equal(g.durum.baslangic_ms, 140);
    assert.deepEqual(g.durum.acikAraclar, []);
    d = g.durum;

    g = etkinlikGecisi(d, MODEL, 150);
    assert.equal(g.degisti, false);
    assert.equal(g.durum.baslangic_ms, 140);
    d = g.durum;

    g = etkinlikGecisi(d, METIN_BLOGU, 160);
    assert.equal(g.degisti, true);
    assert.equal(g.durum.etkinlik, "yaziyor");
    assert.equal(g.durum.baslangic_ms, 160);
    d = g.durum;

    g = etkinlikGecisi(d, PARCA, 170);
    assert.equal(g.degisti, false);
    assert.equal(g.durum.etkinlik, "yaziyor");
    assert.equal(g.durum.baslangic_ms, 160);
  });
});
