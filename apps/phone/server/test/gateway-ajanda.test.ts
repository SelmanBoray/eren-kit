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
 * - Sürüm uyumu (YOL-HARITASI 3.3, D5): bağlantı sürümünün sabitlenmesi, aşağı uyarlama ve denetim, ret
 *   sürümü, v2 bayt eşitliği → "sürüm uyumu". Bugün `AJANDA_SURUMLERI = [2, 3]`.
 * - Sürüm 3: yetenek müzakeresi (`welcome.yetenekler` = kesişim) → "yetenekler". v3 alanlarının gerçek
 *   ajanda modülüyle uçtan uca yolu ve v2/v3 istemcinin birlikte çalışması `ajanda-surum-v3.test.ts`'te.
 * - Ek yedeği (`ek_yedegi`): ek çerçevelerinin kapısı (v3, kimlik sonrası, `esitlendi` sonrası, kesişim)
 *   → "ek yedeği". Gerçek ek modülü, bellekte sahte disk; çekirdeğin ayrıntısı `ajanda-ekler.test.ts`'te.
 */
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign as imzaAt, timingSafeEqual, verify as imzaDogrula } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import {
  AJANDA_AZAMI_CERCEVE,
  AJANDA_SURUMU,
  AJANDA_KANAL_HATALARI,
  AJANDA_SURUMLERI,
  AjandaKaydi,
  AZAMI_CERCEVE,
  SOHBET_SURUMU,
  ajandaAsagiCoz,
  ajandaKimlikImzaMetni,
  ajandaRetSurumuOku,
  cihazAsagiCoz,
  kimlikImzaMetni,
  sha256Hex,
  sohbetAsagiCoz,
  utf8Bayt,
} from "@eren/protocol";
import type { AjandaGecmisGirdisi, AjandaIslem, CihazKapsami, ServisBilgisi } from "@eren/protocol";
import { depoAc } from "../src/depo.ts";
import { gatewayKur } from "../src/gateway.ts";
import { ajandaEkleriKur } from "../src/ajanda-ekler.ts";
import type { AjandaEkleriBagimliliklari } from "../src/ajanda-ekler.ts";
import { AJANDA_TELAFI_SAYFASI, ajandaEkliYuz } from "../src/gateway-ajanda.ts";
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
import { sahteEkDiski } from "./sahte-ek-diski.ts";
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
/** Ajanda kanalının sürümü: elle yazılan `/ajanda` çerçeveleri bununla (en yeni sürüm, bugün v3). */
const AV: number = AJANDA_SURUMU;

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
    /** Servisin sunduğu yetenekler (`AjandaGatewayYuzu.yetenekler`). */
    yetenekler: [] as string[],
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
    get yetenekler() {
      return ayar.yetenekler;
    },
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
  /** Bağlantının sürümü (varsayılan `AV`). */
  v?: number;
  /** v3 `hello.yetenekler` (verilmezse alan yok). */
  yetenekler?: string[];
}

async function ajandaElSik(ist: Ist, s: AjandaElSikma = {}): Promise<Msg | null> {
  const device_id = s.device_id ?? "aj-1";
  const v = s.v ?? AV;
  await ist.gonder({
    v,
    type: "hello",
    device_id,
    son_rev: s.son_rev ?? 0,
    ...(s.depo_id !== undefined && { depo_id: s.depo_id }),
    ...(s.son_rev_izi !== undefined && { son_rev_izi: s.son_rev_izi }),
    client_nonce: NONCE,
    ...(s.yetenekler !== undefined && { yetenekler: s.yetenekler }),
  });
  const ch = ist.tur("auth_challenge")[0];
  if (ch === undefined || ist.kapali) return null;
  const metin =
    s.metin?.(ch.server_nonce) ??
    ajandaKimlikImzaMetni({ rol: "telefon", device_id, client_nonce: NONCE, server_nonce: ch.server_nonce });
  await ist.gonder({ v, type: "auth_response", signature: imzala(s.anahtar ?? AJ1.private, metin) });
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

function kur(sec: { ajanda?: boolean; ekler?: boolean } = {}) {
  const zaman = sahteZaman(BASLANGIC);
  const gunluk = sahteGunluk();
  const veriyolu = veriyoluKur({ gunluk });
  const depo = depoAc({ yol: ":memory:", saat: zaman.saat, veriyolu, gunluk });
  acilacaklar.push(() => depo.kapat());
  const ws = sahteWs();
  const anahtar = gercekAnahtar();
  const aj = sahteAjanda(veriyolu);
  // Ek yedeği: gerçek ek modülü, bellekte sahte disk; kayıtlar sahte ajandanınkiler.
  const ekDiski = sahteEkDiski(() => zaman.saat.simdiMs());
  const ekler =
    sec.ekler === true
      ? ajandaEkleriKur({
          disk: ekDiski.disk,
          depo: {
            ajandaKaydiGetir: (id: string) => aj.kayitlar.get(id) ?? null,
            ajandaKayitlari: () => [...aj.kayitlar.values()].filter((k) => !k.silindi),
          } as unknown as AjandaEkleriBagimliliklari["depo"],
          saat: zaman.saat,
          zamanlayici: zaman.zamanlayici,
          gunluk,
        })
      : null;
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
    ...(sec.ajanda !== false && { ajanda: ekler === null ? aj.yuz : ajandaEkliYuz(aj.yuz, ekler) }),
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
    ekDiski,
    ekler,
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

const islemMesaji = (islem_id: string, islem: object) => ({ v: AV, type: "islem", islem_id, islem });

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
    assert.equal(ist.kare[0]!.v, AV);
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
  const ajandaPair = (kod = KOD, t: Anahtarli = AJ1) => ({ v: AV, type: "pair_request", kod, public_key: t.acik, platform: "android" });
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
    assert.equal(JSON.parse(ist.c.gonderilenler[0]!).v, AV);
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
    await b.gonder({ v: AV, type: "gecmis_iste", istek_id: "g1", kayit_id: "k1" });
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
    await ist.gonder({ v: AV, type: "hello", device_id: "aj-1", son_rev: 1, depo_id: DEPO_ID, son_rev_izi: { kayit_id: "k1", guncelleme_ms: BASLANGIC + 1 }, client_nonce: NONCE });
    assert.equal(ist.c.kimlikDogrulandiMi, false);
    assert.equal(o.aj.c.karsila.length, 0, "karsila kimlikten önce çağrılmamalı");
    const ch = ist.tur("auth_challenge")[0]!;
    await ist.gonder({
      v: AV,
      type: "auth_response",
      signature: imzala(AJ1.private, ajandaKimlikImzaMetni({ rol: "telefon", device_id: "aj-1", client_nonce: NONCE, server_nonce: ch.server_nonce })),
    });
    assert.equal(ist.c.kimlikDogrulandiMi, true);
    assert.deepEqual(o.aj.c.karsila, [{ son_rev: 1, depo_id: DEPO_ID, son_rev_izi: { kayit_id: "k1", guncelleme_ms: BASLANGIC + 1 } }]);
    const w = ist.tur("welcome")[0]!;
    // v3: `yetenekler` her zaman yollanır (istenmediyse boş kesişim).
    assert.deepEqual(w, { v: AV, type: "welcome", depo_id: DEPO_ID, bas_rev: 1, tam: false, server_time_ms: BASLANGIC, yetenekler: [] });
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
    await a.gonder({ v: AV, type: "auth_response", signature: "AAAA" });
    reddedildi(a, "yetkisiz");
    const b = o.bagla("/ajanda");
    await b.gonder({ v: AV, type: "hello", device_id: "aj-1", son_rev: 0, client_nonce: NONCE });
    await b.gonder({ v: AV, type: "hello", device_id: "aj-1", son_rev: 0, client_nonce: NONCE });
    reddedildi(b, "yetkisiz");
  });

  it("çözücü: başka sürüm protokol_uyumsuz (1002), bozuk JSON ve /sohbet çerçevesi gecersiz_mesaj (1008); hepsi kapatır", async () => {
    const o = await hazir();
    const ileri = o.bagla("/ajanda");
    await ileri.gonder({ v: AV + 1, type: "hello", device_id: "aj-1", son_rev: 0, client_nonce: NONCE });
    reddedildi(ileri, "protokol_uyumsuz");
    assert.equal(ileri.c.kapanis?.kod, 1002);
    const bozuk = o.bagla("/ajanda");
    await bozuk.gonder("{");
    reddedildi(bozuk, "gecersiz_mesaj");
    // /sohbet v5 hello'su `last_seq` taşır: ajanda şeması fazla alanı reddeder.
    const sohbet = o.bagla("/ajanda");
    await sohbet.gonder({ v: SOHBET_SURUMU, type: "hello", device_id: "aj-1", last_seq: 0, client_nonce: NONCE });
    assert.ok(sohbet.kapali);
    // Ajanda sürümünde ama `son_rev`'siz (/cihaz biçimli) hello: şema reddi.
    const eksik = o.bagla("/ajanda");
    await eksik.gonder({ v: AV, type: "hello", device_id: "aj-1", client_nonce: NONCE });
    reddedildi(eksik, "gecersiz_mesaj");
    assert.equal(o.anahtar.imzalananlar.length, 0);
  });

  describe("v2: sürüm 1 konuşan (eski) ajanda uygulaması", () => {
    const V1_HELLO = { v: 1, type: "hello", device_id: "aj-1", son_rev: 3, depo_id: DEPO_ID, client_nonce: NONCE };
    const V1_PAIR = { v: 1, type: "pair_request", kod: KOD, public_key: AJ1.acik, platform: "android" };

    it("v1 hello: {v:AJANDA_SURUMU, error, protokol_uyumsuz} + 1002; sınama yok, karsila yok, kayıt gitmez", async () => {
      const o = await hazir();
      o.aj.yaz(kayitUret("k1", 0));
      const ist = o.bagla("/ajanda");
      await ist.gonder(V1_HELLO);
      reddedildi(ist, "protokol_uyumsuz");
      // Ret sürümü servisin en yüksek sürümüdür (D5 kuralı; v3'le 2'den 3'e çıktı).
      assert.deepEqual(ist.kare, [{ v: AJANDA_SURUMU, type: "error", code: "protokol_uyumsuz" }]);
      assert.equal(ist.c.kapanis?.kod, 1002);
      assert.equal(ajandaAsagiCoz(ist.c.gonderilenler[0]!).ok, true, "giden çerçeve kendi sürümünün şemasından geçer");
      assert.equal(o.anahtar.imzalananlar.length, 0);
      assert.equal(o.aj.c.karsila.length, 0);
      assert.equal(ist.tur("kayit").length, 0);
      // Eşleşme göçsüz kalır: aynı cihaz v2 ile aynı anahtarla, yeniden eşleşmeden bağlanır.
      assert.equal(o.depo.kapsamliCihazGetir("aj-1")?.kapsam, "ajanda");
      const yeni = await o.ajandaGiris();
      assert.equal(yeni.tur("kayit").length, 1);
    });

    it("v1 pair_request açık ajanda penceresinde de protokol_uyumsuz; pencere ve sayaçlar değişmez, cihaz eklenmez", async () => {
      const o = await hazir();
      o.pencereAc("ajanda");
      const once = o.depo.eslestirmeOku();
      const sayi = o.depo.eslesmeler().length;
      const ist = o.bagla("/ajanda", IP3);
      await ist.gonder(V1_PAIR);
      assert.deepEqual(ist.kare, [{ v: AJANDA_SURUMU, type: "error", code: "protokol_uyumsuz" }]);
      assert.equal(ist.c.kapanis?.kod, 1002);
      assert.deepEqual(o.depo.eslestirmeOku(), once);
      assert.equal(o.depo.eslesmeler().length, sayi);
      // Pencere v2 uygulamasına açık kalır; pair_result da v2.
      const v2 = o.bagla("/ajanda", IP3);
      await v2.gonder({ ...V1_PAIR, v: AV });
      assert.ok(v2.tur("pair_result")[0]?.ok);
      assert.equal(JSON.parse(v2.c.gonderilenler[0]!).v, AV);
    });

    it("v1 uygulamasının reddi /sohbet ve /cihaz'ı etkilemez: açık sohbet bağlantısı sürer, yeni bağlantılar bugünkü gibi açılır", async () => {
      const o = await hazir();
      const s = o.bagla("/sohbet");
      await eskiElSik(s, "tel-1", TEL.private);
      assert.equal(s.tur("welcome").length, 1, JSON.stringify(s.kare));
      const sOnce = s.c.gonderilenler.length;
      for (let i = 0; i < 3; i++) {
        const ist = o.bagla("/ajanda");
        await ist.gonder(V1_HELLO);
        reddedildi(ist, "protokol_uyumsuz");
      }
      assert.equal(s.kapali, false);
      assert.equal(s.c.gonderilenler.length, sOnce, "sohbet bağlantısına çerçeve gitmemeli");
      const s2 = o.bagla("/sohbet");
      await eskiElSik(s2, "tel-1", TEL.private);
      assert.equal(s2.tur("welcome").length, 1);
      const c = o.bagla("/cihaz");
      await eskiElSik(c, "tel-1", TEL.private);
      assert.equal(c.tur("welcome").length, 1, JSON.stringify(c.kare));
    });
  });

  it("kimlik sonrası /sohbet iş çerçevesi (user_message) gecersiz_mesaj + kapat, insan mesajı işlenmez", async () => {
    const o = await hazir();
    const ist = await o.ajandaGiris();
    await ist.gonder({ v: AV, type: "user_message", client_msg_id: "u1", sohbet_id: "ana", input: "yazi", text: "merhaba" });
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
    assert.deepEqual(ist.tur("esitlendi")[0], { v: AV, type: "esitlendi", rev: 4 });
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
    await bekleyen.gonder({ v: AV, type: "hello", device_id: "aj-1", son_rev: 0, client_nonce: NONCE });
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
      v: AV,
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
    assert.deepEqual(ist.tur("islem_sonucu"), [{ v: AV, type: "islem_sonucu", islem_id: "i-1", ok: true, kayit_id: "k1", rev: 1 }]);
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
    assert.deepEqual(ist.tur("islem_sonucu")[2], { v: AV, type: "islem_sonucu", islem_id: "i-2", ok: false, code: "kayit_bulunamadi" });
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
      { v: AV, type: "islem", islem: ekleIslemi("k1") },
      { v: AV, type: "islem", islem_id: "bozuk kimlik", islem: ekleIslemi("k1") },
      { v: AV, type: "islem", islem_id: "i-1", islem: ekleIslemi("k1"), fazla: true },
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
    assert.deepEqual(ist.tur("islem_sonucu")[0], { v: AV, type: "islem_sonucu", islem_id: "i-1", ok: false, code: "ic_hata" });
    assert.equal(ist.kapali, false);
    o.aj.ayar.islemAtar = false;
    await ist.gonder(islemMesaji("i-1", ekleIslemi("k1")));
    assert.equal(ist.tur("islem_sonucu")[1]!.ok, true);
  });

  it("gecmis_iste → gecmis (istek_id, kayit_id, girdiler, devami); bilinmeyen kayıt kayit_bulunamadi; hata ic_hata; bağlantı açık", async () => {
    const o = await hazir();
    o.aj.yaz(kayitUret("k1", 0));
    const ist = await o.ajandaGiris();
    await ist.gonder({ v: AV, type: "gecmis_iste", istek_id: "g1", kayit_id: "k1", once_rev: 5 });
    assert.deepEqual(ist.tur("gecmis")[0], { v: AV, type: "gecmis", istek_id: "g1", kayit_id: "k1", girdiler: [GECMIS_GIRDISI], devami: true });
    assert.deepEqual(o.aj.c.gecmis[0], ["k1", 5]);
    await ist.gonder({ v: AV, type: "gecmis_iste", istek_id: "g2", kayit_id: "yok" });
    assert.deepEqual(ist.tur("gecmis")[1], { v: AV, type: "gecmis", istek_id: "g2", kayit_id: "yok", girdiler: [], devami: false, code: "kayit_bulunamadi" });
    o.aj.ayar.gecmisAtar = true;
    await ist.gonder({ v: AV, type: "gecmis_iste", istek_id: "g3", kayit_id: "k1" });
    assert.equal(ist.tur("gecmis")[2]!.code, "ic_hata");
    assert.equal(ist.kapali, false);
  });

  it("işlem çıktısında yüzün fazla alanı kablaya çıkmaz", async () => {
    const o = await hazir();
    o.aj.yuz.islemUygula = () => ({ ok: true, kayit_id: "k1", rev: 3, fazla: "x" }) as unknown as AjandaIslemSonucuGovdesi;
    const ist = await o.ajandaGiris();
    await ist.gonder(islemMesaji("i-1", ekleIslemi("k1")));
    assert.deepEqual(JSON.parse(ist.c.gonderilenler.at(-1)!), { v: AV, type: "islem_sonucu", islem_id: "i-1", ok: true, kayit_id: "k1", rev: 3 });
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

describe("gateway /ajanda: yetenekler (v3 müzakere)", () => {
  it("welcome.yetenekler = istenenlerle sunulanların kesişimi, kanonik sırada; bilinmeyen ad girmez", async () => {
    const o = await hazir();
    o.aj.ayar.yetenekler = ["eslesme_birak", "ice_aktar"];
    const a = await o.ajandaGiris(IP1, { yetenekler: ["ek_yedegi", "ice_aktar", "zz_bilinmeyen"] });
    assert.deepEqual(a.tur("welcome")[0]!.yetenekler, ["ice_aktar"]);
    // İstemci hiç istemediyse boş; sunulan küme kendiliğinden ilan edilmez.
    const b = await o.ajandaGiris(IP2, { device_id: "aj-2", anahtar: AJ2.private });
    assert.deepEqual(b.tur("welcome")[0]!.yetenekler, []);
  });

  it("sunulan küme boşsa (ek modülü kurulmamış servis): ek_yedegi istense de kesişim boş", async () => {
    const o = await hazir();
    assert.deepEqual(o.aj.ayar.yetenekler, []);
    const a = await o.ajandaGiris(IP1, { yetenekler: ["ek_yedegi"] });
    assert.deepEqual(a.tur("welcome")[0]!.yetenekler, []);
  });

  it("v2 bağlantı: welcome'da yetenekler alanı yok (baytlar v2'nin); v2 hello yetenek taşıyamaz", async () => {
    const o = await hazir();
    o.aj.ayar.yetenekler = ["ice_aktar"];
    const a = await o.ajandaGiris(IP1, { v: 2 });
    const w = JSON.parse(a.c.gonderilenler[1]!) as Msg;
    assert.equal(w.type, "welcome");
    assert.equal(w.v, 2);
    assert.equal("yetenekler" in w, false);
    // v2 şeması katı: `yetenekler`'li v2 hello şema reddidir, sınama başlamaz.
    const b = o.bagla("/ajanda", IP2);
    await ajandaElSik(b, { device_id: "aj-2", anahtar: AJ2.private, v: 2, yetenekler: ["ice_aktar"] });
    reddedildi(b, "gecersiz_mesaj");
    assert.equal(JSON.parse(b.c.gonderilenler[0]!).v, 2);
  });

  it("kanonik olmayan hello.yetenekler (sırasız ya da tekrarlı) şema reddidir", async () => {
    const o = await hazir();
    for (const yetenekler of [["ice_aktar", "ek_yedegi"], ["ek_yedegi", "ek_yedegi"]]) {
      const a = o.bagla("/ajanda");
      await ajandaElSik(a, { yetenekler });
      reddedildi(a, "gecersiz_mesaj");
    }
    assert.equal(o.anahtar.imzalananlar.length, 0);
  });
});

describe("gateway /ajanda: v3 alan listeleri v2 bağlantıya süzülür", () => {
  it("islem_sonucu.korunan_alanlar ve geçmişin korunan_alanlar'ı v2'de yalnız v2 alanları; v3'te tam", async () => {
    const o = await hazir();
    o.aj.yaz(kayitUret("k1", 0));
    const korunan = ["baslik", "bolge", "bolge_konumu", "ekler"] as const;
    o.aj.yuz.islemUygula = () => ({ ok: true, kayit_id: "k1", korunan_alanlar: [...korunan] });
    const girdi: AjandaGecmisGirdisi = {
      ...GECMIS_GIRDISI,
      yazar: { yol: "arka_plan", tur_kokeni: "insan", sohbet_id: "ana" },
      korunan_alanlar: [...korunan],
      onceki: { baslik: "A", bolge: "Kadıköy", bolge_konumu: { enlem_e6: 1, boylam_e6: 2, yaricap_m: 100 } },
      sonraki: { baslik: "B", bolge: null, bolge_konumu: null },
    };
    o.aj.yuz.gecmis = (kayit_id) => ({ kayit_id, girdiler: [girdi], devami: false });
    const v2 = await o.ajandaGiris(IP1, { v: 2 });
    const v3 = await o.ajandaGiris(IP2, { device_id: "aj-2", anahtar: AJ2.private });
    for (const [ist, v] of [[v2, 2], [v3, AV]] as const) {
      await ist.gonder({ v, type: "islem", islem_id: "i-1", islem: ekleIslemi("k9") });
      await ist.gonder({ v, type: "gecmis_iste", istek_id: "g1", kayit_id: "k1" });
    }
    const son = (ist: Ist, t: string): Msg => JSON.parse(ist.c.gonderilenler.filter((m) => m.includes(`"type":"${t}"`)).at(-1)!) as Msg;
    assert.deepEqual(son(v2, "islem_sonucu").korunan_alanlar, ["baslik"]);
    assert.deepEqual(son(v3, "islem_sonucu").korunan_alanlar, [...korunan]);
    const g2 = son(v2, "gecmis").girdiler[0] as Msg;
    assert.deepEqual(g2.korunan_alanlar, ["baslik"]);
    assert.deepEqual([g2.onceki, g2.sonraki], [{ baslik: "A" }, { baslik: "B" }]);
    assert.deepEqual(son(v3, "gecmis").girdiler[0], girdi);
    // Her giden çerçeve kendi bağlantısının sürümünün şemasından geçer.
    for (const m of v2.c.gonderilenler) assert.ok(ajandaAsagiCoz(m, 2).ok, m);
    for (const m of v3.c.gonderilenler) assert.ok(ajandaAsagiCoz(m, 3).ok, m);
  });
});

describe("gateway /ajanda: sürüm uyumu (D5: bağlantı sürümü, aşağı uyarlama, ret sürümü)", () => {
  const EN_KUCUK = Math.min(...AJANDA_SURUMLERI);
  const EN_BUYUK = Math.max(...AJANDA_SURUMLERI);
  /** Bugün v1 ve v4: kümenin hemen altı ve üstü. */
  const DESTEKSIZ = [EN_KUCUK - 1, EN_BUYUK + 1];
  const UYUMSUZ = JSON.stringify({ v: AJANDA_SURUMU, type: "error", code: "protokol_uyumsuz" });
  /** Giden çerçeveler çözücüsüz (şemadan geçmeyen çerçeve de görünsün). */
  const hamlar = (ist: Ist): Msg[] => ist.c.gonderilenler.map((m) => JSON.parse(m) as Msg);
  const hata = (v: number, code: string): string => JSON.stringify({ v, type: "error", code });
  const pair = (v: number) => ({ v, type: "pair_request", kod: KOD, public_key: AJ1.acik, platform: "android" });

  it("AJANDA_SURUMU kümenin en büyüğüdür (ret sürümü ve iç model buna dayanır)", () => {
    assert.equal(AJANDA_SURUMU, EN_BUYUK);
  });

  for (const v of DESTEKSIZ) {
    it(`ilk çerçeve v${v} (hello ve pair_request): yalnız {v:AJANDA_SURUMU, error, protokol_uyumsuz} + 1002; sınama, eşleştirme yok`, async () => {
      const o = await hazir();
      o.pencereAc("ajanda");
      const pencere = o.depo.eslestirmeOku();
      const h = o.bagla("/ajanda");
      await h.gonder({ v, type: "hello", device_id: "aj-1", son_rev: 0, client_nonce: NONCE });
      assert.deepEqual(h.c.gonderilenler, [UYUMSUZ]);
      assert.deepEqual(h.c.kapanis, { kod: 1002, neden: "protokol_uyumsuz" });
      // İstemcinin geri düşüşü servisin en yüksek sürümünü okur.
      assert.equal(ajandaRetSurumuOku(h.c.gonderilenler[0]!), AJANDA_SURUMU);
      const p = o.bagla("/ajanda", IP3);
      await p.gonder(pair(v));
      assert.deepEqual(p.c.gonderilenler, [UYUMSUZ]);
      assert.deepEqual(p.c.kapanis, { kod: 1002, neden: "protokol_uyumsuz" });
      assert.equal(o.anahtar.imzalananlar.length, 0);
      assert.equal(o.aj.c.karsila.length, 0);
      assert.deepEqual(o.depo.eslestirmeOku(), pencere, "pencere ve sayaçlar değişmemeli");
    });
  }

  it("sabitlemeden sonra başka v protokol_uyumsuz (ret v'si yine AJANDA_SURUMU): sınamada, kimlik sonrası, pair_request ardından", async () => {
    const o = await hazir();
    // `hello` ile sabitlendi; `auth_response` başka sürümde.
    for (const v of DESTEKSIZ) {
      const a = o.bagla("/ajanda");
      await a.gonder({ v: AV, type: "hello", device_id: "aj-1", son_rev: 0, client_nonce: NONCE });
      assert.equal(a.tur("auth_challenge").length, 1);
      await a.gonder({ v, type: "auth_response", signature: "AAAA" });
      assert.deepEqual(a.c.gonderilenler.slice(1), [UYUMSUZ]);
      assert.equal(a.c.kapanis?.kod, 1002);
      assert.equal(a.c.kimlikDogrulandiMi, false);
    }
    assert.equal(o.aj.c.karsila.length, 0);
    // Kimlik sonrası: işlem ve geçmiş isteği başka sürümde; işlem uygulanmaz, `gecersiz_islem` de değil.
    for (const cerceve of [
      { ...islemMesaji("i-1", ekleIslemi("k1")), v: AV + 1 },
      { v: AV - 1, type: "gecmis_iste", istek_id: "g1", kayit_id: "k1" },
    ]) {
      const b = await o.ajandaGiris();
      const once = b.c.gonderilenler.length;
      await b.gonder(cerceve);
      assert.deepEqual(b.c.gonderilenler.slice(once), [UYUMSUZ]);
      assert.equal(b.c.kapanis?.kod, 1002);
    }
    assert.equal(o.aj.c.uygulanan.length, 0);
    assert.equal(o.aj.c.gecersiz.length, 0);
    assert.equal(o.aj.c.gecmis.length, 0);
    // `pair_request` ile sabitlendi; aynı bağlantıdaki `hello` başka sürümde.
    o.pencereAc("ajanda");
    const p = o.bagla("/ajanda", IP3);
    await p.gonder(pair(AV));
    const pr = p.tur("pair_result")[0];
    assert.ok(pr?.ok, JSON.stringify(p.kare));
    await p.gonder({ v: AV + 1, type: "hello", device_id: pr.device_id, son_rev: 0, client_nonce: NONCE });
    assert.deepEqual(p.c.gonderilenler.slice(1), [UYUMSUZ]);
    assert.equal(p.c.kapanis?.kod, 1002);
  });

  it("giden her çerçevenin v'si bağlantı sürümü: eşleştirme, sınama, telafi, canlı, işlem, geçmiş, ret", async () => {
    const o = await hazir();
    o.aj.yaz(kayitUret("k1", 0));
    o.pencereAc("ajanda");
    const ist = o.bagla("/ajanda", IP3);
    await ist.gonder(pair(AV));
    const pr = ist.tur("pair_result")[0]!;
    await ajandaElSik(ist, { device_id: pr.device_id });
    o.aj.yaz(kayitUret("k2", 0));
    await ist.gonder(islemMesaji("i-1", ekleIslemi("k3")));
    await ist.gonder(islemMesaji("i-2", { islem: "ekle" }));
    await ist.gonder({ v: AV, type: "gecmis_iste", istek_id: "g1", kayit_id: "k1" });
    await ist.gonder(pair(AV));
    const kare = hamlar(ist);
    assert.deepEqual(
      [...new Set(kare.map((k) => k.type))].sort(),
      ["auth_challenge", "error", "esitlendi", "gecmis", "islem_sonucu", "kayit", "pair_result", "welcome"],
    );
    for (const k of kare) assert.equal(k.v, AV, JSON.stringify(k));
    assert.equal(ist.hataKodu, "yetkisiz");
  });

  it("ret sürümü sabitlenmemiş bağlantıda: çerçevenin desteklenen v'si; v yok, sayı değil, bozuk JSON, çok büyük ve zaman aşımı kümenin en küçük sürümü (AJANDA_SURUMLERI[0])", async () => {
    const o = await hazir();
    const ES = AJANDA_SURUMLERI[0];
    const durumlar: Array<[string | object, number, string, number]> = [
      [{ v: AV, type: "hello", device_id: "aj-1", client_nonce: NONCE }, AV, "gecersiz_mesaj", 1008],
      [{ v: AV, type: "auth_response", signature: "AAAA" }, AV, "yetkisiz", 1008],
      [{ v: AV, type: "islem", islem_id: "i-1", islem: { islem: "ekle" } }, AV, "gecersiz_mesaj", 1008],
      [{ type: "hello", device_id: "aj-1", son_rev: 0, client_nonce: NONCE }, ES, "gecersiz_mesaj", 1008],
      [{ v: String(AV), type: "hello", device_id: "aj-1", son_rev: 0, client_nonce: NONCE }, ES, "gecersiz_mesaj", 1008],
      ["{", ES, "gecersiz_mesaj", 1008],
      ["[2]", ES, "gecersiz_mesaj", 1008],
      [JSON.stringify({ v: AV, type: "hello", d: "x".repeat(AJANDA_AZAMI_CERCEVE.KANAL) }), ES, "mesaj_cok_buyuk", 1009],
    ];
    for (const [cerceve, v, code, kod] of durumlar) {
      const ist = o.bagla("/ajanda");
      await ist.gonder(cerceve);
      assert.deepEqual(ist.c.gonderilenler, [hata(v, code)], JSON.stringify(cerceve).slice(0, 80));
      assert.equal(ist.c.kapanis?.kod, kod);
    }
    const sessiz = o.bagla("/ajanda");
    o.zaman.ilerlet(10_000);
    await bosalt();
    assert.deepEqual(sessiz.c.gonderilenler, [hata(ES, "zaman_asimi")]);
  });

  it("telafide denetimi tutmayan kayıt kabloya çıkmaz: ic_hata (1011), esitlendi yok; günlükte tür var, değer yok", async () => {
    const o = await hazir();
    o.aj.yaz(kayitUret("k1", 0));
    o.aj.yaz({ ...kayitUret("k2", 0, { baslik: "GIZLI-BASLIK" }), fazla: "GIZLI-FAZLA" } as unknown as AjandaKaydi);
    o.aj.yaz(kayitUret("k3", 0));
    const ist = o.bagla("/ajanda");
    await ajandaElSik(ist);
    assert.deepEqual(hamlar(ist).map((k) => k.type), ["auth_challenge", "welcome", "kayit", "error"]);
    assert.deepEqual(ist.revler, [1]);
    assert.equal(ist.c.gonderilenler.at(-1), hata(AV, "ic_hata"));
    assert.deepEqual(ist.c.kapanis, { kod: 1011, neden: "ic_hata" });
    assert.ok(!ist.c.gonderilenler.some((m) => m.includes("GIZLI")), "geçersiz çerçeve kabloya çıktı");
    const g = o.gunluk.bul("asagi_uyarlama_hatasi", "hata");
    assert.equal(g.length, 1);
    assert.equal(g[0]!.alanlar?.["type"], "kayit");
    assert.equal(g[0]!.alanlar?.["v"], AV);
    assert.equal(g[0]!.alanlar?.["code"], "gecersiz_mesaj");
    assert.ok(!JSON.stringify(o.gunluk.girdiler).includes("GIZLI"), "değer günlüğe yazıldı");
    // Kapanan bağlantı canlı yayın da almaz.
    o.aj.yaz(kayitUret("k4", 0));
    assert.deepEqual(ist.revler, [1]);
  });

  it("canlı kayıt ve işlem sonucu denetimi tutmazsa çerçeve çıkmaz, bağlantı ic_hata ile kapanır", async () => {
    const o = await hazir();
    const a = await o.ajandaGiris();
    const once = a.c.gonderilenler.length;
    o.veriyolu.yayinla("ajanda_kayit_yazildi", { kayit: { ...kayitUret("k1", 1), tur: "uydurma" } as unknown as AjandaKaydi });
    assert.deepEqual(a.c.gonderilenler.slice(once), [hata(AV, "ic_hata")]);
    assert.equal(a.c.kapanis?.kod, 1011);
    // Yüz şemada olmayan ret kodu döndürdü.
    o.aj.yuz.islemUygula = () => ({ ok: false, code: "uydurma_kod" }) as unknown as AjandaIslemSonucuGovdesi;
    const b = await o.ajandaGiris(IP2, { device_id: "aj-2", anahtar: AJ2.private });
    const bOnce = b.c.gonderilenler.length;
    await b.gonder(islemMesaji("i-1", ekleIslemi("k9")));
    assert.deepEqual(b.c.gonderilenler.slice(bOnce), [hata(AV, "ic_hata")]);
    assert.equal(b.c.kapanis?.kod, 1011);
    assert.deepEqual(
      o.gunluk.bul("asagi_uyarlama_hatasi").map((g) => g.alanlar?.["type"]),
      ["kayit", "islem_sonucu"],
    );
  });

  it("bayt eşitliği: v2 istemcinin gördüğü baytlar D5 öncesiyle aynı (alan sırası dahil)", async () => {
    assert.ok((AJANDA_SURUMLERI as readonly number[]).includes(2));
    const o = await hazir();
    // v1 uygulamasının reddi. Tek değişen bayt: `protokol_uyumsuz`'un `v`'si servisin en yüksek sürümüdür
    // (D5), v3 ile 2'den 3'e çıktı. Bu çerçeveyi v2 telefon görmez (yalnız v1 ya da desteksiz sürüm görür).
    const eski = o.bagla("/ajanda");
    await eski.gonder({ v: 1, type: "hello", device_id: "aj-1", son_rev: 0, client_nonce: NONCE });
    assert.deepEqual(eski.c.gonderilenler, [`{"v":${AJANDA_SURUMU},"type":"error","code":"protokol_uyumsuz"}`]);
    // Eşleştirme: başarı ve ret.
    o.pencereAc("ajanda");
    const p = o.bagla("/ajanda", IP3);
    await p.gonder(pair(2));
    const device_id = (JSON.parse(p.c.gonderilenler[0]!) as Msg).device_id as string;
    assert.deepEqual(p.c.gonderilenler, [
      `{"v":2,"type":"pair_result","ok":true,"device_id":${JSON.stringify(device_id)},"server_public_key":${JSON.stringify(o.anahtar.acikAnahtar())},"kapsam":"ajanda"}`,
    ]);
    const kotu = o.bagla("/ajanda", IP3);
    await kotu.gonder({ ...pair(2), kod: "YANLIS1234" });
    assert.deepEqual(kotu.c.gonderilenler, ['{"v":2,"type":"pair_result","ok":false,"code":"eslestirme_kapali"}']);
    // Kimlik, telafi, canlı, işlem, geçmiş, ret.
    o.aj.yaz(kayitUret("k1", 0));
    const ist = o.bagla("/ajanda");
    await ist.gonder({ v: 2, type: "hello", device_id: "aj-1", son_rev: 0, client_nonce: NONCE });
    const ch = JSON.parse(ist.c.gonderilenler[0]!) as Msg;
    await ist.gonder({
      v: 2,
      type: "auth_response",
      signature: imzala(AJ1.private, ajandaKimlikImzaMetni({ rol: "telefon", device_id: "aj-1", client_nonce: NONCE, server_nonce: ch.server_nonce })),
    });
    await ist.gonder({ v: 2, type: "islem", islem_id: "i-1", islem: ekleIslemi("k2") });
    await ist.gonder({ v: 2, type: "gecmis_iste", istek_id: "g1", kayit_id: "k1" });
    await ist.gonder({ v: 2, type: "hello", device_id: "aj-1", son_rev: 0, client_nonce: NONCE });
    const k1 = JSON.stringify(o.aj.kayitlar.get("k1"));
    const k2 = JSON.stringify(o.aj.kayitlar.get("k2"));
    assert.deepEqual(ist.c.gonderilenler, [
      `{"v":2,"type":"auth_challenge","server_nonce":${JSON.stringify(ch.server_nonce)},"server_signature":${JSON.stringify(ch.server_signature)}}`,
      `{"v":2,"type":"welcome","depo_id":"depo-1","bas_rev":1,"tam":true,"server_time_ms":${BASLANGIC}}`,
      `{"v":2,"type":"kayit","kayit":${k1}}`,
      '{"v":2,"type":"esitlendi","rev":1}',
      `{"v":2,"type":"kayit","kayit":${k2}}`,
      '{"v":2,"type":"islem_sonucu","islem_id":"i-1","ok":true,"kayit_id":"k2","rev":2}',
      `{"v":2,"type":"gecmis","istek_id":"g1","kayit_id":"k1","girdiler":[${JSON.stringify(GECMIS_GIRDISI)}],"devami":true}`,
      '{"v":2,"type":"error","code":"yetkisiz"}',
    ]);
  });
});

describe("gateway /ajanda: ek yedeği (ek_yedegi)", () => {
  const VERI = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) & 0xff);
  const OZET = sha256Hex(VERI);
  const EK = { ek_id: "ek_1", mime: "image/jpeg", bayt: VERI.length, ozet: OZET, olusturma_ms: BASLANGIC };
  const yukle = (v = AV, ozet = OZET) => ({ v, type: "ek_yukle", istek_id: "y1", kayit_id: "k1", ek_id: "ek_1", ozet, bayt: VERI.length });
  const parca = { v: AV, type: "ek_parca", ek_id: "ek_1", ofset: 0, veri: Buffer.from(VERI).toString("base64") };
  const iste = { v: AV, type: "ek_iste", istek_id: "i1", ek_id: "ek_1", ozet: OZET, ofset: 0 };

  /** Ek modülü kurulu (ya da değil), sunulan küme `ek_yedegi`, k1 kaydı eki taşır. */
  const ekli = async (sec: { ekler?: boolean } = {}): Promise<Ortam> => {
    const o = await hazir({ ekler: sec.ekler ?? true });
    o.aj.ayar.yetenekler = ["ek_yedegi"];
    o.aj.yaz(kayitUret("k1", 0, { ekler: [EK] } as Partial<AjandaKaydi>));
    return o;
  };

  const gonderBekle = async (o: Ortam, ist: Ist, m: object): Promise<void> => {
    await ist.gonder(m);
    await o.ekler?.bekle();
    await bosalt();
  };

  it("v3, esitlendi sonrası, kesişimde ek_yedegi: yükleme ve indirme; ek_ret bağlantıyı kapatmaz", async () => {
    const o = await ekli();
    const a = await o.ajandaGiris(IP1, { yetenekler: ["ek_yedegi"] });
    assert.deepEqual(a.tur("welcome")[0]!.yetenekler, ["ek_yedegi"]);
    await gonderBekle(o, a, yukle());
    await gonderBekle(o, a, parca);
    assert.deepEqual(a.tur("ek_durum"), [
      { v: AV, type: "ek_durum", ek_id: "ek_1", alinan: 0, tamam: false },
      { v: AV, type: "ek_durum", ek_id: "ek_1", alinan: VERI.length, tamam: true },
    ]);
    assert.deepEqual(o.ekDiski.tamlar.get(OZET), VERI);
    await gonderBekle(o, a, iste);
    assert.deepEqual(a.tur("ek_parca").map((m) => Buffer.from(m.veri, "base64").length), [VERI.length]);
    assert.deepEqual(a.tur("ek_durum").at(-1), { v: AV, type: "ek_durum", ek_id: "ek_1", gonderilen: VERI.length, tamam: true });
    // Üstverisi olmayan ek ve dosyası olmayan özet: ek_ret, bağlantı açık, işlem sürer.
    await gonderBekle(o, a, { ...yukle(), kayit_id: "yok" });
    await gonderBekle(o, a, { ...iste, ozet: "e".repeat(64) });
    assert.deepEqual(a.tur("ek_ret"), [
      { v: AV, type: "ek_ret", ek_id: "ek_1", code: "ek_bilinmiyor" },
      { v: AV, type: "ek_ret", ek_id: "ek_1", code: "ek_yok" },
    ]);
    assert.equal(a.kapali, false);
    await a.gonder(islemMesaji("i-1", ekleIslemi("k2")));
    assert.equal(a.tur("islem_sonucu")[0]!.ok, true);
  });

  it("istemci ek_yedegi istemediyse kesişim boş: ek çerçevesi bugünkü gibi yetkisiz + kapanış, diske dokunulmaz", async () => {
    const o = await ekli();
    for (const m of [yukle(), parca, iste]) {
      const a = await o.ajandaGiris();
      assert.deepEqual(a.tur("welcome")[0]!.yetenekler, []);
      await gonderBekle(o, a, m);
      assert.equal(a.hataKodu, "yetkisiz");
      assert.ok(a.kapali);
    }
    assert.deepEqual(o.ekDiski.cagrilar, []);
  });

  it("ek modülü kurulu değilse (sunulan küme ek_yedegi dese bile) ek çerçevesi yetkisiz", async () => {
    const o = await ekli({ ekler: false });
    const a = await o.ajandaGiris(IP1, { yetenekler: ["ek_yedegi"] });
    await gonderBekle(o, a, yukle());
    assert.equal(a.hataKodu, "yetkisiz");
    assert.deepEqual(o.ekDiski.cagrilar, []);
  });

  it("esitlendi'den önce (telafi sürerken) gelen ek çerçevesi yetkisiz", async () => {
    const o = await ekli();
    const ist = o.bagla("/ajanda");
    o.aj.ayar.sayfaKancasi = () => ist.c.mesajGonder(JSON.stringify(yukle()));
    await ajandaElSik(ist, { yetenekler: ["ek_yedegi"] });
    await o.ekler?.bekle();
    assert.equal(ist.hataKodu, "yetkisiz");
    assert.equal(ist.tur("esitlendi").length, 0);
    assert.deepEqual(o.ekDiski.cagrilar, []);
  });

  it("v2 bağlantı: ek çerçevesi v2 şemasında yok (gecersiz_mesaj + kapanış); v2 welcome baytları değişmez", async () => {
    const o = await ekli();
    const a = await o.ajandaGiris(IP1, { v: 2 });
    assert.equal(a.c.gonderilenler.find((m) => m.includes('"welcome"'))!.includes("yetenekler"), false);
    await gonderBekle(o, a, yukle(2));
    assert.equal(a.hataKodu, "gecersiz_mesaj");
    assert.ok(a.kapali);
    assert.equal(a.c.gonderilenler.at(-1), '{"v":2,"type":"error","code":"gecersiz_mesaj"}');
    assert.deepEqual(o.ekDiski.cagrilar, []);
  });

  it("yol enjeksiyonu: özet olmayan ozet şemada düşer (gecersiz_mesaj + kapanış), ek modülüne ve diske ulaşmaz", async () => {
    const o = await ekli();
    for (const ozet of ["..\\..\\Windows\\win.ini", "../".repeat(21) + "x", "A".repeat(64)]) {
      const a = await o.ajandaGiris(IP1, { yetenekler: ["ek_yedegi"] });
      await gonderBekle(o, a, yukle(AV, ozet));
      assert.equal(a.hataKodu, "gecersiz_mesaj");
      const b = await o.ajandaGiris(IP1, { yetenekler: ["ek_yedegi"] });
      await gonderBekle(o, b, { ...iste, ozet });
      assert.equal(b.hataKodu, "gecersiz_mesaj");
    }
    assert.deepEqual(o.ekDiski.cagrilar, []);
    assert.ok(!JSON.stringify(o.gunluk.girdiler).includes("win.ini"));
  });

  it("kimlik sonrası her ek çerçevesinde yetki: kaldırılan cihaz cihaz_bilinmiyor ile kapanır", async () => {
    const o = await ekli();
    const a = await o.ajandaGiris(IP1, { yetenekler: ["ek_yedegi"] });
    o.depo.cihazKaldir("aj-1");
    await gonderBekle(o, a, yukle());
    assert.equal(a.hataKodu, "cihaz_bilinmiyor");
    assert.deepEqual(o.ekDiski.cagrilar, []);
  });

  it("bağlantı kapanınca süren işin yanıtı yollanmaz; yeni bağlantı kaldığı yerden sürer", async () => {
    const o = await ekli();
    const a = await o.ajandaGiris(IP1, { yetenekler: ["ek_yedegi"] });
    await gonderBekle(o, a, yukle());
    a.c.mesajGonder(JSON.stringify({ ...parca, veri: Buffer.from(VERI.slice(0, 600)).toString("base64") }));
    a.c.istemciKopar();
    const once = a.c.gonderilenler.length;
    await o.ekler?.bekle();
    assert.equal(a.c.gonderilenler.length, once);
    const b = await o.ajandaGiris(IP1, { yetenekler: ["ek_yedegi"] });
    await gonderBekle(o, b, yukle());
    assert.deepEqual(b.tur("ek_durum"), [{ v: AV, type: "ek_durum", ek_id: "ek_1", alinan: 600, tamam: false }]);
  });
});
