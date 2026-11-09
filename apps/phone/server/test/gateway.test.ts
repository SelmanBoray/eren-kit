import assert from "node:assert/strict";
import {
  createPublicKey,
  generateKeyPairSync,
  sign as imzaAt,
  timingSafeEqual,
  verify as imzaDogrula,
} from "node:crypto";
import type { KeyObject } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import {
  AZAMI_CERCEVE,
  SOHBET_SURUMU,
  cihazAsagiCoz,
  kimlikImzaMetni,
  sha256Hex,
  sohbetAsagiCoz,
  utf8Bayt,
} from "@eren/protocol";
import type { ImzaRolu, Kanal, ServisBilgisi } from "@eren/protocol";
import { depoKur } from "../src/depo.ts";
import { gatewayKur } from "../src/gateway.ts";
import type {
  AktifTur,
  AnahtarPortu,
  Depo,
  ErenDurumu,
  GatewayBagimliliklari,
  SohbetAktifTuru,
  LimitKilitDurumu,
  RamOzeti,
  TemizlikHatasi,
  TemizlikSonucu,
  WsYolu,
} from "../src/sozlesme.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import { sahteGunluk, sahteRastgele, sahteWs, sahteZaman } from "./sahte.ts";
import type { SahteWsBaglantisi } from "./sahte.ts";

// ---------------------------------------------------------------------------------------------
// Sabitler ve yardımcılar
// ---------------------------------------------------------------------------------------------

const BASLANGIC = 1_700_000_000_000;
const SUNUCU_IP = "100.64.0.10";
const IP1 = "100.64.0.20";
const IP2 = "100.64.0.21";
const WS_PORT = 47821;
const ISTEMCI_NONCE = Buffer.alloc(32, 7).toString("base64");
const KOD = "ABC123XYZ9";
const SERVIS: ServisBilgisi = { surum: "abc123def456", baslangic_ms: BASLANGIC - 5000 };
const MEZAR_SEQ = 4242;

/** Kanal başına çerçeve sürümü: `/sohbet` `SOHBET_SURUMU` (v4), `/cihaz` v1. */
const vYol = (yol: WsYolu): number => (yol === "/sohbet" ? SOHBET_SURUMU : 1);

const helloMesaji = (yol: WsYolu, device_id = "tel-1", nonce = ISTEMCI_NONCE, last_seq = 0): Msg =>
  yol === "/sohbet"
    ? { v: vYol(yol), type: "hello", device_id, last_seq, client_nonce: nonce }
    : { v: vYol(yol), type: "hello", device_id, client_nonce: nonce };

type Msg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
};

interface Telefon {
  private: KeyObject;
  acik: string;
}

const telefonUret = (): Telefon => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { private: privateKey, acik: publicKey.export({ type: "spki", format: "der" }).toString("base64") };
};

const TEL1 = telefonUret();
const TEL2 = telefonUret();
const YABANCI = telefonUret();

const imzala = (anahtar: KeyObject, metin: string): string =>
  imzaAt("sha256", Buffer.from(metin, "utf8"), anahtar).toString("base64");

/** Gerçek P-256 sunucu anahtarı. */
function gercekAnahtar(): AnahtarPortu & { cagrilar: string[] } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const acik = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const cagrilar: string[] = [];
  return {
    cagrilar,
    acikAnahtar: () => acik,
    imzala: (metin) => {
      cagrilar.push("imzala");
      return imzala(privateKey, metin);
    },
    dogrula: (a, metin, imza) => {
      try {
        const k = createPublicKey({ key: Buffer.from(a, "base64"), format: "der", type: "spki" });
        return imzaDogrula("sha256", Buffer.from(metin, "utf8"), k, Buffer.from(imza, "base64"));
      } catch {
        return false;
      }
    },
    sabitZamanEsit: (a, b) => {
      cagrilar.push("sabitZamanEsit");
      const x = Buffer.from(a, "utf8");
      const y = Buffer.from(b, "utf8");
      return x.length === y.length && timingSafeEqual(x, y);
    },
  };
}

const kanalAdi = (yol: WsYolu): Kanal => (yol === "/sohbet" ? "sohbet" : "cihaz");

/** Bağlantının üstüne ince bir telefon rolü. Gelen her çerçeve şemadan geçer. */
class Ist {
  readonly c: SahteWsBaglantisi;
  constructor(c: SahteWsBaglantisi) {
    this.c = c;
  }
  get kare(): Msg[] {
    return this.c.gonderilenler.map((m) => {
      const coz = this.c.yol === "/sohbet" ? sohbetAsagiCoz(m) : cihazAsagiCoz(m);
      assert.ok(coz.ok, `giden çerçeve şemaya uymuyor: ${m.slice(0, 200)}`);
      return coz.mesaj as Msg;
    });
  }
  tur(t: string): Msg[] {
    return this.kare.filter((k) => k.type === t);
  }
  /** Şemadan geçirmeden, gönderilen ham JSON nesneleri (sürüm denetimi için). */
  get hamKareler(): Msg[] {
    return this.c.gonderilenler.map((m) => JSON.parse(m) as Msg);
  }
  hamTur(t: string): Msg[] {
    return this.hamKareler.filter((k) => k.type === t);
  }
  get turler(): string[] {
    return this.kare.map((k) => k.type as string);
  }
  get kapali(): boolean {
    return this.c.kapanis !== null;
  }
  get hataKodu(): string | undefined {
    return this.tur("error")[0]?.code;
  }
  get ham(): string {
    return this.c.gonderilenler.join("\n");
  }
  async gonder(m: object | string): Promise<void> {
    this.c.mesajGonder(typeof m === "string" ? m : JSON.stringify(m));
    await bosalt();
  }
}

interface ElSikma {
  device_id?: string;
  nonce?: string;
  last_seq?: number;
  anahtar?: KeyObject;
  rol?: ImzaRolu;
  kanal?: Kanal;
  /** Verilirse imza yerine bu gider. */
  imza?: string;
  imzaNonce?: (sunucuNonce: string) => string;
}

async function elSik(ist: Ist, s: ElSikma = {}): Promise<Msg | null> {
  const kanal = kanalAdi(ist.c.yol);
  const device_id = s.device_id ?? "tel-1";
  const nonce = s.nonce ?? ISTEMCI_NONCE;
  await ist.gonder(helloMesaji(ist.c.yol, device_id, nonce, s.last_seq ?? 0));
  const ch = ist.tur("auth_challenge")[0];
  if (ch === undefined || ist.kapali) return null;
  const metin = kimlikImzaMetni({
    rol: s.rol ?? "telefon",
    kanal: s.kanal ?? kanal,
    device_id,
    client_nonce: nonce,
    server_nonce: s.imzaNonce?.(ch.server_nonce) ?? ch.server_nonce,
  });
  await ist.gonder({ v: vYol(ist.c.yol), type: "auth_response", signature: s.imza ?? imzala(s.anahtar ?? TEL1.private, metin) });
  return ch;
}

// ---------------------------------------------------------------------------------------------
// Ortam
// ---------------------------------------------------------------------------------------------

const acilacaklar: Array<() => void> = [];
afterEach(() => {
  for (const f of acilacaklar.splice(0)) f();
});

interface Durum {
  tailscale: string | null;
  eren: ErenDurumu;
  /** `ana` dışındaki sohbetlerin durumu (yoksa `hazir`). */
  digerDurumlar: Record<string, ErenDurumu>;
  /** `ana` dışındaki sohbetlerin görünür açık turları. */
  digerTurlar: SohbetAktifTuru[];
  /** `chat_delete`/`chat_clear` için meşgul sayılan sohbetler. */
  mesguller: Set<string>;
  kilit: LimitKilitDurumu;
  aktifIs: number;
  ram: RamOzeti;
  tur: AktifTur | null;
  kesSonuc: { ok: true; deger: undefined } | { ok: false; code: string };
  planSonuc: { ok: true; deger: undefined } | { ok: false; code: string };
  soruSonuc: { ok: true; deger: undefined } | { ok: false; code: string };
  durdurSonuc: { ok: true; deger: { is_id: number; sonuc: string } } | { ok: false; code: string };
  temizlikSonuc: { ok: true; deger: TemizlikSonucu } | { ok: false; code: TemizlikHatasi };
}

function kur(sec: { sarmala?: (d: Depo) => Depo; tailscale?: string | null; servis?: ServisBilgisi } = {}) {
  const zaman = sahteZaman(BASLANGIC);
  const gunluk = sahteGunluk();
  const veriyolu = veriyoluKur({ gunluk });
  const depoGercek = depoKur({ yol: ":memory:", saat: zaman.saat, veriyolu, gunluk });
  acilacaklar.push(() => depoGercek.kapat());
  const depo = sec.sarmala ? sec.sarmala(depoGercek) : depoGercek;
  const ws = sahteWs();
  const anahtar = gercekAnahtar();
  const rastgele = sahteRastgele();

  const d: Durum = {
    tailscale: sec.tailscale === undefined ? SUNUCU_IP : sec.tailscale,
    eren: "hazir",
    digerDurumlar: {},
    digerTurlar: [],
    mesguller: new Set<string>(),
    kilit: { tur: "serbest" },
    aktifIs: 0,
    ram: { bosMb: 8000, toplamMb: 16000, dusuk: false },
    tur: null,
    kesSonuc: { ok: true, deger: undefined },
    planSonuc: { ok: true, deger: undefined },
    soruSonuc: { ok: true, deger: undefined },
    durdurSonuc: { ok: true, deger: { is_id: 7, sonuc: "durduruldu" } },
    temizlikSonuc: { ok: true, deger: { mezar_seq: MEZAR_SEQ, sinir_seq: MEZAR_SEQ - 1 } },
  };
  const temizlikCagrilari: unknown[][] = [];
  const insanMesajlari: Msg[] = [];
  const kesmeler: Array<string | undefined> = [];
  const kesSohbetleri: string[] = [];
  const temizlenenSohbetler: string[] = [];
  const silinenSohbetler: string[] = [];
  const olustur: Array<[string, string]> = [];
  const adlandir: Array<[string, string]> = [];
  const aktifSohbetler = new Map<string, string>([["ana", "Claude"]]);
  const silinmisSohbetler = new Set<string>();
  const planKararlari: Msg[] = [];
  const soruCevaplari: Array<[string, string]> = [];
  const durdurmalar: Array<[number, string]> = [];
  const baglananlar: Msg[] = [];
  const cihazGelen: string[] = [];

  const b = {
    ayar: {
      wsPort: WS_PORT,
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
      servis: sec.servis ?? SERVIS,
    },
    depo,
    sohbetler: {
      konusma: (x: { sohbet_id: string }) => {
        if (!aktifSohbetler.has(x.sohbet_id)) return null;
        return {
          insanMesajiAl: (m: Msg) => {
            insanMesajlari.push({ ...m });
            const o = depoGercek.olayEkle({
              type: "user_echo",
              sohbet_id: m.sohbet_id,
              client_msg_id: m.client_msg_id,
              input: m.input,
              text: m.text,
              ...(m.baglam !== undefined && { baglam: m.baglam }),
            } as never);
            return { seq: o.seq };
          },
          kes: (id?: string) => {
            kesmeler.push(id);
            kesSohbetleri.push(x.sohbet_id);
            return d.kesSonuc;
          },
        };
      },
      durumlar: () => [
        { sohbet_id: "ana", eren: d.eren },
        ...[...aktifSohbetler.keys()]
          .filter((k) => k !== "ana")
          .map((k) => ({ sohbet_id: k, eren: d.digerDurumlar[k] ?? "hazir" })),
      ],
      aktifTurlar: () => [...(d.tur === null ? [] : [{ sohbet_id: "ana", ...d.tur }]), ...d.digerTurlar],
      olustur: (x: { sohbet_id: string }, ad: string) => {
        olustur.push([x.sohbet_id, ad]);
        if (silinmisSohbetler.has(x.sohbet_id)) return { ok: false, code: "sohbet_bulunamadi" };
        if (aktifSohbetler.has(x.sohbet_id)) return { ok: true, deger: { seq: null } };
        if (aktifSohbetler.size >= 8) return { ok: false, code: "sohbet_siniri" };
        depoGercek.sohbetEkle({ sohbet_id: x.sohbet_id, ad, olusturma_ms: BASLANGIC, son_etkinlik_ms: BASLANGIC });
        aktifSohbetler.set(x.sohbet_id, ad);
        const o = depoGercek.olayEkle({ type: "chat_created", sohbet_id: x.sohbet_id, ad } as never);
        veriyolu.yayinla("sohbet_listesi_degisti", { sohbet_id: x.sohbet_id, olay: "olusturuldu" });
        return { ok: true, deger: { seq: o.seq } };
      },
      adlandir: (x: { sohbet_id: string }, ad: string) => {
        adlandir.push([x.sohbet_id, ad]);
        const eski = aktifSohbetler.get(x.sohbet_id);
        if (eski === undefined) return { ok: false, code: "sohbet_bulunamadi" };
        if (eski === ad) return { ok: true, deger: { seq: null } };
        aktifSohbetler.set(x.sohbet_id, ad);
        const o = depoGercek.olayEkle({ type: "chat_renamed", sohbet_id: x.sohbet_id, ad } as never);
        return { ok: true, deger: { seq: o.seq } };
      },
    },
    planlar: {
      karar: async (m: Msg) => {
        planKararlari.push({ ...m });
        return d.planSonuc;
      },
    },
    isler: {
      soruCevapla: (id: string, cevap: string) => {
        soruCevaplari.push([id, cevap]);
        return d.soruSonuc;
      },
      durdur: async (id: number, neden: string) => {
        durdurmalar.push([id, neden]);
        return d.durdurSonuc;
      },
      aktifSayisi: () => d.aktifIs,
      ram: () => d.ram,
    },
    temizlik: {
      gecmisiSil: (...a: unknown[]) => {
        temizlikCagrilari.push(a);
        temizlenenSohbetler.push((a[0] as { sohbet_id: string }).sohbet_id);
        return d.temizlikSonuc;
      },
      sohbetiSil: (x: { sohbet_id: string }) => {
        silinenSohbetler.push(x.sohbet_id);
        if (x.sohbet_id === "ana") return { ok: false, code: "sohbet_silinemez" };
        if (!aktifSohbetler.has(x.sohbet_id)) return { ok: false, code: "sohbet_bulunamadi" };
        if (d.mesguller.has(x.sohbet_id)) return { ok: false, code: "sohbet_mesgul" };
        aktifSohbetler.delete(x.sohbet_id);
        silinmisSohbetler.add(x.sohbet_id);
        const o = depoGercek.olayEkle({ type: "chat_deleted", sohbet_id: x.sohbet_id } as never);
        veriyolu.yayinla("sohbet_listesi_degisti", { sohbet_id: x.sohbet_id, olay: "silindi" });
        return { ok: true, deger: { seq: o.seq } };
      },
    },
    cihaz: {
      baglandi: (x: Msg) => {
        baglananlar.push(x);
        x.baglanti.mesajDinle((m: string) => cihazGelen.push(m));
      },
    },
    kilit: { durum: () => d.kilit },
    sistem: { tailscaleAdresi: () => d.tailscale },
    ws,
    anahtar,
    rastgele,
    saat: zaman.saat,
    zamanlayici: zaman.zamanlayici,
    veriyolu,
    gunluk,
  } as unknown as GatewayBagimliliklari;
  const gw = gatewayKur(b);

  const ortam = {
    zaman,
    gunluk,
    veriyolu,
    depo,
    depoGercek,
    ws,
    anahtar,
    rastgele,
    d,
    gw,
    insanMesajlari,
    kesmeler,
    kesSohbetleri,
    temizlenenSohbetler,
    silinenSohbetler,
    olustur,
    adlandir,
    planKararlari,
    soruCevaplari,
    durdurmalar,
    baglananlar,
    cihazGelen,
    temizlikCagrilari,
    async baslat(): Promise<void> {
      const p = gw.baslat();
      await bosalt();
      await p;
      await bosalt();
    },
    /** Kayıtlı cihaz ekler. */
    cihazEkle(device_id: string, t: Telefon, ip: string, platform: "android" | "ipad" = "android"): void {
      depoGercek.cihazEkle({
        device_id,
        public_key: t.acik,
        tailscale_ip: ip,
        platform,
        etiket: null,
        eslesme_ms: BASLANGIC,
      });
    },
    bagla(yol: WsYolu, ip = IP1): Ist {
      return new Ist(ws.baglan(yol, ip));
    },
    /** Eşleşmiş cihazla tam el sıkışma, `welcome` beklenir. */
    async giris(yol: WsYolu = "/sohbet", ip = IP1, s: ElSikma = {}): Promise<Ist> {
      const ist = new Ist(ws.baglan(yol, ip));
      await elSik(ist, s);
      assert.equal(ist.hataKodu, undefined, "giriş hata verdi");
      assert.equal(ist.tur("welcome").length, 1, "welcome gelmedi");
      return ist;
    },
    eslestirmeKur(kod = KOD, sonMs = BASLANGIC + 300_000, yanlis = 0): void {
      depoGercek.eslestirmeYaz({ kod_ozeti: sha256Hex(utf8Bayt(kod)), son_ms: sonMs, yanlis_deneme: yanlis });
    },
  };
  return ortam;
}

type Ortam = ReturnType<typeof kur>;

/** Hazır ortam: dinliyor, TEL1 ve TEL2 kayıtlı. */
async function hazir(sec: Parameters<typeof kur>[0] = {}): Promise<Ortam> {
  const o = kur(sec);
  o.cihazEkle("tel-1", TEL1, IP1);
  o.cihazEkle("tel-2", TEL2, IP2);
  await o.baslat();
  return o;
}

function reddedildi(ist: Ist, kod: string): void {
  assert.equal(ist.hataKodu, kod, `beklenen ${kod}, gelen ${JSON.stringify(ist.kare)}`);
  assert.ok(ist.kapali, "bağlantı kapanmadı");
  assert.equal(ist.tur("welcome").length, 0, "reddedilen bağlantıya welcome gitti");
}

const kullaniciMesaji = (id: string, text = "merhaba", input = "yazi", v: number = SOHBET_SURUMU, sohbet_id = "ana") => ({
  v,
  type: "user_message",
  client_msg_id: id,
  sohbet_id,
  input,
  text,
});

// ---------------------------------------------------------------------------------------------
// Ağ
// ---------------------------------------------------------------------------------------------

describe("gateway: ağ", () => {
  it("yalnız Tailscale adresinde, ayar portunda ve kanal sınırlarıyla dinler", async () => {
    const o = await hazir();
    const i = o.ws.istek();
    assert.ok(i);
    assert.equal(i.host, SUNUCU_IP);
    assert.notEqual(i.host, "0.0.0.0");
    assert.equal(i.port, WS_PORT);
    assert.deepEqual(i.azamiCerceve, { "/sohbet": AZAMI_CERCEVE.SOHBET, "/cihaz": AZAMI_CERCEVE.CIHAZ });
  });

  it("adres yoksa dinlemez, 30 sn'de bir dener ve adres gelince bir kez dinler", async () => {
    const o = await hazir({ tailscale: null });
    assert.equal(o.ws.cagrilar.say("dinle"), 0);
    o.zaman.ilerlet(29_000);
    await bosalt();
    assert.equal(o.ws.cagrilar.say("dinle"), 0);
    o.zaman.ilerlet(61_000);
    await bosalt();
    assert.equal(o.ws.cagrilar.say("dinle"), 0, "adres hâlâ yokken dinlenmez");
    o.d.tailscale = "100.64.0.99";
    o.zaman.ilerlet(30_000);
    await bosalt();
    assert.equal(o.ws.cagrilar.say("dinle"), 1);
    assert.equal(o.ws.istek()?.host, "100.64.0.99");
    o.zaman.ilerlet(120_000);
    await bosalt();
    assert.equal(o.ws.cagrilar.say("dinle"), 1, "dinlerken yeniden denenmez");
  });

  for (const kotu of ["0.0.0.0", "127.0.0.1", "192.168.1.5", "10.0.0.1", "100.63.255.255", "100.128.0.1", "::", ""]) {
    it(`100.64.0.0/10 dışındaki adreste (${kotu || "boş"}) hiç dinlemez`, async () => {
      const o = await hazir({ tailscale: kotu });
      o.zaman.ilerlet(90_000);
      await bosalt();
      assert.equal(o.ws.cagrilar.say("dinle"), 0);
    });
  }

  for (const iyi of ["100.64.0.0", "100.127.255.254"]) {
    it(`aralığın uçlarında (${iyi}) dinler`, async () => {
      const o = await hazir({ tailscale: iyi });
      assert.equal(o.ws.istek()?.host, iyi);
    });
  }

  it("kapat sunucuyu kapatır ve yeniden denemeyi durdurur", async () => {
    const o = await hazir();
    await o.gw.kapat();
    assert.equal(o.ws.kapatildi, true);

    const p = await hazir({ tailscale: null });
    await p.gw.kapat();
    p.d.tailscale = SUNUCU_IP;
    p.zaman.ilerlet(120_000);
    await bosalt();
    assert.equal(p.ws.cagrilar.say("dinle"), 0);
  });
});

// ---------------------------------------------------------------------------------------------
// El sıkışma
// ---------------------------------------------------------------------------------------------

describe("gateway: el sıkışma, başarılı yol", () => {
  it("/sohbet: hello -> auth_challenge -> auth_response -> welcome, sunucu imzası doğrulanır", async () => {
    const o = await hazir();
    const ist = o.bagla("/sohbet");
    const ch = await elSik(ist);
    assert.ok(ch);
    assert.deepEqual(ist.turler.slice(0, 2), ["auth_challenge", "welcome"]);
    assert.equal(Buffer.from(ch.server_nonce, "base64").length, 32);
    assert.ok(o.rastgele.cagrilar.hepsi("baytlar").some((c) => c.args[0] === 32));

    const metin = (rol: ImzaRolu, kanal: Kanal) =>
      kimlikImzaMetni({
        rol,
        kanal,
        device_id: "tel-1",
        client_nonce: ISTEMCI_NONCE,
        server_nonce: ch.server_nonce,
      });
    const pcAcik = o.anahtar.acikAnahtar();
    assert.equal(o.anahtar.dogrula(pcAcik, metin("pc", "sohbet"), ch.server_signature), true);
    assert.equal(o.anahtar.dogrula(pcAcik, metin("pc", "cihaz"), ch.server_signature), false);
    assert.equal(o.anahtar.dogrula(pcAcik, metin("telefon", "sohbet"), ch.server_signature), false);

    const w = ist.tur("welcome")[0]!;
    assert.equal(w.head_seq, o.depo.basSeq());
    assert.equal(w.server_time_ms, o.zaman.simdi());
    assert.equal(ist.kapali, false);
  });

  it("her bağlantı kendi sunucu nonce'unu alır", async () => {
    const o = await hazir();
    const a = o.bagla("/sohbet");
    const b = o.bagla("/sohbet", IP2);
    await elSik(a);
    await elSik(b, { device_id: "tel-2", anahtar: TEL2.private });
    assert.notEqual(a.tur("auth_challenge")[0]!.server_nonce, b.tur("auth_challenge")[0]!.server_nonce);
  });

  it("/cihaz: kanal imzası, welcome yalnız server_time_ms taşır ve cihaz.baglandi bir kez çağrılır", async () => {
    const o = await hazir();
    const ist = o.bagla("/cihaz");
    const ch = await elSik(ist);
    assert.ok(ch);
    const metin = kimlikImzaMetni({
      rol: "pc",
      kanal: "cihaz",
      device_id: "tel-1",
      client_nonce: ISTEMCI_NONCE,
      server_nonce: ch.server_nonce,
    });
    assert.equal(o.anahtar.dogrula(o.anahtar.acikAnahtar(), metin, ch.server_signature), true);
    const w = ist.tur("welcome");
    assert.equal(w.length, 1);
    assert.equal(w[0]!.server_time_ms, o.zaman.simdi());
    assert.equal(w[0]!.head_seq, undefined);
    assert.equal(o.baglananlar.length, 1);
    assert.equal(o.baglananlar[0]!.device_id, "tel-1");
    assert.equal(o.baglananlar[0]!.baglanti, ist.c);
    assert.equal(ist.tur("event").length, 0);
    assert.equal(ist.tur("server_status").length, 0);
  });
});

describe("gateway: el sıkışma, hata dalları", () => {
  for (const yol of ["/sohbet", "/cihaz"] as const) {
    describe(yol, () => {
      it("cihaz kayıtlı değilse cihaz_bilinmiyor", async () => {
        const o = await hazir();
        const ist = o.bagla(yol);
        await elSik(ist, { device_id: "yok-1" });
        reddedildi(ist, "cihaz_bilinmiyor");
        assert.equal(o.baglananlar.length, 0);
      });

      it("bozuk imza imza_gecersiz", async () => {
        const o = await hazir();
        const ist = o.bagla(yol);
        await elSik(ist, { imza: Buffer.from("rastgele-imza").toString("base64") });
        reddedildi(ist, "imza_gecersiz");
        assert.equal(o.baglananlar.length, 0);
      });

      it("başka anahtarla atılan imza imza_gecersiz", async () => {
        const o = await hazir();
        const ist = o.bagla(yol);
        await elSik(ist, { anahtar: YABANCI.private });
        reddedildi(ist, "imza_gecersiz");
      });

      it("başka cihazın anahtarı imza_gecersiz", async () => {
        const o = await hazir();
        const ist = o.bagla(yol);
        await elSik(ist, { anahtar: TEL2.private });
        reddedildi(ist, "imza_gecersiz");
      });

      it("imza başka kanala taşınamaz", async () => {
        const o = await hazir();
        const ist = o.bagla(yol);
        await elSik(ist, { kanal: yol === "/sohbet" ? "cihaz" : "sohbet" });
        reddedildi(ist, "imza_gecersiz");
      });

      it("imza başka role taşınamaz (pc rolüyle imzalanmış)", async () => {
        const o = await hazir();
        const ist = o.bagla(yol);
        await elSik(ist, { rol: "pc" });
        reddedildi(ist, "imza_gecersiz");
      });

      it("sunucunun kendi challenge imzası geri yollanırsa imza_gecersiz (yansıtma)", async () => {
        const o = await hazir();
        const ist = o.bagla(yol);
        await ist.gonder(
          helloMesaji(yol),
        );
        const ch = ist.tur("auth_challenge")[0]!;
        await ist.gonder({ v: vYol(yol), type: "auth_response", signature: ch.server_signature });
        reddedildi(ist, "imza_gecersiz");
      });

      it("başka sunucu nonce'una atılan imza imza_gecersiz", async () => {
        const o = await hazir();
        const ist = o.bagla(yol);
        await elSik(ist, { imzaNonce: () => Buffer.alloc(32, 9).toString("base64") });
        reddedildi(ist, "imza_gecersiz");
      });

      it("başka istemci nonce'una atılan imza imza_gecersiz", async () => {
        const o = await hazir();
        const ist = o.bagla(yol);
        await ist.gonder(
          helloMesaji(yol),
        );
        const ch = ist.tur("auth_challenge")[0]!;
        const metin = kimlikImzaMetni({
          rol: "telefon",
          kanal: kanalAdi(yol),
          device_id: "tel-1",
          client_nonce: Buffer.alloc(32, 1).toString("base64"),
          server_nonce: ch.server_nonce,
        });
        await ist.gonder({ v: vYol(yol), type: "auth_response", signature: imzala(TEL1.private, metin) });
        reddedildi(ist, "imza_gecersiz");
      });

      it("kayıtlı IP'den farklı adresten ip_uyusmuyor (imza doğru olsa da)", async () => {
        const o = await hazir();
        const ist = o.bagla(yol, "100.64.0.77");
        await elSik(ist);
        reddedildi(ist, "ip_uyusmuyor");
        assert.equal(o.baglananlar.length, 0);
      });

      it("bilgisayarın kendi Tailscale adresinden gelen kimlik ip_uyusmuyor (kayıt o adresi taşısa bile)", async () => {
        const o = await hazir();
        o.cihazEkle("tel-yerel", TEL1, SUNUCU_IP);
        const ist = o.bagla(yol, SUNUCU_IP);
        await elSik(ist, { device_id: "tel-yerel" });
        reddedildi(ist, "ip_uyusmuyor");
        assert.equal(o.baglananlar.length, 0);
      });

      it("auth_response, hello'dan önce gelirse yetkisiz", async () => {
        const o = await hazir();
        const ist = o.bagla(yol);
        await ist.gonder({ v: vYol(yol), type: "auth_response", signature: imzala(TEL1.private, "x") });
        reddedildi(ist, "yetkisiz");
      });

      it("hello iki kez gelirse yetkisiz", async () => {
        const o = await hazir();
        const ist = o.bagla(yol);
        const hello =
          helloMesaji(yol);
        await ist.gonder(hello);
        await ist.gonder(hello);
        reddedildi(ist, "yetkisiz");
      });

      it("challenge sonrası başka bir iş mesajı yetkisiz", async () => {
        const o = await hazir();
        const ist = o.bagla(yol);
        await ist.gonder(
          helloMesaji(yol),
        );
        await ist.gonder(kullaniciMesaji("m1", "merhaba", "yazi", vYol(yol)));
        assert.ok(ist.kapali);
        assert.equal(ist.tur("welcome").length, 0);
        assert.equal(o.insanMesajlari.length, 0);
        assert.ok(ist.hataKodu === "yetkisiz" || ist.hataKodu === "gecersiz_mesaj", String(ist.hataKodu));
      });

      it("hello gelmeden zaman aşımı: 10 sn'de kapanır", async () => {
        const o = await hazir();
        const ist = o.bagla(yol);
        o.zaman.ilerlet(9_900);
        await bosalt();
        assert.equal(ist.kapali, false);
        o.zaman.ilerlet(200);
        await bosalt();
        assert.equal(ist.kapali, true);
        assert.equal(ist.tur("welcome").length, 0);
      });

      it("hello'dan sonra auth_response gelmezse 10 sn'de kapanır", async () => {
        const o = await hazir();
        const ist = o.bagla(yol);
        await ist.gonder(
          helloMesaji(yol),
        );
        o.zaman.ilerlet(10_100);
        await bosalt();
        assert.equal(ist.kapali, true);
        assert.equal(ist.tur("welcome").length, 0);
      });

      it("kimlik bitince süre sayacı bağlantıyı kapatmaz", async () => {
        const o = await hazir();
        const ist = await o.giris(yol);
        o.zaman.ilerlet(120_000);
        await bosalt();
        assert.equal(ist.kapali, false);
      });

      it("kimlik öncesi geçersiz çerçeve error + kapatma", async () => {
        const o = await hazir();
        for (const [ham, kod] of [
          ["{bozuk", "gecersiz_mesaj"],
          [JSON.stringify({ v: vYol(yol), type: "bilinmeyen_tur" }), "gecersiz_mesaj"],
          // /sohbet'te v1 (eski APK) ve /cihaz'da v2 sürüm uyumsuzluğudur.
          [JSON.stringify({ v: yol === "/sohbet" ? 1 : 2, type: "hello" }), "protokol_uyumsuz"],
          [JSON.stringify({ ...helloMesaji(yol), fazla: 1 }), "gecersiz_mesaj"],
          ["x".repeat(AZAMI_CERCEVE[yol === "/sohbet" ? "SOHBET" : "CIHAZ"] + 1), "mesaj_cok_buyuk"],
        ] as const) {
          const ist = o.bagla(yol);
          await ist.gonder(ham);
          assert.equal(ist.hataKodu, kod, ham.slice(0, 60));
          assert.ok(ist.kapali, `${kod} kapatmadı`);
        }
      });
    });
  }

  it("iPad /cihaz'a bağlanamaz: kanal_desteklenmiyor", async () => {
    const o = await hazir();
    o.cihazEkle("ipad-1", TEL2, IP2, "ipad");
    const ist = o.bagla("/cihaz", IP2);
    await elSik(ist, { device_id: "ipad-1", anahtar: TEL2.private });
    reddedildi(ist, "kanal_desteklenmiyor");
    assert.equal(o.baglananlar.length, 0);
  });

  it("iPad /sohbet'e bağlanabilir", async () => {
    const o = await hazir();
    o.cihazEkle("ipad-1", TEL2, IP2, "ipad");
    const ist = o.bagla("/sohbet", IP2);
    await elSik(ist, { device_id: "ipad-1", anahtar: TEL2.private });
    assert.equal(ist.tur("welcome").length, 1);
  });

  it("başarısız el sıkışmadan sonra gelen mesajlar işlenmez", async () => {
    const o = await hazir();
    const ist = o.bagla("/sohbet");
    await elSik(ist, { anahtar: YABANCI.private });
    await ist.gonder(kullaniciMesaji("m1"));
    assert.equal(o.insanMesajlari.length, 0);
  });
});

// ---------------------------------------------------------------------------------------------
// Eşleştirme
// ---------------------------------------------------------------------------------------------

describe("gateway: eşleştirme", () => {
  const eslestir = async (o: Ortam, kod: string, ip = IP1, platform = "android"): Promise<{ ist: Ist; sonuc: string; kare?: Msg }> => {
    const ist = o.bagla("/sohbet", ip);
    await ist.gonder({ v: 1, type: "pair_request", kod, public_key: TEL1.acik, platform, etiket: "deneme" });
    const pr = ist.tur("pair_result")[0];
    if (pr !== undefined) return { ist, sonuc: pr.ok ? "ok" : pr.code, kare: pr };
    return { ist, sonuc: ist.hataKodu ?? "yanit_yok" };
  };

  it("doğru kod: pair_result, cihaz kaydı (açık anahtar + uzak IP), kayıt silinir", async () => {
    const o = kur();
    await o.baslat();
    o.eslestirmeKur();
    const { sonuc, kare } = await eslestir(o, KOD);
    assert.equal(sonuc, "ok");
    assert.ok(kare);
    assert.equal(kare.server_public_key, o.anahtar.acikAnahtar());
    const kayit = o.depo.cihazGetir(kare.device_id);
    assert.ok(kayit);
    assert.equal(kayit.public_key, TEL1.acik);
    assert.equal(kayit.tailscale_ip, IP1);
    assert.equal(kayit.platform, "android");
    assert.equal(o.depo.eslestirmeOku(), null);
    assert.ok(o.anahtar.cagrilar.includes("sabitZamanEsit"), "kod sabit zamanlı karşılaştırılmadı");
  });

  it("eşleşen cihaz aynı adresten hemen kimlik doğrulayabilir", async () => {
    const o = kur();
    await o.baslat();
    o.eslestirmeKur();
    const { kare } = await eslestir(o, KOD);
    const ist = o.bagla("/sohbet", IP1);
    await elSik(ist, { device_id: kare!.device_id });
    assert.equal(ist.tur("welcome").length, 1);
  });

  it("tek kullanımlık: aynı kod ikinci kez eslestirme_kapali", async () => {
    const o = kur();
    await o.baslat();
    o.eslestirmeKur();
    assert.equal((await eslestir(o, KOD)).sonuc, "ok");
    const ikinci = await eslestir(o, KOD, IP2);
    assert.equal(ikinci.sonuc, "eslestirme_kapali");
    assert.equal(o.depo.cihazlar().length, 1);
  });

  it("kayıt yoksa eslestirme_kapali", async () => {
    const o = kur();
    await o.baslat();
    const { sonuc } = await eslestir(o, KOD);
    assert.equal(sonuc, "eslestirme_kapali");
    assert.equal(o.depo.cihazlar().length, 0);
  });

  it("süre dolduysa eslestirme_kapali, dolmadan önce geçer", async () => {
    const o = kur();
    await o.baslat();
    o.eslestirmeKur(KOD, BASLANGIC + 60_000);
    o.zaman.ilerlet(60_001);
    const { sonuc } = await eslestir(o, KOD);
    assert.equal(sonuc, "eslestirme_kapali");
    assert.equal(o.depo.cihazlar().length, 0);

    const p = kur();
    await p.baslat();
    p.eslestirmeKur(KOD, BASLANGIC + 60_000);
    p.zaman.ilerlet(59_000);
    assert.equal((await eslestir(p, KOD)).sonuc, "ok");
  });

  it("yanlış kod eslestirme_kodu_gecersiz, sayaç artar, kayıt durur", async () => {
    const o = kur();
    await o.baslat();
    o.eslestirmeKur();
    for (let i = 1; i <= 3; i++) {
      assert.equal((await eslestir(o, "ZZZZZZ")).sonuc, "eslestirme_kodu_gecersiz");
      assert.equal(o.depo.eslestirmeOku()?.yanlis_deneme, i);
    }
    assert.equal(o.depo.cihazlar().length, 0);
  });

  it("5 yanlışta kayıt silinir, sonra doğru kod da eslestirme_kapali", async () => {
    const o = kur();
    await o.baslat();
    o.eslestirmeKur();
    for (let i = 1; i <= 5; i++) {
      assert.equal((await eslestir(o, "ZZZZZZ")).sonuc, "eslestirme_kodu_gecersiz", `${i}. deneme`);
    }
    assert.equal(o.depo.eslestirmeOku(), null);
    assert.equal((await eslestir(o, KOD)).sonuc, "eslestirme_kapali");
    assert.equal(o.depo.cihazlar().length, 0);
  });

  it("4 yanlıştan sonra doğru kod hâlâ geçer", async () => {
    const o = kur();
    await o.baslat();
    o.eslestirmeKur();
    for (let i = 0; i < 4; i++) await eslestir(o, "ZZZZZZ");
    assert.ok(o.depo.eslestirmeOku());
    assert.equal((await eslestir(o, KOD)).sonuc, "ok");
  });

  it("bilgisayarın kendi Tailscale adresinden gelen eşleştirme reddedilir", async () => {
    const o = kur();
    await o.baslat();
    o.eslestirmeKur();
    const { sonuc, ist } = await eslestir(o, KOD, SUNUCU_IP);
    assert.equal(sonuc, "ip_uyusmuyor");
    assert.equal(o.depo.cihazlar().length, 0);
    assert.equal(ist.tur("pair_result").filter((p) => p.ok).length, 0);
  });

  it("/cihaz'dan pair_request kabul edilmez", async () => {
    const o = kur();
    await o.baslat();
    o.eslestirmeKur();
    const ist = o.bagla("/cihaz");
    await ist.gonder({ v: 1, type: "pair_request", kod: KOD, public_key: TEL1.acik, platform: "android" });
    assert.ok(ist.kapali);
    assert.equal(o.depo.cihazlar().length, 0);
    assert.equal(ist.tur("pair_result").length, 0);
  });
});

// ---------------------------------------------------------------------------------------------
// Mesajlar ve ack
// ---------------------------------------------------------------------------------------------

describe("gateway: mesajlar", () => {
  it("kimlik öncesi user_message insanMesajiAl çağırmaz ve bağlantıyı kapatır", async () => {
    const o = await hazir();
    const ist = o.bagla("/sohbet");
    await ist.gonder(kullaniciMesaji("m1"));
    assert.equal(o.insanMesajlari.length, 0);
    assert.ok(ist.kapali);
    assert.equal(ist.tur("ack").length, 0);
  });

  it("kimlik öncesi diğer iş mesajları da işlenmez", async () => {
    const o = await hazir();
    const mesajlar = [
      { v: SOHBET_SURUMU, type: "interrupt", sohbet_id: "ana", client_msg_id: "i1" },
      { v: SOHBET_SURUMU, type: "plan_decision", client_msg_id: "p1", plan_id: "plan-1", plan_hash: "a".repeat(64), karar: "onay" },
      { v: SOHBET_SURUMU, type: "question_answer", client_msg_id: "q1", soru_id: "s1", cevap: "evet" },
      { v: SOHBET_SURUMU, type: "job_cancel", client_msg_id: "j1", is_id: 3 },
    ];
    for (const m of mesajlar) {
      const ist = o.bagla("/sohbet");
      await ist.gonder(m);
      assert.ok(ist.kapali, m.type);
    }
    assert.deepEqual(o.kesmeler, []);
    assert.equal(o.planKararlari.length, 0);
    assert.equal(o.soruCevaplari.length, 0);
    assert.equal(o.durdurmalar.length, 0);
  });

  it("/cihaz kimliksizken gelen user_message insanMesajiAl çağırmaz", async () => {
    const o = await hazir();
    const ist = o.bagla("/cihaz");
    await ist.gonder(kullaniciMesaji("m1", "merhaba", "yazi", 1));
    assert.equal(o.insanMesajlari.length, 0);
    assert.ok(ist.kapali);
  });

  it("kimliği bitmiş /cihaz'dan gelen user_message de insanMesajiAl çağırmaz", async () => {
    const o = await hazir();
    const ist = await o.giris("/cihaz");
    await ist.gonder(kullaniciMesaji("m1", "cihazdan gelen", "yazi", 1));
    assert.equal(o.insanMesajlari.length, 0);
    assert.equal(ist.tur("ack").length, 0);
    assert.equal(o.depo.basSeq(), 0);
    assert.equal(o.cihazGelen.length, 1, "çerçeve cihaz modülünün dinleyicisine gider");
  });

  it("user_message: insanMesajiAl doğru alanlarla çağrılır, ack ok + seq, user_echo olayı gelir", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(kullaniciMesaji("m1", "selam", "dikte"));
    assert.equal(o.insanMesajlari.length, 1);
    const m = o.insanMesajlari[0]!;
    assert.deepEqual(
      { device_id: m.device_id, client_msg_id: m.client_msg_id, input: m.input, text: m.text },
      { device_id: "tel-1", client_msg_id: "m1", input: "dikte", text: "selam" },
    );
    const ack = ist.tur("ack")[0]!;
    assert.deepEqual(ack, { v: SOHBET_SURUMU, type: "ack", client_msg_id: "m1", ok: true, seq: 1 });
    const olaylar = ist.tur("event").map((e) => e.event);
    assert.equal(olaylar.length, 1);
    assert.equal(olaylar[0].type, "user_echo");
    assert.equal(olaylar[0].seq, 1);
  });

  it("limit kilidi aktifken de user_message kabul edilir (kuyruğa girer)", async () => {
    const o = await hazir();
    o.d.kilit = { tur: "aktif", sifirlanmaMs: BASLANGIC + 1000, yuzde: 99 };
    const ist = await o.giris();
    await ist.gonder(kullaniciMesaji("m1"));
    assert.equal(o.insanMesajlari.length, 1);
    assert.equal(ist.tur("ack")[0]!.ok, true);
  });

  it("aynı client_msg_id ikinci kez işlenmez ve aynı ack döner", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(kullaniciMesaji("m1", "bir"));
    await ist.gonder(kullaniciMesaji("m1", "bir"));
    assert.equal(o.insanMesajlari.length, 1);
    const ackler = ist.tur("ack");
    assert.equal(ackler.length, 2);
    assert.deepEqual(ackler[1], ackler[0]);
    assert.equal(ist.tur("event").length, 1, "ikinci user_echo yok");
    assert.deepEqual(o.depo.ackBul("tel-1", "m1"), { ok: true, seq: 1 });
  });

  it("yeniden bağlanınca da aynı client_msg_id işlenmez", async () => {
    const o = await hazir();
    const a = await o.giris();
    await a.gonder(kullaniciMesaji("m1"));
    a.c.istemciKopar();
    const b = await o.giris("/sohbet", IP1, { last_seq: 1 });
    await b.gonder(kullaniciMesaji("m1"));
    assert.equal(o.insanMesajlari.length, 1);
    assert.deepEqual(b.tur("ack")[0], a.tur("ack")[0]);
  });

  it("aynı client_msg_id başka cihazda ayrı işlenir", async () => {
    const o = await hazir();
    const a = await o.giris("/sohbet", IP1);
    const b = await o.giris("/sohbet", IP2, { device_id: "tel-2", anahtar: TEL2.private });
    await a.gonder(kullaniciMesaji("m1", "bir"));
    await b.gonder(kullaniciMesaji("m1", "iki"));
    assert.equal(o.insanMesajlari.length, 2);
    assert.deepEqual(o.insanMesajlari.map((m) => m.device_id), ["tel-1", "tel-2"]);
  });

  it("interrupt: turn_id iletilir, ok ack; hata kodu ack'e taşınır ve tekrar işlenmez", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder({ v: SOHBET_SURUMU, type: "interrupt", sohbet_id: "ana", client_msg_id: "i1", turn_id: "tur-1" });
    await ist.gonder({ v: SOHBET_SURUMU, type: "interrupt", sohbet_id: "ana", client_msg_id: "i2" });
    assert.deepEqual(o.kesmeler, ["tur-1", undefined]);
    assert.equal(ist.tur("ack")[0]!.ok, true);
    o.d.kesSonuc = { ok: false, code: "tur_gecersiz" };
    await ist.gonder({ v: SOHBET_SURUMU, type: "interrupt", sohbet_id: "ana", client_msg_id: "i3", turn_id: "eski" });
    await ist.gonder({ v: SOHBET_SURUMU, type: "interrupt", sohbet_id: "ana", client_msg_id: "i3", turn_id: "eski" });
    const son = ist.tur("ack").filter((a) => a.client_msg_id === "i3");
    assert.equal(son.length, 2);
    assert.equal(son[0]!.ok, false);
    assert.equal(son[0]!.code, "tur_gecersiz");
    assert.deepEqual(son[1], son[0]);
    assert.equal(o.kesmeler.length, 3);
  });

  it("plan_decision: planlar.karar çağrılır; izin_bekleniyor ack olarak saklanır, tekrar çağrılmaz", async () => {
    const o = await hazir();
    const ist = await o.giris();
    const m = { v: SOHBET_SURUMU, type: "plan_decision", client_msg_id: "p1", plan_id: "plan-1", plan_hash: "a".repeat(64), karar: "onay" };
    await ist.gonder(m);
    assert.equal(o.planKararlari.length, 1);
    assert.equal(o.planKararlari[0]!.plan_id, "plan-1");
    assert.equal(o.planKararlari[0]!.plan_hash, "a".repeat(64));
    assert.equal(o.planKararlari[0]!.karar, "onay");
    assert.equal(ist.tur("ack")[0]!.ok, true);

    o.d.planSonuc = { ok: false, code: "izin_bekleniyor" };
    const m2 = { ...m, client_msg_id: "p2" };
    await ist.gonder(m2);
    await ist.gonder(m2);
    assert.equal(o.planKararlari.length, 2);
    const ackler = ist.tur("ack").filter((a) => a.client_msg_id === "p2");
    assert.equal(ackler.length, 2);
    assert.equal(ackler[0]!.code, "izin_bekleniyor");
    assert.deepEqual(ackler[1], ackler[0]);
    assert.deepEqual(o.depo.ackBul("tel-1", "p2"), { ok: false, code: "izin_bekleniyor" });
  });

  it("question_answer: soruCevapla(soru_id, cevap), hata kodu ack'te", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder({ v: SOHBET_SURUMU, type: "question_answer", client_msg_id: "q1", soru_id: "s1", cevap: "evet" });
    assert.deepEqual(o.soruCevaplari, [["s1", "evet"]]);
    assert.equal(ist.tur("ack")[0]!.ok, true);
    o.d.soruSonuc = { ok: false, code: "soru_zaten_cevaplandi" };
    await ist.gonder({ v: SOHBET_SURUMU, type: "question_answer", client_msg_id: "q2", soru_id: "s1", cevap: "hayir" });
    const a = ist.tur("ack")[1]!;
    assert.equal(a.ok, false);
    assert.equal(a.code, "soru_zaten_cevaplandi");
  });

  it("job_cancel: durdur(id, 'kullanici'); zaten_bitmis -> is_zaten_bitti; yok -> is_bulunamadi", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder({ v: SOHBET_SURUMU, type: "job_cancel", client_msg_id: "j1", is_id: 7 });
    assert.deepEqual(o.durdurmalar, [[7, "kullanici"]]);
    assert.equal(ist.tur("ack")[0]!.ok, true);

    o.d.durdurSonuc = { ok: true, deger: { is_id: 7, sonuc: "zaten_bitmis" } };
    await ist.gonder({ v: SOHBET_SURUMU, type: "job_cancel", client_msg_id: "j2", is_id: 7 });
    const b = ist.tur("ack")[1]!;
    assert.equal(b.ok, false);
    assert.equal(b.code, "is_zaten_bitti");

    o.d.durdurSonuc = { ok: false, code: "is_bulunamadi" };
    await ist.gonder({ v: SOHBET_SURUMU, type: "job_cancel", client_msg_id: "j3", is_id: 99 });
    const c = ist.tur("ack")[2]!;
    assert.equal(c.ok, false);
    assert.equal(c.code, "is_bulunamadi");
  });

  it("kimlik sonrası çözüm hatası error verir, bağlantı açık kalır; protokol_uyumsuz ve mesaj_cok_buyuk kapatır", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder("{bozuk");
    assert.equal(ist.hataKodu, "gecersiz_mesaj");
    assert.equal(ist.kapali, false);
    await ist.gonder(JSON.stringify({ ...kullaniciMesaji("m1"), fazla: true }));
    assert.equal(ist.tur("error").length, 2);
    assert.equal(ist.kapali, false);
    assert.equal(o.insanMesajlari.length, 0);

    await ist.gonder("x".repeat(AZAMI_CERCEVE.SOHBET + 1));
    assert.equal(ist.tur("error").at(-1)!.code, "mesaj_cok_buyuk");
    assert.ok(ist.kapali);

    const ikinci = await o.giris();
    await ikinci.gonder(JSON.stringify({ ...kullaniciMesaji("m1"), v: 1 }));
    assert.equal(ikinci.tur("error").at(-1)!.code, "protokol_uyumsuz");
    assert.ok(ikinci.kapali);
    assert.equal(o.insanMesajlari.length, 0);
  });
});

// ---------------------------------------------------------------------------------------------
// Telafi
// ---------------------------------------------------------------------------------------------

describe("gateway: last_seq telafisi", () => {
  const olayEkle = (o: Ortam, n: number): void => {
    for (let i = 0; i < n; i++) {
      o.depoGercek.olayEkle({ type: "user_echo", sohbet_id: "ana", client_msg_id: `e${i}`, input: "yazi", text: `m${i}` });
    }
  };

  it("sıra: welcome(head_seq), eksik event'ler artan, server_status; last_seq'ten sonrası gelir", async () => {
    const o = await hazir();
    olayEkle(o, 7);
    const ist = await o.giris("/sohbet", IP1, { last_seq: 3 });
    assert.deepEqual(ist.turler, ["auth_challenge", "welcome", "event", "event", "event", "event", "server_status"]);
    assert.equal(ist.tur("welcome")[0]!.head_seq, 7);
    assert.deepEqual(ist.tur("event").map((e) => e.event.seq), [4, 5, 6, 7]);
    assert.deepEqual(ist.tur("event").map((e) => e.event), o.depo.olaylariGetir(3, 100));
  });

  it("last_seq=0 hepsini, head_seq'e eşitse hiçbirini yollamaz; head'den büyük last_seq çökertmez", async () => {
    const o = await hazir();
    olayEkle(o, 5);
    const a = await o.giris("/sohbet", IP1, { last_seq: 0 });
    assert.deepEqual(a.tur("event").map((e) => e.event.seq), [1, 2, 3, 4, 5]);
    const b = await o.giris("/sohbet", IP1, { last_seq: 5 });
    assert.equal(b.tur("event").length, 0);
    assert.equal(b.tur("welcome")[0]!.head_seq, 5);
    const c = await o.giris("/sohbet", IP1, { last_seq: 999 });
    assert.equal(c.tur("event").length, 0);
    assert.equal(c.kapali, false);
  });

  it("çok olayda partiler halinde gelir: hepsi bir kez, artan sırada, eksiksiz", async () => {
    const o = await hazir();
    olayEkle(o, 600);
    const ist = await o.giris();
    const seqler = ist.tur("event").map((e) => e.event.seq as number);
    assert.deepEqual(seqler, Array.from({ length: 600 }, (_, i) => i + 1));
    assert.equal(ist.turler.at(-1), "server_status");
  });

  it("telafi sürerken yazılan olay tekrarsız ve eksiksiz gider", async () => {
    let enjekte = false;
    const o = await hazir({
      sarmala: (depo) =>
        new Proxy(depo, {
          get(hedef, ad) {
            if (ad === "olaylariGetir") {
              return (sonSeq: number, adet: number) => {
                const sonuc = hedef.olaylariGetir(sonSeq, adet);
                if (!enjekte) {
                  enjekte = true;
                  hedef.olayEkle({ type: "user_echo", sohbet_id: "ana", client_msg_id: "yaris", input: "yazi", text: "yaris" });
                }
                return sonuc;
              };
            }
            const v = (hedef as unknown as Record<string | symbol, unknown>)[ad];
            return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(hedef) : v;
          },
        }),
    });
    olayEkle(o, 250);
    const ist = await o.giris();
    assert.equal(enjekte, true, "telafi olaylariGetir kullanmadı");
    const seqler = ist.tur("event").map((e) => e.event.seq as number);
    assert.equal(new Set(seqler).size, seqler.length, `yinelenen seq: ${seqler.join(",")}`);
    assert.deepEqual([...seqler].sort((x, y) => x - y), seqler, "sıra bozuk");
    assert.deepEqual(seqler, Array.from({ length: 251 }, (_, i) => i + 1), "eksik olay");
  });

  it("canlı olay_yazildi doğrulanmış her /sohbet bağlantısına bir kez gider", async () => {
    const o = await hazir();
    const a = await o.giris("/sohbet", IP1);
    const b = await o.giris("/sohbet", IP2, { device_id: "tel-2", anahtar: TEL2.private });
    olayEkle(o, 2);
    for (const ist of [a, b]) {
      assert.deepEqual(ist.tur("event").map((e) => e.event.seq), [1, 2]);
    }
    a.c.istemciKopar();
    olayEkle(o, 1);
    assert.equal(a.tur("event").length, 2);
    assert.equal(b.tur("event").length, 3);
  });

  it("kopuk bağlantı yeniden bağlanınca kaçırdığını last_seq ile alır, öncekini tekrar almaz", async () => {
    const o = await hazir();
    const a = await o.giris();
    olayEkle(o, 2);
    a.c.istemciKopar();
    olayEkle(o, 3);
    const b = await o.giris("/sohbet", IP1, { last_seq: 2 });
    assert.deepEqual(b.tur("event").map((e) => e.event.seq), [3, 4, 5]);
    olayEkle(o, 1);
    assert.deepEqual(b.tur("event").map((e) => e.event.seq), [3, 4, 5, 6]);
  });

  it("kimliği bitmemiş bağlantıya canlı olay gitmez; /cihaz bağlantısına hiç gitmez", async () => {
    const o = await hazir();
    const yarim = o.bagla("/sohbet");
    await yarim.gonder({ v: SOHBET_SURUMU, type: "hello", device_id: "tel-1", last_seq: 0, client_nonce: ISTEMCI_NONCE });
    const cihaz = await o.giris("/cihaz");
    const onceki = cihaz.kare.length;
    olayEkle(o, 2);
    assert.equal(yarim.tur("event").length, 0);
    assert.equal(cihaz.kare.length, onceki);
  });
});

// ---------------------------------------------------------------------------------------------
// Akış
// ---------------------------------------------------------------------------------------------

describe("gateway: akış (snapshot + delta)", () => {
  it("aktif tur varsa event'lerden sonra, server_status'tan önce stream_snapshot gider", async () => {
    const o = await hazir();
    o.depoGercek.olayEkle({ type: "user_echo", sohbet_id: "ana", client_msg_id: "e0", input: "yazi", text: "x" });
    o.d.tur = { turn_id: "tur-1", text: "merhaba" };
    const ist = await o.giris();
    assert.deepEqual(ist.turler, ["auth_challenge", "welcome", "event", "stream_snapshot", "server_status"]);
    const s = ist.tur("stream_snapshot")[0]!;
    assert.equal(s.turn_id, "tur-1");
    assert.equal(s.text, "merhaba");
  });

  it("aktif tur yoksa snapshot yok", async () => {
    const o = await hazir();
    const ist = await o.giris();
    assert.equal(ist.tur("stream_snapshot").length, 0);
  });

  it("delta, snapshot'ın bittiği offset'ten devam eder: istemci metni tutarlı kurulur", async () => {
    const o = await hazir();
    o.d.tur = { turn_id: "tur-1", text: "merhaba" };
    const a = await o.giris("/sohbet", IP1);
    const yaz = (offset: number, text: string): void => {
      o.d.tur = { turn_id: "tur-1", text: o.d.tur!.text + text };
      o.veriyolu.yayinla("tur_delta", { sohbet_id: "ana", turn_id: "tur-1", offset, text });
    };
    yaz(7, " dunya");
    const b = await o.giris("/sohbet", IP2, { device_id: "tel-2", anahtar: TEL2.private });
    assert.equal(b.tur("stream_snapshot")[0]!.text, "merhaba dunya");
    yaz(13, "!");

    const kur = (ist: Ist): string => {
      let metin = "";
      for (const k of ist.kare) {
        if (k.type === "stream_snapshot") metin = k.text;
        if (k.type === "assistant_delta") {
          assert.equal(k.turn_id, "tur-1");
          assert.equal(k.offset, metin.length, "delta offset'i metin uzunluğuna oturmuyor");
          metin += k.text;
        }
      }
      return metin;
    };
    assert.equal(kur(a), "merhaba dunya!");
    assert.equal(kur(b), "merhaba dunya!");
    assert.deepEqual(
      b.tur("assistant_delta").map((x) => [x.offset, x.text]),
      [[13, "!"]],
    );
  });

  it("kimliği bitmemiş ve /cihaz bağlantılarına delta gitmez", async () => {
    const o = await hazir();
    o.d.tur = { turn_id: "tur-1", text: "a" };
    const yarim = o.bagla("/sohbet");
    await yarim.gonder({ v: SOHBET_SURUMU, type: "hello", device_id: "tel-1", last_seq: 0, client_nonce: ISTEMCI_NONCE });
    const cihaz = await o.giris("/cihaz");
    const onceki = cihaz.kare.length;
    o.veriyolu.yayinla("tur_delta", { sohbet_id: "ana", turn_id: "tur-1", offset: 1, text: "b" });
    assert.equal(yarim.tur("assistant_delta").length, 0);
    assert.equal(cihaz.kare.length, onceki);
  });

  it("delta kalıcı değildir: kopukken atılır, yeni bağlantı onu geri oynatmaz, depoya yazılmaz", async () => {
    const o = await hazir();
    o.d.tur = { turn_id: "tur-1", text: "ab" };
    const seqOnce = o.depo.basSeq();
    o.veriyolu.yayinla("tur_delta", { sohbet_id: "ana", turn_id: "tur-1", offset: 0, text: "ab" });
    const ist = await o.giris();
    assert.equal(ist.tur("assistant_delta").length, 0);
    assert.equal(ist.tur("stream_snapshot")[0]!.text, "ab");
    assert.equal(o.depo.basSeq(), seqOnce);
  });

  it("telafi sırasında gelen delta snapshot'tan önce gitmez", async () => {
    const o = await hazir();
    o.d.tur = { turn_id: "tur-1", text: "abc" };
    const asil = o.d;
    // aktifTur çağrısı sırasında (snapshot kurulurken) bir delta yayınlanır.
    let bir = false;
    const sarili = o.d as Durum & { tur: AktifTur | null };
    Object.defineProperty(sarili, "tur", {
      get() {
        if (!bir) {
          bir = true;
          o.veriyolu.yayinla("tur_delta", { sohbet_id: "ana", turn_id: "tur-1", offset: 3, text: "d" });
        }
        return { turn_id: "tur-1", text: "abc" };
      },
    });
    assert.equal(asil, sarili);
    const ist = await o.giris();
    const sira = ist.turler.filter((t) => t === "stream_snapshot" || t === "assistant_delta");
    assert.notEqual(sira[0], "assistant_delta", `delta snapshot'tan önce gitti: ${sira.join(",")}`);
  });
});

// ---------------------------------------------------------------------------------------------
// server_status
// ---------------------------------------------------------------------------------------------

describe("gateway: server_status", () => {
  const durumlar = (ist: Ist): Msg[] => ist.tur("server_status");
  const son = (ist: Ist): Msg => durumlar(ist).at(-1)!;
  const alanlar = (m: Msg) => ({
    eren: m.sohbetler.find((x: Msg) => x.sohbet_id === "ana")?.eren,
    kilitli: m.kilitli,
    aktif_is: m.aktif_is,
    ram_bos_mb: m.ram_bos_mb,
    ram_toplam_mb: m.ram_toplam_mb,
    ram_dusuk: m.ram_dusuk,
  });

  it("girişte güncel durum yollanır", async () => {
    const o = await hazir();
    o.d.eren = "tur_suruyor";
    o.d.aktifIs = 2;
    const ist = await o.giris();
    assert.deepEqual(alanlar(son(ist)), {
      eren: "tur_suruyor",
      kilitli: false,
      aktif_is: 2,
      ram_bos_mb: 8000,
      ram_toplam_mb: 16000,
      ram_dusuk: false,
    });
  });

  it("eren_durumu tetikler", async () => {
    const o = await hazir();
    const ist = await o.giris();
    const once = durumlar(ist).length;
    o.d.eren = "kapali";
    o.veriyolu.yayinla("eren_durumu", { sohbet_id: "ana", durum: "kapali" });
    assert.ok(durumlar(ist).length > once);
    assert.equal(son(ist).sohbetler.find((x: Msg) => x.sohbet_id === "ana")?.eren, "kapali");
  });

  it("kilit_degisti tetikler: kilitli yalnız serbest değilken doğru", async () => {
    const o = await hazir();
    const ist = await o.giris();
    const dene = (durum: LimitKilitDurumu, beklenen: boolean): void => {
      const once = durumlar(ist).length;
      o.d.kilit = durum;
      o.veriyolu.yayinla("kilit_degisti", { durum });
      assert.ok(durumlar(ist).length > once, JSON.stringify(durum));
      assert.equal(son(ist).kilitli, beklenen, JSON.stringify(durum));
    };
    dene({ tur: "aktif", sifirlanmaMs: BASLANGIC + 5000, yuzde: 97 }, true);
    dene({ tur: "belirsiz", neden: "bozuk" }, true);
    dene({ tur: "serbest" }, false);
  });

  it("is_sayisi_degisti tetikler", async () => {
    const o = await hazir();
    const ist = await o.giris();
    const once = durumlar(ist).length;
    o.d.aktifIs = 3;
    o.veriyolu.yayinla("is_sayisi_degisti", { aktif: 3 });
    assert.ok(durumlar(ist).length > once);
    assert.equal(son(ist).aktif_is, 3);
  });

  it("ram_degisti tetikler", async () => {
    const o = await hazir();
    const ist = await o.giris();
    const once = durumlar(ist).length;
    o.d.ram = { bosMb: 512, toplamMb: 16000, dusuk: true };
    o.veriyolu.yayinla("ram_degisti", { ram: o.d.ram });
    assert.ok(durumlar(ist).length > once);
    assert.equal(son(ist).ram_bos_mb, 512);
    assert.equal(son(ist).ram_toplam_mb, 16000);
    assert.equal(son(ist).ram_dusuk, true);
  });

  it("durum bütün doğrulanmış /sohbet bağlantılarına gider; yarım ve /cihaz bağlantısına gitmez", async () => {
    const o = await hazir();
    const a = await o.giris("/sohbet", IP1);
    const b = await o.giris("/sohbet", IP2, { device_id: "tel-2", anahtar: TEL2.private });
    const yarim = o.bagla("/sohbet", "100.64.0.30");
    const cihaz = await o.giris("/cihaz");
    const sa = durumlar(a).length;
    const sb = durumlar(b).length;
    const kc = cihaz.kare.length;
    o.d.aktifIs = 1;
    o.veriyolu.yayinla("is_sayisi_degisti", { aktif: 1 });
    assert.ok(durumlar(a).length > sa);
    assert.ok(durumlar(b).length > sb);
    assert.equal(durumlar(yarim).length, 0);
    assert.equal(cihaz.kare.length, kc);
  });

  it("limit_dolulugu son değer olarak tutulur ve server_status.limit'e girer", async () => {
    const o = await hazir();
    const ist = await o.giris();
    assert.equal(son(ist).limit, undefined);
    o.veriyolu.yayinla("limit_dolulugu", {
      doluluk: {
        besSaat: { yuzde: 42, sifirlanmaMs: BASLANGIC + 1000 },
        yediGun: { yuzde: 10, sifirlanmaMs: BASLANGIC + 2000 },
        olcumMs: BASLANGIC,
      },
    });
    o.veriyolu.yayinla("is_sayisi_degisti", { aktif: 0 });
    const l = son(ist).limit;
    assert.ok(l, "limit alanı yok");
    assert.equal(l.bes_saat, 0.42);
    assert.equal(l.bes_saat_sifirlanma_ms, BASLANGIC + 1000);
    assert.equal(l.haftalik, 0.1);
    assert.equal(l.haftalik_sifirlanma_ms, BASLANGIC + 2000);

    const yeni = await o.giris();
    assert.equal(son(yeni).limit?.bes_saat, 0.42, "yeni bağlantı son değeri almalı");
  });
});

// ---------------------------------------------------------------------------------------------
// Hata çıktısı ve günlük
// ---------------------------------------------------------------------------------------------

describe("gateway: gelen değer yankılanmaz", () => {
  const SIR = "SIRDEGERXYZ";

  it("kimlik öncesi hatalarda giden çerçevede ve günlükte gelen değer yok", async () => {
    const o = await hazir();
    const ham = [
      `{"v":${SOHBET_SURUMU},"type":"hello","device_id":"${SIR}-id","last_seq":"${SIR}-seq","client_nonce":"${SIR}"}`,
      `{"v":987654,"type":"hello","x":"${SIR}"}`,
      `{"v":${SOHBET_SURUMU},"type":"${SIR}"}`,
      `{"${SIR}`,
      JSON.stringify({ v: SOHBET_SURUMU, type: "hello", device_id: `${SIR}-bilinmeyen`, last_seq: 0, client_nonce: ISTEMCI_NONCE }),
      JSON.stringify({ v: 1, type: "pair_request", kod: `${SIR}!`, public_key: TEL1.acik, platform: "android" }),
    ];
    for (const h of ham) {
      const ist = o.bagla("/sohbet");
      await ist.gonder(h);
      assert.ok(ist.hataKodu !== undefined || ist.tur("pair_result").length > 0, h.slice(0, 40));
      assert.ok(!ist.ham.includes(SIR), `yankılandı: ${ist.ham}`);
      assert.ok(!ist.ham.includes("987654"), `sürüm yankılandı: ${ist.ham}`);
    }
    const log = JSON.stringify(o.gunluk.girdiler);
    assert.ok(!log.includes(SIR), "günlüğe gelen değer girdi");
    assert.ok(!log.includes("987654"));
  });

  it("kimlik sonrası hatalarda gelen değer yok", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(JSON.stringify({ ...kullaniciMesaji(`${SIR}!`), text: 5 }));
    await ist.gonder(JSON.stringify({ ...kullaniciMesaji("m1", `${SIR}`), alan: `${SIR}` }));
    await ist.gonder(`{"v":${SOHBET_SURUMU},"type":"user_message","client_msg_id":"${SIR}`);
    await ist.gonder(JSON.stringify({ v: 987654, type: "interrupt", sohbet_id: "ana", client_msg_id: SIR }));
    assert.ok(ist.tur("error").length >= 3);
    assert.ok(!ist.ham.includes(SIR), `yankılandı: ${ist.ham}`);
    assert.ok(!ist.ham.includes("987654"));
    assert.ok(!JSON.stringify(o.gunluk.girdiler).includes(SIR));
  });

  it("geçerli kullanıcı metni günlüğe yazılmaz", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(kullaniciMesaji("m1", "GIZLIMETINABC"));
    await ist.gonder({ v: SOHBET_SURUMU, type: "question_answer", client_msg_id: "q1", soru_id: "s1", cevap: "GIZLICEVAPABC" });
    const log = JSON.stringify(o.gunluk.girdiler);
    assert.ok(!log.includes("GIZLIMETINABC"));
    assert.ok(!log.includes("GIZLICEVAPABC"));
  });

  it("imza hatasında hata çerçevesi imzayı ve nonce'u taşımaz", async () => {
    const o = await hazir();
    const ist = o.bagla("/sohbet");
    const sahteImza = Buffer.from("SIRIMZA-bozuk").toString("base64");
    await elSik(ist, { imza: sahteImza });
    reddedildi(ist, "imza_gecersiz");
    const hata = ist.tur("error")[0]!;
    assert.deepEqual(Object.keys(hata).sort(), ["code", "type", "v"].concat(hata.detail === undefined ? [] : ["detail"]).sort());
    assert.ok(!JSON.stringify(hata).includes(sahteImza));
    assert.ok(!JSON.stringify(hata).includes(ISTEMCI_NONCE));
    assert.ok(!JSON.stringify(o.gunluk.girdiler).includes(sahteImza));
  });
});

// ---------------------------------------------------------------------------------------------
// Dilim 1: sürüm (kanal başına), servis bilgisi, chat_clear
// ---------------------------------------------------------------------------------------------

describe("gateway: Dilim 1, çerçeve sürümü", () => {
  it("sözleşme: /sohbet sürümü 4 (dilim 3b)", () => {
    assert.equal(SOHBET_SURUMU, 4);
  });

  it("/sohbet'e giden her çerçeve türü SOHBET_SURUMU: auth_challenge, welcome, event, stream_snapshot, server_status, ack, assistant_delta", async () => {
    const o = await hazir();
    o.depoGercek.olayEkle({ type: "user_echo", sohbet_id: "ana", client_msg_id: "e0", input: "yazi", text: "x" });
    o.d.tur = { turn_id: "tur-1", text: "ab" };
    const ist = await o.giris();
    await ist.gonder(kullaniciMesaji("m1"));
    o.veriyolu.yayinla("tur_delta", { sohbet_id: "ana", turn_id: "tur-1", offset: 2, text: "c" });
    for (const t of ["auth_challenge", "welcome", "event", "stream_snapshot", "server_status", "ack", "assistant_delta"]) {
      const kareler = ist.hamTur(t);
      assert.ok(kareler.length > 0, `${t} gelmedi`);
      for (const k of kareler) assert.equal(k.v, SOHBET_SURUMU, `${t} v${SOHBET_SURUMU} değil`);
    }
    // Hiçbir çerçeve v1 değil (pair_result bu bağlantıda yok).
    assert.ok(ist.hamKareler.every((k) => k.v === SOHBET_SURUMU));
  });

  it("kimlik öncesi error SOHBET_SURUMU (çözüm hatası, kimlik hatası, sıra hatası)", async () => {
    const o = await hazir();
    const ham = [
      "{bozuk",
      JSON.stringify({ v: SOHBET_SURUMU, type: "bilinmeyen_tur" }),
      JSON.stringify({ v: SOHBET_SURUMU, type: "auth_response", signature: "x" }),
    ];
    for (const h of ham) {
      const ist = o.bagla("/sohbet");
      await ist.gonder(h);
      const e = ist.hamTur("error");
      assert.equal(e.length, 1, h);
      assert.equal(e[0]!.v, SOHBET_SURUMU, `error v${SOHBET_SURUMU} değil: ${h}`);
      assert.ok(ist.kapali);
    }
    const imzasiz = o.bagla("/sohbet");
    await elSik(imzasiz, { anahtar: YABANCI.private });
    assert.equal(imzasiz.hamTur("error")[0]!.v, SOHBET_SURUMU, "imza_gecersiz error SOHBET_SURUMU değil");
    const bilinmeyen = o.bagla("/sohbet");
    await elSik(bilinmeyen, { device_id: "yok-1" });
    assert.equal(bilinmeyen.hamTur("error")[0]!.v, SOHBET_SURUMU, "cihaz_bilinmiyor error SOHBET_SURUMU değil");
  });

  it("kimlik sonrası error de SOHBET_SURUMU", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder("{bozuk");
    assert.equal(ist.hamTur("error").at(-1)!.v, SOHBET_SURUMU);
  });

  it("pair_result v1 (başarı ve hata), pair_request v1 kabul edilir", async () => {
    const o = kur();
    await o.baslat();
    const sor = async (kod: string, ip = IP1): Promise<Msg> => {
      const ist = o.bagla("/sohbet", ip);
      await ist.gonder({ v: 1, type: "pair_request", kod, public_key: TEL1.acik, platform: "android" });
      const pr = ist.hamTur("pair_result");
      assert.equal(pr.length, 1);
      return pr[0]!;
    };
    o.eslestirmeKur();
    const kotu = await sor("ZZZZZZ");
    assert.equal(kotu.v, 1);
    assert.equal(kotu.ok, false);
    assert.equal(kotu.code, "eslestirme_kodu_gecersiz");
    const iyi = await sor(KOD);
    assert.equal(iyi.v, 1);
    assert.equal(iyi.ok, true);
    const kapali = await sor(KOD, IP2);
    assert.equal(kapali.v, 1);
    assert.equal(kapali.code, "eslestirme_kapali");
  });

  it("/cihaz'a giden auth_challenge, welcome ve error v1", async () => {
    const o = await hazir();
    const ist = await o.giris("/cihaz");
    assert.ok(ist.hamKareler.length >= 2);
    assert.ok(ist.hamKareler.every((k) => k.v === 1), JSON.stringify(ist.hamKareler.map((k) => [k.type, k.v])));
    assert.equal(ist.hamTur("auth_challenge")[0]!.v, 1);
    assert.equal(ist.hamTur("welcome")[0]!.v, 1);

    const kotu = o.bagla("/cihaz");
    await elSik(kotu, { device_id: "yok-1" });
    assert.equal(kotu.hamTur("error")[0]!.v, 1);
    const bozuk = o.bagla("/cihaz");
    await bozuk.gonder("{bozuk");
    assert.equal(bozuk.hamTur("error")[0]!.v, 1);
  });

  it("v1 hello /sohbet'te protokol_uyumsuz: SOHBET_SURUMU error + kapanış, auth_challenge yok", async () => {
    const o = await hazir();
    const ist = o.bagla("/sohbet");
    await ist.gonder({ v: 1, type: "hello", device_id: "tel-1", last_seq: 0, client_nonce: ISTEMCI_NONCE });
    const e = ist.hamTur("error");
    assert.equal(e.length, 1);
    assert.equal(e[0]!.v, SOHBET_SURUMU);
    assert.equal(e[0]!.code, "protokol_uyumsuz");
    assert.ok(ist.kapali);
    assert.equal(ist.hamTur("auth_challenge").length, 0);
    assert.equal(ist.hamTur("welcome").length, 0);
  });

  it("v2 hello /cihaz'da protokol_uyumsuz (v1 error)", async () => {
    const o = await hazir();
    const ist = o.bagla("/cihaz");
    await ist.gonder({ v: 2, type: "hello", device_id: "tel-1", client_nonce: ISTEMCI_NONCE });
    assert.equal(ist.hamTur("error")[0]!.v, 1);
    assert.equal(ist.hamTur("error")[0]!.code, "protokol_uyumsuz");
    assert.ok(ist.kapali);
  });
});

describe("gateway: Dilim 1, server_status.servis", () => {
  it("girişte server_status.servis = ayar.servis", async () => {
    const o = await hazir();
    const ist = await o.giris();
    const s = ist.tur("server_status").at(-1)!;
    assert.deepEqual(s.servis, SERVIS);
  });

  it("her yeni server_status'ta servis var (tetikler dahil)", async () => {
    const o = await hazir();
    const ist = await o.giris();
    o.d.aktifIs = 2;
    o.veriyolu.yayinla("is_sayisi_degisti", { aktif: 2 });
    o.d.eren = "kapali";
    o.veriyolu.yayinla("eren_durumu", { sohbet_id: "ana", durum: "kapali" });
    const durumlar = ist.tur("server_status");
    assert.ok(durumlar.length >= 3);
    for (const d of durumlar) assert.deepEqual(d.servis, SERVIS);
  });

  it("geliştirme kopyasında surum null olarak aynen gider", async () => {
    const servis: ServisBilgisi = { surum: null, baslangic_ms: BASLANGIC };
    const o = await hazir({ servis });
    const ist = await o.giris();
    assert.deepEqual(ist.tur("server_status").at(-1)!.servis, servis);
  });
});

describe("gateway: Dilim 1, chat_clear", () => {
  const temizle = (id: string): object => ({ v: SOHBET_SURUMU, type: "chat_clear", sohbet_id: "ana", client_msg_id: id });

  it("doğrulanmış /sohbet: gecmisiSil çağrılır, ack ok + mezar taşı seq'i, ack saklanır", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(temizle("c1"));
    assert.equal(o.temizlikCagrilari.length, 1);
    const ackler = ist.tur("ack");
    assert.equal(ackler.length, 1);
    assert.deepEqual(ackler[0], { v: SOHBET_SURUMU, type: "ack", client_msg_id: "c1", ok: true, seq: MEZAR_SEQ });
    assert.deepEqual(o.depo.ackBul("tel-1", "c1"), { ok: true, seq: MEZAR_SEQ });
    assert.equal(ist.kapali, false);
    assert.equal(o.insanMesajlari.length, 0, "chat_clear insan mesajı değildir");
  });

  it("sohbet_mesgul ack'e yansır ve saklanır", async () => {
    const o = await hazir();
    o.d.temizlikSonuc = { ok: false, code: "sohbet_mesgul" };
    const ist = await o.giris();
    await ist.gonder(temizle("c1"));
    assert.equal(o.temizlikCagrilari.length, 1);
    const a = ist.tur("ack")[0]!;
    assert.equal(a.ok, false);
    assert.equal(a.code, "sohbet_mesgul");
    assert.equal(a.seq, undefined);
    assert.deepEqual(o.depo.ackBul("tel-1", "c1"), { ok: false, code: "sohbet_mesgul" });
    assert.equal(ist.kapali, false);
  });

  it("ic_hata ack'e yansır ve saklanır", async () => {
    const o = await hazir();
    o.d.temizlikSonuc = { ok: false, code: "ic_hata" };
    const ist = await o.giris();
    await ist.gonder(temizle("c1"));
    const a = ist.tur("ack")[0]!;
    assert.equal(a.ok, false);
    assert.equal(a.code, "ic_hata");
    assert.deepEqual(o.depo.ackBul("tel-1", "c1"), { ok: false, code: "ic_hata" });
  });

  it("aynı client_msg_id ikinci kez gecmisiSil çağırmaz, aynı ack döner", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(temizle("c1"));
    await ist.gonder(temizle("c1"));
    assert.equal(o.temizlikCagrilari.length, 1);
    const ackler = ist.tur("ack");
    assert.equal(ackler.length, 2);
    assert.deepEqual(ackler[1], ackler[0]);
  });

  it("reddedilmiş chat_clear de tekrarda işlenmez; yeni client_msg_id yeniden dener", async () => {
    const o = await hazir();
    o.d.temizlikSonuc = { ok: false, code: "sohbet_mesgul" };
    const ist = await o.giris();
    await ist.gonder(temizle("c1"));
    o.d.temizlikSonuc = { ok: true, deger: { mezar_seq: MEZAR_SEQ, sinir_seq: MEZAR_SEQ - 1 } };
    await ist.gonder(temizle("c1"));
    assert.equal(o.temizlikCagrilari.length, 1);
    assert.equal(ist.tur("ack")[1]!.code, "sohbet_mesgul");
    await ist.gonder(temizle("c2"));
    assert.equal(o.temizlikCagrilari.length, 2);
    assert.equal(ist.tur("ack")[2]!.ok, true);
  });

  it("yeniden bağlanınca da aynı client_msg_id işlenmez", async () => {
    const o = await hazir();
    const a = await o.giris();
    await a.gonder(temizle("c1"));
    a.c.istemciKopar();
    const b = await o.giris("/sohbet", IP1, { last_seq: 0 });
    await b.gonder(temizle("c1"));
    assert.equal(o.temizlikCagrilari.length, 1);
    assert.deepEqual(b.tur("ack")[0], a.tur("ack")[0]);
  });

  it("aynı client_msg_id başka cihazda ayrı işlenir", async () => {
    const o = await hazir();
    const a = await o.giris("/sohbet", IP1);
    const b = await o.giris("/sohbet", IP2, { device_id: "tel-2", anahtar: TEL2.private });
    await a.gonder(temizle("c1"));
    await b.gonder(temizle("c1"));
    assert.equal(o.temizlikCagrilari.length, 2);
  });

  it("kimlik öncesi chat_clear kabul edilmez: temizlik çağrılmaz, ack yok, bağlantı kapanır", async () => {
    const o = await hazir();
    const ist = o.bagla("/sohbet");
    await ist.gonder(temizle("c1"));
    assert.equal(o.temizlikCagrilari.length, 0);
    assert.ok(ist.kapali);
    assert.equal(ist.tur("ack").length, 0);

    // hello sonrası, auth_response öncesi de aynı.
    const yarim = o.bagla("/sohbet");
    await yarim.gonder(helloMesaji("/sohbet"));
    await yarim.gonder(temizle("c2"));
    assert.equal(o.temizlikCagrilari.length, 0);
    assert.ok(yarim.kapali);
    assert.equal(yarim.tur("ack").length, 0);
    assert.equal(yarim.tur("welcome").length, 0);
    assert.equal(o.depo.ackBul("tel-1", "c1"), null);
    assert.equal(o.depo.ackBul("tel-1", "c2"), null);
  });

  it("/cihaz'dan chat_clear temizliği tetiklemez (kimlik öncesi ve sonrası)", async () => {
    const o = await hazir();
    const oncesi = o.bagla("/cihaz");
    await oncesi.gonder({ v: 1, type: "chat_clear", sohbet_id: "ana", client_msg_id: "c1" });
    assert.ok(oncesi.kapali);
    const sonrasi = await o.giris("/cihaz");
    await sonrasi.gonder({ v: 1, type: "chat_clear", sohbet_id: "ana", client_msg_id: "c2" });
    await sonrasi.gonder(temizle("c3"));
    assert.equal(o.temizlikCagrilari.length, 0);
    assert.equal(sonrasi.tur("ack").length, 0);
  });

  it("başarısız el sıkışmadan sonra gelen chat_clear işlenmez", async () => {
    const o = await hazir();
    const ist = o.bagla("/sohbet");
    await elSik(ist, { anahtar: YABANCI.private });
    await ist.gonder(temizle("c1"));
    assert.equal(o.temizlikCagrilari.length, 0);
  });
});

// ---------------------------------------------------------------------------------------------
// Dilim 2: çoklu sohbet
// ---------------------------------------------------------------------------------------------

const yeniSohbet = (id: string, sohbet_id: string, ad = "Yeni sohbet"): object => ({
  v: SOHBET_SURUMU,
  type: "chat_create",
  client_msg_id: id,
  sohbet_id,
  ad,
});
const sohbetSil = (id: string, sohbet_id: string): object => ({
  v: SOHBET_SURUMU,
  type: "chat_delete",
  client_msg_id: id,
  sohbet_id,
});
const sohbetAdla = (id: string, sohbet_id: string, ad: string): object => ({
  v: SOHBET_SURUMU,
  type: "chat_rename",
  client_msg_id: id,
  sohbet_id,
  ad,
});
const sohbetTemizle = (id: string, sohbet_id: string): object => ({
  v: SOHBET_SURUMU,
  type: "chat_clear",
  client_msg_id: id,
  sohbet_id,
});
const ackOf = (ist: Ist, id: string): Msg => ist.tur("ack").find((a) => a.client_msg_id === id)!;

describe("gateway: Dilim 2, sürüm ve sohbet yönlendirme", () => {
  it("v2 çerçeve reddedilir: protokol_uyumsuz, kapanış (hello ve kimlik sonrası iş mesajı)", async () => {
    const o = await hazir();
    const hello = o.bagla("/sohbet");
    await hello.gonder({ v: 2, type: "hello", device_id: "tel-1", last_seq: 0, client_nonce: ISTEMCI_NONCE });
    assert.equal(hello.hataKodu, "protokol_uyumsuz");
    assert.ok(hello.kapali);
    assert.equal(hello.hamTur("auth_challenge").length, 0);

    const ist = await o.giris();
    await ist.gonder({ v: 2, type: "user_message", client_msg_id: "m1", input: "yazi", text: "x" });
    assert.equal(ist.tur("error").at(-1)!.code, "protokol_uyumsuz");
    assert.ok(ist.kapali);
    assert.equal(o.insanMesajlari.length, 0);
  });

  it("v3'te sohbet_id'siz user_message gecersiz_mesaj olur, bağlantı açık kalır", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder({ v: SOHBET_SURUMU, type: "user_message", client_msg_id: "m1", input: "yazi", text: "x" });
    assert.equal(ist.hataKodu, "gecersiz_mesaj");
    assert.equal(ist.kapali, false);
    assert.equal(o.insanMesajlari.length, 0);
  });

  it("user_message doğru sohbete gider: insanMesajiAl sohbet_id taşır, user_echo o sohbetin olayıdır", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(yeniSohbet("c0", "is"));
    await ist.gonder(kullaniciMesaji("m1", "selam", "yazi", SOHBET_SURUMU, "is"));
    await ist.gonder(kullaniciMesaji("m2", "ana mesaj", "yazi", SOHBET_SURUMU, "ana"));
    assert.deepEqual(
      o.insanMesajlari.map((m) => [m.client_msg_id, m.sohbet_id, m.device_id]),
      [
        ["m1", "is", "tel-1"],
        ["m2", "ana", "tel-1"],
      ],
    );
    assert.ok([ackOf(ist, "m1"), ackOf(ist, "m2")].every((a) => a.ok === true && typeof a.seq === "number"));
    const yankilar = ist
      .tur("event")
      .map((e) => e.event)
      .filter((e) => e.type === "user_echo");
    assert.deepEqual(yankilar.map((e) => e.sohbet_id), ["is", "ana"]);
  });

  it("bilinmeyen sohbete user_message: sohbet_bulunamadi, insanMesajiAl çağrılmaz, ack saklanır, tekrarda aynı", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(kullaniciMesaji("m1", "x", "yazi", SOHBET_SURUMU, "yok-1"));
    await ist.gonder(kullaniciMesaji("m1", "x", "yazi", SOHBET_SURUMU, "yok-1"));
    assert.equal(o.insanMesajlari.length, 0);
    const a = ist.tur("ack");
    assert.equal(a.length, 2);
    assert.equal(a[0]!.ok, false);
    assert.equal(a[0]!.code, "sohbet_bulunamadi");
    assert.equal(a[0]!.seq, undefined);
    assert.deepEqual(a[1], a[0]);
    assert.deepEqual(o.depo.ackBul("tel-1", "m1"), { ok: false, code: "sohbet_bulunamadi" });
    assert.equal(ist.tur("event").length, 0);
    assert.equal(ist.kapali, false);
  });

  it("silinmiş sohbete user_message sohbet_bulunamadi", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(yeniSohbet("c0", "gecici"));
    await ist.gonder(sohbetSil("d0", "gecici"));
    await ist.gonder(kullaniciMesaji("m1", "x", "yazi", SOHBET_SURUMU, "gecici"));
    assert.equal(o.insanMesajlari.length, 0);
    assert.equal(ackOf(ist, "m1").code, "sohbet_bulunamadi");
  });

  it("interrupt sohbetin örneğine gider; bilinmeyen sohbette sohbet_bulunamadi ve kes çağrılmaz", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(yeniSohbet("c0", "is"));
    await ist.gonder({ v: SOHBET_SURUMU, type: "interrupt", client_msg_id: "i1", sohbet_id: "is", turn_id: "tur-1" });
    assert.deepEqual(o.kesmeler, ["tur-1"]);
    assert.deepEqual(o.kesSohbetleri, ["is"]);
    await ist.gonder({ v: SOHBET_SURUMU, type: "interrupt", client_msg_id: "i2", sohbet_id: "yok-1" });
    assert.equal(o.kesmeler.length, 1);
    const a = ackOf(ist, "i2");
    assert.equal(a.ok, false);
    assert.equal(a.code, "sohbet_bulunamadi");
    assert.deepEqual(o.depo.ackBul("tel-1", "i2"), { ok: false, code: "sohbet_bulunamadi" });
  });

  it("question_answer ve job_cancel sohbet_id alanını reddeder", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder({ v: SOHBET_SURUMU, type: "question_answer", client_msg_id: "q1", soru_id: "s1", cevap: "e", sohbet_id: "ana" });
    await ist.gonder({ v: SOHBET_SURUMU, type: "job_cancel", client_msg_id: "j1", is_id: 1, sohbet_id: "ana" });
    assert.equal(ist.tur("error").length, 2);
    assert.equal(o.soruCevaplari.length, 0);
    assert.equal(o.durdurmalar.length, 0);
  });
});

describe("gateway: Dilim 2, chat_create / chat_rename / chat_delete / chat_clear", () => {
  it("chat_create yeni: sohbetler.olustur çağrılır, ack.seq = chat_created numarası, olay yayınlanır", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(yeniSohbet("c1", "is", "Çalışma"));
    assert.deepEqual(o.olustur, [["is", "Çalışma"]]);
    const olay = ist
      .tur("event")
      .map((e) => e.event)
      .find((e) => e.type === "chat_created")!;
    assert.equal(olay.sohbet_id, "is");
    assert.equal(olay.ad, "Çalışma");
    assert.deepEqual(ackOf(ist, "c1"), { v: SOHBET_SURUMU, type: "ack", client_msg_id: "c1", ok: true, seq: olay.seq });
    assert.deepEqual(o.depo.ackBul("tel-1", "c1"), { ok: true, seq: olay.seq });
  });

  it("chat_create mevcut sohbet: yan etkisiz ok, ack'te seq yok, olay yok", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(yeniSohbet("c1", "is"));
    const once = ist.tur("event").length;
    await ist.gonder(yeniSohbet("c2", "is", "Başka ad"));
    await ist.gonder(yeniSohbet("c3", "ana", "Claude"));
    for (const id of ["c2", "c3"]) {
      const a = ackOf(ist, id);
      assert.equal(a.ok, true);
      assert.equal(a.seq, undefined, `${id} seq taşımamalı`);
      assert.deepEqual(Object.keys(a).sort(), ["client_msg_id", "ok", "type", "v"]);
      assert.deepEqual(o.depo.ackBul("tel-1", id), { ok: true });
    }
    assert.equal(ist.tur("event").length, once);
  });

  it("chat_create silinmiş kimlik: sohbet_bulunamadi", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(yeniSohbet("c1", "is"));
    await ist.gonder(sohbetSil("d1", "is"));
    await ist.gonder(yeniSohbet("c2", "is"));
    const a = ackOf(ist, "c2");
    assert.equal(a.ok, false);
    assert.equal(a.code, "sohbet_bulunamadi");
    assert.deepEqual(o.depo.ackBul("tel-1", "c2"), { ok: false, code: "sohbet_bulunamadi" });
  });

  it("chat_create sınırı: 8 sohbetten sonra sohbet_siniri", async () => {
    const o = await hazir();
    const ist = await o.giris();
    for (let i = 1; i <= 7; i++) await ist.gonder(yeniSohbet(`c${i}`, `s${i}`));
    for (let i = 1; i <= 7; i++) assert.equal(ackOf(ist, `c${i}`).ok, true, `c${i}`);
    await ist.gonder(yeniSohbet("c8", "s8"));
    const a = ackOf(ist, "c8");
    assert.equal(a.ok, false);
    assert.equal(a.code, "sohbet_siniri");
    assert.equal(a.seq, undefined);
    assert.equal(ist.kapali, false);
  });

  it("chat_create aynı client_msg_id ikinci kez işlenmez", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(yeniSohbet("c1", "is"));
    await ist.gonder(yeniSohbet("c1", "is"));
    assert.equal(o.olustur.length, 1);
    const ackler = ist.tur("ack");
    assert.equal(ackler.length, 2);
    assert.deepEqual(ackler[1], ackler[0]);
  });

  it("chat_rename: ad değişince ack.seq = chat_renamed; aynı ad seq'siz ok", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(yeniSohbet("c1", "is", "Eski"));
    await ist.gonder(sohbetAdla("r1", "is", "Yeni"));
    const olay = ist
      .tur("event")
      .map((e) => e.event)
      .find((e) => e.type === "chat_renamed")!;
    assert.equal(olay.sohbet_id, "is");
    assert.equal(olay.ad, "Yeni");
    assert.equal(ackOf(ist, "r1").seq, olay.seq);
    await ist.gonder(sohbetAdla("r2", "is", "Yeni"));
    const a = ackOf(ist, "r2");
    assert.equal(a.ok, true);
    assert.equal(a.seq, undefined);
    assert.deepEqual(o.adlandir, [
      ["is", "Yeni"],
      ["is", "Yeni"],
    ]);
  });

  it("chat_rename bilinmeyen sohbet: sohbet_bulunamadi", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(sohbetAdla("r1", "yok-1", "Ad"));
    assert.equal(ackOf(ist, "r1").code, "sohbet_bulunamadi");
  });

  it("chat_delete ana: sohbet_silinemez", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(sohbetSil("d1", "ana"));
    const a = ackOf(ist, "d1");
    assert.equal(a.ok, false);
    assert.equal(a.code, "sohbet_silinemez");
    assert.deepEqual(o.depo.ackBul("tel-1", "d1"), { ok: false, code: "sohbet_silinemez" });
  });

  it("chat_delete meşgul sohbet: sohbet_mesgul; sohbet listede kalır", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(yeniSohbet("c1", "is"));
    o.d.mesguller.add("is");
    await ist.gonder(sohbetSil("d1", "is"));
    const a = ackOf(ist, "d1");
    assert.equal(a.ok, false);
    assert.equal(a.code, "sohbet_mesgul");
    assert.equal(a.seq, undefined);
    o.veriyolu.yayinla("is_sayisi_degisti", { aktif: 0 });
    assert.ok(ist.tur("server_status").at(-1)!.sohbetler.some((x: Msg) => x.sohbet_id === "is"));
  });

  it("chat_delete başarı: ack.seq = chat_deleted numarası, chat_cleared yazılmaz; bilinmeyen sohbet bulunamadi", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(yeniSohbet("c1", "is"));
    await ist.gonder(sohbetSil("d1", "is"));
    const olaylar = ist.tur("event").map((e) => e.event);
    const silindi = olaylar.find((e) => e.type === "chat_deleted")!;
    assert.equal(silindi.sohbet_id, "is");
    assert.equal(ackOf(ist, "d1").seq, silindi.seq);
    assert.equal(olaylar.filter((e) => e.type === "chat_cleared").length, 0);
    await ist.gonder(sohbetSil("d2", "yok-1"));
    assert.equal(ackOf(ist, "d2").code, "sohbet_bulunamadi");
    assert.deepEqual(o.silinenSohbetler, ["is", "yok-1"]);
  });

  it("chat_delete aynı client_msg_id ikinci kez işlenmez", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(yeniSohbet("c1", "is"));
    await ist.gonder(sohbetSil("d1", "is"));
    await ist.gonder(sohbetSil("d1", "is"));
    assert.deepEqual(o.silinenSohbetler, ["is"]);
    const ackler = ist.tur("ack").filter((a) => a.client_msg_id === "d1");
    assert.equal(ackler.length, 2);
    assert.deepEqual(ackler[1], ackler[0]);
  });

  it("chat_clear sohbet başına: temizlik o sohbetle çağrılır, ack mezar seq'i", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(yeniSohbet("c1", "is"));
    await ist.gonder(sohbetTemizle("t1", "is"));
    await ist.gonder(sohbetTemizle("t2", "ana"));
    assert.deepEqual(o.temizlenenSohbetler, ["is", "ana"]);
    assert.deepEqual(
      o.temizlikCagrilari.map((c) => c[0]),
      [{ sohbet_id: "is" }, { sohbet_id: "ana" }],
    );
    assert.equal(ackOf(ist, "t1").seq, MEZAR_SEQ);
    assert.equal(ackOf(ist, "t2").seq, MEZAR_SEQ);
  });

  it("chat_clear sohbet_bulunamadi ack'e yansır", async () => {
    const o = await hazir();
    o.d.temizlikSonuc = { ok: false, code: "sohbet_bulunamadi" };
    const ist = await o.giris();
    await ist.gonder(sohbetTemizle("t1", "yok-1"));
    assert.equal(ackOf(ist, "t1").code, "sohbet_bulunamadi");
  });

  it("kimlik öncesi chat_create / chat_rename / chat_delete kabul edilmez: bağlantı kapanır, ack yok", async () => {
    const o = await hazir();
    for (const m of [yeniSohbet("c1", "is"), sohbetAdla("r1", "ana", "Ad"), sohbetSil("d1", "is")]) {
      const ist = o.bagla("/sohbet");
      await ist.gonder(m);
      assert.ok(ist.kapali);
      assert.equal(ist.tur("ack").length, 0);
      assert.equal(ist.tur("welcome").length, 0);
    }
    const yarim = o.bagla("/sohbet");
    await yarim.gonder(helloMesaji("/sohbet"));
    await yarim.gonder(yeniSohbet("c2", "is"));
    assert.ok(yarim.kapali);
    assert.equal(o.olustur.length, 0);
    assert.equal(o.adlandir.length, 0);
    assert.deepEqual(o.silinenSohbetler, []);
  });

  it("/cihaz'dan gelen chat_create sohbetlere ulaşmaz", async () => {
    const o = await hazir();
    const ist = await o.giris("/cihaz");
    await ist.gonder({ v: 1, type: "chat_create", client_msg_id: "c1", sohbet_id: "is", ad: "x" });
    assert.equal(o.olustur.length, 0);
    assert.equal(ist.tur("ack").length, 0);
  });

  it("sohbet adı günlüğe yazılmaz (create ve rename)", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(yeniSohbet("c1", "is", "GIZLIADXYZ"));
    await ist.gonder(sohbetAdla("r1", "is", "GIZLIAD2XYZ"));
    assert.ok(!JSON.stringify(o.gunluk.girdiler).includes("GIZLIAD"));
  });

  it("geçersiz sohbet adı (baş boşluk) gecersiz_mesaj; sohbetler çağrılmaz", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(yeniSohbet("c1", "is", " boşluklu"));
    assert.equal(ist.hataKodu, "gecersiz_mesaj");
    assert.equal(o.olustur.length, 0);
  });
});

describe("gateway: Dilim 2, server_status.sohbetler ve akış", () => {
  it("server_status.sohbetler sohbetler.durumlar()'dır, eren alanı yoktur", async () => {
    const o = await hazir();
    o.d.eren = "tur_suruyor";
    const ist = await o.giris();
    const s = ist.tur("server_status").at(-1)!;
    assert.deepEqual(s.sohbetler, [{ sohbet_id: "ana", eren: "tur_suruyor" }]);
    assert.ok(!("eren" in s));
    assert.ok(!("eren" in ist.hamTur("server_status").at(-1)!));
  });

  it("sohbet_listesi_degisti server_status'u yeniden yollar; yeni sohbet görünür, silinince çıkar", async () => {
    const o = await hazir();
    const ist = await o.giris();
    const once = ist.tur("server_status").length;
    await ist.gonder(yeniSohbet("c1", "is"));
    assert.ok(ist.tur("server_status").length > once);
    assert.deepEqual(
      ist.tur("server_status").at(-1)!.sohbetler.map((x: Msg) => x.sohbet_id),
      ["ana", "is"],
    );
    const ara = ist.tur("server_status").length;
    await ist.gonder(sohbetSil("d1", "is"));
    assert.ok(ist.tur("server_status").length > ara);
    assert.deepEqual(
      ist.tur("server_status").at(-1)!.sohbetler.map((x: Msg) => x.sohbet_id),
      ["ana"],
    );
  });

  it("sohbet_listesi_degisti yarım ve /cihaz bağlantısına durum götürmez", async () => {
    const o = await hazir();
    const yarim = o.bagla("/sohbet", "100.64.0.30");
    const cihaz = await o.giris("/cihaz");
    const kc = cihaz.kare.length;
    o.veriyolu.yayinla("sohbet_listesi_degisti", { sohbet_id: "is", olay: "olusturuldu" });
    assert.equal(yarim.tur("server_status").length, 0);
    assert.equal(cihaz.kare.length, kc);
  });

  it("assistant_delta ve stream_snapshot sohbet_id taşır (ham JSON dahil)", async () => {
    const o = await hazir();
    o.d.digerTurlar = [{ sohbet_id: "is", turn_id: "tur-is", text: "is metni" }];
    const ist = await o.giris();
    o.veriyolu.yayinla("tur_delta", { sohbet_id: "is", turn_id: "tur-is", offset: 8, text: "!" });
    const d = ist.hamTur("assistant_delta");
    assert.equal(d.length, 1);
    assert.deepEqual(
      { sohbet_id: d[0]!.sohbet_id, turn_id: d[0]!.turn_id, offset: d[0]!.offset, text: d[0]!.text },
      { sohbet_id: "is", turn_id: "tur-is", offset: 8, text: "!" },
    );
    assert.equal(ist.hamTur("stream_snapshot")[0]!.sohbet_id, "is");
  });

  it("telafide her canlı tur için bir snapshot: olaylardan sonra, server_status'tan önce", async () => {
    const o = await hazir();
    o.depoGercek.olayEkle({ type: "user_echo", sohbet_id: "ana", client_msg_id: "e0", input: "yazi", text: "x" });
    o.d.tur = { turn_id: "tur-ana", text: "ana metni" };
    o.d.digerTurlar = [
      { sohbet_id: "is", turn_id: "tur-is", text: "is metni" },
      { sohbet_id: "ev", turn_id: "tur-ev", text: "ev metni" },
    ];
    const ist = await o.giris();
    assert.deepEqual(ist.turler, [
      "auth_challenge",
      "welcome",
      "event",
      "stream_snapshot",
      "stream_snapshot",
      "stream_snapshot",
      "server_status",
    ]);
    assert.deepEqual(
      ist.tur("stream_snapshot").map((x) => [x.sohbet_id, x.turn_id, x.text]),
      [
        ["ana", "tur-ana", "ana metni"],
        ["is", "tur-is", "is metni"],
        ["ev", "tur-ev", "ev metni"],
      ],
    );
  });

  it("canlı tur yoksa telafide snapshot yok; /cihaz'a v3 alanı gitmez", async () => {
    const o = await hazir();
    const ist = await o.giris();
    assert.equal(ist.tur("stream_snapshot").length, 0);
    const cihaz = await o.giris("/cihaz");
    o.veriyolu.yayinla("tur_delta", { sohbet_id: "ana", turn_id: "t", offset: 0, text: "a" });
    o.veriyolu.yayinla("sohbet_listesi_degisti", { sohbet_id: "is", olay: "olusturuldu" });
    assert.ok(cihaz.hamKareler.every((k) => k.v === 1));
    assert.ok(!cihaz.ham.includes("sohbet_id"));
    assert.ok(!cihaz.ham.includes("sohbetler"));
  });
});

// ---------------------------------------------------------------------------------------------
// Dilim 3b: `/sohbet` v4, kısayol mesajı (`input:"kisayol"`, `baglam`)
// ---------------------------------------------------------------------------------------------

describe("gateway: Dilim 3b, v4 ve kısayol bağlamı", () => {
  const BAGLAM = { paket: "com.whatsapp", ad: "WhatsApp" };
  const kisayolMesaji = (id: string, text: string, ek: Record<string, unknown> = {}): object => ({
    ...kullaniciMesaji(id, text, "kisayol"),
    ...ek,
  });

  it("v4 el sıkışma: hello/auth_response v4 kabul, welcome v4; v3 istemci protokol_uyumsuz ile kapanır", async () => {
    assert.equal(SOHBET_SURUMU, 4);
    const o = await hazir();
    const ist = await o.giris();
    assert.equal(ist.hamTur("welcome")[0]!.v, 4);
    assert.ok(ist.hamKareler.every((k) => k.v === 4));

    const v3 = o.bagla("/sohbet");
    await v3.gonder({ v: 3, type: "hello", device_id: "tel-1", last_seq: 0, client_nonce: ISTEMCI_NONCE });
    reddedildi(v3, "protokol_uyumsuz");
    assert.equal(v3.hamTur("error")[0]!.v, 4);
    assert.equal(v3.hamTur("auth_challenge").length, 0);

    // Kimlik sonrası v3 iş mesajı da (outbox'ta kalmış eski kayıt) aynı yoldan kapanır, hiçbir şey yazılmaz.
    await ist.gonder({ ...kullaniciMesaji("m1"), v: 3 });
    assert.equal(ist.tur("error").at(-1)!.code, "protokol_uyumsuz");
    assert.ok(ist.kapali);
    assert.equal(o.insanMesajlari.length, 0);
    assert.equal(o.depo.basSeq(), 0);
  });

  it("kısayol + baglam: insanMesajiAl baglam'ı alır, ack ok + seq, user_echo baglam'ı taşır", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(kisayolMesaji("k1", "bunu özetle", { baglam: BAGLAM }));
    assert.equal(o.insanMesajlari.length, 1);
    const m = o.insanMesajlari[0]!;
    assert.deepEqual(
      { device_id: m.device_id, client_msg_id: m.client_msg_id, sohbet_id: m.sohbet_id, input: m.input, text: m.text, baglam: m.baglam },
      { device_id: "tel-1", client_msg_id: "k1", sohbet_id: "ana", input: "kisayol", text: "bunu özetle", baglam: BAGLAM },
    );
    assert.deepEqual(ist.tur("ack")[0], { v: SOHBET_SURUMU, type: "ack", client_msg_id: "k1", ok: true, seq: 1 });
    const echo = ist.tur("event").map((e) => e.event)[0];
    assert.equal(echo.type, "user_echo");
    assert.equal(echo.input, "kisayol");
    assert.equal(echo.text, "bunu özetle");
    assert.deepEqual(echo.baglam, BAGLAM);
  });

  it("baglam'sız kısayol geçerli: insan mesajında ve user_echo'da baglam alanı yok", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(kisayolMesaji("k1", "hava nasıl"));
    assert.equal(o.insanMesajlari.length, 1);
    assert.equal("baglam" in o.insanMesajlari[0]!, false);
    assert.equal(ist.tur("ack")[0]!.ok, true);
    const echo = ist.tur("event").map((e) => e.event)[0];
    assert.equal(echo.input, "kisayol");
    assert.equal("baglam" in echo, false);
  });

  it("yazı ya da dikte ile baglam reddedilir (protokol): gecersiz_mesaj, bağlantı açık, hiçbir şey yazılmaz", async () => {
    const o = await hazir();
    const ist = await o.giris();
    for (const [id, input] of [["y1", "yazi"], ["d1", "dikte"]] as const) {
      await ist.gonder({ ...kullaniciMesaji(id, "metin", input), baglam: BAGLAM });
    }
    assert.equal(ist.tur("error").length, 2);
    assert.ok(ist.tur("error").every((e) => e.code === "gecersiz_mesaj"));
    assert.equal(ist.kapali, false);
    assert.equal(o.insanMesajlari.length, 0);
    assert.equal(ist.tur("ack").length, 0);
    assert.equal(o.depo.basSeq(), 0);
    // Aynı bağlantı sonra geçerli kısayolu işler.
    await ist.gonder(kisayolMesaji("k1", "metin", { baglam: BAGLAM }));
    assert.equal(o.insanMesajlari.length, 1);
  });

  it("bozuk baglam reddedilir: paket deseni, ad boş/uzun/kontrol karakteri, fazla alan", async () => {
    const o = await hazir();
    const ist = await o.giris();
    const bozuklar: unknown[] = [
      { paket: "whatsapp", ad: "WhatsApp" },
      { paket: "com.", ad: "WhatsApp" },
      { paket: "1com.x", ad: "WhatsApp" },
      { paket: `com.${"a".repeat(252)}`, ad: "WhatsApp" },
      { paket: "com.whatsapp", ad: "" },
      { paket: "com.whatsapp", ad: "a".repeat(81) },
      { paket: "com.whatsapp", ad: "satır\nkıran" },
      { paket: "com.whatsapp", ad: "c1\u0085" },
      { paket: "com.whatsapp", ad: "WhatsApp", fazla: 1 },
      { paket: "com.whatsapp" },
      "com.whatsapp",
    ];
    for (const [i, baglam] of bozuklar.entries()) {
      await ist.gonder(kisayolMesaji(`b${i}`, "metin", { baglam }));
    }
    assert.equal(ist.tur("error").length, bozuklar.length);
    assert.ok(ist.tur("error").every((e) => e.code === "gecersiz_mesaj"));
    assert.equal(ist.kapali, false);
    assert.equal(o.insanMesajlari.length, 0);
    assert.equal(o.depo.basSeq(), 0);
    // Sınırda geçerli: 80 birimlik ad, 255 birimlik paket.
    await ist.gonder(kisayolMesaji("s1", "metin", { baglam: { paket: `com.${"a".repeat(251)}`, ad: "a".repeat(80) } }));
    assert.equal(o.insanMesajlari.length, 1);
  });

  it("baglam günlüğe yazılmaz (kullanıcı verisi)", async () => {
    const o = await hazir();
    const ist = await o.giris();
    await ist.gonder(kisayolMesaji("k1", "metin", { baglam: { paket: "com.gizli.paketabc", ad: "GIZLIADABC" } }));
    await ist.gonder({ ...kullaniciMesaji("y1", "metin"), baglam: { paket: "com.gizli.paketabc", ad: "GIZLIADABC" } });
    const log = JSON.stringify(o.gunluk.girdiler);
    assert.ok(!log.includes("GIZLIADABC"));
    assert.ok(!log.includes("com.gizli.paketabc"));
  });
});
