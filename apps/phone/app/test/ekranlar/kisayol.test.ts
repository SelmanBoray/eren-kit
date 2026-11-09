import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TELEFON_SOHBET_ADI,
  kisayolBaglami,
  kisayolHedefi,
  kisayolKur,
  kisayolTuketilirMi,
} from "../../src/ekranlar/kisayol.ts";
import type {
  Cekirdek,
  CekirdekDurumu,
  GonderSonucu,
  MesajBaglami,
  SohbetAcSonucu,
  SohbetId,
  SohbetKurulumu,
  SohbetOzeti,
} from "../../src/cekirdek/index.ts";
import type { ErenCihaz, Sonuc } from "../../src/cihaz/erenDevice.ts";
import type { KisayolMesaji } from "../../modules/eren-device/src/ErenDevice.types.ts";
import { bosalt } from "../cekirdek/sahte.ts";

const satir = (sohbet_id: string, ad: string, kurulum: SohbetKurulumu = "kuruldu"): SohbetOzeti => ({
  sohbet_id: sohbet_id as SohbetId,
  ad: ad as SohbetOzeti["ad"],
  ana: sohbet_id === "ana",
  kurulum,
  eren: null,
  yaziyor: false,
  okunmamis: 0,
  calisanIs: 0,
  sonMesaj: null,
  sonEtkinlikMs: kurulum === "kuruldu" ? 1 : null,
});

/** `ana` + n-1 adet "Yeni sohbet". */
const dolu = (n: number): SohbetOzeti[] => [
  satir("ana", "Asistan"),
  ...Array.from({ length: n - 1 }, (_, i) => satir(`s-1-${i + 1}`, "Yeni sohbet")),
];

describe("kisayolHedefi", () => {
  it("adı tam Telefon olan ilk sohbet (ana dahil)", () => {
    assert.deepEqual(kisayolHedefi([satir("ana", "Asistan"), satir("s-1-2", "Telefon"), satir("s-1-3", "Telefon")]), {
      tur: "var",
      sohbet_id: "s-1-2",
    });
    assert.deepEqual(kisayolHedefi([satir("ana", "Telefon")]), { tur: "var", sohbet_id: "ana" });
    assert.deepEqual(kisayolHedefi([satir("ana", "Asistan"), satir("s-1-2", "telefon")]), { tur: "ac" });
  });
  it("bekleyen (kuyruktaki) Telefon da bulunur; kurulamamış sayılmaz", () => {
    assert.deepEqual(kisayolHedefi([satir("s-1-5", "Telefon", "bekliyor"), satir("ana", "Asistan")]), {
      tur: "var",
      sohbet_id: "s-1-5",
    });
    assert.deepEqual(kisayolHedefi([satir("s-1-5", "Telefon", "kurulamadi"), satir("ana", "Asistan")]), { tur: "ac" });
  });
  it("8 sınırı doluysa ana; kurulamamışlar sınıra girmez", () => {
    assert.deepEqual(kisayolHedefi(dolu(7)), { tur: "ac" });
    assert.deepEqual(kisayolHedefi(dolu(8)), { tur: "ana" });
    assert.deepEqual(kisayolHedefi([...dolu(7), satir("s-9-9", "Yeni sohbet", "kurulamadi")]), { tur: "ac" });
    // Sınır doluyken de var olan Telefon kazanır.
    assert.deepEqual(kisayolHedefi([...dolu(7), satir("s-9-9", "Telefon")]), { tur: "var", sohbet_id: "s-9-9" });
  });
});

describe("kisayolBaglami", () => {
  it("paket ve ad ikisi de varsa bağlam", () => {
    assert.deepEqual(kisayolBaglami({ paket: "com.whatsapp", ad: "WhatsApp" }), { paket: "com.whatsapp", ad: "WhatsApp" });
  });
  it("biri yoksa ya da şemadan geçmezse bağlamsız", () => {
    assert.equal(kisayolBaglami({ paket: null, ad: "WhatsApp" }), undefined);
    assert.equal(kisayolBaglami({ paket: "com.whatsapp", ad: null }), undefined);
    assert.equal(kisayolBaglami({ paket: null, ad: null }), undefined);
    assert.equal(kisayolBaglami({ paket: "whatsapp", ad: "WhatsApp" }), undefined);
    assert.equal(kisayolBaglami({ paket: "com.whatsapp", ad: "" }), undefined);
    assert.equal(kisayolBaglami({ paket: "com.whatsapp", ad: "a".repeat(81) }), undefined);
    assert.equal(kisayolBaglami({ paket: "com.whatsapp", ad: "Whats\u0007App" }), undefined);
  });
});

describe("kisayolTuketilirMi", () => {
  it("kuyruğa girdi ya da hiç gidemez: tüket; geçici hata: bırak", () => {
    assert.equal(kisayolTuketilirMi({ ok: true, client_msg_id: "c" }), true);
    assert.equal(kisayolTuketilirMi({ ok: false, neden: "gecersiz" }), true);
    assert.equal(kisayolTuketilirMi({ ok: false, neden: "depo_hatasi" }), false);
    assert.equal(kisayolTuketilirMi({ ok: false, neden: "baslamadi" }), false);
    assert.equal(kisayolTuketilirMi({ ok: false, neden: "sohbet_bulunamadi" }), false);
  });
});

// ---------------------------------------------------------------------------------------------
// Yürütücü: sahte çekirdek ve cihaz

interface Yollanan {
  sohbet_id: string;
  metin: string;
  input: string;
  baglam: MesajBaglami | undefined;
}

class SahteCekirdek {
  d: CekirdekDurumu;
  yollanan: Yollanan[] = [];
  acilan: string[] = [];
  yollaSonucu: GonderSonucu = { ok: true, client_msg_id: "c1" };
  /** Çekirdeğin şemasıyla geçersiz bağlam: bağlamlı mesajı tümden reddeder. */
  baglamReddi = false;
  acSonucu: SohbetAcSonucu | null = null;
  dinleyiciler = new Set<(d: CekirdekDurumu) => void>();

  constructor(sohbetler: SohbetOzeti[], yuklendi = true) {
    this.d = {
      baglanti: "kapali",
      sonrakiDenemeMs: null,
      hata: null,
      esitleniyor: false,
      sunucu: null,
      yuklendi,
      sohbetler,
      secili: "ana" as SohbetId,
      calisanIsler: [],
    };
  }

  degistir(p: Partial<CekirdekDurumu> = {}): void {
    this.d = { ...this.d, ...p };
    for (const f of [...this.dinleyiciler]) f(this.d);
  }

  cekirdek(): Cekirdek {
    return {
      durum: () => this.d,
      abone: (f: (d: CekirdekDurumu) => void) => {
        this.dinleyiciler.add(f);
        f(this.d);
        return () => {
          this.dinleyiciler.delete(f);
        };
      },
      sohbet: (id: string) => ({
        sohbet_id: id,
        mesajYolla: async (metin: string, input: string, baglam?: MesajBaglami) => {
          this.yollanan.push({ sohbet_id: id, metin, input, baglam });
          if (this.baglamReddi && baglam !== undefined) return { ok: false, neden: "gecersiz" };
          return this.yollaSonucu;
        },
      }),
      sohbetAc: async (ad?: string): Promise<SohbetAcSonucu> => {
        this.acilan.push(ad ?? "");
        if (this.acSonucu !== null) return this.acSonucu;
        const sohbet_id = `s-1-${this.d.sohbetler.length + 10}` as SohbetId;
        // Gerçek çekirdek gibi: bekleyen sohbet listeye girer ve seçilir.
        this.degistir({ sohbetler: [satir(sohbet_id, ad ?? "Yeni sohbet", "bekliyor"), ...this.d.sohbetler], secili: sohbet_id });
        return { ok: true, sohbet_id };
      },
      sec: (id: SohbetId) => {
        if (!this.d.sohbetler.some((s) => s.sohbet_id === id)) return false;
        this.degistir({ secili: id });
        return true;
      },
    } as unknown as Cekirdek;
  }
}

class SahteCihaz {
  desteklenir = true;
  yuva: KisayolMesaji | null = null;
  tuketilen: string[] = [];
  tuketSonucu: Sonuc<true> = { ok: true, deger: true };
  alinan = 0;
  olay: ((v: { id: string }) => void) | null = null;

  koy(m: Partial<KisayolMesaji> = {}): void {
    this.yuva = { id: "k1", metin: "bunu kaydet", paket: "com.whatsapp", ad: "WhatsApp", zaman_ms: 1, ...m };
    this.olay?.({ id: this.yuva.id });
  }

  cihaz(): ErenCihaz {
    return {
      desteklenir: this.desteklenir,
      kisayolAl: async (): Promise<Sonuc<KisayolMesaji | null>> => {
        this.alinan++;
        return { ok: true, deger: this.yuva };
      },
      kisayolTuket: async (id: string): Promise<Sonuc<true>> => {
        this.tuketilen.push(id);
        if (this.tuketSonucu.ok && this.yuva?.id === id) this.yuva = null;
        return this.tuketSonucu;
      },
      kisayolGeldiDinle: (f: (v: { id: string }) => void) => {
        this.olay = f;
        return () => {
          this.olay = null;
        };
      },
    } as unknown as ErenCihaz;
  }
}

describe("kisayolKur", () => {
  it("var olan Telefon sohbetine bağlamla yollar, sonra tüketir", async () => {
    const c = new SahteCekirdek([satir("ana", "Asistan"), satir("s-1-2", TELEFON_SOHBET_ADI)]);
    const h = new SahteCihaz();
    const kapat = kisayolKur(c.cekirdek(), h.cihaz()).baslat();
    await bosalt();
    h.koy();
    await bosalt();
    assert.deepEqual(c.yollanan, [
      { sohbet_id: "s-1-2", metin: "bunu kaydet", input: "kisayol", baglam: { paket: "com.whatsapp", ad: "WhatsApp" } },
    ]);
    assert.deepEqual(h.tuketilen, ["k1"]);
    assert.deepEqual(c.acilan, []);
    kapat();
  });

  it("Telefon yoksa açar, kuyruğa güvenip hemen yollar, seçimi geri verir; bağlamsız mesaj bağlamsız gider", async () => {
    const c = new SahteCekirdek([satir("ana", "Asistan"), satir("s-1-2", "İş")]);
    c.d = { ...c.d, secili: "s-1-2" as SohbetId };
    const h = new SahteCihaz();
    const kapat = kisayolKur(c.cekirdek(), h.cihaz()).baslat();
    await bosalt();
    h.koy({ paket: null, ad: null });
    await bosalt();
    assert.deepEqual(c.acilan, [TELEFON_SOHBET_ADI]);
    assert.equal(c.yollanan.length, 1);
    assert.equal(c.yollanan[0]?.sohbet_id, "s-1-12");
    assert.equal(c.yollanan[0]?.baglam, undefined);
    assert.equal(c.d.secili, "s-1-2");
    // İkinci mesaj aynı (artık listede olan) sohbete; yeniden açılmaz.
    h.koy({ id: "k2" });
    await bosalt();
    assert.deepEqual(c.acilan, [TELEFON_SOHBET_ADI]);
    assert.deepEqual(c.yollanan.map((y) => y.sohbet_id), ["s-1-12", "s-1-12"]);
    assert.deepEqual(h.tuketilen, ["k1", "k2"]);
    kapat();
  });

  it("8 sınırı doluysa ana; sohbetAc sohbet_siniri derse de ana", async () => {
    const c = new SahteCekirdek(dolu(8));
    const h = new SahteCihaz();
    const kapat = kisayolKur(c.cekirdek(), h.cihaz()).baslat();
    await bosalt();
    h.koy();
    await bosalt();
    assert.deepEqual(c.acilan, []);
    assert.deepEqual(c.yollanan.map((y) => y.sohbet_id), ["ana"]);
    kapat();

    const c2 = new SahteCekirdek(dolu(3));
    c2.acSonucu = { ok: false, neden: "sohbet_siniri" };
    const h2 = new SahteCihaz();
    const kapat2 = kisayolKur(c2.cekirdek(), h2.cihaz()).baslat();
    await bosalt();
    h2.koy();
    await bosalt();
    assert.deepEqual(c2.acilan, [TELEFON_SOHBET_ADI]);
    assert.deepEqual(c2.yollanan.map((y) => y.sohbet_id), ["ana"]);
    assert.deepEqual(h2.tuketilen, ["k1"]);
    kapat2();
  });

  it("açılışta: çekirdek yüklenince yuvadaki mesaj çekilir; öncesinde olay beklenir", async () => {
    const c = new SahteCekirdek([satir("ana", "Asistan"), satir("s-1-2", TELEFON_SOHBET_ADI)], false);
    const h = new SahteCihaz();
    h.yuva = { id: "k0", metin: "dün söylediğim", paket: null, ad: null, zaman_ms: 1 };
    const kapat = kisayolKur(c.cekirdek(), h.cihaz()).baslat();
    await bosalt();
    h.olay?.({ id: "k0" });
    await bosalt();
    assert.equal(h.alinan, 0);
    c.degistir({ yuklendi: true });
    await bosalt();
    assert.deepEqual(c.yollanan.map((y) => [y.sohbet_id, y.metin]), [["s-1-2", "dün söylediğim"]]);
    assert.deepEqual(h.tuketilen, ["k0"]);
    // Sonraki çekirdek değişiklikleri yeniden çekmez.
    c.degistir();
    await bosalt();
    assert.equal(h.alinan, 1);
    kapat();
  });

  it("aynı id iki kez yollanmaz: tüketme düştüyse sonraki çekişte yalnız tüketilir", async () => {
    const c = new SahteCekirdek([satir("ana", "Telefon")]);
    const h = new SahteCihaz();
    h.tuketSonucu = { ok: false, neden: "hata" };
    const kapat = kisayolKur(c.cekirdek(), h.cihaz()).baslat();
    await bosalt();
    h.koy();
    await bosalt();
    h.tuketSonucu = { ok: true, deger: true };
    h.olay?.({ id: "k1" });
    await bosalt();
    assert.equal(c.yollanan.length, 1);
    assert.deepEqual(h.tuketilen, ["k1", "k1"]);
    assert.equal(h.yuva, null);
    kapat();
  });

  it("geçici hatada yuvada kalır ve sonraki olayda yeniden denenir; gecersiz tüketilir", async () => {
    const c = new SahteCekirdek([satir("ana", "Telefon")]);
    c.yollaSonucu = { ok: false, neden: "depo_hatasi" };
    const h = new SahteCihaz();
    const kapat = kisayolKur(c.cekirdek(), h.cihaz()).baslat();
    await bosalt();
    h.koy();
    await bosalt();
    assert.deepEqual(h.tuketilen, []);
    c.yollaSonucu = { ok: true, client_msg_id: "c2" };
    h.olay?.({ id: "k1" });
    await bosalt();
    assert.equal(c.yollanan.length, 2);
    assert.deepEqual(h.tuketilen, ["k1"]);

    // Bağlamsız da geçersiz: bir kez bağlamlı, bir kez bağlamsız denenir, sonra tüketilir.
    c.yollaSonucu = { ok: false, neden: "gecersiz" };
    h.koy({ id: "k2" });
    await bosalt();
    assert.deepEqual(c.yollanan.slice(2).map((y) => y.baglam !== undefined), [true, false]);
    assert.deepEqual(h.tuketilen, ["k1", "k2"]);
    kapat();
  });

  it("çekirdek bağlamı geçersiz sayarsa mesaj bir kez bağlamsız yollanır ve tüketilir", async () => {
    const c = new SahteCekirdek([satir("ana", "Telefon")]);
    c.baglamReddi = true;
    const h = new SahteCihaz();
    const kapat = kisayolKur(c.cekirdek(), h.cihaz()).baslat();
    await bosalt();
    h.koy();
    await bosalt();
    assert.deepEqual(
      c.yollanan.map((y) => [y.sohbet_id, y.metin, y.baglam]),
      [
        ["ana", "bunu kaydet", { paket: "com.whatsapp", ad: "WhatsApp" }],
        ["ana", "bunu kaydet", undefined],
      ],
    );
    assert.deepEqual(h.tuketilen, ["k1"]);
    kapat();
  });

  it("hedef arada kurulamadıysa bir kez yeniden bulunur", async () => {
    const c = new SahteCekirdek([satir("ana", "Asistan"), satir("s-1-2", "Telefon")]);
    const h = new SahteCihaz();
    const cekirdek = c.cekirdek();
    const asil = cekirdek.sohbet;
    let ilk = true;
    cekirdek.sohbet = (id) => {
      const s = asil(id);
      if (!ilk) return s;
      ilk = false;
      return {
        ...s,
        mesajYolla: async () => {
          // Telefon sohbeti kurulamadı: listede öyle görünür.
          c.d = { ...c.d, sohbetler: [satir("ana", "Asistan"), satir("s-1-2", "Telefon", "kurulamadi")] };
          return { ok: false, neden: "sohbet_bulunamadi" } as const;
        },
      };
    };
    const kapat = kisayolKur(cekirdek, h.cihaz()).baslat();
    await bosalt();
    h.koy();
    await bosalt();
    assert.deepEqual(c.acilan, [TELEFON_SOHBET_ADI]);
    assert.equal(c.yollanan.length, 1);
    assert.deepEqual(h.tuketilen, ["k1"]);
    kapat();
  });

  const bekle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it("geçici hatada olay gelmese de zamanlayıcıyla yeniden dener; bir kez gönderilir, tüketilince durur", async () => {
    const c = new SahteCekirdek([satir("ana", "Telefon")]);
    c.yollaSonucu = { ok: false, neden: "depo_hatasi" };
    const h = new SahteCihaz();
    const kapat = kisayolKur(c.cekirdek(), h.cihaz(), { ilkAralikMs: 10, enCokAralikMs: 20 }).baslat();
    await bosalt();
    h.koy();
    await bosalt();
    assert.deepEqual(h.tuketilen, []);
    await bekle(60);
    assert.ok(c.yollanan.length >= 2, "yeniden denenmeli");
    c.yollaSonucu = { ok: true, client_msg_id: "c2" };
    await bekle(60);
    assert.deepEqual(h.tuketilen, ["k1"]);
    const n = c.yollanan.length;
    const a = h.alinan;
    await bekle(60);
    assert.equal(c.yollanan.length, n);
    assert.equal(h.alinan, a, "tüketildikten sonra çekmez");
    kapat();
  });

  it("sohbet açılamazsa (geçici) da yeniden dener", async () => {
    const c = new SahteCekirdek([satir("ana", "Asistan")]);
    c.acSonucu = { ok: false, neden: "baslamadi" } as unknown as SohbetAcSonucu;
    const h = new SahteCihaz();
    const kapat = kisayolKur(c.cekirdek(), h.cihaz(), { ilkAralikMs: 10, enCokAralikMs: 10 }).baslat();
    await bosalt();
    h.koy();
    await bekle(30);
    assert.equal(c.yollanan.length, 0);
    c.acSonucu = null;
    await bekle(60);
    assert.equal(c.yollanan.length, 1);
    assert.deepEqual(h.tuketilen, ["k1"]);
    kapat();
  });

  it("bağlantı bağlanınca uzun aralığı beklemeden yeniden dener", async () => {
    const c = new SahteCekirdek([satir("ana", "Telefon")]);
    c.yollaSonucu = { ok: false, neden: "baslamadi" };
    const h = new SahteCihaz();
    const kapat = kisayolKur(c.cekirdek(), h.cihaz(), { ilkAralikMs: 100_000, enCokAralikMs: 100_000 }).baslat();
    await bosalt();
    h.koy();
    await bosalt();
    assert.equal(c.yollanan.length, 1);
    c.yollaSonucu = { ok: true, client_msg_id: "c2" };
    c.degistir({ baglanti: "bagli" });
    await bosalt();
    assert.equal(c.yollanan.length, 2);
    assert.deepEqual(h.tuketilen, ["k1"]);
    kapat();
  });

  it("kapanınca zamanlayıcı temizlenir: sonra yeniden denemez", async () => {
    const c = new SahteCekirdek([satir("ana", "Telefon")]);
    c.yollaSonucu = { ok: false, neden: "depo_hatasi" };
    const h = new SahteCihaz();
    const kapat = kisayolKur(c.cekirdek(), h.cihaz(), { ilkAralikMs: 10, enCokAralikMs: 10 }).baslat();
    await bosalt();
    h.koy();
    await bosalt();
    kapat();
    const n = c.yollanan.length;
    await bekle(50);
    assert.equal(c.yollanan.length, n);
  });

  it("modül yoksa abone olmaz, hiçbir şey çekmez", async () => {
    const c = new SahteCekirdek([satir("ana", "Asistan")]);
    const h = new SahteCihaz();
    h.desteklenir = false;
    const kapat = kisayolKur(c.cekirdek(), h.cihaz()).baslat();
    await bosalt();
    assert.equal(h.olay, null);
    assert.equal(h.alinan, 0);
    assert.equal(c.dinleyiciler.size, 0);
    kapat();
  });
});
