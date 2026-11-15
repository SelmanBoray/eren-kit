import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  eslesmeNotu,
  sesKisayoluAciklamasi,
  sesKisayoluNotu,
  tamYetkiAciklamasi,
  uygulamalarAciklamasi,
} from "../../src/ekranlar/kurulumMetni.ts";

const AD = "Asistan";

/** Kodun garanti etmediği mutlak ifadeler ve denetimde yanıltıcı bulunan kalıplar. */
const YASAK_KALIPLAR = [/her zaman/i, /\basla\b/i, /hiçbir zaman/i, /dışındaki her uygulama/i, /açtığın(ız)? uygulamalarda/i];

function mutlakIfadeYok(metin: string): void {
  for (const k of YASAK_KALIPLAR) assert.doesNotMatch(metin, k);
}

describe("kurulum metinleri: tam yetki ve uygulamalar", () => {
  it("tam yetki açıklaması varsayılanın açık olduğunu ve eşleşmenin yetkiyi kapattığını söyler", () => {
    const m = tamYetkiAciklamasi(AD);
    assert.match(m, /varsayılan olarak açık/);
    assert.match(m, /başka bir PC ile eşleşmek de tam yetkiyi kapatır/);
    assert.ok(m.includes(AD));
    mutlakIfadeYok(m);
  });

  it("uygulamalar açıklaması banka tespitini tahmin olarak anlatır", () => {
    const m = uygulamalarAciklamasi(AD);
    assert.match(m, /varsayılan olarak/);
    assert.match(m, /tahmin/);
    assert.match(m, /her uygulamayı yakalamaz/);
    mutlakIfadeYok(m);
  });
});

describe("kurulum metinleri: ses tuşu kısayolu", () => {
  it("açıklama mevcut kısayolun silinmediğini söyler", () => {
    const m = sesKisayoluAciklamasi(AD);
    assert.match(m, /mevcut erişilebilirlik kısayolunu .*silmez/);
    mutlakIfadeYok(m);
  });

  it("önceki hedef korunduysa not bunu söyler", () => {
    const m = sesKisayoluNotu({ ok: true, deger: "kuruldu_digerleriyle" });
    assert.match(m, /Önceki erişilebilirlik kısayolun silinmedi/);
    assert.match(m, /onay isteyebilir/);
  });

  it("tek hedefte not yalnız kurulumu ve olası sistem onayını söyler", () => {
    const m = sesKisayoluNotu({ ok: true, deger: "kuruldu" });
    assert.match(m, /^Kısayol kuruldu\./);
    assert.doesNotMatch(m, /Önceki/);
  });

  it("hata ve yetki yok ayrı notlar verir", () => {
    assert.match(sesKisayoluNotu({ ok: true, deger: "hata" }), /kurulamadı/);
    assert.match(sesKisayoluNotu({ ok: false, neden: "hata" }), /kurulamadı/);
    assert.match(sesKisayoluNotu({ ok: false, neden: "desteklenmiyor" }), /kurulamadı/);
    assert.match(sesKisayoluNotu({ ok: true, deger: "yetki_yok" }), /Kurulum adımı eksik/);
  });
});

describe("kurulum metinleri: eşleşme notu", () => {
  it("tam yetki açıkken başarılı eşleşme yetkinin kapandığını söyler", () => {
    assert.match(eslesmeNotu({ ok: true, deger: { sonuc: "tamam" } }, true), /Tam yetki kapatıldı/);
  });

  it("tam yetki kapalıyken ya da eşleşme olmadıysa yetkiden söz etmez", () => {
    assert.equal(eslesmeNotu({ ok: true, deger: { sonuc: "tamam" } }, false), "Eşleşildi.");
    assert.equal(eslesmeNotu({ ok: true, deger: { sonuc: "iptal" } }, true), "Eşleşme iptal edildi.");
    assert.equal(eslesmeNotu({ ok: true, deger: { sonuc: "hata" } }, true), "Eşleşme başarısız.");
    assert.equal(eslesmeNotu({ ok: false, neden: "desteklenmiyor" }, true), "Bu cihazda eşleşme desteklenmiyor.");
    assert.equal(eslesmeNotu({ ok: false, neden: "hata" }, false), "Eşleşme başlatılamadı.");
  });
});
