import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { konusmaMetni } from "../../src/cekirdek/konusmaMetni.ts";

const durumlar: Array<[string, string, string]> = [
  ["kalın vurgu kalkar", "**Merhaba** Selman", "Merhaba Selman"],
  ["başlık işareti kalkar, satır noktalanır", "# Başlık\nMetin", "Başlık. Metin"],
  ["madde imi kalkar", "- bir\n- iki", "bir. iki"],
  ["numaralı liste numarası kalır", "1. bir\n2. iki", "1. bir. 2. iki"],
  [
    "çitli kod bloğu 'kod bloğu' olur",
    "Şunu çalıştır:\n```bash\nnpm i\n```\nSonra dene.",
    "Şunu çalıştır: kod bloğu. Sonra dene.",
  ],
  ["satır içi kod: tırnaklar kalkar", "`npm test` komutu", "npm test komutu"],
  ["bağlantı yazıya iner", "[belge](https://x.y/z) burada", "belge burada"],
  ["çıplak adres 'bağlantı' olur", "Bak: https://example.com/a?b=1", "Bak: bağlantı"],
  ["tablo: ayırıcı düşer, hücreler virgülle birleşir", "| a | b |\n|---|---|\n| 1 | 2 |", "a, b. 1, 2"],
  ["alıntı işareti kalkar", "> alıntı", "alıntı"],
  ["sözcük içi alt çizgi ve boşluklu yıldız aynen kalır", "dosya_adi_bir ve 2 * 3", "dosya_adi_bir ve 2 * 3"],
  ["yatay çizgi satırı düşer", "Üst\n\n---\n\nAlt", "Üst. Alt"],
  ["yalnız boşluk girdi boş dizge verir", "   ", ""],
  ["dil etiketsiz çit", "```\nx\n```", "kod bloğu"],
  ["boş girdi boş dizge verir", "", ""],
  ["~~~ çiti kod bloğu olur", "~~~\nx\n~~~", "kod bloğu"],
  ["görsel alt yazıya iner", "![logo](a.png)", "logo"],
  ["__kalın__ vurgusu kalkar", "__kalın__ yazı", "kalın yazı"],
  ["~~üstü çizili~~ işareti kalkar", "~~eski~~ yeni", "eski yeni"],
  ["*eğik* ve _eğik_ işaretleri kalkar", "*eğik* ve _eğik_", "eğik ve eğik"],
  ["kapanmamış çit sona kadar tek kod bloğu", "Önce\n```js\nlet a;\nhâlâ kod", "Önce. kod bloğu"],
  ["+ madde imi kalkar", "+ bir\n+ iki", "bir. iki"],
  ["### başlık işareti kalkar", "### Alt başlık\nMetin", "Alt başlık. Metin"],
  ["… ile biten satıra nokta eklenmez", "Bekle…\nSonra", "Bekle… Sonra"],
  ["tek başına adres olan satır içi kod 'bağlantı' olur", "`http://localhost:3000` adresini aç", "bağlantı adresini aç"],
  ["adresten fazlası olan satır içi kod aynen kalır", "`curl https://x.y` çalıştır", "curl https://x.y çalıştır"],
  ["köşeli parantezli adres 'bağlantı' olur", "Bak: <https://x.com>", "Bak: bağlantı"],
  ["köşeli parantezli adresten sonraki nokta korunur", "<https://x.com>.", "bağlantı."],
  ["art arda boşluklar tek boşluğa iner", "a    b", "a b"],
  [
    "çok satırlı gerçekçi cevap",
    "# Plan\n\nBugün şunları yapalım:\n\n1. **Kur** paketi\n2. `npm test` çalıştır\n\nDetay: [belge](https://x.y)",
    "Plan. Bugün şunları yapalım: 1. Kur paketi. 2. npm test çalıştır. Detay: belge",
  ],
];

describe("konusmaMetni", () => {
  for (const [ad, girdi, beklenen] of durumlar) {
    it(ad, () => {
      assert.equal(konusmaMetni(girdi), beklenen);
    });
  }
});
