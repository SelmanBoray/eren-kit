/**
 * Gateway `/ajanda` kanalı (MODULLER.md "Ajanda dalgası" > "gateway ve dis-dunya"; AJANDA.md "Kapsam ve
 * eşleştirme", "Kanal akışı" 1-3 ve 6, "Servis: gateway ve eşleştirme"). Gerçek depo (`:memory:`, kapsam
 * tabloları), gerçek P-256 anahtarlar, sahte WebSocket ve sahte ajanda yüzü (`AjandaGatewayYuzu`). Giden
 * her `/ajanda` çerçevesi `ajandaAsagiCoz`'dan, `/sohbet` ve `/cihaz` çerçeveleri kendi çözücüsünden geçer.
 *
 * İzlenebilirlik ("Servis: gateway ve eşleştirme" maddeleri → test başlıkları):
 * - `/ajanda` yolu, çözücüler, sınır `AJANDA_AZAMI_CERCEVE.KANAL` → "yol ve bağımlılık", "çözücü".
 * - `islem_id`'li geçersiz çerçeve: `gecersiz_islem`, tekrarsızlık, kapatmama; öteki `gecersiz_mesaj` + kapat → "işlem".
 * - `hello`'da taze kayıt, `kanalKapsamdaMi`, `kanal_desteklenmiyor` sınama başlamadan → "kapsam".
 * - Eşleştirme penceresi denetimi, `pair_result{kapsam}`, kapsamlı `cihazEkle` → "eşleştirme".
 * - `ajandaKimlikImzaMetni`, `AJANDA_KANAL_HATALARI` → "imza", her ret çerçevesi şemadan geçer.
 * - Telafi: son gönderilen revizyon, telafi sürerken doğanı sıraya alma, aynı revizyonu iki kez yollamama → "telafi", "canlı".
 */
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign as imzaAt, timingSafeEqual, verify as imzaDogrula } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import {
  AJANDA_AZAMI_CERCEVE,
  AJANDA_KANAL_HATALARI,
  AjandaKaydi,
  AZAMI_CERCEVE,
  SOHBET_SURUMU,
  ajandaAsagiCoz,
  ajandaKimlikImzaMetni,
  cihazAsagiCoz,
  kimlikImzaMetni,
  sha256Hex,
  sohbetAsagiCoz,
  utf8Bayt,
} from "@eren/protocol";
import type { AjandaGecmisGirdisi, AjandaIslem, CihazKapsami, ServisBilgisi } from "@eren/protocol";
import { depoAc } from "../src/depo.ts";
import { gatewayKur } from "../src/gateway.ts";
import { AJANDA_TELAFI_SAYFASI } from "../src/gateway-ajanda.ts";
import type {
  AjandaGatewayYuzu,
  AjandaGecmisSayfasi,
  AjandaHelloOzeti,
  AjandaIslemSonucuGovdesi,
  AnahtarPortu,
  GatewayBagimliliklari,
  Veriyolu,
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
const IP3 = "100.64.0.22";
const WS_PORT = 47821;
const NONCE = Buffer.alloc(32, 7).toString("base64");
const KOD = "ABC123XYZ9";
const SERVIS: ServisBilgisi = { surum: "abc123def456", baslangic_ms: BASLANGIC - 5000 };
const DEPO_ID = "depo-1";

type Msg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
};

interface Anahtarli {
  private: KeyObject;
  acik: string;
}

const anahtarUret = (): Anahtarli => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { private: privateKey, acik: publicKey.export({ type: "spki", format: "der" }).toString("base64") };
};

/** Sohbet kapsamlı (eski) telefon ve iki ajanda cihazı. */
const TEL = anahtarUret();
const AJ1 = anahtarUret();
const AJ2 = anahtarUret();

const imzala = (k: KeyObject, metin: string): string => imzaAt("sha256", Buffer.from(metin, "utf8"), k).toString("base64");

function gercekAnahtar(): AnahtarPortu & { imzalananlar: string[] } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const acik = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const imzalananlar: string[] = [];
  return {
    imzalananlar,
    acikAnahtar: () => acik,
    imzala: (metin) => {
      imzalananlar.push(metin);
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
      const x = Buffer.from(a, "utf8");
      const y = Buffer.from(b, "utf8");
      return x.length === y.length && timingSafeEqual(x, y);
    },
  };
}

const sunucuImzasiDogruMu = (acik: string, metin: string, imza: string): boolean =>
  imzaDogrula("sha256", Buffer.from(metin, "utf8"), createPublicKey({ key: Buffer.from(acik, "base64"), format: "der", type: "spki" }), Buffer.from(imza, "base64"));

const kayitUret = (kayit_id: string, revizyon: number, ek: Partial<AjandaKaydi> = {}): AjandaKaydi => ({
  kayit_id,
  revizyon,
  tur: "gorev",
  baslik: `Kayıt ${kayit_id}`,
  hatirlatmalar: [],
  ornekler: [],
  durum: "acik",
  taslak: false,
  silindi: false,
  elle_alanlar: [],
  kaynak: { yol: "elle", tur_kokeni: "insan", device_id: "aj-1" },
  olusturma_ms: BASLANGIC,
  guncelleme_ms: BASLANGIC + revizyon,
  ...ek,
});

const GECMIS_GIRDISI: AjandaGecmisGirdisi = {
  rev: 1,
  ts_ms: BASLANGIC + 1,
  islem: "ekle",
  yazar: { yol: "elle", tur_kokeni: "insan", device_id: "aj-1" },
  onceki: {},
  sonraki: { baslik: "Kayıt k1" },
};

/**
 * Sahte ajanda modülü: kayıtlar bellekte, tek sayaç, tekrarsızlık `(device_id, islem_id)`. Yazımı
 * gerçeği gibi `veriyolu` `ajanda_kayit_yazildi` ile yayınlar (gateway'in canlı yolu buradan beslenir).
 */
function sahteAjanda(veriyolu: Veriyolu) {
  const kayitlar = new Map<string, AjandaKaydi>();
  let bas = 0;
  const tekrarsiz = new Map<string, AjandaIslemSonucuGovdesi>();
  const c = {
    karsila: [] as AjandaHelloOzeti[],
    sayfa: [] as Array<{ sonRev: number; ustRev: number; adet: number }>,
    uygulanan: [] as Array<[string, string, AjandaIslem]>,
    gecersiz: [] as Array<[string, string]>,
    gecmis: [] as Array<[string, number | undefined]>,
  };
  const ayar = {
    /** Her `telafiSayfasi` çağrısının başında (telafi sürerken doğan kayıt için). */
    sayfaKancasi: null as null | ((n: number) => void),
    islemAtar: false,
    gecmisAtar: false,
  };
  /** Yeni revizyonla yazar; `yayinla` yanlışsa yayınlamaz (yayını kaçırılan revizyon). */
  const yaz = (k: AjandaKaydi, yayinla = true): AjandaKaydi => {
    bas++;
    const yeni = { ...k, revizyon: bas, guncelleme_ms: BASLANGIC + bas };
    kayitlar.set(yeni.kayit_id, yeni);
    if (yayinla) veriyolu.yayinla("ajanda_kayit_yazildi", { kayit: yeni });
    return yeni;
  };
  const yuz: AjandaGatewayYuzu = {
    karsila: (h) => {
      c.karsila.push(h);
      const tam = h.depo_id !== DEPO_ID || h.son_rev > bas || (h.son_rev > 0 && h.son_rev_izi === undefined);
      return { depo_id: DEPO_ID, bas_rev: bas, tam };
    },
    telafiSayfasi: (g) => {
      c.sayfa.push(g);
      ayar.sayfaKancasi?.(c.sayfa.length);
      return [...kayitlar.values()]
        .filter((k) => k.revizyon > g.sonRev && k.revizyon <= g.ustRev)
        .sort((a, b) => a.revizyon - b.revizyon)
        .slice(0, g.adet);
    },
    islemUygula: (device_id, islem_id, islem) => {
      const anahtar = `${device_id}\n${islem_id}`;
      const kayitli = tekrarsiz.get(anahtar);
      if (kayitli !== undefined) return kayitli;
      if (ayar.islemAtar) throw new Error("vt_mesgul");
      c.uygulanan.push([device_id, islem_id, islem]);
      let s: AjandaIslemSonucuGovdesi;
      const var_ = kayitlar.get(islem.kayit_id);
      if (islem.islem === "ekle") {
        if (var_ !== undefined) s = { ok: false, code: "kimlik_cakisiyor" };
        else {
          const y = yaz(kayitUret(islem.kayit_id, 0, { tur: islem.tur, baslik: islem.baslik, kaynak: { yol: "elle", tur_kokeni: "insan", device_id } }));
          s = { ok: true, kayit_id: y.kayit_id, rev: y.revizyon };
        }
      } else if (islem.islem === "sil") {
        if (var_ === undefined) s = { ok: false, code: "kayit_bulunamadi" };
        else if (var_.silindi) s = { ok: true, kayit_id: var_.kayit_id };
        else {
          const y = yaz({ ...var_, silindi: true });
          s = { ok: true, kayit_id: y.kayit_id, rev: y.revizyon };
        }
      } else s = { ok: false, code: "kayit_bulunamadi" };
      tekrarsiz.set(anahtar, s);
      return s;
    },
    gecersizIslem: (device_id, islem_id) => {
      c.gecersiz.push([device_id, islem_id]);
      const anahtar = `${device_id}\n${islem_id}`;
      const kayitli = tekrarsiz.get(anahtar);
      if (kayitli !== undefined) return kayitli;
      const s: AjandaIslemSonucuGovdesi = { ok: false, code: "gecersiz_islem" };
      tekrarsiz.set(anahtar, s);
      return s;
    },
    gecmis: (kayit_id, once_rev): AjandaGecmisSayfasi => {
      c.gecmis.push([kayit_id, once_rev]);
      if (ayar.gecmisAtar) throw new Error("vt_mesgul");
      if (!kayitlar.has(kayit_id)) return { kayit_id, girdiler: [], devami: false, code: "kayit_bulunamadi" };
      return { kayit_id, girdiler: [GECMIS_GIRDISI], devami: true };
    },
  };
  return { yuz, c, ayar, yaz, kayitlar, get bas() { return bas; } };
}

/** Bağlantının üstüne ince istemci: gelen her çerçeve kendi kanalının şemasından geçer. */
class Ist {
  readonly c: SahteWsBaglantisi;
  constructor(c: SahteWsBaglantisi) {
    this.c = c;
  }
  get kare(): Msg[] {
    return this.c.gonderilenler.map((m) => {
      const coz =
        this.c.yol === "/ajanda" ? ajandaAsagiCoz(m) : this.c.yol === "/sohbet" ? sohbetAsagiCoz(m) : cihazAsagiCoz(m);
      assert.ok(coz.ok, `giden çerçeve ${this.c.yol} şemasına uymuyor: ${m.slice(0, 200)}`);
      return coz.mesaj as Msg;
    });
  }
  tur(t: string): Msg[] {
    return this.kare.filter((k) => k.type === t);
  }
  get turler(): string[] {
    return this.kare.map((k) => k.type as string);
  }
  /** `kayit` çerçevelerinin revizyonları, gönderim sırasıyla. */
  get revler(): number[] {
    return this.tur("kayit").map((k) => k.kayit.revizyon as number);
  }
  get kapali(): boolean {
    return this.c.kapanis !== null;
  }
  get hataKodu(): string | undefined {
    return this.tur("error")[0]?.code;
  }
  async gonder(m: object | string): Promise<void> {
    this.c.mesajGonder(typeof m === "string" ? m : JSON.stringify(m));
    await bosalt();
  }
}

interface AjandaElSikma {
  device_id?: string;
  son_rev?: number;
  depo_id?: string;
  son_rev_izi?: { kayit_id: string; guncelleme_ms: number };
  anahtar?: KeyObject;
  /** Verilirse imzalanan metin bu (sunucu nonce'uyla). */
  metin?: (server_nonce: string) => string;
}

async function ajandaElSik(ist: Ist, s: AjandaElSikma = {}): Promise<Msg | null> {
  const device_id = s.device_id ?? "aj-1";
  await ist.gonder({
    v: 1,
    type: "hello",
    device_id,
    son_rev: s.son_rev ?? 0,
    ...(s.depo_id !== undefined && { depo_id: s.depo_id }),
    ...(s.son_rev_izi !== undefined && { son_rev_izi: s.son_rev_izi }),
    client_nonce: NONCE,
  });
  const ch = ist.tur("auth_challenge")[0];
  if (ch === undefined || ist.kapali) return null;
  const metin =
    s.metin?.(ch.server_nonce) ??
    ajandaKimlikImzaMetni({ rol: "telefon", device_id, client_nonce: NONCE, server_nonce: ch.server_nonce });
  await ist.gonder({ v: 1, type: "auth_response", signature: imzala(s.anahtar ?? AJ1.private, metin) });
  return ch;
}

/** `/sohbet` ya da `/cihaz` el sıkışması; imza metni verilebilir. */
async function eskiElSik(ist: Ist, device_id: string, anahtar: KeyObject, metin?: (n: string) => string): Promise<Msg | null> {
  const sohbet = ist.c.yol === "/sohbet";
  const v = sohbet ? SOHBET_SURUMU : 1;
  await ist.gonder(
    sohbet
      ? { v, type: "hello", device_id, last_seq: 0, client_nonce: NONCE }
      : { v, type: "hello", device_id, client_nonce: NONCE },
  );
  const ch = ist.tur("auth_challenge")[0];
  if (ch === undefined || ist.kapali) return null;
  const m =
    metin?.(ch.server_nonce) ??
    kimlikImzaMetni({ rol: "telefon", kanal: sohbet ? "sohbet" : "cihaz", device_id, client_nonce: NONCE, server_nonce: ch.server_nonce });
  await ist.gonder({ v, type: "auth_response", signature: imzala(anahtar, m) });
  return ch;
}

function reddedildi(ist: Ist, kod: string): void {
  assert.equal(ist.hataKodu, kod, `beklenen ${kod}, gelen ${JSON.stringify(ist.kare)}`);
  assert.ok(ist.kapali, "bağlantı kapanmadı");
  assert.equal(ist.tur("welcome").length, 0, "reddedilen bağlantıya welcome gitti");
}

// ---------------------------------------------------------------------------------------------
// Ortam
// ---------------------------------------------------------------------------------------------

const acilacaklar: Array<() => void> = [];
afterEach(() => {
  for (const f of acilacaklar.splice(0)) f();
});

function kur(sec: { ajanda?: boolean } = {}) {
  const zaman = sahteZaman(BASLANGIC);
  const gunluk = sahteGunluk();
  const veriyolu = veriyoluKur({ gunluk });
  const depo = depoAc({ yol: ":memory:", saat: zaman.saat, veriyolu, gunluk });
  acilacaklar.push(() => depo.kapat());
  const ws = sahteWs();
  const anahtar = gercekAnahtar();
  const aj = sahteAjanda(veriyolu);
  const insanMesajlari: Msg[] = [];
  const baglananlar: Msg[] = [];
  const b = {
    ayar: {
      wsPort: WS_PORT,
      sureler: { komutPayiMs: 15000 },
      servis: SERVIS,
    },
    depo,
    sohbetler: {
      konusma: () => ({
        insanMesajiAl: (m: Msg) => {
          insanMesajlari.push(m);
          return { seq: 1 };
        },
        kes: () => ({ ok: true, deger: undefined }),
      }),
      durumlar: () => [{ sohbet_id: "ana", eren: "hazir" }],
      aktifTurlar: () => [],
      olustur: () => ({ ok: true, deger: { seq: null } }),
      adlandir: () => ({ ok: true, deger: { seq: null } }),
    },
    planlar: { karar: async () => ({ ok: true, deger: undefined }) },
    isler: {
      soruCevapla: () => ({ ok: true, deger: undefined }),
      durdur: async () => ({ ok: true, deger: { is_id: 1, sonuc: "durduruldu" } }),
      aktifSayisi: () => 0,
      ram: () => ({ bosMb: 8000, toplamMb: 16000, dusuk: false }),
    },
    temizlik: {
      gecmisiSil: () => ({ ok: false, code: "ic_hata" }),
      sohbetiSil: () => ({ ok: false, code: "ic_hata" }),
    },
    ...(sec.ajanda !== false && { ajanda: aj.yuz }),
    cihaz: { baglandi: (x: Msg) => baglananlar.push(x) },
    kilit: { durum: () => ({ tur: "serbest" }) },
    sistem: { tailscaleAdresi: () => SUNUCU_IP },
    ws,
    anahtar,
    rastgele: sahteRastgele(),
    saat: zaman.saat,
    zamanlayici: zaman.zamanlayici,
    veriyolu,
    gunluk,
  } as unknown as GatewayBagimliliklari;
  const gw = gatewayKur(b);
  return {
    zaman,
    gunluk,
    veriyolu,
    depo,
    ws,
    anahtar,
    aj,
    gw,
    insanMesajlari,
    baglananlar,
    async baslat(): Promise<void> {
      await gw.baslat();
      await bosalt();
    },
    cihazEkle(device_id: string, t: Anahtarli, ip: string, kapsam?: CihazKapsami): void {
      depo.cihazEkle({
        device_id,
        public_key: t.acik,
        tailscale_ip: ip,
        platform: "android",
        etiket: null,
        eslesme_ms: BASLANGIC,
        ...(kapsam !== undefined && { kapsam }),
      });
    },
    bagla(yol: WsYolu, ip = IP1): Ist {
      return new Ist(ws.baglan(yol, ip));
    },
    async ajandaGiris(ip = IP1, s: AjandaElSikma = {}): Promise<Ist> {
      const ist = new Ist(ws.baglan("/ajanda", ip));
      await ajandaElSik(ist, s);
      assert.equal(ist.hataKodu, undefined, `giriş hata verdi: ${JSON.stringify(ist.kare)}`);
      assert.equal(ist.tur("esitlendi").length, 1, "esitlendi gelmedi");
      return ist;
    },
    pencereAc(kapsam?: CihazKapsami, kod = KOD, sonMs = BASLANGIC + 300_000): void {
      depo.eslestirmeYaz({
        kod_ozeti: sha256Hex(utf8Bayt(kod)),
        son_ms: sonMs,
        yanlis_deneme: 0,
        ...(kapsam !== undefined && { kapsam }),
      });
    },
  };
}

type Ortam = ReturnType<typeof kur>;

/** Dinliyor; TEL sohbet kapsamlı (`tel-1`, IP1), AJ1 (`aj-1`, IP1) ve AJ2 (`aj-2`, IP2) ajanda kapsamlı. */
async function hazir(sec: Parameters<typeof kur>[0] = {}): Promise<Ortam> {
  const o = kur(sec);
  o.cihazEkle("tel-1", TEL, IP1);
  o.cihazEkle("aj-1", AJ1, IP1, "ajanda");
  o.cihazEkle("aj-2", AJ2, IP2, "ajanda");
  await o.baslat();
  return o;
}

const ekleIslemi = (kayit_id: string, baslik = "Süt al") => ({
  islem: "ekle",
  kayit_id,
  tur: "gorev",
  baslik,
  hatirlatmalar: [],
  girdi_yolu: "elle",
});

const islemMesaji = (islem_id: string, islem: object) => ({ v: 1, type: "islem", islem_id, islem });

// ---------------------------------------------------------------------------------------------
// Testler
// ---------------------------------------------------------------------------------------------

describe("gateway /ajanda: yol ve bağımlılık", () => {
  it("örnek kayıt şemaya uyar (sahtenin kayıtları gerçek şemadan geçer)", () => {
    assert.ok(AjandaKaydi.safeParse(kayitUret("k1", 1)).success);
  });

  it("ajanda verilmezse /ajanda dinlenmez; gelen bağlantı çerçevesiz kapanır; yayın kimseye gitmez", async () => {
    const o = await hazir({ ajanda: false });
    assert.deepEqual(o.ws.istek()?.azamiCerceve, { "/sohbet": AZAMI_CERCEVE.SOHBET, "/cihaz": AZAMI_CERCEVE.CIHAZ });
    const ist = o.bagla("/ajanda");
    assert.deepEqual(ist.c.kapanis, { kod: 1008, neden: "kanal_desteklenmiyor" });
    assert.deepEqual(ist.c.gonderilenler, []);
    o.veriyolu.yayinla("ajanda_kayit_yazildi", { kayit: kayitUret("k1", 1) });
    assert.equal(o.aj.c.karsila.length, 0);
  });

  it("ajanda verilince /ajanda sınırı AJANDA_AZAMI_CERCEVE.KANAL, öteki iki yolun sınırı aynı", async () => {
    const o = await hazir();
    assert.deepEqual(o.ws.istek()?.azamiCerceve, {
      "/sohbet": AZAMI_CERCEVE.SOHBET,
      "/cihaz": AZAMI_CERCEVE.CIHAZ,
      "/ajanda": AJANDA_AZAMI_CERCEVE.KANAL,
    });
  });
});

describe("gateway /ajanda: kapsam (iki yönde kanal_desteklenmiyor, sınama başlamadan)", () => {
  for (const ajandaVar of [true, false]) {
    for (const yol of ["/sohbet", "/cihaz"] as const) {
      it(`ajanda cihazı ${yol} açamaz (ajanda bağımlılığı ${ajandaVar ? "var" : "yok"}); sunucu imzası bile gitmez`, async () => {
        const o = await hazir({ ajanda: ajandaVar });
        const ist = o.bagla(yol);
        // Doğru eski imza metniyle bile: sınama hiç başlamaz.
        await eskiElSik(ist, "aj-1", AJ1.private);
        reddedildi(ist, "kanal_desteklenmiyor");
        assert.equal(ist.tur("auth_challenge").length, 0);
        assert.equal(o.anahtar.imzalananlar.length, 0, "sunucu imzası üretilmemeli");
        assert.equal(o.baglananlar.length, 0);
        assert.equal(ist.c.kapanis?.kod, 1008);
      });
    }
  }

  it("ajanda cihazı /sohbet'ten insan mesajı gönderemez (kimlik öncesi user_message da işlenmez)", async () => {
    const o = await hazir();
    const ist = o.bagla("/sohbet");
    await ist.gonder({ v: SOHBET_SURUMU, type: "user_message", client_msg_id: "u1", sohbet_id: "ana", input: "yazi", text: "merhaba" });
    assert.ok(ist.kapali);
    const ist2 = o.bagla("/sohbet");
    await eskiElSik(ist2, "aj-1", AJ1.private);
    await ist2.gonder({ v: SOHBET_SURUMU, type: "user_message", client_msg_id: "u2", sohbet_id: "ana", input: "yazi", text: "merhaba" });
    assert.ok(ist2.kapali);
    assert.equal(o.insanMesajlari.length, 0);
  });

  it("sohbet kapsamlı (eski) cihaz /ajanda açamaz: kanal_desteklenmiyor, sınama yok, ajanda çağrılmaz", async () => {
    const o = await hazir();
    const ist = o.bagla("/ajanda");
    await ajandaElSik(ist, { device_id: "tel-1", anahtar: TEL.private });
    reddedildi(ist, "kanal_desteklenmiyor");
    assert.equal(ist.tur("auth_challenge").length, 0);
    assert.equal(o.anahtar.imzalananlar.length, 0);
    assert.equal(o.aj.c.karsila.length, 0);
    assert.equal(ist.kare[0]!.v, 1);
  });

  it("aynı sohbet cihazı /sohbet ve /cihaz'ı bugünkü gibi açar (kapsam denetimi eski cihazı etkilemez)", async () => {
    const o = await hazir();
    const s = o.bagla("/sohbet");
    await eskiElSik(s, "tel-1", TEL.private);
    assert.equal(s.tur("welcome").length, 1, JSON.stringify(s.kare));
    const c = o.bagla("/cihaz");
    await eskiElSik(c, "tel-1", TEL.private);
    assert.equal(c.tur("welcome").length, 1);
    assert.equal(o.baglananlar.length, 1);
  });

  it("bilinmeyen ve kaldırılmış ajanda cihazı: cihaz_bilinmiyor", async () => {
    const o = await hazir();
    const a = o.bagla("/ajanda");
    await ajandaElSik(a, { device_id: "yok-1" });
    reddedildi(a, "cihaz_bilinmiyor");
    assert.equal(o.depo.cihazKaldir("aj-1").sonuc, "kaldirildi");
    const b = o.bagla("/ajanda");
    await ajandaElSik(b);
    reddedildi(b, "cihaz_bilinmiyor");
    assert.equal(o.anahtar.imzalananlar.length, 0);
  });

  it("Tailscale dışı ve PC'nin kendi adresi: ip_uyusmuyor, cihaz kaydına bakılmaz", async () => {
    const o = await hazir();
    for (const ip of ["127.0.0.1", SUNUCU_IP, "192.168.1.5"]) {
      const ist = o.bagla("/ajanda", ip);
      await ajandaElSik(ist);
      reddedildi(ist, "ip_uyusmuyor");
    }
    // Kayıtlı adres dışından gelen geçerli imza da reddedilir.
    const ist = o.bagla("/ajanda", IP3);
    await ajandaElSik(ist);
    reddedildi(ist, "ip_uyusmuyor");
  });
});

describe("gateway /ajanda: imza ayrımı (eren-ajanda-auth-v1)", () => {
  it("sunucu imzası ajandaKimlikImzaMetni({rol:pc}) üzerinedir, eren-auth-v1 metni olarak geçmez", async () => {
    const o = await hazir();
    const ist = o.bagla("/ajanda");
    const ch = await ajandaElSik(ist);
    assert.ok(ch);
    const acik = o.anahtar.acikAnahtar();
    const ajandaMetni = ajandaKimlikImzaMetni({ rol: "pc", device_id: "aj-1", client_nonce: NONCE, server_nonce: ch.server_nonce });
    assert.ok(sunucuImzasiDogruMu(acik, ajandaMetni, ch.server_signature));
    for (const kanal of ["sohbet", "cihaz"] as const) {
      const eski = kimlikImzaMetni({ rol: "pc", kanal, device_id: "aj-1", client_nonce: NONCE, server_nonce: ch.server_nonce });
      assert.equal(sunucuImzasiDogruMu(acik, eski, ch.server_signature), false, kanal);
    }
  });

  it("/ajanda'da eren-auth-v1 (sohbet/cihaz) imzası ya da pc rolüyle imza: imza_gecersiz", async () => {
    const o = await hazir();
    const metinler: Array<(n: string) => string> = [
      (n) => kimlikImzaMetni({ rol: "telefon", kanal: "sohbet", device_id: "aj-1", client_nonce: NONCE, server_nonce: n }),
      (n) => kimlikImzaMetni({ rol: "telefon", kanal: "cihaz", device_id: "aj-1", client_nonce: NONCE, server_nonce: n }),
      (n) => ajandaKimlikImzaMetni({ rol: "pc", device_id: "aj-1", client_nonce: NONCE, server_nonce: n }),
      (n) => ajandaKimlikImzaMetni({ rol: "telefon", device_id: "aj-2", client_nonce: NONCE, server_nonce: n }),
    ];
    for (const metin of metinler) {
      const ist = o.bagla("/ajanda");
      await ajandaElSik(ist, { metin });
      reddedildi(ist, "imza_gecersiz");
      assert.equal(ist.c.kimlikDogrulandiMi, false);
    }
    assert.equal(o.aj.c.karsila.length, 0);
  });

  for (const yol of ["/sohbet", "/cihaz"] as const) {
    it(`${yol}'da ajanda imza metni (eren-ajanda-auth-v1) geçmez: imza_gecersiz`, async () => {
      const o = await hazir();
      const ist = o.bagla(yol);
      await eskiElSik(ist, "tel-1", TEL.private, (n) =>
        ajandaKimlikImzaMetni({ rol: "telefon", device_id: "tel-1", client_nonce: NONCE, server_nonce: n }),
      );
      reddedildi(ist, "imza_gecersiz");
      assert.equal(o.baglananlar.length, 0);
      assert.equal(o.insanMesajlari.length, 0);
    });
  }

  it("başka ajanda cihazının anahtarıyla imza: imza_gecersiz", async () => {
    const o = await hazir();
    const ist = o.bagla("/ajanda");
    await ajandaElSik(ist, { anahtar: AJ2.private });
    reddedildi(ist, "imza_gecersiz");
  });
});

describe("gateway /ajanda: eşleştirme (pencere kapsamı = kanal)", () => {
  const ajandaPair = (kod = KOD, t: Anahtarli = AJ1) => ({ v: 1, type: "pair_request", kod, public_key: t.acik, platform: "android" });
  const sohbetPair = (kod = KOD, t: Anahtarli = TEL) => ({ v: 1, type: "pair_request", kod, public_key: t.acik, platform: "android", etiket: "deneme" });

  it("ajanda penceresi + /ajanda: pair_result{kapsam:ajanda}, cihaz ajanda kapsamında, aynı bağlantıda hello sürer", async () => {
    const o = await hazir();
    o.pencereAc("ajanda");
    const ist = o.bagla("/ajanda", IP3);
    await ist.gonder(ajandaPair(KOD, AJ1));
    const pr = ist.tur("pair_result")[0];
    assert.ok(pr?.ok, JSON.stringify(ist.kare));
    assert.equal(pr.kapsam, "ajanda");
    assert.equal(pr.server_public_key, o.anahtar.acikAnahtar());
    assert.equal(JSON.parse(ist.c.gonderilenler[0]!).v, 1);
    assert.equal(ist.kapali, false);
    const kayit = o.depo.kapsamliCihazGetir(pr.device_id);
    assert.equal(kayit?.kapsam, "ajanda");
    assert.equal(kayit?.tailscale_ip, IP3);
    assert.equal(o.depo.cihazGetir(pr.device_id), null, "ajanda cihazı sohbet listesinde olmamalı");
    assert.equal(o.depo.eslestirmeOku(), null, "pencere tek kullanımlık");
    await ajandaElSik(ist, { device_id: pr.device_id });
    assert.equal(ist.tur("esitlendi").length, 1, JSON.stringify(ist.kare));
    // Aynı cihaz /sohbet'i açamaz.
    const s = o.bagla("/sohbet", IP3);
    await eskiElSik(s, pr.device_id, AJ1.private);
    reddedildi(s, "kanal_desteklenmiyor");
  });

  it("sohbet penceresi /sohbet'te bugünkü gibi: pair_result'ta kapsam yok, cihaz sohbet kapsamında", async () => {
    const o = await hazir();
    o.pencereAc();
    const ist = o.bagla("/sohbet", IP3);
    await ist.gonder(sohbetPair());
    const ham = JSON.parse(ist.c.gonderilenler[0]!) as Msg;
    assert.deepEqual(Object.keys(ham).sort(), ["device_id", "ok", "server_public_key", "type", "v"]);
    const kayit = o.depo.kapsamliCihazGetir(ham.device_id);
    assert.equal(kayit?.kapsam, undefined);
    assert.ok(o.depo.cihazGetir(ham.device_id));
  });

  /** Bir yolda pencere yokken alınan ret: karşılaştırma tabanı (baytlar ve kapanış). */
  async function pencereYokkenRet(yol: WsYolu, mesaj: object): Promise<{ baytlar: string[]; kapanis: unknown }> {
    const o = await hazir();
    const ist = o.bagla(yol, IP3);
    await ist.gonder(mesaj);
    return { baytlar: [...ist.c.gonderilenler], kapanis: ist.c.kapanis };
  }

  for (const [yol, pencere, mesaj] of [
    ["/sohbet", "ajanda", sohbetPair()],
    ["/ajanda", "sohbet", ajandaPair()],
  ] as const) {
    it(`${pencere} penceresi ${yol}'da: doğru ya da yanlış kodla pencere yokmuş gibi eslestirme_kapali; pencere ve sayaçlar değişmez`, async () => {
      const taban = await pencereYokkenRet(yol, mesaj);
      assert.equal(JSON.parse(taban.baytlar[0]!).code, "eslestirme_kapali");
      const o = await hazir();
      o.pencereAc(pencere as CihazKapsami);
      const once = o.depo.eslestirmeOku();
      const cihazSayisi = o.depo.eslesmeler().length;
      // Doğru kod, yanlış kod ve adres başına sınırın üstünde deneme: hepsi aynı yanıt.
      for (const kod of [KOD, "YANLIS1234", "YANLIS1234", "YANLIS1234", "YANLIS1234", "YANLIS1234", "YANLIS1234", KOD]) {
        const ist = o.bagla(yol, IP3);
        await ist.gonder({ ...mesaj, kod });
        assert.deepEqual([...ist.c.gonderilenler], taban.baytlar, `kod ${kod}: yanıt pencere yokkenkiyle aynı olmalı`);
        assert.deepEqual(ist.c.kapanis, taban.kapanis);
      }
      assert.deepEqual(o.depo.eslestirmeOku(), once, "pencere ve yanlış sayacı değişmemeli");
      assert.equal(o.depo.eslesmeler().length, cihazSayisi, "cihaz eklenmemeli");
      // Pencere doğru yolda, aynı adresten hâlâ kullanılabilir (adres sayacı da artmadı).
      const dogruYol: WsYolu = pencere === "ajanda" ? "/ajanda" : "/sohbet";
      const dogru = o.bagla(dogruYol, IP3);
      await dogru.gonder(pencere === "ajanda" ? ajandaPair() : sohbetPair());
      assert.ok(dogru.tur("pair_result")[0]?.ok, JSON.stringify(dogru.kare));
      assert.equal(o.gunluk.bul("eslestirme_kapsam_uyusmuyor").length, 8);
    });
  }

  it("/ajanda: yanlış kod eslestirme_kodu_gecersiz (sayaç artar), süresi geçmiş pencere ve kendi adresi reddedilir", async () => {
    const o = await hazir();
    o.pencereAc("ajanda");
    const y = o.bagla("/ajanda", IP3);
    await y.gonder(ajandaPair("YANLIS1234"));
    assert.equal(y.tur("pair_result")[0]?.code, "eslestirme_kodu_gecersiz");
    assert.ok(y.kapali);
    assert.equal(o.depo.eslestirmeOku()?.yanlis_deneme, 1);
    const k = o.bagla("/ajanda", SUNUCU_IP);
    await k.gonder(ajandaPair());
    assert.equal(k.tur("pair_result")[0]?.code, "ip_uyusmuyor");
    o.zaman.ilerlet(300_000);
    const s = o.bagla("/ajanda", IP3);
    await s.gonder(ajandaPair());
    assert.equal(s.tur("pair_result")[0]?.code, "eslestirme_kapali");
    assert.equal(o.depo.eslesmeler().filter((e) => e.kapsam === "ajanda").length, 2, "yalnız hazır iki ajanda cihazı");
  });

  it("adres başına 5 yanlış kod sınırı /ajanda'da da geçerli; pencere başka adrese açık kalır", async () => {
    const o = await hazir();
    o.pencereAc("ajanda");
    for (let i = 0; i < 5; i++) {
      const ist = o.bagla("/ajanda", IP3);
      await ist.gonder(ajandaPair("YANLIS1234"));
      assert.equal(ist.tur("pair_result")[0]?.code, "eslestirme_kodu_gecersiz");
    }
    const kapali = o.bagla("/ajanda", IP3);
    await kapali.gonder(ajandaPair());
    assert.equal(kapali.tur("pair_result")[0]?.code, "eslestirme_kapali");
    const baska = o.bagla("/ajanda", "100.64.0.23");
    await baska.gonder(ajandaPair());
    assert.ok(baska.tur("pair_result")[0]?.ok);
  });

  it("kimlik sonrası pair_request ve kimlik öncesi iş çerçevesi: yetkisiz + kapat", async () => {
    const o = await hazir();
    const a = o.bagla("/ajanda");
    await a.gonder(islemMesaji("i-1", ekleIslemi("k1")));
    reddedildi(a, "yetkisiz");
    const b = o.bagla("/ajanda");
    await b.gonder({ v: 1, type: "gecmis_iste", istek_id: "g1", kayit_id: "k1" });
    reddedildi(b, "yetkisiz");
    assert.equal(o.aj.c.uygulanan.length + o.aj.c.gecmis.length, 0);
    const c = await o.ajandaGiris();
    await c.gonder(ajandaPair());
    assert.equal(c.hataKodu, "yetkisiz");
    assert.ok(c.kapali);
  });
});

describe("gateway /ajanda: el sıkışma ve çözücü", () => {
  it("welcome alanları, kimlikDogrulandi yalnız imzadan sonra, karsila'ya hello özeti", async () => {
    const o = await hazir();
    o.aj.yaz(kayitUret("k1", 0));
    const ist = o.bagla("/ajanda");
    await ist.gonder({ v: 1, type: "hello", device_id: "aj-1", son_rev: 1, depo_id: DEPO_ID, son_rev_izi: { kayit_id: "k1", guncelleme_ms: BASLANGIC + 1 }, client_nonce: NONCE });
    assert.equal(ist.c.kimlikDogrulandiMi, false);
    assert.equal(o.aj.c.karsila.length, 0, "karsila kimlikten önce çağrılmamalı");
    const ch = ist.tur("auth_challenge")[0]!;
    await ist.gonder({
      v: 1,
      type: "auth_response",
      signature: imzala(AJ1.private, ajandaKimlikImzaMetni({ rol: "telefon", device_id: "aj-1", client_nonce: NONCE, server_nonce: ch.server_nonce })),
    });
    assert.equal(ist.c.kimlikDogrulandiMi, true);
    assert.deepEqual(o.aj.c.karsila, [{ son_rev: 1, depo_id: DEPO_ID, son_rev_izi: { kayit_id: "k1", guncelleme_ms: BASLANGIC + 1 } }]);
    const w = ist.tur("welcome")[0]!;
    assert.deepEqual(w, { v: 1, type: "welcome", depo_id: DEPO_ID, bas_rev: 1, tam: false, server_time_ms: BASLANGIC });
    assert.deepEqual(ist.turler, ["auth_challenge", "welcome", "esitlendi"]);
    assert.ok(o.gunluk.bul("kimlik_tamam").some((g) => g.alanlar?.["kanal"] === "ajanda"));
  });

  it("10 sn içinde kimlik bitmezse zaman_asimi; kimlikten sonra süre yok", async () => {
    const o = await hazir();
    const a = o.bagla("/ajanda");
    const b = await o.ajandaGiris(IP2, { device_id: "aj-2", anahtar: AJ2.private });
    o.zaman.ilerlet(10_000);
    await bosalt();
    reddedildi(a, "zaman_asimi");
    assert.equal(b.kapali, false);
  });

  it("sıra bozuk: hello'dan önce auth_response, hello'dan sonra yine hello: yetkisiz", async () => {
    const o = await hazir();
    const a = o.bagla("/ajanda");
    await a.gonder({ v: 1, type: "auth_response", signature: "AAAA" });
    reddedildi(a, "yetkisiz");
    const b = o.bagla("/ajanda");
    await b.gonder({ v: 1, type: "hello", device_id: "aj-1", son_rev: 0, client_nonce: NONCE });
    await b.gonder({ v: 1, type: "hello", device_id: "aj-1", son_rev: 0, client_nonce: NONCE });
    reddedildi(b, "yetkisiz");
  });

  it("çözücü: başka sürüm protokol_uyumsuz (1002), bozuk JSON ve /sohbet çerçevesi gecersiz_mesaj (1008); hepsi kapatır", async () => {
    const o = await hazir();
    const v2 = o.bagla("/ajanda");
    await v2.gonder({ v: 2, type: "hello", device_id: "aj-1", son_rev: 0, client_nonce: NONCE });
    reddedildi(v2, "protokol_uyumsuz");
    assert.equal(v2.c.kapanis?.kod, 1002);
    const bozuk = o.bagla("/ajanda");
    await bozuk.gonder("{");
    reddedildi(bozuk, "gecersiz_mesaj");
    // /sohbet v5 hello'su `last_seq` taşır: ajanda şeması fazla alanı reddeder.
    const sohbet = o.bagla("/ajanda");
    await sohbet.gonder({ v: SOHBET_SURUMU, type: "hello", device_id: "aj-1", last_seq: 0, client_nonce: NONCE });
    assert.ok(sohbet.kapali);
    const eski = o.bagla("/ajanda");
    await eski.gonder({ v: 1, type: "hello", device_id: "aj-1", client_nonce: NONCE });
    reddedildi(eski, "gecersiz_mesaj");
    assert.equal(o.anahtar.imzalananlar.length, 0);
  });

  it("kimlik sonrası /sohbet iş çerçevesi (user_message) gecersiz_mesaj + kapat, insan mesajı işlenmez", async () => {
    const o = await hazir();
    const ist = await o.ajandaGiris();
    await ist.gonder({ v: 1, type: "user_message", client_msg_id: "u1", sohbet_id: "ana", input: "yazi", text: "merhaba" });
    assert.equal(ist.hataKodu, "gecersiz_mesaj");
    assert.ok(ist.kapali);
    assert.equal(o.insanMesajlari.length, 0);
  });

  it("her ret kodu AJANDA_KANAL_HATALARI'ndadır (giden error çerçeveleri şemadan geçer)", async () => {
    const o = await hazir();
    const kodlar = new Set<string>();
    const denemeler: Array<(i: Ist) => Promise<unknown>> = [
      (i) => ajandaElSik(i, { device_id: "yok-1" }),
      (i) => ajandaElSik(i, { device_id: "tel-1", anahtar: TEL.private }),
      (i) => ajandaElSik(i, { anahtar: AJ2.private }),
      (i) => i.gonder("x"),
      (i) => i.gonder({ v: 9, type: "hello" }),
    ];
    for (const d of denemeler) {
      const ist = o.bagla("/ajanda");
      await d(ist);
      kodlar.add(ist.hataKodu!);
    }
    for (const k of kodlar) assert.ok((AJANDA_KANAL_HATALARI as readonly string[]).includes(k), k);
  });
});

describe("gateway /ajanda: telafi", () => {
  /** k1..kn, revizyon 1..n; `silinen` mezar taşı. */
  const doldur = (o: Ortam, n: number, silinen?: string): void => {
    for (let i = 1; i <= n; i++) o.aj.yaz(kayitUret(`k${i}`, 0));
    if (silinen !== undefined) o.aj.yaz({ ...o.aj.kayitlar.get(silinen)!, silindi: true });
  };

  it("tam telafi: 0'dan bütün kayıtların son hali (mezar taşı dahil), revizyon artan, sonda esitlendi{bas_rev}", async () => {
    const o = await hazir();
    doldur(o, 3, "k2");
    const ist = await o.ajandaGiris();
    const w = ist.tur("welcome")[0]!;
    assert.equal(w.tam, true);
    assert.equal(w.bas_rev, 4);
    // k2 rev 2'den 4'e geçti: yalnız son hali gider.
    assert.deepEqual(ist.revler, [1, 3, 4]);
    assert.equal(ist.tur("kayit").at(-1)!.kayit.silindi, true);
    assert.deepEqual(ist.turler, ["auth_challenge", "welcome", "kayit", "kayit", "kayit", "esitlendi"]);
    assert.deepEqual(ist.tur("esitlendi")[0], { v: 1, type: "esitlendi", rev: 4 });
    assert.deepEqual(o.aj.c.sayfa[0], { sonRev: 0, ustRev: 4, adet: AJANDA_TELAFI_SAYFASI });
  });

  it("artımlı telafi: yalnız son_rev'ten büyükler; yeni kayıt yoksa welcome + esitlendi", async () => {
    const o = await hazir();
    doldur(o, 5);
    const iz = { kayit_id: "k3", guncelleme_ms: BASLANGIC + 3 };
    const ist = await o.ajandaGiris(IP1, { son_rev: 3, depo_id: DEPO_ID, son_rev_izi: iz });
    assert.equal(ist.tur("welcome")[0]!.tam, false);
    assert.deepEqual(ist.revler, [4, 5]);
    const bos = await o.ajandaGiris(IP2, { device_id: "aj-2", anahtar: AJ2.private, son_rev: 5, depo_id: DEPO_ID, son_rev_izi: { kayit_id: "k5", guncelleme_ms: BASLANGIC + 5 } });
    assert.deepEqual(bos.turler, ["auth_challenge", "welcome", "esitlendi"]);
  });

  it("tam telafi (farklı depo_id) son_rev'e bakmadan 0'dan gönderir", async () => {
    const o = await hazir();
    doldur(o, 3);
    const ist = await o.ajandaGiris(IP1, { son_rev: 2, depo_id: "eski-depo", son_rev_izi: { kayit_id: "k2", guncelleme_ms: 1 } });
    assert.equal(ist.tur("welcome")[0]!.tam, true);
    assert.deepEqual(ist.revler, [1, 2, 3]);
  });

  it("çok sayfalı telafi: her kayıt bir kez, sırayla; sayfa sınırı AJANDA_TELAFI_SAYFASI", async () => {
    const o = await hazir();
    const n = AJANDA_TELAFI_SAYFASI * 2 + 17;
    doldur(o, n);
    const ist = await o.ajandaGiris();
    assert.deepEqual(ist.revler, Array.from({ length: n }, (_, i) => i + 1));
    assert.ok(o.aj.c.sayfa.every((s) => s.adet === AJANDA_TELAFI_SAYFASI && s.ustRev === n));
    assert.deepEqual(o.aj.c.sayfa.map((s) => s.sonRev), [0, AJANDA_TELAFI_SAYFASI, AJANDA_TELAFI_SAYFASI * 2]);
  });

  it("kesilen telafi: kopunca gönderim durur, esitlendi gitmez; yeniden bağlanınca kaldığı yerden (son_rev)", async () => {
    const o = await hazir();
    doldur(o, 5);
    const ist = o.bagla("/ajanda");
    const asil = ist.c.gonder.bind(ist.c);
    let kayitDenemesi = 0;
    (ist.c as { gonder: (m: string) => void }).gonder = (m: string) => {
      asil(m);
      if ((JSON.parse(m) as Msg).type !== "kayit") return;
      kayitDenemesi++;
      if (kayitDenemesi === 2) ist.c.istemciKopar();
    };
    await ajandaElSik(ist);
    assert.equal(kayitDenemesi, 2, "kopmadan sonra gönderim denenmemeli");
    assert.equal(ist.tur("esitlendi").length, 0);
    const son = ist.tur("kayit").at(-1)!.kayit;
    // Kopuk bağlantıya canlı yayın da gitmez.
    o.aj.yaz(kayitUret("k6", 0));
    assert.equal(kayitDenemesi, 2);
    const yeni = await o.ajandaGiris(IP1, { son_rev: son.revizyon, depo_id: DEPO_ID, son_rev_izi: { kayit_id: son.kayit_id, guncelleme_ms: son.guncelleme_ms } });
    assert.deepEqual(yeni.revler, [3, 4, 5, 6]);
  });

  it("telafi sürerken doğan kayıt sıraya girer: esitlendi'den sonra bir kez gider", async () => {
    const o = await hazir();
    doldur(o, 3);
    o.aj.ayar.sayfaKancasi = (n) => {
      if (n === 1) o.aj.yaz(kayitUret("yeni", 0));
    };
    const ist = await o.ajandaGiris();
    assert.deepEqual(ist.turler, ["auth_challenge", "welcome", "kayit", "kayit", "kayit", "esitlendi", "kayit"]);
    assert.deepEqual(ist.revler, [1, 2, 3, 4]);
    assert.equal(ist.tur("esitlendi")[0]!.rev, 3);
  });

  it("telafi aynı kaydı yeniden getirse (bozuk sayfa) bile aynı revizyon iki kez gitmez, döngü biter", async () => {
    const o = await hazir();
    doldur(o, 2);
    const asil = o.aj.yuz.telafiSayfasi;
    o.aj.yuz.telafiSayfasi = (g) => {
      o.aj.c.sayfa.push(g);
      // Her çağrıda tam sayfa ve hep aynı kayıtlar: ilerleme yoksa gateway durmalı.
      return Array.from({ length: AJANDA_TELAFI_SAYFASI }, () => o.aj.kayitlar.get("k1")!);
    };
    const ist = o.bagla("/ajanda");
    await ajandaElSik(ist);
    assert.deepEqual(ist.revler, [1]);
    assert.equal(ist.tur("esitlendi").length, 1);
    assert.ok(o.aj.c.sayfa.length <= 2);
    o.aj.yuz.telafiSayfasi = asil;
  });

  it("karsila atarsa ic_hata + kapanış (1011); bağlantı açık kalmaz", async () => {
    const o = await hazir();
    o.aj.yuz.karsila = () => {
      throw new Error("vt");
    };
    const ist = o.bagla("/ajanda");
    await ajandaElSik(ist);
    assert.equal(ist.hataKodu, "ic_hata");
    assert.equal(ist.c.kapanis?.kod, 1011);
    assert.equal(o.gunluk.bul("cerceve_hatasi").length, 1);
  });
});

describe("gateway /ajanda: canlı kayıt", () => {
  it("esitlendi'den sonra her yeni revizyon kimliği bitmiş her /ajanda bağlantısına; kimliksize ve /sohbet'e gitmez", async () => {
    const o = await hazir();
    const a = await o.ajandaGiris();
    const b = await o.ajandaGiris(IP2, { device_id: "aj-2", anahtar: AJ2.private });
    const bekleyen = o.bagla("/ajanda", IP1);
    await bekleyen.gonder({ v: 1, type: "hello", device_id: "aj-1", son_rev: 0, client_nonce: NONCE });
    const s = o.bagla("/sohbet");
    await eskiElSik(s, "tel-1", TEL.private);
    const sOnce = s.c.gonderilenler.length;
    o.aj.yaz(kayitUret("k1", 0));
    o.aj.yaz(kayitUret("k2", 0));
    assert.deepEqual(a.revler, [1, 2]);
    assert.deepEqual(b.revler, [1, 2]);
    assert.deepEqual(bekleyen.turler, ["auth_challenge"]);
    assert.equal(s.c.gonderilenler.length, sOnce);
    // Bekleyen bağlantı kimliği bitirince telafiyle alır.
    const ch = bekleyen.tur("auth_challenge")[0]!;
    await bekleyen.gonder({
      v: 1,
      type: "auth_response",
      signature: imzala(AJ1.private, ajandaKimlikImzaMetni({ rol: "telefon", device_id: "aj-1", client_nonce: NONCE, server_nonce: ch.server_nonce })),
    });
    assert.deepEqual(bekleyen.revler, [1, 2]);
  });

  it("aynı ya da eski revizyon yeniden yayınlansa gitmez", async () => {
    const o = await hazir();
    const a = await o.ajandaGiris();
    const k = o.aj.yaz(kayitUret("k1", 0));
    o.veriyolu.yayinla("ajanda_kayit_yazildi", { kayit: k });
    o.veriyolu.yayinla("ajanda_kayit_yazildi", { kayit: { ...k, revizyon: 0 + 1 } });
    assert.deepEqual(a.revler, [1]);
  });

  it("boşluk (bir revizyonun yayını ulaşmadı ya da sıra bozuldu) önce depodan doldurulur, sonra yeni kayıt", async () => {
    const o = await hazir();
    const a = await o.ajandaGiris();
    o.aj.yaz(kayitUret("k1", 0)); // rev 1, yayınlandı
    const kacan = o.aj.yaz(kayitUret("k2", 0), false); // rev 2, yayın yok
    o.aj.yaz(kayitUret("k3", 0)); // rev 3
    assert.deepEqual(a.revler, [1, 2, 3]);
    // Geç gelen eski yayın tekrar gitmez.
    o.veriyolu.yayinla("ajanda_kayit_yazildi", { kayit: kacan });
    assert.deepEqual(a.revler, [1, 2, 3]);
  });

  it("boşluk doldurma atarsa yalnız o bağlantı ic_hata ile kapanır", async () => {
    const o = await hazir();
    const a = await o.ajandaGiris();
    o.aj.yuz.telafiSayfasi = () => {
      throw new Error("vt");
    };
    o.veriyolu.yayinla("ajanda_kayit_yazildi", { kayit: kayitUret("k9", 9) });
    assert.equal(a.hataKodu, "ic_hata");
    assert.ok(a.kapali);
    assert.equal(o.gunluk.bul("canli_kayit_hatasi").length, 1);
  });
});

describe("gateway /ajanda: işlem ve geçmiş", () => {
  it("islem → islemUygula(device_id, islem_id, islem) → islem_sonucu; kayıt canlı gelir; aynı islem_id aynı sonuç", async () => {
    const o = await hazir();
    const ist = await o.ajandaGiris();
    await ist.gonder(islemMesaji("i-1", ekleIslemi("k1")));
    assert.deepEqual(ist.tur("islem_sonucu"), [{ v: 1, type: "islem_sonucu", islem_id: "i-1", ok: true, kayit_id: "k1", rev: 1 }]);
    assert.deepEqual(ist.revler, [1]);
    assert.equal(o.aj.c.uygulanan.length, 1);
    assert.equal(o.aj.c.uygulanan[0]![0], "aj-1");
    assert.equal(o.aj.c.uygulanan[0]![1], "i-1");
    assert.equal(o.aj.c.uygulanan[0]![2].islem, "ekle");
    await ist.gonder(islemMesaji("i-1", ekleIslemi("k1")));
    assert.equal(ist.tur("islem_sonucu").length, 2);
    assert.deepEqual(ist.tur("islem_sonucu")[1], ist.tur("islem_sonucu")[0]);
    assert.equal(o.aj.c.uygulanan.length, 1, "ikinci kez uygulanmamalı");
    assert.deepEqual(ist.revler, [1]);
    // Kalıcı ret ve yan etkisiz ok.
    await ist.gonder(islemMesaji("i-2", { islem: "sil", kayit_id: "yok" }));
    assert.deepEqual(ist.tur("islem_sonucu")[2], { v: 1, type: "islem_sonucu", islem_id: "i-2", ok: false, code: "kayit_bulunamadi" });
    assert.equal(ist.kapali, false);
  });

  it("gövdesi geçersiz işlem: gecersiz_islem, bağlantı açık, tekrarsızlık için gecersizIslem(device_id, islem_id); sonraki işlem sürer", async () => {
    const o = await hazir();
    const ist = await o.ajandaGiris();
    for (const islem of [{ islem: "ekle", kayit_id: "k1" }, { islem: "uc", kayit_id: "k1" }, { ...ekleIslemi("k1"), url: "http://ornek" }]) {
      await ist.gonder(islemMesaji("i-bozuk", islem));
    }
    assert.deepEqual(o.aj.c.gecersiz, [["aj-1", "i-bozuk"], ["aj-1", "i-bozuk"], ["aj-1", "i-bozuk"]]);
    assert.ok(ist.tur("islem_sonucu").every((s) => s.islem_id === "i-bozuk" && s.ok === false && s.code === "gecersiz_islem"));
    assert.equal(ist.tur("islem_sonucu").length, 3);
    assert.equal(ist.kapali, false);
    assert.equal(o.aj.c.uygulanan.length, 0);
    await ist.gonder(islemMesaji("i-2", ekleIslemi("k1")));
    assert.equal(ist.tur("islem_sonucu").at(-1)!.ok, true);
  });

  it("zarfı geçersiz işlem (islem_id yok ya da bozuk, fazla alan): gecersiz_mesaj + kapat, ajanda çağrılmaz", async () => {
    for (const m of [
      { v: 1, type: "islem", islem: ekleIslemi("k1") },
      { v: 1, type: "islem", islem_id: "bozuk kimlik", islem: ekleIslemi("k1") },
      { v: 1, type: "islem", islem_id: "i-1", islem: ekleIslemi("k1"), fazla: true },
    ]) {
      const o = await hazir();
      const ist = await o.ajandaGiris();
      await ist.gonder(m);
      assert.equal(ist.hataKodu, "gecersiz_mesaj", JSON.stringify(m));
      assert.ok(ist.kapali);
      assert.equal(o.aj.c.gecersiz.length + o.aj.c.uygulanan.length, 0);
    }
  });

  it("kimlik öncesi gövdesi geçersiz işlem gecersizIslem çağırmaz, kapatır", async () => {
    const o = await hazir();
    const ist = o.bagla("/ajanda");
    await ist.gonder(islemMesaji("i-1", { islem: "ekle" }));
    reddedildi(ist, "gecersiz_mesaj");
    assert.equal(o.aj.c.gecersiz.length, 0);
  });

  it("islemUygula atarsa geçici ic_hata döner, bağlantı açık kalır, sonraki deneme uygulanır", async () => {
    const o = await hazir();
    const ist = await o.ajandaGiris();
    o.aj.ayar.islemAtar = true;
    await ist.gonder(islemMesaji("i-1", ekleIslemi("k1")));
    assert.deepEqual(ist.tur("islem_sonucu")[0], { v: 1, type: "islem_sonucu", islem_id: "i-1", ok: false, code: "ic_hata" });
    assert.equal(ist.kapali, false);
    o.aj.ayar.islemAtar = false;
    await ist.gonder(islemMesaji("i-1", ekleIslemi("k1")));
    assert.equal(ist.tur("islem_sonucu")[1]!.ok, true);
  });

  it("gecmis_iste → gecmis (istek_id, kayit_id, girdiler, devami); bilinmeyen kayıt kayit_bulunamadi; hata ic_hata; bağlantı açık", async () => {
    const o = await hazir();
    o.aj.yaz(kayitUret("k1", 0));
    const ist = await o.ajandaGiris();
    await ist.gonder({ v: 1, type: "gecmis_iste", istek_id: "g1", kayit_id: "k1", once_rev: 5 });
    assert.deepEqual(ist.tur("gecmis")[0], { v: 1, type: "gecmis", istek_id: "g1", kayit_id: "k1", girdiler: [GECMIS_GIRDISI], devami: true });
    assert.deepEqual(o.aj.c.gecmis[0], ["k1", 5]);
    await ist.gonder({ v: 1, type: "gecmis_iste", istek_id: "g2", kayit_id: "yok" });
    assert.deepEqual(ist.tur("gecmis")[1], { v: 1, type: "gecmis", istek_id: "g2", kayit_id: "yok", girdiler: [], devami: false, code: "kayit_bulunamadi" });
    o.aj.ayar.gecmisAtar = true;
    await ist.gonder({ v: 1, type: "gecmis_iste", istek_id: "g3", kayit_id: "k1" });
    assert.equal(ist.tur("gecmis")[2]!.code, "ic_hata");
    assert.equal(ist.kapali, false);
  });

  it("işlem çıktısında yüzün fazla alanı kablaya çıkmaz", async () => {
    const o = await hazir();
    o.aj.yuz.islemUygula = () => ({ ok: true, kayit_id: "k1", rev: 3, fazla: "x" }) as unknown as AjandaIslemSonucuGovdesi;
    const ist = await o.ajandaGiris();
    await ist.gonder(islemMesaji("i-1", ekleIslemi("k1")));
    assert.deepEqual(JSON.parse(ist.c.gonderilenler.at(-1)!), { v: 1, type: "islem_sonucu", islem_id: "i-1", ok: true, kayit_id: "k1", rev: 3 });
  });
});

describe("gateway /ajanda: kopma, kaldırma, kapanış", () => {
  it("kopma: bağlantı bırakılır, yayın gitmez; yeniden bağlanınca artımlı telafi kaçırılanı getirir", async () => {
    const o = await hazir();
    o.aj.yaz(kayitUret("k1", 0));
    const a = await o.ajandaGiris();
    const once = a.c.gonderilenler.length;
    a.c.istemciKopar();
    o.aj.yaz(kayitUret("k2", 0));
    o.aj.yaz(kayitUret("k3", 0));
    assert.equal(a.c.gonderilenler.length, once);
    const b = await o.ajandaGiris(IP1, { son_rev: 1, depo_id: DEPO_ID, son_rev_izi: { kayit_id: "k1", guncelleme_ms: BASLANGIC + 1 } });
    assert.deepEqual(b.revler, [2, 3]);
    o.aj.yaz(kayitUret("k4", 0));
    assert.deepEqual(b.revler, [2, 3, 4]);
  });

  it("kaldırılan ajanda cihazı: açık bağlantı yoklamayla (2 sn) ve ilk çerçevede kapanır; öteki cihaz açık kalır", async () => {
    const o = await hazir();
    const a = await o.ajandaGiris();
    const b = await o.ajandaGiris(IP2, { device_id: "aj-2", anahtar: AJ2.private });
    assert.equal(o.depo.cihazKaldir("aj-1").sonuc, "kaldirildi");
    o.zaman.ilerlet(2_000);
    await bosalt();
    assert.equal(a.hataKodu, "cihaz_bilinmiyor");
    assert.deepEqual(a.c.kapanis, { kod: 1008, neden: "cihaz_bilinmiyor" });
    assert.equal(b.kapali, false);
    assert.ok(o.gunluk.bul("yetki_kalkti").some((g) => g.alanlar?.["kanal"] === "ajanda"));
    assert.equal(o.depo.cihazKaldir("aj-2").sonuc, "kaldirildi");
    await b.gonder(islemMesaji("i-1", ekleIslemi("k1")));
    assert.equal(b.hataKodu, "cihaz_bilinmiyor");
    assert.equal(o.aj.c.uygulanan.length, 0);
    // Gövdesi geçersiz işlem de yetkiyi aşamaz.
    const o2 = await hazir();
    const c = await o2.ajandaGiris();
    o2.depo.cihazKaldir("aj-1");
    await c.gonder(islemMesaji("i-2", { islem: "ekle" }));
    assert.equal(c.hataKodu, "cihaz_bilinmiyor");
    assert.equal(o2.aj.c.gecersiz.length, 0);
  });

  it("hello ile auth_response arasında kaldırılırsa geçerli imza da cihaz_bilinmiyor", async () => {
    const o = await hazir();
    const ist = o.bagla("/ajanda");
    await ajandaElSik(ist, {
      metin: (n) => {
        o.depo.cihazKaldir("aj-1");
        return ajandaKimlikImzaMetni({ rol: "telefon", device_id: "aj-1", client_nonce: NONCE, server_nonce: n });
      },
    });
    reddedildi(ist, "cihaz_bilinmiyor");
    assert.equal(o.aj.c.karsila.length, 0);
  });

  it("gateway kapanınca /ajanda bağlantıları 1001 ile kapanır, yayın dinlenmez", async () => {
    const o = await hazir();
    const a = await o.ajandaGiris();
    const once = a.c.gonderilenler.length;
    await o.gw.kapat();
    assert.deepEqual(a.c.kapanis, { kod: 1001, neden: "kapaniyor" });
    o.aj.yaz(kayitUret("k1", 0));
    assert.equal(a.c.gonderilenler.length, once);
    assert.equal(o.zaman.bekleyenSayisi(), 0);
  });

  it("kayıt metni günlüğe yazılmaz", async () => {
    const o = await hazir();
    o.aj.yaz(kayitUret("k1", 0, { baslik: "GIZLI-BASLIK" }));
    const ist = await o.ajandaGiris();
    await ist.gonder(islemMesaji("i-1", ekleIslemi("k2", "GIZLI-BASLIK-2")));
    await ist.gonder(islemMesaji("i-2", { ...ekleIslemi("k3", "GIZLI-BASLIK-3"), fazla: 1 }));
    assert.ok(!JSON.stringify(o.gunluk.girdiler).includes("GIZLI"));
  });
});
