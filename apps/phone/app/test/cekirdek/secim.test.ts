import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SohbetId } from "@eren/protocol";
import { SECIM_ANAHTARI, secimDeposuKur } from "../../src/cekirdek/secim.ts";
import type { SecimKaydi } from "../../src/cekirdek/sozlesme.ts";
import { bosalt, SahteDepo } from "./sahte.ts";

const id = (s: string): SohbetId => s as SohbetId;

const kayit = (acik = "ana", taban = 5, okundu: Record<string, number> = {}): SecimKaydi => ({
  acik: id(acik),
  taban_seq: taban,
  okundu: okundu as Record<SohbetId, number>,
});

const kur = (depo = new SahteDepo()) => ({ depo, s: secimDeposuKur({ depo }) });

const ham = (depo: SahteDepo, j: unknown) => depo.kv.set(SECIM_ANAHTARI, JSON.stringify(j));
const gecerli = (extra: Record<string, unknown> = {}) => ({
  surum: 1,
  acik: "ana",
  taban_seq: 3,
  okundu: {},
  ...extra,
});

/** Elle cozulen yaz cagrilari: siralama ve araya giren yazim testleri icin. */
class AskidaDepo extends SahteDepo {
  bekleyenler: { deger: string; coz: () => void }[] = [];
  override yaz(anahtar: string, deger: string): Promise<void> {
    return new Promise<void>((coz) => {
      this.bekleyenler.push({
        deger,
        coz: () => {
          this.kv.set(anahtar, deger);
          this.islemler.push({ tur: "yaz", anahtar, deger });
          coz();
        },
      });
    });
  }
}

describe("secim: yukle", () => {
  it("anahtar sabiti sohbet_secimi", () => {
    assert.equal(SECIM_ANAHTARI, "sohbet_secimi");
  });

  it("anahtar yoksa null", async () => {
    assert.equal(await kur().s.yukle(), null);
  });

  it("gidis donus: yaz, bosalt, yeni ornekle yukle", async () => {
    const { depo, s } = kur();
    const k = kayit("s-2", 7, { ana: 9, "s-2": 12 });
    s.yaz(k);
    await s.bosalt();
    assert.deepEqual(await kur(depo).s.yukle(), k);
  });

  it("depo.oku atarsa null (atmaz)", async () => {
    const depo = new SahteDepo();
    depo.oku = () => Promise.reject(new Error("oku"));
    assert.equal(await secimDeposuKur({ depo }).yukle(), null);
  });

  it("bozuk JSON null", async () => {
    const { depo, s } = kur();
    depo.kv.set(SECIM_ANAHTARI, "{bozuk");
    assert.equal(await s.yukle(), null);
  });

  it("kok nesne degilse null", async () => {
    for (const j of [[], 5, "x", null, true]) {
      const { depo, s } = kur();
      ham(depo, j);
      assert.equal(await s.yukle(), null, JSON.stringify(j));
    }
  });

  it("yanlis ya da eksik surum null", async () => {
    for (const surum of [2, 0, "1", null, undefined]) {
      const { depo, s } = kur();
      ham(depo, gecerli({ surum }));
      assert.equal(await s.yukle(), null, String(surum));
    }
  });

  it("gecersiz acik null", async () => {
    for (const acik of ["", "a b", "a/b", "ğ", 5, null, undefined, {}]) {
      const { depo, s } = kur();
      ham(depo, gecerli({ acik }));
      assert.equal(await s.yukle(), null, JSON.stringify(acik));
    }
  });

  it("gecersiz taban_seq null", async () => {
    for (const taban_seq of [-1, 1.5, "3", null, undefined, 2 ** 53, NaN]) {
      const { depo, s } = kur();
      ham(depo, gecerli({ taban_seq }));
      assert.equal(await s.yukle(), null, String(taban_seq));
    }
  });

  it("taban_seq 0 gecerli", async () => {
    const { depo, s } = kur();
    ham(depo, gecerli({ taban_seq: 0 }));
    assert.deepEqual(await s.yukle(), kayit("ana", 0));
  });

  it("okundu icinde gecersiz girdi tek tek atilir, geri kalan korunur", async () => {
    const { depo, s } = kur();
    ham(
      depo,
      gecerli({
        okundu: { ana: 4, "kötü id": 2, "": 1, a: -1, b: 1.5, c: "7", d: null, e: 2 ** 53, f: 6 },
      }),
    );
    assert.deepEqual(await s.yukle(), kayit("ana", 3, { ana: 4, f: 6 }));
  });

  it("okundu yoksa ya da nesne degilse bos nesne", async () => {
    for (const okundu of [undefined, null, [], [1, 2], "x", 5]) {
      const { depo, s } = kur();
      ham(depo, gecerli({ okundu }));
      assert.deepEqual(await s.yukle(), kayit("ana", 3, {}), JSON.stringify(okundu));
    }
  });

  it("__proto__ anahtari prototipi kirletmez", async () => {
    const { depo, s } = kur();
    depo.kv.set(
      SECIM_ANAHTARI,
      '{"surum":1,"acik":"ana","taban_seq":3,"okundu":{"__proto__":{"x":1},"ana":2}}',
    );
    const k = await s.yukle();
    assert.ok(k !== null);
    assert.equal(Object.getPrototypeOf(k.okundu), Object.prototype);
    assert.equal(({} as Record<string, unknown>)["x"], undefined);
    assert.equal((k.okundu as Record<string, unknown>)["x"], undefined);
    assert.equal(k.okundu["ana" as SohbetId], 2);
  });

  it("__proto__ sayi degerliyse de guvenle islenir", async () => {
    const { depo, s } = kur();
    depo.kv.set(
      SECIM_ANAHTARI,
      '{"surum":1,"acik":"ana","taban_seq":3,"okundu":{"__proto__":4,"ana":2}}',
    );
    const k = await s.yukle();
    assert.ok(k !== null);
    assert.equal(Object.getPrototypeOf(k.okundu), Object.prototype);
    assert.equal(k.okundu["ana" as SohbetId], 2);
  });
});

describe("secim: yaz", () => {
  it("diskte yalniz surum, acik, taban_seq, okundu; kimlik ve sayi", async () => {
    const { depo, s } = kur();
    const k = { ...kayit("s-2", 7, { ana: 9 }), ekstra: "kisisel metin" } as SecimKaydi;
    s.yaz(k);
    await s.bosalt();
    const j = JSON.parse(depo.kv.get(SECIM_ANAHTARI) ?? "null") as Record<string, unknown>;
    assert.deepEqual(Object.keys(j).sort(), ["acik", "okundu", "surum", "taban_seq"]);
    assert.deepEqual(j, { surum: 1, acik: "s-2", taban_seq: 7, okundu: { ana: 9 } });
  });

  it("yaz hemen doner (yazim henuz bitmeden)", () => {
    const depo = new AskidaDepo();
    const s = secimDeposuKur({ depo });
    const r = s.yaz(kayit());
    assert.equal(r, undefined);
    assert.equal(depo.kv.has(SECIM_ANAHTARI), false);
  });

  it("ardisik yazimlarda diskte son kayit kalir", async () => {
    const { depo, s } = kur();
    s.yaz(kayit("ana", 1));
    s.yaz(kayit("s-2", 2));
    s.yaz(kayit("s-3", 3, { ana: 3 }));
    await s.bosalt();
    assert.deepEqual(await kur(depo).s.yukle(), kayit("s-3", 3, { ana: 3 }));
  });

  it("yazimlar sirayla: onceki bitmeden sonraki depoya gitmez", async () => {
    const depo = new AskidaDepo();
    const s = secimDeposuKur({ depo });
    s.yaz(kayit("ana", 1));
    await bosalt();
    assert.equal(depo.bekleyenler.length, 1);
    s.yaz(kayit("s-2", 2));
    await bosalt();
    assert.equal(depo.bekleyenler.length, 1, "ilki bitmeden ikincisi baslamamali");
    depo.bekleyenler[0]!.coz();
    await bosalt();
    assert.equal(depo.bekleyenler.length, 2);
    depo.bekleyenler[1]!.coz();
    await s.bosalt();
    assert.equal(JSON.parse(depo.kv.get(SECIM_ANAHTARI)!).acik, "s-2");
  });

  it("depo.yaz hatasi yutulur, sonraki yazim calisir", async () => {
    const { depo, s } = kur();
    depo.hata.yaz = true;
    s.yaz(kayit("ana", 1));
    await s.bosalt();
    assert.equal(depo.kv.has(SECIM_ANAHTARI), false);
    depo.hata.yaz = false;
    s.yaz(kayit("s-2", 2));
    await s.bosalt();
    assert.deepEqual(await kur(depo).s.yukle(), kayit("s-2", 2));
  });
});

describe("secim: bosalt", () => {
  it("hic yazim yoksa hemen cozulur", async () => {
    const { s } = kur();
    await s.bosalt();
  });

  it("yazim bitene kadar cozulmez", async () => {
    const depo = new AskidaDepo();
    const s = secimDeposuKur({ depo });
    s.yaz(kayit());
    let bitti = false;
    const p = s.bosalt().then(() => {
      bitti = true;
    });
    await bosalt();
    assert.equal(bitti, false);
    depo.bekleyenler[0]!.coz();
    await p;
    assert.equal(bitti, true);
  });

  it("beklerken gelen yazimi da bekler", async () => {
    const depo = new AskidaDepo();
    const s = secimDeposuKur({ depo });
    s.yaz(kayit("ana", 1));
    let bitti = false;
    const p = s.bosalt().then(() => {
      bitti = true;
    });
    await bosalt();
    s.yaz(kayit("s-2", 2));
    depo.bekleyenler[0]!.coz();
    await bosalt();
    assert.equal(bitti, false, "araya giren yazim bitmeden cozulmemeli");
    depo.bekleyenler[1]!.coz();
    await p;
    assert.equal(JSON.parse(depo.kv.get(SECIM_ANAHTARI)!).acik, "s-2");
  });

  it("yazim hata verse de cozulur", async () => {
    const { depo, s } = kur();
    depo.hata.yaz = true;
    s.yaz(kayit());
    await s.bosalt();
  });
});
