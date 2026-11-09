import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { markdownAyristir } from "../../src/ekranlar/markdown.ts";
import type { Blok, SatirIci } from "../../src/ekranlar/markdown.ts";

type Tur<T extends Blok["tur"]> = Extract<Blok, { tur: T }>;

/** Satır içi parçaları, biçimleri atarak düz metne indirir. */
const duz = (parcalar: readonly SatirIci[]): string =>
  parcalar
    .map((p) => {
      switch (p.tur) {
        case "metin":
        case "kod":
          return p.metin;
        case "baglanti":
          return p.metin;
        case "kalin":
        case "italik":
          return duz(p.parcalar);
      }
    })
    .join("");

/** Bloğu türüne göre daraltır; tür uymazsa testi düşürür. */
const tur = <T extends Blok["tur"]>(b: Blok | undefined, t: T): Tur<T> => {
  assert.ok(b, `blok yok (beklenen ${t})`);
  assert.equal(b.tur, t);
  return b as Tur<T>;
};

/** Ağaçtaki tüm satır içi düğümleri (iç içe dahil) düz listeye çıkarır. */
const hepsi = (parcalar: readonly SatirIci[]): SatirIci[] =>
  parcalar.flatMap((p) =>
    p.tur === "kalin" || p.tur === "italik" ? [p, ...hepsi(p.parcalar)] : [p],
  );

const paragraf = (metin: string): readonly SatirIci[] => {
  const b = markdownAyristir(metin);
  assert.equal(b.length, 1, `tek blok beklendi: ${JSON.stringify(b)}`);
  return tur(b[0], "paragraf").parcalar;
};

describe("markdown: başlık ve paragraf", () => {
  it("#, ##, ### düzeyleri doğru", () => {
    const b = markdownAyristir("# Bir\n\n## İki\n\n### Üç");
    assert.equal(b.length, 3);
    const d = b.map((x) => {
      const h = tur(x, "baslik");
      return [h.duzey, duz(h.parcalar)];
    });
    assert.deepEqual(d, [
      [1, "Bir"],
      [2, "İki"],
      [3, "Üç"],
    ]);
  });

  it("#### ve sonrası düzey 3 sayılır", () => {
    for (const isaret of ["####", "#####", "######"]) {
      const b = markdownAyristir(`${isaret} Derin`);
      const h = tur(b[0], "baslik");
      assert.equal(h.duzey, 3, isaret);
      assert.equal(duz(h.parcalar), "Derin");
    }
  });

  it("boş satır paragrafları ayırır", () => {
    const b = markdownAyristir("birinci\n\nikinci\n\n\n\nüçüncü");
    assert.equal(b.length, 3);
    assert.deepEqual(
      b.map((x) => duz(tur(x, "paragraf").parcalar)),
      ["birinci", "ikinci", "üçüncü"],
    );
  });

  it("paragraf içindeki tek satır sonu \\n olarak korunur", () => {
    const p = paragraf("ilk satır\nikinci satır");
    assert.equal(duz(p), "ilk satır\nikinci satır");
  });
});

describe("markdown: liste", () => {
  it("-, *, + sırasız listedir", () => {
    for (const isaret of ["-", "*", "+"]) {
      const b = markdownAyristir(`${isaret} elma\n${isaret} armut`);
      assert.equal(b.length, 1, isaret);
      const l = tur(b[0], "liste");
      assert.equal(l.sirali, false, isaret);
      assert.deepEqual(l.ogeler.map(duz), ["elma", "armut"], isaret);
    }
  });

  it("1. ve 1) sıralı listedir; başlangıç ilk numaradır", () => {
    const a = tur(markdownAyristir("1. bir\n2. iki\n3. üç")[0], "liste");
    assert.equal(a.sirali, true);
    assert.equal(a.baslangic, 1);
    assert.deepEqual(a.ogeler.map(duz), ["bir", "iki", "üç"]);

    const b = tur(markdownAyristir("5) beş\n6) altı")[0], "liste");
    assert.equal(b.sirali, true);
    assert.equal(b.baslangic, 5);
    assert.deepEqual(b.ogeler.map(duz), ["beş", "altı"]);
  });

  it("iç içe liste düzleştirilir (hiçbir öğe kaybolmaz)", () => {
    const b = markdownAyristir("- ana\n  - alt bir\n  - alt iki\n- ikinci");
    const l = tur(b[0], "liste");
    const metinler = l.ogeler.map(duz);
    assert.equal(metinler.length, 4);
    assert.deepEqual(
      metinler.map((m) => m.trim()),
      ["ana", "alt bir", "alt iki", "ikinci"],
    );
  });

  it("liste öğesinde satır içi biçim çalışır", () => {
    const l = tur(markdownAyristir("- **kalın** öğe")[0], "liste");
    const ilk = l.ogeler[0];
    assert.ok(ilk);
    assert.ok(hepsi(ilk).some((p) => p.tur === "kalin"));
    assert.equal(duz(ilk), "kalın öğe");
  });
});

describe("markdown: kod bloğu", () => {
  it("dil etiketli çit", () => {
    const b = markdownAyristir("```ts\nconst a = 1;\nconst b = 2;\n```");
    assert.equal(b.length, 1);
    const k = tur(b[0], "kodBlogu");
    assert.equal(k.dil, "ts");
    assert.equal(k.metin.trim(), "const a = 1;\nconst b = 2;");
  });

  it("dil etiketi yoksa dil null", () => {
    const k = tur(markdownAyristir("```\nçıplak\n```")[0], "kodBlogu");
    assert.equal(k.dil, null);
    assert.equal(k.metin.trim(), "çıplak");
  });

  it("kod bloğunun içi satır içi biçim olarak ayrıştırılmaz", () => {
    const b = markdownAyristir("```\n**kalın değil** [a](https://x.y)\n```");
    assert.equal(b.length, 1);
    const k = tur(b[0], "kodBlogu");
    assert.ok(k.metin.includes("**kalın değil**"));
  });

  it("kapanmamış blok metnin sonuna kadar sürer", () => {
    const b = markdownAyristir("önce\n\n```py\nprint(1)\nprint(2)");
    assert.equal(b.length, 2);
    tur(b[0], "paragraf");
    const k = tur(b[1], "kodBlogu");
    assert.equal(k.dil, "py");
    assert.ok(k.metin.includes("print(1)"));
    assert.ok(k.metin.includes("print(2)"));
  });

  it("kod bloğundan sonraki metin yine ayrışır", () => {
    const b = markdownAyristir("```\nx\n```\n\nsonra");
    assert.equal(b.length, 2);
    tur(b[0], "kodBlogu");
    assert.equal(duz(tur(b[1], "paragraf").parcalar), "sonra");
  });
});

describe("markdown: alıntı, ayraç, tablo", () => {
  it("> alıntı olur", () => {
    const b = markdownAyristir("> bilge söz");
    assert.equal(b.length, 1);
    assert.equal(duz(tur(b[0], "alinti").parcalar).trim(), "bilge söz");
  });

  it("--- ve *** ayraçtır", () => {
    const b = markdownAyristir("üst\n\n---\n\nalt\n\n***\n\nson");
    assert.deepEqual(
      b.map((x) => x.tur),
      ["paragraf", "ayrac", "paragraf", "ayrac", "paragraf"],
    );
  });

  it("GitHub tablosu başlık ve gövdeye ayrılır", () => {
    const b = markdownAyristir(
      "| Ad | Yaş |\n|----|-----|\n| Ali | 30 |\n| **Ayşe** | 25 |",
    );
    assert.equal(b.length, 1);
    const t = tur(b[0], "tablo");
    assert.deepEqual(t.basliklar.map(duz).map((s) => s.trim()), ["Ad", "Yaş"]);
    assert.equal(t.satirlar.length, 2);
    assert.deepEqual(
      t.satirlar.map((s) => s.map(duz).map((x) => x.trim())),
      [
        ["Ali", "30"],
        ["Ayşe", "25"],
      ],
    );
    const hucre = t.satirlar[1]?.[0];
    assert.ok(hucre && hepsi(hucre).some((p) => p.tur === "kalin"));
  });

  it("bozuk tablo (ayırıcı satır yok) paragraf olur", () => {
    const b = markdownAyristir("| Ad | Yaş |\n| Ali | 30 |");
    assert.ok(b.every((x) => x.tur !== "tablo"), JSON.stringify(b));
    assert.ok(b.length >= 1);
    assert.equal(b[0]?.tur, "paragraf");
  });
});

describe("markdown: satır içi", () => {
  it("**kalın** ve __kalın__", () => {
    for (const m of ["**kalın**", "__kalın__"]) {
      const p = paragraf(`önce ${m} sonra`);
      const k = p.find((x) => x.tur === "kalin");
      assert.ok(k && k.tur === "kalin", m);
      assert.equal(duz(k.parcalar), "kalın", m);
      assert.equal(duz(p), "önce kalın sonra", m);
    }
  });

  it("*italik* ve _italik_", () => {
    for (const m of ["*italik*", "_italik_"]) {
      const p = paragraf(`önce ${m} sonra`);
      const k = p.find((x) => x.tur === "italik");
      assert.ok(k && k.tur === "italik", m);
      assert.equal(duz(k.parcalar), "italik", m);
      assert.equal(duz(p), "önce italik sonra", m);
    }
  });

  it("`kod` parçası", () => {
    const p = paragraf("çalıştır `npm test` şimdi");
    const k = p.find((x) => x.tur === "kod");
    assert.ok(k && k.tur === "kod");
    assert.equal(k.metin, "npm test");
  });

  it("kod parçasının içi biçimlenmez", () => {
    const p = paragraf("`**ham**`");
    const k = p.find((x) => x.tur === "kod");
    assert.ok(k && k.tur === "kod");
    assert.equal(k.metin, "**ham**");
    assert.ok(!p.some((x) => x.tur === "kalin"));
  });

  it("[metin](adres) http ve https için bağlantı olur", () => {
    for (const adres of ["https://example.com/a?b=1", "http://example.com"]) {
      const p = paragraf(`bak [site](${adres}) güzel`);
      const k = p.find((x) => x.tur === "baglanti");
      assert.ok(k && k.tur === "baglanti", adres);
      assert.equal(k.metin, "site");
      assert.equal(k.adres, adres);
    }
  });

  it("javascript: adresi asla bağlantı olmaz, düz metin kalır", () => {
    for (const adres of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "file:///C:/x",
    ]) {
      const p = paragraf(`[tıkla](${adres})`);
      assert.ok(
        !hepsi(p).some((x) => x.tur === "baglanti"),
        `bağlantı oluştu: ${adres}`,
      );
      assert.ok(duz(p).includes("tıkla"), adres);
    }
    // başlık, liste ve tablo içinde de aynı kural
    const b = markdownAyristir("# [x](javascript:alert(1))\n\n- [y](javascript:alert(1))");
    const h = tur(b[0], "baslik");
    assert.ok(!hepsi(h.parcalar).some((x) => x.tur === "baglanti"));
    const l = tur(b[1], "liste");
    assert.ok(!l.ogeler.some((o) => hepsi(o).some((x) => x.tur === "baglanti")));
  });

  it("şüpheli http(s) adresleri (@, \\, boşluk, boş alan adı, ASCII dışı) bağlantı olmaz", () => {
    for (const girdi of [
      "[good.com](https://evil.com\\@good.com)",
      "[x](https:///evil.com)",
      "[x](https://a b.com)",
      "[x](https://kötü.com)",
      "[x](https://user@evil.com)",
      "[x](https://user:pw@evil.com)",
      "[x](https://evil.com\\good.com)",
    ]) {
      const b = markdownAyristir(girdi);
      assert.ok(b.length >= 1, girdi);
      for (const blok of b) {
        const p = tur(blok, "paragraf").parcalar;
        assert.ok(!hepsi(p).some((x) => x.tur === "baglanti"), `bağlantı oluştu: ${girdi}`);
      }
    }
  });

  it("geçerli http(s) adresleri bağlantı olur", () => {
    for (const adres of [
      "https://example.com",
      "https://example.com:8080/yol?a=1#b",
      "http://192.168.1.5:8080",
      "https://example.com/yol@iz",
      "https://www.npmjs.com/package/@scope/x",
      "https://example.com/?e=a@b#c@d",
    ]) {
      const p = paragraf(`[x](${adres})`);
      const k = p.find((x) => x.tur === "baglanti");
      assert.ok(k && k.tur === "baglanti", adres);
      assert.equal(k.adres, adres);
      assert.equal(k.metin, "x");
    }
  });

  it("javascript: bağlantısı düz metin olarak adresi de korur", () => {
    const p = paragraf("[a](javascript:alert(1))");
    assert.ok(duz(p).includes("javascript:alert(1)"));
  });

  it("kelime içindeki alt çizgi italik sayılmaz", () => {
    const p = paragraf("dosya_adi_bu burada");
    assert.ok(!hepsi(p).some((x) => x.tur === "italik"));
    assert.equal(duz(p), "dosya_adi_bu burada");
  });

  it("\\* kaçışı yıldızı düz metin yapar", () => {
    const p = paragraf("\\*değil italik\\*");
    assert.ok(!hepsi(p).some((x) => x.tur === "italik" || x.tur === "kalin"));
    const d = duz(p);
    assert.ok(d.includes("*değil italik*"), d);
  });

  it("kalın içinde italik iç içe geçebilir", () => {
    const p = paragraf("**kalın *eğik* kalın**");
    const k = p.find((x) => x.tur === "kalin");
    assert.ok(k && k.tur === "kalin");
    assert.ok(hepsi(k.parcalar).some((x) => x.tur === "italik"));
    assert.equal(duz(p), "kalın eğik kalın");
  });
});

describe("markdown: dayanıklılık", () => {
  const girdiler: readonly [string, string][] = [
    ["boş dize", ""],
    ["yalnız boşluk", "   \t  "],
    ["yalnız satır sonları", "\n\n\r\n\n"],
    ["kapanmamış **", "bu **kapanmaz"],
    ["kapanmamış *", "bu *kapanmaz"],
    ["kapanmamış `", "bu `kapanmaz"],
    ["kapanmamış bağlantı", "[metin](https://x.y"],
    ["yarım bağlantı", "[metin]("],
    ["yalnız köşeli", "[[[]]](((())))"],
    ["iç içe çitler", "```\n```\n```\n```\n````\n```ts\n```"],
    ["çit içinde çit", "```md\n```js\nx\n```\n```"],
    ["tırnak yığını", ">>>>>> > > >\n> > a"],
    ["yalnız ayraçlar", "---\n***\n---\n***"],
    ["tablo çöpü", "|\n|-|\n||||\n|---|---|\n| a"],
    ["yalnız tablo ayırıcı", "|---|---|"],
    ["çok sayıda yıldız", "*".repeat(5000)],
    ["çok sayıda alt çizgi", "_".repeat(5000)],
    ["çok sayıda ters tırnak", "`".repeat(5000)],
    ["çok sayıda açan parantez", "[".repeat(5000)],
    ["derin iç içe liste", Array.from({ length: 300 }, (_, i) => `${" ".repeat(i)}- x`).join("\n")],
    ["CRLF", "# Başlık\r\n\r\nmetin\r\n- a\r\n- b\r\n"],
    ["NUL ve kontrol karakterleri", "a\u0000b\u0001\u001f\u007f c"],
    ["tek başına vekil", "\ud800 \udfff \ud83d"],
    ["emoji", "😀 **😀** `😀` [😀](https://e.com)"],
  ];

  for (const [ad, girdi] of girdiler) {
    it(`atmaz: ${ad}`, () => {
      const sonuc = markdownAyristir(girdi);
      assert.ok(Array.isArray(sonuc));
    });
  }

  it("boş ve yalnız boşluk girdi boş dizi (ya da yalnız boş) döner", () => {
    assert.equal(markdownAyristir("").length, 0);
    const b = markdownAyristir("   \n  ");
    assert.ok(b.every((x) => x.tur === "paragraf" && duz(x.parcalar).trim() === ""));
  });

  it("kapanmamış ** metni kaybetmez", () => {
    const p = paragraf("bu **kapanmaz");
    assert.ok(duz(p).includes("kapanmaz"));
    assert.ok(duz(p).includes("bu"));
  });

  it("rastgele baytlar (sabit tohumlu) hiçbir zaman atmaz", () => {
    let tohum = 123456789;
    const sonraki = (): number => {
      tohum = (Math.imul(tohum, 1664525) + 1013904223) >>> 0;
      return tohum;
    };
    const parcalar = ["*", "_", "`", "[", "]", "(", ")", "|", "-", "#", ">", "\n", " ", "\\", "1.", "```", "http://", "a", "ş"];
    for (let i = 0; i < 300; i++) {
      let s = "";
      const uzun = sonraki() % 200;
      for (let j = 0; j < uzun; j++) {
        s +=
          sonraki() % 3 === 0
            ? String.fromCharCode(sonraki() % 0x10000)
            : parcalar[sonraki() % parcalar.length];
      }
      assert.doesNotThrow(() => markdownAyristir(s), JSON.stringify(s));
    }
  });

  it("Windows yolu bozulmadan bir metin parçasında kalır", () => {
    const yol = "C:\\ornek\\server\\src\\ana.ts";
    const p = paragraf(`dosya ${yol} içinde`);
    assert.ok(
      p.some((x) => x.tur === "metin" && x.metin.includes(yol)),
      JSON.stringify(p),
    );
  });

  it("yalnız Windows yolu içeren paragraf", () => {
    const yol = "C:\\ornek\\server\\src\\ana.ts";
    assert.equal(duz(paragraf(yol)), yol);
  });

  it("100 KB girdi 200 ms altında ayrışır", () => {
    const parca =
      "# Başlık\n\nBu **kalın**, *eğik* ve `kod` içeren bir paragraf [bağ](https://e.com) ile.\n\n- madde bir\n- madde iki\n\n```ts\nconst x = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> alıntı\n\n";
    let girdi = "";
    while (girdi.length < 100_000) girdi += parca;
    const t0 = performance.now();
    const b = markdownAyristir(girdi);
    const sure = performance.now() - t0;
    assert.ok(b.length > 100);
    assert.ok(sure < 200, `süre ${sure.toFixed(1)} ms`);
  });

  it("kötü niyetli tek satır girdilerde süre doğrusal büyür (10 KB -> 100 KB)", () => {
    const olc = (girdi: string): number => {
      const t0 = performance.now();
      markdownAyristir(girdi);
      return performance.now() - t0;
    };
    for (const [birim, ad] of [
      ["*a ", "yıldız"],
      ["[a](", "bağlantı"],
      ["`a", "ters tırnak"],
      ["_a ", "alt çizgi"],
    ] as const) {
      const kucuk = birim.repeat(Math.ceil(10_000 / birim.length));
      const buyuk = birim.repeat(Math.ceil(100_000 / birim.length));
      olc(kucuk); // ısınma
      olc(buyuk);
      // gürültüye karşı üç ölçümün en küçüğü
      const k = Math.max(0.5, Math.min(olc(kucuk), olc(kucuk), olc(kucuk)));
      const b = Math.min(olc(buyuk), olc(buyuk), olc(buyuk));
      assert.ok(b < 1000, `${ad}: 100 KB ${b.toFixed(1)} ms`);
      // doğrusal ~10x, karesel ~100x; sınır 25
      assert.ok(b / k < 25, `${ad}: oran ${(b / k).toFixed(1)} (10 KB ${k.toFixed(1)} ms, 100 KB ${b.toFixed(1)} ms)`);
    }
  });
});
