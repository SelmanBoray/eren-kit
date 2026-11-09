import assert from "node:assert/strict";
import { generateKeyPairSync, createPublicKey, sign as imzaAt, verify as imzaDogrula, timingSafeEqual } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { SOHBET_SINIRLARI, SOHBET_SURUMU, kimlikImzaMetni, sohbetAsagiCoz, UsageReport } from "@eren/protocol";
import type { AnahtarPortu, Depo, GatewayBagimliliklari, TuketimOzeti } from "../src/sozlesme.ts";
import { depoKur } from "../src/depo.ts";
import { gatewayKur } from "../src/gateway.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import { sahteGunluk, sahteRastgele, sahteWs, sahteZaman } from "./sahte.ts";
import type { SahteWsBaglantisi } from "./sahte.ts";

// Sözleşme: sozlesme-tuketim.md (usage_request -> usage_report, ST6). gateway.test.ts kalıbı.

type Msg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const BASLANGIC = 1_700_000_000_000;
const SUNUCU_IP = "100.64.0.10";
const IP1 = "100.64.0.20";
const NONCE = Buffer.alloc(32, 7).toString("base64");

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
};

const { privateKey: TEL_OZEL, publicKey: TEL_ACIK } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const TEL_ACIK_B64 = TEL_ACIK.export({ type: "spki", format: "der" }).toString("base64");
const imzala = (k: KeyObject, metin: string): string => imzaAt("sha256", Buffer.from(metin, "utf8"), k).toString("base64");

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

const sifirToplam = { girdi: 0, cache_yazma: 0, cache_okuma: 0, cikti: 0, sonuc_adet: 0 };
const ikili = (n: number, maliyet?: number) => ({
  sohbet: { girdi: n, cache_yazma: 1, cache_okuma: 2, cikti: 3, sonuc_adet: 4, ...(maliyet !== undefined && { maliyet_usd: maliyet }) },
  is: { ...sifirToplam },
});
const OZET: TuketimOzeti = {
  bugun: ikili(10, 0.5),
  son_7_gun: ikili(70, 3.25),
  sohbetler: [{ sohbet_id: "ana", toplam: ikili(5) }],
  isler: [
    { is_id: 9, toplam: { girdi: 1, cache_yazma: 0, cache_okuma: 0, cikti: 2, sonuc_adet: 1 } },
    { is_id: 3, toplam: { ...sifirToplam } },
  ],
};

async function hazir(ozetFn: (g: { gunBaslangicMs: number; yediGunBaslangicMs: number; isAdet: number }) => TuketimOzeti) {
  const zaman = sahteZaman(BASLANGIC);
  const gunluk = sahteGunluk();
  const veriyolu = veriyoluKur({ gunluk });
  const depoGercek = depoKur({ yol: ":memory:", saat: zaman.saat, veriyolu, gunluk });
  acilacaklar.push(() => depoGercek.kapat());
  const cagrilar: Array<{ gunBaslangicMs: number; yediGunBaslangicMs: number; isAdet: number }> = [];
  // En dar sarmalayıcı: yalnız tuketimOzeti değişir, gerisi gerçek depo.
  const depo: Depo = new Proxy(depoGercek, {
    get(hedef, ad, alici) {
      if (ad === "tuketimOzeti") {
        return (g: { gunBaslangicMs: number; yediGunBaslangicMs: number; isAdet: number }) => {
          cagrilar.push({ ...g });
          return ozetFn(g);
        };
      }
      const v = Reflect.get(hedef, ad, alici);
      return typeof v === "function" ? v.bind(hedef) : v;
    },
  });
  depoGercek.cihazEkle({
    device_id: "tel-1",
    public_key: TEL_ACIK_B64,
    tailscale_ip: IP1,
    platform: "android",
    etiket: null,
    eslesme_ms: BASLANGIC,
  });
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
              insanMesajiAl: (m: Msg) => {
                const o = depoGercek.olayEkle({
                  type: "user_echo",
                  sohbet_id: m.sohbet_id,
                  client_msg_id: m.client_msg_id,
                  input: m.input,
                  text: m.text,
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

  const giris = async (): Promise<Ist> => {
    const ist = new Ist(ws.baglan("/sohbet", IP1));
    await ist.gonder({ v: SOHBET_SURUMU, type: "hello", device_id: "tel-1", last_seq: 0, client_nonce: NONCE });
    const ch = ist.tur("auth_challenge")[0];
    assert.ok(ch, "auth_challenge gelmedi");
    const metin = kimlikImzaMetni({
      rol: "telefon",
      kanal: "sohbet",
      device_id: "tel-1",
      client_nonce: NONCE,
      server_nonce: ch.server_nonce,
    });
    await ist.gonder({ v: SOHBET_SURUMU, type: "auth_response", signature: imzala(TEL_OZEL, metin) });
    assert.equal(ist.tur("error").length, 0, "giriş hata verdi");
    assert.equal(ist.tur("welcome").length, 1, "welcome gelmedi");
    return ist;
  };
  return { giris, gunluk, zaman, cagrilar, ws };
}

const istek = (istek_id: string): object => ({ v: SOHBET_SURUMU, type: "usage_request", istek_id });

const yerelGeceYarisi = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

describe("gateway: usage_request -> usage_report", () => {
  it("tam bir usage_report döner: aynı istek_id, olcum_ms saat, gun_baslangic_ms yerel gece yarısı, gövde depodan", async () => {
    const o = await hazir(() => OZET);
    const ist = await o.giris();
    await ist.gonder(istek("u-1"));
    const r = ist.tur("usage_report");
    assert.equal(r.length, 1);
    assert.equal(r[0]!.v, SOHBET_SURUMU);
    assert.equal(r[0]!.istek_id, "u-1");
    assert.equal(r[0]!.olcum_ms, o.zaman.saat.simdiMs());
    assert.equal(r[0]!.gun_baslangic_ms, yerelGeceYarisi(o.zaman.saat.simdiMs()));
    const { v: _v, type: _t, istek_id: _i, olcum_ms: _o, gun_baslangic_ms: _g, ...govde } = r[0]!;
    assert.deepEqual(govde, OZET);
    assert.ok(!ist.kapali);
  });

  it("çerçeve protokolün UsageReport şemasından geçer", async () => {
    const o = await hazir(() => OZET);
    const ist = await o.giris();
    await ist.gonder(istek("u-sema"));
    const ham = ist.c.gonderilenler.map((m) => JSON.parse(m) as Msg).find((k) => k.type === "usage_report");
    assert.ok(ham);
    const s = UsageReport.safeParse(ham);
    assert.ok(s.success, s.success ? "" : JSON.stringify(s.error.issues));
  });

  it("depo.tuketimOzeti gece yarısı, yedi gün başı ve TUKETIM_IS_ADET ile çağrılır", async () => {
    const o = await hazir(() => OZET);
    const ist = await o.giris();
    await ist.gonder(istek("u-2"));
    const gece = yerelGeceYarisi(BASLANGIC);
    const d = new Date(BASLANGIC);
    const yedi = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6).getTime();
    assert.deepEqual(o.cagrilar, [{ gunBaslangicMs: gece, yediGunBaslangicMs: yedi, isAdet: SOHBET_SINIRLARI.TUKETIM_IS_ADET }]);
  });

  it("olcum_ms sahte saati izler", async () => {
    const o = await hazir(() => OZET);
    const ist = await o.giris();
    o.zaman.ilerlet(3_600_000);
    await ist.gonder(istek("u-3"));
    const r = ist.tur("usage_report")[0]!;
    assert.equal(r.olcum_ms, BASLANGIC + 3_600_000);
    assert.equal(r.gun_baslangic_ms, yerelGeceYarisi(BASLANGIC + 3_600_000));
  });

  it("usage_request için ack gönderilmez", async () => {
    const o = await hazir(() => OZET);
    const ist = await o.giris();
    await ist.gonder(istek("u-4"));
    assert.equal(ist.tur("ack").length, 0);
    assert.equal(ist.tur("usage_report").length, 1);
  });

  it("her istek kendi istek_id'siyle bir rapor alır", async () => {
    const o = await hazir(() => OZET);
    const ist = await o.giris();
    await ist.gonder(istek("a"));
    await ist.gonder(istek("b"));
    assert.deepEqual(
      ist.tur("usage_report").map((r) => r.istek_id),
      ["a", "b"],
    );
  });

  it("tuketimOzeti hata atarsa bağlantı açık kalır, rapor da hata da gitmez, günlüğe kayıt düşer", async () => {
    const o = await hazir(() => {
      throw new Error("depo patladı");
    });
    const ist = await o.giris();
    const once = ist.c.gonderilenler.length;
    await ist.gonder(istek("u-5"));
    assert.ok(!ist.kapali, "bağlantı kapandı");
    assert.equal(ist.c.gonderilenler.length, once, "hiçbir çerçeve gitmemeliydi");
    assert.equal(ist.tur("usage_report").length, 0);
    assert.equal(ist.tur("error").length, 0);
    assert.equal(ist.tur("ack").length, 0);
    assert.ok(o.gunluk.girdiler.some((g) => g.olay === "tuketim_hatasi"), "günlük kaydı yok");
    // Bağlantı hâlâ çalışır: bir sonraki iletiler işlenir.
    await ist.gonder({ v: SOHBET_SURUMU, type: "user_message", client_msg_id: "m-1", sohbet_id: "ana", input: "yazi", text: "merhaba" });
    assert.equal(ist.tur("ack").filter((a) => a.client_msg_id === "m-1").length, 1);
  });

  it("usage_request yollamayan bağlantı hiç usage_report almaz; user_message hâlâ ack alır", async () => {
    const o = await hazir(() => OZET);
    const ist = await o.giris();
    await ist.gonder({ v: SOHBET_SURUMU, type: "user_message", client_msg_id: "m-2", sohbet_id: "ana", input: "yazi", text: "selam" });
    await ist.gonder({ v: SOHBET_SURUMU, type: "user_message", client_msg_id: "m-3", sohbet_id: "ana", input: "yazi", text: "tekrar" });
    assert.equal(ist.tur("ack").filter((a) => a.client_msg_id === "m-2").length, 1);
    assert.equal(ist.tur("ack").filter((a) => a.client_msg_id === "m-3").length, 1);
    assert.equal(ist.tur("usage_report").length, 0);
    assert.equal(o.cagrilar.length, 0, "istek yokken depo özeti çağrılmamalı");
  });
});
