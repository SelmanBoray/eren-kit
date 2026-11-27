import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign as imzaAt, timingSafeEqual, verify as imzaDogrula } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { SOHBET_SURUMU, kimlikImzaMetni, sohbetAsagiCoz } from "@eren/protocol";
import type { EkBilgisi } from "@eren/protocol";
import { depoKur } from "../src/depo.ts";
import type { CihazYonetimi } from "../src/depo.ts";
import { gatewayKur } from "../src/gateway.ts";
import { medyaIsterMi, welcomeYetenekleri } from "../src/gateway-medya.ts";
import type { AnahtarPortu, GatewayBagimliliklari, MediaStateGovdesi } from "../src/sozlesme.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import { sahteGunluk, sahteMedyaYoneticisi, sahteRastgele, sahteWs, sahteZaman } from "./sahte.ts";
import type { SahteMedyaYoneticisi, SahteWsBaglantisi } from "./sahte.ts";

// Medya dalgası S5 (MODULLER.md "Medya dalgası" > "S5 gateway"; tasarım 3.4, 6, 7). gateway-tuketim kalıbı.

type Msg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const BASLANGIC = 1_700_000_000_000;
const SUNUCU_IP = "100.64.0.10";
const NONCE = Buffer.alloc(32, 7).toString("base64");
const MEDYA1 = "medya1";

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
};

const imzala = (k: KeyObject, metin: string): string => imzaAt("sha256", Buffer.from(metin, "utf8"), k).toString("base64");

interface Telefon {
  device_id: string;
  ip: string;
  ozel: KeyObject;
  acik: string;
}
const telefonUret = (device_id: string, ip: string): Telefon => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { device_id, ip, ozel: privateKey, acik: publicKey.export({ type: "spki", format: "der" }).toString("base64") };
};
const TEL1 = telefonUret("tel-1", "100.64.0.20");
const TEL2 = telefonUret("tel-2", "100.64.0.21");

function gercekAnahtar(): AnahtarPortu {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const acik = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return {
    acikAnahtar: () => acik,
    imzala: (metin) => imzala(privateKey, metin),
    dogrula: (a, metin, imza) => {
      try {
        const k = createPublicKey({ key: Buffer.from(a, "base64"), format: "der", type: "spki" });
        return imzaDogrula("sha256", Buffer.from(metin, "utf8"), k, Buffer.from(imza, "base64"));
      } catch {
        return false;
      }
    },
    sabitZamanEsit: (a, b) => {
      const x = Buffer.from(a, "utf8");
      const y = Buffer.from(b, "utf8");
      return x.length === y.length && timingSafeEqual(x, y);
    },
  };
}

class Ist {
  readonly c: SahteWsBaglantisi;
  constructor(c: SahteWsBaglantisi) {
    this.c = c;
  }
  get kare(): Msg[] {
    return this.c.gonderilenler.map((m) => {
      const coz = sohbetAsagiCoz(m);
      assert.ok(coz.ok, `giden çerçeve şemaya uymuyor: ${m.slice(0, 200)}`);
      return coz.mesaj as Msg;
    });
  }
  /** Şemadan geçirmeden ham JSON (alan yokluğunu bayt düzeyinde sınamak için). */
  get ham(): Msg[] {
    return this.c.gonderilenler.map((m) => JSON.parse(m) as Msg);
  }
  tur(t: string): Msg[] {
    return this.kare.filter((k) => k.type === t);
  }
  get kapali(): boolean {
    return this.c.kapanis !== null;
  }
  async gonder(m: object): Promise<void> {
    this.c.mesajGonder(JSON.stringify(m));
    await bosalt();
  }
}

const acilacaklar: Array<() => void> = [];
afterEach(() => {
  for (const f of acilacaklar.splice(0)) f();
});

const FOTO: EkBilgisi = { medya_id: "m-1", tur: "foto", mime: "image/jpeg", boyut: 1000 };
const VIDEO: EkBilgisi = { medya_id: "m-2", tur: "video", mime: "video/mp4", boyut: 5000, sure_ms: 3000 };

const baslangic = (ek: EkBilgisi = FOTO, sohbet_id = "ana"): Msg => ({ v: SOHBET_SURUMU, type: "media_begin", sohbet_id, ...ek });
const parca = (medya_id = FOTO.medya_id, ofset = 0, veri = "AAAA"): Msg => ({ v: SOHBET_SURUMU, type: "media_chunk", medya_id, ofset, veri });
const iptal = (medya_id = FOTO.medya_id): Msg => ({ v: SOHBET_SURUMU, type: "media_cancel", medya_id });
const mesaj = (client_msg_id: string, text: string, ekler?: EkBilgisi[]): Msg => ({
  v: SOHBET_SURUMU,
  type: "user_message",
  client_msg_id,
  sohbet_id: "ana",
  input: "yazi",
  text,
  ...(ekler !== undefined && { ekler }),
});

interface Kurulum {
  medyaVar?: boolean;
}

async function hazir({ medyaVar = true }: Kurulum = {}) {
  const zaman = sahteZaman(BASLANGIC);
  const gunluk = sahteGunluk();
  const veriyolu = veriyoluKur({ gunluk });
  const depo = depoKur({ yol: ":memory:", saat: zaman.saat, veriyolu, gunluk });
  acilacaklar.push(() => depo.kapat());
  for (const t of [TEL1, TEL2]) {
    depo.cihazEkle({
      device_id: t.device_id,
      public_key: t.acik,
      tailscale_ip: t.ip,
      platform: "android",
      etiket: null,
      eslesme_ms: BASLANGIC,
    });
  }
  const medya: SahteMedyaYoneticisi = sahteMedyaYoneticisi();
  const insanlar: Msg[] = [];
  const ws = sahteWs();
  const b = {
    ayar: {
      wsPort: 47821,
      sureler: {
        kilitYoklamaMs: 5000,
        torunYoklamaMs: 10000,
        isYoklamaMs: 2000,
        ramYoklamaMs: 30000,
        soruZamanAsimiMs: 82_800_000,
        devirOzetiBeklemeMs: 120_000,
        deltaTamponMs: 80,
        bildirimAckMs: 30000,
        komutPayiMs: 15000,
        erenYenidenBaslatmaMs: 30000,
      },
      servis: { surum: "abc123def456", baslangic_ms: BASLANGIC - 5000 },
    },
    depo,
    sohbetler: {
      konusma: (x: { sohbet_id: string }) =>
        x.sohbet_id !== "ana"
          ? null
          : {
              // `konusma`'nın en dar sahtesi: `user_echo`'yu (ekler dahil) yazar.
              insanMesajiAl: (m: Msg) => {
                insanlar.push(m);
                const o = depo.olayEkle({
                  type: "user_echo",
                  sohbet_id: m.sohbet_id,
                  client_msg_id: m.client_msg_id,
                  input: m.input,
                  text: m.text,
                  ...(m.ekler !== undefined && { ekler: m.ekler }),
                } as never);
                return { seq: o.seq };
              },
              kes: () => ({ ok: true, deger: undefined }),
            },
      durumlar: () => [{ sohbet_id: "ana", eren: "hazir" }],
      aktifTurlar: () => [],
    },
    planlar: { karar: async () => ({ ok: true, deger: undefined }) },
    isler: { soruCevapla: () => ({ ok: true, deger: undefined }), aktifSayisi: () => 0, ram: () => ({ bosMb: 8000, toplamMb: 16000, dusuk: false }) },
    temizlik: {},
    ...(medyaVar && { medya }),
    cihaz: { baglandi: () => undefined },
    kilit: { durum: () => ({ tur: "serbest" }) },
    sistem: { tailscaleAdresi: () => SUNUCU_IP },
    ws,
    anahtar: gercekAnahtar(),
    rastgele: sahteRastgele(),
    saat: zaman.saat,
    zamanlayici: zaman.zamanlayici,
    veriyolu,
    gunluk,
  } as unknown as GatewayBagimliliklari;
  const gw = gatewayKur(b);
  const p = gw.baslat();
  await bosalt();
  await p;
  await bosalt();
  acilacaklar.push(() => void gw.kapat());

  const giris = async (yetenekler: string[] = [MEDYA1], tel: Telefon = TEL1, last_seq = 0): Promise<Ist> => {
    const ist = new Ist(ws.baglan("/sohbet", tel.ip, yetenekler));
    await ist.gonder({ v: SOHBET_SURUMU, type: "hello", device_id: tel.device_id, last_seq, client_nonce: NONCE });
    const ch = ist.tur("auth_challenge")[0];
    assert.ok(ch, "auth_challenge gelmedi");
    const metin = kimlikImzaMetni({
      rol: "telefon",
      kanal: "sohbet",
      device_id: tel.device_id,
      client_nonce: NONCE,
      server_nonce: ch.server_nonce,
    });
    await ist.gonder({ v: SOHBET_SURUMU, type: "auth_response", signature: imzala(tel.ozel, metin) });
    assert.equal(ist.tur("error").length, 0, "giriş hata verdi");
    assert.equal(ist.tur("welcome").length, 1, "welcome gelmedi");
    return ist;
  };
  const kaldir = (device_id: string): string => (depo as unknown as CihazYonetimi).cihazKaldir(device_id).sonuc;
  return { giris, medya, insanlar, depo, veriyolu, zaman, gunluk, kaldir };
}

const yetkisizKapandi = (ist: Ist): void => {
  assert.deepEqual(
    ist.tur("error").map((e) => e.code),
    ["yetkisiz"],
  );
  assert.equal(ist.c.kapanis?.kod, 1008);
};

// ---------------------------------------------------------------------------------------------

describe("gateway-medya: saf yardımcılar", () => {
  it("medyaIsterMi: yalnız jeton VE bağımlılık", () => {
    assert.equal(medyaIsterMi(new Set([MEDYA1]), true), true);
    assert.equal(medyaIsterMi(new Set([MEDYA1]), false), false);
    assert.equal(medyaIsterMi(new Set(["etkinlik1"]), true), false);
    assert.equal(medyaIsterMi(new Set(), true), false);
  });

  it("welcomeYetenekleri: isteyene medya varsa [medya1], yoksa []; istemeyene alan yok", () => {
    assert.deepEqual(welcomeYetenekleri(new Set([MEDYA1, "etkinlik1"]), true), { yetenekler: [MEDYA1] });
    assert.deepEqual(welcomeYetenekleri(new Set([MEDYA1]), false), { yetenekler: [] });
    assert.deepEqual(welcomeYetenekleri(new Set(["etkinlik1"]), true), {});
    assert.deepEqual(welcomeYetenekleri(new Set(), true), {});
  });
});

describe("gateway-medya: welcome.yetenekler", () => {
  it("medya1 isteyen bağlantı [medya1] alır; etkinlik1 yazılmaz", async () => {
    const o = await hazir();
    const ist = await o.giris([MEDYA1, "etkinlik1"]);
    assert.deepEqual(ist.tur("welcome")[0]!.yetenekler, [MEDYA1]);
  });

  it("jetonsuz ve yalnız etkinlik1 isteyen bağlantının welcome'ında alan hiç yok", async () => {
    const o = await hazir();
    for (const y of [[], ["etkinlik1"]]) {
      const ist = await o.giris(y);
      const w = ist.ham.find((k) => k.type === "welcome")!;
      assert.ok(!("yetenekler" in w), `beklenmeyen alan: ${JSON.stringify(w)}`);
      assert.deepEqual(Object.keys(w).sort(), ["head_seq", "server_time_ms", "type", "v"]);
    }
  });

  it("medya bağımlılığı yokken medya1 isteyen bağlantı yetenekler: [] alır; istemeyen alansız", async () => {
    const o = await hazir({ medyaVar: false });
    const ist = await o.giris([MEDYA1]);
    assert.deepEqual(ist.tur("welcome")[0]!.yetenekler, []);
    const eski = await o.giris([]);
    assert.ok(!("yetenekler" in eski.ham.find((k) => k.type === "welcome")!));
  });
});

describe("gateway-medya: jetonsuz bağlantı", () => {
  for (const [ad, m] of [
    ["media_begin", baslangic()],
    ["media_chunk", parca()],
    ["media_cancel", iptal()],
  ] as const) {
    it(`${ad} → error{yetkisiz} + kapanış; yönetici çağrılmaz`, async () => {
      const o = await hazir();
      const ist = await o.giris([]);
      await ist.gonder(m);
      yetkisizKapandi(ist);
      assert.equal(o.medya.cagrilar.say(), 0);
    });

    it(`medya bağımlılığı yokken medya1 isteyen bağlantıda da ${ad} → yetkisiz`, async () => {
      const o = await hazir({ medyaVar: false });
      const ist = await o.giris([MEDYA1]);
      await ist.gonder(m);
      yetkisizKapandi(ist);
      assert.equal(o.medya.cagrilar.say(), 0);
    });
  }

  it("ekler'li user_message → ack{gecersiz_mesaj}; ön denetim ve insanMesajiAl çağrılmaz, bağlantı açık", async () => {
    const o = await hazir();
    o.medya.ekKoy("tel-1", "ana", FOTO);
    const ist = await o.giris([]);
    await ist.gonder(mesaj("u-1", "bak", [FOTO]));
    assert.deepEqual(ist.tur("ack"), [{ v: SOHBET_SURUMU, type: "ack", client_msg_id: "u-1", ok: false, code: "gecersiz_mesaj" }]);
    assert.equal(o.medya.cagrilar.say("ekleriDenetle"), 0);
    assert.equal(o.insanlar.length, 0);
    assert.ok(!ist.kapali);
    // Eksiz mesaj bugünkü gibi geçer.
    await ist.gonder(mesaj("u-2", "selam"));
    assert.equal(ist.tur("ack").find((a) => a.client_msg_id === "u-2")!.ok, true);
    assert.ok(!("ekler" in o.insanlar[0]!), "eksiz mesajda ekler alanı konmamalı");
  });

  it("medya bağımlılığı yokken medya1 isteyen bağlantının ekler'li mesajı da gecersiz_mesaj", async () => {
    const o = await hazir({ medyaVar: false });
    const ist = await o.giris([MEDYA1]);
    await ist.gonder(mesaj("u-1", "bak", [FOTO]));
    assert.equal(ist.tur("ack")[0]!.code, "gecersiz_mesaj");
    assert.equal(o.insanlar.length, 0);
  });
});

describe("gateway-medya: yükleme yönlendirmesi", () => {
  it("media_begin → yuklemeBaslat(device_id, zarfsız gövde); media_state yalnız isteyen bağlantıya", async () => {
    const o = await hazir();
    const a = await o.giris();
    const b = await o.giris(); // aynı cihazın ikinci medya1 bağlantısı
    await a.gonder(baslangic(VIDEO));
    const c = o.medya.cagrilar.hepsi("yuklemeBaslat");
    assert.equal(c.length, 1);
    assert.equal(c[0]!.args[0], "tel-1");
    assert.deepEqual(c[0]!.args[1], { sohbet_id: "ana", ...VIDEO });
    assert.deepEqual(a.tur("media_state"), [{ v: SOHBET_SURUMU, type: "media_state", medya_id: "m-2", durum: "yukleniyor", alinan: 0 }]);
    assert.equal(b.tur("media_state").length, 0, "dönüş yalnız isteyen bağlantıya gider");
  });

  it("media_chunk → parca; dönüş media_state alinan ile; sıra geliş sırası", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(baslangic());
    ist.c.mesajGonder(JSON.stringify(parca("m-1", 0, "AAAA")));
    ist.c.mesajGonder(JSON.stringify(parca("m-1", 3, "AAAA")));
    await bosalt();
    assert.deepEqual(
      o.medya.cagrilar.hepsi("parca").map((x) => x.args),
      [
        ["tel-1", "m-1", 0],
        ["tel-1", "m-1", 3],
      ],
    );
    assert.deepEqual(
      ist.tur("media_state").map((s) => s.alinan),
      [0, 3, 6],
    );
  });

  it("yöneticinin gövdesi alan alan kopyalanır: kabul/isleme, reddedildi/code; fazla alan gitmez", async () => {
    const o = await hazir();
    const ist = await o.giris();
    o.medya.sonrakiDurum({ medya_id: "m-1", durum: "kabul", isleme: "isleniyor", fazla: "x" } as unknown as MediaStateGovdesi);
    o.medya.sonrakiDurum({ medya_id: "m-1", durum: "reddedildi", code: "medya_siniri" });
    await ist.gonder(parca());
    await ist.gonder(parca());
    assert.deepEqual(
      ist.ham.filter((k) => k.type === "media_state"),
      [
        { v: SOHBET_SURUMU, type: "media_state", medya_id: "m-1", durum: "kabul", isleme: "isleniyor" },
        { v: SOHBET_SURUMU, type: "media_state", medya_id: "m-1", durum: "reddedildi", code: "medya_siniri" },
      ],
    );
  });

  it("media_cancel → iptal, yanıt yok", async () => {
    const o = await hazir();
    const ist = await o.giris();
    const once = ist.c.gonderilenler.length;
    await ist.gonder(iptal("m-9"));
    assert.deepEqual(o.medya.cagrilar.hepsi("iptal").map((x) => x.args), [["tel-1", "m-9"]]);
    assert.equal(ist.c.gonderilenler.length, once);
    assert.ok(!ist.kapali);
  });

  it("yönetici reddederse o ek reddedildi{ic_hata} alır, bağlantı açık kalır; iptal atarsa sessiz", async () => {
    const o = await hazir();
    const ist = await o.giris();
    o.medya.yuklemeBaslat = async () => {
      throw new Error("beklenmedik");
    };
    o.medya.iptal = () => {
      throw new Error("beklenmedik");
    };
    await ist.gonder(baslangic());
    await ist.gonder(iptal());
    assert.deepEqual(ist.tur("media_state"), [{ v: SOHBET_SURUMU, type: "media_state", medya_id: "m-1", durum: "reddedildi", code: "ic_hata" }]);
    assert.ok(!ist.kapali);
    assert.equal(o.gunluk.girdiler.filter((g) => g.olay === "medya_hatasi").length, 2);
  });
});

describe("gateway-medya: medya_durumu yalnız ilgili cihaza", () => {
  it("device_id'nin bütün medya1 bağlantılarına gider; jetonsuz bağlantıya ve başka cihaza gitmez", async () => {
    const o = await hazir();
    const a1 = await o.giris([MEDYA1]);
    const a2 = await o.giris([MEDYA1]);
    const eski = await o.giris([]);
    const baska = await o.giris([MEDYA1], TEL2);
    o.veriyolu.yayinla("medya_durumu", {
      device_id: "tel-1",
      sohbet_id: "ana",
      durum: { medya_id: "m-1", durum: "kabul", isleme: "hazir" },
    });
    const beklenen = [{ v: SOHBET_SURUMU, type: "media_state", medya_id: "m-1", durum: "kabul", isleme: "hazir" }];
    assert.deepEqual(a1.tur("media_state"), beklenen);
    assert.deepEqual(a2.tur("media_state"), beklenen);
    assert.equal(eski.tur("media_state").length, 0);
    assert.equal(baska.tur("media_state").length, 0);
  });

  it("medya bağımlılığı yokken medya_durumu dinlenmez", async () => {
    const o = await hazir({ medyaVar: false });
    const a = await o.giris([MEDYA1]);
    o.veriyolu.yayinla("medya_durumu", { device_id: "tel-1", sohbet_id: "ana", durum: { medya_id: "m-1", durum: "kabul" } });
    assert.equal(a.tur("media_state").length, 0);
  });
});

describe("gateway-medya: eşleşmesi kaldırılan cihaz", () => {
  it("kaldırmadan sonraki parça işlenmez: cihaz_bilinmiyor ile kapanış", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(baslangic());
    assert.equal(o.kaldir("tel-1"), "kaldirildi");
    await ist.gonder(parca());
    assert.equal(o.medya.cagrilar.say("parca"), 0);
    assert.deepEqual(
      ist.tur("error").map((e) => e.code),
      ["cihaz_bilinmiyor"],
    );
    assert.ok(ist.kapali);
  });

  it("yükleme sürerken eşleşme kalkarsa (yoklama kapatır) gecikmiş dönüş ve olay gitmez", async () => {
    const o = await hazir();
    const ist = await o.giris();
    let bitir: (d: MediaStateGovdesi) => void = () => undefined;
    o.medya.parca = () => new Promise<MediaStateGovdesi>((r) => (bitir = r));
    await ist.gonder(parca());
    assert.equal(o.kaldir("tel-1"), "kaldirildi");
    o.zaman.ilerlet(2_000);
    await bosalt();
    assert.ok(ist.kapali, "yoklama bağlantıyı kapatmalıydı");
    const once = ist.c.gonderilenler.length;
    bitir({ medya_id: "m-1", durum: "kabul" });
    o.veriyolu.yayinla("medya_durumu", { device_id: "tel-1", sohbet_id: "ana", durum: { medya_id: "m-1", durum: "kabul" } });
    await bosalt();
    assert.equal(ist.c.gonderilenler.length, once);
  });

  it("kapanan bağlantıya gecikmiş dönüş gitmez", async () => {
    const o = await hazir();
    const ist = await o.giris();
    let bitir: (d: MediaStateGovdesi) => void = () => undefined;
    o.medya.yuklemeBaslat = () => new Promise<MediaStateGovdesi>((r) => (bitir = r));
    await ist.gonder(baslangic());
    ist.c.istemciKopar();
    const once = ist.c.gonderilenler.length;
    bitir({ medya_id: "m-1", durum: "yukleniyor", alinan: 0 });
    await bosalt();
    assert.equal(ist.c.gonderilenler.length, once);
  });
});

describe("gateway-medya: ekli user_message ön denetimi", () => {
  it("ön denetim tutmazsa ack{medya_yok}; insanMesajiAl çağrılmaz; ack saklanır (yineleme aynı ack, ikinci denetim yok)", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(mesaj("u-1", "bak", [FOTO]));
    const ilk = ist.tur("ack");
    assert.deepEqual(ilk, [{ v: SOHBET_SURUMU, type: "ack", client_msg_id: "u-1", ok: false, code: "medya_yok" }]);
    assert.equal(o.insanlar.length, 0);
    assert.deepEqual(o.medya.cagrilar.hepsi("ekleriDenetle").map((x) => x.args), [["tel-1", "ana", ["m-1"]]]);
    await ist.gonder(mesaj("u-1", "bak", [FOTO]));
    assert.deepEqual(ist.tur("ack")[1], ilk[0]);
    assert.equal(o.medya.cagrilar.say("ekleriDenetle"), 1);
  });

  it("reddedilmiş ek medya_reddedildi döner", async () => {
    const o = await hazir();
    o.medya.ekKoy("tel-1", "ana", FOTO, "reddedildi");
    const ist = await o.giris();
    await ist.gonder(mesaj("u-1", "", [FOTO]));
    assert.equal(ist.tur("ack")[0]!.code, "medya_reddedildi");
    assert.equal(o.insanlar.length, 0);
  });

  it("bilinmeyen sohbette sohbet_bulunamadi önce gelir", async () => {
    const o = await hazir();
    o.medya.ekKoy("tel-1", "ana", FOTO);
    const ist = await o.giris();
    await ist.gonder({ ...mesaj("u-1", "bak", [FOTO]), sohbet_id: "yok-1" });
    assert.equal(ist.tur("ack")[0]!.code, "sohbet_bulunamadi");
  });

  it("tutarsa insanMesajiAl ekler ile çağrılır; ack ok + seq", async () => {
    const o = await hazir();
    o.medya.ekKoy("tel-1", "ana", FOTO);
    o.medya.ekKoy("tel-1", "ana", VIDEO);
    const ist = await o.giris();
    await ist.gonder(mesaj("u-1", "bak", [FOTO, VIDEO]));
    const ack = ist.tur("ack")[0]!;
    assert.equal(ack.ok, true);
    assert.equal(typeof ack.seq, "number");
    assert.equal(o.insanlar.length, 1);
    assert.deepEqual(o.insanlar[0]!.ekler, [FOTO, VIDEO]);
    assert.equal(o.insanlar[0]!.device_id, "tel-1");
  });

  it("başka cihazın eki adlandırılamaz: tel-2'nin kaydı tel-1'e medya_yok", async () => {
    const o = await hazir();
    o.medya.ekKoy("tel-2", "ana", FOTO);
    const ist = await o.giris();
    await ist.gonder(mesaj("u-1", "bak", [FOTO]));
    assert.equal(ist.tur("ack")[0]!.code, "medya_yok");
  });
});

describe("gateway-medya: user_echo yansıtma (canlı ve telafi)", () => {
  it("medya1 bağlantısı ekler'i alır; eski bağlantı eksiz, önekli metin alır", async () => {
    const o = await hazir();
    o.medya.ekKoy("tel-1", "ana", FOTO);
    const yeni = await o.giris([MEDYA1]);
    const eski = await o.giris([]);
    await yeni.gonder(mesaj("u-1", "bak", [FOTO]));
    const y = yeni.tur("event").map((e) => e.event).find((e) => e.type === "user_echo")!;
    assert.deepEqual(y.ekler, [FOTO]);
    assert.equal(y.text, "bak");
    const ham = eski.ham.filter((k) => k.type === "event").map((k) => k.event).find((e) => e.type === "user_echo")!;
    assert.ok(!("ekler" in ham), "eski bağlantıya ekler gitmemeli");
    assert.equal(ham.text, "[1 fotoğraf] bak");
  });

  it("telafide de: sonradan bağlanan eski bağlantı önekli, medya1 bağlantısı ekli alır", async () => {
    const o = await hazir();
    o.medya.ekKoy("tel-1", "ana", FOTO);
    o.medya.ekKoy("tel-1", "ana", VIDEO);
    const ilk = await o.giris([MEDYA1]);
    await ilk.gonder(mesaj("u-1", "", [FOTO, VIDEO]));
    const eski = await o.giris([], TEL1, 0);
    const yeni = await o.giris([MEDYA1], TEL1, 0);
    const echo = (ist: Ist) => ist.ham.filter((k) => k.type === "event").map((k) => k.event).find((e) => e.type === "user_echo")!;
    assert.ok(!("ekler" in echo(eski)));
    assert.equal(echo(eski).text, "[1 fotoğraf, 1 video]");
    assert.deepEqual(echo(yeni).ekler, [FOTO, VIDEO]);
    assert.equal(echo(yeni).text, "");
  });

  it("medya bağımlılığı yokken depodaki ekli user_echo herkese önekli gider", async () => {
    const o = await hazir({ medyaVar: false });
    o.depo.olayEkle({ type: "user_echo", sohbet_id: "ana", client_msg_id: "u-0", input: "yazi", text: "x", ekler: [FOTO] } as never);
    const ist = await o.giris([MEDYA1]);
    const e = ist.ham.filter((k) => k.type === "event").map((k) => k.event).find((x) => x.type === "user_echo")!;
    assert.ok(!("ekler" in e));
    assert.equal(e.text, "[1 fotoğraf] x");
  });
});
