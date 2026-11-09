import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bitisDurumuBul, raporSec, sonResultOzeti, sonResultSec } from "../src/isler-rapor.ts";
import type { BitisGirdisi } from "../src/isler-rapor.ts";
import type { AkisOlayi, IsSonResult } from "../src/sozlesme.ts";

const GECERLI = {
  yapildi: ["a"],
  yapilmadi: [],
  dosyalar: ["x.ts"],
  acik_noktalar: [],
};
const GECERLI_2 = { ...GECERLI, yapildi: ["b"] };

const sonuc = (kismi: Partial<IsSonResult> = {}): IsSonResult => ({
  is_error: false,
  metin_limit_onekli: false,
  structured_bos: false,
  structured_output: null,
  ...kismi,
});

const gecerliSonuc = (rapor: unknown = GECERLI): IsSonResult => sonuc({ structured_output: rapor });
const raporsuz = (kismi: Partial<IsSonResult> = {}): IsSonResult =>
  sonuc({ structured_bos: true, structured_output: null, ...kismi });

const resultOlayi = (
  kismi: Partial<Extract<AkisOlayi, { tur: "result" }>> = {},
): Extract<AkisOlayi, { tur: "result" }> => ({
  tur: "result",
  session_id: null,
  is_error: false,
  terminal_reason: null,
  stop_reason: null,
  metin: "",
  structured_output: undefined,
  pencereler: {},
  ...kismi,
});

const girdi = (kismi: Partial<BitisGirdisi> = {}): BitisGirdisi => ({
  durdurma: null,
  sonResult: null,
  raporVerVar: false,
  kilitAktif: false,
  zorunlu: null,
  ...kismi,
});

describe("sonResultSec", () => {
  it("önceki null ise yeni döner", () => {
    const yeni = raporsuz();
    assert.equal(sonResultSec(null, yeni), yeni);
  });

  it("önceki geçerli, yeni geçersiz (null): önceki korunur", () => {
    const onceki = gecerliSonuc();
    assert.deepEqual(sonResultSec(onceki, raporsuz()), onceki);
  });

  it("önceki geçerli, yeni structured_output undefined: önceki korunur", () => {
    const onceki = gecerliSonuc();
    assert.deepEqual(sonResultSec(onceki, sonuc({ structured_output: undefined })), onceki);
  });

  it("önceki geçerli, yeni şemaya uymayan nesne: önceki korunur", () => {
    const onceki = gecerliSonuc();
    assert.deepEqual(sonResultSec(onceki, sonuc({ structured_output: { yapildi: 1 } })), onceki);
  });

  it("ikisi de geçerli: yeni kazanır", () => {
    const yeni = gecerliSonuc(GECERLI_2);
    assert.equal(sonResultSec(gecerliSonuc(), yeni), yeni);
  });

  it("önceki geçersiz, yeni geçerli: yeni kazanır", () => {
    const yeni = gecerliSonuc();
    assert.equal(sonResultSec(raporsuz(), yeni), yeni);
  });

  it("ikisi de geçersiz: yeni kazanır", () => {
    const yeni = raporsuz({ is_error: true });
    assert.equal(sonResultSec(raporsuz(), yeni), yeni);
  });

  it("geçerli rapor, ardından raporsuz is_error:false result: rapor korunur", () => {
    const onceki = gecerliSonuc();
    const yeni = sonuc({ is_error: false, structured_output: undefined, structured_bos: true });
    assert.deepEqual(sonResultSec(onceki, yeni), onceki);
  });

  it("geçerli rapor, ardından raporsuz is_error:true result: rapor korunur", () => {
    const onceki = gecerliSonuc();
    assert.deepEqual(sonResultSec(onceki, raporsuz({ is_error: true })), onceki);
  });

  it("geçerli rapor, ardından limit önekli raporsuz result: rapor korunur, limit bayrağı true olur", () => {
    const onceki = gecerliSonuc();
    const yeni = raporsuz({ metin_limit_onekli: true });
    const secilen = sonResultSec(onceki, yeni);
    assert.deepEqual(secilen.structured_output, GECERLI);
    assert.equal(secilen.metin_limit_onekli, true);
    assert.equal(secilen.is_error, onceki.is_error);
    assert.equal(secilen.structured_bos, onceki.structured_bos);
  });

  it("geçerli rapor, ardından öneksiz raporsuz result: limit bayrağı false kalır", () => {
    const secilen = sonResultSec(gecerliSonuc(), raporsuz({ metin_limit_onekli: false }));
    assert.equal(secilen.metin_limit_onekli, false);
    assert.deepEqual(secilen.structured_output, GECERLI);
  });
});

describe("bitisDurumuBul", () => {
  it("structured_bos + kilit yok: yarim", () => {
    assert.equal(bitisDurumuBul(girdi({ sonResult: raporsuz(), kilitAktif: false })), "yarim");
  });

  it("structured_bos + kilit aktif: limit_durdu", () => {
    assert.equal(bitisDurumuBul(girdi({ sonResult: raporsuz(), kilitAktif: true })), "limit_durdu");
  });

  it("durdurma limit: limit_durdu", () => {
    assert.equal(bitisDurumuBul(girdi({ durdurma: "limit", sonResult: gecerliSonuc() })), "limit_durdu");
  });

  for (const d of ["kullanici", "eren", "izin_durduruldu"] as const) {
    it(`durdurma ${d}: iptal`, () => {
      assert.equal(bitisDurumuBul(girdi({ durdurma: d, sonResult: gecerliSonuc() })), "iptal");
    });
  }

  it("durdurma dogal: sonraki satırlara düşer", () => {
    assert.equal(bitisDurumuBul(girdi({ durdurma: "dogal", sonResult: gecerliSonuc() })), "tamam");
  });

  it("zorunlu değer sonuçtan önce gelir", () => {
    assert.equal(bitisDurumuBul(girdi({ zorunlu: "hata", sonResult: gecerliSonuc() })), "hata");
  });

  it("sonResult null: kilit yok yarim, kilit var limit_durdu", () => {
    assert.equal(bitisDurumuBul(girdi()), "yarim");
    assert.equal(bitisDurumuBul(girdi({ kilitAktif: true })), "limit_durdu");
  });

  it("metin_limit_onekli: limit_durdu", () => {
    assert.equal(bitisDurumuBul(girdi({ sonResult: sonuc({ metin_limit_onekli: true }) })), "limit_durdu");
  });

  it("is_error: hata", () => {
    assert.equal(bitisDurumuBul(girdi({ sonResult: sonuc({ is_error: true }) })), "hata");
  });

  it("raporVerVar: tamam", () => {
    assert.equal(bitisDurumuBul(girdi({ sonResult: raporsuz(), raporVerVar: true })), "tamam");
  });

  it("şemaya uyan structured_output: tamam", () => {
    assert.equal(bitisDurumuBul(girdi({ sonResult: gecerliSonuc() })), "tamam");
  });

  it("şemaya uymayan, boş olmayan structured_output: hata", () => {
    const s = sonuc({ structured_output: { yapildi: 1 } });
    assert.equal(bitisDurumuBul(girdi({ sonResult: s })), "hata");
  });
});

describe("uçtan uca: rapor sonrası raporsuz result", () => {
  it("katlanan result tamam sayılır, rapor result kaynağından gelir", () => {
    const ilk = sonResultOzeti(resultOlayi({ structured_output: GECERLI, metin: "rapor" }));
    const ikinci = sonResultOzeti(resultOlayi({ structured_output: undefined, metin: "arka plan agent bitti" }));
    assert.equal(ikinci.structured_bos, true);

    const katlanmis = sonResultSec(sonResultSec(null, ilk), ikinci);
    assert.equal(bitisDurumuBul(girdi({ sonResult: katlanmis })), "tamam");

    const secim = raporSec(katlanmis, null);
    assert.equal(secim.kaynak, "result");
    assert.deepEqual(secim.rapor, GECERLI);
  });

  it("hiç rapor yoksa katlama yarim verir, limit değilken limit_durdu çıkmaz", () => {
    const a = sonResultOzeti(resultOlayi());
    const b = sonResultOzeti(resultOlayi({ metin: "düz metin" }));
    const katlanmis = sonResultSec(sonResultSec(null, a), b);
    assert.equal(bitisDurumuBul(girdi({ sonResult: katlanmis })), "yarim");
  });

  it("rapor + limit önekli raporsuz result: iki kilit durumunda da limit_durdu, rapor result kaynağından", () => {
    const ilk = sonResultOzeti(resultOlayi({ structured_output: GECERLI }));
    const ikinci = sonResultOzeti(resultOlayi({ metin: "[limit-kilit] limit doldu" }));
    assert.equal(ikinci.metin_limit_onekli, true);
    const katlanmis = sonResultSec(ilk, ikinci);
    assert.equal(bitisDurumuBul(girdi({ sonResult: katlanmis, kilitAktif: false })), "limit_durdu");
    assert.equal(bitisDurumuBul(girdi({ sonResult: katlanmis, kilitAktif: true })), "limit_durdu");
    const secim = raporSec(katlanmis, null);
    assert.equal(secim.kaynak, "result");
    assert.deepEqual(secim.rapor, GECERLI);
  });
});
