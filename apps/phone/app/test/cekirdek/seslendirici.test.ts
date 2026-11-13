import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seslendiriciKur } from "../../src/cekirdek/seslendirici.ts";
import type { SesPortu } from "../../src/cekirdek/sozlesme.ts";

// Mikro görev kuyruğunu (ve zincirdeki then'leri) boşaltır; sabit süre beklemez.
const bosalt = (): Promise<void> => new Promise((coz) => setImmediate(coz));

interface SahteSes extends SesPortu {
  seslendirCagrilari: string[];
  durdurSayisi: number;
  aktif: number;
  enFazlaAktif: number;
  seslendirSonuc: () => Promise<boolean>;
  durdurSonuc: () => Promise<void>;
  durumDinleHatasi: boolean;
  bildir(k: boolean): void;
}

const sahteSes = (): SahteSes => {
  let dinleyici: ((k: boolean) => void) | null = null;
  const s: SahteSes = {
    seslendirCagrilari: [],
    durdurSayisi: 0,
    aktif: 0,
    enFazlaAktif: 0,
    seslendirSonuc: async () => true,
    durdurSonuc: async () => {},
    durumDinleHatasi: false,
    seslendir: async (metin: string) => {
      s.seslendirCagrilari.push(metin);
      s.aktif++;
      s.enFazlaAktif = Math.max(s.enFazlaAktif, s.aktif);
      try {
        return await s.seslendirSonuc();
      } finally {
        s.aktif--;
      }
    },
    durdur: async () => {
      s.durdurSayisi++;
      return s.durdurSonuc();
    },
    durumDinle: (f) => {
      if (s.durumDinleHatasi) throw new Error("dinleme kurulamadı");
      dinleyici = f;
      return () => {
        dinleyici = null;
      };
    },
    bildir: (k) => dinleyici?.(k),
  };
  return s;
};

const kur = (ses: SahteSes) => {
  let degistiSayisi = 0;
  const s = seslendiriciKur({ ses, degisti: () => degistiSayisi++ });
  return { s, degisti: () => degistiSayisi };
};

describe("seslendirici", () => {
  it("oku Markdown'ı temizleyip portun seslendir'ini bir kez çağırır", async () => {
    const ses = sahteSes();
    const { s } = kur(ses);
    s.oku("**Merhaba** Selman");
    await bosalt();
    assert.deepEqual(ses.seslendirCagrilari, ["Merhaba Selman"]);
  });

  it("temizlenince boş kalan metinde port çağrılmaz", async () => {
    const ses = sahteSes();
    const { s } = kur(ses);
    s.oku("   ");
    await bosalt();
    assert.deepEqual(ses.seslendirCagrilari, []);
  });

  it("port durum bildirince konusuyor ve degisti güncellenir", async () => {
    const ses = sahteSes();
    const { s, degisti } = kur(ses);
    assert.equal(s.konusuyor(), false);
    ses.bildir(true);
    assert.equal(s.konusuyor(), true);
    assert.equal(degisti(), 1);
    ses.bildir(false);
    assert.equal(s.konusuyor(), false);
    assert.equal(degisti(), 2);
  });

  it("durdur portun durdur'unu çağırır", async () => {
    const ses = sahteSes();
    const { s } = kur(ses);
    s.durdur();
    await bosalt();
    assert.ok(ses.durdurSayisi >= 1);
  });

  it("yeni oku süren okumanın yerine geçer; çağrılar iç içe girmez", async () => {
    const ses = sahteSes();
    // Okuma, durdur çağrılana kadar sürsün.
    let bitir: (() => void) | null = null;
    ses.seslendirSonuc = () =>
      new Promise<boolean>((coz) => {
        bitir = () => coz(true);
      });
    ses.durdurSonuc = async () => {
      bitir?.();
    };
    const { s } = kur(ses);
    s.oku("birinci");
    await bosalt();
    s.oku("ikinci");
    await bosalt();
    assert.equal(ses.seslendirCagrilari.at(-1), "ikinci");
    assert.equal(ses.enFazlaAktif, 1);
  });

  it("art arda iki oku: porta en son verilen metin ikincidir", async () => {
    const ses = sahteSes();
    const { s } = kur(ses);
    s.oku("birinci");
    s.oku("ikinci");
    await bosalt();
    assert.equal(ses.seslendirCagrilari.at(-1), "ikinci");
    assert.equal(ses.enFazlaAktif, 1);
  });

  it("seslendir reddederse oku atmaz, işlenmemiş ret oluşmaz, sonraki oku çalışır", async () => {
    const ses = sahteSes();
    const redler: unknown[] = [];
    const dinle = (e: unknown) => redler.push(e);
    process.on("unhandledRejection", dinle);
    try {
      ses.seslendirSonuc = async () => {
        throw new Error("port bozuk");
      };
      const { s } = kur(ses);
      assert.doesNotThrow(() => s.oku("birinci"));
      await bosalt();
      ses.seslendirSonuc = async () => true;
      assert.doesNotThrow(() => s.oku("ikinci"));
      await bosalt();
      assert.equal(ses.seslendirCagrilari.at(-1), "ikinci");
      assert.deepEqual(redler, []);
    } finally {
      process.off("unhandledRejection", dinle);
    }
  });

  it("seslendir eşzamanlı atarsa oku atmaz ve sonraki oku çalışır", async () => {
    const ses = sahteSes();
    ses.seslendir = ((): Promise<boolean> => {
      throw new Error("eşzamanlı atma");
    }) as SesPortu["seslendir"];
    const { s } = kur(ses);
    assert.doesNotThrow(() => s.oku("birinci"));
    await bosalt();
    const cagrilar: string[] = [];
    ses.seslendir = async (m) => {
      cagrilar.push(m);
      return true;
    };
    s.oku("ikinci");
    await bosalt();
    assert.deepEqual(cagrilar, ["ikinci"]);
  });

  it("seslendir false dönerse oku atmaz ve sonraki oku çalışır", async () => {
    const ses = sahteSes();
    ses.seslendirSonuc = async () => false;
    const { s } = kur(ses);
    assert.doesNotThrow(() => s.oku("birinci"));
    await bosalt();
    s.oku("ikinci");
    await bosalt();
    assert.equal(ses.seslendirCagrilari.at(-1), "ikinci");
    assert.equal(s.konusuyor(), false);
  });

  it("durdur reddederse durdur() atmaz ve işlenmemiş ret oluşmaz", async () => {
    const ses = sahteSes();
    const redler: unknown[] = [];
    const dinle = (e: unknown) => redler.push(e);
    process.on("unhandledRejection", dinle);
    try {
      ses.durdurSonuc = async () => {
        throw new Error("durdurulamadı");
      };
      const { s } = kur(ses);
      assert.doesNotThrow(() => s.durdur());
      await bosalt();
      assert.deepEqual(redler, []);
    } finally {
      process.off("unhandledRejection", dinle);
    }
  });

  it("durumDinle kurulurken port atarsa birim kurulur ve konusuyor false döner", async () => {
    const ses = sahteSes();
    ses.durumDinleHatasi = true;
    let s!: ReturnType<typeof kur>["s"];
    assert.doesNotThrow(() => {
      s = kur(ses).s;
    });
    assert.equal(s.konusuyor(), false);
    s.oku("merhaba");
    await bosalt();
    assert.equal(ses.seslendirCagrilari.at(-1), "merhaba");
  });
});
